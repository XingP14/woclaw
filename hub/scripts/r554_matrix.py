#!/usr/bin/env python3
"""R554 mutation matrix -- the CREDENTIAL-TRANSPORT plane.

CONTROL STATE ON THE DEFECTIVE TREE (must be ASSERTED, not inferred):
    A1, A2, A3, A4, A5, A6, A7, B1, B2, B3, C, D, E  ALL GREEN.

Discipline (inherited from R541-7 / R542 / R550 / R553):
  - control FIRST: the unmutated suite must pass, and the control must assert
    that EVERY expected arm was RESOLVED (a lookup miss is neither pass nor
    fail -- R544-11 / R497's lesson)
  - the runner is resolved from THIS tree (never `npx` -- R514/R517: npx
    DOWNLOADS a tool, so a driver can measure with a different major)
  - the JSON reporter states each arm's status explicitly
  - the EXPECTED red-arm set is asserted per mutant, not "some arm went red"
  - restore is byte + mtime exact, in a `finally`
  - the injection asserts the needle was PRESENT, was UNIQUE, and that the
    replacement DIFFERED (R507: a mutation that was never applied is
    NOT-INJECTED, and NOT-INJECTED is not a verdict)
  - the source tree must be CLEAN before the first injection (R475-2)

THE MUTANTS -- each is a REAL repair of the defect, applied to the OWNED
production file, plus two non-repairs that a naive driver would mis-score.

  M1  REPAIR: the WS plane ALSO accepts the RFC-6750 header form (the
      recommended form). The query form keeps working; the header WINS.
      => the defect-pins that assert the header is REJECTED must flip.
      => KILLED.

  M2  REPAIR (the other shape): the WS plane accepts the HEADER form ONLY --
      the credential leaves the request line entirely.
      => a DIFFERENT repair shape from M1, and both must be killed; killing
      only one proves the suite measures a mechanism rather than the defect.
      => KILLED.

  M3  NEGATIVE CONTROL: an inert comment. Nothing may move.
      => SURVIVED.

  M4  REPAIR (the REST side): the REST plane ALSO accepts the query-string
      form. This does NOT fix the asymmetry on its own -- but it changes the
      transport shape, and the source-shape arm must see it.
      => KILLED.

  M5  NON-REPAIR: the WS plane READS the header into a variable and does not
      authorise with it. The shape changes; the behaviour does not. A driver
      that only counted red arms would call this a kill and thereby bless a
      change that changes nothing about the exposure.
      => SURVIVED.

EXPECTED RED-ARM SETS WERE DERIVED BY READING THE MECHANISM, NOT BY FITTING.

  A2  "the header form is REJECTED"      -> flips under M1 (header wins) and
                                            M2 (header only)
  A6  "a valid header with a garbage query is REJECTED (no fallback)"
                                        -> flips under M1 and M2
  A1  "the query form is ADMITTED"       -> flips under M2 (header only)
  C   "the SAME credential is valid on one transport and invalid on the
        other"                          -> flips under M1 and M2
  E   "the WS plane reads the credential from the QUERY STRING and the REST
        plane from the Authorization HEADER" -> flips under M2 (WS no longer
        reads the query) and M4 (REST now reads the query)
  D   "the credential travels in the request line" -> stays GREEN under every
      mutant, because the arm measures the REQUEST the suite itself makes.
      A mutant that moves the product's credential into a header does not
      move the suite's own client, so D is a characterisation of the
      CURRENT transport, not a defect-pin.
"""
import hashlib
import json
import pathlib
import subprocess
import sys
import tempfile
import time

# R510/R511: a path baked into a script is validated on exactly ONE host --
# the CI runner and the author's checkout are different hosts, and the defect
# is invisible on the author's. The path is DERIVED from this file's own
# location, so a copy of this driver measures the tree it stands in.
HUB = pathlib.Path(__file__).resolve().parent.parent
SRC = HUB / "src"
TEST = HUB / "test" / "r554_credential_transport_plane.test.ts"
VITEST = HUB / "node_modules" / ".bin" / "vitest"

OWNED_REST = SRC / "rest_server.ts"
OWNED_WS = SRC / "ws_server.ts"
ARMS = ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "B1", "B2", "B3", "C", "D", "E"]


def md5(p: pathlib.Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def _run_once(extra: list[str] | None = None) -> dict:
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tf:
        out = tf.name
    try:
        proc = subprocess.run(
            [str(VITEST), "run", str(TEST), *(extra or []), "--reporter=json",
             f"--outputFile={out}"],
            cwd=str(HUB), capture_output=True, text=True, timeout=900,
        )
        try:
            data = json.loads(pathlib.Path(out).read_text())
        except Exception:
            return {"_harness": f"rc={proc.returncode} no-json; stderr={proc.stderr[-600:]}"}
        result = {}
        for tr in data.get("testResults", []):
            for a in tr.get("assertionResults", []):
                head = a.get("title", "").split(" ")[0].rstrip(".:,")
                result[head] = a.get("status")
        result["_rc"] = proc.returncode
        missing = [a for a in ARMS if a not in result]
        result["_resolved"] = sorted(a for a in ARMS if a in result)
        if missing:
            result["_harness"] = f"unresolved arms: {missing} (titles parsed wrongly)"
        return result
    finally:
        pathlib.Path(out).unlink(missing_ok=True)


def run_suite(retries: int = 2) -> dict:
    last = {}
    for attempt in range(retries + 1):
        last = _run_once()
        if not last.get("_harness"):
            return last
        print(f"    [harness retry {attempt+1}/{retries+1}] {last['_harness'][:200]}", flush=True)
        time.sleep(15)
    return last


def red_arms(result: dict) -> set:
    return {a for a in ARMS if result.get(a) == "failed"}


def run_arm(arm: str, retries: int = 2) -> dict:
    last = {}
    for attempt in range(retries + 1):
        last = _run_once(["-t", f"{arm} "])
        if not last.get("_harness"):
            return last
        time.sleep(15)
    return last


def inject(path: pathlib.Path, needle: str, replacement: str) -> None:
    """Replace a needle EXACTLY once, asserting every precondition."""
    before = path.read_text()
    count = before.count(needle)
    if count != 1:
        raise SystemExit(f"INJECTION REFUSED: needle occurs {count}x in {path.name} (must be 1)")
    after = before.replace(needle, replacement)
    if after == before:
        raise SystemExit(f"INJECTION REFUSED: replacement did not change {path.name}")
    path.write_text(after)


# ── the WS credential read (ws_server.ts, handleConnection) ──────────────────
WS_OLD = """    const agentId = url.searchParams.get('agentId');
    const token = url.searchParams.get('token');
"""

WS_M1 = """    const agentId = url.searchParams.get('agentId');
    const authHeader = req.headers.authorization;
    const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const token = headerToken ?? url.searchParams.get('token');
"""

WS_M2 = """    const agentId = url.searchParams.get('agentId');
    const authHeader = req.headers.authorization;
    const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const token = headerToken;
"""

# M5: the header is READ but does not AUTHORISE -- a shape change with no
# behavioural change. This is the non-repair the suite must NOT call a kill.
WS_M5 = """    const agentId = url.searchParams.get('agentId');
    const authHeader = req.headers.authorization;
    const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    void headerToken; // R554-M5: read but not used for authorisation
    const token = url.searchParams.get('token');
"""

# ── the REST credential read (rest_server.ts, auth check) ────────────────────
REST_OLD = """    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
"""

REST_M4 = """    const authHeader = req.headers.authorization;
    const queryToken = url.searchParams.get('token');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : (queryToken ?? undefined);
"""

MUTANTS = [
    ("M1", "REPAIR: the WS plane ALSO accepts the RFC-6750 header form (the header wins)",
     OWNED_WS, WS_OLD, WS_M1, {"A2", "A6", "C"}, "KILLED"),
    ("M2", "REPAIR (other shape): the WS plane accepts the HEADER form ONLY",
     OWNED_WS, WS_OLD, WS_M2, {"A1", "A2", "A6", "C", "E"}, "KILLED"),
    ("M3", "NEGATIVE CONTROL: an inert comment",
     OWNED_WS, "    const token = url.searchParams.get('token');",
     "    const token = url.searchParams.get('token'); // R554-M3: no change of behaviour",
     set(), "SURVIVED"),
    ("M4", "REPAIR (the REST side): the REST plane ALSO accepts the query-string form",
     OWNED_REST, REST_OLD, REST_M4, {"E"}, "KILLED"),
    ("M5", "NON-REPAIR: the WS plane READS the header but does not authorise with it",
     OWNED_WS, WS_OLD, WS_M5, set(), "SURVIVED"),
]


def main() -> int:
    pre = subprocess.run(["git", "status", "--porcelain", "--", "src/"],
                         cwd=str(HUB), capture_output=True, text=True)
    if pre.stdout.strip():
        print(f"ABORT: hub/src is not clean:\n{pre.stdout}")
        return 2
    base = {OWNED_REST: md5(OWNED_REST), OWNED_WS: md5(OWNED_WS)}
    base_mtime = {OWNED_REST: OWNED_REST.stat().st_mtime, OWNED_WS: OWNED_WS.stat().st_mtime}
    print(f"baseline md5: rest_server.ts={base[OWNED_REST]} ws_server.ts={base[OWNED_WS]}")

    print("\n=== CONTROL (unmutated) ===")
    ctl = run_suite()
    if ctl.get("_harness"):
        print(f"CONTROL HARNESS FAILURE: {ctl['_harness']}")
        return 2
    print(f"  resolved arms: {ctl['_resolved']}")
    if len(ctl["_resolved"]) != len(ARMS):
        print(f"CONTROL INVALID: only {len(ctl['_resolved'])}/{len(ARMS)} arms resolved")
        return 2
    ctl_red = red_arms(ctl)
    if ctl_red:
        print(f"CONTROL NOT GREEN: red = {sorted(ctl_red)}")
        return 2
    print("  CONTROL GREEN (all arms resolved, none red)")

    results = []
    for mid, meaning, path, needle, repl, expected, expect_verdict in MUTANTS:
        print(f"\n=== {mid}: {meaning} ===")
        print(f"  expected verdict: {expect_verdict}; expected red arms: {sorted(expected)}")
        before = path.read_bytes()
        before_mtime = path.stat().st_mtime
        try:
            inject(path, needle, repl)
            if md5(path) == base[path]:
                print("  NOT-INJECTED: the file is byte-identical to the baseline")
                results.append((mid, "NOT-INJECTED", set(), expected, expect_verdict))
                continue
            res = run_suite()
            if res.get("_harness"):
                print(f"  HARNESS: {res['_harness'][:160]}")
                results.append((mid, "HARNESS", set(), expected, expect_verdict))
                continue
            red = red_arms(res)
            extra = red - expected
            missing = expected - red
            # Flake adjudication: an extra red arm is re-run ALONE under the
            # SAME mutation. Green alone => flake; red alone => a real kill.
            real_extra = set()
            for arm in sorted(extra):
                alone = run_arm(arm)
                if alone.get(arm) == "failed":
                    real_extra.add(arm)
                else:
                    print(f"  [flake] {arm} was red in the suite but GREEN in isolation")
            if real_extra:
                red |= real_extra
            if missing or real_extra:
                verdict = "WRONG-ARMS"
            elif expect_verdict == "SURVIVED":
                verdict = "SURVIVED"
            else:
                verdict = "KILLED"
            print(f"  red={sorted(red)} expected={sorted(expected)} "
                  f"missing={sorted(missing)} extra={sorted(extra)} => {verdict}")
            results.append((mid, verdict, red, expected, expect_verdict))
        finally:
            path.write_bytes(before)
            import os
            os.utime(path, (before_mtime, before_mtime))
        ok_md5 = md5(path) == base[path]
        ok_mtime = abs(path.stat().st_mtime - base_mtime[path]) < 1.0
        print(f"  restored: md5 {md5(path)} == baseline -> {ok_md5}; mtime restored -> {ok_mtime}")

    killed = [m for m in results if m[1] == "KILLED"]
    survived = [m for m in results if m[1] == "SURVIVED"]
    harness = [m for m in results if m[1] in ("HARNESS", "NOT-INJECTED")]
    wrong = [m for m in results if m[1] == "WRONG-ARMS"]
    print("\n=== SUMMARY ===")
    print(f"  KILLED={len(killed)} SURVIVED={len(survived)} HARNESS={len(harness)} WRONG-ARMS={len(wrong)}")
    for mid, verdict, red, expected, expect_verdict in results:
        ok = "OK" if verdict == expect_verdict else f"MISMATCH (wanted {expect_verdict})"
        print(f"  {mid}: {verdict} [{ok}] red={sorted(red)} expected={sorted(expected)}")
    mismatched = [m for m in results if m[1] != m[4]]
    if harness or wrong or mismatched:
        print("\nVERDICT: FAIL")
        return 1
    print("\nVERDICT: PASS")
    print("  (M5's SURVIVED verdict is the load-bearing one: READING a")
    print("   credential in a second place is not the same as AUTHORISING")
    print("   with it, and the suite says so.)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
