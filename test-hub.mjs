// WoClaw Hub Connection Test
// Run from repo root: node test-hub.mjs

import pkg from './hub/node_modules/ws/index.js';
const { WebSocket } = pkg;

const HUB_URL = process.env.HUB_URL || 'ws://vm153:8082';
const AGENT_ID = process.env.AGENT_ID || 'p14-test';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'WoClaw2026';

console.log(`Connecting to ${HUB_URL}...`);

const ws = new WebSocket(HUB_URL, {
  headers: {
    'Authorization': `Bearer ${AUTH_TOKEN}`,
    'X-Agent-ID': AGENT_ID
  }
});

ws.on('open', () => {
  console.log('✅ Connected!');
  
  // Join a test topic
  const joinMsg = { type: 'join', topic: 'test' };
  ws.send(JSON.stringify(joinMsg));
  console.log('📤 Joined topic: test');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log(`📨 Type: ${msg.type}`);
  if (msg.type === 'welcome') console.log(`   Agent ID: ${msg.agentId}`);
  if (msg.type === 'message') console.log(`   From: ${msg.from} | Content: ${msg.content}`);
});

ws.on('error', (err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('🔌 Disconnected');
  process.exit(0);
});

// Timeout
setTimeout(() => {
  console.log('✅ Test passed - connection stable');
  ws.close();
}, 5000);
