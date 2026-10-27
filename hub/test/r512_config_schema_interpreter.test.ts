/**
 * R512 — THE CONFIG FILE IS THE HUB'S ONLY OPERATOR-FACING SCHEMA, AND IT HAS
 * NO INTERPRETER: A MISSPELLED KEY IS SILENT, AND THE SILENCE IS LOUDEST WHERE
 * IT MATTERS MOST (a security control the operator believes is ON).
 *
 * ── WHY THIS PLANE, AND WHY IT IS NOT A REPEAT ───────────────────────────────
 *
 * The wire-version plane is already mined, three times over:
 *   R425 — "the wire envelope carries no protocol version"
 *   R452 — "the additive-compat boundary is drawn by position"
 *   R495 — "the schema_version label is ACCEPTED but never INTERPRETED"
 *
 * All three are about the version label on a MESSAGE. None is about the
 * version of the artifact an OPERATOR writes: the JSON config file. That file
 * is the hub's only operator-facing schema — `CONFIG_FILE` is merged over the
 * env-derived defaults at boot and is never validated (R487.1 called it "the
 * bare `{ ...base, ...fileConfig }`, no schema check").
 *
 * R487 covered the TOP-LEVEL TYPE error mode and found it LOUD: `authToken:
 * null` crashes the boot banner with a TypeError. That is a good outcome.
 * This round covers the OTHER error mode, which R487's shape cannot see:
 *
 *   wrong TYPE at top level  -> LOUD  (crash)          [R487, shipped]
 *   wrong KEY NAME anywhere -> SILENT (no-op)          [R512, this suite]
 *
 * The asymmetry is the finding. A crash is a gift: the operator cannot ship a
 * config that boots and is wrong about a TYPE. A misspelled key produces a
 * boot that succeeds, a banner that looks normal, and a control that is off.
 *
 * ── WHAT IS MEASURED (not grepped, not argued) ───────────────────────────────
 *
 * P1  The merged config keeps the operator's misspelled key verbatim ⇒ the
 *     intent is PRESENT in the object and UNCONSUMED.
 * P2  CONTROLLED A/B on the production storage class: the typo arm is
 *     BYTE-IDENTICAL to "encryption was never configured" (plaintext canary on
 *     disk), while the correct-spelling arm stores ENC:v1:. So the typo is
 *     CAUSAL, not correlational.
 * P3  A config file naming a schema version the hub has never heard of
 *     (`schemaVersion: "9.9"`) is accepted silently — the hub cannot tell it
 *     was handed a file it does not understand.
 * P4  The startup banner prints the REQUESTED port, not the BOUND port. With
 *     `port: 0` the OS assigns an ephemeral port and the banner advertises
 *     `ws://127.0.0.1:0` — a URL that is not the one serving traffic. The
 *     server KNOWS the bound port (`boundPort`, `whenListening()`); the
 *     banner does not use it.
 * P5  The encryption state is observable NOWHERE: not in the startup banner,
 *     not in any REST endpoint. So the operator cannot confirm from the running
 *     hub that a CORRECT encryption config took effect either.
 *
 * ── METHOD, AND THE TWO INSTRUMENT FAILURES THIS ROUND PAID FOR ─────────────
 *
 * R505's rule: a detector must be MEASURED before its zero is evidence. Two
 * of my own instruments failed that test and are recorded here because the
 * failures are the same shape as the finding:
 *
 *   FAILURE 1 — the first A/B never separated. It never WROTE anything, so
 *     "the DB contains no ENC:v1:" was true in both arms for a reason
 *     unrelated to the typo. A 0 from a detector that never fired is not
 *     evidence of absence; it is evidence that the detector did not fire.
 *
 *   FAILURE 2 — the second A/B DID write, but read only `woclaw.db`. SQLite
 *     runs in WAL mode (`db.pragma('journal_mode = WAL')`), so the freshly
 *     written bytes live in `woclaw.db-wal`. The main file read 0 in both
 *     arms. The instrument was wrong, not the product.
 *
 * The version that separates drives the PRODUCTION storage class
 * (`new ClawDB(config)`) in-process, writes through `setMemory`, and inspects
 * the raw bytes of BOTH `woclaw.db` and `woclaw.db-wal`. That is the version
 * in P2 below, and it is the only one whose verdict may be quoted.
 *
 * ── POLARITY — READ THIS BEFORE INTERPRETING A RED RUN ───────────────────────
 *
 * This is a DEFECT-PRESENCE gate, not a defect-absence gate. It is GREEN while
 * the hub has the defect and turns RED when the defect is FIXED:
 *
 *   • fix the loader so it rejects an unknown key  -> P1 / P1b go RED
 *   • make the banner print the bound port          -> P4 goes RED
 *   • report the encryption state anywhere          -> P5 goes RED
 *
 * That is deliberate and is the same construction as R461's arm G ("the day
 * the correct resync lands it goes green on purpose", inverted here). A
 * reviewer seeing red after a fix should read it as "the fix landed and the
 * probe now reports it", not as a regression. The suite header says so, in
 * source, so the next reader does not have to rediscover it.
 *
 * ── WHAT IS DELIBERATELY NOT ASSERTED ───────────────────────────────────────
 *
 * That "the hub should validate its config file". Whether a typo is fatal,
 * warned about, or tolerated is a PRODUCT DECISION (an operator may be
 * running a config written for a newer hub and want the extra keys kept).
 * This suite pins the SHAPE — the asymmetry, and the consequence — not the fix.
 *
 * Zero production change. `hub/src/*.ts` md5 stable throughout.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ClawDB } from '../src/db.js';
import { loadConfigFile } from '../src/config_file.js';
import { buildDefaultConfig } from '../src/default_config.js';
import { printEndpointsBanner } from '../src/startup_banner.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

/** R421: a subject that vanishes on read failure turns a green test into a lie. */
function readSrc(file: string): string {
  const p = join(SRC, file);
  expect(existsSync(p), `subject file missing: hub/src/${file}`).toBe(true);
  return readFileSync(p, 'utf8');
}

/** The config-file surface itself: load a JSON object through the real loader. */
function loadConfig(obj: unknown): any {
  const dir = mkdtempSync(join(tmpdir(), 'r512cfg-'));
  try {
    const p = join(dir, 'config.json');
    writeFileSync(p, JSON.stringify(obj));
    return loadConfigFile(p, buildDefaultConfig());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Capture the endpoints banner without letting it reach stdout. */
function bannerFor(config: any): string[] {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.join(' ')); };
  try { printEndpointsBanner(config, undefined); } finally { console.log = orig; }
  return lines;
}

describe('R512 — the config file has no interpreter: a misspelled key is a silent no-op', () => {
  it('CONTROL: the loader really does merge a file over the defaults', () => {
    const c = loadConfig({ port: 9999 });
    expect(c.port).toBe(9999);
    expect(c.host).toBe(buildDefaultConfig().host);
  });

  it('P1: the operator\'s misspelled key survives the merge verbatim, unconsumed', () => {
    const c = loadConfig({ encryption: { enable: true, passphrase: 'a-long-passphrase' } });
    // the INTENT is present in the object...
    expect((c.encryption as any).enable).toBe(true);
    // ...and the field the production code reads is absent.
    expect(c.encryption?.enabled).toBeUndefined();
  });

  it('P1b: a config naming a schema version the hub has never heard of is accepted silently', () => {
    const c = loadConfig({ port: 9999, schemaVersion: '9.9', capabilities: { quantum: true } });
    expect(c.port).toBe(9999);
    // the unknown keys are KEPT, and nothing refused the file
    expect((c as any).schemaVersion).toBe('9.9');
    expect((c as any).capabilities).toEqual({ quantum: true });
  });

  it('P1c: the loader has no schema check — it is a bare spread over the parsed JSON', () => {
    const body = readSrc('config_file.ts');
    // the whole merge is one spread; there is no key allow-list anywhere
    expect(body).toContain('{ ...base, ...fileConfig }');
    expect(body).not.toMatch(/allowedKeys|knownKeys|validateConfig|assertConfig|schema/i);
  });
});

describe('R512 P2 — CONTROLLED A/B: the typo is CAUSAL, not correlational', () => {
  const CANARY = 'PLAINTEXT_CANARY_VALUE_9f3a';

  async function arm(encryptionBlock: any): Promise<{ encOnDisk: boolean; plainOnDisk: boolean }> {
    const dir = mkdtempSync(join(tmpdir(), 'r512ab-'));
    try {
      const dbPath = join(dir, 'woclaw.db');
      const db = new ClawDB({
        port: 0,
        restPort: 0,
        host: '127.0.0.1',
        dataDir: dir,
        authToken: 'probe-token-abcdef',
        storage: { type: 'sqlite', sqlitePath: dbPath },
        encryption: encryptionBlock,
      } as any);
      await db.setMemory('r512secret', CANARY, 'probe', [], 0);
      await db.getMemory('r512secret');

      // WAL mode: the freshly-written bytes may live in the -wal sidecar, so
      // BOTH files must be scanned. (R512 instrument failure 2.)
      let encOnDisk = false;
      let plainOnDisk = false;
      for (const f of [dbPath, dbPath + '-wal']) {
        if (!existsSync(f)) continue;
        const bytes = readFileSync(f);
        if (bytes.includes(Buffer.from('ENC:v1:'))) encOnDisk = true;
        if (bytes.includes(Buffer.from(CANARY))) plainOnDisk = true;
      }
      return { encOnDisk, plainOnDisk };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('the CORRECT spelling encrypts at rest (the control arm: the detector fires)', async () => {
    const r = await arm({ enabled: true, passphrase: 'a-long-passphrase' });
    expect(r.encOnDisk).toBe(true);
    expect(r.plainOnDisk).toBe(false);
  });

  it('the MISSPELLED spelling leaves the value in PLAINTEXT on disk', async () => {
    const r = await arm({ enable: true, passphrase: 'a-long-passphrase' });
    expect(r.encOnDisk).toBe(false);
    expect(r.plainOnDisk).toBe(true);
  });

  it('the misspelled arm is BYTE-IDENTICAL to "encryption never configured"', async () => {
    const typo = await arm({ enable: true, passphrase: 'a-long-passphrase' });
    const off = await arm(undefined);
    expect(typo.encOnDisk).toBe(off.encOnDisk);
    expect(typo.plainOnDisk).toBe(off.plainOnDisk);
  });

  it('=> the typo is CAUSAL: the three arms are not all equal', async () => {
    const typo = await arm({ enable: true, passphrase: 'a-long-passphrase' });
    const correct = await arm({ enabled: true, passphrase: 'a-long-passphrase' });
    const off = await arm(undefined);
    expect(correct.encOnDisk).toBe(true);
    expect(typo.encOnDisk).toBe(false);
    expect(off.encOnDisk).toBe(false);
    // the correct arm differs from BOTH others
    expect(correct.encOnDisk).not.toBe(typo.encOnDisk);
    expect(correct.encOnDisk).not.toBe(off.encOnDisk);
  });
});

describe('R512 P4 — the banner advertises the REQUESTED port, not the BOUND port', () => {
  it('the banner prints config.port verbatim', () => {
    const body = readSrc('startup_banner.ts');
    expect(body).toContain('${wsProto}://${config.host}:${config.port}');
    // and never the bound port
    expect(body).not.toMatch(/boundPort|whenListening/);
  });

  it('the server KNOWS the bound port — the information exists and is unused by the banner', () => {
    const ws = readSrc('ws_server.ts');
    expect(ws).toContain('this.boundPort = addr.port');
    expect(ws).toContain('async whenListening()');
  });

  it('with port 0 the banner shows ":0" while the server bound an ephemeral port', () => {
    const config: any = { port: 0, restPort: 0, host: '127.0.0.1' };
    const lines = bannerFor(config);
    const wsLine = lines.find(l => l.includes('WebSocket:')) ?? '';
    expect(wsLine).toContain(':0');
    // ":0" is not a connectable endpoint — the advertised URL is not the one
    // serving traffic. The banner is printing a REQUEST, not a FACT.
    expect(wsLine).not.toMatch(/:\d{4,5}$/);
  });
});

describe('R512 P5 — the encryption state is observable nowhere', () => {
  it('the startup banner prints no encryption state', () => {
    const body = readSrc('startup_banner.ts');
    expect(body).not.toMatch(/encryption/i);
  });

  it('no REST endpoint reports the encryption state', () => {
    const rest = readSrc('rest_server.ts');
    expect(rest).not.toMatch(/encryption/i);
  });

  it('the config type HAS the field, so the state is knowable — it is simply not reported', () => {
    const types = readSrc('types.ts');
    expect(types).toMatch(/encryption\?: \{/);
    expect(types).toMatch(/enabled\?: boolean/);
  });

  it('M5b SURVIVED: adding a configVersion reader is NOT the same as reporting it', () => {
    // The mutation matrix killed M5 (an `encryption` state export) but SURVIVED
    // M5b (a `configVersion` export). The difference is the SUBJECT: the suite
    // pins the encryption state, not "some config introspection". This arm
    // makes that boundary explicit so a later round does not widen the suite
    // into a general "the config is introspectable" claim it has not earned.
    //
    // NOTE the direction: `rest_server.ts` has NO `encryption` token at all
    // (that IS the P5 finding). So the negative assertion below is the one
    // that holds today, and the M5 mutation flips it to RED — which is how M5
    // was killed.
    const rest = readSrc('rest_server.ts');
    expect(rest).not.toMatch(/encryption/i);
    expect(rest).not.toMatch(/configVersion/);
  });
});

describe('R512 — the asymmetry this suite is named for', () => {
  it('the LOUD error mode (wrong TYPE at top level) is R487\'s; this suite pins the SILENT one', () => {
    // A wrong type at top level crashes the boot banner. Proved by R487; here
    // we only assert that the mechanism still exists, so that if it is ever
    // fixed this suite's asymmetry claim stops being true and must be revisited.
    const banner = readSrc('startup_banner.ts');
    expect(banner).toContain('config.authToken.substring(0, 8)');
  });

  it('the merge itself cannot distinguish "key absent" from "key misspelled"', () => {
    // A spread has no notion of a key it does not recognise. This is the
    // structural reason the silent mode exists and the loud mode does not.
    const body = readSrc('config_file.ts');
    expect(body).toContain('JSON.parse(readFileSync(configPath, \'utf-8\'))');
    expect(body).toContain('{ ...base, ...fileConfig }');
  });
});
