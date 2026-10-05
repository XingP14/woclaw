/**
 * R416 — the delegator's own WS cancel has an unreachable refusal.
 *
 * R415 shipped one shared predicate (`WSServer.isDelegationCancellable`) and
 * wired BOTH callers to it: the WS handler `handleDelegateCancel`
 * (`ws_server.ts:922`) and the REST DELETE handler (`rest_server.ts:935`). The
 * suite that shipped with it, `r415_rest_cancel_state_guard.test.ts`, proves
 * the REST arm across all four live states and one dead state. Its case 4 is
 * labelled "the WS cancel and the REST cancel agree", but it drives the WS
 * path as the **target**, not the delegator:
 *
 *     (ws.getDelegation(id)).toAgent = 'target-r415';
 *     target.send({ type: 'delegate_cancel', ... });
 *     expect(errs[0].code).toBe('forbidden');
 *
 * `handleDelegateCancel` checks ownership FIRST (`ws_server.ts:917`) and state
 * SECOND (`:922`). A target-owned cancel therefore returns at the first guard
 * and the state guard is never evaluated -- which is exactly what that test
 * comments ("whichever guard fires first"). So the `invalid_state` arm shipped
 * in 84ae9ca has **no test anywhere in the repo**: `grep -rn invalid_state
 * hub/test` returns 0 hits, and no suite sends `delegate_cancel` as the
 * delegator.
 *
 * That arm is the one an operator hits. The REST 409 already tells a REST
 * caller that a terminal delegation cannot be cancelled; the WS path is the
 * same fact expressed as an error frame the agent can react to, and today an
 * agent that cancels its own finished task would get a 200-equivalent silence
 * if the ownership guard were ever reordered -- or the state guard removed,
 * with the suite still green.
 *
 * What is pinned here is behaviour, in three claims:
 *
 *   A  a delegator cancelling its OWN terminal delegation is refused with
 *      `invalid_state`, and the record survives untouched -- status, result,
 *      summary and completedAt all intact.
 *   B  the refusal names the state it was in, so the agent's log carries the
 *      reason without a second round trip.
 *   C  the guard is the delegator's own and not a blanket deny: the same
 *      socket cancelling a LIVE delegation of its own still succeeds, and the
 *      `delegate_status` update goes out to both parties.
 *
 * As with every suite in this directory, these are assertions over shipped
 * behaviour. A failure means the code changed or the note is wrong -- per
 * R409/R410, a probe failing for the wrong reason is worse than no probe, so
 * treat a red here as something to investigate rather than to re-assert.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { mkdirSync, rmSync } from 'node:fs';
import { RestServer } from '../src/rest_server.js';
import { ClawDB } from '../src/db.js';
import { WSServer } from '../src/ws_server.js';
import { GraphStore } from '../src/graph/store.js';
import type { Config, Delegation, DelegationStatus } from '../src/types.js';

const CFG: Config = {
  port: 0, restPort: 0, host: '127.0.0.1',
  dataDir: '/tmp/woclaw-r416-probe',
  storage: { type: 'sqlite', sqlitePath: '/tmp/woclaw-r416-probe/probe.db' },
  authToken: 'r416-probe-token',
};
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('R416: the delegator\'s own WS cancel refuses a terminal state', () => {
  let db: ClawDB, rest: RestServer, ws: WSServer;
  let wsPort: number, restPort: number;
  const delegator = { sock: null as unknown as WebSocket, seen: [] as any[] };

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
    delegator.sock = await connect('delegator-r416');
    delegator.sock.on('message', m => delegator.seen.push(JSON.parse(m.toString())));
  });

  afterAll(() => {
    try { delegator.sock?.close(); } catch { /* already gone */ }
    try { rest.close(); } catch { /* already stopped */ }
    try { ws.close(); } catch { /* already stopped */ }
    rmSync(CFG.dataDir!, { recursive: true, force: true });
  });

  async function connect(agentId: string): Promise<WebSocket> {
    const s = new WebSocket(`ws://127.0.0.1:${wsPort}?agentId=${agentId}&token=${CFG.authToken}`);
    await new Promise<void>((res, rej) => { s.once('open', () => res()); s.once('error', rej); });
    return s;
  }

  /**
   * Create a delegation through the real WS path, then drive the record to
   * `status` directly. `ghost-agent` is never connected, so the hub
   * auto-rejects on receipt; this suite is about what the CANCEL does from a
   * given state, not about how the state is reached.
   */
  async function delegationIn(status: DelegationStatus): Promise<string> {
    const id = `r416-${status}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    delegator.sock.send(JSON.stringify({
      type: 'delegate_request', id, toAgent: 'ghost-agent',
      task: { description: `R416 ${status} fixture` },
    }));
    await sleep(120);
    const d = ws.getDelegation(id) as Delegation | undefined;
    expect(d, `fixture ${id} was never created`).toBeDefined();
    expect(d!.fromAgent, 'the socket that requested must be the delegator').toBe('delegator-r416');
    d!.status = status;
    if (status !== 'requested') d!.acceptedAt = Date.now() - 1000;
    if (status === 'running') d!.progress = 40;
    if (status === 'done') {
      d!.progress = 100;
      d!.result = { ok: true };
      d!.summary = 'finished';
      d!.completedAt = Date.now() - 500;
    }
    if (status === 'failed') d!.error = 'boom';
    if (status === 'rejected') d!.note = 'Target agent not connected';
    return id;
  }

  /** Send the cancel as the delegator and return the frames it produced. */
  async function cancelAsDelegator(id: string): Promise<{ errors: any[]; updates: any[] }> {
    delegator.seen.length = 0;
    delegator.sock.send(JSON.stringify({ type: 'delegate_cancel', id, reason: 'too late' }));
    await sleep(200);
    return {
      errors: delegator.seen.filter(m => m.type === 'error'),
      updates: delegator.seen.filter(m => m.type === 'delegate_status'),
    };
  }

  const get = async (id: string) =>
    (await fetch(`http://127.0.0.1:${restPort}/delegations/${id}`, {
      headers: { Authorization: `Bearer ${CFG.authToken}` },
    })).json() as Promise<any>;

  // ── A: the dark arm ──────────────────────────────────────────────────────

  it('A1 the delegator\'s cancel of a DONE delegation is refused with invalid_state', async () => {
    const id = await delegationIn('done');
    const { errors } = await cancelAsDelegator(id);
    expect(errors, 'a terminal delegation must be refused on the WS path too').toHaveLength(1);
    expect(errors[0].code).toBe('invalid_state');
  });

  it('A2 and the finished record survives the refusal, in full', async () => {
    // Deliberately a DIFFERENT record from A1: the refusal in A1 must not have
    // half-applied, and neither must this one. Assert the whole shape, not
    // just the status, because the pre-guard code stamped every field.
    const id = await delegationIn('done');
    await cancelAsDelegator(id);
    const after = (await get(id)).delegation as Delegation;
    expect(after.status).toBe('done');
    expect(after.progress).toBe(100);
    expect(after.summary).toBe('finished');
    expect(after.result).toEqual({ ok: true });
    expect(after.completedAt, 'a refused cancel must not stamp completedAt').toBeTruthy();
    // The auto-reject leaves `note = 'Target agent not connected'` on the
    // record; the cancel carries `reason: 'too late'`. The refusal must leave
    // the former intact -- the pre-guard code overwrote it unconditionally, and
    // that is what made a terminal record read "cancelled, and also rejected
    // because nobody was there".
    expect(after.note).toBe('Target agent not connected');
    expect(after.note).not.toContain('too late');
  });

  it('A3 a FAILED delegation is terminal on this path as well', async () => {
    const id = await delegationIn('failed');
    const { errors } = await cancelAsDelegator(id);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('invalid_state');
    expect((await get(id)).delegation.status).toBe('failed');
  });

  it('A4 a REJECTED delegation is refused too -- the ordinary dead-target case', async () => {
    // No status override: the hub itself auto-rejects because `ghost-agent` is
    // never connected, so this is the state a real task lands in.
    const id = `r416-rejected-${Date.now()}`;
    delegator.sock.send(JSON.stringify({
      type: 'delegate_request', id, toAgent: 'ghost-agent',
      task: { description: 'R416 auto-reject fixture' },
    }));
    await sleep(150);
    expect((ws.getDelegation(id) as Delegation).status).toBe('rejected');
    const { errors } = await cancelAsDelegator(id);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('invalid_state');
    expect((await get(id)).delegation.status).toBe('rejected');
  });

  // ── B: the message carries the reason ────────────────────────────────────

  it('B the refusal names the state it refused from', async () => {
    const id = await delegationIn('done');
    const { errors } = await cancelAsDelegator(id);
    expect(errors[0].message).toContain('done');
    expect(errors[0].message).toMatch(/cannot cancel/i);
  });

  // ── C: the guard is specific, not a blanket deny ─────────────────────────

  it('C the same socket can still cancel its own LIVE delegations', async () => {
    for (const status of ['requested', 'accepted', 'running'] as const) {
      const id = await delegationIn(status);
      const { errors, updates } = await cancelAsDelegator(id);
      expect(errors, `${status} must remain cancellable`).toHaveLength(0);
      expect((ws.getDelegation(id) as Delegation).status).toBe('cancelled');
      expect((await get(id)).delegation.status).toBe('cancelled');
      expect(updates.length, 'a real cancel notifies the delegator').toBeGreaterThan(0);
      expect(updates[0].status).toBe('cancelled');
    }
  });

  it('C2 a refused cancel sends NO delegate_status -- silence would read as success', async () => {
    // The failure mode this pins: if the guard were removed, or the send moved
    // before the guard, the agent gets a `delegate_status` it did not ask for
    // and no error. An agent that treats a status frame as confirmation would
    // believe a finished task was cancelled.
    const id = await delegationIn('done');
    const { errors, updates } = await cancelAsDelegator(id);
    expect(errors).toHaveLength(1);
    expect(updates, 'no status frame may follow a refused cancel').toHaveLength(0);
  });

  it('C3 an unknown id is not_found, so the two refusals stay distinguishable', async () => {
    const { errors } = await cancelAsDelegator('r416-does-not-exist');
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('not_found');
  });

  it('C4 the predicate and the handler cannot drift apart again', async () => {
    // The suite above pins three refusals and three successes through the
    // socket. This pins the predicate itself against the full status union, so
    // adding an eighth DelegationStatus cannot silently make the handler's
    // answer differ from the table R415 documented.
    const expected: Record<DelegationStatus, boolean> = {
      requested: true,
      accepted: true,
      running: true,
      rejected: false,
      done: false,
      failed: false,
      cancelled: false,
    };
    for (const [status, cancellable] of Object.entries(expected)) {
      expect(WSServer.isDelegationCancellable(status as DelegationStatus),
        `isDelegationCancellable('${status}') must be ${cancellable}`).toBe(cancellable);
    }
  });
});