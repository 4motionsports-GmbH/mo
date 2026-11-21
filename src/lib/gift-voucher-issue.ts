// Geschenkgutscheine — the issuing pipeline (spec §9; docs/GIFT_VOUCHERS.md).
//
// From a paid order to a Shopify gift card in the buyer's inbox:
//   orders/paid  → recordGiftVoucherOrder (synchronous, fast: one row per
//                  unit, print jobs) → the webhook's after() runs
//                  processGiftVoucherOrder (claim → re-read the order →
//                  decide → issue → mail → print);
//   cron         → runGiftVoucherSweep every 5 minutes (retries, revocations,
//                  due mails, print queue, balances, fulfilment);
//   orders/cancelled, orders/updated (refunds) → handleGiftVoucherOrderChange
//                  (synchronous DB part) + processGiftVoucherOrderChange
//                  (after(): Shopify / print.one part);
//   the admin    → issue held, reject, retry, issue by hand, resend,
//                  deactivate, sync the balance.
// The decisions are pure and tested: gift-voucher-core.mjs (single unit) and
// gift-voucher-issue-core.mjs (record plan, order changes, retries,
// fulfilment).
//
// HOW A UNIT BECOMES A CARD (issueOne, the only place that issues):
//   1. the caller holds the row's lease (locked_until, 3 minutes —
//      claimDueGiftVouchers / claimGiftVoucher, FOR UPDATE SKIP LOCKED), so
//      the webhook's after(), the cron sweep and an admin click never work on
//      the same row at once;
//   2. a shop unit: the order as Shopify sees it NOW (cancelled → revoke;
//      refunded already → hold `refunded`; decideGiftVoucherIssue with
//      today's issued sum read right before → hold / defer / issue); an admin
//      unit skips the order;
//   3. the code is generated and stored ENCRYPTED with status `issuing`
//      BEFORE Shopify sees it (markGiftVoucherIssuing — never replaces a
//      stored code; for a shop unit also the daily limit's hard cap: one
//      reservation at a time under an advisory lock, over the limit → held
//      `daily_limit`), then giftCardCreate with that code. A lost answer is
//      resolved by the code: the next try gets TAKEN (Shopify's codes are
//      unique) and adopts the card it finds by the code — never a second card;
//   4. `issued` with the hash of the first mail attempt's download token
//      (derived per attempt — the mail rebuilds the same link), then the mail
//      and the print job — failures there never undo the card, the sweep
//      retries them.
//
// REVOCATION (order cancelled, a voucher line refunded or removed, the order
// refunded in full): one rule per line — the order still pays for quantity −
// revoked units, so the live units above that are revoked, units without a
// card first and cards the stored balance shows spent last
// (planGiftVoucherOrderChange). A unit that never became a card is
// cancelled at once; any other unit gets the attention flag
// `cancelled_after_use` / `refund_after_use` as the DURABLE intent before the
// webhook is acknowledged. The Shopify step then resolves it — untouched card
// → deactivated (flag cleared, card print cancelled); (partly) spent card →
// for a refund an untouched sibling of the same line takes the refund over
// (one conditional move, a single winner) and is deactivated instead, else
// never deactivated automatically: the flag stays for an operator, whose
// „Als geklärt markieren“ stores its acknowledged form (no „Achtung“, never
// flagged again); a transient Shopify failure keeps the flag for the next
// try. A stored balance below the value marks a flag as checked, so for a
// flagged card only that check writes it (the balance sync resolves the
// flag instead), and a flag set by an order change is checked by its after()
// whatever balance was stored before. Whoever comes first finishes it: the
// webhook's after(), the issuing step (also for a flag that landed while the
// card was being created), the balance sync or the sweep. The card prints of
// a refunded add-on line follow the same rule per line and are decided once
// the flags are resolved.
//
// FAILURE MODES (see also the notes in docs/GIFT_VOUCHERS.md):
//   · webhook slow / Shopify product list not loaded → recordGiftVoucherOrder
//     uses the last good lookup stored for the same handles; with none it
//     answers ok:false when a line carries a voucher draft (the route forgets
//     the delivery, Shopify redelivers, the insert is idempotent per (order,
//     line, unit)) and reports every other order as not checked;
//   · a draft on a product Mo does not know → one fresh lookup, then reported
//     (no voucher matched → ok:false, Shopify redelivers); the drafts not
//     readable → ok:false before anything is written;
//   · a worker dies anywhere → its lease runs out after 3 minutes and the
//     sweep continues from the stored state (a stored code is reused);
//   · Shopify errors → retry by planGiftVoucherRetry (1 … 720 minutes), held
//     `attempts` on the eleventh failed try (after ten retries); `invalid` /
//     `limit` → failed;
//   · TOKEN_ENC_KEY missing → no code is ever generated (retry, then held);
//   · mail / print failures → their own retry state (mail_*, print job).
//
// Every export answers a typed result and never throws (webhook, cron and
// admin callers rely on it). reportError context carries ids and phases,
// never a code, a token, a name or an e-mail address.

import { reportError } from "./observability";
import {
  claimDueGiftVouchers,
  claimGiftVoucher,
  getCachedGiftVoucherSettings,
  getGiftVoucher,
  getGiftVoucherCode,
  getGiftVoucherDraftsByTokens,
  getGiftVoucherProductsSnapshot,
  getGiftVoucherPrintJob,
  getGiftVoucherPrintJobForVoucher,
  insertAdminGiftVoucher,
  insertGiftVoucherPrintJob,
  insertShopGiftVouchers,
  listGiftVouchers,
  listGiftVouchersDueForMail,
  listGiftVouchersForBalanceSync,
  listGiftVouchersForOrder,
  listGiftVoucherOrdersToFulfil,
  markGiftVoucherDeactivated,
  markGiftVoucherDraftsOrdered,
  markGiftVoucherFailed,
  markGiftVoucherFulfilled,
  markGiftVoucherHeld,
  markGiftVoucherIssued,
  markGiftVoucherIssuing,
  moveGiftVoucherRevocation,
  prepareGiftVoucherCode,
  releaseGiftVoucherLock,
  replaceGiftVoucherAttention,
  scheduleGiftVoucherRetry,
  setGiftVoucherAdminNote,
  setGiftVoucherAttention,
  setGiftVoucherMailState,
  setGiftVoucherStatus,
  sumShopGiftVouchersIssuedToday,
  updateGiftVoucherBalance,
  updateGiftVoucherPrintJobStatus,
  type GiftVoucher,
  type GiftVoucherAddress,
  type GiftVoucherDelivery,
  type GiftVoucherReason,
} from "./gift-voucher-store";
import {
  createShopifyGiftCard,
  deactivateShopifyGiftCard,
  findShopifyGiftCardByCode,
  fulfillGiftVoucherLines,
  getGiftVoucherOrderSnapshot,
  getShopifyGiftCard,
  resolveGiftVoucherProducts,
  type ShopifyGiftCardInfo,
} from "./shopify-gift-cards";
import { giftVoucherProductsFromSnapshot, type GiftVoucherKnownProducts } from "./shopify-gift-cards-core.mjs";
import {
  GIFT_VOUCHER_HOLD_REASON_LABELS,
  GIFT_VOUCHER_TEXT_LIMITS,
  decideGiftVoucherIssue,
  decideManualGiftVoucher,
  extractGiftVoucherOrder,
  generateGiftVoucherCode,
  giftVoucherExpiryDate,
  hashOpaqueToken,
  isFinalPrintJobStatus,
  sanitizeGiftVoucherText,
  validatePostalAddress,
} from "./gift-voucher-core.mjs";
import {
  giftVoucherLimits,
  giftVoucherPrintCountries,
  giftVoucherProductHandles,
  giftVoucherRiskWaitMinutes,
  giftVoucherValidityYears,
  isGiftVoucherFulfillOrdersEnabled,
  isGiftVoucherTestOrdersAllowed,
  isGiftVouchersEnabled,
} from "./gift-voucher-flags.mjs";
import {
  GIFT_VOUCHER_REVOKE_ACK_ATTENTION,
  GIFT_VOUCHER_REVOKE_ATTENTION,
  GIFT_VOUCHER_REVOKE_REASON_TEXT,
  adoptableGiftCard,
  giftCardNote,
  giftVoucherOrderChangeFacts,
  giftVoucherOrderHint,
  giftVoucherRevocationDecision,
  isAcknowledgedRevocation,
  isRevocationLookupConclusive,
  isRiskWaitExpired,
  nextStepAfterCreateFailure,
  pickRevocationsToResolve,
  planClearGiftVoucherAttention,
  planGiftVoucherDeferral,
  planGiftVoucherFulfilment,
  planGiftVoucherIssueRetry,
  planGiftVoucherOrderChange,
  planGiftVoucherOrderRecord,
  revocationSiblingCandidates,
  revokeReasonOf,
  type GiftVoucherRevokeReason,
} from "./gift-voucher-issue-core.mjs";
import { giftVoucherMailTarget } from "./gift-voucher-mail-core.mjs";
import { giftVoucherAttemptDownloadToken, sendGiftVoucherMail } from "./gift-voucher-mail";
import {
  cancelGiftVoucherPrintJob,
  cleanupGiftVoucherPrintAssets,
  giftVoucherPrintProvider,
  pollGiftVoucherPrintJobs,
  submitDueGiftVoucherPrintJobs,
  submitGiftVoucherPrintJob,
} from "./gift-voucher-print";

const ROUTE = "lib/gift-voucher-issue";

/** How long the orders/paid webhook waits for a cold product lookup (Shopify fails a delivery after 5 s). */
const PRODUCTS_TIMEOUT_MS = 2_500;
/** The second, fresh look when a draft sits on an unknown product (part of the 5 s is spent already). */
const FRESH_PRODUCTS_TIMEOUT_MS = 1_500;
/** The webhook's after() work (route maxDuration 60 s, the answer already took up to 5 s). */
const AFTER_BUDGET_MS = 45_000;
/** An admin click that issues right away (snappy; the sweep finishes what does not fit). */
const ADMIN_BUDGET_MS = 25_000;
/** The sweep's default budget (cron maxDuration 120 s). */
const SWEEP_BUDGET_MS = 100_000;
/** Time a unit needs at least: order snapshot + giftCardCreate (each bounded at 30 s in the client, usually < 1 s). */
const MIN_ISSUE_MS = 20_000;
/** Time the mail needs at least (PDF render + Resend). */
const MIN_MAIL_MS = 12_000;
/** Time a print submission needs at least (two print spreads, Blob upload, print.one). */
const MIN_PRINT_MS = 25_000;
/** Time a small sweep step needs at least. */
const MIN_STEP_MS = 8_000;
/** Sweep limits per run (spec §9). */
const SWEEP_ISSUE_LIMIT = 20;
const SWEEP_CLAIM_BATCH = 5;
const SWEEP_MAIL_LIMIT = 20;
const SWEEP_REVOKE_LIMIT = 10;
const SWEEP_REVOKE_PAGES = 5;
const SWEEP_BALANCE_LIMIT = 15;
const SWEEP_FULFIL_ORDERS = 5;
/** A soft claim on a due mail: a parallel run skips it this long (the send writes the real state). */
const MAIL_CLAIM_MS = 15 * 60_000;

/** Order statuses that mean money went back before the card existed (the pipeline holds `refunded`). */
const REFUNDED_ORDER_STATUSES = new Set(["REFUNDED", "PARTIALLY_REFUNDED", "VOIDED"]);
/** … of which no operator may issue: all the money is back (PARTIALLY_REFUNDED may concern another line). */
const FULLY_REFUNDED_ORDER_STATUSES = new Set(["REFUNDED", "VOIDED"]);

/** Report without PII: the route, a phase and ids at most. */
function report(err: unknown, phase: string, extra: Record<string, string | number | null> = {}): void {
  reportError(err, { route: ROUTE, phase, ...extra });
}

/** Run an I/O step that should never throw — but might (another part's code). */
async function guarded<T>(phase: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    report(err, phase);
    return fallback;
  }
}

type Fail = { ok: false; code: string; message: string };
const fail = (code: string, message: string): Fail => ({ ok: false, code, message });
const NOT_FOUND = () => fail("not_found", "Gutschein nicht gefunden.");
const CONFLICT = () => fail("conflict", "Der Gutschein wurde inzwischen geändert — bitte neu laden.");
const REFUNDED = () =>
  fail("refunded", "Die Bestellung wurde erstattet — der Gutschein kann nicht ausgestellt werden. Bitte in Shopify prüfen und „Ablehnen“.");
const PURGED = () => fail("purged", "Die Daten dieses Gutscheins wurden nach Ablauf der Aufbewahrungsfrist gelöscht — bitte ablehnen.");

// ── orders/paid ──────────────────────────────────────────────────────────────

/** The product ids extractGiftVoucherOrder recognises lines by. */
function productIdsOf(products: GiftVoucherKnownProducts) {
  return {
    voucherProductIds: products.voucher ? [products.voucher.numericId] : [],
    printProductIds: products.print ? [products.print.numericId] : [],
  };
}

/** The last good product lookup, stored for the handles configured NOW — or null. */
async function storedGiftVoucherProducts(): Promise<GiftVoucherKnownProducts | null> {
  return giftVoucherProductsFromSnapshot(await getGiftVoucherProductsSnapshot(), giftVoucherProductHandles());
}

/**
 * orders/paid: record the voucher units of a paid order — fast (the webhook
 * must answer within 5 s) and never throws. `ok: false` makes the route
 * forget the delivery so Shopify redelivers (products not resolvable while a
 * line carries a voucher draft, a draft on an unknown product with no
 * voucher matched, the drafts not readable, a database error); the insert is
 * idempotent per (order, line item, unit). `created` = units of the order now
 * recorded.
 */
export async function recordGiftVoucherOrder(
  payload: unknown
): Promise<{ ok: true; action: string; orderId: string | null; created: number } | { ok: false; action: string }> {
  try {
    const hint = giftVoucherOrderHint(payload);
    if (!hint.orderId) return { ok: true, action: "gift_vouchers:no-order", orderId: null, created: 0 };
    const orderId = hint.orderId;

    // 1) The voucher products: the live lookup (cached 10 minutes per
    //    instance; a cold cache waits PRODUCTS_TIMEOUT_MS, the load keeps
    //    warming the cache) — while Shopify does not answer, the last good
    //    lookup stored for the same handles, exactly like a live one.
    const live = await resolveGiftVoucherProducts({ timeoutMs: PRODUCTS_TIMEOUT_MS });
    let products: GiftVoucherKnownProducts | null = live.ok ? live : await storedGiftVoucherProducts();
    if (!products) {
      // A voucher was (probably) bought: Shopify's redelivery tries again.
      // Without a draft token nothing points to a voucher — every order of
      // the shop passes here, so an unreachable Shopify must not fail them;
      // the order is reported so an operator can check it.
      if (hint.hasDraftProperty) return { ok: false, action: "gift_vouchers:products-unavailable" };
      report(new Error("orders/paid: voucher products not resolvable — order not checked"), "unchecked", { orderId });
      return { ok: true, action: "gift_vouchers:unchecked", orderId, created: 0 };
    }
    if (!products.voucher) {
      if (hint.hasDraftProperty) {
        report(new Error("orders/paid: a line carries a voucher draft, but no voucher product is found by its handle"), "productMissing", {
          orderId,
        });
        return { ok: false, action: "gift_vouchers:product-missing" };
      }
      return { ok: true, action: "gift_vouchers:none", orderId, created: 0 };
    }
    if (products.voucher.isGiftCard) {
      // A Shopify gift-card product issues (and mails) its own card — Mo
      // must never add a second one. The setup check shows the mistake.
      report(new Error("orders/paid: the voucher product is a Shopify gift-card product — Mo issues nothing"), "giftCardProduct", {
        orderId,
      });
      return { ok: true, action: "gift_vouchers:gift-card-product", orderId, created: 0 };
    }

    // 2) The lines. A voucher draft on a product Mo does not know — the
    //    theme sells another product than Mo's handles name, or the ids are
    //    stale (a product re-created under its handle): one fresh look, then
    //    it is reported. Such a line never becomes a voucher (its price is no
    //    voucher price).
    let extract = extractGiftVoucherOrder(payload, productIdsOf(products));
    if (!extract) return { ok: true, action: "gift_vouchers:none", orderId, created: 0 };
    if (extract.unmatchedDraftLines.length > 0) {
      const fresh = await resolveGiftVoucherProducts({ fresh: true, timeoutMs: FRESH_PRODUCTS_TIMEOUT_MS });
      if (fresh.ok && fresh.voucher && !fresh.voucher.isGiftCard) {
        products = fresh;
        extract = extractGiftVoucherOrder(payload, productIdsOf(fresh)) ?? extract;
      }
      if (extract.unmatchedDraftLines.length > 0) {
        report(
          new Error("orders/paid: a line carries a voucher draft, but its product is neither the voucher nor the print product"),
          "unmatchedDraftLine",
          { orderId }
        );
        // No voucher matched: Shopify redelivers for hours — time to align
        // the handle or the theme's product picker. With vouchers, they are
        // recorded (a redelivery could not add the line to the existing
        // units) and the order is flagged (unknown_product_line).
        if (extract.vouchers.length === 0) return { ok: false, action: "gift_vouchers:unmatched-draft" };
      }
    }
    if (extract.vouchers.length === 0 && extract.prints.length === 0) {
      return { ok: true, action: "gift_vouchers:none", orderId, created: 0 };
    }

    // 3) The drafts (design, texts, card address). Not readable → Shopify
    //    redelivers (nothing is written yet) instead of recording the design
    //    defaults for good; a token without a draft (unknown, purged) → the
    //    defaults, reported.
    const tokens = [
      ...new Set(
        [...extract.vouchers, ...extract.prints].map((l) => l.draftToken).filter((t): t is string => typeof t === "string")
      ),
    ];
    const drafts = tokens.length > 0 ? await getGiftVoucherDraftsByTokens(tokens) : [];
    if (drafts === null) return { ok: false, action: "gift_vouchers:drafts-unavailable" };
    const found = new Set(drafts.map((d) => d.token));
    if (tokens.some((t) => !found.has(t))) {
      report(new Error("orders/paid: a voucher line's draft was not found — design defaults used"), "draftMissing", { orderId });
    }
    const settings = extract.prints.length > 0 ? await getCachedGiftVoucherSettings() : null;
    const plan = planGiftVoucherOrderRecord({
      extract,
      drafts,
      enabled: isGiftVouchersEnabled(),
      allowTestOrders: isGiftVoucherTestOrdersAllowed(),
      limits: giftVoucherLimits(),
      reviewPrintWithPhoto: settings?.reviewPrintWithPhoto ?? true,
      // Paid in another currency: the face value is the ordered variant's own price.
      variantPriceCents: new Map((products.voucher?.variants ?? []).map((x) => [x.numericId, x.priceCents])),
    });
    if (plan.skipped.length > 0) {
      report(new Error("orders/paid: a voucher line has no price — its units are not recorded"), "noPrice", { orderId });
    }
    if (plan.units.length === 0) {
      if (plan.unmatchedPrints.length > 0) {
        report(new Error("orders/paid: a Premium-Karte was paid, but the order holds no voucher"), "printWithoutVoucher", { orderId });
      }
      return { ok: true, action: "gift_vouchers:none", orderId, created: 0 };
    }

    const inserted = await insertShopGiftVouchers(plan.units.map((u) => u.row));
    if (!inserted.ok) return { ok: false, action: "gift_vouchers:insert-failed" };
    const provider = giftVoucherPrintProvider();
    for (let i = 0; i < plan.units.length; i++) {
      const print = plan.units[i].print;
      if (!print) continue;
      const jobId = await insertGiftVoucherPrintJob({
        voucherId: inserted.ids[i],
        provider,
        status: print.status,
        address: print.address,
        paidLineItemId: print.paidLineItemId,
      });
      // Redelivery repeats it (ON CONFLICT keeps what exists).
      if (jobId == null) return { ok: false, action: "gift_vouchers:print-job-failed" };
    }
    if (plan.draftIds.length > 0) await markGiftVoucherDraftsOrdered(plan.draftIds);
    return { ok: true, action: `gift_vouchers:${plan.units.length}`, orderId, created: plan.units.length };
  } catch (err) {
    report(err, "record");
    return { ok: false, action: "gift_vouchers:error" };
  }
}

/** Issue the due vouchers of one order (for the webhook's after(); never throws). */
export async function processGiftVoucherOrder(orderId: string): Promise<void> {
  try {
    await processOrderUnits(orderId, Date.now() + AFTER_BUDGET_MS);
  } catch (err) {
    report(err, "processOrder");
  }
}

async function processOrderUnits(orderId: string, deadlineMs: number): Promise<void> {
  if (!orderId) return;
  const ctx = newContext(deadlineMs);
  const claimed = await claimDueGiftVouchers({ limit: 50, orderId });
  for (const v of claimed) await issueOne(v, "auto", ctx);
}

// ── issuing one unit ─────────────────────────────────────────────────────────

/** auto = the pipeline's own decision; override = an operator decided (held → issue, retry). */
type IssueMode = "auto" | "override";

type SnapshotResult = Awaited<ReturnType<typeof getGiftVoucherOrderSnapshot>>;

interface IssueTally {
  issued: number;
  held: number;
  deferred: number;
  failed: number;
  cancelled: number;
  mailed: number;
  printSubmitted: number;
}

interface IssueContext {
  deadlineMs: number;
  /** One order snapshot per order and run. */
  snapshots: Map<string, Promise<SnapshotResult>>;
  tally: IssueTally;
}

type IssueResult =
  | { kind: "issued" }
  | { kind: "held"; reason: string }
  | { kind: "deferred"; message: string }
  | { kind: "retry"; message: string }
  | { kind: "failed"; message: string }
  | { kind: "cancelled" }
  | { kind: "skipped"; message: string };

function newContext(deadlineMs: number): IssueContext {
  return {
    deadlineMs,
    snapshots: new Map(),
    tally: { issued: 0, held: 0, deferred: 0, failed: 0, cancelled: 0, mailed: 0, printSubmitted: 0 },
  };
}

function snapshotFor(ctx: IssueContext, orderId: string): Promise<SnapshotResult> {
  let p = ctx.snapshots.get(orderId);
  if (!p) {
    p = getGiftVoucherOrderSnapshot(orderId);
    ctx.snapshots.set(orderId, p);
  }
  return p;
}

const timeLeft = (ctx: IssueContext) => ctx.deadlineMs - Date.now();

/**
 * Issue ONE claimed unit (the caller holds its lease). Never throws; the row
 * always ends in a state the next worker can continue from.
 */
async function issueOne(v: GiftVoucher, mode: IssueMode, ctx: IssueContext): Promise<IssueResult> {
  let result: IssueResult;
  try {
    result = await issueOneUnsafe(v, mode, ctx);
  } catch (err) {
    report(err, "issue", { voucherId: v.id });
    result = await guarded("issueRecover", { kind: "retry", message: "Unerwarteter Fehler" } as IssueResult, () =>
      failIssue(v, "Unerwarteter Fehler beim Ausstellen — Mo versucht es erneut.", mode)
    );
  }
  const t = ctx.tally;
  if (result.kind === "issued") t.issued++;
  else if (result.kind === "held") t.held++;
  else if (result.kind === "deferred") t.deferred++;
  else if (result.kind === "retry" || result.kind === "failed") t.failed++;
  else if (result.kind === "cancelled") t.cancelled++;
  return result;
}

async function issueOneUnsafe(v: GiftVoucher, mode: IssueMode, ctx: IssueContext): Promise<IssueResult> {
  if (timeLeft(ctx) < MIN_ISSUE_MS) {
    // Out of time: hand it back at once (not after the 3-minute lease).
    await releaseGiftVoucherLock(v.id);
    return { kind: "skipped", message: "Zeitbudget aufgebraucht" };
  }

  // Revoked before it became a card (order cancelled / refunded).
  const revoke = revokeReasonOf(v.attention);
  if (revoke) return revokeUnissued(v, revoke);

  if (v.source === "shop") {
    if (!v.shopifyOrderId) {
      await markGiftVoucherFailed(v.id, "Shop-Gutschein ohne Shopify-Bestellung.");
      return { kind: "failed", message: "ohne Bestellung" };
    }
    const snap = await snapshotFor(ctx, v.shopifyOrderId);
    if (!snap.ok) {
      if (snap.notFound) {
        await markGiftVoucherFailed(v.id, "Die Bestellung gibt es in Shopify nicht (mehr).");
        return { kind: "failed", message: "Bestellung fehlt" };
      }
      return failIssue(v, `Bestellung nicht lesbar: ${snap.message}`, mode);
    }
    const order = snap.order;
    if (order.cancelledAt) return revokeUnissued(v, "cancelled");
    const financial = String(order.displayFinancialStatus ?? "").toUpperCase();
    if (mode === "override") {
      // An operator reviewed the hold; a full refund or a payment problem
      // still stops it (a partial refund may concern another line).
      if (FULLY_REFUNDED_ORDER_STATUSES.has(financial)) {
        await markGiftVoucherHeld(v.id, "refunded");
        return { kind: "held", reason: "refunded" };
      }
      if (!order.fullyPaid) {
        await markGiftVoucherHeld(v.id, "not_paid");
        return { kind: "held", reason: "not_paid" };
      }
    } else {
      // Money went back before the card existed: an operator decides.
      if (REFUNDED_ORDER_STATUSES.has(financial)) {
        await markGiftVoucherHeld(v.id, "refunded");
        return { kind: "held", reason: "refunded" };
      }
      // Today's issued sum, read right before the decision — without this
      // unit (a retried unit is `issuing` itself). The hard cap is the
      // reservation in ensureCode.
      const issuedTodayCents = await sumShopGiftVouchersIssuedToday(v.id);
      const decision = decideGiftVoucherIssue({
        enabled: isGiftVouchersEnabled(),
        allowTestOrders: isGiftVoucherTestOrdersAllowed(),
        order: {
          test: order.test,
          cancelled: false,
          fullyPaid: order.fullyPaid,
          financialStatus: order.displayFinancialStatus,
          currency: order.currencyCode,
          riskLevel: order.riskLevel,
          riskRecommendation: order.riskRecommendation,
        },
        // A discount on the line was decided when the order was recorded.
        line: { unitCents: v.amountCents, discountCents: 0 },
        limits: giftVoucherLimits(),
        issuedTodayCents,
        riskWaitExpired: isRiskWaitExpired({ createdAt: v.createdAt, riskWaitMinutes: giftVoucherRiskWaitMinutes() }),
      });
      if (decision.action === "cancel") return revokeUnissued(v, "cancelled");
      if (decision.action === "hold") {
        const reason = decision.reason ?? "risk";
        await markGiftVoucherHeld(v.id, reason);
        return { kind: "held", reason };
      }
      if (decision.action === "defer") {
        const d = planGiftVoucherDeferral({ reason: decision.reason, createdAt: v.createdAt });
        if (d.action === "hold") {
          await markGiftVoucherHeld(v.id, d.reason);
          return { kind: "held", reason: d.reason };
        }
        await scheduleGiftVoucherRetry(v.id, { error: d.message, nextAttemptAt: d.at, countAttempt: false });
        return { kind: "deferred", message: d.message };
      }
    }
  }

  // 1) The code, stored encrypted BEFORE Shopify sees it.
  const prepared = await ensureCode(v, mode);
  if (!prepared.ok) return prepared.result;
  const { code, expiresOn } = prepared;

  // 2) The Shopify card (Mo's own code; a lost answer is found by the code).
  const created = await createShopifyGiftCard({
    code,
    amountCents: v.amountCents,
    expiresOn,
    note: giftCardNote({ number: v.number, source: v.source, orderName: v.shopifyOrderName, reason: v.reason }),
  });
  let card: ShopifyGiftCardInfo;
  if (created.ok) {
    card = created.card;
  } else {
    const step = nextStepAfterCreateFailure(created.kind);
    if (step === "fail") {
      await markGiftVoucherFailed(v.id, created.message);
      return { kind: "failed", message: created.message };
    }
    if (step === "retry") {
      return failIssue(
        v,
        created.kind === "denied"
          ? "Shopify-Berechtigung write_gift_cards fehlt — Mo versucht es später erneut."
          : created.message,
        mode
      );
    }
    const found = await findShopifyGiftCardByCode(code);
    if (!found.ok) return failIssue(v, `Karte nicht auffindbar: ${found.message}`, mode);
    if (!found.card) {
      return failIssue(
        v,
        created.kind === "taken"
          ? "Der Code ist in Shopify vergeben, die Karte ist aber noch nicht auffindbar — Mo sucht später erneut."
          : "Shopifys Antwort ging verloren und die Karte ist noch nicht auffindbar — Mo versucht es erneut.",
        mode
      );
    }
    const adopt = adoptableGiftCard(found.card, v.amountCents);
    if (!adopt.ok) {
      await markGiftVoucherFailed(v.id, adopt.message);
      return { kind: "failed", message: adopt.message };
    }
    card = found.card;
  }

  // 3) Issued — with the download link of the first mail attempt when a mail
  //    will go out (derived: the mail rebuilds the same link).
  const token = v.mailStatus === "pending" ? giftVoucherAttemptDownloadToken(v, code) : null;
  const marked = await markGiftVoucherIssued(v.id, {
    giftCardId: card.id,
    balanceCents: card.balanceCents,
    downloadTokenHash: token ? hashOpaqueToken(token) : null,
  });
  if (!marked) return afterIssuedNotRecorded(v, card, mode);

  // 4) A revocation that landed while the card was being created.
  const now = await getGiftVoucher(v.id);
  if (now && revokeReasonOf(now.attention)) {
    await resolveIssuedRevocation(now);
    await releaseGiftVoucherLock(v.id);
    return { kind: "issued" };
  }

  // 5) Mail and card. Failures here never undo the card; the sweep retries.
  await deliver(now ?? v, ctx);
  await releaseGiftVoucherLock(v.id);
  return { kind: "issued" };
}

/**
 * The voucher's code: the stored one (a retry — never replaced), else a new
 * one, stored encrypted with status `issuing` before the Shopify call. For a
 * shop unit the pipeline decided itself that store is the daily limit's hard
 * cap (markGiftVoucherIssuing): refused → held `daily_limit`.
 */
async function ensureCode(
  v: GiftVoucher,
  mode: IssueMode
): Promise<{ ok: true; code: string; expiresOn: string | null } | { ok: false; result: IssueResult }> {
  if (v.hasCode) {
    const code = await getGiftVoucherCode(v.id);
    if (!code) return { ok: false, result: await failIssue(v, "Der gespeicherte Code ist nicht lesbar (TOKEN_ENC_KEY prüfen).", mode) };
    return { ok: true, code, expiresOn: v.expiresOn };
  }
  const code = generateGiftVoucherCode();
  const prepared = prepareGiftVoucherCode(code);
  if (!prepared.ok) {
    const message =
      prepared.reason === "no_key"
        ? "TOKEN_ENC_KEY fehlt — der Code kann nicht verschlüsselt gespeichert werden."
        : "Der Code ließ sich nicht erzeugen.";
    return { ok: false, result: await failIssue(v, message, mode) };
  }
  const expiresOn = giftVoucherExpiryDate(new Date(), giftVoucherValidityYears());
  // An operator's voucher and an override reserve without a cap.
  const dailyLimitCents = v.source === "shop" && mode === "auto" ? giftVoucherLimits().dailyLimitCents : 0;
  const stored = await markGiftVoucherIssuing(
    v.id,
    { codeEncB64: prepared.codeEncB64, codeHash: prepared.codeHash, codeLast4: prepared.codeLast4, expiresOn },
    dailyLimitCents
  );
  if (stored === "written") return { ok: true, code, expiresOn };
  if (stored === "limit") {
    // Units reserved meanwhile (another instance, a parallel webhook) used up today's limit.
    if (await markGiftVoucherHeld(v.id, "daily_limit")) return { ok: false, result: { kind: "held", reason: "daily_limit" } };
    return { ok: false, result: await failIssue(v, "Tageslimit erreicht, der Status ließ sich aber nicht speichern (Datenbank).", mode) };
  }

  // Not written: the row changed meanwhile (cancelled by an order change, a
  // code from an earlier attempt) or the database failed. Look again.
  const fresh = await getGiftVoucher(v.id);
  if (fresh && fresh.status !== "pending" && fresh.status !== "issuing") {
    await releaseGiftVoucherLock(v.id);
    return { ok: false, result: { kind: "skipped", message: `inzwischen ${fresh.status}` } };
  }
  if (fresh) {
    const revoke = revokeReasonOf(fresh.attention);
    if (revoke) return { ok: false, result: await revokeUnissued(fresh, revoke) };
    if (fresh.hasCode) {
      const existing = await getGiftVoucherCode(v.id);
      if (existing) return { ok: true, code: existing, expiresOn: fresh.expiresOn };
    }
  }
  return { ok: false, result: await failIssue(v, "Der Code ließ sich nicht speichern (Datenbank).", mode) };
}

/**
 * A failed try. The pipeline retries by the plan (held `attempts` on the
 * eleventh failed try); an operator's „Ausstellen“ / „Erneut versuchen“
 * never falls back into the automatic decision — the voucher stays „Fehler“
 * for the next click.
 */
async function failIssue(v: GiftVoucher, message: string, mode: IssueMode): Promise<IssueResult> {
  if (mode === "override") {
    await markGiftVoucherFailed(v.id, message);
    return { kind: "failed", message };
  }
  const plan = planGiftVoucherIssueRetry({ attempts: v.attempts });
  if (plan.action === "hold") {
    // Keep the last error visible, then hold (the far due time keeps the
    // sweep away between the two writes).
    await scheduleGiftVoucherRetry(v.id, { error: message, nextAttemptAt: new Date(Date.now() + 24 * 60 * 60_000) });
    await markGiftVoucherHeld(v.id, plan.reason);
    return { kind: "held", reason: plan.reason };
  }
  if (!(await scheduleGiftVoucherRetry(v.id, { error: message, nextAttemptAt: plan.at }))) {
    // Not pending / issuing any more (or no database): just end the lease.
    await releaseGiftVoucherLock(v.id);
  }
  return { kind: "retry", message };
}

/**
 * The card exists in Shopify but `issued` could not be written. Revoked
 * meanwhile → take the card back; otherwise retry — the next try finds the
 * card by its code (TAKEN → adopt), never a second one.
 */
async function afterIssuedNotRecorded(v: GiftVoucher, card: ShopifyGiftCardInfo, mode: IssueMode): Promise<IssueResult> {
  const fresh = await getGiftVoucher(v.id);
  if (fresh && (fresh.status === "cancelled" || fresh.status === "rejected")) {
    const d = await deactivateShopifyGiftCard(card.id);
    if (!d.ok) {
      report(new Error("a card created for a voucher revoked meanwhile could not be deactivated"), "orphanCard", { voucherId: v.id });
      await setGiftVoucherAttention(v.id, "deactivate_failed");
    }
    await releaseGiftVoucherLock(v.id);
    return { kind: "cancelled" };
  }
  return failIssue(v, "Karte in Shopify angelegt, aber nicht gespeichert — Mo übernimmt sie beim nächsten Versuch.", mode);
}

/** Mail and print after the card exists (time permitting — else the sweep does it). */
async function deliver(v: GiftVoucher, ctx: IssueContext): Promise<void> {
  if (v.mailStatus === "pending" && timeLeft(ctx) >= MIN_MAIL_MS) {
    if ((await sendGiftVoucherMail(v.id)) === "sent") ctx.tally.mailed++;
  }
  if (v.delivery === "print" && timeLeft(ctx) >= MIN_PRINT_MS) {
    const job = await getGiftVoucherPrintJobForVoucher(v.id);
    if (job && job.status === "queued") {
      const r = await guarded("printSubmit", null, () => submitGiftVoucherPrintJob(job.id));
      if (r?.ok) ctx.tally.printSubmitted++;
    }
  }
}

// ── revocation ───────────────────────────────────────────────────────────────

/**
 * Revoke a unit that is not (known as) a card yet. Without a code no card
 * can exist → cancelled. With a code an earlier try may have created it →
 * look it up: found → record it and take it back (resolveIssuedRevocation);
 * not found → cancelled once Shopify's search has surely caught up.
 */
async function revokeUnissued(v: GiftVoucher, reason: GiftVoucherRevokeReason): Promise<IssueResult> {
  if (!v.hasCode) {
    if (!(await setGiftVoucherStatus(v.id, "cancelled", { attention: null, from: ["pending", "issuing"] }))) {
      await releaseGiftVoucherLock(v.id);
      return { kind: "skipped", message: "Status geändert" };
    }
    await settleMailOfRevoked(v);
    await cancelOpenPrintJob(v.id, { neverCarded: true });
    return { kind: "cancelled" };
  }
  // A card may exist: the flag is the durable intent (it tells the
  // resolution the reason, keeps the mail step away, and survives a crash).
  const flag = GIFT_VOUCHER_REVOKE_ATTENTION[reason];
  if (v.attention !== flag && !(await setGiftVoucherAttention(v.id, flag))) {
    return failIssue(v, "Stornierung wartet: der Vermerk ließ sich nicht speichern.", "auto");
  }
  const code = await getGiftVoucherCode(v.id);
  if (!code) return failIssue(v, "Stornierung wartet: der gespeicherte Code ist nicht lesbar (TOKEN_ENC_KEY prüfen).", "auto");
  const found = await findShopifyGiftCardByCode(code);
  if (!found.ok) return failIssue(v, `Stornierung wartet auf Shopify: ${found.message}`, "auto");
  if (found.card && found.card.initialCents !== v.amountCents) {
    // Not the card Mo would have made (another value) — never touch it.
    report(new Error("revocation: a card with the voucher's code has another value — left alone"), "revokeForeignCard", {
      voucherId: v.id,
    });
  }
  if (!found.card || found.card.initialCents !== v.amountCents) {
    if (!isRevocationLookupConclusive({ updatedAt: v.updatedAt })) {
      const message = "Stornierung: Mo prüft gleich noch einmal, ob schon eine Shopify-Karte existiert.";
      await scheduleGiftVoucherRetry(v.id, { error: message, nextAttemptAt: new Date(Date.now() + 3 * 60_000), countAttempt: false });
      return { kind: "deferred", message };
    }
    if (!(await setGiftVoucherStatus(v.id, "cancelled", { attention: null, from: ["pending", "issuing"] }))) {
      await releaseGiftVoucherLock(v.id);
      return { kind: "skipped", message: "Status geändert" };
    }
    await settleMailOfRevoked(v);
    await cancelOpenPrintJob(v.id, { neverCarded: true });
    return { kind: "cancelled" };
  }
  // A card exists: record it (the flag stays), then take it back.
  const marked = await markGiftVoucherIssued(v.id, {
    giftCardId: found.card.id,
    balanceCents: found.card.balanceCents,
    downloadTokenHash: null,
  });
  if (!marked) return failIssue(v, "Stornierung: Karte gefunden, aber nicht gespeichert.", "auto");
  const fresh = await getGiftVoucher(v.id);
  if (fresh) await resolveIssuedRevocation(fresh);
  await releaseGiftVoucherLock(v.id);
  return { kind: "cancelled" };
}

type RevocationOutcome = "deactivated" | "moved" | "used" | "retry" | "error" | "none";

/**
 * Resolve the revocation flag of an ISSUED voucher against Shopify:
 * untouched card → deactivate (irreversible), record, clear the flag, cancel
 * the card print; deactivated in Shopify already → record; (partly) spent →
 * for a refund an untouched sibling of the same line takes the refund over
 * and is deactivated instead ("deactivated"; "moved" while the sibling still
 * waits for Shopify), else the flag stays for an operator (the stored lower
 * balance marks it checked: "used"); Shopify refused the deactivation →
 * `deactivate_failed` for an operator ("error"); Shopify not reachable, a
 * timeout or a 5xx → "retry", the flag stays for the next try (the sweep,
 * the next order update, the balance sync). `card`: the card just read (the
 * balance sync) — else it is read here.
 */
async function resolveIssuedRevocation(
  v: GiftVoucher,
  opts: { moveToSibling?: boolean; card?: ShopifyGiftCardInfo } = {}
): Promise<RevocationOutcome> {
  const reason = revokeReasonOf(v.attention);
  if (!reason || v.status !== "issued" || !v.shopifyGiftCardId) return "none";
  let card = opts.card ?? null;
  if (!card) {
    const r = await getShopifyGiftCard(v.shopifyGiftCardId);
    if (!r.ok) return "retry";
    if (!r.card) {
      report(new Error("revocation: the Shopify card of an issued voucher is missing"), "revokeMissingCard", { voucherId: v.id });
      await setGiftVoucherAttention(v.id, "deactivate_failed");
      return "error";
    }
    card = r.card;
  }
  const decision = giftVoucherRevocationDecision(card);
  if (decision === "used") {
    if (reason === "refunded" && opts.moveToSibling !== false) {
      const moved = await moveRefundToUntouchedSibling(v);
      // A sibling's card was not readable: try again (no balance stored — the flag stays due).
      if (moved === "retry") return "retry";
      if (moved) {
        await updateGiftVoucherBalance(v.id, card.balanceCents);
        return moved;
      }
    }
    // The stored lower balance marks the flag as checked (pickRevocationsToResolve).
    await updateGiftVoucherBalance(v.id, card.balanceCents);
    return "used";
  }
  if (decision === "deactivate") {
    const d = await deactivateShopifyGiftCard(card.id);
    if (!d.ok) {
      // Transient (timeout, throttle, 5xx): the flag stays and the next try deactivates.
      if (d.retryable) return "retry";
      await setGiftVoucherAttention(v.id, "deactivate_failed");
      return "error";
    }
  }
  await markGiftVoucherDeactivated(v.id, GIFT_VOUCHER_REVOKE_REASON_TEXT[reason]);
  await setGiftVoucherAttention(v.id, null);
  await settleMailOfRevoked(v);
  await cancelOpenPrintJob(v.id, { neverCarded: false });
  return "deactivated";
}

/**
 * A refund revoked a unit whose card is (partly) spent — which unit of a line
 * a refund concerns is Mo's choice, Shopify's refund lines carry only a
 * quantity. An untouched sibling of the same line takes the refund instead
 * (deactivating it loses nothing): each candidate's LIVE card is read, the
 * flag moves in one conditional statement (several order updates resolve the
 * same flag at once — one wins), then the sibling is resolved (deactivated,
 * reason „Erstattet“). null = no untouched sibling; "retry" = a card was not
 * readable or the move could not be written.
 */
async function moveRefundToUntouchedSibling(v: GiftVoucher): Promise<"deactivated" | "moved" | "retry" | null> {
  if (!v.shopifyOrderId || !v.attention) return null;
  const flag = v.attention;
  const candidates = revocationSiblingCandidates(v, await listGiftVouchersForOrder(v.shopifyOrderId));
  let unreadable = false;
  for (const sibling of candidates) {
    if (!sibling.shopifyGiftCardId) continue;
    const c = await getShopifyGiftCard(sibling.shopifyGiftCardId);
    if (!c.ok) {
      unreadable = true;
      continue;
    }
    if (!c.card || giftVoucherRevocationDecision(c.card) !== "deactivate") continue;
    if (!(await moveGiftVoucherRevocation(v.id, sibling.id, flag))) {
      // Another worker moved or settled the flag first ("moved") — or the
      // write, or this read, failed: then later again.
      const now = await getGiftVoucher(v.id);
      return now && now.attention !== flag ? "moved" : "retry";
    }
    const moved = await getGiftVoucher(sibling.id);
    const r = moved ? await resolveIssuedRevocation(moved, { moveToSibling: false }) : "retry";
    return r === "deactivated" ? "deactivated" : "moved";
  }
  return unreadable ? "retry" : null;
}

/** A revoked voucher's mail that has not gone out never will: `skipped`. */
async function settleMailOfRevoked(v: Pick<GiftVoucher, "id" | "mailStatus">): Promise<void> {
  if (v.mailStatus === "pending") await setGiftVoucherMailState(v.id, { status: "skipped", countAttempt: false });
}

/**
 * Cancel the print job of a voucher if it is still open. A voucher that
 * never became a card has a job nobody submitted — the database is enough.
 * Otherwise print.one decides (P4): too late → attention for an operator.
 */
async function cancelOpenPrintJob(voucherId: number, opts: { neverCarded: boolean }): Promise<void> {
  const job = await getGiftVoucherPrintJobForVoucher(voucherId);
  if (!job || isFinalPrintJobStatus(job.status)) return;
  if (opts.neverCarded && (job.status === "review" || job.status === "queued")) {
    await updateGiftVoucherPrintJobStatus(job.id, "cancelled", { error: "Gutschein storniert" });
    return;
  }
  await cancelPrintJobViaProvider(job.id, voucherId);
}

async function cancelPrintJobViaProvider(jobId: number, voucherId: number): Promise<void> {
  const r = await guarded("printCancel", { ok: false as const, code: "failed" as const, message: "" }, () =>
    cancelGiftVoucherPrintJob(jobId)
  );
  if (!r.ok && r.code !== "not_found") await flagPrintAttention(voucherId, "print_cancel_too_late");
}

/**
 * Set a print-related attention key — unless the voucher carries a more
 * important one (attention is ONE column): a pending revocation, its
 * acknowledged form (it keeps the unit revoked) or a failed deactivation is
 * about money and must never be overwritten by a card note.
 */
async function flagPrintAttention(voucherId: number, key: string): Promise<void> {
  const v = await getGiftVoucher(voucherId);
  if (!v || revokeReasonOf(v.attention) || isAcknowledgedRevocation(v.attention) || v.attention === "deactivate_failed") return;
  await setGiftVoucherAttention(voucherId, key);
}

// ── orders/cancelled, orders/updated ─────────────────────────────────────────

/** The work an order change leaves for after the webhook's answer (processGiftVoucherOrderChange). */
export interface GiftVoucherOrderChangeFollowUp {
  orderId: string;
  /** The change's facts: the card prints are decided again once the revocations are resolved. */
  facts: GiftVoucherOrderChangeFacts;
  /** Units this change revoked: each flagged card is checked against Shopify once, whatever balance is stored. */
  revokedIds: number[];
  /** The print jobs the change's own plan cancels through the provider — used when the order cannot be read again. */
  printJobIds: number[];
}

type GiftVoucherOrderChangeFacts = Pick<ReturnType<typeof giftVoucherOrderChangeFacts>, "cancelled" | "revoked" | "lineQuantities">;

/**
 * orders/cancelled, orders/updated (refunds, removals, a full refund): revoke
 * what the order no longer pays for (planGiftVoucherOrderChange — one rule
 * per line; a repeated delivery revokes nothing more). Synchronous and
 * database-only (the webhook answers within 5 s):
 * units that never became a card are cancelled, every other revoked unit
 * gets the revocation flag — the durable intent — and `followUp` names the
 * order for processGiftVoucherOrderChange (after()). Fast for the many
 * orders without vouchers (one read). `ok: false` → Shopify redelivers.
 * Never throws.
 */
export async function handleGiftVoucherOrderChange(
  payload: unknown,
  topic: string
): Promise<{ ok: true; action: string; followUp?: GiftVoucherOrderChangeFollowUp | null } | { ok: false; action: string }> {
  try {
    const facts = giftVoucherOrderChangeFacts(payload, topic);
    if (!facts.orderId) return { ok: true, action: "gift_vouchers:no-order" };
    if (!facts.cancelled && facts.revoked.size === 0) return { ok: true, action: "gift_vouchers:unchanged" };
    const vouchers = await listGiftVouchersForOrder(facts.orderId);
    if (vouchers.length === 0) return { ok: true, action: "gift_vouchers:none" };

    const plan = planGiftVoucherOrderChange({ facts, vouchers, printJobs: await printJobsOf(vouchers) });
    if (plan.revoked === 0 && plan.cancelJobsNow.length === 0 && plan.cancelJobsLater.length === 0) {
      return { ok: true, action: "gift_vouchers:unchanged" };
    }

    let failures = 0;
    /** The row moved on since the read (a worker took it): flag it instead. */
    const flagMoved = async (id: number) => {
      const fresh = await getGiftVoucher(id);
      if (!fresh) return false;
      if (fresh.status === "issuing" || fresh.status === "issued" || fresh.status === "pending") {
        return setGiftVoucherAttention(id, plan.attention);
      }
      return fresh.status === "cancelled" || fresh.status === "rejected" || fresh.status === "deactivated";
    };
    const mailPending = new Set(vouchers.filter((v) => v.mailStatus === "pending").map((v) => v.id));
    for (const id of plan.cancel) {
      if (await setGiftVoucherStatus(id, "cancelled", { from: ["pending", "held", "failed"] })) {
        if (mailPending.has(id)) await setGiftVoucherMailState(id, { status: "skipped", countAttempt: false });
      } else if (!(await flagMoved(id))) {
        failures++;
      }
    }
    for (const r of plan.recheck) {
      // Back to pending with the flag: the issuing step looks the card up.
      if (!(await setGiftVoucherStatus(r.id, "pending", { attention: plan.attention, from: [r.from] })) && !(await flagMoved(r.id))) failures++;
    }
    for (const id of [...plan.flagIssuing, ...plan.flagIssued]) {
      if (!(await setGiftVoucherAttention(id, plan.attention))) failures++;
    }
    const jobError = GIFT_VOUCHER_REVOKE_REASON_TEXT[plan.reason];
    for (const jobId of plan.cancelJobsNow) {
      // False when the job finished meanwhile — nothing left to cancel.
      await updateGiftVoucherPrintJobStatus(jobId, "cancelled", { error: jobError });
    }
    if (failures > 0) return { ok: false, action: "gift_vouchers:revoke-failed" };
    return {
      ok: true,
      action: `gift_vouchers:revoked:${plan.revoked}`,
      followUp: {
        orderId: facts.orderId,
        facts: { cancelled: facts.cancelled, revoked: facts.revoked, lineQuantities: facts.lineQuantities },
        revokedIds: [...plan.cancel, ...plan.recheck.map((r) => r.id), ...plan.flagIssuing, ...plan.flagIssued],
        printJobIds: plan.cancelJobsLater,
      },
    };
  } catch (err) {
    report(err, "orderChange");
    return { ok: false, action: "gift_vouchers:error" };
  }
}

/** The print jobs of an order's units (one per unit with a card ordered). */
async function printJobsOf(vouchers: readonly GiftVoucher[]) {
  return (await Promise.all(vouchers.filter((v) => v.delivery === "print").map((v) => getGiftVoucherPrintJobForVoucher(v.id)))).filter(
    (j): j is NonNullable<typeof j> => j !== null
  );
}

/**
 * The Shopify / print.one part of an order change, for the webhook's
 * after(): resolve the order's revocation flags (deactivate untouched cards;
 * a flag this change set is checked whatever balance is stored), then cancel
 * the card prints the order no longer pays for — decided only now, on the
 * resolved rows: a refund that moved to an untouched sibling took that
 * sibling's card along, which then counts for the add-on line — and let the
 * issuing step close the units that never became a card. Never throws;
 * whatever does not finish here is finished by the sweep (the flags persist).
 */
export async function processGiftVoucherOrderChange(followUp: GiftVoucherOrderChangeFollowUp): Promise<void> {
  try {
    const deadlineMs = Date.now() + AFTER_BUDGET_MS;
    // The money first: deactivate untouched cards (this also cancels their
    // card prints), then the remaining prints of refunded add-on lines.
    const vouchers = await listGiftVouchersForOrder(followUp.orderId);
    for (const v of pickRevocationsToResolve(vouchers, Infinity, followUp.revokedIds)) {
      if (deadlineMs - Date.now() < MIN_STEP_MS) break;
      await resolveIssuedRevocation(v);
    }
    for (const jobId of await printJobsToCancel(followUp)) {
      if (deadlineMs - Date.now() < MIN_STEP_MS) break;
      const job = await getGiftVoucherPrintJob(jobId);
      if (job && !isFinalPrintJobStatus(job.status)) await cancelPrintJobViaProvider(job.id, job.voucherId);
    }
    if (deadlineMs - Date.now() >= MIN_ISSUE_MS) await processOrderUnits(followUp.orderId, deadlineMs);
  } catch (err) {
    report(err, "orderChangeAfter");
  }
}

/**
 * The card prints an order change cancels, planned again on the rows as they
 * are after the revocations were resolved (the same facts). The change's own
 * plan is the fallback when the order's units cannot be read again — or when
 * the new plan would revoke a unit itself (the rows moved on in a way only
 * the next order change may act on).
 */
async function printJobsToCancel(followUp: GiftVoucherOrderChangeFollowUp): Promise<number[]> {
  const vouchers = await listGiftVouchersForOrder(followUp.orderId);
  if (vouchers.length === 0) return followUp.printJobIds;
  const plan = planGiftVoucherOrderChange({ facts: followUp.facts, vouchers, printJobs: await printJobsOf(vouchers) });
  if (plan.revoked > 0) return followUp.printJobIds;
  return [...new Set([...plan.cancelJobsNow, ...plan.cancelJobsLater])];
}

// ── admin actions ────────────────────────────────────────────────────────────

/** Claim a unit for an operator's click and issue it right away. */
async function issueNow(id: number, mode: IssueMode, ctx: IssueContext): Promise<{ ok: true } | Fail> {
  const v = await claimGiftVoucher(id);
  if (!v) return fail("busy", "Der Gutschein wird gerade bearbeitet — bitte gleich neu laden.");
  const r = await issueOne(v, mode, ctx);
  switch (r.kind) {
    case "issued":
      return { ok: true };
    case "cancelled":
      return fail("cancelled", "Die Bestellung wurde storniert oder erstattet — der Gutschein wurde nicht ausgestellt.");
    case "held":
      if (r.reason === "refunded") return REFUNDED();
      return fail(
        "held",
        `Der Gutschein wurde zurückgestellt: ${(GIFT_VOUCHER_HOLD_REASON_LABELS as Record<string, string>)[r.reason] ?? r.reason}.`
      );
    case "deferred":
      return fail("deferred", r.message);
    case "skipped":
      return fail("busy", "Der Gutschein wird gerade bearbeitet — bitte gleich neu laden.");
    default:
      return fail("failed", r.message);
  }
}

/**
 * „Ausstellen“ for a held voucher: the operator overrides the hold (test
 * order, discount, amount, risk, daily limit, switched off …). The order is
 * still checked — a cancelled, refunded (REFUNDED / VOIDED; a partial refund
 * stays the operator's call) or unpaid order is never issued, nor a voucher
 * whose data the retention removed.
 */
export async function issueHeldGiftVoucher(id: number, actor: string): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  void actor; // the admin route audits who did it
  try {
    const v = await getGiftVoucher(id);
    if (!v) return NOT_FOUND();
    if (v.status !== "held") return fail("not_held", "Der Gutschein wartet nicht auf Prüfung.");
    if (v.personalDataPurgedAt) return PURGED();
    if (revokeReasonOf(v.attention)) {
      return fail("revoked", "Die Bestellung wurde storniert oder erstattet — der Gutschein kann nicht ausgestellt werden.");
    }
    const ctx = newContext(Date.now() + ADMIN_BUDGET_MS);
    if (v.source === "shop" && v.shopifyOrderId) {
      const snap = getGiftVoucherOrderSnapshot(v.shopifyOrderId);
      ctx.snapshots.set(v.shopifyOrderId, snap);
      const s = await snap;
      if (!s.ok) return fail("shopify", `Die Bestellung ließ sich in Shopify nicht prüfen: ${s.message}`);
      if (s.order.cancelledAt) return fail("order_cancelled", "Die Bestellung ist storniert — der Gutschein kann nicht ausgestellt werden.");
      if (FULLY_REFUNDED_ORDER_STATUSES.has(String(s.order.displayFinancialStatus ?? "").toUpperCase())) return REFUNDED();
      if (!s.order.fullyPaid) return fail("not_paid", "Die Bestellung ist nicht vollständig bezahlt.");
    }
    if (!(await setGiftVoucherStatus(id, "pending", { from: ["held"] }))) return CONFLICT();
    return await issueNow(id, "override", ctx);
  } catch (err) {
    report(err, "issueHeld", { voucherId: id });
    return fail("error", "Der Gutschein konnte nicht ausgestellt werden.");
  }
}

/**
 * „Ablehnen“ for a held (or failed) voucher. When an earlier try may have
 * created the card (a stored code), it is looked up and deactivated first —
 * a rejected voucher never leaves an active card behind. Shopify's search can
 * lag a few seconds behind a create, so a lookup that finds nothing within
 * two minutes of the last write is not trusted yet (`busy`).
 */
export async function rejectGiftVoucher(id: number, note: string | null): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  try {
    const v = await getGiftVoucher(id);
    if (!v) return NOT_FOUND();
    if (v.status !== "held" && v.status !== "failed") {
      return fail("not_held", "Nur zurückgestellte oder fehlgeschlagene Gutscheine können abgelehnt werden.");
    }
    if (v.hasCode) {
      const code = await getGiftVoucherCode(id);
      if (!code) return fail("code", "Der gespeicherte Code ist nicht lesbar (TOKEN_ENC_KEY prüfen) — bitte später erneut versuchen.");
      const found = await findShopifyGiftCardByCode(code);
      if (!found.ok) return fail("shopify", `Shopify ließ sich nicht prüfen: ${found.message}`);
      if (!found.card && !isRevocationLookupConclusive({ updatedAt: v.updatedAt })) {
        return fail("busy", "Mo prüft noch, ob Shopify die Karte schon angelegt hat — bitte in zwei Minuten erneut „Ablehnen“.");
      }
      if (found.card && found.card.enabled && !found.card.deactivatedAt) {
        const d = await deactivateShopifyGiftCard(found.card.id);
        if (!d.ok) return fail("shopify", `Die Shopify-Karte ließ sich nicht sperren: ${d.message}`);
      }
    }
    if (!(await setGiftVoucherStatus(id, "rejected", { from: ["held", "failed"] }))) return CONFLICT();
    const text = note?.trim();
    if (text) await setGiftVoucherAdminNote(id, v.adminNote ? `${v.adminNote}\n${text}` : text);
    await cancelOpenPrintJob(id, { neverCarded: true });
    return { ok: true };
  } catch (err) {
    report(err, "reject", { voucherId: id });
    return fail("error", "Der Gutschein konnte nicht abgelehnt werden.");
  }
}

/**
 * „Erneut versuchen“ for a failed voucher (the stored code, if any, is
 * reused) — never for one whose data the retention removed (nobody would
 * get its code).
 */
export async function retryGiftVoucher(id: number): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  try {
    const v = await getGiftVoucher(id);
    if (!v) return NOT_FOUND();
    if (v.status !== "failed") return fail("not_failed", "Nur fehlgeschlagene Gutscheine können erneut versucht werden.");
    if (v.personalDataPurgedAt) return PURGED();
    if (!(await setGiftVoucherStatus(id, "pending", { from: ["failed"] }))) return CONFLICT();
    return await issueNow(id, "override", newContext(Date.now() + ADMIN_BUDGET_MS));
  } catch (err) {
    report(err, "retry", { voucherId: id });
    return fail("error", "Der Gutschein konnte nicht erneut ausgestellt werden.");
  }
}

export interface ManualGiftVoucherInput {
  amountCents: number;
  reason: Exclude<GiftVoucherReason, "verkauf">;
  designKey: string;
  recipientName: string | null;
  senderName: string | null;
  message: string | null;
  delivery: GiftVoucherDelivery;
  recipientEmail: string | null;
  address: GiftVoucherAddress | null;
  adminNote: string | null;
  actor: string;
}

/**
 * „Gutschein ausstellen“ (Kulanz, Marketing, Gewinnspiel, Firmengeschenk,
 * Sonstiges): validate (decideManualGiftVoucher — marketing only as PDF, the
 * admin maximum), store, create the print job for a card, and issue at once.
 * `ok: true` once the voucher exists — whether the card was created right
 * away shows on its status (a failed try is retried by the sweep).
 */
export async function issueManualGiftVoucher(
  input: ManualGiftVoucherInput
): Promise<{ ok: true; id: number } | { ok: false; code: string; message: string; field?: string }> {
  try {
    const countries = giftVoucherPrintCountries();
    const check = decideManualGiftVoucher({
      amountCents: input.amountCents,
      reason: input.reason,
      delivery: input.delivery,
      recipientEmail: input.recipientEmail,
      address: input.address,
      adminMaxCents: giftVoucherLimits().adminMaxCents,
      printCountries: countries,
      designKey: input.designKey,
    });
    if (!check.ok) return { ok: false, code: "invalid", message: check.message, field: check.field };

    const L = GIFT_VOUCHER_TEXT_LIMITS;
    const texts: Record<"recipientName" | "senderName" | "message", string | null> = {
      recipientName: null,
      senderName: null,
      message: null,
    };
    const specs: Array<[keyof typeof texts, number, number, string]> = [
      ["recipientName", L.recipientName, 1, `„Für“ darf höchstens ${L.recipientName} Zeichen haben.`],
      ["senderName", L.senderName, 1, `„Von“ darf höchstens ${L.senderName} Zeichen haben.`],
      ["message", L.message, L.messageLines, `Die Nachricht darf höchstens ${L.message} Zeichen und ${L.messageLines} Zeilen haben.`],
    ];
    for (const [field, max, maxLines, tooLong] of specs) {
      const r = sanitizeGiftVoucherText(input[field] ?? "", { max, maxLines });
      if (r.truncated) return { ok: false, code: "invalid", message: tooLong, field };
      texts[field] = r.text || null;
    }
    let address: GiftVoucherAddress | null = null;
    if (input.delivery === "print") {
      const a = validatePostalAddress(input.address, { countries, locale: "de" });
      if (!a.ok) return { ok: false, code: "invalid", message: a.message, field: a.field };
      address = {
        name: a.address.name,
        addressLine1: a.address.address_line_1,
        addressLine2: a.address.address_line_2 ?? null,
        postalCode: a.address.postal_code,
        city: a.address.city,
        country: a.address.country,
      };
    }

    // Created LEASED to this request (3 minutes): it is issued right below;
    // should this request die, the sweep takes over after the lease.
    const id = await insertAdminGiftVoucher({
      amountCents: input.amountCents,
      reason: input.reason,
      designKey: input.designKey,
      recipientName: texts.recipientName,
      senderName: texts.senderName,
      message: texts.message,
      delivery: input.delivery,
      recipientEmail: input.delivery === "email" ? input.recipientEmail : null,
      locale: "de",
      adminNote: input.adminNote,
      createdBy: input.actor,
    });
    if (id == null) return { ok: false, code: "db", message: "Der Gutschein konnte nicht gespeichert werden (Datenbank)." };

    if (input.delivery === "print") {
      const jobId = await insertGiftVoucherPrintJob({
        voucherId: id,
        provider: giftVoucherPrintProvider(),
        status: "queued",
        address,
        paidLineItemId: null,
      });
      if (jobId == null) {
        // No card without its print job: withdraw the (not yet issued) voucher.
        await setGiftVoucherStatus(id, "cancelled", { from: ["pending"] });
        return { ok: false, code: "db", message: "Der Druckauftrag konnte nicht angelegt werden — bitte erneut versuchen." };
      }
    }

    const v = await getGiftVoucher(id);
    if (v) await issueOne(v, "auto", newContext(Date.now() + ADMIN_BUDGET_MS));
    return { ok: true, id };
  } catch (err) {
    report(err, "manual");
    return { ok: false, code: "error", message: "Der Gutschein konnte nicht ausgestellt werden." };
  }
}

/**
 * „Als geklärt markieren“ (planClearGiftVoucherAttention). A note that is not
 * about money is cleared. A revoke flag never just vanishes: on an issued
 * card it is checked against Shopify first (a refund flag always — also when
 * the stored balance showed the card spent already: that balance may have
 * been read before the refund) — untouched → deactivated; spent → for a
 * refund an untouched sibling of the line takes it over, else the
 * ACKNOWLEDGED key is stored, so a later order update never flags the card
 * again and it leaves „Achtung“; Shopify not answering → `busy`. A flag on a
 * unit whose card lookup still runs is refused (`revoking`); an acknowledged
 * key stays.
 */
export async function clearGiftVoucherAttention(id: number): Promise<{ ok: true } | Fail> {
  try {
    const v = await getGiftVoucher(id);
    if (!v) return NOT_FOUND();
    const step = planClearGiftVoucherAttention(v);
    if (step === "none" || step === "keep") return { ok: true };
    if (step === "clear") {
      return (await setGiftVoucherAttention(id, null)) ? { ok: true } : fail("internal_error", "Der Hinweis konnte nicht entfernt werden.");
    }
    if (step === "revoking") {
      return fail("revoking", "Die Stornierung läuft noch — Mo prüft, ob es eine Shopify-Karte gibt. Bitte „Ablehnen“ oder später erneut.");
    }
    if (step === "resolve") {
      const r = await resolveIssuedRevocation(v);
      if (r === "deactivated" || r === "moved") return { ok: true };
      if (r !== "used") return fail("busy", "Mo prüft die Karte noch — bitte gleich erneut versuchen oder „Sperren“ wählen.");
    }
    return await acknowledgeRevocation(v);
  } catch (err) {
    report(err, "clearAttention", { voucherId: id });
    return fail("error", "Der Hinweis konnte nicht entfernt werden.");
  }
}

/** Store the acknowledged form of a revoke flag — only while the flag is still there. */
async function acknowledgeRevocation(v: GiftVoucher): Promise<{ ok: true } | Fail> {
  const reason = revokeReasonOf(v.attention);
  if (!reason || !v.attention) return { ok: true };
  if (await replaceGiftVoucherAttention(v.id, v.attention, GIFT_VOUCHER_REVOKE_ACK_ATTENTION[reason])) return { ok: true };
  const now = await getGiftVoucher(v.id);
  // The flag moved on meanwhile (resolved elsewhere): nothing left to acknowledge.
  if (now && now.attention !== v.attention) return { ok: true };
  return fail("internal_error", "Der Hinweis konnte nicht gespeichert werden.");
}

/** „E-Mail erneut senden“: a new mail with a new download link (the old link stops working). */
export async function resendGiftVoucherMail(id: number): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  try {
    const v = await getGiftVoucher(id);
    if (!v) return NOT_FOUND();
    if (v.status !== "issued") return fail("not_issued", "Nur ausgestellte Gutscheine können per E-Mail verschickt werden.");
    if (!giftVoucherMailTarget(v).ok) return fail("no_recipient", "Für diesen Gutschein gibt es keine E-Mail-Adresse.");
    if (revokeReasonOf(v.attention) || v.attention === "deactivate_failed") {
      return fail("revoked", "Die Bestellung wurde storniert oder erstattet — der Code wird nicht verschickt.");
    }
    const outcome = await sendGiftVoucherMail(id);
    if (outcome === "sent") return { ok: true };
    if (outcome === "skipped") {
      return fail("not_configured", "Die E-Mail wurde nicht gesendet — der E-Mail-Versand ist nicht eingerichtet (RESEND_API_KEY / CONTACT_FROM_EMAIL).");
    }
    const after = await getGiftVoucher(id);
    return fail("send_failed", after?.lastError ?? "Die E-Mail konnte nicht gesendet werden — Mo versucht es automatisch erneut.");
  } catch (err) {
    report(err, "resend", { voucherId: id });
    return fail("error", "Die E-Mail konnte nicht gesendet werden.");
  }
}

/**
 * „Sperren“: deactivate the card in Shopify (IRREVERSIBLE), record it,
 * cancel an open card print. Only issued vouchers; repeating it is harmless.
 */
export async function deactivateGiftVoucher(id: number, reason: string): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  try {
    const v = await getGiftVoucher(id);
    if (!v) return NOT_FOUND();
    if (v.status === "deactivated") return { ok: true };
    if (v.status !== "issued") return fail("not_issued", "Nur ausgestellte Gutscheine können gesperrt werden.");
    if (!v.shopifyGiftCardId) return fail("no_card", "Zu diesem Gutschein gibt es keine Shopify-Karte.");
    const d = await deactivateShopifyGiftCard(v.shopifyGiftCardId);
    if (!d.ok) {
      await setGiftVoucherAttention(id, "deactivate_failed");
      return fail("shopify", `Die Karte ließ sich in Shopify nicht sperren: ${d.message}`);
    }
    const text = reason.trim().slice(0, 500) || "Von Hand gesperrt";
    if (!(await markGiftVoucherDeactivated(id, text))) {
      return fail("db", "In Shopify gesperrt, aber der Status ließ sich nicht speichern — bitte erneut „Sperren“ wählen.");
    }
    // The open items about this card are settled by the deactivation.
    if (v.attention === "deactivate_failed" || revokeReasonOf(v.attention)) await setGiftVoucherAttention(id, null);
    await cancelOpenPrintJob(id, { neverCarded: false });
    return { ok: true };
  } catch (err) {
    report(err, "deactivate", { voucherId: id });
    return fail("error", "Der Gutschein konnte nicht gesperrt werden.");
  }
}

/** „Abgleichen“: read the card's balance from Shopify (a card deactivated there is recorded as such). */
export async function syncGiftVoucherBalance(id: number): Promise<{ ok: true; balanceCents: number } | { ok: false; message: string }> {
  try {
    const v = await getGiftVoucher(id);
    if (!v) return { ok: false, message: "Gutschein nicht gefunden." };
    return await syncBalance(v);
  } catch (err) {
    report(err, "syncBalance", { voucherId: id });
    return { ok: false, message: "Das Guthaben ließ sich nicht abgleichen." };
  }
}

/**
 * Read a card's balance and store it; a card deactivated in Shopify is
 * recorded. A unit with a pending revocation is resolved with the card just
 * read (resolveIssuedRevocation): a stored lower balance marks its flag as
 * checked, so it is written only once a refund had its chance to move to an
 * untouched sibling — never by a plain balance read.
 */
async function syncBalance(v: GiftVoucher): Promise<{ ok: true; balanceCents: number } | { ok: false; message: string }> {
  if (!v.shopifyGiftCardId) return { ok: false, message: "Zu diesem Gutschein gibt es noch keine Shopify-Karte." };
  const r = await getShopifyGiftCard(v.shopifyGiftCardId);
  if (!r.ok) return { ok: false, message: r.message };
  if (!r.card) return { ok: false, message: "Shopify kennt diese Karte nicht (mehr)." };
  if (v.status === "issued" && revokeReasonOf(v.attention)) {
    const outcome = await resolveIssuedRevocation(v, { card: r.card });
    if (outcome === "retry") {
      return { ok: false, message: "Die Stornierung dieses Gutscheins wartet noch auf Shopify — bitte gleich erneut abgleichen." };
    }
    // "used" / "moved" stored the balance already.
    if (outcome !== "used" && outcome !== "moved") await updateGiftVoucherBalance(v.id, r.card.balanceCents);
    return { ok: true, balanceCents: r.card.balanceCents };
  }
  await updateGiftVoucherBalance(v.id, r.card.balanceCents);
  // Deactivated in the Shopify admin: Mo records it.
  if (v.status === "issued" && (!r.card.enabled || r.card.deactivatedAt)) await markGiftVoucherDeactivated(v.id, "In Shopify gesperrt");
  return { ok: true, balanceCents: r.card.balanceCents };
}

// ── the cron sweep ───────────────────────────────────────────────────────────

export interface GiftVoucherSweepResult {
  issued: number;
  held: number;
  deferred: number;
  failed: number;
  mailed: number;
  printSubmitted: number;
  printPolled: number;
  assetsCleaned: number;
  balancesSynced: number;
  fulfilled: number;
}

/**
 * The cron sweep (every 5 minutes), deadline-aware, in this order: due units
 * (issue, retries, revocations of units without a card) → revocation flags of
 * issued cards → due mails → print queue (submit, poll, clean up — P4) →
 * balances older than 24 h → fulfilment (GIFT_VOUCHER_FULFILL_ORDERS).
 * `deadlineMs` is an absolute time (epoch ms). Never throws.
 */
export async function runGiftVoucherSweep(opts?: { deadlineMs?: number }): Promise<GiftVoucherSweepResult> {
  const deadlineMs =
    typeof opts?.deadlineMs === "number" && Number.isFinite(opts.deadlineMs) ? opts.deadlineMs : Date.now() + SWEEP_BUDGET_MS;
  const left = () => deadlineMs - Date.now();
  const ctx = newContext(deadlineMs);
  const result: GiftVoucherSweepResult = {
    issued: 0,
    held: 0,
    deferred: 0,
    failed: 0,
    mailed: 0,
    printSubmitted: 0,
    printPolled: 0,
    assetsCleaned: 0,
    balancesSynced: 0,
    fulfilled: 0,
  };

  // 1) Due units — in small batches, so no more rows are leased than fit.
  await guarded("sweepIssue", undefined, async () => {
    const seen = new Set<number>();
    while (seen.size < SWEEP_ISSUE_LIMIT && left() >= MIN_ISSUE_MS) {
      const batch = await claimDueGiftVouchers({ limit: Math.min(SWEEP_CLAIM_BATCH, SWEEP_ISSUE_LIMIT - seen.size) });
      if (batch.length === 0) break;
      let fresh = 0;
      for (const v of batch) {
        if (seen.has(v.id)) {
          // Handed back earlier in this run (out of time) — not again.
          await releaseGiftVoucherLock(v.id);
          continue;
        }
        seen.add(v.id);
        fresh++;
        await issueOne(v, "auto", ctx);
      }
      if (fresh === 0) break;
    }
  });

  // 2) Revocation flags of issued cards the webhook could not finish. Flags
  //    resolved as „used“ stay for the operator, so look past them (pages).
  await guarded("sweepRevocations", undefined, async () => {
    const todo: GiftVoucher[] = [];
    for (let page = 1; page <= SWEEP_REVOKE_PAGES && todo.length < SWEEP_REVOKE_LIMIT && left() >= MIN_STEP_MS; page++) {
      const { rows, total } = await listGiftVouchers({ status: "issued", attention: true, page, pageSize: 100 });
      todo.push(...pickRevocationsToResolve(rows, SWEEP_REVOKE_LIMIT - todo.length));
      if (page * 100 >= total || rows.length === 0) break;
    }
    for (const v of todo) {
      if (left() < MIN_STEP_MS) break;
      await resolveIssuedRevocation(v);
    }
  });

  // 3) Due mails (first tries the issuing could not fit, retries).
  await guarded("sweepMails", undefined, async () => {
    if (left() < MIN_MAIL_MS) return;
    const due = await listGiftVouchersDueForMail({ limit: SWEEP_MAIL_LIMIT });
    for (const v of due) {
      if (left() < MIN_MAIL_MS) break;
      // Soft claim: a parallel run skips it meanwhile; the send writes the
      // real state (the attempt count — and so the idempotency key — stays).
      await setGiftVoucherMailState(v.id, { status: "pending", nextAttemptAt: new Date(Date.now() + MAIL_CLAIM_MS), countAttempt: false });
      if ((await sendGiftVoucherMail(v.id)) === "sent") ctx.tally.mailed++;
    }
  });

  // 4) The print queue (P4: behind the legal gate, print.one configured).
  if (left() >= MIN_PRINT_MS) {
    const r = await guarded("sweepPrintSubmit", null, () =>
      submitDueGiftVoucherPrintJobs({ limit: 10, deadlineMs: deadlineMs - MIN_STEP_MS })
    );
    if (r) ctx.tally.printSubmitted += r.submitted;
  }
  if (left() >= MIN_STEP_MS) {
    const r = await guarded("sweepPrintPoll", null, () => pollGiftVoucherPrintJobs({ limit: 20 }));
    if (r) result.printPolled = r.updated;
  }
  if (left() >= MIN_STEP_MS) {
    const r = await guarded("sweepPrintCleanup", null, () => cleanupGiftVoucherPrintAssets({ limit: 20 }));
    if (r) result.assetsCleaned = r.deleted;
  }

  // 5) Balances (issued cards not read for 24 h, live ones first). A card
  //    with a pending revocation is resolved on the way (its sibling search
  //    needs the time of a revocation step).
  await guarded("sweepBalances", undefined, async () => {
    if (left() < MIN_STEP_MS) return;
    const rows = await listGiftVouchersForBalanceSync({ limit: SWEEP_BALANCE_LIMIT, olderThanHours: 24 });
    for (const v of rows) {
      if (left() < 4_000) break;
      if (revokeReasonOf(v.attention) && left() < MIN_STEP_MS) continue;
      if ((await syncBalance(v)).ok) result.balancesSynced++;
    }
  });

  // 6) Fulfilment (optional).
  if (isGiftVoucherFulfillOrdersEnabled() && left() >= MIN_STEP_MS) {
    result.fulfilled = await guarded("sweepFulfil", 0, () => fulfilGiftVoucherOrders(deadlineMs));
  }

  const t = ctx.tally;
  result.issued = t.issued;
  result.held = t.held;
  result.deferred = t.deferred;
  result.failed = t.failed;
  result.mailed = t.mailed;
  result.printSubmitted = t.printSubmitted;
  return result;
}

/**
 * Orders whose fulfilment failed for good (a line assigned to a fulfilment
 * service, refused, missing): skipped for a while on this instance, so they
 * do not hold up the others run after run (an operator fulfils them in
 * Shopify). Per instance and best effort only.
 */
const fulfilBackoff = new Map<string, number>();
const FULFIL_BACKOFF_MS = 6 * 60 * 60_000;
/** Orders read per run as fulfilment candidates (each costs a DB read; the Shopify calls are capped). */
const FULFIL_CANDIDATES = 50;

/**
 * Mark voucher (and Premium-Karte) lines fulfilled in Shopify — needs the
 * scope write_merchant_managed_fulfillment_orders. The candidates are the
 * orders with issued, unfulfilled shop vouchers whose cards do not wait for
 * the printer (listGiftVoucherOrdersToFulfil — most recently ready first,
 * however old the order), at most SWEEP_FULFIL_ORDERS calls per run. Returns
 * the voucher rows marked.
 */
async function fulfilGiftVoucherOrders(deadlineMs: number): Promise<number> {
  const candidates = await listGiftVoucherOrdersToFulfil({ limit: FULFIL_CANDIDATES });
  const now = Date.now();
  for (const [orderId, until] of fulfilBackoff) if (until <= now) fulfilBackoff.delete(orderId);
  const orders = candidates.filter((orderId) => !fulfilBackoff.has(orderId));
  let marked = 0;
  let calls = 0;
  for (const orderId of orders) {
    if (calls >= SWEEP_FULFIL_ORDERS || deadlineMs - Date.now() < MIN_STEP_MS) break;
    const units = await listGiftVouchersForOrder(orderId);
    const jobs = (
      await Promise.all(units.filter((u) => u.delivery === "print").map((u) => getGiftVoucherPrintJobForVoucher(u.id)))
    ).filter((j): j is NonNullable<typeof j> => j !== null);
    const plan = planGiftVoucherFulfilment(units, jobs);
    if (plan.lineItemIds.length === 0 || plan.voucherIds.length === 0) continue;
    calls++;
    const r = await fulfillGiftVoucherLines(`gid://shopify/Order/${orderId}`, plan.lineItemIds);
    if (r.ok) marked += await markGiftVoucherFulfilled(plan.voucherIds);
    else if (!r.retryable) fulfilBackoff.set(orderId, Date.now() + FULFIL_BACKOFF_MS);
  }
  return marked;
}
