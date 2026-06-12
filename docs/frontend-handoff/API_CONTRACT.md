# motion sports chat backend — API contract

> **Synced copy.** This file is a copy of the backend repo's
> `docs/API_CONTRACT.md` for frontend sessions that don't have that repo.
> The backend doc is canonical — whenever the backend contract changes,
> this folder must be re-synced from it. References to other backend docs
> (`docs/CONSENT_FLOW.md`, `src/lib/consent-copy.ts`, …) are informational;
> everything the widget needs is inline here.

This document is the single source of truth for the Shopify widget that
calls this backend. If anything here disagrees with the code, the code
wins — open an issue and we'll fix one or the other so they match.

## 1. Overview

**Base URL (production):** `https://chat.motionsports.de`

Endpoints:

| Method | Path                      | Purpose                                                  |
| ------ | ------------------------- | -------------------------------------------------------- |
| POST   | `/api/chat`               | Streaming Claude chat with persona-aware tools.          |
| POST   | `/api/contact`            | Contact-form submission → email via Resend.              |
| GET    | `/api/products`           | Public product hydration for widget cards.               |
| POST   | `/api/kpi`                | Pseudonymous telemetry ingestion (fire-and-forget).      |
| POST   | `/api/capture-email`      | GDPR email capture + double opt-in (summary + marketing).|
| GET    | `/api/consent-copy`       | Canonical capture-form consent copy (labels + links).     |
| GET    | `/api/confirm-marketing`  | Marketing double-opt-in confirmation link (HTML page).   |
| GET    | `/api/unsubscribe`        | Signed unsubscribe link → suppression (HTML page).        |

> `/api/confirm-marketing` and `/api/unsubscribe` are **clicked from emails**
> as top-level browser navigations — they return an HTML page, not JSON, and
> have **no** CORS allowlist or shared-secret guard (a mail client sends no
> `Origin` and no custom header). They're protected by unguessable / signed
> tokens instead. The widget never calls them directly.

### Security model

A defense-in-depth combination, since the widget runs on a public
storefront:

- **Origin allowlist.** Cross-origin requests are accepted only from
  origins in `ALLOWED_ORIGINS` (default: `https://www.motionsports.de`,
  `https://motionsports.de`). The CORS preflight (`OPTIONS`) reflects
  the same allowlist.
- **Shared secret** (`x-ms-chat-key`). Required on `/api/chat`,
  `/api/contact`, and `/api/capture-email` (§7.1). *Honest caveat:* this secret is shipped to the
  storefront widget, so anyone can read it from the browser. The
  point isn't strong auth — it's combining it with the origin
  allowlist and rate limit so that a scraper has to forge the origin
  AND know the secret AND distribute IPs to abuse the endpoint.
  `/api/products` does NOT require the secret; it exposes only fields
  already visible on the storefront.
- **Rate limiting.** Upstash sliding-window limiter, keyed by
  `x-ms-session` (or IP fallback). Chat bucket: **20 req / 60 s**.
  Products bucket: **60 req / 60 s**.
- **Spend caps.** Hard monthly caps on Anthropic + OpenAI; the chat
  conversation is hard-capped at 40 messages per session.

### Error envelope

Every non-streaming error response uses the same shape:

```json
{ "error": { "code": "rate_limited", "message": "Too many requests" } }
```

Codes the widget should handle: `bad_request`, `unauthorized`,
`forbidden`, `rate_limited`, `payload_too_large`,
`upstream_unavailable`, `internal_error`. Codes are stable and
don't leak internals — the message is a user-safe German or English
string.

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
`Content-Type, x-ms-chat-key, x-ms-session` in
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
conversations, a generated "current understanding" summary, and/or a cached
purchase history), the backend injects a compact memory block into the system
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
| `start-step` / `finish-step` | — | ignore (the model can run up to **6 steps** per turn — `stepCountIs(6)`) |
| `text-start` | `id` | open a text part keyed by `id` |
| `text-delta` | `id`, `delta` | **append** `delta` to that text part's bubble |
| `text-end` | `id` | text part complete |
| `tool-input-start` | `toolCallId`, `toolName` | open a tool part keyed by `toolCallId` (render nothing yet) |
| `tool-input-delta` | `toolCallId`, `inputTextDelta` | streaming JSON of the args; safe to ignore |
| `tool-input-available` | `toolCallId`, `toolName`, `input` | args complete → **render the card now** (dispatch on `toolName`, read `input`) |
| `tool-output-available` | `toolCallId`, `output` | tool result → for `offer_email_summary` this carries the load-bearing `output.consentCopy`; the other tools return `{ ok: true }` |
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
        | "bulk_discount" | "leasing" | "maintenance" | "general";
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
its `output.consentCopy` contains the exact checkbox labels, the marketing
benefit hint, the imprint/privacy links, and the pre-composed
`consentTextShown` audit string. The widget **MUST render these
backend-served strings and MUST NOT hard-code any consent copy** — the served
text is stored verbatim as Art. 7 proof of consent, so a hard-coded theme
snapshot could silently diverge from the audit record. Lawyer copy changes
ship as a backend deploy with no widget release. (For capture forms not
triggered by this tool, the same payload is available via
`GET /api/consent-copy` — §7.4.)

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
      "transactionalLabel": "Ja, sendet mir eine Zusammenfassung dieses Gesprächs und meinen Warenkorb per E-Mail.",
      "marketingLabel": "Ja, Mo darf sich mich merken: motion sports darf mich per E-Mail mit persönlichen Empfehlungen und Angeboten kontaktieren, die auf meinen Beratungsgesprächen basieren.",
      "marketingBenefitHint": "Dein Vorteil: Beim nächsten Besuch erkennt Mo dich wieder — …",
      "consentTextShown": "Ja, sendet mir … | Ja, Mo darf sich mich merken … Dein Vorteil: …",
      "imprintUrl": "https://motionsports.de/pages/impressum",
      "privacyUrl": "https://motionsports.de/policies/privacy-policy",
      "lawyerApproved": false
    }
  }
}
```
Widget action: render `message` as the intro, then the capture form with:

- an **email** input,
- a **transactional** consent checkbox (required to submit) — label from
  `output.consentCopy.transactionalLabel`. This is the requested service (not
  marketing), so it is the **low-friction default path**: the widget MAY
  render it **pre-checked** — submitting the form is itself the affirmative
  request for this email.
- a **separate** marketing consent checkbox — label from
  `output.consentCopy.marketingLabel`, with the benefit line
  `output.consentCopy.marketingBenefitHint` rendered directly beneath it as
  part of the same consent block. **This box MUST start UNCHECKED — never
  pre-check it.** Pre-ticked marketing consent is invalid (GDPR
  clear-affirmative-act; CJEU *Planet49*) and a German UWG Abmahnung trigger;
  this is a deliberate, documented decision (see `src/lib/consent-copy.ts`).
  The widget SHOULD make the box **prominent** (placement, styling, the
  benefit hint) — opt-ins are won through the copy, not a pre-tick.
- **imprint + privacy links** next to the form, targeting
  `output.consentCopy.imprintUrl` / `output.consentCopy.privacyUrl`
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

> ⚠️ The checkbox labels are PLACEHOLDER copy pending lawyer approval — see
> [`CONSENT_FLOW.md`](./CONSENT_FLOW.md).

#### Tools the widget MUST NOT render

These are background tools — skip their chunks when `toolName` matches:

- `update_customer_profile` — updates the persona view; pure
  bookkeeping.
- `search_products` — internal RAG; the assistant uses the
  result to decide which `show_product` / `compare_products` calls to
  make. Its `tool-output-available` chunk streams the search result
  (`{ totalMatched, products: [...] }`) — ignore it.

Both tools still appear in the stream (the full
`tool-input-start → … → tool-output-available` chunk sequence) and the
widget must consume them without rendering anything.

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
stdout log when Resend env vars are unset.

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
  "message": "Wir planen ein neues Studio mit ca. 200 m² Krafttraining..."
}
```

- `reason` must be one of: `studio_consultation`, `public_sector_quote`,
  `physio_consultation`, `bulk_discount`, `leasing`, `maintenance`,
  `general`. Anything else is accepted but rendered verbatim in the
  email subject.
- `email` is validated with `^[^@\s]+@[^@\s]+\.[^@\s]+$`.
- `name` and `message` must be non-empty after trimming.

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
trigger moment and per ask number.

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

This is the only flow that handles an email address. Two **separate**
consents, marketing requires a **double opt-in**. The full legal rationale,
the data model, and the lawyer-review TODO are in
[`CONSENT_FLOW.md`](./CONSENT_FLOW.md). The checkbox/email copy is PLACEHOLDER
pending lawyer sign-off (`src/lib/consent-copy.ts`).

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
  "transactionalConsent": true,    // required to be true
  "marketingConsent": false,       // separate, MUST default unchecked in the UI (never pre-ticked)
  "consentTextShown": "Ja, sendet mir … | Ja, Mo darf sich mich merken … Dein Vorteil: …",  // backend-served audit string, echoed verbatim
  "trigger": "recommendation_accepted"  // optional; echo of the offer's trigger (telemetry only)
}
```

- `email` is validated with `^[^@\s]+@[^@\s]+\.[^@\s]+$` and normalised
  (trim + lower-case) server-side.
- `transactionalConsent` **must** be `true` — you can't email a summary
  without consent to email the summary. `false`/missing → `400 bad_request`.
- `marketingConsent` is independent. When `true` (and the address isn't
  suppressed), the backend sets `marketing_doi_status='pending'`, issues a DOI
  token, and sends the confirmation email. **No marketing** is sent until the
  user clicks that link.
- `consentTextShown` is stored verbatim as Art. 7 proof. It MUST be the
  **backend-provided** `consentCopy.consentTextShown` string (from the
  `offer_email_summary` tool result or `GET /api/consent-copy`, §7.4) echoed
  back **byte-for-byte** — the widget never composes or hard-codes this text.
  Because the form renders exactly those served strings, the audit record
  cannot diverge from what was displayed.
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
3. **Marketing:** if newly granted, sends the DOI confirmation email. A
   suppressed/unsubscribed address is never re-pended; an already-confirmed
   address isn't re-sent a DOI.

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
    "alreadyConfirmed": false
  }
}
```

The widget should show: "Wir haben dir die Zusammenfassung geschickt." and, when
`marketing.status === "pending"`, "Bitte bestätige noch die Anmeldung über den
Link in der E-Mail."

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
| 400    | `bad_request`          | Invalid JSON, invalid email, or `transactionalConsent` not true.  |
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
- Invalid token → error page (400). Expired token (older than
  `MARKETING_DOI_EXPIRY_DAYS`, default 7) → error page (410).

### 7.3 `GET /api/unsubscribe?token=...`

The unsubscribe link carried by **every** marketing email. The token is a
signed, email-keyed value (`b64url(email).b64url(hmac-sha256)`) — unforgeable
and verifiable without a DB lookup.

- Valid signature → stamps `unsubscribed_at`, adds the address to the
  `suppression_list`, revokes marketing DOI, renders **"Du wurdest
  abgemeldet."** (200).
- Invalid/forged token → error page (400). No DB → error page (503).

`isSuppressed(email)` (suppression list OR unsubscribed, fail-closed) and
`canSendMarketing(email)` (DOI confirmed AND not suppressed) gate every future
marketing send. See [`CONSENT_FLOW.md`](./CONSENT_FLOW.md).

### 7.4 `GET /api/consent-copy`

Serves the canonical capture-form consent copy. The same payload is already
attached to every `offer_email_summary` tool result (§2), so the widget only
needs this endpoint for capture forms **not** triggered by the tool (e.g. a
proactive share-form entry point). The widget MUST source all consent copy
from one of these two paths and **never hard-code it** — the strings are the
Art. 7 audit text.

Like `/api/products`: **no shared secret** (the strings are public form copy),
origin allowlist + rate limit only (shares the products bucket, 60 req /
60 s). Send `x-ms-session` for rate-limit keying.

#### Request

```
GET /api/consent-copy
```

#### Response

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: public, max-age=60, stale-while-revalidate=300
```
```jsonc
{
  "transactionalLabel": "Ja, sendet mir eine Zusammenfassung dieses Gesprächs und meinen Warenkorb per E-Mail.",
  "marketingLabel": "Ja, Mo darf sich mich merken: motion sports darf mich per E-Mail mit persönlichen Empfehlungen und Angeboten kontaktieren, die auf meinen Beratungsgesprächen basieren.",
  "marketingBenefitHint": "Dein Vorteil: Beim nächsten Besuch erkennt Mo dich wieder — …",
  // Pre-composed audit string — echo back VERBATIM as `consentTextShown`
  // on POST /api/capture-email (§7.1). Never recompose it client-side.
  "consentTextShown": "Ja, sendet mir … | Ja, Mo darf sich mich merken … Dein Vorteil: …",
  "imprintUrl": "https://motionsports.de/pages/impressum",
  "privacyUrl": "https://motionsports.de/policies/privacy-policy",
  // Mirrors CONSENT_COPY_LAWYER_APPROVED — informational; stays false until
  // Legal signs off on the placeholder copy.
  "lawyerApproved": false
}
```

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
