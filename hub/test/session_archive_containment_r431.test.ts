/**
 * R431 — the archive plane's own blind spots.
 *
 * `session_archive.test.ts` covers the happy path: archive, restore, list, stats.
 * It does not pin three behaviours that the implementation actually has, all of
 * which are load-bearing for anyone who later changes this file:
 *
 *  1. `archiveSession` builds its path as `${session.id}.jsonl.gz` with no
 *     sanitisation, so an id containing `../` lands OUTSIDE `archiveDir` — and
 *     `listArchived`/`stats`, which only walk `archiveDir`, then report the
 *     archive as empty. A write that succeeded is invisible to every reader.
 *     Pinned as-is, deliberately NOT fixed: `SessionArchiver` currently has no
 *     in-hub caller, so changing the path contract is a wire/behaviour decision
 *     for Father, not a coverage patch. This test exists so the day it IS
 *     wired up, the escape is visible rather than surprising.
 *
 *  2. `stats()` counts a file `restoreSession` cannot read. `listArchived` only
 *     checks the `.jsonl.gz` suffix and `statSync`; it never decompresses. A
 *     truncated or corrupt archive therefore reports a healthy archive with a
 *     non-zero size, and the failure surfaces only at restore time, as a THROW
 *     rather than the `null` the signature promises. The asymmetry is the point:
 *     `restoreSession` is declared `Promise<DBSession | null>` and has no catch.
 *
 *  3. `restoreSession` scans every subdir of `archiveDir`, so a session
 *     archived under `YYYY-MM` is found from any of them.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionArchiver } from '../src/session_archive.js';
import type { DBSession } from '../src/types.js';
import { mkdirSync, rmSync, existsSync, readdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';

function makeSession(overrides: Partial<DBSession> = {}): DBSession {
  return {
    id: 'r431-' + Math.random().toString(36).slice(2, 10),
    agentId: 'agent-1',
    framework: 'claude-code',
    startedAt: Date.UTC(2026, 5, 15, 12, 0, 0),
    transcript: 'hello world',
    importance: 0.8,
    accessCount: 0,
    tags: ['tag-a'],
    extracted: false,
    flagged: false,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('SessionArchiver — R431 archive-plane blind spots', () => {
  // Base is a NESTED dir so a `../` escape lands somewhere observable rather
  // than in /tmp, which would make the negative assertions below vacuous.
  const root = join('/tmp', 'woclaw-r431-' + process.pid + '-' + Date.now());
  const testDir = join(root, 'archive');
  let archiver: SessionArchiver;

  beforeEach(() => {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    archiver = new SessionArchiver(testDir);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('path containment (characterisation of an unfixed defect)', () => {
    // Measured, not assumed: `path.join` NORMALISES, so the number of `../`
    // segments decides the outcome, and there are three distinct regimes.
    //   '..'   -> archiveDir/ESCAPED.jsonl.gz   (inside archiveDir, OUTSIDE every YYYY-MM subdir)
    //   '../..'-> ROOT/ESCAPED.jsonl.gz         (fully outside archiveDir)
    // Both are invisible to listArchived, which only walks archiveDir/*/ .
    it('a single ../ lands inside archiveDir but outside every YYYY-MM subdir', async () => {
      const res = await archiver.archiveSession(makeSession({ id: '../ESCAPED' }));

      expect(existsSync(res.filePath)).toBe(true);
      expect(res.filePath.startsWith(testDir + '/')).toBe(true);
      expect(dirname(res.filePath)).toBe(testDir);
      // archiveDir ends up holding both the always-created (now empty) YYYY-MM
      // subdir and the escaped file sitting at its root, so every reader misses it.
      expect(readdirSync(testDir).sort()).toEqual(['2026-06', 'ESCAPED.jsonl.gz']);
      expect(readdirSync(join(testDir, '2026-06'))).toEqual([]);
      expect(archiver.listArchived()).toEqual([]);
      expect(archiver.stats().archivedCount).toBe(0);
    });

    it('two ../ segments escape archiveDir entirely', async () => {
      const escapingId = '../../ESCAPED';
      const res = await archiver.archiveSession(makeSession({ id: escapingId }));

      expect(existsSync(res.filePath)).toBe(true);
      expect(res.filePath.startsWith(testDir + '/')).toBe(false);
      expect(dirname(res.filePath)).toBe(root);
      expect(existsSync(join(root, 'ESCAPED.jsonl.gz'))).toBe(true);
      expect(archiver.listArchived()).toEqual([]);
      expect(archiver.stats()).toEqual({
        archivedCount: 0,
        totalSizeBytes: 0,
        oldestArchivedAt: null,
      });
    });

    it('a session that escaped is invisible to listArchived', async () => {
      await archiver.archiveSession(makeSession({ id: '../../ESCAPED' }));

      const list = archiver.listArchived();
      expect(list).toEqual([]);
      expect(list.some((e) => e.sessionId === '../../ESCAPED')).toBe(false);
    });

    it('a plain id without separators stays INSIDE archiveDir (positive control)', async () => {
      const res = await archiver.archiveSession(makeSession({ id: 'plain-id' }));

      expect(res.filePath.startsWith(testDir + '/')).toBe(true);
      expect(readdirSync(testDir)).toEqual(['2026-06']);
      expect(archiver.listArchived().map((e) => e.sessionId)).toEqual(['plain-id']);
      expect(archiver.stats().archivedCount).toBe(1);
    });
  });

  describe('corrupt archive: stats and restore disagree', () => {
    it('listArchived/stats count a corrupt archive that restoreSession cannot read', async () => {
      await archiver.archiveSession(makeSession({ id: 'good' }));
      const ym = join(testDir, '2026-06');
      writeFileSync(join(ym, 'corrupt.jsonl.gz'), Buffer.from('not gzip at all'));

      // stats() only stats the file — it never decompresses.
      const stats = archiver.stats();
      expect(stats.archivedCount).toBe(2);
      expect(stats.oldestArchivedAt).not.toBeNull();
      const corrupt = archiver.listArchived().find((e) => e.sessionId === 'corrupt');
      expect(corrupt).toBeDefined();
      expect(corrupt!.sizeBytes).toBe(Buffer.byteLength('not gzip at all'));

      // ...but restoring it throws rather than returning the declared null.
      await expect(archiver.restoreSession('corrupt')).rejects.toThrow();

      // The healthy sibling is unaffected: the throw is per-file, not a
      // poison-pill that takes down the whole archive.
      const good = await archiver.restoreSession('good');
      expect(good).not.toBeNull();
      expect(good!.id).toBe('good');
      // The restore path is also where _archivedAt must be stripped; pin it
      // here too so the corrupt-file branch cannot hide a regression there.
      expect((good as unknown as Record<string, unknown>)._archivedAt).toBeUndefined();
    });

    it('a non-.jsonl.gz file in a YYYY-MM subdir is counted by neither list nor stats', async () => {
      const ym = join(testDir, '2026-06');
      mkdirSync(ym, { recursive: true });
      // Right size to be counted if the suffix filter were dropped.
      writeFileSync(join(ym, 'decoy.txt'), Buffer.alloc(4096, 0x41));
      await archiver.archiveSession(makeSession({ id: 'real' }));

      const list = archiver.listArchived();
      expect(list).toHaveLength(1);
      expect(list[0].sessionId).toBe('real');
      expect(list.some((e) => e.sessionId === 'decoy')).toBe(false);
      expect(archiver.stats().archivedCount).toBe(1);
      // totalSizeBytes must equal the ONE real archive, not 4096 + that.
      const real = list[0].sizeBytes;
      expect(archiver.stats().totalSizeBytes).toBe(real);
    });

    it('a missing session returns null while a corrupt one throws — the two failures are distinct', async () => {
      await expect(archiver.restoreSession('never-existed')).resolves.toBeNull();

      const ym = join(testDir, '2026-06');
      mkdirSync(ym, { recursive: true });
      writeFileSync(join(ym, 'bad.jsonl.gz'), Buffer.from('\\x1f\\x8b truncated'));
      await expect(archiver.restoreSession('bad')).rejects.toThrow();
    });
  });

  describe('multi-subdir search', () => {
    it('restoreSession finds a session archived under a different YYYY-MM subdir', async () => {
      // Decoy subdir that does NOT contain the file, listed first by readdirSync.
      mkdirSync(join(testDir, '2026-01'), { recursive: true });
      await archiver.archiveSession(makeSession({ id: 'june', startedAt: Date.UTC(2026, 5, 15) }));

      const restored = await archiver.restoreSession('june');
      expect(restored).not.toBeNull();
      expect(restored!.id).toBe('june');
      expect(restored!.framework).toBe('claude-code');
    });

    it('an empty subdir is walked without error and contributes nothing', async () => {
      mkdirSync(join(testDir, '2026-02'), { recursive: true });
      mkdirSync(join(testDir, '2026-03'), { recursive: true });
      await archiver.archiveSession(makeSession({ id: 'only', startedAt: Date.UTC(2026, 5, 15) }));

      const list = archiver.listArchived();
      expect(list).toHaveLength(1);
      expect(list[0].sessionId).toBe('only');
    });
  });
});
