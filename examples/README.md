# woclaw-examples

Example clients for [WoClaw Hub](https://github.com/XingP14/woclaw) — shared
memory and messaging hub for AI agents (Claude, Codex, OpenCode, etc.).

## Install

```bash
npm install
```

## WebSocket client (`ws-client.mjs`)

Node.js WebSocket client that connects to a running WoClaw Hub, subscribes
to a topic, and prints inbound messages. Useful for smoke-testing your hub
after `npm run start --workspace=hub`.

```bash
WS_URL=ws://localhost:8083 HUB_TOKEN=change-me node ws-client.mjs
```

## Python WebSocket client (`ws-client.py`)

Python counterpart of `ws-client.mjs`, useful for Codex/OpenCode agents
that prefer Python.

```bash
WS_URL=ws://localhost:8083 HUB_TOKEN=change-me python3 ws-client.py
```

## Notes

- Both clients send an `auth` frame on connect with `{"token": HUB_TOKEN}`.
- Inbound messages are JSON `{"topic": "...", "data": {...}}` envelopes.
- Set `WS_URL` to your hub address (default `ws://localhost:8083`).

## License

MIT — see [LICENSE](./LICENSE).
