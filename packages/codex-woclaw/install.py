#!/usr/bin/env python3
"""
WoClaw Codex CLI Installer

Configures Codex CLI to use WoClaw hooks for shared context across sessions.

Usage:
    python3 install.py [--uninstall]

This script:
1. Creates ~/.codex/hooks/ directory
2. Copies hook scripts to ~/.codex/hooks/
3. Creates ~/.codex/hooks.json with WoClaw hook configuration
4. Enables hooks in ~/.codex/config.toml

Requires: Python 3.8+
"""

import os
import sys
import json
import shutil
import argparse
from pathlib import Path


HOOKS_DIR = Path.home() / ".codex" / "hooks"
HOOKS_JSON = Path.home() / ".codex" / "hooks.json"
CONFIG_TOML = Path.home() / ".codex" / "config.toml"
SCRIPT_DIR = Path(__file__).parent


def ensure_hooks_dir():
    HOOKS_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Created: {HOOKS_DIR}")


def copy_hooks():
    for script in ["session_start.py", "stop.py", "precompact.py"]:
        src = SCRIPT_DIR / script
        if src.exists():
            dst = HOOKS_DIR / script
            shutil.copy2(src, dst)
            os.chmod(dst, 0o755)
            print(f"Copied: {dst}")


def create_hooks_json():
    hooks_config = {
        "hooks": {
            "SessionStart": [
                {
                    "matcher": "startup|resume",
                    "hooks": [
                        {
                            "type": "command",
                            "command": f"python3 {HOOKS_DIR / 'session_start.py'}",
                            "statusMessage": "Loading shared context from WoClaw"
                        }
                    ]
                }
            ],
            "Stop": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": f"python3 {HOOKS_DIR / 'stop.py'}",
                            "timeout": 30,
                            "statusMessage": "Saving session to WoClaw Hub"
                        }
                    ]
                }
            ],
            "PreCompact": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": f"python3 {HOOKS_DIR / 'precompact.py'}",
                            "timeout": 15,
                            "statusMessage": "Saving checkpoint to WoClaw before compaction"
                        }
                    ]
                }
            ]
        }
    }
    with open(HOOKS_JSON, "w") as f:
        json.dump(hooks_config, f, indent=2)
    print(f"Created: {HOOKS_JSON}")


def update_config_toml():
    """Enable hooks feature in config.toml."""
    content = ""
    if CONFIG_TOML.exists():
        content = CONFIG_TOML.read_text()

    if "[features]" in content and "codex_hooks" in content:
        print(f"Hooks already enabled in {CONFIG_TOML}")
        return

    # Append or create config
    addition = (
        "\n[features]\n"
        "codex_hooks = true\n"
    )

    if content.strip():
        if not content.rstrip().endswith("\n"):
            addition = "\n" + addition
        content += addition
    else:
        content = addition

    CONFIG_TOML.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_TOML.write_text(content)
    print(f"Updated: {CONFIG_TOML} (enabled codex_hooks)")


def uninstall():
    """Remove WoClaw hooks from Codex configuration."""
    # Remove hook scripts
    for script in ["session_start.py", "stop.py", "precompact.py"]:
        dst = HOOKS_DIR / script
        if dst.exists():
            dst.unlink()
            print(f"Removed: {dst}")

    # Remove hooks.json
    if HOOKS_JSON.exists():
        try:
            data = json.loads(HOOKS_JSON.read_text())
            if "hooks" in data and (
                "SessionStart" in data["hooks"] or "Stop" in data["hooks"]
            ):
                # Clear WoClaw hooks from the config
                for key in ["SessionStart", "Stop", "PreCompact"]:
                    if key in data["hooks"]:
                        data["hooks"][key] = [
                            h for h in data["hooks"][key]
                            if not any(
                                "woclaw" in str(v).lower()
                                for v in (h.get("command") or "")
                            )
                        ]
                HOOKS_JSON.write_text(json.dumps(data, indent=2))
                print(f"Updated: {HOOKS_JSON} (removed WoClaw hooks)")
        except (json.JSONDecodeError, OSError):
            HOOKS_JSON.unlink()
            print(f"Removed: {HOOKS_JSON}")


def main():
    parser = argparse.ArgumentParser(description="Install WoClaw hooks for Codex CLI")
    parser.add_argument("--uninstall", action="store_true", help="Remove WoClaw hooks")
    args = parser.parse_args()

    if args.uninstall:
        print("Uninstalling WoClaw Codex hooks...")
        uninstall()
        print("Done.")
        return

    print("Installing WoClaw Codex CLI hooks...")
    print(f"Hub: {os.environ.get('WOCLAW_HUB_URL', 'http://vm153:8083')}")
    print(f"Token: {'***' + os.environ.get('WOCLAW_TOKEN', 'WoClaw2026')[-4:]}")
    print()

    ensure_hooks_dir()
    copy_hooks()
    create_hooks_json()
    update_config_toml()

    print()
    print("WoClaw hooks installed!")
    print()
    print("Next steps:")
    print("  1. Start a new Codex session: codex")
    print("  2. On session start, shared context will be loaded from WoClaw Hub")
    print("  3. On session end, your work will be saved to WoClaw Hub")
    print()
    print("Environment variables (optional):")
    print("  WOCLAW_HUB_URL   - Hub REST URL (default: http://vm153:8083)")
    print("  WOCLAW_TOKEN     - Auth token (default: WoClaw2026)")
    print("  WOCLAW_KEY       - Memory key (default: codex:context)")


if __name__ == "__main__":
    main()
