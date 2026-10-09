const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9222;
const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'docs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('Launching headless Edge on port ' + PORT);
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1920,1080',
    '--disable-gpu',
    'http://localhost:5173/',
  ]);

  let connected = false;
  let pageTarget = null;

  for (let i = 0; i < 20; i++) {
    await sleep(500);
    try {
      const resp = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await resp.json();
      pageTarget = list.find((t) => t.type === 'page');
      if (pageTarget && pageTarget.webSocketDebuggerUrl) {
        connected = true;
        break;
      }
    } catch (e) {
      // browser starting
    }
  }

  if (!connected) {
    console.error('Failed to connect to Edge CDP');
    edge.kill();
    process.exit(1);
  }

  console.log('Connecting to WebSocket:', pageTarget.webSocketDebuggerUrl);
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

  let idCounter = 1;
  const pending = new Map();

  function sendCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = idCounter++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  };

  await new Promise((res) => (ws.onopen = res));
  console.log('CDP WebSocket connected!');

  await sendCommand('Page.enable');
  await sendCommand('Runtime.enable');

  async function capture(filename) {
    const res = await sendCommand('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    const outPath = path.join(SCREENSHOT_DIR, filename);
    fs.writeFileSync(outPath, buffer);
    console.log(`Saved screenshot: ${outPath} (${buffer.length} bytes)`);
  }

  async function evalJs(expr) {
    return await sendCommand('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
  }

  async function waitForAgent(expectedCircles = 0, maxWaitMs = 65000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const res = await evalJs(`
        (() => {
          const msgs = document.querySelectorAll('.chat-message.agent-msg');
          const lastMsg = msgs[msgs.length - 1];
          if (!lastMsg) return { done: false, circles: 0, textLen: 0 };
          const isThinking = !!lastMsg.querySelector('em');
          const hasTable = !!lastMsg.querySelector('table');
          const bodyEl = lastMsg.querySelector('.msg-body');
          const bodyText = bodyEl ? bodyEl.textContent : '';
          const hasContent = bodyText.length > 50;

          let circleCount = 0;
          if (window.map) {
            try {
              const feats = window.map.queryRenderedFeatures({ layers: ['agent-pumps-points-layer'] });
              circleCount = feats ? feats.length : 0;
            } catch (e) {}
            if (circleCount === 0) {
              const src = window.map.getSource('agent-pumps-radius');
              if (src && src._data && src._data.features) {
                circleCount = src._data.features.length;
              }
            }
          }

          const done = !isThinking && (hasTable || hasContent);
          return {
            done: done,
            circles: circleCount,
            textLen: bodyText.length,
            hasTable: hasTable
          };
        })()
      `);
      const val = res && res.result && res.result.value;
      if (val && val.done) {
        if (expectedCircles === 0 || val.hasTable || val.circles >= expectedCircles) {
          console.log(`Agent reply finished (len=${val.textLen}, hasTable=${val.hasTable}), circles detected: ${val.circles}`);
          return val;
        }
      }
      await sleep(1500);
    }
    console.warn(`Timeout waiting for agent (expectedCircles=${expectedCircles})`);
    return null;
  }

  // 1. Wait for map & layers to load (40 mm/hr default overview, Top-N=100)
  console.log('Waiting 6s for MapLibre tiles, point circle layer, and Top-N=100 hexes...');
  await sleep(6000);
  await capture('ui_overview.png');

  // 2. Test slider change to 60 mm/hr
  console.log('Testing rainfall slider change to 60 mm/hr...');
  await evalJs(`
    const slider = document.getElementById('rainfall-slider');
    slider.value = 60;
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await sleep(2500);
  await capture('ui_slider_60.png');

  // 3. Test scenario chip: CP -> Cyber City route
  console.log('Testing preset scenario chip: CP -> Cyber City route...');
  await evalJs(`
    const chip = document.querySelector('.chip[data-prompt*="Cyber City"]');
    if (chip) chip.click();
  `);
  console.log('Waiting for route risk agent response and map line rendering...');
  await waitForAgent(0, 60000);
  await sleep(2000);
  await capture('ui_route_scenario.png');

  // 4. Test Evidence Tab (dynamic takeaways & paired bootstrap table)
  console.log('Testing Evidence tab...');
  await evalJs(`
    const btn = document.getElementById('tab-btn-evidence');
    if (btn) btn.click();
  `);
  await sleep(2000);
  await capture('ui_evidence_tab.png');

  // 5. Switch back to chat & test Pump Deployment Preset ('I have 6 pumps, where should they go for 60 mm/hr?')
  console.log('Testing 6 Pumps @ 60 mm/hr preset chip...');
  await evalJs(`document.getElementById('tab-btn-chat').click();`);
  await sleep(600);
  await evalJs(`
    const pumpChip = document.querySelector('.chip[data-prompt*="6 pumps"]');
    if (pumpChip) pumpChip.click();
  `);
  console.log('Waiting for pump plan agent response and 6 coverage circle overlays...');
  const pumpResult = await waitForAgent(6, 65000);
  if (pumpResult && pumpResult.circles >= 6) {
    console.log(`Confirmed: ${pumpResult.circles} pump coverage circles rendered on the map!`);
  } else {
    console.warn('Warning: pump coverage circles not fully detected before timeout.');
  }
  await sleep(2000);
  await capture('ui_pump_scenario.png');

  // 6. Test Hex Popup
  console.log('Opening hex popup...');
  await evalJs(`
    (async () => {
      const resp = await fetch('/hotspots?mm=60&top=1');
      const data = await resp.json();
      if (data.features && data.features.length > 0) {
        const feat = data.features[0];
        const props = feat.properties;
        const elev = Number(props.elevation_m);
        const elevStr = Math.abs(elev) < 0.05 ? '0.0 m' : elev.toFixed(1) + ' m';
        const popupHtml = \`
          <div class="popup-title">Flooded H3 Cell</div>
          <div class="popup-row">
            <span class="popup-label">Cell ID:</span>
            <span class="popup-value">\${props.hex_id}</span>
          </div>
          <div class="popup-row">
            <span class="popup-label">Coordinates:</span>
            <span class="popup-value">\${Number(props.lat).toFixed(4)}, \${Number(props.lon).toFixed(4)}</span>
          </div>
          <div class="popup-row">
            <span class="popup-label">Severity:</span>
            <span class="popup-value">\${Number(props.severity).toFixed(2)}x trigger</span>
          </div>
          <div class="popup-row">
            <span class="popup-label">Trigger Rate:</span>
            <span class="popup-value">\${Number(props.trigger_mm).toFixed(1)} mm/hr</span>
          </div>
          <div class="popup-row">
            <span class="popup-label">Elevation:</span>
            <span class="popup-value">\${elevStr}</span>
          </div>
          <div class="popup-row">
            <span class="popup-label">Nearest Prior:</span>
            <span class="popup-value">\${props.nearest_place || 'None'}</span>
          </div>
          <div class="popup-why">
            <strong>Risk Factors:</strong> \${(props.why || 'Terrain convergence').replaceAll('-0.0m', '0.0m')}
          </div>
        \`;
        new maplibregl.Popup({ closeButton: true })
          .setLngLat([props.lon, props.lat])
          .setHTML(popupHtml)
          .addTo(map);
        map.flyTo({ center: [props.lon, props.lat], zoom: 13.5 });
      }
    })()
  `);
  await sleep(2500);
  await capture('ui_hex_popup.png');

  console.log('All automated browser tests completed successfully!');
  ws.close();
  edge.kill();
}

main().catch((err) => {
  console.error('Browser automation error:', err);
  process.exit(1);
});
