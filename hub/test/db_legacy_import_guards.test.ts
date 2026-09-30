// Coverage for the legacy-JSON import data-quality guards in hub/src/db.ts,
// plus two adjacent default-value arms that the existing suites never reach.
//
// The guards under test decide which rows from a pre-SQLite `woclaw.json`
// survive migration. Nothing above them validates the shape of that file: it
// is a hand-editable file from an older release, so malformed rows are a
// real input, not a hypothetical. A regression that inverted any of these
// guards would either abort the whole migration (`throw` inside the
// transaction) or silently persist junk keys, and the existing suite -- whose
// single legacy fixture has exactly one well-formed memory row and empty
// message/version arrays -- cannot tell the difference.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ClawDB } from '../src/db.js';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import path from 'path';

describe('legacy JSON import guards', () => {
  let testDir: string;
  let db: ClawDB;

  beforeEach(() => {
    testDir = '/tmp/woclaw-test-legacy-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    mkdirSync(testDir, { recursive: true });
    db = new ClawDB(testDir);
  });

  afterEach(async () => {
    await db.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  /** Re-open the DB against a freshly written legacy store. */
  async function migrateWith(legacy: unknown): Promise<ClawDB> {
    await db.close();
    writeFileSync(path.join(testDir, 'woclaw.json'), JSON.stringify(legacy));
    db = new ClawDB(testDir);
    // Force init() to run: any public read awaits the ready promise.
    await db.getTopicStats();
    return db;
  }

  describe('malformed rows are skipped, not fatal', () => {
    it('skips messages that are missing an id or a topic', async () => {
      await migrateWith({
        messages: [
          { id: 'good', topic: 'general', from: 'a1', content: 'kept', timestamp: 1000 },
          { topic: 'general', content: 'no id', timestamp: 1001 },
          { id: 'no-topic', content: 'no topic', timestamp: 1002 },
          { id: 'no-content', topic: 'general', timestamp: 1003 },
        ],
        memory: [],
        memory_versions: [],
      });

      const msgs = await db.getMessages('general', 100);
      // Exactly one survived: the no-content row is valid (content is NOT
      // part of the guard) and is persisted as an empty string.
      expect(msgs).toHaveLength(2);
      const ids = msgs.map(m => m.id).sort();
      expect(ids).toEqual(['good', 'no-content']);
      expect(msgs.find(m => m.id === 'no-content')!.content).toBe('');
      // A message with no topic must not be filed under any topic at all.
      expect(await db.getMessages('no-topic-topic', 100)).toEqual([]);
    });

    it('skips memory entries with no key and defaults the optional fields', async () => {
      await migrateWith({
        messages: [],
        memory: [
          { value: 'orphan, no key' },
          { key: '', value: 'blank key' },
          { key: 'minimal' },
          { key: 'partial', value: 'v', tags: ['a', 1] },
        ],
        memory_versions: [],
      });

      const all = await db.getAllMemory();
      const keys = all.map(m => m.key).sort();
      expect(keys).toEqual(['minimal', 'partial']);

      const minimal = all.find(m => m.key === 'minimal')!;
      expect(minimal.value).toBe('');
      expect(minimal.tags).toEqual([]);
      expect(minimal.ttl).toBe(0);
      expect(minimal.updatedBy).toBe('system');
      expect(minimal.updatedAt).toBeGreaterThan(0); // Date.now() default

      const partial = all.find(m => m.key === 'partial')!;
      // serializeTags -> normalizeTags coerces the non-string element.
      expect(partial.tags).toEqual(['a', '1']);
    });

    it('skips versions with no key or no version number, keeps the rest in order', async () => {
      await migrateWith({
        messages: [],
        memory: [{ key: 'tracked', value: 'v1' }],
        memory_versions: [
          { key: 'tracked', value: 'v1', version: 1, updatedAt: 1000, updatedBy: 'a' },
          { key: 'tracked', value: 'v2', updatedAt: 2000, updatedBy: 'b' },
          { value: 'v-orphan', version: 1 },
          { key: 'tracked', value: 'v-null', version: null },
          { key: 'tracked', value: 'v-undef', version: undefined },
        ],
      });

      const versions = await db.getMemoryVersions('tracked');
      expect(versions).toHaveLength(1);
      expect(versions[0].value).toBe('v1');
      expect(versions[0].version).toBe(1);
      expect(versions[0].updatedBy).toBe('a');
    });

    it('tolerates entirely missing messages/memory/memory_versions keys', async () => {
      await migrateWith({ topics: [] });

      expect(await db.getAllMemory()).toEqual([]);
      expect(await db.getTopicStats()).toEqual([]);
    });
  });

  describe('pre-populated databases keep their data', () => {
    it('does not import the legacy file when the database already has rows', async () => {
      await db.setMemory('existing', 'current', 'agent1', [], 0);
      await db.saveMessage({ id: 'live', topic: 'general', from: 'a1', content: 'now', timestamp: 5000 });
      await db.close();

      writeFileSync(
        path.join(testDir, 'woclaw.json'),
        JSON.stringify({
          messages: [{ id: 'ghost', topic: 'general', from: 'old', content: 'stale', timestamp: 1 }],
          memory: [{ key: 'ghost-mem', value: 'stale' }],
          memory_versions: [{ key: 'ghost-mem', value: 'stale', version: 1 }],
        }),
      );
      db = new ClawDB(testDir);
      await db.getTopicStats();

      // The counts>0 guard short-circuits the import entirely.
      expect((await db.getAllMemory()).map(m => m.key)).toEqual(['existing']);
      expect((await db.getMessages('general', 100)).map(m => m.id)).toEqual(['live']);
    });

    it('does not import when only a message exists and memory is empty', async () => {
      await db.saveMessage({ id: 'only-msg', topic: 'general', from: 'a1', content: 'hi', timestamp: 1 });
      await db.close();

      writeFileSync(
        path.join(testDir, 'woclaw.json'),
        JSON.stringify({ messages: [], memory: [{ key: 'legacy-mem', value: 'old' }], memory_versions: [] }),
      );
      db = new ClawDB(testDir);
      await db.getTopicStats();

      // Any single non-zero count suppresses the import -- the OR is on the
      // three counts, not per-table.
      expect(await db.getAllMemory()).toEqual([]);
    });

    it('does not import when only a memory_versions row exists', async () => {
      // Set up the exact state the third OR arm exists for: no messages, no
      // memory rows, but a version row. A plain setMemory() cannot produce
      // this -- the first write of a key creates no version -- so the row is
      // inserted directly.
      await db.close();
      const sqlitePath = path.join(testDir, 'woclaw.sqlite');
      const { default: Database } = await import('better-sqlite3');
      const raw = new Database(sqlitePath);
      raw.prepare(`INSERT INTO memory_versions (key, value, version, tags, ttl, expire_at, updated_at, updated_by)
                  VALUES ('orphan-ver', 'v', 1, '[]', 0, 0, 1, 'a1')`).run();
      raw.close();

      writeFileSync(
        path.join(testDir, 'woclaw.json'),
        JSON.stringify({ messages: [], memory: [{ key: 'legacy-mem', value: 'old' }], memory_versions: [] }),
      );
      db = new ClawDB(testDir);
      await db.getTopicStats();

      // messageCount==0 and memoryCount==0, but versionCount>0 -- so the
      // import must still be suppressed even though the legacy file has a
      // memory row the database could accept.
      expect(await db.getAllMemory()).toEqual([]);
      expect((await db.getMemoryVersions('orphan-ver')).map(v => v.value)).toEqual(['v']);
    });
  });

  describe('unreadable legacy file', () => {
    it('starts an empty database and leaves the bad file in place when the JSON is malformed', async () => {
      await db.close();
      const legacyPath = path.join(testDir, 'woclaw.json');
      writeFileSync(legacyPath, '{ this is not json');

      db = new ClawDB(testDir);
      await db.getTopicStats();

      // The import failure is logged and swallowed -- init() still resolves,
      // so the hub boots on an empty store rather than crash-looping.
      expect(await db.getAllMemory()).toEqual([]);
      expect(existsSync(legacyPath)).toBe(true);
      // Not deleted, so a later manual fix can still import it.
      expect(readFileSync(legacyPath, 'utf-8')).toBe('{ this is not json');
    });

    it('re-runs the import once the legacy file is corrected', async () => {
      await db.close();
      const legacyPath = path.join(testDir, 'woclaw.json');
      writeFileSync(legacyPath, 'nope');
      db = new ClawDB(testDir);
      await db.getTopicStats();
      expect(await db.getAllMemory()).toEqual([]);

      await db.close();
      writeFileSync(legacyPath, JSON.stringify({ messages: [], memory: [{ key: 'fixed', value: 'yes' }], memory_versions: [] }));
      db = new ClawDB(testDir);
      expect((await db.getAllMemory()).map(m => m.key)).toEqual(['fixed']);
    });
  });

  describe('repeated init is idempotent on the migration columns', () => {
    it('re-opens an existing database without throwing on duplicate ADD COLUMN', async () => {
      await db.setMemory('m', 'v', 'a1', [], 0);
      await db.close();

      // The v1.0 migration adds importance_score/access_count/last_accessed_at
      // unconditionally; on a second init ALTER TABLE raises 'duplicate
      // column name', which addColumnIfNotExists must swallow. If it
      // rethrew, this constructor would reject and the hub would fail to boot
      // on every restart after the first.
      db = new ClawDB(testDir);
      await expect(db.getTopicStats()).resolves.toEqual(expect.any(Array));
      expect((await db.getAllMemory()).map(m => m.key)).toEqual(['m']);
    });
  });
});
