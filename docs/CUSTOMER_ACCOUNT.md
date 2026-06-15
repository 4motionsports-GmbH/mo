# Customer Account sign-in (tier-3 identity)

> **Status:** CA-1 shipped — auth + identity model + token handling. **CA-2/CA-3
> shipped** — the signed-in customer's Customer Account data (name, addresses,
> full order history) is now pulled and fed into the internal profile **and** the
> live chat via the existing customer-memory mechanism, under the same consent
> gate and data-minimisation (see [§8](#8-signed-in-data-in-the-profile--live-chat-ca-2--ca-3)).
> **Signed-in conversation history** (list / fetch / rename / delete + full
> "delete my data") is documented in [§9](#9-signed-in-conversation-history-tier-3).
> **CA-4** (at-sign-in marketing opt-in) is in [§10](#10-at-sign-in-marketing-opt-in--the-match-up-ca-4),
> which also pins the **tier-3 suppression contract** (the end-of-chat capture
> widget is suppressed for signed-in customers; the opt-in moves to sign-in) and
> the `marketing.optInActionable` state. The signed-in **conversation summary
> download** (the S5 summary email reused as a downloadable HTML document) is in
> [§11](#11-conversation-summary-download-signed-in-s5-structure-reused).
> The authoritative feasibility report is
> [`CUSTOMER_ACCOUNT_SPIKE.md`](./CUSTOMER_ACCOUNT_SPIKE.md); this document
> describes what was built.

This adds a **third identity tier** to the chat: a *signed-in Shopify customer*.
It is built on the Shopify **Customer Account API** with an OAuth 2.0
**authorization-code + PKCE (S256)** flow. The browser **never holds tokens** —
the widget only ever triggers a top-level redirect; the **backend** performs the
PKCE code exchange and holds both tokens server-side, encrypted.

## 1. The three identity tiers (tiers 1–2 are unchanged)

| Tier | Key | Created by | Authoritative for |
|---|---|---|---|
| 1 — Anonymous | `session_id` (localStorage thread id) | every visit | nothing (pseudonymous) |
| 2 — Identified | normalised **email** | `/api/capture-email` (consent + DOI) | our consent record |
| **3 — Signed-in** | **`shopify_customer_id`** (GID numeric) | Customer Account sign-in | **Shopify**: name, email, addresses, orders |

The model from [`CUSTOMERS.md`](./CUSTOMERS.md) / [`DATA_RETENTION.md`](./DATA_RETENTION.md)
**still holds**: anonymous stays pseudonymous and unlinked; the email-only
capture/DOI/consent-audit flow stays the *no-account fallback*; the two clusters
stay separate; "email lives in one place"; bridges are consent-anchored; and
re-identification fails closed. Tier 3 is **added**, never a weakening of 1–2.

**What's authoritative where (tier 3):**

- **Shopify** owns the *identity*: name, verified email, addresses, order
  history. We re-fetch these live (we don't cache customer PII names in CA-1).
- **Our DB** owns what Shopify doesn't: transcripts, analytics, **our DOI
  consent**, profile/persona — re-keyed by `shopify_customer_id`.
- **Marketing consent stays ours.** Signing in establishes **identity, not
  marketing consent**. Re-keying **never** imports Shopify's marketing state into
  `marketing_status` — our DOI (`email_captures` / `customers.marketing_status`)
  remains the only path to `confirmed`. See [`CONSENT_FLOW.md`](./CONSENT_FLOW.md).

## 2. The PKCE authorization-code flow

All redirect/callback URLs are built from `PUBLIC_BASE_URL` (never hardcoded), so
the later DNS cutover to `chat.motionsports.de` is just an env flip + re-registering
the URLs in the Shopify admin.

```
 widget (storefront, motionsports.de)        backend (Vercel)            Shopify (account.motionsports.de)
 ────────────────────────────────────        ─────────────────          ──────────────────────────────────
 top-level redirect →  GET /api/auth/shopify/login?session=&return_url=
                                              mint code_verifier+nonce
                                              sign state, store pending
                       302 →──────────────────────────────────────────→  authorization_endpoint (?code_challenge=S256, prompt?)
                                                                          customer authenticates
                       ←──────────────────────  302 /api/auth/shopify/callback?code&state
                                              verify state + consume pending
                                              POST token_endpoint (code + verifier)   ← SERVER-SIDE
                                              verify id_token (jwks/nonce/aud/iss)
                                              GraphQL customer{ id } → shopify_customer_id
                                              merge (email↔shopify), encrypt+store tokens
                       ←──────────────────  302 return_url?ms_auth=ok
 widget re-mounts, reads same session_id,
 GET /api/auth/me?session= → { name, tier }
```

### Endpoints (all under `/api/auth`)

| Route | Method | Guard | Purpose |
|---|---|---|---|
| `/api/auth/shopify/login` | GET | signed state + origin-allowlisted `return_url` | mint PKCE/state, store pending, 302 to Shopify |
| `/api/auth/shopify/callback` | GET | signed state + single-use pending | exchange code, verify id_token, merge, store tokens, 302 back |
| `/api/auth/me` | GET | origin allowlist + `x-ms-chat-key` | identity re-hydration (`{ name, tier }`), fail-closed |
| `/api/auth/shopify/logout` | GET | top-level navigation + return-url allowlist | server-INITIATE logout: build the OIDC `end_session` redirect from discovery, 302 to Shopify |
| `/api/auth/shopify/logout/return` | GET | top-level navigation | drop tokens for the session, 302 back to storefront `?ms_auth=logged_out` |

`login`, `callback`, `logout`, and `logout/return` are **top-level navigations**
(like the email-clicked confirm/unsubscribe routes) — no CORS/secret guard. The
auth pair is protected by the **signed `state`** + the **server-side pending
record**; the logout pair by the **return-url origin allowlist** (logout is
server-initiated — it builds the OIDC `end_session` redirect from discovery,
since the widget can't, and degrades to a local token-drop sign-out when the
store advertises no `end_session_endpoint`).
`/api/auth/me` is a widget **XHR**, so it carries the origin allowlist + shared
secret like `/api/chat`.

### Discovery is the source of truth

Endpoints are resolved at runtime from the storefront domain and cached for 1h:

- `GET https://<SHOPIFY_STOREFRONT_DOMAIN>/.well-known/openid-configuration`
  → `issuer`, `authorization_endpoint`, `token_endpoint`, `end_session_endpoint`,
  `jwks_uri`, `token_endpoint_auth_methods_supported`.
- `GET .../.well-known/customer-account-api` → the GraphQL endpoint.

We **never** hardcode the auth host; we never fetch the `account.*` subdomain
(only the browser is redirected there). Nothing in CORS/redirect handling assumes
a single origin.

### Already-signed-in detection (shop-native **and** chatbot) — `GET /api/auth/storefront`

**The problem.** A customer who logs in via the **shop's own login** (the
storefront account icon), then opens the chat, must be recognised too — not only
the chatbot's "Anmelden" OAuth. The widget is in the theme (`motionsports.de`); the
backend is cross-origin on Vercel, so it **cannot read the storefront session
cookie**, and the spike flagged `logged_in_customer_id` / the Liquid `customer`
object as **unreliable on new customer accounts** (and a client-supplied id is
forgeable). The original CA-3 detection (`/api/auth/me` + a deferred `prompt=none`)
therefore only ever recognised the **chatbot-OAuth** path.

**The mechanism — a Shopify App Proxy.** An App Proxy is the one channel where
Shopify itself vouches the logged-in customer to a cross-origin backend: the
storefront calls a **same-origin** path (`/apps/{proxy}/whoami`), Shopify forwards
it to our backend **adding** `logged_in_customer_id` (the LIVE storefront session's
customer) and an HMAC `signature` over all params. `GET /api/auth/storefront`
verifies the signature (`lib/shopify-app-proxy.verifyAppProxySignature`), trusts
**only** Shopify's `logged_in_customer_id`, and — now that **`read_customers`** is
granted — enriches the **name/email via the Admin API**
(`lib/shopify-orders.fetchAdminCustomerById`), with **no customer OAuth token**.
Detection therefore only establishes **IDENTITY**; the Admin API supplies the rest,
so it **does not matter how the customer logged in**. It then find-or-creates the
customer (the same `bindShopifyIdentity` merge as the OAuth callback) and links the
widget `session_id`. Response:
`{ signedIn: true, name, tier: 3, shopify_customer_id, identity:{name,tier}, marketing:{…} }`.
**Fail-closed:** bad/absent signature or a logged-out (empty id) session →
`{ signedIn: false }`; no Admin/DB work happens until the signature verifies.

> **⚠️ REQUIRES A ONE-TIME STORE + THEME ACTION (Lucas) before it can fire:**
> 1. **Add an App Proxy** to the app — Shopify admin → the app → *App proxy*:
>    **Subpath prefix** `apps`, **Subpath** `chat`, **Proxy URL**
>    `https://chat.motionsports.de/api/auth/storefront`.
> 2. **Theme** calls the proxied same-origin path `/apps/chat/whoami?session={sid}`
>    on first panel open (see `frontend-handoff/CUSTOMER_ACCOUNT.md` §3a).
> 3. **Backend env** `SHOPIFY_APP_PROXY_SECRET` = the app's API secret key (falls
>    back to `SHOPIFY_CLIENT_SECRET`).
> 4. **Re-verify on the live store** that App-Proxy `logged_in_customer_id` is
>    populated for this store's customer-accounts mode (the spike's "unreliable"
>    finding predates Shopify's fixes). The endpoint fails closed regardless, and
>    the chatbot "Anmelden" remains the fallback — so this is never a security risk.
>
> History for a *pure shop-native* session: `/api/account/*` still require a live
> Customer-Account token (their liveness/logout proof), which a shop-native login
> doesn't have. Detection (name) works without it; full history for that session
> needs either a one-tap chatbot "Anmelden" (to mint a token) or routing the
> account endpoints through the App Proxy as a follow-up — STATED here, not
> half-built.

### `prompt=none` silent detection (alternative)

`/api/auth/shopify/login?...&prompt=none` runs the same OAuth flow with
`prompt=none`. When a storefront session exists Shopify returns a `code` with **no
UI**; when logged out it returns `error=login_required` → a
`return_url?ms_auth=login_required` bounce. It is authoritative but a full-page
redirect (the theme deferred it, see `CUSTOMER_ACCOUNT_THEME_NOTES.md`); it remains
available where the App Proxy isn't configured.

## 3. Token handling, rotation, encryption

- **Client posture:** PUBLIC client, **no secret** (confirmed setup). The token
  exchange is attempted as a public client (`client_id` + PKCE `code_verifier`).
  Discovery advertises `client_secret_basic` and not `none`, so this is verified
  **empirically** by `npm run verify:customer-account` (see §5). If the token
  endpoint rejects the public exchange for missing client authentication, set
  `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET` after switching the client to
  *Confidential* in Shopify admin — the backend then uses `client_secret_basic`
  automatically. **No code change**, just an env flip.
- **Lifetimes are read from the response** (`expires_in` / `refresh_token_expires_in`)
  — never hardcoded.
- **Refresh-token rotation** is handled atomically: a refresh persists the **new**
  access+refresh pair in one `UPDATE` before returning. A hard rejection
  (`invalid_grant`) drops the stored pair so the customer re-authenticates.
  Refresh happens lazily, on demand, with a 2-minute buffer
  (`lib/customer-oauth-store.ts::getValidAccessToken`).
- **Encrypted at rest:** access + refresh tokens are AES-256-GCM encrypted under
  `TOKEN_ENC_KEY` (`lib/token-crypto.ts`) and stored in `customer_oauth_tokens`.
  They are **never** sent to the browser.
- **id_token verification:** signature checked against `jwks_uri` (RS256 only —
  `alg:none` and HMAC are rejected), plus `iss` / `aud` / `nonce` / `exp`. The
  `sub` is recorded for cross-checking; we key the DB on the **GraphQL
  `customer.id` GID's numeric**.
- The Customer Account GraphQL call sends the access token **directly** in the
  `Authorization` header (no `Bearer ` prefix), per Shopify.

## 4. The email↔Shopify merge rule (on every sign-in)

Implemented as a pure decision (`lib/customer-merge.mjs::decideMerge`, unit-tested)
+ DB writes (`lib/customer-store.ts::bindShopifyIdentity`). Email is the merge key.

1. **(a)** Row already linked by `shopify_customer_id` → **use it**.
2. **(b)** Else a tier-2 row matches the **verified email** → **stamp** it with
   the Shopify ids + `identity_tier = 3`. This carries the existing consent /
   profile / transcript history forward to the signed-in identity.
3. **(c)** Else **create** a fresh tier-3 row.
4. **(d) Conflict** — either the linked row's email differs from Shopify's
   verified email (`email_mismatch`), or an email-row and a shopify-id-row
   collide (`row_collision`): we **prefer Shopify's verified email as the
   authoritative identity** but **do not silently fuse consent records**. The
   established Shopify-linked row is used and a row is written to
   `customer_merge_conflicts` for **admin review** (consent provenance must stay
   auditable). We never overwrite the consent-anchored email on a mismatch.

`linkCustomerOnEmailCapture` (tier 2) and `bindShopifyIdentity` (tier 3) are the
two entry points of the generalised "identity bind"; both never weaken an
existing tier (`GREATEST(identity_tier, …)`) and both persist the session →
customer link **two** ways:

1. a **direct** row in `customer_session_links` (`session_id` PK → `customer_id`,
   migration `0019`) — this is the **authoritative re-hydration link**, and
2. the legacy `conversations.customer_id` stamp (`WHERE session_id = …`) — which
   carries the chat into the customer's **history**.

The direct link exists because the conversation stamp alone is **not** a reliable
identity link: at sign-in there is frequently **no conversation row yet** for the
session (the `prompt=none` silent check on first widget open, or clicking
"Anmelden" before sending any message), so the `UPDATE … WHERE session_id` matches
zero rows and the link is silently lost. Writing `customer_session_links`
unconditionally fixes that — identity resolves even with no chat history.

### The signed-in resolver

`resolveSignedInCustomer(sessionId)` maps the opaque widget session reference →
the linked customer (must have a `shopify_customer_id`). It reads the **direct**
`customer_session_links` row first, falling back to the legacy
`conversations.customer_id` stamp (so sessions linked before migration `0019`'s
backfill still resolve). `/api/auth/me` then proves the session is still live by
obtaining a **valid access token** (refreshing if needed) before reporting
`signedIn: true`. Everything fails closed — a blank/unlinked session, or one
linked only to a tier-1/2 customer (no `shopify_customer_id`), resolves to null.

A successful round-trip: login (`?session={sid}`) → callback binds + writes
`customer_session_links[sid]` → callback 302s back to `return_url` **with
`?ms_auth=ok`** → widget reads/strips it and probes `/api/auth/me?session={sid}`
→ `{ signedIn: true, identity: { name, tier: 3 } }`. The `sid` is **identical**
at every hop (the widget's stable localStorage id — `?session=` on login,
`x-ms-session`/`?session=` on `/api/auth/me`); the backend never mints its own.

## 5. Schema (migration `0014_customer_accounts.sql`)

- `customers` += `shopify_customer_id TEXT` (unique partial index),
  `shopify_customer_gid TEXT`, `shopify_linked_at TIMESTAMPTZ`,
  `identity_tier SMALLINT NOT NULL DEFAULT 1` (existing rows backfilled to 2).
- `customer_oauth_tokens` (one row per customer, `ON DELETE CASCADE`): encrypted
  access/refresh (`BYTEA`), `id_token_sub`, `scope`, `access_expires_at`,
  `refresh_expires_at`, `updated_at`.
- `customer_auth_pending` (`state` PK): `session_id`, `code_verifier`, `nonce`,
  `return_url`, `prompt_none`, `created_at`, `expires_at` (~10-min TTL).
- `customer_merge_conflicts`: the admin-review audit log for case (d).
- `customer_session_links` (`session_id` PK → `customer_id`, `ON DELETE CASCADE`,
  migration `0019`): the **direct, durable re-hydration link** written on every
  identity bind, read first by `resolveSignedInCustomer`. Backfilled on deploy
  from existing `conversations.customer_id` stamps.

Retention: `customer_auth_pending` is purged past expiry by the retention cron;
`customer_oauth_tokens` and `customer_session_links` cascade with the customer (so
a GDPR erasure / customer purge removes them). See
[`DATA_RETENTION.md`](./DATA_RETENTION.md).

## 6. Verify gate — run it before relying on the flow

The CI sandbox that built this blocks egress to Shopify hosts, so the live gate
is executed from an egress-capable environment (locally / Vercel):

```bash
npm run verify:customer-account
```

It (1) fetches discovery and compares to the confirmed live values, (2)
**empirically** probes token-endpoint client auth (public exchange with a
throwaway code → `invalid_grant` means PROCEED public; `invalid_client` means
switch to confidential), and (3) probes `prompt=none` (logged-out → expects
`error=login_required`). Token lifetimes must be read from a real exchange.

## 7. How to run a live sign-in test

1. **Shopify admin (Lucas):** Headless channel → Customer Account API client
   (PUBLIC), register the URLs (built from `PUBLIC_BASE_URL`):
   - Callback: `https://<PUBLIC_BASE_URL>/api/auth/shopify/callback`
   - JavaScript origins: `https://www.motionsports.de`, `https://motionsports.de`
   - Logout URI: `https://<PUBLIC_BASE_URL>/api/auth/shopify/logout/return`
2. **Env:** set `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID`, `PUBLIC_BASE_URL`,
   `TOKEN_ENC_KEY` (`openssl rand -hex 32`), `SHOPIFY_STOREFRONT_DOMAIN`, and a
   DB. Leave `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET` empty (public).
3. **Migrate:** `npm run db:migrate`.
4. **Gate:** `npm run verify:customer-account` (from an egress-capable host).
5. **Sign in:** open
   `https://<PUBLIC_BASE_URL>/api/auth/shopify/login?session=<any-session-id>&return_url=https://www.motionsports.de/`
   in a browser, complete the Shopify login, and confirm the redirect lands on
   `…?ms_auth=ok`.
6. **Re-hydrate:** `GET https://<PUBLIC_BASE_URL>/api/auth/me?session=<same-id>`
   with `Origin: https://www.motionsports.de` + `x-ms-chat-key: <secret>` →
   expect `{ "signedIn": true, "identity": { "name": "…", "tier": 3 } }`.

## 8. Signed-in data in the profile + live chat (CA-2 / CA-3)

For a **signed-in (tier-3)** customer we pull the interesting Customer Account
data and feed it into the **internal marketing profile** and the **live chat**,
reusing the **existing customer-memory mechanism** and its consent gate. This is
**profile + live-chat personalisation only** — it does **not** touch the
marketing CONSENT model (CA-4): signing in still establishes identity, never
marketing consent.

### What we fetch — and from where

Via the **Customer Account API GraphQL** endpoint
(`account.motionsports.de/customer/api/<version>/graphql`) with the customer's
own server-held access token (sent **directly** in `Authorization`, no `Bearer`
prefix), `fetchSignedInCustomerData` reads (signed-in customer only): **name**,
**addresses**, and **full order history with line items**
(`lib/shopify-customer-account.ts`).

> ⚠️ **Customer Account API field shapes differ from the Admin Customer object**
> and must be re-verified against the **rendered** schema (the verify gate, §6):
> e.g. email is wrapped as `emailAddress { emailAddress }`; the order date is
> `processedAt` (Admin: `createdAt`); the total is a flat
> `totalPrice { amount currencyCode }` (Admin wraps it in
> `currentTotalPriceSet.shopMoney`); the status is `financialStatus` (Admin:
> `displayFinancialStatus`); the default address exposes `territoryCode`. The
> richer read is **fault-isolated** from the identity read and **fails soft**:
> any residual shape drift degrades to "name only", never an error.

For tier 3 this **REPLACES** the email-keyed Admin-API order fetch
(`fetchOrderHistoryByEmail`) as the purchase-history source.

### Where it's cached — keyed by `shopify_customer_id`

The normalisation (`lib/customer-account-data.mjs`, unit-tested) maps the
Customer Account response into the shapes the rest of the app **already**
consumes, so nothing downstream changes:

- **Order history → `customers.purchase_summary`** (migration 0008) — the same
  blob the live-chat memory, profile generation, marketing draft and bundle
  suggestion already read.
- **Name + a DATA-MINIMISED address context (city + country code only) →
  `customers.shopify_account_summary`** (migration **0015**) — for the greeting
  and the profile. We never cache the raw street, phone, or order totals here.

`refreshSignedInCustomerCache(customerId)` (`lib/customer-account-cache.ts`) ties
token → fetch → cache. It runs **on sign-in** (the callback, best-effort) and
when an admin clicks **"Käufe aktualisieren"** (for a tier-3 customer the
purchases route uses the Customer Account API instead of the email path).

### How it reaches the chat — same mechanism, same minimisation

`resolveChatMemory({ sessionId, email })` (`lib/customer-memory.ts`) is the
single entry point the chat route uses. **Signed-in identity takes precedence**
(it's the authenticated session), falling back to the tier-2 email path:

- **Re-identification** for a signed-in user is the **authenticated session
  itself** — `resolveSignedInMemory` requires a **live access token** (refreshing
  if needed) before surfacing anything, so a logged-out/expired session resolves
  to nothing (fail-closed), exactly like `/api/auth/me`.
- **Greeting (CA goal 2):** the chat greets the returning signed-in customer by
  **name, tier-appropriately** (du / — for studio & public_sector — Sie). The
  greeting uses only the **session's own authenticated identity**, so it is shown
  to any live signed-in customer.
- **Personalisation (CA goal 1):** the **current-understanding summary + owned
  items + address context** are injected via the **same** customer-memory block,
  with the **same data minimisation** — a compact summary, owned-item titles +
  quantities, counts; **never** raw transcripts, order totals, or the email in
  the prompt.
- **Profile (CA goal 3):** for tier 3 the richer Shopify data flows into the
  existing personalized-email + bundle-suggestion flows automatically (they read
  `purchase_summary` / `profile_summary`); the profile generation additionally
  receives the data-minimised location context.

### The consent gate (unchanged personalisation requirement)

History-personalisation stays gated on the **same** consent as tier 2 —
`CONSENT_COPY_LAWYER_APPROVED` **and** the personalisation purpose being covered
— enforced by `canPersonaliseSignedIn({ lawyerApproved, marketingStatus })`:

| Visitor | Greeting by name | History / profile / address personalisation |
|---|---|---|
| Anonymous (tier 1) | no | no |
| Signed-in, **not** consented | **yes** (authenticated UX) | **no** (fails closed) |
| Signed-in, marketing-consented + lawyer flag on | yes | **yes** |

The gate is two hard conditions, both fail-closed:

1. **`CONSENT_COPY_LAWYER_APPROVED`** — the consent/privacy copy that covers
   "profile building from past interactions and purchases" must be legally signed
   off. It is **`true`** (lawyer-approved June 2026), so this condition is
   satisfied; personalisation then depends on condition 2 below, per user.
2. **Marketing consent on record (`marketing_status = 'confirmed'`)** — the
   affirmative, unbundled, double-opt-in consent the GDPR TODO
   ([`CUSTOMERS.md`](./CUSTOMERS.md)) extends to cover personalisation from past
   conversations + purchases. Signing in never sets this; only our DOI does.

So a **non-consented or anonymous** user gets **no** purchase history, profile,
or address in the prompt — the consent gate governs personalisation exactly as
for tier 2; only the signed-in name greeting (the session's own identity) is
added on top.

## 9. Signed-in conversation history (tier 3)

A signed-in customer can browse, open, rename and delete their own **past
conversations** — and erase all of their data. These endpoints live under
`/api/account/*` and are the contract CA-3-THEME builds against (precise
request/response shapes: [`frontend-handoff/CUSTOMER_ACCOUNT.md`](./frontend-handoff/CUSTOMER_ACCOUNT.md) §7).

### The gate (fail-closed, behind the CA-1 resolver)

Every `/api/account/*` request runs the same gate (`lib/account-guard.ts ::
requireSignedInCustomer`), in this order:

1. **`guardRequest`** — origin allowlist + shared secret (`x-ms-chat-key`),
   like `/api/chat`. Widget XHR, with a CORS preflight.
2. **Rate limit** — the chat bucket.
3. **`resolveSignedInCustomer(session)`** — the session must link to a customer
   with a `shopify_customer_id`. **Anonymous** (no customer) and **email-only**
   (tier-2, no `shopify_customer_id`) sessions resolve to `null` → **401, fail
   closed**, before any history is read.
4. **`getValidAccessToken`** — proves the session is **still authenticated**
   (refreshing if needed), exactly like `/api/auth/me`. A logged-out / expired
   session → 401.

**Resolved across devices.** All of a signed-in customer's sessions — on every
device — link to the **same** `customers` row (keyed by `shopify_customer_id`),
so history is scoped by `customer_id` and is therefore the customer's **whole**
history regardless of which device opened each conversation. Every per-id
operation additionally constrains `customer_id = <self>`, so a conversation the
caller doesn't own is **indistinguishable from a missing one** (404 — no
enumeration leak).

### Endpoints (all under `/api/account`)

| Route | Method | Purpose |
|---|---|---|
| `/api/account/conversations` | GET | LIST the customer's past conversations (across devices), each with a TITLE, timestamps, message count. |
| `/api/account/conversations/{id}` | GET | FETCH one conversation's transcript (must belong to this customer). |
| `/api/account/conversations/{id}` | PATCH | RENAME the conversation title (`{ title }`). |
| `/api/account/conversations/{id}` | DELETE | HARD-delete this one transcript. |
| `/api/account/erase` | POST | Full "delete my data" — erase the customer (distinct from single-chat delete). |

### Multiple threads per session (migration 0018)

`session_id` is the identity link and must not rotate while signed in, so it can
no longer also be the *thread* key. `conversations.conversation_key` (a stable,
client-generated value the widget sends on `/api/chat`) is now the uniqueness key;
`session_id` stays on the row (no longer unique) as the match-up/summary bridge.

- A session can host **many** conversations — "Neue Beratung" sends a fresh
  `conversationKey`, creating a new history row instead of growing one thread.
- The list + transcript responses return `conversationKey` so the widget can
  **resume** a thread (send it back on `/api/chat`), even across devices — the
  upsert never rewrites a row's `session_id`.
- **Backward-compatible:** a client that sends no key defaults
  `conversation_key = session_id` (the legacy one-thread-per-session behaviour).
- Session-keyed reads that assume a single thread now take the **most recently
  active** thread of the session (`loadConversationForSummary`,
  `getConversationIdBySession`); the match-up/capture attach still uses
  `WHERE session_id`, so it links **all** of the signing-in session's threads to
  the customer (and never another session's).

### Eager create + customer-link at creation (no lost threads — migration 0026)

A started conversation must persist and list **exactly like ChatGPT/Claude** —
every started thread is durable, even before the assistant answers. Two defects
broke that and are now fixed:

- **Orphaned by a missing customer link.** The conversation row was written only
  in `persistTurn` (the chat `onFinish`, *after* the stream) and that `INSERT`
  **never set `customer_id`** — the customer link was stamped only at sign-in /
  email-capture (`UPDATE conversations … WHERE session_id`), which had already run
  *before* a later "Neue Beratung" row existed. So a new signed-in thread was
  created with `customer_id = NULL` and never appeared in the list (which filters
  `WHERE customer_id = <self>`). **Lost.**
- **Flushed too late.** Persisting only in `onFinish` meant a thread whose answer
  never landed (reload / switch first) was never written at all.

The fix (`lib/conversation-create :: ensureConversationStarted`, called from
`/api/chat` **before** the stream, concurrently with retrieval):

- **Eager:** the conversation row + the first user message are written at the
  **first send**, before the model answers — so the thread lists immediately and
  survives a reload.
- **Customer-linked at creation:** the row is stamped with the session's linked
  `customer_id` (resolved from `customer_session_links`, migration 0019) the moment
  it is created. `persistTurn` is the backstop — it now resolves + stamps
  `customer_id` too, `COALESCE`-ing so it never NULLs an existing link or
  re-clobbers a thread that signed in mid-way.

Anonymous sessions still create pseudonymous rows (`customer_id` stays NULL),
unchanged.

### Titles are cheap — cached on the row, no model call per render

The list TITLE is either the customer's **custom title** (set via RENAME, stored in
`conversations.title`, migration `0016`) or, when unset, a **derived** label: the
first user message, whitespace-collapsed and trimmed to 80 chars
(`lib/conversation-title.mjs :: deriveConversationTitle`). **No Anthropic call** runs
per list render — it never did. As of migration **0026** the derived label is also
**cached on the row** (`conversations.title_auto`, written at creation), so the list
no longer runs a per-row `LATERAL` sub-select to fetch each conversation's first
message — it reads the title straight off the row.

**List performance (migration 0026).** The list query
(`listCustomerConversations`) is `WHERE customer_id = <self> ORDER BY
last_activity_at DESC, id DESC`. The pre-existing `conversations(customer_id)` index
(migration 0008) covered the filter but **not** the ordering, so a long history
still paid a sort. The new composite **partial** index
`conversations(customer_id, last_activity_at DESC, id DESC) WHERE customer_id IS NOT
NULL` serves filter **and** order in one indexed walk — a snappy list (well under a
second for a normal history). `messageCount` (readable user/assistant turns, tool
rows excluded) remains a single indexed `COUNT` per row over
`messages_conversation_idx`.

### Deletion semantics — single-chat delete vs. the durable profile

This is the subtle part, and it follows the two-cluster lawful-basis split
([`DATA_RETENTION.md`](./DATA_RETENTION.md)):

- **`DELETE /api/account/conversations/{id}` HARD-deletes that one transcript**
  — the `conversations` row plus its `messages` and chat `ai_usage` (FK
  `ON DELETE CASCADE`). It is gone immediately and irreversibly.
- **The durable "current understanding" profile is a SEPARATE aggregate under a
  different lawful basis** (`customers.profile_summary`, regenerated on demand —
  see [`CUSTOMERS.md`](./CUSTOMERS.md)). Deleting a source conversation means a
  **future profile regeneration no longer sees it** — but **profile text already
  derived persists** until the profile is regenerated **or** the customer is
  erased. Single-chat delete deliberately does **not** reach into the profile
  aggregate; that would conflate two lawful bases. The honest contract for the
  customer: "this chat is gone; what we already learned is cleared when you
  regenerate your profile or delete all your data."

### The distinct full "delete my data" path

`POST /api/account/erase` (`lib/account-history.ts :: eraseSignedInCustomer`) is
a **GDPR erasure of the person**, separate from the single-chat delete. In one
transaction it:

1. **Purges every linked conversation** — all transcripts + messages + chat
   `ai_usage` cascade (not merely unlinked: the customer's own transcripts are
   gone).
2. **Suppresses + purges the consent record** — adds the (real) email to
   `suppression_list` (reason `erasure`, so a future sign-in can't silently
   re-attach the old data) and deletes its `email_captures` (`marketing_sends`
   cascade). Skipped for the synthetic `shopify:<id>` placeholder email.
3. **Deletes the `customers` row** — which **clears the profile + all cached
   summaries** (they live on the row), **revokes the OAuth tokens**
   (`customer_oauth_tokens` `ON DELETE CASCADE`), and de-identifies the
   remaining FK refs (`bundle_offers` `ON DELETE SET NULL` — kept for
   accounting, no PII).

After erasure the session no longer resolves to a customer, so every subsequent
`/api/account/*` call (and `/api/auth/me`) fails closed. Note this drops the
stored tokens server-side; the customer may additionally log out of Shopify
itself (the `end_session_endpoint`, §5 frontend doc).

Erasure suppresses **both** lawful bases for the real email: it adds the address
to `suppression_list` (DOI, reason `erasure`) **and** to
`bestandskunden_suppression_list` (§7(3), reason `erasure`), so a future
re-sign-in can re-derive neither audience from the unchanged Shopify history.

## 10. At-sign-in marketing opt-in + the match-up (CA-4)

CA-1 established that **signing in is identity, not marketing consent** (§1). CA-4
**keeps that rule** and adds a *presentation-maximised but fully lawful* way for a
**signed-in** customer to opt into marketing — see
[`CONSENT_FLOW.md`](./CONSENT_FLOW.md) "At-sign-in marketing opt-in".

- **Endpoint:** `POST /api/account/marketing-opt-in` (the standard signed-in
  guard: origin + secret + a **live** access token). It requires an explicit
  `marketingConsent: true` (no auto-enrol), uses the customer's **verified**
  `customers.email` (refusing the synthetic `shopify:<id>` placeholder), and runs
  the **existing DOI** via `upsertEmailCapture` — `'pending'` + confirmation
  email, `'confirmed'` only after the link click. The copy is served by
  `signInMarketingConsentCopy()` (`GET /api/consent-copy?surface=signin`, v3).
- **Still ours, still DOI.** Re-keying on sign-in **never** imports Shopify's
  marketing state; the *only* path to `confirmed` is the double-opt-in, on either
  surface. The opt-in is a **separate, explicit act** the customer chooses.

### The match-up (consent carry-forward + session scope)

Both cases are handled by the existing merge (`decideMerge` →
`bindShopifyIdentity`, §4) — CA-4 pins and documents them:

- **email-only → signed-in:** the **stamp** branch targets the tier-2 row matched
  by the verified email and writes **only identity columns**, so a **prior DOI
  consent under that email carries forward intact** (`email_captures` +
  the mirrored `customers.marketing_status` stay `confirmed`) — none invented,
  none silently revoked. A collision/mismatch is logged to
  `customer_merge_conflicts` and **never fuses** two consent records.
- **current-anonymous-session → signed-in:** only the **current** session's
  conversation (the chat that led to sign-in, carried in the signed
  `state`/pending record) is attached — `WHERE session_id = THIS session`. Other
  anonymous threads are **never** retroactively scooped.

### §7(3) Bestandskunden (separate basis, see CONSENT_FLOW.md)

A signed-in customer's **completed purchases** (pulled via the Customer Account
API into `purchase_summary`, §8) also feed the **separate** §7(3)
existing-customer audience (`customers.bestandskunde_eligible`, recomputed on
every purchase refresh). That basis is **never merged** with DOI consent and its
real sends stay gated behind the distinct `BESTANDSKUNDE_SENDS_APPROVED` flag —
full details in [`CONSENT_FLOW.md`](./CONSENT_FLOW.md).

### Where the opt-in is surfaced for tier 3 — and where it is NOT

The tier-3 chat experience **moves** the marketing opt-in: the end-of-chat
email-summary + marketing capture widget is **suppressed** for signed-in
customers, and the opt-in is offered **at sign-in** instead (the CA-4 card). The
two states the widget reads are both already in the backend; CA-4 just pins the
contract.

- **Suppression gate — tier.** `/api/auth/me` returns `identity.tier`. The widget
  **suppresses** the end-of-chat capture/opt-in widget when `tier === 3` (a
  signed-in customer): they don't need the "type your email + summary" capture —
  the summary is downloadable (§11) and the opt-in lives at sign-in. **Tiers 1–2
  are unchanged**: the end-of-chat capture form still shows for anonymous /
  email-only visitors exactly as before. This is a **frontend gate on an existing
  field** — no backend behaviour change; sign-in is still identity, not consent.
- **At-sign-in opt-in actionability — `marketing.optInActionable`.** `/api/auth/me`
  now also returns `marketing: { status, optInActionable }`. The widget's
  `optInActionable` flag reads this: the CA-4 card is shown to a signed-in
  customer who has **not yet recorded a marketing decision**, and hidden once
  they have. `optInActionable` is computed fail-closed as:

  ```
  optInActionable = signedIn
                 && customer has a REAL verified email (not the shopify:<id> placeholder)
                 && marketing_status === 'none'      // no DOI decision on record yet
  ```

  `marketing_status` is **our DOI state only** (`customers.marketing_status`,
  mirrored from `email_captures`) — sign-in **never** imports Shopify's marketing
  state (§1), so a freshly signed-in customer starts at `'none'` → **actionable**,
  unless a **prior DOI under their verified email carried forward on merge** (§4
  stamp branch), in which case it's already `pending`/`confirmed`/`unsubscribed`
  → **not actionable** (decided). A synthetic-email tier-3 row (no real address to
  DOI) is also **not actionable**. "Dismissed" (the customer closed the card
  without ticking) is a **widget-local** state the backend does not track — once a
  real decision is recorded via `POST /api/account/marketing-opt-in` the backend
  flips `status` away from `'none'` and `optInActionable` becomes `false` on the
  next `/api/auth/me`.

The opt-in submit itself is unchanged (`POST /api/account/marketing-opt-in`,
above): explicit `marketingConsent: true`, the existing DOI, our verified email.

## 11. Conversation summary download (signed-in, S5 structure reused)

A signed-in (tier-3) customer can **download** a summary of any one of their
threads from the widget's **"Zusammenfassung herunterladen"** button. It is the
**same** S5 structured summary as the transactional summary **email** — AI prose
→ chosen products → **Zur Kasse** → divider → **"Vielleicht auch interessant:"**
alternatives — **assembled by the very same renderer** (`buildSummaryDocument`,
`lib/summary-email.ts`), then rendered to PDF, not a second layout. The email and
the download can therefore never drift apart in content.

### Format: PDF (10E-1, replacing the 10B-1 HTML)

The download is a **PDF** (`Content-Type: application/pdf`,
`Content-Disposition: attachment`), produced by `lib/summary-pdf :: buildSummaryPdf`
on the repo's **dependency-free** hand-written PDF stack (`lib/pdf-core`, shared
with the physical-letter PDF — **no headless browser / PDF dependency** on Vercel).
It renders the structured pieces `buildSummaryDocument` returns (`summary`,
`chosen`, `cartUrl`, `alternatives`) into a branded document — letterhead + footer,
the same sections as the email. The widget fetches the endpoint as a guarded XHR
(so it can send the shared-secret + session headers), then saves the response body
as a `Blob` behind the button.

### Endpoint — `GET /api/account/summary?conversationKey=<key>`

| | |
|---|---|
| **Guard** | the standard signed-in gate (`requireSignedInCustomer`): origin allowlist + `x-ms-chat-key` + a **live** access token. Anonymous / email-only / logged-out → **401**, fail closed. |
| **Scope** | keyed by the thread's **`conversationKey`** (migration 0018). The thread must belong to the caller (`conversation_key + customer_id = self`); a foreign/unknown key is a clean **404** — indistinguishable from missing (no enumeration leak). |
| **Body** | the branded **PDF** summary document (`application/pdf`). |
| **Cost (S6)** | when it makes a model call (Anthropic summary prose), the token usage is recorded as the **`summary_download`** call site, **linked to the conversation** so it cascade-deletes with the transcript on single-chat delete / erasure. No model call (no API key / empty transcript) → nothing recorded; the document degrades to the plain transcript, exactly like the email. |

The `conversationKey` is the per-thread key the history list / transcript already
return (§9, migration 0018) and the widget already sends on `/api/chat`. The
numeric `conversationId` keys the rename/delete routes; the **summary download
keys on `conversationKey`** (the thread), matching the thread model.
