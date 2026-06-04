// Minimal-but-real admin authentication for the marketing dashboard.
//
// One shared admin password (ADMIN_PASSWORD) gates a stateless, signed session
// cookie. There is no user table — this is a single-operator back office.
//
// Everything here uses the Web Crypto API (globalThis.crypto.subtle) and NOT
// node:crypto, on purpose: this module is imported by src/middleware.ts, which
// runs on the Edge runtime where node:crypto is unavailable. Web Crypto is
// available in both the Edge middleware and the Node route handlers / server
// actions, so the same verify path runs everywhere.
//
// Cookie format:  base64url(JSON payload) "." base64url(HMAC-SHA256(payload))
// Payload:        { exp: <epoch-ms> }     — stateless, no DB lookup to verify.

export const ADMIN_COOKIE_NAME = "ms_admin_session";

// 12h session. Long enough for a back-office sitting, short enough that a
// leaked cookie ages out on its own.
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Signing secret for the session cookie. A dedicated ADMIN_SESSION_SECRET is
 * preferred; we fall back to CHAT_SHARED_SECRET so a single well-guarded secret
 * still works. Returns undefined when neither is set (auth then fails closed).
 */
function sessionSecret(): string | undefined {
  return process.env.ADMIN_SESSION_SECRET || process.env.CHAT_SHARED_SECRET || undefined;
}

// ---------------------------------------------------------------------------
// base64url helpers (Edge-safe: no Buffer)
// ---------------------------------------------------------------------------

function bytesToBase64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function stringToBase64url(s: string): string {
  return bytesToBase64url(new TextEncoder().encode(s));
}

// ---------------------------------------------------------------------------
// HMAC-SHA256 + SHA-256 via Web Crypto
// ---------------------------------------------------------------------------

async function hmacSha256(data: string, key: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  return new Uint8Array(sig);
}

async function sha256(data: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return new Uint8Array(digest);
}

/** Constant-time byte comparison (lengths are always equal for our digests). */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Password check
// ---------------------------------------------------------------------------

/**
 * Validate the submitted admin password against ADMIN_PASSWORD. Compares the
 * SHA-256 digests in constant time so neither the password value nor its length
 * leaks via timing. Fails closed when ADMIN_PASSWORD is unset.
 */
export async function isAdminPasswordValid(input: unknown): Promise<boolean> {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || typeof input !== "string" || input.length === 0) return false;
  const [a, b] = await Promise.all([sha256(input), sha256(expected)]);
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Session token
// ---------------------------------------------------------------------------

/**
 * Mint a signed session token valid for SESSION_TTL_MS. Returns null when no
 * signing secret is configured (the login route then reports a server config
 * error rather than handing out an unverifiable cookie).
 */
export async function createAdminSessionToken(now: number = Date.now()): Promise<string | null> {
  const secret = sessionSecret();
  if (!secret) return null;
  const payload = stringToBase64url(JSON.stringify({ exp: now + SESSION_TTL_MS }));
  const sig = bytesToBase64url(await hmacSha256(payload, secret));
  return `${payload}.${sig}`;
}

/**
 * Verify a session token: signature must match AND the payload must not be
 * expired. Returns false on any malformation, bad signature, or missing secret
 * (fail closed — an unverifiable token is never treated as authenticated).
 */
export async function verifyAdminSessionToken(
  token: string | undefined | null,
  now: number = Date.now()
): Promise<boolean> {
  const secret = sessionSecret();
  if (!secret || !token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const payloadPart = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);

  let provided: Uint8Array;
  try {
    provided = base64urlToBytes(sigPart);
  } catch {
    return false;
  }
  const expected = await hmacSha256(payloadPart, secret);
  if (!timingSafeEqual(provided, expected)) return false;

  // Signature is valid — now trust and check the expiry it carries.
  try {
    const json = new TextDecoder().decode(base64urlToBytes(payloadPart));
    const parsed = JSON.parse(json) as { exp?: unknown };
    return typeof parsed.exp === "number" && parsed.exp > now;
  } catch {
    return false;
  }
}

/** True when the admin login is actually configured (password + signing key). */
export function isAdminAuthConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD && sessionSecret());
}

/** Cookie attributes for the session cookie. Secure outside local dev. */
export function sessionCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}
