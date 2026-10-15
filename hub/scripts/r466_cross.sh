#!/bin/bash
# R466 cross-subject mutation matrix.
#
# r466_matrix.sh mutates r466's OWN assertions. An arm that replaces an
# assertion can only die if a DIFFERENT assertion covers the same fact; if no
# other arm does, it survives by construction and its survival is a tautology,
# not evidence. (R446/R454: a surviving mutation is a finding only when the
# command actually changed the thing it claimed to.)
#
# The meaningful axis is CROSS-SUBJECT: mutate r430_record_plane.test.ts — the
# file r466 audits — and ask whether r466 notices. If r466 is a real census,
# flipping r430's arms must move the census.
cd /root/.hermes/workspace/woclaw/hub || exit 1
T=test/r430_record_plane.test.ts
F=test/r466_gate_independence_census.test.ts
BASE_T=$(md5sum $T | cut -d' ' -f1)
BASE_F=$(md5sum $F | cut -d' ' -f1)
cp $T /tmp/r430.orig

summarize() {
  local out
  out=$(timeout 300 npx vitest run $F 2>&1 | grep -E '^ +Tests +' | tail -1)
  local passed failed
  passed=$(echo "$out" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
  failed=$(echo "$out" | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+')
  echo "  $1: ${failed:-0} red / ${passed:-0} pass"
}

restore() { cp /tmp/r430.orig $T; }

echo "=== CONTROL ==="
summarize CONTROL

# X1: give r430's A4 the direction its header CLAIMS. If r466 is a real
# independence census, A4 stops being a derivative of A2.
restore
python3 - <<'PY'
p='test/r430_record_plane.test.ts'
s=open(p).read()
old="hasDoc !== hasPlan && !hasDoc"
assert s.count(old)==1, ('X1 needle', s.count(old))
open(p,'w').write(s.replace(old,"hasDoc !== hasPlan && !hasPlan"))
PY
echo "X1 r430 A4 -> claimed direction (expect RED)"
summarize X1
restore

# X2: remove the relaxation entirely — A4 becomes the same predicate as A2.
restore
python3 - <<'PY'
p='test/r430_record_plane.test.ts'
s=open(p).read()
old="hasDoc !== hasPlan && !hasDoc"
assert s.count(old)==1, ('X2 needle', s.count(old))
open(p,'w').write(s.replace(old,"!hasDoc"))
PY
echo "X2 r430 A4 -> exactly A2 (expect RED: census must notice a literal duplicate)"
summarize X2
restore

# X3: delete A2's predicate body — the source arm goes SILENT, and every
# downstream "independent signal" count should collapse.
restore
python3 - <<'PY'
p='test/r430_record_plane.test.ts'
s=open(p).read()
import re
m=[l for l in s.split('\n') if 'citedBy.length' in l]
print('X3 candidate lines:', m, file=__import__('sys').stderr)
PY
echo "X3 (skipped: needs the real A2 predicate line)"
summarize "X3-noop"

echo "=== RESTORED ==="
[ "$(md5sum $T | cut -d' ' -f1)" = "$BASE_T" ] && echo "r430 MD5 MATCH" || echo "r430 MD5 MISMATCH"
[ "$(md5sum $F | cut -d' ' -f1)" = "$BASE_F" ] && echo "r466 MD5 MATCH" || echo "r466 MD5 MISMATCH"
rm -f /tmp/r430.orig
