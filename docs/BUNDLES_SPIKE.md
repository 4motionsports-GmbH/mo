# Personalized Bundle Offers — feasibility spike

**Status:** READ-ONLY SPIKE — no application code changed. Decision-ready report.
**Author context:** motionsports chat backend.
**Date:** 2026-06-13.
**Pinned API version:** `2026-04` (the value of `SHOPIFY_API_VERSION`; see
`src/lib/shopify.ts:33` `apiVersion()` and the GraphQL endpoint built at
`src/lib/shopify.ts:125`). All API claims below are pinned to `2026-04` unless a
feature's availability window is explicitly called out.

## Goal recap

Replace per-customer **discount codes** with per-customer **bundle offers**: a
real Shopify product, composed of selected catalog products at an admin-set
price, created automatically by our backend, linked from a marketing email as a
special offer, and cleaned up after expiry.

## Our authorization surface (what the spike must fit inside)

- **Auth:** OAuth client-credentials grant, short-lived Admin API token, org-owned
  app on a same-org store (see `docs/CATALOG_SYNC.md`, `src/lib/shopify.ts`).
- **Scopes we hold:** `read_products`, `write_products`, `read_orders`,
  `write_orders`, `read_all_orders`, `read_discounts`, `write_discounts`,
  `read/write discounts_allocator_functions`, `read/write_price_rules`,
  `read/write product_feeds`, `read/write product_listings`.
- **Scopes we do NOT hold (relevant below):** `write_draft_orders` /
  `read_draft_orders`, `write_quick_sale`.
- **Plan:** standard Shopify plan, Essence theme.
- **Existing checkout mechanism:** prefilled **cart permalinks** of the form
  `https://motionsports.de/cart/<numericVariantId>:<qty>[,<id>:<qty>…][?discount=CODE]`
  built in `src/lib/shopify-cart-url.mjs` / `src/lib/cart.ts`. This is the rail a
  bundle offer would ride to checkout.

> **Doc-sourcing note (important for verification).** `shopify.dev` and
> `help.shopify.com` return **HTTP 403 to automated fetches** (the same block the
> existing code documents — see `src/lib/shopify-discounts.ts:14-18`). The
> findings below were gathered on 2026-06-13 from Shopify's **live published**
> developer docs, changelog, and Help Center via web search rather than direct
> page fetch. Each claim carries its canonical URL so a human can confirm in a
> browser. Where a fact could not be re-confirmed against the rendered schema, it
> is flagged **[VERIFY]** with a concrete check.

---

## 1. Fixed bundles: availability, scopes, limits

**`productBundleCreate` (+ `productBundleUpdate`) — available to us?** Yes, with
one capability caveat.

- **Scope:** requires **`write_products`** — which we hold. No discount, price-rule,
  or function scope is required for the *fixed* bundle path.
  - `productBundleCreate` — https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/productBundleCreate
- **Async operation:** the mutation does **not** return the product synchronously.
  It returns a **`ProductBundleOperation`** which you must **poll** until the
  bundle product is created.
  - `ProductBundleOperation` — https://shopify.dev/docs/api/admin-graphql/2026-04/objects/ProductBundleOperation
  - "Add a product fixed bundle" walkthrough (create → poll → publish) —
    https://shopify.dev/docs/apps/build/product-merchandising/bundles/add-product-fixed-bundle
- **Plan:** fixed bundles are available on **all Shopify plans**, including our
  standard plan. The first-party **"Shopify Bundles"** app (free) is the official
  way a store gains the bundles capability, and is available on all plans.
  - About product bundles — https://shopify.dev/docs/apps/build/product-merchandising/bundles
  - Shopify Bundles (Help Center) — https://help.shopify.com/en/manual/products/bundles/shopify-bundles
- **Component limits:** a bundle may have **up to 150 components** and **up to 3
  options**. A product can't be both a component and itself contain components
  (no bundles-of-bundles).
  - Start building bundles — https://shopify.dev/docs/apps/build/product-merchandising/bundles/start-building
- **`productBundleUpdate`:** exists for editing components/options of a bundle our
  app owns.
  - https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/productBundleUpdate

**The capability caveat (the one thing to verify before committing).** The docs
state the **shop "must have access to bundles" to use this mutation**, and that
**"after an app has assigned components to a bundle, only that app can manage the
components of that bundle."** Fixed bundles are implemented on top of a
Shopify-managed **cart-transform**; the bundles capability/cart-transform owner on
a store is normally established by installing the free **Shopify Bundles** app (or
by an app registering its own cart-transform function — which would require the
function-related scopes and a deployed Function).

- Create a bundle app — https://shopify.dev/docs/apps/build/product-merchandising/bundles/create-bundle-app
- Cart Transform Function API — https://shopify.dev/docs/api/functions/latest/cart-transform

**[VERIFY] before build:** confirm our org app can successfully call
`productBundleCreate` on the live store. Two outcomes:
1. **It works** (the store already has bundles capability, e.g. the free Shopify
   Bundles app is installed and the platform-owned transform serves all apps) →
   green light, no extra scope.
2. **It errors** with an access/ownership error → the merchant must install the
   free **Shopify Bundles** app in admin to unlock the capability, OR we fall back
   (section 6). We do **not** want to own/deploy a custom cart-transform Function
   for this — that's a much larger build and competes for the single per-app
   transform slot.

**`cartTransform` ownership is NOT required from us for the fixed path** — that
requirement applies to *customized* (mix-and-match) bundles, which we do not need.
- Customized bundle function — https://shopify.dev/docs/apps/build/product-merchandising/bundles/add-customized-bundle-function

---

## 2. Pricing: arbitrary price + PAngV-safe compare-at

**How a fixed bundle's price is controlled.** The bundle is a real product with a
**parent variant**; the **parent variant's `price` is the bundle price**. It is
**NOT** auto-summed from components and does **not** auto-update when a component's
price changes — you set it explicitly and own it thereafter.

- "the bundle parent variant's price determines the price, while the inventory of
  each component's variants determines the bundle inventory" — Add a product fixed
  bundle / Add a variant fixed bundle —
  https://shopify.dev/docs/apps/build/product-merchandising/bundles/add-product-fixed-bundle
  , https://shopify.dev/docs/apps/build/product-merchandising/bundles/add-variant-fixed-bundle

**Can the admin set an arbitrary total independent of the component sum?** **Yes.**
`productBundleCreate`'s input carries `title`, `components`, and option mapping —
**no price field** — so the create call establishes the product; the **price is
then set on the parent variant** with `productVariantsBulkUpdate` (or `productSet`).
The admin-chosen total is whatever we write there.
- `productVariantsBulkUpdate` — https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/productVariantsBulkUpdate
- `ProductVariant.price` — https://shopify.dev/docs/api/admin-graphql/2026-04/objects/ProductVariant

**Default = sum of components:** Shopify's *admin UI* pre-fills the sum as a
convenience, but via API there is no implicit default — we compute the true
component sum ourselves and write it as the price unless the admin overrode it.

**Compare-at semantics for a "statt €X" display (Preisangabenverordnung).**
Compare-at lives on the **same parent variant** as `compareAtPrice` — an ordinary
`Money` field, not bundle-specific. To stay PAngV-compliant ("statt €X" must be a
**true** prior/reference price, never an invented strike-price):

- Set **`price` = admin's bundle price** (the actual selling price).
- Set **`compareAtPrice` = the TRUE sum of the components' current prices** (read
  from our synced catalog — `Product.variants[].price`, already in hand via
  `src/lib/shopify.ts`/`catalog-store`). This is a real, defensible reference: "the
  individual items together cost €X; as a bundle €Y."
- Because the bundle price never auto-recomputes, **snapshot the component prices
  and the computed sum at creation time** and persist them (see the S10 data model)
  so the displayed "statt" figure is auditable and reproducible.

- `ProductVariant.compareAtPrice` — https://shopify.dev/docs/api/admin-graphql/2026-04/objects/ProductVariant

---

## 3. Purchasability vs visibility — minimum publication state

**The clean answer: `UNLISTED` product status** (introduced 2025-10; present in our
`2026-04`). It is purpose-built for exactly this "link-only, purchasable, hidden"
need.

- New: Unlisted Product Status (changelog) — https://shopify.dev/changelog/new-unlisted-product-status
- Unlisted product status (dev docs) — https://shopify.dev/docs/apps/build/product-merchandising/unlisted-products
- `ProductStatus` enum — https://shopify.dev/docs/api/admin-graphql/2026-04/enums/ProductStatus

What `UNLISTED` does:
- **Purchasable** via its **direct URL** — customers can add to cart and check out;
  "in cart, checkout, orders, and other post-purchase surfaces, unlisted products
  behave like active products."
- **Hidden** from storefront **search** (incl. predictive), **collections**,
  **product recommendations**, the **XML sitemap**, **Shopify Catalog**, and
  internet search; the product page carries **`noindex`/`nofollow`**.
- **Not publishable** to Shop app, POS, or third-party channels — but **remains on
  the Online Store** (the only channel bundles support anyway; see §1/§4).
- Storefront API / Liquid return it **only when referenced individually** by
  handle/id/metafield — never in listings.

**Set it via** `productUpdate` (the deprecated `productChangeStatus` is replaced by
`productUpdate`):
- `productUpdate` — https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/productUpdate

**Does our existing cart-permalink carry it to checkout?** **Yes.** Our rail
(`/cart/<numericVariantId>:<qty>`, `src/lib/cart.ts`) needs only the **numeric
variant id of the bundle's parent variant**. Since unlisted products behave like
active products in cart/checkout, the permalink resolves and checks out normally.
We do **not** need `?discount=…` on it — the saving is baked into the bundle's own
price. Implementation note: after creating the bundle, read the parent variant's
GID and feed it through `parseNumericVariantId` exactly as catalog products are
today.

**Sequence detail:** `productBundleCreate` leaves the new product in **`DRAFT`**.
We must flip it — to **`UNLISTED`** (not `ACTIVE`) — and ensure it is **published to
the Online Store** publication so the direct URL/permalink resolves.
- Publishing / `publishablePublish` — https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/publishablePublish

**[VERIFY] before build (highest-value test in this spike):** confirm an
**`UNLISTED` fixed bundle is purchasable through a `/cart/<variant>:1` permalink**
end-to-end on the live store. Both features individually support this, but the
*combination* (unlisted × native bundle) is newer than either alone, and a
developer-forum thread reported early `UNLISTED` enum rough edges on 2025-10
(should be settled by `2026-04`, but prove it):
- UNLISTED enum issue report — https://community.shopify.dev/t/productstatus-unlisted-productstatus-enum-not-working-on-2025-10-and-unstable-version-despite-being-in-documentation/21197

---

## 4. Inventory: native component linkage

**Shopify handles component decrement natively for fixed bundles** — this is the
main reason to prefer the native path over a plain hidden product.

- **Bundle availability is derived from component stock:** the component with the
  **lowest available quantity** caps how many bundles can be sold. A component is
  ignored in that calculation if it is **untracked** or set to **"continue selling
  when out of stock."**
- **On purchase, the component SKUs are decremented** directly — there's no
  phantom bundle inventory to reconcile.
- Eligibility & considerations — https://help.shopify.com/en/manual/products/bundles/eligibility-and-considerations

**What if a component sells out between email send and purchase?** The bundle
**automatically becomes unavailable** (out of stock) the moment any tracked
component hits 0 — the customer cannot complete the purchase of a bundle whose
parts don't exist. This is the **safe** failure mode (no overselling), at the cost
of a silently-dead offer. Two mitigations for the customer experience:
1. Our stock data is **sync-fresh** (daily cron, see `docs/CATALOG_SYNC.md`), so at
   compose time we already avoid sold-out components.
2. Short offer expiry (mirrors the 7-day discount window in `docs/DISCOUNTS.md`)
   shrinks the sell-out window.

This native linkage is **absent** from the §6(a) plain-product fallback — that's the
fallback's key operational risk.

---

## 5. Lifecycle: expiring an offer

**Cleanest expiry: `productUpdate` → `status: ARCHIVED` via cron.** Prefer
**ARCHIVE over DELETE**:
- **ARCHIVE** removes the product from all storefronts but **preserves order
  history**, is **reversible**, and leaves the bundle record intact for audit/KPIs.
- **DELETE** is destructive and complicates any order that already referenced the
  bundle; avoid.
- `productUpdate` — https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/productUpdate
- (Alternative: `productDelete` — https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/productDelete — not recommended.)

This slots directly into the existing daily cron pattern
(`vercel.json`, `src/app/api/cron/…`). The cron sweeps bundle records whose
`expiry < now` and archives the corresponding Shopify product.

**What a customer who clicks an old link actually sees — and the honest caveat.**
There is **no native "friendly offer-expired" page**. Real behavior:
- An **archived** product's storefront URL returns a **404 / "page not found"** (it
  is removed from the Online Store).
- A **cart permalink** pointing at an archived/unavailable variant fails to add the
  line — the variant can't be found, so the item is **dropped** (empty/partial
  cart) rather than showing a tailored message.

So the requested "friendly *Angebot abgelaufen*" is **not** what Shopify shows
out-of-the-box. If we want that exact UX, options (small follow-on, not required
for the spike):
- Route the email CTA through **our own redirector** (we already have
  `src/app/api/r/[token]/route.ts`) and, when the linked bundle is expired/archived,
  serve a friendly "offer expired" page / redirect to a relevant collection instead
  of bouncing the user into a 404. This keeps the failure mode graceful and on-brand
  without depending on Shopify storefront behavior.

**Acceptable failure mode decision:** native = 404/empty-cart; with the redirector
wrapper = friendly expired page. Recommend the redirector wrapper since the link
rail (`/api/r/[token]`) already exists.

---

## 6. Fallback architecture (if native fixed bundles aren't cleanly available)

Evaluated against: arbitrary admin price, link-to-checkout, auto-cleanup, and
inventory safety.

### (a) Plain hidden (UNLISTED) product, price = bundle price, components listed in description
- **How:** `productCreate` a single-variant product at the admin's price, status
  `UNLISTED`, description lists the included catalog items; link via the existing
  cart permalink; archive on expiry.
- **Scope:** `write_products` only — we have it. **No bundles capability needed.**
- **Pros:** simplest; full control of price + `compareAtPrice` (true-sum); reuses
  every existing rail; not blocked by the §1 capability caveat.
- **CON / operational risk (state plainly):** **no native component-inventory
  linkage.** The hidden product has its own (untracked or independent) stock, so it
  stays purchasable **even when a real component is out of stock → overselling /
  cannot fulfil.** Mitigations: (i) check component stock at compose time
  (sync-fresh), (ii) short expiry, (iii) optional live `availableForSale` re-check
  on the components before send (the deferred "live availability" option already
  noted in `docs/CATALOG_SYNC.md`). None of these fully close the gap the way native
  decrement does. Also: fulfilment team must know which catalog SKUs to pick (the
  description is the only linkage).

### (b) Automatic discount restricted to a product combination
- **How:** `discountAutomaticBxgyCreate` (or a combination/`discountAutomaticBasicCreate`
  restricted to the chosen products) so that when the exact products are in the cart
  the total drops to the offer price.
  - https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/discountAutomaticBxgyCreate
- **Scope:** `write_discounts` — we have it.
- **Pros:** no new product to create/clean up; rides the existing multi-line cart
  permalink (`buildPrefilledCartUrl`).
- **CONS:** this is **discounting, not a product** — i.e. it's the very thing we're
  trying to move away from. The "price" is expressed as a percentage/amount off, so
  hitting an **exact arbitrary total** is awkward and brittle (rounding; component
  price drift). The customer can remove a line and still get the discount on the
  rest; it's a per-combination rule, not a single "buy the bundle" object. Worse
  PAngV story (no clean "statt" on a single product). Reads as a discount on the
  invoice. **Not recommended** as primary or fallback — it re-introduces the model
  we're replacing.

### (c) Draft orders
- **How:** `draftOrderCreate` with custom line items + custom total, send the
  invoice/checkout URL in the email.
  - https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/draftOrderCreate
- **SCOPE BLOCKER (checked, as instructed):** `draftOrderCreate` requires
  **`write_draft_orders`** (or `write_quick_sale`) — **which we do NOT hold.** This
  path is **off the table** unless a scope change is approved (Partner/Developer
  Dashboard scope addition → store re-grant). Even then it's a worse fit: draft-order
  invoice links are a different checkout surface from our cart-permalink rail, and
  the offer isn't a browsable product.

### Recommendation
- **PRIMARY:** **native fixed bundle** — `productBundleCreate` → poll
  `ProductBundleOperation` → set parent-variant `price` (admin total) and
  `compareAtPrice` (true component sum) → `status: UNLISTED` + publish to Online
  Store → link via existing cart permalink → archive on expiry. Wins on inventory
  safety (native decrement), genuine product semantics, and clean PAngV compare-at.
  Costs: async create/poll, and the §1 capability + §3 unlisted-purchasability
  verifications.
- **FALLBACK:** **§6(a) plain UNLISTED product** at the bundle price. Use this if the
  §1 `productBundleCreate` capability check fails and the merchant can't/won't install
  the free Shopify Bundles app. Identical rails and pricing/compare-at story; the
  accepted trade-off is **manual inventory safety** (no native component decrement),
  mitigated by sync-fresh stock checks at compose time, an optional live
  `availableForSale` re-check, and short expiry.

Both primary and fallback use the **same** surrounding machinery (unlisted status,
cart permalink, archive-on-expiry cron, bundle record), so switching between them is
a localized change in the "create the Shopify product" step — de-risking the build.

---

## 7. Rate / cost constraints for ~tens of products/month

No meaningful constraint.

- **GraphQL Admin** uses a **calculated-cost leaky bucket**: standard plan restores
  **~50 cost points/sec**, bucket capacity ~1,000, and a single query may not exceed
  **1,000 points**.
  - https://shopify.dev/docs/api/usage/limits
  - https://help.shopify.com/api/graphql-admin-api/call-limit
- Creating one bundle is a handful of cheap mutations (create + a few poll reads +
  variant price update + status/publish), each well under the bucket. **Tens per
  month** is negligible — orders of magnitude below the limit. Our existing client
  (`src/lib/shopify.ts`) already handles cost-aware querying (it tunes catalog page
  size to stay under the 1,000-cost ceiling).
- **Async caveat, not a rate caveat:** `productBundleCreate` is asynchronous, so the
  creation flow must **poll `ProductBundleOperation`** to completion (a short retry
  loop) before reading the parent variant id / setting price. Budget a few seconds of
  polling per bundle; it is not rate-limited in practice at our volume.
- **No plan gating:** fixed bundles work on our standard plan; no Plus requirement.

---

## RECOMMENDED approach

**Build personalized bundle offers as native Shopify fixed bundles, kept UNLISTED.**

Per-offer flow (backend, automatic):
1. `productBundleCreate(components: [chosen catalog variants])` → returns a
   `ProductBundleOperation`.
2. **Poll** the operation until the bundle product exists; read the **parent variant
   GID**.
3. `productVariantsBulkUpdate` → set **`price` = admin bundle price** and
   **`compareAtPrice` = true sum of component prices** (PAngV-safe "statt €X").
4. `productUpdate` → **`status: UNLISTED`**; `publishablePublish` to the **Online
   Store** publication.
5. Build the email CTA as a **cart permalink** to the parent variant
   (`/cart/<numericVariantId>:1`) via the existing `src/lib/cart.ts` rail (optionally
   wrapped by `/api/r/[token]` for click tracking + graceful expiry).
6. **Expiry cron** (daily, existing pattern) → `productUpdate status: ARCHIVED` for
   bundles past `expiry`; the redirector serves a friendly "Angebot abgelaufen" page
   for late clicks.

**Fallback (drop-in):** if step 1 fails the capability check, replace steps 1–2 with
a single `productCreate` of an UNLISTED product priced at the bundle total, listing
components in the description (accept manual inventory safety — see §6(a)). Steps
3–6 are unchanged.

## Required follow-ups (before build)

1. **[VERIFY — capability] Can our app call `productBundleCreate` on the live
   store?** Run one create against the real store. **If it errors with an
   access/ownership error,** the **store owner / admin must install the free
   first-party "Shopify Bundles" app** in **Shopify admin → Apps** (Online Store,
   standard plan — no charge) to unlock the bundles capability. That is the single
   manual click that may be needed, and **it is the merchant's to make**, not ours.
   No code/app scope change is required for the primary path — **`write_products`
   already suffices.**
2. **[VERIFY — purchasability] Prove an UNLISTED fixed bundle checks out via a
   `/cart/<variant>:1` permalink** end-to-end on the live store (the newer
   unlisted×bundle combination; §3).
3. **No scope change for primary or §6(a) fallback** — both need only
   `write_products`, which we hold.
4. **Only if the draft-order path (§6c) is ever revived:** add **`write_draft_orders`**
   (and `read_draft_orders`) to the app in the **Developer/Partner Dashboard**, then
   the **merchant must re-grant** the updated scopes on the store. Recommended:
   **don't** — §6c is not the chosen path.

## Data model sketch for S10 (`bundle_offer` record)

A new table mirroring the `marketing_sends` style (see `migrations/`), one row per
generated offer. Component prices are **snapshotted** so the displayed "statt €X" is
auditable even after catalog prices drift.

```sql
-- migrations/00XX_bundle_offers.sql  (illustrative — not applied in this spike)
CREATE TABLE bundle_offers (
  id                    TEXT PRIMARY KEY,            -- our offer id (uuid)
  customer_id           TEXT,                        -- recipient (nullable for adhoc)
  marketing_send_id     TEXT,                        -- link to the email send, if any

  -- Components: snapshot of what went into the bundle at creation time.
  -- JSON array; each entry pins the catalog product + the resolved Shopify
  -- variant + the component's unit price AT CREATION (for the true-sum compare-at).
  components            JSONB NOT NULL,
  -- e.g. [{ "productId":"atx-foldable-...", "variantId":"gid://shopify/ProductVariant/123",
  --         "numericVariantId":"123", "qty":1, "unitPrice":"149.00", "currency":"EUR" }]

  -- Pricing (all decimal strings / minor-unit, Money-style; currency fixed EUR).
  components_sum        NUMERIC(10,2) NOT NULL,      -- TRUE sum of component prices => compareAtPrice / "statt"
  bundle_price          NUMERIC(10,2) NOT NULL,      -- admin-set selling price (defaults to components_sum)
  currency              TEXT NOT NULL DEFAULT 'EUR',

  -- Shopify linkage.
  shopify_product_id    TEXT,                        -- gid://shopify/Product/...   (null until created)
  shopify_variant_id    TEXT,                        -- parent variant gid (for the cart permalink)
  numeric_variant_id    TEXT,                        -- digits only, ready for /cart/<id>:1
  shopify_handle        TEXT,                        -- product handle (direct URL)
  bundle_operation_id   TEXT,                        -- ProductBundleOperation gid (poll/audit)
  creation_mode         TEXT NOT NULL,               -- 'native_fixed_bundle' | 'plain_unlisted_product' (fallback)

  -- Lifecycle.
  status                TEXT NOT NULL DEFAULT 'pending',
                        -- pending -> active -> expired | failed
                        -- (active == UNLISTED+published & purchasable;
                        --  expired == Shopify product ARCHIVED)
  cart_url              TEXT,                        -- materialized /cart/<id>:1 permalink
  expires_at            TIMESTAMPTZ NOT NULL,        -- offer deadline (e.g. created + 7d)
  archived_at           TIMESTAMPTZ,                 -- set when expiry cron archived it
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bundle_offers_expiry  ON bundle_offers (status, expires_at);  -- expiry cron sweep
CREATE INDEX idx_bundle_offers_customer ON bundle_offers (customer_id);
```

Lifecycle states map 1:1 to Shopify: `pending` (record created, Shopify product not
yet live) → `active` (UNLISTED + published, `cart_url` materialized) → `expired`
(Shopify product ARCHIVED by cron) or `failed` (create/poll error; offer never sent).

---

### Source index (open in a browser to re-confirm; `shopify.dev` blocks automated fetch)
- productBundleCreate — https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/productBundleCreate
- productBundleUpdate — https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/productBundleUpdate
- ProductBundleOperation — https://shopify.dev/docs/api/admin-graphql/2026-04/objects/ProductBundleOperation
- About product bundles — https://shopify.dev/docs/apps/build/product-merchandising/bundles
- Start building bundles (limits) — https://shopify.dev/docs/apps/build/product-merchandising/bundles/start-building
- Add a product fixed bundle (flow + pricing) — https://shopify.dev/docs/apps/build/product-merchandising/bundles/add-product-fixed-bundle
- Bundles eligibility & considerations (inventory, channels) — https://help.shopify.com/en/manual/products/bundles/eligibility-and-considerations
- Shopify Bundles (Help Center) — https://help.shopify.com/en/manual/products/bundles/shopify-bundles
- Unlisted product status (dev docs) — https://shopify.dev/docs/apps/build/product-merchandising/unlisted-products
- New: Unlisted Product Status (changelog) — https://shopify.dev/changelog/new-unlisted-product-status
- ProductStatus enum — https://shopify.dev/docs/api/admin-graphql/2026-04/enums/ProductStatus
- productUpdate — https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/productUpdate
- productVariantsBulkUpdate — https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/productVariantsBulkUpdate
- ProductVariant (price/compareAtPrice) — https://shopify.dev/docs/api/admin-graphql/2026-04/objects/ProductVariant
- publishablePublish — https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/publishablePublish
- draftOrderCreate (scope blocker) — https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/draftOrderCreate
- discountAutomaticBxgyCreate — https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/discountAutomaticBxgyCreate
- API rate limits — https://shopify.dev/docs/api/usage/limits , https://help.shopify.com/api/graphql-admin-api/call-limit

---

## Probe results (S9b, 2026-06-13)

**Verified live** against `motion sports` (`d75d11-58.myshopify.com`, **Advanced**
plan), Admin API `2026-04`, on 2026-06-13.

**Probe artefact:** `scripts/probe-bundle.mjs` (throwaway; run with
`node --env-file=.env scripts/probe-bundle.mjs` — add `--keep` to leave the
probe product live for the manual checkout test). It uses the existing backend
client (`adminGraphql`/`isShopifyConfigured` from `src/lib/shopify.ts`,
`parseNumericVariantId`/`SHOP_DOMAIN` from `src/lib/shopify-cart-url.mjs` — the
module `src/lib/cart.ts` re-exports `parseNumericVariantId` from) and, per the
doc-sourcing note above, **does not trust memorised mutation shapes**: a
`preflight()` step introspects the live `2026-04` schema and asserts every input
field / mutation argument **and each mutation's `userErrors` sub-selection**
before firing (these mutations use *different* userError types — e.g.
`productBundleCreate` → plain `UserError` with **no `code`**;
`productVariantsBulkUpdate` → `ProductVariantsBulkUpdateUserError` with `code`).
A capability verdict is drawn ONLY from a genuine access/ownership error; any
GraphQL validation error fails loud as a probe bug. It sets `compareAtPrice` to
the true component sum (PAngV "statt €X", §2), re-polls the async bundle
inventory until it settles, and archives (never deletes) what it creates.

### CHECK 1 — capability: **YES** ✅

`productBundleCreate` succeeds on this store with `write_products` — **no
access/ownership error, so the free "Shopify Bundles" app is NOT required.**

| Field | Value |
| --- | --- |
| Capability (`productBundleCreate`) | **YES** — no access error |
| `ProductBundleOperation` id | `gid://shopify/ProductBundleOperation/47933358409` |
| Poll to completion | **2 polls / ~1.9 s** (lifecycle `CREATED → ACTIVE → COMPLETE`; the `product` populates only at `COMPLETE`, read via the generic `node(id:)` interface — there is no top-level `productBundleOperation(id:)` field) |
| Bundle product / parent variant | `gid://shopify/Product/10240485392713` / `gid://shopify/ProductVariant/54594995487049` |
| Components (auto-picked, real stock) | ATX® 2 Grip Hantelscheiben 1,25 kg (qty **1**) + Widerstandsbänder ATX® (qty **30**) |

### CHECK 2 — purchasability: **buyable server-side** ✅

| Field | Value |
| --- | --- |
| Price / `compareAtPrice` (`productVariantsBulkUpdate`) | **1.00 EUR** / **6.50 EUR** (= true component sum) |
| Status → `UNLISTED` (`productUpdate`, arg `product: ProductUpdateInput`) | **UNLISTED** ✅ |
| Published to Online Store (`publishablePublish`) | **true**, publication `gid://shopify/Publication/200465285449` ✅ |
| `publishedOnPublication(Online Store)` | **true** ✅ |
| Parent variant `availableForSale` / qty / policy | **true** / **1** / `DENY` ✅ (settled on the 1st inventory re-poll) |
| `totalInventory` / `tracksInventory` | **1** / true |
| **Cart permalink** | `https://motionsports.de/cart/54594995487049:1` |
| Recommendation emitted | **`GO`** |

**§4 native inventory linkage — empirically confirmed.** The bundle's
`inventoryQuantity` came out **1 = min(component stock)** = `min(1, 30)` (the
lowest-stock component caps the bundle), exactly as §4 describes. No phantom
bundle stock; availability follows the components.

**Manual step (the only thing not provable server-side):** open the permalink
above in an incognito window and confirm it adds the bundle and reaches Shopify
checkout. The product was left live via `--keep` for this; **archive it
afterward** (Shopify admin → Products, or a `--keep`-less probe run sweeps any
`S9b probe bundle*` leftover).

### ⚠ Scope correction to §1 / "Required follow-ups" — publishing needs publication scopes

The spike (§1, §6, follow-up #3) stated the native path needs **only
`write_products`**. The probe **disproved** that: creating + pricing + setting
`UNLISTED` work with `write_products`, but **publishing the bundle to the Online
Store requires `read_publications` + `write_publications`**, which the app's
token did **not** originally hold (`publishablePublish`/`publications` returned
`ACCESS_DENIED: read_publications`). After adding both scopes in the Dev
Dashboard and **reinstalling the app on the store** (client-credentials tokens
only carry scopes granted at install), the token reported all 17 scopes incl.
`read_publications` + `write_publications`, and the publish step succeeded. The
§6(a) plain-`UNLISTED`-product fallback uses the **same** `publishablePublish`,
so it needs these scopes too. **S10 prerequisite: keep `read_publications` +
`write_publications` granted.** (An earlier probe revision also produced a
*false-negative* "capability NOT available" by hardcoding a non-existent
`userErrors.code` on `productBundleCreate` and mis-classifying the resulting
validation error; that is fixed — capability verdicts now come only from genuine
access errors.)

### Recommendation: **GO** ✅ (native fixed bundle)

Build personalized bundle offers as **native Shopify fixed bundles, kept
`UNLISTED`**, per the §RECOMMENDED flow. Every step is verified end-to-end on the
live store: `productBundleCreate` (capability present, no Bundles-app install
needed) → poll `ProductBundleOperation` via `node(id:)` → `productVariantsBulkUpdate`
price + true-sum `compareAtPrice` → `productUpdate` `UNLISTED` → `publishablePublish`
to Online Store → `/cart/<numericVariantId>:1` permalink → server-side
purchasable (`availableForSale=true`, bundle qty = min component) → archive on
expiry. **One scope addition vs the original spike:** the app must hold
`read_publications` + `write_publications` (now granted). Final
click-through-to-checkout is a one-time manual confirmation on the permalink
above.
</content>
</invoke>
