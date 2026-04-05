#!/bin/bash
# WoClaw SessionStart Hook for Claude Code
# Place in ~/.claude/hooks/ or as instructed by Claude Code

# Configuration
export WOCLAW_HUB_URL="${WOCLAW_HUB_URL:-http://vm153:8083}"
export WOCLAW_TOKEN="${WOCLAW_TOKEN:-WoClaw2026}"
export WOCLAW_PROJECT_KEY="${WOCLAW_PROJECT_KEY:-project:context}"

# Read shared project context from WoClaw Hub
echo "=== WoClaw: Loading shared context ==="

CONTEXT=$(curl -s \
  -H "Authorization: Bearer $WOCLAW_TOKEN" \
  "$WOCLAW_HUB_URL/memory/$WOCLAW_PROJECT_KEY")

if [ -n "$CONTEXT" ] && [ "$CONTEXT" != "null" ]; then
  echo "$CONTEXT"
  echo ""
  echo "=== Shared context loaded from WoClaw Hub ==="
else
  echo "=== No shared context found (first session?) ==="
fi
