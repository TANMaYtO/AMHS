# FloodLens Frontend Design Specification: Hydrologist's Survey Sheet

## 1. Context & Core Direction

- **Audience**: Municipal drainage control room operators in Delhi-NCR (and evaluation reviewers watching a 3-minute demonstration).
- **Primary Function**: Evaluate rainfall scenarios, identify corridor-level clusters (~1 km) susceptible to waterlogging first, dispatch drainage pumps via AI assistance, and assess safe transit corridors.
- **Tone & Aesthetic**: "Hydrologist's survey sheet". Cartographic clarity, cool-grey paper aesthetic, high legibility under emergency room stress, scientific honesty, and zero artificial dashboard clutter.

---

## 2. Design Tokens & Visual Hierarchy

### Color Tokens (CSS Variables)

```css
:root {
  /* Surface & Base */
  --color-paper: #EEF1F2;          /* Clean survey paper background */
  --color-surface: #FFFFFF;        /* Elevated card/popover surface */
  --color-surface-subtle: #F4F6F7; /* Subtle section contrast */
  --color-rule: #C9D1D6;           /* Cartographic borders and dividers */
  --color-rule-light: #E0E5E8;     /* Secondary hairline rules */

  /* Typography */
  --color-ink: #1B2A3A;            /* Primary deep ink text */
  --color-ink-muted: #536474;      /* Secondary descriptive text */
  --color-ink-faint: #7E8E9E;      /* Captions and tertiary labels */

  /* Interactive Elements */
  --color-control: #2F6F9F;        /* Survey control blue (USED ONLY FOR CONTROLS) */
  --color-control-hover: #245A82;  /* Control blue hover */
  --color-control-active: #1D4767; /* Control blue active */
  --color-control-light: #EBF2F7;  /* Control background tint */

  /* Risk Ramp (Sequential, Color-Blind-Safe: Light Amber to Dark Crimson) */
  /* Note: Blue is strictly excluded from risk encoding to avoid confusing risk with water depth */
  --risk-1: #F6D58E; /* Baseline trigger (severity 1.0x) */
  --risk-2: #F0A24B; /* Low-moderate convergence (severity 1.5x) */
  --risk-3: #E4572E; /* Elevated susceptibility (severity 2.5x) */
  --risk-4: #A8325A; /* High waterlogging potential (severity 4.0x) */
  --risk-5: #5B1A3A; /* Severe chronic depression (>5.0x) */

  /* Ground Truth Spot Symbology */
  /* Encoded strictly by geometric shape, not hue */
  --spot-dev: #1B2A3A;  /* Ink outline, hollow diamond */
  --spot-test: #1B2A3A; /* Ink outline, solid filled diamond */
}
```

### Typography System

- **Typeface**: `Atkinson Hyperlegible Next`, designed by the Braille Institute for maximum character disambiguation and legibility under high operational stress.
- **Numbers**: Tabular numerals enabled universally (`font-variant-numeric: tabular-nums lining-nums;`) across all statistics, coordinates, timestamps, and data tables.
- **Casing**: Strict **sentence case** across all headers, buttons, popovers, labels, and table columns. No uppercase yelling or spaced-out capital section titles.
- **No Monospace**: Excluded from UI elements, coordinates, and data displays.
- **Type Scale**:
  - `40px` (2.5rem) / Line-height 1.1: Rainfall scenario primary readout.
  - `22px` (1.375rem) / Line-height 1.25: View headings, primary modal titles.
  - `16px` (1.0rem) / Line-height 1.4: Section titles, chat messages, table text.
  - `14px` (0.875rem) / Line-height 1.4: Secondary interface labels, buttons, controls, list text.
  - `12px` (0.75rem) / Line-height 1.35: Small captions, timestamps, legal disclosures.

---

## 3. Layout Wireframe

```
+-----------------------------------------------------------------------------------------------+
| FloodLens  Delhi-NCR drainage planning                                     About this model [?] |
+-------------------------------------------------------------+---------------------------------+
| [City: All | Delhi | Gurugram]  [Show: 25 | 100 | 200]  [Layers v] | Ask | Evidence                |
|                                                             |                                 |
|                     Full-Bleed Map Canvas                   | Docked Panel (400px width)      |
|           (Esri World Light Gray Canvas Basemap)            |                                 |
|                                                             | [Ask Tab]                       |
|   - Hexagonal flooded cells (risk ramp #F6D58E..#5B1A3A)    | - Operational prompts           |
|   - News-reported spots (diamonds: hollow=Dev, solid=Test)  | - Plain readable agent replies  |
|   - Pump deployment radius circles (dashed stroke)          | - Numbered tool sequences       |
|   - Evacuation corridor route line                          | - Interactive pump/route tables |
|                                                             |                                 |
|   Caption: "Relative risk index for planning at about 1 km. | [Evidence Tab]                  |
|             Not a forecast of water depth."                 | - Dot-and-whisker plot (CIs)    |
|                                                             | - Paired difference statement   |
|                                                             | - Collapsible table             |
+-------------------------------------------------------------+---------------------------------+
|  Rainfall scale: wide curve of cells-that-flood vs mm/hr (10..100) + draggable marker          |
|  Readout: "3,951 cells may waterlog at 60 mm/hr"                     [ Use forecast peak ]     |
+-----------------------------------------------------------------------------------------------+
```

---

## 4. Key Component Architecture

### A. Memorable Rainfall Scale (Bottom Anchor)
- **Data Source**: Populated dynamically from new `GET /flood-curve` endpoint returning flooded cell counts across $10..100\text{ mm/hr}$ in $5\text{ mm/hr}$ increments.
- **Visualization**: Survey-sheet SVG area curve with cool grey fill and rule stroke, integrated interactive scrubber marker, and vertical dashed indicator line.
- **Direct Readout**: Clear $40\text{px}$ tabular readout (`3,951 cells may waterlog at 60 mm/hr`).
- **Keyboard Operability**: Arrow keys (`ArrowLeft`, `ArrowRight`, `Home`, `End`) increment scenario rainfall by $5\text{ mm/hr}$.
- **Action**: Direct `Use forecast peak` secondary button fetching live Open-Meteo peak rate.

### B. Map Floating Control Bar
- Placed directly over the top-left map area as a docked survey strip:
  - **City Selector**: `All NCR`, `Delhi`, `Gurugram`.
  - **Hotspot Volume**: `Top 25`, `Top 100`, `Top 200`.
  - **Layers Popover**: Compact dropdown with toggles for Flooded cells, Ground-truth spots, Underpasses, and Agent overlays.
- Permanent map status caption in bottom-left corner of canvas.

### C. Right Docked Panel (400px Fixed)
- Clean two-tab navigation: **Ask** and **Evidence**.
- **Ask Tab**:
  - Operational query chips with sentence-case prompts.
  - Linear message flow; agent answers formatted as readable operational prose.
  - Tool execution traces formatted as a concise numbered step list (e.g. `1. Scanned 41,703 H3 cells for 60 mm/hr threshold`, `2. Selected 6 pump sites covering high-severity clusters`).
  - Pump/route results formatted in compact survey tables with sentence-case headers; **clicking any row smoothly flies the map (`flyTo`) to the designated coordinate**.
  - Cell IDs hidden within an expandable `<details>` summary disclosure to prevent visual noise.
- **Evidence Tab**:
  - Replaces tabular overwhelm with an SVG **dot-and-interval whisker plot** comparing FloodLens against baselines across $K=100$ and $K=200$ with $95\%$ bootstrap confidence interval whiskers.
  - Stated sample size callout ($N=17$ test spots from 2026-07-28 red-alert event).
  - Explicit sentence reporting paired bootstrap difference vs underpass baseline: *At K=200, FloodLens achieves 58.8% recall vs 51.1% for underpass prior only (+7.8% difference, 95% CI [-23.5%, +35.3%], not statistically distinguishable at alpha=0.05).*
  - Collapsible full numerical table below with scroll support and negative zeros clamped.

### D. "About This Model" Modal Dialog
- Accessible via subtle button in top-right header.
- Explains:
  - Frozen model status (`v1-model-frozen`).
  - H3 res-9 geometry (~174 m edge, ~1 km corridor planning).
  - Relative display scale disclosure (not physically calibrated inundation depths).
  - Data sources: Copernicus GLO-30 DEM, ESA WorldCover 2021, OpenStreetMap, IMD historical event news logs.
  - Honest operational limits.

---

## 5. Anti-Pattern Critique & Design Revisions

| Evaluated Anti-Pattern | Initial State in Codebase | Survey Sheet Revision | Concrete Reason for Change |
|---|---|---|---|
| **Near-black background with glowing cyan/neon accent** | Deep `#0f172a` navy background with `#38bdf8` cyan glows. | Light cartographic paper `#EEF1F2` and Esri Light Gray Canvas basemap. | Emergency control rooms are high-ambient-light environments; paper/grey palettes mimic government hydrological survey maps and improve document readability. |
| **Tracked-out ALL-CAPS section labels** | `RAINFALL SCENARIO`, `HOTSPOT FILTERS`, `MAP LAYERS`. | Sentence case: `Rainfall scenario`, `Hotspot filters`, `Map layers`. | All-caps with letter-spacing reads like an AI dashboard template and reduces legibility speed under stress. |
| **Monospace numbers and badges** | Monospace UTC clock, monospace cell IDs, monospace coordinates. | Tabular numerals in Atkinson Hyperlegible Next (`font-variant-numeric: tabular-nums`). | Monospace looks like a developer console rather than a civil emergency tool; tabular proportional figures keep alignments clean while matching the font family. |
| **Gradient washes & glowing severity ramps** | Bright cyan-to-amber-to-red glow gradient (`#38bdf8` to `#b91c1c`). | Color-blind-safe sequential warm ramp (`#F6D58E` to `#5B1A3A`). Blue is strictly avoided for risk. | Blue implies water depth in cartography, which misleads operators since FloodLens outputs relative susceptibility, not inundation depth. |
| **Rows of pills as primary controls** | Prominent pill button groups for Top-N and cities in left sidebar. | Unified survey toolbar floating directly on the map with quiet borders. | Eliminates cluttered multi-button button grids and focuses attention on the map canvas. |
| **Status-chip bar in header** | Header filled with 4 colored status badges (`MODEL: FROZEN`, `H3 RES-9`, etc.). | Clean survey title bar with a single "About this model" action popover. | Status chip ribbons clutter the header; technical metadata belongs in documentation disclosures, not distracting headers. |
| **Emoji & glyph icons** | Cloud emojis `&#9729;` and arrow triangles `&#9658;`. | Pure text actions with clear descriptive verbs (`Use forecast peak`, numbered steps). | Emojis degrade official institutional credibility. |
| **Blue risk encoding** | Severity 1.0x styled with `#38bdf8` light blue. | Severity 1.0x styled with pale amber `#F6D58E`. | Avoids false impression of standing water depth. |
| **Unformatted hex IDs** | Raw 15-character hex strings (`893da114083ffff`) presented as primary table columns. | Landmark / underpass names presented as primary, hex ID tucked in `<details>` fold. | Operators navigate by intersections and physical drains, not hexadecimal hashes. |
| **Wall of evaluation numbers** | Dense 8x6 percentage table with small font sizes. | Visual dot-and-whisker plot for primary comparison; table in collapsible drawer. | Whisker plots visually convey confidence interval overlap and uncertainty immediately. |
| **Left panel taking 280px of screen width** | Fixed left sidebar compressing map to center. | Full-bleed map from edge to edge; rainfall scale anchored at bottom. | The map is the primary spatial artifact; full-bleed layout maximizes geographic context. |

---

## 6. Implementation Checklist & Verification Gates

1. Verify `@fontsource/atkinson-hyperlegible-next` self-hosted font loading.
2. Verify Esri World Light Gray Canvas tiles load without API keys or watermarks.
3. Add `GET /flood-curve` endpoint in `api/main.py` without touching scoring or weights.
4. Replace `web/index.html`, `web/style.css`, and `web/main.js` with the survey sheet architecture.
5. Capture real screenshots at 1920x1080 and 1366x768 to confirm layout integrity across viewports.
6. Verify regression checklist before commit.
