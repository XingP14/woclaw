// ClawLink Hub - Simple Test Script
// Run: node --loader ts-node/esm test.ts

import { WebSocket } from 'ws';

const HUB_URL = process.env.HUB_URL || 'ws://localhost:8080';
const AGENT_ID = process.env.AGENT_ID || 'test-agent';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'change-me';
const TEST_TOPIC = 'test-topic';

let ws: WebSocket;
let testsPassed = 0;
let testsFailed = 0;

function log(msg: string, isError = false) {
  console.log(`[TEST] ${msg}`);
  if (isError) testsFailed++;
  else testsPassed++;
}

function send(msg: object) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log(`\n🧪 Starting ClawLink tests...`);
  console.log(`   Hub: ${HUB_URL}`);
  console.log(`   Agent: ${AGENT_ID}`);
  console.log('');

  return new Promise<void>((resolve) => {
    ws = new WebSocket(`${HUB_URL}?agentId=${AGENT_ID}&token=${AUTH_TOKEN}`);

    ws.on('open', () => {
      log('Connected to hub');
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      handleMessage(msg);
    });

    ws.on('error', (err) => {
      log(`WebSocket error: ${err.message}`, true);
    });

    ws.on('close', () => {
      log('Disconnected');
      setTimeout(finish, 100);
    });

    let phase = 0;

    function handleMessage(msg: any) {
      switch (msg.type) {
        case 'welcome':
          log(`Welcome: authenticated as ${msg.agentId}`);
          // Start test sequence
          setTimeout(() => {
            send({ type: 'join', topic: TEST_TOPIC });
          }, 100);
          break;

        case 'history':
          if (phase === 0) {
            log(`Joined ${msg.topic}, got ${msg.messages.length} historical messages`);
            phase = 1;
            // Send a message
            setTimeout(() => {
              send({ type: 'message', topic: TEST_TOPIC, content: 'Hello from test!' });
            }, 100);
          }
          break;

        case 'message':
          if (phase === 1) {
            log(`Received message from ${msg.from}: ${msg.content}`);
            phase = 2;
            // Test memory write
            setTimeout(() => {
              send({ type: 'memory_write', key: 'test-key', value: 'test-value' });
            }, 100);
          } else if (phase === 3) {
            log(`Message from ${msg.from}: ${msg.content}`);
          }
          break;

        case 'memory_update':
          log(`Memory updated: ${msg.key} = ${msg.value}`);
          phase = 3;
          // Test memory read
          setTimeout(() => {
            send({ type: 'memory_read', key: 'test-key' });
          }, 100);
          break;

        case 'memory_value':
          log(`Memory read: ${msg.key} = ${msg.value} (exists: ${msg.exists})`);
          phase = 4;
          // Test topics list
          setTimeout(() => {
            send({ type: 'topics_list' });
          }, 100);
          break;

        case 'topics_list':
          log(`Topics list: ${JSON.stringify(msg.topics)}`);
          phase = 5;
          // Test topic members
          setTimeout(() => {
            send({ type: 'topic_members', topic: TEST_TOPIC });
          }, 100);
          break;

        case 'topic_members':
          log(`Topic members: ${JSON.stringify(msg.agents)}`);
          // All tests done, leave
          setTimeout(() => {
            send({ type: 'leave', topic: TEST_TOPIC });
            ws.close();
          }, 100);
          break;

        case 'error':
          log(`Error from server: ${msg.code} - ${msg.message}`, true);
          break;

        case 'join':
          log(`Agent ${msg.agent} joined ${msg.topic}`);
          break;

        case 'leave':
          log(`Agent ${msg.agent} left ${msg.topic}`);
          break;
      }
    }

    function finish() {
      console.log(`\n📊 Test Results:`);
      console.log(`   ✅ Passed: ${testsPassed}`);
      console.log(`   ❌ Failed: ${testsFailed}`);
      console.log('');
      if (testsFailed === 0) {
        console.log('🎉 All tests passed!');
      } else {
        console.log('⚠️  Some tests failed.');
      }
      resolve();
    }

    // Timeout after 30 seconds
    setTimeout(() => {
      log('Test timeout', true);
      ws.close();
      resolve();
    }, 30000);
  });
}

runTests().catch(console.error);
