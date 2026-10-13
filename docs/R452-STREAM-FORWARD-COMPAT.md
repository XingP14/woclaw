# R452 — A Forward-Compatibility Promise Whose Boundary Is Drawn By Position

**Date**: 2026-10-14 04:0x CST (night tick)
**Commit**: test-only, `hub/test/r452_stream_forward_compat.test.ts` (11 tests)
**Shape**: R451's queued candidate, executed. Generated-alphabet probe applied to a **second surface** — not the scope guard, but the only forward-compatibility promise WoClaw's protocol makes to external producers.
**Production changes**: **zero**. `src/*.ts` md5 stable throughout.

---

## 0. R74 and the round's provenance

R441–R451 alternated between long in-cluster runs and attempts to pivot. R451
discharged R74 (ten consecutive in-cluster rounds) and left the plane. R452 is
**in-cluster by construction**: R451 wrote down the *shape of its own worst
probe defect* —

> a `toBe(0)` on the residue of your own taxonomy, authored by the author of the
> taxonomy

— and queued exactly this round. Applying a freshly-executed method to a second
subject is not a new plane, so R74 is satisfied. The second subject is chosen so
the method has something new to find: **the validator is not a boolean guard, it
is a function over an input space**, which is the property R451's scope-guard
case did not have.

R452's plan entry (`LEARNING_PLAN.md` 451 candidates) named:

> **candidate R453**: run the generator over a second surface — `handleMemoryByTag`
> / `search()`, and the read-vs-delete asymmetry (R414-F4, still the strongest
> unfixed)

That remains open and un-attempted. R452 found its own subject because R451's
own queue was the wrong place to look — a note for the successor.

---

## 1. The claim under test

`docs/S92-AGENT-STREAM-PROTOCOL.md` §3.4:

> **`event` always string union** — unknown event ⇒ consumer logs `WARN
> unknown_event` and continues (**additive compat**).

§6 test plan, restating it as a shipped test:

> `event` MUST be from the v1.0 taxonomy (**unknown event logged + skipped, not
> rejected**)

"Logged and skipped" names a specific consumer behaviour: the uninterpretable
event is set aside, and the **rest** of the stream is what gets processed. That
is the reading this suite implements literally, as a second reader, and asks
whether the shipped validator agrees with it.

The existing test that claims to cover this (`agent_stream.test.ts:280`) uses
**one** hand-written `made_up_event` at **one** position — mid-stream. It
confirms the promise in that position and is silent about every other.

---

## 2. Method

Generator: 40 candidate names a v1.1 producer might plausibly add
(`summary`, `cost`, `checkpoint`, `tool_progress`, `approval_request`,
`post_result`, `trailer`, `eof`, …) × 5 separator spellings (`agent_summary`,
`summary.v2`, …) ⇒ **440 unique names**, filtered against the v1.0 taxonomy to
guarantee all are foreign. Driven through the **real** `validateAgentStream`;
every arm compares two answers **for the same input**, so widening or narrowing
the alphabet moves both sides.

Per R446-1, every restore was `git checkout --` plus an md5 read-back — never a
post-`sed` `cp`. `src/agent_stream.ts` md5 `e8442c57…` before, during and after.

---

## 3. The finding

### 3.1 The measurement

| position of the foreign event | issue codes produced | transport verdict |
|---|---|---|
| **before** `result` | `event_unknown` (440/440, nothing else) | **accepted** |
| **after** `result` | `event_unknown` **+ `append_after_result` + `result_not_last`** (440/440) | **rejected** |

`hardIssues = issues.filter(i => i.code !== 'event_unknown')` keeps both extra
codes, so the second stream is HTTP 400 on REST and a `stream_validation_failed`
frame on WS.

**The boundary of the additive-compat promise is drawn by position, not by
whether the receiver can interpret the event** — and position is precisely what a
v1.1 producer does not know about when it invents a name.

### 3.2 The sharper statement: it is an oracle disagreement

Under §3.4's words, a consumer skips the unknown event, leaving `result` last,
and reports a clean stream. Under the shipped validator the same bytes are a
two-code failure. **Both readings follow the document.** The transports chose one;
the document states the other. This is R425's shape one layer down: R425-F4
recorded that a filtered `event_unknown` is never logged or journalled; R452
finds that the *filter itself* is a weaker predicate than the promise it is
supposed to implement.

### 3.3 What this is NOT

Not a claim that append-after-result should be legal. `result` last is a real
invariant (spec §3.4, and `docs/…:109`) and this round does not propose relaxing
it. Arm E shows a **KNOWN** event after `result` yields the *identical* two
codes — so the defect is **not** "unknown events are treated specially". It is
that **the taxonomy verdict and the position verdict are computed over the same
event without either consulting the other**, and the declared vocabulary of hard
codes has no joint expression for the combination.

The fix is a boundary decision — *where does "skip" end?* — and it changes what a
malformed stream is allowed to say. Father-gated.

---

## 4. Mutation matrix — 7/7 KILLED

Control run first and last: **11/11 GREEN** both times, all three `src` md5s
unchanged.

| # | mutation | verdict |
|---|---|---|
| **M1** | **the real fix**: `continue` on an unknown event before the position checks | **KILLED** (1 arm) |
| M2 | transports stop filtering `event_unknown` | **KILLED** (1) |
| M3 | delete the `event_unknown` issue construction | **KILLED** (1) |
| M4 | position checks skip known events too (invert the taxonomy awareness) | **KILLED** (1) |
| M5 | real-fix variant: `hardIssues` excludes all three codes for foreign events | **KILLED** (1) |
| M6 | **armed control**: shrink the alphabet to 1 base name | **KILLED** (1) |
| M7 | **armed control**: invert the foreign filter ⇒ only *known* names generated | **KILLED (4)** |
| M8 | real fix: treat a foreign event as position-invisible in both checks | **KILLED (4)** |

### 🔴 Two mutations of my own, recorded not hidden

**M6 first attempt SURVIVED — and the suite was right to stay green.** My
patch deleted 6 of the 40 base names (a partial-line `str.replace`), leaving 34.
34 bases × 11 spellings = 374 names, still `> 200`, so every relation arm still
held: dropping 85% of the alphabet left the finding completely intact. **A suite
that had reddened there would have been asserting a count, not a relation.** I
re-mutated properly (34 → 1 base) and it died. Recorded because the intermediate
"SURVIVED" is a fact about the suite's robustness, not about the suite's
weakness — the same lesson as R449-15's INVALID classification.

**M3's `sed`-equivalent (`python` string index) ran past a 180 s command timeout
and left `src/agent_stream.ts` mutated.** I detected it with `git status` + md5
before running anything else and restored via `git checkout --`. Had I quoted a
number from that state it would have been measured against a mutated
validator. Note for the successor: **always md5 the subject before trusting a
run that timed out** (R446-1's rule with a new failure mode).

---

## 5. Verification

- focused: **11/11 PASS**
- `tsc --noEmit`: **0**
- full hub suite: **136 files / 1584 tests PASS** (was 135/1573 — the 11 new arms)
- `git diff --stat -- src/`: **empty**; `src/*.ts` md5-of-md5 `7ea4d6f5…`
- R425 / R430 / R437 / R438 / R449 / R451 all green with write-ups in place

---

## 6. Methodology additions

- **R452-1 — a forward-compat claim is a claim about position-independence.**
  An example-based compat test confirms the promise in the position it was
  written in. The question that finds the defect is "which position?", and it
  costs one sentence to ask.

- **R452-2 — assert the relation between two answers for one input, never the
  count of either.** Every arm here is `before(X)` vs `after(X)`. Consequence
  measured: shrinking the alphabet by 85% left all of them green (M6), which is
  the property that makes the sweep's *negative* results trustworthy.

- **R452-3 — when a guard reads its own spec's promise, build the spec's reader
  and let the two disagree.** The oracle here is not a hand-declared copy of a
  predicate (R451's defect (i)); it is a second implementation of a documented
  behaviour, so a production change *can* reach it.

- **R452-4 — an unarmed mutation that survives is not always a suite hole.**
  Before recording a survivor, check the mutation actually did what you meant;
  then check whether the suite *should* have caught it. M6's first attempt was
  under-specified and the suite was correct.

---

## 7. Father-gated (unchanged, not proposed here)

1. **Where does "skip" end?** A foreign event after `result` currently makes the
   stream unrepresentable to any §3.4-conforming reader. Two defensible fixes:
   (a) make the validator skip foreign events entirely for position purposes
   (M8), or (b) narrow §3.4's prose to say skip-then-still-check-position.
   **This is a behaviour decision** — a v1.1 producer's trailer event currently
   cannot publish to this hub.
2. **R451's scope tag/delete finding** — a workspace-scoped caller can delete a
   session-owned memory. Still open, still not a commit.
3. **`agent_stream_exit_reachability.test.ts` (R453 candidate)** — 7 declared
   exit codes, `exit_unknown` exercised twice by hand. Q4 in the R452 scratch
   script showed **7 declared + 7 plausible-but-undeclared exits all behave
   identically**, i.e. the exit axis may be the same shape at one layer down.

---

## 8. Artefacts

- `hub/test/r452_stream_forward_compat.test.ts` — 11 arms, staged
- `hub/scripts/r452_probe.ts` — the 440-name measurement (Q1–Q4)
- `hub/scripts/r452_audit.ts` — R427's classifier re-run over all 121 suites
  with per-clause exclusion attribution
- `hub/scripts/r452_literal_audit.ts` — R446-4's shape applied to that
  classifier's literal extractor
- This write-up + `LEARNING_PLAN.md` §452 + digest entry