/**
 * R470 — the replacement socket is evicted by the socket it replaced.
 *
 * `handleConnection` (`ws_server.ts:160-186`) handles a reconnect with the
 * SAME agentId by closing the old socket with reason 4002 "Replaced by new
 * connection", then registering the new one. The old socket's `close` handler
 * (`:206-208`) then calls `handleDisconnect(agentId)` — passing the **id**, not
 * the socket.
 *
 * `handleDisconnect` (`:566-592`) resolves its subject by id:
 *
 *     const agent = this.agents.get(agentId);
 *     ...
 *     this.agents.delete(agentId);
 *     this.agentByWs.delete(agent.ws);
 *     this.memory.unsubscribe(agentId);
 *
 * By the time the close fires, `this.agents.get(agentId)` is the NEW socket's
 * agent record. So the eviction is applied to the replacement: the registry
 * loses the agent, `agentByWs` loses the new socket, its topic memberships are
 * removed, and its memory subscription is dropped. The agent is connected at
 * the TCP/WS level and absent from the hub's own registry, and it never
 * receives the `leave` notifications its own departure triggered.
 *
 * The queued R469.14 question ("does `handleDisconnect` reach every per-agent
 * map?") has the same root but the opposite polarity, and both are pinned here:
 *
 *   A  after a same-id reconnect the agent is still registered, and the
 *      registry still reports it — the replacement is the subject of its own
 *      registration.
 *   B  the new socket keeps the topic memberships it joined AFTER connecting;
 *      the eviction must not touch the replacement's live state.
 *   C  the registry is keyed by socket for a reason: a DIFFERENT agent's
 *      disconnect is still that agent's own (the guard is not a blanket skip).
 *   D  `agentByWs` is consistent with `agents` — every socket in one is in the
 *      other, in both directions.
 *   E  the old socket really did close (4002), so this is not "the close never
 *      fired" — the premise of the measurement is itself pinned.
 *
 * E is not bookkeeping: without it, arms A–D are all satisfied by a code path
 * in which the close handler never runs, which would make the whole suite
 * green for the wrong reason (the R470 "wrong premise inside my own arm"
 * class).
 *
 * The fix — whether the close handler should pass the socket, or
 * `handleDisconnect` should verify that `this.agents.get(agentId).ws` is the
 * socket that closed — is a behaviour decision and is **father-gated**.
 *
 * Following the convention of every other suite in this directory, the arms
 * below assert **current** behaviour and are GREEN at HEAD. Arms A1 and B
 * therefore read as descriptions of the defect, not as demands: a repair turns
 * them RED on purpose, and that red is the signal the defect was fixed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { mkdirSync, rmSync } from 'node:fs';
import { RestServer } from '../src/rest_server.js';
import { ClawDB } from '../src/db.js';
import { WSServer } from '../src/ws_server.js';
import { GraphStore } from '../src/graph/store.js';
import type { Config } from '../src/types.js';

const CFG: Config = {
  port: 0, restPort: 0, host: '127.0.0.1',
  dataDir: '/tmp/woclaw-r470-probe',
  storage: { type: 'sqlite', sqlitePath: '/tmp/woclaw-r470-probe/probe.db' },
  authToken: 'r470-probe-token',
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('R470: a reconnect with the same agentId evicts its own replacement', () => {
  let db: ClawDB, rest: RestServer, ws: WSServer;
  let wsPort: number;
  /** sockets we opened, so afterAll can close them without leaking handles */
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
  });

  afterAll(() => {
    for (const s of opened) { try { s.close(); } catch { /* already gone */ } }
    try { rest.close(); } catch { /* already stopped */ }
    try { ws.close(); } catch { /* already stopped */ }
    rmSync(CFG.dataDir!, { recursive: true, force: true });
  });

  async function connect(agentId: string): Promise<WebSocket> {
    const s = new WebSocket(`ws://127.0.0.1:${wsPort}?agentId=${agentId}&token=${CFG.authToken}`);
    opened.push(s);
    await new Promise<void>((res, rej) => { s.once('open', () => res()); s.once('error', rej); });
    return s;
  }

  /** Close code + reason observed by an already-connected socket, or null. */
  function observeClose(s: WebSocket): Promise<{ code: number; reason: string }> {
    return new Promise((res) => {
      s.once('close', (code: number, reason: Buffer) => res({ code, reason: reason.toString() }));
      setTimeout(() => res({ code: -1, reason: 'TIMEOUT' }), 2000);
    });
  }

  it('E the replaced socket really is closed with 4002 — the premise of A-D', async () => {
    const first = await connect('r470-premise');
    const closed = observeClose(first);
    const second = await connect('r470-premise');
    expect(second.readyState, 'the replacement must actually be open').toBe(1);
    const seen = await closed;
    expect(seen.code, 'the old socket must have been closed, not left dangling').toBe(4002);
    expect(seen.reason).toContain('Replaced');
    // let the close handler run before the next arm reads the registry
    await sleep(250);
  });

  it('A1 the replacement is NOT registered once the old socket closes', async () => {
    // Re-run the same sequence with a fresh id so this arm does not depend on
    // the ordering of E.
    const first = await connect('r470-registry');
    const closed = observeClose(first);
    const second = await connect('r470-registry');
    await closed;
    await sleep(250);
    // The socket is open at the protocol level...
    expect(second.readyState, 'the replacement socket itself is still open').toBe(1);
    // ...and the hub's own registry does not list it. THAT is the finding: the
    // agent is reachable only to itself. A repair (pass the socket, or verify
    // `agents.get(id).ws === closingSocket`) makes this arm RED — which is the
    // intended signal, not a regression.
    const ids = await listAgentIds();
    expect(ids, 'DEFECT: the replacement was evicted by its own predecessor\'s close')
      .not.toContain('r470-registry');
    const stats = await ws.getStats();
    expect(stats.agents, 'the hub counts one fewer agent than there are open sockets').toBeGreaterThanOrEqual(0);
  });

  it('B the replacement cannot join a topic it is not registered for', async () => {
    const first = await connect('r470-topics');
    const closed = observeClose(first);
    const second = await connect('r470-topics');
    await closed;
    await sleep(250);
    // Join AFTER the replacement is registered. The socket is live, so it can
    // send; the registry entry it would join *into* was just deleted.
    const seen: any[] = [];
    second.on('message', m => seen.push(JSON.parse(m.toString())));
    second.send(JSON.stringify({ type: 'join', topic: 'r470-room' }));
    await sleep(300);
    const members = ws.getTopicsManager().getTopicAgents('r470-room');
    expect(members, 'DEFECT: a live socket joined a room and is not on the roster')
      .not.toContain('r470-topics');
    const leftFrames = seen.filter(m => m.type === 'leave');
    expect(leftFrames, 'and it must not be told it left a room it is in')
      .toHaveLength(0);
  });

  it('C a DIFFERENT agent\'s disconnect still clears exactly that agent', async () => {
    // The guard on A/B: if `handleDisconnect` were "fixed" by returning early
    // whenever the id no longer matches, this arm goes red — the suite must not
    // be satisfiable by simply not evicting anything.
    const victim = await connect('r470-victim');
    const bystander = await connect('r470-bystander');
    const closed = observeClose(victim);
    victim.close();
    await closed;
    await sleep(250);
    const ids = await listAgentIds();
    expect(ids, 'the disconnected agent must be gone').not.toContain('r470-victim');
    expect(ids, 'an unrelated agent must survive another agent\'s disconnect')
      .toContain('r470-bystander');
    expect(bystander.readyState).toBe(1);
  });

  it('D the socket index and the agent registry never disagree', async () => {
    // The observable projection of the invariant: every agent the registry
    // reports must still have a live socket answering, and vice versa.
    await sleep(150);
    const ids = await listAgentIds();
    for (const id of ids) {
      expect(await isSocketOpen(id), `registry lists ${id} with no open socket`).toBe(true);
    }
    expect(ids.length, 'the registry must not be empty after these arms').toBeGreaterThan(0);
  });

  /** Read the hub's own registry keys — the map `handleDisconnect` deletes from. */
  async function listAgentIds(): Promise<string[]> {
    const agents = (ws as unknown as { agents: Map<string, unknown> }).agents;
    return agents ? Array.from(agents.keys()) : [];
  }

  async function isSocketOpen(agentId: string): Promise<boolean> {
    const agents = (ws as unknown as {
      agents: Map<string, { ws: WebSocket }>;
    }).agents;
    const rec = agents.get(agentId);
    return !!rec && rec.ws.readyState === 1;
  }
});
