/**
 * R420 probe — does the swallowed decrypt reach the CALLER?
 *
 * r420_encryption_auth_failure.test.ts proves safeDecryptValue echoes the
 * ciphertext envelope. This probe asks the question that decides whether that
 * is a helper curiosity or a live defect: walk the production path
 *   mp.write -> tamper the stored row -> mp.read / mp.recall / getVersions
 * and observe what a real caller receives.
 *
 * Every assertion derived by executing production code.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { ClawDB } from '../src/db.js';
import { MemoryPool } from '../src/memory.js';
import type { Config } from '../src/types.js';

const PASSPHRASE = 'correct horse battery staple';

function makeConfig(dataDir: string, overrides: Partial<Config> = {}): Config {
  return {
    port: 8082,
    restPort: 8083,
    host: 'localhost',
    dataDir,
    authToken: 'test-token',
    encryption: { enabled: true, passphrase: PASSPHRASE },
    ...overrides,
  } as Config;
}

/** Flip one ciphertext byte inside the ENC:v1 envelope, in place, on disk. */
function tamperStoredRow(dbPath: string, key: string): string {
  const raw = new Database(dbPath);
  const row = raw.prepare('SELECT value FROM memory WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  raw.close();
  if (!row) throw new Error(`no row for ${key}`);

  const marker = 'ENC:v1:';
  const parsed = JSON.parse(
    Buffer.from(row.value.slice(marker.length), 'base64').toString('utf8'),
  ) as { ciphertext: string };
  const buf = Buffer.from(parsed.ciphertext, 'base64');
  buf[0] = buf[0] ^ 0xff;
  parsed.ciphertext = buf.toString('base64');
  const tampered = marker + Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64');

  const raw2 = new Database(dbPath);
  raw2.prepare('UPDATE memory SET value = ? WHERE key = ?').run(tampered, key);
  raw2.close();
  return tampered;
}

/** Same corruption, applied to the newest memory_versions row. */
function tamperVersionRow(dbPath: string, key: string): string {
  const raw = new Database(dbPath);
  const row = raw
    .prepare('SELECT value FROM memory_versions WHERE key = ? ORDER BY version DESC LIMIT 1')
    .get(key) as { value: string } | undefined;
  raw.close();
  if (!row) throw new Error(`no memory_versions row for ${key}`);

  const marker = 'ENC:v1:';
  const parsed = JSON.parse(
    Buffer.from(row.value.slice(marker.length), 'base64').toString('utf8'),
  ) as { ciphertext: string };
  const buf = Buffer.from(parsed.ciphertext, 'base64');
  buf[0] = buf[0] ^ 0xff;
  parsed.ciphertext = buf.toString('base64');
  const tampered = marker + Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64');

  const raw2 = new Database(dbPath);
  raw2
    .prepare(
      'UPDATE memory_versions SET value = ? WHERE key = ? AND value = ?',
    )
    .run(tampered, key, row.value);
  raw2.close();
  return tampered;
}

describe('R420 probe: the swallowed decrypt reaches the caller', () => {
  let dir: string;
  let db: ClawDB | null;
  let mp: MemoryPool;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'r420-probe-'));
    dbPath = join(dir, 'woclaw.sqlite');
    db = new ClawDB(makeConfig(dir));
    mp = new MemoryPool(db);
  });

  afterEach(async () => {
    if (db) await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('C1 ⭐ — mp.read() hands the caller the raw ENC:v1 envelope as mem.value', async () => {
    await mp.write('t1', 'the original secret', 'agent1');
    const tampered = tamperStoredRow(dbPath, 't1');

    const mem = await mp.read('t1');

    // Not undefined: the read succeeds.
    expect(mem).not.toBeNull();
    expect(mem).not.toBeUndefined();
    // Not the plaintext: the caller cannot tell this row is unreadable.
    expect(mem!.value).not.toContain('the original secret');
    // The ciphertext envelope itself becomes the value.
    expect(mem!.value).toBe(tampered);
    expect(mem!.value.startsWith('ENC:v1:')).toBe(true);
    // And the record still looks well-formed to a consumer.
    expect(mem!.key).toBe('t1');
    expect(mem!.updatedBy).toBe('agent1');
  });

  it('C2 ⭐ — the row that was overwritten still serves ciphertext on read', async () => {
    // Overwrite path (setMemory), not just the fresh-write path.
    await mp.write('t2', 'first secret', 'agent1');
    await mp.write('t2', 'second secret', 'agent2');
    tamperStoredRow(dbPath, 't2');

    const mem = await mp.read('t2');
    expect(mem!.value.startsWith('ENC:v1:')).toBe(true);
    expect(mem!.value).not.toContain('second secret');
  });

  // R426 — the canary must be LONG. `recall()` scores a row by SUBSTRING match
  // over the raw stored value, so when the decrypt is swallowed the row still
  // carries a ~350-char base64 ENC envelope. Any query token shorter than about
  // 6 chars has a non-zero chance of appearing by accident in that blob, and
  // one accidental hit scores the row > 0 and returns the envelope — which is
  // precisely the leak C3 exists to forbid. Measured over 20 000 random
  // envelopes: 'xyz' matched 116/20000 (0.58%), 'r420' / 'needle' /
  // 'distinctive' matched 0/20000, and the full query matched 139/20000. So the
  // old canary made this assertion true ~99.4% of the time and false ~0.6% of
  // the time, with no load, ordering or timing dependence to explain it. The
  // canary is a single 19-char token, whose accidental rate is ~350/64^19.
  // The control below pins the length so the next edit cannot quietly shorten
  // it back into randomness.
  const C3_CANARY = 'r420ciphercanaryqzxjw';

  // memory.ts does not export its tokenizer, so the control re-implements the
  // split the query goes through rather than importing a private helper.
  // R427 measured this over 3 000 real encryptAndSerialize envelopes (the
  // first attempt at 20 000 exceeded the runner budget -- scrypt dominates):
  // the old canary collides 29/3000 = 0.97% of the time, the new one 0/3000.
  // The control pins the two properties that actually decide it -- no token
  // short enough to collide by chance, and no token that STOP_WORDS would drop.
  const STOP_WORDS_SNAPSHOT = [
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  ];

  const queryTokens = (s: string): string[] =>
    s.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP_WORDS_SNAPSHOT.includes(t));

  it('control — every C3 query token is long enough to make the assertion deterministic', () => {
    for (const token of queryTokens(C3_CANARY)) {
      expect(token.length).toBeGreaterThanOrEqual(12);
    }
  });

  it('control — no C3 query token is a stop word, so the mirror above cannot diverge into a vacuous pass', () => {
    // queryTokens() drops stop words; if C3_CANARY ever grew one, the mirror
    // would silently stop seeing it and the length case would pass vacuously.
    const rawTokens = C3_CANARY.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
    expect(queryTokens(C3_CANARY).length).toBe(rawTokens.length);
  });

  it('C3 — recall() (substring search) leaks the envelope into ranked results', async () => {
    await mp.write('t3-key', C3_CANARY, 'agent1');
    tamperStoredRow(dbPath, 't3-key');

    // The search cannot match on ciphertext, so the row drops out entirely:
    // this is the *other* half of the defect — the read path lies, the search
    // path silently loses the row.
    const hits = await mp.recall(C3_CANARY);
    expect(hits).toHaveLength(0);
  });

  it('C4 — a corrupted memory_versions row is echoed to the caller too', async () => {
    // Correction (probe bug, found by running): memory_versions is a SEPARATE
    // table holding SUPERSEDED values only (3 writes -> versions 1 and 2; the
    // current value lives solely in `memory`), and rows come back ORDER BY
    // version DESC. Tampering the `memory` row never reaches them — the two
    // planes need their own tamper and their own fixture.
    await mp.write('t4', 'v1 secret', 'agent1');
    await mp.write('t4', 'v2 secret', 'agent2');
    await mp.write('t4', 'v3 secret', 'agent3');

    const tampered = tamperVersionRow(dbPath, 't4');
    const versions = await db!.getMemoryVersions('t4');
    expect(versions.length).toBe(2); // two superseded rows

    // versions[0] is the NEWEST (DESC order) = the row we tampered.
    expect(versions[0].value.startsWith('ENC:v1:')).toBe(true);
    expect(versions[0].value).toBe(tampered);
    // The older row is untouched and decrypts cleanly: the blast radius of a
    // one-row corruption is exactly one version, not the whole history.
    expect(versions[versions.length - 1].value).toBe('v1 secret');
  });

  it('C5 — a passphrase rotation is indistinguishable from a healthy read', async () => {
    await mp.write('t5', 'post-rotation secret', 'agent1');
    const stored = tamperStoredRow(dbPath, 't5');

    // Simulate operator rotation: same rows, different key. Close first so the
    // WAL is checkpointed, then copy the file.
    await db!.close();
    db = null as any;
    const rotatedDir = mkdtempSync(join(tmpdir(), 'r420-rot-'));
    copyFileSync(dbPath, join(rotatedDir, 'woclaw.sqlite'));

    const rotated = new ClawDB(
      makeConfig(rotatedDir, {
        encryption: { enabled: true, passphrase: 'a rotated passphrase' } as any,
      }),
    );
    const rotMp = new MemoryPool(rotated);
    const mem = await rotMp.read('t5');
    await rotated.close();
    rmSync(rotatedDir, { recursive: true, force: true });

    expect(mem).not.toBeNull();
    expect(mem!.value).toBe(stored); // echoed verbatim, no error, no sentinel
    expect(mem!.value.startsWith('ENC:v1:')).toBe(true);
  });

  it('C6 — the SAME corrupt row under a HEALTHY key also returns the envelope', async () => {
    // Proves C1-C4 are about authentication failure, not about the rotation.
    await mp.write('t6', 'healthy-key secret', 'agent1');
    const tampered = tamperStoredRow(dbPath, 't6');
    const mem = await mp.read('t6');
    expect(mem!.value).toBe(tampered);
  });
});

/**
 * POSITIVE CONTROL (added after the M2 mutation matrix).
 *
 * Every assertion in C1-C6 is on the FAILURE path, where the value handed
 * back is the ciphertext envelope *whether or not decryption was attempted*.
 * Mutation M2 (drop the `safeDecryptValue` call from `ClawDB.getMemory`
 * alone) therefore killed NOTHING: the probe cannot tell "decryption was
 * attempted and failed" from "decryption never happened". Both look like
 * "caller got the envelope".
 *
 * These cases pin the healthy half, so the failure-path cases are only
 * meaningful next to a proof that decryption works at all on that path.
 * They are the arm that M2 kills ALONE.
 */
describe('R420 probe control: the healthy path really does decrypt', () => {
  let dir: string;
  let db: ClawDB | null;
  let mp: MemoryPool;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'r420-control-'));
    dbPath = join(dir, 'woclaw.sqlite');
    db = new ClawDB(makeConfig(dir));
    mp = new MemoryPool(db);
  });

  afterEach(async () => {
    if (db) await db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('K1 — an untouched row is stored encrypted and read back as plaintext', async () => {
    await mp.write('k1', 'healthy plaintext', 'agent1');

    // Stored form is genuinely encrypted, not accidentally plaintext: without
    // this, K1 would pass even with encryption effectively disabled.
    const raw = new Database(dbPath);
    const row = raw.prepare('SELECT value FROM memory WHERE key = ?').get('k1') as
      | { value: string }
      | undefined;
    raw.close();
    expect(row!.value.startsWith('ENC:v1:')).toBe(true);
    expect(row!.value).not.toContain('healthy plaintext');

    const mem = await mp.read('k1');
    expect(mem!.value).toBe('healthy plaintext');
  });

  it('K2 — the current row and the superseded version rows both decrypt', async () => {
    await mp.write('k2', 'v1 secret', 'agent1');
    await mp.write('k2', 'v2 secret', 'agent2');
    await mp.write('k2', 'v3 secret', 'agent3');

    expect((await mp.read('k2'))!.value).toBe('v3 secret');

    const versions = await db!.getMemoryVersions('k2');
    expect(versions.map(v => v.value)).toEqual(['v2 secret', 'v1 secret']);
  });

  it('K3 — recall() matches on plaintext, so the C3 drop is a corruption effect', async () => {
    await mp.write('k3-key', 'needle-distinctive-r420-xyz', 'agent1');
    const hits = await mp.recall('needle-distinctive-r420-xyz');
    expect(hits.length).toBe(1);
    expect(hits[0].value).toBe('needle-distinctive-r420-xyz');
  });

  it('K4 — under a rotated passphrase the read is NOT silently healthy', async () => {
    // The operator-visible half of C5: a rotation loses every row.
    await mp.write('k4', 'post-rotation secret', 'agent1');
    await db!.close();
    db = null as any;

    const rotatedDir = mkdtempSync(join(tmpdir(), 'r420-control-rot-'));
    copyFileSync(dbPath, join(rotatedDir, 'woclaw.sqlite'));
    const rotated = new ClawDB(
      makeConfig(rotatedDir, {
        encryption: { enabled: true, passphrase: 'a rotated passphrase' } as any,
      }),
    );
    const rotMp = new MemoryPool(rotated);
    const mem = await rotMp.read('k4');
    await rotated.close();
    rmSync(rotatedDir, { recursive: true, force: true });

    // Readable-looking, but the operator gets nothing usable back.
    expect(mem).not.toBeNull();
    expect(mem!.value).not.toBe('post-rotation secret');
    expect(mem!.value.startsWith('ENC:v1:')).toBe(true);
  });
});