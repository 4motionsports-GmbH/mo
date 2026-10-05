# Order attribution — history notes

Archived 2026-10-05 from docs/ORDER_ATTRIBUTION.md — historical, not maintained.

Current state: [`docs/ORDER_ATTRIBUTION.md`](../ORDER_ATTRIBUTION.md) (backend design),
[`docs/frontend/API_CONTRACT.md`](../frontend/API_CONTRACT.md) §10 (widget contract),
[`docs/frontend/06-commerce-and-storefront-integration.md`](../frontend/06-commerce-and-storefront-integration.md)
§8 (as-built widget). The passages below are kept as they stood before the 2026-10-05 docs
restructure; several were already stale then (marked „superseded“).

## „The gap it closes“ — the state before migration 0042

Before this round, an order was attributable to Mo in exactly two narrow
cases: it redeemed a unique `MS5-`/`MK-` discount code, or the buyer was a
DOI-confirmed email contact matched in the recommendation→purchase loop.
Everything else — purchases through Mo's own cart buttons, and especially
"Mo recommended it, the user typed it into the search bar and bought it" —
was invisible (the old honesty note in `lib/kpi-revenue-store`).

## GDPR posture — superseded passages

- **Erasure** (superseded: every erasure path runs `erasePerson` in
  `src/lib/customer-erasure.ts`): „the signed-in "delete my data" flow severs `mo_orders`
  (session id + token NULLed — de-identified aggregate order facts remain so historic KPI totals
  stay truthful) and deletes the session's tokens (`lib/account-history.eraseSignedInCustomer`).“
- **Lawyer check** (superseded: the widget stamp has run for real users since August 2026; the
  check is open as F-37 (d) in `docs/ANWALTSDOSSIER.md` §20): „⚠️ **Lawyer check before enabling
  the widget stamp for real users:** the privacy policy should mention the purchase-attribution
  purpose; the webhook's order topics may also need Protected Customer Data approval in the
  Shopify Partner Dashboard (we discard the protected fields, but the payload contains them).“
- **Shared-browser mitigation** as worded on 2026-10-05: „task 2 of the widget renewal task
  (above) blanks the marker on sign-out, erase and withdrawal (not live yet)“ — live status now
  lives only in `docs/ROLLOUT_TODO.md`.

## Operator setup — superseded steps

2. (superseded: the app registers its webhooks with `npm run shopify:webhooks -- --apply`, signed
   with the app's client secret; the hand-made admin webhooks were deleted) „In the Shopify
   admin/Partner dashboard, register **two additional webhook topics** against the existing
   endpoint (same URL + signing secret as the stock webhook): `orders/create` and `orders/paid` →
   `https://mo.motionsports.de/api/webhooks/shopify`.“
4. (superseded: the empty state lasts until the first **marked** order is seen, stored or
   counted as unresolved) „The KPI section shows an explicit empty state until the first webhook
   delivery arrives — ingestion starts at registration, it is **not** retroactive.“

## „Widget (frontend-handoff)“ — the original hand-off steps

Superseded by `docs/frontend/API_CONTRACT.md` §10 (contract, incl. renewal and blanking) and
`docs/frontend/06-commerce-and-storefront-integration.md` §8 (as built).

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
