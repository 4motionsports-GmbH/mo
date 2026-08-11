# Order attribution — "was this purchase made because of Mo?"

This document describes the order-attribution pipeline (migration `0042`): the
mechanism that ties a real Shopify order back to a Mo consultation, the honest
tiers it reports, its GDPR posture, and the operator setup.

## The gap it closes

Before this round, an order was attributable to Mo in exactly two narrow
cases: it redeemed a unique `MS5-`/`MK-` discount code, or the buyer was a
DOI-confirmed email contact matched in the recommendation→purchase loop.
Everything else — purchases through Mo's own cart buttons, and especially
"Mo recommended it, the user typed it into the search bar and bought it" —
was invisible (the old honesty note in `lib/kpi-revenue-store`).

The fix is a **first-party marker on the cart**, not cookies: the widget
already runs on the storefront domain with a stable pseudonymous session id.
Shopify's own cart is the carrier:

1. **Mo-built cart links** (summary email, marketing email, bundle offers)
   carry `attributes[_mo]=<token>` (+ `ref=mo`) as cart-permalink query
   parameters — note/attribute params are officially supported on cart
   permalinks and survive checkout as the order's `note_attributes`.
2. **The widget stamps the live storefront cart** with the same attribute via
   a same-origin `POST /cart/update.js` (see §Widget). From then on *whatever*
   lands in that cart — Mo's card checkout or a manually searched product —
   the resulting order carries the marker.
3. **The `orders/create` + `orders/paid` webhooks** deliver every order to
   `POST /api/webhooks/shopify` (same HMAC gate as the stock webhook). Orders
   carrying a Mo marker are ingested into `mo_orders`; unmarked orders are
   **never stored** (data minimisation).

The token is **opaque and server-minted** (`mo_attribution_tokens`): nothing
visible in the Shopify admin can be joined back to a conversation without this
backend's database.

## Attribution tiers (honesty preserved)

Snapshot at ingest (`lib/order-attribution.mjs`), shown verbatim in the KPI
tab as **"Mo-zugeordneter Umsatz (Bestell-Webhook)"**:

| Tier | Definition |
| --- | --- |
| **Direkt** | The order redeemed a Mo code (MS5-/MK-), or came through a cart link Mo itself built (summary email, marketing email, bundle offer — token sources `summary_email` / `marketing_email` / `bundle`). |
| **Beraten & gekauft** (`assisted`) | The widget stamped the live cart (source `widget`) AND ≥1 purchased line matches a product discussed/selected in that session's consultation (normalised-handle matching, `lib/kpi-match.mjs`). This is the "typed it into the search bar" case. |
| **Beraten, anderes gekauft** (`influenced`) | Session stamp present, but no purchased line matches the consultation. |

Only **realised money** counts toward revenue (financial status
PAID/PARTIALLY_REFUNDED — same policy as `lib/kpi-revenue-core.mjs`); other
ingested orders are shown as "not yet paid", never silently dropped.

**Attribution window:** an order attributes only within
`MO_ATTRIBUTION_WINDOW_DAYS` (default **30**) of its token's minting —
a months-old consultation must not claim an unrelated purchase. Outside the
window (or for an unknown/purged token) the order is ignored unless a Mo code
independently attributes it.

**Stated residual (also in the UI):** cross-device purchases (consultation on
the phone, purchase on the laptop) stay invisible unless an email/code bridges
them. That is a physical limit, not a measurement bug.

## Line-item → catalog matching

Webhook line items carry no handle. Matching (`matchOrderLineItems`):
1. exact numeric `variant_id` against the catalog's default-variant
   `shopifyVariantId`;
2. else normalised title vs. normalised catalog id — Shopify derives handles
   from titles, and `normalizeHandle` strips exactly what Shopify strips
   (®, casing, separators), so this also covers non-default variants.
Unmatched lines keep `handle: null` (never guessed) and simply can't
contribute to the overlap check.

## GDPR posture

* Both tables are **Cluster A** (pseudonymous, session-keyed, legitimate
  interest — same basis as `kpi_events`). `parseOrderWebhook` never reads
  `email`, `customer`, or any address field; they are discarded unparsed.
* **Data minimisation:** unmarked orders are never stored.
* **No open pixel, nothing covert on the user's device:** the marker rides on
  Shopify's cart (server-side state), set either by a link the user chose to
  click or by the widget stamp.
* **Widget stamp is consent-gated in the widget** (see §Widget): the live-cart
  stamp is analytics-flavoured, so the widget only stamps when the
  storefront's Shopify Customer Privacy state permits analytics. The
  Mo-built-link stamping (summary/marketing/bundle) rides on the respective
  service/consent basis of those emails.
* **Erasure:** the signed-in "delete my data" flow severs `mo_orders`
  (session id + token NULLed — de-identified aggregate order facts remain so
  historic KPI totals stay truthful) and deletes the session's tokens
  (`lib/account-history.eraseSignedInCustomer`).
* **Retention:** `mo_orders` purge on the shared analytics window
  (`KPI_RETENTION_DAYS`); tokens purge after
  `MO_ATTRIBUTION_WINDOW_DAYS + 7` days (inert beyond the window). See
  `docs/DATA_RETENTION.md`.
* ⚠️ **Lawyer check before enabling the widget stamp for real users:** the
  privacy policy should mention the purchase-attribution purpose; the
  webhook's order topics may also need Protected Customer Data approval in
  the Shopify Partner Dashboard (we discard the protected fields, but the
  payload contains them).

## Operator setup

1. Run `npm run db:migrate` (applies `0042_order_attribution.sql`).
2. In the Shopify admin/Partner dashboard, register **two additional webhook
   topics** against the existing endpoint (same URL + signing secret as the
   stock webhook): `orders/create` and `orders/paid` →
   `https://chat.motionsports.de/api/webhooks/shopify`.
3. Optionally set `MO_ATTRIBUTION_WINDOW_DAYS` (default 30).
4. The KPI section shows an explicit empty state until the first webhook
   delivery arrives — ingestion starts at registration, it is **not**
   retroactive.

## Widget (frontend-handoff)

The widget's part (see the frontend repo task):

1. After the storefront consent state allows analytics
   (`window.Shopify.customerPrivacy` — check `analyticsProcessingAllowed`,
   and re-check on the `visitorConsentCollected` event), and once the session
   is "consulted" (first `show_product` card rendered), fetch the session's
   stamp token:
   `POST {apiBase}/api/attribution/token` with the usual chat headers
   (`x-ms-chat-key`, `x-ms-session`, JSON body not required) →
   `{ ok, token, cartAttributes }`.
2. Stamp the live cart, same-origin, fail-silent:
   ```js
   fetch("/cart/update.js", {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ attributes: cartAttributes }),
   });
   ```
3. Re-stamp on later carts (the attribute is cleared when a cart completes):
   re-run the stamp before opening any Mo cart link and after each
   `add_to_cart` click. Stamping is idempotent.
4. Never block the shopping flow on any of this; every step is fire-and-forget.

## Files

| File | Role |
| --- | --- |
| `migrations/0042_order_attribution.sql` | `mo_attribution_tokens` + `mo_orders`. |
| `src/lib/order-attribution.mjs` (+ tests) | Pure: marker URL builder, payload parsing (PII-free), catalog matching, tier classification, window check. |
| `src/lib/mo-orders-store.ts` | I/O: token minting, webhook ingest, KPI aggregation, sweep short-circuit. |
| `src/app/api/webhooks/shopify/route.ts` | Routes `orders/create` + `orders/paid` to the ingest (HMAC-first). |
| `src/app/api/attribution/token/route.ts` | Widget-facing token mint (origin + secret + session guards). |
| `src/lib/summary-email.ts`, `src/lib/marketing-email.ts`, `src/lib/bundle-offers.ts` | Stamp their cart links at build/send time. |
| `src/lib/conversion-sweep.ts` | Uses ingested orders as a Shopify-free short-circuit. |
| `src/app/admin/KpiTab.tsx` | The tiered KPI section. |
