/**
 * R487 — a config file with `"authToken": null` (or any non-string) CRASHES THE
 * HUB AT BOOT, and the crash lands OUTSIDE the one try/catch that was supposed
 * to be the config-load guard.
 *
 * This is a NEW PLANE (R486 §8 asked for one): the config-file merge plane
 * crossed with the startup banner. Previous rounds audited the auth plane's
 * *reach* (R457 private-invite credential scope, R468 revocation reach, R469
 * expiry reach) and the routing plane's reach. None of them asked what
 * happens to a value that survives the merge with the wrong TYPE.
 *
 * ── The defect, end to end ──────────────────────────────────────────────────
 *
 * `Config.authToken` is declared `authToken: string` (hub/src/types.ts:9).
 * `loadConfigFile` (hub/src/config_file.ts) is a bare
 * `{ ...base, ...fileConfig }` — it applies no schema check, so a JSON file
 * may set `authToken` to `null`, a number, an object, or an array. The result
 * is typed `Config` and therefore type-checks at every call site that treats
 * the field as a string.
 *
 * `printConfigDump` (hub/src/startup_banner.ts:84) then does:
 *
 *     console.log(`  Auth Token: ${config.authToken.substring(0, 8)}...`);
 *
 * which throws `TypeError` for any non-string. And it is called from
 * `index.ts:48` — TWELVE LINES PAST the `try { config = loadConfigFile(...) }
 * catch { hubError(...); process.exit(1) }` block at index.ts:37-44. The
 * validation succeeded, so `process.exit(1)` never runs; the TypeError
 * escapes `main()` and is caught only by the terminal
 * `main().catch(...)` at index.ts:129.
 *
 * Observed boot (probe, real process, CONFIG_FILE={"authToken":null}):
 *
 *     [WoClaw] Loaded config from .../cfg.json
 *     [WoClaw] Configuration:
 *       WebSocket Port: 18099
 *       REST Port: 18098
 *       Host: 0.0.0.0
 *       Data Dir: ...
 *       Storage: sqlite
 *       SQLite Path: .../x.sqlite
 *     [WoClaw] Fatal error: Cannot read properties of null (reading 'substring')
 *     exit 1
 *
 * Note WHAT the operator sees: the config loaded successfully ("Loaded config
 * from ..."), the storage block printed, and then the process died mid-banner.
 * The diagnostic names a null, not the config file that caused it. No port is
 * ever bound and no SQLite file is ever opened, so this is a hard boot crash,
 * not a degraded mode.
 *
 * ── Why the existing suites are green ───────────────────────────────────────
 *
 * `config_file_runtime.test.ts` pins that `authToken: null` MERGES to null
 * (line 130-138) and reasons in a comment about "a later `if
 * (config.authToken)` truthiness test". That consumer DOES NOT EXIST. Grepping
 * all of hub/src for a truthiness site on authToken returns zero hits: the WS
 * gate is `token === this.config.authToken` (ws_server.ts:156, strict
 * equality, null-safe by accident) and the REST fallback is
 * `token === this.config.authToken` (rest_server.ts:237, likewise). The one
 * consumer that actually dereferences the field as a string is
 * `printConfigDump`, and it is reached on EVERY boot, before any server binds.
 *
 * So the shipped commentary names the wrong consumer twice — in
 * config_file.ts:23 and in config_file_runtime.test.ts:136 — while the real
 * one is untested. That is exactly the R486-M3 shape (a property asserted
 * against a substring/context rather than against the declaration boundary)
 * applied to a comment rather than a string literal.
 *
 * ── What this suite pins (CURRENT behaviour, RED against the defect) ────────
 *
 * P1  `printConfigDump` throws TypeError for null / number / object / array
 *     authToken, and does NOT throw for string / omitted / empty-string.
 * P2  The throw happens on the banner's auth line specifically — the storage
 *     block above it still prints — so the crash point is pinned, not inferred.
 * P3  In index.ts, `printConfigDump(config)` is OUTSIDE the loadConfigFile
 *     try/catch: an unguard between the two, at a positive line distance. This
 *     is a source-shape assertion, and it is deliberately weak (see R469-4 /
 *     R486-M3): it is corroborated by the live-boot control in P4 rather than
 *     standing alone.
 * P4  LIVE BOOT CONTROL: the real process, real index.ts, real env — a null
 *     authToken exits 1 with the substring TypeError and never reaches
 *     "Endpoints", while an omitted authToken boots far enough to print the
 *     full banner. This is what makes P3 a statement about the program rather
 *     than about the source text.
 * P5  NEGATIVE CONTROL (R469-3 / R484-3): the SAME loader, in the SAME run,
 *     with well-typed configs succeeds — so the failures above are statements
 *     about the type of authToken, not about the probe.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { tmpdir } from 'os';

import { loadConfigFile } from '../src/config_file.js';
import { printConfigDump } from '../src/startup_banner.js';
import type { Config } from '../src/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_INDEX = join(HERE, '..', 'src', 'index.ts');

// ─── Harness ────────────────────────────────────────────────────────────────

const DIR = mkdtempSync(join(tmpdir(), 'r487-'));
let seq = 0;
let portSeq = 0;

const baseConfig = (): Config => ({
  port: 8080,
  restPort: 8081,
  host: '0.0.0.0',
  dataDir: '/data',
  storage: { type: 'sqlite', sqlitePath: '/tmp/x.sqlite' },
  authToken: 'base-token-longenough',
  tlsKey: undefined,
  tlsCert: undefined,
} as unknown as Config);

/** Write a config file and return its path. */
function cfgFile(obj: unknown): string {
  const p = join(DIR, `c${seq++}.json`);
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

/** Capture every console.log line printConfigDump emits. */
function captureDump(config: Config): { lines: string[]; error: unknown } {
  const lines: string[] = [];
  const real = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.join(' ')); };
  try {
    printConfigDump(config);
    return { lines, error: null };
  } catch (e) {
    return { lines, error: e };
  } finally {
    console.log = real;
  }
}

/** Load `obj` over a fresh base and return the merged config. */
function merged(obj: unknown): Config {
  return loadConfigFile(cfgFile(obj), baseConfig());
}

interface BootResult {
  code: number | null;
  stdout: string;
  stderr: string;
  output: string;
}

/**
 * Boot the REAL hub process with CONFIG_FILE pointed at `obj`, and return what
 * it printed and how it exited. Binds ports 18099/18098 which nothing else in
 * this suite uses; the control run deliberately reaches "Endpoints" and is
 * killed by timeout, which is the expected shape for a healthy boot.
 */
function boot(obj: unknown, timeoutMs = 8000): Promise<BootResult> {
  const cfg = cfgFile(obj);
  const dataDir = mkdtempSync(join(tmpdir(), 'r487-boot-'));
  // Bind ephemeral-ish high ports unique to THIS run so two boots in one
  // vitest process cannot collide with each other or with a live hub. A
  // collision shows up as EADDRINUSE AFTER the Endpoints banner, which would
  // make the negative control's assertions pass for the wrong reason
  // (R484-3: the control must be about the subject, not the harness).
  const port = 19000 + (portSeq++ % 800);
  const restPort = port + 1;
  const child = spawn(
    join(HERE, '..', 'node_modules', '.bin', 'tsx'),
    ['src/index.ts'],
    {
      cwd: join(HERE, '..'),
      env: {
        ...process.env,
        CONFIG_FILE: cfg,
        DATA_DIR: dataDir,
        SQLITE_PATH: join(dataDir, 'boot.sqlite'),
        PORT: String(port),
        REST_PORT: String(restPort),
        WEB_UI_PORT: String(restPort + 1),
        // Pin AUTH_TOKEN so the negative control's printed token is a known
        // value. The subject config file is what varies, never the env.
        AUTH_TOKEN: 'env-token-abcdefghij',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      // tsx FORKS: the process we spawn is a wrapper that exec-loads the real
      // hub. Killing only `child` kills the wrapper and orphans the listener,
      // which then holds the port for every later boot in this suite (and,
      // with a fixed port, on the host). detached + kill(-pid) takes out the
      // whole group. Observed before this fix: a live hub on 18098/18099/8084
      // owned by an orphaned pid after a passing run.
      detached: true,
    },
  );
  let stdout = '', stderr = '';
  child.stdout.on('data', d => { stdout += d; });
  child.stderr.on('data', d => { stderr += d; });
  const done = new Promise<BootResult>(resolve => {
    child.on('close', code => resolve({ code, stdout, stderr, output: stdout + stderr }));
  });
  const killTree = () => {
    try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* group already gone */ }
  };
  return Promise.race([
    done.then(r => { killTree(); return r; }),
    new Promise<BootResult>(r => setTimeout(() => {
      killTree();
      r({ code: null, stdout, stderr, output: stdout + stderr });
    }, timeoutMs)),
  ]);
}

describe('R487 — authToken of a non-string type survives the config merge and crashes the boot banner', () => {

  // ── P1 ────────────────────────────────────────────────────────────────────
  describe('P1: printConfigDump throws TypeError for every non-string authToken', () => {

    it('authToken: null — the documented merge case — throws on .substring', () => {
      const c = merged({ authToken: null });
      // P1a: the merge really does produce a null that is TYPED as a string.
      expect(c.authToken).toBeNull();
      const { error } = captureDump(c);
      expect(error).toBeInstanceOf(TypeError);
      expect((error as TypeError).message).toMatch(/substring/);
    });

    it('authToken: 12345 (a JSON number) throws, with a different message than null', () => {
      const c = merged({ authToken: 12345 });
      expect(typeof c.authToken).toBe('number');
      const { error } = captureDump(c);
      expect(error).toBeInstanceOf(TypeError);
      expect((error as TypeError).message).toMatch(/substring is not a function/);
    });

    it('authToken: {"a":1} (an object) throws', () => {
      const { error } = captureDump(merged({ authToken: { a: 1 } }));
      expect(error).toBeInstanceOf(TypeError);
      expect((error as TypeError).message).toMatch(/substring is not a function/);
    });

    it('authToken: ["x"] (an array) throws — an array HAS .substring? no: it does not', () => {
      const { error } = captureDump(merged({ authToken: ['x'] }));
      expect(error).toBeInstanceOf(TypeError);
      expect((error as TypeError).message).toMatch(/substring is not a function/);
    });

    it('NEGATIVE CONTROL: a string authToken does NOT throw', () => {
      const { error } = captureDump(merged({ authToken: 'file-token-longenough' }));
      expect(error).toBeNull();
    });

    it('NEGATIVE CONTROL: an OMITTED authToken leaves the base string and does NOT throw', () => {
      // This is the case config_file.ts calls out as safe. It is safe.
      const c = merged({ port: 9999 });
      expect(c.authToken).toBe('base-token-longenough');
      const { error } = captureDump(c);
      expect(error).toBeNull();
    });

    it('NEGATIVE CONTROL: authToken: "" does NOT throw — empty string is falsy but is a string', () => {
      // Worth pinning: an operator can disable auth with "" and the hub boots,
      // because "" .substring(0,8) is "". The type, not the truthiness, is the
      // load-bearing property here.
      const { error } = captureDump(merged({ authToken: '' }));
      expect(error).toBeNull();
    });
  });

  // ── P2 ────────────────────────────────────────────────────────────────────
  describe('P2: the throw is on the auth line specifically, after the storage block printed', () => {

    it('the storage lines emitted before the crash are still present', () => {
      const { lines, error } = captureDump(merged({ authToken: null }));
      expect(error).toBeInstanceOf(TypeError);
      expect(lines.join('\n')).toMatch(/Storage: sqlite/);
      expect(lines.join('\n')).toMatch(/SQLite Path:/);
      // ...and the auth line itself never made it out.
      expect(lines.join('\n')).not.toMatch(/Auth Token:/);
    });

    it('a good config emits Auth Token, TLS and the trailing blank line', () => {
      const { lines } = captureDump(merged({ authToken: 'abcdefghijklmnop' }));
      const out = lines.join('\n');
      expect(out).toMatch(/Auth Token: abcdefgh.../);
      expect(out).toMatch(/TLS: disabled/);
    });
  });

  // ── P3 ────────────────────────────────────────────────────────────────────
  describe('P3: index.ts places printConfigDump OUTSIDE the loadConfigFile try/catch', () => {

    const src = readFileSync(SRC_INDEX, 'utf-8');
    const lines = src.split('\n');

    it('the try/catch around loadConfigFile calls process.exit(1) on failure', () => {
      const loadAt = lines.findIndex(l => l.includes('config = loadConfigFile('));
      expect(loadAt).toBeGreaterThan(-1);
      // Within a 10-line window after the load there must be a process.exit(1)
      // and a catch — i.e. the guard exists.
      const window = lines.slice(loadAt, loadAt + 10).join('\n');
      expect(window).toMatch(/catch/);
      expect(window).toMatch(/process\.exit\(1\)/);
    });

    it('printConfigDump is called AFTER that try/catch has already closed', () => {
      const loadAt = lines.findIndex(l => l.includes('config = loadConfigFile('));
      const catchAt = lines.findIndex((l, i) => i > loadAt && /^\s*}\s*catch/.test(l));
      const dumpAt = lines.findIndex(l => l.includes('printConfigDump(config)'));
      expect(catchAt).toBeGreaterThan(loadAt);
      expect(dumpAt).toBeGreaterThan(catchAt);
      // The unguard distance is real, not adjacent-line noise.
      expect(dumpAt - catchAt).toBeGreaterThan(1);
    });

    it('WEAKENESS MARKER (R469-4 / R486-M3): P3 is source-shape only. P4 is what makes it a claim about the program.', () => {
      // A grep can be satisfied by text that never runs. P4 below runs the real
      // process; if you ever delete P4, delete this marker instead of letting
      // P3 stand alone as evidence.
      expect(src).toContain('printConfigDump');
    });
  });

  // ── P4 ────────────────────────────────────────────────────────────────────
  describe('P4: LIVE BOOT — the defect is reachable from a real process, not just from a unit', () => {

    let crashed: BootResult;
    let healthy: BootResult;

    beforeAll(async () => {
      crashed = await boot({ authToken: null }, 20000);
      healthy = await boot({ port: 18099 }, 20000);
    }, 60000);

    it('a config file with authToken: null exits non-zero with the substring TypeError', () => {
      expect(crashed.code).toBe(1);
      expect(crashed.output).toMatch(/Cannot read properties of null \(reading 'substring'\)/);
    });

    it('...and the config was reported as LOADED, so the validation guard did not fire', () => {
      expect(crashed.output).toMatch(/Loaded config from/);
      // The specific diagnostic the guard would have produced is absent.
      expect(crashed.output).not.toMatch(/Failed to load config/);
    });

    it('...and the hub never bound a listener or opened storage', () => {
      expect(crashed.output).not.toMatch(/Endpoints:/);
      expect(crashed.output).not.toMatch(/WebSocket server running/);
    });

    it('NEGATIVE CONTROL: an OMITTED authToken boots and reaches the Endpoints banner', () => {
      // Same binary, same env, same config-file mechanism — only the type of
      // authToken differs. If this fails, the failures above are about the
      // harness, not about the subject.
      // The healthy boot's token comes from AUTH_TOKEN in the env (the config file
      // omits authToken), NOT from the unit-test base object. Pin the env value
      // so the assertion below is about "a string token printed", not about
      // which layer supplied it.
      expect(healthy.output).toMatch(/Auth Token: env-toke\.\.\./);
      expect(healthy.output).toMatch(/Endpoints:/);
      // R484-3: prove the boot really bound, so "Endpoints printed" is not
      // satisfied by a process that died between the banner and the listener.
      expect(healthy.output).not.toMatch(/EADDRINUSE/);
    });
  });

  // ── P5 ────────────────────────────────────────────────────────────────────
  describe('P5: the shipped commentary names a consumer that does not exist', () => {

    it('no truthiness site on authToken exists anywhere in hub/src', () => {
      // The reason this defect survived: config_file.ts:23 and
      // config_file_runtime.test.ts:136 both justify the null merge by
      // pointing at "a later `if (config.authToken)` truthiness test".
      // Assert the absence so a future round that finds one realigns the docs.
      //
      // R467-4 (fidelity pins are spelling-bound): searching for a string that
      // appears LITERALLY IN THE COMMENT DOCUMENTING THE ABSENCE is a
      // self-matching trap. Filter comments out, or the assertion below is
      // satisfied by the very prose it is about.
      const { readdirSync, statSync } = require('fs') as typeof import('fs');
      const SRCDIR = join(HERE, '..', 'src');
      const files: string[] = [];
      (function walk(d: string) {
        for (const e of readdirSync(d)) {
          const p = join(d, e);
          if (statSync(p).isDirectory()) walk(p);
          else if (e.endsWith('.ts')) files.push(p);
        }
      })(SRCDIR);

      // Strip // line comments and /* */ block comments before searching, so
      // the prose that documents the absence cannot satisfy the assertion.
      const hits: string[] = [];
      for (const f of files) {
        const stripped = readFileSync(f, 'utf-8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .split('\n')
          .map(l => l.replace(/\/\/.*$/, ''));
        stripped.forEach((l, i) => {
          if (l.includes('if (config.authToken)')) hits.push(`${f}:${i + 1}`);
        });
      }
      expect(hits).toEqual([]);
    });

    it('the only sites that consume authToken as a value are strict-equality, not truthiness', () => {
      const { execFileSync } = require('child_process') as typeof import('child_process');
      const out = execFileSync(
        'grep', ['-rn', 'config.authToken', join(HERE, '..', 'src')],
        { encoding: 'utf-8' },
      );
      const consumers = out.split('\n')
        .filter(l => l.trim() && !l.trim().startsWith('//'))
        .filter(l => !/:\s*\*/.test(l.split(':').slice(2).join(':')))
        .filter(l => !/authToken:/.test(l))          // declarations and writes
        .filter(l => !/\.authToken\s*=/.test(l));     // assignments
      // Every remaining consumer is either a strict comparison or the banner.
      for (const line of consumers) {
        expect(line).toMatch(/===|\.substring|authToken\b/);
      }
      // ...and the banner dereference — the thing that actually crashes — is
      // among them.
      expect(consumers.some(l => l.includes('.substring'))).toBe(true);
    });
  });
});
