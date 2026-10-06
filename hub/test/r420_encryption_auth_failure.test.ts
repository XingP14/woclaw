/**
 * R420 — the encryption plane: what happens when authenticated decryption fails.
 *
 * R407–R419 audited the memory plane's access paths, TTL mirror, graph copy,
 * and the federation receive channel. This suite audits a different surface:
 * hub/src/crypto.ts and the three production call sites in db.ts that decide
 * what a caller receives when GCM authentication fails.
 *
 * Every assertion here was derived by executing the production code, not by
 * reading it. Where a probe and a comment disagree, the probe wins.
 */
import { describe, it, expect } from 'vitest';
import {
  createEncryption,
  serializeEncrypted,
  deserializeEncrypted,
  encryptAndSerialize,
  safeDecryptValue,
  deserializeAndDecrypt,
} from '../src/crypto.js';

const PASS = 'correct horse battery staple';

function provider(passphrase = PASS) {
  return createEncryption({ passphrase, enabled: true });
}

/** Flip one byte of the base64 ciphertext, leaving salt/iv/tag intact. */
function tamperCiphertext(serialized: string): string {
  const marker = 'ENC:v1:';
  const parsed = JSON.parse(
    Buffer.from(serialized.slice(marker.length), 'base64').toString('utf8'),
  ) as { ciphertext: string };
  const buf = Buffer.from(parsed.ciphertext, 'base64');
  buf[0] = buf[0] ^ 0xff;
  parsed.ciphertext = buf.toString('base64');
  return marker + Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64');
}

describe('R420 P1: the cipher authenticates, and the only production caller discards it', () => {
  it('P1a — deserializeAndDecrypt THROWS on a flipped ciphertext byte (GCM works)', () => {
    const enc = provider();
    const good = encryptAndSerialize('the original secret', enc);
    const bad = tamperCiphertext(good);
    expect(bad).not.toBe(good);
    // The crypto layer does detect it.
    expect(() => deserializeAndDecrypt(bad, enc)).toThrow();
  });

  it('P1b ⭐ — safeDecryptValue returns the tampered CIPHERTEXT as if it were the value', () => {
    const enc = provider();
    const good = encryptAndSerialize('the original secret', enc);
    const bad = tamperCiphertext(good);

    const returned = safeDecryptValue(bad, enc);

    // It is not the plaintext ...
    expect(returned).not.toBe('the original secret');
    // ... and it is not undefined / an error / a sentinel either.
    // The stored ciphertext string, verbatim, becomes the caller's value.
    expect(returned).toBe(bad);
    expect(returned.startsWith('ENC:v1:')).toBe(true);
    expect(deserializeEncrypted(returned)).toBeDefined();
  });

  it('P1c — a second round is stable: the garbage is re-returned, not escalated', () => {
    const enc = provider();
    const bad = tamperCiphertext(encryptAndSerialize('secret', enc));
    const once = safeDecryptValue(bad, enc);
    expect(safeDecryptValue(once, enc)).toBe(once);
  });
});

describe('R420 P2: three distinct failures are one indistinguishable return value', () => {
  it('P2a — wrong passphrase, tampered bytes, and disabled-provider all look the same', () => {
    const stored = encryptAndSerialize('secret', provider());

    const tamperedStored = tamperCiphertext(stored);
    const wrongPassphrase = safeDecryptValue(stored, provider('a completely different passphrase'));
    const tampered = safeDecryptValue(tamperedStored, provider());
    const encryptionOff = safeDecryptValue(stored, createEncryption({ passphrase: PASS, enabled: false }));

    // Three operationally distinct worlds — misconfiguration, active tampering,
    // and a config toggle — are each echoed back verbatim to the caller, so the
    // caller cannot tell them apart from the value it passed in.
    expect(wrongPassphrase).toBe(stored);
    expect(tampered).toBe(tamperedStored);
    expect(encryptionOff).toBe(stored);
    // In every case the observable is "the string I just handed you, unchanged".
    const echoed = [wrongPassphrase, tampered, encryptionOff];
    const handedIn = [stored, tamperedStored, stored];
    expect(echoed).toEqual(handedIn);
  });

  it('P2b — a passphrase rotation is a silent total loss, not an error', () => {
    const stored = encryptAndSerialize('irreplaceable', provider());
    // Operator rotates the passphrase. Every row becomes unreadable.
    const afterRotation = safeDecryptValue(stored, provider('rotated passphrase'));
    expect(afterRotation).toBe(stored);
    // There is no field, return value, or callback anywhere that says so.
    expect(typeof afterRotation).toBe('string');
  });
});

describe('R420 P3: the value that reaches the agent is the encrypted envelope', () => {
  it('P3a — the returned string still parses as a payload, so downstream cannot tell', () => {
    const enc = provider();
    const bad = tamperCiphertext(encryptAndSerialize('secret', enc));
    const returned = safeDecryptValue(bad, enc);
    // A consumer doing isEncrypted() sees an encrypted value and would
    // reasonably conclude the row is fine and simply not decrypt it twice.
    expect(enc.isEncrypted(returned)).toBe(true);
    expect(deserializeEncrypted(returned)?.version).toBe(1);
  });

  it('P3b — serialize/deserialize round-trip is unaffected by all of the above', () => {
    // Establishes that the finding is about failure handling, not about the
    // serialization format: the happy path is sound and pinned elsewhere.
    const enc = provider();
    const s = encryptAndSerialize('round trip', enc);
    expect(deserializeAndDecrypt(s, enc)).toBe('round trip');
    expect(deserializeEncrypted('not encrypted')).toBeUndefined();
    const p = enc.encrypt('x');
    expect(deserializeEncrypted(serializeEncrypted(p))).toEqual(p);
  });
});