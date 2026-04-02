#!/usr/bin/env python3
"""
WoClaw SessionStart Hook for OpenAI Codex CLI

Reads shared project context from WoClaw Hub when a Codex session starts.
Injects the context as additional developer context for the new session.

Requires: aiohttp, websockets (or use REST for simplicity)

Install:
    python3 session_start.py --install

Environment:
    WOCLAW_HUB_URL  - Hub REST URL (default: http://vm153:8083)
    WOCLAW_TOKEN    - Auth token (default: WoClaw2026)
    WOCLAW_KEY      - Memory key to read (default: codex:context)
"""

import os
import sys
import json
import urllib.request
import urllib.error


HUB_URL = os.environ.get("WOCLAW_HUB_URL", "http://vm153:8083")
TOKEN = os.environ.get("WOCLAW_TOKEN", "WoClaw2026")
MEMORY_KEY = os.environ.get("WOCLAW_KEY", "codex:context")


def read_memory(key: str) -> str | None:
    """Read a value from WoClaw Hub REST API."""
    url = f"{HUB_URL}/memory/{key}"
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {TOKEN}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            if data.get("exists"):
                return data.get("value")
    except urllib.error.URLError:
        pass
    return None


def main():
    # Read hook input from stdin
    try:
        hook_input = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        hook_input = {}

    source = hook_input.get("source", "startup")
    cwd = hook_input.get("cwd", os.getcwd())

    context = read_memory(MEMORY_KEY)

    if context:
        # Emit JSON output to inject as additional context
        output = {
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": f"[WoClaw] Shared project context:\n{context}"
            }
        }
        print(json.dumps(output))
    else:
        # No shared context found — just continue silently
        pass


if __name__ == "__main__":
    main()
