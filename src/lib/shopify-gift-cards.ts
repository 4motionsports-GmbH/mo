// Shopify Admin API side of the Geschenkgutscheine (docs/GIFT_VOUCHERS.md): issue, find,
// read and deactivate the real Shopify gift card behind a voucher; re-read an order before
// issuing (test, cancelled, paid, fraud risk); resolve the two voucher products; check the
// access scopes; mark voucher lines fulfilled. The pure parts — GraphQL documents, parsing,
// error classification, fulfilment planning — live in shopify-gift-cards-core.mjs (tested).
//
// Every function is fail-soft: it never throws and returns a typed result. Transport is
// adminGraphql (lib/shopify.ts: shared token cache, throttle ride-out). Mutations are NOT
// retried on a transport error — their outcome is unknown — so createShopifyGiftCard
// reports such a failure as kind "unknown" and the caller (gift-voucher-issue.ts) looks
// the card up by its code before trying again. The code is Mo's own and stored before the
// call, so a second giftCardCreate with it answers TAKEN instead of issuing a second card.
// Each call also races its own deadline: adminGraphql's timeout does not cover a cold
// token exchange.
//
// SECURITY: a gift-card code is bearer value. It goes to Shopify and nowhere else — never
// into a log, a reportError context or a returned message (Shopify echoes request
// variables in some errors, so calls that carry a code never copy Shopify's raw texts).
//
// Scopes: write_gift_cards (also grants read_gift_cards) is required;
// read_gift_card_transactions and write_merchant_managed_fulfillment_orders are optional.
// A new scope needs a new app version and a REINSTALL (client-credentials tokens only
// carry the scopes granted at install).

import { adminGraphql, isShopifyConfigured, ShopifyThrottledError } from "./shopify";
import { isThrottleGateActive } from "./shopify-throttle-gate";
import { reportError } from "./observability";
import { TtlCache } from "./ttl-cache.mjs";
import { giftVoucherProductHandles } from "./gift-voucher-flags.mjs";
import {
  ACCESS_SCOPES_QUERY,
  FULFILLMENT_CREATE_MUTATION,
  FULFILLMENT_LINE_ITEMS_PAGE,
  FULFILLMENT_ORDERS_PAGE,
  FULFILLMENT_ORDERS_QUERY,
  GIFT_CARD_BY_ID_QUERY,
  GIFT_CARD_CONFIGURATION_QUERY,
  GIFT_CARD_CREATE_MUTATION,
  GIFT_CARD_DEACTIVATE_MUTATION,
  GIFT_CARDS_BY_CODE_QUERY,
  GIFT_VOUCHER_PRODUCTS_QUERY,
  ORDER_SNAPSHOT_QUERY,
  centsToShopifyDecimal,
  classifyGiftCardUserErrors,
  describeAdminGraphqlError,
  evaluateGiftVoucherScopes,
  fulfillmentUserErrorMessage,
  giftCardDeactivateErrorMessage,
  giftCardGid as toGiftCardGid,
  giftCardLastFour,
  giftCardMutationFailure,
  giftCardSearchQuery,
  isIsoCalendarDate,
  isRetryableAdminError,
  isTemporaryFulfillmentBlock,
  lineItemGid as toLineItemGid,
  normalizeGiftCardCode,
  normalizeProductHandle,
  orderGid as toOrderGid,
  parseGiftCardConfiguration,
  parseGiftCardNode,
  parseGiftVoucherProduct,
  parseOrderSnapshot,
  pickGiftCardByCode,
  planGiftVoucherFulfillment,
} from "./shopify-gift-cards-core.mjs";
import type { AdminErrorDescription } from "./shopify-gift-cards-core.mjs";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ShopifyGiftCardInfo {
  id: string;
  /** Last four characters of the code, upper-case. */
  lastCharacters: string;
  balanceCents: number;
  initialCents: number;
  currency: string;
  /** "YYYY-MM-DD"; null = never expires. */
  expiresOn: string | null;
  enabled: boolean;
  deactivatedAt: string | null;
  createdAt: string;
}

/**
 * - taken: the code exists already (maybe ours from an attempt whose answer got lost) —
 *   look it up with findShopifyGiftCardByCode; retryable.
 * - denied: missing scope / rejected credentials; retryable once the operator fixed it.
 * - invalid: Shopify refuses the input as such; not retryable.
 * - limit: above the shop's gift-card issue limit; not retryable.
 * - unknown: transport error, timeout, throttle, internal Shopify error — the card may or
 *   may not exist: look it up by code, then retry.
 * - unconfigured: SHOPIFY_* missing; retryable once configured.
 */
export type CreateGiftCardResult =
  | { ok: true; card: ShopifyGiftCardInfo }
  | {
      ok: false;
      kind: "taken" | "denied" | "invalid" | "limit" | "unknown" | "unconfigured";
      message: string;
      retryable: boolean;
    };

export interface GiftVoucherOrderSnapshot {
  id: string;
  gid: string;
  name: string;
  test: boolean;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  fullyPaid: boolean;
  email: string | null;
  currencyCode: string;
  riskLevel: "HIGH" | "MEDIUM" | "LOW" | "NONE" | "PENDING" | null;
  riskRecommendation: "ACCEPT" | "CANCEL" | "INVESTIGATE" | "NONE" | null;
}

export interface GiftVoucherProductInfo {
  gid: string;
  numericId: string;
  handle: string;
  title: string;
  status: string;
  isGiftCard: boolean;
  variants: Array<{
    gid: string;
    numericId: string;
    title: string;
    priceCents: number;
    taxable: boolean;
    requiresShipping: boolean;
  }>;
}

type GiftCardLookup = { ok: true; card: ShopifyGiftCardInfo | null } | { ok: false; message: string };
type ProductsResult =
  | { ok: true; voucher: GiftVoucherProductInfo | null; print: GiftVoucherProductInfo | null }
  | { ok: false; message: string };

// ── Transport ────────────────────────────────────────────────────────────────

const ROUTE = "lib/shopify-gift-cards";
/** adminGraphql's timeout on the background paths (sweep, webhook after(), admin). Its
 *  abort signal covers every attempt, throttle retries included. */
const FETCH_TIMEOUT_MS = 20_000;
/** Hard bound of one background call, including a cold token exchange and throttle waits.
 *  Longer than FETCH_TIMEOUT_MS on purpose: by the time this deadline answers "timeout",
 *  the abort signal has fired, so no request — a throttle-retried mutation included — can
 *  still leave for Shopify after the caller was told the outcome is open. */
const CALL_DEADLINE_MS = 30_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const NOTE_MAX_CHARS = 255;
const NOT_CONFIGURED = "Shopify ist nicht konfiguriert (SHOPIFY_*).";
const TIMED_OUT = "Shopify hat nicht rechtzeitig geantwortet (Zeitüberschreitung).";

type CallResult<T> = { ok: true; data: T } | { ok: false; error: AdminErrorDescription };

interface CallOptions {
  /** Bound the call for a request path: no throttle wait, no retry, skip while the shared
   *  throttle gate is up, give up after this many ms. Omitted: the background defaults. */
  timeoutMs?: number;
  /** The gift-card code the call carries — never copied into a message. */
  secret?: string;
  /** Append Shopify's (scrubbed) error text to the message; ignored when `secret` is set. */
  detail?: boolean;
}

/** Resolve `work`, or `onTimeout()` once `ms` passed — whichever comes first. */
async function withDeadline<T>(work: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(onTimeout()), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** One Admin GraphQL call that never throws. */
async function callShopify<T>(
  query: string,
  variables: Record<string, unknown>,
  opts: CallOptions = {}
): Promise<CallResult<T>> {
  const bounded = typeof opts.timeoutMs === "number" && opts.timeoutMs > 0;
  const deadlineMs = bounded ? (opts.timeoutMs as number) : CALL_DEADLINE_MS;
  const describe = (err: unknown): AdminErrorDescription =>
    describeAdminGraphqlError(err, { detail: opts.detail === true && !opts.secret, secret: opts.secret ?? null });
  const work = (async (): Promise<CallResult<T>> => {
    try {
      if (bounded && (await isThrottleGateActive())) {
        return { ok: false, error: describe(new ShopifyThrottledError("Shopify GraphQL throttled (shared gate is up)")) };
      }
      const data = await adminGraphql<T>(
        query,
        variables,
        bounded ? { timeoutMs: deadlineMs, retry: false } : { timeoutMs: FETCH_TIMEOUT_MS }
      );
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: describe(err) };
    }
  })();
  return withDeadline(work, deadlineMs, () => ({
    ok: false,
    error: describe(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })),
  }));
}

/** Report a failure — with the SAFE message only, never the raw error or any PII. */
function report(phase: string, failure: { kind: string; message: string }): void {
  reportError(new Error(failure.message), { route: ROUTE, phase, kind: failure.kind });
}

/** A bug that slipped through: report it without its text (it might echo a code). */
function reportUnexpected(phase: string, err: unknown): string {
  const message = describeAdminGraphqlError(err).message;
  report(phase, { kind: "unexpected", message });
  return message;
}

// ── Per-instance cache (the kpi-cache.ts pattern) ────────────────────────────

interface CacheStore {
  cache: TtlCache;
  inflight: Map<string, Promise<unknown>>;
}

// One store per process; on globalThis so dev HMR keeps it across module reloads.
const STORE_KEY = "__moGiftVoucherShopifyCache";
function cacheStore(): CacheStore {
  const g = globalThis as unknown as Record<string, CacheStore | undefined>;
  if (!g[STORE_KEY]) g[STORE_KEY] = { cache: new TtlCache(CACHE_TTL_MS), inflight: new Map() };
  return g[STORE_KEY];
}

/**
 * Serve `key` from the cache (10 minutes), else run `loader` once — concurrent callers
 * share the in-flight promise — and cache the value when `keep` accepts it (never a
 * failure). `fresh` skips the cache but still joins a load already in flight.
 */
async function cached<T>(key: string, loader: () => Promise<T>, keep: (value: T) => boolean, fresh = false): Promise<T> {
  const s = cacheStore();
  if (!fresh) {
    const hit = s.cache.get(key, Date.now());
    if (hit) return hit.value as T;
  }
  let pending = s.inflight.get(key) as Promise<T> | undefined;
  if (!pending) {
    pending = (async () => {
      try {
        const value = await loader();
        const at = Date.now();
        if (keep(value)) s.cache.set(key, value, at);
        s.cache.prune(at);
        return value;
      } finally {
        s.inflight.delete(key);
      }
    })();
    s.inflight.set(key, pending);
  }
  return pending;
}

// ── Gift cards ───────────────────────────────────────────────────────────────

interface GiftCardCreatePayload {
  giftCard: unknown;
  giftCardCode?: string | null;
  userErrors: unknown[];
}

function invalidInput(message: string): CreateGiftCardResult {
  return { ok: false, kind: "invalid", message, retryable: false };
}

/**
 * Issue a Shopify gift card with Mo's code. `code` is 8–20 letters/digits (spaces and
 * hyphens are dropped, sent upper-case); `amountCents` > 0 in the shop currency;
 * `expiresOn` "YYYY-MM-DD" or null (never expires); `note` is internal (not shown to the
 * customer). No customer and no recipient are set — Shopify would mail the code itself.
 */
export async function createShopifyGiftCard(input: {
  code: string;
  amountCents: number;
  expiresOn: string | null;
  note: string;
}): Promise<CreateGiftCardResult> {
  try {
    const code = normalizeGiftCardCode(input?.code);
    if (!code) return invalidInput("Ungültiger Gutscheincode (8–20 Buchstaben oder Ziffern).");
    const initialValue = centsToShopifyDecimal(input?.amountCents);
    if (!initialValue) return invalidInput("Ungültiger Betrag (ganze Cent, größer als 0).");
    const expiresOn = input?.expiresOn ?? null;
    if (expiresOn !== null && !isIsoCalendarDate(expiresOn)) return invalidInput("Ungültiges Ablaufdatum (JJJJ-MM-TT).");
    if (!isShopifyConfigured()) return { ok: false, kind: "unconfigured", message: NOT_CONFIGURED, retryable: true };

    const giftCardInput: Record<string, string> = { initialValue, code };
    if (expiresOn) giftCardInput.expiresOn = expiresOn;
    const note = typeof input?.note === "string" ? input.note.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX_CHARS) : "";
    if (note) giftCardInput.note = note;

    const r = await callShopify<{ giftCardCreate: GiftCardCreatePayload | null }>(
      GIFT_CARD_CREATE_MUTATION,
      { input: giftCardInput },
      { secret: code }
    );
    if (!r.ok) {
      const failure = giftCardMutationFailure(r.error);
      if (failure.kind !== "unconfigured") report("createShopifyGiftCard", failure);
      return { ok: false, ...failure };
    }
    const payload = r.data.giftCardCreate;
    const userError = classifyGiftCardUserErrors(payload?.userErrors, code);
    if (userError) {
      // TAKEN is part of the adoption flow and the limit a business rule — no alarm.
      if (userError.kind === "invalid" || userError.kind === "unknown") report("createShopifyGiftCard", userError);
      return { ok: false, kind: userError.kind, message: userError.message, retryable: userError.retryable };
    }
    const card = parseGiftCardNode(payload?.giftCard);
    if (!card) {
      const message = "Shopify hat keine Karte zurückgegeben — Ergebnis offen, Mo sucht sie über den Code.";
      report("createShopifyGiftCard", { kind: "unknown", message });
      return { ok: false, kind: "unknown", message, retryable: true };
    }
    // The card must carry Mo's code — the one that gets printed. Shopify answers it lower-case.
    const echoed = typeof payload?.giftCardCode === "string" ? normalizeGiftCardCode(payload.giftCardCode) : null;
    if ((echoed !== null && echoed !== code) || card.lastCharacters !== giftCardLastFour(code)) {
      const message = `Shopify hat die Karte ${card.id} mit einem anderen Code angelegt — bitte in Shopify prüfen und sperren.`;
      report("createShopifyGiftCard", { kind: "invalid", message });
      return { ok: false, kind: "invalid", message, retryable: false };
    }
    return { ok: true, card };
  } catch (err) {
    const message = reportUnexpected("createShopifyGiftCard", err);
    return { ok: false, kind: "unknown", message, retryable: true };
  }
}

/**
 * Find the card that carries `code` — after a lost answer or a TAKEN: giftCards(query:
 * <code>) and keep the hit whose last characters match. `card: null` = no such card (yet;
 * Shopify's search index may lag a few seconds behind a create). Two matching cards are
 * refused (`ok: false`), never guessed. The caller should also compare the amount before
 * adopting a found card. Deactivated cards are found too (check `enabled`).
 */
export async function findShopifyGiftCardByCode(code: string): Promise<GiftCardLookup> {
  try {
    const normalized = normalizeGiftCardCode(code);
    const query = giftCardSearchQuery(normalized);
    if (!normalized || !query) return { ok: false, message: "Ungültiger Gutscheincode." };
    if (!isShopifyConfigured()) return { ok: false, message: NOT_CONFIGURED };
    const r = await callShopify<{ giftCards: { nodes?: unknown[] } | null }>(
      GIFT_CARDS_BY_CODE_QUERY,
      { query },
      { secret: normalized }
    );
    if (!r.ok) {
      report("findShopifyGiftCardByCode", r.error);
      return { ok: false, message: r.error.message };
    }
    const { card, ambiguous } = pickGiftCardByCode(r.data.giftCards?.nodes, normalized);
    if (ambiguous) {
      const message = "Mehrere Shopify-Geschenkkarten passen zu diesem Code — bitte in Shopify prüfen.";
      report("findShopifyGiftCardByCode", { kind: "ambiguous", message });
      return { ok: false, message };
    }
    return { ok: true, card };
  } catch (err) {
    return { ok: false, message: reportUnexpected("findShopifyGiftCardByCode", err) };
  }
}

/**
 * Read one card (balance, state). `card: null` when Shopify has no such card. With
 * `opts.timeoutMs` the read is bounded for a request path (the storefront balance check):
 * no throttle wait, no retry, skipped while the shared throttle gate is up — the caller
 * falls back to the stored balance.
 */
export async function getShopifyGiftCard(id: string, opts: { timeoutMs?: number } = {}): Promise<GiftCardLookup> {
  try {
    const gid = toGiftCardGid(id);
    if (!gid) return { ok: false, message: "Ungültige ID einer Shopify-Geschenkkarte." };
    if (!isShopifyConfigured()) return { ok: false, message: NOT_CONFIGURED };
    const bounded = typeof opts.timeoutMs === "number" && opts.timeoutMs > 0;
    const r = await callShopify<{ giftCard: unknown }>(
      GIFT_CARD_BY_ID_QUERY,
      { id: gid },
      { detail: true, timeoutMs: bounded ? opts.timeoutMs : undefined }
    );
    if (!r.ok) {
      // On a bounded read a timeout or a throttle is expected (the caller falls back).
      if (!(bounded && (r.error.kind === "timeout" || r.error.kind === "throttled"))) report("getShopifyGiftCard", r.error);
      return { ok: false, message: r.error.message };
    }
    if (r.data.giftCard == null) return { ok: true, card: null };
    const card = parseGiftCardNode(r.data.giftCard);
    if (!card) {
      const message = "Shopify hat eine unvollständige Geschenkkarte geliefert.";
      report("getShopifyGiftCard", { kind: "parse", message });
      return { ok: false, message };
    }
    return { ok: true, card };
  } catch (err) {
    return { ok: false, message: reportUnexpected("getShopifyGiftCard", err) };
  }
}

/**
 * Deactivate a card — IRREVERSIBLE (Shopify cannot re-enable it). Idempotent: when the call
 * fails but the card turns out to be deactivated already (an earlier attempt whose answer
 * got lost, a second click), that counts as success.
 */
export async function deactivateShopifyGiftCard(
  id: string
): Promise<{ ok: true; deactivatedAt: string } | { ok: false; message: string }> {
  try {
    const gid = toGiftCardGid(id);
    if (!gid) return { ok: false, message: "Ungültige ID einer Shopify-Geschenkkarte." };
    if (!isShopifyConfigured()) return { ok: false, message: NOT_CONFIGURED };
    const r = await callShopify<{
      giftCardDeactivate: {
        giftCard: { id?: string; enabled?: boolean; deactivatedAt?: string | null } | null;
        userErrors: unknown[];
      } | null;
    }>(GIFT_CARD_DEACTIVATE_MUTATION, { id: gid }, { detail: true });
    let failure: { kind: string; message: string };
    if (r.ok) {
      const payload = r.data.giftCardDeactivate;
      const userErrors = Array.isArray(payload?.userErrors) ? payload.userErrors : [];
      const card = payload?.giftCard ?? null;
      if (userErrors.length === 0 && card) {
        if (typeof card.deactivatedAt === "string" && card.deactivatedAt) return { ok: true, deactivatedAt: card.deactivatedAt };
        if (card.enabled === false) return { ok: true, deactivatedAt: new Date().toISOString() };
      }
      failure = userErrors.length
        ? { kind: "userErrors", message: giftCardDeactivateErrorMessage(userErrors) }
        : { kind: "unconfirmed", message: "Shopify hat die Sperrung nicht bestätigt." };
    } else {
      failure = r.error;
    }
    const check = await getShopifyGiftCard(gid);
    if (check.ok && check.card && (check.card.deactivatedAt || !check.card.enabled)) {
      return { ok: true, deactivatedAt: check.card.deactivatedAt ?? new Date().toISOString() };
    }
    report("deactivateShopifyGiftCard", failure);
    return { ok: false, message: failure.message };
  } catch (err) {
    return { ok: false, message: reportUnexpected("deactivateShopifyGiftCard", err) };
  }
}

/** The shop's limit for issuing one card (giftCardConfiguration.issueLimit, shop currency),
 *  cached 10 minutes per instance; null when unknown (no scope, Shopify down). */
export async function getGiftCardIssueLimitCents(): Promise<number | null> {
  try {
    if (!isShopifyConfigured()) return null;
    return await cached<number | null>("issueLimit", loadIssueLimitCents, (v) => typeof v === "number");
  } catch (err) {
    reportUnexpected("getGiftCardIssueLimitCents", err);
    return null;
  }
}

async function loadIssueLimitCents(): Promise<number | null> {
  const r = await callShopify<{ giftCardConfiguration: unknown }>(GIFT_CARD_CONFIGURATION_QUERY, {}, { detail: true });
  if (!r.ok) {
    // A missing scope shows in the setup check (checkGiftVoucherScopes) — no alarm per call.
    if (r.error.kind !== "denied" && r.error.kind !== "unconfigured") report("getGiftCardIssueLimitCents", r.error);
    return null;
  }
  return parseGiftCardConfiguration(r.data.giftCardConfiguration)?.issueLimitCents ?? null;
}

// ── Orders ───────────────────────────────────────────────────────────────────

/**
 * Re-read an order right before issuing (the webhook payload may be stale): test,
 * cancellation, payment state and Shopify's fraud risk (the deciding level over all
 * assessments — HIGH > PENDING > MEDIUM > LOW > NONE). `orderId` is numeric or a gid.
 */
export async function getGiftVoucherOrderSnapshot(
  orderId: string
): Promise<{ ok: true; order: GiftVoucherOrderSnapshot } | { ok: false; message: string; notFound?: boolean }> {
  try {
    const gid = toOrderGid(orderId);
    if (!gid) return { ok: false, message: "Ungültige Shopify-Bestell-ID.", notFound: true };
    if (!isShopifyConfigured()) return { ok: false, message: NOT_CONFIGURED };
    const r = await callShopify<{ order: unknown }>(ORDER_SNAPSHOT_QUERY, { id: gid }, { detail: true });
    if (!r.ok) {
      if (r.error.kind !== "unconfigured") report("getGiftVoucherOrderSnapshot", r.error);
      return { ok: false, message: r.error.message };
    }
    if (r.data.order == null) return { ok: false, message: "Die Bestellung gibt es in Shopify nicht.", notFound: true };
    const order = parseOrderSnapshot(r.data.order);
    if (!order) {
      const message = "Shopify hat eine unvollständige Bestellung geliefert.";
      report("getGiftVoucherOrderSnapshot", { kind: "parse", message });
      return { ok: false, message };
    }
    return { ok: true, order };
  } catch (err) {
    return { ok: false, message: reportUnexpected("getGiftVoucherOrderSnapshot", err) };
  }
}

// ── Products ─────────────────────────────────────────────────────────────────

/**
 * The voucher product and the print add-on, looked up by their handles
 * (GIFT_VOUCHER_PRODUCT_HANDLE / GIFT_VOUCHER_PRINT_PRODUCT_HANDLE, gift-voucher-flags.mjs)
 * with productByIdentifier. A product that does not exist is `null`. Cached 10 minutes per
 * instance with one shared in-flight load; `fresh` re-reads (setup check). `timeoutMs`
 * bounds the WAIT of a request path (the orders/paid webhook must answer within 5 s) —
 * the load itself keeps running and warms the cache for Shopify's redelivery.
 */
export async function resolveGiftVoucherProducts(
  opts: { fresh?: boolean; timeoutMs?: number } = {}
): Promise<ProductsResult> {
  try {
    if (!isShopifyConfigured()) return { ok: false, message: NOT_CONFIGURED };
    const handles = giftVoucherProductHandles();
    const voucher = normalizeProductHandle(handles.voucher);
    const print = normalizeProductHandle(handles.print);
    const load = cached<ProductsResult>(
      `products:${voucher}|${print}`,
      () => loadGiftVoucherProducts(voucher, print),
      (r) => r.ok,
      opts.fresh === true
    );
    if (typeof opts.timeoutMs === "number" && opts.timeoutMs > 0) {
      return await withDeadline(load, opts.timeoutMs, () => ({ ok: false, message: TIMED_OUT }));
    }
    return await load;
  } catch (err) {
    return { ok: false, message: reportUnexpected("resolveGiftVoucherProducts", err) };
  }
}

async function loadGiftVoucherProducts(voucher: string, print: string): Promise<ProductsResult> {
  const r = await callShopify<{ voucher: unknown; print: unknown }>(
    GIFT_VOUCHER_PRODUCTS_QUERY,
    { voucher, print },
    { detail: true }
  );
  if (!r.ok) {
    if (r.error.kind !== "unconfigured") report("resolveGiftVoucherProducts", r.error);
    return { ok: false, message: r.error.message };
  }
  return { ok: true, voucher: parseGiftVoucherProduct(r.data.voucher), print: parseGiftVoucherProduct(r.data.print) };
}

// ── Scopes ───────────────────────────────────────────────────────────────────

/**
 * Which access scopes the app's token carries and which of the voucher scopes are missing:
 * `missing` = required (write_gift_cards), `optionalMissing` = read_gift_card_transactions /
 * write_merchant_managed_fulfillment_orders. A write scope counts as its read scope too.
 */
export async function checkGiftVoucherScopes(): Promise<
  { ok: true; granted: string[]; missing: string[]; optionalMissing: string[] } | { ok: false; message: string }
> {
  try {
    if (!isShopifyConfigured()) return { ok: false, message: NOT_CONFIGURED };
    const r = await callShopify<{ currentAppInstallation: { accessScopes?: unknown[] } | null }>(
      ACCESS_SCOPES_QUERY,
      {},
      { detail: true }
    );
    if (!r.ok) {
      report("checkGiftVoucherScopes", r.error);
      return { ok: false, message: r.error.message };
    }
    return { ok: true, ...evaluateGiftVoucherScopes(r.data.currentAppInstallation?.accessScopes) };
  } catch (err) {
    return { ok: false, message: reportUnexpected("checkGiftVoucherScopes", err) };
  }
}

// ── Fulfilment ───────────────────────────────────────────────────────────────

type FulfillmentOrdersData = { order: { fulfillmentOrders?: unknown } | null };
type FulfillmentCreateData = { fulfillmentCreate: { userErrors?: unknown[] } | null };

/**
 * Mark the given order line items (voucher lines, print add-on lines; numeric ids or gids)
 * fulfilled in Shopify — fulfillmentCreate with notifyCustomer:false, one call per
 * fulfillment order that offers CREATE_FULFILLMENT. Planned from Shopify's current
 * remaining quantities, so a repeat after a lost answer does nothing twice. `ok: true` once
 * every line is done (`fulfilled` = lines completed by THIS call); otherwise `retryable`
 * says whether a later run can help (no fulfillment orders yet, a hold, a transport error)
 * or a person has to look (Shopify refused, line not found, a line assigned to a
 * fulfillment service). Needs write_merchant_managed_fulfillment_orders.
 */
export async function fulfillGiftVoucherLines(
  orderGid: string,
  lineItemGids: string[]
): Promise<{ ok: true; fulfilled: number } | { ok: false; message: string; retryable: boolean }> {
  try {
    const gid = toOrderGid(orderGid);
    if (!gid) return { ok: false, message: "Ungültige Shopify-Bestell-ID.", retryable: false };
    const targets = [...new Set((Array.isArray(lineItemGids) ? lineItemGids : []).map(toLineItemGid))].filter(
      (x): x is string => typeof x === "string"
    );
    if (targets.length === 0) return { ok: true, fulfilled: 0 };
    if (!isShopifyConfigured()) return { ok: false, message: NOT_CONFIGURED, retryable: true };

    const r = await callShopify<FulfillmentOrdersData>(FULFILLMENT_ORDERS_QUERY, { id: gid }, { detail: true });
    if (!r.ok) {
      if (r.error.kind !== "unconfigured") report("fulfillGiftVoucherLines", r.error);
      return { ok: false, message: r.error.message, retryable: isRetryableAdminError(r.error) };
    }
    if (!r.data.order) return { ok: false, message: "Die Bestellung gibt es in Shopify nicht.", retryable: false };
    const connection = r.data.order.fulfillmentOrders as { nodes?: unknown[] } | null | undefined;
    if (!connection || !Array.isArray(connection.nodes) || connection.nodes.length === 0) {
      // Shopify creates fulfillment orders asynchronously after the order.
      return { ok: false, message: "Shopify hat für die Bestellung noch keine Fulfillment-Aufträge angelegt.", retryable: true };
    }

    const plan = planGiftVoucherFulfillment(connection, targets);
    const fulfilled = new Set<string>();
    const failures: Array<{ message: string; retryable: boolean }> = [];
    for (const request of plan.requests) {
      const m = await callShopify<FulfillmentCreateData>(
        FULFILLMENT_CREATE_MUTATION,
        {
          fulfillment: {
            lineItemsByFulfillmentOrder: [
              { fulfillmentOrderId: request.fulfillmentOrderId, fulfillmentOrderLineItems: request.fulfillmentOrderLineItems },
            ],
            notifyCustomer: false,
          },
        },
        { detail: true }
      );
      if (!m.ok) {
        failures.push({ message: m.error.message, retryable: isRetryableAdminError(m.error) });
        continue;
      }
      const userErrors = m.data.fulfillmentCreate?.userErrors ?? [];
      if (userErrors.length) {
        failures.push({ message: fulfillmentUserErrorMessage(userErrors), retryable: false });
        continue;
      }
      for (const lineItemId of request.lineItemIds) fulfilled.add(lineItemId);
    }

    if (failures.length) {
      const message = failures.map((f) => f.message).join(" · ");
      report("fulfillGiftVoucherLines", { kind: "fulfillmentCreate", message });
      return { ok: false, message, retryable: failures.every((f) => f.retryable) };
    }
    if (plan.blocked.length) {
      const statuses = [...new Set(plan.blocked.map((b) => b.status))].join(", ");
      const temporary = plan.blocked.every((b) => isTemporaryFulfillmentBlock(b.status));
      return {
        ok: false,
        message: temporary
          ? `${plan.blocked.length} Gutschein-Position(en) warten in Shopify (Fulfillment-Status ${statuses}).`
          : `${plan.blocked.length} Gutschein-Position(en) kann Mo nicht als erledigt markieren (Fulfillment-Status ${statuses}, z. B. einem Fulfillment-Dienst zugewiesen) — bitte in Shopify erledigen.`,
        retryable: temporary,
      };
    }
    if (plan.missing.length) {
      const message = plan.truncated
        ? `Die Bestellung hat mehr als ${FULFILLMENT_ORDERS_PAGE} Fulfillment-Aufträge oder ${FULFILLMENT_LINE_ITEMS_PAGE} Positionen — bitte die Gutschein-Positionen in Shopify als erledigt markieren.`
        : `${plan.missing.length} Gutschein-Position(en) stehen in keinem Fulfillment-Auftrag — bitte in Shopify prüfen.`;
      report("fulfillGiftVoucherLines", { kind: "missing", message });
      return { ok: false, message, retryable: false };
    }
    return { ok: true, fulfilled: fulfilled.size };
  } catch (err) {
    return { ok: false, message: reportUnexpected("fulfillGiftVoucherLines", err), retryable: true };
  }
}
