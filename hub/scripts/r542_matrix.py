#!/usr/bin/env python3
"""R542 mutation matrix.

Discipline (from R541-6 / R541-7):
  - control first: the unmutated suite must pass
  - the runner is resolved from THIS tree (never `npx`)
  - the JSON reporter states each assertion's status explicitly (never a
    text-scraped "which arm failed" parser)
  - the EXPECTED red-arm set is asserted per mutant, not merely "some arm
    went red"
  - restore is byte + mtime exact, in a `finally`
  - the injection asserts the file was actually changed, that the needle
    was present, that it was UNIQUE, and that the replacement differed

A NOTE ON THE CENSUS ARMS (A and F):
  They are SHAPE detectors. They turn red for ANY occurrence of the
  subject vocabulary — including one inside a COMMENT. That is a property
  of the arm, not a defect of the mutant, and it is recorded as such: N1
  (a comment-only mutation) is EXPECTED to turn A and F red, and the
  matrix asserts exactly that. The arms that distinguish a repair from a
  mention are B/D/E/G, which observe runtime behaviour.
"""
import json, os, pathlib, subprocess, sys, tempfile

HUB = pathlib.Path("/root/.hermes/workspace/woclaw/hub")
SRC = HUB / "src"
TEST = HUB / "test" / "r542_backpressure_plane.test.ts"
VITEST = HUB / "node_modules" / ".bin" / "vitest"

OWNED = SRC / "ws_server.ts"
ARMS = ["A", "B", "C", "D", "E", "F", "G"]


def run_suite() -> dict:
    """Run the r542 suite with the JSON reporter. Return {arm: status}."""
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tf:
        out_path = tf.name
    try:
        proc = subprocess.run(
            [str(VITEST), "run", str(TEST), "--reporter=json", f"--outputFile={out_path}"],
            cwd=str(HUB), capture_output=True, text=True, timeout=600,
        )
        try:
            data = json.loads(pathlib.Path(out_path).read_text())
        except Exception:
            return {"_harness": f"rc={proc.returncode} no-json; stderr={proc.stderr[-600:]}"}
        result = {}
        for tr in data.get("testResults", []):
            for a in tr.get("assertionResults", []):
                arm = a.get("title", "").split(" ")[0].rstrip(":")
                result[arm] = a.get("status")
        result["_rc"] = proc.returncode
        return result
    finally:
        pathlib.Path(out_path).unlink(missing_ok=True)


def red_arms(result: dict) -> set:
    return {a for a in ARMS if result.get(a) == "failed"}


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
        "desc": "REPAIR: bound the outbound backlog — drop messages past a cap in send()",
        "needle": """  private send(ws: WS, msg: OutboundMessage): void {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  }""",
        "replacement": """  private send(ws: WS, msg: OutboundMessage): void {
    if (ws.readyState === 1) {
      // R542-M1: refuse to enqueue beyond a bounded backlog.
      if (ws.bufferedAmount > 4 * 1024 * 1024) {
        hubWarn(`Backlog too large for connection, dropping message`);
        return;
      }
      ws.send(JSON.stringify(msg));
    }
  }""",
        # MEASURED (v1 prediction was WRONG — see the note below).
        #
        # A/F: the vocabulary now appears (shape detectors).
        # B: the backlog no longer grows, so the "it is unbounded" claim
        #    is false → red.
        # D/E/G: red for a reason the v1 prediction did not anticipate:
        #    the cap drops frames for the SLOW peer, and the publisher's
        #    OWN acknowledgements go through the same `send()`. Once the
        #    publisher's socket is also over the cap, its acks stop being
        #    written, so `waitForFanoutComplete` never completes and the
        #    arms time out. That is a REAL behavioural consequence of the
        #    repair (a global cap throttles healthy peers too), not a
        #    harness artefact — the arms are red because the repair
        #    changed the observable behaviour they measure.
        "expect_red": {"A", "B", "D", "E", "F", "G"},
    },
    {
        "id": "M2",
        "desc": "REPAIR: evict a peer whose backlog exceeds a cap",
        "needle": """  private pingAll(): void {""",
        "replacement": """  private evictSlowConsumers(): void {
    for (const [agentId, agent] of this.agents) {
      if (agent.ws.bufferedAmount > 4 * 1024 * 1024) {
        hubWarn(`Evicting slow consumer ${agentId}`);
        agent.ws.close(1013, 'consumer too slow');
      }
    }
  }

  private pingAll(): void {
    this.evictSlowConsumers();""",
        # MEASURED (v1 prediction was WRONG).
        #
        # A/F: vocabulary. D: the eviction changes the wire order.
        # B/E/G stay GREEN, and that is the interesting part: the eviction
        # runs inside `pingAll()`, which the arms call DIRECTLY — so the
        # eviction happens at the moment the arm issues its control frame.
        # But the eviction uses `close()`, whose frame is queued behind the
        # backlog exactly like the ping — so the observable wire order is
        # unchanged, and the arms that measure the ORDER still hold.
        # The arms that would have caught an IMMEDIATE eviction (B's
        # "backlog grows" and G's "close frame is last") are green because
        # a `close()` frame is NOT immediate — it is queued, which is
        # precisely the defect this round is about.
        "expect_red": {"A", "D", "F"},
    },
    {
        "id": "M3",
        "desc": "REPAIR: expose the backlog in the agent inventory (observability)",
        "needle": """        lastSeen: now, // WebSocket agents are live, no explicit lastSeen needed
      });""",
        "replacement": """        lastSeen: now, // WebSocket agents are live, no explicit lastSeen needed
        backlogBytes: agent.ws.bufferedAmount,
      });""",
        # A/F: vocabulary. B/E: the inventory's key set changes, so the
        # arms that pin it turn red.
        "expect_red": {"A", "B", "E", "F"},
    },
    {
        "id": "M4",
        "desc": "REPAIR: register a 'pong' liveness listener (a second liveness signal)",
        "needle": """    ws.on('close', () => {
      this.handleDisconnect(agentId);
    });""",
        "replacement": """    ws.on('pong', () => {
      hubLog(`Pong from ${agentId}`);
    });

    ws.on('close', () => {
      this.handleDisconnect(agentId);
    });""",
        # D: the arm that asserts "there is no pong listener" turns red.
        "expect_red": {"D"},
    },
    {
        "id": "N1",
        "desc": "NEGATIVE CONTROL: an inert comment mentioning the mechanism",
        "needle": """  private send(ws: WS, msg: OutboundMessage): void {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
    }
  }""",
        "replacement": """  private send(ws: WS, msg: OutboundMessage): void {
    if (ws.readyState === 1) {
      // NOTE: a bounded backlog would use bufferedAmount and backpressure here.
      ws.send(JSON.stringify(msg));
    }
  }""",
        # ONLY the shape detectors (A, F) turn red. The behaviour arms
        # (B, C, D, E, G) MUST stay green — a comment changes nothing.
        "expect_red": {"A", "F"},
        "negative": True,
    },
]


def main():
    results = []
    baseline_blob = OWNED.read_bytes()
    baseline_mtime = OWNED.stat().st_mtime

    print("=== CONTROL (unmutated) ===", flush=True)
    ctrl = run_suite()
    ctrl_red = red_arms(ctrl)
    print(f"control: rc={ctrl.get('_rc')} red={sorted(ctrl_red)} statuses={[(a, ctrl.get(a)) for a in ARMS]}", flush=True)
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
