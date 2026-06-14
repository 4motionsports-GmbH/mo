// At-rest encryption for the Shopify Customer Account OAuth tokens.
//
// Customer access/refresh tokens are stored ONLY server-side (the Neon DB,
// customer_oauth_tokens) and NEVER sent to the browser. On top of that they are
// encrypted at rest with AES-256-GCM under a key from the environment
// (TOKEN_ENC_KEY), so a database leak alone does not yield usable tokens.
//
// Wire format of the stored BYTEA: [ 12-byte IV | 16-byte GCM tag | ciphertext ].
// AES-256-GCM is authenticated, so a tampered blob fails to decrypt rather than
// returning garbage.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const IV_BYTES = 12; // GCM standard nonce size
const TAG_BYTES = 16;
const KEY_BYTES = 32; // AES-256

let cachedKey: Buffer | null = null;

/**
 * Resolve and validate the 32-byte encryption key from TOKEN_ENC_KEY. Accepts
 * a 64-char hex string, a base64/base64url string, or any UTF-8 string of
 * exactly 32 bytes. Throws when unset or the wrong length — token storage is
 * security-critical, so we fail loudly rather than silently weakening it.
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.TOKEN_ENC_KEY;
  if (!raw || !raw.trim()) {
    throw new Error(
      "TOKEN_ENC_KEY is not set — required to encrypt Customer Account tokens at rest"
    );
  }
  const v = raw.trim();
  let key: Buffer | null = null;

  // Hex (64 chars → 32 bytes).
  if (/^[0-9a-fA-F]{64}$/.test(v)) {
    key = Buffer.from(v, "hex");
  } else {
    // base64 / base64url.
    try {
      const b64 = v.replace(/-/g, "+").replace(/_/g, "/");
      const buf = Buffer.from(b64, "base64");
      if (buf.length === KEY_BYTES) key = buf;
    } catch {
      // fall through
    }
    // Raw UTF-8 of exactly 32 bytes.
    if (!key && Buffer.byteLength(v, "utf8") === KEY_BYTES) {
      key = Buffer.from(v, "utf8");
    }
  }

  if (!key || key.length !== KEY_BYTES) {
    throw new Error(
      "TOKEN_ENC_KEY must decode to 32 bytes (64 hex chars, or 32-byte base64 / raw string)"
    );
  }
  cachedKey = key;
  return key;
}

/** True when a usable TOKEN_ENC_KEY is configured (does not throw). */
export function isTokenCryptoConfigured(): boolean {
  try {
    getKey();
    return true;
  } catch {
    return false;
  }
}

/** Encrypt a token string → a self-contained BYTEA buffer (IV|tag|ciphertext). */
export function encryptToken(plaintext: string): Buffer {
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

/**
 * Decrypt a buffer produced by encryptToken. Throws if the key is wrong, the
 * blob is malformed, or authentication fails (tamper detection).
 */
export function decryptToken(blob: Buffer): string {
  const key = getKey();
  if (blob.length < IV_BYTES + TAG_BYTES) {
    throw new Error("Encrypted token blob is too short");
  }
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = blob.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
