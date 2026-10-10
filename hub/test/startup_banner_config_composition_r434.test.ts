/**
 * R434 — the startup banner and the config-file loader disagree with each
 * other, and the banner also disagrees with the servers it is describing.
 *
 * Both gaps are INVISIBLE to the suites that exist:
 *
 *   - `config_file.test.ts` asserts that a config file setting
 *     `authToken: null` writes a real null over the base value, and calls
 *     that a documented sharp edge. Nothing then feeds that value to
 *     `printConfigDump`, which calls `config.authToken.substring(0, 8)`.
 *     The two halves are asserted independently and neither composes.
 *   - `startup_banner.test.ts` asserts the TLS line with a config where
 *     tlsKey is set (and tlsCert is not) and expects "enabled
 *     (wss:// + https://)" — pinning the DIVERGENCE as if it were the
 *     contract. ws_server.ts and rest_server.ts both gate on
 *     `!!(config.tlsKey && config.tlsCert)`. So an operator who sets only
 *     TLS_KEY is told by the hub's own banner that it is serving wss://
 *     and https://, while both servers listen in the clear.
 *
 * No production change here: both are behaviour decisions (whose TLS gate
 * wins? should a null token crash the banner?) and this file pins the
 * MEASURED shape so the escape is visible the day either is wired up.
 *
 * Measured 2026-10-11 01:07 CST with the actual built module, not with an
 * assumed shape — the null-token crash and the tlsKey-only banner text are
 * both observed output, not predictions.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { printConfigDump, printEndpointsBanner } from '../src/startup_banner.js';
import { loadConfigFile } from '../src/config_file.js';
import type { Config } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'src');

function readSrc(p: string): string {
  return readFileSync(p, 'utf8');
}

function baseConfig(): Config {
  return {
    port: 8080,
    restPort: 8081,
    host: '127.0.0.1',
    dataDir: './data',
    authToken: 'clawtoken-abcdef',
  } as Config;
}

/** Capture every console.log argument printConfigDump emits. */
function captureDump(config: Config): unknown[] {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    printConfigDump(config);
    return spy.mock.calls.map((c) => c[0]);
  } finally {
    spy.mockRestore();
  }
}

/** Capture every console.log argument printEndpointsBanner emits. */
function captureBanner(config: Config, uiPort?: number): unknown[] {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    printEndpointsBanner(config, uiPort);
    return spy.mock.calls.map((c) => c[0]);
  } finally {
    spy.mockRestore();
  }
}

function lineWith(lines: unknown[], needle: string): string {
  const hit = lines.find((l) => typeof l === 'string' && l.includes(needle));
  if (hit === undefined) {
    throw new Error(`no banner line containing ${needle}; got ${JSON.stringify(lines)}`);
  }
  return hit as string;
}

afterEach(() => vi.restoreAllMocks());

describe('R434: loadConfigFile output composed with printConfigDump', () => {
  let dir: string;

  it('a null authToken written by the config file crashes the banner printer', () => {
    dir = mkdtempSync(join(tmpdir(), 'r434-'));
    try {
      const file = join(dir, 'config.json');
      writeFileSync(file, JSON.stringify({ port: 9999 }));
      const merged = loadConfigFile(file, baseConfig());
      expect(merged.port).toBe(9999);

      // Writing null over the base is the documented shape...
      writeFileSync(file, JSON.stringify({ authToken: null }));
      const nulled = loadConfigFile(file, baseConfig());
      expect(nulled.authToken).toBeNull();

      // ...and handing that value to the banner is a TypeError, not a
      // "unauthenticated" banner. main() calls printConfigDump OUTSIDE the
      // config try/catch, so this surfaces as the top-level Fatal error.
      expect(() => printConfigDump(nulled as unknown as Config))
        .toThrow(TypeError);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a scalar config file leaves the token intact and the banner prints', () => {
    dir = mkdtempSync(join(tmpdir(), 'r434-'));
    try {
      const file = join(dir, 'config.json');
      writeFileSync(file, 'null');
      const merged = loadConfigFile(file, baseConfig());
      expect(merged.authToken).toBe('clawtoken-abcdef');
      expect(lineWith(captureDump(merged), 'Auth Token')).toBe('  Auth Token: clawtoke...');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a config file that omits authToken keeps the base token in the banner', () => {
    dir = mkdtempSync(join(tmpdir(), 'r434-'));
    try {
      const file = join(dir, 'config.json');
      writeFileSync(file, JSON.stringify({ host: '0.0.0.0' }));
      const merged = loadConfigFile(file, baseConfig());
      const lines = captureDump(merged);
      expect(lineWith(lines, 'Host:')).toBe('  Host: 0.0.0.0');
      expect(lineWith(lines, 'Auth Token')).toBe('  Auth Token: clawtoke...');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('R434: the auth-token truncation is unconditional, not length-aware', () => {
  it('a 3-char token is printed in full plus the ellipsis', () => {
    expect(lineWith(captureDump({ ...baseConfig(), authToken: 'abc' }), 'Auth Token'))
      .toBe('  Auth Token: abc...');
  });

  it('an empty token prints only the ellipsis', () => {
    expect(lineWith(captureDump({ ...baseConfig(), authToken: '' }), 'Auth Token'))
      .toBe('  Auth Token: ...');
  });
});

describe('R434: banner TLS gate vs the servers it describes', () => {
  it('both servers require tlsKey AND tlsCert to turn TLS on', () => {
    for (const f of ['ws_server.ts', 'rest_server.ts']) {
      expect(readSrc(join(SRC, f)))
        .toMatch(/const useTLS = !!\((?:this\.)?config\.tlsKey && (?:this\.)?config\.tlsCert\)/);
    }
  });

  it('the banner gates on tlsKey ALONE, so tlsKey-only claims wss + https', () => {
    const config = { ...baseConfig(), tlsKey: '/tmp/key.pem' } as Config;

    expect(lineWith(captureDump(config), 'TLS:')).toBe('  TLS: enabled (wss:// + https://)');
    expect(lineWith(captureBanner(config), 'WebSocket:')).toBe('  WebSocket: wss://127.0.0.1:8080');
    expect(lineWith(captureBanner(config), 'REST API:')).toBe('  REST API:  https://127.0.0.1:8081');
    expect(lineWith(captureBanner(config), 'Graph:')).toBe('  Graph:     https://127.0.0.1:8081/graph/{nodes,edges,stats}');
  });

  it('that is the configuration in which the banner and the servers disagree', () => {
    // tlsCert absent => useTLS is false in both servers => they bind the
    // plaintext listeners, while every banner URL above says otherwise.
    const config = { ...baseConfig(), tlsKey: '/tmp/key.pem' } as Config;
    const serverWouldUseTls = !!(config.tlsKey && config.tlsCert);
    const bannerClaimsTls = !!config.tlsKey;

    expect(serverWouldUseTls).toBe(false);
    expect(bannerClaimsTls).toBe(true);
  });

  it('with both tlsKey and tlsCert set the banner and the servers agree', () => {
    const config = { ...baseConfig(), tlsKey: '/tmp/key.pem', tlsCert: '/tmp/cert.pem' } as Config;
    expect(!!(config.tlsKey && config.tlsCert)).toBe(true);
    expect(lineWith(captureDump(config), 'TLS:')).toBe('  TLS: enabled (wss:// + https://)');
    expect(lineWith(captureBanner(config), 'WebSocket:')).toBe('  WebSocket: wss://127.0.0.1:8080');
  });

  it('with neither set the banner reports the plaintext listeners', () => {
    const config = baseConfig();
    expect(lineWith(captureDump(config), 'TLS:')).toBe('  TLS: disabled (ws:// + http://)');
    expect(lineWith(captureBanner(config), 'WebSocket:')).toBe('  WebSocket: ws://127.0.0.1:8080');
    expect(lineWith(captureBanner(config), 'REST API:')).toBe('  REST API:  http://127.0.0.1:8081');
  });

  it('the TLS line reads only tlsKey — the pin that breaks if the banner is fixed', () => {
    const bannerSrc = readSrc(join(SRC, 'startup_banner.ts'));
    expect((bannerSrc.match(/\bconfig\.tlsKey\b/g) || []).length).toBe(3);
    expect(bannerSrc).not.toMatch(/tlsCert/);
  });
});