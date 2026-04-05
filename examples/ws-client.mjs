#!/usr/bin/env node
/**
 * WoClaw Hub WebSocket Client Example
 * Demonstrates how to connect an agent to the WoClaw Hub
 * 
 * Usage:
 *   HUB_URL=ws://vm153:8082 \
 *   AGENT_ID=my-agent \
 *   TOKEN=WoClaw2026 \
 *   node ws-client.mjs
 */

const HUB_URL = process.env.HUB_URL || 'ws://vm153:8082';
const REST_URL = process.env.REST_URL || 'http://vm153:8083';
const AGENT_ID = process.env.AGENT_ID || 'example-client';
const TOKEN = process.env.TOKEN || 'WoClaw2026';
const TOPIC = process.env.TOPIC || 'general';

const { WebSocket } = await import('ws');

const ws = new WebSocket(`${HUB_URL}?agentId=${AGENT_ID}&token=${TOKEN}`);

ws.on('open', () => {
  console.log(`[${AGENT_ID}] Connected to WoClaw Hub`);
  // Join a topic
  ws.send(JSON.stringify({ type: 'join', topic: TOPIC }));
  console.log(`[${AGENT_ID}] Joining topic: ${TOPIC}`);
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  handleMessage(msg);
});

ws.on('error', (err) => {
  console.error(`[${AGENT_ID}] Error: ${err.message}`);
});

ws.on('close', (code) => {
  console.log(`[${AGENT_ID}] Disconnected (code: ${code})`);
});

function handleMessage(msg) {
  switch (msg.type) {
    case 'welcome':
      console.log(`[${AGENT_ID}] ✅ Authenticated — agentId: ${msg.agentId}, topics: ${JSON.stringify(msg.topics)}`);
      break;
    case 'join':
      console.log(`[${AGENT_ID}] ✅ Joined topic: ${msg.topic}`);
      // Send a test message after joining
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'message', topic: TOPIC, content: `Hello from ${AGENT_ID}!` }));
      }, 500);
      break;
    case 'history':
      console.log(`[${AGENT_ID}] 📜 History for '${msg.topic}': ${msg.messages?.length || 0} messages`);
      msg.messages?.forEach(m => console.log(`    <${m.from}> ${m.content}`));
      break;
    case 'message':
      if (msg.from === AGENT_ID) return; // Skip own messages
      console.log(`[${AGENT_ID}] 📩 ${msg.topic}: <${msg.from}> ${msg.content}`);
      break;
    case 'agents':
      console.log(`[${AGENT_ID}] 👥 Agents in ${msg.topic}: ${JSON.stringify(msg.agents)}`);
      break;
    default:
      console.log(`[${AGENT_ID}] ℹ️  Received: ${JSON.stringify(msg)}`);
  }
}

// Keep alive and handle stdin
if (process.stdin.isTTY) {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (line) => {
    const content = line.trim();
    if (!content) return;
    if (content === '/quit') {
      ws.send(JSON.stringify({ type: 'leave', topic: TOPIC }));
      ws.close(1000, 'Client disconnect');
      process.exit(0);
    }
    ws.send(JSON.stringify({ type: 'message', topic: TOPIC, content }));
  });
}

console.log(`WoClaw WebSocket Client — ${AGENT_ID}`);
console.log(`Hub: ${HUB_URL} | Topic: ${TOPIC}`);
console.log('Type messages to send, /quit to exit');
