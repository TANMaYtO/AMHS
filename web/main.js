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
  topK: 25,
  city: 'all',
  activeSplit: 'test',
  evaluationData: null,
  sliderDebounceTimer: null,
  history: [],
};

// ============================================================================
// MapLibre Initialization
// ============================================================================
const map = new maplibregl.Map({
  container: 'map',
  style: {
    version: 8,
    sources: {
      'dark-base': {
        type: 'raster',
        tiles: [
          'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        attribution:
          '&copy; Esri, HERE, Garmin, FAO, NOAA, USGS, &copy; OpenStreetMap contributors',
      },
    },
    layers: [
      {
        id: 'dark-base-layer',
        type: 'raster',
        source: 'dark-base',
        minzoom: 0,
        maxzoom: 16,
      },
    ],
  },
  center: [77.23, 28.61], // Delhi NCR center [lng, lat]
  zoom: 10.5,
});

map.addControl(new maplibregl.NavigationControl(), 'top-right');
window.maplibregl = maplibregl;
window.map = map;

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
// Layer Setup on Map Load
// ============================================================================
map.on('load', async () => {
  console.log('[Map] MapLibre initialized.');

  // 1. Flooded Hexes Source & Layers
  map.addSource('flooded-hexes', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: 'flooded-hexes-fill',
    type: 'fill',
    source: 'flooded-hexes',
    paint: {
      'fill-color': [
        'interpolate',
        ['linear'],
        ['get', 'severity'],
        1.0, '#38bdf8',  // Cyan (at trigger threshold)
        1.5, '#f59e0b',  // Amber (moderate severity)
        3.0, '#ef4444',  // Red (high severity)
        6.0, '#b91c1c',  // Dark Red (extreme)
      ],
      'fill-opacity': 0.75,
    },
  });

  map.addLayer({
    id: 'flooded-hexes-outline',
    type: 'line',
    source: 'flooded-hexes',
    paint: {
      'line-color': '#ffffff',
      'line-width': 1.2,
      'line-opacity': 0.45,
    },
  });

  // 2. OSM Underpasses Source & Layer
  map.addSource('underpasses', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: 'underpasses-layer',
    type: 'circle',
    source: 'underpasses',
    paint: {
      'circle-radius': 4.5,
      'circle-color': '#06b6d4',
      'circle-stroke-width': 1.2,
      'circle-stroke-color': '#ffffff',
      'circle-opacity': 0.8,
    },
  });

  // 3. Ground Truth Spots Source & Layers (DEV vs TEST)
  map.addSource('spots', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  map.addLayer({
    id: 'spots-dev-layer',
    type: 'circle',
    source: 'spots',
    filter: ['==', ['get', 'split'], 'dev'],
    paint: {
      'circle-radius': 6,
      'circle-color': '#10b981', // Emerald green
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#ffffff',
      'circle-opacity': 0.9,
    },
  });

  map.addLayer({
    id: 'spots-test-layer',
    type: 'circle',
    source: 'spots',
    filter: ['==', ['get', 'split'], 'test'],
    paint: {
      'circle-radius': 6.5,
      'circle-color': '#a855f7', // Purple/Violet
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#ffffff',
      'circle-opacity': 0.9,
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
      'fill-color': '#38bdf8',
      'fill-opacity': 0.18,
    },
  });

  map.addLayer({
    id: 'agent-pumps-radius-line',
    type: 'line',
    source: 'agent-pumps-radius',
    paint: {
      'line-color': '#38bdf8',
      'line-width': 2,
      'line-dasharray': [3, 2],
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
      'circle-radius': 8,
      'circle-color': '#0284c7',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
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
      'line-color': '#f59e0b',
      'line-width': 4.5,
      'line-opacity': 0.9,
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
      'circle-radius': 7,
      'circle-color': '#ef4444',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
    },
  });

  // Attach Click Handlers for Popups
  attachMapPopupHandlers();

  // Load Initial Datasets
  await Promise.all([
    loadFloodedHexes(),
    loadUnderpasses(),
    loadSpots(),
    loadEvidenceData(),
  ]);
});

// ============================================================================
// Popup Handling
// ============================================================================
function attachMapPopupHandlers() {
  // Hex Click
  map.on('click', 'flooded-hexes-fill', (e) => {
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
        <span class="popup-value">${Number(props.severity).toFixed(2)}x trigger</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Trigger Rate:</span>
        <span class="popup-value">${Number(props.trigger_mm).toFixed(1)} mm/hr</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Elevation:</span>
        <span class="popup-value">${Number(props.elevation_m).toFixed(1)} m</span>
      </div>
      <div class="popup-row">
        <span class="popup-label">Nearest Prior:</span>
        <span class="popup-value">${props.nearest_place || 'None'}</span>
      </div>
      <div class="popup-why">
        <strong>Risk Factors:</strong> ${props.why || 'Terrain convergence'}
      </div>
    `;

    new maplibregl.Popup({ closeButton: true })
      .setLngLat(e.lngLat)
      .setHTML(popupHtml)
      .addTo(map);
  });

  // Underpasses Click
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

  // Ground Truth Spots Click
  const handleSpotClick = (e) => {
    if (!e.features || !e.features[0]) return;
    const props = e.features[0].properties;
    new maplibregl.Popup({ closeButton: true })
      .setLngLat(e.lngLat)
      .setHTML(`
        <div class="popup-title">Ground Truth Spot (${props.split.toUpperCase()})</div>
        <div class="popup-row"><span class="popup-label">Location:</span> <span class="popup-value">${props.name}</span></div>
        <div class="popup-row"><span class="popup-label">Event Date:</span> <span class="popup-value">${props.event_date}</span></div>
        <div class="popup-row"><span class="popup-label">Geometry:</span> <span class="popup-value">${props.geom_type}</span></div>
        <div class="popup-row"><span class="popup-label">Confidence:</span> <span class="popup-value">${props.confidence}</span></div>
      `)
      .addTo(map);
  };

  map.on('click', 'spots-dev-layer', handleSpotClick);
  map.on('click', 'spots-test-layer', handleSpotClick);

  // Pointer cursor styling
  ['flooded-hexes-fill', 'underpasses-layer', 'spots-dev-layer', 'spots-test-layer'].forEach((layerId) => {
    map.on('mouseenter', layerId, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', layerId, () => (map.getCanvas().style.cursor = ''));
  });
}

// ============================================================================
// Data Fetching & Layer Updates
// ============================================================================
async function loadFloodedHexes() {
  const overlay = document.getElementById('map-status-text');
  if (overlay) overlay.textContent = `Fetching hotspots (${state.rainfallMm} mm/hr)...`;

  try {
    const url = `/hotspots?mm=${state.rainfallMm}&top=${state.topK}&city=${state.city}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    const src = map.getSource('flooded-hexes');
    if (src) {
      src.setData(data);
    }

    // Update live count indicator
    const totalCount = data.metadata ? data.metadata.total_flooded_hexes : 0;
    const countEl = document.getElementById('flooded-count-val');
    const pctEl = document.getElementById('flooded-pct-val');

    if (countEl) countEl.textContent = totalCount.toLocaleString();
    if (pctEl) {
      const pct = ((totalCount / 41703) * 100).toFixed(1);
      pctEl.textContent = `${pct}%`;
    }

    if (overlay) overlay.textContent = `Displaying Top-${data.features.length} Flooded Hexes (${state.city.toUpperCase()})`;
  } catch (err) {
    console.error('[Hotspots Error]', err);
    if (overlay) overlay.textContent = 'Error loading hotspots';
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

async function loadEvidenceData() {
  try {
    const resp = await fetch('/eval/results');
    if (!resp.ok) return;
    state.evaluationData = await resp.json();
    renderEvidenceTable();
  } catch (err) {
    console.warn('[Evidence Error]', err);
  }
}

// ============================================================================
// Agent Chat & Tool Overlays
// ============================================================================
function updateAgentOverlays(traces) {
  let hasOverlays = false;
  const bounds = new maplibregl.LngLatBounds();

  // Reset agent overlay sources
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

      if (pumpRadiusSrc) {
        pumpRadiusSrc.setData({ type: 'FeatureCollection', features: radiusFeatures });
      }
      if (pumpPointsSrc) {
        pumpPointsSrc.setData({ type: 'FeatureCollection', features: pointFeatures });
      }
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
      if (routeSrc) {
        routeSrc.setData({ type: 'FeatureCollection', features: [lineFeat] });
      }

      payload.route_coordinates.forEach((c) => bounds.extend(c));
      hasOverlays = true;

      // Risk hexes on route
      if (payload.top_risk_hexes && Array.isArray(payload.top_risk_hexes)) {
        const riskPoints = payload.top_risk_hexes.map((h) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [h.lon, h.lat] },
          properties: h,
        }));
        if (routeRiskSrc) {
          routeRiskSrc.setData({ type: 'FeatureCollection', features: riskPoints });
        }
      }
    }
  }

  // Zoom map to cover overlays if present
  if (hasOverlays && !bounds.isEmpty()) {
    map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 1200 });
  }
}

async function handleSendMessage(promptText) {
  if (!promptText || !promptText.trim()) return;

  const chatContainer = document.getElementById('chat-messages');
  const inputEl = document.getElementById('chat-input');
  if (inputEl) inputEl.value = '';

  // Append user message
  const userMsgEl = document.createElement('div');
  userMsgEl.className = 'chat-message user-msg';
  userMsgEl.innerHTML = `
    <div class="msg-header">
      <span class="msg-sender">Operator</span>
      <span class="msg-time">${new Date().toLocaleTimeString()}</span>
    </div>
    <div class="msg-body">${promptText}</div>
  `;
  chatContainer.appendChild(userMsgEl);

  // Append agent thinking placeholder
  const agentMsgEl = document.createElement('div');
  agentMsgEl.className = 'chat-message agent-msg';
  agentMsgEl.innerHTML = `
    <div class="msg-header">
      <span class="msg-sender">FloodLens Agent</span>
      <span class="msg-time">Analyzing hydrology...</span>
    </div>
    <div class="msg-body">
      <em style="color: var(--cyan);">Querying spatial models and terrain tensors...</em>
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

    // Build tool trace pills
    let tracesHtml = '';
    if (data.tool_trace && data.tool_trace.length > 0) {
      tracesHtml = `<div class="tool-traces-container">`;
      data.tool_trace.forEach((trace) => {
        tracesHtml += `
          <div class="trace-pill" title="Click to view tool data on map">
            <span class="trace-icon">&#9658;</span>
            <strong>${trace.tool}</strong>: ${trace.summary}
          </div>
        `;
      });
      tracesHtml += `</div>`;
    }

    agentMsgEl.innerHTML = `
      <div class="msg-header">
        <span class="msg-sender">FloodLens Agent</span>
        <span class="msg-time">${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="msg-body">${renderedBody}</div>
      ${tracesHtml}
    `;

    // Update agent map overlays (pumps, routes, etc.)
    if (data.tool_trace && data.tool_trace.length > 0) {
      updateAgentOverlays(data.tool_trace);
    }

    // Keep history
    state.history.push({ role: 'user', content: promptText });
    state.history.push({ role: 'assistant', content: data.reply });
  } catch (err) {
    console.error('[Chat Error]', err);
    agentMsgEl.innerHTML = `
      <div class="msg-header">
        <span class="msg-sender">FloodLens Agent</span>
        <span class="msg-time">Error</span>
      </div>
      <div class="msg-body" style="color: var(--red);">
        Failed to process control room query: ${err.message}
      </div>
    `;
  }

  chatContainer.scrollTop = chatContainer.scrollHeight;
}

// ============================================================================
// Evidence Tab Rendering
// ============================================================================
function renderEvidenceTable() {
  const tbody = document.getElementById('evidence-table-body');
  if (!tbody || !state.evaluationData || !state.evaluationData.splits) return;

  const splitData = state.evaluationData.splits[state.activeSplit];
  if (!splitData) return;

  const modelsOrder = [
    'FloodLens (Composite)',
    'TWI Only',
    'Underpass Prior Only',
    'Flow Acc Only',
    'HAND Only',
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
    if (isFl) tr.className = 'highlight-row';

    const getRec = (k) => {
      if (!metrics || !metrics[k]) return '--';
      const val = metrics[k].comb_300 !== undefined ? metrics[k].comb_300 : metrics[k].rec_str_1000;
      return `${(val * 100).toFixed(1)}%`;
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
// UI Event Handlers
// ============================================================================
function setupEventListeners() {
  // 1. Rainfall Slider Input
  const slider = document.getElementById('rainfall-slider');
  const valDisplay = document.getElementById('rainfall-val');

  if (slider && valDisplay) {
    slider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      state.rainfallMm = val;
      valDisplay.textContent = val;

      clearTimeout(state.sliderDebounceTimer);
      state.sliderDebounceTimer = setTimeout(() => {
        loadFloodedHexes();
      }, 200);
    });
  }

  // 2. Forecast Peak Button
  const btnForecast = document.getElementById('btn-forecast');
  if (btnForecast) {
    btnForecast.addEventListener('click', async () => {
      btnForecast.disabled = true;
      btnForecast.innerHTML = 'Fetching forecast...';
      try {
        const resp = await fetch('/forecast?location=Delhi');
        if (resp.ok) {
          const data = await resp.json();
          const peak = Math.max(10, Math.min(100, Math.round(data.peak_hourly_mm || 40)));
          state.rainfallMm = peak;
          if (slider) slider.value = peak;
          if (valDisplay) valDisplay.textContent = peak;
          loadFloodedHexes();
        }
      } catch (err) {
        console.error(err);
      } finally {
        btnForecast.disabled = false;
        btnForecast.innerHTML = '<span class="btn-icon">&#9729;</span> Use Forecast Peak (Delhi)';
      }
    });
  }

  // 3. Top-N Selector Pills
  const topPills = document.querySelectorAll('#top-pills .pill');
  topPills.forEach((btn) => {
    btn.addEventListener('click', () => {
      topPills.forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      state.topK = parseInt(btn.dataset.top, 10);
      loadFloodedHexes();
    });
  });

  // 4. City Selector Pills
  const cityPills = document.querySelectorAll('#city-pills .pill');
  cityPills.forEach((btn) => {
    btn.addEventListener('click', () => {
      cityPills.forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      state.city = btn.dataset.city;
      loadFloodedHexes();
    });
  });

  // 5. Layer Toggle Checkboxes
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

  toggleMapLayer('layer-hexes', ['flooded-hexes-fill', 'flooded-hexes-outline']);
  toggleMapLayer('layer-underpasses', ['underpasses-layer']);
  toggleMapLayer('layer-spots', ['spots-dev-layer', 'spots-test-layer']);
  toggleMapLayer('layer-overlays', [
    'agent-pumps-radius-fill',
    'agent-pumps-radius-line',
    'agent-pumps-points-layer',
    'agent-route-line',
    'agent-route-risk-layer',
  ]);

  // 6. Right Panel Tab Switcher
  const btnChat = document.getElementById('tab-btn-chat');
  const btnEvidence = document.getElementById('tab-btn-evidence');
  const tabChat = document.getElementById('tab-chat');
  const tabEvidence = document.getElementById('tab-evidence');

  if (btnChat && btnEvidence) {
    btnChat.addEventListener('click', () => {
      btnChat.classList.add('active');
      btnEvidence.classList.remove('active');
      tabChat.classList.add('active');
      tabEvidence.classList.remove('active');
    });

    btnEvidence.addEventListener('click', () => {
      btnEvidence.classList.add('active');
      btnChat.classList.remove('active');
      tabEvidence.classList.add('active');
      tabChat.classList.remove('active');
      renderEvidenceTable();
    });
  }

  // 7. Evidence Split Buttons
  const splitBtns = document.querySelectorAll('.split-btn');
  splitBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      splitBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeSplit = btn.dataset.split;
      renderEvidenceTable();
    });
  });

  // 8. Preset Prompt Chips
  const chips = document.querySelectorAll('.chip');
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const prompt = chip.dataset.prompt;
      handleSendMessage(prompt);
    });
  });

  // 9. Chat Input Form
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  if (chatForm && chatInput) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSendMessage(chatInput.value);
    });
  }

  // 10. Live UTC Clock
  const clockEl = document.getElementById('clock');
  const updateClock = () => {
    if (clockEl) {
      const now = new Date();
      clockEl.textContent = `${now.toISOString().substring(11, 19)} UTC`;
    }
  };
  setInterval(updateClock, 1000);
  updateClock();
}

// Initialize listeners on DOM ready
setupEventListeners();
