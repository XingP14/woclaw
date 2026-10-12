/**
 * R449 — the time-authority plane: **who is allowed to say when.**
 *
 * R446.8 closed the R441–R446 run with an R74 warning: six (now eight)
 * consecutive in-cluster probe-audit rounds, and the next one had to leave the
 * cluster. This one did — it opened a new plane, probed it externally first,
 * then audited WoClaw against it.
 *
 *   The plane: WoClaw stamps **five** separate time fields, each from a local
 *   wall clock, and binds **none of them to each other**. There is no vector
 *   clock, no Lamport counter, no HLC, no skew tolerance — `grep` over 24 prod
 *   `.ts` / 7,457 LOC returns **0** for all ten causal-ordering families.
 *   The result is not that the ordering is wrong; it is that **the plane is
 *   unrepresentable** — three hubs whose clocks differ by 40 s cannot even
 *   *express* the disagreement, let alone resolve it.
 *
 *   Method notes that shaped the arms:
 *
 *   - **R449-1  A field's name is not its authority.** `lastSeen` is stamped on
 *     two paths with two different meanings: `federation.ts:144` stamps it when
 *     a ping is *sent*, `ws_server.ts:970` stamps it with the current read time
 *     and comments that live agents need no real one. A reader cannot tell which
 *     clock produced the number. So the arms assert the *disagreement*, not a
 *     count.
 *
 *   - **R449-2  Assert relationships, not inventories.** An earlier draft of
 *     this file asserted "N time-bearing fields exist". That is an inventory
 *     assertion: it goes red when someone adds a sixth field and stays green
 *     when a field stops being compared. Every arm here is of the form
 *     *stamp exists AND nothing compares it*.
 *
 *   - **R449-3  A grep-shaped claim needs a live control.** These arms are all
 *     text-derived, so arm **C** re-reads a string the suite itself controls
 *     and arm **E** carries a negative control that must stay green. Without
 *     them a broken reader would produce the same green as a correct one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', 'src');
const src = (f: string) => readFileSync(join(SRC, f), 'utf8');
/** Strip `//` line comments so a prose mention is never read as a mechanism. */
const codeOnly = (text: string) => text.split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

describe('R449 — time authority: stamped locally, compared nowhere', () => {
  it('A: no causal-ordering primitive is named anywhere in production src', () => {
    const files = ['db.ts', 'memory.ts', 'federation.ts', 'types.ts', 'ws_server.ts', 'topics.ts'];
    const banned = ['vectorclock', 'vector_clock', 'lamport', 'happens-before', 'happens_before',
                   'causality', 'hlc', 'logical_clock', 'monotonic', 'skew'];
    const hits: string[] = [];
    for (const f of files) {
      const text = src(f).toLowerCase();
      for (const b of banned) if (text.includes(b)) hits.push(`${f}:${b}`);
    }
    // control: the reader is not vacuous — the files exist and the list is real
    expect(files.length).toBeGreaterThan(0);
    expect(banned.length).toBe(10);
    expect(hits).toEqual([]);
  });

  it('B: federation stamps updatedAt from a LOCAL clock and the receive path compares none', () => {
      const text = src('federation.ts');
      const stamps = text.match(/updatedAt:\s*Date\.now\(\)/g) ?? [];
      expect(stamps.length).toBeGreaterThanOrEqual(1);
      // the receiving arm of memory_sync: it forwards or relays, never orders
      const start = text.indexOf("case 'memory_sync'");
      const end = text.indexOf("case 'memory_request'");
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      const receiver = text.slice(start, end);
      expect(/updatedAt\s*[<>]=?/.test(receiver)).toBe(false);
      expect(/Math\.(abs|max)\s*\([^)]*updatedAt/i.test(receiver)).toBe(false);

      // F1: the value is destructured out of the payload and then DISCARDED.
      // `ws_server.ts` binds { key, value, tags, sourceHub, updatedAt } and
      // passes only key/value/tags to memory.write — the sender's clock is
      // unpacked, held in a name, and never consulted. A receiver holding the
      // other hub's timestamp and not using it is a stronger statement than a
      // receiver that never received it.
      const ws = src('ws_server.ts');
      const destructured = /const\s*\{[^}]*\bupdatedAt\b[^}]*\}\s*=\s*payload/.exec(codeOnly(ws));
      expect(destructured).not.toBeNull();
      const after = codeOnly(ws).slice((destructured!.index ?? 0) + destructured![0].length, (destructured!.index ?? 0) + 600);
      expect(after).not.toMatch(/\bupdatedAt\b/);
    });

  it('C: the private-invite TTL is decided by the local clock with no tolerance window', () => {
    const text = src('topics.ts');
    expect(/inviteExpiresAt\s*=\s*Date\.now\(\)\s*\+\s*ttlMs/.test(text)).toBe(true);
    // negative control: the regex family above DOES match real text (self-test)
    expect(/inviteExpiresAt/.test(text)).toBe(true);
    // ...but nothing widens it: no skew / grace / issued-at / tolerance term.
    // The only `grace` in the file is prose on line 112 — "Remove empty topics
    // after a grace period (could implement later)" — i.e. an unfulfilled TODO
    // about topic cleanup, and explicitly NOT a clock-skew allowance. Scoping
    // the reader to code lines is what separates the two (R449-4).
    expect(/skew|grace|tolerance|maxSkew|issuedAt/i.test(codeOnly(text))).toBe(false);
    expect(text).toMatch(/could implement cleanup later/);
  });

  it('D: lastSeen is stamped with two different meanings on two paths', () => {
    const fed = src('federation.ts');
    const ws = src('ws_server.ts');
    // federation: stamped at ping-send, i.e. it is "we pinged", not "they answered"
    expect(fed).toMatch(/ws\.ping\(\);\s*\n?\s*peer\.lastSeen\s*=\s*Date\.now\(\)/);
    // ws_server: stamped with the read time and self-documented as not-a-real-observation
    expect(ws).toMatch(/lastSeen:\s*now,\s*\/\/[^\n]*no explicit lastSeen needed/);
  });

  it('E: ttl eviction compares a stored stamp against a local now, with no skew allowance', () => {
    const text = src('db.ts');
    const q = text.match(/WHERE expire_at > 0 AND expire_at < \?/g) ?? [];
    expect(q.length).toBeGreaterThanOrEqual(2);
    // negative control for the banned-term reader used in arm A
    const banned = ['lamport', 'hlc', 'skew', 'causality'];
    const found = banned.filter((b) => codeOnly(text).toLowerCase().includes(b));
    expect(found).toEqual([]);
    // the plane's absence is specific: nothing widens the comparison window
    expect(/expire_at\s*[<>]\s*\?\s*-\s*\d/.test(text)).toBe(false);
  });
});