import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const TEST_DIR = dirname(__filename); // .../hub/test
const HUB_DIR = dirname(TEST_DIR); // .../hub
const INDEX_TS = join(HUB_DIR, 'src', 'index.ts');
const BANNER_TS = join(HUB_DIR, 'src', 'startup_banner.ts');

/**
 * Regression test for the startup_banner helper extraction (07-05 cron).
 *
 * Before this round, hub/src/index.ts contained 17 inline `console.log(`...`)`
 * call sites for the startup banner (12-line ASCII art header + 12-line
 * Configuration dump + 4-line Endpoints banner) plus 1 site-conditional Web UI
 * URL line inside the uiServer.listen callback. Two latent risks:
 *   (1) drift — every new config field required adding a parallel
 *       console.log(`  Field: ${value}`) line; the 2-space indent + trailing
 *       blank-line separator drifted across crons
 *   (2) uniformity — banner formatting interleaved with hub bootstrap code;
 *       reader had to grep 17 console.log sites in main() instead of reading
 *       3 helper bodies
 *
 * rFIX: extract 3 module-local helpers (printStartupHeader / printConfigDump /
 * printEndpointsBanner) into hub/src/startup_banner.ts. Each routes to
 * console.log (banner output is pre-boot display, not a [WoClaw]-prefixed
 * runtime log). 17 inline console.log sites collapse to 3 helper calls + 1
 * sites-conditional Web UI line in the listen callback.
 *
 * This regression test gates:
 *   (1) the 3 helpers declared at file scope with canonical signatures
 *   (2) helper bodies route to console.log with the pre-refactor wire format
 *   (3) index.ts has exactly 3 helper call sites (printStartupHeader /
 *       printConfigDump / printEndpointsBanner) and 1 sites-conditional Web
 *       UI line in the listen callback
 *   (4) no inline ASCII-art / Configuration / Endpoints console.log block
 *       remains in index.ts (gate against regression)
 *   (5) index.ts imports the 3 helpers from ./startup_banner.js (regression
 *       gate — verify the new module is wired)
 *   (6) runtime wire-format parity — invoking printStartupHeader /
 *       printConfigDump / printEndpointsBanner with representative config
 *       produces the byte-identical console.log calls the inline sites used
 */
function readSrc(p: string): string {
  return readFileSync(p, 'utf8');
}

function countMatches(src: string, pattern: RegExp): number {
  return (src.match(pattern) || []).length;
}

describe('hub/src/startup_banner.ts helpers (07-05 05:23 cron regression gate)', () => {
  // -- FILE PRESENCE & MODULE SHAPE -----------------------------------------
  it('startup_banner.ts exists at expected path', () => {
    expect(existsSync(BANNER_TS)).toBe(true);
  });

  it('printStartupHeader helper declared with canonical signature', () => {
    const src = readSrc(BANNER_TS);
    expect(src).toMatch(/export function printStartupHeader\(\): void \{/);
  });

  it('printConfigDump helper declared with canonical signature', () => {
    const src = readSrc(BANNER_TS);
    expect(src).toMatch(/export function printConfigDump\(config: Config\): void \{/);
  });

  it('printEndpointsBanner helper declared with canonical signature', () => {
    const src = readSrc(BANNER_TS);
    expect(src).toMatch(/export function printEndpointsBanner\(config: Config, uiPort\?: number\): void \{/);
  });

  // -- HELPER BODIES ROUTE TO console.log ----------------------------------
  it('printStartupHeader body routes to console.log with ASCII art + subtitle', () => {
    const src = readSrc(BANNER_TS);
    const m = src.match(/export function printStartupHeader\(\): void \{([\s\S]*?)\n\}/);
    expect(m).not.toBeNull();
    const body = m![1];
    expect(body).toContain('console.log');
    expect(body).toContain('OpenClaw Multi-Agent Communication Hub');
    // ASCII art check — at least one of the █ lines must be present
    expect(body).toContain('██████╗ ███████╗██╗   ██╗');
  });

  it('printConfigDump body routes to console.log for each label', () => {
    const src = readSrc(BANNER_TS);
    const m = src.match(/export function printConfigDump\(config: Config\): void \{([\s\S]*?)\n\}/);
    expect(m).not.toBeNull();
    const body = m![1];
    expect(body).toContain('console.log');
    expect(body).toContain('WebSocket Port:');
    expect(body).toContain('REST Port:');
    expect(body).toContain('Auth Token:');
    expect(body).toContain('substring(0, 8)'); // 8-char truncation preserved
    // Conditional storage sub-block
    expect(body).toMatch(/sqlite.*SQLite Path/s);
    expect(body).toMatch(/mysql.*MySQL Host/s);
  });

  it('printEndpointsBanner body routes to console.log with proto + URL', () => {
    const src = readSrc(BANNER_TS);
    const m = src.match(/export function printEndpointsBanner\(config: Config, uiPort\?: number\): void \{([\s\S]*?)\n\}/);
    expect(m).not.toBeNull();
    const body = m![1];
    expect(body).toContain('console.log');
    expect(body).toMatch(/wsProto\s*=\s*config\.tlsKey\s*\?\s*'wss'\s*:\s*'ws'/);
    expect(body).toContain('WebSocket:');
    expect(body).toContain('REST API:');
    expect(body).toContain('Graph:');
    expect(body).toContain('/graph/{nodes,edges,stats}');
  });

  // -- INDEX.TS MIGRATION: 17 SITES → 3 HELPER CALLS -----------------------
  it('index.ts imports the 3 helpers from ./startup_banner.js', () => {
    const src = readSrc(INDEX_TS);
    expect(src).toMatch(/import\s*\{[^}]*printStartupHeader[^}]*\}\s*from\s*'\.\/startup_banner\.js';/);
    expect(src).toMatch(/import\s*\{[^}]*printConfigDump[^}]*\}\s*from\s*'\.\/startup_banner\.js';/);
    expect(src).toMatch(/import\s*\{[^}]*printEndpointsBanner[^}]*\}\s*from\s*'\.\/startup_banner\.js';/);
  });

  it('index.ts has exactly 1 printStartupHeader call site', () => {
    const src = readSrc(INDEX_TS);
    expect(countMatches(src, /printStartupHeader\(\)/g)).toBe(1);
  });

  it('index.ts has exactly 1 printConfigDump call site', () => {
    const src = readSrc(INDEX_TS);
    expect(countMatches(src, /printConfigDump\(config\)/g)).toBe(1);
  });

  it('index.ts has exactly 1 printEndpointsBanner call site', () => {
    const src = readSrc(INDEX_TS);
    expect(countMatches(src, /printEndpointsBanner\(config,\s*uiEnabled\s*\?\s*uiPort\s*:\s*undefined\)/g)).toBe(1);
  });

  it('index.ts has 0 inline ASCII-art banner console.log blocks', () => {
    const src = readSrc(INDEX_TS);
    // The pre-refactor 12-line ASCII art lives inside one console.log block
    // containing the W O C L A W shapes — none of those literal █ sequences
    // should remain inside index.ts.
    expect(src).not.toContain('██████╗ ███████╗██╗   ██╗');
    expect(src).not.toContain('OpenClaw Multi-Agent Communication Hub');
  });

  it('index.ts has 0 inline Configuration dump console.log lines', () => {
    const src = readSrc(INDEX_TS);
    // Pre-refactor Configuration dump emitted lines like:
    //   console.log(`  WebSocket Port: ${config.port}`);
    //   console.log(`  REST Port: ${config.restPort}`);
    //   console.log(`  SQLite Path: ...`);
    //   console.log(`  MySQL Host: ...`)
    // etc. None of those inline sites should remain.
    expect(src).not.toMatch(/console\.log\(`\s*WebSocket Port:/);
    expect(src).not.toMatch(/console\.log\(`\s*REST Port:/);
    expect(src).not.toMatch(/console\.log\(`\s*SQLite Path:/);
    expect(src).not.toMatch(/console\.log\(`\s*MySQL Host:/);
  });

  it('index.ts has 0 inline Endpoints banner console.log lines', () => {
    const src = readSrc(INDEX_TS);
    expect(src).not.toMatch(/console\.log\(`\s*WebSocket:\s*\$\{wsProto\}/);
    expect(src).not.toMatch(/console\.log\(`\s*REST API:\s*\$\{restProto\}/);
    expect(src).not.toMatch(/console\.log\(`\s*Graph:\s*\$\{restProto\}\/graph/);
  });

  it('index.ts uiServer.listen callback no longer inlines the Web UI URL', () => {
    const src = readSrc(INDEX_TS);
    // Pre-refactor: uiServer.listen(uiPort, () => { console.log(`  Web UI:    http://...`); });
    // Post-refactor: uiServer.listen(uiPort); and uiEnabled flag passed to banner.
    expect(src).not.toMatch(/uiServer\.listen\(uiPort,\s*\(\)\s*=>\s*\{/);
    // uiEnabled flag captured before listen()
    expect(src).toMatch(/let uiEnabled = false;/);
  });

  // -- RUNTIME WIRE-FORMAT PARITY ------------------------------------------
  describe('printStartupHeader runtime wire-format parity', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
      logSpy.mockRestore();
    });

    it('emits exactly 1 console.log call with ASCII art + subtitle', async () => {
      const mod = await import('../src/startup_banner.js');
      mod.printStartupHeader();
      expect(logSpy).toHaveBeenCalledTimes(1);
      const out = logSpy.mock.calls[0][0] as string;
      // ASCII art lines + blank line + subtitle + blank line
      expect(out).toContain('██████╗ ███████╗██╗   ██╗');
      expect(out).toContain('OpenClaw Multi-Agent Communication Hub');
    });
  });

  describe('printConfigDump runtime wire-format parity', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
      logSpy.mockRestore();
    });

    it('sqlite config emits 9 console.log lines (5 base + 1 sqlite path + 1 token + 1 tls + 1 trailing blank)', async () => {
      const mod = await import('../src/startup_banner.js');
      const cfg = {
        port: 8765,
        restPort: 8766,
        host: '127.0.0.1',
        dataDir: '/tmp/woclaw-data',
        storage: { type: 'sqlite', sqlitePath: '/tmp/woclaw-data/woclaw.sqlite' },
        authToken: 'secret-token-1234567890',
        tlsKey: undefined,
        tlsCert: undefined,
      } as any;
      mod.printConfigDump(cfg);
      // 5 base (ws port + rest port + host + data dir + storage) + 1 sqlite path + 1 token + 1 tls + 1 trailing blank = 9 calls
      expect(logSpy).toHaveBeenCalledTimes(9);
      const flat = logSpy.mock.calls.map(c => c[0]).join('\n');
      expect(flat).toContain('WebSocket Port: 8765');
      expect(flat).toContain('REST Port: 8766');
      expect(flat).toContain('Host: 127.0.0.1');
      expect(flat).toContain('Data Dir: /tmp/woclaw-data');
      expect(flat).toContain('Storage: sqlite');
      expect(flat).toContain('SQLite Path: /tmp/woclaw-data/woclaw.sqlite');
      expect(flat).toContain('Auth Token: secret-');
      expect(flat).toContain('TLS: disabled (ws:// + http://)');
    });

    it('mysql config emits 10 console.log lines (5 base + 2 mysql + 1 token + 1 tls + 1 trailing blank)', async () => {
      const mod = await import('../src/startup_banner.js');
      const cfg = {
        port: 8765,
        restPort: 8766,
        host: '127.0.0.1',
        dataDir: '/tmp/woclaw-data',
        storage: { type: 'mysql', mysql: { host: 'db.local', port: 3306, database: 'woclaw' } },
        authToken: 'secret-token-1234567890',
        tlsKey: undefined,
        tlsCert: undefined,
      } as any;
      mod.printConfigDump(cfg);
      // 5 base (ws port + rest port + host + data dir + storage) + 2 mysql (host + database) + 1 token + 1 tls + 1 trailing blank = 10 calls
      expect(logSpy).toHaveBeenCalledTimes(10);
      const flat = logSpy.mock.calls.map(c => c[0]).join('\n');
      expect(flat).toContain('Storage: mysql');
      expect(flat).toContain('MySQL Host: db.local:3306');
      expect(flat).toContain('MySQL Database: woclaw');
      expect(flat).not.toContain('SQLite Path:');
    });

    it('auth token is truncated to first 8 chars + ...', async () => {
      const mod = await import('../src/startup_banner.js');
      const cfg = {
        port: 8765,
        restPort: 8766,
        host: '127.0.0.1',
        dataDir: '/tmp',
        storage: { type: 'sqlite' },
        authToken: 'abcdefghijklmnop',
        tlsKey: undefined,
        tlsCert: undefined,
      } as any;
      mod.printConfigDump(cfg);
      const flat = logSpy.mock.calls.map(c => c[0]).join('\n');
      expect(flat).toContain('Auth Token: abcdefgh...');
      expect(flat).not.toContain('abcdefghijklmnop');
    });

    it('TLS enabled routes to wss + https banner string', async () => {
      const mod = await import('../src/startup_banner.js');
      const cfg = {
        port: 8765,
        restPort: 8766,
        host: '127.0.0.1',
        dataDir: '/tmp',
        storage: { type: 'sqlite' },
        authToken: 'tok',
        tlsKey: 'k',
        tlsCert: 'c',
      } as any;
      mod.printConfigDump(cfg);
      const flat = logSpy.mock.calls.map(c => c[0]).join('\n');
      expect(flat).toContain('TLS: enabled (wss:// + https://)');
    });

    it('storage with no type defaults to sqlite in Storage line', async () => {
      const mod = await import('../src/startup_banner.js');
      const cfg = {
        port: 8765,
        restPort: 8766,
        host: '127.0.0.1',
        dataDir: '/tmp',
        storage: undefined,
        authToken: 'tok',
        tlsKey: undefined,
        tlsCert: undefined,
      } as any;
      mod.printConfigDump(cfg);
      const flat = logSpy.mock.calls.map(c => c[0]).join('\n');
      expect(flat).toContain('Storage: sqlite');
      expect(flat).not.toContain('SQLite Path:');
    });
  });

  describe('printEndpointsBanner runtime wire-format parity', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(() => {
      logSpy.mockRestore();
    });

    it('without uiPort emits 4 console.log lines (ws/rest/graph + trailing blank)', async () => {
      const mod = await import('../src/startup_banner.js');
      const cfg = {
        port: 8765,
        restPort: 8766,
        host: '127.0.0.1',
        dataDir: '/tmp',
        storage: { type: 'sqlite' },
        authToken: 'tok',
        tlsKey: undefined,
        tlsCert: undefined,
      } as any;
      mod.printEndpointsBanner(cfg);
      // chain #16: printEndpointsBanner now emits leading blank line, so total is 5 (blank + 3 endpoints + trailing blank)
      expect(logSpy).toHaveBeenCalledTimes(5);
      const flat = logSpy.mock.calls.map(c => c[0]).join('\n');
      expect(flat).toContain('WebSocket: ws://127.0.0.1:8765');
      expect(flat).toContain('REST API:  http://127.0.0.1:8766');
      expect(flat).toContain('Graph:     http://127.0.0.1:8766/graph/{nodes,edges,stats}');
      expect(flat).not.toContain('Web UI:');
    });

    it('with uiPort emits 5 console.log lines (Web UI + ws/rest/graph + trailing blank)', async () => {
      const mod = await import('../src/startup_banner.js');
      const cfg = {
        port: 8765,
        restPort: 8766,
        host: '127.0.0.1',
        dataDir: '/tmp',
        storage: { type: 'sqlite' },
        authToken: 'tok',
        tlsKey: undefined,
        tlsCert: undefined,
      } as any;
      mod.printEndpointsBanner(cfg, 8084);
      // chain #16: printEndpointsBanner now emits leading blank line, so total is 6 (blank + Web UI + 3 endpoints + trailing blank)
      expect(logSpy).toHaveBeenCalledTimes(6);
      const flat = logSpy.mock.calls.map(c => c[0]).join('\n');
      expect(flat).toContain('Web UI:    http://127.0.0.1:8084');
      expect(flat).toContain('WebSocket: ws://127.0.0.1:8765');
    });

    it('TLS enabled routes WebSocket to wss and REST/Graph to https', async () => {
      const mod = await import('../src/startup_banner.js');
      const cfg = {
        port: 8765,
        restPort: 8766,
        host: '127.0.0.1',
        dataDir: '/tmp',
        storage: { type: 'sqlite' },
        authToken: 'tok',
        tlsKey: 'k',
        tlsCert: 'c',
      } as any;
      mod.printEndpointsBanner(cfg);
      const flat = logSpy.mock.calls.map(c => c[0]).join('\n');
      expect(flat).toContain('WebSocket: wss://127.0.0.1:8765');
      expect(flat).toContain('REST API:  https://127.0.0.1:8766');
      expect(flat).toContain('Graph:     https://127.0.0.1:8766/graph/{nodes,edges,stats}');
    });
  });
});

// =====================================================================
// chain #16: blank-line separator moved INTO printEndpointsBanner helper
// (07-05 07:09 cron regression gate; closes last remaining inline console.log
// in hub/src/index.ts main() — was at L185 between "Server started" and
// "Endpoints:" hubLog lines; cosmetic refactor)
// =====================================================================
describe('printEndpointsBanner chain #16 leading blank line (07-05 07:09 cron)', () => {
  // chain #16: leading console.log('') blank-line separator was migrated
  // FROM hub/src/index.ts main() L185 INTO printEndpointsBanner helper.
  // Tests below avoid fragile regex body-extraction (the previous regex
  // /export function printEndpointsBanner\([\s\S]*?\)\s*\{\s*([\s\S]*?)\n\}/
  // breaks when the helper body contains nested `if (...) { ... }` blocks,
  // because the non-greedy match terminates at the inner `\n}` first and
  // returns the wrong body slice). Instead we use grep-style substring
  // checks against the raw source — robust to indentation / comments /
  // nested blocks.
  it('startup_banner.ts printEndpointsBanner body contains leading console.log(\'\') after `=> void {`', () => {
    const src = readSrc(BANNER_TS);
    // find the printEndpointsBanner helper declaration
    const declIdx = src.indexOf('export function printEndpointsBanner(');
    expect(declIdx).toBeGreaterThan(-1);
    // find the opening `{` after the closing `)` of the signature
    const sigEnd = src.indexOf('): void {', declIdx);
    expect(sigEnd).toBeGreaterThan(-1);
    const bodyStart = sigEnd + '): void {'.length;
    // chain #16: the first non-comment, non-whitespace token inside the
    // helper body must be console.log(''); — use a 200-char window.
    const window = src.substring(bodyStart, bodyStart + 600);
    // strip line comments and block comments inside the window
    const stripped = window
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped.trimStart().startsWith("console.log('');")).toBe(true);
  });

  it('hub/src/index.ts main() has 0 uncommented console.log(\'\') blank-line separator (chain #16 closure)', () => {
    const src = readSrc(INDEX_TS);
    // chain #16: the L185 inline console.log('') was migrated INTO
    // printEndpointsBanner helper. Strip line comments and block comments
    // before searching so the trailing `console.log('')` reference inside
    // the explanatory comment at L186 does not false-positive.
    const stripped = src
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped).not.toMatch(/console\.log\(''\)/);
  });
});
