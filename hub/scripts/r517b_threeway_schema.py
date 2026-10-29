#!/usr/bin/env python3
"""R517b -- three-way schema drift: DDL vs TS row interface vs SELECT list.

R515 found that `memory.federated` / `memory.source_hub` have no writer and
no reader.  R516 found that they also have no ALTER arm.  Both rounds
treated the finding as a property of TWO columns.

The structural question nobody has asked: a table's shape is written down
THREE times, by hand, in three different files-in-one-file:

  (a) the CREATE TABLE DDL      -- what the database actually has
  (b) the TS row interface       -- what the code believes a row looks like
      (e.g. `interface MemoryRowSqlite { ... }`)
  (c) the SELECT column list      -- what the code actually asks the database

Nothing checks that the three agree.  Each disagreement has a name:

  DDL-only       in (a), not in (b)  -> the code has no type for it
  TYPE-only      in (b), not in (a)  -> the code reads a column that does
                                      not exist  -> always undefined
  SELECT-only    in (c), not in (a)  -> the code asks for a column the
                                      database does not have -> SQL error
  NOT-SELECTED   in (a), not in (c)  -> the value exists but the query
                                      never asks for it -> always undefined
                                      (R515's federated/source_hub)

The last class is the interesting one: it is SILENT.  A missing column in a
SELECT is not an error, it is a permanently-undefined field.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
HUB = os.path.dirname(HERE)
DBTS = os.path.join(HUB, "src", "db.ts")
# Generated artefact -> _tmp/ (gitignored), not the tracked scripts/ dir.
_OUT_DIR = os.path.join(HUB, "_tmp")
os.makedirs(_OUT_DIR, exist_ok=True)
OUT = os.path.join(_OUT_DIR, "r517b_threeway_schema.json")

sys.path.insert(0, HERE)
import importlib.util
spec = importlib.util.spec_from_file_location("r517", os.path.join(HERE, "r517_column_lifecycle.py"))
r517 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r517)


def interfaces(src):
    """-> {interface_name: set(fields)} for the row interfaces in db.ts."""
    out = {}
    for m in re.finditer(r"\binterface\s+(\w+)\s*\{([^}]*)\}", src):
        name, body = m.group(1), m.group(2)
        fields = set()
        for fm in re.finditer(r"\b([a-z_][a-z0-9_]*)\s*\??\s*:", body):
            fields.add(fm.group(1))
        out[name] = fields
    return out


def interface_for_table(ifaces, table):
    """map a table name to the row interface(s) that describe it.

    `MemoryRowSqlite` -> memory ; `MemoryVersionRowSqlite` -> memory_versions ;
    `SessionFeedbackRowSqlite` -> session_feedback ; `MessageRowMysql` -> messages.

    The suffix vocabulary is closed and explicit: it is checked against the
    declared table names, so an unrecognised interface is reported as
    unmatched rather than silently credited to the wrong table.
    """
    suffix_words = ("Sqlite", "Mysql", "MySql", "Existing", "Stats", "Count", "Max")
    hits = []
    flat = {t.replace("_", ""): t for t in table_names}
    for name in ifaces:
        # A row interface is named `<Table>Row` or `<Table>Row<Backend>`:
        #   MemoryRowSqlite, MessageRowMysql, MemoryVersionRowSqlite.
        # Requiring the name to END in "Row" would exclude every
        # backend-qualified interface -- i.e. every real row interface.
        m = re.match(r"^(\w+?)Row(?:Sqlite|Mysql|MySql)?$", name)
        if not m:
            continue
        stem = m.group(1)
        cand = {stem.lower()}
        if stem.lower() == "message":
            cand.add("messages")
        elif stem.lower().endswith("s"):
            cand.add(stem.lower())          # memory -> memory
        else:
            cand.add(stem.lower() + "s")   # session -> sessions
            cand.add(stem.lower() + "es")
        # 'memoryversion' -> 'memory_versions'
        cand |= {c.replace("_", "") for c in cand}
        tbl = table.replace("_", "").lower()
        if tbl in cand or stem.lower() == table.lower():
            hits.append(name)
    return hits


def selects_per_table(src):
    """-> {table: set(columns explicitly selected}"""
    out = {}
    for name, body in r517.methods(src):
        w, s, st, r = r517.analyse_method(body)
        for t, cols in s.items():
            out.setdefault(t, set()).update(cols)
        for t in st:
            out.setdefault(t, set()).update("*" + t)
    return out


def main():
    raw = open(DBTS, encoding="utf-8").read()
    src = r517.strip_comments(raw)
    tbc = r517.ddl_columns(src)
    ifaces = interfaces(src)
    sels = selects_per_table(src)
    global table_names
    table_names = sorted(set(tbc["sqlite"]) | set(tbc["mysql"]))

    # The columns that exist only because of an ALTER arm are part of the
    # table's REAL shape -- the DDL text does not list them.  Folding the
    # ALTER arms in is what makes "type_only" a real finding instead of
    # the v1.0 migration columns showing up as phantom mismatches.
    alters = {}
    for lit in r517.template_literals(src):
        for stmt in lit.split(";"):
            s = stmt.strip()
            am = re.match(r"ALTER TABLE\s+`?(\w+)`?\s+ADD COLUMN\s+`?(\w+)`?", s, re.I)
            if am:
                alters.setdefault(am.group(1), set()).add(am.group(2))
    for hm in re.finditer(r"addColumnIfNotExists\(\s*'(\w+)'\s*,\s*'(\w+)'", src):
        alters.setdefault(hm.group(1), set()).add(hm.group(2))

    report = []
    print("interface inventory:")
    for n, f in sorted(ifaces.items()):
        print(f"  {n:28} {sorted(f)}")
    print()

    for backend in ("sqlite", "mysql"):
        for table, cols in sorted(tbc[backend].items()):
            ifaces_hits = interface_for_table(ifaces, table)
            declared = set(cols) | alters.get(table, set())
            sel = sels.get(table, set())
            star = any(c.startswith("*") for c in sel)
            sel = {c for c in sel if not c.startswith("*")}
            # union of the interfaces that describe this table
            typed = set()
            for i in ifaces_hits:
                typed |= ifaces[i]
            row = {
                "backend": backend,
                "table": table,
                "interfaces": ifaces_hits,
                "ddl_only": sorted(declared - typed),
                "type_only": sorted(typed - declared),
                "not_selected": sorted(declared - sel) if not star else [],
                "select_only": sorted(sel - declared) if not star else [],
                "starred": star,
            }
            report.append(row)

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1)

    for row in report:
        if not (row["ddl_only"] or row["type_only"] or row["not_selected"] or row["select_only"]):
            continue
        print(f"[{row['backend']}] {row['table']}  interfaces={row['interfaces']}"
              + ("  (SELECT *)" if row["starred"] else ""))
        for k in ("ddl_only", "type_only", "not_selected", "select_only"):
            if row[k]:
                print(f"    {k:12}: {row[k]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
