// Letters as a campaign channel (migration 0074, docs/CAMPAIGNS.md §8) — the
// pure rules: who gets a letter in a campaign, whether one letter may go out
// now (every gate, in order), what the review desk flags, and what a send run
// costs. I/O lives in campaign-letters-store.ts / campaign-letters.ts.

import { validateFullAddress } from "./physical-address.mjs";

export const LETTER_MODES = /** @type {const} */ (["aus", "ohne_einwilligung", "alle"]);

export const LETTER_MODE_LABELS = {
  aus: "Keine Briefe",
  ohne_einwilligung: "Brief an alle ohne E-Mail-Einwilligung",
  alle: "Brief an alle (auch mit Einwilligung)",
};

export const LETTER_STATUSES = /** @type {const} */ ([
  "pending",
  "drafted",
  "approved",
  "sending",
  "sent",
  "skipped",
  "excluded",
  "failed",
]);

/** Postage assumed per letter when Pingen has not reported a price (PINGEN_LETTER_COST_CENTS). */
export const DEFAULT_LETTER_COST_CENTS = 106;

/** Minimum days between two campaign letters to one person (LETTER_MIN_INTERVAL_DAYS). */
export const DEFAULT_LETTER_MIN_INTERVAL_DAYS = 60;

/** A subject longer than this is cut in the letter header. */
export const LETTER_SUBJECT_MAX = 80;

/** Characters that roughly fit on page one under the address block. */
export const LETTER_PAGE_ONE_CHARS = 1800;

const DAY_MS = 86_400_000;

/** @param {unknown} v @returns {typeof LETTER_MODES[number] | null} */
export function parseLetterMode(v) {
  return typeof v === "string" && /** @type {readonly string[]} */ (LETTER_MODES).includes(v)
    ? /** @type {typeof LETTER_MODES[number]} */ (v)
    : null;
}

/** @param {unknown} v */
function time(v) {
  if (!v) return null;
  const t = new Date(String(v)).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Is a matched person a letter recipient of this campaign? A letter needs a
 * completed order (the only lawful address source is its shipping address),
 * no objection to postal advertising and no hard block; with
 * `ohne_einwilligung` the person must NOT have the e-mail consent (they get
 * the e-mail instead — never both).
 *
 * @param {{ mode: string, consentSubscribed: boolean, blocked?: boolean,
 *           postalObjectionAt?: string | null, ordersCount: number }} p
 * @returns {{ member: true } | { member: false, reason: "aus" | "widerspruch" | "gesperrt" | "kein_kauf" | "einwilligung" }}
 */
export function letterMembership(p) {
  const mode = parseLetterMode(p.mode);
  if (!mode || mode === "aus") return { member: false, reason: "aus" };
  if (p.postalObjectionAt) return { member: false, reason: "widerspruch" };
  if (p.blocked) return { member: false, reason: "gesperrt" };
  if (!(Number(p.ordersCount) > 0)) return { member: false, reason: "kein_kauf" };
  if (mode === "ohne_einwilligung" && p.consentSubscribed) return { member: false, reason: "einwilligung" };
  return { member: true };
}

/**
 * May ONE campaign letter go out now? Every gate, first failure wins:
 * flag → Pingen → campaign live → objection → consent now given (mode
 * ohne_einwilligung) → address complete → address from a completed order →
 * address not undeliverable → text present → cadence → budget.
 *
 * @param {{
 *   flagApproved: boolean, pingenConfigured: boolean, campaignLive: boolean,
 *   mode: string, consentSubscribed: boolean, postalObjectionAt?: string | null,
 *   address: Record<string, unknown> | null | undefined, addressSource?: string | null,
 *   addressInvalidAt?: string | null, subject?: string | null, body?: string | null,
 *   lastLetterAt?: string | null, minIntervalDays?: number,
 *   budgetCents?: number | null, spentCents?: number, costCents?: number, now?: Date,
 * }} p
 * @returns {{ ok: true, address: Record<string, unknown> } | { ok: false, reason: string, message: string }}
 */
export function decideCampaignLetterSend(p) {
  const no = (reason, message) => ({ ok: /** @type {const} */ (false), reason, message });
  if (!p.flagApproved) {
    return no("flag_off", "Briefversand ist nicht freigeschaltet (PHYSICAL_MAIL_SENDS_APPROVED).");
  }
  if (!p.pingenConfigured) return no("pingen_not_configured", "Pingen ist nicht konfiguriert.");
  if (!p.campaignLive) {
    return no("campaign_closed", "Die Kampagne läuft gerade nicht (Entwurf, pausiert, beendet oder außerhalb ihres Zeitraums).");
  }
  if (p.postalObjectionAt) {
    return no("objection", "Widerspruch gegen Briefwerbung (Art. 21 DSGVO) — kein Brief.");
  }
  if (parseLetterMode(p.mode) === "ohne_einwilligung" && p.consentSubscribed) {
    return no("consent_now", "Die Person hat inzwischen eine E-Mail-Einwilligung — sie bekommt die E-Mail, keinen Brief.");
  }
  const validated = validateFullAddress(p.address);
  if (!validated.ok) {
    return no("no_address", "Keine vollständige Postadresse — erst „Adressen holen“.");
  }
  if (p.addressSource !== "purchase") {
    return no("not_purchase_address", "Die Adresse stammt nicht aus einer abgeschlossenen Bestellung — erst „Adressen holen“.");
  }
  if (p.addressInvalidAt) {
    return no("address_invalid", "Ein Brief an diese Adresse kam als unzustellbar zurück.");
  }
  if (!String(p.subject ?? "").trim() || !String(p.body ?? "").trim()) {
    return no("no_text", "Kein Brieftext — erst einen Entwurf schreiben.");
  }
  const interval = Math.max(0, Math.floor(Number(p.minIntervalDays ?? 0)));
  const last = time(p.lastLetterAt);
  const now = (p.now ?? new Date()).getTime();
  if (interval > 0 && last != null && now - last < interval * DAY_MS) {
    return no("too_soon", `Diese Person hat in den letzten ${interval} Tagen schon einen Werbebrief bekommen.`);
  }
  if (p.budgetCents != null) {
    const cost = Math.max(0, Number(p.costCents ?? DEFAULT_LETTER_COST_CENTS));
    if (Number(p.spentCents ?? 0) + cost > Number(p.budgetCents)) {
      return no("budget", "Das Porto-Budget der Kampagne ist ausgeschöpft.");
    }
  }
  return { ok: /** @type {const} */ (true), address: /** @type {Record<string, unknown>} */ (validated.address) };
}

/** @param {unknown} s */
function fold(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase();
}

/**
 * Does the shipping name look like the customer? A gift order ships to
 * someone else — that address must not receive the customer's letter. True
 * when the last name (or, without one, the first name) appears in the
 * address name; null when the customer's name is unknown.
 *
 * @param {unknown} addressName
 * @param {unknown} firstName
 * @param {unknown} lastName
 * @returns {boolean | null}
 */
export function shippingNameMatches(addressName, firstName, lastName) {
  const tokens = fold(addressName).split(/[^a-z0-9]+/).filter(Boolean);
  const last = fold(lastName).trim();
  const first = fold(firstName).trim();
  if (!last && !first) return null;
  if (tokens.length === 0) return false;
  const want = (last || first).split(/[^a-z0-9]+/).filter(Boolean);
  return want.every((w) => tokens.includes(w));
}

/**
 * What the review desk shows on one letter: the send gate's refusal (blocked,
 * from decideCampaignLetterSend) plus hints worth a look.
 *
 * @param {Parameters<typeof decideCampaignLetterSend>[0] & {
 *   firstName?: string | null, lastName?: string | null, language?: string | null,
 * }} p
 * @returns {{ blocked: Array<{ key: string, title: string }>, hints: Array<{ key: string, title: string }> }}
 */
export function letterReviewChecks(p) {
  /** @type {Array<{ key: string, title: string }>} */
  const blocked = [];
  /** @type {Array<{ key: string, title: string }>} */
  const hints = [];
  const gate = decideCampaignLetterSend(p);
  if (!gate.ok) blocked.push({ key: gate.reason, title: gate.message });

  const addr = p.address && typeof p.address === "object" ? p.address : null;
  if (addr) {
    const match = shippingNameMatches(addr.name, p.firstName, p.lastName);
    if (match === false) hints.push({ key: "name_mismatch", title: "Lieferadresse auf einen anderen Namen (Geschenk?) — prüfen." });
    const country = String(addr.country ?? "").toUpperCase();
    if (country && country !== "DE") hints.push({ key: "abroad", title: `Ausland (${country}) — höheres Porto.` });
  }
  if (p.language === "en") hints.push({ key: "english", title: "Liest Englisch — der Brief ist deutsch." });
  const subject = String(p.subject ?? "");
  if (subject.length > LETTER_SUBJECT_MAX) hints.push({ key: "long_subject", title: "Betreff ist lang." });
  if (String(p.body ?? "").length > LETTER_PAGE_ONE_CHARS) {
    hints.push({ key: "multi_page", title: "Wird voraussichtlich mehrseitig (höheres Porto)." });
  }
  return { blocked, hints };
}

/**
 * Postage of a send run and how many letters the budget still allows.
 *
 * @param {{ count: number, costCents?: number | null, budgetCents?: number | null, spentCents?: number | null }} p
 * @returns {{ count: number, costCents: number, postageCents: number, budgetLeftCents: number | null, affordable: number }}
 */
export function letterRunEstimate(p) {
  const count = Math.max(0, Math.floor(Number(p.count) || 0));
  const cost = Number.isFinite(Number(p.costCents)) && Number(p.costCents) > 0 ? Number(p.costCents) : DEFAULT_LETTER_COST_CENTS;
  const left = p.budgetCents == null ? null : Math.max(0, Number(p.budgetCents) - Math.max(0, Number(p.spentCents ?? 0)));
  const affordable = left == null ? count : Math.min(count, Math.floor(left / cost));
  return { count, costCents: cost, postageCents: count * cost, budgetLeftCents: left, affordable };
}

/**
 * LETTER_MIN_INTERVAL_DAYS — days between two campaign letters to one person
 * (0 = off). Unset or invalid → DEFAULT_LETTER_MIN_INTERVAL_DAYS.
 * @param {Record<string, string | undefined>} [env]
 */
export function letterMinIntervalDays(env = process.env) {
  const raw = env.LETTER_MIN_INTERVAL_DAYS;
  if (raw == null || String(raw).trim() === "") return DEFAULT_LETTER_MIN_INTERVAL_DAYS;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 3650 ? n : DEFAULT_LETTER_MIN_INTERVAL_DAYS;
}

/**
 * CAMPAIGN_LETTER_ADDRESS_NIGHTLY — purchase addresses fetched per night for
 * open letter recipients of active campaigns (0 = off, max 2000). Default 200.
 * @param {Record<string, string | undefined>} [env]
 */
export function letterAddressNightly(env = process.env) {
  const raw = env.CAMPAIGN_LETTER_ADDRESS_NIGHTLY;
  if (raw == null || String(raw).trim() === "") return 200;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, 2000) : 200;
}
