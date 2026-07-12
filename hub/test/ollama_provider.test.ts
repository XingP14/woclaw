/**
 * OllamaProvider runtime coverage (07-13 02:43 cron).
 *
 * OllamaProvider in `hub/src/extraction/providers/ollama.ts` is a real
 * implementation (not a stub) — it calls `fetch()` against
 * `${OLLAMA_BASE_URL}/api/chat` and parses the JSON response. There is no
 * direct test coverage of the class today; the only Ollama reference in
 * `hub/test/` is the static `extraction_provider_timeout.test.ts` regex
 * check that pins the AbortController + setTimeout wiring in
 * `ollamaChat()`. A regression in the JSON-parsing path or in the
 * success/failure branch selection would silently surface as 0% Ollama
 * score instead of an explicit "Ollama scoring failed" error. This file
 * pins:
 *   1. scoreMemory happy path: fetch resolves with the Ollama chat API
 *      shape `{message: {content: "<json string>"}}` where the inner
 *      string is a valid importance JSON `{score, reasoning,
 *      suggestedTags}` → success:true, score/reasoning/suggestedTags
 *      preserved. Also asserts the request shape: POST to /api/chat,
 *      llama3.1 model, system+user messages, stream:false.
 *   2. scoreMemory markdown fence cleanup: fetch returns
 *      ` ```json\n{...}\n``` ` inside message.content → fences stripped
 *      before JSON.parse.
 *   3. scoreMemory fetch rejection: fetch rejects → success:false,
 *      score:5, reasoning starts with "Ollama scoring failed:".
 *   4. scoreMemory API error: fetch resolves with status=500 →
 *      success:false, score:5, reasoning wraps the typed
 *      "Ollama API error 500: ...".
 *   5. extractSession happy path: fetch resolves with chat-API shape →
 *      success:true, summary/tags/keyEvents/entities all populated.
 *      Also asserts request shape: extract uses llama3.1 model, system
 *      prompt, transcript excerpt present.
 *   6. extractSession fetch rejection: fetch rejects → success:false,
 *      summary:"Extraction failed: ...", no keyEvents/entities leak.
 *   7. Constructor reads process.env.OLLAMA_BASE_URL when no arg passed
 *      (default http://localhost:11434; trailing slash stripped).
 *   8. loadProvider('ollama', {}) in engine.ts routes to OllamaProvider
 *      end-to-end and dispatches fetch through it.
 *
 * Watchdog check string: `test(extraction): ...` — rule 1 (real code,
 * any time ALLOW). State chain #N.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OllamaProvider } from '../src/extraction/providers/ollama.js';
import { createExtractionProvider } from '../src/extraction/engine.js';

type FetchMock = ReturnType<typeof vi.fn>;

// Ollama /api/chat response shape: { message: { content: "<raw string>" } }
// where <raw string> is what the model generated (often a JSON object as a
// string, sometimes wrapped in ```json ... ``` fences).
function chatOk(generatedText: string): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify({ message: { content: generatedText } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));
}

function chatError(status: number, text = 'upstream exploded'): Promise<Response> {
  return Promise.resolve(new Response(text, { status }));
}

function getFetchCallBody(fetchMock: FetchMock): { model: string; messages: Array<{ role: string; content: string }>; stream: boolean } {
  const call = fetchMock.mock.calls[0];
  expect(call, 'fetch should have been called').toBeDefined();
  const init = call[1] as RequestInit | undefined;
  expect(init).toBeDefined();
  const bodyStr = String(init!.body ?? '');
  return JSON.parse(bodyStr);
}

describe('OllamaProvider runtime (07-13 02:43 cron)', () => {
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

  it('scoreMemory happy path: valid importance JSON inside chat-API message.content → success:true, score:8, reasoning + suggestedTags preserved', async () => {
    fetchMock.mockResolvedValueOnce(chatOk(JSON.stringify({ score: 8, reasoning: 'high-value memory', suggestedTags: ['alpha', 'beta'] })));
    const p = new OllamaProvider('http://localhost:11434');
    const r = await p.scoreMemory('k1', 'hello world', []);
    expect(r.success).toBe(true);
    expect(r.score).toBe(8);
    expect(r.reasoning).toBe('high-value memory');
    expect(r.suggestedTags).toEqual(['alpha', 'beta']);
    // Verify request shape: POST to /api/chat, llama3.1 model, system+user messages, stream:false
    const req = getFetchCallBody(fetchMock);
    expect(req.model).toBe('llama3.1');
    expect(req.stream).toBe(false);
    expect(req.messages).toHaveLength(2);
    expect(req.messages[0].role).toBe('system');
    expect(req.messages[1].role).toBe('user');
    expect(req.messages[1].content).toMatch(/Memory key: "k1"/);
    expect(req.messages[1].content).toMatch(/Memory content: """hello world"""/);
  });

  it('scoreMemory markdown fence cleanup: ```json ... ``` wrappers inside message.content stripped before JSON.parse', async () => {
    const fenced = '```json\n{"score":7,"reasoning":"fenced","suggestedTags":["x"]}\n```';
    fetchMock.mockResolvedValueOnce(chatOk(fenced));
    const p = new OllamaProvider('http://localhost:11434');
    const r = await p.scoreMemory('k1', 'hello', []);
    expect(r.success).toBe(true);
    expect(r.score).toBe(7);
    expect(r.reasoning).toBe('fenced');
    expect(r.suggestedTags).toEqual(['x']);
  });

  it('scoreMemory fetch rejection: success:false, score:5, reasoning starts with "Ollama scoring failed:"', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED 127.0.0.1:11434'));
    const p = new OllamaProvider('http://localhost:11434');
    const r = await p.scoreMemory('k1', 'hello', []);
    expect(r.success).toBe(false);
    expect(r.score).toBe(5);
    expect(r.reasoning).toMatch(/^Ollama scoring failed: /);
    expect(r.reasoning).toMatch(/ECONNREFUSED 127\.0\.0\.1:11434/);
  });

  it('scoreMemory API error (HTTP 500): success:false, score:5, reasoning wraps "Ollama API error 500"', async () => {
    fetchMock.mockResolvedValueOnce(chatError(500, 'internal server error'));
    const p = new OllamaProvider('http://localhost:11434');
    const r = await p.scoreMemory('k1', 'hello', []);
    expect(r.success).toBe(false);
    expect(r.score).toBe(5);
    expect(r.reasoning).toMatch(/Ollama scoring failed: /);
    expect(r.reasoning).toMatch(/Ollama API error 500: internal server error/);
  });

  it('extractSession happy path: valid session JSON inside chat-API message.content → success:true, summary/tags/keyEvents/entities all populated', async () => {
    fetchMock.mockResolvedValueOnce(chatOk(JSON.stringify({
      summary: 'session about agents',
      tags: ['agent', 'hub'],
      keyEvents: ['start', 'end'],
      entities: ['alice', 'bob'],
    })));
    const p = new OllamaProvider('http://localhost:11434');
    const r = await p.extractSession({ id: 's1', transcript: 'long transcript here' });
    expect(r.success).toBe(true);
    expect(r.summary).toBe('session about agents');
    expect(r.tags).toEqual(['agent', 'hub']);
    expect(r.keyEvents).toEqual(['start', 'end']);
    expect(r.entities).toEqual(['alice', 'bob']);
    // Verify request: extract uses llama3.1 model, system+user messages, transcript excerpt present
    const req = getFetchCallBody(fetchMock);
    expect(req.model).toBe('llama3.1');
    expect(req.messages[1].content).toMatch(/Session ID: s1/);
    expect(req.messages[1].content).toMatch(/Transcript excerpt:/);
  });

  it('extractSession fetch rejection: success:false, summary:"Extraction failed: ...", no keyEvents/entities leak', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'));
    const p = new OllamaProvider('http://localhost:11434');
    const r = await p.extractSession({ id: 's2', transcript: 'transcript' });
    expect(r.success).toBe(false);
    expect(r.summary).toMatch(/^Extraction failed: /);
    expect(r.summary).toMatch(/socket hang up/);
    expect(r.tags).toEqual([]);
    expect(r.keyEvents).toBeUndefined();
    expect(r.entities).toBeUndefined();
  });

  it('constructor reads process.env.OLLAMA_BASE_URL when no arg passed (default http://localhost:11434, trailing slash stripped)', async () => {
    // First: no env var → default URL is hit
    fetchMock.mockResolvedValueOnce(chatOk(JSON.stringify({ score: 6, reasoning: 'r', suggestedTags: ['t'] })));
    let p = new OllamaProvider();
    await p.scoreMemory('k1', 'hello', []);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^http:\/\/localhost:11434\/api\/chat$/);

    // Second: env var set with trailing slash → env URL is hit (slash stripped)
    process.env.OLLAMA_BASE_URL = 'http://remote-ollama:9999/';
    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(chatOk(JSON.stringify({ score: 6, reasoning: 'r', suggestedTags: ['t'] })));
    p = new OllamaProvider();
    await p.scoreMemory('k1', 'hello', []);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^http:\/\/remote-ollama:9999\/api\/chat$/);
  });

  it('engine loadProvider("ollama", {}) routes to OllamaProvider and dispatches fetch through it', async () => {
    fetchMock.mockResolvedValueOnce(chatOk(JSON.stringify({ score: 4, reasoning: 'engine-routed', suggestedTags: [] })));
    const provider = createExtractionProvider({ provider: 'ollama' });
    const r = await provider.scoreMemory('k1', 'hello', []);
    expect(r.success).toBe(true);
    expect(r.reasoning).toBe('engine-routed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/chat$/);
  });
});