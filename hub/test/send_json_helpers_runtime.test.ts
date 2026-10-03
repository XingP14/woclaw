import { describe, it, expect } from 'vitest';
import { RestServer } from '../src/rest_server.js';

// Runtime counterpart to the four source-grep suites that nominally cover the
// RestServer response helpers:
//
//   send_json_success.test.ts                  (11 cases, all readFileSync regex)
//   send_json_success_carveout_drift.test.ts   (12 cases, comment-block regex)
//   send_json_success_multiline.test.ts        (16 cases, all readFileSync regex)
//   send_json_error_405_500.test.ts            (16 cases, all readFileSync regex)
//
// Blast radius: `RestServer.sendJsonSuccess` has 61 call sites in rest_server.ts
// and `RestServer.sendJsonError` has 88. Together they are every JSON response
// the hub REST surface emits -- memory, graph, federation, delegation, topics,
// agent streams, rate limits, health, token rotate, graph traversal.
//
// Not one of the 55 cases above calls either symbol. They all assert on the
// TEXT of rest_server.ts. That is structurally unable to see:
//   - a status argument that reaches writeHead wrong,
//   - a Content-Type that is written but wrong,
//   - a payload shape that is stringified differently,
//   - a response that is never `end()`ed at all.
//
// The grep suites did catch real drift (call counts, forbidden inline
// writeHead(405)/(500), the carve-out comment block). This file does not
// replace them -- it pins the part they cannot reach. Both stay.

// `private static` is erased at runtime; the symbol is a plain static method on
// the class. Same accessor shape as read_json_object_runtime.test.ts and
// rest_server.test.ts (`(restServer as any).handleReady`), NOT a test-local
// re-implementation -- a copy would pass against every mutant below.

interface Capture {
  status: number;
  headers: Record<string, string>;
  body: string;
  ended: boolean;
}

function fakeRes(): { res: unknown; capture: Capture } {
  const capture: Capture = { status: 0, headers: {}, body: '', ended: false };
  const res = {
    writeHead(status: number, headers?: Record<string, string>) {
      capture.status = status;
      if (headers) capture.headers = headers;
    },
    end(body?: string) {
      if (body !== undefined) capture.body = body;
      capture.ended = true;
    },
  };
  return { res: res as unknown, capture };
}

const success = (RestServer as any).sendJsonSuccess as (
  res: unknown, status: number, body: unknown,
) => void;
const error = (RestServer as any).sendJsonError as (
  res: unknown, status: number, msg: string,
) => void;

describe('RestServer.sendJsonSuccess — runtime', () => {
  it('writes the 200 status through to writeHead', () => {
    const { res, capture } = fakeRes();
    success(res, 200, { ok: true });
    expect(capture.status).toBe(200);
  });

  it('writes the 201 status through to writeHead — the create paths depend on it', () => {
    // 5 of the 61 call sites use 201 (delegation accept, edge create, node
    // create, delegation result, ...). A helper that coerced to 200 would
    // still satisfy every source-text assertion in the repo.
    const { res, capture } = fakeRes();
    success(res, 201, { ok: true });
    expect(capture.status).toBe(201);
  });

  it('sends Content-Type application/json', () => {
    const { res, capture } = fakeRes();
    success(res, 200, {});
    expect(capture.headers['Content-Type']).toBe('application/json');
  });

  it('ends the response exactly once', () => {
    const { res, capture } = fakeRes();
    success(res, 200, { ok: true });
    expect(capture.ended).toBe(true);
  });

  it('serializes the caller-supplied body with JSON.stringify', () => {
    const { res, capture } = fakeRes();
    success(res, 200, { success: true, count: 3 });
    expect(capture.body).toBe(JSON.stringify({ success: true, count: 3 }));
  });

  it('does not wrap or add an envelope to the body', () => {
    // 61 sites pass their OWN payload shape -- { memories, count }, { results },
    // a raw graph stats object, an array of delegations. An envelope like
    // `{ data: ... }` would silently break every one of them and every grep.
    const { res, capture } = fakeRes();
    success(res, 200, [{ id: 'd1' }, { id: 'd2' }]);
    expect(JSON.parse(capture.body)).toEqual([{ id: 'd1' }, { id: 'd2' }]);
    expect(Object.keys(JSON.parse(capture.body))).toEqual(['0', '1']);
  });

  it('passes a non-object payload (graph.getStats() at one site) through untouched', () => {
    const { res, capture } = fakeRes();
    success(res, 200, { nodes: 3, edges: 2 });
    expect(JSON.parse(capture.body)).toEqual({ nodes: 3, edges: 2 });
  });

  it('handles undefined body without throwing and still ends the response', () => {
    const { res, capture } = fakeRes();
    expect(() => success(res, 200, undefined)).not.toThrow();
    expect(capture.ended).toBe(true);
  });

  it('writes an EMPTY body for an undefined payload — it does not substitute {}', () => {
    // JSON.stringify(undefined) returns the JS value undefined, not a string,
    // so res.end() is called with no payload and the socket closes cleanly.
    // Substituting {} instead (a "helpful" null-guard) turns a 200 with no
    // body into a 200 with a body every client would try to parse.
    const { res, capture } = fakeRes();
    success(res, 200, undefined);
    expect(capture.body).toBe('');
  });

  it('writes a JSON null for an explicit null payload — distinct from undefined', () => {
    const { res, capture } = fakeRes();
    success(res, 200, null);
    expect(capture.body).toBe('null');
  });

  it('preserves nested falsy values that a truthiness-default would drop', () => {
    // `{ success: sent }` where sent === false is a real call site (L524).
    const { res, capture } = fakeRes();
    success(res, 200, { success: false });
    expect(JSON.parse(capture.body)).toEqual({ success: false });
  });

  it('serializes a 0-valued count rather than omitting it', () => {
    // `{ memories, count: memories.length }` — count is 0 on an empty read.
    const { res, capture } = fakeRes();
    success(res, 200, { memories: [], count: 0 });
    expect(JSON.parse(capture.body)).toEqual({ memories: [], count: 0 });
  });
});

describe('RestServer.sendJsonError — runtime', () => {
  it('writes the status through to writeHead', () => {
    const { res, capture } = fakeRes();
    error(res, 405, 'Method not allowed');
    expect(capture.status).toBe(405);
  });

  it('writes the 400 status through to writeHead', () => {
    const { res, capture } = fakeRes();
    error(res, 400, 'bad json');
    expect(capture.status).toBe(400);
  });

  it('writes the 500 status through to writeHead', () => {
    const { res, capture } = fakeRes();
    error(res, 500, 'Internal server error');
    expect(capture.status).toBe(500);
  });

  it('sends Content-Type application/json', () => {
    const { res, capture } = fakeRes();
    error(res, 404, 'Not found');
    expect(capture.headers['Content-Type']).toBe('application/json');
  });

  it('wraps the message in the canonical {error: msg} body shape', () => {
    // read_json_object.test.ts pins this shape BY COMMENT TEXT only. It is the
    // shape every hub client parses, so it is worth pinning by value.
    const { res, capture } = fakeRes();
    error(res, 400, 'Invalid JSON');
    expect(JSON.parse(capture.body)).toEqual({ error: 'Invalid JSON' });
  });

  it('emits exactly one key — clients destructure `.error`', () => {
    const { res, capture } = fakeRes();
    error(res, 400, 'Invalid JSON');
    expect(Object.keys(JSON.parse(capture.body))).toEqual(['error']);
  });

  it('does not stringify the message as a bare JSON string', () => {
    // `res.end(JSON.stringify(msg))` would make every client read a string.
    const { res, capture } = fakeRes();
    error(res, 400, 'Invalid JSON');
    expect(capture.body).not.toBe(JSON.stringify('Invalid JSON'));
  });

  it('preserves a message containing characters that must stay escaped', () => {
    const { res, capture } = fakeRes();
    error(res, 400, 'parse failed at "line 1": unexpected token');
    expect(JSON.parse(capture.body).error).toBe(
      'parse failed at "line 1": unexpected token',
    );
  });

  it('does not uppercase or otherwise rewrite the caller-supplied message', () => {
    // Two distinct 405 strings are in production use -- 'Method not allowed'
    // and 'Method not allowed for this path'. The grep suites count both;
    // only a runtime value assertion shows the helper forwards verbatim.
    const { res, capture } = fakeRes();
    error(res, 405, 'Method not allowed for this path');
    expect(JSON.parse(capture.body).error).toBe('Method not allowed for this path');
  });

  it('ends the response exactly once', () => {
    const { res, capture } = fakeRes();
    error(res, 404, 'Not found');
    expect(capture.ended).toBe(true);
  });

  it('leaves the status a number rather than coercing it to a string', () => {
    const { res, capture } = fakeRes();
    error(res, 418, 'teapot');
    expect(typeof capture.status).toBe('number');
    expect(capture.status).toBe(418);
  });
});

describe('RestServer response helpers — writeHead/end ordering', () => {
  it('calls writeHead before end for a success response', () => {
    // Node throws ERR_HTTP_HEADERS_SENT if the order ever inverts, so this
    // guards a mutation that swaps the two lines in either helper.
    const order: string[] = [];
    const res = {
      writeHead() { order.push('writeHead'); },
      end() { order.push('end'); },
    };
    success(res, 200, { ok: true });
    expect(order).toEqual(['writeHead', 'end']);
  });

  it('calls writeHead before end for an error response', () => {
    const order: string[] = [];
    const res = {
      writeHead() { order.push('writeHead'); },
      end() { order.push('end'); },
    };
    error(res, 500, 'Internal server error');
    expect(order).toEqual(['writeHead', 'end']);
  });

  it('the two helpers produce bodies of different shapes on the same status', () => {
    // Documents the deliberate asymmetry: success emits the caller's payload,
    // error wraps in {error}. A future "unify these helpers" refactor that
    // made success wrap in an envelope would break this.
    const a = fakeRes();
    const b = fakeRes();
    success(a.res, 200, { error: 'a field named error' });
    error(b.res, 200, 'a real error message');
    expect(JSON.parse(a.capture.body)).toEqual({ error: 'a field named error' });
    expect(JSON.parse(b.capture.body)).toEqual({ error: 'a real error message' });
    expect(a.capture.body).not.toBe(b.capture.body);
  });
});
