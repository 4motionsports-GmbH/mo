# 01 — Storefront & Shopify theme overview

> **Audience:** backend coding agents of Mo (`4motionsports-gmbh/mo`). They cannot see the theme repo.
> **Source of truth:** the theme repo `ms_shopify_clone`, branch `main` at `3e87341` (PR #73 "customer platform" `a0df103` + the fixes `8d0a0c4` + `3e87341`; README). Every claim below comes from reading that tree. Endpoint behaviour lives in the widget contract of this folder — `API_CONTRACT.md` (AC §n), `ACCOUNT_CONTRACT.md` (ACCT §n), `CONSENT_CONTRACT.md` (CONS §n) — and this chapter points to their sections instead of repeating them. Production state (what is uploaded, which switches are on): README §4.

This chapter describes the whole motionsports.de storefront around Mo. It covers which theme it is and who edits it, where everything lives, how the page skeleton and the product page are built, and how the header, cart drawer and add-to-cart flows work. It also covers the third-party apps, consent, locales, the Mo theme settings, the metafields the theme reads, the URL parameters a storefront page reacts to, and how changes reach the live shop. It ends with what the backend can change without a theme deploy and what needs one. The widget's internals (UI states, tool cards, KPI events, sign-in and consent flows) are covered in the other chapters of `docs/frontend/`.

## Contents

1. [At a glance](#1-at-a-glance)
2. [What the theme is: vendor theme + three layers of customisation](#2-what-the-theme-is)
3. [Folder structure — what lives where](#3-folder-structure)
4. [Page skeleton: `layout/theme.liquid`](#4-page-skeleton-layoutthemeliquid)
5. [Page types / templates, and where Mo appears](#5-page-types--templates-and-where-mo-appears)
6. [The product page in detail](#6-the-product-page-in-detail)
7. [Home, collection, content, search, account and cart pages](#7-home-collection-content-search-account-and-cart-pages)
8. [Header, cart drawer and every add-to-cart path](#8-header-cart-drawer-and-every-add-to-cart-path)
9. [Third-party apps and scripts](#9-third-party-apps-and-scripts)
10. [Consent / Shopify Customer Privacy API](#10-consent--shopify-customer-privacy-api)
11. [Locales and languages](#11-locales-and-languages)
12. [Theme settings relevant to Mo](#12-theme-settings-relevant-to-mo)
13. [Metafields the theme reads](#13-metafields-the-theme-reads)
14. [Browser storage on the storefront (namespace map)](#14-browser-storage-on-the-storefront)
15. [URL parameters a storefront page reacts to](#15-url-parameters-a-storefront-page-reacts-to)
16. [Operational model: two editors, manual deploy, re-sync](#16-operational-model)
17. [Where the backend can influence the storefront — with and without a theme change](#17-where-the-backend-can-influence-the-storefront)
18. [Observations relevant to KPIs (facts, not plans)](#18-observations-relevant-to-kpis)
19. [Open questions / uncertainties](#19-open-questions--uncertainties)

---

## 1. At a glance

| Item | Value | Source |
| --- | --- | --- |
| Platform | Shopify Online Store 2.0 theme (JSON templates, section groups, theme blocks) | `templates/*.json`, `sections/*-group.json`, `blocks/` |
| Vendor theme | **Essence 4.1.0** by Alloy Themes (docs: essence-docs.alloythemes.co) | `config/settings_schema.json → theme_info` |
| Storefront origins | `https://motionsports.de` / `https://www.motionsports.de` (the backend's origin allowlist, `ALLOWED_ORIGINS` default) | `MANIFEST.md → "Note on the shared secret"`, AC §1 "Security model" |
| Mo backend | `https://mo.motionsports.de` (theme setting default, also JS default) | `settings_schema.json → ai_advisor_backend_url`, `ms-chat-widget.js → API_BASE` |
| Mo frontend footprint | 1 snippet, 2 assets, 1 settings section, 2 layout hooks (head script + render), 1 product-template CTA block (in 4 templates, plus the Kurzinfo variant in `produktdesign-02`), Q&A tab (snippet + section) | §2.3 |
| Widget tech | Vanilla ES5 IIFE, no build step, no dependencies, every class prefixed `.ms-chat*`; ~6.3k lines JS, ~1.8k lines CSS | `assets/ms-chat-widget.js` header comment |
| Theme JS | `assets/main.mjs` (minified Essence bundle, web components) + `assets/vendor.mjs` | `layout/theme.liquid` |
| Languages | German default; English under the `/en` path prefix | `snippets/ms-chat-widget.liquid → locale`, `ms-chat-widget.js → LOCALE` |
| Cart UX | Drawer (`cart_type: "drawer"`, `added_to_cart_notification: "drawer"`) | `config/settings_data.json` |
| Deployment | **Manual.** The owner copies changed files from `main` into the Shopify code editor. No CI and no Shopify CLI in the loop. | §16 |

---

## 2. What the theme is

### 2.1 Vendor base

The theme is **Essence 4.1.0 (Alloy Themes)**. `config/settings_schema.json → theme_info` shows `theme_name: "Essence"`, `theme_version: "4.1.0"` and `theme_author: "Alloy Themes"`. `config/settings_data.json` still contains the vendor presets `Essence` and `Cadence`. The vendor JS is compiled and minified into `assets/main.mjs`, which registers about 70 custom elements (`cart-modal`, `product-form`, `quick-add-button`, `x-modal`, `privacy-banner`, `product-recommendations`, `sticky-header`, …). Treat `main.mjs` as **read-only vendor code**. Nobody edits it by hand.

### 2.2 Layers of customisation on top

| Layer | Who edits it | Where it lives | Examples |
| --- | --- | --- | --- |
| **Vendor core** | Nobody (updated only if the theme is upgraded) | `assets/main.mjs`, `assets/main.css` (mostly), most `sections/main-*.liquid`, most snippets | `<cart-modal>`, `<product-form>`, `qe()` cart-badge updater |
| **Live-editor customisations** | A second person, directly in the Shopify theme editor / code editor | `templates/*.json` (custom_liquid blocks with inline Liquid + CSS), `blocks/ai_gen_block_*.liquid` (Shopify "AI-generated" theme blocks), header redesign (`fh-*` classes in `sections/header.liquid`), `snippets/product-detail-accordions.liquid` (`pda-*`), app embeds, the end of `assets/main.css` | Breadcrumb, "SKU + Garantie", Loox stars, Highlights accordion, Premium collection grid, Home-gym configurator, Trusted Shops, Consentico |
| **Mo layer (our repo work)** | Coding agents in this repo, PR-reviewed, uploaded by the owner | See §2.3 | Widget, product CTA styling hooks, Q&A tab, cart-badge sync fix, head script |

The live editor also writes **Mo-related markup**. The current product-page CTA block ("MO only") was created there, see §6.2. Ownership is therefore mixed, even inside `templates/product.json`.

### 2.3 Complete Mo footprint in the theme

| File | Role | Owner |
| --- | --- | --- |
| `snippets/ms-chat-widget.liquid` | Gating (enabled / cart / checkout / empty shared secret / exclusion list), injects `window.MS_CHAT_CONFIG`, loads the CSS + deferred JS. Where the widget does not render it emits a `<style>` that hides the product CTA (§5.1) | Mo |
| `assets/ms-chat-widget.js` | The widget | Mo |
| `assets/ms-chat-widget.css` | Widget styles, including `.ms-chat-logo` orb used by the product CTA, and `body.no-scroll` rules that hide the launcher while a theme drawer is open | Mo |
| `config/settings_schema.json → "AI Advisor"` | Four theme settings plus an info paragraph (§12) | Mo |
| `layout/theme.liquid` | (a) inline `<head>` script that stashes `ms_auth`/`ms_code`/`mo_c` (PR #73); (b) `{% render 'ms-chat-widget' %}` before `</body>` | Mo (but the file is shared with the live editor) |
| `templates/product.json → main → custom_liquid_AErEyg` ("MO only") | Product-page CTA button | Live editor (content), Mo (contract) |
| `templates/product.produkt-new.json`, `product.produktnew.json`, `product.produkte-im-set.json → main → custom_liquid_AErEyg` ("MO only") | The same CTA block, copied byte-identical from `product.json` (added 2026-10-04, §6.6) | Mo (added), live editor (template) |
| `templates/product.json → main → custom_liquid_BGU8Mt` ("USPs mit MO", **disabled**) | Older Kurzinfo + CTA variant | Mo / live editor |
| `templates/product.produktdesign-02.json → main → custom_liquid_BGU8Mt` ("USPs", enabled) | Same Kurzinfo + CTA variant on an alternate product template | Mo / live editor |
| `snippets/product-qa.liquid` | Q&A list + FAQPage JSON-LD from `custom.qa` | Mo |
| `sections/tabs-cards.liquid` | Product tabs; the Q&A tab and `show_qa_tab` setting were added by Mo | Shared |
| `locales/de.json`, `locales/en.default.json → products.product.qa_tab_label / qa_answered_by` | Q&A tab strings | Mo |
| `sections/header.liquid` | `id="CartBubble"` placement + badge-sync script (§8.2) | Shared (Mo fixed it 2026-10-01) |
| `snippets/product-detail-accordions.liquid → refreshCartModal()` | Quick-add in the recommendations accordion refreshes the drawer in place | Shared (Mo fixed it 2026-10-01) |
| `assets/main.css → "AI Advisor"` block (`.ms-chat-product-cta-wrapper`, `.ms-chat-product-cta`) | Duplicate CTA styles added by the live editor (first seen in sync `cf9bc43`, 2026-08-19). `.ms-chat-product-cta-wrapper` is not used by any template. | Live editor |
| `MANIFEST.md` | Dated changelog + upload list per session | Mo |

---

## 3. Folder structure

| Folder | Count | What lives there | Notes for Mo |
| --- | --- | --- | --- |
| `layout/` | 2 | `theme.liquid` (every storefront page), `password.liquid` | The widget is rendered **only** from `theme.liquid`. Only the password page (`templates/password.json` sets `"layout": "password"`) does not load it. `templates/gift_card.liquid` is just `{% section 'main-gift-card' %}` without `{% layout none %}`, so it renders inside `theme.liquid` (see §5.1). |
| `templates/` | 112 files | 109 JSON templates per page type and suffix (`product.json`, `collection.<handle>.json`, `page.<handle>.json`, incl. 7 `customers/*.json`), plus 3 Liquid templates | Which template a product, collection or page uses is chosen in Shopify admin, not visible in the repo. |
| `sections/` | 78 | Section files, plus the section groups `header-group.json`, `overlay-group.json`, `footer-group.json` | `overlay-group` = search modal, cart drawer, privacy banner, newsletter popup (disabled). |
| `blocks/` | 36 | Theme blocks: 34 `ai_gen_block_*` (Shopify Sidekick/"AI-generated" blocks, most with a `{% doc %} @prompt …` header; `ai_gen_block_677224a` has a `{% doc %}` without `@prompt`), `accordeon-plus`, `bluebox` | Heavy, self-contained Liquid + CSS + inline JS. Several do their own cart adds (§8.4). |
| `snippets/` | 225 | Render partials (product card, price, icons, Mo snippet, Q&A, accordions, cart parts) | |
| `assets/` | 278 | `main.mjs`, `vendor.mjs`, `main.css`, the two Mo assets, PhotoSwipe, ~260 `flag-*.svg` | `custom-sku-search.js` and `recommended2(.liquid)` are not referenced by any Liquid file. |
| `config/` | 3 | `settings_schema.json` (setting definitions), `settings_data.json` (current values, app embeds, custom CSS), `markets.json` (`{"markets":{}}`) | `settings_data.json` is overwritten whenever someone saves in the theme editor. |
| `locales/` | 7 | `de.json`, `en.default.json`, `es/fr/it/nl.json`, `en.default.schema.json` | §11 |
| repo root | — | `MANIFEST.md`, `AUDIT_FRONTEND.md` (older widget-vs-contract audit), `WIDGET_MIGRATION_PLAN.md` (older TEST→CLONE migration plan) | `AUDIT_FRONTEND.md` and `WIDGET_MIGRATION_PLAN.md` are historical. Some of their findings were fixed later. |

---

## 4. Page skeleton: `layout/theme.liquid`

Render order of every storefront page that uses the theme layout:

| # | Where | What | Mo relevance |
| --- | --- | --- | --- |
| 1 | `<head>`, right after `<meta charset>` | **Mo early-param script** (only if `settings.ai_advisor_enabled`). Reads `ms_auth`, `ms_code` and `mo_c` from the URL. If any is present, it writes `{ at: Date.now(), ms_auth?, ms_code?, mo_c? }` to `sessionStorage['ms-chat-early-params']`, removes them from the URL via `history.replaceState` (keeping `history.state`, path, other params and the hash), and does nothing if storage throws. | Keeps the one-time sign-in code and the campaign token out of the page URL that Shopify analytics and Customer-Events web pixels record. Runs on **every** page while the widget setting is on, including `/cart` and excluded templates. The widget consumes the stash (`ms-chat-widget.js → earlyParam()`), deletes it on first read, and ignores it if older than 10 min (`LINK_RETRY_MAX_MS`). Added by PR #73 (2026-10-04). |
| 2 | `<head>` | Meta, canonical, `<title>`, `meta-tags` snippet | |
| 3 | `<head>` | `vendor.mjs` + `main.mjs` as deferred modules | Theme web components |
| 4 | `<head>` | `{{ content_for_header }}` | Shopify's own scripts: analytics, web pixels, app embeds (from `settings_data.json → current.blocks`), Customer Privacy API loader, the shop's cookie banner if configured |
| 5 | `<head>` | Theme CSS vars snippets, `main.css`, `rapid-search-settings` snippet, Trusted Shops `widget.js/v2` (`integrations.etrusted.com`) | |
| 6 | `<body class="{{ template.name }}-page …">` | Scrollbar-width script, `{% sections 'header-group' %}`, `{% sections 'overlay-group' %}`, `<main id="MainContent">` with `content_for_layout` + `{% sections 'footer-group' %}` | The body class tells you the template, e.g. `product-page`. |
| 7 | after `<main>` | `#variant-added-modal`, `quick-add-modal`, loading overlay, `<notification-wrapper>` | Theme add-to-cart UI |
| 8 | inline `<script>` | Window globals (table below). On product pages it also writes `localStorage['essence:recently-viewed-products']`. | |
| 9 | inline `<script>` | `#support-toggle`/`#support-menu` dropdown, and the `pda` recommendation-slider controller (`[data-pda-slider]`) | |
| 10 | before `</body>` | **`{% render 'ms-chat-widget' %}`** | The Mo mount point |
| 11 | before `</body>` | Trusted Shops `integration.js` module (`data-integration-id="int-28ba4c97-…"`) | Trustbadge / Trusted Shops UI |

**Window globals (theme globals on every theme-layout page; Mo globals only where the widget renders and mounts)** (from `layout/theme.liquid`, `main.mjs` and the Mo snippet):

| Global | Set by | Content / use |
| --- | --- | --- |
| `window.routes` | theme.liquid | `cart_add_url`, `cart_url`, `cart_change_url`, `cart_update_url` (all with `.js` suffix, locale-aware, e.g. `/en/cart.js`), `predictive_search_url`, `product_recommendations_url`, `search_url`. The widget uses `window.routes.cart_url` for its `/cart.js` reads (`ms-chat-widget.js → cartJsUrl()`). |
| `window.addedToCartNotification` | theme.liquid | `"drawer"`. Decides whether `product-form` opens the drawer or the variant-added modal. |
| `window.variantStrings`, `window.cartStrings`, `window._t`, `window.svgs` | theme.liquid | Localised theme strings and SVGs |
| `window.Shopify.routes.root` | Shopify | `/` or `/en/`. Used by the custom quick-add scripts. |
| `window.Shopify.customerPrivacy` | Shopify (loaded on demand) | Consent API, see §10 |
| `window.MS_CHAT_CONFIG` | `snippets/ms-chat-widget.liquid` (only inside `{%- if ms_chat_render -%}`) | Widget config, see §12.2. Absent on /cart, checkout, excluded templates, when the widget is disabled and when the shared secret is empty (§5.1). |
| `window.MS_CHAT` | `ms-chat-widget.js → init()` | Public API: `openWithProduct(productId, productTitle)`, `openEmailSummary()`. Absent on /cart, excluded templates, or with an empty shared secret (the snippet then does not load the script). |
| `window.__msChatMounted` | `ms-chat-widget.js` | Double-mount guard. Absent on /cart, excluded templates, or with an empty shared secret (set only after the `CHAT_KEY` check passes). |

---

## 5. Page types / templates, and where Mo appears

### 5.1 Widget gating (`snippets/ms-chat-widget.liquid`)

The widget (launcher + panel) is rendered only when **all** of the following hold:

1. `settings.ai_advisor_enabled` is true. It is **true** in this snapshot's `config/settings_data.json` (the theme editor can change it, §16).
2. The page is not a cart page: `template contains 'cart'` or `request.page_type == 'cart'` → hidden. This exclusion is hard-coded and cannot be overridden by a setting. Because it is a substring test, any template whose name contains "cart" is excluded.
3. `request.page_type != 'checkout'`. Checkout does not use the theme layout anyway.
4. `settings.ms_chat_shared_secret` is not blank. With an empty secret the snippet loads neither the config nor the JS.
5. The template is not in `settings.ai_advisor_excluded_templates`. Entries are comma- or newline-separated, spaces are removed and matching is case-insensitive against both `template` (e.g. `page.contact`) and `template.name` (e.g. `page`). The current value is the schema default `"cart"`, because the key is absent from `settings_data.json`.
6. JS side (backstop): `MS_CHAT_CONFIG.chatKey` is non-empty. Otherwise `ms-chat-widget.js` logs a console warning and **does not mount** (no launcher).

This section is the one statement of the render gate; `02` §2.3 adds what the snippet emits when it passes.

**CTA hiding where the widget does not render.** When `ai_advisor_enabled` is on but any of checks 2–5 fails, the snippet's `{%- else -%}` branch outputs `<style>.ms-chat-product-advisor, .ms-chat-product-cta { display: none !important; }</style>`. So the product-page CTA (§6.2) is hidden on an excluded product template or with an empty secret instead of rendering as a dead button. With `ai_advisor_enabled` off, the CTA blocks render nothing anyway (they carry the same `if`).

Consequence: the widget appears on home, product, collection, search, blog/article, all `page.*`, customer-account pages (classic Liquid account templates), and 404. It does **not** appear on `/cart`, checkout or the password page (password layout). The **gift-card page** uses the theme layout, and the snippet's `cart` / `checkout` checks do not match `gift_card`, so it very likely **shows the launcher** unless `gift_card` is added to `ai_advisor_excluded_templates` (not verified on the live store).

### 5.2 Template inventory

| Page type | Templates in repo | Main composition | Mo touchpoints |
| --- | --- | --- | --- |
| Home (`index`) | `index.json` | Slideshow → Featured Products 03 → Product highlight (`ai_gen_block_7faa863`) → Video mit Text (`462bb5e`) → Collection slider (`b57bc8a`) → Image with text overlay (`2326f73`) → Premium image with text (`6b30c8c`) → Featured blog slider (`2b80a28`) → Trusted Shops review carousel (app block) | Launcher only. `pageContext.pageType = "index"` maps to `home` in the widget. |
| Product | `product.json` (default) + 4 alternates: `product.produkt-new`, `product.produktdesign-02`, `product.produkte-im-set`, `product.produktnew` | See §6 | CTA (all five templates, §6.6), Q&A tab (not on `produkte-im-set`), launcher, page context |
| Collection | `collection.json` + **35** handle-specific `collection.<handle>.json` (arme, bauch, …, waterrower) | Two generations (§7.2) | Launcher, page context (`collectionTitle`, `collectionHandle`) |
| List collections | `list-collections.json` | `main-list-collections` | Launcher |
| Search | `search.json` → `main-search` → renders `rapid-search-results-template-v2` (Rapid Search app) | | Launcher. No Mo hook on "no results". |
| Pages | `page.json` + ~50 `page.<handle>.json` (legal: agb, datenschutz, impressum, widerruf, versand, garantiebedingungen; service: contact, bestellstatus, reklamation, angebotsanfrage, serviceseite, faq; landing/SEO pages per muscle group; newsletter pages; home-gym-konfigurator; secret-sales; black-week-sale; jobs; ueber-uns) plus Liquid templates `page.rapid-search-results-page.liquid` and `page.targo-response.liquid` | Mostly `main-page` (often disabled) + marketing sections | Launcher |
| Blog / article | `blog.json`, `blog.kettlebell-*.json`, `article.json`, `article.kettlebell-uebungen.json`, `article.muskelaufbau.json` | | Launcher |
| Cart | `cart.json` → `main-cart` | | **No widget** (hard exclusion) |
| Customer accounts | `customers/{account, activate_account, addresses, login, order, register, reset_password}.json` | Vendor `main-*` sections | Launcher (if the classic account pages are in use, see §19) |
| Other | `404.json`, `password.json` (password layout), `gift_card.liquid` | | 404: launcher. Gift card: launcher (theme layout; exclude via `ai_advisor_excluded_templates` if unwanted). Password: no widget. |

---

## 6. The product page in detail

### 6.1 `templates/product.json`: sections and blocks in render order

**Section `main` (`main-product`)**, which holds the right-hand info column. Settings: `show_breadcrumbs: false` (a custom breadcrumb block replaces it), `media_layout_desktop: carousel_vertical`, `show_sticky_add_to_cart: false`.

| # | Block id | Type / editor name | State | What it renders | Data read |
| --- | --- | --- | --- | --- | --- |
| 1 | `70fc43fe…` | vendor | off | — | |
| 2 | `custom_liquid_JUU6cb` | custom_liquid "Breadcrumb Navigation liquid" | on | „Startseite › <collection> › <product>“. Collection priority: URL context → `custom.primary_collection` → first of `product.collections`, skipping `not-discounted`, `uporder-recommended-products`, `orderlyemails-recommended-products` | `custom.primary_collection` |
| 3 | `07b2f4eb…` | title | on | `{{ product.title }}` | |
| 4 | `custom_liquid_XHmt3C` | "SKU + Garantie" | on | `<variant SKU> \| Garantiebedingungen` (link to `/pages/garantiebedingungen`) | `selected_or_first_available_variant.sku` |
| 5 | `custom_liquid_Eaw6rn` | "Stars³" | on | `.loox-rating` with `data-rating` / `data-raters` | `loox.avg_rating`, `loox.num_reviews` |
| 6 | `custom_liquid_CihbKm` | (unnamed) | on | If `loox.num_reviews > 0` an empty Loox rating, otherwise a 5-outline-star "(0)" fallback button | `loox.num_reviews` |
| 7 | `custom_liquid_BGU8Mt` | "USPs mit MO" | **off** | Kurzinfo bullets + Mo CTA appended below them (older layout) | `custom.kurzinfo` |
| 8 | **`custom_liquid_AErEyg`** | **"MO only"** | **on** | **The Mo product CTA** (§6.2) | `product.id`, `product.title` |
| 9 | `custom_liquid_epjJB7` | "USP liquid" | on | `render 'product-detail-accordions'` (§6.3) | `custom.kurzinfo`, complementary-products metafield |
| 10 | `custom_liquid_fGqhQn` | "Simesy LIQ" | on | Compact "Lieferung voraussichtlich bis …" button (hidden until filled by script) | Simesy EDD app |
| 11 | `sm_estimated_delivery_date_edd_…` | App block Simesy EDD | on | Estimated delivery date | app |
| 12–14 | inventory, price, "Price 2" | | off | | |
| 15 | `custom_liquid_7VPD7b` | "Price³ (mit Snippet)" | on | `render 'product-price'` | |
| 16 | `5a84f252…` | variant_picker | on | Variant picker | |
| 17 | `custom_liquid_AD7R3A` | | on | 25px spacer, only on the gift-card product | |
| 18 | `text_GLYGCh` | text | on | `custom.liefereinheit` (delivery unit) | `custom.liefereinheit` |
| 19 | `custom_liquid_8w4DYD` | "versandkosten" | off | | |
| 20 | `0f473fb4…` | quantity_selector | on | | |
| 21 | `globo_product_options_app_block_…` | App block Globo Product Options | on | Product options/add-ons | app |
| 22 | `a730fe0e…` | **buy_buttons** | on | `<product-form>` add-to-cart (§8.3) | |
| 23–24 | "CL TARGOBANK neu", "Payments SVG" | | off | | |
| 25 | `custom_liquid_MBcJ7y` | "PayMent + Targo neu" | on | Payment icons + TARGOBANK financing mini-widget (only if `product.available`) | |
| 26–33 | collapsible_content ×4, complementary_products, text (`custom.kurzbeschreibung`), image ×2 | | all off | | |

So the order in the right-hand column is: breadcrumb, title, SKU/warranty, stars, **Mo CTA**, Highlights / Produktempfehlungen accordions, delivery estimate, price, variants, delivery unit, quantity, options, **Add to cart**, payment/financing. The Mo CTA sits **above the price and above Add to cart**.

**Sections below `main`, in order:**

| # | Section id | Type | State | Content |
| --- | --- | --- | --- | --- |
| 2 | `17854312649c84ea57` | `_blocks` → `ai_gen_block_ce729c9` "Product image gallery" | block off | |
| 3 | `custom_liquid_megYD7` | custom-liquid "Product Image Slide 1 - 4" | on | 4-column square gallery (slider on mobile) from `custom.slide_1_image` … `custom.slide_4_image`. Renders only if at least one is set. |
| 4 | `main-details` | main-product-details | **section off** | (Produktbeschreibung) |
| 5 | `tabs_cards_tdGyxW` | **tabs-cards "Tabs – Produkt"** | on | §6.4 |
| 6 | `custom_liquid_T9PtR7` | custom-liquid | on | 15px spacer |
| 7 | `related-products` | related-products | off | |
| 8 | `related_products_03_TDwUKJ` | related-products-03 | on | "JETZT ENTDECKEN / Weitere Empfehlungen für dich." carousel, 10 products (Shopify product recommendations) |
| 9 | `1783591332d9299d23` | `_blocks` → `ai_gen_block_0f785ee` "Icon Features 03" | on | „Bestellung, Lieferung & Pflege.“ 4 static FAQ cards. The first one is „Kann ich mich vor dem Kauf beraten lassen?“ and answers with phone, e-mail and showroom, **without mentioning Mo**. |
| 10 | `17836740814c626e78` | `_blocks` → `ai_gen_block_d2df699` (Image with text) | on | „Hast du noch Fragen?“ with text „…telefonisch (08142/ 448666), per E-Mail oder direkt im Showroom…“ and one button „E-Mail“ → `mailto:info@motionsports.de`. **No Mo entry point.** |

### 6.2 The "MO only" product CTA (`custom_liquid_AErEyg`)

The Mo product CTA is a `custom_liquid` block created in the live editor: a small underlined text link **„Detaillierte Beratung zu diesem Produkt“** (German literal, also on `/en`) next to a 36 px animated orb (the widget's `.ms-chat-logo`, hydrated by `init()`). It renders only while `settings.ai_advisor_enabled` is on. The same block (same id, byte-identical settings) is in `product.json` and three alternate templates (§6.6); `product.produktdesign-02` has the older Kurzinfo variant. On `product.json` it sits above the price and Add to cart (§6.1). The block carries its own inline `<style>`; `assets/main.css` has a second copy of the rules (§2.3). Where the snippet does not render the widget, its else-branch hides the CTA (§5.1).

Owner of the details: `06` §3 — markup contract (`.ms-chat-product-cta` + `data-ms-chat-product-id` / `-title`; one delegated handler, so it works on any page), styling, click path (`bindProductCtas()` → `openWithProduct()`, `product_cta_opened` with the numeric id, the primer user message with `context.type: "product"` and the page handle as `productId`), gating edge cases (a click before the deferred script has booted, or a failed script load, does nothing). Template coverage: §6.6.

### 6.3 Highlights / Produktempfehlungen / Lieferung accordions (`snippets/product-detail-accordions.liquid`)

| Accordion | Condition | Content |
| --- | --- | --- |
| **Highlights** (open by default) | `product.metafields.custom.kurzinfo != blank` | `custom.kurzinfo \| metafield_tag`. This is the USP bullet list ("Kurzinfo"). |
| **Produktempfehlungen** | always rendered | Up to 10 products from `product.metafields['shopify--discovery--product_recommendation']['complementary_products']` (Search & Discovery app's complementary list, read directly so that sold-out items stay visible). Products tagged `globo-product-options` are skipped. Each is a `product-card` with quick-add, shown in a horizontal slider with arrows when there are more than 2. Empty list: „Für dieses Produkt sind derzeit keine Empfehlungen vorhanden.“ |
| **Lieferung voraussichtlich bis …** | `delivery_content != blank` | The "USP liquid" block passes `delivery_content: delivery_date`, but no `delivery_date` variable is assigned anywhere in the repo. **This accordion very likely never renders.** The Simesy blocks (rows 10–11 in §6.1) show delivery instead. |

The snippet also contains a click listener for quick-add buttons inside the recommendations accordion. It polls `/cart.js` until `item_count` changes, then refreshes the drawer via `<cart-modal>.reloadContent()` (fallback: Section Rendering fetch) and dispatches `cart:updated` + `cart:refresh` (`refreshCartModal()`, `waitForCartChange()`).

### 6.4 Product tabs (`sections/tabs-cards.liquid`, section `tabs_cards_tdGyxW`)

Desktop shows tabs. Mobile shows the same panels as accordion buttons (`.accordion-btn`). The first tab is active by default. Section settings: `max_width: 1400`, `comp_limit: 8`, `show_qa_tab: true`.

| Tab | Title (block setting) | Content | Data |
| --- | --- | --- | --- |
| 1 | „Beschreibung“ | Block richtext = `{{ product.description }}` (dynamic source). Fallback text „Bitte Inhalt für Tab 1 im Editor pflegen.“ | product description |
| 2 | „Details“ | Two columns. Left: `custom.kurztext` (rich-text metafield, used as the **Details table**), with fallback to the block richtext, which is set to `custom.kurzbeschreibung`. Right: up to 2 images from `custom.zusatzbilder` (file or file list, via `tab2-image-item`). | `custom.kurztext`, `custom.kurzbeschreibung`, `custom.zusatzbilder` |
| 3 | „Bewertungen“ | `#loox-faq` scroll anchor + `#looxReviews[data-product-id]` (Loox reviews widget) | Loox |
| 4 | „Zubehör“ | `<product-recommendations>` fetching `?section_id=complementary-products-tab&product_id=…&intent=complementary&limit=8` (Shopify Recommendations API, complementary intent). Placeholder „Lade Zubehör …“. | Search & Discovery complementary |
| 5 (conditional) | `products.product.qa_tab_label` = „Q&A“ (DE and EN) | `render 'product-qa'` (§6.5) | `custom.qa` |

The **Q&A tab** is appended after the block tabs, with index `blocks.size + 1`. It renders only when `show_qa_tab` is on **and** `custom.qa` contains at least one entry (within the first 20) with non-empty `q` and `a` after `strip_html | strip`. There is **no URL hash or deep link** that opens a particular tab. The only scroll target is `#loox-faq`.

### 6.5 Q&A metafield contract (`snippets/product-qa.liquid`)

Writer: the backend's admin "Wissen" tab publishes via Admin API `metafieldsSet` (`docs/QA_KNOWLEDGE.md`). Type: **JSON**, namespace/key `custom.qa`. A metafield definition with storefront access must exist so that Liquid can read it.

```jsonc
[ // array, oldest first; theme renders at most the first 20 (backend caps at 20, QA_MAX_PER_PRODUCT, dropping the oldest)
  { "q": "Frage …",            // required, plain text
    "a": "Antwort … [Text](https://…)", // required; may contain raw markdown links
    "a_html": "… <a href=\"https://…\" target=\"_blank\" rel=\"noopener noreferrer\">…</a> …", // optional, only when a has a link
    "q_en": "Question …", "a_en": "Answer …", "a_en_html": "…" }  // optional
]
```

Rendering rules:

| Rule | Detail |
| --- | --- |
| Validity | An entry is shown only if `q` and `a` are both non-empty after `strip_html \| strip`. Invalid entries are skipped silently. |
| Language | If `request.locale.iso_code` starts with `en` **and** both `q_en` and `a_en` are non-empty, the English pair is used together with `a_en_html`. Otherwise German. Every other locale shows German. |
| Question | Always escaped plain text (`<summary class="product-qa__question">`). |
| Answer | If the chosen `a_html` / `a_en_html` is non-blank, it is output **raw** (unescaped; `newline_to_br` adds `<br>`). Otherwise the plain answer is output as `a | strip_html | strip`, then `escape | newline_to_br` (HTML tags in `a` are **dropped**, not shown escaped; `q` is likewise `strip_html`'d before `escape`). On `/en` with a valid `q_en`/`a_en` pair, `qa_a_html` is reassigned to `a_en_html`: only `a_en_html` is considered, and if it is blank the plain `a_en` is shown, never the German `a_html`. **The theme has no markdown parser**: a link-bearing answer without `a_html` shows the raw `[Text](URL)`. |
| Trust boundary | The theme trusts `a_html` completely. The backend's `qa-links.mjs` is the only sanitizer. Anything else that writes `custom.qa` (a merchant editing JSON in the admin, another app) can inject HTML into the PDP. |
| Meta line | Every answer ends with `products.product.qa_answered_by`: „Beantwortet vom motion sports Team“ / "Answered by the motion sports team". |
| Styling | `<details>` rows with zebra background (white / `#eee`), +/− marker in `#008ccb`, links in `#008ccb` underlined. Matches the Details table look (2026-10-01). |
| SEO | A separate `<script type="application/ld+json">` **FAQPage** with one `Question`/`acceptedAnswer` per rendered entry, in the same resolved language. Link answers are reduced to text via `strip_html` of the HTML variant, so no markdown leaks into the JSON-LD. |
| Removal | An empty array `[]` hides the tab and the JSON-LD (backend "Zurückziehen", `QA_KNOWLEDGE.md`). |

### 6.6 Alternate product templates

| Template | Mo CTA | Q&A tab | Notes |
| --- | --- | --- | --- |
| `product.json` | yes ("MO only") | yes (tabs-cards) | Default |
| `product.produktdesign-02.json` | yes, inside the "USPs" Kurzinfo block (`custom_liquid_BGU8Mt` enabled) | yes (tabs-cards; `show_qa_tab` absent → schema default `true`) | |
| `product.produkt-new.json` | yes ("MO only", added 2026-10-04) | yes (tabs-cards) | CTA sits right after the Kurzinfo "USPs" block (`custom_liquid_BGU8Mt`, enabled here, Kurzinfo only, no CTA of its own), before the price. |
| `product.produktnew.json` | yes ("MO only", added 2026-10-04) | yes (tabs-cards) | CTA sits right after the second SKU + Garantie block (`custom_liquid_dy3Byf`), before inventory/price. |
| `product.produkte-im-set.json` | yes ("MO only", added 2026-10-04) | **no** (no tabs-cards; uses `main-product-details`) | Set products. CTA sits right after the SKU + Garantie block (`custom_liquid_dy3Byf`), before inventory/price. Still no Q&A tab. |

The block on the three alternate templates is byte-identical to `templates/product.json → custom_liquid_AErEyg`; it was added on 2026-10-04, so `product_cta_opened` counts across that day are not comparable (§18). The widget launcher and `pageContext` work on all five templates, because they come from the layout. Which product uses which template is set per product in Shopify admin (`template_suffix`, §19 item 1). This table is the one statement of template coverage; `06` §3.7 and `07` §3.6 point here.

### 6.7 Page context the widget receives on product and collection pages

`snippets/ms-chat-widget.liquid → MS_CHAT_CONFIG.pageContext` carries server-rendered page facts only, never user data. The fields, their Liquid sources, the widget's normalisation (`PAGE_CTX`) and their use: `02` §3.2 (owner). Anything not in that table (selected variant, price, availability, vendor, tags, the product's collections, cart contents, a logged-in shop customer) needs a theme change (§17.2).

---

## 7. Home, collection, content, search, account and cart pages

### 7.1 Home
See the §5.2 table. All sections are vendor sections or AI-generated blocks maintained by the live editor. Mo appears only as the floating launcher (and the proactive nudge, see widget chapters).

### 7.2 Collection pages: two generations

- **Classic** (e.g. `collection.json`, `collection.hanteln.json`, `collection.schlingentrainer.json`, `collection.waterrower.json`): `main-collection-banner` → `main-collection-grid` (Essence facets + grid + `product-card` with quick-add) → optional AI blocks → custom-liquid.
- **New "SEO" generation** (about 20 handle templates: bumper-plates, crosstrainer, gymnastikmatte, hantelbank, hyperextension, kabelzug, kettlebell, kurzhanteln, laufband-klappbar, multipresse, plyo-box, power-racks, rudergeraet, schlingentrainer-2, sz-stange, verstellbare-hantelbank, verstellbare-hanteln, wadenmaschine, faszienrolle, life-test): `main-collection-grid` is **disabled** and replaced by `ai_gen_block_677224a` "**Premium collection grid**". That block has its own pagination, filters and quick-add (§8.4), reads Loox metafields, and is followed by "SEO intro" (`1278e74`), "Card section" (`79fe130`), "Collection Slider" (`73a657c`), "Comparison table" (`5d35178`), "Stylisches Rich Text" (`1573672`), "Collection slider" (`b57bc8a`), "Special heading" (`538b56c`), "**FAQ Accordion**" (`d1d24f6`, which emits its own **FAQPage JSON-LD**), "Icon Features" (`0f785ee`) and the „Hast du noch Fragen?“ image-with-text (`d2df699`, phone/e-mail CTA, no Mo).
- Other muscle-group templates (arme, bauch, beine, brust, schulter, laufen, radfahren, rudern, …) use featured-collection, media and video sections, with `main-collection-grid` disabled.

Collection pages contain editorial buying advice that the live editor writes by hand: comparison tables, FAQ accordions, and a "Kaufberatung & Finder" block type (`ai_gen_block_a7b55c0`, defined but not placed in any template in this snapshot). This content does **not** reach Mo automatically. The backend catalog sync reads products and metafields, not theme section settings.

### 7.3 Content pages relevant to customer service

| Page template | Section | What it does |
| --- | --- | --- |
| `page.contact` | `contact-form` | Shopify `{% form 'contact' %}`, sent as e-mail to the shop |
| `page.bestellstatus` | `bestellstatus` | Order-status request via Shopify **contact form** (e-mail), not a live lookup |
| `page.reklamation` | `reklamation` | Complaint form (contact form) |
| `page.angebotsanfrage`, `page.serviceseite` | `angebotsanfrage`, `product-inquiry` | Quote / product inquiry forms (contact form + `fetch('/products/<handle>…')` product lookups) |
| `page.faq` | `main-page` (enabled); `image-with-text-overlay`, `collapsible-content` (14 FAQ accordion blocks) and `rich-text` are all **disabled** | Static FAQ page. Only `main-page` renders, i.e. the page body (`page.content`) edited in Shopify admin. Static editor content that Mo cannot read. |
| `page.home-gym-konfigurator` | `ai_gen_block_296597c` "Home gym guide" | Client-side configurator. Loads complementary products via `/recommendations/products.json?intent=complementary`, adds everything via `POST /cart/add.js`, then `location.href='/cart'`. |
| `page.targo-response.liquid` | `targo-response` | TARGOBANK financing form post target |

The showroom URL that Mo's `suggest_showroom` card links to is **hard-coded** in the snippet (`showroomUrl: "https://motionsports.de/pages/showroom-munchen-grobenzell"`). There is no dedicated template for it in the repo, so it uses `page.json` or a template assigned in admin.

### 7.4 Search
The header search form (`sections/header.liquid → .fh-header-search`) submits `GET {{ routes.search_url }}?q=…&type=product&options[prefix]=last`. The placeholder is the hard-coded German „Wonach suchst Du?“, also on `/en`. Results come from the **Rapid Search** app (`sections/main-search.liquid → render 'rapid-search-results-template-v2'`, `snippets/rapid-search-settings.liquid`, app embeds `rapid-search-bar-filter`). `custom.hide_from_search == true` hides a product in theme predictive search and the collection grid page.

### 7.5 Customer accounts
The header account icon links to `{{ routes.account_url }}` (if `shop.customer_accounts_enabled`). The repo contains the classic Liquid account templates (`templates/customers/*.json`). Whether the shop uses **classic** or **new** customer accounts is not determinable from the theme (§19). This matters for `/apps/chat/whoami`: if Shopify sends no `logged_in_customer_id` for the store's account type, every whoami answer is `signedIn: false` (ACCT §3a). The App Proxy behind that path is Shopify app configuration (steps: `docs/ROLLOUT_TODO.md` 5.4); unconfigured, the path returns Shopify's HTML 404 page. The widget uses a whoami answer only to redeem its `linkCode` (`04` §5), and the backend issues a code only with `APP_PROXY_SIGNIN_ENABLED` and a proof (`APP_PROXY_SIGNIN_MAX_AGE_HOURS`), both default off in code (ACCT §3a). The pre-PR #73 widget treated a `signedIn:true` answer as identity without a code (`02` §1.1). Mo's own sign-in is a separate OAuth flow on the backend (`/api/auth/shopify/login`), started by the widget with a top-level redirect.

### 7.6 Cart page
`templates/cart.json → main-cart`: the cart table plus the summary column `snippets/cart-side-inner.liquid`, which renders the `main-cart` blocks in this order: a „Summary“ heading (English literal, also on the German store), the free-shipping-bar block (renders nothing, `settings.cart_free_shipping_bar_enabled` is `false`), totals, the shipping-estimator block (which has the xbfsbu shipping block `.xbfsbu-block[data-id="26e68865…"]` hard-coded inside its `shipping_estimator` case, before the estimator trigger), the cart note and the checkout button. There is no inline Consentico markup on `/cart`; any guarantee notice there would come from the app embed `eu-warranty-garan/guarantee-cart-inline` (unverified). **No Mo widget** on this page.

---

## 8. Header, cart drawer and every add-to-cart path

### 8.1 Header (`sections/header.liquid`, group `header-group`)

`header-group.json` order: `header` (on), `announcement-bar` (off), `promotion-bar` (off). The live editor redesigned the header (`fh-*` classes, synced 2026-07-25):

- **Topbar**: country/language selectors (desktop), the Trusted Shops `<etrusted-widget data-etrusted-widget-id="wdg-b2459965-…">` (desktop) and `<minimized-trustbadge-inline-horizontal>` (mobile), restyled by an inline MutationObserver script (accent `#9A0000`). On the right are the account icon and a **cart icon with badge `[data-fh-cart-bubble]`** (desktop).
- **Main bar**: logo, menu (mega menus), desktop search form, then `.fh-mobile-header-icons` with account icon and a **cart icon with badge `#CartBubble[data-fh-cart-bubble]`**. The cart icons are wrapped in `<modal-trigger target="#cart-modal">`, so clicking opens the drawer instead of navigating (unless `cart_type == 'page'` or on `/cart`).
- Organization JSON-LD on every page. WebSite SearchAction JSON-LD on the home page.

### 8.2 Cart badge: why `#CartBubble` matters

| Mechanism | Where | Behaviour |
| --- | --- | --- |
| Theme updater `qe(count)` | `assets/main.mjs` | `document.getElementById("CartBubble")`, then sets `innerHTML` and toggles `.hidden`. **Throws if the element does not exist.** It is called from `product-form` and quick-add **before** the drawer opens. When the 2026-07-25 header redesign dropped the id, every add-to-cart threw and the drawer never opened (fixed 2026-10-01). |
| Exactly one `#CartBubble` | `sections/header.liquid` (mobile-icons badge, which always renders) | Comment in the file: keep the id on exactly ONE badge |
| Mirror observer | `sections/header.liquid` inline script | A `MutationObserver` on `#CartBubble` copies its text and `hidden` state onto every other `[data-fh-cart-bubble]`. This covers drawer quantity changes, which fire no events. |
| `updateHeaderCartBubble()` | `sections/header.liquid` inline script | `GET /cart.js` → sets all `[data-fh-cart-bubble]`. Triggered on DOMContentLoaded, on the document events `cart:updated`, `cart:refresh`, `cart:change` and `product:added-to-cart`, and 600 ms + 1200 ms after any `/cart/add` form submit or click on `[name="add"]`, `button[type="submit"]`, `.product-form__submit`. |
| Widget refresh | `ms-chat-widget.js → refreshCartUI()` / `setCartBubble()` / `pollCartAfterCheckout()` | On **every page where the widget mounts**, regardless of whether Mo was used, `refreshCartUI()` GETs the cart JSON (`cartJsUrl()` = `window.routes.cart_url`, which `layout/theme.liquid` sets to the locale-aware `{{ routes.cart_url }}.js`; fallback `/cart.js`) on `document` `visibilitychange` → visible, `window` `focus` and `window` `pageshow`. In addition, a click on Mo's „Zur Kasse“ (which opens a cart permalink in a **new tab**) starts a bounded poll at 1.2 s, 2.5 s, 4.5 s and 7 s (`pollCartAfterCheckout()`). It writes the count into `#CartBubble` **and** every `[data-fh-cart-bubble]`, and only when `item_count` changed it calls `<cart-modal>.reloadContent()` (silent, no open) and `reloadCartPageSection()`, which re-renders `.section-main-cart`. That last step is **inert in practice**: `.section-main-cart` exists only in `sections/main-cart.liquid` (the cart template), and the widget never mounts on `/cart` (§5.1). So only the badge update and the drawer reload have any effect. It only ever GETs here and never POSTs. |

### 8.3 Theme add-to-cart (product form → drawer)

From `assets/main.mjs` (class registered as `product-form`; the drawer is class `cart-modal`):

1. A submit of the `<form>` inside `<product-form>` is intercepted (`preventDefault`).
2. `POST {window.routes.cart_add_url}` (`/cart/add.js`) with `FormData` plus `sections=["cart-bubble"]` (plus `"variant-added"` when not in drawer mode, **or** when the form sits inside `#quick-add-modal`) and `sections_url=/variants/<id>`.
3. On error (`status` in the JSON response), the message is shown in `.message-danger`.
4. On success: `document.dispatchEvent(new CustomEvent("product:added-to-cart", { detail: { id, quantity } }))`, where `id` is the **variant id** (`this.querySelector("[name=id]").value`) and `quantity` is the raw FormData string (`n.get("quantity")`), then `qe(<count from cart-bubble section>)`.
5. `addedToCartNotification === "drawer"`: `en()` = `<cart-modal>.reloadContent()`, then `.show()`. `<cart-modal>` also listens to `product:added-to-cart` itself and reloads. **Exception:** inside the quick-add modal (`this.quickAddModal`), the drawer is not opened. The form calls `quickAddModal.showAddedToCartView()` with the `variant-added` section, or just hides the modal if the cart drawer is already open.
6. `<cart-modal>.reloadContent()` = `fetch(location.pathname + "?section_id=<cart-modal section id>")` and swaps the `[slot=content]` children (Section Rendering API).

**Theme document events** (other code can listen to them; nothing in the widget listens today):

| Event | Fired by | Detail |
| --- | --- | --- |
| `product:added-to-cart` | `main.mjs` (product-form, quick-add) | `{ id: <variant id>, quantity }`. product-form: `id` from the form's `[name=id]` (variant id, string), `quantity` = FormData string. Quick-add (`main.mjs` add-by-id helper): the same `id`/`quantity` it POSTs to `cart_add_url` (`sections_url` is `variants/<id>`, so `id` is a variant id). Backlog `07` D2 relies on this reading. |
| `variant:change` | `main.mjs` variant picker | variant data |
| `cart:updated`, `cart:refresh` | `product-detail-accordions.liquid` quick-add path | — |
| `cart:refresh`, `cart:change` | `ai_gen_block_677224a` (Premium collection grid) quick-add | `{ cart, product, variantId, source: 'premium-collection-grid' }`. Only these two carry the `source` tag usable for attribution or KPI listeners. |
| `ajaxProduct:added` | same | `{ product, addToCartBtn, cart }` (no `variantId`, no `source`). The block also writes `item_count` into `[data-cart-count], [data-header-cart-count]`, which do not exist in this header. |
| `visitorConsentCollected` | Shopify Customer Privacy API | the widget listens to this (§10) |

### 8.4 All add-to-cart paths on the storefront

| Path | Where | Mechanism | Drawer / badge |
| --- | --- | --- | --- |
| Product page Add to cart | `buy_buttons` block → `<product-form>` | §8.3 | Drawer opens. Badge via `qe()` + mirror. |
| Theme quick-add | `product-card` (`product_card_quick_add_to_cart: true`), `<quick-add-button>` / `quick-add-modal` | `main.mjs` add by id, sections `cart-bubble` + `variant-added`, `product:added-to-cart` | Drawer or modal |
| Recommendations accordion quick-add | PDP "Produktempfehlungen" | theme quick-add + `refreshCartModal()` | Drawer refreshed |
| Premium collection grid quick-add | `ai_gen_block_677224a` (SEO collection templates) | own `POST cart/add.js` with `items:[{id,quantity:1}]`, then `GET cart.js`, then events, then tries to open a sidebar via selectors `[data-js-sidebar-handle][aria-controls="site-cart-sidebar"]` / `.button--cart-handle` | Badge via `cart:refresh`/`cart:change` → `updateHeaderCartBubble()`. Those selectors do not exist in Essence, so **the drawer probably does not open** (unverified, §19). |
| Home-gym configurator | `page.home-gym-konfigurator` (`ai_gen_block_296597c`) | `POST /cart/add.js` with several items, then redirect to `/cart` | Cart page |
| **Mo „Zur Kasse“** | widget `add_to_cart` card | Opens the backend's combined `cartUrl` permalink (`…/cart/<v1>:1,<v2>:1`) in a **new tab** (AC §2 `add_to_cart`). Before opening it, re-stamps the attribution cart attributes (§10). | Chat tab reconciles the badge/drawer later (§8.2) |

### 8.5 Cart drawer (`sections/cart-modal.liquid`, group `overlay-group`)

`<cart-modal id="cart-modal" position="right">` contains, in this order: title + close, the **xbfsbu free-shipping upsell block** (`.xbfsbu-block[data-id="26e68865…"]`, app "xb-free-shipping-upsell"), the theme free-shipping indicator (disabled in settings: `cart_free_shipping_bar_enabled: false`), the line items, product recommendations (the setting list is **empty**, so nothing renders), the **Consentico EU legal-guarantee notice** (`#consentico-cart-modal`, a `<details>` „Ihre gesetzliche Gewährleistung“ loading `eu-guarantee.consentico.com/api/notice.svg|txt` per locale/country), the total, the tax/shipping note, the order-note and shipping-estimator triggers, „Warenkorb anzeigen“ and **Checkout** (`{% form 'cart' %}` with `name="checkout"`).

Mo-related styling (`assets/ms-chat-widget.css`):
- `body.no-scroll .ms-chat-launcher` and `.ms-chat-nudge` fade out while any theme drawer or modal holds the scroll lock (cart drawer, mobile menu, search). Without this, the launcher covered „Zur Kasse“ on mobile.
- `body.no-scroll .ms-chat-panel--sidebar { z-index: 1800 }`: the docked desktop chat sidebar drops below the theme's modal layers (overlay 1900 / panel 2000) so the cart drawer slides in on top of it.

---

## 9. Third-party apps and scripts

| App / script | How it is loaded | Where it shows | Relevance to Mo |
| --- | --- | --- | --- |
| **Trusted Shops** (reviews, trustbadge, "trstd-login") | `integrations.etrusted.com/applications/widget.js/v2` in `<head>`; `widgets.trustedshops.com/integration/integration.js` (`int-28ba4c97-…`) at end of body; app embed `trusted-shops-reviews-and-more/trstd-login`; app block review carousel on home | Header topbar stars widget, mobile trustbadge, home carousel; the integration script may add a floating trustbadge | Possible visual collision with the Mo launcher (bottom corner). Not verified (§19). |
| **Loox** reviews | App embed `loox-reviews/loox-inject`; markup in product custom_liquid blocks and tabs-cards tab 3; metafields `loox.*` | PDP stars, Reviews tab, collection grids | Review data is not passed to Mo by the theme |
| Judge.me (legacy) | Snippets `jdgm-trigger.liquid`, `judgeme-reviews-faq.liquid` (not rendered anywhere); old `.jdgm-*` rules in `settings_data.json → platform_customizations.custom_css` | — | Dead remnants |
| **Consentico** EU guarantee notice | Inline markup only in `sections/cart-modal.liquid` (`#consentico-cart-modal`); app embed `eu-warranty-garan/guarantee-cart-inline` | Cart drawer (inline); cart page only via the app embed, if at all (unverified) | — |
| **xbfsbu** free-shipping upsell | `.xbfsbu-block` in cart drawer + cart page; app embed `xb-free-shipping-upsell` | Cart | — |
| **Simesy EDD** (estimated delivery date) | App block in `product.json` + custom "Simesy LIQ" block; app embed `sm-estimated-delivery-date-edd` | PDP | Delivery promise visible next to the CTA |
| **Globo Product Options** | App block on PDP; app embed; products tagged `globo-product-options` are skipped in recommendations | PDP | Add-on options. Mo's cart permalink adds variants only, never Globo options (assumption based on the permalink format). |
| **Rapid Search** | App embeds `rapid-search-bar-filter` (script + search bar); `rapid-search-settings` snippet | Search results page, search bar | — |
| TARGOBANK financing | "PayMent + Targo neu" custom_liquid; `page.targo-response` | PDP | — |
| KB Back-in-stock, SC Easy Redirects, Madgic order limit, thanhbt file upload | App embeds in `settings_data.json → current.blocks` | various | — |
| Shopify Search & Discovery | Complementary-products metafield + Recommendations API | PDP accordions, Zubehör tab, related-products-03 | Same data the backend could read via Admin API |
| **Shopify analytics / web pixels / Customer Events** | `{{ content_for_header }}` | every page | Records the page URL, which is why the head script strips `ms_code` / `mo_c` first. Not editable in the theme. |
| AI-generated blocks (`blocks/ai_gen_block_*`) | Theme blocks with inline JS/CSS, created through Shopify's AI block generator by the live editor | Home, collections, PDP, pages | Several do their own cart adds and emit JSON-LD (FAQ Accordion). They are re-generated or edited in the live editor, so they drift often. |

There are **no** hard-coded GA, Meta, TikTok or other pixel scripts in the theme files. All tracking comes through `content_for_header` (apps / Customer Events). Nothing in the theme forwards Mo events to those pixels.

---

## 10. Consent / Shopify Customer Privacy API

- **Theme banner**: `sections/privacy-banner.liquid` (in `overlay-group`, enabled, no visibility conditions, so `<privacy-banner>` is in the DOM of every theme-layout page). `<privacy-banner>` in `main.mjs` (`connectedCallback()` → `loadShopifyFeatures()`) calls `window.Shopify.loadFeatures([{name:'consent-tracking-api', version:'0.1'}])` on **every** page outside the theme editor's design mode, **whether or not the banner is then shown**. `window.Shopify.customerPrivacy` is therefore normally present shortly after `main.mjs` runs. Only *showing* the banner is conditional: if `shouldShowBanner()` and any of marketing / analytics / preferences is undecided, it waits 1.5 s, **steps aside if Shopify's own banner `#shopify-pc__banner` exists**, and otherwise shows. „Accept“ sets all three to true and „Decline“ sets all three to false (no granular choice). The configured banner text is **English** ("We use cookies…", link to `/policies/privacy-policy`) even on the German store. Button labels come from locales.
- **Which banner is actually live** (the theme one or Shopify's Customer Privacy banner) cannot be determined from the repo (§19).
- **What Mo depends on**: order attribution runs only while `window.Shopify.customerPrivacy.analyticsProcessingAllowed() === true` (`ms-chat-widget.js → moAnalyticsAllowed()`). The widget **does not load the Customer Privacy API itself**. It relies on the theme's `<privacy-banner>` element having loaded it (which it does on every theme-layout page, see above), or on Shopify's own banner. The re-check schedule while the API is missing and the `visitorConsentCollected` listener: `06` §8.1 (owner of the attribution mechanics). No consent, or an API that never loads, means attribution is a silent no-op, and the share of Mo-influenced orders that can be attributed is capped by the analytics-consent rate.
- Data the widget writes into the Shopify cart: only the opaque `_mo` attribute from `POST /api/attribution/token` (`06` §8.3, AC §10). The raw session id never goes into a URL or a cart attribute.
- Newsletter in the theme: the footer block „Newsletter - Dein Boost der Woche“ and the `email-signup` sections use Shopify's native `{% form 'customer' %}` with `contact[tags]=newsletter` (`snippets/newsletter-signup-form.liquid`). That writes Shopify customer marketing consent directly. It is a separate **entry point**, not a separate consent: the backend keeps one marketing consent per person, shared with the shop's own newsletter consent in both directions, so a footer newsletter sign-up counts as the same consent and Mo sends no second DOI (AC §7 intro "One marketing consent, shared with Shopify"; backend [`../CONSENT_FLOW.md`](../CONSENT_FLOW.md) "The one consent (Shopify ⇄ Mo)"). The newsletter popup section is disabled.

---

## 11. Locales and languages

| Aspect | Fact |
| --- | --- |
| Storefront languages | German (shop default) and English under `/en` (subfolder). `config/markets.json` is empty, so market/language configuration lives in Shopify admin. |
| Locale files | `de.json` = German theme strings; `en.default.json` = the theme's *default-locale file* (English); `es/fr/it/nl.json` exist but are likely unpublished (§19). Only `de.json` starts with the "auto-generated, may be overwritten by the admin language editor" comment banner; `en.default.json`, `es/fr/it/nl.json` and `en.default.schema.json` are plain JSON. The 2026-10-01 live snapshot rewrote `en.default.json` as a single minified line. |
| Keys used by Mo-related theme parts | `products.product.qa_tab_label` (de „Q&A“, en "Q&A"); `products.product.qa_answered_by` (de „Beantwortet vom motion sports Team“, en "Answered by the motion sports team"). Missing in `es/fr/it/nl.json`, where they would fall back to the English default. |
| Widget locale | Snippet: `locale: localization.language.iso_code \| default: request.locale.iso_code`. JS: `msNormLocale` maps it to `en` or `de` (default `de`); an `/en` path always forces `en`. The locale is sent on locale-bearing calls (`x-ms-locale` header, body `locale`, `?locale=`; which endpoint reads it: AC §12). `/api/products` and `/api/kpi` take no locale. Widget-owned strings use `L(de, en)`; backend-served consent/legal copy is rendered verbatim per locale. |
| Not localised | The product CTA label (German literal in the `product*.json` CTA blocks), the header search placeholder, all custom_liquid / AI-block copy (German literals), the privacy banner text (English literal) |

---

## 12. Theme settings relevant to Mo

### 12.1 `config/settings_schema.json → "AI Advisor"`

This table is the one list of the Mo theme settings; `02` §3.1 points here.

| Setting id | Type | Default | Current value (`settings_data.json`) | Meaning |
| --- | --- | --- | --- | --- |
| (paragraph) | paragraph | — | — | "AI-powered chat widget that talks to the headless backend. Paste the shared secret below, then enable the widget." |
| `ai_advisor_enabled` | checkbox | `false` | **`true`** | Master switch. Gates the widget snippet, the head script in `theme.liquid`, and the product CTA blocks. |
| `ai_advisor_backend_url` | text | `https://mo.motionsports.de` | absent, so the default applies | `MS_CHAT_CONFIG.apiBase`. Trailing slashes are stripped in JS. |
| `ms_chat_shared_secret` | text | — | set (64-hex string; deliberately not reproduced here) | `MS_CHAT_CONFIG.chatKey`, which becomes the `x-ms-chat-key` header. Public by design (page source). Security comes from the backend origin allowlist and rate limiting. Empty means the widget does not mount: the snippet then loads no config and no JS and hides the product CTA (§5.1). Security model: AC §1. Rotating it means changing the backend env, then the theme setting in the editor, then re-syncing the repo (the value is also committed in `settings_data.json`). |
| `ai_advisor_excluded_templates` | textarea | `cart` | absent, so the default `cart` applies | Extra templates to hide the widget on (§5.1) |

### 12.2 `window.MS_CHAT_CONFIG` (as injected by `snippets/ms-chat-widget.liquid`)

The snippet emits `apiBase` (from `ai_advisor_backend_url`), `chatKey` (from `ms_chat_shared_secret`), `showroomUrl` (hard-coded `https://motionsports.de/pages/showroom-munchen-grobenzell`, not a setting), `allowedFromTheme` (never read by the JS), `locale` and `pageContext`; the JS also reads `whoamiPath`, which the snippet never emits. Field table with JS defaults and use: `02` §3.2 (owner).

### 12.3 Other theme settings that affect Mo's environment

| Setting | Value | Effect |
| --- | --- | --- |
| `cart_type` | `drawer` | Cart icon opens `<cart-modal>` |
| `added_to_cart_notification` | `drawer` | product-form opens the drawer after an add |
| `cart_free_shipping_bar_enabled` | `false` (threshold 6) | The theme bar is off. The xbfsbu app shows shipping info instead. |
| `product_card_quick_add_to_cart` | `true` | Quick-add on cards |
| `colors_secondary_button_background` | `#008ccb` | Brand blue, used by the CTA hover |
| `type_body_font` / `type_heading_font` | Montserrat | The widget CSS pulls theme CSS custom properties |
| App embeds | `settings_data.json → current.blocks` (12 embeds, all enabled) | §9 |
| `platform_customizations.custom_css` | ~25 global CSS rules added in the editor | Can affect any element, including PDP spacing |

---

## 13. Metafields the theme reads

All are product metafields unless noted. "Mo-relevant" means it affects what a shopper sees next to Mo, or it is data the backend writes.

| Metafield | Type (inferred) | Where rendered | Mo relevance |
| --- | --- | --- | --- |
| **`custom.qa`** | JSON | PDP Q&A tab + FAQPage JSON-LD (§6.5) | **Written by the backend** (Wissen tab). Also synced back into Mo's catalog context (`QA_KNOWLEDGE.md`). |
| **`custom.kurzinfo`** | rich text | PDP "Highlights" accordion (`product-detail-accordions`), disabled "USPs mit MO" block, `produktdesign-02` "USPs" | The USP bullets right under the Mo CTA. The catalog sync reads it as the product's `shortDescription` (backend `../CATALOG_SYNC.md`). |
| `custom.kurztext` | rich text | PDP "Details" tab, left column (spec table) | Spec table |
| `custom.kurzbeschreibung` | rich text | Details-tab fallback; disabled text block | |
| `custom.zusatzbilder` | file or list of files | Details tab, right column (max 2) | |
| `custom.slide_1_image` … `custom.slide_4_image` | image | "Product Image Slide 1 - 4" gallery | |
| `custom.liefereinheit` | text | under the variant picker | Delivery unit (e.g. per pair) |
| `custom.primary_collection` | collection reference | breadcrumb | Product's canonical category |
| `custom.badges` | — | `product-custom-badges` (cards / PDP) | |
| `custom.hide_from_search` | boolean | predictive search + collection grid page | Hidden products |
| `custom_gallery.images` | — | `snippets/custom-gallery.liquid` (snippet not rendered anywhere) | dead |
| `shopify--discovery--product_recommendation.complementary_products` | list of product refs | PDP "Produktempfehlungen" accordion | Merchant-curated accessories. Same signal Mo could use for bundles. |
| `loox.avg_rating`, `loox.num_reviews`, `loox.rating`, `loox.review_count` | number | stars on PDP and cards, Premium grid | Social proof |
| `reviews.rating`, `reviews.rating_count` | rating | `product-rating` snippet (cards) | |
| `judgeme.*` | — | legacy snippets only | dead |
| shop metafield `rapid-search.*` | — | `rapid-search-settings` | — |

The merchandising team edits the `custom.*` metafields (except `custom.qa`) in Shopify admin. The backend must not overwrite them without an explicit decision. Only `custom.qa` is backend-owned today.

---

## 14. Browser storage on the storefront

The theme and the widget share the origin's storage. Theme keys (vendor):

| Key | Store | Written by |
| --- | --- | --- |
| `essence:recently-viewed-products` | localStorage | `layout/theme.liquid` on product pages (array of product ids) |
| `essence:newsletter-subscribed`, `essence:newsletter-popup-dismissed` | localStorage | `newsletter-signup-form.liquid`, `main.mjs` |
| `secret_access_granted` | sessionStorage | `sections/password-protect-secret-sales.liquid` (secret-sales page password gate; value `'true'`, also removed there) |

Mo keys (`ms-chat-*`, `ms-mo-attr`, `ms_mo_c`, including `ms-chat-early-params`, which the theme head script writes): `02` §6, the one complete list with store, writer, clearer and lifetime.

---

## 15. URL parameters a storefront page reacts to

Any storefront URL (any page where the widget renders) accepts:

| Param | Handled by | Effect | Stripped from URL? |
| --- | --- | --- | --- |
| `mo=open` or hash `#mo-open` | `ms-chat-widget.js → handleMoDeepLink()` | Opens the panel once init has finished (like a launcher click, via `openPanel()`). No chat request and no product priming. Like any panel open, it fires `chat_opened` (`POST /api/kpi`), sets sessionStorage `ms-chat-opened` (which suppresses nudges for the tab session) and runs the lazy auth detection (`resolveAuthOnOpen()` → `detectSignedIn()`: same-origin `GET /apps/chat/whoami` once per tab session; `/api/auth/me` only with a local hint, `shouldProbeAuth()`). Funnels should treat these opens as not user-initiated. | yes (`replaceState`), but only after `content_for_header` has seen it |
| `mo_new=1` (with `mo=open`) | same | Fresh consultation (drops the local thread; anonymous visitors also rotate the session id) | yes |
| `mo_view=fullscreen` (with `mo=open`) | same | Opens in the desktop modal ("expanded") mode without persisting the preference | yes |
| `mo_c=<token>` (`^[A-Za-z0-9_-]{16,64}$`) | head script (PR #73) + `captureCampaignToken()` | Stored in sessionStorage `ms_mo_c`, sent once as `campaignToken` on the next `POST /api/chat` (AC §2 "Optional `campaignToken`"), deleted on `res.ok`. A malformed value is dropped. | yes, **before** analytics (PR #73) |
| `ms_auth=ok\|login_required\|logged_out\|error` + `ms_code=<43 chars>` | head script (PR #73) + `readAuthReturn()` / `handleAuthReturn()` | Sign-in return. The one-time code is redeemed at `POST /api/auth/link` (ACCT §2a). | yes, **before** analytics (PR #73) |
| `utm_*` | — | Left untouched for the shop's analytics | no |

Combine freely, e.g. `https://motionsports.de/products/<handle>?mo=open&mo_c=<token>`. That opens Mo on that product page with `pageContext` set, but it does **not** send the product primer. Only the CTA click does that.

---

## 16. Operational model

### 16.1 Two places edit the same theme

1. **This repo** (Mo work by coding agents, PR-reviewed).
2. **The live Shopify theme editor / code editor** (another person edits sections, templates, app blocks, AI blocks and custom CSS, and saves `settings_data.json`).

Neither one sees the other's changes automatically.

### 16.2 Deployment is manual

- Nothing deploys from git. After a PR is merged to `main`, the owner **copies the changed files into the Shopify code editor** by hand.
- `MANIFEST.md` is the upload checklist. Each session adds a dated "⭐ Session update" section with a table `Path | Status | Re-upload to Shopify?`, a list of changes, and usually a test checklist. Newest is on top.
- Files that are mostly ours and can be replaced whole: `assets/ms-chat-widget.js`, `assets/ms-chat-widget.css`, `snippets/ms-chat-widget.liquid`, `snippets/product-qa.liquid`. Shared files (`layout/theme.liquid`, `sections/header.liquid`, `sections/tabs-cards.liquid`, `templates/product.json`, `config/settings_schema.json`, `snippets/product-detail-accordions.liquid`) should be **hand-edited** in the live editor (MANIFEST gives the exact spots), so that live-only changes are not overwritten.
- **Theme settings** (`settings_data.json`) are never uploaded from the repo. Values are set in the theme editor.

### 16.3 Re-sync from a live snapshot (three-way merge)

1. Download the live theme from Shopify.
2. Commit the snapshot **on top of the previous sync commit** (e.g. `5e11f2b "Live theme snapshot 2026-10-01"` has parent `cf9bc43`, the previous sync) on its own branch.
3. Merge that branch into `main` (e.g. `959f213` / `dc73106 "Resync clone with live theme snapshot 2026-10-01"`). Git's merge base is the previous snapshot, so editor-side changes and repo-side changes combine. Conflicts show where both sides touched the same lines.
4. Verify every Mo hook after the merge (theme.liquid render + head script, settings schema, product CTA, Q&A tab, `#CartBubble`, cart attribution, consent gate).

**What went wrong before:** the 2026-08-12 sync (`f7dc50a "updated"`) was committed **directly on top of `main`** instead of as a merge. It replaced `ms-chat-widget.js` with a pre-PR #67 copy. Live then ran PR #67's CSS with old JS (starter prompts back, no popup after the first message) and lost PR #62 (`?mo=open` deep link). This was found and restored on 2026-10-01 (`beff918`).

### 16.4 Current deployment state

Not kept in this chapter: which build is live and which switches are on lives in `docs/ROLLOUT_TODO.md`, and which build the shop serves is checked with `npm run verify:widget` (README §4). The table that stood here on 2026-10-04 is archived in `docs/archive/FRONTEND_STATUS_2026-10-04.md`.

### 16.5 Risks that come from this model

- **Drift and silent reverts.** Any live-editor save of a shared file, or a careless snapshot commit, can undo Mo work. Always diff the Mo footprint (§2.3) after a sync.
- **Editor-owned Mo markup.** The "MO only" CTA block lives in `templates/product.json`, `product.produkt-new.json`, `product.produktnew.json` and `product.produkte-im-set.json`, all of which the editor overwrites. Renaming, disabling or moving it removes the main PDP entry point without any repo change. Uploading a repo copy of an editor-owned template overwrites the editor's changes to it; adding a block by hand in the editor avoids that.
- **Upload lag.** Backend features that need a widget change are inert until the owner uploads. Backend switches that depend on the new widget behaviour (for example `CHAT_PAGE_CONTEXT_ENABLED`, default off in code) stay off until the build is live and checked (README §4: `docs/ROLLOUT_TODO.md`, `npm run verify:widget`). Design backend changes to be **backward compatible with the widget currently live** (AC §0 rule 3).
- **No staging pipeline.** `MANIFEST.md` install notes mention a "development theme", but whether one exists and is kept in sync is unknown. Test checklists are run manually after upload.
- **Theme-JS coupling.** The theme's `qe()` needs `#CartBubble`. The widget calls `<cart-modal>.reloadContent()` and writes into `#CartBubble` / `[data-fh-cart-bubble]` (its `.section-main-cart` re-render is inert, because the widget never mounts on `/cart`, §8.2). A theme update or header redesign can break these hooks.
- **Stale docs in the theme repo.** Comments in `snippets/ms-chat-widget.liquid` and the JS header refer to `docs/ai-advisor/*`, which does not exist in this repo (the contract lives in the backend's `docs/frontend/`). The bottom "How to install" part of `MANIFEST.md` still names old backend URLs (`motionsports-chatbot.vercel.app`, `chat.motionsports.de`).

---

## 17. Where the backend can influence the storefront

### 17.1 Without a theme change (backend deploy or Admin API only)

| Lever | Mechanism | Visible effect | Caveats |
| --- | --- | --- | --- |
| **Everything Mo says and the tool cards' data** | `/api/chat` stream, tool inputs (`message`, product ids), `/api/products` (`name`, `price`/`salePrice`, `images`, `shopifyUrl`, `variants`, `qa`, top-level `cartUrl`; what the widget reads: `03` §7, contract AC §3) | Chat replies, product cards, compare tables, checkout card, showroom card, contact form | Only **existing** tool types and fields render. A new card type needs a widget change. Unknown tools render nothing (exact name match, `03` §6). |
| **Served legal / consent / erase copy** | `GET /api/consent-copy?surface=…` (AC §7.4), per locale | Capture form, consent popup, inline opt-in card, erase dialog | Rendered verbatim. Lawyer changes ship with a backend deploy. |
| **PDP Q&A tab + FAQ rich results** | Admin API `metafieldsSet` on `custom.qa` (§6.5) | New Q&A rows on the PDP; FAQPage JSON-LD for Google | Max 20; `a_html` is output raw (keep sanitizing); `[]` hides the tab. Language fallback rules as in §6.5. Shopify's storefront cache may delay visibility briefly (unverified). |
| Other product metafields (`custom.kurzinfo`, `custom.kurztext`, complementary products, …) | Admin API | Highlights accordion, Details tab, Produktempfehlungen | **Owned by merchandising.** Technically writable, but do not write without an explicit owner decision. |
| **Order attribution marker** | `cartAttributes` object returned by `POST /api/attribution/token` | Whatever keys/values the backend returns are stamped onto the cart and end up on the order | The widget passes the object through unchanged. It must stay a flat object. Stamping happens only with analytics consent. |
| **Deep links into an open chat** | Build URLs with `?mo=open`, `mo_new=1`, `mo_view=fullscreen`, `mo_c=<token>` on any storefront path (§15) | Campaign mails, ads, QR codes (showroom, packaging), order mails can land shoppers in an open consultation, attributed to a campaign | `mo_c` is handled by the head script and the widget (PR #73). `mo=open` does not prime a product. |
| Sign-in return handling | `return_url` / `ms_auth` / `ms_code` | Re-hydrated signed-in chat | Allowlisted origins only (ACCT §2) |
| Server-side feature switches | e.g. `CHAT_ORDER_STATUS_ENABLED`, model/prompt config, rate limits | Behaviour of Mo | Keep compatible with the live widget version (AC §0 rule 3; which build is live: README §4) |
| Shopify admin configuration (not theme) | App Proxy (`/apps/chat/whoami`), Search & Discovery recommendations, discounts, markets/languages, customer-account type | Shop recognition, recommendation sources, … | Done in Shopify admin by the owner, not via theme upload. **App Proxy:** steps in `docs/ROLLOUT_TODO.md` 5.4; the backend issues sign-in codes from it only with `APP_PROXY_SIGNIN_ENABLED` and a proof, both default off in code (ACCT §3a); the widget only redeems the whoami `linkCode` (`04` §5). It must never run under the pre-PR #73 widget, which trusted a whoami `signedIn:true` answer without a code (`02` §1.1; `npm run verify:widget` flags that build). |
| Theme **settings** (editor, no code) | `ai_advisor_enabled`, `ai_advisor_backend_url`, `ms_chat_shared_secret`, `ai_advisor_excluded_templates` | Kill switch, backend origin, secret rotation, per-template hiding | Needs someone in the theme editor. Remember to re-sync `settings_data.json`. |

### 17.2 Needs a theme change (frontend task + manual upload)

| Change | Files involved | Notes for writing the task |
| --- | --- | --- |
| Any new widget UI, tool card, KPI event, storage key, gate/popup logic | `assets/ms-chat-widget.js` / `.css` | Whole-file upload. Reference the backend contract section. |
| More page facts for Mo (variant id, price, availability, tags, collection membership, cart contents, a shop-login hint `{% if customer %}`) | `snippets/ms-chat-widget.liquid → pageContext` + JS consumer | Privacy posture: page facts only, no user data. A Liquid `customer` flag would be a client-side hint only, **not** a trustworthy identity (the App Proxy is the secure path, ACCT §3a). |
| New Mo entry points: collection pages, „Hast du noch Fragen?“ blocks, the PDP FAQ cards, search "no results", the cart drawer, the 404 page, the header | Templates / sections / AI blocks (mostly **live-editor owned**) | A product-primed button works anywhere with `class="ms-chat-product-cta" data-ms-chat-product-id data-ms-chat-product-title` (delegated handler). A **generic** "open Mo" (or "open with a topic") has no public JS API today, only `?mo=open` (page reload) or the launcher. A new `window.MS_CHAT.open(…)` needs a widget change. |
| Showing the widget on `/cart` | `snippets/ms-chat-widget.liquid` hard exclusion | Deliberate exclusion today. Needs a product decision. |
| CTA copy / placement / English label | `templates/product.json` ("MO only" block, editor-owned), the same block in `product.produkt-new` / `product.produktnew` / `product.produkte-im-set`, and the Kurzinfo variant in `product.produktdesign-02` | Coordinate with the live editor, or the next sync will revert it |
| Q&A rendering changes (more than 20 entries, markdown in the theme, tab deep link `#qa`, Q&A on other templates) | `snippets/product-qa.liquid`, `sections/tabs-cards.liquid` | Keep the 20-cap in sync with the backend `QA_MAX_PER_PRODUCT` |
| New URL params to strip before analytics | `layout/theme.liquid` head script list (`['ms_auth','ms_code','mo_c']`) + JS | Only params that are secrets or per-person tokens |
| Re-stamping attribution after theme add-to-cart | widget JS (listen to `product:added-to-cart`) | AC §10 asks for a re-stamp after each Mo `add_to_cart` click, which the widget meets. When it stamps today: `06` §8.4; it does not observe the theme's `product:added-to-cart`, so a cart cleared by a completed checkout is re-stamped only on the next widget page load (`06` F7, backlog `07` D2). Improvement, not a contract gap. |
| Feeding theme add-to-cart / checkout clicks into Mo KPIs | widget JS listening to the theme events in §8.3 | Today no theme event reaches `/api/kpi` |
| Loading the Customer Privacy API proactively | widget JS (`Shopify.loadFeatures([{name:'consent-tracking-api'}])`) | Not needed today: the theme's `<privacy-banner>` loads it on every theme-layout page (§10). Only matters if the `privacy-banner` section is removed from `overlay-group` or `main.mjs` fails to load. |

**How to phrase a frontend task:** follow the template in `07` §4 and the rules in AC §0; name the contract section, the exact widget function or file, the trigger and timing, the KPI events (canonical names from AC §5), the storage keys and their lifetime, the consent preconditions, the failure mode (fail-silent vs visible), the German + English UI strings verbatim, the `MANIFEST.md` upload list, and whether a backend switch must wait for the upload.

---

## 18. Observations relevant to KPIs

These are facts from the code, listed because they bear on opt-ins, sign-ins, product clicks, add-to-cart / checkout, attributed revenue and campaign chats. They are not decisions.

- **PDP entry point placement:** the only explicit Mo CTA is a small underlined text link above the price. The two large "questions?" modules lower on the PDP („Bestellung, Lieferung & Pflege.“ / „Kann ich mich vor dem Kauf beraten lassen?“ and „Hast du noch Fragen?“) point to phone, e-mail and showroom only. The same „Hast du noch Fragen?“ block appears on most SEO collection templates.
- **Coverage gaps:** all 5 product templates have a CTA; three of them (`produkt-new`, `produktnew`, `produkte-im-set`) only since 2026-10-04 (§6.6), so `product_cta_opened` counts before and after that day are not comparable. Collection pages have no CTA, only the launcher and nudge.
- **Attribution ceiling:** stamping requires analytics consent (§10). Unconsented orders after a consultation are not attributed.
- **Several add-to-cart paths fire different events or none** (§8.4). The widget observes none of them for KPI or re-stamping.
- **Language:** the CTA label, header search, and all editorial blocks are German-only on `/en`. The widget switches to English.
- **Cart drawer recommendations are empty** (the setting list is empty), so nothing is shown there.
- **Order status in the theme** goes through a contact-form page (`page.bestellstatus`). In the chat, the silent `get_order_status` tool answers customers signed in through the chat's own „Anmelden“ while the backend switch `CHAT_ORDER_STATUS_ENABLED` is on (default off in code; while off, only for the test accounts in `CHAT_ORDER_STATUS_TEST_CUSTOMERS`; AC §2 "Tools the widget MUST NOT render", ACCT §3a); the widget renders nothing for it.
- **Contact-form KPI join:** `contact_form_submitted` rows are session-keyed: the widget sends `sessionId` in the `POST /api/contact` body, and the backend falls back to the `x-ms-session` header (AC §4). Rows from before the 2026-10-04 upload have `sessionId: null`.
- **Editorial buying advice** (comparison tables, FAQ accordions with JSON-LD on collection pages) is written in theme settings and not available to Mo.

---

## 19. Open questions / uncertainties

1. **Which products use which product template.** This is assigned in Shopify admin. It decides which PDPs lack the Q&A tab (`produkte-im-set`) and which CTA variant a product shows (§6.6).
2. **Which cookie banner is visible on live, and the real analytics-consent rate.** The theme's `<privacy-banner>` (English text) or Shopify's Customer Privacy banner (`#shopify-pc__banner`). The Customer Privacy API itself is loaded on every theme-layout page by the theme's `<privacy-banner>` element (§10); the consent rate caps the widget's attribution.
3. **Classic vs new customer accounts.** This affects whether `/apps/chat/whoami` can ever report `logged_in_customer_id` (ACCT §3a) and whether the widget appears on account pages.
4. **Published languages / markets.** `markets.json` is empty. Whether `es/fr/it/nl` are published is unknown. `/en` is confirmed only by the widget/spec logic.
5. **Premium collection grid quick-add**: whether the drawer opens. Its open selectors look like a different theme's and probably do not match Essence. Not tested here.
6. **Lieferung accordion**: `delivery_date` is not assigned anywhere visible, so the accordion is assumed to never render. Not verified on live.
7. **Trusted Shops trustbadge position** relative to the Mo launcher (overlap on mobile). Not verified.
8. **Cart permalink and attribution**: the widget stamps the *current* cart before opening Mo's `/cart/<v>:<q>` permalink in a new tab. Whether that permalink's checkout keeps those cart attributes depends on Shopify permalink behaviour and OA. Not verifiable from the theme.
9. **Live parity**: this chapter describes `main` at `3e87341`; which build the shop serves: README §4 (`npm run verify:widget`). The live theme may also differ through editor changes since the 2026-10-01 snapshot.
10. **Storefront cache delay** for metafield-driven content (`custom.qa`) after `metafieldsSet`. Not measured.
11. **Existence of a development / staging theme** used for the MANIFEST test checklists.
