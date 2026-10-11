# FloodLens: Municipal Urban Waterlogging Early Warning for Delhi-NCR

### Problem
Every monsoon, intense rainfall paralyzes Delhi-NCR with severe street-level waterlogging. Municipal drainage control rooms face sudden cloudbursts with limited predictive intelligence, dispatching emergency dewatering pumps reactively after transit corridors are already submerged.

### What We Built
FloodLens is an urban waterlogging early-warning decision tool designed for municipal control room operators. Across 41,703 H3 resolution-9 cells (~174 m), the system calculates passive hydrological susceptibility by combining terrain elevation, Topographic Wetness Index (TWI), Height Above Nearest Drainage (HAND), urban built-up surface fractions, and subterranean underpass priors. An interactive rainfall scrubber (10–100 mm/hr) allows operators to dynamically model flood progression and pre-position emergency response assets before stormwater accumulates.

### How AWS Is Used
We selected the hackathon's "Build It" route, running entirely locally on a laptop without an active AWS cloud account or recurring infrastructure costs. The core conversational assistant is built on the **Strands Agents SDK**, an open-source AWS agent framework. The agent leverages specialized tool calling to evaluate corridor travel risk, query specific underpasses, and generate optimal greedy pump pre-positioning plans. Furthermore, our data ingestion pipeline anonymously accesses **AWS Open Data** public S3 buckets to stream Copernicus GLO-30 DEM elevation rasters and ESA WorldCover land classification tiles without requiring credentials.

### How It Was Validated
We evaluated FloodLens against 31 news-reported ground-truth waterlogging events across Delhi-NCR using an immutable matching protocol. On the held-out test split (17 spots from the July 28, 2026 Delhi red-alert event), FloodLens achieves 58.8% Recall@200 (95% CI [35.3%, 82.4%]), significantly outperforming the uniform random baseline of 10.8% across the 41,703 hex study area pool.

### Limitations
FloodLens provides relative, uncalibrated planning prioritization at corridor resolution (~1 km), not physical water depth. The 30 m Copernicus DEM captures rooftop surface models rather than subterranean culverts, and ERA5 reanalysis rainfall smooths convective thunderstorm cells.

### Next Steps
We plan to calibrate the trigger model with local municipal storm drain telemetry and IMD Doppler radar data, expanding the open data pipeline to additional vulnerable Indian urban centers.
