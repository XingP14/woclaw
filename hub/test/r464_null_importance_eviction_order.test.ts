/**
 * R464 probe: a session importance of `null` is silently the MOST EVICTABLE
 * value in the system, and the forgetting path ranks it first.
 *
 * The shape is R458's (a clamp whose direction of travel nobody asserted),
 * found on the plane R456/R463 opened. Both of those pinned a half of the
 * forgetting path that CANNOT reach its floor; this one pins the half that
 * reaches it TOO EASILY, and does so on a live production route.
 *
 * ── The measurement, not the assumption ──
 *
 * `SessionStore.registerSession` / `updateSession` clamp importance through
 * `clamp(v, 0, 10)` = `Math.max(0, Math.min(10, v))` (session_store.ts:10).
 * That clamp is sound for finite numbers and unsound for everything else,
 * because every one of its three cases routes to an ENDPOINT rather than
 * rejecting:
 *
 *   registerSession — rest_server.ts:1106 `data.importance ?? 5.0`
 *     The `??` means `null` NEVER reaches the 5.0 default. It passes through
 *     as null, and clamp(null) is Math.max(0, Math.min(10, null)) = 0.
 *     So the default that the `??` appears to guarantee is exactly the case
 *     it does not cover.
 *
 *   updateSession — rest_server.ts:1139 passes the body straight through
 *     No default at all, so `{"importance": null}` is an ordinary request.
 *
 *   Measured, all ten shapes (register + update), against a real ClawDB:
 *     number 5/999/-999  -> 5 / 10 / 0     clamped, as intended
 *     "7"                -> 7               SQLite coerces the TEXT affinity
 *     "abc" / {}         -> 5               NaN falls back to the column DEFAULT
 *     null               -> 0               NOT 5
 *     ""                 -> 0               NOT 5
 *     true / [1] / [9]   -> 1 / 1 / 9
 *
 * ── Why 0 is the worst possible outcome ──
 *
 * Not merely "wrong value" but the one value that guarantees eviction.
 * The scheduler's floor is 3.0 and the SELECT is `importance < 3.0`, so a
 * session silently zeroed is a candidate, and the ORDER BY leads with
 * `importance * 0.5`, so 0 sorts ahead of every honestly-scored session.
 * Measured against a floor of 3.0 with a control session that genuinely
 * scored 2:
 *
 *   victim (was 8, then nulled)  imp=0   <-- evicted FIRST
 *   control-low (honestly 2)     imp=2
 *
 * A client that clears an optional field in a PUT /sessions/:id — the
 * ordinary shape of "unset this" — hands the weekly forgetting job a
 * deletion order it never asked for. And the eviction is silent: nothing in
 * the response says the field was reinterpreted.
 *
 * ── What this does NOT claim ──
 *
 * This is NOT the R456/R463 finding and the two are independent. They are
 * about opposite ends of the same floor: those say the session branch admits
 * nothing because no reader joins session_feedback (so importance never
 * moves); this says that when importance DOES move, it can move to the one
 * value that guarantees eviction. A fix for R463 would actually make this
 * WORSE, because feedback is the only lever that lowers a session, and the
 * lowering can be a silent null.
 *
 * These arms pin the truth, they do not fix it: the repair is to reject a
 * non-finite importance (or to make `??` mean what it reads like, by using
 * `typeof !== 'number'`), and that changes an accepted request into a 400.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClawDB } from '../src/db.js';
import { SessionStore } from '../src/session_store.js';

const FLOOR = 3.0; // DEFAULT_CONFIG.importanceFloor in scheduler.ts

describe('R464 — a null session importance is the most evictable value', () => {
  let dir: string;
  let db: ClawDB;
  let store: SessionStore;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'r464-'));
    db = new ClawDB(dir);
    await new Promise(r => setTimeout(r, 60));
    store = new SessionStore(db);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function register(id: string, importance: unknown) {
    return store.registerSession({
      id, agentId: 'a1', framework: 'openclaw',
      startedAt: Date.now(), transcript: '[]',
      importance, accessCount: 0, tags: [],
      extracted: false, flagged: false, createdAt: Date.now(),
    } as never);
  }

  const importanceOf = async (id: string) =>
    (await db.getSession(id))?.importance;

  // ── A. the clamp itself, isolated from any route ──────────────────────
  // Every case routes to an endpoint rather than rejecting. `null` and `""`
  // both land on 0 -- the only value that guarantees eviction -- while a
  // genuinely non-numeric value lands on the column DEFAULT 5.0. So the
  // two shapes that LOOK like "unset" are the two that evict, and the one
  // that looks most like garbage is the one that is safe.
  it('A. clamp() routes non-finite importance to 0, not to the 5.0 default', async () => {
    await register('ok', 5);
    await register('hi', 999);
    await register('lo', -999);

    expect(await importanceOf('ok')).toBe(5);   // untouched
    expect(await importanceOf('hi')).toBe(10);  // clamped at the top
    expect(await importanceOf('lo')).toBe(0);   // clamped at the bottom

    // The asymmetry: garbage gets the DEFAULT, absence gets the FLOOR.
    await register('garbage', 'abc');
    expect(await importanceOf('garbage')).toBe(5);

    await register('empty', null);
    expect(await importanceOf('empty')).toBe(0);
  });

  // ── B. the `??` at rest_server.ts:1106 does not do what it reads like ──
  // `data.importance ?? 5.0` reads as "default to 5 when absent". Measured:
  // `null` skips the `??` entirely (that is what `??` means) and reaches the
  // clamp as null, which becomes 0. So the default is guaranteed for every
  // shape EXCEPT the one a client uses to mean "I have no opinion".
  it('B. POST /sessions with importance:null stores 0, and `?? 5.0` never fires for it', async () => {
    // `undefined` — the field is genuinely absent — DOES take the default.
    await register('absent', undefined);
    expect(await importanceOf('absent')).toBe(5);

    // `null` — the field is present and null — does not.
    await register('explicit-null', null);
    expect(await importanceOf('explicit-null')).toBe(0);

    // The whole finding in one line: these two differ, and the one that
    // differs is the one that is not 5.
    expect(await importanceOf('absent')).not.toBe(await importanceOf('explicit-null'));
  });

  // ── C. the same on the UPDATE route, which has no default at all ──────
  // rest_server.ts:1139 hands the parsed body to updateSession unchanged, so
  // `{"importance": null}` is an ordinary PUT with no guard whatsoever. The
  // empty string is the same trap one keystroke away: a form that submits
  // "" for an unset numeric field.
  it('C. PUT /sessions/:id with importance:null silently zeroed a session', async () => {
    await register('victim', 8);
    expect(await importanceOf('victim')).toBe(8);

    await store.updateSession('victim', { importance: null } as never);
    expect(await importanceOf('victim')).toBe(0);

    // And the string form, which is what an HTML form sends.
    await register('victim2', 8);
    await store.updateSession('victim2', { importance: '' } as never);
    expect(await importanceOf('victim2')).toBe(0);

    // A session the caller never rescored has been made maximally evictable.
    // The response says `{"success": true}`.
  });

  // ── D. the consequence: it is not just wrong, it is FIRST ─────────────
  // This is the arm that makes the finding a defect rather than a quirk.
  // 0 < FLOOR makes it a candidate, and the ORDER BY leads with
  // `importance * 0.5`, so it sorts ahead of a session that honestly scored
  // below the floor. The forgetting job would take the nulled one first.
  it('D. a nulled session outranks an honestly-low one in the eviction order', async () => {
    await register('honest', 2.0);   // genuinely below the floor
    await register('victim', 8.0);   // healthy
    await store.updateSession('victim', { importance: null } as never);

    const { sessions } = await db.getEvictionCandidates(FLOOR, FLOOR, 100);
    const ids = sessions.map(s => s.id);

    expect(ids).toContain('honest');
    expect(ids).toContain('victim');
    // The victim was scored 8 before a single value was cleared, and is
    // evicted before the session that was always a candidate.
    expect(ids.indexOf('victim')).toBeLessThan(ids.indexOf('honest'));
  });

  // ── E. and it is silent ───────────────────────────────────────────────
  // Both REST handlers return 200/201 with `{success:true}` and no field
  // echo, so nothing in the response reports the reinterpretation. The
  // client that sent null reads back success and has no way to learn that
  // it asked for eviction rather than for a default.
  it('E. neither route reports that the importance was reinterpreted', async () => {
    await register('quiet', 8);
    // updateSession's REST wrapper answers {success:true} with no echo of the
    // stored session, so the only way to observe this is to read it back —
    // which is exactly what a client will not do.
    await store.updateSession('quiet', { importance: null } as never);

    const stored = await db.getSession('quiet');
    expect(stored?.importance).toBe(0);
    // Nothing in the stored record marks it as defaulted-vs-intentional:
    // it is indistinguishable from a session that genuinely scored 0.
    expect(stored?.importance).toBe(0);
    expect(Object.keys(stored ?? {}).filter(k => /defaul|unset|inval/i.test(k))).toHaveLength(0);
  });
});
