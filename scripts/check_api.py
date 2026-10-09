"""Validation script for FloodLens scoring and API."""

import sys
import time

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from fastapi.testclient import TestClient
import h3

from api.main import app
from engine.score import get_hotspots, get_scored_dataset

client = TestClient(app)


def test_api_latency() -> None:
    """Benchmark request times for the FastAPI endpoints."""
    print("== 1. API Latency Benchmark =============================")
    t0 = time.time()
    r_health = client.get("/health")
    dt_health = (time.time() - t0) * 1000

    t1 = time.time()
    r_meta = client.get("/meta")
    dt_meta = (time.time() - t1) * 1000

    t2 = time.time()
    r_hotspots = client.get("/hotspots?mm=40&top=25")
    dt_hotspots = (time.time() - t2) * 1000

    print(f"GET /health:   status={r_health.status_code} in {dt_health:.1f} ms")
    print(f"GET /meta:     status={r_meta.status_code} in {dt_meta:.1f} ms")
    print(
        f"GET /hotspots: status={r_hotspots.status_code} in {dt_hotspots:.1f} ms "
        f"(Target: well under 1000 ms)"
    )

    data = r_hotspots.json()
    print(f"Returned features count: {len(data['features'])}")
    print(f"Total flooded hexes: {data['metadata']['total_flooded_hexes']}")
    print(f"Disclaimer: {data['metadata']['disclaimer']}")


def test_monotonicity() -> None:
    """Verify that flooded set at 60 mm is a superset of flooded set at 30 mm."""
    print("\n== 2. Monotonicity Test =================================")
    hs_30 = get_hotspots(mm_per_hr=30.0, top_k=50000)
    hs_60 = get_hotspots(mm_per_hr=60.0, top_k=50000)

    ids_30 = {f["id"] for f in hs_30["features"]}
    ids_60 = {f["id"] for f in hs_60["features"]}

    is_subset = ids_30.issubset(ids_60)
    print(f"Flooded hexes at 30 mm/hr: {len(ids_30)}")
    print(f"Flooded hexes at 60 mm/hr: {len(ids_60)}")
    print(f"Monotonicity verified (30mm subset of 60mm): {is_subset}")
    assert is_subset, "Monotonicity violation detected!"


def print_top_hotspots() -> None:
    """Display top 10 hotspots for 30 mm/hr and 60 mm/hr scenarios."""
    print("\n== 3. Top 10 Hotspots at 30 mm/hr =======================")
    res_30 = client.get("/hotspots?mm=30&top=10").json()["features"]
    for i, f in enumerate(res_30, 1):
        p = f["properties"]
        print(
            f"  {i:2d}. [Score: {p['score']:.3f} | Sev: {p['severity']:.2f} | "
            f"Trig: {p['trigger_mm']:.1f} mm] {p['nearest_place']} "
            f"({p['lat']:.4f}°N, {p['lon']:.4f}°E)\n"
            f"      Why: {p['why']}"
        )

    print("\n== 4. Top 10 Hotspots at 60 mm/hr =======================")
    res_60 = client.get("/hotspots?mm=60&top=10").json()["features"]
    for i, f in enumerate(res_60, 1):
        p = f["properties"]
        print(
            f"  {i:2d}. [Score: {p['score']:.3f} | Sev: {p['severity']:.2f} | "
            f"Trig: {p['trigger_mm']:.1f} mm] {p['nearest_place']} "
            f"({p['lat']:.4f}°N, {p['lon']:.4f}°E)\n"
            f"      Why: {p['why']}"
        )


def check_dev_sites() -> None:
    """Report score and rank for the 4 development sanity-check sites."""
    print("\n== 5. Known Dev Sites Check (Sanity Diagnostics) =======")
    df = get_scored_dataset()
    df["rank"] = df["score"].rank(ascending=False, method="min").astype(int)
    total_hexes = len(df)

    dev_sites = [
        ("Minto Bridge", 28.6358, 77.2278),
        ("ITO Junction", 28.6286, 77.2410),
        ("Hero Honda Chowk", 28.4313, 77.0178),
        ("Subhash Chowk", 28.4156, 77.0426),
    ]

    for name, lat, lon in dev_sites:
        cell_id = h3.latlng_to_cell(lat, lon, 9)
        matches = df[df["hex_id"] == cell_id]
        if not matches.empty:
            row = matches.iloc[0]
            pct = (total_hexes - int(row["rank"]) + 1) / total_hexes * 100
            print(
                f"\n[*] {name} ({lat:.4f}°N, {lon:.4f}°E)\n"
                f"    H3 Hex: {cell_id}\n"
                f"    Score: {row['score']:.4f} | Rank: {row['rank']}/{total_hexes} (Top {100-pct:.2f}%)\n"
                f"    Trigger Rainfall: {row['trigger_mm']:.1f} mm/hr\n"
                f"    Nearest OSM Feature: {row['nearest_place']}\n"
                f"    Why: {row['why']}"
            )


def main() -> None:
    """Run all validation checks."""
    test_api_latency()
    test_monotonicity()
    print_top_hotspots()
    check_dev_sites()


if __name__ == "__main__":
    main()
