# Quarantined artifacts

Artifacts here are NOT shippable as-is. Each one records why.

## r492_cross_repo_differential.test.ts.QUARANTINED

A cross-repo differential probe that compares `errorMessage`/`errorToString`
between this repo's `hub/src/errors.ts` and `llm-benchmark`'s
`src/errors.ts`.

**Why it is quarantined (measured 2026-10-20 23:18 CST):** it imports
`../../llm-benchmark/src/errors` — a path OUTSIDE this repository. In this
workspace the sibling checkout happens to sit one directory up, so the suite
resolves and passes locally. In a clean checkout (which is what CI builds)
the path does not exist and the suite cannot even load:

    Error: Failed to load url ../../llm-benchmark/src/errors
    (resolved id: ../../llm-benchmark/src/errors) in
    hub/test/r492_cross_repo_differential.test.ts. Does the file exist?
     ❯ Test Files  1 failed (1)
          Tests  no tests

Reproduced with `git archive HEAD | tar -x` into an empty directory, which
has no sibling `llm-benchmark`.

A suite that is GREEN only because of a directory layout that exists on one
machine is worse than no suite: it reports coverage it does not have, and it
turns the CI gate RED for everyone else. The probe's IDEA (differential
testing of a helper that exists in two repos) is sound — but it has to be
expressed inside ONE repository's boundary, e.g. by comparing the helper
against an inline reference implementation, or by running the comparison in
the repo that owns BOTH copies. That is not done here.

The file is kept, not deleted, so the intent is not lost.
