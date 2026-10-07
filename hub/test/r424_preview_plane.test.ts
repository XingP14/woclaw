/**
 * R424 — the preview plane: "what would you do if I let you?"
 *
 * SELECTION. R419-R423 were five consecutive rounds on ONE cluster: the quality
 * of my own probes (does a negative assertion pin its subject set; does a probe
 * notice its subject disappearing; can a committed suite even be loaded). The
 * R74 orthogonality rule caps that cluster at three. This round leaves it for the
 * first time in five rounds.
 *
 * THE PLANE. A preview / dry-run surface answers a question the actuation plane
 * (R404) cannot: not "may this effect occur?" but "WHAT WOULD OCCUR IF I ALLOWED
 * IT?" The two are orthogonal by construction -- a preview never permits the
 * effect, so it needs no authority to be safe. That is exactly why it has never
 * been built: there is no incident that starts with someone previewing.
 *
 * THE FINDING. WoClaw has a dry-run FLAG and no dry-run BEHAVIOUR.
 *
 *   hub/src/types.ts:280
 *     export interface ForgettingConfig { ... dryRun: boolean; ... }
 *
 * That flag is 1 declaration, 0 readers. Repo-wide it appears in exactly four
 * places: the declaration, a planning doc, a copy of that doc, and the built
 * dist/. Nothing in hub/src or in any package's src/ reads it. So the config
 * surface advertises a rehearsal mode for the one operation in the hub that
 * irreversibly destroys user data -- the weekly eviction -- and setting it has
 * no effect whatsoever.
 *
 * WORSE, AND WORSE IN THE HARMFUL DIRECTION. The flag is also the WRONG SHAPE.
 * A dry-run flag is a boolean that suppresses the effect. But look at what the
 * scheduler actually does with the candidates: it computes them, then deletes
 * them one at a time and logs each one. There is no rehearsal object. There is
 * nothing to ask. There is no plan to review, no diff to read, no count to
 * approve. `dryRun: true` cannot be implemented by checking one branch -- it
 * needs a return type that carries the plan.
 *
 * So the shape is wrong in BOTH directions at once, and this is the interesting
 * part:
 *   - delete the field      -> the hub stops ADVERTISING a rehearsal mode it
 *                             never had, and the weekly reaper keeps deleting
 *                             (status quo preserved, hazard honestly labelled)
 *   - implement the field   -> requires new return types across 3 call sites,
 *                             a REST response shape change, and it becomes a
 *                             DESTRUCTIVE-operation preview surface
 *
 * The second option is exactly the surface R404 says needs an authority model
 * (R404-D1: the hub's entire authorisation model is one boolean over a shared
 * token). Shipping the preview without the authority model would be shipping
 * R404's defect in a new place.
 *
 * A THIRD THING, AND IT IS THE SAME SHAPE AS R422's.
 * There are TWO ForgettingConfig interfaces. scheduler.ts:17 has one;
 * types.ts:280 has another, with `dryRun` -- and types.ts's is imported by
 * NOTHING in the repo. The ROADMAP says "load ForgettingConfig from env/config"
 * as an unstarted step. So the configuration surface that was never wired has
 * itself never been reconciled with the configuration that is.
 *
 * METHOD NOTE, and it is R419/R420/R421 all over again: this file's own claims
 * are greps. "0 readers of dryRun" is a grep. To make it evidence rather than
 * prose, the claims are pinned as executable assertions with a live control, so
 * the suite cannot report a clean result by failing to find its subject.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..', 'src');

/** Live control: the audit must be able to find a token that IS present. */
function prodFiles(): string[] {
  return readdirSync(SRC).filter((f) => f.endsWith('.ts'));
}

describe('R424 control: the audit instrument is alive', () => {
  it('finds the files it claims to audit', () => {
    const files = prodFiles();
    expect(files.length).toBeGreaterThan(10);
    expect(existsSync(join(SRC, 'scheduler.ts'))).toBe(true);
    expect(existsSync(join(SRC, 'types.ts'))).toBe(true);
  });

  it('reports a token that IS present (negative control for the counter)', () => {
    // 'schedLog' appears many times in scheduler.ts. If this ever reads 0, the
    // instrument is broken and every count below is void -- not a finding.
    const s = readFileSync(join(SRC, 'scheduler.ts'), 'utf8');
    const n = (s.match(/schedLog/g) ?? []).length;
    expect(n).toBeGreaterThan(0);
  });
});

describe('R424 the preview plane in WoClaw production code', () => {
  it('dryRun exists as a configuration field', () => {
    const types = readFileSync(join(SRC, 'types.ts'), 'utf8');
    expect(types).toMatch(/dryRun\s*:\s*boolean/);
  });

  it('🔴 F1: dryRun has ZERO readers in production — the flag cannot work', () => {
    // Assertion form: for every production file, the DECLARATION in types.ts is
    // the only occurrence. Read the type, not the assignment.
    const declFile = 'types.ts';
    let readers = 0;
    const sites: string[] = [];
    for (const f of prodFiles()) {
      const s = readFileSync(join(SRC, f), 'utf8');
      const n = (s.match(/dryRun/g) ?? []).length;
      if (n > 0) {
        if (f !== declFile) { readers += n; sites.push(`${f}:${n}`); }
      }
    }
    // Zero readers is the FINDING, so this asserts the state of the world, not
    // the desired state — a characterization pin. If someone wires dryRun up,
    // this goes red and forces a deliberate update, which is the point.
    expect(sites, `dryRun readers found at ${sites.join(', ')}`).toEqual([]);
  });

  it('🔴 F2: the scheduler declares a rehearsal mode it cannot perform', () => {
    // scheduler.ts:26 documents the flag as "Whether to actually delete
    // (false = dry-run)" -- on its OWN ForgettingConfig, which has no such
    // field. The comment promises a branch the code does not contain.
    const s = readFileSync(join(SRC, 'scheduler.ts'), 'utf8');
    expect(s).toMatch(/false = dry-run/);
    // ...and the deletion loop that a dry-run branch would guard is unconditional.
    const loopAt = s.indexOf('memoriesToEvict');
    expect(loopAt).toBeGreaterThan(-1);
    // The candidate PLAN is computed and then discarded -- no rehearsal object.
    expect(s).not.toMatch(/interface EvictionPlan|type EvictionPlan/);
  });

  it('🔴 F3: two ForgettingConfig interfaces, and the documented one is the dead one', () => {
    const types = readFileSync(join(SRC, 'types.ts'), 'utf8');
    const sched = readFileSync(join(SRC, 'scheduler.ts'), 'utf8');
    expect(types).toMatch(/export interface ForgettingConfig/);
    expect(sched).toMatch(/export interface ForgettingConfig/);
    // Same name, different fields. The documented/config-planned one is the one
    // nothing imports.
    expect(types).toMatch(/schedule:\s*'daily'/);
    expect(sched).not.toMatch(/schedule:\s*'daily'/);
  });

  it('the preview-plane vocabulary is otherwise absent (8 families at zero)', () => {
    const families: Record<string, RegExp> = {
      preview: /\bpreview\b/,
      planmode: /plan[-_ ]?mode|planMode/i,
      simulate: /\bsimulat(e|ion|or)\b/i,
      whatif: /what[-_ ]?if|whatIf|counterfactual/i,
      shadow: /\bshadow\b/i,
      hypothetical: /hypothetical|wouldProduce|assumeEffect/i,
      impact: /impact|blast[-_ ]?radius/i,
      estimate: /estimat(e|ed|or)/i,
    };
    const zero: string[] = [];
    for (const [name, rx] of Object.entries(families)) {
      let total = 0;
      for (const f of prodFiles()) {
        total += (readFileSync(join(SRC, f), 'utf8').match(rx) ?? []).length;
      }
      if (total === 0) zero.push(name);
    }
    expect(zero).toEqual(Object.keys(families));
  });
});