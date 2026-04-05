#!/usr/bin/env python3
"""
WoClaw Hub WebSocket Client Example (Python)
Demonstrates how to connect an agent to the WoClaw Hub using Python's websockets library.

Usage:
    HUB_URL=ws://vm153:8082 \
    AGENT_ID=my-python-agent \
    TOKEN=WoClaw2026 \
    TOPIC=general \
    python3 ws-client.py

Dependencies:
    pip install websockets
"""

import asyncio
import json
import os
import sys

HUB_URL = os.getenv("HUB_URL", "ws://vm153:8082")
REST_URL = os.getenv("REST_URL", "http://vm153:8083")
AGENT_ID = os.getenv("AGENT_ID", "python-client")
TOKEN = os.getenv("TOKEN", "WoClaw2026")
TOPIC = os.getenv("TOPIC", "general")


async def main():
    try:
        import websockets
    except ImportError:
        print("Error: websockets library not found.")
        print("Install it with: pip install websockets")
        sys.exit(1)

    uri = f"{HUB_URL}?agentId={AGENT_ID}&token={TOKEN}"
    print(f"WoClaw WebSocket Client — {AGENT_ID}")
    print(f"Hub: {HUB_URL} | Topic: {TOPIC}")
    print(f"Connecting to {uri}...")

    try:
        async with websockets.connect(uri) as ws:
            print(f"[{AGENT_ID}] Connected to WoClaw Hub")

            # Join a topic
            join_msg = json.dumps({"type": "join", "topic": TOPIC})
            await ws.send(join_msg)
            print(f"[{AGENT_ID}] Joining topic: {TOPIC}")

            # Listen for messages
            async def listen():
                try:
                    async for raw in ws:
                        msg = json.loads(raw)
                        handle_message(msg)
                except websockets.exceptions.ConnectionClosed:
                    print(f"[{AGENT_ID}] Connection closed")

            # Also handle stdin input
            async def send_messages():
                print("Type messages to send, /quit to exit")
                while True:
                    try:
                        line = await asyncio.get_event_loop().run_in_executor(
                            None, sys.stdin.readline
                        )
                        if not line:
                            break
                        content = line.strip()
                        if not content:
                            continue
                        if content == "/quit":
                            await ws.send(json.dumps({"type": "leave", "topic": TOPIC}))
                            print(f"[{AGENT_ID}] Left topic: {TOPIC}")
                            break
                        await ws.send(json.dumps({
                            "type": "message",
                            "topic": TOPIC,
                            "content": content
                        }))
                        print(f"[{AGENT_ID}] Sent: {content}")
                    except EOFError:
                        break

            await asyncio.gather(listen(), send_messages())

    except Exception as e:
        print(f"[{AGENT_ID}] Error: {e}")
        sys.exit(1)


def handle_message(msg):
    msg_type = msg.get("type", "unknown")
    if msg_type == "welcome":
        print(f"[{AGENT_ID}] ✅ Authenticated — agentId: {msg.get('agentId')}, topics: {msg.get('topics')}")
    elif msg_type == "join":
        print(f"[{AGENT_ID}] ✅ Joined topic: {msg.get('topic')}")
        # Auto-send a test message after joining
        print(f"[{AGENT_ID}] (Auto-sending greeting...)")
    elif msg_type == "history":
        count = len(msg.get("messages") or [])
        print(f"[{AGENT_ID}] 📜 History for '{msg.get('topic')}': {count} messages")
        for m in msg.get("messages", []):
            print(f"    <{m.get('from')}> {m.get('content')}")
    elif msg_type == "message":
        if msg.get("from") == AGENT_ID:
            return  # Skip own messages
        print(f"[{AGENT_ID}] 📩 {msg.get('topic')}: <{msg.get('from')}> {msg.get('content')}")
    elif msg_type == "agents":
        print(f"[{AGENT_ID}] 👥 Agents in {msg.get('topic')}: {msg.get('agents')}")
    elif msg_type == "pong":
        pass  # Keepalive response, ignore
    else:
        print(f"[{AGENT_ID}] ℹ️  Received: {json.dumps(msg)}")


if __name__ == "__main__":
    asyncio.run(main())
