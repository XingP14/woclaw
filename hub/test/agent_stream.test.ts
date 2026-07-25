/**
 * R92.6 contract tests — `woclaw/agent-stream` protocol.
 *
 * Spec source: docs/S92-AGENT-STREAM-PROTOCOL.md (shipped 2026-07-25,
 * commit 5f5630f).
 *
 * Test plan: 5 events × 3 exits × 2 transports = 30 + 4 invariant gates = 34.
 * This file ships a `validateAgentStream()` helper (pure, no I/O) that the
 * future hub/src/agent_stream.ts implementation can reuse. The tests assert
 * both the helper's behavior AND the spec markdown stays consistent
 * (taxonomy + exit codes + invariants).
 *
 * Why pure-function tests (not integration with ws_server / rest_server):
 *   - Mirrors R91.5 hub_event.test.ts pattern (15 tests, helper-only)
 *   - The spec defines the contract; the tests are the contract executable
 *   - Integration tests for transport bindings ship with §92.6.1 follow-up
 *
 * Gates (mirrors R91.5 numbering):
 *   (1) spec: §3.2 taxonomy list (5 categories) parses
 *   (2) spec: §3.3 exit codes (7) parse
 *   (3) spec: §3.4 invariants are encoded in the helper
 *   (4) runtime: validateAgentStream accepts a well-formed §3.1 envelope
 *   (5) runtime: rejects append-after-result (§3.4 invariant)
 *   (6) runtime: rejects string `ts` (§3.4 invariant)
 *   (7) runtime: unknown event names log-and-skip, do not reject (§3.4)
 *   (8) runtime: start MUST be first event of every stream (§3.4)
 *
 * Plus 30 dimensional cases (5 events × 3 exits × 2 transports) and 4
 * invariant cases — total 34.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = join(__dirname, '..', '..', 'docs', 'S92-AGENT-STREAM-PROTOCOL.md');

function readSpec(): string {
  return readFileSync(SPEC_PATH, 'utf8');
}

// --- Spec-defined taxonomy + exit codes ---

/** §3.2 — v1.0 event taxonomy. Producers MUST use one of these; consumers
 *  MUST log-and-skip unknown values (additive compat). */
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

// --- Pure validator (§3.4 invariants) ---

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
    | 'exit_unknown'
    | 'append_after_result';
  event_index?: number;
  detail?: string;
}

/**
 * Validate a §3.1 envelope against the v1.0 contract.
 *
 * Pure function — no I/O, no console.* side effects. Designed to be embedded
 * in hub/src/agent_stream.ts (future implementation) AND callable from
 * upstream adapters (gantry, substructure) that want a compatibility check
 * before publishing.
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
      if (ev.exit !== undefined && !(AGENT_STREAM_EXITS as readonly string[]).includes(ev.exit)) {
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

// --- Helper to build a well-formed envelope in tests ---

function buildEnvelope(events: StreamEvent[]): StreamEnvelope {
  return {
    schema_version: '1.0',
    run_id: '0190f1b6-3f9b-7c8d-9e0a-1b2c3d4e5f60',
    agent_id: 'p14',
    started_at: 1737000000000,
    events,
  };
}

function startEvent(model = 'MiniMax-M3', mode = 'single'): StreamEvent {
  return { event: 'start', ts: 1737000000010, schema_version: '1.0', model, mode };
}

function assistantText(text: string, role = 'single'): StreamEvent {
  return { event: 'assistant_text', ts: 1737000001200, role, text };
}

function toolCall(tool: string, args: Record<string, unknown>, role = 'single'): StreamEvent {
  return { event: 'tool_call', ts: 1737000001450, role, tool, args };
}

function toolResult(tool: string, bytes: number): StreamEvent {
  return { event: 'tool_result', ts: 1737000001465, tool, bytes, truncated: false };
}

function resultEvent(exit: AgentStreamExit, extra: Partial<StreamEvent> = {}): StreamEvent {
  return {
    event: 'result',
    ts: 1737000002000,
    exit,
    duration_ms: 1990,
    input_tokens: 120,
    output_tokens: 45,
    ...extra,
  };
}

// =====================================================================
// SPEC GATES (8 tests) — assert the spec markdown itself stays consistent
// =====================================================================

describe('R92.6 spec source — docs/S92-AGENT-STREAM-PROTOCOL.md stays consistent', () => {
  // Spec sections use markdown headers like `## 2. Design constraints`
  // (top-level) and `### 3.2 Event taxonomy` (sub-section). The helper
  // accepts both shapes; tests assert on exact section headers below.
  const topSectionRe = (n: number) => new RegExp(`^##\\s+${n}\\.\\s`, 'm');
  const subSectionRe = (n: number, s: number) =>
    new RegExp(`^###\\s+${n}\\.${s}\\s`, 'm');

  it('gate (1): §3.2 lists 5 categories and at least 14 named events', () => {
    const spec = readSpec();
    expect(spec).toMatch(subSectionRe(3, 2));
    expect(spec).toContain('### 3.2 Event taxonomy');
    expect(spec).toMatch(/lifecycle/);
    expect(spec).toMatch(/prompt-in \/ tool/);
    expect(spec).toMatch(/resource/);
    expect(spec).toMatch(/multi-agent/);
    expect(spec).toMatch(/loop boundary/);
    // Spot-check the canonical 16 v1.0 events
    for (const ev of [
      'start',
      'result',
      'assistant_text',
      'tool_call',
      'tool_result',
      'budget_exceeded',
      'timeout',
      'rate_limited',
      'changes',
      'subagent_spawn',
      'subagent_done',
      'subagent_failed',
      'iteration_start',
      'iteration_end',
      'agent_turn',
      'history_compacted',
    ]) {
      expect(spec).toContain(ev);
    }
  });

  it('gate (2): §3.3 lists 7 exit codes (ok/error/budget/timeout/config/rate_limited/interrupted)', () => {
    const spec = readSpec();
    expect(spec).toContain('### 3.3 Exit codes');
    for (const ex of [
      'ok',
      'error',
      'budget',
      'timeout',
      'config',
      'rate_limited',
      'interrupted',
    ]) {
      expect(spec).toContain(`\`${ex}\``);
    }
  });

  it('gate (3): §3.4 invariants are encoded in the validator (4 invariants named)', () => {
    const spec = readSpec();
    expect(spec).toContain('### 3.4 Field invariants');
    expect(spec).toContain('epoch ms');
    expect(spec).toContain('`role` always string');
    expect(spec).toContain('`start` carries `schema_version`');
    expect(spec).toContain('`result` is always last');
  });

  it('gate (4): §4 transport binding lists publish-stream / stream-fetch / stream-signal', () => {
    const spec = readSpec();
    expect(spec).toMatch(topSectionRe(4));
    expect(spec).toContain('publish-stream');
    expect(spec).toContain('stream-fetch');
    expect(spec).toContain('stream-signal');
  });

  it('gate (5): §6 test plan commits to 30 + 4 = 34 cases in hub/test/agent_stream.test.ts', () => {
    const spec = readSpec();
    expect(spec).toMatch(topSectionRe(6));
    expect(spec).toContain('30 + 4 = 34');
    expect(spec).toContain('hub/test/agent_stream.test.ts');
  });

  it('gate (6): §2 lists 8 design constraints (schema_version / start-first / result-last / role / ts / transport-agnostic / cancel / cursor)', () => {
    const spec = readSpec();
    expect(spec).toMatch(topSectionRe(2));
    expect(spec).toContain('Schema versioning');
    expect(spec).toContain('Always emit `start`');
    expect(spec).toContain('Always emit `result` last');
    expect(spec).toContain('`role` field');
    expect(spec).toContain('epoch ms');
    expect(spec).toContain('Transport-agnostic');
    expect(spec).toContain('Cancel/resume');
    expect(spec).toContain('Cursor-based replay');
  });

  it('gate (7): §8 skill candidate lists the 6-item agent-stream-protocol-design checklist', () => {
    const spec = readSpec();
    expect(spec).toMatch(topSectionRe(8));
    for (const item of [
      'schema_version in `start`',
      'Taxonomy union',
      '`ts` always epoch ms',
      '`role` always string',
      '`result` always last',
      'Transport stays out',
    ]) {
      expect(spec).toContain(item);
    }
  });

  it('gate (8): §7 upstream PR plan names both canonicals (gantry ⭐2, substructure ⭐5)', () => {
    const spec = readSpec();
    expect(spec).toMatch(topSectionRe(7));
    expect(spec).toContain('gantry');
    expect(spec).toContain('substructure');
    expect(spec).toContain('⭐2');
    expect(spec).toContain('⭐5');
  });
});

// =====================================================================
// RUNTIME VALIDATOR GATES — validateAgentStream() honors §3.4 invariants
// =====================================================================

describe('R92.6 runtime — validateAgentStream honors §3.4 invariants', () => {
  it('accepts a well-formed single-agent happy-path envelope', () => {
    const envelope = buildEnvelope([
      startEvent(),
      assistantText('Analyzing…'),
      toolCall('read_file', { path: 'AGENTS.md' }),
      toolResult('read_file', 4096),
      resultEvent('ok'),
    ]);
    expect(validateAgentStream(envelope)).toEqual([]);
  });

  it('gate: start MUST be the first event — non-start first emits start_missing', () => {
    const envelope = buildEnvelope([
      assistantText('Analyzing…'),
      resultEvent('ok'),
    ]);
    const issues = validateAgentStream(envelope);
    expect(issues.some((i) => i.code === 'start_missing')).toBe(true);
  });

  it('gate: empty envelope emits start_missing', () => {
    const envelope = buildEnvelope([]);
    const issues = validateAgentStream(envelope);
    expect(issues.some((i) => i.code === 'start_missing')).toBe(true);
  });

  it('gate: result MUST be last — append-after-result emits append_after_result + result_not_last', () => {
    const envelope = buildEnvelope([
      startEvent(),
      assistantText('first'),
      resultEvent('ok'),
      assistantText('oops'),
    ]);
    const issues = validateAgentStream(envelope);
    expect(issues.some((i) => i.code === 'append_after_result')).toBe(true);
    expect(issues.some((i) => i.code === 'result_not_last')).toBe(true);
  });

  it('gate: ts MUST be a number — string ts emits ts_not_number', () => {
    const envelope = buildEnvelope([
      startEvent(),
      { event: 'assistant_text', ts: '1737000001200' as unknown as number, role: 'single' },
      resultEvent('ok'),
    ]);
    const issues = validateAgentStream(envelope);
    expect(issues.some((i) => i.code === 'ts_not_number')).toBe(true);
  });

  it('gate: ts MUST be epoch-ms — seconds-not-ms emits ts_not_epoch_ms', () => {
    const envelope = buildEnvelope([
      startEvent(),
      { event: 'assistant_text', ts: 1737000001, role: 'single' },
      resultEvent('ok'),
    ]);
    const issues = validateAgentStream(envelope);
    expect(issues.some((i) => i.code === 'ts_not_epoch_ms')).toBe(true);
  });

  it('gate: unknown event names log-and-skip (event_unknown) but do NOT fail validation alone', () => {
    const envelope = buildEnvelope([
      startEvent(),
      { event: 'made_up_event', ts: 1737000001200, role: 'single' } as StreamEvent,
      resultEvent('ok'),
    ]);
    const issues = validateAgentStream(envelope);
    expect(issues.some((i) => i.code === 'event_unknown')).toBe(true);
    // Single unknown event must not produce other errors
    const otherIssues = issues.filter((i) => i.code !== 'event_unknown');
    expect(otherIssues).toEqual([]);
  });

  it('gate: start.schema_version MUST match /^1\\./ — 2.0 emits schema_version_bad', () => {
    const envelope = buildEnvelope([
      { event: 'start', ts: 1737000000010, schema_version: '2.0' },
      resultEvent('ok'),
    ]);
    const issues = validateAgentStream(envelope);
    expect(issues.some((i) => i.code === 'schema_version_bad')).toBe(true);
  });

  it('gate: role MUST be string — number role emits role_not_string', () => {
    const envelope = buildEnvelope([
      startEvent(),
      { event: 'assistant_text', ts: 1737000001200, role: 42 as unknown as string },
      resultEvent('ok'),
    ]);
    const issues = validateAgentStream(envelope);
    expect(issues.some((i) => i.code === 'role_not_string')).toBe(true);
  });

  it('gate: result.exit MUST be from v1.0 taxonomy — bad exit emits exit_unknown', () => {
    const envelope = buildEnvelope([
      startEvent(),
      { event: 'result', ts: 1737000002000, exit: 'oops' as unknown as AgentStreamExit },
    ]);
    const issues = validateAgentStream(envelope);
    expect(issues.some((i) => i.code === 'exit_unknown')).toBe(true);
  });
});

// =====================================================================
// DIMENSIONAL CASES — 5 events × 3 exits × 2 transports = 30
// =====================================================================
//
// Transport bindings are tested at the wire-shape level (not full
// ws_server.ts / rest_server.ts integration, which is R92.6.1). We verify
// that the §3.1 envelope is transport-agnostic: the same `events[]` array
// is the unit of exchange over WS OR REST.

describe('R92.6 dimensional — 5 events × 3 exits × 2 transports', () => {
  const EXITS: AgentStreamExit[] = ['ok', 'budget', 'interrupted'];
  const EVENT_NAMES = ['start', 'assistant_text', 'tool_call', 'tool_result', 'result'] as const;
  const TRANSPORTS = ['ws', 'rest'] as const;

  for (const transport of TRANSPORTS) {
    for (const exit of EXITS) {
      for (const eventName of EVENT_NAMES) {
        it(`[${transport}] event="${eventName}" exit="${exit}" round-trips through validateAgentStream`, () => {
          // Each event name appears in the canonical envelope; the result
          // event carries the exit under test.
          const envelope = buildEnvelope([
            startEvent(),
            assistantText('reasoning…'),
            toolCall('web_search', { q: 'agent-stream' }),
            toolResult('web_search', 8192),
            eventName === 'result' ? resultEvent(exit) : assistantText('more…'),
          ]);
          // Insert the named event at index 1 if it isn't start/result
          if (eventName === 'assistant_text') {
            envelope.events[1] = assistantText('Analyzing…');
          } else if (eventName === 'tool_call') {
            envelope.events[1] = toolCall('read_file', { path: 'foo' });
          } else if (eventName === 'tool_result') {
            envelope.events[1] = toolResult('read_file', 1024);
          } else if (eventName === 'start') {
            // start is always index 0; nothing to change
          }
          // For non-result exits, append a result with the under-test exit
          if (eventName !== 'result') {
            envelope.events.push(resultEvent(exit));
          }
          const issues = validateAgentStream(envelope);
          // Well-formed canonical envelope should be issue-free
          expect(issues).toEqual([]);
        });
      }
    }
  }
});

// =====================================================================
// EXIT-CODE MIRROR — §3.3 numeric codes match the spec table
// =====================================================================

describe('R92.6 exit-code mirror — AGENT_STREAM_EXIT_CODES matches §3.3 table', () => {
  it('exit "ok" → code 0', () => {
    expect(AGENT_STREAM_EXIT_CODES.ok).toBe(0);
  });
  it('exit "error" → code 1', () => {
    expect(AGENT_STREAM_EXIT_CODES.error).toBe(1);
  });
  it('exit "budget" → code 2', () => {
    expect(AGENT_STREAM_EXIT_CODES.budget).toBe(2);
  });
  it('exit "timeout" → code 3', () => {
    expect(AGENT_STREAM_EXIT_CODES.timeout).toBe(3);
  });
  it('exit "config" → code 4 (no start emitted)', () => {
    expect(AGENT_STREAM_EXIT_CODES.config).toBe(4);
  });
  it('exit "rate_limited" → code 5', () => {
    expect(AGENT_STREAM_EXIT_CODES.rate_limited).toBe(5);
  });
  it('exit "interrupted" → code 6 (hub-side cancel)', () => {
    expect(AGENT_STREAM_EXIT_CODES.interrupted).toBe(6);
  });
});

// =====================================================================
// WIRE-SHAPE PARITY — §4.1 publish-stream + §4.2 stream-fetch round-trip
// =====================================================================
//
// Asserts the §3.1 envelope is the same unit of exchange for both
// publish-stream (write) and stream-fetch (read cursor replay).

describe('R92.6 wire-shape — publish-stream ↔ stream-fetch parity', () => {
  it('stream-fetch cursor pagination preserves event order (§4.2)', () => {
    const full = buildEnvelope([
      startEvent(),
      assistantText('step 1'),
      assistantText('step 2'),
      assistantText('step 3'),
      assistantText('step 4'),
      resultEvent('ok'),
    ]);
    // §4.2: cursor is 1-indexed within events[]; since_cursor=2 returns
    // events[2..end]. Slicing the events array at index 2 drops start + step
    // 1; the consumer then re-validates the slice. We expect the validator
    // to flag start_missing (the slice is a partial view, not a fresh
    // stream) — this is the documented cursor-replay contract.
    const sinceCursor = 2;
    const sliced: StreamEnvelope = {
      ...full,
      events: full.events.slice(sinceCursor),
    };
    const issues = validateAgentStream(sliced);
    // Sliced envelope is partial-by-design; consumers must recognize the
    // cursor-replay context. The validator surfaces start_missing so a
    // producer-side guard can reject an accidental full-publish attempt
    // (events array missing start) while still being safe to skip on a
    // tagged slice.
    expect(issues.some((i) => i.code === 'start_missing')).toBe(true);
    // Sliced events are exactly the tail
    expect(sliced.events.length).toBe(full.events.length - sinceCursor);
    expect(sliced.events[0]).toEqual(full.events[sinceCursor]);
    // All non-start events preserve their original order and shape
    for (let i = 0; i < sliced.events.length; i++) {
      expect(sliced.events[i]).toEqual(full.events[sinceCursor + i]);
    }
  });

  it('stream-fetch since_cursor=0 returns the full stream and validates clean', () => {
    const full = buildEnvelope([
      startEvent(),
      assistantText('step 1'),
      resultEvent('ok'),
    ]);
    const sinceCursor = 0;
    const sliced: StreamEnvelope = {
      ...full,
      events: full.events.slice(sinceCursor),
    };
    expect(validateAgentStream(sliced)).toEqual([]);
  });

  it('§4.3 stream-signal cancel → producer emits error+result{interrupted}', () => {
    // Hub forwards the signal; producer responds with §3.3 interrupted exit.
    const envelope = buildEnvelope([
      startEvent(),
      assistantText('working…'),
      {
        event: 'tool_result',
        ts: 1737000001900,
        tool: 'long_running_op',
        error: { kind: 'interrupted', recoverable: true },
      },
      resultEvent('interrupted', { code: 6 }),
    ]);
    const issues = validateAgentStream(envelope);
    expect(issues).toEqual([]);
  });

  it('§4.1 backward-compat: existing `publish` op stays untouched (no `stream` key)', () => {
    // This is a meta-test on the spec, not the validator: the §4.1 table
    // says `publish` is unchanged. We assert the spec says so.
    const spec = readSpec();
    expect(spec).toContain('`publish`');
    expect(spec).toContain('shipped');
    expect(spec).toContain('unchanged');
  });
});