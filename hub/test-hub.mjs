#!/usr/bin/env node
// WoClaw Hub Connection Diagnostic Tool
// Tests connectivity and basic operations

const HUB_URL = process.env.HUB_URL || 'ws://vm153:8082';
const REST_URL = process.env.REST_URL || 'http://vm153:8083';
const TOKEN = process.env.TOKEN || 'WoClaw2026';
const AGENT_ID = process.env.AGENT_ID || 'diagnostic-' + Date.now();

async function testREST() {
  console.log('\n=== REST API Tests ===');
  
  // Health check
  try {
    const health = await fetch(`${REST_URL}/health`);
    const data = await health.json();
    console.log(`✅ Health: uptime=${Math.floor(data.uptime)}s, agents=${data.agents}, topics=${data.topics}`);
  } catch (e) {
    console.log(`❌ Health check failed: ${e.message}`);
  }

  // Topics list
  try {
    const res = await fetch(`${REST_URL}/topics`, {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const data = await res.json();
    console.log(`✅ Topics: ${JSON.stringify(data.topics)}`);
  } catch (e) {
    console.log(`❌ Topics failed: ${e.message}`);
  }
}

async function testWebSocket() {
  console.log('\n=== WebSocket Tests ===');
  
  const { WebSocket } = await import('ws');
  const ws = new WebSocket(`${HUB_URL}?agentId=${AGENT_ID}&token=${TOKEN}`);
  
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log('❌ WebSocket timeout');
      ws.close();
      resolve();
    }, 5000);

    ws.on('open', () => {
      console.log('✅ WebSocket connected');
      
      // Send join
      ws.send(JSON.stringify({ type: 'join', topic: 'diagnostic' }));
    });

    let joined = false;
    let msgCount = 0;

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      console.log(`📨 Received: ${msg.type}${msg.topic ? ' (topic=' + msg.topic + ')' : ''}`);
      
      if (msg.type === 'welcome') {
        console.log(`✅ Authenticated as ${msg.agentId}`);
      }
      if (msg.type === 'history' && !joined) {
        // First response after join - confirm we received history
        console.log(`✅ Joined topic 'diagnostic' (received ${msg.messages?.length || 0} historical messages)`);
        joined = true;
        
        // Send a test message
        ws.send(JSON.stringify({ type: 'message', topic: 'diagnostic', content: 'Diagnostic test message from p14' }));
      }
      if (msg.type === 'message' && msg.content?.includes('Diagnostic test message')) {
        msgCount++;
        if (msg.sent) {
          console.log(`✅ Message round-trip successful (delivered)`);
          // Leave topic
          ws.send(JSON.stringify({ type: 'leave', topic: 'diagnostic' }));
        }
      }
      if (msg.type === 'history' && joined) {
        // After leaving, some hubs send a final history - we're done
        console.log(`✅ Test complete`);
        clearTimeout(timeout);
        ws.close(1000, 'Test complete');
        resolve();
      }
    });

    ws.on('error', (e) => {
      console.log(`❌ WebSocket error: ${e.message}`);
      clearTimeout(timeout);
      resolve();
    });

    ws.on('close', (code) => {
      console.log(`🔌 WebSocket closed (code: ${code})`);
    });
  });
}

async function main() {
  console.log(`WoClaw Hub Diagnostic Tool`);
  console.log(`Hub: ${HUB_URL}`);
  console.log(`REST: ${REST_URL}`);
  console.log(`Agent: ${AGENT_ID}`);
  
  await testREST();
  await testWebSocket();
  
  console.log('\n=== Done ===');
}

main().catch(console.error);
