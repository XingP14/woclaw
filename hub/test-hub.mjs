#!/usr/bin/env node
/**
 * WoClaw Hub Connection Test
 * Tests WebSocket and REST API connectivity to the WoClaw Hub
 */

import WebSocket from 'ws';

const HUB_WS = process.env.HUB_WS || 'ws://vm153:8082';
const HUB_REST = process.env.HUB_REST || 'http://vm153:8083';
const AGENT_ID = process.env.AGENT_ID || 'p14-test';
const TOKEN = process.env.AUTH_TOKEN || 'ClawLink2026';

const TEST_TOPIC = 'test-' + Date.now();
let ws = null;
let passed = 0;
let failed = 0;

function log(msg, type = 'info') {
  const ts = new Date().toISOString().split('T')[1].slice(0, 8);
  const icon = type === 'pass' ? '✅' : type === 'fail' ? '❌' : type === 'info' ? 'ℹ️' : '🔄';
  console.log(`[${ts}] ${icon} ${msg}`);
}

function assert(condition, message) {
  if (condition) {
    log(message, 'pass');
    passed++;
  } else {
    log(message, 'fail');
    failed++;
  }
}

async function testREST() {
  log('Testing REST API...');
  
  // Health check
  try {
    const res = await fetch(`${HUB_REST}/health`);
    const data = await res.json();
    assert(data.status === 'ok', `REST /health: ok (uptime: ${Math.round(data.uptime)}s, agents: ${data.agents}, topics: ${data.topics})`);
  } catch (e) {
    assert(false, `REST /health: ${e.message}`);
  }

  // Topics list
  try {
    const res = await fetch(`${HUB_REST}/topics`);
    const data = await res.json();
    assert(Array.isArray(data.topics), `REST /topics: ${data.topics.length} topics`);
  } catch (e) {
    assert(false, `REST /topics: ${e.message}`);
  }

  // Memory list
  try {
    const res = await fetch(`${HUB_REST}/memory`);
    const data = await res.json();
    assert(Array.isArray(data.memory), `REST /memory: ${data.memory.length} entries`);
  } catch (e) {
    assert(false, `REST /memory: ${e.message}`);
  }
}

async function testWS() {
  return new Promise((resolve) => {
    log(`Testing WebSocket connection to ${HUB_WS}...`);
    
    ws = new WebSocket(HUB_WS);
    let gotHistory = false;
    let gotMemoryUpdate = false;

    const timeout = setTimeout(() => {
      assert(false, 'WebSocket connection timeout');
      if (ws) ws.close();
      resolve();
    }, 10000);

    ws.on('open', () => {
      log('WebSocket: connected, sending auth...');
      ws.send(JSON.stringify({ type: 'auth', agentId: AGENT_ID, token: TOKEN }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      
      // Log all incoming messages for debugging
      if (msg.type !== 'pong') {
        log(`WS <<< ${msg.type}: ${JSON.stringify(msg).slice(0, 120)}`);
      }
      
      if (msg.type === 'welcome') {
        assert(true, `WS Auth: ok (agentId: ${msg.agentId})`);
        // Join test topic
        ws.send(JSON.stringify({ type: 'join', topic: TEST_TOPIC }));
      } else if (msg.type === 'auth_error') {
        assert(false, `WS Auth: failed - ${msg.error}`);
        ws.close();
        clearTimeout(timeout);
        resolve();
      } else if (msg.type === 'history') {
        gotHistory = true;
        assert(true, `WS Join topic: ok (topic: ${msg.topic}, history: ${msg.messages?.length || 0} msgs)`);
        // Test memory write
        ws.send(JSON.stringify({
          type: 'memory_write',
          key: `test:${TEST_TOPIC}`,
          value: `Hello from ${AGENT_ID} at ${new Date().toISOString()}`,
          tags: ['test'],
          ttl: 3600
        }));
      } else if (msg.type === 'memory_update') {
        if (msg.key && msg.key.includes('test:')) {
          gotMemoryUpdate = true;
          assert(true, `WS Memory Write: ok (key: ${msg.key}, tags: ${JSON.stringify(msg.tags)})`);
          // Send a message to the topic
          ws.send(JSON.stringify({ type: 'message', topic: TEST_TOPIC, content: 'Hello from test!' }));
        }
      } else if (msg.type === 'message') {
        if (msg.topic === TEST_TOPIC && msg.from === AGENT_ID) {
          assert(true, `WS Pub/Sub: ok (msg id: ${msg.id}, content: ${msg.content})`);
          // Leave topic and done
          ws.send(JSON.stringify({ type: 'leave', topic: TEST_TOPIC }));
          setTimeout(() => {
            if (ws) ws.close();
            clearTimeout(timeout);
            resolve();
          }, 500);
        }
      } else if (msg.type === 'error') {
        assert(false, `WS Error: ${msg.code} - ${msg.message}`);
      }
    });

    ws.on('error', (e) => {
      assert(false, `WebSocket error: ${e.message}`);
      clearTimeout(timeout);
      resolve();
    });

    ws.on('close', (code, reason) => {
      log(`WebSocket: disconnected (code: ${code})`);
      if (!gotHistory || !gotMemoryUpdate) {
        // Already handled by timeout/assert
      }
    });
  });
}

async function main() {
  console.log('===========================================');
  log(`WoClaw Hub Test - ${new Date().toISOString()}`);
  log(`WS: ${HUB_WS} | REST: ${HUB_REST}`);
  log(`Agent: ${AGENT_ID} | Token: ${TOKEN.slice(0, 4)}***`);
  console.log('===========================================');

  await testREST();
  await testWS();

  console.log('===========================================');
  log(`Results: ${passed} passed, ${failed} failed`);
  console.log('===========================================');
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
