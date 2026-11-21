// Gutscheine (admin screen „Gutscheine“, docs/GIFT_VOUCHERS.md) — the pure
// rules of the screen, shared by the server tab, the /api/admin/gutscheine/*
// routes and the client workspace:
//
//   · the list filter in the URL (?status= ?quelle= ?q= ?seite=) and its
//     mapping to the store filter (listGiftVouchers), incl. „Druck offen“
//   · labels and StatusBadge tones of vouchers, print jobs, mails, deliveries
//   · how an attention flag shows („Achtung“, a revocation Mo still carries
//     out, an acknowledged one) and the toast after „Als geklärt markieren“
//   · which actions a voucher and its print job offer, and why print.one
//     takes no card right now
//   · the Shopify admin link of an order, the € input of the issue dialog
//   · the checks of an operator action and of a voucher issued by hand
//     (the server repeats them; P3's issueManualGiftVoucher checks again),
//     the HTTP status of a refused action, the toast after issuing by hand
//   · the setup check („Einrichtung“) and the notices above the list
//
// Pure (no I/O, no Node built-ins — client components import it); tested in
// gutscheine-core.test.mjs.

import {
  GIFT_VOUCHER_ATTENTION_LABELS,
  GIFT_VOUCHER_HOLD_REASON_LABELS,
  GIFT_VOUCHER_MANUAL_REASONS,
  GIFT_VOUCHER_REASON_LABELS,
  GIFT_VOUCHER_STATUS_LABELS,
  GIFT_VOUCHER_TEXT_LIMITS,
  PRINT_JOB_STATUS_LABELS,
  canAdvancePrintJobStatus,
  decideManualGiftVoucher,
  giftVoucherAddressFromJson,
  isFinalPrintJobStatus,
  sanitizeGiftVoucherText,
  validatePostalAddress,
} from "../../../lib/gift-voucher-core.mjs";
import {
  isAcknowledgedRevocation,
  pickRevocationsToResolve,
  planClearGiftVoucherAttention,
  revokeReasonOf,
} from "../../../lib/gift-voucher-issue-core.mjs";
import { eurFromCents, plural } from "../../../lib/admin-format.mjs";

// ---------------------------------------------------------------------------
// The list filter (URL)
// ---------------------------------------------------------------------------

export const GUTSCHEINE_PAGE_SIZE = 25;

/**
 * @typedef {"pending" | "held" | "issuing" | "issued" | "failed" | "rejected" | "cancelled" | "deactivated"} VoucherStatusKey
 * @typedef {"" | VoucherStatusKey | "achtung" | "druck"} GutscheineStatusFilter
 * @typedef {"" | "shop" | "hand"} GutscheineSourceFilter
 * @typedef {{ status: GutscheineStatusFilter, quelle: GutscheineSourceFilter, q: string, page: number }} GutscheineFilter
 */

/**
 * The status filter (?status=): a voucher status, „achtung“ (attention flag),
 * „druck“ („Druck offen“: a Premium-Karte waits for an operator — in review,
 * failed, or to be printed by hand) or "" (all).
 */
export const GUTSCHEINE_STATUS_FILTERS = Object.freeze(
  /** @type {ReadonlyArray<{ value: GutscheineStatusFilter, label: string }>} */ ([
    { value: "", label: "Alle" },
    { value: "held", label: "Zu prüfen" },
    { value: "achtung", label: "Achtung" },
    { value: "druck", label: "Druck offen" },
    { value: "issued", label: "Ausgestellt" },
    { value: "pending", label: "Wartet" },
    { value: "issuing", label: "Wird ausgestellt" },
    { value: "failed", label: "Fehler" },
    { value: "deactivated", label: "Gesperrt" },
    { value: "cancelled", label: "Storniert" },
    { value: "rejected", label: "Abgelehnt" },
  ])
);

/** The source filter (?quelle=): shop orders, issued by hand, or "" (all). */
export const GUTSCHEINE_SOURCE_FILTERS = Object.freeze(
  /** @type {ReadonlyArray<{ value: GutscheineSourceFilter, label: string }>} */ ([
    { value: "", label: "Alle" },
    { value: "shop", label: "Shop" },
    { value: "hand", label: "Von Hand" },
  ])
);

const STATUS_FILTER_VALUES = new Set(GUTSCHEINE_STATUS_FILTERS.map((o) => o.value));

/** @param {unknown} v */
function firstString(v) {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" ? x : "";
}

/**
 * Raw URL parameters → the list filter. Unknown values are dropped (never an
 * error page); the search is trimmed to 100 characters; the page is 1-based.
 * @param {{ status?: unknown, quelle?: unknown, q?: unknown, seite?: unknown }} [raw]
 * @returns {GutscheineFilter}
 */
export function parseGutscheineFilter(raw = {}) {
  const s = firstString(raw.status).trim().toLowerCase();
  const status = /** @type {GutscheineStatusFilter} */ (STATUS_FILTER_VALUES.has(/** @type {GutscheineStatusFilter} */ (s)) ? s : "");
  const qu = firstString(raw.quelle).trim().toLowerCase();
  const quelle = /** @type {GutscheineSourceFilter} */ (qu === "shop" || qu === "hand" ? qu : "");
  const q = firstString(raw.q).trim().slice(0, 100);
  const p = Number.parseInt(firstString(raw.seite), 10);
  const page = Number.isSafeInteger(p) && p >= 1 ? Math.min(p, 10_000) : 1;
  return { status, quelle, q, page };
}

/**
 * The filter → URL parameters for adminTabHref (defaults are left out).
 * `extra` adds e.g. the selected voucher (`gutschein`).
 * @param {GutscheineFilter} filter
 * @param {Record<string, string | undefined>} [extra]
 * @returns {Record<string, string | undefined>}
 */
export function gutscheineFilterParams(filter, extra = {}) {
  return {
    status: filter.status || undefined,
    quelle: filter.quelle || undefined,
    q: filter.q || undefined,
    seite: filter.page > 1 ? String(filter.page) : undefined,
    ...extra,
  };
}

/**
 * The filter → the store's list filter (lib/gift-voucher-store.ts listGiftVouchers).
 * `printOneHeld`: print.one takes no card right now (printOneHold) — then
 * its waiting cards belong to „Druck offen“ too (they can be printed by hand).
 * @param {GutscheineFilter} filter
 * @param {{ printOneHeld?: boolean }} [opts]
 * @returns {{ status: VoucherStatusKey | null, source: "shop" | "admin" | null, attention: boolean, print: boolean,
 *   printOneHeld: boolean, q: string | null, page: number, pageSize: number }}
 */
export function gutscheineStoreFilter(filter, opts = {}) {
  const status =
    filter.status && filter.status !== "achtung" && filter.status !== "druck" ? /** @type {VoucherStatusKey} */ (filter.status) : null;
  return {
    status,
    source: filter.quelle === "shop" ? "shop" : filter.quelle === "hand" ? "admin" : null,
    attention: filter.status === "achtung",
    print: filter.status === "druck",
    printOneHeld: opts.printOneHeld === true,
    q: filter.q || null,
    page: filter.page,
    pageSize: GUTSCHEINE_PAGE_SIZE,
  };
}

/** How many filters differ from the default (shows „Zurücksetzen“). @param {GutscheineFilter} filter */
export function activeGutscheineFilterCount(filter) {
  return (filter.status ? 1 : 0) + (filter.quelle ? 1 : 0) + (filter.q ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Labels and tones
// ---------------------------------------------------------------------------

/** @typedef {"neutral" | "accent" | "success" | "warning" | "info" | "destructive"} Tone */

/** @type {Readonly<Record<VoucherStatusKey, Tone>>} */
export const VOUCHER_STATUS_TONES = Object.freeze({
  pending: "info",
  held: "warning",
  issuing: "info",
  issued: "success",
  failed: "destructive",
  rejected: "neutral",
  cancelled: "neutral",
  deactivated: "neutral",
});

/** @type {Readonly<Record<string, Tone>>} */
export const PRINT_STATUS_TONES = Object.freeze({
  review: "warning",
  queued: "neutral",
  submitting: "info",
  submitted: "info",
  printing: "info",
  sent: "success",
  failed: "destructive",
  cancelled: "neutral",
  done: "success",
});

export const MAIL_STATUS_LABELS = Object.freeze({
  none: "Keine E-Mail",
  pending: "Wartet auf Versand",
  sent: "Gesendet",
  failed: "Fehlgeschlagen",
  skipped: "Keine Adresse",
});

/** @type {Readonly<Record<string, Tone>>} */
export const MAIL_STATUS_TONES = Object.freeze({
  none: "neutral",
  pending: "info",
  sent: "success",
  failed: "destructive",
  skipped: "neutral",
});

export const DELIVERY_LABELS = Object.freeze({ pdf: "PDF", email: "E-Mail", print: "Premium-Karte" });

export const PRINT_PROVIDER_LABELS = Object.freeze({ printone: "print.one", manual: "Von Hand" });

/** @param {Record<string, string>} labels @param {unknown} key @param {string} [fallback] */
function labelOf(labels, key, fallback = "—") {
  if (typeof key !== "string" || !key) return fallback;
  return Object.prototype.hasOwnProperty.call(labels, key) ? labels[key] : key;
}

/** @param {unknown} status */
export const voucherStatusLabel = (status) => labelOf(GIFT_VOUCHER_STATUS_LABELS, status);
/** @param {unknown} status */
export const voucherStatusTone = (status) =>
  /** @type {Tone} */ (typeof status === "string" && status in VOUCHER_STATUS_TONES ? VOUCHER_STATUS_TONES[/** @type {VoucherStatusKey} */ (status)] : "neutral");
/** @param {unknown} status */
export const printStatusLabel = (status) => labelOf(PRINT_JOB_STATUS_LABELS, status);
/** @param {unknown} status */
export const printStatusTone = (status) => /** @type {Tone} */ (typeof status === "string" ? (PRINT_STATUS_TONES[status] ?? "neutral") : "neutral");
/** @param {unknown} key */
export const holdReasonLabel = (key) => labelOf(GIFT_VOUCHER_HOLD_REASON_LABELS, key);
/** @param {unknown} key */
export const attentionLabel = (key) => labelOf(GIFT_VOUCHER_ATTENTION_LABELS, key);
/** @param {unknown} status */
export const mailStatusLabel = (status) => labelOf(MAIL_STATUS_LABELS, status);
/** @param {unknown} delivery */
export const deliveryLabel = (delivery) => labelOf(DELIVERY_LABELS, delivery);

/**
 * Where a voucher comes from: „Shop“ or the reason of a voucher issued by
 * hand („Kulanz“, „Gewinnspiel“ …).
 * @param {{ source: string, reason: string }} v
 */
export function voucherOriginLabel(v) {
  return v.source === "shop" ? "Shop" : labelOf(GIFT_VOUCHER_REASON_LABELS, v.reason, "Von Hand");
}

/** What to do about a hold reason (the detail's „Zu prüfen“ callout). */
export const HOLD_REASON_HINTS = Object.freeze({
  disabled: "Beim Kauf waren Geschenkgutscheine ausgeschaltet (GIFT_VOUCHERS_ENABLED).",
  test_order: "Eine Shopify-Testbestellung — nur zum Testen ausstellen.",
  currency: "Die Bestellung wurde nicht in Euro bezahlt.",
  discounted: "Auf den Gutschein wurde ein Rabatt angewendet — prüfen, ob das gewollt war.",
  amount: "Der Betrag liegt außerhalb der Grenzen (GIFT_VOUCHER_MIN_EUR / GIFT_VOUCHER_MAX_EUR).",
  risk: "Shopify stuft die Bestellung als riskant ein — zuerst in Shopify prüfen.",
  daily_limit: "Das Tageslimit für Gutscheine (GIFT_VOUCHER_DAILY_LIMIT_EUR) war erreicht.",
  not_paid: "Die Bestellung war nach 24 Stunden noch nicht vollständig bezahlt.",
  refunded:
    "Die Bestellung wurde erstattet, bevor der Gutschein ausgestellt war — in Shopify prüfen, ob die Gutschein-Position erstattet ist, dann ablehnen.",
  attempts: "Das Ausstellen ist zu oft fehlgeschlagen — der letzte Fehler steht unten.",
});

/** What an attention flag means and what to do (the detail's „Achtung“ callout). */
export const ATTENTION_HINTS = Object.freeze({
  refund_after_use:
    "Die Bestellung wurde erstattet, der Gutschein ist aber schon (teilweise) eingelöst. Mo sperrt ihn nicht von selbst — mit der Kundin oder dem Kunden klären und bei Bedarf sperren.",
  cancelled_after_use:
    "Die Bestellung wurde storniert, der Gutschein ist aber schon (teilweise) eingelöst. Mo sperrt ihn nicht von selbst — klären und bei Bedarf sperren.",
  print_without_voucher:
    "Die Premium-Karte wurde bezahlt, in der Bestellung ist aber kein Gutschein dazu — die Bestellung in Shopify prüfen (Erstattung).",
  print_without_address:
    "Für die Premium-Karte fehlt die Adresse — beim Käufer nachfragen und bei der Premium-Karte „Adresse eingeben“, oder den Druck in Shopify erstatten.",
  deactivate_failed: "Das Sperren in Shopify ist fehlgeschlagen — erneut sperren oder die Geschenkkarte in Shopify prüfen.",
  print_cancel_too_late: "Der Druckauftrag war schon in Produktion und ließ sich nicht mehr stornieren.",
  unknown_product_line:
    "Eine bezahlte Bestellzeile trägt einen Gutschein-Entwurf, liegt aber weder auf dem Gutschein- noch auf dem Druck-Zusatzprodukt — meist eine bezahlte Premium-Karte auf einem anderen Produkt. Die Karte von Hand drucken oder erstatten, dann GIFT_VOUCHER_PRODUCT_HANDLE / GIFT_VOUCHER_PRINT_PRODUCT_HANDLE und die Produktauswahl im Theme abgleichen.",
  refund_after_use_ok:
    "Erstattet, aber schon (teilweise) eingelöst — als geklärt markiert. Die Karte bleibt aktiv; Mo meldet den Gutschein bei weiteren Bestelländerungen nicht noch einmal.",
  cancelled_after_use_ok:
    "Storniert, aber schon (teilweise) eingelöst — als geklärt markiert. Die Karte bleibt aktiv; Mo meldet den Gutschein bei weiteren Bestelländerungen nicht noch einmal.",
});

/** @param {unknown} key */
export const holdReasonHint = (key) => (typeof key === "string" ? labelOf(HOLD_REASON_HINTS, key, "") : "");
/** @param {unknown} key */
export const attentionHint = (key) => (typeof key === "string" ? labelOf(ATTENTION_HINTS, key, "") : "");

// ---------------------------------------------------------------------------
// Attention flags: „Achtung“, a revocation under way, an acknowledged one
// ---------------------------------------------------------------------------

/**
 * Is this flag an „Achtung“ (list icon, header badge, the filter and its
 * count)? Every flag except an acknowledged revocation (refund_after_use_ok /
 * cancelled_after_use_ok — „geklärt“, kept on the row so the unit stays
 * revoked). The store's filter and count spell out the same rule.
 * @param {unknown} attention
 */
export function hasAchtung(attention) {
  return typeof attention === "string" && attention !== "" && !isAcknowledgedRevocation(attention);
}

/**
 * Does Mo still carry out this revocation by itself — so there is nothing for
 * an operator to clear? Mirrors the issue library: a revoke flag on a unit
 * that never became a known card (pending, held, failed, issuing —
 * planClearGiftVoucherAttention "revoking": the issuing step looks the card
 * up), or on an issued card the sweep still resolves (pickRevocationsToResolve:
 * a card and no stored balance below the value — untouched → deactivated). A
 * revoke flag on a card found (partly) spent is the operator's.
 * @param {{ id?: number, status: string, attention: string | null, shopifyGiftCardId: string | null,
 *   balanceCents: number | null, amountCents: number }} v
 */
export function isPendingRevocation(v) {
  if (!revokeReasonOf(v.attention)) return false;
  if (planClearGiftVoucherAttention(v) === "revoking") return true;
  return pickRevocationsToResolve([{ id: v.id ?? 0, ...v }]).length > 0;
}

/**
 * How the detail shows a voucher's attention flag (null: none):
 *   achtung      — „Achtung: …“ with its hint (warning), „Als geklärt
 *                  markieren“ where voucherActions allows it;
 *   revoking     — a revocation Mo still carries out (isPendingRevocation):
 *                  no button, Mo deactivates the card (or cancels a voucher
 *                  without one) by itself;
 *   acknowledged — an acknowledged revoke flag: a neutral note, no „Achtung“.
 * @param {{ id?: number, status: string, attention: string | null, shopifyGiftCardId: string | null,
 *   balanceCents: number | null, amountCents: number }} v
 * @returns {null | { kind: "achtung" | "revoking" | "acknowledged", title: string, text: string }}
 */
export function voucherAttentionView(v) {
  if (!v.attention) return null;
  if (isAcknowledgedRevocation(v.attention)) {
    return { kind: "acknowledged", title: attentionLabel(v.attention), text: attentionHint(v.attention) };
  }
  if (isPendingRevocation(v)) {
    const what = revokeReasonOf(v.attention) === "cancelled" ? "Bestellung storniert" : "Bestellung erstattet";
    return v.status === "issued"
      ? {
          kind: "revoking",
          title: "Achtung: Karte wird gesperrt",
          text: `${what} — Mo sperrt die Karte automatisch, sobald Shopify antwortet.`,
        }
      : {
          kind: "revoking",
          title: "Achtung: Gutschein wird storniert",
          text: `${what} — Mo prüft, ob es schon eine Shopify-Karte gibt, und sperrt sie oder storniert den Gutschein automatisch.`,
        };
  }
  return { kind: "achtung", title: `Achtung: ${attentionLabel(v.attention)}`, text: attentionHint(v.attention) };
}

/**
 * The confirmation before „Als geklärt markieren“ — only for a revoke flag
 * (the library checks the card live and may deactivate one: irreversible);
 * null for any other flag (cleared at once).
 * @param {{ attention: string | null }} v
 * @returns {{ title: string, description: string } | null}
 */
export function clearAttentionConfirm(v) {
  const reason = revokeReasonOf(v.attention);
  if (!reason) return null;
  return reason === "refunded"
    ? {
        title: "Erstattung als geklärt markieren?",
        description:
          "Mo prüft die Karte in Shopify noch einmal. Unbenutzt: Sie wird gesperrt. Schon (teilweise) eingelöst: Eine unbenutzte Karte derselben Bestellposition übernimmt die Erstattung und wird stattdessen gesperrt — gibt es keine, bleibt diese Karte aktiv und Mo meldet sie nicht noch einmal.",
      }
    : {
        title: "Stornierung als geklärt markieren?",
        description: "Die Karte ist schon (teilweise) eingelöst und bleibt aktiv — Mo meldet den Gutschein bei weiteren Bestelländerungen nicht noch einmal.",
      };
}

/**
 * The toast after „Als geklärt markieren“ — what the library did, read from
 * the clicked unit before and after (clearGiftVoucherAttention): a card found
 * untouched is deactivated; a refund on a spent card moves to an untouched
 * card of the same order line (that one is deactivated; this one stays active
 * and loses the flag); otherwise the acknowledged key is stored (the card
 * stays active). Any other flag is simply cleared.
 * @param {{ status: string, attention: string | null }} before
 * @param {{ status: string, attention: string | null } | null | undefined} after
 * @returns {{ title: string, description?: string }}
 */
export function clearAttentionToast(before, after) {
  const reason = revokeReasonOf(before.attention);
  if (!reason || !after) return { title: "Als geklärt markiert" };
  if (after.status === "deactivated") {
    return {
      title: "Karte gesperrt",
      description: `Die Karte war unbenutzt — Mo hat sie wegen der ${reason === "refunded" ? "Erstattung" : "Stornierung"} gesperrt.`,
    };
  }
  if (isAcknowledgedRevocation(after.attention)) {
    return {
      title: "Als geklärt markiert",
      description: "Die Karte ist schon (teilweise) eingelöst und bleibt aktiv — Mo meldet sie nicht noch einmal.",
    };
  }
  if (reason === "refunded" && !after.attention && after.status === "issued") {
    return {
      title: "Erstattung verschoben",
      description: "Eine unbenutzte Karte derselben Bestellposition übernimmt die Erstattung und wird gesperrt — diese Karte bleibt aktiv.",
    };
  }
  return { title: "Als geklärt markiert" };
}

// ---------------------------------------------------------------------------
// Which actions are offered
// ---------------------------------------------------------------------------

/**
 * The actions of the detail for a voucher (the routes and lib/gift-voucher-issue.ts
 * decide again — this only decides which buttons appear).
 * @param {{ id?: number, status: string, hasCode: boolean, shopifyGiftCardId: string | null, source: string, delivery: string,
 *   buyerEmail: string | null, recipientEmail: string | null, attention: string | null,
 *   balanceCents?: number | null, amountCents?: number }} v
 */
export function voucherActions(v) {
  const issued = v.status === "issued";
  const mailTarget = v.source === "shop" ? v.buyerEmail : v.delivery === "email" ? v.recipientEmail : null;
  const pending = isPendingRevocation({ ...v, balanceCents: v.balanceCents ?? null, amountCents: v.amountCents ?? 0 });
  return {
    issueHeld: v.status === "held",
    reject: v.status === "held" || v.status === "failed",
    retry: v.status === "failed",
    resendMail: issued && Boolean(mailTarget),
    deactivate: issued,
    syncBalance: (issued || v.status === "deactivated") && Boolean(v.shopifyGiftCardId),
    pdf: issued && v.hasCode,
    revealCode: v.hasCode,
    // An acknowledged revoke flag is „geklärt“ already — it stays (it keeps the
    // unit revoked); a revocation Mo still carries out is not the operator's.
    clearAttention: hasAchtung(v.attention) && !pending,
  };
}

/** Why „Jetzt drucken“ / print.one cannot store the print files (BLOB_READ_WRITE_TOKEN missing). */
export const PRINT_BLOB_MISSING =
  "Der Datei-Speicher fehlt (BLOB_READ_WRITE_TOKEN) — Mo kann die Druckdateien für print.one nicht ablegen.";

/**
 * Why print.one takes no card right now — null when it does: first the
 * submission gate (lib/gift-voucher-print.ts giftVoucherPrintGateBlock: the
 * legal gate GIFT_VOUCHER_PRINT_SENDS_APPROVED, print.one configured, the
 * provider, an https PUBLIC_BASE_URL), then the file store the print files go
 * through. While held, waiting print.one cards can be printed by hand.
 * @param {{ gateBlock?: string | null, blobConfigured?: boolean }} ctx
 * @returns {string | null}
 */
export function printOneHold(ctx) {
  if (ctx.gateBlock) return ctx.gateBlock;
  if (ctx.blobConfigured === false) return PRINT_BLOB_MISSING;
  return null;
}

/**
 * Does the shop offer the Premium-Karte? Only when it can really be fulfilled
 * — the rule of the storefront's features.print: printed in-house
 * (GIFT_VOUCHER_PRINT_PROVIDER=manual), or by print.one when its submission
 * gate is open (approved, configured, https PUBLIC_BASE_URL).
 * @param {{ configuredPrintProvider: string, printGateBlock: string | null }} input
 */
export function isPrintOfferedInShop(input) {
  return input.configuredPrintProvider === "manual" || !input.printGateBlock;
}

/**
 * How a Premium-Karte issued by hand is printed right now (the issue dialog):
 * `printone` — print.one prints and posts it; `held` — a print.one card that
 * waits while print.one takes no card (printOneHold; it can be printed by
 * hand meanwhile); `hand` — the in-house queue (provider manual, or print.one
 * not configured: the job is created for printing by hand).
 * @param {{ printProvider: string, printGateBlock: string | null, blobConfigured: boolean, cardCostCents: number }} env
 * @returns {{ route: "printone" | "held" | "hand", text: string }}
 */
export function manualPrintRoute(env) {
  if (env.printProvider !== "printone") return { route: "hand", text: "Gedruckt wird von Hand (Status „Druck offen“)." };
  const hold = printOneHold({ gateBlock: env.printGateBlock, blobConfigured: env.blobConfigured });
  if (hold) {
    return {
      route: "held",
      text: `print.one druckt gerade nicht: ${hold} Die Karte wartet unter „Druck offen“ und lässt sich von Hand drucken.`,
    };
  }
  return { route: "printone", text: `print.one druckt und verschickt sie (≈ ${eurFromCents(env.cardCostCents)} für Druck und Porto).` };
}

/**
 * The actions of a voucher's print job. A print.one job is submitted („Jetzt
 * drucken“) while print.one takes cards (printOneHold); printed in-house are
 * the manual provider's jobs, a print.one job that failed, and a waiting
 * print.one job print.one does not take now (gate closed, not configured, no
 * https PUBLIC_BASE_URL, no file store) or that has no address — they offer
 * the print files and „Als versendet markieren“ (the library refuses a job
 * print.one has already). „Freigeben“ needs an address; the address can be
 * entered or corrected while the card waits (review / queued), for print.one
 * only before its print files exist. `submitBlocked` says why „Jetzt drucken“
 * is disabled; `held` why print.one does not take this waiting card now.
 * @param {{ status: string, provider: string, address?: unknown, hasAssets?: boolean }} job
 * @param {{ status: string }} voucher
 * @param {{ gateBlock?: string | null, blobConfigured?: boolean }} ctx
 */
export function printJobActions(job, voucher, ctx) {
  const issued = voucher.status === "issued";
  const printone = job.provider === "printone";
  const waiting = job.status === "review" || job.status === "queued";
  const hasAddress = Boolean(job.address);
  const hold = printone ? printOneHold(ctx) : null;
  const byHand = !printone || job.status === "failed" || (waiting && (hold !== null || !hasAddress));
  const submit = printone && job.status === "queued";
  /** @type {string | null} */
  let submitBlocked = null;
  if (submit) {
    if (hold) submitBlocked = hold;
    else if (!issued) submitBlocked = "Der Gutschein ist noch nicht ausgestellt.";
  }
  return {
    release: job.status === "review" && hasAddress,
    submit,
    submitBlocked,
    held: waiting ? hold : null,
    address: waiting && !(printone && job.hasAssets === true),
    files: byHand && issued && job.status !== "cancelled",
    done: byHand && issued && canAdvancePrintJobStatus(job.status, "done"),
    cancel: !isFinalPrintJobStatus(job.status),
  };
}

/** Why an address could not be stored (store setGiftVoucherPrintJobAddress) → HTTP status and German message. */
export const PRINT_ADDRESS_REFUSALS = Object.freeze({
  not_found: { status: 404, message: "Dieser Gutschein hat keinen Druckauftrag." },
  not_waiting: { status: 409, message: "Die Adresse lässt sich nur ändern, solange die Karte noch wartet." },
  at_provider: {
    status: 409,
    message: "Die Karte war schon auf dem Weg zu print.one — die Adresse lässt sich nicht mehr ändern.",
  },
  busy: { status: 409, message: "Die Karte wird gerade an print.one übermittelt — bitte gleich neu laden." },
  error: { status: 500, message: "Die Adresse konnte nicht gespeichert werden." },
});

// ---------------------------------------------------------------------------
// Links and inputs
// ---------------------------------------------------------------------------

/**
 * The order in the Shopify admin: https://admin.shopify.com/store/<handle>/orders/<id>,
 * derivable only from a <handle>.myshopify.com store domain; null otherwise.
 * @param {unknown} storeDomain SHOPIFY_STORE_DOMAIN
 * @param {unknown} orderId numeric order id
 * @returns {string | null}
 */
export function shopifyAdminOrderUrl(storeDomain, orderId) {
  if (typeof orderId !== "string" || !/^\d{1,20}$/.test(orderId)) return null;
  const host = String(storeDomain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  const m = host.match(/^([a-z0-9][a-z0-9-]{0,62})\.myshopify\.com$/);
  return m ? `https://admin.shopify.com/store/${m[1]}/orders/${orderId}` : null;
}

/**
 * A euro amount as an operator types it → cents, or null. German first:
 * „25“, „25,5“, „25,50“, „1.000“, „1.000,00“ (dot = thousands); a dot with one
 * or two decimals is read as the decimal point („25.50“). Spaces and „€“ are
 * ignored; negative or more than two decimals → null.
 * @param {unknown} text
 * @returns {number | null}
 */
export function parseEuroInput(text) {
  if (typeof text !== "string") return null;
  let s = text.replace(/[\s €]/g, "");
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

// ---------------------------------------------------------------------------
// Operator actions (POST /api/admin/gutscheine/action)
// ---------------------------------------------------------------------------

export const GUTSCHEIN_ACTIONS = Object.freeze(
  /** @type {const} */ ([
    "reveal_code",
    "issue_held",
    "reject",
    "retry",
    "resend_mail",
    "deactivate",
    "sync_balance",
    "note",
    "clear_attention",
    "print_release",
    "print_submit",
    "print_cancel",
    "print_done",
    "print_address",
  ])
);

/** @typedef {typeof GUTSCHEIN_ACTIONS[number]} GutscheinAction */

export const NOTE_MAX = 1000;
export const DEACTIVATION_REASON_MAX = 200;

/** @param {unknown} v @returns {Record<string, unknown> | null} */
function asObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : null;
}

/**
 * Check the body of an operator action (German messages).
 * `note` (actions note, reject): optional text ≤ 1000 characters;
 * `reason` (deactivate): required, 3–200 characters;
 * `address` (print_address): the card's recipient — validatePostalAddress for
 * GIFT_VOUCHER_PRINT_COUNTRIES (`printCountries`), normalised to the store's
 * camelCase shape; a refusal names its `field` (address.<field>).
 * @param {unknown} body
 * @param {{ printCountries?: readonly string[] }} [opts]
 * @returns {{ ok: true, action: GutscheinAction, id: number, note: string | null, reason: string | null, address: IssueAddress | null }
 *   | { ok: false, message: string, field?: string }}
 */
export function parseGutscheinAction(body, opts = {}) {
  const b = asObject(body);
  if (!b) return { ok: false, message: "Ungültige Anfrage." };
  const action = typeof b.action === "string" ? b.action : "";
  if (!(/** @type {readonly string[]} */ (GUTSCHEIN_ACTIONS)).includes(action)) return { ok: false, message: "Unbekannte Aktion." };
  const id = typeof b.id === "number" ? b.id : Number(b.id);
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, message: "Gutschein fehlt." };
  /** @type {string | null} */
  let note = null;
  if (action === "note" || action === "reject") {
    if (b.note != null && typeof b.note !== "string") return { ok: false, message: "Ungültige Notiz." };
    const t = typeof b.note === "string" ? b.note.trim() : "";
    if (t.length > NOTE_MAX) return { ok: false, message: `Die Notiz darf höchstens ${NOTE_MAX} Zeichen haben.` };
    note = t || null;
  }
  /** @type {string | null} */
  let reason = null;
  if (action === "deactivate") {
    const t = typeof b.reason === "string" ? b.reason.trim().replace(/\s+/g, " ") : "";
    if (t.length < 3) return { ok: false, message: "Bitte einen Grund für das Sperren angeben." };
    if (t.length > DEACTIVATION_REASON_MAX) {
      return { ok: false, message: `Der Grund darf höchstens ${DEACTIVATION_REASON_MAX} Zeichen haben.` };
    }
    reason = t;
  }
  /** @type {IssueAddress | null} */
  let address = null;
  if (action === "print_address") {
    const a = validatePostalAddress(b.address, { countries: opts.printCountries ?? ["DE"], locale: "de" });
    if (!a.ok) return { ok: false, message: a.message, field: a.field };
    address = giftVoucherAddressFromJson(a.address);
    if (!address) return { ok: false, message: "Bitte eine vollständige Adresse angeben.", field: "address" };
  }
  return { ok: true, action: /** @type {GutscheinAction} */ (action), id, note, reason, address };
}

/**
 * HTTP status for a refused action ({ ok: false, code } of the issue / print
 * libraries): not found 404, input 400, missing configuration or an unusable
 * TOKEN_ENC_KEY 503, a failed call to Shopify / print.one / Resend 502, a
 * database or internal failure 500, everything else (wrong state, too late,
 * Mo still busy, refunded, purged) 409.
 * @param {unknown} code
 */
export function actionErrorStatus(code) {
  switch (code) {
    case "not_found":
      return 404;
    case "busy": // Mo still checks the card / works on the voucher — try again shortly
    case "revoking": // a revocation is still looking for a Shopify card
    case "refunded": // the order was refunded — no card for it
    case "purged": // the retention removed the voucher's data — reject it
      return 409;
    case "bad_request":
    case "invalid":
    case "invalid_input":
      return 400;
    case "not_implemented":
    case "not_configured":
    case "unconfigured":
    case "no_key":
    case "no_database":
    case "migration_missing":
    case "code": // the stored code is not readable (TOKEN_ENC_KEY)
      return 503;
    case "failed":
    case "upstream":
    case "shopify": // a Shopify call failed (order snapshot, lookup, deactivation)
    case "shopify_error":
    case "provider_error":
    case "send_failed": // Resend did not take the mail
      return 502;
    case "db": // a write did not go through
    case "error": // an exception in the library
    case "internal_error":
      return 500;
    default:
      return 409;
  }
}

/**
 * The toast after „Gutschein ausstellen“ (POST /api/admin/gutscheine/issue
 * answers the voucher's status and last error): „ausgestellt“ only once the
 * Shopify card exists; otherwise the voucher was recorded and Mo keeps
 * trying (the sweep) — a warning with the reason.
 * @param {{ number: string | null, status: string | null, lastError: string | null }} r
 * @returns {{ variant: "success" | "warning", title: string, description?: string }}
 */
export function issuedToast(r) {
  const name = r.number ? `Gutschein ${r.number}` : "Gutschein";
  if (r.status === "issued") return { variant: "success", title: `${name} ausgestellt` };
  return {
    variant: "warning",
    title: `${name} angelegt — Shopify-Karte noch nicht erstellt`,
    description: r.lastError ?? "Mo versucht es automatisch erneut.",
  };
}

// ---------------------------------------------------------------------------
// Issuing by hand (POST /api/admin/gutscheine/issue)
// ---------------------------------------------------------------------------

/** The default sender line of a voucher issued by hand. */
export const DEFAULT_ADMIN_SENDER = "Dein motion sports Team";

/**
 * @typedef {{ name: string, addressLine1: string, addressLine2: string | null, postalCode: string, city: string, country: string }} IssueAddress
 * @typedef {{
 *   amountCents: number,
 *   reason: "kulanz" | "marketing" | "gewinnspiel" | "firmengeschenk" | "sonstiges",
 *   designKey: string,
 *   recipientName: string | null,
 *   senderName: string | null,
 *   message: string | null,
 *   delivery: "pdf" | "email" | "print",
 *   recipientEmail: string | null,
 *   address: IssueAddress | null,
 *   adminNote: string | null,
 * }} IssueValue
 */

/**
 * One text of the voucher: printable (no emoji), within its limits — an
 * operator is told instead of the text being changed silently.
 * @param {unknown} raw @param {{ max: number, maxLines: number, field: string, label: string }} o
 * @returns {{ ok: true, text: string | null } | { ok: false, field: string, message: string }}
 */
function voucherText(raw, { max, maxLines, field, label }) {
  if (raw == null || raw === "") return { ok: true, text: null };
  if (typeof raw !== "string") return { ok: false, field, message: `${label}: ungültige Eingabe.` };
  const r = sanitizeGiftVoucherText(raw, { max: Infinity, maxLines: 1000 });
  if (r.removed) {
    return { ok: false, field, message: `${label} enthält Zeichen, die nicht gedruckt werden können (z. B. Emoji).` };
  }
  if (maxLines === 1 && r.text.includes("\n")) return { ok: false, field, message: `${label}: bitte nur eine Zeile.` };
  if (r.text.split("\n").length > maxLines) return { ok: false, field, message: `${label}: höchstens ${maxLines} Zeilen.` };
  if (Array.from(r.text).length > max) return { ok: false, field, message: `${label}: höchstens ${max} Zeichen.` };
  return { ok: true, text: r.text || null };
}

/**
 * Check a voucher issued by hand (the dialog „Gutschein ausstellen“; the
 * route checks the same body again). The rules of decideManualGiftVoucher —
 * amount up to GIFT_VOUCHER_ADMIN_MAX_EUR, a manual reason, no „Eigenes Foto“,
 * marketing only as PDF, a valid e-mail / postal address — plus the voucher
 * texts (printable, within their limits) and the internal note. Returns the
 * normalised value (address in the store's camelCase shape) or the first
 * error with its field (`amountCents`, `reason`, `designKey`, `delivery`,
 * `recipientEmail`, `address.<field>`, `recipientName`, `senderName`,
 * `message`, `adminNote`).
 * @param {unknown} body
 * @param {{ adminMaxCents: number, printCountries?: readonly string[] }} opts
 * @returns {{ ok: true, value: IssueValue } | { ok: false, field: string, message: string }}
 */
export function validateIssueInput(body, { adminMaxCents, printCountries = ["DE"] }) {
  const b = asObject(body) ?? {};
  const decision = decideManualGiftVoucher({
    amountCents: b.amountCents,
    reason: b.reason,
    delivery: b.delivery,
    recipientEmail: b.recipientEmail,
    address: b.address,
    adminMaxCents,
    printCountries,
    designKey: b.designKey === undefined ? null : b.designKey,
  });
  if (!decision.ok) return decision;
  const L = GIFT_VOUCHER_TEXT_LIMITS;
  const recipient = voucherText(b.recipientName, { max: L.recipientName, maxLines: 1, field: "recipientName", label: "Für" });
  if (!recipient.ok) return recipient;
  const sender = voucherText(b.senderName, { max: L.senderName, maxLines: 1, field: "senderName", label: "Von" });
  if (!sender.ok) return sender;
  const message = voucherText(b.message, { max: L.message, maxLines: L.messageLines, field: "message", label: "Nachricht" });
  if (!message.ok) return message;

  const delivery = /** @type {IssueValue["delivery"]} */ (b.delivery);
  /** @type {IssueAddress | null} */
  let address = null;
  if (delivery === "print") {
    const a = validatePostalAddress(b.address, { countries: printCountries, locale: "de" });
    if (!a.ok) return a;
    address = giftVoucherAddressFromJson(a.address);
    if (!address) return { ok: false, field: "address", message: "Bitte eine vollständige Adresse angeben." };
  }
  if (b.adminNote != null && typeof b.adminNote !== "string") {
    return { ok: false, field: "adminNote", message: "Interne Notiz: ungültige Eingabe." };
  }
  const note = typeof b.adminNote === "string" ? b.adminNote.trim() : "";
  if (note.length > NOTE_MAX) return { ok: false, field: "adminNote", message: `Interne Notiz: höchstens ${NOTE_MAX} Zeichen.` };

  return {
    ok: true,
    value: {
      amountCents: /** @type {number} */ (b.amountCents),
      reason: /** @type {IssueValue["reason"]} */ (b.reason),
      designKey: /** @type {string} */ (b.designKey),
      recipientName: recipient.text,
      senderName: sender.text,
      message: message.text,
      delivery,
      recipientEmail: delivery === "email" ? String(b.recipientEmail).trim().toLowerCase() : null,
      address,
      adminNote: note || null,
    },
  };
}

/** The manual reasons with their German labels, in dialog order. */
export const MANUAL_REASON_OPTIONS = Object.freeze(
  GIFT_VOUCHER_MANUAL_REASONS.map((value) => ({ value, label: GIFT_VOUCHER_REASON_LABELS[value] }))
);

// ---------------------------------------------------------------------------
// Setup check („Einrichtung“) and the notices above the list
// ---------------------------------------------------------------------------

/**
 * @typedef {"ok" | "warn" | "error" | "info" | "pending"} SetupState
 * @typedef {"Grundlagen" | "Shopify" | "Kartendruck" | "Grenzen"} SetupGroup
 * @typedef {{ key: string, group: SetupGroup, label: string, state: SetupState, detail: string }} SetupCheck
 * @typedef {{ key: string, level: "error" | "warning" | "info", text: string, filter?: GutscheineStatusFilter }} SetupNotice
 *   `filter`: the list filter that shows what the notice is about (a link „Anzeigen“).
 * @typedef {{ handle: string, title: string, status: string, isGiftCard: boolean,
 *   variants: Array<{ title: string, priceCents: number, taxable: boolean, requiresShipping: boolean }> }} SetupProduct
 * @typedef {{ level: "error" | "warning", product: "voucher" | "print" | "both", message: string }} SetupProductIssue
 * @typedef {{
 *   scopes: { ok: true, missing: string[], optionalMissing: string[] } | { ok: false, message: string },
 *   products: { ok: true, voucher: SetupProduct | null, print: SetupProduct | null, issues: SetupProductIssue[] } | { ok: false, message: string },
 *   issueLimitCents: number | null,
 * }} SetupShopify
 * @typedef {{
 *   dbReady: boolean, tablesExist: boolean,
 *   enabled: boolean, salesEnabled: boolean,
 *   tokenKeyOk: boolean, emailConfigured: boolean, blobConfigured: boolean, shopifyConfigured: boolean,
 *   printSendsApproved: boolean, printProvider: "printone" | "manual", configuredPrintProvider: "printone" | "manual",
 *   printOneConfigured: boolean, printGateBlock: string | null,
 *   openPrintJobs: number, printReviewCount: number, printOpenCount: number,
 *   handles: { voucher: string, print: string },
 *   limits: { minCents: number, maxCents: number, dailyLimitCents: number, adminMaxCents: number },
 *   validityYears: number, printCountries: readonly string[], cardCostCents: number,
 *   shopify: SetupShopify | null,
 * }} SetupInput
 */

/** German names of the countries a card can go to (else the ISO code). */
export const COUNTRY_NAMES = Object.freeze({ DE: "Deutschland", AT: "Österreich", CH: "Schweiz", LU: "Luxemburg", NL: "Niederlande" });

/** @param {string} code */
export const countryName = (code) => labelOf(COUNTRY_NAMES, code, code);

/** @param {number[]} cents */
function amountList(cents) {
  const list = [...cents].sort((a, b) => a - b).map((c) => eurFromCents(c));
  return list.length > 6 ? `${list.slice(0, 6).join(", ")} …` : list.join(", ");
}

/**
 * The setup check (rows with ✓ / ✗, grouped) and the notices for the
 * callouts above the list. `shopify: null` = the Shopify checks are still
 * loading (rows „wird geprüft …“, no Shopify notices yet). Never a secret —
 * only whether something is set. `printGateBlock` = why print.one takes no
 * card (lib/gift-voucher-print.ts giftVoucherPrintGateBlock), null when it
 * does; with print.one as the provider the shop offers the Premium-Karte only
 * then (isPrintOfferedInShop — the storefront's features.print).
 * @param {SetupInput} input
 * @returns {{ checks: SetupCheck[], notices: SetupNotice[] }}
 */
export function buildGutscheineSetup(input) {
  /** @type {SetupCheck[]} */
  const checks = [];
  /** @type {SetupNotice[]} */
  const notices = [];
  /** @param {string} key @param {SetupGroup} group @param {string} label @param {SetupState} state @param {string} detail */
  const check = (key, group, label, state, detail) => checks.push({ key, group, label, state, detail });
  /** @param {string} key @param {SetupNotice["level"]} level @param {string} text @param {GutscheineStatusFilter} [filter] */
  const notice = (key, level, text, filter) => notices.push(filter ? { key, level, text, filter } : { key, level, text });

  // Grundlagen
  if (!input.dbReady) {
    check("db", "Grundlagen", "Datenbank", "error", "DATABASE_URL fehlt.");
    notice("db", "error", "Keine Datenbank konfiguriert (DATABASE_URL) — Gutscheine können weder geladen noch ausgestellt werden.");
  } else if (!input.tablesExist) {
    check("db", "Grundlagen", "Datenbank", "error", "Migration 0083 fehlt — bitte zuerst ausführen.");
    notice("migration", "error", "Migration 0083 fehlt — bitte zuerst ausführen.");
  } else {
    check("db", "Grundlagen", "Datenbank", "ok", "Migration 0083 ist eingespielt.");
  }
  check(
    "enabled",
    "Grundlagen",
    "Hauptschalter (GIFT_VOUCHERS_ENABLED)",
    input.enabled ? "ok" : "warn",
    input.enabled
      ? "An — der Shop verkauft, bezahlte Bestellungen werden ausgestellt."
      : "Aus — bezahlte Bestellungen werden erfasst und warten unter „Zu prüfen“."
  );
  if (!input.enabled) {
    notice("enabled", "warning", "Geschenkgutscheine sind ausgeschaltet (GIFT_VOUCHERS_ENABLED) — bezahlte Bestellungen warten unter „Zu prüfen“.");
  }
  check(
    "sales",
    "Grundlagen",
    "Verkauf im Shop (Einstellung)",
    input.salesEnabled ? "ok" : "warn",
    input.salesEnabled ? "An." : "Aus — der Gutschein-Designer im Shop nimmt keine Bestellungen an."
  );
  if (input.enabled && !input.salesEnabled) {
    notice("sales", "warning", "„Verkauf im Shop“ ist ausgeschaltet — der Gutschein-Designer nimmt keine Bestellungen an.");
  }
  check(
    "key",
    "Grundlagen",
    "Code-Verschlüsselung (TOKEN_ENC_KEY)",
    input.tokenKeyOk ? "ok" : "error",
    input.tokenKeyOk ? "Gesetzt." : "Fehlt oder ungültig — ohne Schlüssel wird kein Code gespeichert."
  );
  if (!input.tokenKeyOk) notice("key", "error", "TOKEN_ENC_KEY fehlt oder ist ungültig — ohne Schlüssel kann kein Gutschein ausgestellt werden.");
  check(
    "email",
    "Grundlagen",
    "E-Mail-Versand (Resend)",
    input.emailConfigured ? "ok" : "warn",
    input.emailConfigured ? "Konfiguriert." : "Nicht konfiguriert — Gutscheine gehen nicht per E-Mail hinaus."
  );
  if (!input.emailConfigured) {
    notice("email", "warning", "E-Mail-Versand ist nicht konfiguriert (RESEND_API_KEY, CONTACT_FROM_EMAIL) — Gutscheine gehen nicht per E-Mail hinaus.");
  }
  check(
    "blob",
    "Grundlagen",
    "Datei-Speicher (BLOB_READ_WRITE_TOKEN)",
    input.blobConfigured ? "ok" : "warn",
    input.blobConfigured ? "Konfiguriert." : "Nicht konfiguriert — keine eigenen Fotos und keine Druckdateien für print.one."
  );
  const printOneReady = input.configuredPrintProvider === "printone" && !input.printGateBlock;
  if (!input.blobConfigured) {
    notice(
      "blob",
      "warning",
      `Datei-Speicher ist nicht konfiguriert (BLOB_READ_WRITE_TOKEN) — keine eigenen Fotos und keine Druckdateien für print.one.${
        printOneReady ? " Bezahlte Premium-Karten warten, bis er eingerichtet ist (oder von Hand drucken: Status „Druck offen“)." : ""
      }`,
      printOneReady && input.printOpenCount > 0 ? "druck" : undefined
    );
  }

  // Shopify
  const sh = input.shopify;
  if (!input.shopifyConfigured) {
    check("shopify", "Shopify", "Shopify Admin API", "error", "Nicht verbunden (SHOPIFY_*).");
    notice("shopify", "error", "Shopify ist nicht verbunden (SHOPIFY_*) — Gutscheine können nicht ausgestellt werden.");
  } else {
    // Configured until the live check answers; „Verbunden“ only once Shopify did.
    const reachable = !sh || sh.scopes.ok || sh.products.ok;
    check(
      "shopify",
      "Shopify",
      "Shopify Admin API",
      reachable ? "ok" : "warn",
      !sh
        ? "Konfiguriert (SHOPIFY_*)."
        : reachable
          ? "Verbunden."
          : `Nicht erreichbar: ${sh.scopes.ok ? "" : sh.scopes.message}`
    );
    if (!sh) {
      check("scope", "Shopify", "Berechtigung write_gift_cards", "pending", "Wird geprüft …");
      check("voucherProduct", "Shopify", `Gutschein-Produkt „${input.handles.voucher}“`, "pending", "Wird geprüft …");
      check("printProduct", "Shopify", `Druck-Zusatzprodukt „${input.handles.print}“`, "pending", "Wird geprüft …");
    } else {
      if (!sh.scopes.ok) {
        check("scope", "Shopify", "Berechtigung write_gift_cards", "warn", `Nicht prüfbar: ${sh.scopes.message}`);
        notice("scope-check", "warning", `Die Shopify-Berechtigungen ließen sich nicht prüfen: ${sh.scopes.message}`);
      } else if (sh.scopes.missing.length > 0) {
        check("scope", "Shopify", "Berechtigung write_gift_cards", "error", "Fehlt — in der App ergänzen und die App neu installieren.");
        notice("scope", "error", "Shopify-Berechtigung write_gift_cards fehlt — Gutscheine können nicht ausgestellt werden.");
      } else {
        check("scope", "Shopify", "Berechtigung write_gift_cards", "ok", "Vorhanden.");
      }
      if (sh.scopes.ok) {
        const opt = sh.scopes.optionalMissing;
        check(
          "optionalScopes",
          "Shopify",
          "Optionale Berechtigungen",
          opt.length ? "info" : "ok",
          opt.length ? `Fehlen: ${opt.join(", ")} (Einlöse-Verlauf, Bestellungen als erfüllt markieren).` : "Vorhanden."
        );
      }
      if (!sh.products.ok) {
        check("voucherProduct", "Shopify", `Gutschein-Produkt „${input.handles.voucher}“`, "warn", `Nicht prüfbar: ${sh.products.message}`);
        notice("products-check", "warning", `Die Gutschein-Produkte ließen sich nicht prüfen: ${sh.products.message}`);
      } else {
        const { voucher, print, issues } = sh.products;
        check(
          "voucherProduct",
          "Shopify",
          `Gutschein-Produkt „${input.handles.voucher}“`,
          voucher ? "ok" : "error",
          voucher
            ? `${voucher.title} — ${plural(voucher.variants.length, "Betrag", "Beträge")}${voucher.variants.length ? `: ${amountList(voucher.variants.map((v) => v.priceCents))}` : ""}`
            : "Nicht gefunden — Produkt anlegen oder GIFT_VOUCHER_PRODUCT_HANDLE setzen."
        );
        // A missing print product is an error while the shop offers the card (describeGiftVoucherProductIssues).
        const printMissing = print ? null : issues.find((i) => i.product === "print") ?? null;
        check(
          "printProduct",
          "Shopify",
          `Druck-Zusatzprodukt „${input.handles.print}“`,
          print ? "ok" : printMissing?.level === "error" ? "error" : "warn",
          print
            ? `${print.title}${print.variants[0] ? ` — ${eurFromCents(print.variants[0].priceCents)}` : ""}`
            : (printMissing?.message ?? "Nicht gefunden — „Premium-Karte per Post“ ist nicht buchbar.")
        );
        // „Not found“ is already its own row; every other finding gets one.
        issues
          .filter((i) => !((i.product === "voucher" && !voucher) || (i.product === "print" && !print)))
          .forEach((i, n) => {
            check(`productIssue${n}`, "Shopify", "Produkt-Hinweis", i.level === "error" ? "error" : "warn", i.message);
          });
        issues.forEach((i, n) => {
          notice(`product${n}`, i.level === "error" ? "error" : "warning", i.message);
        });
      }
      const limit = sh.issueLimitCents;
      if (limit != null && limit > 0) {
        const tooLow = limit < input.limits.maxCents || limit < input.limits.adminMaxCents;
        check(
          "issueLimit",
          "Shopify",
          "Ausgabelimit je Geschenkkarte (Shopify)",
          tooLow ? "warn" : "info",
          tooLow
            ? `${eurFromCents(limit)} — kleiner als die Grenzen von Mo; GIFT_VOUCHER_MAX_EUR / GIFT_VOUCHER_ADMIN_MAX_EUR senken.`
            : eurFromCents(limit)
        );
        if (tooLow) notice("issueLimit", "warning", `Shopify erlaubt Geschenkkarten nur bis ${eurFromCents(limit)} — die Grenzen von Mo liegen darüber.`);
      }
    }
  }

  // Kartendruck. The shop offers the Premium-Karte only when it can really be
  // fulfilled (isPrintOfferedInShop): printed in-house, or by print.one with
  // its submission gate open. Waiting cards print.one does not take can be
  // printed by hand (Status „Druck offen“).
  const configuredPrintOne = input.configuredPrintProvider === "printone";
  const approved = input.printSendsApproved;
  check(
    "printGate",
    "Kartendruck",
    "Freigabe (GIFT_VOUCHER_PRINT_SENDS_APPROVED)",
    approved ? "ok" : configuredPrintOne ? "warn" : "info",
    approved
      ? "Freigegeben — Empfängeradressen dürfen an print.one gehen."
      : configuredPrintOne
        ? "Gesperrt — es gehen keine Adressen an print.one; wartende Karten lassen sich von Hand drucken (Status „Druck offen“)."
        : "Gesperrt — es gehen keine Adressen an print.one (gedruckt wird von Hand)."
  );
  /** @type {[SetupState, string]} */
  let provider;
  if (!configuredPrintOne) {
    provider = [
      "info",
      "Von Hand (GIFT_VOUCHER_PRINT_PROVIDER=manual) — Druckdateien im Gutschein, dann „Als versendet markieren“ (Status „Druck offen“).",
    ];
  } else if (!input.printOneConfigured) {
    provider = [
      "warn",
      "print.one ist nicht eingerichtet (PRINTONE_API_KEY, PRINTONE_TEMPLATE_ID) — von Hand ausgestellte Karten werden von Hand gedruckt (Status „Druck offen“).",
    ];
  } else if (!approved) {
    provider = ["info", "print.one ist eingerichtet und druckt, sobald der Kartendruck freigegeben ist."];
  } else if (input.printGateBlock) {
    provider = ["error", input.printGateBlock];
  } else if (!input.blobConfigured) {
    provider = ["error", `${PRINT_BLOB_MISSING} Bezahlte Karten warten (oder von Hand drucken: Status „Druck offen“).`];
  } else {
    provider = ["ok", "print.one druckt und verschickt die Karten."];
  }
  check("printProvider", "Kartendruck", "Druckpartner", provider[0], provider[1]);
  const offered = isPrintOfferedInShop(input);
  check(
    "printOffer",
    "Kartendruck",
    "Premium-Karte im Shop",
    offered ? "ok" : "warn",
    offered
      ? configuredPrintOne
        ? "Wird angeboten."
        : "Wird angeboten — gedruckt wird von Hand."
      : `Wird nicht angeboten: ${input.printGateBlock ?? "print.one druckt gerade nicht."}`
  );
  if (!offered) {
    const waiting = input.printOpenCount;
    notice(
      "printOffer",
      "warning",
      `${input.printGateBlock ?? "print.one druckt gerade nicht."} Der Shop bietet die Premium-Karte deshalb nicht an${
        waiting > 0 ? `; ${plural(waiting, "Karte wartet", "Karten warten")} auf den Druck (von Hand drucken: Status „Druck offen“)` : ""
      }.`,
      waiting > 0 ? "druck" : undefined
    );
  }
  if (input.printReviewCount > 0) {
    notice(
      "printReview",
      "info",
      `${plural(input.printReviewCount, "Premium-Karte wartet", "Premium-Karten warten")} auf „Freigeben“.`,
      "druck"
    );
  }
  check("printCountries", "Kartendruck", "Versand nach", "info", input.printCountries.map(countryName).join(", ") || "Deutschland");
  check("printCost", "Kartendruck", "Kosten je Karte (Schätzung)", "info", `≈ ${eurFromCents(input.cardCostCents)} (PRINTONE_CARD_COST_CENTS)`);

  // Grenzen
  const l = input.limits;
  check(
    "shopLimits",
    "Grenzen",
    "Shop",
    "info",
    `${eurFromCents(l.minCents)} bis ${eurFromCents(l.maxCents)} je Gutschein · ${l.dailyLimitCents > 0 ? `höchstens ${eurFromCents(l.dailyLimitCents)} am Tag` : "kein Tageslimit"}`
  );
  check("adminLimit", "Grenzen", "Von Hand", "info", `bis ${eurFromCents(l.adminMaxCents)} je Gutschein (GIFT_VOUCHER_ADMIN_MAX_EUR)`);
  check(
    "validity",
    "Grenzen",
    "Gültigkeit",
    "info",
    input.validityYears > 0
      ? `bis 31.12. des ${input.validityYears}. Jahres nach der Ausstellung (GIFT_VOUCHER_VALIDITY_YEARS)`
      : "unbegrenzt (GIFT_VOUCHER_VALIDITY_YEARS=0)"
  );

  return { checks, notices };
}

/**
 * Notices grouped for the callouts (errors first): one callout per level.
 * @param {SetupNotice[]} notices
 * @returns {Array<{ level: SetupNotice["level"], items: SetupNotice[] }>}
 */
export function groupNotices(notices) {
  /** @type {SetupNotice["level"][]} */
  const order = ["error", "warning", "info"];
  return order
    .map((level) => ({ level, items: notices.filter((n) => n.level === level) }))
    .filter((g) => g.items.length > 0);
}

/**
 * Counts for the „Einrichtung“ header: problems (errors) and hints (warnings).
 * @param {SetupCheck[]} checks
 */
export function setupCounts(checks) {
  return {
    errors: checks.filter((c) => c.state === "error").length,
    warnings: checks.filter((c) => c.state === "warn").length,
    pending: checks.filter((c) => c.state === "pending").length,
  };
}
