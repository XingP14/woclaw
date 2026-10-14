#!/bin/sh
# R460-5 detector mutation matrix.
# A sweep that reports 0 contradictions on the real tree is
# indistinguishable from a sweep that matches nothing (R456-10: needle absent,
# str.replace returns self, the count==1 assertion still passes).
#
# Plant 6 synthetic arms in a COPY of the tree and require the sweep to flag
# each one by line, plus 3 non-contradictions it must NOT flag.
set -eu
ROOT=/tmp/r460_mut
SRC=$1/hub/test
rm -rf "$ROOT"; mkdir -p "$ROOT"
cp "$SRC"/*.test.ts "$ROOT"/

CLEAN=$(python3 "$1/hub/scripts/r460_sweep.py" "$ROOT" | python3 -c 'import json,sys;print(json.load(sys.stdin)["contradiction_count"])')
echo "baseline (unmutated copy) contradictions = $CLEAN  [must be 0]"

TARGET="$ROOT/zzz_r460_planted.test.ts"
cat > "$TARGET" <<'EOF'
import { describe, it, expect } from 'vitest';

// M1 NEGATED CLAIM, the R457 arm D shape: title denies shrink, body shows shrink.
it('M1 a longer second write cannot shorten the expiry', () => {
  const aExpiry = 10, after = 3;
  expect(after).toBeLessThan(aExpiry);
});

// M2 NEGATED CLAIM, "never" phrasing, same shape.
it('M2 the window never shortens once it is minted', () => {
  const observed = 2;
  expect(observed).toBeLessThan(5);
});

// M3 OPPOSITE CLAIM: title promises shrink, body asserts growth.
it('M3 the value shrinks monotonically', () => {
  const before = 3, after = 9;
  expect(after).toBeGreaterThan(before);
});

// M4 OPPOSITE CLAIM: title promises growth, body asserts decline.
it('M4 the counter grows on every call', () => {
  const before = 9, after = 3;
  expect(after).toBeLessThan(before);
});

// M5 NEGATIVE control: title says shrink, body asserts shrink. AGREES.
it('M5 the value shrinks monotonically', () => {
  const before = 9, after = 3;
  expect(after).toBeLessThan(before);
});

// M6 NEGATIVE control: "no longer" is an idiom, not a growth claim.
it('M6 the probe no longer declares a subject set at all', () => {
  expect(count).toBeLessThan(3);
});

// M7 NEGATIVE control: body asserts BOTH directions, so it pins no direction.
it('M7 the window is bounded above', () => {
  expect(x).toBeGreaterThan(1);
  expect(x).toBeLessThan(10);
});
EOF

python3 "$1/hub/scripts/r460_sweep.py" "$ROOT" > /tmp/r460_mut.json
python3 - <<'PY'
import json
d = json.load(open('/tmp/r460_mut.json'))
got = {(r['title'].split()[0], r['file']) for r in d['contradictions']}
want = {'M1','M2','M3','M4'}
bad = {'M5','M6','M7'}
flagged = {t for t,_ in got if t in want}
wrongly = {t for t,_ in got if t in bad}
print("planted-file contradictions:")
for r in sorted(d['contradictions'], key=lambda r: r['title']):
    if r['file'].startswith('zzz'):
        print("   ", r['title'][:78], "->", r['group'], "|", r['title_word'], "vs", r['assertion'])
print("KILLED:", sorted(flagged), "expected", sorted(want))
print("WRONGLY FLAGGED:", sorted(wrongly) or "none (correct)")
ok = flagged == want and not wrongly
print("MATRIX:", "PASS" if ok else "FAIL")
PY
