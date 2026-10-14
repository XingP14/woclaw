#!/bin/bash
# R458 — re-derive R457's OWN matrix claims. Guards per R456: assert needle
# occurs AND that the write actually changed something (assert after != before).
set -u
TARGET=src/topics.ts
BASE_MD5=$(md5sum "$TARGET" | cut -d' ' -f1)
NEIGH="test/r457_private_invite_credential_scope.test.ts test/topics_private_invite_branches.test.ts"
echo "baseline md5=$BASE_MD5"

apply() { # $1=label $2=needle $3=replacement
  cp "$TARGET" /tmp/r458_orig.ts
  python3 - "$2" "$3" <<'PYEOF'
import sys, pathlib
p = pathlib.Path('src/topics.ts')
before = p.read_text()
needle, repl = sys.argv[1], sys.argv[2]
assert needle in before, f"NEEDLE-MISS: {needle!r} not present"
after = before.replace(needle, repl)
assert after != before, "NO-OP: replacement returned its own input"
p.write_text(after)
print(f"    applied OK ({before.count(needle)} site(s))")
PYEOF
  if [ $? -ne 0 ]; then echo "[$1] MUTATION INERT (restore)"; cp /tmp/r458_orig.ts "$TARGET"; return 2; fi
  local now; now=$(md5sum "$TARGET" | cut -d' ' -f1)
  if [ "$now" = "$BASE_MD5" ]; then echo "[$1] NO-OP WARN (md5 unchanged)"; cp /tmp/r458_orig.ts "$TARGET"; return 2; fi
  echo "[$1] applied md5=$now"
  return 0
}

restore() { git checkout -- "$TARGET"; local now; now=$(md5sum "$TARGET"|cut -d' ' -f1); echo "  restored md5=$now $([ "$now" = "$BASE_MD5" ] && echo OK || echo MISMATCH)"; }

run() { npx vitest run $NEIGH 2>&1 | grep -E "^ *(✓|×|✗|❯) test/|Tests " | sed 's/^/    /'; }

echo; echo "=== CONTROL (unmutated) ==="; run

echo; echo "=== M3 (header claims: clamp with Math.min -> arm D fails) ==="
apply M3 "topic.inviteExpiresAt = Date.now() + ttlMs;" \
  "topic.inviteExpiresAt = Math.min(topic.inviteExpiresAt ?? Infinity, Date.now() + ttlMs);" && run; restore

echo; echo "=== M3b (clamp the OTHER direction: Math.max -> arm D should fail) ==="
apply M3b "topic.inviteExpiresAt = Date.now() + ttlMs;" \
  "topic.inviteExpiresAt = Math.max(topic.inviteExpiresAt ?? 0, Date.now() + ttlMs);" && run; restore

echo; echo "=== M6 (the inviteExpiresAt line becomes dead code -> arm D's subject REMOVED) ==="
apply M6 "topic.inviteExpiresAt = Date.now() + ttlMs;" "const _dead = ttlMs;" && run; restore

echo; echo "=== M7 (assignment reads-modifies-itself) ==="
apply M7 "topic.inviteExpiresAt = Date.now() + ttlMs;" "topic.inviteExpiresAt = topic.inviteExpiresAt;" && run; restore

echo; echo "=== FINAL ==="; echo "md5=$(md5sum $TARGET | cut -d' ' -f1) baseline=$BASE_MD5"
git diff --stat -- src/ | tail -2; echo "(empty diff = zero production changes)"
