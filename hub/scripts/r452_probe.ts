// R452 probe scratch — drive the REAL validator with a generated alphabet of
// event names and exit codes, and measure whether §3.4's additive-compat rule
// ("unknown event ⇒ consumer logs and continues") holds, and where it stops.
import { validateAgentStream, AGENT_STREAM_EVENTS, AGENT_STREAM_EXITS } from '../src/agent_stream.js';
import type { StreamEvent } from '../src/agent_stream.js';

const TS = 1737000001000;
const START: StreamEvent = { event: 'start', ts: 1737000000010, schema_version: '1.0', role: 'single' };
const RESULT = (exit: string): StreamEvent =>
  ({ event: 'result', ts: TS, exit, role: 'single' }) as unknown as StreamEvent;

function validate(events: StreamEvent[]) {
  return validateAgentStream({ schema_version: '1.0', run_id: 'r', agent_id: 'a', events });
}
const codes = (evs: StreamEvent[]) => validate(evs).map((i) => i.code);
const KNOWN: readonly string[] = AGENT_STREAM_EVENTS as readonly string[];

const FUTURE_EVENTS = [
  'summary', 'usage', 'cost', 'checkpoint', 'artifact', 'diff', 'citation',
  'thought', 'reasoning', 'tool_progress', 'token_usage', 'cache_hit',
  'context_window', 'delegation', 'handoff', 'retry', 'heartbeat', 'trace',
  'span', 'metric', 'approval_request', 'approval_granted', 'policy_check',
  'sandbox_exit', 'memory_write', 'memory_read', 'skill_load', 'mcp_call',
  'stream_chunk', 'partial', 'delta', 'final', 'done', 'complete', 'eof',
  'result_summary', 'result_detail', 'post_result', 'trailer', 'footer',
];
const SEPS = ['', '_', '.', ':', '-'];

const generated: string[] = [];
for (const base of FUTURE_EVENTS) {
  generated.push(base);
  for (const s of SEPS) generated.push(`agent${s}${base}`, `${base}${s}v2`);
}
const UNIQUE = [...new Set(generated)].filter((n) => !KNOWN.includes(n));

const bucket = (cs: string[]) => cs.join(',') || '(none)';

// Q1: an unknown event BEFORE result
const q1: Record<string, number> = {};
const q1bad: string[] = [];
for (const name of UNIQUE) {
  const cs = codes([START, { event: name, ts: TS, role: 'single' }, RESULT('ok')]);
  const k = bucket(cs);
  q1[k] = (q1[k] || 0) + 1;
  if (cs.some((c) => c !== 'event_unknown')) q1bad.push(`${name} -> ${k}`);
}
console.log(`generated unknown names: ${UNIQUE.length}`);
console.log('Q1 (unknown before result):', q1);
console.log(`Q1 violations: ${q1bad.length}`, q1bad.slice(0, 6));

// Q2: an unknown event AFTER result
const q2: Record<string, number> = {};
const q2bad: string[] = [];
for (const name of UNIQUE) {
  const cs = codes([START, RESULT('ok'), { event: name, ts: TS, role: 'single' }]);
  const k = bucket(cs);
  q2[k] = (q2[k] || 0) + 1;
  if (cs.length !== 1 || cs[0] !== 'event_unknown') q2bad.push(`${name} -> ${k}`);
}
console.log('\nQ2 (unknown AFTER result):', q2);
console.log(`Q2 violations: ${q2bad.length}`, q2bad.slice(0, 6));

// Q3: unknown event carrying a field-shaped payload (the real forward-compat case)
const q3: Record<string, number> = {};
for (const name of ['summary', 'delta', 'eof', 'trailer']) {
  const k = bucket(codes([START, { event: name, ts: TS, text: 'hello', nested: { a: 1 } }, RESULT('ok')]));
  q3[k] = (q3[k] || 0) + 1;
}
console.log('\nQ3 (unknown, role omitted, extra fields):', q3);

// Q4: exit codes
const q4: Record<string, number> = {};
for (const x of ['ok', 'error', 'budget', 'timeout', 'config', 'rate_limited', 'interrupted',
                 'cancelled', 'canceled', 'aborted', 'killed', 'partial', 'done', 'ok_v2']) {
  const k = bucket(codes([START, RESULT(x)]));
  q4[k] = (q4[k] || 0) + 1;
}
console.log('\nQ4 exit outcomes:', q4);
console.log('exits declared:', AGENT_STREAM_EXITS.join(','));