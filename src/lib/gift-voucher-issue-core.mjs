// Geschenkgutscheine — the pure decisions of the issuing pipeline
// (docs/GIFT_VOUCHERS.md). The I/O half is lib/gift-voucher-issue.ts; the
// vocabulary and the single-unit rules (decideGiftVoucherIssue,
// pairPrintLines, refundedQuantities …) are gift-voucher-core.mjs. Tested by
// gift-voucher-issue-core.test.mjs.
//
// What lives here:
//   · the cheap look at an orders/paid payload (is any line a voucher draft?)
//   · planGiftVoucherOrderRecord — one row per paid unit, its print job, the
//     holds a payload already decides (switched off, test order, currency,
//     discount, amount), attention flags
//   · planGiftVoucherOrderChange — which units a cancellation / refund
//     revokes and how (cancel at once, or flag for the Shopify step)
//   · the revocation flag: a revoked unit carries attention
//     `cancelled_after_use` / `refund_after_use` until the Shopify step
//     resolves it (unused card → deactivated, flag cleared; used card → flag
//     stays, now true — for a refund an untouched sibling of the same line
//     takes it over first). The flag is the durable intent: whoever comes next
//     (the webhook's after(), the issuing step, the cron sweep) finishes it.
//     An operator's „Als geklärt markieren“ on a spent card stores its
//     acknowledged form (`*_after_use_ok`): revoked for good, no „Achtung“.
//   · retry / deferral timing, what a failed giftCardCreate means, adopting a
//     card found by its code, the Shopify note, fulfilment planning.

import {
  GIFT_VOUCHER_DRAFT_PROPERTY,
  GIFT_VOUCHER_REASON_LABELS,
  decideGiftVoucherIssue,
  isValidDraftToken,
  pairPrintLines,
  planGiftVoucherRetry,
  refundedQuantities,
} from "./gift-voucher-core.mjs";

// ── small helpers ────────────────────────────────────────────────────────────

/** @param {unknown} v @returns {Record<string, unknown> | null} */
function asObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : null;
}

/**
 * A Shopify id as a numeric string (number, digits or GID) — the rule of
 * gift-voucher-core / shopify-customer-map, kept local.
 * @param {unknown} value
 * @returns {string | null}
 */
function numericId(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  const s = String(value).trim();
  if (/^\d+$/.test(s)) return s;
  const m = s.match(/^gid:\/\/shopify\/\w+\/(\d+)(?:\?.*)?$/);
  return m ? m[1] : null;
}

/** @param {unknown} iso @returns {number | null} */
function timeOf(iso) {
  if (iso instanceof Date) return Number.isNaN(iso.getTime()) ? null : iso.getTime();
  if (typeof iso !== "string" && typeof iso !== "number") return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

// ── the revocation flag ──────────────────────────────────────────────────────

/** @typedef {"cancelled" | "refunded"} GiftVoucherRevokeReason */

/** The attention key a revoked unit carries until the Shopify step resolved it. */
export const GIFT_VOUCHER_REVOKE_ATTENTION = Object.freeze({
  cancelled: "cancelled_after_use",
  refunded: "refund_after_use",
});

/** The deactivation reason stored when a revoked card is deactivated. */
export const GIFT_VOUCHER_REVOKE_REASON_TEXT = Object.freeze({
  cancelled: "Bestellung storniert",
  refunded: "Erstattet",
});

/**
 * The acknowledged form of a revoke flag: an operator cleared („Als geklärt
 * markieren“) the flag of a card Shopify showed (partly) spent. The key stays
 * on the row so the unit counts as revoked for good — a later order update
 * never flags it again — while it is neither „Achtung“ nor a revocation
 * (the mail may go out, the card stays active).
 */
export const GIFT_VOUCHER_REVOKE_ACK_ATTENTION = Object.freeze({
  cancelled: "cancelled_after_use_ok",
  refunded: "refund_after_use_ok",
});

/**
 * The revoke reason behind an attention key, or null for any other key
 * (an acknowledged key is no revocation any more).
 * @param {unknown} attention
 * @returns {GiftVoucherRevokeReason | null}
 */
export function revokeReasonOf(attention) {
  if (attention === GIFT_VOUCHER_REVOKE_ATTENTION.cancelled) return "cancelled";
  if (attention === GIFT_VOUCHER_REVOKE_ATTENTION.refunded) return "refunded";
  return null;
}

/**
 * Is this the acknowledged form of a revoke flag (GIFT_VOUCHER_REVOKE_ACK_ATTENTION)?
 * @param {unknown} attention
 */
export function isAcknowledgedRevocation(attention) {
  return attention === GIFT_VOUCHER_REVOKE_ACK_ATTENTION.cancelled || attention === GIFT_VOUCHER_REVOKE_ACK_ATTENTION.refunded;
}

/**
 * What to do with the Shopify card of a revoked voucher: deactivate it when
 * it is untouched (balance = initial value), record it when Shopify already
 * shows it deactivated, never deactivate a card somebody (partly) spent —
 * that stays for an operator (the flag then says „… aber schon eingelöst“).
 * @param {{ enabled: boolean, deactivatedAt: string | null, balanceCents: number, initialCents: number }} card
 * @returns {"already_deactivated" | "deactivate" | "used"}
 */
export function giftVoucherRevocationDecision(card) {
  if (!card.enabled || card.deactivatedAt) return "already_deactivated";
  if (card.balanceCents >= card.initialCents) return "deactivate";
  return "used";
}

/**
 * Issued vouchers whose revocation still has to be checked against Shopify:
 * status issued, a revoke flag, a card, and no stored balance below the
 * value yet (a stored lower balance means the check found the card used —
 * resolved, the flag stays for the operator). `recheckIds`: units an order
 * change flagged just now — checked whatever balance is stored, because a
 * balance read BEFORE the flag (the daily sync, „Abgleichen“) is no check of
 * it: the refund may still move to an untouched sibling.
 * @template {{ id: number, status: string, attention: string | null, shopifyGiftCardId: string | null, balanceCents: number | null, amountCents: number }} V
 * @param {readonly V[]} vouchers
 * @param {number} [limit]
 * @param {Iterable<number> | null} [recheckIds]
 * @returns {V[]}
 */
export function pickRevocationsToResolve(vouchers, limit = Infinity, recheckIds = null) {
  const recheck = new Set(recheckIds ?? []);
  const out = [];
  for (const v of vouchers) {
    if (out.length >= limit) break;
    if (v.status !== "issued" || !revokeReasonOf(v.attention) || !v.shopifyGiftCardId) continue;
    if (isKnownSpent(v) && !recheck.has(v.id)) continue;
    out.push(v);
  }
  return out;
}

/**
 * Does the stored balance say the card was (partly) spent? (A balance is
 * stored at issue, by the daily sync, „Abgleichen“ and a revocation check.)
 * @param {{ balanceCents?: number | null, amountCents?: number }} v
 */
function isKnownSpent(v) {
  return typeof v.balanceCents === "number" && typeof v.amountCents === "number" && v.balanceCents < v.amountCents;
}

/**
 * May a revoked voucher that never became a card be closed as cancelled when
 * the lookup by its code found nothing? Shopify's search can lag a few
 * seconds behind a create, so only when the row was last written at least
 * two minutes ago (an in-flight create has finished by then).
 * @param {{ updatedAt: string | Date | null | undefined, now?: number }} input
 */
export function isRevocationLookupConclusive({ updatedAt, now = Date.now() }) {
  const t = timeOf(updatedAt);
  return t !== null && now - t >= 2 * 60_000;
}

/**
 * A refund revoked a unit whose card turned out (partly) spent: which other
 * units of the same order line could take the refund instead? Issued units
 * with a card, no attention and the same value — highest unit first. Mo
 * checks a candidate's live card (untouched?) before it moves the flag.
 * @template {{ id: number, status: string, attention: string | null, shopifyGiftCardId: string | null,
 *   shopifyLineItemId: string | null, unitIndex: number, amountCents: number }} V
 * @param {V} unit
 * @param {readonly V[]} units the order's units
 * @returns {V[]}
 */
export function revocationSiblingCandidates(unit, units) {
  if (!unit.shopifyLineItemId) return [];
  return units
    .filter(
      (u) =>
        u.id !== unit.id &&
        u.shopifyLineItemId === unit.shopifyLineItemId &&
        u.status === "issued" &&
        u.attention == null &&
        Boolean(u.shopifyGiftCardId) &&
        u.amountCents === unit.amountCents
    )
    .sort((a, b) => b.unitIndex - a.unitIndex || b.id - a.id);
}

/**
 * What „Als geklärt markieren“ does with a voucher's attention flag:
 *   none        — there is none;
 *   keep        — an acknowledged revoke flag: it is „geklärt“ already and
 *                 stays (it keeps the unit revoked for later order updates);
 *   clear       — any other note (print, a failed deactivation …), or a
 *                 revoke flag on a unit that ended (cancelled, rejected,
 *                 deactivated — nothing is left to revoke);
 *   revoking    — a revoke flag on a unit that never became a known card
 *                 (pending, held, failed, issuing): Mo still looks the card
 *                 up — refused;
 *   resolve     — a revoke flag on an issued unit not checked against
 *                 Shopify yet, or any REFUND flag on an issued unit: check
 *                 now, live (untouched → deactivated; spent → for a refund
 *                 an untouched sibling takes it over, else acknowledged;
 *                 deactivated in Shopify meanwhile → recorded). A stored
 *                 balance that shows the card spent is no reason to skip
 *                 that for a refund — it may have been read before the
 *                 refund (daily sync, „Abgleichen“);
 *   acknowledge — a CANCELLATION flag on an issued unit already found
 *                 (partly) spent (stored balance below the value; every
 *                 unit of the order is revoked — no sibling can take it):
 *                 store the acknowledged key.
 * @param {{ status: string, attention: string | null, balanceCents: number | null, amountCents: number }} v
 * @returns {"none" | "keep" | "clear" | "revoking" | "resolve" | "acknowledge"}
 */
export function planClearGiftVoucherAttention(v) {
  if (!v.attention) return "none";
  if (isAcknowledgedRevocation(v.attention)) return "keep";
  const reason = revokeReasonOf(v.attention);
  if (!reason) return "clear";
  if (v.status === "cancelled" || v.status === "rejected" || v.status === "deactivated") return "clear";
  if (v.status !== "issued") return "revoking";
  return reason === "cancelled" && isKnownSpent(v) ? "acknowledge" : "resolve";
}

// ── orders/paid: the quick look ──────────────────────────────────────────────

/**
 * The cheap first look at an orders/paid payload: the numeric order id and
 * whether any line carries a valid voucher draft token (_mo_gv). Only the
 * product ids decide what a voucher is; the token tells that a voucher was
 * probably bought, so an unresolved product list must be retried.
 * @param {unknown} payload
 * @returns {{ orderId: string | null, hasDraftProperty: boolean }}
 */
export function giftVoucherOrderHint(payload) {
  const p = asObject(payload);
  if (!p) return { orderId: null, hasDraftProperty: false };
  const orderId = numericId(p.admin_graphql_api_id) ?? numericId(p.id);
  let hasDraftProperty = false;
  for (const raw of Array.isArray(p.line_items) ? p.line_items : []) {
    const li = asObject(raw);
    if (!li) continue;
    const props = li.properties;
    if (Array.isArray(props)) {
      for (const prop of props) {
        const o = asObject(prop);
        if (o && o.name === GIFT_VOUCHER_DRAFT_PROPERTY && isValidDraftToken(typeof o.value === "string" ? o.value.trim() : o.value)) {
          hasDraftProperty = true;
        }
      }
    } else {
      const o = asObject(props);
      const v = o ? o[GIFT_VOUCHER_DRAFT_PROPERTY] : null;
      if (isValidDraftToken(typeof v === "string" ? v.trim() : v)) hasDraftProperty = true;
    }
    if (hasDraftProperty) break;
  }
  return { orderId, hasDraftProperty };
}

// ── orders/paid: the rows ────────────────────────────────────────────────────

/**
 * @typedef {{
 *   id: number, token: string, designKey: string, recipientName: string | null, senderName: string | null,
 *   message: string | null, photoPathname: string | null,
 *   address: { name: string, addressLine1: string, addressLine2: string | null, postalCode: string, city: string, country: string } | null,
 * }} GiftVoucherDraftLike
 *
 * @typedef {{
 *   amountCents: number, currency: string, shopifyOrderId: string, shopifyOrderName: string | null,
 *   shopifyLineItemId: string, unitIndex: number, shopifyCustomerId: string | null,
 *   buyerEmail: string | null, buyerName: string | null, draftId: number | null, designKey: string,
 *   recipientName: string | null, senderName: string | null, message: string | null, photoPathname: string | null,
 *   delivery: "pdf" | "print", locale: "de" | "en", status: "pending" | "held", holdReason: string | null,
 *   attention: string | null, mailStatus: "pending" | "skipped",
 * }} PlannedGiftVoucherRow
 *
 * @typedef {{
 *   status: "review" | "queued",
 *   address: GiftVoucherDraftLike["address"],
 *   paidLineItemId: string,
 * }} PlannedGiftVoucherPrintJob
 *
 * @typedef {{
 *   units: Array<{ row: PlannedGiftVoucherRow, print: PlannedGiftVoucherPrintJob | null }>,
 *   skipped: Array<{ lineItemId: string, unitIndex: number, reason: "no_price" }>,
 *   unmatchedPrints: Array<{ lineItemId: string, missing: number }>,
 *   draftIds: number[],
 * }} GiftVoucherOrderRecordPlan
 */

/** Hold reasons the documented decision order puts before `currency`. */
const HOLDS_BEFORE_CURRENCY = new Set(["disabled", "test_order"]);

/**
 * The rows to record for a paid order (spec §9): one per voucher unit, with
 * the draft's design data (or the design defaults when the line carries no
 * known draft), buyer, locale, delivery `print` when a print add-on line
 * pays for the unit (else `pdf`), and its print job (`review` when an
 * operator wants to see photo cards first or the address is missing, else
 * `queued`). What the payload already decides is decided here — the feature
 * switched off, a test order, another currency, a discount on the voucher
 * line, a price outside the limits → the unit is recorded HELD with that
 * reason; the Shopify re-read at issue time decides the rest (cancelled,
 * paid, fraud risk, daily limit). A unit without a price cannot be a voucher
 * (amount > 0) and is skipped. Print lines that pay for no voucher flag the
 * order's first unit (`print_without_voucher`); lines with a voucher draft
 * on an unknown product (extract.unmatchedDraftLines) flag the first unit
 * without a flag (`unknown_product_line`).
 *
 * Another presentment currency (the buyer paid in CHF …): Shopify
 * back-converts shop money at the live rate, so the line's shop price is
 * rarely the face value the page sold. The unit's value is then the ordered
 * variant's own price (`variantPriceCents`: variant numeric id → its
 * shop-currency price in cents); an unknown variant is recorded held
 * `currency` with the shop-money amount — an operator decides. Orders paid
 * in the shop currency keep the line's shop price.
 *
 * @param {{
 *   extract: import("./gift-voucher-core.mjs").GiftVoucherOrderExtract,
 *   drafts: readonly GiftVoucherDraftLike[],
 *   enabled: boolean,
 *   allowTestOrders: boolean,
 *   limits: { minCents: number, maxCents: number },
 *   reviewPrintWithPhoto: boolean,
 *   variantPriceCents?: ReadonlyMap<string, number>,
 * }} input
 * @returns {GiftVoucherOrderRecordPlan}
 */
export function planGiftVoucherOrderRecord(input) {
  const { extract } = input;
  const order = extract.order;
  const draftsByToken = new Map(input.drafts.map((d) => [d.token, d]));
  const linesById = new Map(extract.vouchers.map((l) => [l.lineItemId, l]));
  const pairing = pairPrintLines(extract.vouchers, extract.prints);
  const foreign = Boolean(order.presentmentCurrency && order.currency && order.presentmentCurrency !== order.currency);

  /** @type {GiftVoucherOrderRecordPlan["units"]} */
  const units = [];
  /** @type {GiftVoucherOrderRecordPlan["skipped"]} */
  const skipped = [];
  const draftIds = new Set();

  for (const u of pairing.units) {
    const line = linesById.get(u.lineItemId);
    if (!line) continue;
    const shopCents = line.unitCents;
    if (typeof shopCents !== "number" || !Number.isSafeInteger(shopCents) || shopCents <= 0) {
      skipped.push({ lineItemId: u.lineItemId, unitIndex: u.unitIndex, reason: "no_price" });
      continue;
    }
    const variantCents = foreign && line.variantId ? input.variantPriceCents?.get(line.variantId) : undefined;
    const faceKnown = typeof variantCents === "number" && Number.isSafeInteger(variantCents) && variantCents > 0;
    const unitCents = foreign && faceKnown ? /** @type {number} */ (variantCents) : shopCents;
    const draft = line.draftToken ? draftsByToken.get(line.draftToken) ?? null : null;
    if (draft) draftIds.add(draft.id);

    // The payload part of the issuing decision (cancelled / paid / risk /
    // daily limit come from Shopify at issue time).
    const decision = decideGiftVoucherIssue({
      enabled: input.enabled,
      allowTestOrders: input.allowTestOrders,
      order: { test: order.test, cancelled: false, fullyPaid: true, currency: order.currency },
      line: { unitCents, discountCents: line.discountCents },
      limits: { minCents: input.limits.minCents, maxCents: input.limits.maxCents, dailyLimitCents: 0 },
      issuedTodayCents: 0,
      riskWaitExpired: true,
    });
    let held = decision.action === "hold";
    /** @type {string | null} */
    let holdReason = held ? decision.reason : null;
    if (foreign && !faceKnown && !(held && HOLDS_BEFORE_CURRENCY.has(String(holdReason)))) {
      held = true;
      holdReason = "currency";
    }

    const photoPathname = draft?.photoPathname ?? null;
    /** @type {PlannedGiftVoucherPrintJob | null} */
    let print = null;
    /** @type {string | null} */
    let attention = null;
    if (u.printLineItemId) {
      const address = draft?.address ?? null;
      if (!address) attention = "print_without_address";
      print = {
        status: !address || (input.reviewPrintWithPhoto && photoPathname) ? "review" : "queued",
        address,
        paidLineItemId: u.printLineItemId,
      };
    }

    units.push({
      row: {
        amountCents: unitCents,
        currency: order.currency ?? "EUR",
        shopifyOrderId: order.id,
        shopifyOrderName: order.name,
        shopifyLineItemId: u.lineItemId,
        unitIndex: u.unitIndex,
        shopifyCustomerId: order.shopifyCustomerId,
        buyerEmail: order.email,
        buyerName: order.customerName,
        draftId: draft?.id ?? null,
        designKey: draft?.designKey ?? "classic",
        recipientName: draft?.recipientName ?? null,
        senderName: draft?.senderName ?? null,
        message: draft?.message ?? null,
        photoPathname,
        delivery: u.printLineItemId ? "print" : "pdf",
        locale: order.locale === "en" ? "en" : "de",
        status: held ? "held" : "pending",
        holdReason: held ? holdReason : null,
        attention,
        mailStatus: order.email ? "pending" : "skipped",
      },
      print,
    });
  }

  if (pairing.unmatchedPrints.length > 0 && units.length > 0) {
    const target = units.find((x) => x.row.attention === null) ?? units[0];
    target.row.attention = "print_without_voucher";
  }
  if ((extract.unmatchedDraftLines?.length ?? 0) > 0) {
    // Never over another flag (attention is ONE column): when every unit is
    // flagged already, the order is under „Achtung“ anyway and the caller
    // reports the line.
    const target = units.find((x) => x.row.attention === null);
    if (target) target.row.attention = "unknown_product_line";
  }

  return { units, skipped, unmatchedPrints: pairing.unmatchedPrints, draftIds: [...draftIds] };
}

// ── orders/cancelled, orders/updated: what to revoke ─────────────────────────

/** Financial statuses that mean every unit's money went back (an amount-only refund lists no lines). */
const FULLY_REVOKED_FINANCIAL_STATUSES = new Set(["refunded", "voided"]);

/**
 * The parts of an order payload an order change needs: the order id, whether
 * it is cancelled (topic orders/cancelled or cancelled_at set), the ordered
 * quantity per line item, and the REVOKED quantity per line item — one rule
 * for every line: the larger of the units refunded so far (refund_line_items
 * over every refund) and the units the line no longer holds (quantity −
 * current_quantity: removed by an order edit, or refunded). An order whose
 * financial_status is `refunded` or `voided` revokes every unit of every line
 * — the money is back, whatever the refund lines say (a refund entered as an
 * amount lists none). Lines without a revoked unit are absent from `revoked`.
 * @param {unknown} payload
 * @param {string} topic
 * @returns {{ orderId: string | null, cancelled: boolean, revoked: Map<string, number>, lineQuantities: Map<string, number> }}
 */
export function giftVoucherOrderChangeFacts(payload, topic) {
  const p = asObject(payload);
  /** @type {Map<string, number>} */
  const lineQuantities = new Map();
  /** @type {Map<string, number>} */
  const revoked = new Map();
  if (!p) return { orderId: null, cancelled: false, revoked, lineQuantities };
  const refunded = refundedQuantities(payload);
  const fullyRevoked = FULLY_REVOKED_FINANCIAL_STATUSES.has(String(p.financial_status ?? "").trim().toLowerCase());
  for (const raw of Array.isArray(p.line_items) ? p.line_items : []) {
    const li = asObject(raw);
    if (!li) continue;
    const id = numericId(li.admin_graphql_api_id) ?? numericId(li.id);
    const q = li.quantity;
    if (!id || typeof q !== "number" || !Number.isSafeInteger(q) || q <= 0) continue;
    lineQuantities.set(id, q);
    const current = li.current_quantity;
    const removed = typeof current === "number" && Number.isSafeInteger(current) && current >= 0 ? Math.max(0, q - current) : 0;
    const n = fullyRevoked ? q : Math.min(q, Math.max(refunded.get(id) ?? 0, removed));
    if (n > 0) revoked.set(id, n);
  }
  // A refund line of a line the payload does not list still counts.
  for (const [id, n] of refunded) if (!lineQuantities.has(id)) revoked.set(id, n);
  const cancelledAt = typeof p.cancelled_at === "string" && p.cancelled_at.trim() !== "";
  return {
    orderId: numericId(p.admin_graphql_api_id) ?? numericId(p.id),
    cancelled: String(topic ?? "").trim().toLowerCase() === "orders/cancelled" || cancelledAt,
    revoked,
    lineQuantities,
  };
}

/**
 * @typedef {{
 *   id: number, status: string, hasCode: boolean, shopifyLineItemId: string | null, unitIndex: number,
 *   attention: string | null, amountCents: number, balanceCents: number | null,
 * }} ChangeVoucher
 * @typedef {{ id: number, voucherId: number, status: string, paidLineItemId: string | null }} ChangePrintJob
 * @typedef {{
 *   reason: GiftVoucherRevokeReason,
 *   attention: string,
 *   cancel: number[],
 *   recheck: Array<{ id: number, from: "pending" | "held" | "failed" }>,
 *   flagIssuing: number[],
 *   flagIssued: number[],
 *   cancelJobsNow: number[],
 *   cancelJobsLater: number[],
 *   revoked: number,
 * }} GiftVoucherOrderChangePlan
 */

const UNSUBMITTED_JOB = new Set(["review", "queued"]);
const FINAL_JOB = new Set(["sent", "failed", "cancelled", "done"]);
/** Print jobs whose card is not coming any more (planGiftVoucherFulfilment's „given up“). */
const GIVEN_UP_JOB = new Set(["cancelled", "failed"]);
const LIVE_UNIT_STATUSES = new Set(["pending", "held", "failed", "issuing", "issued"]);
/** Which live units of a line a revocation takes first: no card yet, then being issued, then issued. */
const REVOKE_ORDER = /** @type {Record<string, number>} */ ({ pending: 0, held: 0, failed: 0, issuing: 1, issued: 2 });
/** Statuses of a unit that never became a Shopify card (its print job was never submitted). */
const NEVER_CARDED = new Set(["pending", "held", "failed", "issuing", "cancelled", "rejected"]);

/**
 * Is a voucher unit still „live“ for an order change — one the order may
 * still pay for? Not when it ended (cancelled, rejected, deactivated) or
 * carries a revoke flag, its acknowledged form or a failed deactivation:
 * those count as revoked already.
 * @param {{ status: string, attention: string | null }} v
 */
export function isLiveGiftVoucherUnit(v) {
  return (
    LIVE_UNIT_STATUSES.has(v.status) &&
    !revokeReasonOf(v.attention) &&
    !isAcknowledgedRevocation(v.attention) &&
    v.attention !== "deactivate_failed"
  );
}

/**
 * What a cancellation or a refund revokes (spec §9 „Order change“) — ONE
 * rule per voucher line: the order still pays for paidQty = quantity −
 * revoked units of the line (facts.revoked: refunds, removals, a full refund;
 * 0 when cancelled), so `live − paidQty` of its live units are revoked
 * (isLiveGiftVoucherUnit) — units without a card first (pending / held /
 * failed), then issuing, then issued: among the issued ones those whose
 * stored balance does not show them (partly) spent first, then the spent
 * ones; the highest unit first within each group. Units never created (a
 * unit removed before payment) and units revoked earlier therefore count as
 * gone, and a repeated webhook revokes nothing. Which unit of a refunded line
 * is revoked is Mo's choice (Shopify's refund lines carry only a quantity) —
 * a card known to be spent is the last choice, and should the choice still
 * be a (partly) spent card (the stored balance is a day old at most), the
 * Shopify step moves the refund to an untouched sibling.
 * Per revoked unit, by status:
 *   pending / held / failed, no code yet → `cancel` (no card exists);
 *   pending / held / failed WITH a code (an earlier create may have made a
 *     card) → `recheck`: back to pending with the revoke flag — the issuing
 *     step looks the card up by its code and deactivates or cancels;
 *   issuing → `flagIssuing` (the issuing step resolves it, even mid-create);
 *   issued → `flagIssued` (the Shopify step: unused → deactivate, used →
 *     the flag stays for an operator).
 * `revoked` counts the units revoked by THIS change.
 * Print jobs: the job of every revoked unit that never became a card is
 * cancelled (it was never submitted). A print add-on line follows the same
 * rule as a voucher line: it still pays for quantity − revoked cards, so its
 * jobs above that are cancelled — a card never created (removed before
 * payment, or paid without a voucher to print it for) counts as gone, and so
 * does a job given up already. Which jobs: those of units revoked now or
 * before first (their cards go anyway), then jobs already cancelled or
 * failed, then the highest units. A job is cancelled at once
 * (`cancelJobsNow`, database only) only when its voucher never became a card
 * — the print pipeline takes nothing else; any other job goes through the
 * print provider (`cancelJobsLater`), which knows whether it is with the
 * printer already. Run it again once the revocations are resolved (a refund
 * that moved to an untouched sibling took that sibling's card along).
 * `revokedEarlier`: units this order change revoked in an earlier round (a
 * write found its row changed and the change was planned again on fresh
 * rows) — they count as gone like any revoked unit, and the cards of those
 * that never became a card go as if they were revoked now.
 *
 * @param {{
 *   facts: { cancelled: boolean, revoked: Map<string, number>, lineQuantities: Map<string, number> },
 *   vouchers: readonly ChangeVoucher[],
 *   printJobs: readonly ChangePrintJob[],
 *   revokedEarlier?: Iterable<number> | null,
 * }} input
 * @returns {GiftVoucherOrderChangePlan}
 */
export function planGiftVoucherOrderChange({ facts, vouchers, printJobs, revokedEarlier = null }) {
  const reason = facts.cancelled ? "cancelled" : "refunded";
  const attention = GIFT_VOUCHER_REVOKE_ATTENTION[reason];

  /** @type {Map<string, ChangeVoucher[]>} */
  const byLine = new Map();
  for (const v of vouchers) {
    if (!v.shopifyLineItemId) continue;
    const list = byLine.get(v.shopifyLineItemId) ?? [];
    list.push(v);
    byLine.set(v.shopifyLineItemId, list);
  }

  /** @type {Set<number>} units this change revokes */
  const revokedIds = new Set();
  for (const [lineItemId, list] of byLine) {
    const known = facts.lineQuantities.get(lineItemId);
    const quantity = known ?? Math.max(...list.map((v) => v.unitIndex)) + 1;
    const paidQty = facts.cancelled ? 0 : Math.max(0, quantity - (facts.revoked.get(lineItemId) ?? 0));
    const live = list.filter(isLiveGiftVoucherUnit);
    const n = Math.max(0, live.length - paidQty);
    if (n === 0) continue;
    // A card known to be spent goes last: deactivating an untouched one loses nothing.
    const spent = (/** @type {ChangeVoucher} */ v) => (v.status === "issued" && isKnownSpent(v) ? 1 : 0);
    const ordered = [...live].sort(
      (a, b) =>
        (REVOKE_ORDER[a.status] ?? 0) - (REVOKE_ORDER[b.status] ?? 0) || spent(a) - spent(b) || b.unitIndex - a.unitIndex || b.id - a.id
    );
    for (const v of ordered.slice(0, n)) revokedIds.add(v.id);
  }

  /** @type {GiftVoucherOrderChangePlan} */
  const plan = {
    reason,
    attention,
    cancel: [],
    recheck: [],
    flagIssuing: [],
    flagIssued: [],
    cancelJobsNow: [],
    cancelJobsLater: [],
    revoked: 0,
  };
  /** @type {Set<number>} vouchers that never became a card — their jobs go */
  const unissued = new Set();
  for (const v of vouchers) {
    if (!revokedIds.has(v.id)) continue;
    plan.revoked++;
    if (v.status === "pending" || v.status === "held" || v.status === "failed") {
      unissued.add(v.id);
      if (v.hasCode) plan.recheck.push({ id: v.id, from: v.status });
      else plan.cancel.push(v.id);
    } else if (v.status === "issuing") {
      unissued.add(v.id);
      plan.flagIssuing.push(v.id);
    } else {
      plan.flagIssued.push(v.id);
    }
  }
  // Revoked by this order change in an earlier round: a unit that never
  // became a card has its job cancelled as if it were revoked now.
  const earlier = new Set(revokedEarlier ?? []);
  for (const v of vouchers) if (earlier.has(v.id) && !revokedIds.has(v.id) && NEVER_CARDED.has(v.status)) unissued.add(v.id);
  /** @type {Set<number>} units revoked now or before — their cards are the first to go */
  const gone = new Set(vouchers.filter((v) => revokedIds.has(v.id) || !isLiveGiftVoucherUnit(v)).map((v) => v.id));

  // Vouchers that are (or were) a card: their jobs may be in the print
  // pipeline's hands.
  const carded = new Set(vouchers.filter((v) => v.status === "issued" || v.status === "deactivated").map((v) => v.id));
  /** @type {Set<number>} */
  const now = new Set();
  /** @type {Set<number>} */
  const later = new Set();
  /** @param {ChangePrintJob} j */
  const cancelJob = (j) => {
    if (FINAL_JOB.has(j.status)) return;
    if (UNSUBMITTED_JOB.has(j.status) && !carded.has(j.voucherId)) now.add(j.id);
    else later.add(j.id);
  };
  for (const j of printJobs) if (unissued.has(j.voucherId)) cancelJob(j);

  const unitOf = new Map(vouchers.map((v) => [v.id, v.unitIndex]));
  /** @type {Map<string, ChangePrintJob[]>} */
  const jobsByLine = new Map();
  for (const j of printJobs) {
    if (!j.paidLineItemId) continue;
    const list = jobsByLine.get(j.paidLineItemId) ?? [];
    list.push(j);
    jobsByLine.set(j.paidLineItemId, list);
  }
  for (const [lineItemId, list] of jobsByLine) {
    // The voucher lines' rule: the line still pays for quantity − revoked
    // cards; its jobs above that go. A card never created (fewer jobs than
    // the line's quantity) therefore counts as gone already.
    const quantity = facts.lineQuantities.get(lineItemId) ?? list.length;
    const paidQty = facts.cancelled ? 0 : Math.max(0, quantity - (facts.revoked.get(lineItemId) ?? 0));
    const n = Math.max(0, list.length - paidQty);
    if (n === 0) continue;
    const ordered = [...list].sort((a, b) => {
      const ra = gone.has(a.voucherId) ? 0 : 1;
      const rb = gone.has(b.voucherId) ? 0 : 1;
      if (ra !== rb) return ra - rb;
      const ga = GIVEN_UP_JOB.has(a.status) ? 0 : 1;
      const gb = GIVEN_UP_JOB.has(b.status) ? 0 : 1;
      if (ga !== gb) return ga - gb;
      return (unitOf.get(b.voucherId) ?? 0) - (unitOf.get(a.voucherId) ?? 0) || b.id - a.id;
    });
    for (const j of ordered.slice(0, n)) cancelJob(j);
  }
  for (const id of now) later.delete(id);
  plan.cancelJobsNow = [...now];
  plan.cancelJobsLater = [...later];
  return plan;
}

/**
 * The writes of one order-change plan, in the order they are made — every
 * one compare-and-set on the row exactly as the plan read it (`rowVersion`:
 * the read's updated_at; every write of a unit's state moves it). The plan
 * chose its units from the whole line, which a parallel delivery and an
 * earlier delivery's Shopify step rewrite meanwhile (a refund moved to an
 * untouched sibling, a card deactivated, a unit issued): a write on a row
 * that changed since the read would revoke a second unit for one refund, or
 * flag a card that is gone. Such a write must not land; the change is then
 * planned again on fresh rows (handleGiftVoucherOrderChange). The attention
 * alone is no such check — after a moved refund it is NULL again (ABA).
 *   cancel  — pending / held / failed without a code → cancelled
 *             (`mailPending`: its unsent mail is skipped after the write);
 *   recheck — pending / held / failed with a code → pending with the flag;
 *   flag    — issuing / issued → the flag.
 * null when a planned unit was read without a version: nothing may be
 * written on that plan.
 * @param {GiftVoucherOrderChangePlan} plan
 * @param {readonly { id: number, rowVersion?: string | null, mailStatus?: string | null }[]} vouchers the rows the plan read
 * @returns {Array<
 *   | { op: "cancel", id: number, version: string, mailPending: boolean }
 *   | { op: "recheck", id: number, from: "pending" | "held" | "failed", version: string }
 *   | { op: "flag", id: number, version: string }
 * > | null}
 */
export function planGiftVoucherOrderChangeWrites(plan, vouchers) {
  const read = new Map(vouchers.map((v) => [v.id, v]));
  /** @param {number} id */
  const versionOf = (id) => {
    const version = read.get(id)?.rowVersion;
    return typeof version === "string" && version !== "" ? version : null;
  };
  /** @type {NonNullable<ReturnType<typeof planGiftVoucherOrderChangeWrites>>} */
  const writes = [];
  for (const id of plan.cancel) {
    const version = versionOf(id);
    if (!version) return null;
    writes.push({ op: "cancel", id, version, mailPending: read.get(id)?.mailStatus === "pending" });
  }
  for (const r of plan.recheck) {
    const version = versionOf(r.id);
    if (!version) return null;
    writes.push({ op: "recheck", id: r.id, from: r.from, version });
  }
  for (const id of [...plan.flagIssuing, ...plan.flagIssued]) {
    const version = versionOf(id);
    if (!version) return null;
    writes.push({ op: "flag", id, version });
  }
  return writes;
}

// ── issuing: timing and outcomes ─────────────────────────────────────────────

/**
 * After a failed try (attempts = failed tries so far, before this one): the
 * next due time by planGiftVoucherRetry, or hold `attempts` after the tenth.
 * @param {{ attempts: number, now?: number }} input
 * @returns {{ action: "retry", at: Date } | { action: "hold", reason: "attempts" }}
 */
export function planGiftVoucherIssueRetry({ attempts, now = Date.now() }) {
  const n = Number.isSafeInteger(attempts) && attempts >= 0 ? attempts : 0;
  const minutes = planGiftVoucherRetry(n + 1);
  return minutes == null ? { action: "hold", reason: "attempts" } : { action: "retry", at: new Date(now + minutes * 60_000) };
}

/**
 * A deferral that is no failure (no attempt counted): Shopify's fraud check
 * still PENDING → look again in 5 minutes (decideGiftVoucherIssue issues
 * once the wait has expired); not fully paid → every 30 minutes, held
 * `not_paid` once the unit waited 24 hours.
 * @param {{ reason: string | null, createdAt: string | Date | null, now?: number }} input
 * @returns {{ action: "retry", at: Date, message: string } | { action: "hold", reason: "not_paid" }}
 */
export function planGiftVoucherDeferral({ reason, createdAt, now = Date.now() }) {
  if (reason === "risk_pending") {
    return { action: "retry", at: new Date(now + 5 * 60_000), message: "Shopify prüft das Betrugsrisiko noch — Mo wartet." };
  }
  const created = timeOf(createdAt) ?? now;
  if (now - created >= 24 * 60 * 60_000) return { action: "hold", reason: "not_paid" };
  return { action: "retry", at: new Date(now + 30 * 60_000), message: "Die Bestellung ist noch nicht vollständig bezahlt — Mo wartet." };
}

/**
 * Has the fraud-check wait run out? (GIFT_VOUCHER_RISK_WAIT_MINUTES since
 * the unit was recorded, i.e. since payment.)
 * @param {{ createdAt: string | Date | null, riskWaitMinutes: number, now?: number }} input
 */
export function isRiskWaitExpired({ createdAt, riskWaitMinutes, now = Date.now() }) {
  const created = timeOf(createdAt);
  if (created === null) return true;
  return now - created >= Math.max(0, riskWaitMinutes) * 60_000;
}

/**
 * The next step after giftCardCreate failed (shopify-gift-cards.ts kinds):
 * `taken` / `unknown` — the card may exist (ours, from an attempt whose
 * answer got lost) → look it up by the code; `denied` / `unconfigured` →
 * retry later (an operator fixes the scope or configuration); `invalid` /
 * `limit` → Shopify will not change its mind → failed.
 * @param {string} kind
 * @returns {"lookup" | "retry" | "fail"}
 */
export function nextStepAfterCreateFailure(kind) {
  if (kind === "taken" || kind === "unknown") return "lookup";
  if (kind === "invalid" || kind === "limit") return "fail";
  return "retry";
}

/**
 * May a card found by the voucher's code be adopted as the voucher's card?
 * Only an active card of exactly the voucher's value (the code is Mo's own,
 * so anything else is somebody else's card or a deactivated one).
 * @param {{ enabled: boolean, deactivatedAt: string | null, initialCents: number }} card
 * @param {number} amountCents
 * @returns {{ ok: true } | { ok: false, reason: "disabled" | "amount", message: string }}
 */
export function adoptableGiftCard(card, amountCents) {
  if (!card.enabled || card.deactivatedAt) {
    return { ok: false, reason: "disabled", message: "Der Code gehört zu einer gesperrten Shopify-Karte — bitte in Shopify prüfen." };
  }
  if (card.initialCents !== amountCents) {
    return { ok: false, reason: "amount", message: "Der Code gehört in Shopify zu einer Karte mit anderem Wert — bitte in Shopify prüfen." };
  }
  return { ok: true };
}

/**
 * The internal note on the Shopify card (never shown to customers): the
 * voucher number plus the order, or the reason of an operator's voucher.
 * @param {{ number: string, source: string, orderName?: string | null, reason?: string | null }} v
 */
export function giftCardNote(v) {
  const base = `Mo-Geschenkgutschein ${v.number}`;
  if (v.source === "shop") return v.orderName ? `${base} · Bestellung ${v.orderName}` : base;
  const label = /** @type {Record<string, string>} */ (GIFT_VOUCHER_REASON_LABELS)[String(v.reason ?? "")] ?? "Sonstiges";
  return `${base} · ${label} (von Hand)`;
}

// ── fulfilment ───────────────────────────────────────────────────────────────

const PRINT_DONE = new Set(["submitted", "printing", "sent", "done"]);
const PRINT_GIVEN_UP = new Set(["cancelled", "failed"]);

/**
 * Which order lines can be marked fulfilled in Shopify
 * (GIFT_VOUCHER_FULFILL_ORDERS), and which voucher rows are then done:
 *   · a voucher line when every one of its units became a card (issued,
 *     possibly deactivated later) — a unit that never became one (held,
 *     rejected …) keeps the line open for an operator;
 *   · a print add-on line when every job it paid for is with the printer or
 *     done and none is still waiting (cancelled / failed jobs do not count);
 *   · a unit is done when its voucher line is fulfilled and its print line
 *     too (or it has no print job, or its job was given up).
 * Only lines with at least one unit not yet marked are returned.
 *
 * @param {readonly { id: number, shopifyLineItemId: string | null, issuedAt: string | null, fulfilledAt: string | null }[]} units
 * @param {readonly { voucherId: number, status: string, paidLineItemId: string | null }[]} jobs
 * @returns {{ lineItemIds: string[], voucherIds: number[] }}
 */
export function planGiftVoucherFulfilment(units, jobs) {
  /** @type {Map<string, typeof units[number][]>} */
  const byLine = new Map();
  for (const u of units) {
    if (!u.shopifyLineItemId) continue;
    const list = byLine.get(u.shopifyLineItemId) ?? [];
    list.push(u);
    byLine.set(u.shopifyLineItemId, list);
  }
  const readyLines = new Set();
  for (const [line, list] of byLine) {
    if (list.every((u) => u.issuedAt != null)) readyLines.add(line);
  }
  /** @type {Map<string, typeof jobs[number][]>} */
  const jobsByPrintLine = new Map();
  for (const j of jobs) {
    if (!j.paidLineItemId) continue;
    const list = jobsByPrintLine.get(j.paidLineItemId) ?? [];
    list.push(j);
    jobsByPrintLine.set(j.paidLineItemId, list);
  }
  const readyPrintLines = new Set();
  for (const [line, list] of jobsByPrintLine) {
    const live = list.filter((j) => !PRINT_GIVEN_UP.has(j.status));
    if (live.length > 0 && live.every((j) => PRINT_DONE.has(j.status))) readyPrintLines.add(line);
  }
  const jobOf = new Map(jobs.map((j) => [j.voucherId, j]));
  const lineItemIds = new Set();
  const voucherIds = [];
  for (const u of units) {
    if (u.fulfilledAt != null || !u.shopifyLineItemId || !readyLines.has(u.shopifyLineItemId)) continue;
    const job = jobOf.get(u.id);
    const printLine = job && job.paidLineItemId && !PRINT_GIVEN_UP.has(job.status) ? job.paidLineItemId : null;
    if (printLine && !readyPrintLines.has(printLine)) continue;
    lineItemIds.add(u.shopifyLineItemId);
    if (printLine) lineItemIds.add(printLine);
    voucherIds.push(u.id);
  }
  return { lineItemIds: [...lineItemIds], voucherIds };
}
