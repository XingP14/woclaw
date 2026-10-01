import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { RestServer } from '../src/rest_server.js';
import { ClawDB } from '../src/db.js';
import { WSServer } from '../src/ws_server.js';
import { GraphStore } from '../src/graph/store.js';
import type { Config } from '../src/types.js';

const CFG: Config = {
  port: 18098, restPort: 18099, host: '127.0.0.1',
  dataDir: '/tmp/woclaw-r401-probe',
  storage: { type: 'sqlite', sqlitePath: '/tmp/woclaw-r401-probe/probe.db' },
  authToken: 'r401-probe-token',
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const R = 'http://127.0.0.1:18099';
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${CFG.authToken}` };

describe('R401: orphaned delegation — real agent dies mid-task', () => {
  let db: ClawDB, rest: RestServer, ws: WSServer;

  beforeAll(async () => {
    const fs = await import('fs');
    fs.rmSync(CFG.dataDir!, { recursive: true, force: true });
    fs.mkdirSync(CFG.dataDir!, { recursive: true });
    db = new ClawDB(CFG);
    ws = new WSServer(CFG, db);
    const mem = ws.getMemoryPool();
    const graph = new GraphStore();
    mem.graphStore = graph;
    rest = new RestServer(CFG, db, ws.getTopicsManager(), mem, graph, ws);
    await rest.start();
  });
  afterAll(async () => { /* vitest tears the process down; no explicit stop API */ });

  it('an agent that vanishes while RUNNING leaves a permanently orphaned delegation', async () => {
    // 1. live agent connects
    const sock = new WebSocket(`ws://127.0.0.1:18098?agentId=worker-1&token=${CFG.authToken}`);
    await new Promise((res, rej) => { sock.once('open', res); sock.once('error', rej); });
    console.log('AGENT worker-1 CONNECTED');

    // 2. delegator (also a live agent) creates the task
    const sockD = new WebSocket(`ws://127.0.0.1:18098?agentId=delegator-1&token=${CFG.authToken}`);
    await new Promise((res, rej) => { sockD.once('open', res); sockD.once('error', rej); });
    const mk = (id: string) => new Promise<any>(res => {
      sockD.once('message', m => res(JSON.parse(m.toString())));
      sockD.send(JSON.stringify({ type: 'delegate_request', id, toAgent: 'worker-1',
        task: { description: 'R401 orphan probe' } }));
    });
    const c1 = await mk('d-1');
    console.log('CREATE ->', JSON.stringify(c1));
    const dId = c1.id;
    expect(dId).toBeTruthy();

    // 3. worker accepts (no reply is sent back to the accepting agent — poll REST instead)
    sock.send(JSON.stringify({ type: 'delegate_response', id: dId, status: 'accepted' }));
    await sleep(800);
    let st = await fetch(`${R}/delegations/${dId}`, { headers: H }).then(r => r.json());
    console.log('STATE after accept:', st.delegation.status);
    expect(['accepted', 'running']).toContain(st.delegation.status);

    // 4. THE EVENT UNDER TEST: worker crashes — socket destroyed, no result, no cancel
    sock.terminate();
    await sleep(500);
    console.log('*** worker-1 SOCKET TERMINATED (agent vanished mid-task) ***');

    // 5. observe for 60s: is the delegation ever reaped / failed / cancelled?
    const t0 = Date.now();
    const seen = new Set<string>();
    while (Date.now() - t0 < 60_000) {
      await sleep(5000);
      const cur = await fetch(`${R}/delegations/${dId}`, { headers: H }).then(r => r.json());
      const s = `${cur.delegation.status}`;
      seen.add(s);
      console.log(`t+${Math.round((Date.now() - t0) / 1000)}s status=${s} note=${cur.delegation.note ?? '-'}`);
    }
    // 6. who does the hub think the target is, and is that agent connected?
    const pending = await fetch(`${R}/delegations/pending?agentId=worker-1`, { headers: H }).then(r => r.json());
    console.log('PENDING_FOR_DEAD_AGENT:', JSON.stringify(pending));
    console.log('OBSERVED_STATUS_SET:', JSON.stringify([...seen]));

    // FINDING: only states WE pushed were ever observed. No reaper fired.
    expect([...seen].every(s => s === 'accepted' || s === 'running')).toBe(true);
  }, 150_000);
});
