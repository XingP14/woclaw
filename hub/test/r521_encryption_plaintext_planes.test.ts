/**
 * R521 — with encryption-at-rest ON, the plaintext survives in two places
 * the encrypted store does not own: the GRAPH MIRROR and the LEGACY IMPORT.
 *
 * ── The gap this suite fills ───────────────────────────────────────────────
 *
 * The repo has a dedicated encryption plane: `hub/src/crypto.ts` (AES-256-GCM)
 * plus `hub/test/encryption_integration.test.ts` (12/12) and
 * `hub/test/r420_encryption_auth_failure.test.ts`. Those suites cover the
 * ROUND TRIP — write a value, read it back, assert the SQLite bytes are
 * ciphertext.
 *
 * They cover ONE storage path. `hub/src/db.ts` has THREE places a memory
 * value can land, and the other two were never asked the question:
 *
 *   1. `setMemory` — the live write path. COVERED: `storedValue` is the
 *      encrypted form (`db.ts:696`), and `encryption_integration.test.ts`
 *      asserts the on-disk bytes are ciphertext.
 *   2. the GRAPH MIRROR — `MemoryPool.write()` calls
 *      `graphStore.syncMemoryNode(key, serialized, …)` (`memory.ts:150`) with
 *      the PLAINTEXT `serialized`, never with the encrypted form. The graph
 *      store is a plain in-memory `Map` with no DB backing
 *      (`hub/src/graph/store.ts`), and `GET /graph/nodes?type=memory` is a
 *      GET route — and GET routes are NOT auth-gated
 *      (`rest_server.ts:236`: `requiresAuth = method !== 'GET' || path ===
 *      '/admin/token/status'`). R491 already established that the read
 *      surface is unauthenticated.
 *   3. the LEGACY IMPORT — `importLegacyData()` writes `mem.value` and
 *      `version.value` straight into the memory and memory_versions tables
 *      with NO encryption (`db.ts:612-635` sqlite, `db.ts:1203-1240` mysql),
 *      even when `encryption.enabled` is true. The legacy file is a
 *      plaintext JSON file on disk, so its contents are written to the
 *      "encrypted" store as plaintext.
 *
 * ── WHAT WAS MEASURED (real production classes, not a copy) ───────────────
 *
 * Measured 2026-10-30 06:22 CST against `hub/src/db.ts` + `hub/src/memory.ts`
 * + `hub/src/graph/store.ts` as they ship, with
 * `encryption: { enabled: true, passphrase: '…' }`:
 *
 *   C1  `mp.write(key, SECRET)` then read the graph node's metadata:
 *         read()                       -> "SSH_PRIVATE_KEY_MATERIAL_PLAINTEXT"
 *         graph node metadata.value    -> "SSH_PRIVATE_KEY_MATERIAL_PLAINTEXT"
 *         GET /graph/nodes body        -> contains the plaintext   <-- LEAK
 *         the .db file on disk         -> does NOT contain it       (correct)
 *       => the graph mirror holds the plaintext while the table holds the
 *          ciphertext. The store is encrypted; the MIRROR of it is not.
 *
 *   C2  legacy `woclaw.json` imported with encryption enabled:
 *         read()                       -> "…PLAINTEXT"  (plaintext, not
 *                                          "the value decrypted")
 *         getMemoryVersions()[0].value -> "…PLAINTEXT"
 *         the .db file on disk         -> contains the plaintext     <-- LEAK
 *       => the import bypasses encryption entirely: the value is stored AND
 *          served as plaintext, and the value in the version history is the
 *          plaintext too.
 *
 * Note what C2 does NOT do: it does not "fail to decrypt". `safeDecryptValue`
 * is not even reached on a value that was never encrypted — it returns the
 * input unchanged because `isEncrypted(value)` is false (the value does not
 * carry the `ENC:v1:` marker). So the read-back plaintext is indistinguishable
 * from a correct decryption.
 *
 * ── WHY THIS MATTERS ──────────────────────────────────────────────────────
 *
 * `docs/PROJECT-GOVERNANCE.md` lists "settle encryption-at-rest versus
 * searchable recall behavior" as a KNOWN BLOCKER, and the same document
 * requires a design in `docs/superpowers/specs/` before any change that
 * touches "encryption, auth, token handling". **The repair is therefore
 * FATHER-GATED and NOTHING production-side is shipped by this suite.**
 *
 * What ships is the defect made MEASURED AND VISIBLE, on the same pattern as
 * R517/R520: a suite that pins the current behaviour so that the day the
 * repair is authorised, the suite is the RED that forces it, and so that no
 * future change can widen the hole silently.
 *
 * The suite asserts the OBSERVED (defective) behaviour, not the desired
 * behaviour. A repair turns these arms RED — which is the point, and is why
 * they read as `expect(currentDefect)` rather than `expect(ideal)`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ClawDB } from '../src/db.js';
import { MemoryPool } from '../src/memory.js';
import { RestServer } from '../src/rest_server.js';
import { WSServer } from '../src/ws_server.js';
import { GraphStore } from '../src/graph/store.js';
import type { Config } from '../src/types.js';

const PASSPHRASE = 'test-passphrase-encryption-2026';
const SECRET = 'SSH_PRIVATE_KEY_MATERIAL_PLAINTEXT';
const LEGACY_SECRET = 'LEGACY_SECRET_PLAINTEXT_VALUE';
const KEY = 'openclaw:workspace:infra:ssh-key';

function makeConfig(dir: string): Config {
  return {
    port: 0,
    restPort: 0,
    host: '127.0.0.1',
    dataDir: dir,
    storage: { type: 'sqlite', sqlitePath: join(dir, 'r521.db') },
    authToken: 'test-token-12345',
    encryption: { enabled: true, passphrase: PASSPHRASE },
  };
}

// ══════════════════════════════════════════════════════════════════════
// C1 — THE GRAPH MIRROR
// ══════════════════════════════════════════════════════════════════════

describe('R521 C1 — the graph mirror holds the PLAINTEXT while the table holds the ciphertext', () => {
  let dir: string;
  let db: ClawDB;
  let wsServer: WSServer;
  let rest: RestServer;
  let graph: GraphStore;
  let mp: MemoryPool;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'r521-c1-'));
    const cfg = makeConfig(dir);
    db = new ClawDB(cfg);
    wsServer = new WSServer(cfg, db);
    mp = wsServer.getMemoryPool();
    graph = new GraphStore();
    mp.graphStore = graph;
    rest = new RestServer(cfg, db, wsServer.getTopicsManager(), mp, graph, wsServer);
  });

  afterEach(async () => {
    await db.close();
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('C1a — the memory TABLE holds ciphertext on disk while the GRAPH NODE holds the plaintext', async () => {
    await mp.write(KEY, SECRET, 'agent1', ['topic:infra']);

    // the read path is correct: the caller gets the plaintext back
    const mem = await mp.read(KEY, 'all');
    expect(mem?.value).toBe(SECRET);

    // the graph node holds the SAME plaintext
    const node = graph.getNodes('memory').find(n => n.label === KEY);
    expect(node).toBeDefined();
    expect(node!.metadata!.value).toBe(SECRET);   // <-- the defect, measured

    // and the table is genuinely encrypted: the plaintext is NOT in the file
    await db.close();
    const raw = readFileSync(join(dir, 'r521.db'));
    expect(raw.includes(Buffer.from(SECRET))).toBe(false);
    expect(raw.includes(Buffer.from('ENC:v1:'))).toBe(true);
  });

  it('C1b — GET /graph/nodes serves the plaintext', async () => {
    await mp.write(KEY, SECRET, 'agent1', ['topic:infra']);

    let status = 0;
    let body = '';
    const res = {
      setHeader: () => undefined,
      writeHead: (s: number) => { status = s; },
      end: (b: string) => { body = b; },
    } as any;
    await (rest as any).handleGraphNodesList(res, 'memory');

    expect(status).toBe(200);
    expect(body).toContain(SECRET);                       // <-- the leak
    expect(JSON.parse(body).count).toBe(1);
  });

  it('C1c — the mirror is fed the PLAINTEXT, not the ciphertext', async () => {
    await mp.write(KEY, SECRET, 'agent1', ['topic:infra']);
    const node = graph.getNodes('memory').find(n => n.label === KEY);
    const mirrored = String(node!.metadata!.value);

    // The mirrored value carries no encryption marker — it is the plaintext
    // the caller supplied, not the stored (encrypted) form.
    expect(mirrored.startsWith('ENC:v1:')).toBe(false);
    expect(mirrored).toBe(SECRET);
  });

  it('C1d — the mirror is written on the LIVE write path, so every encrypted memory leaks to it', async () => {
    await mp.write('a:one', 'PLAIN_ONE', 'agent1');
    await mp.write('b:two', 'PLAIN_TWO', 'agent2');
    const mirrored = graph.getNodes('memory').map(n => String(n.metadata!.value));
    expect(mirrored).toContain('PLAIN_ONE');
    expect(mirrored).toContain('PLAIN_TWO');
    // Neither is the encrypted form.
    expect(mirrored.every(v => !v.startsWith('ENC:v1:'))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════
// C2 — THE LEGACY IMPORT
//
// Each arm gets its OWN dataDir: the legacy import runs during `init()`, and
// only when the tables are still EMPTY. Sharing one directory with the C1
// fixtures would make the import skip, and re-opening one SQLite file from
// two live handles contends on the WAL.
// ══════════════════════════════════════════════════════════════════════

describe('R521 C2 — the legacy import writes the PLAINTEXT into the encrypted table', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'r521-c2-'));
  });

  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('C2a — the imported memory is stored as PLAINTEXT on disk', async () => {
    writeFileSync(join(dir, 'woclaw.json'), JSON.stringify({
      memory: [{ key: 'legacy:key', value: LEGACY_SECRET, tags: ['t'], updatedBy: 'old' }],
    }));

    const db = new ClawDB(makeConfig(dir));
    try {
      const mem = await db.getMemory('legacy:key');
      expect(mem?.value).toBe(LEGACY_SECRET);   // <-- plaintext, never encrypted
    } finally {
      await db.close();
    }

    const raw = readFileSync(join(dir, 'r521.db'));
    expect(raw.includes(Buffer.from(LEGACY_SECRET))).toBe(true);   // <-- LEAK
    expect(raw.includes(Buffer.from('ENC:v1:'))).toBe(false);
  });

  it('C2b — the legacy VERSION HISTORY is plaintext too', async () => {
    writeFileSync(join(dir, 'woclaw.json'), JSON.stringify({
      memory_versions: [{ key: 'legacy:key', value: LEGACY_SECRET, version: 1, updatedBy: 'old' }],
    }));

    const db = new ClawDB(makeConfig(dir));
    try {
      const versions = await db.getMemoryVersions('legacy:key');
      expect(versions.length).toBe(1);
      expect(versions[0].value).toBe(LEGACY_SECRET);   // <-- plaintext
    } finally {
      await db.close();
    }
  });

  it('C2c — the imported plaintext is INDISTINGUISHABLE from a correct decryption', async () => {
    // The reason this defect is silent: `safeDecryptValue` returns a value
    // that is not marked `ENC:v1:` UNCHANGED, so a read-back of a never-
    // encrypted value is byte-identical to a read-back of a decrypted one.
    // A caller cannot tell "decrypted" from "never encrypted".
    writeFileSync(join(dir, 'woclaw.json'), JSON.stringify({
      memory: [{ key: 'legacy:key', value: LEGACY_SECRET, updatedBy: 'old' }],
    }));
    const db = new ClawDB(makeConfig(dir));
    try {
      const legacy = await db.getMemory('legacy:key');
      expect(legacy?.value).toBe(LEGACY_SECRET);
    } finally {
      await db.close();
    }

    // the same value written through the ENCRYPTED path reads back identically
    const dir2 = mkdtempSync(join(tmpdir(), 'r521-c2b-'));
    try {
      const db2 = new ClawDB(makeConfig(dir2));
      const mp2 = new MemoryPool(db2);
      await mp2.write('fresh:key', LEGACY_SECRET, 'agent1');
      const fresh = await mp2.read('fresh:key', 'all');
      await db2.close();
      expect(fresh?.value).toBe(LEGACY_SECRET);
      // ...and its bytes on disk ARE encrypted. Same value, same read-back,
      // different storage. That is the whole defect.
      const raw = readFileSync(join(dir2, 'r521.db'));
      expect(raw.includes(Buffer.from(LEGACY_SECRET))).toBe(false);
    } finally {
      if (existsSync(dir2)) rmSync(dir2, { recursive: true, force: true });
    }
  });

  it('C2d — NEGATIVE CONTROL: the live write path on the SAME database IS encrypted', async () => {
    // Without this arm the suite would only prove that plaintext exists
    // somewhere; this arm proves the contrast is real — the same table,
    // the same encryption config, one path encrypted and one not.
    writeFileSync(join(dir, 'woclaw.json'), JSON.stringify({
      memory: [{ key: 'legacy:key', value: LEGACY_SECRET, updatedBy: 'old' }],
    }));
    const db = new ClawDB(makeConfig(dir));
    try {
      const mp = new MemoryPool(db);
      await mp.write('fresh:key', 'FRESH_SECRET', 'agent1');
    } finally {
      await db.close();
    }

    const raw = readFileSync(join(dir, 'r521.db'));
    expect(raw.includes(Buffer.from('FRESH_SECRET'))).toBe(false);   // live path: encrypted
    expect(raw.includes(Buffer.from('ENC:v1:'))).toBe(true);
    // ...while the imported one is not:
    expect(raw.includes(Buffer.from(LEGACY_SECRET))).toBe(true);     // import path: plaintext
  });
});

// ══════════════════════════════════════════════════════════════════════
// THE SUBJECT SET IS DERIVED, NOT HAND-LISTED
// ══════════════════════════════════════════════════════════════════════

describe('R521 C3 — the producer and the routes are derived from the tree', () => {
  it('C3 — the mirror producer takes the plaintext, and the graph routes can return it', () => {
    const memSrc = readFileSync(join(__dirname, '..', 'src', 'memory.ts'), 'utf8');
    const restSrc = readFileSync(join(__dirname, '..', 'src', 'rest_server.ts'), 'utf8');

    // The mirror producer: syncMemoryNode is called with the plaintext
    // `serialized`, never with the encrypted form.
    expect(memSrc).toMatch(/syncMemoryNode\(\s*key\s*,\s*serialized/);

    // The graph routes that can return it.
    expect(restSrc).toContain("path === '/graph/nodes'");
    expect(restSrc).toContain("path.startsWith('/graph/nodes/')");

    // And the gate: GET routes are not auth-gated (the R491 finding), so
    // the graph routes are reachable with no credential.
    expect(restSrc).toContain("method !== 'GET'");
  });
});
