#!/usr/bin/env python3
"""
WoClaw Codex/OpenCode Example

Connects any Python-based coding agent (Codex, OpenCode Python agents, etc.)
to a WoClaw Hub via WebSocket for shared memory and topic messaging.

Usage:
    python3 examples/codex_example.py

Requirements:
    pip install websockets aiohttp

Environment variables:
    WOCLAW_HUB_URL=ws://vm153:8082
    WOCLAW_TOKEN=WoClaw2026
    WOCLAW_AGENT_ID=codex-my-machine
"""

import os
import sys
import json
import asyncio
import websockets
import aiohttp

# ============================================================================
# Configuration
# ============================================================================

HUB_URL = os.environ.get("WOCLAW_HUB_URL", "ws://localhost:8080")
TOKEN = os.environ.get("WOCLAW_TOKEN", "WoClaw2026")
AGENT_ID = os.environ.get("WOCLAW_AGENT_ID", f"codex-{os.uname().nodename()}")
_hub_host = HUB_URL.replace("ws://", "").replace("wss://", "").split(":")[0]
REST_URL = os.environ.get(
    "WOCLAW_REST_URL",
    f"http://{_hub_host}:8083"
)

# ============================================================================
# REST API helpers
# ============================================================================

async def memory_read(key: str) -> dict:
    """Read a value from WoClaw Hub shared memory."""
    async with aiohttp.ClientSession() as session:
        async with session.get(
            f"{REST_URL}/memory/{key}",
            headers={"Authorization": f"Bearer {TOKEN}"},
        ) as resp:
            return await resp.json()


async def memory_write(key: str, value: str) -> dict:
    """Write a value to WoClaw Hub shared memory."""
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{REST_URL}/memory",
            headers={"Authorization": f"Bearer {TOKEN}"},
            json={"key": key, "value": value, "updatedBy": AGENT_ID},
        ) as resp:
            return await resp.json()


async def memory_list() -> dict:
    """List all memory keys on WoClaw Hub."""
    async with aiohttp.ClientSession() as session:
        async with session.get(
            f"{REST_URL}/memory",
            headers={"Authorization": f"Bearer {TOKEN}"},
        ) as resp:
            return await resp.json()


async def topics_list() -> dict:
    """List all topics on WoClaw Hub."""
    async with aiohttp.ClientSession() as session:
        async with session.get(
            f"{REST_URL}/topics",
            headers={"Authorization": f"Bearer {TOKEN}"},
        ) as resp:
            return await resp.json()


async def hub_health() -> dict:
    """Check WoClaw Hub health."""
    async with aiohttp.ClientSession() as session:
        async with session.get(
            f"{REST_URL}/health",
            headers={"Authorization": f"Bearer {TOKEN}"},
        ) as resp:
            return await resp.json()


# ============================================================================
# WebSocket client (for real-time messaging)
# ============================================================================

async def ws_connect():
    """Connect to WoClaw Hub via WebSocket."""
    uri = f"{HUB_URL}?agentId={AGENT_ID}&token={TOKEN}"
    ws = await websockets.connect(uri)
    print(f"[WoClaw] Connected as {AGENT_ID}")
    return ws


async def ws_join_topic(ws, topic: str):
    """Join a topic."""
    await ws.send(json.dumps({"type": "join", "topic": topic}))
    print(f"[WoClaw] Joined topic: {topic}")


async def ws_send_message(ws, topic: str, content: str):
    """Send a message to a topic."""
    await ws.send(json.dumps({"type": "message", "topic": topic, "content": content}))
    print(f"[WoClaw] Sent to {topic}: {content[:50]}...")


# ============================================================================
# Codex integration helpers
# ============================================================================

def get_codex_session_context() -> str:
    """
    Read Codex/OpenCode session context.
    
    For OpenCode, session context is typically stored in:
    - ~/.opencode/sessions/
    - Or extracted from the active session transcript
    
    Returns a summary string of the current session.
    """
    # This is a placeholder - actual implementation depends on
    # Codex/OpenCode's session storage format
    return f"Codex session on {os.uname().nodename()}"


async def save_codex_context_to_hub(key: str = "codex:context"):
    """Save Codex session context to WoClaw Hub."""
    context = get_codex_session_context()
    result = await memory_write(key, context)
    print(f"[WoClaw] Codex context saved: {result}")
    return result


async def load_hub_context_to_codex(key: str = "codex:context"):
    """Load shared context from WoClaw Hub for Codex session."""
    data = await memory_read(key)
    if data.get("exists"):
        print(f"[WoClaw] Loaded context: {data['value'][:100]}...")
        return data["value"]
    print("[WoClaw] No shared context found")
    return None


# ============================================================================
# Main example
# ============================================================================

async def main():
    print(f"WoClaw Codex Example")
    print(f"Hub: {HUB_URL}")
    print(f"Agent: {AGENT_ID}")
    print("-" * 40)

    # Check Hub health
    try:
        health = await hub_health()
        print(f"✅ Hub online — Agents: {health.get('agents', '?')}, Topics: {health.get('topics', '?')}")
    except Exception as e:
        print(f"❌ Hub unreachable: {e}")
        return

    # List memory
    try:
        mem = await memory_list()
        keys = mem.get("keys", [])
        print(f"📝 Memory keys: {keys if keys else '(empty)'}")
    except Exception as e:
        print(f"⚠️  Could not list memory: {e}")

    # List topics
    try:
        topics = await topics_list()
        topic_list = topics.get("topics", [])
        print(f"💬 Topics: {[t['name'] for t in topic_list] if topic_list else '(none)'}")
    except Exception as e:
        print(f"⚠️  Could not list topics: {e}")

    print("-" * 40)
    print("Ready! Use memory_read/memory_write/topics_list in your agent code.")
    print("Or connect via WebSocket for real-time messaging.")


if __name__ == "__main__":
    asyncio.run(main())
