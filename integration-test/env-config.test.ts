// integration-test/env-config.test.ts
//
// Regression coverage for packages/woclaw-hooks/lib/env-config.js
// (extracted from install.js by the 03:03 cron tick on 2026-06-26).
//
// Original install.js inlined a 1-regex parser with 3 latent bugs:
//   1) inline `# comment` after an UNQUOTED value was included in the value
//   2) whitespace around `=` (e.g. `KEY = "VAL"`) silently failed to match
//   3) leading whitespace on a line silently failed to match
// The new lib fixes all 3; the tests below pin the new behaviour and
// would have failed against the original install.js.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import {
  DEFAULT_CONFIG,
  parseEnvContent,
  loadExistingConfig,
  serialiseConfig,
  saveConfig,
} from '../packages/woclaw-hooks/lib/env-config.js';

describe('parseEnvContent', () => {
  it('returns empty object for empty / non-string input', () => {
    expect(parseEnvContent('')).toEqual({});
    expect(parseEnvContent(null as any)).toEqual({});
    expect(parseEnvContent(undefined as any)).toEqual({});
  });

  it('parses canonical KEY="VALUE" form (the saveConfig output format)', () => {
    const input = [
      'WOCLAW_HUB_URL="http://vm153:8083"',
      'WOCLAW_TOKEN="WoClaw2026"',
      'WOCLAW_PROJECT_KEY="project:context"',
      '',
    ].join('\n');
    expect(parseEnvContent(input)).toEqual({
      WOCLAW_HUB_URL: 'http://vm153:8083',
      WOCLAW_TOKEN: 'WoClaw2026',
      WOCLAW_PROJECT_KEY: 'project:context',
    });
  });

  it('parses unquoted KEY=VALUE form', () => {
    const input = 'WOCLAW_HUB_URL=http://vm153:8083\n';
    expect(parseEnvContent(input)).toEqual({ WOCLAW_HUB_URL: 'http://vm153:8083' });
  });

  it('strips inline "# comment" after an UNQUOTED value (regression: bug #1)', () => {
    // Original install.js parser: regex was /^([^="#]+)="?([^"]*)"?/ which,
    // for an unquoted value, greedily captured everything (including the
    // " # production" tail) until end-of-line. New parser must strip it.
    const input = 'WOCLAW_HUB_URL=http://vm153:8083 # production\n';
    expect(parseEnvContent(input)).toEqual({ WOCLAW_HUB_URL: 'http://vm153:8083' });
  });

  it('preserves "#" inside a QUOTED value (deliberate, not a comment)', () => {
    // Inside quotes, '#' is data, not a comment marker.
    const input = 'WOCLAW_HUB_URL="http://vm153:8083 # primary"\n';
    expect(parseEnvContent(input)).toEqual({ WOCLAW_HUB_URL: 'http://vm153:8083 # primary' });
  });

  it('handles whitespace around the "=" sign (regression: bug #2)', () => {
    // Original parser's regex required key to abut '='; "KEY = VALUE"
    // matched as `key ` (trailing space) → silently produced a
    // mis-spaced key. New parser trims both sides.
    const input = 'WOCLAW_HUB_URL = "http://vm153:8083"\n';
    expect(parseEnvContent(input)).toEqual({ WOCLAW_HUB_URL: 'http://vm153:8083' });
  });

  it('handles leading whitespace on a line (regression: bug #3)', () => {
    // Original parser anchored with /^/ then expected non-whitespace
    // key chars; leading-space lines were silently skipped.
    const input = '   WOCLAW_HUB_URL="http://vm153:8083"\n';
    expect(parseEnvContent(input)).toEqual({ WOCLAW_HUB_URL: 'http://vm153:8083' });
  });

  it('ignores full-line comments and blank lines', () => {
    const input = [
      '# this is a header comment',
      '',
      'WOCLAW_HUB_URL="http://vm153:8083"',
      '   # indented comment',
      '',
      'WOCLAW_TOKEN="WoClaw2026"',
    ].join('\n');
    expect(parseEnvContent(input)).toEqual({
      WOCLAW_HUB_URL: 'http://vm153:8083',
      WOCLAW_TOKEN: 'WoClaw2026',
    });
  });

  it('splits on the FIRST "=" so values may contain "=" (e.g. base64 tokens)', () => {
    // Some tokens contain '=' padding. We must not truncate at value '='.
    const input = 'WOCLAW_TOKEN="abc=="\n';
    expect(parseEnvContent(input)).toEqual({ WOCLAW_TOKEN: 'abc==' });
  });

  it('skips lines that have no "=" (e.g. stray text)', () => {
    const input = 'this is not an env line\nWOCLAW_HUB_URL="x"\n';
    expect(parseEnvContent(input)).toEqual({ WOCLAW_HUB_URL: 'x' });
  });

  it('skips lines that start with "=" (empty key)', () => {
    const input = '=orphan\nWOCLAW_HUB_URL="x"\n';
    expect(parseEnvContent(input)).toEqual({ WOCLAW_HUB_URL: 'x' });
  });

  it('handles a value with no closing quote gracefully', () => {
    // Mismatched quote: take everything after the opening quote, strip
    // a possible trailing " # comment" tail, trim. We don't throw.
    const input = 'WOCLAW_HUB_URL="http://broken\nWOCLAW_TOKEN="t"\n';
    expect(parseEnvContent(input)).toEqual({
      WOCLAW_HUB_URL: 'http://broken',
      WOCLAW_TOKEN: 't',
    });
  });
});

describe('loadExistingConfig', () => {
  let tmpDir: string;
  let envFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'woclaw-hooks-env-'));
    envFile = join(tmpDir, '.woclaw', '.env');
    // The parser reads from an arbitrary path; tests write the .env
    // file directly so they must pre-create the parent dir (real
    // install.js goes through saveConfig which does mkdirSync).
    mkdirSync(dirname(envFile), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns DEFAULT_CONFIG (cloned) when the env file does not exist', () => {
    const cfg = loadExistingConfig(envFile);
    expect(cfg).toEqual(DEFAULT_CONFIG);
    // returned object must be a fresh clone, not the frozen singleton,
    // so callers can mutate it (loadExistingConfig users spread later).
    expect(cfg).not.toBe(DEFAULT_CONFIG);
  });

  it('returns DEFAULT_CONFIG merged with file overrides', () => {
    writeFileSync(
      envFile,
      'WOCLAW_HUB_URL="http://other-host:9999"\nWOCLAW_TOKEN="custom"\n',
    );
    const cfg = loadExistingConfig(envFile);
    expect(cfg).toEqual({
      WOCLAW_HUB_URL: 'http://other-host:9999',
      WOCLAW_TOKEN: 'custom',
      WOCLAW_PROJECT_KEY: 'project:context', // falls back to default
    });
  });

  it('preserves custom keys not present in DEFAULT_CONFIG (forward-compat)', () => {
    // Future versions may add new keys to DEFAULT_CONFIG. We must NOT
    // drop user-provided keys we don't know about.
    writeFileSync(envFile, 'WOCLAW_NEW_KEY="future"\n');
    const cfg = loadExistingConfig(envFile);
    expect(cfg.WOCLAW_NEW_KEY).toBe('future');
  });
});

describe('serialiseConfig + saveConfig', () => {
  it('writes KEY="VALUE" per line, single trailing newline', () => {
    expect(
      serialiseConfig({ A: '1', B: '2' }),
    ).toBe('A="1"\nB="2"\n');
  });

  it('produces a file that round-trips through loadExistingConfig', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'woclaw-hooks-rt-'));
    const envFile = join(tmpDir, '.woclaw', '.env');
    try {
      const input = {
        WOCLAW_HUB_URL: 'http://rt-host:1234',
        WOCLAW_TOKEN: 'rt-token',
        WOCLAW_PROJECT_KEY: 'rt:project',
        // Extra custom key to verify forward-compat round-trip.
        WOCLAW_FUTURE: 'rt-future',
      };
      saveConfig(envFile, input);
      expect(existsSync(envFile)).toBe(true);
      const raw = readFileSync(envFile, 'utf8');
      // Canonical format check (order is insertion order).
      expect(raw).toBe(
        'WOCLAW_HUB_URL="http://rt-host:1234"\n' +
        'WOCLAW_TOKEN="rt-token"\n' +
        'WOCLAW_PROJECT_KEY="rt:project"\n' +
        'WOCLAW_FUTURE="rt-future"\n',
      );
      // Round-trip: load what we just wrote and compare to original.
      const reloaded = loadExistingConfig(envFile);
      expect(reloaded).toEqual({
        ...DEFAULT_CONFIG,
        ...input,
      });
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
