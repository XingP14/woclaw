// hub/src/agent_stream.ts
//
// R92.6 — woclaw/agent-stream protocol validator.
//
// Spec source: docs/S92-AGENT-STREAM-PROTOCOL.md
//
// This module exports the canonical v1.0 contract constants
// (taxonomy / exit codes / schema version pattern) and a pure
// `validateAgentStream()` helper that enforces §3.4 invariants.
//
// Pure function — no I/O, no console.* side effects. Designed to be
// embedded in ws_server.ts / rest_server.ts / session_archive.ts for
// producer-side validation AND callable from upstream adapters that
// want a compatibility check before publishing.

// --- Spec-defined taxonomy + exit codes ---------------------------------

/** §3.2 — v1.0 event taxonomy. Producers MUST use one of these;
 *  consumers MUST log-and-skip unknown values (additive compat). */
export const AGENT_STREAM_EVENTS = [
  // lifecycle
  'start',
  'result',
  // prompt-in / tool
  'assistant_text',
  'tool_call',
  'tool_result',
  // resource
  'budget_exceeded',
  'timeout',
  'rate_limited',
  'changes',
  // multi-agent
  'subagent_spawn',
  'subagent_done',
  'subagent_failed',
  // loop boundary
  'iteration_start',
  'iteration_end',
  'agent_turn',
  'history_compacted',
] as const;
export type AgentStreamEvent = (typeof AGENT_STREAM_EVENTS)[number];

/** §3.3 — v1.0 exit codes. `result.event` MUST carry one of these
 *  (plus `code` mirror) and MUST be the last event. */
export const AGENT_STREAM_EXITS = [
  'ok',
  'error',
  'budget',
  'timeout',
  'config',
  'rate_limited',
  'interrupted',
] as const;
export type AgentStreamExit = (typeof AGENT_STREAM_EXITS)[number];

/** §3.3 — exit code mirror (numeric). */
export const AGENT_STREAM_EXIT_CODES: Record<AgentStreamExit, number> = {
  ok: 0,
  error: 1,
  budget: 2,
  timeout: 3,
  config: 4,
  rate_limited: 5,
  interrupted: 6,
};

/** §2 — schema versioning rule. Producers MUST emit `start.schema_version`
 *  that matches this pattern. */
export const SCHEMA_VERSION_PATTERN = /^1\./;

// --- Types ----------------------------------------------------------------

export interface StreamEvent {
  event: string;
  ts: number;
  schema_version?: string;
  role?: string;
  exit?: AgentStreamExit;
  [k: string]: unknown;
}

export interface StreamEnvelope {
  schema_version?: string;
  run_id?: string;
  agent_id?: string;
  started_at?: number;
  events: StreamEvent[];
}

export interface ValidationIssue {
  code:
    | 'start_missing'
    | 'result_not_last'
    | 'ts_not_number'
    | 'ts_not_epoch_ms'
    | 'event_unknown'
    | 'schema_version_bad'
    | 'role_not_string'
    | 'exit_missing'
    | 'exit_unknown'
    | 'append_after_result';
  event_index?: number;
  detail?: string;
}

// --- Pure validator (§3.4 invariants) -----------------------------------

/**
 * Validate a §3.1 envelope against the v1.0 contract.
 *
 * Pure function — no I/O, no console.* side effects.
 *
 * Returns an empty array on a fully-valid envelope. Unknown event names are
 * reported but DO NOT fail validation (§3.4 additive-compat rule).
 */
export function validateAgentStream(envelope: StreamEnvelope): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!envelope.events || envelope.events.length === 0) {
    issues.push({ code: 'start_missing', detail: 'envelope has no events' });
    return issues;
  }

  // Gate: start MUST be first (§3.4)
  const first = envelope.events[0];
  if (first.event !== 'start') {
    issues.push({
      code: 'start_missing',
      event_index: 0,
      detail: `first event is "${first.event}", expected "start"`,
    });
  } else {
    // Gate: start carries schema_version that matches ^1.
    const sv = first.schema_version;
    if (typeof sv !== 'string' || !SCHEMA_VERSION_PATTERN.test(sv)) {
      issues.push({
        code: 'schema_version_bad',
        event_index: 0,
        detail: `start.schema_version="${String(sv)}" does not match /^1\\./`,
      });
    }
  }

  // Walk events checking per-event invariants + result-last rule
  let resultSeenAt: number | undefined;
  for (let i = 0; i < envelope.events.length; i++) {
    const ev = envelope.events[i];

    // Gate: ts MUST be a number (string rejected per §3.4)
    if (typeof ev.ts !== 'number' || Number.isNaN(ev.ts)) {
      issues.push({ code: 'ts_not_number', event_index: i, detail: `ts="${String(ev.ts)}"` });
    } else if (ev.ts < 1e12 || ev.ts > 1e13) {
      // epoch-ms sanity (between ~Sep 2001 and ~Nov 2286)
      issues.push({
        code: 'ts_not_epoch_ms',
        event_index: i,
        detail: `ts=${ev.ts} not in epoch-ms range`,
      });
    }

    // Gate: role always string (even "single" — §3.4)
    if (ev.role !== undefined && typeof ev.role !== 'string') {
      issues.push({ code: 'role_not_string', event_index: i });
    }

    // Gate: event MUST be from v1.0 taxonomy; unknown logs-and-skips (§3.4)
    if (!(AGENT_STREAM_EVENTS as readonly string[]).includes(ev.event)) {
      issues.push({
        code: 'event_unknown',
        event_index: i,
        detail: `event="${ev.event}" not in v1.0 taxonomy`,
      });
    }

    if (ev.event === 'result') {
      if (resultSeenAt !== undefined) {
        // Two result events — clear duplicate detection
        issues.push({
          code: 'append_after_result',
          event_index: i,
          detail: `result already seen at index ${resultSeenAt}`,
        });
      }
      resultSeenAt = i;
      if (ev.exit === undefined) {
        issues.push({ code: 'exit_missing', event_index: i, detail: 'result.exit is required' });
      } else if (!(AGENT_STREAM_EXITS as readonly string[]).includes(ev.exit)) {
        issues.push({ code: 'exit_unknown', event_index: i, detail: `exit="${String(ev.exit)}"` });
      }
    } else if (resultSeenAt !== undefined) {
      // Any non-result event appearing AFTER result is append-after-result
      // (§3.4 invariant: producer rejects append-after-result).
      issues.push({
        code: 'append_after_result',
        event_index: i,
        detail: `event "${ev.event}" appears after result at index ${resultSeenAt}`,
      });
    }
  }

  // Gate: result MUST be last (§3.4)
  if (resultSeenAt === undefined) {
    // Per §4.1, EOF-without-result is treated as exit: "config" by consumers.
    // The helper does not flag this as an issue — it is the producer's
    // responsibility to emit result; consumers' job to map EOF → config.
  } else if (resultSeenAt !== envelope.events.length - 1) {
    issues.push({
      code: 'result_not_last',
      event_index: resultSeenAt,
      detail: `result at index ${resultSeenAt}, events.length=${envelope.events.length}`,
    });
  }

  return issues;
}
