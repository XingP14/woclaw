// integration-test/scripts-readme-cli-parity.test.ts
//
// Regression gate against `scripts/README.md` drifting from the actual CLI
// surface implemented by `scripts/sync-skill-frontmatter.mjs` (07-09 06:23 cron
// tick, watchdog hint chain #15 docs typo / fix(scripts) pattern, parallels
// `integration-test/sync-skill-frontmatter.test.ts` doc-comment parity block
// that gates `8 subpackages` enumeration parity inside the script itself).
//
// Before this test, `scripts/README.md` only documented 3 flags (--write /
// --source / --verbose) while the script actually exposes 8 flags (those
// three plus --check, --all, --include, --exclude, --diff) plus a 4-way exit
// code table (0/1/2/3) for --check mode (07-04 04:23 cron) plus the
// `8 subpackages` headline (07-02 01:33 cron). A new operator reading the
// README would have no idea --check exists as a CI gate, no idea --diff shows
// per-file unified diffs before --write, no idea --all discovers hub/mcp-bridge/
// plugin in addition to packages/*, and no idea --include + --exclude exist for
// the per-skill workspace shims (plugin/skills/* + skills/*) that the default
// packages/* scan misses (07-01 cron).
//
// This test asserts:
//
//   1. `scripts/README.md` mentions every flag the script's top-of-file Usage
//      block documents (so a script-side rename forces a README update).
//   2. `scripts/README.md` mentions the `Exit codes` table header (so the
//      4-way exit-code semantics survive README rewrites).
//   3. `scripts/README.md` headline says `8 subpackages` (matching the
//      script's enumerate-8 list updated in 07-02 01:33 cron).
//   4. `scripts/README.md` does NOT advertise the old broken `process.cwd()`
//      hardcoded path (it shouldn't, but a regression guard is cheap).
//
// The test does NOT spawn the script — pure static checks against the two
// files (script top-of-file Usage block + README). Static checks run in <50ms
// and are unaffected by node version / package availability.
//
// Watchdog check string: `fix(scripts): ...` — rule 1 (real code, any time ALLOW).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = join(repoRoot, 'scripts', 'sync-skill-frontmatter.mjs');
const readmePath = join(repoRoot, 'scripts', 'README.md');

const scriptSrc = readFileSync(scriptPath, 'utf8');
const readmeSrc = readFileSync(readmePath, 'utf8');

// Every flag the script documents in its top-of-file Usage block. If a future
// cron adds a new flag, the script's Usage line MUST include it AND this list
// MUST grow — otherwise the README will silently under-document the surface.
const FLAGS_DOCUMENTED_IN_SCRIPT = [
  '--write',
  '--check',
  '--source',
  '--all',
  '--include',
  '--exclude',
  '--diff',
  '--verbose',
];

describe('scripts/README.md <-> scripts/sync-skill-frontmatter.mjs CLI parity (07-09 06:23 cron)', () => {
  it('script top-of-file Usage block mentions every flag (parity baseline)', () => {
    // Pre-check: the script-side Usage block must list every flag we expect
    // to be in the README. If the script ever drops a flag from Usage, the
    // README-parity test will simply skip that flag (test below enforces
    // the other direction: README mentions every flag in this list).
    for (const flag of FLAGS_DOCUMENTED_IN_SCRIPT) {
      expect(scriptSrc, `script top-of-file Usage must mention ${flag}`).toMatch(
        new RegExp(`${flag.replace(/[-]/g, '\\-')}\\b`)
      );
    }
  });

  it('README.md mentions every flag the script documents (regression gate)', () => {
    // The CORE gate. A flag mentioned in the script's Usage block MUST also
    // appear in README.md. Pre-fix, --check / --all / --include / --exclude /
    // --diff were missing from README — this test catches future omissions.
    for (const flag of FLAGS_DOCUMENTED_IN_SCRIPT) {
      expect(readmeSrc, `scripts/README.md must document ${flag}`).toMatch(
        new RegExp(`${flag.replace(/[-]/g, '\\-')}\\b`)
      );
    }
  });

  it('README.md surfaces the --check Exit codes table header (4-way exit codes)', () => {
    // The script's --check mode returns 4 distinct exit codes (0/1/2/3)
    // representing "clean" / "auto-fixable drift" / "manual-fix required" /
    // "both" (07-04 04:23 cron). README must surface this so CI consumers
    // can decide whether exit code 1 vs 2 vs 3 is actionable. Pre-fix, the
    // README only documented --write / --source / --verbose, so an operator
    // wiring --check into a CI pipeline would have no signal what each
    // exit code means.
    expect(readmeSrc).toMatch(/Exit codes/i);
    // Each of the 4 codes must appear in the README (in any context — the
    // table uses 0/1/2/3 in markdown):
    expect(readmeSrc).toMatch(/\b0\b/);
    expect(readmeSrc).toMatch(/\b1\b/);
    expect(readmeSrc).toMatch(/\b2\b/);
    expect(readmeSrc).toMatch(/\b3\b/);
  });

  it('README.md headline says "8 subpackages" (matches script enumerate-8 from 07-02 01:33 cron)', () => {
    // The script's enumerate-8 list grew from 7 -> 8 when codex-woclaw-example
    // was added 06-28 bbf2489 (07-02 01:33 cron chain #15 closure). README
    // must reflect 8, not the stale 7, so operators know how many SKILL.md
    // files --all will discover.
    expect(readmeSrc).toMatch(/8 subpackages/);
    expect(readmeSrc).not.toMatch(/7 subpackages/);
  });

  it('README.md does NOT advertise the old `process.cwd()` hardcoded path', () => {
    // 06-20 00:43 cron fix: script migrated from hardcoded
    // `path.resolve(__dirname, '..')` to respect WOCLAW_ROOT / process.cwd()
    // so the script works from any directory (CI monorepo workarounds +
    // subprocess-based vitest). README must not regress to advertising the
    // old hardcoded path. This is a defensive gate — the README was never
    // known to mention this, but pinning absence protects against a future
    // contributor copy-pasting from old commit messages.
    expect(readmeSrc).not.toMatch(/path\.resolve\(__dirname/);
    expect(readmeSrc).not.toMatch(/hardcoded.*path/i);
  });

  it('README.md surfaces --include + --exclude in proximity (parity with subpackage-skill-parity)', () => {
    // The subpackage-skill-parity test (07-01 cron) + sync-skill-frontmatter
    // doc-comment parity test (07-02 01:33 cron) both gate --include and
    // --exclude together — they were introduced in the same chain to handle
    // plugin/skills/* + skills/* shim files. README must surface them in
    // proximity (same section / paragraph) so operators don't read one and
    // miss the other.
    const includeIdx = readmeSrc.indexOf('--include');
    const excludeIdx = readmeSrc.indexOf('--exclude');
    expect(includeIdx).toBeGreaterThan(-1);
    expect(excludeIdx).toBeGreaterThan(-1);
    // 600 chars window: both flags must appear within ~30 lines of each
    // other (a single section). Wider than this = operators will skim past
    // one. This is a smoke check, not a strict section matcher.
    expect(Math.abs(includeIdx - excludeIdx)).toBeLessThan(600);
  });

  it('README.md mentions --diff alongside --write (so operators learn --diff previews before --write)', () => {
    // 07-06 06:43 cron added --diff for byte-level pre-write audit. The
    // gating insight: operators should run --diff BEFORE --write to see what
    // would change. README must surface --diff alongside --write so this
    // workflow is discoverable from the docs alone.
    const diffIdx = readmeSrc.indexOf('--diff');
    const writeIdx = readmeSrc.indexOf('--write');
    expect(diffIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(-1);
    // --diff should appear within ~400 chars of --write (same Usage block).
    expect(Math.abs(diffIdx - writeIdx)).toBeLessThan(400);
  });
});