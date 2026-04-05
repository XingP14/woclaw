#!/bin/bash
# WoClaw SessionStop Hook for OpenAI Codex CLI
# Reads session data from Codex stdin (JSON) and saves summary to WoClaw Hub

# Load env from ~/.woclaw/.env (set by install.js)
if [ -f "$HOME/.woclaw/.env" ]; then
  set -a
  source "$HOME/.woclaw/.env"
  set +a
fi

export WOCLAW_HUB_URL="${WOCLAW_HUB_URL:-http://vm153:8083}"
export WOCLAW_TOKEN="${WOCLAW_TOKEN:-WoClaw2026}"
export WOCLAW_PROJECT_KEY="${WOCLAW_PROJECT_KEY:-project:context}"

echo "=== WoClaw [Codex]: Saving session context ==="

# Read Codex hook event from stdin (JSON)
# Codex passes: { session_id, transcript_path, cwd, hook_event_name, model }
STDIN_DATA=""
if [ ! -t 0 ]; then
  STDIN_DATA=$(cat)
fi

# Extract session_id if available
SESSION_ID=$(printf '%s' "$STDIN_DATA" | node -e "const fs=require('fs');try{const d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(d.session_id||'');}catch(e){}" 2>/dev/null || echo "")

# Try to extract a summary from the transcript if provided
SUMMARY='""'
TRANSCRIPT_PATH=$(printf '%s' "$STDIN_DATA" | node -e "const fs=require('fs');try{const d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(d.transcript_path||'');}catch(e){}" 2>/dev/null || echo "")

if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
  # Get last 30 lines of transcript as session summary
  SUMMARY=$(tail -30 "$TRANSCRIPT_PATH" 2>/dev/null | node -e "
const fs = require('fs');
try {
  const lines = fs.readFileSync(0, 'utf8').split('\n').filter(l => l.trim());
  const summary = lines.slice(-20).join('\n');
  process.stdout.write(JSON.stringify(summary));
} catch (e) {
  process.stdout.write('\"\"');
}
" 2>/dev/null || echo '""')
fi

# Also check for CLAUDE.md or session logs
if [ "$SUMMARY" = '""' ] && [ -f "CLAUDE.md" ]; then
  SUMMARY=$(tail -30 CLAUDE.md 2>/dev/null | node -e 'const fs=require("fs");try{process.stdout.write(JSON.stringify(fs.readFileSync(0,"utf8")));}catch(e){process.stdout.write("\"\"");}' 2>/dev/null || echo '""')
fi

# Write session summary to WoClaw Hub
RESULT=$(curl -s -X POST \
  -H "Authorization: Bearer $WOCLAW_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"key\":\"$WOCLAW_PROJECT_KEY\",\"value\":$SUMMARY,\"updatedBy\":\"codex:$SESSION_ID\"}" \
  "$WOCLAW_HUB_URL/memory")

echo "Context saved to WoClaw Hub: $RESULT"
