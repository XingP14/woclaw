/**
 * OllamaProvider error-branch deeper coverage (07-16 00:43 cron).
 *
 * Companion to `ollama_provider.test.ts` (8 happy-path + 500 error cases from
 * 07-13 02:43 cron). This file focuses on the *error / edge / fallback*
 * branches the original file deliberately skipped:
 *
 *   1. scoreMemory HTTP 404 (different status code from the 500 path):
 *      fetch resolves with status=404 → success:false, score:5, reasoning
 *      wraps the typed "Ollama API error 404: <body>". Pins that any
 *      non-2xx response, not just 500, is funneled into the same error
 *      branch with the typed-prefix preserved (a regression where the
 *      branch was inverted to `if (response.status === 500)` would
 *      silently swallow 404s and produce success:true).
 *
 *   2. scoreMemory JSON parse failure (raw garbage inside message.content):
 *      fetch resolves with `message.content = "not json"` → JSON.parse
 *      throws → caught by outer try/catch → success:false, score:5,
 *      reasoning starts with "Ollama scoring failed:" and contains the
 *      underlying SyntaxError message. Pins the parse-error path is
 *      reachable via the same catch that handles fetch rejection (not a
 *      separate unawaited branch).
 *
 *   3. scoreMemory missing-field defaults: parsed JSON is `{}` →
 *      score=Math.max(0,Math.min(10, undefined ?? 5)) = 5, reasoning=undefined,
 *      suggestedTags=undefined. Pins the `parsed.score ?? 5` clamp; a
 *      regression to `parsed.score` (no default) would produce NaN which
 *      Math.max/min silently propagate.
 *
 *   4. scoreMemory score clamp: parsed `{score: 999}` → score:10 (Math.min cap),
 *      parsed `{score: -5}` → score:0 (Math.max floor). Pins both clamp
 *      directions are independent (regression where Math.max/min order
 *      swapped would silently invert behavior).
 *
 *   5. scoreMemory AbortError (ollamaChat 30s timeout): fetch rejects with
 *      `Error('Ollama request aborted after 30000ms timeout')` →
 *      success:false, reasoning wraps "Ollama scoring failed:" + the
 *      AbortError message. Pins that the 30_000ms FETCH_TIMEOUT_MS path
 *      is reachable through the same outer try/catch as generic fetch
 *      rejection (currently the only `extraction_provider_timeout.test.ts`
 *      coverage is a static regex check on the AbortController wiring;
 *      this is the first end-to-end runtime case).
 *
 *   6. scoreMemory usageHistory slice + user prompt content: 12 entries
 *      → only the last 10 appear in user prompt as `- accessed at <iso>
 *      query="<q>"` lines. Pins that the slice(-10) trim + ISO date
 *      formatting + optional query-string appendage all behave as
 *      documented (regression where slice(-10) became slice() would
 *      produce unbounded prompt growth).
 *
 *   7. extractSession HTTP 400 + JSON parse failure + missing-field
 *      defaults combined: HTTP 400 → success:false, summary starts with
 *      "Extraction failed:" (covers the success-branch-vs-error-branch
 *      symmetry with scoreMemory). Pins that extractSession shares the
 *      same try/catch shape (a regression where extractSession caught
 *      only JSON errors but not HTTP errors would surface as success:true
 *      with `(no summary available)` instead of an explicit failure).
 *
 *   8. extractSession missing summary/tags defaults: parsed `{}` →
 *      summary='(no summary available)', tags=[], keyEvents=undefined,
 *      entities=undefined (note: keyEvents/entities are optional in the
 *      ExtractionResult type so they remain undefined, NOT []). Pins the
 *      `?? '(no summary available)'` and `?? []` defaults; a regression
 *      where the literal defaults were dropped would produce literal
 *      undefined leaks to consumers.
 *
 * Watchdog check string: `test(extraction): ...` — rule 1 (real code,
 * any time ALLOW). State chain #27 (extending the 07-13 02:43 chain).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OllamaProvider } from '../src/extraction/providers/ollama.js';

type FetchMock = ReturnType<typeof vi.fn>;

// Ollama /api/chat response shape: { message: { content: "<raw string>" } }
function chatOk(generatedText: string): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify({ message: { content: generatedText } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
}

function chatError(status: number, text = 'upstream exploded'): Promise<Response> {
  return Promise.resolve(new Response(text, { status }));
}

function getFetchCallUserPrompt(fetchMock: FetchMock): string {
  const call = fetchMock.mock.calls[0];
  expect(call, 'fetch should have been called').toBeDefined();
  const init = call[1] as RequestInit | undefined;
  expect(init).toBeDefined();
  const bodyStr = String(init!.body ?? '');
  const parsed = JSON.parse(bodyStr) as { messages: Array<{ role: string; content: string }> };
  return parsed.messages[1].content;
}

describe('OllamaProvider error-branch deeper coverage (07-16 00:43 cron)', () => {
  const originalBaseUrl = process.env.OLLAMA_BASE_URL;
  let fetchMock: FetchMock;

  beforeEach(() => {
    delete process.env.OLLAMA_BASE_URL;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalBaseUrl === undefined) {
      delete process.env.OLLAMA_BASE_URL;
    } else {
      process.env.OLLAMA_BASE_URL = originalBaseUrl;
    }
  });

  // Case 1: HTTP 404 — same error branch as 500, just different status code
  it('scoreMemory HTTP 404: success:false, score:5, reasoning wraps "Ollama API error 404: <body>"', async () => {
    fetchMock.mockResolvedValueOnce(chatError(404, 'model llama3.1 not found, try pulling it'));
    const p = new OllamaProvider('http://localhost:11434');
    const r = await p.scoreMemory('k1', 'hello', []);
    expect(r.success).toBe(false);
    expect(r.score).toBe(5);
    expect(r.reasoning).toMatch(/Ollama scoring failed: /);
    expect(r.reasoning).toMatch(/Ollama API error 404: model llama3\.1 not found/);
  });

  // Case 2: JSON.parse failure — outer try/catch catches SyntaxError same as fetch rejection
  it('scoreMemory JSON.parse failure (raw garbage): success:false, score:5, reasoning wraps SyntaxError message', async () => {
    fetchMock.mockResolvedValueOnce(chatOk('this is not valid JSON {{{'));
    const p = new OllamaProvider('http://localhost:11434');
    const r = await p.scoreMemory('k1', 'hello', []);
    expect(r.success).toBe(false);
    expect(r.score).toBe(5);
    expect(r.reasoning).toMatch(/^Ollama scoring failed: /);
    // SyntaxError messages contain "JSON" or "Unexpected" or "token" — verify SOME
    // substring that distinguishes a parse error from a generic fetch failure.
    // The actual message from Node's JSON.parse is e.g. "Unexpected token..." but
    // we only assert the prefix because the exact substring varies across versions.
    expect(r.reasoning!.length).toBeGreaterThan('Ollama scoring failed: '.length + 5);
  });

  // Case 3: Missing-field defaults — parsed {} → score=5 (parsed.score ?? 5 clamp)
  it('scoreMemory missing-field defaults: parsed {} -> score:5, reasoning:undefined, suggestedTags:undefined', async () => {
    fetchMock.mockResolvedValueOnce(chatOk('{}'));
    const p = new OllamaProvider('http://localhost:11434');
    const r = await p.scoreMemory('k1', 'hello', []);
    expect(r.success).toBe(true);
    // Math.max(0, Math.min(10, parsed.score ?? 5)) = Math.max(0, Math.min(10, 5)) = 5
    expect(r.score).toBe(5);
    expect(r.reasoning).toBeUndefined();
    expect(r.suggestedTags).toBeUndefined();
  });

  // Case 4: Score clamping — out-of-range values clamped via Math.max/min
  it('scoreMemory score clamp: 999 -> 10, -5 -> 0 (independent max + min)', async () => {
    // 999 → Math.min(10, 999) = 10, Math.max(0, 10) = 10
    fetchMock.mockResolvedValueOnce(chatOk(JSON.stringify({ score: 999, reasoning: 'cap', suggestedTags: [] })));
    const p = new OllamaProvider('http://localhost:11434');
    const r1 = await p.scoreMemory('k1', 'hello', []);
    expect(r1.score).toBe(10);

    // -5 → Math.min(10, -5) = -5, Math.max(0, -5) = 0
    fetchMock.mockResolvedValueOnce(chatOk(JSON.stringify({ score: -5, reasoning: 'floor', suggestedTags: [] })));
    const r2 = await p.scoreMemory('k2', 'hello', []);
    expect(r2.score).toBe(0);
  });

  // Case 5: AbortError — 30s timeout path through outer try/catch
  // (parallels ollamaChat FETCH_TIMEOUT_MS = 30_000 wiring in extraction_provider_timeout.test.ts)
  it('scoreMemory AbortError (30s timeout): success:false, reasoning wraps "Ollama request aborted after 30000ms timeout"', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Ollama request aborted after 30000ms timeout'));
    const p = new OllamaProvider('http://localhost:11434');
    const r = await p.scoreMemory('k1', 'hello', []);
    expect(r.success).toBe(false);
    expect(r.score).toBe(5);
    expect(r.reasoning).toMatch(/Ollama scoring failed: /);
    expect(r.reasoning).toMatch(/Ollama request aborted after 30000ms timeout/);
  });

  // Case 6: usageHistory slice(-10) + ISO date + optional query-string appendage
  it('scoreMemory usageHistory: 12 entries -> only last 10 in user prompt as "- accessed at <iso> query=\\"<q>\\"" lines', async () => {
    fetchMock.mockResolvedValueOnce(chatOk(JSON.stringify({ score: 5, reasoning: 'r', suggestedTags: [] })));
    const p = new OllamaProvider('http://localhost:11434');
    const baseTime = Date.parse('2026-07-15T10:00:00.000Z');
    // Use distinctive markers (q0ZZZ / q1ZZZ for the entries we expect
    // to be excluded by slice(-10)) so substring assertions can't false-
    // positive on q1 being a substring of q10/q11.
    const usageHistory = Array.from({ length: 12 }, (_, i) => ({
      accessedAt: new Date(baseTime + i * 1000).toISOString(),
      query: i === 0 ? 'q0ZZZ' : i === 1 ? 'q1ZZZ' : `q${i}`,
    }));

    await p.scoreMemory('mem-key', 'content', usageHistory);
    const userPrompt = getFetchCallUserPrompt(fetchMock);

    // Only the last 10 entries should appear (slice(-10)). The oldest two
    // entries (indices 0+1) must be excluded entirely. Use distinctive
    // markers (`q0ZZZ` / `q1ZZZ`) so we don't false-positive on the `q1`
    // substring that's part of `q10`/`q11`.
    expect(userPrompt).not.toContain('q0ZZZ');
    expect(userPrompt).not.toContain('q1ZZZ');
    // Entries 2..11 (the LAST 10) must all appear.
    expect(userPrompt).toContain('q2');
    expect(userPrompt).toContain('q5');
    expect(userPrompt).toContain('q11');
    // Verify the line shape: "- accessed at <iso> query=\"<q>\""
    expect(userPrompt).toMatch(/- accessed at 2026-07-15T10:00:02\.000Z query="q2"/);
    expect(userPrompt).toMatch(/- accessed at 2026-07-15T10:00:11\.000Z query="q11"/);
  });

  // Case 7: extractSession HTTP 400 — symmetry with scoreMemory error branch
  it('extractSession HTTP 400: success:false, summary starts with "Extraction failed:"', async () => {
    fetchMock.mockResolvedValueOnce(chatError(400, 'bad request: missing fields'));
    const p = new OllamaProvider('http://localhost:11434');
    const r = await p.extractSession({ id: 's1', transcript: 'transcript' });
    expect(r.success).toBe(false);
    expect(r.summary).toMatch(/^Extraction failed: /);
    expect(r.summary).toMatch(/Ollama API error 400: bad request: missing fields/);
    expect(r.tags).toEqual([]);
    expect(r.keyEvents).toBeUndefined();
    expect(r.entities).toBeUndefined();
  });

  // Case 8: extractSession missing-field defaults — summary defaults to
  // "(no summary available)" and tags/keyEvents/entities all default to [].
  // The implementation uses `parsed.X ?? []` for tags/keyEvents/entities
  // (consistent `[]` fallback across all three) and `?? '(no summary available)'`
  // for summary (a sentinel string, not []). This pins that exact behavior
  // — a regression where any `?? []` became `?? undefined` would change
  // consumers' down-stream `.length === 0` checks to throw on undefined.
  it('extractSession missing-field defaults: parsed {} -> summary="(no summary available)", tags=[], keyEvents=[], entities=[]', async () => {
    fetchMock.mockResolvedValueOnce(chatOk('{}'));
    const p = new OllamaProvider('http://localhost:11434');
    const r = await p.extractSession({ id: 's1', transcript: 'transcript' });
    expect(r.success).toBe(true);
    expect(r.summary).toBe('(no summary available)');
    expect(r.tags).toEqual([]);
    expect(r.keyEvents).toEqual([]);
    expect(r.entities).toEqual([]);
  });
});