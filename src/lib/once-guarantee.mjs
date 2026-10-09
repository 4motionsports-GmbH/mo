// The verdicts of `npm run verify:live` section 10 „Einmal-Garantie“
// (OPTIN_REWARD T2.7): one DOI mail per address within the resend cooldown,
// one confirmation, one welcome code, and no lost shop sign-up consent (C.29).
// Pure — scripts/verify-live-kpis.mjs does the reads and prints ids only.
// The cooldown itself is parsed by doi-cooldown.mjs, shared with the routes.

/**
 * Shopify fires „Customer subscribed to email marketing“ for an API consent
 * write only while its consentUpdatedAt is less than 24 h old [unverified,
 * brief T1]. A Mo confirmation written later probably triggers no welcome code.
 */
export const SHOPIFY_TRIGGER_WINDOW_MS = 24 * 3600 * 1000;

/** How long after the Shopify write the welcome tag may still be missing. */
export const WELCOME_TAG_GRACE_MS = 2 * 3600 * 1000;

/** How long after the confirmation the outbox write may still be open (drained inline and every few minutes). */
export const OUTBOX_GRACE_MS = 15 * 60 * 1000;

/** @param {unknown} v ISO string, Date or null → epoch ms (NaN when absent). */
function ms(v) {
  if (v instanceof Date) return v.getTime();
  return typeof v === "string" && v ? Date.parse(v) : NaN;
}

/**
 * C.29: the live Shopify consent of a mirrored customer against Mo's view.
 * Flags a shop sign-up whose consent never reached Mo (Shopify PENDING, no
 * `shopify` consent event in Mo) — worse when Mo also sent its own DOI mail
 * (two confirmation mails) — and a Shopify subscription Mo does not know.
 * @param {{ moState: string | null, hasShopifyEvent: boolean, moDoiMail: boolean,
 *           shopify: { state: string, level?: string | null, at?: string | null } | null }} x
 * @returns {{ flag: boolean, key: "unknown" | "double_doi" | "pending_lost" | "subscribed_lost" | "ok" | "differs", label: string }}
 */
export function c29Verdict({ moState, hasShopifyEvent, moDoiMail, shopify }) {
  if (!shopify) return { flag: false, key: "unknown", label: "Shopify-Stand nicht lesbar" };
  if (shopify.state === "pending" && !hasShopifyEvent) {
    return moDoiMail
      ? { flag: true, key: "double_doi", label: "Shopify PENDING, Mo ohne Shopify-Ereignis und mit eigener DOI-Mail — zwei Bestätigungsmails (C.29)" }
      : { flag: true, key: "pending_lost", label: "Shopify PENDING, Mo ohne Shopify-Ereignis (C.29)" };
  }
  if (shopify.state === "subscribed" && moState !== "subscribed") {
    return { flag: true, key: "subscribed_lost", label: "Shopify SUBSCRIBED, Mo nicht angemeldet" };
  }
  if (shopify.state === moState || (shopify.state === "not_subscribed" && moState === "pending")) {
    return { flag: false, key: "ok", label: "stimmt überein" };
  }
  return { flag: false, key: "differs", label: `Shopify ${shopify.state}, Mo ${moState ?? "–"}` };
}

/**
 * Design (a) of the welcome code: Shopify's automation issues it when Mo
 * writes the confirmed consent. Did the write go out in time, and does the
 * customer carry the welcome tag the automation sets?
 *
 * A missing tag is counted, not flagged, unless the run names the tag
 * (`tagRequired` — today no automation sets one). A live state other than
 * SUBSCRIBED is a finding only while Mo still holds the subscription and the
 * write is past its grace (a later withdrawal is legitimate).
 * @param {{ confirmedAt: string | Date | null, pushedAt: string | Date | null, tags: string[] | null,
 *           tag: string, shopify: { state: string } | null, moState?: string | null,
 *           tagRequired?: boolean, now?: number }} x
 *   shopify = the live consent (null = not read; the mirror's tags are used);
 *   moState = Mo's current email_consent_state (null = unknown)
 * @returns {{ flag: boolean, key: "not_subscribed" | "withdrawn" | "not_pushed" | "late_push" | "no_tag" | "waiting" | "tagged", label: string }}
 */
export function welcomeVerdict({ confirmedAt, pushedAt, tags, tag, shopify, moState = null, tagRequired = false, now = Date.now() }) {
  const confirmed = ms(confirmedAt);
  const pushed = ms(pushedAt);
  if (Number.isNaN(pushed)) {
    if (!Number.isNaN(confirmed) && now - confirmed < OUTBOX_GRACE_MS) {
      return { flag: false, key: "waiting", label: "Schreiben nach Shopify steht noch aus" };
    }
    return { flag: true, key: "not_pushed", label: "Bestätigung nicht nach Shopify geschrieben" };
  }
  if (!Number.isNaN(confirmed) && pushed - confirmed > SHOPIFY_TRIGGER_WINDOW_MS) {
    return { flag: true, key: "late_push", label: "mehr als 24 h nach der Bestätigung geschrieben — Automation feuert vermutlich nicht (T1)" };
  }
  if (shopify && shopify.state !== "subscribed") {
    if (moState != null && moState !== "subscribed") {
      return { flag: false, key: "withdrawn", label: `später abgemeldet (Shopify ${shopify.state}, Mo ${moState})` };
    }
    if (now - pushed < OUTBOX_GRACE_MS) {
      return { flag: false, key: "waiting", label: "Shopify übernimmt das Schreiben noch" };
    }
    return { flag: true, key: "not_subscribed", label: `in Shopify ${shopify.state}, nicht SUBSCRIBED — Outbox prüfen` };
  }
  const hasTag = Array.isArray(tags) && tags.includes(tag);
  if (hasTag) return { flag: false, key: "tagged", label: "Tag gesetzt" };
  if (now - pushed > WELCOME_TAG_GRACE_MS) {
    return { flag: tagRequired === true, key: "no_tag", label: `kein Tag „${tag}“ 2 h nach dem Schreiben` };
  }
  return { flag: false, key: "waiting", label: "Tag steht noch aus" };
}

/**
 * Outcome of a stored `customers_email_marketing_consent/update` (or customer)
 * webhook delivery → what it says about C.29. `ignored:unknown-customer` is a
 * shop consent Mo dropped; `…:imported…` and `raced` are the C.29 fix at work.
 * @param {unknown} outcome shopify_webhook_events.outcome
 * @returns {{ flag: boolean, key: "lost" | "imported" | "raced" | "sync_off" | "open" | "other", label: string }}
 */
export function consentWebhookVerdict(outcome) {
  const o = typeof outcome === "string" ? outcome : "";
  if (o === "") return { flag: false, key: "open", label: "nicht abgeschlossen" };
  if (o === "ignored:unknown-customer") return { flag: true, key: "lost", label: "Shop-Einwilligung verloren — Kunde in Mo unbekannt (C.29)" };
  if (o.includes(":imported")) return { flag: false, key: "imported", label: "Kunde beim Webhook nachgeladen (C.29-Fix)" };
  if (o === "raced") return { flag: false, key: "raced", label: "gleichzeitige Anlage aufgelöst (C.29-Fix)" };
  if (o === "ignored:sync-off") return { flag: false, key: "sync_off", label: "Kunden-Sync aus — der Abgleich holt nach" };
  return { flag: false, key: "other", label: "" };
}
