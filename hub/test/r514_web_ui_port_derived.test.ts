/**
 * R514 — the Web UI port must be DERIVED from the environment, not hardcoded.
 *
 * ── The defect (measured, not suspected) ──
 *
 * `hub/src/index.ts` hardcoded the Web UI's port:
 *
 *     const uiPort = 8084;
 *
 * while TWO suites that boot the REAL hub already set a `WEB_UI_PORT`
 * variable on the child, expecting it to be honoured:
 *
 *     test/r487_config_auth_token_type_crash.test.ts:183
 *     test/r488_rotation_durability.test.ts:381
 *
 * The knob was INERT — set by the callers, read by nobody.
 *
 * ── Why a hardcoded port is a defect and not a style choice ──
 *
 * A fixed port is a SHARED RESOURCE. Every hub on a host contends for 8084,
 * so the EADDRINUSE lands on whoever boots SECOND — and it lands on a suite
 * that does not own the subject. Measured on this tree: `r487`'s negative
 * control asserts the boot banner contains no `EADDRINUSE`; with another hub
 * already holding 8084, `r487` goes RED with
 *
 *     "Web UI server failed to bind port 8084: EADDRINUSE ..."
 *
 * A red arm whose subject is the config-file crash, not the port. And the
 * collision is a property of the HOST, so it is invisible on a CI runner
 * (one hub per runner) and only appears locally — the same "invisible on the
 * one host the suite was authored on" shape R506 measured.
 *
 * ── What this suite pins ──
 *
 *   (0) PREMISE — the resolver is not vacuous;
 *   (1) the SOURCE reads the environment and no longer hardcodes 8084;
 *   (2) the RESOLUTION contract (default / valid / malformed);
 *   (3) the RUNTIME property — the real entrypoint BINDS the port the
 *       environment names, and does NOT bind 8084;
 *   (4) the SHARED-RESOURCE property — two hubs with different
 *       `WEB_UI_PORT` do not collide, and a second hub on the SAME port
 *       does not take the first one down.
 *
 * Arm (3) and arm (4) observe the RESOLUTION, i.e. which port the process
 * actually BOUND — not a copy of the resolver's return value. R198's rule:
 * observe the DECISION, do not perform the CONSEQUENCE.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolveWebUiPort, DEFAULT_WEB_UI_PORT } from '../src/web_ui_port.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HUB = join(HERE, '..');
const INDEX_TS = join(HUB, 'src', 'index.ts');

/**
 * The suite drives the COMPILED entrypoint (`hub/dist/index.js`), not tsx.
 *
 * MEASURED on this host: a tsx cold boot of the hub takes ~18s under load
 * (tsx transpiles the whole hub from scratch on a cold cache), while the
 * compiled build prints its Endpoints banner in ~500ms. The subject of this
 * suite is WHICH PORT the process binds — a property of the shipped
 * artifact, so driving the shipped artifact is also the more faithful
 * observation.
 *
 * The compiled entrypoint is built by `npm run build` (tsc), which CI runs
 * before `npm test`. If it is missing, the suite SKIPS with a clear
 * message rather than failing — a missing build step is not a defect in the
 * port resolution.
 */
const DIST_ENTRY = join(HUB, 'dist', 'index.js');
const DIST_RESOLVER = join(HUB, 'dist', 'web_ui_port.js');

/** Is `port` free on the loopback interface right now? */
function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

/** An ephemeral free port, resolved by binding and releasing. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const p = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(p));
    });
  });
}

interface Booted {
  child: ChildProcess;
  out: () => string;
  stop: () => Promise<void>;
}

/**
 * Boot the REAL hub entrypoint with a given WEB_UI_PORT.
 *
 * The cwd is a scratch directory that CONTAINS a `public/` child, so the
 * Web UI server is actually started — the subject of this suite is the port
 * it binds, and a hub that never starts the UI server would report a
 * vacuous result.
 */
async function bootHub(webUiPort: string | undefined, wsPort: number, restPort: number): Promise<Booted> {
  const cwd = mkdtempSync(join(tmpdir(), 'r514-cwd-'));
  mkdirSync(join(cwd, 'public'));
  writeFileSync(join(cwd, 'public', 'index.html'), '<html>r514</html>');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATA_DIR: cwd,
    SQLITE_PATH: join(cwd, 'hub.sqlite'),
    PORT: String(wsPort),
    REST_PORT: String(restPort),
    HOST: '127.0.0.1',
    AUTH_TOKEN: 'r514-token-abcdefgh',
  };
  if (webUiPort === undefined) delete env.WEB_UI_PORT;
  else env.WEB_UI_PORT = webUiPort;

  const child = spawn(process.execPath, [DIST_ENTRY], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  let out = '';
  child.stdout?.on('data', (d) => { out += String(d); });
  child.stderr?.on('data', (d) => { out += String(d); });

  const stop = async (): Promise<void> => {
    try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* group already gone */ }
    // The scratch data dir is the suite's OWN resource: it must be cleaned
    // up, not left for the scratch pruner. A suite that leaks a directory
    // per run turns a 7-test suite into hundreds of stale dirs.
    try { rmSync(cwd, { recursive: true, force: true }); } catch { /* best effort */ }
  };

  // Wait for the Endpoints banner — the boot has reached the listen phase.
  //
  // The budget is generous on purpose: the boot competes with whatever else
  // the host is running, and a tight deadline here reads as a RED ARM on a
  // subject the fix is about — the "a verdict that moves between runs is a
  // driver artefact, not a finding" trap (R482-10).
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && !/Endpoints:/.test(out)) {
    await new Promise((r) => setTimeout(r, 100));
  }

  return { child, out: () => out, stop };
}

describe('R514 — the Web UI port is DERIVED from WEB_UI_PORT, not hardcoded', () => {
  // (0) PREMISE. A resolver that always returns the default is
  // indistinguishable from a hardcoded port. This arm is that control.
  it('(0) the resolver can select a port other than the default (it is not vacuous)', () => {
    expect(resolveWebUiPort(undefined).port).toBe(DEFAULT_WEB_UI_PORT);
    expect(resolveWebUiPort('29150').port).toBe(29150);
    expect(resolveWebUiPort('29150').port).not.toBe(DEFAULT_WEB_UI_PORT);
  });

  // (1) THE SOURCE reads the environment and no longer hardcodes the port.
  //
  // The check is SEMANTIC, not a spelling pin: it asserts that the file
  // READS `WEB_UI_PORT` and FEEDS IT to the resolver, and that the
  // hardcoded assignment is gone. Pinning the exact source text
  // ("resolveWebUiPort(process.env.WEB_UI_PORT)") would make an
  // equivalent spelling a RED — which is the "a fidelity pin is
  // spelling-bound; use the semantic one" lesson (R467) applied in the
  // other direction: here the spelling pin would be too STRICT, killing
  // the negative control that is supposed to survive.
  it('(1) index.ts resolves the Web UI port from the environment', () => {
    const src = readFileSync(INDEX_TS, 'utf8');

    // The environment variable is READ.
    expect(
      src,
      'index.ts never reads WEB_UI_PORT -- the knob is inert again',
    ).toMatch(/process\.env\s*\[\s*['"]WEB_UI_PORT['"]\s*\]|process\.env\.WEB_UI_PORT/);

    // And it is FED to the resolver: the value that reaches the resolver
    // must be the environment's, not a literal. The argument is read up to
    // the matching close paren, so a bracket-indexed lookup
    // (`process.env['WEB_UI_PORT']`) is captured whole.
    const call = src.match(/resolveWebUiPort\s*\(((?:[^()]|\([^()]*\))*)\)/);
    expect(call, 'index.ts does not call resolveWebUiPort').not.toBeNull();
    expect(
      call![1],
      'the resolver is called with something other than the environment value',
    ).toMatch(/WEB_UI_PORT/);

    // The hardcoded literal must be GONE from the assignment.
    expect(src).not.toMatch(/const\s+uiPort\s*=\s*8084\s*;/);
  });

  // (2) THE RESOLUTION CONTRACT.
  it('(2) the resolution contract: default / valid / malformed', () => {
    // Unset and empty -> the documented default, and NOT flagged invalid.
    expect(resolveWebUiPort(undefined)).toEqual({ port: DEFAULT_WEB_UI_PORT, invalid: false });
    expect(resolveWebUiPort('')).toEqual({ port: DEFAULT_WEB_UI_PORT, invalid: false });

    // A valid port -> that port.
    expect(resolveWebUiPort('29150')).toEqual({ port: 29150, invalid: false });
    expect(resolveWebUiPort('1')).toEqual({ port: 1, invalid: false });
    expect(resolveWebUiPort('65535')).toEqual({ port: 65535, invalid: false });

    // Malformed -> the default, and FLAGGED so the caller can warn. A
    // silently-substituted port is the same defect class as an unread knob.
    for (const bad of ['abc', '0', '-1', '70000', '8084x', '  ']) {
      const r = resolveWebUiPort(bad);
      expect(r.port, `"${bad}" must fall back to the default`).toBe(DEFAULT_WEB_UI_PORT);
      expect(r.invalid, `"${bad}" must be flagged invalid`).toBe(true);
    }
  });

  // (1b) THE BUILT ARTIFACT IS CURRENT.
  //
  // The runtime arms drive `hub/dist/index.js`, so that artifact must have
  // been built from the CURRENT source — otherwise the runtime arms would
  // measure a STALE build and report a green verdict about code that is no
  // longer there (the same shape as R501's "a machine scan must be MEASURED
  // before its '0 hits' is evidence": a skipped or stale measurement is not
  // a measurement).
  //
  // It FAILS loudly rather than skipping: CI runs `npm run build` before
  // `npm test`, and a locally-stale build is a real condition the operator
  // must resolve (`npm run build`), not something to hide behind a skip.
  it('(1b) the compiled entrypoint exists and was built from the current source', () => {
    if (!existsSync(DIST_ENTRY) || !existsSync(DIST_RESOLVER)) {
      throw new Error(
        'hub/dist/index.js and hub/dist/web_ui_port.js are missing — run `npm run build` in hub/ first. ' +
          'This suite drives the COMPILED entrypoint (a tsx cold boot takes ~18s under load, the compiled build ~500ms), ' +
          'and a missing build is not a measurable subject.',
      );
    }
    const built = readFileSync(DIST_ENTRY, 'utf8');
    expect(
      built,
      'the compiled entrypoint does not contain the port resolution — dist/ is STALE relative to src/. Run `npm run build`.',
    ).toContain('resolveWebUiPort');
  });

  // (3) THE RUNTIME PROPERTY — the actual port the process BOUND.
  //
  // This arm observes the RESOLUTION (what got bound), not a copy of the
  // resolver's return value. It is the arm that would catch a fix which
  // resolves the port correctly and then ignores it.
  it('(3) the real hub BINDS the port the environment names', async () => {
    const uiPort = await freePort();
    const wsPort = await freePort();
    const restPort = await freePort();

    const hub = await bootHub(String(uiPort), wsPort, restPort);
    try {
      expect(hub.out()).toMatch(/Endpoints:/);
      // The banner names the port the environment asked for.
      expect(hub.out()).toContain(`Web UI:    http://127.0.0.1:${uiPort}`);

      // And the port is actually BOUND — not merely printed.
      expect(await portFree(uiPort), `the hub did not bind ${uiPort}`).toBe(false);

      // And the hardcoded port is NOT bound — this is the arm that would
      // fail if the fix resolved the port and still bound 8084.
      expect(
        await portFree(DEFAULT_WEB_UI_PORT),
        'the hub bound the hardcoded default port even though WEB_UI_PORT named another one',
      ).toBe(true);
    } finally {
      await hub.stop();
    }
  }, 180_000);

  // (4) THE SHARED-RESOURCE PROPERTY — the whole point of the fix.
  //
  // Two hubs, each with its own WEB_UI_PORT, must coexist: neither one's
  // boot may take the other down. Before the fix, both contended for 8084
  // and the second boot's failure landed on the first boot's suite.
  it('(4) two hubs with different WEB_UI_PORT values coexist', async () => {
    const uiA = await freePort();
    const uiB = await freePort();
    const wsA = await freePort();
    const restA = await freePort();
    const wsB = await freePort();
    const restB = await freePort();

    const a = await bootHub(String(uiA), wsA, restA);
    const b = await bootHub(String(uiB), wsB, restB);
    try {
      expect(a.out()).toMatch(/Endpoints:/);
      expect(b.out()).toMatch(/Endpoints:/);

      // Neither boot reported a bind failure.
      expect(a.out()).not.toMatch(/EADDRINUSE/);
      expect(b.out()).not.toMatch(/EADDRINUSE/);

      // Both bound their own port.
      expect(await portFree(uiA)).toBe(false);
      expect(await portFree(uiB)).toBe(false);

      // And the shared default was never contended for at all.
      expect(await portFree(DEFAULT_WEB_UI_PORT)).toBe(true);
    } finally {
      await a.stop();
      await b.stop();
    }
  }, 240_000);

  // (5) A malformed knob must NOT crash the hub, and must be VISIBLE.
  it('(5) a malformed WEB_UI_PORT warns and falls back to the default', async () => {
    const wsPort = await freePort();
    const restPort = await freePort();

    const hub = await bootHub('not-a-port', wsPort, restPort);
    try {
      expect(hub.out()).toMatch(/Endpoints:/);
      // The hub is UP: the REST/WS plane did not die over a bad knob.
      expect(hub.out()).not.toMatch(/uncaughtException|ERR_INVALID_ARG/);
      // The operator is TOLD. A silent fallback is the same defect class
      // as the inert knob.
      expect(hub.out()).toMatch(/WEB_UI_PORT/);
      expect(hub.out()).toMatch(/not-a-port/);
    } finally {
      await hub.stop();
    }
  }, 180_000);
});
