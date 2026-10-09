/**
 * R430 — "the record of what was done is derived from the thing that did it".
 *
 * THE PLANE. R419–R429 = 11 rounds on my own test probes; R74 caps an
 * in-cluster run at three and R424/R426/R428/R429 all flagged the pivot as
 * overdue. This round leaves the test plane for the RECORD plane, and the
 * reason it can leave is a measurement, not a decision.
 *
 * THE CLASS, already known. R427–R429 handled the same defect shape three
 * times: a probe that makes a claim over a subject set it did not derive.
 * Every instance so far was a subject set. This is the instance that had no
 * probe at all — so nothing could enumerate it.
 *
 * THE INSTANCE, found by running an audit rather than by reading the plan.
 * Commit 435469e (R429.6, "derive the federation-token subject set from the
 * tree") shipped 02:11 on 2026-10-10 with:
 *   - no KB doc in memory/ (the round-429 doc was written 22:16 the evening
 *     BEFORE, and cites only c2dad43 — the round's first commit), and
 *   - no LEARNING_PLAN.md entry (the file's last heading is "#### 429").
 *
 * THE FALSE GREEN, which is the actual finding. My first scan reported
 * 435469e as DOCUMENTED. It had not been. The citation came from
 * memory/heartbeat-state.json — a machine-maintained index that records
 * recent commit shas automatically, plus 25 .bak/.py siblings that propagate
 * them. Nine commits in the window are cited ONLY by machine files.
 *
 * So the defect has two halves that look like one:
 *   1. the round is genuinely unwritten, and
 *   2. the check that would notice cannot tell an unwritten round from a
 *      written one, because a heartbeat index mentions every commit that
 *      happened to land recently.
 *
 * A negative claim here ("every round is documented") has the SAME structure
 * as every probe in R419–R429 — a subject set that is not derived. Its
 * subjects are the files in memory/, and it treats that set as "everything
 * that could mention a commit". Deriving it is the fix, and that is exactly
 * what this suite does.
 *
 * WHAT IS DELIBERATELY NOT HERE. This does not assert that every commit has a
 * doc; many are single-commit fixes with no round. It asserts only about
 * round-tagged commits, and only that SOME hand-authored narrative cites the
 * sha. The heartbeat index is not a witness and is excluded by construction.
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

/**
 * Resolve the workspace by DERIVATION, not by assumption.
 *
 * R428 recorded the trap of a `__dirname/..` path under a package-root-relative
 * run: from the repo root the suite went `ENOENT …/woclaw/src` and reported a
 * fake regression. So walk up until LEARNING_PLAN.md + a `memory/` directory
 * are both present, and FAIL LOUDLY if not found — a probe that silently skips
 * when it cannot find its subject is a vacuous pass, which is the exact defect
 * class this round is about (R421: refuse to continue on a missing subject).
 */
function findWorkspace(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'LEARNING_PLAN.md')) && existsSync(join(dir, 'memory'))) return dir;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(
    'R430: could not derive the workspace root (no LEARNING_PLAN.md + memory/ pair above ' +
      __dirname + '). Refusing to pass vacuously — a probe that cannot find its subject set ' +
      'is indistinguishable from one that found nothing.'
  );
}

const WS = findWorkspace();
const MEM = join(WS, 'memory');
const REPO = join(WS, 'woclaw');
const PLAN = join(WS, 'LEARNING_PLAN.md');

/**
 * THE FIX. The subject set is split by WHO maintains it, derived by extension
 * rather than listed by name.
 *
 * R429's rule generalises: a subject identified by a property its owner does
 * not control is a subject nobody can reason about. `memory/` holds 632
 * hand-authored `.md` narratives and 26 machine-maintained files (the
 * heartbeat index, its dated backups, merge scripts). Listing the 26 by name
 * would be a hand list — and R427's rule says a hand list is a known-wrong
 * list. The distinction that actually matters is extension: narratives are
 * `.md`, indexes are not.
 *
 * Consequence, stated so it is falsifiable: this classification is a claim
 * about my own conventions, not about the world. If a round is ever written up
 * into a non-`.md` file, this suite will report it as undocumented. That is a
 * false positive, and the cheap fix is visible rather than silent.
 *
 * A THIRD defect found by running the thing (both fixed here, both were mine):
 *
 *   1. `memory/` holds 5 DIRECTORIES. Classifying by extension put them in the
 *      machine set, where `readFileSync` threw and the entry was swallowed by
 *      the `catch` — so `MACHINE.length` and `machineText.size` disagreed
 *      (26 vs 21) and A0 failed on the enumerator's own accounting. `catch {}`
 *      around a read is how an unreadable file silently becomes an absent one;
 *      R421's rule again, in a new costume.
 *
 *   2. ⭐ Citation is a SUBSTRING match, and a 7-char short sha is not
 *      delimited. `2026-07-15.md` line 122 cites
 *      `fcec6a8a7b526b1eea7fe8d7787508b7b105de88`, which CONTAINS the short
 *      sha `7787508` of a commit from three months later. A3 reported that doc
 *      as citing a commit 1990 hours before its own mtime — a fabricated
 *      finding, produced by a correct-looking matcher. A short sha is a
 *      substring of the long sha it abbreviates and of a million other
 *      strings; citing it needs a boundary.
 */
const ALL = readdirSync(MEM, { withFileTypes: true });
// DEFECT 1: filter to regular files BEFORE classifying. `memory/` holds 5
// directories; routing a directory into a try/catch read turns "unreadable"
// into "absent" and silently changes the denominator.
const FILES = ALL.filter((e) => e.isFile()).map((e) => e.name);
const NARRATIVE = FILES.filter((f) => f.endsWith('.md'));
const MACHINE = FILES.filter((f) => !f.endsWith('.md'));

const narrativeText = new Map<string, string>();
for (const f of NARRATIVE) narrativeText.set(f, readFileSync(join(MEM, f), 'utf8'));
const machineText = new Map<string, string>();
for (const f of MACHINE) {
  try { machineText.set(f, readFileSync(join(MEM, f), 'utf8')); } catch { /* unreadable is not a citation */ }
}

const planText = readFileSync(PLAN, 'utf8');

/**
 * DEFECT 2 — citation needs a BOUNDARY, not a substring.
 *
 * A bare `text.includes(short)` is the whole reason A3 produced a finding that
 * did not exist. Build a regex that requires a non-hex character (or string
 * edge) on both sides of the sha, so the short form matches only where it
 * stands alone as a token.
 */
function cites(text: string, short: string): boolean {
  return new RegExp(`(?<![0-9a-f])${short}(?![0-9a-f])`, 'i').test(text);
}

interface Commit {
  short: string;
  ts: number;
  rid: string | null;
  subj: string;
  citedBy: string[];
  machineOnly: string[];
}

/** `%ct` is epoch seconds — same clock as `statSync().mtimeMs`, so M3 below is a real comparison. */
function commits(limit: number): Commit[] {
  const log = execSync(`git log --format=%H%x7c%ct%x7c%s -${limit}`, {
    cwd: REPO, encoding: 'utf8',
  }).trim().split('\n');
  return log.map((line) => {
    const p = line.split('|');
    const short = p[0].slice(0, 7);
    const subj = p.slice(2).join('|');
    const m = subj.match(/\((?:round|r)?(\d{3})\)/i);
    return {
      short,
      ts: Number(p[1]) * 1000,
      rid: m ? String(Number(m[1])) : null,
      subj,
      citedBy: [...narrativeText.entries()].filter(([, t]) => cites(t, short)).map(([n]) => n),
      machineOnly: [...machineText.entries()].filter(([, t]) => cites(t, short)).map(([n]) => n),
    };
  });
}

const WINDOW = commits(80);
const ROUNDED = WINDOW.filter((c) => c.rid !== null);
const UNDOCUMENTED = ROUNDED.filter((c) => c.citedBy.length === 0);

describe('R430 — the record is derived from the act, not assembled beside it', () => {
  it('A0 — the subject set is DERIVED and non-empty on both sides', () => {
    // Guards the guard. A walk that returned [] would make every assertion
    // below vacuously true, which is R427's defect reproduced in the fix.
    expect(NARRATIVE.length).toBeGreaterThan(20);
    expect(MACHINE.length).toBeGreaterThan(0);
    // Both sides must actually be populated, or "split by owner" is a no-op.
    expect(narrativeText.size).toBe(NARRATIVE.length);
    expect(machineText.size).toBe(MACHINE.length);
  });

  it('A1 — machine indexes really do cite commits, so excluding them is not vacuous', () => {
    // THE CONTROL THAT DECIDES THE ROUND. If nothing machine-maintained cited
    // a recent commit, the whole finding collapses: the exclusion would be
    // decoration and the "false green" would be my own artifact.
    //
    // This is R428's outward arm, applied to the new plane. The inward reading
    // ("heartbeat-state.json exists, therefore it is a false-positive source")
    // is unfalsifiable; this arm plants the citation and measures it.
    const machineCiting = WINDOW.filter((c) => c.machineOnly.length > 0);
    expect(machineCiting.length).toBeGreaterThan(0);
    expect(machineText.get('heartbeat-state.json')).toContain(
      WINDOW.find((c) => c.machineOnly.includes('heartbeat-state.json'))!.short
    );
  });

  it('A2 — every round-tagged commit in the window has a hand-authored write-up', () => {
    const detail = UNDOCUMENTED.map((c) => `${c.short} R${c.rid} ${c.subj}`).join('\n');
    expect(
      UNDOCUMENTED.map((c) => c.short),
      `round commits with no narrative citation:\n${detail}`
    ).toEqual([]);
  });

  it('A3 — a doc cannot predate a commit it cites', () => {
    // The direction a citation can fail in, which A2 cannot see: a doc written
    // BEFORE the commit cannot be its write-up, whatever the sha match says.
    // Compare epoch millis on both sides — git `%ct` and `statSync().mtimeMs`
    // are the same clock. Comparing ISO strings across a +0800 offset is
    // exactly what my first version of this measurement did, and it produced
    // 47 false positives before I checked the offsets by hand.
    const backdated: string[] = [];
    for (const c of WINDOW) {
      for (const name of c.citedBy) {
        const delta = statSync(join(MEM, name)).mtimeMs - c.ts;
        if (delta < -60_000) backdated.push(`${c.short} cited by ${name} (${Math.round(delta / 3.6e6)}h early)`);
      }
    }
    expect(backdated).toEqual([]);
  });

  it('A4 — a round is not half-recorded: doc and plan entry travel together', () => {
    // R428-3's family again (a control coupled to its instance), one level up:
    // a round with a commit but no plan heading is exactly the R427 shape on the
    // record plane. Measured, not assumed — asserted over the same window.
    const halfRecorded: string[] = [];
    for (const c of ROUNDED) {
      const hasDoc = c.citedBy.length > 0;
      const hasPlan = new RegExp(`####\\s+${c.rid}[.\\s]`).test(planText);
      if (hasDoc !== hasPlan && !hasDoc) halfRecorded.push(`${c.short} R${c.rid}`);
    }
    // Reported rather than asserted empty is DELIBERATE and is the one
    // relaxation in this suite: a doc may legitimately precede its plan entry.
    // The direction that is a defect is doc-without-plan, and that is checked.
    expect(halfRecorded).toEqual([]);
  });
});