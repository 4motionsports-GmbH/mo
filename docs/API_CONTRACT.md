# motion sports chat backend — API contract

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

#### Optional `context` — opening the chat "about" a product

When the widget is opened from a specific product page (e.g. a "Frage zu
diesem Produkt"/"Beratung" button on a product detail page), it MAY attach
an optional `context` object alongside `messages`:

```jsonc
{
  "messages": [],
  "context": {
    "type": "product",
    "productId": "atx-treadmill-pro-fold",
    "productTitle": "ATX Treadmill Pro Fold"   // optional, advisory only
  }
}
```

| Field          | Type     | Notes                                                              |
| -------------- | -------- | ----------------------------------------------------------------- |
| `type`         | string   | Must be `"product"`. Any other value is ignored.                  |
| `productId`    | string   | Catalog product id. Validated server-side (see below).            |
| `productTitle` | string?  | Optional/advisory. The backend uses the catalog's canonical name. |

**Validation.** `productId` is validated against the live catalog. If it is
missing, not a known product, or `type` is not `"product"`, the context is
**ignored gracefully** — the request behaves exactly as if no `context` was
sent (no error). This means a stale storefront link can never inject a bogus
product into the prompt.

The backend keys its behavior off whether `messages` is empty:

- **Fresh open (`messages: []` + valid `context`).** The backend seeds the
  model with a system-level note ("the user is viewing product '<title>'
  (id …) and chose to get advice about it — greet them warmly by the
  product's name and invite their questions; do not repeat the full spec
  unprompted"). The assistant then produces a **natural greeting as its
  first streamed message**. The widget does NOT need to send a user message
  to trigger this — it sends `messages: []` and renders the streamed
  assistant greeting like any other turn. No fake user message is fabricated
  in the history.

- **Existing conversation (`messages` non-empty + valid `context`).** The
  backend injects a lightweight in-conversation note ("Der Nutzer schaut
  sich gerade <title> an") so the assistant can **pivot toward the product
  without wiping the existing history**. The conversation continues
  normally; the widget keeps sending the full `messages` array each turn as
  usual.

In both cases the **response is the same SSE UI-message stream** documented
below — `context` only seeds the model, it does not change the response
shape. The widget parses the stream identically whether or not `context`
was sent.

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

The renderable tools, in order of arrival likelihood:

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

Single-product example part (backward compatible):
```json
{
  "type": "tool-add_to_cart",
  "toolCallId": "call_ghi789",
  "state": "result",
  "input": {
    "productId": "atx-treadmill-pro-fold",
    "message": "Wenn das für dich passt, kannst du es hier direkt bestellen."
  }
}
```

Multi-product example part:
```json
{
  "type": "tool-add_to_cart",
  "toolCallId": "call_ghi790",
  "state": "result",
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

##### `offer_email_summary` → email-capture form

The assistant calls this **once**, at a natural point after it has given solid
recommendations, to offer emailing a summary of the chat + a prefilled cart. The
widget turns the tool call into the **GDPR email-capture form** (see §7).

Input schema:
```ts
{ message: string; productIds?: string[] }   // productIds advisory only
```
Example part:
```json
{
  "type": "tool-offer_email_summary",
  "toolCallId": "call_pqr678",
  "state": "result",
  "input": {
    "message": "Wenn du magst, schicke ich dir die Zusammenfassung mit deinem Warenkorb per E-Mail.",
    "productIds": ["atx-treadmill-pro-fold"]
  }
}
```
Widget action: render `message` as the intro, then the capture form with:

- an **email** input,
- a **transactional** consent checkbox (required to submit) — label from
  `TRANSACTIONAL_CHECKBOX_LABEL`,
- a **separate, unchecked-by-default** marketing consent checkbox — label from
  `MARKETING_CHECKBOX_LABEL`.

On submit, POST to `/api/capture-email` (§7) with the two booleans and the exact
consent text strings shown (`consentTextShown`). The marketing box MUST start
unchecked and MUST be visually independent of the transactional one — never one
combined checkbox. `productIds` is advisory (cart preview); the backend
determines the real products server-side from the conversation.

> ⚠️ The checkbox labels are PLACEHOLDER copy pending lawyer approval — see
> [`CONSENT_FLOW.md`](./CONSENT_FLOW.md).

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
  "marketingConsent": false,       // separate, defaults unchecked in the UI
  "consentTextShown": "Ja, sendet mir … | Ja, motion sports darf …"  // exact labels shown (audit)
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
- `consentTextShown` is stored verbatim as Art. 7 proof. Send the exact label
  strings the user saw (both boxes).

#### Behaviour

1. Upserts one consent record per email (records `consentTextShown`).
2. **Transactional:** sends the summary email immediately (German summary of the
   conversation + a prefilled-cart permalink for the discussed products, **no
   discount**).
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

### 7.4 New environment variables

| Var                       | Purpose                                                              |
| ------------------------- | -------------------------------------------------------------------- |
| `PUBLIC_BASE_URL`         | Absolute base for email links (falls back to Vercel host / origin).  |
| `MARKETING_DOI_EXPIRY_DAYS` | DOI token validity window (default 7).                             |
| `UNSUBSCRIBE_SECRET`      | HMAC secret for unsubscribe tokens (falls back to `CHAT_SHARED_SECRET`). |
| `CONTACT_FROM_EMAIL`      | Reused as the sender for summary + DOI emails.                       |
