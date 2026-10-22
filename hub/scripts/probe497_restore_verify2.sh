#!/bin/bash
# R497 probe part 2 (rerun): process-group cleanup so no orphan holds a port.
# R496-M496-3d: a lingering hub on a shared port makes a later leg look like
# it failed for a code reason.
set -u
HUB=/root/.hermes/workspace/woclaw/hub
cd "$HUB"
BASE=/tmp/r497probe/run
TOKEN=r497-probe-token

boot() { # $1=datadir $2=cfg $3=port $4=logname
  setsid env DATA_DIR="$1" CONFIG_FILE="$2" PORT="$3" REST_PORT="$(( $3 + 1 ))" \
    HOST=127.0.0.1 AUTH_TOKEN="$TOKEN" npx tsx src/index.ts > "$BASE/$4.log" 2>&1 &
  echo $!
}
stop() { kill -TERM -"$1" 2>/dev/null; sleep 1.5; kill -9 -"$1" 2>/dev/null; }
waitup() { for i in $(seq 1 90); do sleep 0.5; curl -s --max-time 2 "http://127.0.0.1:$1/health" >/dev/null 2>&1 && return 0; done; return 1; }
api() { if [ -n "${4:-}" ]; then curl -s --max-time 5 -X "$2" "http://127.0.0.1:$1$3" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$4"; else curl -s --max-time 5 -X "$2" "http://127.0.0.1:$1$3" -H "Authorization: Bearer $TOKEN"; fi; }

echo "################ L5: MIXED-KEY CONTAMINATION ################"
D5=$BASE/d5; rm -rf "$D5"; mkdir -p "$D5"
cp "$BASE/d1"/woclaw.sqlite "$BASE/d1"/woclaw.sqlite-wal "$BASE/d1"/woclaw.sqlite-shm "$D5"/ 2>/dev/null
cat > "$BASE/cfgB5.json" <<EOF
{"encryption":{"enabled":true,"passphrase":"WRONG-passphrase-here"},"dataDir":"$D5"}
EOF
P=$(boot "$D5" "$BASE/cfgB5.json" 23400 L5)
waitup 23401 && echo "booted" || { echo "L5 BOOT FAILED"; tail -5 "$BASE/L5.log"; }
echo "ready : $(api 23401 GET /ready)"
echo "WRITE under the WRONG key: $(api 23401 POST /memory '{"key":"r497:k2","value":"written-under-wrong-key"}')"
stop $P
echo "--- now restore the CORRECT passphrase on the SAME data dir ---"
cat > "$BASE/cfgA5.json" <<EOF
{"encryption":{"enabled":true,"passphrase":"correct-horse-battery"},"dataDir":"$D5"}
EOF
P=$(boot "$D5" "$BASE/cfgA5.json" 23410 L5b)
waitup 23411 && echo "booted" || echo "L5b BOOT FAILED"
echo "ready        : $(api 23411 GET /ready)"
echo "read old key : $(api 23411 GET /memory/r497:k)"
echo "read new key : $(api 23411 GET /memory/r497:k2)"
echo "list         : $(api 23411 GET /memory)"
stop $P
python3 - <<'PY'
import sqlite3
c=sqlite3.connect('/tmp/r497probe/run/d5/woclaw.sqlite')
for k,v in c.execute("SELECT key, value FROM memory"):
    print(f"  stored[{k}] len={len(v)} marker={v.startswith('ENC:v1:')}")
PY

echo
echo "################ L6: RESTORE ENCRYPTED BACKUP INTO A PLAINTEXT HUB ################"
D6=$BASE/d6; rm -rf "$D6"; mkdir -p "$D6"
cp "$BASE/d1"/woclaw.sqlite "$BASE/d1"/woclaw.sqlite-wal "$BASE/d1"/woclaw.sqlite-shm "$D6"/ 2>/dev/null
cat > "$BASE/cfgPlain.json" <<EOF
{"encryption":{"enabled":false},"dataDir":"$D6"}
EOF
P=$(boot "$D6" "$BASE/cfgPlain.json" 23420 L6)
waitup 23421 && echo "booted" || echo "L6 BOOT FAILED"
echo "ready : $(api 23421 GET /ready)"
echo "read  : $(api 23421 GET /memory/r497:k)"
stop $P

echo
echo "################ L7: HARD CORRUPTION (truncate the main db file) ################"
D7=$BASE/d7; rm -rf "$D7"; mkdir -p "$D7"
cp "$BASE/d1"/woclaw.sqlite "$D7"/woclaw.sqlite
python3 -c "
p='/tmp/r497probe/run/d7/woclaw.sqlite'
d=open(p,'rb').read(); open(p,'wb').write(d[:len(d)//3]); print('truncated to', len(d)//3, 'bytes')
"
cat > "$BASE/cfgA7.json" <<EOF
{"encryption":{"enabled":true,"passphrase":"correct-horse-battery"},"dataDir":"$D7"}
EOF
P=$(boot "$D7" "$BASE/cfgA7.json" 23430 L7)
sleep 8
echo "alive? : $(kill -0 $P 2>/dev/null && echo YES || echo NO)"
echo "ready  : $(api 23431 GET /ready)"
echo "health : $(api 23431 GET /health)"
echo "read   : $(api 23431 GET /memory/r497:k)"
echo "list   : $(api 23431 GET /memory)"
echo "--- L7 boot log (errors) ---"
grep -iE "error|corrupt|malformed|not a database|SQLITE" "$BASE/L7.log" | head -15
stop $P

echo "################ DONE ################"
