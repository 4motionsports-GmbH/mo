# Personalized bundle offers

Per-customer **bundle offers** replace per-customer discount codes: a real
Shopify product, composed of selected catalog products at an admin-set price,
created automatically by the backend, kept **UNLISTED** (purchasable by direct
link, hidden from storefront browsing), linked from a marketing email, and
**deleted from Shopify when it ends** (timer at 0 or removed manually).

Every step below was verified live against the store on 2026-06-13, including
the click-through to checkout (history of the feasibility spike and its probe:
[`archive/BUNDLES_SPIKE.md`](./archive/BUNDLES_SPIKE.md)).

> [!IMPORTANT]
> ## Required Shopify scopes
>
> The bundle path needs the scopes below — the two **publication** scopes on top
> of the product scopes. The authoritative list of every scope the app needs is
> `REQUIRED_SCOPES` in `scripts/register-shopify-webhooks.mjs`; `npm run
> shopify:webhooks` prints which of them the installed app holds.
>
> | Scope                 | Needed for                                              |
> | --------------------- | ------------------------------------------------------- |
> | `read_products`       | reading the catalog / resolving components              |
> | `write_products`      | `productBundleCreate` / `productCreate`, price, `UNLISTED`, `productDelete` |
> | **`read_publications`**  | finding the Online Store publication (`publications`)   |
> | **`write_publications`** | publishing the bundle (`publishablePublish`)            |
>
> `write_products` alone is **not** enough: create + price + `UNLISTED` work
> with it, but **publishing** returns `ACCESS_DENIED: read_publications` until
> both publication scopes are granted. **Both the native and the fallback path**
> publish via the same `publishablePublish`, so **both** need these scopes.
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
| `campaign_contact_id` | campaign-channel recipient → `campaign_contacts(id)` `SET NULL`; **nullable** (migration `0035`, see [`CAMPAIGNS.md`](./CAMPAIGNS.md)) |
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
| `archived_at`         | set when the offer ended (expiry sweep or manual)                      |
| `shopify_deleted_at`  | set when the Shopify product was deleted (migration 0060)              |

Indexes: `(status, expires_at)` (cron sweep), `(customer_id)` (admin listing),
`UNIQUE(redirect_token)`.

---

## The two creation modes + the seam

The "create the Shopify product" step sits behind a **seam** — one entry point
(`createBundleProduct` in `src/lib/shopify-bundles.ts`), two impls selected by
the config flag **`BUNDLE_CREATION_MODE`** (default `native_fixed_bundle`). The
chosen mode is persisted per offer (`creation_mode`). **Everything around the
create step is shared** (price + compare-at, `UNLISTED`, publish, inventory
settle, cart permalink, contents description, delete-on-end), so switching modes is a localized
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

cron every 15 min  /api/cron/expire-bundles  (vercel.json, */15)
                   ├─ active && expires_at < now
                   │    → productDelete                       (gone = success)
                   │    → status = expired, archived_at = now, shopify_deleted_at = now
                   └─ clean-up: ended offers whose product still exists
                        (manual end whose delete failed; sets archived before 0060)
                        → productDelete → shopify_deleted_at = now   (25 per run)

archiveBundleOffer(id)   manual end („Entfernen“, removing a campaign set) — same delete + expired
deleteDraftBundleOffer(id)  deletes a never-published draft (pending / failed) row; anything else → 409
```

**Ended sets are DELETED from Shopify** (maintainer decision 2026-10): an ended set has no further use in the
Shopify admin and would otherwise pile up as archived products. Placed orders
keep their own line-item snapshot (title, price, SKUs); for a native fixed
bundle only the parent product is deleted, the component products are
untouched. The `bundle_offers` row stays (`status = expired`) for the
expired page, audit and KPIs.

**The set ends the moment its timer hits 0**, not only when the sweep runs: the
tracked link (`/api/r/<token>`) and the e-mail renderers
(`shouldRenderBundleBlock`) treat an `active` row past `expires_at` as expired
right away; the sweep then deletes the Shopify product within 15 minutes. The
sweep is **idempotent** — the work list is `status='active'` only,
`markOfferExpired` is guarded (`… WHERE status='active'`), and deleting an
already-deleted product counts as success. A delete failure is **logged
loudly** and the offer stays active+due (or on the clean-up list), so the next
run retries it. On Vercel Hobby (daily crons only) the schedule must go back to
daily; the link still ends on time.

### The link rail + graceful expired page

The email CTA links to **`/api/r/<redirect_token>`** (the existing tracked
redirector), **not** straight to Shopify — so bundle clicks log like discount
links *and* expired offers degrade gracefully. The redirector:

- **active** offer (deadline not passed) → 302 to the materialized `cart_url` (`/cart/<id>:1`);
- **expired / past its deadline / failed** offer → a friendly branded **"Angebot
  abgelaufen"** page (HTTP 410), optionally pointing at a collection via
  `BUNDLE_EXPIRED_REDIRECT_URL`.

Shopify has no native friendly-expired page (a deleted product's URL 404s and
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
- **delete on expiry** kills every old link at once.

This is the same exposure profile as a shared discount-code link, which the
business already runs with.

---

## Service & admin API

- `createBundleOffer(customerId | null, components[], { bundlePriceOverride?, title?, expiryDays?, marketingSendId?, campaignContactId? })`
  — `src/lib/bundle-offers.ts`. `customerId` may be `null` (ad-hoc offer);
  `expiryDays` defaults to `BUNDLE_OFFER_EXPIRY_DAYS` (7). Returns
  `{ ok, offer, redirectUrl }` or a typed refusal (`sold_out` with offenders,
  `unknown_products`, `variant_not_found`, `bad_price`, `create_failed`, …).
- `archiveBundleOffer(id)` — manual end of an **active** offer (deletes the Shopify product, row → `expired`).
- `deleteDraftBundleOffer(id)` — deletes a never-published draft row (`pending` / `failed`; a Shopify product it already minted is deleted first). Any other status → `not_deletable`.
- `expireBundleOffers()` — the cron sweep entry.

Admin endpoints (behind the existing admin auth + CSRF via `guardAdminPost`):

| Endpoint                        | Body                                                            |
| ------------------------------- | -------------------------------------------------------------- |
| `POST /api/admin/bundles/create`  | `{ customerId?, components:[{productId,variantId?,quantity?}], bundlePriceOverride?, title?, expiryDays?, marketingSendId?, campaignContactId? }` → `{ offer, redirectUrl }`; refusals: 409 `sold_out` / `variant_not_found`, 400 `bad_price` / `unknown_products`, 502 `create_failed`, 503 `not_configured` |
| `POST /api/admin/bundles/archive` | `{ id }` → `{ offer }` (active offers)                         |
| `POST /api/admin/bundles/delete`  | `{ id }` → `{ offer }`; only `pending` / `failed` rows, otherwise 409 `not_deletable` |
| `POST /api/admin/bundles/suggest` | `{ customerId }` → `{ title, components, componentsSum }` (AI) |
| `POST /api/admin/catalog/search`  | `{ query }` → `{ products }` (name search for "add product")   |

### Admin workflow (S11) — the Kampagne card and the former Kunden path

Sets are created in two places:

- **Kampagne card** (every campaign, including the 1:1 campaign
  „Einzelansprache“) — the per-recipient set section
  (`src/app/admin/kampagne/sections/BundleSection.tsx`, rendered by
  `ReviewColumn.tsx`, actions in `kampagne/useCampaignActions.ts`) creates a set
  from the card's recommended products (optional price override) with
  `campaignContactId` and no customer id, and removes it via `/bundles/archive`;
  either way the draft text is regenerated. The campaign mail's set block and
  `discount_scope = set` are described in [`CAMPAIGNS.md`](./CAMPAIGNS.md).
- **Kunden → customer detail → „Marketing“ → disclosure „Persönliche E-Mail
  (bisheriger Weg) — offener Entwurf“** — shown only while the person has an
  open draft of the former 1:1 marketing path (`marketing_sends`) and a sendable
  consent. Inside it sits the disclosure „Set-Angebot (Bundle)“
  (`src/app/admin/kunden/BundleComposer.tsx`, rendered by
  `kunden/tabs/MarketingTab.tsx`):

1. **„Set vorschlagen“** (`/bundles/suggest`) — an AI pass over the customer's
   "current understanding" profile, full conversation history and purchase
   history proposes ONE set of **2–5** in-stock, **not-owned** products (sold
   out is never offered — the create step refuses it anyway), each with a
   one-sentence rationale. Structured output (`generateObject`); token usage
   recorded under the `bundle_suggestions` call site.
2. **Editable composition** — remove suggested products / add by name search
   (the shared catalog picker over `/catalog/search`, with a variant chooser;
   sold-out products and variants cannot be added), set the **count** of each
   item (1–10×); the live „Komponentensumme“ (unit price × count) is shown.
3. **„Set-Preis (€)“** (default = component sum; must be valid and `> 0`; a
   price above the sum only **warns** — no "statt" line), **„Titel“** (default
   „Dein persönliches Set“), **„Gültig (Tage)“** (default 7).
4. **„Set erstellen“** (`/bundles/create`) → the service above, with the open
   draft's id (`marketingSendId`); creation errors (sold-out offenders, missing
   publication scope) surface inline.
5. **Email integration** — the draft's personalised email then carries a
   SPECIAL-OFFER block (title, the set's contents as a **bullet list with the
   count of each item** — "2× Kettlebell – 16 kg" — the bundle price and — only
   when `bundle_price < components_sum` — a PAngV "statt €<sum>" line) with a
   "Zum Angebot" CTA on the **tracked** `/api/r/<token>` link. The drafting
   prompt is extended minimally so the prose references the set; the rest of
   the send path (unsubscribe, suppression, confirmed-consent, tracked links,
   discount minting) is **unchanged**.
6. **Coexistence + list** — a send may carry a discount code, a set, both or
   neither. The list „Sets für <e-mail>“ shows each offer's status („Wird
   erstellt…“, „Aktiv“, „Versendet“, „Abgelaufen“, „Fehlgeschlagen“), „Klick
   erfasst“ when the tracked link reported a click, „Angebots-Link“ for an
   active offer, **„Entfernen“** for an active offer (`/bundles/archive`,
   deletes the Shopify product) and **„Löschen“** for a `pending` / `failed`
   draft (`/bundles/delete`). Both ask for confirmation.

---

## How a set is shown to the customer

Everywhere a customer sees a set, its contents are a **bullet list, one line per
item with how many the set contains** ("2× Kettlebell – 16 kg"), built by the
pure `bundleItemList` / `bundleItemLabel` (`bundle-offer-core.mjs`, tested;
items with the same name are merged and their counts added):

- **E-mail** — the special-offer block in every design (classic, studio,
  performance) and its plain-text part (`- 2× …`).
- **Shopify** — the set product's description (`<p>Dieses Set enthält:</p><ul>…</ul>`,
  `bundleDescriptionHtml`), written on both creation paths, so the set's
  product page lists the contents. A generated title carries the count where it
  is above one ("Set: 2× A + B"). Checkout shows Shopify's own line items.
- **Admin** — the Kampagne set row and its tooltip, and the set list of the former Kunden path.

---

## Config (env)

| Var                          | Default               | Purpose                                          |
| ---------------------------- | --------------------- | ------------------------------------------------ |
| `BUNDLE_CREATION_MODE`       | `native_fixed_bundle` | seam selector (`native_fixed_bundle` \| `plain_unlisted_product`) |
| `BUNDLE_OFFER_EXPIRY_DAYS`   | `7`                   | offer lifetime before it ends and its Shopify product is deleted |
| `BUNDLE_EXPIRED_REDIRECT_URL`| storefront root       | "Zum Shop" target on the expired page            |
| `CRON_SECRET`                | —                     | gates `/api/cron/expire-bundles` (Bearer)        |

See [`DATA_RETENTION.md`](./DATA_RETENTION.md) for the `bundle_offers` retention
window.

---

## What to verify manually

The probe confirmed the path end-to-end on 2026-06-13. To re-verify after deploy:

1. **Scopes** — `POST /api/admin/bundles/create` with two in-stock components;
   if it fails with 502 `create_failed` and a message naming
   `read_publications` / `write_publications`, grant both and **reinstall** the
   app (`npm run shopify:webhooks` lists the granted scopes).
2. **Permalink (incognito)** — open the returned `cart_url` (or the
   `redirectUrl` `/api/r/<token>`) in a private window → it adds the bundle and
   reaches Shopify checkout.
3. **Buy-test** — complete a test checkout; confirm the **component SKUs**
   decrement (native linkage) and the order references the bundle.
4. **Force expiry** — set the offer's `expires_at` to the past (or wait) and run
   `curl -H "Authorization: Bearer $CRON_SECRET" $URL/api/cron/expire-bundles`.
5. **Deleted + friendly page** — confirm the Shopify product is **gone** from
   the Shopify admin and the offer is `expired` with `shopify_deleted_at` set;
   re-open `/api/r/<token>` → the
   branded **"Angebot abgelaufen"** page (not a Shopify 404 / empty cart).

## Product variants

Bundle components can pin a specific variant: `POST /api/admin/bundles/create`
accepts `components: [{ productId, variantId?, quantity? }]` (numeric Shopify
variant id from the shared picker's variant chooser). Validation
(`validateAndSnapshotComponents`) resolves price/availability PER CHOSEN
variant; a pinned variant that vanished from the catalog is refused with
`variant_not_found` (HTTP 409) — never silently replaced by the default
variant. The snapshot's `variantId`/`numericVariantId` carry the chosen
variant, `title` becomes "Produktname – Variantentitel" (plus a separate
`variantTitle`), and the native `productBundleCreate` path pins the option
selections from `numericVariantId` as before.
