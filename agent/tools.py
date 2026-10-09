"""FloodLens agent tools for Delhi-NCR urban drainage control room.

Provides tools for rainfall forecasts, waterlogging hotspot ranking,
place-specific risk assessments, greedy pump deployment planning,
and corridor routing risk analysis.
"""

import json
from pathlib import Path
from typing import Any
import h3
import numpy as np
import pandas as pd
import requests
from scipy.spatial import KDTree
from strands import tool

from engine.config import (
    BBOX_EAST,
    BBOX_NORTH,
    BBOX_SOUTH,
    BBOX_WEST,
    UNDERPASSES_FILE,
)
from engine.score import get_scored_dataset

# HTTP user agent for Nominatim and Open-Meteo
USER_AGENT = "FloodLens/1.0 (urban-flood-control-room)"

# In-memory tool execution tracer buffer
_RECORDED_TRACES: list[dict[str, Any]] = []


def record_tool_trace(
    tool_name: str,
    args: dict[str, Any],
    summary: str,
    data: dict[str, Any] | None = None,
) -> None:
    """Record an executed tool invocation with structured UI data payload."""
    _RECORDED_TRACES.append(
        {"tool": tool_name, "args": args, "summary": summary, "data": data or {}}
    )


def get_and_clear_traces() -> list[dict[str, Any]]:
    """Retrieve all recorded tool traces and clear the active buffer."""
    global _RECORDED_TRACES
    traces = list(_RECORDED_TRACES)
    _RECORDED_TRACES = []
    return traces


# Cached spatial index for OSM underpasses
_UNDERPASS_TREE: KDTree | None = None
_UNDERPASS_DATA: list[dict[str, Any]] | None = None
_UNDERPASS_MEAN_LAT: float = 28.5


def _get_underpass_index() -> tuple[KDTree, list[dict[str, Any]], float]:
    """Load and index OSM underpasses for distance queries."""
    global _UNDERPASS_TREE, _UNDERPASS_DATA, _UNDERPASS_MEAN_LAT
    if _UNDERPASS_TREE is not None and _UNDERPASS_DATA is not None:
        return _UNDERPASS_TREE, _UNDERPASS_DATA, _UNDERPASS_MEAN_LAT

    underpass_path = Path(UNDERPASSES_FILE)
    if not underpass_path.exists():
        # Fallback empty index if file not found
        dummy_pts = np.zeros((1, 2))
        _UNDERPASS_TREE = KDTree(dummy_pts)
        _UNDERPASS_DATA = [{"name": "Unknown", "highway": "unknown", "osm_id": 0}]
        return _UNDERPASS_TREE, _UNDERPASS_DATA, _UNDERPASS_MEAN_LAT

    with open(underpass_path, "r", encoding="utf-8") as f:
        geojson = json.load(f)

    pts = []
    records = []
    lats = []
    for feat in geojson.get("features", []):
        coords = feat["geometry"]["coordinates"]
        lon, lat = coords[0], coords[1]
        lats.append(lat)
        props = feat.get("properties", {})
        records.append(
            {
                "osm_id": props.get("osm_id", 0),
                "name": props.get("name", "Unnamed"),
                "highway": props.get("highway", "underpass"),
            }
        )

    _UNDERPASS_MEAN_LAT = float(np.mean(lats)) if lats else 28.5
    mean_lat_rad = np.radians(_UNDERPASS_MEAN_LAT)

    for feat in geojson.get("features", []):
        coords = feat["geometry"]["coordinates"]
        lon, lat = coords[0], coords[1]
        x = lon * 111320.0 * np.cos(mean_lat_rad)
        y = lat * 110540.0
        pts.append([x, y])

    _UNDERPASS_TREE = KDTree(np.array(pts))
    _UNDERPASS_DATA = records
    return _UNDERPASS_TREE, _UNDERPASS_DATA, _UNDERPASS_MEAN_LAT


def _geocode_location(place: str) -> dict[str, Any] | None:
    """Geocode a place name within the Delhi-NCR bounding box using Nominatim."""
    headers = {"User-Agent": USER_AGENT}
    viewbox_str = f"{BBOX_WEST},{BBOX_NORTH},{BBOX_EAST},{BBOX_SOUTH}"

    # 1. Bounded search within Delhi-NCR study area
    bounded_params = {
        "q": place,
        "format": "json",
        "limit": 1,
        "viewbox": viewbox_str,
        "bounded": 1,
    }
    try:
        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params=bounded_params,
            headers=headers,
            timeout=8,
        )
        data = resp.json()
        if data:
            item = data[0]
            lat = float(item["lat"])
            lon = float(item["lon"])
            if BBOX_SOUTH <= lat <= BBOX_NORTH and BBOX_WEST <= lon <= BBOX_EAST:
                return {
                    "lat": lat,
                    "lon": lon,
                    "display_name": item.get("display_name", place),
                }
    except Exception:
        pass

    # 2. Fallback search with explicit regional qualifier
    fallback_params = {
        "q": f"{place}, Delhi NCR, India",
        "format": "json",
        "limit": 1,
    }
    try:
        resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params=fallback_params,
            headers=headers,
            timeout=8,
        )
        data = resp.json()
        if data:
            item = data[0]
            lat = float(item["lat"])
            lon = float(item["lon"])
            return {
                "lat": lat,
                "lon": lon,
                "display_name": item.get("display_name", place),
            }
    except Exception:
        pass

    return None


@tool
def get_forecast(location: str) -> str:
    """Fetch Open-Meteo 48-hour precipitation forecast for a Delhi-NCR location.

    Returns peak hourly rainfall (mm/hr), peak timestamp, and 48-hour total mm.

    Args:
        location: Place name or city (e.g. 'Gurugram', 'Connaught Place', 'ITO').
    """
    geo = _geocode_location(location)
    if not geo:
        summary = f"Geocoding failed for '{location}'"
        record_tool_trace("get_forecast", {"location": location}, summary)
        return json.dumps(
            {"error": f"Could not geocode location '{location}' within Delhi-NCR."},
            separators=(",", ":"),
        )

    lat = geo["lat"]
    lon = geo["lon"]
    open_meteo_url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "precipitation",
        "forecast_days": 2,
    }

    try:
        resp = requests.get(open_meteo_url, params=params, timeout=10)
        resp_data = resp.json()
        hourly = resp_data.get("hourly", {})
        times = hourly.get("time", [])
        precip = hourly.get("precipitation", [])

        if not precip:
            summary = f"Open-Meteo returned no precipitation data for {location}"
            record_tool_trace("get_forecast", {"location": location}, summary)
            return json.dumps(
                {"error": f"Open-Meteo returned no data for {location}."},
                separators=(",", ":"),
            )

        max_val = float(max(precip))
        max_idx = precip.index(max_val)
        peak_time = times[max_idx] if max_idx < len(times) else "N/A"
        total_48h = float(sum(precip))

        result = {
            "location": location,
            "resolved_name": geo["display_name"],
            "lat": round(lat, 4),
            "lon": round(lon, 4),
            "peak_hourly_mm": round(max_val, 2),
            "peak_hour": peak_time,
            "total_mm_48h": round(total_48h, 2),
            "summary": (
                f"Peak: {max_val:.1f} mm/hr at {peak_time}; "
                f"48-hour total: {total_48h:.1f} mm"
            ),
        }
        summary = (
            f"Peak {result['peak_hourly_mm']} mm/hr at {peak_time}, "
            f"total {result['total_mm_48h']} mm"
        )
        data_payload = {
            "location": location,
            "lat": round(lat, 4),
            "lon": round(lon, 4),
            "peak_hourly_mm": round(max_val, 2),
            "peak_hour": peak_time,
            "total_mm_48h": round(total_48h, 2),
        }
        record_tool_trace(
            "get_forecast", {"location": location}, summary, data_payload
        )
        return json.dumps(result, separators=(",", ":"))
    except Exception as exc:
        err_msg = f"Failed to retrieve weather forecast: {str(exc)}"
        record_tool_trace("get_forecast", {"location": location}, err_msg)
        return json.dumps({"error": err_msg}, separators=(",", ":"))


@tool
def get_hotspots(
    mm_per_hr: float = 40.0,
    top_n: int = 25,
    city: str = "all",
) -> str:
    """Return ranked waterlogging hotspots for a given rainfall scenario in mm/hr.

    Args:
        mm_per_hr: Rainfall rate scenario in mm/hr (e.g. 30.0, 50.0, 60.0).
        top_n: Number of highest-severity hotspots to return (default 25).
        city: City filter ('delhi', 'gurugram', or 'all').
    """
    df = get_scored_dataset()

    # City filter partition
    city_lower = city.strip().lower()
    if city_lower in ("gurugram", "gurgaon"):
        city_mask = (df["lat"] <= 28.52) & (df["lon"] <= 77.12)
        filtered_df = df[city_mask].copy()
    elif city_lower in ("delhi", "new delhi"):
        city_mask = ~((df["lat"] <= 28.52) & (df["lon"] <= 77.12))
        filtered_df = df[city_mask].copy()
    else:
        filtered_df = df.copy()

    # Flooded condition: rainfall >= trigger threshold
    flooded = filtered_df[mm_per_hr >= filtered_df["trigger_mm"]].copy()
    total_flooded = int(len(flooded))

    if flooded.empty:
        result = {
            "rainfall_mm_hr": float(mm_per_hr),
            "city": city,
            "total_flooded_hexes": 0,
            "returned_count": 0,
            "hotspots": [],
            "message": f"No flooded spots detected for {mm_per_hr:.1f} mm/hr.",
        }
        summary = f"0 flooded spots at {mm_per_hr:.1f} mm/hr in {city}"
        record_tool_trace(
            "get_hotspots",
            {"mm_per_hr": mm_per_hr, "top_n": top_n, "city": city},
            summary,
        )
        return json.dumps(result, separators=(",", ":"))

    flooded["severity"] = np.round(mm_per_hr / flooded["trigger_mm"], 2)
    flooded.sort_values(
        by=["severity", "score"],
        ascending=[False, False],
        inplace=True,
    )
    top_slice = flooded.head(top_n)

    hotspots_list = []
    for _, row in top_slice.iterrows():
        hotspots_list.append(
            {
                "hex_id": row["hex_id"],
                "lat": round(float(row["lat"]), 4),
                "lon": round(float(row["lon"]), 4),
                "nearest_place": row["nearest_place"],
                "severity": float(row["severity"]),
                "trigger_mm": float(row["trigger_mm"]),
                "score": float(row["score"]),
                "why": row["why"],
            }
        )

    result = {
        "rainfall_mm_hr": float(mm_per_hr),
        "city": city,
        "total_flooded_hexes": total_flooded,
        "returned_count": len(hotspots_list),
        "hotspots": hotspots_list,
        "disclaimer": (
            "Relative uncalibrated susceptibility index "
            "for corridor-level (~1 km) planning."
        ),
    }
    data_payload = {
        "hex_ids": [h["hex_id"] for h in hotspots_list],
        "top_hotspots": hotspots_list,
        "rainfall_mm": float(mm_per_hr),
        "city": city,
    }
    record_tool_trace(
        "get_hotspots",
        {"mm_per_hr": mm_per_hr, "top_n": top_n, "city": city},
        summary,
        data_payload,
    )
    return json.dumps(result, separators=(",", ":"))


@tool
def check_place(place: str, mm_per_hr: float = 40.0) -> str:
    """Assess flood susceptibility and waterlogging trigger risk for a place.

    Returns the H3 hex score, citywide rank, trigger rainfall (mm/hr),
    flooding status at the scenario rainfall, and nearest underpass prior.

    Args:
        place: Specific landmark or locality (e.g. 'Minto Bridge', 'ITO').
        mm_per_hr: Rainfall scenario in mm/hr to evaluate against.
    """
    geo = _geocode_location(place)
    if not geo:
        err_msg = f"Could not geocode place '{place}' within Delhi-NCR."
        record_tool_trace(
            "check_place",
            {"place": place, "mm_per_hr": mm_per_hr},
            err_msg,
        )
        return json.dumps({"error": err_msg}, separators=(",", ":"))

    lat = geo["lat"]
    lon = geo["lon"]
    df = get_scored_dataset()

    # Find hex containing place coordinates
    target_cell = h3.latlng_to_cell(lat, lon, 9)
    matches = df[df["hex_id"] == target_cell]

    if matches.empty:
        # Fallback to nearest hex cell in dataset
        diff_sq = (df["lat"] - lat) ** 2 + (df["lon"] - lon) ** 2
        nearest_idx = diff_sq.idxmin()
        row = df.loc[nearest_idx]
    else:
        row = matches.iloc[0]

    # Calculate citywide rank by score descending
    score_val = float(row["score"])
    citywide_rank = int((df["score"] > score_val).sum() + 1)
    total_hexes = len(df)
    rank_percentile = round((1.0 - (citywide_rank / total_hexes)) * 100.0, 1)

    trigger_val = float(row["trigger_mm"])
    floods = bool(mm_per_hr >= trigger_val)
    severity_val = (
        round(mm_per_hr / trigger_val, 2) if floods else 0.0
    )

    # Nearest underpass distance query
    tree, underpass_records, mean_lat = _get_underpass_index()
    mean_lat_rad = np.radians(mean_lat)
    query_x = lon * 111320.0 * np.cos(mean_lat_rad)
    query_y = lat * 110540.0
    dist_m, up_idx = tree.query([query_x, query_y])
    nearest_up = underpass_records[up_idx]

    result = {
        "place": place,
        "resolved_name": geo["display_name"],
        "lat": round(lat, 4),
        "lon": round(lon, 4),
        "hex_id": row["hex_id"],
        "score": score_val,
        "citywide_rank": citywide_rank,
        "total_hexes": total_hexes,
        "percentile_risk": rank_percentile,
        "trigger_mm_per_hr": trigger_val,
        "scenario_mm_per_hr": float(mm_per_hr),
        "floods_at_scenario": floods,
        "scenario_severity": severity_val,
        "why": row["why"],
        "underpass_prior": int(row["underpass_prior"]),
        "nearest_underpass": {
            "name": nearest_up["name"],
            "highway": nearest_up["highway"],
            "distance_m": round(float(dist_m), 1),
        },
        "disclaimer": (
            "Relative uncalibrated susceptibility index "
            "for corridor-level (~1 km) planning."
        ),
    }

    status_str = f"FLOODS (sev={severity_val:.2f}x)" if floods else "NO FLOOD"
    summary = (
        f"{place}: score={score_val:.4f}, rank={citywide_rank}/{total_hexes}, "
        f"trigger={trigger_val:.1f} mm/hr, {status_str} at {mm_per_hr:.1f} mm/hr"
    )
    data_payload = {
        "place": place,
        "hex_id": row["hex_id"],
        "lat": round(lat, 4),
        "lon": round(lon, 4),
        "score": score_val,
        "citywide_rank": citywide_rank,
        "trigger_mm": trigger_val,
        "floods_at_scenario": floods,
        "nearest_place": row["nearest_place"],
    }
    record_tool_trace(
        "check_place",
        {"place": place, "mm_per_hr": mm_per_hr},
        summary,
        data_payload,
    )
    return json.dumps(result, separators=(",", ":"))


@tool
def pump_plan(
    n_pumps: int = 6,
    mm_per_hr: float = 60.0,
    radius_m: int = 1500,
) -> str:
    """Select optimal drainage pump deployment sites using greedy maximum-coverage.

    Prioritizes clusters of highest cumulative flood severity.

    Args:
        n_pumps: Number of portable drainage pumps available to deploy.
        mm_per_hr: Expected rainfall intensity in mm/hr.
        radius_m: Effective service radius per pump in meters (default 1500).
    """
    df = get_scored_dataset()

    # Filter flooded hexes
    flooded = df[mm_per_hr >= df["trigger_mm"]].copy()
    if flooded.empty:
        result = {
            "n_pumps_requested": n_pumps,
            "n_pumps_placed": 0,
            "rainfall_mm_hr": float(mm_per_hr),
            "radius_meters": radius_m,
            "total_flooded_hexes": 0,
            "covered_severity_share_pct": 0.0,
            "pumps": [],
            "message": f"No flooded hexes detected at {mm_per_hr:.1f} mm/hr.",
        }
        summary = f"0 pumps deployed; no flooded spots at {mm_per_hr:.1f} mm/hr"
        record_tool_trace(
            "pump_plan",
            {"n_pumps": n_pumps, "mm_per_hr": mm_per_hr, "radius_m": radius_m},
            summary,
        )
        return json.dumps(result, separators=(",", ":"))

    flooded["severity"] = np.round(mm_per_hr / flooded["trigger_mm"], 2)
    flooded.sort_values(by="severity", ascending=False, inplace=True)
    flooded.reset_index(drop=True, inplace=True)

    severities = flooded["severity"].to_numpy()
    total_flooded_severity = float(np.sum(severities))

    lats = flooded["lat"].to_numpy()
    lons = flooded["lon"].to_numpy()
    mean_lat_rad = np.radians(np.mean(lats))
    xs = lons * 111320.0 * np.cos(mean_lat_rad)
    ys = lats * 110540.0
    pts = np.column_stack([xs, ys])

    tree = KDTree(pts)
    # Consider top candidate sites (up to 1,000 highest-severity hexes)
    cand_count = min(len(flooded), 1000)
    candidate_pts = pts[:cand_count]
    candidate_neighbors = tree.query_ball_point(candidate_pts, r=float(radius_m))

    uncovered = set(range(len(flooded)))
    chosen_pumps = []

    for p in range(int(n_pumps)):
        if not uncovered:
            break
        best_cand_idx = -1
        best_gain = -1.0
        best_covered_set: list[int] = []

        for cand_idx in range(cand_count):
            cand_cov = [j for j in candidate_neighbors[cand_idx] if j in uncovered]
            gain = sum(severities[j] for j in cand_cov)
            if gain > best_gain:
                best_gain = gain
                best_cand_idx = cand_idx
                best_covered_set = cand_cov

        if best_cand_idx == -1 or best_gain <= 0:
            break

        uncovered.difference_update(best_covered_set)
        row = flooded.iloc[best_cand_idx]
        chosen_pumps.append(
            {
                "pump_id": p + 1,
                "hex_id": row["hex_id"],
                "lat": round(float(row["lat"]), 4),
                "lon": round(float(row["lon"]), 4),
                "nearest_place": row["nearest_place"],
                "site_severity": round(float(row["severity"]), 2),
                "hexes_covered_in_radius": len(best_covered_set),
                "severity_covered": round(float(best_gain), 2),
            }
        )

    covered_sev = total_flooded_severity - sum(severities[j] for j in uncovered)
    covered_share = (
        (covered_sev / total_flooded_severity * 100.0)
        if total_flooded_severity > 0
        else 0.0
    )

    result = {
        "n_pumps_requested": int(n_pumps),
        "n_pumps_placed": len(chosen_pumps),
        "rainfall_mm_hr": float(mm_per_hr),
        "radius_meters": int(radius_m),
        "total_flooded_hexes": len(flooded),
        "covered_severity_share_pct": round(covered_share, 1),
        "pumps": chosen_pumps,
        "heuristic_note": (
            f"Greedy maximum-coverage heuristic with {radius_m}m service radius. "
            "Real-world pump deployment requires site-specific drainage outfall "
            "access, electrical/diesel suction infrastructure, and discharge paths."
        ),
    }

    summary = (
        f"Placed {len(chosen_pumps)} pumps covering "
        f"{round(covered_share, 1)}% of flooded severity at {mm_per_hr:.1f} mm/hr"
    )
    data_payload = {
        "pumps": [
            {
                "pump_id": p["pump_id"],
                "hex_id": p["hex_id"],
                "lat": p["lat"],
                "lon": p["lon"],
                "radius_m": int(radius_m),
                "site_severity": p["site_severity"],
                "nearest_place": p["nearest_place"],
            }
            for p in chosen_pumps
        ],
        "radius_m": int(radius_m),
        "rainfall_mm_hr": float(mm_per_hr),
        "covered_severity_share_pct": round(covered_share, 1),
    }
    record_tool_trace(
        "pump_plan",
        {"n_pumps": n_pumps, "mm_per_hr": mm_per_hr, "radius_m": radius_m},
        summary,
        data_payload,
    )
    return json.dumps(result, separators=(",", ":"))


@tool
def route_risk(origin: str, destination: str) -> str:
    """Assess flood risk along a driving corridor between two locations via OSRM.

    Samples road coordinates, projects onto H3 hexes, and identifies
    top flood risk points.

    Args:
        origin: Starting location (e.g. 'Connaught Place').
        destination: Destination location (e.g. 'Cyber City Gurugram').
    """
    o_geo = _geocode_location(origin)
    d_geo = _geocode_location(destination)

    if not o_geo:
        err_msg = f"Could not geocode origin '{origin}' in Delhi-NCR."
        record_tool_trace(
            "route_risk",
            {"origin": origin, "destination": destination},
            err_msg,
        )
        return json.dumps({"error": err_msg}, separators=(",", ":"))

    if not d_geo:
        err_msg = f"Could not geocode destination '{destination}' in Delhi-NCR."
        record_tool_trace(
            "route_risk",
            {"origin": origin, "destination": destination},
            err_msg,
        )
        return json.dumps({"error": err_msg}, separators=(",", ":"))

    # Query public OSRM demo route
    osrm_url = (
        f"https://router.project-osrm.org/route/v1/driving/"
        f"{o_geo['lon']},{o_geo['lat']};{d_geo['lon']},{d_geo['lat']}"
        f"?overview=full&geometries=geojson"
    )

    try:
        resp = requests.get(osrm_url, timeout=10)
        resp_data = resp.json()
        if resp_data.get("code") != "Ok" or not resp_data.get("routes"):
            err_msg = (
                "OSRM routing service unavailable or returned no valid route. "
                "Route geometry cannot be computed without road network."
            )
            record_tool_trace(
                "route_risk",
                {"origin": origin, "destination": destination},
                err_msg,
            )
            return json.dumps({"error": err_msg}, separators=(",", ":"))

        route = resp_data["routes"][0]
        coords = route.get("geometry", {}).get("coordinates", [])
        dist_km = round(route.get("distance", 0.0) / 1000.0, 2)
        dur_min = round(route.get("duration", 0.0) / 60.0, 1)

        # Sample coordinates to H3 hexes
        seen_cells: list[str] = []
        seen_set: set[str] = set()
        for pt in coords:
            c_lon, c_lat = pt[0], pt[1]
            cell = h3.latlng_to_cell(c_lat, c_lon, 9)
            if cell not in seen_set:
                seen_set.add(cell)
                seen_cells.append(cell)

        df = get_scored_dataset()
        route_df = df[df["hex_id"].isin(seen_set)].copy()
        route_df.sort_values(by="score", ascending=False, inplace=True)

        top_risk_spots = []
        for _, row in route_df.head(5).iterrows():
            top_risk_spots.append(
                {
                    "hex_id": row["hex_id"],
                    "lat": round(float(row["lat"]), 4),
                    "lon": round(float(row["lon"]), 4),
                    "score": float(row["score"]),
                    "trigger_mm": float(row["trigger_mm"]),
                    "nearest_place": row["nearest_place"],
                    "why": row["why"],
                }
            )

        max_score = float(route_df["score"].max()) if not route_df.empty else 0.0
        min_trigger = (
            float(route_df["trigger_mm"].min()) if not route_df.empty else 100.0
        )

        result = {
            "origin": origin,
            "origin_resolved": o_geo["display_name"],
            "destination": destination,
            "destination_resolved": d_geo["display_name"],
            "corridor_distance_km": dist_km,
            "estimated_duration_min": dur_min,
            "corridor_unique_hexes": len(seen_cells),
            "max_susceptibility_score": max_score,
            "lowest_trigger_mm_per_hr": min_trigger,
            "top_risk_spots": top_risk_spots,
            "disclaimer": (
                "Relative uncalibrated susceptibility index "
                "for corridor-level (~1 km) planning."
            ),
        }

        summary = (
            f"Corridor {dist_km} km ({len(seen_cells)} hexes): "
            f"max score={max_score:.3f}, min trigger={min_trigger:.1f} mm/hr"
        )
        data_payload = {
            "origin": origin,
            "destination": destination,
            "route_coordinates": coords,
            "corridor_distance_km": dist_km,
            "estimated_duration_min": dur_min,
            "top_risk_hexes": top_risk_spots,
        }
        record_tool_trace(
            "route_risk",
            {"origin": origin, "destination": destination},
            summary,
            data_payload,
        )
        return json.dumps(result, separators=(",", ":"))
    except Exception as exc:
        err_msg = (
            f"OSRM service request failed: {str(exc)}. "
            "Route geometry cannot be computed without road network."
        )
        record_tool_trace(
            "route_risk",
            {"origin": origin, "destination": destination},
            err_msg,
        )
        return json.dumps({"error": err_msg}, separators=(",", ":"))
