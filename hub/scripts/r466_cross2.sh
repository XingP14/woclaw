#!/bin/bash
# R466 cross-subject matrix, part 2 — isolate WHY the census is blind.
#
# X1 went RED, but B2 is a grep on r430's source text, so the RED only proves
# the literal `!hasDoc` was removed. It does NOT prove the census noticed.
# X4 removes that confound: keep `!hasDoc` present (so B2's grep stays green)
# while making A4 provably NON-derivative of A2.
#
#   hasDoc !== hasPlan && !hasDoc   ->   hasPlan && !hasDoc
#
# A commit with a doc but no plan fails A4 and passes A2: strictly independent.
# If r466 is a census OF R430, B3's verdict must flip. If B3 stays green, r466
# is not reading r430 — it is auditing its own hand-typed copy.
cd /root/.hermes/workspace/woclaw/hub || exit 1
T=test/r430_record_plane.test.ts
F=test/r466_gate_independence_census.test.ts
BASE_T=$(md5sum $T | cut -d' ' -f1)
cp $T /tmp/r430.orig

summarize() {
  local out
  out=$(timeout 300 npx vitest run $F 2>&1 | grep -E '^ +Tests +' | tail -1)
  local p f
  p=$(echo "$out" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
  f=$(echo "$out" | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+')
  echo "  $1: ${f:-0} red / ${p:-0} pass"
}
restore() { cp /tmp/r430.orig $T; }

echo "=== CONTROL ==="
summarize CONTROL

restore
python3 - <<'PY'
p='test/r430_record_plane.test.ts'
s=open(p).read()
old="hasDoc !== hasPlan && !hasDoc"
assert s.count(old)==1, ('X4 needle', s.count(old))
# `!hasDoc` survives -> B2's source grep stays green by construction.
new="hasPlan && !hasDoc"
open(p,'w').write(s.replace(old,new))
print("X4 applied")
PY
echo "X4 r430 A4 -> plan-without-doc, strictly NON-derivative (expect RED if census reads r430)"
summarize X4

# Which arm, if any, is red? A census that cannot see r430 must be 100% green.
restore
python3 - <<'PY'
p='test/r430_record_plane.test.ts'
s=open(p).read()
old="hasDoc !== hasPlan && !hasDoc"
assert s.count(old)==1
open(p,'w').write(s.replace(old,"hasPlan && !hasDoc"))
PY
timeout 300 npx vitest run $F 2>&1 | grep -E '✓|×|✗|FAIL' | head -20
restore

echo "=== RESTORED ==="
[ "$(md5sum $T | cut -d' ' -f1)" = "$BASE_T" ] && echo "r430 MD5 MATCH" || echo "r430 MD5 MISMATCH"
rm -f /tmp/r430.orig
