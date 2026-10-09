const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9222;
const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'docs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  console.log('Capturing route scenario...');
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
  await sendCommand('Page.enable');
  await sendCommand('Runtime.enable');

  async function evaluate(expression) {
    const res = await sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    return res.result.value;
  }

  await sleep(6000);

  // Click route preset
  console.log('Clicking route preset...');
  await evaluate(`
    (() => {
      const btn = document.querySelector('.preset-btn[data-prompt*="Cyber City"]');
      if (btn) btn.click();
    })()
  `);

  console.log('Waiting for route query and OSRM to resolve...');
  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const feats = await evaluate(`
      (() => {
        const src = window.map.getSource('agent-route');
        return src && src._data && src._data.features ? src._data.features.length : 0;
      })()
    `);
    if (feats > 0) {
      console.log(`Route line detected with ${feats} features!`);
      break;
    }
  }

  await sleep(2000); // Allow fitBounds animation to complete

  const res = await sendCommand('Page.captureScreenshot', { format: 'png' });
  const buffer = Buffer.from(res.data, 'base64');
  const outPath = path.join(SCREENSHOT_DIR, 'after_route.png');
  fs.writeFileSync(outPath, buffer);
  console.log(`Saved screenshot: ${outPath} (${buffer.length} bytes)`);

  ws.close();
  edge.kill();
}

run().catch(console.error);
