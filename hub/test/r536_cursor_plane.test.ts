/**
 * R536 — the CURSOR PLANE: `since_cursor` is a positional index into a
 * replaceable array, and the two transports do not agree on the stream's
 * topic string.
 *
 * ── THE PLANE ────────────────────────────────────────────────────────────────
 *
 * `docs/S92-AGENT-STREAM-PROTOCOL.md` §4.2 promises:
 *
 *   "### 4.2 Cursor-based stream fetch — replay without re-LLM"
 *   "Cursor is **monotonic per `run_id`** (1-indexed within the events array)."
 *   Response shape: `{ topic, run_id, since_cursor, events, next_cursor, exit }`
 *
 * That is the plane where a reconnecting consumer asks for "everything after
 * position N" and the hub answers without re-invoking the producer. This
 * suite measures what the shipped implementation actually does, over the
 * REAL RestServer + REAL WSServer + REAL ClawDB (SQLite), with real HTTP
 * and real WebSocket frames.
 *
 * ── WHAT IS MEASURED (nothing assumed; everything observed) ─────────────────
 *
 * F1  The topic string is produced by THREE different derivations and they
 *     disagree:
 *       POST /streams/<t>            -> stored topic = path.slice(8)  = "/<t>"
 *       GET  /streams/<t>   (list)   -> queried topic = path.slice(8) = "/<t>"
 *       GET  /streams/<t>/<run>      -> matched topic = regex group 1 = "<t>"
 *     So a stream published over REST is listed but can never be fetched,
 *     and a stream published over WS is fetchable but never listed.
 *
 * F2  The cursor is a POSITION IN AN ARRAY, not an event identity. The
 *     journal is one `events_json` blob per `run_id`, written with
 *     INSERT OR REPLACE. A second publish under the same `run_id` REPLACES
 *     the array. A cursor captured before the replacement then indexes a
 *     DIFFERENT array.
 *
 * F3  The replacement is not required to be a prefix-extension. A producer
 *     that re-publishes a SHORTENED or otherwise different event list under
 *     the same `run_id` silently destroys the earlier events, and a cursor
 *     held by a consumer now points at an event that never existed.
 *
 * F4  The cursor is not validated. `parseIntParam` yields NaN for a
 *     non-numeric parameter and a negative cursor is passed straight to
 *     `Array.prototype.slice`, which counts from the END. Both are accepted
 *     with HTTP 200.
 *
 * F5  `next_cursor` is not the position of the next unread event. It is
 *     `since_cursor + events.length`, which for a cursor beyond the end
 *     echoes the request back unchanged — so a consumer polling with it can
 *     never detect that it has fallen off the end.
 *
 * F6  The response omits `since_cursor`, which the §4.2 response shape
 *     documents. A consumer therefore cannot confirm from the reply that the
 *     server interpreted the position it asked for.
 *
 * F7  The §4.2 URL shape is `GET /v1/topics/{topic}/runs/{run_id}`, and the
 *     spec's own example topic contains a slash ("agent/x/run-y"). The
 *     shipped route splits on the LAST slash, so a slash-bearing topic is
 *     only addressable when URL-encoded.
 *
 * ── WHAT THIS SUITE IS NOT ───────────────────────────────────────────────────
 *
 * It does NOT claim that positional cursors are wrong. Kafka offsets and
 * Redis stream IDs are both positions, and positions are fine as long as
 * the log behind them is append-only. The claim is narrower and is about
 * the CONTRACT: this journal is replaceable, the cursor's meaning is not
 * stable across a replacement, and nothing tells the consumer that the
 * thing it was counting into has been swapped out from under it.
 *
 * The arms assert the OBSERVED behaviour, so a repair turns them RED on
 * purpose — that red is the signal the gap was closed.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { WebSocket } from 'ws';
import { RestServer } from '../src/rest_server.js';
import { ClawDB } from '../src/db.js';
import { WSServer } from '../src/ws_server.js';
import { GraphStore } from '../src/graph/store.js';
import type { Config } from '../src/types.js';

const CFG: Config = {
  port: 0, restPort: 0, host: '127.0.0.1',
  dataDir: '/tmp/woclaw-r536-suite',
  storage: { type: 'sqlite', sqlitePath: '/tmp/woclaw-r536-suite/probe.db' },
  authToken: 'r536-suite-token',
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let H: { 'Content-Type': string; Authorization: string };

const ev = (event: string, ts: number, extra: Record<string, unknown> = {}) =>
  ({ event, ts, role: 'single', ...extra });

/** A §3.1-conformant envelope: start first, result last. */
function envelope(runId: string, events: any[], withResult = true) {
  const all: any[] = [ev('start', 1737000000000, { schema_version: '1.0' }), ...events];
  if (withResult) all.push(ev('result', 1737000009999, { exit: 'ok' }));
  return { schema_version: '1.0', run_id: runId, started_at: 1737000000000, events: all };
}

describe('R536: the cursor plane — a position in a replaceable array', () => {
  let db: ClawDB, rest: RestServer, ws: WSServer;
  let restPort: number, wsPort: number;
  let sock: WebSocket;

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
    restPort = await rest.whenListening();
    wsPort = await ws.whenListening();
    H = { 'Content-Type': 'application/json', Authorization: `Bearer ${CFG.authToken}` };
    sock = new WebSocket(`ws://127.0.0.1:${wsPort}?agentId=r536-agent&token=${CFG.authToken}`);
    await new Promise((res, rej) => { sock.once('open', res); sock.once('error', rej); });
  });

  // --- helpers -------------------------------------------------------
  const wsPublish = async (topic: string, runId: string, events: any[], withResult = true) => {
    const ack = new Promise<any>(res => sock.once('message', m => res(JSON.parse(m.toString()))));
    sock.send(JSON.stringify({ type: 'publish-stream', topic, stream: envelope(runId, events, withResult) }));
    const a = await ack;
    await sleep(220);
    return a;
  };
  const restPublish = async (topicSeg: string, runId: string, events: any[], withResult = true) => {
    const res = await fetch(`http://127.0.0.1:${restPort}/streams/${topicSeg}`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ stream: envelope(runId, events, withResult) }),
    });
    return { status: res.status, body: await res.json() };
  };
  const get = async (pathAndQs: string) => {
    const res = await fetch(`http://127.0.0.1:${restPort}/streams/${pathAndQs}`, { headers: H });
    const t = await res.text();
    let b: any; try { b = JSON.parse(t); } catch { b = t; }
    return { status: res.status, body: b as any };
  };
  const list = async (topicSeg: string) => {
    const res = await fetch(`http://127.0.0.1:${restPort}/streams/${topicSeg}`, { headers: H });
    const t = await res.text();
    let b: any; try { b = JSON.parse(t); } catch { b = t; }
    return { status: res.status, body: b as any };
  };

  // =====================================================================
  // F1 — the topic string has three derivations and they disagree
  // =====================================================================

  it('F1a: a REST-published stream is stored under "/<topic>" — the leading slash is part of the identity', async () => {
    const post = await restPublish('r536-rest', 'run-REST', [ev('assistant_text', 1737000001000, { text: 'A' })]);
    expect(post.status).toBe(201);

    const row = await db.getStream('run-REST');
    expect(row).toBeDefined();
    // The stored topic literally carries the leading slash that `path.slice(8)`
    // leaves behind. It is not a display artefact — it is the row's identity.
    expect(row!.topic).toBe('/r536-rest');
  });

  it('F1b: the LIST endpoint agrees with the POST (both use path.slice(8)) — so the REST stream IS listed', async () => {
    const l = await list('r536-rest');
    expect(l.status).toBe(200);
    expect(l.body.count).toBe(1);
    expect(l.body.runs.map((r: any) => r.runId)).toContain('run-REST');
    // The list echoes the topic it queried, slash included.
    expect(l.body.topic).toBe('/r536-rest');
  });

  it('F1c: but the SINGLE-stream endpoint 404s it — the two routes derive the topic differently', async () => {
    const g = await get('r536-rest/run-REST?since_cursor=0');
    // The regex `^\/streams\/([^/]+)\/(.+)$` captures "r536-rest" (no slash),
    // while the row's topic is "/r536-rest". `record.topic !== topic` -> 404.
    expect(g.status).toBe(404);
    expect(g.body.error).toBe('Stream not found');
  });

  it('F1d: the mirror image — a WS-published stream is fetchable but NOT listed', async () => {
    await wsPublish('r536-ws', 'run-WS', [ev('assistant_text', 1737000001000, { text: 'A' })]);

    const row = await db.getStream('run-WS');
    // WS takes the topic from the MESSAGE, so it has no leading slash.
    expect(row!.topic).toBe('r536-ws');

    const g = await get('r536-ws/run-WS?since_cursor=0');
    expect(g.status).toBe(200);
    expect(g.body.events.length).toBe(3);

    // The list endpoint, however, queries path.slice(8) = "/r536-ws" and
    // finds nothing: the WS stream exists in the journal but is invisible
    // to the listing surface.
    const l = await list('r536-ws');
    expect(l.status).toBe(200);
    expect(l.body.count).toBe(0);
  });

  it('F1e: neither route can see the other transport\'s stream through its own listing', async () => {
    // The two published streams live in the SAME table with DIFFERENT topic
    // spellings for what a caller would call the same topic name.
    const wsRow = await db.getStream('run-WS');
    const restRow = await db.getStream('run-REST');
    expect(wsRow!.topic).not.toBe(restRow!.topic);
    // "r536-ws" vs "/r536-rest" — a one-character difference that decides
    // whether the fetch route can see the row at all.
    expect(wsRow!.topic.startsWith('/')).toBe(false);
    expect(restRow!.topic.startsWith('/')).toBe(true);
  });

  // =====================================================================
  // F2 — the cursor is a position in a replaceable array
  // =====================================================================

  it('F2a: a second publish under the same run_id REPLACES the journal row, it does not extend it', async () => {
    await wsPublish('r536-inc', 'run-INC', [ev('assistant_text', 1737000001000, { text: 'A' })]);
    const first = await get('r536-inc/run-INC?since_cursor=0');
    expect(first.body.events.map((e: any) => e.text)).toEqual([undefined, 'A', undefined]);
    const cursorAfterFirst = first.body.next_cursor;

    // Publish again, same run_id, different content.
    await wsPublish('r536-inc', 'run-INC', [
      ev('assistant_text', 1737000002000, { text: 'B' }),
    ]);
    const second = await get('r536-inc/run-INC?since_cursor=0');
    // The array is 3 long again — but it is a DIFFERENT array.
    expect(second.body.events.length).toBe(3);
    expect(second.body.events.map((e: any) => e.text)).toEqual([undefined, 'B', undefined]);
    // The cursor the consumer held now points into the replaced array.
    expect(cursorAfterFirst).toBe(3);
    expect(second.body.next_cursor).toBe(3);
  });

  it('F2b: a cursor captured before the replacement resolves to a DIFFERENT event set after it', async () => {
    await wsPublish('r536-sw', 'run-SW', [
      ev('assistant_text', 1737000001000, { text: 'FIRST' }),
      ev('tool_call', 1737000002000, { name: 'x' }),
    ]);
    // Ask for the tail FROM A FIXED POSITION, before and after the swap.
    const POS = 1;
    const before = await get(`r536-sw/run-SW?since_cursor=${POS}`);
    const beforeTexts = before.body.events.map((e: any) => e.text ?? e.name ?? e.event);
    expect(beforeTexts.length).toBeGreaterThan(0);

    // The producer re-publishes the SAME run_id with a completely different
    // event list. Nothing rejects it; there is no monotonicity check.
    await wsPublish('r536-sw', 'run-SW', [
      ev('assistant_text', 1737000009000, { text: 'TOTALLY-DIFFERENT' }),
    ]);
    const after = await get(`r536-sw/run-SW?since_cursor=${POS}`);
    const afterTexts = after.body.events.map((e: any) => e.text ?? e.name ?? e.event);

    // The consumer asks "what happened after position N?" and gets a
    // DIFFERENT answer than it would have before the replacement — with no
    // signal that anything was replaced.
    expect(afterTexts).not.toEqual(beforeTexts);
    // The event the consumer had NOT yet seen ('FIRST') is now gone, and
    // the reply contains no gap marker, no tombstone, no error.
    expect(afterTexts.join('|')).not.toContain('FIRST');
    expect(beforeTexts.join('|')).toContain('FIRST');
    // The reply is a clean HTTP 200 with a well-formed events array.
    expect(after.status).toBe(200);
    expect(Array.isArray(after.body.events)).toBe(true);
  });

  it('F2c: the journal row holds ONE blob per run_id — there is no per-event row to address', async () => {
    const row = await db.getStream('run-SW');
    const events = JSON.parse(row!.eventsJson);
    // The events live inside a single JSON column. A cursor cannot be a
    // primary key over them because they are not rows.
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBe(3);
    // Every event in the blob is the LATEST publish's content.
    expect(events.map((e: any) => e.text ?? e.event)).toEqual([
      'start', 'TOTALLY-DIFFERENT', 'result',
    ]);
  });

  // =====================================================================
  // F3 — the replacement need not extend the prefix
  // =====================================================================

  it('F3: a SHORTENING replacement under the same run_id silently loses the earlier events', async () => {
    await wsPublish('r536-short', 'run-SHORT', [
      ev('assistant_text', 1737000001000, { text: 'A' }),
      ev('assistant_text', 1737000002000, { text: 'B' }),
    ]);
    const before = await get('r536-short/run-SHORT?since_cursor=0');
    expect(before.body.events.length).toBe(4);

    // Re-publish with FEWER events under the same run_id.
    await wsPublish('r536-short', 'run-SHORT', [
      ev('assistant_text', 1737000003000, { text: 'C' }),
    ], false); // no result event -> also proves partial envelopes are accepted
    const after = await get('r536-short/run-SHORT?since_cursor=0');
    expect(after.body.events.length).toBe(2);
    // The events that existed are GONE — there is no tombstone, no gap
    // marker, no error. The consumer simply sees a shorter stream.
    expect(after.body.events.map((e: any) => e.text)).toEqual([undefined, 'C']);
  });

  // =====================================================================
  // F4 — the cursor is not validated
  // =====================================================================

  it('F4a: a non-numeric cursor is accepted with HTTP 200 and yields the FULL stream', async () => {
    await wsPublish('r536-c', 'run-C', [ev('assistant_text', 1737000001000, { text: 'A' })]);
    const g = await get('r536-c/run-C?since_cursor=abc');
    // parseInt('abc') -> NaN. `events.slice(NaN)` -> the whole array.
    expect(g.status).toBe(200);
    expect(g.body.events.length).toBe(3);
    // And next_cursor is null, because NaN + 3 is NaN, and JSON.stringify
    // turns NaN into null.
    expect(g.body.next_cursor).toBe(null);
  });

  it('F4b: a NaN next_cursor fed back as a cursor parameter does not advance — the client can loop forever', async () => {
    const g1 = await get('r536-c/run-C?since_cursor=abc');
    const fed = g1.body.next_cursor; // null
    const g2 = await get(`r536-c/run-C?since_cursor=${fed}`); // since_cursor=null
    // parseInt('null') -> NaN -> full stream again, next_cursor null again.
    expect(g2.status).toBe(200);
    expect(g2.body.events.length).toBe(3);
    expect(g2.body.next_cursor).toBe(null);
    // A polling client that trusts next_cursor as its position never moves.
    expect(g2.body.next_cursor).toBe(g1.body.next_cursor);
  });

  it('F4c: a NEGATIVE cursor is counted from the END of the array, not rejected', async () => {
    await wsPublish('r536-neg', 'run-NEG', [
      ev('assistant_text', 1737000001000, { text: 'A' }),
      ev('assistant_text', 1737000002000, { text: 'B' }),
    ]);
    const g = await get('r536-neg/run-NEG?since_cursor=-2');
    // events.slice(-2) -> the LAST TWO events. A cursor is a forward
    // position; a negative one walks backwards with no complaint.
    expect(g.status).toBe(200);
    expect(g.body.events.length).toBe(2);
    expect(g.body.events.map((e: any) => e.text)).toEqual(['B', undefined]);
    // next_cursor = -2 + 2 = 0 — the cursor "moves" to the beginning.
    expect(g.body.next_cursor).toBe(0);
  });

  // =====================================================================
  // F5 — next_cursor is not the position of the next unread event
  // =====================================================================

  it('F5a: a cursor beyond the end returns an empty page and echoes the request back as next_cursor', async () => {
    await wsPublish('r536-f', 'run-F', [ev('assistant_text', 1737000001000, { text: 'A' })]);
    const g = await get('r536-f/run-F?since_cursor=9999');
    expect(g.status).toBe(200);
    expect(g.body.events.length).toBe(0);
    // next_cursor = 9999 + 0 = 9999. The client cannot distinguish
    // "caught up" from "past the end" from "wrong run".
    expect(g.body.next_cursor).toBe(9999);
  });

  it('F5b: a caught-up client polls with the same cursor forever and gets the same empty page', async () => {
    const g1 = await get('r536-f/run-F?since_cursor=3');
    expect(g1.body.events.length).toBe(0);
    expect(g1.body.next_cursor).toBe(3);
    const g2 = await get('r536-f/run-F?since_cursor=3');
    // Identical reply. There is no "end of stream" marker, no exit-driven
    // signal in the cursor, and no `done` flag.
    expect(g2.body.events.length).toBe(0);
    expect(g2.body.next_cursor).toBe(3);
    expect(JSON.stringify(g2.body.events)).toBe(JSON.stringify(g1.body.events));
  });

  // =====================================================================
  // F6 — the response omits the documented since_cursor
  // =====================================================================

  it('F6: the reply omits since_cursor, so the consumer cannot confirm the position the server used', async () => {
    await wsPublish('r536-s', 'run-S', [ev('assistant_text', 1737000001000, { text: 'A' })]);
    const g = await get('r536-s/run-S?since_cursor=2');
    expect(g.status).toBe(200);
    // The §4.2 response shape documents { topic, run_id, since_cursor,
    // events, next_cursor, exit }. The shipped reply has no since_cursor.
    expect(Object.keys(g.body)).toContain('next_cursor');
    expect(Object.keys(g.body)).not.toContain('since_cursor');
    // The consumer asked for position 2 and got 1 event back — it cannot
    // tell whether the server honoured 2 or coerced it.
    expect(g.body.events.length).toBe(1);
  });

  // =====================================================================
  // F7 — the documented URL shape and slash-bearing topics
  // =====================================================================

  it('F7a: the §4.2 URL shape /streams/<topic>/<run_id> does NOT resolve a slash-bearing topic', async () => {
    // The spec's OWN example topic contains a slash.
    await wsPublish('agent/x/run-y', 'run-1', [ev('assistant_text', 1737000001000, { text: 'X' })]);

    // Following §4.2 literally: the topic is the segment before the last
    // slash, so "agent/x/run-y" + "run-1" becomes /streams/agent/x/run-y/run-1
    // and the regex captures topic="agent/x" — a different topic.
    const g = await get('agent/x/run-y/run-1?since_cursor=0');
    expect(g.status).toBe(404);
  });

  it('F7b: the same stream IS reachable when the topic is URL-encoded', async () => {
    const g = await get(`${encodeURIComponent('agent/x/run-y')}/run-1?since_cursor=0`);
    expect(g.status).toBe(200);
    expect(g.body.topic).toBe('agent/x/run-y');
    expect(g.body.events.length).toBe(3);
  });

  it('F7c: a double-slash path does not 404 — it silently returns the LIST shape for a non-existent topic', async () => {
    const g = await get('/r536-s/run-S?since_cursor=0');
    expect(g.status).toBe(200);
    // The regex needs /streams/<one-segment>/<rest>; with a leading double
    // slash the single-stream branch does not match, so the request falls
    // through to the LIST branch and answers with a different SHAPE.
    expect(g.body).toHaveProperty('runs');
    expect(g.body).not.toHaveProperty('events');
  });

  // =====================================================================
  // CONTROL — the plane exists and the probe is not blind
  // =====================================================================

  it('CONTROL: a forward cursor is named and works on the happy path', async () => {
    await wsPublish('r536-ctl', 'run-CTL', [
      ev('assistant_text', 1737000001000, { text: 'A' }),
      ev('assistant_text', 1737000002000, { text: 'B' }),
    ]);
    const full = await get('r536-ctl/run-CTL?since_cursor=0');
    expect(full.status).toBe(200);
    expect(full.body.events.length).toBe(4);
    expect(full.body.next_cursor).toBe(4);

    // Paging works: position 2 gives the tail.
    const tail = await get('r536-ctl/run-CTL?since_cursor=2');
    expect(tail.body.events.length).toBe(2);
    expect(tail.body.next_cursor).toBe(4);

    // So the cursor is not broken. It is a position into a REPLACEABLE
    // array, and the contract does not say so.
    const src = await import('node:fs').then(fs =>
      fs.readFileSync(new URL('../src/rest_server.ts', import.meta.url), 'utf8'));
    expect(src).toContain('since_cursor');
    expect(src).toContain('next_cursor');
  });
});
