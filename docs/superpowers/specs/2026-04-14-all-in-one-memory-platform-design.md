# WoClaw All-in-One Agent Memory Platform — Design

> Version: 1.0
> Date: 2026-04-14
> Author: WoClaw Design Review

## Status

Draft — pending user approval before implementation planning.

---

## 1. Overview

### 1.1 Strategic Vision

**WoClaw** evolves from a "Shared Memory + Messaging Hub for AI Agents" into the **All-in-One Agent Memory Platform** — a self-hosted, open-source记忆基础设施 for distributed AI agents.

**Core promise:** Any AI framework (OpenClaw, Claude Code, OpenAI Codex, Gemini CLI, OpenCode, Hermes, or any future agent) can connect to WoClaw Hub and gain:
- Unified long-term memory across channels and sessions
- Semantic episodic memory (full transcript storage and retrieval)
- Intelligent importance scoring with agent feedback
- Automated forgetting (time + access + importance decay)
- Cross-agent shared context via topic pub/sub

**Positioning:** WoClaw = memory layer for AI agents. Not a chat platform, not a task manager — the memory substrate that makes agents smarter over time.

### 1.2 Design Principles

1. **Open platform, not locked ecosystem** — Any framework can implement the WoClaw Memory API契约 and join. WoClaw-provided hooks are official samples, not the only path.
2. **Self-hosted, no external API dependency for the core** — The memory system itself (storage, extraction, forgetting) runs on the user's infrastructure. AI Provider is pluggable.
3. **Sync extraction, async for scale** — Session capture is synchronous (memory immediately available after session end). Extraction is synchronous to keep implementation simple; batch mode is configurable.
4. **Preserve autonomy of sub-packages** — Each sub-package (codex-woclaw, woclaw-hooks, woclaw-mcp, etc.) is an independent project with its own repo, release cycle, and responsibility.

---

## 2. System Architecture

### 2.1 Component Map

```
                            ┌─────────────────────────────────┐
                            │         WoClaw Hub              │
                            │  (独立 repo: woclaw-hub)        │
                            │                                 │
                            │  ┌───────────────────────────┐  │
                            │  │   REST API  (:8083)      │  │
                            │  │   WebSocket (:8082)       │  │
                            │  └───────────────────────────┘  │
                            │                                 │
                            │  ┌───────────────────────────┐  │
                            │  │   Memory Pool Engine      │  │
                            │  │   (key-value + versions)  │  │
                            │  └───────────────────────────┘  │
                            │                                 │
                            │  ┌───────────────────────────┐  │
                            │  │   Session Store Engine    │  │
                            │  │   (episodic memory)        │  │
                            │  └───────────────────────────┘  │
                            │                                 │
                            │  ┌───────────────────────────┐  │
                            │  │   Graph Memory Engine      │  │
                            │  │   (nodes + edges)          │  │
                            │  └───────────────────────────┘  │
                            │                                 │
                            │  ┌───────────────────────────┐  │
                            │  │   AI Extraction Engine    │  │
                            │  │   (plugin: AIProvider)     │  │
                            │  └───────────────────────────┘  │
                            │                                 │
                            │  ┌───────────────────────────┐  │
                            │  │   Forgetting Scheduler    │  │
                            │  │   (cron: daily default)   │  │
                            │  └───────────────────────────┘  │
                            │                                 │
                            │  ┌───────────────────────────┐  │
                            │  │   Feedback Manager        │  │
                            │  │   (importance adjustment) │  │
                            │  └───────────────────────────┘  │
                            └─────────────────────────────────┘

Agent 端 hooks (独立 repos):
  codex-woclaw/       → session 结束时同步写 Hub (基础字段)
  woclaw-hooks/       → Claude Code / Gemini CLI / OpenCode hooks
  woclaw-mcp/         → MCP bridge (Hub as MCP server)

External frameworks (实现 WoClaw Memory API 即可接入):
  any-agent/          → 只要支持 HTTP WebSocket，即可接入
```

### 2.2 Sub-package Repo Structure (Target)

Each sub-package is an independent GitHub repo under the WoClaw organization:

| Repo | Description | Status |
|------|-------------|--------|
| `woclaw-hub` | Core platform (this design) | New repo |
| `woclaw-codex` | OpenAI Codex CLI hooks + CLI tool | Existed as `packages/codex-woclaw` |
| `woclaw-hooks` | Multi-framework hooks (Claude Code, Gemini, OpenCode) | Existed as `packages/woclaw-hooks` |
| `woclaw-mcp` | MCP Server bridging Hub tools | Existed as `packages/mcp-bridge` |
| `woclaw-vscode` | VS Code Extension | Existed as `packages/woclaw-vscode` |
| `woclaw-plugin` | OpenClaw channel plugin | Existed as `plugin/` |
| `woclaw-opencode` | OpenCode native plugin | Existed as `packages/opencode-woclaw-plugin` |

**Migration path:** Existing monorepo packages under `woclaw/` will be moved to independent repos in sequence (see Section 8).

---

## 3. Storage Architecture

### 3.1 Database: SQLite (default)

Hub uses SQLite by default (as current). MySQL/multi-host options remain for advanced users.

### 3.2 Three Storage Engines

#### 3.2.1 Memory Pool Engine (Existing, Enhanced)

Stores structured key-value memories.

**Schema:**
```sql
CREATE TABLE memories (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  label       TEXT,
  tags        TEXT,          -- JSON array
  version     INTEGER DEFAULT 1,
  created_at  INTEGER,
  updated_at  INTEGER,
  updated_by  TEXT,          -- agentId
  ttl         INTEGER,       -- milliseconds, NULL = no expiry
  importance  REAL DEFAULT 5.0,  -- 0-10, adjustable via feedback
  access_count INTEGER DEFAULT 0,
  last_accessed_at INTEGER
);

CREATE TABLE memory_versions (
  key         TEXT,
  version     INTEGER,
  value       TEXT,
  label       TEXT,
  overwritten_at INTEGER,
  overwritten_by TEXT,
  PRIMARY KEY (key, version)
);
```

#### 3.2.2 Session Store Engine (NEW)

Stores full episodic transcripts. **Isolated from memory pool** — different table, different access patterns.

**Schema:**
```sql
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,       -- sessionId
  agent_id     TEXT NOT NULL,
  framework    TEXT NOT NULL,           -- 'claude-code', 'codex', 'gemini', 'openclaw', etc.
  started_at   INTEGER,
  ended_at     INTEGER,
  transcript   TEXT NOT NULL,           -- full JSONL transcript
  summary      TEXT,                    -- extracted by AI engine
  importance   REAL DEFAULT 5.0,       -- initial score from extraction
  access_count INTEGER DEFAULT 0,
  last_accessed_at INTEGER,
  tags         TEXT,                   -- JSON array
  extracted    INTEGER DEFAULT 0,      -- 0 = pending, 1 = done
  flagged      INTEGER DEFAULT 0        -- 0 = normal, 1 = agent flagged important
);

CREATE TABLE extraction_queue (
  session_id   TEXT PRIMARY KEY,
  queued_at     INTEGER,
  priority     INTEGER DEFAULT 0,       -- higher = process first
  status       TEXT DEFAULT 'pending',  -- pending / processing / done / failed
  retry_count  INTEGER DEFAULT 0
);
```

**Why separate?** Sessions can be megabytes (full JSONL transcripts). Keeping them in a separate store with its own TTL/compression policy avoids polluting the memory pool. Different access patterns: memories are random-key lookups, sessions are typically scanned by time or semantic search.

#### 3.2.3 Graph Memory Engine (Existing, Enhanced)

Graph store remains as-is. New integration: memories extracted from sessions automatically create graph nodes and entity edges.

---

## 4. AI Extraction Engine

### 4.1 AIProvider Interface

```typescript
interface AIProvider {
  provider: string; // 'openai' | 'anthropic' | 'ollama' | 'custom'

  // Returns importance score (0-10) and optional labels
  scoreMemory(text: string, context: MemoryContext): Promise<ImportanceResult>;

  // Returns structured extraction from session transcript
  extractSession(transcript: string, agentId: string): Promise<ExtractionResult>;

  // Configuration
  config: Record<string, string>; // API key, base URL, model name, etc.
}

interface ImportanceResult {
  score: number;           // 0-10
  labels?: string[];       // e.g. ['decision', 'preference', 'fact']
  reasoning?: string;       // optional explanation
}

interface ExtractionResult {
  summary: string;                    // 1-2 sentence summary
  keyDecisions: string[];             // explicit decisions made
  importantFacts: string[];           // factual findings
  preferences: string[];              // user/agent preferences detected
  filesModified: string[];             // files touched
  topics: string[];                   // subjects discussed
  importanceScore: number;             // 0-10
  suggestedTags: string[];
}
```

### 4.2 Built-in Providers

Hub ships with built-in provider adapters:

| Provider | Model | Config Required |
|----------|-------|----------------|
| `openai` | gpt-4o | `OPENAI_API_KEY` |
| `anthropic` | claude-3-5-sonnet | `ANTHROPIC_API_KEY` |
| `ollama` | llama3 / mistral | `OLLAMA_BASE_URL` (default `http://localhost:11434`) |

### 4.3 Configuration

Hub environment variables:
```
AI_PROVIDER=openai          # which provider to use
AI_MODEL=gpt-4o            # model name (provider-specific)
OPENAI_API_KEY=sk-...       # if using openai
ANTHROPIC_API_KEY=sk-...    # if using anthropic
OLLAMA_BASE_URL=http://localhost:11434  # if using ollama
EXTRACTION_MODE=sync        # 'sync' (every session) or 'batch' (configurable interval)
EXTRACTION_BATCH_SIZE=10    # if batch mode: max sessions per batch
EXTRACTION_BATCH_INTERVAL=300000  # if batch mode: interval in ms (default 5min)
```

### 4.4 Extraction Trigger

Configurable in `woclaw.json`:
```json
{
  "extraction": {
    "mode": "sync",          // "sync" | "batch"
    "batchSize": 10,
    "batchIntervalMs": 300000,
    "provider": "openai"
  }
}
```

- **sync**: Hub receives session end signal → immediately calls AI extraction → writes to session store + creates memory entries. Memory is searchable immediately after session ends.
- **batch**: Hub writes session to extraction queue → background worker processes queue on interval. Memory is searchable after batch processes (delay = up to `batchIntervalMs`).

---

## 5. Importance Scoring & Feedback

### 5.1 Initial Score

Set by AI extraction engine at session end (0-10 scale).

### 5.2 Feedback Adjustment

Agents can adjust importance via API:

```http
POST /memory/:key/feedback
Content-Type: application/json

{
  "adjustment": +2,      // relative adjustment (-5 to +5)
  "reason": "user explicitly confirmed this decision",
  "agentId": "my-agent"
}
```

Or for sessions:
```http
POST /sessions/:sessionId/feedback
{
  "adjustment": +3,
  "reason": "this session contained critical bug fix",
  "agentId": "my-agent"
}
```

**Rules:**
- Final score = clamp(initial_score + cumulative_adjustments, 0, 10)
- Adjustments are additive (multiple agents can adjust the same memory)
- Feedback history is stored (audit trail)

### 5.3 Eviction Score Formula

```
eviction_score = (importance × 0.5) + (recency_boost × 0.3) + (access_boost × 0.2)

where:
  recency_boost = 1 - (days_since_last_access / 90)   // 90-day window, linear decay
  access_boost  = log10(access_count + 1) / log10(100) // log scale, 100 accesses = 1.0
```

**Forgetting scheduler** runs daily (configurable) and evicts memories/sessions where:
- `eviction_score < importance_threshold` (default: 2.0)
- OR storage exceeds capacity limit (when configured)

---

## 6. Forgetting Scheduler

### 6.1 Configuration

```json
{
  "forgetting": {
    "enabled": true,
    "schedule": "daily",          // "daily" | "weekly" | "manual"
    "timeOfDay": "03:00",         // HH:MM in UTC
    "importanceThreshold": 2.0,   // evict below this score
    "dryRun": false,              // if true, log what would be evicted without executing
    "maxEvictPerRun": 100         // cap per run to avoid long pauses
  }
}
```

### 6.2 REST API

```http
POST /memory/prune
  ?dryRun=true    // preview without executing

GET /memory/prune/status   // last run time, count evicted, next run
```

### 6.3 Forgetting Priority

When evicting, **lowest eviction_score first**. Eviction is permanent (removed from DB). For sessions, optionally archive to file before deleting (configurable).

---

## 7. Memory API (Extended)

### 7.1 Memory Pool API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/memory` | List memories (paginated, filterable by tags, importance) |
| GET | `/memory/:key` | Get specific memory |
| POST | `/memory` | Write memory |
| DELETE | `/memory/:key` | Delete memory |
| GET | `/memory/:key/versions` | Get version history |
| POST | `/memory/:key/feedback` | Adjust importance |
| GET | `/memory/recall` | Semantic recall (query + optional intent) |
| POST | `/memory/prune` | Trigger forgetting (manual) |
| GET | `/memory/stats` | Memory stats (count, avg importance, storage size) |

### 7.2 Session Store API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/sessions` | Register a new session (agent calls this at session start) |
| PUT | `/sessions/:id` | Update session (agent calls this at session end with transcript) |
| GET | `/sessions` | List sessions (filterable by agentId, framework, date range, importance) |
| GET | `/sessions/:id` | Get full session transcript |
| DELETE | `/sessions/:id` | Delete session |
| POST | `/sessions/:id/feedback` | Adjust session importance |
| GET | `/sessions/search` | Full-text search across session transcripts |
| GET | `/sessions/stats` | Session store stats |

### 7.3 Graph API (existing, unchanged)

Existing graph endpoints remain. New: memories extracted from sessions auto-generate graph nodes (via a post-extraction hook).

---

## 8. Repo Migration Plan

### Phase 1: Hub Independent Repo + Memory System
1. Create `woclaw-hub` as new GitHub repo
2. Move `hub/` contents → `woclaw-hub/`
3. Implement new memory system modules (Session Store, AI Extraction Engine, Forgetting Scheduler, Feedback API)
4. Update SPEC.md and README.md
5. Set up GitHub Actions CI/CD (existing Docker Hub workflow already works)

### Phase 2: Sub-package Repo Splits (sequential, independent repos)
1. `woclaw-codex` ← `packages/codex-woclaw`
2. `woclaw-hooks` ← `packages/woclaw-hooks`
3. `woclaw-mcp` ← `packages/mcp-bridge`
4. `woclaw-vscode` ← `packages/woclaw-vscode`
5. `woclaw-plugin` ← `plugin/`
6. `woclaw-opencode` ← `packages/opencode-woclaw-plugin`

### Phase 3: Brand & Docs
1. Update WoClaw site to reflect All-in-One Memory Platform positioning
2. Create `woclaw` as meta-repo (links to all sub-packages, quickstart guides)
3. Update all READMEs to reference independent repos

---

## 9. Open Questions

1. **Batch extraction retry logic** — If AI provider returns error, how many retries? Backoff strategy?
2. **Session archival** — Before forgetting a session, archive to file? What format? Where?
3. **Cross-agent importance conflicts** — Two agents disagree on importance (+5 and -3). Current additive model averages them. Is this desired?
4. **Memory encryption at rest** — SQLite supports encryption. Should Hub support encrypted DB for sensitive memory storage?

These are not blocking for v1.0 but should be addressed before production hardening.

---

## 10. Implementation Priority

**v1.0 (This design):**
1. Session Store (tables + CRUD API)
2. AI Extraction Engine (AIProvider interface + built-in OpenAI adapter)
3. Session → memory extraction pipeline (sync)
4. Importance scoring (initial + feedback)
5. Forgetting Scheduler (daily cron, eviction formula)
6. Repo split: woclaw-hub independent

**v1.1:**
1. Batch extraction mode
2. Graph memory auto-node creation from extracted memories
3. Ollama AIProvider adapter

**v1.2+:**
1. Session archival to file
2. Memory encryption at rest
3. Federation-aware shared memory
4. Web UI management panel for memory inspection

---

## 11. Appendix: Key Types

```typescript
// Memory entry
interface Memory {
  key: string;
  value: string;
  label?: string;
  tags: string[];
  version: number;
  createdAt: number;
  updatedAt: number;
  updatedBy: string;
  ttl?: number;
  importance: number;       // 0-10, adjustable
  accessCount: number;
  lastAccessedAt?: number;
}

// Session entry
interface Session {
  id: string;
  agentId: string;
  framework: string;
  startedAt: number;
  endedAt?: number;
  transcript: string;       // JSONL
  summary?: string;         // extracted by AI
  importance: number;       // 0-10, initial
  accessCount: number;
  lastAccessedAt?: number;
  tags: string[];
  extracted: boolean;
  flagged: boolean;
}

// Extraction result from AI provider
interface ExtractionResult {
  summary: string;
  keyDecisions: string[];
  importantFacts: string[];
  preferences: string[];
  filesModified: string[];
  topics: string[];
  importanceScore: number;
  suggestedTags: string[];
}

// Eviction decision
interface EvictionCandidate {
  type: 'memory' | 'session';
  key: string;
  evictionScore: number;
  importance: number;
  lastAccessedAt: number;
  accessCount: number;
}
```
