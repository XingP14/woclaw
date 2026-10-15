#!/bin/bash
# R466 mutation matrix. Serialized. Control first, then one mutant at a time.
# Never parallel: r456's lesson is that concurrent cwd/editor state produces
# phantom results, and a phantom result in a matrix IS a false finding.
cd /root/.hermes/workspace/woclaw/hub || exit 1
F=test/r466_gate_independence_census.test.ts
BASE_MD5=$(md5sum $F | cut -d' ' -f1)
echo "baseline md5: $BASE_MD5"
cp $F /tmp/r466.orig

run() { # $1 = label
  timeout 300 npx vitest run $F 2>&1 | grep -E '^ +Tests +' | tail -1
}

summarize() { # $1 label ; prints pass/fail counts
  local out
  out=$(timeout 300 npx vitest run $F 2>&1 | grep -E '^ +Tests +' | tail -1)
  local passed failed
  passed=$(echo "$out" | grep -oE '[0-9]+ passed' | grep -oE '[0-9]+')
  failed=$(echo "$out" | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+')
  echo "  $1: ${failed:-0} red / ${passed:-0} pass"
}

restore() { cp /tmp/r466.orig $F; }

echo "=== CONTROL (expect 0 red / 6 pass) ==="
summarize CONTROL

# M1: invert the containment direction — assert A2 ⊆ A4 instead.
restore
python3 - <<'PY'
import re
p='test/r466_gate_independence_census.test.ts'
s=open(p).read()
old="expect(containedIn(a4, a2)).toBe(true);"
new="expect(containedIn(a2, a4)).toBe(true);"
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,new))
PY
echo "M1 invert containment (expect RED)"
summarize M1
restore

# M2: make A4 non-derivative by widening its predicate to the claimed direction.
restore
python3 - <<'PY'
p='test/r466_gate_independence_census.test.ts'
s=open(p).read()
old="return hasDoc !== hasPlan && !hasDoc;"
new="return hasDoc && !hasPlan;"
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,new))
PY
echo "M2 A4 -> claimed direction (expect RED: census changes)"
summarize M2
restore

# M3: shrink A2's subject set to empty -> A2 silent, "everything independent".
restore
python3 - <<'PY'
p='test/r466_gate_independence_census.test.ts'
s=open(p).read()
old="{ id: 'A2', subject: (c) => c.rid !== null, pred: failsA2 },"
new="{ id: 'A2', subject: (c) => false, pred: failsA2 },"
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,new))
PY
echo "M3 A2 subject set -> empty (expect RED)"
summarize M3
restore

# M4: A0b vacuity arm — make it accept a non-empty real A2 set.
restore
python3 - <<'PY'
p='test/r466_gate_independence_census.test.ts'
s=open(p).read()
old="expect(a2Real).toEqual([]);"
new="expect(a2Real.length).toBeLessThan(999);"
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,new))
PY
echo "M4 A0b accept non-empty (expect RED)"
summarize M4
restore

# M5: B2 — drop the "claimed predicate is absent" assertion.
restore
python3 - <<'PY'
p='test/r466_gate_independence_census.test.ts'
s=open(p).read()
old="expect(comment.slice(0, comment.indexOf('expect(halfRecorded)'))).not.toContain('hasDoc && !hasPlan');"
new="expect(comment.slice(0, comment.indexOf('expect(halfRecorded)'))).toContain('hasPlan');"
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,new))
PY
echo "M5 B2 relax absent-predicate check (expect RED)"
summarize M5
restore

# M6: B4 — make the citation land in a file that DOES contain the sha.
restore
python3 - <<'PY'
p='test/r466_gate_independence_census.test.ts'
s=open(p).read()
old="expect(citeText).not.toContain('p000001');"
new="expect(citeText).toContain('p000001');"
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,new))
PY
echo "M6 B4 plant real citation (expect RED)"
summarize M6
restore

# M7: PLAN_RIDS derivation -> hardcoded list (the r437 rule).
restore
python3 - <<'PY'
p='test/r466_gate_independence_census.test.ts'
s=open(p).read()
old="const PLAN_RIDS = [...planText.matchAll(/^####\\s+(\\d{3})[.\\s]/gm)].map((m) => String(Number(m[1])));"
new="const PLAN_RIDS = ['460','461','463','464','465'];"
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,new))
PY
echo "M7 PLAN_RIDS hand-listed (expect RED)"
summarize M7
restore

# M8: B1 — drop the constructive asymmetry check.
restore
python3 - <<'PY'
p='test/r466_gate_independence_census.test.ts'
s=open(p).read()
old="expect(a4).not.toContain('bbbbbbb');"
new="expect(a4.length).toBeGreaterThan(0);"
assert s.count(old)==1, s.count(old)
open(p,'w').write(s.replace(old,new))
PY
echo "M8 drop asymmetry check (expect RED)"
summarize M8
restore

echo "=== RESTORED ==="
echo "md5 after: $(md5sum $F | cut -d' ' -f1)"
[ "$(md5sum $F | cut -d' ' -f1)" = "$BASE_MD5" ] && echo "MD5 MATCH" || echo "MD5 MISMATCH"
rm -f /tmp/r466.orig
