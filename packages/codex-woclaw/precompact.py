#!/usr/bin/env python3
"""
WoClaw PreCompact Hook for OpenAI Codex CLI
Triggers before Codex context compaction.
Saves critical project context to WoClaw Hub before it gets compressed.

Environment variables:
  WOCLAW_HUB_URL  - WoClaw Hub REST API URL (default: http://vm153:8083)
  WOCLAW_TOKEN    - Hub auth token (default: WoClaw2026)
  WOCLAW_PROJECT_KEY - Memory key prefix (default: project:context)
"""

import os
import sys
import json
import urllib.request
import urllib.error
from datetime import datetime

def main():
    hub_url = os.environ.get("WOCLAW_HUB_URL", "http://vm153:8083")
    token = os.environ.get("WOCLAW_TOKEN", "WoClaw2026")
    project_key = os.environ.get("WOCLAW_PROJECT_KEY", "project:context")

    # Try to read Codex context from common locations
    context_content = ""
    context_file = os.environ.get("CODEX_CONTEXT_FILE", "")

    if context_file and os.path.isfile(context_file):
        with open(context_file, "r", encoding="utf-8", errors="replace") as f:
            context_content = f.read()
    else:
        # Scan typical Codex session dirs
        for search_path in [
            os.path.expanduser("~/.codex/sessions"),
            "/tmp",
        ]:
            if not os.path.isdir(search_path):
                continue
            try:
                files = sorted(
                    [f for f in os.listdir(search_path) if f.endswith(".jsonl")],
                    key=lambda f: os.path.getmtime(os.path.join(search_path, f)),
                    reverse=True,
                )
                if files:
                    latest = os.path.join(search_path, files[0])
                    with open(latest, "r", encoding="utf-8", errors="replace") as f:
                        lines = f.readlines()
                        # Last 30 lines = most recent context before compaction
                        recent = lines[-30:] if len(lines) > 30 else lines
                        context_content = "".join(recent)
                    break
            except Exception:
                pass

    if not context_content:
        print("[WoClaw/Codex] PreCompact: no context found, skipping")
        return

    # Trim to avoid oversized payloads
    context_content = context_content[:4000]

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    key = f"compact:{project_key}:{timestamp}"

    payload = json.dumps({
        "key": key,
        "value": context_content,
        "updatedBy": "codex",
        "tags": ["compact", "codex"],
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{hub_url}/memory",
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                print(f"[WoClaw/Codex] PreCompact: checkpoint saved as {key}")
            else:
                print(f"[WoClaw/Codex] PreCompact: unexpected status {resp.status}")
    except urllib.error.URLError as e:
        print(f"[WoClaw/Codex] PreCompact: failed to connect to WoClaw Hub: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
