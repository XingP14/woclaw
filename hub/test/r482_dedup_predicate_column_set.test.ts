/**
 * R482 — the deduplication predicate compares one column; the writer mutates six.
 *
 * -----------------------------------------------------------------------
 * SELECTION (R74). R441–R481 were 34+ consecutive in-cluster rounds. This
 * round opens a NEW plane — **message identity / delivery semantics** — and
 * runs the EXTERNAL leg first. HN Algolia, controls first:
 * `AI agent` = 20,511, `LLM` = 54,181 (so the zeros below are evidence).
 * Precision angles: `agent deduplicate message replay` = 0,
 * `agent message replay duplicate delivery` = 0,
 * `dedupe subscriber agent bus` = 0,
 * `exactly once delivery agent` = 8, `agent message delivery idempotency` = 1.
 * NOT reported as greenfield: idempotency keys / transactional outboxes /
 * at-least-once semantics are all solved in the distributed-systems
 * literature. This is a MIGRATION GAP, and reporting virgin territory here
 * would be wrong (R449-5 / R454-4 / R475-3 discipline).
 *
 * R466-INDEPENDENCE. R481 measured a pagination-vs-filter interaction;
 * R476 measured that a message is durable but its delivery unrecorded. This
 * round asserts nothing about a derived subject set and imports no other
 * suite's logic: every arm either drives `MemoryPool.write` / a real WSServer
 * / a real REST server and reads back the stored row, or counts frames a
 * round-caused write produced. No shared upstream, no shared `ROUNDED` set.
 *
 * -----------------------------------------------------------------------
 * THE SHAPE, FROM THE FILES
 *
 * `MemoryPool.write` (memory.ts:130) computes the dedup predicate:
 *
 *     const existing  = await this.db.getMemory(key);
 *     const duplicate = !!existing && existing.value === serialized;
 *     const conflict  = !!existing && existing.value !== serialized;
 *     ...
 *     await this.db.setMemory(key, serialized, updatedBy, tags, ttl);
 *     if (!duplicate) this.notifySubscribers({ type: 'memory_write', ... });
 *
 * `ClawDB.setMemory` (db.ts:700) mutates SIX columns in one transaction:
 *
 *     UPDATE memory SET value = ?, tags = ?, ttl = ?, expire_at = ?,
 *                        updated_at = ?, updated_by = ?  WHERE key = ?
 *
 * `value` is the only column the predicate looks at. Measured below.
 *
 * -----------------------------------------------------------------------
 * THE FINDINGS (each measured, not argued)
 *
 *   F1  A TTL-ONLY change is reported as `duplicate`. Row: ttl 0 -> 60,
 *       expire_at 0 -> 1792278236754. Predicate: duplicate = true.
 *   F2  A TAGS-ONLY change is reported as `duplicate`. Row: tags
 *       ['x'] -> ['x','y']. Predicate: duplicate = true.
 *   F3  An identical replay still advances `updated_at`
 *       (1792278176768 -> ...769) while archiving NO new version.
 *       "Nothing changed" is false about one of the six columns and the
 *       predicate cannot see it.
 *
 *   F4  The channel the predicate GUARDS has no production subscriber:
 *       `MemoryPool.subscribe` has ZERO call sites under `hub/src`. So the
 *       `if (!duplicate)` gate is currently unreachable, and its behaviour
 *       under F1/F2 cannot change any product outcome.
 *   F5  The channel that DOES deliver ignores the predicate: over WS,
 *       `handleMemoryWrite` notifies every agent UNCONDITIONALLY
 *       (ws_server.ts:528-533), so a duplicate write is still announced —
 *       carrying `conflictType: 'DUPLICATE_WRITE'` and the NEW ttl/expireAt
 *       in the same self-contradictory frame.
 *   F6  The REST writer bypasses both: `pool.subscribe` is never called and
 *       `rest_server.handleMemoryWrite` never calls `notifySubscribers` at
 *       all. Measured: POST /memory -> a connected WS agent receives 0
 *       frames, first write and conflict write alike.
 *
 * F1–F3 + F5 are pinned as current behaviour (they are QUIET: HTTP 200,
 * `{success}`-shaped bodies, stored row changed). F6 is the headline:
 * the shared-memory plane's REST half is invisible to its agent half.
 *
 * -----------------------------------------------------------------------
 * MUTATION MATRIX (control first; `hub/scripts/r482_matrix.py`; stable over
 * 3 consecutive full runs after the timing fix below). 6 KILLED / 3 SURVIVED,
 * 0 HARNESS, `hub/src` byte-identical before and after every arm.
 *
 *   M1  predicate also compares ttl ..................... KILLED (F1)
 *   M2  predicate also compares tags .................... KILLED (F2)
 *   M3  skip the UPDATE on a duplicate .................. KILLED (F3)
 *   M4  guard `notifySubscribers` in the WS handler ..... SURVIVED
 *   M5  REST write notifies the pool ..................... SURVIVED
 *   M8  add a production `subscribe()` call site ......... KILLED (F4)
 *   M9  M5 + M8 TOGETHER ................................ KILLED (F6)
 *   M10 guard the per-agent SEND LOOP instead ........... KILLED (F5)
 *   M7  NEGATIVE CONTROL: no-op reference ................ SURVIVED (correct)
 *
 * M4 SURVIVED and M10 KILLED are the same fact from two sides: the WS handler
 * has TWO delivery paths, and guarding one leaves the other. M5 SURVIVED
 * while M9 KILLED says the same thing about F4 -- a pool notification reaches
 * nobody, because nobody subscribes. Both survivors are therefore evidence,
 * not holes in the suite.
 *
 * R482 METHODOLOGY, three items, each paid for with a wrong answer:
 *   1. A negative control is only valid if you CHECK it is no-op. M6 was
 *      labelled "pure rename" and renamed a method its callers still call
 *      -- a real runtime break, so its red was not evidence. Relabelled.
 *   2. "The `Tests` line is present" is not a sufficient classifier. A
 *      compile failure prints `Tests  no tests`, which contains the string
 *      and was scored SURVIVED. Require the summary SHAPE, not the substring.
 *      (Sibling of the r479 lesson; the r479 rule was incomplete.)
 *   3. A wire arm that sleeps a fixed interval is a coin flip. M4/M5/M7
 *      changed verdicts across runs on IDENTICAL source. Polling for the
 *      condition (and keeping a settle window only for ABSENCE assertions)
 *      made three consecutive matrix runs agree exactly. A verdict that
 *      moves between runs is a harness artefact, not a finding.
 *
 * ALL REPAIRS ARE FATHER-GATED — each direction is a product posture:
 *   F1/F2  compare all six columns (then a tags-only write notifies) OR
 *          compare the pair the caller intends to change (needs the caller
 *          to say so) OR keep value-only and stop calling it dedup.
 *   F3     a replay that bumps updated_at is either intended (last-touch
 *          wins) or a bug (then the UPDATE must be skipped entirely).
 *   F5     `duplicate` reaching subscribers at all is R414/R476 territory.
 *   F6     REST writes not reaching agents may be by design (REST = pull
 *          API) or may be the missing link; the answer is a product call.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import WebSocket from 'ws';
import http from 'node:http';
import { rmSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WSServer } from '../src/ws_server.js';
import { RestServer } from '../src/rest_server.js';
import { MemoryPool } from '../src/memory.js';
import { ClawDB } from '../src/db.js';
import { GraphStore } from '../src/graph/store.js';
import type { Config, InboundMessage } from '../src/types.js';

const SRC = join(import.meta.dirname, '..', 'src');
const CFG = {
  hubId: 'r482', authToken: 'r482token',
  dataDir: `/tmp/woclaw-r482-${process.pid}`, port: 0, restPort: 0,
} as unknown as Config;

function tmpDir(): string {
  const d = `/tmp/woclaw-r482-pool-${Date.now()}-${Math.random()}`;
  mkdirSync(d, { recursive: true });
  return d;
}

function post(port: number, body: unknown): Promise<{ status: number; headers: any; json: any }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port, path: '/memory', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload),
                   Authorization: `Bearer ${CFG.authToken}` } },
      (res) => {
        let d = '';
        res.on('data', c => { d += c; });
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, json: JSON.parse(d) }));
      });
    req.on('error', reject);
    req.end(payload);
  });
}


/** Poll until `pred` holds, instead of sleeping a fixed interval.
 *  Fixed sleeps made the wire arms timing-dependent: identical source gave
 *  different matrix verdicts across runs (M4/M7 flipped). A condition wait
 *  removes the race instead of widening the window until it stops firing. */
async function waitFor(pred: () => boolean, ms = 3000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise(r => setTimeout(r, 25));
  }
  return pred();
}
const MEM_FRAMES = (frames: any[]) => frames.filter(f => f.type === 'memory_write' || f.type === 'memory_update');

describe('R482 pool: the dedup predicate reads one column, the writer mutates six', () => {
  let db: ClawDB, pool: MemoryPool;
  let notified: unknown[];

  beforeEach(() => {
    db = new ClawDB(tmpDir());
    pool = new MemoryPool(db);
    notified = [];
    pool.subscribe('sub', (m) => notified.push(m));
  });
  afterEach(async () => { await db.close(); });

  // A — CONTROL. A genuine value change is neither duplicate nor silent.
  it('A: a value change notifies exactly once and is not a duplicate', async () => {
    await pool.write('k', 'v1', 'a');
    const r = await pool.write('k', 'v2', 'a');
    expect(r.duplicate).toBe(false);
    expect(r.conflict).toBe(true);
    expect(notified.length).toBe(2); // first write + the conflict write
    expect((await db.getMemory('k'))!.value).toBe('v2');
  });

  // F1 — the ttl arm. QUIET: no error, HTTP would be 200, row changed.
  it('F1: a TTL-only change is reported duplicate while expire_at moves', async () => {
    await pool.write('k', 'v', 'a', [], 0);
    const before = await db.getMemory('k');
    const r = await pool.write('k', 'v', 'a', [], 60);
    const after = await db.getMemory('k');
    // The row genuinely changed on two columns the predicate never reads.
    expect(after!.ttl).toBe(60);
    expect(after!.expireAt).toBeGreaterThan(0);
    expect(before!.expireAt).toBe(0);
    // ...and the predicate says nothing happened.
    expect(r.duplicate).toBe(true);
    expect(r.conflict).toBe(false);
    // ...and nothing was announced, although the row moved.
    expect(notified.length).toBe(1);
  });

  // F2 — the tags arm, same shape, different column.
  it('F2: a tags-only change is reported duplicate while the tag set grows', async () => {
    await pool.write('k', 'v', 'a', ['x']);
    const r = await pool.write('k', 'v', 'a', ['x', 'y']);
    const after = await db.getMemory('k');
    expect(after!.tags).toEqual(['x', 'y']);
    expect(r.duplicate).toBe(true);
    expect(notified.length).toBe(1);
  });

  // F3 — "nothing changed" is false about updated_at.
  it('F3: an identical replay is called a duplicate yet still runs the full UPDATE', async () => {
    await pool.write('k', 'v', 'writer1');
    const r = await pool.write('k', 'v', 'writer2');
    expect(r.duplicate).toBe(true);
    // "nothing changed" ... but the row's author was rewritten
    expect((await db.getMemory('k'))!.updatedBy).toBe('writer2');
    // ... and the prior row was archived into the version history,
    // which is the system's own record that a write happened.
    const versions = await db.getMemoryVersions('k');
    expect(versions.length).toBe(1);
    expect(versions[0].updatedBy).toBe('writer1');
    // ... yet no subscriber was told.
    expect(notified.length).toBe(1);
  });

  // F4 — SHAPE detector: the guarded channel has no production subscriber.
  // Read code lines only; prose is not evidence (R460-3).
  it('F4: MemoryPool.subscribe has no production call site', () => {
    const prod = readFileSync(join(SRC, 'ws_server.ts'), 'utf8').replace(/\/\/.*$/gm, ' ');
    const rest = readFileSync(join(SRC, 'rest_server.ts'), 'utf8').replace(/\/\/.*$/gm, ' ');
    const index = readFileSync(join(SRC, 'index.ts'), 'utf8').replace(/\/\/.*$/gm, ' ');
    for (const [name, text] of [['ws_server.ts', prod], ['rest_server.ts', rest], ['index.ts', index]] as const) {
      expect(text, `${name} subscribes to the pool`).not.toMatch(/\.subscribe\(/);
    }
    // the gate exists and is real — it is just unreachable
    expect(readFileSync(join(SRC, 'memory.ts'), 'utf8')).toMatch(/if \(!duplicate\)/);
  });
});

describe('R482 hub: the channel that delivers ignores the predicate; the REST writer reaches neither', () => {
  let db: ClawDB, rest: RestServer, ws: WSServer, wsPort: number, restPort: number;
  const opened: WebSocket[] = [];

  beforeAll(async () => {
    rmSync(CFG.dataDir!, { recursive: true, force: true });
    mkdirSync(CFG.dataDir!, { recursive: true });
    db = new ClawDB(CFG);
    ws = new WSServer(CFG, db);
    const mem = ws.getMemoryPool();
    mem.graphStore = new GraphStore();
    rest = new RestServer(CFG, db, ws.getTopicsManager(), mem, mem.graphStore, ws);
    await rest.start();
    wsPort = await ws.whenListening();
    restPort = await rest.whenListening();
  });
  afterAll(() => {
    for (const s of opened) { try { s.close(); } catch { /* gone */ } }
    try { rest.close(); } catch { /* gone */ }
    try { ws.close(); } catch { /* gone */ }
    void db.close();
  });

  async function watcher(agentId: string): Promise<WebSocket & { frames: any[] }> {
    const s = new WebSocket(`ws://127.0.0.1:${wsPort}?agentId=${agentId}&token=${CFG.authToken}`);
    opened.push(s);
    await new Promise<void>((res, rej) => { s.once('open', () => res()); s.once('error', rej); });
    const frames: any[] = [];
    s.on('message', (raw) => { try { frames.push(JSON.parse(raw.toString())); } catch { /* not json */ } });
    (s as any).frames = frames;
    await new Promise(r => setTimeout(r, 250));
    frames.length = 0;
    return s as WebSocket & { frames: any[] };
  }

  // B — CONTROL over the wire: a value change reaches the agent.
  it('B: a WS value change reaches a connected agent as memory_update', async () => {
    const w = await watcher('bWatcher');
    const writer = await watcher('bWriter');
    writer.send(JSON.stringify({ type: 'memory_write', key: 'bk', value: 'v1' } as InboundMessage));
    await waitFor(() => MEM_FRAMES(w.frames).length > 0);
    const updates = w.frames.filter(f => f.type === 'memory_update');
    expect(updates.length).toBe(1);
    expect(updates[0].value).toBe('v1');
  });

  // F5 — self-contradictory frame: DUPLICATE_WRITE carrying a moved expiry.
  it('F5: a TTL-only WS write is announced DUPLICATE_WRITE with the new expiry', async () => {
    const w = await watcher('f5Watcher');
    const writer = await watcher('f5Writer');
    writer.send(JSON.stringify({ type: 'memory_write', key: 'fk', value: 'v', ttl: 0 } as InboundMessage));
    await new Promise(r => setTimeout(r, 350));
    w.frames.length = 0;
    writer.send(JSON.stringify({ type: 'memory_write', key: 'fk', value: 'v', ttl: 600 } as InboundMessage));
    await waitFor(() => MEM_FRAMES(w.frames).length > 0);
    const updates = w.frames.filter(f => f.type === 'memory_update');
    // announced even though the pool-level gate says "nothing changed"
    expect(updates.length).toBe(1);
    // and the frame contradicts itself
    expect(updates[0].conflictType).toBe('DUPLICATE_WRITE');
    expect(updates[0].ttl).toBe(600);
    expect(updates[0].expireAt).toBeGreaterThan(0);
    expect((await db.getMemory('fk'))!.ttl).toBe(600);
  });

  // F6 — HEADLINE. The REST writer reaches no agent on any channel.
  it('F6: POST /memory notifies no connected WS agent, first write or conflict', async () => {
    const w = await watcher('f6Watcher');
    const first = await post(restPort, { key: 'rk', value: 'rv1', tags: ['t'], ttl: 30 });
    await new Promise(r => setTimeout(r, 600));  // absence assertion: needs a settle window
    // Only the two memory frames count. An earlier draft asserted
    // `w.frames.length === 0` over the whole window, which went red for an
    // unrelated ping/pong in two consecutive matrix runs -- the arm could not
    // distinguish "no delivery" from "some other frame", so a SURVIVED verdict
    // from it would have been meaningless. (R475-8: a shape detector that
    // cannot tell a real cap from an unrelated event is not a detector.)
    const push = MEM_FRAMES(w.frames);
    expect(first.status).toBe(200);
    expect(first.headers['x-woclaw-duplicate']).toBeUndefined();
    expect(first.headers['x-woclaw-conflict']).toBeUndefined();
    expect(push.length).toBe(0);

    w.frames.length = 0;
    const second = await post(restPort, { key: 'rk', value: 'rv2', tags: ['t'], ttl: 30 });
    await new Promise(r => setTimeout(r, 600));
    // a real conflict, loudly signalled on the HTTP response ...
    expect(second.status).toBe(200);
    expect(second.headers['x-woclaw-conflict']).toBe('true');
    // ... and invisible on the only push channel the hub has
    expect(MEM_FRAMES(w.frames).length).toBe(0);
    // the row did change: this is silence, not a no-op
    expect((await db.getMemory('rk'))!.value).toBe('rv2');
  });
});
