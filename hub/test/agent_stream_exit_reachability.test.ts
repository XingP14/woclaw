/**
 * R401 / L401.3 — exit-code REACHABILITY audit.
 *
 * Spec source: docs/S92-AGENT-STREAM-PROTOCOL.md §3.3 (7 exit codes).
 * R92.6 (2026-07-25) shipped 59 contract tests asserting the *vocabulary*
 * exists. R401 (2026-10-02) found 5/7 codes have no producer in production
 * source — the contract was satisfiable by nobody.
 *
 * Pitfall #401-1: VocabularyWithoutProducerIsNotAContract.
 * A vocabulary test proves the list parses. It cannot prove the list is
 * satisfiable. That is a different assertion and needs a different test.
 *
 * ── Design correction, made while shipping this file ────────────────────────
 * The first draft scanned for any `exit: '<code>'` literal and treated a hit
 * as a producer. Two things that draft got wrong, both now fixed:
 *
 *   1. `agent_stream.ts:201` contains the text `exit: "config"` inside a
 *      *comment* explaining that consumers treat EOF-without-result as
 *      config. A naive scan credited that comment as a producer, which would
 *      have permanently hidden one of the five dead codes. Comments are
 *      stripped before matching.
 *   2. The draft also flagged `ok` and `error` as orphans. That is wrong and
 *      in the opposite direction: both are satisfied by a *different* producer
 *      class — they arrive on the agent's own `result` envelope and the hub
 *      forwards them (rest_server.ts:379, ws_server.ts:343). Treating a
 *      forwarded code as missing would train people to ignore this gate.
 *
 * So reachability has two classes, and a code is alive if it has either:
 *   (a) IN_HUB_PRODUCED   — hub assigns the literal to an `exit` field
 *   (b) ENVELOPE_FORWARDED — hub reads `lastEvent.exit` and relays it
 * Everything else is unreachable, and must be an explicit, tracked exception.
 *
 * CI contract: adding a member to AGENT_STREAM_EXITS with no producer and no
 * entry here turns this file red on the next run. That is the entire point.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AGENT_STREAM_EXITS } from '../src/agent_stream.js';

/**
 * Codes with no producer, as of 2026-10-02 (HEAD 252f183).
 *
 * A *baseline*, not an endorsement: each entry names the ladder item that will
 * close it, so the debt is tracked rather than forgotten. Delete an entry the
 * day a producer lands — the staleness test below then enforces it.
 */
const KNOWN_UNREACHABLE: Record<string, string> = {
  budget: 'L401.2 reaper (reason=budget_exhausted), or the L307 budget-controller',
  timeout: 'L401.1 lease + L401.4 deadline — needs a reaper to stamp a terminal exit',
  config: 'L401.2 reaper (reason=config); note agent_stream.ts:201 only *documents* it in a comment',
  rate_limited: 'L307 budget-controller (unblocked)',
  interrupted: 'L401.2 reaper (reason=aborted), or an explicit delegate_cancel producer',
};

/** Reachable because the hub relays the value the agent itself reported. */
const ENVELOPE_FORWARDED: readonly string[] = ['ok', 'error'];

const HUB_SRC = join(process.cwd(), 'src');
const PACKAGES_SRC = join(process.cwd(), '..', '..', 'packages');

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') && !e.name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

/** Strip comments so a documented exit is never mistaken for a produced one. */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const productionFiles = [...walk(HUB_SRC), ...walk(PACKAGES_SRC)];
const productionCode = new Map(productionFiles.map((f) => [f, codeOf(f)]));

/** (a) Does any production file assign this exit literal to an `exit` field? */
function producersFor(code: string): string[] {
  const literal = new RegExp(`exit\\s*[:=]\\s*['"\`]${code}['"\`]`);
  return productionFiles.filter((f) => literal.test(productionCode.get(f)!));
}

/** (b) Does the hub relay an agent-reported exit? */
function forwardingSites(): string[] {
  return productionFiles.filter((f) => /\.exit\b/.test(productionCode.get(f)!));
}

describe('R401.3 — agent-stream exit reachability (§3.3)', () => {
  it('scans a non-empty production source set (guards a silently empty scan)', () => {
    expect(productionFiles.length).toBeGreaterThan(5);
  });

  it('has at least one envelope-forwarding site — else class (b) is imaginary', () => {
    // If nobody forwards, ENVELOPE_FORWARDED is dead metadata and ok/error
    // would silently become orphans. Keep the assumption load-bearing.
    expect(forwardingSites().length).toBeGreaterThan(0);
  });

  it('every exit code is produced, envelope-forwarded, or a tracked exception', () => {
    const orphans: string[] = [];
    const report: string[] = [];

    for (const code of AGENT_STREAM_EXITS) {
      const producers = producersFor(code);
      if (producers.length > 0) {
        report.push(`  ${code}: IN_HUB_PRODUCED (${producers.length}) — ${producers[0]}`);
      } else if ((ENVELOPE_FORWARDED as readonly string[]).includes(code)) {
        report.push(`  ${code}: ENVELOPE_FORWARDED — no in-hub assignment, by design`);
      } else if (code in KNOWN_UNREACHABLE) {
        report.push(`  ${code}: UNREACHABLE (tracked debt -> ${KNOWN_UNREACHABLE[code]})`);
      } else {
        orphans.push(code);
      }
    }

    // Always emit: a silent audit is worth nothing.
    console.log('R401.3 exit reachability audit:\n' + report.join('\n'));

    expect(
      orphans,
      'Exit code(s) with no producer and no tracked exception. Implement a producer, or ' +
        'record them in KNOWN_UNREACHABLE with the ladder item that will close them.',
    ).toEqual([]);
  });

  it('KNOWN_UNREACHABLE holds no stale entries (a stale entry disarms the gate)', () => {
    const stale = Object.keys(KNOWN_UNREACHABLE).filter(
      (c) => !(AGENT_STREAM_EXITS as readonly string[]).includes(c) || producersFor(c).length > 0,
    );
    expect(stale, 'Remove these — the code was deleted or now has a producer.').toEqual([]);
  });

  it('ok and error are forwarded, not orphaned (the two codes that must never regress)', () => {
    expect(AGENT_STREAM_EXITS).toContain('ok');
    expect(AGENT_STREAM_EXITS).toContain('error');
    expect(KNOWN_UNREACHABLE.ok).toBeUndefined();
    expect(KNOWN_UNREACHABLE.error).toBeUndefined();
    expect(ENVELOPE_FORWARDED).toEqual(expect.arrayContaining(['ok', 'error']));
  });
});
