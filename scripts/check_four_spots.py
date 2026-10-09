"""Sanity check terrain features and scores for 4 key sites using geocoded coords."""

import math
import sys
from pathlib import Path
import h3
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from engine.config import HEX_FEATURES_FILE, H3_RESOLUTION
from engine.score import compute_scores

SITES = [
    ("Hero Honda Underpass", 28.43599, 77.01019),
    ("Subhash Chowk Underpass", 28.42772, 77.03711),
    ("Minto Bridge Underpass", 28.63656, 77.22231),
    ("ITO Intersection", 28.62819, 77.24104),
]


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance in meters between two lat/lon coordinates."""
    r = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = (
        math.sin(dphi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    )
    return 2.0 * r * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))


def main() -> None:
    """Print terrain features, score, and rank for the 4 key sites."""
    df_raw = pd.read_parquet(HEX_FEATURES_FILE)
    df = compute_scores(df_raw)
    total_hexes = len(df)

    # Sort descending by score for ranking
    df["rank"] = df["score"].rank(ascending=False, method="min").astype(int)

    print(f"\nTotal hexes evaluated: {total_hexes}")
    print("=" * 115)
    print(
        f"{'Site Name':<25} {'Coord (Lat, Lon)':<22} {'Hex ID':<16} "
        f"{'Elev':<6} {'HAND':<6} {'TWI':<6} {'FlowAcc':<8} {'Builtup':<8} "
        f"{'Underpass':<10} {'Score':<7} {'Rank':<6}"
    )
    print("-" * 115)

    for name, lat, lon in SITES:
        hex_id = h3.latlng_to_cell(lat, lon, H3_RESOLUTION)
        row = df[df["hex_id"] == hex_id]

        if row.empty:
            # Fallback to nearest hex center if slightly outside cell boundary
            dists = [
                haversine_m(lat, lon, r["lat"], r["lon"])
                for _, r in df.iterrows()
            ]
            min_idx = dists.index(min(dists))
            row = df.iloc[[min_idx]]
            hex_id = row.iloc[0]["hex_id"]

        r = row.iloc[0]
        coord_str = f"({lat:.4f}, {lon:.4f})"
        elev = r.get("elevation_m", 0.0)
        hand = r.get("min_hand", 0.0)
        twi = r.get("max_twi", 0.0)
        flow = 10 ** r.get("log10_max_flow_acc", 0.0)
        builtup = r.get("builtup_fraction", 0.0)
        up = int(r.get("underpass_prior", 0))
        score = r.get("score", 0.0)
        rank = r.get("rank", 0)

        print(
            f"{name:<25} {coord_str:<22} {hex_id:<16} "
            f"{elev:<6.1f} {hand:<6.2f} {twi:<6.2f} "
            f"{flow:<8.0f} {builtup:<8.2f} "
            f"{up:<10} {score:<7.4f} #{rank} / {total_hexes}"
        )

    print("=" * 115)


if __name__ == "__main__":
    main()
