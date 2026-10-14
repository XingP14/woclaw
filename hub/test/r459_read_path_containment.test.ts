/**
 * r459 — the READ side of the archive plane's path containment.
 *
 * r431 (`e14d274`) pinned the WRITE side: `archiveSession` builds
 * `${session.id}.jsonl.gz` with no sanitisation, so `../` escapes `archiveDir`
 * and the write lands where `listArchived`/`stats` never look.
 *
 * It did not pin the READ side, which builds a path from the SAME untrusted
 * field with the SAME missing guard:
 *
 *   restoreSession: path.join(this.archiveDir, entry, `${sessionId}.jsonl.gz`)
 *
 * MEASURED, not assumed (r459 probe, scripts/r459_probe.ts):
 *
 *  1. The escape is DEPTH-RELATIVE, not absolute. `restoreSession` iterates
 *     `readdirSync(archiveDir)` and joins `entry` as one more segment, so an
 *     id needs exactly (depth of entry) + 1 leading `../` to clear archiveDir:
 *     with a single `2026-01` subdir, `../../secrets/X` escapes; `../secrets/X`
 *     and `../../../secrets/X` both resolve to a non-existent path and return
 *     the declared `null`. Same normalisation as the write side (r431), but
 *     the write side starts one segment shallower, so the two sides need
 *     DIFFERENT numbers of `../` for the same id — a reader who copied the
 *     write-side count gets a silent `null` and concludes "no escape".
 *
 *  2. A hit is returned as a real `DBSession`. `restoreSession` parses the
 *     escaped file, DELETES `_archivedAt` from it, and hands the object back
 *     typed as `DBSession` — so an arbitrary out-of-tree file that happens to
 *     be gzip-of-JSON is laundered into the session type. Nothing checks that
 *     the returned object is a session at all.
 *
 *  3. The file only has to be GZIP. A non-gzip target throws
 *     `incorrect header check` rather than returning the declared `null` —
 *     the r431 corrupt-archive asymmetry, reached again through the escape.
 *
 * Pinned as-is, deliberately NOT fixed, for the same reason r431 pinned its
 * side: `SessionArchiver` has no in-hub caller (verified — `grep -rn
 * "SessionArchiver|archiveSession|restoreSession" src/` matches only
 * `session_archive.ts` itself), so sanitising the path is a path-contract
 * decision for Father, not a coverage patch. This test exists so the day it
 * IS wired up, the escape is visible rather than surprising.
 *
 * MUTATION NOTE (corrects an earlier draft of this header, which claimed the
 * isDirectory guard was an unkillable EQUIVALENT MUTANT — wrong, and the suite
 * itself disproved it): a FILE entry is a usable join segment after all, because
 * `path.join` normalises the `..` in the id away before resolving. So the
 * guard is observable and IS killed. The trap is in the FIXTURE, not the
 * mutant: this suite's own `2026-01` fixture subdir can serve the same read, so
 * a test that leaves it in place measures the subdir, not the file entry, and
 * looks like it is pinning the file-entry behaviour while pinning nothing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionArchiver } from '../src/session_archive.js';
import type { DBSession } from '../src/types.js';
import { mkdirSync, rmSync, existsSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { gzipSync } from 'zlib';

function makeSession(overrides: Partial<DBSession> = {}): DBSession {
  return {
    id: 'r459-' + Math.random().toString(36).slice(2, 10),
    agentId: 'agent-1',
    framework: 'claude-code',
    startedAt: Date.UTC(2026, 5, 15, 12, 0, 0),
    transcript: 'ORIGINAL-TRANSCRIPT',
    importance: 0.8,
    accessCount: 0,
    tags: ['tag-a'],
    extracted: false,
    flagged: false,
    createdAt: Date.now(),
    ...overrides,
  } as DBSession;
}

/** Write a well-formed gzip-of-JSON archive at an arbitrary path. */
function plantArchive(filePath: string, session: object): void {
  writeFileSync(filePath, gzipSync(Buffer.from(JSON.stringify({ ...session, _archivedAt: 1 }) + '\n')));
}

describe('SessionArchiver — r459 read-side path containment', () => {
  const root = join('/tmp', 'woclaw-r459-' + process.pid + '-' + Date.now());
  const testDir = join(root, 'archive');
  const outsideDir = join(root, 'secrets');
  let archiver: SessionArchiver;

  beforeEach(() => {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    // One YYYY-MM subdir so readdirSync has an entry to iterate; without it the
    // loop body never runs and every assertion below is vacuously true.
    mkdirSync(join(testDir, '2026-01'), { recursive: true });
    archiver = new SessionArchiver(testDir);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('depth-relative escape (measured, not assumed)', () => {
    it('two ../ segments climb out of archiveDir/<entry>/ and read a file outside archiveDir', async () => {
      plantArchive(join(outsideDir, 'STOLEN.jsonl.gz'), {
        ...makeSession({ id: 'STOLEN' }),
        transcript: 'SECRET-TRANSCRIPT',
      });

      const restored = await archiver.restoreSession('../../secrets/STOLEN');

      // The escape SUCCEEDS: an out-of-tree file came back as a DBSession.
      expect(restored).not.toBeNull();
      expect(restored!.id).toBe('STOLEN');
      expect(restored!.transcript).toBe('SECRET-TRANSCRIPT');

      // ...and it is laundered: _archivedAt is stripped from a file that was
      // never archived here, so nothing downstream can tell it was foreign.
      expect((restored as unknown as Record<string, unknown>)._archivedAt).toBeUndefined();

      // The escaped file is outside archiveDir and invisible to every reader.
      expect(existsSync(join(outsideDir, 'STOLEN.jsonl.gz'))).toBe(true);
      expect(archiver.listArchived().some((e) => e.sessionId === 'STOLEN')).toBe(false);
      expect(archiver.stats().archivedCount).toBe(0);
    });

    it('the escape is DEPTH-RELATIVE: one ../ and three ../ both return null while two returns the object', async () => {
      plantArchive(join(outsideDir, 'SHAPE.jsonl.gz'), makeSession({ id: 'SHAPE' }));

      // Under-count: archiveDir/secrets/… — does not exist.
      const under = await archiver.restoreSession('../secrets/SHAPE');
      expect(under).toBeNull();

      // Exact: root/secrets/… — exists, outside archiveDir.
      const exact = await archiver.restoreSession('../../secrets/SHAPE');
      expect(exact).not.toBeNull();
      expect(exact!.id).toBe('SHAPE');

      // Over-count: /tmp/secrets/… — does not exist (PROBE measured this).
      const over = await archiver.restoreSession('../../../secrets/SHAPE');
      expect(over).toBeNull();
    });

    it('restoreSession has NO isDirectory guard, so a FILE entry serves the read that only a subdir should', async () => {
      // WRITE side (pinned by r431): archiveDir/<YYYY-MM>/<id> is one segment
      // below archiveDir, so ONE ../ lands the file at archiveDir's ROOT —
      // inside archiveDir but outside every YYYY-MM subdir.
      const written = await archiver.archiveSession(makeSession({ id: '../ESCAPED_WRITE' }));
      expect(dirnameName(written.filePath)).toBe(testDir);
      expect(archiver.listArchived().some((e) => e.sessionId === '../ESCAPED_WRITE')).toBe(false);

      // The escaped FILE is now a top-level entry of archiveDir, and
      // `listArchived` skips it (`!isDirectory() → continue`), so the archive
      // reader cannot see the archive the restorer can still read. The two
      // halves of the plane disagree about their own contents, and neither
      // disagreement is visible from the other side alone.
      expect(readdirSync(testDir)).toContain('ESCAPED_WRITE.jsonl.gz');
      expect(archiver.stats().archivedCount).toBe(0);

      // Clear BOTH subdirs: `2026-01` is this suite's own fixture (it exists
      // so the restore loop has an entry to iterate) and `2026-06` is where
      // archiveSession just wrote. Removing only one leaves the other able to
      // serve the read — join(td,'2026-01','../ESCAPED_WRITE.jsonl.gz')
      // normalises straight back to the escaped file — and the hit below would
      // prove nothing about the FILE entry. THIS is the load-bearing step, and
      // it is what mutation M1 in scripts/r459_matrix2.sh (adding the guard
      // listArchived already has) reddens on.
      rmSync(join(testDir, '2026-06'), { recursive: true, force: true });
      rmSync(join(testDir, '2026-01'), { recursive: true, force: true });
      expect(readdirSync(testDir)).toEqual(['ESCAPED_WRITE.jsonl.gz']);

      const readBack = await archiver.restoreSession('../ESCAPED_WRITE');
      expect(readBack).not.toBeNull();
      expect(readBack!.id).toBe('../ESCAPED_WRITE');
      expect(readBack!.transcript).toBe('ORIGINAL-TRANSCRIPT');

      // WHY the file entry can serve it — measured, because the intuition says
      // the join should fail: `path.join(archiveDir, 'ESCAPED_WRITE.jsonl.gz',
      // '../ESCAPED_WRITE.jsonl.gz')` does not point INTO the file, it
      // normalises the `..` away and lands back on
      // archiveDir/ESCAPED_WRITE.jsonl.gz. A file entry is a usable join
      // segment purely because the id begins with `../`. A plain id under a
      // file entry does not resolve — that contrast is asserted below.
      const viaFileUnderPlainId = await archiver.restoreSession('ESCAPED_WRITE');
      expect(viaFileUnderPlainId).toBeNull();

      // Remove the file too: now nothing on disk resolves, and the SAME call
      // returns the declared null. Same id, same code path, opposite outcome —
      // which is what makes the object above a real read of the escaped file
      // rather than an artifact of the fixture.
      rmSync(join(testDir, 'ESCAPED_WRITE.jsonl.gz'), { force: true });
      expect(await archiver.restoreSession('../ESCAPED_WRITE')).toBeNull();
    });
  });

  describe('the escape needs gzip, and its failure mode is a THROW not the declared null', () => {
    it('a non-gzip target outside archiveDir throws instead of returning null', async () => {
      writeFileSync(join(outsideDir, 'PLAIN.jsonl.gz'), Buffer.from('{"id":"PLAIN"}'));

      await expect(archiver.restoreSession('../../secrets/PLAIN')).rejects.toThrow();

      // Contrast with the two well-behaved outcomes in the same method: a
      // missing file is a null, an in-tree file is an object. The third
      // outcome — present, in reach, wrong bytes — is an uncaught throw.
      await expect(archiver.restoreSession('../../secrets/ABSENT')).resolves.toBeNull();
    });
  });

  describe('positive controls (the escapes above must not be vacuous)', () => {
    it('a plain id in a YYYY-MM subdir round-trips normally', async () => {
      await archiver.archiveSession(makeSession({ id: 'legit' }));
      const got = await archiver.restoreSession('legit');
      expect(got).not.toBeNull();
      expect(got!.id).toBe('legit');
      expect(got!.transcript).toBe('ORIGINAL-TRANSCRIPT');
      expect(archiver.stats().archivedCount).toBe(1);
    });

    it('archiveDir really does hold exactly the one subdir the escape counts', () => {
      expect(readdirSync(testDir)).toEqual(['2026-01']);
    });
  });
});

/** dirname() of a path, isolated so the assertions above read cleanly. */
function dirnameName(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}
