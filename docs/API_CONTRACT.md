# motion sports chat backend — API contract

This document is the single source of truth for the Shopify widget that
calls this backend. If anything here disagrees with the code, the code
wins — open an issue and we'll fix one or the other so they match.

## 1. Overview

**Base URL (production):** `https://chat.motionsports.de`

Three endpoints:

| Method | Path             | Purpose                                                  |
| ------ | ---------------- | -------------------------------------------------------- |
| POST   | `/api/chat`      | Streaming Claude chat with persona-aware tools.          |
| POST   | `/api/contact`   | Contact-form submission → email via Resend.              |
| GET    | `/api/products`  | Public product hydration for widget cards.               |

### Security model

A defense-in-depth combination, since the widget runs on a public
storefront:

- **Origin allowlist.** Cross-origin requests are accepted only from
  origins in `ALLOWED_ORIGINS` (default: `https://www.motionsports.de`,
  `https://motionsports.de`). The CORS preflight (`OPTIONS`) reflects
  the same allowlist.
- **Shared secret** (`x-ms-chat-key`). Required on `/api/chat` and
  `/api/contact`. *Honest caveat:* this secret is shipped to the
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

Streams a Claude response as an AI SDK UI-message stream over SSE.

### Required request headers

| Header          | Value                                                                  |
| --------------- | ---------------------------------------------------------------------- |
| `Content-Type`  | `application/json`                                                     |
| `x-ms-chat-key` | The shared secret from `CHAT_SHARED_SECRET`.                           |
| `x-ms-session`  | Client-generated stable session id (UUID stored in `localStorage`).    |

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
`result.toUIMessageStreamResponse({ headers: corsHeaders })`. Headers:

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Access-Control-Allow-Origin: https://www.motionsports.de
```

Each event is a JSON-encoded UI-message *part*. The widget must
maintain a current assistant message and append parts as they arrive,
matching on `part.type` and `part.toolCallId`.

#### Part types the widget must handle

**1. Text deltas.** The assistant prose, streamed token by token.

```jsonc
{ "type": "text", "text": "Ein leises Laufband für deine Wohnung — schau dir das hier an." }
```

Concatenate `text` chunks into the visible assistant bubble.

**Markdown subset to render:** bold (`**text**`) → `<strong>` and
inline links (`[label](url)`) → `<a href="url" target="_blank"
rel="noopener noreferrer">`. Nothing else (no headings, no code
blocks, no lists). This mirrors what the previous React widget
rendered with `renderTextWithFormatting`. The regex used there:

```js
/(\*\*(.+?)\*\*)|(\[([^\]]+)\]\(([^)]+)\))/g
```

**2. Tool parts the widget MUST render.** Each is keyed by
`type: "tool-<name>"`. The AI SDK may also stream intermediate states
of the same tool call with type prefixes like `"tool-<name>-partial"`
or `"tool-<name>-result"` — match with `startsWith` to be safe. Read
`input` (the tool arguments) once the part is past the partial state.
Use `toolCallId` as the React-style key so duplicate parts replace
each other rather than rendering twice.

Reference detection helper from the previous React widget (mirror this
in the vanilla-JS widget):

```js
function isToolPart(type, name) {
  return type === `tool-${name}` || type.startsWith(`tool-${name}`);
}
```

The five renderable tools, in order of arrival likelihood:

##### `show_product` → product card

Input schema:
```ts
{ productId: string; reason?: string }
```
Example part:
```json
{
  "type": "tool-show_product",
  "toolCallId": "call_abc123",
  "state": "result",
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
Example part:
```json
{
  "type": "tool-compare_products",
  "toolCallId": "call_def456",
  "state": "result",
  "input": {
    "productIds": ["atx-treadmill-pro-fold", "atx-treadmill-silent-x"],
    "comparisonContext": "Beide leise, aber unterschiedliche Laufflächen."
  }
}
```
Widget action: `GET /api/products?ids=a,b`, render a table with image
+ name as column headers and rows for price, key spec rows, and
`deliveryTime`. Show `comparisonContext` as a caption above the table.

##### `add_to_cart` → add-to-cart CTA

Input schema:
```ts
{ productId: string; message: string }
```
Example part:
```json
{
  "type": "tool-add_to_cart",
  "toolCallId": "call_ghi789",
  "state": "result",
  "input": {
    "productId": "atx-treadmill-pro-fold",
    "message": "Super Wahl — klappbar und leise für deine Wohnung."
  }
}
```
Widget action: `GET /api/products?id=…`, render a confirmation card
with `message` plus a button linking to `product.shopifyCartUrl`
(`target="_blank"`).

##### `suggest_showroom` → showroom suggestion

Input schema:
```ts
{ productIds: string[] }
```
Example part:
```json
{
  "type": "tool-suggest_showroom",
  "toolCallId": "call_jkl012",
  "state": "result",
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
Example part:
```json
{
  "type": "tool-show_contact_form",
  "toolCallId": "call_mno345",
  "state": "result",
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

#### Tool parts the widget MUST NOT render

These are background tools — skip them when their `type` matches:

- `tool-update_customer_profile` — updates the persona view; pure
  bookkeeping.
- `tool-search_products` — internal RAG; the assistant uses the
  result to decide which `show_product` / `compare_products` calls to
  make.

Both tools still appear in the stream and the widget must consume them
without rendering anything.

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
      "shopifyCartUrl": "https://motionsports.de/cart/add?id=MS-VP150-50-ATX-GB",
      "inStock": true,
      "deliveryTime": "Nach Verfügbarkeit"
    },
    null
  ]
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
  shopifyCartUrl: string;
  inStock: boolean;
  deliveryTime: string;
};

type ProductsResponse = { products: (PublicProduct | null)[] };
```

Unknown ids return as `null` at the matching index — never a 404 — so
the widget can render partial results without aborting.

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

## 5. Session lifecycle

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

The backend does NOT persist anything keyed off the session id. The
customer profile is reconstructed from `messages` on every turn, so
the widget is the only thing holding conversation state.
