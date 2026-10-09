"""FloodLens configuration constants."""

from pathlib import Path

# ── Study area bounding box (Delhi + Gurgaon + Noida belt) ──────────
BBOX_WEST: float = 76.80
BBOX_SOUTH: float = 28.30
BBOX_EAST: float = 77.50
BBOX_NORTH: float = 28.90

# ── H3 hex grid ─────────────────────────────────────────────────────
H3_RESOLUTION: int = 9  # ~174 m edge-to-edge, ~42K hexes over bbox

# ── Paths ────────────────────────────────────────────────────────────
PROJECT_ROOT: Path = Path(__file__).resolve().parent.parent
DATA_DIR: Path = PROJECT_ROOT / "data"
DEM_DIR: Path = DATA_DIR / "dem"
WORLDCOVER_DIR: Path = DATA_DIR / "worldcover"
OSM_DIR: Path = DATA_DIR / "osm"
RAINFALL_DIR: Path = DATA_DIR / "rainfall"
CACHE_DIR: Path = DATA_DIR / "cache"
DERIVED_DIR: Path = DATA_DIR / "derived"

DEM_FILE: Path = DATA_DIR / "dem.tif"
BUILTUP_FILE: Path = DATA_DIR / "builtup.tif"
UNDERPASSES_FILE: Path = DATA_DIR / "underpasses.geojson"
HEX_FEATURES_FILE: Path = DERIVED_DIR / "hex_features.parquet"

# Ensure data dirs exist
for _d in (
    DATA_DIR,
    DEM_DIR,
    WORLDCOVER_DIR,
    OSM_DIR,
    RAINFALL_DIR,
    CACHE_DIR,
    DERIVED_DIR,
):
    _d.mkdir(parents=True, exist_ok=True)

# ── DEM & WorldCover S3 sources ──────────────────────────────────────
DEM_BUCKET: str = "copernicus-dem-30m"
DEM_RESOLUTION_M: int = 30
WORLDCOVER_BUCKET: str = "esa-worldcover"

# ── Terrain & DSM Artifact Filtering ────────────────────────────────
MIN_DEPRESSION_DEPTH_M: float = 0.25  # ignore depressions shallower than 25 cm
DEM_SMOOTHING_SIGMA: float = 0.5  # light Gaussian blur to soften roof edges
HAND_ACCUMULATION_THRESHOLD: int = 500  # cells required to initiate drainage

# ── Open-Meteo ───────────────────────────────────────────────────────
OPEN_METEO_FORECAST_URL: str = "https://api.open-meteo.com/v1/forecast"
OPEN_METEO_ARCHIVE_URL: str = "https://archive-api.open-meteo.com/v1/archive"

# ── Susceptibility Scoring Model & Feature Weights ───────────────────
# Low weight on depression depth (0.05) because Copernicus 30m DSM roof/bridge
# artifacts mean true street underpasses show ~0 depression depth.
WEIGHTS: dict[str, float] = {
    "hand_inv": 0.25,
    "twi": 0.25,
    "flow_acc": 0.15,
    "builtup": 0.15,
    "underpass_prior": 0.15,
    "depression_depth": 0.05,
}

# ── Rainfall Trigger Model Parameters ────────────────────────────────
# R_i = R_REF * exp(-K * S_i)
# At S=1.0: R = 80 * exp(-2.0) ~ 10.8 mm/hr (extreme sink spots flood first)
# At S=0.5: R = 80 * exp(-1.0) ~ 29.4 mm/hr
# At S=0.0: R = 80.0 mm/hr (high ridge lines)
R_REF: float = 80.0  # mm/hr reference ceiling
K: float = 2.0  # exponential sensitivity factor

DEFAULT_TOP_K: int = 25
DEFAULT_RAINFALL_MM: float = 40.0  # mm/hr

UNCALIBRATED_DISCLAIMER: str = (
    "RELATIVE susceptibility index based on terrain hydrology, surface "
    "impermeability, and OpenStreetMap priors. The absolute mm/hr rainfall "
    "trigger thresholds are uncalibrated assumptions designed for scenario "
    "ranking and emergency response prioritization."
)
