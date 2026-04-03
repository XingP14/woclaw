#!/bin/bash
# WoClaw Gemini CLI SessionStop Hook
# Reads session data from Gemini CLI stdin (JSON) and saves summary to WoClaw Hub
#
# Gemini CLI hook mechanism (v0.26.0+):
# - Configure hooks in ~/.gemini/settings.json
# - Hook scripts communicate via stdin/stdout JSON
# - SessionEnd hook receives sessionId + recentInteractions

# Load env from ~/.woclaw/.env (set by install.js)
if [ -f "$HOME/.woclaw/.env" ]; then
  set -a
  source "$HOME/.woclaw/.env"
  set +a
fi

export WOCLAW_HUB_URL="${WOCLAW_HUB_URL:-http://vm153:8083}"
export WOCLAW_TOKEN="${WOCLAW_TOKEN:-WoClaw2026}"
export WOCLAW_PROJECT_KEY="${WOCLAW_PROJECT_KEY:-project:context}"

echo "=== WoClaw [Gemini]: Saving session context ==="

# Read Gemini CLI hook event from stdin (JSON)
# Gemini passes: { sessionId, events, recentInteractions }
STDIN_DATA=""
if [ ! -t 0 ]; then
  STDIN_DATA=$(cat)
fi

# Extract session_id if available
SESSION_ID=$(echo "$STDIN_DATA" | node -pe "
try {
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  console.log(d.sessionId || '');
} catch(e) { console.log(''); }
" 2>/dev/null || echo "")

# Extract recentInteractions for session summary
INTERACTIONS_SUMMARY=$(echo "$STDIN_DATA" | node -pe "
try {
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const interactions = d.recentInteractions || [];
  if (interactions.length === 0) {
    console.log('');
    return;
  }
  // Build a summary from last few interactions
  const last5 = interactions.slice(-5);
  const lines = last5.map(i => {
    const role = i.role || 'unknown';
    const content = typeof i.content === 'string' ? i.content : JSON.stringify(i.content || '');
    const truncated = content.length > 200 ? content.substring(0, 200) + '...' : content;
    return role + ': ' + truncated;
  });
  console.log(lines.join('\\n'));
} catch(e) { console.log(''); }
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
  WRITE_VALUE=$(echo "$INTERACTIONS_SUMMARY" | node -pe "
const lines = require('fs').readFileSync('/dev/stdin','utf8').split('\n').filter(l=>l.trim());
console.log(JSON.stringify(lines.join('\n')));
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

echo "Context saved to WoClaw Hub: $RESULT"
