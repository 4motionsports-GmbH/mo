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
  `x-ms-chat-key` header on every `/api/chat`, `/api/contact`, and
  `/api/capture-email` request. See the security note in §10.

The widget must NOT carry any consent copy in its config or source — the
capture form's checkbox labels, benefit hint, and imprint/privacy links are
served by the backend (§7).

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
`/api/contact`, `/api/products`, `/api/capture-email`, `/api/kpi`, and
`/api/consent-copy`. (Products, kpi, and consent-copy don't require the
chat key but should still carry the session id for rate-limit keying.)

Conversation state lives **only** in the widget. The backend persists
nothing keyed off the session id for the chat itself — the customer
profile is reconstructed from `messages` on every turn. The one exception
is the email-capture flow (§7 / `API_CONTRACT.md` §7), where a
`session_id` is stored because the user actively submitted their email
with a consent choice. Persisting the message history to `localStorage`
so the panel survives a page navigation is nice-to-have but optional; at
minimum the state must survive within a single page session.

A captured email may be attached as `customer.email` to this session's
subsequent `/api/chat` requests (returning-customer memory) — but only
**in memory**, never persisted to `localStorage`/cookies, and never
auto-attached on a fresh widget open. See `API_CONTRACT.md` §2.

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

### 4.3 Desktop vs mobile (see §8).

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

Quick-checkout action: the `add_to_cart` card renders a primary
**"Jetzt direkt bestellen"** button. For a single product it links to
`product.shopifyCartUrl`; for a multi-product call (`productIds`) it links
to the **top-level `cartUrl`** from the same `/api/products` response (one
permalink, all variants in one cart) — never stitch it together client-side.
Opens in a new tab; it does not call any API. If `cartUrl`/`shopifyCartUrl`
is absent, render no checkout button. Product/showroom links go to
`shopifyUrl` / `https://motionsports.de/pages/showroom-munchen-grobenzell`,
new tab, `rel="noopener noreferrer"`.

---

## 7. Email-capture form (GDPR — consent copy comes from the backend)

When the stream emits an `offer_email_summary` tool part, render the
**email-capture form** exactly per `API_CONTRACT.md` §2
("`offer_email_summary` → email-capture form") and
`BEHAVIOR_REFERENCE.md` §2.6. The load-bearing rules:

- **Never hard-code consent copy.** The tool part's **`output`** carries
  `consentCopy`: the transactional checkbox label, the marketing checkbox
  label, the marketing **benefit hint**, the imprint/privacy URLs, and a
  pre-composed `consentTextShown` audit string. Render those strings
  verbatim. For a capture form shown *without* a tool call (e.g. a
  proactive share entry point), fetch the same payload from
  `GET /api/consent-copy` (`API_CONTRACT.md` §7.4). The served text is
  stored as **Art. 7 proof of consent** — a hard-coded theme copy could
  drift from the audit record, and lawyer copy changes must not require a
  widget release.
- **Two separate checkboxes, never bundled.** The transactional box
  (required to submit) MAY be pre-checked — it's the requested service.
  The marketing box MUST start **unchecked** (never pre-tick; GDPR
  clear-affirmative-act, CJEU *Planet49*), with the benefit hint rendered
  directly beneath its label as one consent block. Prominence is fine;
  a pre-tick never is.
- **Imprint/privacy links** (`consentCopy.imprintUrl` / `privacyUrl`)
  shown next to the form, new tab, `rel="noopener noreferrer"`.
- **Submit** → POST `/api/capture-email` (auth/session headers like
  `/api/chat`) with `{ sessionId, email, transactionalConsent,
  marketingConsent, consentTextShown, trigger }`, where `consentTextShown`
  is the backend-provided `consentCopy.consentTextShown` echoed
  **byte-for-byte** and `trigger` echoes the tool input's `trigger`.
- **Success** → "Wir haben dir die Zusammenfassung geschickt."; when
  `marketing.status === "pending"`, add "Bitte bestätige noch die
  Anmeldung über den Link in der E-Mail." The widget MAY then start
  attaching `customer.email` to this session's `/api/chat` requests
  (in-memory only — §3).
- **Dismissed/declined without submit** → emit one
  `email_capture_declined` event via `POST /api/kpi` with
  `data: { trigger, askNumber? }`. Do NOT emit shown/submitted events —
  those are recorded server-side.

---

## 8. Mobile responsiveness

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

## 9. Error & edge-case handling

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
- **Capture form** errors (`/api/capture-email`, `API_CONTRACT.md` §7.1):
  same inline-error + keep-populated treatment. `400 bad_request` covers
  an invalid email or a missing transactional consent; `502`/`503
  upstream_unavailable` mean the summary send / consent storage failed —
  use the "Senden gerade nicht möglich" hint and let the user retry.

For non-streaming responses, detect errors by `!response.ok` and parse
the JSON envelope to branch on `error.code`. For the chat stream, a
non-200 status returns the JSON envelope (not a stream) — check status
before starting to read the body as a stream.

---

## 10. Security note (must be honored)

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

`GET /api/products`, `GET /api/consent-copy`, and `POST /api/kpi`
deliberately do **not** require the secret (they expose only
storefront-visible fields / public form copy / accept pseudonymous
telemetry), so those calls work even where the key isn't sent.
`POST /api/capture-email` DOES require the secret, like `/api/chat` and
`/api/contact`.

---

## 11. Acceptance checklist

- [ ] Drops into a Shopify theme as a snippet; no build step; works with
      JS-only + CSS-only assets.
- [ ] Launcher + expandable panel; welcome state before first message.
- [ ] Generates/persists `x-ms-session`; sends it + `x-ms-chat-key` on
      the right requests.
- [ ] Streams `/api/chat` over SSE via fetch+reader (not `EventSource`);
      concatenates text, renders the markdown subset safely.
- [ ] Renders all six tool cards per `BEHAVIOR_REFERENCE`, keyed by
      `toolCallId`, with the render-nothing guards; silently consumes
      `search_products` + `update_customer_profile`.
- [ ] Hydrates products via `GET /api/products`; quick-checkout button
      ("Jetzt direkt bestellen") links to `shopifyCartUrl` (single) /
      top-level `cartUrl` (multi), and is hidden when absent.
- [ ] Inline contact form posts to `/api/contact`; success + error +
      retry states.
- [ ] Email-capture form renders **backend-served** consent copy only (tool
      `output.consentCopy` / `GET /api/consent-copy`) — no hard-coded
      consent strings anywhere in the theme; marketing checkbox starts
      unchecked; imprint/privacy links shown; `consentTextShown` echoed
      verbatim to `/api/capture-email`; `email_capture_declined` emitted
      on dismissal.
- [ ] Mobile full-screen behavior; safe-area aware; horizontal-scroll
      comparison table.
- [ ] Handles 429 (Retry-After), 401/403 (config), 400 payload_too_large
      (start-new-chat), 5xx + network errors — all without throwing.
- [ ] Secret only ever shipped to the allowlisted storefront origin;
      no false-auth claims; relies on backend origin allowlist + rate
      limit.
