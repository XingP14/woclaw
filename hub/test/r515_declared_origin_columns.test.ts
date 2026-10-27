// R515 — the `federated` / `source_hub` column pair: a declared origin with
// no writer and no reader.
//
// This suite is a DEFECT-PRESENCE gate (R461 arm G / R512-14 discipline):
// it is GREEN while the defect exists and goes RED when it is fixed. That is
// deliberate and stated in the header so the next reader does not have to
// rediscover it.
//
// Arms:
//   A  the columns EXIST on the memory table            (shape)
//   B  `federated` has NO WRITER: every row keeps DEFAULT 0
//   C  `source_hub` has NO WRITER: every row keeps DEFAULT NULL
//   D  the READ path cannot SEE them: getAllMemory() projects false/undefined
//   E  the federation REQUEST filter selects by TAG only (the columns are inert)
//   F  a federated memory CARRYING an origin is received, and the origin lands
//      NOWHERE (behavioural: drives the REAL handler with a REAL peer message)
//   G  a legacy (pre-2026-05-27) on-disk DB never GAINS the two columns,
//      while the three columns that DO have an ALTER migration are added
//   H  NEGATIVE CONTROL: the filter is live (a 'federated'-tagged row IS found)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ClawDB } from '../src/db.js';

const FRESH = '/tmp/r515-fresh';
const LEGACY = '/tmp/r515-legacy';

// The exact pre-2026-05-27 `memory` DDL (commit 3be996c^ — the columns
// federated / source_hub did not exist yet).
const LEGACY_MEMORY_DDL = `
  CREATE TABLE IF NOT EXISTS memory (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    tags TEXT NOT NULL,
    ttl INTEGER NOT NULL,
    expire_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    updated_by TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_memory_expire_at ON memory(expire_at);
`;

function raw(db: ClawDB): any {
  return (db as any).storage.db;
}

function colsOf(db: ClawDB): string[] {
  return (raw(db).prepare(`PRAGMA table_info(memory)`).all() as any[]).map(c => c.name as string);
}

describe('R515 — the declared origin columns: no writer, no reader', () => {
  let db: ClawDB;

  beforeAll(async () => {
    if (existsSync(FRESH)) rmSync(FRESH, { recursive: true, force: true });
    mkdirSync(FRESH, { recursive: true });
    db = new ClawDB(FRESH);
    await new Promise(r => setTimeout(r, 200));
  });

  afterAll(async () => {
    await db.close();
  });

  // ── A: shape ──────────────────────────────────────────────────────────────
  it('A — the memory table DOES declare federated + source_hub', () => {
    const cols = colsOf(db);
    expect(cols).toContain('federated');
    expect(cols).toContain('source_hub');
  });

  // ── B: `federated` has no writer ──────────────────────────────────────────
  it('B — every written row keeps federated at its DEFAULT 0 (no writer exists)', async () => {
    // Write through the LOCAL path AND through the federation RECEIVE path
    // (ws_server.ts:73 verbatim shape: updatedBy = `federation:<hubId>`).
    await db.setMemory('k-local', 'v-local', 'agentA', ['proj'], 0);
    await db.setMemory('k-fed', 'v-fed', 'federation:hub1', ['proj'], 0);
    await db.setMemory('k-fed-tag', 'v-fed-tag', 'federation:hub1', ['federated'], 0);

    const rows = raw(db).prepare(`SELECT key, federated FROM memory ORDER BY key`).all() as any[];
    expect(rows.length).toBe(3);
    for (const r of rows) {
      expect(r.federated).toBe(0);
    }
    // And there is exactly ONE distinct value — the default was never left.
    const distinct = raw(db).prepare(`SELECT DISTINCT federated FROM memory`).all() as any[];
    expect(distinct.map(d => d.federated)).toEqual([0]);
  });

  // ── C: `source_hub` has no writer ─────────────────────────────────────────
  it('C — every written row keeps source_hub at its DEFAULT NULL (no writer exists)', () => {
    const rows = raw(db).prepare(`SELECT key, source_hub FROM memory ORDER BY key`).all() as any[];
    expect(rows.length).toBe(3);
    for (const r of rows) {
      expect(r.source_hub).toBeNull();
    }
    const distinct = raw(db).prepare(`SELECT DISTINCT source_hub FROM memory`).all() as any[];
    expect(distinct.map(d => d.source_hub)).toEqual([null]);
  });

  // ── D: the read path cannot see them ──────────────────────────────────────
  it('D — getAllMemory() projects federated=false / sourceHub=undefined for every row', async () => {
    const all = await db.getAllMemory();
    expect(all.length).toBe(3);
    for (const m of all) {
      expect(m.federated).toBe(false);
      expect(m.sourceHub).toBeUndefined();
    }
  });

  // ── E: the request filter selects by TAG only — the columns are inert ─────
  it('E — the federation REQUEST filter selects the tag-only row, and the columns cannot contribute', async () => {
    const all = await db.getAllMemory();
    // ws_server.ts:79 verbatim.
    const selected = all.filter(m => m.federated || (m.tags && m.tags.includes('federated')));
    expect(selected.map(m => m.key)).toEqual(['k-fed-tag']);
    // The `federated` half of the predicate is DEAD: it can never be true,
    // because the column it reads is never written.
    expect(all.every(m => m.federated === false)).toBe(true);
  });

  // ── F: the receive path NEVER records the origin ──────────────────────────
  // This arm is BEHAVIOURAL, not textual. The first version of this arm
  // pinned the literal destructuring string; the mutation matrix then showed
  // that a PURE RENAME of the two origin fields (zero behaviour change)
  // KILLED it — i.e. the arm was a RENAME detector wearing the clothes of a
  // "the origin is never used" detector. (R460-1: pin the property, not the
  // spelling.) This version drives the REAL handler with a REAL peer message
  // that CARRIES an origin, and asserts the origin lands nowhere.
  it('F — a federated memory carrying an origin is received, and the origin lands NOWHERE', async () => {
    const { WSServer } = await import('../src/ws_server.js');
    const dir = '/tmp/r515-origin-f';
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const db2 = new ClawDB(dir);
    await new Promise(r => setTimeout(r, 200));

    const server = new WSServer({
      port: 0, restPort: 0, host: '127.0.0.1', dataDir: dir,
      authToken: '', hubId: 'hub-local',
    } as any, db2);

    // Drive the REAL receive path with a peer message that CARRIES an origin
    // (`sourceHub`) and a sender timestamp (`updatedAt`) — exactly the shape
    // `FederationManager.syncMemory()` puts on the wire (federation.ts:257).
    const fed = (server as any).federationManager;
    const handler = (fed as any).onMemorySync;
    expect(typeof handler).toBe('function');

    await handler({
      type: 'memory_sync',
      fromHubId: 'hub-remote',
      toHubId: 'hub-local',
      payload: {
        key: 'k-from-remote',
        value: 'v-from-remote',
        tags: ['proj'],
        sourceHub: 'hub-remote',
        updatedAt: 1700000000000,
      },
    });

    // The value WAS received …
    const all = await db2.getAllMemory();
    expect(all.map(m => m.key)).toContain('k-from-remote');

    // … but the ORIGIN landed nowhere:
    //   1. not in the columns (no writer),
    //   2. not in the projection (no reader),
    //   3. not in `updated_by` either — the origin hub is recorded as the
    //      WRITER (`federation:hub-remote`), which is a different thing: it
    //      says WHO WROTE, not WHERE THE VALUE CAME FROM.
    const row = (db2 as any).storage.db.prepare(
      `SELECT key, federated, source_hub, updated_by, tags FROM memory WHERE key = ?`
    ).get('k-from-remote') as any;
    expect(row.federated).toBe(0);
    expect(row.source_hub).toBeNull();
    expect(row.updated_by).toBe('federation:hub-remote');
    // And the payload's own `sourceHub` value is NOT what `updated_by` holds.
    expect(row.updated_by).not.toBe('hub-remote');

    const mem = all.find(m => m.key === 'k-from-remote')!;
    expect(mem.federated).toBe(false);
    expect(mem.sourceHub).toBeUndefined();

    await db2.close();
  });
});

describe('R515 — the schema-evolution gap (upgrade path)', () => {
  it('G — a legacy on-disk DB never GAINS federated/source_hub, while the three columns that DO have an ALTER migration are added', async () => {
    if (existsSync(LEGACY)) rmSync(LEGACY, { recursive: true, force: true });
    mkdirSync(LEGACY, { recursive: true });

    // Build a REAL legacy file at the product's own path (db.ts:242 —
    // resolveSqlitePath -> join(dataDir, 'woclaw.sqlite')).
    const legacyRaw = new Database(join(LEGACY, 'woclaw.sqlite'));
    legacyRaw.exec(LEGACY_MEMORY_DDL);
    legacyRaw.prepare(
      `INSERT INTO memory (key, value, tags, ttl, expire_at, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('legacy-key', 'legacy-value', '["proj"]', 0, 0, 111, 'legacy-agent');
    legacyRaw.close();

    // Boot the CURRENT product against it.
    const legacyDb = new ClawDB(LEGACY);
    await new Promise(r => setTimeout(r, 250));

    const cols = colsOf(legacyDb);
    // The three columns that HAVE an ALTER migration are present …
    expect(cols).toContain('importance_score');
    expect(cols).toContain('access_count');
    expect(cols).toContain('last_accessed_at');
    // … while the two that were only added to the CREATE TABLE are NOT.
    expect(cols).not.toContain('federated');
    expect(cols).not.toContain('source_hub');

    // The legacy row itself survived and stayed readable.
    const all = await legacyDb.getAllMemory();
    expect(all.map(m => m.key)).toEqual(['legacy-key']);
    expect(all[0].value).toBe('legacy-value');
    expect(all[0].federated).toBe(false);

    await legacyDb.close();
  });

  // ── H: NEGATIVE CONTROL — the filter is live ──────────────────────────────
  it('H — NEGATIVE CONTROL: the federation filter DOES select a tag-only row (so arm E measures a dead column, not a broken filter)', async () => {
    const db2 = new ClawDB('/tmp/r515-control');
    await new Promise(r => setTimeout(r, 200));
    await db2.setMemory('ctl', 'v', 'federation:hubX', ['federated'], 0);
    const all = await db2.getAllMemory();
    const selected = all.filter(m => m.federated || (m.tags && m.tags.includes('federated')));
    expect(selected.length).toBe(1);
    expect(selected[0].key).toBe('ctl');
    await db2.close();
  });
});
