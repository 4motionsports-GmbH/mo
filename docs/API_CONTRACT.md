# motion sports chat backend — API contract

This document is the single source of truth for the Shopify widget that
calls this backend. If anything here disagrees with the code, the code
wins — open an issue and we'll fix one or the other so they match.

## 1. Overview

**Base URL (production):** `https://mo.motionsports.de`

Endpoints:

| Method | Path                      | Purpose                                                  |
| ------ | ------------------------- | -------------------------------------------------------- |
| POST   | `/api/chat`               | Streaming Claude chat with persona-aware tools.          |
| POST   | `/api/tts`                | Text-to-speech for voice mode (streams MP3 audio). §8.   |
| POST   | `/api/contact`            | Contact-form submission → email via Resend.              |
| GET    | `/api/products`           | Public product hydration for widget cards.               |
| POST   | `/api/kpi`                | Pseudonymous telemetry ingestion (fire-and-forget).      |
| POST   | `/api/feedback`           | Customer feedback capture (free text + optional context). §9. |
| POST   | `/api/capture-email`      | GDPR email capture + double opt-in (summary + marketing).|
| POST   | `/api/chat-marketing-opt-in` | Chat consent gate: marketing-only opt-in, typed email (DOI). §7.6. |
| GET    | `/api/consent-copy`       | Canonical copy (capture form / `?surface=signin` / `?surface=chat` / `?surface=erase`). §7.4. |
| GET    | `/api/confirm-marketing`  | Marketing double-opt-in confirmation link (HTML page).   |
| GET    | `/api/unsubscribe`        | Signed unsubscribe link → suppression (HTML page).        |
| GET/POST | `/api/erase-data`       | Mail-footer "Daten löschen" link: confirmation page (GET), erasure (POST). HTML. §11.1. |
| GET    | `/api/r/{token}`          | Tracked mail link → 302 to cart / shop / Mo deep link. §11.2. |
| GET    | `/api/auth/shopify/login` | Customer Account sign-in (top-level redirect). |
| GET    | `/api/auth/shopify/callback` | OAuth callback (server-side PKCE exchange); returns `?ms_auth=ok&ms_code=…`. |
| POST   | `/api/auth/link`          | Completes a sign-in: redeems the one-time code (`ms_code` / whoami `linkCode`) for this `x-ms-session`. Required since 2026-10-03. |
| GET    | `/api/auth/me`            | Signed-in identity re-hydration (`{ name, tier, marketing }`). |
| GET    | `/api/auth/storefront`    | Shop-native already-signed-in detection via Shopify App Proxy (HMAC-signed, fresh within 5 minutes). |
| GET    | `/api/auth/shopify/logout/return` | Logout-return landing. |
| GET    | `/api/account/conversations` | Signed-in: LIST past conversations (tier 3). |
| GET/PATCH/DELETE | `/api/account/conversations/{id}` | Signed-in: fetch / rename / delete one conversation. |
| GET    | `/api/account/summary`    | Signed-in: download a thread's S5 summary as a **PDF**. |
| POST   | `/api/account/marketing-opt-in` | Signed-in: at-sign-in marketing opt-in (DOI). |
| POST   | `/api/account/erase`      | Signed-in: full "delete my data" (erase customer; also reaches Shopify, §11.1). |
| GET    | `/api/account/export`     | Signed-in: JSON data export (Art. 15/20) as a download. |
| POST   | `/api/webhooks/shopify`   | Shopify → backend only (never the widget). HMAC-verified. §11.3. |

> **Customer Account sign-in (tier 3)** is documented in full in
> [`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) (frontend contract:
> `docs/frontend-handoff/CUSTOMER_ACCOUNT.md`). The `login` / `callback` /
> `logout/return` routes are top-level navigations (signed `state`, no
> CORS/secret); `/api/auth/me` and `/api/auth/link` are guarded widget XHRs.
> **A sign-in links the session only when the widget redeems its one-time code**
> (`POST /api/auth/link { code }` with its own `x-ms-session`; the code comes as
> `?ms_code=` on the `?ms_auth=ok` return, or as `linkCode` in the App Proxy
> whoami response; 10 minutes, single use, minted for exactly the session that
> started the sign-in). Before 2026-10-03 the callback and whoami linked the
> session id from their URL directly — a stranger could plant their own session
> id in a link a logged-in shopper opened. A widget that does not redeem stays
> signed out (fail closed). Details: `frontend-handoff/CUSTOMER_ACCOUNT.md` §2a. The **signed-in
> conversation-history** endpoints (`/api/account/*`) are guarded widget XHRs
> behind the CA-1 signed-in resolver (fail-closed for anonymous / email-only) —
> see `CUSTOMER_ACCOUNT.md` §9. `/api/account/summary` (the **"Zusammenfassung
> herunterladen"** download — a **PDF** rendered from the same summary-email
> assembler), `/api/auth/storefront` (**shop-native** detection via an App Proxy;
> see `CUSTOMER_ACCOUNT.md` §2),
> `/api/account/marketing-opt-in` (the **at-sign-in opt-in**), and the
> **tier-3 suppression contract** (`/api/auth/me`'s `tier` gates off the
> end-of-chat capture widget for tier 3; `marketing.optInActionable` gates the
> at-sign-in card) are documented in `CUSTOMER_ACCOUNT.md` §10–§11.

> `/api/confirm-marketing`, `/api/unsubscribe`, `/api/erase-data` and
> `/api/r/{token}` are **clicked from emails** as top-level browser
> navigations — they return an HTML page or a redirect, not JSON, and have
> **no** CORS allowlist or shared-secret guard (a mail client sends no `Origin`
> and no custom header). They're protected by unguessable / signed tokens
> instead. The widget never calls them directly. `/api/webhooks/shopify` is
> server-to-server (Shopify signs every delivery, §11.3).

### Security model

A defense-in-depth combination, since the widget runs on a public
storefront:

- **Origin allowlist.** Cross-origin requests are accepted only from
  origins in `ALLOWED_ORIGINS` (default: `https://www.motionsports.de`,
  `https://motionsports.de`). The CORS preflight (`OPTIONS`) reflects
  the same allowlist.
- **Shared secret** (`x-ms-chat-key`). Required on `/api/chat`,
  `/api/tts` (§8), `/api/contact`, and `/api/capture-email` (§7.1). *Honest caveat:* this secret is shipped to the
  storefront widget, so anyone can read it from the browser. The
  point isn't strong auth — it's combining it with the origin
  allowlist and rate limit so that a scraper has to forge the origin
  AND know the secret AND distribute IPs to abuse the endpoint.
  `/api/products` does NOT require the secret; it exposes only fields
  already visible on the storefront.
- **Rate limiting.** Upstash sliding-window limiter, keyed by
  `x-ms-session` (or IP fallback). Chat bucket: **20 req / 60 s**.
  Products bucket: **60 req / 60 s**. TTS bucket: **20 req / 5 min**
  (its own bucket — each call is a billed synthesis of up to 2000
  characters, so a longer window with a tighter effective rate; §8).
- **Spend caps.** Hard monthly caps on Anthropic + OpenAI; the chat
  conversation is hard-capped at 40 messages per session.

### Error envelope

Every non-streaming error response uses the same shape:

```json
{ "error": { "code": "rate_limited", "message": "Too many requests" } }
```

Codes the widget should handle: `bad_request`, `unauthorized`,
`forbidden`, `rate_limited`, `payload_too_large`,
`upstream_unavailable`, `internal_error`, and (on
`/api/capture-email` only) `transactional_consent_required` (§7.1).
Codes are stable and don't leak internals — the message is a
user-safe German or English string.

---

## 2. `POST /api/chat`

Streams a Claude response over SSE as AI SDK **stream chunks** (the AI
SDK UI-message stream protocol, `x-vercel-ai-ui-message-stream: v1`).

### Required request headers

| Header          | Value                                                                  |
| --------------- | ---------------------------------------------------------------------- |
| `Content-Type`  | `application/json`                                                     |
| `x-ms-chat-key` | The shared secret from `CHAT_SHARED_SECRET`.                           |
| `x-ms-session`  | Client-generated stable session id (UUID stored in `localStorage`).    |

> **Note on `x-ms-session`:** the widget must always send it, but the
> server does **not** enforce its presence — a request without it is not
> rejected. When present it keys the rate-limit bucket (`sid:<id>`) and
> the conversation persistence that the summary email / consent flow
> depend on; when absent, rate limiting falls back to the caller's IP
> and conversation persistence is skipped. "Required" here is a widget
> instruction, not a server-side guard.

Plus the browser-set `Origin` header, which must be one of
`ALLOWED_ORIGINS`. The CORS preflight advertises `POST, OPTIONS` and
`Content-Type, x-ms-chat-key, x-ms-session, x-ms-locale` in
`Access-Control-Allow-Headers`.

### Request body

```jsonc
{
  "messages": [
    {
      "id": "msg-1",
      "role": "user",
      "parts": [
        { "type": "text", "text": "Ich suche ein leises Laufband für die Wohnung, Budget ca. 1500 €." }
      ]
    }
  ]
}
```

`messages` is the standard AI SDK `UIMessage[]`. The route walks the
full history on every turn (the customer profile is a pure function of
the messages, reconstructed by replaying `update_customer_profile` tool
calls), so the widget must send the entire conversation each turn.

#### Optional `conversationKey` — multiple threads under one stable `session_id`

`session_id` is the identity link (must not rotate while signed in), so it is no
longer the *thread* key. The widget MAY send a **`conversationKey`** (a stable,
client-generated per-thread string, ≤ 200 chars) to address WHICH conversation a
turn belongs to (migration 0018):

- **New chat / "Neue Beratung"** → a **fresh** key (new conversation row / history
  entry); **continuing** → the **same** key; **resuming a past thread** → the
  `conversationKey` returned by `GET /api/account/conversations`.
- **Omitted** → defaults to `session_id` server-side (legacy one-thread-per-
  session; fully backward-compatible).
- Distinct from the numeric `conversationId` used by `/api/account/
  conversations/{id}`. Same trust/entropy expectation as `session_id`. See the
  frontend handoff for the full widget flow.

#### Optional `context` — opening the chat "about" a product and/or with a browsing trail

When the widget is opened from a specific product page (e.g. a "Frage zu
diesem Produkt"/"Beratung" button on a product detail page) and/or with a
small in-browser browsing trail (recently viewed products/categories), it
MAY attach an optional `context` object alongside `messages`:

```jsonc
{
  "messages": [],
  "context": {
    "type": "product",                          // or "browsing" — see below
    "productId": "atx-treadmill-pro-fold",      // type "product" only
    "productTitle": "ATX Treadmill Pro Fold",   // optional, advisory only
    "recentlyViewed": [                          // optional on BOTH types
      { "type": "product",  "id": "horizon-fitness-omega-z-laufband", "name": "Omega Z Laufband" },
      { "type": "product",  "id": "horizon-fitness-paragon-x-laufband", "name": "Paragon X" },
      { "type": "category", "id": "laufbaender", "name": "Laufbänder" }
    ]
  }
}
```

| Field            | Type     | Notes                                                              |
| ---------------- | -------- | ----------------------------------------------------------------- |
| `type`           | string   | `"product"` (single-product open, may also carry a trail) or `"browsing"` (trail only). Any other value → whole context ignored. |
| `productId`      | string   | Catalog product id (`type: "product"` only). Validated server-side. |
| `productTitle`   | string?  | Optional/advisory. The backend uses the catalog's canonical name. |
| `recentlyViewed` | array?   | Small browsing trail, most recent first. Entries: `{ type: "product", id, name }` or `{ type: "category", id?, name }`. |

**Privacy.** The browsing trail is gathered **in the browser** and only ever
reaches the backend as part of a chat request the **user initiates** (opening
the chat / sending a message) — it is conversation input, not background
tracking. Like the single-product context, it shapes the live conversation
and is never stored as a tracking profile. Don't send it on every turn:
attach it when the chat is opened (or with the first message, e.g. a starter
prompt) and when it meaningfully changed — not as a per-turn heartbeat.

**Validation & caps.** Everything is validated against the live catalog and
**ignored gracefully** on mismatch (no error; the request behaves as if that
part of the context was never sent):

- `productId` must be a known catalog product (unchanged from before).
- Trail **products** are validated by `id`; unknown ids are dropped and the
  catalog's canonical name wins over the client-supplied `name`.
- Trail **categories** are matched by `name` against the catalog (tolerant of
  German storefront labels, e.g. "Laufbänder" matches the treadmill range);
  labels that don't correspond to anything in the catalog are dropped. The
  category `id` (e.g. a collection handle) is accepted but currently advisory.
- The trail is capped server-side at the **3 most recent valid products and
  2 categories** (at most the first 20 entries are even scanned), so send a
  short, most-recent-first list — there is no point sending more.

The backend keys its behavior off whether `messages` is empty:

- **Fresh open (`messages: []` + valid `context`).** The backend seeds the
  model with a system-level note and the assistant produces a **natural,
  context-aware greeting as its first streamed message**:
  - With a product context — unchanged: greet by the product's name and
    invite questions.
  - With (only) a browsing trail — greet by helpfully picking up the single
    most relevant item/category ("Du hast dir ein paar Laufbänder angeschaut
    — soll ich beim Vergleich helfen?"). The prompt explicitly forbids
    creepy phrasing: the assistant talks about the products/categories,
    never about the observing, and never recites the whole trail.
  - With **both**, the product-page greeting wins and the trail becomes
    background knowledge for the consultation.

  The widget does NOT need to send a user message to trigger this — it sends
  `messages: []` and renders the streamed assistant greeting like any other
  turn. No fake user message is fabricated in the history.

  A fresh open whose context does not survive validation (or that carries no
  `context` at all) is NOT an error: the backend still streams a generic
  greeting, consistent with the ignored-gracefully rule above.

- **Existing conversation (`messages` non-empty + valid `context`).** The
  backend injects lightweight in-conversation notes (product pivot and/or
  browsing note) so the assistant can **pivot toward the context without
  wiping the existing history**. The conversation continues normally; the
  widget keeps sending the full `messages` array each turn as usual.

  This is also the path a **context-seeded starter prompt** takes: sending a
  starter like "Ist das gut für Zuhause?" as the first user message together
  with the `context` makes the answer specific to that product/trail — the
  backend grounds the context products in the model's pre-retrieved product
  block (specs + stock status), so sold-out and checkout rules apply from the
  first answer.

In both cases the **response is the same SSE chunk stream** documented
below — `context` only seeds the model, it does not change the response
shape. The widget parses the stream identically whether or not `context`
was sent.

#### Optional `customer` — returning-customer memory after in-session re-identification

After a **successful `POST /api/capture-email` in the current chat session**
(§7.1), the widget MAY attach the captured email to every subsequent
`/api/chat` request of that session:

```jsonc
{
  "messages": [ /* full history as usual */ ],
  "customer": { "email": "max@example.de" }
}
```

When that email matches an **existing customer with history** (prior linked
conversations, a generated "current understanding" summary, and/or purchases —
Mo's copy of the person's Shopify orders, else the cached purchase history),
the backend injects a compact memory block into the system
prompt so the assistant can consult like someone who remembers a returning
client — acknowledge the return lightly, skip products they already own,
tailor to their known profile. The response shape is unchanged; memory only
seeds the model.

**Privacy gate (the rules the widget MUST follow).** A returning customer
opens a new chat as **anonymous** — we do not know who they are until they
give their email in *this* conversation. Therefore:

- Attach `customer.email` **only after** `/api/capture-email` succeeded **in
  the current chat session**, and keep that state **in memory only**. Never
  persist it to `localStorage`/cookies and never auto-attach it on a fresh
  widget open — a shared/family/public browser must not surface another
  person's history.
- The backend enforces this independently: it injects memory only when the
  email's consent record was verifiably captured **from the same
  `x-ms-session`** as the chat request. A forged or replayed `customer.email`
  resolves to no memory — **ignored gracefully**, exactly like an invalid
  `context` (no error).
- A **new email** (no existing customer history) also resolves to no memory:
  the request behaves exactly as if `customer` was never sent.
- The session id alone never unlocks memory; the match is strictly by the
  email the user just provided in this session.

#### Optional `campaignToken` — a chat opened from a campaign mail („Chat-Start“, additive 2026-10)

A click on the Mo button of a campaign e-mail goes through the tracked
redirect (§11.2), which lands on the storefront's Mo deep link with the send's
token appended as **`mo_c=<token>`**. The widget MAY send that value back:

```jsonc
{
  "messages": [ /* first turn of the session the link opened */ ],
  "campaignToken": "Hk3f9QWm2xVbT0aLr7c1sYpNeD5uZ8gJ"   // the `mo_c` query value, verbatim
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `campaignToken` | string? | The `mo_c` value from the landing URL. Read it **before** the theme strips the `mo*` parameters and send it with the **first** `/api/chat` request of the session that link opened; sending it again on later turns is harmless. |

- **Server side:** the value is trimmed and must match
  `/^[A-Za-z0-9_-]{16,64}$/` (real tokens are 32 base64url characters); it
  is looked up among the campaign sends and recorded **once per send** as a
  session-less KPI event (`campaign_chat_started`, `data: { sendId,
  campaignId }`; a unique index enforces "once", migration 0075). A test
  send („Prüfen & testen“) is recorded too, with `data.test: true`, so the
  operator can check the link end to end; the KPI funnels count real sends
  only. The chat's `x-ms-session` is never stored with it, so the
  pseudonymous chat is not tied to the recipient.
- **Ignored gracefully:** a missing, malformed, unknown or already-recorded
  token changes nothing — **no error**, no different response. The recording is best-effort (it runs alongside the turn's other
  lookups and never fails the stream); the response shape is unchanged.
- Only campaign mails whose button leads to Mo carry `mo_c`; a shop-button
  campaign redirects to the shop without it.

**40-message cap.** If `messages.length > 40` the route returns:

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json
```
```json
{
  "error": {
    "code": "payload_too_large",
    "message": "Conversation too long (max 40 messages). Please start a new chat."
  }
}
```

The widget should surface this as "start a new chat" UX.

### Response — SSE stream

The route returns the result of
`result.toUIMessageStreamResponse(...)`. Headers:

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
x-vercel-ai-ui-message-stream: v1
Cache-Control: no-cache, no-transform
X-Accel-Buffering: no
Access-Control-Allow-Origin: https://www.motionsports.de
```

`Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` keep
caches and nginx-style proxies from buffering or re-chunking the stream;
`x-vercel-ai-ui-message-stream: v1` identifies the stream protocol
version and is a useful client-side sanity check.

The body is SSE: lines of `data: <JSON>`, separated by blank lines,
terminated by a literal `data: [DONE]`. Parse with `fetch` +
`response.body.getReader()` + `TextDecoder`, buffering by line (do
**not** use `EventSource` — it can't send a POST body or custom
headers).

**Each `data:` line is a JSON-encoded AI SDK *stream chunk*** (the
`UIMessageChunk` vocabulary of the pinned `ai@6`), **not** an assembled
UI-message part. Assembled parts (`{ "type": "text", … }`,
`{ "type": "tool-<name>", "state": …, … }`) are what `@ai-sdk/react`'s
`useChat` builds *client-side out of* these chunks — they never appear
on the wire. A widget that parses the stream itself must assemble the
chunks into the current assistant message (or use the AI SDK's
client-side assembly).

A complete turn (one text bubble + one `show_product` call) looks like:

```
data: {"type":"start"}
data: {"type":"start-step"}
data: {"type":"text-start","id":"t1"}
data: {"type":"text-delta","id":"t1","delta":"Hallo "}
data: {"type":"text-delta","id":"t1","delta":"Welt."}
data: {"type":"text-end","id":"t1"}
data: {"type":"tool-input-available","toolCallId":"call_1","toolName":"show_product","input":{"productId":"abc","reason":"leise"}}
data: {"type":"tool-output-available","toolCallId":"call_1","output":{"ok":true}}
data: {"type":"finish-step"}
data: {"type":"finish"}
data: [DONE]
```

#### Chunk vocabulary

| `type` | Payload fields | Widget action |
| --- | --- | --- |
| `start` | — | begin a new assistant message |
| `start-step` / `finish-step` | — | ignore (the model can run up to **6 steps** per turn, +1 when the backend appends the guaranteed checkout-moment email-offer step) |
| `text-start` | `id` | open a text part keyed by `id` |
| `text-delta` | `id`, `delta` | **append** `delta` to that text part's bubble |
| `text-end` | `id` | text part complete |
| `tool-input-start` | `toolCallId`, `toolName` | open a tool part keyed by `toolCallId` (render nothing yet) |
| `tool-input-delta` | `toolCallId`, `inputTextDelta` | streaming JSON of the args; safe to ignore |
| `tool-input-available` | `toolCallId`, `toolName`, `input` | args complete → **render the card now** (dispatch on `toolName`, read `input`) |
| `tool-output-available` | `toolCallId`, `output` | tool result → for `offer_email_summary` this carries the load-bearing `output.consentCopy`; `search_products` and `get_order_status` return data for the model only (ignore it — see "Tools the widget MUST NOT render"); the other tools return `{ ok: true }` |
| `error` | `errorText` | show the friendly retry message |
| `finish` | — | finalize the message, re-enable input |
| `[DONE]` (literal, not JSON) | — | stream end |

Assembly rules:

- `toolName` is the **bare** tool name (`show_product`), never
  `tool-show_product` and never a suffixed variant. If you assemble
  AI-SDK-style parts client-side, the part type becomes
  `tool-${toolName}` and its `state` progresses
  `input-streaming → input-available → output-available` (an erroring
  tool yields `output-error`). There is no `"partial"` or `"result"`
  state and no `tool-<name>-partial` / `tool-<name>-result` type.
- Key tool cards by `toolCallId` and update **in place**: render the
  card once `tool-input-available` delivers `input`, and merge the
  later `tool-output-available` into the same card. A duplicated or
  re-emitted chunk for a known `toolCallId` must replace, never append
  a second card.
- Ignore unknown chunk types (e.g. `reasoning-*`, `tool-output-error`)
  defensively — the vocabulary can grow with SDK upgrades.
- **A tool part whose `toolName` the widget does not know → render
  nothing** (no card, no placeholder, no error), and consume its chunks
  silently. New background tools are added this way without a widget
  release (additive rule, 2026-10).
- The route's `maxDuration` is 300 s — a long consultation can stream
  for minutes; don't impose a short client-side timeout.

#### Rendering assistant text

Concatenate the `text-delta` chunks of each text part (keyed by `id`)
into the visible assistant bubble.

**Markdown subset to render:** bold (`**text**`) → `<strong>` and
inline links (`[label](url)`) → `<a href="url" target="_blank"
rel="noopener noreferrer">`. Nothing else (no headings, no code
blocks, no lists). This mirrors what the previous React widget
rendered with `renderTextWithFormatting`. The regex used there:

```js
/(\*\*(.+?)\*\*)|(\[([^\]]+)\]\(([^)]+)\))/g
```

#### Tools the widget MUST render

Dispatch on the `toolName` of each `tool-input-available` chunk and
render the matching card from its `input`, keyed by `toolCallId`. The
renderable tools, in order of arrival likelihood:

##### `show_product` → product card

Input schema:
```ts
{ productId: string; reason?: string }
```
Example `tool-input-available` chunk:
```json
{
  "type": "tool-input-available",
  "toolCallId": "call_abc123",
  "toolName": "show_product",
  "input": {
    "productId": "atx-treadmill-pro-fold",
    "reason": "Sehr leise (62 dB) und klappbar — passt in eine Mietwohnung."
  }
}
```
Widget action: call `GET /api/products?id=atx-treadmill-pro-fold`, then
render a card with image, name, price (use `salePrice` if set),
`shortDescription`, the first 4 `specifications` entries,
`deliveryTime`, and a "Zum Produkt" link to `shopifyUrl`. Show
`reason` as an italic note below the price.

##### `compare_products` → comparison table

Input schema:
```ts
{ productIds: string[]; comparisonContext?: string } // 2–3 ids
```
Example `tool-input-available` chunk:
```json
{
  "type": "tool-input-available",
  "toolCallId": "call_def456",
  "toolName": "compare_products",
  "input": {
    "productIds": ["atx-treadmill-pro-fold", "atx-treadmill-silent-x"],
    "comparisonContext": "Beide leise, aber unterschiedliche Laufflächen."
  }
}
```
Widget action: `GET /api/products?ids=a,b`, render a table with image
+ name as column headers and rows for price, key spec rows, and
`deliveryTime`. Show `comparisonContext` as a caption above the table.

##### `add_to_cart` → direct-checkout CTA (single **or** multi-product)

> Tool id stays `add_to_cart` for backwards-compat, but it now drives a
> **direct checkout** and can cover **one or several** products in a single
> cart. The model emits **one** `add_to_cart` call per buying decision.

Input schema (**either** `productId` **or** `productIds`, at least one required):
```ts
{ productId?: string; productIds?: string[]; message: string }
```

- **Single product** — the model sets `productId` (unchanged from before).
- **Multiple products** — when the shopper clearly wants several items together
  ("beides nehme ich", "das Rack UND die Hantelbank"), the model sets
  `productIds` with **all** intended ids and calls the tool **once**. This is
  one combined cart, not several separate buttons.

Single-product example chunk (backward compatible):
```json
{
  "type": "tool-input-available",
  "toolCallId": "call_ghi789",
  "toolName": "add_to_cart",
  "input": {
    "productId": "atx-treadmill-pro-fold",
    "message": "Wenn das für dich passt, kannst du es hier direkt bestellen."
  }
}
```

Multi-product example chunk:
```json
{
  "type": "tool-input-available",
  "toolCallId": "call_ghi790",
  "toolName": "add_to_cart",
  "input": {
    "productIds": ["atx-rack-pro", "atx-bench-pro"],
    "message": "Wenn die Kombi für dich passt, kannst du beides hier direkt bestellen."
  }
}
```

**Widget action — WHAT CHANGED FOR THE FRONTEND:**

1. **Normalise the input to an id list:** `const ids = input.productIds ?? [input.productId!]`.
   (Old code that only reads `input.productId` keeps working for single-product
   calls, but should be updated to handle `productIds` for the multi case.)
2. **Hydrate:** `GET /api/products?ids=<id1>,<id2>,…` (the existing multi-id
   form — up to 10 ids). Render **one** quick-checkout card listing every
   resolved product (name / price / thumbnail), with `message` as the header.
3. **Checkout button:** link it to the **top-level** `cartUrl` from that same
   `/api/products` response — a single permalink that puts **all** variants in
   **one** cart (`…/cart/<v1>:1,<v2>:1`). Do **not** stitch this together from
   the per-product `shopifyCartUrl` values; use the server-built `cartUrl`.
   Open with `target="_blank" rel="noopener noreferrer"`.
4. **Degrade gracefully:** if `cartUrl` is `null` (no variant resolved), hide
   the checkout button (or fall back to listing the products' `shopifyUrl`
   links). Unknown ids come back as `null` entries in `products` — skip them.

The button sends the shopper **directly to checkout** (one unit per line), not
into a cart they must then manage.

##### `suggest_showroom` → showroom suggestion

Input schema:
```ts
{ productIds: string[] }
```
Example `tool-input-available` chunk:
```json
{
  "type": "tool-input-available",
  "toolCallId": "call_jkl012",
  "toolName": "suggest_showroom",
  "input": { "productIds": ["atx-treadmill-pro-fold"] }
}
```
Widget action: `GET /api/products?ids=…`, render a showroom card
listing the product names and linking to
`https://motionsports.de/pages/showroom-munchen-grobenzell`.

##### `show_contact_form` → inline contact form

Input schema:
```ts
{
  reason: "studio_consultation" | "public_sector_quote" | "physio_consultation"
        | "bulk_discount" | "leasing" | "maintenance" | "order_support"
        | "general";
  message: string;
  productIds?: string[];
}
```
Example `tool-input-available` chunk:
```json
{
  "type": "tool-input-available",
  "toolCallId": "call_mno345",
  "toolName": "show_contact_form",
  "input": {
    "reason": "studio_consultation",
    "message": "Für die Studio-Ausstattung lohnt sich ein persönliches Gespräch.",
    "productIds": ["atx-rack-pro", "atx-bench-pro"]
  }
}
```
Widget action: render the in-widget contact form with the reason
pre-selected, message displayed as a header, and (if `productIds` is
present) `GET /api/products?ids=…` so the form can show which products
are being asked about. Submission POSTs to `/api/contact` (section 4
below).

##### `offer_email_summary` → email-capture form

> Not emitted for a signed-in (tier-3) session since 2026-10-05 (CA §6.0); the
> widget's own tier-3 suppression stays (stored parts from before a sign-in).

The assistant calls this at a **value-triggered** moment — after the user
reacted well to a recommendation, after a helpful comparison, when the user
wants to think it over, or at clear buying/checkout intent — never as the first
message and never on a fixed timer. It is offered **at most twice per
conversation**: if the user declines or ignores it, the assistant backs off and
may raise it once more at a later, clearly higher-value moment (typically
checkout intent). The widget turns the tool call into the **GDPR email-capture
form** (see §7).

Input schema:
```ts
{
  message: string;
  // The value moment that triggered this ask (also used for KPI measurement):
  trigger: "recommendation_accepted" | "comparison_delivered" |
           "consideration_pause" | "buying_intent" | "checkout_intent";
  productIds?: string[];   // advisory only
}
```
**The tool RESULT carries the canonical consent copy.** Unlike the other
renderable tools, this call's `tool-output-available` chunk is load-bearing:
its `output.consentCopy` contains the exact checkbox labels, the shared
consent footer, the imprint/privacy links, the copy `version`, the
returning-customer hint, and the pre-composed `consentTextShown` audit
string. The widget **MUST render these backend-served strings and MUST NOT
hard-code any consent copy** — the served text is stored verbatim as Art. 7
proof of consent, so a hard-coded theme snapshot could silently diverge from
the audit record. Lawyer copy changes ship as a backend deploy with no widget
release. (For capture forms not triggered by this tool, the same payload is
available via `GET /api/consent-copy` — §7.4.)

> ⚠️ **Payload change with consent copy v2:** `marketingBenefitHint` was
> **removed** (the v2 marketing label carries the benefit itself); new fields
> are `version`, `consentFooter` and `returningHint`. And **both checkboxes
> now start UNCHECKED** — the v1 allowance to pre-check the transactional box
> is revoked (see below).

Example chunk pair (the `tool-input-available` chunk, followed by the
`tool-output-available` chunk for the same `toolCallId`):
```json
{
  "type": "tool-input-available",
  "toolCallId": "call_pqr678",
  "toolName": "offer_email_summary",
  "input": {
    "message": "Soll ich dir deine persönliche Empfehlung und den fertigen Warenkorb per Mail schicken?",
    "trigger": "recommendation_accepted",
    "productIds": ["atx-treadmill-pro-fold"]
  }
}
```
```json
{
  "type": "tool-output-available",
  "toolCallId": "call_pqr678",
  "output": {
    "ok": true,
    "consentCopy": {
      "version": "v3",
      "transactionalLabel": "Ja, schickt mir meine Beratungs-Zusammenfassung per E-Mail (inkl. Direkt-Link zur Kasse).",
      "marketingLabel": "Ja, ich möchte exklusive Angebote und Aktionen erhalten — nur für Abonnenten. Jederzeit abbestellbar.",
      "consentFooter": "Verarbeitung durch motion sports gemäß Datenschutzerklärung; Widerruf jederzeit möglich.",
      "consentTextShown": "Ja, schickt mir … | Ja, ich möchte exklusive Angebote … | Verarbeitung durch motion sports …",
      "imprintUrl": "https://motionsports.de/pages/impressum",
      "privacyUrl": "https://motionsports.de/policies/privacy-policy",
      "lawyerApproved": true,
      "returningHint": {
        "enabled": true,
        "text": "Schon einmal von Mo beraten worden? Gib deine E-Mail an — Mo erkennt dich wieder und knüpft an deine letzte Beratung an."
      }
    }
  }
}
```
Widget action: render `message` as the intro, then the capture form with:

- an **email** input, with the **returning-customer hint**
  (`output.consentCopy.returningHint.text`) rendered near it **when
  `returningHint.enabled` is `true`** (hide it entirely when `false` — it is
  a server-side switch). The hint is informational UI copy, NOT part of the
  consent block and NOT part of `consentTextShown`.
- a **transactional** consent checkbox (required to submit) — label from
  `output.consentCopy.transactionalLabel`. **v2 change: this box MUST start
  UNCHECKED** (the earlier allowance to pre-check it is revoked) — the user
  actively ticks it to request the summary. A submit without it is rejected
  by the backend with `400 transactional_consent_required` (§7.1); the
  widget SHOULD disable the submit button (or show an inline hint) until the
  box is ticked.
- a **separate** marketing consent checkbox — label from
  `output.consentCopy.marketingLabel`. **This box MUST start UNCHECKED —
  never pre-check it.** Pre-ticked marketing consent is invalid (GDPR
  clear-affirmative-act; CJEU *Planet49*) and a German UWG Abmahnung trigger;
  this is a deliberate, documented decision (see `src/lib/consent-copy.ts`).
  The widget SHOULD make the box **prominent** (placement, styling) — opt-ins
  are won through the copy, not a pre-tick. Marketing is optional and never
  bundled with the transactional box.
- the **shared footer line** `output.consentCopy.consentFooter` rendered
  beneath both checkboxes, with the **imprint + privacy links** next to it,
  targeting `output.consentCopy.imprintUrl` / `output.consentCopy.privacyUrl`
  (`target="_blank" rel="noopener noreferrer"`).

On submit, POST to `/api/capture-email` (§7) with the two booleans, the
backend-provided `output.consentCopy.consentTextShown` echoed back
**verbatim** (never recomposed or hard-coded by the widget — it must be
byte-for-byte the strings that were served and displayed), and the tool
call's `trigger` echoed back (telemetry-only — lets the opt-in funnel be
split by trigger moment). The marketing box MUST be visually independent of
the transactional one — never one combined checkbox. `productIds` is advisory
(cart preview); the backend determines the real products server-side from the
conversation.

If the user dismisses or declines the capture card without submitting, the
widget should emit one `email_capture_declined` event via `POST /api/kpi`
(see §5) with `data: { trigger, askNumber? }` — the backend cannot observe a
dismissal itself. Do NOT emit "shown"/"submitted" events from the widget;
those are recorded server-side.

> ✅ The checkbox labels are lawyer-approved copy (`lawyerApproved: true`) — see
> [`CONSENT_FLOW.md`](./CONSENT_FLOW.md).

#### Tools the widget MUST NOT render

These are background tools — skip their chunks when `toolName` matches:

- `update_customer_profile` — updates the persona view; pure
  bookkeeping.
- `search_products` — internal RAG; the assistant uses the
  result to decide which `show_product` / `compare_products` calls to
  make. Its `tool-output-available` chunk streams the search result
  (`{ totalMatched, products: [...] }`) — ignore it.
- `get_order_status` (2026-10, behind `CHAT_ORDER_STATUS_ENABLED`, default
  off) — the signed-in customer's order status, for the model to answer
  „Wo ist meine Bestellung?“ in its text. Input
  `{ orderRef?: string; topic: "status" | "shipping" | "return" |
  "cancellation" | "refund" }`; its `tool-output-available` chunk carries
  `{ status, matched?, orders: [...], ordersPageUrl }` (order date, items and
  states — no order numbers, amounts or tracking numbers). Render nothing:
  no card, and never show or store the output outside the conversation
  history the widget already keeps. The answer the customer reads is the
  assistant text. On a shared device the stored history can contain it —
  see [`frontend-handoff/CHAT_ORDER_STATUS.md`](./frontend-handoff/CHAT_ORDER_STATUS.md)
  (clear the stored history on logout).

These tools still appear in the stream (the full
`tool-input-start → … → tool-output-available` chunk sequence) and the
widget must consume them without rendering anything. The same holds for
any tool name the widget does not know (see the assembly rules above).
The backend never trusts a replayed `get_order_status` output: when the
history is sent back, its output is replaced by `{ replayed: true }`
before it reaches the model.

### Rate-limit response (429)

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 32
Content-Type: application/json
```
```json
{ "error": { "code": "rate_limited", "message": "Too many requests" } }
```

The widget should disable the input for the indicated seconds and show
a "zu viele Anfragen — bitte kurz warten" hint.

### Auth / origin errors

| Status | Code           | When                                                  |
| ------ | -------------- | ----------------------------------------------------- |
| 401    | `unauthorized` | Missing or wrong `x-ms-chat-key`.                     |
| 403    | `forbidden`    | Cross-origin request from an origin not in allowlist. |
| 400    | `bad_request`  | Body isn't valid JSON / `messages` not an array.      |
| 500    | `internal_error` | Anything else.                                      |

---

## 3. `GET /api/products`

Hydrates product cards by id. No auth required, only an allowlisted
origin.

### Request

```
GET /api/products?ids=atx-treadmill-pro-fold,atx-treadmill-silent-x
GET /api/products?id=atx-treadmill-pro-fold&id=atx-treadmill-silent-x
```

Both forms are equivalent. Whitespace around ids is trimmed; duplicates
within a request are de-duplicated while preserving order.

- **Cap: 10 ids per request.** Over the cap → `400 payload_too_large`.
- **No ids at all** → `400 bad_request`.

### Response

```json
{
  "products": [
    {
      "id": "150-kg-atx®-gym-bumper-plates-vorteilspaket",
      "name": "150 kg ATX® Gym Bumper Plates - Vorteilspaket",
      "slug": "150-kg-atx®-gym-bumper-plates-vorteilspaket",
      "brand": "ATX®",
      "category": "Weight Plates",
      "series": null,
      "price": 512,
      "salePrice": 484,
      "currency": "EUR",
      "shortDescription": "Das 150 kg ATX® Gym Bumper Plates - Vorteilspaket ist ein günstiges und dennoch sehr robustes Gewichtsscheiben Set...",
      "features": ["2 Stück a 25 kg", "REACH zertifiziert", "…"],
      "specifications": { "Material": "gummi; edelstahl", "Farbe": "schwarz-150; weiss" },
      "tags": [],
      "images": [
        "https://cdn.shopify.com/s/files/1/0823/4896/6217/files/vp150-50-atx-gb_02.jpg?v=1715860325"
      ],
      "shopifyUrl": "https://motionsports.de/products/150-kg-atx®-gym-bumper-plates-vorteilspaket",
      "shopifyCartUrl": "https://motionsports.de/cart/40123456789:1",
      "inStock": true,
      "deliveryTime": "Nach Verfügbarkeit"
    },
    null
  ],
  "cartUrl": "https://motionsports.de/cart/40123456789:1,40987654321:1"
}
```

TypeScript-style shape (one entry per requested id, in request order;
`null` for unknown ids):

```ts
type PublicProduct = {
  id: string;
  name: string;
  slug: string;
  brand: string;
  category: string;
  series?: string;
  price: number;
  salePrice?: number;
  currency: "EUR";
  shortDescription: string;
  features: string[];
  specifications: Record<string, string | number>;
  tags: string[];
  images: string[];
  shopifyUrl: string;
  shopifyCartUrl?: string; // optional — see note below
  // Stock status, refreshed by the daily catalog sync (NOT a live per-request
  // check — see docs/CATALOG_SYNC.md). `inStock` is the headline flag: render a
  // subtle "Ausverkauft" badge on the card when it is `false`. The two optional
  // fields carry richer signals when the sync captured them:
  //   inventoryQuantity   — units in stock across variants/locations
  //   anyVariantAvailable — whether any variant is currently sellable
  inStock: boolean;
  inventoryQuantity?: number;
  anyVariantAvailable?: boolean;
  deliveryTime: string;
  // Public PDP facts captured by the catalog sync (all optional — omitted when
  // the shop has no data for the product):
  //   sku         — article number of the first variant (e.g. "MS-ATX-MPX-780-B")
  //   rating      — average customer review rating (reviews app), e.g. 4.7
  //   ratingCount — number of customer reviews behind `rating`
  //   qa          — published, team-answered customer Q&A pairs (same list the
  //                 PDP Q&A tab renders from the custom.qa metafield)
  sku?: string;
  rating?: number;
  ratingCount?: number;
  qa?: Array<{ question: string; answer: string }>;
};

type ProductsResponse = {
  products: (PublicProduct | null)[];
  // Combined prefilled-cart permalink covering ALL requested resolvable
  // variants in ONE cart (`…/cart/<v1>:1,<v2>:1`). Use this for the
  // multi-product `add_to_cart` checkout button. Sold-out products are
  // excluded — they can never enter this checkout link. `null` when no
  // requested id resolves to an in-stock variant. For a single requested id it
  // equals that product's own `shopifyCartUrl`. Never carries a discount
  // (marketing-only).
  cartUrl: string | null;
};
```

Unknown ids return as `null` at the matching index — never a 404 — so
the widget can render partial results without aborting.

### Product variants (additive)

`PublicProduct` additionally carries the product's sellable variants:

```ts
variants?: Array<{
  id: string | null;        // numeric Shopify variant id
  title: string;            // "16 kg" — empty for single-variant products
  sku?: string;
  price: number;
  salePrice?: number;
  available: boolean;       // per-variant availability (sync-fresh)
  cartUrl?: string;         // /cart/<id>:1 — omitted when unavailable
  isDefault: boolean;
}>;
selectedVariantId?: string; // set when the request pinned a variant
priceMin?: number;          // effective price range across variants
priceMax?: number;
```

Requested ids may be **variant refs** of the form `handle~<numericVariantId>`
(the `~` separator is URL-safe). For a ref, the returned entry's flat fields
(`name`, `price`, `salePrice`, `shopifyCartUrl`, `inStock`, `sku`) describe
the CHOSEN variant, `selectedVariantId` is set, and the combined `cartUrl`
uses that variant. A ref whose variant does not exist returns `null` (like an
unknown id — never a silent fallback to the default variant). All variant
fields are additive: widgets that ignore them behave exactly as before, with
the flat fields describing the default variant. A widget MAY render its own
variant selector from `variants[]` and deep-link the PDP via
`shopifyUrl + "?variant=<id>"`.


The top-level **`cartUrl`** is new: it is the one-click checkout link for a
**multi-product** `add_to_cart` (and works for the single-product case too).
It is built server-side from the resolvable numeric variant ids, so the widget
never has to assemble a multi-variant permalink itself.

`shopifyCartUrl` is a Shopify storefront cart permalink for **one** unit of
the product's variant, of the form `https://motionsports.de/cart/<numericVariantId>:1`
(the equivalent `…/cart/add?id=<numericVariantId>` form also works). The `id`
is always the **numeric** Shopify variant id — never the SKU, handle, or
product id; a SKU-based URL 404s with "Cannot find variant". The field is
**optional**: it is omitted when a product has no resolvable numeric variant
id, **or when the product is sold out** (`inStock: false`), so the widget
should hide the quick-checkout button (or fall back to `shopifyUrl`) rather
than render a broken or sold-out checkout link.

**Stock status & checkout guarantee.** `inStock` reflects the latest daily
catalog sync (sync-fresh, not a live availability check). A sold-out product
is **never** offered a checkout link: its `shopifyCartUrl` is omitted, and it
is excluded from the combined top-level `cartUrl` (so a sold-out item can never
enter a checkout action even when bundled with in-stock products). The
`null`/sold-out entries still carry full product data and `inStock: false`, so
the widget can render the card with a subtle "Ausverkauft" badge.

Response is cacheable for 60 s
(`Cache-Control: public, max-age=60, stale-while-revalidate=300`).

### Rate-limit response (429)

Same shape as `/api/chat`. Bucket: 60 req / 60 s per session/IP.

---

## 4. `POST /api/contact`

JSON contact-form submission. Forwards to Resend; falls back to a
stdout log when Resend env vars are unset. Since 2026-10-02 the request is
also stored in Mo (the sender's Korrespondenz and an Eingang item, best
effort) before the team mail — the request and response shapes are
unchanged.

### Required request headers

Same as `/api/chat`:

| Header          | Value                                                                |
| --------------- | -------------------------------------------------------------------- |
| `Content-Type`  | `application/json`                                                   |
| `x-ms-chat-key` | Shared secret.                                                       |
| `x-ms-session`  | Stable session id (UUID).                                            |

### Request body

```jsonc
{
  "reason": "studio_consultation",
  "productIds": ["atx-rack-pro", "atx-bench-pro"],   // optional
  "name": "Max Müller",
  "email": "max@example.de",
  "organization": "Fitstudio München GmbH",          // optional
  "phone": "+49 89 1234567",                         // optional
  "message": "Wir planen ein neues Studio mit ca. 200 m² Krafttraining...",
  "sessionId": "b3c1…"                               // optional, pseudonymous
}
```

- `reason` must be one of: `studio_consultation`, `public_sector_quote`,
  `physio_consultation`, `bulk_discount`, `leasing`, `maintenance`,
  `order_support`, `general`. Anything else is accepted but rendered
  verbatim in the email subject; the KPI event records it as `other`.
- `email` is validated with `^[^@\s]+@[^@\s]+\.[^@\s]+$`.
- `name` and `message` must be non-empty after trimming.
- `sessionId` (optional) keys the pseudonymous `contact_form_submitted`
  KPI event (§5) so submissions can be compared against `show_contact_form`
  tool-fires. Without it the `x-ms-session` header is used (widgets before
  2026-10-04 b). It is telemetry-only — never stored alongside the submitted
  contact details.

### Success response

```http
HTTP/1.1 200 OK
Content-Type: application/json
```
```json
{ "ok": true }
```

### Error responses

| Status | Code                   | When                                                                 |
| ------ | ---------------------- | -------------------------------------------------------------------- |
| 400    | `bad_request`          | Invalid JSON, or required field missing/invalid.                     |
| 401    | `unauthorized`         | Missing / wrong shared secret.                                       |
| 403    | `forbidden`            | Cross-origin request from an origin not in allowlist.                |
| 429    | `rate_limited`         | Shares the chat bucket (20 req / 60 s).                              |
| 502    | `upstream_unavailable` | Resend returned an error or threw.                                   |
| 500    | `internal_error`       | Anything else.                                                       |

---

## 5. `POST /api/kpi`

Pseudonymous telemetry ingestion — the endpoint the widget's fail-silent
`track()` calls. Fire-and-forget: the widget does not need to read the
response or retry.

### Required request headers

| Header          | Value                                              |
| --------------- | -------------------------------------------------- |
| `Content-Type`  | `application/json`                                 |
| `x-ms-session`  | Stable session id (UUID). Used for rate limiting.  |

No `x-ms-chat-key` — like `/api/products`, this endpoint is origin-allowlisted
only. It accepts only pseudonymous data and stores no email.

### Request body

```jsonc
{
  "event": "product_card_click",          // required, ≤120 chars
  "sessionId": "b3c1…",                    // optional, pseudonymous
  "timestamp": 1733212800000,              // optional, client clock (number or ISO string)
  "data": { "productId": "atx-rack-pro" }  // optional, arbitrary object
}
```

- `event` is the only hard requirement (non-empty string, ≤120 chars).
- `data` must be a plain object if present (arrays/primitives are dropped).
  The client `timestamp` is preserved inside the stored payload; the server's
  own `created_at` is authoritative.

### Email-capture funnel events (canonical names)

The value-triggered email capture is measured through this pseudonymous,
session-keyed funnel (names in `src/lib/kpi-events.ts`; no email address ever
appears in an event). Most are emitted **server-side** — the widget must not
duplicate them:

| Event                                | Emitted by | `data`                                  |
| ------------------------------------ | ---------- | --------------------------------------- |
| `email_capture_ask_shown`            | server (`/api/chat`) | `{ trigger, askNumber }` — one per `offer_email_summary` call. |
| `email_capture_submitted`            | server (`/api/capture-email`) | `{ marketingConsent, trigger? }` |
| `email_capture_marketing_opted_in`   | server (`/api/capture-email`) | `{ doiStatus, trigger? }` — the separate marketing box was ticked. |
| `email_capture_marketing_confirmed`  | server (`/api/confirm-marketing`) | `{}` — unique DOI confirmations only. |
| `email_capture_declined`             | **widget** (this endpoint) | `{ trigger, askNumber? }` — capture card dismissed/declined without submit. |

`trigger` is the value moment from the `offer_email_summary` tool call
(`recommendation_accepted`, `comparison_delivered`, `consideration_pause`,
`buying_intent`, `checkout_intent`), so opt-in rates can be compared per
trigger moment and per ask number. Captures via the chat consent gate
(§7.6) ride in the same funnel with `trigger: "chat_gate"`; the at-sign-in
opt-in with `trigger: "signin_optin"`.

### Sign-in popup events (widget 2026-10-01)

After an anonymous visitor's first answered message (once per browser session,
never in voice mode) the widget asks them to sign in. **Widget-emitted**, names
in `src/lib/kpi-widget-events.mjs`; the endpoint accepts them as they are (it
has no event allowlist and does not validate `data`):

| Event                       | `data`                    | When |
| --------------------------- | ------------------------- | ---- |
| `login_gate_shown`          | `{}`                      | The popup was shown. |
| `login_gate_signin_clicked` | `{}`                      | „Anmelden“ — the redirect follows once the reply has finished streaming. |
| `login_gate_declined`       | `{}`                      | „Später“ — snoozed for 24 h on the device. |
| `login_gate_dismissed`      | `{}`                      | Closed with Esc or a backdrop click (no snooze). |
| `account_signin_started`    | `{ source?: "login_gate" }` | Any sign-in start; `source` only when it came from the popup. |
| `account_signin_return`     | `{ result: "ok" \| … }`   | The widget saw the return from the sign-in (widget truth). |

The KPI tab's „Anmelde-Popup“ funnel counts **sessions** and joins them, in
the same session after the click, to the server events
`account_signin_succeeded` (Shopify) and `account_signin_linked` (the chat
redeemed the one-time code — the sign-in that counts). So the `sessionId` of
these events must be the session the login used (`login?session=`).

### Consent-gate events (canonical names, v4)

The marketing consent ask for **signed-in** customers (since the widget of
2026-10-01 a popup after sign-in, plus the inline card after a mid-conversation
sign-in) is measured through four **widget-emitted** events (names in
`src/lib/kpi-events.ts`; the backend only observes the accept as an opt-in
POST). Each carries `data: { surface: "signin" | "chat" }` — the widget sends
only `signin` since 2026-10-01; `chat` was the anonymous e-mail gate, replaced by
the sign-in popup (its endpoints stay, unused by the widget):

| Event                    | When                                                        |
| ------------------------ | ----------------------------------------------------------- |
| `consent_gate_shown`     | The gate/card was rendered (once per session per surface).  |
| `consent_gate_accepted`  | The explicit "Ja, Angebote aktivieren" tap.                 |
| `consent_gate_declined`  | The explicit decline tap.                                   |
| `consent_gate_dismissed` | The gate was closed without an explicit accept/decline.     |

They feed the Consent-Gate funnel on the admin KPI tab
(`getConsentGateFunnel`, `src/lib/kpi-store.ts`).

> ⚠️ **Retired:** the widget no longer sends `starter_shown` /
> `starter_clicked` (starter prompts removed, 2026-10-01). The endpoint (which
> accepts any event name) doesn't reject them; the raw event breakdown marks them
> „eingestellt“ and nothing alerts on the drop.

### Server-emitted lifecycle events (canonical names)

These land in the same `kpi_events` stream but are emitted **exclusively
server-side** (names in `src/lib/kpi-events.ts`) — the widget must never send
them. Since 2026-10-04 `POST /api/kpi` answers `202` to any of these names
but **does not store** them (`SERVER_ONLY_EVENTS` in
`src/lib/kpi-widget-events.mjs`), so a misbehaving widget or a forged call
cannot double-count or fake a funnel stage:

| Event                      | Emitted by | `data` |
| -------------------------- | ---------- | ------ |
| `marketing_email_clicked`  | `GET /api/r/<token>` (marketing send) | `{ sendId, captureId, firstClick }`, session `NULL` |
| `campaign_email_clicked`   | `GET /api/r/<token>` (campaign send, migration 0041) | `{ sendId, firstClick }`, session `NULL` |
| `campaign_chat_started`    | `POST /api/chat` with a valid `campaignToken` (§2) — once per campaign send (unique index, 0075) | `{ sendId, campaignId }`, plus `test: true` for a test send; session `NULL` (the widget sends the token, never this event) |
| `bundle_offer_clicked`     | `GET /api/r/<token>` (bundle offer) | `{ offerId, status, expired }`, session `NULL` |
| `contact_form_submitted`   | `POST /api/contact` (accepted submissions) | `{ reason, productCount }` — `reason` one of the §4 reasons, else `other`; never the name/email/message. Session-keyed: the payload's `sessionId`, else the `x-ms-session` header. |
| `account_signin_succeeded` | `GET /api/auth/shopify/callback` (success) | `{ silent }` — `prompt=none` re-detects flagged. Session-keyed (the session of `login?session=`). Since 0073 this alone does not sign the chat in. |
| `account_shop_recognised`  | `GET /api/auth/storefront` (App Proxy whoami: signed, fresh, Shopify vouches for a logged-in customer; 2026-10-05) | `{ proof, hasToken, alreadySignedIn, codeIssued, noCode? }` — `proof` `token` \| `shop` \| `none`; `hasToken` = the customer has a chat (Customer Account) token; `alreadySignedIn` = the session was already signed in as this customer; `noCode` (only when `codeIssued` is false) `flag_off` \| `no_proof` \| `handover` \| `failed`. Session-keyed; never a customer id, name, e-mail, the code or the URL. |
| `account_signin_linked`    | `POST /api/auth/link` (code redeemed) | `{ kind, renewed }` — `kind` `customer_account` \| `app_proxy`; `renewed` (2026-10-05) = the session was already signed in as the same customer (a new tab confirming it, not a new sign-in). Session-keyed. The sign-in now counts for the chat. |
| `account_signin_link_refused` | `POST /api/auth/link` (400) | `{ reason, kind? }` — `reason` `invalid` (expired, used, unknown) \| `session_mismatch` (another session's code); `kind` (2026-10-05) = the code's link kind when the code is known. Session-keyed. A 503 (database not reachable) records nothing. |
| `account_export_requested` | `GET /api/account/export` | `{}`, session `NULL` (pure volume counter) |
| `account_erased`           | `POST /api/account/erase` | `{}`, session `NULL` (pure volume counter) |
| `order_status_lookup`      | `POST /api/chat` — one per `get_order_status` call (2026-10, `CHAT_ORDER_STATUS_ENABLED`) | `{ outcome, topic, source, orders }` — `outcome` `ok` \| `no_orders` \| `not_found` \| `sign_in_required` \| `unavailable` \| `disabled` \| `ledger_off` \| `ledger_incomplete` (first order import not finished) \| `ledger_behind` (a live read found an order the ledger lacks); `topic` as the tool input; `source` `ledger` \| `ledger+live`; `orders` = number of orders in the answer. Never an order number, amount or id. Session-keyed. |
| `mo_order_marker_unresolved` | `POST /api/webhooks/shopify` — `orders/create` only, after the delivery was recorded (a Shopify retry or the `orders/paid` delivery of the same order does not count again; 2026-10-05) | `{ reason, source? }` — `reason` `unknown_token` (token not in the table: purged, erased, forged) \| `outside_window`; `source` only for `outside_window`, one of `widget` \| `summary_email` \| `marketing_email` \| `bundle`. Session `NULL`; never an order id, token or amount. Caveat: a duplicate `orders/create` subscription delivers each order with its own webhook id and counts it twice. |

They feed the Kampagnen-Funnel, Bundle and Kundenkonto/Self-Service sections
of the admin KPI tab (see `ADMIN_DASHBOARD.md` §5.9/§5.10/§5.15);
`order_status_lookup` feeds „Bestellstatus im Chat“ (§5.15a);
`mo_order_marker_unresolved` feeds „Mo-zugeordneter Umsatz“ (§5.16, „ohne
Zuordnung“); the sign-in events also feed the per-session diagnosis of the
Anmelde-Popup section (§5.7a); `account_shop_recognised` feeds the
„Shop-Login-Erkennung (App Proxy)“ block of §5.15.

### Success response

```http
HTTP/1.1 202 Accepted
```
```json
{ "ok": true }
```

Returns `202` even when no database is configured or the write fails —
telemetry is best-effort and must never make `track()` care.

### Error responses

| Status | Code             | When                                            |
| ------ | ---------------- | ----------------------------------------------- |
| 400    | `bad_request`    | Invalid JSON, or `event` missing/too long.      |
| 403    | `forbidden`      | Cross-origin from an origin not in allowlist.   |
| 429    | `rate_limited`   | Dedicated `kpi` bucket (120 req / 60 s).        |
| 500    | `internal_error` | Unexpected server error (not a DB write fail).  |

---

## 6. Session lifecycle

The widget must generate a stable per-browser session id and send it as
`x-ms-session` on every chat / contact / products request:

```js
let sid = localStorage.getItem("ms-chat-sid");
if (!sid) {
  sid = crypto.randomUUID();
  localStorage.setItem("ms-chat-sid", sid);
}
```

Why it matters:

- **Rate limiting** is keyed off the session id when present
  (`sid:<uuid>`), falling back to the IP otherwise. A stable id keeps
  one customer's bursts isolated from another's, but also means an
  abusive client can't rotate to a fresh bucket by reloading.
- **40-message cap** is scoped per session — the widget should clear
  the conversation history (and optionally rotate the session id) when
  it surfaces the "start a new chat" UX after a `payload_too_large`
  response.

The backend does NOT persist anything keyed off the session id for the
chat. (The email-capture flow in §7 is the one place a `session_id` is
stored — and only because the user actively submitted their email with a
consent choice.)

---

## 7. Email capture + double opt-in (GDPR)

This is the only flow that handles an email address. The capture form
collects two **separate** consents — transactional (the summary) and
marketing — and a marketing opt-in on a Mo surface requires a **double
opt-in**. The full legal rationale, the data model, and the sign-off status
are in [`CONSENT_FLOW.md`](./CONSENT_FLOW.md). The checkbox/email copy is
lawyer-approved (`lawyerApproved: true`, `src/lib/consent-copy.ts`).

**One marketing consent, shared with Shopify.** The marketing consent is one
state per person (`customers.email_consent_state`), shared with the shop's own
newsletter consent in both directions (`CONSENT_FLOW.md` "The one consent").
What that means for the widget — all additive, no field changed:

- An opt-in on a Mo surface (§7.1, §7.6, `/api/account/marketing-opt-in`)
  stays `pending` until the DOI link is clicked; nothing goes to Shopify
  before that.
- An address that **already holds the consent** — subscribed in Shopify or
  through an earlier Mo DOI — and is **not on the suppression list** gets **no
  second DOI mail**. The opt-in
  endpoints then answer `marketing.status: "confirmed"`,
  `alreadyConfirmed: true`, `doiEmailSent: false`. The tap itself is still
  stored as Art. 7 evidence (`email_captures`). Treat it like any
  `confirmed` answer: no "bitte bestätigen" hint.
- The DOI click and the unsubscribe link are reported to Shopify (§7.2,
  §7.3), so both sides stay in step.
- A `pending` opt-in whose DOI link was never clicked falls back to „no
  consent“ one day after the link expired (`MARKETING_DOI_EXPIRY_DAYS` + 1,
  nightly, local only). The surfaces may then ask again — e.g.
  `/api/auth/me` reports `marketing.status: "none"` and
  `optInActionable: true` for a signed-in customer with a real address.

### 7.1 `POST /api/capture-email`

Triggered when the user submits the capture form rendered from the
`offer_email_summary` tool call.

#### Required request headers

Same as `/api/chat` (origin allowlist + `x-ms-chat-key` + `x-ms-session`).

#### Request body

```jsonc
{
  "sessionId": "b3c1…",            // optional; falls back to the x-ms-session header
  "email": "max@example.de",
  "transactionalConsent": true,    // required to be true; box starts UNCHECKED in the UI (v2)
  "marketingConsent": false,       // separate, MUST default unchecked in the UI (never pre-ticked)
  "consentTextShown": "Ja, schickt mir … | Ja, ich möchte exklusive Angebote … | Verarbeitung durch motion sports …",  // backend-served audit string, echoed verbatim
  "trigger": "recommendation_accepted"  // optional; echo of the offer's trigger (telemetry only)
}
```

- `email` is validated with `^[^@\s]+@[^@\s]+\.[^@\s]+$` and normalised
  (trim + lower-case) server-side.
- `transactionalConsent` **must** be `true` — you can't email a summary
  without consent to email the summary, and with copy v2 the box starts
  unchecked, so the user must have actively ticked it. `false`/missing →
  **`400` with code `transactional_consent_required`** (dedicated, stable
  code so the widget can show a targeted "bitte Häkchen setzen" hint instead
  of a generic error).
- `marketingConsent` is independent. When `true` (and the address isn't
  suppressed), the backend sets `marketing_doi_status='pending'`, issues a DOI
  token, and sends the confirmation email. **No marketing** is sent until the
  user clicks that link. Exception: the address already holds the one
  consent (Shopify or an earlier DOI) → no token, no DOI mail, response
  `confirmed` (§7 intro).
- `consentTextShown` is stored verbatim as Art. 7 proof. It MUST be the
  **backend-provided** `consentCopy.consentTextShown` string (from the
  `offer_email_summary` tool result or `GET /api/consent-copy`, §7.4) echoed
  back **byte-for-byte** — the widget never composes or hard-codes this text.
  Because the form renders exactly those served strings, the audit record
  cannot diverge from what was displayed. The backend additionally stores a
  **consent copy version stamp** (`consent_copy_version`, e.g. `"v3"`)
  alongside the text — resolved **server-side**: stamped only when the echoed
  string is byte-identical to the currently-served canonical copy, `NULL`
  otherwise (the widget does not send a version field).
- `trigger` is silently **truncated to 40 characters** server-side before it
  is stored/echoed (all five canonical trigger values fit well within that).

#### Behaviour

1. Upserts one consent record per email (records `consentTextShown`).
2. **Transactional:** sends the summary email immediately (German summary of the
   conversation + a prefilled-cart permalink, **no discount**).

   **Which products end up in that cart — selected vs discussed.** The backend
   tracks two product sets per conversation:

   - **Selected** — products the user expressed intent to **buy**: the ids of
     the latest `add_to_cart` (direct-checkout) tool call. Updated by
     replacement, so switching to an alternative drops the rejected product.
   - **Discussed** — every product any tool call referenced (`show_product`,
     `compare_products`, …), including compared-and-rejected alternatives.

   The cart permalink uses the **selected** set when the user made a clear
   choice, and falls back to the full **discussed** set only when no selection
   was made. Sold-out products are always excluded from the cart link
   regardless of set. The same rule drives the marketing email's cart link, so
   all cart links behave identically. (The "Besprochene Produkte" list in the
   summary email still shows the full discussed set — only the cart narrows.)
3. **Marketing:** if newly granted, sends the DOI confirmation email and
   records the one consent as `pending`. A suppressed/unsubscribed address is
   never re-pended; an address already confirmed in Mo **or subscribed in
   Shopify** isn't sent a DOI (only checked when `marketingConsent: true`).

#### Success response

```http
HTTP/1.1 200 OK
```
```jsonc
{
  "ok": true,
  "transactional": { "summarySent": true },
  "marketing": {
    "status": "pending",        // "none" | "pending" | "confirmed"
    "doiEmailSent": true,
    "alreadyConfirmed": false   // true (+ status "confirmed", doiEmailSent false) when the
                                // address already held the consent — Mo DOI or Shopify
  }
}
```

The widget should show: "Wir haben dir die Zusammenfassung geschickt." and, when
`marketing.status === "pending"`, "Bitte bestätige noch die Anmeldung über den
Link in der E-Mail." Since 2026-10-05 `pending` is also answered to a submit
**without** the marketing tick when an earlier opt-in of the address is still
unconfirmed: the pending DOI and its link stay valid (before, such a submit
reset it to `none` and the link in the inbox stopped working).

> **Local-dev note:** `transactional.summarySent: true` is also returned when
> no email provider (Resend) is configured — the send is then *skipped*, not
> delivered. In production with Resend configured, `true` means the summary
> was handed to the provider; an actual delivery failure returns `502`.

After a success response, the widget MAY start attaching the captured email
as `customer.email` to the session's subsequent `/api/chat` requests to enable
returning-customer memory — see §2 "Optional `customer`" for the privacy rules
(in-memory only, this session only, never from `localStorage`).

#### Error responses

| Status | Code                   | When                                                              |
| ------ | ---------------------- | ----------------------------------------------------------------- |
| 400    | `bad_request`          | Invalid JSON or invalid email.                                    |
| 400    | `transactional_consent_required` | `transactionalConsent` not `true` (box left unchecked).  |
| 401    | `unauthorized`         | Missing / wrong shared secret.                                    |
| 403    | `forbidden`            | Cross-origin from an origin not in allowlist.                     |
| 429    | `rate_limited`         | Shares the chat bucket (20 req / 60 s).                           |
| 502    | `upstream_unavailable` | The transactional summary email failed to deliver.               |
| 503    | `upstream_unavailable` | No database configured — consent could not be stored.            |
| 500    | `internal_error`       | Anything else.                                                    |

### 7.2 `GET /api/confirm-marketing?token=...`

The marketing double-opt-in confirmation link (in the DOI email). Clicked as a
top-level navigation — returns an **HTML page**, no JSON, no auth guard.

- Valid, unexpired token → flips `marketing_doi_status='confirmed'`, sets
  `doi_confirmed_at`, renders **"Danke, deine Anmeldung ist bestätigt."** (200).
  Idempotent for an already-confirmed token.
- The first confirmation also sets the one consent to `subscribed`
  (`confirmed_opt_in`) and queues the Shopify write (`src/lib/consent-flows.ts`
  → `shopify_outbox`, sent while `SHOPIFY_CONSENT_WRITEBACK=true`): the
  Shopify customer's consent is updated, or — for a Mo-only subscriber — a
  Shopify customer is created with that consent.
- Invalid token → error page (400). Expired token (older than
  `MARKETING_DOI_EXPIRY_DAYS`, default 7) → error page (410).

### 7.3 `GET /api/unsubscribe?token=...`

The unsubscribe link carried by **every** marketing email. The token is a
signed, email-keyed value (`b64url(email).b64url(hmac-sha256)`) — unforgeable
and verifiable without a DB lookup.

- Valid signature → stamps `unsubscribed_at`, adds the address to the
  `suppression_list`, revokes marketing DOI, sets the one consent to
  `unsubscribed` and queues the same withdrawal for Shopify (so no
  Shopify-side mailer keeps writing either), renders **"Du wurdest
  abgemeldet."** (200).
- Invalid/forged token → error page (400). No DB → error page (503).

`isSuppressed(email)` (on the suppression list, fail-closed — every withdrawal,
Mo's or Shopify's, writes it) blocks every marketing send. Campaign mails
(including Einzelansprache) additionally require the one consent `subscribed`
with a provable double opt-in (`src/lib/campaign-gates.mjs`); the legacy 1:1
marketing path requires a confirmed Mo DOI (`canSendMarketing`). See
[`CONSENT_FLOW.md`](./CONSENT_FLOW.md).

### 7.4 `GET /api/consent-copy`

Serves the canonical consent copy for the widget's consent surfaces. The
capture-form payload is already attached to every `offer_email_summary` tool
result (§2), so the widget only needs this endpoint for capture forms **not**
triggered by the tool (e.g. a proactive share-form entry point), for the
`surface=signin` / `surface=chat` marketing surfaces, and for the
`surface=erase` "Meine Daten löschen" confirmation. The widget MUST source
all consent copy from these paths and **never hard-code it** — the strings
are the Art. 7 audit text.

Like `/api/products`: **no shared secret** (the strings are public form copy),
origin allowlist + rate limit only (shares the products bucket, 60 req /
60 s). Send `x-ms-session` for rate-limit keying.

#### Request

```
GET /api/consent-copy                   # in-chat capture form (default)
GET /api/consent-copy?surface=signin    # at-sign-in opt-in card
GET /api/consent-copy?surface=chat      # chat consent gate (v4) — submit via §7.6
GET /api/consent-copy?surface=erase     # "Meine Daten löschen" confirmation (POST /api/account/erase)
```

All surfaces accept `?locale=en` (default German).

The `signin` and `chat` surfaces share one payload shape (`headline`,
`marketingLabel`, `consentFooter`, `consentTextShown`, `imprintUrl`,
`privacyUrl`, `lawyerApproved`, `version`, `locale`, `enLegalReviewed`) — only
the strings differ. `headline` is benefit framing and NOT part of
`consentTextShown` (label + footer only). Both surfaces render as
**button-consent** (v4): label + footer fully visible, an explicit
"Ja, Angebote aktivieren" tap as the affirmative act, nothing pre-selected,
decline equally reachable. The widget renders nothing while `lawyerApproved`
is `false` (it is `true`).

**`surface=chat` additionally carries `signIn`** (additive; the chat gate
**leads with sign-in**, `chatGateSignInHint()` in `src/lib/consent-copy.ts`).
It is UI chrome — **never** part of `consentTextShown`, never echoed back:

```jsonc
"signIn": {
  "preferred": true,                                  // lead with the sign-in button; the typed-e-mail consent is the secondary path
  "headline": "Schon Kunde bei motion sports?",
  "body": "Melde dich mit deinem Kundenkonto an — dann kennt Mo deine Bestellungen und berät dich persönlich.",
  "buttonLabel": "Mit Kundenkonto anmelden",
  "alternativeLabel": "Kein Konto? Angebote per E-Mail erhalten",  // caption that reveals the typed-e-mail consent block
  "loginPath": "/api/auth/shopify/login"             // on the BACKEND origin; top-level redirect with ?session=&return_url= (CUSTOMER_ACCOUNT.md §2)
}
```

After sign-in the widget reads `/api/auth/me`: `marketing.optInActionable:
true` → show the at-sign-in card (`surface=signin`); `false` → the person has
already decided (or is subscribed in Shopify) — ask nothing. Widgets that
ignore `signIn` keep working with the typed-e-mail gate exactly as before.

**`surface=erase`** returns the confirmation copy for the widget's "Meine Daten
löschen" (the same wording as the mail-link page `/api/erase-data`,
`erasurePageCopy()`). It is not consent text; it has no `version` /
`consentTextShown`, only these strings:

```jsonc
{
  "confirmHeading": "Alle deine Daten löschen?",
  "confirmBody": "Damit löschen wir alles, was motion sports über dich gespeichert hat: …",
  "confirmButton": "Meine Daten endgültig löschen",
  "doneHeading": "Deine Daten wurden gelöscht",
  "doneBody": "Wir haben alle Daten gelöscht, die wir über dich gespeichert hatten, und melden uns nicht mehr bei dir.",
  "invalidHeading": "Dieser Link ist ungültig",     // mail-link page only
  "invalidBody": "Der Link ist unvollständig oder wurde verändert. …",  // mail-link page only
  "failedBody": "Es wurde nichts gelöscht — bitte versuch es gleich noch einmal."
}
```

`confirmBody` depends on `SHOPIFY_ERASURE_SYNC`: when on, it names the
customer account in the shop as deleted too and says orders stay in the shop
as long as the law requires; when off, it says the orders in the shop are not
affected. Render it verbatim.

#### Response (default surface — the capture form)

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: public, max-age=60, stale-while-revalidate=300
```
```jsonc
{
  // Identifier of the served copy ("v4"). Stamped server-side into the audit
  // trail (consent_copy_version) when the echoed consentTextShown matches.
  "version": "v4",
  // BOTH checkboxes start UNCHECKED (v2) — never pre-check either box.
  "transactionalLabel": "Ja, schickt mir meine Beratungs-Zusammenfassung per E-Mail (inkl. Direkt-Link zur Kasse).",
  "marketingLabel": "Ja, ich möchte exklusive Angebote und Aktionen erhalten — nur für Abonnenten. Jederzeit abbestellbar.",
  // Shared one-line footer rendered beneath both checkboxes (Art. 7 minimum),
  // with the imprint/privacy links placed next to it.
  "consentFooter": "Verarbeitung durch motion sports gemäß Datenschutzerklärung; Widerruf jederzeit möglich.",
  // Pre-composed audit string — echo back VERBATIM as `consentTextShown`
  // on POST /api/capture-email (§7.1). Never recompose it client-side.
  "consentTextShown": "Ja, schickt mir … | Ja, ich möchte exklusive Angebote … | Verarbeitung durch motion sports …",
  "imprintUrl": "https://motionsports.de/pages/impressum",
  "privacyUrl": "https://motionsports.de/policies/privacy-policy",
  // Mirrors CONSENT_COPY_LAWYER_APPROVED — informational. true since the copy
  // was lawyer-approved (June 2026).
  "lawyerApproved": true,
  // Returning-customer hint, rendered near the email input. Informational
  // only — NOT part of consentTextShown. Hide it when enabled is false
  // (server-side switch, RETURNING_HINT_ENABLED); wording can change with a
  // backend deploy (e.g. tuning after the CUST-B customer-memory clearance).
  "returningHint": {
    "enabled": true,
    "text": "Schon einmal von Mo beraten worden? Gib deine E-Mail an — Mo erkennt dich wieder und knüpft an deine letzte Beratung an."
  }
}
```

> ⚠️ **v2 payload change:** `marketingBenefitHint` was removed; `version`,
> `consentFooter` and `returningHint` are new (same change as the
> `offer_email_summary` tool result — §2).

The 60 s cache is deliberate: a lawyer copy change must reach live widgets
quickly. Fetch fresh copy when rendering a capture form (or at widget boot) —
do not persist it across sessions.

#### Error responses

| Status | Code             | When                                            |
| ------ | ---------------- | ----------------------------------------------- |
| 403    | `forbidden`      | Cross-origin from an origin not in allowlist.   |
| 429    | `rate_limited`   | Shares the products bucket (60 req / 60 s).     |
| 500    | `internal_error` | Unexpected server error.                        |

### 7.5 New environment variables

| Var                       | Purpose                                                              |
| ------------------------- | -------------------------------------------------------------------- |
| `PUBLIC_BASE_URL`         | Absolute base for email links (falls back to Vercel host / origin).  |
| `MARKETING_DOI_EXPIRY_DAYS` | DOI token validity window (default 7).                             |
| `UNSUBSCRIBE_SECRET`      | HMAC secret for unsubscribe tokens (falls back to `CHAT_SHARED_SECRET`). |
| `CONTACT_FROM_EMAIL`      | Reused as the sender for summary + DOI emails.                       |
| `RETURNING_HINT_ENABLED`  | **Default `true`.** Server-side switch for `returningHint.enabled` (§7.4); set `false` to make the widget hide the hint. |
| `SHOPIFY_CONSENT_WRITEBACK` | **Default `false`.** Send Mo-side consent changes (DOI confirm, unsubscribe) to Shopify; while off they wait in the outbox. No change to any response. |
| `SHOPIFY_ERASURE_SYNC`    | **Default `false`.** An erasure in Mo also asks Shopify to erase the customer (§11.1); switches the `surface=erase` `confirmBody` (§7.4). |

### 7.6 `POST /api/chat-marketing-opt-in`

The **chat consent gate** accept (v4): a marketing-ONLY opt-in with a typed
email, for **anonymous** chat sessions. The widget shows the gate once per
session after the user's first chat message (copy from
`GET /api/consent-copy?surface=chat`, §7.4) and POSTs here on the explicit
"Ja, Angebote aktivieren" tap. Not `/api/capture-email` — that endpoint
hard-requires the transactional tick and its audit string covers both
consents.

The gate **leads with sign-in** (`signIn` in the `surface=chat` payload, §7.4):
the primary action is the Customer Account sign-in; this typed-e-mail opt-in is
the alternative for people without a shop account.

#### Required request headers

Same as `/api/chat` (origin allowlist + `x-ms-chat-key` + `x-ms-session`).

#### Request body

```jsonc
{
  "sessionId": "b3c1…",           // optional; falls back to the x-ms-session header
  "email": "max@example.de",       // the email typed into the gate
  "marketingConsent": true,        // MUST be the user's actual accept tap — never hard-code true
  "consentTextShown": "Ja, schickt mir persönliche Angebote … | Verarbeitung durch motion sports …",  // the served surface=chat consentTextShown, echoed VERBATIM
  "locale": "de",                  // optional ("de" default, "en" on /en)
  "trigger": "chat_gate"           // optional echo; telemetry-only, ≤40 chars
}
```

- `email` is validated (`^[^@\s]+@[^@\s]+\.[^@\s]+$`) and normalised
  server-side. Invalid → **`400` code `invalid_email`**.
- `marketingConsent` must be exactly `true` (only sent on the accept tap) —
  anything else → **`400` code `marketing_consent_required`**.
- `consentTextShown` is stored verbatim as Art. 7 proof, with the server-side
  `consent_copy_version` stamp (`"v4"` when byte-identical to the served
  `surface=chat` string, `NULL` otherwise) — same rules as §7.1.
- Runs the **same double-opt-in pipeline** as `/api/capture-email` (marketing
  half): upsert, DOI `pending` + token, confirmation email; a
  suppressed/unsubscribed address is never re-pended; an address already
  confirmed in Mo or subscribed in Shopify is not sent a DOI (response
  `confirmed`, `alreadyConfirmed: true`, `doiEmailSent: false`). **No
  marketing until the link is clicked.**
- The capture records the **session id** and links the customer exactly like
  `/api/capture-email`, so after a success the widget MAY attach the email as
  `customer.email` on subsequent `/api/chat` requests to enable
  returning-customer memory (§2 privacy rules apply: in-memory only, this
  session only, never from `localStorage`).

#### Success response

```jsonc
{
  "ok": true,
  "marketing": {
    "status": "pending",        // "pending" → DOI email sent; "confirmed" → already subscribed
    "doiEmailSent": true,
    "alreadyConfirmed": false   // true when the address already held the consent (earlier
                                // Mo DOI or subscribed in Shopify) — no DOI mail, doiEmailSent false
  }
}
```

After a `pending` response, tell the user to check their inbox and click the
confirmation link — they are **not** subscribed until they do. After
`confirmed`, there is nothing to confirm (e.g. "Du bist bereits angemeldet").

#### Error responses

| Status | Code                         | When                                                       |
| ------ | ---------------------------- | ---------------------------------------------------------- |
| 400    | `bad_request`                | Invalid JSON body.                                         |
| 400    | `invalid_email`              | Email missing or not a valid address.                      |
| 400    | `marketing_consent_required` | `marketingConsent` not `true` (no real accept tap).        |
| 401    | `unauthorized`               | Missing / wrong shared secret.                             |
| 403    | `forbidden`                  | Cross-origin from an origin not in allowlist.              |
| 429    | `rate_limited`               | Chat bucket (20 req / 60 s) or per-recipient DOI cap (3 / 60 min); carries `Retry-After`. |
| 503    | `upstream_unavailable`       | No database configured — consent could not be stored.      |
| 500    | `internal_error`             | Anything else.                                             |

---

## 8. `POST /api/tts`

Text-to-speech for the widget's **voice mode**. Takes a chunk of text
(typically one assistant message the user chose to hear) and streams back
synthesized speech as **MP3 audio**. Synthesis is OpenAI's
`gpt-4o-mini-tts` (current cost-efficient, multilingual model); the model
and voice are env-overridable.

### Required request headers

Same as `/api/chat`:

| Header          | Value                                                                |
| --------------- | -------------------------------------------------------------------- |
| `Content-Type`  | `application/json`                                                   |
| `x-ms-chat-key` | Shared secret from `CHAT_SHARED_SECRET`.                             |
| `x-ms-session`  | Stable session id (UUID). Keys the rate-limit bucket and the usage attribution. |

Plus the browser `Origin` header, which must be one of `ALLOWED_ORIGINS`.
The CORS preflight advertises `POST, OPTIONS` and
`Content-Type, x-ms-chat-key, x-ms-session, x-ms-locale`.

### Request body

```jsonc
{
  "text": "Das ATX Power Rack ist sehr stabil und passt gut in deinen Keller.",
  // Optional. Streaming (per-sentence) mode — see "Streaming voice mode" below.
  "stream": true,
  // Optional. Chunk index echoed back in X-MS-TTS-Seq (streaming mode only).
  "seq": 0
}
```

- `text` (string, **required**). Reject if missing/not a string
  (`400 bad_request`) or empty after cleaning (`400 bad_request`).
- `stream` (boolean, **optional**, default `false`). When `true`, the call is
  rate-limited on the more generous **`tts-stream`** bucket (120 req / 5 min)
  instead of the single-shot `tts` bucket (20 req / 5 min). Everything else —
  auth, origin, cleaning, synthesis, usage recording, response shape — is
  identical. See **Streaming voice mode** below.
- `seq` (number, **optional**). A caller-assigned chunk index (≥ 0). It is
  echoed back verbatim in the `X-MS-TTS-Seq` response header so the widget can
  slot each independently-completing audio response into its playback queue
  without depending on response arrival order. Absent / invalid → header is
  `-1`.
- **The server cleans the text before synthesis.** Markdown artifacts are
  stripped (`**bold**`, `` `code` ``, `[links](url)`, headings, bullet
  lists) so nothing is ever read aloud as punctuation. The widget SHOULD
  also pre-clean, but the server never trusts that it did.
- **Hard length cap: 2000 characters.** Longer input is **truncated at a
  sentence boundary** (not rejected): the server cuts on the last sentence
  end that fits, so the audio ends on a natural pause. When this happens the
  response carries `X-MS-TTS-Truncated: true` — the request still succeeds
  with audio for the kept portion.

### Streaming voice mode (audio while the text streams)

By default the widget waits for the **whole** assistant message before it
calls `/api/tts` once — so spoken audio only starts after generation
finishes, which feels slow. Streaming voice mode plays audio **while** the
text is still streaming (ChatGPT-style): the widget watches the SSE chat
stream, and as soon as it has a **complete sentence/clause** it fires
`POST /api/tts` with `{ "text": "<that sentence>", "stream": true, "seq": n }`
and pushes the returned MP3 into a playback queue. The first audio can start
~1 s after the **first** sentence instead of after the full answer.

This reuses the existing endpoint wholesale — same shared secret, same origin
allowlist, same `gpt-4o-mini-tts` synthesis, same per-request usage recording.
The only difference is the rate-limit bucket: per-sentence calls mean several
requests per played answer, so streaming mode uses **`tts-stream`** (120 req /
5 min) while the single-shot full-message path keeps the tight `tts` bucket
(20 req / 5 min). Each chunk is still capped at 2000 chars, so total
synthesized characters per window stay bounded.

**Per-sentence calling pattern (the contract):**

Chunking follows the backend's canonical, unit-tested reference splitter —
`splitIntoTtsChunks()` in `src/lib/tts-text.mjs` (`tts-text.test.mjs` is the
spec); the widget mirrors it so chunk boundaries match what the server expects.

1. As chat tokens arrive, append them to a buffer and run
   `splitIntoTtsChunks(buffer)` → `{ chunks, rest }`. It emits a chunk as soon
   as a sentence terminator (`.`, `!`, `?`, `…`) **or a newline** completes a
   sentence; **coalesces** fragments shorter than `minChars` (default `40`) into
   the next sentence; **force-cuts** a run longer than `maxChars` (default `220`)
   at the last clause boundary (`,` `;` `:` `–` `—`) or space so a long opening
   sentence can't stall the first audio; and guards German abbreviations
   (`z. B.`, `usw.`), decimals (`3.5`) and mid-token dots (`google.com`). Set
   `buffer = rest` and prepend to the next delta; when the stream ends call
   `splitIntoTtsChunks(buffer, { flush: true })` to drain the remainder.
2. For each chunk, in stream order, `POST /api/tts` with
   `{ text, stream: true, seq }` where `seq` is a monotonically increasing
   index starting at 0. (The server re-strips Markdown and rejects empties.)
3. **Play strictly in `seq` order.** Requests complete out of order; use the
   echoed `X-MS-TTS-Seq` header (and your own `seq` counter) to enqueue, and
   only advance playback when the next-in-order clip has arrived. Buffer
   later-but-ready clips.
4. **Fallbacks (unchanged):** if a chunk returns a non-2xx (e.g. `429
   rate_limited` or `502 upstream_unavailable`), stop the per-sentence path
   for this message and fall back to either the single-shot **play-after-
   complete** full-message call (`stream` omitted) or the browser's
   `speechSynthesis`, exactly as today. Streaming TTS is a perceived-latency
   optimisation layered **on top of** the existing behaviour, never a
   replacement for it.

Every streamed chunk records its synthesized-character count for the cost KPI
(S6) exactly like a single-shot call, so a streamed answer aggregates to the
same total spend — only the request count differs.

**Voice settings (server-side).** The voice defaults to a faster, more energetic
delivery: `TTS_VOICE=coral` (warm/upbeat) at `TTS_SPEED=1.1` (brisk) with an
energetic German steering instruction — all env-overridable. On the default
`gpt-4o-mini-tts` the rate is applied as a tempo hint (that model ignores the
numeric `speed` field); legacy `tts-1` models take `speed` numerically. Set
`TTS_SPEED=1.0` to restore the neutral pace.

### Success response — streamed audio

```http
HTTP/1.1 200 OK
Content-Type: audio/mpeg
Cache-Control: no-store, no-cache, must-revalidate, max-age=0
X-MS-TTS-Truncated: false
X-MS-TTS-Chars: 67
```

The body is the MP3 byte stream — play it directly (e.g. an `<audio>`
element via a blob/object URL, or the Web Audio API).

- **Format = MP3 (`audio/mpeg`)**, chosen for the broadest mobile playback.
  Opus is smaller / lower-latency but iOS Safari does **not** decode Opus in
  an Ogg/WebM container in `<audio>` — which is exactly the device class
  where the browser-`speechSynthesis` fallback is worst. MP3 plays on iOS
  Safari, Android Chrome, and desktop with no container caveats.
- **Caching is off** (`no-store, …`) — audio is per-session and synthesized
  on demand.

Response headers the widget can read (CORS-exposed):

| Header               | Meaning                                                              |
| -------------------- | -------------------------------------------------------------------- |
| `X-MS-TTS-Truncated` | `true` when the input exceeded 2000 chars and was cut at a sentence boundary; `false` otherwise. |
| `X-MS-TTS-Chars`     | Number of characters actually synthesized (after cleaning + truncation). |
| `X-MS-TTS-Seq`       | Echoes the request's `seq` (streaming mode), so async chunk responses can be ordered for playback. `-1` when no valid `seq` was sent. |

### Error responses

```json
{ "error": { "code": "upstream_unavailable", "message": "Text-to-speech is temporarily unavailable" } }
```

| Status | Code                   | When                                                                 |
| ------ | ---------------------- | -------------------------------------------------------------------- |
| 400    | `bad_request`          | Invalid JSON, `text` missing/not a string, or empty after cleaning.  |
| 401    | `unauthorized`         | Missing / wrong shared secret.                                       |
| 403    | `forbidden`            | Cross-origin request from an origin not in the allowlist.            |
| 429    | `rate_limited`         | Single-shot: `tts` bucket (**20 req / 5 min**). Streaming (`stream: true`): `tts-stream` bucket (**120 req / 5 min**). `Retry-After` set. |
| 502    | `upstream_unavailable` | OpenAI TTS failed/threw, or no API key configured.                   |
| 500    | `internal_error`       | Anything else.                                                       |

> **Fallback contract:** on **any non-2xx** response — and specifically on
> `502 upstream_unavailable` — the widget should fall back to the browser's
> built-in `speechSynthesis`. `upstream_unavailable` is the documented,
> expected signal for "synthesis is down, use the local voice"; it is not a
> bug and the widget should not surface an error to the user, just speak
> locally instead.

### Voice + model configuration

| Var                | Default            | Notes                                                                 |
| ------------------ | ------------------ | --------------------------------------------------------------------- |
| `TTS_MODEL`        | `gpt-4o-mini-tts`  | Current cost-efficient OpenAI TTS model (multilingual).               |
| `TTS_VOICE`        | `alloy`            | Neutral, clean German pronunciation. Warmer options: `nova`, `coral`, `shimmer`. |
| `TTS_INSTRUCTIONS` | German tone hint   | Tone/accent steering (gpt-4o-mini-tts only). Steers natural Hochdeutsch. |
| `TTS_SPEED`        | `1.0`              | Speaking rate (clamped 0.25–4.0). A slightly higher value (e.g. `1.1`) improves perceived responsiveness in streaming mode. Applied as the numeric `speed` param on legacy `tts-1`/`tts-1-hd`; on `gpt-4o-mini-tts` (which rejects `speed`) it is folded into `instructions` as a tempo hint. `1.0` leaves the single-shot path unchanged. |

### Cost attribution

Each request records one usage row for the cost KPI (S6): the **characters
synthesized**, attributed to the conversation (resolved from `x-ms-session`),
with the TTS model id. TTS is billed per character, so this is stored in a
shape compatible with the S6 `ai_usage` table — `call_site = 'tts'`, the
character count in the `input_tokens` column, `output_tokens = 0`,
`estimated = true` to flag the per-character (not per-token) unit. It is
counted as chat-serving spend in the dashboard split, and does **not** affect
the token-based cost-per-consultation average.

In **streaming voice mode** this is unchanged per request: each per-sentence
chunk records its own `call_site = 'tts'` row for the characters it
synthesized. The rows aggregate to the same total characters the single-shot
call would have recorded for the full message — spend tracking is identical,
just split across more rows.

---

## 9. `POST /api/feedback`

Customer feedback capture. A free-text comment plus **optional context**,
stored in the `feedback` table (migration 0020) and surfaced read-only in the
admin **Feedback** tab. Behind the same widget guard as `/api/chat` — origin
allowlist + `x-ms-chat-key` shared secret + rate limit.

Light abuse protection: a **dedicated, tight rate-limit bucket**
(`feedback`: 5 req / 5 min, keyed by `x-ms-session`/IP) plus a hard
**length cap** on the comment.

### Required request headers

Same as `/api/chat`:

| Header          | Value                                                                |
| --------------- | -------------------------------------------------------------------- |
| `Content-Type`  | `application/json`                                                   |
| `x-ms-chat-key` | Shared secret.                                                       |
| `x-ms-session`  | Stable session id (UUID). Used for rate limiting + as the `sessionId` fallback. |

### Request body

```jsonc
{
  "message": "Der Vergleich der Racks war super hilfreich!",  // required, ≤4000 chars
  // ↓ all optional CONTEXT — send what the widget has, omit the rest
  "sessionId": "b3c1…",            // pseudonymous; falls back to the x-ms-session header
  "conversationId": "thread-2",    // the conversationKey/thread the comment is about
  "tier": "anonymous",             // customer tier the widget knows (telemetry-grade)
  "email": "max@example.de",       // ONLY if already identified (signed-in / captured)
  "page": "/produkte/atx-rack-pro" // storefront URL/path the user was on
}
```

- `message` is the only required field — non-empty after trimming, **≤4000
  characters** (longer is rejected with `payload_too_large`, never silently cut).
  `feedback` is accepted as an alias for `message`.
- Every optional context field is trimmed and length-capped server-side
  (`sessionId`/`conversationId` ≤128, `tier` ≤40, `email` ≤254, `page` ≤1024);
  blanks become `null`.
- **`email` here is user-supplied contact context for this comment** (like
  `/api/contact`), **not** a consent record and grants **no** permission. The
  audit-grade consent trail lives exclusively in `email_captures` (Mo's Art. 7
  evidence) and `consent_events` (the history of the one consent).

### Success response

```http
HTTP/1.1 200 OK
Content-Type: application/json
```
```json
{ "ok": true }
```

### Error responses

| Status | Code                   | When                                                                 |
| ------ | ---------------------- | -------------------------------------------------------------------- |
| 400    | `bad_request`          | Invalid JSON, or `message` missing/empty.                            |
| 413    | `payload_too_large`    | `message` exceeds the 4000-char cap.                                 |
| 401    | `unauthorized`         | Missing / wrong shared secret.                                       |
| 403    | `forbidden`            | Cross-origin request from an origin not in the allowlist.            |
| 429    | `rate_limited`         | Dedicated `feedback` bucket (5 req / 5 min). `Retry-After` set.      |
| 503    | `upstream_unavailable` | No database configured, or the insert failed (comment not stored).   |
| 500    | `internal_error`       | Anything else.                                                       |

## 10. `POST /api/attribution/token`

Mints (or returns the existing) **order-attribution token** for the widget's
session — the opaque marker the widget stamps onto the live storefront cart so
a later purchase can be attributed to the consultation (tiered, honest
attribution; full design in [`ORDER_ATTRIBUTION.md`](./ORDER_ATTRIBUTION.md)).

**Consent gate lives in the widget:** call this (and stamp the cart) only when
the storefront's Shopify Customer Privacy state allows analytics processing.

### Request

Same guards as `/api/capture-email`: origin allowlist + `x-ms-chat-key` +
`x-ms-session`. No body required.

```http
POST /api/attribution/token
Origin: https://www.motionsports.de
x-ms-chat-key: <shared secret>
x-ms-session: <session id>
```

### Response

```json
{ "ok": true, "token": "…", "cartAttributes": { "_mo": "…" } }
```

`cartAttributes` is the exact object to pass to the storefront cart:

```js
fetch("/cart/update.js", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ attributes: cartAttributes }),
});
```

Minting is idempotent per session: it returns the same token while it exists;
after a purge (retention) or erasure, a new one. The attribution window counts
from the token's minting — with the backend switch `MO_ATTRIBUTION_SESSION_ANCHOR`
on, from the session's latest product consultation before the order
(`ORDER_ATTRIBUTION.md`). Stamp
fail-silent, re-stamp before opening any Mo cart link and after each
add-to-cart click (a completed checkout clears the cart and its attributes).

### Error responses

| Status | Code                   | When                                                       |
| ------ | ---------------------- | ---------------------------------------------------------- |
| 400    | `bad_request`          | Missing `x-ms-session` header.                             |
| 401    | `unauthorized`         | Missing / wrong shared secret.                             |
| 403    | `forbidden`            | Origin not in the allowlist.                               |
| 429    | `rate_limited`         | Shared `kpi` bucket. `Retry-After` set.                    |
| 503    | `upstream_unavailable` | No database configured / token could not be minted.        |
| 500    | `internal_error`       | Anything else.                                             |

---

## 11. Mail-link and server-to-server endpoints

None of these is called by the widget. They are listed because they act on the
data the widget creates (consents, conversations, the signed-in customer).

### 11.1 Erasure — `POST /api/account/erase` and `GET/POST /api/erase-data`

Both run **the one erasure path** `erasePerson` (`src/lib/customer-erasure.ts`),
the same one as the admin's "Löschen". Request and response shapes are
unchanged:

- `POST /api/account/erase` (signed-in widget XHR, `CUSTOMER_ACCOUNT.md` §9) →
  `{ "ok": true, "erased": true, "deletedConversations": 7 }`; `503
  upstream_unavailable` when nothing could be erased.
- `/api/erase-data?token=…` (the "Daten löschen" link in every marketing and
  campaign mail): `GET` renders a confirmation page with a button (mail
  scanners open links, so the link itself never deletes), `POST` (the button)
  erases. HTML pages; `400` for an invalid token, `503` when the erasure
  failed.

What an erasure does since the deletion is shared with Shopify:

1. **Mo deletes at once**, in one transaction: the customer and profile, every
   conversation, consent records and history, marketing and campaign mails,
   correspondence, letters, feedback, Mo's copy of the person's Shopify orders,
   sign-in state. Aggregate order facts for the revenue KPIs (`mo_orders`) lose
   the link to the person. The address stays on the suppression list with
   reason `erasure`.
2. **For a person with a Shopify customer id**, an erasure tombstone stops the
   import, the reconciliation and the webhooks from re-creating them, and two
   rows go into the Shopify outbox: a `consent_update` to unsubscribed (sent
   while `SHOPIFY_CONSENT_WRITEBACK=true` — so the write-back switch alone
   already stops every Shopify-side mailer) and a `data_erasure` (sent while
   `SHOPIFY_ERASURE_SYNC=true`: consent off again first, then Shopify's own
   `customerRequestDataErasure`). A row whose switch is off waits. Shopify keeps
   the order records the law requires.
3. A Mo contact without a Shopify account (Interessent) is erased in Mo only.

The reverse direction: Shopify's `customers/redact` and `customers/delete`
webhooks run the same deletion in Mo (§11.3). The widget's confirmation dialog
uses the `surface=erase` copy (§7.4), whose `confirmBody` names the shop
account when `SHOPIFY_ERASURE_SYNC` is on.

### 11.2 `GET /api/r/{token}` — tracked mail links

A click on a link in a Mo mail is recorded (`clicked_at` + a KPI event, §5) and
redirected with `302`. The token is tried in this order:

| Token | Destination |
| --- | --- |
| 1:1 marketing send | The prefilled Shopify cart (discount code intact). |
| Campaign send, campaign CTA = shop (`cta_kind = 'shop'`, an `https://` URL) | That shop URL. |
| Campaign send, CTA = Mo (default) | The Mo deep link (`CAMPAIGN_MO_DEEPLINK_URL`) with `mo_c=<token>` appended; the widget passes it back as `campaignToken` on `POST /api/chat` (§2) so the chat it opens is counted for the send. |
| Bundle offer | The bundle's cart permalink, or a branded "Angebot abgelaufen" page (`410`) for an expired / archived offer. |
| Unknown / pruned | The storefront cart (never an error page). |

`&locale=` on the link sets the language of the expired-offer page.

### 11.3 `POST /api/webhooks/shopify`

Shopify → backend. The `X-Shopify-Hmac-SHA256` signature is verified over the
**raw body before it is parsed** (`verifyShopifyWebhook`,
`src/lib/shopify-webhook.mjs`) against `SHOPIFY_WEBHOOK_SECRET` (subscriptions
made in the Shopify admin) or `SHOPIFY_CLIENT_SECRET` (subscriptions made by
the app, including the compliance topics). No secret configured → `503`; bad
or missing signature → `401`, body never read.

| Topic (`X-Shopify-Topic`) | Effect |
| --- | --- |
| `products/*`, `inventory_levels/*` | Targeted single-product catalog refresh (`docs/CATALOG_SYNC.md`). |
| `customers/create`, `customers/update` | Upsert the customer mirror (a `customers` row per Shopify customer); the embedded e-mail-marketing consent goes through the consent resolver. |
| `customers_email_marketing_consent/update` | Consent resolver only (Shopify-side subscribe / unsubscribe). Unknown customers are left to the reconciliation. |
| `orders/create`, `orders/updated`, `orders/paid`, `orders/cancelled` | Order ledger (`customer_orders`). `orders/create` and `orders/paid` also feed the pseudonymous order attribution (`mo_orders`, `ORDER_ATTRIBUTION.md`); a marked order that cannot be attributed is counted on `orders/create` as the session-less event `mo_order_marker_unresolved` (§5). Other `orders/*` topics are acknowledged and ignored. |
| `customers/delete`, `customers/redact` | The one erasure in Mo (trigger `shopify`: Shopify is not asked again). More than `SHOPIFY_ERASURE_ALERT_PER_HOUR` (default 20) in an hour raises an alert and an Eingang item. |
| `customers/data_request` | An Eingang item `datenauskunft` (deadline 30 days) for the operator to answer with the data export. |
| `shop/redact` | Alert + Eingang item only — never an automatic mass deletion. |
| `bulk_operations/finish` | Acknowledged; the import's next step polls the bulk operation itself. |

All customer, consent, order and compliance topics are de-duplicated by
`X-Shopify-Webhook-Id` (a Shopify retry answers `{ "ok": true, "duplicate":
true }`). A processing failure answers `500` and forgets the delivery id, so
Shopify's retry is applied. The nightly `/api/cron/shopify-reconcile` catches
whatever a webhook missed.
