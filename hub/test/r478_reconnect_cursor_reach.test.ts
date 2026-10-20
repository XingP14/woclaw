/**
 * R478 — the reconnect cursor reaches the streams and stops there.
 *
 * The external probe (websocket.org reconnection guide, ESP agent docs,
 * pinax substreams cursors) converges on one pattern: a server assigns each
 * event a monotone position, the client remembers the last position it saw,
 * and on reconnect asks for everything after it. The parts are (a) a
 * durable store, (b) a forward cursor over it, (c) something in the
 * handshake that tells the client where it is.
 *
 * WoClaw has (a) for two different subjects, and (b) for exactly one of them.
 *
 *   streams  — `GET /streams/:topic/:runId?since_cursor=N` (`rest_server.ts:357`)
 *              slices `events.slice(sinceCursor)` and hands back
 *              `next_cursor`. A forward cursor exists and it is named.
 *   messages — `handleChatMessage` (`ws_server.ts:420`) calls
 *              `db.saveMessage(...)` for every chat message, so the rows are
 *              durable. But the only reader, `getMessages`
 *              (`db.ts:671`), has exactly two branches: no `before`, or
 *              `timestamp < ?`. Both order `timestamp DESC, id DESC`. There
 *              is no `after`/`since`/`>` branch and no forward cursor in the
 *              response, so the stored rows are addressable only backwards.
 *
 * The `welcome` frame (`ws_server.ts:189-194`) carries agentId, a timestamp
 * and the topic list — no cursor, no "you were last here at" marker. So a
 * reconnecting client has no way to learn its own position on either surface.
 *
 * This is R449-12's shape (a plane that cannot be *expressed*, not one that
 * is merely unenforced) applied to delivery rather than time, and it is NOT
 * R470 (same-id reconnect evicts its own replacement) and NOT R476
 * (delivery outcome is never recorded). Those are the registry and the
 * outcome; this is the position.
 *
 * Arms A–E assert CURRENT behaviour and are GREEN at HEAD, per this
 * directory's convention: a repair turns them RED on purpose, and that red is
 * the signal the gap was closed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { RestServer } from '../src/rest_server.js';
import { ClawDB } from '../src/db.js';
import { WSServer } from '../src/ws_server.js';
import { GraphStore } from '../src/graph/store.js';
import type { Config } from '../src/types.js';

const CFG: Config = {
  port: 0, restPort: 0, host: '127.0.0.1',
  dataDir: '/tmp/woclaw-r478-probe',
  storage: { type: 'sqlite', sqlitePath: '/tmp/woclaw-r478-probe/probe.db' },
  authToken: 'r478-probe-token',
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('R478: the reconnect cursor reaches the streams and stops there', () => {
  let db: ClawDB, rest: RestServer, ws: WSServer;
  let restPort: number;

  beforeAll(async () => {
    rmSync(CFG.dataDir!, { recursive: true, force: true });
    mkdirSync(CFG.dataDir!, { recursive: true });
    db = new ClawDB(CFG);
    ws = new WSServer(CFG, db);
    const mem = ws.getMemoryPool();
    mem.graphStore = new GraphStore();
    rest = new RestServer(CFG, db, ws.getTopicsManager(), mem, mem.graphStore, ws);
    await rest.start();
    restPort = await rest.whenListening();
  });

  afterAll(() => {
    try { rest.close(); } catch { /* already stopped */ }
    try { ws.close(); } catch { /* already stopped */ }
    rmSync(CFG.dataDir!, { recursive: true, force: true });
  });

  async function get(path: string): Promise<{ status: number; body: any }> {
    const res = await fetch(`http://127.0.0.1:${restPort}${path}`);
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { __unparsed: text.slice(0, 200) }; }
    return { status: res.status, body };
  }

  /** A chat message row is durable — no socket needed. */
  async function seedMessage(topic: string, content: string, ts: number) {
    await db.saveMessage({ id: `r478-${topic}-${ts}`, topic, from: 'seeder', content, timestamp: ts });
  }

  it('A the chat rows are durable: a message published while nobody is attached survives', async () => {
    // The premise of arms B-D. If this were false, the missing forward cursor
    // would be harmless — there would be nothing to resume.
    await seedMessage('r478-durable', 'published-while-away', 1_700_000_000_000);
    // NOTE the single-segment topic: `handleRequest` takes the topic name as
    // `path.slice(8)` — the WHOLE remainder, not the first segment. So
    // `/topics/x/messages` registers a topic literally named "x/messages".
    // Writing `/topics/r478-durable/messages` therefore reads a topic nobody
    // wrote to and returns [] — an easy way to fake a green here.
    const { body } = await get('/topics/r478-durable');
    expect(body.error, 'the topic route is /topics/:name').toBeUndefined();
    expect(body.messages.map((m: any) => m.content),
      'the row must be readable back — the store is durable')
      .toContain('published-while-away');
  });

  it('B the message reader is backward-only: its one cursor is an exclusive `<`', async () => {
    // Measure the actual shape of the two SQL branches rather than reading
    // them. `db.ts:671` has exactly two: no param, or `timestamp < ?`.
    await seedMessage('r478-cursor', 'older', 1_700_000_000_000);
    await seedMessage('r478-cursor', 'newer', 1_700_000_900_000);

    const desc = await db.getMessages('r478-cursor', 10);
    expect(desc.map(m => m.content), 'the default order is DESC — newest first')
      .toEqual(['newer', 'older']);

    // The only cursor the reader accepts moves strictly backwards, and it is
    // EXCLUSIVE: pointing it at the older row's own timestamp returns
    // nothing, not "everything after it". A forward question and this
    // backward question are not two readings of one parameter.
    const pointedAtOlder = await db.getMessages('r478-cursor', 10, 1_700_000_000_000);
    expect(pointedAtOlder.map(m => m.content),
      'the sole cursor is `timestamp < ?` — it cannot express "after", and its ' +
      'own boundary row is excluded, so a client cannot even round-trip a cursor')
      .toEqual([]);

    // Pointed between the two rows, the exclusive `<` happens to look
    // forward-shaped — until you notice the row it would resume FROM is the
    // one it drops.
    const between = await db.getMessages('r478-cursor', 10, 1_700_000_500_000);
    expect(between.map(m => m.content)).toEqual(['older']);
  });

  it('C the REST messages surface exposes no cursor at all, forward or backward', async () => {
    // Same question one layer up: `handleTopicMessages`
    // (`rest_server.ts:1334`) takes only `limit` — it never forwards the
    // `before` the db layer supports, so the backward page is unreachable
    // from HTTP too, and there is nothing forward on either surface.
    await seedMessage('r478-rest', 'm1', 1_700_000_000_000);
    await seedMessage('r478-rest', 'm2', 1_700_000_900_000);

    const baseline = await get('/topics/r478-rest');
    expect(baseline.body.messages.map((m: any) => m.content),
      'the handler reverses the DESC page, so the wire order is ASC')
      .toEqual(['m1', 'm2']);

    const ignored = await get('/topics/r478-rest?after=1&before=1&since=1');
    expect(JSON.stringify(ignored.body),
      'every cursor-shaped parameter is accepted and has no effect — none is a resume knob')
      .toEqual(JSON.stringify(baseline.body));
  });

  it('D the welcome frame carries no position marker', async () => {
    // Read the literal the hub sends a reconnecting client. It has a
    // timestamp (now), but nothing that says where the client left off.
    const src = await import('node:fs').then(fs =>
      fs.readFileSync(new URL('../src/ws_server.ts', import.meta.url), 'utf8'));
    const welcome = src.slice(src.indexOf("type: 'welcome'"));
    const frame = welcome.slice(0, welcome.indexOf('}'));
    expect(frame, 'the welcome frame must exist for this arm to mean anything')
      .toContain("type: 'welcome'");
    for (const marker of ['cursor', 'since', 'seq', 'lastSeq', 'last_read', 'lastMessageId']) {
      expect(frame.toLowerCase().includes(marker.toLowerCase()),
        `DEFECT: the welcome frame should carry a ${marker} for a client to resume from`)
        .toBe(false);
    }
  });

  it('E control: the stream surface DOES have a named forward cursor — the walker detects a plane that exists', async () => {
    // Without this arm, arms B-D are satisfied by a probe whose subject set
    // is simply absent, and "no cursor anywhere" reads identically to "no
    // cursor on messages". The stream surface has `since_cursor` AND a
    // `next_cursor` in its response, so the zero on the message side is a
    // real asymmetry and not a broken search.
    const { body } = await get('/streams/r478-control/no-such-run');
    expect(body, 'the control endpoint is real and answers')
      .toHaveProperty('error');

    const src = await import('node:fs').then(fs =>
      fs.readFileSync(new URL('../src/rest_server.ts', import.meta.url), 'utf8'));
    expect(src, 'control: a named forward cursor exists on the stream surface')
      .toContain('since_cursor');
    expect(src).toContain('next_cursor');
  });
});
