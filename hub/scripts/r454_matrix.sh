#!/bin/bash
# R454 mutation matrix — control first (R404-M1); restore ONLY via git checkout
# + md5 read-back (R446-1: never cp after sed).
cd /root/.hermes/workspace/woclaw/hub
BASE=7ea4d6f517a8045db2be1d0f2b332923
run() { npx vitest run test/r454_entropy_provenance.test.ts 2>&1 | grep -E "^ +Tests +" | tr -s ' '; }
killed() {
  out=$(run)
  if echo "$out" | grep -q "failed"; then echo "$1: KILLED   [$out]"; else echo "$1: SURVIVED [$out]"; fi
}
chk() { now=$(md5sum src/*.ts | md5sum | cut -d' ' -f1); [ "$now" = "$BASE" ] || { echo "!!! src NOT restored: $now"; exit 9; }; }

echo "== control (expect 7 passed, 0 failed)"; run
echo "src md5 baseline: $BASE"; echo

echo "== M1 real fix, topics.ts -> CSPRNG"
sed -i 's|const topic.inviteToken = Array.from({ length: 16 }, () => Math.floor(Math.random() \* 16).toString(16)).join(.*|const topic.inviteToken = randomBytes(8).toString("hex");|' src/topics.ts
sed -i "16i import { randomBytes } from 'crypto';" src/topics.ts
killed "M1"; git checkout -- src/topics.ts; chk

echo "== M2 real fix, rest_server.ts -> CSPRNG"
sed -i 's|const newToken = Array.from({ length: 32 }, () => Math.floor(Math.random() \* 16).toString(16)).join(.*|const newToken = randomBytes(16).toString("hex");|' src/rest_server.ts
killed "M2"; git checkout -- src/rest_server.ts; chk

echo "== M3 alphabet 16 -> 36"
sed -i 's|Math.floor(Math.random() \* 16)|Math.floor(Math.random() * 36)|' src/topics.ts
killed "M3"; git checkout -- src/topics.ts; chk

echo "== M4 negative arm's own subject gains a CSPRNG reference"
python3 -c "
p='test/token_rotation.test.ts'; s=open(p).read()
if 'woclaw-r454-sabotage' not in s:
    open(p,'w').write(s+chr(10)+'// woclaw-r454-sabotage'+chr(10)+\"const _r454 = require('crypto').randomBytes(16).toString('hex');\"+chr(10))
"
killed "M4"; git checkout -- test/token_rotation.test.ts

echo "== M5 isTokenAuthorized accepts any token"
sed -i 's|if (token === this.config.authToken) return true;|if (token === this.config.authToken \|\| token) return true;|' src/ws_server.ts
killed "M5"; git checkout -- src/ws_server.ts; chk

echo "== M6 DELIBERATE COVARIANT (R446-2): rename the gate's own field everywhere"
sed -i 's|topic.inviteToken === inviteToken|topic.inviteToken === inviteToken \&\& false|' src/topics.ts
killed "M6 (expected SURVIVED = the R453-1 question)"; git checkout -- src/topics.ts; chk

echo
echo "== final restore check"; echo "src md5 now: $(md5sum src/*.ts | md5sum | cut -d' ' -f1)"
git diff --stat -- src/ && echo "(empty diff = zero production change)"
echo "MATRIX DONE"
