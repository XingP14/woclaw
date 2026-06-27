import { describe, it, expect } from 'vitest';
import { errorMessage, errorToString } from '../src/errors.js';

describe('plugin/src/errors.ts (mirrors hub/src/errors.ts for channel.ts migration)', () => {
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

  it('handles null and undefined', () => {
    expect(errorMessage(null)).toBe('null');
    expect(errorMessage(undefined)).toBe('');
  });

  it('handles numbers and booleans', () => {
    expect(errorMessage(404)).toBe('404');
    expect(errorMessage(false)).toBe('false');
  });

  it('preserves Error subclass identity', () => {
    class CustomError extends Error {}
    expect(errorMessage(new CustomError('custom'))).toBe('custom');
    expect(errorToString(new CustomError('custom'))).toBe('Error: custom');
  });
});
