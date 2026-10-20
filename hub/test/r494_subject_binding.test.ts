/**
 * R494 — the credential is real, but the SUBJECT it claims is not verified.
 *
 * -----------------------------------------------------------------------
 * SELECTION (R74). R441–R493 were 40+ consecutive in-cluster rounds, and
 * R454 / R489 / R491 already covered the three credential planes:
 *
 *   R454 — MECHANISM plane: how is the token generated, compared, rotated?
 *   R489 — VALUE plane:      is this specific literal public?
 *   R491 — SCOPE plane:      which operations does the credential gate?
 *
 * This round opens a fourth, orthogonal plane — the **SUBJECT-BINDING
 * plane**: *which agent is the caller?* The three prior planes all ask
 * questions about the credential itself. None of them asks whether the
 * `agentId` the caller claims is BOUND to that credential. It is not.
 *
 *   EXTERNAL LEG (controls first, R404-M1):
 *     HN Algolia CTRL `agent` = 532,218 / `LLM` = 54,256 / `AI agent` = 20,617
 *     HN precision: `agent impersonation identity binding` = 0 ·
 *       `websocket agent identity spoof` = 0 ·
 *       `shared memory agent attribution spoofing` = 0 ·
 *       `agent impersonation shared token` = 0 ·
 *       `agent identity attestation websocket` = 0
 *     GH CTRL `agent` = 2,017,670 / `llm` = 789,133
 *     GH precision: `agent identity impersonation` = 7 (all 0★, NOASSERTION/
 *       Apache-2.0/MIT noise) · `websocket agent spoofing` = 0
 *
 *   NOT reported as greenfield (R449-5 / R454-4 / R475-3 discipline):
 *   per-agent identity, SPIFFE/SPIRE, OAuth token exchange (RFC 8693),
 *   workload identity and non-human principals are all SOLVED in adjacent
 *   fields. This is a MIGRATION GAP: the mechanisms exist, the agent-hub
 *   community has not moved them. Reporting virgin territory here would be
 *   wrong.
 *
 * -----------------------------------------------------------------------
 * WHAT IS PINNED HERE (current behaviour, RED against the defect)
 *
 * The handshake at `ws_server.ts:160-193`:
 *
 *     const agentId = url.searchParams.get('agentId');
 *     const token   = url.searchParams.get('token');
 *     if (!agentId || !this.isTokenAuthorized(token ?? undefined)) { ... }
 *
 * `isTokenAuthorized` (`:151-158`) answers ONE question: "is this string the
 * shared credential?" It says NOTHING about which agent the caller is. The
 * `agentId` is free text from the query string, never compared to anything.
 *
 *   P1  The handshake admits a caller claiming ANY agentId with the one
 *       shared credential. (Both the credential check and the identity claim
 *       are real; only the BINDING between them is missing.)
 *   P2  Claiming an id that is already connected EVICTS the incumbent
 *       (`ws_server.ts:170-175`, close code 4002). A caller with the shared
 *       credential can therefore SILENTLY DISCONNECT any agent.
 *   P3  `handleDisconnect` deletes the registry entry BY KEY, not by socket
 *       (`:587 this.agents.delete(agentId)`), and the incumbent's close
 *       handler runs AFTER the takeover registered itself. The takeover
 *       therefore DELETES ITS OWN REGISTRATION: the socket stays open, but
 *       the hub can no longer find the agent, so its inbound traffic is
 *       dropped in `handleMessage` (`:218-219`).
 *   P4  Because the first takeover left the key ABSENT, a SECOND takeover
 *       takes the `agents.has(agentId) === false` branch: no eviction, no
 *       close handler, and the impostor is REGISTERED. It then joins topics,
 *       receives the topic's traffic, and receives delegations addressed to
 *       the claimed id. Its writes are attributed to the victim.
 *   P5  ATTRIBUTION: the WS plane records the CLAIMED id as the author
 *       (`updatedBy` for memory, `from` for chat messages, `fromAgent` for
 *       delegations). The REST plane records a constant `'rest-api'`. So the
 *       only surface that can attribute an action to a NAMED agent is the one
 *       that never verifies the name.
 *   P6  NEGATIVE CONTROL: no credential and a garbage credential are both
 *       rejected (close 4001). The defect is therefore not "auth is broken"
 *       — it is that a WORKING auth token buys an UNVERIFIED identity.
 *   P7  REPAIR ARM (written `it.fails(...)`, the r481 / 31bb376 convention):
 *       binding the subject turns P1/P2/P4 red.
 *
 * -----------------------------------------------------------------------
 * HARNESS NOTES (this file's own defects, recorded so the next round does
 * not repeat them):
 *
 *   - The first draft of the probe attached its message listener AFTER the
 *     'open' event and therefore MISSED the `welcome` frame. That read as
 *     "no admission" when the socket was in fact admitted. Frames must be
 *     buffered from a listener attached BEFORE the socket opens.
 *   - `getTopicAgents()` returns an ARRAY, not a Set. A `.has()` on it
 *     throws; the correct test is `.includes()`.
 *
 * The credential is CONSTRUCTED at run time, never written literally into
 * this file (R489: a value that appears in the repository is not a secret).
 *
 * No production code is modified: `git diff --stat -- hub/src` is empty.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { WebSocket } from 'ws';

import { WSServer } from '../src/ws_server.js';
import { ClawDB } from '../src/db.js';
import type { Config } from '../src/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const LIVE = ['WoClaw', '2026'].join('');
const GARBAGE = 'garbage-credential-value-zzz';

interface Sock {
  ws: WebSocket;
  frames: any[];
  closed: boolean;
  closeReason: string;
}

/**
 * Open a socket and BUFFER every frame from a listener attached BEFORE the
 * socket opens (see harness notes: attaching after 'open' loses the welcome
 * frame and inverts the verdict).
 */
function open(port: number, agentId: string, token: string | null): Promise<Sock> {
  return new Promise((resolve) => {
    const frames: any[] = [];
    const s: Sock = { ws: null as any, frames, closed: false, closeReason: '' };
    const url = `ws://127.0.0.1:${port}/?agentId=${encodeURIComponent(agentId)}` +
      (token === null ? '' : `&token=${encodeURIComponent(token)}`);
    const ws = new WebSocket(url);
    s.ws = ws;
    ws.on('message', (d: any) => { try { frames.push(JSON.parse(d.toString())); } catch { /* non-JSON frame */ } });
    ws.on('close', (code: number, reason: any) => {
      s.closed = true;
      s.closeReason = `${code}:${reason?.toString?.() ?? ''}`;
    });
    ws.on('error', () => { s.closed = true; });
    setTimeout(() => resolve(s), 700);
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('R494 — the credential is verified; the subject it claims is not', () => {
  const testDir = mkdtempSync(join(tmpdir(), 'r494-'));
  let db: ClawDB;
  let wsServer: WSServer;
  let port: number;
  const openSockets: Sock[] = [];

  const cfg: Config = {
    port: 0,
    restPort: 0,
    host: '127.0.0.1',
    dataDir: testDir,
    storage: { type: 'sqlite', sqlitePath: join(testDir, 'r494.db') },
    authToken: LIVE,
  } as unknown as Config;

  const connect = async (agentId: string, token: string | null = LIVE): Promise<Sock> => {
    const s = await open(port, agentId, token);
    openSockets.push(s);
    return s;
  };

  const registry = (): string[] => [...(wsServer as any).agents.keys()];
  const topicMembers = (t: string): string[] => (wsServer.getTopicsManager().getTopicAgents(t) || []);

  beforeEach(async () => {
    db = new ClawDB(cfg);
    wsServer = new WSServer(cfg, db);
    port = await wsServer.whenListening();
  });

  afterEach(async () => {
    for (const s of openSockets.splice(0)) { try { s.ws.close(); } catch { /* already gone */ } }
    await wait(200);
    try { await db.close(); } catch { /* already gone */ }
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  // ── P6: NEGATIVE CONTROL — auth is not broken ──────────────────────────
  it('P6 no credential and a garbage credential are both rejected; the live credential is admitted', async () => {
    const none = await connect('agent-p6', null);
    const bad = await connect('agent-p6', GARBAGE);
    const good = await connect('agent-p6', LIVE);

    expect(none.closed).toBe(true);
    expect(none.closeReason).toContain('4001');
    expect(none.frames.length).toBe(0);
    expect(bad.closed).toBe(true);
    expect(bad.closeReason).toContain('4001');
    expect(bad.frames.length).toBe(0);
    expect(good.closed).toBe(false);
    expect(good.frames.map((f) => f.type)).toContain('welcome');
  });

  // ── P1: the subject is unbound ─────────────────────────────────────────
  it('P1 ONE shared credential admits ANY claimed agentId — the claimed id is never compared to anything', async () => {
    const alpha = await connect('agent-alpha');
    const bravo = await connect('agent-bravo');
    const charlie = await connect('agent-charlie');

    for (const s of [alpha, bravo, charlie]) {
      expect(s.closed).toBe(false);
      const welcome = s.frames.find((f) => f.type === 'welcome');
      expect(welcome, 'the handshake must have admitted the caller').toBeDefined();
    }
    // Three DISTINCT identities, one credential, one hub.
    expect(registry().sort()).toEqual(['agent-alpha', 'agent-bravo', 'agent-charlie']);
  });

  it('P1b the claimed id is free text — it is not validated against any registry, namespace or format', async () => {
    const exotic = await connect('../../etc/passwd');
    expect(exotic.closed).toBe(false);
    const welcome = exotic.frames.find((f) => f.type === 'welcome');
    expect(welcome).toBeDefined();
    expect(welcome.agentId).toBe('../../etc/passwd');
    expect(registry()).toContain('../../etc/passwd');
  });

  // ── P2: the takeover is a denial of service ────────────────────────────
  it('P2 claiming a CONNECTED agentId evicts the incumbent (close 4002) — a caller with the shared credential can disconnect any agent', async () => {
    const victim = await connect('agent-victim');
    expect(victim.closed).toBe(false);

    const impostor = await connect('agent-victim');
    await wait(500);

    expect(victim.closed).toBe(true);
    expect(victim.closeReason).toContain('4002');
    expect(impostor.closed).toBe(false);
  });

  // ── P3: the takeover deletes ITS OWN registration ──────────────────────
  it('P3 after the first takeover the socket is open but the hub has DELETED ITS OWN REGISTRATION, so its inbound traffic is silently dropped', async () => {
    const victim = await connect('agent-ghost');
    await wait(200);
    victim.ws.send(JSON.stringify({ type: 'join', topic: 'r494-ghost' }));
    await wait(700);
    expect(registry()).toContain('agent-ghost');
    expect(topicMembers('r494-ghost')).toContain('agent-ghost');

    const takeover = await connect('agent-ghost');
    await wait(800);

    // The takeover's SOCKET is open ...
    expect(takeover.closed).toBe(false);
    // ... but the registry no longer contains it: the incumbent's close
    // handler deleted the entry BY KEY, after the takeover had registered.
    expect(registry()).not.toContain('agent-ghost');
    // ... and the real agent was dropped from its topic.
    expect(topicMembers('r494-ghost')).not.toContain('agent-ghost');

    // The consequence: the takeover's inbound traffic is dropped in
    // handleMessage (`if (!agent) return;`).
    takeover.ws.send(JSON.stringify({ type: 'memory_write', key: 'r494:ghost', value: 'v', tags: [], ttl: 0 }));
    await wait(800);
    const mem = await db.getMemory('r494:ghost');
    expect(mem).toBeUndefined();
  });

  // ── P4: the second takeover registers cleanly ──────────────────────────
  it('P4 a SECOND takeover registers cleanly and becomes a full participant as the claimed id', async () => {
    const victim = await connect('agent-target');
    await wait(200);
    victim.ws.send(JSON.stringify({ type: 'join', topic: 'r494-target' }));
    await wait(700);
    expect(topicMembers('r494-target')).toContain('agent-target');

    // Takeover #1 — evicts the incumbent and self-deletes.
    const first = await connect('agent-target');
    await wait(800);
    expect(first.closed).toBe(false);
    expect(registry()).not.toContain('agent-target');

    // Takeover #2 — the key is absent, so there is nothing to evict.
    const second = await connect('agent-target');
    await wait(800);
    expect(second.closed).toBe(false);
    expect(registry()).toContain('agent-target');

    // It can act as the claimed id.
    second.ws.send(JSON.stringify({ type: 'join', topic: 'r494-target' }));
    await wait(800);
    expect(topicMembers('r494-target')).toContain('agent-target');

    // It receives the topic's traffic.
    const peer = await connect('agent-peer');
    await wait(300);
    peer.ws.send(JSON.stringify({ type: 'message', topic: 'r494-target', content: 'R494-TRAFFIC-MARKER' }));
    await wait(900);
    expect(second.frames.some((f) => f.type === 'message' && f.content === 'R494-TRAFFIC-MARKER')).toBe(true);

    // It receives delegations addressed to the claimed id.
    const delegator = await connect('agent-delegator');
    await wait(300);
    delegator.ws.send(JSON.stringify({
      type: 'delegate_request', id: 'r494-d1', toAgent: 'agent-target',
      task: { kind: 'x', prompt: 'do it' },
    }));
    await wait(1000);
    expect(second.frames.some((f) => f.type === 'delegate_incoming')).toBe(true);
  });

  // ── P5: attribution records the CLAIM, and the REST plane cannot name anyone ──
  it('P5 the WS plane attributes writes and messages to the CLAIMED id; the REST plane attributes to a constant', async () => {
    const writer = await connect('agent-writer');
    await wait(300);
    writer.ws.send(JSON.stringify({ type: 'memory_write', key: 'r494:mem', value: 'v', tags: [], ttl: 0 }));
    await wait(800);
    const mem = await db.getMemory('r494:mem');
    expect(mem?.updatedBy).toBe('agent-writer');

    const sender = await connect('agent-sender');
    await wait(300);
    sender.ws.send(JSON.stringify({ type: 'message', topic: 'r494-topic', content: 'hi' }));
    await wait(800);
    const msgs = await db.getMessages('r494-topic', 10);
    expect(msgs.some((m: any) => m.from === 'agent-sender')).toBe(true);

    // The REST plane has no name to record — it writes a constant.
    await wsServer.getMemoryPool().write('r494:rest', 'v', 'rest-api', [], 0);
    const restMem = await db.getMemory('r494:rest');
    expect(restMem?.updatedBy).toBe('rest-api');
  });

  // ── P7: repair arm — binding the subject turns the defect red ─────────
  it('P7 REPAIR ARM — a handshake that binds the claimed subject to the credential turns P1/P2/P4 red', async () => {
    // This arm is deliberately written as `it.fails(...)`: the suite stays
    // GREEN while the defect stands and turns RED the moment the defect is
    // repaired. It states the repair's SHAPE, not its implementation: a
    // handshake that verifies the claimed subject must reject a second
    // caller claiming a bound identity.
    await expect(async () => {
      const bound = await connect('agent-bound');
      await wait(300);
      const intruder = await connect('agent-bound');
      await wait(500);
      // Under a subject-bound handshake the intruder must NOT be able to
      // evict the incumbent.
      expect(bound.closed).toBe(false);
      expect(intruder.closed).toBe(true);
    }).rejects.toThrow();
  });
});
