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
      state.forecastPeakMm = Math.max(10, Math.min(100, Math.round(data.peak_hourly_mm)));
      const btn = document.getElementById('btn-use-forecast');
      if (btn) {
        btn.textContent = `Use forecast peak (${state.forecastPeakMm} mm/hr)`;
      }
    }
  } catch (err) {
    console.warn('[Forecast Error]', err);
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
  const width = 480;
  const height = 66;
  const padLeft = 20;
  const padRight = 32;
  const padTop = 10;
  const padBottom = 20;

  const maxCells = points.reduce((m, p) => Math.max(m, p.flooded_cells), 1);
  const minMm = 10;
  const maxMm = 100;

  const getX = (mm) => padLeft + ((mm - minMm) / (maxMm - minMm)) * (width - padLeft - padRight);
  const getY = (cells) => height - padBottom - (cells / maxCells) * (height - padTop - padBottom);

  // Build SVG path
  let pathD = '';
  points.forEach((p, i) => {
    const x = getX(p.mm_per_hr);
    const y = getY(p.flooded_cells);
    pathD += `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `;
  });

  const lastX = getX(maxMm);
  const firstX = getX(minMm);
  const baselineY = height - padBottom;
  const areaD = `${pathD} L ${lastX.toFixed(1)} ${baselineY} L ${firstX.toFixed(1)} ${baselineY} Z`;

  // Current position
  const currX = getX(state.rainfallMm);
  const currPt = points.find((p) => p.mm_per_hr === state.rainfallMm) || points[0];
  const currY = getY(currPt.flooded_cells);

  // SVG Markup
  svg.innerHTML = `
    <!-- Baseline Grid Line -->
    <line x1="${padLeft}" y1="${baselineY}" x2="${width - padRight}" y2="${baselineY}" stroke="#C9D1D6" stroke-width="1" />
    
    <!-- Area Under Curve -->
    <path d="${areaD}" fill="rgba(228, 87, 46, 0.12)" />

    <!-- Curve Stroke -->
    <path d="${pathD}" fill="none" stroke="#E4572E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />

    <!-- Ticks & Labels along bottom -->
    <g font-size="9" fill="#798B99" font-family="inherit" text-anchor="middle">
      <text x="${getX(10)}" y="${height - 4}">10</text>
      <text x="${getX(25)}" y="${height - 4}">25</text>
      <text x="${getX(40)}" y="${height - 4}">40</text>
      <text x="${getX(60)}" y="${height - 4}">60</text>
      <text x="${getX(80)}" y="${height - 4}">80</text>
      <text x="${getX(100)}" y="${height - 4}">100 mm/hr</text>
    </g>

    <!-- Vertical Hairline at Active Scenario -->
    <line id="curve-hairline" x1="${currX.toFixed(1)}" y1="${padTop}" x2="${currX.toFixed(1)}" y2="${baselineY}" stroke="#1B2A3A" stroke-width="1.5" />

    <!-- Circular Handle at Active Scenario -->
    <circle id="curve-handle" cx="${currX.toFixed(1)}" cy="${currY.toFixed(1)}" r="5.5" fill="#FFFFFF" stroke="#1B2A3A" stroke-width="2" />
  `;

  updateBottomBarReadout(state.rainfallMm);
}

function updateScrubberToMm(newMm) {
  const clampedMm = Math.max(10, Math.min(100, Math.round(newMm / 5) * 5));
  if (clampedMm === state.rainfallMm) return;

  state.rainfallMm = clampedMm;
  renderFloodCurveSvg();

  clearTimeout(state.sliderDebounceTimer);
  state.sliderDebounceTimer = setTimeout(() => {
    loadFloodedHexes();
  }, 160);
}

function setupCurveScrubberInteractions() {
  const wrapper = document.getElementById('curve-chart-wrapper');
  if (!wrapper) return;

  let isDragging = false;

  const handlePointer = (clientX) => {
    const rect = wrapper.getBoundingClientRect();
    const padLeft = 20 * (rect.width / 480);
    const padRight = 32 * (rect.width / 480);
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

  // Forecast button
  const btnForecast = document.getElementById('btn-use-forecast');
  if (btnForecast) {
    btnForecast.addEventListener('click', () => {
      const target = state.forecastPeakMm || 40;
      updateScrubberToMm(target);
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

// Enhance markdown table rows with coordinate click handlers to flyTo
function enhanceAgentMessageDom(containerEl, traces) {
  // 1. Attach click handlers to any table row that contains coordinates or pump sites
  const tables = containerEl.querySelectorAll('table');
  tables.forEach((tbl) => {
    tbl.classList.add('agent-interactive-table');
    const wrapper = document.createElement('div');
    wrapper.className = 'agent-table-wrapper';
    tbl.parentNode.insertBefore(wrapper, tbl);
    wrapper.appendChild(tbl);

    const rows = tbl.querySelectorAll('tbody tr');
    rows.forEach((row, idx) => {
      // Look for coordinates in cells
      const text = row.innerText;
      const coordMatch = text.match(/([2-3][0-9]\.[0-9]{2,6})[^\d]+(7[6-8]\.[0-9]{2,6})/);

      let lat = null;
      let lon = null;
      if (coordMatch) {
        lat = parseFloat(coordMatch[1]);
        lon = parseFloat(coordMatch[2]);
      } else {
        // Fallback: check if we have traces with pumps matching row index
        for (const t of traces) {
          if (t.data && t.data.pumps && t.data.pumps[idx]) {
            lat = t.data.pumps[idx].lat;
            lon = t.data.pumps[idx].lon;
            break;
          }
        }
      }

      if (lat && lon) {
        row.classList.add('clickable-row');
        row.title = 'Click to focus this site on the map';
        row.addEventListener('click', () => {
          map.flyTo({ center: [lon, lat], zoom: 14, duration: 900 });
        });
      }
    });
  });

  // 2. Wrap any lengthy hex ID blocks in <details class="hex-fold">
  const paragraphs = containerEl.querySelectorAll('p, li');
  paragraphs.forEach((p) => {
    const text = p.innerText;
    // Check if paragraph contains 15-char H3 hex IDs (e.g. 89608...)
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
    renderEvidenceTakeaways();
    renderEvidenceTable();
  } catch (err) {
    console.warn('[Evidence Error]', err);
  }
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
