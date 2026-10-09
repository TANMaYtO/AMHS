"""FloodLens FastAPI application.

Provides early-warning waterlogging hotspots, model metadata, and agent endpoints:
- GET /health: Service health check
- GET /hotspots: Ranked flooded H3 hexes for a given rainfall scenario
- GET /meta: Model parameters, weights, bounding box, and uncalibrated disclaimer
- POST /agent/chat: Conversational control room agent with tool execution tracing
"""

from typing import Any
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from agent.agent import chat_with_agent_async
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
        "Ranks corridor-level (~1 km) H3 hex spots by flood severity "
        "given rainfall scenarios."
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


class ChatRequest(BaseModel):
    """Chat request payload containing message and optional conversation history."""

    message: str
    history: list[dict[str, Any]] = Field(default_factory=list)


class ToolTraceItem(BaseModel):
    """Structured representation of an executed tool call."""

    tool: str
    args: dict[str, Any]
    summary: str
    data: dict[str, Any] = Field(default_factory=dict)


class ChatResponse(BaseModel):
    """Chat response payload containing agent reply and tool execution trace."""

    reply: str
    tool_trace: list[ToolTraceItem]


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
            "scale_type": "relative_display_scale",
            "scale_note": (
                "Relative display scale for scenario visualization, "
                "not calibrated flood physics."
            ),
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
    city: str = Query(
        "all",
        description="City filter: all | delhi | gurugram",
    ),
) -> dict[str, Any]:
    """Return GeoJSON FeatureCollection of top flooded hexes ranked by severity."""
    return get_hotspots(mm_per_hr=mm, top_k=top, city=city)


@app.get("/flood-curve")
async def flood_curve_endpoint() -> dict[str, Any]:
    """Return flooded-cell counts and shares for rainfall rates 10..100 mm/hr in steps of 5."""
    df = get_scored_dataset()
    total_cells: int = len(df)
    curve_data: list[dict[str, Any]] = []
    for m in range(10, 105, 5):
        count: int = int((df["trigger_mm"] <= float(m)).sum())
        pct: float = round((count / total_cells) * 100.0, 2) if total_cells > 0 else 0.0
        curve_data.append(
            {
                "mm_per_hr": m,
                "flooded_cells": count,
                "pct": pct,
            }
        )
    return {"total_cells": total_cells, "curve": curve_data}


@app.get("/data/underpasses")
async def underpasses_endpoint() -> dict[str, Any]:
    """Return OSM underpass priors as GeoJSON FeatureCollection."""
    import json
    from engine.config import UNDERPASSES_FILE

    if UNDERPASSES_FILE.exists():
        with open(UNDERPASSES_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"type": "FeatureCollection", "features": []}


@app.get("/data/spots")
async def spots_endpoint() -> dict[str, Any]:
    """Return ground truth news-reported spots as GeoJSON FeatureCollection."""
    from pathlib import Path
    import pandas as pd

    spots_path = Path("eval/spots.csv")
    if not spots_path.exists():
        return {"type": "FeatureCollection", "features": []}

    df = pd.read_csv(spots_path)
    features: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        feat: dict[str, Any] = {
            "type": "Feature",
            "id": row["id"],
            "geometry": {
                "type": "Point",
                "coordinates": [float(row["lon"]), float(row["lat"])],
            },
            "properties": {
                "id": str(row["id"]),
                "name": str(row["name"]),
                "event_date": str(row["event_date"]),
                "geom_type": str(row["geom_type"]),
                "split": str(row["split"]),
                "confidence": str(row.get("confidence", "medium")),
            },
        }
        features.append(feat)
    return {"type": "FeatureCollection", "features": features}


@app.get("/forecast")
async def forecast_endpoint(
    location: str = Query("Delhi", description="Target location name"),
) -> dict[str, Any]:
    """Return Open-Meteo 48-hr precipitation forecast for location."""
    import json
    from agent.tools import get_forecast

    res_str = get_forecast(location)
    return json.loads(res_str)


@app.get("/eval/results")
async def eval_results_endpoint() -> dict[str, Any]:
    """Return benchmark evaluation results JSON for evidence visualization."""
    import json
    from pathlib import Path

    results_file = Path("eval/results.json")
    if not results_file.exists():
        # Fallback to baseline file if results.json not yet written
        results_file = Path("eval/baseline_top200_and_recall.json")
    if results_file.exists():
        with open(results_file, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"error": "Evaluation results not found."}


@app.post("/agent/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest) -> ChatResponse:
    """Execute conversational query with the FloodLens control room agent."""
    reply_text, traces = await chat_with_agent_async(
        message=request.message,
        history=request.history,
    )
    trace_items = [
        ToolTraceItem(
            tool=t["tool"],
            args=t["args"],
            summary=t["summary"],
            data=t.get("data", {}),
        )
        for t in traces
    ]
    return ChatResponse(reply=reply_text, tool_trace=trace_items)
