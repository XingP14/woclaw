// hub/test/r506_detector_derived_from_host.test.ts
//
// R506 — the system-file DETECTOR must be derived from the HOST, not from
// one author's hostname.
//
// THE DEFECT (measured, not suspected)
//
// The UI-static-server suites guard the static handler with a DETECTOR: a
// predicate answering "does this response body contain the bytes of a
// system file?". That detector only means anything if it can actually FIRE
// on a real system file — otherwise every negative arm ("the server did not
// serve /etc/passwd") is vacuously true.
//
// The detector was:
//
//     /root:x:0:0/.test(body) || /root:\$1\$/.test(body) || /us-vps4/.test(body)
//
// The first two arms are HOST-INDEPENDENT: the root line of /etc/passwd and
// the root line of /etc/shadow have the same shape on every Linux, by spec.
// The THIRD arm was THIS AUTHOR'S OWN HOSTNAME, transcribed from the machine
// the suite was written on.
//
// MEASURED consequence, in a controlled A/B that changes the hostname and
// NOTHING else (unshare -m + mount --bind of a synthetic /etc/hostname):
//
//     variant        author host        simulated CI host
//     HEAD (r498c)  7/7 green          1 failed / 6 passed
//     FIXED          7/7 green          7/7 green
//
// ⇒ `master` was RED on every GitHub Actions runner, while the product under
// test was perfectly correct. The defect is invisible on the one host the
// suite was authored on.
//
// THE SECOND DEFECT (found while fixing the first)
//
// The r498b F8 arm asserted `served === false` ONLY IF `served` was already
// true. On a FIXED server `served` is false, so the assertion never ran and
// the arm proved nothing — a tautology wearing a control's name, one level
// up from the control it was checking. It was green on BOTH hosts, so it
// never detected the defect above either.
//
// A second, mirrored shape lived in the r498c arm: the file loop `continue`d
// past every unreadable file, so it could exit GREEN having checked NOTHING.
//
// WHAT THIS SUITE PINS
//
// This suite does NOT re-test the static server's confinement (r498b/r498c
// own that). It pins the PROPERTY that makes their negative arms mean
// anything:
//
//   A. the marker set is DERIVED from the host at runtime;
//   B. NO source literal anywhere in the tree hardcodes THIS host's name;
//   C. the detector recognises the real system files;
//   D. there is exactly ONE definition of the detector in the tree.
//
// Arm (B) is inherently HOST-LOCAL: it compares source literals against the
// hostname of the machine running the suite. On the author's own machine
// that is exactly the historical literal, so the arm catches the exact bug
// that was shipped. On a CI runner the hostname differs and the arm is
// vacuously green — arm (A) is the host-independent half, and the two
// together cover both ends.
//
// NO CREDENTIAL IS EVER PRINTED. The markers are used only as boolean probes
// against file contents; no file body is echoed into a failure message.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { isSystemFile, systemFileMarkers } from './support/system-file-marker.js';
import { stripComments } from './support/ts-scanner.js';

/**
 * 🔴 R507 — THE SUBJECT SET IS ANCHORED TO THIS FILE.
 *
 * This suite used to walk `src` and `test` RELATIVE TO THE LAUNCH
 * DIRECTORY.  Measured: launched from `hub/` it was 6/6 green; launched
 * from the repository root -- which is a LEGAL invocation, because the
 * root config's `include` globs `hub/test/**` -- arm (4) read an EMPTY
 * offender list and went RED with
 *
 *     Expected: ["test/support/system-file-marker.ts"]
 *     Received: []
 *
 * i.e. the suite whose subject is "a detector must be derived from the
 * HOST" derived its own subject set from the launch directory -- the
 * exact class of defect R507 pins, committed in the very suite written
 * to police detectors.
 *
 * It is also the subject of arm (B) of R506: a rule that reads one
 * environment's shape has only ever been verified on that environment.
 * The launch directory IS such an environment.
 */
const HERE = dirname(fileURLToPath(import.meta.url)); // <repo>/hub/test
const HUB_ROOT = join(HERE, '..');

/** Every string literal in the source, as its raw text. */
function stringLiterals(src: string): string[] {
  const out: string[] = [];
  const re = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[2]);
  return out;
}

const DETECTOR_PATH = 'test/support/system-file-marker.ts';

/** The subject set for the tree-wide scans: the hub's own source and tests. */
const SUBJECT_ROOTS = [join(HUB_ROOT, 'src'), join(HUB_ROOT, 'test')];

/**
 * Every .ts file under the subject roots.
 *
 * The roots are ABSOLUTE and anchored to THIS FILE, so the subject set is
 * the same tree whatever the launch directory is.  Paths are returned
 * RELATIVE to the hub directory, because that is the form the arms
 * compare against (`DETECTOR_PATH`).
 */
function subjectFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(p, depth + 1);
        continue;
      }
      if (p.endsWith('.ts')) out.push(p);
    }
  };
  for (const root of SUBJECT_ROOTS) walk(root, 0);
  return out
    .map((p) => p.slice(HUB_ROOT.length + 1))
    .sort();
}

/** The hostname of THIS host, as the kernel reports it. */
function currentHostname(): string {
  try {
    const fromFile = readFileSync('/etc/hostname', 'utf8').trim();
    if (fromFile.length > 0) return fromFile;
  } catch {
    // fall through to the syscall
  }
  try {
    const os = require('os');
    const h = os.hostname();
    if (typeof h === 'string' && h.length > 0) return h.trim();
  } catch {
    // ignore
  }
  return '';
}

describe('R506 — the system-file detector must be derived from the host, not from one author\'s hostname', () => {
  // (0) THE PREMISE. A detector that cannot fire makes every negative arm
  // vacuously true. This arm pins the SHAPE of that claim, as a fact about
  // the corpus rather than about the source.
  it('(0) premise: a body that contains a system file must be distinguishable from one that does not', () => {
    const marker = systemFileMarkers();
    expect(marker.length).toBeGreaterThan(0);
    // A body with NO system-file bytes must not be flagged.
    expect(isSystemFile('this is not a system file')).toBe(false);
  });

  // (1) ⭐ ARM A — THE MARKER SET IS DERIVED AT RUNTIME. The hostname
  // marker must be the CONTENT of /etc/hostname on THIS host. If the
  // detector hardcoded a hostname, this arm goes RED on any host whose name
  // differs from the hardcoded one — which is every CI runner.
  it('(1) the marker set contains this host\'s OWN hostname, read from /etc/hostname at runtime', () => {
    const hostname = currentHostname();
    expect(
      hostname,
      'this host has no discoverable hostname, so the derivation cannot be checked',
    ).not.toBe('');
    const markers = systemFileMarkers();
    expect(
      markers,
      'the marker set does not contain this host\'s own hostname -- the detector is NOT derived from the host',
    ).toContain(hostname);
  });

  // (2) ⭐ ARM B — NO SOURCE LITERAL IN THE TREE HARDCODES THIS HOST'S
  // NAME. This is the historical defect, pinned as a STANDING gate. It is
  // HOST-LOCAL by construction: on the machine the defect was authored on,
  // the literal IS this host's name, and the arm fires.
  //
  // Comments are stripped first: the fix's own prose MENTIONS the old
  // literal to document what was wrong, and a gate that fires on prose
  // would forbid documenting the defect it forbids.
  it('(2) no source literal in the tree hardcodes this host\'s name', () => {
    const hostname = currentHostname();
    if (hostname === '') {
      // Nothing to compare against: report nothing rather than a false pass.
      expect(true).toBe(true);
      return;
    }
    const offenders: string[] = [];
    for (const p of subjectFiles()) {
      const src = stripComments(readFileSync(p, 'utf8'));
      for (const lit of stringLiterals(src)) {
        if (lit.includes(hostname)) offenders.push(`${p}: ${JSON.stringify(lit)}`);
      }
    }
    expect(
      offenders,
      `the tree hardcodes this host's name ("${hostname}") -- a rule that hardcodes one host's name has only ever been verified on that host`,
    ).toEqual([]);
  });

  // (3) ⭐ ARM C — THE DETECTOR RECOGNISES THE REAL SYSTEM FILES. The
  // negative arms in r498b/r498c are only meaningful if this is true.
  it('(3) the detector recognises the real /etc/passwd and /etc/hostname', () => {
    expect(
      isSystemFile(readFileSync('/etc/passwd', 'utf8')),
      'the detector cannot recognise the real /etc/passwd -- every negative arm in r498b/r498c is vacuous',
    ).toBe(true);
    expect(
      isSystemFile(readFileSync('/etc/hostname', 'utf8')),
      'the detector cannot recognise the real /etc/hostname -- every negative arm in r498b/r498c is vacuous',
    ).toBe(true);
  });

  // (4) ⭐ ARM D — ONE RULE, ONE COPY. The detector existed as TWO copies
  // inside the two suites, plus copies in the probes, plus one in the
  // sibling repository. A rule that lives in several places is a rule that
  // drifts — and it DID drift, in the exact way this round is about.
  it('(4) there is exactly ONE definition of the detector in the tree', () => {
    const offenders: string[] = [];
    for (const p of subjectFiles()) {
      const src = readFileSync(p, 'utf8');
      if (/function\s+isSystemFile\b/.test(src) || /const\s+isSystemFile\s*=/.test(src)) {
        offenders.push(p);
      }
    }
    expect(
      offenders,
      'the detector is defined more than once -- one rule, one copy',
    ).toEqual([DETECTOR_PATH]);
  });

  // (5) ⭐ ARM E — THE CONTROL ARM ITSELF MUST BE ABLE TO FAIL. The r498c
  // arm used to `continue` past every unreadable file, so it could exit
  // green having checked NOTHING. This arm pins the shape of the fix: the
  // shared detector's marker list is non-empty AND at least one of them is
  // a marker the suite actually reads off a real file. A detector whose
  // markers are all derived from files that are unreadable would satisfy
  // "non-empty" and prove nothing.
  it('(5) the marker set is non-empty AND at least one marker is present in a real readable system file', () => {
    const markers = systemFileMarkers();
    expect(markers.length).toBeGreaterThan(0);
    const passwd = readFileSync('/etc/passwd', 'utf8');
    const hit = markers.filter((m) => passwd.includes(m));
    expect(
      hit.length,
      'no marker matches the real /etc/passwd -- the detector cannot fire on a system file, so every negative arm is vacuous',
    ).toBeGreaterThan(0);
  });
});
