// Review checks ("Prüfpunkte") of the Kampagne desk — pure, no I/O.
//
// Every card opens with a verdict: BLOCKED (a send would be refused), HINTS
// (worth a look before sending) or READY. The rules run over facts that are
// already on the card (the queue props), so the operator sees at review time
// what the send route would otherwise refuse at send time. The discount check
// is the SAME pure function the send path enforces (detectDiscountTextMismatch),
// so the desk and the server can never disagree about it.
//
// The module never formats dates or money — timezone and locale belong to the
// React side (admin-datetime / admin-format). A check that needs a date carries
// the raw ISO value in `meta`; the UI formats it.

import { detectDiscountTextMismatch } from "./discount-validation.mjs";
import { campaignSegmentByKey } from "./campaign-segments.mjs";

export const CHECK_LEVELS = Object.freeze({
  BLOCKED: "blocked",
  HINT: "hint",
  INFO: "info",
});

/** Opt-in level that counts as a provable double opt-in (campaign-gates.mjs). */
export const CONFIRMED_OPT_IN = "CONFIRMED_OPT_IN";

/** Mirrors PLACEHOLDER_DISCOUNT_CODE in shopify-discounts.ts (TypeScript, not
 * importable from a pure module). The send path swaps this placeholder for the
 * real MK- code only when a discount depth is set. */
export const REVIEW_PLACEHOLDER_CODE = "MO-XXXX";

/** A draft older than this is flagged: purchase history and segment may have
 * moved on since it was written. */
export const STALE_DRAFT_DAYS = 14;

/** Subject lines longer than this get cut off in most mail clients. */
export const SUBJECT_MAX_CHARS = 70;

/** An attached set that expires within this many days is flagged. */
export const BUNDLE_EXPIRY_WARN_DAYS = 2;

const DAY_MS = 86_400_000;

/**
 * The hero A/B arm of a contact: even ids ship WITH a generated KI-Hero
 * ("A"), odd ids without ("B") — the deterministic split the KPI screen's
 * hero comparison relies on (docs/CAMPAIGNS.md, migration 0054).
 * @param {number | string} contactId
 * @returns {"A" | "B"}
 */
export function abGroupOf(contactId) {
  const n = Number(contactId);
  return Number.isInteger(n) && n % 2 === 0 ? "A" : "B";
}

/** @param {unknown} value @returns {number | null} epoch ms or null */
function parseTime(value) {
  if (value == null || value === "") return null;
  const t = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * @typedef {"blocked" | "hint" | "info"} ReviewLevel
 * @typedef {"skip" | "regenerate" | "narrow_basis" | "swap_products" | "rebuild_bundle" |
 *   "generate_hero" | "shorten_subject" | null} ReviewFix
 * @typedef {{
 *   key: string,
 *   level: ReviewLevel,
 *   title: string,
 *   detail: string | null,
 *   fix: ReviewFix,
 *   meta?: Record<string, unknown>,
 * }} ReviewCheck
 */

/**
 * @typedef {{
 *   contactId: number,
 *   optInLevel?: string | null,
 *   subject?: string | null,
 *   body?: string | null,
 *   discountPercent?: number | null,
 *   discountScope?: "all" | "recommendations" | "set" | string | null,
 *   lowConfidence?: boolean,
 *   recommendations?: Array<{ id?: string, name?: string, url?: string | null, available?: boolean | null }>,
 *   bundle?: { expiresAt?: string | null } | null,
 *   segment?: string | null,
 *   heroUrl?: string | null,
 *   draftUpdatedAt?: string | null,
 *   lastSendAt?: string | null,
 *   edited?: boolean,
 *   sendError?: string | null,
 *   isTest?: boolean,
 *   suppressed?: boolean,
 * }} ReviewItem
 *
 * @typedef {{
 *   sendsApproved?: boolean,
 *   allowSingleOptIn?: boolean,
 *   heroDesignActive?: boolean,
 *   minSendIntervalDays?: number,
 *   now?: Date | number,
 * }} ReviewContext
 */

/**
 * Evaluate every check for one card. Blocked checks come first, then hints,
 * then infos — the order the review column shows them in.
 *
 * @param {ReviewItem} item
 * @param {ReviewContext} [ctx]
 * @returns {ReviewCheck[]}
 */
export function reviewChecks(item, ctx = {}) {
  const now =
    ctx.now instanceof Date
      ? ctx.now.getTime()
      : Number.isFinite(ctx.now)
        ? Number(ctx.now)
        : Date.now();
  const allowSingleOptIn = ctx.allowSingleOptIn === true;
  const heroDesignActive = ctx.heroDesignActive === true;
  const minDays = Number(ctx.minSendIntervalDays);

  /** @type {ReviewCheck[]} */
  const blocked = [];
  /** @type {ReviewCheck[]} */
  const hints = [];
  /** @type {ReviewCheck[]} */
  const infos = [];

  const body = typeof item.body === "string" ? item.body : "";
  const subject = typeof item.subject === "string" ? item.subject : "";
  const discount = Number(item.discountPercent) || 0;

  // ── blocked: the send route would refuse ────────────────────────────────
  if (ctx.sendsApproved === false) {
    blocked.push({
      key: "sends_locked",
      level: "blocked",
      title: "Versand gesperrt",
      detail:
        "Die anwaltliche Freigabe für diesen Kanal steht aus (CAMPAIGN_SENDS_APPROVED=false). Entwürfe, Vorschau und Kopieren funktionieren; der Server lehnt jeden Versand ab.",
      fix: null,
    });
  }
  if (typeof item.sendError === "string" && item.sendError.trim()) {
    blocked.push({
      key: "send_refused",
      level: "blocked",
      title: "Versand abgelehnt",
      detail: item.sendError.trim(),
      fix: null,
    });
  }
  if (item.optInLevel !== CONFIRMED_OPT_IN && !allowSingleOptIn) {
    blocked.push({
      key: "opt_in",
      level: "blocked",
      title: "Kein nachweisbares Double-Opt-in",
      detail:
        "Für diesen Kontakt liegt kein nachweisbares Double-Opt-in vor. Senden ist blockiert, solange CAMPAIGN_ALLOW_SINGLE_OPT_IN nicht gesetzt ist; Kopieren ist möglich.",
      fix: "skip",
    });
  }
  // The address is on the suppression list / unsubscribed: the send gate
  // refuses a real contact; a Testkontakt (the operator's own inbox) sends
  // anyway, so the fact is an info there.
  if (item.suppressed === true && item.isTest !== true) {
    blocked.push({
      key: "suppressed",
      level: "blocked",
      title: "Adresse abgemeldet oder gesperrt",
      detail:
        "Die Adresse steht auf der Unterdrückungsliste (Abmeldung, Bounce oder Beschwerde) — der Versand würde abgelehnt.",
      fix: "skip",
    });
  }
  // Test contacts are exempt from the cadence cap (they are sent repeatedly
  // on purpose) — the send path skips it for them as well.
  const lastSend = item.isTest === true ? null : parseTime(item.lastSendAt);
  if (Number.isFinite(minDays) && minDays > 0 && lastSend !== null) {
    const until = lastSend + minDays * DAY_MS;
    if (now < until) {
      blocked.push({
        key: "frequency_cap",
        level: "blocked",
        title: "Sperrfrist läuft",
        detail: `Diese Adresse wurde innerhalb der letzten ${minDays} Tage bereits angeschrieben (kanalübergreifend) — der Versand würde abgelehnt.`,
        fix: "skip",
        meta: { untilIso: new Date(until).toISOString(), lastSendAt: item.lastSendAt ?? null },
      });
    }
  }
  if (discount > 0) {
    const { mismatch, found } = detectDiscountTextMismatch(discount, body);
    if (mismatch) {
      blocked.push({
        key: "discount_mismatch",
        level: "blocked",
        title: "Text nennt einen anderen Rabatt",
        detail: `Der Text nennt ${found.join(" % und ")} %, gesetzt sind ${discount} % — der Versand würde abgelehnt.`,
        fix: "regenerate",
      });
    }
  }
  // A scoped code (0058) needs something to be scoped to — the send route
  // refuses otherwise (never mints a wider code than promised).
  if (discount > 0 && item.discountScope === "set" && !item.bundle) {
    blocked.push({
      key: "discount_scope_no_set",
      level: "blocked",
      title: "Rabatt nur für das Set — aber kein Set angehängt",
      detail: "Der Code soll nur für das Set gelten; ohne aktives Set-Angebot würde der Versand abgelehnt. Set anlegen oder „Gilt für“ ändern.",
      fix: "rebuild_bundle",
    });
  }
  if (
    discount > 0 &&
    item.discountScope === "recommendations" &&
    !(Array.isArray(item.recommendations) ? item.recommendations : []).some((r) => r && r.available !== false && r.url != null)
  ) {
    blocked.push({
      key: "discount_scope_no_recommendations",
      level: "blocked",
      title: "Rabatt nur für Empfehlungen — aber keine verfügbar",
      detail: "Der Code soll nur für die empfohlenen Produkte gelten; ohne verfügbare Empfehlung würde der Versand abgelehnt. Produkte hinzufügen oder „Gilt für“ ändern.",
      fix: "swap_products",
    });
  }
  if (discount <= 0 && body.includes(REVIEW_PLACEHOLDER_CODE)) {
    blocked.push({
      key: "placeholder_without_discount",
      level: "blocked",
      title: "Platzhalter-Code ohne Rabatt",
      detail: `Der Text enthält ${REVIEW_PLACEHOLDER_CODE}, aber es ist kein Rabatt gesetzt — der Platzhalter würde so verschickt.`,
      fix: "regenerate",
    });
  }

  // ── hints: worth a look ─────────────────────────────────────────────────
  if (item.lowConfidence === true) {
    hints.push({
      key: "low_confidence",
      level: "hint",
      title: "Empfehlungen unsicher",
      detail:
        "Die Empfehlungen basieren auf wenig Kaufkontext — Basis anpassen oder Produkte tauschen.",
      fix: "narrow_basis",
    });
  }
  const recs = Array.isArray(item.recommendations) ? item.recommendations : [];
  const unavailable = recs.filter((r) => r && (r.available === false || r.url == null));
  if (unavailable.length > 0) {
    hints.push({
      key: "product_unavailable",
      level: "hint",
      title:
        unavailable.length === 1
          ? "Ein empfohlenes Produkt ist nicht verfügbar"
          : `${unavailable.length} empfohlene Produkte sind nicht verfügbar`,
      detail: unavailable.map((r) => r.name || r.id || "?").join(", "),
      fix: "swap_products",
    });
  }
  if (item.bundle && item.bundle.expiresAt) {
    const expires = parseTime(item.bundle.expiresAt);
    if (expires !== null) {
      if (expires <= now) {
        hints.push({
          key: "bundle_expired",
          level: "hint",
          title: "Set-Angebot abgelaufen",
          detail: "Das angehängte Set ist abgelaufen — der Angebots-Block würde in der Mail fehlen.",
          fix: "rebuild_bundle",
          meta: { expiresAt: item.bundle.expiresAt },
        });
      } else if (expires - now <= BUNDLE_EXPIRY_WARN_DAYS * DAY_MS) {
        hints.push({
          key: "bundle_expiring",
          level: "hint",
          title: "Set läuft bald ab",
          detail: `Das angehängte Set läuft in weniger als ${BUNDLE_EXPIRY_WARN_DAYS} Tagen ab.`,
          fix: "rebuild_bundle",
          meta: { expiresAt: item.bundle.expiresAt },
        });
      }
    }
  }
  if (heroDesignActive) {
    const hasHero = typeof item.heroUrl === "string" && item.heroUrl.length > 0;
    const group = abGroupOf(item.contactId);
    if (group === "A" && !hasHero) {
      hints.push({
        key: "hero_missing",
        level: "hint",
        title: "A-Gruppe ohne KI-Hero",
        detail:
          "Gerade Kontakt-IDs sollen mit generiertem Hero-Bild gesendet werden, ungerade ohne — der KPI-Bereich vergleicht beide Gruppen.",
        fix: "generate_hero",
      });
    } else if (hasHero) {
      infos.push({
        key: "hero_present",
        level: "info",
        title: group === "A" ? "KI-Hero vorhanden (A-Gruppe)" : "KI-Hero vorhanden (B-Gruppe)",
        detail: null,
        fix: null,
      });
    }
  }
  const updated = parseTime(item.draftUpdatedAt);
  if (updated !== null && now - updated > STALE_DRAFT_DAYS * DAY_MS) {
    const days = Math.floor((now - updated) / DAY_MS);
    hints.push({
      key: "stale_draft",
      level: "hint",
      title: `Entwurf ist ${days} Tage alt`,
      detail: "Kaufhistorie und Segment können sich seither geändert haben.",
      fix: "regenerate",
    });
  }
  const segment = item.segment ? campaignSegmentByKey(item.segment) : null;
  if (segment && segment.sendable === false) {
    hints.push({
      key: "segment_not_sendable",
      level: "hint",
      title: `Segment „${segment.label}“ — nicht im Sendefenster`,
      detail: segment.reason,
      fix: "skip",
    });
  }
  if (subject.length > SUBJECT_MAX_CHARS) {
    hints.push({
      key: "subject_long",
      level: "hint",
      title: "Betreff zu lang",
      detail: `${subject.length} Zeichen — ab ${SUBJECT_MAX_CHARS} schneiden viele Mail-Clients ab.`,
      fix: "shorten_subject",
    });
  }

  // ── info ────────────────────────────────────────────────────────────────
  if (item.isTest === true && item.suppressed === true) {
    infos.push({
      key: "test_suppressed",
      level: "info",
      title: "Adresse auf der Unterdrückungsliste",
      detail:
        "Diese Testadresse hat sich früher abgemeldet oder ist gebounct. Ein Testkontakt sendet trotzdem — eine echte Adresse würde abgelehnt.",
      fix: null,
    });
  }
  if (item.isTest === true) {
    infos.push({
      key: "test_contact",
      level: "info",
      title: "Testkontakt",
      detail:
        "Der Versand geht an diese Adresse wie an eine:n echte:n Kund:in (echter Rabattcode, Set, Abmeldelink). Der Kontakt bleibt danach in der Warteschlange und zählt nicht in den KPIs.",
      fix: null,
    });
  }
  if (item.edited === true) {
    infos.push({
      key: "edited",
      level: "info",
      title: "Manuell bearbeitet",
      detail: null,
      fix: null,
    });
  }

  return [...blocked, ...hints, ...infos];
}

/**
 * The card's verdict from its checks.
 * @param {ReviewCheck[]} checks
 * @returns {"blocked" | "hints" | "ready"}
 */
export function reviewVerdict(checks) {
  if (checks.some((c) => c.level === CHECK_LEVELS.BLOCKED)) return "blocked";
  if (checks.some((c) => c.level === CHECK_LEVELS.HINT)) return "hints";
  return "ready";
}
