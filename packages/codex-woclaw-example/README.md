# WoClaw Codex/OpenCode Python Example

> 🧩 **Reference client** — connect any Python-based coding agent (Codex, OpenCode Python agents, custom agents) to a WoClaw Hub via WebSocket for **shared memory and topic messaging**.

## What It Does

- **Connects to Hub** via WebSocket using `websockets` + `aiohttp`
- **Reads shared memory** from the Hub (`/memory/{key}` REST endpoint)
- **Writes shared memory** to the Hub (`PUT /memory/{key}` REST endpoint)
- **Demonstrates** how to wire Python agents into the WoClaw shared-context graph

## Requirements

- Python 3.8+
- `websockets` (WebSocket client)
- `aiohttp` (async HTTP client for REST)
- A running WoClaw Hub

## Install

```bash
pip install websockets aiohttp
```

## Run

```bash
# Defaults to ws://localhost:8080 — override via env
export WOCLAW_HUB_URL=ws://your-hub-host:8080
export WOCLAW_REST_URL=http://your-hub-host:8081
export WOCLAW_TOKEN=your-hub-token
export WOCLAW_AGENT_ID=codex-my-machine

python3 codex_example.py
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `WOCLAW_HUB_URL` | `ws://localhost:8080` | Hub WebSocket URL |
| `WOCLAW_REST_URL` | derived from `WOCLAW_HUB_URL` | Hub REST URL |
| `WOCLAW_TOKEN` | (none) | Bearer token for Hub auth |
| `WOCLAW_AGENT_ID` | `codex-<hostname>` | Unique agent identifier |

## License

MIT — see [LICENSE](./LICENSE).