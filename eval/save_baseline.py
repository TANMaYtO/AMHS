"""Extract and save baseline top-200 hex IDs and backtest recall numbers before any change."""

import json
import os
import sys
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, r"d:\AMHS\floodlens")

import numpy as np
import pandas as pd
from engine.score import get_scored_dataset
from eval.backtest import (
    SPOTS_CSV,
    count_ties_at_cutoff,
    evaluate_deterministic_ranking,
    get_projected_coords,
)

df = get_scored_dataset()

# 1. Top-200 hex IDs by susceptibility score S (breaking ties deterministically by hex_id)
top200_df = df.sort_values(by=["score", "hex_id"], ascending=[False, True]).head(200)
top200_hex_ids = top200_df["hex_id"].tolist()
top200_scores = top200_df["score"].tolist()

print(f"Total hexes: {len(df)}")
print(f"Top 5 hex IDs: {top200_hex_ids[:5]}")
print(f"Top 5 scores: {top200_scores[:5]}")
print(f"200th score: {top200_scores[-1]}")

# 2. Compute backtest recall numbers on DEV and TEST
spots_df = pd.read_csv(SPOTS_CSV)
hex_lons = df["lon"].to_numpy()
hex_lats = df["lat"].to_numpy()
hex_coords_m = get_projected_coords(hex_lons, hex_lats)
ranking_scores = df["score"].to_numpy()

k_values = [25, 50, 100, 200]
splits = ["dev", "test"]
recall_results = {}

for split in splits:
    split_spots = spots_df[spots_df["split"] == split].copy()
    spot_lons = split_spots["lon"].to_numpy()
    spot_lats = split_spots["lat"].to_numpy()
    spot_coords_m = get_projected_coords(spot_lons, spot_lats)
    point_mask = (split_spots["geom_type"] == "point").to_numpy()
    stretch_mask = (split_spots["geom_type"].isin(["stretch", "area"])).to_numpy()

    metrics, cis, ties = evaluate_deterministic_ranking(
        ranking_scores,
        hex_coords_m,
        spot_coords_m,
        point_mask,
        stretch_mask,
        k_values=k_values,
    )
    # Convert numpy types to python floats/ints
    clean_metrics = {
        k: {m: round(float(v), 6) for m, v in m_dict.items()}
        for k, m_dict in metrics.items()
    }
    recall_results[split] = clean_metrics
    print(f"\n--- Baseline Recall for {split.upper()} (N={len(split_spots)}) ---")
    for k in k_values:
        m = clean_metrics[k]
        print(
            f"K={k:3d}: Comb(300m)={m['comb_300']*100:.1f}%, "
            f"Comb(500m)={m['comb_500']*100:.1f}%, "
            f"Pt(300m)={m['rec_pt_300']*100:.1f}%, "
            f"Str(1000m)={m['rec_str_1000']*100:.1f}%"
        )

baseline_data = {
    "top200_hex_ids": top200_hex_ids,
    "top200_scores": top200_scores,
    "recall_metrics": recall_results,
}

output_path = Path(r"d:\AMHS\floodlens\eval\baseline_top200_and_recall.json")
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(baseline_data, f, indent=2)

print(f"\nSaved baseline artifacts to {output_path}")
