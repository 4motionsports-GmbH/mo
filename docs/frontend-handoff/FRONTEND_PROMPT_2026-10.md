# Frontend task — the customer platform (October 2026, second version)

Paste this into the frontend coding agent that owns the Shopify theme (`ms_shopify_clone`) and
the Mo chat widget (`assets/ms-chat-widget.js`). Attach the files of `docs/frontend-handoff/` —
they are the contract; the backend repo is not needed. This version replaces the first one
(same file name, 03.10.2026): it builds on the widget of **2026-10-01** and drops what that
widget made obsolete.

---

You maintain the motionsports.de Shopify theme and its Mo chat widget. Your widget update of
2026-10-01 is in: the sign-in popup for anonymous visitors, the consent popup after sign-in, the
starter prompts removed and the campaign deep link (`?mo=open`, `#mo-open`, `mo_new`, `mo_view`)
working again. This task finishes the customer platform on top of it. The exact request and
response shapes are in the attached files: `CUSTOMER_ACCOUNT.md` §2a, §3a, §4, §6, §7.5,
`CONSENT_FLOW.md` §1, §3, §4, `CHAT_ORDER_STATUS.md` and the canonical `API_CONTRACT.md`
(§2, §5, §7, §11). Where this prompt and those files disagree, the files win.

## Backend reply to your note of 2026-10-01

- **Your KPI events work as sent.** `POST /api/kpi` has no event allowlist and does not validate
  `data`; `login_gate_shown` / `_signin_clicked` / `_declined` / `_dismissed`,
  `account_signin_started` with `{ source: "login_gate" }`, `account_signin_return` and
  `consent_gate_*` with `{ surface: "signin" }` are stored as they are. Nothing to rename.
- **Dashboard:** new KPI section „Anmelde-Popup“ (per session: shown → „Anmelden“ → signed in at
  Shopify → signed in in the chat, plus „Später“ / dismissed rates and sign-in starts by source);
  the consent section now shows only the gate after sign-in (`surface: signin`), separate from
  the other opt-in sources; `starter_shown` / `starter_clicked` are marked „eingestellt“ and
  nothing alerts on them.
- **The funnel joins by session.** The popup events are joined to the server's
  `account_signin_succeeded` (Shopify callback) and the new `account_signin_linked` (the chat
  redeemed the one-time code). So the `sessionId` in your KPI events, the `x-ms-session` header
  and the `session` in the login URL must be the **same** id. The backend now writes
  `account_signin_linked` and `account_signin_link_refused` itself — never send them.
- **What changed in the backend since your update** and is not in the widget yet: the one-time
  sign-in code (task 1 — without it nobody is signed in in the chat any more), the
  „already subscribed“ answers (task 2), the erase copy (task 3), the campaign token `mo_c`
  (task 4), the shop sign-in detection (task 5) and the silent order-status tool (task 6).
- **Not used by the widget any more, and fine that way:** `GET /api/consent-copy?surface=chat`
  (including its `signIn` object) and `POST /api/chat-marketing-opt-in`. They stay in the
  backend; don't reintroduce the anonymous e-mail gate.

## Rules that do not change (legally load-bearing)

- Consent text comes only from `GET {BASE_URL}/api/consent-copy` — never hard-code it. Render
  `marketingLabel` and `consentFooter` fully visible, nothing pre-selected, decline as easy to
  reach as accept, and echo `consentTextShown` verbatim in the POST.
- The marketing POST fires only on the explicit accept tap (`marketingConsent: true`).
- Every backend call keeps today's headers (`x-ms-chat-key`, `x-ms-session`, browser `Origin`)
  and `?locale=en` on `/en`. Sign-in stays a top-level redirect (no popup window, no XHR login).
- The sign-in popup is UI, not consent — its text may live in the widget; the consent popup's
  text may not.

## 1. Complete every sign-in with the one-time code (required — security fix of 03.10.2026, do it first)

Since 03.10.2026 a sign-in no longer signs the chat in by itself (a stranger could otherwise plant
their own session id in a login link). This applies to every „Anmelden“ — the popup, the welcome
screen and the header. Implement `CUSTOMER_ACCOUNT.md` §2a:

- The login URL stays `{BASE_URL}/api/auth/shopify/login?session={session_id}&return_url={page}`.
- On the return, `?ms_auth=ok` comes with `?ms_code=<code>`. **Before** `/api/auth/me`, send
  `POST {BASE_URL}/api/auth/link` with `{ "code": "<ms_code>" }` and the usual widget headers,
  **with `x-ms-session` = the session id the login used**. Then strip `ms_auth` and `ms_code`
  from the address bar (`history.replaceState`) and call `/api/auth/me` as before.
- `200 { ok: true, signedIn: true }` → signed in. `400` (expired, used, another session's code)
  → stay anonymous and offer „Anmelden“ again; never retry with another session id. `503` →
  stay anonymous, try again on the next page load.
- Send `account_signin_return` after this step, so its `result` means the chat really is
  signed in: `"ok"` only after the `200`; otherwise the marker (`"error"`, `"login_required"`) or
  `"link_failed"` for a `400`/`503`.
- The session id must survive the redirect (same tab → `sessionStorage` is fine). Send
  `login_gate_signin_clicked` and `account_signin_started` with `fetch(…, { keepalive: true })`
  before navigating, so they are not lost with the page (not `sendBeacon`: it cannot send JSON
  cross-origin).

Until this ships, „Anmelden“ returns to the shop but the chat stays signed out — history, export,
deletion, the consent popup and the order status are all off.

## 2. Consent popup after sign-in: only for people who have not decided

Keep your popup (`GET /api/consent-copy?surface=signin` → „Ja, Angebote aktivieren“ →
`POST /api/account/marketing-opt-in`, KPI `consent_gate_*` with `{ surface: "signin" }`), with
these rules (`CUSTOMER_ACCOUNT.md` §6.1, `CONSENT_FLOW.md` §3):

- Show it — and the inline card after a mid-conversation sign-in — **only** when `/api/auth/me`
  answers `signedIn: true` **and** `marketing.optInActionable === true`, i.e. after task 1.
  `marketing.status` is the one consent shared with the shop: someone subscribed in the shop
  reads `"confirmed"` with `optInActionable: false` and must not be asked.
- The backend does not record a „Nein“, so `optInActionable` stays `true` after it. Remember a
  decline on the device (for example 30 days, like your 24 h snooze of the sign-in popup) and a
  dismissal for the session, so nobody is asked at every sign-in.
- **„Already subscribed“ answer.** `POST /api/account/marketing-opt-in` (and the capture form's
  `POST /api/capture-email`) can answer
  `marketing: { status: "confirmed", alreadyConfirmed: true, doiEmailSent: false }`. Then no
  e-mail was sent: do **not** show „check your inbox“, show e.g. DE „Du bist bereits für unsere
  Angebote angemeldet — es ist nichts weiter zu tun.“ / EN "You're already subscribed — nothing
  else to do." Keep „check your inbox“ for `status: "pending"` with `doiEmailSent: true`.
- For `identity.tier === 3` keep suppressing the end-of-chat e-mail capture card
  (`CUSTOMER_ACCOUNT.md` §6.0).

## 3. "Delete my data" reaches the shop

In the signed-in account panel, before `POST /api/account/erase`, fetch
`GET /api/consent-copy?surface=erase` and build the confirmation from it: `confirmHeading`,
`confirmBody`, a destructive button `confirmButton` and a cancel. Never hard-code the body: it
mentions the shop customer account only when the backend also deletes it there. On `200`, show
`doneHeading` and `doneBody`, then clear every signed-in state immediately (`/api/auth/me` now
answers `signedIn: false`, every `/api/account/*` call returns 401) and remove the stored chat
history of the session. On `503`, show `failedBody` and allow a retry. The response shape is
unchanged: `{ ok, erased, deletedConversations }`.

## 4. Campaign link attribution (`mo_c`)

Campaign e-mails link to the storefront with the deep link you restored
(`?mo=open&mo_new=1&mo_view=fullscreen&utm_…`) plus `mo_c=<token>`. On page load, **before** the
theme strips the `mo*` parameters:

- Read `mo_c`. Keep it only if it matches `^[A-Za-z0-9_-]{16,64}$`. Store it in `sessionStorage`
  (`ms_mo_c`) and remove it from the address bar (`history.replaceState`), leaving the other
  parameters as they are.
- Send it as `campaignToken` (string) in the JSON body of the **first** `POST /api/chat` of that
  session, next to `messages`, `conversationKey` and `locale`. Then remove it from
  `sessionStorage`.

The backend counts it once per send and never ties it to the chat; an invalid or unknown token is
ignored without an error. Don't put it in `localStorage`, cookies or KPI payloads.

## 5. Recognise customers already signed in to the shop (`/apps/chat/whoami`)

Implement `CUSTOMER_ACCOUNT.md` §3a: on the first panel open of a session, call the
**same-origin** storefront path `/apps/chat/whoami?session={session_id}`
(`credentials: "include"`, not the backend origin). When it answers JSON with `signedIn: true`,
redeem its `linkCode` exactly like task 1, then treat the visitor like a `/api/auth/me` sign-in
(name, tier 3, task 2's consent rule) and don't show the sign-in popup. On anything else — 404, an
HTML page, a network error, `signedIn: false` — fall back silently to today's flow. The shop's App
Proxy is not set up yet, so today the call returns Shopify's 404 page; the fallback must make that
invisible. Never send the answer anywhere else; never retry in a loop.

## 6. Stay silent on `get_order_status`; clear the history on logout

Signed-in customers can ask Mo about their orders. Mo looks them up with a background tool,
`get_order_status`, and answers in its text (`CHAT_ORDER_STATUS.md`). Render **nothing** for this
tool — no card, no placeholder, no error — exactly like `search_products`, and in general render
nothing for any tool name the widget does not know. Its output contains the customer's order
status, so on logout (and after „Meine Daten löschen“) also remove the stored chat history of that
session — the next person on a shared browser must not see it. Keep „Anmelden“ reachable for a
visitor recognised through `/apps/chat/whoami` (task 5), e.g. in the account menu: the order
status needs the chat sign-in once. The backend switch stays off until this is confirmed on the
live widget.

## Acceptance checklist

- [ ] Popup „Anmelden“ → shop login → back on the same page: the widget redeems `ms_code` at
      `POST /api/auth/link` with its own `x-ms-session` **before** `/api/auth/me`; the address bar
      shows neither `ms_auth` nor `ms_code`; the chat is signed in; `account_signin_return` says
      `"ok"`. The same from the welcome screen and the header.
- [ ] A second redeem of the same code answers `400`; a login link started with ANOTHER session id
      leaves the chat signed out (`"link_failed"`).
- [ ] In Mo's admin → KPIs → „Anmelde-Popup“, a test sign-in from the popup shows up in every stage
      up to „Im Chat angemeldet“ (same session id everywhere).
- [ ] A customer subscribed in the shop sees no consent popup; one who never decided sees it;
      after „Nein“ they are not asked again on that device for the remembered period.
- [ ] Accepting with an address that is already subscribed shows „already subscribed“, not
      „check your inbox“.
- [ ] „Meine Daten löschen“ shows the served copy, then the done state, and leaves no signed-in UI
      and no stored history behind.
- [ ] `/?mo=open&mo_c=<token>` opens the chat, sends `campaignToken` once on the first turn, and
      the address bar no longer shows `mo_c`.
- [ ] `/apps/chat/whoami` is called once per session on first open; while it returns Shopify's 404
      page nothing visible changes.
- [ ] A `get_order_status` tool part (and any unknown tool name) renders nothing; after logout the
      stored chat history of that session is gone.
- [ ] `/en` uses `?locale=en` everywhere; no `starter_*` events; no anonymous e-mail gate; no new
      hard-coded legal text; no consent pre-selection.
- [ ] Screenshots in DE and EN: the sign-in popup, the consent popup, the „already subscribed“
      state and the erase dialog.
