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
   **never stored in `mo_orders`** (data minimisation). Separately, the order
   ledger (`customer_orders`, `docs/CUSTOMER_PLATFORM_PLAN.md`) stores every
   order while `SHOPIFY_CUSTOMER_SYNC_ENABLED` is on (ANWALTSDOSSIER §13.1
   item 1).

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
`MO_ATTRIBUTION_WINDOW_DAYS` (default **30**) of its token's **anchor** —
a months-old consultation must not claim an unrelated purchase. Outside the
window (or for an unknown/purged token) the order is ignored unless a Mo code
independently attributes it. The anchor depends on the switch
`MO_ATTRIBUTION_SESSION_ANCHOR` (ATTR-TOKEN-LIFETIME, default off; owner
decision 2026-10-05, ANWALTSDOSSIER §20; turn on only **after** migration
`0076` ran):

* **Switch off:** the token's minting, for every source.
* **Switch on, session source `widget`:** the later of the minting and the
  latest **product consultation written by the token's own session** at or
  before the order (`attributionAnchor`, `lastConsultationAt`). Consultation =
  a tool marker row with `show_product`, `compare_products`, `add_to_cart` or
  `suggest_showroom` (`CONSULTATION_ANCHOR_TOOLS`); a pure shipping/support
  chat does not count. "Own session" = `messages.session_id` (migration
  `0076`), so another device's turns in a resumed thread never extend the
  window. Rows written before `0076` (`session_id` NULL) fall back to the
  thread's session (`conversations.session_id`) until they leave the 37-day
  horizon; that fallback is then removed.
* **The anchor never moves past the order:** only rows with
  `created_at <= processed_at` count (no skew — chat rows are stamped by our
  own DB), so a chat after the purchase cannot pull an order into the window,
  and `orders/create` and `orders/paid` see the same rows.
* **Link sources** (`summary_email`, `marketing_email`, `bundle`) and unknown
  sources: always the minting.
* A failed anchor query is a `db-error` (500, Shopify retries the idempotent
  delivery); an invalid timestamp falls back to the minting.

The switch moves the token cliff, it does not remove it: with it on, a
token is still purged 37 days after the device's last product consultation
(at most `KPI_RETENTION_DAYS` after minting); with it off, 37 days after
minting. A device that keeps its session id
stamps the purged token until the widget renews it (frontend task
`docs/frontend-handoff/tasks-2026-10-04/3-attribution-token-renewal.md`);
tokens purged before 2026-10-05 are not recoverable by the backend.

**Unattributed marked orders.** A marked order whose token is unknown
(purged, erased, forged) or outside the window — and that carries no Mo
code — is **not linked to a session and not written to `mo_orders`**. It is
only counted, as the server-only event `mo_order_marker_unresolved`
(`{reason: 'unknown_token' | 'outside_window', source?}`; `source` only for
`outside_window`, from the known enum; session `NULL`; never an order id,
token or amount). It fires on `orders/create` only, after the delivery was
recorded (`noteUnresolvedMarker`), so a Shopify retry or the `orders/paid`
delivery does not count it again; a duplicate `orders/create` subscription
would count it twice. The KPI tab shows it as „ohne Zuordnung“
(ADMIN_DASHBOARD §5.16). The counter works with the switch on or off.

**Stated residual (also in the UI):** cross-device purchases (consultation on
the phone, purchase on the laptop) stay invisible unless an email/code bridges
them. That is a physical limit, not a measurement bug.

## Line-item → catalog matching

Webhook line items carry no handle. Matching (`matchOrderLineItems`):
1. exact numeric `variant_id` against **every** catalog variant id (the
   catalog's `variants[]`, plus the flat default `shopifyVariantId` as a
   pre-variant safety net) — a purchase of the 16 kg kettlebell matches by
   its own variant id, not only the default's;
2. else normalised title vs. normalised catalog id — Shopify derives handles
   from titles, and `normalizeHandle` strips exactly what Shopify strips
   (®, casing, separators).
A variant-id match on a NON-default variant of a multi-variant product
additionally stamps `ref` (`handle~variantId`,
`docs/archive/PRODUCT_VARIANTS_PLAN.md`) on the matched item, so KPIs can tell which
strength/weight/colour was bought; `handle` stays the product-level grouping
key everywhere. Unmatched lines keep `handle: null` (never guessed) and
simply can't contribute to the overlap check.

## GDPR posture

* Both tables are **Cluster A** (pseudonymous, session-keyed, legitimate
  interest — same basis as `kpi_events`). `parseOrderWebhook` never reads
  `email`, `customer`, or any address field; they are discarded unparsed.
* **Data minimisation:** unmarked orders are never stored in `mo_orders`;
  unattributable marked orders are only counted (session-less event, see
  above). The order ledger (`customer_orders`) is a separate purpose and
  stores every order while `SHOPIFY_CUSTOMER_SYNC_ENABLED` is on.
* **Writer session on product-tool rows (`0076`):** `messages.session_id` is
  written only on tool marker rows — the same pseudonymous session id that is
  already on the conversation. It follows the conversation (`RETENTION_DAYS`,
  cascade on erasure).
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
  (`KPI_RETENTION_DAYS`). Tokens: switch off, `MO_ATTRIBUTION_WINDOW_DAYS + 7`
  days after minting (inert beyond the window); switch on, a `widget` token
  lives **at most 37 days after its own session's last product consultation
  and never more than `KPI_RETENTION_DAYS` (default 180; 180 when that window
  is 0) after minting**; link-source tokens by minting. Deleted on erasure.
  See `docs/DATA_RETENTION.md` (step 5i).
* **Consent-independent extension (switch on).** The backend cannot see
  analytics consent at chat time: a product chat on the same device after
  analytics consent was withdrawn still extends the window of the token minted
  under consent.
* **Cart attribute left on a shared browser.** The `_mo` already on the
  Shopify cart is not removed on sign-out, session rotation or consent
  withdrawal (`docs/frontend/06-commerce-and-storefront-integration.md` §8.5).
  On a shared browser a later order can therefore be tied to that session —
  and through its conversations to a signed-in customer — with the switch on
  for longer than the 30 days from minting. Mitigations: switch off by
  default; task 2 of the widget renewal task (above) blanks the marker on
  sign-out, erase and withdrawal (not live yet); open question F-37 (b) in the
  dossier.
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
   `https://mo.motionsports.de/api/webhooks/shopify`.
3. Optionally set `MO_ATTRIBUTION_WINDOW_DAYS` (default 30).
   For the session anchor: run migration `0076` (safe right after the merge —
   until it ran, `persistTurn` writes tool rows without the column), **then**
   set `MO_ATTRIBUTION_SESSION_ANCHOR=true` (the anchor and keep-rule queries
   need the column).
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
| `migrations/0076_message_session_id.sql` | `messages.session_id` (writer of tool marker rows) + partial index `messages_session_marker_idx`. Additive; safe to run right after the merge. |
| `src/lib/order-attribution.mjs` (+ tests) | Pure: marker URL builder, payload parsing (PII-free), catalog matching, tier classification, window check, window anchor (`attributionAnchor`), unresolved-marker event and tally. |
| `src/lib/mo-orders-store.ts` | I/O: token minting, webhook ingest (anchor query, `unknown_token` / `outside_window`), `noteUnresolvedMarker`, KPI aggregation, sweep short-circuit. |
| `src/lib/platform-flags.mjs`, `src/lib/retention-options.mjs` (+ tests) | `MO_ATTRIBUTION_SESSION_ANCHOR`; `attributionSessionAnchor` + `attributionTokenMaxDays` (the cap). |
| `src/lib/retention.ts` | Step 5i: token purge (switch off) or keep rule with cap (switch on), `keptActiveAttributionTokens`. |
| `src/lib/conversation-store.ts` | `persistTurn` writes `messages.session_id` on tool marker rows; retries without the column until `0076` ran. |
| `src/lib/db-errors.mjs` (+ tests) | `isUndefinedColumnError` (SQLSTATE 42703) for that retry. |
| `src/app/api/webhooks/shopify/route.ts` | Routes `orders/create` + `orders/paid` to the ingest (HMAC-first); emits `mo_order_marker_unresolved` after the delivery is recorded. |
| `src/app/api/attribution/token/route.ts` | Widget-facing token mint (origin + secret + session guards). |
| `src/lib/summary-email.ts`, `src/lib/marketing-email.ts`, `src/lib/bundle-offers.ts` | Stamp their cart links at build/send time. |
| `src/lib/conversion-sweep.ts` | Uses ingested orders as a Shopify-free short-circuit. |
| `src/app/admin/KpiTab.tsx`, `src/app/admin/kpi/sections/AttributionSection.tsx` | The tiered KPI section, the „ohne Zuordnung“ note and the release notes. |
| `src/lib/kpi-releases.mjs` | Release entries `attribution-unresolved` + `attribution-window` (2026-10-05) and `MEANINGFUL_FROM.attribution`. |
| `scripts/verify-live-kpis.mjs` | Section 7 (pre-checks P1–P6) and 7b (live checks V0, V3, V4, tokens older than 37 days). |
