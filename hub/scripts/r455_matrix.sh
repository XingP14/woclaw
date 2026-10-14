#!/usr/bin/env bash
# R455 mutation matrix v3 — 7 mutants against
# test/r455_addpeer_duplicate_guard.test.ts
#
# Rule (R454-M2): two mutations per site, one COARSE and one EXACT, so an inert
# edit cannot masquerade as a survivor. Every mutant asserts its anchor was
# found AND unique, and the mutated FILE's own md5 is printed and compared
# before the suite runs.
#
# Draft-1 and draft-2 lessons (recorded, not smoothed — see commit body):
#   (a) v1: mutate() ignored its file argument and hashed the wrong file, so a
#       rest_server.ts mutation reported "applied ok" against federation.ts's
#       md5. The md5 print caught it.
#   (b) v2 fixed (a) but still hashed only federation.ts, so M5 (rest_server.ts)
#       again looked INERT — this time with rc=0, i.e. the edit genuinely
#       applied. Hashing the MUTATED FILE is the fix; not the constant.
#   (c) v1 M1 was logically EQUIVALENT to baseline (`A || (B && A)` == `A`), so
#       its 10/10 was not a survivor but a vacuous mutant. Replaced with M1' =
#       a real shape change (guard consults configured list only).
#   (d) v2 M4's anchor did not exist (it included a private- modifier line).
#       Anchor corrected to the literal two lines.
#   (e) v3 M4's anchor STILL did not match: a double-quoted bash argument
#       expands ${peer.hubId} inside the template literal before python ever
#       sees it. Lesson: an anchor containing ${...} must live in a file, never
#       in a shell argument. M4 now loads scripts/anchors/m4.py.
set -uo pipefail
cd "$(dirname "$0")/.."
SUITE=test/r455_addpeer_duplicate_guard.test.ts
BASE_FED=$(md5sum src/federation.ts | cut -d' ' -f1)
BASE_REST=$(md5sum src/rest_server.ts | cut -d' ' -f1)
echo "baseline federation.ts=$BASE_FED rest_server.ts=$BASE_REST"

restore() { git checkout -- src/federation.ts src/rest_server.ts; }
md5of() { md5sum "$1" | cut -d' ' -f1; }

mutate() {  # $1=label $2=file $3=old $4=new
  local label="$1" file="$2"
  if ! python3 - "$file" "$3" "$4" <<'PY'
import sys
p, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
assert old in s, "ANCHOR NOT FOUND - mutant would be INERT"
assert s.count(old) == 1, f"anchor not unique ({s.count(old)}) - ambiguous"
open(p, 'w').write(s.replace(old, new))
PY
  then
    echo "MUTANT $label: ANCHOR FAULT - INERT, skipped (not a survivor)"; restore; return 1
  fi
  local base; base=$([ "$file" = src/rest_server.ts ] && echo "$BASE_REST" || echo "$BASE_FED")
  local now; now=$(md5of "$file")
  if [ "$now" = "$base" ]; then
    echo "MUTANT $label: INERT (md5 $now == baseline) - skipped (not a survivor)"; restore; return 1
  fi
  echo "  $label applied to $file, md5 = $now"
}

run() {
  local out
  out=$(npx vitest run "$SUITE" 2>&1 | grep -E "Tests +[0-9]" | tail -1)
  [ -z "$out" ] && out="NO RESULT LINE (harness fault, not a survivor)"
  echo "MUTANT $1: $out"
}

# ---- M1' COARSE: the duplicate guard consults the CONFIGURED list only.
# The shape change that closes the CONNECTING window (C1) and its consequence.
mutate M1 src/federation.ts \
'    if (this.peers.has(peer.hubId)) {' \
'    if ((this.config.federationPeers||[]).some(p => p.hubId === peer.hubId)) {' \
&& run M1; restore

# ---- M2 EXACT, same site: configured list OR connected map (union guard).
mutate M2 src/federation.ts \
'    if (this.peers.has(peer.hubId)) {' \
'    if (this.peers.has(peer.hubId) || (this.config.federationPeers||[]).some(p => p.hubId === peer.hubId && p.status !== '\''connecting'\'')) {' \
&& run M2; restore

# ---- M3: close handler only untracks the socket it actually installed.
mutate M3 src/federation.ts \
'      this.peers.delete(peer.hubId);
      this.stopPing(peer.hubId);
      this.scheduleReconnect(peer);' \
'      const cur = this.peers.get(peer.hubId);
      if (!cur || cur === ws) { this.peers.delete(peer.hubId); this.stopPing(peer.hubId); this.scheduleReconnect(peer); }' \
&& run M3; restore

# ---- M4: the real C2 fix — a CHANGED wsUrl is re-dialed instead of ignored.
# The anchor lives in scripts/anchors/m4.py because its text contains ${...},
# which bash expands inside a double-quoted argument (draft-3 lesson (e)).
if python3 scripts/anchors/m4.py src/federation.ts; then
  echo "  M4 applied to src/federation.ts, md5 = $(md5of src/federation.ts)"
  run M4
else
  echo "MUTANT M4: ANCHOR FAULT - INERT, skipped (not a survivor)"
fi
restore

# ---- M5: the REST route refuses a duplicate hubId with 409 (transport fix).
mutate M5 src/rest_server.ts \
"            this.wsServer?.addFederationPeer?.({ hubId, wsUrl, federationToken, status: 'disconnected', lastSeen: 0, connectedAgents: 0 });" \
"            if ((this.wsServer?.getFederationPeersStatus?.()||[]).some((p: unknown) => (p as {hubId?: string}).hubId === hubId)) { RestServer.sendJsonError(res, 409, 'duplicate hubId'); return; }
            this.wsServer?.addFederationPeer?.({ hubId, wsUrl, federationToken, status: 'disconnected', lastSeen: 0, connectedAgents: 0 });" \
&& run M5; restore

# ---- M6: a pending set keyed by hubId, registered synchronously in addPeer
# and consumed by the close handler. The other idiomatic fix for C1/C3.
mutate M6 src/federation.ts \
'    this.connectToPeer(peer);
  }
}' \
'    (this as unknown as {pending: Set<string>}).pending ??= new Set<string>();
    (this as unknown as {pending: Set<string>}).pending.add(peer.hubId);
    this.connectToPeer(peer);
  }
}' \
&& run M6; restore

# ---- M7: stop() sets a stopped flag the close handler consults — the obvious
# fix for the R418 leak. This suite does NOT claim that leak, so M7 must
# SURVIVE: a scoped survivor proving the suite is not over-claiming.
mutate M7 src/federation.ts \
'  stop(): void {' \
'  stop(): void { (this as unknown as {__stopped: boolean}).__stopped = true;' \
&& run M7; restore

# ---------------------------------------------------------------- round-2
# The v3 header of this suite claimed "6/6 KILLED". Re-running v3 measured
# 3/7: M4 (the url-comparing guard), M5 (REST 409) and M6 (a pending set)
# all SURVIVED. Each was investigated rather than counted:
#
#   M4 is EQUIVALENT BY CONSTRUCTION, not a coverage gap. addPeer() does
#       Object.assign(existing, incoming) BEFORE connectToPeer(incoming), so a
#       guard reading `configuredUrl === incomingUrl` compares the incoming url
#       with ITSELF and the conjunct is a no-op. MEASURED by scripts/r455_probe3.ts:
#       "second conjunct (cfg === incoming) : true ... sockets dialled: 0".
#       A suite arm cannot kill an equivalent mutant, and the honest response is
#       to record WHY it is equivalent -- which is what the two C2 arms below
#       now pin (the ordering, and the config-vs-wire RELATION).
#   M5 (transport-layer 409 in rest_server.ts) and M6 (a pending Set) are
#       ALTERNATIVE FIXES at other layers, out of scope for a suite that pins
#       current behaviour. They are deliberately scoped survivors, like M7.
#
# M8/M9 are the round-2 pair. The rule (R454-M2) applies: one COARSE, one
# EXACT, so an inert edit cannot masquerade as a survivor. Both mutate the
# ORDERING inside addPeer -- the thing the C2 arms actually pin.
#
#   M8 COARSE: dial FIRST, merge AFTER. Now the configured list is still the
#      OLD url when the guard runs, so a url-comparing conjunct WOULD fire.
#      Under this mutant the config-vs-wire RELATION arm goes red.
#   M9 EXACT: merge every field EXCEPT wsUrl. Same observable divergence, a
#      completely different edit shape -- so a suite that only caught M8's
#      line order would miss it.
python3 scripts/anchors/m8.py src/federation.ts \
&& run M8; restore
python3 scripts/anchors/m9.py src/federation.ts \
&& run M9; restore

echo "=== restored ==="
md5sum src/federation.ts src/rest_server.ts
