"""Smoke test: verify imports, S3 data access (anonymous), and API connectivity."""

import os
import sys
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

PASS = "[PASS]"
FAIL = "[FAIL]"


def test_imports() -> bool:
    """Test that core Python packages are importable."""
    packages = {
        "rasterio": "rasterio",
        "geopandas": "geopandas",
        "h3": "h3",
        "pysheds": "pysheds",
        "strands": "strands",
        "fastapi": "fastapi",
        "numpy": "numpy",
        "shapely": "shapely",
    }
    all_ok = True
    for name, mod in packages.items():
        try:
            __import__(mod)
            print(f"  {PASS}  import {name}")
        except ImportError as e:
            print(f"  {FAIL}  import {name}: {e}")
            all_ok = False
    return all_ok


def test_copernicus_dem_bucket() -> bool:
    """List copernicus-dem-30m bucket anonymously and test tile access."""
    try:
        import boto3
        import botocore

        s3 = boto3.client(
            "s3",
            region_name="eu-central-1",
            config=botocore.client.Config(signature_version=botocore.UNSIGNED),
        )

        expected_tiles = [
            (
                "Copernicus_DSM_COG_10_N28_00_E076_00_DEM/"
                "Copernicus_DSM_COG_10_N28_00_E076_00_DEM.tif"
            ),
            (
                "Copernicus_DSM_COG_10_N28_00_E077_00_DEM/"
                "Copernicus_DSM_COG_10_N28_00_E077_00_DEM.tif"
            ),
        ]
        found_tiles: list[str] = []

        print("  Listing and verifying s3://copernicus-dem-30m anonymously...")
        for key in expected_tiles:
            try:
                head = s3.head_object(Bucket="copernicus-dem-30m", Key=key)
                size_mb = head.get("ContentLength", 0) / (1024 * 1024)
                found_tiles.append(key)
                print(f"  {PASS}  found tile key: {key} ({size_mb:.2f} MB)")
            except Exception as ex:
                print(f"  {FAIL}  tile key not accessible: {key} ({ex})")

        # Small byte-range read (first 1024 bytes) to verify anonymous read
        if found_tiles:
            target_key = found_tiles[0]
            resp = s3.get_object(
                Bucket="copernicus-dem-30m",
                Key=target_key,
                Range="bytes=0-1023",
            )
            data = resp["Body"].read()
            print(f"  {PASS}  read {len(data)} bytes header from {target_key}")

        return len(found_tiles) == len(expected_tiles)

    except Exception as e:
        print(f"  {FAIL}  copernicus DEM bucket check failed: {e}")
        return False


def test_worldcover_bucket() -> bool:
    """List esa-worldcover bucket anonymously and report version folders."""
    try:
        import boto3
        import botocore

        s3 = boto3.client(
            "s3",
            region_name="eu-central-1",
            config=botocore.client.Config(signature_version=botocore.UNSIGNED),
        )
        print("  Listing s3://esa-worldcover anonymously...")
        res = s3.list_objects_v2(Bucket="esa-worldcover", Delimiter="/")
        prefixes = [p["Prefix"] for p in res.get("CommonPrefixes", [])]
        print(f"  {PASS}  esa-worldcover version folders found: {prefixes}")
        return len(prefixes) > 0

    except Exception as e:
        print(f"  {FAIL}  esa-worldcover bucket listing failed: {e}")
        print("  NOTE: fallback to OSM building density for impervious surfaces.")
        return False


def test_open_meteo() -> bool:
    """Make one Open-Meteo forecast API call for Delhi."""
    import urllib.request
    import json

    print("  Calling Open-Meteo forecast API for Delhi (28.61, 77.21)...")
    url = (
        "https://api.open-meteo.com/v1/forecast"
        "?latitude=28.61&longitude=77.21&hourly=precipitation&forecast_days=1"
    )
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "FloodLens/0.1"})
        with urllib.request.urlopen(req, timeout=15) as response:
            data = json.loads(response.read().decode("utf-8"))
            hours = data.get("hourly", {}).get("time", [])
            precip = data.get("hourly", {}).get("precipitation", [])
            max_p = max(precip) if precip else 0.0
            print(f"  {PASS}  got {len(hours)} hourly entries, max precip: {max_p} mm")
            return True
    except Exception as e:
        print(f"  {FAIL}  Open-Meteo API call failed: {e}")
        return False


def main() -> None:
    """Run all smoke tests and report summary."""
    print("=" * 60)
    print("FloodLens Smoke Test")
    print("=" * 60)

    results: dict[str, bool] = {}

    print("\n[1/4] Python imports")
    results["imports"] = test_imports()

    print("\n[2/4] Copernicus DEM bucket (anonymous S3)")
    results["dem_bucket"] = test_copernicus_dem_bucket()

    print("\n[3/4] ESA WorldCover bucket (anonymous S3)")
    results["worldcover"] = test_worldcover_bucket()

    print("\n[4/4] Open-Meteo forecast API")
    results["open_meteo"] = test_open_meteo()

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    for name, passed in results.items():
        status = PASS if passed else FAIL
        print(f"  {status}  {name}")

    failed = sum(1 for v in results.values() if not v)
    if failed:
        print(f"\n{failed} check(s) failed or require environment setup.")
    else:
        print("\nAll checks passed!")


if __name__ == "__main__":
    main()
