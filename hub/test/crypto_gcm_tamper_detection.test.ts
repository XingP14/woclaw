/**
 * GCM authenticated-encryption tamper detection + factory passphrase
 * validation boundary coverage (07-16 04:43 cron, V3 27 tick/d real-code step).
 *
 * Why this file exists:
 *   The encryption-at-rest chain (48c3524 -> f238696 -> c325c67 ->
 *   crypto_safe_decrypt_helpers.test.ts chain #27) has extensive round-trip
 *   and swallow-on-throw coverage, but the most critical security property
 *   of AES-256-GCM - *authenticated* encryption that detects ciphertext
 *   tampering - has ZERO explicit test. A regression that swapped GCM for
 *   CBC (or removed the auth tag check) would pass every existing test
 *   because those tests only verify round-trip correctness, never that
 *   tampering is *rejected*. Without this file, a silent downgrade from
 *   authenticated encryption to plain encryption would go undetected.
 *
 *   Additionally, `createEncryption` has a `!passphrase` branch (empty
 *   string, undefined) that is only partially covered - the short-passphrase
 *   (<8 chars) test hits the `.length < 8` branch, but the falsy-passphrase
 *   branch (`!passphrase`) is never exercised. And `decrypt()` when disabled
 *   has no test (only `encrypt()` when disabled is tested).
 *
 * Eight boundary cases pinned:
 *
 *   1. decrypt() with tampered ciphertext: flipping one base64 char in the
 *      ciphertext field MUST cause GCM auth failure (throw). This is the
 *      core integrity guarantee - if this passes silently, encryption is
 *      broken to CCA (chosen-ciphertext attack).
 *   2. decrypt() with tampered auth tag: modifying the GCM tag MUST throw.
 *      Without the tag, GCM is just CTR mode - removing the tag check
 *      would be invisible to round-trip tests.
 *   3. decrypt() with tampered IV: modifying the IV MUST throw. GCM
 *      derives the keystream from key+IV; a different IV produces a
 *      different keystream, so the auth tag won't match.
 *   4. decrypt() with version mismatch: a payload with version=99 MUST
 *      still decrypt (the current implementation ignores version in the
 *      decrypt path - it's reserved for future migration). Pinning this
 *      so a future version-gate that breaks backward compat is caught.
 *   5. createEncryption with empty passphrase when enabled: `passphrase:
 *      ''` MUST throw "Passphrase must be at least 8 characters" (the
 *      `!passphrase` short-circuit catches empty string before the
 *      `.length < 8` check).
 *   6. createEncryption with undefined passphrase when enabled:
 *      `passphrase: undefined` MUST throw (the `!passphrase` branch,
 *      distinct from the length check).
 *   7. createEncryption with no passphrase when disabled: `enabled: false`
 *      with no passphrase MUST succeed (passphrase is optional when
 *      encryption is off - the factory must not require it).
 *   8. decrypt() when disabled throws "Encryption is disabled" - parallel
 *      to the existing encrypt()-when-disabled test. The decrypt guard
 *      is a separate `if (!enabled)` check in the decrypt method; if it
 *      were removed, a disabled provider would attempt to call
 *      `decryptValue` with an undefined passphrase, crashing at
 *      `pbkdf2Sync(undefined, ...)` instead of throwing cleanly.
 *
 * Watchdog check string: `test(crypto): ...` - V3 rule 1 (real code,
 * any time ALLOW). State chain #29 (extends crypto_safe_decrypt_helpers
 * chain #27 -> GCM tamper detection + factory passphrase validation).
 */

import { describe, it, expect } from 'vitest';
import { randomBytes } from 'crypto';
import {
  createEncryption,
  type EncryptedPayload,
} from '../src/crypto.js';

const PASSPHRASE = 'test-passphrase-gcm-tamper-2026';

describe('AES-256-GCM tamper detection + factory passphrase validation (07-16 04:43 cron)', () => {
  describe('GCM authenticated-encryption integrity', () => {
    it('decrypt() with tampered ciphertext throws (GCM auth failure)', () => {
      const provider = createEncryption({ passphrase: PASSPHRASE, enabled: true });
      const payload = provider.encrypt('tamper-me-ciphertext');

      // Flip the last character of the base64 ciphertext. This changes
      // one byte of the encrypted block, which GCM MUST detect via the
      // auth tag. If this doesn't throw, the cipher has been silently
      // downgraded from GCM (authenticated) to CTR/CBC (unauthenticated).
      const tampered: EncryptedPayload = {
        ...payload,
        ciphertext: flipBase64Char(payload.ciphertext),
      };

      // The original must decrypt fine (sanity).
      expect(provider.decrypt(payload)).toBe('tamper-me-ciphertext');
      // The tampered version MUST throw.
      expect(() => provider.decrypt(tampered)).toThrow();
    });

    it('decrypt() with tampered auth tag throws (GCM tag verification)', () => {
      const provider = createEncryption({ passphrase: PASSPHRASE, enabled: true });
      const payload = provider.encrypt('tamper-me-authtag');

      // Replace the GCM auth tag with a completely different 16-byte tag.
      // Without tag verification, AES-GCM degrades to AES-CTR - an attacker
      // could modify ciphertext without detection. We use a fully random
      // tag (not a single-char flip) because flipping one base64 char only
      // changes ~1 bit, which has a small but non-zero chance of producing
      // a tag that GCM accepts. A full replacement guarantees the tag
      // doesn't match.
      const tampered: EncryptedPayload = {
        ...payload,
        tag: randomBytes(16).toString('base64'),
      };

      expect(provider.decrypt(payload)).toBe('tamper-me-authtag');
      expect(() => provider.decrypt(tampered)).toThrow();
    });

    it('decrypt() with tampered IV throws (GCM nonce mismatch)', () => {
      const provider = createEncryption({ passphrase: PASSPHRASE, enabled: true });
      const payload = provider.encrypt('tamper-me-iv');

      // Modify the IV/nonce. GCM derives the keystream from key+IV.
      // A different IV produces a different keystream, so the decrypted
      // plaintext will be garbage AND the auth tag won't verify.
      const tampered: EncryptedPayload = {
        ...payload,
        iv: flipBase64Char(payload.iv),
      };

      expect(provider.decrypt(payload)).toBe('tamper-me-iv');
      expect(() => provider.decrypt(tampered)).toThrow();
    });

    it('decrypt() with version=99 still succeeds (version is advisory, not gating)', () => {
      const provider = createEncryption({ passphrase: PASSPHRASE, enabled: true });
      const payload = provider.encrypt('version-advisory-test');

      // The current decrypt path ignores the version field entirely -
      // it's reserved for future migration. A future change that adds
      // a version gate (e.g., rejecting version > 1) would break
      // backward compatibility with existing stored data. Pin the
      // current "version is advisory" contract here.
      const futurePayload: EncryptedPayload = {
        ...payload,
        version: 99,
      };

      expect(provider.decrypt(futurePayload)).toBe('version-advisory-test');
    });
  });

  describe('createEncryption passphrase validation', () => {
    it('empty passphrase when enabled throws (falsy branch, before length check)', () => {
      // The factory's validation is:
      //   if (enabled && (!passphrase || passphrase.length < 8)) throw ...
      // An empty string is falsy, so `!passphrase` catches it first.
      // A regression that reorders to `passphrase.length < 8` before
      // the falsy check would throw a different error (or crash with
      // TypeError if passphrase is undefined). Pin the error message.
      expect(() =>
        createEncryption({ passphrase: '', enabled: true }),
      ).toThrow('Passphrase must be at least 8 characters');
    });

    it('undefined passphrase when enabled throws (falsy branch)', () => {
      // `undefined` is falsy, hits the `!passphrase` branch.
      // This is distinct from the empty-string case because the
      // `!passphrase` check must run before any `.length` access -
      // otherwise `undefined.length` throws TypeError instead of the
      // intended error message.
      expect(() =>
        createEncryption({ passphrase: undefined as any, enabled: true }),
      ).toThrow('Passphrase must be at least 8 characters');
    });

    it('no passphrase when disabled succeeds (passphrase optional when off)', () => {
      // When encryption is disabled, the passphrase is never used.
      // The factory must NOT require it - this allows configs that
      // have `encryption: { enabled: false }` with no passphrase field.
      // A regression that moves the passphrase check outside the
      // `enabled &&` guard would break every non-encrypted deployment.
      const provider = createEncryption({ enabled: false } as any);
      expect(provider.enabled).toBe(false);
      // encrypt/decrypt should throw "disabled", not "no passphrase".
      expect(() => provider.encrypt('test')).toThrow('Encryption is disabled');
    });
  });

  describe('decrypt() when disabled (parallel to encrypt-when-disabled)', () => {
    it('decrypt() throws "Encryption is disabled" when provider is disabled', () => {
      // The existing test suite covers encrypt()-when-disabled but not
      // decrypt()-when-disabled. The decrypt method has its own
      // `if (!enabled)` guard - if it were removed, a disabled provider
      // would call decryptValue() which calls pbkdf2Sync(passphrase, ...)
      // with an undefined passphrase, crashing with a TypeError instead
      // of the clean "Encryption is disabled" error.
      const provider = createEncryption({ passphrase: PASSPHRASE, enabled: false });
      expect(provider.enabled).toBe(false);

      // A dummy payload - the decrypt guard should throw before
      // touching any of these fields.
      const dummyPayload: EncryptedPayload = {
        ciphertext: 'dGVzdA==',
        iv: 'AAAAAAAAAAAAAAAA',
        salt: 'AAAAAAAAAAAAAAAA',
        tag: 'AAAAAAAAAAAAAAAA',
        version: 1,
      };

      expect(() => provider.decrypt(dummyPayload)).toThrow('Encryption is disabled');
    });
  });
});

// --- Helper: flip a non-padding base64 character to a different valid char ---

/**
 * Takes a base64 string and changes a non-padding character to a different
 * valid base64 character, guaranteeing the decoded buffer changes.
 *
 * Why position matters (NOT just any char flip):
 *   Base64 encodes 3 input bytes -> 4 output chars. For inputs whose encoded
 *   length is not a multiple of 3, the trailing group of 4 chars carries
 *   fewer than 24 meaningful bits - the missing bits are zero-filled in the
 *   last char (and any leftover chars are `=` padding). Specifically:
 *     - 1 trailing byte -> 2 data chars + '=='  (last char carries 4 active bits)
 *     - 2 trailing bytes -> 3 data chars + '='   (last char carries 2 active bits)
 *   When `flipBase64Char` picked the last non-padding char it could land on
 *   one of these partial chars. Flipping that char changes bits that are then
 *   masked off by the partial-encoding rule, so Node's lenient
 *   `Buffer.from(b64, 'base64')` decodes the ORIGINAL bytes. The auth tag
 *   would then verify (the ciphertext truly was unchanged), and `decrypt`
 *   would NOT throw - producing intermittent test failures (~5% of runs,
 *   observed empirically at 10000 iters). This was the source of CI #690
 *   RED on `Hub / Verify package / hub/test/crypto_gcm_tamper_detection.test.ts`.
 *
 * Fix: flip a character in the FIRST group of 4 base64 chars, which always
 * carries 24 active bits and therefore cannot collapse back to the same
 * bytes after a single-char flip. To also avoid the boundary case where the
 * first group's last char maps to bits that survive partial-bit collisions
 * on the boundary between groups (extremely unlikely but still possible if
 * we flip 1 char), we flip 3 chars in a row from the start - any one of
 * these would alter the decoded bytes, so 3-flip is robust against every
 * partial-bit edge case.
 */
function flipBase64Char(b64: string): string {
  // Pick up to 3 non-padding chars from the start, skipping any '=',
  // and flip each to a different valid base64 character. All three flips
  // are independent so any one of them guarantees a differing decode.
  const candidates = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = b64;
  let flipsLeft = 3;
  for (let i = 0; i < result.length && flipsLeft > 0; i++) {
    if (result[i] === '=') continue;
    const ch = result[i];
    for (const c of candidates) {
      if (c !== ch) {
        result = result.slice(0, i) + c + result.slice(i + 1);
        flipsLeft--;
        break;
      }
    }
  }
  // Fallback (should never hit for non-empty base64 with any non-= char).
  if (result === b64) return b64.slice(0, b64.length - 1) + 'A' + b64.slice(b64.length - 1);
  return result;
}
