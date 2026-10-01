/**
 * Edge-branch gates for `hub/src/otlp_sink.ts` — the nine arms the round
 * 91.6-A/91.6-B suites left dark.
 *
 * Every gate here exercises a REAL observable behaviour of a shipped
 * function, not a coverage trick:
 *   - buildOtlpLogRecord: attribute type coercion (null/undefined skipped,
 *     structured values JSON-stringified), trace/span id propagation, and
 *     the sparse-record contract when no optional field is supplied.
 *   - sendOtlpLogsOnce: the four rejected shapes of WOCLAW_OTLP_HEADERS,
 *     string-only value filtering, JSON-parse failure, a fetch that
 *     rejects, a 2xx body that is the literal JSON `null`, and a non-2xx
 *     whose body cannot be read.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

import {
  buildOtlpLogRecord,
  sendOtlpLogsOnce,
  getDroppedRecordsTotal,
  resetDroppedRecordsTotal,
} from '../src/otlp_sink.js';

const ENDPOINT = 'http://localhost:4318/v1/logs';

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  delete process.env.WOCLAW_OTLP_ENDPOINT;
  delete process.env.WOCLAW_OTLP_HEADERS;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetDroppedRecordsTotal();
});

// -- buildOtlpLogRecord: attribute coercion --------------------------------

describe('otlp_sink: buildOtlpLogRecord attribute coercion', () => {
  it('skips attrs whose value is null or undefined, keeping the rest', () => {
    const rec = buildOtlpLogRecord({
      ts: 0,
      level: 'info',
      event: 'hub.attr.filtered',
      attrs: {
        keep_me: 'yes',
        nulled: null,
        undef: undefined,
        zero: 0,
        off: false,
        empty: '',
      },
    });
    const keys = rec.attributes!.map((a) => a.key);
    expect(keys).toEqual(['keep_me', 'zero', 'off', 'empty']);
    expect(keys).not.toContain('nulled');
    expect(keys).not.toContain('undef');
  });

  it('encodes a structured attrs value as a JSON stringValue', () => {
    const rec = buildOtlpLogRecord({
      ts: 0,
      level: 'error',
      event: 'hub.attr.structured',
      attrs: { list: [1, 2, 3], map: { a: 1 } },
    });
    const byKey = Object.fromEntries(rec.attributes!.map((a) => [a.key, a.value]));
    expect(byKey.list).toEqual({ stringValue: '[1,2,3]' });
    expect(byKey.map).toEqual({ stringValue: '{"a":1}' });
  });

  it('encodes number and boolean attrs as intValue / boolValue', () => {
    const rec = buildOtlpLogRecord({
      ts: 0,
      level: 'info',
      event: 'hub.attr.typed',
      attrs: { count: 7, ratio: 1.5, flag: true },
    });
    const byKey = Object.fromEntries(rec.attributes!.map((a) => [a.key, a.value]));
    expect(byKey.count).toEqual({ intValue: '7' });
    expect(byKey.ratio).toEqual({ intValue: '1.5' });
    expect(byKey.flag).toEqual({ boolValue: true });
  });

  it('carries trace_id and span_id onto the record, and omits them otherwise', () => {
    const traced = buildOtlpLogRecord({
      ts: 0,
      level: 'info',
      event: 'a',
      trace_id: '4bf92f3577b34da6a3ce929d0e0e4736',
      span_id: '00f067aa0ba902b7',
    });
    expect(traced.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(traced.spanId).toBe('00f067aa0ba902b7');

    const bare = buildOtlpLogRecord({ ts: 0, level: 'info', event: 'a' });
    expect('traceId' in bare).toBe(false);
    expect('spanId' in bare).toBe(false);
  });

  it('omits the attributes field entirely when no attribute is produced', () => {
    const rec = buildOtlpLogRecord({
      ts: 0,
      level: 'info',
      event: 'hub.sparse',
      attrs: { dropped: null },
    });
    expect(rec.attributes).toBeUndefined();
  });
});

// -- WOCLAW_OTLP_HEADERS: rejected shapes ----------------------------------

describe('otlp_sink: WOCLAW_OTLP_HEADERS parsing', () => {
  async function headersSeen(rawEnv: string | undefined): Promise<Record<string, string>> {
    process.env.WOCLAW_OTLP_ENDPOINT = ENDPOINT;
    if (rawEnv === undefined) delete process.env.WOCLAW_OTLP_HEADERS;
    else process.env.WOCLAW_OTLP_HEADERS = rawEnv;
    let captured: Record<string, string> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        captured = init.headers as Record<string, string>;
        return jsonResponse('{}');
      })
    );
    await sendOtlpLogsOnce([buildOtlpLogRecord({ ts: 0, level: 'info', event: 'a' })], {
      name: 'woclaw-hub',
    });
    return captured;
  }

  it('sends only Content-Type when the headers env is unset', async () => {
    expect(await headersSeen(undefined)).toEqual({ 'Content-Type': 'application/json' });
  });

  it('returns no extra headers when the env is the JSON literal null', async () => {
    expect(await headersSeen('null')).toEqual({ 'Content-Type': 'application/json' });
  });

  it('returns no extra headers when the env is a non-object JSON scalar', async () => {
    expect(await headersSeen('42')).toEqual({ 'Content-Type': 'application/json' });
    expect(await headersSeen('"a-string"')).toEqual({ 'Content-Type': 'application/json' });
  });

  it('returns no extra headers when the env is a JSON array', async () => {
    expect(await headersSeen('["x-team","y-team"]')).toEqual({ 'Content-Type': 'application/json' });
  });

  it('returns no extra headers when the env is unparseable JSON', async () => {
    expect(await headersSeen('{not json')).toEqual({ 'Content-Type': 'application/json' });
  });

  it('keeps only string-valued pairs from a well-formed headers object', async () => {
    const headers = await headersSeen('{"Authorization":"Bearer t","X-Count":3,"X-Nested":{"a":1},"X-Null":null}');
    expect(headers['Authorization']).toBe('Bearer t');
    expect('X-Count' in headers).toBe(false);
    expect('X-Nested' in headers).toBe(false);
    expect('X-Null' in headers).toBe(false);
    expect(headers['Content-Type']).toBe('application/json');
  });
});

// -- sendOtlpLogsOnce: failure and body edges -------------------------------

describe('otlp_sink: sendOtlpLogsOnce transport edges', () => {
  const one = () => [buildOtlpLogRecord({ ts: 0, level: 'info', event: 'a' })];

  it('returns the original Error when fetch rejects, counting the batch as sent', async () => {
    process.env.WOCLAW_OTLP_ENDPOINT = ENDPOINT;
    const boom = new Error('ECONNREFUSED 127.0.0.1:4318');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw boom;
      })
    );
    const out = await sendOtlpLogsOnce(one(), { name: 'woclaw-hub' });
    expect(out.sent).toBe(1);
    expect(out.rejected).toBe(0);
    expect(out.error).toBe(boom);
    expect(getDroppedRecordsTotal()).toBe(0);
  });

  it('wraps a non-Error throw from fetch in an Error', async () => {
    process.env.WOCLAW_OTLP_ENDPOINT = ENDPOINT;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw 'string failure';
      })
    );
    const out = await sendOtlpLogsOnce(one(), { name: 'woclaw-hub' });
    expect(out.error).toBeInstanceOf(Error);
    expect(out.error!.message).toBe('string failure');
  });

  it('treats a 2xx body of the JSON literal null as full success', async () => {
    process.env.WOCLAW_OTLP_ENDPOINT = ENDPOINT;
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse('null')));
    const out = await sendOtlpLogsOnce(one(), { name: 'woclaw-hub' });
    expect(out.sent).toBe(1);
    expect(out.rejected).toBe(0);
    expect(out.error).toBeNull();
    expect(getDroppedRecordsTotal()).toBe(0);
  });

  it('reports the status without a body when the error response body cannot be read', async () => {
    process.env.WOCLAW_OTLP_ENDPOINT = ENDPOINT;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 500,
        text: async () => {
          throw new Error('body stream closed');
        },
      }))
    );
    const out = await sendOtlpLogsOnce(one(), { name: 'woclaw-hub' });
    expect(out.sent).toBe(0);
    expect(out.error).toBeInstanceOf(Error);
    expect(out.error!.message).toBe('OTLP HTTP 500: ');
  });

  it('truncates a long error body to 200 characters', async () => {
    process.env.WOCLAW_OTLP_ENDPOINT = ENDPOINT;
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(5000), { status: 503 })));
    const out = await sendOtlpLogsOnce(one(), { name: 'woclaw-hub' });
    expect(out.error!.message).toBe(`OTLP HTTP 503: ${'x'.repeat(200)}`);
  });

  it('accumulates dropped records across successive partial_success responses', async () => {
    process.env.WOCLAW_OTLP_ENDPOINT = ENDPOINT;
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse('{"partialSuccess":{"rejectedLogRecords":4}}')));
    const out = await sendOtlpLogsOnce(one(), { name: 'woclaw-hub' });
    expect(out.rejected).toBe(4);
    expect(getDroppedRecordsTotal()).toBe(4);
  });
});
