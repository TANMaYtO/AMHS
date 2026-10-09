const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9222;
const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'docs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function captureResolution(width, height, filename) {
  console.log(`Capturing ${filename} at ${width}x${height}...`);
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--window-size=${width},${height}`,
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
    } catch (e) {}
  }

  if (!connected) {
    console.error('Failed to connect to Edge CDP');
    edge.kill();
    return;
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

  // Wait for map and data to load
  await sleep(6500);

  const res = await sendCommand('Page.captureScreenshot', { format: 'png' });
  const buffer = Buffer.from(res.data, 'base64');
  const outPath = path.join(SCREENSHOT_DIR, filename);
  fs.writeFileSync(outPath, buffer);
  console.log(`Saved screenshot: ${outPath} (${buffer.length} bytes)`);

  ws.close();
  edge.kill();
  await sleep(1000);
}

async function main() {
  await captureResolution(1920, 1080, 'before_1080p.png');
  await captureResolution(1366, 768, 'before_768p.png');
  console.log('All before screenshots captured successfully.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
