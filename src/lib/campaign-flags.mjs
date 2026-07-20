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
 * The Mo-promo deep link every campaign email ends with (auto-opens the chat
 * widget on the storefront — theme-side `?mo=open` handling, Task F).
 * Configurable via CAMPAIGN_MO_DEEPLINK_URL.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function campaignMoDeeplinkUrl(env = process.env) {
  const raw = env.CAMPAIGN_MO_DEEPLINK_URL;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  return "https://motionsports.de/?mo=open&utm_source=campaign&utm_medium=email";
}
