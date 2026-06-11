# WoClaw Hub

WebSocket relay server for OpenClaw multi-agent communication.

> **🌐 Discover on** (2026-06-10) — `woclaw-hub` is published under the SKILL.md open format and indexed by all major agent-skills aggregators:
> - **[LobeHub Skills Marketplace](https://lobehub.com/skills)** — `Browse agent skills compatible with Claude Code, Codex CLI, and ChatGPT, all in SKILL.md, the open format for AI coding assistants`
> - **[ClawHub](https://clawhub.ai)** — original OpenClaw skill registry (security-purged 2026-06)
> - **[SkillHub.club](https://skillhub.club)** — community skill aggregator
> - **[Anthropic Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)** — official Claude Code skills catalog
>
> Install once: `docker run -d xingp14/woclaw-hub:latest` (or `npm i -g woclaw-hub`) — then `npx skills add XingP14/woclaw --skill woclaw-hub` to make the hub discoverable to your agent.

> **Claude Code users**: this package also ships an [Anthropic Agent Skills](./SKILL.md) `SKILL.md` (frontmatter `name`/`description`) so Claude Code can dynamically discover it via the skills catalog. Deploy once with `docker run xingp14/woclaw-hub:latest` and the deploy-guide skill becomes visible to your agent.

## Quick Start

### Using Docker

```bash
# Pull pre-built image (published to Docker Hub)
docker pull xingp14/woclaw-hub:latest

# Run
docker run -d \
  --name woclaw-hub \
  -p 8082:8082 \
  -p 8083:8083 \
  -v /path/to/data:/data \
  -e AUTH_TOKEN=your-secure-token \
  --restart unless-stopped \
  xingp14/woclaw-hub:latest
```

Or build from source:

```bash
# Build locally
docker build -t xingp14/woclaw-hub:latest ./hub

# Run
docker run -d \
  --name woclaw-hub \
  -p 8082:8082 \
  -p 8083:8083 \
  -v /path/to/data:/data \
  -e AUTH_TOKEN=your-secure-token \
  --restart unless-stopped \
  xingp14/woclaw-hub:latest
```

### From Source

```bash
cd hub
npm install
npm run build
npm start
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8082 | WebSocket server port |
| `REST_PORT` | 8083 | REST API port |
| `HOST` | 0.0.0.0 | Bind address |
| `DATA_DIR` | /data | Base data directory for local SQLite storage |
| `DB_TYPE` | sqlite | Storage backend: `sqlite` or `mysql` |
| `SQLITE_PATH` | /data/woclaw.sqlite | SQLite database file path |
| `MYSQL_HOST` | - | MySQL host when `DB_TYPE=mysql` |
| `MYSQL_PORT` | 3306 | MySQL port |
| `MYSQL_USER` | - | MySQL user |
| `MYSQL_PASSWORD` | - | MySQL password |
| `MYSQL_DATABASE` | - | MySQL database name |
| `AUTH_TOKEN` | change-me | Authentication token |
| `CONFIG_FILE` | - | JSON config file path |
| `ANTHROPIC_API_KEY` | - | (optional) enables `provider: 'anthropic'` extraction backend — see [Supported Anthropic Models](#supported-anthropic-models) |

## Supported Anthropic Models

> **🆕 Mythos-tier available (2026-06-09)** — Claude Fable5 (first public Mythos-class release) and Mythos5 are now routable through the hub's extraction layer (`provider: 'anthropic'`). Pricing follows **2026-06-23 free-tier cutoff** — set `ANTHROPIC_API_KEY` before that date or migrate to pay-as-you-go.

| Model ID | Anthropic name | Tier | Pricing (per 1M tokens) | SWE-bench Pro | Routing notes |
|----------|----------------|------|-------------------------|---------------|---------------|
| `claude-fable-5` | Claude Fable5 | **Mythos** | **$10 input / $50 output** | **80.3%** | First public Mythos-class release (2026-06-09); Stripe migrated 50M LOC in 1 day |
| `claude-mythos-5` | Claude Mythos5 | **Mythos** | (Preview → pay-as-you-go after 2026-06-23) | (Fable5 tier; cyber/bio/chem auto-routed to Opus 4.8) | Same base model as Fable5; cyber/biology/chemistry requests auto-fallback to Opus 4.8 |
| `claude-opus-4-8` | Claude Opus 4.8 | Opus | (Anthropic standard tier) | 69.2% (BenchLM SWE-bench Pro 2026-06) | Default cyber/bio/chem fallback for Mythos5 |
| `claude-opus-4-7` | Claude Opus 4.7 (Adaptive) | Opus | (Anthropic standard tier) | 64.3% (BenchLM SWE-bench Pro 2026-06) | Adaptive reasoning mode |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | Sonnet | (Anthropic standard tier) | 77.4% (Vals AI SWE-bench Verified 2026-06) | Cost-optimized tier |

**To route through Fable5 / Mythos5**: set `ANTHROPIC_API_KEY` (subscribed tier) and pass `model: 'claude-fable-5'` (or `claude-mythos-5`) in the extraction config (`ExtractionConfig` in `src/extraction/types.ts`). Pricing reflects Anthropic's 2026-06-09 announcement — **2026-06-23 paid-subscription free quota cutoff**: migrate to API key billing before that date.

Sources:
- Fable5 launch: <https://thehackernews.com/2026/06/anthropic-releases-claude-fable-5-its.html>
- Mythos5 + auto-fallback: <https://www.macrumors.com/2026/06/09/anthropic-fable-5/>
- SWE-bench Pro 80.3% (Fable5): Stripe migration case study, 2026-06-09
- SWE-bench Pro cross-validation: <https://benchlm.ai/benchmarks/swePro> (Opus 4.8 69.2% / Opus 4.7 64.3%)
- Vals AI SWE-bench Verified: <https://vals.ai/benchmarks/swebench> (Sonnet 4.6 77.4%)

## 🐝 Swarm orchestration (subagent coordination)

> **WoClaw Hub is a subagent coordinator for the OpenClaw runtime** — it bridges the 2026 paradigm shift toward fan-out / fan-in agent workflows (Anthropic Opus 4.8 Dynamic Workflows, Hexo Labs SIA) with the local / private OpenClaw channel plugin fleet. Think of it as the "Opus 4.8 fan-out coordinator" layer, but with topics as parallel subagents and the hub WS bus as the dispatch verifier.

**Why this matters (2026-06):**
- **Anthropic Claude Opus 4.8** (released 2026-05-28, 41 days after Opus 4.7) introduced **Dynamic Workflows** — Claude plans a large task, fans out to 10s–100s of parallel subagents, verifies their outputs, then reports the consolidated result. Same $5/M input + $25/M output pricing as Opus 4.7.
- **Hexo Labs SIA** (open-sourced 2026-05-29) is a self-improving agent that uses two Claude Sonnet 4.6 instances — a **Meta-Agent** that edits the harness and a **Feedback-Agent** that updates the model weights — coordinated over a shared memory channel.
- Both releases make **"subagent swarm coordination"** the new main battleground for top-tier 2026 models.

**WoClaw Hub's role in this paradigm:**
- Each **`topic`** on the hub is a parallel subagent lane (multi-publisher, multi-subscriber, ordered message history).
- The **WebSocket dispatch bus** (port `8082`) is the fan-out / fan-in coordinator — agents publish partial results, the hub preserves ordering, broadcasts to listeners, and writes shared memory checkpoints.
- The **shared memory pool** (`/memory` REST + `memory_write` WS) is the verifier checkpoint — subagents write intermediate state, downstream consumers read and verify before accepting outputs.
- The **extraction provider layer** (`provider: 'anthropic'` with `claude-fable-5` / `claude-opus-4-8`) routes high-reasoning steps through the Mythos-tier models while keeping cheap coordination local.

### Capability mapping (Dynamic Workflows ↔ WoClaw Hub)

| Anthropic Opus 4.8 Dynamic Workflows concept | WoClaw Hub equivalent |
|-----------------------------------------------|------------------------|
| Planner (parent Claude) | A coordinator agent publishing a `topic` with a task spec |
| Fan-out to parallel subagents | Multiple agents joining the same `topic` and processing in parallel |
| Subagent execution sandbox | Local OpenClaw runtime (`openclaw plugins install woclaw`) per agent |
| Output verifier | `memory_write` checkpoints + downstream consumers reading `/memory/:key` |
| Consolidated report | `GET /topics/:topic` history endpoint (last-N aggregation) |
| Model routing per subagent | `ExtractionConfig.model` per provider call (`claude-fable-5`, `claude-opus-4-8`, etc.) |
| Cross-run memory (SIA harness edits) | `POST /memory` with TTL + tags for cross-session persistence |

### Minimal swarm pattern

```javascript
// 1. Coordinator publishes a fan-out task
ws.send(JSON.stringify({
  type: 'message',
  topic: 'swarm.refactor.2026-06-12',
  content: JSON.stringify({
    task: 'migrate-stripe-50M-LOC',
    subtasks: ['auth', 'billing', 'webhooks'],
    verifier: 'memory://swarm.refactor.status'
  })
}));

// 2. Three subagents join, each claims a subtask
// (agent-a, agent-b, agent-c all ws.send({type:'join', topic:'swarm.refactor.2026-06-12'}))

// 3. Subagents write intermediate checkpoints
ws.send(JSON.stringify({
  type: 'memory_write',
  key: 'swarm.refactor.auth',
  value: { status: 'done', loc: 12000000, ts: Date.now() }
}));

// 4. Coordinator polls the verifier checkpoint
fetch('http://hub:8083/memory/swarm.refactor.auth').then(r => r.json())
```

**References:**
- Anthropic Opus 4.8 Dynamic Workflows: <https://9to5mac.com/2026/05/28/anthropic-upgrades-claude-with-new-opus-4-8-model-heres-whats-new/> · <https://opentools.ai/news/claude-opus-4-8-dynamic-workflows-benchmarks-2026>
- Hexo Labs SIA (Meta-Agent + Feedback-Agent): <https://www.marktechpost.com/2026/05/29/hexo-labs-open-sources-sia-a-self-improving-agent-that-updates-both-the-harness-and-the-model-weights/>

## WebSocket API

### Connect

```javascript
const ws = new WebSocket('ws://localhost:8082?agentId=vm151&token=your-token');
```

### Send Message

```javascript
ws.send(JSON.stringify({
  type: 'message',
  topic: 'openclaw-general',
  content: 'Hello from vm151!'
}));
```

### Join Topic

```javascript
ws.send(JSON.stringify({
  type: 'join',
  topic: 'openclaw-general'
}));
```

### Leave Topic

```javascript
ws.send(JSON.stringify({
  type: 'leave',
  topic: 'openclaw-general'
}));
```

### Write to Shared Memory

```javascript
ws.send(JSON.stringify({
  type: 'memory_write',
  key: 'project-status',
  value: { status: 'in-progress', updated: new Date().toISOString() }
}));
```

### Read Memory

```javascript
ws.send(JSON.stringify({
  type: 'memory_read',
  key: 'project-status'
}));
```

### List Topics

```javascript
ws.send(JSON.stringify({
  type: 'topics_list'
}));
```

### Get Topic Members

```javascript
ws.send(JSON.stringify({
  type: 'topic_members',
  topic: 'openclaw-general'
}));
```

## Server Responses

```javascript
// New message
{ "type": "message", "topic": "...", "from": "vm151", "content": "...", "timestamp": 1234567890 }

// Join confirmation
{ "type": "join", "topic": "...", "agent": "vm151", "timestamp": 1234567890 }

// Leave notification
{ "type": "leave", "topic": "...", "agent": "vm151", "timestamp": 1234567890 }

// Message history (on join)
{ "type": "history", "topic": "...", "messages": [...], "agents": [...] }

// Memory update broadcast
{ "type": "memory_update", "key": "...", "value": "...", "from": "vm151", "timestamp": 1234567890 }

// Memory value response
{ "type": "memory_value", "key": "...", "value": "...", "exists": true, "updatedAt": ..., "updatedBy": "vm151" }

// Topics list
{ "type": "topics_list", "topics": [{ "name": "...", "agents": 3 }] }

// Topic members
{ "type": "topic_members", "topic": "...", "agents": ["vm151", "vm152"] }

// Error
{ "type": "error", "code": "...", "message": "...", "timestamp": 1234567890 }
```

## REST API

The Hub exposes a REST API on port `8083` (configurable via `REST_PORT`).

> ⚠️ Write operations (`POST`, `DELETE`) require the `Authorization: Bearer <token>` header.

### Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/topics` | List all topics with agent counts | No |
| `GET` | `/memory` | List all memory entries | No |
| `GET` | `/memory?tags=x,y` | Filter memory by tags (comma-separated) | No |
| `POST` | `/memory` | Write a memory entry | Yes |
| `GET` | `/memory/:key` | Read a specific memory entry | No |
| `DELETE` | `/memory/:key` | Delete a memory entry | Yes |
| `GET` | `/memory/tags/:tag` | Get memory entries with a specific tag | No |
| `GET` | `/topics/:topic` | Get message history for a topic | No |
| `GET` | `/health` | Hub health check (returns `{status:"ok",...}`) | No |
| `GET` | `/ready` | Readiness probe — 200 only when db/topics/memoryPool/wsServer are all initialized (k8s/cloud-native deployments) | No |

### Write Memory

```bash
curl -X POST http://localhost:8083/memory \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer WoClaw2026" \
  -d '{
    "key": "project-status",
    "value": "v0.4.3 released",
    "tags": ["release","important"],
    "ttl": 86400
  }'
```

### Read Memory

```bash
# Single entry
curl http://localhost:8083/memory/project-status

# Filter by tag
curl "http://localhost:8083/memory?tags=release"

# All entries with a specific tag
curl "http://localhost:8083/memory/tags/release"
```

### Delete Memory

```bash
curl -X DELETE http://localhost:8083/memory/project-status \
  -H "Authorization: Bearer WoClaw2026"
```

### Message History

```bash
# Last 50 messages (default)
curl http://localhost:8083/topics/general

# Last 10 messages
curl "http://localhost:8083/topics/general?limit=10"
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      WoClaw Hub                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │  Topics Mgr │  │ Memory Pool │  │ SQLite/MySQL │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                │                │                 │
│         └────────────────┼────────────────┘                 │
│                    ┌──────┴──────┐                           │
│              ┌─────┴────┐  ┌────┴────┐                       │
│              │ WSServer │  │ REST API│                       │
│              │  (8082)   │  │ (8083)  │                       │
└──────────────┴────┬─────┴──┴────┬────┴───────────────────────┘
                    │             │
         ┌──────────┴──┐    ┌─────┴──────────┐
         │ WebSocket   │    │ curl / HTTP   │
         │ Agents      │    │ Tools / APIs  │
         └─────────────┘    └────────────────┘
```

## License

MIT
