#!/bin/bash
# WoClaw Gemini CLI SessionStart Hook
# Loads shared project context from WoClaw Hub when Gemini CLI session starts
#
# Gemini CLI hook mechanism (v0.26.0+):
# - Configure hooks in ~/.gemini/settings.json
# - Hook scripts communicate via stdin/stdout
# - Example settings.json: { "hooks": { "sessionStart": "bash /path/to/hook.sh" } }

# Load env from ~/.woclaw/.env (set by install.js)
if [ -f "$HOME/.woclaw/.env" ]; then
  set -a
  source "$HOME/.woclaw/.env"
  set +a
fi

export WOCLAW_HUB_URL="${WOCLAW_HUB_URL:-http://vm153:8083}"
export WOCLAW_TOKEN="${WOCLAW_TOKEN:-WoClaw2026}"
export WOCLAW_PROJECT_KEY="${WOCLAW_PROJECT_KEY:-project:context}"

# Read Gemini CLI hook input from stdin if available (JSON format)
if [ ! -t 0 ]; then
  cat > /dev/null  # consume stdin but don't process Gemini's JSON for now
fi

# Fetch shared context from WoClaw Hub REST API
RAW=$(curl -s \
  -H "Authorization: Bearer $WOCLAW_TOKEN" \
  "$WOCLAW_HUB_URL/memory?key=$WOCLAW_PROJECT_KEY")

# Parse JSON: extract all .value fields and join with separators
COUNT=$(echo "$RAW" | node -pe "
try {
  const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  if (!data.memory) { process.stdout.write('0'); return; }
  const count = data.memory.filter(m => m.value && m.value.trim()).length;
  process.stdout.write(String(count));
} catch(e) { process.stdout.write('0'); }
" 2>/dev/null || echo "0")

if [ "$COUNT" -gt 0 ]; then
  echo ""
  echo "=== WoClaw: Shared project context ($WOCLAW_PROJECT_KEY, $COUNT entries) ==="
  echo "$RAW" | node -pe "
try {
  const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const entries = (data.memory || [])
    .filter(m => m.value && m.value.trim())
    .map(m => m.value);
  console.log(entries.join('\n\n---\n\n'));
} catch(e) {}
"
  echo "============================================================"
else
  echo ""
  echo "=== WoClaw: No shared context found (first session?) ==="
fi
