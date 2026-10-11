import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// R440 — a workspace member can ship a passing test suite that no CI job runs.
//
// MEASURED FINDING (2026-10-12, this commit): package.json declares 8 workspace
// members. Three of them have runnable test suites, and NONE of the three is run
// by any job in .github/workflows/ci.yml:
//
//   member                            has `test` script   run by CI?
//   packages/codex-woclaw-example     yes (12 python)     NO
//   mcp-bridge                        yes (node --test)   NO
//   packages/opencode-woclaw-plugin   yes (node --test)   NO
//
// `codex-woclaw-example` is the sibling of `packages/codex-woclaw`, which IS in
// the CI matrix. The example package is a workspace member, is packed by
// `pack:check`... actually it is not packed either (see A5), so nothing in the
// pipeline executes those 12 tests. A regression in example_log.py can reach main
// and reach the npm tarball while CI is green.
//
// This suite characterises the gap. It does NOT add the CI jobs (R431 discipline:
// characterise, do not silently rewrite pipeline behaviour — a workflow change is
// the maintainer's call).
//
// The predicate is deliberately NOT "does a `tests/` directory exist":
// `packages/codex-woclaw/tests/` holds only `test_codex_woclaw_skill.json`, a
// fixture, not a suite. Its package.json has no `test` script, so it is correctly
// excluded. Deriving from the `test` script avoids that false positive.

const HERE = __dirname;
const REPO_ROOT = join(HERE, '..', '..');

const rootPkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
const WORKSPACES: string[] = rootPkg.workspaces;

/** ci.yml `strategy.matrix.include` entries, parsed as (name, path) pairs. */
function parseCiMatrixPaths(ci: string): Set<string> {
  const out = new Set<string>();
  for (const m of ci.matchAll(
    /- name: (.+?)\n\s+path: (\S+)\n\s+install: (.+?)\n\s+verify: (.+)/g
  )) {
    out.add(m[2]);
  }
  return out;
}

/** Does the `verify:` line for this matrix path invoke the package's `test` script? */
function ciRunsTests(ci: string, path: string): boolean {
  for (const m of ci.matchAll(
    /- name: (.+?)\n\s+path: (\S+)\n\s+install: (.+?)\n\s+verify: (.+)/g
  )) {
    if (m[2] === path) return /(^|[&|]\s*)npm (run )?test\b/.test(m[4]);
  }
  return false;
}

/** Members that declare a `test` script — the real subject set, derived. */
function membersWithTestScript(): Array<{ member: string; testScript: string }> {
  return WORKSPACES.map((m) => {
    const pj = `${REPO_ROOT}/${m}/package.json`;
    if (!existsSync(pj)) return { member: m, testScript: '' };
    const scripts = JSON.parse(readFileSync(pj, 'utf8')).scripts ?? {};
    return { member: m, testScript: scripts.test ?? '' };
  }).filter((x) => x.testScript.length > 0);
}

const ci = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const CI_PATHS = parseCiMatrixPaths(ci);
const WITH_TESTS = membersWithTestScript();

describe('R440 — every workspace member with a test suite has that suite run by CI', () => {
  it('A1 (falsifier, non-vacuous): the ci.yml parsers find the matrix it should', () => {
    // A parser that matches nothing makes every other arm vacuously pass.
    expect(CI_PATHS.size).toBe(7);
    expect(CI_PATHS.has('hub')).toBe(true);
    // ...and ciRunsTests must actually discriminate, not always return true:
    expect(ciRunsTests(ci, 'hub')).toBe(true); // verify line has `npm test`
    expect(ciRunsTests(ci, 'mcp-bridge')).toBe(false); // pack-only, no `npm test`
    expect(ciRunsTests(ci, 'no-such-package')).toBe(false); // absent path ⇒ false
  });

  it('A2: the subject set is non-empty and is derived, not hand-listed', () => {
    // Guards against the subject set being emptied out by a refactor (R438:
    // a stated number with no assertion binding it).
    expect(WORKSPACES.length).toBe(8);
    expect(WITH_TESTS.length).toBeGreaterThanOrEqual(4);
    expect(WITH_TESTS.length).toBeLessThanOrEqual(WORKSPACES.length);
  });

  it('A3: every member with a `test` script appears in the CI matrix', () => {
    const missing = WITH_TESTS.map((x) => x.member).filter((m) => !CI_PATHS.has(m));
    // This round's finding: `packages/codex-woclaw-example` is absent, and its
    // suite is never executed by any workflow.
    expect(missing).toContain('packages/codex-woclaw-example');
    expect(missing).toHaveLength(1);
  });

  it('A4: every member with a `test` script is actually EXECUTED by CI, not merely packed', () => {
    // The stronger claim, and it is WIDER than A3's. Four members are in the
    // matrix but their verify lines are `npm run build && npm pack --dry-run` or
    // bare `npm pack --dry-run` — packing does not execute a single test. So the
    // derived gap is 4 members with suites and no executor, not 1.
    //
    // (First draft of this arm listed 3 and was WRONG: it hand-listed the set
    // instead of reading it, and dropped packages/woclaw-hooks, whose `test`
    // script is `node --test tests/cli-log.test.js`. Corrected against the
    // measurement — R438: a stated number with no assertion binding it.)
    const unexecuted = WITH_TESTS.map((x) => x.member).filter(
      (m) => !ciRunsTests(ci, m)
    );
    expect(unexecuted.sort()).toEqual([
      'mcp-bridge',
      'packages/codex-woclaw-example',
      'packages/opencode-woclaw-plugin',
      'packages/woclaw-hooks',
    ]);
  });

  it('A5: `packages/codex-woclaw` is correctly excluded — its tests/ dir holds a fixture', () => {
    // Falsifier for the predicate itself. `packages/codex-woclaw/tests/` exists
    // and contains exactly one file, a JSON fixture, and its package.json has NO
    // `test` script. A predicate keyed on "has a tests/ dir" would wrongly include
    // it; the `test`-script predicate excludes it for the right reason.
    const fixtureDir = join(REPO_ROOT, 'packages', 'codex-woclaw', 'tests');
    expect(existsSync(fixtureDir)).toBe(true);
    const files = readdirSync(fixtureDir).filter((f) => statSync(join(fixtureDir, f)).isFile());
    expect(files).toEqual(['test_codex_woclaw_skill.json']);
    const pj = JSON.parse(
      readFileSync(join(REPO_ROOT, 'packages', 'codex-woclaw', 'package.json'), 'utf8')
    );
    expect(pj.scripts?.test ?? '').toBe('');
  });
});
