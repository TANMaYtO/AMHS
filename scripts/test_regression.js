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

  // Take initial full-layout screenshots at 1920x1080 and 1366x768
  console.log('1b. Capturing baseline 1920x1080 and 1366x768 screenshots...');
  await takeScreenshot('after_1080p.png');

  await sendCommand('Emulation.setDeviceMetricsOverride', {
    width: 1366,
    height: 768,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(1000);
  await takeScreenshot('after_768p.png');

  // Restore 1920x1080
  await sendCommand('Emulation.setDeviceMetricsOverride', {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await sleep(1000);

  // Check 2: Log-scale Flood curve SVG rendering & milestone label offset
  console.log('2. Verifying log-scale /flood-curve rendering and label offset...');
  const curveRendered = await evaluate(`
    (() => {
      const svg = document.getElementById('flood-curve-svg');
      const paths = svg ? svg.querySelectorAll('path') : [];
      const textEls = svg ? Array.from(svg.querySelectorAll('text')) : [];
      const texts = textEls.map(t => t.textContent);
      const cells = document.getElementById('curve-cells-count').textContent;
      const hasLogTitle = texts.some(t => t.includes('cells that may waterlog (log scale)'));
      const hasGridLabels = texts.includes('10k') && texts.includes('1k') && texts.includes('100') && texts.includes('10');
      const milestone1243 = textEls.find(t => t.textContent === '1,243');
      const handle = document.getElementById('curve-handle');
      const labelAnchor = milestone1243 ? milestone1243.getAttribute('text-anchor') : null;
      const labelX = milestone1243 ? parseFloat(milestone1243.getAttribute('x')) : null;
      const handleX = handle ? parseFloat(handle.getAttribute('cx')) : null;
      return { pathCount: paths.length, cellsText: cells, hasLogTitle, hasGridLabels, labelAnchor, labelX, handleX };
    })()
  `);
  console.log('   Log curve check:', curveRendered);
  if (!curveRendered.hasLogTitle) throw new Error('Curve missing log scale title');
  if (!curveRendered.hasGridLabels) throw new Error('Curve missing log scale gridline labels');
  if (curveRendered.labelAnchor !== 'end' || !(curveRendered.labelX < curveRendered.handleX - 5)) {
    throw new Error(`Milestone label not properly offset from handle: ${JSON.stringify(curveRendered)}`);
  }

  // Check 3: Forecast button live check & scale guard
  console.log('3. Verifying live forecast button and scale guard...');
  const forecastBtnInfo = await evaluate(`
    (() => {
      const btn = document.getElementById('btn-use-forecast');
      const initialMm = document.getElementById('curve-mm-display').textContent;
      btn.click();
      const statusMsg = document.getElementById('forecast-status-msg').textContent;
      const afterMm = document.getElementById('curve-mm-display').textContent;
      return { btnText: btn.textContent, initialMm, afterMm, statusMsg };
    })()
  `);
  console.log('   Forecast button check:', forecastBtnInfo);
  if (!forecastBtnInfo.btnText.includes('Forecast peak')) {
    throw new Error('Forecast button missing peak label');
  }
  if (!forecastBtnInfo.statusMsg.includes('is below the lowest scenario on this scale (10 mm/hr).')) {
    throw new Error(`Forecast button status message mismatch: ${forecastBtnInfo.statusMsg}`);
  }
  if (forecastBtnInfo.statusMsg.includes('no waterlogging expected')) {
    throw new Error('Stale forecast message found');
  }
  if (forecastBtnInfo.initialMm !== forecastBtnInfo.afterMm) {
    throw new Error('Forecast button moved slider despite being below scale');
  }

  // Check 4: About Modal dynamic weights from /meta
  console.log('4. Testing About modal and live weights from /meta...');
  await evaluate(`document.getElementById('btn-about').click()`);
  await sleep(600);
  const modalInfo = await evaluate(`
    (() => {
      const dialog = document.getElementById('about-dialog');
      const weights = document.getElementById('modal-weights-val').textContent;
      return { isOpen: dialog.open, weights };
    })()
  `);
  console.log('   About modal check:', modalInfo);
  if (!modalInfo.weights.includes('HAND (25%)') || !modalInfo.weights.includes('TWI (25%)')) {
    throw new Error(`Modal weights did not render live from /meta: ${modalInfo.weights}`);
  }
  await takeScreenshot('after_about.png');
  await evaluate(`document.getElementById('btn-dialog-close').click()`);
  await sleep(400);

  // Check 5: Evidence Tab & Paired Difference Callout
  console.log('5. Testing Evidence tab and paired difference callout...');
  await evaluate(`document.getElementById('tab-btn-evidence').click()`);
  await sleep(800);
  const evidenceCheck = await evaluate(`
    (() => {
      const calloutText = document.getElementById('paired-callout-text').textContent;
      const takeaways = Array.from(document.querySelectorAll('#evidence-takeaways-list li')).map(li => li.textContent);
      return { calloutText, takeawaysCount: takeaways.length };
    })()
  `);
  console.log('   Evidence callout:', evidenceCheck.calloutText);
  if (!evidenceCheck.calloutText.includes('+7.8%') || !evidenceCheck.calloutText.includes('-23.5%')) {
    throw new Error(`Evidence callout numbers mismatch results.json: ${evidenceCheck.calloutText}`);
  }
  await evaluate(`document.querySelector('.evidence-details').open = true`);
  await sleep(400);
  await takeScreenshot('after_evidence.png');

  // Switch back to Ask tab
  await evaluate(`document.getElementById('tab-btn-ask').click()`);
  await sleep(600);

  async function waitForAgentResponse(expectedCount, timeoutMs = 60000) {
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
        await sleep(2000);
        return;
      }
      await sleep(1000);
    }
    console.warn(`Timeout waiting for agent response ${expectedCount} after ${timeoutMs}ms`);
  }

  // Check 6a: Verify Immediate Scenario Sync across ALL 4 Presets (before answer renders)
  console.log('6a. Testing immediate scenario sync for all 4 presets before answer renders...');
  const allPresetsSync = await evaluate(`
    (async () => {
      const origFetch = window.fetch;
      const results = [];
      window.fetch = async (url, opts) => {
        if (typeof url === 'string' && url.includes('/agent/chat')) {
          await new Promise(r => setTimeout(r, 150));
          return new Response(JSON.stringify({ reply: 'Sync test ack.', tool_trace: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        return origFetch(url, opts);
      };

      const btns = Array.from(document.querySelectorAll('.preset-btn'));
      for (const btn of btns) {
        btn.click();
        // Check scale state immediately after click, BEFORE answer renders
        const mmBeforeRender = document.getElementById('curve-mm-display').textContent;
        const cellsBeforeRender = document.getElementById('curve-cells-count').textContent;
        results.push({
          prompt: btn.dataset.prompt,
          mmBeforeRender,
          cellsBeforeRender,
        });
        await new Promise(r => setTimeout(r, 300));
      }

      window.fetch = origFetch;
      const chatFeed = document.getElementById('chat-messages');
      while (chatFeed.children.length > 1) {
        chatFeed.removeChild(chatFeed.lastChild);
      }
      return results;
    })()
  `);
  console.log('   All 4 presets immediate sync:', JSON.stringify(allPresetsSync, null, 2));
  const expectedMms = ['50 mm/hr', '40 mm/hr', '60 mm/hr', '40 mm/hr'];
  allPresetsSync.forEach((res, idx) => {
    if (res.mmBeforeRender !== expectedMms[idx]) {
      throw new Error(`Preset ${idx + 1} failed immediate sync: got ${res.mmBeforeRender}, expected ${expectedMms[idx]}`);
    }
  });

  // Check 6b: Agent Pump Scenario Preset (Preset 3: 60 mm/hr) & Table Verification
  console.log('6b. Testing Preset 3 (6 pumps @ 60 mm/hr) live agent and pump table...');
  const presetSync3 = await evaluate(`
    (() => {
      const btn = document.querySelector('.preset-btn[data-prompt*="6 pumps"]');
      btn.click();
      return { prompt: btn.dataset.prompt, mmDisplay: document.getElementById('curve-mm-display').textContent, cellsCount: document.getElementById('curve-cells-count').textContent };
    })()
  `);
  console.log('   Preset 3 live click sync:', presetSync3);
  if (presetSync3.mmDisplay !== '60 mm/hr') throw new Error(`Preset 3 failed immediate sync: ${presetSync3.mmDisplay}`);

  await waitForAgentResponse(2, 60000);
  const pumpTableCheck = await evaluate(`
    (() => {
      const msgs = document.querySelectorAll('.message-assistant');
      const last = msgs[msgs.length - 1];
      const table = last.querySelector('.agent-interactive-table') || last.querySelector('table');
      if (!table) return { hasTable: false, text: last.innerText.slice(0, 300) };

      const ths = Array.from(table.querySelectorAll('thead th')).map(th => th.textContent.trim());
      const triggerIdx = ths.findIndex(h => h.toLowerCase().includes('turns on'));
      const whyIdx = ths.findIndex(h => h.toLowerCase().includes('why'));
      const rows = Array.from(table.querySelectorAll('tbody tr')).map(tr => {
        const tds = Array.from(tr.querySelectorAll('td'));
        return {
          location: tds[0] ? tds[0].childNodes[0]?.textContent?.trim() : '',
          trigger: triggerIdx !== -1 && tds[triggerIdx] ? tds[triggerIdx].textContent.trim() : '',
          why: whyIdx !== -1 && tds[whyIdx] ? tds[whyIdx].textContent.trim() : '',
        };
      });
      const hasDetails = table.querySelector('.row-details') !== null;
      const clickableRows = table.querySelectorAll('tr.clickable-row').length;
      const msgText = last.innerText;
      const hasShareSentence = msgText.toLowerCase().includes('share of flooded severity covered');

      return {
        hasTable: true,
        headers: ths,
        rows,
        hasDetails,
        clickableRows,
        hasShareSentence,
        fullText: msgText,
      };
    })()
  `);
  console.log('   Pump table check:', JSON.stringify(pumpTableCheck, null, 2));
  if (!pumpTableCheck.hasTable) {
    console.error('Agent message body:', pumpTableCheck.text);
    throw new Error('Agent reply missing interactive table');
  }
  const allTriggers60 = pumpTableCheck.rows.every(r => r.trigger === '60' || r.trigger === '60.0');
  if (allTriggers60) {
    throw new Error('Pump table Turns on at (mm/hr) still shows 60.0 for all rows!');
  }
  if (!pumpTableCheck.hasShareSentence) {
    throw new Error('Pump response missing Share of flooded severity covered sentence!');
  }

  // Test row click to flyTo
  console.log('6c. Testing table row click flyTo map center...');
  const centerBefore = await evaluate(`[window.map.getCenter().lng, window.map.getCenter().lat]`);
  await evaluate(`
    (() => {
      const row = document.querySelector('.agent-interactive-table tr.clickable-row');
      if (row) row.click();
    })()
  `);
  await sleep(1200);
  const centerAfter = await evaluate(`[window.map.getCenter().lng, window.map.getCenter().lat]`);
  console.log('   Map center moved from', centerBefore, 'to', centerAfter);

  await takeScreenshot('after_pumps.png');

  // Check 7: Agent Route Scenario Preset (Preset 4: 40 mm/hr)
  console.log('7. Testing Preset 4: Route CP to Cyber City (40 mm/hr)...');
  const presetSync4 = await evaluate(`
    (() => {
      const btn = document.querySelector('.preset-btn[data-prompt*="Cyber City"]');
      btn.click();
      return { prompt: btn.dataset.prompt, mmDisplay: document.getElementById('curve-mm-display').textContent, cellsCount: document.getElementById('curve-cells-count').textContent };
    })()
  `);
  console.log('   Preset 4 immediate sync:', presetSync4);
  if (presetSync4.mmDisplay !== '40 mm/hr') throw new Error(`Preset 4 failed immediate sync: ${presetSync4.mmDisplay}`);

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
  console.log('8. Checking for console errors throughout suite...');
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
