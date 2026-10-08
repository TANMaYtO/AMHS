"""FloodLens configuration constants."""

from pathlib import Path

# ── Study area bounding box (Delhi + Gurgaon + Noida belt) ──────────
BBOX_WEST: float = 76.80
BBOX_SOUTH: float = 28.30
BBOX_EAST: float = 77.50
BBOX_NORTH: float = 28.90

# ── H3 hex grid ─────────────────────────────────────────────────────
H3_RESOLUTION: int = 9  # ~174 m edge-to-edge, ~43K hexes over bbox

# ── Paths ────────────────────────────────────────────────────────────
PROJECT_ROOT: Path = Path(__file__).resolve().parent.parent
DATA_DIR: Path = PROJECT_ROOT / "data"
DEM_DIR: Path = DATA_DIR / "dem"
WORLDCOVER_DIR: Path = DATA_DIR / "worldcover"
OSM_DIR: Path = DATA_DIR / "osm"
RAINFALL_DIR: Path = DATA_DIR / "rainfall"
CACHE_DIR: Path = DATA_DIR / "cache"

# Ensure data dirs exist
for _d in (DATA_DIR, DEM_DIR, WORLDCOVER_DIR, OSM_DIR, RAINFALL_DIR, CACHE_DIR):
    _d.mkdir(parents=True, exist_ok=True)

# ── DEM ──────────────────────────────────────────────────────────────
DEM_BUCKET: str = "copernicus-dem-30m"
DEM_RESOLUTION_M: int = 30

# ── WorldCover ───────────────────────────────────────────────────────
WORLDCOVER_BUCKET: str = "esa-worldcover"

# ── Open-Meteo ───────────────────────────────────────────────────────
OPEN_METEO_FORECAST_URL: str = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_ARCHIVE_URL: str = "https://archive-api.open-meteo.com/v1/archive"

# ── Scoring defaults ─────────────────────────────────────────────────
DEFAULT_TOP_K: int = 25
DEFAULT_RAINFALL_MM: float = 40.0  # mm/hr
