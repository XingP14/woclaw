/**
 * R414 — notification attainability: the reachability plane, never read.
 *
 * R405-F5 named it in one line and seven rounds never opened it: "16/16 `notif`
 * sites are agent-to-agent, 0 human-facing." That observation is about *audience*.
 * This round is about *attainability* — and the audience question turns out to be
 * the small half.
 *
 * R74 (3-round in-cluster cap) was spent by R411→R412→R413, so this round pivots
 * axis. The named open site (a) was taken; (b) and (c) remain queued.
 *
 * ── F1: the subscriber registry has no production population ──
 *
 * `MemoryPool.subscribe()` (`memory.ts:355`) is the only writer of
 * `this.subscribers` (`:121`). Repo-wide, **0 production call sites** — every
 * `.subscribe(` is in `hub/test/`. The five remaining `notif`-shaped call sites
 * therefore form two dead paths:
 *
 *   - `memory.ts:143`  — fires on every non-duplicate write, fans out to nothing
 *   - `ws_server.ts:528` — fires after the same write, fans out to nothing
 *
 * `unsubscribe()` at `ws_server.ts:589` runs on every disconnect against a map
 * that was never populated. Note this is *not* the R405-F5 shape: F5 counted
 * sites, this counts **populators**. A notification mechanism with no
 * registration path cannot miss a human recipient — it cannot reach one.
 *
 * ── F2: the wire vocabulary is untyped in the one direction that matters ──
 *
 * `Message.type` (`types.ts:56`) and `InboundMessage.type` (`:68`) are closed
 * unions. `OutboundMessage` (`types.ts:95`) is:
 *
 *     interface OutboundMessage { type: string; [key: string]: unknown }
 *
 * Every one of the 14 literals `ws_server.ts` emits is assignable to it. Eight
 * are undeclared by any union: `welcome`, `history`, `memory_update`,
 * `memory_value`, `stream`, `stream_ack`, `delegate_incoming`,
 * `delegate_status`. The open index signature is exactly what makes F1 and F3
 * undetectable at compile time — a `type: string` cannot be checked against a
 * list, so vocabulary drift is a runtime-only, never-a-type-error event.
 *
 * ── F3: writes are announced; nothing that ends a key's life is ──
 *
 * `memory_update` is emitted by `handleMemoryWrite`. There is **no** delete or
 * expiry notification anywhere in `hub/src` (0 hits). R413 established the
 * asymmetry inside storage: TTL expiry deletes the row in `db.ts` without
 * `MemoryPool.delete()` running, so the graph mirror (which drops `expireAt` at
 * mirror time, `graph/store.ts:249`) keeps serving the plaintext via
 * `GET /graph/nodes?type=memory`. R414's half: no connected agent is ever told.
 * The write is broadcast; the removal is silent. Retention that is not
 * broadcast is not retention, it is a row count.
 *
 * ── F4 ⭐: the R407/R408/R409 scope guard is bypassed by waiting ──
 *
 * The scope guard is real: `read`, `delete`, `getAll`, `search`, `recall` all
 * call `isVisibleInScope` (`memory.ts:110`), and `normalizeScope` defaults to
 * `'all'`. Nine rounds built it up and R409 reported 8/8 coverage.
 *
 * `ws_server.ts` contains **0** references to either function.
 *
 * `handleMemoryWrite` (`:512-535`) constructs the notification with the full
 * plaintext `value: mem.value` and delivers it to *every* connected agent:
 *
 *     for (const [agentId, agent] of this.agents) {
 *       if (agent.ws.readyState === 1) this.send(agent.ws, notification);
 *     }
 *
 * So for any key outside the caller's scope:
 *
 *     agent A: memory_read key=openclaw:session:secret  -> exists:false  (guard)
 *     agent B: (does nothing, waits)                     -> memory_update
 *              { key, value: "PLAINTEXT", ... }          (no guard)
 *
 * The guard holds on the pull path and is absent from the push path. A
 * session-scoped key is unreadable on request and readable on broadcast — the
 * restriction is a property of *asking*, not of the data. This is R405-F5's
 * mirror one level down: F5 found the audience was always peers; F4 finds that
 * on the write path, the audience is *everyone*, including agents for whom the
 * same key is out of scope.
 *
 * Unlike F1-F3, F4 is **not** blocked on `ws_server.ts:132` (the token binding).
 * Blocking a broadcast needs no principal: filtering by the *recipient's* own
 * scope is computable today, because `isVisibleInScope` takes a key. What is
 * missing is the *principal* to know which scope is the recipient's — so the
 * fix is the same father-gated item, reached by a second, independent route.
 *
 * Nothing here is fixed. This suite is the disclosure.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const HUB_SRC = join(__dirname, '..', 'src');
const prodTs = (): string[] =>
  readdirSync(HUB_SRC, { recursive: true } as { recursive: true })
    .filter((f): f is string => typeof f === 'string' && f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => readFileSync(join(HUB_SRC, f), 'utf8'));
const src = (name: string): string => readFileSync(join(HUB_SRC, name), 'utf8');
const ws = src('ws_server.ts');
const mem = src('memory.ts');
const types = src('types.ts');

/** Declared unions in types.ts, for the vocabulary-drift comparison. */
const declaredTypes = (): Set<string> => {
  const out = new Set<string>();
  // A union member may be first, middle, or last: `'a' | 'b' | 'c'` has a
  // trailing `|` only after the first two. Anchoring on the whole literal run
  // keeps the last member, which is what a pipe-requiring regex drops.
  // Two declaration routes count, and a mutation matrix proved that reading
  // only one of them lets a real fix survive: `type:` fields *and* `type X =`
  // aliases. A fix that hoists the vocabulary into a named alias is still a fix.
  for (const m of types.matchAll(/(?:\btype:\s*|\btype\s+\w+\s*=\s*)('[^']+'(?:\s*\|\s*'[^']+')*)/g)) {
    for (const s of m[1].matchAll(/'([^']+)'/g)) out.add(s[1]);
  }
  return out;
};

describe('R414 F1: the subscriber registry has no production population', () => {
  it('F1.1 MemoryPool.subscribe is the only writer of the subscribers map', () => {
    // Establishes that the map cannot be populated by any other route.
    const writers = prodTs()
      .flatMap((c) => c.split('\n'))
      .filter((l) => l.includes('.subscribers.set(') || l.includes('subscribers.set('));
    expect(writers.length).toBe(1);
    expect(writers[0]).toContain('this.subscribers.set(agentId, callback)');
  });

  it('F1.2 zero production call sites of .subscribe( — every one is a test', () => {
    // The load-bearing count. If this ever rises, F1 is stale.
    const prod = prodTs().filter((c) => c.includes('.subscribe('));
    expect(prod.length).toBe(0);
  });

  it('F1.3 both notifySubscribers call sites therefore fan out to an empty map', () => {
    const notify = prodTs()
      .flatMap((c) => c.split('\n'))
      .filter((l) => l.trimStart().startsWith('this.notifySubscribers(') || l.trimStart().startsWith('this.memory.notifySubscribers('));
    // Two sites (memory.ts:143 dedup-skip, ws_server.ts:528 post-write) and the
    // production fan-out loop that receives them is the empty registry.
    expect(notify.length).toBe(2);
    // The fan-out itself iterates only subscribers.
    expect(mem).toMatch(/notifySubscribers\(message: OutboundMessage\)[^{]*\{\s*for \(const callback of this\.subscribers\.values\(\)\)/);
  });

  it('F1.4 disconnect unsubscribes from a map nothing ever populated', () => {
    // Not a bug in itself — it is the receipt for a registration path that
    // does not exist. Recorded so the fix is not "add unsubscribe handling".
    expect(ws).toContain('this.memory.unsubscribe(agentId)');
  });
});

describe('R414 F2: the wire vocabulary is untyped in the one direction that matters', () => {
  it('F2.1 OutboundMessage.type is `string` with an open index signature', () => {
    expect(types).toMatch(/interface OutboundMessage \{[^}]*type: string;[^}]*\[key: string\]: unknown;/s);
  });

  it('F2.2 at least 8 emitted literals are declared by no union', () => {
    const declared = declaredTypes();
    const emitted = new Set<string>();
    for (const m of ws.matchAll(/type:\s*'([a-z_]+)'/g)) emitted.add(m[1]);
    const undeclared = [...emitted].filter((t) => !declared.has(t)).sort();
    // Snapshot of the drift, not a lower bound: if production starts
    // declaring these, the guard below fails and this list must be revisited.
    expect(undeclared).toEqual([
      'delegate_incoming',
      'delegate_status',
      'history',
      'memory_update',
      'memory_value',
      'stream',
      'stream_ack',
      'welcome',
    ]);
  });

  it('F2.3 the guard has discriminating power: a declared literal is absent from the drift list', () => {
    // Control. Without this, F2.2 could pass with an empty declared set.
    const declared = declaredTypes();
    expect(declared.has('message')).toBe(true);
    expect(declared.has('memory_write')).toBe(true);
    expect(declared.size).toBeGreaterThan(5);
  });
});

describe('R414 F3: writes are announced; nothing that ends a key\'s life is', () => {
  it('F3.1 no delete or expiry notification literal exists in production', () => {
    const files = prodTs();
    for (const name of ['memory_delete', 'memory_removed', 'memory_expired', 'memory_evicted']) {
      const hits = files.filter((c) => c.includes(name));
      expect({ name, hits: hits.length }).toEqual({ name, hits: 0 });
    }
  });

  it('F3.2 the write path does emit, so the asymmetry is not "notifications are broken"', () => {
    // Control: the notification machinery is live on the write path.
    expect(ws).toContain("type: 'memory_update'");
    expect(mem).toMatch(/this\.notifySubscribers\(\{ type: 'memory_write'/);
  });

  it('F3.3 the asymmetry is not repairable in memory.ts: the other performer deletes a layer down', () => {
    // R413's finding, re-anchored from the notification side. `db.ts` removes
    // expired rows with a bare DELETE, so even a correct hook in MemoryPool
    // would never see them — and `db.ts` has no subscribers to notify.
    const db = src('db.ts');
    expect(db).toMatch(/expireAt > 0 && .* < Date\.now\(\)/);
    expect(db).not.toMatch(/notifySubscribers/);
  });
});

describe('R414 F4: the scope guard is bypassed by waiting for someone else to write', () => {
  it('F4.1 the guard exists and is applied on the pull paths', () => {
    // The control for F4. Without this the finding would be "scope was never
    // implemented", which is false — nine rounds built it.
    for (const fn of ['read', 'delete', 'getAll']) {
      expect(mem.slice(mem.indexOf(`async ${fn}(`), mem.indexOf(`async ${fn}(`) + 900)).toContain('isVisibleInScope');
    }
    expect(mem).toMatch(/function isVisibleInScope\(mem: DBMemory, scope: 'all' \| 'workspace' \| 'session'\): boolean/);
  });

  it('F4.2 ws_server.ts consults the guard zero times', () => {
    expect(ws.includes('isVisibleInScope')).toBe(false);
    expect(ws.includes('normalizeScope')).toBe(false);
  });

  it('F4.3 the broadcast is unconditional over every connected agent', () => {
    // The recipient set is "all agents with an open socket". There is no
    // filter, no scope argument, and no early return.
    const handler = ws.slice(ws.indexOf('private async handleMemoryWrite'), ws.indexOf('private async handleMemoryRead'));
    const loop = handler.slice(handler.indexOf('for (const [agentId, agent] of this.agents)'));
    expect(loop).toMatch(/if \(agent\.ws\.readyState === 1\)/);
    expect(loop).not.toMatch('isVisibleInScope');
    expect(loop).not.toMatch('scope');
  });

  it('F4.4 the broadcast carries the full plaintext value', () => {
    // The restriction, where it exists, is on retrieval. The payload the push
    // path emits is the same field `read()` filters.
    const handler = ws.slice(ws.indexOf('private async handleMemoryWrite'), ws.indexOf('private async handleMemoryRead'));
    expect(handler).toMatch(/value: mem\.value/);
    expect(mem).toMatch(/async read\(key: string, scope: string = 'all'\)/);
  });

  it('F4.5 the two literals that would make a session-scoped key leak are the guard\'s own vocabulary', () => {
    // Names the exact pair: a key the guard rejects on read, and the key shape
    // the guard tests against. Both exist in the same file, one layer apart.
    expect(mem).toContain("key.includes('openclaw:session:')");
    expect(ws).toContain("type: 'memory_update'");
  });
});
