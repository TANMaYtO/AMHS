# Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-10-08 | H3 res-9 over the bbox is ~43K hexes (not 500K); per-request scoring is cheap; still cache terrain indices to disk | Measured hex count for the actual bounding box |
| 2026-10-08 | Greedy heuristic for pump_plan (assign to top-N uncovered hotspots) | Good enough for hackathon demo; facility-location solver is overkill |
