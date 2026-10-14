#!/usr/bin/env bash
# R457 mutation matrix, per-suite attribution: the same five mutants, but each
# suite is run ALONE so "which suite killed it" is readable instead of inferred.
set -u
cd "$(dirname "$0")/.." || exit 1
SRC=src/topics.ts
ORIG=/tmp/r457_topics_orig.ts
NEW=test/r457_private_invite_credential_scope.test.ts
NEIGH="test/topics_private_invite_branches.test.ts test/topics.test.ts"
cp "$SRC" "$ORIG"
BASE=$(md5sum "$SRC" | cut -d' ' -f1)

mut() {
  python3 - "$1" "$2" <<'PY'
import sys
p='src/topics.ts'; before=open(p).read()
needle,repl=sys.argv[1],sys.argv[2]
assert needle in before, 'NEEDLE ABSENT: '+needle[:60]
after=before.replace(needle,repl,1); assert after!=before
open(p,'w').write(after)
PY
  [ $? -eq 0 ] || { echo "  !! mutation FAILED"; return 1; }
  local now; now=$(md5sum "$SRC" | cut -d' ' -f1)
  [ "$now" = "$BASE" ] && echo "  !! NO-OP: file unchanged"
  local n g
  n=$(npx vitest run $NEW 2>&1 | grep -Eo 'Tests +[0-9]+ failed' || echo "Tests 0 failed")
  g=$(npx vitest run $NEIGH 2>&1 | grep -Eo 'Tests +[0-9]+ failed' || echo "Tests 0 failed")
  echo "   R457: ${n#Tests }   neighbours: ${g#Tests }"
}

TOK="    topic.inviteToken = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');"
EXP="    topic.inviteExpiresAt = Date.now() + ttlMs;"
MEM="    topic.invitedAgents.add(agentId);"

echo "M1 token write deleted";      cp "$ORIG" "$SRC"; mut "$TOK" "    // M1 deleted"
echo "M2 expiry write deleted";     cp "$ORIG" "$SRC"; mut "$EXP" "    // M2 deleted"
echo "M3 1s expiry ceiling";        cp "$ORIG" "$SRC"; mut "$EXP" "    topic.inviteExpiresAt = Date.now() + Math.min(ttlMs, 1000);"
echo "M4 membership write deleted"; cp "$ORIG" "$SRC"; mut "$MEM" "    // M4 deleted"
echo "M5 constant token (COARSE)";  cp "$ORIG" "$SRC"; mut "$TOK" "    topic.inviteToken = 'aaaaaaaaaaaaaaaa';"

cp "$ORIG" "$SRC"
echo "=== restored baseline ==="
npx vitest run $NEW $NEIGH 2>&1 | grep -E '^ *(Tests|Test Files)'
md5sum "$SRC"
