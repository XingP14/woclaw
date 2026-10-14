#!/usr/bin/env bash
# R457 mutation matrix.
#   - one surgical mutant per arm of inviteToTopic's writer
#   - every mutation ASSERTS the file actually changed (pitfall R456: a needle
#     that does not occur makes str.replace a no-op while the script still
#     prints a confident "M3 applied")
#   - neighbour suites run unmodified in the SAME command, so a mutant killed
#     only by a neighbour is visible as such
set -u
cd "$(dirname "$0")/.." || exit 1
SRC=src/topics.ts
ORIG=/tmp/r457_topics_orig.ts
NEW=test/r457_private_invite_credential_scope.test.ts
NEIGH="test/topics_private_invite_branches.test.ts test/topics.test.ts"
cp "$SRC" "$ORIG"
BASE=$(md5sum "$SRC" | cut -d' ' -f1)
echo "baseline md5: $BASE"

report() { # <label>
  local now out
  now=$(md5sum "$SRC" | cut -d' ' -f1)
  if [ "$now" = "$BASE" ]; then
    echo "  !! NO-OP MUTATION — file unchanged, result below proves nothing"
  fi
  out=$(npx vitest run $NEW $NEIGH 2>&1 | grep -E '^ *(Tests|Test Files)' | tr -s ' \n' ' ')
  echo "  -> $out"
}

mut() { # <needle> <replacement> <label>
  python3 - "$1" "$2" <<'PY'
import sys
p='src/topics.ts'
before=open(p).read()
needle,repl=sys.argv[1],sys.argv[2]
assert needle in before, 'NEEDLE ABSENT: '+needle[:60]
after=before.replace(needle,repl,1)
assert after != before, 'MUTATION WAS A NO-OP'
open(p,'w').write(after)
PY
  if [ $? -ne 0 ]; then echo "  !! mutation script failed"; return 1; fi
  report
}

TOK="    topic.inviteToken = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');"
EXP="    topic.inviteExpiresAt = Date.now() + ttlMs;"
MEM="    topic.invitedAgents.add(agentId);"

cp "$ORIG" "$SRC"; echo "M1 delete the token WRITE (the credential is never rotated)"
mut "$TOK" "    // M1: credential write deleted"; cp "$ORIG" "$SRC"

echo "M2 delete the expiry WRITE (the window never moves)"
mut "$EXP" "    // M2: expiry write deleted"; cp "$ORIG" "$SRC"

echo "M3 shorten the expiry to a 1s ceiling (a clamp, in the honest direction)"
mut "$EXP" "    topic.inviteExpiresAt = Date.now() + Math.min(ttlMs, 1000);"; cp "$ORIG" "$SRC"

echo "M4 drop the invitedAgents membership (only the credential is left)"
mut "$MEM" "    // M4: membership write deleted"; cp "$ORIG" "$SRC"

echo "M5 constant token (COARSE — expected to survive or be uninformative)"
mut "$TOK" "    topic.inviteToken = 'aaaaaaaaaaaaaaaa';"; cp "$ORIG" "$SRC"

echo "=== restored ==="
report
