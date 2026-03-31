#!/bin/bash
# WoClaw SessionStop Hook for Claude Code
# Place in ~/.claude/hooks/ or as instructed by Claude Code

# Configuration
export CLAWLINK_HUB_URL="${CLAWLINK_HUB_URL:-http://vm153:8083}"
export CLAWLINK_TOKEN="${CLAWLINK_TOKEN:-ClawLink2026}"
export CLAWLINK_PROJECT_KEY="${CLAWLINK_PROJECT_KEY:-project:context}"

# Collect session summary from CLAUDE.md if it exists
if [ -f "CLAUDE.md" ]; then
  SESSION_SUMMARY=$(tail -50 CLAUDE.md 2>/dev/null || echo "")
fi

# Write project context back to WoClaw Hub
# This preserves what was learned during this session
echo "=== WoClaw: Saving session context ==="

RESULT=$(curl -s -X POST \
  -H "Authorization: Bearer $CLAWLINK_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"key\":\"$CLAWLINK_PROJECT_KEY\",\"value\":\"$SESSION_SUMMARY\",\"updatedBy\":\"$(hostname)\"}" \
  "$CLAWLINK_HUB_URL/memory")

echo "Context saved to WoClaw Hub: $RESULT"
