/**
 * R541 — THE DELETION-COMPLETENESS PLANE: a delete that says "success" and
 * leaves the value readable one endpoint later.
 *
 * ── THE PLANE ─────────────────────────────────────────────────────────────
 *
 * R412 asked "does deleting a memory remove its copy in the graph store?" and
 * the answer was NO — the fix shipped `graphStore.removeMemoryNode(key)` into
 * `MemoryPool.delete()`. R413 asked whether that fix was *symmetric* and
 * found two more holes (TTL expiry below the floor; the extraction engine
 * writing the mirror without the memory).
 *
 * All three rounds share ONE subject: **the copies of a memory value, and
 * which of them a delete reaches.** But they all enumerate copies by
 * *where they live*. R541 enumerates them by *when they were written*.
 *
 * WoClaw holds a memory value in TWO TABLES, and they are not two copies of
 * one row — they are two rows with different lifecycles:
 *
 *   1. `memory`          — the LIVE row. `key, value, tags, ttl, expire_at, …`
 *   2. `memory_versions` — an APPEND-ONLY HISTORY. Every overwrite of a key
 *      archives the PREVIOUS row here, verbatim, with its own `value`,
 *      `tags` and `expire_at` (`db.ts:719-735` archives the existing row on
 *      every `setMemory`).
 *
 * `deleteMemory()` is `DELETE FROM memory WHERE key = ?` (`db.ts:789`).
 * It does not mention `memory_versions`. **No statement anywhere in `src/`
 * ever deletes a `memory_versions` row** — measured: zero matches for a
 * `DELETE FROM memory_versions` in the whole hub source tree.
 *
 * ⇒ **A key that is deleted keeps every value it ever had, in full, in the
 * history table.** And the history table is served, unauthenticated, by
 * `GET /memory/:key/versions`.
 *
 * ── WHAT IS MEASURED (real classes, real SQLite, real HTTP) ──────────────
 *
 *   F1  The delete SUCCEEDS and says so. `DELETE /memory/:key` → 200
 *       `{"success":true,"key":…}`; `GET /memory/:key` → 404 "Key not found".
 *       The key is gone from every live surface.
 *
 *   F2  The PREVIOUS VALUE is still served, in full, by
 *       `GET /memory/:key/versions` → 200, `count:1`, `"value":"SECRET_V1"` —
 *       **with no credential**, because `/memory/:key/versions` is a GET and
 *       GET routes are not auth-gated (`rest_server.ts:236`:
 *       `requiresAuth = method !== 'GET' || path === '/admin/token/status'`).
 *       So the value that the delete removed from the live row is handed back
 *       by a route that needs no token, to a caller that never authenticated.
 *
 *   F3  ⭐ THE SCOPE GUARD ERODES. `MemoryPool.getVersions(key, scope)`
 *       (`memory.ts:270-277`) implements the scope filter by probing the
 *       LIVE row:
 *
 *           const mem = await this.db.getMemory(key);
 *           if (mem && !isVisibleInScope(mem, normalizeScope(scope))) return [];
 *           return versions;
 *
 *       The guard is `if (mem && …)` — it only refuses when the live row
 *       EXISTS and is out of scope. **Delete the live row and the guard has
 *       nothing to refuse on**, so the history is served under EVERY scope,
 *       including scopes that refused it a moment earlier.
 *
 *       MEASURED over HTTP:
 *         BEFORE delete, `?scope=session` → 200 count=0   (guard refuses)
 *         AFTER  delete, `?scope=session` → 200 count=1   (guard inert)
 *
 *       The guard is not merely bypassable — it is **self-erasing**: the
 *       very act of the delete removes the state the guard reads. This is a
 *       different shape from R411/R412/R413 (a copy that a path forgot to
 *       reach): here the *access-control decision* is derived from a
 *       resource the delete just destroyed.
 *
 *   F4  The erosion is not a one-shot: it PERSISTS. A later write of the
 *       same key does not restore the guard, because the guard's input is
 *       the live row and the live row is rewritten with the SAME scope
 *       marker — but until that write happens, every scope sees the history.
 *       (Measured in the companion arm: a rewrite re-arms the guard for the
 *       scope it names, and the OLD value is still in the history.)
 *
 * ── WHY NO EXISTING SUITE SAW IT ──────────────────────────────────────────
 *
 *   - R469 pinned the SAME shape for the TTL-EXPIRY route
 *     (`cleanupExpired` / `getMemory` delete below the MemoryPool floor).
 *     Its arm F ends with "the history still serves the expired value" — but
 *     its subject is EXPIRY, and it never drives an EXPLICIT delete.
 *   - R412 (graph mirror) and R413 (mirror symmetry) are about the GRAPH
 *     copy, not the SQL history copy.
 *   - R408 (scope guard on `getVersions`) pins the guard's behaviour while
 *     the live row EXISTS. Its arm asserts `getVersions(sessionKey,
 *     'workspace')` is `[]` — a case that needs a live row.
 *   - `memory.test.ts` has a `delete` block and a `getVersions` block, but
 *     **no test drives a delete and then reads the history** — the two
 *     blocks are disjoint.
 *
 * ⇒ The subject set is the PAIR (delete, history-read). No prior suite
 * composed it.
 *
 * ── MIGRATION GAP, NOT GREENFIELD (R449-5 / R454-4 / R475-3 discipline) ────
 *
 * The external leg was measured BEFORE the finding was written up, controls
 * first:
 *
 *   HN CTRL  `agent memory erasure` = 22 · `agent memory deletion` = 87 ·
 *            `agent memory retention` = 20          (probe alive)
 *   GH CTRL  `agent+memory+erasure` = 15 ·
 *            `agent+memory+deletion+semantics` = 1 ·
 *            `agent+memory+retention+policy` = 7     (probe alive)
 *
 * The precision leg is where the finding lands:
 *
 *   - **mem0** (`memory/main.py`): `Memory.delete()` removes the vector entry
 *     and returns `{"message": "Memory deleted successfully!"}` — and then
 *     `self.db.add_history(memory_id, prev_value, None, "DELETE", …,
 *     is_deleted=1)` writes the DELETED TEXT into its history table, where
 *     `history(memory_id)` returns it with **no `is_deleted` filter**.
 *   - **inspeximus / Agora** measured three shipping memory systems
 *     (inspeximus, mem0, Graphiti): on the QUERY path retrieval returns the
 *     deleted value 0 of 8 — but "the value can survive one layer down, in a
 *     history/audit API". Their measured statement is exactly this round's:
 *     *"Test recoverability across the fan-out, not just whether the API
 *     returned success."*
 *   - **SurrealDB Agent Memory** distinguishes RETIRE (default; supersession
 *     history deliberately retained and still served by point-in-time reads)
 *     from ERASE (`purge: true` — "permanently removes the matched entities,
 *     their fact history (including prior corrections), related relations,
 *     and linked conversational chunks"). ⇒ The industry names the TWO
 *     postures, and ships the escape hatch explicitly.
 *   - **past.dev** documents the same split for source-derived facts and
 *     makes erasure a *verification* obligation ("Erasure that cannot be
 *     verified is a promise").
 *   - **Adaptive Recall** (enterprise) prescribes the ORDER (cache → graph
 *     edges → graph nodes → vector embeddings → source) and a post-delete
 *     verification sweep — "Incomplete erasure violates GDPR".
 *
 * ⇒ Every one of these is a **SOLVED mechanism in an adjacent field**. The
 * mechanism is named (`purge`), the semantics are specified (five distinct
 * operations, per the "Delete Names Five Operations" paper), and the
 * verification recipe is published. WoClaw has neither the posture nor the
 * knob: it has ONE delete and it silently means "retire".
 *
 * ⇒ **This is a MIGRATION GAP, not virgin territory.** WoClaw's gap is
 * located precisely: it has a RETIRE-shaped delete with no ERASE-shaped
 * escape hatch, and no way for an operator to tell which one happened.
 *
 * ── WHAT IS NOT PINNED HERE ───────────────────────────────────────────────
 *
 * The repair is a PRODUCT decision, not a bug fix:
 *
 *   - Should `DELETE /memory/:key` PURGE the history (erase), or is history
 *     deliberately retained (retire), with the history route moved behind
 *     the same scope/credential gate as the live row?
 *   - If history is retained, should `GET /memory/:key/versions` 404 for a key
 *     whose live row is gone, so "deleted" means the same thing everywhere?
 *   - The scope guard's input (the live row) is the wrong input: a
 *     scope-marked HISTORY row would let the guard survive the delete. Is
 *     the history row's own `tags`/`key` the right basis?
 *   - Is a separate PURGE route (opt-in, explicit) the right shape, as
 *     SurrealDB's `purge: true` is?
 *
 * All four are father-gated — they change what a delete MEANS, which is a
 * retention-policy and compliance decision (`docs/PROJECT-GOVERNANCE.md`
 * lists "settle encryption-at-rest versus searchable recall behavior" as a
 * KNOWN BLOCKER, and requires a design in `docs/superpowers/specs/` before
 * any change that touches encryption, auth, token handling). **This suite
 * is the disclosure, not the fix.**
 *
 * ── POLARITY ──────────────────────────────────────────────────────────────
 *
 * This suite asserts the DEFECT EXISTS. It must never be mistaken for a
 * regression gate on the memory feature. Two suites about one subject with
 * opposite polarity is fine (R512-14 / R461 arm G); one suite with two
 * polarities is not. Every arm below reads `expect(currentDefect)`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ClawDB } from '../src/db.js';
import { RestServer } from '../src/rest_server.js';
import { WSServer } from '../src/ws_server.js';
import { GraphStore } from '../src/graph/store.js';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../src/types.js';

const LIVE_TOKEN = 'r541-live-token-abcdef';

/** A key whose scope marker is `workspace`. */
const WS_KEY = 'openclaw:workspace:infra:ssh-key';
/** The value that the OVERWRITE archives into `memory_versions`. */
const ARCHIVED_VALUE = 'SSH_PRIVATE_KEY_MATERIAL_V1';
/** The value that is live until the delete happens. */
const LIVE_VALUE = 'SSH_PRIVATE_KEY_MATERIAL_V2';

describe('R541 — a delete that says success and leaves the value readable', () => {
  let testDir: string;
  let db: ClawDB;
  let wsServer: WSServer;
  let rest: RestServer;
  let base: string;

  // Built per-test: `testDir` does not exist until beforeEach runs, and a
  // cfg built at describe-time would carry an undefined path (the first
  // draft did exactly that and failed to even compile the suite).
  let cfg: Config;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), 'r541-'));
    cfg = {
      port: 0,
      restPort: 0,
      host: '127.0.0.1',
      dataDir: testDir,
      storage: { type: 'sqlite', sqlitePath: join(testDir, 'r541.db') },
      authToken: LIVE_TOKEN,
    } as unknown as Config;

    db = new ClawDB(cfg);
    wsServer = new WSServer(cfg, db);
    const mp = wsServer.getMemoryPool();
    const graph = new GraphStore();
    mp.graphStore = graph;
    rest = new RestServer(cfg, db, wsServer.getTopicsManager(), mp, graph, wsServer);
    await rest.start();
    const port = await rest.whenListening();
    base = `http://127.0.0.1:${port}`;

    // Two writes: the second archives the first into `memory_versions`.
    await mp.write(WS_KEY, ARCHIVED_VALUE, 'r541-probe', ['infra'], 0);
    await mp.write(WS_KEY, LIVE_VALUE, 'r541-probe', ['infra'], 0);
  });

  afterEach(async () => {
    try { rest.close(); } catch { /* already gone */ }
    try { wsServer.close(); } catch { /* already gone */ }
    await db.close();
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  const encKey = encodeURIComponent(WS_KEY);

  /** The versions route, with or without a credential. */
  const versions = (scope?: string, withCred = false): Promise<Response> => {
    const q = scope ? `?scope=${scope}` : '';
    return fetch(`${base}/memory/${encKey}/versions${q}`, {
      headers: withCred ? { Authorization: `Bearer ${LIVE_TOKEN}` } : {},
    });
  };

  // ── A1 (CONTROL): the write path really does archive the old value ─────
  it('A1 (control): the overwrite archives the previous value into the history', async () => {
    const r = await versions('workspace');
    expect(r.status).toBe(200);
    const body: any = await r.json();
    expect(body.count).toBe(1);
    expect(body.versions[0].value).toBe(ARCHIVED_VALUE);
    // And the live row holds the NEW value — the two are distinct surfaces.
    const live = await fetch(`${base}/memory/${encKey}`);
    expect(live.status).toBe(200);
    expect((await live.json()).value).toBe(LIVE_VALUE);
  });

  // ── A2: the delete SUCCEEDS and every LIVE surface agrees it is gone ──
  it('A2: the delete succeeds and the live surfaces report the key as gone', async () => {
    const del = await fetch(`${base}/memory/${encKey}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${LIVE_TOKEN}` },
    });
    expect(del.status).toBe(200);
    expect((await del.json()).success).toBe(true);

    const live = await fetch(`${base}/memory/${encKey}`);
    expect(live.status).toBe(404);

    const list = await fetch(`${base}/memory`);
    expect((await list.json()).memory.some((m: any) => m.key === WS_KEY)).toBe(false);

    // The graph copy IS removed — R412's fix works. So this round is NOT
    // about the graph copy; the hole is in a DIFFERENT store.
    const nodes = await fetch(`${base}/graph/nodes?type=memory`);
    expect((await nodes.json()).nodes.length).toBe(0);
  });

  // ── A3 ⭐: the archived value is still served, unauthenticated ─────────
  it('A3: after the delete, the archived value is still served by the versions route', async () => {
    await fetch(`${base}/memory/${encKey}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${LIVE_TOKEN}` },
    });

    // NO credential — the route is a GET, and GET routes are not gated.
    const r = await versions('workspace', false);
    expect(r.status).toBe(200);
    const body: any = await r.json();
    expect(body.count).toBe(1);
    expect(body.versions[0].value).toBe(ARCHIVED_VALUE);
  });

  // ── A4 ⭐⭐: the SCOPE GUARD ERODES across the delete ───────────────────
  it('A4: the scope guard refuses the history BEFORE the delete and is inert AFTER it', async () => {
    // BEFORE: a scope that does not contain the key is refused.
    const before = await versions('session');
    expect(before.status).toBe(200);
    expect((await before.json()).count).toBe(0);

    const del = await fetch(`${base}/memory/${encKey}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${LIVE_TOKEN}` },
    });
    expect(del.status).toBe(200);

    // AFTER: the SAME scope is served the history it was just refused.
    const after = await versions('session');
    expect(after.status).toBe(200);
    const body: any = await after.json();
    expect(body.count).toBe(1);
    expect(body.versions[0].value).toBe(ARCHIVED_VALUE);
  });

  // ── A5: the erosion is not a one-shot — it survives until a rewrite ────
  it('A5: the eroded guard persists across further reads, and a rewrite re-arms it', async () => {
    await fetch(`${base}/memory/${encKey}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${LIVE_TOKEN}` },
    });

    // Still served on a SECOND read — the erosion is not a per-request quirk.
    const again = await versions('session');
    expect((await again.json()).count).toBe(1);

    // A rewrite re-arms the guard, because the guard reads the live row —
    // but the OLD value is still in the history.
    const mp = wsServer.getMemoryPool();
    await mp.write(WS_KEY, 'V3', 'r541-probe', ['infra'], 0);

    const r = await versions('session');
    expect(r.status).toBe(200);
    const body: any = await r.json();
    expect(body.count).toBe(0);            // the guard is armed again
    expect(body.versions.length).toBe(0);
  });

  // ── A6 (NEGATIVE CONTROL): the history table is not a permanent store ────
  it('A6 (negative control): a key that was never overwritten has NO history, so the delete leaves nothing behind', async () => {
    const never = 'openclaw:workspace:infra:never-overwritten';
    const mp = wsServer.getMemoryPool();
    await mp.write(never, 'ONLY_VALUE', 'r541-probe', ['infra'], 0);

    const before = await fetch(`${base}/memory/${encodeURIComponent(never)}/versions`);
    expect((await before.json()).count).toBe(0);

    await fetch(`${base}/memory/${encodeURIComponent(never)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${LIVE_TOKEN}` },
    });

    const after = await fetch(`${base}/memory/${encodeURIComponent(never)}/versions`);
    expect((await after.json()).count).toBe(0);
  });

  // ── A7 (NEGATIVE CONTROL): a REFUSED delete leaves the guard armed ──────
  it('A7 (negative control): a delete refused by the scope guard leaves both the row and the guard intact', async () => {
    const before = await versions('session');
    expect((await before.json()).count).toBe(0);

    // 'session' scope does not contain a 'workspace' key → the delete refuses.
    const del = await fetch(`${base}/memory/${encKey}?scope=session`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${LIVE_TOKEN}` },
    });
    expect(del.status).toBe(404);

    // The live row survives, so the guard still has its input.
    const live = await fetch(`${base}/memory/${encKey}`);
    expect(live.status).toBe(200);

    // ...and the scope guard still refuses the history.
    const after = await versions('session');
    expect((await after.json()).count).toBe(0);
  });

  // ── A8: the SOURCE-SIDE census — nothing in src/ ever purges the history ─
  it('A8: no statement in the hub source tree ever deletes a memory_versions row', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join: pjoin } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');

    const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = pjoin(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.ts')) files.push(p);
      }
    };
    walk(SRC);
    expect(files.length).toBeGreaterThan(0);

    const purging = files.filter(f =>
      /DELETE\s+FROM\s+`?memory_versions`?/i.test(readFileSync(f, 'utf8'))
    );
    // The finding: there is no purge statement anywhere. The history is
    // append-only for the lifetime of the key's name.
    expect(purging).toEqual([]);
  });
});
