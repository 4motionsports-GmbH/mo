# 05 — Engagement features and KPI telemetry

> **Audience:** backend coding agents of Mo (`4motionsports-gmbh/mo`). They cannot see the theme repo.
> **Source of truth:** the theme repo `ms_shopify_clone`, `main` at `8d0a0c4`: PR #73 "customer platform" (`a0df103`, merged, **live since 2026-10-04**) plus five follow-up fixes that are **not uploaded to live yet** (contact-form `sessionId`, stream cancel on thread switch, `order_support` label, CTA hiding, CTA on three more product templates). Every claim below comes from reading that tree, mainly `assets/ms-chat-widget.js`. Backend behaviour is cross-referenced to the backend repo's `docs/API_CONTRACT.md` (cited as **AC §n**), `docs/ADMIN_DASHBOARD.md` (**AD §n**), `docs/ORDER_ATTRIBUTION.md`, `docs/CAMPAIGNS.md` (**CMP §n**) and `docs/frontend-handoff/*.md` (`CUSTOMER_ACCOUNT.md` = **CA §n**). It is not re-specified here.
> Code locations are given as `file → function / key / selector`. Line numbers are left out on purpose because they drift.

This chapter is the complete reference for what the widget measures and how it tries to start conversations. It lists **every** KPI event the widget sends (all 45 `track()` call sites, 35 distinct names) with exact `data` keys, triggers, guards and the function each one lives in. It describes the `POST /api/kpi` transport and how the backend joins events to sessions, then documents every engagement mechanic with its exact rules: the launcher bounce, the contextual nudge, the product-page CTA, the campaign deep link, order attribution and the cart refresh after quick checkout. It ends with what is **not** measured today, which funnels can already be computed, and frontend-feasible ideas for each business KPI.

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
| Commerce glue | Consent-gated `_mo` cart stamp (`/api/attribution/token` + `/cart/update.js`). Display-only cart refresh (`/cart.js`) after the "Zur Kasse" quick checkout. |
| Live status and data windows | PR #73 is live since 2026-10-04: sign-in works again, so tier-3, consent-popup (`consent_gate_*`) and login-gate funnels (`login_gate_*` → `account_signin_linked`) have real data **from 2026-10-04** only. The `8d0a0c4` fixes are not uploaded yet; once they are, `contact_form_submitted` becomes session-keyed (§4.10) and three more product templates show the CTA (§8.1). |
| Biggest gaps | No source on `chat_opened`, no card impressions, no launcher/widget-load event, no error telemetry, no deep-link event. The "Zur Kasse" permalink probably does not carry `_mo`. The admin "Engagement" ratio is skewed by `launcher_attention_played`. Details in §12–§13. |

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
- The request is cross-origin (storefront → `mo.motionsports.de`) with a custom header and a JSON content type, so the browser sends a **CORS preflight** first. AC §5 says the endpoint is origin-allowlisted only. A storefront origin missing from `ALLOWED_ORIGINS` silently loses every event.

### 2.2 Delivery semantics

| Property | Behaviour | Consequence for the backend |
| --- | --- | --- |
| Primary path | `fetch(url, {method:'POST', headers, body, keepalive:true}).catch(noop)` | The event can survive a page unload (outbound CTA clicks, the sign-in redirect). |
| Fallback | `navigator.sendBeacon(url, payload)` **only** when `window.fetch` does not exist | In practice this never runs on supported browsers. If it did, it would send `text/plain` with **no `x-ms-session` header** (the body `sessionId` still keys the row, §2.1). Do not rely on it. |
| Errors | Every throw and rejection is swallowed. No retry, no queue, no batching, no deduplication. | Counts are a **lower bound**. Ad blockers, offline clients, a 429 (`kpi` bucket, 120 req/60 s per AC §5) or a 403 drop events silently. The `kpi` bucket is **shared with `/api/attribution/token` mints** (AC §10): a burst of KPI events can make a mint fail, and `moAttrFailed` then stops attribution for the rest of that page view (§10.2). |
| Ordering | One request per event, fired synchronously in the caller. | Events of one session can arrive out of order. Order by `created_at` only approximately. Use the client timestamp (`data.clientTimestamp`) for sub-second ordering. |
| Response | Never read. | The 202 contract (AC §5) is only for humans. |
| Unload | `keepalive` plus a CORS preflight. Whether browsers complete a preflighted keepalive request during navigation varies by browser and version (see §14). | `account_signin_started` (fired immediately before `location.assign`) is the event most at risk. |

### 2.3 What never leaves the browser through `track()`

Comments in `track()`, in the page-context block and in WIDGET_SPEC §9b/§9c state the rule, and the call sites follow it:

- Never message text, voice transcripts or TTS text (`message_sent`, `voice_*` carry `{}`).
- Never an email address (capture and opt-in submits go to their own endpoints, and the funnel events are server-side).
- Never browsed product **names** or the browsing trail in a KPI event. **`/api/chat` does carry them:** `recentlyViewedPayload()` builds `context.recentlyViewed` from `localStorage['ms-chat-trail']` with up to 3 browsed products (`{type:'product', id, name}`) and up to 2 categories (`{type:'category', name, id?}`). It is sent with the nudge-click context greeting (`showNudge()` click handler, `browsingContext()`) and the product-CTA primer (`openWithProduct()`). Both requests start with a click, but the nudge greeting has no user message. The privacy comment above `PAGE_CTX` ("NEVER transmitted — no backend call carries it") is stale.
- Never the campaign token (`mo_c`) or the one-time sign-in code (`ms_code`).
- **Product ids do leave** the browser: `product_cta_opened` (numeric Shopify id), `product_cta_clicked` / `add_to_cart_clicked` / `showroom_clicked` (catalog ids).

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

Because the KPI `sessionId`, the login `session=` and the later `x-ms-session` of `POST /api/auth/link` are the same value, the admin "Anmelde-Popup" funnel can join `login_gate_signin_clicked` (widget) → `account_signin_succeeded` (server, callback) → `account_signin_linked` (server, code redeemed) (AC §5, AD §5.7a). `initiateLogin()` additionally pins the login's sid in `sessionStorage['ms-chat-login-sid']`. The return never redeems the code under a different sid. A mismatch counts as `account_signin_return {result:'link_failed'}`.

### 3.2 A "session" is not a visit

This is the most important modelling fact for KPI work:

- **`sid` lives in localStorage and persists across visits, days and tab closes** until something rotates it. For an anonymous visitor who never clicks "Neuen Chat starten", one `sid` can span weeks. "Sessions" in `kpi_events` are therefore closer to **devices × conversation epochs** than to visits.
- The **"once per session" guards are per tab session.** They live in `sessionStorage`: nudge, launcher bounce, first-message popup, `consent_gate_shown` dedupe and the campaign token. The auth-return re-open flag (`ms-chat-auth-return`) and the kept link code (`ms-chat-link-retry`) are per tab too. A new tab or a new browser session resets them, while the `sid` stays the same. One `sessionId` can therefore carry several `nudge_shown`, `launcher_attention_played` or `login_gate_shown` events over its lifetime. The admin funnels count **distinct sessions**, which hides this but also merges visits.
- Links the widget opens use `target="_blank" rel="noopener noreferrer"`. In current Chromium a `noopener` tab starts with an **empty** sessionStorage, so a product page opened from a chat card gets fresh per-tab caps (it can bounce and nudge again).
- Without usable localStorage (private mode quirks, blocked storage) `lsGet/lsSet` fall back to memory. A new `sid` is then minted on **every page load**, which inflates session counts.
- Without usable sessionStorage, `ssGet()` / `ssSet()` fall back to an in-memory object (code comment: "silent in-memory fallback degrades to once per page load"). The per-tab caps then become **per page load**: `ms-chat-attn-played`, `ms-chat-nudge-shown`, `ms-chat-opened`, `ms-chat-gate-shown` and `ms-chat-optin-ask-shown` reset on every navigation, so `launcher_attention_played`, `nudge_shown` and the first-message popup can fire on every page. A campaign token captured on the landing page (`ms_mo_c`) is lost on the next navigation, so no `campaign_chat_started` is recorded if the visitor first chats on a later page. The sign-in return cannot re-open the panel (`ms-chat-auth-return`) or check the login sid (`ms-chat-login-sid` is missing, so `handleAuthReturn()` skips the mismatch check), and `ms-chat-link-retry` / `ms-chat-early-params` do not survive navigation either.
- A signed-in session that ends silently (server-side expiry, logout elsewhere, erase on another device) rotates the sid the next time the widget probes auth or gets a 401 from `/api/account/*` (§3.3), with no KPI event. That customer's funnels are split across two sids. Since 2026-10-05 (App Proxy, P0.3) two more server-side causes exist: **shop-proof expiry** (a session signed in through the shop login alone, kept open in one tab longer than `APP_PROXY_SIGNIN_MAX_AGE_HOURS` without a new tab — every new tab renews it) and **handover** (whoami sees another shop customer on a signed-in sid and ends that sign-in, so the next customer starts on a fresh sid).

### 3.3 When the sid changes (events before and after land on different sessions)

| Trigger | Function | Tracked? |
| --- | --- | --- |
| Anonymous "Neuen Chat starten" (header button, or the "Dieser Chat ist ziemlich lang geworden…" notice after a 40-message `payload_too_large`) | `startNewChat()` → `rotateSession()` | **No event.** (Signed-in "Neue Beratung" keeps the sid and sends `account_new_consultation`.) |
| Campaign deep link with `mo_new=1` for a visitor without a signed-in hint (signed-in hint = `localStorage['ms-chat-signed-in'] === '1'` **or** the visitor is logged into the shop, `ShopifyAnalytics.meta.page.customerId`; `shouldProbeAuth()` / `storefrontCustomerHint()`) | `handleMoDeepLink()` → `rotateSession()` | No event |
| Sign-out ("Abmelden") | `signOut()` → `dropSessionHistory()` | `account_signout` is sent **under the old sid**, before rotation |
| Erase ("Alle meine Daten löschen") success | `clearAfterErase()` | No widget event (server `account_erased`, session `NULL`) |
| Return from backend logout with `?ms_auth=logged_out`, when `/api/auth/me` confirms the ended session. Rare in practice: no widget code path goes through the backend logout (`signOut()` is local only), so this is reached only if something outside the widget sends the visitor there (or a crafted link). | `handleAuthReturn()` → `probeAuth()` → `endedSignInCleanup()` | No event |
| Signed-in session found ended: `/api/auth/me` returns `signedIn:false` / 401 / 403 (non-transient) for a device with the signed-in hint (`localStorage['ms-chat-signed-in']==='1'` or `auth.signedIn`), or any `/api/account/*` call (history, rename, delete, export, summary, opt-in) returns 401. Covers server-side expiry, logout elsewhere, erase on another device, and since 2026-10-05 shop-proof expiry (`APP_PROXY_SIGNIN_MAX_AGE_HOURS`; 401 „Sitzung abgelaufen“) and a whoami **handover** to another shop customer (CA §3a). Runs on any probe (panel open, `visibilitychange`, auth return). | `probeAuth()` / `accountUnauthorized()` → `endedSignInCleanup()` → `dropSessionHistory()` → `rotateSession()` | No event (also sets `sessionStorage['ms-chat-whoami-done']` so shop recognition does not re-link the fresh sid) |
| Another tab rotated the sid | `onSidChangedElsewhere()` adopts the new id | No event |

Every rotation in this tab (`rotateSession()`) calls `moAttrReset()` (clears the in-memory cache and `localStorage['ms-mo-attr']`). Adopting another tab's rotation (`onSidChangedElsewhere()` → `dropSessionHistory(newSid)`) resets only the in-memory attribution state (`moAttr`, `moAttrFailed`, `moAttrConsulted`); the rotating tab already removed the stored token, and `moAttrLoad()` ignores another sid's entry anyway. Either way the next consultation mints a new `_mo` token (§10), but "next consultation" can be a card build that was already running before the rotation (§10.3). The live Shopify cart keeps the old `_mo` attribute until a new stamp overwrites it. Funnels that span a rotation are split: for example, `nudge_shown` lands on sid A and the chat after "Neuen Chat starten" on sid B.

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
- `launcher_attention_played` fires **without any user interaction**, on the first page of each tab session. It is the only reach-like event, and it is what skews the admin "Engagement" ratio (§12).

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
| `message_sent` | `{}` | Every user message pushed into the transcript: composer send, voice transcript, product-CTA primer message (§8). Sent **before** the network request, so a turn that later fails (429/5xx, rolled back) still counted. | None | `sendMessage(text, context)` |

**Not counted as `message_sent`:** the nudge's context greeting (`sendContextGreeting()`, `messages: []`, no user message). There is no event for "assistant replied", stream errors, rate-limit locks or the 40-message cap.

### 4.4 Products and commerce

| Event | `data` | Trigger | Guard | Function |
| --- | --- | --- | --- | --- |
| `product_cta_opened` | `{ productId: <numeric Shopify product id as string> }` | Click on the storefront CTA "Detaillierte Beratung zu diesem Produkt" (§8). Fires after `openPanel()`, even when the widget is busy and no message is sent. | None | `openWithProduct(id, title)` |
| `product_cta_clicked` | `{ productId: <catalog id> }` | Click on "Zum Produkt" in a `show_product` card or in a `compare_products` table (`productButton()`). Also the fallback product links of an `add_to_cart` card that has no `cartUrl` (`buildAddToCart()`). Opens `shopifyUrl` in a new tab. | None | `productButton()`; `buildAddToCart()` fallback branch |
| `add_to_cart_clicked` | `{ productId: <first resolved catalog id>, productIds: [<all resolved catalog ids>] }` | Click on "Zur Kasse" in an `add_to_cart` card (opens the combined cart permalink `cartUrl` in a new tab). Same handler: `moAttrEnsure(false)` (re-stamp, §10) and `pollCartAfterCheckout()` (§11). | None | `buildAddToCart()` |
| `showroom_clicked` | `{ productIds: [<catalog ids>] }` | Click on "Showroom ansehen" in a `suggest_showroom` card (opens the showroom page). | None | `buildShowroom()` |

Caveats:
- **Two id spaces.** `product_cta_opened` sends the **numeric** Shopify id (`data-ms-chat-product-id="{{ product.id }}"`, comment: "numeric id stays for KPI"). The other three send the catalog id from `/api/products` (handle-shaped, possibly a variant-pinned ref, see AC §3). They cannot be joined without the catalog.
- `productIds` in `add_to_cart_clicked` includes sold-out products that were rendered with "Ausverkauft — nicht im Warenkorb", even though the server-built `cartUrl` excludes them (AC §3).
- `product_cta_clicked` carries **no surface**. A click from a single product card cannot be told apart from one in a comparison table or the add-to-cart fallback.

### 4.5 Sign-in popup and sign-in

All widget truth. The server adds `account_signin_succeeded` / `_linked` / `_link_refused` (§5).

| Event | `data` | Trigger | Guard | Function |
| --- | --- | --- | --- | --- |
| `login_gate_shown` | `{}` | Anonymous visitor, ~700 ms after a user message is **sent** (while the reply streams; `sendMessage()` → `setTimeout(maybeShowConsentGate, 700)`), unless that send was already rolled back (429/5xx/network) or the widget is rate-locked by then. It does not wait for the reply to succeed: a request that fails after the popup appeared still has the popup counted. If the auth tier is unsettled it polls up to 10 × 500 ms, so the popup can appear up to ~5.7 s after the send. Also: panel open, not in voice mode, not snoozed. | `sessionStorage['ms-chat-gate-shown']` (one first-message popup per tab session, shared with the consent gate). `localStorage['ms-chat-login-gate-snooze']` timestamp: 24 h after "Später". | `presentLoginGate()` |
| `login_gate_signin_clicked` | `{}` | "Anmelden" in the popup. If the reply is still streaming, the button shows "Antwort wird noch geladen…" and the redirect waits until streaming ends (200 ms steps, max 20 s). | — | `presentLoginGate()` |
| `login_gate_declined` | `{}` | "Später". Writes the 24 h snooze. | — | `presentLoginGate()` |
| `login_gate_dismissed` | `{}` | Esc or backdrop click (no snooze; the tab-session guard keeps it quiet). | — | `openGateDialog(…, onDefer)` |
| `account_signin_started` | `{ source: 'login_gate' }` from the popup, otherwise `{}` | **Any** sign-in start: popup, welcome card "Jetzt anmelden", header "Anmelden", drawer "Mit Kundenkonto anmelden", the "Die Anmeldung ist abgelaufen…" notice. Immediately followed by `location.assign()` to `/api/auth/shopify/login?session=<sid>&return_url=<page>`. | — | `initiateLogin(source)` |
| `account_signin_return` | `{ result: 'ok' \| 'link_failed' \| 'login_required' \| 'error' }` | On the page load that carries `?ms_auth=` (or its head-script stash). `ok` is sent **only after** the one-time code was redeemed (`POST /api/auth/link`). `link_failed` covers a refused code, a missing code, a sid mismatch, or the backend being unavailable (503/429/5xx or network error; then the code is kept for one silent retry on the next page load in the same tab, §12.1 row 7). `logged_out` sends nothing. `login_required` can only come from a `prompt=none` login, which this widget never starts (`initiateLogin()`: "We do NOT use prompt=none here"; `handleAuthReturn()` labels the branch "prompt=none path only"), so it should be ~0 in `kpi_events`. `logged_out` is reached only if something outside the widget sends the visitor through the backend logout (or a crafted link); see chapter 04 §18 item 11. | Once per return (params consumed) | `handleAuthReturn()` |
| `account_signout` | `{}` | Drawer "Abmelden". Sent under the **old** sid, then the sid rotates. | — | `signOut()` |

Details of the sign-in flow (code redemption, whoami, retry) are in the sign-in/account chapter of this doc set and in `frontend-handoff/CUSTOMER_ACCOUNT.md`.

### 4.6 Consent gate (marketing opt-in for signed-in customers)

Two UIs, one surface: the **popup** after the first message (`presentConsentGate`) and the **inline card** after a mid-conversation sign-in (`presentSignInOptIn` → `buildMarketingOptInCard`). Both send `surface: 'signin'` only. The `'chat'` surface is retired (AC §5).

| Event | `data` | Trigger | Guard | Function |
| --- | --- | --- | --- | --- |
| `consent_gate_shown` | `{ surface: 'signin' }` | Popup: shown after the served copy loaded with `lawyerApproved === true`. Card: once the served copy is rendered (a card that removes itself for missing/unapproved copy is not counted). | `sessionStorage['ms-chat-optin-ask-shown']`, shared by popup and card: **at most once per tab session**. | `presentConsentGate()`; `buildMarketingOptInCard() → renderForm()` |
| `consent_gate_accepted` | `{ surface: 'signin' }` | "Ja, Angebote aktivieren", sent **only after** `POST /api/account/marketing-opt-in` returned 2xx. (401 → anonymous; 422 → falls back to the typed-email capture form, no event.) | — | both |
| `consent_gate_declined` | `{ surface: 'signin' }` | "Nein, danke". Device memory `localStorage['ms-chat-mkt-decision'] = {state:'declined', at}` mutes both UIs for 30 days. | — | both |
| `consent_gate_dismissed` | `{ surface: 'signin' }` | Popup only: Esc or backdrop. Marks opt-in done for this tab session. | — | `presentConsentGate()` |

Eligibility (`consentGateEligible()`, `optInActionable()`): signed in, `auth.optInActionable === true` from `/api/auth/me`, not answered or dismissed this tab session (`ms-chat-optin-done`), no recent device decline, no unanswered inline card on screen, not in voice mode. **An accept counts the tap, not the DOI.** The effective subscription is the server's `email_capture_marketing_opted_in {trigger:'signin_optin'}` → `email_capture_marketing_confirmed` (AD §5.7).

> **Backend status (2026-10-05, OI1 + OI3):** the dashboard counts this surface per **session** with its final state (accepted > declined > dismissed), so the accept-then-Esc double count and several tabs of one sid no longer inflate it. The server events carry `source:'mo_signin'`, `outcome`, `alreadyConfirmed`, `doiRequired`, and `email_capture_marketing_confirmed` carries `{source}`, so DOI completion is measured per surface. The backend accepts optional `placement` (`popup` | `signin_return` | `value_moment`) and `variant` in these events' `data` and in the opt-in POST, and serves `benefits` + `variant` with the copy; the live widget sends neither until the upload with frontend task 1 (2026-10-05). AD §5.7 „Nach Variante und Platzierung“.

### 4.7 Email capture

| Event | `data` | Trigger | Function |
| --- | --- | --- | --- |
| `email_capture_declined` | `{ trigger }` when the card came from an `offer_email_summary` tool call that had a `trigger`, otherwise `{}` | "Nein danke, vielleicht später" (`CONSENT_COPY.decline`) on the capture card. Then the card collapses to a note. | `buildCaptureCard(opts)` |

- The widget never sends `email_capture_ask_shown`, `_submitted`, `_marketing_opted_in` or `_marketing_confirmed`; those are server-side (AC §5).
- AC §5 allows `askNumber` on this event. **The widget does not send it.**
- The header "Per E-Mail teilen" button (`openCaptureForm()`, also `window.MS_CHAT.openEmailSummary`) renders the same card **without** a tool call. The server therefore never sees an "ask shown" for it, its submits have no `trigger`, and its declines send `{}`. The same trigger-less card (`{message: CONSENT_COPY.intro, productIds: null}`) is opened by the signed-in opt-in fallback when `POST /api/account/marketing-opt-in` returns 422 / `no_verified_email` (`presentConsentGate()` directly, `buildMarketingOptInCard()` via its "noEmailBtn"). Its submits and declines also carry no `trigger`.
- The capture submit sends `sessionId: sid` in the body (so does the contact form since `8d0a0c4`, §4.10).
- **One offer can be declined (and counted) several times.** Cards are rebuilt from stored history on every page load and every full re-render (`renderAllMessages()` → `renderRestoredAssistant()` → `renderPartIntoCtx()` → `buildToolCard('offer_email_summary')`). The decline in `buildCaptureCard()` only swaps the card's DOM (`body.replaceChildren`) and is never stored, so the same stored offer shows a live „Nein danke, vielleicht später“ button again after each navigation, and each click sends another `email_capture_declined` with the same `trigger`. Declines can therefore exceed asks per session: count distinct sessions or dedupe per `trigger`.
- `buildToolCard()` suppresses the `offer_email_summary` card when `auth.signedIn` is set at render time. For a signed-in customer the server's `email_capture_ask_shown` still counts, but no card was visible.

> **Backend status (2026-10-05, OI1):** the „E-Mail-Capture-Funnel“ (AD §5.8) now counts the capture form only (server `source:'mo_capture_form'`; the sign-in opt-in is no longer mixed in), counts `email_capture_declined` once per session and `trigger`, bounds the triggers (unknown → „Anderer Wert“), and divides DOI confirmations by opt-ins whose `outcome` was `doi_required`. `/api/capture-email` stores the `trigger` echo only when it is one of the tool's five values. Since PR 1 of the same day the backend no longer offers the summary to a live signed-in session, so new signed-in asks come only from restored parts.

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

- **Feedback** (`openFeedbackCard()` → `POST /api/feedback`, AC §9): no KPI event. The feedback row itself, with `sessionId` in the payload, is the record.
- **Contact form** (`buildContactForm()` → `POST /api/contact`): no widget event. The server writes `contact_form_submitted` and keys it on the body's `sessionId` only (`src/app/api/contact/route.ts`). **Since `8d0a0c4`** the submit payload carries `sessionId: sid` (the current sid at submit time) next to the `x-ms-session` header, so the row is **session-keyed** and joins the chat session. Before that commit, and on live until the owner uploads it, the body had no `sessionId` and the row was stored with session `NULL`. Rows from before the upload cannot be joined.
- **Contact reasons** (`REASON_LABELS`, chosen by the tool input `reason`, unknown values fall back to `general`): since `8d0a0c4` there is an `order_support` reason with the title „Kontakt zum motion sports Team“ / "Contact the motion sports team", the subline „Bestellstatus, Retoure/Rückgabe, Stornierung oder Reklamation — das Team kümmert sich.“ / "Order status, return, cancellation or complaint — the team will take care of it." and the message placeholder „Bestellnummer + kurz dein Anliegen…“ / "Order number + briefly your request…". Organisation stays optional (only `studio_consultation` and `public_sector_quote` require it). `reason` is part of the POST body, so the backend receives it with every submission (whether the KPI row stores it is backend behaviour).
- **Errors:** none. No event for `/api/chat` 4xx/5xx/403/429, `payload_too_large`, hydration failures (product card renders nothing), TTS fallback, sign-in redeem failures beyond `account_signin_return`, or attribution failures.

### 4.11 Retired

`starter_shown`, `starter_clicked` (starter prompts removed 2026-10-01). The backend shows them as „eingestellt“ (`kpi-widget-events.mjs → DISCONTINUED_WIDGET_EVENTS`). Some comments in the widget still mention "category starters" (e.g. above `trailCategoryStreak()`); those comments are stale.

---

## 5. Events the widget must never send (server-only)

From AC §5. `/api/kpi` has no allowlist, so a widget that sent one of these would silently double-count.

| Event | Emitted by | Session-keyed? |
| --- | --- | --- |
| `email_capture_ask_shown` | `/api/chat` (`offer_email_summary`) | yes |
| `email_capture_submitted`, `email_capture_marketing_opted_in` (since 2026-10-05 with `source`, `outcome`; the sign-in opt-in also `alreadyConfirmed`, `doiRequired`, `placement?`, `variant?`) | `/api/capture-email`, `/api/chat-marketing-opt-in`, account opt-in | yes |
| `email_capture_marketing_confirmed` (`{source}` since 2026-10-05) | `/api/confirm-marketing` | — |
| `marketing_email_clicked`, `campaign_email_clicked`, `bundle_offer_clicked` | `GET /api/r/<token>` | `NULL` |
| `campaign_chat_started` | `/api/chat` with a valid `campaignToken` (once per send) | `NULL` (deliberately not tied to the chat) |
| `contact_form_submitted` | `/api/contact` | yes since `8d0a0c4` (body `sessionId`); `NULL` for rows from before that upload |
| `account_signin_succeeded` | `/api/auth/shopify/callback` | yes (login `session=`) |
| `account_signin_linked` (`{kind, renewed}`), `account_signin_link_refused` (`{reason, kind?}`) | `/api/auth/link` | yes |
| `account_shop_recognised` (`{proof, hasToken, alreadySignedIn, codeIssued, noCode?}`; since 2026-10-05) | `GET /api/auth/storefront` (App Proxy whoami, signed and fresh, shop customer logged in) | yes |
| `account_export_requested`, `account_erased` | account endpoints | `NULL` |
| `order_status_lookup` | `/api/chat` `get_order_status` (behind `CHAT_ORDER_STATUS_ENABLED`, currently off) | yes |
| `mo_order_marker_unresolved` | `POST /api/webhooks/shopify` on `orders/create`: a `_mo`-marked order the backend could not attribute (`{reason: unknown_token \| outside_window, source?}`; since 2026-10-05) | `NULL` |
| `page_context_applied` (`{applied, kind, resolved, locale, pct}`; since 2026-10-05) | `/api/chat`, one per request with `context.source: "page"` (written when it arrives; the arm, A3) | yes |
| `page_context_answered` (`{kind, productCards, otherCards}`; since 2026-10-05) | `/api/chat`, when that turn finished (counts only) | yes |

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

`ms-chat-widget.js → initNudgeTriggers()`, `nudgeEligible()`, `nudgeCopy()`, `showNudge()`, `removeNudge()`. CSS `.ms-chat-nudge*`. Spec: WIDGET_SPEC §9c.

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

English variants exist (`L()`). The nudge never asks for an email. **Tone-rule inconsistency:** the code comments and WIDGET_SPEC §9c require copy to reference the page or category, "never the user's behavior". The streak variant („Du schaust dir … an“) does describe behaviour. A frontend agent or the owner should decide whether to reword it.

### 7.4 Presentation and lifetime

- A small speech bubble fixed above the launcher (right 20 px, bottom 96 px + safe area), z-index just below the panel. The whole text is one button. A separate × button ("Hinweis schließen").
- **It never auto-hides.** It stays until clicked, dismissed, the panel opens (`openPanel()` → `removeNudge()`), or the page navigates. It is not shown again in that tab session (the shown flag is set at show time).
- Hidden while `body.no-scroll` (theme drawers). `nudge_shown` still fires if the trigger hits while a drawer is open.

### 7.5 Click → context greeting

On click: `nudge_clicked` → `removeNudge()` → `openPanel()` (`chat_opened`). If the conversation was empty **before** opening and the widget is not streaming or rate-locked:
- Product page: `context = { type:'product', productId: <handle || numeric id>, productTitle?, recentlyViewed? }`.
- Other pages: `browsingContext(null)` = `{ type:'browsing', recentlyViewed:[…] }` from the trail (≤ 3 products + ≤ 2 categories), or **nothing** when the trail is empty.
- With a context, `sendContextGreeting(ctx)` → `POST /api/chat` with `messages: []` and the context. The backend streams a greeting (AC §2). No `message_sent`, and no sign-in/consent popup is triggered by this turn. A pending campaign token rides along (§9).
- Without context (e.g. generic home nudge, empty trail), the panel simply opens on the welcome state.

---

## 8. Engagement mechanic: product-page CTA

### 8.1 Where it is rendered

- `templates/product.json` → section `main` → block `custom_liquid_AErEyg` ("MO only"), enabled. It renders only if `settings.ai_advisor_enabled`:
  `<button type="button" class="ms-chat-product-cta" data-ms-chat-product-id="{{ product.id }}" data-ms-chat-product-title="{{ product.title | escape }}">` with an empty `.ms-chat-logo` orb span and the label „Detaillierte Beratung zu diesem Produkt“.
- The older block `custom_liquid_BGU8Mt` ("USPs mit MO") in `product.json` is **disabled**. In `templates/product.produktdesign-02.json` the same block (named "USPs") is **enabled** and renders the CTA under the `custom.kurzinfo` bullets. Since `8d0a0c4` the identical "MO only" block `custom_liquid_AErEyg` is also in `product.produkt-new.json` (after the Kurzinfo/USPs block `custom_liquid_BGU8Mt`), `product.produktnew.json` and `product.produkte-im-set.json` (after the SKU + Garantie block `custom_liquid_dy3Byf`), so in the repo **every product template has a CTA**. On live, those three templates get it only once the owner uploads them (or adds the block in the theme editor); until then `product_cta_opened` comes only from `product.json` and `product.produktdesign-02` products. See chapter 01 §6 for the template map and chapter 06 §3.7.
- These blocks live in template JSON, which the live theme editor also edits. Live-editor drift can remove or alter the CTA without any repo change (chapter 01 §16).

### 8.2 Behaviour

1. `init()` → `bindProductCtas()` adds one delegated `document` click listener for `.ms-chat-product-cta`. Clicks before the deferred widget script has run are lost (no event, nothing happens). Where the widget does not mount (template in `ai_advisor_excluded_templates`, cart/checkout, empty `ms_chat_shared_secret`), `snippets/ms-chat-widget.liquid` outputs `<style>.ms-chat-product-advisor, .ms-chat-product-cta { display: none !important; }</style>` since `8d0a0c4`, so the CTA is hidden instead of dead (before that, and on live until the upload, it rendered and did nothing). Remaining edge: if the widget JS fails to load, the visible button still does nothing.
2. `openWithProduct(id, title)`: `openPanel()` (`chat_opened` if it was closed) → `product_cta_opened {productId: numeric id}`.
3. If streaming or rate-locked: stop here (panel open, nothing sent).
4. Otherwise build `context = { type:'product', productId: PAGE_CTX.productHandle (when the CTA belongs to this page's product) else the numeric id, productTitle, recentlyViewed? }`.
5. Send a **visible primer user message**: „Ich interessiere mich für „<Titel>". Kannst du mich zu diesem Produkt beraten?“ (or „Kannst du mich zu diesem Produkt beraten?“ without a title) via `sendMessage(prompt, context)` → `message_sent`. This deliberately does not use the `messages: []` greeting, so the title is in the text even if the context id is dropped.
6. Because it is a normal user message, the **first-message popup** (sign-in popup or consent gate, §4.5/§4.6) can follow ~0.7 s later.
7. It works with existing history (appends a turn, never wipes). `window.MS_CHAT.openWithProduct(id, title)` exposes the same function to other theme code.

Funnel available today: `product_cta_opened` → `message_sent` (same session, immediately) → server tool calls → `product_cta_clicked` / `add_to_cart_clicked`.

---

## 9. Engagement mechanic: campaign deep link and campaign token

Campaign e-mails link through `GET /api/r/<token>` (AC §11.2). For a Mo CTA, this redirects to `CAMPAIGN_MO_DEEPLINK_URL` with `mo_c=<token>` appended.

### 9.1 Order of processing on page load

1. `layout/theme.liquid` `<head>` inline script (only if `ai_advisor_enabled`, **before** `content_for_header`): moves `ms_auth`, `ms_code`, `mo_c` off the URL into `sessionStorage['ms-chat-early-params'] = {at, …}` and calls `replaceState`. Shopify analytics and web pixels therefore never see the token in a page URL.
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

**What campaign mails actually land on.** Campaign mails with `cta_kind = mo_chat` link to `CAMPAIGN_MO_DEEPLINK_URL`, by default `https://motionsports.de/?mo=open&mo_new=1&mo_view=fullscreen&utm_source=campaign&utm_medium=email`, plus `&mo_c=<token>` appended by `/api/r/<token>` (backend `docs/CAMPAIGNS.md`: CMP §4 "Draft generation", step 5 "Call to action", and CMP §5 "Chat-Start"; AC §11.2). In the widget this means:

- (a) The landing page is **home** (`PAGE_CTX.type 'home'`): no product context. Because the deep link opens the panel (`openPanel()` sets `sessionStorage['ms-chat-opened']`), no nudge can appear for the rest of that tab session on any device or page type (`nudgeEligible()` and `showNudge()` check that key). The launcher bounce is skipped on the landing page too: its 1.4 s timer finds the panel open, and `ms-chat-attn-played` is already consumed. Campaign landings therefore produce no `nudge_shown` and no `launcher_attention_played` in that tab.
- (b) `mo_new=1` **rotates the sid for every visitor without a signed-in hint** (but see the card-build race in §10.3: a rotated sid can be marked consulted and stamped by the deleted thread's product cards) (`!shouldProbeAuth()` → `rotateSession()`). Signed-in hint = `localStorage['ms-chat-signed-in'] === '1'` **or** the visitor is logged into the shop (`ShopifyAnalytics.meta.page.customerId`, `storefrontCustomerHint()`). For a rotating visitor, KPI events before and after the click land on different sessions, the device's previous anonymous thread is deleted, and the `_mo` token is reset (`moAttrReset()`). A visitor with a signed-in hint keeps the sid but loses the local thread (`lsDel(historyKey())`, `clearConvKey()`); this includes a shop-logged-in visitor who never signed into the chat (no rotation, the `_mo` token is kept). Only visitors with neither signal rotate.
- (c) Desktop opens in the modal view (not persisted). Mobile is fullscreen anyway.
- (d) `mo`, `mo_new`, `mo_view` and `utm_*` are still in the URL when `content_for_header` (Shopify analytics, web pixels) runs; the deferred `init()` strips the `mo*` params only later. `mo_c` never reaches it (the head script removes it first, §9.1).

When planning campaign KPIs or a new landing parameter, decide whether `mo_new=1` should stay in the default.

### 9.3 What counts as a "campaign chat"

- `startStream()` reads `sessionStorage['ms_mo_c']` on **every** `/api/chat` request (typed message, product-CTA primer, nudge greeting) and adds it as `campaignToken` while a valid token is stored. In practice that is the next request after the token was captured, not necessarily the first of the tab session: `captureCampaignToken()` can store a token on any later page load of a tab that already chatted. It is deleted once a response is `ok`. A failed request keeps it for the next turn.
- The server records `campaign_chat_started {sendId, campaignId}` **once per send**, session `NULL` (AC §2, §5).
- Consequences:
  - A campaign click that opens the chat but where the visitor never sends anything does **not** count. No widget event marks the deep-link open either (§13).
  - The token survives same-tab navigation (sessionStorage). A chat started later on another page in the same tab still counts. Closing the tab loses it.
  - Since the event is session-less **by design**, campaign chats cannot be joined to product clicks or `_mo` orders of that session. Campaign revenue comes from `MK-` codes and the campaign funnel (AD §5.9).
- The token is never placed in KPI payloads, localStorage, cookies or logs.

---

## 10. Order attribution: the `_mo` cart stamp

`ms-chat-widget.js → moAnalyticsAllowed()`, `moAttrLoad()`, `moAttrReset()`, `moStampCart()`, `moAttrEnsure(viaRender)`, `moAttrOnProductCard()`, `initAttribution()`. Backend: AC §10, `ORDER_ATTRIBUTION.md`, AD §5.16. Shipped in the 2026-08-12 widget session (MANIFEST.md, commit `e4b12f1`, on top of the Aug 12 live sync). It was not affected by that drift. The 2026-10-01 restore concerned PR #67/#62 (welcome/first-message gate, deep link), not attribution.

> **Backend status (2026-10-05, after this chapter was written):** the attribution window counts from the token's minting; with the backend switch `MO_ATTRIBUTION_SESSION_ANCHOR` on (owner decision 2026-10-05, after migration 0076), a `widget` token's window counts from the device's latest product consultation (`show_product`, `compare_products`, `add_to_cart`, `suggest_showroom` written by that sid), and retention keeps the token while the device keeps consulting. A cached token therefore stays valid while the device keeps consulting: it is kept as long as the device consults at least every 37 days (at most 180 days after minting), and an order attributes if it comes within 30 days of the device's latest consultation. Orders with an unknown or out-of-window `_mo` are counted as `mo_order_marker_unresolved` (§5). No widget change is needed for this; the gaps that remain are in §10.3.

### 10.1 Invariants

- **Consent-gated:** nothing runs unless `window.Shopify.customerPrivacy.analyticsProcessingAllowed() === true`, re-checked at every stamp.
- **Opaque token only:** the raw sid never goes into a URL or cart attribute. Only the server-minted `cartAttributes` (`{ "_mo": "<token>" }`) are written.
- **Fail-silent and non-blocking:** every call is fire-and-forget.
- **Lazy:** a token is minted only once a `show_product` card renders (live, or re-rendered from stored history on any page load, panel open or not) or on a Mo checkout click. A visitor with no such card in local history is never minted for. "Consulted" is therefore **not an interaction signal**: a device whose stored transcript holds a product card can mint and stamp on page load without any click (if consent is already readable when the card hydrates, §10.2) (see chapter 06 on restored history and attribution triggers).

### 10.2 When it fires

| Moment | Function | Effect |
| --- | --- | --- |
| A `show_product` card is about to render (product hydrated) | `buildShowProduct()` → `moAttrOnProductCard()` → `moAttrEnsure(true)` | Mint if needed (`POST /api/attribution/token` with `x-ms-chat-key` + `x-ms-session`), cache `localStorage['ms-mo-attr'] = {sid, token, cartAttributes}`, stamp. With a cached token: stamp **at most once per page load** (`moAttrPageStamped`). **Also runs on every page load** for a device whose stored transcript (`localStorage['ms-chat-history:<sid>']`) contains a `show_product` card: `init()` → `renderAllMessages()` → `renderRestoredAssistant()` re-renders it (before `initAttribution()`), so it can mint and stamp without interaction, panel closed, and marks the page as consulted for the `visitorConsentCollected` listener. The mint on load happens **only if** the Customer Privacy API already reports consent when the card's `/api/products` hydration resolves (`moAttrEnsure()` returns at once when `moAnalyticsAllowed()` is false, including "API not loaded yet"). Otherwise there is no mint on that page view unless the visitor interacts with the consent banner (`visitorConsentCollected`). |
| Click on "Zur Kasse" (`add_to_cart` card) | `moAttrEnsure(false)` | Nothing without consent (`moAnalyticsAllowed()`). With consent and a cached token: re-stamps on every click (no page-stamp guard). Without a token: mints, and the stamp follows the mint response, unless a mint is already in flight (`moAttrInflight`; that mint stamps once when it resolves) or a mint already failed on this page view (`moAttrFailed`), in which case nothing is stamped. It never waits: the permalink opens in parallel, so on a first click the stamp can land after the permalink built its cart. |
| Page load with a cached token for the current sid | `initAttribution()` tick | Re-stamp once (a completed checkout clears cart attributes). It waits for `customerPrivacy` to load: `tick()` re-schedules itself with `setTimeout(tick, tries * 1000)`, i.e. delays of 1–5 s, so the checks run at about 0, 1, 3, 6, 10 and 15 s, then it gives up. It stops early once the API is loaded but consent is denied. It **never mints** here, even for a consulted session (it only calls `moAttrEnsure()` when `moAttrLoad()` returns a cached token). |
| Consent granted later (`visitorConsentCollected` event) | `initAttribution()` listener | Re-stamp if a token is cached; mint + stamp if the session was already "consulted" on this page. |
| sid rotation | `rotateSession()` → `moAttrReset()` (this tab); `onSidChangedElsewhere()` resets only the in-memory state (§3.3) | Token cache dropped; the next consultation mints a new one. The cart keeps the old `_mo` until re-stamped. |

The stamp is `fetch('/cart/update.js', {method:'POST', body: JSON.stringify({attributes: cartAttributes}), keepalive:true})`, same-origin. After a mint failure (401/403/429/5xx/network), it gives up for the rest of that page view (`moAttrFailed`).

### 10.3 Coverage gaps worth knowing

- **Card builds are not cancelled on rotation.** `renderPartIntoCtx()` calls `buildToolCard(…).then(…)` and nothing cancels it, and `buildShowProduct()` calls `moAttrOnProductCard()` inside `hydrate().then()`, i.e. after an async `GET /api/products`. On a campaign landing with `mo_new=1` (§9.2 b), `init()` first runs `renderAllMessages()`, which starts hydration of the stored thread's `show_product` cards. `handleMoDeepLink()` then runs synchronously: `rotateSession()` → `moAttrReset()`, then `renderAllMessages()` (empty). When the old cards' hydration resolves, `moAttrOnProductCard()` sets `moAttrConsulted = true` and `moAttrEnsure(true)` mints a token for the **new** sid and stamps the cart (consent permitting), although the visitor has not consulted in the new session and the thread was deleted. Orders then count as Mo-influenced for that session. (The same applies to the signed-in-hint branch, which keeps the sid but drops the thread.)
- **A mint in flight during a rotation is cached under the new sid.** `moAttrEnsure()` builds the cache entry as `{sid: sid, …}` from the module variable when the **response** arrives, so a token minted under the old `x-ms-session` is stored and stamped as the new sid's token. `moAttrReset()` does not clear `moAttrInflight`.
- Frontend task for both: capture `sid` before `hydrate()` / before the mint `fetch` and skip `moAttrOnProductCard()` / the cache write when the sid changed in the meantime.
- **Only `show_product` marks a session as consulted.** A consultation that shows only a comparison table (`buildCompare()`), a showroom card or an add-to-cart card (before its click) mints no token and stamps nothing.
- **"Zur Kasse" uses a cart permalink** (`/cart/<variant>:<qty>,…` from `buildPrefilledCartUrl()`, without `attributes[_mo]`; backend `src/lib/cart.ts`). Shopify cart permalinks build their own cart/checkout. It is **likely, but unverified here,** that the live-cart attribute stamped via `/cart/update.js` does **not** carry over to that checkout. If so, Mo's own one-click checkouts are invisible to the webhook tiers unless a code is used. Verify with a test order (§14). The fix options are in §13.4.
- The theme's own add-to-cart (`product-form` in `assets/main.mjs`, which dispatches `document` `product:added-to-cart`) is **not** observed. Re-stamping after a completed checkout relies on the next page load.
- Visitors who deny analytics consent are never stamped. **No event measures consent coverage**, so the share of consultations that can be attributed at all is unknown.
- Purchases on another device stay invisible (stated residual in `ORDER_ATTRIBUTION.md`).
- **Residual token cliff (backend, 2026-10-05).** Even with `MO_ATTRIBUTION_SESSION_ANCHOR` on, the backend deletes a widget token 37 days after the device's last product consultation, and at most 180 days (`KPI_RETENTION_DAYS`) after minting; erasure deletes it at once. The widget never re-mints while a token is cached (§10.2), so a device that keeps its sid (every signed-in customer) stamps the dead token until the sid rotates, and its orders count as `unknown_token`. Tokens purged before 2026-10-05 are not recoverable by the backend. The repair is the widget renewal: [`docs/frontend-handoff/tasks-2026-10-04/3-attribution-token-renewal.md`](../frontend-handoff/tasks-2026-10-04/3-attribution-token-renewal.md) (task 1 renews after a live product consultation; the endpoint already returns a new token after a purge, no contract change).

---

## 11. Cart UI refresh after quick checkout

`ms-chat-widget.js → refreshCartUI()`, `pollCartAfterCheckout()`, `setCartBubble()`, `reloadCartDrawer()`, `reloadCartPageSection()`, `readBubbleCount()`, `cartJsUrl()`.

Problem: "Zur Kasse" opens the permalink in a **new tab**, so the chat tab's header badge and cart drawer show the old count.

| Trigger | Rule |
| --- | --- |
| "Zur Kasse" click | `pollCartAfterCheckout()`: `refreshCartUI()` after 1.2 s, 2.5 s, 4.5 s and 7 s. |
| Tab becomes visible | `visibilitychange` (not hidden) → `refreshCartUI()` (and an auth re-check if the panel is open and anonymous). |
| `pageshow` (every page load, including bfcache restores; registered in `buildShell()` during `init()`, which runs before the load event) / window `focus` | `refreshCartUI()` |

`refreshCartUI()` is single-flight. It does `GET` `window.routes.cart_url` (fallback `/cart.js`) with `cache:'no-store'`. It always reconciles **every** badge (`#CartBubble` and `[data-fh-cart-bubble]` — the redesigned header renders two). Only if `item_count` changed since the last read (initially the rendered `#CartBubble` count) does it re-render the drawer via `<cart-modal>.reloadContent()` (without opening it) and the `/cart` page section via the Section Rendering API (`reloadCartPageSection()`; effectively dead: the widget is never rendered on `/cart`, so `.section-main-cart` is never present where this code runs). It is **display-only**: it never POSTs, never adds, and never touches the chat. It sends no KPI event.

Note: this causes one same-origin GET of `window.routes.cart_url` (`/cart.js`) on **every page view where the widget mounts** (the initial `pageshow`; not on cart or checkout, not on `ai_advisor_excluded_templates`, not when `ai_advisor_enabled` is off or the shared secret is empty) plus one per focus/visibility change, even for visitors who never use Mo. This is cheap but not free.

---

## 12. How the admin KPI tab reads these events

> **Backend status (2026-10-04, after this chapter was written):** „Engagement“ is now „Geöffnet → geschrieben“ (sessions with `message_sent` ÷ sessions with `chat_opened`); the old denominator is shown as „Reichweite (Sitzungen)“. The Anmelde-Popup section has a per-session diagnosis that applies §12.1 (`classifySigninSession` in `src/lib/kpi-widget-events.mjs`). `/api/contact` takes the session from `x-ms-session` when the body has none. `POST /api/kpi` drops server-only event names. Release dates annotate the KPI tab (`src/lib/kpi-releases.mjs`). Live checks: `npm run verify:widget`, `npm run verify:live` (backend `docs/ROLLOUT_TODO.md` 1.11).

> **Backend status (2026-10-05):** „Seitenkontext auf Produktseiten“ (AD §5.1a, Beratung) reads the server-only `page_context_applied` / `page_context_answered` per session and joins the widget's `product_cta_clicked` (`samePage` not `true` = „andere Produkte“), `add_to_cart_clicked`, `product_cta_opened` / `nudge_clicked` (primed before the first question) and `mo_orders` in fixed 24 h / 7 day windows; a comparison is shown only with a pre-registered control group. „Einwilligung nach der Anmeldung“ counts sessions with their final state and splits by `variant` × `placement`; the „E-Mail-Capture-Funnel“ counts the capture form only (OI1, rows below).

The backend dashboard (AD §5) consumes widget events as follows. These observations come from reading `src/lib/kpi-store.ts`, `src/lib/kpi-widget-events.mjs` and `src/lib/kpi-event-patterns.mjs` in the backend repo. The click patterns (`CTA_PATTERNS`, `CART_PATTERNS`) are defined once in `kpi-event-patterns.mjs` and imported by `kpi-store.ts` (KPI tab), `src/lib/admin-conversations.ts` (Gespräche inspector) and `src/lib/analytics-report-store.ts` (Komplettanalyse).

| Dashboard figure | Reads | Fit with the widget today |
| --- | --- | --- |
| **Produkt-/CTA-Klicks** (AD §5.1) | `event ILIKE '%product%click%' OR '%cta%click%'` | Matches `product_cta_clicked` only. It does **not** match `product_cta_opened` (storefront CTA), `showroom_clicked` or `nudge_clicked`, which is correct. |
| **Add-to-Cart-Klicks** | `event ILIKE '%cart%' OR '%checkout%'` | Matches `add_to_cart_clicked` only. Any future event name containing "cart" or "checkout" (e.g. `cart_refreshed`, `storefront_add_to_cart`) **will be counted here**. It also marks the session as "carted" in the Gespräche inspector (`admin-conversations.ts → loadSessionSignals()`, `cartUsed`) and in the Komplettanalyse (`analytics-report-store.ts`), which use the same `CART_PATTERNS`. Name new events with this pattern in mind or adjust the pattern in `kpi-event-patterns.mjs`. |
| **Engagement** = chats ÷ `count(DISTINCT session_id)` in `kpi_events` | all session-keyed events | AD assumes "any telemetry implies the widget was opened". **That is false:** `launcher_attention_played` (and `nudge_shown`) fire without any open. The denominator is closer to "devices that loaded the widget with motion allowed" plus server sign-in events, so the ratio is a reach-based rate, not open → message. Use `chat_opened` sessions as the denominator for an open → message rate. The numerator is inflated too: a completed greeting-only turn (nudge click with context, §7.5) is persisted by `persistTurn()` in `/api/chat` `onFinish` and creates a `conversations` row (`message_count` 1) although the visitor sent nothing (§14.3). |
| **Anmelde-Popup** (AD §5.7a) | `login_gate_*`, `account_signin_started.source`, server `account_signin_succeeded/linked` per session | Matches the widget. The source split is only `login_gate` vs `other` (§13). |
| **Einwilligung nach der Anmeldung** (AD §5.7) | `consent_gate_*` with `data.surface` | Matches. It counts taps, not DOI. **2026-10-05:** per session with the final state (accepted > declined > dismissed); DOI per variant and placement in „Nach Variante und Platzierung“ once the widget sends `variant` / `placement`. |
| **E-Mail-Capture-Funnel** (AD §5.8) | server events + widget `email_capture_declined` | **2026-10-05:** capture form only (server `source`), declines deduped per session and `trigger`, DOI rate ÷ „DOI-Mail fällig“ (OI1). Declines from the header share card have no `trigger`. One stored offer can be declined again on every later page (the card is rebuilt from history, the decline is not stored), so declines can exceed asks: count distinct sessions or dedupe per `trigger`. For signed-in customers the card is hidden (`buildToolCard()`), so a server `ask_shown` may have had no visible card (§4.7). |
| **Kundenkonto & Self-Service** (AD §5.15) | server events | `contact_form_submitted` is session-keyed once `8d0a0c4` is live (body `sessionId`, §4.10). Earlier rows have session `NULL`, so a per-session contact join only works for rows after that upload. |
| **Mo-zugeordneter Umsatz** (AD §5.16) | `mo_orders` from webhooks, `_mo` attribute | Depends on §10 coverage, including the permalink question. |
| Raw event breakdown | top 20 events by count | `launcher_attention_played` and `chat_opened`/`chat_closed` will dominate. Rarer events (e.g. `summary_downloaded`) can fall off the top 20. |

### 12.1 Debugging the sign-in funnel

The admin "Anmelde-Popup" funnel (AD §5.7a) joins widget and server events per `sessionId`. Use this table to explain a drop between steps. Widget behaviour is from `ms-chat-widget.js → presentLoginGate()`, `initiateLogin()`, `handleAuthReturn()`, `redeemLinkCode()`, `retryPendingLink()`, `earlyParam()`; backend events per AC §5 "Sign-in popup events" and CA §2/§2a. Details of the round trip: chapter 04 §4 and §9.

Expected sequence (same `sessionId`): `login_gate_shown` → `login_gate_signin_clicked` → `account_signin_started {source:'login_gate'}` → server `account_signin_succeeded` (callback) → widget `account_signin_return {result:'ok'}` + server `account_signin_linked` (code redeemed).

| # | Signature of the break | Cause |
| --- | --- | --- |
| 1 | `_signin_clicked`, then `login_gate_dismissed`, no `account_signin_started{source:'login_gate'}` | The reply was still streaming ("Antwort wird noch geladen…"), and the visitor pressed Esc or the backdrop during the wait. That clears `waitTimer`, so `initiateLogin()` never runs. (A hung stream does not block: the redirect happens after 20 s anyway.) |
| 2 | `_signin_clicked`, no `account_signin_started`, no `login_gate_dismissed` | `account_signin_started` was lost on navigation (keepalive + CORS preflight during unload, §2.2, §14.2), or the redirect threw (`initiateLogin()` catch logs `[ms-chat] sign-in redirect failed` to the console only). |
| 3 | `account_signin_started`, no server `account_signin_succeeded` | Abandoned at the Shopify login, or the backend refused the `return_url` origin (not allow-listed, e.g. a theme preview or `*.myshopify.com` domain; CA §2). |
| 4a | `succeeded`, then `account_signin_return{ok}`, but **no** `_linked` / `_link_refused`, and the chat stays anonymous | The return page ran a **pre-PR #73 widget**. That widget sends `return{ok}` on the marker alone and never redeems `ms_code`; since 2026-10-03 the backend requires the redeem, so the session is not signed in. This was the normal case on live from 2026-10-03 until the PR #73 upload on 2026-10-04. After that date it points to a live-editor revert or a stale cached asset. |
| 4b | `succeeded`, no `account_signin_return`, no `_linked` / `_link_refused` | The widget did not mount on the `return_url` page (excluded template, empty secret, script error), or the head-script stash was older than 10 min (`LINK_RETRY_MAX_MS`) when the next mounting page loaded. The head stash script in `layout/theme.liquid` is gated only on `ai_advisor_enabled`, so a non-mounting return page keeps the code in `sessionStorage['ms-chat-early-params']` for the next mounting page, or loses it. |
| 5 | `account_signin_return{link_failed}` **without** server `_link_refused` | The widget never called `/api/auth/link`: login-sid mismatch (`sessionStorage['ms-chat-login-sid'] !== sid`, e.g. another tab rotated the sid; `handleAuthReturn()` resolves `'refused'` locally), missing `ms_code` (`redeemLinkCode()` returns `'refused'` without a request), or localStorage unavailable (a new `sid` on every page load, so the return mismatches every time). |
| 6 | `link_failed` + server `_link_refused` | Backend 400 on `/api/auth/link`: code expired, already used, or `session_mismatch` (e.g. the login finished on another device). |
| 7 | `link_failed`, then a later `_linked` with no `return{ok}` | Backend 503/429/5xx or a network error on the redeem (`redeemLinkCode()` → `'unavailable'`): the code is kept in `sessionStorage['ms-chat-link-retry']` and `retryPendingLink()` redeems it silently **once**, on the next page load in the same tab (without an `?ms_auth` marker), only if the sid is unchanged and the code is under 10 min old (`LINK_RETRY_MAX_MS`). No second `account_signin_return` is sent. (The whoami shop-recognition path keeps its code the same way, with `kind:'shop'`.) |
| 8 | `return{ok}` + `_linked`, but the UI stays anonymous | A transient `/api/auth/me` failure after the redeem (04 §18 items 3–4). |

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
| **Contact form shown / abandoned** (the submit itself is session-keyed since `8d0a0c4`, §4.10) | The submit now joins the session, but there is still no widget event for "form shown", so `show_contact_form` → submit needs the server's tool-call record as the denominator. | `buildContactForm()` |
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
| Storefront CTA | `product_cta_opened` → `message_sent` → `product_cta_clicked` / `add_to_cart_clicked` | Numeric vs catalog ids. Template coverage grows when the three templates of `8d0a0c4` go live (§8.1): compare periods before and after that upload with care. |
| Recommendation → click | server tool calls (`show_product`, `compare_products`, `add_to_cart`; `recommended_product_ids`) → `product_cta_clicked` / `add_to_cart_clicked` | Server tool calls ≠ rendered cards. |
| Click → order | `add_to_cart_clicked` / `product_cta_clicked` → `mo_orders` tier by session/token | Permalink and consent coverage (§10.3). |
| Sign-in popup | `login_gate_shown` → `_signin_clicked` → `account_signin_started{source}` → server `succeeded` → `linked`, plus `account_signin_return.result` | Already on the dashboard (AD §5.7a). Real `linked` data only from the PR #73 upload on 2026-10-04 (from 2026-10-03 until then, sign-ins were not linked and the widget's `return{ok}` was inflated, §12.1 row 4a). |
| Consent gate | `consent_gate_shown` → `_accepted` / `_declined` / `_dismissed` → server `email_capture_marketing_opted_in{trigger:'signin_optin'}` → `_confirmed` | Accept = tap, not DOI. Needs signed-in sessions, so data starts on 2026-10-04 (PR #73 live). On the dashboard since 2026-10-05 per session and, with the widget's `variant` / `placement`, per variant (AD §5.7). |
| Email capture | server `email_capture_ask_shown{trigger, askNumber}` → widget `email_capture_declined` / server `_submitted` → `_marketing_opted_in` → `_confirmed` | Header-share captures sit outside the ask counts. Since 2026-10-05 `source` / `outcome` split the opt-ins (new DOI / already subscribed / suppressed) and `_confirmed` carries `source`. |
| Campaign | server `campaign_email_clicked` → `campaign_chat_started` (both session-less, joined by `sendId`) | The open step is missing (no deep-link event). |
| Voice | `voice_mode_on` → `voice_reply_played` → `voice_mode_off` | Off includes automatic offs. Plays may double count. |
| Self-service | `account_export_started` → `account_exported`; `summary_download_started` → `summary_downloaded`; `account_history_opened` → `conversation_opened` | History opens include automatic opens. Signed-in only, so data starts on 2026-10-04. |
| Contact form | server `show_contact_form` tool call → server `contact_form_submitted` (per `sessionId`) | Session-keyed only for submits after the `8d0a0c4` upload (§4.10). No widget event for "form shown". |

### 13.3 Legal and privacy constraints that apply to every idea below

- **No message text, no emails, no product names** in `track()` payloads (privacy posture in `ms-chat-widget.js`, WIDGET_SPEC §9b/§9c). Ids and enums only.
- **Tone rule** for proactive copy: reference the page or category, never the visitor's behaviour.
- **Marketing consent UI:** the legal text is backend-served and rendered verbatim (`consentTextShown` echoed byte-for-byte), shown only if `lawyerApproved === true`. Nothing is pre-ticked, decline is equally prominent, and the nudge never asks for an email (CONSENT_FLOW.md). Any A/B variant needs its own approved copy. The consent popup's accept rate rests on `consent_gate_shown` as its denominator (a widget event, per session since 2026-10-05), so the § 25 TDDDG question below applies to it too; per-session variant assignment (`CONSENT_SIGNIN_VARIANTS`) adds to that question (07 §8).
- **Attribution and analytics consent:** the `_mo` stamp requires `analyticsProcessingAllowed()`. Open legal question (not decided here): `track()` itself is not consent-gated, and the sid is written to localStorage on the first page load for every visitor (§3.1). Under § 25 TDDDG, storing/reading device data for non-essential analytics usually needs consent. More "silent" events (widget-load, impressions) increase that exposure. **Ask the lawyer before adding interaction-free events**, or gate them on the same `analyticsProcessingAllowed()` check.
- **Campaign token:** keep it out of KPI payloads, and keep `campaign_chat_started` session-less unless legal agrees otherwise.
- **Deployment:** every widget change needs a manual upload to the live theme, and template blocks can be overwritten by the live editor (chapter 01 §16). Plan for drift checks after each upload.

### 13.4 Ideas to raise each KPI

Effort: **S** = < ½ day widget change, no new endpoint. **M** = 1–3 days or needs a small backend addition. **L** = new UI flow and/or several backend changes.

#### Opt-in rate (marketing consent)

| Idea | What changes | Effort | Constraint |
| --- | --- | --- | --- |
| Send `askNumber` on `email_capture_declined` (allowed by AC §5) | The tool input does not carry `askNumber` today (`offer_email_summary` input is only `{message, trigger, productIds}`; the server computes `askNumber` in `/api/chat` `onFinish` and writes it only to `email_capture_ask_shown`). Either the backend adds `askNumber` to the tool input or output and the widget passes it through `buildCaptureCard` → `email_capture_declined`, or the widget counts prior `tool-offer_email_summary` parts in `messages`, which must match the server's `countEmailSummaryOffers()`. | M | Backend + widget change. |
| Variant id on consent events | Backend serves `variant` with the consent copy, and the widget adds it to `consent_gate_*` | M | Every variant must be `lawyerApproved`. **Backend built 2026-10-05** (OI3: `variant` + served `benefits`, `CONSENT_SIGNIN_VARIANTS`, dashboard block); widget part is frontend task 1. |
| Ask at a value moment instead of only after the first message | After the first `add_to_cart_clicked` or the second product card for signed-in customers, re-use `presentSignInOptIn()` (still once per tab session) | M | Same consent rules; must not stack with the popup. |
| Measure DOI completion per surface | **Done server-side 2026-10-05** (OI1: opt-ins and `_confirmed` carry `source`). Popup vs card: the backend accepts `placement` on the opt-in POST and the `consent_gate_*` data (OI3); the widget sends it with frontend task 1. | S | — |

#### Sign-in rate

| Idea | What changes | Effort | Constraint |
| --- | --- | --- | --- |
| Tag every sign-in entry | `initiateLogin('welcome_card' \| 'header' \| 'account_menu' \| 'link_failed')` (callers: `buildSignInCard()` button, header `signInBtn`, drawer `shopSignInBtn` "Mit Kundenkonto anmelden", `showLinkFailedNotice()`), and extend `SIGNIN_SOURCES` / `signinSource()` in `src/lib/kpi-widget-events.mjs` (today `login_gate` vs `other`) | S | Backend contract change (AC §5 currently defines only `login_gate`). |
| Contextual sign-in card when Mo needs the account (order questions → `get_order_status` `sign_in_required`) | A visible tool / card that calls `initiateLogin('order_status')` | M | Needs `CHAT_ORDER_STATUS_ENABLED` (still off; may be turned on now that PR #73 is live, once the backend has verified on live that `get_order_status` renders nothing). |
| Popup timing test (after the first **answered** reply or after the first product card instead of 0.7 s after send) | `maybeShowConsentGate()` scheduling | S–M | Keep "never in voice mode", once per tab session, real "Später". |
| Silent shop recognition | PR #73 is merged and live since 2026-10-04, so chat sign-in works again (pending a live check). Next: set up the Shopify App Proxy for `/apps/chat/whoami`, which turns shop-logged-in visitors into signed-in chat users with no click. Backend built 2026-10-05 (P0.3): code only when the session will be signed in, `account_shop_recognised` measures every recognition, AD §5.15 „Shop-Login-Erkennung“ shows it; every shop-logged-in visitor only with `APP_PROXY_SIGNIN_ENABLED=true` and `APP_PROXY_SIGNIN_MAX_AGE_HOURS=24` (D-AP1), otherwise only chat-token holders | Ops | Proxy setup is in Shopify admin, not theme code. First confirm that the live widget is the PR #73 version (it contains `redeemLinkCode`). Historical note: the pre-PR #73 widget (`44a076b`, `detectViaStorefront()`) applied a whoami `signedIn:true` answer directly as identity (`applyAuth(data)`) without redeeming a `linkCode`, so the proxy must never run under that widget (e.g. after a live-editor revert). |

#### Product CTR

| Idea | What changes | Effort | Constraint |
| --- | --- | --- | --- |
| Card impression events (`product_card_shown {productId, surface}`) | Builders in §13.1 | S | Ids only. |
| `surface` on `product_cta_clicked` | `productButton()` | S | The dashboard pattern still matches. |
| Larger hit area: thumbnail and name link to the product | `buildShowProduct()` | S | — |
| Track Markdown shop links (`text_link_clicked {kind:'product' \| 'page'}`) | Markdown link renderer | S | No URL text if it could hold query PII; send only the kind and the catalog id when resolvable. |
| Open product pages in the same tab on mobile (the current new tab loses the chat context visually) | `productButton()` target per device | S | Check the effect on `chat_opened` counts (re-open on the new page). |

#### Add-to-cart / checkout

| Idea | What changes | Effort | Constraint |
| --- | --- | --- | --- |
| "In den Warenkorb" next to/instead of the permalink: `POST /cart/add.js` same-origin, then `<cart-modal>` / `#CartBubble` update (the theme primitives already used in §11) | `buildAddToCart()` / `buildShowProduct()` | M | Must handle variants (`selectedVariantId`, AC §3) and sold-out. It keeps the shopper on site **and** keeps the `_mo` stamp on the live cart. |
| Listen to the theme's `product:added-to-cart` and send `storefront_add_to_cart {consulted:true}` only for consulted sessions | `init()` listener | S | Name it so the AD cart pattern counts it deliberately, or rename to avoid double counting. `detail.id` is probably a variant id (unverified). |
| Error telemetry for a failed `/api/products` fetch in the add-to-cart card (currently renders nothing) | `buildAddToCart()` `.catch` | S | — |

#### Attributed revenue

| Idea | What changes | Effort | Constraint |
| --- | --- | --- | --- |
| Carry `_mo` on the permalink: append `attributes[_mo]=<token>` to `cartUrl` on click when the token is cached and consent allows (or let `/api/products` accept a flag to embed it) | `buildAddToCart()` click handler (mint first if needed) | S (widget) / M (backend variant) | Same consent gate as the stamp. Verify first that permalinks drop live-cart attributes (§14). |
| Mark sessions as consulted on `compare_products` and `add_to_cart` render, not only `show_product` | call `moAttrOnProductCard()` in `buildCompare()` / `buildAddToCart()` | S | Consent-gated as today. |
| Re-stamp on the theme's `product:added-to-cart` | `init()` listener → `moAttrEnsure(true)` with the page-stamp guard reset | S | Consent-gated. |
| Attribution coverage flag (`attribution_state {consent: bool, stamped: bool}` once per tab session) | `initAttribution()` | S | Itself analytics. Gate it or get legal approval (§13.3). |

#### Campaign chats

| Idea | What changes | Effort | Constraint |
| --- | --- | --- | --- |
| `deeplink_opened {campaign: bool, fresh: bool, fullscreen: bool}` | `handleMoDeepLink()` | S | Never the token itself. |
| Campaign-aware greeting: when `mo=open` and a token is present, send a context greeting (`messages: []`) with a new `context.type:'campaign'` | `handleMoDeepLink()` + backend context type | M | Then every landing becomes a "campaign chat". Redefine the KPI honestly (greeting ≠ visitor message). |
| Keep the token until the first message even across a tab close (currently sessionStorage only) | storage choice | S | Privacy decision: the current design deliberately limits the token's lifetime. |

#### Engagement and retention

| Idea | What changes | Effort | Constraint |
| --- | --- | --- | --- |
| `chat_opened {source, returning}` | `openPanel()` callers | S | `returning` derived locally (history exists). |
| Mobile nudge on home/collection via scroll or dwell (today home never nudges on mobile) | `initNudgeTriggers()` | S | Keep once per tab session and the permanent ×. |
| Reword the behaviour-referencing streak copy | `nudgeCopy()` | S | Tone rule. |
| Returning anonymous visitor with a stored thread: launcher badge or nudge copy "Weiter mit deiner Beratung" | `nudgeCopy()` / launcher | S–M | Local only, with no behaviour reference beyond "your consultation". |
| Visit-level KPI: a once-per-tab-session `widget_loaded {pageType, device}` | `init()` | S | Interaction-free → legal check (§13.3). Also affects the AD "Engagement" denominator. |

---

## 14. Open questions / uncertainties

1. **Cart permalinks vs `_mo`:** does a Shopify cart permalink (`/cart/<variant>:<qty>`) keep the attributes stamped on the existing cart via `/cart/update.js`? The code does not tell. Shopify documents permalinks as building their own cart, so the attribute is probably lost for Mo's "Zur Kasse" checkouts. Verify with one test order in the admin (order `note_attributes`).
2. **keepalive + CORS preflight on navigation:** `account_signin_started` fires right before `location.assign()`. Whether every target browser completes a preflighted `keepalive` request during unload is not verifiable from the code. Compare `login_gate_signin_clicked` vs `account_signin_started{source:'login_gate'}` vs `account_signin_succeeded` counts per session to detect loss.
3. **Greeting-only turns (resolved):** yes, they count as chats. A greeting-only turn (`messages: []`, nudge click with context) skips the eager `ensureConversationStarted` (user turn required) but is persisted by `persistTurn()` in `/api/chat` `onFinish` (`src/lib/conversation-store.ts`: `INSERT INTO conversations … ON CONFLICT (conversation_key) DO UPDATE`, no user-message guard, `messageCount = history.length + 1` = 1). It is counted in "Chats gesamt" and in the Engagement numerator although the visitor sent nothing. AD §5.1's "a conversation row only exists once a message is sent" does not hold for nudge greetings.
4. **`voice_reply_played` double count** on mid-reply streaming-TTS fallback is inferred from the control flow (`streamTtsFallback()` → `streamTtsDoFallback()`, immediately if the chat stream is done, else from `voiceAfterReply()` → `speakReply()`), not observed.
5. **"Consulted" ≠ interacted:** `moAttrConsulted` (and any idea in §13.4 keyed on it) is also set by product cards re-rendered from stored history on a plain page load (§10.2). Use an explicit interaction signal if a KPI must mean "engaged this visit".
6. **Theme `product:added-to-cart` `detail.id`** is assumed to be a variant id (from the minified `assets/main.mjs`). Unverified.
7. **§ 25 TDDDG exposure** of the unconditional sid and `track()` (including `launcher_attention_played`) is a legal question, not a code fact. It is raised here so that new interaction-free events are not added without a decision.
8. **Live theme state:** this chapter documents `main` at `8d0a0c4`. PR #73 was uploaded on 2026-10-04 (widget JS/CSS and `layout/theme.liquid`); the `8d0a0c4` fixes (widget JS, `snippets/ms-chat-widget.liquid`, three product templates) are not uploaded yet. The live theme can also differ through live-editor drift. The "MO only" blocks, the CTA in `product.produktdesign-02.json` and the head stash script in `layout/theme.liquid` are all in files the live editor can change. Whether the PR #73 upload really runs on live still needs one real sign-in check by the backend.
9. The task brief mentioned a **copy-selection nudge trigger**. No such trigger exists in `ms-chat-widget.js`. If it is planned, it is not implemented.
