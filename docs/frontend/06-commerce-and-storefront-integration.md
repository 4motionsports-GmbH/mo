# 06 — Commerce and storefront integration points

This chapter lists every place where the Mo widget touches the shop, and every place where the shop touches Mo. It covers how the widget reads the product on a product page (PDP), the product-page CTA, the `custom.qa` metafield and the Q&A tab, the product data the widget fetches, the links it opens, the cart (checkout permalink, badge and drawer sync, stacking), the order-attribution stamp, shop login vs Mo sign-in, locales and prices, and the theme hooks the widget depends on. It ends with what the backend can change without a theme deploy, a list of findings and the open questions.
Backend behaviour is not re-specified. It is cross-referenced to the backend repo's widget contract `docs/frontend/API_CONTRACT.md` and `docs/frontend/ACCOUNT_CONTRACT.md` (cited as `API_CONTRACT.md §n`, `ACCOUNT_CONTRACT.md §n`), `docs/ORDER_ATTRIBUTION.md`, `docs/QA_KNOWLEDGE.md` and the backend as-built `docs/CUSTOMER_ACCOUNT.md`. The sibling chapters `01-storefront-theme.md`, `02-widget-architecture.md`, `03-chat-protocol-and-rendering.md` and `04-accounts-sign-in-and-consent.md` go deeper on theme layout, widget internals, the chat stream and identity.
Code locations are given as `file → function / selector / key`. Line numbers are left out on purpose because they drift. The repo state described is `main` at `bc7fb5d`: the 2026-10-05 tasks (`11ac337` + `bc7fb5d`, theme PR #75: served consent bullets, page context on typed turns, attribution-token renewal and cart-marker blanking) on top of `3e87341` (PR #73 `a0df103`, the fixes of `8d0a0c4`, and two added `endSpeaking()` calls). Liquid, templates, settings and the other assets are unchanged since `3e87341` (only the two widget assets, `MANIFEST.md` and the theme repo's own docs changed). Which build the live shop serves: `07` §6.4; production status (uploads, App Proxy, backend switches) is tracked only in the backend's `docs/ROLLOUT_TODO.md`. The live theme may differ (see §17).

**Contents**

1. [At a glance: every shop ⇄ Mo touchpoint](#1-at-a-glance-every-shop--mo-touchpoint)
2. [Product context on product pages](#2-product-context-on-product-pages)
3. [The product-page CTA ("MO only" block)](#3-the-product-page-cta-mo-only-block)
4. [The `custom.qa` metafield and the PDP Q&A tab](#4-the-customqa-metafield-and-the-pdp-qa-tab)
5. [Product data the widget fetches (`GET /api/products`)](#5-product-data-the-widget-fetches-get-apiproducts)
6. [Links the widget opens](#6-links-the-widget-opens)
7. [Cart integration](#7-cart-integration)
8. [Order attribution stamp (`_mo` cart attribute)](#8-order-attribution-stamp-_mo-cart-attribute)
9. [Shopify customer login vs Mo sign-in](#9-shopify-customer-login-vs-mo-sign-in)
10. [Locales, markets, prices and currency](#10-locales-markets-prices-and-currency)
11. [Shop → Mo entry links (campaign deep links)](#11-shop--mo-entry-links-campaign-deep-links)
12. [Storefront DOM hooks and globals the widget depends on](#12-storefront-dom-hooks-and-globals-the-widget-depends-on)
13. [What leaves the browser (commerce scope)](#13-what-leaves-the-browser-commerce-scope)
14. [KPI events in this chapter's scope](#14-kpi-events-in-this-chapters-scope)
15. [Changing the storefront without a theme deploy](#15-changing-the-storefront-without-a-theme-deploy)
16. [Findings, risks and suggested frontend tasks](#16-findings-risks-and-suggested-frontend-tasks)
17. [Open questions / uncertainties](#17-open-questions--uncertainties)

---

## 1. At a glance: every shop ⇄ Mo touchpoint

| # | Touchpoint | Direction | Mechanism | Code location | In this build |
|---|---|---|---|---|---|
| 1 | Page facts (page type, product id/handle/title/type, collection) | shop → widget | Liquid writes `window.MS_CHAT_CONFIG.pageContext` | `snippets/ms-chat-widget.liquid`; `ms-chat-widget.js → PAGE_CTX` | yes |
| 2 | Product-page CTA "Detaillierte Beratung zu diesem Produkt" | shop → widget | `<button class="ms-chat-product-cta" data-…>` + delegated click handler | `templates/product.json → custom_liquid_AErEyg` ("MO only"); `ms-chat-widget.js → bindProductCtas() / openWithProduct()` | yes, on every product template (§3.7) |
| 3 | PDP Q&A tab + FAQPage JSON-LD | backend → shop | Admin API `metafieldsSet` on product metafield `custom.qa` | `sections/tabs-cards.liquid`, `snippets/product-qa.liquid` | yes |
| 4 | Product cards, compare table, showroom card data | backend → widget | `GET {apiBase}/api/products` | `ms-chat-widget.js → hydrate()`, `buildAddToCart()` | yes |
| 5 | Checkout from the chat ("Zur Kasse") | widget → shop | Opens the backend-built cart permalink `…/cart/<variant>:1,…` in a new tab | `ms-chat-widget.js → buildAddToCart()` | yes |
| 6 | Cart badge / drawer / cart page refresh | shop → widget → shop UI | `GET /cart.js`, `#CartBubble`, `[data-fh-cart-bubble]`, `<cart-modal>.reloadContent()`, `?section_id=` | `ms-chat-widget.js → refreshCartUI()` and helpers | yes |
| 7 | Order attribution stamp | widget → shop cart → order → backend webhook | `POST /api/attribution/token`, then same-origin `POST /cart/update.js {attributes:{_mo}}`; renewed after a live consultation, blanked (`""`) when the session ends | `ms-chat-widget.js → moAttrEnsure() / moStampCart() / initAttribution() / moAttrRenew() / moBlankCart()` | yes (stamp and renewal consent-gated, §8) |
| 8 | Shop login recognition | shop → backend → widget | Same-origin `GET /apps/chat/whoami?session=` through a Shopify App Proxy | `ms-chat-widget.js → detectViaStorefront()` | yes; a silent no-op while no App Proxy is set up (whether it is: `docs/ROLLOUT_TODO.md` 5.4; §9.1) |
| 9 | Shop-login hint | shop → widget | `window.ShopifyAnalytics.meta.page.customerId` | `ms-chat-widget.js → storefrontCustomerHint()` | yes |
| 10 | Consent state | shop → widget | `window.Shopify.customerPrivacy`, `visitorConsentCollected` event | `ms-chat-widget.js → moAnalyticsAllowed()`, `initAttribution()` | yes |
| 11 | Stacking vs theme drawers | theme ⇄ widget CSS | `body.no-scroll`, theme modal z-index 1900/2000 | `ms-chat-widget.css` | yes |
| 12 | Campaign / deep links into an open chat | shop URL → widget | `?mo=open`, `#mo-open`, `mo_new`, `mo_view`, `mo_c` | `layout/theme.liquid` head script; `ms-chat-widget.js → handleMoDeepLink()`, `captureCampaignToken()` | yes |
| 13 | Showroom link | widget → shop page | Hard-coded URL in the snippet config | `snippets/ms-chat-widget.liquid → showroomUrl`; `ms-chat-widget.js → SHOWROOM_URL`, `buildShowroom()` | yes |

The widget never adds to the cart through the AJAX cart API, never listens to theme cart events, and never dispatches its own DOM events. Its only cart writes are the attribution stamp and its blanking (§8).

---

## 2. Product context on product pages

### 2.1 Server-rendered page facts (`snippets/ms-chat-widget.liquid → pageContext`)

The snippet runs on every page where the widget renders (see `01-storefront-theme.md §5.1` for the render gate). It writes only page facts, never user data. The fields (`pageType`, `productId`, `productHandle`, `productTitle`, `productType`, `collectionTitle`, `collectionHandle`), their Liquid sources and JS defaults: `02` §3.2 (owner).

Not emitted: the selected **variant** (id, title, price, availability), price, vendor, tags, SKU, collections of the product, cart contents, or any customer flag.

### 2.2 Normalisation in the widget (`ms-chat-widget.js → PAGE_CTX`)

`PAGE_CTX` is built once at script parse time; the mapping of each field (`type`, `productId`, `productHandle`, `productName`, `collectionHandle`, `category`) and its use: `02` §3.2 (owner).

`PAGE_CTX` is read only from the snippet. The widget does **not** scrape the DOM, read `window.ShopifyAnalytics.meta.product`, the URL's `?variant=`, or the theme's variant picker.

### 2.3 Numeric id vs handle (the limitation)

The backend catalog's product id is the slug-shaped **handle** (`API_CONTRACT.md §3`, e.g. `150-kg-atx®-gym-bumper-plates-vorteilspaket`). A numeric Shopify product id is dropped server-side when sent as a context `productId`. The widget handles the two id spaces like this:

| Use | Id sent | Where |
|---|---|---|
| `context.productId` from the PDP CTA | Handle, if the CTA's `data-ms-chat-product-id` equals `PAGE_CTX.productId` (or either is empty); otherwise the passed (numeric) id | `openWithProduct()` |
| `context.productId` from the nudge greeting | `PAGE_CTX.productHandle`, falling back to the numeric id | `showNudge()` click handler |
| `context.productId` on a typed / spoken turn (`source:'page'`) | `PAGE_CTX.productHandle` only; without a handle no context is sent | `pageContextForSend()` |
| Browsing trail entry `id` | `productHandle`, falling back to the numeric id | `recordTrail()` |
| KPI `product_cta_opened.productId` | **numeric** Shopify product id (deliberately, "numeric id stays for KPI") | `openWithProduct()` |
| KPI `product_cta_clicked` / `add_to_cart_clicked` / `showroom_clicked` ids | **catalog handles**: the `id` of each `/api/products` entry, which is always the base product handle, even when a variant ref `handle~variantId` was requested (backend `src/app/api/products/route.ts → toPublic()` returns `id: source.id` with `source = base ?? p`). The variant is visible only in `selectedVariantId`, which the widget ignores, so these events are handle-level and never carry the variant | `productButton()`, `buildAddToCart()`, `buildShowroom()` |
| KPI `product_cta_clicked.samePage` | `true` when the clicked catalog id equals `PAGE_CTX.productHandle` on a product page (handle vs handle, so it works only where the catalog uses the page's handle) | `isSamePageProduct()` |

Consequence for KPIs: PDP-CTA opens and in-chat product clicks are recorded in **different id spaces**. Joining them needs a numeric-id → handle map (the catalog sync has both).

Uncertain: whether `product.handle` on `/en` is the same German handle the catalog uses. If the shop translates handles (Translate & Adapt can), the `/en` handle would not match the catalog and the context id would be dropped. The primer text still carries the title (§3.5), so the consultation still works; a typed turn's page context would then be „nicht erkannt“ (AD §5.1a) and `samePage` would stay `false`.

### 2.4 Where product context is actually sent

Which turn carries which `context`, its exact shape, and when a typed turn counts as "already sent" (`sessionStorage['ms-chat-ctx-last']`): `02` §3.2 „Page facts on the wire“ (owner); the shapes the backend accepts: `API_CONTRACT.md §2` „Optional `context`“. Commerce view of a product page:

- **CTA click** (§3.5): primer user message + `{type:"product", productId:<handle or passed id, §2.3>, productTitle, recentlyViewed?, source:"cta"}`.
- **Nudge click** on a fresh thread (only while the nudge is eligible, `05` §7.1): context greeting (`messages: []`) with the page's product (handle, falling back to the numeric id) and `source:"nudge"`.
- **First typed or spoken message** of a thread on the page, and the first after the page's product changed: the user's message + `{type:"product", productId:<handle>, productTitle?, source:"page"}` — page facts only, never the trail; on a collection page the one category of the page. A CTA or product-nudge turn already answered on the page counts as sent, so the next typed message carries none.
- **Launcher open alone** sends no chat request; later messages on the same page carry no context.

Mo uses a `source:"page"` context only with `CHAT_PAGE_CONTEXT_ENABLED` (default off in code) and outside the optional control group; the server records `page_context_applied` / `page_context_answered` either way (AD §5.1a in `docs/ADMIN_DASHBOARD.md`). Builds before `bc7fb5d` sent no context on typed turns (§16 F3, closed).

---

## 3. The product-page CTA ("MO only" block)

### 3.1 Placement

`templates/product.json → sections.main` (`main-product`), block `custom_liquid_AErEyg`, name "MO only". Block order of the visible part of the buy box (disabled blocks marked):

`vendor` (disabled) → "Breadcrumb Navigation liquid" → `title` → "SKU + Garantie" → "Stars³" → Loox fallback stars (unnamed custom_liquid) → **"USPs mit MO" (disabled)** → **"MO only"** → "USP liquid" → "Simesy LIQ" → Simesy delivery-date app block → … "Price³ (mit Snippet)" → `variant_picker` → … → `quantity_selector` → Globo product options → `buy_buttons` → payments.

The CTA therefore sits **below the rating stars and above the USPs, price, variant picker and Add-to-cart button**.

The same block (`custom_liquid_AErEyg`, byte-identical settings) is also in three alternate templates (added with `8d0a0c4`):
- `product.produkt-new.json`: after the Kurzinfo/USPs block `custom_liquid_BGU8Mt` ("USPs", which there has no CTA of its own), before the price.
- `product.produktnew.json` and `product.produkte-im-set.json`: after the SKU + Garantie block `custom_liquid_dy3Byf`, before the price and buy blocks.

Ownership: `templates/product.json` is edited in the live theme editor as well (`01-storefront-theme.md §16`). Any change made only in the repo can be reverted by the next live sync, and vice versa.

### 3.2 Markup contract

The widget relies on exactly this shape. Everything else in the block is free styling.

```html
<div class="ms-chat-product-advisor">
  <button type="button" class="ms-chat-product-cta"
          data-ms-chat-product-id="{{ product.id }}"
          data-ms-chat-product-title="{{ product.title | escape }}">
    <span class="ms-chat-logo ms-chat-product-cta__logo" aria-hidden="true"></span>
    <span class="ms-chat-product-cta__label">Detaillierte Beratung zu diesem Produkt</span>
  </button>
</div>
```

| Part | Required? | What the widget does with it |
|---|---|---|
| `.ms-chat-product-cta` (any element, inside or itself the click target) | **yes** | `bindProductCtas()` adds one document-level click listener and resolves the button with `e.target.closest('.ms-chat-product-cta')`. It calls `preventDefault()`, so the element may also be an `<a>` with a fallback `href`. |
| `data-ms-chat-product-id` | recommended | Passed to `openWithProduct(id, title)`. Numeric `product.id` today; a handle also works. Used for context (mapped to the page handle, §2.3) and the KPI. |
| `data-ms-chat-product-title` | recommended | Used verbatim in the primer message and as `context.productTitle`. Read via `getAttribute`, so the Liquid `escape` is decoded correctly for titles with quotes. |
| `.ms-chat-logo` empty `<span>` | optional | At `init()` the widget fills **every** empty `.ms-chat-logo` on the page with the animated orb SVG (`logoBlobs()`). The orb styles come from `ms-chat-widget.css`. |
| Label text | free | German literal; **not** translated on `/en` (no `| t` key). |

The same contract works on any page (collection cards, a cart-drawer block, a landing page). The handler is delegated, so dynamically inserted CTAs work too. There is **no generic "open Mo" public API** beyond `window.MS_CHAT.openWithProduct(id, title)` and `window.MS_CHAT.openEmailSummary()` (`ms-chat-widget.js → init()`).

### 3.3 Styling

Inline `<style>` inside the block (not in the widget CSS): an underlined text-link look, `font-size: 0.8rem`, black text, underline colour `rgb(var(--color-base-foreground, 0 0 0) / 35%)`, hover colour `rgb(var(--button-secondary-background, 0 140 203))` (brand blue), orb 36 × 36 px with `box-shadow: var(--msc-logo-rim-shadow) !important` (the variable is defined in `ms-chat-widget.css → .ms-chat-logo`). The wrapper `.ms-chat-product-advisor` has `margin: 9px 0 -12px 0`. Reduced-motion handling of the orb comes from the widget CSS.

### 3.4 Enabled state and gating

- The block renders when `settings.ai_advisor_enabled` is on. It does **not** check `ai_advisor_excluded_templates`.
- The widget JS and CSS load only when the snippet's render gate passes (`ai_advisor_enabled`, not cart/checkout, template not in `ai_advisor_excluded_templates`, and a non-empty `settings.ms_chat_shared_secret`; builds before `8d0a0c4` still loaded the JS with an empty secret, which then exited at boot).
- When `ai_advisor_enabled` is on but the gate fails (excluded template, cart/checkout, empty secret), `snippets/ms-chat-widget.liquid` outputs `<style>.ms-chat-product-advisor, .ms-chat-product-cta { display: none !important; }</style>` instead, so the CTA is **hidden**, not dead (`npm run verify:widget` looks for this style on `/cart`, `07` §6.4). Builds before `8d0a0c4` showed a dead CTA there: no JS handled the click and the orb had no styles.
- Remaining edge: if the widget JS fails to load, or a click happens before `DOMContentLoaded` + `init()` (the script is `defer`), the visible CTA does nothing. There is no queued click.

### 3.5 Click behaviour (`ms-chat-widget.js → openWithProduct(id, title)`)

1. `openPanel()`. If the panel was already open this is a no-op, so no second `chat_opened`.
2. `track('product_cta_opened', { productId: <numeric id> })`.
3. If a reply is streaming or the rate-limit lock is on: stop here (the panel is open, the user can type).
4. Build `context = { type:'product', productId:<handle or passed id>, productTitle:<title>, source:'cta' }` plus `recentlyViewed` from the local trail (max 3 products + 2 categories, `recentlyViewedPayload()`). The backend never holds a `cta` context out (API_CONTRACT.md §2).
5. `sendMessage(primer, context)`. Primer DE, verbatim: `Ich interessiere mich für „<Titel>". Kannst du mich zu diesem Produkt beraten?` (opening „, closing ASCII `"`, not `“`; this exact string is the user text the backend receives, relevant for primer detection or analytics). EN: "I'm interested in "<title>". Can you advise me on this product?". Without a title: „Kannst du mich zu diesem Produkt beraten?“.
6. Because it is a normal user turn, it appends to an existing conversation (the backend treats non-empty `messages` + context as a pivot, `API_CONTRACT.md §2`). Each click sends another primer. There is no de-duplication.
7. `sendMessage` also triggers the first-message popups (sign-in / consent gate, `04-accounts-sign-in-and-consent.md`) exactly like a typed first message.

It deliberately does **not** use the `messages: []` greeting path: the primer carries the title in text, so the consultation works even if the context id is dropped.

### 3.6 The legacy "USPs mit MO" block and the `produktdesign-02` variant

- `templates/product.json → custom_liquid_BGU8Mt` "USPs mit MO" is **disabled**. It renders `product.metafields.custom.kurzinfo` bullets and appends the same CTA button (captured into `ms_chat_cta_bullet`) under them in a `.product-kurzinfo` box. Its inline CSS gives the CTA `margin:10px 0 0 0` and re-asserts the orb rim against the box's `box-shadow:none !important` reset.
- `templates/product.produktdesign-02.json → custom_liquid_BGU8Mt` (named "USPs") contains the **same** kurzinfo + CTA code and is **enabled**. Products on that template get the CTA below the highlight bullets.

### 3.7 Template coverage

CTA and Q&A tab per product template: `01` §6.6 (owner). In short, all five product templates carry the CTA (the three alternates since `8d0a0c4`, placement §3.1) and only `product.produkte-im-set` has no Q&A tab. These files are live-editor owned, so check them after every sync (`07` §6.3).

---

## 4. The `custom.qa` metafield and the PDP Q&A tab

### 4.1 Who writes it

The backend admin "Wissen" tab (`QA_KNOWLEDGE.md`). Operators answer questions that Mo could not answer; "Veröffentlichen" writes the product-linked pair with Admin API `metafieldsSet` on `custom.qa` (`src/lib/shopify-qa.ts`), and "Zurückziehen" removes it (an empty list is written as `[]`). The serializer is `src/lib/qa-core.mjs`; the link renderer is `qa-links.mjs`. The cap is `QA_MAX_PER_PRODUCT = 20` (`qa-core.mjs`). On overflow the oldest entries are dropped. The merchandising team does not edit this metafield (`01-storefront-theme.md §13`).

Prerequisites (backend doc): the app needs `write_products`; a product metafield **definition** for `custom.qa` (type JSON) with **storefront access** must exist so Liquid can read it.

### 4.2 JSON schema (as the theme reads it)

An array, oldest first, max 20 entries rendered (`limit: 20` in Liquid):

| Key | Type | Required | Theme use |
|---|---|---|---|
| `q` | string (plain) | **yes** | German question. `strip_html | strip`, then `escape`d. |
| `a` | string (plain, may contain raw Markdown `[Text](URL)`) | **yes** | German answer fallback when `a_html` is absent. `strip_html | strip`, `escape`, `newline_to_br`. |
| `a_html` | string (pre-rendered HTML) | no | Only present when the answer contains a link. Output **raw** (no escaping) with `newline_to_br`. |
| `q_en` | string | no | English question. |
| `a_en` | string | no | English answer. |
| `a_en_html` | string | no | English pre-rendered HTML (only for answers with a link). |

Minimal example:

```json
[{ "q": "Ist das Laufband klappbar?", "a": "Ja, siehe [Laufband X](https://motionsports.de/products/x).",
   "a_html": "Ja, siehe <a href=\"https://motionsports.de/products/x\" target=\"_blank\" rel=\"noopener noreferrer\">Laufband X</a>.",
   "q_en": "Is the treadmill foldable?", "a_en": "Yes, see [Treadmill X](https://motionsports.de/products/x)." }]
```

### 4.3 The tab (`sections/tabs-cards.liquid`)

- Section `tabs_cards_tdGyxW` on `product.json`. The Q&A tab is added **after** the block tabs (Beschreibung, Details, Bewertungen, Zubehör on the default template), only when `section.settings.show_qa_tab` is true **and** at least one entry has non-empty `q` **and** `a` (after `strip_html | strip`).
- Label: `'products.product.qa_tab_label' | t` (de „Q&A“, en "Q&A"). Desktop: a tab button. Mobile: an accordion button with `data-tab-index`. The panel is `hidden` until selected.
- The tab is rendered only if the section has at least one block (`blocks.size > 0`).
- No anchor/deep link opens the Q&A tab directly, and nothing in it links to Mo.

### 4.4 Entry rendering (`snippets/product-qa.liquid`)

- Each valid entry becomes `<details class="product-qa__item">` with `<summary class="product-qa__question">` and `<div class="product-qa__answer">`.
- Under every answer: `<p class="product-qa__meta">` = `'products.product.qa_answered_by' | t` (de „Beantwortet vom motion sports Team“, en "Answered by the motion sports team").
- Rows alternate white / `#eee` (zebra on the whole `<details>`). The `+`/`−` marker is brand blue `#008ccb`. Anchors inside answers are styled brand blue + underline (`.product-qa__answer a`). Several `!important`s exist because `tabs-cards` styles `#section-<id> .panel-card p` with an ID selector.
- Entries with empty `q` or `a` are skipped silently. If no entry is valid, the snippet outputs nothing.

### 4.5 Escaping and the `a_html` trust boundary

- Questions are always plain text (`strip_html`, then `escape`).
- `a` / `a_en` are `strip_html`ped and escaped. Raw Markdown therefore shows as literal `[Text](URL)` text if `a_html` is missing for a linked answer.
- `a_html` / `a_en_html` are output **unescaped**. The theme trusts the backend: per `QA_KNOWLEDGE.md`, `qa-links.mjs` escapes every fragment and emits only `<a href="http(s)://…" target="_blank" rel="noopener noreferrer">`. Anything the backend writes into these keys becomes live HTML on the PDP. Keep the sanitiser as the only writer.
- Validity is decided on the **plain** `q`/`a` only. An entry with `a_html` but an empty `a` is not rendered.

### 4.6 Language selection and fallback

- `qa_use_en` is true when `request.locale.iso_code` starts with `en` (note: the widget snippet uses `localization.language.iso_code`; both should agree).
- Per entry on `/en`: if both `q_en` and `a_en` are non-empty, use them and `a_en_html` (may be blank → plain `a_en`). Otherwise fall back to the German `q`/`a`/`a_html`.
- Other storefront languages (`es`, `fr`, `it`, `nl` locale files exist, publication unknown) always show German. Their locale files lack the two `qa_*` keys, so the labels fall back to the English default locale file.

### 4.7 JSON-LD

The snippet also emits `<script type="application/ld+json">` with `@type: FAQPage`, one `Question` per valid entry, using the same language-resolved texts. For linked answers it uses `a_html | strip_html` (link text, no Markdown). Values go through Liquid `json`. Note (general knowledge, not from the repo): Google has restricted FAQ rich results to a small set of sites since 2023, so the SEO benefit may be limited. The markup is harmless.

### 4.8 Q&A and Mo

The same pairs reach Mo through the catalog sync (`Product.qa`, exposed as `qa` on `GET /api/products`). The widget does **not** read `qa` from `/api/products`. The PDP tab and Mo's answers stay consistent because both come from the same metafield.

### 4.9 Checklist for backend changes to `custom.qa`

- Keep it a JSON **array** of flat objects with the keys above. New keys are ignored by the theme.
- Keep max 20 in sync with the Liquid `limit: 20` (three places in `product-qa.liquid` (validity count, rendering, JSON-LD) and one in `tabs-cards.liquid`).
- Write `[]` (not a deleted metafield) to hide the tab. Both work in Liquid; `[]` is what the backend does today.
- Changing the HTML allowed in `a_html` (e.g. `<strong>`, lists) needs no theme change, but it is a security decision: the theme outputs it raw.
- Visibility after `metafieldsSet` may lag because of Shopify's storefront caching (not measured).

---

## 5. Product data the widget fetches (`GET /api/products`)

### 5.1 Requests

| Caller | Request | Notes |
|---|---|---|
| `hydrate(ids)` (used by `buildShowProduct`, `buildCompare`, `buildShowroom`, `buildContactForm`, `buildCaptureCard` (the `offer_email_summary` capture form, label „Im Warenkorb: …“ / "In cart: …")) | `GET {apiBase}/api/products?ids=<comma-joined, URL-encoded>` in chunks of 10, header `x-ms-session` only | In-memory `productCache` (id → product or `null`), page lifetime. Only a successful response is cached; a 429/network error caches nothing, so a later call retries. |
| `buildAddToCart(input)` | One `GET …/api/products?ids=<all ids>` | Dedicated fetch to get the top-level `cartUrl`. **No chunking**: more than 10 ids → `400 payload_too_large` → the card renders nothing. Warms `productCache` for ids not yet cached. |

**Restored history re-fetches on every page load.** `init()` → `renderAllMessages()` → `renderRestoredAssistant()` → `renderPartIntoCtx()` re-renders the stored thread (`loadHistory()`, last 40 messages) on every page load, whether or not the panel is ever opened. Every restored product/compare/showroom/contact/capture card calls `hydrate()` again (`productCache` is in-memory per page, so it starts empty), and every restored `add_to_cart` card makes its own uncached GET. So each page view of a visitor with stored history re-fetches the products of every restored card. This counts against the 60 req / 60 s `/api/products` bucket (`API_CONTRACT.md §3`), and a restored `show_product` card calls `moAttrOnProductCard()`, so a token can be minted and the cart stamped at page load without any interaction (§8.4).

No `x-ms-chat-key` is sent (the endpoint is origin-allowlisted only, `API_CONTRACT.md §3`). No locale is sent (`/api/products` reads none, `API_CONTRACT.md §12.2`). The custom `x-ms-session` header makes these GETs CORS-preflighted. Responses are cacheable for 60 s by contract.

### 5.2 Fields the widget uses

Which `/api/products` fields the widget reads, where, and which it ignores: `03` §7 (owner; definitions AC §3). Commerce-relevant details:

- `id` is always the base product handle, also for an entry requested as a variant ref (§2.3); the variant is only in `selectedVariantId`, which the widget ignores.
- `price` / `salePrice`: there is no check that `salePrice < price`.
- `inStock` is sync-fresh (daily sync + webhook refresh), not live.
- A missing `shopifyUrl` makes `productButton()` fall back to `href="#"` (F11).
- The top-level `cartUrl` drives the checkout button (§7.1).

Consequences:

- No variant selector in the chat. A variant ref's flat fields describe the chosen variant, but "Zum Produkt" links to the plain `shopifyUrl` (no `?variant=`), so the PDP opens on the **default** variant (`API_CONTRACT.md §3 "Product variants"` allows `shopifyUrl + "?variant=<id>"`).
- No review stars or price ranges in cards, although the data is there.

### 5.3 Price formatting (`ms-chat-widget.js → euro(value)`)

- `de`: `Number(value).toLocaleString('de-DE') + ' €'`. No fixed decimals: `512` → „512 €“, `99.9` → „99,9 €“ (not „99,90 €“).
- `en`: `toLocaleString('en-GB', { style:'currency', currency:'EUR' })` → "€99.90".
- The currency is always EUR. `product.currency` is ignored. The shop's money format and the market's currency are not used (§10).

---

## 6. Links the widget opens

All in-chat content links (product, checkout, showroom, Markdown, legal) open in a **new tab** with `rel="noopener noreferrer"`, so the chat tab stays on the current page. Exceptions: „Anmelden“ navigates the current tab to the backend login (`initiateLogin()` → `window.location.assign`), and the PDF summary (`download: 'motionsports-zusammenfassung.pdf'`) and data export (`download: 'motionsports-meine-daten.json'`) are same-tab `download` anchors.

| Link | Target | Built by | Tracked |
|---|---|---|---|
| "Zum Produkt" (product card, every compare column) | `product.shopifyUrl` (absolute `https://motionsports.de/products/<handle>`, German path) | `productButton()` | `product_cta_clicked { productId }` |
| "Zur Kasse" (add-to-cart card) | top-level `cartUrl` (`https://motionsports.de/cart/<v1>:1,<v2>:1`) → Shopify checkout | `buildAddToCart()` | `add_to_cart_clicked { productId, productIds }` |
| Fallback "Zum Produkt" / product name (add-to-cart card when `cartUrl` is null) | `shopifyUrl` | `buildAddToCart()` | `product_cta_clicked { productId }` |
| "Showroom ansehen" | `SHOWROOM_URL` = `CFG.showroomUrl` = `https://motionsports.de/pages/showroom-munchen-grobenzell` | `buildShowroom()` | `showroom_clicked { productIds }` |
| Markdown links in Mo's text | any `http:`, `https:` or `mailto:` URL (`safeHref()`) | `appendInline()` | **not tracked** |
| Consent-copy links (imprint, privacy) | served by `/api/consent-copy` | capture / consent cards | not tracked |
| "Anmelden" | top-level navigation (same tab) to `{apiBase}/api/auth/shopify/login?session=&return_url=` | `initiateLogin()` | `account_signin_started` |

The showroom URL is **not** a theme setting: it is a literal in `snippets/ms-chat-widget.liquid` (`showroomUrl:`), with the same literal as a JS fallback. Changing it needs a theme edit. It has no `/en` variant.

---

## 7. Cart integration

### 7.1 Checkout from the chat (`add_to_cart` card)

1. Tool input: `productIds` (preferred) or `productId`. Ids are trimmed, de-duplicated, order kept.
2. One `GET /api/products?ids=…` (§5.1). Unresolved ids are dropped. If nothing resolves → no card.
3. Card: optional `input.message`, one row per resolved product (thumb, name, price, sold-out note).
4. If `cartUrl` is present: one button „Zur Kasse“ / "Checkout" (class `ms-chat-btn--checkout`, cart icon) linking to `cartUrl`, `target="_blank"`, plus the caption „Direkt zur sicheren Kasse bei motionsports.de“. The label is deliberately „Zur Kasse“ because the permalink lands in checkout.
5. On click (the navigation is never delayed): `moAttrEnsure(false)` (mint if needed + re-stamp the **current** cart, §8), `track('add_to_cart_clicked', …)`, `pollCartAfterCheckout()`.
6. If `cartUrl` is null (no in-stock resolvable variant): secondary "Zum Produkt" links per product instead of a checkout button.

Facts from the backend contract (`API_CONTRACT.md §3`): `cartUrl` is built server-side from numeric variant ids (quantity 1 each), excludes sold-out products, never carries a discount, and is **not** marked with `attributes[_mo]` (the backend's `withCartAttribution()` is only used for email/bundle links, `ORDER_ATTRIBUTION.md`). It is an absolute URL on the apex domain `motionsports.de` without a locale prefix.

### 7.2 Keeping the chat tab's cart UI fresh (`refreshCartUI()`)

Problem it solves (MANIFEST 2026-06-21): the permalink fills the cart in the **other** tab; the chat tab keeps a stale header count and drawer.

- Request: `GET window.routes.cart_url` (= `{{ routes.cart_url }}.js`, locale-aware, from `layout/theme.liquid`), fallback `/cart.js`; `credentials: 'same-origin'`, `cache: 'no-store'`, `Accept: application/json`. **Display-only**: it never POSTs.
- Single-flight (`cartRefreshInFlight`). The first call seeds `cartCountKnown` from the rendered badge (`readBubbleCount()`).
- Always: `setCartBubble(item_count)`. Only when the count changed: `reloadCartDrawer()` + `reloadCartPageSection()`.
- Triggers: `visibilitychange` (becoming visible), `window` `focus`, `pageshow` (fires on every initial page load and on bfcache restores; the listener is registered in `buildShell()` during `init()`, which runs on `DOMContentLoaded` before `pageshow`), and after a „Zur Kasse“ click a bounded poll at **+1.2 s, +2.5 s, +4.5 s, +7 s** (`pollCartAfterCheckout()`).
- These triggers are armed on **every page where the widget renders**, whether or not Mo was used. Every page view where the widget renders makes one same-origin `/cart.js` GET at load (`pageshow`), plus one per focus or visibility return (single-flight, so near-simultaneous triggers collapse into one request). Together with the header script's own load-time read (§7.3) that is two `/cart.js` GETs per page view. The `?section_id=` drawer/page re-render GET happens only when `item_count` differs from the last known count.
- Change detection compares `item_count` only. A change of variant or line price with an equal count does not refresh the drawer.

### 7.3 Header badge sync (`#CartBubble`, `[data-fh-cart-bubble]`)

- `setCartBubble(count)` updates every `#CartBubble, [data-fh-cart-bubble]`: count > 0 → remove `hidden`, `textContent = count`; 0 → add `hidden`, empty text.
- `readBubbleCount()` reads `#CartBubble` only (`hidden` = 0).
- The header (`sections/header.liquid`) renders **two** badges: the desktop topbar copy (`data-fh-cart-bubble`, no id; only when the topbar is enabled) and the always-rendered mobile-icons copy (`id="CartBubble" data-fh-cart-bubble`). A header script mirrors `#CartBubble` onto the other badges with a `MutationObserver` and re-reads `/cart.js` on `cart:updated`, `cart:refresh`, `cart:change`, `product:added-to-cart`, `/cart/add` form submits and clicks on any element matching `[name="add"], button[type="submit"], .product-form__submit` (each of the last two re-reads at +600 ms and +1200 ms). That click selector is broader than add buttons: `button[type="submit"]` also matches the widget's own form buttons (contact form „Anfrage senden“ in `buildContactForm()`, the email-capture/consent submit in `buildCaptureCard()`, the feedback submit, the opt-in submit, the conversation-rename save; all created with `type: 'submit'`), so every click on one of them also triggers two same-origin `/cart.js` GETs from the header script. The header script also GETs `/cart.js` once on every page load (`DOMContentLoaded` → `updateHeaderCartBubble()`), independent of Mo.

### 7.4 Why `id="CartBubble"` matters (2026-10 fix)

The theme bundle `assets/main.mjs` updates the badge after every theme add-to-cart with `qe()`: `document.getElementById("CartBubble").classList…` with no null check. The live header redesign (synced 2026-07-25) dropped the id. After that `qe()` threw on every add, the product form swallowed the error, and **the cart drawer never opened** after Add-to-cart (quick-add did not refresh it either). The 2026-10-01 session put `id="CartBubble"` back on the mobile-icons badge and added the mirror observer (MANIFEST 2026-10-01, comment in `sections/header.liquid`). It is in `sections/header.liquid` of this build. Rule: exactly **one** element must carry `id="CartBubble"`, and it must always render. The widget also reads it.

### 7.5 Drawer refresh (`<cart-modal>.reloadContent()`)

`reloadCartDrawer()` calls `document.querySelector('cart-modal').reloadContent()` (theme custom element in `main.mjs`; it fetches `${location.pathname}?section_id=<drawer section>` and swaps the content). It does **not** open the drawer and fires no notification. Errors are swallowed. The theme itself calls `reloadContent` on `product:added-to-cart`.

### 7.6 Cart page re-render (`reloadCartPageSection()`)

Re-renders `.section-main-cart` via `?section_id=<id>` and `DOMParser`. Today this is **effectively dead code**: the widget is never rendered on `/cart` (hard exclusion in the snippet), so `.section-main-cart` is never present when the widget runs.

### 7.7 Stacking against the cart drawer and other theme modals

| Situation | Rule | Where |
|---|---|---|
| Any theme drawer/modal open (cart drawer, mobile menu, search, quick-add …) → theme sets `body.no-scroll` | Launcher and nudge fade out (`opacity:0; visibility:hidden; pointer-events:none`) | `ms-chat-widget.css → body.no-scroll .ms-chat-launcher`, `.ms-chat-nudge` |
| Desktop docked sidebar open + theme opens the cart drawer (e.g. after "In den Warenkorb" on the page next to the chat) | Sidebar drops to `z-index: 1800`, below the theme overlay (1900) and panel (2000), so the drawer slides in on top; back to the near-max z-index when the drawer closes | `ms-chat-widget.css → body.no-scroll .ms-chat-panel--sidebar` (desktop media query) |
| Theme modal z-index | Overlay `z-index: 1900` (`snippets/template-modal.liquid`); panel = overlay + 100 (`main.mjs → setZIndex`) | theme |
| Widget base z-index | `--msc-z: 2147483000` (launcher −1, panel, backdrop/dialogs +1) | `ms-chat-widget.css` |
| Desktop sidebar open | `<html>` gets `ms-chat-page-shift` (`margin-right: var(--ms-chat-sidebar-w)` = 436 px) so the page reflows beside the chat; at 641–749 px the fixed `sticky-header` is pinned too | `setPageShift()`, CSS |
| Desktop modal mode | Backdrop covers the page; the page is not interactive, so the drawer cannot be triggered | CSS |
| Mobile (≤ 640 px) | Chat is true fullscreen; `html.ms-chat-mobile-open` locks page scroll | `syncChrome()`, CSS |

Breaking assumptions: if the theme stops setting `body.no-scroll` while the drawer is open, or lowers its modal z-index below 1800, the docked sidebar will again cover the cart drawer (the bug fixed 2026-10-01).

### 7.8 What the widget does not do in the cart

- No AJAX add (`/cart/add.js`). The only add path is the permalink.
- No listener for the theme's `product:added-to-cart` (so no KPI and no attribution re-stamp after a theme add-to-cart).
- No cart-contents context sent to Mo.
- Not rendered on `/cart` (no Mo in the cart page; the cart **drawer** is reachable while the widget runs).

---

## 8. Order attribution stamp (`_mo` cart attribute)

This section is the one description of the widget's as-built attribution behaviour (mint, stamp, renewal §8.8, blanking §8.9); `01` §10 and `05` §10 point here. Purpose and backend side: `ORDER_ATTRIBUTION.md` and `API_CONTRACT.md §10`. In short, the order webhook reads the `_mo` note attribute and assigns the tiers "Direkt" (Mo code or Mo-built link), "Beraten & gekauft" (`assisted`: widget stamp + a purchased line matches a product discussed in the session) and "Beraten, anderes gekauft" (`influenced`: stamp, no match), within `MO_ATTRIBUTION_WINDOW_DAYS` (default 30) of the token's minting, or with the backend switch `MO_ATTRIBUTION_SESSION_ANCHOR` (default off in code; production state: `docs/ROLLOUT_TODO.md`) of the device's latest product consultation (`show_product`, `compare_products`, `add_to_cart`, `suggest_showroom` written by the token's own sid, never after the order). A marked order the backend cannot attribute (unknown token, outside the window) is only counted, as the server-only event `mo_order_marker_unresolved`.

### 8.1 Consent gate (`moAnalyticsAllowed()`)

True only if `window.Shopify.customerPrivacy.analyticsProcessingAllowed() === true`. It is checked before every mint and **again at stamp time** (consent can be withdrawn mid-page).

- The widget does **not** load the Customer Privacy API itself. It relies on the theme `<privacy-banner>` (which calls `Shopify.loadFeatures([{name:'consent-tracking-api'}])`) or Shopify's own banner.
- `initAttribution()` checks at init and again at about 1 s, 3 s, 6 s, 10 s and 15 s (delays of 1–5 s) while `window.Shopify.customerPrivacy` is missing. It stops as soon as the API exists (allowed → re-stamp; "not allowed" → stop). This loop only re-stamps a cached token and never mints.
- It listens to the document event `visitorConsentCollected` for the rest of the page view: if consent is now allowed and a token is cached or the session is "consulted", it calls `moAttrEnsure(true)`; if it is not allowed, it blanks the cart marker (`moBlankCart()`, §8.9).

### 8.2 Token mint

- `POST {apiBase}/api/attribution/token`, headers `x-ms-chat-key` + `x-ms-session`, **no body**, no `Content-Type`, no locale.
- Accepted response: `{ ok: true, token: <non-empty string>, cartAttributes: <plain object> }` (`moAttrValid()`). Anything else, or 401/403/429/5xx/network, sets `moAttrFailed` and gives up **for this page view** (a failed renewal does not, §8.8).
- Single-flight (`moAttrInflight`, shared with the renewal). Idempotent server-side: the same token per session while it exists; after a backend purge (retention) or erasure, a new one (`API_CONTRACT.md §10`).
- Cache: memory `moAttr` + `localStorage['ms-mo-attr']` = `{ sid, token, cartAttributes }`. `moAttrLoad()` discards an entry whose `sid` is not the current session id.
- When is a session "consulted" (mint allowed)? Only when a **`show_product` card renders** (`buildShowProduct → moAttrOnProductCard()`), including product cards re-rendered from restored history on page load. Compare tables, the showroom card and the add-to-cart card do **not** mark the session consulted; the add-to-cart **click** mints directly (`moAttrEnsure(false)`).

### 8.3 Stamp (`moStampCart()`)

```js
fetch('/cart/update.js', { method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({ attributes: cartAttributes }), keepalive:true })
```

Same-origin, root path (not `window.routes.cart_update_url`), fire-and-forget, errors swallowed. `cartAttributes` is passed through unchanged: today `{ "_mo": "<opaque token>" }`. `/cart/update.js` merges attributes. If no cart exists yet, Shopify creates one (an empty cart carrying the attribute).

### 8.4 When stamps happen

| Moment | Function | Mints? | Stamps? | Limit |
|---|---|---|---|---|
| First `show_product` card renders (stream or restored history) | `moAttrOnProductCard()` → `moAttrEnsure(true)` | yes, if no cached token | yes | at most one stamp per page load via the render path (`moAttrPageStamped`) |
| Page load with a cached token for this sid | `initAttribution()` tick → `moAttrEnsure(true)` | no | yes | once per page load |
| Consent arrives later (`visitorConsentCollected`) | `moAttrEnsure(true)` | if consulted and no token | yes | once per page load |
| Click on „Zur Kasse“ | `moAttrEnsure(false)` | yes, if no token and no mint in flight or failed | every click when a token is cached and consent allows. Without a cached token it mints, and the stamp follows the mint response. No stamp from the click if a mint is already in flight (that mint stamps once when it resolves) or if a mint already failed on this page view (`moAttrInflight` / `moAttrFailed`) | per click, subject to those conditions |
| A streamed turn with a consultation tool part finished cleanly, token cached | `finalizeStream()` → `moAttrRenew()` (§8.8) | asks again; the backend returns the same token or a replacement | only when the token changed | once per page view (`moAttrRenewed`) |
| Theme add-to-cart, quick-add, cart drawer changes | — | — | **no** | — |

**Restored history mints without a click.** `init()` → `renderAllMessages()` → `renderRestoredAssistant()` re-renders a stored `show_product` card on every page load (before `initAttribution()`), panel open or not. So a device whose stored transcript (`localStorage['ms-chat-history:<sid>']`) holds a product card can mint and stamp without any interaction, and the page counts as consulted for the `visitorConsentCollected` listener. The mint on load happens only if the Customer Privacy API already reports consent when the card's `/api/products` hydration resolves (`moAttrEnsure()` returns at once while `moAnalyticsAllowed()` is false, including "API not loaded yet"); otherwise there is no mint on that page view unless the visitor answers the consent banner. A „Zur Kasse“ click never waits for the stamp: the permalink opens in parallel.

### 8.5 Reset

`moAttrReset()` (memory + `ms-mo-attr`) runs inside `rotateSession()` ("Neuen Chat starten" for anonymous/email-only, `mo_new=1` only without a signed-in hint, sign-out, erase, server-confirmed end of sign-in). Adopting another tab's sid (`dropSessionHistory(adoptSid)`) clears only the in-memory attribution state (`moAttr`, `moAttrFailed`, `moAttrConsulted`); the stored `ms-mo-attr` was already removed by the rotating tab, and `moAttrLoad()` ignores an entry for another sid. For a possibly signed-in visitor (`shouldProbeAuth()`), `mo_new=1` keeps the sid and its token and only drops the local thread (`handleMoDeepLink()`). **The cart attribute already on the Shopify cart:** sign-out, erase and a server-ended sign-in blank it before the rotation drops the cached token, and a consent withdrawal blanks it too (§8.9). After the other rotations — anonymous „Neuen Chat starten“, `mo_new=1` without a signed-in hint, adopting another tab's sid — the live cart keeps the old token until a new stamp overwrites it, so on a shared browser a later order can still be tied to the previous session — with the backend switch for longer than 30 days from minting (ANWALTSDOSSIER §20, F-37 (b)).

### 8.6 Privacy facts

- The attribution flow never puts the raw session id into a URL or a cart attribute (only the opaque token from `/api/attribution/token` goes onto the cart).
- Elsewhere the raw sid does travel in URLs: same-origin `/apps/chat/whoami?session=<sid>` (`detectViaStorefront()`; visible to Shopify and the App Proxy), `{apiBase}/api/auth/me?session=<sid>` (`probeAuth()`), and the top-level sign-in redirect `{apiBase}/api/auth/shopify/login?session=<sid>&return_url=<current URL>` (`initiateLogin()`).
- What Shopify sees: a cart/order note attribute `_mo` with an opaque value (visible in the order in Shopify admin, to apps that read orders, and in `/cart.js` to any script on the page).
- No stamp, no mint without analytics consent.
- Backend erasure deletes the session's tokens, so a later order with an erased token is not attributed (`ORDER_ATTRIBUTION.md` GDPR section).
- The backend doc flags a **lawyer check** (privacy policy mention) before relying on the widget stamp.

### 8.7 Behaviour worth knowing for KPI interpretation

- **Long-lived stamping**: the session id lives in `localStorage` with no expiry, so a device keeps re-stamping every new cart on every page load until the session rotates. The backend's 30-day window is what bounds "influenced"/"assisted" (from the minting, or with `MO_ATTRIBUTION_SESSION_ANCHOR` from the device's latest product consultation). The backend also deletes the token: 37 days after minting, or with the switch 37 days after the device's last product consultation and at most 180 days after minting; erasure at once. The widget keeps stamping the cached dead token, and those orders count as `unknown_token`, until a page view with a live consultation turn renews it (§8.8) or the sid rotates; a device that only reloads its restored history never renews. Tokens purged before 2026-10-05 are not recoverable by the backend.
- **Card builds are not cancelled on a sid rotation.** `renderPartIntoCtx()` calls `buildToolCard(…).then(…)` and nothing cancels it, and `buildShowProduct()` calls `moAttrOnProductCard()` inside `hydrate().then()`, i.e. after an async `GET /api/products`. On a campaign landing with `mo_new=1` (`05` §9.2 b), `init()` first runs `renderAllMessages()`, which starts hydration of the stored thread's `show_product` cards; `handleMoDeepLink()` then runs synchronously: `rotateSession()` → `moAttrReset()`, then `renderAllMessages()` (empty). When the old cards' hydration resolves, `moAttrOnProductCard()` sets `moAttrConsulted = true` and `moAttrEnsure(true)` mints a token for the **new** sid and stamps the cart (consent permitting), although the visitor has not consulted in the new session and the thread was deleted. Orders then count as Mo-influenced for that session. (The same applies to the signed-in-hint branch, which keeps the sid but drops the thread.)
- **A mint in flight during a rotation is cached under the new sid.** `moAttrEnsure()` builds the cache entry as `{sid: sid, …}` from the module variable when the **response** arrives, so a token minted under the old `x-ms-session` is stored and stamped as the new sid's token. `moAttrReset()` does not clear `moAttrInflight`. The fix for both (capture `sid` before `hydrate()` / before the mint `fetch` and skip `moAttrOnProductCard()` / the cache write when it changed) is backlog `07` D17. The renewal already does this (it captures `reqSid` and drops a reply for a rotated sid, §8.8).
- **Only `show_product` marks a session as consulted** (§8.2, F2): a consultation that shows only a comparison table, a showroom card or an add-to-cart card (before its click) mints no token and stamps nothing.
- **The theme's own add-to-cart is not observed** (§7.8, F7): re-stamping after a completed checkout relies on the next page load of a widget page.
- **Consent ceiling**: unconsented visitors are never stamped, and no event measures consent coverage, so the share of consultations that can be attributed at all is unknown.
- Purchases on another device stay invisible (stated residual in `ORDER_ATTRIBUTION.md`).
- **Permalink gap (likely NOT attributed, unverified)**: the „Zur Kasse“ permalink itself carries no `_mo`. A cart permalink builds its own cart/checkout, so the `_mo` attribute stamped via `/cart/update.js` probably does not carry over to that checkout. MANIFEST 2026-06-21 shows only that the permalink changes the storefront cart count, not that attributes survive. Verify with one test order (order `note_attributes`, §17). The fix path is F1/T1. On the first click of a session with no token, the mint is still in flight when the new tab opens, so the stamp may land after the permalink created its cart.
- **No client KPI** exists for mint/stamp success, so the stamp rate cannot be measured from `kpi_events`.

### 8.8 Renewal after a live consultation (`moAttrRenew()`, since `bc7fb5d`)

Contract: `API_CONTRACT.md §10` „Lifetime and renewal“ (the endpoint returns the same token while it exists and a new one after a purge or erasure).

- **Trigger:** `finalizeStream()` of a streamed `/api/chat` turn (typed, CTA primer or nudge greeting) that finished without an SSE error, under the sid it was sent for, whose assistant parts contain a `tool-show_product`, `tool-compare_products`, `tool-add_to_cart` or `tool-suggest_showroom` part (`MO_CONSULT_PARTS`, `hasConsultationPart()`). Never from restored history or a page load.
- **Preconditions:** analytics consent (`moAnalyticsAllowed()`), a cached token for the current sid (`moAttrLoad()`; without one the card render mints as before, §8.2), no mint or renewal in flight, and no renewal yet on this page view (`moAttrRenewed`, set when the request starts).
- **Request:** the same `POST /api/attribution/token` as the mint (`x-ms-chat-key`, `x-ms-session` = the sid at call time, no body).
- **Outcome:** a valid reply with a **different** token replaces memory + `localStorage['ms-mo-attr']` and stamps the cart (consent re-checked in `moStampCart()`). The same token: nothing to do. A failure (non-2xx, invalid body, network): the cached token stays and `moAttrFailed` is **not** set, so the checkout click keeps stamping it. A reply that arrives after the sid rotated is dropped.
- **Ordering with the render stamp:** while the renewal runs (`moAttrRenewing`), a card-render stamp is deferred (`moAttrStampDeferred`) so it cannot land after the renewal's stamp and put the old token back; if the renewal did not stamp, the deferred stamp is made up once it finishes. The checkout click (`moAttrEnsure(false)`) stamps the cached token immediately as before.
- No KPI event, no UI. Effect on the numbers: `05` §10.4.

### 8.9 Ending the marker (`moBlankCart()`, since `bc7fb5d`)

Contract: `API_CONTRACT.md §10` „Ending the marker“.

- **What:** `POST /cart/update.js` (same origin, root path, `keepalive`, fire-and-forget, errors swallowed) with every key of the **cached** `cartAttributes` set to `""` — today `{ "_mo": "" }`. The widget never hard-codes the key; without a cached entry for the current sid (nothing minted, or another tab rotated first) it sends nothing.
- **When:** `signOut()` („Abmelden“), `clearAfterErase()` (erase answered 200, or 401 = session already gone), `endedSignInCleanup()` (a signed-in session the server reports ended on an `/api/auth/me` probe, or any `/api/account/*` 401 on a device that was signed in, `accountUnauthorized()`) — each **before** `dropSessionHistory()` rotates the sid and drops the cached token — and on `visitorConsentCollected` when analytics processing is no longer allowed.
- **Not consent-gated** (it removes a marker and sends nothing for analytics).
- **Not blanked:** anonymous „Neuen Chat starten“, a `mo_new=1` rotation, adopting another tab's rotation (the rotating tab blanked if it was a sign-out or erase), and a consent state that is already "not allowed" at page load without a `visitorConsentCollected` event on that page (the stamp then simply stops, §8.1).
- Observed on live by the frontend agent on 2026-10-06: after „Abmelden“ in the chat, `/cart.js` no longer lists `_mo` (Shopify drops an attribute set to `""`).

---

## 9. Shopify customer login vs Mo sign-in

Details are in `04-accounts-sign-in-and-consent.md`. This section shows only how the two worlds meet on the storefront.

| Aspect | Shop login (Online Store customer account) | Mo sign-in („Anmelden“ in the chat) |
|---|---|---|
| Entry point | Header account icon `a.header-auth-btn` → `routes.account_url` (rendered only if `shop.customer_accounts_enabled`; one in the topbar, one in the mobile icons) | Chat header pill, welcome sign-in card, first-message popup, account menu |
| Mechanism | Shopify customer accounts (classic vs new accounts not determinable from the repo) | Backend OAuth (Customer Account API, PKCE) via `{apiBase}/api/auth/shopify/login`, return with one-time `?ms_code` redeemed at `POST /api/auth/link` (ACCOUNT_CONTRACT.md §2a) |
| What the widget reads | `ShopifyAnalytics.meta.page.customerId` as a **hint only** (`storefrontCustomerHint()`): it makes the widget call `/api/auth/me`. It never establishes identity. | `/api/auth/me` |
| Bridge | `GET /apps/chat/whoami?session=<sid>` (same-origin, `credentials:'include'`), once per **tab** session (sessionStorage `ms-chat-whoami-done`, `detectViaStorefront()`), on the first panel open in that tab. sessionStorage is per tab, and Mo's product/checkout links open with `target="_blank"` + `rel="noopener"`, so such tabs do not inherit it: every new tab where the panel is opened makes one more whoami request. A JSON answer with `signedIn:true` and a `linkCode` is redeemed (`redeemLinkCode(code,'shop')`). | — |
| Widget touches the shop account UI? | No. The widget never modifies or reads the header account icon and never links to `/account`. Mo's text may contain an `ordersPageUrl` link (order status, `API_CONTRACT.md §2` „Tools the widget MUST NOT render“). | — |

Order status (`get_order_status`) works only for sessions signed in via „Anmelden“ (`link_kind = customer_account`, `src/lib/order-status-core.mjs`). A shop-recognised session gets `sign_in_required` with `signedInViaShop: true`; the widget renders nothing for the tool and keeps „Mit Kundenkonto anmelden“ in the account menu for that case (`updateShopSignInBtn()`; ACCOUNT_CONTRACT.md §3a). The feature sits behind the backend switch `CHAT_ORDER_STATUS_ENABLED` (default off in code; production state: `docs/ROLLOUT_TODO.md`).

Uncertain: whether a Mo sign-in also leaves the shopper logged in to the Online Store (or the reverse). Nothing in the repo shows it; treat the two sessions as independent.

### 9.1 App Proxy: behaviour without and with it

- **Without it** (not configured in the shop): `/apps/chat/whoami` returns Shopify's HTML 404 page. The widget rejects it (`!r.ok`, or a content type without `application/json`) and silently continues anonymously. Side effect: each tab session downloads that 404 page once on the first panel open in that tab (including tabs opened from Mo's product links), and the sign-in affordance appears only after that round trip.
- **With it**: Shopify signs the request and forwards it to the backend's `/api/auth/storefront/whoami`, adding the logged-in customer id; the backend checks the signature with `SHOPIFY_APP_PROXY_SECRET` (falls back to `SHOPIFY_CLIENT_SECRET`). While `APP_PROXY_SIGNIN_ENABLED` is off (default off in code) it answers `{"signedIn":false}` but still records `account_shop_recognised` for a logged-in shop customer (`noCode: "flag_off"`); with the switch on it issues a code under the rules summarised in `04` §5.4. Contract: ACCOUNT_CONTRACT.md §3a; backend as-built: `docs/CUSTOMER_ACCOUNT.md` §2 „Already-signed-in detection“. The manual check `https://www.motionsports.de/apps/chat/whoami?session=livecheck-manual` while logged in to the shop, read with `npm run verify:live` section 8, shows whether `logged_in_customer_id` arrives for this store's account mode.
- **Drift risk**: only a widget build that redeems `linkCode` is safe with the proxy on (`04` §5.4).
- **Setup steps and live state**: `docs/ROLLOUT_TODO.md` 5.4 (App Proxy in a new Dev Dashboard app version; 5.4b holds the CLI / `shopify.app.toml` route).
- **No theme change needed**: the path default is `CFG.whoamiPath || '/apps/chat/whoami'`. The snippet does not set `whoamiPath`, so a different proxy path would need a snippet change.

---

## 10. Locales, markets, prices and currency

| Aspect | Behaviour | Location |
|---|---|---|
| Widget locale | `CFG.locale` from `localization.language.iso_code` (fallback `request.locale.iso_code`), normalised by `msNormLocale` to `en`/`de` (default `de`); a path starting `/en` forces `en` | `ms-chat-widget.liquid`, `ms-chat-widget.js → LOCALE` |
| Locale on commerce calls | `/api/products`, `/api/attribution/token`, `/api/kpi`, `/cart/*` carry **no** locale | — |
| Cart routes | `/cart.js` read uses `window.routes.cart_url` (locale-prefixed, e.g. `/en/cart.js`); the stamp uses root `/cart/update.js` | `cartJsUrl()`, `moStampCart()` |
| Product links on `/en` | `shopifyUrl` is the German path without `/en`, so an English shopper lands on the **German** PDP in the new tab | backend catalog |
| Checkout permalink on `/en` | No locale; the checkout language is decided by Shopify (not verified) | backend `cartUrl` |
| Showroom link | German page, no `/en` variant | snippet literal |
| PDP CTA label | German literal on `/en` | `templates/product.json` |
| Q&A tab | EN pair when both `q_en`/`a_en` exist, else German | `product-qa.liquid` |
| Product names / specs in cards | German catalog data on both locales (`API_CONTRACT.md §12.4`) | backend |
| Price formatting | EUR always; `de` „1.234,5 €“ (no fixed decimals), `en` "€1,234.50" | `euro()` |
| Market currency | Not supported. `currency_code_enabled` is `false`; `config/markets.json` is empty in the repo; whether other markets/currencies are active is unknown. If a non-EUR market exists, chat prices (EUR, catalog) would differ from PDP prices (converted). | `config/settings_data.json` |
| Price freshness | Catalog prices from the daily sync (plus targeted refreshes); a price change in Shopify shows in the chat only after the next sync | backend |

---

## 11. Shop → Mo entry links (campaign deep links)

Owned by `05-engagement-and-kpi.md` §9 (parameters, processing order, the head-script stash on pages without the widget, what counts as a campaign chat) and `01-storefront-theme.md §15` (the full parameter table). Commerce-relevant: `?mo=open` on a PDP opens Mo there without product priming (`05` §9.2 e), and after it no nudge appears in that tab session; campaign deep links should target a widget page, not `/cart` (`05` §9.1); `utm_*` are left untouched for the shop's analytics.

---

## 12. Storefront DOM hooks and globals the widget depends on

| Hook / global | Provided by | Widget use | What breaks if the theme changes it |
|---|---|---|---|
| `window.MS_CHAT_CONFIG` (`apiBase`, `chatKey`, `showroomUrl`, `allowedFromTheme`, `locale`, `pageContext`) | `snippets/ms-chat-widget.liquid` | All config. The JS reads `CFG.apiBase`, `CFG.chatKey`, `CFG.showroomUrl`, `CFG.locale`, `CFG.pageContext` and the optional `CFG.whoamiPath` (default `'/apps/chat/whoami'`; read but not emitted by the snippet). `allowedFromTheme` is emitted but never read by the JS | Missing → backend defaults, empty chat key (401s), no page context |
| `{% render 'ms-chat-widget' %}` before `</body>` | `layout/theme.liquid` | Loads CSS/JS | Removed in a live sync → no Mo anywhere |
| `<head>` stash script (`ms_auth`, `ms_code`, `mo_c` → `sessionStorage['ms-chat-early-params']`) | `layout/theme.liquid` (PR #73) | `earlyParam()` | Without it the params are still read from the URL, but analytics see them first (privacy regression) |
| `window.Shopify.customerPrivacy.analyticsProcessingAllowed()` | Shopify Customer Privacy API (loaded by `<privacy-banner>` or Shopify's banner) | Attribution consent gate | API not loaded → attribution silently off for everyone |
| `document` event `visitorConsentCollected` | Shopify | Late consent → stamp; withdrawn consent → blank the marker (§8.9) | Attribution only from the next page load; a withdrawal leaves the marker on the cart |
| `window.ShopifyAnalytics.meta.page.customerId` | Shopify `content_for_header` | Shop-login hint → `/api/auth/me` probe | Hint lost; recognition depends on the App Proxy or the local signed-in flag |
| `window.routes.cart_url` (with `.js` suffix) | `layout/theme.liquid → window.routes` | `/cart.js` read | Falls back to `/cart.js` (fine); a route **without** `.js` would return HTML and break the read silently |
| `GET /cart.js` → `item_count` | Shopify AJAX cart | Badge reconcile | — |
| `POST /cart/update.js` | Shopify AJAX cart | Attribution stamp and its blanking (§8.9) | — |
| `#CartBubble` (exactly one, always rendered) with `.hidden` = empty | `sections/header.liquid` (mobile icons badge) | `readBubbleCount()`, `setCartBubble()`; also required by the theme's `qe()` | Missing id → theme add-to-cart throws, drawer never opens (§7.4); widget reads 0 |
| `[data-fh-cart-bubble]` | `sections/header.liquid` (both badges) | `setCartBubble()` | Visible desktop badge stays stale after a chat checkout |
| `<cart-modal>` with `reloadContent()` | `sections/cart-modal.liquid` + `main.mjs` | `reloadCartDrawer()` | Drawer shows stale contents until reload (no error) |
| `.section-main-cart` + `shopify-section-<id>` + `?section_id=` | theme cart page | `reloadCartPageSection()` | Nothing today (widget not on `/cart`) |
| `body.no-scroll` (theme scroll lock while any drawer/modal is open) | `main.mjs` (`document.body.classList.add("no-scroll")`) | CSS: hide launcher/nudge, sidebar to `z-index:1800` | Launcher covers the mobile drawer's „Zur Kasse“; the sidebar buries the cart drawer |
| Theme modal z-index 1900 / 2000 | `snippets/template-modal.liquid`, `main.mjs → setZIndex` | Sidebar's 1800 must stay below | A theme value < 1800 would put the drawer under the sidebar again |
| `sticky-header` element, `position: fixed` at 641–749 px | `sections/header.liquid` | CSS page-shift pin | Header overlaps the sidebar in that band |
| `<html>` margin reflow | — | `html.ms-chat-page-shift` | Fixed/`100vw` theme elements ignore the margin and slide under the sidebar |
| `.ms-chat-product-cta` + `data-ms-chat-product-id` / `-title`; empty `.ms-chat-logo` spans; wrapper `.ms-chat-product-advisor` | product templates | `bindProductCtas()`, orb fill in `init()`; the snippet hides `.ms-chat-product-advisor` / `.ms-chat-product-cta` where the widget does not mount (§3.4) | Renamed class → dead CTA, and no longer hidden on non-mounting pages |
| CSS vars `--color-base-foreground`, `--button-secondary-background` | theme | CTA inline style | Fallback colours apply |
| Liquid: `request.page_type`, `template`, `product.*`, `collection.*`, `localization.language.iso_code` | Shopify | Render gate, page context, locale | — |
| `/apps/chat/whoami` | Shopify App Proxy (§9.1; whether it is set up: `docs/ROLLOUT_TODO.md` 5.4) | Shop recognition | Enabled under a build that does not redeem `linkCode` (e.g. after a live-editor revert) → signed-in UI with 401s on `/api/account/*` (`04` §5.4) |
| `storage` events, `history.replaceState`, `visualViewport` | browser | multi-tab, URL cleanup, mobile keyboard | — |

Theme events the widget does **not** use (but could): `product:added-to-cart` (dispatched by `main.mjs` after product-form, quick-add and sticky add-to-cart; detail `{ id, quantity }`, where `id` is the numeric Shopify **variant** id (the product form's `[name=id]` value / the quick-add variant, the same value `main.mjs` puts into `sections_url: …/variants/<id>`) and `quantity` is the added quantity. The event carries no handle, so a listener can build `handle~variantId` refs only with a variant → handle lookup), `cart:updated` / `cart:refresh` / `cart:change` (listened to by the header script; dispatched by `snippets/product-detail-accordions.liquid` (`cart:updated`, `cart:refresh`, recommendations quick-add) and `blocks/ai_gen_block_677224a.liquid` (`cart:refresh`, `cart:change`, plus `ajaxProduct:added` with `source: 'premium-collection-grid'`); see `01-storefront-theme.md §8.3`), `order-note:updated`.

---

## 13. What leaves the browser (commerce scope)

| Request | Destination | Data | When |
|---|---|---|---|
| `GET /api/products?ids=` | backend | catalog ids, `x-ms-session` | each product/compare/showroom/contact/capture (`offer_email_summary`) card not yet cached, each add-to-cart card (always uncached); restored cards re-fetch on **every page load** for a visitor with stored history, panel open or not |
| `POST /api/attribution/token` | backend | `x-ms-chat-key`, `x-ms-session` | Analytics consent required. Triggers: first `show_product` render (stream or restored history, panel open or not), a „Zur Kasse“ click (even if not consulted), late consent (`visitorConsentCollected`) on a page where a product card rendered, or the renewal after a live consultation turn with a cached token (once per page view, §8.8). Idempotent per sid and cached in `localStorage['ms-mo-attr']`. A failed mint is abandoned only for that page view (`moAttrFailed` is in-memory), so the next page view's trigger retries |
| `POST /cart/update.js` | Shopify (same origin) | `{ attributes: { _mo: token } }`; blanking: `{ attributes: { _mo: "" } }` | §8.4; blanking §8.9 (not consent-gated) |
| `GET /cart.js` | Shopify (same origin) | cart cookie | widget: every page load (`pageshow`) + focus / visibility / post-checkout poll. The header script makes its own `/cart.js` GET on every page load as well (§7.3), so widget pages make two per view |
| `GET ?section_id=` (drawer / cart page re-render) | Shopify (same origin) | cart cookie | only when `item_count` differs from the last known count |
| `GET /apps/chat/whoami?session=<sid>` | Shopify → App Proxy → backend (adds `logged_in_customer_id`) | session id | once per tab session (sessionStorage `ms-chat-whoami-done`), first panel open in that tab |
| `POST /api/chat` with `context` | backend | product handle/title, ≤ 3 trail products + ≤ 2 categories (CTA, nudge); the page's product handle/title or collection handle/title only (typed turn, `source:"page"`) | on a CTA or nudge click, or with the first typed or spoken message per product / collection page (§2.4); always inside a request the user starts |
| `POST /api/kpi` | backend | event name, session id, ids (§14) | on clicks |
| Opening `cartUrl` / `shopifyUrl` / showroom | Shopify | standard navigation (new tab) | on click |

The browsing trail (`localStorage['ms-chat-trail']`, 5 entries, 3-day TTL) is never sent except inside a user-initiated CTA or nudge request; a typed turn's page context never carries it.

---

## 14. KPI events in this chapter's scope

`product_cta_opened`, `product_cta_clicked`, `add_to_cart_clicked`, `showroom_clicked` and `chat_opened` — `data`, triggers, the two id spaces and the sold-out caveat of `add_to_cart_clicked` — are catalogued in `05-engagement-and-kpi.md` §4.1 and §4.4, the widget-side index (contract: `API_CONTRACT.md §5`). Name new events against the dashboard patterns (`%product%click%`, `%cta%click%`, `%cart%`, `%checkout%`; `API_CONTRACT.md §0` rule 15, `05` §12).

Not tracked in this scope: theme add-to-cart, checkout completion (that comes from the order webhook), Markdown links in Mo's text, Q&A tab interactions, attribution mint/stamp outcomes, whoami outcome.

---

## 15. Changing the storefront without a theme deploy

Complements `01-storefront-theme.md §17`.

### 15.1 Possible today (backend deploy, Admin API or Shopify admin only)

| Lever | Effect on the storefront | Notes |
|---|---|---|
| `custom.qa` via `metafieldsSet` | Q&A tab rows + FAQPage JSON-LD; `[]` hides the tab | §4. `a_html` is raw HTML on the PDP. |
| `/api/products` response | Every chat card: names, prices, images, stock badges, links, `cartUrl` | Only the fields of `03` §7 render (§5.2). Changing `shopifyUrl` (e.g. adding `/en` or `?variant=`) changes where "Zum Produkt" goes, with no widget change. |
| `cartUrl` content | What „Zur Kasse“ buys and carries | Could carry `attributes[_mo]` / `ref=mo` / a `discount=` code — but `/api/products` is public, session-less and cacheable 60 s, so a per-session token cannot be put there safely. A per-session marker needs a widget change (§16, T1). |
| `cartAttributes` from `/api/attribution/token` | Keys/values stamped on the cart and the order | Must stay a flat object. |
| Product `template_suffix` (Admin API) | Moves a product to another PDP layout; every product template of this build carries the Mo CTA (§3.7), only `product.produkte-im-set` lacks the Q&A tab | Changes the whole PDP layout. Owner decision. |
| Merchandising metafields (`custom.kurzinfo`, complementary products, badges …) | PDP content next to the CTA | Owned by merchandising; do not write without an explicit decision. |
| Automatic discounts / discount codes | Prices in cart and checkout (not in chat cards) | Chat cards show catalog prices only. |
| App Proxy configuration | Shop-login recognition (§9.1) | One-time app config plus the backend switches (default off in code); no theme change. Steps and state: `docs/ROLLOUT_TODO.md` 5.4; drift risk `04` §5.4. |
| Deep links (`mo=open`, `mo_c`, …) | Open Mo from emails, ads, QR codes | §11. |
| Theme settings (`config/settings_schema.json` "AI Advisor": `ai_advisor_enabled` (default off), `ai_advisor_backend_url`, `ms_chat_shared_secret` (snippet → `chatKey`), `ai_advisor_excluded_templates` (default `cart`)) | Kill switch, backend URL, secret, excluded templates | Changed in the theme editor by a person. Writing `settings_data.json` through the Admin Asset API is technically possible with `write_themes` (scope status unknown) but bypasses the manual deploy model and the live editor; not recommended. |

### 15.2 Needs a theme change (frontend task + manual upload)

- Anything in the widget backlog `07` §7 (variant context, `/en` link rewrite, permalink marker, theme add-to-cart listener, …; mapped from §16's task ids).
- A configurable CTA label / English label / per-product visibility. A one-time theme change could read a backend-owned metafield namespace (e.g. a hypothetical `mo.cta_label`, `mo.cta_hidden`) so later changes need only `metafieldsSet`. Owner decision; nothing like this exists today.
- More page facts in `pageContext` (variant id, price, availability, a customer flag as a hint).
- CTAs on other templates or sections (most are live-editor owned).
- A showroom URL setting (today a snippet literal).

---

## 16. Findings, risks and suggested frontend tasks

Findings (code facts of this build; F3 and F9 are fixed, F8 partly; the numbers stay so references stay stable):

- **F1 — In-chat checkout permalink carries no attribution marker.** `cartUrl` has no `attributes[_mo]`, and the widget stamps the **current** cart instead. If the permalink's checkout does not inherit those attributes (unverified), Mo's most direct purchase path would be attributed only through product matching on a stamp that may not exist. On the first click without a cached token the mint races the navigation.
- **F2 — Session becomes "consulted" only via `show_product` cards.** Sessions whose consultation shows only compare tables, a showroom card or an add-to-cart card are not minted until a checkout click. Purchases after such sessions via search or theme add-to-cart stay unattributed.
- **F3 — Fixed (`bc7fb5d`): product context on a plain first message on a PDP.** The first typed or spoken message per product (or collection) page carries the page facts with `source:"page"` (§2.4); Mo uses them only with `CHAT_PAGE_CONTEXT_ENABLED` (default off in code; `07` A3 in „Done“).
- **F4 — Variant is never known.** Neither the PDP's selected variant nor in-chat variants are used; "Zum Produkt" opens the default variant. The `/api/products` `id` is the base handle even for a variant ref (only `selectedVariantId`, ignored, carries the variant), so no product KPI event ever carries the variant.
- **F5 — `/en` shoppers are sent to German pages** (product links, showroom, checkout permalink without locale). The PDP CTA label is German on `/en`.
- **F6 — Different id spaces in KPIs**: `product_cta_opened` uses numeric ids, all other product events use catalog handles (always handle-level, never `handle~variantId`, §2.3).
- **F7 — No re-stamp after theme add-to-cart (improvement, not a contract gap).** The widget meets the contract's re-stamp rule (`API_CONTRACT.md §10`: "re-stamp before opening any Mo cart link and after each `add_to_cart` click", i.e. the Mo `add_to_cart` tool card): it stamps on every „Zur Kasse“ click (`buildAddToCart()` → `moAttrEnsure(false)`) and once per page load. The contract does not ask it to observe the theme's add-to-cart. It does not listen to `product:added-to-cart`, so a cart that a completed checkout cleared is re-stamped only on the next page load of a widget page; T5 would close that small gap. A stamp is also never re-applied if Shopify drops attributes for other reasons.
- **F8 — Stale `_mo` after session rotation (partly fixed in `bc7fb5d`).** `moAttrReset()` clears the local cache but not the cart attribute. Sign-out, erase, a server-ended sign-in and a consent withdrawal now blank the marker first (§8.9). Still open: after an anonymous "Neuen Chat starten" or a `mo_new=1` rotation the live cart carries the old token until a new stamp; that token stays valid, so a purchase after the new consultation may count for the old session.
- **F9 — Fixed (`8d0a0c4`): dead CTA where the widget does not mount.** The snippet hides `.ms-chat-product-advisor` / `.ms-chat-product-cta` on excluded templates, cart/checkout and with an empty shared secret, and no longer loads the JS without a secret (§3.4). Remaining edge: the CTA still does nothing if the JS fails to load or is clicked before the deferred script booted.
- **F10 — `add_to_cart` with more than 10 ids renders nothing** (no chunking in `buildAddToCart`; the backend cap is 10).
- **F11 — `productButton()` falls back to `href="#"`** with `target="_blank"` when `shopifyUrl` is missing: this opens a second copy of the current page in a new tab (full reload, widget included) and still fires `product_cta_clicked`.
- **F12 — German price format has no fixed decimals** („99,9 €“).
- **F13 — `reloadCartPageSection()` is unreachable** while `/cart` is excluded.
- **F14 — Stale theme comment**: `snippets/ms-chat-widget.liquid`'s header comment still points at `docs/ai-advisor/*`. (The archived `WIDGET_SPEC.md` §6 / §9a described „In den Warenkorb“ and a bordered button below the bullets; no living contract prescribes either — the CTA block is editor-owned, `API_CONTRACT.md §0` rule 25.)
- **F15 — `/cart.js` GET on every page load (`pageshow`) and every focus/visibility return** on every widget page, even without Mo use. Pages where the widget renders make two `/cart.js` GETs per view (header script plus the widget's `pageshow`). In addition, every click on a widget form submit button (contact, email capture, feedback, opt-in, rename) triggers two more `/cart.js` GETs (+600 ms, +1200 ms) from the header script, whose click selector includes any `button[type="submit"]` (§7.3). The `?section_id=` drawer/page re-render GET happens only when `item_count` differs from the last known count. Cheap, but it is extra traffic.
- **F16 — Markdown product links in Mo's text are untracked**, so `product_cta_clicked` undercounts product clicks.

Suggested frontend tasks — consolidated, with priorities, effort and the backend part, in the backlog `07` §7 (each still needs a `MANIFEST.md` entry and a manual upload):

| Id | Task | Backlog (`07` §7) |
|---|---|---|
| T1 | `_mo` on the „Zur Kasse“ permalink; mint eagerly when the add-to-cart card renders | A2 |
| T2 | Compare / showroom / add-to-cart renders count as "consulted" | A1 |
| T3 | PDP product context on the first typed message of a fresh conversation | done (`bc7fb5d`; A3 in „Done“) |
| T4 | Selected variant into the context; „Zum Produkt“ with `?variant=`; variant-level KPIs | D3 |
| T5 | Listen to `product:added-to-cart`: re-stamp and a KPI event | D2 |
| T6 | `/en` product and showroom links; translated CTA label | D4 |
| T7 | Track Markdown links to product URLs | B4 |
| T8 | "MO only" block on the three CTA-less templates | done (`8d0a0c4`); D5 keeps the open parts |
| T9 | A „Frage nicht dabei? Frag Mo“ link at the end of the Q&A tab | D5 |
| T10 | One id space in KPIs | B6 |

---

## 17. Open questions / uncertainties

1. **Cart permalink semantics**: likely NOT attributed. A cart permalink builds its own cart/checkout, so the `_mo` attribute stamped via `/cart/update.js` probably does not carry over. MANIFEST 2026-06-21 shows only that the permalink changes the storefront cart count (the chat tab's badge went stale), not that attributes survive. Verify with one test order (order `note_attributes`). Fix path: F1/T1.
2. **Apex vs www**: `shopifyUrl`, `cartUrl` and `showroomUrl` use `https://motionsports.de`, while the backend docs test `https://www.motionsports.de`. Presumably the apex redirects to the primary domain. Not verified, including the effect on the cart cookie during a permalink redirect.
3. **Translated handles on `/en`**: whether `product.handle` differs per locale (§2.3).
4. **Markets and currencies**: whether any non-EUR market is active (repo `markets.json` is empty).
5. **Which banner loads the Customer Privacy API** on live, and therefore the share of visitors for whom `analyticsProcessingAllowed()` can ever be true.
6. **Classic vs new customer accounts**, which affects App Proxy `logged_in_customer_id` and whether the Mo sign-in and the shop login share a session.
7. **Product → template assignment** (which products use `product.produkte-im-set`, which has no Q&A tab).
8. **Storefront caching delay** after `metafieldsSet` on `custom.qa`.
9. **Live parity**: the live theme may differ from this repo (a missed upload, editor changes since the last snapshot). Check with `07` §6.3–§6.4 after every upload.
