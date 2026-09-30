// Coverage for the SqliteStorage write-path guards in hub/src/db.ts that the
// existing suites structurally cannot reach, all in one theme: what the store
// does with rows whose optional fields are ABSENT.
//
//   1. trimMessagesIfNeeded (L654 `count <= 10000`, L665 `ids.length === 0`)
//      -- the message-table growth cap. Every existing suite writes a handful
//      of messages, so both guards are dark, and they are the only thing
//      between a long-running hub and an unbounded messages table.
//   2. addSessionFeedback / addMemoryFeedback `reason ?? null` (L924/L933)
//      -- `reason` is optional on the public API, so the null arm is what
//      EVERY reason-less adjustment stores. better-sqlite3 rejects an
//      `undefined` binding outright, so these two are load-bearing, not
//      cosmetic.
//   3. importLegacyData version defaults (L629 `value ?? ''`, L635
//      `updatedBy ?? 'system'`) -- a hand-editable woclaw.json from an older
//      release can carry a version entry with a version number but no value
//      or author. The prior suite's fixture fills every field.
//
// No production changes: this file is test-only.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ClawDB } from '../src/db.js';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';

const TRIM_THRESHOLD = 10000;
const TRIM_TARGET = 5000;

describe('SqliteStorage optional-field + trim guards', () => {
  let testDir: string;
  let db: ClawDB;

  beforeEach(() => {
    testDir = '/tmp/woclaw-test-optional-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    mkdirSync(testDir, { recursive: true });
    db = new ClawDB(testDir);
  });

  async function closeDb(): Promise<void> {
    await db.close();
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  }

  // ─── 1. message trim guards ──────────────────────────────────────────────

  describe('trimMessagesIfNeeded', () => {
    it('leaves a small message table untouched', async () => {
      await db.getTopicStats(); // force init()
      for (let i = 0; i < 5; i++) {
        await db.saveMessage({ id: `m${i}`, topic: 't', from: 'a', content: `c${i}`, timestamp: 1000 + i });
      }
      // 5 << 10000, so the early return at L654 must fire and nothing is deleted.
      expect(await db.getMessages('t', 1000)).toHaveLength(5);
    });

    it('caps the table at the target once the threshold is crossed, dropping the OLDEST first', async () => {
      await db.getTopicStats();
      // One past the threshold. The Nth save pushes count to 10001, the guard
      // at L654 is false, and trim deletes (count - 5000) = 5001 oldest rows,
      // leaving exactly 5000.
      const total = TRIM_THRESHOLD + 1;
      for (let i = 0; i < total; i++) {
        await db.saveMessage({ id: `m${i}`, topic: 't', from: 'a', content: `c${i}`, timestamp: 1000 + i });
      }

      const rows = await db.getMessages('t', 10000);
      expect(rows).toHaveLength(TRIM_TARGET);

      // ORDER BY timestamp ASC in the delete -> the survivors are the newest.
      // Timestamps are unique and monotonic, so min/max pin the identity of
      // the window without depending on LIMIT semantics.
      const timestamps = rows.map(r => r.timestamp).sort((a, b) => a - b);
      expect(timestamps[0]).toBe(1000 + (total - TRIM_TARGET));
      expect(timestamps[timestamps.length - 1]).toBe(1000 + (total - 1));

      // The newest row is intact (trim deletes the oldest, not the newest).
      expect(rows.some(r => r.id === `m${total - 1}`)).toBe(true);
      // And the very oldest is gone.
      expect(rows.some(r => r.id === 'm0')).toBe(false);
    });

    it('does NOT trim on every subsequent save once the table is back under the threshold', async () => {
      await db.getTopicStats();
      for (let i = 0; i < TRIM_THRESHOLD + 1; i++) {
        await db.saveMessage({ id: `m${i}`, topic: 't', from: 'a', content: `c${i}`, timestamp: 1000 + i });
      }
      expect(await db.getMessages('t', 10000)).toHaveLength(TRIM_TARGET);

      // One more save on top of the 5000 survivors: count is 5001, so the
      // L654 guard is true again and the 5000 must survive untouched. This
      // pins that the cap is a threshold+target, not a per-save delete.
      await db.saveMessage({ id: 'after', topic: 't', from: 'a', content: 'c', timestamp: 99999 });
      const rows = await db.getMessages('t', 10000);
      expect(rows).toHaveLength(TRIM_TARGET + 1);
      expect(rows.some(r => r.id === 'after')).toBe(true);
    });
  });

  // ─── 2. feedback reason ?? null ──────────────────────────────────────────

  describe('feedback without a reason', () => {
    it('stores reason as NULL and reads it back as null, for both feedback tables', async () => {
      await db.getTopicStats();

      // reason omitted entirely -> the `?? null` arm at L924 / L933.
      await db.addSessionFeedback('s1', 'agent-a', 1.5);
      await db.addMemoryFeedback('key-1', 'agent-a', -0.5);

      const sHist = await db.getSessionFeedbackHistory('s1');
      expect(sHist).toHaveLength(1);
      expect(sHist[0].sessionId).toBe('s1');
      expect(sHist[0].agentId).toBe('agent-a');
      expect(sHist[0].adjustment).toBe(1.5);
      // better-sqlite3 turns the null binding into a JS null on read; the
      // declared type is `reason?: string`, so this asserts the RUNTIME value.
      expect(sHist[0].reason).toBeNull();
      expect(sHist[0].createdAt).toBeGreaterThan(0);

      const mHist = await db.getMemoryFeedbackHistory('key-1');
      expect(mHist).toHaveLength(1);
      expect(mHist[0].key).toBe('key-1');
      expect(mHist[0].adjustment).toBe(-0.5);
      expect(mHist[0].reason).toBeNull();
    });

    it('keeps an explicit reason distinct from an absent one in the same history', async () => {
      await db.getTopicStats();
      await db.addSessionFeedback('s2', 'agent-a', 1);
      await db.addSessionFeedback('s2', 'agent-a', 2, 'because the answer was right');

      const hist = await db.getSessionFeedbackHistory('s2');
      expect(hist).toHaveLength(2);
      const withReason = hist.find(h => h.reason !== null);
      const withoutReason = hist.find(h => h.reason === null);
      expect(withReason?.reason).toBe('because the answer was right');
      expect(withoutReason?.adjustment).toBe(1);
    });

    it('orders feedback history newest-first', async () => {
      await db.getTopicStats();
      await db.addSessionFeedback('s3', 'agent-a', 1);
      await new Promise(r => setTimeout(r, 5));
      await db.addSessionFeedback('s3', 'agent-a', 2);
      const hist = await db.getSessionFeedbackHistory('s3');
      expect(hist.map(h => h.adjustment)).toEqual([2, 1]);
    });
  });

  // ─── 3. legacy version rows missing value / updatedBy ─────────────────────

  describe('legacy import version defaults', () => {
    it("defaults a version's missing value to '' and missing updatedBy to 'system'", async () => {
      await db.getTopicStats();
      await db.close();

      writeFileSync(path.join(testDir, 'woclaw.json'), JSON.stringify({
        memory: [{ key: 'tracked', value: 'v1' }],
        memory_versions: [
          { key: 'tracked', version: 1 },
          { key: 'tracked', version: 2, value: 'v2' },
        ],
      }));
      db = new ClawDB(testDir);
      await db.getTopicStats();

      const versions = await db.getMemoryVersions('tracked');
      expect(versions).toHaveLength(2);
      // ORDER BY version DESC.
      expect(versions[0].version).toBe(2);
      expect(versions[0].value).toBe('v2');
      expect(versions[0].updatedBy).toBe('system');

      // The bare { key, version } row: value defaults, author defaults.
      expect(versions[1].version).toBe(1);
      expect(versions[1].value).toBe('');
      expect(versions[1].updatedBy).toBe('system');
      // Non-key/non-version fields take the same fallbacks on both rows.
      expect(versions[1].ttl).toBe(0);
      expect(versions[1].tags).toEqual([]);
      expect(versions[1].expireAt).toBe(0);
    });
  });

  afterEach(async () => {
    await closeDb();
  });
});
