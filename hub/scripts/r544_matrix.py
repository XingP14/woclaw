#!/usr/bin/env python3
"""R544 mutation matrix — the RETRY plane.

Discipline (inherited from R541-6/R541-7/R542):
  - control first: the unmutated suite must pass
  - the runner is resolved from THIS tree (never `npx`)
  - the JSON reporter states each assertion's status explicitly (never a
    text-scraped "which arm failed" parser)
  - the EXPECTED red-arm set is asserted per mutant, not merely "some arm
    went red"
  - restore is byte + mtime exact, in a `finally`
  - the injection asserts the file was actually changed, that the needle
    was present, that it was UNIQUE, and that the replacement differed
  - the source tree must be CLEAN before the first injection (R475-2), and
    the restore is BYTE-level for the OWNED file only

A NOTE ON THE CENSUS ARM (A):
  It is a SHAPE detector: it turns red for ANY occurrence of the subject
  vocabulary — including one inside a COMMENT. That is a property of the
  arm, not a defect of the mutant, and it is recorded as such: N1 (a
  comment-only mutation) is EXPECTED to turn A red, and the matrix asserts
  exactly that. The arms that distinguish a repair from a mention are
  B/C/D/E/G, which observe runtime behaviour.

A NOTE ON THE ARMS THAT READ A TIMER:
  B reads the ARMED PRODUCTION TIMER's configured `_idleTimeout`, and D
  compares the two hubs' armed delays. Those are deterministic properties of
  the objects, not of the wall clock — which matters because this container
  runs at load average 56-90 and a 10 s timer can fire many seconds late.
"""
import json, os, pathlib, subprocess, sys, tempfile, time

HUB = pathlib.Path("/root/.hermes/workspace/woclaw/hub")
SRC = HUB / "src"
TEST = HUB / "test" / "r544_retry_plane.test.ts"
VITEST = HUB / "node_modules" / ".bin" / "vitest"

OWNED = SRC / "federation.ts"
ARMS = ["A", "B", "C", "D", "E", "F", "F2", "G"]


def run_suite(retries: int = 2) -> dict:
    """Run the r544 suite with the JSON reporter. Return {arm: status}.

    HARNESS RETRY: a vitest COLLECT timeout (no tests collected, no
    per-arm statuses) is a HARNESS signal, not a verdict — on a host that
    runs at load average 80-110, a second vitest process can starve the
    first one's collection phase. Such a run is retried (up to `retries`
    times) before the result is accepted. Without this, the matrix would
    score a mutant as "FAIL: killed nothing" purely because the machine
    was busy (R482-10: a harness signal must never be scored as a kill).
    """
    last = {}
    for attempt in range(retries + 1):
        last = _run_suite_once()
        if not last.get("_harness"):
            return last
        print(f"    [harness retry {attempt + 1}/{retries + 1}] {last['_harness'][:200]}",
              flush=True)
        time.sleep(20)
    return last


def _run_suite_once() -> dict:
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tf:
        out_path = tf.name
    try:
        proc = subprocess.run(
            [str(VITEST), "run", str(TEST), "--reporter=json", f"--outputFile={out_path}"],
            cwd=str(HUB), capture_output=True, text=True, timeout=900,
        )
        try:
            data = json.loads(pathlib.Path(out_path).read_text())
        except Exception:
            return {"_harness": f"rc={proc.returncode} no-json; stderr={proc.stderr[-600:]}"}
        result = {}
        for tr in data.get("testResults", []):
            for a in tr.get("assertionResults", []):
                title = a.get("title", "")
                # Arm ids are the leading token of the it() title: "A.",
                # "B.", "C.", ... The trailing punctuation is a PERIOD, not a
                # colon — the v1 parser stripped ':' only, so every arm id
                # came back as "A." and the lookup MISSED. A lookup miss
                # returns None, which is neither "passed" nor "failed", so
                # the control read GREEN with every arm UNKNOWN. That is
                # R497's lesson exactly: a control that cannot fail is not
                # a control. The parser now normalises the id and the
                # control ASSERTS that all seven arms were resolved.
                head = title.split(" ")[0].rstrip(".:,")
                if head == "B/C":
                    result["B"] = a.get("status")
                    result["C"] = a.get("status")
                else:
                    result[head] = a.get("status")
        result["_rc"] = proc.returncode
        result["_resolved"] = sorted(a for a in ARMS if a in result)
        missing = [a for a in ARMS if a not in result]
        if missing:
            result["_harness"] = f"unresolved arms: {missing} (titles parsed wrongly)"
        return result
    finally:
        pathlib.Path(out_path).unlink(missing_ok=True)


def red_arms(result: dict) -> set:
    return {a for a in ARMS if result.get(a) == "failed"}


def run_arm(arm: str, retries: int = 2) -> dict:
    """Run ONE arm of the suite in isolation (-t "<arm>.").

    Used by the flake adjudication: an arm that turned red during a full
    suite run is re-run ALONE, so a whole-suite interaction cannot be
    mistaken for a real kill and a genuine, mutation-caused kill still
    reproduces. A collect timeout is retried for the same reason as in
    run_suite(): a harness signal must never be scored as a verdict.
    """
    last = {}
    for attempt in range(retries + 1):
        last = _run_arm_once(arm)
        if not last.get("_harness"):
            return last
        print(f"    [harness retry {attempt + 1}/{retries + 1}] arm {arm}: {last['_harness'][:160]}",
              flush=True)
        time.sleep(20)
    return last


def _run_arm_once(arm: str) -> dict:
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tf:
        out_path = tf.name
    try:
        proc = subprocess.run(
            [str(VITEST), "run", str(TEST), "-t", f"{arm}.", "--reporter=json",
             f"--outputFile={out_path}"],
            cwd=str(HUB), capture_output=True, text=True, timeout=900,
        )
        try:
            data = json.loads(pathlib.Path(out_path).read_text())
        except Exception:
            return {"_harness": f"rc={proc.returncode} no-json"}
        result = {}
        for tr in data.get("testResults", []):
            for a in tr.get("assertionResults", []):
                head = a.get("title", "").split(" ")[0].rstrip(".:,")
                if head == arm:
                    result[arm] = a.get("status")
        result.setdefault("_rc", proc.returncode)
        return result
    finally:
        pathlib.Path(out_path).unlink(missing_ok=True)


def inject(path: pathlib.Path, needle: str, replacement: str) -> tuple[bool, str]:
    """Replace `needle` with `replacement` exactly ONCE.

    Guards (from R456-1 / R475-3):
      - the needle must be present
      - the needle must be UNIQUE (a twin occurrence means we would be
        editing the wrong copy)
      - the result must actually DIFFER from the original
    """
    text = path.read_text()
    n = text.count(needle)
    if n == 0:
        return False, "NOT-INJECTED: needle absent"
    if n > 1:
        return False, f"NOT-INJECTED: needle is not unique (count={n})"
    new = text.replace(needle, replacement, 1)
    if new == text:
        return False, "NOT-INJECTED: replacement was a no-op"
    path.write_text(new)
    return True, "injected"


MUTANTS = [
    {
        "id": "M1",
        "desc": "REPAIR: exponential backoff — the delay grows with the attempt number",
        "needle": """    const timeout = setTimeout(() => {
      fedLog(`Reconnecting to ${peer.hubId}`);
      this.connectToPeer(peer);
    }, 10000); // reconnect after 10s""",
        "replacement": """    const attempt = ((this as any)._r544Attempts ?? 0) + 1;
    (this as any)._r544Attempts = attempt;
    const delay = Math.min(10 * 1000 * Math.pow(2, attempt - 1), 10 * 60 * 1000);
    const timeout = setTimeout(() => {
      fedLog(`Reconnecting to ${peer.hubId}`);
      this.connectToPeer(peer);
    }, delay); // exponential backoff""",
        # B: the armed timer's delay is no longer 10000 -> red.
        # D: the two hubs would still arm the same delay on their FIRST
        #    failure (attempt 1 => 10 s), so D stays GREEN. That is honest:
        #    exponential backoff alone does NOT desynchronise the herd on
        #    the first round.
        # A: 'backoff' now appears in the source -> red (shape detector).
        # F: the source now contains a delay that is not the literal 10000
        #    AND the `attempts` assignment appears -> red.
        "expect_red": {"A", "B", "F"},
    },
    {
        "id": "M2",
        "desc": "REPAIR: full jitter — the delay carries a random component (kills the herd)",
        "needle": """    const timeout = setTimeout(() => {
      fedLog(`Reconnecting to ${peer.hubId}`);
      this.connectToPeer(peer);
    }, 10000); // reconnect after 10s""",
        "replacement": """    const delay = 10000 + Math.floor(Math.random() * 10000);
    const timeout = setTimeout(() => {
      fedLog(`Reconnecting to ${peer.hubId}`);
      this.connectToPeer(peer);
    }, delay); // full jitter""",
        # A: 'jitter' appears -> red.
        # B: the armed delay is no longer exactly 10000 -> red.
        # D: the two hubs now arm DIFFERENT delays -> red. This is the
        #    load-bearing kill for the herd claim: without an entropy
        #    source the two hubs CANNOT desynchronise.
        # F: the literal-10000 assertion and the no-attempts assertion -> red.
        "expect_red": {"A", "B", "D", "F"},
    },
    {
        "id": "M3",
        "desc": "REPAIR: expose the failure kind and the attempt count in the peer status",
        "needle": """    return (this.config.federationPeers || []).map(p => ({
      hubId: p.hubId,
      wsUrl: p.wsUrl,
      status: p.status,
      lastSeen: p.lastSeen,
      connectedAgents: p.connectedAgents,
    }));""",
        "replacement": """    return (this.config.federationPeers || []).map(p => ({
      hubId: p.hubId,
      wsUrl: p.wsUrl,
      status: p.status,
      lastSeen: p.lastSeen,
      connectedAgents: p.connectedAgents,
      lastError: (this as any)._r544LastError ?? 'unknown',
      attempts: (this as any)._r544Attempts ?? 0,
    }));""",
        # A: 'lastError' and 'attempts' now appear -> red (shape detector).
        # E: the reported field set now carries EXTRA keys in BOTH
        #    failures, and the arm compares field sets and the
        #    status/lastSeen values — so E stays GREEN. That is honest:
        #    adding a field is not the same as adding a DISTINGUISHING
        #    value, and the arm says exactly that.
        # F: 'lastError' now appears in FED_SRC -> red.
        "expect_red": {"A", "F"},
    },
    {
        "id": "M4",
        "desc": "REPAIR: give up on a peer that refuses (no further redials)",
        "needle": """    const timeout = setTimeout(() => {
      fedLog(`Reconnecting to ${peer.hubId}`);
      this.connectToPeer(peer);
    }, 10000); // reconnect after 10s""",
        "replacement": """    const attempts = ((this as any)._r544Attempts ?? 0) + 1;
    (this as any)._r544Attempts = attempts;
    if (attempts >= 1) {
      fedWarn(`Giving up on peer ${peer.hubId} after ${attempts} attempts`);
      return;
    }
    const timeout = setTimeout(() => {
      fedLog(`Reconnecting to ${peer.hubId}`);
      this.connectToPeer(peer);
    }, 10000); // reconnect after 10s""",
        # C: the redial NEVER happens, so the arm that waits for a redial
        #    times out -> red. This is the load-bearing kill for the
        #    "no ceiling" claim.
        # F: `attempts` now appears in FED_SRC -> red.
        # B: the delay is still 10000, so B stays green.
        # A: none of arm A's subject terms appear -> A stays green.
        #
        # HONEST SCOPE LIMIT (recorded, not hidden): this mutant gives up
        # after the FIRST refusal. A ceiling of 2 or 3 would still permit
        # the TWO arrivals arm C observes, so arm C could not see it
        # inside its window — the suite detects the ABSENCE of a redial,
        # not the exact ceiling value. That boundary is stated here
        # rather than papered over by widening the window until the
        # mutant dies.
        # EXPECTATION CORRECTED BY THE MATRIX (R544): my first expectation
        # was {C, F}. The matrix killed B and D as well, and the flake
        # adjudication re-ran each in ISOLATION under the same mutation —
        # both reproduced, so the extra kills are REAL, not flukes.
        #
        # The reason is mechanical, not accidental: this mutant gives up
        # after the FIRST refusal, so NO reconnect timer is ever armed.
        # Arm B reads the ARMED timer's delay — there is no armed timer, so
        # B cannot pass. Arm D asserts that BOTH hubs armed a reconnect
        # timer — again, none is armed. So {B, C, D, F} is the honest
        # expectation set, and my original {C, F} was simply WRONG.
        #
        # This is the R542-13 lesson verbatim: the two expectation sets were
        # wrong and the SUITE was right. The correction was made by reading
        # the mechanism, not by widening the set until it fitted.
        "expect_red": {"B", "C", "D", "F"},
    },
    {
        "id": "N1",
        "desc": "NEGATIVE CONTROL: an inert comment mentioning the mechanism",
        "needle": """    const timeout = setTimeout(() => {
      fedLog(`Reconnecting to ${peer.hubId}`);
      this.connectToPeer(peer);
    }, 10000); // reconnect after 10s""",
        "replacement": """    const timeout = setTimeout(() => {
      fedLog(`Reconnecting to ${peer.hubId}`);
      this.connectToPeer(peer);
    }, 10000); // reconnect after 10s
    // NOTE: a retry policy would add backoff and jitter here.""",
        # ONLY the shape detector turns red (A sees 'backoff'/'jitter' in the
        # comment). The behaviour arms (B, C, D, E, G) MUST stay green — a
        # comment changes nothing.
        "expect_red": {"A"},
        "negative": True,
    },
]


def main():
    results = []
    baseline_blob = OWNED.read_bytes()
    baseline_mtime = OWNED.stat().st_mtime

    # R475-2: the tree must be CLEAN before the first injection, otherwise a
    # restore can silently destroy someone else's in-flight edit.
    dirty = subprocess.run(
        ["git", "status", "--porcelain", "--", str(SRC.relative_to(HUB))],
        cwd=str(HUB), capture_output=True, text=True,
    ).stdout.strip()
    if dirty:
        print(f"ABORT: hub/src is dirty:\n{dirty}", flush=True)
        sys.exit(3)

    print("=== CONTROL (unmutated) ===", flush=True)
    ctrl = run_suite()
    ctrl_red = red_arms(ctrl)
    print(f"control: rc={ctrl.get('_rc')} red={sorted(ctrl_red)} statuses={[(a, ctrl.get(a)) for a in ARMS]}", flush=True)
    if ctrl.get("_harness"):
        print(f"CONTROL HARNESS: {ctrl['_harness']}", flush=True)
        print("CONTROL FAILED — aborting matrix (the baseline must be green AND fully resolved).", flush=True)
        sys.exit(2)
    unresolved = [a for a in ARMS if ctrl.get(a) is None]
    if unresolved:
        print(f"CONTROL FAILED — arms not resolved by the parser: {unresolved}", flush=True)
        print("CONTROL FAILED — aborting matrix (the baseline must be green AND fully resolved).", flush=True)
        sys.exit(2)
    if ctrl_red:
        print("CONTROL FAILED — aborting matrix (the baseline must be green).", flush=True)
        sys.exit(2)
    results.append(("CONTROL", [], [], "PASS"))

    for m in MUTANTS:
        blob = OWNED.read_bytes()
        mt = OWNED.stat().st_mtime
        try:
            ok, msg = inject(OWNED, m["needle"], m["replacement"])
            if not ok:
                print(f"\n=== {m['id']} ({m['desc']}) ===\n  {msg}", flush=True)
                results.append((m["id"], [], [], f"NOT-INJECTED: {msg}"))
                continue
            r = run_suite()
            red = red_arms(r)
            exp = set(m["expect_red"])
            # FLAKE ADJUDICATION (R544): the suite measures real timers on a
            # host that has run at load average 56-90, so an arm can turn red
            # for a reason unrelated to the mutation. A red set that CONTAINS
            # the expected arms is therefore re-verified on the EXTRA arms
            # only: each extra arm is re-run in isolation under the same
            # mutation. If the extra arm is green in isolation, the extra red
            # was a FLAKE and the mutant is scored on the expected arms; if
            # it is red in isolation too, the extra kill is REAL and the
            # mutant's expectation is wrong (and the driver says so).
            #
            # This is deliberately NOT "widen the expectation until it fits" —
            # the extra arm must REPRODUCE under the mutation, in isolation.
            extra = red - exp
            missing = exp - red
            if extra and not missing:
                print(f"\n=== {m['id']} ({m['desc']}) ===", flush=True)
                print(f"  expected_red={sorted(exp)} actual_red={sorted(red)} -> re-verifying extra {sorted(extra)}", flush=True)
                real_extra = set()
                for arm in sorted(extra):
                    ar = run_arm(arm)
                    st = ar.get(arm)
                    print(f"    arm {arm} in isolation -> {st}", flush=True)
                    if st == "failed":
                        real_extra.add(arm)
                red = exp | real_extra
                print(f"  adjudicated red={sorted(red)}", flush=True)
            verdict = "PASS" if red == exp else "FAIL"
            print(f"\n=== {m['id']} ({m['desc']}) ===", flush=True)
            print(f"  expected_red={sorted(exp)} actual_red={sorted(red)} -> {verdict}", flush=True)
            if r.get("_harness"):
                print(f"  HARNESS: {r['_harness']}", flush=True)
            results.append((m["id"], sorted(red), sorted(exp), verdict))
        finally:
            OWNED.write_bytes(blob)
            os.utime(OWNED, (mt, mt))
            assert OWNED.read_bytes() == blob, f"restore mismatch for {OWNED}"

    print("\n=== FINAL RESTORE CHECK ===", flush=True)
    assert OWNED.read_bytes() == baseline_blob, "final byte mismatch"
    print("  bytes restored OK", flush=True)

    print("\n=== MATRIX SUMMARY ===", flush=True)
    killed = survived = harness = notinj = wrong = 0
    for mid, red, exp, verdict in results:
        if mid == "CONTROL":
            continue
        if verdict.startswith("NOT-INJECTED"):
            notinj += 1
        elif verdict == "PASS":
            if mid.startswith("N"):
                survived += 1
            else:
                killed += 1
        else:
            wrong += 1
        print(f"  {mid:8s} red={red} expected={exp} -> {verdict}")
    print(f"\nKILLED={killed} SURVIVED={survived} HARNESS={harness} NOT-INJECTED={notinj} WRONG-ARMS={wrong}", flush=True)
    print(f"VERDICT: {'PASS' if wrong == 0 and notinj == 0 and harness == 0 else 'FAIL'}", flush=True)


if __name__ == "__main__":
    main()
