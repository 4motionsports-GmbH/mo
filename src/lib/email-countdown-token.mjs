// Signed, stateless token for the live countdown image URL
// (/api/email-countdown/<token>): it carries only the deadline and the
// language, signed with the same secret the unsubscribe links use, so the
// route cannot be turned into a free image service for arbitrary content and
// the URL reveals nothing about the recipient. A template's colours — and its
// label, the free text in the picture (2026-11-13) — ride along in the query,
// bound to the token by a signature of their own (signCountdownColors over the
// canonical look query, email-countdown-image.mjs countdownLookQuery), so
// nobody can make our domain render a text of their own.

import { createHmac, timingSafeEqual } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** The signing secret (unsubscribe links use the same one). */
export function countdownSecret(env = process.env) {
  return env.UNSUBSCRIBE_SECRET || env.CHAT_SHARED_SECRET || undefined;
}

/**
 * @param {{ expiresAt: string | Date, language?: "de" | "en" }} input
 * @param {string | undefined} secret
 * @returns {string | null} token, or null without a secret / with an invalid date
 */
export function signCountdownToken(input, secret) {
  if (!secret) return null;
  const t = Math.floor(new Date(input.expiresAt).getTime() / 1000);
  if (!Number.isFinite(t)) return null;
  const lang = input.language === "en" ? "en" : "de";
  const payload = `${t}.${lang}`;
  const sig = createHmac("sha256", secret).update(payload).digest();
  return `${b64url(Buffer.from(payload, "utf8"))}.${b64url(sig)}`;
}

/**
 * @param {string} token
 * @param {string | undefined} secret
 * @returns {{ expiresAt: string, language: "de" | "en" } | null}
 */
export function verifyCountdownToken(token, secret) {
  if (!secret || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  let payload;
  try {
    payload = fromB64url(parts[0]).toString("utf8");
  } catch {
    return null;
  }
  const m = /^(\d{1,12})\.(de|en)$/.exec(payload);
  if (!m) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  let given;
  try {
    given = fromB64url(parts[1]);
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return { expiresAt: new Date(Number(m[1]) * 1000).toISOString(), language: m[2] };
}

/** Characters of the colour signature (base64url of the HMAC — 132 bits). */
const COLOR_SIG_CHARS = 22;

/**
 * The signature (`cs`) of a countdown image's look: binds the canonical look
 * query (email-countdown-image.mjs countdownLookQuery — the colours
 * "bg=…&tile=…", then the label "text=…" or "notext=1") to the token. Without
 * it anyone could make the public route draw the image in colours no mail
 * carries — or write any text of their choosing on our domain —, and every
 * distinct URL is a fresh render (~0.7 s of CPU) that neither the per-minute
 * memo nor the CDN shares. The colours alone sign exactly as before.
 * @param {string} token  the signed countdown token of the URL
 * @param {string} query  the canonical look query
 * @param {string | undefined} secret
 * @returns {string | null} null without a secret, token or colours
 */
export function signCountdownColors(token, query, secret) {
  if (!secret || typeof token !== "string" || !token || typeof query !== "string" || !query) return null;
  return b64url(createHmac("sha256", secret).update(`colors.${token}.${query}`).digest()).slice(0, COLOR_SIG_CHARS);
}

/**
 * Is `sig` the signature of this look (colours, label) for this token?
 * @param {string} token
 * @param {string} query  the canonical look query of the request
 * @param {unknown} sig  the request's `cs`
 * @param {string | undefined} secret
 */
export function verifyCountdownColors(token, query, sig, secret) {
  const expected = signCountdownColors(token, query, secret);
  if (!expected || typeof sig !== "string" || sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
