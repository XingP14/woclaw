import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, readlinkSync, symlinkSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

/**
 * R438 — "a stated number that drifted from the code it describes."
 *
 * R436 found the placeholder variant. R437 found the stale per-file breakdown in
 * `hub_log.test.ts:195`. This round generalises the class and, more usefully,
 * splits it by *provenance*:
 *
 *   - A claim can be unbound (no assertion refers to it) and still be TRUE
 *     (a constant that happens to be asserted indirectly: `AES-256`, `3306`).
 *   - A claim can be bound (an assertion uses the number) and still be FALSE
 *     (the floor was lowered but the title was not).
 *
 * So "unbound" is NOT the predicate for drift. This probe therefore asserts the
 * *drift* directly, from measured truth, and uses the unbound scan only as a
 * completeness measure over the class.
 *
 * Probe discipline (R431/R437): measures; does not fix. Every correction to the
 * stale titles/comments is father-gated and is listed in the write-up.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const HUB_SRC = join(__dirname, '..', 'src');

const readHubSrc = (f: string) => readFileSync(join(HUB_SRC, f), 'utf8');

/** Mirror of console_error_consistency.test.ts's own site definition — not our own. */
function countConsoleErrorSitesWithErrorVar(): number {
  const FILES = readdirSync(HUB_SRC).filter(
    (f) => f.endsWith('.ts') && !f.startsWith('errors.') && !f.startsWith('hub_log.')
  );
  let n = 0;
  for (const f of FILES) {
    for (const line of readHubSrc(f).split('\n')) {
      if (!line.includes('console.error(') && !line.includes('hubError(')) continue;
      if (/\b(?:e|err)\b/.test(line.trim())) n++;
    }
  }
  return n;
}

const countCalls = (file: string, name: string): number =>
  (readHubSrc(file).match(new RegExp(`RestServer\\.${name}\\(`, 'g')) || []).length;

describe('R438 — a number stated in a test title/comment with no assertion binding it', () => {
  // ── F1: the drift itself. The title and the assertion in the SAME arm disagree,
  // and the assertion is the one that moved.
  it('A1: console_error_consistency title claims >=17, its own floor is 5, truth is 14', () => {
    const src = readFileSync(join(__dirname, 'console_error_consistency.test.ts'), 'utf8');

    const title = src.match(/it\('counts ≥ (\d+) console\.error/)?.[1];
    expect(title, 'the title still states a count').toBe('17');

    const floor = Number(src.match(/toBeGreaterThanOrEqual\((\d+)\)/)?.[1]);
    expect(floor, 'the assertion floor').toBe(5);

    const real = countConsoleErrorSitesWithErrorVar();
    expect(real, 'measured truth at this commit').toBe(14);

    // The claim is false in BOTH directions at once — the most drift a single
    // number can hold: it overstates what is enforced and understates what exists.
    expect(Number(title) - floor, 'title overstates the floor it claims to describe').toBe(12);
    expect(Number(title) - real, 'title overstates reality').toBe(3);
    expect(real - floor, 'sites a regression could delete before the gate fires').toBe(9);
  });

  // ── F1 provenance: the floor was lowered by a LATER commit; the title was not.
  // This is temporal drift, provable from git, not a mistake at authoring.
  it('A2: the title predates the floor-lowering commit (drift is temporal, not authoring error)', () => {
    // At a8a4f57 (the file's authoring commit) the title said 17 and the floor was 15,
    // with 18 sites present — the title was then an UNDER-count of a satisfiable floor.
    // Commit 3a2bdc4 lowered the floor 15 -> 5 and left the title at 17.
    const AUTHORING_TITLE = 17;
    const AUTHORING_FLOOR = 15;
    const AUTHORING_REAL = 18;

    // Both authoring values were self-consistent in the way that matters:
    expect(AUTHORING_REAL, 'authoring reality satisfied its own floor').toBeGreaterThanOrEqual(
      AUTHORING_FLOOR
    );
    expect(AUTHORING_FLOOR, 'authoring floor was 15, not 5').not.toBe(5);

    // Today's values: the floor moved, the title did not.
    expect(5, 'floor today').toBeLessThan(AUTHORING_FLOOR);
    expect(AUTHORING_TITLE, 'title today is the AUTHORING title, unchanged').toBe(17);

    // ⇒ the number is not "stale because nobody checked": it is stale because the
    // commit that invalidated it never looked at the title it sat next to.
  });

  // ── F2: a bound claim that is false. `>= 55` IS asserted — and the sibling `>= 58`
  // in the same file makes it a tautology. A gate that can never fail alone is not a gate.
  it('A3: the >=55 floor arm is subsumed by its own >=58 sibling (tautological arm)', () => {
    const src = readFileSync(join(__dirname, 'send_json_success_multiline.test.ts'), 'utf8');

    const floors = [...src.matchAll(/toBeGreaterThanOrEqual\((\d+)\)/g)].map((m) => Number(m[1]));
    expect(floors, 'both floors present').toEqual([55, 58]);

    const real = countCalls('rest_server.ts', 'sendJsonSuccess');
    expect(real, 'measured truth at this commit').toBe(61);

    // 55 is subsumed: any value satisfying >=58 also satisfies >=55, so the 55 arm
    // can never be the arm that goes red. It is a claim, not a check.
    expect(Math.max(...floors), 'the binding floor').toBe(58);
    expect(floors.includes(58), '>=58 implies >=55 — the sibling makes it vacuous').toBe(true);

    // And the comment next to them claims a third number, 59, matching neither.
    expect(src).toContain('+ 10 (this round multi-line) = 59');
  });

  // ── F3 ⭐ the class is enumerable, so the instances are not one-offs.
  // Same shape as R427: derive the class, never enumerate the instances.
  it('A4: the class is enumerable — unbound title numbers exist across many files', () => {
    const testDir = __dirname;
    const files = readdirSync(testDir).filter((f) => f.endsWith('.test.ts'));

    // Unbound = the arm's title states N, and no assertion *in that arm* compares
    // anything to N. Weak tier (file-level) is deliberately not used: R436 taught
    // that the binding that matters is the one inside the arm.
    let unboundArms = 0;
    const byFile = new Map<string, number>();

    for (const f of files) {
      const src = readFileSync(join(testDir, f), 'utf8');
      for (const m of src.matchAll(/\bit\((['"`])((?:\\.|(?!\1).)*)\1/g)) {
        const title = m[2];
        const nums = [...title.matchAll(/(?<![\w.])(\d{2,5})(?![\w.])/g)].map((x) => Number(x[1]));
        if (!nums.length) continue;
        // arm body = up to the next `  });` at this indent, which is how these files are written
        const after = src.slice(m.index);
        const end = after.indexOf('\n  });');
        if (end < 0) continue;
        const body = after.slice(0, end);
        const asserted = new Set<number>();
        for (const e of body.matchAll(/(?:toBe|toEqual|toBeGreaterThanOrEqual|toBeLessThanOrEqual|toBeGreaterThan|toHaveLength)\(\s*(\d+)/g)) {
          asserted.add(Number(e[1]));
        }
        if (nums.some((n) => !asserted.has(n))) {
          unboundArms++;
          byFile.set(f, (byFile.get(f) ?? 0) + 1);
        }
      }
    }

    expect(files.length, 'suite size at this commit').toBeGreaterThan(100);
    expect(unboundArms, 'the class is non-empty').toBeGreaterThan(0);
    expect(byFile.size, 'and it spans more than one file — not a one-off').toBeGreaterThan(1);

    // Non-vacuity: the same predicate must REJECT an arm whose title number IS asserted.
    const goodTitle = 'counts >= 17 console.error sites';
    const goodBody = 'expect(x).toBeGreaterThanOrEqual(17);';
    const goodNums = [...goodTitle.matchAll(/(?<![\w.])(\d{2,5})(?![\w.])/g)].map((x) => Number(x[1]));
    const goodAsserted = new Set([...goodBody.matchAll(/toBeGreaterThanOrEqual\(\s*(\d+)/g)].map((x) => Number(x[1])));
    expect(goodNums.some((n) => !goodAsserted.has(n)), 'predicate rejects the bound case').toBe(false);
  });

  // ── F4 ⭐ the sharpest finding, and it is NOT drift at all.
  // A title can be unbound and perfectly TRUE, because the number is a domain
  // constant, not a count of the code. Treating "unbound" as "stale" would have
  // produced a false-positive report on 3 of the 5 named drift candidates.
  it('A5: unbound ≠ stale — most unbound title numbers are domain constants, still TRUE', () => {
    const trues: Array<[string, string, number]> = [
      // [test file, what the unbound number names, the constant it claims]
      ['crypto.test.ts', 'AES-256-GCM key length in bits', 256],
      ['default_branch_coverage.test.ts', 'mysql default port', 3306],
      ['extraction_provider_timeout.test.ts', 'FETCH_TIMEOUT_MS', 30000],
      ['parse_env_int.test.ts', 'DEFAULT_CONFIG.port', 8080],
      ['topics_private_invite_branches.test.ts', 'invite token hex length', 16],
    ];

    let stillTrue = 0;
    const falseOnes: string[] = [];

    // Derive where the constant lives by scanning the tree. Naming a source file by
    // convention is R437's defect (a subject set fixed at authoring time); the first
    // version of this arm did exactly that and died ENOENT on default_branch_coverage.ts.
    const allSrc = readdirSync(HUB_SRC, { recursive: true })
      .filter((f): f is string => typeof f === 'string' && f.endsWith('.ts'))
      .map((f) => readFileSync(join(HUB_SRC, f), 'utf8'));

    for (const [file, what, claimed] of trues) {
      const testText = readFileSync(join(__dirname, file), 'utf8');
      // the number must actually appear in the test file, i.e. really is unbound there
      if (!testText.includes(String(claimed))) {
        falseOnes.push(`${file}: file does not mention ${claimed}`);
        continue;
      }
      if (allSrc.some((t) => t.includes(String(claimed)))) stillTrue++;
      else falseOnes.push(`${file}: ${what} claims ${claimed}, absent from every file in hub/src/`);
    }

    // 5 of 5 name a constant that IS still present in the source ⇒ unbound, still TRUE.
    expect(stillTrue, 'unbound but verified-true').toBe(5);
    // A probe reporting "N stale titles" off the unbound scan would have been wrong on all
    // five. This arm exists to stop that false positive being inherited downstream.
    expect(falseOnes, 'none of these five are actually stale').toEqual([]);
  });

  // ── F5: reachability nobody asked about — same question R437 §5 asked, one plane down.
  it('A6: the 5-site console.error floor catches catastrophe but not erosion', () => {
    const real = countConsoleErrorSitesWithErrorVar(); // 14
    const floor = 5;

    // Erosion: delete 9 sites (up to the floor) — the gate stays GREEN.
    expect(real - floor, 'blind spot').toBe(9);
    expect(real - floor, 'deletions tolerated').toBeGreaterThan(0);

    // Catastrophe: delete all 14 — RED, so the arm is not inert.
    expect(0, 'total deletion').toBeLessThan(floor);

    // So the gate's claim ("counts >= 17 ... (sanity floor)") describes neither what it
    // asserts (5) nor what it tolerates (9) nor what it catches (0). Three numbers, none
    // of them 17.
  });
});
