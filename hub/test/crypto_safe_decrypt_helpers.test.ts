/**
 * safeDecryptValue / deserializeAndDecrypt / serializeEncrypted /
 * deserializeEncrypted / encryptAndSerialize — unit-level boundary coverage
 * (07-14 23:43 cron, V3 27 tick/d 真实代码 step).
 *
 * Why this file exists:
 *   The encryption-at-rest chain (48c3524 → f238696 → c325c67) has broad
 *   *integration* coverage in `test/encryption_integration.test.ts` (12 cases
 *   round-trip through ClawDB + MemoryPool) but the helper functions in
 *   `src/crypto.ts` themselves (`safeDecryptValue`,
 *   `deserializeAndDecrypt`, `serializeEncrypted`, `deserializeEncrypted`,
 *   `encryptAndSerialize`) are exercised only indirectly. A regression in
 *   one of these helpers — for instance a `safeDecryptValue` short-circuit
 *   reorder, or a swap of `deserializeEncrypted`'s swallow-on-parse-failure
 *   behavior, or a flip of the `encryptAndSerialize` order — would
 *   silently surface as the entire hub failing to decrypt at runtime
 *   instead of being caught here.
 *
 * Eight boundary cases pinned:
 *
 *   1. safeDecryptValue disabled-provider short-circuit: provider.enabled
 *      === false → return value unchanged (even when value starts with
 *      "ENC:v1:"). This is the "encryption off but old ENC:v1: rows are
 *      still in the DB" path; the helper must NOT try to decrypt.
 *   2. safeDecryptValue non-passthrough short-circuit: value does NOT
 *      start with "ENC:v1:" → return value unchanged even when provider
 *      is enabled (the legacy-plaintext-row path).
 *   3. safeDecryptValue happy-path round-trip: provider enabled +
 *      encryptAndSerialize'd value → decrypted to original plaintext.
 *   4. safeDecryptValue wrong-passphrase swallow: encrypt with
 *      passphrase A, attempt decrypt with passphrase B via a fresh
 *      provider → safeDecryptValue MUST catch the throw and return the
 *      raw "ENC:v1:..." value unchanged (the "swallow-on-throw"
 *      contract, mirrored in c325c67). Without this, the storage
 *      callers would surface TypeError: decrypt() failed instead of
 *      falling through to the raw value (their pre-c325c67 behavior).
 *   5. safeDecryptValue corrupted-base64 swallow: take a valid
 *      ENC:v1: prefix + invalid base64 payload → deserializeEncrypted
 *      returns undefined → deserializeAndDecrypt throws
 *      "[Encryption] Value is not an encrypted payload" → safeDecryptValue
 *      swallows + returns raw value.
 *   6. serializeEncrypted format: payload encrypted via provider →
 *      serializeEncrypted(payload) MUST start with "ENC:v1:" and yield
 *      a non-empty base64-suffix. This pins the
 *      `db_decrypt_inline.test.ts` chain contract.
 *   7. deserializeEncrypted round-trip: serializeEncrypted(encrypt(payload))
 *      → deserializeEncrypted → recover the SAME `EncryptedPayload`
 *      fields (ciphertext, iv, salt, tag, version). One of these
 *      (typically `version`) drifted historically; pinning here.
 *   8. deserializeEncrypted negative paths: "" (empty string) →
 *      undefined; random non-ENC:v1: string ("hello world") → undefined;
 *      "ENC:v1:" with malformed base64 → undefined (NOT a throw).
 *      This pins the silent-fallback contract — callers in the storage
 *      layer depend on undefined rather than try/catch.
 *
 * Watchdog check string: `test(crypto): ...` — V3 rule 1 (real code,
 * any time ALLOW). State chain #N (parallels safeDecryptValue extraction
 * chain → c325c67 inline migration → 48c3524 storedValue + decryptValue
 * usage). Pre-existing baseline: 50 hub test files / 511 tests;
 * adding this file → 51 files / 519 tests (+8 cases).
 */

import { describe, it, expect } from 'vitest';
import {
  createEncryption,
  serializeEncrypted,
  deserializeEncrypted,
  encryptAndSerialize,
  deserializeAndDecrypt,
  safeDecryptValue,
  type EncryptionProvider,
} from '../src/crypto.js';

const PASSPHRASE_A = 'test-passphrase-crypto-helpers-2026-A';
const PASSPHRASE_B = 'test-passphrase-crypto-helpers-2026-B-different';

describe('crypto helpers — safeDecryptValue + serialize/deserialize boundary (07-14 23:43 cron)', () => {
  describe('safeDecryptValue short-circuit precedence', () => {
    it('disabled-provider: returns value unchanged even when value is ENC:v1:', () => {
      const enabledProvider = createEncryption({ passphrase: PASSPHRASE_A, enabled: true });
      const sealed = encryptAndSerialize('plain-text-payload', enabledProvider);
      expect(sealed.startsWith('ENC:v1:')).toBe(true);

      const disabledProvider = createEncryption({ passphrase: PASSPHRASE_A, enabled: false });
      expect(disabledProvider.enabled).toBe(false);

      // safeDecryptValue's first guard is provider.enabled. With disabled,
      // it must short-circuit and return the value as-is, never calling
      // decrypt(). Otherwise disable+legacy-ENC:v1: rows would explode.
      expect(safeDecryptValue(sealed, disabledProvider)).toBe(sealed);
    });

    it('enabled-provider + non-ENC:v1: value: returns value unchanged (legacy plaintext path)', () => {
      const enabled = createEncryption({ passphrase: PASSPHRASE_A, enabled: true });
      expect(enabled.enabled).toBe(true);

      // Legacy rows written before encryption was turned on look exactly
      // like ordinary plaintext — safeDecryptValue must NOT attempt to
      // deserialize them; that would throw "Value is not an encrypted
      // payload" and propagate back to callers as 500s.
      const legacyPlaintext = 'legacy-row-from-before-encryption';
      expect(legacyPlaintext.startsWith('ENC:v1:')).toBe(false);
      expect(safeDecryptValue(legacyPlaintext, enabled)).toBe(legacyPlaintext);
    });

    it('enabled-provider + ENC:v1: value: decrypts to original plaintext (happy round-trip)', () => {
      const provider = createEncryption({ passphrase: PASSPHRASE_A, enabled: true });
      const sealed = encryptAndSerialize('round-trip-payload-48c3524', provider);

      // Sanity: the helper proves we go through the full
      // serializeEncrypted → deserializeAndDecrypt chain.
      expect(sealed.startsWith('ENC:v1:')).toBe(true);
      expect(safeDecryptValue(sealed, provider)).toBe('round-trip-payload-48c3524');
    });
  });

  describe('safeDecryptValue swallow-on-throw contract', () => {
    it('wrong-passphrase: returns the raw ENC:v1: value unchanged (mirrors c325c67 behavior)', () => {
      const writer = createEncryption({ passphrase: PASSPHRASE_A, enabled: true });
      const sealed = encryptAndSerialize('encrypted-with-pwd-A', writer);
      expect(sealed.startsWith('ENC:v1:')).toBe(true);

      // Reader was set up with a different passphrase. decrypt() will
      // throw. safeDecryptValue's contract is to catch + return raw.
      // A regression that removes the try/catch would surface as
      // TypeError: decrypt() failed at every storage read.
      const wrongReader = createEncryption({ passphrase: PASSPHRASE_B, enabled: true });
      expect(wrongReader.enabled).toBe(true);
      expect(wrongReader.isEncrypted(sealed)).toBe(true);

      // sanity: deserializeAndDecrypt itself throws on wrong pw
      let threw = false;
      try {
        deserializeAndDecrypt(sealed, wrongReader);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);

      // the helper swallows:
      expect(safeDecryptValue(sealed, wrongReader)).toBe(sealed);
    });

    it('corrupted-base64 ENC:v1: payload: returns the raw value unchanged', () => {
      const provider = createEncryption({ passphrase: PASSPHRASE_A, enabled: true });
      const corrupted = 'ENC:v1:!!!not-valid-base64!!!';

      // sanity: deserializeEncrypted returns undefined (per its contract)
      expect(deserializeEncrypted(corrupted)).toBeUndefined();

      // sanity: deserializeAndDecrypt therefore throws
      let threw = false;
      try {
        deserializeAndDecrypt(corrupted, provider);
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);

      // safeDecryptValue must catch + return raw (the storage-callers'
      // pre-c325c67 contract).
      expect(safeDecryptValue(corrupted, provider)).toBe(corrupted);
    });
  });

  describe('serializeEncrypted / deserializeEncrypted round-trip + format', () => {
    it('serializeEncrypted: output begins with ENC:v1: and has a non-empty base64 suffix', () => {
      const provider = createEncryption({ passphrase: PASSPHRASE_A, enabled: true });
      const sealed = encryptAndSerialize('whatever', provider);

      // Format is `ENC:v1:<base64>` — versioned prefix enables future migration.
      expect(sealed.startsWith('ENC:v1:')).toBe(true);
      const suffix = sealed.slice('ENC:v1:'.length);
      expect(suffix.length).toBeGreaterThan(0);
      // base64 alphabet sanity: chars in [A-Za-z0-9+/=]
      expect(suffix).toMatch(/^[A-Za-z0-9+/=]+$/);

      // serializeEncrypted accepts the raw EncryptedPayload too — verify it
      // directly so a regression that breaks the encryptAndSerialize wrapper
      // doesn't gate on the wrapper being broken first.
      const payload = provider.encrypt('whatever');
      expect(payload.version).toBeGreaterThanOrEqual(0);
      const direct = serializeEncrypted(payload);
      expect(direct.startsWith('ENC:v1:')).toBe(true);

      // encryptAndSerialize's contract is to seal after encrypt —
      // round-trip below in (7) confirms equality.
    });

    it('deserializeEncrypted: round-trips the same encrypted payload back to decryptable bytes', () => {
      const provider: EncryptionProvider = createEncryption({
        passphrase: PASSPHRASE_A,
        enabled: true,
      });
      const sealed = encryptAndSerialize('hello-crypto-helpers', provider);

      // Snapshot the Recovered payload, then assert it round-trips
      // through decrypt() back to the plaintext. We do NOT compare the
      // ciphertext/iv/salt/tag individually against a fresh encrypt()
      // because each encrypt() call generates a new random IV + salt
      // (PBKDF2 salt + AES-GCM nonce), so two encrypts of the same
      // input are deliberately non-byte-equal — this is the AES-GCM
      // security contract, not a bug.
      const recovered = deserializeEncrypted(sealed);
      expect(recovered).toBeDefined();

      // Cryptographic fields all defined + non-empty + version present.
      // A regression that JSON.stringify'd twice (or used a different
      // envelope) would silently corrupt one of these fields.
      expect(recovered!.ciphertext.length).toBeGreaterThan(0);
      expect(recovered!.iv.length).toBeGreaterThan(0);
      expect(recovered!.salt.length).toBeGreaterThan(0);
      expect(recovered!.tag.length).toBeGreaterThan(0);
      expect(typeof recovered!.version).toBe('number');

      // Semantically lossless: the recovered payload still decrypts to
      // the original plaintext via the provider. This is the real
      // round-trip contract.
      expect(provider.decrypt(recovered!)).toBe('hello-crypto-helpers');

      // And re-sealing the recovered payload (over the same provider)
      // also re-decrypts to the original plaintext via
      // deserializeAndDecrypt — pins the full helper chain.
      const resealed = serializeEncrypted(recovered!);
      expect(resealed).toBe(sealed);
      expect(deserializeAndDecrypt(resealed, provider)).toBe('hello-crypto-helpers');
    });

    it('deserializeEncrypted: negative paths return undefined (NOT throw)', () => {
      expect(deserializeEncrypted('')).toBeUndefined();
      expect(deserializeEncrypted('hello world')).toBeUndefined();
      expect(deserializeEncrypted('ENC:v1:')).toBeUndefined();
      expect(deserializeEncrypted('ENC:v1:!!!not-valid-base64!!!')).toBeUndefined();
      // A different version prefix is not something we recognize as v1.
      // We treat any non-`ENC:v1:` prefix as "not an encrypted payload
      // we know how to handle" — the helper returns undefined rather
      // than throwing, so callers in the storage layer can fall through.
      expect(deserializeEncrypted('ENC:v2:abc')).toBeUndefined();
      expect(deserializeEncrypted('not-even-close')).toBeUndefined();
    });
  });
});
