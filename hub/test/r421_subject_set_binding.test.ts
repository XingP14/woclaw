/**
 * R421 — a negative assertion must pin its own subject set.
 *
 * THE FINDING. The probe suites in this directory assert things like "zero
 * producers", "no reader outside db.ts", "nothing emits exit:'interrupted'".
 * A negative assertion is only as strong as the set of files it searched, and
 * in four suites that set is not a constant:
 *
 *   test/r414_cancel_reachability.test.ts:36
 *       try { src = readFileSync(join(SRC, f), 'utf8'); } catch { continue; }
 *
 * `catch { continue }` means the subject list at line 33-34 ('db.ts',
 * 'federation.ts', 'scheduler.ts', ...) is a FUNCTION OF THE FILESYSTEM. Delete
 * one and the assertion still passes — with less searched. The test cannot tell
 * "I looked everywhere and found nothing" from "I could not look there".
 *
 * This is the same defect shape R409 found on coverage denominators ("a ratio
 * whose denominator was inherited rather than constructed is a number, not a
 * measurement") and R420 found on decrypt probes ("a probe that cannot tell a
 * broken call from a missing one is adjacency, not coverage"). It is the third
 * member of that family, one level up: those two had a wrong denominator or a
 * wrong arm; this one has a denominator that MOVES.
 *
 * WHY A META-PROBE. Each affected suite would need its own fix, and a suite
 * cannot reliably assert its own robustness (a suite that fails to load reports
 * nothing). So the check lives here, one level up, where "did the subject set
 * shrink" is answerable without trusting the subject suite's verdict.
 *
 * WHAT THIS DOES NOT DO. It does not make the affected assertions true. It
 * makes the shrink VISIBLE: a suite whose subject list contains an unreadable
 * path turns this suite red, at which point the `catch { continue }` is either
 * removed or justified in a comment. Production behaviour is untouched.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', 'src');
const TEST = join(__dirname, '.');

/** Suites whose assertions are negative searches over hub/src. */
const NEGATIVE_PROBE_SUITES = [
  'r401_abandoned_delegation.test.ts',
  'r407_probe.test.ts',
  'r408_scope_coverage.test.ts',
  'r409_scope_denominator.test.ts',
  'r410_enumeration_scope.test.ts',
  'r411_graph_scope_bypass.test.ts',
  'r412_graph_delete_retention.test.ts',
  'r413_ttl_mirror_asymmetry.test.ts',
  'r414_cancel_reachability.test.ts',
  'r414_notification_attainability.test.ts',
  'r415_rest_cancel_state_guard.test.ts',
  'r416_ws_cancel_invalid_state.test.ts',
  'r417_extraction_plane_unwired.test.ts',
  'r418_federation_receive_channel.test.ts',
  'r420_swallowed_decrypt_probe.test.ts',
];

/**
 * A subject list is only sound if it cannot silently lose members. The two
 * loss mechanisms seen in this repo:
 *   - `catch { continue }` around a read  -> subject vanishes when unreadable
 *   - a file list iterated with `.filter(Boolean)` on a failed read
 * We detect the first directly (it is a literal in the source) and the second
 * by requiring the file list to be a plain literal that we can re-resolve.
 */
const SILENT_SKIP = /catch\s*\{\s*continue\s*;?\s*\}/;

describe('R421: negative probes must pin their subject set', () => {
  it('K — CONTROL. This suite itself reads a subject that exists, and fails if it does not', () => {
    // Positive control for the harness below: if hub/src/memory.ts were removed,
    // THIS test must fail. Without it, "no suite is broken" could just mean the
    // detector is broken (R420's M2 lesson, applied to the detector this time).
    const src = readFileSync(join(SRC, 'memory.ts'), 'utf8');
    expect(src.length).toBeGreaterThan(0);
    expect(existsSync(join(SRC, 'memory.ts'))).toBe(true);
  });

  it('K2 — CONTROL. existsSync returns false for a subject that is absent', () => {
    // If this ever passes with a true expectation, the check above is vacuous.
    expect(existsSync(join(SRC, '__r421_no_such_file__.ts'))).toBe(false);
  });

  it('every listed probe suite is present in test/', () => {
    const present = new Set(readdirSync(TEST));
    const missing = NEGATIVE_PROBE_SUITES.filter((f) => !present.has(f));
    expect(missing).toEqual([]);
  });

  it('no probe suite swallows a read error inside a negative search', () => {
    // The defect, named exactly. `catch { continue }` inside a subject loop is
    // a denominator that moves; the assertion survives its own subject vanishing.
    const offenders: string[] = [];
    for (const f of NEGATIVE_PROBE_SUITES) {
      const p = join(TEST, f);
      if (!existsSync(p)) continue;
      const src = readFileSync(p, 'utf8');
      // Ignore the readFileSync helper itself if the whole file is a scan of
      // many files; we only care about the swallow *inside a subject loop*.
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (SILENT_SKIP.test(line)) {
          // Allowed only if a comment on the same or previous line says why.
          const ctx = lines.slice(Math.max(0, i - 2), i + 1).join(' ');
          if (!/\/\/.*(intentional|r421|justif)/i.test(ctx)) {
            offenders.push(`${f}:${i + 1}  ${line.trim()}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('every subject file named in a probe suite actually exists in hub/src', () => {
    // Re-resolve the literal file names each suite names. A suite that names a
    // file which is not there is already asserting over a smaller world than
    // its comment claims.
    const literal = /['"]([A-Za-z0-9_./-]+\.(?:ts|js))['"]/g;
    // A suite that filters filenames ('.endsWith(".test.ts")') is naming an
    // EXTENSION CLASS, not a subject. Those literals are matched by the regex
    // above and would be reported as phantom missing files. R421's own lesson:
    // a probe that fails for the wrong reason inflates the count. Detected by
    // hand, not by the probe: filter the extension-class literals out.
    const EXTENSION_CLASS = /^\.?(test|d)\.ts$/;
    const bad: string[] = [];
    for (const f of NEGATIVE_PROBE_SUITES) {
      const p = join(TEST, f);
      if (!existsSync(p)) continue;
      const src = readFileSync(p, 'utf8');
      for (const m of src.matchAll(literal)) {
        const name = m[1];
        if (name.includes('/')) continue; // cross-suite or relative path
        if (EXTENSION_CLASS.test(name)) continue; // extension predicate, not a subject
        if (!existsSync(join(SRC, name))) bad.push(`${f} -> src/${name}`);
      }
    }
    expect(bad).toEqual([]);
  });
});