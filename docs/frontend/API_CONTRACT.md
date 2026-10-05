# motion sports chat backend — widget API contract

The storefront widget (theme repo `ms_shopify_clone`, `assets/ms-chat-widget.js`) talks to this
backend through three contract files in `docs/frontend/`. Together they are the widget contract;
nothing else is:

| File | Owns |
| --- | --- |
| **this file** | §0 the rules for every widget change; the wire shapes (request, response, errors, headers, guards, rate-limit buckets) of every widget-facing endpoint except `/api/auth/*` and `/api/account/*`; the KPI event names, `data` keys and the server-only list (§5); locale (§12) |
| [`ACCOUNT_CONTRACT.md`](./ACCOUNT_CONTRACT.md) | wire shapes **and** widget behaviour of `/api/auth/*` (login, callback, link, me, logout, App Proxy whoami) and `/api/account/*` (conversations, summary, export, erase, marketing-opt-in), including the gating of the post-sign-in opt-in (§6.1) |
| [`CONSENT_CONTRACT.md`](./CONSENT_CONTRACT.md) | when and how the widget shows and renders the consent surfaces (golden rules, per surface); it links here for JSON shapes |

If anything here disagrees with the code, the code wins — open an issue and one of the two gets
fixed. Backend internals, legal rationale and operator how-to live in the backend docs
(`docs/*.md`); this file names them only where a backend agent needs the pointer. What is switched
on in production is not part of the contract: switches are given with their default in code, and
the production state is tracked only in `docs/ROLLOUT_TODO.md` (backend). Dated changes since
2026-10-01: Appendix A.

---

## 0. Rules for every widget change

Every widget change keeps all of these. They are referenced as "§0 rule n".

1. **Form factor:** one Liquid snippet plus `assets/ms-chat-widget.js` (and its CSS), ES5, one file, no build step, no framework, no CDN or runtime dependency; every class under the `ms-chat` prefix; the widget never renders on `/cart` or `/checkout`.
2. **Delivery:** every change ships with a MANIFEST entry and the list of files to upload and shared theme files to hand-edit (the owner uploads by hand).
3. **Contract changes are additive:** new fields are optional, the widget keeps working against an older backend and the backend against an older widget (the widget sends no version header); new backend behaviour stays behind a switch until the widget is live ("no-op if the widget ships later").
4. **No new request header:** the CORS allow-list is exactly `Content-Type, x-ms-chat-key, x-ms-session, x-ms-locale` (`src/lib/security.ts`); new data travels in the JSON body or the query.
5. **The shared secret is not authentication:** it is visible in the page and works only together with the origin allow-list and the rate limits (§1 "Security model"); deploy only on allow-listed origins and never pretend to hide the key.
6. **One session id everywhere:** `x-ms-session` = KPI `sessionId` = `?session=` on sign-in, logout, whoami and `/api/auth/me`; never rotated around a sign-in or while signed in (§6, ACCOUNT_CONTRACT.md §1).
7. **The raw session id never goes into a cart attribute, a cart permalink or any shop URL;** attribution uses only the server-minted `cartAttributes`, and only with Shopify analytics consent (§10).
8. **Consent and legal copy comes only from the backend** (§7.4, the `offer_email_summary` output), rendered verbatim with `textContent`, never hard-coded or translated by the widget; `consentTextShown` is echoed byte for byte (CONSENT_CONTRACT.md §1).
9. **Nothing pre-selected, decline as easy to reach as accept,** `marketingConsent: true` only from an explicit user act (CONSENT_CONTRACT.md §1).
10. **Fail closed on legal copy:** no valid served copy means no consent UI, silently. Valid = the surface's labels (`marketingLabel`; the capture form also `transactionalLabel`) and `consentTextShown` are present; the signed-in surfaces (popup, inline card) also require `lawyerApproved === true`. The capture form's copy carries `lawyerApproved` too — checking it there is recommended, not required.
11. **Served framing vs widget chrome:** the consent popup's and card's headline and benefit bullets are served (`headline`, `benefits`, §7.4) — the widget adds no consent-surface text of its own beyond button captions and status lines; the sign-in popup is UI, not consent, so its text may live in the widget.
12. **Tiers are additive:** anonymous and e-mail-only behaviour stays unchanged when signed-in features change; a signed-in customer never gets the typed-e-mail capture form except as the `422 no_verified_email` fallback (ACCOUNT_CONTRACT.md §6.0, §6.2).
13. **KPI payloads carry ids, enums and booleans only** — never message text, transcripts, names, e-mails, product names, the browsing trail, URLs, tokens or codes (§5).
14. **Never send a server-only event** (§5: the server table and the four server-side e-mail-capture funnel events); `/api/kpi` acknowledges and drops them.
15. **KPI names:** never rename an event the backend reads by name (§5); name new events with the dashboard's patterns in mind (`%cart%`, `%checkout%` count as add-to-cart clicks, `%product%click%`, `%cta%click%` as product clicks).
16. **Unknown tools render nothing; silent tools render nothing but stay in the history and are replayed** with their outputs (§2).
17. **Markdown safety:** assistant text is built as DOM (`createElement` / `textContent`), never `innerHTML` of model text; links only `http:`, `https:`, `mailto:` (§2 "Rendering assistant text").
18. **Fail silent extras, fail closed identity:** telemetry, attribution, cart sync, whoami, deep link and campaign token never block the chat or surface an error; an auth error means "not signed in".
19. **Privacy posture:** page facts and the browsing trail are gathered in the browser and leave it only inside a `/api/chat` request the user starts (CTA, nudge, a typed or spoken message) — never in a background call, never as a per-turn heartbeat (§2 "Optional `context`").
20. **`customer.email`** is attached only after a successful capture in the current chat session and kept in memory only (§2 "Optional `customer`").
21. **The campaign token stays session-less:** read from `mo_c`, kept in sessionStorage, sent once as `campaignToken`; never in KPI, localStorage, cookies or logs (§2 "Optional `campaignToken`").
22. **Tone:** proactive copy references the page or category, never the visitor's behaviour; the nudge never asks for an e-mail.
23. **Sign-in is a top-level redirect** (no popup window, no XHR login) and counts only after the one-time code was redeemed (ACCOUNT_CONTRACT.md §2, §2a).
24. **Shared limits move together:** 40 messages per `/api/chat` request, 10 ids per `/api/products`, trail ≤ 3 products + 2 categories, campaign token `^[A-Za-z0-9_-]{16,64}$`, one-time code 10 min, `benefits` 1–4 strings of ≤ 200 chars, 20 Q&A entries per product (`QA_MAX_PER_PRODUCT` vs the PDP snippet's `limit: 20`), TTS chunking mirrors `splitIntoTtsChunks()` (§8).
25. **Theme ownership:** `custom.*` metafields belong to merchandising except `custom.qa` (written by the backend; its `a_html` is pre-sanitised by the backend and output raw on the PDP); theme settings and editor-owned templates (e.g. the „MO only“ CTA block) are changed in the theme editor, not in code.

---

## 1. Overview

**Base URL (production):** `https://mo.motionsports.de` (read it from the snippet config).

### Endpoints

Every endpoint the widget can reach, once. **Guard:** `secret` = origin allow-list + `x-ms-chat-key`
(`guardRequest`; a request without `Origin` skips the origin check but still needs the key);
`origin` = origin allow-list only (`guardOriginOnly`); `signed-in` = `secret` + a live sign-in of the
session (`requireSignedInCustomer`); `nav` = top-level navigation, no CORS and no secret, protected by
a signed `state` and an allow-listed `return_url`; `proxy` = Shopify App Proxy HMAC signature,
fresh within 300 s. **Bucket:** see "Rate limits" below.

**Widget XHRs**

| Method | Path | Guard | Bucket | Shape |
| --- | --- | --- | --- | --- |
| POST | `/api/chat` | secret | `chat` | §2 |
| GET | `/api/products` | origin | `products` | §3 |
| POST | `/api/contact` | secret | `chat` + `contact-ip` | §4 |
| POST | `/api/kpi` | origin | `kpi` | §5 |
| POST | `/api/capture-email` | secret | `chat` + `capture-recipient` | §7.1 |
| GET | `/api/consent-copy` | origin | `products` | §7.4 |
| POST | `/api/chat-marketing-opt-in` — not used by the widget since 2026-10-01, served for compatibility | secret | `chat` + `capture-recipient` | §7.6 |
| POST | `/api/tts` | secret | `tts` / `tts-stream` | §8 |
| POST | `/api/feedback` | secret | `feedback` | §9 |
| POST | `/api/attribution/token` | secret | `kpi` | §10 |
| POST | `/api/auth/link` | secret | `chat` | [ACCOUNT_CONTRACT.md §2a](./ACCOUNT_CONTRACT.md) |
| GET | `/api/auth/me` | secret | `chat` | ACCOUNT_CONTRACT.md §4 |
| GET | `/api/account/conversations` | signed-in | `chat` | ACCOUNT_CONTRACT.md §7.1 |
| GET / PATCH / DELETE | `/api/account/conversations/{id}` | signed-in | `chat` | ACCOUNT_CONTRACT.md §7.2–§7.4 |
| POST | `/api/account/erase` | signed-in | `chat` | ACCOUNT_CONTRACT.md §7.5 |
| GET | `/api/account/export` | signed-in | `chat` | ACCOUNT_CONTRACT.md §7.7 |
| GET | `/api/account/summary` | signed-in | `chat` | ACCOUNT_CONTRACT.md §8 |
| POST | `/api/account/marketing-opt-in` | signed-in | `chat` | ACCOUNT_CONTRACT.md §6.2 |

**Top-level navigations and the App Proxy**

| Method | Path | Guard | Shape |
| --- | --- | --- | --- |
| GET | `/api/auth/shopify/login` | nav | ACCOUNT_CONTRACT.md §2 |
| GET | `/api/auth/shopify/callback` — Shopify redirects the browser here; the widget never calls it | nav | ACCOUNT_CONTRACT.md §2, §2a |
| GET | `/api/auth/shopify/logout` | nav | ACCOUNT_CONTRACT.md §5 |
| GET | `/api/auth/shopify/logout/return` — Shopify redirects here after logout | nav | ACCOUNT_CONTRACT.md §5 |
| GET | storefront `/apps/{proxy}/whoami` (same origin) → `/api/auth/storefront/whoami`; `/api/auth/storefront` answers identically | proxy (`chat` bucket, keyed by its `?session=`) | ACCOUNT_CONTRACT.md §3a |

**Not called by the widget.** Mail links (top-level navigations from e-mails, HTML or redirect, no
CORS and no secret — a mail client sends no `Origin` and no custom header; protected by unguessable
or signed tokens): `GET /api/confirm-marketing` (§7.2), `GET /api/unsubscribe` (§7.3),
`GET/POST /api/erase-data` (§11.1), `GET /api/r/{token}` (§11.2), `GET /api/newsletter-rating`,
`GET /api/email-countdown/{token}`, `GET /api/email-hero-image/{file}`. Server to server (provider
signature over the raw body): `POST /api/webhooks/shopify` (§11.3), `POST /api/webhooks/resend`,
`POST /api/webhooks/pingen`, `POST /api/inbound/resend`.

### Security model

A defense-in-depth combination, since the widget runs on a public storefront:

- **Origin allowlist.** Cross-origin requests are accepted only from origins in `ALLOWED_ORIGINS`
  (default: `https://www.motionsports.de`, `https://motionsports.de`). The CORS preflight
  (`OPTIONS`) reflects the same allowlist, allows the headers `Content-Type, x-ms-chat-key,
  x-ms-session, x-ms-locale`, exposes `Retry-After` (plus the three `X-MS-TTS-*` headers on
  `/api/tts`) and is cached for 24 h (`Access-Control-Max-Age: 86400`). If the storefront origin
  changes, `ALLOWED_ORIGINS` must change in the same step or every call answers `403 forbidden`.
- **Shared secret** (`x-ms-chat-key`) on every `secret` and `signed-in` endpoint of the table above.
  *Honest caveat:* the secret is shipped to the storefront, so anyone can read it from the browser.
  It is not authentication — combined with the origin allowlist and the rate limits, a scraper has to
  forge the origin **and** know the secret **and** distribute IPs. The `origin` endpoints
  (`/api/products`, `/api/kpi`, `/api/consent-copy`) do not require it; they expose only
  storefront-visible data or accept only pseudonymous telemetry.
- **Rate limits** per bucket (below).
- **Caps.** At most 40 messages per `/api/chat` request (§2). The provider-side monthly spend caps
  are an operator setting, not code.

### Rate limits

Upstash sliding window. Session buckets are keyed by `x-ms-session` (`sid:<id>`), else the client IP.
Every `429` carries `Retry-After` (seconds) and the error envelope below.

| Bucket | Limit | Key | Endpoints |
| --- | --- | --- | --- |
| `chat` | 20 / 60 s | session | `/api/chat`, `/api/contact`, `/api/capture-email`, `/api/chat-marketing-opt-in`, `/api/auth/link`, `/api/auth/me`, every `/api/account/*`, App Proxy whoami — so `/api/auth/me` polling uses chat quota |
| `products` | 60 / 60 s | session | `/api/products`, `/api/consent-copy` |
| `kpi` | 120 / 60 s | session | `/api/kpi`, `/api/attribution/token` |
| `tts` | 20 / 5 min | session | `/api/tts` single-shot |
| `tts-stream` | 120 / 5 min | session | `/api/tts` with `stream: true` |
| `feedback` | 5 / 5 min | session | `/api/feedback` |
| `contact-ip` | 8 / 60 min | client IP | `/api/contact` (in addition to `chat`) |
| `capture-recipient` | 3 / 60 min | the e-mail address | `/api/capture-email` and `/api/chat-marketing-opt-in` together (in addition to `chat`) |

### Error envelope

Every non-streaming JSON error uses the same shape:

```json
{ "error": { "code": "rate_limited", "message": "Too many requests" } }
```

The `code` vocabulary is closed and stable (`ErrorCode`, `src/lib/observability.ts`). Which code an
endpoint answers with which status is listed in its section.

| `code` | Status | Meaning |
| --- | --- | --- |
| `bad_request` | 400 (404 on `/api/account/conversations/{id}` and `/api/account/summary` for a conversation that does not exist or is not the customer's) | Invalid JSON, a missing or invalid field (incl. an invalid e-mail on `/api/capture-email`) |
| `unauthorized` | 401 | Missing or wrong `x-ms-chat-key`; on `signed-in` endpoints also no live sign-in (message „Nicht angemeldet“ or „Sitzung abgelaufen“) |
| `forbidden` | 403 | Origin not in the allowlist (the answer carries no CORS headers, so a browser reports a network error) |
| `not_found` | 404 | `/api/account/marketing-opt-in`: the customer row does not exist |
| `rate_limited` | 429 | Bucket exhausted; `Retry-After` set |
| `payload_too_large` | 400 (`/api/chat`, `/api/products`), 413 (`/api/feedback`) | Over a size cap |
| `transactional_consent_required` | 400 | `/api/capture-email` without the transactional tick |
| `marketing_consent_required` | 400 | `/api/chat-marketing-opt-in`, `/api/account/marketing-opt-in` without `marketingConsent: true` |
| `invalid_email` | 400 | `/api/chat-marketing-opt-in` |
| `no_verified_email` | 422 | `/api/account/marketing-opt-in`: the customer has no usable address (widget fallback: CONSENT_CONTRACT.md §3.2) |
| `upstream_unavailable` | 502 / 503 | A provider failed (mail, TTS: 502) or nothing could be stored (no database: 503) |
| `internal_error` | 500 | Anything else |

The `message` is user-safe and never leaks internals; routes with user-facing messages answer in the
request's locale (§12), a few technical messages are English in both.

---

## 2. `POST /api/chat`

Streams a Claude response over SSE as AI SDK **stream chunks** (the AI SDK UI-message stream
protocol, `x-vercel-ai-ui-message-stream: v1`).

### Required request headers

| Header          | Value                                                                  |
| --------------- | ---------------------------------------------------------------------- |
| `Content-Type`  | `application/json`                                                     |
| `x-ms-chat-key` | The shared secret from `CHAT_SHARED_SECRET`.                           |
| `x-ms-session`  | Client-generated stable session id (UUID stored in `localStorage`, §6). |
| `x-ms-locale`   | Optional, `de` / `en` (§12).                                          |

> **Note on `x-ms-session`:** the widget must always send it, but the server does **not** enforce
> its presence — a request without it is not rejected. When present it keys the rate-limit bucket
> (`sid:<id>`), the conversation persistence, the sign-in link and the same-session checks (§6);
> when absent, rate limiting falls back to the caller's IP and conversation persistence is skipped.
> "Required" here is a widget instruction, not a server-side guard.

Plus the browser-set `Origin` header, which must be one of `ALLOWED_ORIGINS`. The CORS preflight
advertises `POST, OPTIONS` and `Content-Type, x-ms-chat-key, x-ms-session, x-ms-locale`.

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
  ],
  "conversationKey": "c3f1e8a2-…",   // optional, below
  "locale": "de"                       // optional, §12
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `messages` | `UIMessage[]` | Required, the **entire** conversation of this thread on every turn (≤ 40, below). |
| `conversationKey` | string? | Which thread the turn belongs to (below). |
| `context` | object? | Product page / browsing trail / page facts (below). |
| `customer` | `{ email }`? | Returning-customer memory after an in-session capture (below). |
| `campaignToken` | string? | The `mo_c` value of a campaign mail link (below). |
| `locale` | `"de"` \| `"en"`? | Mo's language, tool copy, notes and greeting; precedence and normalisation in §12. |

**Replay the history as it streamed.** The route rebuilds per-conversation state from the history
on every turn: the customer profile is a pure function of the replayed `update_customer_profile`
tool parts, and the two-ask cap of `offer_email_summary` counts the replayed parts of that tool. So
assistant messages carry their **tool parts** — visible and silent — next to the text, in the AI SDK
part shape:

```jsonc
{ "type": "tool-<name>", "toolCallId": "call_x", "state": "output-available", "input": { … }, "output": { … } }
```

The server drops tool parts it cannot replay (state `input-streaming` / `input-available`, or an
`input` that is not a plain object) and replaces a replayed `get_order_status` output with
`{ replayed: true }`; messages are never dropped. A tool part the widget did not recognise may be
left out of the history.

#### Optional `conversationKey` — multiple threads under one stable `session_id`

`session_id` is the identity link (must not rotate while signed in, §6), so it is not the *thread*
key. The widget MAY send a **`conversationKey`** (a stable, client-generated per-thread string,
≤ 200 chars) to address WHICH conversation a turn belongs to:

- **New chat / „Neue Beratung“** → a **fresh** key (new conversation row / history entry);
  **continuing** → the **same** key; **resuming a past thread** → the `conversationKey` returned by
  `GET /api/account/conversations`.
- **Omitted** → defaults to `session_id` server-side (legacy one-thread-per-session; fully
  backward-compatible).
- Distinct from the numeric `conversationId` used by `/api/account/conversations/{id}`. Same
  trust/entropy expectation as `session_id`. The signed-in thread flow: ACCOUNT_CONTRACT.md §7.6.

#### Optional `context` — opening the chat "about" a product and/or with a browsing trail

When the widget is opened from a specific product page (e.g. a „Frage zu diesem Produkt“/„Beratung“
button on a product detail page) and/or with a small in-browser browsing trail (recently viewed
products/categories), it MAY attach an optional `context` object alongside `messages`:

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
    ],
    "source": "cta"                              // optional: "page" | "cta" | "nudge"
  }
}
```

| Field            | Type     | Notes                                                              |
| ---------------- | -------- | ----------------------------------------------------------------- |
| `type`           | string   | `"product"` (single-product open, may also carry a trail) or `"browsing"` (trail only). Any other value → whole context ignored. |
| `productId`      | string   | Catalog product id (the product handle; `type: "product"` only). Validated server-side. |
| `productTitle`   | string?  | Optional/advisory. The backend uses the catalog's canonical name. |
| `recentlyViewed` | array?   | Small browsing trail, most recent first. Entries: `{ type: "product", id, name }` or `{ type: "category", id?, name }`. |
| `source`         | string?  | `"page"` = the widget attached the open page's facts to a **typed or spoken** message; `"cta"` = the product CTA; `"nudge"` = a nudge click. Absent or any other value → treated like `cta` / `nudge`. |

**Privacy.** The browsing trail is gathered **in the browser** and only ever reaches the backend as
part of a chat request the **user initiates** (opening the chat / sending a message) — it is
conversation input, not background tracking. Like the single-product context, it shapes the live
conversation and is never stored as a tracking profile. Don't send it on every turn: attach it when
the chat is opened (CTA, nudge) or with the first typed message of a thread on a product page
(`source: "page"`, below), and when it meaningfully changed — not as a per-turn heartbeat (§0 rule 19).

**Typed turns (`source: "page"`).** Page facts only — the open product page's product, or the
single category of a collection page; never the browsing trail. Send it with the first user message
of a thread on that page and with the first message after the page's product changed. The backend
accepts exactly two shapes and drops any other `source: "page"` context: `type: "product"` (any
`recentlyViewed` is ignored) and `type: "browsing"` with exactly **one** `{ type: "category", name }`
entry. A `source: "page"` context without a user message is ignored. The backend may ignore a
`source: "page"` context — while it is switched off (`CHAT_PAGE_CONTEXT_ENABLED`, default off in
code) or for a configured share of sessions kept as a control group
(`CHAT_PAGE_CONTEXT_HOLDOUT_PCT`, 0–50, default 0, product pages only); the response shape is the
same in every case, and the widget must not try to detect either. A `cta` / `nudge` context is never
affected. A widget that sends no `source` keeps the CTA/nudge behaviour byte for byte; an older
backend ignores `source` and treats a typed turn's product like a CTA context.

**Validation & caps.** Everything is validated against the live catalog and **ignored gracefully**
on mismatch (no error; the request behaves as if that part of the context was never sent):

- `productId` must be a known catalog product.
- Trail **products** are validated by `id`; unknown ids are dropped and the catalog's canonical name
  wins over the client-supplied `name`.
- Trail **categories** are matched by `name` against the catalog (tolerant of German storefront
  labels, e.g. „Laufbänder“ matches the treadmill range); labels that don't correspond to anything in
  the catalog are dropped. The category `id` (e.g. a collection handle) is accepted but advisory.
- The trail is capped server-side at the **3 most recent valid products and 2 categories** (at most
  the first 20 entries are even scanned), so send a short, most-recent-first list.

The backend keys its behavior off whether `messages` is empty:

- **Fresh open (`messages: []` + valid `context`).** The backend seeds the model with a system-level
  note and the assistant produces a **natural, context-aware greeting as its first streamed
  message**:
  - With a product context — greet by the product's name and invite questions.
  - With (only) a browsing trail — greet by helpfully picking up the single most relevant
    item/category („Du hast dir ein paar Laufbänder angeschaut — soll ich beim Vergleich helfen?“).
    The prompt forbids creepy phrasing: the assistant talks about the products/categories, never
    about the observing, and never recites the whole trail.
  - With **both**, the product-page greeting wins and the trail becomes background knowledge for
    the consultation.

  The widget does NOT need to send a user message to trigger this — it sends `messages: []` and
  renders the streamed assistant greeting like any other turn. No fake user message is fabricated
  in the history.

  A fresh open whose context does not survive validation (or that carries no `context` at all) is
  NOT an error: the backend still streams a generic greeting.

- **Existing conversation (`messages` non-empty + valid `context`).** The backend injects lightweight
  in-conversation notes (product pivot and/or browsing note) so the assistant can **pivot toward the
  context without wiping the existing history**. The widget keeps sending the full `messages` array
  each turn as usual.

  This is also the path a **typed first message on a product page** takes (`source: "page"`):
  „Ist das leise?“ sent with the page's product makes the answer specific to that product — the
  backend grounds it in the model's pre-retrieved product block (specs + stock status), so sold-out
  and checkout rules apply from the first answer. A `source: "page"` turn gets a softer note than a
  CTA (the page is a hint: used when the question is about a product and names no other, ignored for
  orders, shipping or returns, never commented on).

In both cases the **response is the same SSE chunk stream** documented below — `context` only seeds
the model, it does not change the response shape.

#### Optional `customer` — returning-customer memory after in-session re-identification

After a **successful `POST /api/capture-email` in the current chat session** (§7.1), the widget MAY
attach the captured email to every subsequent `/api/chat` request of that session:

```jsonc
{
  "messages": [ /* full history as usual */ ],
  "customer": { "email": "max@example.de" }
}
```

When that email matches an **existing customer with history** (prior linked conversations, a
generated "current understanding" summary, and/or purchases — Mo's copy of the person's Shopify
orders, else the cached purchase history), the backend injects a compact memory block into the system
prompt so the assistant can consult like someone who remembers a returning client — acknowledge the
return lightly, skip products they already own, tailor to their known profile. The response shape is
unchanged; memory only seeds the model. Attaching it also ends the e-mail summary offer for the
conversation (the address is in).

**Privacy gate (the rules the widget MUST follow).** A returning customer opens a new chat as
**anonymous** — we do not know who they are until they give their email in *this* conversation.
Therefore:

- Attach `customer.email` **only after** `/api/capture-email` succeeded **in the current chat
  session**, and keep that state **in memory only**. Never persist it to `localStorage`/cookies and
  never auto-attach it on a fresh widget open — a shared/family/public browser must not surface
  another person's history.
- The backend enforces this independently: it injects memory only when the email's consent record
  was verifiably captured **from the same `x-ms-session`** as the chat request. A forged or replayed
  `customer.email` resolves to no memory — **ignored gracefully**, exactly like an invalid `context`
  (no error).
- A **new email** (no existing customer history) also resolves to no memory: the request behaves
  exactly as if `customer` was never sent.
- For an e-mail-identified (tier 2) visitor the session id alone never unlocks memory; the match is
  strictly by the email the user just provided in this session. A **signed-in** (tier 3) session is
  the exception: its live sign-in is the re-identification, so the greeting by name and the memory
  (consent permitting) come from the session itself, without a `customer` field
  (ACCOUNT_CONTRACT.md §4).

#### Optional `campaignToken` — a chat opened from a campaign mail („Chat-Start“)

A click on the Mo button of a campaign e-mail goes through the tracked redirect (§11.2), which lands on
the storefront's Mo deep link with the send's token appended as **`mo_c=<token>`**. The widget MAY send
that value back:

```jsonc
{
  "messages": [ /* first turn of the session the link opened */ ],
  "campaignToken": "Hk3f9QWm2xVbT0aLr7c1sYpNeD5uZ8gJ"   // the `mo_c` query value, verbatim
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `campaignToken` | string? | The `mo_c` value from the landing URL. Read it **before** the theme strips the `mo*` parameters and send it with the **first** `/api/chat` request of the session that link opened; sending it again on later turns is harmless. Session-less handling: §0 rule 21. |

- **Server side:** the value must match `/^[A-Za-z0-9_-]{16,64}$/` (real tokens are 32 base64url
  characters). A known token is recorded **once per campaign send** as the session-less server event
  `campaign_chat_started` (§5); the chat's `x-ms-session` is never stored with it, so the pseudonymous
  chat is not tied to the recipient. A test send („Prüfen & testen“) is recorded too, flagged as a test.
- **Ignored gracefully:** a missing, malformed, unknown or already-recorded token changes nothing —
  **no error**, no different response. The recording is best-effort and never fails the stream.
- Only campaign mails whose button leads to Mo carry `mo_c`; a shop-button campaign redirects to the
  shop without it.

**40-message cap.** The cap is per request — the history of one thread. If `messages.length > 40` the
route returns:

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

The widget surfaces this as "start a new chat": a new thread (fresh `conversationKey`, empty
`messages`), with the session id rules of §6.

### Response — SSE stream

The route returns the result of `result.toUIMessageStreamResponse(...)`. Headers:

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
x-vercel-ai-ui-message-stream: v1
Cache-Control: no-cache, no-transform
X-Accel-Buffering: no
Access-Control-Allow-Origin: https://www.motionsports.de
```

`Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` keep caches and nginx-style
proxies from buffering or re-chunking the stream; `x-vercel-ai-ui-message-stream: v1` identifies the
stream protocol version and is a useful client-side sanity check.

The body is SSE: lines of `data: <JSON>`, separated by blank lines, terminated by a literal
`data: [DONE]`. Parse with `fetch` + `response.body.getReader()` + `TextDecoder`, buffering by line
(do **not** use `EventSource` — it can't send a POST body or custom headers).

**Each `data:` line is a JSON-encoded AI SDK *stream chunk*** (the `UIMessageChunk` vocabulary of the
pinned `ai@6`), **not** an assembled UI-message part. Assembled parts (`{ "type": "text", … }`,
`{ "type": "tool-<name>", "state": …, … }`) are built *client-side out of* these chunks — they never
appear on the wire. A widget that parses the stream itself must assemble the chunks into the current
assistant message.

A complete turn (one text bubble + one `show_product` call) looks like:

```
data: {"type":"start"}
data: {"type":"start-step"}
data: {"type":"text-start","id":"t1"}
data: {"type":"text-delta","id":"t1","delta":"Hallo "}
data: {"type":"text-delta","id":"t1","delta":"Welt."}
data: {"type":"text-end","id":"t1"}
data: {"type":"tool-input-start","toolCallId":"call_1","toolName":"show_product"}
data: {"type":"tool-input-delta","toolCallId":"call_1","inputTextDelta":"{\"productId\":\"abc\"}"}
data: {"type":"tool-input-available","toolCallId":"call_1","toolName":"show_product","input":{"productId":"abc","reason":"leise"}}
data: {"type":"tool-output-available","toolCallId":"call_1","output":{"ok":true}}
data: {"type":"finish-step"}
data: {"type":"finish","finishReason":"stop"}
data: [DONE]
```

#### Chunk vocabulary

| `type` | Payload fields | Widget action |
| --- | --- | --- |
| `start` | (`messageId`, `messageMetadata` may appear) | begin a new assistant message |
| `start-step` / `finish-step` | — | ignore (the model can run up to **6 steps** per turn, +1 when the backend appends the checkout-moment e-mail-offer step) |
| `text-start` | `id` | open a text part keyed by `id` |
| `text-delta` | `id`, `delta` | **append** `delta` to that text part's bubble |
| `text-end` | `id` | text part complete |
| `tool-input-start` | `toolCallId`, `toolName` | open a tool part keyed by `toolCallId` (render nothing yet) |
| `tool-input-delta` | `toolCallId`, `inputTextDelta` | streaming JSON of the args; safe to ignore |
| `tool-input-available` | `toolCallId`, `toolName`, `input` | args complete → **render the card now** (dispatch on `toolName`, read `input`) |
| `tool-output-available` | `toolCallId`, `output` | tool result → for `offer_email_summary` this carries the load-bearing `output.consentCopy`; `search_products` and `get_order_status` return data for the model only (see "Tools the widget MUST NOT render"); the other tools return `{ ok: true }` |
| `error` | `errorText` | show the friendly retry message |
| `finish` | `finishReason` (`messageMetadata` may appear) | finalize the message, re-enable input |
| `[DONE]` (literal, not JSON) | — | stream end |

Assembly rules:

- `toolName` is the **bare** tool name (`show_product`), never `tool-show_product` and never a
  suffixed variant. Client-side the part type becomes `tool-${toolName}` and its `state` progresses
  `input-streaming → input-available → output-available` (an erroring tool yields `output-error`).
  There is no `"partial"` or `"result"` state and no `tool-<name>-partial` / `tool-<name>-result` type.
  Match tool names exactly.
- Key tool cards by `toolCallId` and update **in place**: render the card once
  `tool-input-available` delivers `input`, and merge the later `tool-output-available` into the same
  card. A duplicated or re-emitted chunk for a known `toolCallId` must replace, never append a second
  card.
- Ignore unknown chunk types (e.g. `abort`, `tool-output-error`) and unknown payload fields
  defensively — the vocabulary can grow with SDK upgrades. The backend sends no `reasoning-*` chunks.
- **A tool part whose `toolName` the widget does not know → render nothing** (no card, no
  placeholder, no error), and consume its chunks silently. New background tools are added this way
  without a widget release.
- The route's `maxDuration` is 300 s — a long consultation can stream for minutes; don't impose a
  short client-side timeout.

#### Rendering assistant text

Concatenate the `text-delta` chunks of each text part (keyed by `id`) into the visible assistant
bubble.

**Markdown the widget must render, at minimum:** paragraphs and line breaks (a newline is a break),
`**bold**`, inline links `[label](url)` (opened with `target="_blank" rel="noopener noreferrer"`),
and flat `-` / `1.` lists. The prompts keep answers to short paragraphs but allow bullet lists where
needed, and the assistant writes links (e.g. the customer's orders page). Rendering more (italic,
inline code, headings, quotes, code fences) is the widget's choice; syntax it does not support stays
literal text — never HTML.

**Security** (§0 rule 17): matched URLs come from model output, so treat them as untrusted. Build
the DOM with `createElement` / `textContent` (never `innerHTML` of model text), and set `href` only
for `http:`, `https:` or `mailto:` — any other scheme (`javascript:`, `data:` …) renders the construct
as literal text.

#### Tools the widget MUST render

Dispatch on the `toolName` of each `tool-input-available` chunk and render the matching card from its
`input`, keyed by `toolCallId`. How each card looks is the widget's choice within §0.

**Which products get a card (card-selection contract).** Product cards come **only** from the
assistant's tool calls, in stream order — never from the backend's retrieval set, which stays in the
server prompt and is never streamed. `show_product` is the assistant's **explicit, ordered
recommendation**: one call per product it recommends in its text, in recommendation order. Products it
only mentions, compares against or rejects get no `show_product` card (comparisons go through
`compare_products`). The prompt allows only real, available catalog ids; the backend reports an
unknown or sold-out recommendation as a prompt regression but does **not** filter the stream, so the
widget's guards stay the enforcement: an id that hydrates to `null` renders nothing, and a sold-out
product never gets a checkout link (§3).

Product ids in tool inputs are catalog ids (product handles) or **variant refs**
`handle~<numericVariantId>`; pass them to `GET /api/products` unchanged (§3 "Product variants").

##### `show_product` → product card

Input schema:
```ts
{ productId: string; reason?: string }
```
- `productId` — catalog id or variant ref.
- `reason` — optional, one short sentence in the conversation's language on why the product fits.

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
Output: `{ ok: true }`. Widget action: hydrate with `GET /api/products?ids=<productId>` (§3) and render
a product card from the returned `PublicProduct` — which fields it shows and whether it shows `reason`
is the widget's choice. It should link the product page (`shopifyUrl`) and mark a sold-out product
(`inStock: false`); an id that hydrates to `null` renders nothing.

##### `compare_products` → comparison

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
Output: `{ ok: true }`. Widget action: `GET /api/products?ids=a,b`, render a side-by-side comparison of
the resolved products (e.g. image + name per column, rows for price, key `specifications` and
`deliveryTime`); `comparisonContext` is an optional caption. The API has no dimension or target-group
fields.

##### `add_to_cart` → direct-checkout CTA (single **or** multi-product)

The tool name stays `add_to_cart` for backwards compatibility; it drives a **direct checkout** for
**one or several** products in one cart. The model emits **one** `add_to_cart` call per buying
decision, only with in-stock products and only for private customers.

Input schema (**either** `productId` **or** `productIds`, at least one required):
```ts
{ productId?: string; productIds?: string[]; message: string }
```

- **Single product** — `productId`.
- **Multiple products** — when the shopper clearly wants several items together („beides nehme ich“,
  „das Rack UND die Hantelbank“), `productIds` with **all** intended ids in **one** call: one combined
  cart, not several buttons.

Single-product example chunk:
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

Output: `{ ok: true }`. Widget action:

1. **Normalise the input to an id list:** `ids = input.productIds || [input.productId]`.
2. **Hydrate:** `GET /api/products?ids=<id1>,<id2>,…` (up to 10 ids). Render **one** quick-checkout
   card listing every resolved product, with `message` as the header. Unknown ids come back as `null`
   entries — skip them.
3. **Checkout button:** link it to the **top-level** `cartUrl` of that same response — one permalink
   that puts **all** in-stock variants in **one** cart (`…/cart/<v1>:1,<v2>:1`). Never stitch it from
   the per-product `shopifyCartUrl` values. Open with `target="_blank" rel="noopener noreferrer"`.
   Before opening it, re-stamp the attribution marker (§10).
4. **Degrade gracefully:** if `cartUrl` is `null` (nothing in stock or no variant resolved), hide the
   checkout button and fall back to the products' `shopifyUrl` links.

The button sends the shopper **directly to checkout** (one unit per line), not into a cart they must
then manage.

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
Output: `{ ok: true }`. Widget action: `GET /api/products?ids=…`, render a showroom card listing the
product names and linking to the showroom page (today
`https://motionsports.de/pages/showroom-munchen-grobenzell`; the URL is widget configuration — the
backend sends none).

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
Output: `{ ok: true }`. Widget action: render the in-widget contact form with the reason pre-selected,
`message` displayed as its header, and (if `productIds` is present) `GET /api/products?ids=…` so the
form can show which products are being asked about. Submission POSTs to `/api/contact` (§4) with the
`reason` unchanged.

- **`order_support`** = a customer-service matter that needs a person at motion sports about an order:
  starting a return or refund, a cancellation, a complaint, reaching the team (and order
  status/tracking while the order-status tool of "Tools the widget MUST NOT render" is off). Organisation
  is optional for it; an order number travels inside `message`.
- The team mail's subject label per reason is backend copy (§4). The widget's own heading per reason
  is its choice; a reason the widget has no heading for falls back to its `general` heading and is
  still submitted unchanged.

##### `offer_email_summary` → e-mail capture form

**When it is emitted.** The assistant calls it at a **value moment** — after the user reacted well to
a recommendation, after a helpful comparison, when the user wants to think it over, or at clear
buying/checkout intent — never as the first message and never on a timer. **At most twice per
conversation**: the server withholds the tool after the second ask and once `customer.email` is
attached. When a turn calls `add_to_cart` without an offer, the backend may append one step whose only
tool is this one (best effort; never after an `email_capture_declined` of the session). **Not offered
to a signed-in (tier-3) session** (since 2026-10-05); the widget's own tier-3 suppression stays for
parts stored before a sign-in (ACCOUNT_CONTRACT.md §6.0).

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

**The tool RESULT carries the canonical consent copy.** Unlike the other renderable tools, this call's
`tool-output-available` chunk is load-bearing: `output.consentCopy` is exactly the default
`GET /api/consent-copy` payload (§7.4) in the chat's locale (§12) — checkbox labels, shared footer,
imprint/privacy links, copy `version`, `locale`, `enLegalReviewed`, the returning-customer hint and the
pre-composed `consentTextShown` audit string. The served text is stored verbatim as Art. 7 proof, so
the widget renders these strings and never hard-codes consent copy (§0 rule 8); copy changes ship as a
backend deploy with no widget release.

Example chunk pair (the `tool-input-available` chunk, followed by the `tool-output-available` chunk for
the same `toolCallId`):
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
      "version": "v5",
      "locale": "de",
      "transactionalLabel": "Ja, schickt mir meine Beratungs-Zusammenfassung per E-Mail (inkl. Direkt-Link zur Kasse).",
      "marketingLabel": "Ja, ich möchte exklusive Angebote und Aktionen erhalten — nur für Abonnenten. Jederzeit abbestellbar.",
      "consentFooter": "Verarbeitung durch motion sports gemäß Datenschutzerklärung; Widerruf jederzeit möglich.",
      "consentTextShown": "Ja, schickt mir … | Ja, ich möchte exklusive Angebote … | Verarbeitung durch motion sports …",
      "imprintUrl": "https://motionsports.de/pages/impressum",
      "privacyUrl": "https://motionsports.de/policies/privacy-policy",
      "lawyerApproved": true,
      "enLegalReviewed": true,
      "returningHint": {
        "enabled": true,
        "text": "Schon einmal von Mo beraten worden? Gib deine E-Mail an — Mo erkennt dich wieder und knüpft an deine letzte Beratung an."
      }
    }
  }
}
```
Widget action: render `message` as the intro, then the capture form from `output.consentCopy` as
CONSENT_CONTRACT.md §4 prescribes (two separate, unchecked boxes; transactional required; footer with
imprint and privacy links; `returningHint` only when `enabled`). Submit to `POST /api/capture-email`
(§7.1) with the two booleans, `consentTextShown` echoed byte for byte, the tool's `trigger` (telemetry
only) and `locale`. `productIds` is advisory (cart preview); the backend determines the real products
server-side.

If the user dismisses or declines the capture card without submitting, the widget emits one
`email_capture_declined` event via `POST /api/kpi` (§5) with `data: { trigger, askNumber? }` — the
backend cannot observe a dismissal itself, and the event also stops the backend from forcing another
ask in that session. The shown/submitted events are recorded server-side; the widget never sends them.

#### Tools the widget MUST NOT render

These background tools stream the full `tool-input-start → … → tool-output-available` chunk sequence.
The widget renders **nothing** for them — no card, no placeholder, no "tool used" hint, no error — but
**keeps the part (input and output) in the history it sends back** ("Request body" above):

- `update_customer_profile` — persona bookkeeping; output `{ ok: true }`. The server rebuilds the
  customer profile from these replayed parts on every turn.
- `search_products` — internal retrieval; the assistant uses the result to decide which
  `show_product` / `compare_products` calls to make. Output `{ totalMatched, products: [...] }` (id,
  name, category, price, short description, score) — for the model only; never render cards from it.
- `get_order_status` — behind `CHAT_ORDER_STATUS_ENABLED` (default off in code): the order status of
  a customer signed in with „Anmelden“ in this session, for the assistant's text answer („Wo ist meine
  Bestellung?“). Input `{ orderRef?: string; topic: "status" | "shipping" | "return" |
  "cancellation" | "refund" }`; output `{ status, signedInViaShop?, matched?, orders: [...],
  ordersPageUrl }` — `status` `ok` | `no_orders` | `not_found` | `sign_in_required` | `unavailable`;
  `signedInViaShop: true` only with `sign_in_required` for a session recognised through the shop login;
  orders carry a letter `ref`, order date, items and states — no order numbers, amounts or tracking
  numbers. Example:

  ```json
  { "type": "tool-input-available", "toolCallId": "call_x", "toolName": "get_order_status",
    "input": { "topic": "shipping" } }
  { "type": "tool-output-available", "toolCallId": "call_x",
    "output": { "status": "ok", "orders": [ { "ref": "A", "placedOn": "2026-09-28",
      "items": ["1× ATX Power Rack 620 (Schwarz)"], "state": "in_transit", "payment": "paid",
      "carrier": "DHL", "estimatedDelivery": "2026-10-01" } ],
      "ordersPageUrl": "https://www.motionsports.de/account" } }
  ```

  Never show, log or forward the output (KPI, analytics, error reports); it stays only in the history
  the widget keeps. The backend never trusts a replayed output — it replaces it with
  `{ replayed: true }` before the model sees it, so nothing needs filtering. Because the stored history
  can hold order facts, the widget drops it when a sign-in ends (ACCOUNT_CONTRACT.md §5.1).

The same render-nothing rule holds for any tool name the widget does not know (assembly rules above).

### Rate-limit response (429)

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 32
Content-Type: application/json
```
```json
{ "error": { "code": "rate_limited", "message": "Too many requests" } }
```

The widget disables the input for the indicated seconds and shows a „zu viele Anfragen — bitte kurz
warten“ hint.

### Auth / origin errors

| Status | Code           | When                                                  |
| ------ | -------------- | ----------------------------------------------------- |
| 400    | `bad_request`  | Body isn't valid JSON / `messages` not an array.      |
| 400    | `payload_too_large` | More than 40 messages (above).                   |
| 401    | `unauthorized` | Missing or wrong `x-ms-chat-key`.                     |
| 403    | `forbidden`    | Cross-origin request from an origin not in allowlist. |
| 429    | `rate_limited` | `chat` bucket (20 req / 60 s).                        |
| 500    | `internal_error` | Anything else.                                      |

---

## 3. `GET /api/products`

Hydrates product cards by id. No secret, only an allowlisted origin (send `x-ms-session` for
rate-limit keying).

### Request

```
GET /api/products?ids=atx-treadmill-pro-fold,atx-treadmill-silent-x
GET /api/products?id=atx-treadmill-pro-fold&id=atx-treadmill-silent-x
```

Both forms are equivalent. Whitespace around ids is trimmed; duplicates within a request are
de-duplicated while preserving order.

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

TypeScript-style shape (one entry per requested id, in request order; `null` for unknown ids):

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
  // check). `inStock` is the headline flag: render a subtle "Ausverkauft" badge
  // on the card when it is `false`. The two optional fields carry richer
  // signals when the sync captured them:
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
  //   qa          — published, team-answered customer Q&A pairs (the same list
  //                 the PDP Q&A tab renders from the custom.qa metafield, ≤ 20)
  sku?: string;
  rating?: number;
  ratingCount?: number;
  qa?: Array<{
    question: string;       // German (source of truth)
    answer: string;         // German, plain text
    answerHtml?: string;    // pre-sanitised HTML (escaped text + product links) — render it when present, else `answer`
    questionEn?: string;    // English, when the publish-time translation ran — else fall back to German
    answerEn?: string;
    answerEnHtml?: string;  // like answerHtml, for the English answer
  }>;
};

type ProductsResponse = {
  products: (PublicProduct | null)[];
  // Combined prefilled-cart permalink covering ALL requested resolvable
  // variants in ONE cart (`…/cart/<v1>:1,<v2>:1`). Use this for the
  // `add_to_cart` checkout button. Sold-out products are excluded — they can
  // never enter this checkout link. `null` when no requested id resolves to an
  // in-stock variant. For a single requested id it equals that product's own
  // `shopifyCartUrl`. Never carries a discount (marketing-only).
  cartUrl: string | null;
};
```

Unknown ids return as `null` at the matching index — never a 404 — so the widget can render partial
results without aborting.

### Product variants

`PublicProduct` additionally carries the product's sellable variants (additive; absent on
pre-variant catalog data):

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

Requested ids may be **variant refs** of the form `handle~<numericVariantId>` (the `~` separator is
URL-safe). For a ref, the returned entry's flat fields (`name`, `price`, `salePrice`,
`shopifyCartUrl`, `inStock`, `sku`) describe the CHOSEN variant, `selectedVariantId` is set, and the
combined `cartUrl` uses that variant. A ref whose variant does not exist returns `null` (like an
unknown id — never a silent fallback to the default variant). Widgets that ignore the variant fields
behave exactly as before, with the flat fields describing the default variant. A widget MAY render its
own variant selector from `variants[]` and deep-link the PDP via `shopifyUrl + "?variant=<id>"`.

The top-level **`cartUrl`** is the one-click checkout link for `add_to_cart` (single or multi-product).
It is built server-side from the resolvable numeric variant ids, so the widget never assembles a
multi-variant permalink itself.

`shopifyCartUrl` is a Shopify storefront cart permalink for **one** unit of the product's variant, of
the form `https://motionsports.de/cart/<numericVariantId>:1`. The `id` is always the **numeric**
Shopify variant id — never the SKU, handle, or product id. The field is **optional**: it is omitted
when a product has no resolvable numeric variant id, **or when the product is sold out**
(`inStock: false`).

**Stock status & checkout guarantee.** `inStock` reflects the latest daily catalog sync (sync-fresh,
not a live availability check). A sold-out product is **never** offered a checkout link: its
`shopifyCartUrl` is omitted, and it is excluded from the combined top-level `cartUrl` (so a sold-out
item can never enter a checkout action even when bundled with in-stock products). Sold-out entries
still carry full product data and `inStock: false`, so the widget can render the card with a subtle
„Ausverkauft“ badge.

Response is cacheable for 60 s (`Cache-Control: public, max-age=60, stale-while-revalidate=300`).

### Rate-limit response (429)

Same shape as `/api/chat`. Bucket: `products`, 60 req / 60 s per session/IP.

---

## 4. `POST /api/contact`

JSON contact-form submission. The request is stored in Mo and forwarded to the team by mail (Resend);
the customer's address is the mail's reply-to.

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
  "sessionId": "b3c1…",                              // optional, pseudonymous
  "locale": "de"                                     // optional, §12
}
```

- `reason` is one of the eight `show_contact_form` reasons (§2). The team mail's subject label per
  reason (backend copy, German): `studio_consultation` „Studio-Beratung“, `public_sector_quote`
  „Angebot öffentlicher Sektor“, `physio_consultation` „Physio-Beratung“, `bulk_discount`
  „Mengenrabatt“, `leasing` „Leasing“, `maintenance` „Wartung“, `order_support` „Bestellung & Service“,
  `general` „Allgemeine Anfrage“. Any other value is accepted, shown verbatim in the subject and
  recorded as `other` in the KPI event.
- `email` is validated with `^[^@\s]+@[^@\s]+\.[^@\s]+$`.
- `name` and `message` must be non-empty after trimming.
- `sessionId` (optional) keys the pseudonymous `contact_form_submitted` server event (§5) so
  submissions can be compared against `show_contact_form` tool calls; without it the `x-ms-session`
  header is used. It is never stored alongside the submitted contact details.
- `locale` sets the language of the response messages; the team mail stays German (§12).

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
| 429    | `rate_limited`         | `chat` bucket (20 req / 60 s) or the per-IP `contact-ip` bucket (8 / 60 min). `Retry-After` set. |
| 502    | `upstream_unavailable` | The team mail could not be sent.                                     |
| 500    | `internal_error`       | Anything else.                                                       |

---

## 5. `POST /api/kpi`

Pseudonymous telemetry ingestion — the endpoint the widget's fail-silent `track()` calls.
Fire-and-forget: the widget does not need to read the response or retry.

### Required request headers

| Header          | Value                                              |
| --------------- | -------------------------------------------------- |
| `Content-Type`  | `application/json`                                 |
| `x-ms-session`  | Stable session id (UUID). Used for rate limiting only. |

No `x-ms-chat-key` — like `/api/products`, this endpoint is origin-allowlisted only.

### Request body

```jsonc
{
  "event": "product_cta_clicked",           // required, ≤120 chars
  "sessionId": "b3c1…",                    // the x-ms-session value — the session the event is stored under
  "timestamp": 1733212800000,              // optional, client clock (number or ISO string)
  "data": { "productId": "atx-rack-pro" }  // optional, plain object
}
```

- `event` is the only hard requirement (non-empty string, ≤120 chars).
- `sessionId` is the session the event is stored and joined under (the header only keys the rate
  limit). Send the same id as `x-ms-session` on every event (§0 rule 6); an event without it is stored
  session-less and joins no funnel.
- `data` must be a plain object if present (arrays/primitives are dropped). The server stores it
  **verbatim** — it does not inspect it — so the widget never puts PII, text, URLs, tokens or codes in
  it (§0 rule 13). The client `timestamp` is stored as `data.clientTimestamp`; the server's own
  `created_at` is authoritative.
- There is no allowlist of event names, with one exception: a **server-only** name (table below) is
  answered `202` but **not stored** (since 2026-10-04, `SERVER_ONLY_EVENTS` in
  `src/lib/kpi-widget-events.mjs`), so a misbehaving widget or a forged call cannot double-count or
  fake a funnel stage.

### Widget events the backend reads by name

The admin KPI tab reads these widget events by their literal names — renaming one breaks a KPI
silently (§0 rule 15). Their `data` is not read unless a subsection below defines it.

| Event | Read as |
| --- | --- |
| `chat_opened`, `message_sent` | sessions that opened the chat / wrote |
| `product_cta_opened`, `nudge_clicked` | chat opened from the PDP CTA / a nudge (page-context measurement) |
| `email_capture_declined` | below, "Email-capture funnel events" |
| `login_gate_*`, `account_signin_started`, `account_signin_return` | below, "Sign-in popup events" |
| `consent_gate_*` | below, "Consent-gate events" |
| `product_cta_clicked` | below, "Product clicks (widget)" |

In addition, every widget event whose name matches `%product%click%` or `%cta%click%` counts as a
product click, and every one matching `%cart%` or `%checkout%` as an add-to-cart click
(`src/lib/kpi-event-patterns.mjs`).

### Email-capture funnel events (canonical names)

The value-triggered email capture is measured through this pseudonymous, session-keyed funnel (no
email address ever appears in an event). All but one are emitted **server-side** and are server-only:

| Event                                | Emitted by | `data`                                  |
| ------------------------------------ | ---------- | --------------------------------------- |
| `email_capture_ask_shown`            | server (`/api/chat`) | `{ trigger, askNumber }` — one per `offer_email_summary` call. |
| `email_capture_submitted`            | server (`/api/capture-email`, `/api/chat-marketing-opt-in`, `/api/account/marketing-opt-in`) | `{ marketingConsent, source, outcome?, trigger? }` |
| `email_capture_marketing_opted_in`   | server (same three routes) | `{ doiStatus, source, outcome?, trigger? }` — the marketing box was ticked / the accept tapped. |
| `email_capture_marketing_confirmed`  | server (`/api/confirm-marketing`) | `{ source }` (since 2026-10-05; `{}` before) — unique DOI confirmations only. |
| `email_capture_declined`             | **widget** (this endpoint) | `{ trigger, askNumber? }` — capture card dismissed/declined without submit. |

`trigger` is the value moment from the `offer_email_summary` tool call (`recommendation_accepted`,
`comparison_delivered`, `consideration_pause`, `buying_intent`, `checkout_intent`).
`/api/capture-email` stores the echoed `trigger` only when it is one of these five values (since
2026-10-05). The chat consent gate's captures carry `trigger: "chat_gate"`, the at-sign-in opt-in
`trigger: "signin_optin"`; rows from before 2026-10-05 have no `source`, and readers tell the surfaces
apart by `trigger` there.

**`source` and `outcome` (server-set, `src/lib/capture-funnel.mjs`).** The widget sends none of them.

| `source` | Written by |
| --- | --- |
| `mo_capture_form` | `POST /api/capture-email` (the capture form) |
| `mo_signin` | `POST /api/account/marketing-opt-in` (popup / card after a sign-in) |
| `mo_chat_gate` | `POST /api/chat-marketing-opt-in` (§7.6, not used by the widget) |

| `outcome` (only when the marketing box was ticked) | Meaning |
| --- | --- |
| `doi_required` | a DOI mail is due (written before the send; a failed send still counts) |
| `already_confirmed` | the address already holds a confirmed Mo DOI — no DOI mail |
| `already_subscribed` | the address is subscribed elsewhere (Shopify) — no DOI mail |
| `suppressed` | the address is on the suppression list — no DOI mail, never re-pended |

The routes answer `alreadyConfirmed: true` exactly for `already_confirmed` and `already_subscribed`;
a `suppressed` address is answered `marketing.status: "none"`, `alreadyConfirmed: false` (§7).

`email_capture_marketing_confirmed.source` is the surface the DOI click confirms: the `source` of the
capture session's latest opt-in that needed a DOI mail, else the surface of the latest pending consent
row, else `mo`.

**Sign-in opt-in extras.** Both `signin_optin` events additionally carry `alreadyConfirmed`
(boolean, the same value as the response), `doiRequired` (boolean: a DOI mail was due, even when its
send failed), `placement?` and `variant?` (the validated echo of the opt-in POST,
ACCOUNT_CONTRACT.md §6.2; left out when unknown) and, only while more than one consent-popup variant
is active, `variantMismatch: true` when the echoed variant is not the one this
session is assigned (§7.4).

### Sign-in popup events (widget 2026-10-01)

When the widget asks an anonymous visitor to sign in (the widget since 2026-10-01: shortly after the
first sent message, once per tab session, never in voice mode), it sends these **widget** events
(names in `src/lib/kpi-widget-events.mjs`):

| Event                       | `data`                    | When |
| --------------------------- | ------------------------- | ---- |
| `login_gate_shown`          | `{}`                      | The popup was shown. |
| `login_gate_signin_clicked` | `{}`                      | „Anmelden“ — the redirect follows once the reply has finished streaming. |
| `login_gate_declined`       | `{}`                      | „Später“ — snoozed for 24 h on the device. |
| `login_gate_dismissed`      | `{}`                      | Closed with Esc or a backdrop click (no snooze). |
| `account_signin_started`    | `{ source?: "login_gate" }` | Any sign-in start; `source` only when it came from the popup. |
| `account_signin_return`     | `{ result }`              | The widget saw the return from the sign-in. `result`: `ok` only after the one-time code was redeemed, `link_failed` (refused, missing or not redeemable code), `login_required`, `error`. The backend reads `ok` and `link_failed` and counts every other value as an error. |

The KPI tab's „Anmelde-Popup“ funnel counts **sessions** and joins them, in the same session after
the click, to the server events `account_signin_succeeded` (Shopify) and `account_signin_linked` (the
chat redeemed the one-time code — the sign-in that counts). So the `sessionId` of these events must be
the session the login used (`login?session=`).

### Consent-gate events (canonical names)

The marketing consent ask for **signed-in** customers (a popup in the signed-in session, plus the
inline card right after a mid-conversation sign-in; when to show it: ACCOUNT_CONTRACT.md §6.1) is
measured through four **widget** events (names in `src/lib/kpi-events.ts`; the backend observes the accept only as the
opt-in POST). Each carries `data: { surface: "signin", placement?, variant? }`:

- `surface` — `"signin"`. (`"chat"` was the anonymous e-mail gate, not used by the widget since
  2026-10-01; old events stay countable.)
- `placement` — `popup` | `signin_return` | `value_moment`, optional.
- `variant` — the served `variant` id of the copy that was rendered (`^[a-z0-9_-]{1,32}$`, §7.4),
  optional.

The dashboard groups a missing `variant` as „ohne (älteres Widget)“ and a missing `placement` as „ohne“; a value it does not know becomes „unbekannt“ — an arbitrary string never gets its own row.

| Event                    | When                                                        |
| ------------------------ | ----------------------------------------------------------- |
| `consent_gate_shown`     | The popup or card was rendered (once per tab session for the ask). |
| `consent_gate_accepted`  | The explicit „Ja, Angebote aktivieren“ tap.                 |
| `consent_gate_declined`  | The explicit decline tap.                                   |
| `consent_gate_dismissed` | Closed without an explicit accept/decline.                  |

> **Retired:** `starter_shown` / `starter_clicked` (starter prompts removed, 2026-10-01). The endpoint
> doesn't reject them; the dashboard marks them „eingestellt“.

### Product clicks (widget)

`product_cta_clicked` `{ productId, samePage? }` — „Zum Produkt“ in a product card, a comparison
column or the add-to-cart fallback links; `productId` is the catalog handle. `samePage` (boolean) is
computed at click time: `true` when the clicked product is the product of the open product page,
`false` otherwise (always `false` off a product page). The name matches the dashboard's product-click
pattern; „Seitenkontext auf Produktseiten“ counts only clicks whose `samePage` is not `true` as „andere
Produkte geklickt“.

### Server-emitted lifecycle events (canonical names)

These land in the same `kpi_events` stream but are emitted **exclusively server-side** — the widget
never sends them (§0 rule 14); `POST /api/kpi` answers `202` to any of these names and the four
server-side capture-funnel names above, but does not store them:

| Event                      | Emitted by | `data` |
| -------------------------- | ---------- | ------ |
| `marketing_email_clicked`  | `GET /api/r/<token>` (marketing send) | `{ sendId, captureId, firstClick }`, session `NULL` |
| `campaign_email_clicked`   | `GET /api/r/<token>` (campaign send) | `{ sendId, firstClick }`, session `NULL` |
| `campaign_chat_started`    | `POST /api/chat` with a valid `campaignToken` (§2) — once per campaign send | `{ sendId, campaignId }`, plus `test: true` for a test send; session `NULL` (the widget sends the token, never this event) |
| `bundle_offer_clicked`     | `GET /api/r/<token>` (bundle offer) | `{ offerId, status, expired }`, session `NULL` |
| `contact_form_submitted`   | `POST /api/contact` (accepted submissions) | `{ reason, productCount }` — `reason` one of the §4 reasons, else `other`; never the name/email/message. Session-keyed: the payload's `sessionId`, else the `x-ms-session` header. |
| `account_signin_succeeded` | `GET /api/auth/shopify/callback` (success) | `{ silent }` — `prompt=none` re-detects flagged. Session-keyed (the session of `login?session=`). This alone does not sign the chat in. |
| `account_shop_recognised`  | `GET /api/auth/storefront` (App Proxy whoami: signed, fresh, Shopify vouches for a logged-in customer; 2026-10-05) | `{ proof, hasToken, alreadySignedIn, codeIssued, noCode? }` — `proof` `token` \| `shop` \| `none`; `hasToken` = the customer has a chat (Customer Account) token; `alreadySignedIn` = the session was already signed in as this customer; `noCode` (only when `codeIssued` is false) `flag_off` \| `no_proof` \| `handover` \| `failed`. Session-keyed; never a customer id, name, e-mail, the code or the URL. |
| `account_signin_linked`    | `POST /api/auth/link` (code redeemed) | `{ kind, renewed }` — `kind` `customer_account` \| `app_proxy`; `renewed` (2026-10-05) = the session was already signed in as the same customer (a new tab confirming it, not a new sign-in). Session-keyed. The sign-in now counts for the chat. |
| `account_signin_link_refused` | `POST /api/auth/link` (400) | `{ reason, kind? }` — `reason` `invalid` (expired, used, unknown) \| `session_mismatch` (another session's code); `kind` (2026-10-05) = the code's link kind when the code is known. Session-keyed. A 503 (database not reachable) records nothing. |
| `account_export_requested` | `GET /api/account/export` | `{}`, session `NULL` (pure volume counter) |
| `account_erased`           | `POST /api/account/erase` | `{}`, session `NULL` (pure volume counter) |
| `order_status_lookup`      | `POST /api/chat` — one per `get_order_status` call (`CHAT_ORDER_STATUS_ENABLED`) | `{ outcome, topic, source, orders }` — `outcome` `ok` \| `no_orders` \| `not_found` \| `sign_in_required` \| `unavailable` \| `disabled` \| `ledger_off` \| `ledger_incomplete` (first order import not finished) \| `ledger_behind` (a live read found an order the ledger lacks); `topic` as the tool input; `source` `ledger` \| `ledger+live`; `orders` = number of orders in the answer. Never an order number, amount or id. Session-keyed. |
| `mo_order_marker_unresolved` | `POST /api/webhooks/shopify` — `orders/create` only, after the delivery was recorded (a Shopify retry or the `orders/paid` delivery of the same order does not count again; 2026-10-05) | `{ reason, source? }` — `reason` `unknown_token` (token not in the table: purged, erased, forged) \| `outside_window`; `source` only for `outside_window`, one of `widget` \| `summary_email` \| `marketing_email` \| `bundle`. Session `NULL`; never an order id, token or amount. Caveat: a duplicate `orders/create` subscription delivers each order with its own webhook id and counts it twice. |
| `page_context_applied`     | `POST /api/chat` — one per request with a valid `context.source: "page"` and a user message (§2), written when the request arrives (2026-10-05) | `{ applied, kind, resolved, locale, pct }` — `applied` = the arm (context used, or ignored as switched off / control group), not "a note was added"; `kind` `product` \| `collection`; `resolved` = known to the catalog; `pct` = the control-group share in force (0–50), `100` while `CHAT_PAGE_CONTEXT_ENABLED` is off, `0` for `collection`. Session-keyed; never a product id. |
| `page_context_answered`    | `POST /api/chat` — when that turn finished (2026-10-05) | `{ kind, productCards, otherCards }` — card tool calls in the answer (`show_product`, `compare_products`, `add_to_cart`); `otherCards` leaves out a `show_product` of the open page's product. Counts only, no ids. Session-keyed. |

Which admin KPI section reads which event: backend doc `ADMIN_DASHBOARD.md` §5.

### Success response

```http
HTTP/1.1 202 Accepted
```
```json
{ "ok": true }
```

Returns `202` even when no database is configured, the write fails or the name is server-only —
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

The widget generates one stable id per browser and sends it as `x-ms-session` on **every** backend
call (and as `sessionId` in KPI bodies, `?session=` where an endpoint takes it; §0 rule 6):

```js
var sid = localStorage.getItem("ms-chat-sid");
if (!sid) {
  sid = crypto.randomUUID();
  localStorage.setItem("ms-chat-sid", sid);
}
```

What the backend keys by it:

- **Conversations.** Every chat turn is stored server-side under the session id (`conversations`,
  `messages`), one thread per `conversationKey` (§2). The widget's local history is a UI cache; the
  server keeps the record (retention: backend doc `DATA_RETENTION.md`).
- **Rate limits** (`sid:<uuid>`, else the IP; §1). A stable id keeps one customer's bursts isolated
  from another's, and an abusive client can't rotate to a fresh bucket by reloading.
- **The sign-in.** The one-time code is redeemed only for the session that started the sign-in, and
  the signed-in link is that session's (ACCOUNT_CONTRACT.md §1, §2a).
- **KPI events** (§5), the same-session check behind `customer.email` (§2), the attribution token
  (§10) and the consent-popup variant (§7.4).

**Rotation.**

- Never around a sign-in, and never while signed in — the id is the identity link. When a sign-in
  ends (sign-out, erase, a sign-in the server reports ended), the widget drops the stored history and
  starts a new id (ACCOUNT_CONTRACT.md §5.1).
- A new conversation is a fresh `conversationKey`, not a new session id. Anonymous and e-mail-only
  visitors MAY also rotate the id when they start a new chat.
- The 40-message cap (§2) is per request — the history of one thread. After `payload_too_large` the
  widget starts a new thread (fresh `conversationKey`, empty `messages`); it does not need a new id.

---

## 7. Email capture + double opt-in (GDPR)

The capture form collects two **separate** consents — transactional (the summary) and marketing — and a
marketing opt-in on a Mo surface requires a **double opt-in**. How the widget renders the consent
surfaces: CONSENT_CONTRACT.md. Legal rationale and data model: backend doc `CONSENT_FLOW.md`. The German
checkbox/email copy is lawyer-approved (`lawyerApproved: true`); the English copy is approved as its
translation (§12).

**One marketing consent, shared with Shopify.** The marketing consent is one state per person, shared
with the shop's own newsletter consent in both directions. What that means for the widget — all
additive, no field changed:

- An opt-in on a Mo surface (§7.1, §7.6, `POST /api/account/marketing-opt-in`) stays `pending` until
  the DOI link is clicked; nothing goes to Shopify before that.
- An address that **already holds the consent** — subscribed in Shopify or through an earlier Mo DOI
  — and is **not on the suppression list** gets **no second DOI mail**. The opt-in endpoints then answer
  `marketing.status: "confirmed"`, `alreadyConfirmed: true`, `doiEmailSent: false`. The tap itself is
  still stored as Art. 7 evidence. Treat it like any `confirmed` answer: no „bitte bestätigen“ hint.
- An address **on the suppression list** (unsubscribed, bounced, complained, erased) gets no DOI mail
  either and the neutral answer `marketing.status: "none"`, `alreadyConfirmed: false`,
  `doiEmailSent: false` on all three opt-in endpoints — never „already subscribed“, even when its old
  DOI row still reads `confirmed` (since 2026-10-05). The widget shows its neutral thank-you.
- The DOI click and the unsubscribe link are reported to Shopify (§7.2, §7.3), so both sides stay in
  step.
- A `pending` opt-in whose DOI link was never clicked falls back to „no consent“ one day after the link
  expired (`MARKETING_DOI_EXPIRY_DAYS` + 1, nightly, local only). The surfaces may then ask again
  (signed-in gating: ACCOUNT_CONTRACT.md §6.1).

### 7.1 `POST /api/capture-email`

Triggered when the user submits the capture form rendered from the `offer_email_summary` tool call (or
from `GET /api/consent-copy` for a form not triggered by the tool).

#### Required request headers

Same as `/api/chat` (origin allowlist + `x-ms-chat-key` + `x-ms-session`).

#### Request body

```jsonc
{
  "sessionId": "b3c1…",            // optional; falls back to the x-ms-session header
  "email": "max@example.de",
  "transactionalConsent": true,    // required to be true; the box starts UNCHECKED in the UI
  "marketingConsent": false,       // separate, starts unchecked, never pre-ticked
  "consentTextShown": "Ja, schickt mir … | Ja, ich möchte exklusive Angebote … | Verarbeitung durch motion sports …",  // backend-served audit string, echoed verbatim
  "trigger": "recommendation_accepted",  // optional; echo of the offer's trigger (telemetry only)
  "locale": "de"                   // optional; MUST match the locale of the rendered copy (§12)
}
```

- `email` is validated with `^[^@\s]+@[^@\s]+\.[^@\s]+$` and normalised (trim + lower-case)
  server-side. Invalid → `400 bad_request`.
- `transactionalConsent` **must** be `true` — you can't email a summary without consent to email the
  summary, and the box starts unchecked, so the user must have actively ticked it. `false`/missing →
  **`400` with code `transactional_consent_required`** (dedicated, stable code so the widget can show a
  targeted „bitte Häkchen setzen“ hint instead of a generic error).
- `marketingConsent` is independent. When `true` (and the address isn't suppressed), the backend sets
  the DOI `pending`, issues a DOI token, and sends the confirmation email. **No marketing** is sent until
  the user clicks that link. Exception: the address already holds the one consent → no token, no DOI
  mail, response `confirmed` (§7 intro).
- `consentTextShown` is stored verbatim as Art. 7 proof. It MUST be the **backend-provided**
  `consentCopy.consentTextShown` string (from the `offer_email_summary` tool result or
  `GET /api/consent-copy`, §7.4) echoed back **byte-for-byte**. The backend additionally stores a
  **consent copy version stamp** (`consent_copy_version`, e.g. `"v5"`) — resolved **server-side**:
  stamped only when the echoed string is byte-identical to the currently served capture copy of the
  request's locale, `NULL` otherwise (the widget sends no version field).
- `trigger` is optional (telemetry only). It is **truncated to 40 characters** server-side; a value
  outside the five tool values is accepted but **not stored** in the KPI events (never a 400).
- `locale` sets the summary and DOI mail language and the stored consent locale (§12).

#### Behaviour

1. Stores one consent record per email (with `consentTextShown` and the version stamp) and links the
   session's conversation to the customer.
2. **Transactional:** sends the summary email immediately — a summary of the conversation in the
   shopper's language plus a prefilled-cart permalink (no discount). Which products the cart carries
   is a backend rule (backend doc `CONSENT_FLOW.md`, "End-to-end flow"); `productIds` from the widget
   are not used for it.
3. **Marketing:** if newly granted, sends the DOI confirmation email and records the one consent as
   `pending`. A suppressed/unsubscribed address is never re-pended; an address already confirmed in Mo
   **or subscribed in Shopify** isn't sent a DOI (only checked when `marketingConsent: true`).

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

What the widget shows for each answer: CONSENT_CONTRACT.md §4 and its answer table (the „bitte
bestätigen“ line only for `pending` with `doiEmailSent: true`, and only when the marketing box was
ticked). `pending` is also answered to a submit **without** the marketing tick when an earlier
opt-in of the address is still unconfirmed: the pending DOI and its link stay valid (since 2026-10-05).
`transactional.summarySent: true` is also returned when no mail provider is configured (local
development: the send is skipped); in production an actual delivery failure returns `502`.

After a success response, the widget MAY start attaching the captured email as `customer.email` to the
session's subsequent `/api/chat` requests — see §2 "Optional `customer`" for the privacy rules.

#### Error responses

| Status | Code                   | When                                                              |
| ------ | ---------------------- | ----------------------------------------------------------------- |
| 400    | `bad_request`          | Invalid JSON or invalid email.                                    |
| 400    | `transactional_consent_required` | `transactionalConsent` not `true` (box left unchecked).  |
| 401    | `unauthorized`         | Missing / wrong shared secret.                                    |
| 403    | `forbidden`            | Cross-origin from an origin not in allowlist.                     |
| 429    | `rate_limited`         | `chat` bucket (20 req / 60 s) or the per-recipient cap (3 requests / 60 min per address, shared with §7.6 — a 4th submit for the same address within the hour fails even from a fresh session). `Retry-After` set. |
| 502    | `upstream_unavailable` | The transactional summary email failed to deliver (the consent is stored). |
| 503    | `upstream_unavailable` | No database configured — consent could not be stored.            |
| 500    | `internal_error`       | Anything else.                                                    |

### 7.2 `GET /api/confirm-marketing?token=…&locale=…`

The marketing double-opt-in confirmation link (in the DOI email; the backend appends the capture's
`&locale=`). Clicked as a top-level navigation — returns an **HTML page**, no JSON, no auth guard. The
widget never calls it.

- Valid, unexpired token → confirms the DOI and renders „Danke, deine Anmeldung ist bestätigt.“ (200).
  Idempotent for an already-confirmed token. The first confirmation sets the one consent to
  `subscribed` and reports it to Shopify (backend doc `CONSENT_FLOW.md`).
- Invalid token (also when no database is configured) → error page (400). Expired token (older than
  `MARKETING_DOI_EXPIRY_DAYS`, default 7) → error page (410). Unexpected failure → error page (500).

### 7.3 `GET /api/unsubscribe?token=…`

The unsubscribe link carried by **every** marketing email. The token is a signed, email-keyed value
(`b64url(email).b64url(hmac-sha256)`) — unforgeable and verifiable without a DB lookup.

- Valid signature → puts the address on the suppression list, revokes the marketing consent, sets the
  one consent to `unsubscribed` and reports the withdrawal to Shopify, renders „Du wurdest abgemeldet.“
  (200).
- Invalid/forged token → error page (400). No DB → error page (503).

Which sends a suppression blocks: backend doc `CONSENT_FLOW.md`, "Suppression & 'can I send?' logic".

### 7.4 `GET /api/consent-copy`

Serves the canonical consent copy for the widget's consent surfaces. When the widget shows each
surface: CONSENT_CONTRACT.md. The widget sources all consent copy from this endpoint or from the
`offer_email_summary` output (§2) and never hard-codes it — the strings are the Art. 7 audit text.

Like `/api/products`: **no shared secret** (the strings are public form copy), origin allowlist + rate
limit only (`products` bucket, 60 req / 60 s). Send `x-ms-session` — it keys the rate limit and, on
`surface=signin` while more than one variant is active, assigns the framing variant (below).

#### Request

```
GET /api/consent-copy                   # in-chat capture form (default) — submit: §7.1
GET /api/consent-copy?surface=signin    # consent popup / inline card after a sign-in — submit: ACCOUNT_CONTRACT.md §6.2
GET /api/consent-copy?surface=erase     # „Meine Daten löschen“ confirmation — flow: ACCOUNT_CONTRACT.md §7.5
GET /api/consent-copy?surface=chat      # chat consent gate — not used by the widget since 2026-10-01 (§7.6)
```

Every surface accepts `?locale=en` (default German, §12). Every consent surface carries `version`
(`"v5"` since 2026-10-05, one stamp for every surface), `locale` and `enLegalReviewed` (§12).

**`surface=signin`** (and the legacy `surface=chat`) share one payload shape: `headline`,
`marketingLabel`, `consentFooter`, `consentTextShown`, `imprintUrl`, `privacyUrl`, `lawyerApproved`,
`version`, `locale`, `enLegalReviewed`. `headline` is benefit framing and NOT part of
`consentTextShown` (label + footer only). Both are **button-consent** surfaces (CONSENT_CONTRACT.md §1).
`lawyerApproved` is `true`; `false` would mean "not signed off" (§0 rule 10).

`surface=signin` additionally carries `benefits` and `variant` (v5, 2026-10-05):

```jsonc
"variant": "a",              // framing variant id (^[a-z0-9_-]{1,32}$) — echoed as `variant` in the
                             // consent_gate_* KPI data (§5) and the opt-in POST (ACCOUNT_CONTRACT.md §6.2)
"benefits": [                // 1–4 short bullets (≤ 200 chars each) under the headline — framing like the
  "Angebote, die zu deiner Beratung passen",          // headline, NEVER part of consentTextShown
  "Exklusive Rabatt-Aktionen nur für Abonnenten",
  "Jederzeit mit einem Klick abbestellbar"
]
// locale=en: "Offers that match your consultation", "Exclusive discount promotions for
// subscribers only", "Unsubscribe any time with one click"
```

How the widget renders `benefits` (verbatim, all or nothing, never its own bullets) and echoes
`variant`: CONSENT_CONTRACT.md §3.1. Neither key is required: a missing or invalid `benefits` / `variant`
never hides the popup or the card. Only variant `a` is served by default
(`CONSENT_SIGNIN_VARIANTS=a`). While **more than one variant** is active, the variant is assigned per
session from the `x-ms-session` header of this GET, and the response is `Cache-Control: private,
no-store` instead of the public 60 s cache — so the widget keeps the served copy per session id and
takes `variant` from the copy object it actually rendered.

**`surface=erase`** returns the confirmation copy for the widget's „Meine Daten löschen“ (the same
wording as the mail-link page `/api/erase-data`). It is not consent text; it has no `version` /
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

`confirmBody` depends on `SHOPIFY_ERASURE_SYNC` (default off in code): when on, it names the customer
account in the shop as deleted too and says orders stay in the shop as long as the law requires; when
off, it says the orders in the shop are not affected. Render it verbatim.

**`surface=chat`** — not used by the widget since 2026-10-01 (the sign-in popup replaced the anonymous
e-mail gate); served for compatibility, do not build on it. Besides the shared shape it carries
`signIn`, UI chrome that is never part of `consentTextShown`:

```jsonc
"signIn": {
  "preferred": true,
  "headline": "Schon Kunde bei motion sports?",
  "body": "Melde dich mit deinem Kundenkonto an — dann kennt Mo deine Bestellungen und berät dich persönlich.",
  "buttonLabel": "Mit Kundenkonto anmelden",
  "alternativeLabel": "Kein Konto? Angebote per E-Mail erhalten",
  "loginPath": "/api/auth/shopify/login"   // on the BACKEND origin (ACCOUNT_CONTRACT.md §2)
}
```

#### Response (default surface — the capture form)

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: public, max-age=60, stale-while-revalidate=300
```
```jsonc
{
  // Identifier of the served copy ("v5" since 2026-10-05; one stamp for every
  // surface). Stamped server-side into the audit trail (consent_copy_version)
  // when the echoed consentTextShown matches.
  "version": "v5",
  // The language of these strings (§12).
  "locale": "de",
  // BOTH checkboxes start UNCHECKED — never pre-check either box.
  "transactionalLabel": "Ja, schickt mir meine Beratungs-Zusammenfassung per E-Mail (inkl. Direkt-Link zur Kasse).",
  "marketingLabel": "Ja, ich möchte exklusive Angebote und Aktionen erhalten — nur für Abonnenten. Jederzeit abbestellbar.",
  // Shared one-line footer rendered beneath both checkboxes (Art. 7 minimum),
  // with the imprint/privacy links placed next to it.
  "consentFooter": "Verarbeitung durch motion sports gemäß Datenschutzerklärung; Widerruf jederzeit möglich.",
  // Pre-composed audit string (transactional | marketing | footer) — echo back
  // VERBATIM as `consentTextShown` on POST /api/capture-email (§7.1).
  "consentTextShown": "Ja, schickt mir … | Ja, ich möchte exklusive Angebote … | Verarbeitung durch motion sports …",
  "imprintUrl": "https://motionsports.de/pages/impressum",
  "privacyUrl": "https://motionsports.de/policies/privacy-policy",
  // The German copy is lawyer-approved.
  "lawyerApproved": true,
  // Whether the served locale's copy is approved: always true for de; true for
  // en since 2026-10-05 (approved as the translation of the German), §12.
  "enLegalReviewed": true,
  // Returning-customer hint, rendered near the email input. Informational only —
  // NOT part of consentTextShown. Hide it when enabled is false (server-side
  // switch RETURNING_HINT_ENABLED, default on); its wording can change with a
  // backend deploy.
  "returningHint": {
    "enabled": true,
    "text": "Schon einmal von Mo beraten worden? Gib deine E-Mail an — Mo erkennt dich wieder und knüpft an deine letzte Beratung an."
  }
}
```

The 60 s cache is deliberate: a copy change must reach live widgets quickly. Fetch fresh copy when
rendering a capture form (or at widget boot) — do not persist it across sessions.

#### Error responses

| Status | Code             | When                                            |
| ------ | ---------------- | ----------------------------------------------- |
| 403    | `forbidden`      | Cross-origin from an origin not in allowlist.   |
| 429    | `rate_limited`   | `products` bucket (60 req / 60 s).              |
| 500    | `internal_error` | Unexpected server error.                        |

### 7.5 New environment variables

Moved: the backend's environment variables are documented in `.env.example` (backend). The switches
that change a widget-visible response are named where the response is described:
`RETURNING_HINT_ENABLED` and `CONSENT_SIGNIN_VARIANTS` (§7.4), `SHOPIFY_ERASURE_SYNC` (§7.4
`surface=erase`), `CHAT_PAGE_CONTEXT_ENABLED` / `CHAT_PAGE_CONTEXT_HOLDOUT_PCT` (§2),
`CHAT_ORDER_STATUS_ENABLED` (§2), `MARKETING_DOI_EXPIRY_DAYS` (§7), `MO_ATTRIBUTION_SESSION_ANCHOR`
(§10).

### 7.6 `POST /api/chat-marketing-opt-in`

> **Not used by the widget since 2026-10-01** — the sign-in popup replaced the anonymous chat consent
> gate. The endpoint (and `GET /api/consent-copy?surface=chat`, §7.4) stays served for compatibility;
> do not build on it.

The chat consent gate's accept: a marketing-ONLY opt-in with a typed email, for anonymous chat sessions,
POSTed on the explicit „Ja, Angebote aktivieren“ tap. Not `/api/capture-email` — that endpoint
hard-requires the transactional tick and its audit string covers both consents.

#### Required request headers

Same as `/api/chat` (origin allowlist + `x-ms-chat-key` + `x-ms-session`).

#### Request body

```jsonc
{
  "sessionId": "b3c1…",           // optional; falls back to the x-ms-session header
  "email": "max@example.de",       // the email typed into the gate
  "marketingConsent": true,        // MUST be the user's actual accept tap — never hard-code true
  "consentTextShown": "Ja, schickt mir persönliche Angebote … | Verarbeitung durch motion sports …",  // the served surface=chat consentTextShown, echoed VERBATIM
  "locale": "de",                  // optional ("de" default, "en" on /en), §12
  "trigger": "chat_gate"           // optional echo; telemetry-only, ≤40 chars
}
```

- `email` is validated (`^[^@\s]+@[^@\s]+\.[^@\s]+$`) and normalised server-side. Invalid →
  **`400` code `invalid_email`**.
- `marketingConsent` must be exactly `true` — anything else → **`400` code
  `marketing_consent_required`**.
- `consentTextShown` is stored verbatim as Art. 7 proof, with the server-side `consent_copy_version`
  stamp (`"v5"` when byte-identical to the served `surface=chat` string of the request's locale, `NULL`
  otherwise) — same rules as §7.1.
- Runs the **same double-opt-in pipeline** as `/api/capture-email` (marketing half): DOI `pending` +
  token + confirmation email; a suppressed address is never re-pended (answer `none`); an address
  already confirmed in Mo or subscribed in Shopify is not sent a DOI (answer `confirmed`,
  `alreadyConfirmed: true`, `doiEmailSent: false`). **No marketing until the link is clicked.**
- The capture records the **session id** and links the customer exactly like `/api/capture-email`, so
  after a success the widget MAY attach the email as `customer.email` on subsequent `/api/chat`
  requests (§2 privacy rules apply).

#### Success response

```jsonc
{
  "ok": true,
  "marketing": {
    "status": "pending",        // "none" | "pending" | "confirmed" — none: suppressed address
    "doiEmailSent": true,
    "alreadyConfirmed": false   // true when the address already held the consent (earlier
                                // Mo DOI or subscribed in Shopify) — no DOI mail, doiEmailSent false
  }
}
```

After `pending` the user has to click the confirmation link; after `confirmed` there is nothing to
confirm; after `none` a neutral thank-you.

#### Error responses

| Status | Code                         | When                                                       |
| ------ | ---------------------------- | ---------------------------------------------------------- |
| 400    | `bad_request`                | Invalid JSON body.                                         |
| 400    | `invalid_email`              | Email missing or not a valid address.                      |
| 400    | `marketing_consent_required` | `marketingConsent` not `true` (no real accept tap).        |
| 401    | `unauthorized`               | Missing / wrong shared secret.                             |
| 403    | `forbidden`                  | Cross-origin from an origin not in allowlist.              |
| 429    | `rate_limited`               | `chat` bucket (20 req / 60 s) or the per-recipient cap (3 requests / 60 min per address, shared with §7.1). `Retry-After` set. |
| 503    | `upstream_unavailable`       | No database configured — consent could not be stored.      |
| 500    | `internal_error`             | Anything else.                                             |

---

## 8. `POST /api/tts`

Text-to-speech for the widget's **voice mode**. Takes a chunk of text (one assistant message the user
chose to hear, or one sentence in streaming mode) and returns synthesized speech as **MP3 audio**.
Model, voice, tone and speed are server configuration (backend doc `AI_MODELS.md`).

### Required request headers

Same as `/api/chat`:

| Header          | Value                                                                |
| --------------- | -------------------------------------------------------------------- |
| `Content-Type`  | `application/json`                                                   |
| `x-ms-chat-key` | Shared secret from `CHAT_SHARED_SECRET`.                             |
| `x-ms-session`  | Stable session id (UUID). Keys the rate-limit bucket and the usage attribution. |

Plus the browser `Origin` header, which must be one of `ALLOWED_ORIGINS`. The CORS preflight
advertises `POST, OPTIONS` and `Content-Type, x-ms-chat-key, x-ms-session, x-ms-locale`. The endpoint
takes no locale.

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

- `text` (string, **required**). Missing/not a string → `400 bad_request`; empty after cleaning →
  `400 bad_request`.
- `stream` (boolean, **optional**, default `false`). When `true`, the call is rate-limited on the
  **`tts-stream`** bucket (120 req / 5 min) instead of the single-shot `tts` bucket (20 req / 5 min).
  Everything else — auth, origin, cleaning, synthesis, response shape — is identical.
- `seq` (number, **optional**). A caller-assigned chunk index (≥ 0), echoed back verbatim in the
  `X-MS-TTS-Seq` response header so the widget can slot each independently-completing audio response
  into its playback queue. Absent / invalid → header is `-1`.
- **The server cleans the text before synthesis.** Markdown artifacts are stripped (`**bold**`,
  `` `code` ``, `[links](url)`, headings, bullet lists) so nothing is read aloud as punctuation. The
  widget SHOULD also pre-clean, but the server never trusts that it did.
- **Hard length cap: 2000 characters.** Longer input is **truncated at a sentence boundary** (not
  rejected), and the response carries `X-MS-TTS-Truncated: true` — the request still succeeds with
  audio for the kept portion.

### Streaming voice mode (audio while the text streams)

Without streaming the widget waits for the **whole** assistant message and calls `/api/tts` once, so
audio starts only after generation finished. Streaming voice mode plays audio **while** the text is
still streaming: as soon as the widget has a **complete sentence/clause** it fires
`POST /api/tts` with `{ "text": "<that sentence>", "stream": true, "seq": n }` and pushes the returned
MP3 into a playback queue. The first audio can start ~1 s after the **first** sentence.

Same endpoint, same guards and synthesis; only the rate-limit bucket differs (`tts-stream`, 120 req /
5 min, because one played answer is several requests). Each chunk is still capped at 2000 chars.

**Per-sentence calling pattern (the contract):**

Chunking follows the backend's canonical, unit-tested reference splitter — `splitIntoTtsChunks()` in
`src/lib/tts-text.mjs` (`tts-text.test.mjs` is the spec); the widget mirrors it so chunk boundaries
match what the server expects (§0 rule 24).

1. As chat tokens arrive, append them to a buffer and run `splitIntoTtsChunks(buffer)` →
   `{ chunks, rest }`. It emits a chunk as soon as a sentence terminator (`.`, `!`, `?`, `…`) **or a
   newline** completes a sentence; **coalesces** fragments shorter than `minChars` (default `40`) into
   the next sentence; **force-cuts** a run longer than `maxChars` (default `220`) at the last clause
   boundary (`,` `;` `:` `–` `—`) or space so a long opening sentence can't stall the first audio; and
   guards German abbreviations (`z. B.`, `usw.`), decimals (`3.5`) and mid-token dots (`google.com`).
   Set `buffer = rest` and prepend to the next delta; when the stream ends call
   `splitIntoTtsChunks(buffer, { flush: true })` to drain the remainder.
2. For each chunk, in stream order, `POST /api/tts` with `{ text, stream: true, seq }` where `seq` is a
   monotonically increasing index starting at 0.
3. **Play strictly in `seq` order.** Requests complete out of order; use the echoed `X-MS-TTS-Seq`
   header (and your own `seq` counter) to enqueue, and only advance playback when the next-in-order
   clip has arrived.
4. **Fallbacks:** if a chunk returns a non-2xx (e.g. `429 rate_limited` or `502
   upstream_unavailable`), stop the per-sentence path for this message and fall back to the single-shot
   **play-after-complete** call (`stream` omitted) or the browser's `speechSynthesis`. Streaming TTS is
   a perceived-latency optimisation on top of the single-shot path, never a replacement for it.

**Voice settings (server-side).** Moved: backend doc `AI_MODELS.md`, "Voice (TTS)".

### Success response — streamed audio

```http
HTTP/1.1 200 OK
Content-Type: audio/mpeg
Cache-Control: no-store, no-cache, must-revalidate, max-age=0
X-MS-TTS-Truncated: false
X-MS-TTS-Chars: 67
X-MS-TTS-Seq: -1
```

The body is the MP3 byte stream — play it directly (e.g. an `<audio>` element via a blob/object URL,
or the Web Audio API).

- **Format = MP3 (`audio/mpeg`)**, chosen for the broadest mobile playback: iOS Safari does not decode
  Opus in an Ogg/WebM container in `<audio>`, MP3 plays on iOS Safari, Android Chrome and desktop.
- **Caching is off** (`no-store, …`) — audio is synthesized on demand.

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
| 502    | `upstream_unavailable` | Synthesis failed/threw, or no API key configured.                    |
| 500    | `internal_error`       | Anything else.                                                       |

> **Fallback contract:** on **any non-2xx** response — and specifically on `502
> upstream_unavailable` — the widget falls back to the browser's built-in `speechSynthesis`.
> `upstream_unavailable` is the documented, expected signal for "synthesis is down, use the local
> voice"; the widget does not surface an error to the user, it speaks locally instead.

### Voice + model configuration

Moved: backend doc `AI_MODELS.md`, "Voice (TTS)" (`TTS_MODEL`, `TTS_VOICE`, `TTS_INSTRUCTIONS`,
`TTS_SPEED`). Nothing the widget sends changes them.

### Cost attribution

Moved: backend doc `AI_MODELS.md`, "Voice (TTS)" (one usage row per request, streamed or not).

---

## 9. `POST /api/feedback`

Customer feedback capture: a free-text comment plus **optional context**, stored for the team (admin
„Feedback“). Behind the same guard as `/api/chat` — origin allowlist + `x-ms-chat-key` + rate limit —
with a **dedicated, tight rate-limit bucket** (`feedback`: 5 req / 5 min) and a hard **length cap** on
the comment.

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
  "page": "/produkte/atx-rack-pro", // storefront URL/path the user was on
  "locale": "de"                   // language of the validation / error messages, §12
}
```

- `message` is the only required field — non-empty after trimming, **≤4000 characters** (longer is
  rejected with `payload_too_large`, never silently cut). `feedback` is accepted as an alias for
  `message`.
- Every optional context field is trimmed and length-capped server-side (`sessionId`/`conversationId`
  ≤128, `tier` ≤40, `email` ≤254, `page` ≤1024); blanks become `null`.
- **`email` here is user-supplied contact context for this comment** (like `/api/contact`), **not** a
  consent record, and grants **no** permission.

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

---

## 10. `POST /api/attribution/token`

Mints (or returns the existing) **order-attribution token** for the widget's session — the opaque
marker the widget stamps onto the live storefront cart so a later purchase can be attributed to the
consultation (backend design: `ORDER_ATTRIBUTION.md`).

**The consent gate lives in the widget:** call this, and stamp the cart, only while the storefront's
Shopify Customer Privacy state allows analytics processing
(`window.Shopify.customerPrivacy.analyticsProcessingAllowed() === true`), re-checked at stamp time.

### Request

Same guards as `/api/capture-email`: origin allowlist + `x-ms-chat-key` + `x-ms-session`. No body
required.

```http
POST /api/attribution/token
Origin: https://www.motionsports.de
x-ms-chat-key: <shared secret>
x-ms-session: <session id>
```

### Response

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store
```
```json
{ "ok": true, "token": "…", "cartAttributes": { "_mo": "…" } }
```

`cartAttributes` is the exact object to pass to the storefront cart, unchanged and flat (§0 rule 7):

```js
fetch("/cart/update.js", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ attributes: cartAttributes }),
});
```

Stamp fail-silent; re-stamp before opening any Mo cart link and after each `add_to_cart` click (a
completed checkout clears the cart and its attributes).

**Lifetime and renewal.** One token per session: a repeated call returns the same token while it
exists. The backend deletes tokens on its retention schedule and on erasure (§11.1); the next call then
mints a new one. So the widget MAY call again after a live product consultation to pick up a
replacement for a token the backend deleted — a no-op while the token exists. The attribution window
counts from the token's minting — with the backend switch `MO_ATTRIBUTION_SESSION_ANCHOR` (default off
in code) on, from the session's latest product consultation before the order.

**Ending the marker.** The cart attribute is the widget's to remove: when the session ends (sign-out,
erase, a sign-in the server reports ended) or analytics consent is withdrawn, the widget SHOULD blank it
— `POST /cart/update.js` with every key of the cached `cartAttributes` set to `""` (same origin,
fail-silent, no consent check needed).

### Error responses

| Status | Code                   | When                                                       |
| ------ | ---------------------- | ---------------------------------------------------------- |
| 400    | `bad_request`          | Missing `x-ms-session` header.                             |
| 401    | `unauthorized`         | Missing / wrong shared secret.                             |
| 403    | `forbidden`            | Origin not in the allowlist.                               |
| 429    | `rate_limited`         | Shared `kpi` bucket (120 req / 60 s). `Retry-After` set.   |
| 503    | `upstream_unavailable` | No database configured / token could not be minted.        |
| 500    | `internal_error`       | Anything else.                                             |

---

## 11. Mail-link and server-to-server endpoints

The widget calls none of these. They are listed because they act on the data the widget creates
(consents, conversations, the signed-in customer). The widget's own erasure call,
`POST /api/account/erase`, is ACCOUNT_CONTRACT.md §7.5. The other mail-asset and provider endpoints (§1
"Not called by the widget") are backend matters.

### 11.1 Erasure — `POST /api/account/erase` and `GET/POST /api/erase-data`

Both run **the one erasure path** (`erasePerson`), the same one as the admin's „Löschen“.

- `POST /api/account/erase` — the signed-in widget XHR; shape and widget flow: ACCOUNT_CONTRACT.md §7.5.
- `/api/erase-data?token=…` (the „Daten löschen“ link in every marketing and campaign mail; the backend
  appends `&locale=en` for English recipients): `GET` renders a confirmation page with a button (mail scanners open links, so the
  link itself never deletes), `POST` (the button) erases. HTML pages: `200`; `400` for an invalid
  token; `503` when nothing could be erased; `500` on an unexpected failure.

What the widget needs to know:

- An erasure deletes the person's conversations and consent records **and** the KPI events and
  attribution tokens of their sessions; a later `POST /api/attribution/token` for such a session mints
  a new token (§10).
- Whether the shop account is erased too depends on `SHOPIFY_ERASURE_SYNC` (default off in code); the
  served `surface=erase` copy (§7.4) says which — the widget never words it itself.

What happens in Mo and on the Shopify side: backend doc `CONSENT_FLOW.md`, "Erasure".

### 11.2 `GET /api/r/{token}` — tracked mail links

A click on a link in a Mo mail is recorded (`clicked_at` + a server event, §5) and redirected with `302`.
The token is tried in this order:

| Token | Destination |
| --- | --- |
| 1:1 marketing send | The prefilled Shopify cart (discount code intact). |
| Campaign send, campaign CTA = shop (`cta_kind = 'shop'`, an `https://` URL) | That shop URL. |
| Campaign send, CTA = Mo (default) | The Mo deep link (`CAMPAIGN_MO_DEEPLINK_URL`) with `mo_c=<token>` appended; the widget passes it back as `campaignToken` on `POST /api/chat` (§2) so the chat it opens is counted for the send. |
| Bundle offer | The bundle's cart permalink while the offer is active; any other offer state (expired, archived, failed, pending) → a branded „Angebot abgelaufen“ page (`410`). |
| Unknown / pruned | The storefront cart (never an error page). |

`&locale=` on the link sets the language of the expired-offer page (the backend's link builders do not
append it yet, §12).

### 11.3 `POST /api/webhooks/shopify`

Moved: Shopify → backend only, never the widget. Signature verification and the topic handling are
backend internals — backend docs `CUSTOMERS.md` ("Shopify webhook topics") and `CATALOG_SYNC.md`
("Real-time stock webhook"). The only widget-visible effect is the server event
`mo_order_marker_unresolved` (§5).

---

## 12. Locale

The backend serves **two languages**. German is the default and unchanged; English is opt-in,
selected by the storefront path:

| Storefront path | Locale sent | Mo speaks | E-mails / pages |
| --------------- | ----------- | --------- | -------------- |
| `/de…` and everything else | `de` (or nothing) | German | German |
| `/en…` | `en` | English | English |

A missing, empty or unrecognised locale resolves to `de`, so a widget that sends none keeps the German
behaviour byte for byte.

### 12.1 Transports, precedence, normalisation

Per request, the first present value wins (`resolveLocale`, `src/lib/locale.ts`):

1. a **`locale` field in the JSON body** (the POST endpoints of §12.2 that read it),
2. the **`?locale=` query parameter**,
3. the **`x-ms-locale` header**,
4. `de`.

`normalizeLocale` (`src/lib/locale.mjs`) is tolerant: the primary subtag, case-insensitive — `en`,
`EN`, `en-GB`, `en_US` → `en`; anything else → `de`. It never fails a request.

`x-ms-locale` is in the CORS allow-list (§1 "Security model"), so it is safe on every endpoint; as a
custom header it makes a GET a preflighted request (the preflight is cached 24 h). Simplest
integration: send `x-ms-locale` on every backend call from `/en` (and `de` or nothing from `/de`).

### 12.2 Per endpoint

| Endpoint | Reads | Effect |
| --- | --- | --- |
| `POST /api/chat` | body, query, header | Mo's language, the model-facing tool texts, the context notes and the greeting; the `offer_email_summary` output carries the consent copy of this locale. Same persona, rules and tools in both. |
| `POST /api/capture-email` | body, query, header | Summary and DOI mail language, the stored consent locale, and the copy the echoed `consentTextShown` is compared against (§12.3). |
| `GET /api/consent-copy` | query, header | Every surface in that language: capture strings, `surface=signin` headline, label, footer and `benefits`, `surface=erase`, `surface=chat`; with `locale` and `enLegalReviewed`. |
| `POST /api/account/marketing-opt-in` | body, query, header | DOI mail language, stored locale, comparison against the `surface=signin` copy (§12.3). |
| `POST /api/chat-marketing-opt-in` (not used by the widget) | body, query, header | As the opt-in above, against `surface=chat`. |
| `POST /api/contact` | body, query, header | The response messages; the team mail stays German. Known gap: one `502` branch (mail provider exception) answers German on `/en`. |
| `POST /api/feedback` | body, query, header | Validation and error messages. |
| `GET /api/account/summary` | query, header | The PDF and its filename. |
| `GET /api/account/export` | query, header | The download filename and error messages. |
| `POST /api/account/erase` | query, header | Error messages. |
| `GET`/`PATCH`/`DELETE /api/account/conversations/{id}` | query, header | Error messages. |
| Mail links (`/api/confirm-marketing`, `/api/unsubscribe`, `/api/erase-data`, `/api/newsletter-rating`, `/api/r/{token}`) | `&locale=` on the link | Page language. The backend builds these links; the widget never does. The DOI, campaign-unsubscribe and erasure links carry the recipient's locale; `/api/r/{token}` links do not yet, so the expired-offer page is German. |

No locale is read by `/api/products`, `/api/kpi`, `/api/tts`, `/api/attribution/token`, `/api/auth/*`
and `GET /api/account/conversations` (no user-facing prose).

### 12.3 Consent copy per locale

- `GET /api/consent-copy?locale=en` returns the English strings of every surface, with `locale: "en"`
  and `enLegalReviewed`. The German copy is lawyer-approved; the English copy is approved as its
  faithful translation (since 2026-10-05), so `enLegalReviewed` is `true` for both locales. `version` is
  the same for both (`v5`); a wording change in either language is a new review and a new version.
- The `offer_email_summary` output carries the copy for the **chat's** locale, so an `/en` chat hands
  the widget English consent strings.
- **The locale of a consent POST must match the copy that was rendered:** `POST /api/capture-email`
  with the locale of the default copy (or tool output) it echoes, `POST /api/account/marketing-opt-in`
  with the locale of the `surface=signin` copy. The backend stamps `consent_copy_version` only when the
  echoed `consentTextShown` is byte-identical to the served copy **of the POST's locale**; on a mismatch
  the consent is stored with a `NULL` stamp, and the DOI mail goes out in the POST's locale.

### 12.4 Intentionally not localised

- **Catalog data** (product names, descriptions, specifications) is German; on `/en` Mo discusses it in
  English prose. Product Q&A carries English fields where the translation ran (§3).
- The **team mail** of `/api/contact` and the admin dashboard are German.
- A few **technical messages** (`"Invalid JSON body"` on some routes, `"Unexpected server error"`,
  `"Too many requests"`, the `/api/tts` and `/api/products` errors) are English in both locales.
- **Campaign mails** follow the recipient's language as the backend determines it (backend doc
  `CAMPAIGNS.md`), not the widget's locale.

---

## Appendix A — Changes since 2026-10-01

All additive: no existing field changed, and a widget that ignores them keeps working. Each row names the
section that holds the fact; this table repeats none of the detail.

| Date | Change | Where |
| --- | --- | --- |
| 2026-10 | `GET /api/consent-copy?surface=chat` carries `signIn` (UI chrome). | §7.4 |
| 2026-10 | New `GET /api/consent-copy?surface=erase` — the copy for „Meine Daten löschen“. | §7.4; ACCOUNT_CONTRACT.md §7.5 |
| 2026-10 | An address that already holds the marketing consent (Shopify or an earlier DOI) gets no DOI mail: `confirmed`, `alreadyConfirmed: true`, `doiEmailSent: false`. | §7 |
| 2026-10 | `/api/auth/me` `marketing.status` reflects the one consent shared with Shopify. | ACCOUNT_CONTRACT.md §4 |
| 2026-10 | `POST /api/account/erase` also reaches Shopify; response unchanged. | §11.1; ACCOUNT_CONTRACT.md §7.5 |
| 2026-10 | `POST /api/chat` accepts `campaignToken` (the `mo_c` value of a campaign mail link); the server counts „Chat gestartet“ once per send, session-less. | §2 "Optional `campaignToken`", §11.2 |
| 2026-10 | „Already subscribed“ only for an address not on the suppression list; an unconfirmed `pending` opt-in falls back to „no consent“ one day after the DOI link expired, so the opt-in may be offered again. | §7; ACCOUNT_CONTRACT.md §6.1 |
| 2026-10 | New background tool `get_order_status` (behind `CHAT_ORDER_STATUS_ENABLED`, default off in code): render nothing, keep it in the history; any unknown tool renders nothing. | §2 "Tools the widget MUST NOT render"; history wipe: ACCOUNT_CONTRACT.md §5.1 |
| 2026-10-01 | Widget KPI events `login_gate_*`, `account_signin_started { source }`, `account_signin_return { result }`, `consent_gate_* { surface: "signin" }`; joined by session to the server's sign-in events, so KPI `sessionId`, `x-ms-session` and the login's `session` must be the same id. | §5 |
| 2026-10-01 | `GET /api/consent-copy?surface=chat` and `POST /api/chat-marketing-opt-in` are no longer used by the widget (the sign-in popup replaced the anonymous e-mail gate); still served. `starter_*` events retired. | §7.4, §7.6, §5 |
| 2026-10-03 | A sign-in links the chat only after the widget redeems the one-time code (`POST /api/auth/link`); new server events `account_signin_linked`, `account_signin_link_refused`. | ACCOUNT_CONTRACT.md §2a; §5 |
| 2026-10-04 | `POST /api/kpi` acknowledges server-only event names with `202` and does not store them. | §5 |
| 2026-10-04 | `POST /api/contact` takes an optional body `sessionId` for `contact_form_submitted` (fallback: the `x-ms-session` header). | §4 |
| 2026-10-05 | Shop-login recognition (App Proxy): whoami answers `signedIn: true` only together with a `linkCode`; new server event `account_shop_recognised`; `account_signin_linked` gains `renewed`, `account_signin_link_refused` an optional `kind`. | ACCOUNT_CONTRACT.md §3a; §5 |
| 2026-10-05 | `surface=signin` serves `benefits` (1–4 bullets, never in `consentTextShown`) and `variant`; the copy version is `v5` on every surface; with more than one active variant the variant is assigned per `x-ms-session` and the response is `private, no-store`. | §7.4; rendering: CONSENT_CONTRACT.md §3.1 |
| 2026-10-05 | Optional `placement` and `variant` on `POST /api/account/marketing-opt-in` and in the `consent_gate_*` KPI data (telemetry only, never a 400); the opt-in server events gain `placement`, `variant`, `alreadyConfirmed`, `doiRequired`, `variantMismatch`. | ACCOUNT_CONTRACT.md §6.2; §5 |
| 2026-10-05 | The opt-in server events carry `source` / `outcome`; `email_capture_marketing_confirmed` carries `{ source }`; `/api/capture-email` stores `trigger` only for the five tool values. | §5, §7.1 |
| 2026-10-05 | A suppressed address is answered `status: "none"`, `alreadyConfirmed: false` on all three opt-in endpoints. A capture submit without the marketing tick keeps a still-pending DOI (`pending`). | §7, §7.1 |
| 2026-10-05 | `context.source` (`page` \| `cta` \| `nudge`) on `POST /api/chat`; `page` = page facts on a typed or spoken turn, two accepted shapes, used only behind `CHAT_PAGE_CONTEXT_ENABLED` (default off in code) with an optional control group. New server events `page_context_applied` / `page_context_answered`. | §2 "Optional `context`"; §5 |
| 2026-10-05 | `product_cta_clicked` may carry `samePage: boolean`. | §5 "Product clicks (widget)" |
| 2026-10-05 | `offer_email_summary` is no longer offered to a signed-in session. | §2 |
| 2026-10-05 | New server event `mo_order_marker_unresolved` (marked orders the backend cannot attribute). | §5 |
| 2026-10-05 | Attribution token: a repeated call returns the same token while it exists and a new one after the backend deleted it (retention, erasure); the widget may call again after a live consultation and blanks the `_mo` attribute when the session ends. | §10 |
| 2026-10-05 | English consent copy approved as the translation: `enLegalReviewed: true` for `en`. | §12.3 |
