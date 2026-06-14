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

## 7. Signed-in conversation history (CA-3-THEME contract)

A **signed-in** customer can browse, open, rename and delete their own past
conversations — and erase all of their data. These are widget XHRs under
`/api/account/*`, so they carry the **same guards as `/api/auth/me`**:

```
x-ms-chat-key: {shared secret}
Origin:        {storefront origin}        (browser-set)
x-ms-session:  {session_id}               (or ?session= query param)
```

All of them:

- are **fail-closed**: an anonymous or **email-only** session (not signed in via
  Shopify), or a logged-out / expired one, gets **HTTP 401**
  `{ "error": { "code": "unauthorized", "message": "…" } }`. Only render the
  history UI once `/api/auth/me` reports `signedIn: true`.
- return JSON with `Cache-Control: no-store` and support a CORS `OPTIONS`
  preflight (the per-id route advertises `GET, PATCH, DELETE, OPTIONS`).
- are scoped to the signed-in customer **across devices** — the list is the
  customer's whole history, whichever device opened each chat. A conversation id
  the customer doesn't own returns **404** (same as a missing one).

> If anything here disagrees with the backend, the backend wins
> (`docs/CUSTOMER_ACCOUNT.md` §9).

### 7.1 List — `GET /api/account/conversations`

Most-recent-first. Each item has a ready-to-render `title` (never null), the
timestamps, and the readable message count. **No pagination params** in v1
(capped at 100 server-side).

```jsonc
// 200 OK
{
  "conversations": [
    {
      "conversationId": 412,
      "title": "Welche Laufschuhe passen zu mir?",   // custom title, else first user msg trimmed
      "createdAt": "2026-06-01T09:14:22.000Z",
      "updatedAt": "2026-06-01T09:31:05.000Z",
      "messageCount": 8                               // readable user/assistant turns
    }
    // …
  ]
}
```

- `title` is **cheap** server-side (no model call): the custom title if the
  customer renamed it, otherwise the first user message trimmed to ≤ 80 chars
  (the backend falls back to `"Beratung"` when there's no user text yet).
- `createdAt` / `updatedAt` are ISO-8601 (or `null` if unknown). `updatedAt`
  bumps on rename; list order is by **last activity**, so a rename does **not**
  reorder the list.

### 7.2 Fetch transcript — `GET /api/account/conversations/{id}`

```jsonc
// 200 OK
{
  "conversation": {
    "conversationId": 412,
    "title": "Welche Laufschuhe passen zu mir?",
    "createdAt": "2026-06-01T09:14:22.000Z",
    "updatedAt": "2026-06-01T09:31:05.000Z",
    "personaLabel": "pragmatic_beginner",   // may be null
    "messageCount": 8,
    "messages": [
      { "role": "user",      "content": "Welche Laufschuhe passen zu mir?", "toolName": null },
      { "role": "assistant", "content": "Gern! Wofür möchtest du sie …",     "toolName": null }
      // … readable turns only; tool-bookkeeping rows are dropped
    ]
  }
}
```

- `400` `bad_request` if `{id}` isn't a positive integer.
- `404` `bad_request` (`"Konversation nicht gefunden"`) if it isn't this
  customer's conversation.

### 7.3 Rename — `PATCH /api/account/conversations/{id}`

```jsonc
// request body
{ "title": "Laufschuh-Beratung" }
// 200 OK
{ "ok": true, "conversationId": 412, "title": "Laufschuh-Beratung" }
```

- The title is trimmed, whitespace-collapsed, and bounded to **80 chars**
  server-side — send the raw user input; the response echoes the stored value.
- `400` `bad_request` for a missing/empty/non-string title or bad JSON.
- `404` `bad_request` if the conversation isn't this customer's.

### 7.4 Delete one chat — `DELETE /api/account/conversations/{id}`

```jsonc
// 200 OK
{ "ok": true, "conversationId": 412, "deleted": true }
```

- **HARD-deletes that one transcript** (messages included) — irreversible.
- `404` `bad_request` if the conversation isn't this customer's.
- **It does NOT erase the durable profile.** Deleting a chat means a future
  profile regeneration no longer sees it, but anything already learned persists
  until the profile is regenerated or the customer uses §7.5. Word the UI
  honestly: *"Dieser Chat wird gelöscht"*, not *"alle Daten gelöscht"*.

### 7.5 Delete ALL my data — `POST /api/account/erase`

A **distinct, heavier** action from §7.4 — confirm it explicitly in the UI.

```jsonc
// POST (no body required)
// 200 OK
{ "ok": true, "erased": true, "deletedConversations": 7 }
```

This erases the **person**: purges **all** conversations, clears the profile +
cached summaries, **revokes the stored OAuth tokens**, and suppresses the email.
After it returns:

- the session **no longer resolves** — `/api/auth/me` now returns
  `signedIn: false` and every `/api/account/*` call returns 401. Clear the
  signed-in UI immediately.
- consider also sending the user through Shopify logout (§5) to end the Shopify
  session itself.
- `503` `upstream_unavailable` means the erasure could **not** be performed
  (don't show "deleted" — let the user retry).
