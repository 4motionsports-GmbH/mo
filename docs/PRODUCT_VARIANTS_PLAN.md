# Product variants — plan for variant-granular selection & recommendation

Status: **being implemented** (this branch)

## 1. Problem

The shop has products with variants (Shopify options): resistance bands in
9 pull strengths, kettlebells 8–48 kg, whey in 3 flavors, step boxes in 6
wood types, … In the current Shopify export **238 of 1069 products (~22 %)
have more than one priced variant**.

Today the whole system flattens every product to its **default variant**:

- `catalog-mapping.ts:253` — `const variant = p.variants[0]`; `price`,
  `salePrice`, `sku`, `barcode`, `shopifyVariantId`, `shopifyCartUrl` all come
  from that one variant. The sync already fetches `variants(first: 50)`
  (`shopify.ts:376`) and discards the other 49.
- Consequence in data: „Widerstandsbänder Gummi ATX® – in 9 Zugkraftstärken"
  is one catalog entry priced 3,60 € (the weakest band); the kettlebell
  series shows 24,90 € although 8–48 kg span 24,90–~120 €.
- Every selection surface — the admin catalog pickers, campaign
  recommendations, bundle components, Mo's chat tools, cart permalinks,
  order attribution — operates on `productId` (= Shopify handle) only.

Goal: **wherever a product can be selected or recommended, a specific
variant can be selected or recommended** — admin pickers *and* everything
Mo knows/recommends — without breaking the existing id rails, and with one
clean, maintainable structure instead of per-feature hacks.

## 2. Design decisions (the short version)

| Decision | Choice | Why |
|---|---|---|
| Catalog shape | **One `Product` per handle + embedded `variants[]` array** (not one catalog entry per variant) | `Product.id` = handle is the id-space of embeddings, QA entries, campaign drafts, bundles, attribution, `compatibleWith`/`relatedProducts`, conversation `selected_product_ids`. Exploding products would break all of them and bloat retrieval. |
| Top-level fields | **Unchanged semantics** (default-variant projection) | Full backward compatibility: every existing consumer keeps working untouched until it opts into variants. |
| Variant reference | **One canonical "product ref" string: `handle` or `handle~<numericVariantId>`**, implemented in a single pure module `src/lib/product-ref.mjs` | All existing rails carry plain id strings (tool params `productId`/`productIds`, `campaign_drafts.recommended_product_ids TEXT[]`, `marketing_sends.product_ids`, conversation selections). A suffix encoding upgrades ALL of them to variant granularity with **zero schema migrations and zero tool-schema churn**. `~` cannot appear in a Shopify handle and is URL-safe (unreserved per RFC 3986 — a `#` would start a URL fragment and be silently truncated in query strings), and a ref without `~` keeps meaning "the product / its default variant". |
| Structured stores | Bundle `components` JSONB keeps its explicit `variantId` field — it already has one; it just stops being hardwired to the default | Snapshots stay self-describing. |
| Embeddings | **Still one vector per product**; the embedding doc gains a `Varianten:` section | Variants share 95 % of their text; per-variant vectors would multiply cost and dilute retrieval. Variant titles/prices in the doc make "kettlebell 16 kg" retrievable. |
| Picker UI | Extract the 4 copy-paste search widgets into a shared `useCatalogSearch` hook + `<CatalogProductPicker>` (in `src/app/admin/ui/`), with a built-in second-stage **variant chooser** when a hit has >1 variant | The pickers in `CustomerProfileCard.tsx:1139-1170`, `KampagneWorkspace.tsx:1930-1960`, `WissenWorkspace.tsx:552-583` are line-for-line duplicates (250 ms debounce + seq-guard). Variants would otherwise be implemented three times. |

### The `ProductVariant` type (new, in `types.ts`)

```ts
export interface ProductVariant {
  id: string | null;        // numeric Shopify variant id; null in CSV fallback
  title: string;            // "16 kg", "Stärke 5", "Eiche" — from selectedOptions
  options: Array<{ name: string; value: string }>;
  sku?: string;
  barcode?: string;
  price: number;
  salePrice?: number;
  available: boolean;       // ProductVariant.availableForSale
  inventoryQuantity?: number;
  cartUrl?: string;         // /cart/<id>:1, omitted when id is null
  isDefault: boolean;       // variants[0] in Shopify order
}

// On Product:
variants?: ProductVariant[];   // present (length ≥ 1) after the sync change
priceMin?: number;             // convenience: min/max effective price across
priceMax?: number;             //   variants — for "ab 3,60 €" rendering & filters
```

`variants` stays optional: an **old blob** (or the committed JSON fallback)
without it must keep working — every helper treats a missing array as the
single default variant synthesized from the top-level fields. That is the
back-compat contract for the whole plan.

### The product-ref module (new, `src/lib/product-ref.mjs`)

Pure, dependency-free (usable from `.ts`, `.mjs`, tests, scripts):

```
formatProductRef(productId, variantId?)   → "handle" | "handle~123"
parseProductRef(ref)                      → { productId, variantId: string|null }
resolveProductRef(catalogById, ref)       → { product, variant } | null
  // variant = matching variants[] entry, else default variant, else
  //           synthesized from top-level fields (old-blob fallback)
effectiveVariantPrice(variant)            → salePrice ?? price
```

Every consumer that today does `getProductById(id)` and reads
`product.price` / `product.shopifyVariantId` migrates to
`resolveProductRef` and reads from the resolved variant. One resolution
path, unit-testable, no scattered `split("~")`.

## 3. Phased implementation

Each phase is independently shippable and leaves the system fully working.

### Phase 0 — Foundation: sync + data model (no behavior change)

1. **`shopify.ts`** — extend the variants fragment with `title` and
   `selectedOptions { name value }` (scalar fields on the already-fetched
   connection; no extra query cost class).
2. **`catalog-mapping.ts`** — build `variants[]` (mapping each
   `ShopifyProductVariant`), compute `priceMin`/`priceMax`; top-level
   fields stay the default-variant projection exactly as today. Product
   `inStock` logic is already variant-aware (`anyVariantAvailable`) —
   unchanged.
3. **`convert-catalog.mjs`** (CSV fallback) — group variant rows per handle
   using `Option1-3 Name/Value`, `Variant SKU`, `Variant Price`; variant
   `id: null` (the CSV export has no numeric variant id → cart links
   degrade exactly as the fallback already does).
4. **`embedding-doc.mjs`** — add a `Varianten:` section (title, effective
   price, availability; cap ~15 lines, else summarize as a price range) and
   change the price line to `Preis: ab X EUR bis Y EUR` for multi-variant
   products. Bump `EMBEDDING_DOC_VERSION → 3` (one-time full re-embed; the
   carry-forward machinery handles it).
5. **`product-ref.mjs`** + tests.
6. Re-run sync; verify blob size (965 products × ≤50 compact variants is
   well within limits) and that a stale-blob deploy (variants absent)
   still passes the full test suite.

### Phase 1 — Shared admin picker + bundle composer

1. **`/api/admin/catalog/search`** — each hit gains
   `variants: [{ variantId, title, unitPrice, currency, available }]`
   (compact projection) + `priceMin`/`priceMax`. Optionally extend
   `searchCatalogByName` to also match variant titles ("kettlebell 16"),
   returning `matchedVariantId` for preselection.
2. **`src/app/admin/ui/product-picker.tsx`** — `useCatalogSearch(query, {enabled})`
   (debounce + seq-guard + fetch + error surface, parameterized over the
   three fetch wrappers) and `<CatalogProductPicker onSelect={(hit, variant|null) => …}>`:
   single-variant products add directly; multi-variant hits expand an
   inline variant list (title · price · „ausverkauft" flag) — mirrors the
   storefront PDP variant chooser from the screenshot.
3. **Bundle composer** (`CustomerProfileCard.tsx` `BundleOfferSection`) —
   components carry `variantId`; chips render „Titel — Variante".
   `POST /api/admin/bundles/create` accepts `components:[{productId, variantId?, quantity?}]`.
4. **`bundle-offer-core.mjs` `validateAndSnapshotComponents`** — resolve the
   requested variant via `resolveProductRef`; price/availability/gates
   (`sold_out`, `no_variant`) evaluated **per variant**, snapshot keeps its
   existing `variantId`/`numericVariantId` fields (now the *chosen* variant).
   `bundle-suggestion-core.mjs` candidate gate: product qualifies when *any*
   variant has a numeric id.
5. Migrate the campaign-contacts search (`KampagneWorkspace.tsx:1740`) onto
   the hook opportunistically (no variant UI there).

### Phase 2 — Campaign recommendations & marketing emails

1. **`RecommendationsEditor`** (`KampagneWorkspace.tsx`) — use the shared
   picker; store refs (`handle~variant`) in the existing
   `recommended_product_ids TEXT[]` — **no migration**.
   `/api/admin/campaign/recommendations` validates refs via
   `resolveProductRef` (409 `sold_out` checks the chosen variant).
2. **Draft prompt** (`campaign-draft.ts`) — `CampaignRecommendationInput`
   gains `variantTitle`; `recommendationsBlock` renders
   `- Name — Variante: 16 kg (Kategorie) — url`. Key `productHighlights`
   matching by **ref**, not by display name (fixes the existing name-collision
   hazard in `email-products.ts:296-303`).
3. **Email rendering** (`campaign-email.ts`, `email-products.ts`,
   `marketing-email.ts`) — resolved variant drives price label and the PDP
   deep link `${shopifyUrl}?variant=<numericVariantId>`; product name shown
   as „Name – Variante". Bundle email block already renders snapshot titles —
   include the variant title in the snapshot `title`.
   **Dangling-ref hard block:** a stored ref whose variant no longer exists
   in the catalog is NEVER silently downgraded to the default variant in
   outbound rendering (wrong price in marketing mail = PAngV risk). The
   resolver distinguishes "variant gone" from "product gone"; senders skip
   the item and surface the problem to the admin instead.
4. Campaign recommendation *scoring* stays product-level (one vector);
   the drafter/editor picks the variant.

### Phase 3 — Mo: chat knowledge, tools, widget, cart

1. **System prompt** (`system-prompt-core.mjs` `renderRetrievedProducts`) —
   per retrieved product render a compact variant table:
   `Varianten (für gezielte Empfehlung `produkt-id~variantennummer` verwenden): ~123 „16 kg" — 46,90 € — auf Lager | …`
   capped (~12 rows, else price-range summary). Also finally render
   `sku` (Artikelnummer) per variant — closing the documented gap that Mo
   can't answer article-number questions.
2. **Tool layer — no schema changes.** `productId`/`productIds` keep their
   string types; `tool-descriptions.mjs` teaches the ref syntax („für eine
   konkrete Variante `produkt-id~variantennummer` aus dem Katalogblock").
   `productIdsFromToolCall` stays untouched (refs are strings);
   `guardRecommendedCardIds` resolves refs and checks the chosen variant's
   availability.
3. **`/api/products`** — accepts refs in `?ids=`; `PublicProduct` gains
   `variants[]` (public projection) and `selectedVariantId`; per-item
   `shopifyCartUrl` + the combined `cartUrl` built from the chosen
   variant. Update `docs/API_CONTRACT.md` + `frontend-handoff` so the
   widget can render a variant selector / preselected variant
   (coordinate with the widget team — additive, so old widgets keep
   working).
4. **`cart.ts` `buildPrefilledCartUrl`** — inputs become refs; resolve via
   `resolveProductRef`, per-line variant id, sold-out skip per variant.
   `search_products` output gains `priceFrom`/`priceTo` and
   `variantCount`; retrieval price filters use `priceMin`/`priceMax`
   (a product matches `maxPriceEUR` when its *cheapest* variant does).

### Phase 4 — Attribution, Wissen, cleanup

1. **`order-attribution.mjs` `matchOrderLineItems`** — index **all**
   variants' numeric ids in `byVariant` (today: default only). Store the
   matched ref (`handle~variant`) on the line-item match so KPIs can
   distinguish *which* strength/weight was bought. Title fallback stays as
   the product-level safety net.
2. **Wissen „Produkt verlinken"** — shared picker; a chosen variant
   produces `[Name – Variante](url?variant=<id>)`.
3. Docs: update `CATALOG_SYNC.md`, `BUNDLES.md`, `CAMPAIGNS.md`,
   `ORDER_ATTRIBUTION.md`, `ADMIN_DASHBOARD.md`; add a variants section to
   `API_CONTRACT.md`.

## 4. What deliberately does NOT change

- `Product.id` stays the handle; no id migration anywhere.
- One embedding vector per product; retrieval architecture unchanged.
- Top-level `price`/`salePrice`/`sku`/`shopifyVariantId` keep default-variant
  semantics (consumers migrate to refs at their own pace; nothing breaks
  meanwhile).
- Availability model: product `inStock` unchanged; variant-level
  `available` refines it where a variant is chosen.
- No per-variant DB rows: refs ride the existing TEXT columns; bundle
  snapshots already had `variantId`.

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Old blob without `variants[]` after deploy (or rollback with a new blob) | `resolveProductRef` synthesizes a default variant from top-level fields; new fields are additive so old code ignores them. |
| Prompt-size growth (8 retrieved products × up to 50 variants) | Cap rendered variants (~12) + price-range summary; measure with the existing golden prompt test (`system-prompt-core.de.golden.txt`). |
| `EMBEDDING_DOC_VERSION` bump = full re-embed cost | One-time, bounded (≈965 docs, `text-embedding-3-small`); carry-forward guard already refuses partial writes. |
| Model recommends a ref with a sold-out variant | `guardRecommendedCardIds` + bundle/campaign validators check the *chosen* variant's availability. |
| Name-keyed `productHighlights` collide once variants share a product name | Phase 2 re-keys by ref (pre-existing latent bug, fixed en passant). |
| Widget contract change | Additive only; `selectedVariantId`/`variants` are new optional fields; rollout coordinated via `frontend-handoff`. |
| CSV fallback has no numeric variant ids | Variant knowledge (titles/prices) still present; cart links degrade exactly as the fallback does today. |

## 6. Effort estimate (rough)

- Phase 0: ~1–2 days (sync, mapping, embedding doc, ref module, tests)
- Phase 1: ~2–3 days (shared picker + bundle path + search API)
- Phase 2: ~2 days (campaign editor, draft prompt, email rendering)
- Phase 3: ~2–3 days (prompt block, tool descriptions, /api/products, cart, widget-contract docs)
- Phase 4: ~1–2 days (attribution, Wissen, docs)

Phases 0→1 alone already deliver the screenshot use case (variant-precise
tailored bundle offers); 0→2 covers marketing emails; 3 makes Mo himself
variant-aware; 4 closes the measurement loop.
