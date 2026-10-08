# FloodLens

## What it is
An urban waterlogging early-warning tool for Delhi-Gurgaon. Given a rainfall scenario (mm/hr, from a live forecast or a past storm), it ranks the street-level spots most likely to waterlog first, then an AI agent helps an operator decide where to pre-position pumps and which routes to avoid.

Primary user: a municipal / traffic control room. Core question it answers: "With X mm/hr coming, which 25 spots flood first, and where do N pumps go?"

## Hackathon context (Environmental Hacks by WeMakeDevs x AWS, Track: Heat and Water)
- Judged on: (1) idea and impact, (2) built on AWS, (3) design and usability, (4) execution: working beats polished, one feature that runs beats five that almost do, (5) a 3-minute demo video.
- Prize eligibility rule: the project must use at least one AWS open-source tool OR be deployed on AWS. We are taking the BUILD IT route: runs locally on my laptop, no AWS account. The AWS open-source tool is the **Strands Agents SDK** (the agent core). Reading AWS Open Data public buckets (no credentials) is a bonus talking point.
- Deliverables: public GitHub repo, 2-3 min demo video, short writeup, blog post.
- Time is extremely tight. Optimise for a working end-to-end demo first, polish last.

## Tech stack (do not change without logging in docs/DECISIONS.md and asking me)
- Python 3.11 (conda env `floodlens`), geospatial: rasterio, geopandas, shapely, pyproj, h3 (hex grid, resolution 9), pysheds (terrain hydrology), numpy
- Data (all free, no keys):
  - Copernicus DEM 30 m, AWS Open Data bucket `copernicus-dem-30m` (anonymous S3 read; set AWS_NO_SIGN_REQUEST=YES). Verify actual tile key names by listing the bucket. Never guess them.
  - ESA WorldCover (AWS Open Data) for built-up / impervious share
  - Open-Meteo forecast and ERA5 archive API for hourly rainfall
  - OpenStreetMap (Overpass) for underpasses/tunnels/culverts as sink priors (the 30 m DEM cannot see underpasses)
- Agent: Strands Agents SDK (`strands-agents`). Model provider chosen by env var MODEL_PROVIDER (ollama | anthropic), so it is swappable.
- API: FastAPI + uvicorn
- Frontend: Vite + vanilla JS or TS + MapLibre GL (no heavy frameworks)
- Eval: scripts in `eval/`

## Study area
Bounding box: west 76.80, south 28.30, east 77.50, north 28.90 (Delhi + Gurgaon + Noida belt). Spans two DEM tiles.

## Architecture
1. engine/fetch.py: download + cache DEM tiles, WorldCover, OSM sink priors, rainfall into `data/` (gitignored, cached so we never re-download)
2. engine/terrain.py: mosaic DEM, fill depressions, flow direction, flow accumulation, HAND / TWI, depression depth
3. engine/score.py: aggregate into an H3 res-9 grid, compute a waterlogging susceptibility score for a given rainfall scenario (mm/hr), return ranked hotspots as GeoJSON
4. api/main.py: FastAPI endpoints /health, /hotspots?mm=..&top=.., /route-risk, /agent/chat
5. agent/agent.py: Strands agent with tools: get_hotspots(area, mm_per_hr), route_risk(origin, destination), pump_plan(n_pumps, mm_per_hr), get_forecast(location)
6. web/: MapLibre map, hotspot layer coloured by risk, rainfall slider, agent chat box
7. eval/: backtest.py + spots.csv (25-40 news-reported waterlogging spots from one past heavy-rain day). Metric: top-K hit rate within ~300 m, compared against two baselines (random, elevation-only). Report honestly, even if modest.

## Folder structure
floodlens/
  AGENTS.md  README.md  Makefile  environment.yml  requirements.txt  .env.example  .gitignore
  docs/ (DECISIONS.md, architecture.md)
  engine/ (fetch.py terrain.py score.py config.py)
  api/ (main.py)
  agent/ (agent.py tools.py)
  web/ (Vite app)
  eval/ (spots.csv backtest.py)
  data/ (gitignored cache)
  scripts/ (smoke_test.py)

## Working rules
- Commit after every working step with a clear message. Public repo, no secrets ever. `.env` is gitignored, `.env.example` is committed.
- Working beats polished. Build the thinnest end-to-end slice first, then deepen. Do not add features I did not ask for.
- Never invent data, results, metrics, file names or API fields. If unsure, check it (list the bucket, call the API, read the docs) and tell me what you found.
- Be honest about limits: the 30 m DEM misses underpasses; ground-truth spots come from news reports. Put these in the README.
- Keep functions small and typed, with docstrings. Cache heavy computation to disk.
- After each task, run it and show me the real output or error. Never claim something works without running it.
- If something takes longer than 20 minutes, stop, explain the blocker, and propose the simplest alternative.
- Ask me before big architectural deviations. Otherwise act without asking for permission.
