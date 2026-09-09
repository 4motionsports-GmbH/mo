# Mo — motion sports KI-Berater (backend + admin)

Next.js 16 (App Router) on Vercel (`fra1`) with Neon Postgres, TypeScript plus a
set of pure `.mjs` cores with `node --test` suites. Three products live in this
repository:

1. **The chat API for the Shopify storefront widget** — `/api/chat` and the
   routes around it (products, consent, account, telemetry). The widget itself
   lives in the Shopify theme and is **not** in this repo;
   [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) is the contract it targets and
   must stay backward compatible.
2. **The admin dashboard** at `/admin` (German) — customers, the campaign review
   queue, KPIs, the conversation inspector, the knowledge queue, analyses, the
   improvement loop and e-mail settings. [`docs/ADMIN_DASHBOARD.md`](docs/ADMIN_DASHBOARD.md).
3. **The e-mail subsystem** — transactional mail (summary, double opt-in),
   personalised marketing mail (`MS5-` codes), the campaign channel to Shopify
   marketing subscribers (`MK-` codes), inbound mail, physical letters via
   Pingen, code-based designs with AI hero images.
   [`docs/CAMPAIGNS.md`](docs/CAMPAIGNS.md), [`docs/EMAIL_DESIGNS.md`](docs/EMAIL_DESIGNS.md),
   [`docs/CONSENT_FLOW.md`](docs/CONSENT_FLOW.md).

Conventions for working in the repo are in [`CLAUDE.md`](CLAUDE.md); every
capability is listed in [`docs/FEATURE_INVENTORY.md`](docs/FEATURE_INVENTORY.md).

## Endpoints

| Route | Purpose | Guard |
| --- | --- | --- |
| `POST /api/chat` | Streaming chat (AI SDK `UIMessage[]` in, UI-message stream out): profile from tool history → persona → retrieval → Claude with the chat tools. | shared secret + origin, rate limit |
| `GET /api/products?ids=` | Product hydration for the widget (≤ 10 ids, request order, `null` for unknown). | origin allowlist |
| `POST /api/contact` | Contact-form leads → e-mail to the team inbox via Resend (stdout fallback without a key). | secret + origin, rate limit |
| `POST /api/kpi`, `/api/feedback`, `/api/newsletter-rating`, `/api/tts` | Widget telemetry, feedback, newsletter ratings, text-to-speech. | secret/origin, rate limit |
| `/api/capture-email`, `/api/chat-marketing-opt-in`, `/api/confirm-marketing`, `/api/unsubscribe`, `/api/consent-copy` | Consent + double-opt-in flow ([`docs/CONSENT_FLOW.md`](docs/CONSENT_FLOW.md)). | per route |
| `/api/auth/*`, `/api/account/*` | Shopify Customer Account sign-in (tier 3), conversation history, export, erasure ([`docs/CUSTOMER_ACCOUNT.md`](docs/CUSTOMER_ACCOUNT.md)). | session / signed |
| `/api/attribution/token`, `/api/r/<token>`, `/api/email-countdown/<token>`, `/api/email-hero-image/<file>` | Order-attribution token, tracked e-mail redirect, live countdown image, hero-image assets. | tokens |
| `/api/webhooks/shopify`, `/api/webhooks/resend`, `/api/inbound/resend`, `/api/webhooks/pingen` | Orders → `mo_orders`, catalog changes; Resend delivery events and inbound mail; letter status. | signature over the raw body |
| `/api/cron/*` | `refresh-customers` 02:00 · `sync-campaign-audience` 02:30 · `sync-catalog` 03:00 · `retention` 03:30 · `expire-bundles` 03:45 UTC ([`vercel.json`](vercel.json)). | `Authorization: Bearer CRON_SECRET` |
| `/api/admin/*` (72 routes) | The dashboard's API ([`docs/ADMIN_DASHBOARD.md`](docs/ADMIN_DASHBOARD.md) §11). | Edge proxy + `guardAdmin*` |
| `GET /` | Plain health string. | — |

## Run locally

```bash
npm install
cp .env.example .env.local     # fill in ANTHROPIC_API_KEY, OPENAI_API_KEY, CHAT_SHARED_SECRET, ADMIN_PASSWORD
npm run dev                     # http://localhost:3000 — admin at /admin
```

Without `DATABASE_URL` the admin renders empty states. For a full local setup
(plain Postgres behind the Neon-protocol proxy, `npm run db:proxy`, schema +
demo data with `npm run db:seed`) see
[`docs/DATABASE.md`](docs/DATABASE.md) → „Local database“.

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H 'content-type: application/json' \
  -H 'x-ms-chat-key: <your CHAT_SHARED_SECRET>' \
  -H 'x-ms-session: dev-session-1' \
  -H 'origin: https://www.motionsports.de' \
  -d '{"messages":[{"role":"user","parts":[{"type":"text","text":"Hallo"}]}]}'
```

## Configuration

[`.env.example`](.env.example) is the **canonical, complete** list — every
variable the code reads, with its purpose and default (81 variables). Two rules
hold everywhere: the legal send gates (`CAMPAIGN_SENDS_APPROVED`,
`CAMPAIGN_ALLOW_SINGLE_OPT_IN`, `PHYSICAL_MAIL_SENDS_APPROVED`) default to
`false` and are enabled only in production; every retention window treats `0`
as „disabled“, never as „delete everything“.

| Group | Variables |
| --- | --- |
| Chat / AI | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `TTS_MODEL`, `TTS_VOICE`, `TTS_SPEED`, `TTS_INSTRUCTIONS`, `MODEL_PRICES_JSON`, `USD_EUR_RATE` |
| Security, rate limiting, admin | `ALLOWED_ORIGINS`, `CHAT_SHARED_SECRET`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `RETURNING_HINT_ENABLED` |
| Database | `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_FETCH_ENDPOINT` (local dev only) |
| E-mail (Resend, designs, hero images) | `RESEND_API_KEY`, `CONTACT_TO_EMAIL`, `CONTACT_FROM_EMAIL`, `PUBLIC_BASE_URL`, `UNSUBSCRIBE_SECRET`, `MARKETING_DOI_EXPIRY_DAYS`, `INBOUND_EMAIL_ADDRESS`, `RESEND_WEBHOOK_SECRET`, `RESEND_EVENTS_WEBHOOK_SECRET`, `EMAIL_LOGO_URL`, `EMAIL_MO_ICON_URL`, `EMAIL_HERO_DEFAULT_URL`, `EMAIL_HERO_IMAGE_MODEL`, `EMAIL_HERO_IMAGE_QUALITY`, `EMAIL_HERO_REFERENCES`, `EMAIL_HERO_QA`, `EMAIL_AI_LABEL_ICON_URL` |
| Marketing + campaign | `MARKETING_DISCOUNT_EXPIRY_DAYS`, `MARKETING_ORDER_LOOKBACK_DAYS`, `MARKETING_MIN_SEND_INTERVAL_DAYS`, `CONVERSION_SWEEP_MAX_CODES`, `CAMPAIGN_SENDS_APPROVED`, `CAMPAIGN_ALLOW_SINGLE_OPT_IN`, `CAMPAIGN_MO_DEEPLINK_URL` |
| Physical mail (Pingen) | `PINGEN_CLIENT_ID`, `PINGEN_CLIENT_SECRET`, `PINGEN_ORGANISATION_ID`, `PINGEN_STAGING`, `PINGEN_WEBHOOK_SECRET`, `PHYSICAL_MAIL_SENDS_APPROVED`, `PINGEN_LETTER_COST_CENTS` |
| Shopify (Admin API, webhooks, Customer Account) | `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_API_VERSION`, `SHOPIFY_APP_PROXY_SECRET`, `SHOPIFY_WEBHOOK_SECRET`, `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID`, `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET`, `SHOPIFY_STOREFRONT_DOMAIN`, `TOKEN_ENC_KEY`, `SHOPIFY_CUSTOMER_ACCOUNT_STATE_SECRET`, `CUSTOMER_AUTH_PENDING_TTL_MINUTES`, `CUSTOMER_REFRESH_BATCH`, `CUSTOMER_REFRESH_STALE_HOURS` |
| Bundles | `BUNDLE_CREATION_MODE`, `BUNDLE_OFFER_EXPIRY_DAYS`, `BUNDLE_EXPIRED_REDIRECT_URL` |
| Storage, crons, observability | `BLOB_READ_WRITE_TOKEN`, `CRON_SECRET`, `NEXT_PUBLIC_SENTRY_DSN` (errors only, no tracing, no source-map upload) |
| Retention ([`docs/DATA_RETENTION.md`](docs/DATA_RETENTION.md)) | `RETENTION_DAYS`, `KPI_RETENTION_DAYS`, `ABANDON_AFTER_MINUTES`, `MO_ATTRIBUTION_WINDOW_DAYS`, `SUPPRESSED_CAPTURE_PURGE_DAYS`, `CORRESPONDENCE_RETENTION_DAYS`, `FEEDBACK_RETENTION_DAYS`, `CUSTOMER_INACTIVITY_RETENTION_DAYS`, `ADMIN_ACCESS_LOG_RETENTION_DAYS`, `CAMPAIGN_CONTACT_RETENTION_DAYS`, `ANALYTICS_REPORT_RETENTION_DAYS`, `PHYSICAL_LETTER_RETENTION_DAYS` |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev server, production build, production server. |
| `npm run lint`, `npx tsc --noEmit`, `npm test` | ESLint, type check, the `node --test` suite (`src/**/*.test.mjs`). |
| `npm run db:migrate` | Apply pending SQL migrations from `migrations/` (forward-only, run manually). |
| `npm run db:proxy`, `npm run db:seed`, `npm run db:reset` | Local Neon-protocol proxy, demo data, test-data reset (see `docs/DATABASE.md`). |
| `npm run verify:shopify` / `verify:pingen` / `verify:customer-account` | Check the respective credentials. |
| `npm run diagnose:address` | Inspect the address capture for one customer. |
| `npm run analyze:repurchase` | Repurchase analysis behind the lifecycle segments ([`docs/REPURCHASE_ANALYSIS.md`](docs/REPURCHASE_ANALYSIS.md)). |
| `npm run convert-catalog`, `npm run index` | One-off catalog conversion and embedding build (the daily cron does this in production). |
| `npm run hero:gradient`, `npm run hero:compare` | Hero-image tooling. |
| `node scripts/preview-summary-email.mjs`, `node scripts/send-test-emails.mjs`, `node scripts/list-test-discounts.mjs` | Manual helpers: render the summary e-mail to a file, send test versions of the e-mails via Resend (**sends real mail** — read the header first), list/delete test discount codes. They import TypeScript directly; Node ≥ 22.18 runs them as is. |

## Architecture

```
src/
├── app/
│   ├── api/                  # HTTP routes (thin: validate → lib → JSON envelope)
│   │   ├── chat, products, contact, tts, kpi, feedback, newsletter-rating
│   │   ├── capture-email, confirm-marketing, chat-marketing-opt-in, unsubscribe, consent-copy
│   │   ├── auth/, account/, attribution/, r/[token], email-countdown/, email-hero-image/
│   │   ├── webhooks/{shopify,resend,pingen}, inbound/resend, cron/*
│   │   └── admin/**          # 72 guarded dashboard routes
│   ├── admin/                # the dashboard: page.tsx (one screen per request), AdminShell,
│   │                         # <Screen>Tab.tsx + <screen>/ workspaces, ui/ primitives, lib/ helpers
│   ├── icon.svg, layout.tsx, page.tsx
├── data/                     # bundled catalog + embeddings (fallback when Blob is empty)
├── lib/                      # ~280 modules
│   ├── *-store.ts            # database access per table group (Neon, null-safe, fail-soft)
│   ├── *.mjs + *.test.mjs    # pure cores with unit tests (no I/O)
│   ├── campaign-*, marketing-*, email-*, email-designs/   # the e-mail subsystem
│   ├── shopify*, catalog-*, retrieval, system-prompt*, persona, tools   # the chat
│   └── kpi-*, admin-*, retention*, rate-limit, security, observability
└── proxy.ts                  # Edge gate for /admin and /api/admin
migrations/                   # forward-only SQL, 0001 … 0056
scripts/                      # operational scripts (npm aliases above)
docs/                         # living documentation; docs/archive/ = historical reports and spikes
```

**A chat turn** (`/api/chat`): replay the `update_customer_profile` tool calls of
the history into the current customer profile (the profile is a pure function
of the message history), derive the persona, retrieve products by embedding
similarity (keyword fallback), then stream a Claude response with the persona-
aware system prompt and the chat tools (`update_customer_profile`,
`search_products`, `show_product`, `compare_products`, `add_to_cart`,
`suggest_showroom`, `show_contact_form`). Live directives from the admin's
Verbesserung screen and published Q&A knowledge are injected into the prompt
(cached ~5 minutes). Prompt caching: [`docs/PROMPT_CACHING.md`](docs/PROMPT_CACHING.md).

**Catalog**: refreshed daily by `/api/cron/sync-catalog` from Shopify
(products + embeddings written to Vercel Blob; Shopify product webhooks apply
changes in between); the runtime reads Blob first and falls back to
`src/data/`. [`docs/CATALOG_SYNC.md`](docs/CATALOG_SYNC.md).

**Data model**: two clusters — pseudonymous conversations/analytics and
consent-bound e-mail data — joined only through a pseudonymous session key, plus
the customer entity above both. [`docs/DATABASE.md`](docs/DATABASE.md),
[`docs/DATA_RETENTION.md`](docs/DATA_RETENTION.md).

## Deploy to Vercel

1. **Import the repo** into a Vercel project (framework preset Next.js, root
   directory = repo root, region `fra1` via `vercel.json`).
2. **Set the environment variables** from `.env.example` that apply, for
   *Production* and *Preview*. Keep the three legal send gates `false` until the
   legal sign-off; set `CRON_SECRET`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`,
   `UNSUBSCRIBE_SECRET` and the webhook secrets to long random strings.
3. **Run the migrations** against the production database
   (`npm run db:migrate` with the production `DATABASE_URL` in `.env`) — before
   the first deploy and again whenever a PR says it needs a migration.
4. **Deploy.** The first build works with an empty Blob because the runtime
   falls back to the bundled catalog.
5. **Add the domain** `chat.motionsports.de` (Settings → Domains, DNS CNAME) and
   set `PUBLIC_BASE_URL` to it.
6. **Trigger the catalog sync once** so Blob has data before the first
   scheduled run:
   ```bash
   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
     https://chat.motionsports.de/api/cron/sync-catalog
   ```
   Expect `mode: "shopify"` and a non-zero product count; `mode:
   "fallback-bundle"` means the Shopify credentials are wrong
   (`npm run verify:shopify`).
7. **Register the webhooks** (Shopify orders/products → `/api/webhooks/shopify`,
   Resend → `/api/webhooks/resend` and `/api/inbound/resend`, Pingen →
   `/api/webhooks/pingen`) with the secrets from step 2.
8. **Set hard monthly spend caps** in the Anthropic and OpenAI consoles.
9. **Smoke-test** the deployed chat endpoint (the `curl` above against the
   domain; `401` = wrong shared secret, `403` = origin not allow-listed) and log
   in at `/admin` — Einstellungen → Systemstatus shows which integrations are
   configured.
10. **Next day:** check Vercel → Logs for the five cron invocations (200 each).

## Quality gates

`npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm test` must be clean
before every push; UI changes ship with light/dark screenshots. Details and the
hard rules (non-composable `sql` templates, null-safe stores, forward-only
migrations, pure `.mjs` cores, admin date/number helpers, `InfoTip` for
explanations) are in [`CLAUDE.md`](CLAUDE.md).
