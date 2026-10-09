# Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-08 | H3 res-9 over the bbox is ~43K hexes (not 500K); per-request scoring is cheap; still cache terrain indices to disk | Measured hex count for the actual bounding box |
| 2026-10-08 | Greedy heuristic for pump_plan (assign to top-N uncovered hotspots) | Good enough for hackathon demo; facility-location solver is overkill |
| 2026-10-08 | uv + Python 3.11 venv instead of conda (Windows) | Faster setup, self-contained Python 3.11 management via uv, avoids conda PATH issues |
| 2026-10-08 | WorldCover tile N27E075 (3°x3°) fully covers bbox; average-resampled class 50 to 30m DEM grid | Produces accurate fractional impervious share [0, 1] matching DEM grid |
| 2026-10-08 | Overpass query chunked into 0.25° tiles with retry/backoff (1,537 features) | Avoids Overpass 504 gateway timeouts on large Delhi bbox; retrieves real sink priors |
| 2026-10-08 | Copernicus DSM noise mitigation: sigma=0.5 blur + 0.25m depth threshold | Suppresses artificial pits created by building roofs and tree canopies |
| 2026-10-08 | HAND accumulation threshold set to 500 cells (~0.45 km²) | Delineates secondary urban storm drainage network without excessive noise |
| 2026-10-08 | NumPy 2.x compatibility bridge (np.in1d = np.isin) for pysheds 0.5 | Pysheds expects deprecated NumPy 1.x in1d during D8 accumulation |
| 2026-10-09 | TWI metric gradient fix (Horn gradient dx=27.1m, dy=30.9m) | Pysheds cell_slopes was in m/deg (~7000 m/deg), causing negative tan and NaN masking; fixed with metric gradient resulting in 0.0% zero/NaN cells (min 4.33, mean 9.83, max 23.20) |
| 2026-10-09 | Hex features availability logged for 41,703 H3 res-9 cells | 100% elevation, 100% TWI, 70.5% built-up, 92.8% HAND<=2m, 77.9% flow acc>100, 1.5% underpass prior (618 hexes), 0% depression depth |
| 2026-10-09 | Feature weights: HAND 0.25, TWI 0.25, flow_acc 0.15, builtup 0.15, underpass 0.15, depression 0.05 | Depression depth downweighted due to 30m DSM roof/bridge occlusion; priors & low-drainage indicators drive risk |
| 2026-10-09 | Relative trigger model: R_i = 80 * exp(-2 * S_i) with severity = mm / R_i | Guarantees strict mathematical monotonicity across rainfall intensity scenarios |
