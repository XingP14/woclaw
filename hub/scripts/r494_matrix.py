#!/usr/bin/env python3
"""
R494 mutation matrix — subject binding.

DISCIPLINE (carried from R475-2 / R477 / R482 / R491):
  * CONTROL FIRST (R404-M1): the suite must be GREEN before any mutation.
  * OWNED FILES only: this round owns exactly one file, hub/src/ws_server.ts.
    It is snapshotted BYTE-WISE before mutation and restored byte-wise after
    each arm. `git checkout` is NOT used (R469-8b: it destroys other agents'
    in-flight work when the tree is dirty).
  * PRE-INJECTION ASSERTION (R475-2): the owned file must be byte-identical to
    the snapshot before each injection, otherwise ABORT.
  * DOUBLE GUARD (R456-3c / R458-5): the needle must occur EXACTLY ONCE and
    the content must CHANGE. `assert needle in before` alone is not enough —
    `str.replace` returns the string unchanged when the needle is absent.
  * SCORING (R491-M3): the report goes to the LOG; ONLY the failure count is
    read as the return value. A scoring function that mixes report and
    return value on one stream INVERTS every verdict.
  * Every arm's mutations must COMPILE (tsc) and every arm's RESTORE is
    verified by md5.

Arms:
  M1  REPAIR - do not evict an incumbent on an unverified claim: reject the
      takeover instead.
      EXPECTED: KILLED.
  M2  REPAIR - the inverse of M1: keep the incumbent and close the NEW
      socket. Same protection, different implementation.
      EXPECTED: KILLED.
  M3  PARTIAL REPAIR - handleDisconnect tears down only the socket that is
      actually closing, so a takeover does not delete its own registration.
      This does NOT bind the subject; it repairs the self-deletion only.
      EXPECTED: KILLED (P3 goes red: the takeover stays registered).
  M4  REPAIR (shape) - bind the subject by requiring the credential to be
      scoped to the claimed identity (token must end with the agentId).
      EXPECTED: KILLED.
  M5  NEGATIVE CONTROL - change only a log message's wording.
      EXPECTED: SURVIVED (the defect is untouched).
  M6  NEGATIVE CONTROL - add prose about subject binding, change no behaviour.
      EXPECTED: SURVIVED.
"""
import hashlib
import json
import os
import re
import subprocess
import sys

REPO = "/root/.hermes/workspace/woclaw"
HUB = os.path.join(REPO, "hub")
TEST = "test/r494_subject_binding.test.ts"
OWNED = ["src/ws_server.ts"]
LOG = "/tmp/r494_matrix.log"

ARMS = [
    {
        "id": "M1",
        "expect": "KILLED",
        "desc": "reject a takeover of a connected identity instead of evicting the incumbent",
        "edits": [(
            """    if (this.agents.has(agentId)) {
      const oldAgent = this.agents.get(agentId);
      if (oldAgent?.ws.readyState === 1) { // OPEN = 1
        oldAgent.ws.close(4002, 'Replaced by new connection');
      }
    }""",
            """    if (this.agents.has(agentId)) {
      const oldAgent = this.agents.get(agentId);
      if (oldAgent?.ws.readyState === 1) { // OPEN = 1
        // R494 M1: the claimed subject is not bound to the credential, so
        // evicting here would disconnect an agent the caller never proved
        // it is. Refuse the takeover instead.
        ws.close(4003, 'Subject already bound');
        return;
      }
    }""",
        )],
    },
    {
        "id": "M2",
        "expect": "KILLED",
        "desc": "keep the incumbent and close the NEW socket (the inverse repair)",
        "edits": [(
            """    if (this.agents.has(agentId)) {
      const oldAgent = this.agents.get(agentId);
      if (oldAgent?.ws.readyState === 1) { // OPEN = 1
        oldAgent.ws.close(4002, 'Replaced by new connection');
      }
    }""",
            """    if (this.agents.has(agentId)) {
      const oldAgent = this.agents.get(agentId);
      if (oldAgent?.ws.readyState === 1) { // OPEN = 1
        // R494 M2: the incumbent keeps the identity; the newcomer is closed.
        ws.close(4003, 'Subject already bound');
        return;
      }
    }""",
        )],
    },
    {
        "id": "M3",
        "expect": "KILLED",
        "desc": "PARTIAL repair: tear down only the socket that is closing (no self-deletion)",
        "edits": [
            (
                """    ws.on('close', () => {
      this.handleDisconnect(agentId);
    });""",
                """    ws.on('close', () => {
      this.handleDisconnect(agentId, ws);
    });""",
            ),
            (
                """  private handleDisconnect(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;""",
                """  private handleDisconnect(agentId: string, closingWs?: WS): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    // R494 M3: only the socket that is actually closing may tear the
    // identity down. Otherwise a takeover's predecessor deletes the
    // takeover's own registration.
    if (closingWs && agent.ws !== closingWs) {
      this.agentByWs.delete(closingWs);
      return;
    }""",
            ),
        ],
    },
    {
        "id": "M4",
        "expect": "KILLED",
        "desc": "bind the subject to the credential (the token must be scoped to the claimed id)",
        "edits": [(
            """    if (!agentId || !this.isTokenAuthorized(token ?? undefined)) {
      ws.close(4001, 'Unauthorized');
      return;
    }""",
            """    if (!agentId || !this.isTokenAuthorized(token ?? undefined)) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    // R494 M4: the credential must be scoped to the claimed subject.
    if (!token || !token.endsWith(agentId)) {
      ws.close(4003, 'Subject not bound to credential');
      return;
    }""",
        )],
    },
    {
        "id": "M5",
        "expect": "SURVIVED",
        "desc": "NEGATIVE CONTROL - change only a log message's wording",
        "edits": [(
            "hubLog(`Agent connected: ${agentId} (total: ${this.agents.size})`);",
            "hubLog(`Agent connected: ${agentId} (total: ${this.agents.size}) [r494-neg-control]`);",
        )],
    },
    {
        "id": "M6",
        "expect": "SURVIVED",
        "desc": "NEGATIVE CONTROL - add prose about subject binding, change no behaviour",
        "edits": [(
            """    const agent: Agent<WS> = {
      agentId,
      ws,""",
            """    // R494 M6: the claimed agentId is bound to the shared credential and
    // therefore identifies the caller.
    const agent: Agent<WS> = {
      agentId,
      ws,""",
        )],
    },
]


def md5(path):
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def snapshot():
    snap = {}
    for rel in OWNED:
        with open(os.path.join(HUB, rel), "rb") as f:
            snap[rel] = f.read()
    return snap


def restore(snap):
    for rel, data in snap.items():
        with open(os.path.join(HUB, rel), "wb") as f:
            f.write(data)


def parse_failures(out):
    """Only the FAILURE COUNT is the return value (R491-M3)."""
    for line in out.splitlines():
        if re.search(r"^\s*Tests\s", line):
            m = re.search(r"(\d+)\s+failed", line)
            if m:
                return int(m.group(1))
            m = re.search(r"(\d+)\s+passed", line)
            if m:
                return 0
    return out.count("✗") + out.count("×")


def run_suite():
    with open(LOG, "w") as logf:
        p = subprocess.run(
            ["npx", "vitest", "run", TEST],
            cwd=HUB, stdout=logf, stderr=subprocess.STDOUT, timeout=900,
        )
    with open(LOG) as f:
        out = f.read()
    return parse_failures(out), out, p.returncode


def run_tsc():
    p = subprocess.run(["npx", "tsc", "--noEmit"], cwd=HUB,
                       capture_output=True, text=True, timeout=600)
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def main():
    baseline = snapshot()
    base_md5 = {rel: hashlib.md5(d).hexdigest() for rel, d in baseline.items()}
    print("BASELINE MD5:", json.dumps(base_md5))

    fails, out, rc = run_suite()
    print("CONTROL: failures=%d rc=%d" % (fails, rc))
    if fails != 0:
        print("CONTROL FAILED — aborting.")
        print(out[-5000:])
        sys.exit(2)

    results = []
    for arm in ARMS:
        # PRE-INJECTION ASSERTION (R475-2)
        for rel in OWNED:
            pth = os.path.join(HUB, rel)
            with open(pth, "rb") as f:
                if hashlib.md5(f.read()).hexdigest() != base_md5[rel]:
                    print("ABORT: %s not clean before %s" % (rel, arm["id"]))
                    restore(baseline)
                    sys.exit(3)

        src_path = os.path.join(HUB, OWNED[0])
        with open(src_path, encoding="utf-8") as f:
            before = f.read()

        ok = True
        after = before
        for old, new in arm["edits"]:
            n = after.count(old)
            if n != 1:
                print("%s NOT-INJECTED: needle occurs %d times (must be 1)" % (arm["id"], n))
                ok = False
                break
            after = after.replace(old, new)
        if ok and after == before:
            print("%s NOT-INJECTED: no change produced" % arm["id"])
            ok = False
        if not ok:
            restore(baseline)
            results.append((arm["id"], arm["expect"], "NOT-INJECTED", arm["desc"]))
            continue

        with open(src_path, "w", encoding="utf-8") as f:
            f.write(after)

        # The mutation must COMPILE, or the arm is a harness failure.
        trc, tout = run_tsc()
        if trc != 0:
            print("%s HARNESS: tsc failed after injection (rc=%d)" % (arm["id"], trc))
            print(tout[-1500:])
            restore(baseline)
            results.append((arm["id"], arm["expect"], "HARNESS", arm["desc"]))
            continue

        try:
            fails, out, rc = run_suite()
        except subprocess.TimeoutExpired:
            fails, out, rc = -1, "TIMEOUT", -1

        restore(baseline)
        with open(src_path, "rb") as f:
            if hashlib.md5(f.read()).hexdigest() != base_md5[OWNED[0]]:
                print("%s RESTORE-FAILED" % arm["id"])
                sys.exit(4)

        verdict = "KILLED" if fails != 0 else "SURVIVED"
        mark = "OK " if verdict == arm["expect"] else "!! "
        print("%s%s expected=%s got=%s failures=%d | %s" %
              (mark, arm["id"], arm["expect"], verdict, fails, arm["desc"]))
        results.append((arm["id"], arm["expect"], verdict, arm["desc"]))

    print("\n=== SUMMARY ===")
    for k in ("KILLED", "SURVIVED", "NOT-INJECTED", "HARNESS"):
        print("%s=%d" % (k, sum(1 for r in results if r[2] == k)))
    for r in results:
        print("  %-4s expect=%-9s got=%-12s %s" % (r[0], r[1], r[2], r[3]))

    for rel in OWNED:
        pth = os.path.join(HUB, rel)
        print("FINAL %s md5=%s baseline=%s %s" %
              (rel, md5(pth), base_md5[rel], "OK" if md5(pth) == base_md5[rel] else "MISMATCH"))
    d = subprocess.run(["git", "diff", "--stat", "--", "hub/src"], cwd=REPO,
                       capture_output=True, text=True)
    print("git diff --stat -- hub/src:", repr(d.stdout.strip()))


if __name__ == "__main__":
    main()
