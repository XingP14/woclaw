# S92 Agent Stream Protocol — R92.5 Spec

> NDJSON event stream contract for long-lived agent runs over WoClaw Hub.
> LEARNING_PLAN.md §92 — closes the gap between today's atomic `publish`/`fetch`
> and the streaming-primary model that 2026-era agent runtimes need.

**Status:** Draft (R92.5 PoC ship) — 2026-07-25
**Layer / hooks:** §92.5 spec + §92.6 contract test plan + §92.7 upstream PR plan
**Depends on:** R91.5 `woclaw/observability-envelope` (commit 15d4fbd, shipped 2026-07-25)

---

## 1. Why this spec exists

Today's WoClaw Hub exchanges **atomic messages**: `publish` → `fetch` is a single
blob per call. Real agent runs in 2026 look different:

- A run lasts **seconds to minutes** (vs milliseconds for a chat turn)
- During the run the agent emits many discrete events (`assistant_text`,
  `tool_call`, `tool_result`, `subagent_spawn`, `budget_exceeded`, …)
- Subscribers want **progress visibility**, **cancel**, **reconnect**, **replay**
- Operators want **structured audit** — who said what, when, with what tools

The agent-runtime ecosystem (gantry ⭐2, substructure ⭐5, agent-harness ⭐2,
AG-UI protocol) has converged on a **streaming event contract** for exactly
this shape. WoClaw needs one too, but **with the existing Hub at the center**
(we are a hub, not a CLI binary).

This document is the R92.5 PoC ship — it defines the contract; a follow-up
PR lands the hub/src implementation.

---

## 2. Design constraints (from R92.1 + R92.2 research)

| Constraint | Source | Why it matters |
|---|---|---|
| **Schema versioning** | gantry `schema_version: "1.1"` | Consumers must guard; producers evolve safely |
| **Always emit `start` before anything else** | gantry | Lets consumers detect startup failures (no `start` ⇒ exit code 4) |
| **Always emit `result` last, even on failure** | gantry | EOF is ambiguous on TCP/NDJSON; structured exit reason is unambiguous |
| **`role` field on streaming events** | gantry | Lets a downstream consumer route by source: `"single"`, `"coordinator"`, `<subagent-name>` |
| **`ts` on every event (epoch ms)** | gantry + substructure | Receiver can reorder; latency probe works |
| **Transport-agnostic** | all 3 canonicals | NDJSON-over-stdout / SSE-over-HTTP / WS / journal — the spec binds the *event* not the wire |
| **Cancel/resume is expressible** | substructure | `error{kind:"interrupted", recoverable:true, retry_after_ms:?}` is the v0 minimum |
| **Cursor-based replay** | gantry journal | Replay without re-invoking the LLM; observability loop closes |

---

## 3. Wire shape — `woclaw/agent-stream`

### 3.1 The `Stream` envelope

A stream is a **single ordered sequence of events** scoped to one `run_id`.
Producers publish the envelope; consumers subscribe per topic and receive it
back as a sequence (no transport-level framing dependencies).

```jsonc
{
  "op": "publish-stream",
  "topic": "agent/x/run-y",
  "stream": {
    "schema_version": "1.0",
    "run_id": "0190f1b6-3f9b-7c8d-9e0a-1b2c3d4e5f60",
    "agent_id": "p14",
    "started_at": 1737000000000,
    "events": [
      { "event": "start",          "ts": 1737000000010, "schema_version": "1.0", "model": "MiniMax-M3", "mode": "single" },
      { "event": "assistant_text", "ts": 1737000001200, "role": "single", "text": "Analyzing…" },
      { "event": "tool_call",      "ts": 1737000001450, "role": "single", "tool": "read_file", "args": { "path": "AGENTS.md" } },
      { "event": "tool_result",    "ts": 1737000001465, "tool": "read_file", "bytes": 4096, "truncated": false },
      { "event": "result",         "ts": 1737000002000, "exit": "ok", "duration_ms": 1990, "input_tokens": 120, "output_tokens": 45 }
    ]
  }
}
```

### 3.2 Event taxonomy (v1.0)

Five categories; consumers `switch(event)` on the value.

| Category | Events | Required fields | Optional fields |
|---|---|---|---|
| **lifecycle** | `start`, `result` | `ts`, `event` | `schema_version`, `exit`, `duration_ms`, token totals, `error` |
| **prompt-in / tool** | `assistant_text`, `tool_call`, `tool_result` | `ts`, `event`, `role` | `text`, `tool`, `args`, `bytes`, `bytes_out`, `truncated`, `handle`, `error` |
| **resource** | `budget_exceeded`, `timeout`, `rate_limited`, `changes` | `ts`, `event`, `kind` | `limit`, `total`, `retry_after_ms`, `files: [{path, kind}]` |
| **multi-agent** | `subagent_spawn`, `subagent_done`, `subagent_failed` | `ts`, `event`, `role` (subagent name) | `parent_role`, `cost_tokens`, `duration_ms` |
| **loop boundary** | `iteration_start`, `iteration_end`, `agent_turn`, `history_compacted` | `ts`, `event` | `iteration`, `turn`, `input_tokens`, `output_tokens`, `cache_read`, `cache_write`, `results_elided` |

### 3.3 Exit codes (v1.0)

Adopted from gantry's contract — exit is **part of the protocol**, not process-level:

| `exit` | code | Meaning | `recoverable` |
|---|---|---|---|
| `ok` | 0 | Normal completion | n/a |
| `error` | 1 | Runtime error | boolean |
| `budget` | 2 | Token limit hit | true (raise limit, retry) |
| `timeout` | 3 | External SIGINT / timeout | true |
| `config` | 4 | Invalid input — no `start` was emitted | false |
| `rate_limited` | 5 | Provider rate limit, retries exhausted | true (`retry_after_ms` set) |
| `interrupted` | 6 | Hub-side cancel via subscriber signal | true |

### 3.4 Field invariants

- **`ts` always epoch ms** — string → number coercion forbidden.
- **`role` always string** — even for `"single"` (avoids null checks downstream).
- **`event` always string union** — unknown event ⇒ consumer logs `WARN unknown_event` and continues (additive compat).
- **`start` carries `schema_version`** — it is the **manifest** of the whole stream.
- **`result` is always last** — `events[]` invariant: producer rejects append-after-result; consumers treat EOF-without-result as `exit: "config"`.

---

## 4. Transport binding — WoClaw Hub integration

The spec is transport-agnostic. The hub's existing transport choices:

| Existing op | Status | Stream equivalent |
|---|---|---|
| `publish` | shipped | `publish-stream` (new) — superset, see §4.1 |
| `fetch` | shipped | `stream-fetch` (new, cursor-based, see §4.2) |
| `subscribe` | shipped | unchanged — consumers receive `publish-stream` envelopes as-is |
| (none) | new | `stream-signal` — cancel/resume, see §4.3 |

### 4.1 `publish-stream` — backward-compatible superset

New WebSocket / REST op. Coexists with the existing `publish` op:

```jsonc
{
  "op": "publish-stream",
  "topic": "agent/x/run-y",
  "stream": { /* §3.1 envelope */ }
}
```

Hub guarantees:
- **Atomic per-envelope**: the whole `events[]` array is journaled in one
  SQLite append (`federation_log`-style, see R50 sleep consolidation design).
- **Auto-`run_id` if missing**: hub fills `run_id = uuid()` on first event.
- **Schema check**: rejects `start.schema_version` that does not satisfy `^1.0`.
- **Backward compat**: pre-existing `publish` op continues to work; subscribers
  that only care about plain messages can ignore `publish-stream` events by
  filtering `stream` key presence.

### 4.2 Cursor-based stream fetch — replay without re-LLM

```http
GET /v1/topics/{topic}/runs/{run_id}?since_cursor=0
```

Response (single stream envelope):

```jsonc
{
  "topic": "agent/x/run-y",
  "run_id": "0190f1b6-3f9b-7c8d-9e0a-1b2c3d4e5f60",
  "since_cursor": 0,
  "events": [ /* §3.1 events, ordered by cursor */ ],
  "next_cursor": 5,
  "exit": "ok"
}
```

Cursor is **monotonic per `run_id`** (1-indexed within the events array).
This is the same pattern gantry uses for journaled NDJSON — observability
loop closes (R91.5 envelope + R92.6 contract test plan).

### 4.3 `stream-signal` — cancel / pause / resume

Producer or subscriber emits; hub forwards to other connected subscribers:

```jsonc
{
  "op": "stream-signal",
  "topic": "agent/x/run-y",
  "run_id": "...",
  "signal": "cancel",   // or "pause" | "resume"
  "reason": "user_requested",
  "ts": 1737000001990
}
```

Producer responds by emitting `error{kind:"interrupted", recoverable:true}`
then `result{exit:"interrupted", code:6}` — matching §3.3.

---

## 5. Compatibility matrix

| Caller | Pre-R92 path | Post-R92 path |
|---|---|---|
| Existing `publish` user | unchanged | unchanged + can opt into `publish-stream` |
| Existing `subscribe` consumer | receives atomic messages | also receives stream envelopes (filter `stream` key) |
| New `stream-fetch` user | n/a | cursor-replayable history |
| Existing 4 canonicals (gantry etc.) | external | external — not coupled to WoClaw; this spec is WoClaw's answer |

---

## 6. Test plan — R92.6 contract tests (30 cases)

Dimensions: **5 events × 3 exits × 2 transports = 30**.

| Events (5) | Exits (3) | Transports (2) |
|---|---|---|
| `start` (manifest shape) | `ok` (full happy path) | **WS** (hub ws_server.ts) |
| `assistant_text` | `budget` (token cap mid-stream) | **REST** (hub rest_server.ts) |
| `tool_call` | `interrupted` (cancel signal) | |
| `tool_result` | | |
| `result` (always last) | | |

Plus 4 gate tests (one per spec invariant in §3.4):

- `start` MUST be the first event of every stream
- `result` MUST be the last event of every stream (producer rejects append-after-result)
- `ts` MUST be a number (string rejected)
- `event` MUST be from the v1.0 taxonomy (unknown event logged + skipped, not rejected)

Total: **30 + 4 = 34 cases** in `hub/test/agent_stream.test.ts`. Mirrors the
shape of `hub/test/hub_event.test.ts` from R91.5 (227 lines / 15 cases).

---

## 7. Upstream PR plan — R92.7

Two PR issues, one per canonical we benchmarked:

| Project | Issue title | Substrate framing |
|---|---|---|
| `barryroodt/gantry` ⭐2 | "Cross-runtime interop notes — WoClaw adapter sketch for gantry schema_version 1.x events" | Show how a gantry-compatible emitter can publish via `publish-stream`; request their feedback on field-name harmonization (`duration_ms` vs `elapsed_ms`). |
| `substructureai/substructure` ⭐5 | "WoClaw Hub agent-stream sub-protocol — coordination request on AG-UI bridge" | Propose a one-way bridge from substructure's AG-UI stream into WoClaw topics; ask whether they'd accept a `woclaw-stream-{topic}` adapter. |

Both issues stay ≤200 words; references to this spec file; offer to maintain
the adapter if they accept.

---

## 8. Skill candidate — R92.8

`agent-stream-protocol-design` skill — 6-item checklist distilled from §2 + §3:

1. **schema_version in `start`** (never infer)
2. **Taxonomy union** (no free-form `event` strings)
3. **`ts` always epoch ms number** (coercion forbidden)
4. **`role` always string** (even for single-agent)
5. **`result` always last, even on failure** (structured exit reason)
6. **Transport stays out of the spec** (NDJSON/SSE/WS/journal all valid)

This skill is intended to land in `~/.hermes/skills/methodology/` after R92.5
ships, so future substrate work reuses the framing.

---

## 9. Reference samples

- gantry event table + exit codes (§1.1 of
  `~/.hermes/workspace/memory/2026-07-17-agent-stream-protocol-ndjson-agui.md`)
- substructure worker-as-HTTP pattern (§1.2 of same file)
- WoClaw hub-side `federation_log.ts` — the SQLite append-only mirror this
  spec's `publish-stream` should reuse for journaling
- R91.5 `hub/src/hub_log.ts` `hubEvent` helper — composes naturally with
  `result{exit:"..."}` events: every `result` becomes one OTel-compatible span

---

## 10. Open questions (R92.9, post-ship)

- **Compression**: streams can be large; do we gzip `events[]` or leave it to
  transport (HTTP `Accept-Encoding`)?
- **Multi-publisher ordering**: two publishers racing on the same `run_id` —
  is `cursor` per-(run,producer) or just per-`run`? (Current spec: per-run.)
- **Retention**: default 7 days per stream journal; configurable per topic?
- **Privacy**: should `tool_result.bytes` redact matched-secret content?
  Composes with L234.2 (`hub/src/security/secret_scanner.ts`).

These are deliberately **not** in v1.0 — ship the wedge first, iterate.

---

_This document is the R92.5 PoC. It defines the contract; implementation
PR lands separately. Backed by research in
`~/.hermes/workspace/memory/2026-07-17-agent-stream-protocol-ndjson-agui.md`._