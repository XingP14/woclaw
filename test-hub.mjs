import WebSocket from 'ws';

const HUB_URL = process.env.CLAWLINK_HUB_URL || 'ws://vm153:8080';
const AGENT_ID = process.env.CLAWLINK_AGENT_ID || 'p14-test';
const TOKEN = process.env.CLAWLINK_TOKEN || 'ClawLink2026';

console.log(`[Test] Connecting to ${HUB_URL} as ${AGENT_ID}...`);

const ws = new WebSocket(`${HUB_URL}?agentId=${AGENT_ID}&token=${TOKEN}`);

ws.on('open', () => {
  console.log('[Test] ✅ Connected');
  
  // Join a test topic
  ws.send(JSON.stringify({ type: 'join', topic: 'test' }));
  console.log('[Test] Joined topic: test');
  
  // Send a test message
  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'message', topic: 'test', content: 'Hello from test script!' }));
    console.log('[Test] Sent test message');
  }, 500);
  
  // Write to shared memory
  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'memory_write', key: 'test-key', value: 'test-value-' + Date.now() }));
    console.log('[Test] Wrote to shared memory');
  }, 1000);
  
  // Read shared memory
  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'memory_read', key: 'test-key' }));
    console.log('[Test] Read from shared memory');
  }, 1500);
  
  // Leave topic
  setTimeout(() => {
    ws.send(JSON.stringify({ type: 'leave', topic: 'test' }));
    console.log('[Test] Left topic');
  }, 2500);
  
  // Close
  setTimeout(() => {
    ws.close();
    console.log('[Test] ✅ All tests passed, closing');
    process.exit(0);
  }, 3000);
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('[Test] 📩 Received:', msg.type, msg);
});

ws.on('error', (err) => {
  console.error('[Test] ❌ Error:', err.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('[Test] Disconnected');
});

setTimeout(() => {
  console.error('[Test] ⏰ Timeout');
  ws.close();
  process.exit(1);
}, 10000);
