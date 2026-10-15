#!/usr/bin/env bash
# R461 mutation matrix. Each arm applies ONE mutation to production code,
# re-runs the suite, records which arms redden, then RESTORES and md5-verifies.
#
# Baseline md5 (measured 2026-10-16 00:0x, git-clean src):
#   src/memory.ts 8475b921da90a41484efa9c5cf7fd188
#   src/index.ts  585912f4e821765ff845594699f92288
set -uo pipefail
HUB=/root/.hermes/workspace/woclaw/hub
SUITE=test/r461_restart_resync_not_boot.test.ts
LOG=/tmp/r461_matrix.log
BASE_MEM=8475b921da90a41484efa9c5cf7fd188
BASE_IDX=585912f4e821765ff845594699f92288
: > "$LOG"

restore() {
  cd "$HUB"
  git checkout -- src/memory.ts src/index.ts 2>/dev/null
  local m i
  m=$(md5sum src/memory.ts | cut -d' ' -f1)
  i=$(md5sum src/index.ts  | cut -d' ' -f1)
  if [ "$m" != "$BASE_MEM" ] || [ "$i" != "$BASE_IDX" ]; then
    echo "!! RESTORE FAILED mem=$m idx=$i" | tee -a "$LOG"
    return 1
  fi
  echo "   [restore OK]" | tee -a "$LOG"
  return 0
}

# run_suite <label> -> prints "PASS n/6" or "FAIL <arms>"
run_suite() {
  local label="$1" out
  out=$(cd "$HUB" && timeout 400 npx vitest run "$SUITE" --reporter=basic 2>&1)
  local passed red
  passed=$(echo "$out" | grep -oE 'Tests +[0-9]+ passed' | grep -oE '[0-9]+' | head -1)
  [ -z "$passed" ] && passed=0
  if echo "$out" | grep -q 'Tests  .*failed'; then
    red=$(echo "$out" | grep -oE 'r461_restart_resync_not_boot\.test\.ts > [^ ]+ > [A-F]:' \
          | grep -oE '> [A-F]:' | tr -d '> :' | tr '\n' ',' | sed 's/,$//')
    [ -z "$red" ] && red="(unattributed)"
    echo "$label -> FAIL passed=$passed/6 red=$red" | tee -a "$LOG"
  else
    echo "$label -> SURVIVED 6/6 GREEN" | tee -a "$LOG"
  fi
}

echo "=== baseline (unmutated) ===" | tee -a "$LOG"
restore || exit 9
run_suite "M0-baseline"

# ── M1: FIX-SHAPED. Apply the actual repair: re-sync every persisted memory
#         into the graph at boot. A deletion-only matrix cannot distinguish
#         "catches the bug" from "catches the bug AND accepts any wrong
#         repair" (R463 rule). Arms C/D/E assert the DIVERGENCE, so they must
#         redden; A/B (control, no restart) must stay green.
echo "=== M1 FIX-SHAPED: boot re-sync (index.ts) ===" | tee -a "$LOG"
python3 - "$HUB" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]) / "src" / "index.ts"
s = p.read_text()
needle = "  wsServer.getMemoryPool().graphStore = graphStore;\n"
assert s.count(needle) == 1, f"needle count={s.count(needle)}"
add = needle + """
  // R461 repair shape: re-sync every persisted memory into the graph at boot.
  void db.getAllMemory().then((all) => {
    for (const m of all) {
      graphStore.syncMemoryNode(m.key, m.value, m.updatedBy, m.tags ?? []);
    }
  });
"""
s = s.replace(needle, add)
assert s != p.read_text()
p.write_text(s)
print("M1 applied")
PY
run_suite "M1"
restore || exit 9

# ── M2: delete the write-half mirror entirely. Arms A and D must redden.
echo "=== M2 delete write-half mirror (memory.ts) ===" | tee -a "$LOG"
python3 - "$HUB" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]) / "src" / "memory.ts"
s = p.read_text()
needle = "      const memNode = this.graphStore.syncMemoryNode(key, serialized, updatedBy, tags);\n"
assert s.count(needle) == 1, f"needle count={s.count(needle)}"
s = s.replace(needle, "")
p.write_text(s)
print("M2 applied")
PY
run_suite "M2"
restore || exit 9

# ── M3: keep the node but drop the AUTHOR EDGE. Arm E asserts edges==0 after
#         restart; this makes even a fresh boot lose the edge -> must redden E.
echo "=== M3 drop author edge (memory.ts) ===" | tee -a "$LOG"
python3 - "$HUB" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]) / "src" / "memory.ts"
s = p.read_text()
needle = "    if (this.graphStore) {\n      const memNode = this.graphStore.syncMemoryNode(key, serialized, updatedBy, tags);\n"
assert s.count(needle) == 1, f"needle count={s.count(needle)}"
s = s.replace(needle, "    if (false && this.graphStore) {\n      const memNode = this.graphStore.syncMemoryNode(key, serialized, updatedBy, tags);\n")
p.write_text(s)
print("M3 applied")
PY
run_suite "M3"
restore || exit 9

# ── M4: WRONG REPAIR — sync at boot but only the FIRST memory (a plausible
#         bug: a for-of over a promise, or a `.slice(0,1)`). Arms D (which has
#         3 persisted memories) must redden while C (1 memory) stays green:
#         this is the arm that separates "resyncs something" from "resyncs all".
echo "=== M4 WRONG REPAIR: resync only the first memory (index.ts) ===" | tee -a "$LOG"
python3 - "$HUB" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1]) / "src" / "index.ts"
s = p.read_text()
needle = "  wsServer.getMemoryPool().graphStore = graphStore;\n"
assert s.count(needle) == 1, f"needle count={s.count(needle)}"
add = needle + """
  void db.getAllMemory().then((all) => {
    for (const m of all.slice(0, 1)) {
      graphStore.syncMemoryNode(m.key, m.value, m.updatedBy, m.tags ?? []);
    }
  });
"""
s = s.replace(needle, add)
p.write_text(s)
print("M4 applied")
PY
run_suite "M4"
restore || exit 9

echo "=== matrix complete ===" | tee -a "$LOG"
cat "$LOG"
