# Widget spec — motionsports.de Shopify chat widget

The deliverable: a **floating chat widget** for the motionsports.de
Shopify storefront. It talks to the headless chat backend documented in
`API_CONTRACT.md` and renders exactly the behavior documented in
`BEHAVIOR_REFERENCE.md`.

You do **not** have the backend repo. Everything you need about the wire
protocol is in `API_CONTRACT.md`; everything you need about rendering is
in `BEHAVIOR_REFERENCE.md`. This file specifies the *shipping form* of
the widget and the requirements it must meet.

---

## 1. Form factor & constraints

- **A Shopify theme snippet.** Ship a single Liquid snippet (e.g.
  `snippets/ms-chat-widget.liquid`) that the theme includes near the end
  of `theme.liquid` (before `</body>`). It contains the widget's markup
  root, its CSS, and its JS — or links to asset files (see below).
- **Vanilla JS + CSS. No framework, no build step.** No React, no Vue, no
  bundler, no npm. Plain ES modules / a single IIFE script and hand-written
  CSS. It must run by dropping the snippet into a theme — nothing to
  compile.
- **Self-contained & isolated.** The widget must not collide with theme
  styles. Scope every selector under a single root (e.g. `.ms-chat`
  prefix on all classes) — or, preferably, render inside a **Shadow DOM**
  root so storefront CSS can't leak in and the widget CSS can't leak out.
  All injected DOM lives under one container element appended to
  `<body>`.
- **Asset layout** (recommended): keep CSS and JS in
  `assets/ms-chat-widget.css` and `assets/ms-chat-widget.js`, and have
  the snippet `{{ 'ms-chat-widget.css' | asset_url | stylesheet_tag }}` /
  `<script src="{{ 'ms-chat-widget.js' | asset_url }}" defer>`. The only
  thing that *must* live in the Liquid snippet itself is the injected
  config (§3). Inlining everything in the snippet is acceptable too.
- **No external runtime dependencies.** No CDN libraries. The SSE parsing,
  markdown subset, and DOM building are all hand-rolled. (The icons in the
  old UI came from `lucide-react`; reproduce them as small inline SVGs or
  a lightweight unicode/emoji fallback.)

---

## 2. Configuration injected via Liquid

The snippet reads settings from Liquid and hands them to the JS. At
minimum:

```liquid
<script>
  window.MS_CHAT_CONFIG = {
    apiBase: "https://chat.motionsports.de",
    chatKey: {{ settings.ms_chat_shared_secret | json }},
    // optional overrides:
    allowedFromTheme: true
  };
</script>
```

- `apiBase` — the backend origin (`https://chat.motionsports.de`).
- `chatKey` — the shared secret, read from a **theme/app setting**
  (`settings.ms_chat_shared_secret`, configured in `settings_schema.json`
  so a non-developer can paste it in the theme editor). This becomes the
  `x-ms-chat-key` header on every `/api/chat` and `/api/contact` request.
  See the security note in §9.

The JS must fail gracefully (log a warning, not throw, don't render the
launcher) if `chatKey` is empty.

---

## 3. Session id

On first interaction, generate and persist a stable session id, exactly
as in `API_CONTRACT.md` §5:

```js
let sid = localStorage.getItem("ms-chat-sid");
if (!sid) { sid = crypto.randomUUID(); localStorage.setItem("ms-chat-sid", sid); }
```

Send it as the `x-ms-session` header on **every** request to `/api/chat`,
`/api/contact`, and `/api/products`. (Products doesn't require the chat
key but should still carry the session id for rate-limit keying.)

Conversation state lives **only** in the widget (the backend persists
nothing). Persisting the message history to `localStorage` so the panel
survives a page navigation is nice-to-have but optional; at minimum the
state must survive within a single page session.

---

## 4. UI structure & states

### 4.1 Launcher button

- A floating circular button, fixed to a bottom corner (bottom-right by
  default), above storefront content (high `z-index`, but below modals if
  the theme has any). Brand-red accent (`#dc2626`), a chat/message icon.
- Clicking it toggles the panel open/closed. When open, the launcher may
  swap to a close (×) icon.

### 4.2 Expandable panel

- An anchored panel that expands from the launcher: a header, a scrollable
  message area, and an input row — i.e. the same three-part chat layout
  the old full-page UI had, shrunk into a panel.
- **Header**: the "**motion**sports" wordmark (accent) + a close button.
- **Message area**: shows the **welcome state** (`BEHAVIOR_REFERENCE` §4)
  until the first message, then the message list with text bubbles and
  tool cards interleaved in arrival order.
- **Input row**: growing textarea, Enter-to-send (Shift+Enter = newline),
  send button, the `"KI-Fitnessberater – Antworten können Fehler
  enthalten"` disclaimer. Input disabled while a response streams.
- **Typing indicator**: three-dot bounce in an assistant bubble while
  submitted but no visible assistant content yet.

### 4.3 Desktop vs mobile (see §7).

---

## 5. Chat flow (SSE consumption of `/api/chat`)

For each user send:

1. Append the user message to local state and render it.
2. POST to `${apiBase}/api/chat` with:
   - headers: `Content-Type: application/json`, `x-ms-chat-key: <chatKey>`,
     `x-ms-session: <sid>`.
   - body: `{ messages: UIMessage[] }` — the **entire** conversation so
     far (the backend reconstructs the customer profile from full history
     each turn; see `API_CONTRACT.md` §2). Each message is
     `{ id, role, parts: [{ type: "text", text }] }`.
3. Read the response as a **stream** and parse the AI SDK UI-message
   stream (SSE). Use `fetch` + `response.body.getReader()` +
   `TextDecoder`, buffering by lines and parsing each `data:` JSON event
   into a *part*. (Do **not** use `EventSource` — it can't send custom
   headers or a POST body.)
4. Maintain a "current assistant message" and apply each incoming part:
   - text part → append `text` to the assistant bubble (re-render the
     markdown subset, `BEHAVIOR_REFERENCE` §3).
   - tool part → dispatch per `BEHAVIOR_REFERENCE` §2, keyed by
     `toolCallId` (update in place, render only once `input` exists, skip
     the two silent tools).
5. On stream end, finalize the assistant message and re-enable input.

Treat malformed/partial JSON lines defensively (buffer until a full line
arrives; ignore keep-alive/empty lines).

---

## 6. Product hydration & tool cards

Tool cards reference products by id only; the widget hydrates them from
`GET ${apiBase}/api/products` (`API_CONTRACT.md` §3):

- `show_product`, `add_to_cart` → `?id=<id>` (single).
- `compare_products`, `suggest_showroom`, `show_contact_form` (when
  `productIds` present) → `?ids=a,b,c`.
- Cap **10 ids/request**; unknown ids come back as `null` at their index
  — render partial results, never abort.
- Response is cacheable (60s); a small in-memory cache keyed by id avoids
  refetching the same product within a session.
- Render each card exactly per `BEHAVIOR_REFERENCE` §2, including the
  "render nothing" guards (missing product → no card; compare needs ≥2;
  showroom needs ≥1). Remember the comparison table **omits**
  dimensions/weight/target-group rows (not in the public response).

Cart action: the `add_to_cart` button is a **link to
`product.shopifyCartUrl`** opening in a new tab — it does not call any
API. Product/showroom links go to `shopifyUrl` /
`https://motionsports.de/pages/showroom-munchen-grobenzell`, new tab,
`rel="noopener noreferrer"`.

---

## 7. Mobile responsiveness

- On narrow viewports (≈ ≤ 640px) the panel goes **full-screen** (or
  near-full: full width, full height minus a small top inset), instead of
  a small floating card. The close button stays reachable.
- The launcher stays out of the way of Shopify's own sticky elements
  (cart drawer, mobile nav). Respect safe-area insets
  (`env(safe-area-inset-*)`) so it isn't hidden behind the iOS home bar.
- Tap targets ≥ 44px; the input must not be obscured by the mobile
  keyboard (let the panel scroll / use `dvh` units).
- The comparison table scrolls horizontally inside the panel rather than
  overflowing it.

---

## 8. Error & edge-case handling

The backend uses a stable error envelope
(`{ "error": { "code, message } }`); handle these gracefully:

- **429 `rate_limited`** (chat bucket 20/60s, products 60/60s). Read the
  `Retry-After` header (seconds), **disable the input** for that long,
  and show the hint *"Zu viele Anfragen — bitte kurz warten."* Re-enable
  when the window passes.
- **401 `unauthorized`** — wrong/missing `x-ms-chat-key`. This is a
  **misconfiguration** (the theme setting is wrong), not a user error.
  Show a generic *"Chat ist gerade nicht verfügbar."* to the shopper and
  `console.error` the real cause for the operator. Don't retry in a loop.
- **403 `forbidden`** — origin not allowlisted. Same treatment as 401
  (config/deploy issue): generic unavailable message + console error.
- **400 `payload_too_large`** on `/api/chat` — the 40-message cap was
  hit. Surface a **"start a new chat"** affordance: a message explaining
  the chat got long, and a button that clears the local conversation
  (and may rotate the session id) so the user can continue fresh.
- **400 `bad_request`** — shouldn't happen with correct payloads; show
  the generic unavailable message and log.
- **5xx / `upstream_unavailable` / `internal_error`** and **network
  errors / fetch rejection / aborted stream** — show a friendly
  *"Es gab ein Problem. Bitte versuch es gleich nochmal."* in the message
  area, re-enable input so the user can retry. Don't lose what the user
  typed.
- **Contact form** errors (`/api/contact`, `API_CONTRACT.md` §4): show
  the inline error, keep the form populated for retry; on `502
  upstream_unavailable` use *"Senden gerade nicht möglich — bitte später
  erneut versuchen."*

For non-streaming responses, detect errors by `!response.ok` and parse
the JSON envelope to branch on `error.code`. For the chat stream, a
non-200 status returns the JSON envelope (not a stream) — check status
before starting to read the body as a stream.

---

## 9. Security note (must be honored)

The `x-ms-chat-key` shared secret is injected into the storefront via
Liquid and is therefore **visible to anyone who views the page source or
network traffic**. This is **expected and acceptable** for a public
storefront widget — but only because the backend pairs the secret with
two other controls that are already implemented server-side
(`API_CONTRACT.md` §1):

- an **origin allowlist** (requests are only honored from
  `https://www.motionsports.de` / `https://motionsports.de`), and
- **rate limiting** (sliding window keyed by `x-ms-session`/IP), plus
  hard spend caps.

So the secret is **not** an authentication boundary; it's one factor that
— combined with the origin check and rate limit — forces an abuser to
forge the Origin **and** know the key **and** distribute across IPs.
**The widget MUST therefore be deployed only on the allowlisted
storefront origin, and the shared secret MUST never be presented as
real auth.** Do not add client-side "hiding" of the key (obfuscation
gives false assurance); rely on the documented server-side controls. If
the storefront origin ever changes, the backend's `ALLOWED_ORIGINS` must
be updated in lockstep or the widget will get `403 forbidden`.

`GET /api/products` deliberately does **not** require the secret (it
exposes only storefront-visible fields), so product hydration works even
where the key isn't sent.

---

## 10. Acceptance checklist

- [ ] Drops into a Shopify theme as a snippet; no build step; works with
      JS-only + CSS-only assets.
- [ ] Launcher + expandable panel; welcome state before first message.
- [ ] Generates/persists `x-ms-session`; sends it + `x-ms-chat-key` on
      the right requests.
- [ ] Streams `/api/chat` over SSE via fetch+reader (not `EventSource`);
      concatenates text, renders the markdown subset safely.
- [ ] Renders all five tool cards per `BEHAVIOR_REFERENCE`, keyed by
      `toolCallId`, with the render-nothing guards; silently consumes
      `search_products` + `update_customer_profile`.
- [ ] Hydrates products via `GET /api/products`; cart button links to
      `shopifyCartUrl`.
- [ ] Inline contact form posts to `/api/contact`; success + error +
      retry states.
- [ ] Mobile full-screen behavior; safe-area aware; horizontal-scroll
      comparison table.
- [ ] Handles 429 (Retry-After), 401/403 (config), 400 payload_too_large
      (start-new-chat), 5xx + network errors — all without throwing.
- [ ] Secret only ever shipped to the allowlisted storefront origin;
      no false-auth claims; relies on backend origin allowlist + rate
      limit.
