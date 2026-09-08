// Signed, stateless token for the live countdown image URL
// (/api/email-countdown/<token>): it carries only the deadline and the
// language, signed with the same secret the unsubscribe links use, so the
// route cannot be turned into a free image service for arbitrary content and
// the URL reveals nothing about the recipient.

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
