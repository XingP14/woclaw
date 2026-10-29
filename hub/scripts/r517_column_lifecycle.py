#!/usr/bin/env python3
"""R517 -- column lifecycle audit for hub/src/db.ts (method-scoped).

M515-1 asks three questions per column: who writes it, who reads it, what
happens if it is wrong.  R515 answered them for TWO columns by hand; this
script answers them for EVERY declared column of EVERY table, mechanically.

The unit of attribution is the METHOD: a method that mentions a table
(FROM / INTO / UPDATE) owns the reads and writes of that table inside it.
Method scoping is what keeps a common column name (`key`, `id`, `status`)
from being credited to the wrong table.

States per column instance (backend x table x column):
  declared  -- present in a CREATE TABLE
  written   -- named in an INSERT column list or an UPDATE ... SET list
  selected  -- explicitly listed in a SELECT column list
  starred   -- returned implicitly by a `SELECT *`
  read      -- the column is read off a row object in a method that owns the
               table (`row.<col>` / `r.<col>`), or the column's value is
               returned under a typed field name in such a method

Gap classes reported:
  NO-WRITER   declared, never written  (R515's subject)
  NO-READER   written/selected but the value is never read off the row
  DEAD-SELECT selected (explicitly) but never read
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
HUB = os.path.dirname(HERE)
DBTS = os.path.join(HUB, "src", "db.ts")
# The report lands in _tmp/, NOT in scripts/ next to the script: this file is
# a GENERATED artefact of a run over the current tree, and writing it into a
# tracked directory makes every run leave the worktree dirty (the residue
# guard in hub/test/gitignore_residue_guard.test.ts exists for exactly this
# class of leak).  _tmp/ is gitignored.
_OUT_DIR = os.path.join(HUB, "_tmp")
os.makedirs(_OUT_DIR, exist_ok=True)
OUT = os.path.join(_OUT_DIR, "r517_column_lifecycle.json")


def strip_comments(src):
    """Remove // and /* */ comments, but keep string literals intact enough
    that a DDL inside a template literal survives."""
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            j = src.find("\n", i)
            i = n if j < 0 else j
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            j = src.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        out.append(c)
        i += 1
    return "".join(out)


def template_literals(src):
    """Every backtick / single-quoted / double-quoted string literal.

    SQL in this file appears in ALL THREE styles: `SELECT ...` (backtick),
    'SELECT ...' (single quote) and "SELECT ..." (double quote).  A scanner
    that only reads backticks silently misses every single-quoted statement
    -- which is exactly how the mysql streams columns looked "never read".
    """
    out = []
    for q in ("`", "'", '"'):
        i, n = 0, len(src)
        while i < n:
            if src[i] == q:
                j, buf = i + 1, []
                while j < n:
                    if src[j] == "\\" and j + 1 < n:
                        buf.append(src[j + 1]); j += 2; continue
                    if src[j] == q:
                        break
                    buf.append(src[j]); j += 1
                out.append("".join(buf))
                i = j + 1
                continue
            i += 1
    return out


def norm(t):
    return t.strip().strip("`").strip()


def ddl_columns(src):
    """-> {backend: {table: [columns]}}"""
    out = {"sqlite": {}, "mysql": {}}
    for lit in template_literals(src):
        for stmt in lit.split(";"):
            s = stmt.strip()
            m = re.match(r"CREATE TABLE IF NOT EXISTS\s+`?(\w+)`?\s*\(", s, re.I)
            if not m:
                continue
            backend = "mysql" if re.search(r"ENGINE\s*=", s, re.I) else "sqlite"
            inner = s[m.end():]
            # Find the matching close paren of the column list.  Scanning for
            # "the first )" is WRONG: MySQL types contain parens (VARCHAR(191))
            # and the first ")" would end the column list after column 1.
            depth, buf, chunks, cut = 0, [], [], len(inner)
            for idx, ch in enumerate(inner):
                if ch == "(":
                    depth += 1
                elif ch == ")":
                    if depth == 0:
                        cut = idx
                        break
                    depth -= 1
                if depth == 0 and ch == ",":
                    chunks.append("".join(buf)); buf = []
                    continue
                buf.append(ch)
            chunks.append("".join(buf))
            names = []
            for c in chunks:
                c = c.strip()
                # A table-level constraint / index definition is not a column.
                # `KEY` must be matched CASE-SENSITIVELY and must be followed
                # by a name and a paren list -- otherwise a COLUMN LITERALLY
                # NAMED `key` (sqlite's memory.key) is silently dropped.
                if not c or re.match(r"(INDEX|PRIMARY|UNIQUE|CONSTRAINT|FOREIGN)\b", c, re.I) \
                        or re.match(r"KEY\s+\w+\s*\(", c):
                    continue
                m2 = re.match(r"`?(\w+)`?\s", c + " ")
                if m2:
                    names.append(m2.group(1))
            out[backend][m.group(1)] = names
    return out


def methods(src):
    """-> [(name, body)]  class methods AND top-level functions of db.ts

    The body is the LAST top-level brace group after the parameter list.
    Taking the FIRST brace group is WRONG: a method may declare an object
    return type (`async getStream(...): { topic: string; ... } {`), and the
    type literal is brace-delimited too.
    """
    out = []
    pat = r"(?:\n  |^)(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+)?(?:private |public |protected |static |async |readonly |get |set )*([A-Za-z_]\w*)\s*\([^;]*?\)"
    for m in re.finditer(pat, src, re.M | re.S):
        name = m.group(1)
        body = _last_brace_group(src, m.end())
        if body is None:
            continue
        out.append((name, body))
    return out


def _last_brace_group(src, start):
    """-> the body text of the function/method starting at `start`.

    Rules (both learned from instrument bugs):
      * A method may declare an OBJECT RETURN TYPE, which is itself a
        brace-delimited group: `async getStream(...): { topic: string; ... } {`.
        The body is the group AFTER the type.
      * The scan must STOP at the body, not run on into the enclosing class.
    The body group is therefore the first group whose closing brace is NOT
    immediately followed by another `{`.
    """
    depth = 0
    begin = start
    groups = []
    j = start
    n = len(src)
    while j < n:
        c = src[j]
        if c == "{":
            if depth == 0:
                begin = j
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                groups.append((begin + 1, j))
                # Was this group a TYPE literal rather than the body?
                # `): { ... } {`   -> type, body follows
                # `): { ... } | undefined {` -> type, body follows
                k = j + 1
                while k < n and src[k] in " \t\r\n":
                    k += 1
                if k < n and src[k] in "{|&":
                    j = k
                    continue
                break
        j += 1
    if not groups:
        return None
    b, e = groups[-1]
    return src[b:e]


def table_of_mapper(name, tables):
    """mapMemoryRow -> memory ; mapMemoryVersionRow -> memory_versions ;
    mapSessionRow -> sessions ; mapMessageRow -> messages

    The mapping is resolved against the DECLARED table names, so a guess is
    never credited to a table that does not exist.
    """
    if not name.startswith("map") or not name.endswith("Row"):
        return None
    stem = name[3:-3]
    # compare with underscores removed so 'memoryversion' == 'memory_versions'
    flat = {t.replace("_", ""): t for t in tables}
    if stem.lower() in flat:
        return flat[stem.lower()]
    cands = {stem.lower(), stem.lower() + "s", stem.lower() + "es",
             (stem.lower() + "s") if stem.lower().endswith("y") else stem.lower() + "ies"}
    for c in cands:
        if c in tables:
            return c
        if c.replace("_", "") in flat:
            return flat[c.replace("_", "")]
    return None


def tables_in(body):
    return set(re.findall(r"(?:FROM|INTO|UPDATE)\s+`?(\w+)`?", body, re.I))


def analyse_method(body):
    """-> (written_cols_by_table, selected_cols_by_table, starred_tables,
           read_cols_by_table)

    A column counts as READ when it is
      * listed in a SELECT column list, or
      * used in a WHERE / ORDER BY predicate of a query on that table, or
      * read off a row object (`row.<col>` / `r.<col>`).
    The predicate case matters: `WHERE run_id = ?` is a real use of the
    column even though the value is never projected into a typed field.
    """
    written, selected, starred, read = {}, {}, set(), {}
    for lit in template_literals(body):
        for stmt in lit.split(";"):
            s = stmt.strip()
            m = re.match(r"INSERT(?:\s+OR\s+\w+)?\s+INTO\s+`?(\w+)`?\s*\(([^)]*)\)", s, re.I)
            if m:
                cols = {norm(c) for c in m.group(2).split(",") if norm(c)}
                written.setdefault(m.group(1), set()).update(cols)
                continue
            m = re.match(r"UPDATE\s+`?(\w+)`?\s+SET\s+(.*)", s, re.I | re.S)
            if m:
                cols = set()
                for part in m.group(2).split(","):
                    mm = re.match(r"\s*`?(\w+)`?\s*=", part)
                    if mm:
                        cols.add(mm.group(1))
                written.setdefault(m.group(1), set()).update(cols)
                continue
            m = re.match(r"SELECT\s+(.*?)\s+FROM\s+`?(\w+)`?(.*)", s, re.I | re.S)
            if m:
                sel, table, tail = m.group(1).strip(), m.group(2), m.group(3)
                if sel == "*":
                    starred.add(table)
                else:
                    cols = set()
                    for part in sel.split(","):
                        part = part.strip()
                        mm = re.match(r"`?(\w+)`?(?:\s+AS\s+\w+)?$", part, re.I)
                        if mm:
                            cols.add(mm.group(1))
                    selected.setdefault(table, set()).update(cols)
                # predicates: WHERE x = ? / ORDER BY x / GROUP BY x
                pred = set()
                for kw in ("WHERE", "ORDER BY", "GROUP BY", "HAVING"):
                    for pm in re.finditer(kw + r"\s+(.*?)(?:\s+LIMIT\b|\s+OFFSET\b|$)", tail, re.I | re.S):
                        for ident in re.finditer(r"`?(\w+)`?\s*(?:=|<|>|\bLIKE\b|\bIN\b|\bIS\b)", pm.group(1)):
                            pred.add(ident.group(1))
                if pred:
                    selected.setdefault(table, set()).update(pred)
    # reads: `.column` off a row-ish receiver
    for m in re.finditer(r"\b(?:row|r|item|rec|record|m|existing|memRow|sessRow)\.([a-z_][a-z0-9_]*)", body):
        read.setdefault("__ALL__", set()).add(m.group(1))
    return written, selected, starred, read


def callsites(src_all, names):
    """-> {name: [call sites]} counting occurrences OUTSIDE db.ts.

    R406's lesson: a write METHOD existing inside the storage module is not
    a writer.  If nothing calls it from the product, the column keeps its
    DEFAULT forever.  So a writer must be REACHABLE.
    """
    out = {n: [] for n in names}
    for path, src in src_all.items():
        if path.endswith("db.ts"):
            continue
        for n in names:
            for m in re.finditer(r"\b" + re.escape(n) + r"\s*\(", src):
                line = src[:m.start()].count("\n") + 1
                out[n].append(f"{path}:{line}")
    return out


def main():
    raw = open(DBTS, encoding="utf-8").read()
    src = strip_comments(raw)
    tbc = ddl_columns(src)

    written_by = {}
    selected_by = {}
    starred_by = {}
    read_by = {}
    writer_methods = set()
    all_tables = set(tbc["sqlite"]) | set(tbc["mysql"])
    for name, body in methods(src):
        w, s, st, r = analyse_method(body)
        for t, cols in w.items():
            written_by.setdefault(t, set()).update(cols)
            writer_methods.add(name)
        for t, cols in s.items():
            selected_by.setdefault(t, set()).update(cols)
        for t in st:
            starred_by.setdefault(t, set()).add(t)
        # attribute the reads to the tables THIS method owns
        owned = set(w) | set(s) | set(st)
        mapper = table_of_mapper(name, all_tables)
        if mapper:
            owned = owned | {mapper}
        if not owned:
            continue
        for t in owned:
            read_by.setdefault(t, set()).update(r.get("__ALL__", set()))

    rows = []
    for backend in ("sqlite", "mysql"):
        for table, cols in sorted(tbc[backend].items()):
            for c in cols:
                rows.append({
                    "backend": backend,
                    "table": table,
                    "column": c,
                    "written": c in written_by.get(table, set()),
                    "selected": c in selected_by.get(table, set()),
                    "starred": table in starred_by,
                    "read": c in read_by.get(table, set()),
                })

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=1)

    def show(title, pred):
        print(title)
        hits = [r for r in rows if pred(r)]
        for r in hits:
            print(f"  {r['backend']:6} {r['table']}.{r['column']}")
        if not hits:
            print("  (none)")
        print()

    print(f"declared column instances : {len(rows)}")
    print(f"  written                 : {sum(1 for r in rows if r['written'])}")
    print(f"  selected (explicit)     : {sum(1 for r in rows if r['selected'])}")
    print(f"  read off a row          : {sum(1 for r in rows if r['read'])}")
    print()
    show("NO-WRITER (declared, never named by an INSERT/UPDATE):",
         lambda r: not r["written"])
    show("SELECTED BUT NEVER READ (value comes back, nobody reads it):",
         lambda r: (r["selected"] or r["starred"]) and not r["read"])
    show("WRITTEN BUT NEVER READ:",
         lambda r: r["written"] and not r["read"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
