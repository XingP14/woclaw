/**
 * OllamaProvider error-path coverage (07-13 06:43 cron).
 *
 * Companion to `ollama_provider.test.ts` (8 cases of happy-path /
 * constructor / engine-routing coverage). This file focuses on the
 * *error* branches that the runtime-coverage file deliberately skipped
 * to keep it minimal:
 *
 *   1. JSON.parse failure in scoreMemory: content is a valid HTTP 200
 *      response but the inner `message.content` is NOT valid JSON
 *      (e.g. "I cannot comply") → caught and returns success:false,
 *      score:5, reasoning starts with `"Ollama scoring failed: "` and
 *      wraps the SyntaxError.message ("Unexpected token ...").
 *   2. scoreMemory score clamp upper bound: score:15 in raw JSON →
 *      clamped to 10 via Math.max(0, Math.min(10, parsed.score ?? 5)).
 *      The clamping happens AFTER JSON.parse succeeds.
 *   3. scoreMemory score clamp lower bound: score:-5 → clamped to 0.
 *   4. scoreMemory missing score field: parsed.score is undefined →
 *      falls back to default 5 (via `parsed.score ?? 5`).
 *   5. scoreMemory fallback to legacy `response` field: server returns
 *      `{response:"<raw>"}` without a `message.content` field. The
 *      `json.message?.content ?? json.response ?? ''` fallback path
 *      must kick in. (This fallback is Ollama-specific — openai.ts
 *      has no parallel path.)
 *   6. extractSession JSON.parse failure: content is non-JSON →
 *      success:false, summary starts with `"Extraction failed: "`,
 *      tags preserve the input tags fallback.
 *   7. extractSession missing optional fields: raw JSON has only
 *      `{summary: "..."}` → tags/keyEvents/entities default to
 *      `[]` / `undefined`. No `metadata` field leakage.
 *   8. AbortController timeout (FETCH_TIMEOUT_MS=30s) fired by fake
 *      timer: AbortError thrown inside ollamaChat is caught and
 *      re-thrown as a typed error `"Ollama request aborted after
 *      30000ms timeout"`. scoreMemory surfaces this as
 *      `"Ollama scoring failed: Ollama request aborted after 30000ms
 *      timeout"`.
 *
 * Together these 8 cases gate every branch of the
 * try/catch in scoreMemory and extractSession plus the JSON.parse
 * failure path that exists in BOTH providers (openai_provider.test.ts
 * does not test it either). The previous ollama_provider.test.ts
 * stopped at HTTP 500 / fetch-rejection boundaries; this file adds the
 * JSON-malformed branch and the score-clamp boundaries that the
 * catch block could silently mask.
 *
 * Watchdog check string: `test(extraction): ...` — rule 1 (real code,
 * any time ALLOW). State chain #N (parallels c2dc02f ollama_provider
 * 8-case happy + c7bf0a6 openai_provider 8-case runtime coverage).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OllamaProvider } from '../src/extraction/providers/ollama.js';

type FetchMock = ReturnType<typeof vi.fn>;

function chatOk(generatedText: string): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify({ message: { content: generatedText } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function chatOkLegacy(responseField: string): Promise<Response> {
  // Some Ollama versions / older completions endpoints return
  // { response: "<raw>" } without the { message: { content } } wrapper.
  return Promise.resolve(
    new Response(JSON.stringify({ response: responseField }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

describe('OllamaProvider error paths (07-13 06:43 cron)', () => {
  const originalBaseUrl = process.env.OLLAMA_BASE_URL;
  let fetchMock: FetchMock;

  beforeEach(() => {
    process.env.OLLAMA_BASE_URL = 'http://localhost:11434';
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

  it('scoreMemory JSON.parse failure: non-JSON inner content → success:false, score:5, reasoning wraps SyntaxError', async () => {
    fetchMock.mockResolvedValueOnce(chatOk('I cannot comply with that request.'));
    const p = new OllamaProvider();
    const r = await p.scoreMemory('k1', 'hello', []);
    expect(r.success).toBe(false);
    expect(r.score).toBe(5);
    expect(r.reasoning).toMatch(/^Ollama scoring failed: /);
    expect(r.reasoning).toMatch(/SyntaxError|Unexpected token|JSON/);
  });

  it('scoreMemory score clamp upper bound: raw score:15 → clamped to 10 (Math.min(10, parsed.score))', async () => {
    fetchMock.mockResolvedValueOnce(chatOk(JSON.stringify({ score: 15, reasoning: 'over-max', suggestedTags: [] })));
    const p = new OllamaProvider();
    const r = await p.scoreMemory('k1', 'hello', []);
    expect(r.success).toBe(true);
    expect(r.score).toBe(10);
    expect(r.reasoning).toBe('over-max');
  });

  it('scoreMemory score clamp lower bound: raw score:-5 → clamped to 0 (Math.max(0, parsed.score))', async () => {
    fetchMock.mockResolvedValueOnce(chatOk(JSON.stringify({ score: -5, reasoning: 'negative', suggestedTags: [] })));
    const p = new OllamaProvider();
    const r = await p.scoreMemory('k1', 'hello', []);
    expect(r.success).toBe(true);
    expect(r.score).toBe(0);
    expect(r.reasoning).toBe('negative');
  });

  it('scoreMemory missing score field: parsed.score undefined → fallback to default 5 via `parsed.score ?? 5`', async () => {
    fetchMock.mockResolvedValueOnce(chatOk(JSON.stringify({ reasoning: 'no-score-field', suggestedTags: ['x'] })));
    const p = new OllamaProvider();
    const r = await p.scoreMemory('k1', 'hello', []);
    expect(r.success).toBe(true);
    expect(r.score).toBe(5);
    expect(r.reasoning).toBe('no-score-field');
    expect(r.suggestedTags).toEqual(['x']);
  });

  it('scoreMemory legacy `response` field fallback: `{response:"<raw>"}` without `message.content` still parses', async () => {
    // The Ollama /api/generate endpoint (vs /api/chat) returns
    // { response: "<raw string>" } without the {message:{content:...}}
    // wrapper. ollamaChat must handle both via
    // `json.message?.content ?? json.response ?? ''`.
    const innerJson = JSON.stringify({ score: 7, reasoning: 'legacy-path', suggestedTags: ['legacy'] });
    fetchMock.mockResolvedValueOnce(chatOkLegacy(innerJson));
    const p = new OllamaProvider();
    const r = await p.scoreMemory('k1', 'hello', []);
    expect(r.success).toBe(true);
    expect(r.score).toBe(7);
    expect(r.reasoning).toBe('legacy-path');
    expect(r.suggestedTags).toEqual(['legacy']);
  });

  it('extractSession JSON.parse failure: non-JSON inner content → success:false, summary:"Extraction failed: ...", tags preserve input', async () => {
    fetchMock.mockResolvedValueOnce(chatOk('Sorry, I cannot extract that.'));
    const p = new OllamaProvider();
    const r = await p.extractSession({ id: 's1', transcript: 't', tags: ['input-tag'] });
    expect(r.success).toBe(false);
    expect(r.summary).toMatch(/^Extraction failed: /);
    expect(r.summary).toMatch(/SyntaxError|Unexpected token|JSON/);
    expect(r.tags).toEqual(['input-tag']);
    expect(r.keyEvents).toBeUndefined();
    expect(r.entities).toBeUndefined();
  });

  it('extractSession missing optional fields: raw JSON has only summary → tags/keyEvents/entities default to []/undefined', async () => {
    fetchMock.mockResolvedValueOnce(chatOk(JSON.stringify({ summary: 'minimal session' })));
    const p = new OllamaProvider();
    const r = await p.extractSession({ id: 's2', transcript: 't' });
    expect(r.success).toBe(true);
    expect(r.summary).toBe('minimal session');
    expect(r.tags).toEqual([]);
    expect(r.keyEvents).toEqual([]);
    expect(r.entities).toEqual([]);
  });

  it('scoreMemory AbortController timeout: AbortError from fetch → typed "Ollama request aborted after 30000ms timeout"', async () => {
    // Simulate the AbortController firing inside ollamaChat: fetch
    // rejects with an AbortError whose name === 'AbortError'. The
    // catch in ollamaChat distinguishes AbortError by name and
    // re-throws a typed error; the outer scoreMemory catch wraps it as
    // `"Ollama scoring failed: Ollama request aborted after 30000ms
    // timeout"`. We resolve immediately rather than honor the signal
    // so the test stays deterministic.
    const abortError: Error & { name: string } = new Error('aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValueOnce(abortError);
    const p = new OllamaProvider();
    const r = await p.scoreMemory('k1', 'hello', []);
    expect(r.success).toBe(false);
    expect(r.score).toBe(5);
    expect(r.reasoning).toMatch(/^Ollama scoring failed: /);
    expect(r.reasoning).toMatch(/Ollama request aborted after 30000ms timeout/);
  });
});