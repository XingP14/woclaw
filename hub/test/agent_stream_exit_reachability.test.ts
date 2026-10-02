/**
 * R401 / L401.3 — exit-code REACHABILITY audit.
 *
 * Spec source: docs/S92-AGENT-STREAM-PROTOCOL.md §3.3 (7 exit codes).
 * R92.6 (2026-07-25) shipped 59 contract tests asserting the *vocabulary*
 * exists. R401 (2026-10-02) found 5/7 codes have no producer in production
 * source — the contract was satisfiable by nobody.
 *
 * Pitfall #401-1: VocabularyWithoutProducerIsNotAContract.
 * A vocabulary test proves the list parses. It cannot prove the list is
 * satisfiable. That is a different assertion and needs a different test.
 *
 * ── Design correction, made while shipping this file ────────────────────────
 * The first draft scanned for any `exit: '<code>'` literal and treated a hit
 * as a producer. Two things that draft got wrong, both now fixed:
 *
 *   1. `agent_stream.ts:201` contains the text `exit: "config"` inside a
 *      *comment* explaining that consumers treat EOF-without-result as
 *      config. A naive scan credited that comment as a producer, which would
 *      have permanently hidden one of the five dead codes. Comments are
 *      stripped before matching.
 *   2. The draft also flagged `ok` and `error` as orphans. That is wrong and
 *      in the opposite direction: both are satisfied by a *different* producer
 *      class — they arrive on the agent's own `result` envelope and the hub
 *      forwards them (rest_server.ts:379, ws_server.ts:343). Treating a
 *      forwarded code as missing would train people to ignore this gate.
 *
 * So reachability has two classes, and a code is alive if it has either:
 *   (a) IN_HUB_PRODUCED   — hub assigns the literal to an `exit` field
 *   (b) ENVELOPE_FORWARDED — hub reads `lastEvent.exit` and relays it
 * Everything else is unreachable, and must be an explicit, tracked exception.
 *
 * CI contract: adding a member to AGENT_STREAM_EXITS with no producer and no
 * entry here turns this file red on the next run. That is the entire point.
 */

import { describe, it, expect } from 'vitest';
import {
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { AGENT_STREAM_EXITS } from '../src/agent_stream.js';

/**
 * Codes with no producer, as of 2026-10-02 (HEAD 252f183).
 *
 * A *baseline*, not an endorsement: each entry names the ladder item that will
 * close it, so the debt is tracked rather than forgotten. Delete an entry the
 * day a producer lands — the staleness test below then enforces it.
 */
const KNOWN_UNREACHABLE: Record<string, string> = {
  budget: 'L401.2 reaper (reason=budget_exhausted), or the L307 budget-controller',
  timeout: 'L401.1 lease + L401.4 deadline — needs a reaper to stamp a terminal exit',
  config: 'L401.2 reaper (reason=config); note agent_stream.ts:201 only *documents* it in a comment',
  rate_limited: 'L307 budget-controller (unblocked)',
  interrupted: 'L401.2 reaper (reason=aborted), or an explicit delegate_cancel producer',
};

/** Reachable because the hub relays the value the agent itself reported. */
const ENVELOPE_FORWARDED: readonly string[] = ['ok', 'error'];

/**
 * Resolve the audited trees from THIS FILE's location, never from
 * process.cwd().
 *
 * Pitfall #401-2: CwdDependentSourceScanIsASilentGreen.
 * This file originally used `join(process.cwd(), 'src')` and
 * `join(process.cwd(), '..', '..', 'packages')`. Its verdict changed
 * with the launch directory:
 *
 *   from woclaw/hub/ (the CI matrix job's working-directory) ->
 *     HUB_SRC      = <repo>/hub/src            correct
 *     PACKAGES_SRC = ~/.hermes/workspace/packages   ← a FOREIGN tree,
 *                    two levels above the repo, belonging to the Hermes
 *                    workspace and not to WoClaw at all
 *   from the repo root ->
 *     HUB_SRC      = <repo>/src               does not exist
 *     PACKAGES_SRC = ~/.hermes/packages       does not exist
 *
 * `walk()` swallows a missing directory (returns []), so the scan
 * silently found ZERO files and the two "is the scan alive?" tests
 * turned red -- but the headline audit still reported all 7 codes as
 * correctly classified. A reachability audit that audits nothing is
 * worse than no audit: it looks like evidence.
 *
 * The forward-reference hazard is the reason this must be anchored:
 * from the repo root, PACKAGES_SRC pointed at an unrelated repo that
 * happened to sit two levels up. If any future file there ever matched
 * `exit: '<code>'`, this test would have credited a producer in
 * WoClaw on the strength of code from another repository.
 */
const HERE = dirname(fileURLToPath(import.meta.url)); // <repo>/hub/test
const REPO_ROOT = join(HERE, '..', '..');
const HUB_SRC = join(HERE, '..', 'src');
const PACKAGES_SRC = join(REPO_ROOT, 'packages');

/** Resolved scan roots, asserted against the file's own location below. */
export const SCAN_ROOTS = { HUB_SRC, PACKAGES_SRC, REPO_ROOT };

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      // Without this, PACKAGES_SRC walks every package's node_modules.
      // packages/woclaw-vscode/node_modules/@types/node alone matches
      // the `\.exit\b` forwarding probe, so vendored TypeScript
      // declarations would have satisfied the "at least one forwarding
      // site" test on their own.
      if (!SKIP_DIRS.has(e.name)) out = out.concat(walk(p));
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && !e.name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

/** Directories never worth auditing: vendored deps, build output, VCS. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.git', 'out', 'build']);

/** Strip comments so a documented exit is never mistaken for a produced one. */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Fail loudly if a scan root does not exist.
 *
 * The original `walk()` returned [] for a missing directory. That is
 * correct for a nested subdirectory being walked out of, but it is
 * exactly wrong for a ROOT: a renamed or moved source tree produced
 * an empty scan that still produced a confident report.
 */
function requireRoot(dir: string): void {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(
      `Reachability scan root does not exist: ${dir}\n` +
        `This test anchors paths to import.meta.url, so this failure means the ` +
        `source tree moved — update the anchors, do not make the walk tolerant.`,
    );
  }
}

requireRoot(HUB_SRC);
requireRoot(PACKAGES_SRC);

const productionFiles = [...walk(HUB_SRC), ...walk(PACKAGES_SRC)];
const productionCode = new Map(productionFiles.map((f) => [f, codeOf(f)]));

/** (a) Does any production file assign this exit literal to an `exit` field? */
function producersFor(code: string): string[] {
  const literal = new RegExp(`exit\\s*[:=]\\s*['"\`]${code}['"\`]`);
  return productionFiles.filter((f) => literal.test(productionCode.get(f)!));
}

/** (b) Does the hub relay an agent-reported exit? */
function forwardingSites(): string[] {
  return productionFiles.filter((f) => /\.exit\b/.test(productionCode.get(f)!));
}

describe('R401.3 — agent-stream exit reachability (§3.3)', () => {
  it('scans a non-empty production source set (guards a silently empty scan)', () => {
    expect(productionFiles.length).toBeGreaterThan(5);
  });

  it('has at least one envelope-forwarding site — else class (b) is imaginary', () => {
    // If nobody forwards, ENVELOPE_FORWARDED is dead metadata and ok/error
    // would silently become orphans. Keep the assumption load-bearing.
    expect(forwardingSites().length).toBeGreaterThan(0);
  });

  it('every exit code is produced, envelope-forwarded, or a tracked exception', () => {
    const orphans: string[] = [];
    const report: string[] = [];

    for (const code of AGENT_STREAM_EXITS) {
      const producers = producersFor(code);
      if (producers.length > 0) {
        report.push(`  ${code}: IN_HUB_PRODUCED (${producers.length}) — ${producers[0]}`);
      } else if ((ENVELOPE_FORWARDED as readonly string[]).includes(code)) {
        report.push(`  ${code}: ENVELOPE_FORWARDED — no in-hub assignment, by design`);
      } else if (code in KNOWN_UNREACHABLE) {
        report.push(`  ${code}: UNREACHABLE (tracked debt -> ${KNOWN_UNREACHABLE[code]})`);
      } else {
        orphans.push(code);
      }
    }

    // Always emit: a silent audit is worth nothing.
    console.log('R401.3 exit reachability audit:\n' + report.join('\n'));

    expect(
      orphans,
      'Exit code(s) with no producer and no tracked exception. Implement a producer, or ' +
        'record them in KNOWN_UNREACHABLE with the ladder item that will close them.',
    ).toEqual([]);
  });

  it('KNOWN_UNREACHABLE holds no stale entries (a stale entry disarms the gate)', () => {
    const stale = Object.keys(KNOWN_UNREACHABLE).filter(
      (c) => !(AGENT_STREAM_EXITS as readonly string[]).includes(c) || producersFor(c).length > 0,
    );
    expect(stale, 'Remove these — the code was deleted or now has a producer.').toEqual([]);
  });

  it('ok and error are forwarded, not orphaned (the two codes that must never regress)', () => {
    expect(AGENT_STREAM_EXITS).toContain('ok');
    expect(AGENT_STREAM_EXITS).toContain('error');
    expect(KNOWN_UNREACHABLE.ok).toBeUndefined();
    expect(KNOWN_UNREACHABLE.error).toBeUndefined();
    expect(ENVELOPE_FORWARDED).toEqual(expect.arrayContaining(['ok', 'error']));
  });

  it('scan roots are anchored to this file, not to process.cwd()', () => {
    // The direct assertion behind pitfall #401-2. If a future edit
    // reintroduces process.cwd() into the path construction, the scan
    // roots stop tracking the file and this goes red — from every
    // launch directory, which is the point.
    expect(HUB_SRC).toBe(join(HERE, '..', 'src'));
    expect(PACKAGES_SRC).toBe(join(REPO_ROOT, 'packages'));

    // And they must actually be the repo's trees. A cwd-relative path
    // that happens to exist somewhere else is the exact failure.
    expect(resolve(HUB_SRC)).toBe(resolve(HERE, '..', 'src'));
    expect(resolve(PACKAGES_SRC)).toBe(resolve(REPO_ROOT, 'packages'));
    expect(SCAN_ROOTS.REPO_ROOT).toBe(REPO_ROOT);
  });

  it('the verdict does not depend on the launch directory (end-to-end CWD proof)', () => {
    // Asserting on the path strings above is a proxy. This is the
    // actual property.
    //
    // Reconstruct the scan roots the way the pre-fix code derived them
    // and show that for EVERY plausible launch directory the pair was
    // wrong *somewhere* — the two roots cannot both be right from any
    // single cwd. Per-root truth:
    //
    //   cwd = <repo>/hub  -> HUB_SRC correct, PACKAGES_SRC = a FOREIGN
    //                        tree two levels up (the Hermes workspace's
    //                        own packages/, not WoClaw's)
    //   cwd = <repo>      -> HUB_SRC does not exist, PACKAGES_SRC does
    //                        not exist
    //
    // So there was no launch directory at which this audit was
    // scanning the right things, which is exactly why it looked healthy
    // and never was.
    const anchored = { ...SCAN_ROOTS };

    // Real launch directories for this repo, plus hostile ones.
    const candidateCwds = [process.cwd(), REPO_ROOT, HERE, join(REPO_ROOT, 'hub'), tmpdir(), '/'];

    for (const cwd of candidateCwds) {
      const cwdDerived = {
        HUB_SRC: join(cwd, 'src'),
        PACKAGES_SRC: join(cwd, '..', '..', 'packages'),
      };
      // The anchored roots are a pure function of the file's own
      // location, so no cwd can perturb them.
      expect(anchored).toEqual({ ...SCAN_ROOTS });

      // The pair is never simultaneously correct.
      const bothCorrect =
        cwdDerived.HUB_SRC === anchored.HUB_SRC && cwdDerived.PACKAGES_SRC === anchored.PACKAGES_SRC;
      expect(
        bothCorrect,
        `cwd ${cwd} reproduced the anchored roots — the cwd derivation is ` +
          `redundant and the audit was never actually broken. Re-verify ` +
          `before touching the anchors.`,
      ).toBe(false);
    }

    // The forward-reference hazard, stated concretely. The old
    // derivation from cwd=<repo>/hub pointed two levels up:
    //
    //     <repo>/hub/../../packages
    //
    // On a developer box that is another repository's packages/
    // directory — real, populated, and NOT part of WoClaw. Any file
    // there matching `exit: '<code>'` would have been credited as a
    // producer in this repo. Anchored to the repo, that path is
    // unreachable by construction.
    //
    // Asserted as PURE PATH ARITHMETIC, deliberately. An earlier
    // draft also asserted `existsSync(fromHub) === true` to show the
    // foreign path was "real, and wrong" — that passed here and FAILED
    // in CI, because on a GitHub runner the same path is just
    // /home/runner/work/packages and does not exist. Encoding a fact
    // about the machine into a repo test is the very failure mode this
    // commit removes, so the assertion stays a function of the
    // strings alone and holds on every checkout.
    const fromHub = resolve(REPO_ROOT, 'hub', '..', '..', 'packages');
    expect(fromHub).not.toBe(resolve(anchored.PACKAGES_SRC));
    // And the anchored roots are the repo's own, not a neighbour's.
    expect(resolve(anchored.PACKAGES_SRC)).toBe(resolve(REPO_ROOT, 'packages'));
    expect(resolve(anchored.HUB_SRC)).toBe(resolve(REPO_ROOT, 'hub', 'src'));

    // Sanity: the real source trees are reachable from the anchor, so
    // the assertions above are not vacuously true.
    expect(existsSync(anchored.HUB_SRC)).toBe(true);
    expect(existsSync(anchored.PACKAGES_SRC)).toBe(true);
  });

  it('walk() does not descend into vendored dependency trees', () => {
    // Synthetic fixture, not a self-assertion on the repo's own
    // layout. Reproduces the shape that actually bites: a vendored
    // package whose sources match the forwarding probe, sitting next
    // to one real source file.
    //
    // Load-bearing rather than defensive: SKIP_DIRS is easy to delete
    // as "cleanup", because in THIS repo the node_modules TypeScript
    // matching `\.exit\b` is all `.d.ts`, which the file-extension
    // filter already drops. The two filters mask each other, and
    // removing either one alone changes nothing — verified by
    // mutation: M3 (SKIP_DIRS disabled) SURVIVED until this test
    // existed. Two redundant-looking filters with no test is exactly
    // how a false-green comes back.
    const root = mkdtempSync(join(tmpdir(), 'r4013-walk-'));
    try {
      mkdirSync(join(root, 'node_modules', 'vendored'), { recursive: true });
      mkdirSync(join(root, 'src'), { recursive: true });
      mkdirSync(join(root, 'dist'), { recursive: true });

      // Each of these WOULD be picked up by the probes: `.exit\b` for
      // the forwarding test, an `exit: 'config'` literal for the
      // producer test.
      writeFileSync(
        join(root, 'node_modules', 'vendored', 'dep.ts'),
        "const e = { exit: 'config' };\nexport const x = e.exit;\n",
      );
      writeFileSync(join(root, 'dist', 'built.ts'), "const a = { exit: 'timeout' };\n");
      writeFileSync(join(root, 'src', 'real.ts'), 'export const ok = 1;\n');
      // A .d.ts beside a real vendored .ts, to pin the OTHER filter.
      writeFileSync(join(root, 'src', 'types.d.ts'), 'declare const a: { exit: string };\n');

      const found = walk(root).map((f) => f.replace(root + '/', '')).sort();

      expect(found).toEqual(['src/real.ts']);
      expect(found.some((f) => f.includes('node_modules'))).toBe(false);
      expect(found.some((f) => f.includes('/dist/'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('requireRoot rejects a missing scan root instead of scanning nothing', () => {
    // The other half of pitfall #401-2. `walk()` returning [] for a
    // missing directory is right for a nested subdirectory and
    // catastrophic for a root: the scan found nothing, yet the audit
    // still printed a confident report. requireRoot is the guard — and
    // a guard nobody calls is not a guard. M2 (deleting both
    // requireRoot calls) SURVIVED until this test existed.
    const missing = join(tmpdir(), 'r4013-absent-deadbeef');
    expect(existsSync(missing)).toBe(false);
    expect(() => requireRoot(missing)).toThrow(/does not exist/);

    // A file where a directory was expected is also a hard error.
    const notADir = join(tmpdir(), 'r4013-not-a-dir.txt');
    writeFileSync(notADir, 'x');
    try {
      expect(() => requireRoot(notADir)).toThrow(/does not exist/);
    } finally {
      rmSync(notADir, { force: true });
    }

    // A real directory passes, so the guard is not vacuous.
    expect(() => requireRoot(HUB_SRC)).not.toThrow();
    expect(() => requireRoot(PACKAGES_SRC)).not.toThrow();
  });

  it('the module actually CALLS requireRoot at init (a guard nobody calls is not a guard)', () => {
    // The one thing the tests above cannot observe from outside:
    // requireRoot's own behaviour is proven, but that the top-level
    // scan performs it is a module-init side effect with no external
    // witness. Deleting both call sites (M2) left the suite fully
    // green, twice, because nothing asserted the call existed.
    //
    // Pinned by source text — the same technique the
    // dispatchExternalBenchmark back-compat alias uses, and for the
    // same reason: it is a structural property of this file with no
    // behavioural proxy. The cost is real (a refactor that moves the
    // call into a helper would need this updated) and that cost is
    // accepted in exchange for the call not being silently droppable.
    const self = readFileSync(fileURLToPath(import.meta.url), 'utf8');

    expect(self).toMatch(/^requireRoot\(HUB_SRC\);$/m);
    expect(self).toMatch(/^requireRoot\(PACKAGES_SRC\);$/m);
    // ...and they must run before the scan that depends on them.
    const scanAt = self.indexOf('const productionFiles =');
    expect(scanAt).toBeGreaterThan(-1);
    expect(self.indexOf('requireRoot(HUB_SRC);')).toBeLessThan(scanAt);
    expect(self.indexOf('requireRoot(PACKAGES_SRC);')).toBeLessThan(scanAt);
  });
});
