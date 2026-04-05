import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { ChildProcess, spawn } from 'child_process';
import WebSocket from 'ws';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

// Start the Hub server on a random available port
const HUB_PORT = 18082;
const REST_PORT = 18083;
const AUTH_TOKEN = 'test-token-123';
const HUB_URL = `ws://127.0.0.1:${HUB_PORT}`;
const REST_URL = `http://127.0.0.1:${REST_PORT}`;
const DATA_DIR = `/tmp/woclaw-integration-test-${Date.now()}`;
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(TEST_DIR, '..');
const HUB_DIR = path.join(ROOT_DIR, 'hub');
const TSC_BIN = path.join(ROOT_DIR, 'node_modules', 'typescript', 'bin', 'tsc');

let hubProcess: ChildProcess;

function startHub(): Promise<void> {
  return new Promise((resolve, reject) => {
    const build = spawn('/bin/bash', ['-lc', `node "${TSC_BIN}" -p tsconfig.json`], {
      cwd: HUB_DIR,
      env: process.env,
      stdio: 'inherit',
    });

    build.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Build failed: ${code}`));
        return;
      }
      hubProcess = spawn('/bin/bash', ['-lc', 'node dist/index.js'], {
        cwd: HUB_DIR,
        env: {
          ...process.env,
          PORT: String(HUB_PORT),
          REST_PORT: String(REST_PORT),
          AUTH_TOKEN,
          HOST: '0.0.0.0',
          DATA_DIR,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      resolve();
    });

    build.on('error', (error) => {
      reject(error);
    });
  });
}

function stopHub(): Promise<void> {
  return new Promise((resolve) => {
    if (hubProcess) {
      hubProcess.on('close', resolve);
      hubProcess.kill('SIGTERM');
      setTimeout(() => {
        hubProcess.kill('SIGKILL');
        resolve();
      }, 3000);
    } else {
      resolve();
    }
  });
}

async function waitForHub(ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${REST_URL}/health`);
      if (res.ok) return;
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Hub failed to start');
}

describe('WoClaw Hub Integration Tests', () => {
  beforeAll(async () => {
    await startHub();
    await waitForHub();
  }, 60000);

  afterAll(async () => {
    await stopHub();
    // Cleanup data dir
    try {
      const { rmSync } = await import('fs');
      rmSync(DATA_DIR, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  afterEach(async () => {
    // Clean up memory between tests via REST
    try {
      await fetch(`${REST_URL}/memory`, {
        headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` }
      });
    } catch { /* ignore */ }
  });

  // ─── REST API Tests ──────────────────────────────────────────────

  describe('REST API - Health', () => {
    it('GET /health returns ok status', async () => {
      const res = await fetch(`${REST_URL}/health`);
      const body = await res.json() as any;
      expect(body.status).toBe('ok');
      expect(body.agents).toBeDefined();
      expect(body.topics).toBeDefined();
    });
  });

  describe('REST API - Topics', () => {
    it('GET /topics returns topic list', async () => {
      const res = await fetch(`${REST_URL}/topics`);
      const body = await res.json() as any;
      expect(Array.isArray(body.topics)).toBe(true);
    });
  });

  describe('REST API - Memory', () => {
    it('POST /memory writes a memory entry', async () => {
      const res = await fetch(`${REST_URL}/memory`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${AUTH_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ key: 'test-key', value: 'test-value', tags: ['test'], ttl: 60 }),
      });
      const body = await res.json() as any;
      expect(body.key).toBe('test-key');
      expect(body.value).toBe('test-value');
      expect(body.tags).toContain('test');
    });

    it('GET /memory/:key reads a memory entry', async () => {
      await fetch(`${REST_URL}/memory`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${AUTH_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'read-test', value: 'read-value' }),
      });
      const res = await fetch(`${REST_URL}/memory/read-test`, {
        headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` },
      });
      const body = await res.json() as any;
      expect(body.key).toBe('read-test');
      expect(body.value).toBe('read-value');
    });

    it('GET /memory returns all memory entries', async () => {
      await fetch(`${REST_URL}/memory`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${AUTH_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'bulk1', value: 'v1' }),
      });
      await fetch(`${REST_URL}/memory`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${AUTH_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'bulk2', value: 'v2' }),
      });
      const res = await fetch(`${REST_URL}/memory`, {
        headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` },
      });
      const body = await res.json() as any;
      expect(Array.isArray(body.memory)).toBe(true);
      expect(body.memory.length).toBeGreaterThanOrEqual(2);
    });

    it('GET /memory/:key returns 404 for non-existent key', async () => {
      const res = await fetch(`${REST_URL}/memory/nonexistent-key-xyz`, {
        headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` },
      });
      expect(res.status).toBe(404);
    });

    it('DELETE /memory/:key deletes a memory entry', async () => {
      await fetch(`${REST_URL}/memory`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${AUTH_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'delete-me', value: 'v' }),
      });
      const del = await fetch(`${REST_URL}/memory/delete-me`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` },
      });
      expect(del.status).toBe(200);
      const get = await fetch(`${REST_URL}/memory/delete-me`, {
        headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` },
      });
      expect(get.status).toBe(404);
    });

    it('rejects requests without valid token', async () => {
      const res = await fetch(`${REST_URL}/memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'k', value: 'v' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('REST API - Admin', () => {
    it('GET /admin/token/status rejects requests without token', async () => {
      const res = await fetch(`${REST_URL}/admin/token/status`);
      expect(res.status).toBe(401);
    });
  });

  // ─── WebSocket Tests ──────────────────────────────────────────────

  describe('WebSocket - Connection', () => {
    it('connects with valid token', async () => {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`${HUB_URL}?agentId=test-agent&token=${AUTH_TOKEN}`);
        ws.on('open', () => { ws.close(); resolve(undefined); });
        ws.on('error', reject);
      });
    });

    it('reconnects on disconnect', async () => {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`${HUB_URL}?agentId=reconnect-agent&token=${AUTH_TOKEN}`);
        ws.on('open', () => {
          ws.close();
          setTimeout(() => {
            const ws2 = new WebSocket(`${HUB_URL}?agentId=reconnect-agent&token=${AUTH_TOKEN}`);
            ws2.on('open', () => { ws2.close(); resolve(undefined); });
            ws2.on('error', reject);
          }, 500);
        });
        ws.on('error', reject);
      });
    });
  });

  describe('WebSocket - Topics', () => {
    it('receives welcome message on connect', async () => {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`${HUB_URL}?agentId=ws-test-agent&token=${AUTH_TOKEN}`);
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'welcome') {
            expect(msg.agentId).toBe('ws-test-agent');
            ws.close();
            resolve(undefined);
          }
        });
        ws.on('error', reject);
      });
    });

    it('joins topic and receives history', async () => {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`${HUB_URL}?agentId=history-test-agent&token=${AUTH_TOKEN}`);
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'history' && msg.topic === 'general') {
            expect(Array.isArray(msg.messages)).toBe(true);
            ws.close();
            resolve(undefined);
          }
        });
        ws.on('error', reject);
        setTimeout(() => {
          ws.send(JSON.stringify({ type: 'join', topic: 'general' }));
        }, 200);
      });
    });

    it('broadcasts message to all topic members', async () => {
      const msgContent = `broadcast-test-${Date.now()}`;
      await new Promise((resolve, reject) => {
        const ws1 = new WebSocket(`${HUB_URL}?agentId=broadcaster&token=${AUTH_TOKEN}`);
        ws1.on('open', () => {
          ws1.send(JSON.stringify({ type: 'join', topic: 'broadcast-topic' }));
          const ws2 = new WebSocket(`${HUB_URL}?agentId=broadcast-receiver&token=${AUTH_TOKEN}`);
          ws2.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'message' && msg.content === msgContent && msg.from === 'broadcaster') {
              ws1.close();
              ws2.close();
              resolve(undefined);
            }
          });
          ws2.on('error', reject);
          ws2.on('open', () => {
            ws2.send(JSON.stringify({ type: 'join', topic: 'broadcast-topic' }));
          });
          setTimeout(() => {
            ws1.send(JSON.stringify({ type: 'message', topic: 'broadcast-topic', content: msgContent }));
          }, 500);
        });
        ws1.on('error', reject);
      });
    }, 20000);

  describe('WebSocket - Memory via WS', () => {
    it('reads memory via WebSocket', async () => {
      await fetch(`${REST_URL}/memory`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${AUTH_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'ws-read-test', value: 'ws-read-value' }),
      });
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`${HUB_URL}?agentId=ws-mem-reader&token=${AUTH_TOKEN}`);
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'memory_value' && msg.key === 'ws-read-test') {
            expect(msg.value).toBe('ws-read-value');
            ws.close();
            resolve(undefined);
          }
        });
        ws.on('error', reject);
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'memory_read', key: 'ws-read-test' }));
        });
      });
    }, 15000);
  });

  describe('WebSocket - Ping/Pong', () => {
    it('responds to ping', async () => {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`${HUB_URL}?agentId=ping-agent&token=${AUTH_TOKEN}`);
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'pong') {
            ws.close();
            resolve(undefined);
          }
        });
        ws.on('open', () => {
          ws.send(JSON.stringify({ type: 'ping' }));
        });
        ws.on('error', reject);
      });
    });
  });

  describe('REST API - Delegations', () => {
    it('POST /delegations auto-generates an id and delivers to connected agents', async () => {
      await new Promise((resolve, reject) => {
        const target = new WebSocket(`${HUB_URL}?agentId=delegate-target&token=${AUTH_TOKEN}`);
        target.on('message', async (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'delegate_incoming') {
            try {
              expect(msg.fromAgent).toBe('rest-api');
              expect(msg.task?.description).toBe('generated-id test');
              target.close();
              resolve(undefined);
            } catch (error) {
              reject(error);
            }
          }
        });
        target.on('error', reject);
        target.on('open', async () => {
          try {
            const res = await fetch(`${REST_URL}/delegations`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${AUTH_TOKEN}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                toAgent: 'delegate-target',
                task: { description: 'generated-id test' },
              }),
            });
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(typeof body.id).toBe('string');
            expect(body.id.length).toBeGreaterThan(0);
            expect(body.status).toBe('requested');
          } catch (error) {
            reject(error);
          }
        });
      });
    }, 20000);
  });

  // ─── Multi-Agent Tests ────────────────────────────────────────────

  describe('Multi-Agent Coordination', () => {
    it('two agents can coordinate via topics', async () => {
      const coordTopic = `coord-test-${Date.now()}`;
      const msgFromA = `coord-msg-a-${Date.now()}`;

      let bReady = false;
      await new Promise((resolve, reject) => {
        const wsA = new WebSocket(`${HUB_URL}?agentId=agent-A&token=${AUTH_TOKEN}`);
        const wsB = new WebSocket(`${HUB_URL}?agentId=agent-B&token=${AUTH_TOKEN}`);

        wsB.on('open', () => {
          wsB.send(JSON.stringify({ type: 'join', topic: coordTopic }));
          bReady = true;
        });

        wsB.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'message' && msg.content === msgFromA && msg.from === 'agent-A') {
            wsA.close();
            wsB.close();
            resolve(undefined);
          }
        });
        wsB.on('error', reject);

        wsA.on('open', () => {
          wsA.send(JSON.stringify({ type: 'join', topic: coordTopic }));
        });
        wsA.on('error', reject);

        setTimeout(() => {
          if (bReady) {
            wsA.send(JSON.stringify({ type: 'message', topic: coordTopic, content: msgFromA }));
          }
        }, 800);
      });
    });
  });
});

});
