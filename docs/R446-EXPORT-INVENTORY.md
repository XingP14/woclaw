# R446 — the export-name gap, executed

**Round**: 446 · **Date**: 2026-10-13 04:00 CST · **Commit**: `ba400ed` (test-only)
**Predecessor**: R445 (`c23aace`)

## What was queued

R445 closed its commit body with an open item, verbatim:

> M6 (rename an `otlp_sink` export) SURVIVED — the suite proves the module has no
> production importer, not that its export names are stable.

R446 ran it. **The gap was not a gap.**

## The measurement

Same tree, same mutation (`applyOtlpPartialSuccess` → `applyPartialSuccess`):

| mutation | R444 (16 arms) | otlp suites (43 arms) |
|---|---|---|
| `hub/src/otlp_sink.ts` only | 16/16 green | **3 arms RED** |
| `src/` + both importing suites | 16/16 green | **43/43 green** |

R445's `sed` was repo-wide, so it rewrote the new name into the *importing* suite as
well. That suite then stopped referring to the name and could no longer fail on it.
**The guard was never blind to renames; it was co-mutated.** (R446-2)

## Why R444's single pin is not a defect

R444's only otlp-name pin is `line 245`, `expect(src).toContain('sendOtlpLogsOnce')`,
inside the arm titled *"the module is substantial, not a stub — the dead code is real
code"*. That arm checks a **count**, a **byte length**, and **one name** — all three
rename-invariant by construction. Its declared purpose is "this isn't an unfinished
sketch", and it was doing exactly that. It was never a rename-detection surface.

The sharper risk runs the other way: a silhouette arm is **silent about
reachability**, which is the property that matters for this module.

## The second false premise

The draft also claimed "6 of 8 exports are unexercised". Measured: `otlp_sink.test.ts`
imports **all 8**. Its regex required the whole `from '../src/otlp_sink.js'` clause
on one line; both suites use **multi-line named imports**, so the match set came back
empty and the arm concluded nothing imports the module. Both the broken and the
corrected form are now asserted in the suite (R446-4).

## Mutation matrix

Control run first, in the same conditions (R446-1: `git checkout` + md5 readback,
never `cp` after a `sed`):

| arm | change | result |
|---|---|---|
| control | none | **57/57 green** |
| M6-a | rename in `src/` only | **KILLED — 7 arms** |
| M6-b | rename in `src/` + both suites | **KILLED — 3 arms** (r446 inventory only) |
| M7 | same-signature transport stub | **KILLED — 14 arms** |

The two rename modes are caught by **disjoint** guards. The only guard that fires in
M6-b is a plain name-inventory assertion.

## Verification

- focused `r446_export_inventory.test.ts` — **11/11**
- `tsc --noEmit` — **0**
- full hub suite — **132 files / 1557 tests PASS**
- `hub/src/` — **zero changes** (`git status`: one new test file)

## Still open (unchanged, behaviour decisions)

- `WOCLAW_LOG_FORMAT` governs **2 of 37** log call sites — either wire `hubLog`
  into the gate, or stop `hub_log.ts`'s prose promising a whole-pipeline flip.
- `otlp_sink.ts` (13 KB, 8 exports, 43 behavioural arms, **0 production importers**)
  is still unwired. R446 pins its export inventory; pinning a name is not wiring it.
