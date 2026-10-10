"""Prove invariance of susceptibility ranking S and backtest recall after R_REF/K display scale fix."""

import json
import sys
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, r"d:\AMHS\floodlens")

import numpy as np
import pandas as pd
from engine.score import build_hex_features, compute_scores
from eval.backtest import (
    SPOTS_CSV,
    evaluate_deterministic_ranking,
    get_projected_coords,
)

BASELINE_FILE = Path(r"d:\AMHS\floodlens\eval\baseline_top200_and_recall.json")
with open(BASELINE_FILE, "r", encoding="utf-8") as f:
    baseline = json.load(f)

# Re-compute scores with new R_REF and K
df = build_hex_features()
scored = compute_scores(df)

# 1. Compare top-200 hex IDs
new_top200_df = scored.sort_values(
    by=["score", "hex_id"], ascending=[False, True]
).head(200)
new_top200_ids = new_top200_df["hex_id"].tolist()
new_top200_scores = new_top200_df["score"].tolist()

base_top200_ids = baseline["top200_hex_ids"]
base_top200_scores = baseline["top200_scores"]

ids_match = new_top200_ids == base_top200_ids
scores_match = np.allclose(new_top200_scores, base_top200_scores, atol=1e-6)

print("=" * 80)
print("INVARIANCE PROOF: TOP-200 HEX SET & SUSCEPTIBILITY RANKING")
print("=" * 80)
print(f"Top-200 Hex IDs identical: {ids_match}")
print(f"Top-200 Scores identical:  {scores_match}")
assert ids_match, "CRITICAL ERROR: Top-200 hex IDs differ!"
assert scores_match, "CRITICAL ERROR: Top-200 scores differ!"

# 2. Compare backtest recall metrics
spots_df = pd.read_csv(SPOTS_CSV)
hex_lons = scored["lon"].to_numpy()
hex_lats = scored["lat"].to_numpy()
hex_coords_m = get_projected_coords(hex_lons, hex_lats)
ranking_scores = scored["score"].to_numpy()

k_values = [25, 50, 100, 200]
splits = ["dev", "test"]

print("\n" + "=" * 80)
print("INVARIANCE PROOF: BACKTEST RECALL COMPARISON")
print("=" * 80)

recall_identical = True

for split in splits:
    split_spots = spots_df[spots_df["split"] == split].copy()
    spot_lons = split_spots["lon"].to_numpy()
    spot_lats = split_spots["lat"].to_numpy()
    spot_coords_m = get_projected_coords(spot_lons, spot_lats)
    point_mask = (split_spots["geom_type"] == "point").to_numpy()
    stretch_mask = (split_spots["geom_type"].isin(["stretch", "area"])).to_numpy()

    metrics, cis, ties, _ = evaluate_deterministic_ranking(
        ranking_scores,
        hex_coords_m,
        spot_coords_m,
        point_mask,
        stretch_mask,
        k_values=k_values,
    )

    base_split_metrics = baseline["recall_metrics"][split]
    print(f"\n--- Split: {split.upper()} (N={len(split_spots)}) ---")

    for k in k_values:
        new_m = metrics[k]
        base_m = base_split_metrics[str(k)]

        diffs = []
        for m_key in ["comb_300", "comb_500", "rec_pt_300", "rec_str_1000"]:
            val_new = round(float(new_m[m_key]), 6)
            val_base = round(float(base_m[m_key]), 6)
            if abs(val_new - val_base) > 1e-6:
                diffs.append((m_key, val_base, val_new))
                recall_identical = False

        status = "EXACT MATCH" if not diffs else f"MISMATCH: {diffs}"
        print(
            f"K={k:3d}: Comb(300m)={new_m['comb_300']*100:5.1f}% | "
            f"Comb(500m)={new_m['comb_500']*100:5.1f}% | "
            f"Pt(300m)={new_m['rec_pt_300']*100:5.1f}% | "
            f"Str(1000m)={new_m['rec_str_1000']*100:5.1f}% -> {status}"
        )

print("\n" + "=" * 80)
print(f"OVERALL RECALL INVARIANCE PROVED: {recall_identical}")
print("=" * 80)
assert recall_identical, "CRITICAL ERROR: Backtest recall differs!"
