# Catalog sync

The chat backend's product catalog and its embeddings used to be committed
files (`src/data/product-catalog.json`, `src/data/product-embeddings.json`).
That coupled every catalog change to a redeploy.

This document describes the new flow: a scheduled cron pulls the live catalog
from Shopify and writes both files to Vercel Blob, where the runtime picks
them up on the next warm invocation.

## Files in play

| File                                          | Role                                                    |
| --------------------------------------------- | ------------------------------------------------------- |
| `scripts/verify-shopify-auth.mjs`             | Standalone check that the Shopify auth grant works.    |
| `src/lib/shopify.ts`                          | Token cache + GraphQL pagination + targeted by-id fetch.|
| `src/lib/catalog-mapping.ts`                  | Shopify product → `Product` type (mirrors Path A rules).|
| `src/lib/embedding-doc.mjs`                   | The embedded-text builder + `EMBEDDING_DOC_VERSION` (one source of truth). |
| `src/lib/embed-resilience.mjs`                | Resilient embedding orchestrator (chunk → sub-batch → per-item → carry-forward). |
| `src/lib/openai-error.mjs`                    | Classifies OpenAI errors (insufficient_quota / billing surfaced distinctly). |
| `src/lib/catalog-store.ts`                    | Loader: Blob first, bundled JSON fallback. Cached. Atomic-pair writer. |
| `src/lib/catalog-pair.mjs`                    | Keeps the two blobs a consistent pair (drops orphan vectors). |
| `src/lib/catalog-merge.mjs` + `catalog-mutate.ts` | Targeted single-product update for the stock webhook. |
| `src/lib/shopify-webhook.mjs`                 | Shopify webhook HMAC verify + topic routing.            |
| `src/lib/availability.mjs`                    | Recommendation-time availability guard (Part F).        |
| `src/app/api/cron/sync-catalog/route.ts`      | Cron handler. Fetch → filter → map → embed → write Blob.|
| `src/app/api/webhooks/shopify/route.ts`       | Real-time stock webhook (inventory + product changes).  |
| `vercel.json`                                 | `regions: ["fra1"]` + cron schedule (`0 3 * * *`, i.e. 03:00 UTC daily). |

## Shopify auth (Jan-2026 model)

As of January 2026 the Shopify admin no longer issues a static `shpat_…`
Admin API access token. Apps created in the Developer Dashboard get a
**Client ID** and **Client Secret** (`shpss_…`). The backend exchanges these
for a **short-lived Admin API token** at runtime via the OAuth
**client-credentials grant**, then sends the token in
`X-Shopify-Access-Token` on each Admin API call.

- Token endpoint: `POST https://{store}.myshopify.com/admin/oauth/access_token`
- Body (form-urlencoded): `grant_type=client_credentials`, `client_id`, `client_secret`
- Response: `{ access_token, scope, expires_in }`
- TTL: ~24h. `src/lib/shopify.ts` caches the token in process memory and
  refreshes 5 minutes before expiry.

The client-credentials grant only works for apps **owned by your
organization** and installed on **stores in the same organization**.

Reference: shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
(verified working against Admin API `2026-04` on 2026-05-28).

## Required env vars

See `.env.example` for the full list. Catalog sync needs:

```
SHOPIFY_STORE_DOMAIN     # e.g. motion-sports.myshopify.com (NOT motionsports.de)
SHOPIFY_CLIENT_ID
SHOPIFY_CLIENT_SECRET    # shpss_…
SHOPIFY_API_VERSION      # e.g. 2026-04
SHOPIFY_WEBHOOK_SECRET   # signs the real-time stock webhook (see "Real-time stock webhook")
BLOB_READ_WRITE_TOKEN    # @vercel/blob token (also picked up automatically on Vercel)
CRON_SECRET              # protects /api/cron/sync-catalog
OPENAI_API_KEY           # used to regenerate embeddings
```

## Verifying auth works (run this first)

Before relying on the sync, prove the token exchange works:

```bash
npm run verify:shopify
```

The script POSTs to the token endpoint, then makes one minimal
`{ shop { … } }` GraphQL call. It prints either `SUCCESS` with the granted
scope, token TTL and shop fields, or `FAILURE` with the HTTP status, the
raw Shopify error body, and the most likely cause (wrong scope, app not
installed on the store, wrong API version, etc).

Required scope: `read_products` (or `write_products`, which implicitly
covers reads).

## Metafield capture & reference resolution

The products query fetches **all product metafields** via the generic
`metafields(first: 60) { nodes { namespace key value type } }` connection —
not a hardcoded whitelist. Everything the merchant maintains on the product in
the admin flows into the catalog:

- `custom.*` merchant fields: `kurzinfo` (→ `shortDescription`), `kurztext`
  (→ parsed into `specifications` **and** appended to `detailedDescription` as
  "Technische Daten: …"), `hoehe` / `laenge` / `gewicht` (→ dimensions, see
  below), `lieferzeit_min` (→ `deliveryTime`), `serie`, `zertifizierung`,
  `versandtyp` / `sperrgut` / `vorlaufzeit` / `liefereinheit`
  (→ `specifications`), `hide_from_search` (→ `Product.hideFromSearch`;
  retrieval skips these products). Any **other** `custom.*` metafield the
  merchant adds later becomes a `specifications` entry automatically
  (humanized label, values ≤ 300 chars), so new admin fields reach Mo without
  a code change.
- **Kurztext = the PDP details tab.** `custom.kurztext` is the spec sheet the
  storefront renders as "Technische Daten" — dimensions there are in **mm**
  ("Höhe: 2300"). `src/lib/kurztext.mjs` parses it into `Key: Value` spec
  entries (visible to Mo and the embeddings even when the description is long)
  and extracts Breite/Höhe/Tiefe/Länge/Gewicht **normalised to cm/kg** for
  `Product.dimensions`. These kurztext values are authoritative; the legacy
  `custom.hoehe` / `laenge` / `gewicht` metafields (maintained in cm/kg, not
  always in sync with the details tab) are only the fallback. This fixes Mo
  quoting a stale height (e.g. "225 cm" from `custom.hoehe`) while the
  product page's details tab says 2300 (mm). `footprintM2` prefers
  width × depth when the kurztext provides both.
- Standard-taxonomy ("category") metafields (`shopify.*`): every populated one
  becomes a `specifications` entry with its German admin label
  (`color-pattern` → "Farbe", `pull-up-bar` → "Klimmzugstange", …; unknown new
  keys get a humanized fallback label — see `TAXONOMY_SPEC_LABELS` in
  `catalog-mapping.ts`).
- Review app fields: `reviews.rating` / `reviews.rating_count`
  (→ `Product.rating` / `ratingCount`).
- Search & Discovery recommendations:
  `shopify--discovery--product_recommendation.complementary_products`
  (→ `Product.compatibleWith`, the PDP's accessory section) and
  `related_products` (→ `Product.relatedProducts`) — resolved to product
  **handles**, i.e. catalog `Product.id`s.
- File/media references (slide images, Zusatzbilder) are skipped — images come
  from the `images` connection.

The query also fetches `seo { title description }` (SEO description feeds
`shortDescription` when no Kurzinfo exists) and the first variant's `sku` /
`barcode` (→ `Product.sku` / `barcode`).

Deliberately **not** captured: "Cost per item" (internal margin data — must
never reach a customer-facing bot), per-location inventory breakdowns
(`totalInventory` + `availableForSale` are sufficient), HS code / country of
origin, and Google Shopping fields.

### Reference resolution (metaobjects & product references)

For reference-type metafields the Admin API returns a **GID** (or a JSON
array of GIDs for list references) in the metafield's `value` — e.g.
`["gid://shopify/Metaobject/12825260684", …]` — not the human-readable label.
If passed through verbatim, product cards would display the raw GID instead of
"Schwarz".

`src/lib/shopify.ts` resolves these at sync time. After each products page,
all reference GIDs are collected and resolved in **one batched `nodes(ids:)`
query** (chunked at 50) against a per-run cache — taxonomy metaobjects repeat
across products, so most pages resolve entirely from cache:

```graphql
query ResolveReferenceNodes($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Metaobject { id fields { key value } }   # → display label
    ... on Product    { id handle }                  # → catalog product id
  }
}
```

- **Metaobject reference** → display value, list refs joined with `", "`
  (e.g. `"Schwarz, Anthrazit"`). The display value is taken from the
  metaobject's first matching field key in priority order: `label` → `name` →
  `title` → `value` → first non-empty, non-GID text field.
- **Product reference** → the product's **handle** (the catalog `Product.id`).
- **JSON list of plain strings** (`list.single_line_text_field`) → `", "`-joined.
- **Plain text/number** → passed through unchanged.

### Troubleshooting: a field is missing

If a metafield that should have a value is missing from the catalog, the
reference could not be resolved (deleted node, unsupported reference type, or
a metaobject without a usable label field). The sync **drops** such fields
(never emits a raw GID) and logs a warning to the Vercel function logs with
the product id and metafield, e.g.:

```
[shopify] product gid://shopify/Product/123: metafield custom.serie references
did not resolve (gid://shopify/Metaobject/456) — dropped
```

To fix it, the merchant should open the referenced metaobject in the Shopify
admin and ensure it has a populated **`label`** (or `name`/`title`) field.
Once the metaobject has the expected field, re-run the sync (see below) and
the label will flow through. A product with more than 60 metafields logs a
`raise METAFIELDS_PAGE_SIZE` warning instead of silently truncating.

## Stock / availability status

The sync captures each product's stock status from the Shopify Admin API
(`2026-04`) so Mo and the product cards know what's actually available:

| Source field (Admin API)            | Type       | Used for                                   |
| ----------------------------------- | ---------- | ------------------------------------------ |
| `ProductVariant.availableForSale`   | `Boolean!` | Per-variant "can be sold now" — respects the inventory policy (a "continue selling when out of stock" variant stays `true`). |
| `Product.totalInventory`            | `Int`      | Units in stock across variants/locations.  |
| `Product.tracksInventory`           | `Boolean!` | Whether the quantity is meaningful at all. |

`mapShopifyProducts` derives the catalog's stock fields from these:

- **`inStock`** (`boolean`, always present) — the headline flag. `true` when
  **any** variant is `availableForSale`. Falls back through
  `totalInventory > 0` → first-variant `inventoryQuantity > 0` → permissive
  default, so older payloads and the committed fallback bundle (which carry no
  availability data) keep their prior behaviour and never falsely read as
  sold out.
- **`inventoryQuantity`** (`number`, optional) — `Product.totalInventory` when
  present.
- **`anyVariantAvailable`** (`boolean`, optional) — whether any variant is
  `availableForSale`. Omitted when no availability data was present.

These are written to the catalog Blob alongside every other field and surfaced
on `GET /api/products` (`inStock` is what the widget uses for an "Ausverkauft"
badge — see `docs/API_CONTRACT.md`).

> **Freshness — near-real-time, with a daily baseline.** Stock is refreshed two
> ways: the **real-time webhook** (below) flips a single product's availability
> within seconds of a Shopify inventory/product change, and the **daily sync** is
> the baseline reconciliation (and the catch-all for id-only hard-deletes). On top
> of both, recommendation surfaces apply an **availability guard** (Part F) so a
> sold-out item is never recommended even in the gap before a webhook lands.

### Availability guard at recommendation time (Part F)

Regardless of how fresh the sync is, every place that **recommends** a product
filters out currently-unavailable items via `isAvailable` (`availability.mjs`,
the rule: unavailable only when `inStock === false`):

- **Chat product tool / retrieval** (`retrieval.ts`) — sold-out products are
  **hard-filtered** out of the candidate set before ranking (replacing the old
  soft ranking penalty), so Mo never sees them to recommend.
- **Bundle composition** (`bundle-suggestion-core.mjs`, `bundle-offer-core.mjs`)
  — already refuse sold-out components at compose time.
- **Marketing drafts** (`admin/marketing/draft`, `admin/customers/marketing-draft`)
  — the prose only recommends available products; the cart link keeps its own
  send-time `excludeSoldOut` guard.

A restocked item becomes recommendable again automatically the moment its
`inStock` flips back (via the webhook or the next sync).

## Real-time stock webhook (`/api/webhooks/shopify`)

Keeps availability near-real-time between daily syncs. Shopify POSTs an inventory
or product change; the route:

1. **Verifies** the `X-Shopify-Hmac-SHA256` signature over the **raw** body before
   parsing — `base64(HMAC-SHA256(rawBody, SHOPIFY_WEBHOOK_SECRET))`, constant-time
   (same HMAC-first discipline as the Resend/Pingen webhooks). No secret ⇒ **503**
   (fail closed); bad signature ⇒ **401**.
2. **Routes by `X-Shopify-Topic`** to a **targeted single-product update** (never a
   full resync): it re-fetches just that product from Shopify (same fields +
   mapping as the sync, so `inStock` is computed identically), then upserts it into
   the catalog blob — or removes it if it no longer passes the catalog filters.
   `inventory_levels/*` first resolves the inventory item → its product.
3. **Re-embeds only when the embedded text changed** (an inventory-only change
   reuses the stored vector — no OpenAI call), then writes the catalog +
   embeddings as a consistent pair.
4. Is **idempotent** (an unchanged product writes nothing — absorbs Shopify's
   frequent duplicate deliveries) and **burst-guarded** (catalog-blob mutations
   are serialized behind a best-effort Redis lock; it degrades to no-lock when KV
   is absent, with the daily sync as backstop). A real failure returns **500** so
   Shopify retries safely.

### Shopify-side registration (setup step)

Set `SHOPIFY_WEBHOOK_SECRET` (the webhook subscription's signing secret; for
webhooks created via the app config / Admin API this is the app's API secret key),
then register these topics against `https://<deployment>/api/webhooks/shopify`
(Admin API `2026-04`):

- `products/update` — primary signal (fires on stock, price, status, publish
  changes; carries the full product incl. handle).
- `products/create` — new products appear without waiting for the daily sync.
- `products/delete` — best-effort; id-only payloads are reconciled by the daily
  sync.
- `inventory_levels/update` — catches pure quantity changes (resolved item →
  product).
- `orders/create` + `orders/paid` — NOT a catalog concern: the same endpoint
  routes verified order payloads to the order-attribution ingest
  ([`ORDER_ATTRIBUTION.md`](./ORDER_ATTRIBUTION.md)); register them here so
  the Mo-attributed-revenue KPI fills.

Register either via the Shopify Admin (Settings → Notifications → Webhooks) or
the Admin API `webhookSubscriptionCreate` mutation. Verify deliveries are
`2xx`-acked in the Shopify webhook dashboard.

## How the runtime reads the catalog

`src/lib/catalog-store.ts`:

1. If `BLOB_READ_WRITE_TOKEN` is set, list Blob for the stable keys
   `catalog/product-catalog.json` and `catalog/product-embeddings.json`
   and load whichever exist.
2. Otherwise (or if either key is missing), fall back to the JSON committed
   in `src/data/`.
3. Cache the parsed result in module memory. Across a warm Lambda the read
   is amortized to a single fetch.

`src/lib/retrieval.ts` calls `loadProductCatalog()` / `loadEmbeddings()` on
every chat turn, so a fresh deploy + a successful cron run is enough to swap
the catalog without redeploying code. If embeddings are empty (e.g. OpenAI
key was absent at sync time), the existing keyword-search fallback in
`retrieve()` still works.

## Embedding document — what gets embedded (the quality lever)

`src/lib/embedding-doc.mjs` (`buildEmbeddingDoc`) is the **single source of
truth** for the text we embed per product — shared by the cron sync, the runtime
mapper (`catalog-mapping.ts` re-exports it), and `scripts/build-embeddings.mjs`,
so "what we embedded" and "what we'd embed now" can never drift.

The doc is **problem/need-oriented**: it leads with WHAT PROBLEM the product
solves and WHO it's for, in the language a customer uses in chat, so a product's
vector lands in the same need-space as the user's described problem (better
recall). Order:

1. **Identity** — name, category, brand (+ series, price incl. sale).
2. **Wofür / für wen** — derived use-case / benefit phrases from the product's
   signals (category, footprint, noise, rehab flag, target group, tags, specs),
   e.g. *"kniefreundliches, gelenkschonendes Low-Impact-Cardio"*, *"kompaktes,
   platzsparendes Heim-Gym für kleine Wohnungen"*, *"progressiver, verstellbarer
   Widerstand für Kraft- und Cardio-Einsteiger"*. This is the new, highest-leverage
   section. The derivation is deterministic (`deriveUseCases`), so a product
   always yields the same doc.
3. **Beschreibung** — the **full** detailed description, clipped to a sane bound
   (~1200 chars) instead of the old 240-char clip that dropped most of the signal.
4. **Eigenschaften** — *all* meaningful features (no hard 12 cap; up to ~40).
5. **Technische Daten** — specs (Material, Maße, Gewicht, Farbe, Zertifizierung…).
6. **Zielgruppe / Tags** + persona flags (Reha-geeignet, Lautstärke, Stellfläche).

The whole doc is clamped to ~6000 chars (well under the 8192-token per-input cap).

### Re-embed on doc change — `EMBEDDING_DOC_VERSION`

The embeddings blob stores `docVersion` (the `EMBEDDING_DOC_VERSION` the vectors
were built with) and a per-item `docHash` (hash of the embedded text). Because
this doc composition changed, the marker was bumped to **v2** — so on the next
sync **every product is re-embedded** (the carry-forward fallback refuses to
reuse a vector whose `docVersion`/`docHash` no longer matches; see below). Bump
the constant whenever `buildEmbeddingDoc`'s output changes in a way that should
force a full re-embed.

## Reliability — resilient + atomic sync

Two structural fixes (see `docs/CATALOG_SYNC_DIAGNOSIS.md`):

- **Resilient embeddings (`embed-resilience.mjs`).** The old `embedAll` was
  all-or-nothing — one failed chunk threw and 503'd the whole run, writing zero
  embeddings. Now each chunk is wrapped; a failed chunk is retried as smaller
  **sub-batches → per item**, isolating a poison item; an item that *still* fails
  **carries forward its previous vector** (when it still matches the current doc)
  or is **skipped** (keyword-search fallback). The OpenAI call is hardened with an
  explicit `maxRetries` + a small inter-chunk delay (TPM/RPM politeness).
  `insufficient_quota` / billing is detected and logged **distinctly** (and treated
  as fatal so we don't fire ~1000 doomed calls) — it's a **billing fix on the
  OpenAI account, not a code bug**. The route returns **200 on partial success**
  with a `synced / carriedForward / skipped` summary; **5xx only on total failure**
  (no fresh vectors AND nothing carried forward — e.g. a billing outage), in which
  case the last-good blobs are **preserved**, not overwritten with an empty pair.
- **Atomic write (Part B).** Embeddings are generated **in full before either blob
  is written**; then both are written together (`writeCatalogPair`, embeddings
  first, then catalog, orphan vectors reconciled away). A mid-run failure can no
  longer leave a **fresh catalog paired with stale embeddings**. The two blobs are
  always a consistent pair.

## Region — data residency + latency (`fra1`)

`vercel.json` pins `"regions": ["fra1"]` (Frankfurt, EU) for **all** functions
incl. crons. This addresses the EU data-residency flag (esp. the personal-data
crons `refresh-customers` / `retention`, which previously ran in the US default
`iad1`) and cuts the EU↔US latency that inflated this sync's wall-time.

> **NOTE — OpenAI egress.** The embeddings calls still egress to OpenAI in the
> **US** (`api.openai.com`). That is the documented SCC transfer path and is
> **unchanged here** — pinning `fra1` moves *our* compute to the EU but does not
> change where OpenAI processes the request.

## Triggering the cron manually after deploy

```bash
curl -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-deployment>/api/cron/sync-catalog
```

Response is a JSON summary with `mode` (`shopify` or `fallback-bundle`),
`productCount`, `embeddingsCount`, `synced` / `carriedForward` / `skipped`,
`docVersion`, the Blob URLs, and timing. A healthy run returns `ok:true` with a
full fresh catalog + embeddings pair. Check Vercel function logs for the detailed
filter-stats breakdown.

The route accepts `GET` and `POST` — Vercel Cron uses GET by default; the
schedule in `vercel.json` runs daily at 03:00 UTC.

## Rolling back to committed JSON

The bundled `src/data/product-catalog.json` and
`src/data/product-embeddings.json` files are still in the repo and act as
the fallback. To force the runtime to use them:

1. Remove `BLOB_READ_WRITE_TOKEN` from the Vercel project (Settings → Env).
2. Redeploy. The loader will skip the Blob lookup and import the JSON
   directly.

Alternatively, delete the two Blob keys (`catalog/product-catalog.json`,
`catalog/product-embeddings.json`) via the Vercel dashboard. The next warm
invocation will fall through to the bundled JSON.

## Fallback when Shopify auth is broken

If the cron's call to `fetchAllProducts()` throws (e.g. the grant stops
working, scope is revoked, or the Admin API returns an error), the route
catches the error, switches into `mode: "fallback-bundle"`, and uses the
committed JSON as the source of truth — embeddings are still regenerated
from it. This keeps the deployment healthy even when Shopify is degraded.

If the auth flow itself cannot be made to work at all, see
`docs/SHOPIFY_AUTH_BLOCKER.md` (created lazily when first hit).
