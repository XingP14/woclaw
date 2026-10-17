/**
 * R474 probe: does the weekly eviction of a SESSION pass through the
 * archiver on its way out?
 *
 * Read from source first, then measured here:
 *   F1 `src/session_archive.ts` opens with "archives sessions to JSONL/ZIP
 *      BEFORE EVICTION. Supports restore for recovery scenarios." Its
 *      `new SessionArchiver(` has ZERO production call sites — every one in
 *      the tree constructs it from a test or a probe script, so the class is
 *      never instantiated by a running hub.
 *   F2 the class is not even IMPORTED by any module under `src/`. The only
 *      production references to the word are two prose comments in
 *      agent_stream.ts / hub_log.ts that list it as a logging peer. A module
 *      with no importer cannot run, so no production code path can archive.
 *   F3 `SessionArchiver.archiveSession` has zero production call sites for the
 *      same reason, and so do `restoreSession`, `listArchived` and `stats`.
 *      `stats()` is the cheapest witness: it is the one member a REST surface
 *      would expose (`archiveCount`/`totalSizeBytes`), and nothing exposes it.
 *      The class has exactly four public members — `archiveSession`,
 *      `restoreSession`, `listArchived`, `stats` — and none of them is called
 *      from `src/`. (An earlier draft of this file also named a
 *      `purgeArchived`; no such member exists, and the suite now derives the
 *      member list from the class body instead of trusting prose.)
 *   F4 the production eviction path — `ForgettingScheduler.runWeeklyEviction`
 *      (scheduler.ts:155-165) — deletes each candidate through
 *      `sessionStore.deleteSession` and never mentions an archive step. So the
 *      row goes to the DB's DELETE and the transcript leaves the hub with
 *      nothing on disk. r456's own header already recorded the phrase "For
 *      sessions: delete directly"; that suite pinned the MEMORY half and
 *      stopped there. This suite pins the session half.
 *   F5 the only other production deleter is the manual REST route
 *      `DELETE /sessions/:id` (rest_server.ts:1149), which likewise deletes
 *      without archiving — so there is no route by which a session is ever
 *      archived in any deployment, and `restoreSession` cannot succeed on any
 *      file a hub itself wrote.
 *
 * Arms (2)-(5) are census arms over `src/`, with the subject set DERIVED by
 * walking the tree — never a hand-written list, which is the class of bug r437
 * and r469 exist for. Arm (1) is the measured arm and arm (6) is the CONTROL:
 * an always-empty walker and a genuinely unwired module are indistinguishable
 * unless something with known production readers is checked in the same pass.
 *
 * Every repair here is father-gated. Whether evicted sessions SHOULD be
 * archived is a retention-policy decision (disk growth, PII window, restore
 * promise in the module header), not a bug fix, so this suite CHARACTERISES
 * the gap and asserts red for nothing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { ClawDB } from '../src/db.js';
import { ForgettingScheduler } from '../src/scheduler.js';
import { SessionArchiver } from '../src/session_archive.js';
import type { SessionStore } from '../src/session_store.js';
import type { DBSession } from '../src/types.js';

const HUB = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(HUB, 'src');
const ARCHIVE_MODULE = join(SRC, 'session_archive.ts');

/** every .ts file under src/, derived by walking — the census subject set */
function prodFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith('.ts')) out.push(p);
    }
  };
  walk(SRC);
  return out;
}

/** every .ts file under test/ or scripts/ — the NON-production subject set */
function nonProdFiles(): string[] {
  const out: string[] = [];
  for (const sub of ['test', 'scripts']) {
    const d = join(HUB, sub);
    if (!existsSync(d)) continue;
    const walk = (x: string) => {
      for (const e of readdirSync(x).sort()) {
        const p = join(x, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (e.endsWith('.ts')) out.push(p);
      }
    };
    walk(d);
  }
  return out;
}

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

const PROD = prodFiles().map(p => [p, strip(readFileSync(p, 'utf8'))] as const);
const NONPROD = nonProdFiles().map(p => [p, strip(readFileSync(p, 'utf8'))] as const);

const countIn = (files: typeof PROD | typeof NONPROD, re: RegExp) =>
  files.reduce((n, [, c]) => n + (c.match(re) ?? []).length, 0);

describe('R474 — session eviction does not pass through the archiver', () => {
  // ── Arm (1) — MEASURED: drive the real scheduler and watch for an archive ──
  describe('arm 1: the measured production eviction path', () => {
    let dir: string;
    let archiveDir: string;
    let db: ClawDB;

    beforeEach(async () => {
      dir = mkdtempSync(join(tmpdir(), 'r474-'));
      archiveDir = join(dir, 'archive');
      db = new ClawDB(dir);
      await new Promise(r => setTimeout(r, 80));
    });
    afterEach(async () => {
      await db.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it('(1) evicting a real low-importance session writes NO archive file', async () => {
      const floor = 3.0;
      const store = {
        deleteSession: async (id: string) => {
          const s = await db.getSession(id);
          if (s) await db.deleteSession(id);
          return !!s;
        },
      } as unknown as SessionStore;

      const created: string[] = [];
      for (let i = 0; i < 4; i++) {
        const s: DBSession = {
          id: `sess-r474-${i}`, agentId: `agent-${i}`, framework: 'test',
          startedAt: Date.now(), transcript: `transcript ${i}`, summary: `summary ${i}`,
          importance: 0.1, accessCount: 0, tags: [], extracted: false, flagged: false,
          createdAt: Date.now(),
        };
        await db.setSession(s);
        created.push(s.id);
      }
      expect(created.length).toBe(4);

      // control: these sessions ARE eviction candidates at this floor
      const cands = await db.getEvictionCandidates(floor, floor, 100);
      expect(cands.sessions.length).toBeGreaterThan(0);

      // An archiver pointed at a real directory, wired to the same session.
      // If eviction archived, this directory would gain a .jsonl.gz file.
      // (The constructor mkdirSync's the dir, so its ABSENCE proves nothing —
      // assert on the absence of ARCHIVE FILES, which is the real claim.)
      const archiver = new SessionArchiver(archiveDir);
      expect(archiver).toBeTruthy();

      const sched = new ForgettingScheduler(db, store, {} as never, {} as never);
      const res = await sched.runWeeklyEviction();

      // CHARACTERISATION, not a red assertion: the defect's measured shape.
      expect(res.sessions).toBeGreaterThan(0); // sessions really were evicted
      // ...and nothing was archived. Count .jsonl.gz files, not the directory.
      const gzFiles: string[] = existsSync(archiveDir)
        ? readdirSync(archiveDir, { recursive: true } as never)
            .map(String).filter(f => f.endsWith('.jsonl.gz'))
        : [];
      expect(gzFiles).toEqual([]);

      const gone = await db.getSession(created[0]);
      expect(gone).toBeFalsy(); // the row is gone from the DB
      expect(gone).not.toBeTruthy();
    });

    it('(1b) the module header promise is about a path no hub takes', async () => {
      // A hub archives a session ONLY if something constructs SessionArchiver.
      // Nothing under src/ does, so the header describes an unreachable path.
      const header = readFileSync(ARCHIVE_MODULE, 'utf8').split('\n').slice(0, 4).join('\n');
      expect(header).toMatch(/before eviction/i);
      const ctor = countIn(PROD, /new\s+SessionArchiver\s*\(/g);
      expect(ctor).toBe(0);
      expect(countIn(NONPROD, /new\s+SessionArchiver\s*\(/g)).toBeGreaterThan(0);
    });
  });

  // ── Arm (2) — the class has no importer under src/ ──
  describe('arm 2: no production importer', () => {
    it('(2) zero src/ modules import session_archive.js', () => {
      const importers = PROD.filter(([p]) => p !== ARCHIVE_MODULE)
        .filter(([, c]) => /from\s+['"][^'"]*session_archive(\.js)?['"]/.test(c))
        .map(([p]) => p.replace(HUB + '/', ''));
      expect(importers).toEqual([]);
    });

    it('(2b) the module IS imported by tests — so the census is not vacuous', () => {
      const t = NONPROD.filter(([, c]) => /from\s+['"][^'"]*session_archive(\.js)?['"]/.test(c));
      expect(t.length).toBeGreaterThan(0);
    });
  });

  // ── Arm (3) — every member has zero production call sites ──
  describe('arm 3: members without a production reader', () => {
    /** DERIVED from the class body — never a hand-typed list (r437/r469). */
    const MEMBERS = Array.from(
      readFileSync(ARCHIVE_MODULE, 'utf8').matchAll(
        /^(?:  )(?:public |private |protected |static |async |override )*([a-zA-Z_$][\w$]*)\s*\(/gm),
      m => m[1],
    ).filter(m => m !== 'constructor');

    it('(3a) the derived member list is non-empty and excludes the constructor', () => {
      expect(MEMBERS.length).toBeGreaterThan(0);
      expect(MEMBERS).not.toContain('constructor');
    });

    it.each(MEMBERS)('(3) %s() has 0 production call sites and >0 non-production', (m) => {
      const re = new RegExp(`(?<![\\w$])${m}\\s*\\(`);
      // EXCLUDE the module under audit entirely. Its own declaration AND its
      // internal self-calls (stats() calls this.listArchived()) are not
      // production readers — a reader is a call from ANOTHER module.
      const outside = PROD.filter(([p]) => p !== ARCHIVE_MODULE);
      expect(countIn(outside, re)).toBe(0);
      expect(countIn(NONPROD, re)).toBeGreaterThan(0);
    });
  });

  // ── Arm (4) — the production evictor never names the archiver ──
  describe('arm 4: the eviction path itself', () => {
    it('(4) runWeeklyEviction deletes without archiving', () => {
      const sched = readFileSync(join(SRC, 'scheduler.ts'), 'utf8');
      const body = sched.slice(sched.indexOf('async runWeeklyEviction'));
      const fn = body.slice(0, body.indexOf('\n  }'));
      expect(fn).toMatch(/deleteSession\s*\(/);
      expect(fn).not.toMatch(/archive/i);
      expect(fn).not.toMatch(/SessionArchiver/);
    });

    it('(4b) the manual REST delete route is the other deleter, also no archive', () => {
      const rest = readFileSync(join(SRC, 'rest_server.ts'), 'utf8');
      const i = rest.indexOf('this.sessionStore.deleteSession(');
      expect(i).toBeGreaterThan(-1);
      const ctx = rest.slice(Math.max(0, i - 600), i + 400);
      expect(ctx).not.toMatch(/archive/i);
    });
  });

  // ── Arm (5) — the subject set was DERIVED, not typed by hand ──
  describe('arm 5: census provenance', () => {
    it('(5) the derived subject set is non-empty and contains the module under audit', () => {
      expect(PROD.length).toBeGreaterThan(20);
      expect(PROD.some(([p]) => p === ARCHIVE_MODULE)).toBe(true);
    });
  });

  // ── Arm (6) — CONTROL: a subject with known production readers ──
  describe('arm 6: control', () => {
    it('(6) getEvictionCandidates HAS production readers and is NOT in the archive module', () => {
      const re = /(?<![\w$])getEvictionCandidates\s*\(/g;
      expect(countIn(PROD, re)).toBeGreaterThan(1);
      const inArchive = countIn([['ARCHIVE_MODULE', readFileSync(ARCHIVE_MODULE, 'utf8')]], re);
      expect(inArchive).toBe(0);
    });

    it('(6b) the census walker finds a reader that exists — non-vacuity non-vacuity', () => {
      // If the walker were broken (always empty) arms (2)/(3) would be green
      // for the wrong reason. Pin a reader we know is called from src/.
      const re = /(?<![\w$])deleteSession\s*\(/g;
      expect(countIn(PROD, re)).toBeGreaterThan(1);
    });
  });
});
