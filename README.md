# FloodLens

Urban waterlogging early-warning tool for Delhi-Gurgaon. Given a rainfall scenario (mm/hr), it ranks the street-level spots most likely to waterlog first, then an AI agent helps an operator decide where to pre-position pumps and which routes to avoid.

## Built with

- **[Strands Agents SDK](https://github.com/strands-agents/sdk-python)** — AWS open-source agent framework powering the conversational operator assistant
- **[AWS Open Data](https://registry.opendata.aws/)** — Copernicus DEM 30 m and ESA WorldCover, accessed anonymously from public S3 buckets
- Python 3.11, FastAPI, MapLibre GL JS

## Quick start

```bash
# 1. Create virtual environment with Python 3.11 using uv
uv venv --python 3.11 .venv

# On Windows PowerShell:
.venv\Scripts\activate

# 2. Install dependencies
uv pip install -r requirements.txt

# 3. Copy env file
cp .env.example .env

# 3. Run smoke test
python scripts/smoke_test.py

# 4. Start API
uvicorn api.main:app --reload --port 8000

# 5. Start frontend (separate terminal)
cd web && npm install && npm run dev
```

## Honest limits

- **Test split is Delhi-only**: All Gurugram waterlogged spots appear exclusively in the DEV split (2026-07-08, 2026-08-06, 2026-08-25). The TEST split (2026-07-28 red-alert) is strictly Delhi-only. Consequently, **no Gurugram validation or cross-city generalization is claimed**.
- **Coarse ground-truth precision**: Ground-truth spots are extracted from journalistic reports rather than GPS survey telemetry. Locations represent landmark and intersection centroids (for points) or road midpoints (for stretches and areas), requiring spatial match tolerances (300 m / 500 m for points; 1,000 m for stretches).
- **ERA5 convective rain smoothing**: Open-Meteo historical precipitation relies on ERA5 / global reanalysis models that smooth intense localized convective thunderstorm cells across ~25–30 km grid boxes. Hourly and daily precipitation values underestimate localized cloudburst gauge totals; therefore, **no real-time dynamic storm event replay is claimed**.
- **Small sample size ($N$)**: With 14 DEV spots and 17 TEST spots, the sample size is limited, and 95% bootstrap confidence intervals are unavoidably wide.
- **Uncalibrated Relative Scoring**: The composite susceptibility score ($S \in [0, 1]$) and rainfall trigger thresholds ($R_i = R_{\text{REF}} \cdot e^{-K \cdot S_i}$) represent a *relative* prioritization index, not a physically calibrated hydrodynamic simulation. The absolute mm/hr thresholds are heuristic assumptions designed for scenario ranking and emergency prioritization, not absolute inundation depth predictions.
- **30 m DEM resolution & DSM surface model artifacts**: Copernicus GLO-30 is a surface model (DSM) capturing tree canopies and building rooftops rather than bare earth. Elevated flyovers and railway decks mask underground depressions beneath them (such as Minto Bridge and Hero Honda underpasses). We mitigate this with light Gaussian smoothing (`sigma=0.5`), filtering depressions shallower than `0.25 m` (`MIN_DEPRESSION_DEPTH_M`), and overlaying OpenStreetMap sink priors.
- **No real-time drainage telemetry**: The model does not ingest live pump station operations, drain siltation/blockage telemetry, or ongoing construction disruptions. It models passive terrain susceptibility.


## License

MIT
