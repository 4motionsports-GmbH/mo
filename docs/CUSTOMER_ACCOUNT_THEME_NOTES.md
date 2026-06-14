# Customer Account (tier 3) — theme → backend handoff

> Written by the Shopify theme snapshot while wiring tier-3 sign-in + signed-in
> conversation history into the chat widget (`assets/ms-chat-widget.js` +
> `assets/ms-chat-widget.css`). Everything the widget actually *calls* is already
> in `docs/ai-advisor/{CUSTOMER_ACCOUNT,API_CONTRACT}.md`; this file records the
> implementation choices the contract left open and the **two things the widget
> needs the backend to confirm or add**. None of it blocks the anonymous /
> email-only flows, which are unchanged.

## What the widget implemented (all from the existing contract)

- **Already-signed-in detection** via `GET /api/auth/me?session={sid}`
  (guards: `x-ms-chat-key` + `x-ms-session`). Run **lazily on first panel open**,
  and only when there's a hint it's worth it: a stored "was signed in on this
  device" flag, or `ShopifyAnalytics.meta.page.customerId` (read as a
  non-authoritative pre-hint only). Pure-anonymous visitors trigger **no** auth
  network call at all — the no-sign-in path stays byte-identical.
- **Sign-in initiation** = top-level redirect to
  `GET /api/auth/shopify/login?session={sid}&return_url={window.location.href}`,
  driven by one button on an in-chat benefits card (no fake login form).
- **Return handling** reads + strips `?ms_auth=` (`ok` → probe `/api/auth/me` and
  show signed-in; `login_required` → show the one-click affordance;
  `logged_out`/`error` → stay anonymous). The **same** conversation re-hydrates
  from the unchanged `session_id` localStorage thread.
- **History** uses `GET /api/account/conversations`, `GET/PATCH/DELETE
  /api/account/conversations/{id}`, and `POST /api/account/erase` exactly as
  documented (fail-closed on 401, honest per-chat vs erase-all wording).
- The session id is **never rotated** while signed in (it is the identity link,
  `CUSTOMER_ACCOUNT.md §1`).

## Decision: prompt=none silent check is intentionally NOT used

The contract allows a silent `prompt=none` redirect to auto-detect an existing
Shopify login, but notes it's a best-effort optimisation with a documented
**one-click fallback**. Because `prompt=none` is still a *full-page* redirect, we
chose the fallback as the default: it would be jarring to bounce the whole
storefront page on first chat open. So the widget relies on `/api/auth/me`
(no redirect) for re-detection and shows a subtle "Anmelden" affordance
otherwise. **No backend change required** — just confirming we deliberately did
not wire `prompt=none`.

## ✅ RESOLVED — multi-conversation under a stable session_id

> **Backend answer (migration 0018):** send a **`conversationKey`** on
> `/api/chat` — a stable, client-generated per-THREAD string. `session_id` stays
> the identity link (unchanged, never rotated); `conversation_key` is the new
> uniqueness key. **"Neue Beratung"** = a fresh `conversationKey` (new history
> row); **resuming** a past thread = send the `conversationKey` now returned by
> `GET /api/account/conversations` (list + transcript). Omitting it defaults to
> `session_id` (legacy one-thread-per-session — your current code keeps working
> untouched). Full rules: `frontend-handoff/API_CONTRACT.md` §2 ("Optional
> `conversationKey`") + `frontend-handoff/CUSTOMER_ACCOUNT.md` §7.6.

<details><summary>Original question (kept for context)</summary>

## ❓ NEEDS CONFIRMATION — multi-conversation under a stable session_id

The widget models the **active conversation as the local `messages` array**, and
relies on the backend to resolve the active thread from `session_id` (per
`API_CONTRACT.md §2`, `/api/chat` is effectively stateless replay of the sent
messages). Because we must not rotate `session_id` while signed in:

- **"Neue Beratung"** clears the local thread but keeps `session_id`.
- **Opening a past conversation** fetches its transcript and loads it into the
  local view; the next `/api/chat` turn sends that transcript under the same
  `session_id`.

Please confirm how the backend distinguishes / persists **separate
conversations for one customer when `session_id` is stable**, so the history
list (`/api/account/conversations`) reflects multiple threads rather than one
ever-growing row. If the intended mechanism is a per-request `conversationId`
(or "start a new conversation" signal) on `/api/chat`, tell us the field and
we'll send it — it is a small additive change on the widget side.

</details>

## ✅ RESOLVED — signed-in logout initiation

> **Backend answer:** the requested route now exists —
> **`GET /api/auth/shopify/logout?session={sid}&return_url={storefront}`** (a
> top-level navigation, mirroring login). It builds the Shopify `end_session`
> redirect server-side from discovery, Shopify ends its session, and
> `/api/auth/shopify/logout/return` drops the server-side tokens and bounces back
> with **`?ms_auth=logged_out`**. If the store advertises no `end_session`
> endpoint it degrades to a local token-drop sign-out (same bounce). Point the
> top-level window at it for a true sign-out. See
> `frontend-handoff/CUSTOMER_ACCOUNT.md` §5.

<details><summary>Original request (kept for context)</summary>

`CUSTOMER_ACCOUNT.md §5` describes logout as the widget sending the top-level
window to **Shopify's `end_session_endpoint`** with a `post_logout_redirect_uri`
of `/api/auth/shopify/logout/return`. The widget has **no way to construct that
Shopify OIDC URL** from the documented contract (it never sees discovery
metadata or tokens). Today the widget therefore does a **local sign-out only**
(hides the signed-in UI on this device; the server session is left to expire).

Requested: a backend-initiated logout route mirroring login, e.g.
`GET /api/auth/shopify/logout?session={sid}&return_url={storefront}` that performs
the `end_session` redirect server-side and bounces back with `?ms_auth=logged_out`.
Then the widget can offer a true sign-out. (Erase — `POST /api/account/erase` —
already works and is wired.)

</details>

## Origins / config

`return_url` is `window.location.href` (a storefront origin), matching the
open-redirect allowlist. The auth/account base URL is the same configurable
`apiBase` the widget already uses (`settings.ai_advisor_backend_url`); no new
theme setting was added.
