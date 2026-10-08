"""FloodLens API — minimal FastAPI server."""

from fastapi import FastAPI

app = FastAPI(title="FloodLens", version="0.1.0")


@app.get("/health")
async def health() -> dict[str, str]:
    """Return service health status."""
    return {"status": "ok", "service": "floodlens"}
