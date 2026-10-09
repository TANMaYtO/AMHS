"""Print flooded counts at 10, 20, 40, 60, 80, 100 mm/hr and run pump plan at 40 and 60 mm/hr."""

import json
import sys

# Add project root to sys.path
sys.path.insert(0, r"d:\AMHS\floodlens")

import numpy as np
import pandas as pd
from agent.tools import pump_plan
from engine.score import get_scored_dataset

# Clear in-memory cache to load new config R_REF and K
import engine.score as score_module
score_module._CACHED_SCORED_DF = None

df = get_scored_dataset()
n_total = len(df)

print("=" * 80)
print("PART A STEP 4: FLOODED HEX COUNTS AT SCENARIO RAINFALL INTENSITIES")
print("=" * 80)
print(f"Total H3 res-9 hexes in study bounding box: {n_total}\n")

print(f"{'Rainfall (mm/hr)':<18} | {'Flooded Hexes':<14} | {'Share of Study Area':<20} | {'Status'}")
print("-" * 80)

rates = [10.0, 20.0, 40.0, 60.0, 80.0, 100.0]
for r in rates:
    flooded_count = int(np.sum(r >= df["trigger_mm"]))
    share_pct = (flooded_count / n_total) * 100.0
    print(f"{r:5.0f} mm/hr          | {flooded_count:7d} hexes   | {share_pct:6.2f}%              | OK")

print("\n" + "=" * 80)
print("PUMP PLAN AT 40 MM/HR (6 pumps, 1500m radius):")
print("=" * 80)
plan_40_str = pump_plan(n_pumps=6, mm_per_hr=40.0, radius_m=1500)
plan_40 = json.loads(plan_40_str)
print(f"Total flooded hexes at 40 mm/hr:    {plan_40['total_flooded_hexes']}")
print(f"Pumps placed:                       {plan_40['n_pumps_placed']} of {plan_40['n_pumps_requested']}")
print(f"Severity share covered:             {plan_40['covered_severity_share_pct']}%")
print("Pump deployments:")
for p in plan_40["pumps"]:
    print(
        f"  Pump #{p['pump_id']}: [{p['nearest_place']}] "
        f"at ({p['lat']:.4f}, {p['lon']:.4f}) | "
        f"Site Sev: {p['site_severity']}x | "
        f"Hexes covered in radius: {p['hexes_covered_in_radius']} | "
        f"Severity covered: {p['severity_covered']:.2f}"
    )

print("\n" + "=" * 80)
print("PUMP PLAN AT 60 MM/HR (6 pumps, 1500m radius):")
print("=" * 80)
plan_60_str = pump_plan(n_pumps=6, mm_per_hr=60.0, radius_m=1500)
plan_60 = json.loads(plan_60_str)
print(f"Total flooded hexes at 60 mm/hr:    {plan_60['total_flooded_hexes']}")
print(f"Pumps placed:                       {plan_60['n_pumps_placed']} of {plan_60['n_pumps_requested']}")
print(f"Severity share covered:             {plan_60['covered_severity_share_pct']}%")
print("Pump deployments:")
for p in plan_60["pumps"]:
    print(
        f"  Pump #{p['pump_id']}: [{p['nearest_place']}] "
        f"at ({p['lat']:.4f}, {p['lon']:.4f}) | "
        f"Site Sev: {p['site_severity']}x | "
        f"Hexes covered in radius: {p['hexes_covered_in_radius']} | "
        f"Severity covered: {p['severity_covered']:.2f}"
    )
