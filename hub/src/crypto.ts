/**
 * Memory Encryption at Rest — Application-level AES-256-GCM encryption
 * 
 * Design decisions:
 * - Uses Node.js built-in `crypto` (no native deps like SQLCipher)
 * - AES-256-GCM for authenticated encryption (confidentiality + integrity)
 * - PBKDF2 for key derivation (slow by design to resist brute force)
 * - Per-value random IV/nonce (12 bytes) stored alongside ciphertext
 * - Salt stored alongside ciphertext for key derivation verification
 * 
 * Flow:
 *   encrypt(plaintext, passphrase) → { ciphertext, iv, salt, tag }
 *   decrypt({ ciphertext, iv, salt, tag }, passphrase) → plaintext
 */

import { randomBytes, createCipheriv, createDecipheriv, createHash, pbkdf2Sync } from 'crypto';

// --- Types ---

export interface EncryptedPayload {
  /** AES-256-GCM ciphertext (base64) */
  ciphertext: string;
  /** 12-byte random IV/nonce (base64) */
  iv: string;
  /** 16-byte salt for PBKDF2 (base64) */
  salt: string;
  /** GCM authentication tag (base64) */
  tag: string;
  /** Encryption version for future migration */
  version: number;
}

export interface EncryptionProvider {
  /** Check if encryption is enabled */
  readonly enabled: boolean;
  /** Encrypt plaintext string → EncryptedPayload */
  encrypt(plaintext: string): EncryptedPayload;
  /** Decrypt EncryptedPayload → plaintext string */
  decrypt(payload: EncryptedPayload): string;
  /** Quick check: is this value already encrypted? */
  isEncrypted(value: string): boolean;
}

export interface EncryptionConfig {
  /** Passphrase for key derivation */
  passphrase: string;
  /** Whether encryption is enabled (default: false) */
  enabled?: boolean;
}

// --- Constants ---

const CURRENT_VERSION = 1;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 32; // 256 bits
const PBKDF2_ITERATIONS = 100_000;
const ENCRYPTION_MARKER = 'ENC:v1:';

// --- Key Derivation ---

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512');
}

// --- Core Encryption/Decryption ---

function encryptValue(plaintext: string, passphrase: string): EncryptedPayload {
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(passphrase, salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    salt: salt.toString('base64'),
    tag: tag.toString('base64'),
    version: CURRENT_VERSION,
  };
}

function decryptValue(payload: EncryptedPayload, passphrase: string): string {
  const salt = Buffer.from(payload.salt, 'base64');
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');

  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

// --- Factory ---

export function createEncryption(config: EncryptionConfig): EncryptionProvider {
  const { passphrase, enabled = false } = config;

  if (enabled && (!passphrase || passphrase.length < 8)) {
    throw new Error('[Encryption] Passphrase must be at least 8 characters when encryption is enabled');
  }

  return {
    get enabled() {
      return enabled;
    },

    encrypt(plaintext: string): EncryptedPayload {
      if (!enabled) {
        throw new Error('[Encryption] Encryption is disabled');
      }
      return encryptValue(plaintext, passphrase);
    },

    decrypt(payload: EncryptedPayload): string {
      if (!enabled) {
        throw new Error('[Encryption] Encryption is disabled');
      }
      return decryptValue(payload, passphrase);
    },

    isEncrypted(value: string): boolean {
      return value.startsWith(ENCRYPTION_MARKER);
    },
  };
}

// --- Utility: Serialize/Deserialize EncryptedPayload ---

/**
 * Serialize EncryptedPayload to a compact string for storage in SQLite TEXT column.
 * Format: ENC:v1:<base64(salt+iv+tag+ciphertext)>
 * The version prefix enables future migration without parsing.
 */
export function serializeEncrypted(payload: EncryptedPayload): string {
  const combined = Buffer.from(JSON.stringify(payload), 'utf8');
  return `${ENCRYPTION_MARKER}${combined.toString('base64')}`;
}

/**
 * Deserialize compact string back to EncryptedPayload.
 * Returns undefined if the string is not an encrypted payload.
 */
export function deserializeEncrypted(value: string): EncryptedPayload | undefined {
  if (!value.startsWith(ENCRYPTION_MARKER)) {
    return undefined;
  }
  const base64 = value.slice(ENCRYPTION_MARKER.length);
  try {
    const combined = Buffer.from(base64, 'base64');
    return JSON.parse(combined.toString('utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Convenience: encrypt a string and return the compact serialized form.
 */
export function encryptAndSerialize(plaintext: string, provider: EncryptionProvider): string {
  const payload = provider.encrypt(plaintext);
  return serializeEncrypted(payload);
}

/**
 * Convenience: deserialize and decrypt a compact string.
 */
export function deserializeAndDecrypt(value: string, provider: EncryptionProvider): string {
  const payload = deserializeEncrypted(value);
  if (!payload) {
    throw new Error('[Encryption] Value is not an encrypted payload');
  }
  return provider.decrypt(payload);
}
