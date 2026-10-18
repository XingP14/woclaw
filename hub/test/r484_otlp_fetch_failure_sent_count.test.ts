/**
 * R484 — `sendOtlpLogsOnce` counts a batch as `sent` even when the POST
 * never left the process.
 *
 * The defect:
 *   `hub/src/otlp_sink.ts` declares in its own behaviour contract that a
 *   network failure returns `{sent: 0, rejected: 0, error}` — the sibling
 *   non-2xx arm already honours that. The `catch` around `fetch` instead
 *   returns `{sent: records.length, ...}`, so a caller that retries on
 *   `error !== null` while also accumulating `sent` over-counts every
 *   record that failed to reach the receiver. `OtlpSendResult.sent` is
 *   documented as "Number of LogRecords POSTed in this batch"; a request
 *   that threw in `fetch` was never POSTed.
 *
 * The pre-existing suite pinned the wrong arm rather than the contract:
 *   `otlp_sink_edge_branches.test.ts` asserted `out.sent === 1` for a
 *   rejecting fetch. This file asserts the documented contract instead,
 *   and covers both shapes of transport failure (a thrown Error and a
 *   non-2xx response) so the two arms cannot drift apart again.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

import {
  buildOtlpLogRecord,
  sendOtlpLogsOnce,
  getDroppedRecordsTotal,
  resetDroppedRecordsTotal,
} from '../src/otlp_sink.js';

const ENDPOINT = 'http://localhost:4318/v1/logs';

function batch(n = 1) {
  return Array.from({ length: n }, (_, i) =>
    buildOtlpLogRecord({ ts: 1000 * (i + 1), level: 'info', event: `e${i}` })
  );
}

afterEach(() => {
  delete process.env.WOCLAW_OTLP_ENDPOINT;
  delete process.env.WOCLAW_OTLP_HEADERS;
  vi.unstubAllGlobals();
  resetDroppedRecordsTotal();
});

describe('otlp_sink: a batch that never reached the receiver is not `sent`', () => {
  it('reports sent=0 when fetch rejects, for a multi-record batch', async () => {
    process.env.WOCLAW_OTLP_ENDPOINT = ENDPOINT;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED 127.0.0.1:4318');
      })
    );

    const out = await sendOtlpLogsOnce(batch(5), { name: 'woclaw-hub' });

    // Documented contract: nothing was POSTed, so nothing counts as sent.
    expect(out.sent).toBe(0);
    expect(out.rejected).toBe(0);
    expect(out.error).toBeInstanceOf(Error);
    expect(getDroppedRecordsTotal()).toBe(0);
  });

  it('reports sent=0 when fetch rejects with a non-Error throw', async () => {
    process.env.WOCLAW_OTLP_ENDPOINT = ENDPOINT;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw 'string failure';
      })
    );

    const out = await sendOtlpLogsOnce(batch(5), { name: 'woclaw-hub' });

    expect(out.sent).toBe(0);
    expect(out.error).toBeInstanceOf(Error);
  });

  it('agrees with the non-2xx arm: neither transport failure counts as sent', async () => {
    process.env.WOCLAW_OTLP_ENDPOINT = ENDPOINT;
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream gone', { status: 502 })));

    const non2xx = await sendOtlpLogsOnce(batch(5), { name: 'woclaw-hub' });
    expect(non2xx.sent).toBe(0);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      })
    );
    const thrown = await sendOtlpLogsOnce(batch(5), { name: 'woclaw-hub' });

    expect(thrown.sent).toBe(non2xx.sent);
  });

  it('still counts a 2xx response as sent', async () => {
    process.env.WOCLAW_OTLP_ENDPOINT = ENDPOINT;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }))
    );

    const out = await sendOtlpLogsOnce(batch(5), { name: 'woclaw-hub' });

    expect(out.sent).toBe(5);
    expect(out.error).toBeNull();
  });
});
