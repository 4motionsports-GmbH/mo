# Shopify Customer Account sign-in (tier 3 identity) — feasibility spike

**Status:** READ-ONLY SPIKE — no application code changed. Decision-ready report.
**Author context:** motionsports chat backend.
**Date:** 2026-06-14.
**Pinned Admin API version:** `2026-04` (`SHOPIFY_API_VERSION`; see
`src/lib/shopify.ts`). The **Customer Account API** is versioned separately
(`https://shopify.dev/docs/api/customer/<version>`); this spike targets the
**stable** Customer Account API version current at build time and pins it via a
new env var (proposed `SHOPIFY_CUSTOMER_ACCOUNT_API_VERSION`, default the latest
stable, e.g. `2026-04`) — **[VERIFY]** the exact stable label at build time on
`https://shopify.dev/docs/api/customer`.

## Goal recap

Add a **third identity tier** to the chat: *signed-in Shopify customer*.

| Tier | Key | How it exists today |
|---|---|---|
| 1 — Anonymous | `session_id` (localStorage, per-browser thread) | `conversations` (`migrations/0001_init.sql`) |
| 2 — Identified (consent) | normalised **email** | `customers` / `email_captures` (`migrations/0008_customers.sql`); created only via `/api/capture-email` |
| **3 — Signed-in (NEW)** | **`shopify_customer_id`** | does not exist yet — this spike |

For tier-3 users, **Shopify is authoritative** for identity (name, email,
addresses, order history). Our DB keeps what Shopify does not: transcripts,
analytics, consent (our DOI), profile/persona — re-keyed by
`shopify_customer_id`. The existing email key remains the **merge key** between
tiers 2 and 3.

## Our surface (what this spike must fit inside)

- **Backend:** Next.js 16 on **Vercel**, base URL `https://chat.motionsports.de`
  (`PUBLIC_BASE_URL` / `src/lib/base-url.ts`). Node runtime, Neon Postgres
  (`src/lib/db.ts`).
- **Storefront / widget:** the chat UI lives **in the Shopify theme** on
  `https://www.motionsports.de` / `https://motionsports.de` (README; not in this
  repo). It talks to the backend **cross-origin**, guarded by an origin allowlist
  + `x-ms-chat-key` shared secret (`src/lib/security.ts`). Allowed origins:
  `https://www.motionsports.de`, `https://motionsports.de`.
- **Existing Shopify auth:** OAuth **client-credentials** grant → short-lived
  *Admin* API token (`src/lib/shopify.ts`). This is **server-to-server** and is
  **not** reusable for customer identity — Customer Account API is a wholly
  separate client and credential set (see §2, §8).
- **Store domain:** `*.myshopify.com` via `SHOPIFY_STORE_DOMAIN` (e.g.
  `motion-sports.myshopify.com`); public domain `motionsports.de`.
- **No customer-facing OAuth/OIDC/PKCE exists in the repo today** — all of §2–§5
  is net-new infrastructure.

> **Doc-sourcing note (important for verification).** `shopify.dev` and
> `help.shopify.com` return **HTTP 403 to automated fetches** — confirmed again
> during this spike (the WebFetch of the Customer-Account-API *getting-started*
> page returned 403), the same block the code already documents
> (`src/lib/shopify-discounts.ts:14-18`). Findings below were gathered on
> 2026-06-14 from Shopify's **live published** docs, changelog, Help Center and
> developer-community posts **via web search** rather than direct page fetch.
> Each claim carries a canonical URL for browser confirmation. Anything not
> re-confirmable against rendered docs is flagged **[VERIFY]** with a concrete
> check. The single most important caveat: **Customer-Account-API token
> lifetimes** (see §5) — the search index repeatedly conflated them with *Admin*
> offline-token lifetimes (1h / 90-day, a December-2025 change). Do not ship the
> refresh logic against assumed numbers; read `expires_in` at runtime.

---

## 1. ENABLEMENT — is the Customer Account API usable on THIS store?

**Two preconditions, both set in the Shopify admin, both Lucas's action. Neither
is detectable from this backend** (we authenticate as an *Admin* app via
client-credentials; the Customer Account API client and its enablement state live
in a different admin surface we cannot read with our current token/scopes).

1. **A Headless (or Hydrogen) sales channel must be installed**, and the
   Customer Account API client created under it. Path:
   *Shopify admin → Sales channels → Headless (or Hydrogen) → select storefront →
   Customer Account API settings*. This channel is where the client, its
   credentials, and the callback/origin/logout URLs are registered.
   ([getting-started](https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api/getting-started))
2. **Customer accounts must be set to the *new* version.** Path: *Shopify admin →
   Settings → Customer accounts → "Accounts in online store and checkout" → Edit
   → choose "Customer accounts" (new) → Save.* **Legacy (classic) customer
   accounts were deprecated in February 2026**, so a store on the new platform is
   the expected state — but it must be confirmed.
   ([Help Center](https://help.shopify.com/en/manual/customers/customer-accounts/new-customer-accounts/identity-provider/requirements),
   [DEV: what changed 2026](https://dev.to/ogresto/shopify-new-customer-accounts-2026-what-changed-what-broke-and-what-to-do-38h8))

> **ACTION — Lucas (store owner), in admin.** This spike cannot enable or detect
> either precondition. Lucas must, on a **development store first** then
> production:
> (a) install the **Headless** sales channel and create a **Customer Account API**
> client, then (b) confirm **Settings → Customer accounts** is on the **new**
> version. He should then hand us the client's **Client ID**, **Client secret**
> (for the confidential client — see §2/§3), and the three endpoint URLs shown on
> that settings page.

**[VERIFY] — current state.** Concrete check: ask Lucas to screenshot *Sales
channels* (is "Headless" present?) and *Settings → Customer accounts* (is it the
new version?). Programmatic alternative once we have any Customer-Account-API
client: `curl https://www.motionsports.de/.well-known/customer-account-api` and
`.../.well-known/openid-configuration` — a 200 with a JSON discovery document
confirms the API is live on the domain; a 404 means it is not yet enabled.

---

## 2. CLIENT TYPE — confidential (server-side) client

**Yes, a confidential client is supported, and it is the right choice for us**
because we have a backend (Vercel) that can hold a secret and a server-side store
for refresh tokens.

| | Public client (PKCE) | **Confidential client (our pick)** |
|---|---|---|
| Has a client secret | No | **Yes** (`shpss_…`-style secret) |
| Where it runs | SPA / mobile / Hydrogen (browser) | **Server with a session store** (Next.js on Vercel) |
| Code→token exchange | `code` + **PKCE `code_verifier`** | `code` + **client_id/client_secret** (HTTP Basic on the token endpoint); PKCE *optional but recommended* |
| Refresh token lives | in the browser (risky) | **server-side only** (our DB, encrypted) |

Shopify's own definitions: a **confidential** client *"[has] a back-end to
perform the authorization request and a server-side session to hold the refresh
token"*; a **public** client *"[is] strictly client-side … [with] no server-side
session where they can store the refresh token safely."*
([getting-started](https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api/getting-started),
[community: Headless auth](https://community.shopify.dev/t/customer-account-api-with-headless/23450))

**What it needs (registration):** a Customer Account API client created under the
Headless channel, configured **as confidential**, yielding:
- **Client ID**
- **Client secret** — stored in our Vercel env (proposed
  `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID` / `..._CLIENT_SECRET`), never shipped to
  the widget.
- **Callback URL(s)**, **JavaScript origin(s)**, **Logout URI** (see §3).

> **Why confidential, concretely for us:** the widget runs in the storefront
> theme — an environment we treat as untrusted for secrets (it already only ever
> sees `x-ms-chat-key`, never Shopify Admin creds). A confidential client keeps
> the secret and **both tokens on the Vercel backend**, so the browser never
> holds a customer access or refresh token. This matches the existing trust
> boundary in `src/lib/security.ts`.

**[VERIFY]** that the Headless channel exposes a **confidential** client type for
Customer Account API (vs. only public/PKCE). Check: on the Customer Account API
settings page, look for a client-type selector or a generated **client secret**
field. If only public/PKCE is offered, fall back to **public client + PKCE with
the code exchange still performed server-side** (the widget gets the `code`, the
backend does the PKCE exchange) — see §4; functionally equivalent for our
secret-handling goal.

---

## 3. OAUTH FLOW — authorization code + (optional) PKCE against discovery

### 3.1 Discovery (do this, don't hardcode)

Fetch on the **storefront domain** (`www.motionsports.de`):

- `GET /.well-known/openid-configuration`
- `GET /.well-known/customer-account-api`

The OpenID document returns `authorization_endpoint`, `token_endpoint`,
`end_session_endpoint` (logout), and `jwks_uri` (for `id_token` verification).
The customer-account-api document returns the **GraphQL endpoint** for data
queries (§6).
([authenticate-customers](https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api/authenticate-customers),
[community: scopes](https://community.shopify.com/t/customer-account-api-scopes/287504/2))

Cache the discovery documents (they are stable) but treat them as the source of
truth for URLs.

### 3.2 Authorization request (browser → Shopify)

Redirect the customer's browser to `authorization_endpoint` with:

| Param | Value |
|---|---|
| `client_id` | our Customer Account API client id |
| `response_type` | `code` |
| `redirect_uri` | a **registered** callback (see 3.4) |
| `scope` | `openid email customer-account-api:full` |
| `state` | signed value binding the widget's `session_id` (CSRF + return state) |
| `nonce` | random, checked against `id_token.nonce` |
| `code_challenge` / `code_challenge_method` | `S256` — **if** using PKCE (mandatory for public client; optional+recommended for confidential) |

Scopes: `openid` (OIDC, yields `id_token`), `email` (email claim),
`customer-account-api:full` (full read access to the customer's data).
([authenticate-customers](https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api/authenticate-customers))

### 3.3 Token exchange (our backend → Shopify, server-side)

`POST` to `token_endpoint` with `grant_type=authorization_code`, the `code`, the
`redirect_uri`, and:
- **Confidential:** `client_id` + `client_secret` in the **Authorization: Basic**
  header (and the `code_verifier` if PKCE was used).
- **Public:** `client_id` + `code_verifier` in the body.

Response: `access_token`, `refresh_token`, `id_token`, `expires_in` (seconds),
`token_type`. ([getting-started](https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api/getting-started),
[community: Headless auth](https://community.shopify.dev/t/customer-account-api-with-headless/23450))

> **[VERIFY] token-endpoint header for the Customer Account API specifically.**
> Some Shopify flows require an additional exchange step / `Origin` header. Check
> the rendered *authenticate-customers* page for the exact header set the day we
> build. A 401 `invalid_token` at GraphQL time usually means a missing/`unlisted`
> **Origin** header — register the JS origin (3.4).

### 3.4 Where to register URLs, and the exact URLs for us

Registered on the **Customer Account API settings page** under the Headless
channel ("Application setup" / "Application endpoints").
([getting-started](https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api/getting-started),
[buildwithmatija](https://www.buildwithmatija.com/blog/shopify-customer-account-api-headless-authentication))

| Setting | Value for us | Why |
|---|---|---|
| **Callback URL(s)** | `https://chat.motionsports.de/api/auth/shopify/callback` | The confidential exchange happens on the **backend**, so the callback lands on Vercel, not the theme. HTTPS required. |
| **JavaScript origin(s)** | `https://www.motionsports.de`, `https://motionsports.de` | The widget origin that initiates the redirect / (if ever) calls the API from JS. Mismatch → 401 `invalid_token`. |
| **Logout URI** | `https://chat.motionsports.de/api/auth/shopify/logout/return` (or back to `https://www.motionsports.de`) | Where Shopify returns the browser after `end_session_endpoint`. |

The endpoint URLs (authorization/token/logout) are **read from** that same
settings page **and** from discovery (3.1) — discovery is preferred at runtime.

---

## 4. THE WIDGET POSITION PROBLEM

The widget is in the theme (`motionsports.de`); the backend is on Vercel
(`chat.motionsports.de`); they are cross-origin. Two sub-problems:

### (a) Detect an already-signed-in storefront session (skip login)

The customer is often **already logged in to their Shopify account** on
`motionsports.de`. We want to recognise that and skip the login UI.

**Do NOT rely on `logged_in_customer_id` / the Liquid `customer` object.** With
**new customer accounts** these are documented to be **unreliable / empty even
when the customer is signed in** — a known regression.
([community: empty logged_in_customer_id](https://community.shopify.com/t/issue-new-customer-accounts-and-empty-logged-in-customer-id-value/358016),
[community: customer liquid null](https://community.shopify.dev/t/customer-liquid-object-not-working-on-new-accounts/10114))

Options:

| Option | How | Verdict |
|---|---|---|
| Liquid `customer` / `logged_in_customer_id` injected into widget bootstrap | theme passes it to widget | ❌ unreliable on new customer accounts |
| `ShopifyAnalytics.meta.page.customerId` in JS | read global | ⚠️ best-effort hint only; not authoritative, may be absent ([learnersbucket](https://learnersbucket.com/examples/shopify/how-to-check-if-customer-is-logged-in-in-shopify/)) |
| **Silent OAuth (`prompt=none`)** against `authorization_endpoint` | run the §3 flow with `prompt=none`; if a storefront session exists Shopify returns a `code` with **no UI**, else returns `login_required` | ✅ **authoritative, standard OIDC** — recommended |

**Recommendation (a):** On widget open (or when the user first reaches for a
feature that needs identity), the backend attempts a **silent authorization with
`prompt=none`** in a hidden flow. Success → we have tokens and a
`shopify_customer_id` with zero clicks. Failure (`login_required`) → fall back to
the explicit login in (b). Use `ShopifyAnalytics.meta.page.customerId`, if
present, only as a cheap pre-check to decide whether silent auth is worth
attempting.

> **[VERIFY] `prompt=none` support** on Shopify's `authorization_endpoint`.
> Concrete check: against the dev store, hit the authorization endpoint with
> `prompt=none` while logged in (expect a redirect back with `code`) and while
> logged out (expect redirect back with `error=login_required`). If `prompt=none`
> is not honoured, degrade to: show a subtle "Sign in" affordance and skip silent
> detection entirely (no functional loss, one extra click).

### (b) Initiate login and return to the SAME conversation

Constraint: the conversation thread is keyed by `session_id` in the **widget's
localStorage** on `motionsports.de`. The OAuth dance leaves that origin.

| Option | Flow | Trade-offs |
|---|---|---|
| **New tab / popup** | open Shopify login in a popup, postMessage the result back | ⚠️ popup blockers; **storage partitioning / ITP** can break cross-origin `postMessage` + the opener relationship; fragile on mobile Safari |
| **Full-page redirect with return-state** | widget persists conversation to localStorage → redirect top-level to Shopify → callback on Vercel → redirect back to `motionsports.de` → widget **re-hydrates from localStorage** | ✅ robust everywhere; survives ITP; one full reload |

**Recommendation (b): full-page top-level redirect with return-state.** Concrete
sequence:

1. Widget already holds `session_id` in localStorage (it does today). Before
   redirecting, it ensures the open conversation is persisted server-side (it is
   — every turn is written to `conversations`/`messages`) and stores a tiny
   `return` marker in localStorage (e.g. scroll position / "resume after login").
2. Widget calls `GET https://chat.motionsports.de/api/auth/shopify/login?session=<session_id>`.
   Backend mints `state` (signed, embedding `session_id` + nonce + PKCE verifier),
   stores the pending-auth record, and **302**s the top-level window to
   Shopify's `authorization_endpoint`.
3. Customer authenticates (or silent in 4a). Shopify → `…/api/auth/shopify/callback?code&state`.
4. Backend validates `state`, exchanges `code` for tokens **server-side**,
   reads `id_token.sub`/`customer { id }` → `shopify_customer_id`, **persists
   tokens** (§5), **links** `session_id → customer` (re-keys/merges by email,
   §6/data-model), then **302**s the browser back to
   `https://www.motionsports.de/<page the widget was on>` (carried in `state`).
5. The widget re-mounts on page load, reads the **same `session_id`** from
   localStorage, calls a new `GET /api/auth/me?session=<session_id>` — backend
   returns the now-linked identity → the **same conversation** continues, now
   tier-3.

Because the conversation is server-persisted and the `session_id` is stable in
localStorage across the redirect, **re-hydration is automatic**: the widget does
what it already does on reload, plus one identity probe.

---

## 5. TOKENS — lifetime, refresh, storage, → `shopify_customer_id`

**Token lifetimes — [VERIFY] before coding the refresh loop.** The search index
repeatedly returned **Admin offline-token** numbers (access **1h/3600s**,
refresh **90 days**, rotation on use — a Dec-2025 change), which are **not**
guaranteed to be the Customer-Account-API numbers. Customer Account API tokens
are commonly shorter-lived (on the order of ~2h access **[VERIFY]**) with a
refresh token. **Do not hardcode**: read `expires_in` from each token response
and refresh against that. Concrete check: log the `expires_in` returned by the
dev-store token endpoint, and read the rendered *authenticate-customers* page's
"Refresh the access token" section.
([offline-token changelog, for contrast](https://shopify.dev/changelog/offline-access-tokens-now-support-expiry-and-refresh),
[Nango: invalid_grant](https://nango.dev/blog/shopify-oauth-refresh-token-invalid-grant))

**Refresh flow:** `POST token_endpoint` with `grant_type=refresh_token` +
`refresh_token` (+ client creds for confidential). Expect **rotation**: the old
refresh token is invalidated and a new `access_token`/`refresh_token` pair
returned — **persist the new pair atomically** or the next refresh fails with
`invalid_grant`. ([Nango: invalid_grant](https://nango.dev/blog/shopify-oauth-refresh-token-invalid-grant))

**Storage (server-side, encrypted):** tokens live only in the Neon DB
(`customer_oauth_tokens`, data-model below), **encrypted at rest** with a key
from Vercel env (we already keep secrets there; add `TOKEN_ENC_KEY`). Never sent
to the widget. Refresh happens lazily on demand: before any Customer-Account-API
call, if `now > expires_at - buffer`, refresh first — mirroring the existing
Admin-token pattern in `src/lib/shopify.ts` (5-min refresh buffer), but
**per-customer and DB-backed** (serverless = no shared in-memory cache).

**Token → stable `shopify_customer_id`:** two equivalent sources, prefer the
GraphQL one for canonical form:
- **`id_token`** (a JWT): verify signature against `jwks_uri`, check `nonce`,
  `aud`, `iss`; the **`sub` claim is the stable customer identifier**.
- **GraphQL** `customer { id }` → `gid://shopify/Customer/<NUMERIC>`. Store the
  full **GID** plus the extracted **numeric** as `shopify_customer_id`. This GID
  is stable for the life of the customer record and is what we key the DB on.

> **[VERIFY]** that `id_token.sub` equals the numeric in `customer { id }`'s GID
> (they should correspond). Check: decode `sub` and compare to the GraphQL
> `customer.id` on the dev store. We key on the **GraphQL GID's numeric** as the
> canonical `shopify_customer_id` regardless.

---

## 6. DATA AVAILABLE for a signed-in customer

Queried at the **Customer Account API GraphQL endpoint** (from §3.1 discovery)
with the customer `access_token` (`Authorization: <access_token>`), scope
`customer-account-api:full`. The customer can only ever see **their own** data —
the token is customer-scoped, not store-scoped.
([Customer Account API reference](https://shopify.dev/docs/api/customer/latest))

| Data | Field (Customer Account API) | Notes |
|---|---|---|
| Name | `customer { firstName lastName displayName }` | authoritative identity |
| Email | `customer { emailAddress { emailAddress } }` *(shape [VERIFY] vs `email`)* | verified by Shopify |
| Default address | `customer { defaultAddress { … } }` | |
| All addresses | `customer { addresses(first:n) { … } }` | |
| Order history | `customer { orders(first:n) { … } }` | incl. **line items**: `orders { edges { node { lineItems { … } totalPrice … } } }` |
| Phone | `customer { phoneNumber { phoneNumber } }` *([VERIFY] shape)* | if present |
| Marketing consent | see §7 | **[VERIFY]** exposure on Customer Account API |

All of the above is covered by **`customer-account-api:full`**; there is no
narrower per-field scope split documented for the read fields we need — it is a
single broad read scope plus the OIDC `openid`/`email` scopes for the
`id_token`/email claim.
([authenticate-customers](https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api/authenticate-customers))

> **[VERIFY] exact field shapes/names** against the rendered
> `https://shopify.dev/docs/api/customer/<version>` schema the day we build — the
> Customer Account API object graph differs from the **Admin** `Customer` object
> (e.g. Admin uses `emailMarketingConsent`, `defaultEmailAddress`, `addresses`;
> Customer Account API wraps some scalars in objects). Treat the table as the
> shape to confirm, not copy-paste-ready selections. The search index surfaced
> mostly **Admin** `Customer` examples, so field names there are *not*
> authoritative for this API.

---

## 7. EXISTING-CUSTOMER MARKETING STATE (read-only report)

Shopify stores the customer's **email-marketing consent** state. On the **Admin**
API it is `customer { emailMarketingConsent { marketingState marketingOptInLevel
consentUpdatedAt } }`. Whether the **Customer Account API** exposes the same to
the customer-scoped token is **[VERIFY]** — check the rendered Customer Account
API schema for a marketing-consent field on `customer`.
([Admin Customer object](https://shopify.dev/docs/api/admin-graphql/latest/objects/Customer))

If the Customer Account API does not expose it, we **can** read it via our
existing **Admin** client (we already hold order/customer read scopes per
`docs/`), keyed by the `shopify_customer_id` we now have — i.e. an Admin-side
lookup, not a customer-token call.

> **Policy reminder (carried from the task): we will NOT use Shopify's marketing
> consent as our DOI consent.** Our DOI lives in `email_captures` /
> `customers.marketing_status` (`migrations/0008`, `docs/CONSENT_FLOW.md`) and
> stays the single source of truth for sending. Shopify's state is **report-only**
> — surfaced to the admin for context, never auto-promoted to `confirmed`.

---

## 8. RATE / SCOPE

**Scopes:** Customer Account API uses its **own** scopes
(`openid`, `email`, `customer-account-api:full`) on its **own** client — they are
**not** the Admin `read_*`/`write_*` scopes our client-credentials app holds, and
they live on a **separate Customer-Account-API client** under the Headless
channel. So this is **a separate client, not new scopes on the existing app**.
The existing Admin client (`src/lib/shopify.ts`) is untouched.

**Rate limits (Customer Account API):** a **calculated-cost** model, **per app
per store-and-customer**:
- Bucket: **7,500 cost points**, replenishing **100 or 200 points/sec** by plan.
- Most fields **1 point**; most mutations **10 points**.
- Single query hard cap **1,000 points** (enforced pre-execution).
- Cost + remaining quota returned under `extensions`; add
  `Shopify-GraphQL-Cost-Debug=1` for a breakdown.
([Shopify API limits](https://shopify.dev/docs/api/usage/limits))

**At our volume:** limits are **per customer**, and our calls are a handful of
small reads per sign-in (identity + recent orders). Even a heavy customer query
is well under 1,000 points and the per-customer bucket is effectively never a
constraint for interactive chat. No batching/queueing infra needed; just handle
the occasional `THROTTLED` with a backoff retry. The Admin-side daily catalog
sync is unaffected (different bucket, different client).

---

## RECOMMENDED auth architecture

1. **Confidential Customer-Account-API client** under the Headless channel
   (fallback: public client whose `code` exchange we still run server-side).
   Secret + both tokens live only on the Vercel backend; the widget never holds a
   customer token.
2. **Discovery-driven OAuth 2.0 authorization-code flow + PKCE (`S256`)**, scopes
   `openid email customer-account-api:full`, endpoints resolved from
   `/.well-known/openid-configuration` + `/.well-known/customer-account-api` on
   `www.motionsports.de`. Token exchange & refresh on the backend; refresh-token
   rotation handled atomically; lifetimes read from `expires_in` at runtime
   (**not** hardcoded — see §5 [VERIFY]).
3. **Already-signed-in detection: silent auth (`prompt=none`)** on widget open
   (with `ShopifyAnalytics.meta.page.customerId` as a cheap pre-hint); fall back
   to explicit login. **Never** trust `logged_in_customer_id` on new customer
   accounts.
4. **Return-to-conversation: full-page top-level redirect with signed `state`**
   carrying `session_id` + return URL; callback on
   `https://chat.motionsports.de/api/auth/shopify/callback`; backend links
   `session_id → shopify_customer_id` and redirects back to the storefront page;
   the widget **re-hydrates from the unchanged localStorage `session_id`** plus a
   `GET /api/auth/me` identity probe. (Popup/new-tab rejected — ITP / storage
   partitioning fragility.)
5. **Key the DB on the GraphQL `customer.id` GID's numeric** as
   `shopify_customer_id`; verify the `id_token` (`jwks_uri`, `nonce`); **merge
   tier-2↔tier-3 by email** (below).

### Required follow-ups (Lucas store actions — explicit)

- **Lucas (admin):** install **Headless** sales channel; create a **Customer
  Account API client** (confidential if offered); set **Settings → Customer
  accounts** to the **new** version. Do it on a **dev store first**.
- **Lucas → us:** hand over **Client ID**, **Client secret**, and confirm the
  three endpoint URLs.
- **Lucas (admin):** register our URLs on the Customer Account API settings page —
  Callback `https://chat.motionsports.de/api/auth/shopify/callback`; JavaScript
  origins `https://www.motionsports.de` + `https://motionsports.de`; Logout URI
  `https://chat.motionsports.de/api/auth/shopify/logout/return`.
- **Us, before build:** resolve every **[VERIFY]** against the dev store —
  chiefly (i) confidential client availability (§2), (ii) `prompt=none` support
  (§4a), (iii) **token lifetimes/refresh shape** (§5), (iv) Customer-Account-API
  **field names** + marketing-consent exposure (§6/§7).

### Data-model sketch for CA-1

New + altered tables (migration `00NN_customer_accounts.sql`). The **email is the
merge key** between the existing email-keyed `customers` row (tier 2) and the new
Shopify identity (tier 3).

```sql
-- 1) Re-key customers with the Shopify identity (nullable: tiers 1/2 have none).
ALTER TABLE customers
  ADD COLUMN shopify_customer_id  TEXT UNIQUE,        -- numeric from the GID; the tier-3 key
  ADD COLUMN shopify_customer_gid TEXT,               -- gid://shopify/Customer/<id>, canonical
  ADD COLUMN shopify_linked_at    TIMESTAMPTZ,        -- when sign-in first bound this row
  ADD COLUMN identity_tier        SMALLINT NOT NULL DEFAULT 1; -- 1 anon, 2 email, 3 signed-in

-- 2) Server-side encrypted token store (one current row per customer).
CREATE TABLE customer_oauth_tokens (
  customer_id           BIGINT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE,
  access_token_enc      BYTEA NOT NULL,   -- encrypted at rest (TOKEN_ENC_KEY)
  refresh_token_enc     BYTEA NOT NULL,   -- rotated on every refresh; store atomically
  id_token_sub          TEXT,             -- OIDC subject, for cross-check
  scope                 TEXT NOT NULL,
  access_expires_at     TIMESTAMPTZ NOT NULL,  -- from expires_in at exchange/refresh time
  refresh_expires_at    TIMESTAMPTZ,           -- [VERIFY] lifetime (see §5)
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3) Short-lived pending-auth records (CSRF state + PKCE + return target).
CREATE TABLE customer_auth_pending (
  state          TEXT PRIMARY KEY,        -- random; mirrored (signed) in the OAuth state param
  session_id     TEXT NOT NULL,           -- the widget thread to re-link on return
  code_verifier  TEXT NOT NULL,           -- PKCE
  nonce          TEXT NOT NULL,           -- checked against id_token.nonce
  return_url     TEXT NOT NULL,           -- storefront page to send the browser back to
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL     -- ~10 min TTL
);
```

**Email ↔ shopify merge logic (on successful sign-in):**

1. From the verified Shopify `email` + `shopify_customer_id`.
2. `SELECT` a `customers` row by `shopify_customer_id` (already linked) → use it.
3. Else `SELECT` by normalised `email` (existing tier-2 row) → **stamp**
   `shopify_customer_id`/`gid`/`shopify_linked_at`, bump `identity_tier = 3`.
   This is the merge: the consent/profile/transcript history we already have for
   that email is now also the signed-in customer's.
4. Else **create** a new tier-3 `customers` row (email + shopify ids).
5. **Conflict case [VERIFY/handle]:** an existing email row whose email differs
   from Shopify's verified email, or two rows colliding (one by email, one by
   shopify id) → prefer the Shopify-verified email as authoritative for the
   identity, log a merge-conflict for admin review rather than silently fusing
   consent records (consent provenance must stay auditable — `docs/CONSENT_FLOW.md`).
6. Link the current `conversation.customer_id` (existing pattern in
   `src/lib/customer-store.ts::linkCustomerOnEmailCapture`, generalised from
   "email capture" to "identity bind").

> Note on consent: re-keying never *imports* Shopify's marketing state into our
> `marketing_status` (§7). Tier-3 sign-in establishes **identity**, not
> **marketing consent** — our DOI remains the only path to `confirmed`.

---

## Source list

- Getting started — Customer Account API: https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api/getting-started
- Authenticate customers (auth flow, scopes, refresh): https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api/authenticate-customers
- Customer Account API reference (data graph): https://shopify.dev/docs/api/customer/latest
- Building with the Customer Account API (overview): https://shopify.dev/docs/storefronts/headless/building-with-the-customer-account-api
- Shopify API usage limits (rate limits / cost model): https://shopify.dev/docs/api/usage/limits
- Admin `Customer` object (for marketing-consent field contrast): https://shopify.dev/docs/api/admin-graphql/latest/objects/Customer
- Offline access tokens now support expiry/refresh (Admin contrast, §5): https://shopify.dev/changelog/offline-access-tokens-now-support-expiry-and-refresh
- New customer accounts requirements (Help Center): https://help.shopify.com/en/manual/customers/customer-accounts/new-customer-accounts/identity-provider/requirements
- Community — Customer Account API with Headless: https://community.shopify.dev/t/customer-account-api-with-headless/23450
- Community — Customer Account API scopes: https://community.shopify.com/t/customer-account-api-scopes/287504/2
- Community — empty `logged_in_customer_id` on new customer accounts: https://community.shopify.com/t/issue-new-customer-accounts-and-empty-logged-in-customer-id-value/358016
- Community — `customer` Liquid object null on new accounts: https://community.shopify.dev/t/customer-liquid-object-not-working-on-new-accounts/10114
- Nango — Shopify OAuth refresh `invalid_grant` (rotation pitfall): https://nango.dev/blog/shopify-oauth-refresh-token-invalid-grant
- DEV — Shopify New Customer Accounts 2026 (Feb-2026 legacy deprecation): https://dev.to/ogresto/shopify-new-customer-accounts-2026-what-changed-what-broke-and-what-to-do-38h8
- Build with Matija — headless Customer Account API auth (URL registration): https://www.buildwithmatija.com/blog/shopify-customer-account-api-headless-authentication
- No7 Software — Customer Accounts API passwordless in production (2026): https://no7software.co.uk/blog/shopify-customer-accounts-api-passwordless
- LearnersBucket — detecting logged-in customer (JS hint): https://learnersbucket.com/examples/shopify/how-to-check-if-customer-is-logged-in-in-shopify/

> All `shopify.dev` / `help.shopify.com` URLs above were **403 to automated
> fetch** during this spike; open them in a browser to confirm. The community,
> DEV, Nango, Matija, No7 and LearnersBucket links are directly fetchable.
