#!/bin/sh
# R498c matrix (woclaw): does the symlink-confinement suite actually pin the repair?
#
# Control first (R404-M1): a control mutation must go RED. If it does not,
# the suite is vacuous with respect to the step under test.
#
# Restore discipline (R475-2): NEVER `git checkout` -- the working tree is
# dirty with other agents' work. Snapshot the OWNED files byte-for-byte and
# restore from the snapshots. Assert the md5 after every step.
set -u
cd "$(dirname "$0")/.." || exit 1
SRC=src/ui_static.ts
TEST=test/r498c_ui_static_symlink_confinement.test.ts
SNAP_SRC=/tmp/r498c_ui_static.snap
SNAP_TEST=/tmp/r498c_ui_static_test.snap
BASE_SRC=$(md5sum "$SRC" | cut -d' ' -f1)
BASE_TEST=$(md5sum "$TEST" | cut -d' ' -f1)
echo "baseline src  md5 = $BASE_SRC"
echo "baseline test md5 = $BASE_TEST"
cp "$SRC" "$SNAP_SRC"
cp "$TEST" "$SNAP_TEST"

restore() { cp "$SNAP_SRC" "$SRC"; cp "$SNAP_TEST" "$TEST"; }
trap 'restore' EXIT

run_suite() {
  npx vitest run "$TEST" 2>&1 | grep -E "Tests +[0-9]|Test Files" | tr '\n' ' '
  echo
}

# ---- 0. CONTROL: the UNFIXED source (R498b's textual check only) -------
# The suite must go RED on it, otherwise it pins nothing.
#
# * THE FIRST VERSION OF THIS ARM WAS A DUPLICATE OF M1. Both applied the
#   SAME mutation to the SAME line, so "C0" never exercised the UNFIXED
#   source -- it exercised M1 twice, and the real control (the COMMITTED
#   R498b code, which has NO realpath at all) was never run. A control that
#   is a copy of another arm is not a control: it cannot fail independently.
#   C0 now restores the COMMITTED version of the file from git.
git show HEAD:hub/src/ui_static.ts > /tmp/r498c_ui_static_head.ts 2>/dev/null || \
  git show HEAD:src/ui_static.ts > /tmp/r498c_ui_static_head.ts
if [ ! -s /tmp/r498c_ui_static_head.ts ]; then
  echo "C0 (UNFIXED source):        SKIPPED -- cannot read the committed source"
else
  cp /tmp/r498c_ui_static_head.ts "$SRC"
  echo -n "C0 (UNFIXED committed src): "; run_suite
  restore
fi

# ---- M1: the true repair removed (confinement on the REAL path) --------
python3 - <<'PY'
p='src/ui_static.ts'
s=open(p).read()
old="    const realTarget = isInside ? realPathInsideRoot(target) : null;"
assert s.count(old)==1
s=s.replace(old,"    const realTarget = isInside ? target : null;")
open(p,'w').write(s)
PY
echo -n "M1 (confinement removed):  "; run_suite
restore

# ---- M2: check the REAL path, but SERVE the textual path ---------------
# A plausible wrong repair: the real path is used for the CHECK, but the
# file actually opened is the textual one (which follows the symlink).
python3 - <<'PY'
p='src/ui_static.ts'
s=open(p).read()
old="    let filePath = realTarget ?? indexPath;"
assert s.count(old)==1
s=s.replace(old,"    let filePath = (realTarget ? target : null) ?? indexPath;")
open(p,'w').write(s)
PY
echo -n "M2 (serve the textual path):"; run_suite
restore

# ---- M3: containment dropped, realpath still applied -------------------
python3 - <<'PY'
p='src/ui_static.ts'
s=open(p).read()
old="    return insideRealRoot(real) ? real : null;"
assert s.count(old)==1
s=s.replace(old,"    return real;")
open(p,'w').write(s)
PY
echo -n "M3 (containment dropped):  "; run_suite
restore

# ---- M4: realpath skipped entirely (textual containment only) ----------
python3 - <<'PY'
p='src/ui_static.ts'
s=open(p).read()
old="      real = realpathSync(candidate);"
assert s.count(old)==1
s=s.replace(old,"      real = candidate;")
open(p,'w').write(s)
PY
echo -n "M4 (realpath skipped):      "; run_suite
restore

# ---- M5: NEGATIVE CONTROL. A weaker-but-still-safe variant: the equality
# case is dropped, so only the prefix form remains. The escape must still
# be refused => the suite must stay GREEN.
python3 - <<'PY'
p='src/ui_static.ts'
s=open(p).read()
old="    candidate === realRoot || candidate.startsWith(realRoot + sep);"
assert s.count(old)==1
s=s.replace(old,"    candidate.startsWith(realRoot);")
open(p,'w').write(s)
PY
echo -n "M5 (neg control, weaker):  "; run_suite
restore

# ---- M6: THE DETECTOR-LIVENESS ARM. Break the marker regex so it can
# never fire. The F4 control arm must go RED -- otherwise the control is
# not load-bearing and every negative arm above is vacuous.
python3 - <<'PY'
p='test/r498c_ui_static_symlink_confinement.test.ts'
s=open(p).read()
old="  return /root:x:0:0/.test(body) || /root:\\$1\\$/.test(body) || /us-vps4/.test(body);"
assert s.count(old)==1, f"needle count {s.count(old)}"
s=s.replace(old,"  return false;")
open(p,'w').write(s)
PY
echo -n "M6 (detector broken):      "; run_suite
restore

echo -n "restored src  md5: "; md5sum "$SRC" | cut -d' ' -f1
echo -n "restored test md5: "; md5sum "$TEST" | cut -d' ' -f1
{ [ "$(md5sum "$SRC" | cut -d' ' -f1)" = "$BASE_SRC" ] && [ "$(md5sum "$TEST" | cut -d' ' -f1)" = "$BASE_TEST" ]; } && echo "RESTORE OK" || echo "RESTORE FAILED"
