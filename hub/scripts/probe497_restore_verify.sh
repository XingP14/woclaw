#!/bin/bash
# R497 probe: RESTORE VERIFICATION plane.
#
# Question: after a restore (new data dir / new passphrase / corrupted file),
# does the hub ANNOUNCE that the restored data is not what it claims to be?
#
# Legs:
#   L1 baseline  : encrypted write + read back (passphrase A) -> healthy
#   L2 wrong key : same DB file, passphrase B (post-restore) -> what does GET return?
#   L3 corrupt   : corrupted sqlite file -> does the hub boot, and does /ready say ready?
#   L4 legacy imp: legacy woclaw.json import into an ENCRYPTED db -> is at-rest plaintext?
#
# Boots the REAL hub (hub/src/index.ts) every leg -- R496-M496-1: the subject is
# a boot/restore sequence, so a hand-rolled re-implementation would test itself.
set -u
HUB=/root/.hermes/workspace/woclaw/hub
cd "$HUB"

BASE=/tmp/r497probe/run
rm -rf "$BASE"; mkdir -p "$BASE"

TOKEN=r497-probe-token

# port range: avoid r487 (19000..19799), r488 (19500..19989), r496 (21000..21400)
PORT=23100

boot() { # $1=datadir $2=configfile $3=port $4=logname
  DATA_DIR="$1" CONFIG_FILE="$2" PORT="$3" REST_PORT="$(( $3 + 1 ))" \
  HOST=127.0.0.1 AUTH_TOKEN="$TOKEN" \
  npx tsx src/index.ts > "$BASE/$4.log" 2>&1 &
  echo $!
}

waitready() { # $1=port
  for i in $(seq 1 60); do
    sleep 0.5
    curl -s --max-time 2 "http://127.0.0.1:$1/health" >/dev/null 2>&1 && return 0
  done
  return 1
}

api() { # $1=port $2=method $3=path $4=body
  if [ -n "${4:-}" ]; then
    curl -s --max-time 5 -X "$2" "http://127.0.0.1:$1$3" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$4"
  else
    curl -s --max-time 5 -X "$2" "http://127.0.0.1:$1$3" -H "Authorization: Bearer $TOKEN"
  fi
}

echo "################ L1: baseline (passphrase A) ################"
D1=$BASE/d1; mkdir -p "$D1"
cat > "$BASE/cfgA.json" <<EOF
{"encryption":{"enabled":true,"passphrase":"correct-horse-battery"},"dataDir":"$D1"}
EOF
P=$(boot "$D1" "$BASE/cfgA.json" $PORT L1)
waitready $((PORT+1)) || echo "L1 BOOT FAILED"
echo "ready: $(api $((PORT+1)) GET /ready)"
echo "write: $(api $((PORT+1)) POST /memory '{"key":"r497:k","value":"the-secret-value"}')"
echo "read : $(api $((PORT+1)) GET /memory/r497:k)"
kill -TERM $P 2>/dev/null; sleep 1.5; kill -9 $P 2>/dev/null

echo
echo "################ L2: RESTORE with WRONG PASSPHRASE (B) ################"
D2=$BASE/d2; mkdir -p "$D2"
cp "$D1"/woclaw.sqlite "$D2"/woclaw.sqlite
cp "$D1"/woclaw.sqlite-wal "$D2"/woclaw.sqlite-wal 2>/dev/null
cp "$D1"/woclaw.sqlite-shm "$D2"/woclaw.sqlite-shm 2>/dev/null
cat > "$BASE/cfgB.json" <<EOF
{"encryption":{"enabled":true,"passphrase":"WRONG-passphrase-here"},"dataDir":"$D2"}
EOF
P=$(boot "$D2" "$BASE/cfgB.json" $((PORT+10)) L2)
waitready $((PORT+11)) || echo "L2 BOOT FAILED"
echo "ready : $(api $((PORT+11)) GET /ready)"
echo "health: $(api $((PORT+11)) GET /health)"
echo "read  : $(api $((PORT+11)) GET /memory/r497:k)"
echo "list  : $(api $((PORT+11)) GET /memory)"
echo "stats : $(api $((PORT+11)) GET /memory/stats)"
kill -TERM $P 2>/dev/null; sleep 1.5; kill -9 $P 2>/dev/null

echo
echo "################ L3: CORRUPTED sqlite file ################"
D3=$BASE/d3; mkdir -p "$D3"
cp "$D1"/woclaw.sqlite "$D3"/woclaw.sqlite
# flip bytes in the middle of the file (page payload)
python3 - "$D3/woclaw.sqlite" <<'PY'
import sys
p=sys.argv[1]
b=bytearray(open(p,'rb').read())
start=len(b)//2
for i in range(start, min(start+512, len(b))):
    b[i]=0xFF
open(p,'wb').write(bytes(b))
print("corrupted bytes at offset", start, "of", len(b))
PY
cat > "$BASE/cfgC.json" <<EOF
{"encryption":{"enabled":true,"passphrase":"correct-horse-battery"},"dataDir":"$D3"}
EOF
P=$(boot "$D3" "$BASE/cfgC.json" $((PORT+20)) L3)
sleep 8
echo "alive? : $(kill -0 $P 2>/dev/null && echo YES || echo NO)"
echo "ready  : $(api $((PORT+21)) GET /ready)"
echo "health : $(api $((PORT+21)) GET /health)"
echo "read   : $(api $((PORT+21)) GET /memory/r497:k)"
echo "--- L3 boot log tail ---"
tail -25 "$BASE/L3.log"
kill -TERM $P 2>/dev/null; sleep 1.5; kill -9 $P 2>/dev/null

echo
echo "################ L4: legacy woclaw.json import into ENCRYPTED db ################"
D4=$BASE/d4; mkdir -p "$D4"
cat > "$D4/woclaw.json" <<'EOF'
{"messages":[],"memory":[{"key":"r497:legacy","value":"LEGACY-PLAINTEXT-SECRET","tags":["t"],"ttl":0,"updatedAt":1700000000000,"updatedBy":"legacy"}],"memory_versions":[]}
EOF
cat > "$BASE/cfgD.json" <<EOF
{"encryption":{"enabled":true,"passphrase":"correct-horse-battery"},"dataDir":"$D4"}
EOF
P=$(boot "$D4" "$BASE/cfgD.json" $((PORT+30)) L4)
waitready $((PORT+31)) || echo "L4 BOOT FAILED"
echo "read via API : $(api $((PORT+31)) GET /memory/r497:legacy)"
kill -TERM $P 2>/dev/null; sleep 1.5; kill -9 $P 2>/dev/null
echo "--- raw sqlite bytes for LEGACY-PLAINTEXT-SECRET ---"
python3 - "$D4/woclaw.sqlite" <<'PY'
import sys
d=open(sys.argv[1],'rb').read()
for needle in (b"LEGACY-PLAINTEXT-SECRET", b"ENC:v1:"):
    print(f"  {needle!r}: found {d.count(needle)} time(s) in the raw db file")
PY

echo
echo "################ DONE ################"
ls -la "$BASE"
