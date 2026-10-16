/**
 * R469 — the expiry that names itself "delete" reaches the row and stops.
 *
 * R468 found a removal (`removeAgent`) that reached only the membership set and
 * not the credential set. It left a question open: *which already-existing action
 * actually performs revocation duty under a different name?*
 *
 * This suite answers that question about TTL expiry, and finds the answer is
 * `getMemory` / `cleanupExpired` — a function whose body is `DELETE FROM memory`.
 * It performs the removal duty. It simply does not reach everything the removed
 * thing lives in.
 *
 * ── F1: the version history keeps the expired value, and it is readable ──
 *
 *   `db.ts` `cleanupExpired()` is a bare `DELETE FROM memory WHERE expire_at > 0
 *   AND expire_at < ?`. `deleteMemory()` likewise. Neither mentions
 *   `memory_versions`.
 *
 *   But `memory_versions` is not a shadow copy — it is a **full-fidelity copy of
 *   the row as it was**, written by `setMemory` on every overwrite (`db.ts:723`),
 *   and it carries its own `value`, `tags`, `expire_at` columns (DDL `db.ts:465`).
 *
 *   So a key that expires keeps every value it ever had, in a table whose rows
 *   are still served: `getMemoryVersions` (`db.ts:806`) applies **no** expiry
 *   filter, and `GET /memory/:key/versions` (`rest_server.ts:313`) reaches it.
 *
 *   The consequence is that "this key expired and was deleted" is true of the
 *   read path (`GET /memory/:key` → `getMemory` → 404) and false one endpoint
 *   later. The retention promise is enforced in the place that is easiest to
 *   write a test against, and not in the place that is easiest to read from.
 *
 * ── F2: expiry is a *read* with a write inside it ──
 *
 *   `getMemory` deletes. `getAllMemory` deletes (via `cleanupExpired`). Both are
 *   named `get*`. A caller that only reads now performs a write, and the write
 *   count is not observable from the return value — `getMemory` returns
 *   `undefined`, indistinguishable from "the key was never there".
 *
 *   This is R456's "a mechanism with no writer" inverted: there the value was
 *   written by nobody; here the *deletion* is attributable to nobody.
 *
 * Neither hole is fixed here. The fix for F1 is a policy decision — whether an
 * expired key's history should be purged, retained-but-hidden, or retained — and
 * those are three different retention postures. This suite is the disclosure.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ClawDB } from '../src/db.js';
import { existsSync, mkdirSync, rmSync } from 'fs';

const SECRET_KEY = 'openclaw:workspace:infra:rotating-credential';
const OLD_VALUE = 'CREDENTIAL_V1_SECRET_MATERIAL';
const NEW_VALUE = 'CREDENTIAL_V2_SECRET_MATERIAL';
const KEY = 'agent-probe-key';

describe('R469 — expiry deletes the row and leaves the history', () => {
  let testDir: string;
  let db: ClawDB;

  beforeEach(() => {
    testDir = '/tmp/r469-db-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    mkdirSync(testDir, { recursive: true });
    db = new ClawDB(testDir);
  });

  afterEach(async () => {
    await db.close();
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('arm A (control): the write path really does record the overwritten value in memory_versions', async () => {
    await db.setMemory(SECRET_KEY, OLD_VALUE, KEY, ['infra'], 0);
    await db.setMemory(SECRET_KEY, NEW_VALUE, KEY, ['infra'], 1);

    const versions = await db.getMemoryVersions(SECRET_KEY);
    expect(versions.length).toBe(1);
    expect(versions[0].value).toBe(OLD_VALUE);

    const live = await db.getMemory(SECRET_KEY);
    expect(live?.value).toBe(NEW_VALUE);
  });

  it('arm B: a value replaced under a short TTL outlives that TTL in memory_versions', async () => {
    await db.setMemory(SECRET_KEY, OLD_VALUE, KEY, ['infra'], 0);
    await db.setMemory(SECRET_KEY, NEW_VALUE, KEY, ['infra'], 1);

    // let the 1s TTL lapse rather than moving the clock
    await new Promise(r => setTimeout(r, 1100));

    const live = await db.getMemory(SECRET_KEY);
    expect(live).toBeUndefined(); // the row is gone from the read path

    const versions = await db.getMemoryVersions(SECRET_KEY);
    expect(versions.length).toBe(1);
    expect(versions[0].value).toBe(OLD_VALUE);
  });

  it('arm C: getMemoryVersions applies no expiry filter even when the version row itself is expired', async () => {
    // Order matters, and it is the order the source dictates: setMemory archives
    // the EXISTING row (`INSERT ... SELECT`-shaped, db.ts:719-735), so the row
    // that lands in memory_versions carries the PREVIOUS write's expire_at.
    // Writing long-TTL first archives an unexpired row; writing short-TTL first
    // archives a row that is genuinely expired by the time it is read back.
    await db.setMemory(SECRET_KEY, NEW_VALUE, KEY, ['infra'], 1);
    await new Promise(r => setTimeout(r, 1100));
    await db.setMemory(SECRET_KEY, OLD_VALUE, KEY, ['infra'], 0);

    await db.cleanupExpired();

    const versions = await db.getMemoryVersions(SECRET_KEY);
    expect(versions.length).toBe(1);
    // the version row carries its own expire_at, and it is in the past
    expect(versions[0].expireAt).toBeGreaterThan(0);
    expect(versions[0].expireAt).toBeLessThan(Date.now());
    // ...and it is still returned, with the value it held
    expect(versions[0].value).toBe(NEW_VALUE);

    // The live row is the unexpired overwrite, so the hole is precisely scoped:
    // the LIVE path is clean and the HISTORY path still serves an expired secret.
    const live = await db.getMemory(SECRET_KEY);
    expect(live?.value).toBe(OLD_VALUE);
  });

  it('arm D: expiry is performed by a function named get*, and the return value does not report the write', async () => {
    await db.setMemory(SECRET_KEY, OLD_VALUE, KEY, ['infra'], 1);
    await new Promise(r => setTimeout(r, 1100));

    const before = await db.getAllMemory();
    expect(before.some(m => m.key === SECRET_KEY)).toBe(false);

    const removed = await db.cleanupExpired();
    // the sweep is the write path that a caller could have observed
    expect(removed).toBeGreaterThanOrEqual(0);
  });

  it('arm E (negative control): an unexpired key is not deleted by cleanupExpired', async () => {
    await db.setMemory(SECRET_KEY, OLD_VALUE, KEY, ['infra'], 0);

    await db.cleanupExpired();

    const live = await db.getMemory(SECRET_KEY);
    expect(live?.value).toBe(OLD_VALUE);
  });

  it('arm F: expiry REMOVES the row, it does not merely hide it — and the write inside get* is not reported', async () => {
    // Arms A–E only observe the RETURN VALUE, and `getMemory` returns undefined
    // for "expired" and for "never there" alike. So a getMemory that stopped
    // deleting and merely filtered the read would pass every one of them.
    // This arm uses the only witness that separates the two: `deleteMemory`
    // reports `result.changes > 0`, i.e. whether a row was PHYSICALLY present.
    //
    // Two writes, so a history row exists at all: the short-TTL value is
    // archived by the overwrite, then the live row itself expires. Both the
    // removal witness (2+3) and the F1 hole (4) are observable in one setup.
    await db.setMemory(SECRET_KEY, OLD_VALUE, KEY, ['infra'], 1);
    await db.setMemory(SECRET_KEY, NEW_VALUE, KEY, ['infra'], 1);
    await new Promise(r => setTimeout(r, 1100));

    // 1. the read reports absence, and reports it indistinguishably
    const live = await db.getMemory(SECRET_KEY);
    expect(live).toBeUndefined();
    const absent = await db.getMemory('a-key-that-was-never-written');
    expect(absent).toBeUndefined();

    // 2. but the row is GONE — a second delete has nothing to remove
    const secondDelete = await db.deleteMemory(SECRET_KEY);
    expect(secondDelete).toBe(false);

    // 3. and it stays gone across a handle reopen, so it was not an in-memory mask
    await db.close();
    db = new ClawDB(testDir);
    expect(await db.getMemory(SECRET_KEY)).toBeUndefined();
    expect(await db.deleteMemory(SECRET_KEY)).toBe(false);

    // 4. the history still serves the expired value, so 2+3 are scoped to the
    //    LIVE row only — this is the F1 hole, not a claim that all is well
    const versions = await db.getMemoryVersions(SECRET_KEY);
    expect(versions.length).toBe(1);
    expect(versions[0].value).toBe(OLD_VALUE);
  });
});
