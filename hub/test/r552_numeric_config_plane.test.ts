/**
 * R552 — THE NUMERIC-CONFIG PLANE: a number in the operator's config file is
 * never type-checked, and Node's `server.listen()` has a SECOND overload.
 *
 * ── The question ──────────────────────────────────────────────────────────
 *
 * R551 asked the same shape in `llm-benchmark`: "the operator set this — does
 * it change anything?" This round asks the same shape in `woclaw`, but about
 * the OTHER end of the knob: not "is it read" but "**what happens when the
 * operator hands it the wrong TYPE**".
 *
 * `hub/src/types.ts` declares `port: number` and `restPort: number`. The
 * config file (`CONFIG_FILE`) is merged over the env-derived defaults with a
 * bare spread (`hub/src/config_file.ts`: `return { ...base, ...fileConfig };`)
 * — no schema, no type check. R512 already measured the SILENT half of that
 * (a MISSPELLED key is accepted and ignored). R487 measured the LOUD half
 * (a wrong TYPE at top level for `authToken` crashes the banner).
 *
 * Neither of those covers a NUMBER field with a STRING value. And that is
 * the field where the hub does something surprising, because Node's
 * `server.listen(port, host)` has TWO overloads:
 *
 *     listen(port: number, host, cb)   -> TCP
 *     listen(path: string,  cb)        -> UNIX domain socket
 *
 * A string that is not a valid port takes the SECOND overload. Measured on
 * this tree (2026-11-21 01:0x CST), booting the REAL entrypoint with
 * `CONFIG_FILE={"port":"http"}`:
 *
 *     [WoClaw] WebSocket server running on ws://0.0.0.0:http
 *     [WoClaw] Server started successfully
 *     $ ls -la hub/http
 *     srwxr-xr-x 1 root root 0 ... http          <- a UNIX SOCKET in the CWD
 *
 * The hub reports SUCCESS. The operator believes they set a port. The WS
 * listener is a socket file on disk, unreachable from any network, and the
 * REST server still bound its own port — so the hub is "half up".
 *
 * ── The asymmetry that makes it a finding, not a curiosity ────────────────
 *
 * The SAME knob class, on the ENV path, is strictly validated. R514's
 * `resolveWebUiPort` (hub/src/web_ui_port.ts) is a pure function that:
 *
 *   - rejects a non-decimal string with `/^\d+$/`,
 *   - rejects out-of-range values,
 *   - and returns `{ port: DEFAULT_WEB_UI_PORT, invalid: true }` so the
 *     caller WARNS — "a silently-substituted port is the same class of
 *     defect as an unread knob".
 *
 * And `parseEnvInt` (hub/src/env_helpers.ts) does `parseInt(value, 10)`,
 * so `PORT="19380abc"` on the ENV path becomes `19380` — a working TCP port,
 * with the garbage suffix dropped.
 *
 * Measured, same tree, same round:
 *
 *   | where the typo is             | result                                   |
 *   |-------------------------------|------------------------------------------|
 *   | ENV `PORT="19380abc"`         | TCP on 19380  (garbage dropped)          |
 *   | CONFIG_FILE `port:"19360abc"` | UNIX SOCKET file `19360abc` in the CWD    |
 *
 * ⇒ The config file is a **weaker** input channel than the environment,
 *   for the same knob. That inversion is the finding.
 *
 * ── What is pinned here ───────────────────────────────────────────────────
 *
 * This is a DISCLOSURE suite (defect-presence gate): green today, RED when
 * a type-check lands. It is NOT a regression gate, and it does not assert
 * what the repair should be — the repair is a product decision
 * (father-gated: reject? coerce? warn?).
 *
 * Every arm carries an explicit ROLE, because the mutation matrix reads
 * roles to decide what a flip MEANS:
 *
 *   DEFECT-PIN     a type-check repair SHOULD flip it RED
 *   CONTROL        a repair MUST NOT flip it      (a stable fact)
 *   DISCRIMINATOR  separates a full repair from a partial one
 *   NO-REPAIR-YET  measures "the repair has not landed"
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfigFile } from '../src/config_file.js';
import { buildDefaultConfig } from '../src/default_config.js';
import { resolveWebUiPort } from '../src/web_ui_port.js';
import { parseEnvInt } from '../src/env_helpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HUB = join(HERE, '..');
const TSCX = join(HUB, 'node_modules', '.bin', 'tsx');

const CONFIG_DIR = mkdtempSync(join(tmpdir(), 'r552-cfg-'));

/** Write a config file and return its path. */
function cfgFile(obj: unknown): string {
  const p = join(CONFIG_DIR, `c${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

/** Merge a config file over the env-derived defaults — the REAL loader. */
function loadConfig(obj: unknown) {
  return loadConfigFile(cfgFile(obj), buildDefaultConfig());
}

interface BootResult {
  output: string;
  ready: boolean;
}

let portSeq = 0;

/**
 * Boot the REAL hub entrypoint with CONFIG_FILE pointed at `cfgObj`, and
 * resolve as soon as the hub reaches its "Server started successfully" line
 * (or the deadline passes).
 *
 * Two things this harness has to get right, both learned the hard way:
 *
 *   1. READINESS IS POLLED, NOT SLEPT. A fixed sleep is either too short
 *      (the arm sees an empty output and fails for the wrong reason) or too
 *      long (the suite pays 9 s per arm). Polling for the banner makes each
 *      arm cost only what the hub actually takes to boot.
 *   2. THE PROCESS GROUP IS KILLED, NOT THE CHILD. tsx forks; killing only
 *      the spawned child orphans the listener, which then holds its port for
 *      every later arm (and leaves a socket file in the CWD). `detached` +
 *      `kill(-pid)` takes out the whole group. Same trap r487 documents.
 */
function boot(
  cfgObj: unknown,
  envOverrides: Record<string, string> = {},
  deadlineMs = 45000,
  onReady?: () => void,
): Promise<BootResult> {
  const cfg = cfgFile(cfgObj);
  const dataDir = mkdtempSync(join(tmpdir(), 'r552-boot-'));
  const port = 21000 + (portSeq++ % 900) * 2;
  const restPort = port + 1;
  const child = spawn(TSCX, ['src/index.ts'], {
    cwd: HUB,
    env: {
      ...process.env,
      CONFIG_FILE: cfg,
      DATA_DIR: dataDir,
      SQLITE_PATH: join(dataDir, 'boot.sqlite'),
      PORT: String(port),
      REST_PORT: String(restPort),
      WEB_UI_PORT: String(port + 5),
      AUTH_TOKEN: 'r552-env-token-abcdefghij',
      ...envOverrides,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let output = '';
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { output += d; });
  const killTree = () => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* gone */ } };
  return new Promise((resolve) => {
    const deadline = setTimeout(() => {
      killTree();
      resolve({ output, ready: false });
    }, deadlineMs);
    const poll = setInterval(() => {
      if (/Server started successfully/.test(output)) {
        clearInterval(poll);
        clearTimeout(deadline);
        // The socket file must be observed WHILE THE PROCESS IS ALIVE: a
        // UNIX domain socket is unlinked by the kernel when its last fd
        // closes, so killing the hub removes the very artefact this suite
        // is about. (Measured: killing the group left NO socket behind,
        // while the same boot observed before the kill DID leave one.)
        // The callback therefore samples the CWD here, before killTree().
        setTimeout(() => {
          try { onReady?.(); } catch { /* ignore */ }
          killTree();
          resolve({ output, ready: true });
        }, 250);
      }
    }, 100);
    child.on('close', () => {
      clearInterval(poll);
      clearTimeout(deadline);
      resolve({ output, ready: /Server started successfully/.test(output) });
    });
  });
}

/**
 * Boot with a config file and report which UNIX socket files appeared in the
 * hub CWD. A socket file is the fingerprint of the `listen(path)` overload.
 */
async function bootAndDetectSockets(
  cfgObj: unknown,
  envOverrides: Record<string, string> = {},
): Promise<{ result: BootResult; sockets: string[] }> {
  const before = new Set(readdirSync(HUB));
  let sockets: string[] = [];
  const result = await boot(cfgObj, envOverrides, 45000, () => {
    // Sample the CWD while the hub is still alive — see the note in boot().
    // The socket file can land a beat AFTER the banner, so poll for it
    // rather than sampling once (a single sample is a race, and a race that
    // flips between runs is exactly the "跨轮会动的判定" the house rules
    // forbid).
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const created = readdirSync(HUB).filter(f => !before.has(f));
      const found = created.filter(f => {
        try { return statSync(join(HUB, f)).isSocket(); } catch { return false; }
      });
      if (found.length > 0) { sockets = found; break; }
      // Busy-wait briefly (synchronous, so the child keeps running).
      const until = Date.now() + 50;
      while (Date.now() < until) { /* spin */ }
    }
    if (process.env.R552_DEBUG) {
      console.log('[r552 dbg] sockets=', JSON.stringify(sockets));
    }
  });
  // A socket file left in the CWD would poison the next arm. (Normally the
  // kernel already unlinked it when the process died; this is the belt.)
  for (const s of sockets) { try { rmSync(join(HUB, s), { force: true }); } catch { /* ignore */ } }
  return { result, sockets };
}

describe('R552 — the numeric-config plane: an unvalidated number becomes a UNIX socket', () => {

  // ── P1: the loader's shape (the loader is the REAL one) ───────────────
  describe('P1: the merge is a bare spread — a string survives into a number-typed field', () => {

    it('CONTROL: the loader really does merge a file over the defaults', () => {
      const c = loadConfig({ port: 19999 });
      expect(c.port).toBe(19999);
    });

    it('DEFECT-PIN: a STRING in the number-typed `port` field survives the merge unchanged', () => {
      const c = loadConfig({ port: 'http' });
      expect(c.port).toBe('http');
      expect(typeof c.port).toBe('string');
    });

    it('DEFECT-PIN: the same holds for `restPort`', () => {
      const c = loadConfig({ restPort: 'rest' });
      expect(c.restPort).toBe('rest');
      expect(typeof c.restPort).toBe('string');
    });

    it('NO-REPAIR-YET: the loader performs no type check on the numeric fields', () => {
      // The loader is a bare spread; there is no coercion step to observe.
      const c = loadConfig({ port: 123, restPort: 'rest' });
      expect(c.port).toBe(123);
      expect(c.restPort).toBe('rest');
    });
  });

  // ── P2: the transport actually changes (the sharp finding) ─────────────
  describe('P2: a string port selects Node\'s UNIX-socket overload of listen()', () => {

    it('CONTROL: a numeric config port binds a TCP listener and creates no socket file', async () => {
      const { result, sockets } = await bootAndDetectSockets({ port: 21400, restPort: 21401 });
      expect(result.ready).toBe(true);
      expect(result.output).toMatch(/WebSocket server running on ws:\/\/0\.0\.0\.0:21400/);
      expect(sockets).toEqual([]);
    }, 60000);

    it('DEFECT-PIN: a string config port makes the hub create a UNIX SOCKET file and still report success', async () => {
      const { result, sockets } = await bootAndDetectSockets({ port: 'http' });
      // The hub says it started.
      expect(result.output).toMatch(/Server started successfully/);
      // It even prints a URL — with the socket path in the port position.
      expect(result.output).toMatch(/WebSocket server running on ws:\/\/0\.0\.0\.0:http/);
      // And the fingerprint: a socket file in the hub's CWD.
      expect(sockets).toContain('http');
    }, 60000);

    it('DEFECT-PIN: the same shape applies to `restPort`', async () => {
      const { result, sockets } = await bootAndDetectSockets({ restPort: 'rest' });
      expect(result.output).toMatch(/REST API running on http:\/\/0\.0\.0\.0:rest/);
      expect(sockets).toContain('rest');
    }, 60000);

    it('DISCRIMINATOR: a NUMERIC-LOOKING string with a garbage suffix ALSO takes the socket overload', async () => {
      // This is the realistic typo: the operator meant a port and typed a
      // number with a stray suffix. It is NOT caught by a "is it a number?"
      // eyeball check, and it is NOT caught by parseInt-style coercion.
      const { result, sockets } = await bootAndDetectSockets({ port: '21410abc' });
      expect(result.output).toMatch(/WebSocket server running on ws:\/\/0\.0\.0\.0:21410abc/);
      expect(sockets).toContain('21410abc');
    }, 60000);
  });

  // ── P3: the asymmetry — the ENV path IS validated (the finding's spine) ─
  describe('P3: the SAME knob class is strictly validated on the ENV path', () => {

    it('CONTROL: the env path coerces a numeric-with-suffix to a working port', () => {
      // parseEnvInt does parseInt(value, 10) -> the suffix is dropped.
      expect(parseEnvInt('PORT', { default: 8080 })).toBe(8080);
      process.env.R552_ENV_PORT = '21420abc';
      expect(parseEnvInt('R552_ENV_PORT', { default: 8080 })).toBe(21420);
      delete process.env.R552_ENV_PORT;
    });

    it('CONTROL: booting with the SAME typo on the ENV path binds TCP and creates NO socket', async () => {
      const { result, sockets } = await bootAndDetectSockets({}, { PORT: '21430abc' });
      expect(result.output).toMatch(/WebSocket server running on ws:\/\/0\.0\.0\.0:21430/);
      expect(sockets).toEqual([]);
    }, 60000);

    it('DEFECT-PIN: R514\'s resolveWebUiPort rejects the same class of value AND warns', () => {
      // This is the house's own standard for a port knob. The config file
      // does not apply it.
      expect(resolveWebUiPort('21440abc')).toEqual({ port: 8084, invalid: true });
      expect(resolveWebUiPort('21440')).toEqual({ port: 21440, invalid: false });
    });

    it('DISCRIMINATOR: the config file applies NO equivalent validation to the port fields', () => {
      // resolveWebUiPort would reject this value; the config loader accepts it.
      const rejectedByHouseStandard = resolveWebUiPort('21450abc');
      expect(rejectedByHouseStandard.invalid).toBe(true);
      const acceptedByConfigLoader = loadConfig({ port: '21450abc' });
      expect(acceptedByConfigLoader.port).toBe('21450abc');
    });
  });

  // ── P4: what the operator can observe (or cannot) ──────────────────────
  describe('P4: the operator is told nothing', () => {

    it('DEFECT-PIN: the startup banner prints the string verbatim as a "Port"', async () => {
      const { result } = await bootAndDetectSockets({ port: '21460xyz' });
      expect(result.output).toMatch(/WebSocket Port: 21460xyz/);
      // It does NOT say "invalid" or "socket" anywhere.
      expect(result.output).not.toMatch(/invalid.*port/i);
    }, 60000);

    it('NO-REPAIR-YET: no diagnostic line mentions the bad port value', async () => {
      const { result } = await bootAndDetectSockets({ port: '21470xyz' });
      // The predicate is "no line that looks like a DIAGNOSTIC mentions the
      // offending value", not "the string 'not a valid port' is absent". The
      // narrower predicate would let ANY differently-worded warning through
      // — and a warn-only repair is exactly such a repair (M3 in the
      // mutation matrix). Asserting the absence of the CONCEPT is what
      // makes a warn-only repair detectable; asserting the absence of one
      // phrase is what lets it slip through.
      const diagnostics = result.output
        .split('\n')
        .filter(l => /warn|invalid|not a number|error|must be|cannot|could not/i.test(l))
        .filter(l => l.includes('21470xyz'));
      expect(diagnostics).toEqual([]);
      // And specifically the ENV-path warning shape is absent.
      expect(result.output).not.toMatch(/not a valid port/);
    }, 60000);

    it('CONTROL: the hub still binds its REST port normally — the failure is HALF-SHUT', async () => {
      const { result } = await bootAndDetectSockets({ port: '21480xyz', restPort: 21481 });
      expect(result.output).toMatch(/REST API running on http:\/\/0\.0\.0\.0:21481/);
    }, 60000);
  });
});

afterAll(() => {
  // Belt and braces: no socket file may survive this suite.
  for (const f of readdirSync(HUB)) {
    let isSock = false;
    try { isSock = statSync(join(HUB, f)).isSocket(); } catch { /* ignore */ }
    if (isSock) { try { rmSync(join(HUB, f), { force: true }); } catch { /* ignore */ } }
  }
});
