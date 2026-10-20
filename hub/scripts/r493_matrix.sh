#!/usr/bin/env bash
# R493 mutation matrix. Control first (R404-M1).
#
# THE SUBJECT: hub/test/multi_round_declaration_r435.test.ts -- the R435 suite
# whose A1 arm asserts "the multi-round set is EXACTLY the set the scalar
# extractor cannot see". Its `SINGLE` regex was a HAND COPY of r430's
# extractor, and its assertion was an ENUMERATION (an exact list). Both are
# the R435 class's own subject: a probe that pins a hand-written copy of the
# thing under audit, and a probe that pins an enumeration instead of a
# relation.
#
# MUTATED FILE: hub/test/r430_record_plane.test.ts -- the SOURCE whose
# extractor the r435 suite now DERIVES at run time. Restored by BYTE
# SNAPSHOT, never by `git checkout` (R469/R475: checkout on a dirty tree
# destroys work in progress).
#
# ARM SEMANTICS
#   CONTROL : nothing mutated. The r435 suite must be GREEN.
#   M1      : r430's extractor is widened to be MULTI-AWARE (`A || B`).
#             This is the event the A1 arm exists to detect: r430 stops
#             being blind to multi-round commits. The arm's own comment says
#             the characterisation becomes STALE and must be deleted -- so
#             the arm MUST go RED. If M1 is GREEN the arm LOST its trigger.
#   M2      : the r435 side is sabotaged -- the derived extractor keeps only
#             the FIRST regex literal in the assignment -- AND r430 is
#             widened. With only the first literal seen, the derived
#             extractor stays scalar, `blind` does NOT shrink, and A1 would
#             stay GREEN on the very event it exists to detect. So M2 must
#             be GREEN here (the sabotage neutralises M1's detection), and
#             GREEN is what proves the "read the whole ASSIGNMENT" half is
#             load-bearing rather than decorative.
#
# VERDICT VOCABULARY (R446): an arm that SURVIVES is a finding about the
# suite; an arm that is KILLED is the expected outcome for a control.
set -u
cd /root/.hermes/workspace/woclaw

R430=hub/test/r430_record_plane.test.ts
R435=hub/test/multi_round_declaration_r435.test.ts
SCRATCH=/root/.hermes/cache/scratch/r493

md5() { md5sum "$1" 2>/dev/null | cut -d' ' -f1; }

# --- pre-flight: the OWNED file must be CLEAN before we mutate it ---
if ! git diff --quiet -- "$R430"; then
  echo "FATAL: OWNED file $R430 is dirty before mutation. Aborting." >&2
  exit 2
fi

mkdir -p "$SCRATCH"
cp "$R430" "$SCRATCH/r430.orig"
BASE_R430=$(md5 "$R430")
BASE_R435=$(md5 "$R435")
echo "baseline md5: r430=$BASE_R430 r435=$BASE_R435"

restore_r430() {
  cp "$SCRATCH/r430.orig" "$R430"
  NOW=$(md5 "$R430")
  if [ "$NOW" != "$BASE_R430" ]; then
    echo "!!! RESTORE FAILED: $NOW != $BASE_R430" >&2
    return 1
  fi
  echo "  restore OK (md5 $NOW)"
}

restore_r435() {
  cp "$SCRATCH/r435.orig" "$R435"
  NOW=$(md5 "$R435")
  if [ "$NOW" != "$BASE_R435" ]; then
    echo "!!! RESTORE FAILED (r435): $NOW != $BASE_R435" >&2
    return 1
  fi
  echo "  restore OK (r435 md5 $NOW)"
}

cp "$R435" "$SCRATCH/r435.orig"

run_suite() {
  ( cd hub && npx vitest run test/multi_round_declaration_r435.test.ts 2>&1 )
}

# =========================================================================
echo ""
echo "== CONTROL =="
OUT=$(run_suite)
echo "$OUT" | grep -E '^ *Tests |^ *Test Files ' | head -2
if echo "$OUT" | grep -q 'Tests  4 passed'; then
  echo "CONTROL: GREEN (as expected)"
else
  echo "CONTROL: NOT GREEN -- the suite is red WITHOUT any mutation"; echo "$OUT" | tail -25
fi

# =========================================================================
echo ""
echo "== M1 REPAIR: widen r430's extractor to be multi-aware (A || B) =="
python3 - "$R430" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
old = r"const m = subj.match(/\((?:round|r)?(\d{3})\)/i);"
new = (r"const m = subj.match(/\((?:round|r)?(\d{3})\)/i) || "
       r"subj.match(/\(\s*((?:[rR](?:ound)?\d{3}\s*,\s*)+[rR](?:ound)?\d{3}\s*)\)/);")
assert old in s, "anchor not found in r430"
assert s.count(old) == 1, "anchor not unique"
open(p, 'w').write(s.replace(old, new, 1))
print("  injected: r430 extractor widened to A || B")
PY
OUT=$(run_suite)
echo "$OUT" | grep -E '^ *Tests ' | head -1
if echo "$OUT" | grep -q 'Tests  4 passed'; then
  echo "M1: *** SURVIVED *** -- the A1 arm did NOT detect its own trigger"
  echo "$OUT" | tail -25
else
  echo "M1: KILLED (the arm went RED, as it must)"
  echo "$OUT" | grep -E 'AssertionError' | head -2
fi
restore_r430

# =========================================================================
echo ""
echo "== M2 HAZARD: r435 keeps only the FIRST literal + r430 widened =="
python3 - "$R435" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
old = "  const literals = [...assign[0].matchAll(/\\/(.*?)\\/([a-z]*)/g)];"
new = "  const literals = [...assign[0].matchAll(/\\/(.*?)\\/([a-z]*)/g)].slice(0, 1);"
assert old in s, "anchor not found in r435"
assert s.count(old) == 1, "anchor not unique in r435"
open(p, 'w').write(s.replace(old, new, 1))
print("  injected: r435 derived extractor truncated to first literal")
PY
python3 - "$R430" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
old = r"const m = subj.match(/\((?:round|r)?(\d{3})\)/i);"
new = (r"const m = subj.match(/\((?:round|r)?(\d{3})\)/i) || "
       r"subj.match(/\(\s*((?:[rR](?:ound)?\d{3}\s*,\s*)+[rR](?:ound)?\d{3}\s*)\)/);")
assert old in s, "anchor not found in r430"
open(p, 'w').write(s.replace(old, new, 1))
print("  injected: r430 extractor widened")
PY
OUT=$(run_suite)
echo "$OUT" | grep -E '^ *Tests ' | head -1
if echo "$OUT" | grep -q 'Tests  4 passed'; then
  echo "M2: GREEN -- the r435-side 'read the WHOLE ASSIGNMENT' half IS load-bearing (confirmed)"
else
  echo "M2: RED -- the r435-side truncation did NOT lose the trigger; the comment's claim is NOT confirmed"
  echo "$OUT" | grep -E 'AssertionError' | head -2
fi
restore_r430
restore_r435

# =========================================================================
echo ""
echo "== FINAL INTEGRITY =="
echo "r430 md5 : $(md5 $R430) (expect $BASE_R430)"
echo "r435 md5 : $(md5 $R435) (expect $BASE_R435)"
echo "r430 diff:"; git diff --stat -- "$R430"
echo "r435 diff:"; git diff --stat -- "$R435"
