import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionArchiver } from '../src/session_archive.js';
import type { DBSession } from '../src/types.js';
import { mkdirSync, rmSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

function makeSession(overrides: Partial<DBSession> = {}): DBSession {
  return {
    id: 'sess-' + Math.random().toString(36).slice(2, 10),
    agentId: 'agent-1',
    framework: 'claude-code',
    startedAt: Date.UTC(2026, 5, 15, 12, 0, 0), // 2026-06-15
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

describe('SessionArchiver', () => {
  const testDir = '/tmp/woclaw-test-archive-' + Date.now();
  let archiver: SessionArchiver;

  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    archiver = new SessionArchiver(testDir);
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('creates archive dir on construction', () => {
    const freshDir = join(testDir, 'fresh-' + Date.now());
    expect(existsSync(freshDir)).toBe(false);
    const a = new SessionArchiver(freshDir);
    expect(existsSync(freshDir)).toBe(true);
    expect(a).toBeInstanceOf(SessionArchiver);
  });

  it('archiveSession writes gzip-compressed jsonl under YYYY-MM subdir', async () => {
    const session = makeSession({ id: 'abc-123', startedAt: Date.UTC(2026, 5, 15) });
    const res = await archiver.archiveSession(session);

    expect(res.sessionId).toBe('abc-123');
    expect(res.sizeBytes).toBeGreaterThan(0);
    expect(res.archivedAt).toBeGreaterThan(0);
    expect(res.filePath).toMatch(/2026-06[\\/]abc-123\.jsonl\.gz$/);
    expect(existsSync(res.filePath)).toBe(true);

    // Year-month subdir was auto-created
    const ymDirs = readdirSync(testDir).filter((d) => d === '2026-06');
    expect(ymDirs).toHaveLength(1);
  });

  it('restoreSession round-trips: archive then restore returns DBSession without _archivedAt', async () => {
    const original = makeSession({
      id: 'roundtrip',
      summary: 'a short summary',
      tags: ['x', 'y'],
      importance: 0.42,
    });
    await archiver.archiveSession(original);

    const restored = await archiver.restoreSession('roundtrip');
    expect(restored).not.toBeNull();
    expect(restored!.id).toBe('roundtrip');
    expect(restored!.agentId).toBe('agent-1');
    expect(restored!.framework).toBe('claude-code');
    expect(restored!.summary).toBe('a short summary');
    expect(restored!.tags).toEqual(['x', 'y']);
    expect(restored!.importance).toBe(0.42);
    // _archivedAt must be stripped on restore
    expect((restored as unknown as Record<string, unknown>)._archivedAt).toBeUndefined();
  });

  it('restoreSession returns null when no archive file exists', async () => {
    const restored = await archiver.restoreSession('does-not-exist');
    expect(restored).toBeNull();
  });

  it('listArchived returns all archived sessions sorted by mtime', async () => {
    const a = makeSession({ id: 'a', startedAt: Date.UTC(2026, 5, 1) });
    const b = makeSession({ id: 'b', startedAt: Date.UTC(2026, 5, 2) });
    const c = makeSession({ id: 'c', startedAt: Date.UTC(2026, 5, 3) });
    await archiver.archiveSession(b);
    await new Promise((r) => setTimeout(r, 5));
    await archiver.archiveSession(a);
    await new Promise((r) => setTimeout(r, 5));
    await archiver.archiveSession(c);

    const list = archiver.listArchived();
    expect(list).toHaveLength(3);
    expect(list.map((x) => x.sessionId)).toEqual(['b', 'a', 'c']); // sorted by mtime asc
    for (const entry of list) {
      expect(entry.sizeBytes).toBeGreaterThan(0);
      expect(entry.filePath).toMatch(/\.jsonl\.gz$/);
    }
  });

  it('listArchived skips non-jsonl.gz files and non-directory entries', async () => {
    mkdirSync(join(testDir, '2026-06'), { recursive: true });
    // Create a real archive file via the archiver
    await archiver.archiveSession(makeSession({ id: 'keep' }));
    // Drop a stray non-jsonl file into the same ym subdir (should be ignored)
    const fs = await import('fs');
    fs.writeFileSync(join(testDir, '2026-06', 'stray.txt'), 'ignore me');
    // Drop a stray regular file at archiveDir root (not a directory)
    fs.writeFileSync(join(testDir, 'stray-root.jsonl'), 'ignore me too');

    const list = archiver.listArchived();
    expect(list).toHaveLength(1);
    expect(list[0].sessionId).toBe('keep');
  });

  it('stats reports archivedCount, totalSizeBytes and oldestArchivedAt', async () => {
    await archiver.archiveSession(makeSession({ id: 's1', startedAt: Date.UTC(2026, 5, 1) }));
    await new Promise((r) => setTimeout(r, 5));
    await archiver.archiveSession(makeSession({ id: 's2', startedAt: Date.UTC(2026, 5, 2) }));

    const stats = archiver.stats();
    expect(stats.archivedCount).toBe(2);
    expect(stats.totalSizeBytes).toBeGreaterThan(0);
    expect(stats.oldestArchivedAt).not.toBeNull();
    expect(stats.oldestArchivedAt!).toBeGreaterThan(0);
  });

  it('stats returns zeros and null when archive dir is empty', async () => {
    const emptyDir = join(testDir, 'empty-' + Date.now());
    const a = new SessionArchiver(emptyDir);
    rmSync(emptyDir, { recursive: true, force: true }); // simulate empty
    const stats = a.stats();
    expect(stats.archivedCount).toBe(0);
    expect(stats.totalSizeBytes).toBe(0);
    expect(stats.oldestArchivedAt).toBeNull();
  });
});
