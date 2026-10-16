/**
 * woclaw hub/src/ws_server.ts — the rate-limit ENTRY lifecycle, and the
 * user-facing retryAfter that the entry feeds.
 *
 * Queued by the llm-benchmark r470 transferable rule (23:03, 2026-10-16):
 *   "a test that asserts a user-facing NUMBER is a LOCK on that number,
 *    not coverage of the path that computes it."
 * llm-benchmark measured fetchWithTimeout's timeoutMs: zero production
 * callers, and the AbortError branch throws a literal '(300s)' that
 * timeoutMs does not appear in. Here the analogous shape is the WS rate
 * limiter, and the census below found the same defect class plus a second
 * one on the same object.
 *
 * The pre-existing rate_limit.test.ts covers NEITHER. Its header claims
 * coverage of "setRateLimitConfig(messages, windowMs)" but every test
 * re-implements the algorithm in a local `slidingWindow()` helper (L19-39)
 * and asserts against plain object literals (L96, L104) — it never
 * constructs a WSServer and never reaches a production method. Arm A
 * establishes that from the files rather than from the header's claim.
 *
 * ---------------------------------------------------------------------------
 * A. REACH CENSUS — what production actually calls
 * ---------------------------------------------------------------------------
 *   setRateLimitConfig()      ws_server.ts:677 — declared, ZERO call sites
 *                             anywhere in the repo outside its own
 *                             declaration. Not reachable from ws_server.ts,
 *                             rest_server.ts, index.ts, or any REST route.
 *                             So rateLimitConfig.messages / .windowMs can
 *                             ONLY ever hold the two DEFAULT_ constants.
 *   getRateLimitStatuses()    ws_server.ts:651 — ONE production caller,
 *                             rest_server.ts:669 handleRateLimits()
 *                             (GET /rate-limits).
 *
 * Consequence, and it is part of the finding: because the only mutator
 * has no production caller, `messages` is pinned at 100 and `windowMs` at
 * 60000 for the entire life of a hub. Both are still written as if they
 * were configuration, and arm B pins the constants as they are published
 * to operators.
 *
 * ---------------------------------------------------------------------------
 * F1 — the retryAfter number is emitted but the ENTRY outlives the socket
 * ---------------------------------------------------------------------------
 * checkRateLimit() (L623) keys its entry on agentId, and the entry is
 * never removed on disconnect: handleDisconnect() (L566-593) deletes from
 * `this.agents`, `this.agentByWs` and calls `this.memory.unsubscribe()`,
 * but NOT `this.rateLimits.delete(agentId)`. `this.rateLimits` is touched
 * in exactly three places — the declaration (L40), checkRateLimit's
 * get-or-create (L628/L631), and getRateLimitStatuses' iteration (L656).
 * There is no delete anywhere.
 *
 * So an agent that trips the limiter, disconnects, and reconnects with the
 * SAME agentId resumes with its old timestamps still inside the window and
 * is refused immediately, having sent zero messages on the new connection.
 * Every agent that ever connected also stays a permanent row, which is
 * what makes the leak observable through the one production reader
 * (GET /rate-limits) rather than latent.
 *
 * ---------------------------------------------------------------------------
 * F2 — the reported number is milliseconds, and nothing but a prose suffix
 *       says so
 * ---------------------------------------------------------------------------
 * The error text at L226 interpolates retryAfter, which checkRateLimit
 * returns as `(oldest + windowMs) - now` clamped at 0 — milliseconds. The
 * text reads `Retry after ${retryAfter}ms`, which is correct. The defect is
 * one layer over: OutboundMessage.retryAfter carries the same ms number on
 * the wire, and it is the field every client SDK reads to schedule its own
 * backoff. types.ts:106's sibling enum shows the wire protocol already
 * speaks in `timeout` / `rate_limited` outcomes, so the wire number is
 * load-bearing, and the ONLY thing making its unit unambiguous today is
 * the `ms` suffix in a prose message. Arms C and E pin both halves.
 *
 * F1 and F2 are one finding read from two sides, the shape R463 flagged:
 * the entry's LIFETIME and the number's UNIT are both carried only by
 * convention on a parameterised value, and neither is asserted anywhere.
 *
 * ---------------------------------------------------------------------------
 * M — the repairs, all father-gated, none applied here
 * ---------------------------------------------------------------------------
 *   F1: (a) delete the entry in handleDisconnect — resets on reconnect, but
 *          also defeats a flood-and-reconnect evasion;
 *          (b) key the entry on the SOCKET rather than agentId — a reconnect
 *          naturally starts empty, same evasion hole;
 *          (c) keep agentId keying and accept the carry-over deliberately.
 *       Which posture wins is a policy decision, not a bug fix.
 *   F2: (a) add an explicit unit / document the wire field;
 *          (b) rename to retryAfterMs at the protocol level (breaking);
 *          (c) leave it and pin the prose suffix as the contract.
 *
 * This suite PINS CURRENT BEHAVIOUR EXACTLY. Whichever repair is chosen
 * will turn these arms RED on purpose — the intended signal, not a
 * regression, and the same discipline r470 used.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import net from 'net';
import { WSServer } from '../src/ws_server.js';
import { ClawDB } from '../src/db.js';
import { Config, DEFAULT_RATE_LIMIT_MESSAGES, DEFAULT_RATE_LIMIT_WINDOW_MS } from '../src/types.js';

/** Reserve an ephemeral port, release it for the server to bind. The
 *  WSServer constructor calls listen(config.port) with no way to read the
 *  bound address back out, so the port is chosen up front. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

function mkTempDir(tag: string): string {
  return `/tmp/woclaw-r471-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const TOKEN = 'r471-token-abc';

function baseConfig(dir: string, port: number): Config {
  return {
    port,
    restPort: 0,
    host: '127.0.0.1',
    dataDir: dir,
    authToken: TOKEN,
    hubId: 'hub-r471',
  };
}

type Frame = { type: string; [k: string]: unknown };

/** A socket that is already open, frames visible immediately, with close
 *  exposed as its own promise. Splitting opened/closed matters because the
 *  hub stays up until close() — a helper that only resolved on close could
 *  never assert on frames that arrived BEFORE the shutdown. */
function openConn(url: string) {
  const frames: Frame[] = [];
  const client = new WebSocket(url);
  client.on('message', (data: Buffer) => {
    try {
      frames.push(JSON.parse(data.toString()) as Frame);
    } catch {
      /* non-JSON frame is not part of this contract */
    }
  });
  const opened = new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`open timeout: ${url}`)), 8000);
    client.once('open', () => { clearTimeout(t); resolve(); });
    client.once('error', (e: unknown) => { clearTimeout(t); reject(e); });
  });
  const closed = new Promise<{ code: number }>((resolve, reject) => {
    const t = setTimeout(() => { client.terminate(); reject(new Error(`close timeout: ${url}`)); }, 8000);
    client.once('close', (code: number) => { clearTimeout(t); resolve({ code }); });
  });
  return { client, frames, opened, closed };
}

/** Wait for n frames without racing the server's welcome send. */
async function awaitFrames(conn: { opened: Promise<void>; frames: Frame[] }, n: number): Promise<void> {
  await conn.opened;
  const deadline = Date.now() + 5000;
  while (conn.frames.length < n && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

function chat(content: string): string {
  return JSON.stringify({ type: 'message', topic: 't', content });
}

/** Every RATE_LIMIT_EXCEEDED error frame seen on a connection so far. */
function refusals(conn: { frames: Frame[] }): Frame[] {
  return conn.frames.filter((f) => f.type === 'error' && f.code === 'RATE_LIMIT_EXCEEDED');
}

/** Send n chat frames and give the server time to process them. */
async function sendChats(conn: { client: WebSocket }, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) conn.client.send(chat(`m${i}`));
  await new Promise((r) => setTimeout(r, 200));
}

describe('WSServer rate-limit entry lifecycle and the retryAfter it reports', () => {
  let db: ClawDB | undefined;
  let server: WSServer | undefined;
  const open: { client: WebSocket; frames: Frame[]; opened: Promise<void>; closed: Promise<{ code: number }> }[] = [];

  afterEach(async () => {
    for (const c of open) { try { c.client.terminate(); } catch { /* already gone */ } }
    open.length = 0;
    if (server) { try { server.close(); } catch { /* already closed */ } }
    server = undefined;
    if (db) await db.close();
    db = undefined;
  });

  /** Bring a hub up on a free port with a fresh DB. */
  async function hub(tag: string): Promise<{ s: WSServer; port: number; dir: string }> {
    const dir = mkTempDir(tag);
    const port = await freePort();
    const d = new ClawDB(dir);
    db = d;
    const s = new WSServer(baseConfig(dir, port), d);
    server = s;
    return { s, port, dir };
  }

  /** Connect an agent and wait for its welcome frame. */
  async function connect(port: number, agentId: string) {
    const conn = openConn(`ws://127.0.0.1:${port}/?agentId=${agentId}&token=${TOKEN}`);
    open.push(conn);
    await awaitFrames(conn, 1);
    expect(conn.frames[0].type).toBe('welcome');
    expect(conn.frames[0].agentId).toBe(agentId);
    return conn;
  }

  // ------------------------------------------------------ A. the mutator works

  it('(A) setRateLimitConfig DOES take effect, so its zero-caller status is a reach fact', async () => {
    const { s, port } = await hub('mutator');

    // This is the control for the whole census. The census claims
    // setRateLimitConfig has no production caller; that claim is only
    // meaningful if the method is not simply broken. Driving it on a live
    // server over a real socket and reading the changed numbers back
    // through the production reader proves the method works — so "no
    // caller" is a statement about the call graph, not about the method.
    s.setRateLimitConfig({ messages: 7, windowMs: 1234 });
    const conn = await connect(port, 'mutator-a');
    await sendChats(conn, 2);

    const row = s.getRateLimitStatuses().find((r) => r.agentId === 'mutator-a');
    expect(row).toBeDefined();
    expect(row!.limit).toBe(7);
    expect(row!.windowMs).toBe(1234);
    expect(row!.currentCount).toBe(2);

    // A partial update leaves the untouched field alone, the way the REST
    // surface would use it.
    s.setRateLimitConfig({ windowMs: 4321 });
    const row2 = s.getRateLimitStatuses().find((r) => r.agentId === 'mutator-a');
    expect(row2!.limit).toBe(7);
    expect(row2!.windowMs).toBe(4321);
  });

  // ------------------------------------------ B. the published limits are fixed

  it('(B) with no mutator called, the published limit and window are the DEFAULT_ constants', async () => {
    const { s, port } = await hub('consts');

    const conn = await connect(port, 'consts-a');
    await sendChats(conn, 2);

    const row = s.getRateLimitStatuses().find((r) => r.agentId === 'consts-a');
    expect(row).toBeDefined();
    // These are the numbers GET /rate-limits publishes to an operator, and
    // they are the module constants purely because nothing can change them.
    expect(row!.limit).toBe(DEFAULT_RATE_LIMIT_MESSAGES);
    expect(row!.windowMs).toBe(DEFAULT_RATE_LIMIT_WINDOW_MS);
    expect(row!.currentCount).toBe(2);
    expect(row!.oldestTimestamp).not.toBeNull();
  });

  // -------------------------------------------- C. F1: the entry outlives the socket

  it('(C) an agent that reconnects with the same id resumes with its old window still full', async () => {
    const { s, port } = await hub('carry');
    // limit 2: two messages fill the window, the third is refused.
    s.setRateLimitConfig({ messages: 2, windowMs: 60_000 });

    const first = await connect(port, 'carry-a');
    await sendChats(first, 3);

    const refused1 = refusals(first);
    expect(refused1.length).toBe(1);
    const firstErr = refused1[0];
    // F2 pinned at the same time: the emitted number is milliseconds and the
    // prose carries the unit. Both halves of the unit contract, in one arm.
    expect(typeof firstErr.retryAfter).toBe('number');
    expect(firstErr.retryAfter as number).toBeGreaterThan(0);
    expect(firstErr.retryAfter as number).toBeLessThanOrEqual(60_000);
    expect(String(firstErr.message)).toMatch(/^Rate limit exceeded\. Retry after \d+ms$/);

    // Disconnect. handleDisconnect drops the agent from the live fleet.
    first.client.close();
    await first.closed;
    expect(s.getAgentsInfo().map((a) => a.agentId)).not.toContain('carry-a');

    // The rate-limit row SURVIVES the disconnect with its window intact.
    // This is F1, asserted directly on the production reader.
    const stale = s.getRateLimitStatuses().find((r) => r.agentId === 'carry-a');
    expect(stale).toBeDefined();
    expect(stale!.currentCount).toBe(2);

    // Reconnect with the SAME agentId. This socket has sent nothing at all.
    const second = await connect(port, 'carry-a');
    await sendChats(second, 1);

    // And it is refused anyway, on the strength of the previous connection's
    // traffic. The refusal is the same SHAPE as the one the first socket got.
    // The number is deliberately NOT asserted equal to the first: retryAfter
    // is derived from Date.now(), so on a later socket it is strictly smaller
    // by the elapsed time. Pinning it equal would pin a transcription of one
    // run's wall clock, not the contract. The class is what matters — same
    // code, same prose shape, still a positive millisecond wait.
    const refused2 = refusals(second);
    expect(refused2.length).toBe(1);
    expect(refused2[0].code).toBe(firstErr.code);
    expect(String(refused2[0].message)).toMatch(/^Rate limit exceeded\. Retry after \d+ms$/);
    const firstWait = firstErr.retryAfter as number;
    const secondWait = refused2[0].retryAfter as number;
    expect(secondWait).toBeGreaterThan(0);
    // Non-increasing across time is the only relation two retries at
    // different instants can be expected to satisfy.
    expect(secondWait).toBeLessThanOrEqual(firstWait);
    // And it is still counting down toward the ORIGINAL window, not a fresh
    // one: a fresh entry would report the full window again.
    expect(secondWait).toBeLessThan(60_000);
  });

  // ---------------------------------- D. the leak is every agent, not just full ones

  it('(D) an agent far from the limit still leaves a permanent row behind it', async () => {
    const { s, port } = await hub('leak');

    const conn = await connect(port, 'leak-a');
    await sendChats(conn, 1);

    // While connected the row exists with the recorded message.
    expect(s.getRateLimitStatuses().find((r) => r.agentId === 'leak-a')!.currentCount).toBe(1);

    conn.client.close();
    await conn.closed;

    // After the disconnect the row is still there. Arm C shows that is a
    // defect when the window is full; here the count is far from the limit,
    // so it is benign in effect — but not harmless: every agent that ever
    // connected is a permanent row, and GET /rate-limits publishes all of
    // them, so the operator-visible list grows without bound.
    const rows = s.getRateLimitStatuses();
    expect(rows).toHaveLength(1);
    expect(rows[0].agentId).toBe('leak-a');
    expect(s.getAgentsInfo()).toHaveLength(0);
  });

  // --------------------------------- E. F2: the unit and the refusal shape

  it('(E) the refusal carries a millisecond number and a prose suffix that agrees with it', async () => {
    const { s, port } = await hub('unit');
    // limit 1: the first message is recorded, the second trips the check.
    s.setRateLimitConfig({ messages: 1, windowMs: 60_000 });

    const conn = await connect(port, 'unit-a');
    await sendChats(conn, 2);

    const refused = refusals(conn);
    expect(refused.length).toBe(1);
    const err = refused[0];
    expect(err.code).toBe('RATE_LIMIT_EXCEEDED');

    // The prose and the wire field must agree. Both are derived from the
    // same retryAfter, so this is a consistency check rather than a
    // transcription — but it is the check that makes the 'ms' suffix
    // load-bearing rather than decorative.
    const m = /^Rate limit exceeded\. Retry after (\d+)ms$/.exec(String(err.message));
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(err.retryAfter);

    // The wire number is bounded by the configured window: it is the time
    // until the OLDEST timestamp leaves, so it can never exceed windowMs
    // and can never be negative.
    expect(err.retryAfter as number).toBeGreaterThan(0);
    expect(err.retryAfter as number).toBeLessThanOrEqual(60_000);

    // And it is genuinely the default window's magnitude under the default
    // config — the "300s" coincidence from llm-benchmark's r470 has no
    // counterpart here, so the sanity bound is stated explicitly.
    expect(DEFAULT_RATE_LIMIT_WINDOW_MS).toBe(60_000);
  });

  // ------------------------------------ F. ping/pong never touches the limiter

  it('(F) ping and pong are exempt, so an idle keepalive cannot trip the limiter', async () => {
    const { s, port } = await hub('ping');
    s.setRateLimitConfig({ messages: 1, windowMs: 60_000 });

    const conn = await connect(port, 'ping-a');

    // Several pings and a pong, then one real message: the message is the
    // first thing recorded, so if pings counted it would already be refused.
    for (let i = 0; i < 5; i += 1) {
      conn.client.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      conn.client.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
    }
    await new Promise((r) => setTimeout(r, 150));
    conn.client.send(chat('real'));
    await new Promise((r) => setTimeout(r, 150));

    expect(refusals(conn)).toHaveLength(0);
    expect(s.getRateLimitStatuses().find((r) => r.agentId === 'ping-a')!.currentCount).toBe(1);
  });
});
