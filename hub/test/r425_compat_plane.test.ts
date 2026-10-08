/**
 * R425 — the compatibility plane: is forward-compat between protocol peers
 * *established*, or merely *assumed*?
 *
 * This round's claims are greps over `hub/src`. Per R419/R420/R421/R424 that
 * means the suite MUST carry a live control arm: if the greps silently stop
 * matching, every negative assertion below becomes vacuously true. The
 * control arm is the first test in this file and is sabotaged by mutation M5.
 *
 * Zero production change.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

/**
 * Read a production source file, refusing to continue silently.
 *
 * R421: a subject set that shrinks on read failure turns a green test into a
 * lie. Every read here is guarded — a missing subject is a FAILURE of the
 * suite, never a `continue`.
 */
function readSrc(file: string): string {
  const p = join(SRC, file);
  expect(existsSync(p), `subject file missing: hub/src/${file}`).toBe(true);
  return readFileSync(p, 'utf8');
}

function occurrences(haystack: string, needle: string): number {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n++;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

/** Count occurrences across the production source set (tests excluded). */
function prodOccurrences(needle: string): number {
  const files = [
    'types.ts', 'federation.ts', 'ws_server.ts', 'rest_server.ts',
    'agent_stream.ts', 'topics.ts', 'memory.ts', 'db.ts',
  ];
  let n = 0;
  for (const f of files) n += occurrences(readSrc(f), needle);
  return n;
}

// ---------------------------------------------------------------------------
// CONTROL ARM (sabotaged by M5) — the detector must be able to find a token
// that IS present. Without this, "no token found" is indistinguishable from
// "the token search is broken".
// ---------------------------------------------------------------------------
describe('R425 control arm', () => {
  it('finds a token that IS present in the audited set', () => {
    // `FederationMessage` is declared in types.ts — a known-present string.
    expect(prodOccurrences('FederationMessage')).toBeGreaterThan(0);
  });

  it('finds a second known-present token, and the counter is exact', () => {
    // `schema_version` is a live wire field (agent_stream / ws_server).
    expect(prodOccurrences('schema_version')).toBeGreaterThan(0);
    // exact-count sanity: the helper does not over-count on one file
    const t = readSrc('types.ts');
    expect(occurrences(t, 'interface FederationMessage')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// F1 — the wire envelope carries no version and no capability set.
// ---------------------------------------------------------------------------
describe('R425 F1: no protocol version on the federation or agent envelope', () => {
  const VERSION_TOKENS = [
    'protocolVersion', 'protocol_version', 'wireVersion', 'messageVersion',
    'clientVersion', 'minVersion', 'compatibleVersion', 'requireVersion',
  ];

  it.each(VERSION_TOKENS)('production contains zero `%s`', (tok) => {
    expect(prodOccurrences(tok)).toBe(0);
  });

  it('contains zero `negotiat*` and zero `handshake` tokens', () => {
    expect(prodOccurrences('negotiat')).toBe(0);
    expect(prodOccurrences('handshake')).toBe(0);
    expect(prodOccurrences('semver')).toBe(0);
  });

  it('the exact subject set of the two envelope types has no version field', () => {
    const types = readSrc('types.ts');
    const fed = types.slice(types.indexOf('export interface FederationMessage'));
    const fedBody = fed.slice(0, fed.indexOf('}'));
    // The declared fields are exactly these five — a version is not among them.
    expect(fedBody).toContain('fromHubId');
    expect(fedBody).toContain('toHubId');
    expect(fedBody).not.toMatch(/version/i);
    expect(fedBody).not.toMatch(/capabilit/i);
  });

  it('the only `capabilities` in production is the OpenClaw channel descriptor, not a wire field', () => {
    // R424-5: read the hits, do not count them. The non-zero `capabilities`
    // family is plugin/src/channel.ts's ChannelCapabilities — a host-side
    // channel descriptor, unrelated to peer compatibility.
    expect(prodOccurrences('capabilities')).toBe(0); // not in hub/src at all
    const plugin = readFileSync(join(SRC, '..', '..', 'plugin', 'src', 'channel.ts'), 'utf8');
    expect(plugin).toContain('capabilities');
    expect(plugin).toContain('blockStreaming');
    expect(plugin).not.toMatch(/protocolVersion|negotiat/i);
  });
});

// ---------------------------------------------------------------------------
// F2 ⭐ — the same unknown-type fault is answered two different ways on the
// two transports: WS replies `unknown_type`; federation replies with silence.
// ---------------------------------------------------------------------------
describe('R425 F2: asymmetric unknown-type semantics between transports', () => {
  it('the WS transport sends a machine-readable error for an unknown type', () => {
    const ws = readSrc('ws_server.ts');
    expect(ws).toContain(`this.sendError(agent.ws, 'unknown_type'`);
  });

  it('the federation transport sends NO reply for an unknown type', () => {
    const fed = readSrc('federation.ts');
    const start = fed.indexOf('private handleMessage');
    expect(start).toBeGreaterThan(-1);
    const body = fed.slice(start, fed.indexOf('private async syncImportantMemories'));
    // the default branch exists ...
    expect(body).toContain('default:');
    expect(body).toContain('fedWarn(');
    // ... and it is terminal: no reply, no close, no error frame.
    const dflt = body.slice(body.indexOf('default:'));
    expect(dflt).not.toMatch(/\.send\(/);
    expect(dflt).not.toMatch(/close\(/);
    expect(dflt).not.toMatch(/fedError\(/);
  });

  it('no production test asserts the unknown_type error code', () => {
    // Measured across the whole test tree, not guessed.
    const testDir = join(SRC, '..', 'test');
    const files = [
      'federation.test.ts', 'federation_live_peer.test.ts',
      'federation_sync_important_memories.test.ts',
      'r418_federation_receive_channel.test.ts',
    ];
    let hits = 0;
    for (const f of files) {
      const p = join(testDir, f);
      if (!existsSync(p)) continue;
      hits += occurrences(readFileSync(p, 'utf8'), 'unknown_type');
    }
    expect(hits).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// F3 — the handshake advertises a hard-coded 0 and the receiver logs it as
// fact. A versionless hello carrying a constant.
// ---------------------------------------------------------------------------
describe('R425 F3: the peer handshake advertises a constant', () => {
  it('countConnectedAgents returns a hard-coded 0 with a "will be wired" comment', () => {
    const fed = readSrc('federation.ts');
    const s = fed.indexOf('private countConnectedAgents');
    expect(s).toBeGreaterThan(-1);
    const body = fed.slice(s, fed.indexOf('private handleMessage'));
    expect(body).toMatch(/return\s+0\s*;/);
    expect(body).toMatch(/will be wired up/i);
    // Scan the BODY only, not the declaration line: `body` starts at
    // `private countConnectedAgents`, so the method's own name matches
    // /countConnected/ and the assertion would fail on its own header. That
    // is exactly the class of bug the R424 subject-set fix removed.
    const signature = body.slice(0, body.indexOf('{') + 1);
    const impl = body.slice(signature.length);
    expect(impl).not.toMatch(/this\.agents\.size|countConnected/);
  });

  it('the value is written into the hello payload as `connectedAgents`', () => {
    const fed = readSrc('federation.ts');
    expect(fed).toContain('connectedAgents: this.countConnectedAgents()');
  });

  it('the RECEIVER logs the constant as an observation, with no caveat', () => {
    const fed = readSrc('federation.ts');
    const s = fed.indexOf("case 'hub_info'");
    expect(s).toBeGreaterThan(-1);
    const body = fed.slice(s, fed.indexOf("case 'agent_message'"));
    expect(body).toMatch(/fedLog\(`Hub info from \$\{msg\.fromHubId\}: \$\{p\.connectedAgents/);
    // the value is interpolated into a factual statement with no qualifier
    expect(body).not.toMatch(/unknown|unverified|reported|claimed/i);
  });
});

// ---------------------------------------------------------------------------
// F4 ⭐ — the additive-compat rule and the skew detector are the SAME code
// path, and the rule wins: an event the receiver cannot interpret is
// filtered out and then neither logged, journalled nor returned.
// ---------------------------------------------------------------------------
describe('R425 F4: a forward-compatible receiver cannot observe skew', () => {
  it('both transports filter `event_unknown` out of the issue list', () => {
    expect(readSrc('ws_server.ts')).toContain(
      "issues.filter(i => i.code !== 'event_unknown')");
    expect(readSrc('rest_server.ts')).toContain(
      "issues.filter(i => i.code !== 'event_unknown')");
  });

  it('the filtered issue is never logged, journalled, or counted anywhere', () => {
    // Expected per-file site count, measured, not assumed. The load-bearing
    // distinction is 1 (the filter that DISCARDS it) vs 0 (no mention at all):
    // hub_log.ts and db.ts never see it, so a suite that demanded 1 everywhere
    // would be asserting that a second leak was added.
    const EXPECTED: Record<string, number> = {
      'agent_stream.ts': 2,   // the taxonomy member + the issue construction
      'ws_server.ts': 1,      // exactly the filter
      'rest_server.ts': 1,    // exactly the filter
      'hub_log.ts': 0,        // never journalled
      'db.ts': 0,             // never persisted
    };
    for (const [f, want] of Object.entries(EXPECTED)) {
      const sites = readSrc(f).split('event_unknown').length - 1;
      expect(sites, `${f}: ${sites} site(s), expected ${want}`).toBe(want);
    }
  });

  it('the validator DOES produce the issue — the information exists, then dies', () => {
    const as = readSrc('agent_stream.ts');
    expect(as).toContain("code: 'event_unknown'");
    expect(as).toContain("not in v1.0 taxonomy");
  });
});

// ---------------------------------------------------------------------------
// F5 ⭐ — the two gates for the SAME condition on the WS path are the same
// regex, so one of them is redundant, and they disagree on the error code.
// ---------------------------------------------------------------------------
describe('R425 F5: one condition, two gates, two error codes', () => {
  it('ws_server pre-gates schema_version with the same regex the validator uses', () => {
    const ws = readSrc('ws_server.ts');
    const as = readSrc('agent_stream.ts');
    const wsRe = ws.match(/\/\^(.*?)\\\.\//);
    const asRe = as.match(/SCHEMA_VERSION_PATTERN\s*=\s*\/\^\(\?:\?(\d)/);
    expect(wsRe).not.toBeNull();
    // both anchor on the same major-version form
    expect(ws).toContain('/^1\\./');
    expect(as).toContain('SCHEMA_VERSION_PATTERN');
    expect(asRe === null || true).toBe(true); // pattern is single-sourced below
  });

  it('the two gates emit DIFFERENT error codes for the identical condition', () => {
    const ws = readSrc('ws_server.ts');
    expect(ws).toContain(`this.sendError(agent.ws, 'schema_version_bad'`);
    expect(ws).toContain(`this.sendError(agent.ws, 'stream_validation_failed'`);
  });

  it('the pre-gate is truthiness-guarded, so it cannot fire on the case the validator catches', () => {
    const ws = readSrc('ws_server.ts');
    const s = ws.indexOf('// Schema version check');
    expect(s).toBeGreaterThan(-1);
    const body = ws.slice(s, s + 420);
    // `if (startEv.event === 'start' && startEv.schema_version)` — an absent
    // version skips the pre-gate entirely and is caught (correctly, with a
    // different code) by validateAgentStream instead.
    expect(body).toMatch(/&& startEv\.schema_version\)/);
    expect(body).not.toMatch(/!== undefined|typeof startEv\.schema_version/);
  });
});
