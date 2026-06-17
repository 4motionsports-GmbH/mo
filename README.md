# motion sports — KI-Berater Backend

Headless backend for the motion sports KI sales assistant. This repo
exposes the chat, contact, and product hydration endpoints used by the
Shopify storefront widget; the chat UI itself lives in the Shopify theme
and is not part of this repo.

## Endpoints

### `POST /api/chat`

Streaming chat endpoint built on Next.js + the Vercel AI SDK + Anthropic
Claude. The request body is a `UIMessage[]` (the AI SDK message shape).
On each turn the route:

1. Replays all `update_customer_profile` tool calls to derive the current
   customer profile (the profile is a pure function of message history).
2. Picks an archetype from the profile (`deriveArchetype`).
3. Retrieves relevant products from the catalog via embedding similarity
   (with a keyword fallback when no embeddings are available).
4. Streams a Claude response with the persona-aware system prompt and
   the chat tools wired up (`update_customer_profile`, `search_products`,
   `show_product`, `compare_products`, `add_to_cart`, `suggest_showroom`,
   `show_contact_form`).

Response: a UI-message stream (`toUIMessageStreamResponse`) consumable
by the AI SDK client on the widget side. See
[`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) for the exact streamed
parts the widget must handle.

### `POST /api/contact`

JSON contact-form submission for studio / rehab / public-procurement
leads. Validates the payload and forwards it as email via Resend
(falls back to a stdout log when Resend env vars are unset).

### `GET /api/products`

Public product hydration: `?ids=a,b,c` (or repeated `?id=`). Returns
`{ products: PublicProduct[] }` in request order, with `null` entries
for unknown ids. Capped at 10 ids per request, origin-allowlisted, no
shared-secret required.

### `GET /`

Returns the plain string `motion sports backend — OK` as a trivial
health check.

Full request / response shapes for all three endpoints are documented
in [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) — that is the
contract the widget code targets.

## Run locally

```bash
npm install
cp .env.example .env.local
# fill in ANTHROPIC_API_KEY, OPENAI_API_KEY, CHAT_SHARED_SECRET at minimum
npm run dev
```

The backend listens on `http://localhost:3000`. There is no chat UI to
visit; hit the endpoints directly:

```bash
curl -X POST http://localhost:3000/api/chat \
  -H 'content-type: application/json' \
  -H 'x-ms-chat-key: <your CHAT_SHARED_SECRET>' \
  -H 'x-ms-session: dev-session-1' \
  -H 'origin: https://www.motionsports.de' \
  -d '{"messages":[{"role":"user","parts":[{"type":"text","text":"Hallo"}]}]}'
```

## Catalog + embeddings

The catalog used to be a committed JSON file. It is now refreshed by a
daily Vercel cron (`/api/cron/sync-catalog`) that pulls live products
from Shopify, regenerates embeddings, and writes both files to Vercel
Blob. The runtime reads from Blob first, falls back to the bundled JSON
in `src/data/` if Blob is unconfigured. See
[`docs/CATALOG_SYNC.md`](docs/CATALOG_SYNC.md) for the full design.

## Deploy to Vercel

### Environment variables

Every env var the production deploy needs, grouped by purpose. All are
single-line strings. See `.env.example` for the canonical list.

**Chat / AI**

| Variable            | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `ANTHROPIC_API_KEY` | Anthropic API key — powers `/api/chat`.              |
| `OPENAI_API_KEY`    | OpenAI key — embeds user queries + (re-)index runs.  |

**Security**

| Variable             | Description                                                                       |
| -------------------- | --------------------------------------------------------------------------------- |
| `ALLOWED_ORIGINS`    | Comma-separated CORS allowlist. Default: `https://www.motionsports.de,https://motionsports.de`. |
| `CHAT_SHARED_SECRET` | Long random string the widget sends in `x-ms-chat-key`. Required for chat + contact. |

**Rate limiting**

| Variable            | Description                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| `KV_REST_API_URL`   | Upstash Redis REST URL — injected by Vercel's Upstash Marketplace integration. **Required**: the rate limiter fails fast (loud error, no silent no-op) if it or the token is missing. |
| `KV_REST_API_TOKEN` | Paired REST token for the URL above (same Vercel integration).                                       |

**Contact form**

| Variable             | Description                                                                |
| -------------------- | -------------------------------------------------------------------------- |
| `RESEND_API_KEY`     | Resend API key. If unset, contact submissions only log to stdout.          |
| `CONTACT_TO_EMAIL`   | Inbox that receives leads (e.g. `vertrieb@motionsports.de`).               |
| `CONTACT_FROM_EMAIL` | Verified Resend sender (e.g. `Motion Sports <kontakt@motionsports.de>`).   |

**Shopify catalog sync**

| Variable                 | Description                                              |
| ------------------------ | -------------------------------------------------------- |
| `SHOPIFY_STORE_DOMAIN`   | `*.myshopify.com` domain (NOT the public domain).        |
| `SHOPIFY_CLIENT_ID`      | App Client ID from the Shopify Developer Dashboard.      |
| `SHOPIFY_CLIENT_SECRET`  | App Client Secret (`shpss_…`).                           |
| `SHOPIFY_API_VERSION`    | Admin API version, e.g. `2026-04`.                       |

**Catalog storage + scheduling**

| Variable                 | Description                                                                  |
| ------------------------ | ---------------------------------------------------------------------------- |
| `BLOB_READ_WRITE_TOKEN`  | Vercel Blob token (auto-injected on Vercel; fill in for local).              |
| `CRON_SECRET`            | Long random string. Cron sends it as `Authorization: Bearer <secret>`.       |

**Observability (optional)**

| Variable                  | Description                                                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SENTRY_DSN`  | Server-side error capture (**errors only** — `tracesSampleRate` is 0, no tracing). Injected by the Vercel Sentry integration. Unset ⇒ Sentry skipped cleanly, errors logged to stdout, one-time warning emitted. |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` | **Build-time only** — source-map upload via the Sentry Next.js plugin during `next build`. Vercel injects these in CI/deploys; not needed for local dev or runtime. |

**AI cost tracking (optional — KPI tab)**

| Variable            | Description                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `MODEL_PRICES_JSON` | JSON `{ "<model>": { "input": N, "output": N } }` in USD per million tokens. Overrides/extends the built-in defaults. Unset ⇒ defaults. |
| `USD_EUR_RATE`      | USD→EUR rate applied to computed AI costs. Default `0.92`.                                     |

### Deploy checklist

Run these in order. Don't skip the manual cron trigger or the
spend-cap step.

1. **Push the branch and import the repo into a new Vercel project.**
   Framework preset: Next.js. Root directory: repo root.
2. **Set every env var above** in Vercel → Settings → Environment
   Variables. Apply them to *Production* and *Preview*.
3. **Deploy.** First deploy will build cleanly even with Blob empty
   because the runtime falls back to the bundled JSON in `src/data/`.
4. **Add the custom domain `chat.motionsports.de`** under Settings →
   Domains. Configure the DNS CNAME at the registrar. Wait for the
   certificate to issue.
5. **Trigger the catalog sync manually once** so Blob has fresh data
   before the first scheduled run:
   ```bash
   curl -X POST \
     -H "Authorization: Bearer $CRON_SECRET" \
     https://chat.motionsports.de/api/cron/sync-catalog
   ```
   Response should be a JSON summary with `mode: "shopify"` and a
   non-zero product count. If it returns `mode: "fallback-bundle"`,
   the Shopify creds are wrong — run `npm run verify:shopify` against
   them locally and fix before continuing.
6. **Set hard monthly spend caps**:
   - Anthropic Console → Plans & billing → set a monthly spend limit.
   - OpenAI Platform → Settings → Limits → set a hard monthly cap.
   Without these a runaway loop or scraper can drain the account.
7. **Smoke test the deployed chat endpoint** (replace the secret):
   ```bash
   curl -N -X POST https://chat.motionsports.de/api/chat \
     -H 'content-type: application/json' \
     -H "x-ms-chat-key: $CHAT_SHARED_SECRET" \
     -H 'x-ms-session: smoke-test-1' \
     -H 'origin: https://www.motionsports.de' \
     -d '{"messages":[{"role":"user","parts":[{"type":"text","text":"Hallo"}]}]}'
   ```
   Expect an SSE stream that starts within ~2s. A `401` means the
   shared secret didn't match; a `403` means the origin isn't in
   `ALLOWED_ORIGINS`.
8. **On day 2, verify the scheduled cron ran successfully.**
   In Vercel → Logs, filter to `/api/cron/sync-catalog`. There should
   be one invocation at 03:00 UTC with a 200 response and a JSON body
   reporting `mode: "shopify"` and the product/embedding counts. If
   the schedule didn't fire, confirm `vercel.json` is committed and
   the Vercel Cron page lists the job.

## Architecture

```
src/
├── app/
│   ├── api/chat/route.ts             # Chat endpoint: extract profile → retrieve → stream
│   ├── api/contact/route.ts          # Contact-form submission via Resend
│   ├── api/products/route.ts         # Public product hydration for the widget
│   ├── api/cron/sync-catalog/route.ts # Daily catalog refresh from Shopify
│   ├── layout.tsx                    # Minimal root layout
│   └── page.tsx                      # Plain health response
├── data/
│   ├── product-catalog.json          # Fallback when Blob is empty/unconfigured
│   └── product-embeddings.json
└── lib/
    ├── catalog-mapping.ts            # Shopify product → internal Product type
    ├── catalog-store.ts              # Blob-first loader + writer
    ├── observability.ts              # Sentry init + reportError + error envelopes
    ├── persona.ts                    # deriveArchetype, addendums, profile rendering
    ├── product-catalog.ts            # Thin re-export
    ├── rate-limit.ts                 # Upstash sliding-window limiter (chat + products buckets)
    ├── retrieval.ts                  # Cosine retrieval + keyword fallback
    ├── security.ts                   # CORS + shared-secret guard
    ├── shopify.ts                    # Admin API client + token cache
    ├── system-prompt.ts              # Per-turn system prompt
    ├── tools.ts                      # Chat tool definitions
    └── types.ts                      # Profile, Archetype, Product, tool args
```

## Persona architecture

The customer profile is **a pure function of the message history**. On
each turn, every `update_customer_profile` tool call from the assistant
stream is merged into an empty profile — no separate session storage.
The archetype is derived from the profile (`deriveArchetype`). System
prompt and retrieval are both parameterized by the current profile, so
every recommendation is persona-aware.
