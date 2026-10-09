"""FloodLens agent tools — functions the agent can call."""

from strands import tool
from engine.score import get_hotspots as engine_get_hotspots


@tool
def get_hotspots(mm_per_hr: float = 40.0, top_k: int = 25) -> str:
    """Return the top-K waterlogging hotspots for a given rainfall scenario in mm/hr.

    Args:
        mm_per_hr: Rainfall rate in mm/hr (e.g., 30.0, 50.0).
        top_k: Number of highest-severity hotspots to return.
    """
    res = engine_get_hotspots(mm_per_hr=mm_per_hr, top_k=top_k)
    feats = res.get("features", [])
    if not feats:
        return f"No flooded hotspots detected for {mm_per_hr:.1f} mm/hr."

    total = res["metadata"]["total_flooded_hexes"]
    lines = [
        f"Top {len(feats)} of {total} flooded spots for {mm_per_hr:.1f} mm/hr rainfall:"
    ]
    for i, f in enumerate(feats, 1):
        p = f["properties"]
        place = p.get("nearest_place", f"[{p['lat']:.4f}, {p['lon']:.4f}]")
        lines.append(
            f"{i}. {place} (lat {p['lat']:.4f}, lon {p['lon']:.4f}) | "
            f"Severity: {p['severity']:.2f}x | Trigger: {p['trigger_mm']:.1f} mm/hr | "
            f"Reasons: {p['why']}"
        )
    return "\n".join(lines)
