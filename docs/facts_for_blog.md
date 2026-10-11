# FloodLens: Verified Facts for Builder Center Blog Post

> **Strict Rule**: Every bullet point below represents an empirical, verified fact originating directly from the codebase, committed data payloads, or evaluation benchmarks. No synthetic claims.

---

## 1. Data Ingestion & Spatial Coverage

- **Study Area Bounding Box**: West `76.80°`, South `28.30°`, East `77.50°`, North `28.90°` spanning the Delhi, Gurugram, and Noida urban agglomeration.  
  *(Source: `engine/config.py`)*
- **Elevation Model**: Copernicus DEM GLO-30 (`copernicus-dem-30m` AWS Open Data anonymous S3 bucket). Mosaic dimensions: `2160 rows x 2520 cols` at `~30 m` resolution with `0` NoData pixels across the bounding box. File size: `21.5 MB` (`data/dem.tif`).  
  *(Source: `engine/fetch.py`, `docs/DECISIONS.md`)*
- **Impervious Surface Share**: ESA WorldCover 2021 v200 (`esa-worldcover` AWS Open Data S3 bucket, tile `N27E075`). Average-resampled built-up fraction (Class 50) to the DEM grid with mean built-up share of `0.2972`. File size: `2.8 MB` (`data/builtup.tif`).  
  *(Source: `engine/fetch.py`, `docs/DECISIONS.md`)*
- **Subterranean Sink Priors**: OpenStreetMap Overpass API queries across 9 tiled sub-bounding boxes (0.25° tiles with exponential retry backoff). Extracted `1,513` subterranean highway underpasses, tunnels, and railway culverts with `221` verified named infrastructure landmarks. File size: `942 KB` (`data/underpasses.geojson`).  
  *(Source: `engine/fetch.py`, `data/underpasses.geojson`)*
- **Spatial Grid**: Uber H3 discrete global hexagonal grid at resolution 9 (~174 m edge length, ~0.10 km² area). Exactly `41,703` active hexagonal cells cover the study area. Cached feature parquet file size: `8.9 MB` (`data/derived/hex_features.parquet`).  
  *(Source: `engine/score.py`, `docs/DECISIONS.md`)*

---

## 2. Terrain Hydrology & Scoring Model

- **Hydrological Processing**: Evaluated via `pysheds 0.5` with a NumPy 2.x compatibility bridge (`np.in1d = np.isin`). Computes filled pits, D8 flow directions, flow accumulation, slope, Height Above Nearest Drainage (HAND, threshold `500 cells` ~0.45 km²), and Topographic Wetness Index (TWI, metric gradient dx=27.1m, dy=30.9m).  
  *(Source: `engine/terrain.py`, `docs/DECISIONS.md`)*
- **Feature Weights in Composite Susceptibility Score ($S \in [0, 1]$)**:  
  - HAND (inverse): `0.25`
  - Topographic Wetness Index (TWI): `0.25`
  - Flow Accumulation (log10): `0.15`
  - Built-up Surface Fraction: `0.15`
  - OSM Underpass Prior: `0.15`
  - Depression Depth: `0.05` *(downweighted due to 30 m DSM bridge/rooftop occlusion)*  
  *(Source: `engine/config.py`)*
- **Display Scale Rainfall Trigger Function**:  
  $R_i = R_{\text{REF}} \cdot e^{-K \cdot S_i}$ with reference ceiling $R_{\text{REF}} = 8200.0 \text{ mm/hr}$ and exponential factor $K = 7.60$. Produces realistic scenario shares while guaranteeing strict ranking and recall mathematical invariance:
  - `10 mm/hr`: `32 hexes` (0.08% of study area)
  - `20 mm/hr`: `190 hexes` (0.46%)
  - `40 mm/hr`: `1,239 hexes` (2.97%)
  - `60 mm/hr`: `3,944 hexes` (9.46%)
  - `80 mm/hr`: `6,738 hexes` (16.16%)
  - `100 mm/hr`: `9,342 hexes` (22.40%)  
  *(Source: `engine/config.py`, `eval/print_flooded_and_pump_plan.py`)*

---

## 3. Empirical Evaluation & Benchmark Metrics

- **Ground Truth Sample Size**: `31` news-reported waterlogging spots geocoded via Nominatim with spatial leakage filtering:
  - **DEV Split**: `14 spots` (6 points, 8 stretch/area corridors) from 2026-08-06 (Delhi/Gurgaon), 2026-07-08 (Gurgaon), and chronic sites (Minto Bridge, Subhash Chowk).
  - **TEST Split**: `17 spots` (3 points, 14 stretch/area corridors) from the 2026-07-28 IMD Red-Alert extreme rainfall event (Delhi-only). Evaluated strictly once with locked weights.  
  *(Source: `eval/spots.csv`, `eval/results.md`)*
- **Fixed Protocol Tolerances**:
  - Point spots: Hit if a top-$K$ hex centre is within `300 m` (primary) or `500 m` (secondary).
  - Stretch/Area spots: Hit if a top-$K$ hex centre is within `1,000 m` of geocoded midpoint.  
  *(Source: `docs/DECISIONS.md`, `eval/backtest.py`)*
- **Held-Out Test Results (Delhi Red-Alert, $n=17$)**:
  - **Recall@25**: FloodLens `5.9%` [95% CI: 0.0–17.6%] vs Random `1.5%` [0.0–17.6%] vs Underpass Prior `11.3%` [0.0–29.4%].
  - **Recall@50**: FloodLens `11.8%` [95% CI: 0.0–29.4%] vs Random `2.8%` [0.0–29.4%] vs Underpass Prior `21.4%` [5.9–47.1%].
  - **Recall@100**: FloodLens `35.3%` [95% CI: 11.8–58.8%] vs Random `6.0%` [0.0–29.4%] vs Underpass Prior `35.3%` [17.6–64.7%].
  - **Recall@200**: FloodLens `58.8%` [95% CI: 35.3–82.4%] vs Random `10.8%` [0.0–35.3%] vs Underpass Prior `51.1%` [23.5–70.6%].  
  *(Source: `eval/results.json`, `eval/results.md`)*
- **Statistical Significance Finding**: Paired bootstrap difference (FloodLens − Underpass Prior) at $K=200$ is `+7.8%` with a 95% bootstrap CI of `[-23.5%, +35.3%]`. Because the interval spans zero, the difference is **not statistically distinguishable at $n=17$**.  
  *(Source: `eval/results.json`, `eval/results.md`)*
- **Random Baseline Pool**: Evaluated uniformly at random against the **full 41,703 study area hex pool**.  
  *(Source: `eval/results.json`, `eval/results.md`)*

---

## 4. Software Stack & Agent Architecture

- **AWS Route**: "Build It" track — runs 100% locally on laptop with zero AWS account credentials required.
- **Agent Framework**: Built using the official open-source **AWS Strands Agents SDK** (`strands-agents 1.59.0`).
- **Core Agent Tools**:
  - `get_hotspots`: Ranked flood susceptibility cells across Delhi-NCR.
  - `check_place`: Reverse-geocoded landmark risk diagnostic.
  - `pump_plan`: Greedy coverage optimizer placing mobile pumps to maximize covered flooded severity within a 1,500 m operating radius.
  - `route_risk`: Evaluates waterlogging vulnerability along multi-hex transit corridors.
  - `get_forecast`: Streams live 48-hour precipitation forecast from Open-Meteo.
- **Pump Plan Coverage Metric**:
  - At 40 mm/hr: 6 mobile pumps cover `12.2%` of total flooded severity.
  - At 60 mm/hr: 6 mobile pumps cover `6.4%` of total flooded severity.  
  *(Source: `eval/print_flooded_and_pump_plan.py`)*
- **API & Frontend**: FastAPI (`0.143.0`) + Uvicorn + MapLibre GL (`4.7.1`) + Vite (`5.4.21`) + Atkinson Hyperlegible Next typography.

---

## 5. What Is Explicitly NOT Claimed

- **Not Water Depth**: FloodLens models relative topographic susceptibility and display thresholds, NOT absolute physical water depth or hydraulic volume in meters.
- **Not Sub-Meter Street Navigation**: Grid cells are ~174 m across and operate at corridor resolution (~1 km); not street-level turn-by-turn navigation.
- **No Storm Replay**: Global ERA5 reanalysis precipitation smooths convective cloudbursts over 25–30 km grid boxes; dynamic storm replaying is not claimed.
- **No Gurugram Validation on Test Split**: Gurugram spots exist exclusively in the DEV split. Test validation is strictly Delhi-only.
- **Passive Model Only**: Does not ingest real-time drainage telemetry, pump maintenance logs, or drain siltation levels.
