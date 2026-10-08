"""Data ingestion module for FloodLens.

Downloads and caches:
1. Copernicus DEM 30m tiles (S3 anonymous) -> data/dem.tif (mosaicked & clipped).
2. ESA WorldCover 2021 built-up share (S3 anonymous) -> data/builtup.tif.
3. OpenStreetMap underpass/tunnel priors (Overpass API) -> data/underpasses.geojson.
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

import boto3
import botocore
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.merge import merge
from rasterio.warp import reproject
from rasterio.windows import from_bounds
import requests

from engine.config import (
    BBOX_EAST,
    BBOX_NORTH,
    BBOX_SOUTH,
    BBOX_WEST,
    BUILTUP_FILE,
    DEM_BUCKET,
    DEM_DIR,
    DEM_FILE,
    OSM_DIR,
    UNDERPASSES_FILE,
    WORLDCOVER_BUCKET,
    WORLDCOVER_DIR,
)

OVERPASS_ENDPOINT: str = "https://overpass-api.de/api/interpreter"
USER_AGENT: str = "FloodLens/0.1 (urban-waterlogging-research)"


def get_s3_anonymous_client() -> Any:
    """Create and return an unsigned S3 client for public open data buckets."""
    return boto3.client(
        "s3",
        region_name="eu-central-1",
        config=botocore.client.Config(signature_version=botocore.UNSIGNED),
    )


def download_s3_file(bucket: str, key: str, dest_path: Path) -> Path:
    """Download a file from an anonymous S3 bucket if not already present."""
    if dest_path.exists() and dest_path.stat().st_size > 0:
        print(f"Cached: {dest_path.name} ({dest_path.stat().st_size / 1e6:.1f} MB)")
        return dest_path

    print(f"Downloading s3://{bucket}/{key} -> {dest_path.name} ...")
    s3 = get_s3_anonymous_client()
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    s3.download_file(bucket, key, str(dest_path))
    print(f"Downloaded: {dest_path.name} ({dest_path.stat().st_size / 1e6:.1f} MB)")
    return dest_path


def fetch_dem() -> Path:
    """Download Copernicus DEM tiles, mosaic, clip to bbox, and write data/dem.tif."""
    if DEM_FILE.exists() and DEM_FILE.stat().st_size > 0:
        print(f"DEM already exists at {DEM_FILE}")
        _print_dem_stats(DEM_FILE)
        return DEM_FILE

    tiles = [
        (
            "Copernicus_DSM_COG_10_N28_00_E076_00_DEM/"
            "Copernicus_DSM_COG_10_N28_00_E076_00_DEM.tif"
        ),
        (
            "Copernicus_DSM_COG_10_N28_00_E077_00_DEM/"
            "Copernicus_DSM_COG_10_N28_00_E077_00_DEM.tif"
        ),
    ]

    local_tiles: list[Path] = []
    for key in tiles:
        filename = key.split("/")[-1]
        target = DEM_DIR / filename
        local_tiles.append(download_s3_file(DEM_BUCKET, key, target))

    print("Mosaicking and clipping DEM to bounding box...")
    src_files = [rasterio.open(str(t)) for t in local_tiles]
    try:
        mosaic, mosaic_transform = merge(
            src_files,
            bounds=(BBOX_WEST, BBOX_SOUTH, BBOX_EAST, BBOX_NORTH),
            nodata=-9999.0,
        )
        meta = src_files[0].meta.copy()
        meta.update(
            {
                "driver": "GTiff",
                "height": mosaic.shape[1],
                "width": mosaic.shape[2],
                "transform": mosaic_transform,
                "nodata": -9999.0,
                "compress": "lzw",
            }
        )

        with rasterio.open(str(DEM_FILE), "w", **meta) as dst:
            dst.write(mosaic)

        print(f"Saved clipped DEM to {DEM_FILE}")
        _print_dem_stats(DEM_FILE)
    finally:
        for s in src_files:
            s.close()

    return DEM_FILE


def _print_dem_stats(dem_path: Path) -> None:
    """Read and display descriptive statistics for the DEM."""
    with rasterio.open(str(dem_path)) as src:
        arr = src.read(1)
        valid = arr[arr != src.nodata]
        nodata_count = int(np.sum(arr == src.nodata))
        print("== DEM Statistics ------------------------------")
        print(f"Shape: {src.height} rows x {src.width} cols")
        print(f"CRS: {src.crs}")
        print(f"Resolution: {src.res[0]:.6f}° x {src.res[1]:.6f}°")
        print(f"Elevation min: {valid.min():.2f} m, max: {valid.max():.2f} m")
        print(f"Elevation mean: {valid.mean():.2f} m, std: {valid.std():.2f} m")
        print(f"NoData pixel count: {nodata_count}")
        print("------------------------------------------------")


def fetch_worldcover() -> Path:
    """Download ESA WorldCover tile, resample built-up class to DEM grid."""
    if BUILTUP_FILE.exists() and BUILTUP_FILE.stat().st_size > 0:
        print(f"Builtup raster already exists at {BUILTUP_FILE}")
        _print_raster_stats(BUILTUP_FILE, "Built-up share")
        return BUILTUP_FILE

    tile_key = "v200/2021/map/ESA_WorldCover_10m_2021_v200_N27E075_Map.tif"
    local_path = WORLDCOVER_DIR / "ESA_WorldCover_10m_2021_v200_N27E075_Map.tif"
    download_s3_file(WORLDCOVER_BUCKET, tile_key, local_path)

    if not DEM_FILE.exists():
        fetch_dem()

    print("Extracting built-up class and resampling to DEM grid...")
    with rasterio.open(str(DEM_FILE)) as dem_src:
        dem_meta = dem_src.meta.copy()
        dem_shape = (dem_src.height, dem_src.width)
        dem_transform = dem_src.transform
        dem_crs = dem_src.crs

    with rasterio.open(str(local_path)) as wc_src:
        window = from_bounds(
            BBOX_WEST - 0.05,
            BBOX_SOUTH - 0.05,
            BBOX_EAST + 0.05,
            BBOX_NORTH + 0.05,
            wc_src.transform,
        )
        wc_data = wc_src.read(1, window=window)
        wc_transform = rasterio.windows.transform(window, wc_src.transform)

        # ESA WorldCover class 50 = built-up
        builtup_mask = (wc_data == 50).astype(np.float32)

        builtup_resampled = np.zeros(dem_shape, dtype=np.float32)
        reproject(
            source=builtup_mask,
            destination=builtup_resampled,
            src_transform=wc_transform,
            src_crs=wc_src.crs,
            dst_transform=dem_transform,
            dst_crs=dem_crs,
            resampling=Resampling.average,
        )

    out_meta = dem_meta.copy()
    out_meta.update(
        {
            "dtype": "float32",
            "nodata": -9999.0,
            "compress": "lzw",
        }
    )

    with rasterio.open(str(BUILTUP_FILE), "w", **out_meta) as dst:
        dst.write(builtup_resampled, 1)

    print(f"Saved built-up raster to {BUILTUP_FILE}")
    _print_raster_stats(BUILTUP_FILE, "Built-up fraction")
    return BUILTUP_FILE


def _print_raster_stats(raster_path: Path, label: str) -> None:
    """Print summary statistics for a raster file."""
    with rasterio.open(str(raster_path)) as src:
        arr = src.read(1)
        valid = arr[arr != src.nodata]
        print(f"== {label} Statistics ------------------==")
        print(f"Shape: {src.height} rows x {src.width} cols")
        print(f"Min: {valid.min():.4f}, Max: {valid.max():.4f}")
        print(f"Mean: {valid.mean():.4f}, Median: {float(np.median(valid)):.4f}")
        print("------------------------------------------------")


def fetch_osm_underpasses() -> Path:
    """Query Overpass API for tunnels, culverts, and submerged layers in bbox."""
    if UNDERPASSES_FILE.exists() and UNDERPASSES_FILE.stat().st_size > 0:
        print(f"OSM underpasses already exist at {UNDERPASSES_FILE}")
        _print_underpasses_summary(UNDERPASSES_FILE)
        return UNDERPASSES_FILE

    step = 0.25
    lons = np.arange(BBOX_WEST, BBOX_EAST, step).tolist()
    if lons[-1] < BBOX_EAST:
        lons.append(BBOX_EAST)
    lats = np.arange(BBOX_SOUTH, BBOX_NORTH, step).tolist()
    if lats[-1] < BBOX_NORTH:
        lats.append(BBOX_NORTH)

    features: list[dict[str, Any]] = []
    seen_ids: set[int] = set()

    print(f"Querying Overpass API across {len(lats)-1}x{len(lons)-1} cells...")

    for i in range(len(lats) - 1):
        for j in range(len(lons) - 1):
            s, n = lats[i], lats[i + 1]
            w, e = lons[j], lons[j + 1]

            query = f"""
            [out:json][timeout:35];
            (
              way["highway"]["tunnel"~"^(yes|culvert|building_passage)$"]({s:.4f},{w:.4f},{n:.4f},{e:.4f});
              way["highway"]["layer"~"^-[1-9]"]({s:.4f},{w:.4f},{n:.4f},{e:.4f});
            );
            out center tags;
            """

            for attempt in range(3):
                try:
                    resp = requests.post(
                        OVERPASS_ENDPOINT,
                        data={"data": query},
                        headers={"User-Agent": USER_AGENT},
                        timeout=40,
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        for el in data.get("elements", []):
                            el_id = el["id"]
                            if el_id in seen_ids:
                                continue
                            seen_ids.add(el_id)
                            center = el.get("center")
                            if not center:
                                continue
                            tags = el.get("tags", {})
                            feat = {
                                "type": "Feature",
                                "id": el_id,
                                "geometry": {
                                    "type": "Point",
                                    "coordinates": [center["lon"], center["lat"]],
                                },
                                "properties": {
                                    "osm_id": el_id,
                                    "name": tags.get("name", "Unnamed"),
                                    "highway": tags.get("highway", ""),
                                    "tunnel": tags.get("tunnel", ""),
                                    "layer": tags.get("layer", ""),
                                },
                            }
                            features.append(feat)
                        break
                    elif resp.status_code in (429, 504):
                        wait_time = (attempt + 1) * 3
                        print(f"Overpass rate limit ({resp.status_code}), waiting {wait_time}s...")
                        time.sleep(wait_time)
                except Exception as exc:
                    print(f"Cell ({s:.2f}, {w:.2f}) query error: {exc}. Retrying...")
                    time.sleep(2)
            time.sleep(1.0)  # Polite spacing between cells

    geojson_data = {
        "type": "FeatureCollection",
        "features": features,
    }

    with open(UNDERPASSES_FILE, "w", encoding="utf-8") as f:
        json.dump(geojson_data, f, indent=2)

    print(f"Saved {len(features)} underpass/tunnel priors to {UNDERPASSES_FILE}")
    _print_underpasses_summary(UNDERPASSES_FILE)
    return UNDERPASSES_FILE


def _print_underpasses_summary(file_path: Path) -> None:
    """Print count and sample records from the underpasses GeoJSON file."""
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    feats = data.get("features", [])
    print(f"== Underpasses / Sink Priors Summary ------------")
    print(f"Total features: {len(feats)}")
    named = [f for f in feats if f["properties"].get("name") != "Unnamed"]
    print(f"Named features ({len(named)}):")
    for sample in named[:5]:
        props = sample["properties"]
        coords = sample["geometry"]["coordinates"]
        print(
            f"  - {props.get('name')} ({props.get('highway')}, "
            f"tunnel={props.get('tunnel')}, layer={props.get('layer')}) at "
            f"[{coords[1]:.4f}, {coords[0]:.4f}]"
        )
    print("------------------------------------------------")


def main() -> None:
    """Run all data fetch pipelines sequentially."""
    print("==================================================")
    print("FloodLens Data Ingestion Pipeline")
    print("==================================================")
    print("\n[Step 1] Fetching Copernicus DEM 30m...")
    fetch_dem()

    print("\n[Step 2] Fetching ESA WorldCover 2021 built-up share...")
    fetch_worldcover()

    print("\n[Step 3] Fetching OSM underpasses/tunnels...")
    fetch_osm_underpasses()

    print("\nData ingestion complete.")


if __name__ == "__main__":
    main()
