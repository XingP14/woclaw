import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Regression test for the federation logger helper extraction (07-03 01:23 cron).
 *
 * Before this round, hub/src/federation.ts contained 16 inline
 * `console.[log|warn|error]('[WoClaw Federation] ...')` call sites, each
 * duplicating the `[WoClaw Federation] ` prefix literal. Two latent risks:
 *   (1) drift — a future site could change or omit the prefix and stay silent
 *   (2) uniformity — `console.error('[WoClaw Federation] Invalid message
 *       from ${peer.hubId}:', errorMessage(e))` mixes string-template and
 *       errorMessage() patterns in a way that's hard to grep + lint
 *
 * rFIX: extract 3 file-local helpers (fedLog / fedWarn / fedError) at the top
 * of federation.ts after the imports; each prepends `[WoClaw Federation] ` so
 * call sites pass only the message body. All 16 sites route through the
 * helpers; the 3 underlying console.* calls are confined to the helper bodies.
 *
 * This regression test gates:
 *   (1) the 3 helpers are declared at file scope with canonical signatures
 *   (2) exactly 16 call sites use fed[Log|Warn|Error](...)
 *   (3) NO inline `console.[log|warn|error](`...`[WoClaw Federation]`...)
 *       site remains (gate against regression)
 *   (4) the helper body for each level routes to the matching console.* call
 *       (fedLog→console.log, fedWarn→console.warn, fedError→console.error)
 */

const FED_PATH = join(process.cwd(), 'src', 'federation.ts'); // process.cwd() resolves to hub/ when test is invoked via 

function readFederationSource(): string {
  return readFileSync(FED_PATH, 'utf8');
}

function countMatches(src: string, pattern: RegExp): number {
  return (src.match(pattern) || []).length;
}

describe('federation.ts logger helpers (07-03 01:23 cron regression gate)', () => {
  it('fedLog helper is declared at file scope with canonical signature', () => {
    const src = readFederationSource();
    const sig = /function fedLog\(msg: string, \.\.\.args: unknown\[\]\): void \{/;
    expect(sig.test(src)).toBe(true);
  });

  it('fedWarn helper is declared at file scope with canonical signature', () => {
    const src = readFederationSource();
    const sig = /function fedWarn\(msg: string, \.\.\.args: unknown\[\]\): void \{/;
    expect(sig.test(src)).toBe(true);
  });

  it('fedError helper is declared at file scope with canonical signature', () => {
    const src = readFederationSource();
    const sig = /function fedError\(msg: string, \.\.\.args: unknown\[\]\): void \{/;
    expect(sig.test(src)).toBe(true);
  });

  it('fedLog helper body routes to console.log with [WoClaw Federation] prefix', () => {
    const src = readFederationSource();
    // Match the body inside the fedLog helper — tolerant of internal whitespace.
    const m = src.match(/function fedLog\(msg: string[^)]*\): void \{([\s\S]*?)\n\}/);
    expect(m).not.toBeNull();
    const body = m![1];
    expect(body).toContain('console.log');
    expect(body).toContain('[WoClaw Federation]');
  });

  it('fedWarn helper body routes to console.warn with [WoClaw Federation] prefix', () => {
    const src = readFederationSource();
    const m = src.match(/function fedWarn\(msg: string[^)]*\): void \{([\s\S]*?)\n\}/);
    expect(m).not.toBeNull();
    const body = m![1];
    expect(body).toContain('console.warn');
    expect(body).toContain('[WoClaw Federation]');
  });

  it('fedError helper body routes to console.error with [WoClaw Federation] prefix', () => {
    const src = readFederationSource();
    const m = src.match(/function fedError\(msg: string[^)]*\): void \{([\s\S]*?)\n\}/);
    expect(m).not.toBeNull();
    const body = m![1];
    expect(body).toContain('console.error');
    expect(body).toContain('[WoClaw Federation]');
  });

  it('exactly 10 fedLog call sites exist (parity with pre-refactor inline count)', () => {
    const src = readFederationSource();
    // Exclude the helper declaration line itself.
    const calls = (src.match(/fedLog\(/g) || []).length;
    // 1 declaration + 10 call sites = 11 occurrences of `fedLog(`
    expect(calls).toBe(11);
  });

  it('exactly 3 fedWarn call sites exist', () => {
    const src = readFederationSource();
    const calls = (src.match(/fedWarn\(/g) || []).length;
    // 1 declaration + 3 call sites = 4
    expect(calls).toBe(4);
  });

  it('exactly 3 fedError call sites exist', () => {
    const src = readFederationSource();
    const calls = (src.match(/fedError\(/g) || []).length;
    // 1 declaration + 3 call sites = 4
    expect(calls).toBe(4);
  });

  it('total call-site count is 16 (10 log + 3 warn + 3 error) — sanity floor', () => {
    const src = readFederationSource();
    const logCalls = (src.match(/fedLog\(/g) || []).length - 1; // -1 for declaration
    const warnCalls = (src.match(/fedWarn\(/g) || []).length - 1;
    const errorCalls = (src.match(/fedError\(/g) || []).length - 1;
    expect(logCalls + warnCalls + errorCalls).toBe(16);
  });

  it('no inline `console.log(`...`[WoClaw Federation]`...)` site remains', () => {
    const src = readFederationSource();
    // Strip the 3 helper bodies (which legitimately contain the prefix)
    // by removing the function fed(Log|Warn|Error) { ... } blocks first.
    const stripped = src
      .replace(/function fedLog\(msg: string[\s\S]*?\n\}/, '')
      .replace(/function fedWarn\(msg: string[\s\S]*?\n\}/, '')
      .replace(/function fedError\(msg: string[\s\S]*?\n\}/, '');
    // After stripping helper bodies, no remaining line should have
    // `console.[log|warn|error](` AND `[WoClaw Federation]` on the same line.
    const lines = stripped.split('\n');
    const violations: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/console\.(log|warn|error)\(/.test(line) && /\[WoClaw Federation\]/.test(line)) {
        violations.push(`L${i + 1}: ${line.trim()}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('only 3 console.* calls remain in the file — all inside helper bodies', () => {
    const src = readFederationSource();
    // 1 console.log + 1 console.warn + 1 console.error, each inside a helper body.
    const logCount = countMatches(src, /console\.log\(/g);
    const warnCount = countMatches(src, /console\.warn\(/g);
    const errorCount = countMatches(src, /console\.error\(/g);
    expect(logCount).toBe(1);
    expect(warnCount).toBe(1);
    expect(errorCount).toBe(1);
  });

  it('preserves original console.log(...) wire format for parity (sample site)', () => {
    const src = readFederationSource();
    // fedLog must spread `...args` so existing log(errorMessage(err), x) call
    // shapes still render correctly. This guards against accidentally inlining
    // the helper into a single-arg string concat that drops follow-up args.
    expect(src).toMatch(/function fedLog\(msg: string, \.\.\.args: unknown\[\]\): void \{[\s\S]*?\.\.\.args/);
  });
});
