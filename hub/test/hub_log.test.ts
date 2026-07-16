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

  it('only 3 console.* calls remain in hub_log.ts — all inside helper bodies', () => {
    const src = readSrc(HUB_LOG_PATH);
    const codeOnly = src.split('\n').filter(l => !l.trimStart().startsWith('//')).join('\n');
    expect(countMatches(codeOnly, /console\.log\(/g)).toBe(1);
    expect(countMatches(codeOnly, /console\.warn\(/g)).toBe(1);
    expect(countMatches(codeOnly, /console\.error\(/g)).toBe(1);
  });

  it('preserves console.log wire format via ...args spread', () => {
    const src = readSrc(HUB_LOG_PATH);
    expect(src).toMatch(/function hubLog\(msg: string, \.\.\.args: unknown\[\]\): void \{[\s\S]*?\.\.\.args/);
    expect(src).toMatch(/function hubWarn\(msg: string, \.\.\.args: unknown\[\]\): void \{[\s\S]*?\.\.\.args/);
    expect(src).toMatch(/function hubError\(msg: string, \.\.\.args: unknown\[\]\): void \{[\s\S]*?\.\.\.args/);
  });
});

describe('rest_server.ts migrated to hub_log helpers', () => {
  it('imports hubLog/hubWarn/hubError from ./hub_log.js', () => {
    const src = readSrc(REST_PATH);
    expect(src).toMatch(/import \{ hubLog, hubWarn, hubError \} from ['"]\.\/hub_log\.js['"]/);
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
    expect(src).toMatch(/import \{ hubLog, hubWarn, hubError \} from ['"]\.\/hub_log\.js['"]/);
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
    expect(src).toMatch(/import \{ hubLog, hubWarn, hubError \} from ['"]\.\/hub_log\.js['"]/);
  });

  it('contains 8 hub[Log|Warn|Error] call sites (parity with pre-refactor 8 inline sites)', () => {
    const src = readSrc(INDEX_PATH);
    const logCalls = (src.match(/hubLog\(/g) || []).length;
    const warnCalls = (src.match(/hubWarn\(/g) || []).length;
    const errorCalls = (src.match(/hubError\(/g) || []).length;
    expect(logCalls + warnCalls + errorCalls).toBe(8);
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
