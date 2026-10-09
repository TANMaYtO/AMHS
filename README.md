# FloodLens

Urban waterlogging early-warning tool for Delhi-Gurgaon. Given a rainfall scenario (mm/hr), it ranks the corridor-level (~1 km) spots most likely to waterlog first, then an AI agent helps an operator decide where to pre-position pumps and which routes to avoid.

## Built with

- **[Strands Agents SDK](https://github.com/strands-agents/sdk-python)** — AWS open-source agent framework powering the conversational operator assistant
- **[AWS Open Data](https://registry.opendata.aws/)** — Copernicus DEM 30 m and ESA WorldCover, accessed anonymously from public S3 buckets
- Python 3.11, FastAPI, MapLibre GL JS

## Quick start

### On Windows (PowerShell)

```powershell
# 1. Create virtual environment with Python 3.11 using uv
uv venv --python 3.11 .venv

# 2. Activate virtual environment
.\.venv\Scripts\Activate.ps1

# 3. Install dependencies
uv pip install -r requirements.txt

# 4. Copy configuration
Copy-Item .env.example .env

# 5. Run smoke test
.\.venv\Scripts\python scripts/smoke_test.py

# 6. Start FastAPI backend (Terminal 1)
.\.venv\Scripts\python -m uvicorn api.main:app --host 127.0.0.1 --port 8000

# 7. Start Vite control room frontend (Terminal 2)
cd web
npm install
npm run dev
```

### On Windows (Command Prompt `cmd.exe`)

```cmd
:: 1. Activate venv
.venv\Scripts\activate.bat

:: 2. Start FastAPI backend
python -m uvicorn api.main:app --host 127.0.0.1 --port 8000

:: 3. Start Frontend (in web\)
cd web && npm install && npm run dev
```

### Using Makefile (Linux / macOS / Git Bash)

```bash
# Setup environment & install packages
make setup

# Run smoke test verification
make smoke

# Start API server on port 8000
make api

# Start Vite frontend on port 5173
make web
```

## Honest limits

- **Corridor-level resolution (~1 km)**: While the H3 res-9 grid has ~174 m edge-to-edge cell geometry, ground-truth waterlogging events in dense urban centers occur along interconnected transit corridors. The system functions as a corridor-level early warning prioritization tool, not sub-meter street-level GPS tracking.
- **Test split is Delhi-only**: All Gurugram waterlogged spots appear exclusively in the DEV split (2026-07-08, 2026-08-06, 2026-08-25). The TEST split (2026-07-28 red-alert) is strictly Delhi-only. Consequently, **no Gurugram validation or cross-city generalization is claimed**.
- **Coarse ground-truth precision & Point recall**: Ground-truth spots are extracted from journalistic reports rather than GPS survey telemetry. Locations represent landmark and intersection centroids (for points) or road midpoints (for stretches and areas), requiring spatial match tolerances (300 m / 500 m for points; 1,000 m for stretches). Notably, **point-spot recall at 300 m was 0 of 3 on test ($n=3$)**, rising to 1 of 3 (33.3%) only at the relaxed 500 m tolerance.
- **Underpass prior buffer limit (150 m)**: The OpenStreetMap underpass prior is assigned only to hexes whose center is within ~150 m of an underpass point. Consequently, Minto Bridge (where the geocoded underpass node is 244 m from the nearest hex center) is missed by the prior in its host hex.
- **ERA5 convective rain smoothing**: Open-Meteo historical precipitation relies on ERA5 / global reanalysis models that smooth intense localized convective thunderstorm cells across ~25–30 km grid boxes. Hourly and daily precipitation values underestimate localized cloudburst gauge totals; therefore, **no real-time dynamic storm event replay is claimed**.
- **Small sample size ($N$)**: With 14 DEV spots and 17 TEST spots, the sample size is limited, and 95% bootstrap confidence intervals are unavoidably wide.
- **Uncalibrated Relative Scoring & Display Scale**: The composite susceptibility score ($S \in [0, 1]$) and rainfall trigger thresholds ($R_i = R_{\text{REF}} \cdot e^{-K \cdot S_i}$, with $R_{\text{REF}} = 8200$, $K = 7.60$) represent a **relative prioritization index and display scale, not physically calibrated flood inundation depths**. The display scale produces realistic relative flooded shares for operational exploration (20 mm/hr ~0.5%, 40 mm/hr ~3%, 60 mm/hr ~9.5%, 80 mm/hr ~16%, 100 mm/hr ~22.4%), while ranking by $S$ and evaluation recall remain strictly invariant.
- **30 m DEM resolution & DSM surface model artifacts**: Copernicus GLO-30 is a surface model (DSM) capturing tree canopies and building rooftops rather than bare earth. Elevated flyovers and railway decks mask underground depressions beneath them (such as Minto Bridge and Hero Honda underpasses). We mitigate this with light Gaussian smoothing (`sigma=0.5`), filtering depressions shallower than `0.25 m` (`MIN_DEPRESSION_DEPTH_M`), and overlaying OpenStreetMap sink priors.
- **No real-time drainage telemetry**: The model does not ingest live pump station operations, drain siltation/blockage telemetry, or ongoing construction disruptions. It models passive terrain susceptibility.



## License

MIT
