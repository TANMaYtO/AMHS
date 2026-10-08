# FloodLens Architecture

## System Overview

FloodLens is an urban waterlogging early-warning system for the Delhi-Gurgaon-Noida belt. It couples terrain hydrology with live weather and an AI agent for control-room operators.

```
[Open-Meteo Forecast] / [Past Storm Archive]
                 │
                 ▼ (rainfall rate mm/hr)
[Copernicus DEM 30m] ──► [Terrain Hydrology] (HAND, TWI, Depression Depth)
[OSM Underpasses]    ──► [Sink Priors]
                                 │
                                 ▼
                     [H3 Res-9 Grid Scoring] (~43K hexes)
                                 │
                 ┌───────────────┴───────────────┐
                 ▼                               ▼
       [FastAPI Backend]                 [Strands Agent SDK]
         /hotspots                         - get_hotspots
         /route-risk                       - pump_plan
         /health                           - route_risk
                 │                               │
                 └───────────────┬───────────────┘
                                 ▼
                     [MapLibre GL Frontend]
                       - Risk Hex Layer
                       - Rainfall Slider
                       - Operator Chat
```

## Data Pipeline

1. **Elevation & Land Cover**: 
   - Copernicus DEM 30m from AWS Open Data (`copernicus-dem-30m`).
   - ESA WorldCover for impervious surface fraction (or OSM building density proxy).
2. **Hydrological Indices**:
   - D8 flow direction and accumulation via `pysheds`.
   - Topographic Wetness Index (TWI) and Height Above Nearest Drainage (HAND).
   - Depressions and sink identification with OSM underpass priors.
3. **Hexagonal Spatial Aggregation**:
   - Aggregate susceptibility into Uber H3 resolution 9 (~174 m cells).
   - Pre-compute and cache terrain indices to disk.
4. **Scoring Function**:
   - Dynamic susceptibility score parameterized by rainfall intensity ($mm/hr$).

## Agent & Decision Support

- Powered by **Strands Agents SDK** (AWS open-source framework).
- Configurable model backend (Ollama for offline/local, Anthropic Claude for cloud).
- Actionable tools for pump deployment and route avoidance.
