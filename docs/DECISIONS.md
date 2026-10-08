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
