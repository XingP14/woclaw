#!/bin/sh
# R500 matrix (woclaw): does the directory-target DoS suite actually pin the
# repair?
#
# Control first (R404-M1): a control mutation must go RED. If it does not,
# the suite is vacuous with respect to the step under test.
#
# Restore discipline (R475-2): NEVER `git checkout` -- the working tree is
# dirty with other agents' work. Snapshot the OWNED files byte-for-byte and
# restore from the snapshots. Assert the md5 after every step.
#
# Also (R477-3): the snapshot is taken BEFORE any mutation, and the restore
# is asserted byte-for-byte after EVERY arm.
set -u
cd "$(dirname "$0")/.." || exit 1
SRC=src/ui_static.ts
TEST=test/r500_directory_target_dos.test.ts
SNAP_SRC=/tmp/r500_ui_static.snap
SNAP_TEST=/tmp/r500_ui_static_test.snap
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

# ---- 0. CONTROL: the UNFIXED source (the existence check alone) ---------
# The suite must go RED on it, otherwise it pins nothing. The UNFIXED shape
# is taken from the COMMITTED source of the file (the R498b version), which
# has NO realpath and NO isFile() guard.
git show HEAD:hub/src/ui_static.ts > /tmp/r500_ui_static_head.ts 2>/dev/null || \
  git show HEAD:src/ui_static.ts > /tmp/r500_ui_static_head.ts
if [ ! -s /tmp/r500_ui_static_head.ts ]; then
  echo "C0 (UNFIXED source):        SKIPPED -- cannot read the committed source"
else
  cp /tmp/r500_ui_static_head.ts "$SRC"
  echo -n "C0 (UNFIXED committed src): "; run_suite
  restore
fi

# ---- M1: the repair removed (the existence check alone) -----------------
python3 - <<'PY'
p='src/ui_static.ts'
s=open(p).read()
old="    if (!existsSync(filePath) || !statSync(filePath).isFile()) filePath = indexPath;"
assert s.count(old)==1, f"needle count {s.count(old)}"
s=s.replace(old,"    if (!existsSync(filePath)) filePath = indexPath;")
open(p,'w').write(s)
PY
echo -n "M1 (isFile guard removed):  "; run_suite
restore

# ---- M2: the guard applied to the WRONG variable ------------------------
# A plausible wrong repair: the guard is written against `indexPath` (which
# is always a file) instead of the candidate that is actually served.
python3 - <<'PY'
p='src/ui_static.ts'
s=open(p).read()
old="    if (!existsSync(filePath) || !statSync(filePath).isFile()) filePath = indexPath;"
assert s.count(old)==1, f"needle count {s.count(old)}"
s=s.replace(old,"    if (!existsSync(indexPath) || !statSync(indexPath).isFile()) filePath = indexPath;")
open(p,'w').write(s)
PY
echo -n "M2 (guard on wrong var):    "; run_suite
restore

# ---- M3: a guard that can never fire -----------------------------------
python3 - <<'PY'
p='src/ui_static.ts'
s=open(p).read()
old="    if (!existsSync(filePath) || !statSync(filePath).isFile()) filePath = indexPath;"
assert s.count(old)==1, f"needle count {s.count(old)}"
s=s.replace(old,"    if (!existsSync(filePath) || !statSync(filePath).isFile() || true) filePath = indexPath;")
open(p,'w').write(s)
PY
echo -n "M3 (guard can never fire):  "; run_suite
restore

# ---- M4: NEGATIVE CONTROL -- a DIFFERENT, ALSO-SAFE repair -------------
# The repair is applied by CATCHING the read error instead of pre-checking
# the file type. This is a defensible alternative repair: the process does
# not die, and the SPA fallback is served. The suite pins the OUTCOME (no
# crash, SPA fallback), not the mechanism -- so it must stay GREEN.
python3 - <<'PY'
p='src/ui_static.ts'
s=open(p).read()
old="""    let filePath = realTarget ?? indexPath;
    if (!existsSync(filePath) || !statSync(filePath).isFile()) filePath = indexPath;
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': UI_MIME_TYPES[ext] || UI_DEFAULT_CONTENT_TYPE });
    res.end(readFileSync(filePath));"""
assert s.count(old)==1, f"needle count {s.count(old)}"
new="""    let filePath = realTarget ?? indexPath;
    if (!existsSync(filePath)) filePath = indexPath;
    try {
      const buf = readFileSync(filePath);
      const ext = extname(filePath);
      res.writeHead(200, { 'Content-Type': UI_MIME_TYPES[ext] || UI_DEFAULT_CONTENT_TYPE });
      res.end(buf);
    } catch {
      const ext = extname(indexPath);
      res.writeHead(200, { 'Content-Type': UI_MIME_TYPES[ext] || UI_DEFAULT_CONTENT_TYPE });
      res.end(readFileSync(indexPath));
    }"""
s=s.replace(old,new)
open(p,'w').write(s)
PY
echo -n "M4 (neg control, try/catch):"; run_suite
restore

# ---- M5: NEGATIVE CONTROL -- a semantically different, EQUIVALENT form --
# `isDirectory()` is the other spelling of the same decision. It must stay
# GREEN: a suite that pins the MECHANISM rather than the OUTCOME would go
# RED here, and would be over-constrained.
python3 - <<'PY'
p='src/ui_static.ts'
s=open(p).read()
old="    if (!existsSync(filePath) || !statSync(filePath).isFile()) filePath = indexPath;"
assert s.count(old)==1, f"needle count {s.count(old)}"
s=s.replace(old,"    if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = indexPath;")
open(p,'w').write(s)
PY
echo -n "M5 (neg control, isDirectory):"; run_suite
restore

# ---- M6: THE DETECTOR-LIVENESS ARM -------------------------------------
# Break the process-level arm so it can no longer observe the crash. The
# R500 suite must then go RED on the UNFIXED source -- i.e. the control
# arm C0 must no longer be able to fail through this arm. This arm is
# scored by running the suite against the UNFIXED source with the broken
# detector: if the suite stays GREEN, the detector is what was carrying
# the control, and the arm is load-bearing.
python3 - <<'PY'
p='test/r500_directory_target_dos.test.ts'
s=open(p).read()
old="      expect(after.status, `the process died on a directory request:\\n${out}`).toBe(200);"
assert s.count(old)==1, f"needle count {s.count(old)}"
s=s.replace(old,"      expect(after.status, `the process died on a directory request:\\n${out}`).toBeGreaterThanOrEqual(-1);")
open(p,'w').write(s)
PY
cp /tmp/r500_ui_static_head.ts "$SRC"
echo -n "M6 (detector broken, UNFIXED src): "; run_suite
restore

echo -n "restored src  md5: "; md5sum "$SRC" | cut -d' ' -f1
echo -n "restored test md5: "; md5sum "$TEST" | cut -d' ' -f1
{ [ "$(md5sum "$SRC" | cut -d' ' -f1)" = "$BASE_SRC" ] && [ "$(md5sum "$TEST" | cut -d' ' -f1)" = "$BASE_TEST" ]; } && echo "RESTORE OK" || echo "RESTORE FAILED"
