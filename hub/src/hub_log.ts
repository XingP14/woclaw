// hub/src/hub_log.ts
//
// File-local helpers for hub-internal console output that all share the
// canonical `[WoClaw] ` prefix. Mirrors the federation logger pattern
// (federation.ts fedLog/fedWarn/fedError, see 07-03 01:33 commit 32501fb)
// but for the top-level `[WoClaw]` prefix used across rest_server.ts /
// ws_server.ts / index.ts / session_archive.ts / memory.ts.
//
// Why: before this round the codebase contained 28 inline
// `console.[log|warn|error]('[WoClaw] ...')` call sites, each duplicating
// the prefix literal. Two latent risks:
//   (1) drift — a future site could change or omit the prefix and stay silent
//   (2) uniformity — `console.error('[WoClaw] REST error:',
//       errorMessage(e))` mixes template-string and helper patterns in a way
//       that's hard to grep + lint
//
// rFIX: extract 3 module-local helpers (hubLog / hubWarn / hubError) here so
// rest_server.ts / ws_server.ts / index.ts / session_archive.ts / memory.ts
// can import them; each prepends `[WoClaw] ` so call sites pass only the
// message body. The 3 underlying console.* calls are confined to the helper
// bodies. All 28 sites route through the helpers; behavior is byte-identical
// (the wire format preserved because each helper emits exactly the same
// `console.<level>(`[WoClaw] ${msg}`, ...args)` shape the inline sites used).
//
// Extension (round 57, 2026-07-25 — observability-envelope PoC, ship after
// 21-round substrate deep-dive):
//
// Adds an opt-in structured envelope path for production logging pipelines.
// All hub-internal call sites continue to go through hubLog/hubWarn/hubError
// (behavior-preserving: byte-identical console.* output) but operators can
// flip the formatter to emit NDJSON envelopes instead by exporting
// `WOCLAW_LOG_FORMAT=json` before starting the hub. The new `hubEvent`
// helper accepts OTel-compatible fields so downstream collectors
// (Langfuse/LangSmith/Helicone/Arize Phoenix/Portkey) can join envelopes
// to their trace stores without code changes.
//
// This file preserves byte-identical output for the 3 pre-existing helpers
// in `text` mode (the default) so all 28+ call sites keep working with no
// edits and zero behavior change for development workflows.

/** Log an informational message prefixed with `[WoClaw]`. */
export function hubLog(msg: string, ...args: unknown[]): void {
  console.log(`[WoClaw] ${msg}`, ...args);
}

/** Log a warning message prefixed with `[WoClaw]`. */
export function hubWarn(msg: string, ...args: unknown[]): void {
  console.warn(`[WoClaw] ${msg}`, ...args);
}

/** Log an error message prefixed with `[WoClaw]`. */
export function hubError(msg: string, ...args: unknown[]): void {
  console.error(`[WoClaw] ${msg}`, ...args);
}

// --- Observability envelope (env-gated, zero behavior change in `text` mode) ---

/** Structured log level names — match the canonical severity set OTel GenAI
 *  semantic conventions use for `severity_text`. */
export type HubLogLevel = 'info' | 'warn' | 'error';

/** OTEL-compatible trace context fields. `trace_id` / `span_id` are the
 *  hex-encoded 8-byte / 8-byte identifiers per W3C Trace Context. */
export interface HubEventContext {
  trace_id?: string;
  span_id?: string;
  topic_id?: string;
  session_key?: string;
  agent_id?: string;
  duration_ms?: number;
}

/** Loose attrs bag — OTEL GenAI semconv allows arbitrary key/value pairs but
 *  recommends snake_case keys. Values must be JSON-serializable. */
export type HubEventAttrs = Record<string, unknown>;

/** True when the operator has opted into structured envelope output. Read
 *  once at call time (no module-level snapshot) so a hub process started in
 *  text mode can still flip to JSON mode if the env is mutated — useful for
 *  test setups that toggle the env var per case. */
function envelopeEnabled(): boolean {
  return process.env.WOCLAW_LOG_FORMAT === 'json';
}

/** Stable dot-namespaced event identifier — e.g. `hub.topic.created`,
 *  `hub.message.published`. Kept separate from the human-readable message so
 *  downstream collectors can index and group without parsing free text. */
export interface HubEventInput {
  level: HubLogLevel;
  event: string;
  attrs?: HubEventAttrs;
  context?: HubEventContext;
}

/** Emit a structured envelope event.
 *
 *  In `text` mode (the default, set when `WOCLAW_LOG_FORMAT` is unset or
 *  anything other than `json`), this is a no-op — preserving byte-identical
 *  console output for the 28+ existing hubLog/hubWarn/hubError call sites.
 *
 *  In `json` mode, emits one NDJSON line to the matching `console.*`
 *  channel with the shape:
 *    {"ts":<ms>,"level":"info","event":"hub.topic.created",
 *     "trace_id":"...","span_id":"...","topic_id":"...",
 *     "session_key":"...","agent_id":"...","duration_ms":123,
 *     "attrs":{...}}
 *
 *  Field presence is conditional — only set keys appear in the JSON
 *  object. The `attrs` payload uses `JSON.stringify` and never throws on
 *  circular refs in production paths because the helper wraps the call in
 *  try/catch and falls back to a safe envelope (best-effort, no process
 *  abort).
 *
 *  Why a separate helper rather than overloading hubLog/hubWarn/hubError:
 *  the canonical helpers keep their `(msg: string, ...args)` shape so all
 *  28+ existing call sites compile unchanged. HubEvent is the
 *  opt-in upgrade path — callers that want envelopes migrate their sites
 *  to `hubEvent({...})` explicitly, leaving legacy sites intact. */
export function hubEvent(input: HubEventInput): void {
  if (!envelopeEnabled()) return;
  const ts = Date.now();
  const envelope: Record<string, unknown> = {
    ts,
    level: input.level,
    event: input.event,
  };
  const ctx = input.context ?? {};
  if (ctx.trace_id !== undefined) envelope.trace_id = ctx.trace_id;
  if (ctx.span_id !== undefined) envelope.span_id = ctx.span_id;
  if (ctx.topic_id !== undefined) envelope.topic_id = ctx.topic_id;
  if (ctx.session_key !== undefined) envelope.session_key = ctx.session_key;
  if (ctx.agent_id !== undefined) envelope.agent_id = ctx.agent_id;
  if (ctx.duration_ms !== undefined) envelope.duration_ms = ctx.duration_ms;
  if (input.attrs !== undefined) envelope.attrs = input.attrs;
  let line: string;
  try {
    line = JSON.stringify(envelope);
  } catch {
    // Best-effort fallback — keep observability non-fatal even on
    // pathological input. The envelope keeps its required fields.
    line = JSON.stringify({ ts, level: input.level, event: input.event, attrs: '<unserializable>' });
  }
  switch (input.level) {
    case 'warn':
      console.warn(line);
      break;
    case 'error':
      console.error(line);
      break;
    case 'info':
    default:
      console.log(line);
      break;
  }
}
