import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { createEncryption } from '../src/crypto.js';

/**
 * R471 — a duration/threshold literal in a user-facing error message is a LOCK
 * on that literal, not coverage of the guard that computes it.
 *
 * Sibling finding in llm-benchmark R470: fetchWithTimeout's timeoutMs has zero
 * production reach and its message ignores it, while an existing test pins the
 * misleading message. That one was UNREACHABLE. woclaw's copy of the class is
 * REACHABLE, which makes it a strictly better subject: the number is real, and
 * the question is who is responsible for it.
 *
 * crypto.ts:113
 *   if (enabled && (!passphrase || passphrase.length < 8))
 *     throw new Error('[Encryption] Passphrase must be at least 8 characters ...')
 *
 * The `8` is written THREE times, independently, with no shared constant:
 *   1. the guard      crypto.ts:113  `passphrase.length < 8`
 *   2. the message    crypto.ts:113  `'... at least 8 characters ...'`
 *   3. the doc        types.ts:21    `// ... (min 8 chars when enabled)`
 *
 * Nothing enforces agreement between them. Raising the guard to 16 without
 * editing the message yields a provider that REJECTS a valid 12-char passphrase
 * while telling the operator the minimum is 8 — and every existing test still
 * passes, because all three pinning tests assert the MESSAGE and none of them
 * ever constructs a passphrase at the boundary.
 */

const CRYPTO_SRC = readFileSync(new URL('../src/crypto.ts', import.meta.url), 'utf8');
const TYPES_SRC = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8');
const GUARD_LINE = 113;

describe('R471 — the passphrase threshold is stated three times and bound by none of them', () => {
  describe('A. ARITY / OCCURRENCE CENSUS — how many times does the 8 exist?', () => {
    it('A1 — the guard, the message and the doc each carry their own literal 8', () => {
      const guard = CRYPTO_SRC.match(/passphrase\.length < (\d+)/);
      expect(guard).not.toBeNull();
      expect(guard![1]).toBe('8');

      const message = CRYPTO_SRC.match(/at least (\d+) characters/);
      expect(message).not.toBeNull();
      expect(message![1]).toBe('8');

      expect(TYPES_SRC).toMatch(/min 8 chars/);
    });

    it('A2 — NEGATIVE CONTROL: no shared named constant exists to drift from', () => {
      // crypto.ts names every other magic number it owns (CURRENT_VERSION,
      // SALT_LENGTH, IV_LENGTH, KEY_LENGTH, PBKDF2_ITERATIONS). The threshold
      // is the one number in the file with no name.
      const named = [...CRYPTO_SRC.matchAll(/^const ([A-Z_0-9]+) = /gm)].map((m) => m[1]);
      expect(named).toEqual(
        expect.arrayContaining(['CURRENT_VERSION', 'SALT_LENGTH', 'IV_LENGTH', 'KEY_LENGTH']),
      );
      expect(named.filter((n) => /PASS|MIN|THRESH|LEN_8/i.test(n))).toEqual([]);
    });
  });

  describe('B. REACH CENSUS — is the 8 the literal, or a coincidence?', () => {
    it('B1 — the number is REACHABLE and load-bearing, unlike the sibling case', () => {
      // The contrast with llm-benchmark R470: there, the literal was correct by
      // coincidence because nothing overrode the default. Here 8 IS the bound
      // and every accepted-or-rejected passphrase is decided by it.
      expect(() => createEncryption({ passphrase: 'a'.repeat(7), enabled: true })).toThrow(
        /at least 8 characters/,
      );
      expect(() => createEncryption({ passphrase: 'a'.repeat(8), enabled: true })).not.toThrow();
    });

    it('B2 — the boundary is a hard cliff, not a gradient', () => {
      // 7 rejected, 8 accepted. Any operator reading "at least 8" and typing a
      // 7-char passphrase gets the documented message; any operator typing 8
      // gets nothing at all — no warning that they are one character from the
      // floor.
      let thrown = '';
      try {
        createEncryption({ passphrase: 'a'.repeat(7), enabled: true });
      } catch (e) {
        thrown = (e as Error).message;
      }
      expect(thrown).toContain('at least 8 characters');
    });
  });

  describe('C. PIN CENSUS — what do the existing tests actually pin?', () => {
    it('C1 — the message is pinned three times; the THRESHOLD is pinned zero times', () => {
      // This is the R470 lesson applied to a reachable subject. If the suite
      // pinned the guard, this file would be coverage. It pins the message.
      // A real census, not a self-referential placeholder: scan every hub test
      // for a passphrase literal sitting exactly ON the boundary. Any such
      // construction would be a test that pins the threshold, and its absence
      // is the finding.
      const testDir = new URL('.', import.meta.url).pathname;
      const boundaryHits: string[] = [];
      for (const f of readdirSync(testDir).filter((n) => n.endsWith('.ts'))) {
        const src = readFileSync(`${testDir}/${f}`, 'utf8');
        for (const m of src.matchAll(/passphrase:\s*'([^']*)'/g)) {
          if (m[1].length === 8) boundaryHits.push(`${f}:${m[1]}`);
        }
      }
      expect(boundaryHits).toEqual([]);

      // Also negative-control the subject-set pin itself: the loop above must
      // be capable of finding something. If `passphrase:` never appears with a
      // string literal at all, the census is vacuous and would "pass" forever.
      let anyPassphraseLiteral = false;
      for (const f of readdirSync(testDir).filter((n) => n.endsWith('.ts'))) {
        if (/passphrase:\s*'[^']*'/.test(readFileSync(`${testDir}/${f}`, 'utf8'))) {
          anyPassphraseLiteral = true;
          break;
        }
      }
      expect(anyPassphraseLiteral).toBe(true);
    });

    it('C2 — a 12-char passphrase is accepted while the message advertises 8', () => {
      // Not a bug today. It is the exact state a threshold bump would create
      // SILENTLY: no test in the repository would go red.
      expect(() => createEncryption({ passphrase: 'a'.repeat(12), enabled: true })).not.toThrow();
    });
  });

  describe('D. THE DEFECT — guard and message are one edit apart and unjoined', () => {
    it('D1 — the reported minimum is a hand-maintained copy of the enforced one', () => {
      // Raising the guard to 16 is a one-character edit (0 -> 6). Nothing in the
      // repository, no test and no constant, forces the message to follow.
      const guardBound = Number(CRYPTO_SRC.match(/passphrase\.length < (\d+)/)![1]);
      const advertisedBound = Number(CRYPTO_SRC.match(/at least (\d+) characters/)![1]);
      expect(guardBound).toBe(advertisedBound);
      // They agree. The suite above is what makes that agreement a coincidence
      // of editing discipline rather than a constraint of the code.
    });

    it('D2 — the doc comment in types.ts is a third, equally unjoined copy', () => {
      // Even a perfect refactor of crypto.ts alone would leave types.ts lying.
      const typesDoc = TYPES_SRC.match(/min (\d+) chars/);
      expect(typesDoc).not.toBeNull();
      expect(Number(typesDoc![1])).toBe(8);
    });
  });
});
