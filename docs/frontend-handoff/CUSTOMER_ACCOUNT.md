# Customer Account sign-in — frontend contract

> **Synced copy.** Canonical source is the backend repo
> (`docs/CUSTOMER_ACCOUNT.md`). Whenever the backend contract changes, re-sync
> this folder. If anything here disagrees with the code, the code wins.

This is what the storefront widget needs to add **tier-3 sign-in** (a signed-in
Shopify customer) on top of the existing anonymous/email-capture flows. The
widget **never** handles OAuth tokens — it only triggers a full-page redirect and
later asks the backend who the session belongs to.

**Base URL (production):** `https://chat.motionsports.de` (today the Vercel URL;
always read it from config — it moves on DNS cutover).

## 1. The opaque session reference

Nothing new to store. The widget already keeps a stable `session_id` (a UUID in
`localStorage`, sent as `x-ms-session`). That **same `session_id` is the opaque
reference** to the signed-in identity after login — it survives the redirect
unchanged, so the backend can re-link the conversation to the customer and the
widget re-hydrates exactly as it does on any reload. Do **not** generate a new
session id around sign-in.

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

- `return_url` **must** be on an allow-listed storefront origin
  (`https://www.motionsports.de` / `https://motionsports.de`); anything else is
  ignored and the user is returned to the storefront root (open-redirect guard).
- The conversation is already server-persisted every turn, so there is nothing
  to flush first. Optionally stash a small "resume" marker (scroll position) in
  `localStorage` — the `session_id` itself is all the backend needs.
- Popups / new tabs are intentionally **not** supported (ITP / storage
  partitioning breaks cross-origin `postMessage`).

After Shopify auth, the backend finishes server-side and **302s the browser back
to your `return_url`** with a marker query param:

| `?ms_auth=` | Meaning | Suggested widget action |
|---|---|---|
| `ok` | Signed in; conversation re-linked | call `/api/auth/me`, show signed-in state |
| `login_required` | `prompt=none` only: not logged in | show the one-click "Sign in" affordance |
| `logged_out` | Returned from logout | clear signed-in UI |
| `error` | Anything went wrong | stay anonymous; optionally offer "Sign in" |

Strip `ms_auth` from the URL after reading it (e.g. `history.replaceState`).

## 3. Already-signed-in check (`prompt=none`)

Many visitors are already logged into Shopify on the storefront. To detect that
**without a click**, run the same redirect with `&prompt=none`:

```js
url.searchParams.set("prompt", "none");
```

- Logged in → Shopify returns silently and you land back on `?ms_auth=ok`.
- Logged out → you land back on `?ms_auth=login_required`.

**Degraded fallback (plan for it):** if `prompt=none` is not honored on this
store (the backend verify gate reports this), the silent check won't resolve
cleanly — there is **no functional loss**. In that case **skip silent detection**
and simply render a subtle one-click **"Sign in"** affordance that does the §2
redirect without `prompt=none`. Treat `prompt=none` as a best-effort optimisation,
not a requirement. (A cheap pre-hint, `ShopifyAnalytics.meta.page.customerId`,
may be read in JS to decide whether the silent attempt is even worth doing, but
it is not authoritative — never gate identity on it.)

> Because `prompt=none` causes a full-page redirect too, run it deliberately
> (e.g. once per session on first widget open), not on every page load.

## 4. Re-hydrating identity — `GET /api/auth/me`

After `?ms_auth=ok` (and on normal widget load) ask the backend who this session
is. This **is** a widget XHR, so it carries the usual guards.

```
GET {BASE_URL}/api/auth/me?session={session_id}
Headers:
  x-ms-chat-key: {shared secret}
  Origin:        {storefront origin}        (browser-set)
  x-ms-session:  {session_id}               (optional; query param also accepted)
```

Response (always HTTP 200, `Cache-Control: no-store`):

```jsonc
// signed-in
{ "signedIn": true, "identity": { "name": "Max Mustermann", "tier": 3 } }
// not signed in (or anything unprovable — fails closed)
{ "signedIn": false }
```

- `identity.name` is read **live from Shopify** (authoritative) and may be `null`
  if Shopify returns no name — render a neutral fallback in that case.
- `tier` is `3` for a signed-in customer. The widget never sees tokens, email,
  addresses, or orders in CA-1 (those arrive in CA-2/CA-3).
- A `CORS` preflight (`OPTIONS`) is supported; the endpoint advertises
  `GET, OPTIONS`.

## 5. Logout (optional, for CA-3)

To sign out, send the top-level window to Shopify's `end_session_endpoint` with
`post_logout_redirect_uri` = `{BASE_URL}/api/auth/shopify/logout/return?session={session_id}`.
The backend drops the server-side tokens for that session and bounces the browser
back to the storefront with `?ms_auth=logged_out`. The account/history linkage is
**not** deleted — logging out ends the session, not the account.

## 6. What does NOT change

The anonymous and email-capture flows are untouched. Sign-in is **identity only**
— it does **not** opt the customer into marketing. The double-opt-in email flow
remains the only path to marketing consent. A visitor can use the chat fully
without ever signing in.
