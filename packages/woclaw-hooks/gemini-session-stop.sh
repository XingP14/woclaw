#!/bin/bash
# WoClaw Gemini CLI SessionStop Hook
# Reads session data from Gemini CLI stdin (JSON) and saves summary to WoClaw Hub
#
# Gemini CLI hook mechanism (v0.26.0+):
# - Configure hooks in ~/.gemini/settings.json
# - Hook scripts communicate via stdin/stdout JSON
# - SessionEnd hook receives sessionId + recentInteractions
# - Example settings.json uses SessionEnd entries shaped like:
#   { "matcher": "*", "hooks": [{ "type": "command", "command": "bash /path/to/hook.sh" }] }

# Load env from ~/.woclaw/.env (set by install.js)
if [ -f "$HOME/.woclaw/.env" ]; then
  set -a
  source "$HOME/.woclaw/.env"
  set +a
fi

export WOCLAW_HUB_URL="${WOCLAW_HUB_URL:-http://vm153:8083}"
export WOCLAW_TOKEN="${WOCLAW_TOKEN:-WoClaw2026}"
export WOCLAW_PROJECT_KEY="${WOCLAW_PROJECT_KEY:-project:context}"

# Read Gemini CLI hook event from stdin (JSON)
# Gemini passes: { sessionId, events, recentInteractions }
STDIN_DATA=""
if [ ! -t 0 ]; then
  STDIN_DATA=$(cat)
fi

# Extract session_id if available
SESSION_ID=$(printf '%s' "$STDIN_DATA" | node -e "
const fs = require('fs');
try {
  const d = JSON.parse(fs.readFileSync(0, 'utf8'));
  process.stdout.write(d.sessionId || '');
} catch (e) {}
" 2>/dev/null || echo "")

# Extract recentInteractions for session summary
INTERACTIONS_SUMMARY=$(printf '%s' "$STDIN_DATA" | node -e "
const fs = require('fs');
try {
  const d = JSON.parse(fs.readFileSync(0, 'utf8'));
  const interactions = Array.isArray(d.recentInteractions) ? d.recentInteractions : [];
  const last5 = interactions.slice(-5);
  const lines = last5.map(i => {
    const role = i.role || 'unknown';
    const content = typeof i.content === 'string' ? i.content : JSON.stringify(i.content || '');
    const truncated = content.length > 200 ? content.substring(0, 200) + '...' : content;
    return role + ': ' + truncated;
  });
  process.stdout.write(lines.join('\\n'));
} catch (e) {}
" 2>/dev/null || echo "")

# Also check for CLAUDE.md or .gemini/sessions as fallback
FALLBACK_SUMMARY=""
if [ -z "$INTERACTIONS_SUMMARY" ]; then
  if [ -f "CLAUDE.md" ]; then
    FALLBACK_SUMMARY=$(tail -30 CLAUDE.md 2>/dev/null | node -pe '
const d=require("fs").readFileSync("/dev/stdin","utf8");
console.log(JSON.stringify(d));
' 2>/dev/null || echo '""')
  fi
fi

# Determine what to write
if [ -n "$INTERACTIONS_SUMMARY" ]; then
  WRITE_VALUE=$(printf '%s' "$INTERACTIONS_SUMMARY" | node -e "
const fs = require('fs');
try {
  process.stdout.write(JSON.stringify(fs.readFileSync(0, 'utf8')));
} catch (e) {
  process.stdout.write('\"\"');
}
" 2>/dev/null || echo '""')
elif [ -n "$FALLBACK_SUMMARY" ] && [ "$FALLBACK_SUMMARY" != '""' ]; then
  WRITE_VALUE="$FALLBACK_SUMMARY"
else
  WRITE_VALUE='""'
fi

# Write session summary to WoClaw Hub
RESULT=$(curl -s -X POST \
  -H "Authorization: Bearer $WOCLAW_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"key\":\"$WOCLAW_PROJECT_KEY\",\"value\":$WRITE_VALUE,\"updatedBy\":\"gemini:$SESSION_ID\"}" \
  "$WOCLAW_HUB_URL/memory")

MESSAGE="Context saved to WoClaw Hub"
if [ -n "$RESULT" ]; then
  MESSAGE="$MESSAGE: $RESULT"
fi

HOOK_RESULT=$(node - "$MESSAGE" <<'NODE'
const msg = process.argv[2] || '';
process.stdout.write(JSON.stringify({ decision: 'allow', systemMessage: msg }));
NODE
)

printf '%s\n' "$HOOK_RESULT"
