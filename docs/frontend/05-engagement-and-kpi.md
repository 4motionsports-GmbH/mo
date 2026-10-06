# 05 — Engagement features and KPI telemetry

> **Audience:** backend coding agents of Mo (`4motionsports-gmbh/mo`). They cannot see the theme repo.
> **Source of truth:** the theme repo `ms_shopify_clone`, `main` at `bc7fb5d`: the 2026-10-05 tasks (`11ac337` + `bc7fb5d`, theme PR #75: served consent bullets with `variant` / `placement`, page context on typed turns, attribution-token renewal and cart-marker blanking) on top of `3e87341` (PR #73 "customer platform" `a0df103`, the fixes of `8d0a0c4`, and two added `endSpeaking()` calls). Every claim below comes from reading that tree, mainly `assets/ms-chat-widget.js`. Which build the live shop serves: `07` §6.4; production status (uploads, backend switches) is tracked only in the backend's `docs/ROLLOUT_TODO.md`. Backend behaviour is cross-referenced to the backend repo's widget contract `docs/frontend/API_CONTRACT.md` and `docs/frontend/ACCOUNT_CONTRACT.md` (cited as **API_CONTRACT §n**, **ACCOUNT_CONTRACT §n**), `docs/ADMIN_DASHBOARD.md` (**AD §n**), `docs/ORDER_ATTRIBUTION.md` and `docs/CAMPAIGNS.md` (**CMP §n**). It is not re-specified here.
> Code locations are given as `file → function / key / selector`. Line numbers are left out on purpose because they drift.

This chapter is the complete reference for what the widget measures and how it tries to start conversations. It lists **every** KPI event the widget sends (all 45 `track()` call sites, 35 distinct names) with exact `data` keys, triggers, guards and the function each one lives in. It describes the `POST /api/kpi` transport and how the backend joins events to sessions, then documents the engagement mechanics with their exact rules: the launcher bounce, the contextual nudge and the campaign deep link in full, and the KPI side of the product-page CTA, the order-attribution stamp and the cart refresh after quick checkout (their mechanics are owned by chapter 06). It ends with what is **not** measured today, which funnels can already be computed, and frontend-feasible ideas for each business KPI.

**Contents**

1. [At a glance](#1-at-a-glance)
2. [Transport: `track()` → `POST /api/kpi`](#2-transport-track--post-apikpi)
3. [Session identity and how events join](#3-session-identity-and-how-events-join)
4. [Event catalogue (complete)](#4-event-catalogue-complete)
5. [Events the widget must never send (server-only)](#5-events-the-widget-must-never-send-server-only)
6. [Engagement mechanic: launcher attention bounce](#6-engagement-mechanic-launcher-attention-bounce)
7. [Engagement mechanic: contextual proactive nudge](#7-engagement-mechanic-contextual-proactive-nudge)
8. [Engagement mechanic: product-page CTA](#8-engagement-mechanic-product-page-cta)
9. [Engagement mechanic: campaign deep link and campaign token](#9-engagement-mechanic-campaign-deep-link-and-campaign-token)
10. [Order attribution: the `_mo` cart stamp](#10-order-attribution-the-_mo-cart-stamp)
11. [Cart UI refresh after quick checkout](#11-cart-ui-refresh-after-quick-checkout)
12. [How the admin KPI tab reads these events (and where it misreads them)](#12-how-the-admin-kpi-tab-reads-these-events)
13. [Measurement gaps and KPI opportunities](#13-measurement-gaps-and-kpi-opportunities)
14. [Open questions / uncertainties](#14-open-questions--uncertainties)

---

## 1. At a glance

| Topic | Today's behaviour |
| --- | --- |
| Transport | `track(event, data)` → `POST {apiBase}/api/kpi`, `fetch` with `keepalive: true`. `navigator.sendBeacon` is used only when `window.fetch` is missing. Fire-and-forget: no retry, the response is never read, all errors are swallowed. |
| Payload | `{ event, sessionId: sid, timestamp: <ISO string>, data: {…} }` plus the `x-ms-session: sid` header. No `x-ms-chat-key`. |
| Privacy | Event names, ids and enum flags only. Never message text, never emails, never browsed product **names**, never the campaign token or the sign-in code. |
| Consent | `track()` is **not** consent-gated. Only the order-attribution cart stamp checks Shopify's Customer Privacy API (§10). |
| Session key | `sid` = `localStorage['ms-chat-sid']`. It is the same id as `x-ms-session` on every backend call and the `session=` of the sign-in redirect. The backend joins widget and server events on it. |
| Distinct events | 35 names / 45 call sites. Grouped in §4: open, nudge, conversation, products & commerce, sign-in, consent, capture, account/self-service, voice. **There are no feedback events and no error events.** |
| Engagement mechanics | Launcher bounce (once per tab session), contextual nudge (once per tab session, never again after ×), product-page CTA, campaign deep link `?mo=open` / `#mo-open` with `mo_new`, `mo_view`, `mo_c`. |
| Commerce glue | Consent-gated `_mo` cart stamp (`/api/attribution/token` + `/cart/update.js`), renewed once per page view after a live consultation turn and blanked when the session ends or analytics consent is withdrawn (§10.4). Display-only cart refresh (`/cart.js`) after the "Zur Kasse" quick checkout. |
| Data windows | Which KPI sections are meaningful from which date — tier 3, the consent popup and the login-gate funnel only from 2026-10-04 (no chat sign-in could complete between 2026-10-03 and the widget upload of that day), opt-in `source` / `outcome` from 2026-10-05, the release „Shop-Anmeldung zählt im Chat (App Proxy)“ of 2026-10-05 raises sign-in, consent-popup and account counts, and the three widget releases of 2026-10-06 (`bc7fb5d`: served consent bullets with `variant` / `placement`, page context on typed questions, token renewal and marker blanking) — is shown under the dashboard toolbar (AD §5.0, `src/lib/kpi-releases.mjs`). |
| Biggest gaps | No source on `chat_opened`, no card impressions, no launcher/widget-load event, no error telemetry, no deep-link event. The "Zur Kasse" permalink probably does not carry `_mo`. „Reichweite (Sitzungen)“ on the dashboard is inflated by interaction-free events (`launcher_attention_played`, `nudge_shown`). Details in §12–§13. |

---

## 2. Transport: `track()` → `POST /api/kpi`

Location: `ms-chat-widget.js → track(event, data)` (defined right after the storage helpers, before the page-context block).

### 2.1 Request

```http
POST {apiBase}/api/kpi
Content-Type: application/json
x-ms-session: <sid>

{"event":"nudge_shown","sessionId":"<sid>","timestamp":"2026-10-04T09:12:33.120Z","data":{"pageType":"product","contextual":true,"trigger":"dwell"}}
```

- `apiBase` = `MS_CHAT_CONFIG.apiBase` (theme setting `ai_advisor_backend_url`, default `https://mo.motionsports.de`).
- `sessionId` is the **current** in-memory `sid` at call time (see §3 for rotations).
- `timestamp` is the client clock as an ISO string. The backend stores it as `kpi_events.data.clientTimestamp` (`src/app/api/kpi/route.ts`); the server's `created_at` is authoritative.
- The stored `session_id` comes from the body `sessionId` (trimmed, max 128 chars). The `x-ms-session` header is only the rate-limit key. So even the `sendBeacon` fallback (no header, §2.2) would still be session-keyed.
- `data` is always an object. `track(name)` without data sends `{}`.
- The request is cross-origin (storefront → `mo.motionsports.de`) with a custom header and a JSON content type, so the browser sends a **CORS preflight** first. API_CONTRACT §5 says the endpoint is origin-allowlisted only. A storefront origin missing from `ALLOWED_ORIGINS` silently loses every event.

### 2.2 Delivery semantics

| Property | Behaviour | Consequence for the backend |
| --- | --- | --- |
| Primary path | `fetch(url, {method:'POST', headers, body, keepalive:true}).catch(noop)` | The event can survive a page unload (outbound CTA clicks, the sign-in redirect). |
| Fallback | `navigator.sendBeacon(url, payload)` **only** when `window.fetch` does not exist | In practice this never runs on supported browsers. If it did, it would send `text/plain` with **no `x-ms-session` header** (the body `sessionId` still keys the row, §2.1). Do not rely on it. |
| Errors | Every throw and rejection is swallowed. No retry, no queue, no batching, no deduplication. | Counts are a **lower bound**. Ad blockers, offline clients, a 429 (`kpi` bucket, 120 req/60 s per API_CONTRACT §5) or a 403 drop events silently. The `kpi` bucket is **shared with `/api/attribution/token` mints and renewals** (API_CONTRACT §10): a burst of KPI events can make a mint fail, and `moAttrFailed` then stops attribution for the rest of that page view (`06` §8.2; a failed renewal keeps the cached token, `06` §8.8). |
| Ordering | One request per event, fired synchronously in the caller. | Events of one session can arrive out of order. Order by `created_at` only approximately. Use the client timestamp (`data.clientTimestamp`) for sub-second ordering. |
| Response | Never read. | The 202 contract (API_CONTRACT §5) is only for humans. |
| Unload | `keepalive` plus a CORS preflight. Whether browsers complete a preflighted keepalive request during navigation varies by browser and version (see §14). | `account_signin_started` (fired immediately before `location.assign`) is the event most at risk. |

### 2.3 What never leaves the browser through `track()`

Comments in `track()` and in the page-context block state the rule (the contract: API_CONTRACT §0 rules 13 and 19), and the call sites follow it:

- Never message text, voice transcripts or TTS text (`message_sent`, `voice_*` carry `{}`).
- Never an email address (capture and opt-in submits go to their own endpoints, and the funnel events are server-side).
- Never browsed product **names** or the browsing trail in a KPI event. **`/api/chat` does carry them:** `recentlyViewedPayload()` builds `context.recentlyViewed` from `localStorage['ms-chat-trail']` with up to 3 browsed products (`{type:'product', id, name}`) and up to 2 categories (`{type:'category', name, id?}`). It is sent with the nudge-click context greeting (`showNudge()` click handler, `browsingContext()`) and the product-CTA primer (`openWithProduct()`). Both requests start with a click, but the nudge greeting has no user message. The first typed or spoken message per product or collection page carries the open page's facts only, never the trail (`pageContextForSend()`, `context.source:'page'`; `02` §3.2). The privacy comment above `PAGE_CTX` states exactly these three paths (corrected in `bc7fb5d`).
- Never the campaign token (`mo_c`) or the one-time sign-in code (`ms_code`).
- **Product ids do leave** the browser: `product_cta_opened` (numeric Shopify id), `product_cta_clicked` / `add_to_cart_clicked` / `showroom_clicked` (catalog ids); `product_cta_clicked` also carries the boolean `samePage` (§4.4).

---

## 3. Session identity and how events join

### 3.1 The one id

`sid` (`localStorage['ms-chat-sid']`, `ms-chat-widget.js → getSid()`) is minted with `crypto.randomUUID()` on the **first page load of the widget on a device**, before any interaction. It is used as:

| Use | Where |
| --- | --- |
| `sessionId` + `x-ms-session` of every KPI event | `track()` |
| `x-ms-session` of `/api/chat`, `/api/products`, `/api/contact`, `/api/capture-email`, `/api/tts`, `/api/feedback`, `/api/attribution/token`, `/api/account/*`, `/api/auth/*` | each caller |
| `session=` query of the sign-in redirect `/api/auth/shopify/login` | `initiateLogin()` |
| key of the local transcript `ms-chat-history:<sid>` and the `_mo` token cache `ms-mo-attr` (`{sid, token, cartAttributes}`) | `historyKey()`, `moAttrLoad()` |

Because the KPI `sessionId`, the login `session=` and the later `x-ms-session` of `POST /api/auth/link` are the same value, the admin "Anmelde-Popup" funnel can join `login_gate_signin_clicked` (widget) → `account_signin_succeeded` (server, callback) → `account_signin_linked` (server, code redeemed) (API_CONTRACT §5, AD §5.7a). `initiateLogin()` additionally pins the login's sid in `sessionStorage['ms-chat-login-sid']`. The return never redeems the code under a different sid. A mismatch counts as `account_signin_return {result:'link_failed'}`.

### 3.2 A "session" is not a visit

This is the most important modelling fact for KPI work:

- **`sid` lives in localStorage and persists across visits, days and tab closes** until something rotates it. For an anonymous visitor who never clicks "Neuen Chat starten", one `sid` can span weeks. "Sessions" in `kpi_events` are therefore closer to **devices × conversation epochs** than to visits.
- The **"once per session" guards are per tab session.** They live in `sessionStorage`: nudge, launcher bounce, first-message popup, `consent_gate_shown` dedupe and the campaign token. The auth-return re-open flag (`ms-chat-auth-return`) and the kept link code (`ms-chat-link-retry`) are per tab too. A new tab or a new browser session resets them, while the `sid` stays the same. One `sessionId` can therefore carry several `nudge_shown`, `launcher_attention_played` or `login_gate_shown` events over its lifetime. The admin funnels count **distinct sessions**, which hides this but also merges visits.
- Links the widget opens use `target="_blank" rel="noopener noreferrer"`. In current Chromium a `noopener` tab starts with an **empty** sessionStorage, so a product page opened from a chat card gets fresh per-tab caps (it can bounce and nudge again).
- Without usable localStorage (private mode quirks, blocked storage) `lsGet/lsSet` fall back to memory. A new `sid` is then minted on **every page load**, which inflates session counts.
- Without usable sessionStorage, `ssGet()` / `ssSet()` fall back to an in-memory object (code comment: "silent in-memory fallback degrades to once per page load"). The per-tab caps then become **per page load**: `ms-chat-attn-played`, `ms-chat-nudge-shown`, `ms-chat-opened`, `ms-chat-gate-shown` and `ms-chat-optin-ask-shown` reset on every navigation, so `launcher_attention_played`, `nudge_shown` and the first-message popup can fire on every page (and `ms-chat-ctx-last` resets too, so the first typed message of every page load carries page context again). A campaign token captured on the landing page (`ms_mo_c`) is lost on the next navigation, so no `campaign_chat_started` is recorded if the visitor first chats on a later page. The sign-in return cannot re-open the panel (`ms-chat-auth-return`) or check the login sid (`ms-chat-login-sid` is missing, so `handleAuthReturn()` skips the mismatch check), and `ms-chat-link-retry` / `ms-chat-early-params` do not survive navigation either.
- A signed-in session that ends silently (server-side expiry, logout elsewhere, erase on another device) rotates the sid the next time the widget probes auth or gets a 401 from `/api/account/*` (§3.3), with no KPI event. That customer's funnels are split across two sids. With the App Proxy (ACCOUNT_CONTRACT §3a) two more server-side causes exist: **shop-proof expiry** (a session signed in through the shop login alone, kept open in one tab longer than `APP_PROXY_SIGNIN_MAX_AGE_HOURS` without a new tab — every new tab renews it) and **handover** (whoami sees another shop customer on a signed-in sid and ends that sign-in, so the next customer starts on a fresh sid).

### 3.3 When the sid changes (events before and after land on different sessions)

| Trigger | Function | Tracked? |
| --- | --- | --- |
| Anonymous "Neuen Chat starten" (header button, or the "Dieser Chat ist ziemlich lang geworden…" notice after a 40-message `payload_too_large`) | `startNewChat()` → `rotateSession()` | **No event.** (Signed-in "Neue Beratung" keeps the sid and sends `account_new_consultation`.) |
| Campaign deep link with `mo_new=1` for a visitor without a signed-in hint (signed-in hint = `localStorage['ms-chat-signed-in'] === '1'` **or** the visitor is logged into the shop, `ShopifyAnalytics.meta.page.customerId`; `shouldProbeAuth()` / `storefrontCustomerHint()`) | `handleMoDeepLink()` → `rotateSession()` | No event |
| Sign-out ("Abmelden") | `signOut()` → `dropSessionHistory()` | `account_signout` is sent **under the old sid**, before rotation |
| Erase ("Alle meine Daten löschen") success | `clearAfterErase()` | No widget event (server `account_erased`, session `NULL`) |
| Return from backend logout with `?ms_auth=logged_out`, when `/api/auth/me` confirms the ended session. Rare in practice: no widget code path goes through the backend logout (`signOut()` is local only), so this is reached only if something outside the widget sends the visitor there (or a crafted link). | `handleAuthReturn()` → `probeAuth()` → `endedSignInCleanup()` | No event |
| Signed-in session found ended: `/api/auth/me` returns `signedIn:false` / 401 / 403 (non-transient) for a device with the signed-in hint (`localStorage['ms-chat-signed-in']==='1'` or `auth.signedIn`), or any `/api/account/*` call (history, rename, delete, export, summary, opt-in) returns 401. Covers server-side expiry, logout elsewhere, erase on another device, shop-proof expiry (`APP_PROXY_SIGNIN_MAX_AGE_HOURS`; 401 „Sitzung abgelaufen“) and a whoami **handover** to another shop customer (ACCOUNT_CONTRACT §3a). Runs on any probe (panel open, `visibilitychange`, auth return). | `probeAuth()` / `accountUnauthorized()` → `endedSignInCleanup()` → `dropSessionHistory()` → `rotateSession()` | No event (also sets `sessionStorage['ms-chat-whoami-done']` so shop recognition does not re-link the fresh sid) |
| Another tab rotated the sid | `onSidChangedElsewhere()` adopts the new id | No event |

Every rotation in this tab (`rotateSession()`) calls `moAttrReset()` (clears the in-memory cache and `localStorage['ms-mo-attr']`). Adopting another tab's rotation (`onSidChangedElsewhere()` → `dropSessionHistory(newSid)`) resets only the in-memory attribution state (`moAttr`, `moAttrFailed`, `moAttrConsulted`); the rotating tab already removed the stored token, and `moAttrLoad()` ignores another sid's entry anyway. Either way the next consultation mints a new `_mo` token (`06` §8), but "next consultation" can be a card build that was already running before the rotation (`06` §8.7). Sign-out, erase and a server-ended sign-in blank the old `_mo` attribute on the live Shopify cart before they rotate (`06` §8.9); after an anonymous "Neuen Chat starten" or a `mo_new=1` rotation the cart keeps it until a new stamp overwrites it. Funnels that span a rotation are split: for example, `nudge_shown` lands on sid A and the chat after "Neuen Chat starten" on sid B.

---

## 4. Event catalogue (complete)

Grep-complete over `assets/ms-chat-widget.js` (`grep -n "track('"`). "Tab session" = `sessionStorage` scope (§3.2). `PAGE_CTX.type` is one of `product | collection | home | other` in practice. `cart` exists in code but the widget is never rendered on cart or checkout (`snippets/ms-chat-widget.liquid` gate).

### 4.1 Open / engagement

| Event | `data` | Trigger and conditions | Guard | Function |
| --- | --- | --- | --- | --- |
| `chat_opened` | `{}` | Every transition closed → open. Sources: launcher click, nudge click, product-page CTA (also `window.MS_CHAT.openWithProduct`), campaign deep link, auto re-open after a sign-in return / the link-failed path, and an external call to `window.MS_CHAT.openEmailSummary()` (no theme caller today). The in-panel "Per E-Mail teilen" and "Feedback geben" buttons call `openPanel()` as a no-op and never emit `chat_opened`. | None (fires on every open, not once). No-op if already open. | `openPanel()` |
| `chat_closed` | `{}` | Every transition open → closed: header × (`closeBtn`), backdrop click (desktop modal mode only), launcher toggle (in practice unreachable: the launcher is hidden while the panel is open, `.ms-chat-launcher--hidden`). There is **no Esc-to-close** for the panel (the only Escape handlers are in the gate popups and the erase confirm box). Also ends voice mode first. | None | `closePanel()` |
| `launcher_attention_played` | `{}` | The one-time launcher bounce actually started: 1.4 s after `init()`, panel still closed, launcher exists, **no** `prefers-reduced-motion`. | `sessionStorage['ms-chat-attn-played']`, set at init even when skipped. Once per tab session. | `playLauncherAttention()` |

Notes:
- **Auth-return re-open** is driven by `sessionStorage['ms-chat-auth-return']` (set by `initiateLogin()`, read and deleted by `handleAuthReturn()`). The panel opens on result `ok` if that flag is set **or** the `/api/auth/me` probe says signed in, and on `link_failed` / `login_required` / `error` only if the flag is set. It never opens on `logged_out`. The flag is per tab, so a sign-in finished in another tab does not re-open.
- `chat_opened` has **no source field**. The source can only be inferred from a neighbouring event in the same session within milliseconds (`nudge_clicked`, `product_cta_opened`) or from timing (auth return). See §13.
- The panel is never open at page load (the open state is not persisted). Every page navigation followed by a re-open counts another `chat_opened`.
- `launcher_attention_played` fires **without any user interaction**, on the first page of each tab session. It is the only reach-like event, and it inflates „Reichweite (Sitzungen)“ (§12).

### 4.2 Contextual nudge

| Event | `data` | Trigger | Guard | Function |
| --- | --- | --- | --- | --- |
| `nudge_shown` | `{ pageType, contextual: bool, trigger: 'dwell' \| 'scroll' \| 'exit' }` | The first applicable trigger fired and the nudge was eligible (§7). | `sessionStorage['ms-chat-nudge-shown']`, set on show. Not after `localStorage['ms-chat-nudge-dismissed']='1'`. Not if `sessionStorage['ms-chat-opened']`. | `showNudge(trigger)` |
| `nudge_clicked` | `{ pageType, contextual: bool }` (**no `trigger`**) | Tap on the bubble text. Then `openPanel()` (→ `chat_opened`) and, for a fresh conversation with usable context, a context greeting (§7.5). | Inherent: one nudge per tab session | `showNudge` → click handler |
| `nudge_dismissed` | `{ pageType, contextual: bool }` (**no `trigger`**) | Tap on × ("Hinweis schließen"). Writes `localStorage['ms-chat-nudge-dismissed']='1'`, so the nudge **never** shows again on this device. | Same | `showNudge` → × handler |

`pageType` = `PAGE_CTX.type`. `contextual` = `false` only for the generic copy "Hi, ich bin Mo! …".

### 4.3 Conversation

| Event | `data` | Trigger | Guard | Function |
| --- | --- | --- | --- | --- |
| `message_sent` | `{}` | Every user message pushed into the transcript: composer send, voice transcript, product-CTA primer message (§8). Sent **before** the network request, so a turn that later fails (429/5xx, rolled back) still counted. Whether the turn carried page context (`source:'page'`) is not in the event; the server records it (`page_context_applied`, §12). | None | `sendMessage(text, context)` |

**Not counted as `message_sent`:** the nudge's context greeting (`sendContextGreeting()`, `messages: []`, no user message). There is no event for "assistant replied", stream errors, rate-limit locks or the 40-message cap.

### 4.4 Products and commerce

| Event | `data` | Trigger | Guard | Function |
| --- | --- | --- | --- | --- |
| `product_cta_opened` | `{ productId: <numeric Shopify product id as string> }` | Click on the storefront CTA "Detaillierte Beratung zu diesem Produkt" (§8). Fires after `openPanel()`, even when the widget is busy and no message is sent. | None | `openWithProduct(id, title)` |
| `product_cta_clicked` | `{ productId: <catalog id>, samePage: bool }` | Click on "Zum Produkt" in a `show_product` card or in a `compare_products` table (`productButton()`). Also the fallback product links of an `add_to_cart` card that has no `cartUrl` (`buildAddToCart()`). Opens `shopifyUrl` in a new tab. | None | `productButton()`; `buildAddToCart()` fallback branch |
| `add_to_cart_clicked` | `{ productId: <first resolved catalog id>, productIds: [<all resolved catalog ids>] }` | Click on "Zur Kasse" in an `add_to_cart` card (opens the combined cart permalink `cartUrl` in a new tab). Same handler: `moAttrEnsure(false)` (re-stamp, §10) and `pollCartAfterCheckout()` (§11). | None | `buildAddToCart()` |
| `showroom_clicked` | `{ productIds: [<catalog ids>] }` | Click on "Showroom ansehen" in a `suggest_showroom` card (opens the showroom page). | None | `buildShowroom()` |

Caveats:
- **Two id spaces.** `product_cta_opened` sends the **numeric** Shopify id (`data-ms-chat-product-id="{{ product.id }}"`, comment: "numeric id stays for KPI"). The other three send the catalog id from `/api/products`: always the base product handle, even for a variant ref (`06` §2.3, API_CONTRACT §3). They cannot be joined without the catalog.
- `productIds` in `add_to_cart_clicked` includes sold-out products that were rendered with "Ausverkauft — nicht im Warenkorb", even though the server-built `cartUrl` excludes them (API_CONTRACT §3).
- `samePage` (`isSamePageProduct()`, computed at click time) is `true` only on a product page whose `PAGE_CTX.productHandle` equals the clicked catalog id, `false` everywhere else (always on non-product pages). Rows from widgets before `bc7fb5d` have no `samePage`; the dashboard reads „not `true`“ as „andere Produkte“ (API_CONTRACT §5 "Product clicks (widget)", AD §5.1a).
- `product_cta_clicked` carries **no surface**. A click from a single product card cannot be told apart from one in a comparison table or the add-to-cart fallback.

### 4.5 Sign-in popup and sign-in

All widget truth. The server adds `account_signin_succeeded` / `_linked` / `_link_refused` (API_CONTRACT §5).

| Event | `data` | Trigger | Guard | Function |
| --- | --- | --- | --- | --- |
| `login_gate_shown` | `{}` | Anonymous visitor, ~700 ms after a user message is **sent** (while the reply streams; `sendMessage()` → `setTimeout(maybeShowConsentGate, 700)`), unless that send was already rolled back (429/5xx/network) or the widget is rate-locked by then. It does not wait for the reply to succeed: a request that fails after the popup appeared still has the popup counted. If the auth tier is unsettled it polls up to 10 × 500 ms, so the popup can appear up to ~5.7 s after the send. Also: panel open, not in voice mode, not snoozed. | `sessionStorage['ms-chat-gate-shown']` (one first-message popup per tab session, shared with the consent gate). `localStorage['ms-chat-login-gate-snooze']` timestamp: 24 h after "Später". | `presentLoginGate()` |
| `login_gate_signin_clicked` | `{}` | "Anmelden" in the popup. If the reply is still streaming, the button shows "Antwort wird noch geladen…" and the redirect waits until streaming ends (200 ms steps, max 20 s). | — | `presentLoginGate()` |
| `login_gate_declined` | `{}` | "Später". Writes the 24 h snooze. | — | `presentLoginGate()` |
| `login_gate_dismissed` | `{}` | Esc or backdrop click (no snooze; the tab-session guard keeps it quiet). | — | `openGateDialog(…, onDefer)` |
| `account_signin_started` | `{ source: 'login_gate' }` from the popup, otherwise `{}` | **Any** sign-in start: popup, welcome card "Jetzt anmelden", header "Anmelden", drawer "Mit Kundenkonto anmelden", the "Die Anmeldung ist abgelaufen…" notice. Immediately followed by `location.assign()` to `/api/auth/shopify/login?session=<sid>&return_url=<page>`. | — | `initiateLogin(source)` |
| `account_signin_return` | `{ result: 'ok' \| 'link_failed' \| 'login_required' \| 'error' }` | On the page load that carries `?ms_auth=` (or its head-script stash). `ok` is sent **only after** the one-time code was redeemed (`POST /api/auth/link`). `link_failed` covers a refused code, a missing code, a sid mismatch, or the backend being unavailable (503/429/5xx or network error; then the code is kept for one silent retry on the next page load in the same tab, §12.1 row 7). `logged_out` sends nothing. `login_required` can only come from a `prompt=none` login, which this widget never starts (`initiateLogin()`: "We do NOT use prompt=none here"; `handleAuthReturn()` labels the branch "prompt=none path only"), so it should be ~0 in `kpi_events`. `logged_out` is reached only if something outside the widget sends the visitor through the backend logout (or a crafted link); see chapter 04 §18 item 11. | Once per return (params consumed) | `handleAuthReturn()` |
| `account_signout` | `{}` | Drawer "Abmelden". Sent under the **old** sid, then the sid rotates. | — | `signOut()` |

Details of the sign-in flow (code redemption, whoami, retry) are in chapter 04 and ACCOUNT_CONTRACT §2–§3a.

### 4.6 Consent gate (marketing opt-in for signed-in customers)

Two UIs, one surface: the **popup** after the first message (`presentConsentGate`) and the **inline card** after a mid-conversation sign-in (`presentSignInOptIn` → `buildMarketingOptInCard('signin_return')`). Both send `surface: 'signin'` only. The `'chat'` surface is retired (API_CONTRACT §5).

All four events carry `consentGateData(placement, variant)` = `{ surface: 'signin', placement, variant? }`: `placement` is `'popup'` (popup) or `'signin_return'` (inline card) — the widget never sends `'value_moment'`; `variant` is the served copy's `variant` (`servedVariant()`, only when it matches `^[a-z0-9_-]{1,32}$`), captured from the copy that was rendered. The opt-in POST echoes the same two fields (ACCOUNT_CONTRACT §6.2). Builds before `bc7fb5d` sent `{ surface: 'signin' }` only.

| Event | `data` | Trigger | Guard | Function |
| --- | --- | --- | --- | --- |
| `consent_gate_shown` | as above | Popup: shown after the served copy loaded with `lawyerApproved === true`. Card: once the served copy is rendered (a card that removes itself for missing/unapproved copy is not counted). | `sessionStorage['ms-chat-optin-ask-shown']`, shared by popup and card: **at most once per tab session**. | `presentConsentGate()`; `buildMarketingOptInCard() → renderForm()` |
| `consent_gate_accepted` | as above | "Ja, Angebote aktivieren", sent **only after** `POST /api/account/marketing-opt-in` returned 2xx, and only while the sid is still the one the ask was rendered for (`renderSid`; a late 2xx after a sign-out or rotation sends nothing). (401 → anonymous; 422 → falls back to the typed-email capture form, no event — from the popup only while the dialog is still open.) | — | both |
| `consent_gate_declined` | as above | "Nein, danke". Device memory `localStorage['ms-chat-mkt-decision'] = {state:'declined', at}` mutes both UIs for 30 days. | — | both |
| `consent_gate_dismissed` | as above | Popup only: Esc or backdrop **before** the accept tap; once the accept POST has started (`acceptStarted`), Esc/backdrop sends nothing. Marks opt-in done for this tab session. | — | `presentConsentGate()` |

Eligibility (`consentGateEligible()`, `optInActionable()`): signed in, `auth.optInActionable === true` from `/api/auth/me` (it includes the backend's per-customer anti-nag, ACCOUNT_CONTRACT §6.1), not answered or dismissed this tab session (`ms-chat-optin-done`), no recent device decline, no unanswered inline card on screen, not in voice mode. **An accept counts the tap, not the DOI.** The effective subscription is the server's `email_capture_marketing_opted_in {trigger:'signin_optin'}` → `email_capture_marketing_confirmed` (AD §5.7).

> **Dashboard and contract:** AD §5.7 counts this surface per **session** with its final state (accepted > declined > dismissed), so several tabs of one sid do not inflate it (and since `bc7fb5d` an accept is no longer followed by a dismiss). The opt-in server events carry `source:'mo_signin'`, `outcome`, `alreadyConfirmed`, `doiRequired`, and `email_capture_marketing_confirmed` carries `{source}`, so DOI completion is measured per surface (API_CONTRACT §5). „Nach Variante und Platzierung“ (AD §5.7) gets data from `bc7fb5d` on; sessions of older builds appear as „ohne (älteres Widget)“. The served `benefits` bullets the popup and card render (all or nothing): CONSENT_CONTRACT §3.1, `04`.

### 4.7 Email capture

| Event | `data` | Trigger | Function |
| --- | --- | --- | --- |
| `email_capture_declined` | `{ trigger }` when the card came from an `offer_email_summary` tool call that had a `trigger`, otherwise `{}` | "Nein danke, vielleicht später" (`CONSENT_COPY.decline`) on the capture card. Then the card collapses to a note. | `buildCaptureCard(opts)` |

- The widget never sends `email_capture_ask_shown`, `_submitted`, `_marketing_opted_in` or `_marketing_confirmed`; those are server-side (API_CONTRACT §5).
- API_CONTRACT §5 allows `askNumber` on this event. **The widget does not send it.**
- The header "Per E-Mail teilen" button (`openCaptureForm()`, also `window.MS_CHAT.openEmailSummary`) renders the same card **without** a tool call. The server therefore never sees an "ask shown" for it, its submits have no `trigger`, and its declines send `{}`. The same trigger-less card (`{message: CONSENT_COPY.intro, productIds: null}`) is opened by the signed-in opt-in fallback when `POST /api/account/marketing-opt-in` returns 422 / `no_verified_email` (`presentConsentGate()` directly, unless the shopper closed the popup meanwhile; `buildMarketingOptInCard()` via its "noEmailBtn"). Its submits and declines also carry no `trigger`.
- The capture submit sends `sessionId: sid` in the body (so does the contact form, §4.10).
- **One offer can be declined (and counted) several times.** Cards are rebuilt from stored history on every page load and every full re-render (`renderAllMessages()` → `renderRestoredAssistant()` → `renderPartIntoCtx()` → `buildToolCard('offer_email_summary')`). The decline in `buildCaptureCard()` only swaps the card's DOM (`body.replaceChildren`) and is never stored, so the same stored offer shows a live „Nein danke, vielleicht später“ button again after each navigation, and each click sends another `email_capture_declined` with the same `trigger`. Declines can therefore exceed asks per session: count distinct sessions or dedupe per `trigger`.
- `buildToolCard()` suppresses the `offer_email_summary` card when `auth.signedIn` is set at render time. For a signed-in customer the server's `email_capture_ask_shown` still counts, but no card was visible.

> **Dashboard and backend:** the „E-Mail-Capture-Funnel“ (AD §5.8) counts the capture form only (server `source:'mo_capture_form'`; the sign-in opt-in is not mixed in), counts `email_capture_declined` once per session and `trigger`, bounds the triggers (unknown → „Anderer Wert“), and divides DOI confirmations by opt-ins whose `outcome` was `doi_required`. `/api/capture-email` stores the `trigger` echo only when it is one of the tool's five values. The backend does not offer the summary to a live signed-in session (`src/app/api/chat/route.ts`; it keeps the offer when its sign-in lookup fails, ACCOUNT_CONTRACT §6.0), so a signed-in customer meets the card mainly through restored parts.

### 4.8 Account and self-service (signed-in only)

| Event | `data` | Trigger | Function |
| --- | --- | --- | --- |
| `account_history_opened` | `{}` | History drawer opened. **Also fires automatically** when a signed-in customer opens the panel onto an empty conversation (`maybeAutoOpenHistory()`), so it is not a pure intent signal. | `openHistory()` |
| `account_new_consultation` | `{}` | Drawer "Neue Beratung" (keeps the sid, mints a fresh `conversationKey`). | `buildHistoryDrawer()` |
| `conversation_opened` | `{}` | A past conversation was fetched and loaded (`GET /api/account/conversations/{id}` succeeded). | `openConversation(id)` |
| `conversation_renamed` | `{}` | `PATCH` returned `{ok:true}`. | rename handler in the drawer |
| `conversation_deleted` | `{}` | `DELETE` returned `{deleted:true}`. | `startDelete()` |
| `account_export_started` | `{}` | "Meine Daten herunterladen" click. | `buildExportControl()` |
| `account_exported` | `{}` | The JSON file was handed to the browser (`motionsports-meine-daten.json`). | `buildExportControl()` |
| `summary_download_started` | `{}` | PDF summary download button (needs `auth.signedIn` and an active `conversationKey`). | `downloadSummary()` |
| `summary_downloaded` | `{}` | The PDF blob was saved (`motionsports-zusammenfassung.pdf`). | `downloadSummary()` |

There is no widget event for erase (server `account_erased`), for the header "Neuen Chat starten" or for the view-mode toggle.

### 4.9 Voice

| Event | `data` | Trigger | Function |
| --- | --- | --- | --- |
| `voice_mode_on` | `{}` | Waveform button "Sprachmodus" turned on. | `enableVoiceMode()` |
| `voice_mode_off` | `{}` | Turned off by the user (toggle), **or automatically**: panel closed (`closePanel()`), tab hidden (`visibilitychange`), microphone blocked (`recognition.onerror` with `not-allowed` / `service-not-allowed`). A text send does **not** end voice mode. | `disableVoiceMode()` |
| `voice_reply_played` | `{}` | First audible playback of a reply. There are four call sites: single-shot `/api/tts` blob play resolved, the legacy no-promise `play()`, the `speechSynthesis` `onstart`, and the first streamed clip (`streamTtsPump`, `s.tracked` guard). | `playBlob()`, `speakViaSynthesis()`, `streamTtsPump()` |

Probable double count: when streaming TTS fails **after** its first clip played, `streamTtsFallback()` → `streamTtsDoFallback()` (immediately if the chat stream is done, else from `voiceAfterReply()`) → `speakReply()` hands the rest to the single-shot path, whose playback fires `voice_reply_played` again for the same reply. Treat the count as "≥ replies played".

### 4.10 Feedback, contact, errors: nothing from the widget

- **Feedback** (`openFeedbackCard()` → `POST /api/feedback`, API_CONTRACT §9): no KPI event. The feedback row itself, with `sessionId` in the payload, is the record.
- **Contact form** (`buildContactForm()` → `POST /api/contact`): no widget event. The server writes `contact_form_submitted {reason, productCount}` and keys it on the body's `sessionId`, else the `x-ms-session` header (`src/app/api/contact/route.ts`, API_CONTRACT §5). This build sends `sessionId: sid` (the current sid at submit time) in the body next to the header, so the row is **session-keyed** and joins the chat session. Rows from before 2026-10-04 (older widgets, before the header fallback) have session `NULL` and cannot be joined.
- **Contact reasons** (`REASON_LABELS`, chosen by the tool input `reason`, unknown values fall back to `general`): there is an `order_support` reason with the title „Kontakt zum motion sports Team“ / "Contact the motion sports team", the subline „Bestellstatus, Retoure/Rückgabe, Stornierung oder Reklamation — das Team kümmert sich.“ / "Order status, return, cancellation or complaint — the team will take care of it." and the message placeholder „Bestellnummer + kurz dein Anliegen…“ / "Order number + briefly your request…". Organisation stays optional (only `studio_consultation` and `public_sector_quote` require it). `reason` is part of the POST body; the KPI row stores it when it is a known reason, else `other` (API_CONTRACT §5).
- **Errors:** none. No event for `/api/chat` 4xx/5xx/403/429, `payload_too_large`, hydration failures (product card renders nothing), TTS fallback, sign-in redeem failures beyond `account_signin_return`, or attribution failures.

### 4.11 Retired

`starter_shown`, `starter_clicked` (starter prompts removed 2026-10-01). The backend shows them as „eingestellt“ (`kpi-widget-events.mjs → DISCONTINUED_WIDGET_EVENTS`). Some comments in the widget still mention "category starters" (e.g. above `trailCategoryStreak()`); those comments are stale.

---

## 5. Events the widget must never send (server-only)

The list — emitters, `data` keys and session keying — is the contract: API_CONTRACT §5 „Email-capture funnel events“ (the four server-side capture names) and „Server-emitted lifecycle events“; in code `SERVER_ONLY_EVENTS` (`src/lib/kpi-widget-events.mjs`). `POST /api/kpi` answers such a name `202` and does not store it, so a widget that sent one would lose the event, not double-count it; never send them (API_CONTRACT §0 rule 14). This build sends none (all 35 `track()` names are in §4).

The widget sends `account_export_started` / `account_exported` (UI) in addition to the server's `account_export_requested` (volume). These are different names and do not collide.

---

## 6. Engagement mechanic: launcher attention bounce

`ms-chat-widget.js → playLauncherAttention()`, CSS `.ms-chat-launcher--attn` / `@keyframes ms-chat-attn`.

| Rule | Value |
| --- | --- |
| When | Called once from `init()`. Actual start after `setTimeout(1400 ms)`. |
| Frequency | Once per **tab session**. `sessionStorage['ms-chat-attn-played']` is set at init, **even when skipped**, so it never replays in that tab. |
| Skipped | `prefers-reduced-motion: reduce` (JS skip and CSS freeze). Panel already open at 1.4 s (e.g. deep link, auth return). |
| Motion | One 1.1 s bounce: translateY −8 px / scale 1.06, then −4 px / 1.03, back to rest. The class is removed on `animationend`. |
| KPI | `launcher_attention_played {}` at start. |
| Caveat | The launcher is hidden while a theme drawer locks scroll (`body.no-scroll .ms-chat-launcher`). The bounce and its event still fire in that state, invisibly. |

---

## 7. Engagement mechanic: contextual proactive nudge

`ms-chat-widget.js → initNudgeTriggers()`, `nudgeEligible()`, `nudgeCopy()`, `showNudge()`, `removeNudge()`. CSS `.ms-chat-nudge*`. Rules: API_CONTRACT §0 rule 22 (tone, no e-mail ask).

### 7.1 Eligibility (checked at arm time and again at show time)

`nudgeEligible()` = panel closed ∧ `localStorage['ms-chat-nudge-dismissed'] !== '1'` ∧ no `sessionStorage['ms-chat-nudge-shown']` ∧ no `sessionStorage['ms-chat-opened']` (set by every `openPanel()`).

If the visitor is not eligible at `init()`, no triggers are armed for that page.

### 7.2 Triggers (first one wins, then all listeners are removed)

| Trigger (`data.trigger`) | Pages | Rule |
| --- | --- | --- |
| `dwell` | product **and** collection | `setTimeout(24000)` from `init()` (`NUDGE_DWELL_MS`). Wall-clock: it keeps running while the tab is in the background. |
| `scroll` | product only | Passive `scroll` listener: `(pageYOffset + innerHeight) / max(scrollHeight) ≥ 0.85`. Never fires when the page is not taller than the viewport. |
| `exit` | all page types | **Desktop only** (`isDesktop()` = `(min-width: 641px)`). `document` `mouseout` with no `relatedTarget` and `clientY ≤ 16` (pointer leaving toward the tab/URL bar). |

Consequences:
- Home, content and search pages ("other"/"home") can only nudge through desktop exit intent. **On mobile, they never nudge.**
- Mobile nudges exist only on product (dwell or scroll) and collection (dwell) pages.
- **There is no copy-selection trigger** and no idle or inactivity trigger in the code. Any such rule in planning docs is not implemented.

### 7.3 Copy (priority order, `nudgeCopy()`)

| Condition | German copy (verbatim) | `contextual` |
| --- | --- | --- |
| Product page with title | „Fragen zum Produkt „<Titel>“? Ich helf dir gern weiter.“ | true |
| Collection page with title | „Unsicher, was aus „<Kollektion>“ zu dir passt? Lass es uns klären.“ | true |
| Trail has ≥ 2 products of one `productType` (`trailCategoryStreak()`) | „Du schaust dir ein paar Produkte aus „<Kategorie>“ an — soll ich beim Vergleich helfen?“ | true |
| Otherwise | „Hi, ich bin Mo! Wenn du Fragen hast, helfe ich dir gern bei der Auswahl.“ | false |

English variants exist (`L()`). The nudge never asks for an email. **Tone-rule inconsistency:** the code comments and API_CONTRACT §0 rule 22 require copy to reference the page or category, "never the user's behavior". The streak variant („Du schaust dir … an“) does describe behaviour. A frontend agent or the owner should decide whether to reword it.

### 7.4 Presentation and lifetime

- A small speech bubble fixed above the launcher (right 20 px, bottom 96 px + safe area), z-index just below the panel. The whole text is one button. A separate × button ("Hinweis schließen").
- **It never auto-hides.** It stays until clicked, dismissed, the panel opens (`openPanel()` → `removeNudge()`), or the page navigates. It is not shown again in that tab session (the shown flag is set at show time).
- Hidden while `body.no-scroll` (theme drawers). `nudge_shown` still fires if the trigger hits while a drawer is open.

### 7.5 Click → context greeting

On click: `nudge_clicked` → `removeNudge()` → `openPanel()` (`chat_opened`). If the conversation was empty **before** opening and the widget is not streaming or rate-locked:
- Product page: `context = { type:'product', productId: <handle || numeric id>, productTitle?, recentlyViewed?, source:'nudge' }`.
- Other pages: `browsingContext(null)` = `{ type:'browsing', recentlyViewed:[…], source:'nudge' }` from the trail (≤ 3 products + ≤ 2 categories), or **nothing** when the trail is empty.
- With a context, `sendContextGreeting(ctx)` → `POST /api/chat` with `messages: []` and the context. The backend streams a greeting (API_CONTRACT §2). No `message_sent`, and no sign-in/consent popup is triggered by this turn. A pending campaign token rides along (§9).
- Without context (e.g. generic home nudge, empty trail), the panel simply opens on the welcome state.

---

## 8. Engagement mechanic: product-page CTA

Placement, markup contract, gating, click behaviour and template coverage are owned by `06-commerce-and-storefront-integration.md` §3 (§3.1 placement, §3.4 gating and the CTA-hiding style, §3.5 click behaviour); template coverage is `01` §6.6. This section keeps the KPI side.

### 8.1 Where it is rendered

Every product template of this build carries the CTA (`01` §6.6). Which product uses which template is set per product in Shopify admin, and the blocks are live-editor owned, so the share of PDPs with a CTA cannot be read from the repo (`07` §8).

### 8.2 Behaviour

- `openWithProduct(id, title)`: `openPanel()` (`chat_opened` if it was closed) → `product_cta_opened {productId: <numeric Shopify id>}` — also when the widget is busy and no message is sent.
- Otherwise it sends a visible primer user message (`message_sent`, context with `source:'cta'`, `06` §3.5), so the first-message popup (sign-in or consent, §4.5 / §4.6) can follow ~0.7 s later. It appends to existing history; every click sends another primer.
- Where the widget does not mount, the snippet hides the CTA; a click before the deferred script has booted, or with the JS failing to load, does nothing and sends nothing (`06` §3.4).

Funnel available today: `product_cta_opened` → `message_sent` (same session, immediately) → server tool calls → `product_cta_clicked` / `add_to_cart_clicked`.

---

## 9. Engagement mechanic: campaign deep link and campaign token

Campaign e-mails link through `GET /api/r/<token>` (API_CONTRACT §11.2). For a Mo CTA, this redirects to `CAMPAIGN_MO_DEEPLINK_URL` with `mo_c=<token>` appended.

### 9.1 Order of processing on page load

1. `layout/theme.liquid` `<head>` inline script (only if `ai_advisor_enabled`, **before** `content_for_header`): moves `ms_auth`, `ms_code`, `mo_c` off the URL into `sessionStorage['ms-chat-early-params'] = {at, …}` and calls `replaceState`. Shopify analytics and web pixels therefore never see the token in a page URL. The script runs on every page while `ai_advisor_enabled` is on, including `/cart` and excluded templates (`ai_advisor_excluded_templates`) where no widget loads; there the token waits in the stash and is used only if a widget page loads in the same tab within 10 minutes (`earlyParam()` / `LINK_RETRY_MAX_MS`; the stash is deleted on first read, and any later `ms_auth` / `ms_code` / `mo_c` landing replaces it). Otherwise the campaign chat is not counted, so campaign deep links should target a widget page, not `/cart`.
2. `init()` → `captureCampaignToken()` first. It reads the stash (`earlyParam('mo_c')`, stash valid < 10 min, deleted on read) or the URL. It validates `/^[A-Za-z0-9_-]{16,64}$/` and stores `sessionStorage['ms_mo_c']`, then strips `mo_c` from the URL. A malformed value is dropped (still stripped).
3. … widget build, trail, nudge, bounce, attribution, auth return …
4. `handleMoDeepLink()` **last**: acts only if `?mo=open` or `#mo-open`.

### 9.2 Deep-link parameters

| Param | Effect |
| --- | --- |
| `mo=open` or hash `#mo-open` | Auto-open the panel on the fully initialised widget (`openPanel()` → `chat_opened`). Nothing is sent and the greeting is not changed. It behaves exactly like a launcher click. |
| `mo_new=1` (only with `mo=open`) | Fresh consultation. With a signed-in hint (`shouldProbeAuth()`: `localStorage['ms-chat-signed-in'] === '1'` or shop login via `ShopifyAnalytics.meta.page.customerId`): keep the sid, drop the local thread and conversation key (the first turn mints a new `conversationKey`). Without one: `rotateSession()`, as with "Neuen Chat starten". |
| `mo_view=fullscreen` (only with `mo=open`) | Open in the desktop modal view (`state.viewMode='modal'`), **not** persisted to `ms-chat-view-mode`. Mobile is always fullscreen. |
| `utm_*` | Untouched (shop analytics). |

`mo`, `mo_new`, `mo_view` and the hash are stripped with `replaceState`, so a reload or a copied URL does not re-open.

**What campaign mails actually land on.** Campaign mails with `cta_kind = mo_chat` link to `CAMPAIGN_MO_DEEPLINK_URL`, by default `https://motionsports.de/?mo=open&mo_new=1&mo_view=fullscreen&utm_source=campaign&utm_medium=email`, plus `&mo_c=<token>` appended by `/api/r/<token>` (backend `docs/CAMPAIGNS.md`: CMP §4 "Draft generation", step 5 "Call to action", and CMP §5 "Chat-Start"; API_CONTRACT §11.2). In the widget this means:

- (a) The landing page is **home** (`PAGE_CTX.type 'home'`): no product context. Because the deep link opens the panel (`openPanel()` sets `sessionStorage['ms-chat-opened']`), no nudge can appear for the rest of that tab session on any device or page type (`nudgeEligible()` and `showNudge()` check that key). The launcher bounce is skipped on the landing page too: its 1.4 s timer finds the panel open, and `ms-chat-attn-played` is already consumed. Campaign landings therefore produce no `nudge_shown` and no `launcher_attention_played` in that tab.
- (b) `mo_new=1` **rotates the sid for every visitor without a signed-in hint** (but see the card-build race in `06` §8.7: a rotated sid can be marked consulted and stamped by the deleted thread's product cards) (`!shouldProbeAuth()` → `rotateSession()`). Signed-in hint = `localStorage['ms-chat-signed-in'] === '1'` **or** the visitor is logged into the shop (`ShopifyAnalytics.meta.page.customerId`, `storefrontCustomerHint()`). For a rotating visitor, KPI events before and after the click land on different sessions, the device's previous anonymous thread is deleted, and the `_mo` token is reset (`moAttrReset()`). A visitor with a signed-in hint keeps the sid but loses the local thread (`lsDel(historyKey())`, `clearConvKey()`); this includes a shop-logged-in visitor who never signed into the chat (no rotation, the `_mo` token is kept). Only visitors with neither signal rotate.
- (c) Desktop opens in the modal view (not persisted). Mobile is fullscreen anyway.
- (d) `mo`, `mo_new`, `mo_view` and `utm_*` are still in the URL when `content_for_header` (Shopify analytics, web pixels) runs; the deferred `init()` strips the `mo*` params only later. `mo_c` never reaches it (the head script removes it first, §9.1).
- (e) A PDP URL with `?mo=open` opens Mo on that product page without priming it; the product reaches the backend with the shopper's first typed or spoken question there (`source:'page'`) or a PDP CTA click (`02` §3.2).

When planning campaign KPIs or a new landing parameter, decide whether `mo_new=1` should stay in the default.

### 9.3 What counts as a "campaign chat"

- `startStream()` reads `sessionStorage['ms_mo_c']` on **every** `/api/chat` request (typed message, product-CTA primer, nudge greeting) and adds it as `campaignToken` while a valid token is stored. In practice that is the next request after the token was captured, not necessarily the first of the tab session: `captureCampaignToken()` can store a token on any later page load of a tab that already chatted. It is deleted once a response is `ok`. A failed request keeps it for the next turn.
- The server records `campaign_chat_started {sendId, campaignId}` **once per send**, session `NULL` (API_CONTRACT §2, §5).
- Consequences:
  - A campaign click that opens the chat but where the visitor never sends anything does **not** count. No widget event marks the deep-link open either (§13).
  - The token survives same-tab navigation (sessionStorage). A chat started later on another page in the same tab still counts. Closing the tab loses it.
  - Since the event is session-less **by design**, campaign chats cannot be joined to product clicks or `_mo` orders of that session. Campaign revenue comes from `MK-` codes and the campaign funnel (AD §5.9).
- The token is never placed in KPI payloads, localStorage, cookies or logs.

---

## 10. Order attribution: the `_mo` cart stamp

The mechanics are owned by `06-commerce-and-storefront-integration.md` §8 (consent gate, mint, stamp, when stamps happen, reset, privacy, coverage gaps, renewal §8.8, blanking §8.9); the contract is API_CONTRACT §10, the backend design `docs/ORDER_ATTRIBUTION.md`, the dashboard AD §5.16. The stamp shipped in the 2026-08-12 widget session (`e4b12f1`) and was not affected by the Aug 12 drift. This section keeps what matters for KPI work.

### 10.1 Invariants

`06` §8.1–§8.3. For KPIs: "consulted" (a session may mint) is set by a rendered `show_product` card, including one restored from history on a plain page load, so it is **not an interaction signal** (§14.5).

### 10.2 When it fires

`06` §8.4 (table, and the mint without a click from restored history).

### 10.3 Coverage gaps worth knowing

All in `06` §8.7 (with findings F1, F2, F7, F8 in `06` §16). The ones that bias attribution KPIs:
- the „Zur Kasse“ permalink probably does not carry `_mo` (unverified; one test order, §14.1, `07` P0.2);
- only `show_product` marks a session as consulted (compare / showroom / add-to-cart cards do not);
- card builds and in-flight mints are not cancelled on a sid rotation, so a rotated sid can be stamped by the old thread's cards;
- the theme's own add-to-cart is not observed; visitors without analytics consent are never stamped, and no event measures that coverage;
- a dead token is replaced only on a page view with a live consultation turn (§10.4); a device that only reloads its restored history keeps stamping it until the sid rotates (orders then count as `unknown_token`, AD §5.16 „Ohne Zuordnung“).

### 10.4 Renewal and blanking (since `bc7fb5d`)

Mechanics: `06` §8.8 (renewal) and §8.9 (blanking). What they mean for the numbers:
- **Renewal**: after a cleanly finished streamed turn with a `show_product`, `compare_products`, `add_to_cart` or `suggest_showroom` part, a device with a cached token and analytics consent asks `POST /api/attribution/token` again, once per page view. A token the backend purged or erased is replaced and stamped, so `unknown_token` among the marked orders should fall from 2026-10-06 (AD §5.16, `npm run verify:live` section 7b; release note „Bestell-Zuordnung: Markierung wird nach einer Beratung erneuert“). No KPI event marks a renewal.
- **Blanking**: sign-out, erase (also after a 401 on erase), a server-ended sign-in and a consent withdrawal reported by `visitorConsentCollected` set every cached `cartAttributes` key to `""` on the live cart. Orders placed afterwards on that cart carry no marker of the ended session; an anonymous „Neuen Chat starten“ or a `mo_new=1` rotation still leaves the old marker in place (`06` §16 F8). No KPI event marks a blank either.

---

## 11. Cart UI refresh after quick checkout

Owned by `06-commerce-and-storefront-integration.md` §7.2–§7.3 (triggers, single-flight `/cart.js` read, badge and drawer refresh, the header script's own reads). For KPIs: it is display-only and sends **no KPI event**; it costs one same-origin `/cart.js` GET on every page view where the widget mounts, plus one per focus / visibility return, even for visitors who never use Mo.

---

## 12. How the admin KPI tab reads these events

The definitions are owned by AD §5 (the section per figure is named below); this table adds how well the widget's events fit them. The click patterns (`CTA_PATTERNS`, `CART_PATTERNS`) are defined once in `src/lib/kpi-event-patterns.mjs` and used by the KPI tab (`src/lib/kpi-store.ts`), the Gespräche inspector (`src/lib/admin-conversations.ts`) and the Komplettanalyse (`src/lib/analytics-report-store.ts`). Releases that change what a number means are listed under the toolbar (AD §5.0, `src/lib/kpi-releases.mjs`). Live checks: `npm run verify:widget`, `npm run verify:live` (`docs/ROLLOUT_TODO.md` 1.11).

| Dashboard figure | Reads | Fit with the widget (build `bc7fb5d`) |
| --- | --- | --- |
| **Produkt-/CTA-Klicks** (AD §5.1) | `event ILIKE '%product%click%' OR '%cta%click%'` | Matches `product_cta_clicked` only. It does **not** match `product_cta_opened` (storefront CTA), `showroom_clicked` or `nudge_clicked`, which is correct. |
| **Add-to-Cart-Klicks** (AD §5.1) | `event ILIKE '%cart%' OR '%checkout%'` | Matches `add_to_cart_clicked` only. Any future event name containing "cart" or "checkout" (e.g. `cart_refreshed`, `storefront_add_to_cart`) **will be counted here**. It also marks the session as "carted" in the Gespräche inspector (`admin-conversations.ts → loadSessionSignals()`, `cartUsed`) and in the Komplettanalyse (`analytics-report-store.ts`), which use the same `CART_PATTERNS`. Name new events with this pattern in mind or adjust the pattern in `kpi-event-patterns.mjs`. |
| **Geöffnet → geschrieben** (AD §5.1) | sessions with `message_sent` ÷ sessions with `chat_opened` (capped at 100 %) | `chat_opened` fires on every open from any source (launcher, nudge, product CTA) and also without a click (campaign deep link, auth-return re-open, external `openEmailSummary()`), §4.1. `message_sent` includes the product-CTA primer and voice turns and is sent before the request, so failed turns count (§4.3). Greeting-only conversation rows (§14.3) are not in it. |
| **Reichweite (Sitzungen)** (AD §5.1) | `count(DISTINCT session_id)` in `kpi_events` | Includes sessions that never opened the chat: `launcher_attention_played` and `nudge_shown` fire without an open, and session-keyed server events count too. A reach figure, not a denominator. |
| **Chats gesamt** (AD §5.1) | `count(conversations)` | Includes greeting-only threads from a nudge click with context (`message_count` 1, §14.3). For "the visitor wrote" use `message_sent`. |
| **Seitenkontext auf Produktseiten** (AD §5.1a) | server `page_context_applied` / `page_context_answered` per session, joined to widget `product_cta_clicked` (`samePage` not `true` = „andere Produkte“), `add_to_cart_clicked`, `product_cta_opened` / `nudge_clicked` (primed before the first question) and `mo_orders` | Gets data from `bc7fb5d` on: the first typed or spoken message per product page carries `context.source:"page"` (`02` §3.2), and every product click carries `samePage` (§4.4). The server records `page_context_applied` for such a turn whether or not `CHAT_PAGE_CONTEXT_ENABLED` is on (`planPageContext()` in `src/lib/page-context.mjs`; switched off = `applied:false`, `pct:100`, shown as „Seitenkontext aus“), so coverage is measured before Mo uses the page. Earlier periods stay empty. |
| **Anmelde-Popup** (AD §5.7a) | `login_gate_*`, `account_signin_started.source`, server `account_signin_succeeded` / `account_signin_linked {kind:"customer_account"}` per session | Matches the widget. The source split is only `login_gate` vs `other` (§13). The per-session diagnosis applies §12.1. |
| **Einwilligung nach der Anmeldung** (AD §5.7) | `consent_gate_*` with `data.surface`, per session with the final state (accepted > declined > dismissed); blocks „Nach Anmeldeweg“ and „Nach Variante und Platzierung“ | Matches. It counts taps, not DOI. „Nach Variante und Platzierung“ gets data from `bc7fb5d` on (`placement` `popup` / `signin_return`, `variant` when served; never `value_moment`, §4.6); older sessions fall under „ohne (älteres Widget)“. |
| **E-Mail-Capture-Funnel** (AD §5.8) | server events (capture form only, `source:'mo_capture_form'`) + widget `email_capture_declined` once per session and `trigger` | Declines from the header share card have no `trigger`. One stored offer can be declined again on every later page (the card is rebuilt from history, the decline is not stored, §4.7). For signed-in customers the card is hidden (`buildToolCard()`), so a server `ask_shown` may have had no visible card. |
| **Kundenkonto & Self-Service** (AD §5.15) | server events, incl. „Shop-Login-Erkennung“ from `account_shop_recognised` | `contact_form_submitted` is session-keyed (body `sessionId`, else the header, §4.10); rows from before 2026-10-04 have session `NULL`. |
| **Bestellstatus im Chat** (AD §5.15a) | server `order_status_lookup` | The widget renders nothing for `get_order_status`. Empty while `CHAT_ORDER_STATUS_ENABLED` is off (default off in code), except for the accounts in `CHAT_ORDER_STATUS_TEST_CUSTOMERS`. |
| **Mo-zugeordneter Umsatz** (AD §5.16) | `mo_orders` from the order webhooks (`_mo` attribute, codes); `mo_order_marker_unresolved` | Depends on the stamp's coverage, including the permalink question (`06` §8.7). From `bc7fb5d` the renewal replaces purged tokens after a live consultation, so „unbekannte Markierung“ should fall (§10.4). |
| Raw event breakdown (AD §5.1) | top 20 events by count | `launcher_attention_played` and `chat_opened`/`chat_closed` will dominate. Rarer events (e.g. `summary_downloaded`) can fall off the top 20. Retired `starter_*` carry „eingestellt“ (§4.11). |

### 12.1 Debugging the sign-in funnel

The admin "Anmelde-Popup" funnel (AD §5.7a) joins widget and server events per `sessionId`. Use this table to explain a drop between steps. Widget behaviour is from `ms-chat-widget.js → presentLoginGate()`, `initiateLogin()`, `handleAuthReturn()`, `redeemLinkCode()`, `retryPendingLink()`, `earlyParam()`; backend events per API_CONTRACT §5 "Sign-in popup events" and ACCOUNT_CONTRACT §2/§2a. Details of the round trip: chapter 04 §4 and §9.

Expected sequence (same `sessionId`): `login_gate_shown` → `login_gate_signin_clicked` → `account_signin_started {source:'login_gate'}` → server `account_signin_succeeded` (callback) → widget `account_signin_return {result:'ok'}` + server `account_signin_linked` (code redeemed).

| # | Signature of the break | Cause |
| --- | --- | --- |
| 1 | `_signin_clicked`, then `login_gate_dismissed`, no `account_signin_started{source:'login_gate'}` | The reply was still streaming ("Antwort wird noch geladen…"), and the visitor pressed Esc or the backdrop during the wait. That clears `waitTimer`, so `initiateLogin()` never runs. (A hung stream does not block: the redirect happens after 20 s anyway.) |
| 2 | `_signin_clicked`, no `account_signin_started`, no `login_gate_dismissed` | `account_signin_started` was lost on navigation (keepalive + CORS preflight during unload, §2.2, §14.2), or the redirect threw (`initiateLogin()` catch logs `[ms-chat] sign-in redirect failed` to the console only). |
| 3 | `account_signin_started`, no server `account_signin_succeeded` | Abandoned at the Shopify login, or the backend refused the `return_url` origin (not allow-listed, e.g. a theme preview or `*.myshopify.com` domain; ACCOUNT_CONTRACT §2). |
| 4a | `succeeded`, then `account_signin_return{ok}`, but **no** `_linked` / `_link_refused`, and the chat stays anonymous | The return page ran a widget **older than PR #73**: it sends `return{ok}` on the marker alone and never redeems `ms_code`, and the backend requires the redeem (since 2026-10-03), so the session is not signed in. For 2026-10-03/04 that was the uploaded build (AD §5.0 release notes); later it points to a live-editor revert or a stale cached asset (`07` §6.4). |
| 4b | `succeeded`, no `account_signin_return`, no `_linked` / `_link_refused` | The widget did not mount on the `return_url` page (excluded template, empty secret, script error), or the head-script stash was older than 10 min (`LINK_RETRY_MAX_MS`) when the next mounting page loaded. The head stash script in `layout/theme.liquid` is gated only on `ai_advisor_enabled`, so a non-mounting return page keeps the code in `sessionStorage['ms-chat-early-params']` for the next mounting page, or loses it. |
| 5 | `account_signin_return{link_failed}` **without** server `_link_refused` | The widget never called `/api/auth/link`: login-sid mismatch (`sessionStorage['ms-chat-login-sid'] !== sid`, e.g. another tab rotated the sid; `handleAuthReturn()` resolves `'refused'` locally), missing `ms_code` (`redeemLinkCode()` returns `'refused'` without a request), or localStorage unavailable (a new `sid` on every page load, so the return mismatches every time). |
| 6 | `link_failed` + server `_link_refused` | Backend 400 on `/api/auth/link`: code expired, already used, or `session_mismatch` (e.g. the login finished on another device). |
| 7 | `link_failed`, then a later `_linked` with no `return{ok}` | Backend 503/429/5xx or a network error on the redeem (`redeemLinkCode()` → `'unavailable'`): the code is kept in `sessionStorage['ms-chat-link-retry']` and `retryPendingLink()` redeems it silently **once**, on the next page load in the same tab (without an `?ms_auth` marker), only if the sid is unchanged and the code is under 10 min old (`LINK_RETRY_MAX_MS`). No second `account_signin_return` is sent. (The whoami shop-recognition path keeps its code the same way, with `kind:'shop'`.) |
| 8 | `return{ok}` + `_linked`, but the UI stays anonymous | A transient `/api/auth/me` failure after the redeem (04 §18 items 3–4). |
| 9 | `account_signin_started` (and possibly `succeeded`), then `account_signin_return{error}` or `{login_required}`, no link | Shopify or the callback reported an error; `login_required` only comes from `prompt=none`, which this widget never starts (§4.5). |
| 10 | server `account_signin_linked {kind:"app_proxy"}` without a sign-in round trip (no `account_signin_started` / `_succeeded`) | Not a break: the shop login was recognised through the App Proxy (whoami) and the widget redeemed the code (04 §5). A new sign-in of the session, or — when every App Proxy link of the session was `renewed:true` — a new tab confirming an existing one. |
| 11 | server `account_shop_recognised {codeIssued:true}`, no `account_signin_linked` | whoami issued a code but the widget did not redeem it: a build without code redemption (drift, 04 §5.4), a sid rotated while the whoami request ran (04 §5.3), or a failed redeem (refused, or unavailable without a later retry). |

The dashboard's per-session diagnosis (`classifySigninSession` in `src/lib/kpi-widget-events.mjs`, labels in AD §5.7a) maps the rows to keys: 1 `dismissed_while_waiting`, 2 `start_lost`, 3 `abandoned`, 4a `stale_widget`, 4b `no_return`, 5 `link_failed_local` (also a 503 at the redeem that was not retried), 6 `refused_mismatch` / `refused_invalid`, 7 `complete_retry`, 9 `returned_error`, 10 `shop_recognised` / `shop_renewed`, 11 `shop_not_redeemed` (checked last, so any chat sign-in outcome of the session wins); the expected sequence, and row 8, are `complete`. Sessions the shop only recognised without issuing a code are not in the diagnosis (AD §5.15).

Note: `account_signin_return` and `_linked` are keyed by the sid **at return time**. In case 5 (localStorage unavailable) the events before and after the redirect therefore land on different sessions, and the funnel shows a drop that is really a split.

---

## 13. Measurement gaps and KPI opportunities

### 13.1 What is NOT measured today (concrete)

| Gap | Why it matters | Where a fix would go (frontend) |
| --- | --- | --- |
| **Widget load / launcher impression** (no event per page or per tab session, except the motion-dependent bounce) | No denominator for "open rate per visitor". Reach is unknown on reduced-motion devices. | `init()` |
| **Source of `chat_opened`** (launcher, nudge, product CTA, deep link, auth return, external `openEmailSummary()`) | Cannot rank entry points by open → message → click. | `openPanel(source)` with a `source` enum |
| **Deep-link open** (`mo=open`, with or without a campaign token, `mo_new`, `mo_view`) | Campaign landing → open → first message cannot be computed. Only the server's `campaign_chat_started` (after a message) exists. | `handleMoDeepLink()` |
| **Time to first message / time to first token / reply duration** | Latency affects drop-off and is invisible today. | `openPanel()` / `sendMessage()` / `startStream()` |
| **Product card impressions** (`show_product` rendered, compare table rendered, add-to-cart card rendered, showroom card rendered; or rendered **nothing** because hydration failed) | No CTR denominator on the client side. The server knows tool calls, but not which cards actually rendered. | `buildShowProduct()`, `buildCompare()`, `buildAddToCart()`, `buildShowroom()` |
| **Surface of `product_cta_clicked`** (card vs compare vs add-to-cart fallback) | Cannot tell which card format converts. | `productButton(product, label, surface)` |
| **Links inside assistant Markdown** (product or page URLs in text) | Clicks to the shop from text are invisible. | Markdown renderer link handler |
| **Scroll depth / read time in the chat panel; panel open duration** | `chat_closed` carries no duration. | `closePanel()` could add `openMs` |
| **Popup view time / time to decision** for the login gate and consent gate | Hard to tell whether the copy is being read. | `presentLoginGate()` / `presentConsentGate()` |
| **Sign-in source other than the popup** (welcome card, header, drawer "Mit Kundenkonto anmelden", link-failed notice; proposed values `welcome_card \| header \| account_menu \| link_failed`, §13.4) | All of them appear as `other`. Cannot compare entry points. | `initiateLogin(source)` callers + backend `signinSource()` |
| **Header "Neuen Chat starten"** and anonymous rotations | Session splits are invisible. | `startNewChat()` (send under the old sid **before** rotating) |
| **Header "Per E-Mail teilen" impression and source** | Capture asks from the header are invisible to the capture funnel. | `openCaptureForm()` |
| **Contact form shown / abandoned** (the submit itself is session-keyed, §4.10) | The submit now joins the session, but there is still no widget event for "form shown", so `show_contact_form` → submit needs the server's tool-call record as the denominator. | `buildContactForm()` |
| **Feedback card opened** (submit is stored server-side) | No open → submit rate. | `openFeedbackCard()` |
| **Errors** (chat 4xx/5xx/429/403, `payload_too_large`, stream abort, hydration miss, TTS fallback) | Outages and rate-limit pain show up only as fewer events. | `handleChatHttpError()`, `lockRateLimit()`, `hydrate()` |
| **Attribution coverage** (consent allowed? token minted? stamp succeeded?) | The share of consulted sessions that can be attributed at all is unknown. | `moAttrEnsure()` / `initAttribution()` (a boolean flag only) |
| **Storefront add-to-cart after a consultation** (theme `product:added-to-cart`) | The "Mo recommended, user added via the product page" path is visible only after purchase (webhook). | listener in `init()` |
| **Nudge suppressed reasons; nudge shown while hidden** (`body.no-scroll`) | Some impressions are counted although the nudge was invisible. | `showNudge()` |
| **`trigger` on `nudge_clicked` / `nudge_dismissed`** | The per-trigger CTR needs a join to `nudge_shown`. | `showNudge()` (the closure already has `trigger`) |
| **View-mode toggles, fullscreen use, mobile vs desktop** | No device split for any funnel. | add `device: 'mobile' \| 'desktop'` to selected events |
| **Returning visitor flag** | Retention cannot be computed reliably (a sid spans visits, events need interaction). | `chat_opened` could carry `returning: bool` (local history exists) |

### 13.2 Funnels that can already be computed (per `sessionId`)

| Funnel | Events | Caveat |
| --- | --- | --- |
| Nudge | `nudge_shown` (by `trigger`, `pageType`, `contextual`) → `nudge_clicked` / `nudge_dismissed` / ignored (= shown without either) → `message_sent` | Per-trigger click rate needs a join on session. Multiple tab sessions per sid. |
| Open → message | sessions with `chat_opened` → sessions with `message_sent` | No source, and auth-return re-opens inflate opens. Use `message_sent` (not `conversations` rows) for "visitor wrote": nudge greetings create conversation rows without a visitor message (§14.3). |
| Storefront CTA | `product_cta_opened` → `message_sent` → `product_cta_clicked` / `add_to_cart_clicked` | Numeric vs catalog ids. Template coverage grew with the upload of 2026-10-04 (three more templates, `01` §6.6): compare periods across that date with care. |
| Recommendation → click | server tool calls (`show_product`, `compare_products`, `add_to_cart`; `recommended_product_ids`) → `product_cta_clicked` / `add_to_cart_clicked` | Server tool calls ≠ rendered cards. |
| Click → order | `add_to_cart_clicked` / `product_cta_clicked` → `mo_orders` tier by session/token | Permalink and consent coverage (§10.3). |
| Sign-in popup | `login_gate_shown` → `_signin_clicked` → `account_signin_started{source}` → server `succeeded` → `linked`, plus `account_signin_return.result` | On the dashboard (AD §5.7a). Meaningful from 2026-10-04 (AD §5.0); between 2026-10-03 and the upload of that day sign-ins were not linked and the widget's `return{ok}` was inflated (§12.1 row 4a). |
| Consent gate | `consent_gate_shown` → `_accepted` / `_declined` / `_dismissed` → server `email_capture_marketing_opted_in{trigger:'signin_optin'}` → `_confirmed` | Accept = tap, not DOI. Needs signed-in sessions (meaningful from 2026-10-04, AD §5.0). On the dashboard per session and, from `bc7fb5d` on, per variant × placement (AD §5.7). |
| Page context (typed) | server `page_context_applied {kind, applied}` → `page_context_answered` → widget `product_cta_clicked {samePage}` / `add_to_cart_clicked` → `mo_orders` | From `bc7fb5d` on (AD §5.1a). An arm comparison needs a control group (`CHAT_PAGE_CONTEXT_HOLDOUT_PCT`) and a pre-registered experiment. |
| Email capture | server `email_capture_ask_shown{trigger, askNumber}` → widget `email_capture_declined` / server `_submitted` → `_marketing_opted_in` → `_confirmed` | Header-share captures sit outside the ask counts. `source` / `outcome` (from 2026-10-05, API_CONTRACT §5) split the opt-ins (new DOI / already subscribed / suppressed) and `_confirmed` carries `source`. |
| Campaign | server `campaign_email_clicked` → `campaign_chat_started` (both session-less, joined by `sendId`) | The open step is missing (no deep-link event). |
| Voice | `voice_mode_on` → `voice_reply_played` → `voice_mode_off` | Off includes automatic offs. Plays may double count. |
| Self-service | `account_export_started` → `account_exported`; `summary_download_started` → `summary_downloaded`; `account_history_opened` → `conversation_opened` | History opens include automatic opens. Signed-in only (meaningful from 2026-10-04, AD §5.0). |
| Contact form | server `show_contact_form` tool call → server `contact_form_submitted` (per `sessionId`) | Session-keyed from 2026-10-04 (§4.10). No widget event for "form shown". |

### 13.3 Legal and privacy constraints that apply to every idea below

- **No message text, no emails, no product names** in `track()` payloads (privacy posture in `ms-chat-widget.js`; API_CONTRACT §0 rules 13 and 19). Ids and enums only.
- **Tone rule** for proactive copy: reference the page or category, never the visitor's behaviour (API_CONTRACT §0 rule 22).
- **Marketing consent UI:** the legal text is backend-served and rendered verbatim (`consentTextShown` echoed byte-for-byte), shown only if `lawyerApproved === true`. Nothing is pre-ticked, decline is equally prominent, and the nudge never asks for an email (CONSENT_CONTRACT §1; API_CONTRACT §0 rules 8–10, 22). Any A/B variant needs its own approved copy. The consent popup's accept rate rests on `consent_gate_shown` as its denominator (a widget event, counted per session, AD §5.7), so the § 25 TDDDG question below applies to it too; per-session variant assignment (`CONSENT_SIGNIN_VARIANTS`) adds to that question (07 §8).
- **Attribution and analytics consent:** the `_mo` stamp requires `analyticsProcessingAllowed()`. Open legal question (not decided here): `track()` itself is not consent-gated, and the sid is written to localStorage on the first page load for every visitor (§3.1). Under § 25 TDDDG, storing/reading device data for non-essential analytics usually needs consent. More "silent" events (widget-load, impressions) increase that exposure. **Ask the lawyer before adding interaction-free events**, or gate them on the same `analyticsProcessingAllowed()` check.
- **Campaign token:** keep it out of KPI payloads, and keep `campaign_chat_started` session-less unless legal agrees otherwise.
- **Deployment:** every widget change needs a manual upload to the live theme, and template blocks can be overwritten by the live editor (chapter 01 §16). Plan for drift checks after each upload.

### 13.4 Ideas to raise each KPI

Consolidated — with priorities, effort (same S / M / L scale) and the backend part — in the backlog `07` §7, the one list. By KPI:

| KPI | Backlog items (`07` §7) |
| --- | --- |
| Opt-in rate (marketing consent) | B8 (`askNumber` on `email_capture_declined`), D6 (ask at a value moment), D7 (popup timing test); served bullets with `variant` / `placement` are done (OI3, `bc7fb5d`). DOI completion per surface is measured server-side (`source`, API_CONTRACT §5). |
| Sign-in rate | B2 (tag every sign-in start), D7 (popup timing), E9 (contextual sign-in card for order status); silent shop recognition: P0.3 (closed; setup state `docs/ROLLOUT_TODO.md` 5.4) |
| Product CTR | B3 (card impressions, `surface` on `product_cta_clicked`), B4 (Markdown shop links), C2 (larger hit area), E10 (same-tab product pages on mobile); page context on typed questions is done in the widget (A3, `bc7fb5d`); Mo uses it only with `CHAT_PAGE_CONTEXT_ENABLED` (default off in code) |
| Add-to-cart / checkout | D1 (in-chat add via `/cart/add.js`), D2 (theme `product:added-to-cart`), D9 (error telemetry) |
| Attributed revenue | A1 (consulted on every product card), A2 (`_mo` on the permalink, after P0.2), D2, D9 (coverage flag), D17 (stale card builds after a rotation); token renewal and blanking are done (A5, `bc7fb5d`) |
| Campaign chats | B5 (`deeplink_opened`), E1 (campaign-aware greeting), E11 (keep the token across a tab close) |
| Engagement and retention | B1 (`chat_opened {source, returning}`), D8 (mobile nudge, copy), E2 (`widget_loaded`) |

Every idea stays within §13.3.

---

## 14. Open questions / uncertainties

1. **Cart permalinks vs `_mo`:** does a Shopify cart permalink (`/cart/<variant>:<qty>`) keep the attributes stamped on the existing cart via `/cart/update.js`? The code does not tell. Shopify documents permalinks as building their own cart, so the attribute is probably lost for Mo's "Zur Kasse" checkouts. Verify with one test order in the admin (order `note_attributes`).
2. **keepalive + CORS preflight on navigation:** `account_signin_started` fires right before `location.assign()`. Whether every target browser completes a preflighted `keepalive` request during unload is not verifiable from the code. Compare `login_gate_signin_clicked` vs `account_signin_started{source:'login_gate'}` vs `account_signin_succeeded` counts per session to detect loss.
3. **Greeting-only turns (resolved):** yes, they count as chats. A greeting-only turn (`messages: []`, nudge click with context) skips the eager `ensureConversationStarted` (user turn required) but is persisted by `persistTurn()` in `/api/chat` `onFinish` (`src/lib/conversation-store.ts`: `INSERT INTO conversations … ON CONFLICT (conversation_key) DO UPDATE`, no user-message guard, `messageCount = history.length + 1` = 1). It is counted in „Chats gesamt“ although the visitor sent nothing (AD §5.1 says so); „Geöffnet → geschrieben“ uses `message_sent` and is not affected.
4. **`voice_reply_played` double count** on mid-reply streaming-TTS fallback is inferred from the control flow (`streamTtsFallback()` → `streamTtsDoFallback()`, immediately if the chat stream is done, else from `voiceAfterReply()` → `speakReply()`), not observed.
5. **"Consulted" ≠ interacted:** `moAttrConsulted` (and any idea in §13.4 keyed on it) is also set by product cards re-rendered from stored history on a plain page load (`06` §8.4). Use an explicit interaction signal if a KPI must mean "engaged this visit".
6. **Theme `product:added-to-cart` `detail.id`:** the numeric Shopify **variant** id, per the reading of `assets/main.mjs` in `06` §12 (not runtime-tested).
7. **§ 25 TDDDG exposure** of the unconditional sid and `track()` (including `launcher_attention_played`) is a legal question, not a code fact. It is raised here so that new interaction-free events are not added without a decision.
8. **Live theme state:** this chapter documents `main` at `bc7fb5d`. The live theme can differ through a missed upload or live-editor drift: the "MO only" blocks, the CTA in `product.produktdesign-02.json` and the head stash script in `layout/theme.liquid` are all in files the live editor can change. Check after every upload with `07` §6.3–§6.4.
9. The task brief mentioned a **copy-selection nudge trigger**. No such trigger exists in `ms-chat-widget.js`. If it is planned, it is not implemented.
