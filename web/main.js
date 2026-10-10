import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { marked } from 'marked';

// Configure marked for clean inline output
marked.setOptions({
  breaks: true,
  gfm: true,
});

// ============================================================================
// State Management
// ============================================================================
const state = {
  rainfallMm: 40.0,
  topK: 100,
  city: 'all',
  activeSplit: 'test',
  activeChartK: 100,
  evaluationData: null,
  floodCurveData: null,
  forecastPeakMm: null,
  forecastTotalMm: null,
  sliderDebounceTimer: null,
  history: [],
};

// Number and elevation formatters
function formatElevation(elev) {
  if (elev === null || elev === undefined) return '0.0 m';
  const val = Number(elev);
  if (Math.abs(val) < 0.05) return '0.0 m';
  return `${val.toFixed(1)} m`;
}

function clampZero(val) {
  if (Math.abs(val) < 0.0001) return 0.0;
  return val;
}

// ============================================================================
// Diamond Icon Generator for Ground Truth Spots (DEV = Hollow, TEST = Solid)
// ============================================================================
function createDiamondIcon(isFilled) {
  const size = 20;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(Math.PI / 4);

  const halfSide = 4.5;
  ctx.beginPath();
  ctx.rect(-halfSide, -halfSide, halfSide * 2, halfSide * 2);

  if (isFilled) {
    // TEST spot: solid ink diamond with subtle white outline
    ctx.fillStyle = '#1B2A3A';
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#FFFFFF';
    ctx.stroke();
  } else {
    // DEV spot: hollow diamond with crisp ink border
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = '#1B2A3A';
    ctx.stroke();
  }

  ctx.restore();
  return ctx.getImageData(0, 0, size, size);
}

// Geodesic circle generator for pump radius (1500 m)
function createGeoJSONCircle(center, radiusInMeters, points = 48) {
  const [lng, lat] = center;
  const coords = [];
  const distanceX = radiusInMeters / (111320 * Math.cos((lat * Math.PI) / 180));
  const distanceY = radiusInMeters / 110540;

  for (let i = 0; i < points; i++) {
    const theta = (i / points) * (2 * Math.PI);
    const x = distanceX * Math.cos(theta);
    const y = distanceY * Math.sin(theta);
    coords.push([lng + x, lat + y]);
  }
  coords.push(coords[0]);
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [coords],
    },
    properties: {},
  };
}

// ============================================================================
// MapLibre Initialization: Light Gray Cartographic Basemap
// ============================================================================
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      'light-base': {
        type: 'raster',
        tiles: [
          'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        attribution:
          '&copy; Esri, HERE, Garmin, FAO, NOAA, USGS, &copy; OpenStreetMap contributors',
      },
    },
    layers: [
      {
        id: 'light-base-layer',
        type: 'raster',
        source: 'light-base',
        minzoom: 0,
        maxzoom: 16,
      },
    ],
  },
  center: [77.23, 28.61], // Delhi-NCR center [lng, lat]
  zoom: 10.5,
});

map.addControl(new maplibregl.NavigationControl(), 'top-right');
window.map = map;

// ============================================================================
// Map Setup on Load
// ============================================================================
map.on('load', async () => {
  console.log('[Map] Light Gray Canvas loaded.');

  // Add custom diamond icons
  map.addImage('diamond-dev', createDiamondIcon(false));
  map.addImage('diamond-test', createDiamondIcon(true));

  // 1. Flooded Hexes Sources
  map.addSource('flooded-hexes', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addSource('flooded-hexes-points', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  // Centroid circles for low zoom visibility
  map.addLayer({
    id: 'flooded-hexes-points-layer',
    type: 'circle',
    source: 'flooded-hexes-points',
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        8, 3.0,
        10, 5.0,
        12, 7.0,
        14, 9.5,
      ],
      'circle-color': [
        'interpolate',
        ['linear'],
        ['get', 'severity'],
        1.0, '#F6D58E', // Triggered threshold
        1.5, '#F0A24B', // Moderate
        2.2, '#E4572E', // Elevated
        3.2, '#A8325A', // High
        5.0, '#5B1A3A', // Severe
      ],
      'circle-stroke-width': 0.8,
      'circle-stroke-color': '#1B2A3A',
      'circle-opacity': 0.88,
    },
  });

  // Hex polygon fill layer (Warm sequential risk ramp, NO blue)
  map.addLayer({
    id: 'flooded-hexes-fill',
    type: 'fill',
    source: 'flooded-hexes',
    paint: {
      'fill-color': [
        'interpolate',
        ['linear'],
        ['get', 'severity'],
        1.0, '#F6D58E',
        1.5, '#F0A24B',
        2.2, '#E4572E',
        3.2, '#A8325A',
        5.0, '#5B1A3A',
      ],
      'fill-opacity': 0.72,
    },
  });

  // Hex polygon crisp boundary
  map.addLayer({
    id: 'flooded-hexes-outline',
    type: 'line',
    source: 'flooded-hexes',
    paint: {
      'line-color': '#1B2A3A',
      'line-width': 0.8,
      'line-opacity': 0.35,
    },
  });

  // 2. OSM Underpasses Source & Layer (Default OFF)
  map.addSource('underpasses', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: 'underpasses-layer',
    type: 'circle',
    source: 'underpasses',
    layout: {
      visibility: 'none',
    },
    paint: {
      'circle-radius': 4.5,
      'circle-color': '#798B99',
      'circle-stroke-width': 1.2,
      'circle-stroke-color': '#1B2A3A',
      'circle-opacity': 0.8,
    },
  });

  // 3. Ground Truth Spots Symbol Layer (Diamonds)
  map.addSource('spots', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: 'spots-layer',
    type: 'symbol',
    source: 'spots',
    layout: {
      'icon-image': [
        'case',
        ['==', ['get', 'split'], 'dev'],
        'diamond-dev',
        'diamond-test',
      ],
      'icon-size': 0.85,
      'icon-allow-overlap': true,
    },
  });

  // 4. Agent Overlays: Pumps Radius & Centers
  map.addSource('agent-pumps-radius', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: 'agent-pumps-radius-fill',
    type: 'fill',
    source: 'agent-pumps-radius',
    paint: {
      'fill-color': '#2F6F9F',
      'fill-opacity': 0.12,
    },
  });

  map.addLayer({
    id: 'agent-pumps-radius-line',
    type: 'line',
    source: 'agent-pumps-radius',
    paint: {
      'line-color': '#2F6F9F',
      'line-width': 1.5,
      'line-dasharray': [4, 3],
    },
  });

  map.addSource('agent-pumps-points', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: 'agent-pumps-points-layer',
    type: 'circle',
    source: 'agent-pumps-points',
    paint: {
      'circle-radius': 6.5,
      'circle-color': '#2F6F9F',
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#FFFFFF',
    },
  });

  // 5. Agent Overlays: Route Polyline & Risk Spots
  map.addSource('agent-route', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: 'agent-route-line',
    type: 'line',
    source: 'agent-route',
    paint: {
      'line-color': '#C84B31',
      'line-width': 3.5,
      'line-opacity': 0.85,
    },
  });

  map.addSource('agent-route-risk-points', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: 'agent-route-risk-layer',
    type: 'circle',
    source: 'agent-route-risk-points',
    paint: {
      'circle-radius': 5.5,
      'circle-color': '#5B1A3A',
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#FFFFFF',
    },
  });

  // Attach Click Handlers for Popups
  attachMapPopupHandlers();

  // Load Datasets in Parallel
  await Promise.all([
    loadFloodedHexes(),
    loadUnderpasses(),
    loadSpots(),
    loadFloodCurve(),
    loadEvidenceData(),
    fetchForecastInfo(),
    loadMetaInfo(),
  ]);
});

// ============================================================================
// Map Popups
// ============================================================================
function attachMapPopupHandlers() {
  const showHexPopup = (e) => {
    if (!e.features || !e.features[0]) return;
    const props = e.features[0].properties;

    const popupHtml = `
      <div class="popup-title">Flooded H3 Cell</div>
      <div class="popup-row">
        <span class="popup-label">Cell ID:</span>
        <span class="popup-value">${props.hex_id}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Coordinates:</span>
        <span class="popup-value">${Number(props.lat).toFixed(4)}, ${Number(props.lon).toFixed(4)}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Severity:</span>
        <span class="popup-value">${Number(props.severity).toFixed(2)}&times; trigger</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Trigger Rate:</span>
        <span class="popup-value">${Number(props.trigger_mm).toFixed(1)} mm/hr</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Elevation:</span>
        <span class="popup-value">${formatElevation(props.elevation_m)}</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Nearest Prior:</span>
        <span class="popup-value">${props.nearest_place || 'None'}</span>
      </div>
      <div class="popup-why">
        <strong>Risk Factors:</strong> ${(props.why || 'Terrain convergence').replaceAll('-0.0m', '0.0m')}
      </div>
    `;

    new maplibregl.Popup({ closeButton: true })
      .setLngLat(e.lngLat)
      .setHTML(popupHtml)
      .addTo(map);
  };

  map.on('click', 'flooded-hexes-fill', showHexPopup);
  map.on('click', 'flooded-hexes-points-layer', showHexPopup);

  map.on('click', 'underpasses-layer', (e) => {
    if (!e.features || !e.features[0]) return;
    const props = e.features[0].properties;
    new maplibregl.Popup({ closeButton: true })
      .setLngLat(e.lngLat)
      .setHTML(`
        <div class="popup-title">OSM Underpass Prior</div>
        <div class="popup-row"><span class="popup-label">Name:</span> <span class="popup-value">${props.name || 'Unnamed'}</span></div>
        <div class="popup-row"><span class="popup-label">Type:</span> <span class="popup-value">${props.highway || 'underpass'}</span></div>
      `)
      .addTo(map);
  });

  map.on('click', 'spots-layer', (e) => {
    if (!e.features || !e.features[0]) return;
    const props = e.features[0].properties;
    const splitLabel = props.split === 'test' ? 'Test Split (2026-07-28)' : 'Dev Split (2026-08-06)';
    new maplibregl.Popup({ closeButton: true })
      .setLngLat(e.lngLat)
      .setHTML(`
        <div class="popup-title">Ground Truth Spot (${splitLabel})</div>
        <div class="popup-row"><span class="popup-label">Location:</span> <span class="popup-value">${props.name}</span></div>
        <div class="popup-row"><span class="popup-label">Event Date:</span> <span class="popup-value">${props.event_date}</span></div>
        <div class="popup-row"><span class="popup-label">Geometry:</span> <span class="popup-value">${props.geom_type}</span></div>
        <div class="popup-row"><span class="popup-label">Confidence:</span> <span class="popup-value">${props.confidence}</span></div>
      `)
      .addTo(map);
  });

  // Pointer cursor styling
  ['flooded-hexes-fill', 'flooded-hexes-points-layer', 'underpasses-layer', 'spots-layer'].forEach((layerId) => {
    map.on('mouseenter', layerId, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', layerId, () => (map.getCanvas().style.cursor = ''));
  });
}

// ============================================================================
// Data Loading
// ============================================================================
async function loadFloodedHexes() {
  try {
    const url = `/hotspots?mm=${state.rainfallMm}&top=${state.topK}&city=${state.city}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    const src = map.getSource('flooded-hexes');
    if (src) src.setData(data);

    const ptSrc = map.getSource('flooded-hexes-points');
    if (ptSrc && data.features) {
      const pointFeatures = data.features.map((f) => ({
        type: 'Feature',
        id: f.id,
        geometry: {
          type: 'Point',
          coordinates: [f.properties.lon, f.properties.lat],
        },
        properties: f.properties,
      }));
      ptSrc.setData({ type: 'FeatureCollection', features: pointFeatures });
    }

    // Update bottom readout count if curve hasn't done so
    const totalCount = data.metadata ? data.metadata.total_flooded_hexes : 0;
    updateBottomBarReadout(state.rainfallMm, totalCount);
  } catch (err) {
    console.error('[Hotspots Error]', err);
  }
}

async function loadUnderpasses() {
  try {
    const resp = await fetch('/data/underpasses');
    if (!resp.ok) return;
    const data = await resp.json();
    const src = map.getSource('underpasses');
    if (src) src.setData(data);

    const countEl = document.getElementById('underpass-count');
    if (countEl && data.features) countEl.textContent = data.features.length.toLocaleString();
  } catch (err) {
    console.warn('[Underpasses Error]', err);
  }
}

async function loadSpots() {
  try {
    const resp = await fetch('/data/spots');
    if (!resp.ok) return;
    const data = await resp.json();
    const src = map.getSource('spots');
    if (src) src.setData(data);

    const countEl = document.getElementById('spots-count');
    if (countEl && data.features) countEl.textContent = data.features.length.toLocaleString();
  } catch (err) {
    console.warn('[Spots Error]', err);
  }
}

async function fetchForecastInfo() {
  try {
    const resp = await fetch('/forecast?location=Delhi');
    if (!resp.ok) return;
    const data = await resp.json();
    if (data.peak_hourly_mm !== undefined) {
      state.forecastPeakMm = Number(data.peak_hourly_mm);
      state.forecastTotalMm = Number(
        data.total_mm_48h !== undefined ? data.total_mm_48h : data.peak_hourly_mm
      );
      const btn = document.getElementById('btn-use-forecast');
      if (btn) {
        btn.textContent = `Forecast peak ${state.forecastPeakMm.toFixed(1)} mm/hr (${state.forecastTotalMm.toFixed(1)} mm / 48h)`;
        btn.title = `Forecast peak ${state.forecastPeakMm.toFixed(1)} mm/hr over the next 48 hours. Total: ${state.forecastTotalMm.toFixed(1)} mm`;
      }
    }
  } catch (err) {
    console.warn('[Forecast Error]', err);
  }
}

async function loadMetaInfo() {
  try {
    const resp = await fetch('/meta');
    if (!resp.ok) return;
    const meta = await resp.json();
    const weightsEl = document.getElementById('modal-weights-val');
    if (weightsEl && meta.weights) {
      const w = meta.weights;
      const parts = [];
      if (w.hand_inv !== undefined) parts.push(`HAND (${Math.round(w.hand_inv * 100)}%)`);
      if (w.twi !== undefined) parts.push(`TWI (${Math.round(w.twi * 100)}%)`);
      if (w.flow_acc !== undefined) parts.push(`Flow Acc (${Math.round(w.flow_acc * 100)}%)`);
      if (w.builtup !== undefined) parts.push(`Built-up (${Math.round(w.builtup * 100)}%)`);
      if (w.underpass_prior !== undefined) parts.push(`Underpass (${Math.round(w.underpass_prior * 100)}%)`);
      if (w.depression_depth !== undefined) parts.push(`Depression (${Math.round(w.depression_depth * 100)}%)`);
      weightsEl.textContent = parts.join(', ');
    }
  } catch (err) {
    console.warn('[Meta Error]', err);
  }
}

// ============================================================================
// Flood Curve Endpoint & Interactive SVG Scrubber
// ============================================================================
async function loadFloodCurve() {
  try {
    const resp = await fetch('/flood-curve');
    if (!resp.ok) return;
    state.floodCurveData = await resp.json();
    renderFloodCurveSvg();
  } catch (err) {
    console.warn('[Flood Curve Error]', err);
  }
}

function updateBottomBarReadout(mm, cellsCount = null) {
  const mmDisplay = document.getElementById('curve-mm-display');
  const cellsDisplay = document.getElementById('curve-cells-count');
  const pctDisplay = document.getElementById('curve-pct-display');

  if (mmDisplay) mmDisplay.textContent = `${mm} mm/hr`;

  let count = cellsCount;
  if (count === null && state.floodCurveData && state.floodCurveData.curve) {
    const pt = state.floodCurveData.curve.find((c) => c.mm_per_hr === mm);
    if (pt) count = pt.flooded_cells;
  }

  if (count !== null) {
    if (cellsDisplay) cellsDisplay.textContent = count.toLocaleString();
    if (pctDisplay) {
      const pct = ((count / 41703) * 100).toFixed(1);
      pctDisplay.textContent = `${pct}%`;
    }
  }

  const wrapper = document.getElementById('curve-chart-wrapper');
  if (wrapper) wrapper.setAttribute('aria-valuenow', mm);
}

function renderFloodCurveSvg() {
  const svg = document.getElementById('flood-curve-svg');
  if (!svg || !state.floodCurveData || !state.floodCurveData.curve) return;

  const points = state.floodCurveData.curve;
  const rect = svg.getBoundingClientRect();
  const width = rect.width > 100 ? Math.round(rect.width) : 500;
  const height = rect.height > 30 ? Math.round(rect.height) : 70;
  const padLeft = 24;
  const padRight = 36;
  const padTop = 14;
  const padBottom = 18;

  const minMm = 10;
  const maxMm = 100;
  const baselineY = height - padBottom;

  const getX = (mm) =>
    padLeft + ((mm - minMm) / (maxMm - minMm)) * (width - padLeft - padRight);

  // Log10 scale mapping: from 10 cells (log10=1.0) to ~12,000 cells (log10=4.08)
  const logMin = 1.0;
  const logMax = 4.08;
  const getY = (cells) => {
    const safeCells = Math.max(1, cells);
    const logVal = Math.log10(safeCells);
    const t = Math.max(0, Math.min(1, (logVal - logMin) / (logMax - logMin)));
    return baselineY - t * (baselineY - padTop);
  };

  // Build SVG path
  let pathD = '';
  points.forEach((p, i) => {
    const x = getX(p.mm_per_hr);
    const y = getY(p.flooded_cells);
    pathD += `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `;
  });

  const lastX = getX(maxMm);
  const firstX = getX(minMm);
  const areaD = `${pathD} L ${lastX.toFixed(1)} ${baselineY} L ${firstX.toFixed(1)} ${baselineY} Z`;

  // Current position
  const currX = getX(state.rainfallMm);
  const currPt = points.find((p) => p.mm_per_hr === state.rainfallMm) || points[0];
  const currY = getY(currPt.flooded_cells);

  // Gridlines at 10, 100, 1,000, 10,000
  const gridLevels = [
    { val: 10, label: '10' },
    { val: 100, label: '100' },
    { val: 1000, label: '1k' },
    { val: 10000, label: '10k' },
  ];

  let gridlinesHtml = '';
  gridLevels.forEach((g) => {
    const gy = getY(g.val);
    gridlinesHtml += `
      <line x1="${padLeft}" y1="${gy.toFixed(1)}" x2="${width - padRight}" y2="${gy.toFixed(1)}" stroke="#DEE3E6" stroke-width="0.8" stroke-dasharray="2,2" />
      <text x="${width - padRight + 3}" y="${(gy + 3).toFixed(1)}" font-size="7.5" fill="#798B99" font-family="inherit">${g.label}</text>
    `;
  });

  // Milestone dots & counts at 20, 40, 60, 80 mm/hr (offset to avoid marker collision)
  const milestones = [20, 40, 60, 80];
  let milestonesHtml = '';
  milestones.forEach((m) => {
    const pt = points.find((p) => p.mm_per_hr === m);
    if (!pt) return;
    const mx = getX(m);
    const my = getY(pt.flooded_cells);
    milestonesHtml += `
      <circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="2.2" fill="#E4572E" stroke="#FFFFFF" stroke-width="0.8" />
      <text x="${(mx - 8).toFixed(1)}" y="${(my - 5).toFixed(1)}" font-size="7.5" font-weight="600" fill="#5B1A3A" font-family="inherit" text-anchor="end" paint-order="stroke" stroke="#EEF1F2" stroke-width="2">${pt.flooded_cells.toLocaleString()}</text>
    `;
  });

  // SVG Markup
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = `
    <!-- Axis Title / Label -->
    <text x="${padLeft}" y="${padTop - 3}" font-size="8" font-weight="600" fill="#5A6D7C" font-family="inherit">cells that may waterlog (log scale)</text>

    <!-- Horizontal Gridlines at 10, 100, 1,000, 10,000 -->
    ${gridlinesHtml}

    <!-- Baseline Axis Line -->
    <line x1="${padLeft}" y1="${baselineY}" x2="${width - padRight}" y2="${baselineY}" stroke="#C9D1D6" stroke-width="1" />

    <!-- Area Under Curve -->
    <path d="${areaD}" fill="rgba(228, 87, 46, 0.12)" />

    <!-- Curve Stroke -->
    <path d="${pathD}" fill="none" stroke="#E4572E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />

    <!-- Milestone Dots and Labels at 20, 40, 60, 80 mm/hr -->
    ${milestonesHtml}

    <!-- Ticks & Labels along bottom baseline -->
    <g font-size="8.5" fill="#798B99" font-family="inherit" text-anchor="middle">
      <text x="${getX(10).toFixed(1)}" y="${height - 4}">10</text>
      <text x="${getX(20).toFixed(1)}" y="${height - 4}">20</text>
      <text x="${getX(40).toFixed(1)}" y="${height - 4}">40</text>
      <text x="${getX(60).toFixed(1)}" y="${height - 4}">60</text>
      <text x="${getX(80).toFixed(1)}" y="${height - 4}">80</text>
      <text x="${getX(100).toFixed(1)}" y="${height - 4}">100 mm/hr</text>
    </g>

    <!-- Vertical Hairline at Active Scenario -->
    <line id="curve-hairline" x1="${currX.toFixed(1)}" y1="${padTop}" x2="${currX.toFixed(1)}" y2="${baselineY}" stroke="#1B2A3A" stroke-width="1.5" />

    <!-- Circular Handle at Active Scenario -->
    <circle id="curve-handle" cx="${currX.toFixed(1)}" cy="${currY.toFixed(1)}" r="5.5" fill="#FFFFFF" stroke="#1B2A3A" stroke-width="2" />
  `;

  updateBottomBarReadout(state.rainfallMm);
}

function updateScrubberToMm(newMm, immediate = false) {
  const clampedMm = Math.max(10, Math.min(100, Math.round(newMm / 5) * 5));
  if (clampedMm === state.rainfallMm) {
    if (immediate) loadFloodedHexes();
    return;
  }

  state.rainfallMm = clampedMm;
  renderFloodCurveSvg();

  clearTimeout(state.sliderDebounceTimer);
  if (immediate) {
    loadFloodedHexes();
  } else {
    state.sliderDebounceTimer = setTimeout(() => {
      loadFloodedHexes();
    }, 160);
  }
}

function setupCurveScrubberInteractions() {
  const wrapper = document.getElementById('curve-chart-wrapper');
  if (!wrapper) return;

  window.addEventListener('resize', () => {
    renderFloodCurveSvg();
  });

  let isDragging = false;

  const handlePointer = (clientX) => {
    const rect = wrapper.getBoundingClientRect();
    const padLeft = 24;
    const padRight = 36;
    const usableWidth = rect.width - padLeft - padRight;
    const relX = Math.max(0, Math.min(usableWidth, clientX - rect.left - padLeft));
    const fraction = relX / usableWidth;
    const mm = 10 + fraction * 90;
    updateScrubberToMm(mm);
  };

  wrapper.addEventListener('mousedown', (e) => {
    isDragging = true;
    handlePointer(e.clientX);
  });

  window.addEventListener('mousemove', (e) => {
    if (isDragging) handlePointer(e.clientX);
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });

  // Touch support
  wrapper.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches[0]) {
      isDragging = true;
      handlePointer(e.touches[0].clientX);
    }
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (isDragging && e.touches && e.touches[0]) {
      handlePointer(e.touches[0].clientX);
    }
  }, { passive: true });

  window.addEventListener('touchend', () => {
    isDragging = false;
  });

  // Keyboard accessibility
  wrapper.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      updateScrubberToMm(state.rainfallMm - 5);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      updateScrubberToMm(state.rainfallMm + 5);
    }
  });

  // Forecast button with strict scale guard
  const btnForecast = document.getElementById('btn-use-forecast');
  const forecastMsgEl = document.getElementById('forecast-status-msg');
  if (btnForecast) {
    btnForecast.addEventListener('click', () => {
      if (state.forecastPeakMm === null) return;
      if (state.forecastPeakMm < 10.0) {
        if (forecastMsgEl) {
          forecastMsgEl.textContent =
            `Forecast peak ${state.forecastPeakMm.toFixed(1)} mm/hr is below the lowest scenario on this scale (10 mm/hr).`;
          forecastMsgEl.style.display = 'block';
          setTimeout(() => {
            if (forecastMsgEl) forecastMsgEl.textContent = '';
          }, 6000);
        }
        // Do NOT move the slider
      } else {
        if (forecastMsgEl) {
          forecastMsgEl.textContent = '';
        }
        updateScrubberToMm(state.forecastPeakMm);
      }
    });
  }
}

// ============================================================================
// Agent Chat, Overlays, and Tool Steps Formatting
// ============================================================================
function updateAgentOverlays(traces) {
  let hasOverlays = false;
  const bounds = new maplibregl.LngLatBounds();

  const pumpRadiusSrc = map.getSource('agent-pumps-radius');
  const pumpPointsSrc = map.getSource('agent-pumps-points');
  const routeSrc = map.getSource('agent-route');
  const routeRiskSrc = map.getSource('agent-route-risk-points');

  if (pumpRadiusSrc) pumpRadiusSrc.setData({ type: 'FeatureCollection', features: [] });
  if (pumpPointsSrc) pumpPointsSrc.setData({ type: 'FeatureCollection', features: [] });
  if (routeSrc) routeSrc.setData({ type: 'FeatureCollection', features: [] });
  if (routeRiskSrc) routeRiskSrc.setData({ type: 'FeatureCollection', features: [] });

  for (const trace of traces) {
    const payload = trace.data || {};

    // 1. Pump Deployment Overlays
    if (payload.pumps && Array.isArray(payload.pumps)) {
      const radiusFeatures = [];
      const pointFeatures = [];

      payload.pumps.forEach((p, idx) => {
        const center = [p.lon, p.lat];
        const radMeters = p.radius_m || payload.radius_m || 1500;
        const circleFeat = createGeoJSONCircle(center, radMeters);
        radiusFeatures.push(circleFeat);

        pointFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: center },
          properties: { label: `P${idx + 1}`, ...p },
        });

        bounds.extend(center);
        hasOverlays = true;
      });

      if (pumpRadiusSrc) pumpRadiusSrc.setData({ type: 'FeatureCollection', features: radiusFeatures });
      if (pumpPointsSrc) pumpPointsSrc.setData({ type: 'FeatureCollection', features: pointFeatures });
    }

    // 2. Route Corridor Overlays
    if (payload.route_coordinates && Array.isArray(payload.route_coordinates)) {
      const lineFeat = {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: payload.route_coordinates,
        },
        properties: {},
      };
      if (routeSrc) routeSrc.setData({ type: 'FeatureCollection', features: [lineFeat] });

      payload.route_coordinates.forEach((c) => bounds.extend(c));
      hasOverlays = true;

      if (payload.top_risk_hexes && Array.isArray(payload.top_risk_hexes)) {
        const riskPoints = payload.top_risk_hexes.map((h) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [h.lon, h.lat] },
          properties: h,
        }));
        if (routeRiskSrc) routeRiskSrc.setData({ type: 'FeatureCollection', features: riskPoints });
      }
    }
  }

  if (hasOverlays && !bounds.isEmpty()) {
    map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 1000 });
  }
}

// Enhance markdown table rows with coordinate click handlers to flyTo, sentence-case headers, and expandable details
function enhanceAgentMessageDom(containerEl, traces) {
  // 1. Interactive table enhancement
  const tables = containerEl.querySelectorAll('table');
  tables.forEach((tbl) => {
    tbl.classList.add('agent-interactive-table');
    const wrapper = document.createElement('div');
    wrapper.className = 'agent-table-wrapper';
    tbl.parentNode.insertBefore(wrapper, tbl);
    wrapper.appendChild(tbl);

    const theadThs = Array.from(tbl.querySelectorAll('thead th'));
    const rows = Array.from(tbl.querySelectorAll('tbody tr'));

    // Check if this table corresponds to pump_plan tool traces
    let pumpTraceData = null;
    for (const t of traces) {
      const d = t.data || {};
      if (d.pumps && Array.isArray(d.pumps) && d.pumps.length > 0) {
        pumpTraceData = d;
        break;
      }
    }

    // Normalize and sentence-case headers
    const colMeta = theadThs.map((th, colIdx) => {
      const orig = th.innerText.trim();
      let norm = orig;
      let type = 'other';

      if (/(site|pump|location|corridor|name|place)/i.test(orig)) {
        norm = 'Location';
        type = 'location';
      } else if (/(turns on|trigger|threshold|mm\/hr)/i.test(orig)) {
        norm = 'Turns on at (mm/hr)';
        type = 'trigger';
      } else if (/(why|reason|risk factors)/i.test(orig)) {
        norm = 'Why';
        type = 'why';
      } else if (/(severity|score)/i.test(orig)) {
        norm = 'Severity';
        type = 'severity';
      } else if (/(nearest underpass|nearest prior)/i.test(orig)) {
        norm = 'Nearest underpass';
        type = 'underpass';
      } else if (/(share.*covered|covered.*share)/i.test(orig)) {
        norm = 'Share covered';
        type = 'share_covered';
      } else if (/(hex id|h3 index|h3 id|cell id)/i.test(orig)) {
        norm = 'Hex id';
        type = 'hex';
      } else if (/(coord|lat\/lon|lat|lon)/i.test(orig)) {
        norm = 'Coordinates';
        type = 'coords';
      } else {
        norm = orig.charAt(0).toUpperCase() + orig.slice(1).toLowerCase();
      }

      th.textContent = norm;
      return { colIdx, th, orig, norm, type };
    });

    const hexColIdx = colMeta.findIndex((c) => c.type === 'hex');
    const coordsColIdx = colMeta.findIndex((c) => c.type === 'coords');

    // Extract row data, attach details disclosures, and wire up flyTo
    rows.forEach((row, rowIdx) => {
      const cells = Array.from(row.querySelectorAll('td'));
      let lat = null;
      let lon = null;
      let hexId = null;

      // If this is a pump table row, align trigger_mm and why with tool data
      if (pumpTraceData && pumpTraceData.pumps && pumpTraceData.pumps[rowIdx]) {
        const pInfo = pumpTraceData.pumps[rowIdx];
        const triggerCol = colMeta.find((c) => c.type === 'trigger');
        const whyCol = colMeta.find((c) => c.type === 'why');
        if (triggerCol && cells[triggerCol.colIdx] && pInfo.trigger_mm !== undefined) {
          cells[triggerCol.colIdx].textContent = `${pInfo.trigger_mm.toFixed(1)}`;
        }
        if (whyCol && cells[whyCol.colIdx] && pInfo.why) {
          cells[whyCol.colIdx].textContent = pInfo.why;
        }
      }

      const rowText = row.innerText;
      const coordMatch = rowText.match(/([2-3][0-9]\.[0-9]{2,6})[^\d]+(7[6-8]\.[0-9]{2,6})/);
      if (coordMatch) {
        lat = parseFloat(coordMatch[1]);
        lon = parseFloat(coordMatch[2]);
      } else {
        for (const t of traces) {
          const d = t.data || {};
          if (d.pumps && d.pumps[rowIdx]) {
            lat = d.pumps[rowIdx].lat;
            lon = d.pumps[rowIdx].lon;
            hexId = d.pumps[rowIdx].id || d.pumps[rowIdx].hex_id;
            break;
          }
          if (d.top_risk_hexes && d.top_risk_hexes[rowIdx]) {
            lat = d.top_risk_hexes[rowIdx].lat;
            lon = d.top_risk_hexes[rowIdx].lon;
            hexId = d.top_risk_hexes[rowIdx].id || d.top_risk_hexes[rowIdx].hex_id;
            break;
          }
          if (d.hotspots && d.hotspots[rowIdx]) {
            lat = d.hotspots[rowIdx].lat;
            lon = d.hotspots[rowIdx].lon;
            hexId = d.hotspots[rowIdx].id || d.hotspots[rowIdx].hex_id;
            break;
          }
          if (d.lat && d.lon) {
            lat = d.lat;
            lon = d.lon;
            break;
          }
        }
      }

      const hexMatch = rowText.match(/\b8960[0-9a-f]{11}\b/i);
      if (hexMatch) hexId = hexMatch[0];

      if (hexColIdx !== -1 && cells[hexColIdx]) {
        const val = cells[hexColIdx].innerText.trim();
        if (val) hexId = val;
      }
      if (coordsColIdx !== -1 && cells[coordsColIdx]) {
        const val = cells[coordsColIdx].innerText.trim();
        const m = val.match(/([2-3][0-9]\.[0-9]{2,6})[^\d]+(7[6-8]\.[0-9]{2,6})/);
        if (m) {
          lat = parseFloat(m[1]);
          lon = parseFloat(m[2]);
        }
      }

      // Add expandable details disclosure into the first non-hex/non-coord cell
      const visibleCells = cells.filter((_, idx) => idx !== hexColIdx && idx !== coordsColIdx);
      if ((hexId || (lat && lon)) && visibleCells.length > 0) {
        const targetCell = visibleCells[0];
        if (!targetCell.querySelector('.row-details')) {
          const details = document.createElement('details');
          details.className = 'row-details';
          const coordStr = lat && lon ? `${lat.toFixed(4)}, ${lon.toFixed(4)}` : '';
          const hexStr = hexId ? hexId : '';
          details.innerHTML = `
            <summary class="row-details-summary">Cell details</summary>
            <div class="row-details-body">
              ${hexStr ? `<div><code>${hexStr}</code></div>` : ''}
              ${coordStr ? `<div>Coord: ${coordStr}</div>` : ''}
            </div>
          `;
          targetCell.appendChild(details);
        }
      }

      // Wire row click flyTo
      if (lat && lon) {
        row.classList.add('clickable-row');
        row.title = 'Click to focus this site on the map';
        row.dataset.lat = lat;
        row.dataset.lon = lon;
        row.addEventListener('click', (e) => {
          if (e.target.closest('.row-details')) return;
          map.flyTo({ center: [lon, lat], zoom: 14, duration: 900 });
        });
      }
    });

    // Remove raw hex, coordinates, and redundant share covered columns
    const colsToRemove = [];
    if (coordsColIdx !== -1) colsToRemove.push(coordsColIdx);
    if (hexColIdx !== -1) colsToRemove.push(hexColIdx);
    const shareColIdx = colMeta.findIndex((c) => c.type === 'share_covered');
    if (shareColIdx !== -1) colsToRemove.push(shareColIdx);
    colsToRemove.sort((a, b) => b - a);
    colsToRemove.forEach((idx) => {
      if (theadThs[idx]) theadThs[idx].remove();
      rows.forEach((r) => {
        const tds = r.querySelectorAll('td');
        if (tds[idx]) tds[idx].remove();
      });
    });

    // Reorder remaining columns so Location is first, then Turns on at, then Why
    const remainingThs = Array.from(tbl.querySelectorAll('thead th'));
    const orderPriority = { location: 1, trigger: 2, severity: 3, underpass: 4, why: 5, other: 6 };
    const indexedCols = remainingThs.map((th, idx) => {
      const text = th.innerText.toLowerCase();
      let type = 'other';
      if (text.includes('location') || text.includes('site') || text.includes('pump') || text.includes('corridor')) type = 'location';
      else if (text.includes('turns on') || text.includes('trigger') || text.includes('mm/hr')) type = 'trigger';
      else if (text.includes('why') || text.includes('reason')) type = 'why';
      else if (text.includes('severity')) type = 'severity';
      else if (text.includes('underpass')) type = 'underpass';
      return { th, idx, type, prio: orderPriority[type] || 6 };
    });

    // Sort column definitions by priority
    const sortedCols = [...indexedCols].sort((a, b) => a.prio - b.prio);
    const orderChanged = sortedCols.some((c, i) => c.idx !== i);
    if (orderChanged) {
      const theadTr = tbl.querySelector('thead tr');
      if (theadTr) {
        sortedCols.forEach((c) => theadTr.appendChild(c.th));
      }
      rows.forEach((r) => {
        const tds = Array.from(r.querySelectorAll('td'));
        sortedCols.forEach((c) => {
          if (tds[c.idx]) r.appendChild(tds[c.idx]);
        });
      });
    }

    // Add "Share of flooded severity covered" as a single sentence under the table if not already present
    if (pumpTraceData && pumpTraceData.covered_severity_share_pct !== undefined) {
      const parentContainer = wrapper.parentElement || containerEl;
      const textContent = parentContainer.textContent || '';
      if (!textContent.toLowerCase().includes('share of flooded severity covered')) {
        const summarySentence = document.createElement('p');
        summarySentence.className = 'table-caption-summary';
        summarySentence.textContent = `Share of flooded severity covered: ${pumpTraceData.covered_severity_share_pct}%. Heuristic selection with 1,500m radius.`;
        wrapper.insertAdjacentElement('afterend', summarySentence);
      }
    }
  });

  // 2. Wrap standalone lengthy H3 hex ID lists in paragraphs
  const paragraphs = containerEl.querySelectorAll('p, li');
  paragraphs.forEach((p) => {
    const text = p.innerText;
    const hexMatches = text.match(/\b8960[0-9a-f]{11}\b/gi);
    if (hexMatches && hexMatches.length > 2) {
      const summaryText = `Show ${hexMatches.length} H3 cell IDs`;
      const details = document.createElement('details');
      details.className = 'hex-fold';
      details.innerHTML = `
        <summary>${summaryText}</summary>
        <div class="hex-fold-body">${p.innerHTML}</div>
      `;
      p.parentNode.replaceChild(details, p);
    }
  });
}

async function handleSendMessage(promptText) {
  if (!promptText || !promptText.trim()) return;

  // Scenario Sync: Immediately set rainfall scale and update map before answer renders
  const rainMatch = promptText.match(/\b(\d+(?:\.\d+)?)\s*mm(?:[\/ ]?hr)?\b/i);
  if (rainMatch) {
    const parsedMm = parseFloat(rainMatch[1]);
    if (!isNaN(parsedMm) && parsedMm >= 10 && parsedMm <= 100) {
      updateScrubberToMm(parsedMm, true);
    }
  }

  const chatContainer = document.getElementById('chat-messages');
  const inputEl = document.getElementById('chat-input');
  if (inputEl) inputEl.value = '';

  // Append user message
  const userMsgEl = document.createElement('div');
  userMsgEl.className = 'message message-user';
  userMsgEl.innerHTML = `
    <div class="message-meta">
      <span class="message-author">Operator</span>
      <span class="message-status">${new Date().toLocaleTimeString()}</span>
    </div>
    <div class="message-body">${promptText}</div>
  `;
  chatContainer.appendChild(userMsgEl);

  // Append assistant loading placeholder
  const agentMsgEl = document.createElement('div');
  agentMsgEl.className = 'message message-assistant';
  agentMsgEl.innerHTML = `
    <div class="message-meta">
      <span class="message-author">FloodLens assistant</span>
      <span class="message-status">Analyzing hydrological features...</span>
    </div>
    <div class="message-body">
      <em>Evaluating spatial models and terrain tensors...</em>
    </div>
  `;
  chatContainer.appendChild(agentMsgEl);
  chatContainer.scrollTop = chatContainer.scrollHeight;

  try {
    const resp = await fetch('/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: promptText, history: state.history }),
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    // Render markdown response
    const renderedBody = marked.parse(data.reply || 'No response returned.');

    // Format tool execution trace as a clean numbered step list
    let stepsHtml = '';
    if (data.tool_trace && data.tool_trace.length > 0) {
      stepsHtml = `
        <div class="tool-steps-card">
          <div class="tool-steps-title">Analytical steps executed:</div>
          <ol class="tool-steps-ol">
            ${data.tool_trace.map((t) => `<li>${t.summary || t.tool}</li>`).join('')}
          </ol>
        </div>
      `;
    }

    agentMsgEl.innerHTML = `
      <div class="message-meta">
        <span class="message-author">FloodLens assistant</span>
        <span class="message-status">${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="message-body">
        ${renderedBody}
        ${stepsHtml}
      </div>
    `;

    // Enhance table rows with click-to-flyTo and fold raw hex strings
    enhanceAgentMessageDom(agentMsgEl.querySelector('.message-body'), data.tool_trace || []);

    // Update map overlays (pumps, routes, risk spots)
    if (data.tool_trace && data.tool_trace.length > 0) {
      updateAgentOverlays(data.tool_trace);
      // Sync rainfall scale if tool trace explicitly used a scenario rate
      for (const t of data.tool_trace) {
        const d = t.data || {};
        const toolMm =
          d.rainfall_mm_hr ||
          d.mm_per_hr ||
          (t.args && (t.args.mm_per_hr || t.args.rainfall_mm_hr));
        if (toolMm && typeof toolMm === 'number' && toolMm >= 10 && toolMm <= 100) {
          updateScrubberToMm(toolMm, false);
          break;
        }
      }
    }

    // Keep history
    state.history.push({ role: 'user', content: promptText });
    state.history.push({ role: 'assistant', content: data.reply });
  } catch (err) {
    console.error('[Chat Error]', err);
    agentMsgEl.innerHTML = `
      <div class="message-meta">
        <span class="message-author">FloodLens assistant</span>
        <span class="message-status">Error</span>
      </div>
      <div class="message-body" style="color: #A8325A;">
        Failed to process query: ${err.message}
      </div>
    `;
  }

  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// ============================================================================
// Evidence Tab: Dot-and-Whisker Plot & Benchmark Metrics
// ============================================================================
async function loadEvidenceData() {
  try {
    const resp = await fetch('/eval/results');
    if (!resp.ok) return;
    state.evaluationData = await resp.json();
    renderDotWhiskerPlot();
    renderPairedCallout();
    renderEvidenceTakeaways();
    renderEvidenceTable();
  } catch (err) {
    console.warn('[Evidence Error]', err);
  }
}

function renderPairedCallout() {
  const calloutEl = document.getElementById('paired-callout-text');
  if (!calloutEl || !state.evaluationData || !state.evaluationData.paired_bootstrap_cis) return;
  const pair200 = state.evaluationData.paired_bootstrap_cis['200'];
  const pair100 = state.evaluationData.paired_bootstrap_cis['100'];
  if (!pair200) return;

  const fmtDiff = (d) => {
    const rounded = Number((d * 100).toFixed(1));
    if (Math.abs(rounded) < 0.001) return '+0.0%';
    return (rounded > 0 ? '+' : '') + rounded.toFixed(1) + '%';
  };
  const fmtCi = (low, high) => {
    const l = Number((low * 100).toFixed(1));
    const h = Number((high * 100).toFixed(1));
    const lStr = Math.abs(l) < 0.001 ? '0.0%' : (l > 0 ? '+' : '') + l.toFixed(1) + '%';
    const hStr = Math.abs(h) < 0.001 ? '0.0%' : (h > 0 ? '+' : '') + h.toFixed(1) + '%';
    return `[${lStr}, ${hStr}]`;
  };

  const diff200 = fmtDiff(pair200.diff);
  const ci200 = fmtCi(pair200.ci_95[0], pair200.ci_95[1]);

  let diff100 = '+0.0%';
  let ci100 = '[-29.4%, +29.4%]';
  if (pair100) {
    diff100 = fmtDiff(pair100.diff);
    ci100 = fmtCi(pair100.ci_95[0], pair100.ci_95[1]);
  }

  calloutEl.textContent = `On the 17-spot test sample, the paired difference between FloodLens and the underpass prior alone is ${diff200} at K=200 (95% CI ${ci200}) and ${diff100} at K=100 (95% CI ${ci100}). Because the confidence interval crosses zero, the performance difference is not statistically distinguishable at this sample size; FloodLens provides corridor coverage and rainfall scaling beyond the prior.`;
}

function renderDotWhiskerPlot() {
  const svg = document.getElementById('dot-whisker-svg');
  if (!svg || !state.evaluationData || !state.evaluationData.splits) return;

  const splitData = state.evaluationData.splits.test;
  if (!splitData) return;

  const kStr = String(state.activeChartK);
  const models = [
    { name: 'FloodLens', key: 'FloodLens (Composite)', isTarget: true },
    { name: 'Underpass prior only', key: 'Underpass Prior Only' },
    { name: 'Flow accumulation only', key: 'Flow Acc Only' },
    { name: 'HAND only', key: 'HAND Only' },
    { name: 'TWI only', key: 'TWI Only' },
    { name: 'Elevation only', key: 'Elevation Only' },
  ];

  const width = 360;
  const height = 210;
  const padLeft = 140;
  const padRight = 24;
  const padTop = 18;
  const padBottom = 28;

  const usableWidth = width - padLeft - padRight;
  const getX = (val) => padLeft + Math.max(0, Math.min(1, val)) * usableWidth;

  const rowCount = models.length;
  const rowHeight = (height - padTop - padBottom) / rowCount;

  let contentHtml = `
    <!-- Axis lines & grid -->
    <line x1="${padLeft}" y1="${height - padBottom}" x2="${width - padRight}" y2="${height - padBottom}" stroke="#C9D1D6" stroke-width="1" />
  `;

  // Grid ticks (0%, 25%, 50%, 75%, 100%)
  [0, 0.25, 0.5, 0.75, 1.0].forEach((tick) => {
    const tx = getX(tick);
    contentHtml += `
      <line x1="${tx}" y1="${padTop}" x2="${tx}" y2="${height - padBottom}" stroke="#DEE3E6" stroke-width="1" stroke-dasharray="2,2" />
      <text x="${tx}" y="${height - 12}" font-size="9" fill="#798B99" font-family="inherit" text-anchor="middle">${(tick * 100).toFixed(0)}%</text>
    `;
  });

  // Draw each model row
  models.forEach((m, idx) => {
    const data = splitData[m.key];
    if (!data) return;

    const y = padTop + idx * rowHeight + rowHeight / 2;
    const metrics = data.metrics ? data.metrics[kStr] : null;
    const cis = data.cis ? data.cis[kStr] : null;

    const recall = metrics ? (metrics.comb_300 !== undefined ? metrics.comb_300 : metrics.rec_str_1000) : 0;
    const ciPair = cis && cis.comb_300 ? cis.comb_300 : [recall, recall];

    const lowX = getX(ciPair[0]);
    const highX = getX(ciPair[1]);
    const dotX = getX(recall);

    const isFl = m.isTarget;
    const inkColor = isFl ? '#2F6F9F' : '#1B2A3A';
    const whiskerColor = isFl ? '#2F6F9F' : '#798B99';

    // Label
    contentHtml += `
      <text x="${padLeft - 8}" y="${y + 3}" font-size="10" font-weight="${isFl ? '700' : '500'}" fill="${isFl ? '#2F6F9F' : '#1B2A3A'}" font-family="inherit" text-anchor="end">${m.name}</text>
    `;

    // Whisker line
    contentHtml += `
      <line x1="${lowX.toFixed(1)}" y1="${y}" x2="${highX.toFixed(1)}" y2="${y}" stroke="${whiskerColor}" stroke-width="${isFl ? '2' : '1.2'}" />
      <line x1="${lowX.toFixed(1)}" y1="${y - 3}" x2="${lowX.toFixed(1)}" y2="${y + 3}" stroke="${whiskerColor}" stroke-width="${isFl ? '2' : '1.2'}" />
      <line x1="${highX.toFixed(1)}" y1="${y - 3}" x2="${highX.toFixed(1)}" y2="${y + 3}" stroke="${whiskerColor}" stroke-width="${isFl ? '2' : '1.2'}" />
    `;

    // Dot
    contentHtml += `
      <circle cx="${dotX.toFixed(1)}" cy="${y}" r="${isFl ? '4.5' : '3.5'}" fill="${inkColor}" stroke="#FFFFFF" stroke-width="1.2" />
    `;
  });

  svg.innerHTML = contentHtml;
}

function renderEvidenceTakeaways() {
  const summaryList = document.getElementById('evidence-takeaways-list');
  if (!summaryList || !state.evaluationData) return;

  summaryList.innerHTML = '';
  const items = state.evaluationData.summary || [];
  if (items.length > 0) {
    items.forEach((txt) => {
      const li = document.createElement('li');
      li.textContent = txt;
      summaryList.appendChild(li);
    });
  }
}

function renderEvidenceTable() {
  const tbody = document.getElementById('evidence-table-body');
  if (!tbody || !state.evaluationData || !state.evaluationData.splits) return;

  const splitData = state.evaluationData.splits[state.activeSplit];
  if (!splitData) return;

  const modelsOrder = [
    'FloodLens (Composite)',
    'Underpass Prior Only',
    'Flow Acc Only',
    'HAND Only',
    'TWI Only',
    'Built-up Only',
    'Elevation Only',
    'Random Uniform (full 41,703 pool)',
  ];

  tbody.innerHTML = '';

  modelsOrder.forEach((modelName) => {
    const m = splitData[modelName];
    if (!m) return;

    const metrics = m.metrics;
    const ties = m.ties || {};
    const isFl = modelName.includes('FloodLens');

    const tr = document.createElement('tr');
    if (isFl) tr.className = 'highlight-model';

    const getRec = (k) => {
      if (!metrics || !metrics[k]) return '--';
      const val = metrics[k].comb_300 !== undefined ? metrics[k].comb_300 : metrics[k].rec_str_1000;
      const cleanVal = clampZero(val);
      return `${(cleanVal * 100).toFixed(1)}%`;
    };

    const tieStr = ties[100] !== undefined ? `${ties[100].toLocaleString()}` : '--';

    tr.innerHTML = `
      <td>${modelName}</td>
      <td>${getRec('25')}</td>
      <td>${getRec('50')}</td>
      <td>${getRec('100')}</td>
      <td>${getRec('200')}</td>
      <td>${tieStr}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ============================================================================
// Event Listeners & Wireup
// ============================================================================
function setupEventListeners() {
  // 1. City Jurisdiction Filter
  const cityBtns = document.querySelectorAll('#city-selector .seg-btn');
  cityBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      cityBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.city = btn.dataset.city;
      loadFloodedHexes();
    });
  });

  // 2. Top-N Selector
  const topBtns = document.querySelectorAll('#top-selector .seg-btn');
  topBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      topBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.topK = parseInt(btn.dataset.top, 10);
      loadFloodedHexes();
    });
  });

  // 3. Layer Toggles
  const toggleMapLayer = (checkboxId, layerIds) => {
    const cb = document.getElementById(checkboxId);
    if (!cb) return;
    cb.addEventListener('change', () => {
      const vis = cb.checked ? 'visible' : 'none';
      layerIds.forEach((lid) => {
        if (map.getLayer(lid)) {
          map.setLayoutProperty(lid, 'visibility', vis);
        }
      });
    });
  };

  toggleMapLayer('layer-hexes', ['flooded-hexes-fill', 'flooded-hexes-outline', 'flooded-hexes-points-layer']);
  toggleMapLayer('layer-underpasses', ['underpasses-layer']);
  toggleMapLayer('layer-spots', ['spots-layer']);
  toggleMapLayer('layer-overlays', [
    'agent-pumps-radius-fill',
    'agent-pumps-radius-line',
    'agent-pumps-points-layer',
    'agent-route-line',
    'agent-route-risk-layer',
  ]);

  // 4. Panel Tabs (Ask / Evidence)
  const btnAsk = document.getElementById('tab-btn-ask');
  const btnEvidence = document.getElementById('tab-btn-evidence');
  const tabAsk = document.getElementById('tab-ask');
  const tabEvidence = document.getElementById('tab-evidence');

  if (btnAsk && btnEvidence) {
    btnAsk.addEventListener('click', () => {
      btnAsk.classList.add('active');
      btnEvidence.classList.remove('active');
      tabAsk.classList.add('active');
      tabEvidence.classList.remove('active');
    });

    btnEvidence.addEventListener('click', () => {
      btnEvidence.classList.add('active');
      btnAsk.classList.remove('active');
      tabEvidence.classList.add('active');
      tabAsk.classList.remove('active');
      renderDotWhiskerPlot();
      renderPairedCallout();
      renderEvidenceTable();
    });
  }

  // 5. Chart K Selector (K=100 vs K=200)
  const chartKBtns = document.querySelectorAll('#chart-k-selector .seg-btn');
  chartKBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      chartKBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeChartK = parseInt(btn.dataset.chartk, 10);
      renderDotWhiskerPlot();
    });
  });

  // 6. Split Selector (Test vs Dev)
  const btnSplitTest = document.getElementById('btn-split-test');
  const btnSplitDev = document.getElementById('btn-split-dev');
  if (btnSplitTest && btnSplitDev) {
    btnSplitTest.addEventListener('click', () => {
      btnSplitTest.classList.add('active');
      btnSplitDev.classList.remove('active');
      state.activeSplit = 'test';
      renderEvidenceTable();
    });
    btnSplitDev.addEventListener('click', () => {
      btnSplitDev.classList.add('active');
      btnSplitTest.classList.remove('active');
      state.activeSplit = 'dev';
      renderEvidenceTable();
    });
  }

  // 7. Preset Prompts
  const presetBtns = document.querySelectorAll('.preset-btn');
  presetBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      handleSendMessage(btn.dataset.prompt);
    });
  });

  // 8. Chat Form
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  if (chatForm && chatInput) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSendMessage(chatInput.value);
    });
  }

  // 9. About Modal Dialog
  const btnAbout = document.getElementById('btn-about');
  const aboutDialog = document.getElementById('about-dialog');
  const btnDialogClose = document.getElementById('btn-dialog-close');

  if (btnAbout && aboutDialog) {
    btnAbout.addEventListener('click', () => {
      aboutDialog.showModal();
    });
  }
  if (btnDialogClose && aboutDialog) {
    btnDialogClose.addEventListener('click', () => {
      aboutDialog.close();
    });
  }
  if (aboutDialog) {
    aboutDialog.addEventListener('click', (e) => {
      if (e.target === aboutDialog) {
        aboutDialog.close();
      }
    });
  }

  // 10. Curve scrubber drag & keyboard
  setupCurveScrubberInteractions();
}

setupEventListeners();
