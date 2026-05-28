# motion sports — KI-Berater Backend

Headless backend for the motion sports KI sales assistant. This repo
exposes the chat and contact endpoints used by the Shopify storefront
widget; the chat UI itself lives in the Shopify theme and is not part
of this repo.

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
by the AI SDK client on the widget side.

### `POST /api/contact`

JSON contact-form submission for studio / rehab / public-procurement
leads. Body:

```jsonc
{
  "reason": "...",
  "productIds": ["..."],        // optional
  "name": "...",
  "email": "...",
  "organization": "...",         // optional
  "phone": "...",                // optional
  "message": "..."
}
```

Validates the payload and currently logs to the server console. The
production hook into CRM / ticketing / email is a follow-up.

### `GET /`

Returns the plain string `motion sports backend — OK` as a trivial
health check.

## Setup

```bash
npm install

# .env.local
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...     # only needed for the indexer
```

## Catalog + embeddings

The catalog is generated from a Shopify CSV export:

```bash
# 1. Put the Shopify CSV at src/data/products_export_1.csv
# 2. Regenerate the JSON catalog
npm run convert-catalog
# 3. Re-index embeddings
OPENAI_API_KEY=sk-... npm run index
# 4. Commit both files
```

Filters in `convert-catalog`: `Published=TRUE`, price > 0, at least one
image, `Status=active`. Persona-relevant fields
(`medicalCertification`, `noiseLevelDb`, `footprintM2`) default to
`"unknown"` when not in the Shopify export.

If `product-embeddings.json` is empty, retrieval falls back to keyword
search.

## Run locally

```bash
npm run dev
```

The backend listens on `http://localhost:3000`. There is no chat UI to
visit; hit the endpoints directly:

```bash
curl -X POST http://localhost:3000/api/chat \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","parts":[{"type":"text","text":"Hallo"}]}]}'
```

## Deploy on Vercel

1. Set `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` as environment variables.
2. Before each deploy that touches the catalog, run `npm run index`
   locally and commit `src/data/product-embeddings.json`.

## Architecture

```
src/
├── app/
│   ├── api/chat/route.ts          # Chat endpoint: extract profile → retrieve → stream
│   ├── api/contact/route.ts       # Contact-form submission (logs only for now)
│   ├── layout.tsx                 # Minimal root layout
│   └── page.tsx                   # Plain health response
├── data/
│   ├── product-catalog.json
│   └── product-embeddings.json    # generated via `npm run index`
└── lib/
    ├── persona.ts                 # deriveArchetype, addendums, profile rendering
    ├── product-catalog.ts         # catalog loader
    ├── retrieval.ts               # cosine retrieval + keyword fallback
    ├── system-prompt.ts           # per-turn system prompt
    ├── tools.ts                   # chat tools
    └── types.ts                   # Profile, Archetype, Product, tool args
```

## Persona architecture

The customer profile is **a pure function of the message history**. On
each turn, every `update_customer_profile` tool call from the assistant
stream is merged into an empty profile — no separate session storage.
The archetype is derived from the profile (`deriveArchetype`). System
prompt and retrieval are both parameterized by the current profile, so
every recommendation is persona-aware.

## Not yet wired up

CORS, authentication, and rate limiting are deliberately not configured
in this repo yet. They are the next step before the Shopify widget can
call these endpoints from the browser.
