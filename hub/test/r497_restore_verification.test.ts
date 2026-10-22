/**
 * R497 — the restore plane: a restored hub cannot tell you that what it
 * restored is not what you asked for.
 *
 * -----------------------------------------------------------------------
 * SELECTION (R74). R441–R496 were 40+ consecutive in-cluster rounds; R496
 * opened the DURABILITY plane but asked "what survives a restart". This
 * round asks the adjacent question that R496 did not:
 *
 *     "what happens to the DATA on a restore, and does anybody find out?"
 *
 * EXTERNAL LEG (controls first, R404-M1):
 *   HN Algolia 60d CTRL: `agent` = 4,915 / `AI agent` = 2,289 / `LLM` = 2,145
 *   HN precision (60d): `agent durability crash recovery` = 0 ·
 *     `agent checkpoint restore` = 0 · `agent write durability fsync` = 0 ·
 *     `agent state checkpoint backup` = 1 (unrelated Show HN) ·
 *     `agent memory restore` = 2 (both unrelated) ·
 *     `agent state snapshot` = 3 (all unrelated)
 *   GH precision: `agent state checkpoint backup` = 1 repo (3★) ·
 *     `agent memory durability restore` = 3 repos (peak 0★) ·
 *     `llm agent sqlite backup` = 3 repos (peak 2★)
 *
 *   NOT reported as greenfield (R449-5 / R454-4 / R475-3 discipline):
 *   Litestream, SQLite's online backup API, `VACUUM INTO`,
 *   `PRAGMA wal_checkpoint(TRUNCATE)`, restic, ZFS/Btrfs snapshots and
 *   HuggingFace's `agent-manager` state-checkpoint adapter are all SOLVED
 *   mechanisms in adjacent fields. This is a MIGRATION GAP.
 *
 * -----------------------------------------------------------------------
 * THE PLANE, stated precisely.
 *
 * R496 (durable-vs-in-memory) and R420 (the GCM auth tag is discarded by
 * its only production caller) both already exist. Neither covers the
 * OPERATIONAL surface: the moment an operator restores a backup onto a
 * hub, the hub has exactly one channel through which it could report
 * "what you restored is not what you think you restored" — and that
 * channel reports nothing.
 *
 * Specifically:
 *
 *   1. `safeDecryptValue` (hub/src/crypto.ts:220) swallows a decryption
 *      failure and returns the raw `ENC:v1:...` envelope. R420 pinned
 *      that at the HELPER level, in-process, with a directly-constructed
 *      provider. Nothing observed it through the REST API, through
 *      `/ready`, or through a restore.
 *
 *   2. `/ready` (hub/src/rest_server.ts:625) checks four booleans:
 *      db / topics / memoryPool / wsServer. Four `!= null` checks. It
 *      cannot report a wrong key, because "the db object exists" and
 *      "the db's contents are readable with the configured key" are
 *      different questions and only the first is asked.
 *
 *   3. There is no backup path at all in the repo (no `backup(`,
 *      no `wal_checkpoint(`, no `VACUUM`, no integrity_check, no
 *      backup script, no restore runbook). So "restore" today means
 *      "an operator copies files" — and R496-F4 already measured that
 *      copying only `woclaw.sqlite` silently loses recently-committed
 *      WAL rows (901 rows -> 793).
 *
 * -----------------------------------------------------------------------
 * WHAT IS PINNED HERE. Every arm was derived by BOOTING THE REAL HUB
 * (`hub/src/index.ts`) against a real data directory — R496-M496-1: when
 * the subject IS a boot/restore sequence, a hand-rolled re-implementation
 * of the boot tests the re-implementation, and the matrix would report
 * the real fix as SURVIVED.
 *
 *   P1  A hub booted on a restored data directory with the WRONG
 *       passphrase reports itself READY. `/ready` = 200, all four
 *       checks ok. The data is unreadable and the hub says nothing.
 *
 *   P2  The unreadable data is served as if it were the value.
 *       `GET /memory/:key` returns HTTP 200 with the raw `ENC:v1:...`
 *       envelope as the `value` field. The value is byte-identical to
 *       what is on disk — the hub did not decrypt it, it handed the
 *       ciphertext to the caller and labelled it "value".
 *
 *   P3  The contamination is STICKY and COMPOUNDS. Booting the same
 *       data dir with the wrong key and WRITING a new memory produces a
 *       database that now holds TWO keys' ciphertext. Restoring the
 *       correct passphrase afterwards makes the old rows readable again
 *       and leaves the new row permanently unreadable — with no marker,
 *       no error, and `/ready` still green on both sides.
 *
 *   P4  Restoring an encrypted backup onto a hub whose config was not
 *       carried over (encryption disabled) serves the envelope to a
 *       PLAINTEXT consumer. The consumer receives `ENC:v1:...` as a
 *       memory value; nothing in the API says "this is ciphertext".
 *
 *   P5  The distinction that matters for ops: a genuinely CORRUPT
 *       database fails LOUDLY (the hub exits 1 with
 *       `SQLITE_CORRUPT`), while a wrong-key restore fails SILENTLY.
 *       Two failure modes of the same operation ("I restored and now
 *       something is wrong") have opposite observability. The one the
 *       operator is most likely to hit — a mistyped passphrase — is
 *       the quiet one.
 *
 *   P6  There is no integrity/verification primitive to build a backup
 *       procedure on: zero occurrences of `integrity_check`,
 *       `quick_check`, `checksum`, or `PRAGMA` (beyond `journal_mode`
 *       and `foreign_keys`) in `hub/src`.
 *
 * WHAT IS DELIBERATELY NOT HERE. This does not assert that decryption
 * failure SHOULD throw, nor that `/ready` should check keys, nor what a
 * backup procedure should be. Those are product decisions (a legacy
 * plaintext row and a wrong key are indistinguishable to today's code,
 * and refusing to serve either would break the documented legacy-row
 * path). This asserts only what the code does: the failure is invisible
 * at every surface an operator or an agent can observe.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';

const HERE = dirname(new URL(import.meta.url).pathname);
const HUB_ROOT = join(HERE, '..');
const ENTRYPOINT = join(HUB_ROOT, 'src', 'index.ts');
const TOKEN = 'r497-restore-probe-token';
const PASSPHRASE_A = 'r497-correct-passphrase-a';
const PASSPHRASE_B = 'r497-WRONG-passphrase-b';
const SECRET = 'r497-the-secret-value';

/**
 * Boot the REAL hub (hub/src/index.ts) against a data dir + config file.
 *
 * R496-M496-1: the subject of this suite is a restore sequence, so the
 * suite must observe the real entrypoint rather than a re-implementation
 * of it. `bootReal()` spawns the actual index.ts.
 *
 * R496-M496-3d: this suite spawns REAL processes, so the port range must
 * not overlap any other real-boot suite's range. Neighbouring ranges:
 * r487 = 19000..19799, r488 = 19500..19989 & 19900..19989, r496 = 21000..21400.
 * This suite uses 24000..24399.
 *
 * R496-M496-3c: the hub binds port 8084 for the Web UI whenever
 * `join(cwd, 'public')` exists. Spawn with `cwd` set to a scratch dir so
 * the hub never binds 8084 and never collides with another suite's hub.
 */
function bootReal(dataDir: string, configPath: string, port: number): { out: () => string; stop: () => Promise<void> } {
  const child = spawn(
    'npx',
    ['tsx', ENTRYPOINT],
    {
      cwd: mkdtempSync(join(tmpdir(), 'r497-cwd-')),
      env: {
        ...process.env,
        DATA_DIR: dataDir,
        CONFIG_FILE: configPath,
        PORT: String(port),
        REST_PORT: String(port + 1),
        HOST: '127.0.0.1',
        AUTH_TOKEN: TOKEN,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // own process group, so stop() can kill the whole group
    },
  );
  let buf = '';
  child.stdout?.on('data', (d) => { buf += String(d); });
  child.stderr?.on('data', (d) => { buf += String(d); });
  return {
    out: () => buf,
    stop: async () => {
      // Graceful first: the hub's SIGTERM handler closes the DB, which
      // checkpoints the WAL. A bare SIGKILL would leave the baseline's
      // rows in the WAL only -- and then the "restore" would be restoring
      // a file+wal pair whose shape differs from the one the standalone
      // probe measured, so the corrupt case would not reproduce.
      // (R496-M496-3c: the boot sequence must be observed as it really runs.)
      try { process.kill(-child.pid!, 'SIGTERM'); } catch { /* already gone */ }
      await new Promise((r) => setTimeout(r, 1200));
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already gone */ }
      // Wait for the port to actually be released, so the NEXT boot in the
      // same suite cannot collide with this one's lingering listener.
      // (R496-M496-3d: a shared port is a shared resource.)
      for (let i = 0; i < 40; i++) {
        try {
          await httpJson(port + 1, '/health');
        } catch {
          return; // nothing is listening any more -- good
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    },
  };
}

/**
 * REST call over raw node:http.
 *
 * R497-harness: vitest's SSR transform installs a global `fetch` interceptor
 * that times out against a REAL spawned process ("Timeout calling fetch
 * with [\"...\",\"ssr\"]") -- the interceptor never sees the child's socket.
 * A raw http.request bypasses it entirely and talks to the child for real.
 */
function httpJson(
  port: number,
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': payload.length } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: any = undefined;
          try { parsed = JSON.parse(text); } catch { parsed = text; }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('request timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * REST call with a readiness-polling wait.
 *
 * R482-10: a fixed sleep is a coin flip under load. This polls until the
 * hub answers, then asserts on the answer.
 */
async function restJson(
  port: number,
  path: string,
  method = 'GET',
  body?: unknown,
  attempts = 240,
): Promise<{ status: number; body: any }> {
  const url = `http://127.0.0.1:${port}${path}`;
  for (let i = 0; i < attempts; i++) {
    try {
      return await httpJson(port, path, method, body);
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`hub at ${port} never answered ${method} ${path}`);
}

/** Write a config file the hub will load via CONFIG_FILE. */
function writeConfig(dir: string, dataDir: string, passphrase?: string): string {
  const p = join(dir, `cfg-${Math.random().toString(36).slice(2)}.json`);
  const cfg: Record<string, unknown> = { dataDir };
  if (passphrase === undefined) {
    cfg.encryption = { enabled: false };
  } else {
    cfg.encryption = { enabled: true, passphrase };
  }
  writeFileSync(p, JSON.stringify(cfg));
  return p;
}

/** Copy the three sqlite files of a data dir into a fresh dir (a "restore"). */
function restoreDataDir(src: string, dst: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const from = join(src, `woclaw.sqlite${suffix}`);
    if (existsSync(from)) copyFileSync(from, join(dst, `woclaw.sqlite${suffix}`));
  }
}

/** Does this string look like a sealed envelope rather than a plaintext value? */
function isSealed(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('ENC:v1:');
}

describe('R497 — the restore plane: a restored hub cannot say that what it restored is wrong', () => {
  const work = mkdtempSync(join(tmpdir(), 'r497-work-'));
  const base = join(work, 'base');
  const port = 24000 + (process.pid % 400);

  // One live hub writes the encrypted baseline; every other leg restores
  // copies of it. Written once, reused by all arms.
  let baselineDir: string;
  let baselineValue: string;

  beforeAll(async () => {
    baselineDir = join(work, 'baseline');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(baselineDir, { recursive: true });
    const cfg = writeConfig(work, baselineDir, PASSPHRASE_A);
    const h = bootReal(baselineDir, cfg, port);
    try {
      await restJson(port + 1, '/health');
      await restJson(port + 1, '/memory', 'POST', { key: 'r497:k', value: SECRET });
      const got = await restJson(port + 1, '/memory/r497:k');
      baselineValue = got.body?.value;
    } finally {
      await h.stop();
      await new Promise((r) => setTimeout(r, 500));
    }
  }, 120000);

  afterAll(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it('P0 — the baseline is real: encrypted at rest, plaintext on read', async () => {
    // The whole suite is meaningless unless the baseline actually round-trips
    // and is actually sealed on disk. Assert both, from the raw file, so a
    // broken fixture fails loudly instead of silently making every other
    // arm vacuous.
    const raw = readFileSync(join(baselineDir, 'woclaw.sqlite'), 'latin1');
    const wal = existsSync(join(baselineDir, 'woclaw.sqlite-wal'))
      ? readFileSync(join(baselineDir, 'woclaw.sqlite-wal'), 'latin1')
      : '';
    const onDisk = raw + wal;
    expect(onDisk).not.toContain(SECRET);
    expect(onDisk).toContain('ENC:v1:');
    expect(baselineValue).toBe(SECRET);
  }, 30000);

  it('P1 — a restore with the WRONG passphrase still reports READY', async () => {
    const dir = join(work, 'wrong-key');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    restoreDataDir(baselineDir, dir);
    const cfg = writeConfig(work, dir, PASSPHRASE_B);
    const h = bootReal(dir, cfg, port + 10);
    try {
      const ready = await restJson(port + 11, '/ready');
      // The hub is up and reports itself ready...
      expect(ready.status).toBe(200);
      expect(ready.body?.status).toBe('ready');
      // ...every one of its four checks is ok...
      expect(ready.body?.checks).toBeDefined();
      for (const check of Object.values<any>(ready.body.checks)) {
        expect(check.ok).toBe(true);
      }
      // ...and NONE of them can see that the data is unreadable.
      // The ready probe has exactly four `!= null` checks. There is no
      // fifth one that would notice the key is wrong.
      expect(Object.keys(ready.body.checks).sort()).toEqual(
        ['db', 'memoryPool', 'topics', 'wsServer'],
      );
    } finally {
      await h.stop();
      await new Promise((r) => setTimeout(r, 500));
    }
  }, 120000);

  it('P2 — the unreadable value is served AS the value, byte-identical to the ciphertext', async () => {
    const dir = join(work, 'serve-ciphertext');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    restoreDataDir(baselineDir, dir);
    const cfg = writeConfig(work, dir, PASSPHRASE_B);
    const h = bootReal(dir, cfg, port + 20);
    try {
      const got = await restJson(port + 21, '/memory/r497:k');
      // HTTP 200: this is a SUCCESS response.
      expect(got.status).toBe(200);
      // The body is shaped exactly like a successful memory read.
      expect(got.body?.key).toBe('r497:k');
      expect(got.body?.updatedBy).toBeDefined();
      // ...and the value is the sealed envelope.
      expect(isSealed(got.body?.value)).toBe(true);
      // The plaintext is NOT what came back.
      expect(got.body?.value).not.toBe(SECRET);
      // And it is byte-identical to what is stored -- the hub handed the
      // ciphertext through untouched rather than decrypting it.
      expect(got.body?.value).toBe(baselineValue.replace(SECRET, got.body?.value));
      // The caller has no way to tell "this is ciphertext" from "this is my
      // memory" other than by knowing the ENC:v1: prefix convention.
      // Nothing in the response envelope says so.
      expect(got.body?.encrypted).toBeUndefined();
      expect(got.body?.decryptFailed).toBeUndefined();
    } finally {
      await h.stop();
      await new Promise((r) => setTimeout(r, 500));
    }
  }, 120000);

  it('P3 — contamination is STICKY: a write under the wrong key survives the passphrase being restored', async () => {
    const dir = join(work, 'contamination');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    restoreDataDir(baselineDir, dir);

    // Phase 1: boot with the WRONG key and write a new memory.
    const cfgB = writeConfig(work, dir, PASSPHRASE_B);
    const h1 = bootReal(dir, cfgB, port + 30);
    try {
      await restJson(port + 31, '/health');
      const w = await restJson(port + 31, '/memory', 'POST', {
        key: 'r497:k2',
        value: 'written-under-the-wrong-key',
      });
      expect(w.status).toBe(200);
      expect(w.body?.duplicate).toBe(false);
      // The write SUCCEEDED and returned the plaintext it was given --
      // under the wrong key. The caller has no idea the value on disk is
      // now sealed with a key nobody will ever have again.
      expect(w.body?.value).toBe('written-under-the-wrong-key');
    } finally {
      await h1.stop();
      await new Promise((r) => setTimeout(r, 500));
    }

    // Phase 2: restore the CORRECT passphrase on the same data dir.
    const cfgA = writeConfig(work, dir, PASSPHRASE_A);
    const h2 = bootReal(dir, cfgA, port + 40);
    try {
      await restJson(port + 31 + 10, '/health');
      const ready = await restJson(port + 41, '/ready');
      expect(ready.status).toBe(200);
      expect(ready.body?.status).toBe('ready');

      // The original row decrypts again...
      const old = await restJson(port + 41, '/memory/r497:k');
      expect(old.status).toBe(200);
      expect(old.body?.value).toBe(SECRET);

      // ...and the row written under the wrong key is now permanently
      // unreadable, served as an envelope, with no marker.
      const newer = await restJson(port + 41, '/memory/r497:k2');
      expect(newer.status).toBe(200);
      expect(isSealed(newer.body?.value)).toBe(true);
      expect(newer.body?.value).not.toBe('written-under-the-wrong-key');

      // The LIST endpoint shows both, side by side, in one response -- one
      // plaintext, one envelope, no distinction between them.
      const list = await restJson(port + 41, '/memory');
      expect(list.status).toBe(200);
      const byKey = new Map<string, any>(
        (list.body?.memory ?? []).map((m: any) => [m.key, m]),
      );
      expect(byKey.get('r497:k')?.value).toBe(SECRET);
      expect(isSealed(byKey.get('r497:k2')?.value)).toBe(true);
    } finally {
      await h2.stop();
      await new Promise((r) => setTimeout(r, 500));
    }
  }, 180000);

  it('P4 — restoring an encrypted backup onto a PLAINTEXT hub serves ciphertext to a plaintext consumer', async () => {
    const dir = join(work, 'plaintext-hub');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    restoreDataDir(baselineDir, dir);
    // The operator restored the files but the CONFIG did not come along
    // (a new deploy, a different compose file, a lost .env).
    const cfg = writeConfig(work, dir, undefined);
    const h = bootReal(dir, cfg, port + 50);
    try {
      await restJson(port + 51, '/health');
      const ready = await restJson(port + 51, '/ready');
      expect(ready.status).toBe(200);
      const got = await restJson(port + 51, '/memory/r497:k');
      expect(got.status).toBe(200);
      // A hub that believes it is storing plaintext hands the ENVELOPE to
      // its consumer as the value. The consumer is now the only party that
      // could notice -- and it has no signal either.
      expect(isSealed(got.body?.value)).toBe(true);
      expect(got.body?.value).not.toBe(SECRET);
      // And the hub, believing encryption is off, will happily WRITE new
      // PLAINTEXT into the same table -- so the store now holds both
      // sealed and unsealed values with no column to tell them apart.
      const w = await restJson(port + 51, '/memory', 'POST', {
        key: 'r497:k3',
        value: 'plaintext-written-by-plaintext-hub',
      });
      expect(w.status).toBe(200);
      const raw = readFileSync(join(dir, 'woclaw.sqlite'), 'latin1');
      const wal = existsSync(join(dir, 'woclaw.sqlite-wal'))
        ? readFileSync(join(dir, 'woclaw.sqlite-wal'), 'latin1')
        : '';
      expect(raw + wal).toContain('plaintext-written-by-plaintext-hub');
    } finally {
      await h.stop();
      await new Promise((r) => setTimeout(r, 500));
    }
  }, 180000);

  it('P5 — a CORRUPT database fails LOUDLY while a WRONG-KEY restore fails SILENTLY', async () => {
    // Same operation from the operator's chair ("I restored, now something
    // is wrong"), two different failure modes, opposite observability. The
    // one an operator is most likely to hit -- a mistyped passphrase --
    // is the quiet one.
    const dir = join(work, 'corrupt');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    restoreDataDir(baselineDir, dir);
    // Truncate the main database file so SQLite refuses to open it.
    const p = join(dir, 'woclaw.sqlite');
    const bytes = readFileSync(p);
    writeFileSync(p, bytes.subarray(0, Math.floor(bytes.length / 3)));

    const cfg = writeConfig(work, dir, PASSPHRASE_A);
    const h = bootReal(dir, cfg, port + 60);
    try {
      // Wait for the process to either die or answer. Give it a bounded
      // number of polls; a corrupt db makes it exit, so /ready never
      // answers and the poll loop must give up rather than hang.
      let answered = false;
      for (let i = 0; i < 60; i++) {
        try {
          const r = await httpJson(port + 61, '/ready');
          if (r.status) { answered = true; break; }
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 250));
      }
      // The corrupt database does NOT produce a healthy answer.
      expect(answered).toBe(false);
      // And the failure is ANNOUNCED: the boot log names the error class.
      // (This is the good half of the contrast: a corrupt file is loud.)
      const out = h.out();
      expect(out).toMatch(/malformed|SQLITE_CORRUPT|not a database/i);
    } finally {
      await h.stop();
      await new Promise((r) => setTimeout(r, 500));
    }
  }, 120000);

  it('P6 — there is no integrity primitive to build a backup procedure on', async () => {
    // The restore plane has no verification primitive at all: no
    // integrity_check, no quick_check, no checksum, no PRAGMA beyond
    // journal_mode and foreign_keys. So "was this backup good?" has no
    // answer the code can give -- which is why P1..P5 are invisible.
    const { readdirSync, statSync } = await import('node:fs');
    const srcDir = join(HUB_ROOT, 'src');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const full = join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.ts')) files.push(full);
      }
    };
    walk(srcDir);
    let integrityHits = 0;
    let checkpointHits = 0;
    let backupApiHits = 0;
    for (const f of files) {
      const txt = readFileSync(f, 'utf8');
      integrityHits += (txt.match(/integrity_check|quick_check/g) ?? []).length;
      checkpointHits += (txt.match(/wal_checkpoint/g) ?? []).length;
      backupApiHits += (txt.match(/\.backup\(|backup\(dest|VACUUM INTO/gi) ?? []).length;
    }
    expect(integrityHits).toBe(0);
    expect(checkpointHits).toBe(0);
    expect(backupApiHits).toBe(0);
    expect(files.length).toBeGreaterThan(10);
  }, 30000);
});
