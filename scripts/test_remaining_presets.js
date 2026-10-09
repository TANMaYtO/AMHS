const { spawn } = require('child_process');

async function testRemainingPresets() {
  console.log('Testing presets: 50 mm/hr and Minto Bridge...');
  const resp1 = await fetch('http://127.0.0.1:8000/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Which spots flood first if 50 mm/hr hits tonight?' }),
  });
  const data1 = await resp1.json();
  console.log('50 mm/hr response status:', resp1.status, '| Tools called:', data1.tool_trace.map(t => t.tool));

  const resp2 = await fetch('http://127.0.0.1:8000/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Is Minto Bridge at risk at 40 mm/hr?' }),
  });
  const data2 = await resp2.json();
  console.log('Minto Bridge response status:', resp2.status, '| Tools called:', data2.tool_trace.map(t => t.tool));
}

testRemainingPresets().catch(console.error);
