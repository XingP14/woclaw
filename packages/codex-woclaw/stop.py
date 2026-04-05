#!/usr/bin/env python3
"""
WoClaw Stop Hook for OpenAI Codex CLI

Writes session summary to WoClaw Hub when a Codex session ends.
Helps preserve discoveries and decisions across sessions.

Install:
    python3 stop.py --install

Environment:
    WOCLAW_HUB_URL  - Hub REST URL (default: http://vm153:8083)
    WOCLAW_TOKEN    - Auth token (default: WoClaw2026)
    WOCLAW_KEY      - Memory key to write (default: codex:context)
"""

import os
import sys
import json
import urllib.request
import urllib.error
from datetime import datetime
from typing import Optional


HUB_URL = os.environ.get("WOCLAW_HUB_URL", "http://vm153:8083")
TOKEN = os.environ.get("WOCLAW_TOKEN", "WoClaw2026")
MEMORY_KEY = os.environ.get("WOCLAW_KEY", "codex:context")


def write_memory(key: str, value: str, hostname: str) -> bool:
    """Write a value to WoClaw Hub REST API."""
    url = f"{HUB_URL}/memory"
    payload = json.dumps({
        "key": key,
        "value": value,
        "updatedBy": f"codex:{hostname}",
        "tags": ["codex", "session-summary"]
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json"
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status == 200
    except urllib.error.URLError:
        return False


def read_transcript(path: Optional[str], max_lines: int = 80) -> Optional[str]:
    """Read the last lines of the session transcript."""
    if not path:
        return None
    try:
        with open(path, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
            return "".join(lines[-max_lines:])
    except (OSError, IOError):
        return None


def main():
    # Read hook input from stdin
    try:
        hook_input = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError):
        hook_input = {}

    session_id = hook_input.get("session_id", "unknown")
    transcript_path = hook_input.get("transcript_path")
    cwd = hook_input.get("cwd", os.getcwd())
    stop_reason = hook_input.get("stopReason", "unknown")
    hostname = os.uname().nodename

    # Read transcript for context
    transcript = read_transcript(transcript_path)

    if transcript:
        # Build a concise session summary
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
        summary = (
            f"[{timestamp}] Codex session ended ({stop_reason})\n"
            f"Session: {session_id}\n"
            f"CWD: {cwd}\n"
            f"---Last transcript excerpt---\n"
            f"{transcript[:1000]}"
        )
        success = write_memory(MEMORY_KEY, summary, hostname)
        if success:
            print(f"[WoClaw] Session summary saved to {MEMORY_KEY}", file=sys.stderr)
        else:
            print(f"[WoClaw] Failed to save session summary", file=sys.stderr)

    # Emit continue response (don't block anything)
    print(json.dumps({"continue": True}))


if __name__ == "__main__":
    main()
