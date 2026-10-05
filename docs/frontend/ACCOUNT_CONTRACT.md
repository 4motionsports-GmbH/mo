# Customer account and sign-in — frontend contract

> **What this file owns (canonical).** The wire shapes **and** the widget behaviour of every
> `/api/auth/*` route (login, the callback's return markers, link, me, logout, logout/return,
> `storefront` + `storefront/whoami` = the App Proxy) and every `/api/account/*` route
> (conversations, conversations/{id}, summary, export, erase, marketing-opt-in), plus the gating of
> the marketing ask after a sign-in (§6.1). Not here: rules for every widget change →
> [API_CONTRACT.md](./API_CONTRACT.md) §0; error envelope and rate-limit buckets → API_CONTRACT §1;
> KPI event names and data → API_CONTRACT §5; locale transport → API_CONTRACT §12; how the consent
> surfaces render → [CONSENT_CONTRACT.md](./CONSENT_CONTRACT.md). Backend internals (token storage,
> merge rule, resolver) are in the backend repo's `docs/CUSTOMER_ACCOUNT.md`; the widget does not
> need them. If this file and the backend code disagree, the code wins and this file gets fixed.

This is what the storefront widget needs for **tier-3 sign-in** (a signed-in Shopify customer) on
top of the anonymous and e-mail-capture flows. The widget **never** handles OAuth tokens: it
triggers a full-page redirect, redeems a one-time code and then asks the backend who the session
belongs to.

**Base URL (production):** `https://mo.motionsports.de` (always read it from config).

## 1. The opaque session reference

The widget keeps a stable `session_id` (a UUID in `localStorage`, sent as `x-ms-session`). That
**same `session_id` is the opaque reference** to the signed-in identity: it survives the redirect
unchanged, the backend links it to the customer, and the widget re-hydrates exactly as on any
reload. Do **not** generate a new session id around sign-in, and do not rotate it while the
session is signed in (rotation is part of ending a sign-in, §5.1).

> **Send the identical `session_id` on every hop**: on the login redirect (`?session=`), on the
> redeem (§2a) and on `/api/auth/me`. The backend keys everything on that exact id (it never mints
> its own); a different id resolves to **`signedIn: false`**. Signing in **before** the first chat
> message works — the link does not depend on an existing conversation.

### 1.1 Headers, guards and errors of the guarded routes

`POST /api/auth/link`, `GET /api/auth/me` and every `/api/account/*` route are guarded widget XHRs:

```
x-ms-chat-key: {shared secret}
Origin:        {storefront origin}        (browser-set; must be on the allow-list)
x-ms-session:  {session_id}               (the account routes also accept ?session=; the query wins)
Content-Type:  application/json           (POST / PATCH with a body)
x-ms-locale:   de | en                    (optional, API_CONTRACT §12)
```

- Always send `x-ms-session` as a **header**, even where `?session=` is accepted: the rate limit
  keys on the header (without it, on the client IP). When both are sent they must be the same value.
- Every route answers a CORS `OPTIONS` preflight and advertises its methods.
- Errors use the envelope `{ "error": { "code", "message" } }` (API_CONTRACT §1):

| Status | Code | When | Widget |
|---|---|---|---|
| `403` | `forbidden` | `Origin` not allowed (the answer has no CORS headers; the browser reports a network error) | configuration error |
| `401` | `unauthorized` „Unauthorized“ | missing or wrong `x-ms-chat-key` | configuration error |
| `401` | `unauthorized` „Nicht angemeldet“ / „Sitzung abgelaufen“ | `/api/account/*` only: no signed-in link / the chat token or the shop proof ran out (§7) | the sign-in ended → §5.1 |
| `429` | `rate_limited` | chat bucket (shared with `/api/chat`, API_CONTRACT §1); `Retry-After` is readable cross-origin | transient — **never** treat as a sign-out |
| `500` | `internal_error` | unexpected | transient |

Messages are for logs and fallbacks: some are localised (German, English with locale `en`), others
are fixed (the account `401` messages and the redeem refusals of §2a in German, the guard and
some JSON-parse messages in English). Dispatch on status and `code`, never on the message.

The top-level navigations (login, logout, the callback and logout returns) carry no guard; they are
protected by the signed `state` / one-time code and the `return_url` allow-list.

## 2. Initiating login — full-page top-level redirect

Send the **top-level window** (not a popup, not an XHR) to:

```
GET {BASE_URL}/api/auth/shopify/login
      ?session={session_id}
      &return_url={the storefront URL to come back to}
```

```js
const url = new URL(`${BASE_URL}/api/auth/shopify/login`);
url.searchParams.set("session", sessionId);
url.searchParams.set("return_url", window.location.href); // must be a storefront origin
window.location.assign(url.toString()); // TOP-LEVEL navigation
```

- `return_url` **must** be on an allow-listed storefront origin (`https://www.motionsports.de` /
  `https://motionsports.de`); anything else is ignored and the user returns to the storefront root
  (open-redirect guard).
- The login route answers a plain-text `400` (no `session`) or `503` (sign-in not configured, or
  no database) instead of redirecting — never navigate without a session id.
- The Shopify login must be finished within 10 minutes (`CUSTOMER_AUTH_PENDING_TTL_MINUTES`),
  otherwise the return carries `?ms_auth=error`.
- The conversation is server-persisted every turn, so there is nothing to flush first. The
  `session_id` is all the backend needs.
- Popups / new tabs are **not** supported (ITP / storage partitioning breaks cross-origin
  `postMessage`).

After Shopify auth the backend finishes server-side and **302s the browser back to `return_url`**
with a marker:

| `?ms_auth=` | Meaning | Widget |
|---|---|---|
| `ok` (+ `ms_code`) | Shopify sign-in done — **not yet linked** to this session | redeem `ms_code` (§2a), then `/api/auth/me` (§4) |
| `login_required` | `prompt=none` only (§3b): not logged in to Shopify | offer „Anmelden“ |
| `logged_out` | return from the backend logout (§5) | clear the signed-in UI (§5.1) |
| `error` | state, Shopify error, token exchange or database failed, or the 10 minutes ran out | stay as before: nothing changed server-side, so a session that was **already** signed in still is — re-probe `/api/auth/me` before clearing a signed-in UI |

`ms_code` comes only with `ok`. Strip `ms_auth` **and** `ms_code` from the URL after reading them
(e.g. `history.replaceState`).

### 2a. Completing the sign-in — redeem the one-time code

The session id of a sign-in comes from a URL anyone can prepare, so the backend never links it on
its own. The return carries a one-time code (`ms_code`, 43 characters, valid **10 minutes**, usable
**once**) that only this browser sees; the widget redeems it **with its own session**. The App
Proxy's `linkCode` (§3a) is redeemed the same way.

```js
const params = new URLSearchParams(location.search);
if (params.get("ms_auth") === "ok" && params.get("ms_code")) {
  await fetch(`${BASE_URL}/api/auth/link`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ms-chat-key": CHAT_KEY,          // the usual widget guards (§1.1)
      "x-ms-session": sessionId,          // the SAME session the login used
    },
    body: JSON.stringify({ code: params.get("ms_code") }),
  });
  // then strip ms_auth/ms_code and call /api/auth/me (§4)
}
```

| Response | Meaning | Widget |
|---|---|---|
| `200 { "ok": true, "signedIn": true }` | linked — `/api/auth/me` now reports signed in | probe `/api/auth/me` |
| `400 bad_request` „Anmeldung abgelaufen — bitte erneut anmelden.“ | unknown, malformed, expired, already used, or minted for **another** session | stay anonymous, offer „Anmelden“ |
| `400 bad_request` „Invalid JSON body“ | body not JSON | widget bug |
| `503 upstream_unavailable` „Anmeldung gerade nicht möglich — bitte später erneut versuchen.“ | database problem; the code may still be valid | stay anonymous, retry once later |
| `401` / `403` / `429` / `500` | §1.1 | transient / configuration |

- The link is written only when `x-ms-session` is the session the sign-in was started with; the
  code is used up on the first attempt either way (a wrong session burns it).
- On the redeem the session's existing conversations — the chat that led to the sign-in — join
  the customer's history (§7.1); a conversation already stamped with another customer stays theirs.
- Without the redeem the sign-in has no effect (fail closed): history, export, erasure, the opt-in
  and the signed-in chat stay off.
- The backend records the outcome as server-only KPI events (`account_signin_linked`,
  `account_signin_link_refused`, API_CONTRACT §5); the widget never sends them.

## 3. Already-signed-in check (shop login **and** chat login)

A visitor is often **already logged in to the shop** through the shop's own login (the storefront
account icon), not the chat's „Anmelden“. Two mechanisms recognise that; **3a** is the one that
sees a shop-native login without a click.

### 3a. App Proxy storefront detection — `GET /apps/chat/whoami`

The widget and the backend are cross-origin, so the backend cannot read the storefront session
cookie. A **Shopify App Proxy** bridges that: the widget calls a **same-origin** storefront path;
Shopify forwards it to the backend (`/api/auth/storefront/whoami`, same handler as
`/api/auth/storefront`), adding the logged-in customer id (`logged_in_customer_id`), a `timestamp`
and an HMAC `signature`. The backend trusts **only** Shopify's signed id — never a client value.

```js
// Same-origin storefront fetch (NOT the backend origin). No x-ms-chat-key, no custom headers.
const res = await fetch(`/apps/chat/whoami?session=${encodeURIComponent(sessionId)}`,
                        { credentials: "include" });
```

Response (`200`, `Cache-Control: no-store`):

```jsonc
// recognised — and the session WILL count as signed in after the redeem
{
  "signedIn": true,
  "name": "Max Mustermann",            // also at identity.name; may be null
  "tier": 3,                            // also at identity.tier
  "shopify_customer_id": "1234567890",
  "identity": { "name": "Max Mustermann", "tier": 3 },
  "marketing": { "status": "none", "optInActionable": true },   // same rules as §4 / §6.1
  "linkCode": "…43 characters…"         // redeem at POST /api/auth/link (§2a)
}
// everything else (fails closed)
{ "signedIn": false }
```

- **Use only `signedIn` and `linkCode`.** Redeem `linkCode` at `POST /api/auth/link` with the same
  `x-ms-session` (§2a); only then do `/api/auth/me` (§4) and `/api/account/*` (§7) resolve. Take
  the name and `marketing` from `/api/auth/me` after the redeem. `signedIn: true` always carries a
  `linkCode`; an answer without one counts as not signed in.
- **Other answers.** `429 rate_limited` (chat bucket, keyed by the session) is possible. When the
  App Proxy is not configured in the shop, the path returns the shop's own HTML 404 page. Treat any
  non-`200`, non-JSON or unparsable answer as `signedIn: false`. If Shopify sends no
  `logged_in_customer_id` for the store's account type, every answer is `signedIn: false`.
- **When the answer is `signedIn: true`** — all of these, in this order:
  1. a valid signature whose `timestamp` is within ±5 minutes (this limits a replayed URL to that
     window; a bad, missing or stale signature → `signedIn: false`, and nothing is changed);
  2. the shop reports a logged-in customer;
  3. the session is not signed in as **another** shop customer (handover, below);
  4. the backend switch `APP_PROXY_SIGNIN_ENABLED` is on (the kill switch, default `false` in
     code);
  5. a proof: a live chat token of that customer (someone who used „Anmelden“ before), or — with
     `APP_PROXY_SIGNIN_MAX_AGE_HOURS` > 0 (default `0` in code, at most `720`) — the shop login
     itself;
  6. the backend could store the customer and mint the code.
- **Effects even when the answer is `signedIn: false`** (also with the switch off): a signed,
  fresh request for a session signed in as another shop customer ends that session's sign-in
  (handover); a signed, fresh request from a browser the shop reports as **logged out** ends the
  session's shop-login link — a shop logout signs a shop-recognised chat out. A chat sign-in
  („Anmelden“) of the session is not ended by a shop logout.
- **Shop proof.** With `APP_PROXY_SIGNIN_MAX_AGE_HOURS` > 0 a shop-login link counts as signed in
  **without** a chat token for that many hours after its last redeem. Every new tab session's
  whoami + redeem renews it (the backend records a renewal, not a new sign-in). History, summary,
  export, erasure and the opt-in (§6.1, §7, §8) then work on the shop login alone. A tab kept open
  longer than the max age without a new tab gets `signedIn: false` from `/api/auth/me` or a `401`
  „Sitzung abgelaufen“ from `/api/account/*` → §5.1. A chat-signed-in customer whose chat token has
  died and whom the shop re-proves stays signed in (the session's link becomes a shop-login link).
- **Order status needs the chat's own „Anmelden“.** For a session recognised only through the shop,
  the `get_order_status` tool answers `status: "sign_in_required"` with `signedInViaShop: true`,
  and Mo says so in its text. The widget renders nothing for that tool
  ([API_CONTRACT.md](./API_CONTRACT.md) §2, „Tools the widget MUST NOT render“), but **keeps
  „Mit Kundenkonto anmelden“ reachable** for shop-recognised sessions (e.g. in the account menu).
  That login (§2 + §2a, same `session_id`) upgrades the session to a chat sign-in. A
  shop-recognised visitor is signed in, so the anonymous sign-in popup (§6) does not apply.
- **Handover (shared browser).** If this session is signed in as **another** shop customer, whoami
  ends that session's sign-in and issues no code. The next `/api/auth/me` answers `signedIn: false`;
  the widget runs §5.1 (local transcript wiped, new session id), and the next tab links the new
  person. The previous person's chats stay theirs.

Operator steps (App Proxy setup, the two switches): backend repo `docs/ROLLOUT_TODO.md` 5.4 — not
needed to build the widget.

### 3b. Silent OAuth (`prompt=none`) — full-page redirect

Run the §2 redirect with `&prompt=none`. Logged in to Shopify → silent return `?ms_auth=ok` (+
`ms_code`, redeem as in §2a); logged out → `?ms_auth=login_required`. It is authoritative but
bounces the whole storefront page, so §3a is preferred where the App Proxy is set up. (A cheap
pre-hint, `ShopifyAnalytics.meta.page.customerId`, may decide whether the attempt is worth it —
never gate identity on it.)

## 4. Re-hydrating identity — `GET /api/auth/me`

After a redeem (§2a) and on normal widget load, ask the backend who this session is. Guarded
(§1.1).

```
GET {BASE_URL}/api/auth/me?session={session_id}
Headers: x-ms-chat-key, x-ms-session (§1.1)
```

Response (`200`, `Cache-Control: no-store`):

```jsonc
// signed in
{
  "signedIn": true,
  "identity": { "name": "Max Mustermann", "tier": 3 },
  "marketing": { "status": "none", "optInActionable": true }
}
// not signed in (or anything unprovable — fails closed)
{ "signedIn": false }
```

- **Statuses.** `200` for every answer the backend can prove or disprove; `401` / `403` / `429` /
  `500` as in §1.1. A `429` or `5xx` says nothing about the sign-in. The route also answers
  `signedIn: false` when it cannot reach its database (fail closed), so a database outage looks
  like a sign-out.
- **Signed in** means: the session has a signed-in link (a chat sign-in, §2a, or a shop-login
  link, §3a) **and** the customer holds a live chat access token (refreshed server-side when
  needed) — or, for a shop-login link, its shop proof is fresh (§3a). A typed e-mail never signs a
  session in.
- If Shopify reports the access token as revoked (the customer logged out of Shopify elsewhere),
  the answer is `signedIn: false` and every signed-in link of the customer ends.
- `identity.name` is read **live from Shopify** for a chat sign-in, from the backend's cached
  account summary (else the Admin API) for a shop-proof sign-in; it may be `null` — render a
  neutral fallback.
- `tier` is always `3` when signed in. The widget never sees tokens, e-mail addresses, postal
  addresses or orders through this route. (Order facts can appear only in the
  `get_order_status` tool output on `/api/chat`, API_CONTRACT §2.)
- **`marketing`** (only when `signedIn: true`) drives the tier-3 suppression (§6.0) and the
  marketing ask (§6.1):
  - `status` — the customer's marketing consent: `"none" | "pending" | "confirmed" |
    "unsubscribed"`. It is the **one** consent shared with the shop: `"confirmed"` also when the
    customer subscribed to the newsletter in the shop (checkout, account), once the backend's
    customer mirror has them. Signing in never grants or changes it.
  - `optInActionable` — whether to offer the marketing ask now. The single source of truth for
    "ask or not"; never re-derive it from `status`. Rules: §6.1.
- Supports a CORS preflight; advertises `GET, OPTIONS`.

## 5. Logout — `GET /api/auth/shopify/logout`

Backend-initiated: the widget cannot build Shopify's OIDC `end_session` URL (it never sees
discovery or tokens). Send the **top-level window** to:

```
GET {BASE_URL}/api/auth/shopify/logout
      ?session={session_id}
      &return_url={the storefront URL to come back to}
```

The backend redirects to Shopify's `end_session` with
`post_logout_redirect_uri = {BASE_URL}/api/auth/shopify/logout/return`; Shopify ends its session,
then the return route **drops the stored tokens** of the customer and bounces the browser back to
the storefront with **`?ms_auth=logged_out`**. If the store advertises no `end_session` endpoint,
or anything fails, the route degrades to a **local sign-out** (tokens dropped, same
`?ms_auth=logged_out` bounce) — no widget change either way. Same `return_url` rule as login.

The return route ends **every signed-in link** of that customer — chat sign-ins and shop-login
links, on every device — and this session's link. The customer and their history are **not**
deleted: logging out ends sessions, not the account (full erasure is §7.5).

A **local** sign-out (the widget forgets the session id without calling this route) leaves the old
session's server-side link in place until its token or shop proof runs out; other devices stay
signed in. Either way, run §5.1.

### 5.1 When a sign-in ends — clear the local chat

The chat history the widget stores can hold the customer's order facts (the `get_order_status`
tool output and Mo's answers). So whenever a sign-in ends on this device, the widget **drops the
stored messages of that session and continues on a fresh `session_id`**, and clears the signed-in
UI. A sign-in ends when:

- the customer signs out (local or §5; also the `?ms_auth=logged_out` return);
- an erasure returns (§7.5);
- the server says it ended: `/api/auth/me` answers `signedIn: false` for a session the widget
  showed as signed in (expiry, a logout on another device or in Shopify, an erasure elsewhere, a
  handover §3a), or an `/api/account/*` route answers `401`.

Transient answers (`429`, `5xx`, network errors) are **not** a sign-out. Never log the tool output
or forward it anywhere else (KPI data, analytics, error reports); see API_CONTRACT §2.

## 6. Sign-in and the marketing ask

Sign-in is **identity only** — it never opts anyone into marketing (the consent principles:
CONSENT_CONTRACT §5). A visitor can use the chat fully without signing in. Anonymous visitors are
invited by the widget's sign-in popup (KPI `login_gate_*`, API_CONTRACT §5); its „Anmelden“ is the
login of §2, completed by §2a. After the return, §6.1 decides whether the marketing ask is shown.

### 6.0 Tier-3 suppression (end-of-chat capture form)

For a **signed-in (tier 3)** customer the end-of-chat e-mail-summary + marketing capture form is
**suppressed**; the marketing ask moves to after the sign-in (§6.1), and the summary is a download
instead (§8).

- **Gate on `tier`.** When `/api/auth/me` returns `identity.tier === 3`, **do not render** the
  capture form (the `offer_email_summary` tool card, API_CONTRACT §2, and any other entry to it).
  The backend also no longer offers `offer_email_summary` (nor forces the end-of-chat ask) to a
  live signed-in session — but it keeps the offer when its sign-in lookup fails, so the widget gate
  stays required.
- **Tiers 1–2 are unchanged**: anonymous and e-mail-only visitors get the capture form
  (CONSENT_CONTRACT §4, API_CONTRACT §7.1).
- **Exception:** the `422 no_verified_email` answer of the opt-in (§6.2) falls back to the capture
  form. A capture submit links the session to the **typed** address: if that is not the signed-in
  customer's own address, the session stops being signed in (fail closed) and the next
  `/api/auth/me` answers `signedIn: false`.

### 6.1 When to show the marketing ask — `optInActionable`

A signed-in customer is offered a one-tap marketing opt-in that skips typing the e-mail (the
backend holds the verified address). It is the **same double opt-in**, nothing is pre-selected,
and it is a separate, explicit act.

**Where:** a **popup right after the sign-in** (`placement: "popup"`), and an inline card after a
sign-in in the middle of a conversation (`placement: "signin_return"`). Rendering, echo and decline
rules: CONSENT_CONTRACT §3.

**When:** only when `/api/auth/me` (§4) answers `signedIn: true` **and**
`marketing.optInActionable === true` — i.e. after the code of §2a was redeemed. The backend
computes it per customer, identically on `/api/auth/me` and on whoami (§3a):

```
optInActionable =
     the session is signed in (§4)
  && marketing.status === "none"        // no decision on record — in Mo or in the shop
  && the account has a real e-mail      // not the placeholder of an account without a verified address
  && not quiet (anti-nag, below)
  && the backend could read all of this // any read failure → false (fail closed)
```

- **`status` is `"none"` again after an expired DOI.** A `pending` opt-in whose confirmation link
  was never clicked is reset to no consent by the nightly run, the first run more than
  `MARKETING_DOI_EXPIRY_DAYS` + 1 days (default 8) after the opt-in. `optInActionable` can then be
  `true` again. `"pending"`, `"confirmed"` and `"unsubscribed"` are otherwise final for the ask —
  a customer who opted in, whose earlier opt-in carried forward when their e-mail merged into the
  signed-in identity, or who subscribed in the shop is not asked.
- **Anti-nag (backend, per customer).** `optInActionable` is `false` when, within the last 30
  days, any session linked to the customer has a `consent_gate_declined`, or at least 3 of them
  have a `consent_gate_shown` — counting only events with `data.surface: "signin"` (API_CONTRACT
  §5). It works on every device, for chat sign-ins and shop-login recognition alike. Those two
  widget events are what feed it, so send them with the signed-in `session_id`; a dismiss
  (`consent_gate_dismissed`) counts only through its `shown`.
- **The widget's own memory stays**: remember a decline on the device (30 days) and a dismissal
  at least for the tab session. The **backend** truth for "ask or not" is `optInActionable`.
- **After an accept** that started a DOI (`pending`) or found the address subscribed
  (`confirmed`), `/api/auth/me` reports `optInActionable: false`. An accept for a suppressed
  address (answer `status: "none"`, §6.2) changes nothing in the consent, so `optInActionable` can
  stay `true`; the widget's memory of the answered ask and the anti-nag keep it from nagging.

Copy: `GET /api/consent-copy?surface=signin` (payload API_CONTRACT §7.4, rendering
CONSENT_CONTRACT §3.1). Submit: §6.2.

### 6.2 Submit — `POST /api/account/marketing-opt-in`

Fires **only** on the explicit accept tap („Ja, Angebote aktivieren“). Guarded and signed-in-gated
like every `/api/account/*` route (§1.1, §7).

```
POST {BASE_URL}/api/account/marketing-opt-in
Headers: x-ms-chat-key, x-ms-session, Content-Type: application/json (§1.1)
```

```jsonc
{
  "marketingConsent": true,                  // required, exactly true — only ever sent on the accept tap
  "consentTextShown": "<served surface=signin consentTextShown, byte for byte>",
  "locale": "de",                            // optional "de" | "en"; the language the copy was fetched in
  "placement": "popup",                      // optional: "popup" | "signin_return" | "value_moment"
  "variant": "a"                             // optional: the served `variant` of the rendered copy
}
```

- **No e-mail in the body.** The backend uses the customer's verified address.
- `locale` in the body wins over `?locale=` / `x-ms-locale` (default `de`). It sets the DOI mail's
  language, the message language, and which canonical text the echo is compared with.
- `consentTextShown` byte-identical to the canonical sign-in text of that `locale` → stored with
  the version stamp (`v5`); anything else (a stale copy, a missing echo) is stored as sent without
  a stamp ("unattested") — not an error. Always echo the served string.
- `placement` and `variant` are telemetry only: unknown or invalid values are ignored, **never** a
  `400`. `variant` counts only when it is a variant id the backend defines for that locale.
  Rendering-side rules for both: CONSENT_CONTRACT §3.2.

Response (`200`, `Cache-Control: no-store`):

```jsonc
{
  "ok": true,
  "marketing": {
    "status": "pending",          // "pending" | "confirmed" | "none"
    "doiEmailSent": true,
    "alreadyConfirmed": false
  }
}
```

| `marketing` | Meaning |
|---|---|
| `status: "pending"`, `doiEmailSent: true` | the DOI mail went to the stored address; not subscribed until the link is clicked |
| `status: "pending"`, `doiEmailSent: false` | the opt-in is stored, but the mail could not be sent right now (a later accept sends a new link) |
| `status: "confirmed"`, `alreadyConfirmed: true`, `doiEmailSent: false` | the address already holds the consent (shop or an earlier DOI); no mail |
| `status: "none"`, `alreadyConfirmed: false`, `doiEmailSent: false` | the address is suppressed (unsubscribed, bounced, complained); no mail |

What to show for each answer: CONSENT_CONTRACT "One consent, shared with the shop".

| Status | Code | Message (DE) | Widget |
|---|---|---|---|
| `400` | `bad_request` | „Ungültiger JSON-Body“ | widget bug |
| `400` | `marketing_consent_required` | „Bitte bestätige die Einwilligung aktiv …“ | `marketingConsent` was not exactly `true` (unreachable when the POST fires only on the tap) |
| `401` | `unauthorized` | §1.1 | the sign-in ended → §5.1 |
| `403` | `forbidden` | §1.1 | configuration error |
| `404` | `not_found` | „Kunde nicht gefunden“ | the customer no longer exists (e.g. erased elsewhere) → treat like a sign-out |
| `422` | `no_verified_email` | „Für dieses Konto liegt keine verifizierte E-Mail-Adresse vor.“ | offer the capture form (CONSENT_CONTRACT §4; mind §6.0) |
| `429` | `rate_limited` | — | wait `Retry-After`, keep decline usable |
| `503` | `upstream_unavailable` | „Einwilligung konnte nicht gespeichert werden — bitte später erneut versuchen.“ | nothing stored; let the user retry |
| `500` | `internal_error` | — | retry later |

Server side (no widget action): the tap is stored as Art. 7 evidence (the echoed text and its
version stamp; for a new DOI also which sign-in stood behind it), and the backend writes the server-only KPI events
`email_capture_submitted` and `email_capture_marketing_opted_in` with `trigger: "signin_optin"`,
`source: "mo_signin"`, `outcome`, `alreadyConfirmed`, `doiRequired` and the known `placement` /
`variant` (API_CONTRACT §5). The widget sends only its own `consent_gate_accepted`.

## 7. Signed-in conversation history and data rights — `/api/account/*`

A **signed-in** customer can browse, open, rename and delete their past conversations, download a
summary (§8) or all their data (§7.7), and erase everything (§7.5). These are guarded widget XHRs
(§1.1). All of them:

- are **fail-closed**: an anonymous or **e-mail-only** session, or one whose sign-in ended, gets
  **`401`** `{ "error": { "code": "unauthorized", "message": "Nicht angemeldet" } }` (no
  signed-in link) or `"Sitzung abgelaufen"` (the chat token or the shop proof ran out). A session
  signed in through the shop login alone (§3a „Shop proof“) is signed in here too. Render the
  account UI only once `/api/auth/me` reports `signedIn: true`; a `401` → §5.1.
- return `Cache-Control: no-store` and support a CORS preflight (the per-id route advertises
  `GET, PATCH, DELETE, OPTIONS`).
- are scoped to the signed-in customer **across devices** — the list is the customer's whole
  history, whichever device opened each chat. A conversation the customer does not own returns
  **`404`** (same as a missing one).
- answer `429` / `500` as in §1.1.

### 7.1 List — `GET /api/account/conversations`

Most recent first, at most 100, no pagination parameters.

```jsonc
// 200 OK
{
  "conversations": [
    {
      "conversationId": 412,                          // numeric DB id — for rename/delete (§7.3/§7.4)
      "conversationKey": "c3f1e8a2-…",                // thread key — send on /api/chat to RESUME (§7.6)
      "title": "Welche Laufschuhe passen zu mir?",   // custom title, else first user message trimmed
      "createdAt": "2026-06-01T09:14:22.000Z",
      "updatedAt": "2026-06-01T09:31:05.000Z",
      "messageCount": 8                               // readable user/assistant turns
    }
    // …
  ]
}
```

> Each item carries **two** ids: `conversationId` (numeric, for the
> `/api/account/conversations/{id}` URLs) and `conversationKey` (the thread key — send it as
> `conversationKey` on `/api/chat` to **resume** the thread; §7.6).

- `title` is never null and costs no model call: the custom title if the customer renamed it,
  otherwise the first user message trimmed to ≤ 80 characters, or „Beratung“ when there is no user
  text yet.
- `createdAt` / `updatedAt` are ISO-8601 or `null`. `updatedAt` changes on rename; the order is by
  **last activity**, so a rename does **not** reorder the list.
- A **newly started** conversation is listed **immediately** — it is persisted and linked to the
  customer when the first message is sent, before the answer arrives — and survives a reload
  (§7.6).

### 7.2 Fetch transcript — `GET /api/account/conversations/{id}`

```jsonc
// 200 OK
{
  "conversation": {
    "conversationId": 412,
    "conversationKey": "c3f1e8a2-…",        // send on /api/chat to RESUME this thread (§7.6)
    "title": "Welche Laufschuhe passen zu mir?",
    "createdAt": "2026-06-01T09:14:22.000Z",
    "updatedAt": "2026-06-01T09:31:05.000Z",
    "personaLabel": "pragmatic_beginner",   // may be null
    "messageCount": 8,
    "messages": [
      { "role": "user",      "content": "Welche Laufschuhe passen zu mir?", "toolName": null },
      { "role": "assistant", "content": "Gern! Wofür möchtest du sie …",     "toolName": null }
      // … readable turns only; tool rows are dropped, so toolName is always null
    ]
  }
}
```

- `400 bad_request` („Ungültige Konversations-ID“) if `{id}` is not a positive integer.
- `404 bad_request` („Konversation nicht gefunden“) if it is not this customer's conversation.

### 7.3 Rename — `PATCH /api/account/conversations/{id}`

```jsonc
// request body
{ "title": "Laufschuh-Beratung" }
// 200 OK
{ "ok": true, "conversationId": 412, "title": "Laufschuh-Beratung" }
```

- The title is trimmed, whitespace-collapsed and bounded to **80 characters** server-side — send
  the raw input; the response echoes the stored value.
- `400 bad_request` for a bad id, bad JSON („Ungültiger JSON-Body“) or a missing / empty /
  non-string title („Titel darf nicht leer sein“).
- `404 bad_request` if the conversation is not this customer's.

### 7.4 Delete one chat — `DELETE /api/account/conversations/{id}`

```jsonc
// 200 OK
{ "ok": true, "conversationId": 412, "deleted": true }
```

- **Hard-deletes that one transcript** (messages included) — irreversible.
- `400` for a bad id; `404 bad_request` if the conversation is not this customer's.
- **It does not erase the durable profile.** A future profile regeneration no longer sees the
  chat, but anything already learned persists until the profile is regenerated or the customer
  uses §7.5. Word the UI honestly: „Dieser Chat wird gelöscht“, not „alle Daten gelöscht“.

### 7.5 Delete ALL my data — `POST /api/account/erase`

A **distinct, heavier** action than §7.4 — confirm it explicitly in the UI.

```jsonc
// POST (no body required)
// 200 OK
{ "ok": true, "erased": true, "deletedConversations": 7 }
```

This erases the **person**: every conversation on every device, the profile and cached summaries,
the stored tokens and every session link, the consent records, and the address goes on the
suppression list. For a customer with a Shopify account the same call also queues the shop side —
the newsletter consent switched off in Shopify, then Shopify's own data erasure, each behind its
own backend switch (default `false` in code); Shopify keeps the orders the law requires. Details:
[API_CONTRACT.md](./API_CONTRACT.md) §11.1. The response does not change.

| Status | Code | Widget |
|---|---|---|
| `200` | — | show `doneHeading` + `doneBody`, then §5.1 |
| `401` | `unauthorized` | the session is no longer signed in → §5.1 (no done dialog) |
| `503` | `upstream_unavailable` („Löschung konnte nicht durchgeführt werden — bitte später erneut versuchen.“) | **nothing** was erased — show `failedBody`, allow a retry; never show „gelöscht“ |
| `429` / `500` | §1.1 | retry possible |

**Confirmation copy — `GET /api/consent-copy?surface=erase`** (payload and guard: API_CONTRACT
§7.4; origin allow-list only, `?locale=en` on `/en`). Render `confirmHeading` + `confirmBody` + a
`confirmButton` (plus a cancel) in the confirmation, `doneHeading` + `doneBody` after a `200`, and
`failedBody` on a `503`. Render them verbatim; `confirmBody` depends on the backend configuration
(it names the shop account only when the shop is erased too), so never hard-code it, and do not
offer the erase when the copy cannot be loaded (there is no fallback text). `invalidHeading` /
`invalidBody` belong to the mail-link page and are ignored.

After a `200`:

- the session **no longer resolves** — `/api/auth/me` returns `signedIn: false` and every
  `/api/account/*` call returns `401`. Run §5.1 (stored chat dropped, new session id).
- Optionally send the customer through the Shopify logout (§5) to end the Shopify session itself.

### 7.6 Multiple conversations under one stable `session_id`

The history can hold **several threads** per customer because the widget keys each conversation
with a **`conversationKey`** (a stable, client-generated string) on `/api/chat`, while
`session_id` stays the unchanging identity link. Full rules:
[API_CONTRACT.md](./API_CONTRACT.md) §2, „Optional `conversationKey`“. In short:

- **„Neue Beratung“** → keep `session_id`, generate a **fresh** `conversationKey`, clear the local
  messages. The **first** `/api/chat` turn under it creates and customer-links the history row
  **at that moment** — before the answer — so it lists immediately and survives a reload. There is
  no separate "create conversation" call.
- **Open a past conversation** → load its transcript (§7.2) and adopt its `conversationKey` as the
  active thread; the next `/api/chat` turn appends to that thread.
- **Omit `conversationKey`** → one thread per session (backward-compatible).

### 7.7 Export my data — `GET /api/account/export`

The machine-readable Art. 15 / Art. 20 copy of everything the backend stores about the signed-in
customer. Guarded and signed-in-gated (§1.1, §7).

```
GET {BASE_URL}/api/account/export
Headers: x-ms-chat-key, x-ms-session (§1.1); locale via ?locale= / x-ms-locale (API_CONTRACT §12)
```

Success:

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Content-Disposition: attachment; filename="motionsports-meine-daten.json"   (en: "motionsports-my-data.json")
Cache-Control: no-store
```

The body is one pretty-printed JSON document (top-level keys `exportedAt`, `note`, `customer`,
`consentRecords`, `conversations`, `correspondence`, `physicalLetters`, `marketingSends`,
`bundleOffers`, `feedback`, `consentEvents`, `orders`, `facts`, `campaign`, `suppression`; more
may be added). Treat it as an opaque file: save it, never parse, render, log or cache it — it is
the customer's personal data.

| Status | Code | Widget |
|---|---|---|
| `401` | `unauthorized` „Nicht angemeldet“ / „Sitzung abgelaufen“ | §5.1 |
| `429` | `rate_limited` | wait `Retry-After` |
| `503` | `upstream_unavailable` („Export konnte nicht erstellt werden — bitte später erneut versuchen.“) | nothing to save; allow a retry |
| `500` | `internal_error` | allow a retry |

Download it like the summary (§8): a guarded `fetch`, then save the body as a `Blob`. The
`Content-Disposition` header is **not** readable cross-origin (it is not in
`Access-Control-Expose-Headers`), so name the file yourself (`motionsports-meine-daten.json` /
`motionsports-my-data.json`). It can take a few seconds. The backend counts each export with the
server-only `account_export_requested` (API_CONTRACT §5).

## 8. Download a conversation summary — `GET /api/account/summary`

Backs „Zusammenfassung herunterladen“ for a signed-in customer. It returns the **same** structured
summary as the summary e-mail — AI prose → chosen products → **Zur Kasse** → divider →
„Vielleicht auch interessant:“ alternatives — built by the same assembler (so content cannot
diverge) and rendered as a **PDF** attachment with the motion sports letterhead.

```
GET {BASE_URL}/api/account/summary?conversationKey={conversationKey}
Headers: x-ms-chat-key, x-ms-session (§1.1); locale via ?locale= / x-ms-locale (API_CONTRACT §12)
```

- **`conversationKey`** is the thread key from the list / transcript (§7.1/§7.2) — the value sent
  on `/api/chat` — **not** the numeric `conversationId`. For the active chat, use its current key.
- Same fail-closed gate as the rest of `/api/account/*` (§7): only offer the button once
  `/api/auth/me` reports `signedIn: true`.
- A key that is not this customer's (or unknown) → **`404 bad_request`** („Konversation nicht
  gefunden“). A missing / empty `conversationKey` → **`400 bad_request`** („conversationKey
  fehlt“). `401` / `429` / `500` as in §7.

### Success response

```http
HTTP/1.1 200 OK
Content-Type: application/pdf
Content-Disposition: attachment; filename="motionsports-zusammenfassung-….pdf"   (en: motionsports-summary-….pdf)
Content-Length: …
Cache-Control: no-store
```

The body is the PDF. The prose follows the locale (German default, English with `en`).

### Triggering the download from the widget

The endpoint is a **guarded XHR** (it needs `x-ms-chat-key` and the session header, which a plain
`<a download>` / navigation cannot send), so fetch it and save the body as a `Blob`:

```js
const res = await fetch(
  `${BASE_URL}/api/account/summary?conversationKey=${encodeURIComponent(conversationKey)}`,
  { headers: { "x-ms-chat-key": SHARED_SECRET, "x-ms-session": sessionId } }
);
if (!res.ok) { /* 401 → §5.1; 404 → „nicht gefunden“; else generic error */ }
const blob = await res.blob();           // application/pdf
const url = URL.createObjectURL(blob);
const a = Object.assign(document.createElement("a"), {
  href: url,
  download: "motionsports-zusammenfassung.pdf",    // name it yourself: Content-Disposition is not readable cross-origin
});
a.click();
URL.revokeObjectURL(url);
```

- The download is **on demand and may make one AI call** (the prose), so it can take a moment —
  show a spinner and do not impose a short timeout. If the model is unavailable the prose falls
  back to the plain transcript (never an error).
- It reflects the thread's **current** state (latest products, newest transcript) on every
  download.

## Appendix A — changes since 2026-10-01

Present-tense rules above are complete; this list only says what is new relative to a widget
built before the date. Changes to other endpoints: API_CONTRACT Appendix A.

| Date | Change | Section |
|---|---|---|
| 2026-10-03 | A sign-in links the session only through the redeemed one-time code (`ms_code`, whoami `linkCode`). | §2a, §3a |
| 2026-10-05 | whoami answers `signedIn: true` only with a `linkCode` and only when the session will count as signed in; handover on shared browsers; shop proof (`APP_PROXY_SIGNIN_MAX_AGE_HOURS`) and kill switch. | §3a |
| 2026-10-05 | The backend logout also ends shop-login links. | §5 |
| 2026-10-05 | Backend anti-nag on `optInActionable`; opt-in POST takes `placement` and `variant`; a suppressed address is answered `status: "none"`. | §6.1, §6.2 |
| 2026-10-05 | The backend no longer offers `offer_email_summary` to a live signed-in session. | §6.0 |
| 2026-10-05 | `GET /api/account/export` documented (route unchanged). | §7.7 |
