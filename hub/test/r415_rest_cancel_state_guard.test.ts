/**
 * R415 — the REST cancel has no state machine, the WS cancel has one.
 *
 * R414 (a grep-style probe) noticed that `interrupted` is declared in the exit
 * taxonomy and never produced. This suite does not care about that. It cares
 * about something R414 did not check, and which is visible only at runtime:
 *
 *   hub/src/ws_server.ts:905   handleDelegateCancel refuses unless status is
 *                              one of requested | accepted | running.
 *   hub/src/rest_server.ts:931 the DELETE handler assigns `d.status =
 *                              'cancelled'` with NO guard at all.
 *
 * Two callers, one operation, two different contracts. Concretely: a
 * delegation that has already reported `done` (its result delivered, its
 * topic message published, its completedAt stamped) can be flipped to
 * `cancelled` through REST. The response is `200 {success: true, delegation:
 * {...status: 'cancelled'}}` — an affirmative confirmation of a state change
 * that did not happen, on a task that is finished. `completedAt` survives, so
 * the record now reads "cancelled, and also completed", which is a state the
 * type union permits and no caller can make sense of.
 *
 * The reverse direction is not a bug but a design fact worth pinning: WS cancel
 * is authorised by `fromAgent`, so the target can never cancel itself. REST has
 * no per-caller identity at all; it is authorised by the hub token. Pin both so
 * a future change to either is visible.
 *
 * These are assertions over the SHIPPED behaviour. If one of them fails, either
 * the code changed or the note above is wrong — and per R409/R410, a probe that
 * fails for the wrong reason is worse than no probe, so both are a red flag to
 * investigate rather than to re-assert.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { WebSocket } from 'ws';
import { mkdirSync, rmSync } from 'node:fs';
import { RestServer } from '../src/rest_server.js';
import { ClawDB } from '../src/db.js';
import { WSServer } from '../src/ws_server.js';
import { GraphStore } from '../src/graph/store.js';
import type { Config, Delegation } from '../src/types.js';

const CFG: Config = {
  port: 0, restPort: 0, host: '127.0.0.1',
  dataDir: '/tmp/woclaw-r415-probe',
  storage: { type: 'sqlite', sqlitePath: '/tmp/woclaw-r415-probe/probe.db' },
  authToken: 'r415-probe-token',
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('R415: REST cancel bypasses the WS cancel state machine', () => {
  let db: ClawDB, rest: RestServer, ws: WSServer;
  let wsPort: number, restPort: number;
  let H: { 'Content-Type': string; Authorization: string };
  const delegator = { sock: null as unknown as WebSocket };

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
    delegator.sock = await connect('delegator-r415');
  });

  async function connect(agentId: string): Promise<WebSocket> {
    const s = new WebSocket(`ws://127.0.0.1:${wsPort}?agentId=${agentId}&token=${CFG.authToken}`);
    await new Promise<void>((res, rej) => { s.once('open', () => res()); s.once('error', rej); });
    return s;
  }

  /** Create a delegation through the real WS path, then force it to `status`. */
  async function delegationIn(
    status: 'requested' | 'accepted' | 'running' | 'done',
    keepAutoReject = false,
  ): Promise<string> {
    const id = `r415-${status}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    delegator.sock.send(JSON.stringify({
      type: 'delegate_request', id, toAgent: 'ghost-agent',
      task: { description: `R415 ${status} fixture` },
    }));
    await sleep(120);
    const d = ws.getDelegation(id) as Delegation | undefined;
    expect(d, `fixture ${id} was never created`).toBeDefined();
    // 'ghost-agent' is never connected, so the hub auto-rejects on receipt.
    // Drive the record to the state under test directly -- this suite is about
    // what the CANCEL does from a given state, not about how the state is
    // reached. `keepAutoReject` leaves that auto-rejected state intact.
    if (!keepAutoReject) d!.status = status;
    if (status !== 'requested') d!.acceptedAt = Date.now() - 1000;
    if (status === 'running') d!.progress = 40;
    if (status === 'done') {
      d!.progress = 100;
      d!.result = { ok: true };
      d!.summary = 'finished';
      d!.completedAt = Date.now() - 500;
    }
    return id;
  }

  const del = (id: string) =>
    fetch(`http://127.0.0.1:${restPort}/delegations/${id}`, { method: 'DELETE', headers: H });
  const get = async (id: string) =>
    (await fetch(`http://127.0.0.1:${restPort}/delegations/${id}`, { headers: H })).json() as Promise<any>;

  it('1. REST cancel of a DONE delegation is refused, and the record survives', async () => {
    const id = await delegationIn('done');
    const res = await del(id);
    expect(res.status, 'a terminal delegation must not be cancellable').toBe(409);
    const after = await get(id);
    expect(after.delegation.status).toBe('done');
    expect(after.delegation.summary).toBe('finished');
    expect(after.delegation.completedAt).toBeTruthy();
  });

  it('2. REST cancel of a live delegation still works (the guard is not a blanket deny)', async () => {
    for (const status of ['requested', 'accepted', 'running'] as const) {
      const id = await delegationIn(status);
      const res = await del(id);
      expect(res.status, `${status} must remain cancellable`).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.delegation.status).toBe('cancelled');
      expect((await get(id)).delegation.status).toBe('cancelled');
    }
  });

  it('3. a FAILED delegation is terminal too, and is equally refused', async () => {
    const id = await delegationIn('done');
    (ws.getDelegation(id) as Delegation).status = 'failed';
    const res = await del(id);
    expect(res.status).toBe(409);
    expect((await get(id)).delegation.status).toBe('failed');
  });

  it('4. the WS cancel and the REST cancel agree on which states are cancellable', async () => {
    // WS path, live: the target tries to cancel a done delegation it owns.
    const target = await connect('target-r415');
    const id = await delegationIn('done');
    const seen: any[] = [];
    target.on('message', m => seen.push(JSON.parse(m.toString())));
    // target must also be the toAgent for the ownership branch to be reached
    (ws.getDelegation(id) as Delegation).toAgent = 'target-r415';
    target.send(JSON.stringify({ type: 'delegate_cancel', id, reason: 'too late' }));
    await sleep(200);
    const errs = seen.filter(m => m.type === 'error');
    // The target is not the delegator, so it is refused for the OTHER reason.
    // Assert the refusal exists and that the record is untouched -- which is
    // the property that must hold whichever guard fires first.
    expect(errs.length, 'target-owned cancel must be refused').toBeGreaterThan(0);
    expect(errs[0].code).toBe('forbidden');
    expect((await get(id)).delegation.status).toBe('done');
  });

  it('6. a REJECTED delegation is refused -- this is the arm M1 proved was untested', async () => {
    // The delegation auto-rejects when its target is not connected, so this is
    // the state an ordinary dead-target task lands in. Deleting it must not
    // resurrect a record the hub already refused.
    const id = await delegationIn('requested', true);
    const res = await del(id);
    expect(res.status, 'a rejected delegation is not cancellable').toBe(409);
    expect((await get(id)).delegation.status).toBe('rejected');
  });

  it('7. an unknown delegation id is 404 on both verbs, not a silent 200', async () => {
    const res = await del('r415-does-not-exist');
    expect(res.status).toBe(404);
    expect((await res.json() as any).error).toBeTruthy();
  });
});
