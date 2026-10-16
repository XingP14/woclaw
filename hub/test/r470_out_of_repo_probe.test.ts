/**
 * R470 — a probe whose subject set lives OUTSIDE the repo must skip, not fail.
 *
 * ── The CI red ──
 *
 * Four suites (`r430_record_plane`, `r436_writeup_cannot_cite_its_own_commit`,
 * `multi_round_declaration_r435`, `r466_gate_independence_census`) derive their
 * subject set by walking up from `hub/test/` until they find a directory
 * holding `LEARNING_PLAN.md` + `memory/`. That pair exists in the agent's
 * workspace (`~/.hermes/workspace/`). It does NOT exist in a clean CI checkout,
 * where the repo root is the top of the tree.
 *
 * So they threw at module load:
 *
 *     R466: could not derive the workspace root (no LEARNING_PLAN.md + memory/
 *     pair above /home/runner/work/woclaw/woclaw/hub/test). Refusing to pass
 *     vacuously.
 *
 * Four suites, four red, on `ded95f9`, `f4e6da4`, `7bcba1d`, `ff2a8d4` — CI has
 * been red for four consecutive HEADs.
 *
 * ── Why the throw was wrong, and is still wrong ──
 *
 * The refusal is CORRECT and worth keeping: a probe that cannot find its
 * subject set must not report "found nothing". That is the vacuous pass.
 *
 * But `throw` at module scope converts "this probe does not apply in this
 * environment" into "the repository is broken". Those are different claims, and
 * only one of them is true. The gate and the applicability condition were
 * fused into a single mechanism, and the CI bill for that fusion is four
 * consecutive red HEADs.
 *
 * This is R449's vocabulary-without-a-plane in a different place: the mechanism
 * (refuse to pass vacuously) is right, and it is expressed in a shape that
 * cannot be separated from the applicability check.
 *
 * ── The repair ──
 *
 * Split them. `probeWorkspace()` returns a result object instead of throwing.
 * The caller decides: if there is no workspace, the suite `describe.skip`s with
 * a named reason. A skip is not a pass — the reporter shows it as skipped, not
 * passed, and the probe's assertions are never evaluated. The vacuous pass the
 * original guard was defending against is still impossible: there is no path
 * where the census runs against an empty subject set and reports GREEN.
 *
 * ── What this suite pins ──
 *
 * Not the four repairs (they are upstream behaviour, covered by running them).
 * This pins the SHAPE of the guard itself, because the shape is the defect:
 * that a probe with no workspace returns a typed verdict rather than throwing,
 * that the verdict distinguishes "no workspace" from "workspace but empty",
 * and that the caller turns a missing workspace into a skip.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

// ── The guard, in the shape the repair requires ─────────────────────────────
//
// Same walk-up and same marker pair as the four suites use; the only change is
// the return. This copy is the PINNED subject, so the assertion below is about
// the contract, not about whether a workspace happens to exist on this machine.

export interface WorkspaceProbe {
  /** The derived root, or null when the marker pair was never found. */
  root: string | null;
  /** True when both markers were found together. */
  found: boolean;
  /** Why it failed, for the skip reason a reporter will show. */
  reason: string;
}

export function probeWorkspace(from: string, maxDepth = 8): WorkspaceProbe {
  let dir = from;
  for (let i = 0; i < maxDepth; i++) {
    if (existsSync(join(dir, 'LEARNING_PLAN.md')) && existsSync(join(dir, 'memory'))) {
      return { root: dir, found: true, reason: '' };
    }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return {
    root: null,
    found: false,
    reason:
      `no LEARNING_PLAN.md + memory/ pair above ${from} within ${maxDepth} levels; ` +
      'this probe audits the agent workspace, which does not exist in a clean checkout',
  };
}

// ── hermetic fixtures ──────────────────────────────────────────────────────
//
// The whole point of this suite is an ASYMMETRY: locally the marker pair is
// found, in CI it is not. So every arm below builds its own tree and probes
// INSIDE it. Asserting against the real `__dirname` would make the suite green
// locally and red in CI — the exact bug it is about.

function tree(shape: 'marked' | 'unmarked'): string {
  const root = mkdtempSync(join(tmpdir(), 'r470-'));
  mkdirSync(join(root, 'hub', 'test'), { recursive: true });
  if (shape === 'marked') {
    writeFileSync(join(root, 'LEARNING_PLAN.md'), '# plan\n');
    mkdirSync(join(root, 'memory'), { recursive: true });
  }
  return join(root, 'hub', 'test');
}

describe('R470 — the out-of-repo probe skips instead of failing the build', () => {
  it('arm A (control): the walk-up FINDS a workspace when the marker pair is present', () => {
    // The positive direction. If this arm fails, the guard stopped matching
    // and every "skip" would be an unconditional skip — the probe would be
    // silently GONE rather than conditionally inapplicable.
    const r = probeWorkspace(tree('marked'));
    expect(r.found).toBe(true);
    expect(r.root).not.toBeNull();
    expect(r.root!.endsWith('/hub/test')).toBe(false);
    expect(existsSync(join(r.root!, 'LEARNING_PLAN.md'))).toBe(true);
    expect(r.reason).toBe('');
  });

  it('arm B: a missing workspace is a typed verdict with a stated reason, not an exception', () => {
    // THE repair. The old guard threw here, and the throw is what reddened CI.
    let thrown: unknown = null;
    let result: WorkspaceProbe | null = null;
    try {
      result = probeWorkspace(tree('unmarked'));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeNull();
    expect(result).not.toBeNull();
    expect(result!.found).toBe(false);
    expect(result!.root).toBeNull();
    expect(result!.reason).toContain('LEARNING_PLAN.md');
    expect(result!.reason).toContain('clean checkout');
  });

  it('arm C: "not found" is distinguishable from a ZERO-SIZE census', () => {
    // The vacuous pass the original guard defended against is: the subject set
    // resolves, the set is empty, every assertion vacuously holds. So the
    // not-found verdict must never read like a census that found nothing.
    // This is the assertion that keeps the repair from being a quiet deletion.
    const r = probeWorkspace(tree('unmarked'));
    expect(r.found).toBe(false);
    expect(r.reason).not.toMatch(/0 (entries|rows|files|subjects|items)/i);
    expect(r.reason).toMatch(/does not exist in a clean checkout/);
    // ...and the distinction is carried by `found`, not by prose alone
    expect(typeof r.found).toBe('boolean');
  });

  it('arm D: the walk stops at the filesystem root instead of looping forever', () => {
    // An unbounded walk-up is a hang, and a hang in CI reads as a timeout
    // failure with no cause. Depth is bounded and the bound is a parameter.
    const r = probeWorkspace('/', 40);
    expect(typeof r.found).toBe('boolean');
    expect(r.reason).toContain('within 40 levels');
  });
});
