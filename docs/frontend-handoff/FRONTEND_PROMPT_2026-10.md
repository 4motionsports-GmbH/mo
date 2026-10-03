# Frontend task — the customer platform (October 2026)

Paste this into the frontend coding agent that owns the Shopify theme and the Mo chat widget.
Attach the files of `docs/frontend-handoff/` (they are the contract; the backend repo is not
needed). Everything below is additive: a widget that ignores it keeps working.

---

You maintain the motionsports.de Shopify theme and its Mo chat widget. The backend (Mo) changed
how marketing consent, sign-in and data deletion work. Shop and Mo now share **one** e-mail
marketing consent and **one** deletion: whoever subscribes or unsubscribes in the shop or in the
chat is subscribed or unsubscribed in both, and a deletion in one deletes in both. The chat
should lead people to sign in with their shop account (or give the marketing consent) instead of
typing an e-mail address. Implement the seven changes below (task 7 is a security fix and comes first). The exact request and response
shapes are in the attached handoff files: `API_CONTRACT.md` (2026-10 change table at the top),
`CONSENT_FLOW.md` §2–§4, `CUSTOMER_ACCOUNT.md` §2, §3, §4, §6 and §7.5. Where this prompt and
those files disagree, the files win.

## Rules that do not change (legally load-bearing)

- Consent text comes only from `GET {BASE_URL}/api/consent-copy` — never hard-code it. Render
  `marketingLabel` and `consentFooter` fully visible, nothing pre-selected, decline as easy to
  reach as accept, and echo `consentTextShown` verbatim in the POST. The new `signIn` strings
  are UI chrome and must never become part of `consentTextShown`.
- The marketing POST fires only on the explicit accept tap (`marketingConsent: true`).
- Every backend call keeps today's headers (`x-ms-chat-key`, `x-ms-session`, browser `Origin`)
  and `?locale=en` on `/en`. Sign-in stays a top-level redirect (no popup, no XHR).

## 1. Chat consent gate: sign-in first

`GET /api/consent-copy?surface=chat` now returns an additional `signIn` object:
`{ preferred, headline, body, buttonLabel, alternativeLabel, loginPath }`.

When `signIn.preferred` is true, render the gate (still once per session, after the first user
message, anonymous users only) in this order:

1. The sign-in block: `signIn.headline`, `signIn.body` and a primary button
   `signIn.buttonLabel`. The button navigates the top-level window to
   `{BASE_URL}{signIn.loginPath}?session={session_id}&return_url={current storefront URL}`, the
   same login as `CUSTOMER_ACCOUNT.md` §2. Optionally emit the KPI event
   `consent_gate_signin_clicked` with `{ surface: "chat" }` through `POST /api/kpi`.
2. Behind `signIn.alternativeLabel` (a secondary link or button that expands), the existing
   typed-e-mail consent block: `headline`, e-mail field, `marketingLabel`, `consentFooter`,
   imprint and privacy links, „Ja, Angebote aktivieren“ and the decline. It submits to
   `POST /api/chat-marketing-opt-in` exactly as today.

Keep the existing KPI events (`consent_gate_shown` / `_accepted` / `_declined` / `_dismissed`,
`{ surface: "chat" }`).

## 2. After sign-in: ask only people who have not decided

On return with `?ms_auth=ok`, strip the parameter (`history.replaceState`) and call
`GET /api/auth/me`. `marketing.status` now reflects the one consent: someone subscribed in the
shop reads `"confirmed"`. Show the at-sign-in opt-in card (`GET /api/consent-copy?surface=signin`
→ „Ja, Angebote aktivieren“ → `POST /api/account/marketing-opt-in`) **only** when
`signedIn === true && marketing.optInActionable === true`. For `identity.tier === 3`, keep
suppressing the end-of-chat e-mail capture card (`CUSTOMER_ACCOUNT.md` §6.0). `?ms_auth=error`
or `login_required` leaves the visitor anonymous; the typed-e-mail path stays available.

## 3. "Already subscribed" answers

`POST /api/capture-email`, `POST /api/chat-marketing-opt-in` and
`POST /api/account/marketing-opt-in` can now answer
`marketing: { status: "confirmed", alreadyConfirmed: true, doiEmailSent: false }` when the
address already holds the consent (from the shop or an earlier confirmation). Then no
confirmation e-mail was sent, so do **not** show "check your inbox". Show a short
confirmation instead, for example DE „Du bist bereits für unsere Angebote angemeldet — es ist
nichts weiter zu tun.“ and EN "You're already subscribed — nothing else to do." Keep the
"check your inbox" message for `status: "pending"` with `doiEmailSent: true`.

## 4. "Delete my data" reaches the shop

In the signed-in account panel, before `POST /api/account/erase`, fetch
`GET /api/consent-copy?surface=erase` and build the confirmation from it: `confirmHeading`,
`confirmBody`, a destructive button `confirmButton` and a cancel. Never hard-code the body: it
mentions the shop customer account only when the backend also deletes it there. On `200`, show
`doneHeading` and `doneBody`, then clear every signed-in state immediately (`/api/auth/me` now
answers `signedIn: false`, and every `/api/account/*` call returns 401). Optionally offer the
Shopify logout (`CUSTOMER_ACCOUNT.md` §5). On `503`, show `failedBody` and allow a retry. The
response shape is unchanged: `{ ok, erased, deletedConversations }`.

## 5. Campaign link attribution (`mo_c`)

Campaign e-mails link to the storefront with the Mo deep link (`?mo=open&mo_new=1&…`) plus
`mo_c=<token>`. On page load:

- Read `mo_c` from the URL. Keep it only if it matches `^[A-Za-z0-9_-]{16,64}$`. Store it in
  `sessionStorage` (`ms_mo_c`) and remove it from the address bar (`history.replaceState`),
  leaving the other parameters as they are.
- Send it as `campaignToken` (string) in the JSON body of the **first** `POST /api/chat` of
  that session, next to `messages`, `conversationKey` and `locale`. Then remove it from
  `sessionStorage`.

The backend records it once per send and never ties it to the chat; an invalid or unknown token
is ignored without an error. Don't put it in `localStorage`, cookies or KPI payloads.

## 6. Recognise customers already signed in to the shop (`/apps/chat/whoami`)

A customer who signed in through the shop's own login should be recognised in the chat
without pressing „Anmelden“. Implement `CUSTOMER_ACCOUNT.md` §3a: on the first panel open
of a session, call the **same-origin** storefront path
`/apps/chat/whoami?session={session_id}` (`credentials: "include"`, not the backend
origin). When it answers JSON with `signedIn: true`, treat the visitor exactly like a
`/api/auth/me` sign-in (name, tier 3, `marketing` → task 2's opt-in rule) and skip the
sign-in block of task 1. On anything else — 404, an HTML page, a network error,
`signedIn: false` — fall back silently to today's flow (`/api/auth/me`). The store's App
Proxy is not set up yet, so today the call returns Shopify's 404 page; the fallback must
make that invisible. Never send the answer anywhere else; never retry in a loop.

## 7. Complete every sign-in with the one-time code (required — security fix of 03.10.2026)

Since 03.10.2026 a sign-in no longer links the chat session on its own (a stranger could
otherwise plant their own session id in a login link). Implement `CUSTOMER_ACCOUNT.md` §2a:

- On the return from the sign-in, `?ms_auth=ok` comes with `?ms_code=<code>`. Before calling
  `/api/auth/me`, send `POST {BASE_URL}/api/auth/link` with `{ "code": "<ms_code>" }` and the
  usual widget headers, **including `x-ms-session` = the same session id the login used**.
  Then strip `ms_auth` and `ms_code` from the address bar and continue as today.
- When `/apps/chat/whoami` (task 6) answers `signedIn: true`, it carries `linkCode`: redeem it
  the same way before using history, export or deletion.
- `400` from `/api/auth/link` (expired, used, or another session): stay anonymous and show
  „Anmelden“ again. Never retry with another session id.

Until this ships, „Anmelden“ in the chat returns to the shop but the chat stays signed out —
nothing breaks, the account features are just off.

## Acceptance checklist

- [ ] Anonymous visitor, first message: the gate shows the sign-in block first; the e-mail block
      opens from `alternativeLabel`; nothing is pre-selected; `consentTextShown` has no `signIn`
      text.
- [ ] The sign-in button lands on the shop login and returns to the same page with
      `?ms_auth=ok`; a customer subscribed in the shop sees no opt-in card; a customer who never
      decided sees it.
- [ ] Typing an already subscribed address shows "already subscribed", not "check your inbox".
- [ ] „Meine Daten löschen“ shows the served copy, then the done state, and leaves no signed-in
      UI behind.
- [ ] `/?mo=open&mo_c=<token>` opens the chat, sends `campaignToken` once on the first turn, and
      the address bar no longer shows `mo_c`.
- [ ] `/en` uses `?locale=en` everywhere; the old flows still work when a field is missing.
- [ ] `/apps/chat/whoami` is called once per session on first open; while it returns
      Shopify's 404 page nothing visible changes (no error, no extra sign-in prompt).
- [ ] After „Anmelden“ the widget redeems `ms_code` at `POST /api/auth/link` with its own
      `x-ms-session` before `/api/auth/me`; the address bar shows neither `ms_auth` nor `ms_code`
      afterwards; a second redeem of the same code answers 400. Opening a login link that was
      started with ANOTHER session id leaves the chat signed out.
- [ ] No new hard-coded legal text; no consent pre-selection; screenshots of the gate (both
      blocks), the opt-in card, the already-subscribed state and the erase dialog in DE and EN.
