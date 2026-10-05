# 02 — Mo widget architecture

This chapter explains how the Mo chat widget is built and how it starts on the motionsports.de storefront. It covers the load path from the theme layout to the running script, every configuration field, the internal layout of `assets/ms-chat-widget.js`, the global state, **every** browser-storage key, the session-id lifecycle, multi-tab behaviour, layout modes, stacking against the theme, CSS, i18n, accessibility, browser support, performance and error-handling conventions. It ends with the constraints for future changes and a list of risks and open questions.
Backend behaviour is not re-specified here. It is cross-referenced to the widget contract in this folder: `API_CONTRACT.md` ("API_CONTRACT §n" or "AC §n"), `ACCOUNT_CONTRACT.md` (ACCT §n) and `CONSENT_CONTRACT.md` (CONS §n); `ORDER_ATTRIBUTION.md` (OA) is the backend's `docs/ORDER_ATTRIBUTION.md`. Aliases: README §1.
All code locations are given as `file → function / selector / key`. Line numbers are left out on purpose because they drift.
**Source of truth:** the theme repo `ms_shopify_clone`, branch `main` at `3e87341` (PR #73 "customer platform" `a0df103` + the fixes `8d0a0c4` + `3e87341`; README). Production state: README §4. Data recorded before 2026-10-04 comes from an older widget (§1.1).

**Contents**

1. [At a glance](#1-at-a-glance)
2. [Load path and boot sequence](#2-load-path-and-boot-sequence)
3. [Configuration reference](#3-configuration-reference)
4. [Internal structure of `ms-chat-widget.js`](#4-internal-structure-of-ms-chat-widgetjs)
5. [Global state](#5-global-state)
6. [Storage keys (complete)](#6-storage-keys-complete)
7. [Session id lifecycle](#7-session-id-lifecycle)
8. [Multi-tab behaviour](#8-multi-tab-behaviour)
9. [Network surface and what leaves the browser](#9-network-surface-and-what-leaves-the-browser)
10. [Layout modes and viewport handling](#10-layout-modes-and-viewport-handling)
11. [Launcher, nudge and attention bounce](#11-launcher-nudge-and-attention-bounce)
12. [Stacking and coexistence with the theme](#12-stacking-and-coexistence-with-the-theme)
13. [CSS architecture](#13-css-architecture)
14. [Internationalisation (i18n)](#14-internationalisation-i18n)
15. [Accessibility](#15-accessibility)
16. [Browser support assumptions](#16-browser-support-assumptions)
17. [Performance and size](#17-performance-and-size)
18. [Error-handling conventions](#18-error-handling-conventions)
19. [KPI events emitted by the widget (index)](#19-kpi-events-emitted-by-the-widget-index)
20. [Development constraints for future changes](#20-development-constraints-for-future-changes)
21. [Known issues and risks found while documenting](#21-known-issues-and-risks-found-while-documenting)
22. [Open questions / uncertainties](#22-open-questions--uncertainties)

---

## 1. At a glance

| Item | Value |
| --- | --- |
| Runtime | One vanilla-JS IIFE in `'use strict'`, written in ES5 syntax (`var`, `function`, no arrow functions, no classes, no template literals). No framework, no bundler, no npm, no external libraries. |
| Files | `assets/ms-chat-widget.js` (~6,300 lines, ~316 KB raw / ~92 KB gzip), `assets/ms-chat-widget.css` (~1,780 lines, ~70 KB raw / ~18.5 KB gzip), `snippets/ms-chat-widget.liquid` (render gate and config), an inline `<head>` script in `layout/theme.liquid`, the "AI Advisor" section in `config/settings_schema.json`. |
| DOM | Everything is built at runtime under a single `<div class="ms-chat-root">` appended to `<body>` (`buildShell()`). There is no Shadow DOM. Isolation comes from the `.ms-chat-` class prefix. |
| Exceptions outside the root | Classes on `<html>` (`ms-chat-page-shift`, `ms-chat-page-anim`, `ms-chat-mobile-open`), server-rendered `.ms-chat-product-cta` buttons in product templates, writes to the theme's cart badges (`#CartBubble`, `[data-fh-cart-bubble]`), `<cart-modal>.reloadContent()`, the `.section-main-cart` section, and the live Shopify cart (`/cart/update.js`). |
| Backend | `https://mo.motionsports.de` (Next.js on Vercel). Contract: `API_CONTRACT.md`, `ACCOUNT_CONTRACT.md`, `CONSENT_CONTRACT.md` (this folder); the rules every widget change keeps: AC §0. |
| Public JS API | `window.MS_CHAT.openWithProduct(id, title)` and `window.MS_CHAT.openEmailSummary()`, set in `init()`. |
| Deployment | Manual. The owner copies changed files into the Shopify code editor. `MANIFEST.md` lists the files to upload for each session (see §20). |

### 1.1 History: data recorded before 2026-10-04

The widget described here went live in two uploads on 2026-10-04: first PR #73 (`a0df103`: `assets/ms-chat-widget.js`, `assets/ms-chat-widget.css`, `layout/theme.liquid`, together with `snippets/product-qa.liquid`, `sections/header.liquid` and `snippets/product-detail-accordions.liquid` from the 2026-10-01 round), then the follow-up fixes (`8d0a0c4` + `3e87341`: the JS again, `snippets/ms-chat-widget.liquid` and three product templates). Rows tagged **[PR #73]** in later sections mark what PR #73 changed; that matters only when reading data recorded **before 2026-10-04**. Which build is live now: README §4.

**Historical: pre-PR #73 widget (`44a076b`, live until 2026-10-04).** Use this table only to interpret KPI or session data recorded before the upload.

| Topic | Pre-PR #73 (`44a076b`, live until 2026-10-04) | PR #73 (from 2026-10-04) |
| --- | --- | --- |
| `<head>` stash (§2.2) | none. `layout/theme.liquid` has no `ms-chat-early-params` script, so `ms_auth` (and any `ms_code` / `mo_c`) stayed in the URL that Shopify analytics recorded | `ms-chat-early-params` stash, stripped before `content_for_header` |
| Sign-in return | `handleAuthReturn()` strips only `ms_auth`, then calls `probeAuth(true)`. There is no `ms_code` redeem and no `POST /api/auth/link`. The backend has required the redeem since 2026-10-03, so **sign-in did not complete on live from 2026-10-03 until the 2026-10-04 upload** | `readAuthReturn()` + `redeemLinkCode()` (`POST /api/auth/link`), `ms-chat-login-sid`, 503 retry (`ms-chat-link-retry`, `retryPendingLink()`) |
| Campaign token | no `captureCampaignToken()` and no `ms_mo_c` key. No `campaignToken` was sent on `/api/chat`, so `campaign_chat_started` is **0** before 2026-10-04 | `ms_mo_c` → `campaignToken` on the first `/api/chat` |
| App Proxy whoami | `detectViaStorefront(force)` asks `/apps/chat/whoami` on the first detection of each page **and on every forced re-detect** (`credentials:'same-origin'`). A JSON `signedIn:true` answer goes **straight into `applyAuth(data)` as identity**, with no `linkCode` redeem. Shopify returned its HTML 404 page (no App Proxy), so nothing happened | once per tab session (`ms-chat-whoami-done`), `credentials:'include'`, identity only after `redeemLinkCode(linkCode, 'shop')` + `probeAuth(true)` |
| Sign-out | `signOut()` = `track('account_signout')` + `applyAuth(null)` + `closeHistory()`. **The sid was kept** (sid continuity across sign-out in pre-2026-10-04 data) | `dropSessionHistory()` → new sid |
| Erase | after `erased:true` (or 401) it clears history and the thread key, calls `moAttrReset()` and `applyAuth(null)`. **The sid was kept**, and the widget emitted **`account_erased`** | `clearAfterErase()` → new sid; no widget erase event |
| Server-ended session | no `endedSignInCleanup()`: history and sid were kept | `endedSignInCleanup()` → `dropSessionHistory()` |
| Multi-tab | no `storage` listener, no `onSidChangedElsewhere()`, no cross-tab adoption | §8 |
| Silent tools | `SILENT_TOOLS = ['update_customer_profile', 'search_products']`. A `get_order_status` part was **not** silent (harmless because `CHAT_ORDER_STATUS_ENABLED` was off) | adds `get_order_status` |
| Other keys missing before PR #73 | `ms-chat-auth-via:<sid>`, `ms-chat-optin-ask-shown` | §6 |

**The follow-up fixes (`8d0a0c4`, `3e87341`), from their upload on 2026-10-04:** `contact_form_submitted` carries the session (rows before have `sessionId: null`; the backend also falls back to `x-ms-session`, AC §4); the `order_support` contact reason has its own label; the CTA is on three more product templates (`product_cta_opened` volumes are not comparable across that day) and hidden where the widget does not render; an empty shared secret loads nothing; new chat / open conversation cancel a streaming reply and stop queued speech (§21 items 1, 3, 18, 19).

---

## 2. Load path and boot sequence

### 2.1 Overview

```
layout/theme.liquid
 ├─ <head>, right after <meta charset>:  inline "early param stash" script   (only if settings.ai_advisor_enabled)
 ├─ <head>: main.mjs (theme bundle, type=module defer), then {{ content_for_header }}  (Shopify analytics / web pixels)
 └─ end of <body>: {% render 'ms-chat-widget' %}
       snippets/ms-chat-widget.liquid
        ├─ gate: setting on, not cart/checkout, shared secret set, not an excluded template
        │    └─ gate fails (setting on): <style> hiding .ms-chat-product-advisor / .ms-chat-product-cta
        ├─ <link rel=stylesheet> ms-chat-widget.css
        ├─ <script> window.MS_CHAT_CONFIG = {...} </script>
        └─ <script src=ms-chat-widget.js defer>
              IIFE preamble (config, locale, copy tables, mount guards, storage, sid)
              → init()  (immediately, or on DOMContentLoaded if readyState is still 'loading')
```

### 2.2 The `<head>` stash script (`layout/theme.liquid`) [PR #73]

Added by PR #73 (2026-10-04). The pre-PR #73 `layout/theme.liquid` (`44a076b`) had no such script (§1.1).

- **Where:** inside `{%- if settings.ai_advisor_enabled -%}`, directly after `<meta charset="utf-8">` and **before** `{{ content_for_header }}`.
- **Why:** Shopify analytics and Customer Events web pixels run from `content_for_header` and record the page URL. The deferred widget script runs too late to strip secrets from the URL first. This script removes them before any of that runs.
- **What it does:** it reads the query parameters `ms_auth`, `ms_code` (the one-time sign-in code) and `mo_c` (the campaign token). If at least one is present:
  1. It stores `{ at: Date.now(), ms_auth?, ms_code?, mo_c? }` as JSON in **sessionStorage** under `ms-chat-early-params`.
  2. It removes the three parameters from the address bar with `history.replaceState` and keeps `history.state`.
- **Failure mode:** everything sits in a `try/catch`. If the sessionStorage write throws, `replaceState` is never reached, so the URL keeps the parameters and the widget's own URL fallback still sees them.
- **Consumer:** `ms-chat-widget.js → earlyParam(name)`. It reads the stash once, deletes it on read, and honours it only while it is younger than `LINK_RETRY_MAX_MS` (10 minutes). The values are then cached in the in-memory `earlyParams`.
- **Note:** the stash script is gated only on `ai_advisor_enabled`. It also runs on templates where the snippet does **not** render the widget (cart, excluded templates) and when the shared secret is empty. See §21.

### 2.3 Render gate (`snippets/ms-chat-widget.liquid`)

The widget renders only when the setting `ai_advisor_enabled` is on, the page is neither a cart page (a substring test on the template name) nor checkout, the shared secret is not blank, and the template is not listed in `ai_advisor_excluded_templates`. The exact conditions and the pages they leave: `01` §5.1 (owner).

When the setting is on but the gate fails, the snippet's `{%- else -%}` branch emits only `<style>.ms-chat-product-advisor, .ms-chat-product-cta { display: none !important; }</style>`, so the product-page CTA (§3.3) is hidden instead of dead. With the setting off, nothing is emitted (the CTA blocks are off too).

When the gate passes, the snippet emits, in this order:

1. The stylesheet link: `{{ 'ms-chat-widget.css' | asset_url | stylesheet_tag }}`. It is a `<link>` placed at the end of `<body>`.
2. An inline script that sets `window.MS_CHAT_CONFIG` (see §3.2).
3. `<script src="…ms-chat-widget.js" defer>`.

`layout/password.liquid` does not render the snippet, so the widget is absent on the password page.

### 2.4 Script preamble (top-level code, runs at parse time)

These steps run in source order, before `init()`:

1. `CFG = window.MS_CHAT_CONFIG || {}` is read. Then `API_BASE` (trailing slashes stripped), `CHAT_KEY` and `SHOWROOM_URL` are derived.
2. **Locale resolution:** `LOCALE = msNormLocale(CFG.locale)`, with a default of `'de'`. If the URL path starts with `/en`, the locale is forced to `'en'` (see §14).
3. The copy tables are built: `CONSENT_COPY`, `MKT_RESULT_COPY`, `FEEDBACK_COPY`. `CONSENT_COPY` and `FEEDBACK_COPY` get an English overlay via `Object.assign` when `LOCALE === 'en'`. `MKT_RESULT_COPY` is built with inline `L(de, en)` calls instead.
4. **Mount guard 1:** if `CHAT_KEY` is empty, the script logs `console.warn('[ms-chat] ms_chat_shared_secret is empty; …')` and returns. Nothing is mounted. The snippet does not load the script with an empty secret (§2.3), so this guard is only a backstop.
5. **Mount guard 2:** if `window.__msChatMounted` is set, the script returns. Otherwise it sets the flag, so a double include cannot mount the widget twice.
6. **Storage probe:** `hasLS` writes and removes `__ms_chat_probe__`. The helpers `lsGet/lsSet/lsDel` (localStorage, or the in-memory `memStore`) and `ssGet/ssSet/ssDel` (sessionStorage, or the in-memory `memSession`) are defined.
7. **Session id:** `sid = getSid()`. This reads `ms-chat-sid` or mints a UUID and persists it (see §7). It happens on every page view where the widget mounts, even if the visitor never opens the chat.
8. `messages = loadHistory()` reads `ms-chat-history:<sid>` and keeps the last 40 messages.
9. `PAGE_CTX` is derived from `CFG.pageContext` (see §3.2).
10. Further top-level initialisers run in this source order: `activeConversationKey = loadConvKey()`, `state = { … viewMode: loadViewMode() }`, `desktopMq = matchMedia('(min-width: 641px)')`, `SpeechRec` detection, then `signInOptInDone = ssGet('ms-chat-optin-done') === '1'`.
11. At the end of the IIFE, `init()` runs immediately if `document.readyState !== 'loading'`. Otherwise it is attached to `DOMContentLoaded`. With `defer`, the script normally runs while `readyState === 'interactive'`, so `init()` runs synchronously.

### 2.5 `init()` order (`ms-chat-widget.js → init()`)

The order matters. Each step depends on the ones before it.

| # | Call | Purpose |
| --- | --- | --- |
| 1 | `captureCampaignToken()` [PR #73] | Reads `mo_c` (from the stash first, then the URL). If it matches `/^[A-Za-z0-9_-]{16,64}$/`, it is stored in sessionStorage as `ms_mo_c`. The parameter is stripped from the URL. This runs **first**, before any other URL strip. |
| 2 | `readAuthReturn()` [PR #73] | Reads `ms_auth` / `ms_code` (stash first, then the URL) into the in-memory `authReturnParams` and strips both from the URL **now**. They are processed later by `handleAuthReturn()`. |
| 3 | `buildShell()` | Builds the launcher, backdrop, panel (header, messages, composer, footer), welcome element and history drawer. Appends `.ms-chat-root` to `<body>`. Calls `applyViewMode()`. Binds `visualViewport` resize/scroll, the breakpoint `change` listener, `visibilitychange`, and window `focus` / `pageshow` (see §2.6). |
| 4 | `autoGrow()` | Sizes the composer textarea. |
| 5 | `renderAllMessages()` | Restores the stored history, or shows the welcome state. |
| 6 | `updateInputState()` | Disables the input while streaming or rate-locked. |
| 7 | Orb hydration | Every server-rendered `.ms-chat-logo` without a child (for example the product-page CTA) gets the blob SVG from `logoBlobs()`. |
| 8 | `window.MS_CHAT = { openWithProduct, openEmailSummary }` | Public API. |
| 9 | `bindProductCtas()` | One delegated `document` click listener for `.ms-chat-product-cta`. It reads `data-ms-chat-product-id` / `data-ms-chat-product-title`. |
| 10 | `recordTrail()` | Adds the current product or collection page to the local browsing trail. |
| 11 | `initNudgeTriggers()` | Arms the dwell / scroll / exit-intent nudge triggers, if the visitor is eligible. |
| 12 | `playLauncherAttention()` | One bounce per tab session, 1.4 s after load. |
| 13 | `initAttribution()` | Arms the `visitorConsentCollected` listener and the once-per-page re-stamp of a cached attribution token. |
| 14 | `window.addEventListener('storage', onSidChangedElsewhere)` [PR #73] | Follows a session rotation done in another tab (§8). |
| 15 | `handleAuthReturn()` | Processes the sign-in or logout return marker: redeem the code, then `/api/auth/me`. If there is no marker, it runs `retryPendingLink()` instead. |
| 16 | `handleMoDeepLink()` | `?mo=open` / `#mo-open` with optional `mo_new=1` and `mo_view=fullscreen`. It runs **last**, so the panel opens on a fully initialised widget. |

### 2.6 What happens on a page load with no user interaction

This matters for load and for KPI interpretation.

- **No backend call for auth.** `/api/auth/me` and the App Proxy whoami call run only when the panel is opened (`resolveAuthOnOpen()`; this includes the no-click opens listed at the end of this section), during a sign-in return (`handleAuthReturn()`), or when `retryPendingLink()` redeems a code kept from a previous 503 (`POST /api/auth/link`, then `GET /api/auth/me` via `probeAuth(true)` on success). The last two happen without the panel being opened. Until then `auth.settled === false`.
- **KPI `launcher_attention_played`:** at most once per tab session, 1.4 s after load. It is skipped under `prefers-reduced-motion` and when the panel is already open. In practice it is the only "the widget was shown" signal the backend gets without interaction (see §19).
- **`GET /cart.js` (same origin) on every page load.** `buildShell()` registers `refreshCartUI` on `window` `pageshow`, and `pageshow` also fires on the initial load. The call is display-only and cheap, but it does happen on every page (see §17).
- **Restored history re-renders its tool cards at `init()`, even if the panel is never opened.** `init()` → `renderAllMessages()` → `renderRestoredAssistant()` → `renderPartIntoCtx()` → `buildToolCard()` rebuilds every visible tool card of the stored history into the (hidden) panel. `productCache` is per page, so it starts empty on each load. As a result, every page view of a visitor with stored history makes these calls:
  - `GET /api/products?ids=` for every restored `show_product`, `compare_products`, `suggest_showroom` and `show_contact_form` card with `productIds`, and for a restored capture card with `productIds` (`hydrate()`, batches of 10, deduplicated within the page through `productCache`).
  - One extra, uncached `GET /api/products?ids=` per restored `add_to_cart` card (`buildAddToCart()`).
  - `GET /api/consent-copy?locale=` for a restored `offer_email_summary` card (`buildCaptureCard()` → `loadConsent()` → `fetchConsentCopy()`, 60 s cache). `buildToolCard()` suppresses this card only when `auth.signedIn`, and auth is not settled at `init()`, so this applies to signed-in customers' restored cards too.
  - A restored `show_product` card that resolves calls `moAttrOnProductCard()` → `moAttrEnsure(true)`. With analytics consent and no cached token, this mints `POST /api/attribution/token` and then stamps the cart, without any interaction.
- **Possibly `POST /cart/update.js`** (at most once per page load, consent-gated: Shopify Customer Privacy API `analyticsProcessingAllowed() === true`). It is sent when a cached attribution token for the current `sid` exists (`initAttribution()`), **or** when a restored `show_product` card triggers a mint (above). The `moAttrPageStamped` flag limits the render path to one stamp per page.
- **Possibly `POST /api/auth/link`, then `GET /api/auth/me`.** This happens only if a sign-in code from a previous 503 is waiting in `ms-chat-link-retry` (`retryPendingLink()`). On a successful redeem it calls `probeAuth(true)`.
- **Nudge KPIs** (`nudge_shown`) fire only when a nudge trigger actually fires.
- **Panel opens without a click.** A campaign deep link (`?mo=open` / `#mo-open`, `handleMoDeepLink()`) or a sign-in return with `ms-chat-auth-return` set (`handleAuthReturn()`; also any successful sign-in return) calls `openPanel()` at load. That fires `chat_opened`, sets `ms-chat-opened` (so nudges are suppressed for the tab session) and runs `resolveAuthOnOpen()` → `detectSignedIn()`: the same-origin whoami fetch (once per tab session) and `/api/auth/me` only when `shouldProbeAuth()` finds a local hint. Funnels that treat `chat_opened` as user intent should exclude these opens.

---

## 3. Configuration reference

### 3.1 Theme settings (`config/settings_schema.json` → section "AI Advisor")

Four settings in **Customize → Theme settings → AI Advisor**: `ai_advisor_enabled` (master switch for the snippet, the `<head>` stash script and the CTA blocks), `ai_advisor_backend_url` (→ `apiBase`), `ms_chat_shared_secret` (→ `chatKey`, sent as `x-ms-chat-key`; empty → no mount) and `ai_advisor_excluded_templates`. Types, defaults, current values and effects: `01` §12.1 (owner).

### 3.2 `window.MS_CHAT_CONFIG` (emitted by `snippets/ms-chat-widget.liquid`)

This table is the one description of the config and the page-context fields (`01` §6.7, §12.2, `03` §4.1–§4.2 and `06` §2 point here). Page facts only, never user data.

| Field | Source | Default in the JS when missing | Used by | Effect |
| --- | --- | --- | --- | --- |
| `apiBase` | `settings.ai_advisor_backend_url`, default `'https://mo.motionsports.de'` | `'https://mo.motionsports.de'` | `API_BASE` | Origin for every backend call. Trailing `/` is stripped. |
| `chatKey` | `settings.ms_chat_shared_secret` | `''`, which means no mount | `CHAT_KEY` | `x-ms-chat-key` on guarded calls (§9). |
| `showroomUrl` | **hard-coded** in the snippet: `https://motionsports.de/pages/showroom-munchen-grobenzell` | same URL | `SHOWROOM_URL` → `buildShowroom()` | Target of the showroom card button. It is not a theme setting. |
| `allowedFromTheme` | hard-coded `true` | — | **Nothing.** The JS never reads it. It is a leftover from the pre-build widget spec. |
| `locale` | `localization.language.iso_code`, falling back to `request.locale.iso_code` | `'de'` | `LOCALE` | `'en'` if it starts with "en" (case-insensitive), otherwise `'de'`. A `/en` path prefix forces `'en'` (§14). |
| `pageContext.pageType` | `request.page_type` | `''` | `PAGE_CTX.type` | Mapped to `'product'`, `'collection'`, `'cart'`, `'home'` (from `index`) or `'other'`. |
| `pageContext.productId` | `product.id` (product pages only) | `null` | `PAGE_CTX.productId` | Numeric Shopify id. Guard in `openWithProduct()` (the handle is used only when the CTA's id matches the page product), fallback id in `recordTrail()` and in the nudge-click context greeting. The `product_cta_opened` KPI uses the CTA's own `data-ms-chat-product-id` (normally the same value). |
| `pageContext.productHandle` | `product.handle` | `null` | `PAGE_CTX.productHandle` | The slug. This is the id form the backend catalog uses (API_CONTRACT §3). Sent as `context.productId`. |
| `pageContext.productTitle` | `product.title` | `null` | `PAGE_CTX.productName` | Nudge copy, context greeting, trail. |
| `pageContext.productType` | `product.type` | `null` | `PAGE_CTX.category` | The product's "category" for the trail, nudge streaks and `recentlyViewed`. |
| `pageContext.collectionTitle` | `collection.title` (collection pages only) | `null` | `PAGE_CTX.category` | The collection page's category. |
| `pageContext.collectionHandle` | `collection.handle` | `null` | `PAGE_CTX.collectionHandle` | Trail id for collection entries. |
| `whoamiPath` | **not emitted** by the snippet | `'/apps/chat/whoami'` | `detectViaStorefront()` | Hidden override for the App Proxy path. Today the default is always used. |

There is no other `CFG.*` read. This was checked with `grep CFG\.` and covers `apiBase`, `chatKey`, `showroomUrl`, `locale`, `pageContext`, `whoamiPath`.

The widget sends page facts only inside the `context` of a CTA turn or a nudge greeting (`03` §2, §4.3); typed turns carry none. The contract also defines page facts for typed turns (AC §2 „Optional `context`“, `source: "page"`; the backend uses them only with `CHAT_PAGE_CONTEXT_ENABLED`, default off in code); the widget side is `tasks/2-page-context.md`.

### 3.3 Server-rendered entry points outside the snippet

- **Product-page CTA:** the "MO only" `custom_liquid` block (`custom_liquid_AErEyg`, editor name "MO only"; its Liquid comment reads "AI Advisor (Mo) – Produktberatung") in `templates/product.json`, `product.produkt-new.json`, `product.produktnew.json` and `product.produkte-im-set.json`, plus the older Kurzinfo variant `custom_liquid_BGU8Mt` ("USPs mit MO", disabled in `product.json`; "USPs", enabled in `product.produktdesign-02.json`). Both render `<button class="ms-chat-product-cta" data-ms-chat-product-id="{{ product.id }}" data-ms-chat-product-title="…">` with an empty `.ms-chat-logo` span. Markup contract, placement, styling, click path (`bindProductCtas()` → `openWithProduct()`) and template coverage: `06` §3 (owner); templates: `01` §6.6.
  - Both blocks are owned by the live editor (see §20).
  - **Gating:** the CTA blocks themselves check **only** `settings.ai_advisor_enabled`. Wherever the snippet does not render the widget (excluded product template, empty shared secret), its else-branch `<style>` hides `.ms-chat-product-advisor` / `.ms-chat-product-cta` (§2.3). **Remaining edge:** if `ms-chat-widget.js` fails to load, or a shopper clicks before the deferred script has booted (`init()` → `bindProductCtas()`), the visible button does nothing.

---

## 4. Internal structure of `ms-chat-widget.js`

The file is one IIFE. Sections are separated by `// ----` banner comments. This is the order in the file:

| # | Section (banner) | Key contents |
| --- | --- | --- |
| 1 | Header comment and config | `CFG`, `API_BASE`, `CHAT_KEY`, `SHOWROOM_URL` |
| 2 | Locale | `msNormLocale()`, `LOCALE`, `L(de, en)` |
| 3 | Email-capture chrome copy | `CONSENT_COPY` (+ EN overlay), `marketingOutcome(m)`, `MKT_RESULT_COPY` (inline `L()`, no overlay). Comments state the **legal invariants** (separate consents, both unchecked, `consentTextShown` echoed byte-for-byte). |
| 4 | Feedback copy | `FEEDBACK_COPY` (+ EN) |
| — | Mount guards | empty `CHAT_KEY` → return; `window.__msChatMounted` |
| 5 | Storage | `hasLS`, `lsGet/lsSet/lsDel`, `ssGet/ssSet/ssDel`, `uuid()`, `SID_KEY`, `getSid()`, `historyKey()`, `convKeyStorageKey()`, `loadHistory()`, `sidIsCurrent()`, `saveHistory()`, `rotateSession()` |
| 6 | KPI telemetry | `track(event, data)` |
| 7 | Page context and browsing trail | `PAGE_CTX`, `TRAIL_*`, `loadTrail()`, `recordTrail()`, `trailCategoryStreak()`, `recentlyViewedPayload()`, `browsingContext()`. States the **privacy posture** and the **tone rule**. |
| 8 | Tool names | `VISIBLE_TOOLS` (6: `show_product`, `compare_products`, `add_to_cart`, `suggest_showroom`, `show_contact_form`, `offer_email_summary`), `SILENT_TOOLS` (`update_customer_profile`, `search_products`, `get_order_status`), `isToolPart()` (exact match), `isRenderablePart()`, `resolveToolName()` |
| 9 | DOM helpers | `el(tag, attrs, children)`, `ICONS` (inline SVG strings), `icon()`, `LOGO_BLOBS` / `logoBlobs()` (unique filter ids per instance), `logoEl()` |
| 10 | Safe Markdown renderer | `safeHref()` (http/https/mailto only), `appendInline()`, `inlineScanSafe()`, `streamingSafeText()`, `renderBlocks()`, `renderMarkdownInto()`. Builds DOM only, never `innerHTML` on model text. |
| 11 | Product hydration | `productCache`, `chunk()`, `hydrate(ids)` (batches of 10, caches only on success) |
| 12 | Consent copy (capture form and sign-in surface) | `CONSENT_COPY_TTL_MS` (60 s), `fetchConsentCopy()`, `seedConsentCopy()`, `returningHintText()`, `fetchSignInConsentCopy()` |
| 13 | Customer Account (tier 3) | `ACCOUNT_COPY`, `auth`, conversation-key helpers (`loadConvKey`, `saveConvKey`, `clearConvKey`, `maybeMintConversationKey`), `accountHeaders()`, `storefrontCustomerHint()`, `shouldProbeAuth()`, `applyAuth()`, `probeAuth()`, `endedSignInCleanup()`, `authVia*`, `redeemLinkCode()`, `retryPendingLink()`, `detectViaStorefront()`, `detectSignedIn()`, `initiateLogin()`, `showLinkFailedNotice()`, `earlyParam()`, `readAuthReturn()`, `handleAuthReturn()`, `dropSessionHistory()`, `signOut()`, `onSidChangedElsewhere()`, `resolveAuthOnOpen()` |
| 14 | Formatting | `euro()`, `priceNode()`, `productButton()` |
| 15 | Tool card builders | `buildShowProduct()`, `buildCompare()` |
| 16 | Storefront cart sync | `cartJsUrl()`, `readBubbleCount()`, `setCartBubble()`, `reloadCartPageSection()`, `reloadCartDrawer()`, `refreshCartUI()`, `pollCartAfterCheckout()` (1.2 / 2.5 / 4.5 / 7 s) |
| 17 | Order attribution | `MO_ATTR_KEY`, `moAnalyticsAllowed()`, `moAttrLoad/Reset/Ensure()`, `moStampCart()`, `moAttrOnProductCard()`, `initAttribution()`, then `buildAddToCart()`, `buildShowroom()`, `buildContactForm()` |
| 18 | GDPR email-capture form | `capturedEmail` (in memory only), `buildCaptureCard()`, `buildToolCard(name, input)` (the dispatcher; it suppresses `offer_email_summary` when signed in) |
| 19 | Widget shell | `VIEW_MODE_KEY`, `loadViewMode()`, `state`, `desktopMq`, `isDesktop()`, `buildShell()`, `updateShareBtn()`, `updateDownloadBtn()`, `applyViewMode()`, `toggleViewMode()`, `syncChrome()`, `setPageShift()`, `syncMobileViewport()`, `buildWelcome()`, `autoGrow()`, `togglePanel/openPanel/closePanel()`, `scrollToBottom()`, `updateInputState()` |
| 20 | Voice input | `SpeechRec`, `startVoice()` (`lang='de-DE'`), `stopVoice()`, `toggleVoice()` |
| 21 | Voice mode (hands-free loop) | `unlockAudio()` (iOS autoplay unlock inside the click), `enable/disableVoiceMode()`, `restartVoiceLoop()` (350 ms debounce), `speakReply()` (`POST /api/tts`), `speakViaSynthesis()` (browser fallback), `ttsUnavailable()` |
| 22 | Streaming TTS | `startStreamTts()`, `streamTtsFeed()`, `splitIntoTtsChunks()`, `streamTtsPump()`, `streamTtsFallback()` … (API_CONTRACT §8) |
| 23 | Notices | `showWelcome()`, `clearWelcome()`, `showNotice(kind, text, actionLabel, actionFn)`, `clearNotice()`, `assistantRow()`, `showMessageError()` |
| 24 | Rendering | `renderUserMessage()`, `textOfMessage()`, `newAssistantCtx()`, `renderPartIntoCtx()`, `renderRestoredAssistant()`, `renderAllMessages()` |
| 25 | Generating indicator | `showTyping()` / `removeTyping()` (an animated avatar row with `role="status"`) |
| 26 | Wire helpers | `accumulatePart()` (keeps silent tool parts and outputs for replay), `toWire()` |
| 27 | Send and SSE stream | `onSend()`, `sendMessage(text, context)`, `sendContextGreeting(context)`, `abortActiveStream`, `startStream(opts)` (fetch + reader, AI SDK v5 UI-message stream), `handleChatHttpError()`, `lockRateLimit()`, `startNewChat()` |
| 28 | Contextual nudge | `NUDGE_*`, `SS_*` keys, `nudgeEligible()`, `nudgeCopy()`, `showNudge()`, `initNudgeTriggers()` |
| 29 | Launcher attention | `playLauncherAttention()` |
| 30 | Public API: product CTA | `openWithProduct(id, title)` |
| 31 | Share entry point | `openCaptureForm()` (= `MS_CHAT.openEmailSummary`) |
| 32 | Feedback entry point | `feedbackTier()`, `identifiedEmail()`, `buildFeedbackCard()`, `openFeedbackCard()` |
| 33 | Signed-in summary download | `DOWNLOAD_COPY`, `downloadSummary()` (`GET /api/account/summary`) |
| 34 | Tier-3 UI | `buildSignInCard()`, `OPTIN_COPY`, opt-in session guards, `optInActionable()`, `buildMarketingOptInCard()`, `presentSignInOptIn()` |
| 35 | First-message gate | `GATE_COPY`, `MKT_DECISION_KEY`, `LOGIN_GATE_SNOOZE_KEY`, `gateBaseEligible()`, `consentGateEligible()`, `loginGateEligible()`, `maybeShowConsentGate()`, `openGateDialog()` (the shared dialog shell with a focus trap), `presentLoginGate()`, `presentConsentGate()` |
| 36 | Auth reflection | `reflectAuthState()`, `updateWelcomeAuth()`, `updateShopSignInBtn()` |
| 37 | History drawer | `buildHistoryDrawer()`, `open/closeHistory()`, `maybeAutoOpenHistory()`, `flushAutoHistory()`, `accountReplyStale()`, `accountUnauthorized()`, the optimistic list model, `loadConversations()`, rename / delete / open conversation |
| 38 | Data rights | `buildExportControl()` (`GET /api/account/export`), `fetchEraseCopy()` (`?surface=erase`, no cache), `buildEraseControl()`, `openEraseConfirm()`, `clearAfterErase()`, `showEraseDone()` |
| 39 | Campaign token | `CAMPAIGN_TOKEN_KEY = 'ms_mo_c'`, `CAMPAIGN_TOKEN_RE`, `captureCampaignToken()` |
| 40 | Deep link | `handleMoDeepLink()` |
| 41 | Init | `init()`, `bindProductCtas()`, readyState bootstrap |

**Conventions inside the file**

- Tool cards return `Promise<Element|null>`. `null` means "render nothing" (render-nothing guards).
- Every comment that says "do not change" or "INVARIANTS" marks a legal or privacy rule. Examples: consent-copy handling, the capture-form legal invariants, the trail privacy posture, the attribution invariants, the in-memory-only `capturedEmail`.
- Comments reference `docs/ai-advisor/*.md`. That folder does **not** exist in this repo. The contract lives in the backend repo under `docs/frontend/` (`API_CONTRACT.md`, `ACCOUNT_CONTRACT.md`, `CONSENT_CONTRACT.md`).

---

## 5. Global state

All state is held in closure variables of the IIFE. Nothing is put on `window` apart from `MS_CHAT_CONFIG` (input), `__msChatMounted` and `MS_CHAT` (the public API).

### 5.1 `state` (UI state) — `ms-chat-widget.js → var state`

| Field | Meaning |
| --- | --- |
| `open` | The panel is open. Set by `openPanel()` / `closePanel()`. |
| `streaming` | A `/api/chat` turn is in flight. The input is disabled. |
| `rateLocked` | A 429 lock is active (`lockRateLimit(seconds)`, `Retry-After` or 30 s). The input is disabled. |
| `viewMode` | `'sidebar'` or `'modal'` (desktop only). Loaded from `ms-chat-view-mode`. |

### 5.2 `auth` (identity) — `ms-chat-widget.js → var auth`

`{ settled, signedIn, name, tier, marketing, optInActionable }`. It is written **only** by `applyAuth(data, transient)`.

- `settled`: becomes `true` after the first detection result. Many surfaces wait for it: the sign-in card, the header „Anmelden“ pill and the first-message gates.
- `signedIn`, `name`, `tier`, `marketing`, `optInActionable` mirror `/api/auth/me` (ACCT §4). `optInActionable` is taken verbatim from `marketing.optInActionable === true`.
- The state fails closed: any error or non-200 means not signed in. A *transient* failure (network, 429, 5xx) keeps the device hints (`ms-chat-signed-in`, `ms-chat-auth-via:<sid>`). A *definitive* answer (200 `signedIn:false`, 401/403) deletes them.
- Each change calls `reflectAuthState()` (header pills, share/download buttons, welcome card, account-menu sign-in, and closes the history drawer when the result is not signed in: `if (!auth.signedIn) closeHistory()`) and `flushAutoHistory()`.

### 5.3 `messages` (conversation)

- `messages` is an array of AI-SDK-style UI messages: `{ id, role: 'user'|'assistant', parts: [...] }`. Ids are `'u-'+uuid` and `'a-'+uuid`.
- Text parts are `{type:'text', text}`. Tool parts are `{type:'tool-<name>', toolCallId, state, input, output}`. Silent tools and tool outputs are kept so the backend can replay them.
- The array is **replaced**, not mutated, on new chat, rotation and conversation open. Keep this in mind for async callbacks that hold a reference (see §21).
- It is persisted as `ms-chat-history:<sid>` with the last 40 entries (`saveHistory()`). It is written after a user send, after a stream finalises, on rollback and on conversation open. It is **not** written on every token.

### 5.4 Other module-level state (in memory only)

| Variable(s) | Purpose |
| --- | --- |
| `sid` | The current session id (mirrors `ms-chat-sid` while this tab is current). |
| `activeConversationKey` | The signed-in thread key (ACCT §7.6). It is `null` for anonymous and email-only visitors, and then **omitted** from `/api/chat`. |
| `activeConversationId` | The loaded server conversation (used only for list highlighting). |
| `capturedEmail` | The email captured in **this page's** chat (privacy gate: memory only, reset on navigation). It is sent as `customer.email` on `/api/chat`. |
| `productCache` | id → product, or `null` for an id the backend confirmed is unknown. Lives for the page. |
| `consentCopyCache`, `signInConsentCache` (+ `…Inflight`) | Served consent copy, 60 s TTL, deduplicated GETs. |
| `historyServerList`, `historyOptimistic`, `historyLoaded` | Model for the history drawer. |
| `moAttr`, `moAttrInflight`, `moAttrFailed`, `moAttrConsulted`, `moAttrPageStamped` | Attribution token cache and flags. Mint failures are not retried for the current page view. |
| `cartCountKnown`, `cartRefreshInFlight` | Cart-sync single-flight guard and the last item count. |
| `earlyParams`, `authReturnParams` | Values from the stash and URL that are consumed once. |
| `authProbed`, `authOpenHandled`, `authLinkInflight`, `whoamiInflight`, `autoHistoryArmed` | Auth detection sequencing. |
| `gateEl`, `gateCloseFn`, `lastCaptureRow`, `lastOptInRow`, `nudgeEl`, `typingEl` | Singletons for the overlay and rows on screen. |
| `abortActiveStream`, `rateTimer` | Stream cancel hook and the rate-lock timer. |
| Voice: `voiceMode`, `recognition`, `recognizing`, `ttsAudio`, `isSpeaking`, `ttsBackoffUntil`, `ttsHintShown`, `voiceRestartTimer`, `currentBlobUrl`, `speakSeq`, `streamTts` | Voice and TTS state. All of it is skipped while `voiceMode` is false. |
| `signInOptInDone` | Mirrors `ms-chat-optin-done`. |

---

## 6. Storage keys (complete)

This list was enumerated with `grep` over every `lsGet/lsSet/lsDel/ssGet/ssSet/ssDel` call and `*_KEY` constant. The widget uses no cookies and no IndexedDB.

**Fallback:** if localStorage is unavailable (the `hasLS` probe fails), every `ls*` key lives in the in-memory `memStore`. That means a **new sid on every page load** and no persistence. If sessionStorage throws, `ss*` keys fall back to `memSession`, so "once per session" degrades to "once per page load".

This is the one complete list of the widget's storage keys; `01` §14, `04` §12 and the README point here. Keys and clearers tagged **[PR #73]** were added by PR #73 (2026-10-04); the pre-PR #73 widget (`44a076b`) has none of them, so data recorded before 2026-10-04 has none either (§1.1).

### 6.1 localStorage

| Key | Scope | Value | Written by | Cleared by | Lifetime |
| --- | --- | --- | --- | --- | --- |
| `ms-chat-sid` | device (global) | UUID v4 | `getSid()` (first load), `rotateSession()` | never deleted, only replaced | indefinite |
| `ms-chat-history:<sid>` | per sid | JSON `messages`, last 40 | `saveHistory()` (only while `sidIsCurrent()`) | `rotateSession()` (old sid), signed-in `startNewChat()`, `handleMoDeepLink()` with `mo_new=1`, deleting the active conversation, `dropSessionHistory(adoptSid)` [PR #73] | until rotated or cleared |
| `ms-chat-convkey:<sid>` | per sid | conversationKey UUID (signed-in only) | `maybeMintConversationKey()`, `startNewChat()` (signed-in), `openConversation()`, via `saveConvKey()` (only while `sidIsCurrent()`) | `clearConvKey()` (erase, `mo_new`, deleting the active conversation; [PR #73] also sign-out, server-confirmed end, other-tab rotation); `saveConvKey()` when the key is null | until cleared |
| `ms-chat-auth-via:<sid>` [PR #73] | per sid | `'chat'` or `'shop'` (sign-in origin) | `redeemLinkCode()` on 200 → `setAuthVia()`. `'shop'` never downgrades `'chat'`. | `applyAuth()` on a definitive not-signed-in | until a definitive sign-out |
| `ms-chat-signed-in` | device | `'1'` (a hint that `/api/auth/me` is worth calling; carries no identity) | `applyAuth()` signed-in | `applyAuth()` on a definitive not-signed-in | until a definitive sign-out |
| `ms-chat-trail` | device | JSON, at most 5 `{id,name,type,category,ts}` | `recordTrail()` on product/collection pages | **never** explicitly. Entries older than 3 days are filtered on read; the stored array is rewritten only on the next product/collection view. | 3-day TTL per entry |
| `ms-mo-attr` | device key, value bound to `sid` | `{sid, token, cartAttributes}` | `moAttrEnsure()` after `POST /api/attribution/token` | `moAttrReset()` (on rotation), `moAttrLoad()` when the stored sid ≠ current sid | until rotation |
| `ms-chat-view-mode` | device | `'sidebar'` or `'modal'` | `toggleViewMode()` only (the deep link's fullscreen is deliberately **not** persisted) | never | indefinite |
| `ms-chat-expanded` | device (legacy) | `'1'` | **never written** (old versions only) | never | read by `loadViewMode()` as a migration: `'1'` maps to `'modal'` |
| `ms-chat-nudge-dismissed` | device | `'1'` | nudge × click | never | permanent: dismissed once, never shown again |
| `ms-chat-mkt-decision` | device | `{state:'accepted'|'declined', at}` | `recordMktDecision()` (opt-in card/popup accept or decline; capture form with the marketing box ticked) | never | a `'declined'` keeps the signed-in consent ask quiet for 30 days (`MKT_DECLINE_SNOOZE_MS`). `'accepted'` is stored but **not** used to suppress (the backend's `optInActionable` decides). |
| `ms-chat-login-gate-snooze` | device | timestamp (ms) | login popup „Später“ | never (it expires) | 24 h (`LOGIN_GATE_SNOOZE_MS`) |

Device-global keys (`trail`, `view-mode`, `nudge-dismissed`, `mkt-decision`, `login-gate-snooze`) **survive** sign-out, erase and new chat. Only sid-bound data is wiped.

### 6.2 sessionStorage (per tab session)

| Key | Value | Written by | Cleared / consumed | Purpose |
| --- | --- | --- | --- | --- |
| `ms-chat-early-params` [PR #73] | `{at, ms_auth?, ms_code?, mo_c?}` | the `<head>` script in `layout/theme.liquid` | `earlyParam()` deletes it on first read; it is honoured only if younger than 10 min | Moves secrets out of the URL before analytics (§2.2) |
| `ms_mo_c` [PR #73] | campaign token (16–64 chars `[A-Za-z0-9_-]`) | `captureCampaignToken()` | deleted after the first `/api/chat` returns `res.ok`. Re-validated on read and dropped if malformed. | Sent once as `campaignToken` (API_CONTRACT §2, §11.2). The key name differs from the `ms-chat-` prefix. |
| `ms-chat-auth-return` | `'1'` | `initiateLogin()` | `handleAuthReturn()` (when a marker is present) | Re-open the panel after the sign-in redirect |
| `ms-chat-login-sid` [PR #73] | sid used by the login | `initiateLogin()` | `handleAuthReturn()` on `ms_auth=ok` | The code is redeemed only with this sid. A mismatch is treated as `link_failed`. |
| `ms-chat-link-retry` [PR #73] | `{code, sid, at, kind?}` | `handleAuthReturn()` / `detectViaStorefront()` when the redeem returns `'unavailable'` (503/5xx/429/network) | `retryPendingLink()` (deleted on read), a newer return supersedes it | One silent retry on the next page load, ≤10 min old, same sid |
| `ms-chat-whoami-done` [PR #73] | `'1'` | before the first whoami call; also on `signOut()`, the `logged_out` marker, `endedSignInCleanup()`, `clearAfterErase()`, and other-tab rotation while signed in | never | App Proxy whoami runs at most once per tab session and is never re-asked after a sign-out |
| `ms-chat-opened` | `'1'` | `openPanel()` | never | Once the chat has been opened, nudges stop for the session |
| `ms-chat-nudge-shown` | `'1'` | `showNudge()` | never | At most one nudge per session |
| `ms-chat-attn-played` | `'1'` | `playLauncherAttention()` (also when skipped for reduced motion) | never | At most one bounce per session |
| `ms-chat-gate-shown` | `'1'` | `presentLoginGate()`, `presentConsentGate()` | never | At most one first-message popup per session |
| `ms-chat-optin-done` | `'1'` | `markOptInDone()` (answered or dismissed) | never | The signed-in opt-in stays quiet for the session |
| `ms-chat-optin-ask-shown` [PR #73] | `'1'` | first render of the opt-in card or popup | never | Deduplicates `consent_gate_shown {surface:'signin'}` per session; the popup does not ask again after the inline card |

### 6.3 In memory only (never persisted)

`capturedEmail`, `productCache`, consent-copy caches (60 s), erase copy (fetched fresh each time), the `auth` object, the conversation list, the attribution flags, `earlyParams` / `authReturnParams`, the one-time code itself (except the 503 retry above), and all voice state. This is deliberate: the email and the code must not outlive the page or tab.

---

## 7. Session id lifecycle

The session id (`sid`) is the browser's pseudonymous key. It is sent as `x-ms-session` on almost every backend call, and it is the backend's rate-limit key (AC §6).

For **signed-in** customers it is also **the link to the identity**: the server maps sid → customer after the one-time code was redeemed (ACCT §1, §2a). That is why signed-in flows avoid rotating it, and why sign-out rotates it on purpose.

### 7.1 Creation

`getSid()` runs at script parse time on every page where the widget mounts. If `ms-chat-sid` is missing, it calls `uuid()` (`crypto.randomUUID`, or a `Math.random` v4 fallback) and stores the result. A sid therefore exists for every visitor who sees the widget, chat or no chat.

Contract: AC §6 "Session lifecycle" (what the backend keys by the sid: rate limits, conversations, the sign-in link, KPI rows). Because conversations and the sign-in link are keyed by the sid (ACCT §1, §7.6), `startNewChat()` never rotates a signed-in sid on the `payload_too_large` „Neuen Chat starten“ path (it only clears the active thread); it rotates only for anonymous / email-only visitors.

### 7.2 Rotation primitives

- `rotateSession()` deletes `ms-chat-history:<old sid>`, mints a new UUID, writes `ms-chat-sid`, sets `messages = []`, and calls `moAttrReset()` (drops the attribution token).
- `dropSessionHistory(adoptSid?)`, used for anything privacy-relevant:
  1. Aborts the in-flight stream (`abortActiveStream`) and stops speech and typing.
  2. Clears `capturedEmail` and the draft in the textarea.
  3. Empties the history-drawer model and clears the conversation key and active conversation.
  4. With no `adoptSid` it calls `rotateSession()`. With `adoptSid` (another tab rotated) it deletes the old history and adopts the other tab's sid and history.
  5. Resets the rate lock and streaming flag, clears the notice, and re-renders the empty welcome view.

### 7.3 When the sid changes (complete list)

| Trigger | Function | Anonymous / email-only | Signed in |
| --- | --- | --- | --- |
| Header ↻ "Neuen Chat starten" | `startNewChat()` | `rotateSession()` → **new sid** | **sid kept**. History cleared locally; a new `conversationKey` is minted. Past threads stay on the server. |
| `payload_too_large` notice → „Neuen Chat starten“ | `handleChatHttpError()` → `startNewChat()` | new sid | sid kept, new thread key |
| History drawer „Neue Beratung“ | `startNewChat()` + `addOptimisticConversation()` | (drawer is signed-in only) | sid kept, new thread key |
| Deep link `?mo=open&mo_new=1` | `handleMoDeepLink()`. Branches on the **local hint** `shouldProbeAuth()`, not on the auth tier (auth is not settled at init). The columns here mean "hint absent" / "hint present". | **No hint:** `rotateSession()` → new sid. This also applies to a truly signed-in visitor whose hint is missing, and then severs the sign-in link. | **Hint present** (`ms-chat-signed-in === '1'` or a shop customer id via `storefrontCustomerHint()`): sid kept, local history and thread key cleared. This also applies to a chat-anonymous visitor who is logged into the shop. A new key is minted on the first turn only if auth has settled signed-in by then (`maybeMintConversationKey()` checks `auth.signedIn`). |
| Sign-out („Abmelden“ in the drawer) [PR #73] | `signOut()` → `track('account_signout')` → `applyAuth(null)` → `dropSessionHistory()` | — | **new sid**. Sign-out is local; the old sid's server link is simply abandoned. **Before 2026-10-04 (pre-PR #73) the sid was kept** (`signOut()` only tracked, `applyAuth(null)`, `closeHistory()`). |
| Erase („Alle meine Daten löschen“) succeeded (200 `erased:true`) or answered 401 [PR #73] | `openEraseConfirm()` → `clearAfterErase()` → `dropSessionHistory()` | — | new sid. The done dialog (`showEraseDone()`) shows only on 200. 503 and other errors keep the confirmation and do not rotate. **Before 2026-10-04 (pre-PR #73) the sid was kept.** |
| [PR #73] Server says a previously signed-in session has ended (`/api/auth/me` 200 `signedIn:false` or 401/403; any `/api/account/*` 401). The backend ends a sign-in also on a whoami **handover** (another shop customer on this sid) and, for a shop-login sign-in (only with `APP_PROXY_SIGNIN_ENABLED`, default off in code), when its **shop proof** expires (`APP_PROXY_SIGNIN_MAX_AGE_HOURS` after the last whoami redeem; every new tab renews it) — ACCT §3a | `probeAuth()` / `accountUnauthorized()` → `endedSignInCleanup()` → `dropSessionHistory()` | — (applies only if the device had been signed in: `wasSignedIn`) | new sid, no KPI event |
| `?ms_auth=logged_out` return | `handleAuthReturn()` → `probeAuth(true)` | no change by itself (the marker proves nothing) | rotation happens only if `/api/auth/me` confirms the end (row above) |
| [PR #73] Another tab changed `ms-chat-sid` | `onSidChangedElsewhere()` (window `storage` event) | adopts the other tab's sid | adopts it, drops to anonymous, closes any gate and the drawer |

The sid is **never** rotated around sign-in. It survives the OAuth redirect unchanged, and `initiateLogin()` pins it in `ms-chat-login-sid`.

`startNewChat()` (the three new-chat rows above) and `openConversation()` first cancel a reply that is still streaming (`abortActiveStream()` + `endSpeaking()` + `removeTyping()`), whether or not the sid rotates (§21 item 1).

### 7.4 Conversation key (signed-in threads)

- `maybeMintConversationKey(isFreshThread)` runs only if signed in, no key exists yet, and this is the first turn of an empty thread.
- `startNewChat()` (signed-in) always mints a fresh key. `openConversation()` adopts the server thread's key.
- The key is sent as `conversationKey` on `/api/chat` only when `auth.signedIn && activeConversationKey`.
- An in-progress local thread that has no key stays "legacy" (keyed server-side by `session_id`), so a mid-conversation sign-in never forks the thread.

---

## 8. Multi-tab behaviour

localStorage is shared across tabs. Each tab's in-memory `sid`, `messages` and `auth` are not.

**[PR #73]:** the rotation-following, the `sidIsCurrent()` write guard and the once-per-tab whoami below came with PR #73. The pre-PR #73 widget (`44a076b`, §1.1) had no `storage` listener, so before 2026-10-04 a tab kept its old sid in memory after another tab rotated it.

- **Rotation is followed.** `onSidChangedElsewhere(e)` runs only for `e.key === 'ms-chat-sid'` with a new, different value. It closes the gate and the drawer, applies anonymous, and calls `dropSessionHistory(e.newValue)`. If this tab was signed in, it also sets `ms-chat-whoami-done`, so the shop login cannot silently re-link the new sid.
- **Orphan writes are prevented.** `saveHistory()` and `saveConvKey()` write only while `sidIsCurrent()`, meaning the stored `ms-chat-sid` still equals this tab's `sid`.
- **No live sync of the conversation itself.** Two tabs on the same sid each keep their own `messages` array, and the last `saveHistory()` wins. Each tab sends its own full history to `/api/chat`, so the two tabs' threads diverge. After a reload a tab shows whatever was saved last. There is no `storage` listener for `ms-chat-history:*`.
- **Sign-in in another tab:** this tab learns about it on the next panel open (`resolveAuthOnOpen()` → `detectSignedIn(true)`), or on `visibilitychange` to visible while the panel is open and not signed in (only `/api/auth/me`; whoami is never asked twice).
- **A signed-in "Neue Beratung" in tab A** does not rotate the sid, so tab B is not notified. B keeps its own in-memory thread key until it reloads or opens a conversation.
- **sessionStorage is per tab.** All "once per session" caps (nudge, attention bounce, first-message popup, opt-in ask, whoami) are per tab. Product links open with `target="_blank" rel="noopener noreferrer"`. In current browsers a `noopener` tab does not inherit sessionStorage, so the caps (and a pending `ms_mo_c`) most likely start fresh there. This was not verified on devices.

---

## 9. Network surface and what leaves the browser

This is the one list of the widget's calls (README §7 and `04` §13 point here). It lists only what the widget sends and when; what each endpoint accepts and answers, its guard, rate-limit bucket and limits are in the contract (AC §1 "Endpoints" and the cited sections). "Guarded" means the widget sends the headers `x-ms-chat-key`, `x-ms-session` and `x-ms-locale` (`accountHeaders()` or the equivalent inline headers).

| Call | Headers | Trigger | Contract |
| --- | --- | --- | --- |
| `POST /api/chat` (SSE via `fetch` + `getReader`, not `EventSource`) | guarded + `Content-Type` | user send, product CTA, nudge click (context greeting with `messages: []`), voice transcript | AC §2. Body: `messages` (full history), `locale`, optional `context`, `conversationKey` (signed-in), `customer.email` (captured in this page), `campaignToken` (first turn of the tab session); when each is present: `03` §3.2 |
| `GET /api/products?ids=` | `x-ms-session` only | card hydration (batches of 10), also for restored history on every page load (§2.6); `add_to_cart` makes its own uncached call to get `cartUrl`. `buildAddToCart()` does **not** chunk: all deduplicated `productIds` go in one request, so more ids than the AC §3 cap give a 400 and the checkout card silently renders nothing (§21 item 15). | AC §3 |
| `POST /api/kpi` | `Content-Type`, `x-ms-session` (no secret) | `track()`: fire-and-forget, `keepalive:true`. If `fetch` is missing it falls back to `sendBeacon`. | AC §5 |
| `GET /api/consent-copy?locale=` / `?surface=signin&locale=` | `x-ms-session` | capture form / signed-in opt-in (60 s cache) | AC §7.4 |
| `GET /api/consent-copy?surface=erase&locale=` | guarded | each opening of the erase confirmation (the backend checks only the origin on every `consent-copy` surface, AC §1) | AC §7.4; ACCT §7.5 |
| `POST /api/capture-email` | guarded | capture-form submit | AC §7.1 |
| `POST /api/contact` | guarded | contact-card submit; the body also carries `sessionId` (the backend keys `contact_form_submitted` on it, else on the header) | AC §4 |
| `POST /api/feedback` | guarded | feedback-card submit | AC §9 |
| `POST /api/tts` | guarded | voice mode only (`{text}` or `{text, stream:true, seq}`) | AC §8 |
| `POST /api/attribution/token` | `x-ms-chat-key`, `x-ms-session` | first rendered `show_product` card (`buildShowProduct()` → `moAttrOnProductCard()`; compare, showroom and add-to-cart cards do not count), the Mo „Zur Kasse“ click (`moAttrEnsure(false)`), or a later `visitorConsentCollected` event after a `show_product` card; **only with analytics consent** | AC §10 |
| `GET /api/auth/me?session=` | guarded | panel open (lazy), `?ms_auth=ok` return, visibility re-check; `?ms_auth=logged_out` return and `link_failed` return (both only with a local sign-in hint, `shouldProbeAuth()`); after a successful `retryPendingLink()` or whoami-`linkCode` redeem (`probeAuth(true)`) | ACCT §4 |
| `POST /api/auth/link {code}` | guarded + `Content-Type` | `ms_auth=ok` return, whoami `linkCode`, 503 retry | ACCT §2a |
| Top-level navigation `GET /api/auth/shopify/login?session=&return_url=` | — | „Anmelden“ / „Jetzt anmelden“ / popup / account-menu sign-in / link-failed notice „Anmelden“ (`showLinkFailedNotice()`, expired-code case) | ACCT §2 |
| `GET /api/account/conversations[/{id}]`, `PATCH`, `DELETE` | guarded | history drawer | ACCT §7.1–§7.4 |
| `GET /api/account/summary?conversationKey=` | guarded | download button | ACCT §8 |
| `GET /api/account/export`, `POST /api/account/erase` | guarded | drawer footer | export: ACCT §7.7; erase: ACCT §7.5 |
| `POST /api/account/marketing-opt-in` | guarded | signed-in opt-in card or popup accept | ACCT §6.2 (shape), §6.1 (when to ask); CONS §3.2 (submit rules) |
| **Same origin** `GET /apps/chat/whoami?session=` | `Accept: application/json`, `credentials:'include'` | first `detectSignedIn()` per tab session | ACCT §3a (backend switches and setup there). The widget uses an answer only to redeem its `linkCode`; a non-JSON or non-OK answer (an unconfigured proxy returns Shopify's HTML 404 page) means "no detection" and is silent. The pre-PR #73 widget applied `signedIn:true` as identity without a code (§1.1). |
| **Same origin** `GET /cart.js` (`window.routes.cart_url`) | — | `pageshow` (every load), window `focus`, `visibilitychange` to visible, the poll after checkout | display-only cart sync |
| **Same origin** `GET <path>?section_id=…` | — | cart page only, when the item count changed | Section Rendering API |
| **Same origin** `POST /cart/update.js {attributes}` | `keepalive:true` | attribution stamp (consent re-checked on each call) | OA; AC §10 |

**What data leaves the browser (privacy summary)**

- **KPI:** the event name, `sessionId` (the sid), an ISO timestamp, and small `data` objects: product ids, `pageType`, `contextual`, `trigger`, `surface`, `source`, `result`. Never message text, emails or product names.
  - KPI is **not** consent-gated. Only the order attribution checks Shopify's Customer Privacy API.
- **Browsing trail:** it never leaves the browser on its own. A shortened form (3 products + 2 categories: id and name) goes out only inside a user-started `/api/chat` request as `context.recentlyViewed` (product CTA, nudge click). Plain typed messages carry no `context`.
- **Chat:** the full in-memory history goes out on every turn, including silent tool parts and their outputs. The widget does NOT trim what it sends: `toWire()` maps the whole in-memory `messages` array, which grows freely during a page view. Only storage is capped (last 40 in `ms-chat-history:<sid>`, `loadHistory()` / `saveHistory()`). Over the per-request cap (AC §2, 40 messages) the backend answers 400 `payload_too_large`, which the widget turns into the „Neuen Chat starten“ notice (in practice around the 21st user message; after a reload of a 40-message history the very next send fails). See 03 §3.3. For a signed-in customer that can include `get_order_status` output, which comes back from the backend.
- **Chat `context`** (product CTA, nudge click only): the product handle (or numeric id as fallback) and `productTitle`, plus `recentlyViewed` ids and names.
- **Contact form** (`buildContactForm()` → `POST /api/contact`): `reason`, `name`, `email`, `organization`, `phone`, free-text `message`, optional `productIds`, and `sessionId` (the sid).
- **Email capture** (`buildCaptureCard()` → `POST /api/capture-email`): `sessionId`, `email`, `transactionalConsent`, `marketingConsent`, the echoed `consentTextShown`, `locale`, optional `trigger`.
- **Feedback** (`POST /api/feedback`): free-text `message`, `sessionId`, `conversationId` (the `conversationKey`, signed-in only), coarse `tier`, `page` (`location.pathname` only, via `currentPagePath()`), and `email` = the in-page `capturedEmail` if any (`identifiedEmail()`).
- **Login redirect** (`initiateLogin()`): `session=<sid>` and `return_url` = the full current `window.location.href`, including any query parameters, go to `/api/auth/shopify/login`.
- The **one-time code** and **campaign token** go only to the backend. Campaign token: attached to each `/api/chat` until the first `res.ok`, then deleted. One-time code: redeemed once, plus at most one retry on the next page load after a 503 / 5xx / 429 / network failure (`ms-chat-link-retry`, `retryPendingLink()`). Both are removed from the URL before Shopify analytics runs.
- **whoami's** answer is used only to redeem its `linkCode`. It is never displayed, logged or forwarded.

---

## 10. Layout modes and viewport handling

The breakpoint is **641 px**: `desktopMq = matchMedia('(min-width: 641px)')`. The CSS uses `@media (min-width: 641px)` and `@media (max-width: 640px)` to match. Every side effect outside the panel goes through **`syncChrome()`**, which is called on open, close, mode toggle and breakpoint change:

| Effect | Condition | Mechanism |
| --- | --- | --- |
| Backdrop (dim + 6 px blur, click closes) | open ∧ desktop ∧ modal | `.ms-chat-backdrop--open` |
| Page shift ("site makes room") | open ∧ desktop ∧ sidebar | `html.ms-chat-page-shift` → `margin-right: var(--ms-chat-sidebar-w)` (436 px) + `overflow-x:hidden`. `html.ms-chat-page-anim` adds a 360 ms transition and is removed after 420 ms (`setPageShift()`). |
| Mobile scroll lock | open ∧ mobile | `html.ms-chat-mobile-open` → `overflow:hidden; height:100%` on `html` and `body` |
| Visual-viewport sizing | open ∧ mobile ∧ `visualViewport` present | `syncMobileViewport()` sets an inline `height = vv.height` px and `transform: translateY(vv.offsetTop)`. If the user was within 120 px of the bottom, the list re-pins to the bottom. The inline styles are cleared otherwise. Bound to `visualViewport` `resize` and `scroll`. |

**Desktop sidebar (default).**
- The panel is docked to the right edge at full height (`.ms-chat-panel--sidebar`, width `--ms-chat-sidebar-w`, `max-width: calc(100vw - 48px)`), with a 360 ms slide-in.
- There is no backdrop, and the storefront stays interactive next to the panel.
- In the 641–749 px band, the theme's `sticky-header` becomes `position:fixed`, so its `right` is pinned to the sidebar width.
- `aria-modal="false"`.

**Desktop modal.**
- The panel is centred (`.ms-chat-panel--modal`): `width: min(900px, 100vw-128px)`, `height: 100dvh-112px`, with a 240 ms scale-in.
- It sits over the backdrop. `aria-modal="true"`.
- The toggle button (`.ms-chat-mode`, icon = target mode) switches modes, persists the choice to `ms-chat-view-mode`, and keeps the scroll position measured from the bottom.
- The deep link `mo_view=fullscreen` applies modal mode **without** persisting it.

**Mobile (≤640 px) is true fullscreen.**
- The panel is edge to edge with no radius, `100vh` → `100dvh` as fallbacks, and the JS visual-viewport height while open. Landscape safe-area padding is applied.
- The backdrop and the mode toggle are hidden. Header icon buttons are 44 px.
- The panel can be closed only with the header ×. There is no tap-outside close and no Esc.
- The launcher is `display:none` while open (`.ms-chat-launcher--hidden`, on all viewports).

**Panel fallback geometry** (no mode class): 410 px wide and 66dvh tall, bottom-right. In practice a mode class is always set on desktop.

---

## 11. Launcher, nudge and attention bounce

**Launcher** (`buildShell()`, `.ms-chat-launcher`)
- A 68 px round "liquid-glass" button containing the animated **brand orb**: `logoEl('ms-chat-launcher-logo')`, i.e. four blurred SVG blobs that rotate and morph via CSS `d: path()`, plus a pulsing halo.
- Position: fixed, `right/bottom: 20px + safe-area`. `aria-label` „Chat öffnen“ / "Open chat". A click toggles the panel.
- Each orb instance gets unique SVG filter ids. This avoids a WebKit/Blink bug where a filter inside a `display:none` subtree broke the other orbs.

**Hidden while theme drawers are open.**
- The theme's `main.mjs` adds `body.no-scroll` whenever a drawer or modal locks scrolling (cart drawer, mobile menu, search, …).
- The CSS rule `body.no-scroll .ms-chat-launcher` fades and scales the launcher out with `visibility:hidden` and `pointer-events:none`. `body.no-scroll .ms-chat-nudge` does the same for the nudge.
- Reason: without this the launcher covered the mobile cart drawer's „Zur Kasse“ button.

**Attention bounce** (`playLauncherAttention()`)
- Once per tab session (`ms-chat-attn-played`, set even when skipped), 1.4 s after init, only if the panel is closed.
- It is skipped entirely under `prefers-reduced-motion`. The class `.ms-chat-launcher--attn` is removed on `animationend`.
- It sends KPI `launcher_attention_played`.

**Contextual nudge** (`initNudgeTriggers()` / `showNudge()`)

| Rule | Value |
| --- | --- |
| Eligibility | panel closed ∧ not `ms-chat-nudge-dismissed` ∧ not `ms-chat-nudge-shown` ∧ not `ms-chat-opened` |
| Triggers (the first one wins, then all are torn down) | `dwell`: 24 s (`NUDGE_DWELL_MS`) on product **or** collection pages. `scroll`: ≥85 % scrolled on **product** pages. `exit`: desktop only, `mouseout` with no `relatedTarget` and `clientY ≤ 16`. |
| Consequence | On home or other pages the nudge can only fire through desktop exit intent. On mobile it fires only on product or collection pages. |
| Copy (priority order) | product page: „Fragen zum Produkt „…“? Ich helf dir gern weiter.“ → collection: „Unsicher, was aus „…“ zu dir passt? Lass es uns klären.“ → category streak (≥2 products of one category in the trail) → generic „Hi, ich bin Mo! …“. The tone rule is to reference the page or category, never the user's behaviour. |
| Click | `nudge_clicked`, opens the panel. For a fresh conversation it sends a **context greeting** (`messages: []` + product context or a browsing context). |
| × | permanent `ms-chat-nudge-dismissed`, `nudge_dismissed` |
| Placement | fixed, 96 px above the bottom-right corner (above the launcher), z-index just below the panel |

---

## 12. Stacking and coexistence with the theme

### 12.1 z-index map

| Layer | z-index | Source |
| --- | --- | --- |
| `.ms-chat-panel` | `--msc-z + 1` = **2147483001** | widget CSS |
| `.ms-chat-backdrop` | `--msc-z` = 2147483000 | widget CSS |
| `.ms-chat-launcher`, `.ms-chat-nudge` | `--msc-z − 1` = 2147482999 | widget CSS |
| `.ms-chat-panel--sidebar` **while `body.no-scroll`** (desktop) | **1800** | widget CSS. The sidebar drops below the theme's drawer so the auto-opened cart drawer slides in on top. |
| Theme modal overlay / panel | 1900 / 2000 | `snippets/template-modal.liquid` |
| Inside the panel: history drawer / gate dialog | 5 / 7 (positioned relative to the panel) | widget CSS |

The desktop **modal** mode keeps its very high z-index even under `body.no-scroll`. The backdrop prevents page interaction in that mode anyway.

### 12.2 Theme hooks the widget depends on (fragile contract)

| Hook | Used by | Owner / risk |
| --- | --- | --- |
| `body.no-scroll` class (`main.mjs` `rn()` / `_e()`) | launcher / nudge hide, sidebar z-drop | theme vendor bundle (minified) |
| `#CartBubble` (exactly one) + `[data-fh-cart-bubble]` | `readBubbleCount()`, `setCartBubble()` | `sections/header.liquid`, which the live editor also edits. A missing `#CartBubble` once broke the theme's own add-to-cart (MANIFEST 2026-10-01). |
| `<cart-modal>` with `reloadContent()` | `reloadCartDrawer()` | `main.mjs` |
| `.section-main-cart` with a `shopify-section-*` id | `reloadCartPageSection()` | cart section (the widget is not rendered on /cart, so this path is effectively dormant) |
| `window.routes.cart_url` (`'/cart.js'` or the locale variant) | `cartJsUrl()` | `layout/theme.liquid` |
| `sticky-header` element (641–749 px) | page-shift CSS | `sections/header.liquid` |
| `window.ShopifyAnalytics.meta.page.customerId` | `storefrontCustomerHint()` | Shopify |
| `window.Shopify.customerPrivacy.analyticsProcessingAllowed()`, `visitorConsentCollected` event | attribution consent gate | Shopify consent banner |
| Theme CSS custom properties (`--button-primary-background`, `--color-base-*`, `--block-corner-radius`, `--font-body-family`, …) | widget colours, radii, font | theme settings |

---

## 13. CSS architecture

- **Prefix isolation:** every selector starts with `.ms-chat-` (about 172 distinct classes). The exceptions are the `html.ms-chat-*` state classes and `body.no-scroll` combinators. There is no Shadow DOM, so theme CSS can leak in. Avoid generic element selectors in the theme that would match inside `.ms-chat-root`.
- **Tokens:** defined on `.ms-chat-root` and mapped from the theme's tokens, with literal RGB fallbacks. The rule is "Do not hardcode brand hexes."
  - Colours: `--msc-accent`, `--msc-accent-fg`, `--msc-secondary`, `--msc-secondary-fg`, `--msc-bg`, `--msc-fg`, `--msc-heading`, `--msc-sale`, `--msc-danger`, `--msc-success`. These are RGB triplets used as `rgb(var(--x) / a%)`.
  - Radii: `--msc-card-radius`, `--msc-btn-radius`, `--msc-input-radius`.
  - Derived: `--msc-muted`, `--msc-border`, `--msc-border-strong`, `--msc-surface`.
  - `--msc-z` (2147483000) and `--msc-font`.
  - Orb tokens: `--msc-logo-rim`, `--msc-logo-base`, `--msc-logo-rim-shadow`. The product CTA reuses `--msc-logo-rim-shadow`.
  - `--msc-composer-radius`.
  - `:root { --ms-chat-sidebar-w: 436px }` lives on `:root` because the page-shift rule is on `<html>`.
- **Modifiers** use the `--modifier` BEM style (`ms-chat-panel--open`, `ms-chat-send--hidden`, …), and the JS toggles them with `classList.toggle`. The JS writes inline styles only for `display:none`, the visual-viewport height and transform, and textarea auto-grow (capped at 120 px, which must match the CSS `max-height`).
- **Reduced motion:** the final `@media (prefers-reduced-motion: reduce)` block removes transitions and animations from the launcher, attention bounce, nudge, backdrop, generating avatar, header pill reveals, history drawer, panel open, composer, voice indicators and the consent-checkbox attention. It freezes **every** orb (`.ms-chat-logo .ms-chat-blob`). The JS also skips the attention bounce (`prefersReducedMotion()`). A few component-level reduced-motion blocks exist earlier in the file.
- **Responsive:** the 640/641 px split (§10), `@media (hover: none)` for touch, and 40 px composer buttons on mobile.
- `!important` is used in only 5 places (launcher hidden while open, page shift, sticky header ×2, mobile scroll lock). Keep it that way.

---

## 14. Internationalisation (i18n)

**Detection** (top of the file):
1. `CFG.locale` (Shopify `localization.language.iso_code`) is normalised by `msNormLocale()`: `/^en/i` gives `'en'`, anything else gives `'de'`.
2. If the result is not `'en'` but `location.pathname` matches `^/en(/|$|?|#)`, it becomes `'en'`. A `/en` page can never get German chrome.
3. The default is `'de'`. German output is meant to stay byte-identical to the pre-i18n version.

**How strings switch**
- `L(de, en)` returns the German or English variant. It is used about 114 times inline (call sites, excluding the definition; this includes the four in `MKT_RESULT_COPY`).
- The copy tables `CONSENT_COPY`, `FEEDBACK_COPY`, `ACCOUNT_COPY`, `OPTIN_COPY`, `GATE_COPY` and `DOWNLOAD_COPY` are German objects with an `Object.assign` English overlay when `LOCALE === 'en'`. Contact-form reason titles have DE and EN maps.
- Formatting: `euro()` gives `1.234,5 €` (de-DE) or `€1,234.50` (en-GB). Conversation dates use `toLocaleDateString(L('de-DE','en-GB'))`.

**Sending the locale to the backend** (which endpoint reads it: AC §12.2)
- Header `x-ms-locale` on all guarded calls.
- Body `locale` on `/api/chat`, `/api/capture-email` (`buildCaptureCard()`) and `/api/account/marketing-opt-in` (`buildMarketingOptInCard()` and the consent popup's accept in `presentConsentGate()`). On the two consent POSTs it must match the locale the consent copy was served in (AC §12.3).
- `?locale=` on the consent-copy GETs.
- `/api/products`, `/api/kpi` and the whoami call carry no locale.

**Hard-coded widget chrome vs backend-served text**

| Hard-coded in the widget (DE + EN via `L()` / copy tables) | Served by the backend, rendered verbatim, **never** hard-coded |
| --- | --- |
| Header labels, placeholder „Wie kann ich dir helfen?“, disclaimer „KI-Fitnessberater – Antworten können Fehler enthalten“, notices and errors („Es gab ein Problem. Bitte versuch es gleich nochmal.“, „Chat ist gerade nicht verfügbar.“, „Zu viele Anfragen — bitte kurz warten.“), nudge copy, sign-in card and login popup („Hol mehr aus deiner Beratung“, benefits, „Später“), card labels („Zum Produkt“, „Ausverkauft“, „Lieferzeit“), capture / feedback / opt-in **chrome** (buttons, validation, success titles), marketing outcome texts, history-drawer chrome, export/erase **chrome** | Mo's replies (the language follows `locale`). **Legal/consent copy:** capture-form labels, the footer, `consentTextShown`, the returning-customer hint (`GET /api/consent-copy`, also seeded from `offer_email_summary` output). The signed-in opt-in headline, label and footer (`?surface=signin`, shown only when `lawyerApproved === true`). The erase confirmation and done text (`?surface=erase`; no fallback, so no copy means no erase). Product data (names, prices, specs, delivery time; German catalog). `comparisonContext`, tool `message` intros. |

**Not localised**
- Speech recognition (`recognition.lang = 'de-DE'`) and the browser speech-synthesis fallback (`u.lang = 'de-DE'`, `pickGermanVoice()`) are **German even on /en**.
- The product-page CTA label („Detaillierte Beratung zu diesem Produkt“) is hard-coded German in the template JSON.

---

## 15. Accessibility

| Area | Implementation | Gaps |
| --- | --- | --- |
| Launcher | `<button>` with `aria-label`, `:focus-visible` outline, ≥44 px | It is removed with `display:none` while the panel is open. Focus is **not** returned to it on close. |
| Panel | `role="dialog"`, `aria-label` „AI Fitnessberater“. `aria-modal` is `true` only in desktop modal mode (`applyViewMode()`). Focus goes to the textarea 50 ms after open. | **No focus trap and no Esc-to-close** on the panel itself, including in modal mode where `aria-modal="true"`. |
| Gate dialogs (login popup, consent popup, erase done) | `openGateDialog()`: `role="dialog"`, `aria-modal="true"`. Focus trap over enabled `button, input, a[href]`; Esc and backdrop count as "later". Focus returns to the textarea, or to the message list (`tabindex=-1`) while streaming. | — |
| History drawer | `role="dialog"`. `aria-hidden` toggled. `visibility:hidden` while closed, so it is out of the tab order. | No focus move into the drawer on open (not verified in depth). |
| Erase confirmation | `role="group"`, messages with `role="alert"`, focus moves to the heading, Esc cancels, `aria-labelledby/-describedby` via `eraseSeq` ids | — |
| Messages | The generating row has `role="status"` and `aria-label` „Mo antwortet“ | **No `aria-live` region** on the message list or the notice bar, so streamed replies and notices are not announced. |
| Mic / voice mode | `aria-pressed` toggled, labels change with state | — |
| Send button | hidden with `visibility:hidden` when the input is empty, so it is out of the tab order. Enter sends, Shift+Enter adds a newline. | — |
| Motion | `prefers-reduced-motion` honoured in CSS and JS (§13) | — |
| Decorative SVG | `aria-hidden="true"`, `focusable="false"` | — |

---

## 16. Browser support assumptions

- **Syntax:** ES5 only, with no transpiler. Keep it that way. The file is pasted as-is into Shopify.
- **Required APIs (no fallback):** `fetch` + `Promise`, `ReadableStream.getReader()` + `TextDecoder` (SSE parsing), `URL` / `URLSearchParams`, `Object.assign`, `Element.replaceChildren()` (about 32 uses; Safari ≥14 / Chrome ≥86), `Element.closest()`, `<template>`, `classList.toggle(name, force)`, `history.replaceState`, `DOMParser`, `URL.createObjectURL` (downloads), `requestAnimationFrame`, `matchMedia`.
- **Optional, feature-detected:** `crypto.randomUUID` (with a `Math.random` fallback), `AbortController`, `visualViewport`, `MediaQueryList.addEventListener` / `addListener`, `navigator.sendBeacon` (used only when `fetch` is missing), `SpeechRecognition` / `webkitSpeechRecognition` (the mic and voice-mode buttons are not rendered without it), `speechSynthesis`, Shopify `customerPrivacy`.
- **CSS:** `dvh` (with `vh` fallback), `env(safe-area-inset-*)`, `backdrop-filter` (it degrades to a plain dim), the animatable SVG `d: path()` (static first frame where unsupported), custom properties with the `rgb(var(--x) / a)` syntax.
- **No polyfills are shipped.** Very old browsers (IE, pre-2020 Safari) are effectively unsupported.

---

## 17. Performance and size

- **Payload:** JS ~316 KB raw / ~92 KB gzip (roughly 35–40 % comments). CSS ~70 KB raw / ~18.5 KB gzip. Both load on **every** storefront page where the widget is enabled, with no lazy loading. The JS is `defer`. The CSS is a `<link>` at the end of `<body>`. Neither is minified, because there is no build step.
- **Idle cost:** the launcher orb animates forever (blob rotate/morph with SVG Gaussian blur, up to `stdDeviation=100`, plus a box-shadow halo). The product-page CTA orb animates too. Under reduced motion all of it is frozen.
- **Network at load:** see §2.6 (`/cart.js` on every `pageshow`; KPI once per session; possibly a cart attribute stamp). For a visitor with stored history, add the restored cards' re-fetches on **every** page view: `GET /api/products` per restored product / compare / showroom / contact / capture card (batches of 10) and one uncached call per restored `add_to_cart` card, `GET /api/consent-copy` per restored capture card, and possibly `POST /api/attribution/token` + `POST /cart/update.js` from a restored `show_product` card (consent-gated).
- **Caches:** product hydration (per page), consent copy (60 s). Nothing is cached across pages except localStorage data.
- **Chat payload:** each turn sends the full in-memory history, including tool inputs and outputs, uncapped on the client (storage keeps the last 40). Over the per-request cap the backend answers `payload_too_large` (AC §2; see §9 and 03 §3.3).
- **Hydration:** `/api/products` in batches of 10 ids. Unknown ids are cached as `null`. Failures cache nothing, so the request is retried on the next tool call.

---

## 18. Error-handling conventions

| Convention | Where | Rule |
| --- | --- | --- |
| **Fail-silent telemetry** | `track()` | Fire-and-forget. The response is never read, errors are swallowed, and telemetry can never break a flow. |
| **Fail-silent extras** | attribution, cart sync, whoami, deep link, campaign token, orb hydration | Wrapped in `try/catch` / `.catch(function(){})`. Shopping and chat never wait on them. Attribution gives up for the current page view after one failed mint. |
| **Fail-closed auth** | `probeAuth()`, `applyAuth()`, `redeemLinkCode()`, `accountUnauthorized()` | Any error means not signed in. Transient errors keep the device hints. Definitive answers wipe them and, if the device was signed in, wipe the sid-bound history (`endedSignInCleanup()`). |
| **Fail-closed legal copy** | consent and erase copy | No valid served copy means no consent UI and no erase. There is never fallback legal text. The signed-in popup also requires `lawyerApproved === true`. |
| **Stale-reply guards** | `startStream()` (`streamSid`, `cancelled`; `cancelled` is set via `abortActiveStream` by `dropSessionHistory()`, `startNewChat()` and `openConversation()`), `accountReplyStale(reqSid)`, `probeAuth()` (`sid !== reqSid`), `detectViaStorefront()` (`askSid`) | An answer that arrives after a session change is dropped. |
| **Chat HTTP errors** (codes: AC §1 "Error envelope") | `handleChatHttpError()` | 429 → roll back the optimistic user message, lock the input for `Retry-After` (default 30 s), warn notice. 401/403 → `console.error` with the probable cause (secret / `ALLOWED_ORIGINS`), shopper sees „Chat ist gerade nicht verfügbar.“. `payload_too_large` → notice with „Neuen Chat starten“. 5xx/`internal_error`/`upstream_unavailable` → `console.error('[ms-chat] chat error', status, code)` and „Es gab ein Problem…“. Any other 4xx (e.g. `bad_request`) → the same `console.error`, „Chat ist gerade nicht verfügbar.“. Every case rolls back and restores the typed text to the input. |
| **Stream errors** | `startStream()` | An `error` SSE event only sets `streamErrored`. On the next `finish` / `[DONE]` / socket close, `finalizeStream()` keeps any partial answer and appends an error row. With no content, `finalizeStream()` does **not** roll back: the user message stays in `messages` and in `ms-chat-history:<sid>`, the typed text is not restored, and the next turn sends two consecutive user messages. A network / fetch failure (the fetch `.catch`) keeps partial content if any arrived. With no content it calls `rollback()` (removes the user message and restores the typed text). Unknown event types are logged with **type only** (never the body, which could hold order data). |
| **Render-nothing guards** | tool cards | Unknown products, fewer than 2 compare items, or an empty `add_to_cart` render nothing. Unknown or silent tools are never rendered. |
| **Console** | — | `console.warn` for the missing secret. `console.error` for chat failures, 401/403 and redirect failures. `console.debug` for unhandled stream event types. No PII is logged. |

---

## 19. KPI events emitted by the widget (index)

Every `track()` call in the file (grep-complete). The payload shape is `{event, sessionId: sid, timestamp: ISO, data}` (AC §5). This is the location index only; the catalogue (`data`, triggers, meaning) is `05` §4.

| Event | `data` | Emitted in |
| --- | --- | --- |
| `chat_opened` / `chat_closed` | `{}` | `openPanel()` / `closePanel()` (every open and close, not once; includes the no-click opens from a deep link or sign-in return, §2.6) |
| `message_sent` | `{}` | `sendMessage()`. This includes the product-CTA primer message and voice transcripts. It excludes the nudge's context greeting (`sendContextGreeting()`), which has no user message. |
| `launcher_attention_played` | `{}` | `playLauncherAttention()` |
| `nudge_shown` | `{pageType, contextual, trigger}` (`trigger` always present: `dwell` / `scroll` / `exit`) | `showNudge()` |
| `nudge_clicked` / `nudge_dismissed` | `{pageType, contextual}` (no trigger) | `showNudge()` |
| `product_cta_opened` | `{productId}` (numeric Shopify id) | `openWithProduct()` |
| `product_cta_clicked` | `{productId}` (catalog id) | `productButton()`, add-to-cart card item links |
| `add_to_cart_clicked` | `{productId, productIds}` | `buildAddToCart()` checkout button |
| `showroom_clicked` | `{productIds}` | `buildShowroom()` |
| `email_capture_declined` | `{trigger?}` | `buildCaptureCard()` decline |
| `voice_mode_on` / `voice_mode_off` / `voice_reply_played` | `{}` | voice mode |
| `summary_download_started` / `summary_downloaded` | `{}` | `downloadSummary()` |
| `account_signin_started` | `{source?:'login_gate'}` | `initiateLogin()` |
| `account_signin_return` | `{result: 'ok'|'link_failed'|'login_required'|'error'}` | `handleAuthReturn()` |
| `account_signout` | `{}` | `signOut()` |
| `account_history_opened`, `account_new_consultation`, `conversation_opened`, `conversation_renamed`, `conversation_deleted` | `{}` | history drawer |
| `account_export_started` / `account_exported` | `{}` | `buildExportControl()` |
| `login_gate_shown` / `_signin_clicked` / `_declined` / `_dismissed` | `{}` | `presentLoginGate()` |
| `consent_gate_shown` / `_accepted` / `_declined` / `_dismissed` | `{surface:'signin'}` | `presentConsentGate()` and the inline opt-in card |

The widget does **not** emit: any erase event (`account_erased` is server-only) [PR #73; **the pre-PR #73 widget, live until 2026-10-04, still emitted `track('account_erased', {})`** after a successful erase, §1.1], `email_capture_submitted` (server), a "widget impression" event, or a `contact_form_submitted` (server-only; session keying: AC §4). Server-only list: AC §5.

---

## 20. Development constraints for future changes

1. **Single file, no build.** All JS stays in `assets/ms-chat-widget.js` and all CSS in `assets/ms-chat-widget.css`: ES5, no imports, no dependencies.
   - New top-level `var` initialisers run in source order at parse time. Function declarations are hoisted, but a `var` used by code that runs **before** `init()` must be declared above that code.
   - Put new UI chrome strings behind `L()` or a copy table with an EN overlay.
   - Never hard-code legal or consent text. Serve it from the backend and render it verbatim.
2. **Manual deployment.**
   - The owner copies changed files from `main` into the Shopify code editor.
   - Every change must add a dated section to the top of `MANIFEST.md` with a table of files and "Re-upload to Shopify?".
   - Backend changes that need a widget change must stay compatible with the *currently uploaded* widget until the owner uploads the new one (AC §0 rule 3). Keep such behaviour behind a backend switch that is default off in code (for example `CHAT_PAGE_CONTEXT_ENABLED`) until the new build is live and checked (README §4).
   - The install guide at the bottom of `MANIFEST.md` is partly outdated (see §21).
3. **Two editors, risk of drift.**
   - The live theme is also edited in the Shopify theme editor by another person (sections, templates, app blocks).
   - Mo-relevant files touched there: `sections/header.liquid` (`#CartBubble`), `templates/product*.json` (the CTA `custom_liquid` blocks), `layout/theme.liquid` (head script + render line), `config/settings_data.json`.
   - The repo is periodically re-synced from a downloaded live snapshot with a three-way merge. A sync on 2026-08-12 (`f7dc50a`) silently replaced the widget JS with an older copy and reverted PR #67 / #62. This was fixed on 2026-10-01.
   - **Before and after every upload, diff the live files against the repo**, especially `ms-chat-widget.js` / `.css` and the two Liquid hooks.
4. **Rollout state:** not kept here — `docs/ROLLOUT_TODO.md` and `npm run verify:widget` (README §4). The owner facts written here on 2026-10-04 are archived in `docs/archive/FRONTEND_ROLLOUT_STATE_2026-10-04.md`.
5. **Design rules worth keeping:**
   - Additive tiers: anonymous and email-only behaviour stay byte-identical when signed-in features change.
   - Lazy network: no auth calls before the first open (which may be a no-click open, §2.6), apart from the sign-in-return and 503-retry paths.
   - Once-per-session caps live in sessionStorage; long-term "don't ask again" lives in localStorage with explicit TTLs.
   - Every privacy-relevant reset goes through `dropSessionHistory()`.
   - KPI payloads never carry text, emails or names.

---

## 21. Known issues and risks found while documenting

Listed for triage. Items 1, 3, 18 and 19 (and the `order_support` label, 03 §20 finding 2) were fixed on 2026-10-04 (`8d0a0c4`, `3e87341`) and keep their numbers so references stay stable. The others are open.

1. **[Fixed 2026-10-04] New chat during a streaming reply.** `startNewChat()` and `openConversation()` start with `if (abortActiveStream) { abortActiveStream(); abortActiveStream = null; }` + `endSpeaking()` + `removeTyping()`, so the old turn's `cancelled` flag makes its fetch, pump, events and `finalizeStream()` no-ops and any voice-mode audio queued for it stops (in `openConversation()` this runs once the transcript has loaded). Before 2026-10-04 a signed-in user's late reply could land in, and be saved with, the new or opened thread (stray history entries in data from before that day).
2. **[PR #73] The `<head>` stash also runs where the widget does not mount** (cart, excluded templates, empty secret). It removes `ms_auth` / `ms_code` / `mo_c` from the URL and leaves the stash for up to 10 minutes, to be consumed by the next page that mounts the widget. This is mostly harmless today because `return_url` is a page with the widget.
3. **[Fixed 2026-10-04] `contact_form_submitted` session.** `buildContactForm()` adds `sessionId: sid` to the JSON body (the `x-ms-session` header stays). The backend keys the row on the body field, else on the header (`src/app/api/contact/route.ts`, AC §4). Rows from before the 2026-10-04 upload have `sessionId: null` and cannot be joined to sessions or chats.
4. **No widget-impression KPI.** `launcher_attention_played` is the only passive signal, and it is skipped under reduced motion and capped at once per tab session. Funnels that need "sessions that saw Mo" are approximate.
5. **KPI is not consent-gated** (only attribution checks Shopify's Customer Privacy API). The events are pseudonymous, but this should be a deliberate legal decision. Today it is implicit.
6. **The device-level trail and decision keys survive sign-out and erase** (`ms-chat-trail`, `ms-chat-mkt-decision`, `ms-chat-login-gate-snooze`, `ms-chat-nudge-dismissed`, `ms-chat-view-mode`). The trail holds product handles and names of recently viewed pages. Check whether "Alle meine Daten löschen" should also clear it on the device.
7. **Panel accessibility:** no focus trap and no Esc-to-close for the panel even when `aria-modal="true"` (modal mode), no focus return to the launcher, no `aria-live` for replies or notices.
8. **Voice is German-only on /en** (`de-DE` recognition and the synthesis fallback).
9. **`allowedFromTheme` config field is dead.** `CFG.whoamiPath` is an undocumented override. `showroomUrl` is hard-coded in the snippet rather than being a setting.
10. **`window.MS_CHAT.openEmailSummary` → `openCaptureForm()` does not check `auth.signedIn`.** The header share button is hidden for signed-in users, but the public API (or a third-party caller) can still show the typed-email capture form to a signed-in customer, contrary to the tier-3 "no double-ask" rule. Note: `openCaptureForm()` is **intentionally** reachable for signed-in customers through the opt-in card's `no_verified_email` fallback (`buildMarketingOptInCard()` → the `OPTIN_COPY.noEmailBtn` button → `markOptInDone(); card.remove(); openCaptureForm();`). A fix should guard only the public-API path (for example a wrapper for `MS_CHAT.openEmailSummary` that checks `auth.signedIn`), not `openCaptureForm()` itself.
11. **Multi-tab history clobbering** (§8): two tabs on the same sid overwrite each other's `ms-chat-history:<sid>`. The last writer wins.
12. **Stale docs:** code comments point to `docs/ai-advisor/*.md`, which does not exist in this repo (the contract is the backend's `docs/frontend/`). The `MANIFEST.md` install guide still names `https://motionsports-chatbot.vercel.app` / `chat.motionsports.de` and describes a "black launcher" and "typing dots" (the current default is `https://mo.motionsports.de`, the orb launcher and the avatar animation).
13. **`GET /cart.js` on every page load** through the initial `pageshow`. This is cheap, but it is an extra request on every page view sitewide.
14. **The cart exclusion is a substring test** (`template contains 'cart'`), so any future template whose name contains "cart" is also excluded.
15. **`add_to_cart` with more than 10 products renders nothing.** `buildAddToCart()` sends all deduplicated `productIds` in one `GET /api/products?ids=` with no `chunk()`. Over the AC §3 id cap (10) the backend answers 400 `payload_too_large`; `buildAddToCart()` then resolves `null` and the checkout card silently disappears. Either the backend caps `add_to_cart` at 10 ids, or the widget splits the request. The card needs one combined `cartUrl`, so a backend cap is simpler.
16. **Restored history costs backend calls on every page view** (§2.6). Each stored product / compare / showroom / contact / capture / add-to-cart card is re-fetched at `init()`, even if the visitor never opens the panel. A restored `show_product` card can also mint an attribution token and stamp the cart without interaction. Backend dashboards that count `/api/products` or `/api/attribution/token` calls see this traffic as page views, not chat activity.
17. **An `error` SSE event with no content leaves an unanswered user message in history** (§18). The next send carries two consecutive user messages.
18. **[Fixed 2026-10-04] Product-page CTA could render dead** (§3.3). The CTA `custom_liquid` blocks are gated only on `ai_advisor_enabled`; the snippet gates on a non-blank `ms_chat_shared_secret` too, and where it does not render the widget it emits a `<style>` hiding `.ms-chat-product-advisor` / `.ms-chat-product-cta` (§2.3). **Remaining edge (not fixed):** if `ms-chat-widget.js` fails to load, or a shopper clicks before the deferred script has booted, the button still does nothing.
19. **[Fixed 2026-10-04] Three product templates had no CTA** (`product.produkt-new`, `product.produktnew`, `product.produkte-im-set`); they carry the "MO only" block since 2026-10-04 (§3.3), so `product_cta_opened` volumes are not comparable across that day for reasons unrelated to the widget code.

---

## 22. Open questions / uncertainties

- **`keepalive` + CORS preflight:** `track()` sends `Content-Type: application/json` and the custom `x-ms-session` header with `keepalive:true`, which needs a preflighted keepalive request. Browser support for preflighted keepalive fetches has historically been incomplete (older Chromium did not support it). Whether events fired right before a navigation (`account_signin_started`) are reliably delivered on all target browsers was **not verified**.
- **sessionStorage in `noopener` tabs:** the claim that product tabs opened with `rel="noopener"` start with empty sessionStorage (so the per-session caps and a pending campaign token reset there) follows current HTML-spec behaviour. It was not tested on Safari or iOS.
- **Theme preview / editor origin:** the backend allowlists only `https://www.motionsports.de` and `https://motionsports.de` by default (`ALLOWED_ORIGINS`, AC §1). Whether the Shopify theme editor or a preview domain (`*.myshopify.com`) produces 403s (the widget then shows „Chat ist gerade nicht verfügbar.“) was not checked. The snippet does not special-case `request.design_mode`.
- **History-drawer focus handling** was only skimmed. A full keyboard audit was not done.
- **Live vs repo:** this chapter documents `main` at `3e87341`; which build the shop serves: README §4 (`npm run verify:widget`). Editor changes on live since the 2026-10-01 snapshot are not reflected.
