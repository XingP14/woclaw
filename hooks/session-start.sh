#!/bin/bash
# WoClaw SessionStart Hook for Claude Code
# Place in ~/.claude/hooks/ or as instructed by Claude Code

# Configuration
export CLAWLINK_HUB_URL="${CLAWLINK_HUB_URL:-http://vm153:8083}"
export CLAWLINK_TOKEN="${CLAWLINK_TOKEN:-ClawLink2026}"
export CLAWLINK_PROJECT_KEY="${CLAWLINK_PROJECT_KEY:-project:context}"

# Read shared project context from WoClaw Hub
echo "=== WoClaw: Loading shared context ==="

CONTEXT=$(curl -s \
  -H "Authorization: Bearer $CLAWLINK_TOKEN" \
  "$CLAWLINK_HUB_URL/memory/$CLAWLINK_PROJECT_KEY")

if [ -n "$CONTEXT" ] && [ "$CONTEXT" != "null" ]; then
  echo "$CONTEXT"
  echo ""
  echo "=== Shared context loaded from WoClaw Hub ==="
else
  echo "=== No shared context found (first session?) ==="
fi
