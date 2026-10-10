"""FloodLens H3 hexagonal spatial aggregation and susceptibility scoring.

Aggregates 30m raster layers and OSM underpass priors into an Uber H3 res-9 grid,
normalises features by percentile rank, computes composite flood susceptibility,
and calculates rainfall trigger thresholds (mm/hr) and scenario severities.
"""

import json
import math
import sys
import time
from pathlib import Path
from typing import Any

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import h3
import numpy as np
import pandas as pd
import rasterio
import rasterio.features
from scipy.ndimage import maximum, mean, minimum
from scipy.spatial import KDTree
import shapely.geometry

from engine.config import (
    BBOX_EAST,
    BBOX_NORTH,
    BBOX_SOUTH,
    BBOX_WEST,
    BUILTUP_FILE,
    DEM_FILE,
    DERIVED_DIR,
    H3_RESOLUTION,
    HEX_FEATURES_FILE,
    K,
    R_REF,
    UNCALIBRATED_DISCLAIMER,
    UNDERPASSES_FILE,
    WEIGHTS,
)


def generate_bbox_h3_cells(resolution: int = H3_RESOLUTION) -> list[str]:
    """Generate all H3 hex cells of the given resolution covering the study bbox."""
    bbox_poly = h3.LatLngPoly(
        [
            (BBOX_SOUTH, BBOX_WEST),
            (BBOX_NORTH, BBOX_WEST),
            (BBOX_NORTH, BBOX_EAST),
            (BBOX_SOUTH, BBOX_EAST),
        ]
    )
    return list(h3.polygon_to_cells(bbox_poly, resolution))


def build_hex_features(force_recompute: bool = False) -> pd.DataFrame:
    """Aggregate raster layers and OSM priors into H3 res-9 hexes and cache."""
    if HEX_FEATURES_FILE.exists() and not force_recompute:
        print(f"Loading cached hex features from {HEX_FEATURES_FILE.name}...")
        df = pd.read_parquet(HEX_FEATURES_FILE)
        _report_feature_availability(df)
        return df

    print("Generating H3 res-9 cells covering Delhi-Gurgaon bounding box...")
    t0 = time.time()
    cells = generate_bbox_h3_cells(H3_RESOLUTION)
    n_cells = len(cells)
    print(f"Generated {n_cells} hex cells in {time.time() - t0:.2f}s")

    # Read grid dimensions from reference DEM
    with rasterio.open(str(DEM_FILE)) as src:
        transform = src.transform
        out_shape = (src.height, src.width)
        dem_arr = src.read(1)

    print("Rasterizing H3 polygons onto DEM grid...")
    t1 = time.time()
    shapes = []
    cell_polygons: list[list[list[float]]] = []
    lats: list[float] = []
    lons: list[float] = []

    for idx, cell in enumerate(cells):
        lat, lon = h3.cell_to_latlng(cell)
        lats.append(lat)
        lons.append(lon)
        # Boundary returns list of (lat, lon) tuples -> convert to (lon, lat)
        boundary = h3.cell_to_boundary(cell)
        coords = [[pt[1], pt[0]] for pt in boundary]
        coords.append(coords[0])  # Close polygon ring
        cell_polygons.append(coords)
        shapes.append((shapely.geometry.Polygon(coords), idx))

    hex_raster = rasterio.features.rasterize(
        shapes,
        out_shape=out_shape,
        transform=transform,
        fill=-1,
        dtype=np.int32,
    )
    print(f"Rasterized in {time.time() - t1:.2f}s")

    cell_indices = np.arange(n_cells)

    # 1. Elevation
    print("Aggregating mean elevation...")
    mean_elev = mean(dem_arr, labels=hex_raster, index=cell_indices)

    # 2. Built-up fraction
    print("Aggregating mean built-up fraction...")
    with rasterio.open(str(BUILTUP_FILE)) as src:
        builtup_arr = src.read(1)
    mean_builtup = mean(builtup_arr, labels=hex_raster, index=cell_indices)
    mean_builtup = np.nan_to_num(mean_builtup, nan=0.0)

    # 3. HAND (min elevation above drainage)
    print("Aggregating min HAND...")
    with rasterio.open(str(DERIVED_DIR / "hand.tif")) as src:
        hand_arr = src.read(1)
    min_hand = minimum(hand_arr, labels=hex_raster, index=cell_indices)
    min_hand = np.nan_to_num(min_hand, nan=0.0)

    # 4. TWI (max topographic wetness)
    print("Aggregating max TWI...")
    with rasterio.open(str(DERIVED_DIR / "twi.tif")) as src:
        twi_arr = src.read(1)
    max_twi = maximum(twi_arr, labels=hex_raster, index=cell_indices)
    max_twi = np.nan_to_num(max_twi, nan=0.0)

    # 5. Depression depth (max filled minus original)
    print("Aggregating max depression depth...")
    with rasterio.open(str(DERIVED_DIR / "depression_depth.tif")) as src:
        depth_arr = src.read(1)
    max_depth = maximum(depth_arr, labels=hex_raster, index=cell_indices)
    max_depth = np.nan_to_num(max_depth, nan=0.0)

    # 6. Flow accumulation (log10 of max)
    print("Aggregating max flow accumulation...")
    with rasterio.open(str(DERIVED_DIR / "flow_accumulation.tif")) as src:
        acc_arr = src.read(1)
    max_acc = maximum(acc_arr, labels=hex_raster, index=cell_indices)
    log10_max_acc = np.log10(np.maximum(max_acc, 0.0) + 1.0)
    log10_max_acc = np.nan_to_num(log10_max_acc, nan=0.0)

    # 7. OSM Underpass Priors & Nearest Feature Reverse Lookup
    print("Linking OSM underpass priors and nearest names...")
    underpass_prior, nearest_places = _match_underpass_priors(
        lats, lons, UNDERPASSES_FILE
    )

    df = pd.DataFrame(
        {
            "hex_id": cells,
            "lat": lats,
            "lon": lons,
            "polygon": [json.dumps(p) for p in cell_polygons],
            "elevation_m": mean_elev.astype(np.float32),
            "builtup_fraction": mean_builtup.astype(np.float32),
            "min_hand": min_hand.astype(np.float32),
            "max_twi": max_twi.astype(np.float32),
            "max_depression_depth": max_depth.astype(np.float32),
            "log10_max_flow_acc": log10_max_acc.astype(np.float32),
            "underpass_prior": underpass_prior.astype(np.int32),
            "nearest_place": nearest_places,
        }
    )

    print(f"Saving {len(df)} hex records to {HEX_FEATURES_FILE}...")
    df.to_parquet(HEX_FEATURES_FILE, index=False)
    _report_feature_availability(df)
    return df


def _match_underpass_priors(
    lats: list[float], lons: list[float], geojson_path: Path
) -> tuple[np.ndarray, list[str]]:
    """Flag hexes within ~150 m of an OSM underpass and lookup nearest place."""
    n_cells = len(lats)
    underpass_prior = np.zeros(n_cells, dtype=np.int32)
    nearest_places = [""] * n_cells

    if not geojson_path.exists():
        print(f"Warning: {geojson_path} not found. Skipping underpass prior.")
        return underpass_prior, nearest_places

    with open(geojson_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    features = data.get("features", [])
    if not features:
        return underpass_prior, nearest_places

    # Projected equirectangular coords in meters
    lat_scale = 111139.0
    lon_scale = 111139.0 * math.cos(math.radians(28.60))

    hex_coords = np.column_stack(
        [np.array(lons) * lon_scale, np.array(lats) * lat_scale]
    )
    hex_tree = KDTree(hex_coords)

    underpass_pts = []
    underpass_names = []
    for feat in features:
        coords = feat["geometry"]["coordinates"]
        name = feat["properties"].get("name", "")
        if not name or name == "Unnamed":
            hwy = feat["properties"].get("highway", "underpass")
            name = f"{hwy.replace('_', ' ').title()} underpass"
        underpass_pts.append([coords[0] * lon_scale, coords[1] * lat_scale])
        underpass_names.append(name)

    underpass_arr = np.array(underpass_pts)

    # 1. Tag hexes within 174m (res-9 hex radius) as having underpass prior
    matched_indices = hex_tree.query_ball_point(underpass_arr, r=174.0)
    for i, hex_list in enumerate(matched_indices):
        name = underpass_names[i]
        for h_idx in hex_list:
            underpass_prior[h_idx] = 1
            if not nearest_places[h_idx]:
                nearest_places[h_idx] = name

    # 2. For remaining hexes, populate reverse lookup with nearest named underpass
    up_tree = KDTree(underpass_arr)
    dists, nearest_up_indices = up_tree.query(hex_coords)

    for h_idx in range(n_cells):
        if not nearest_places[h_idx]:
            dist_m = int(round(dists[h_idx]))
            nearest_name = underpass_names[nearest_up_indices[h_idx]]
            nearest_places[h_idx] = f"{nearest_name} ({dist_m}m)"
        else:
            nearest_places[h_idx] = f"{nearest_places[h_idx]} (<150m)"

    return underpass_prior, nearest_places


def _report_feature_availability(df: pd.DataFrame) -> None:
    """Print the count and percentage of hexes with each feature available."""
    n_total = len(df)
    print("\n== Hex Feature Availability Report ==================")
    print(f"Total H3 res-9 cells: {n_total}")
    print(
        f"Mean elevation: {np.sum(~df['elevation_m'].isna())}/{n_total} "
        f"({np.sum(~df['elevation_m'].isna())/n_total*100:.1f}%)"
    )
    print(
        f"Built-up fraction: {np.sum(df['builtup_fraction'] > 0)}/{n_total} "
        f"({np.sum(df['builtup_fraction'] > 0)/n_total*100:.1f}%)"
    )
    print(
        f"HAND min <= 2m (lowland): {np.sum(df['min_hand'] <= 2.0)}/{n_total} "
        f"({np.sum(df['min_hand'] <= 2.0)/n_total*100:.1f}%)"
    )
    print(
        f"TWI max: {np.sum(df['max_twi'] > 0)}/{n_total} "
        f"({np.sum(df['max_twi'] > 0)/n_total*100:.1f}%)"
    )
    print(
        f"Depression depth > 0: {np.sum(df['max_depression_depth'] > 0)}/{n_total} "
        f"({np.sum(df['max_depression_depth'] > 0)/n_total*100:.1f}%)"
    )
    print(
        f"Flow acc > 100 cells: {np.sum(df['log10_max_flow_acc'] >= 2.0)}/{n_total} "
        f"({np.sum(df['log10_max_flow_acc'] >= 2.0)/n_total*100:.1f}%)"
    )
    print(
        f"OSM underpass prior == 1: {np.sum(df['underpass_prior'] == 1)}/{n_total} "
        f"({np.sum(df['underpass_prior'] == 1)/n_total*100:.1f}%)"
    )
    print("=====================================================\n")


def compute_scores(df: pd.DataFrame) -> pd.DataFrame:
    """Compute normalized composite susceptibility score and trigger rainfall."""
    scored = df.copy()

    # 1. Percentile rank normalisation across the bounding box
    p_hand = scored["min_hand"].rank(pct=True).to_numpy()
    p_hand_inv = 1.0 - p_hand  # Lower HAND = closer to drainage = higher risk

    p_twi = scored["max_twi"].rank(pct=True).to_numpy()
    p_flow_acc = scored["log10_max_flow_acc"].rank(pct=True).to_numpy()
    p_builtup = scored["builtup_fraction"].rank(pct=True).to_numpy()
    p_depth = scored["max_depression_depth"].rank(pct=True).to_numpy()
    p_underpass = scored["underpass_prior"].astype(float).to_numpy()

    # 2. Weighted sum
    w = WEIGHTS
    s_raw = (
        w["hand_inv"] * p_hand_inv
        + w["twi"] * p_twi
        + w["flow_acc"] * p_flow_acc
        + w["builtup"] * p_builtup
        + w["depression_depth"] * p_depth
        + w["underpass_prior"] * p_underpass
    )

    # Scale strictly to [0.0, 1.0]
    s_min, s_max = float(s_raw.min()), float(s_raw.max())
    s_norm = (s_raw - s_min) / (s_max - s_min) if s_max > s_min else s_raw

    scored["score"] = np.round(s_norm, 4)

    # 3. Trigger rainfall: R_i = R_REF * exp(-K * S_i)
    # Hexes with higher susceptibility have lower trigger rainfall
    trigger_mm = R_REF * np.exp(-K * s_norm)
    scored["trigger_mm"] = np.round(trigger_mm, 2)

    # 4. Generate plain-words "why" explanations
    whys: list[str] = []
    for i in range(len(scored)):
        factors: list[tuple[float, str]] = []

        if p_underpass[i] > 0.5:
            factors.append((w["underpass_prior"] * 1.5, "underpass (below street level) prior"))

        hand_val = float(scored["min_hand"].iloc[i])
        hand_disp = 0.0 if abs(hand_val) < 0.05 else hand_val
        if p_hand_inv[i] >= 0.70:
            factors.append(
                (w["hand_inv"] * p_hand_inv[i], f"Low drainage clearance (HAND {hand_disp:.1f}m)")
            )

        twi_val = float(scored["max_twi"].iloc[i])
        if p_twi[i] >= 0.70:
            factors.append(
                (w["twi"] * p_twi[i], f"High topographic wetness (TWI {twi_val:.1f})")
            )

        builtup_pct = int(round(float(scored["builtup_fraction"].iloc[i]) * 100))
        if p_builtup[i] >= 0.60:
            factors.append(
                (w["builtup"] * p_builtup[i], f"Built-up share ({builtup_pct}%)")
            )

        if p_flow_acc[i] >= 0.75:
            factors.append(
                (w["flow_acc"] * p_flow_acc[i], "Converging upstream storm runoff")
            )

        depth_val = float(scored["max_depression_depth"].iloc[i])
        if depth_val >= 0.30:
            factors.append(
                (w["depression_depth"] * p_depth[i], f"Terrain sink bowl ({depth_val:.1f}m deep)")
            )

        # Sort by impact and take top 2-3
        factors.sort(key=lambda item: item[0], reverse=True)
        top_reasons = [item[1] for item in factors[:3]]
        if not top_reasons:
            top_reasons = ["Moderate drainage baseline"]

        whys.append("; ".join(top_reasons))

    scored["why"] = whys
    return scored


# In-memory cache for fast sub-second API responses
_CACHED_SCORED_DF: pd.DataFrame | None = None


def get_scored_dataset() -> pd.DataFrame:
    """Retrieve scored dataset, loading and computing if not in memory."""
    global _CACHED_SCORED_DF
    if _CACHED_SCORED_DF is None:
        features_df = build_hex_features()
        _CACHED_SCORED_DF = compute_scores(features_df)
    return _CACHED_SCORED_DF


def get_hotspots(
    mm_per_hr: float = 40.0,
    top_k: int = 25,
    city: str = "all",
) -> dict[str, Any]:
    """Return GeoJSON FeatureCollection of top flooded hexes for a rainfall scenario."""
    df = get_scored_dataset()

    city_lower = city.strip().lower()
    if city_lower in ("gurugram", "gurgaon"):
        city_mask = (df["lat"] <= 28.52) & (df["lon"] <= 77.12)
        filtered_df = df[city_mask].copy()
    elif city_lower in ("delhi", "new delhi"):
        city_mask = ~((df["lat"] <= 28.52) & (df["lon"] <= 77.12))
        filtered_df = df[city_mask].copy()
    else:
        filtered_df = df.copy()

    # Flooded condition: rainfall scenario >= hex trigger threshold
    flooded_mask = mm_per_hr >= filtered_df["trigger_mm"]
    flooded = filtered_df[flooded_mask].copy()

    total_flooded = int(len(flooded))

    if not flooded.empty:
        # Severity = mm / trigger_mm
        flooded["severity"] = np.round(mm_per_hr / flooded["trigger_mm"], 2)
        flooded.sort_values(by=["severity", "score"], ascending=[False, False], inplace=True)
        top_slice = flooded.head(top_k)
    else:
        top_slice = pd.DataFrame()

    features = []
    for _, row in top_slice.iterrows():
        polygon_coords = json.loads(row["polygon"])
        feat = {
            "type": "Feature",
            "id": row["hex_id"],
            "geometry": {
                "type": "Polygon",
                "coordinates": [polygon_coords],
            },
            "properties": {
                "hex_id": row["hex_id"],
                "score": float(row["score"]),
                "severity": float(row["severity"]),
                "trigger_mm": float(row["trigger_mm"]),
                "why": row["why"],
                "lat": float(row["lat"]),
                "lon": float(row["lon"]),
                "elevation_m": float(row["elevation_m"]),
                "nearest_place": row["nearest_place"],
            },
        }
        features.append(feat)

    return {
        "type": "FeatureCollection",
        "metadata": {
            "rainfall_mm": float(mm_per_hr),
            "top_k": int(top_k),
            "returned_count": len(features),
            "total_flooded_hexes": total_flooded,
            "disclaimer": UNCALIBRATED_DISCLAIMER,
        },
        "features": features,
    }


def main() -> None:
    """Execute hex feature building and display validation diagnostics."""
    print("==================================================")
    print("FloodLens Hex Aggregation & Scoring Pipeline")
    print("==================================================")
    df = build_hex_features()
    scored = compute_scores(df)

    print("\nSummary of Scored Hexes:")
    print(f"Total hexes: {len(scored)}")
    print(f"Susceptibility Score min: {scored['score'].min():.4f}, max: {scored['score'].max():.4f}, mean: {scored['score'].mean():.4f}")
    print(f"Trigger rainfall min: {scored['trigger_mm'].min():.2f} mm/hr, max: {scored['trigger_mm'].max():.2f} mm/hr")

    # Monotonicity test
    print("\nTesting monotonicity (30 mm vs 60 mm)...")
    hs_30 = get_hotspots(mm_per_hr=30.0, top_k=len(scored))
    hs_60 = get_hotspots(mm_per_hr=60.0, top_k=len(scored))

    set_30 = {f["id"] for f in hs_30["features"]}
    set_60 = {f["id"] for f in hs_60["features"]}

    is_superset = set_30.issubset(set_60)
    print(f"Flooded hexes at 30 mm: {len(set_30)}")
    print(f"Flooded hexes at 60 mm: {len(set_60)}")
    print(f"Monotonicity verified (30mm subset of 60mm): {is_superset}")

    # Top 10 at 30 mm
    print("\nTop 10 Hotspots at 30 mm/hr:")
    top10_30 = get_hotspots(mm_per_hr=30.0, top_k=10)["features"]
    for i, h in enumerate(top10_30, 1):
        p = h["properties"]
        print(f"  {i:2d}. [{p['score']:.3f} | sev={p['severity']:.2f} | trig={p['trigger_mm']:.1f}mm] {p['nearest_place']} ({p['lat']:.4f}, {p['lon']:.4f}) -> {p['why']}")

    # Top 10 at 60 mm
    print("\nTop 10 Hotspots at 60 mm/hr:")
    top10_60 = get_hotspots(mm_per_hr=60.0, top_k=10)["features"]
    for i, h in enumerate(top10_60, 1):
        p = h["properties"]
        print(f"  {i:2d}. [{p['score']:.3f} | sev={p['severity']:.2f} | trig={p['trigger_mm']:.1f}mm] {p['nearest_place']} ({p['lat']:.4f}, {p['lon']:.4f}) -> {p['why']}")


if __name__ == "__main__":
    main()
