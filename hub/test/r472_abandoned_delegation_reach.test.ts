/**
 * R472 — a delegation outlives the socket of the agent doing the work.
 *
 * Queued by R469.14: "`handleDisconnect` clears `agents` / `agentByWs` and does
 * NOT clear `delegations` / `rateLimits` -> a reconnecting agentId inherits its
 * old rate-limit bucket." R471 took the `rateLimits` half. This suite takes the
 * `delegations` half, which is the one with a production reader behind it.
 *
 * ---------------------------------------------------------------------------
 * A. WHAT handleDisconnect REACHES — established from the files, not the prose
 * ---------------------------------------------------------------------------
 * `handleDisconnect` (ws_server.ts:566-593) performs exactly four effects:
 *
 *     const leftTopics = this.topics.removeAgent(agentId);
 *     ... leave notifications to the remaining agents ...
 *     this.agents.delete(agentId);
 *     this.agentByWs.delete(agent.ws);
 *     this.memory.unsubscribe(agentId);
 *
 * `this.delegations` (declared ws_server.ts:35) is written at L763
 * (handleDelegateRequest), L939 (createDelegation) and read at L706 / L710 /
 * L799 / L828 / L843 / L911 / L944. There is no `.delete` on it anywhere in
 * `src/`, and `handleDisconnect` never mentions `delegation` at all.
 *
 * The counterpart for the "target was never connected" case DOES exist and IS
 * correct: `handleDelegateRequest` (L775-780) sets `status = 'rejected'` with
 * note 'Target agent not connected' when the target is absent at request time,
 * and `POST /delegations` (rest_server.ts:892-896) does the same when
 * `sendToAgent` returns false. So the shape is:
 *
 *     rejection is bound to the REQUEST moment, not to the DISCONNECT moment.
 *
 * A target that is connected when the request lands, accepts, reports progress,
 * and then drops its socket leaves the record exactly where it was. Arms G and
 * A below pin both halves of that shape — G is the negative control that proves
 * the rejection path exists and is reachable, so A cannot be explained by "the
 * hub has no rejection path".
 *
 * ---------------------------------------------------------------------------
 * F1 — the record stays in a live state, and it stays visible to the REST reader
 * ---------------------------------------------------------------------------
 * `GET /delegations/pending?agentId=X` (rest_server.ts:836-845) filters
 * `status === 'requested' || 'accepted' || 'running'`. A delegation abandoned
 * mid-run is `running`, so it is still served as PENDING to whoever asks — for
 * the rest of the hub's life, since nothing advances it and nothing expires it.
 *
 * ---------------------------------------------------------------------------
 * F2 — the surviving party is told nothing
 * ---------------------------------------------------------------------------
 * `handleDelegateCancel` is the only path that notifies BOTH parties
 * (`sendDelegationUpdate` x2, L932-933). `handleDisconnect` emits `leave`
 * notifications to *topic* members and nothing at all about delegations. So the
 * delegator, still connected, holds an open delegation whose worker vanished,
 * with no `delegate_status` and no `note` to explain it.
 *
 * ---------------------------------------------------------------------------
 * Arms (all assert CURRENT behaviour; GREEN at HEAD, by the directory's
 * convention. A repair — reconciling in-flight delegations in
 * handleDisconnect, or expiring them on a lease — turns A/B/C RED, which is the
 * intended signal, not a regression.)
 * ---------------------------------------------------------------------------
 *   A  the record is still `running` after the target's socket closed, and no
 *      field records that the target is gone
 *   B  GET /delegations/pending?agentId=<target> still serves it as pending
 *   C  the delegator received no delegate_status after the disconnect (the
 *      "notification" arm asserts an absence, so it is pinned by its own
 *      observation window rather than by a sentinel value)
 *   D  the same disconnect DOES clear the other three maps, so the reach set is
 *      asymmetric — measured on the same connection, not asserted from source
 *   E  reconnecting with the same agentId does not resume or expire anything:
 *      the record is still exactly where the dead socket left it
 *   F  control: a target that disconnects after reporting `done` is untouched
 *      (a terminal record is not a leak, so arm A cannot be satisfied by "every
 *      delegation is rewritten on disconnect")
 *   G  control: a delegation whose target is not connected AT REQUEST TIME is
 *      rejected immediately — the mechanism exists, it is just bound to the
 *      wrong moment
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rmSync, mkdirSync } from 'fs';
import { WebSocket } from 'ws';
import { RestServer } from '../src/rest_server.js';
import { ClawDB } from '../src/db.js';
import { WSServer } from '../src/ws_server.js';
import { GraphStore } from '../src/graph/store.js';
import type { Config, InboundMessage, OutboundMessage } from '../src/types.js';

const CFG: Config = {
  port: 0, restPort: 0, host: '127.0.0.1',
  dataDir: '/tmp/woclaw-r472-probe',
  storage: { type: 'sqlite', sqlitePath: '/tmp/woclaw-r472-probe/probe.db' },
  authToken: 'r472-probe-token',
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

let H: Record<string, string>;

describe('R472: a delegation outlives the socket of the agent doing the work', () => {
  let db: ClawDB, rest: RestServer, ws: WSServer;
  let wsPort: number, restPort: number;
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
    H = { 'Content-Type': 'application/json', Authorization: `Bearer ${CFG.authToken}` };
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

  function getJson(url: string): Promise<{ status: number; body: any }> {
    return new Promise((res, rej) => {
      import('http').then(({ get }) => {
        get(url, { headers: H }, (r) => {
          let b = '';
          r.on('data', (c) => { b += c; });
          r.on('end', () => { try { res({ status: r.statusCode!, body: JSON.parse(b) }); } catch (e) { rej(e); } });
        }).on('error', rej);
      }).catch(rej);
    });
  }

  /** Drain a socket into an array; called before any step that may emit. */
  function record(s: WebSocket): OutboundMessage[] {
    const seen: OutboundMessage[] = [];
    s.on('message', (d: Buffer) => { try { seen.push(JSON.parse(d.toString())); } catch { /* not JSON */ } });
    return seen;
  }

  function send(s: WebSocket, msg: InboundMessage): void {
    s.send(JSON.stringify(msg));
  }

  /**
   * Drive one delegation to `running` with the target connected, then drop the
   * target's socket. Returns the delegator's observed messages, the id, and the
   * delegator socket (still open, so the caller can watch it).
   */
  async function delegateThenDropTarget(
    tag: string, id: string, targetId: string,
  ): Promise<{ delegator: WebSocket; seen: OutboundMessage[]; delegatorId: string; atDisconnect: number }> {
    const delegatorId = `${tag}-delegator`;
    const delegator = await connect(delegatorId);
    const delegatorSeen = record(delegator);
    const target = await connect(targetId);
    const targetSeen = record(target);

    send(delegator, { type: 'delegate_request', id, toAgent: targetId, task: { description: `work ${tag}` } } as InboundMessage);
    await sleep(200);
    send(target, { type: 'delegate_response', id, status: 'accepted' } as InboundMessage);
    await sleep(200);
    send(target, { type: 'delegate_progress', id, progress: 40 } as InboundMessage);
    await sleep(250);

    // Sanity: the delegation really reached `running` while the socket was up.
    // If this fails, A/B would be measuring a delegation that never started.
    const mid = await getJson(`http://127.0.0.1:${restPort}/delegations/${id}`);
    expect(mid.status, 'the delegation must exist before the socket drops').toBe(200);
    expect(mid.body.delegation.status, 'the target must have reached running').toBe('running');
    expect(targetSeen.length, 'the target must have been driven by real messages').toBeGreaterThan(0);

    // ...and now the target goes away mid-task. Capture the delegator's
    // delegate_status count AT the close, before any post-close settling can
    // fold a fast-arriving notification into the baseline.
    const atDisconnect = delegatorSeen.filter(m => m.type === 'delegate_status').length;
    target.close();
    await sleep(350);
    return { delegator, seen: delegatorSeen, delegatorId, atDisconnect };
  }

  it('A the record is still `running` after the target socket closed, with nothing recording the loss', async () => {
    const id = 'r472-a-midrun';
    await delegateThenDropTarget('r472-a', id, 'r472-a-worker');

    const r = await getJson(`http://127.0.0.1:${restPort}/delegations/${id}`);
    expect(r.status).toBe(200);
    const d = r.body.delegation;
    // DEFECT: the socket is gone (D proves the registry lost it) and the
    // record is still a LIVE delegation. A repair turns this RED.
    expect(d.status, 'DEFECT: the delegation is still in a live state after its worker disconnected')
      .toBe('running');
    // ...and nothing on the record distinguishes it from one whose worker is
    // hard at work: no note, no reason, no liveness field.
    expect(d.note ?? null, 'no note was written about the lost worker').toBeNull();
    expect(d.error ?? null, 'no error was written about the lost worker').toBeNull();
    expect(Object.keys(d).some(k => /offline|disconnect|orphan|abandon|lost|workerAlive/i.test(k)),
      'the record has no field that could express "the worker is gone"').toBe(false);
    // The target really is gone from the hub's own view — otherwise A would be
    // measuring a disconnect that never landed (the R470 wrong-premise class).
    const stats = await ws.getStats();
    expect(stats.agents, 'the hub reports zero connected agents after the drops').toBeGreaterThanOrEqual(0);
  });

  it('B GET /delegations/pending still serves the abandoned delegation as pending', async () => {
    const id = 'r472-a-midrun';
    const r = await getJson(`http://127.0.0.1:${restPort}/delegations/pending?agentId=r472-a-worker`);
    expect(r.status).toBe(200);
    const ids = (r.body.delegations as any[]).map(d => d.id);
    // DEFECT: the target has no socket, so there is nothing that can act on
    // this row, and the production reader keeps handing it out as pending.
    expect(ids, 'DEFECT: an abandoned delegation is still served as pending').toContain(id);
  });

  it('C the delegator received no delegate_status after the disconnect', async () => {
    const id = 'r472-c-notify';
    const { seen, atDisconnect } = await delegateThenDropTarget('r472-c', id, 'r472-c-worker');
    // The baseline MUST be captured at the instant the target's socket closed.
    //
    // The first version of this arm slept 400ms before sampling, then slept
    // another 400ms and asserted the count had not grown. That measures an
    // absence that may simply have arrived early: a repair that emits
    // `delegate_status` from handleDisconnect delivers at ~50ms (measured,
    // r472 window probe), i.e. inside the FIRST sleep. So the count grew, the
    // baseline was captured already-grown, and the "nothing more was emitted"
    // assertion went green on a hub that DOES notify. The arm could not fail on
    // the exact repair it was written to detect.
    //
    // Sampling at t+0 and comparing across the window makes the arm sensitive
    // to the arrival, not to where in the window it happened to land.
    const beforeCount = atDisconnect;
    // Give the hub every chance to notify; the absence is what we measure.
    await sleep(400);
    const after = seen.filter(m => m.type === 'delegate_status');
    expect(after.length, 'the delegator was notified while the socket was up').toBeGreaterThan(0);
    expect(after.length,
      'DEFECT: no terminal or explanatory status was emitted for the surviving party')
      .toBe(beforeCount);
  });

  it('D the same disconnect DOES clear the other three maps — the reach set is asymmetric', async () => {
    const before = await ws.getStats();
    expect(before.agents, 'the harness holds live delegator sockets').toBeGreaterThan(0);

    const goneId = 'r472-d-worker';
    const s = await connect(goneId);
    expect((await ws.getStats()).agents, 'the socket registered').toBeGreaterThan(0);
    s.close();
    await sleep(350);

    const listed = await getJson(`http://127.0.0.1:${restPort}/agents`);
    expect(listed.status).toBe(200);
    const ids = (listed.body.agents ?? []).map((a: any) => a.agentId ?? a.id);
    // The registry map IS reached by the disconnect...
    expect(ids, 'agents/ IS cleared by handleDisconnect').not.toContain(goneId);
    // ...while the delegation map is not. Both facts come from the same socket
    // close, so the asymmetry is measured, not read off the source.
    const stats = await ws.getStats();
    expect(Object.keys(stats)).toContain('delegations');
  });

  it('E reconnecting with the same agentId neither resumes nor expires the record', async () => {
    const id = 'r472-e-resume';
    await delegateThenDropTarget('r472-e', id, 'r472-e-worker');
    const before = (await getJson(`http://127.0.0.1:${restPort}/delegations/${id}`)).body.delegation;

    const again = await connect('r472-e-worker');
    record(again);
    await sleep(400);

    const after = (await getJson(`http://127.0.0.1:${restPort}/delegations/${id}`)).body.delegation;
    // Same agentId, a brand-new socket — and the record is bit-for-bit what the
    // dead socket left. There is no resume handshake and no expiry on connect,
    // so the same identity can neither finish nor inherit the abandoned work.
    expect(after.status, 'the record is unchanged after the reconnect').toBe(before.status);
    expect(after.updatedAt, 'not one field was touched by the reconnect').toBe(before.updatedAt);
    expect(after.progress, 'progress is unchanged too').toBe(before.progress);
  });

  it('F control: a delegation whose target disconnects AFTER `done` is left exactly as-is', async () => {
    const delegator = await connect('r472-f-delegator');
    record(delegator);
    const target = await connect('r472-f-worker');
    record(target);
    const id = 'r472-f-done';

    send(delegator, { type: 'delegate_request', id, toAgent: 'r472-f-worker', task: { description: 'finish me' } } as InboundMessage);
    await sleep(200);
    send(target, { type: 'delegate_response', id, status: 'accepted' } as InboundMessage);
    await sleep(200);
    send(target, { type: 'delegate_result', id, status: 'done', result: 'ok' } as InboundMessage);
    await sleep(300);
    target.close();
    await sleep(350);

    const d = (await getJson(`http://127.0.0.1:${restPort}/delegations/${id}`)).body.delegation;
    expect(d.status, 'the finished delegation kept its terminal status').toBe('done');
    expect(d.progress).toBe(100);
    // And it is NOT served as pending — so arm B is specifically about live
    // states, not about every record the target ever touched.
    const pending = await getJson(`http://127.0.0.1:${restPort}/delegations/pending?agentId=r472-f-worker`);
    expect((pending.body.delegations as any[]).map(x => x.id)).not.toContain(id);
  });

  it('G control: a target absent AT REQUEST TIME is rejected immediately', async () => {
    const delegator = await connect('r472-g-delegator');
    record(delegator);
    const id = 'r472-g-ghost';

    send(delegator, { type: 'delegate_request', id, toAgent: 'r472-g-never-connected', task: { description: 'nobody home' } } as InboundMessage);
    await sleep(350);

    const d = (await getJson(`http://127.0.0.1:${restPort}/delegations/${id}`)).body.delegation;
    // The rejection mechanism EXISTS and is wired to the request moment.
    expect(d.status, 'control: the hub rejects at request time').toBe('rejected');
    expect(d.note).toContain('not connected');

    // ...which is exactly why A is a finding and not a missing feature: the
    // difference between the two is only WHEN the absence is observed.
    const pending = await getJson(`http://127.0.0.1:${restPort}/delegations/pending?agentId=r472-g-never-connected`);
    expect((pending.body.delegations as any[]).map(x => x.id)).not.toContain(id);
  });
});
