"""FloodLens agent tools — functions the agent can call."""

from strands import tool


@tool
def get_hotspots(mm_per_hr: float = 40.0, top_k: int = 25) -> str:
    """Return the top-K waterlogging hotspots for a given rainfall rate."""
    # TODO: wire to engine/score.py
    return f"[placeholder] Top {top_k} hotspots for {mm_per_hr} mm/hr rainfall"
