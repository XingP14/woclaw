/**
 * Round 91.6-A PoC entry contract tests — first shipped wire-shape gates
 * for `hub/src/otlp_sink.ts`.
 *
 * Round 91.6-A is intentionally minimal: 4 source gates + 4 runtime gates
 * that lock down the OTLP wire shape (no network yet) + the dual-timestamp
 * contract (OTel logs data-model, Round 59 §3) + the partial_success
 * counter (OTLP 1.11.0 spec, Round 59 §2.1). The full sink (HTTP POST,
 * exponential backoff, RetryInfo honour, batching) ships in a later round
 * once the wire shape is stable.
 *
 * Gates:
 *   (1) source: `otlp_sink.ts` declares the three top-level helpers
 *       (`buildOtlpLogRecord`, `buildOtlpExportRequest`,
 *       `applyOtlpPartialSuccess`) at file scope with a stable public
 *       signature
 *   (2) source: dual-timestamp contract — both `timeUnixNano` and
 *       `observedTimeUnixNano` are emitted on every LogRecord (not just
 *       one), per the OTel logs data-model field set (Round 59 §3)
 *   (3) source: severity mapping — `info|warn|error` map to OTel
 *       severity numbers 9|13|17 (canonical severity scale)
 *   (4) source: partial_success MUST NOT retry semantics — the helper
 *       path documents + enforces "no retry" via the dropped-records
 *       counter, not by raising an exception
 *   (5) runtime: buildOtlpLogRecord emits both timestamps with the
 *       correct unit conversion (ms-since-epoch → ns-since-epoch string)
 *   (6) runtime: buildOtlpLogRecord encodes attributes when present and
 *       omits the field when empty (sparse record, not full shape dump)
 *   (7) runtime: buildOtlpExportRequest wraps records in a single
 *       resource_logs / scopeLogs envelope tagged with service.name
 *   (8) runtime: applyOtlpPartialSuccess increments the dropped-records
 *       counter and returns the rejected count without retry
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import {
  buildOtlpLogRecord,
  buildOtlpExportRequest,
  applyOtlpPartialSuccess,
  getDroppedRecordsTotal,
  resetDroppedRecordsTotal,
  otlpEnabled,
  otlpEndpoint,
  sendOtlpLogsOnce,
} from '../src/otlp_sink.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OTLP_SINK_PATH = join(__dirname, '..', 'src', 'otlp_sink.ts');

function readSrc(p: string): string {
  return readFileSync(p, 'utf8');
}

// -- 4 source gates -------------------------------------------------------

describe('hub/src/otlp_sink.ts source gates (round 91.6-A PoC)', () => {
  it('source (1): top-level helpers declared with stable signatures', () => {
    const src = readSrc(OTLP_SINK_PATH);
    expect(src).toMatch(/export function buildOtlpLogRecord\(/);
    expect(src).toMatch(/export function buildOtlpExportRequest\(/);
    expect(src).toMatch(/export function applyOtlpPartialSuccess\(/);
  });

  it('source (2): dual-timestamp contract — both timeUnixNano and observedTimeUnixNano emitted', () => {
    const src = readSrc(OTLP_SINK_PATH);
    expect(src).toContain('timeUnixNano');
    expect(src).toContain('observedTimeUnixNano');
    // Both must appear in OtlpLogRecord interface and in buildOtlpLogRecord body
    const interfaceBody = src.slice(src.indexOf('interface OtlpLogRecord'));
    expect(interfaceBody).toContain('timeUnixNano: string');
    expect(interfaceBody).toContain('observedTimeUnixNano: string');
  });

  it('source (3): severity number mapping (info|warn|error → 9|13|17)', () => {
    const src = readSrc(OTLP_SINK_PATH);
    expect(src).toMatch(/info:\s*9/);
    expect(src).toMatch(/warn:\s*13/);
    expect(src).toMatch(/error:\s*17/);
  });

  it('source (4): partial_success MUST NOT retry — documented and counter-enforced', () => {
    const src = readSrc(OTLP_SINK_PATH);
    expect(src).toMatch(/MUST NOT retry/i);
    expect(src).toContain('applyOtlpPartialSuccess');
    expect(src).toContain('dropped_records_total');
  });
});

// -- 4 runtime gates ------------------------------------------------------

describe('hub/src/otlp_sink.ts runtime gates (round 91.6-A PoC)', () => {
  beforeEach(() => {
    resetDroppedRecordsTotal();
  });

  it('runtime (5): dual-timestamp conversion ms → ns string', () => {
    const rec = buildOtlpLogRecord({
      ts: 1722009600000, // 2026-07-26T00:00:00Z in ms
      observedAtMs: 1722009600500, // 500ms later
      level: 'info',
      event: 'hub.topic.created',
    });
    expect(rec.timeUnixNano).toBe('1722009600000000000'); // 1ms = 1_000_000 ns
    expect(rec.observedTimeUnixNano).toBe('1722009600500000000');
    expect(rec.severityNumber).toBe(9);
    expect(rec.severityText).toBe('INFO');
    expect(rec.body.stringValue).toBe('hub.topic.created');
  });

  it('runtime (6): attribute mapping — present when non-empty, omitted when empty', () => {
    const richRec = buildOtlpLogRecord({
      ts: 0,
      level: 'warn',
      event: 'hub.memory.warning',
      topic_id: 't-7',
      session_key: 'agent:1',
      agent_id: 'woclaw',
      duration_ms: 42,
      attrs: { peer_count: 3, label: 'ring' },
    });
    expect(richRec.attributes).toBeDefined();
    expect(richRec.attributes!.length).toBeGreaterThan(0);
    const keys = richRec.attributes!.map((a) => a.key);
    expect(keys).toContain('topic_id');
    expect(keys).toContain('session_key');
    expect(keys).toContain('agent_id');
    expect(keys).toContain('duration_ms');
    expect(keys).toContain('peer_count');
    expect(keys).toContain('label');

    const bareRec = buildOtlpLogRecord({
      ts: 0,
      level: 'info',
      event: 'hub.bare',
    });
    // Either omitted entirely OR explicitly empty — both spec-valid; we
    // accept both to match the round 57 hub_event.test.ts sparse shape.
    if (bareRec.attributes !== undefined) {
      expect(bareRec.attributes).toEqual([]);
    }
  });

  it('runtime (7): buildOtlpExportRequest wraps records in resource_logs / scopeLogs envelope', () => {
    const records = [
      buildOtlpLogRecord({ ts: 0, level: 'info', event: 'a' }),
      buildOtlpLogRecord({ ts: 0, level: 'warn', event: 'b' }),
    ];
    const req = buildOtlpExportRequest(records, { name: 'woclaw-hub', version: '0.6.0' });
    expect(req.resourceLogs).toHaveLength(1);
    const scope = req.resourceLogs[0].scopeLogs[0];
    expect(scope.logRecords).toHaveLength(2);
    expect(scope.scope.name).toBe('@woclaw/hub');
    expect(scope.scope.version).toBe('0.6.0');
    const svcAttr = req.resourceLogs[0].resource.attributes.find((a) => a.key === 'service.name');
    expect(svcAttr?.value.stringValue).toBe('woclaw-hub');
  });

  it('runtime (8): partial_success MUST NOT retry — apply returns rejected count without throwing', () => {
    // First partial_success rejects 5 records → counter increments to 5.
    const first = applyOtlpPartialSuccess({ partialSuccess: { rejectedLogRecords: 5, errorMessage: 'rate' } });
    expect(first).toBe(5);
    expect(getDroppedRecordsTotal()).toBe(5);

    // Second partial_success rejects 3 records → counter increments to 8.
    const second = applyOtlpPartialSuccess({ partialSuccess: { rejectedLogRecords: 3 } });
    expect(second).toBe(3);
    expect(getDroppedRecordsTotal()).toBe(8);

    // Full success (no partial_success field populated) — counter unchanged,
    // no error.
    const third = applyOtlpPartialSuccess({});
    expect(third).toBe(0);
    expect(getDroppedRecordsTotal()).toBe(8);

    // Empty partial_success with rejectedLogRecords=0 — also no-op.
    const fourth = applyOtlpPartialSuccess({ partialSuccess: {} });
    expect(fourth).toBe(0);
    expect(getDroppedRecordsTotal()).toBe(8);
  });

  it('env: otlpEnabled / otlpEndpoint read from WOCLAW_OTLP_ENDPOINT (live env behaviour)', () => {
    // Save and restore so we don't leak env to other tests in the run.
    const orig = process.env.WOCLAW_OTLP_ENDPOINT;
    try {
      delete process.env.WOCLAW_OTLP_ENDPOINT;
      expect(otlpEnabled()).toBe(false);
      expect(otlpEndpoint()).toBeNull();

      process.env.WOCLAW_OTLP_ENDPOINT = 'http://localhost:4318/v1/logs';
      expect(otlpEnabled()).toBe(true);
      expect(otlpEndpoint()).toBe('http://localhost:4318/v1/logs');

      // Empty string is treated as unset (matches Round 57 hub_log pattern).
      process.env.WOCLAW_OTLP_ENDPOINT = '';
      expect(otlpEnabled()).toBe(false);
      expect(otlpEndpoint()).toBeNull();
    } finally {
      if (orig === undefined) delete process.env.WOCLAW_OTLP_ENDPOINT;
      else process.env.WOCLAW_OTLP_ENDPOINT = orig;
    }
  });
});

// -- Round 91.6-B live HTTP layer (sendOtlpLogsOnce) --------------------

describe('hub/src/otlp_sink.ts runtime (round 91.6-B live HTTP layer)', () => {
  const origEndpoint = process.env.WOCLAW_OTLP_ENDPOINT;
  const origHeaders = process.env.WOCLAW_OTLP_HEADERS;

  afterEach(() => {
    if (origEndpoint === undefined) delete process.env.WOCLAW_OTLP_ENDPOINT;
    else process.env.WOCLAW_OTLP_ENDPOINT = origEndpoint;
    if (origHeaders === undefined) delete process.env.WOCLAW_OTLP_HEADERS;
    else process.env.WOCLAW_OTLP_HEADERS = origHeaders;
    vi.restoreAllMocks();
    resetDroppedRecordsTotal();
  });

  it('runtime (9): sendOtlpLogsOnce is a no-op when WOCLAW_OTLP_ENDPOINT is unset', async () => {
    delete process.env.WOCLAW_OTLP_ENDPOINT;
    const records = [buildOtlpLogRecord({ ts: 0, level: 'info', event: 'a' })];
    const out = await sendOtlpLogsOnce(records, { name: 'woclaw-hub', version: '0.6.0' });
    expect(out).toEqual({ sent: 0, rejected: 0, error: null });
    // No network should have been attempted — global fetch remains untouched.
    expect(vi.isMockFunction(globalThis.fetch)).toBe(false);
  });

  it('runtime (10): POSTs application/json with the resource_logs body and parses partial_success', async () => {
    process.env.WOCLAW_OTLP_ENDPOINT = 'http://localhost:4318/v1/logs';
    let captured: { url: string; init: RequestInit } | null = null;
    const stub = vi.fn(async (url: string, init: RequestInit) => {
      captured = { url, init };
      // Server reports 2 of the 3 records were rejected.
      return new Response(JSON.stringify({ partialSuccess: { rejectedLogRecords: 2, errorMessage: 'rate' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', stub);

    const records = [
      buildOtlpLogRecord({ ts: 1000, level: 'info', event: 'a' }),
      buildOtlpLogRecord({ ts: 2000, level: 'warn', event: 'b' }),
      buildOtlpLogRecord({ ts: 3000, level: 'error', event: 'c' }),
    ];
    const out = await sendOtlpLogsOnce(records, { name: 'woclaw-hub', version: '0.6.0' });

    expect(out.error).toBeNull();
    expect(out.sent).toBe(3);
    expect(out.rejected).toBe(2);
    expect(getDroppedRecordsTotal()).toBe(2);
    expect(captured).not.toBeNull();
    expect(captured!.url).toBe('http://localhost:4318/v1/logs');
    expect(captured!.init.method).toBe('POST');
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    const sent = JSON.parse(String(captured!.init.body));
    expect(sent.resourceLogs[0].resource.attributes).toContainEqual({ key: 'service.name', value: { stringValue: 'woclaw-hub' } });
    expect(sent.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(3);
  });

  it('runtime (11): non-2xx response returns {sent:0, rejected:0, error} (no retry per spec)', async () => {
    process.env.WOCLAW_OTLP_ENDPOINT = 'http://localhost:4318/v1/logs';
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('upstream gone', { status: 502 })
    ));
    const records = [buildOtlpLogRecord({ ts: 0, level: 'info', event: 'a' })];
    const out = await sendOtlpLogsOnce(records, { name: 'woclaw-hub' });
    expect(out.sent).toBe(0);
    expect(out.rejected).toBe(0);
    expect(out.error).toBeInstanceOf(Error);
    expect(String(out.error!.message)).toMatch(/502/);
    // No partial_success → no counter change
    expect(getDroppedRecordsTotal()).toBe(0);
  });

  it('runtime (12): 2xx with empty body returns full success (no partial_success path)', async () => {
    process.env.WOCLAW_OTLP_ENDPOINT = 'http://localhost:4318/v1/logs';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
    const records = [buildOtlpLogRecord({ ts: 0, level: 'info', event: 'a' })];
    const out = await sendOtlpLogsOnce(records, { name: 'woclaw-hub' });
    expect(out.sent).toBe(1);
    expect(out.rejected).toBe(0);
    expect(out.error).toBeNull();
    expect(getDroppedRecordsTotal()).toBe(0);
  });
});
