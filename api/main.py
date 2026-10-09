"""FloodLens FastAPI application.

Provides early-warning waterlogging hotspots and model metadata endpoints:
- GET /health: Service health check
- GET /hotspots: Ranked flooded H3 hexes for a given rainfall scenario
- GET /meta: Model parameters, weights, bounding box, and uncalibrated disclaimer
"""

from typing import Any
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from engine.config import (
    BBOX_EAST,
    BBOX_NORTH,
    BBOX_SOUTH,
    BBOX_WEST,
    DEFAULT_RAINFALL_MM,
    DEFAULT_TOP_K,
    H3_RESOLUTION,
    K,
    R_REF,
    UNCALIBRATED_DISCLAIMER,
    WEIGHTS,
)
from engine.score import get_hotspots, get_scored_dataset

app = FastAPI(
    title="FloodLens API",
    version="0.1.0",
    description=(
        "Urban waterlogging early-warning service for Delhi-Gurgaon. "
        "Ranks street-level H3 hex spots by flood severity given rainfall scenarios."
    ),
)

# Enable CORS for local Vite frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event() -> None:
    """Pre-load scored dataset into memory on startup for sub-second queries."""
    get_scored_dataset()


@app.get("/health")
async def health() -> dict[str, str]:
    """Return service health status."""
    return {"status": "ok", "service": "floodlens"}


@app.get("/meta")
async def get_metadata() -> dict[str, Any]:
    """Return model weights, bounding box, hex counts, and calibration disclaimer."""
    df = get_scored_dataset()
    return {
        "service": "floodlens",
        "study_area": {
            "name": "Delhi-Gurgaon-Noida belt",
            "bbox": {
                "west": BBOX_WEST,
                "south": BBOX_SOUTH,
                "east": BBOX_EAST,
                "north": BBOX_NORTH,
            },
        },
        "h3_resolution": H3_RESOLUTION,
        "total_hex_count": len(df),
        "weights": WEIGHTS,
        "rainfall_model": {
            "formula": "R_i = R_REF * exp(-K * S_i)",
            "r_ref_mm_hr": R_REF,
            "k_sensitivity": K,
        },
        "disclaimer": UNCALIBRATED_DISCLAIMER,
    }


@app.get("/hotspots")
async def hotspots_endpoint(
    mm: float = Query(
        DEFAULT_RAINFALL_MM,
        ge=1.0,
        le=300.0,
        description="Rainfall scenario intensity in mm/hr",
    ),
    top: int = Query(
        DEFAULT_TOP_K,
        ge=1,
        le=500,
        description="Maximum number of top flooded hexes to return",
    ),
) -> dict[str, Any]:
    """Return GeoJSON FeatureCollection of top flooded hexes ranked by severity."""
    return get_hotspots(mm_per_hr=mm, top_k=top)
