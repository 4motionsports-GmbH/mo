// CAMPAIGN send gates + config (pure, no I/O) — the flags with legal
// consequences, kept in plain .mjs so they are unit-tested in isolation
// (mirroring pingen-flag.mjs).
//
// ⚠️ This channel's consent comes from Shopify's marketing checkbox, NOT from
// our own double-opt-in flow — German case law effectively requires a provable
// double opt-in, so the whole channel ships DISABLED and stays off until the
// lawyer signs it off:
//
//   CAMPAIGN_SENDS_APPROVED       — the MASTER gate. While false (the default)
//                                   NO campaign email is sent, via UI or direct
//                                   API call; Copy/preview still work. SEPARATE
//                                   from CONSENT_COPY_LAWYER_APPROVED (DOI
//                                   marketing copy) and
//                                   PHYSICAL_MAIL_SENDS_APPROVED (Pingen).
//   CAMPAIGN_ALLOW_SINGLE_OPT_IN  — per-contact gate. Contacts whose Shopify
//                                   opt-in level is SINGLE_OPT_IN or UNKNOWN
//                                   (i.e. no provable double opt-in) are
//                                   send-blocked while this is false (the
//                                   default). Only the lawyer's go-ahead flips
//                                   it.
//
// Both default to FALSE (fail-closed) for any absent, empty, or unrecognised
// value.

import { DEFAULT_EMAIL_TEXT_MODE, parseEmailTextMode } from "./email-text-mode.mjs";
import { parseDiscountPercent } from "./discount-validation.mjs";

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/** @param {string | undefined} raw */
function parseFlag(raw) {
  if (typeof raw !== "string") return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}

/**
 * Whether campaign emails may be sent AT ALL (lawyer sign-off for this channel).
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function isCampaignSendsApproved(env = process.env) {
  return parseFlag(env.CAMPAIGN_SENDS_APPROVED);
}

/**
 * Whether contacts WITHOUT a provable double opt-in (SINGLE_OPT_IN / UNKNOWN)
 * may be sent to. Default false — they stay visible in the queue but blocked.
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function isSingleOptInAllowed(env = process.env) {
  return parseFlag(env.CAMPAIGN_ALLOW_SINGLE_OPT_IN);
}

/**
 * A non-negative integer env value, else the fallback (absent, empty,
 * non-numeric and negative values all fall back).
 * @param {string | undefined} raw
 * @param {number} fallback
 */
function parseNonNegativeInt(raw, fallback) {
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * The cross-channel send-frequency cap in days (MARKETING_MIN_SEND_INTERVAL_DAYS,
 * 0 = off) — consumed by the send gate AND shown on the review desk, so the
 * operator sees a blocked contact before the server refuses it.
 * @param {Record<string, string | undefined>} [env]
 * @returns {number}
 */
export function marketingMinSendIntervalDays(env = process.env) {
  return parseNonNegativeInt(env.MARKETING_MIN_SEND_INTERVAL_DAYS, 0);
}

/**
 * Nightly „Vorbereiten“ (/api/cron/prepare-campaign-drafts): how many pending
 * contacts to draft per night (CAMPAIGN_AUTO_PREPARE_COUNT, 0 = the cron does
 * nothing — the default, because generation costs API money), at which
 * discount depth and in which text mode. Invalid values fall back to 0 % and
 * the modern default text mode.
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ count: number, discountPercent: number, textMode: "detailed" | "compact" | "minimal" }}
 */
export function campaignAutoPrepareConfig(env = process.env) {
  const count = parseNonNegativeInt(env.CAMPAIGN_AUTO_PREPARE_COUNT, 0);
  const rawDiscount = env.CAMPAIGN_AUTO_PREPARE_DISCOUNT;
  const discountPercent =
    typeof rawDiscount === "string" && rawDiscount.trim() !== ""
      ? (parseDiscountPercent(Number(rawDiscount)) ?? 0)
      : 0;
  const textMode = parseEmailTextMode(env.CAMPAIGN_AUTO_PREPARE_TEXT_MODE) ?? DEFAULT_EMAIL_TEXT_MODE;
  return { count, discountPercent, textMode };
}

/**
 * The Mo-promo deep link every campaign email ends with. Theme-side handling
 * (Task F): `mo=open` auto-opens the chat widget after init; the modifiers
 * `mo_new=1` (start a FRESH consultation rather than resuming an old thread)
 * and `mo_view=fullscreen` (open the panel in full-screen mode) shape how it
 * opens. Configurable via CAMPAIGN_MO_DEEPLINK_URL.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function campaignMoDeeplinkUrl(env = process.env) {
  const raw = env.CAMPAIGN_MO_DEEPLINK_URL;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return "https://motionsports.de/?mo=open&mo_new=1&mo_view=fullscreen&utm_source=campaign&utm_medium=email";
}
