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
