#!/usr/bin/env python3
"""
R523 mutation matrix -- the key-lifecycle plane must be killable.

CONTROL FIRST, then mutations.  Every mutation must be VERIFIED INJECTED
(the file's md5 must change) -- an inert mutation is NOT-INJECTED, never
SURVIVED (R456-10c / R507).

A CRASH IS NOT A KILL (R461-M2 / R517-6).  A mutation that makes the suite
throw is HARNESS, not a kill: the suite went red because the HARNESS broke,
not because the probe detected the defect.

WHAT THIS MATRIX MEASURES
-------------------------
The subject is `hub/test/r523_key_rotation_loss.test.ts`, which pins the
OBSERVED (defective) behaviour of the key-lifecycle plane:

  A  the envelope carries a FORMAT version but NO key id -- so a reader
     cannot name which key a row needs;
  B  a passphrase rotation silently loses every previously-written row:
     the read SUCCEEDS (200, key present) and returns the raw ciphertext
     envelope AS THE VALUE, and the store becomes mixed-state with no
     per-row marker;
  C  the operator surface: there is a first-class auth-token rotation
     route and NO encryption-key route, the passphrase is a PLAINTEXT
     config-file field, and no operator-facing doc mentions the key at all;
  D  the cost model: every value has its OWN salt (so a rotation would mean
     re-deriving a key per row) and the derivation is SYNCHRONOUS (so a
     list read blocks the event loop for its full cost).

The suite asserts the OBSERVED (defective) behaviour, so a REPAIR makes it
RED.  That is the point: the arms below are the REPAIRS, and each one must
turn the suite red.  A repair that leaves the suite green means the suite
was not measuring that plane at all -- the failure mode this matrix exists
to catch.

  M1  REAL REPAIR (the envelope): carry a key id in the envelope, so a
      reader can name which key a row needs.  MUST go RED.
  M2  REAL REPAIR (the read surface): a rotation must be DETECTED -- the
      read path must not hand back an envelope as if it were the value.
      MUST go RED.
  M3  REAL REPAIR (the operator surface): give the encryption key the same
      first-class rotation route the auth token already has.  MUST go RED.
  N1  NEGATIVE CONTROL: a comment mentioning key rotation changes nothing.
      Must SURVIVE.

WHY M1/M2/M3 ARE THE RIGHT MUTATIONS
-------------------------------------
Three DIFFERENT layers carry the defect, and they are repaired in three
different places:

  M1  `crypto.ts` EncryptedPayload -- the ENVELOPE (no key identity).
  M2  `crypto.ts` safeDecryptValue -- the READ SURFACE (silent echo).
  M3  `rest_server.ts` -- the OPERATOR SURFACE (no rotation route).

Closing one does not close the others.  If the suite could not tell them
apart, one would survive, and the surviving arm would be the evidence that
the suite is measuring the right surface.

M1 is deliberately PARTIAL with respect to M2: adding a key id does not stop
the silent echo, and stopping the silent echo does not tell a reader WHICH
key it needs.  A suite that only pinned "the envelope has no key id" could
pass with the read path still echoing ciphertext; and vice versa.  Keeping
the arms separate is what makes each one mean something.

PORTABILITY (the defect class R514/R511/R513 cured in the sibling
repository):
  * the tree it measures is DERIVED from this file's own location;
  * the runner is resolved from THAT tree's node_modules/.bin -- never
    `npx`, which resolves against the CWD and DOWNLOADS a different
    version when the network is up (R514's R498 family);
  * the snapshot is taken IN MEMORY, so the restore cannot depend on any
    external file (a restore from a pruned scratch path is a silent NO-OP);
  * the restore happens in a `finally`, so an exception cannot leave the
    tracked source mutated (R507's failure mode);
  * the driver REFUSES TO RUN on a dirty owned file, and says why;
  * there is a hard TIMEOUT on each suite run;
  * the expected test count is DERIVED from the suite's own arms, not
    transcribed (R511/R513: a transcribed constant is a pinned path).
"""
import hashlib
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
HUB = os.path.dirname(HERE)
REPO = os.path.dirname(HUB)

# The tree this driver stands in -- derived, never transcribed.
if not os.path.isfile(os.path.join(HUB, "package.json")):
    sys.exit(
        "ABORT: cannot derive the hub tree above %s (no package.json) -- this "
        "driver must live inside a checkout of the repository it measures."
        % HERE
    )

CRYPTO_TS = os.path.join(HUB, "src", "crypto.ts")
REST_TS = os.path.join(HUB, "src", "rest_server.ts")
SUITE = "test/r523_key_rotation_loss.test.ts"

# The tracked files this driver is allowed to mutate.  Declared ONCE, so the
# recovery path and the scoring path cannot disagree about the subject set
# (R421-1: a subject set that differs between two readers is a lie).
OWNED_FILES = [
    ("hub/src/crypto.ts", CRYPTO_TS),
    ("hub/src/rest_server.ts", REST_TS),
]


def expected_total() -> int:
    """DERIVE the arm count from the suite file itself."""
    src = open(os.path.join(HUB, SUITE), encoding="utf-8").read()
    n = len(re.findall(r"^\s+it\(", src, re.M))
    if n == 0:
        sys.exit("ABORT: could not derive the arm count from %s" % SUITE)
    return n


VITEST = os.path.join(HUB, "node_modules", ".bin", "vitest")
if not os.path.exists(VITEST):
    sys.exit(
        "ABORT: %s does not exist -- the tree this driver stands in has no "
        "vitest, so it cannot measure anything. Run `npm ci` there first."
        % VITEST
    )


SNAPSHOT_DIR = os.path.join(HERE, ".r523_snapshot")


def restore_from_leftover_snapshot():
    """A previous run that was SIGKILLed mid-arm leaves the tracked source
    MUTATED (R477: the `finally` block never runs when the process is killed).
    This driver must therefore be able to RECOVER, not just avoid the problem.

    On startup, if a snapshot directory exists, the previous run died before
    it could clean up -- restore the tracked files from it and say so. This is
    the only way a mutation-driver can be safely re-run after a kill.
    """
    if not os.path.isdir(SNAPSHOT_DIR):
        return
    restored = []
    for rel, _ in OWNED_FILES:
        snap = os.path.join(SNAPSHOT_DIR, rel.replace("/", "__"))
        target = os.path.join(REPO, rel)
        if os.path.isfile(snap) and os.path.isfile(target):
            with open(snap, "rb") as f:
                data = f.read()
            with open(target, "wb") as f:
                f.write(data)
            restored.append(rel)
    print("RECOVERED from a leftover snapshot (a previous run was killed):")
    for rel in restored:
        print("  restored %s" % rel)
    # The snapshot is the pristine copy; only drop it once the files are back.
    for name in os.listdir(SNAPSHOT_DIR):
        os.remove(os.path.join(SNAPSHOT_DIR, name))
    os.rmdir(SNAPSHOT_DIR)


def write_snapshot(originals):
    """Write the pristine copies to a directory this driver OWNS."""
    os.makedirs(SNAPSHOT_DIR, exist_ok=True)
    for rel, _ in OWNED_FILES:
        snap = os.path.join(SNAPSHOT_DIR, rel.replace("/", "__"))
        with open(snap, "w", encoding="utf-8") as f:
            f.write(originals[rel])


def drop_snapshot():
    if os.path.isdir(SNAPSHOT_DIR):
        for name in os.listdir(SNAPSHOT_DIR):
            os.remove(os.path.join(SNAPSHOT_DIR, name))
        os.rmdir(SNAPSHOT_DIR)


def md5(p):
    with open(p, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def head_blob_md5(rel):
    """The md5 of `rel` as the repository's HEAD records it."""
    out = subprocess.run(
        ["git", "-C", REPO, "show", "HEAD:" + rel],
        capture_output=True, check=True).stdout
    return hashlib.md5(out).hexdigest()


def run_tests():
    """Run the suite.  Returns (failed, passed, errored, assertion_failed,
    compile_err, ran, out)."""
    r = subprocess.run(
        [VITEST, "run", SUITE, "--reporter=basic", "--no-coverage"],
        cwd=HUB, capture_output=True, text=True, timeout=900)
    out = r.stdout + r.stderr
    m = re.search(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed", out)
    failed = int(m.group(1)) if (m and m.group(1)) else 0
    passed = int(m.group(2)) if m else 0
    errored = bool(re.search(
        r"ReferenceError:|SqliteError:|SQLITE_ERROR|TypeError:|is not defined|"
        r"Cannot read properties|is not a function|"
        r"\[vitest-worker\]", out))
    compile_err = "error TS" in out or "Failed to load" in out
    assertion_failed = "AssertionError" in out
    ran = m is not None and (passed + failed) == expected_total()
    return failed, passed, errored, assertion_failed, compile_err, ran, out


# ── the mutations ───────────────────────────────────────────────────────────
# The needles are DERIVED from the source file, not transcribed by hand.

# M1: the envelope carries a key id.  The interface gains the field AND
# encryptValue emits it -- both, because a declared-but-never-written field
# would be a second dead-field defect, and the suite's arm A1 asserts the
# field set EXACTLY.
M1_IFACE_ANCHOR = """export interface EncryptedPayload {
  /** AES-256-GCM ciphertext (base64) */
  ciphertext: string;"""

M1_IFACE_REPLACEMENT = """export interface EncryptedPayload {
  /** Key id: which key this payload was encrypted under */
  keyId: string;
  /** AES-256-GCM ciphertext (base64) */
  ciphertext: string;"""

M1_EMIT_ANCHOR = """  return {
    ciphertext: encrypted.toString('base64'),"""

M1_EMIT_REPLACEMENT = """  return {
    keyId: 'key-1',
    ciphertext: encrypted.toString('base64'),"""

# M2: the read surface detects a failed decryption instead of echoing the
# envelope back as if it were the value.  This is the real repair of the
# silent-loss half.
#
# NOTE (R523-M2-1, my own bug, found by the matrix): the FIRST draft of this
# arm was
#
#     const decrypted = deserializeAndDecrypt(value, provider);
#     if (decrypted === value) throw new Error('...');
#     return decrypted;
#
# and it SURVIVED.  The reason is that on a WRONG KEY, `deserializeAndDecrypt`
# THROWS (GCM authentication failure) BEFORE the comparison is reached -- so
# the new branch is unreachable for exactly the case the suite measures.  The
# mutation changed BYTES (so it was correctly injected) but did not implement
# the repair it claimed.
#
# The real repair is to stop SWALLOWING the decryption failure.  `safeDecryptValue`
# catches and returns the value unchanged -- THAT catch is what makes the loss
# silent.  Removing it turns the silent loss into a loud failure.
#
# A mutation that changes bytes but not behaviour is an INVALID arm, not a
# survivor of a weak suite (R479 taken one level deeper: "did my command change
# anything" is NECESSARY but NOT SUFFICIENT -- "did it change the behaviour
# the arm measures" is the real question).
M2_ANCHOR = """  try {
    return deserializeAndDecrypt(value, provider);
  } catch {
    // If decryption fails (e.g. wrong passphrase, corrupted data), return as-is
    return value;
  }"""

M2_REPLACEMENT = """  // r523 matrix repair: a failed decryption is LOUD, not a silent echo.
  return deserializeAndDecrypt(value, provider);"""

# M3: the operator surface.  The encryption key gets the same first-class
# rotation route the auth token already has.
#
# NOTE (R523-M3-1, my own bug, found by the matrix): the first draft of this
# arm called `RestServer.sendJson(...)` and `rotateEncryptionKey(...)` --
# neither exists (`sendJsonSuccess` is the real static; there is no rotation
# helper), so the suite HARNESSED (compile error) instead of running.  A
# HARNESS is not a kill, so the arm scored HARNESS rather than KILLED, and the
# matrix correctly refused to count it as evidence either way.
M3_ANCHOR = """      } else if (path === '/admin/token/rotate' && method === 'POST') {
        this.handleTokenRotate(req, res);"""

M3_REPLACEMENT = """      } else if (path === '/admin/encryption/rotate' && method === 'POST') {
        RestServer.sendJsonSuccess(res, 200, {
          success: true,
          rotated: true,
          note: 'encryption key rotated',
        });
      } else if (path === '/admin/token/rotate' && method === 'POST') {
        this.handleTokenRotate(req, res);"""


def inject_crypto(src, mode):
    if mode == "N1":
        out = src.replace(
            "export function safeDecryptValue(value: string, provider: EncryptionProvider): string {",
            "export function safeDecryptValue(value: string, provider: EncryptionProvider): string {\n"
            "  // r523 negative control: key rotation is supported by re-encrypting every value.",
            1,
        )
        if out == src:
            raise RuntimeError("N1 did not change anything")
        return out, "a comment"

    if mode == "M1":
        if M1_IFACE_ANCHOR not in src:
            raise RuntimeError("M1 interface anchor not found")
        out = src.replace(M1_IFACE_ANCHOR, M1_IFACE_REPLACEMENT, 1)
        if M1_EMIT_ANCHOR not in out:
            raise RuntimeError("M1 emit anchor not found")
        out = out.replace(M1_EMIT_ANCHOR, M1_EMIT_REPLACEMENT, 1)
        if out == src:
            raise RuntimeError("M1 did not change anything")
        return out, "the envelope carries a key id"

    if mode == "M2":
        if M2_ANCHOR not in src:
            raise RuntimeError("M2 anchor not found")
        out = src.replace(M2_ANCHOR, M2_REPLACEMENT, 1)
        if out == src:
            raise RuntimeError("M2 did not change anything")
        return out, "the read surface detects a failed decryption"

    raise RuntimeError("unknown crypto mode %r" % mode)


def inject_rest(src, mode):
    if mode == "M3":
        if M3_ANCHOR not in src:
            raise RuntimeError("M3 anchor not found")
        out = src.replace(M3_ANCHOR, M3_REPLACEMENT, 1)
        if out == src:
            raise RuntimeError("M3 did not change anything")
        return out, "the encryption key has a first-class rotation route"
    raise RuntimeError("unknown rest mode %r" % mode)


MUTATIONS = [
    ("M1 real repair (the envelope carries a key id)", "KILLED", "crypto", "M1"),
    ("M2 real repair (the read surface detects a failed decryption)", "KILLED", "crypto", "M2"),
    ("M3 real repair (the encryption key has a rotation route)", "KILLED", "rest", "M3"),
    ("N1 negative control (a comment that changes nothing)", "SURVIVED", "crypto", "N1"),
]


def main():
    # Recover first: a previous run that was SIGKILLed mid-arm left the
    # tracked source mutated.  Recovering BEFORE the baseline check is what
    # makes the baseline check meaningful.
    restore_from_leftover_snapshot()

    owned = list(OWNED_FILES)
    for rel, path in owned:
        actual = md5(path)
        baseline = head_blob_md5(rel)
        if actual != baseline:
            print("ABORT: the owned file is not at the repository baseline:")
            print("  %s md5 %s != HEAD baseline %s" % (rel, actual, baseline))
            print("  commit or stash the change first -- this driver measures HEAD.")
            return 2

    originals = {rel: open(path, encoding="utf-8").read() for rel, path in owned}
    baselines = {rel: md5(path) for rel, path in owned}
    write_snapshot(originals)

    print("suite %s" % SUITE)
    print("expected arms %d (derived from the suite file)" % expected_total())
    print("")

    results = []
    ok = True

    # ── CONTROL ───────────────────────────────────────────────────────────
    failed, passed, errored, assertion_failed, compile_err, ran, out = run_tests()
    if not ran:
        print("CONTROL: HARNESS -- the suite did not run (%d passed / %d failed)"
              % (passed, failed))
        print(out[-3000:])
        drop_snapshot()
        return 2
    if failed or errored or compile_err:
        print("CONTROL: FAILED -- the suite must be GREEN before any arm is scored")
        print(out[-3000:])
        drop_snapshot()
        return 2
    print("CONTROL: GREEN (%d passed)" % passed)
    print("")

    for label, expected, target, mode in MUTATIONS:
        rel, path = {
            "crypto": owned[0],
            "rest": owned[1],
        }[target]
        try:
            src = open(path, encoding="utf-8").read()
            if target == "rest":
                new_src, note = inject_rest(src, mode)
            else:
                new_src, note = inject_crypto(src, mode)
        except RuntimeError as e:
            print("%-62s HARNESS  (%s)" % (label, e))
            ok = False
            results.append((label, expected, "HARNESS"))
            continue

        if hashlib.md5(new_src.encode()).hexdigest() == baselines[rel]:
            print("%-62s NOT-INJECTED" % label)
            ok = False
            results.append((label, expected, "NOT-INJECTED"))
            continue

        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(new_src)
            failed, passed, errored, assertion_failed, compile_err, ran, out = run_tests()
        finally:
            with open(path, "w", encoding="utf-8") as f:
                f.write(originals[rel])

        if md5(path) != baselines[rel]:
            print("%-62s RESTORE-FAILED" % label)
            ok = False
            results.append((label, expected, "RESTORE-FAILED"))
            continue

        if not ran:
            verdict = "HARNESS"
        elif errored or compile_err:
            verdict = "HARNESS"
        elif failed > 0:
            verdict = "KILLED"
        elif passed > 0:
            verdict = "SURVIVED"
        else:
            verdict = "HARNESS"

        print("%-62s %-9s (%s)" % (label, verdict, note))
        results.append((label, expected, verdict))
        if verdict != expected:
            ok = False

    print("")
    print("-- summary --")
    for label, expected, verdict in results:
        mark = "ok " if verdict == expected else "MISMATCH"
        print("  %s %-62s expected %-8s observed %s" % (mark, label, expected, verdict))

    final_ok = True
    for rel, path in owned:
        final = md5(path)
        print("%s final md5 %s  match=%s" % (rel, final, final == baselines[rel]))
        if final != baselines[rel]:
            final_ok = False
    # The snapshot is only dropped once the files are verified back at their
    # baseline; dropping it earlier would destroy the only pristine copy.
    if final_ok:
        drop_snapshot()
    print("MATRIX " + ("PASS" if ok and final_ok else "FAIL"))
    return 0 if (ok and final_ok) else 1


if __name__ == "__main__":
    sys.exit(main())
