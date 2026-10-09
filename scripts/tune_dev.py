"""Tune and evaluate candidate feature weights exclusively on the DEV split."""

import math
import sys
from pathlib import Path
from typing import Any
import numpy as np
import pandas as pd
from scipy.spatial import KDTree

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from engine.config import HEX_FEATURES_FILE

SPOTS_CSV = PROJECT_ROOT / "eval" / "spots.csv"


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


def score_features(df: pd.DataFrame, weights: dict[str, float]) -> np.ndarray:
    """Compute normalized composite score with candidate weights."""
    p_hand = df["min_hand"].rank(pct=True).to_numpy()
    p_hand_inv = 1.0 - p_hand
    p_twi = df["max_twi"].rank(pct=True).to_numpy()
    p_flow_acc = df["log10_max_flow_acc"].rank(pct=True).to_numpy()
    p_builtup = df["builtup_fraction"].rank(pct=True).to_numpy()
    p_depth = df["max_depression_depth"].rank(pct=True).to_numpy()
    p_underpass = df["underpass_prior"].astype(float).to_numpy()

    s_raw = (
        weights["hand_inv"] * p_hand_inv
        + weights["twi"] * p_twi
        + weights["flow_acc"] * p_flow_acc
        + weights["builtup"] * p_builtup
        + weights.get("depression_depth", 0.0) * p_depth
        + weights["underpass_prior"] * p_underpass
    )
    s_min, s_max = float(s_raw.min()), float(s_raw.max())
    return (s_raw - s_min) / (s_max - s_min) if s_max > s_min else s_raw


def evaluate_split(
    hex_df: pd.DataFrame,
    spots_df: pd.DataFrame,
    ranking_scores: np.ndarray,
    k_values: list[int] = [25, 50, 100, 200],
) -> dict[str, Any]:
    """Evaluate Recall@K per the fixed protocol."""
    # Rank descending
    rank_order = np.argsort(-ranking_scores)

    # Coordinates in meters using approximate local projection
    mid_lat = 28.6
    lat_scale = 111320.0
    lon_scale = 111320.0 * math.cos(math.radians(mid_lat))

    hex_coords = np.column_stack(
        [hex_df["lon"] * lon_scale, hex_df["lat"] * lat_scale]
    )

    spot_coords = np.column_stack(
        [spots_df["lon"] * lon_scale, spots_df["lat"] * lat_scale]
    )

    point_mask = (spots_df["geom_type"] == "point").to_numpy()
    stretch_mask = ~point_mask

    n_points = int(point_mask.sum())
    n_stretch = int(stretch_mask.sum())
    n_total = len(spots_df)

    results: dict[str, Any] = {}

    for k in k_values:
        top_k_indices = rank_order[:k]
        top_k_coords = hex_coords[top_k_indices]
        tree = KDTree(top_k_coords)

        # Distance from each spot to nearest top-K hex
        dists, _ = tree.query(spot_coords)

        hit_pt_300 = (dists <= 300.0) & point_mask
        hit_pt_500 = (dists <= 500.0) & point_mask
        hit_str_1000 = (dists <= 1000.0) & stretch_mask

        rec_pt_300 = hit_pt_300.sum() / n_points if n_points > 0 else 0.0
        rec_pt_500 = hit_pt_500.sum() / n_points if n_points > 0 else 0.0
        rec_str_1000 = hit_str_1000.sum() / n_stretch if n_stretch > 0 else 0.0

        comb_300 = (hit_pt_300.sum() + hit_str_1000.sum()) / n_total
        comb_500 = (hit_pt_500.sum() + hit_str_1000.sum()) / n_total

        results[f"R@{k}"] = {
            "pt_300": rec_pt_300,
            "pt_500": rec_pt_500,
            "str_1000": rec_str_1000,
            "comb_300": comb_300,
            "comb_500": comb_500,
            "hits_pt_300": int(hit_pt_300.sum()),
            "hits_pt_500": int(hit_pt_500.sum()),
            "hits_str": int(hit_str_1000.sum()),
        }

    return results


def main() -> None:
    """Evaluate candidate weight sets strictly on the DEV split."""
    hex_df = pd.read_parquet(HEX_FEATURES_FILE)
    spots_df = pd.read_csv(SPOTS_CSV)
    dev_spots = spots_df[spots_df["split"] == "dev"].reset_index(drop=True)

    print(f"Loaded {len(hex_df)} hexes and {len(dev_spots)} DEV spots")
    print(f"DEV spots: {sum(dev_spots['geom_type'] == 'point')} points, "
          f"{sum(dev_spots['geom_type'] != 'point')} stretch/area")

    candidate_weights = {
        "C1_Current": {
            "hand_inv": 0.25,
            "twi": 0.25,
            "flow_acc": 0.15,
            "builtup": 0.15,
            "underpass_prior": 0.15,
            "depression_depth": 0.05,
        },
        "C2_UnderpassHeavy": {
            "hand_inv": 0.20,
            "twi": 0.20,
            "flow_acc": 0.10,
            "builtup": 0.15,
            "underpass_prior": 0.30,
            "depression_depth": 0.05,
        },
        "C3_HydrologyHeavy": {
            "hand_inv": 0.35,
            "twi": 0.30,
            "flow_acc": 0.20,
            "builtup": 0.10,
            "underpass_prior": 0.05,
            "depression_depth": 0.00,
        },
        "C4_BalancedUnderpass": {
            "hand_inv": 0.25,
            "twi": 0.20,
            "flow_acc": 0.15,
            "builtup": 0.15,
            "underpass_prior": 0.25,
            "depression_depth": 0.00,
        },
        "C5_HighUnderpass": {
            "hand_inv": 0.20,
            "twi": 0.15,
            "flow_acc": 0.10,
            "builtup": 0.15,
            "underpass_prior": 0.40,
            "depression_depth": 0.00,
        },
    }

    print("\n" + "=" * 95)
    print(f"{'Configuration':<22} {'R@25(comb)':<12} {'R@50(comb)':<12} "
          f"{'R@100(comb)':<12} {'R@200(comb)':<12} {'Details (R@100: pt300 / str)'}")
    print("-" * 95)

    for name, w in candidate_weights.items():
        scores = score_features(hex_df, w)
        metrics = evaluate_split(hex_df, dev_spots, scores)
        r25 = metrics["R@25"]["comb_300"] * 100
        r50 = metrics["R@50"]["comb_300"] * 100
        r100 = metrics["R@100"]["comb_300"] * 100
        r200 = metrics["R@200"]["comb_300"] * 100
        pt_hits = metrics["R@100"]["hits_pt_300"]
        str_hits = metrics["R@100"]["hits_str"]

        print(f"{name:<22} {r25:5.1f}%      {r50:5.1f}%      "
              f"{r100:5.1f}%      {r200:5.1f}%      "
              f"{pt_hits}/7 pts, {str_hits}/7 str")

    print("=" * 95)


if __name__ == "__main__":
    main()
