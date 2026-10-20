#!/usr/bin/env bash
# R480 mutation matrix. OWNED files declared explicitly; asserted clean BEFORE
# injection; byte-snapshot restore per arm, immediately after the run (R477).
set -u
cd "$(dirname "$0")/.."

OWNED=(src/ws_server.ts src/rest_server.ts src/agent_stream.ts src/db.ts src/scheduler.ts)
SNAP=/root/.hermes/cache/scratch/r480_snap
mkdir -p "$SNAP"

echo "== pre-flight: OWNED files must be CLEAN =="
# The preflight's file list is DERIVED from OWNED, not written out again.
# It used to be a second, hand-maintained list of the same four paths — and
# when OWNED grew (scheduler.ts, for the M5 repair arm), the preflight kept
# checking the OLD four. A guard that checks a different set than the thing
# it guards is a decoration: the new OWNED file would have been mutated with
# no preflight covering it.
PREFLIGHT_PATHS=()
for f in "${OWNED[@]}"; do PREFLIGHT_PATHS+=("hub/$f"); done
if ! git -C .. diff --quiet -- "${PREFLIGHT_PATHS[@]}"; then
  echo "ABORT: dirty OWNED file"; git -C .. diff --stat -- "${PREFLIGHT_PATHS[@]}"; exit 2
fi
for f in "${OWNED[@]}"; do cp -p "$f" "$SNAP/$(basename "$f")"; done
echo "pre-flight OK (0 production bytes will be left changed)"

restore() { for f in "${OWNED[@]}"; do cp -p "$SNAP/$(basename "$f")" "$f"; done; }
verify()  { for f in "${OWNED[@]}"; do
  if cmp -s "$SNAP/$(basename "$f")" "$f"; then echo "    restore OK $f"; else echo "    RESTORE MISMATCH $f"; fi; done; }

run() { node_modules/.bin/vitest run test/r480_bounded_execution.test.ts 2>&1 | grep -E "^ +Tests +" | tail -1; }

echo; echo "== CONTROL (unmutated) =="
CONTROL=$(run); echo "  $CONTROL"

echo; echo "== M1 REPAIR F1: cap the event array in the validator =="
python3 - <<'PY'
p='src/agent_stream.ts'
s=open(p).read()
old="  // Walk events checking per-event invariants + result-last rule\n"
assert s.count(old)==1, s.count(old)
s=s.replace(old, old+"  if (envelope.events.length > 1000) issues.push({ code: 'start_missing', event_index: 0, detail: 'too many events' });\n")
open(p,'w').write(s)
PY
echo "  $(run)"; restore; verify

echo; echo "== M2 REPAIR F2: choose a maxPayload =="
python3 - <<'PY'
p='src/ws_server.ts'
s=open(p).read()
old="new WebSocketServer({ server })"
assert s.count(old)==1, s.count(old)
s=s.replace(old,"new WebSocketServer({ server, maxPayload: 1024 * 1024 })")
open(p,'w').write(s)
PY
echo "  $(run)"; restore; verify

echo; echo "== M3 REPAIR F3: cap readJsonBody =="
# ⚠ MEASURED (2026-10-20): this arm SURVIVED on its first run, and the
# survival is a REAL DEFECT IN THE SUITE, not in the repair.
#
# F3.1 asserts on the SHAPE of the source text:
#     expect(fn![0]).not.toMatch(/maxBody|maxBytes|limit|LIMIT|content-length/i)
# A real byte cap written as `const MAX = 1*1024*1024; ... if (body.length > MAX)`
# contains NONE of those words — `MAX` is not `maxBody`, `limit` is not there.
# So the suite's "the body helper is uncapped" arm is a VOCABULARY detector:
# it fires on the absence of a word, not on the absence of a bound. A repair
# that caps the body using different spelling is invisible to it.
#
# This is the shape-detector vs effect-detector split (R475-1). The arm below
# is now the EFFECT arm: it caps the body AND is spelled so F3.1 sees it, and
# the arm after it caps the body with an INDEPENDENT spelling, which MUST
# still turn the suite red. If the second one survives, the suite is pinned
# to vocabulary and R480's F3 finding is overstated.
python3 - <<'PY'
p='src/rest_server.ts'
s=open(p).read()
old="    let body = '';\n    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });\n"
assert s.count(old)==1, s.count(old)
s=s.replace(old,"    let body = '';\n    const maxBytes = 1 * 1024 * 1024;\n    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); if (body.length > maxBytes) { req.destroy(); } });\n")
open(p,'w').write(s)
PY
echo "  $(run)"; restore; verify

echo; echo "== M3b REPAIR F3, INDEPENDENT SPELLING (must ALSO go red) =="
# The orthogonality arm. Same repair, different words. If F3.1 is a
# vocabulary pin, M3b SURVIVES and the suite is measuring spelling.
python3 - <<'PY'
p='src/rest_server.ts'
s=open(p).read()
old="    let body = '';\n    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });\n"
assert s.count(old)==1, s.count(old)
s=s.replace(old,"    let body = '';\n    const CEILING = 1 * 1024 * 1024;\n    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); if (body.length > CEILING) { req.destroy(); } });\n")
open(p,'w').write(s)
PY
echo "  $(run)"; restore; verify

echo; echo "== M3c REPAIR F3, a THIRD spelling: body.length compared inline =="
python3 - <<'PY'
p='src/rest_server.ts'
s=open(p).read()
old="    let body = '';\n    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); });\n"
assert s.count(old)==1, s.count(old)
s=s.replace(old,"    let body = '';\n    req.on('data', (chunk: Buffer) => { body += chunk.toString('utf8'); if (body.length > 1024 * 1024) { req.destroy(); } });\n")
open(p,'w').write(s)
PY
echo "  $(run)"; restore; verify

echo; echo "== M4 F4.loop control: inject a REAL repeat detector (must go red) =="
python3 - <<'PY'
p='src/ws_server.ts'
s=open(p).read()
old="  private checkRateLimit(agentId: string)"
assert s.count(old)==1, s.count(old)
s=s.replace(old,"  private lastSeenCall: string | undefined;\n\n"+old)
open(p,'w').write(s)
PY
echo "  $(run)"; restore; verify

echo; echo "== M5 REPAIR F4.tool_call: a production reader of tool_call events (must go red) =="
# ⚠ MEASURED (2026-10-20): this arm SURVIVED on its first run, and the
# survival was the ARM's fault, not the suite's.
#
# F4.tool_call computes:
#     const readers = CENSUS_FILES.filter(f => f !== 'agent_stream.ts')
#                           .filter(f => /tool_call/.test(src(f)));
# A reader added INSIDE agent_stream.ts is EXCLUDED by construction — the
# suite's subject is "a reader OUTSIDE the taxonomy file", so a reader in
# agent_stream.ts is not the subject. The original M5 injected the reader
# into agent_stream.ts and therefore tested a subject the arm does not cover.
#
# The repair must live in a DIFFERENT census file. scheduler.ts is the
# natural home: it is the component that would observe a looping agent.
python3 - <<'PY'
p='src/scheduler.ts'
s=open(p).read()
import re
# scheduler.ts does NOT import AGENT_STREAM_EVENTS, so anchor on its own
# import of the logging helper — a line that is present and unique.
m=re.search(r"^import \{ schedLog, schedWarn, schedError \} from './scheduler_log\.js';$", s, re.M)
assert m, "could not find an anchor in scheduler.ts"
anchor=m.group(0)
assert s.count(anchor)==1, s.count(anchor)
s=s.replace(anchor, anchor+"\n\n// R480 probe: a production reader of tool_call events\nexport function loopSignature(evs: Array<{ event: string }>): string[] {\n  return evs.filter(e => e.event === 'tool_call').map(e => JSON.stringify(e));\n}")
open(p,'w').write(s)
PY
echo "  $(run)"; restore; verify

echo; echo "== M5b NEGATIVE: the reader in agent_stream.ts itself (must SURVIVE) =="
# The control for M5's subject definition. The suite says the subject is a
# reader OUTSIDE agent_stream.ts, so a reader INSIDE it must NOT turn the
# suite red. If this arm went red, the suite's subject set would be
# "any tool_call reader anywhere", and M5's placement would be wrong.
python3 - <<'PY'
p='src/agent_stream.ts'
s=open(p).read()
old="export const AGENT_STREAM_EVENTS"
assert s.count(old)==1, s.count(old)
s=s.replace(old,"export function loopSignature(evs: StreamEvent[]): string[] {\n  return evs.filter(e => e.event === 'tool_call').map(e => JSON.stringify(e));\n}\n\n"+old)
open(p,'w').write(s)
PY
echo "  $(run)"; restore; verify

echo; echo "== M6 NEGATIVE control: pure rename, zero behaviour change (expect SURVIVED) =="
python3 - <<'PY'
p='src/agent_stream.ts'
s=open(p).read()
old="let resultSeenAt: number | undefined;"
assert s.count(old)==1, s.count(old)
s=s.replace(old,"let resultSeenIdx: number | undefined;")
s=s.replace("resultSeenAt","resultSeenIdx")
open(p,'w').write(s)
PY
echo "  $(run)"; restore; verify

echo; echo "== final: OWNED files byte-identical to snapshot =="
verify
git -C .. diff --stat -- hub/src/ws_server.ts hub/src/rest_server.ts hub/src/agent_stream.ts hub/src/db.ts | tail -2
echo "matrix complete"
