#!/usr/bin/env bash
# R491 mutation matrix. Proves the tree-derived P1 is load-bearing.
#
# M1: DELETE the gate exemption -> the gate predicate no longer exempts
#     /admin/token/status, so it becomes 401-unauthenticated... wait, that
#     is the opposite. Carefully: requiresAuth = method !== 'GET' || path === GATED.
#     Removing `|| path === '/admin/token/status'` means GET /admin/token/status
#     is NO LONGER gated -> it returns 200 unauthenticated -> P1's relation
#     "exactly one derived GET route is gated" BREAKS (gated becomes []).
#     => P1 must go RED.
#
# M2 (the load-bearing / surgical one): ADD A NEW OPEN GET ROUTE to the
#     dispatcher. This is the defect class the adopted hand-listed P1 could
#     NOT see: the hand list is fixed, so a new route would not be probed.
#     With the tree-derived P1, the new route enters the subject set and
#     P1 still holds (it is also open) -> P1 stays GREEN. But the SUITE must
#     show that the DERIVED SET GREW: if we assert the derived set size, P1
#     would go red. Hmm.
#
#     Actually the honest M2 is: add a new open GET route AND assert the
#     derived subject set grew — that is the property the hand list lacked.
#     We verify it differently: we check that the ADOPTED hand-list P1 would
#     have MISSED it (the hand list has 17 entries, the derived set has 33
#     literals / 45 probes) and the tree-derived P1 COVERS it.
#
# M3 (control, MUST SURVIVE): a mutation that changes behaviour WITHOUT
#     changing the gate -> the suite must stay GREEN. E.g. change the JSON
#     error text 'Unauthorized' -> 'Nope'. Nothing observes the message.
#
# M4 (repair-shaped): make the gate cover GET routes (the actual fix) ->
#     P1/P2/P3 must go RED and P8's it.fails must FAIL (i.e. the repair arm
#     turns red, which is the intended tripwire).
#
# Restore discipline (R477): snapshot BEFORE mutating, restore in `finally`
# via sibling temp + os.replace, and assert the restore by md5.
set -u
REPO=/root/.hermes/workspace/woclaw
cd "$REPO" || exit 1
TARGET=hub/src/rest_server.ts
BAK=/tmp/r491_matrix_backup.ts
LOG=/tmp/r491_matrix.log

md5_of() { md5sum "$1" | cut -d' ' -f1; }
run_suite() { (cd hub && timeout 300 npx vitest run test/r491_read_surface_unauthenticated.test.ts 2>&1); }

BASE_MD5=$(md5_of "$TARGET")
echo "baseline md5 = $BASE_MD5" | tee "$LOG"
cp "$TARGET" "$BAK"
echo "snapshot taken at $BAK" | tee -a "$LOG"

restore() {
  python3 - "$TARGET" "$BAK" <<'PY'
import os, sys, pathlib, shutil
target, bak = sys.argv[1], sys.argv[2]
tmp = target + '.r491restore.tmp'
shutil.copyfile(bak, tmp)
os.replace(tmp, target)
PY
  local after=$(md5_of "$TARGET")
  if [ "$after" = "$BASE_MD5" ]; then
    echo "  restore OK (md5 $after)" | tee -a "$LOG"
  else
    echo "  RESTORE FAILED: $after != $BASE_MD5" | tee -a "$LOG"
    exit 9
  fi
}
trap 'restore' EXIT

mutate() { # $1 = python mutation program
  python3 - "$TARGET" "$1" <<'PY'
import sys, pathlib
target, prog = sys.argv[1], sys.argv[2]
p = pathlib.Path(target)
src = p.read_text()
ns = {}
exec(prog, {'src': src, 'find': src.find, 'replace': lambda a,b,c=0: src.replace(a,b,c)})
PY
}

score() { # $1 = label, $2 = output
  # R491 driver fix: the report goes to the LOG ONLY, and the FAILURE COUNT
  # ALONE goes to stdout. The inherited version piped the report through
  # `tee -a "$LOG"`, which ALSO wrote it to stdout -- so `F=$(score ...)`
  # captured the whole report instead of the number, `[ "$F" -gt 0 ]` raised
  # "integer expression expected", and EVERY verdict was inverted:
  # a killed mutant was reported SURVIVED and the control was reported KILLED.
  # The suite was right; the harness was reading it backwards.
  local label="$1" out="$2"
  local failed passed total
  failed=$(printf '%s' "$out" | grep -oE 'Tests +[0-9]+ failed' | grep -oE '[0-9]+' | head -1)
  failed=${failed:-0}
  total=$(printf '%s' "$out" | grep -oE 'Tests +[0-9]+ (failed|passed)[^)]*' | head -1)
  echo "  [$label] $total" >>"$LOG"
  printf '%s' "$out" | grep -E '^\s+→|FAIL ' | head -12 >>"$LOG"
  echo "$failed"
}

# ── M1: remove the GET exemption for /admin/token/status ──────────────────
echo "=== M1: delete the gate's GET exemption ===" | tee -a "$LOG"
mutate "
old = \"const requiresAuth = method !== 'GET' || path === '/admin/token/status';\"
assert src.count(old) == 1, 'anchor count != 1'
out = src.replace(old, \"const requiresAuth = method !== 'GET';\")
assert out != src
open('/tmp/m1_out.ts','w').write(out)
"
python3 -c "
import os,shutil
shutil.copyfile('/tmp/m1_out.ts', '$TARGET')
"
OUT=$(run_suite)
F=$(score M1 "$OUT")
restore
if [ "$F" -gt 0 ]; then echo "M1: KILLED (expected)" | tee -a "$LOG"; else echo "M1: SURVIVED  <-- PROBLEM" | tee -a "$LOG"; fi

# ── M2: add a NEW GATED GET route ─────────────────────────────────────────
# The defect class the adopted HAND-LISTED P1 could not see: a route added to
# the tree tomorrow would NOT be probed by a fixed list, so the suite would
# stay green. The discriminating mutation is a NEW GET route that IS gated:
#
#   - derived P1: the route enters the subject set, answers 401 without a
#     credential, so `gated` becomes ['/admin/token/status', '/r491-new'] and
#     the relation BREAKS  => RED.
#   - a hand-listed P1: the route is not in the list, never probed => GREEN.
#
# So M2 must be KILLED. The inherited M2 added an OPEN route instead, which
# keeps the relation TRUE (it is open, like every other GET route) and so
# could never discriminate -- the driver even said so in its own comment
# while still scoring it as a candidate. A mutation that cannot separate the
# two implementations is not a mutation, it is a no-op with a name.
echo "=== M2: add a NEW GATED GET route to the dispatcher ===" | tee -a "$LOG"
mutate "
old = \"      if (path === '/health') {\"
assert src.count(old) == 1, 'anchor count != 1'
out = src.replace(old, \"      if (path === '/r491-newly-gated') {\n        RestServer.sendJsonError(res, 401, 'Unauthorized');\n      } else if (path === '/health') {\")
assert out != src
open('/tmp/m2_out.ts','w').write(out)
"
python3 -c "
import shutil; shutil.copyfile('/tmp/m2_out.ts', '$TARGET')
"
OUT=$(run_suite)
F=$(score M2 "$OUT")
restore
if [ "$F" -gt 0 ]; then echo "M2: KILLED (expected: the derived subject set grew, so the relation broke)" | tee -a "$LOG"; else echo "M2: SURVIVED  <-- PROBLEM: the derived subject set did not grow; a hand list and a derived set are indistinguishable" | tee -a "$LOG"; fi

# ── M3 (control): change behaviour WITHOUT touching the gate -> MUST SURVIVE
echo "=== M3 (control, MUST SURVIVE): change the 401 body text ===" | tee -a "$LOG"
mutate "
old = \"RestServer.sendJsonError(res, 401, 'Unauthorized');\"
assert src.count(old) == 1, 'anchor count != 1'
out = src.replace(old, \"RestServer.sendJsonError(res, 401, 'Nope');\")
assert out != src
open('/tmp/m3_out.ts','w').write(out)
"
python3 -c "
import shutil; shutil.copyfile('/tmp/m3_out.ts', '$TARGET')
"
OUT=$(run_suite)
F=$(score M3 "$OUT")
restore
if [ "$F" -eq 0 ]; then echo "M3: SURVIVED (expected -- the control)" | tee -a "$LOG"; else echo "M3: KILLED  <-- PROBLEM: the control died" | tee -a "$LOG"; fi

# ── M4 (repair-shaped): actually gate the GET routes -> must go RED ───────
echo "=== M4 (repair-shaped): gate ALL GET routes (the real fix) ===" | tee -a "$LOG"
mutate "
old = \"const requiresAuth = method !== 'GET' || path === '/admin/token/status';\"
assert src.count(old) == 1, 'anchor count != 1'
out = src.replace(old, \"const requiresAuth = true;\")
assert out != src
open('/tmp/m4_out.ts','w').write(out)
"
python3 -c "
import shutil; shutil.copyfile('/tmp/m4_out.ts', '$TARGET')
"
OUT=$(run_suite)
F=$(score M4 "$OUT")
restore
if [ "$F" -gt 0 ]; then echo "M4: KILLED (expected -- the repair turns P1/P2/P3 red and the P8 tripwire fails)" | tee -a "$LOG"; else echo "M4: SURVIVED  <-- PROBLEM: a repair-shaped mutant survived" | tee -a "$LOG"; fi

echo "=== matrix done; final md5 = $(md5_of "$TARGET") (baseline $BASE_MD5) ===" | tee -a "$LOG"
cat "$LOG"
