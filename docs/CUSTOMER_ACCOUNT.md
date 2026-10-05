# Customer Account sign-in (tier-3 identity)

> **What this file owns.** The backend internals of sign-in and the signed-in account: the PKCE
> flow, the one-time link grants, the App Proxy shop recognition (decision order, switches), token
> handling, the merge rule, the signed-in resolver, the tables of migration `0014`, the verify gate
> and the live sign-in test, signed-in data in the profile and the chat (personalisation and
> order-status gates), the history storage, the opt-in state and the summary download.
> **Not here:** request/response shapes, statuses and widget behaviour of every `/api/auth/*` and
> `/api/account/*` route → [`frontend/ACCOUNT_CONTRACT.md`](./frontend/ACCOUNT_CONTRACT.md) (the
> only place for those shapes); consent law and the DOI → [`CONSENT_FLOW.md`](./CONSENT_FLOW.md);
> retention windows and the erasure inventory → [`DATA_RETENTION.md`](./DATA_RETENTION.md); operator
> steps and live production status → [`ROLLOUT_TODO.md`](./ROLLOUT_TODO.md). The feasibility spike
> [`archive/CUSTOMER_ACCOUNT_SPIKE.md`](./archive/CUSTOMER_ACCOUNT_SPIKE.md) is historical; earlier
> versions of this file: [`archive/CUSTOMER_ACCOUNT_HISTORY_2026-10.md`](./archive/CUSTOMER_ACCOUNT_HISTORY_2026-10.md).
> If this file and the code disagree, the code wins.

This adds a **third identity tier** to the chat: a *signed-in Shopify customer*.
It is built on the Shopify **Customer Account API** with an OAuth 2.0
**authorization-code + PKCE (S256)** flow. The browser **never holds tokens** —
the widget only ever triggers a top-level redirect; the **backend** performs the
PKCE code exchange and holds both tokens server-side, encrypted.

## 1. The three identity tiers (tiers 1–2 are unchanged)

| Tier | Key | Created by | Authoritative for |
|---|---|---|---|
| 1 — Anonymous | `session_id` (localStorage thread id) | every visit | nothing (pseudonymous) |
| 2 — Identified | normalised **email** | `/api/capture-email` / `/api/chat-marketing-opt-in` (consent + DOI) | our Art. 7 consent evidence |
| **3 — Signed-in** | **`shopify_customer_id`** (GID numeric) | Customer Account sign-in in the chat, or the shop login recognised through the App Proxy (§2) | **Shopify**: name, email, addresses, orders |

The tiers describe the **session** (what the widget may show). The person
behind it is always one `customers` row; since migration `0061` every Shopify
customer has one too, mirrored from the shop whether or not they ever chat
(see [`CUSTOMERS.md`](./CUSTOMERS.md)).

The model from [`CUSTOMERS.md`](./CUSTOMERS.md) / [`DATA_RETENTION.md`](./DATA_RETENTION.md)
**still holds**: anonymous stays pseudonymous and unlinked; the email-only
capture/DOI/consent-audit flow stays the *no-account fallback*; the two clusters
stay separate; "email lives in one place"; bridges are consent-anchored; and
re-identification fails closed. Tier 3 is **added**, never a weakening of 1–2.

**What's authoritative where (tier 3):**

- **Shopify** owns the *identity*: name, verified email, addresses, order
  history. The customer mirror keeps name, e-mail, locale, country and orders
  locally (`customers`, `customer_orders`); the Customer Account API read at
  sign-in adds the data-minimised address context (§8).
- **Our DB** owns what Shopify doesn't: transcripts, analytics, the Art. 7
  evidence of consents given in Mo (`email_captures`), profile/persona —
  keyed by `shopify_customer_id`.
- **One marketing consent, shared with Shopify.** Signing in establishes
  **identity, not marketing consent**: `bindShopifyIdentity` never writes the
  consent columns. The consent itself is one state per person
  (`customers.email_consent_state`, mirrored to the legacy
  `marketing_status`): our DOI writes it, and so does a subscription the
  customer gave in the shop (via the customer mirror's webhooks, import and
  nightly reconciliation). See [`CONSENT_FLOW.md`](./CONSENT_FLOW.md) "The one
  consent".

## 2. The PKCE authorization-code flow

All redirect/callback URLs are built from `PUBLIC_BASE_URL` (`getBaseUrl`; never hardcoded) —
production: `https://mo.motionsports.de`, registered in the Shopify admin (Headless →
Customer Account API → Application setup). A domain change is an env flip plus
re-registering the URLs there.

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
                                              mint one-time link code for the login's session
                       ←──────────────────  302 return_url?ms_auth=ok&ms_code=…
 widget re-mounts, reads same session_id,
 POST /api/auth/link { code } (x-ms-session) → link written only for that session
 GET /api/auth/me?session= → signed in + identity + marketing (ACCOUNT_CONTRACT §4)
```

**Why the one-time code (migration `0073`).** The session id of a sign-in is a URL
parameter (`login?session=`, `/apps/chat/whoami?session=`) that anyone can prepare —
a stranger could send a shopper who is logged in to the shop a link carrying the
**stranger's** session id. So neither the callback nor the App Proxy links the session
they were given: both mint a grant (`customer_link_grants`: SHA-256 of a 43-character
random code, the session id, the customer, the kind, 10 minutes, single use —
`customer-link-grant.mjs`, tested; I/O wrappers `session-link-grants.ts`, which fail
closed on a database error). The code reaches only the browser that completed the
sign-in (the redirect, or the same-origin whoami response); the widget redeems it with
its own `x-ms-session`, and `redeemLinkGrant` writes the link only when that is the
grant's session. A redeem attempt from another session burns the code. Links from
before `0073` are `legacy` and never count (those customers sign in once more).

### Routes (all under `/api/auth`)

`shopify/login`, `shopify/callback`, `link`, `me`, `shopify/logout`,
`shopify/logout/return`, and `storefront` + `storefront/whoami` (the App Proxy, below).
Request/response shapes, statuses, the `?ms_auth=` markers and what the widget does with
them: [ACCOUNT_CONTRACT](./frontend/ACCOUNT_CONTRACT.md) §1.1 (guards and errors), §2
(login), §2a (redeem), §3a (whoami), §3b (`prompt=none`), §4 (`/api/auth/me`), §5
(logout). Internals:

- `login`, `callback`, `logout` and `logout/return` are **top-level navigations**
  (like the email-clicked confirm/unsubscribe routes) — no CORS/secret guard. The
  auth pair is protected by the **signed `state`** (`SHOPIFY_CUSTOMER_ACCOUNT_STATE_SECRET`,
  falling back to `CHAT_SHARED_SECRET`) + the **server-side pending record**
  (`customer_auth_pending`, `CUSTOMER_AUTH_PENDING_TTL_MINUTES`, default 10); `return_url`
  is checked against the storefront origin allow-list (`safeReturnUrl`) by login and both
  logout routes (the callback uses the one stored at login).
- The **callback**, in order: verify the state and consume the pending record (single use);
  map an OAuth `error` (`login_required` → `?ms_auth=login_required`, else `error`); exchange
  the code server-side; verify the `id_token`; read `customer { id }`; merge (§4); store the
  encrypted tokens; mint the `customer_account` grant for the pending record's session; record
  the server-only KPI event `account_signin_succeeded { silent }`; warm the tier-3 cache (§8,
  best-effort); 302 back with `?ms_auth=ok&ms_code=…`. Any failure → `?ms_auth=error`; the
  user is never stranded on a backend page.
- `link` and `me` are widget **XHRs** with the origin allow-list + shared secret
  (`guardRequest`) and the chat rate-limit bucket. `link` records `account_signin_linked
  { kind, renewed }` or `account_signin_link_refused { reason, kind? }`
  ([API_CONTRACT](./frontend/API_CONTRACT.md) §5).
- **Logout is server-initiated**: `shopify/logout` builds the OIDC `end_session` redirect from
  discovery (the widget can't) with `post_logout_redirect_uri = …/logout/return?session=&return_url=`,
  and degrades to a local sign-out (straight to `logout/return`) when the store advertises no
  `end_session_endpoint` or anything fails. `logout/return` resolves the session's signed-in
  customer, deletes their tokens and their signed-in links (§4), and bounces back with
  `?ms_auth=logged_out`.

### Discovery is the source of truth

Endpoints are resolved at runtime from the storefront domain and cached for 1h
(the JWKS too):

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
cookie**, and a client-supplied customer id is forgeable (the spike also flagged
`logged_in_customer_id` / the Liquid `customer` object as possibly unreliable on new
customer accounts — re-checked on the live store before switch-on, ROLLOUT_TODO 5.4).

**The mechanism — a Shopify App Proxy.** An App Proxy is the one channel where
Shopify itself vouches the logged-in customer to a cross-origin backend: the
storefront calls a **same-origin** path (`/apps/chat/whoami`), Shopify forwards
it to our backend **adding** `logged_in_customer_id` (the LIVE storefront session's
customer), a `timestamp` and an HMAC `signature` over all params. Shopify appends the
sub-path to the proxy URL `…/api/auth/storefront`, so the request lands on
`/api/auth/storefront/whoami`, which re-exports the same handler. The route verifies the
signature (`shopify-app-proxy.mjs`, tested; secret `SHOPIFY_APP_PROXY_SECRET`, falling back
to `SHOPIFY_CLIENT_SECRET`), trusts **only** Shopify's `logged_in_customer_id`, and
enriches the **name/email via the Admin API** (`read_customers`,
`lib/shopify-orders.fetchAdminCustomerById`), with **no customer OAuth token**. It then
find-or-creates the customer (the same `bindShopifyIdentity` merge as the OAuth callback,
§4) and mints a one-time code for the widget `session_id` (kind `app_proxy`); the widget
redeems it at `POST /api/auth/link`. Response shape: ACCOUNT_CONTRACT §3a. **Fail-closed:**
anything not positively proven answers `{ signedIn: false }`; no Admin/DB work happens
until the signature verifies.

**When whoami issues a code (P0.3).** `signedIn: true` **always** comes with a
`linkCode`, and only when the session will really count as signed in. In order:

1. **Fresh signature.** Shopify's signed `timestamp` must lie within ±300 s
   (`appProxyFailureKind`, `shopify-app-proxy.mjs`, tested); this limits a replayed
   URL to that window. A stale, mismatched or unsigned request answers
   `{signedIn:false}` and never ends or creates a link. `no_secret` / `mismatch` /
   `stale` are reported (`reportError`, phase = the kind, at most once per kind per
   instance every 10 minutes, never the URL or query); `unsigned` (a direct hit) is
   silent.
2. **Logged out.** A valid request without `logged_in_customer_id` (`not_logged_in`)
   ends the session's `app_proxy` link (`endAppProxySessionLink`) — a shop logout
   signs a shop-recognised chat out; a chat sign-in (`customer_account`) stays.
   Then: the chat rate-limit bucket (keyed by the session, else `cid:<customer>`);
   no session → `{signedIn:false}`.
3. **Handover.** The session is signed in as **another** shop customer (shared
   browser): that session's signed-in link ends (`unlinkSessionSignedIn`, this
   session only — the previous person's other devices stay signed in), no code.
   The widget's `/api/auth/me` probe then reads signed-out and it starts over on a
   new session (ACCOUNT_CONTRACT §5.1).
4. **Kill switch.** `APP_PROXY_SIGNIN_ENABLED` off (default) → no code.
5. **Proof.** With `APP_PROXY_SIGNIN_MAX_AGE_HOURS > 0` the shop login itself;
   otherwise a live chat (Customer Account) token of the customer (refreshed only
   when it would decide a code). Neither → no code.
6. Otherwise Admin API → bind → mint; a failed bind or mint → `{signedIn:false}`.

Steps 1–3 run whatever the switch says: with the kill switch off whoami issues **no
code**, but handover and a shop logout still end links. Every recognised request
(signed, fresh, logged in, with a session) records the server-only KPI event
`account_shop_recognised { proof, hasToken, alreadySignedIn, codeIssued, noCode? }`
(`noCode` `flag_off` | `no_proof` | `handover` | `failed`; API_CONTRACT §5);
`livecheck-%` sessions never count in the KPIs. Pure rules:
`signed-in-proof.mjs → decideShopRecognition` (tested).

Setup in Shopify, the live check of `logged_in_customer_id` and the switch-on:
[`ROLLOUT_TODO.md`](./ROLLOUT_TODO.md) 5.4.

**The two switches (D-AP1).** `APP_PROXY_SIGNIN_ENABLED` (default `false` in code) is the
kill switch: off, whoami issues no code and answers `{signedIn:false}`, but still
measures and still ends links (steps 2–3). `APP_PROXY_SIGNIN_MAX_AGE_HOURS` (default `0`,
clamped to 720): with a value > 0 an `app_proxy` link counts as signed in **without** a
chat token for that many hours after its last redeem — every new tab session renews it
through whoami. While the kill switch is off the effective shop-proof hours are 0
(`appProxyShopProofHours`, `platform-flags.mjs`). With 0, only customers with a live chat
token (who used „Anmelden“ in the chat before) are recognised. D-AP1 (shop proof counts
as signed in; scope: `/api/auth/me`, every `/api/account/*` including export, erase and
the marketing opt-in, and Mo's memory) was decided by the owner on 05.10.2026 and,
according to the owner, confirmed by the lawyer ([`ANWALTSDOSSIER.md`](./ANWALTSDOSSIER.md)
§19, F-36; the privacy-policy paragraph is still open there). Values decided for
production: `APP_PROXY_SIGNIN_ENABLED=true`, `APP_PROXY_SIGNIN_MAX_AGE_HOURS=24`; whether
they are set: [`ROLLOUT_TODO.md`](./ROLLOUT_TODO.md) 5.4. The resolver behind all of it is
`lib/signed-in-session.ts → resolveLiveSignedInCustomer` (§4). Order status stays
Customer-Account-only (§8).

### `prompt=none` silent detection (alternative)

`/api/auth/shopify/login?...&prompt=none` runs the same OAuth flow with
`prompt=none` (stored as `prompt_none` on the pending record). When a storefront
session exists Shopify returns a `code` with **no UI**; when logged out it returns
`error=login_required` → a `return_url?ms_auth=login_required` bounce. It is
authoritative but a full-page redirect; widget side: ACCOUNT_CONTRACT §3b.

## 3. Token handling, rotation, encryption

- **Client posture:** PUBLIC client, **no secret** (confirmed setup). The token
  exchange is attempted as a public client (`client_id` + PKCE `code_verifier`).
  Whether the token endpoint accepts that cannot be read from discovery, so it is
  verified **empirically** by `npm run verify:customer-account` (§6), which also
  prints `token_endpoint_auth_methods_supported`. If the token endpoint rejects the
  public exchange for missing client authentication, set
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
- **id_token verification:** signature checked against `jwks_uri` (RSA only —
  RS256/RS384/RS512; `alg:none` and HMAC are rejected), plus `iss` / `aud` /
  `nonce` / `exp`. The `sub` is recorded for cross-checking; we key the DB on the
  **GraphQL `customer.id` GID's numeric**.
- The Customer Account GraphQL call sends the access token **directly** in the
  `Authorization` header (no `Bearer ` prefix), per Shopify.

## 4. The email↔Shopify merge rule (on every sign-in)

Implemented as a pure decision (`lib/customer-merge.mjs::decideMerge`, unit-tested)
+ DB writes (`lib/customer-store.ts::bindShopifyIdentity`). Email is the merge key.

1. **(a)** Row already linked by `shopify_customer_id` → **use it**.
2. **(b)** Else a tier-2 row matches the **verified email** → **stamp** it with
   the Shopify ids + `identity_tier = 3`. This carries the existing consent /
   profile / transcript history forward to the signed-in identity. **Unless**
   that row already carries **another** `shopify_customer_id` (the mirror still
   has the address on a different shop customer — e-mail changed in Shopify,
   mirror lag): then it is never re-stamped (the person would inherit someone
   else's orders and history); a new row is created under `shopify:<id>` and the
   `row_collision` is logged for review.
3. **(c)** Else **create** a fresh tier-3 row (`source = 'shopify'`; without a
   verified e-mail under the placeholder `shopify:<id>`).
4. **(d) Conflict** — either the linked row's email differs from Shopify's
   verified email (`email_mismatch`), or an email-row and a shopify-id-row
   collide (`row_collision`): we **prefer Shopify's verified email as the
   authoritative identity** but **do not silently fuse consent records**. The
   established Shopify-linked row is used and a row is written to
   `customer_merge_conflicts` (consent provenance must stay auditable). We never
   overwrite the consent-anchored email on a mismatch.

The bind writes **only identity columns** and never links the session: the
`sessionId` it receives is recorded on a merge conflict only.
`linkCustomerOnEmailCapture` (tier 2) and the sign-in (tier 3: `bindShopifyIdentity`
for the customer row, then `redeemLinkGrant` for the session, 0073) are the two
entry points of the "identity bind"; both never weaken an existing tier
(`GREATEST(identity_tier, …)`) and both persist the session → customer link
**two** ways:

1. a **direct** row in `customer_session_links` (`session_id` PK → `customer_id`,
   migration `0019`; `link_kind` + `authenticated_at`, migration `0071`) — the
   **authoritative re-hydration link**, written even when the session has no
   conversation row yet (signing in before the first message), and
2. the `conversations.customer_id` stamp (`WHERE session_id = …`) — which
   carries the chat into the customer's **history**. On the redeem it runs only
   `WHERE customer_id IS NULL OR customer_id = <this customer>`, so on a shared
   browser a session's earlier chats stay with whoever they belong to.

`linkSessionToCustomer` (`customer-session-link.mjs`, tested) upserts the direct
link: a typed e-mail of the **same** customer never weakens a signed-in link (a
signed-in customer asking for the summary mail stays signed in), an App Proxy
redeem never weakens a Customer Account link of the same customer (order status
needs the latter), and a link to **another** customer always takes the new kind —
typing someone else's e-mail drops the sign-in (fail closed). A redeem for a
session already signed in as the same customer is a **renewal** (recorded as
`renewed: true`); an `app_proxy` redeem on an `app_proxy` link refreshes
`authenticated_at`, the shop-proof clock.

### The signed-in resolver

`resolveSignedInLink` / `resolveSignedInLinkWithProof` (`customer-session-link.mjs`,
tested) map the opaque widget session reference → the linked customer. They read
**only** the direct `customer_session_links` row, and only when that link was proven by
a sign-in **in this session** (`link_kind` `customer_account` or `app_proxy`) and the
customer has a `shopify_customer_id`. A typed e-mail writes `link_kind = 'email'` and
never resolves as signed in — every shop customer has a `shopify_customer_id` since the
mirror, so "the linked customer is a Shopify customer" proves nothing about this
session; `legacy` links fail closed. `resolveSignedInCustomer` (`customer-store.ts`) is
the same lookup for `logout/return`.

`lib/signed-in-session.ts → resolveLiveSignedInCustomer` is the one resolver behind
`/api/auth/me`, `lib/account-guard.ts` (every `/api/account/*`) and Mo's memory (§8). On
top of the link it proves the session is still live, with the pure rule
`signedInProofFor` (`signed-in-proof.mjs`, tested):

- a `customer_account` link → proof `token`: needs a **valid access token**
  (refreshing if needed), else `expired`;
- an `app_proxy` link → proof `shop` while its `authenticated_at` is within
  `APP_PROXY_SIGNIN_MAX_AGE_HOURS` (at most 60 s in the future; no token, no refresh),
  otherwise it needs a token too (§2, the two switches).

Everything fails closed — a blank/unlinked session, an `email`/`legacy` link, or a
customer without `shopify_customer_id` resolves to `unlinked`; a database error too.
`resolveSignedInLink` additionally returns the `linkKind`, for callers that accept only
one way of signing in — the order status in the chat accepts only `customer_account`
(§8).

A successful round-trip (the `sid` is **identical** at every hop — the widget's stable
localStorage id; the backend never mints its own): login (`?session={sid}`) → callback
binds the customer and mints a code for `sid` → 302 back with
`?ms_auth=ok&ms_code={code}` → `POST /api/auth/link { code }` with `x-ms-session: {sid}`
writes `customer_session_links[sid]` → `/api/auth/me?session={sid}` answers signed in.

**How links end.**

| Event | What is deleted | Code |
|---|---|---|
| Logout (`logout/return`) or a revoked token seen by `/api/auth/me` | the customer's tokens and **every** `customer_account` and `app_proxy` link of the customer on every session, plus the session's own signed-in link (the tokens are per customer, and a shop-proof link counts without one, so another device's session would otherwise come back to life); `email` links stay | `signOutSessionLinks` → `unlinkSignedInSessions` |
| Handover in whoami (§2 step 3) | this session's signed-in link only | `endSessionSignedInLink` → `unlinkSessionSignedIn` |
| Shop logout seen by whoami (§2 step 2) | this session's `app_proxy` link only | `endAppProxySessionLink` → `unlinkAppProxySession` |
| Erasure (§9) | the customer row; links and tokens cascade | `erasePerson` |

A dead Customer Account link that the shop re-proves (grant kind `app_proxy`, same
customer, `renewed`, no valid token, effective shop-proof hours > 0) is downgraded to
`app_proxy` at the redeem (`downgradeDeadCustomerAccountLink`) instead of staying dead.

## 5. Schema

Owned here (the [`DATABASE.md`](./DATABASE.md) table index points to this section) — the
tables of migration `0014_customer_accounts.sql`:

- `customer_oauth_tokens` (`customer_id` PK → `customers`, `ON DELETE CASCADE` — one row
  per customer): `access_token_enc`, `refresh_token_enc` (`BYTEA`, AES-256-GCM, §3),
  `id_token_sub`, `scope`, `access_expires_at`, `refresh_expires_at` (nullable),
  `updated_at`.
- `customer_auth_pending` (`state` PK): `session_id`, `code_verifier`, `nonce`,
  `return_url`, `prompt_none`, `created_at`, `expires_at` (indexed; TTL
  `CUSTOMER_AUTH_PENDING_TTL_MINUTES`, default 10).
- `customer_merge_conflicts`: `id`, `shopify_customer_id`, `shopify_customer_gid`,
  `shopify_email`, `email_row_customer_id`, `email_row_email`,
  `shopify_row_customer_id`, `conflict_kind` (`row_collision` | `email_mismatch`),
  `resolved_customer_id`, `session_id`, `created_at`, `resolved_at` — the audit log of
  case (d) in §4.

Elsewhere: the tier-3 columns of `customers` (`shopify_customer_id` with a unique partial
index, `shopify_customer_gid`, `shopify_linked_at`, `identity_tier`; migration `0015`
`shopify_account_summary` + `_updated_at`, §8) → `DATABASE.md` `customers`;
`customer_session_links` (`0019`, `0071`) and `customer_link_grants` (`0073`) →
`DATABASE.md` „The customer entity“; what each table holds and how long →
[`DATA_RETENTION.md`](./DATA_RETENTION.md) „Cluster B (cont.) — Signed-in customers (tier 3)“
and „Retention windows (tier 3)“ (the retention cron purges pending records past expiry and
grants a day past expiry).

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
`error=login_required`). It is read-only (no sign-in is completed). Token lifetimes
must be read from a real exchange.

## 7. How to run a live sign-in test

1. **Shopify admin:** Headless channel → Customer Account API client
   (PUBLIC), register the URLs (built from `PUBLIC_BASE_URL`, which includes the scheme):
   - Callback: `<PUBLIC_BASE_URL>/api/auth/shopify/callback`
   - JavaScript origins: `https://www.motionsports.de`, `https://motionsports.de`
   - Logout URI: `<PUBLIC_BASE_URL>/api/auth/shopify/logout/return`
2. **Env:** set `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID`, `PUBLIC_BASE_URL`,
   `TOKEN_ENC_KEY` (`openssl rand -hex 32`), `SHOPIFY_STOREFRONT_DOMAIN`, and a
   DB (optional: `SHOPIFY_CUSTOMER_ACCOUNT_STATE_SECRET`). Leave
   `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET` empty (public).
3. **Migrate:** `npm run db:migrate` (run by the maintainer).
4. **Gate:** `npm run verify:customer-account` (from an egress-capable host).
5. **Sign in:** open
   `<PUBLIC_BASE_URL>/api/auth/shopify/login?session=<any-session-id>&return_url=https://www.motionsports.de/`
   in a browser, complete the Shopify login, and confirm the redirect lands on
   `…?ms_auth=ok&ms_code=<code>`.
6. **Link:** `POST <PUBLIC_BASE_URL>/api/auth/link` with `{ "code": "<code>" }`,
   `Origin: https://www.motionsports.de`, `x-ms-chat-key: <secret>` and
   `x-ms-session: <same-id>` → `{ "ok": true, "signedIn": true }` (any other session
   id → `400`, and the code is used up).
7. **Re-hydrate:** `GET <PUBLIC_BASE_URL>/api/auth/me?session=<same-id>`
   with `Origin: https://www.motionsports.de` + `x-ms-chat-key: <secret>` →
   `signedIn: true` with `identity.name` and `tier: 3` (full shape: ACCOUNT_CONTRACT §4).

## 8. Signed-in data in the profile + live chat (CA-2 / CA-3)

For a **signed-in (tier-3)** customer we pull the interesting Customer Account
data and feed it into the **internal marketing profile** and the **live chat**,
reusing the **existing customer-memory mechanism** and its consent gate. This is
**profile + live-chat personalisation only** — it does **not** touch the
marketing CONSENT model (§10): signing in still establishes identity, never
marketing consent.

### What we fetch — and from where

Via the **Customer Account API GraphQL** endpoint (from discovery,
`account.motionsports.de/customer/api/<version>/graphql`) with the customer's
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

### Where it's cached — keyed by the customer row

The normalisation (`lib/customer-account-data.mjs`, unit-tested) maps the
Customer Account response into the shapes the rest of the app already consumes;
`refreshSignedInCustomerCache(customerId)` (`lib/customer-account-cache.ts`) ties
token → fetch → cache:

- **Order history → `customers.purchase_summary`** (migration 0008), replacing the
  email-keyed Admin-API fetch (`fetchOrderHistoryByEmail`) as its source for tier 3.
  Since the order ledger (migration `0062`) the live-chat memory, profile generation
  and campaign drafts read `loadPurchaseHistory` (`customer-orders-store.ts`):
  `customer_orders` first, `purchase_summary` only for a customer without ledger
  rows who was never synced. The admin's per-customer marketing draft, letter draft
  and bundle suggestion still read `purchase_summary` directly.
- **Name + a DATA-MINIMISED address context (city + country code only) →
  `customers.shopify_account_summary`** (migration **0015**) — for the greeting
  and the profile. We never cache the raw street, phone, or order totals here.
  (While the letters channel is on, `PHYSICAL_MAIL_SENDS_APPROVED`, a complete
  address from the account is stored separately as the lawful postal address — never
  in this summary and never fed to the profile model.)

It runs **on sign-in** (the callback, best-effort), when an admin clicks **„Käufe
aktualisieren“** and for stale customers in the nightly `refresh-customers` cron — the
last two through `refreshCustomerData` (`customer-refresh.ts`), which prefers the
Customer Account API while the customer has a live token and falls back to the Admin
API by e-mail.

### How it reaches the chat — same mechanism, same minimisation

`resolveChatIdentity({ sessionId, email })` (`lib/customer-memory.ts`; returns
`{ signedIn, memory }`, `resolveChatMemory` is its memory-only form) is the single
entry point the chat route uses. **Signed-in identity takes precedence** (it's the
authenticated session), falling back to the tier-2 email path:

- **Re-identification** for a signed-in user is the **authenticated session
  itself** — `resolveSignedInMemory` requires `resolveLiveSignedInCustomer` (§4: a
  live chat token, refreshed if needed, or the fresh shop proof) before surfacing
  anything, so a logged-out/expired session resolves to nothing (fail-closed),
  exactly like `/api/auth/me`. The chat route also uses this signed-in result to
  withhold the e-mail summary offer (§10).
- **Greeting (CA goal 2):** the chat greets the returning signed-in customer by
  **name** (from `shopify_account_summary`), tonally fitting the segment (formal
  „Sie“ for `studio` / `public_sector`). The greeting uses only the **session's own
  authenticated identity**, so it is shown to any live signed-in customer.
- **Personalisation (CA goal 1):** the **current-understanding summary + owned
  items + address context** are injected via the **same** customer-memory block,
  with the **same data minimisation** — a compact summary, owned-item titles +
  quantities, counts; **never** raw transcripts, order totals, or the email in
  the prompt.
- **Profile (CA goal 3):** for tier 3 the richer Shopify data flows into the
  existing profile generation (orders via `loadPurchaseHistory`, plus the
  data-minimised location context).

### The consent gate (unchanged personalisation requirement)

History-personalisation stays gated on the **same** consent as tier 2 —
`CONSENT_COPY_LAWYER_APPROVED` **and** the personalisation purpose being covered
— enforced by `canPersonaliseSignedIn({ lawyerApproved, marketingStatus,
shopifySubscribed? })` (the chat passes the first two; `marketingStatus` already mirrors
the one consent):

| Visitor | Greeting by name | History / profile / address personalisation |
|---|---|---|
| Anonymous (tier 1) | no | no |
| Signed-in, **not** consented | **yes** (authenticated UX) | **no** (fails closed) |
| Signed-in, marketing-consented + lawyer flag on | yes | **yes** |

The gate is two hard conditions, both fail-closed:

1. **`CONSENT_COPY_LAWYER_APPROVED`** — the consent/privacy copy that covers
   "profile building from past interactions and purchases" must be legally signed
   off. It is a code constant, **`true`** (lawyer-approved June 2026), so this
   condition is satisfied; personalisation then depends on condition 2 below, per user.
2. **Marketing consent on record (`marketing_status = 'confirmed'`)** — the
   mirror of the one consent `email_consent_state = 'subscribed'`, given in Mo
   with a double opt-in **or** on a Shopify surface (the consent text covers
   personalisation from past conversations + purchases, see
   [`CUSTOMERS.md`](./CUSTOMERS.md)). Signing in never sets this
   (`canPersonaliseSignedIn` in `src/lib/customer-account-data.mjs`).

So a **non-consented or anonymous** user gets **no** purchase history, profile,
or address in the prompt — the consent gate governs personalisation exactly as
for tier 2; only the signed-in name greeting (the session's own identity) is
added on top.

### Order status in the chat (`get_order_status`, default off in code)

Separate from personalisation: a signed-in customer may ask Mo about the **state
of their own orders** (status, shipping, delivery, refund) and Mo answers from
the order ledger plus a short live Admin API read (`lib/order-status.ts`, pure
rules in `order-status-core.mjs`, tested). This is customer service, not
personalisation, so it does **not** need the marketing consent above
(Art. 6 (1) b). Live state of the switch: [`ROLLOUT_TODO.md`](./ROLLOUT_TODO.md) 6.6. Its
gate is stricter than the resolver's:

- `CHAT_ORDER_STATUS_ENABLED` is on (default `false` in code; while off the tool is
  withheld and the prompt is unchanged) — or, for a live check, the session is signed
  in via the Customer Account as one of `CHAT_ORDER_STATUS_TEST_CUSTOMERS` (Shopify
  customer ids; `isOrderStatusEnabledFor` in `order-status.ts`): tool and prompt then
  change for that session only;
- the session's link is the **Customer Account sign-in in this session** —
  `resolveSignedInLink` reads `link_kind` explicitly and only `customer_account`
  counts; an App Proxy link (`app_proxy`), a typed e-mail or a `legacy` link get
  `sign_in_required` (for an `app_proxy` session with `signedInViaShop: true`: Mo says
  the customer is recognised, but order status needs one „Anmelden“ in the chat, and
  links „Meine Bestellungen“);
- `getValidAccessToken(customerId)` returns a **live token** (refreshing if
  needed) — signed out or expired → `sign_in_required`. The access gate is
  resolved once per chat request, so parallel tool calls never refresh the
  token twice;
- `SHOPIFY_CUSTOMER_SYNC_ENABLED` keeps the ledger current — otherwise
  `unavailable` (checked before the token refresh); the access step (link +
  token) is bounded by 5 s → `unavailable`;
- the first order import has finished (`isOrderImportDone`) — otherwise
  `unavailable`.

The ledger rows read are those Shopify reports for **the session's Shopify
customer** (`findCustomerOrders(customerId, shopifyCustomerId)`), linked to
this customer or not linked yet (an order whose webhook came before the
mirror). The upsert moves an order Shopify reassigns to another customer
along with it. The model receives order date, items, normalised order/payment
state, the carrier name and delivery dates — never the order number, amounts,
tracking numbers or links, addresses, ids or the e-mail. A live order whose
`customer.id` is not the session's Shopify customer is **not shown at all**
(a matched number then reads as `not_found`). „No orders“ and „not found“ are
answered only when a live read of the customer's five newest orders confirms
the ledger is not behind (`confirmLedgerAnswer`); otherwise `unavailable`. At
most three distinct lookups per chat request (repeats come from the request's
cache). Returns, cancellations and complaints stay with the contact form. Legal:
[`ANWALTSDOSSIER.md`](./ANWALTSDOSSIER.md) §16 (F-32); tool shape and „render nothing“:
[API_CONTRACT](./frontend/API_CONTRACT.md) §2; widget side of `signedInViaShop`:
ACCOUNT_CONTRACT §3a.

## 9. Signed-in conversation history (tier 3)

A signed-in customer can browse, open, rename and delete their own **past
conversations**, download a summary (§11) or all their data, and erase everything.
Shapes, statuses and widget behaviour: ACCOUNT_CONTRACT §7 (§7.1–§7.7) and §8. This
section holds the internals.

### The gate (fail-closed, behind the signed-in resolver)

Every `/api/account/*` request runs the same gate (`lib/account-guard.ts ::
requireSignedInCustomer`), in this order:

1. **`guardRequest`** — origin allowlist + shared secret (`x-ms-chat-key`),
   like `/api/chat`. Widget XHR, with a CORS preflight.
2. **Rate limit** — the chat bucket.
3. **`resolveLiveSignedInCustomer(session)`** (§4; session from `?session=`, else
   `x-ms-session` — `readSession`) — the session must link to a customer with a
   `shopify_customer_id` **through a sign-in proven in this session** (`link_kind`
   `customer_account` / `app_proxy`). **Anonymous**, **email-only** (even for a
   Shopify customer) and `legacy` sessions → **401 „Nicht angemeldet“**, before any
   history is read.
4. **Still live**, exactly like `/api/auth/me`: a valid access token (refreshing
   if needed), or for an `app_proxy` link the fresh shop proof under
   `APP_PROXY_SIGNIN_MAX_AGE_HOURS` (§2). A proof that ran out → 401 „Sitzung
   abgelaufen“. The guard returns the proof (`token` | `shop`), which the opt-in
   records (§10).

**Resolved across devices.** All of a signed-in customer's sessions — on every
device — link to the **same** `customers` row (keyed by `shopify_customer_id`),
so history is scoped by `customer_id` and is therefore the customer's **whole**
history regardless of which device opened each conversation. Every per-id
operation additionally constrains `customer_id = <self>`, so a conversation the
caller doesn't own is **indistinguishable from a missing one** (404 — no
enumeration leak).

### Routes and handlers (all under `/api/account`)

Shapes: ACCOUNT_CONTRACT §6.2, §7.1–§7.7, §8.

| Route | Handler (lib) |
|---|---|
| `GET conversations` | `listCustomerConversations` (`account-history.ts`) |
| `GET` / `PATCH` / `DELETE conversations/{id}` | `getCustomerConversationTranscript` / `renameCustomerConversation` (`sanitizeTitleInput`) / `deleteCustomerConversation` |
| `GET summary?conversationKey=` | `loadCustomerConversationForSummary` → `buildSummaryDocument` → `buildSummaryPdf` (§11) |
| `GET export` | `buildCustomerDataExport` (`account-export.ts`); KPI `account_export_requested` |
| `POST erase` | `eraseSignedInCustomer` → `erasePerson` (below) |
| `POST marketing-opt-in` | §10 |

### Multiple threads per session (migration 0018)

`session_id` is the identity link and must not rotate while signed in, so it is
not the *thread* key. `conversations.conversation_key` (a stable, client-generated
value the widget sends on `/api/chat`) is the uniqueness key; `session_id` stays on
the row (not unique) as the match-up/summary bridge.

- A session can host **many** conversations — "Neue Beratung" sends a fresh
  `conversationKey`, creating a new history row instead of growing one thread.
- The list + transcript responses return `conversationKey` so the widget can
  **resume** a thread (send it back on `/api/chat`), even across devices — the
  upsert never rewrites a row's `session_id`.
- **Backward-compatible:** a client that sends no key defaults
  `conversation_key = session_id` (one thread per session).
- Session-keyed reads that assume a single thread take the **most recently
  active** thread of the session (`loadConversationForSummary`,
  `getConversationIdBySession`); the capture attach and the sign-in redeem use
  `WHERE session_id`, so they link **all** of the session's threads to the customer
  (the redeem only those without a customer or of the same one, §4) and never
  another session's.

### Eager create + customer-link at creation (migration 0026)

Every started thread is durable and listed, even before the assistant answers:
`lib/conversation-create.mjs :: ensureConversationStarted`, called from `/api/chat`
**before** the stream (concurrently with retrieval):

- **Eager:** the conversation row + the first user message are written at the
  **first send**, before the model answers — so the thread lists immediately and
  survives a reload.
- **Customer-linked at creation:** the row is stamped with the session's linked
  `customer_id` (resolved from `customer_session_links`, `resolveLinkedCustomerId`)
  the moment it is created. `persistTurn` is the backstop — it resolves + stamps
  `customer_id` too, `COALESCE`-ing so it never NULLs an existing link or
  re-clobbers a thread that signed in mid-way.

Anonymous sessions create pseudonymous rows (`customer_id` stays NULL). (The defects
this replaced: archive history file.)

### Titles are cheap — cached on the row, no model call per render

The list TITLE is the customer's **custom title** (set via RENAME, stored in
`conversations.title`, migration `0016`), else the **derived** label cached on the row
at creation (`conversations.title_auto`, migration `0026`): the first user message,
whitespace-collapsed and trimmed to 80 chars (`lib/conversation-title.mjs ::
deriveConversationTitle`), else „Beratung“. No model call runs per list render.

**List performance (migration 0026).** The list query
(`listCustomerConversations`) is `WHERE customer_id = <self> ORDER BY
last_activity_at DESC, id DESC LIMIT 100`, served in one indexed walk by the composite
**partial** index `conversations(customer_id, last_activity_at DESC, id DESC) WHERE
customer_id IS NOT NULL`. `messageCount` (readable user/assistant turns, tool rows
and empty turns excluded) is a single indexed `COUNT` per row over
`messages_conversation_idx`.

### Deletion semantics — single-chat delete vs. the durable profile

`DELETE /api/account/conversations/{id}` **hard-deletes that one transcript** — the
`conversations` row plus its `messages` and chat `ai_usage` (FK `ON DELETE CASCADE`),
immediately and irreversibly. The durable "current understanding" profile
(`customers.profile_summary`) is a **separate aggregate under a different lawful
basis**: a future regeneration no longer sees the deleted chat, but text already
derived persists until the profile is regenerated or the customer is erased. Owner of
this rule and its lawful-basis reasoning: [`DATA_RETENTION.md`](./DATA_RETENTION.md)
„Signed-in conversation history — single-chat delete vs. the durable profile“.

### The distinct full "delete my data" path

`POST /api/account/erase` (`lib/account-history.ts :: eraseSignedInCustomer`) is a
**GDPR erasure of the person**, separate from the single-chat delete. It calls **the one
erasure path** `erasePerson` (`src/lib/customer-erasure.ts`) — the same as the mail link
`/api/erase-data`, the admin's „Löschen“ and Shopify's `customers/redact` /
`customers/delete` webhooks. What it deletes, per table: [`DATA_RETENTION.md`](./DATA_RETENTION.md)
„Complete erasure — one path for every way to delete“ (plan: `ERASURE_PLAN` in
`customer-erasure-core.mjs`, tested). The Shopify side (the erasure tombstone, the outbox
rows and the switches that send them): [`CUSTOMERS.md`](./CUSTOMERS.md) „Retention / erasure“;
the consent effect: [`CONSENT_FLOW.md`](./CONSENT_FLOW.md) „Erasure (one deletion with Shopify)“.
The widget's confirmation copy comes from `GET /api/consent-copy?surface=erase`
(API_CONTRACT §7.4) and names the shop account only while `SHOPIFY_ERASURE_SYNC` is on.

After erasure the customer row, its tokens and every session link are gone, so every
subsequent `/api/account/*` call (and `/api/auth/me`) for those sessions fails closed.
Ending the Shopify session itself is the separate logout (ACCOUNT_CONTRACT §5, §7.5).

## 10. At-sign-in marketing opt-in + the match-up (CA-4)

Signing in is **identity, not marketing consent** (§1). A signed-in customer may opt
in with one explicit act and the existing double opt-in. Owners elsewhere: the legal
reasoning and DOI mechanics → [`CONSENT_FLOW.md`](./CONSENT_FLOW.md) "At-sign-in
marketing opt-in"; when the widget asks (`optInActionable`, anti-nag, expired DOI) →
ACCOUNT_CONTRACT §6.1; the submit shape and answers → ACCOUNT_CONTRACT §6.2; the copy
payload → API_CONTRACT §7.4 and its rendering → [`CONSENT_CONTRACT.md`](./frontend/CONSENT_CONTRACT.md)
§3. The ask appears as a popup right after a sign-in and as an inline card after a
sign-in mid-conversation; the anonymous chat consent gate (`surface=chat`,
`POST /api/chat-marketing-opt-in`) is retired in the widget and still served for
compatibility (CONSENT_CONTRACT §2).

### The opt-in state — `resolveMarketingOptInState`

`lib/signed-in-identity.ts → resolveMarketingOptInState(customerId, route)` is the one
function behind the `marketing` object of `/api/auth/me` and of whoami (§2), so the two
detection paths cannot diverge:

- `status` = `customers.marketing_status`, the legacy mirror of the one consent
  (`legacyMarketingStatus`: `subscribed` → `confirmed`, `pending` → `pending`,
  `unsubscribed` → `unsubscribed`, `not_subscribed` → `none`). Sign-in imports no
  consent, but the row already carries whatever the one consent holds — a prior DOI
  under the verified e-mail (carried forward by the §4 stamp branch) or a shop
  newsletter subscription (once the customer mirror has the person).
- `optInActionable` = a real e-mail (contains `@`, not the `shopify:` placeholder)
  **and** `status === 'none'` **and** not `consentAskQuiet`.
- No customer row, a read error or no database → `{ status: 'none', optInActionable:
  false }` (fail closed; errors reported with phase `marketingState`).

**Anti-nag (`consentAskQuiet`).** One query joins `customer_session_links` (all links of
the customer, any kind) with `kpi_events` of the last 30 days, counting **distinct
sessions** with `consent_gate_declined` / `consent_gate_shown` whose
`data->>'surface' = 'signin'`; the pure rule `isConsentAskQuiet`
(`consent-ask-policy.mjs`, tested) is quiet at ≥ 1 declined session or ≥ 3 shown
sessions (`CONSENT_ASK_MAX_SHOWN_SESSIONS`). Because it counts only sessions still
linked to the customer, ending links resets it for those sessions: the backend logout
(and a revoked token) deletes every signed-in link of the customer (§4), so the
`consent_gate_*` events of those sessions **stop counting** after a logout (sessions
linked only by a typed e-mail stay linked); a handover drops the one session. An erasure
deletes the events themselves.

**Expired DOI.** A `pending` consent whose link was never clicked is reset to
`not_subscribed` by the nightly `expirePendingConsents` (`consent-store.ts`; rule and timing:
[`CONSENT_FLOW.md`](./CONSENT_FLOW.md) "The one consent (Shopify ⇄ Mo)"), so `status` reads
`none` and the ask may come again.

### The submit — `POST /api/account/marketing-opt-in` (internals)

1. The standard gate (§9) → the customer and the sign-in proof.
2. `marketingConsent === true` required (no auto-enrol), else `400`.
3. The address is `customers.email` — the verified one; the synthetic `shopify:<id>`
   placeholder → `422 no_verified_email`; no customer → `404 not_found`.
4. Version stamp: `resolveConsentCopyVersion` stamps `CONSENT_COPY_VERSION` (`v5`,
   `consent-copy-version.mjs`) only when the echoed `consentTextShown` is byte-identical
   to `signInMarketingConsentCopy(locale).consentTextShown`; anything else is stored
   unattested (NULL).
5. `isEmailAlreadySubscribed` → an address already subscribed (shop or earlier DOI)
   gets no second DOI mail; then the same `upsertEmailCapture` as `/api/capture-email`.
6. `linkCustomerOnEmailCapture({ email, sessionId })` attaches the session's chats; its
   `email` link for the **same** customer never weakens the signed-in link (§4).
7. `recordMoOptIn` (`consent-flows.ts`) reports a new DOI to the one consent as
   `pending` (source `mo_signin`, through `applyConsentAct`); its `consent_events` row
   notes the proof (`signInProofNote`: „Anmeldenachweis: Kundenkonto-Anmeldung im Chat“ /
   „Anmeldenachweis: Shop-Login (App Proxy)“). When no new DOI is pending (address
   already subscribed, or suppressed) it writes no act.
8. Server-only KPI events `email_capture_submitted` + `email_capture_marketing_opted_in`
   (`trigger: "signin_optin"`, known `placement` / `variant` only); the DOI mail goes
   out only when newly pending.

### The match-up (consent carry-forward + session scope)

- **email-only → signed-in:** the §4 stamp branch writes only identity columns, so a
  prior DOI consent under that e-mail carries forward intact; collisions are logged,
  never fused. Owner of the consent side (including the mirror's `mergeCustomers` for
  two rows of one person): [`CONSENT_FLOW.md`](./CONSENT_FLOW.md) "Match-up on sign-in".
- **current session → signed-in:** the session's conversations are attached when the
  one-time code is **redeemed**, for the session the grant names — Customer Account and
  App Proxy alike — and only those without a customer or of the same customer (§4).
  Other sessions' anonymous threads are never scooped.

### §7(3) Bestandskunden — REMOVED

Retired 2026-06-16 (migration `0029`): [`CONSENT_FLOW.md`](./CONSENT_FLOW.md) "§7 Abs. 3
UWG Bestandskunden — REMOVED".

### Where the opt-in is surfaced for tier 3 — and where it is NOT

For a signed-in customer the end-of-chat e-mail-summary + marketing capture is
suppressed and the ask moves to after the sign-in; the widget gate (`identity.tier ===
3`) and the 422 fallback: ACCOUNT_CONTRACT §6.0. Backend side: `/api/chat` does not offer
`offer_email_summary` (nor force the checkout-moment ask) when `resolveChatIdentity`
reports the session signed in (§8) — fail-open: a failed sign-in lookup keeps the offer.
Tiers 1–2 are unchanged.

## 11. Conversation summary download (signed-in, S5 structure reused)

A signed-in (tier-3) customer can **download** a summary of any one of their
threads („Zusammenfassung herunterladen“). It is the **same** S5 structured summary as
the transactional summary **email** — AI prose → chosen products → **Zur Kasse** →
divider → **„Vielleicht auch interessant:“** alternatives — **assembled by the very
same function** (`buildSummaryDocument`, `lib/summary-email.ts`), then rendered to PDF,
not a second layout. The email and the download can therefore never drift apart in
content. Endpoint shape, headers, filenames and the widget's Blob download:
ACCOUNT_CONTRACT §8.

### Format: PDF

`lib/summary-pdf.mjs :: buildSummaryPdf` renders the structured pieces
`buildSummaryDocument` returns (`summary`, `chosen`, `cartUrl`, `alternatives`) into a
branded document — letterhead + footer, the same sections as the email — on the repo's
**dependency-free** hand-written PDF stack (`lib/pdf-core.mjs`, shared with the
physical-letter PDF — **no headless browser / PDF dependency** on Vercel).

### Endpoint internals — `GET /api/account/summary?conversationKey=<key>`

- **Gate:** the standard signed-in gate (§9) — a live chat token **or** the fresh shop
  proof.
- **Scope:** keyed by the thread's **`conversationKey`** (migration 0018), not the
  numeric `conversationId` of the rename/delete routes.
  `loadCustomerConversationForSummary` reads `conversation_key = <key> AND customer_id
  = <self>` (at most 500 messages), so a foreign/unknown key is indistinguishable from a
  missing one (404).
- **Cost (S6):** when the prose needs a model call, the token usage is recorded as the
  **`summary_download`** call site, **linked to the conversation**, so it cascade-deletes
  with the transcript on single-chat delete / erasure. No model call (no API key / empty
  transcript) → nothing recorded; the prose degrades to the plain transcript, exactly
  like the email.
