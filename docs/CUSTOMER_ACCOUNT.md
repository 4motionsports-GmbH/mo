# Customer Account sign-in (tier-3 identity)

> **Status:** CA-1 shipped — auth + identity model + token handling. **CA-2/CA-3
> shipped** — the signed-in customer's Customer Account data (name, addresses,
> full order history) is now pulled and fed into the internal profile **and** the
> live chat via the existing customer-memory mechanism, under the same consent
> gate and data-minimisation (see [§8](#8-signed-in-data-in-the-profile--live-chat-ca-2--ca-3)).
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
| `/api/auth/shopify/logout/return` | GET | top-level navigation | drop tokens for the session, 302 back to storefront |

`login`, `callback`, and `logout/return` are **top-level navigations** (like the
email-clicked confirm/unsubscribe routes) — no CORS/secret guard; they are
protected by the **signed `state`** + the **server-side pending record**.
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

### `prompt=none` silent already-signed-in detection

`/api/auth/shopify/login?...&prompt=none` runs the same flow with `prompt=none`.
When a storefront session exists Shopify returns a `code` with **no UI**; when
logged out it returns `error=login_required`, which the callback turns into a
`return_url?ms_auth=login_required` bounce so the widget can show a one-click
"Sign in". **If `prompt=none` is not honored on this store** (see the verify
gate), this degrades to a plain one-click sign-in — no functional loss. CA-3
should plan for that degraded path.

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
two entry points of the generalised "identity bind"; both attach the current
conversation to the resolved customer and never weaken an existing tier
(`GREATEST(identity_tier, …)`).

### The signed-in resolver

`resolveSignedInCustomer(sessionId)` maps the opaque widget session reference →
the linked customer (must have a `shopify_customer_id`). `/api/auth/me` then
proves the session is still live by obtaining a **valid access token** (refreshing
if needed) before reporting `signedIn: true`. Everything fails closed.

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

Retention: `customer_auth_pending` is purged past expiry by the retention cron;
`customer_oauth_tokens` cascade with the customer (so a GDPR erasure / customer
purge removes them). See [`DATA_RETENTION.md`](./DATA_RETENTION.md).

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
   off. It is currently `false`, so **no personalised data leaks for anyone**;
   only the authenticated name greeting is shown to signed-in users.
2. **Marketing consent on record (`marketing_status = 'confirmed'`)** — the
   affirmative, unbundled, double-opt-in consent the GDPR TODO
   ([`CUSTOMERS.md`](./CUSTOMERS.md)) extends to cover personalisation from past
   conversations + purchases. Signing in never sets this; only our DOI does.

So a **non-consented or anonymous** user gets **no** purchase history, profile,
or address in the prompt — the consent gate governs personalisation exactly as
for tier 2; only the signed-in name greeting (the session's own identity) is
added on top.
