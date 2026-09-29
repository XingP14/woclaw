/**
 * OpenAIProvider remaining-branch coverage (09-30 00:03 cron).
 *
 * `openai_provider_error_branches.test.ts` (07-16 02:23) closed 8 of the 11
 * arms in `hub/src/extraction/providers/openai.ts`, but the fresh 00:03
 * coverage run still reports 3 dark arms. All three are behaviourally
 * meaningful, not dead code:
 *
 *   1. `openai.ts:63` — `(e as Error)?.name === 'AbortError'` TRUE arm. The
 *      existing AbortError case (case 5 of the 07-16 file) fakes it by
 *      rejecting with `new Error('OpenAI request aborted after 30000ms
 *      timeout')`, i.e. an ordinary Error carrying the same text. That never
 *      executes the branch body, so the real conversion — a genuine
 *      `AbortError` from the AbortController being re-thrown as a typed
 *      timeout error instead of leaking the raw DOMException — stayed dark.
 *      A regression deleting the `if` would still pass every existing test
 *      while surfacing `AbortError: The operation was aborted` to callers.
 *
 *   2. `openai.ts:78` — `json.choices[0]?.message?.content ?? ''` fallback.
 *      Every fixture so far returns a well-formed `choices[0].message`, so
 *      the `?? ''` arm never runs. A 200 response with an empty `choices`
 *      array (streaming/tool-call shapes the type does not model) is exactly
 *      the case the fallback exists for. Note the fallback does NOT mean
 *      success: the empty string then flows into `JSON.parse` inside
 *      `scoreMemory`'s try/catch, so the caller gets an explicit
 *      `success:false` rather than a bogus score.
 *
 *   3. `openai.ts:98` — `u.query ? \` query="${u.query}"\` : ''` FALSE arm.
 *      Every usage-history fixture supplies a query string, so the no-query
 *      shape (a memory surfaced by recall with no originating query — the
 *      common case for scheduled/forgetting passes) never reaches the
 *      prompt. The guard is what keeps those entries from rendering
 *      `query="undefined"` into the scorer prompt.
 *
 * 0 production changes.
 *
 * Watchdog check string: `test(extraction): ...` — rule 1 (real code,
 * any time ALLOW).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAIProvider } from '../src/extraction/providers/openai.js';
import type { UsageHistoryEntry } from '../src/extraction/types.js';

type FetchMock = ReturnType<typeof vi.fn>;

function chatBody(generatedText: string): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify({ choices: [{ message: { content: generatedText } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

function userPromptOf(fetchMock: FetchMock): string {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  const parsed = JSON.parse(String(init.body ?? '')) as {
    messages: Array<{ role: string; content: string }>;
  };
  return parsed.messages[1].content;
}

describe('OpenAIProvider AbortError conversion + prompt-fallback arms (09-30 00:03 cron)', () => {
  const originalKey = process.env.OPENAI_API_KEY;
  let fetchMock: FetchMock;

  beforeEach(() => {
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

  // Arm 1: a real AbortError (name === 'AbortError') is re-thrown as the
  // typed 30s-timeout Error, not leaked as the raw DOMException.
  it('scoreMemory real AbortError is converted to the typed 30s timeout error', async () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    fetchMock.mockRejectedValueOnce(abort);

    const p = new OpenAIProvider('test-key');
    const r = await p.scoreMemory('k1', 'hello', []);

    expect(r.success).toBe(false);
    expect(r.score).toBe(5);
    expect(r.reasoning).toBe(
      'OpenAI scoring failed: OpenAI request aborted after 30000ms timeout',
    );
    // The raw AbortError text must not leak through — that is the whole
    // point of the conversion branch.
    expect(r.reasoning).not.toMatch(/The operation was aborted/);
  });

  // Arm 1b: a non-abort fetch rejection must still pass through untouched,
  // proving the branch is a narrow filter and not a blanket re-wrap.
  it('scoreMemory non-abort rejection is re-thrown unchanged (AbortError filter is narrow)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    const p = new OpenAIProvider('test-key');
    const r = await p.scoreMemory('k1', 'hello', []);

    expect(r.success).toBe(false);
    expect(r.reasoning).toBe('OpenAI scoring failed: fetch failed');
  });

  // Arm 2: 200 response with no choices -> `?? ''` fallback -> JSON.parse('')
  // throws -> explicit failure, not a bogus score.
  it('scoreMemory 200 with empty choices falls back to "" and fails the parse explicitly', async () => {
    fetchMock.mockResolvedValueOnce(
      Promise.resolve(
        new Response(JSON.stringify({ choices: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const p = new OpenAIProvider('test-key');
    const r = await p.scoreMemory('k1', 'hello', []);

    expect(r.success).toBe(false);
    expect(r.score).toBe(5);
    expect(r.reasoning).toMatch(/^OpenAI scoring failed: /);
  });

  // Arm 2b: choices[0] present but message missing -> the `?.message` half of
  // the same optional chain.
  it('scoreMemory 200 with a choice lacking message falls back to "" as well', async () => {
    fetchMock.mockResolvedValueOnce(
      Promise.resolve(
        new Response(JSON.stringify({ choices: [{ finish_reason: 'length' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const p = new OpenAIProvider('test-key');
    const r = await p.scoreMemory('k1', 'hello', []);

    expect(r.success).toBe(false);
    expect(r.score).toBe(5);
  });

  // Arm 3: usage-history entry without a query renders no query= fragment.
  it('scoreMemory usage-history entries without a query render no query fragment', async () => {
    fetchMock.mockResolvedValueOnce(chatBody('{"score": 7}'));

    // accessedAt is epoch-millis; the provider ISO-formats it into the prompt.
    const withQuery = 1759192800000;
    const withoutQuery = 1759196400000;
    const history: UsageHistoryEntry[] = [
      { accessedAt: withQuery, query: 'what is woclaw' },
      { accessedAt: withoutQuery },
    ];
    const p = new OpenAIProvider('test-key');
    const r = await p.scoreMemory('k1', 'hello', history);

    expect(r.success).toBe(true);
    expect(r.score).toBe(7);

    const prompt = userPromptOf(fetchMock);
    expect(prompt).toContain(`query="what is woclaw"`);
    expect(prompt).toContain(`- accessed at ${new Date(withoutQuery).toISOString()}`);
    // No stray "undefined" / empty query= for the query-less entry.
    expect(prompt).not.toMatch(/query="undefined"/);
    expect(prompt).not.toMatch(/query=""/);
  });
});
