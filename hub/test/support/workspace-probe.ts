/**
 * Shared workspace probe for suites whose subject set lives OUTSIDE the repo.
 *
 * Four hub suites (r430_record_plane, r436_writeup_cannot_cite_its_own_commit,
 * multi_round_declaration_r435, r466_gate_independence_census) walk up from
 * `hub/test/` looking for a `LEARNING_PLAN.md` + `memory/` pair. That pair is
 * the agent's workspace, not the repository, so it is ABSENT in a clean CI
 * checkout.
 *
 * Their original guard threw at module scope when the walk failed, which made
 * "this probe does not apply here" indistinguishable from "this repository is
 * broken" — and CI went red on four consecutive HEADs (ded95f9, f4e6da4,
 * 7bcba1d, ff2a8d4).
 *
 * The refusal is still correct: a probe that cannot resolve its subject set
 * must not report "found nothing". What changes is the SHAPE. `probeWorkspace`
 * returns a verdict instead of throwing, and callers turn a missing workspace
 * into a `describe.skip` with a stated reason. A skip is not a pass — the
 * reporter shows it as skipped and the assertions never evaluate, so the
 * vacuous pass remains impossible.
 *
 * Contract pinned by test/r470_out_of_repo_probe.test.ts.
 */
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

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

/**
 * Resolve the workspace, or `null` when it is absent.
 *
 * Callers must branch on `null` and skip — never fall back to a default root,
 * because a default root is exactly how a probe ends up censusing the wrong
 * directory and reporting a confident zero.
 */
export function resolveWorkspace(from: string): string | null {
  const probe = probeWorkspace(from);
  return probe.found ? probe.root : null;
}

/** The reason string to hand to `describe.skip` when the workspace is absent. */
export function skipReason(from: string): string {
  return probeWorkspace(from).reason;
}
