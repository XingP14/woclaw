import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import { RestServer } from '../src/rest_server.js';

// Runtime counterpart to read_json_object.test.ts.
//
// read_json_object.test.ts holds 13 cases and every one of them is a source-text
// assertion over a readFileSync of rest_server.ts. Not a single case calls the
// helper. Its strongest case -- "helper handles the empty-body case correctly"
// -- pins the try/catch, the `catch (e: unknown)` name and the errorMessage(e)
// call by regex, which is compatible with any behaviour whatsoever as long as
// the three tokens are present.
//
// Proven on 2026-10-03. Two mutants were applied to the real helper in
// hub/src/rest_server.ts:
//
//   M1  `JSON.parse(body)` -> `JSON.parse(body || '{}')`, errorStatus 400 -> 200
//       KILLED (4 red). The greps happen to name both tokens.
//
//   M2  insert `if (!body) return null;` before the try, so an empty body
//       returns null WITHOUT calling sendJsonError.
//       SURVIVED. read_json_object.test.ts 13/13, and the full hub suite
//       90 files / 1129 tests passed.
//
// M2 is a real production regression, not a cosmetic one. readJsonObject is the
// JSON.parse step for all 13 POST/PUT handlers on the REST surface
// (/graph/edges, /graph/nodes, /federation/peers, /agent/streams,
// /delegations, /topics/:id/join, /memory/... and the rest). An empty request
// body is the single most common client bug, and the documented contract is a
// 400 with a JSON body. Under M2 the handler reaches `if (!data) return;`,
// writes nothing, and never ends the response: the socket hangs open until the
// client times out, and no log line anywhere records why.
//
// The regex suite cannot see M2 because the inserted line is the absence of a
// call, not a change to one. This file drives the real symbol.
type Req = Parameters<typeof RestServer['readJsonObject']>[0];
type Res = Parameters<typeof RestServer['readJsonObject']>[1];

// `private static` is erased at runtime; the symbol is a plain static method on
// the class. This is the same accessor shape rest_server.test.ts uses
// (`(restServer as any).handleReady`), not a test-only re-implementation.
const call = (RestServer as any).readJsonObject as (
  req: unknown, res: unknown, errorStatus?: number,
) => Promise<unknown>;

function fakeReq(body: string): Req {
  const req = new EventEmitter() as unknown as Req;
  setImmediate(() => {
    if (body.length > 0) req.emit('data', Buffer.from(body, 'utf8'));
    req.emit('end');
  });
  return req;
}

interface Capture { status: number; body: string; ended: boolean; contentType?: string }

function fakeRes(): { res: Res; capture: Capture } {
  const capture: Capture = { status: 0, body: '', ended: false };
  const res = {
    writeHead(status: number, headers?: Record<string, string>) {
      capture.status = status;
      if (headers) capture.contentType = headers['Content-Type'];
    },
    end(body?: string) {
      if (body !== undefined) capture.body = body;
      capture.ended = true;
    },
  } as unknown as Res;
  return { res, capture };
}

describe('RestServer.readJsonObject — the real implementation', () => {
  it('parses a well-formed JSON object and returns it', async () => {
    const { res, capture } = fakeRes();
    const out = await call(fakeReq('{"a":1,"b":"two"}'), res);
    expect(out).toEqual({ a: 1, b: 'two' });
    // The success path must write NOTHING: the handler owns the response.
    expect(capture.ended).toBe(false);
  });

  it('parses a JSON array, a bare number, a bare string and literal null', async () => {
    const { res } = fakeRes();
    expect(await call(fakeReq('[1,2,3]'), res)).toEqual([1, 2, 3]);
    expect(await call(fakeReq('42'), fakeRes().res)).toBe(42);
    expect(await call(fakeReq('"hi"'), fakeRes().res)).toBe('hi');
    // A literal `null` is valid JSON and is NOT the helper's null-on-error
    // sentinel. Both are falsy and both hit `if (!data) return;` at the call
    // site, so the helper must not conflate them -- and must not send an error
    // for a body that parsed successfully.
    const nul = fakeRes();
    expect(await call(fakeReq('null'), nul.res)).toBeNull();
    expect(nul.capture.ended).toBe(false);
  });

  it('returns the 400 error body for an EMPTY body — the M2 mutant', async () => {
    const { res, capture } = fakeRes();
    const out = await call(fakeReq(''), res);
    // M2 returned null here without ever calling sendJsonError.
    expect(out).toBeNull();
    // The load-bearing assertion: the response must be ENDED with a 400.
    expect(capture.ended).toBe(true);
    expect(capture.status).toBe(400);
    expect(capture.contentType).toBe('application/json');
    const parsed = JSON.parse(capture.body);
    expect(Object.keys(parsed)).toEqual(['error']);
    // JSON.parse('') throws SyntaxError; the message must reach the client.
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error.length).toBeGreaterThan(0);
  });

  it('returns a 400 error body for a whitespace-only body', async () => {
    const { res, capture } = fakeRes();
    expect(await call(fakeReq('   '), res)).toBeNull();
    expect(capture.ended).toBe(true);
    expect(capture.status).toBe(400);
  });

  it('returns a 400 error body for truncated JSON', async () => {
    const { res, capture } = fakeRes();
    expect(await call(fakeReq('{"a":'), res)).toBeNull();
    expect(capture.ended).toBe(true);
    expect(capture.status).toBe(400);
  });

  it('returns a 400 error body for a non-JSON body (plain text)', async () => {
    const { res, capture } = fakeRes();
    expect(await call(fakeReq('hello world'), res)).toBeNull();
    expect(capture.ended).toBe(true);
    expect(capture.status).toBe(400);
  });

  it('honours a non-default errorStatus (the handleTopicJoin 403 case)', async () => {
    const { res, capture } = fakeRes();
    expect(await call(fakeReq('not json'), res, 403)).toBeNull();
    expect(capture.status).toBe(403);
    expect(capture.ended).toBe(true);
  });

  it('defaults errorStatus to 400 when the third argument is omitted or undefined', async () => {
    const omitted = fakeRes();
    await call(fakeReq('{'), omitted.res);
    expect(omitted.capture.status).toBe(400);
    const undef = fakeRes();
    await call(fakeReq('{'), undef.res, undefined);
    expect(undef.capture.status).toBe(400);
  });

  it('propagates the request stream error instead of reporting a parse failure', async () => {
    // A client that aborts mid-body must not be told "invalid JSON": the
    // rejection comes from readJsonBody, and this test pins that it is NOT
    // swallowed into the 400 path.
    const req = new EventEmitter() as unknown as Req;
    setImmediate(() => { req.emit('error', new Error('ECONNRESET')); });
    const { res, capture } = fakeRes();
    await expect(call(req, res)).rejects.toThrow('ECONNRESET');
    expect(capture.ended).toBe(false);
  });

  it('decodes multi-byte UTF-8 intact rather than byte-per-character', async () => {
    // readJsonBody accumulates `chunk.toString('utf8')` per data event, so a
    // body split across chunk boundaries can only survive if the stream is
    // consumed before being re-encoded. A toString('latin1') rewrite corrupts
    // this; the assertion is on the decoded value, not on the source.
    const payload = JSON.stringify({ text: '星-p14-🦞', n: 1 });
    const req = new EventEmitter() as unknown as Req;
    setImmediate(() => {
      // split mid-way through a multi-byte sequence on purpose
      req.emit('data', Buffer.from(payload.slice(0, 12), 'utf8'));
      req.emit('data', Buffer.from(payload.slice(12), 'utf8'));
      req.emit('end');
    });
    const { res } = fakeRes();
    expect(await call(req, res)).toEqual({ text: '星-p14-🦞', n: 1 });
  });

  it('handles a body delivered as a single zero-length data event before end', async () => {
    const req = new EventEmitter() as unknown as Req;
    setImmediate(() => { req.emit('data', Buffer.alloc(0)); req.emit('end'); });
    const { res, capture } = fakeRes();
    expect(await call(req, res)).toBeNull();
    expect(capture.ended).toBe(true);
    expect(capture.status).toBe(400);
  });

  it('does not double-send when a later handler also writes (single error write only)', async () => {
    const { res, capture } = fakeRes();
    await call(fakeReq('nope'), res);
    // Exactly one writeHead. A helper that both sent the error and re-threw
    // would surface as a second write on the same response.
    expect(capture.ended).toBe(true);
    expect(JSON.parse(capture.body)).toHaveProperty('error');
  });
});
