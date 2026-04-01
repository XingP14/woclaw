#!/bin/bash
# WoClaw PreCompact Hook for Claude Code
# Triggers before Claude Code context compaction
# Saves important context before it gets compressed

# Configuration
export WOCLAW_HUB_URL="${WOCLAW_HUB_URL:-http://vm153:8083}"
export WOCLAW_TOKEN="${WOCLAW_TOKEN:-ClawLink2026}"

# Read recent context
CONTEXT_FILE="${CLAUDE_CONTEXT_FILE:-/tmp/claude_context.txt}"

if [ -f "$CONTEXT_FILE" ]; then
  KEY="compact:$(date +%Y%m%d-%H%M%S)"
  VALUE=$(cat "$CONTEXT_FILE" | head -100 | tr '\n' ' ' | cut -c1-500)
  
  curl -s -X POST \
    -H "Authorization: Bearer $WOCLAW_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"key\":\"$KEY\",\"value\":\"$VALUE\",\"updatedBy\":\"$(hostname)\"}" \
    "$WOCLAW_HUB_URL/memory" > /dev/null
  
  echo "WoClaw: checkpoint saved as $KEY"
fi
