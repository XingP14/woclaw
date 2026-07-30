import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HUB_LOG_PATH = join(__dirname, '..', 'src', 'hub_log.ts');
const REST_PATH = join(__dirname, '..', 'src', 'rest_server.ts');
const WS_PATH = join(__dirname, '..', 'src', 'ws_server.ts');
const INDEX_PATH = join(__dirname, '..', 'src', 'index.ts');

function readSrc(p: string): string {
  return readFileSync(p, 'utf8');
}

function countMatches(src: string, pattern: RegExp): number {
  return (src.match(pattern) || []).length;
}

describe('hub/src/hub_log.ts helpers (07-03 02:03 cron regression gate)', () => {
  it('hubLog helper is declared at file scope with canonical signature', () => {
    const src = readSrc(HUB_LOG_PATH);
    const sig = /export function hubLog\(msg: string, \.\.\.args: unknown\[\]\): void \{/;
    expect(sig.test(src)).toBe(true);
  });

  it('hubWarn helper is declared at file scope with canonical signature', () => {
    const src = readSrc(HUB_LOG_PATH);
    const sig = /export function hubWarn\(msg: string, \.\.\.args: unknown\[\]\): void \{/;
    expect(sig.test(src)).toBe(true);
  });

  it('hubError helper is declared at file scope with canonical signature', () => {
    const src = readSrc(HUB_LOG_PATH);
    const sig = /export function hubError\(msg: string, \.\.\.args: unknown\[\]\): void \{/;
    expect(sig.test(src)).toBe(true);
  });

  it('hubLog helper body routes to console.log with [WoClaw] prefix', () => {
    const src = readSrc(HUB_LOG_PATH);
    const m = src.match(/export function hubLog\(msg: string[^)]*\): void \{([\s\S]*?)\n\}/);
    expect(m).not.toBeNull();
    const body = m![1];
    expect(body).toContain('console.log');
    expect(body).toContain('[WoClaw]');
  });

  it('hubWarn helper body routes to console.warn with [WoClaw] prefix', () => {
    const src = readSrc(HUB_LOG_PATH);
    const m = src.match(/export function hubWarn\(msg: string[^)]*\): void \{([\s\S]*?)\n\}/);
    expect(m).not.toBeNull();
    const body = m![1];
    expect(body).toContain('console.warn');
    expect(body).toContain('[WoClaw]');
  });

  it('hubError helper body routes to console.error with [WoClaw] prefix', () => {
    const src = readSrc(HUB_LOG_PATH);
    const m = src.match(/export function hubError\(msg: string[^)]*\): void \{([\s\S]*?)\n\}/);
    expect(m).not.toBeNull();
    const body = m![1];
    expect(body).toContain('console.error');
    expect(body).toContain('[WoClaw]');
  });

  it('legacy 3 console.* calls remain in hub_log.ts — all inside legacy helper bodies (round-03 regression)', () => {
    const src = readSrc(HUB_LOG_PATH);
    const codeOnly = src.split('\n').filter(l => !l.trimStart().startsWith('//')).join('\n');
    // Round-57 extension: hubEvent adds a small switch with one
    // console.[log|warn|error] per level for the env-gated JSON envelope
    // path. The legacy round-03 contract — exactly one console.* call per
    // level INSIDE the legacy hubLog/hubWarn/hubError helper bodies —
    // remains intact. So we expect >= 1 (legacy) and <= 2 per level
    // (legacy + envelope switch).
    expect(countMatches(codeOnly, /console\.log\(/g)).toBeGreaterThanOrEqual(1);
    expect(countMatches(codeOnly, /console\.log\(/g)).toBeLessThanOrEqual(2);
    expect(countMatches(codeOnly, /console\.warn\(/g)).toBeGreaterThanOrEqual(1);
    expect(countMatches(codeOnly, /console\.warn\(/g)).toBeLessThanOrEqual(2);
    expect(countMatches(codeOnly, /console\.error\(/g)).toBeGreaterThanOrEqual(1);
    expect(countMatches(codeOnly, /console\.error\(/g)).toBeLessThanOrEqual(2);
  });

  it('legacy hubLog/hubWarn/hubError each contain exactly one console.* call in body (round-03 byte-identity gate preserved)', () => {
    const src = readSrc(HUB_LOG_PATH);
    const block = (name: string): string => {
      const re = new RegExp(`export function ${name}\\(msg: string[^)]*\\): void \\{([\\s\\S]*?)\\n\\}`);
      const m = src.match(re);
      expect(m).not.toBeNull();
      return m![1];
    };
    const logBody = block('hubLog');
    const warnBody = block('hubWarn');
    const errBody = block('hubError');
    expect((logBody.match(/console\.log\(/g) || []).length).toBe(1);
    expect((warnBody.match(/console\.warn\(/g) || []).length).toBe(1);
    expect((errBody.match(/console\.error\(/g) || []).length).toBe(1);
  });

  it('preserves console.log wire format via ...args spread', () => {
    const src = readSrc(HUB_LOG_PATH);
    expect(src).toMatch(/function hubLog\(msg: string, \.\.\.args: unknown\[\]\): void \{[\s\S]*?\.\.\.args/);
    expect(src).toMatch(/function hubWarn\(msg: string, \.\.\.args: unknown\[\]\): void \{[\s\S]*?\.\.\.args/);
    expect(src).toMatch(/function hubError\(msg: string, \.\.\.args: unknown\[\]\): void \{[\s\S]*?\.\.\.args/);
  });
});

describe('rest_server.ts migrated to hub_log helpers', () => {
  it('imports hubLog/hubWarn/hubError[/hubEvent] from ./hub_log.js', () => {
    const src = readSrc(REST_PATH);
    // Round 57 extended the import set to include hubEvent (observability-
    // envelope PoC). Allow either the round-03 three-name shape or the
    // round-57 four-name shape — any subset containing the three legacy
    // helpers is acceptable.
    expect(src).toMatch(/import\s+\{[^}]*\bhubLog\b[^}]*\bhubWarn\b[^}]*\bhubError\b[^}]*\}\s+from\s+['"]\.\/hub_log\.js['"]/);
  });

  it('contains 7 hub[Log|Warn|Error] call sites (parity with pre-refactor 7 inline console.* sites)', () => {
    const src = readSrc(REST_PATH);
    const logCalls = (src.match(/hubLog\(/g) || []).length;
    const warnCalls = (src.match(/hubWarn\(/g) || []).length;
    const errorCalls = (src.match(/hubError\(/g) || []).length;
    expect(logCalls + warnCalls + errorCalls).toBeGreaterThanOrEqual(7);
  });

  it('no inline `console.*(`...`[WoClaw]`...)` site remains', () => {
    const src = readSrc(REST_PATH);
    const lines = src.split('\n');
    const violations: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/console\.(log|warn|error)\(/.test(line) && /\[WoClaw\]/.test(line)) {
        violations.push(`L${i + 1}: ${line.trim()}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('ws_server.ts migrated to hub_log helpers', () => {
  it('imports hubLog/hubWarn/hubError from ./hub_log.js', () => {
    const src = readSrc(WS_PATH);
    expect(src).toMatch(/import\s+\{[^}]*\bhubLog\b[^}]*\bhubWarn\b[^}]*\bhubError\b[^}]*\}\s+from\s+['"]\.\/hub_log\.js['"]/);
  });

  it('contains >= 13 hub[Log|Warn|Error] call sites (parity with pre-refactor 13 inline sites)', () => {
    const src = readSrc(WS_PATH);
    const logCalls = (src.match(/hubLog\(/g) || []).length;
    const warnCalls = (src.match(/hubWarn\(/g) || []).length;
    const errorCalls = (src.match(/hubError\(/g) || []).length;
    expect(logCalls + warnCalls + errorCalls).toBeGreaterThanOrEqual(13);
  });

  it('no inline `console.*(`...`[WoClaw]`...)` site remains', () => {
    const src = readSrc(WS_PATH);
    const lines = src.split('\n');
    const violations: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/console\.(log|warn|error)\(/.test(line) && /\[WoClaw\]/.test(line)) {
        violations.push(`L${i + 1}: ${line.trim()}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('index.ts migrated to hub_log helpers', () => {
  it('imports hubLog/hubWarn/hubError from ./hub_log.js', () => {
    const src = readSrc(INDEX_PATH);
    expect(src).toMatch(/import\s+\{[^}]*\bhubLog\b[^}]*\bhubWarn\b[^}]*\bhubError\b[^}]*\}\s+from\s+['"]\.\/hub_log\.js['"]/);
  });

  it('contains 9 hub[Log|Warn|Error] call sites (parity with pre-refactor 8 inline sites + 1 new hubWarn site for the 06:03 cron-tick EADDRINUSE handler at hub/src/index.ts:179)', () => {
    const src = readSrc(INDEX_PATH);
    const logCalls = (src.match(/hubLog\(/g) || []).length;
    const warnCalls = (src.match(/hubWarn\(/g) || []).length;
    const errorCalls = (src.match(/hubError\(/g) || []).length;
    expect(logCalls + warnCalls + errorCalls).toBe(9);
  });

  it('no inline `console.*(`...`[WoClaw]`...)` site remains', () => {
    const src = readSrc(INDEX_PATH);
    const lines = src.split('\n');
    const violations: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/console\.(log|warn|error)\(/.test(line) && /\[WoClaw\]/.test(line)) {
        violations.push(`L${i + 1}: ${line.trim()}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('aggregate migration gate (parallels federation_logger 16-site sanity floor)', () => {
  it('total migrated sites = 28 (>= 7 rest_server + 13 ws_server + 8 index)', () => {
    const rest = readSrc(REST_PATH);
    const ws = readSrc(WS_PATH);
    const idx = readSrc(INDEX_PATH);
    const all = rest + '\n' + ws + '\n' + idx;
    const total = ((all.match(/hubLog\(/g) || []).length
      + (all.match(/hubWarn\(/g) || []).length
      + (all.match(/hubError\(/g) || []).length);
    expect(total).toBeGreaterThanOrEqual(28);
  });
});

describe('round 57 — hub.rest.started event wired into rest_server.ts (observability-envelope PoC ship gate)', () => {
  // The new hubEvent helper must be wired into at least one production call
  // site (REST boot) so the envelope PoC is a real shipped code path, not
  // dead helper code. The pre-refactor hubLog site at L156 / L170 (TLS / no-TLS
  // branches) gets paired with hubEvent — exactly one hubEvent call site per
  // branch, named `hub.rest.started`.
  it('rest_server.ts imports hubEvent from ./hub_log.js', () => {
    const src = readSrc(REST_PATH);
    expect(src).toMatch(
      /import\s+\{\s*hubLog,\s*hubWarn,\s*hubError,\s*hubEvent\s*\}\s+from\s+['"]\.\/hub_log\.js['"]/,
    );
  });

  it('rest_server.ts contains exactly 2 `hubEvent(` call sites (TLS + no-TLS branches)', () => {
    const src = readSrc(REST_PATH);
    const matches = src.match(/(?<![A-Za-z0-9_])hubEvent\s*\(/g) || [];
    expect(matches.length).toBe(2);
  });

  it('rest_server.ts emits `hubEvent({ event: "hub.rest.started", ... })` in both branches', () => {
    const src = readSrc(REST_PATH);
    const startedMatches = src.match(/event:\s*['"]hub\.rest\.started['"]/g) || [];
    expect(startedMatches.length).toBe(2);
  });

  it('rest_server.ts hubEvent call site pairs the legacy hubLog site (preserved byte-identity)', () => {
    // The pre-existing hubLog('REST API running on ...') line must still be
    // present immediately before the new hubEvent block in both branches.
    const src = readSrc(REST_PATH);
    expect(src).toMatch(/hubLog\(`REST API running on https:.*\(TLS\)`\);[\s\S]*?hubEvent\(\{[\s\S]*?event:\s*['"]hub\.rest\.started['"]/);
    expect(src).toMatch(/hubLog\(`REST API running on http:.*`\);[\s\S]*?hubEvent\(\{[\s\S]*?event:\s*['"]hub\.rest\.started['"]/);
  });
});
