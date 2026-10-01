// Campaign definitions (pure, tested): kinds, statuses and their transitions,
// input validation for the wizard, schedule state and per-campaign offer
// defaults. The I/O lives in lib/campaigns-store.ts. docs/CAMPAIGNS.md §2.

import { normalizeAudienceSpec } from "./audience-spec.mjs";

export const CAMPAIGN_KINDS = /** @type {const} */ (["laufend", "aktion", "einzel"]);
export const CAMPAIGN_STATUSES = /** @type {const} */ (["entwurf", "aktiv", "pausiert", "beendet", "archiviert"]);
export const HERO_MODES = /** @type {const} */ (["none", "default", "ai_ab", "ai_all"]);
export const CTA_KINDS = /** @type {const} */ (["mo_chat", "shop"]);
export const AUDIENCE_MODES = /** @type {const} */ (["dynamisch", "fest"]);

export const CAMPAIGN_KIND_LABELS = {
  laufend: "Laufend",
  aktion: "Aktion",
  einzel: "Einzelansprache",
};

export const CAMPAIGN_STATUS_LABELS = {
  entwurf: "Entwurf",
  aktiv: "Aktiv",
  pausiert: "Pausiert",
  beendet: "Beendet",
  archiviert: "Archiviert",
};

export const HERO_MODE_LABELS = {
  none: "Kein Titelbild",
  default: "Standard-Titelbild des Designs",
  ai_ab: "KI-Titelbild für einen Teil (A/B)",
  ai_all: "KI-Titelbild für alle",
};

/** Allowed status changes. Einzelansprache is always active. */
const TRANSITIONS = {
  entwurf: ["aktiv", "archiviert"],
  aktiv: ["pausiert", "beendet"],
  pausiert: ["aktiv", "beendet"],
  beendet: ["archiviert", "aktiv"],
  archiviert: [],
};

/**
 * @param {string} from
 * @param {string} to
 * @param {string} kind
 */
export function canTransition(from, to, kind) {
  if (kind === "einzel") return false;
  return Array.isArray(TRANSITIONS[from]) && TRANSITIONS[from].includes(to);
}

/** German verb for the status button ("Starten", "Pausieren", …). */
export function transitionLabel(from, to) {
  if (to === "aktiv") return from === "entwurf" ? "Starten" : from === "beendet" ? "Wieder aufnehmen" : "Fortsetzen";
  if (to === "pausiert") return "Pausieren";
  if (to === "beendet") return "Beenden";
  if (to === "archiviert") return "Archivieren";
  return to;
}

/** URL-safe slug from a campaign name (umlauts transliterated). */
export function slugifyCampaignName(name) {
  const s = String(name ?? "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "kampagne";
}

/** Sensible defaults per kind (the wizard's starting point). */
export function campaignDefaults(kind) {
  if (kind === "laufend") {
    return { audienceMode: "dynamisch", reentryDays: 180, heroMode: "ai_ab", priority: 10, autoPreparePerDay: 0 };
  }
  return { audienceMode: "fest", reentryDays: null, heroMode: "default", priority: 50, autoPreparePerDay: 0 };
}

const isoOrNull = (v) => {
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

const intIn = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);

/**
 * Validate the wizard / edit form. Returns the clean value plus German error
 * messages per field. Only the fields present in `raw` are validated, so the
 * same function serves create (all fields) and patch (some fields). Rules
 * that span two fields (the chat button needs the Mo block) read the missing
 * one from `current` (the stored campaign) on a patch, or the column default
 * on a create.
 *
 * @param {Record<string, unknown>} raw
 * @param {{ create?: boolean, maxDiscountPercent?: number,
 *           current?: { ctaKind?: string, moPromo?: boolean } | null }} [opts]
 */
export function validateCampaignInput(raw, opts = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  /** @type {Record<string, unknown>} */
  const value = {};
  /** @type {Record<string, string>} */
  const errors = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(r, k);
  const maxDiscount = opts.maxDiscountPercent ?? 50;

  if (opts.create || has("name")) {
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (name.length < 3 || name.length > 80) errors.name = "Name mit 3–80 Zeichen angeben.";
    else value.name = name;
  }
  if (opts.create || has("kind")) {
    if (r.kind === "laufend" || r.kind === "aktion") value.kind = r.kind;
    else errors.kind = "Art wählen: Laufend oder Aktion.";
  }
  if (has("brief")) {
    const brief = typeof r.brief === "string" ? r.brief.trim() : "";
    if (brief.length > 4000) errors.brief = "Das Briefing ist zu lang (max. 4.000 Zeichen).";
    else value.brief = brief || null;
  }
  if (has("audience")) value.audience = normalizeAudienceSpec(r.audience);
  if (has("audienceMode")) {
    if (AUDIENCE_MODES.includes(/** @type {any} */ (r.audienceMode))) value.audienceMode = r.audienceMode;
    else errors.audienceMode = "Zielgruppe: dynamisch oder fest.";
  }
  if (has("priority")) {
    const p = intIn(r.priority, 0, 100);
    if (p === undefined) errors.priority = "Priorität 0–100.";
    else value.priority = p;
  }
  for (const key of ["startsAt", "endsAt", "discountValidUntil"]) {
    if (!has(key)) continue;
    const v = isoOrNull(r[key]);
    if (v === undefined) errors[key] = "Ungültiges Datum.";
    else value[key] = v;
  }
  if (value.startsAt && value.endsAt && String(value.endsAt) <= String(value.startsAt)) {
    errors.endsAt = "Das Ende muss nach dem Start liegen.";
  }
  if (has("dailyTarget")) {
    const v = r.dailyTarget == null || r.dailyTarget === "" ? null : intIn(r.dailyTarget, 1, 5000);
    if (v === undefined) errors.dailyTarget = "Tagesziel 1–5.000 oder leer.";
    else value.dailyTarget = v;
  }
  if (has("autoPreparePerDay")) {
    const v = intIn(r.autoPreparePerDay, 0, 500);
    if (v === undefined) errors.autoPreparePerDay = "Automatisch vorbereiten: 0–500 pro Tag.";
    else value.autoPreparePerDay = v;
  }
  if (has("reentryDays")) {
    const v = r.reentryDays == null || r.reentryDays === "" ? null : intIn(r.reentryDays, 14, 3650);
    if (v === undefined) errors.reentryDays = "Wiederaufnahme nach 14–3.650 Tagen oder leer.";
    else value.reentryDays = v;
  }
  if (has("discountPercent")) {
    const v = intIn(r.discountPercent, 0, maxDiscount);
    if (v === undefined) errors.discountPercent = `Rabatt 0–${maxDiscount} %.`;
    else value.discountPercent = v;
  }
  if (has("discountScope")) {
    if (r.discountScope === "all" || r.discountScope === "recommendations" || r.discountScope === "set") {
      value.discountScope = r.discountScope;
    } else errors.discountScope = "Rabatt gilt für: alles, Empfehlungen oder Set.";
  }
  if (has("designKey")) {
    const v = typeof r.designKey === "string" && r.designKey.trim() ? r.designKey.trim() : null;
    if (v && !/^[a-z0-9-]{2,60}$/.test(v)) errors.designKey = "Unbekanntes Design.";
    else value.designKey = v;
  }
  if (has("heroMode")) {
    if (HERO_MODES.includes(/** @type {any} */ (r.heroMode))) value.heroMode = r.heroMode;
    else errors.heroMode = "Titelbild-Modus wählen.";
  }
  if (has("textMode")) {
    if (r.textMode == null || r.textMode === "") value.textMode = null;
    else if (r.textMode === "detailed" || r.textMode === "compact" || r.textMode === "minimal") value.textMode = r.textMode;
    else errors.textMode = "Textlänge wählen.";
  }
  if (has("moPromo")) value.moPromo = r.moPromo === true;
  if (has("ctaKind")) {
    if (CTA_KINDS.includes(/** @type {any} */ (r.ctaKind))) value.ctaKind = r.ctaKind;
    else errors.ctaKind = "Ziel des Buttons wählen.";
  }
  if (has("ctaUrl")) {
    const v = typeof r.ctaUrl === "string" ? r.ctaUrl.trim() : "";
    if (!v) value.ctaUrl = null;
    else if (!/^https:\/\/[^\s]+$/.test(v) || v.length > 500) errors.ctaUrl = "Link muss mit https:// beginnen.";
    else value.ctaUrl = v;
  }
  const ctaKind = value.ctaKind ?? r.ctaKind;
  if (ctaKind === "shop" && has("ctaUrl") && !value.ctaUrl && !errors.ctaUrl) {
    errors.ctaUrl = "Für einen Shop-Button einen Link angeben.";
  }
  // The chat button lives in the Mo block — without it the mail has no button at all.
  const effectiveCta = value.ctaKind ?? opts.current?.ctaKind ?? (opts.create ? "mo_chat" : undefined);
  const effectivePromo = has("moPromo") ? value.moPromo : opts.current?.moPromo ?? (opts.create ? true : undefined);
  if ((has("moPromo") || has("ctaKind")) && effectiveCta === "mo_chat" && effectivePromo === false) {
    errors.moPromo = "Der Button zu Mo steht im Mo-Hinweis — Hinweis einschalten oder den Button auf den Shop zeigen lassen.";
  }
  return { ok: Object.keys(errors).length === 0, value, errors };
}

/**
 * Where a campaign stands in time. `geplant`: active but its start lies
 * ahead; `abgelaufen`: active but its end has passed (the nightly job ends
 * it); `laeuft`: sendable now.
 *
 * @param {{ status: string, startsAt?: string | null, endsAt?: string | null }} c
 * @param {Date} [now]
 */
export function campaignPhase(c, now = new Date()) {
  if (c.status !== "aktiv") return c.status;
  const t = now.getTime();
  if (c.startsAt && new Date(c.startsAt).getTime() > t) return "geplant";
  if (c.endsAt && new Date(c.endsAt).getTime() <= t) return "abgelaufen";
  return "laeuft";
}

/** May mails of this campaign go out right now? (The send path re-checks.) */
export function isCampaignLive(c, now = new Date()) {
  return campaignPhase(c, now) === "laeuft";
}

export const CAMPAIGN_PHASE_LABELS = {
  entwurf: "Entwurf",
  geplant: "Geplant",
  laeuft: "Läuft",
  abgelaufen: "Abgelaufen",
  pausiert: "Pausiert",
  beendet: "Beendet",
  archiviert: "Archiviert",
};

/**
 * When a new code of this campaign expires: an Aktion's codes all end on its
 * `discountValidUntil` (Black Friday ends for everyone at once); otherwise the
 * usual per-mail validity. Never in the past.
 *
 * @param {{ discountValidUntil?: string | null }} c
 * @param {number} defaultDays  MARKETING_DISCOUNT_EXPIRY_DAYS
 * @param {Date} [now]
 */
export function campaignDiscountExpiry(c, defaultDays, now = new Date()) {
  const fallback = new Date(now.getTime() + Math.max(1, defaultDays) * 86_400_000);
  if (!c.discountValidUntil) return fallback.toISOString();
  const until = new Date(c.discountValidUntil);
  if (Number.isNaN(until.getTime()) || until.getTime() <= now.getTime()) return fallback.toISOString();
  return until.toISOString();
}

/**
 * How many drafts the nightly job prepares per campaign: each live campaign's
 * own `autoPreparePerDay`, highest priority first, capped by the global
 * budget (CAMPAIGN_AUTO_PREPARE_COUNT).
 *
 * @param {Array<{ id: number, priority: number, autoPreparePerDay: number, status: string, startsAt?: string | null, endsAt?: string | null, kind: string }>} campaigns
 * @param {number} budget
 * @param {Date} [now]
 */
export function planAutoPrepare(campaigns, budget, now = new Date()) {
  let left = Math.max(0, budget);
  const plan = [];
  const live = campaigns
    .filter((c) => c.kind !== "einzel" && c.autoPreparePerDay > 0 && isCampaignLive(c, now))
    .sort((a, b) => b.priority - a.priority || a.id - b.id);
  for (const c of live) {
    if (left <= 0) break;
    const n = Math.min(c.autoPreparePerDay, left);
    plan.push({ campaignId: c.id, count: n });
    left -= n;
  }
  return plan;
}
