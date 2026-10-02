import { describe, it, expect } from 'vitest';
import { parseIntParam } from '../src/rest_server.js';

// Runtime counterpart to parse_int_param.test.ts.
//
// parse_int_param.test.ts asserts on the SOURCE TEXT of parseIntParam and,
// for its behavioural cases, runs a local copy of the helper it describes as
// "copied verbatim from rest_server.ts so the test exercises the actual
// implementation logic". That copy is the defect: it is a second implementation
// that can drift from the original while every assertion stays green.
//
// Proven on 2026-10-03: with the production helper mutated to
// `return parseInt(raw, 10) + 1`, the full hub suite reported
// 89 files / 1117 tests passed. Every ?limit=, ?depth=, ?maxDepth= and
// ?gracePeriodMs= value on the REST surface would have been off by one and
// nothing went red.
//
// This file imports the real symbol, so the copy cannot drift.
describe('parseIntParam — the real exported implementation', () => {
  it('returns defaultValue when the query param is absent', () => {
    expect(parseIntParam(new URL('http://localhost/memory/search?q=hi'), 'limit', 10)).toBe(10);
  });

  it('treats an empty param as missing, matching the 6 original `||` sites', () => {
    expect(parseIntParam(new URL('http://localhost/x?limit='), 'limit', 10)).toBe(10);
  });

  it('parses a positive integer verbatim (the mutation canary)', () => {
    expect(parseIntParam(new URL('http://localhost/x?limit=42'), 'limit', 10)).toBe(42);
  });

  it('parses zero without falling back to the default', () => {
    expect(parseIntParam(new URL('http://localhost/x?limit=0'), 'limit', 10)).toBe(0);
  });

  it('parses a negative integer verbatim', () => {
    expect(parseIntParam(new URL('http://localhost/x?limit=-5'), 'limit', 10)).toBe(-5);
  });

  it('returns NaN for an unparseable value, preserving parseInt parity', () => {
    expect(Number.isNaN(parseIntParam(new URL('http://localhost/x?limit=abc'), 'limit', 10))).toBe(true);
  });

  it('parses only the leading digits of a trailing-garbage value', () => {
    expect(parseIntParam(new URL('http://localhost/x?limit=12abc'), 'limit', 10)).toBe(12);
  });

  it('does not reinterpret a value that overflows Number.MAX_SAFE_INTEGER', () => {
    // parseInt loses precision rather than throwing; the helper must not be
    // rewritten into parseInt(x, 10) with an added finite/range check.
    expect(parseIntParam(new URL('http://localhost/x?limit=99999999999999999999'), 'limit', 10))
      .toBe(99999999999999999999);
  });

  it('handles the gracePeriodMs default used by the token-rotate route', () => {
    expect(parseIntParam(new URL('http://localhost/admin/token/rotate'), 'gracePeriodMs', 300000))
      .toBe(300000);
  });

  it('handles the maxDepth default and override used by the graph-paths route', () => {
    expect(parseIntParam(new URL('http://localhost/graph/paths/a/b'), 'maxDepth', 5)).toBe(5);
    expect(parseIntParam(new URL('http://localhost/graph/paths/a/b?maxDepth=10'), 'maxDepth', 5)).toBe(10);
  });

  it('does not treat a whitespace-only value as missing', () => {
    // '%20' is truthy for `||`, so it reaches parseInt rather than falling back
    // to the default, and parseInt(' ') is NaN. A rewrite to `??` or to a
    // trim-based check would return 10 instead.
    expect(Number.isNaN(parseIntParam(new URL('http://localhost/x?limit=%20'), 'limit', 10))).toBe(true);
  });

  it('distinguishes a 0 default from a missing param', () => {
    expect(parseIntParam(new URL('http://localhost/x'), 'limit', 0)).toBe(0);
    expect(parseIntParam(new URL('http://localhost/x'), 'limit', 7)).toBe(7);
  });
});
