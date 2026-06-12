# Backend contract audit — internal consistency + frontend ground truth

**Date:** 2026-06-12 · **Scope:** every public/admin endpoint, every assistant tool,
the consent/DOI/suppression flow, discount behavior, catalog sync, and all docs in
`docs/` (root + `docs/frontend-handoff/`). Read-only audit; no application code was
changed.

**Method:** every documented claim was traced to the implementing source file; the
`/api/chat` SSE wire format was additionally verified **empirically** by running
`streamText(...).toUIMessageStreamResponse()` against a mock model with the repo's
pinned `ai@6.0.103` and capturing the raw response body.

---

## VERDICT: ⚠️ ISSUES

The backend is in very good shape: every endpoint, guard, tool schema, consent rule,
discount rule, and KPI constant matches its documentation. **One high-severity doc
defect exists**: the docs describe the `/api/chat` stream as *assembled UI-message
parts*, but the wire actually carries the AI SDK's lower-level *stream chunks*
(`text-delta`, `tool-input-available`, …). A vanilla-JS widget implementing the docs
verbatim would render nothing. Several low/info findings follow. Nothing found
contradicts the consent/legal guarantees — those all hold in code exactly as
documented.

| # | Severity | Finding |
|---|----------|---------|
| A1 | **HIGH** | Documented SSE event shapes don't exist on the wire (parts vs chunks) |
| A2 | LOW | `state: "result"` / `tool-<name>-partial`/`-result` types are AI-SDK-v4-era; v6 uses different state values and never suffixes the type |
| A3 | LOW | Undocumented chat response headers (`Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`) |
| A4 | INFO | `x-ms-session` documented as "required" but never enforced server-side |
| A5 | INFO | §1 security bullet omits that `/api/capture-email` also requires the shared secret (§7.1 states it correctly) |
| A6 | LOW | `trigger` echo on `/api/capture-email` silently truncated to 40 chars — undocumented |
| A7 | INFO | `transactional.summarySent: true` is also returned when Resend is unconfigured (local-dev "skipped") |
| A8 | LOW | `ADMIN_DASHBOARD.md` references a non-existent "§10"; the `/api/r/<token>` redirect endpoint (incl. its fallback behavior) is undocumented |
| A9 | LOW | Server-emitted `marketing_email_clicked` KPI event is in no doc's event list |
| A10 | LOW | `DATA_RETENTION.md` stale in three places (FK claim, missing customers-purge step, "consent flow … future work") |
| A11 | INFO | `REPO_AUDIT.md` is historical ("only two HTTP endpoints") and not marked superseded |
| A12 | INFO | Stale code comment: `admin-auth.ts` says it's imported by `src/middleware.ts`; the file is `src/proxy.ts` |
| A13 | INFO | The live-chat system prompt never names the assistant "Mo", though every doc and the marketing-draft prompts do |

---

## Section 1 — Backend ↔ docs mismatches

### A1 (HIGH) — The documented stream events are not what the wire carries

**Docs:** `docs/API_CONTRACT.md:254-311` (identical in
`docs/frontend-handoff/API_CONTRACT.md:261-318`), `docs/frontend-handoff/WIDGET_SPEC.md:148-163`
(§5 steps 3–4), `docs/frontend-handoff/BEHAVIOR_REFERENCE.md:17-69`.

**Code:** `src/app/api/chat/route.ts:388-394` returns
`result.toUIMessageStreamResponse(...)` from `ai@6.0.103` (`package.json:25`).

The docs claim *"Each event is a JSON-encoded UI-message **part**"* and give these
example events:

```jsonc
{ "type": "text", "text": "…" }
{ "type": "tool-show_product", "toolCallId": "…", "state": "result", "input": { … } }
```

**Neither shape ever appears on the wire.** Verified by capturing the actual body
produced by `toUIMessageStreamResponse()` (mock model, one text + one
`show_product` tool call):

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

The documented shapes are the **assembled `UIMessage` parts** that `@ai-sdk/react`'s
`useChat` produces *client-side* from these chunks — i.e. what the old React widget
saw. They are correct as a rendering model but wrong as a wire description, and
`WIDGET_SPEC.md:148-152` explicitly instructs the vanilla-JS widget to *"parse each
`data:` JSON event into a part"* and dispatch on `part.type === "tool-<name>"` —
which matches nothing in the real stream. A widget built strictly to these docs
renders an empty conversation.

**Fix direction (docs, not code):** document the chunk vocabulary (Section 2 below)
plus the chunk→part assembly rules, or instruct the widget to use the AI SDK's
client assembly. The rendering guidance itself (one bubble per text id, one card per
`toolCallId`, silent tools) stays valid once assembly is in place.

### A2 (LOW) — Tool-part `state` values and type suffixes are stale

**Docs:** `docs/API_CONTRACT.md:290-295` ("may also stream … `"tool-<name>-partial"`
or `"tool-<name>-result"`"), every example part (`"state": "result"`, e.g.
`docs/API_CONTRACT.md:320-325`), `docs/frontend-handoff/BEHAVIOR_REFERENCE.md:44-55`.

In AI SDK v5/v6 an assembled tool part's `type` is always exactly `tool-<name>`
(never suffixed), and `state` is one of `input-streaming` | `input-available` |
`output-available` | `output-error` — `"result"`/`"partial"` do not exist. The
recommended `startsWith` matching is harmless, but a widget that gates rendering on
`state === "result"` would never render. On the wire (A1) the equivalents are the
`tool-input-start` → `tool-input-delta` → `tool-input-available` →
`tool-output-available` chunk sequence.

### A3 (LOW) — Undocumented chat response headers

`src/app/api/chat/route.ts:388-394` sets `Cache-Control: no-cache, no-transform` and
`X-Accel-Buffering: no` on the stream response; `toUIMessageStreamResponse` also adds
`x-vercel-ai-ui-message-stream: v1`. `docs/API_CONTRACT.md:257-263` documents only
`Content-Type` + CORS. Harmless, but the protocol header is a useful client-side
sanity check and worth documenting.

### A4 (INFO) — `x-ms-session` is documented "required" but never enforced

`docs/API_CONTRACT.md:73-80` lists `x-ms-session` under "Required request headers";
the code never rejects a request without it — `src/lib/rate-limit.ts:60-66` just
falls back to the IP for the bucket key, and `src/app/api/chat/route.ts:172` tolerates
`null` (conversation persistence is then skipped). Doc is stricter than code; fine as
a widget instruction, but it's not a server-side requirement.

### A5 (INFO) — §1 omits `/api/capture-email` from the shared-secret list

`docs/API_CONTRACT.md:39-46` says the secret is "Required on `/api/chat` and
`/api/contact`". `src/app/api/capture-email/route.ts:69` uses the same
`guardRequest` (secret required). §7.1 (`docs/API_CONTRACT.md:912-914`) and
`WIDGET_SPEC.md:319-324` state this correctly — only the §1 overview bullet is
incomplete.

### A6 (LOW) — `trigger` truncated to 40 chars, undocumented

`src/app/api/capture-email/route.ts:43,93-96` silently truncates the echoed
`trigger` to 40 characters. All five canonical values fit; only the truncation
itself is undocumented (`docs/API_CONTRACT.md:926-932`).

### A7 (INFO) — `summarySent: true` when email delivery is unconfigured

`src/app/api/capture-email/route.ts:160-170,199`: when Resend isn't configured the
send is `skipped` and the response still reports
`transactional: { summarySent: true }`. The doc (`docs/API_CONTRACT.md:969-984`)
reads as "delivered". Local-dev-only behavior, but worth a sentence in the doc.

### A8 (LOW) — Dangling "§10" / undocumented `/api/r/<token>` behavior

`docs/ADMIN_DASHBOARD.md:332` and `:387` both say "(see §10)", but the document ends
at §9 — the tracked-redirect endpoint has no section. The endpoint exists
(`src/app/api/r/[token]/route.ts`) and has behavior worth documenting: an
unresolvable/expired token or a row without a cart **302-redirects to the storefront
cart** (`https://motionsports.de/cart`) instead of erroring, and every click inserts
a `marketing_email_clicked` KPI event (see A9), with `clicked_at` stamped on the
first click only (`src/lib/marketing-store.ts:358-401`).

### A9 (LOW) — `marketing_email_clicked` event undocumented

`src/lib/marketing-store.ts:388-395` emits a `marketing_email_clicked` `kpi_events`
row (`data: { sendId, captureId, firstClick }`, `session_id = NULL`) on **every**
redirect click. It appears in no doc: not in `docs/API_CONTRACT.md` §5's canonical
list (which is scoped to the capture funnel, fine) and not in
`docs/ADMIN_DASHBOARD.md` §5. Note it also matches neither KPI-tab ILIKE pattern
(`%product%click%`/`%cta%click%`, `%cart%`/`%checkout%` —
`src/lib/kpi-store.ts:70-71`), so it surfaces only in the raw event breakdown.

### A10 (LOW) — `DATA_RETENTION.md` is stale in three places

1. `docs/DATA_RETENTION.md:7-10`: "kept structurally separate (**no foreign key
   linking them**)" — stale since migration `0008_customers.sql`:
   `conversations.customer_id` and `email_captures.customer_id` FKs exist
   (`ON DELETE SET NULL`). `docs/DATABASE.md:108-124` documents the exception
   correctly; the two docs now disagree.
2. `docs/DATA_RETENTION.md:73-103`: the enforcement list has 4 steps and the sample
   response omits `purgedSuppressedCustomers` — the code runs a 5th step purging
   `customers` rows (`src/lib/retention.ts:132-146`, surfaced in the result at
   `:153`). `docs/CUSTOMERS.md:93-100` documents the customers purge; this doc
   wasn't updated.
3. `docs/DATA_RETENTION.md:109`: "The consent flow and a self-service erasure path
   are **future work**" — the consent flow shipped (`CONSENT_FLOW.md`, fully
   implemented). Only self-service erasure is still future work.

### A11 (INFO) — `REPO_AUDIT.md` is historical

`docs/REPO_AUDIT.md` describes the conversion to "a headless backend that exposes
only two HTTP endpoints" — the backend now has 9 public + 6 admin + 2 cron routes.
Harmless as history, but it should carry a "superseded" banner so nobody treats it
as current.

### A12 (INFO) — Stale code comment (not a doc)

`src/lib/admin-auth.ts:7-9` says the module "is imported by `src/middleware.ts`";
the actual file is `src/proxy.ts` (Next 16 proxy convention).
`docs/ADMIN_DASHBOARD.md:33` is correct.

### A13 (INFO) — The chat prompt never names "Mo"

Docs, the consent copy ("Mo darf sich mich merken"), and the marketing-draft prompts
(`src/lib/marketing-draft.ts:30,197,369`) all name the persona **Mo**, but the live
chat system prompt introduces the assistant only as "der KI-Fitnessberater von
motion sports" (`src/lib/system-prompt.ts:301`). If a user asks "Wer ist Mo?" after
reading the marketing checkbox, the assistant has no grounding. Cosmetic.

### Verified as matching (no action)

Everything else checked out exactly — notable confirmations:

- **Tool definitions** (`src/lib/tools.ts`) match the documented input schemas
  field-for-field: `show_product`, `compare_products` (2–3 ids), `add_to_cart`
  (`productId` XOR/OR `productIds`, ≥1 required via `.refine`), `suggest_showroom`,
  `show_contact_form` (7-value reason enum), `offer_email_summary` (5-value trigger
  enum; result carries `{ ok, consentCopy }` — `tools.ts:319`), plus the silent
  `update_customer_profile` / `search_products`.
- **Two-ask cap** enforced server-side by withholding the tool
  (`tools.ts:72,274`, `chat/route.ts:223-226`), exactly as `CONSENT_FLOW.md` claims;
  attaching `customer.email` also suppresses the offer.
- **`context` validation**: product id validated against the catalog
  (`chat/route.ts:118-130`); trail capped at 3 products / 2 categories / first 20
  entries scanned (`browsing-context.ts:39-42`); category `id` ignored
  (advisory) and labels fuzzy-matched with plural folding; canonical names win;
  graceful ignore everywhere. Fresh-open greeting vs pivot-note behavior matches
  the doc (`chat/route.ts:267-289`), including "product greeting wins" and context
  products grounded in the pre-retrieved block (`:253-262`).
- **Customer memory gate**: `wasEmailCapturedFromSession` cross-check, fail-closed,
  new-email → null (`customer-memory.ts:74-129`) — matches §2 exactly.
- **Consent flow**: two separate consents, `transactionalConsent === true` enforced
  (`capture-email/route.ts:102`), one record per email, suppressed never re-pended,
  confirmed preserved (`email-capture-store.ts:159-235`), DOI expiry
  `MARKETING_DOI_EXPIRY_DAYS` default 7 with 410 on expired (`confirm-marketing`),
  signed HMAC unsubscribe token + suppression + DOI revoke, `isSuppressed`/
  `canSendMarketing` fail-closed — all exactly as `CONSENT_FLOW.md`.
- **Canonical consent copy** served on both documented paths
  (`offer_email_summary` result + `GET /api/consent-copy`), built from one source
  (`consent-copy.ts:136-148`), `lawyerApproved: false`, 60s cache.
- **Discounts**: mint at send only, `MS5-` prefix, 7-day expiry
  (`MARKETING_DISCOUNT_EXPIRY_DAYS`), `usageLimit: 1` + `appliesOncePerCustomer`,
  placeholder `MO-XXXX` swapped 1:1 incl. stale projected expiry date, refusal on
  mint failure, deterministic non-editable code/expiry/unsubscribe lines, atomic
  draft→approved→sent claim (`marketing-email.ts`, `shopify-discounts.ts`,
  `marketing-store.ts`). Stacking/sale-item exclusion correctly documented as
  out of scope (`DISCOUNTS.md`).
- **Welcome discount**: `WELCOME-` prefix, default 5 % (clamped 1–50), 30-day
  expiry, DOI-completion trigger, atomic once-ever claim with mint-failure release,
  record-before-send, suppression/unsubscribe gates, prompt framing rules incl.
  returning-customer suppression (`welcome-discount.ts`, `system-prompt.ts:154,237-245`).
- **Selected vs discussed** product sets and `chooseCartProductIds` preference,
  replacement semantics of the latest `add_to_cart`, sold-out exclusion in every
  cart-link builder (`conversation-store.ts`, `cart.ts`, `summary-email.ts`,
  `/api/products`).
- **/api/products**: both query forms, order-preserving de-dupe, 10-id cap →
  `400 payload_too_large`, nulls for unknown ids, `shopifyCartUrl` omitted when
  sold out or unresolvable, top-level `cartUrl` excludes sold-out, numeric-variant
  rule, 60 s cache (`products/route.ts`, `shopify-cart-url.mjs`).
- **/api/kpi**: 202-even-on-failure, 120/60 s bucket, `data` object-only,
  `clientTimestamp` preservation, all five canonical funnel event names + emitters
  (`kpi/route.ts`, `kpi-events.ts`, `capture-email`, `confirm-marketing`,
  `chat/route.ts:341-357`).
- **Rate limits** 20/60/120 per 60 s, `sid:`/`ip:` keying, `Retry-After`
  (`rate-limit.ts`); **error envelope** uniform (`observability.ts:101-115`).
- **Admin dashboard**: proxy gate + `guardAdminPost` (415 on non-JSON),
  `ms_admin_session` 12 h HMAC cookie with `CHAT_SHARED_SECRET` fallback,
  fails closed; draft/update/send and per-customer draft endpoints match the
  documented request shapes incl. depth ∈ {0,5,10,15}, idempotent reuse,
  instructions snapshot, `MAX_ADMIN_INSTRUCTIONS_CHARS` 2000; eligibility SQL
  identical in `listMarketingTargets`/`loadEligibleCapture(ByEmail)`; funnel
  caps (100 codes) and KPI constants (80-message sample, 100-contact loop cap,
  ILIKE patterns, 180-day lookback) all match.
- **Catalog sync**: blob keys, cron `0 3 * * *` + retention `30 3 * * *`
  (`vercel.json`), client-credentials grant with 5-min refresh buffer, metafield
  label resolution priority `label→name→title→value` with `"—"` sentinel + warning
  log, `inStock` derivation chain incl. permissive fallback, GET+POST accepted,
  fallback-bundle mode (`shopify.ts`, `catalog-mapping.ts`, `catalog-store.ts`,
  `cron/sync-catalog/route.ts`). `.env.example` exists as referenced.
- **Retention**: windows/env defaults 180/180/30 min/30 d grace, suppression list
  kept (`retention.ts`) — modulo A10.
- Migrations `0001`–`0010` all present and match the docs that cite them.

---

## Section 2 — Frontend ground-truth spec (derived from code; code is truth)

Base URL (production): `https://chat.motionsports.de`. All paths below are relative.

### 2.0 Conventions

- **Error envelope** (every non-streaming error): `{ "error": { "code": string,
  "message": string } }` — codes: `bad_request`, `unauthorized`, `forbidden`,
  `rate_limited`, `payload_too_large`, `upstream_unavailable`, `internal_error`.
  Detect with `!response.ok`, then branch on `error.code`. A non-200 from
  `/api/chat` is this JSON envelope, **not** a stream — check status before reading
  the body as a stream.
- **CORS**: cross-origin requests are honored only from `ALLOWED_ORIGINS`
  (default `https://www.motionsports.de`, `https://motionsports.de`). Preflight
  `OPTIONS` → 204 with `Access-Control-Allow-Methods` (`POST, OPTIONS`, or
  `GET, OPTIONS` for products/consent-copy) and
  `Access-Control-Allow-Headers: Content-Type, x-ms-chat-key, x-ms-session`;
  non-allowlisted origin → 403 (empty body on preflight, JSON envelope on the
  actual request, **without** CORS headers — the browser will surface a CORS error).
- **Session id**: generate once, persist in `localStorage` (`ms-chat-sid`,
  `crypto.randomUUID()`), send as `x-ms-session` on every request. Not enforced
  server-side (A4), but it keys rate limiting (`sid:<id>`, IP fallback) and the
  conversation persistence that the summary email / consent flow depend on — **the
  capture flow only works correctly when the chat requests and the capture share
  the same session id.**
- **Rate limiting** (sliding window, 60 s): `chat` bucket 20 (used by `/api/chat`,
  `/api/contact`, `/api/capture-email`), `products` bucket 60 (`/api/products`,
  `/api/consent-copy`), `kpi` bucket 120 (`/api/kpi`). 429 carries
  `Retry-After: <seconds>` — disable input for that long.
- **Shared secret** `x-ms-chat-key` (value of `CHAT_SHARED_SECRET`): required on
  `/api/chat`, `/api/contact`, `/api/capture-email`. Wrong/missing → 401
  `unauthorized`. NOT required on `/api/products`, `/api/consent-copy`, `/api/kpi`.

### 2.1 `POST /api/chat` — request

Headers: `Content-Type: application/json`, `x-ms-chat-key`, `x-ms-session`.

Body:

```jsonc
{
  "messages": [ /* UIMessage[]: { id, role, parts: [{ type: "text", text }] } — FULL history every turn */ ],
  "context": {                       // optional
    "type": "product" | "browsing",  // anything else ⇒ whole context ignored
    "productId": "catalog-id",       // type "product" only; validated vs catalog
    "productTitle": "advisory",      // ignored; canonical catalog name wins
    "recentlyViewed": [               // optional on both types; first 20 scanned
      { "type": "product", "id": "...", "name": "..." },   // id validated; max 3 kept
      { "type": "category", "id": "...", "name": "..." }   // name matched; id ignored; max 2 kept
    ]
  },
  "customer": { "email": "..." }     // optional; ONLY after /api/capture-email
                                     // succeeded in THIS session; in-memory only
}
```

Rules enforced by the code:

- `messages` not an array → 400 `bad_request`. `messages.length > 40` → 400
  `payload_too_large` (message: "Conversation too long (max 40 messages). Please
  start a new chat.") — surface "start a new chat" UX.
- `messages: []` + valid context ⇒ the backend itself triggers a context-aware
  greeting (the widget renders the streamed assistant turn; no user message needed
  and none is fabricated client-side).
- Invalid/unknown context or `customer.email` ⇒ ignored gracefully, never an error.
- Attaching `customer.email` (after a successful capture) **disables further
  `offer_email_summary` tool calls** for the session; the offer is also withheld
  after 2 prior asks. Memory resolves only when the email's capture row carries
  this exact session id.

### 2.2 `POST /api/chat` — response (the REAL wire protocol)

`200 OK`, `Content-Type: text/event-stream`,
`x-vercel-ai-ui-message-stream: v1`, `Cache-Control: no-cache, no-transform`,
`X-Accel-Buffering: no`, CORS headers. Body is SSE: lines of
`data: <JSON>` separated by blank lines, terminated by `data: [DONE]`.
Parse with `fetch` + `response.body.getReader()` + `TextDecoder` (not
`EventSource`), buffering by line.

**Chunk vocabulary** (AI SDK v6 `UIMessageChunk`; empirically verified against
`ai@6.0.103`):

| `type` | Payload fields | Widget action |
|---|---|---|
| `start` | — | begin a new assistant message |
| `start-step` / `finish-step` | — | ignore (model can run up to **6 steps** per turn — `stepCountIs(6)`) |
| `text-start` | `id` | open a text part keyed by `id` |
| `text-delta` | `id`, `delta` | **append** `delta` to that text part's bubble |
| `text-end` | `id` | text part complete |
| `tool-input-start` | `toolCallId`, `toolName` | open a tool part keyed by `toolCallId` (render nothing yet) |
| `tool-input-delta` | `toolCallId`, `inputTextDelta` | streaming JSON of the args; safe to ignore |
| `tool-input-available` | `toolCallId`, `toolName`, `input` | args complete → **render the card now** (dispatch on `toolName`, read `input`) |
| `tool-output-available` | `toolCallId`, `output` | tool result → for `offer_email_summary` this carries the load-bearing `output.consentCopy`; others return `{ ok: true }` |
| `error` | `errorText` | show the friendly retry message |
| `finish` | — | finalize message, re-enable input |
| `[DONE]` (literal) | — | stream end |

Notes:

- `toolName` is the **bare** name (`show_product`), not `tool-show_product`. If you
  assemble AI-SDK-style parts, the part type becomes `tool-${toolName}` and `state`
  progresses `input-streaming → input-available → output-available` (never
  `"partial"`/`"result"`).
- Key cards by `toolCallId` and update in place; render only once `input` exists
  (`tool-input-available`).
- A reconnecting/duplicated chunk for a known `toolCallId` must replace, not append.
- Unknown chunk types (e.g. `reasoning-*`, `tool-output-error`) must be ignored
  defensively.
- The route's `maxDuration` is 300 s — long consultations can stream for minutes;
  don't impose a short client timeout.

### 2.3 The seven tools (exact input schemas from `src/lib/tools.ts`)

**Render these five** (hydrate product data via `/api/products`):

| toolName | `input` schema | output |
|---|---|---|
| `show_product` | `{ productId: string; reason?: string }` | `{ ok: true }` |
| `compare_products` | `{ productIds: string[] /* 2–3 */; comparisonContext?: string }` | `{ ok: true }` |
| `add_to_cart` | `{ productId?: string; productIds?: string[] /* min 1 */; message: string }` — at least one of the two id fields | `{ ok: true }` |
| `suggest_showroom` | `{ productIds: string[] }` | `{ ok: true }` |
| `show_contact_form` | `{ reason: "studio_consultation"\|"public_sector_quote"\|"physio_consultation"\|"bulk_discount"\|"leasing"\|"maintenance"\|"general"; message: string; productIds?: string[] }` | `{ ok: true }` |

**Render as capture form:**

`offer_email_summary` — input
`{ message: string; trigger: "recommendation_accepted"|"comparison_delivered"|"consideration_pause"|"buying_intent"|"checkout_intent"; productIds?: string[] }`.
Its `tool-output-available` chunk carries:

```jsonc
{
  "ok": true,
  "consentCopy": {
    "transactionalLabel": string,   // checkbox A label (MAY pre-check)
    "marketingLabel": string,       // checkbox B label (MUST start unchecked)
    "marketingBenefitHint": string, // render directly beneath B's label
    "consentTextShown": string,     // echo back VERBATIM on /api/capture-email
    "imprintUrl": string,
    "privacyUrl": string,
    "lawyerApproved": boolean       // currently false
  }
}
```

`consentTextShown` is composed server-side as
`` `${transactionalLabel} | ${marketingLabel} ${marketingBenefitHint}` `` — never
recompose it client-side; never hard-code any of these strings.

**Consume silently (never render):** `update_customer_profile` (profile patch
object), `search_products` (input `{ query, filters?, limit? }`; output
`{ totalMatched, products: [{ id, name, category, price, shortDescription, score }] }`
streams in `tool-output-available` — ignore it).

`add_to_cart` normalisation: `const ids = input.productIds ?? [input.productId]`;
hydrate via `GET /api/products?ids=…` and link the button to the response's
top-level `cartUrl` (multi) / `shopifyCartUrl` (single); hide the button when the
link is absent (sold-out / unresolvable — the backend guarantees sold-out products
never get a checkout link).

### 2.4 `GET /api/products`

No secret; allowlisted origin + `x-ms-session` recommended. Query:
`?ids=a,b,c` and/or repeated `?id=` (equivalent; trimmed; order-preserving
de-dupe). 0 ids → 400 `bad_request`; > 10 ids → 400 `payload_too_large`.

Response `200`, `Cache-Control: public, max-age=60, stale-while-revalidate=300`:

```ts
{
  products: (PublicProduct | null)[];  // request order; null per unknown id
  cartUrl: string | null;              // ONE permalink for ALL resolvable,
                                       // IN-STOCK requested products; no discount
}
type PublicProduct = {
  id: string; name: string; slug: string; brand: string; category: string;
  series?: string;            // may be JSON null in older catalog data
  price: number; salePrice?: number; currency: "EUR";
  shortDescription: string; features: string[];
  specifications: Record<string, string | number>;
  tags: string[]; images: string[]; shopifyUrl: string;
  shopifyCartUrl?: string;    // OMITTED when sold out or no numeric variant
  inStock: boolean;           // sync-fresh (daily cron), not live
  inventoryQuantity?: number; anyVariantAvailable?: boolean;
  deliveryTime: string;
}
```

`dimensions` / `targetGroup` are NOT exposed — build comparison tables from
`specifications`, price, `deliveryTime` only.

### 2.5 `POST /api/contact`

Headers like `/api/chat`. Body:
`{ reason, productIds?, name, email, organization?, phone?, message }`.
Validation: `name`/`message` non-empty after trim; email
`/^[^@\s]+@[^@\s]+\.[^@\s]+$/`; `reason` any string (unknown values render verbatim
in the email subject). Success `200 { "ok": true }` (also when email delivery is
unconfigured locally). Errors: 400/401/403/429 (chat bucket), 502
`upstream_unavailable` (Resend failed), 500.

### 2.6 `POST /api/kpi`

No secret. Body: `{ event: string /* required, ≤120 chars */, sessionId?,
timestamp? /* number|string */, data? /* plain object only */ }`. Returns
`202 { "ok": true }` even when the DB write fails. Errors: 400 (bad JSON /
missing/too-long event), 403, 429 (kpi bucket, 120/60 s), 500.

Widget-emitted event: **`email_capture_declined`** with
`data: { trigger, askNumber? }` when the capture card is dismissed without
submitting. Do NOT emit shown/submitted/opted-in/confirmed — those are
server-side (`email_capture_ask_shown`, `email_capture_submitted`,
`email_capture_marketing_opted_in`, `email_capture_marketing_confirmed`).

### 2.7 `POST /api/capture-email`

Headers like `/api/chat`. Body:

```jsonc
{
  "sessionId": "...",            // optional; falls back to x-ms-session header
  "email": "...",                // required, validated + normalised (trim/lower)
  "transactionalConsent": true,  // MUST be literally true, else 400
  "marketingConsent": false,     // independent; never pre-tick the checkbox
  "consentTextShown": "...",     // backend-served string, echoed byte-for-byte
  "trigger": "..."               // optional echo of the offer's trigger (≤40 chars kept)
}
```

Success `200`:

```jsonc
{
  "ok": true,
  "transactional": { "summarySent": true },
  "marketing": {
    "status": "none" | "pending" | "confirmed",
    "doiEmailSent": boolean,
    "alreadyConfirmed": boolean   // true on re-submission by a confirmed address
  }
}
```

Show the summary confirmation; when `marketing.status === "pending"`, add the
"bitte bestätige …" hint. After success the widget MAY attach
`customer.email` to subsequent `/api/chat` calls **of this session, in memory
only** — never persist it. Errors: 400 (invalid email / consent), 401, 403,
429 (chat bucket), **502** `upstream_unavailable` (summary delivery failed — consent
is already stored; let the user retry), **503** `upstream_unavailable` (no DB —
consent could not be stored), 500. A DOI-email failure does NOT fail the request.

### 2.8 `GET /api/consent-copy`

No secret; products bucket (60/60 s); `Cache-Control: public, max-age=60,
stale-while-revalidate=300`. Returns exactly the `consentCopy` object of §2.3
(top-level, not nested). Use it for any capture form not triggered by the tool;
fetch fresh per form render, don't persist across sessions.

### 2.9 Email-clicked endpoints (never called by the widget)

`GET /api/confirm-marketing?token=…` and `GET /api/unsubscribe?token=…` return
HTML pages (200 / 400 / 410 expired / 503 no-DB / 500), no CORS or secret.
`GET /api/r/<token>` 302-redirects (marketing-email cart link). Listed only so the
widget never needs to handle them.

### 2.10 Consent-form rendering rules (legally load-bearing)

1. Two **separate** checkboxes. Transactional MAY be pre-checked; marketing MUST
   start unchecked (prominence fine, pre-tick never).
2. Render only the backend-served strings; echo `consentTextShown` verbatim.
3. Show `imprintUrl`/`privacyUrl` next to the form
   (`target="_blank" rel="noopener noreferrer"`).
4. Emit `email_capture_declined` exactly once on dismissal.

---

## Section 3 — Stale-doc check (`docs/frontend-handoff/`)

- **`frontend-handoff/API_CONTRACT.md` is in sync with the root doc.** Verified by
  diff: after the 7-line "Synced copy" preamble the body is **byte-identical** to
  `docs/API_CONTRACT.md`. No divergence — but it therefore inherits findings
  **A1/A2** (the stream-shape defect) verbatim, at lines 261–318 / the example
  parts throughout §2.
- **`frontend-handoff/WIDGET_SPEC.md`** — consistent with the backend everywhere it
  states facts (headers, buckets, secret scope incl. capture-email, error handling,
  consent rules, session id). One defect, inherited from A1: §5 steps 3–4
  (lines 148–163) instruct parsing "each `data:` JSON event into a *part*" and
  dispatching per `BEHAVIOR_REFERENCE` §2 — with the real chunk protocol this needs
  the chunk→part assembly step of Section 2.2 above. The §9 advice (check status
  before streaming, Retry-After handling, 400 `payload_too_large` start-new-chat)
  matches the code exactly.
- **`frontend-handoff/BEHAVIOR_REFERENCE.md`** — accurate as a *rendering* spec for
  assembled parts (arrival order, `toolCallId` keying, render-once-`input`-present,
  silent tools, markdown subset, render-nothing guards, the
  dimensions/targetGroup omission matches the actual `/api/products` response).
  Two stale details: lines 44–55 describe `-partial`/`-result` type suffixes
  (don't exist in v6 — A2), and "renderable once `part.input` is present" should
  be anchored to the `tool-input-available` chunk for a hand-rolled parser.
- No other files exist in `docs/frontend-handoff/`; nothing else to re-sync.

**Recommended doc fixes (smallest set):** rewrite the "Response — SSE stream"
section of `API_CONTRACT.md` (root, then re-sync the handoff copy) around the real
chunk protocol of §2.2, fix the `state`/suffix vocabulary, and patch the three
`DATA_RETENTION.md` staleness items + the `ADMIN_DASHBOARD.md` §10 dangling
references. Everything else is cosmetic.
