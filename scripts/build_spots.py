"""Build and validate ground truth spots for FloodLens evaluation."""

import csv
import math
import sys
import time
from pathlib import Path
from typing import Any
import requests

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from engine.config import BBOX_EAST, BBOX_NORTH, BBOX_SOUTH, BBOX_WEST


PROJECT_ROOT = Path(__file__).resolve().parent.parent
EVAL_DIR = PROJECT_ROOT / "eval"
SPOTS_CSV = EVAL_DIR / "spots.csv"


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in meters between two lat/lon coordinates."""
    r = 6371000.0  # Earth radius in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    )
    return 2.0 * r * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))


def geocode_candidate(
    name: str,
    query: str,
    geom_type: str,
    event_date: str,
    split: str,
    source_url: str,
    notes: str = "",
) -> dict[str, Any] | None:
    """Geocode a place query using Nominatim restricted to study bbox."""
    url = "https://nominatim.openstreetmap.org/search"
    headers = {
        "User-Agent": "FloodLens-GroundTruth/1.0 (tomar@amhs.local; contact: tomar)"
    }
    params = {
        "q": query,
        "format": "json",
        "limit": 5,
        "viewbox": f"{BBOX_WEST},{BBOX_NORTH},{BBOX_EAST},{BBOX_SOUTH}",
        "bounded": 1,
    }

    try:
        resp = requests.get(url, params=params, headers=headers, timeout=12)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        print(f"Error querying {query}: {e}")
        return None

    if not data:
        print(f"NOT FOUND: '{name}' with query '{query}'")
        return None

    # Filter candidates strictly within bbox
    valid_candidates = []
    for item in data:
        lat = float(item["lat"])
        lon = float(item["lon"])
        if (
            BBOX_SOUTH <= lat <= BBOX_NORTH
            and BBOX_WEST <= lon <= BBOX_EAST
        ):
            valid_candidates.append(item)

    if not valid_candidates:
        print(f"OUT OF BOUNDS: '{name}' candidates outside study bbox")
        return None

    top = valid_candidates[0]
    lat = float(top["lat"])
    lon = float(top["lon"])
    importance = float(top.get("importance", 0.0))

    # For stretches, compute midpoint from bounding box if available
    bbox = top.get("boundingbox")
    if geom_type == "stretch" and bbox and len(bbox) == 4:
        s_lat, n_lat = float(bbox[0]), float(bbox[1])
        w_lon, e_lon = float(bbox[2]), float(bbox[3])
        lat = (s_lat + n_lat) / 2.0
        lon = (w_lon + e_lon) / 2.0

    confidence = "high" if importance >= 0.4 else "medium"

    return {
        "name": name,
        "query": query,
        "lat": round(lat, 5),
        "lon": round(lon, 5),
        "geom_type": geom_type,
        "event_date": event_date,
        "split": split,
        "source_url": source_url,
        "geocode_method": "nominatim",
        "confidence": confidence,
        "display_name": top.get("display_name", ""),
        "notes": notes,
    }


def fetch_open_meteo_rainfall(
    lat: float, lon: float, start_date: str, end_date: str
) -> dict[str, dict[str, float]]:
    """Fetch hourly precipitation from Open-Meteo archive API."""
    url = "https://archive-api.open-meteo.com/v1/archive"
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start_date,
        "end_date": end_date,
        "hourly": "precipitation",
        "timezone": "Asia/Kolkata",
    }
    resp = requests.get(url, params=params, timeout=15)
    resp.raise_for_status()
    data = resp.json()

    hourly = data.get("hourly", {})
    times = hourly.get("time", [])
    precip = hourly.get("precipitation", [])

    # Group by date
    daily_stats: dict[str, dict[str, float]] = {}
    for t_str, p_val in zip(times, precip):
        p = float(p_val) if p_val is not None else 0.0
        d_str = t_str.split("T")[0]
        if d_str not in daily_stats:
            daily_stats[d_str] = {"total_mm": 0.0, "peak_hourly_mm": 0.0}
        daily_stats[d_str]["total_mm"] += p
        if p > daily_stats[d_str]["peak_hourly_mm"]:
            daily_stats[d_str]["peak_hourly_mm"] = p

    for d_str in daily_stats:
        daily_stats[d_str]["total_mm"] = round(daily_stats[d_str]["total_mm"], 2)
        daily_stats[d_str]["peak_hourly_mm"] = round(
            daily_stats[d_str]["peak_hourly_mm"], 2
        )

    return daily_stats


def main() -> None:
    """Run geocoding, leakage filtering, and Open-Meteo stats extraction."""
    # Define candidates
    test_candidates = [
        ("Connaught Place", "Connaught Place, New Delhi", "area", "2026-07-28", "https://www.nationalheraldindia.com/national/heavy-rain-floods-parts-of-delhi-snarls-traffic-as-imd-issues-red-alert"),
        ("Janpath", "Janpath, New Delhi", "stretch", "2026-07-28", "https://www.nationalheraldindia.com/national/heavy-rain-floods-parts-of-delhi-snarls-traffic-as-imd-issues-red-alert"),
        ("Bharat Mandapam Road", "Bharat Mandapam", "stretch", "2026-07-28", "https://www.nationalheraldindia.com/national/heavy-rain-floods-parts-of-delhi-snarls-traffic-as-imd-issues-red-alert"),
        ("Barakhamba Road", "Barakhamba Road, New Delhi", "stretch", "2026-07-28", "https://www.nationalheraldindia.com/national/heavy-rain-floods-parts-of-delhi-snarls-traffic-as-imd-issues-red-alert"),
        ("Mathura Road near ITO", "Mathura Road, New Delhi", "stretch", "2026-07-28", "https://www.nationalheraldindia.com/national/heavy-rain-floods-parts-of-delhi-snarls-traffic-as-imd-issues-red-alert"),
        ("Kalindi Kunj", "Kalindi Kunj, Delhi", "area", "2026-07-28", "https://www.nationalheraldindia.com/national/heavy-rain-floods-parts-of-delhi-snarls-traffic-as-imd-issues-red-alert"),
        ("Greater Kailash-II to Chirag Dilli", "Chirag Delhi, Delhi", "stretch", "2026-07-28", "https://www.nationalheraldindia.com/national/heavy-rain-floods-parts-of-delhi-snarls-traffic-as-imd-issues-red-alert"),
        ("Hauz Khas", "Hauz Khas, New Delhi", "area", "2026-07-28", "https://www.nationalheraldindia.com/national/heavy-rain-floods-parts-of-delhi-snarls-traffic-as-imd-issues-red-alert"),
        ("R.K. Puram", "RK Puram, New Delhi", "area", "2026-07-28", "https://www.nationalheraldindia.com/national/heavy-rain-floods-parts-of-delhi-snarls-traffic-as-imd-issues-red-alert"),
        ("NH-8 near Shankar Vihar", "Shankar Vihar, Delhi", "point", "2026-07-28", "https://www.nationalheraldindia.com/national/heavy-rain-floods-parts-of-delhi-snarls-traffic-as-imd-issues-red-alert"),
        ("Zakir Hussain Road", "Dr Zakir Hussain Marg, New Delhi", "stretch", "2026-07-28", "https://www.nationalheraldindia.com/national/heavy-rain-floods-parts-of-delhi-snarls-traffic-as-imd-issues-red-alert"),
        ("Delhi Cantt-Naraina Flyover stretch", "Naraina Flyover, New Delhi", "stretch", "2026-07-28", "https://www.nationalheraldindia.com/national/heavy-rain-floods-parts-of-delhi-snarls-traffic-as-imd-issues-red-alert"),
        ("Old Rohtak Road", "Old Rohtak Road, Delhi", "stretch", "2026-07-28", "https://www.nationalheraldindia.com/national/heavy-rain-floods-parts-of-delhi-snarls-traffic-as-imd-issues-red-alert"),
        ("Madhuban Chowk-Netaji Subhash Place", "Madhuban Chowk, Delhi", "stretch", "2026-07-28", "https://www.nationalheraldindia.com/national/heavy-rain-floods-parts-of-delhi-snarls-traffic-as-imd-issues-red-alert"),
        ("Peeragarhi", "Peeragarhi, Delhi", "point", "2026-07-28", "https://www.nationalheraldindia.com/national/heavy-rain-floods-parts-of-delhi-snarls-traffic-as-imd-issues-red-alert"),
        ("NH-48 near AIIMS", "AIIMS, New Delhi", "point", "2026-07-28", "https://www.nationalheraldindia.com/national/heavy-rain-floods-parts-of-delhi-snarls-traffic-as-imd-issues-red-alert"),
        ("Delhi-Noida Road", "Noida Link Road, Delhi", "stretch", "2026-07-28", "https://www.nationalheraldindia.com/national/heavy-rain-floods-parts-of-delhi-snarls-traffic-as-imd-issues-red-alert"),
        ("Vikas Marg", "Vikas Marg, Delhi", "stretch", "2026-07-28", "https://www.nationalheraldindia.com/national/heavy-rain-floods-parts-of-delhi-snarls-traffic-as-imd-issues-red-alert"),
    ]

    dev_candidates = [
        # 2026-08-06 Delhi-NCR
        ("ITO", "ITO, New Delhi", "point", "2026-08-06", "https://www.businesstoday.in/india/story/delhi-ncr-rains-key-roads-waterlogged-after-heavy-downpour-gurugram-comes-to-a-standstill-547671-2026-08-06"),
        ("Mathura Road", "Mathura Road, New Delhi", "stretch", "2026-08-06", "https://www.businesstoday.in/india/story/delhi-ncr-rains-key-roads-waterlogged-after-heavy-downpour-gurugram-comes-to-a-standstill-547671-2026-08-06"),
        ("CR Park", "Chittaranjan Park, New Delhi", "area", "2026-08-06", "https://www.businesstoday.in/india/story/delhi-ncr-rains-key-roads-waterlogged-after-heavy-downpour-gurugram-comes-to-a-standstill-547671-2026-08-06"),
        ("Vijay Chowk", "Vijay Chowk, New Delhi", "point", "2026-08-06", "https://www.businesstoday.in/india/story/delhi-ncr-rains-key-roads-waterlogged-after-heavy-downpour-gurugram-comes-to-a-standstill-547671-2026-08-06"),
        ("Kartavya Path", "Kartavya Path, New Delhi", "stretch", "2026-08-06", "https://www.businesstoday.in/india/story/delhi-ncr-rains-key-roads-waterlogged-after-heavy-downpour-gurugram-comes-to-a-standstill-547671-2026-08-06"),
        ("Lodhi Road", "Lodhi Road, New Delhi", "stretch", "2026-08-06", "https://www.businesstoday.in/india/story/delhi-ncr-rains-key-roads-waterlogged-after-heavy-downpour-gurugram-comes-to-a-standstill-547671-2026-08-06"),
        ("Sangam Vihar", "Sangam Vihar, Delhi", "area", "2026-08-06", "https://www.businesstoday.in/india/story/delhi-ncr-rains-key-roads-waterlogged-after-heavy-downpour-gurugram-comes-to-a-standstill-547671-2026-08-06"),
        ("NH-48 towards Gurugram", "Delhi-Gurgaon Expressway, Gurugram", "stretch", "2026-08-06", "https://www.businesstoday.in/india/story/delhi-ncr-rains-key-roads-waterlogged-after-heavy-downpour-gurugram-comes-to-a-standstill-547671-2026-08-06"),
        # 2026-07-08 Gurugram
        ("Rajiv Chowk Gurugram", "Rajiv Chowk, Gurugram", "point", "2026-07-08", "https://www.thequint.com/news/breaking-news/heavy-rainfall-waterlogging-gurugram-alerts-delhi-ghaziabad"),
        ("Hero Honda Chowk Gurugram", "Hero Honda Underpass, Pace City I, Sector 10, Gurgaon", "point", "2026-07-08", "https://www.thequint.com/news/breaking-news/heavy-rainfall-waterlogging-gurugram-alerts-delhi-ghaziabad"),
        ("Patel Nagar Gurugram", "Patel Nagar, Gurugram", "area", "2026-07-08", "https://www.thequint.com/news/breaking-news/heavy-rainfall-waterlogging-gurugram-alerts-delhi-ghaziabad"),
        ("Civil Lines Gurugram", "Civil Lines, Gurugram", "area", "2026-07-08", "https://www.thequint.com/news/breaking-news/heavy-rainfall-waterlogging-gurugram-alerts-delhi-ghaziabad"),
        # Chronic spots (DEV)
        ("Minto Bridge", "Minto Bridge, Vivekanand Marg, New Delhi", "point", "2023-07-09", "https://www.hindustantimes.com/cities/delhi-news/delhi-traffic-police-issues-advisory-as-heavy-rain-triggers-waterlogging-minto-bridge-closed-101688880628373.html"),
        ("Subhash Chowk Gurugram", "Subhash Chowk, Gurugram", "point", "2026-08-24", "https://indianexpress.com/article/cities/delhi/heavy-rain-gurugram-subhash-chowk-school-buses-waterlogging-9531888/"),
    ]

    print("=== GEOCONDING DEV CANDIDATES ===")
    dev_results = []
    for name, query, gtype, dt, url in dev_candidates:
        res = geocode_candidate(name, query, gtype, dt, "dev", url)
        if res:
            dev_results.append(res)
            print(f"DEV OK: {name:28} -> ({res['lat']:.4f}, {res['lon']:.4f}) | {res['display_name'][:50]}")
        else:
            print(f"DEV DROP: {name} (could not resolve)")
        time.sleep(1.1)

    print("\n=== GEOCONDING TEST CANDIDATES ===")
    test_results = []
    for name, query, gtype, dt, url in test_candidates:
        res = geocode_candidate(name, query, gtype, dt, "test", url)
        if res:
            test_results.append(res)
            print(f"TEST OK: {name:28} -> ({res['lat']:.4f}, {res['lon']:.4f}) | {res['display_name'][:50]}")
        else:
            print(f"TEST DROP: {name} (could not resolve)")
        time.sleep(1.1)

    print("\n=== CHECKING SPATIAL LEAKAGE (TEST vs DEV < 300m) ===")
    filtered_test = []
    for t_spot in test_results:
        min_dist = float("inf")
        nearest_dev = ""
        for d_spot in dev_results:
            d_m = haversine_m(t_spot["lat"], t_spot["lon"], d_spot["lat"], d_spot["lon"])
            if d_m < min_dist:
                min_dist = d_m
                nearest_dev = d_spot["name"]
        
        if min_dist < 300.0:
            print(f"LEAKAGE DROP: Test spot '{t_spot['name']}' is {min_dist:.1f}m from Dev spot '{nearest_dev}' (<300m)")
        else:
            t_spot["notes"] = f"Min distance to DEV: {min_dist:.0f}m"
            filtered_test.append(t_spot)
            print(f"TEST KEPT: '{t_spot['name']}' (nearest dev '{nearest_dev}' at {min_dist:.0f}m)")

    # Combine and assign sequential IDs
    all_spots = []
    idx = 1
    for s in dev_results:
        s["id"] = f"SPOT_{idx:03d}"
        idx += 1
        all_spots.append(s)

    for s in filtered_test:
        s["id"] = f"SPOT_{idx:03d}"
        idx += 1
        all_spots.append(s)

    # Write spots.csv
    fieldnames = [
        "id",
        "event_date",
        "name",
        "lat",
        "lon",
        "geom_type",
        "source_url",
        "geocode_method",
        "confidence",
        "split",
    ]
    with open(SPOTS_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for s in all_spots:
            writer.writerow({k: s[k] for k in fieldnames})

    print(f"\nWrote {len(all_spots)} spots to {SPOTS_CSV}")
    print(f"- DEV spots: {len(dev_results)}")
    print(f"- TEST spots: {len(filtered_test)}")

    # Fetch Open-Meteo stats
    print("\n=== OPEN-METEO ARCHIVE RAINFALL ===")
    events = [
        ("Delhi (Safdarjung)", 28.585, 77.206, "2026-07-28", "2026-07-28"),
        ("Delhi (Safdarjung)", 28.585, 77.206, "2026-08-06", "2026-08-06"),
        ("Delhi (Safdarjung)", 28.585, 77.206, "2023-07-09", "2023-07-09"),
        ("Gurugram", 28.460, 77.030, "2026-07-08", "2026-07-08"),
        ("Gurugram", 28.460, 77.030, "2026-08-06", "2026-08-06"),
        ("Gurugram", 28.460, 77.030, "2026-08-24", "2026-08-24"),
    ]
    for loc, lat, lon, s_dt, e_dt in events:
        try:
            stats = fetch_open_meteo_rainfall(lat, lon, s_dt, e_dt)
            print(f"{loc} ({lat}, {lon}) on {s_dt}: {stats.get(s_dt)}")
        except Exception as e:
            print(f"Error fetching Open-Meteo for {loc} {s_dt}: {e}")


if __name__ == "__main__":
    main()


