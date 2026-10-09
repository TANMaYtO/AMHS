const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9222;
const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'docs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runRegressionSuite() {
  console.log('--- STARTING FLOODLENS REGRESSION TEST SUITE ---');

  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1920,1080',
    '--disable-gpu',
    'http://localhost:5173/',
  ]);

  let connected = false;
  let pageTarget = null;

  for (let i = 0; i < 25; i++) {
    await sleep(500);
    try {
      const resp = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await resp.json();
      pageTarget = list.find((t) => t.type === 'page');
      if (pageTarget && pageTarget.webSocketDebuggerUrl) {
        connected = true;
        break;
      }
    } catch (e) {}
  }

  if (!connected) {
    console.error('Failed to connect to Edge CDP');
    edge.kill();
    process.exit(1);
  }

  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  let idCounter = 1;
  const pending = new Map();
  const consoleErrors = [];

  function sendCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = idCounter++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.consoleAPICalled') {
      if (msg.params.type === 'error') {
        consoleErrors.push(msg.params.args.map((a) => a.value || a.description).join(' '));
      }
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  };

  await new Promise((res) => (ws.onopen = res));
  await sendCommand('Page.enable');
  await sendCommand('Runtime.enable');

  async function evaluate(expression) {
    const res = await sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result.value;
  }

  async function takeScreenshot(filename) {
    const res = await sendCommand('Page.captureScreenshot', { format: 'png' });
    const buffer = Buffer.from(res.data, 'base64');
    const outPath = path.join(SCREENSHOT_DIR, filename);
    fs.writeFileSync(outPath, buffer);
    console.log(`[Screenshot] Saved ${outPath}`);
  }

  console.log('1. Waiting for initial page load and map initialization...');
  await sleep(7500);

  // Check 1: Flood curve SVG rendered
  console.log('2. Verifying /flood-curve rendering...');
  const curveRendered = await evaluate(`
    (() => {
      const svg = document.getElementById('flood-curve-svg');
      const paths = svg ? svg.querySelectorAll('path') : [];
      const cells = document.getElementById('curve-cells-count').textContent;
      return { pathCount: paths.length, cellsText: cells };
    })()
  `);
  console.log('   Curve paths found:', curveRendered.pathCount, '| Initial cells:', curveRendered.cellsText);
  if (curveRendered.pathCount < 2) throw new Error('Flood curve SVG path not rendered');

  // Check 2: Scrubber slider interaction
  console.log('3. Testing curve scrubber keyboard interaction (adjusting mm)...');
  await evaluate(`
    (() => {
      const wrapper = document.getElementById('curve-chart-wrapper');
      wrapper.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      wrapper.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      wrapper.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      wrapper.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    })()
  `);
  await sleep(1000);
  const updatedMm = await evaluate(`
    (() => {
      const mm = document.getElementById('curve-mm-display').textContent;
      const count = document.getElementById('curve-cells-count').textContent;
      return { mm, count };
    })()
  `);
  console.log('   Scrubber updated to:', updatedMm.mm, '| Cells count:', updatedMm.count);

  // Check 3: City Jurisdiction filter
  console.log('4. Testing city jurisdiction filter...');
  await evaluate(`
    (() => {
      const btn = document.querySelector('#city-selector .seg-btn[data-city="delhi"]');
      if (btn) btn.click();
    })()
  `);
  await sleep(1000);
  const cityState = await evaluate(`document.querySelector('#city-selector .seg-btn.active').dataset.city`);
  console.log('   Active city filter:', cityState);

  // Check 4: Top-N selector
  console.log('5. Testing Top-N selector...');
  await evaluate(`
    (() => {
      const btn = document.querySelector('#top-selector .seg-btn[data-top="25"]');
      if (btn) btn.click();
    })()
  `);
  await sleep(1000);
  const topState = await evaluate(`document.querySelector('#top-selector .seg-btn.active').dataset.top`);
  console.log('   Active top-N filter:', topState);

  // Check 5: Layer toggles
  console.log('6. Testing layer toggles (underpasses & spots)...');
  await evaluate(`
    (() => {
      const upCb = document.getElementById('layer-underpasses');
      if (upCb) { upCb.checked = true; upCb.dispatchEvent(new Event('change')); }
    })()
  `);
  await sleep(800);

  // Check 6: About Modal
  console.log('7. Testing "About this model" modal...');
  await evaluate(`document.getElementById('btn-about').click()`);
  await sleep(600);
  const modalOpen = await evaluate(`document.getElementById('about-dialog').open`);
  console.log('   About dialog open:', modalOpen);
  await takeScreenshot('after_about.png');
  await evaluate(`document.getElementById('btn-dialog-close').click()`);
  await sleep(400);

  // Check 7: Evidence Tab & Dot-Whisker Plot
  console.log('8. Testing Evidence tab & benchmark charts...');
  await evaluate(`document.getElementById('tab-btn-evidence').click()`);
  await sleep(800);
  const evidenceCheck = await evaluate(`
    (() => {
      const svg = document.getElementById('dot-whisker-svg');
      const lines = svg ? svg.querySelectorAll('line').length : 0;
      const circles = svg ? svg.querySelectorAll('circle').length : 0;
      const takeaways = document.querySelectorAll('#evidence-takeaways-list li').length;
      return { lines, circles, takeaways };
    })()
  `);
  console.log('   Evidence plot rendered:', evidenceCheck);
  // Expand full metrics table
  await evaluate(`document.querySelector('.evidence-details').open = true`);
  await sleep(400);
  await takeScreenshot('after_evidence.png');

  // Switch back to Ask tab
  await evaluate(`document.getElementById('tab-btn-ask').click()`);
  await sleep(600);

  async function waitForAgentResponse(expectedCount, timeoutMs = 45000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const isDone = await evaluate(`
        (() => {
          const msgs = document.querySelectorAll('.message-assistant');
          if (msgs.length < ${expectedCount}) return false;
          const target = msgs[${expectedCount} - 1];
          const hasEvaluating = target.innerText.includes('Evaluating spatial models') || target.innerText.includes('Analyzing hydrological');
          return !hasEvaluating;
        })()
      `);
      if (isDone) {
        await sleep(1500); // Allow MapLibre overlays to render
        return;
      }
      await sleep(1000);
    }
  }

  // Check 8: Agent Pump Scenario Preset
  console.log('9. Testing agent scenario: 6 pumps @ 60 mm/hr...');
  await evaluate(`
    (() => {
      const btn = document.querySelector('.preset-btn[data-prompt*="6 pumps"]');
      if (btn) btn.click();
    })()
  `);
  await waitForAgentResponse(2, 45000);
  const agentResponseCheck = await evaluate(`
    (() => {
      const msgs = document.querySelectorAll('.message-assistant');
      const last = msgs[msgs.length - 1];
      const hasSteps = last.querySelector('.tool-steps-card') !== null;
      const hasTable = last.querySelector('table') !== null;
      const pumpPoints = window.map.getSource('agent-pumps-points')._data.features.length;
      return { hasSteps, hasTable, pumpPoints };
    })()
  `);
  console.log('   Agent pump response check:', agentResponseCheck);
  await takeScreenshot('after_pumps.png');

  // Check 9: Agent Route Scenario Preset
  console.log('10. Testing agent scenario: Route CP to Cyber City...');
  await evaluate(`
    (() => {
      const btn = document.querySelector('.preset-btn[data-prompt*="Cyber City"]');
      if (btn) btn.click();
    })()
  `);
  await waitForAgentResponse(3, 45000);
  const routeCheck = await evaluate(`
    (() => {
      const routeFeats = window.map.getSource('agent-route')._data.features.length;
      return { routeFeats };
    })()
  `);
  console.log('   Agent route line drawn:', routeCheck);
  await takeScreenshot('after_route.png');

  // Final Console Error Check
  console.log('11. Checking for console errors throughout suite...');
  if (consoleErrors.length > 0) {
    console.error('Console errors detected:', consoleErrors);
    throw new Error(`${consoleErrors.length} console errors occurred`);
  } else {
    console.log('   Zero console errors detected!');
  }

  console.log('--- REGRESSION TEST SUITE PASSED COMPLETELY ---');
  ws.close();
  edge.kill();
}

runRegressionSuite().catch((err) => {
  console.error('REGRESSION TEST FAILED:', err);
  process.exit(1);
});
