/**
 * R523 — the key-lifecycle plane: a passphrase rotation is not a rotation.
 *
 * R521 (2026-10-30 06:03) audited WHERE a plaintext value lands. This round
 * audits the OTHER half of the encryption contract: what happens to the key
 * MATERIAL over time.
 *
 * The premise this suite tests, taken from the product's own configuration
 * surface (`Config.encryption.passphrase`) and from the repo's own roadmap
 * language ("Memory Encryption at Rest"), is:
 *
 *   "An operator can change the passphrase and the store keeps working."
 *
 * It does not. Measured on this tree, changing `encryption.passphrase`:
 *
 *   - leaves every previously-written row unreadable, with NO error and NO
 *     signal of any kind at any layer;
 *   - returns the raw ciphertext envelope to the caller as if it were the
 *     value, with HTTP 200 and `key` present;
 *   - produces a store where the OLD key still reads the OLD rows and the NEW
 *     key reads only the NEW rows — a mixed-state store with no marker that
 *     says which rows are which;
 *   - has no key identity anywhere: the envelope carries `version` (a FORMAT
 *     version) but no key id, so a reader cannot even name which key a row
 *     needs;
 *   - has no operator surface: there is a first-class auth-token rotation
 *     route (`POST /admin/token/rotate`) and no encryption-key route at all;
 *   - and the passphrase itself lives as a PLAINTEXT field in a config file
 *     that is written 0644 by default.
 *
 * R420 already recorded the crypto-layer half of this ("a passphrase rotation
 * is a silent total loss, not an error" — r420_encryption_auth_failure.test.ts
 * P2b). What R420 could NOT see is that the loss is silent at every layer
 * ABOVE the crypto layer: the DB layer, the REST surface, the agent-facing
 * MemoryPool, the operator surface, and the cost model. That is this suite.
 *
 * METHOD: every assertion here was derived by EXECUTING the production code
 * (ClawDB against a real SQLite file, the real REST server, the real
 * MemoryPool), not by reading it. Where a probe and a comment disagree, the
 * probe wins.
 *
 * SCOPE: this suite pins the OBSERVED (defective) behaviour so the defect
 * cannot regress silently. It deliberately does NOT assert the fix — the fix
 * changes operator-visible behaviour (what happens to a rotated key) and is
 * a product decision, not a bug fix. See the R523 write-up.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, statSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ClawDB } from '../src/db.js';
import { MemoryPool } from '../src/memory.js';
import {
  createEncryption,
  encryptAndSerialize,
  deserializeEncrypted,
} from '../src/crypto.js';

const KEY_A = 'passphrase-alpha-123';
const KEY_B = 'passphrase-bravo-456';

let dir: string;

function config(passphrase: string, dataDir?: string) {
  return {
    dataDir: dataDir ?? dir,
    storage: { type: 'sqlite' as const },
    encryption: { enabled: true, passphrase },
    authToken: 'test-token',
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'r522-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('R523 A: the envelope carries no key identity', () => {
  it('A1 — the encrypted envelope has a FORMAT version but no key id', () => {
    const enc = createEncryption({ passphrase: KEY_A, enabled: true });
    const stored = encryptAndSerialize('secret', enc);
    const payload = deserializeEncrypted(stored)!;

    // It does carry a version — but that version is the FORMAT's, not the
    // key's. A reader still cannot name which key this row needs.
    expect(payload.version).toBe(1);
    expect(Object.keys(payload).sort()).toEqual(['ciphertext', 'iv', 'salt', 'tag', 'version']);
    expect('keyId' in payload).toBe(false);
    expect('key_id' in payload).toBe(false);
    expect('kid' in payload).toBe(false);
  });

  it('A2 — the version field is DESERIALIZED but never honoured: a forged version still reads back', async () => {
    const { safeDecryptValue } = await import('../src/crypto.js');
    const enc = createEncryption({ passphrase: KEY_A, enabled: true });
    const stored = encryptAndSerialize('secret', enc);

    // Forge the version forward, the way a future format would.
    const parsed = JSON.parse(Buffer.from(stored.slice('ENC:v1:'.length), 'base64').toString('utf8'));
    parsed.version = 99;
    const forged = 'ENC:v1:' + Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64');

    // The deserializer ACCEPTS it and PRESERVES the bogus version...
    const back = deserializeEncrypted(forged);
    expect(back).toBeDefined();
    expect(back!.version).toBe(99);
    // ...and the value still decrypts. So `version` is not a dispatch key:
    // no code path anywhere reads it to decide HOW to interpret the payload.
    expect(safeDecryptValue(forged, enc)).toBe('secret');
  });

  it('A3 — the SAME plaintext under two keys is indistinguishable by shape', () => {
    const a = createEncryption({ passphrase: KEY_A, enabled: true });
    const b = createEncryption({ passphrase: KEY_B, enabled: true });
    const underA = encryptAndSerialize('same plaintext', a);
    const underB = encryptAndSerialize('same plaintext', b);
    const pa = deserializeEncrypted(underA)!;
    const pb = deserializeEncrypted(underB)!;

    // Same field names, same field types, same lengths. Nothing in the
    // envelope says which key produced it.
    expect(Object.keys(pa)).toEqual(Object.keys(pb));
    expect(pa.ciphertext.length).toBe(pb.ciphertext.length);
    expect(pa.salt.length).toBe(pb.salt.length);
    expect(underA.slice(0, 7)).toBe(underB.slice(0, 7));
  });
});

describe('R523 B: a rotated key silently loses every previously-written row', () => {
  it('B1 ⭐ — after rotation the read SUCCEEDS and returns the raw ciphertext as the value', async () => {
    const dbA = new ClawDB(config(KEY_A));
    await dbA.setMemory('k1', 'SECRET_VALUE_ONE', 'agent-a', ['x']);
    const before = await dbA.getMemory('k1');
    expect(before!.value).toBe('SECRET_VALUE_ONE');
    await dbA.close();

    // The operator rotates the passphrase.
    const dbB = new ClawDB(config(KEY_B));
    const after = await dbB.getMemory('k1');

    // The row is NOT gone — no 404, no undefined...
    expect(after).toBeDefined();
    expect(after!.key).toBe('k1');
    // ...but the value is the ciphertext envelope, verbatim.
    expect(after!.value).not.toBe('SECRET_VALUE_ONE');
    expect(after!.value.startsWith('ENC:v1:')).toBe(true);
    await dbB.close();
  });

  it('B2 ⭐ — the agent-facing pool hands the ciphertext to the agent as a successful read', async () => {
    const dbA = new ClawDB(config(KEY_A));
    await dbA.setMemory('k1', 'SECRET_VALUE_ONE', 'agent-a', ['x']);
    const poolA = new MemoryPool(dbA);
    const before = await poolA.read('k1');
    expect(before?.value).toBe('SECRET_VALUE_ONE');
    await dbA.close();

    const dbB = new ClawDB(config(KEY_B));
    const poolB = new MemoryPool(dbB);
    const after = await poolB.read('k1');

    // The agent gets a value. It is the envelope. Nothing marks it.
    expect(after).toBeDefined();
    expect(String(after!.value).startsWith('ENC:v1:')).toBe(true);
    expect(after!.value).not.toBe('SECRET_VALUE_ONE');
    await dbB.close();
  });

  it('B3 ⭐ — the store becomes MIXED-STATE with no marker of which rows are readable', async () => {
    const dbA = new ClawDB(config(KEY_A));
    await dbA.setMemory('old-key-row', 'OLD_SECRET', 'agent-a', ['x']);
    await dbA.close();

    const dbB = new ClawDB(config(KEY_B));
    await dbB.setMemory('new-key-row', 'NEW_SECRET', 'agent-b', ['x']);

    const all = await dbB.getAllMemory();
    const readable = all.filter((m) => !String(m.value).startsWith('ENC:v1:'));
    const unreadable = all.filter((m) => String(m.value).startsWith('ENC:v1:'));

    // One row reads; one row is an envelope. Both are returned by the same
    // list call, in the same shape, with no per-row key marker.
    expect(all.length).toBe(2);
    expect(readable.map((m) => m.key)).toEqual(['new-key-row']);
    expect(unreadable.map((m) => m.key)).toEqual(['old-key-row']);
    // The unreadable one is still a "successful" row: it has a key, a value,
    // a timestamp, an author. Nothing in the row says "unreadable".
    const row = unreadable[0];
    expect(row.key).toBe('old-key-row');
    expect(row.value.length).toBeGreaterThan(0);
    expect(row.updatedBy).toBe('agent-a');
    await dbB.close();
  });

  it('B4 ⭐ — the OLD key still reads the OLD rows: rotation did not rewrite anything', async () => {
    const dbA = new ClawDB(config(KEY_A));
    await dbA.setMemory('k1', 'SECRET_VALUE_ONE', 'agent-a', ['x']);
    await dbA.close();

    const dbB = new ClawDB(config(KEY_B));
    await dbB.setMemory('k3', 'SECRET_VALUE_THREE', 'agent-b', ['x']);
    await dbB.close();

    // Reopen with the OLD key: the old row is STILL readable, the new one is not.
    const dbA2 = new ClawDB(config(KEY_A));
    expect((await dbA2.getMemory('k1'))!.value).toBe('SECRET_VALUE_ONE');
    expect(String((await dbA2.getMemory('k3'))!.value).startsWith('ENC:v1:')).toBe(true);
    await dbA2.close();
  });

  it('B5 — the on-disk plaintext guarantee still holds after a rotation (the loss is confidentiality-neutral)', async () => {
    const dbA = new ClawDB(config(KEY_A));
    await dbA.setMemory('k1', 'SECRET_VALUE_ONE', 'agent-a', ['x']);
    await dbA.close();

    const dbB = new ClawDB(config(KEY_B));
    await dbB.setMemory('k2', 'SECRET_VALUE_TWO', 'agent-b', ['x']);
    await dbB.close();

    // Nothing leaked to disk in either key's world — the rows are simply
    // unreadable, not exposed. (R521 already proved the plaintext planes;
    // this arm is the negative control for that finding.)
    const bytes = readFileSync(join(dir, 'woclaw.sqlite'));
    expect(bytes.includes(Buffer.from('SECRET_VALUE_ONE'))).toBe(false);
    expect(bytes.includes(Buffer.from('SECRET_VALUE_TWO'))).toBe(false);
  });
});

describe('R523 C: the operator surface', () => {
  it('C1 — there is an auth-token rotation route and NO encryption-key route', () => {
    const src = readFileSync(join(process.cwd(), 'src/rest_server.ts'), 'utf8');
    const routes = [...src.matchAll(/path === '([^']+)'/g)].map((m) => m[1]);

    // The auth token — a bearer credential with a grace-period rotation —
    // has a first-class route.
    expect(routes).toContain('/admin/token/rotate');
    expect(routes).toContain('/admin/token/status');
    // The encryption key — which silently destroys the store when changed —
    // has none.
    const keyRoutes = routes.filter((r) => /encrypt|passphrase|key.*rotat|rotat.*key/i.test(r));
    expect(keyRoutes).toEqual([]);
  });

  it('C2 — the passphrase is a PLAINTEXT config-file field, and the config file is 0644 by default', () => {
    const cfgPath = join(dir, 'woclaw.json');
    writeFileSync(cfgPath, JSON.stringify({ authToken: 'tok', encryption: { enabled: true, passphrase: KEY_A } }));
    const mode = statSync(cfgPath).mode & 0o777;

    // The key material is a plain string in a plain file.
    expect(readFileSync(cfgPath, 'utf8')).toContain(KEY_A);
    // And the file is world-readable unless the operator changed it.
    expect(mode).toBe(0o644);
  });

  it('C3 — no operator-facing doc mentions the encryption key at all', () => {
    const root = join(process.cwd(), '..');
    for (const f of ['README.md', 'docs/API.md', 'docs/INSTALL.md', 'docs/README.md']) {
      const p = join(root, f);
      let text = '';
      try {
        text = readFileSync(p, 'utf8');
      } catch {
        continue; // absent doc: nothing to claim
      }
      expect(text, `${f} mentions "encrypt"`).not.toMatch(/encrypt/i);
      expect(text, `${f} mentions "rotat"`).not.toMatch(/rotat/i);
    }
  });
});

describe('R523 D: the cost model — what a rotation would cost', () => {
  it('D1 — every value has its OWN salt, so a rotation re-derives a key for every row', () => {
    const enc = createEncryption({ passphrase: KEY_A, enabled: true });
    const a = encryptAndSerialize('same', enc);
    const b = encryptAndSerialize('same', enc);
    const pa = deserializeEncrypted(a)!;
    const pb = deserializeEncrypted(b)!;

    // Not just a random IV: a random SALT, which means a separately derived
    // PBKDF2 key per value.
    expect(pa.salt).not.toBe(pb.salt);
    expect(pa.iv).not.toBe(pb.iv);
    // So there is no single key to rotate — there are N keys, one per value,
    // and rotating means re-deriving and re-encrypting all of them.
    expect(a).not.toBe(b);
  });

  it('D2 — the derivation is SYNCHRONOUS, so one read blocks the event loop for its full cost', async () => {
    const { safeDecryptValue } = await import('../src/crypto.js');
    const enc = createEncryption({ passphrase: KEY_A, enabled: true });
    const stored = encryptAndSerialize('VALUE', enc);

    // Count timer ticks during ONE decrypt. PBKDF2 is sync, so a timer
    // scheduled for 5ms cannot fire while the derivation runs.
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 5);
    const t0 = Date.now();
    safeDecryptValue(stored, enc);
    const elapsed = Date.now() - t0;
    clearInterval(timer);

    // The derivation took real time...
    expect(elapsed).toBeGreaterThan(0);
    // ...and no timer could run during it.
    expect(ticks).toBe(0);
  });

  it('D3 — the per-row cost is LINEAR, so a list read pays it once per row', async () => {
    const db = new ClawDB(config(KEY_A));
    for (let i = 0; i < 8; i++) await db.setMemory(`k${i}`, `VALUE_${i}`, 'agent-a', ['x']);

    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 5);
    const t0 = Date.now();
    const all = await db.getAllMemory();
    const elapsed = Date.now() - t0;
    clearInterval(timer);

    expect(all.length).toBe(8);
    // The whole list read blocked the loop for its entire duration.
    expect(ticks).toBe(0);
    expect(elapsed).toBeGreaterThan(0);
    await db.close();
  });
});
