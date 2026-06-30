/**
 * Regression test: extraction providers (ollama + openai) must wrap fetch()
 * calls with AbortController + setTimeout so a hung provider connection
 * surfaces a timeout error instead of blocking the extraction pipeline
 * indefinitely. Before this fix, both providers called bare fetch(...) with
 * no signal — a hung TCP connection or stuck Ollama/OpenAI server would
 * hang extraction/import paths for the lifetime of the OS TCP keepalive
 * (typically minutes to hours).
 *
 * Asserts (per provider file):
 *   1. FETCH_TIMEOUT_MS constant present and = 30000.
 *   2. AbortController instantiated before fetch().
 *   3. setTimeout(... controller.abort(), FETCH_TIMEOUT_MS) called.
 *   4. fetch(..., { signal: controller.signal, ... }) — signal is wired in.
 *   5. try/catch around fetch translates AbortError → typed timeout error
 *      mentioning the provider name + the timeout.
 *   6. clearTimeout is called in both success and AbortError branches.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const HUB_SRC = path.resolve(__dirname, '..', 'src');

function loadProviderSrc(filename: string): string {
  const p = path.join(HUB_SRC, 'extraction', 'providers', filename);
  return fs.readFileSync(p, 'utf8');
}

function assertAbortWiring(src: string, providerName: string, timeoutMsgRe: RegExp): void {
  // Strip block + line comments so we don't false-positive on doc comments
  // that mention AbortController.
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  // 1. Constant FETCH_TIMEOUT_MS = 30000 (numeric literal)
  expect(
    /const\s+FETCH_TIMEOUT_MS\s*=\s*30_?000\s*;/.test(codeOnly),
    `[${providerName}] FETCH_TIMEOUT_MS = 30_000 const missing`,
  ).toBe(true);

  // 2. AbortController instantiated
  expect(
    /new\s+AbortController\s*\(\s*\)/.test(codeOnly),
    `[${providerName}] new AbortController() call missing`,
  ).toBe(true);

  // 3. setTimeout(...) wired to controller.abort()
  expect(
    /setTimeout\s*\(\s*\(\s*\)\s*=>\s*controller\.abort\s*\(\s*\)\s*,\s*FETCH_TIMEOUT_MS\s*\)/.test(
      codeOnly,
    ),
    `[${providerName}] setTimeout(...,FETCH_TIMEOUT_MS) → controller.abort() missing`,
  ).toBe(true);

  // 4. fetch() call site passes signal: controller.signal
  expect(
    /fetch\s*\([\s\S]*?signal\s*:\s*controller\.signal\s*,?[\s\S]*?\)\s*;/.test(codeOnly),
    `[${providerName}] fetch(..., { signal: controller.signal }) wiring missing`,
  ).toBe(true);

  // 5. AbortError → typed timeout error mentioning provider name
  expect(
    /\(e\s+as\s+Error\)\??\.name\s*===\s*['"]AbortError['"]/.test(codeOnly) ||
      /e\??\.name\s*===\s*['"]AbortError['"]/.test(codeOnly),
    `[${providerName}] AbortError name check missing in catch block`,
  ).toBe(true);
  expect(
    timeoutMsgRe.test(codeOnly),
    `[${providerName}] typed timeout error message matching ${timeoutMsgRe} missing`,
  ).toBe(true);

  // 6. clearTimeout called >= 2 times (success + AbortError branches)
  const clearMatches = codeOnly.match(/clearTimeout\s*\(\s*timer\s*\)/g) || [];
  expect(
    clearMatches.length >= 2,
    `[${providerName}] expected >=2 clearTimeout(timer) calls (success + AbortError branches), found ${clearMatches.length}`,
  ).toBe(true);
}

describe('extraction provider fetch timeout (regression: hung-provider hang)', () => {
  describe('ollama provider', () => {
    const src = loadProviderSrc('ollama.ts');

    it('ollama.ts has FETCH_TIMEOUT_MS = 30000 const', () => {
      const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(/const\s+FETCH_TIMEOUT_MS\s*=\s*30_?000\s*;/.test(codeOnly)).toBe(true);
    });

    it('ollama.ts wraps fetch() with AbortController + signal + setTimeout', () => {
      assertAbortWiring(
        src,
        'ollama',
        /Ollama request aborted after \$\{FETCH_TIMEOUT_MS\}ms timeout/,
      );
    });
  });

  describe('openai provider', () => {
    const src = loadProviderSrc('openai.ts');

    it('openai.ts has FETCH_TIMEOUT_MS = 30000 const', () => {
      const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(/const\s+FETCH_TIMEOUT_MS\s*=\s*30_?000\s*;/.test(codeOnly)).toBe(true);
    });

    it('openai.ts wraps fetch() with AbortController + signal + setTimeout', () => {
      assertAbortWiring(
        src,
        'openai',
        /OpenAI request aborted after \$\{FETCH_TIMEOUT_MS\}ms timeout/,
      );
    });
  });
});
