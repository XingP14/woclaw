/**
 * R488 — 轮换出来的凭据活得比进程久：一次重启把「已轮换」悄悄退回「未轮换」
 *
 * 日期：2026-10-19 07:0x CST · 轮次：R488（兑现 R487 §8 的 R74 out-of-cluster 要求）
 *
 * 平面：**credential rotation durability**。前几轮问的都是「到达没有」
 * （R457 邀请凭据作用域 / R468 吊销到达 / R469 到期到达 / R475 准入到达 /
 * R482 投递到达 / R487 类型穿过 merge）。本轮问的是**到达之后能不能活过重启**
 * —— 一个此前从未被审计的轴：凭据**状态**的持久性。
 *
 * 三条控制行（每条都钉当前行为，不是愿望清单）：
 *   D1  轮换确实在进程内立刻生效：旧 token 通过、新 token 通过。
 *   D2  新 token 在重启后立即失效，轮换被静默回退。
 *   D3  被覆盖的那一格只有一个槽位：第二次轮换丢掉第一次的旧 token。
 *
 * 本套件**零生产改动**。修法是行为决策（是否持久化 = 运维语义），father-gated。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn, type ChildProcess } from 'child_process';
import { WSServer } from '../src/ws_server.js';
import { ClawDB } from '../src/db.js';
import type { Config } from '../src/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HUB = join(HERE, '..');
const TSX = join(HUB, 'node_modules', '.bin', 'tsx');

let portSeq = 0;

// ── vocab census (see R488 §2): what the plane is called, if it is called ──
const SRC = [
  'hub_log', 'db_log', 'federation_log', 'scheduler_log',
  'startup_banner', 'config_file', 'types', 'index',
  'rest_server', 'ws_server', 'memory', 'federation',
  'scheduler', 'session_archive', 'errors', 'crypto', 'otlp_sink',
].map(f => join(HUB, 'src', `${f}.ts`));

/** Strip `//` and block comments so a census never matches its own documentation. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('R488 — rotated credential state lives in memory only; a restart silently un-rotates', () => {

  // ── P1 ──────────────────────────────────────────────────────────────────
  // Vocab census: there is no persistence vocabulary anywhere in hub/src.
  // This is a NEGATIVE claim, so it is only meaningful alongside a positive
  // control: the same census DOES find the words when they are present.
  describe('P1: hub/src has no vocabulary for persisting credential state', () => {

    it('P1a (positive control): the census finds a word when the word is there', () => {
      // The sentinel must live in CODE, not in prose — stripComments removes
      // `// ...`, so an earlier draft of this control put `fsync` in a comment
      // and then asserted the census would find it. The control failed, and
      // it was the control that was wrong (R460-9: a failing control is worth
      // more than a green suite).
      const code = 'const rotated = fsync(fd);\nrotateToken()';
      expect(stripComments(code)).toMatch(/fsync/);
      // ...and the stripper really does drop comments, so the negative half of
      // the census below is not an artefact of a no-op filter.
      expect(stripComments('// fsync\nconst x = 1;')).not.toMatch(/fsync/);
      expect(stripComments(code)).not.toMatch(/sealed-vault/);
    });

    it('P1b: no persistence primitive is referenced by the rotation path', () => {
      const body = readSources(['ws_server', 'rest_server', 'config_file', 'index', 'types']);
      // These are the four spellings that would make rotation durable.
      for (const w of ['writeFileSync', 'writeFile(', 'fsync', 'sync(']) {
        expect(body, `rotation path references ${w}`).not.toMatch(
          new RegExp(w.replace('(', '\\(')),
        );
      }
    });

    it('P1c: the ONLY writeFileSync in src belongs to a different subsystem', () => {
      // session_archive.ts:52 is the one writer. It is not reachable from
      // rotateToken, so its existence must not be read as "config is saved".
      const all = readSources(['session_archive', 'ws_server', 'rest_server']);
      const archiverWrites = (all.match(/writeFileSync/g) ?? []).length;
      const rotationWrites = (readSources(['ws_server', 'rest_server', 'config_file', 'index'])
        .match(/writeFileSync/g) ?? []).length;
      expect(archiverWrites).toBeGreaterThan(0);
      expect(rotationWrites).toBe(0);
    });

    it('P1d: the boot path reads back NO rotation state — the arm that separates a write-only repair from a real one', () => {
      // P1d as FIRST WRITTEN asserted that the boot path reads A file, and it
      // PASSED for an unrelated reason: index.ts calls existsSync(publicDir)
      // for the Web UI directory. A rubber stamp that cannot fail is not an
      // arm (R461), and worse, it CLAIMED to be the reader-side arm while
      // observing nothing about rotation.
      //
      // What this arm must discriminate is the pair the near-miss probe
      // measures (scripts/r488_nearmiss_probe.py):
      //   M4  write-only  -- the rotation is persisted, never read back
      //   M3  full repair -- persisted AND read back at boot
      // Both arms add a WRITER, so the census arms P1b/P1c kill both equally
      // and cannot tell them apart. This arm is the one that can: it is GREEN
      // while the boot path holds no rotation state (today, and under M4) and
      // goes RED the moment a boot path actually reads a rotation state back
      // (M3). So a real repair turns this arm RED ON PURPOSE — the deliberate
      // update signal, the same shape as r481's repair arms.
      //
      // It is GREEN today, so it does not ship a red test.
      const bootPath = readSources(['config_file', 'index']);
      const readsRotationState = /authToken|nextAuthToken|rotat/i;
      expect(
        bootPath,
        'the boot path reads a rotation state back — a durable rotation needs the read side',
      ).not.toMatch(readsRotationState);
      // POSITIVE CONTROL: the detector above is sensitive. Without it, a
      // typo in the regex would make this arm permanently GREEN.
      expect(
        stripComments(
          'const persisted = JSON.parse(readFileSync(p, "utf8"));\nconfig.authToken = persisted.token;',
        ),
      ).toMatch(readsRotationState);
    });
  });

  // ── P2 ──────────────────────────────────────────────────────────────────
  // The defect itself, at the unit level: rotateToken mutates `config` and
  // returns. A second config object built the way index.ts builds one is
  // untouched.
  describe('P2: rotateToken returns a rotated config that nothing persists', () => {

    it('P2a: rotateToken mutates the object it was handed (the in-memory effect is real)', () => {
      const { server, config } = newWsServer('OLD-TOKEN-0123456789');
      const before = config.authToken;
      const res = server.rotateToken('NEW-TOKEN-abcdef0123', 60_000);
      expect(before).toBe('OLD-TOKEN-0123456789');
      expect(config.authToken).toBe('NEW-TOKEN-abcdef0123');
      expect(res.oldToken).toBe('OLD-TOKEN-0123456789');
      expect(res.gracePeriodEnd).toBeGreaterThan(Date.now());
    });

    it('P2b: a FRESH config — what a restart builds — still holds the pre-rotation token', () => {
      newWsServer('OLD-TOKEN-0123456789').server
        .rotateToken('NEW-TOKEN-abcdef0123', 60_000);
      // index.ts rebuilds Config from env + CONFIG_FILE on every boot. There is
      // no read-back, so the new process is handed a brand-new object that
      // still carries the PRE-rotation token.
      const { server } = newWsServer('OLD-TOKEN-0123456789');
      expect(server.isTokenAuthorized('NEW-TOKEN-abcdef0123')).toBe(false);
      expect(server.isTokenAuthorized('OLD-TOKEN-0123456789')).toBe(true);
    });

    it('P2c: the state that does not survive is exactly {nextAuthToken, gracePeriodEnd}', () => {
      // Both fields are declared on Config (types.ts:10) but neither is ever
      // written by any writer in src. Asserting the DECLARATION exists while
      // no writer exists is the "name promises, body does not" shape (R486).
      const types = readSources(['types']);
      expect(types).toMatch(/nextAuthToken\?:\s*string/);
      const configFile = readSources(['config_file']);
      expect(configFile).not.toMatch(/nextAuthToken/);
    });
  });

  // ── P3 ──────────────────────────────────────────────────────────────────
  // THE SLOT SHAPE. One grace slot, not a set. Two rotations inside one grace
  // window: the first rotation's old token is no longer reachable, and the
  // grace clock is silently restarted.
  describe('P3: the grace window is one slot, not a set of credentials', () => {

    it('P3a: rotation #2 evicts rotation #1 from the grace window', () => {
      const { server } = newWsServer('T0-aaaaaaaaaaaaaaaa');
      server.rotateToken('T1-bbbbbbbbbbbbbbbb', 60_000);
      // During #1's grace the slot holds T0, so BOTH T0 and T1 authorize.
      expect(server.isTokenAuthorized('T0-aaaaaaaaaaaaaaaa')).toBe(true);
      expect(server.isTokenAuthorized('T1-bbbbbbbbbbbbbbbb')).toBe(true);

      server.rotateToken('T2-cccccccccccccccc', 60_000);
      // #2 overwrites the single slot with T1. T0 — which the operator handed
      // out and may still be running under — stops authorizing immediately,
      // with no error and no log line naming it.
      expect(server.isTokenAuthorized('T1-bbbbbbbbbbbbbbbb')).toBe(true);
      expect(server.isTokenAuthorized('T2-cccccccccccccccc')).toBe(true);
      expect(server.isTokenAuthorized('T0-aaaaaaaaaaaaaaaa')).toBe(false);
    });

    it('P3b: rotation #2 RESTARTS the grace clock, extending the SURVIVOR past its original expiry', () => {
      // The title used to name T0 as the beneficiary. Measured (r488 F1
      // probe): T0 is the token that LOST its slot — it is revoked outright
      // by rotation #2. The token that actually gains the extended clock is
      // T1, the one still in the slot. R458/R460 class: a title that denies
      // its own assertion, shipped. Fixed in the title; the assertion is
      // unchanged and was always correct.
      const { server } = newWsServer('T0-aaaaaaaaaaaaaaaa');
      const first = server.rotateToken('T1-bbbbbbbbbbbbbbbb', 1_000);
      const second = server.rotateToken('T2-cccccccccccccccc', 60_000);
      expect(second.gracePeriodEnd).toBeGreaterThan(first.gracePeriodEnd);
      // T0 is what actually gained: it was due to die at first.gracePeriodEnd.
      expect(server.getTokenStatus().gracePeriodEnd).toBe(second.gracePeriodEnd);
      // ...and the beneficiary is T1, not T0: T1 is the token still in the
      // slot, and the slot's clock is the one that got extended.
      expect(server.isTokenAuthorized('T1-bbbbbbbbbbbbbbbb')).toBe(true);
      expect(server.isTokenAuthorized('T0-aaaaaaaaaaaaaaaa')).toBe(false);
    });

    it('P3c: the grace slot holds exactly ONE token — asserted as a size over ALL candidates', () => {
      // The earlier draft of this arm filtered over a HARDCODED one-element
      // array, so `toHaveLength(1)` could never observe a second survivor:
      // a real Set holding T0 AND T1 would still satisfy it. Measured
      // (r488 addendum 4b): with the full Set repair applied, this arm
      // stayed GREEN while P3a went red — i.e. it could not tell a slot
      // from a set.
      //
      // Fixed by enumerating every candidate token that has ever been issued
      // and counting the ones that authorize AS A GRACE-SLOT OCCUPANT. The
      // CURRENT token is excluded: it authorizes by being current, not by
      // occupying the slot. (An earlier draft of this fix counted it and
      // went red on correct behaviour — the count has to be about the slot.)
      const { server, config } = newWsServer('T0-aaaaaaaaaaaaaaaa');
      server.rotateToken('T1-bbbbbbbbbbbbbbbb', 60_000);
      const current = config.authToken;
      const candidates = [
        'T0-aaaaaaaaaaaaaaaa',   // superseded by rotation #1 -> the slot occupant
        'T1-bbbbbbbbbbbbbbbb',   // the CURRENT token (excluded: it is not in the slot)
        'T2-cccccccccccccccc',   // never issued in this scenario
      ];
      const slotOccupants = candidates
        .filter(t => t !== current)
        .filter(t => server.isTokenAuthorized(t));
      expect(slotOccupants).toHaveLength(1);
      // The one occupant is the token actually in the slot.
      expect(slotOccupants[0]).toBe('T0-aaaaaaaaaaaaaaaa');
    });
  });

  // ── P4 ──────────────────────────────────────────────────────────────────
  // LIVE TWO-PROCESS CONTROL. This is what makes P2b a statement about the
  // program rather than about the objects. Boot a real hub, rotate over REST,
  // kill it, boot a second hub with the SAME config file, and ask the second
  // one which token it honors.
  describe('P4: live two-process control — rotate, restart, observe', () => {

    it('P4a: a rotated token is rejected by the next process with the same config', async () => {
      const original = 'ORIGINAL-TOKEN-abcdef123456';
      const dataDir = mkdtempSync(join(tmpdir(), 'r488-restart-'));
      const cfgPath = join(dataDir, 'config.json');
      writeFileSync(cfgPath, JSON.stringify({ authToken: original }));
      const sqlitePath = join(dataDir, 'hub.sqlite');
      const port = 19500 + (portSeq++ % 400);
      const restPort = port + 1;

      // ── process 1 ──────────────────────────────────────────────────────
      const p1 = await bootAndWait({ cfgPath, dataDir, sqlitePath, port, restPort });
      try {
        expect(p1.out, 'process 1 must reach Endpoints').toMatch(/Endpoints:/);
        // rest_server.ts:236 gates every non-GET behind isTokenAuthorized, so
        // the rotate call must present the CURRENT token. Posting with no
        // header would 401 and prove nothing about rotation.
        const rotated = await postJson(restPort, '/admin/token/rotate', {
          gracePeriodMs: 3_600_000, // one hour: unambiguous within the test
        }, original);
        expect(rotated.status, 'rotate must succeed').toBe(200);
        const newToken = rotated.body.newToken as string;
        expect(newToken).toMatch(/^[0-9a-f]{32}$/);

        // In-process: the rotation took effect immediately.
        const duringStatus = await getJson(restPort, '/admin/token/status', original);
        expect(duringStatus.status).toBe(200);
        expect(duringStatus.body.status.inGracePeriod).toBe(true);
      } finally {
        await killTree(p1.child);
      }

      // ── process 2: SAME config file, same ports ────────────────────────
      const p2 = await bootAndWait({ cfgPath, dataDir, sqlitePath, port, restPort });
      try {
        expect(p2.out, 'process 2 must reach Endpoints').toMatch(/Endpoints:/);
        // The ORIGINAL token works again — the rotation did not survive.
        const status = await getJson(restPort, '/admin/token/status', original);
        expect(status.status).toBe(200);
        expect(status.body.status.inGracePeriod,
          'after a restart there is no grace period at all').toBe(false);
      } finally {
        await killTree(p2.child);
      }

      rmSync(dataDir, { recursive: true, force: true });
    }, 90_000); // two real tsx boots + two binds; the 10s default is not a
               // budget for this, it is a coin flip (R482-10).

    it('P4b: NEGATIVE CONTROL — the probe can tell "un-rotated" from "rotated"', async () => {
      // If the probe cannot distinguish these two states, P4a proves nothing.
      // This runs the SAME two-process sequence but re-boot-persists nothing
      // and instead asserts the in-process arm, which we know is rotated.
      const token = 'PROBE-TOKEN-abcdef123456';
      const dataDir = mkdtempSync(join(tmpdir(), 'r488-ctl-'));
      const cfgPath = join(dataDir, 'config.json');
      writeFileSync(cfgPath, JSON.stringify({ authToken: token }));
      const sqlitePath = join(dataDir, 'hub.sqlite');
      const port = 19900 + (portSeq++ % 90);
      const restPort = port + 1;

      const p = await bootAndWait({ cfgPath, dataDir, sqlitePath, port, restPort });
      try {
        const r = await postJson(restPort, '/admin/token/rotate', {
          gracePeriodMs: 3_600_000,
        }, token);
        expect(r.status, 'negative control rotate must succeed').toBe(200);
        const s = await getJson(restPort, '/admin/token/status', token);
        expect(s.body.status.inGracePeriod).toBe(true);
      } finally {
        await killTree(p.child);
      }
      rmSync(dataDir, { recursive: true, force: true });
    }, 90_000);
  });
});

// ── helpers ───────────────────────────────────────────────────────────────

function readSources(names: string[]): string {
  return names
    .map(n => stripComments(readFileSync(join(HUB, 'src', `${n}.ts`), 'utf8')))
    .join('\n');
}

/** Build a WSServer over an ad-hoc config object.
 *
 *  Returns the config it ACTUALLY handed to WSServer, because rotateToken
 *  mutates that object by reference. A first draft of this suite kept its own
 *  `const config = {...}` and asserted on THAT — which is a different object,
 *  so the in-memory rotation looked like it did nothing. The helper exists to
 *  make that class of mistake impossible: one object, both references.
 */
function newWsServer(authToken: string): { server: WSServer; config: Config } {
  const dataDir = mkdtempSync(join(tmpdir(), 'r488-unit-'));
  const config = {
    host: '127.0.0.1', port: 0, restPort: 0, dataDir,
    storage: { type: 'sqlite', sqlitePath: join(dataDir, 'unit.sqlite') },
    authToken,
  } as unknown as Config;
  const db = new ClawDB(config);
  return { server: new WSServer(config, db), config };
}

interface Booted { child: ChildProcess; out: string; }

async function bootAndWait(args: {
  cfgPath: string; dataDir: string; sqlitePath: string;
  port: number; restPort: number;
}): Promise<Booted> {
  const child = spawn(TSX, ['src/index.ts'], {
    cwd: HUB,
    env: {
      ...process.env,
      CONFIG_FILE: args.cfgPath,
      DATA_DIR: args.dataDir,
      SQLITE_PATH: args.sqlitePath,
      PORT: String(args.port),
      REST_PORT: String(args.restPort),
      WEB_UI_PORT: String(args.restPort + 2),
      WOCLAW_LOG_FORMAT: 'text',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    // tsx FORKS (R487 §6): kill(-pid) takes the whole group so the real
    // listener cannot be orphaned onto the port for later runs.
    detached: true,
  });
  let out = '';
  child.stdout!.on('data', d => { out += d; });
  child.stderr!.on('data', d => { out += d; });

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (/Endpoints:/.test(out)) {
      // The banner is printed BEFORE/AROUND the bind, so reaching it does not
      // guarantee the REST listener accepts yet. Three green runs followed by a
      // red one on P4a: the arm was racing the socket. Condition-poll the
      // listener instead of assuming it (R482-10: a fixed sleep is a coin flip;
      // a verdict that moves between runs is a driver artefact, not a finding).
      await waitForRest(args.restPort);
      return { child, out };
    }
    if (/Fatal error/.test(out)) break;
    await new Promise(r => setTimeout(r, 150));
  }
  return { child, out };
}

/** Poll the REST listener until it answers. Bounded; never sleeps a fixed
 *  amount and then hopes. */
async function waitForRest(port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr = 'timeout';
  while (Date.now() < deadline) {
    try {
      const r = await httpJson(port, 'GET', '/health');
      if (r.status === 200) return;
      lastErr = `status ${r.status}`;
    } catch (e) {
      lastErr = String((e as Error).message ?? e);
    }
    await new Promise(r => setTimeout(r, 120));
  }
  throw new Error(`REST never became ready on ${port}: ${lastErr}`);
}

function killTree(child: ChildProcess): Promise<void> {
  return new Promise(resolve => {
    try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* gone */ }
    child.on('close', () => resolve());
    setTimeout(resolve, 1500);
  });
}

async function httpJson(
  port: number, method: string, path: string, body?: unknown, token?: string,
): Promise<{ status: number; body: any }> {
  const http = await import('http');
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method,
        headers: {
          ...(payload ? { 'content-type': 'application/json',
                          'content-length': Buffer.byteLength(payload) } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
      res => {
        let d = '';
        res.on('data', c => { d += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode ?? 0, body: d ? JSON.parse(d) : {} }); }
          catch { resolve({ status: res.statusCode ?? 0, body: { raw: d } }); }
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function postJson(port: number, path: string, body: unknown, token?: string) {
  return httpJson(port, 'POST', path, body, token);
}
function getJson(port: number, path: string, token?: string) {
  return httpJson(port, 'GET', path, undefined, token);
}
