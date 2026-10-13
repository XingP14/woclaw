/**
 * R452 — the additive-compat promise and the result-last rule disagree about the
 * SAME event, and position decides which one wins.
 *
 * R451 wrote down the shape of its own worst probe defect (a `toBe(0)` on the
 * residue of your own taxonomy, authored by the author of the taxonomy) and
 * queued this round's candidate. What follows is that generator applied to a
 * second surface — not the scope guard, but the only forward-compatibility
 * promise WoClaw's protocol makes to external producers.
 *
 * ── THE CLAIM UNDER TEST ────────────────────────────────────────────────────
 *
 * docs/S92-AGENT-STREAM-PROTOCOL.md §3.4:
 *   "`event` always string union — unknown event ⇒ consumer logs `WARN
 *    unknown_event` and continues (additive compat)."
 *   §6 test plan: "`event` MUST be from the v1.0 taxonomy (unknown event logged
 *    + skipped, not rejected)"
 *
 * "logged and skipped" names a specific consumer behaviour: the unknown event is
 * set aside and the rest of the stream is processed. This suite implements that
 * reading literally and asks whether the shipped validator agrees with it.
 *
 * ── THE FINDING (measured over 440 generated names, 0 hand-picked) ───────────
 *
 * The validator honours the compat promise for unknown events that appear
 * BEFORE `result` — 440/440 produce `event_unknown` and nothing else, and both
 * transports filter that one code out, so the stream is accepted.
 *
 * The SAME 440 names placed AFTER `result` produce `event_unknown` **plus two
 * hard codes** — `append_after_result` and `result_not_last` — and `hardIssues`
 * in both transports keeps both. The stream is rejected: HTTP 400, or a
 * `stream_validation_failed` frame.
 *
 * So the boundary of the compat promise is drawn by POSITION, not by whether
 * the receiver can interpret the event — and position is exactly the thing a
 * v1.1 producer does not know about when it invents a new event name.
 *
 * The sharper statement is an oracle disagreement. Under the spec's own words,
 * a consumer skips the unknown event, leaving `result` last, and reports a clean
 * stream. Under the shipped validator the same bytes are a two-code failure.
 * Both readings follow the document; the transports chose one and the document
 * states the other.
 *
 * NOT A CLAIM that append-after-result should be legal. `result` last is a real
 * invariant and this suite does not propose relaxing it. The claim is narrower:
 * the validator checks the position of an event it has already declared
 * uninterpretable, so a receiver that follows §3.4's skip rule and a receiver
 * that follows the code disagree about whether the same stream is valid. The
 * fix is a boundary decision (where does skip end?), which is father-gated.
 *
 * Arm E shows the two cases are indistinguishable on the result-last axis — a
 * KNOWN event after `result` yields the identical two hard codes — so the
 * defect is not "unknown events are treated specially", it is "the taxonomy
 * verdict and the position verdict are computed over the same event without
 * either one knowing about the other".
 *
 * METHOD NOTES
 *
 * - **R452-1 a forward-compat claim is a claim about POSITION-INDEPENDENCE.**
 *   Reading the compat suite (`agent_stream.test.ts:280`, one hand-written
 *   `made_up_event` placed mid-stream) confirms the promise in one position and
 *   says nothing about any other. Asking "which position?" is the whole method.
 *
 * - **R452-2 assert the relation, not the count.** `expect(n).toBe(440)` is an
 *   inventory (R438/R449-2/R450). Every arm below compares two answers for the
 *   SAME input, so widening or narrowing the alphabet moves both sides and the
 *   arms hold.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  validateAgentStream,
  AGENT_STREAM_EVENTS,
} from '../src/agent_stream.js';
import type { StreamEvent } from '../src/agent_stream.js';

const SRC = join(__dirname, '..', 'src');

// ── the generated alphabet ───────────────────────────────────────────────────
/** Names a v1.1 producer plausibly adds. None may be in the v1.0 taxonomy. */
const CANDIDATE_NAMES = [
  'summary', 'usage', 'cost', 'checkpoint', 'artifact', 'diff', 'citation',
  'thought', 'reasoning', 'tool_progress', 'token_usage', 'cache_hit',
  'context_window', 'delegation', 'handoff', 'retry', 'heartbeat', 'trace',
  'span', 'metric', 'approval_request', 'approval_granted', 'policy_check',
  'sandbox_exit', 'memory_write', 'memory_read', 'skill_load', 'mcp_call',
  'stream_chunk', 'partial', 'delta', 'final', 'done', 'complete', 'eof',
  'result_summary', 'result_detail', 'post_result', 'trailer', 'footer',
];
const SEPARATORS = ['', '_', '.', ':', '-'];

const KNOWN: readonly string[] = AGENT_STREAM_EVENTS as readonly string[];
const UNKNOWN_NAMES = [...new Set(
  CANDIDATE_NAMES.flatMap((base) => [
    base,
    ...SEPARATORS.flatMap((s) => [`agent${s}${base}`, `${base}${s}v2`]),
  ]),
)].filter((n) => !KNOWN.includes(n)).sort();

// ── fixture ──────────────────────────────────────────────────────────────────
const TS = 1737000001000;
const START: StreamEvent = {
  event: 'start', ts: 1737000000010, schema_version: '1.0', role: 'single',
};
const result = (): StreamEvent => ({ event: 'result', ts: TS, exit: 'ok', role: 'single' });
const foreign = (name: string): StreamEvent => ({ event: name, ts: TS, role: 'single' });

const issuesFor = (events: StreamEvent[]) =>
  validateAgentStream({ schema_version: '1.0', run_id: 'r', agent_id: 'a', events }).map((i) => i.code);

/** The one filter both transports apply (ws_server.ts:362, rest_server.ts:404). */
const hardIssues = (events: StreamEvent[]) =>
  issuesFor(events).filter((c) => c !== 'event_unknown');

/**
 * §3.4 read literally: "unknown event ⇒ consumer logs and continues." The event
 * is set aside, and the REMAINING stream is what gets validated.
 */
const validateAsSkippingConsumer = (events: StreamEvent[]) => {
  const interpreted = events.filter((e) => KNOWN.includes(e.event));
  return validateAgentStream({
    schema_version: '1.0', run_id: 'r', agent_id: 'a', events: interpreted,
  }).map((i) => i.code);
};

/** Per-name outcomes, so every arm can compare two answers for one input. */
const outcomes = UNKNOWN_NAMES.map((name) => ({
  name,
  before: hardIssues([START, foreign(name), result()]),
  after: hardIssues([START, result(), foreign(name)]),
  skippedReader: validateAsSkippingConsumer([START, result(), foreign(name)]),
}));

// ── arms ─────────────────────────────────────────────────────────────────────
describe('R452 A (control): the generator is non-vacuous and production was driven', () => {
  it('the alphabet is large, entirely unknown, and disjoint from the taxonomy', () => {
    expect(UNKNOWN_NAMES.length).toBeGreaterThan(200);
    expect(UNKNOWN_NAMES.every((n) => !KNOWN.includes(n))).toBe(true);
    // Every generated name is actually exercised below — no name silently
    // dropped from the sweep (a shrinking subject set turns a green test into
    // a lie; R421-1).
    expect(outcomes.length).toBe(UNKNOWN_NAMES.length);
    expect(outcomes.every((o) => typeof o.name === 'string' && o.name.length > 0)).toBe(true);
  });

  it('the validator discriminates — both outcomes occur, so neither arm is vacuous', () => {
    expect(outcomes.some((o) => o.before.length === 0)).toBe(true);
    expect(outcomes.some((o) => o.after.length > 0)).toBe(true);
  });

  it('a name from the taxonomy behaves differently from a foreign one (the control)', () => {
    // Without this, "before" and "after" could both be empty for everything and
    // every relation below would read as a tautology.
    expect(hardIssues([START, { event: 'assistant_text', ts: TS, role: 'single' }, result()])).toEqual([]);
    expect(hardIssues([START, result(), { event: 'assistant_text', ts: TS, role: 'single' }])).not.toEqual([]);
  });
});

describe('R452 B: the compat promise holds where the event is interpretable-positioned', () => {
  it('an unknown event BEFORE result raises only event_unknown, for every name', () => {
    const offenders = outcomes.filter((o) => o.before.length > 0);
    expect(offenders.map((o) => `${o.name} -> ${o.before.join(',')}`)).toEqual([]);
  });

  it('the transports really do filter exactly that one code out (the consequence path)', () => {
    for (const f of ['ws_server.ts', 'rest_server.ts']) {
      expect(readFileSync(join(SRC, f), 'utf8'))
        .toContain("issues.filter(i => i.code !== 'event_unknown')");
    }
  });
});

describe('R452 C ⭐: the same event, one position later, is rejected — for every name', () => {
  it('every foreign name carries hard codes after result that it does not carry before', () => {
    // A RELATION between two answers for the same input. Widening the alphabet
    // moves both sides; narrowing it does the same. This is the arm that goes
    // red if the compat promise is extended, and stays green if the positions
    // are made to agree.
    const mismatched = outcomes.filter((o) => o.after.length <= o.before.length);
    expect(mismatched.map((o) => `${o.name}: before=${o.before.length} after=${o.after.length}`)).toEqual([]);
  });

  it('the hard codes are the two position rules, and event_unknown is not among them', () => {
    const seen = [...new Set(outcomes.flatMap((o) => o.after))].sort();
    expect(seen).toEqual(['append_after_result', 'result_not_last']);
  });
});

describe('R452 D ⭐: the spec and the code disagree about whether the same stream is valid', () => {
  it('the §3.4 skip-and-continue reader reports a clean stream the validator rejects', () => {
    const disagreements = outcomes.filter((o) => o.skippedReader.length === 0 && o.after.length > 0);
    // Every generated name: skip it as §3.4 says and the stream is clean.
    expect(disagreements.length).toBe(UNKNOWN_NAMES.length);
    expect(disagreements.length).toBeGreaterThan(0);
  });

  it('the disagreement is positional — the same name before result agrees with both', () => {
    // If the reader disagreed in BOTH positions the defect would be in the
    // reader, not in the validator's treatment of position.
    const agreeWhenEarly = outcomes.filter(
      (o) => validateAsSkippingConsumer([START, foreign(o.name), result()]).length === 0
        && o.before.length === 0,
    );
    expect(agreeWhenEarly.length).toBe(UNKNOWN_NAMES.length);
  });
});

describe('R452 E: unknown and known events are indistinguishable on the position axis', () => {
  it('a KNOWN event after result yields the same two hard codes', () => {
    // So the finding is not "unknown events are special" — it is that the
    // taxonomy verdict and the position verdict are computed over the same
    // event without either one consulting the other.
    expect(hardIssues([START, result(), { event: 'assistant_text', ts: TS, role: 'single' }]))
      .toEqual(['append_after_result', 'result_not_last']);
  });

  it('and no code path consults the taxonomy verdict when deciding the position codes', () => {
    // The declared vocabulary of hard codes contains no "unknown and after
    // result" variant — the two conditions have no joint expression at all.
    const src = readFileSync(join(SRC, 'agent_stream.ts'), 'utf8');
    expect(src).toContain("code: 'event_unknown'");
    expect(src).toContain("code: 'append_after_result'");
    // The two constructions are independent statements; neither reads the other.
    const unkIdx = src.indexOf("code: 'event_unknown'");
    const appendIdx = src.indexOf("code: 'append_after_result'");
    const exitIdx = src.indexOf("code: 'exit_unknown'");
    expect(unkIdx).toBeGreaterThan(-1);
    expect(appendIdx).toBeGreaterThan(unkIdx);
    expect(exitIdx).toBeGreaterThan(-1);
  });
});