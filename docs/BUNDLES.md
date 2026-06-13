# Personalized bundle offers

Per-customer **bundle offers** replace per-customer discount codes: a real
Shopify product, composed of selected catalog products at an admin-set price,
created automatically by the backend, kept **UNLISTED** (purchasable by direct
link, hidden from storefront browsing), linked from a marketing email, and
**archived on expiry**.

This is the S10 build of the feasibility spike in
[`BUNDLES_SPIKE.md`](./BUNDLES_SPIKE.md). The spike's **"Probe results (S9b,
2026-06-13)"** section is the source of truth — every step below was verified
live against the store, including the click-through-to-checkout.

> [!IMPORTANT]
> ## Required Shopify scopes
>
> The bundle path needs **17** scopes — the **2** publication scopes below in
> **addition** to the 15 the rest of the backend already holds:
>
> | Scope                 | Needed for                                              |
> | --------------------- | ------------------------------------------------------- |
> | `read_products`       | reading the catalog / resolving components              |
> | `write_products`      | `productBundleCreate` / `productCreate`, price, `UNLISTED`, `ARCHIVED` |
> | **`read_publications`**  | finding the Online Store publication (`publications`)   |
> | **`write_publications`** | publishing the bundle (`publishablePublish`)            |
>
> The spike body (§1, §6, follow-up #3) claimed `write_products` alone was
> enough. The **probe disproved that**: create + price + `UNLISTED` work with
> `write_products`, but **publishing** returned `ACCESS_DENIED: read_publications`
> until both publication scopes were granted. **Both the native and the fallback
> path** publish via the same `publishablePublish`, so **both** need these scopes.
>
> Client-credentials tokens only carry the scopes granted **at install**, so the
> app must be **(re)installed on the store after any scope change**. At runtime
> `assertPublicationScopes()` (in `src/lib/shopify-bundles.ts`) checks
> `currentAppInstallation.accessScopes` before any create and **fails loud** if
> either scope is missing — it does not try to work around it.

---

## Data model

One row per offer in **`bundle_offers`** (migration `0013_bundle_offers.sql`).
Component prices are **snapshotted** at creation so the displayed "statt €X"
stays auditable after catalog prices drift — a fixed bundle's price never
auto-recomputes (spike §2).

| Column                | Purpose                                                                 |
| --------------------- | ----------------------------------------------------------------------- |
| `id`                  | offer id (BIGINT identity)                                              |
| `customer_id`         | recipient → `customers(id)` `ON DELETE SET NULL`; **nullable** (ad-hoc) |
| `marketing_send_id`   | the email send this rode out with → `marketing_sends(id)` `SET NULL`    |
| `components`          | JSONB array; each entry pins productId + variant + **unitPrice snapshot** + qty |
| `components_sum`      | TRUE sum of component prices ⇒ `compareAtPrice` / "statt"               |
| `bundle_price`        | admin-set selling price (defaults to `components_sum`)                  |
| `currency`            | `EUR`                                                                   |
| `title`               | bundle product title                                                   |
| `shopify_product_id`  | `gid://shopify/Product/…` (null until created)                         |
| `shopify_variant_id`  | parent variant gid (cart permalink source)                             |
| `numeric_variant_id`  | digits only, ready for `/cart/<id>:1`                                   |
| `shopify_handle`      | product handle                                                         |
| `bundle_operation_id` | `ProductBundleOperation` gid (native path; poll/audit)                 |
| `creation_mode`       | which seam produced it (`native_fixed_bundle` \| `plain_unlisted_product`) |
| `status`              | `pending` → `active` → `expired` \| `failed`                            |
| `error`               | recorded failure reason when `failed`                                  |
| `cart_url`            | materialized real `/cart/<id>:1` permalink (the redirect target)       |
| `redirect_token`      | token for the tracked link `/api/r/<token>`                            |
| `expires_at`          | offer deadline (created + `BUNDLE_OFFER_EXPIRY_DAYS`, default 7)        |
| `archived_at`         | set when the offer was archived (expiry cron or manual)                |

Indexes: `(status, expires_at)` (cron sweep), `(customer_id)` (admin listing),
`UNIQUE(redirect_token)`.

---

## The two creation modes + the seam

The "create the Shopify product" step sits behind a **seam** — one entry point
(`createBundleProduct` in `src/lib/shopify-bundles.ts`), two impls selected by
the config flag **`BUNDLE_CREATION_MODE`** (default `native_fixed_bundle`). The
chosen mode is persisted per offer (`creation_mode`). **Everything around the
create step is shared** (price + compare-at, `UNLISTED`, publish, inventory
settle, cart permalink, archive-on-expiry), so switching modes is a localized
swap — exactly as the spike de-risks it.

### PRIMARY — `native_fixed_bundle` (verified GO)

1. `productBundleCreate(components)` → a `ProductBundleOperation` (async).
2. **Poll** via the generic `node(id:)` interface (there is **no** top-level
   `productBundleOperation(id:)` field) until the product populates at lifecycle
   `COMPLETE` (~2 polls / ~2s); read the **parent variant gid**.
3. `productVariantsBulkUpdate` → `price` = admin bundle price; `compareAtPrice`
   = the **true component sum**, **only if** `price < sum` (PAngV — never invent
   a strike price; if `price >= sum`, set **no** compareAt).
4. `productUpdate` → `status: UNLISTED`.
5. `publishablePublish` → the **Online Store** publication.
6. Re-poll the parent variant inventory until `availableForSale` settles
   (bundle qty = **min(component stock)**, native linkage).

**Why native is primary:** Shopify decrements the component SKUs natively, so a
bundle is automatically unavailable the moment any tracked component hits 0 — no
overselling. The cost is that a sold-out component silently kills the offer,
which is why `createBundleOffer` **refuses sold-out components at compose time**.

### FALLBACK — `plain_unlisted_product` (spike §6a)

A single `productCreate` (UNLISTED) priced at the bundle total, components
listed in the product description. Steps 3–6 are **identical** (and it needs the
**same** publication scopes — same `publishablePublish`).

**Accepted trade-off:** **no native component-inventory linkage** — the hidden
product has its own stock, so it can stay buyable even when a real component is
out of stock (overselling risk). Mitigated by the compose-time sold-out check
(sync-fresh stock) and short expiry, but not closed the way native decrement is.
The fulfilment team must read the description to know which SKUs to pick. Use
this only if the native capability ever regresses.

> `userErrors` shapes differ per mutation and are selected per the real type:
> `productBundleCreate` → plain `UserError` (`field`, `message`, **no** `code`);
> `productVariantsBulkUpdate` → `ProductVariantsBulkUpdateUserError` (has
> `code`). Do not assume a shared shape.

---

## Lifecycle

```
createBundleOffer ─┬─ validate components in-stock (REJECT sold-out offenders)
                   ├─ snapshot unit prices → components_sum
                   ├─ insert row  status = pending  (mints redirect_token)
                   ├─ run the seam (create → finalize → inventory settle)
                   └─ success → status = active  (+ Shopify ids, cart_url)
                      failure → status = failed  (+ recorded error)

daily cron  /api/cron/expire-bundles  (vercel.json, 03:45)
                   └─ active && expires_at < now
                        → productUpdate status = ARCHIVED   (never DELETE)
                        → status = expired, archived_at = now   (idempotent)

archiveBundleOffer(id)   manual archive (S11 UI) — same Shopify ARCHIVE + expired
```

**ARCHIVE, never DELETE** (spike §5): archiving removes the product from all
storefronts but **preserves order history**, is reversible, and keeps the record
for audit/KPIs. The sweep is **idempotent** — the work list is `status='active'`
only and `markOfferExpired` is guarded (`… WHERE status='active'`), so a repeat
or concurrent run is a no-op. An archive failure is **logged loudly** and the
offer stays active+due, so the next run retries it.

### The link rail + graceful expired page

The email CTA links to **`/api/r/<redirect_token>`** (the existing tracked
redirector), **not** straight to Shopify — so bundle clicks log like discount
links *and* expired offers degrade gracefully. The redirector:

- **active** offer → 302 to the materialized `cart_url` (`/cart/<id>:1`);
- **expired / archived / failed** offer → a friendly branded **"Angebot
  abgelaufen"** page (HTTP 410), optionally pointing at a collection via
  `BUNDLE_EXPIRED_REDIRECT_URL`.

Shopify has no native friendly-expired page (an archived product's URL 404s and
a stale cart permalink drops the line), so the redirector wrapper supplies it
(spike §5).

---

## The link-leakage trade-off (ACCEPTED)

An UNLISTED product is purchasable by **anyone** who has the direct link — the
"personalized" price is not access-controlled, so a forwarded link works for a
stranger until the offer expires. **Lucas ACCEPTED this trade-off.** Mitigations
in place:

- the product is **UNLISTED** — hidden from search, collections, recommendations,
  the sitemap and `Shopify Catalog`, and carries `noindex/nofollow`, so it is not
  *discoverable*, only *shareable*;
- **short expiry** (default 7 days) bounds the window;
- **archive on expiry** kills every old link at once.

This is the same exposure profile as a shared discount-code link, which the
business already runs with.

---

## Service & admin API

- `createBundleOffer(customerId, components[], { bundlePriceOverride?, title?, expiryDays = 7, marketingSendId? })`
  — `src/lib/bundle-offers.ts`. Returns `{ ok, offer, redirectUrl }` or a typed
  refusal (`sold_out` with offenders, `unknown_products`, `bad_price`, …).
- `archiveBundleOffer(id)` — manual archive for the S11 UI.
- `expireBundleOffers()` — the cron sweep entry.

Admin endpoints (behind the existing admin auth + CSRF via `guardAdminPost`;
UI lands in S11):

| Endpoint                        | Body                                                            |
| ------------------------------- | -------------------------------------------------------------- |
| `POST /api/admin/bundles/list`    | `{ customerId }` → `{ offers }`                                |
| `POST /api/admin/bundles/create`  | `{ customerId?, components:[{productId,quantity?}], bundlePriceOverride?, title?, expiryDays?, marketingSendId? }` |
| `POST /api/admin/bundles/archive` | `{ id }` → `{ offer }`                                         |

---

## Config (env)

| Var                          | Default               | Purpose                                          |
| ---------------------------- | --------------------- | ------------------------------------------------ |
| `BUNDLE_CREATION_MODE`       | `native_fixed_bundle` | seam selector (`native_fixed_bundle` \| `plain_unlisted_product`) |
| `BUNDLE_OFFER_EXPIRY_DAYS`   | `7`                   | offer lifetime before the cron archives it       |
| `BUNDLE_EXPIRED_REDIRECT_URL`| storefront root       | "Zum Shop" target on the expired page            |
| `CRON_SECRET`                | —                     | gates `/api/cron/expire-bundles` (Bearer)        |

See [`DATA_RETENTION.md`](./DATA_RETENTION.md) for the `bundle_offers` retention
window.

---

## What to verify manually

The probe confirmed the path end-to-end on 2026-06-13. To re-verify after deploy:

1. **Scopes** — `POST /api/admin/bundles/create` with two in-stock components;
   if it 503s with a scope message, grant `read_publications` +
   `write_publications` and **reinstall** the app.
2. **Permalink (incognito)** — open the returned `cart_url` (or the
   `redirectUrl` `/api/r/<token>`) in a private window → it adds the bundle and
   reaches Shopify checkout.
3. **Buy-test** — complete a test checkout; confirm the **component SKUs**
   decrement (native linkage) and the order references the bundle.
4. **Force expiry** — set the offer's `expires_at` to the past (or wait) and run
   `curl -H "Authorization: Bearer $CRON_SECRET" $URL/api/cron/expire-bundles`.
5. **Archived + friendly page** — confirm the Shopify product is **ARCHIVED**
   (not deleted) and the offer is `expired`; re-open `/api/r/<token>` → the
   branded **"Angebot abgelaufen"** page (not a Shopify 404 / empty cart).
