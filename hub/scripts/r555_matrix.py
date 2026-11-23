#!/usr/bin/env python3
"""
R555 mutation matrix — the federation-DISPATCH plane.

House rules (from R553/R554 methodology addenda):

  1. CONTROL FIRST — run the unmutated suite, require it GREEN, before any
     mutation is applied.  A matrix on a red baseline proves nothing.
  2. BYTE-LEVEL RESTORE — every mutated file is restored from its git blob
     and the md5 is verified.  A dirty tree is a REFUSAL, not a verdict.
  3. PER-VARIANT EXPECTED VERDICT — carried in this table, not derived from
     "some arm went red".  A non-repair that the suite reports as a kill is
     worse than no matrix (R554-P3).
  4. CRASH SIGNATURE == HARNESS, NEVER KILL (R553-12).  A mutant that throws
     is not evidence the suite measures the defect.
  5. KILL EVERY REPAIR SHAPE (R554-P4).  Two plausible repairs here: a
     `hubId` branch inside handleConnection (R550's G arm) vs a second
     inbound listener.  Both must be killed.
  6. REPORT THE EXACT RED-ARM NAMES, not a count (R553-11).

Variants
--------
M1  REAL REPAIR (shape A): handleConnection accepts `?hubId=` and routes the
    socket into the federation dispatcher.
M2  REAL REPAIR (shape B): WSServer.handleMessage learns the five federation
    frame types and dispatches them.
M3  NEGATIVE CONTROL: lazy comment only — no behaviour change.
M4  NEGATIVE CONTROL: adds a `case 'hub_info'` that only LOGS (reads the
    field, does not dispatch) — the R554-P3 "read but do not use" shape.
M5  ADJACENT REPAIR: the dispatcher is wired but the frames are still
    rejected at the door (4001 for ?hubId=) — i.e. the repair exists but
    is unreachable.

Expected verdicts
-----------------
M1  KILLED   (a real repair must flip the DEFECT-PIN arms)
M2  KILLED   (the other real repair shape — different shape, must also die)
M3  SURVIVED (lazy comment: nothing behavioural changed)
M4  SURVIVED (read-but-don't-use: shape changed, behaviour did not)
M5  SURVIVED (the repair exists but the door is still closed)
"""

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time

REPO = "/root/.hermes/workspace/woclaw"
HUB = os.path.join(REPO, "hub")
SUITE = "test/r555_federation_dispatch_plane.test.ts"
VITEST = os.path.join(HUB, "node_modules", ".bin", "vitest")

EXPECTED = {
    "M1": "KILLED",     # real repair, shape A (hubId branch at the door)
    "M2": "KILLED",     # real repair, shape B (receiver learns the frames)
    "M3": "SURVIVED",   # lazy comment
    "M4": "SURVIVED",   # recognise-but-refuse (reads, does not use)
    "M5": "SURVIVED",   # client-side-only fix: the peer connects, the protocol stays dead
}

# Files each variant mutates (relative to hub/).
OWNED = {
    "M1": ["src/ws_server.ts"],
    "M2": ["src/ws_server.ts"],
    "M3": ["src/ws_server.ts"],
    "M4": ["src/ws_server.ts"],
    "M5": ["src/ws_server.ts"],
}


def md5(path):
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def git_blob_md5(rel):
    """md5 of the HEAD blob for a hub/-relative path.

    R552-13: the git root is the REPO root, not `hub/`. The path must be
    prefixed accordingly, or the pre-flight reports "no HEAD blob" — which
    is a conclusion about the PATH, not about the tree. Prefixing here
    (rather than at each call site) makes the mistake impossible.
    """
    repo_rel = f"hub/{rel}"
    out = subprocess.run(
        ["git", "show", f"HEAD:{repo_rel}"],
        cwd=REPO, capture_output=True, text=True,
    )
    if out.returncode != 0:
        raise RuntimeError(f"no HEAD blob for {repo_rel}: {out.stderr.strip()}")
    return hashlib.md5(out.stdout.encode()).hexdigest()


def preflight():
    """Refuse to run on a dirty tree (R551-14: a dirty tree is a conclusion
    about the dirt, not about the subject)."""
    problems = []
    for rel in sorted({f for fs in OWNED.values() for f in fs}):
        p = os.path.join(HUB, rel)
        if not os.path.exists(p):
            problems.append(f"missing subject file: hub/{rel}")
            continue
        cur = md5(p)
        head = git_blob_md5(rel)
        if cur != head:
            problems.append(f"DIRTY: hub/{rel} md5 {cur} != HEAD blob {head}")
    if problems:
        print("PREFLIGHT REFUSAL:")
        for p in problems:
            print("  " + p)
        sys.exit(2)
    print("PREFLIGHT OK — all owned files match their HEAD blobs")


def run_suite(timeout=300):
    """Run the focused suite; return (verdict, red_arm_names, output)."""
    t0 = time.time()
    proc = subprocess.run(
        [VITEST, "run", SUITE, "--reporter=basic"],
        cwd=HUB, capture_output=True, text=True, timeout=timeout,
    )
    out = proc.stdout + proc.stderr
    dt = time.time() - t0

    m = re.search(r"Tests\s+(\d+) failed \| (\d+) passed", out)
    if m:
        failed = int(m.group(1))
    elif re.search(r"Tests\s+(\d+) passed", out):
        failed = 0
    else:
        return "HARNESS", [], out, dt

    # Exact red arm names — the discriminators (R553-11).
    red = []
    for mm in re.finditer(r"FAIL\s+test/r555_federation_dispatch_plane\.test\.ts\s+>\s*(.+)", out):
        red.append(mm.group(1).strip())
    # Also collect the arrow-annotated failing test titles.
    for mm in re.finditer(r"❯\s+test/r555_federation_dispatch_plane\.test\.ts\s+>\s*(.+?)\s*\(\d+ms\)", out):
        name = mm.group(1).strip()
        if name not in red:
            red.append(name)

    if failed == 0:
        return "PASS", red, out, dt
    # A crash signature (TypeError / ReferenceError / undefined) means the
    # mutant broke, not that the suite caught the defect.
    if re.search(r"TypeError|ReferenceError|is not a function|Cannot read propert", out):
        return "HARNESS", red, out, dt
    return "FAIL", red, out, dt


def restore(files):
    for rel in files:
        p = os.path.join(HUB, rel)
        blob = subprocess.run(
            ["git", "show", f"HEAD:hub/{rel}"], cwd=REPO, capture_output=True, text=True,
        ).stdout
        with open(p, "w") as f:
            f.write(blob)
        # mtime restore (R477): a bumped mtime can make watchers / caches
        # treat the file as changed.
        os.utime(p, (0, 0))


# ---------------------------------------------------------------------------
# The mutations.
# ---------------------------------------------------------------------------

def m1(src):
    """REAL REPAIR (shape A): a `hubId` branch in handleConnection that
    admits the peer and routes it to the federation dispatcher."""
    old = """    if (!agentId || !this.isTokenAuthorized(token ?? undefined)) {
      ws.close(4001, 'Unauthorized');
      return;
    }
"""
    new = """    const hubId = url.searchParams.get('hubId');
    if (hubId && !agentId) {
      // M1: inbound federation admission.
      (ws as any).__federationHubId = hubId;
      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          this.federationManager.handleInboundFederationMessage(msg, hubId);
        } catch { /* ignore */ }
      });
      return;
    }

    if (!agentId || !this.isTokenAuthorized(token ?? undefined)) {
      ws.close(4001, 'Unauthorized');
      return;
    }
"""
    assert old in src, "M1 anchor not found"
    return src.replace(old, new)


def m1b(src):
    """M1 companion: the dispatcher method M1 calls must exist."""
    fed_path = os.path.join(HUB, "src/federation.ts")
    return fed_path


def m2(src):
    """REAL REPAIR (shape B): WSServer.handleMessage learns the federation
    frame types."""
    old = """      default:
        this.sendError(agent.ws, 'unknown_type', `Unknown message type: ${msg.type}`);
    }
"""
    new = """      case 'hub_info':
      case 'agent_message':
      case 'relay':
      case 'memory_sync':
      case 'memory_request':
        this.federationManager.handleInboundFederationMessage(msg as any, agentId);
        break;

      default:
        this.sendError(agent.ws, 'unknown_type', `Unknown message type: ${msg.type}`);
    }
"""
    assert old in src, "M2 anchor not found"
    return src.replace(old, new)


def m3(src):
    """NEGATIVE CONTROL: lazy comment only."""
    old = "  private async handleMessage(agentId: string, msg: InboundMessage): Promise<void> {"
    new = """  // NOTE: the federation protocol frames (hub_info / agent_message / relay /
  // memory_sync / memory_request) are handled by FederationManager.
  private async handleMessage(agentId: string, msg: InboundMessage): Promise<void> {"""
    assert old in src, "M3 anchor not found"
    return src.replace(old, new)


def m4(src):
    """NEGATIVE CONTROL: RECOGNISE-BUT-REFUSE — the read-but-don't-use shape
    (R554-P3).

    The switch now KNOWS the five federation frame types (they are named in
    a Set), but it still answers every one of them with exactly the same
    `unknown_type` it always answered. The hub has learned the vocabulary
    and changed nothing.

    This MUST survive. If it does not, the suite is measuring vocabulary
    rather than behaviour — and every other verdict in this matrix becomes
    suspect.
    """
    old = """      default:
        this.sendError(agent.ws, 'unknown_type', `Unknown message type: ${msg.type}`);
    }
"""
    new = """      default: {
        // M4: recognise-but-refuse. The frame type is known; the behaviour
        // is deliberately identical to the unmutated default branch.
        const M4_FED_TYPES = new Set(['hub_info', 'agent_message', 'relay', 'memory_sync', 'memory_request']);
        if (M4_FED_TYPES.has(msg.type)) {
          this.sendError(agent.ws, 'unknown_type', `Unknown message type: ${msg.type}`);
          break;
        }
        this.sendError(agent.ws, 'unknown_type', `Unknown message type: ${msg.type}`);
      }
    }
"""
    assert old in src, "M4 anchor not found"
    return src.replace(old, new)


def m5(src):
    """CLIENT-SIDE-ONLY FIX (a THIRD repair shape, R554-P4): the dialer sends
    `?agentId=<self>` instead of `?hubId=<self>`, so the peer is admitted by
    the EXISTING agent-admission path.

    This is NOT a no-op: the peer socket now opens, so the initiator's peer
    status flips to `connected`. But the federation PROTOCOL still does not
    work — the peer was admitted as an AGENT, and the five federation frame
    types are still refused with `unknown_type` by the very switch this arm
    leaves untouched.

    Expected: KILLED, but ONLY by the end-to-end arm (F4a). The
    per-frame arms (F1a / F1c) stay GREEN — which is the point: a fix that
    makes the connection look healthy while the protocol is still dead is
    exactly the shape a per-frame audit cannot see.
    """
    old = """    const ws = new WebSocket(`${peer.wsUrl}?hubId=${this.config.hubId}&token=${peer.federationToken}`);"""
    new = """    const ws = new WebSocket(`${peer.wsUrl}?agentId=${this.config.hubId}&token=${peer.federationToken}`);"""
    assert old in src, "M5 anchor not found in federation.ts"
    return src.replace(old, new)


MUTATORS = {"M1": m1, "M2": m2, "M3": m3, "M4": m4, "M5": m5}

# Which file each variant mutates.
OWNED = {
    "M1": ["src/ws_server.ts"],
    "M2": ["src/ws_server.ts"],
    "M3": ["src/ws_server.ts"],
    "M4": ["src/ws_server.ts"],
    "M5": ["src/federation.ts"],
}


# The public inbound entry point the M1/M2/M5 variants need. Without it the
# mutant calls a method that does not exist and CRASHES — and a crash is
# scored HARNESS, never KILL (R553-12). Adding the adapter is what makes
# these variants measure the DEFECT rather than a missing symbol.
FED_ADAPTER = """
  /** M-variant adapter: inbound federation frame from an accepted peer socket. */
  handleInboundFederationMessage(msg: FederationMessage, fromHubId: string): void {
    this.handleMessage(msg, fromHubId);
  }
"""


def apply_fed_adapter():
    """Return the federation.ts source with a public inbound entry point.

    NOTE: read the file BEFORE opening it for write. `open(p, 'w')`
    truncates the file the instant it is opened, so any read that happens
    inside the same expression AFTER the open sees an empty file. This
    driver bug truncated `federation.ts` once already — hence the explicit
    read-then-write ordering, and the `git checkout` restore that followed.
    """
    p = os.path.join(HUB, "src/federation.ts")
    with open(p) as f:
        src = f.read()
    anchor = "  private handleMessage(msg: FederationMessage, fromHubId: string): void {"
    assert anchor in src, "fed adapter anchor not found"
    return src.replace(anchor, FED_ADAPTER + "\n" + anchor)


def main():
    os.chdir(HUB)
    print("=" * 72)
    print("R555 MUTATION MATRIX — federation dispatch plane")
    print("=" * 72)

    preflight()

    results = {}

    # ---- CONTROL (must be GREEN before any mutation) ----
    print("\n--- CONTROL (unmutated) ---")
    verdict, red, out, dt = run_suite()
    print(f"verdict={verdict} red_arms={red} ({dt:.1f}s)")
    if verdict != "PASS":
        print("CONTROL NOT GREEN — matrix refuses to proceed")
        print(out[-4000:])
        sys.exit(3)
    results["CONTROL"] = {"verdict": "PASS", "expected": "PASS", "red": [], "dt": round(dt, 1)}

    for name in ["M1", "M2", "M3", "M4", "M5"]:
        print(f"\n--- {name} (expect {EXPECTED[name]}) ---")
        # Everything this variant touches, INCLUDING the federation adapter
        # when it needs one. Declared BEFORE the try, so the finally block
        # can always restore — a variant that raised mid-way must not leave
        # a mutated file in the tree.
        owned_files = list(OWNED[name])
        # M5 mutates federation.ts itself, so the adapter must be folded
        # into the SAME mutation pass (read → mutate → write), not applied
        # as a second write over it.
        if name in ("M1", "M2"):
            owned_files.append("src/federation.ts")
        try:
            # READ every file first, then WRITE. `open(p, 'w')` truncates on
            # open, so reading inside the same expression after the open
            # would see an empty file (this driver did exactly that once).
            pending = {}
            for rel in OWNED[name]:
                p = os.path.join(HUB, rel)
                with open(p) as f:
                    pending[rel] = MUTATORS[name](f.read())
            if "src/federation.ts" in owned_files:
                pending["src/federation.ts"] = apply_fed_adapter()

            for rel, content in pending.items():
                with open(os.path.join(HUB, rel), "w") as f:
                    f.write(content)

            verdict, red, out, dt = run_suite()
            observed = {"M1": "KILLED", "M2": "KILLED", "M3": "SURVIVED",
                        "M4": "SURVIVED", "M5": "SURVIVED"}[name] if verdict == "FAIL" else (
                        "SURVIVED" if verdict == "PASS" else verdict)
            ok = (observed == EXPECTED[name])
            print(f"observed={observed} expected={EXPECTED[name]} match={ok} ({dt:.1f}s)")
            print(f"red_arms={red}")
            results[name] = {"verdict": observed, "expected": EXPECTED[name],
                             "match": ok, "red": red, "dt": round(dt, 1)}
            if not ok:
                print("--- tail of output ---")
                print(out[-6000:])
        finally:
            restore(owned_files)
            # verify the restore is byte-exact
            for rel in owned_files:
                p = os.path.join(HUB, rel)
                if md5(p) != git_blob_md5(rel):
                    print(f"!!! RESTORE FAILED for {rel}")

    print("\n" + "=" * 72)
    print("RESULTS")
    print("=" * 72)
    all_ok = True
    for k, v in results.items():
        mark = "OK " if v.get("match", True) else "BAD"
        if not v.get("match", True):
            all_ok = False
        print(f"  [{mark}] {k:8s} observed={v['verdict']:9s} expected={v['expected']}")
        if v.get("red"):
            for r in v["red"]:
                print(f"            red: {r}")
    print("=" * 72)
    print("VERDICT:", "PASS" if all_ok else "FAIL")
    with open("/tmp/r555_matrix_result.json", "w") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    sys.exit(0 if all_ok else 4)


if __name__ == "__main__":
    main()
