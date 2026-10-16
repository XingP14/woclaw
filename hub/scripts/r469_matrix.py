#!/usr/bin/env python3
"""R469 mutation matrix.

Discipline carried from R456-10 / R468-9 / R446-1:
  * control runs FIRST; no mutant result is reportable if control is red
  * every mutation asserts (a) the needle occurred exactly once, AND
    (b) the file actually changed (md5) — `str.replace` returns the string
    unchanged when the needle is absent, and a `count == 1` assertion on the
    needle still passes in that case (R456-1c)
  * restore is `git checkout --` + an md5 read-back, never `cp` (R446-1)
  * a backup copy is taken before the run and compared at the end, so a
    `git checkout` that reverts somebody else's uncommitted work is caught
    rather than silently accepted (this is what R469's first driver missed)

Needles are anchored to the SQLite backend by including the unique
`as MemoryVersionRowSqlite[]` / `result.changes || 0` tail, because the MySQL
backend carries a near-identical copy of every statement (R456-1b: two copies
in one string = the wrong copy gets edited).
"""
import hashlib
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path("/root/.hermes/workspace/woclaw/hub")
DB = ROOT / "src" / "db.ts"
TEST = ROOT / "test" / "r469_expiry_reach.test.ts"
BACKUP = Path("/tmp/r469_db_backup.ts")


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def run(cmd):
    return subprocess.run(cmd, cwd=str(ROOT), shell=True, capture_output=True, text=True)


def test_state():
    r = run(f"npx vitest run {TEST.name}")
    out = r.stdout + r.stderr
    for line in out.splitlines():
        if line.strip().startswith("Tests"):
            return line.strip(), "failed" not in line
    return out[-300:], False


def mutate(name, needle, repl, expect_kill):
    src = DB.read_text()
    before = md5(DB)
    n = src.count(needle)
    if n != 1:
        return f"{name}: NOT-INJECTED (needle count={n}, expected 1)"
    new = src.replace(needle, repl)
    if new == src:
        return f"{name}: SELF-INACTIVE (replace returned identical string)"
    DB.write_text(new)
    if md5(DB) == before:
        return f"{name}: SELF-INACTIVE (md5 unchanged)"
    try:
        line, ok = test_state()
    finally:
        run("git checkout -- src/db.ts")
    after = md5(DB)
    if after != before:
        return f"{name}: RESTORE-FAILED ({after} != {before})"
    killed = not ok
    return (f"{name}: {'KILLED' if killed else 'SURVIVED'} ({line}) "
            f"[{'PASS' if killed == expect_kill else 'BAD'}]")


MUTANTS = [
    # M1 — the real F1 fix: filter expired rows on the version read path (SQLite).
    ("M1-filter-versions",
     """      FROM memory_versions
      WHERE key = ?
      ORDER BY version DESC
    `).all(key) as MemoryVersionRowSqlite[];""",
     """      FROM memory_versions
      WHERE key = ? AND (expire_at = 0 OR expire_at >= ?)
      ORDER BY version DESC
    `).all(key, Date.now()) as MemoryVersionRowSqlite[];""",
     True),
    # M2 — the other half: sweep the archive as well as the live table.
    ("M2-sweep-versions",
     """      DELETE FROM memory
      WHERE expire_at > 0 AND expire_at < ?
    `).run(now);
    return result.changes || 0;""",
     """      DELETE FROM memory
      WHERE expire_at > 0 AND expire_at < ?
    `).run(now);
    this.db.prepare(`DELETE FROM memory_versions WHERE expire_at > 0 AND expire_at < ?`).run(now);
    return result.changes || 0;""",
     True),
    # M3 — user-initiated delete also clears the archive.
    ("M3-deleteMemory-versions",
     """  async deleteMemory(key: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM memory WHERE key = ?').run(key);""",
     """  async deleteMemory(key: string): Promise<boolean> {
    this.db.prepare('DELETE FROM memory_versions WHERE key = ?').run(key);
    const result = this.db.prepare('DELETE FROM memory WHERE key = ?').run(key);""",
     True),
    # M4 — expiry stops being a read-side write: filter instead of delete.
    ("M4-getMemory-filters",
     """  async getMemory(key: string): Promise<DBMemory | undefined> {
    const row = this.db.prepare(`
      SELECT key, value, tags, ttl, expire_at, updated_at, updated_by
      FROM memory
      WHERE key = ?
    `).get(key) as MemoryRowSqlite | undefined;
    if (!row) return undefined;

    const mem = mapMemoryRow(row);
    mem.value = safeDecryptValue(mem.value, this.encryption);
    if (mem.expireAt > 0 && mem.expireAt < Date.now()) {
      await this.deleteMemory(key);
      return undefined;
    }
    return mem;
  }""",
     """  async getMemory(key: string): Promise<DBMemory | undefined> {
    const row = this.db.prepare(`
      SELECT key, value, tags, ttl, expire_at, updated_at, updated_by
      FROM memory
      WHERE key = ? AND (expire_at = 0 OR expire_at >= ?)
    `).get(key, Date.now()) as MemoryRowSqlite | undefined;
    if (!row) return undefined;

    const mem = mapMemoryRow(row);
    mem.value = safeDecryptValue(mem.value, this.encryption);
    return mem;
  }""",
     True),
    # M5 NEGATIVE control — an over-eager sweep that also deletes live rows.
    # arm E must catch this; if it survives, arm E is not load-bearing.
    ("M5NEG-over-eager-sweep",
     """      DELETE FROM memory
      WHERE expire_at > 0 AND expire_at < ?
    `).run(now);
    return result.changes || 0;""",
     """      DELETE FROM memory
      WHERE expire_at >= 0 AND expire_at < ?
    `).run(now);
    return result.changes || 0;""",
     True),
]

shutil.copy2(DB, BACKUP)
print(f"backup written: {BACKUP} (md5 {md5(BACKUP)})")

print("\n=== CONTROL (must be green before any mutant counts) ===")
line, ok = test_state()
print(f"control: {line}")
if not ok:
    print("CONTROL RED — no mutant result is reportable")
    sys.exit(1)

base = md5(DB)
print(f"baseline md5 src/db.ts = {base}\n")

for name, needle, repl, expect_kill in MUTANTS:
    print(mutate(name, needle, repl, expect_kill))

final = md5(DB)
print(f"\nfinal md5 = {final} (expected {base}) -> "
      f"{'RESTORE OK' if final == base else '!!! MISMATCH !!!'}")
print("backup unchanged: " + ("yes" if md5(BACKUP) == base else "NO — backup differs"))
