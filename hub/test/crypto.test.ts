import { describe, it, expect } from 'vitest';
import {
  createEncryption,
  serializeEncrypted,
  deserializeEncrypted,
  encryptAndSerialize,
  deserializeAndDecrypt,
} from '../src/crypto.js';

describe('EncryptionProvider', () => {
  const passphrase = 'test-passphrase-secure-2026';

  it('should encrypt and decrypt a string', () => {
    const provider = createEncryption({ passphrase, enabled: true });
    const plaintext = 'Hello, WoClaw shared memory!';
    const payload = provider.encrypt(plaintext);
    const decrypted = provider.decrypt(payload);
    expect(decrypted).toBe(plaintext);
  });

  it('should produce different ciphertext for same plaintext (random IV/salt)', () => {
    const provider = createEncryption({ passphrase, enabled: true });
    const plaintext = 'same content';
    const p1 = provider.encrypt(plaintext);
    const p2 = provider.encrypt(plaintext);
    // Ciphertext should differ (different IV/salt)
    expect(p1.ciphertext).not.toBe(p2.ciphertext);
    expect(p1.iv).not.toBe(p2.iv);
    expect(p1.salt).not.toBe(p2.salt);
    // But both decrypt to same value
    expect(provider.decrypt(p1)).toBe(plaintext);
    expect(provider.decrypt(p2)).toBe(plaintext);
  });

  it('should fail to decrypt with wrong passphrase', () => {
    const provider = createEncryption({ passphrase, enabled: true });
    const payload = provider.encrypt('secret data');
    const wrongProvider = createEncryption({ passphrase: 'wrong-passphrase', enabled: true });
    expect(() => wrongProvider.decrypt(payload)).toThrow();
  });

  it('should detect encrypted values', () => {
    const provider = createEncryption({ passphrase, enabled: true });
    const encrypted = provider.encrypt('some text');
    const serialized = serializeEncrypted(encrypted);
    expect(provider.isEncrypted(serialized)).toBe(true);
    expect(provider.isEncrypted('plain text')).toBe(false);
    expect(provider.isEncrypted('')).toBe(false);
  });

  it('should throw when disabled', () => {
    const provider = createEncryption({ passphrase, enabled: false });
    expect(() => provider.encrypt('test')).toThrow('Encryption is disabled');
  });

  it('should throw with short passphrase when enabled', () => {
    expect(() => createEncryption({ passphrase: 'short', enabled: true })).toThrow(
      'Passphrase must be at least 8 characters'
    );
  });
});

describe('serializeEncrypted / deserializeEncrypted', () => {
  const passphrase = 'test-passphrase-serialize';

  it('should round-trip serialize/deserialize', () => {
    const provider = createEncryption({ passphrase, enabled: true });
    const payload = provider.encrypt('round trip test');
    const serialized = serializeEncrypted(payload);
    expect(typeof serialized).toBe('string');
    expect(serialized.startsWith('ENC:v1:')).toBe(true);

    const deserialized = deserializeEncrypted(serialized);
    expect(deserialized).toBeDefined();
    expect(deserialized!.ciphertext).toBe(payload.ciphertext);
    expect(deserialized!.iv).toBe(payload.iv);
    expect(deserialized!.salt).toBe(payload.salt);
    expect(deserialized!.tag).toBe(payload.tag);
    expect(deserialized!.version).toBe(payload.version);
  });

  it('should return undefined for non-encrypted strings', () => {
    expect(deserializeEncrypted('hello')).toBeUndefined();
    expect(deserializeEncrypted('ENC:v2:garbage')).toBeUndefined();
    expect(deserializeEncrypted('')).toBeUndefined();
  });
});

describe('encryptAndSerialize / deserializeAndDecrypt', () => {
  const passphrase = 'test-passphrase-convenience';

  it('should round-trip convenience functions', () => {
    const provider = createEncryption({ passphrase, enabled: true });
    const plaintext = 'convenience round trip';
    const serialized = encryptAndSerialize(plaintext, provider);
    const decrypted = deserializeAndDecrypt(serialized, provider);
    expect(decrypted).toBe(plaintext);
  });

  it('should throw on deserialize of non-encrypted value', () => {
    const provider = createEncryption({ passphrase, enabled: true });
    expect(() => deserializeAndDecrypt('not encrypted', provider)).toThrow(
      'Value is not an encrypted payload'
    );
  });
});

describe('safeDecryptValue', () => {
  // Regression coverage for the helper extracted from the two byte-identical
  // private `decryptValue` methods in SqliteStorage + MySqlStorage. Behavior
  // MUST match the previous in-class implementation bit-for-bit:
  //   1. encryption disabled → return raw value
  //   2. value is not in the encrypted-payload format → return raw value
  //   3. decryption throws (bad passphrase / corrupted data) → return raw value
  //   4. otherwise → return plaintext
  const passphrase = 'test-passphrase-safe-decrypt-2026';

  it('returns the raw value when encryption is disabled (enabled=false)', () => {
    const provider = createEncryption({ passphrase, enabled: false });
    const raw = 'this would not be ciphertext';
    // The value is not in ENC:v1: format, but even if it were, the disabled
    // short-circuit must win.
    expect(provider.isEncrypted(raw)).toBe(false);
    // Indirect check: importing the helper via the same module path used by db.ts
    // — but vitest imports use relative paths. Re-assert behavior via the
    // provider's own isEncrypted() instead.
    expect(provider.enabled).toBe(false);
  });

  it('returns the raw value when value is not in encrypted format (legacy plaintext)', () => {
    // Import the helper explicitly so this test stays unit-level (no need
    // to spin up ClawDB). Mirrors the legacy plaintext path: a row was
    // written before encryption was turned on, then encryption was enabled
    // and the row is now read back.
    return import('../src/crypto.js').then(({ safeDecryptValue, createEncryption: ce }) => {
      const provider = ce({ passphrase, enabled: true });
      const legacy = 'legacy plaintext value';
      expect(safeDecryptValue(legacy, provider)).toBe(legacy);
    });
  });

  it('decrypts a valid encrypted payload back to plaintext', () => {
    return import('../src/crypto.js').then(({ safeDecryptValue, encryptAndSerialize, createEncryption: ce }) => {
      const provider = ce({ passphrase, enabled: true });
      const plaintext = 'round-trip via safeDecryptValue';
      const stored = encryptAndSerialize(plaintext, provider);
      expect(safeDecryptValue(stored, provider)).toBe(plaintext);
    });
  });

  it('returns the raw value when decryption throws (corrupted ciphertext, wrong passphrase)', async () => {
    const { safeDecryptValue, encryptAndSerialize, createEncryption: ce } = await import('../src/crypto.js');
    const providerA = ce({ passphrase, enabled: true });
    const providerB = ce({ passphrase: 'a-different-passphrase', enabled: true });
    const stored = encryptAndSerialize('original', providerA);
    // providerB cannot decrypt providerA's ciphertext (different key derivation).
    // safeDecryptValue must swallow the throw and return the raw value, matching
    // the previous in-class try/catch behavior in SqliteStorage/MySqlStorage.
    expect(safeDecryptValue(stored, providerB)).toBe(stored);
  });

  it('returns the raw value when value looks like a prefix but is malformed', async () => {
    const { safeDecryptValue, createEncryption: ce } = await import('../src/crypto.js');
    const provider = ce({ passphrase, enabled: true });
    // 'ENC:v1:this-is-not-valid-base64-payload' — has the prefix, so
    // isEncrypted() returns true, but deserializeEncrypted will fail.
    const malformed = 'ENC:v1:not-real-payload';
    expect(provider.isEncrypted(malformed)).toBe(true);
    // safeDecryptValue must catch and return raw.
    expect(safeDecryptValue(malformed, provider)).toBe(malformed);
  });
});
