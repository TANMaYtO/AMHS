# FloodLens: Municipal Demo Video Runbook (3-Minute Script)

> **Hackathon Target**: Environmental Hacks (WeMakeDevs x AWS) — "Heat and Water" Track ("Build It" Route).  
> **Video Limit**: Maximum 3 minutes (180 seconds).

---

## 1. Pre-Flight Checklist

Before hitting record:
- [ ] **Environment**: `.env` contains valid `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-2.5-flash`, `MODEL_PROVIDER=gemini`.
- [ ] **Ports Active**: 
  - FastAPI Backend on `http://127.0.0.1:8000` (responds to `/health`).
  - Vite Frontend on `http://localhost:5173`.
- [ ] **Browser Setup**:
  - Resolution: 1920x1080 (maximize window or snap to 1080p).
  - Zoom: Exactly 100% (`Ctrl + 0`).
  - Bookmarks Bar: Hidden (`Ctrl + Shift + B`).
  - OS Notifications: Focus Assist / Do Not Disturb enabled.
- [ ] **Audio**: Test microphone clarity. Keep background noise to zero.

### Quick Start Commands
```powershell
# Terminal 1: Backend
.\.venv\Scripts\python.exe -m uvicorn api.main:app --host 127.0.0.1 --port 8000

# Terminal 2: Frontend
cd web
npm run dev
```

---

## 2. Timed 3-Minute Demo Sequence

### `0:00 – 0:20` | The Hook & The Municipal Problem
- **Visual**: Screen open on full map at the default **40 mm/hr** scenario. Left panel visible showing 1,239 flooded hexes.
- **Spoken Script**:
  > *"Every monsoon, intense rainfall paralyzes Delhi-NCR. In municipal drainage and traffic control rooms, operators face sudden cloudbursts with zero predictive visibility—dispatching dewatering pumps reactively only after buses and underpasses are already submerged.*
  > *This is FloodLens: a street-level urban waterlogging early-warning decision tool built to answer one critical question: With X mm/hr approaching, which spots flood first, and where do our pumps go?"*

### `0:20 – 0:55` | Dynamic Rainfall Scenario Scrubber
- **Visual**: Slowly drag the bottom rainfall scrubber from **20 mm/hr -> 40 mm/hr -> 60 mm/hr -> 80 mm/hr**. Show how cells turn on sequentially on the map.
- **Spoken Script**:
  > *"Across 41,703 hexagonal cells covering Delhi, Gurgaon, and Noida, FloodLens computes passive hydrological susceptibility using terrain elevation, flow accumulation, topographic wetness, and subterranean underpass priors.*
  > *As I move this rainfall scale, you see the passive flood sequence turn on: at 20 mm/hr, only the deepest sinks pond; at 60 mm/hr, over 3,900 corridor cells trigger. This is an uncalibrated relative planning index at roughly 1 km resolution, designed to show sequential vulnerability rather than water depth."*

### `0:55 – 1:25` | Ground Truth News Spots & Spatial Accuracy
- **Visual**: Toggle the **"Ground Truth Spots"** switch on the left control panel. Zoom in slightly to show the diamonds overlaying the flooded hotspots near ITO and Minto Bridge.
- **Spoken Script**:
  > *"To ensure this isn't synthetic guesswork, we validated the model against real-world ground truth: 31 news-reported waterlogging events from this year's monsoon. The hollow diamonds represent our development calibration, and solid diamonds mark our held-out test events."*

### `1:25 – 1:55` | Empirical Evidence Tab & Statistical Honesty
- **Visual**: Click the **Evidence** tab in the right dock. Point to the benchmark table and the paired difference card.
- **Spoken Script**:
  > *"Under a strictly locked evaluation protocol on our held-out test split of 17 Delhi red-alert spots, FloodLens achieves 58.8% Recall@200 with a 95% bootstrap confidence interval of 35.3% to 82.4%—massively outperforming a uniform random baseline of 10.8%.*
  > *Being scientifically honest: an underpass-prior heuristic alone achieves 51.1%. Our paired difference of +7.8% is not statistically distinguishable at n=17, but FloodLens eliminates tie-degeneracy and adds corridor-level scaling that static underpass points cannot provide."*

### `1:55 – 2:30` | The Strands AI Agent: Pump Pre-Positioning & Route Risk
- **Visual**: Click back to the **Ask** tab. Click the preset chip: `"I have 6 pumps, where should they go for 60 mm/hr?"`. Show the table render and the 1,500m pump coverage circles appear on the map.
- **Spoken Script**:
  > *"When a storm is imminent, the operator talks to our AI assistant. Here, the operator asks where 6 pumps should go for a 60 mm/hr storm. Powered by the AWS open-source Strands Agents SDK, the agent invokes our greedy spatial coverage tool.*
  > *It places 6 pumps at top underpass sinks, covering 6.4% of total flooded severity across the region. If we evaluate at 40 mm/hr, 6 pumps cover 12.2% of severity. Notice the structured tool trace pills below the answer showing deterministic data execution."*
- **Visual**: Click the second preset chip: `"Is the route from Connaught Place to Cyber City safe right now at 40 mm/hr?"`. Watch the red corridor line draw across the highway.
- **Spoken Script**:
  > *"Next, an evacuation corridor inquiry: the agent calls our route risk tool, tracing the 21.5 km corridor and flagging high-risk underpasses before dispatching emergency convoys."*

### `2:30 – 2:50` | Built on AWS & Architecture
- **Visual**: Switch tab to the GitHub README or display the Mermaid architecture diagram.
- **Spoken Script**:
  > *"FloodLens is submitted under the hackathon's 'Build It' route: running 100% locally on a laptop without an active AWS account. The entire agent core uses the open-source AWS Strands Agents SDK, and our data pipeline streams Copernicus 30 m DEM and ESA WorldCover rasters anonymously from AWS Open Data S3 buckets."*

### `2:50 – 3:00` | Conclusion & Next Steps
- **Visual**: Pan back to the full control room map canvas.
- **Spoken Script**:
  > *"Next steps: calibrating with live municipal drain telemetry and IMD Doppler radar nowcasts. FloodLens proves that combining open terrain hydrology with open-source AWS AI agents turns reactive monsoon chaos into proactive municipal preparedness. Thank you."*

---

## 3. Fallback Plan (If Agent Fails During Live Recording)

If the Gemini API key hits a rate limit or network lag during your recording:
1. **Retry Once**: Click the preset chip one more time.
2. **Pre-Captured Fallback Assets**: If the network is down, open the pre-verified screenshots saved in `docs/fallback/`:
   - `docs/fallback/preset_pumps.png` (Pump plan with map circles).
   - `docs/fallback/preset_route.png` (Corridor risk line from CP to Cyber City).
   - `docs/fallback/preset_evidence.png` (Evidence tab with bootstrap CIs).
   - `docs/fallback/preset_overview.png` (Full control room overview).

---

## 4. Recording Tips

- **Screen Recorder**: Use OBS Studio or Windows Game Bar (`Win + Alt + R`).
- **Framerate**: 1080p @ 30fps or 60fps.
- **Pacing**: Speak at a steady, authoritative tempo. Do not rush.
- **Mouse Movements**: Move the mouse smoothly to the scrubber and buttons; avoid erratic cursor shaking.
