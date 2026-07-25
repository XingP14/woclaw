// hub/src/otlp_sink.ts
//
// Round 91.6-A PoC entry — first shipped piece of the OTLP exporter that
// exports hubEvent envelopes to an OTLP/HTTP receiver (Loki / Langfuse /
// otel-collector all accept the same OTLP/logs JSON shape).
//
// Why a sink separate from hub_log.ts:
//   hub_log.ts owns the *local* console path. otlp_sink.ts owns the *remote*
//   path. The two never share state — coupling them means changing either
//   the local format or the wire format breaks the other. This module
//   accepts an already-shaped envelope (the HubEventInput from hub_log.ts or
//   any plain object with the same fields) and returns an OTLP/logs request
//   body ready to POST.
//
// Round 91.6-A is the *skeleton* ship — only the wire shape + dual-timestamp
// model + partial_success counter are committed today. Subsequent rounds
// (91.7+ when unblocked after 91.6 PoC entry ships) will add: batching,
// exponential backoff + jitter, RetryInfo honour, OTLP/HTTP `x-otlp-*`
// headers, and per-receiver auth. Round 59 deep-read established MUST NOT
// retry semantics on partial_success (the spec forbids it).
//
// Operating modes (mirroring hub_log.ts): opt-in via env
// `WOCLAW_OTLP_ENDPOINT`. Unset → exporter is a no-op (zero network traffic,
// zero behavior change). Set to e.g. `http://localhost:4318/v1/logs` to
// enable the export path.
//
// Section index:
//   §1 Types (OtlpLogRecord, OtlpExportRequest, OtlpExportResponse)
//   §2 buildOtlpLogRecord — map HubEventInput → OTLP LogRecord with dual
//     Timestamp + ObservedTimestamp (per OTel logs data-model section)
//   §3 buildOtlpExportRequest — wrap LogRecords into resource_logs scope
//   §4 OTLP sink state + sendOnce stub — no-op when env unset, otherwise
//     returns the wire body (network call deferred to a later round)
//   §5 dropped_records_total — partial_success counter surfaced as
//     getDroppedRecordsTotal() for in-process telemetry consumers

export interface OtlpLogRecord {
  timeUnixNano: string;
  observedTimeUnixNano: string;
  severityNumber?: number;
  severityText?: string;
  traceId?: string;
  spanId?: string;
  body: { stringValue: string };
  attributes?: { key: string; value: { stringValue?: string; intValue?: string; boolValue?: boolean } }[];
}

/** Minimal subset of the OTLP ExportLogsServiceRequest the wire needs.
 *  Full schema lives at
 *  https://opentelemetry.io/docs/specs/otlp/#otlphttp-request — this
 *  interface narrows the fields we touch in round 91.6-A. */
export interface OtlpExportRequest {
  resourceLogs: Array<{
    resource: { attributes: { key: string; value: { stringValue: string } }[] };
    scopeLogs: Array<{
      scope: { name: string; version?: string };
      logRecords: OtlpLogRecord[];
    }>;
  }>;
}

/** Subset of OTLP ExportLogsPartialSuccess / ExportLogsServiceResponse used
 *  by the round 91.6-A rejected-record counter. The full schema is defined
 *  in opentelemetry.proto.collector.logs.v1; per OTLP spec (§7, 2026-07-25
 *  fetcher of the OTLP index), "the client MUST NOT retry the request when
 *  it receives a partial success response where the partial_success is
 *  populated." */
export interface OtlpExportPartialSuccess {
  rejectedLogRecords?: number;
  errorMessage?: string;
}

export interface OtlpExportResponse {
  partialSuccess?: OtlpExportPartialSuccess;
}

/** Severity number mapping per OTel logs data-model severity_number field.
 *  9=SeverityINFO / 13=SeverityWARN / 17=SeverityERROR. Source:
 *  https://opentelemetry.io/docs/specs/otel/logs/data-model/ (2026-07-25
 *  canonical fetcher). */
const SEVERITY_NUMBER: Record<'info' | 'warn' | 'error', number> = {
  info: 9,
  warn: 13,
  error: 17,
};

/** Convert ms since UNIX epoch (our event Timestamp) to ns-since-epoch
 *  string per the OTLP wire format requirement. */
function msToUnixNanoString(ms: number): string {
  return String(Math.floor(ms * 1_000_000));
}

/** Build an OTLP LogRecord from a HubEventInput envelope, applying the
 *  dual-timestamp model: `Timestamp` (timeUnixNano) records when the event
 *  occurred in the source system; `ObservedTimestamp` (observedTimeUnixNano)
 *  records when the collection system observed it. The two diverge when
 *  events are replayed from a cursor or arrive late — out-of-order
 *  tolerance for downstream collectors (see Round 59 §3). */
export function buildOtlpLogRecord(env: {
  ts: number;
  observedAtMs?: number;
  level: 'info' | 'warn' | 'error';
  event: string;
  trace_id?: string;
  span_id?: string;
  topic_id?: string;
  session_key?: string;
  agent_id?: string;
  duration_ms?: number;
  attrs?: Record<string, unknown>;
}): OtlpLogRecord {
  const timeUnixNano = msToUnixNanoString(env.ts);
  const observedTimeUnixNano = msToUnixNanoString(env.observedAtMs ?? env.ts);
  const attributes: OtlpLogRecord['attributes'] = [];
  if (env.topic_id !== undefined) attributes.push({ key: 'topic_id', value: { stringValue: env.topic_id } });
  if (env.session_key !== undefined) attributes.push({ key: 'session_key', value: { stringValue: env.session_key } });
  if (env.agent_id !== undefined) attributes.push({ key: 'agent_id', value: { stringValue: env.agent_id } });
  if (env.duration_ms !== undefined) attributes.push({ key: 'duration_ms', value: { intValue: String(env.duration_ms) } });
  for (const [k, v] of Object.entries(env.attrs ?? {})) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string') attributes.push({ key: k, value: { stringValue: v } });
    else if (typeof v === 'number') attributes.push({ key: k, value: { intValue: String(v) } });
    else if (typeof v === 'boolean') attributes.push({ key: k, value: { boolValue: v } });
    else attributes.push({ key: k, value: { stringValue: JSON.stringify(v) } });
  }
  const rec: OtlpLogRecord = {
    timeUnixNano,
    observedTimeUnixNano,
    severityNumber: SEVERITY_NUMBER[env.level],
    severityText: env.level.toUpperCase(),
    body: { stringValue: env.event },
  };
  if (env.trace_id !== undefined) rec.traceId = env.trace_id;
  if (env.span_id !== undefined) rec.spanId = env.span_id;
  if (attributes.length > 0) rec.attributes = attributes;
  return rec;
}

/** Build a minimal ExportLogsServiceRequest wrapping one or more
 *  LogRecords. Resource attributes identify the source — we hard-code
 *  `service.name=woclaw-hub` + `service.version=hub/package.json version`
 *  at call sites that have package.json access (deferred). */
export function buildOtlpExportRequest(
  records: OtlpLogRecord[],
  service: { name: string; version?: string }
): OtlpExportRequest {
  const resourceAttrs: { key: string; value: { stringValue: string } }[] = [
    { key: 'service.name', value: { stringValue: service.name } },
  ];
  if (service.version) resourceAttrs.push({ key: 'service.version', value: { stringValue: service.version } });
  return {
    resourceLogs: [
      {
        resource: { attributes: resourceAttrs },
        scopeLogs: [
          {
            scope: { name: '@woclaw/hub', version: service.version },
            logRecords: records,
          },
        ],
      },
    ],
  };
}

// --- dropped records counter (partial_success MUST NOT retry, Round 59 §2.1) ---

let dropped_records_total = 0;

/** Total rejected records observed across all OTLP responses — incremented
 *  per Round 59 §5.2 design when an ExportLogsServiceResponse.partialSuccess
 *  with `rejectedLogRecords > 0` arrives. The full sink that performs the
 *  HTTP call (future round, deferred until after PoC entry lands) is the
 *  one that reads this counter; it persists across calls in the same
 *  process. The function is exported for test harness + in-process metric
 *  scrape convenience. */
export function getDroppedRecordsTotal(): number {
  return dropped_records_total;
}

/** Reset the dropped counter to zero — used by tests for hermetic setups
 *  and explicitly NOT exported under a `_` prefix because callers are
 *  expected to be either the test harness or a deliberate admin tool.
 *  Removing this without careful audit may mask real partial-failure
 *  signals — keep an audit trail (log every reset in the calling code). */
export function resetDroppedRecordsTotal(): void {
  dropped_records_total = 0;
}

/** Apply the OTLP partial_success response to the dropped counter. Per
 *  the OTLP 1.11.0 spec (Round 59 §2.1): "the client MUST NOT retry the
 *  request when it receives a partial success response where the
 *  partial_success is populated." This helper enforces that — it adds to
 *  the counter and never throws on success. */
export function applyOtlpPartialSuccess(resp: OtlpExportResponse): number {
  const rejected = resp.partialSuccess?.rejectedLogRecords ?? 0;
  if (rejected > 0) {
    dropped_records_total += rejected;
    return rejected;
  }
  return 0;
}

/** True when the operator has configured the OTLP endpoint. Read once
 *  per call (mirrors hub_log.ts envelopeEnabled pattern) so a hub process
 *  started in dormant mode can flip to active mode if the env is mutated
 *  — useful for tests. */
export function otlpEnabled(): boolean {
  const ep = process.env.WOCLAW_OTLP_ENDPOINT;
  return typeof ep === 'string' && ep.length > 0;
}

/** Return the configured OTLP endpoint or null when unset. Pure helper
 *  — no side effects, no network. Lives here so callers (future sink
 *  implementation + test harness) don't need their own env reads. */
export function otlpEndpoint(): string | null {
  const ep = process.env.WOCLAW_OTLP_ENDPOINT;
  return ep && ep.length > 0 ? ep : null;
}
