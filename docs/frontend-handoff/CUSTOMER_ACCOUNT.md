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
unchanged, so the backend links it to the customer and the widget re-hydrates
exactly as it does on any reload. Do **not** generate a new session id around
sign-in.

> **Send the identical `session_id` on every hop.** Use the same value on the
> login redirect (`?session=`) and on `/api/auth/me` (`x-ms-session` / `?session=`).
> The backend keys re-hydration on that exact id (it never mints its own), so a
> different/regenerated id resolves to **`signedIn: false`**. Signing in **before
> sending any chat message works** — the identity link no longer depends on an
> existing conversation.

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
{
  "signedIn": true,
  "identity": { "name": "Max Mustermann", "tier": 3 },
  "marketing": { "status": "none", "optInActionable": true }
}
// not signed in (or anything unprovable — fails closed)
{ "signedIn": false }
```

- `identity.name` is read **live from Shopify** (authoritative) and may be `null`
  if Shopify returns no name — render a neutral fallback in that case.
- `tier` is `3` for a signed-in customer. The widget never sees tokens, email,
  addresses, or orders in CA-1 (those arrive in CA-2/CA-3).
- **`marketing`** (present only when `signedIn: true`) drives the **at-sign-in
  opt-in** and the **tier-3 suppression** (§6):
  - `status` — our DOI marketing state for this customer:
    `"none" | "pending" | "confirmed" | "unsubscribed"`. This is **our**
    double-opt-in state only; signing in never imports Shopify's marketing state.
  - `optInActionable` — `true` ⇔ surface the at-sign-in opt-in card (§6.1). It is
    `true` exactly when the customer has **no marketing decision on record yet**
    (`status === "none"`) **and** has a real verified email. It is `false` once a
    decision exists (`pending` / `confirmed` / `unsubscribed`) or for the rare
    account with no verified email. Treat it as the single source of truth for
    "should I show the opt-in" — don't re-derive it from `status` yourself.
- A `CORS` preflight (`OPTIONS`) is supported; the endpoint advertises
  `GET, OPTIONS`.

## 5. Logout (optional, for CA-3)

Logout is **backend-initiated** — the widget cannot build Shopify's OIDC
`end_session` URL itself (it never sees discovery or tokens). Send the
**top-level window** to:

```
GET {BASE_URL}/api/auth/shopify/logout
      ?session={session_id}
      &return_url={the storefront URL to come back to}
```

The backend constructs the Shopify `end_session` redirect (with
`post_logout_redirect_uri = {BASE_URL}/api/auth/shopify/logout/return`), Shopify
ends its session, then the return route **drops the server-side tokens** for that
session and bounces the browser back to the storefront with
**`?ms_auth=logged_out`**. If the store doesn't advertise an `end_session`
endpoint, the route degrades to a **local sign-out** (tokens dropped, same
`?ms_auth=logged_out` bounce) — no widget change needed either way.

The account/history linkage is **not** deleted — logging out ends the session,
not the account (full erasure is §7.5). Same open-redirect rule as login:
`return_url` must be an allow-listed storefront origin.

## 6. What does NOT change — and where the opt-in moves for tier 3

The anonymous and email-capture flows are untouched. Sign-in is **identity only**
— it does **not** opt the customer into marketing. The double-opt-in email flow
remains the only path to marketing consent. A visitor can use the chat fully
without ever signing in.

### 6.0 Tier-3 suppression contract (end-of-chat capture widget)

For a **signed-in (tier 3)** customer the redesign **moves** the marketing
opt-in: the **end-of-chat email-summary + marketing-opt-in widget is
suppressed**, and the opt-in is surfaced **at sign-in** instead (§6.1).

- **Gate on `tier`.** `/api/auth/me` returns `identity.tier`. When `tier === 3`,
  **do not render** the end-of-chat capture/opt-in card (the "type your email +
  get the summary + tick marketing" widget). A signed-in customer doesn't need
  it: they can **download** the summary instead (§8) and their opt-in lives at
  sign-in.
- **Tiers 1–2 are unchanged.** Anonymous and email-only visitors still get the
  end-of-chat capture form exactly as today (the `offer_email_summary` tool flow
  in [`API_CONTRACT.md`](./API_CONTRACT.md) §2/§7). This is purely a tier-3
  frontend gate — the backend's capture flow is untouched.

### 6.1 The at-sign-in marketing opt-in (v3) — gated on `optInActionable`

A signed-in customer is offered a one-tick marketing opt-in that skips re-typing
their email (we already hold the verified address). It is **still the same
double-opt-in**, **still unticked by default**, and **still a separate, explicit
act** — signing in never enrols anyone.

**When to show it — read `marketing.optInActionable` from `/api/auth/me` (§4).**
Show the at-sign-in opt-in card **only** when `signedIn: true` **and**
`marketing.optInActionable === true`. That flag is `true` exactly for a signed-in
customer who has **not yet recorded a marketing decision**; it is `false` once
they've decided (DOI `pending` / `confirmed` / unsubscribed) — so a customer who
already opted in (or whose prior opt-in carried forward when their email merged
into the signed-in identity) is **not** re-asked. The widget MAY additionally
remember a local "dismissed" state for the session so a customer who closed the
card isn't shown it again in the same session — but the **backend** truth for
"already decided" is `optInActionable: false`.

Render contract (copy + submit endpoint) is in
[`CONSENT_FLOW.md`](./CONSENT_FLOW.md) §2 (`GET /api/consent-copy?surface=signin`
→ tick → `POST /api/account/marketing-opt-in`). Never pre-tick it. After a
successful opt-in, the next `/api/auth/me` reports `optInActionable: false`.

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
      "conversationId": 412,                          // numeric DB id — for rename/delete (§7.3/§7.4)
      "conversationKey": "c3f1e8a2-…",                // thread key — send on /api/chat to RESUME (§7.6)
      "title": "Welche Laufschuhe passen zu mir?",   // custom title, else first user msg trimmed
      "createdAt": "2026-06-01T09:14:22.000Z",
      "updatedAt": "2026-06-01T09:31:05.000Z",
      "messageCount": 8                               // readable user/assistant turns
    }
    // …
  ]
}
```

> Each item carries **two** ids: `conversationId` (numeric DB id, used in the
> `/api/account/conversations/{id}` rename/delete URLs) and `conversationKey`
> (the chat-thread key — send it as `conversationKey` on `/api/chat` to **resume**
> this thread; see §7.6).

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
    "conversationKey": "c3f1e8a2-…",        // send on /api/chat to RESUME this thread (§7.6)
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

### 7.6 Multiple conversations under one stable `session_id`

The history list can now hold **multiple threads** for a customer because the
widget keys each conversation with a **`conversationKey`** (a stable,
client-generated string) sent on `/api/chat`, while `session_id` stays the
unchanging identity link. See [`API_CONTRACT.md`](./API_CONTRACT.md) §2
("Optional `conversationKey`") for the full rules. In short:

- **"Neue Beratung"** → keep `session_id`, generate a **fresh** `conversationKey`,
  clear the local `messages`. The first turn under it creates a new history row.
- **Open a past conversation** → load its transcript (§7.2) and adopt its
  **`conversationKey`** as the active thread; the next `/api/chat` turn sends
  that key and appends to the right thread.
- **Omit `conversationKey`** → legacy one-thread-per-session (backward-compatible).

## 8. Download a conversation summary — `GET /api/account/summary`

Backs the widget's **"Zusammenfassung herunterladen"** button for a signed-in
customer. It returns the **same** structured summary as the email motion sports
mails after a chat — AI prose → chosen products → **Zur Kasse** → divider →
**"Vielleicht auch interessant:"** alternatives — rendered with the **same
branded template**. (It is literally the email renderer; the download and the
mailed summary can't diverge.)

**Format: a branded HTML document, served as a file attachment.** HTML was chosen
because it reuses the email template directly (no PDF pipeline). You receive the
HTML as the response body of a guarded XHR and save it as a file client-side.

```
GET {BASE_URL}/api/account/summary?conversationKey={conversationKey}
Headers:
  x-ms-chat-key: {shared secret}
  Origin:        {storefront origin}        (browser-set)
  x-ms-session:  {session_id}               (or ?session= query param)
```

- **`conversationKey`** is the per-thread key from the history list / transcript
  (§7.1/§7.2) — the same value you send on `/api/chat` to resume a thread. **Not**
  the numeric `conversationId`. For the **active** chat, use the thread's current
  `conversationKey`.
- **Same fail-closed guards as the rest of `/api/account/*`**: an anonymous /
  email-only / logged-out session → **401**. Only offer the button once
  `/api/auth/me` reports `signedIn: true`.
- The thread must belong to the caller — a key that isn't this customer's (or is
  unknown) returns **404** `bad_request` (`"Konversation nicht gefunden"`), same
  as a missing one. A missing/empty `conversationKey` → **400** `bad_request`.

### Success response

```http
HTTP/1.1 200 OK
Content-Type: text/html; charset=utf-8
Content-Disposition: attachment; filename="motionsports-zusammenfassung-….html"
Cache-Control: no-store
```

The body is the full branded HTML document (a complete `<!DOCTYPE html>` page).

### Triggering the download from the widget

Because the endpoint is a **guarded XHR** (it needs the `x-ms-chat-key` + session
headers, which a plain `<a download>` / `window.location` navigation can't send),
fetch it and save the body as a `Blob`:

```js
const res = await fetch(
  `${BASE_URL}/api/account/summary?conversationKey=${encodeURIComponent(conversationKey)}`,
  { headers: { "x-ms-chat-key": SHARED_SECRET, "x-ms-session": sessionId } }
);
if (!res.ok) { /* 401 → re-auth UI; 404 → "nicht gefunden"; else generic error */ }
const blob = await res.blob();           // text/html
const url = URL.createObjectURL(blob);
const a = Object.assign(document.createElement("a"), {
  href: url,
  download: "motionsports-zusammenfassung.html",   // name it yourself; server name is advisory
});
a.click();
URL.revokeObjectURL(url);
```

- The download is **on-demand and may make one AI call** (the German prose
  summary), so it can take a moment — show a spinner and don't impose a short
  timeout. If the model/API is unavailable it gracefully falls back to a plain
  transcript summary (never an error).
- It reflects the thread's **current** state (latest selected/discussed products,
  newest transcript) each time it's downloaded.
