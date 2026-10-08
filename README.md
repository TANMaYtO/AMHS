# FloodLens

Urban waterlogging early-warning tool for Delhi-Gurgaon. Given a rainfall scenario (mm/hr), it ranks the street-level spots most likely to waterlog first, then an AI agent helps an operator decide where to pre-position pumps and which routes to avoid.

## Built with

- **[Strands Agents SDK](https://github.com/strands-agents/sdk-python)** — AWS open-source agent framework powering the conversational operator assistant
- **[AWS Open Data](https://registry.opendata.aws/)** — Copernicus DEM 30 m and ESA WorldCover, accessed anonymously from public S3 buckets
- Python 3.11, FastAPI, MapLibre GL JS

## Quick start

```bash
# 1. Create conda environment
conda env create -f environment.yml
conda activate floodlens

# 2. Copy env file
cp .env.example .env

# 3. Run smoke test
python scripts/smoke_test.py

# 4. Start API
uvicorn api.main:app --reload --port 8000

# 5. Start frontend (separate terminal)
cd web && npm install && npm run dev
```

## Honest limits

- **30 m DEM resolution**: Cannot resolve underpasses, narrow culverts, or storm drains. We inject known underpasses from OpenStreetMap as "sink priors", but coverage is incomplete.
- **Ground-truth quality**: Evaluation spots come from news reports of waterlogging, which provide neighborhood-level locations (not GPS coordinates). We use a ~300 m matching radius, which is generous.
- **No real-time drainage data**: The model has no information about pump station capacity, drain blockages, or ongoing construction. It is a terrain-based susceptibility estimate, not a hydraulic simulation.
- **Single-city scope**: Trained and tested only on Delhi-Gurgaon-Noida. Transferability to other cities is untested.

## License

MIT
