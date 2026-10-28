#!/usr/bin/env python3
"""R516 — schema-drift gate for hub/src/db.ts.

WHAT THIS GATES
    Every column declared in a CREATE TABLE must be able to REACH a database
    that was created by an EARLIER version of the product.  A column that was
    added to a CREATE TABLE *after* the table already existed is invisible to
    `CREATE TABLE IF NOT EXISTS` on a legacy database -- it only exists there
    if a paired `ALTER TABLE ... ADD COLUMN` exists.

WHY A BASELINE FILE IS REQUIRED
    "Which columns need an ALTER" is NOT answerable from the current source
    tree: it depends on WHEN each column arrived relative to its table.  That
    fact lives only in git history, and CI checks out shallow => no history in
    CI.  So the historical shape is FROZEN here as a checked-in baseline
    artifact -- the same role a `migrations/` directory plays in
    Django/Alembic/Atlas.

HOW THE BASELINE IS ANCHORED  (v2 -- this is the load-bearing correction)
    The baseline is the schema of the FIRST commit that created the database
    file the product actually opens.  The file name is the anchor:
      * e282fce (Initial commit) used `clawlink.db` -- a DIFFERENT file.
      * 0ebf137 introduced `woclaw.sqlite` AND the 7-column `memory` table.
    Therefore every database the CURRENT product can open was created by
    0ebf137 or later, and 0ebf137's column set IS the baseline.

    v1 anchored the baseline on "the first commit whose diff adds a
    CREATE TABLE for this table" -- a DIFF-BASED anchor.  That is wrong for
    `memory`: 8a4ebb4 deleted the SQLite storage and 0ebf137 re-added it, so
    the diff-based anchor found the RE-ADDITION (0ebf137) for `memory` and the
    ORIGINAL (e282fce) for `topics`.  The two anchors disagree, and the
    disagreement is invisible unless you measure it.

HOW THE SCHEMA IS MEASURED (not parsed)
    The DDL strings are EXTRACTED from db.ts and EXECUTED against a real
    in-memory SQLite database; the column sets come from `PRAGMA table_info`.
    MySQL DDL is valid SQLite DDL once the trailing `ENGINE=...` clause and
    the inline `INDEX name (cols)` entries are stripped, so both backends are
    measured by the same mechanism -- there is no hand-written column list to
    drift.

MODES
    (default)             check: compare current DDL against baseline + ALTERs.
                          Exit 1 when gaps are found.
    --derive-baseline    (needs git history) regenerate the baseline artifact.
    --baseline-commit C  derive from commit C instead of the auto-anchor.

This gate is DEFECT-PRESENCE: it is RED while the defect exists and turns
GREEN when the defect is fixed (R461 arm G / R512-14 shape).
"""
import json
import os
import re
import subprocess
import sys
import sqlite3

HERE = os.path.dirname(os.path.abspath(__file__))
HUB = os.path.dirname(HERE)
REPO = os.path.dirname(HUB)
DBTS = os.path.join(HUB, "src", "db.ts")
BASELINE = os.path.join(HERE, "r516_schema_baseline.json")

# The database file the CURRENT product opens.  A database created before
# this file name existed is a DIFFERENT file and can never be opened by the
# current product -- so it cannot be a migration target.
CURRENT_DB_FILENAME = "woclaw.sqlite"


def git(*a):
    return subprocess.run(["git", "-C", REPO, *a],
                          capture_output=True, text=True).stdout


# ── extraction ───────────────────────────────────────────────────────────────

def template_literals(src):
    """All backtick template literals, with `\\` escapes honoured."""
    out, i, n = [], 0, len(src)
    while i < n:
        if src[i] == "`":
            j, buf = i + 1, []
            while j < n:
                if src[j] == "\\" and j + 1 < n:
                    buf.append(src[j + 1]); j += 2; continue
                if src[j] == "`":
                    break
                buf.append(src[j]); j += 1
            out.append("".join(buf))
            i = j + 1
            continue
        i += 1
    return out


def ddl_statements(src):
    """Every CREATE TABLE / ALTER TABLE statement string in db.ts."""
    stmts = []
    for lit in template_literals(src):
        for stmt in lit.split(";"):
            s = stmt.strip()
            if re.match(r"(CREATE TABLE|ALTER TABLE)\b", s, re.I):
                stmts.append(s)
    return stmts


def helper_alters(src):
    """`addColumnIfNotExists('table','column','def')` call sites."""
    return set(re.findall(r"addColumnIfNotExists\(\s*'(\w+)'\s*,\s*'(\w+)'", src))


def literal_alters(src):
    """`ALTER TABLE x ADD COLUMN y` statements."""
    return set(re.findall(r"ALTER TABLE\s+`?(\w+)`?\s+ADD COLUMN\s+`?(\w+)`?", src, re.I))


# ── measurement (execute the DDL, do not parse column names) ────────────────

def sqlite_compatible(stmt):
    """Make a MySQL-flavoured CREATE TABLE executable by SQLite.

    Two dialect differences matter:
      * trailing `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
      * inline index definitions `INDEX idx_x (col)` inside the column list
    Both are stripped; the COLUMN set is unaffected.
    """
    s = re.sub(r"\s*ENGINE\s*=\s*\w+(\s+DEFAULT\s+CHARSET\s*=\s*\w+)?\s*$", "", stmt, flags=re.I)
    s = re.sub(r"\s+DEFAULT\s+CHARSET\s*=\s*\w+\s*$", "", s, flags=re.I)
    s = re.sub(r",?\s*\b(?:INDEX|KEY)\s+\w+\s*\([^)]*\)", "", s, flags=re.I)
    return s


def execute_schema(stmts):
    """-> (tables, alters)
       tables: {(backend, table): [columns]}
       alters: {table: set(columns)}
    Each CREATE TABLE is executed in its OWN connection so the two backends'
    identically-named tables do not collide.
    """
    tables, alters = {}, {}
    for stmt in stmts:
        s = sqlite_compatible(stmt)
        m = re.match(r"CREATE TABLE IF NOT EXISTS\s+`?(\w+)`?\s*\(", s, re.I)
        if m:
            t = m.group(1)
            backend = "mysql" if re.search(r"ENGINE\s*=", stmt, re.I) else "sqlite"
            conn = sqlite3.connect(":memory:")
            try:
                conn.execute(s)
                cols = [r[1] for r in conn.execute(f"PRAGMA table_info({t})").fetchall()]
                tables[(backend, t)] = cols
            except sqlite3.Error as e:
                print(f"  !! could not execute CREATE TABLE {t} ({backend}): {e}", file=sys.stderr)
            finally:
                conn.close()
            continue
        m = re.match(r"ALTER TABLE\s+`?(\w+)`?\s+ADD COLUMN\s+`?(\w+)`?", s, re.I)
        if m:
            alters.setdefault(m.group(1), set()).add(m.group(2))
    return tables, alters


def measure(src):
    tables, alters = execute_schema(ddl_statements(src))
    for t, c in helper_alters(src) | literal_alters(src):
        alters.setdefault(t, set()).add(c)
    return tables, alters


def backend_of(stmt):
    """Which backend a DDL statement belongs to."""
    return "mysql" if re.search(r"ENGINE\s*=", stmt, re.I) else "sqlite"


def _class_blocks(src):
    """-> [(class_name, body)] for the storage classes in db.ts.

    The ALTER arms live in two different dialects and in two different
    classes:
      * SqliteStorage -> `addColumnIfNotExists('memory', 'col', ...)`
      * MySqlStorage  -> literal `ALTER TABLE memory ADD COLUMN col`
    Class context is what disambiguates them: a bare
    `ALTER TABLE memory ADD COLUMN x` has no ENGINE clause, so a
    dialect heuristic would file it under sqlite.  The backend is decided by
    WHICH CLASS the statement appears in, not by how the statement is spelled.
    """
    out = []
    for m in re.finditer(r"\n(?:export\s+)?class\s+(\w+)[^{]*\{", src):
        name = m.group(1)
        i = m.end() - 1
        depth, j = 0, i
        while j < len(src):
            if src[j] == "{":
                depth += 1
            elif src[j] == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        out.append((name, src[i:j]))
    return out


def alters_by_backend(src):
    """{backend: {table: {column}}} for the ALTER arms, per backend.

    The backend of an arm is decided by the CLASS it lives in, not by the
    statement's spelling: the MySQL arms are plain
    `ALTER TABLE memory ADD COLUMN x` with no ENGINE clause, so a dialect
    heuristic files them under sqlite.
    """
    out = {"sqlite": {}, "mysql": {}}
    for name, body in _class_blocks(src):
        if "Sqlite" in name:
            backend = "sqlite"
        elif "MySql" in name or "MySQL" in name:
            backend = "mysql"
        else:
            continue
        for lit in template_literals(body):
            for stmt in lit.split(";"):
                s = stmt.strip()
                m = re.match(r"ALTER TABLE\s+`?(\w+)`?\s+ADD COLUMN\s+`?(\w+)`?", s, re.I)
                if m and "${" not in m.group(2):
                    out[backend].setdefault(m.group(1), set()).add(m.group(2))
        for t, c in helper_alters(body):
            out[backend].setdefault(t, set()).add(c)
    return out


def db_filenames(src):
    """Every database file name the source can open."""
    return set(re.findall(r"[\w.-]+\.(?:sqlite|db)\b", src))


# ── baseline ─────────────────────────────────────────────────────────────────

def anchor_commit():
    """The first commit that created the file the CURRENT product opens.

    Anchored on the FILE NAME, not on a diff.  A diff-based anchor picks the
    re-addition of a table that was deleted and re-created; a file-name anchor
    picks the schema that the file was born with, which is exactly the set of
    databases the current product can ever open.
    """
    log = git("log", "--reverse", "--format=%H", "-S", CURRENT_DB_FILENAME, "--", "hub/src/db.ts")
    for sha in [l.strip() for l in log.splitlines() if l.strip()]:
        src = git("show", f"{sha}:hub/src/db.ts")
        if CURRENT_DB_FILENAME in src:
            return sha
    return None


def derive_baseline(commit=None):
    """Regenerate the baseline from git history (requires a full clone).

    Per TABLE, the baseline is the table's column set **as of the anchor
    commit** (the one that created the database file the product opens) --
    NOT the table's first-ever appearance.

    The distinction is load-bearing.  `memory` first appeared in e282fce with
    4 columns, but that lived in `clawlink.db`; the file was renamed to
    `woclaw.sqlite` in 0ebf137, where `memory` was created with 7 columns
    (tags/ttl/expire_at added).  A database the current product can open was
    always created by 0ebf137 or later, so the 7-column shape is the baseline
    and tags/ttl/expire_at need no ALTER arm.  Anchoring on the table's
    FIRST appearance instead would wrongly demand ALTER arms for three
    columns that every real database already has.

    A table that did not exist at the anchor is baselined at the commit that
    introduced it (that commit is necessarily at or after the anchor, because
    a table born before the anchor lived in the old file).
    """
    anchor = commit or anchor_commit()
    if not anchor:
        raise SystemExit("could not find the anchor commit for "
                         f"{CURRENT_DB_FILENAME}; pass --baseline-commit")
    anchor_src = git("show", f"{anchor}:hub/src/db.ts")
    if not anchor_src:
        raise SystemExit(f"cannot read {anchor}:hub/src/db.ts")
    anchor_tables, _ = measure(anchor_src)

    order = git("log", "--reverse", "--format=%H", "--", "hub/src/db.ts").split()
    anchor_idx = order.index(anchor) if anchor in order else None

    def sqlite_cols(tables, t):
        """The sqlite spelling of a table's columns, else the mysql one.

        `streams` is declared in both backends at HEAD, but only the mysql
        spelling existed at some commits; taking the sqlite one when present
        and falling back to mysql keeps every table baselined.
        """
        for (backend, tt), c in sorted(tables.items()):
            if tt == t and backend == "sqlite":
                return c
        for (backend, tt), c in sorted(tables.items()):
            if tt == t:
                return c
        return None

    out = {}
    for t in sorted({tt for (_b, tt) in anchor_tables}):
        cols = sqlite_cols(anchor_tables, t)
        if cols:
            out[t] = {
                "commit": anchor,
                "date": git("log", "-1", "--format=%ad", "--date=short", anchor).strip(),
                "subject": git("log", "-1", "--format=%s", anchor).strip(),
                "columns": cols,
                "pre_anchor": False,
            }

    # Tables introduced AFTER the anchor: baseline them at their own commit.
    for sha in order:
        if anchor_idx is not None and order.index(sha) <= anchor_idx:
            continue
        src = git("show", f"{sha}:hub/src/db.ts")
        if not src:
            continue
        tables, _ = measure(src)
        for (_b, t) in tables:
            if t in out:
                continue
            cols = sqlite_cols(tables, t)
            if cols:
                out[t] = {
                    "commit": sha,
                    "date": git("log", "-1", "--format=%ad", "--date=short", sha).strip(),
                    "subject": git("log", "-1", "--format=%s", sha).strip(),
                    "columns": cols,
                    "pre_anchor": False,
                }
    return {
        "version": 2,
        "anchor": {
            "db_filename": CURRENT_DB_FILENAME,
            "commit": anchor,
            "rationale": (
                "The baseline is the schema AT the first commit that created the "
                f"database file the product actually opens ({CURRENT_DB_FILENAME}). "
                "A database created before that file name existed is a DIFFERENT "
                "file and can never be opened by the current product, so it can "
                "never be a migration target. The anchor is deliberately NOT "
                "diff-based and NOT per-table-first-appearance: 8a4ebb4 deleted "
                "the SQLite storage and 0ebf137 re-added it under the new file "
                "name, so a diff-based anchor finds the RE-ADDITION for one table "
                "and the ORIGINAL for another, and a first-appearance anchor "
                "would demand ALTER arms for columns every real database already "
                "has."
            ),
        },
        "note": (
            "Columns present in each table's CREATE TABLE as of the anchor commit "
            "(or at the table's own introducing commit, for tables added later). "
            "Derived once from git history (`python3 r516_schema_drift_gate.py "
            "--derive-baseline`). A column in the current CREATE TABLE that is in "
            "neither this baseline nor an ALTER TABLE is a migration gap: it will "
            "not exist in databases created before it was added."
        ),
        "tables": out,
    }


# ── check ────────────────────────────────────────────────────────────────────

def check():
    src = open(DBTS).read()
    tables, _ = measure(src)
    arms = alters_by_backend(src)
    baseline = json.load(open(BASELINE))["tables"]

    gaps, unbaselined, covered, alter_only = [], [], [], []
    for (backend, t) in sorted(tables):
        if t not in baseline:
            unbaselined.append((backend, t))
            continue
        bc = set(baseline[t]["columns"])
        ac = arms.get(backend, {}).get(t, set())
        declared = set(tables[(backend, t)])
        for c in sorted(declared):
            if c in bc:
                continue
            if c in ac:
                covered.append((backend, t, c))
            else:
                gaps.append((backend, t, c))
        # An ALTER arm for a column the DDL does not declare is dead weight:
        # the column is added to every database but nothing can ever use it.
        for c in sorted(ac - declared):
            alter_only.append((backend, t, c))

    # backend parity of the DDL
    parity = []
    for t in sorted({t for _, t in tables}):
        s = set(tables.get(("sqlite", t), []))
        m = set(tables.get(("mysql", t), []))
        if not s or not m:
            continue
        if s != m:
            parity.append((t, sorted(s - m), sorted(m - s)))

    # backend parity of the ALTER arms: an arm in one backend only means
    # half the deployments never grow the column.
    arm_parity = []
    for t in sorted(set(arms["sqlite"]) | set(arms["mysql"])):
        s = arms["sqlite"].get(t, set())
        m = arms["mysql"].get(t, set())
        if s != m:
            arm_parity.append((t, sorted(s - m), sorted(m - s)))

    print("=== R516 schema-drift gate ===")
    print(f"  CREATE TABLE stmts measured : {len(tables)}")
    print(f"  baseline tables             : {len(baseline)}")
    print(f"  ALTER-covered columns       : {len(covered) + len(alter_only)}")
    for b, t, c in covered:
        print(f"      ok (ALTER) {b:7} {t}.{c}")
    print(f"  GAPS (column with no ALTER) : {len(gaps)}")
    for b, t, c in gaps:
        print(f"      *** {b:7} {t}.{c}")
    print(f"  backend parity gaps         : {len(parity)}")
    for t, os_, om in parity:
        print(f"      *** {t}: sqlite-only={os_} mysql-only={om}")
    print(f"  ALTER-arm parity gaps       : {len(arm_parity)}")
    for t, os_, om in arm_parity:
        print(f"      *** {t}: sqlite-only={os_} mysql-only={om}")
    print(f"  ALTER-only on this table    : {len(alter_only)}")
    for b, t, c in alter_only:
        # The column is added to this table by an ALTER arm but is NOT in this
        # table's CREATE TABLE.  It may still be declared on ANOTHER table
        # (memory.access_count vs sessions.access_count), so the cross-table
        # check decides whether it is really undeclared anywhere.
        #
        # This is INFORMATIONAL, not a gap: the column DOES reach every
        # database.  It is reported because the DDL and the migration then
        # disagree about what the table contains -- a reader of the CREATE
        # TABLE does not see the column the product actually relies on.
        elsewhere = sorted(
            {tt for (_bb, tt), cc in tables.items() if tt != t and c in cc}
        )
        note = f" (also declared on: {','.join(elsewhere)})" if elsewhere else ""
        print(f"      ok (ALTER) {b:7} {t}.{c}{note}")
    # The unbaselined counter is ALWAYS printed, not only when non-zero: a
    # counter that appears only on failure cannot distinguish "zero tables
    # skipped" from "the counter was never computed".  (R503's silent-zero
    # lesson: a silent zero looks exactly like an answer.)
    print(f"  UNBASELINED tables          : {len(unbaselined)}")
    for b, t in unbaselined:
        print(f"      (new table -- add to baseline) {b} {t}")

    if gaps or parity or arm_parity or unbaselined:
        print("VERDICT: FAIL")
        return 1
    print("VERDICT: PASS")
    return 0


def main():
    if "--derive-baseline" in sys.argv:
        commit = None
        if "--baseline-commit" in sys.argv:
            commit = sys.argv[sys.argv.index("--baseline-commit") + 1]
        data = derive_baseline(commit)
        with open(BASELINE, "w") as f:
            json.dump(data, f, indent=2, sort_keys=True)
            f.write("\n")
        print(f"wrote {BASELINE} ({len(data['tables'])} tables, "
              f"anchor {data['anchor']['commit'][:7]})")
        return 0
    return check()


if __name__ == "__main__":
    sys.exit(main())
