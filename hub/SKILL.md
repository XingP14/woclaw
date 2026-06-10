---
name: woclaw-hub
description: Self-hosted multi-agent hub for OpenClaw, Claude Code, Gemini CLI, OpenCode, and Codex CLI — provides a shared memory and topic-bus layer over WebSocket + REST, backed by SQLite or MySQL. Compatible with the SKILL.md open format and discoverable on LobeHub, ClawHub, SkillHub, and Anthropic Agent Skills. Use when the user wants to run their own agent relay (Docker, systemd, or `npm`), wire agents to it via `WOCLAW_HUB_URL`, persist `/health` / `/agents` / `/topics` state across agent sessions, or coordinate many agents through a single WebSocket bus.
---

# WoClaw Hub

`woclaw-hub` is the long-lived relay at the heart of the WoClaw ecosystem. It exposes a WebSocket endpoint (`PORT=8082`) for agent connections and a REST API (`REST_PORT=8083`) for hooks, monitoring, and HTTP integrations. Agents publish to **topics** and read/write **memory** entries through it; everything is persisted to SQLite (default) or MySQL so memory survives restarts.

## When to use this skill

Use this skill when:

- The user wants to self-host a WoClaw Hub on their own VPS / homelab / Docker host.
- The user is wiring Claude Code / Gemini CLI / OpenCode / Codex CLI agents (via `woclaw-hooks` / `woclaw-codex` / `opencode-woclaw-plugin`) and needs the backend running first.
- The user asks about `WOCLAW_HUB_URL`, `AUTH_TOKEN`, `/health`, `/agents`, `/topics`, federation, or cron-style auto-extraction.
- The user wants to migrate from in-agent memory to a shared, multi-agent bus.
- The user needs SQLite → MySQL failover or persistent storage for compliance/auditing.

**Do not use** when:

- The user only wants a client-side install of agent hooks — point them to [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) or [`woclaw-codex`](https://www.npmjs.com/package/woclaw-codex) instead.
- The user is using a hosted third-party relay — this skill is about deploying **your own** hub.
- The user wants a Claude Code Skills directory entry with no deploy behavior. This skill IS the deploy guide — for pure discoverability see the README.

## What this skill installs

When you deploy `woclaw-hub`, you get:

| Component | Default | Purpose |
|-----------|---------|---------|
| WebSocket server | `ws://0.0.0.0:8082` | Agent ↔ Hub real-time bus (connect with `?agentId=<id>&token=<token>`) |
| REST API | `http://0.0.0.0:8083` | Hooks, monitoring, CRUD on memory/topics/agents |
| SQLite DB | `/data/woclaw.sqlite` | Default persistence (override with `DB_TYPE=mysql`) |
| Cron scheduler | built-in | Periodic auto-extraction of context from sessions |
| Federation endpoint | REST `/federation/*` | Cross-hub memory replication (optional) |
| Health probe | `GET /health` | Returns `{ status, uptime, agents, topics }` for uptime monitors |

## Install

### Option A — Docker (recommended for production)

```bash
docker pull xingp14/woclaw-hub:latest

docker run -d \
  --name woclaw-hub \
  --restart unless-stopped \
  -p 8082:8082 \
  -p 8083:8083 \
  -v /opt/woclaw/data:/data \
  -e AUTH_TOKEN="$(openssl rand -hex 32)" \
  xingp14/woclaw-hub:latest
```

### Option B — From source (Node ≥18)

```bash
cd hub
npm install
npm run build
AUTH_TOKEN="$(openssl rand -hex 32)" npm start
```

### Option C — systemd unit

A sample `woclaw-hub.service` ships in `hub/`. Copy it to `/etc/systemd/system/`, edit `Environment=AUTH_TOKEN=...`, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now woclaw-hub
sudo systemctl status woclaw-hub
```

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `AUTH_TOKEN` | yes | Shared secret agents present as `?token=` (WS) or `Authorization: Bearer` (REST). Use `openssl rand -hex 32`. |
| `PORT` | no | WebSocket port (default `8082`) |
| `REST_PORT` | no | REST port (default `8083`) |
| `HOST` | no | Bind address (default `0.0.0.0`) |
| `DATA_DIR` | no | Base data dir for SQLite (default `/data`) |
| `DB_TYPE` | no | `sqlite` (default) or `mysql` |
| `MYSQL_*` | conditional | `MYSQL_HOST` / `PORT` / `USER` / `PASSWORD` / `DATABASE` when `DB_TYPE=mysql` |
| `CONFIG_FILE` | no | Path to a JSON config overriding env vars |

## Outputs

- Persistent SQLite file at `$DATA_DIR/woclaw.sqlite` (or remote MySQL DB).
- Logs to stdout in JSON-ish key=value format — pipe to `journalctl` (systemd) or `docker logs woclaw-hub`.
- Health endpoint: `curl http://localhost:8083/health` → `{"status":"ok","uptime":...,"agents":N,"topics":M}`.

## Verification

After deploy, run this 3-step smoke test:

```bash
# 1. Health
curl -fsS http://localhost:8083/health
# expect: {"status":"ok",...}

# 2. WS connect (using `wscat` or any WS client)
wscat -c "ws://localhost:8082?agentId=smoke&token=$AUTH_TOKEN"
# expect: server emits a `welcome` frame

# 3. Write + read memory round-trip
curl -fsS -X POST http://localhost:8083/memory \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key":"smoke","value":"hello","agentId":"smoke"}'
curl -fsS "http://localhost:8083/memory/smoke" \
  -H "Authorization: Bearer $AUTH_TOKEN"
# expect: {"key":"smoke","value":"hello",...}
```

## Failure-modes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `ECONNREFUSED` on 8082/8083 | Hub not running, or `HOST` bound to wrong iface | `docker logs woclaw-hub` or `systemctl status woclaw-hub` |
| `401 Unauthorized` from REST | Wrong / missing `AUTH_TOKEN` | Ensure client and hub share the same token |
| WS connects then immediately closes | `agentId` missing or token mismatch in query string | Reconnect with `?agentId=<id>&token=<token>` |
| `SQLITE_CANTOPEN` | `DATA_DIR` not writable by container | `chown -R 1000:1000 /opt/woclaw/data` and re-run |
| `agents` count stuck at 0 in `/health` | Clients connect but don't heartbeat | Check client lifecycle — most agents heartbeat every 30s |
| MySQL "access denied" | `MYSQL_PASSWORD` not URL-safe or wrong user | Re-issue creds, prefer `MYSQL_PASSWORD_FILE` (docker secret) |
| Federation replication stalls | Clock skew between hubs > 60s | Run `chrony` / `ntpdate` on both hosts |

## Source

- Repo: <https://github.com/XingP14/woclaw/tree/master/hub>
- npm: <https://www.npmjs.com/package/woclaw-hub>
- Docker: <https://hub.docker.com/r/xingp14/woclaw-hub>
- Related skills: [`woclaw-hooks`](https://www.npmjs.com/package/woclaw-hooks) (client installer), [`woclaw-codex`](https://www.npmjs.com/package/woclaw-codex) (Codex CLI), [`opencode-woclaw-plugin`](https://www.npmjs.com/package/opencode-woclaw-plugin) (OpenCode plugin)