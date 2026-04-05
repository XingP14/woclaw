#!/bin/bash
# WoClaw SessionStart Hook
# Loads shared project context from WoClaw Hub on session start

# Load env from ~/.woclaw/.env (set by install.js)
if [ -f "$HOME/.woclaw/.env" ]; then
  set -a
  source "$HOME/.woclaw/.env"
  set +a
fi

export WOCLAW_HUB_URL="${WOCLAW_HUB_URL:-http://vm153:8083}"
export WOCLAW_TOKEN="${WOCLAW_TOKEN:-WoClaw2026}" # REST API token (Hub uses WoClaw2026)
export WOCLAW_PROJECT_KEY="${WOCLAW_PROJECT_KEY:-project:context}"

echo "=== WoClaw: Loading shared context ($WOCLAW_PROJECT_KEY) ==="

# Fetch from Hub REST API
RAW=$(curl -s \
  -H "Authorization: Bearer $WOCLAW_TOKEN" \
  "$WOCLAW_HUB_URL/memory?key=$WOCLAW_PROJECT_KEY")

# Parse JSON: extract all .value fields from the memory array and join them.
CONTEXT=$(printf '%s' "$RAW" | node -e "
const fs = require('fs');
try {
  const data = JSON.parse(fs.readFileSync(0, 'utf8'));
  const entries = (data.memory || [])
    .filter(m => m.value && m.value.trim())
    .map(m => m.value);
  process.stdout.write(entries.join('\n\n---\n\n'));
} catch (e) {}
" 2>/dev/null)

if [ -n "$CONTEXT" ]; then
  echo "--- Shared context ---"
  echo "$CONTEXT"
  echo "----------------------"
else
  echo "=== No shared context found (first session?) ==="
fi
