import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadConfigFile } from '../src/config_file.js';
import { DEFAULT_CONFIG } from '../src/default_config.js';
import type { Config } from '../src/types.js';

// Runtime counterpart to the CONFIG_FILE branch of hub/src/index.ts main().
//
// The branch lived inside main(), in a file that ends with a top-level
// `main().catch(...)` which boots the hub — binds a WS server, opens SQLite,
// starts the forgetting scheduler. So it could not be imported by a test
// without a real side effect on load. This is the sixth instance on woclaw of
// the same class (parse_int_param, env_helpers.ts, default_config.ts,
// ui_static.ts, read_json_object); the fix is the same shape every time:
// extract the body verbatim into a module with no boot side effect, then drive
// it here.
//
// Before this suite, the only assertion available about CONFIG_FILE was that
// the string "CONFIG_FILE" appears in index.ts. Everything below passes that
// grep and is nonetheless reachable-by-breaking:
//
//   M1  inverted spread: `{ ...fileConfig, ...base }` — the file's values would
//       be silently discarded and the env/defaults would win every time.
//   M2  file omitted from the merge entirely (base returned unchanged).
//   M3  merge direction kept but authToken exclusion added, so a file-supplied
//       token is ignored while other keys still apply.
//   M4  `process.exit(1)` swallowed — the throw escapes, and the caller shows
//       no error (test observes the throw, which is what we pin: it MUST throw).
//   M5  catch broadened to swallow the parse error and fall through to base.
//   M6  the whole `if (configPath)` guard inverted, so a set-but-empty
//       CONFIG_FILE is treated as a real path.
//
// The behaviour asserted below is the pre-extraction behaviour, byte-identical.
// Two of these assertions look surprising and are deliberate — they pin
// existing sharp edges rather than blessing them:
//
//   - a JSON `null` or scalar file spreads to nothing and leaves base intact
//     (JS object spread ignores primitives);
//   - a JSON array file spreads its INDICES as string keys ("0", "1"), which is
//     not a shape the Config interface ever mentions;
//   - `"authToken": null` overwrites the real token with a null, which later
//     passes an `if (config.authToken)` truthiness test. That is the merge
//     being a plain spread, not a validating merge.

let dir: string;
let base: Config;

function cfgFile(name: string, contents: string): string {
  const p = join(dir, name);
  writeFileSync(p, contents);
  return p;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'woclaw-config-file-'));
  // A distinct base, so "did the merge happen" is observable without importing
  // the process env the real main() would read.
  base = {
    port: 8080,
    restPort: 8081,
    host: '0.0.0.0',
    dataDir: '/data',
    authToken: 'base-token',
  };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('loadConfigFile', () => {
  it('overrides a base key when the file supplies it', () => {
    const p = cfgFile('c.json', JSON.stringify({ port: 9999 }));
    const out = loadConfigFile(p, base);
    expect(out.port).toBe(9999);
  });

  it('leaves base keys absent from the file untouched', () => {
    const p = cfgFile('c.json', JSON.stringify({ port: 9999 }));
    const out = loadConfigFile(p, base);
    expect(out.restPort).toBe(8081);
    expect(out.host).toBe('0.0.0.0');
    expect(out.dataDir).toBe('/data');
  });

  it('returns a NEW object and does not mutate the base', () => {
    const p = cfgFile('c.json', JSON.stringify({ port: 9999, host: 'h' }));
    const out = loadConfigFile(p, base);
    expect(out).not.toBe(base);
    expect(base.port).toBe(8080);
    expect(base.host).toBe('0.0.0.0');
  });

  it('the FILE wins over the base for authToken specifically', () => {
    const p = cfgFile('c.json', JSON.stringify({ authToken: 'file-token' }));
    expect(loadConfigFile(p, base).authToken).toBe('file-token');
  });

  it('the BASE wins when the file is an empty object', () => {
    const p = cfgFile('c.json', '{}');
    const out = loadConfigFile(p, base);
    expect(out.authToken).toBe('base-token');
    expect(out.port).toBe(8080);
  });

  it('a file of `null` is a no-op spread, not a crash', () => {
    const p = cfgFile('c.json', 'null');
    const out = loadConfigFile(p, base);
    expect(out.authToken).toBe('base-token');
    expect(out.port).toBe(8080);
  });

  it('a scalar JSON file is a no-op spread, not a crash', () => {
    const p = cfgFile('c.json', '"5"');
    const out = loadConfigFile(p, base);
    expect(out.authToken).toBe('base-token');
    expect(out.port).toBe(8080);
  });

  it('an array file spreads its indices as string keys (existing sharp edge)', () => {
    const p = cfgFile('c.json', '[{"port":1111}]');
    const out = loadConfigFile(p, base) as Config & Record<string, unknown>;
    expect(out['0']).toEqual({ port: 1111 });
    // The real keys are untouched: an array does not become a config.
    expect(out.port).toBe(8080);
  });

  it('an explicit null authToken overwrites the real token with null', () => {
    // Pinned deliberately: this is what "plain spread, not validating merge"
    // means, and it is the sharp edge a later refactor must not quietly change.
    const p = cfgFile('c.json', JSON.stringify({ authToken: null }));
    const out = loadConfigFile(p, base);
    expect(out.authToken).toBeNull();
    // ...and null is falsy, so a later `if (config.authToken)` reads as
    // "no token configured" rather than "token configured as null".
    expect(!!out.authToken).toBe(false);
  });

  it('unknown keys in the file are carried through, not filtered', () => {
    const p = cfgFile('c.json', JSON.stringify({ federationPeers: [{ hubId: 'h1' }], hubId: 'me' }));
    const out = loadConfigFile(p, base);
    expect(out.hubId).toBe('me');
    expect(out.federationPeers).toEqual([{ hubId: 'h1' }]);
  });

  it('preserves a nested storage block from the file', () => {
    const p = cfgFile('c.json', JSON.stringify({ storage: { type: 'mysql', mysql: { host: 'db', user: 'u', database: 'd' } } }));
    expect(loadConfigFile(p, base).storage).toEqual({ type: 'mysql', mysql: { host: 'db', user: 'u', database: 'd' } });
  });

  it('throws on a missing file, so the caller can report and exit', () => {
    expect(() => loadConfigFile(join(dir, 'nope.json'), base)).toThrow();
  });

  it('throws a SyntaxError on malformed JSON, distinct from ENOENT', () => {
    const p = cfgFile('bad.json', '{ not json');
    let thrown: unknown;
    try {
      loadConfigFile(p, base);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SyntaxError);
  });

  it('a missing file and a malformed file BOTH surface as a throw to the caller', () => {
    // The single catch in main() treats these identically, which is why the
    // error message cannot promise which one happened.
    const missing = (() => { try { loadConfigFile(join(dir, 'nope.json'), base); } catch (e) { return e; } })();
    const p = cfgFile('bad.json', '{{{');
    const malformed = (() => { try { loadConfigFile(p, base); } catch (e) { return e; } })();
    expect(missing).toBeInstanceOf(Error);
    expect(malformed).toBeInstanceOf(SyntaxError);
  });

  it('reads the file as utf-8, so a BOM-free multi-byte value survives', () => {
    const p = cfgFile('c.json', JSON.stringify({ dataDir: '/数据' }));
    expect(loadConfigFile(p, base).dataDir).toBe('/数据');
  });

  it('works against the REAL DEFAULT_CONFIG as the base', () => {
    // Guards the real call shape in main(): the base is not a hand-made
    // object, it is the module-level const index.ts passes.
    const p = cfgFile('c.json', JSON.stringify({ port: 1234 }));
    const out = loadConfigFile(p, DEFAULT_CONFIG);
    expect(out.port).toBe(1234);
    expect(out.restPort).toBe(DEFAULT_CONFIG.restPort);
    expect(DEFAULT_CONFIG.port).not.toBe(1234);
  });
});
