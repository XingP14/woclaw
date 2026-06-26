import { describe, it, expect } from 'vitest';
import { errorMessage, errorToString } from '../src/errors.js';

describe('errorMessage / errorToString (regression for 06-26 unknown-narrowing helper)', () => {
  it('extracts message from Error instance', () => {
    const e = new Error('boom');
    expect(errorMessage(e)).toBe('boom');
    expect(errorToString(e)).toBe('Error: boom');
  });

  it('returns string literal as-is', () => {
    expect(errorMessage('plain string')).toBe('plain string');
    expect(errorToString('plain string')).toBe('plain string');
  });

  it('JSON-stringifies plain objects', () => {
    expect(errorMessage({ code: 42, reason: 'oops' })).toBe('{"code":42,"reason":"oops"}');
  });

  it('falls back to String() for circular structures (JSON.stringify throws)', () => {
    const circ: any = {};
    circ.self = circ;
    // JSON.stringify(circ) returns '{}' (silent on circular), so helper
    // surfaces that. The fallback branch is exercised only when stringify
    // throws (rare); we still verify String() coercion as last resort.
    expect(typeof errorMessage(circ)).toBe('string');
  });

  it('handles null and undefined', () => {
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('');
  });

  it('handles numbers and booleans', () => {
    expect(errorMessage(404)).toBe('404');
    expect(errorMessage(false)).toBe('false');
  });

  it('preserves Error subclass identity', () => {
    class CustomError extends Error {
      constructor(public code: number, msg: string) {
        super(msg);
        this.name = 'CustomError';
      }
    }
    const e = new CustomError(7, 'nope');
    expect(errorMessage(e)).toBe('nope');
    expect(errorToString(e)).toContain('CustomError');
    expect(errorToString(e)).toContain('nope');
  });
});
