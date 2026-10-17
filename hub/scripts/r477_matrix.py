#!/usr/bin/env python3
"""R477 hardened mutation driver (supersedes r474_matrix.py's restore logic).

r474_matrix.py died mid-run twice, leaving planted mutations in hub/src, because
it had THREE independent restore defects:

  D1  SNAPSHOT-AFTER-APPLY. `Mutant.apply` wrote `<file>.r474bak` AFTER reading
      the file, so for the second mutant on the SAME file the "backup" is
      already-mutated state, not the baseline. The `finally:` block then restored
      that partial state and the residue SURVIVED a nominal successful restore.
      Reproduced in isolation (see the write-up).

  D2  APPLY-OUTSIDE-TRY. `for a in arm: a.apply()` sat OUTSIDE the `try:`, so an
      ANCHOR MISS (SystemExit), a crash, or a SIGKILL between the two applies
      left the first mutant's edit in the source tree with no restore at all.
      Reproduced: two identical import lines survived.

  D3  BACKUP-INSIDE-SRC. The `.r474bak` snapshot was written into hub/src/, so a
      crash also littered the tracked source directory with an untracked file.

This driver fixes all three:
  * one pristine baseline snapshot per OWNED file, taken BEFORE any mutation,
    into a scratch dir OUTSIDE the repo (D3);
  * every apply/restore is inside the try, and restore is unconditional (D2);
  * restore is from the pristine baseline, not from a per-mutant `.bak` (D1);
  * `assert new != old` retained -- a needle that does not occur makes
    `str.replace` return the string unchanged, and a count==1 assertion would
    still pass. See round R456.

Usage:  python3 hub/scripts/r477_matrix.py
Exit 0 only if CONTROL is green and every arm is KILLED and the tree is restored.
"""
import hashlib
import os
import re
import shutil
import subprocess
import sys
import tempfile

HUB = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
TEST = 'test/r474_session_eviction_archiver_reach.test.ts'
SCHED = os.path.join(HUB, 'src', 'scheduler.ts')
REST = os.path.join(HUB, 'src', 'rest_server.ts')

# OWNED file list -- restore is scoped to exactly these, never a tree-wide
# `git checkout` (which silently destroys concurrent in-flight work; see R469-1).
OWNED = [SCHED, REST]

SCRATCH = tempfile.mkdtemp(prefix='r477-baseline-')
BASELINE = {}   # path -> pristine bytes, captured BEFORE any mutation

IMPORT_ANCHOR = "import { errorMessage } from './errors.js';"
IMPORT_LINE = IMPORT_ANCHOR + "\nimport { SessionArchiver } from './session_archive.js';"
FN_ANCHOR = '  async runWeeklyEviction'


def md5(b):
    return hashlib.md5(b).hexdigest()


def preflight():
    """Self-heal residue from a PRIOR run that was killed with SIGKILL.

    A `finally:` block cannot survive SIGKILL, so a hard-killed run can still
    leave a planted mutation in hub/src. Verified by kill_test.sh: killing the
    driver mid-arm leaves `rest_server.ts` modified. What the hardened design
    guarantees instead is (a) the pristine baseline lives OUTSIDE the repo, and
    (b) it is named on stdout, so the next run can put the tree back.

    Because the OWNED list is exact, "stale residue" is decidable rather than a
    guess: before touching anything, refuse to run on a tree whose OWNED files
    do not match HEAD. Recovery is scoped to OWNED only -- never a tree-wide
    `git checkout`, which silently destroys concurrent in-flight work (R469-1).
    """
    dirty = [p for p in OWNED
             if subprocess.run(['git', 'diff', '--quiet', '--', p], cwd=HUB).returncode != 0]
    litter = [f for f in os.listdir(os.path.join(HUB, 'src'))
              if f.endswith('.r474bak') or f.endswith('.r470bak')]
    if dirty or litter:
        print('ABORT: OWNED files are not at HEAD -- a previous run was killed '
              'mid-arm, or another agent has in-flight work here.')
        for p in dirty:
            print(f'  modified: {os.path.relpath(p, HUB)}')
        for f in litter:
            print(f'  leftover: src/{f}')
        print('Recovery (scoped to OWNED, safe against concurrent work):')
        for p in OWNED:
            print(f"  git checkout -- {os.path.relpath(p, HUB)}")
        print(f"  find {HUB}/src -name '*.r474bak' -delete")
        print('Or restore from an out-of-repo snapshot under '
              '/root/.hermes/cache/scratch/r477-baseline-*/')
        return False
    return True


def snapshot_baseline():
    for p in OWNED:
        data = open(p, 'rb').read()
        BASELINE[p] = data
        snap = os.path.join(SCRATCH, os.path.basename(p))
        with open(snap, 'wb') as fh:
            fh.write(data)
    print('baseline (pre-mutation) md5: ' +
          ', '.join(f'{os.path.basename(p)}={md5(v)[:12]}' for p, v in BASELINE.items()))
    print(f'baseline snapshots live OUTSIDE the repo: {SCRATCH}')


def restore():
    """Unconditional byte-exact restore from the pristine baseline.

    ATOMIC, and it must stay that way. An earlier draft looped `for p in OWNED`
    and did `open(p, 'wb').write(BASELINE[p])`; when `preflight` aborted before
    the snapshot, BASELINE[p] raised KeyError -- but `open(p, 'wb')` had ALREADY
    truncated the file. One aborted run zeroed hub/src/scheduler.ts (6963 bytes ->
    0) and the guard that was meant to protect the tree destroyed it. Write to a
    sibling temp file and os.replace() instead: os.replace is atomic on POSIX, so
    a file is either its old content or the full baseline, never partial.
    """
    for p, data in BASELINE.items():      # iterate BASELINE, not OWNED:
        tmp = p + '.r477tmp'
        with open(tmp, 'wb') as fh:      # preflight may abort before snapshot,
            fh.write(data)
        os.replace(tmp, p)               # atomic


def tree_clean():
    bad = [p for p in OWNED if md5(open(p, 'rb').read()) != md5(BASELINE[p])]
    if bad:
        print('RESTORE FAILED: ' + ', '.join(os.path.basename(b) for b in bad))
        return False
    return True


class Mutant:
    def __init__(self, path, old, new):
        self.path, self.old, self.new = path, old, new

    def apply(self):
        s = open(self.path).read()
        if self.old not in s:
            raise SystemExit(f'ANCHOR MISS in {os.path.basename(self.path)}')
        if s.count(self.old) != 1:
            raise SystemExit(
                f'NON-UNIQUE needle ({s.count(self.old)}x) in {os.path.basename(self.path)}'
                ' -- refusing to edit the wrong copy')
        out = s.replace(self.old, self.new, 1)
        # A needle that never occurs makes replace() return the string unchanged;
        # without this the mutation would be a silent no-op (R456).
        assert out != s, 'replace was a no-op -- the needle did not occur'
        open(self.path, 'w').write(out)


def reader_arm(body):
    """A reader arm must ALSO import the class, else it is a TS compile error
    rather than a behavioural mutation and the arm proves nothing."""
    return [Mutant(SCHED, IMPORT_ANCHOR, IMPORT_LINE),
            Mutant(SCHED, FN_ANCHOR, body + '\n\n' + FN_ANCHOR)]


_rest_src = open(REST).read()
_m = re.search(r'^import .*\n', _rest_src, re.M)
if not _m:
    raise SystemExit('no import anchor in rest_server.ts')
first_import = _m.group(0)

ARMS = [
    ('M1 plant the REPAIR: archive before delete in the eviction path',
     [Mutant(SCHED, IMPORT_ANCHOR, IMPORT_LINE),
      Mutant(SCHED,
             '          const ok = await this.sessionStore.deleteSession(s.id);',
             '          await new SessionArchiver().archiveSession(s as never);\n'
             '          const ok = await this.sessionStore.deleteSession(s.id);')]),
    ('M2 plant a production IMPORT of session_archive.js',
     [Mutant(REST, first_import,
             first_import + "import { SessionArchiver } from './session_archive.js';")]),
    ('M3 plant a production reader of stats()',
     reader_arm('  async archiveStatsProbe() { return new SessionArchiver().stats(); }')),
    ('M4 plant a production reader of restoreSession()',
     reader_arm('  async archiveRestoreProbe(id: string) { return new SessionArchiver().restoreSession(id); }')),
    ('M5 plant a production reader of listArchived()',
     reader_arm('  async archiveListProbe() { return new SessionArchiver().listArchived(); }')),
    ('M6 plant an UNUSED reader (declared, never called)',
     reader_arm('  async archiveUnusedProbe() { /* declared only */ }')),
]

# ── CONTROL ARM: must SURVIVE ────────────────────────────────────────────────
# A driver that kills every arm proves nothing -- it may be killing on the mere
# fact of a write. C1 plants a semantically irrelevant PROSE comment mentioning
# the archiver, placed OUTSIDE runWeeklyEviction, and the suite must stay GREEN:
# arm 4 only inspects the eviction function body, and every census arm strips
# comments before counting. If C1 dies, the suite is a shape detector firing on
# vocabulary rather than on wiring, and the KILLED verdicts above would be
# suspect for the same reason R475-1 recorded.
CONTROLS = [
    ('C1 prose mentioning SessionArchiver, outside the eviction fn',
     'GREEN', [Mutant(SCHED, FN_ANCHOR,
                      '  // control: mentions SessionArchiver and archiveSession\n\n' + FN_ANCHOR)]),
]


def run(label, expect):
    r = subprocess.run(['npx', 'vitest', 'run', TEST, '--reporter=basic'],
                       cwd=HUB, capture_output=True, text=True, timeout=600)
    out = r.stdout + r.stderr
    # A HARD harness error is never a green result: a transform/collect failure
    # prints "no tests" or "0 total" (the #181 family).
    if 'no tests' in out or re.search(r'Tests\s+0\s+total', out):
        print(f'{label:<58} HARNESS-ERROR (0 tests collected)')
        print(out[-2500:])
        return 'HARNESS-ERROR'
    m2 = re.search(r'Tests\s+(?:.*?\s)?(\d+) passed', out)
    m3 = re.search(r'Tests\s+(?:.*?\s)?(\d+) failed', out)
    if not m2:
        print(f'{label:<58} HARNESS-ERROR (no Tests: line)')
        print(out[-2500:])
        return 'HARNESS-ERROR'
    passed, failed = m2.group(1), (m3.group(1) if m3 else '0')
    status = 'GREEN' if (failed == '0' and 'Test Files  1 failed' not in out) else 'RED'
    verdict = 'OK' if status == expect else 'HARNESS-ERROR'
    print(f'{label:<58} {status:<5} passed={passed} failed={failed}  [{verdict}]')
    if verdict == 'HARNESS-ERROR':
        print(out[-2500:])
    return status


def main():
    if not preflight():
        return 1
    snapshot_baseline()
    print()
    print('--- CONTROL (must be GREEN) ---')
    ctl = run('control unmodified', 'GREEN')
    if ctl != 'GREEN':
        print('CONTROL NOT GREEN -- the suite is not a valid baseline, refusing to mutate.')
        return 1

    print()
    print('--- ARMS ---')
    survivors, errors = [], []
    for name, arm in ARMS:
        # EVERY apply is inside the try (D2).
        try:
            for a in arm:
                a.apply()
            st = run(name, 'RED')
            if st == 'HARNESS-ERROR':
                errors.append(name)
            elif st == 'GREEN':
                survivors.append(name)
        except SystemExit as e:
            # Anchor miss / non-unique needle: record it, still restore below.
            print(f'{name:<58} SKIPPED ({e})')
            errors.append(name)
        finally:
            restore()          # unconditional, from the PRISTINE baseline (D1)

    print()
    print('--- CONTROLS (must SURVIVE) ---')
    ctrl_deaths = []
    for name, expect, arm in CONTROLS:
        try:
            for a in arm:
                a.apply()
            st = run(name, expect)
            if st != expect:
                ctrl_deaths.append(name)
        except SystemExit as e:
            print(f'{name:<58} SKIPPED ({e})')
            ctrl_deaths.append(name)
        finally:
            restore()

    print()
    if not tree_clean():
        return 1
    print('restore verified by md5: all OWNED files byte-identical to baseline')
    print()
    print(f'ARMS: {len(ARMS)}  KILLED: {len(ARMS) - len(survivors) - len(errors)}  '
          f'SURVIVED: {len(survivors)}  ERRORS: {len(errors)}')
    for s in survivors:
        print(f'  SURVIVED: {s}')
    for e in errors:
        print(f'  ERROR:    {e}')
    print(f'CONTROLS: {len(CONTROLS)}  wrongly-killed: {len(ctrl_deaths)}')
    for c in ctrl_deaths:
        print(f'  CONTROL DIED: {c}  <-- the suite is a shape detector; '
              'the KILLED verdicts are suspect')
    return 1 if (survivors or errors or ctrl_deaths) else 0


if __name__ == '__main__':
    try:
        rc = main()
    finally:
        if BASELINE:
            restore()                   # belt and braces on the way out
            print('final restore done; OWNED files at baseline: '
                  + str(all(md5(open(p, 'rb').read()) == md5(v)
                            for p, v in BASELINE.items())))
        else:
            print('preflight aborted before any snapshot; nothing was mutated, '
                  'so nothing is restored (restore over an empty baseline would '
                  'truncate every OWNED file to zero bytes).')
    sys.exit(rc)
