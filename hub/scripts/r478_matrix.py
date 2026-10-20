#!/usr/bin/env python3
"""
R478 mutation matrix — the reconnect cursor, reached through the repairs.

Discipline carried from R477 (three restore defects) and R475-2 (byte-level
snapshot restore, scoped to an OWNED list, with a preflight refusal):

  * ONE pristine baseline snapshot per OWNED file, taken BEFORE any mutation,
    stored OUTSIDE the repo (never in hub/src/ — that was R477's D3).
  * restore() is UNCONDITIONAL and uses os.replace() (atomic), never a
    tree-wide `git checkout`, and never open(p,'wb') before a value that can
    raise (that truncation bomb zeroed scheduler.ts once — R477's own fix).
  * preflight() REFUSES to mutate anything when an OWNED file is not at HEAD.
  * apply() enforces count==1 on the needle (R475-3) and asserts new != old
    (R456's third failure mode: a needle that never occurs makes str.replace
    return the string unchanged while a count==1 assertion still passes).
  * The CONTROL arm runs FIRST and must be GREEN. Without it, "all killed"
    and "killed on any write" are indistinguishable (R477's F5).
"""
import hashlib, os, shutil, subprocess, sys, tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # == <root>/hub
# The npm package root IS the directory holding src/ and test/. Paths below are
# relative to it. (Getting this wrong is how the first run tried to exec
# <root>/hub/hub and died with FileNotFoundError before touching anything.)
SUITE = "test/r478_reconnect_cursor_reach.test.ts"
# Files this round OWNS. Never touch anything else — a concurrent agent holds
# the rest of the tree.
OWNED = ["src/db.ts", "src/rest_server.ts"]

BASELINE_DIR = tempfile.mkdtemp(prefix="r478-baseline-")
BASELINE: dict[str, bytes] = {}


def md5(path: str) -> str:
    with open(path, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def preflight() -> None:
    st = subprocess.run(["git", "status", "--short", "--"] + OWNED,
                        cwd=REPO, capture_output=True, text=True)
    if st.stdout.strip():
        sys.exit(f"PREFLIGHT REFUSED: an OWNED file is dirty, refusing to mutate.\n{st.stdout}")
    for rel in OWNED:
        with open(os.path.join(REPO, rel), "rb") as f:
            BASELINE[rel] = f.read()


def restore() -> None:
    for rel in OWNED:
        b = BASELINE.get(rel)
        if b is None:
            continue  # never raise before writing anything
        dst = os.path.join(REPO, rel)
        tmp = dst + ".r478tmp"
        with open(tmp, "wb") as f:
            f.write(b)
        os.replace(tmp, dst)


def run_suite() -> tuple[int, int]:
    p = subprocess.run(["npx", "vitest", "run", SUITE],
                       cwd=REPO, capture_output=True, text=True)
    out = p.stdout + p.stderr
    passed = failed = 0
    for line in out.splitlines():
        s = line.strip()
        if s.startswith("Tests "):
            for tok in s.replace(",", " ").split():
                if tok == "passed" or tok.endswith("passed"):
                    pass
            import re
            m = re.search(r"Tests\s+(?:(\d+) failed \| )?(\d+) passed", out)
            if m:
                failed = int(m.group(1) or 0)
                passed = int(m.group(2))
    return failed, passed


class Mutant:
    # expect_survive=True  -> the arm MUST NOT kill the suite (a half-repair,
    #                          or a prose control that changes no wiring)
    # expect_survive=False -> the arm MUST kill the suite (a full repair)
    def __init__(self, name, rel, needle, replacement, kills, note="", expect_survive=False):
        self.name, self.rel, self.needle, self.replacement = name, rel, needle, replacement
        self.kills, self.note = kills, note
        self.expect_survive = expect_survive

    def apply(self) -> str:
        path = os.path.join(REPO, self.rel)
        with open(path, "r", encoding="utf8") as f:
            src = f.read()
        count = src.count(self.needle)
        if count != 1:
            return f"NOT-INJECTED (needle count={count})"
        new = src.replace(self.needle, self.replacement)
        assert new != src, "needle present but replacement was a no-op"
        tmp = path + ".r478tmp"
        with open(tmp, "w", encoding="utf8") as f:
            f.write(new)
        os.replace(tmp, path)
        return "INJECTED"


class PairMutant(Mutant):
    """
    A repair that needs TWO edits in the SAME file to be a repair at all.

    The unit of mutation is not always the unit of repair. Arm C asks whether
    any cursor-shaped PARAMETER has an effect on the REST messages surface.
    Emitting a `next_cursor` in the response without wiring `?after` through
    to the db layer is not a repair — it is a decorative field, and the
    parameter is still ignored, so the defect is unchanged. Scoring that
    half-repair against the same expectation as the full repair produces a
    FALSE NEGATIVE: the driver reports "SURVIVED" and it reads as a suite
    weakness when the suite is right and the mutation is partial.

    So the pair is the unit, and the pair is scored as one arm. This is the
    R488 shape (a fix-shaped mutant survives a suite) applied to the
    DRIVER rather than to the suite.
    """

    def __init__(self, name, rel, edits, kills, note=""):
        super().__init__(name, rel, "", "", kills, note)
        self.edits = edits  # list of (needle, replacement)

    def apply(self) -> str:
        path = os.path.join(REPO, self.rel)
        with open(path, "r", encoding="utf8") as f:
            src = f.read()
        new = src
        for needle, repl in self.edits:
            count = new.count(needle)
            if count != 1:
                return f"NOT-INJECTED (needle count={count} for {needle[:48]!r})"
            candidate = new.replace(needle, repl)
            if candidate == new:
                return f"NO-OP (needle present but replacement was a no-op: {needle[:48]!r})"
            new = candidate
        if new == src:
            return "NO-OP (pair changed nothing)"
        tmp = path + ".r478tmp"
        with open(tmp, "w", encoding="utf8") as f:
            f.write(new)
        os.replace(tmp, path)
        return "INJECTED"


MUTANTS = [
    # ── repairs: each turns a GREEN characterisation arm RED ──
    #
    # NEEDLE CURRENCY (this tick, 2026-10-20). Three of the four needles were
    # STALE — the source had moved underneath them and the driver silently
    # reported "NOT-INJECTED (needle count=2)" / "count=0". A driver that
    # cannot inject a mutation is not a negative result; it is a measurement
    # that never happened, and it looked like a passing arm. The needles are
    # now anchored to text that is UNIQUELY identifying in the current tree.
    #
    # `src/db.ts` carries the SQL twice — once in the SQLite backend and once
    # in the MySQL backend — so a bare `WHERE topic = ? AND timestamp < ?`
    # matches twice. The SQLite branch is the one the suite exercises (the
    # test opens a file-backed ClawDB), so the needle is anchored to the
    # SQLite-only `rows = this.db.prepare(` line that precedes it.
    Mutant("M1", "src/db.ts",
           "      rows = this.db.prepare(`\n"
           "        SELECT id, topic, from_agent, content, timestamp\n"
           "        FROM messages\n"
           "        WHERE topic = ? AND timestamp < ?",
           "      rows = this.db.prepare(`\n"
           "        SELECT id, topic, from_agent, content, timestamp\n"
           "        FROM messages\n"
           "        WHERE topic = ? AND timestamp != ?",
           "B", "add a forward-ish branch: != is neither '<' nor '>'"),
    Mutant("M2", "src/db.ts",
           "      rows = this.db.prepare(`\n"
           "        SELECT id, topic, from_agent, content, timestamp\n"
           "        FROM messages\n"
           "        WHERE topic = ? AND timestamp < ?",
           "      rows = this.db.prepare(`\n"
           "        SELECT id, topic, from_agent, content, timestamp\n"
           "        FROM messages\n"
           "        WHERE topic = ? AND timestamp > ?",
           "B,C", "the real forward repair — exclusive >"),
    Mutant("M3", "src/rest_server.ts",
           "    const messages = await this.db.getMessages(topic, limitNum);",
           "    const messages = await this.db.getMessages(topic, limitNum, url.searchParams.get('after') as any);",
           "C",
           "wire the forward parameter through REST. MEASURED (this tick): M3 "
           "ALONE kills C. Arm C asks whether any cursor-shaped PARAMETER has "
           "an effect, and once ?after is wired the parameter has one. So M3 "
           "is the load-bearing half of the repair and M34 (both halves) is "
           "the whole repair. The pair arm is kept because M3+M4 is what a "
           "real fix looks like, and because it shows the suite does not "
           "depend on the cosmetic half at all.", expect_survive=False),
    Mutant("M4", "src/rest_server.ts",
           "      topic,\n      messages: messages.reverse(),",
           "      topic,\n      next_cursor: messages[0]?.timestamp ?? 0,\n      messages: messages.reverse(),",
           "none alone — needs M3 (see M34)",
           "the repair's other half: emit a cursor in the response. "
           "MEASURED (this tick): M4 ALONE SURVIVES, and that is the correct "
           "outcome, not a suite weakness. Arm C asks whether any "
           "cursor-shaped PARAMETER has an effect; emitting a cursor while the "
           "parameter is still ignored leaves the defect exactly where it "
           "was. The suite therefore does NOT detect the cosmetic half of "
           "this repair — a real limitation, recorded rather than hidden. "
           "M34 (both halves) is the arm that must kill C.",
           expect_survive=True),
    # ── the repair as a PAIR: M3 wires the parameter, M4 emits the cursor ──
    # Neither half closes the defect, so neither half may be expected to kill
    # arm C. A driver that lists the two halves separately and scores each
    # against the same expectation manufactures a false negative: it reports
    # "M4 SURVIVED" as a suite weakness when the suite is right and the
    # MUTATION is partial. The pair is the unit of repair.
    PairMutant("M34", "src/rest_server.ts",
               [("    const messages = await this.db.getMessages(topic, limitNum);",
                 "    const messages = await this.db.getMessages(topic, limitNum, url.searchParams.get('after') as any);"),
                ("      topic,\n      messages: messages.reverse(),",
                 "      topic,\n      next_cursor: messages[0]?.timestamp ?? 0,\n      messages: messages.reverse(),")],
               "C",
               "the FULL repair as one arm: wire ?after through AND emit the "
               "cursor. This is the arm that must kill C; M3 and M4 are its "
               "halves and are scored as such."),
    # ── negative controls: must SURVIVE ──
    Mutant("C1", "src/db.ts",
           "  async getMessages(topic: string, limit: number = 100, before?: number): Promise<DBMessage[]> {\n"
           "    const safeLimit = Math.max(0, limit);\n"
           "    let rows: MessageRowSqlite[];",
           "  async getMessages(topic: string, limit: number = 100, before?: number): Promise<DBMessage[]> {\n"
           "    // NOTE: cursor / resume / since — a client reconnects and resumes here\n"
           "    const safeLimit = Math.max(0, limit);\n"
           "    let rows: MessageRowSqlite[];",
           "C1 (prose control, must SURVIVE)",
           "vocabulary in a comment: the suite measures wiring, not words",
           expect_survive=True),
]


def main() -> int:
    preflight()
    base_md5 = {rel: md5(os.path.join(REPO, rel)) for rel in OWNED}
    try:
        fc, fp = run_suite()
        print(f"control           {'GREEN' if fc == 0 else 'RED  '} {fp} passed / {fc} failed")
        if fc != 0:
            print("CONTROL NOT GREEN — every verdict below would be meaningless")
            return 2

        for m in MUTANTS:
            status = m.apply()
            if status != "INJECTED":
                print(f"{m.name:<17} {status:<28} kills {m.kills}")
                restore()
                continue
            fc, fp = run_suite()
            restore()
            verdict = "SURVIVED" if fc == 0 else "KILLED"
            # A half-repair SURVIVING is the CORRECT outcome, and printing it
            # next to the same label as a real suite weakness is the lie. The
            # expectation is part of the arm, so the verdict is scored
            # AGAINST IT: a half-arm must survive, the full arm must kill.
            if m.expect_survive:
                ok = (fc == 0)
                scored = "AS EXPECTED" if ok else "UNEXPECTEDLY KILLED"
            else:
                ok = (fc > 0)
                scored = "AS EXPECTED" if ok else "SURVIVED (suite weak?)"
            print(f"{m.name:<17} {verdict:<28} {scored:<22} kills {m.kills}   ({fp} passed / {fc} failed)")
    finally:
        restore()
        ok = all(md5(os.path.join(REPO, rel)) == base_md5[rel] for rel in OWNED)
        print(f"restore verified by md5: {ok}")
        shutil.rmtree(BASELINE_DIR, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
