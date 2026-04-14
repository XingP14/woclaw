# WoClaw All-in-One Memory Platform — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Implement the core memory system for WoClaw Hub v1.0 — Session Store, AI Extraction Engine, Importance Scoring + Feedback API, and Forgetting Scheduler.

**Tech Stack:** TypeScript, better-sqlite3 (existing), OpenAI SDK, node-cron

---

## File Map

**Modified:** `hub/src/types.ts`, `hub/src/db.ts`, `hub/src/rest_server.ts`, `hub/src/index.ts`
**Created:** `hub/src/session_store.ts`, `hub/src/extraction/engine.ts`, `hub/src/extraction/providers/openai.ts`, `hub/src/extraction/providers/anthropic.ts`, `hub/src/extraction/providers/ollama.ts`, `hub/src/scheduler.ts`, `hub/test/session_store.test.ts`, `hub/test/extraction_engine.test.ts`, `hub/test/forgetting_scheduler.test.ts`

---

## Task 1: Type Definitions

**Files:** Modify: `hub/src/types.ts`

- [ ] **Step 1: Add Session and related types to types.ts**

Append to the end of `hub/src/types.ts`:

```typescript
// v1.0: Session Store — episodic memory
export interface DBSession {
  id: string; agentId: string; framework: string;
  startedAt: number; endedAt?: number; transcript: string;
  summary?: string; importance: number; accessCount: number;
  lastAccessedAt?: number; tags: string[]; extracted: boolean; flagged: boolean; createdAt: number;
}
export interface DBSessionFeedback { sessionId: string; agentId: string; adjustment: number; reason?: string; createdAt: number; }
export interface ExtractionQueueEntry { sessionId: string; queuedAt: number; priority: number; status: 'pending'|'processing'|'done'|'failed'; retryCount: number; }
export interface ImportanceResult { score: number; labels?: string[]; reasoning?: string; }
export interface ExtractionResult { summary: string; keyDecisions: string[]; importantFacts: string[]; preferences: string[]; filesModified: string[]; topics: string[]; importanceScore: number; suggestedTags: string[]; }
export interface MemoryFeedback { key: string; agentId: string; adjustment: number; reason?: string; createdAt: number; }
export interface AIProviderConfig { provider: 'openai'|'anthropic'|'ollama'|'custom'; model?: string; apiKey?: string; baseUrl?: string; }
export interface ExtractionConfig { mode: 'sync'|'batch'; batchSize: number; batchIntervalMs: number; provider: AIProviderConfig; }
export interface ForgettingConfig { enabled: boolean; schedule: 'daily'|'weekly'|'manual'; timeOfDay?: string; dayOfWeek?: number; importanceThreshold: number; dryRun: boolean; maxEvictPerRun: number; }
```

---

## Task 2: Database Schema — Session Tables

**Files:** Modify: `hub/src/db.ts`

- [ ] **Step 1: Add session table schema to ClawDB.init()**

Add after the `memory_versions` table creation:

```typescript
// Sessions table
this.db!.exec(`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, framework TEXT NOT NULL DEFAULT 'unknown', started_at INTEGER NOT NULL, ended_at INTEGER, transcript TEXT NOT NULL DEFAULT '', summary TEXT, importance REAL NOT NULL DEFAULT 5.0, access_count INTEGER NOT NULL DEFAULT 0, last_accessed_at INTEGER, tags TEXT NOT NULL DEFAULT '[]', extracted INTEGER NOT NULL DEFAULT 0, flagged INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`);
this.db!.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id)`);
this.db!.exec(`CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC)`);
// Extraction queue
this.db!.exec(`CREATE TABLE IF NOT EXISTS extraction_queue (session_id TEXT PRIMARY KEY, queued_at INTEGER NOT NULL, priority INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', retry_count INTEGER NOT NULL DEFAULT 0)`);
// Session feedback
this.db!.exec(`CREATE TABLE IF NOT EXISTS session_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, agent_id TEXT NOT NULL, adjustment REAL NOT NULL, reason TEXT, created_at INTEGER NOT NULL)`);
// Memory feedback
this.db!.exec(`CREATE TABLE IF NOT EXISTS memory_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, agent_id TEXT NOT NULL, adjustment REAL NOT NULL, reason TEXT, created_at INTEGER NOT NULL)`);
```

- [ ] **Step 2: Add Session CRUD methods to ClawDB class**

Add these methods: `setSession`, `getSession`, `getAllSessions`, `deleteSession`, `sessionSearch`, `mapSessionRow`, `addToExtractionQueue`, `getExtractionQueue`, `updateExtractionQueueStatus`, `removeFromExtractionQueue`, `addSessionFeedback`, `getSessionFeedbackHistory`, `addMemoryFeedback`, `getMemoryFeedbackHistory`, `getEvictionCandidates`.

Key SQL for `getEvictionCandidates`:
```sql
SELECT key, importance, COALESCE(last_accessed_at, updated_at) as last_accessed_at, access_count
FROM memories WHERE importance < ?
ORDER BY (importance * 0.5) + ((1.0 - MIN((COALESCE(last_accessed_at, updated_at) - ?), ?) / ?) * 0.3) + (LOG10(access_count + 1) / 2.0 * 0.2) ASC LIMIT ?
```

- [ ] **Step 3: Run tests**

Run: `cd hub && npm test` — all existing tests pass

---

## Task 3: Session Store Engine

**Files:** Create: `hub/src/session_store.ts`, `hub/test/session_store.test.ts`

- [ ] **Step 1: Write session_store.ts** — SessionStore class with methods: `registerSession`, `updateSession`, `getSession`, `listSessions`, `deleteSession`, `searchSessions`, `flagSession`, `markExtracted`, `incrementAccessCount`, `addFeedback`
- [ ] **Step 2: Write session_store.test.ts** — 6 tests covering registration, update, list, search, flag, feedback
- [ ] **Step 3: Run tests** — `cd hub && npm test -- --grep "SessionStore"` — all PASS

---

## Task 4: AI Extraction Engine

**Files:** Create: `hub/src/extraction/engine.ts`, `hub/src/extraction/providers/openai.ts`, `hub/src/extraction/providers/anthropic.ts`, `hub/src/extraction/providers/ollama.ts`, `hub/test/extraction_engine.test.ts`

- [ ] **Step 1: Write extraction/engine.ts** — `ExtractionEngine` class with `AIProvider` interface, constructor loads provider via `require()` based on config
- [ ] **Step 2: Write extraction/providers/openai.ts** — `OpenAIProvider` implementing `AIProvider`, methods `scoreMemory()` and `extractSession()` calling OpenAI Chat API with JSON mode
- [ ] **Step 3: Write extraction/providers/anthropic.ts** — stub returning default 5.0
- [ ] **Step 4: Write extraction/providers/ollama.ts** — stub returning default 5.0
- [ ] **Step 5: Write extraction_engine.test.ts** — mock-based test for interface contract

---

## Task 5: REST API — Session Endpoints

**Files:** Modify: `hub/src/rest_server.ts`

- [ ] **Step 1: Add SessionStore import and property, wire in constructor**
- [ ] **Step 2: Add routes**: `GET /sessions`, `POST /sessions`, `GET /sessions/:id`, `POST /sessions/:id/feedback`, `POST /sessions/:id/flag`, `GET /sessions/search`, `DELETE /sessions/:id`, `PUT /sessions/:id`
- [ ] **Step 3: Run tests** — `cd hub && npm test` — all pass

---

## Task 6: Forgetting Scheduler

**Files:** Create: `hub/src/scheduler.ts`, `hub/test/forgetting_scheduler.test.ts` | Modify: `hub/src/index.ts`, `hub/src/rest_server.ts`

- [ ] **Step 1: Write scheduler.ts** — `ForgettingScheduler` class with `nodeCron` daily/weekly scheduling, `run(dryRun?)` evicting lowest eviction_score entries first, `getLastRun()`, `updateConfig()`
- [ ] **Step 2: Wire in index.ts** — import and instantiate with config
- [ ] **Step 3: Add REST endpoints** — `POST /memory/prune`, `GET /memory/prune/status`
- [ ] **Step 4: Write forgetting_scheduler.test.ts** — test dry run vs actual eviction
