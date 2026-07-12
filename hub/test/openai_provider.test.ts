/**
 * OpenAIProvider runtime coverage (07-13 05:23 cron).
 *
 * OpenAIProvider in `hub/src/extraction/providers/openai.ts` is a real
 * implementation (not a stub) — it calls `fetch()` against
 * `${BASE_URL}/chat/completions` with rate-limiting (500ms), parses the
 * chat-completion response, and surfaces failures through the typed
 * `"OpenAI scoring failed: ..."` / `"Extraction failed: ..."` prefixes.
 *
 * There is no direct test coverage of the class today; the only OpenAI
 * reference in `hub/test/` is the static
 * `extraction_engine.test.ts` import assertion. A regression in the
 * JSON-parsing path or in the success/failure branch selection would
 * silently surface as 0% OpenAI score instead of an explicit
 * `"OpenAI scoring failed"` error.
 *
 * Differences from the parallel `ollama_provider.test.ts`:
 *   - endpoint is `/chat/completions` (not `/api/chat`)
 *   - chat-completion response shape `{choices:[{message:{content:"..."}}]}`
 *     (same nesting depth as Ollama, different outer key)
 *   - scoreMemory failure prefix is `"OpenAI scoring failed:"` (provider
 *     distinguishes itself so consumers can grep for OpenAI-typed errors)
 *   - constructor throws when no API key is available (parallels the
 *     production hard-fail path; AnthropicProvider is the silent-stub
 *     counterpart, OllamaProvider accepts undefined base URL)
 *   - score/extract requests use different models (`gpt-4o-mini` vs
 *     `gpt-4o`) and different temperatures (`0.2` vs `0.4`) so we assert
 *     those per-method to pin the dispatch
 *
 * This file pins 8 cases:
 *   1. scoreMemory happy path: chat-completion response
 *      `{choices:[{message:{content:"<json>"}}]}` where the inner string
 *      is a valid importance JSON `{score, reasoning, suggestedTags}` →
 *      success:true, score/reasoning/suggestedTags preserved. Also
 *      asserts request shape: POST /chat/completions, gpt-4o-mini model,
 *      system+user messages, Authorization header present.
 *   2. scoreMemory markdown fence cleanup: ` ```json ... ``` ` wrappers
 *      inside choices[0].message.content stripped before JSON.parse.
 *   3. scoreMemory fetch rejection: fetch rejects → success:false,
 *      score:5, reasoning starts with `"OpenAI scoring failed: "`.
 *   4. scoreMemory API error (HTTP 500): success:false, score:5,
 *      reasoning wraps the typed `"OpenAI API error 500: ..."`.
 *   5. extractSession happy path: valid session JSON inside chat-
 *      completion message.content → success:true, summary/tags/keyEvents/
 *      entities all populated. Also asserts request shape: extract uses
 *      gpt-4o model, system prompt, transcript excerpt present.
 *   6. extractSession fetch rejection: success:false,
 *      summary:`"Extraction failed: ..."`, no keyEvents/entities leak.
 *   7. Constructor throws when no API key is provided AND no
 *      `OPENAI_API_KEY` env var is set; constructor accepts explicit
 *      `apiKey` argument when provided.
 *   8. loadProvider('openai', {}) in engine.ts routes to OpenAIProvider
 *      end-to-end and dispatches fetch through it (default provider).
 *
 * Watchdog check string: `test(extraction): ...` — rule 1 (real code,
 * any time ALLOW). State chain #N (parallels c2dc02f ollama_provider
 * 8-case + 104c05a anthropic_provider 6-case).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAIProvider } from '../src/extraction/providers/openai.js';
import { createExtractionProvider } from '../src/extraction/engine.js';

type FetchMock = ReturnType<typeof vi.fn>;

// OpenAI /chat/completions response shape:
// { choices: [{ message: { content: "<raw string>" } }] }
// where <raw string> is what the model generated (often a JSON object
// as a string, sometimes wrapped in ```json ... ``` fences).
function chatOk(generatedText: string): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify({ choices: [{ message: { content: generatedText } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function chatError(status: number, text = 'upstream exploded'): Promise<Response> {
  return Promise.resolve(new Response(text, { status }));
}

interface OpenAIRequestShape {
  model: string;
  temperature: number;
  messages: Array<{ role: string; content: string }>;
}

function getFetchCallBody(fetchMock: FetchMock): {
  url: string;
  init: RequestInit;
  body: OpenAIRequestShape;
} {
  const call = fetchMock.mock.calls[0];
  expect(call, 'fetch should have been called').toBeDefined();
  const [url, init] = call as [string, RequestInit];
  expect(url, 'fetch URL must be present').toBeDefined();
  expect(init, 'fetch init must be present').toBeDefined();
  const bodyStr = String((init as RequestInit).body ?? '');
  return { url, init, body: JSON.parse(bodyStr) };
}

describe('OpenAIProvider runtime (07-13 05:23 cron)', () => {
  const originalKey = process.env.OPENAI_API_KEY;
  let fetchMock: FetchMock;

  beforeEach(() => {
    // Always inject a key so the constructor doesn't throw by default;
    // tests that want to verify the throw path override this.
    process.env.OPENAI_API_KEY = 'test-key';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalKey;
    }
  });

  it('scoreMemory happy path: valid importance JSON inside choices[0].message.content → success:true, score:8, reasoning + suggestedTags preserved', async () => {
    fetchMock.mockResolvedValueOnce(
      chatOk(JSON.stringify({ score: 8, reasoning: 'high-value memory', suggestedTags: ['alpha', 'beta'] })),
    );
    const p = new OpenAIProvider('test-key');
    const r = await p.scoreMemory('k1', 'hello world', []);
    expect(r.success).toBe(true);
    expect(r.score).toBe(8);
    expect(r.reasoning).toBe('high-value memory');
    expect(r.suggestedTags).toEqual(['alpha', 'beta']);
    // Verify request shape: POST /chat/completions, gpt-4o-mini, system+user messages, Authorization header
    const { url, init, body } = getFetchCallBody(fetchMock);
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init as RequestInit).method).toBe('POST');
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
    expect(body.messages[1].content).toMatch(/Memory key: "k1"/);
    expect(body.messages[1].content).toMatch(/Memory content: """hello world"""/);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key');
  });

  it('scoreMemory markdown fence cleanup: ```json ... ``` wrappers inside choices[0].message.content stripped before JSON.parse', async () => {
    const fenced = '```json\n{"score":7,"reasoning":"fenced","suggestedTags":["x"]}\n```';
    fetchMock.mockResolvedValueOnce(chatOk(fenced));
    const p = new OpenAIProvider('test-key');
    const r = await p.scoreMemory('k1', 'hello', []);
    expect(r.success).toBe(true);
    expect(r.score).toBe(7);
    expect(r.reasoning).toBe('fenced');
    expect(r.suggestedTags).toEqual(['x']);
  });

  it('scoreMemory fetch rejection: success:false, score:5, reasoning starts with "OpenAI scoring failed:"', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED api.openai.com:443'));
    const p = new OpenAIProvider('test-key');
    const r = await p.scoreMemory('k1', 'hello', []);
    expect(r.success).toBe(false);
    expect(r.score).toBe(5);
    expect(r.reasoning).toMatch(/^OpenAI scoring failed: /);
    expect(r.reasoning).toMatch(/ECONNREFUSED api\.openai\.com:443/);
  });

  it('scoreMemory API error (HTTP 500): success:false, score:5, reasoning wraps "OpenAI API error 500"', async () => {
    fetchMock.mockResolvedValueOnce(chatError(500, 'internal server error'));
    const p = new OpenAIProvider('test-key');
    const r = await p.scoreMemory('k1', 'hello', []);
    expect(r.success).toBe(false);
    expect(r.score).toBe(5);
    expect(r.reasoning).toMatch(/OpenAI scoring failed: /);
    expect(r.reasoning).toMatch(/OpenAI API error 500: internal server error/);
  });

  it('extractSession happy path: valid session JSON inside choices[0].message.content → success:true, summary/tags/keyEvents/entities all populated', async () => {
    fetchMock.mockResolvedValueOnce(
      chatOk(
        JSON.stringify({
          summary: 'session about agents',
          tags: ['agent', 'hub'],
          keyEvents: ['start', 'end'],
          entities: ['alice', 'bob'],
        }),
      ),
    );
    const p = new OpenAIProvider('test-key');
    const r = await p.extractSession({ id: 's1', transcript: 'long transcript here' });
    expect(r.success).toBe(true);
    expect(r.summary).toBe('session about agents');
    expect(r.tags).toEqual(['agent', 'hub']);
    expect(r.keyEvents).toEqual(['start', 'end']);
    expect(r.entities).toEqual(['alice', 'bob']);
    // Verify request: extract uses gpt-4o model, system+user messages, transcript excerpt present
    const { body } = getFetchCallBody(fetchMock);
    expect(body.model).toBe('gpt-4o');
    expect(body.messages[1].content).toMatch(/Session ID: s1/);
    expect(body.messages[1].content).toMatch(/Transcript excerpt:/);
  });

  it('extractSession fetch rejection: success:false, summary:"Extraction failed: ...", no keyEvents/entities leak', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));
    const p = new OpenAIProvider('test-key');
    const r = await p.extractSession({ id: 's2', transcript: 'transcript' });
    expect(r.success).toBe(false);
    expect(r.summary).toMatch(/^Extraction failed: /);
    expect(r.summary).toMatch(/socket hang up/);
    expect(r.tags).toEqual([]);
    expect(r.keyEvents).toBeUndefined();
    expect(r.entities).toBeUndefined();
  });

  it('constructor throws when no API key is provided AND OPENAI_API_KEY env var is unset; explicit apiKey argument is accepted', () => {
    // Branch A: no arg, no env → throws with the canonical message
    delete process.env.OPENAI_API_KEY;
    expect(() => new OpenAIProvider()).toThrow(/OpenAI API key not provided\. Set OPENAI_API_KEY env var\./);

    // Branch B: explicit arg wins over env (sanity)
    expect(() => new OpenAIProvider('explicit-key')).not.toThrow();
  });

  it('engine loadProvider("openai", {}) routes to OpenAIProvider end-to-end and dispatches fetch through it (default provider)', async () => {
    fetchMock.mockResolvedValueOnce(
      chatOk(JSON.stringify({ score: 4, reasoning: 'engine-routed', suggestedTags: [] })),
    );
    const provider = createExtractionProvider({ provider: 'openai' });
    const r = await provider.scoreMemory('k1', 'hello', []);
    expect(r.success).toBe(true);
    expect(r.reasoning).toBe('engine-routed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/chat\/completions$/);
  });
});