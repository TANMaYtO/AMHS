"""Terrain hydrological analysis module for FloodLens.

Computes terrain indices from Copernicus DEM using pysheds:
- Filled DEM & Depression depth (with DSM surface noise thresholding)
- D8 Flow direction & Flow accumulation
- Slope & Topographic Wetness Index (TWI)
- Height Above Nearest Drainage (HAND)
- Preview visualization PNGs and validation hotspot queries.
"""

import sys
from pathlib import Path
from typing import Any

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

# Compatibility shim: NumPy 2.0+ removed np.in1d in favor of np.isin,
# which pysheds 0.5 still calls in d8 accumulation routines.
if not hasattr(np, "in1d"):
    np.in1d = np.isin

from pysheds.grid import Grid
import rasterio
from scipy.ndimage import gaussian_filter

from engine.config import (
    DEM_FILE,
    DEM_SMOOTHING_SIGMA,
    DERIVED_DIR,
    HAND_ACCUMULATION_THRESHOLD,
    MIN_DEPRESSION_DEPTH_M,
)

VALIDATION_SPOTS: list[dict[str, Any]] = [
    {
        "name": "Minto Bridge Underpass",
        "lat": 28.6358,
        "lon": 77.2278,
        "desc": "Famous perennial New Delhi railway underpass sink",
    },
    {
        "name": "ITO Junction",
        "lat": 28.6286,
        "lon": 77.2410,
        "desc": "Major East/Central Delhi transit bottleneck near Yamuna",
    },
    {
        "name": "Hero Honda Chowk (NH-48 Gurgaon)",
        "lat": 28.4313,
        "lon": 77.0178,
        "desc": "Gurugram Badshahpur drain overflow / highway depression",
    },
    {
        "name": "Subhash Chowk (Sohna Road Gurgaon)",
        "lat": 28.4156,
        "lon": 77.0426,
        "desc": "Key intersection prone to rapid surface ponding",
    },
]


def load_and_preprocess_dem(
    dem_path: Path, smoothing_sigma: float = DEM_SMOOTHING_SIGMA
) -> tuple[Grid, Any, dict[str, Any]]:
    """Load DEM via pysheds Grid, with optional light Gaussian smoothing."""
    grid = Grid.from_raster(str(dem_path))
    dem = grid.read_raster(str(dem_path))

    with rasterio.open(str(dem_path)) as src:
        meta = src.meta.copy()

    # Apply light Gaussian smoothing to suppress micro-scale DSM building noise
    if smoothing_sigma > 0.0:
        print(f"Applying Gaussian smoothing (sigma={smoothing_sigma:.2f})...")
        dem[:] = gaussian_filter(dem, sigma=smoothing_sigma)

    return grid, dem, meta


def compute_terrain_indices(
    dem_path: Path = DEM_FILE,
) -> dict[str, Any]:
    """Compute filled DEM, depression depth, flow accumulation, HAND, and TWI."""
    print("Loading DEM into pysheds grid...")
    grid, dem, meta = load_and_preprocess_dem(dem_path)

    print("Filling depressions (pit filling)...")
    flooded = grid.fill_depressions(dem)

    print("Resolving flats...")
    resolved = grid.resolve_flats(flooded)

    print("Computing depression depth...")
    raw_depth = np.maximum(0.0, flooded - dem)
    # Apply minimum depression depth threshold to suppress DSM canopy/roof noise
    filtered_depth = np.where(raw_depth >= MIN_DEPRESSION_DEPTH_M, raw_depth, 0.0)

    print("Computing D8 flow direction...")
    fdir = grid.flowdir(resolved)

    print("Computing flow accumulation...")
    acc = grid.accumulation(fdir)

    print("Computing cell slopes...")
    raw_slope = grid.cell_slopes(dem, fdir)
    # Clean slope values (finite and non-negative)
    slope = np.nan_to_num(raw_slope, nan=0.001)
    slope = np.maximum(slope, 0.001)

    print("Computing Topographic Wetness Index (TWI)...")
    # Specific catchment area a = (acc + 1) * cell_size (~30 m)
    cell_size_m = 30.0
    a = (acc + 1.0) * cell_size_m
    twi = np.log(a / np.tan(np.maximum(slope, 0.001)))
    twi = np.nan_to_num(twi, nan=0.0, posinf=25.0, neginf=0.0)

    print(f"Computing HAND (drainage threshold = {HAND_ACCUMULATION_THRESHOLD})...")
    stream_mask = acc >= HAND_ACCUMULATION_THRESHOLD
    hand = grid.compute_hand(fdir, dem, stream_mask)
    hand = np.nan_to_num(hand, nan=0.0)

    results = {
        "dem": dem,
        "dem_filled": flooded,
        "depression_depth": filtered_depth,
        "flow_direction": fdir,
        "flow_accumulation": acc,
        "slope": slope,
        "twi": twi,
        "hand": hand,
        "meta": meta,
        "grid": grid,
    }

    _save_derived_rasters(results)
    return results


def _save_derived_rasters(results: dict[str, Any]) -> None:
    """Save all derived terrain index arrays to GeoTIFF files."""
    meta = results["meta"].copy()
    meta.update({"compress": "lzw"})

    layers = [
        ("dem_filled.tif", results["dem_filled"], "float32"),
        ("depression_depth.tif", results["depression_depth"], "float32"),
        ("flow_direction.tif", results["flow_direction"], "int32"),
        ("flow_accumulation.tif", results["flow_accumulation"], "float32"),
        ("slope.tif", results["slope"], "float32"),
        ("twi.tif", results["twi"], "float32"),
        ("hand.tif", results["hand"], "float32"),
    ]

    for fname, arr, dtype in layers:
        out_path = DERIVED_DIR / fname
        layer_meta = meta.copy()
        layer_meta.update({"dtype": dtype, "nodata": -9999.0 if "float" in dtype else 0})
        with rasterio.open(str(out_path), "w", **layer_meta) as dst:
            dst.write(arr.astype(dtype), 1)
        print(f"Saved: {out_path.name}")


def generate_preview_maps(results: dict[str, Any]) -> None:
    """Generate and save PNG preview visualizations of key terrain layers."""
    print("Generating preview PNG maps in data/derived/...")

    # 1. Depression Depth Preview
    depth = results["depression_depth"]
    fig, ax = plt.subplots(figsize=(10, 8), dpi=150)
    im = ax.imshow(
        depth,
        cmap="Blues",
        vmax=np.percentile(depth[depth > 0], 98) if np.any(depth > 0) else 5.0,
    )
    ax.set_title("FloodLens - Terrain Depression Depth (m)\n(Threshold >= 0.25 m)")
    plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04, label="Depth (m)")
    plt.tight_layout()
    p1 = DERIVED_DIR / "preview_depression_depth.png"
    plt.savefig(p1)
    plt.close()
    print(f"Saved: {p1.name}")

    # 2. Log10 Flow Accumulation Preview
    acc = results["flow_accumulation"]
    log_acc = np.log10(np.maximum(acc, 0.0) + 1.0)
    fig, ax = plt.subplots(figsize=(10, 8), dpi=150)
    im = ax.imshow(log_acc, cmap="Blues", vmin=0, vmax=np.percentile(log_acc, 99))
    ax.set_title("FloodLens - Flow Accumulation (Log10 cells)")
    plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04, label="Log10(cells + 1)")
    plt.tight_layout()
    p2 = DERIVED_DIR / "preview_flow_accumulation.png"
    plt.savefig(p2)
    plt.close()
    print(f"Saved: {p2.name}")

    # 3. HAND Preview
    hand = results["hand"]
    fig, ax = plt.subplots(figsize=(10, 8), dpi=150)
    im = ax.imshow(hand, cmap="YlGnBu_r", vmin=0, vmax=np.percentile(hand, 95))
    ax.set_title("FloodLens - Height Above Nearest Drainage (HAND, m)")
    plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04, label="HAND (m)")
    plt.tight_layout()
    p3 = DERIVED_DIR / "preview_hand.png"
    plt.savefig(p3)
    plt.close()
    print(f"Saved: {p3.name}")


def validate_known_hotspots(results: dict[str, Any]) -> None:
    """Inspect and report terrain layer values at known waterlogging locations."""
    meta = results["meta"]
    transform = meta["transform"]
    inv_transform = ~transform

    dem = results["dem"]
    depth = results["depression_depth"]
    acc = results["flow_accumulation"]
    hand = results["hand"]
    twi = results["twi"]

    print("\n==================================================")
    print("VALIDATION: Known Waterlogging Hotspots Check")
    print("==================================================")

    for spot in VALIDATION_SPOTS:
        name = spot["name"]
        lat = spot["lat"]
        lon = spot["lon"]
        desc = spot["desc"]

        # Convert lon, lat to pixel col, row
        col_f, row_f = inv_transform * (lon, lat)
        col, row = int(round(col_f)), int(round(row_f))

        h, w = dem.shape
        if 0 <= row < h and 0 <= col < w:
            # Also check a 3x3 pixel window around coordinate
            r_min, r_max = max(0, row - 1), min(h, row + 2)
            c_min, c_max = max(0, col - 1), min(w, col + 2)
            win_depth = depth[r_min:r_max, c_min:c_max]
            win_acc = acc[r_min:r_max, c_min:c_max]

            max_local_depth = float(np.max(win_depth))
            max_local_acc = float(np.max(win_acc))

            spot_elev = float(dem[row, col])
            spot_depth = float(depth[row, col])
            spot_acc = float(acc[row, col])
            spot_hand = float(hand[row, col])
            spot_twi = float(twi[row, col])

            print(f"\n[*] {name} ({lat:.4f}°N, {lon:.4f}°E)")
            print(f"    Context: {desc}")
            print(f"    Pixel ({row}, {col}) Elevation: {spot_elev:.2f} m")
            print(
                f"    Depression Depth: {spot_depth:.2f} m "
                f"(3x3 window max: {max_local_depth:.2f} m)"
            )
            print(
                f"    Flow Accumulation: {spot_acc:.0f} cells "
                f"(3x3 window max: {max_local_acc:.0f} cells)"
            )
            print(f"    HAND: {spot_hand:.2f} m | TWI: {spot_twi:.2f}")
        else:
            print(f"\n[!] {name} ({lat}, {lon}) is OUTSIDE DEM bounds!")


def main() -> None:
    """Run full terrain index pipeline, generate previews, and validate."""
    print("==================================================")
    print("FloodLens Terrain Hydrological Analysis")
    print("==================================================")
    results = compute_terrain_indices(DEM_FILE)
    generate_preview_maps(results)
    validate_known_hotspots(results)
    print("\nTerrain pipeline execution completed successfully.")


if __name__ == "__main__":
    main()
