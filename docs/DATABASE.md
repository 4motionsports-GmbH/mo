# Database

The backend persists conversations, telemetry, the customer base (the Shopify
customer mirror and its order ledger), marketing consent, campaigns and the
e-mail subsystem in Postgres. This document covers the client, how to run
migrations, the schema, and the deliberate separation between the conversation
and marketing data.

## Client & connection

We use the **Neon serverless driver** (`@neondatabase/serverless`). As of 2026
Vercel Postgres *is* the Neon native integration, and the older
`@vercel/postgres` SDK is deprecated in its favour. We use the driver's HTTP
query function (`neon()`), which is the right fit for short serverless queries —
no pool or WebSocket to manage.

Connection strings come from the env vars the Neon Vercel integration injects
automatically (you don't set these by hand in production):

| Purpose            | Modern var              | Legacy var (also injected)   |
| ------------------ | ----------------------- | ---------------------------- |
| Pooled (runtime)   | `DATABASE_URL`          | `POSTGRES_URL`               |
| Direct (migrations)| `DATABASE_URL_UNPOOLED` | `POSTGRES_URL_NON_POOLING`   |

`src/lib/db.ts` reads them and exposes `getSql()`. **It returns `null` when no
connection string is set** — every caller treats persistence as optional
infrastructure, so the chat works with or without a database. A DB write must
never break a chat response.

## Running migrations

Migrations are plain `.sql` files in [`migrations/`](../migrations), applied in
filename order by a small forward-only runner (`scripts/migrate.mjs`). Applied
files are recorded in a `_migrations` table, so re-running is a no-op.

```bash
# Uses the connection string from .env (DATABASE_URL[_UNPOOLED] / POSTGRES_URL…)
npm run db:migrate

# Or against an explicit database:
DATABASE_URL=postgres://… node scripts/migrate.mjs
```

The runner prefers the **unpooled** connection string for DDL and falls back to
the pooled one. To add a migration, drop a new file with the next number
(`migrations/00NN_<name>.sql`; never edit an applied one) — it must use plain
DDL (`--` comments and `;` statement separators; no dollar-quoted function
bodies, which the lightweight splitter doesn't parse). Production migrations are
run manually by the maintainer.

## Schema overview

The schema is split into **two clusters** (see the separation rationale below).

### Cluster A — conversation / analytics (pseudonymous)

| Table           | Key columns                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `conversations` | `session_id` (unique), `created_at`/`updated_at`/`last_activity_at`, `persona_label`, `message_count`, `recommended_product_ids` (text[]), `selected_product_ids` (text[]), `status` (active/abandoned/converted — `converted` is set by the daily conversion sweep, `src/lib/conversion-sweep.ts`: the conversation's marketing email's unique `MS5-` code was redeemed in a real order), `locale` (migration 0041 — storefront chat language, stamped by `persistTurn`, latest turn wins; NULL for pre-0041 rows) |
| `messages`      | `conversation_id` (FK, cascade), `client_message_id` (idempotency), `role`, `content`, `tool_name`  |
| `kpi_events`    | `session_id`, `event`, `data` (jsonb), `created_at`                                                  |
| `ai_usage`      | `conversation_id` (FK, cascade, nullable), `call_site`, `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens` (migration 0039 — prompt-cache splits, see docs/PROMPT_CACHING.md), `estimated`, `created_at` (migration 0012) |
| `feedback`      | `message` (the comment), optional context: `session_id`, `conversation_id`, `tier`, `email`, `page`; `created_at` (migration 0020) |

- **Write path:** `/api/chat` calls `persistTurn()` (`src/lib/conversation-store.ts`)
  in its `onFinish` handler — *after* the stream finishes, so it adds no token
  latency. It upserts the conversation by `session_id`, records the persona
  label, accumulates `recommended_product_ids` from product-referencing tool
  calls, and inserts the new user + assistant messages.
- **Selected vs discussed:** `recommended_product_ids` is the DISCUSSED set —
  every product any tool call referenced, accumulated additively (including
  compared-and-rejected alternatives). `selected_product_ids` is the SELECTED
  set — only the products the user expressed intent to buy, i.e. the ids of
  the latest `add_to_cart` (direct-checkout) tool call. It is **replaced** with
  the latest selection each turn (not accumulated), so switching to an
  alternative drops the rejected product. Cart links (summary email, marketing
  email/dashboard) prefer the selected set and fall back to the discussed set
  only when no selection was made — see `chooseCartProductIds` in
  `src/lib/cart.ts`.
- **Idempotency:** message inserts dedupe on
  `(conversation_id, client_message_id, COALESCE(tool_name,''))`, so re-sent
  history never duplicates rows.
- **Telemetry:** `/api/kpi` inserts pseudonymous `kpi_events` (the widget's
  fail-silent `track()`), best-effort.
- **AI cost (migration 0012):** every AI call records one `ai_usage` row — model
  id + provider-reported input/output token counts (`estimated` flags the rare
  case where they're estimated, e.g. an embeddings response with no usage field).
  CHAT usage carries `conversation_id` (so it cascade-deletes with its
  conversation); dashboard/admin/embedding calls leave it NULL. `recordAiUsage()`
  in `src/lib/ai-usage-store.ts` is best-effort (no DB ⇒ no-op, never throws).
  The KPI tab turns token counts into EUR via the model→price table in
  `src/lib/ai-pricing.mjs` — USD per million tokens with sane defaults for the
  models we call, overridable via the `MODEL_PRICES_JSON` env var; EUR conversion
  via `USD_EUR_RATE` (default 0.92). `getAiCostMetrics()` reports average/median
  cost per consultation, total spend, and a chat-vs-dashboard split.
- **Feedback (migration 0020):** `POST /api/feedback` stores one free-text
  customer comment per row (`insertFeedback` in `src/lib/feedback-store.ts`),
  with optional context — `session_id`/`conversation_id` (pseudonymous, plain
  TEXT, **no FK** so a comment survives a retention purge of its conversation),
  `tier`, `page`, and an optional `email`. Light abuse protection: a dedicated
  tight rate-limit bucket plus a 4000-char cap enforced in
  `feedback-validation.mjs` before insert. The admin **Feedback** tab reads it
  read-only, newest-first (`listFeedback`). *On the `email` column:* it appears
  only when the widget already knows an identified address, and is user-supplied
  **contact context for that comment** (the same shape as `/api/contact`'s
  email) — it is **not** a consent record and grants no permission. Consent
  lives only in Cluster B: the state on `customers.email_consent_*` with its
  history in `consent_events` (migration 0064), and `email_captures` as the
  Art. 7 evidence for consents given on Mo's own surfaces.

### Cluster B — consent / marketing (email lives ONLY here)

| Table              | Key columns                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `email_captures`   | `email`, `customer_id` (FK → customers, SET NULL), `transactional_consent`, `marketing_consent`, `marketing_doi_status`, `doi_token`, `doi_confirmed_at`, `consent_text_shown`, `consent_copy_version` (audit stamp, migration 0011), `unsubscribed_at` — the Art. 7 evidence for consents given on Mo's surfaces; since 0064 the consent *state* lives on `customers` |
| `suppression_list` | `email` (PK), `added_at`, `reason` (`unsubscribe` \| `manual` \| `bounce` \| `complaint` \| `erasure`) — the block list every send checks |
| `marketing_sends`  | `email_capture_id` (FK, cascade), `drafted_text`, `discount_code`, `sent_at`, `status` (draft/approved/sent), `shopify_order_matched` |
| `customers`        | `email` (unique — the person key; `shopify:<id>` placeholder for a Shopify customer without e-mail), `first_seen_at`/`last_seen_at`, `transactional_consent`, `profile_summary` + `profile_summary_updated_at` (regenerated "current understanding"), `profile_data` (jsonb structured profile), `persona_label`, `profile_checked_at` (nightly upkeep), `purchase_summary` (jsonb, the pre-ledger Shopify read, kept as fallback) + `purchase_summary_updated_at`, tier-3 identity (`shopify_customer_id` unique, `shopify_customer_gid`, `shopify_linked_at`, `identity_tier`) — see [`CUSTOMERS.md`](./CUSTOMERS.md). **Mirror (0061):** `first_name`, `last_name`, `locale`, `country_code`, `language_override` (de/en pin of the person), `shopify_state`, `shopify_tags`, `shopify_created_at`, `shopify_updated_at` (stale guard), `shopify_synced_at`, `facts_dirty_at`, `profile_depth` (`kauf` \| `voll`), `profile_objection_at` / `postal_objection_at` (Art. 21); `source` = `chat` \| `shopify` (legacy `shopify_account` / `kampagne` still allowed, backfilled to `shopify`). **One consent (0064):** `email_consent_state` (`subscribed` \| `pending` \| `unsubscribed` \| `not_subscribed`), `email_consent_level` (`confirmed_opt_in` \| `single_opt_in` \| `unknown`), `email_consent_at`, `email_consent_source`, `email_consent_synced_at`; `marketing_status` is kept as a derived compatibility mirror |
| `campaigns`        | One row per campaign (migration 0066, [`CAMPAIGNS.md`](./CAMPAIGNS.md) §2): `name`, `slug` (unique), `kind` (`laufend` \| `aktion` \| `einzel` — exactly one `einzel`), `status` (`entwurf` \| `aktiv` \| `pausiert` \| `beendet` \| `archiviert`), `brief`, `audience` (jsonb spec), `audience_mode` (`dynamisch` \| `fest`), `priority`, `starts_at`/`ends_at`, `daily_target`, `auto_prepare_per_day`, `reentry_days`, `discount_percent`/`discount_scope`/`discount_valid_until`, `design_key`, `hero_mode`, `text_mode`, `mo_promo`, `cta_kind`/`cta_url`, `audience_refreshed_at`, `started_at`/`ended_at`. Seeded: „Bestandskunden – Lebenszyklus“ (`lebenszyklus`) and „Einzelansprache“ |
| `campaign_contacts` | Campaign recipients (migration 0034; per campaign since 0066): one row per person per campaign per re-entry `cycle` — `campaign_id` (FK campaigns, cascade), `customer_id` (FK customers, SET NULL, 0059), `cycle`, `email`, name, `language` + `language_override`, `opt_in_level` (snapshot of the consent level), `orders_count`/`total_spent_cents`/`last_order_at` (snapshot of `customer_facts`), `last_synced_at` (last audience refresh), review `status` (pending/drafted/sending/sent/skipped/suppressed/excluded/draft_failed), `excluded_reason`, `admin_note`, `conversation_id` (FK conversations, SET NULL), `added_at`, `added_manually` (0069 — put in by hand; a dynamic audience refresh keeps the row), `is_test`/`test_source_email` (0057). Unique `(campaign_id, customer_id, cycle)` for real rows, `(campaign_id, email)` for test rows; `shopify_customer_id` is no longer unique (0066). Legacy rows (the former Shopify-subscriber sync, retired) belong to `lebenszyklus` |
| `campaign_drafts`  | One editable draft per recipient (`contact_id` unique, cascade): `subject`, `body` (MO-XXXX placeholder), `discount_percent`, projected `discount_expires_at`, `discount_scope` (all \| recommendations \| set, 0058), compact `purchase_summary` (jsonb), `recommended_product_ids`, `low_confidence` |
| `campaign_sends`   | Immutable campaign send record: `contact_id` (SET NULL), `campaign_id` (FK campaigns, SET NULL, 0066), `customer_id` (FK customers, SET NULL, 0066), `email`, `subject`, `body_hash` (SHA-256 of the shipped text), `sent_via` (email/copy), real `discount_code` (`MK-…`) + gid + expiry, `sent_at` (+ retained bodies, click, snapshot and delivery columns — [`CAMPAIGNS.md`](./CAMPAIGNS.md) §2.5) |

Campaign contacts can additionally carry a **bundle offer**: `bundle_offers`
(migration 0013, [`BUNDLES.md`](./BUNDLES.md)) gained a nullable
`campaign_contact_id` FK (`ON DELETE SET NULL`, migration 0035) parallel to
its `customer_id`/`marketing_send_id` links.

### Cluster B (cont.) — Kundenstamm, Shopify sync and Eingang (migrations 0061–0070)

Every Shopify customer is mirrored into `customers` (bulk import, `customers/*` and
`orders/*` webhooks, nightly reconcile — `src/lib/shopify-sync.ts`, see
[`CUSTOMERS.md`](./CUSTOMERS.md)). The tables around the mirror:

| Table | Key columns |
| --- | --- |
| `customer_orders` (0062) | The local order ledger, minimised (deleted with the person on erasure — Shopify keeps its own orders as long as the law requires): `shopify_order_id` (unique), `customer_id` (FK customers, **cascade**), `shopify_customer_id`, `order_name`, `processed_at`, `financial_status`, `fulfillment_status`, `cancelled_at`, `currency`, `subtotal_cents`, `total_cents`, `refunded_cents`, `last_refund_at` (0070: the newest refund that moved money — dates the Eingang rule „Unzufriedenheit“; only moves forward), `discount_codes` (text[]), `source_name`, `line_items` (jsonb: title, variant title, quantity, unit price, handle/ref, product/variant id), `shopify_updated_at`, `synced_at`. No addresses, payment data, notes or contact fields; guest orders without a customer are not stored. Revenue attribution stays in `mo_orders` (0042). |
| `customer_facts` (0063) | One row per customer (PK = FK customers, cascade), computed with zero tokens by `customer-facts-core.mjs` (`src/lib/customer-facts.ts`; dirty customers first, then everyone older than a day — run nightly by `/api/cron/shopify-reconcile` after the reconcile, and after the bulk import): orders count, spend, first/last order, AOV, median interval, `expected_next_order_at`, refunds, discount share, `lifecycle_segment`, `value_tier`, RFM, `churn_risk`, bought handles/categories, complement handles, conversation count + last chat, discussed/selected handles, marketing sends/clicks/redemptions, last inbound + unanswered mail count, `last_activity_at`, `computed_at` |
| `consent_events` (0064) | The consent history („Einwilligungsverlauf“): `customer_id` (FK customers, cascade), `occurred_at`, `recorded_at`, `source` (mo_capture_form \| mo_chat_gate \| mo_signin \| mo \| shopify \| admin \| import), `state`, `level`, `origin_ref` (never an e-mail address), `text_version` (Shopify-side acts: `SHOPIFY_CONSENT_TEXT_VERSION`), `note`. One row per change of `customers.email_consent_*`; the merge rules live in `consent-core.mjs`. |
| `shopify_webhook_events` (0065) | Webhook dedupe by `X-Shopify-Webhook-Id`: `webhook_id` (PK), `topic`, `received_at`, `processed_at`, `outcome`, `error` — no payload stored |
| `shopify_sync_runs` (0065) | The resumable bulk import and the nightly reconcile: `kind` (`import_customers` \| `import_orders` \| `reconcile`), `status` (running/processing/done/failed/cancelled), `bulk_operation_id`, `result_url`, `byte_offset`, counts (`lines_processed`, `customers_upserted`, `orders_upserted`, `skipped`), `since` (reconcile floor), `started_at`/`updated_at`/`finished_at`, `error` |
| `shopify_outbox` (0065) | Every write Mo makes to Shopify customers, retried with backoff (`src/lib/shopify-outbox.ts`, cron `/api/cron/shopify-sync` every 5 min): `kind` (`consent_update` \| `customer_create` \| `data_erasure` \| `writeback` — Mo's `mo-…` customer tags, `SHOPIFY_WRITEBACK_ENABLED`), `customer_id` (FK customers, SET NULL), `shopify_customer_id`, `payload` (target state; a create's e-mail and name are blanked once the row is done or dead), `status` (pending/done/failed/dead/skipped), `attempts`, `next_attempt_at`, `last_error`, `created_at`, `done_at` |
| `erasure_tombstones` (0065) | `shopify_customer_id` (PK) of every person erased in Mo, `erased_at`, `shopify_confirmed_at` (set by Shopify's `customers/redact` / `customers/delete`). Import, reconcile and webhooks skip tombstoned ids, so nobody is re-created before Shopify has redacted the record; a confirmed tombstone leaves after `ERASURE_TOMBSTONE_RETENTION_DAYS` ([`DATA_RETENTION.md`](./DATA_RETENTION.md)). |
| `inbox_items` (0067) | The Eingang: `kind` (the rule in `customer-signals.mjs`, or a system matter), `customer_id` (FK customers, cascade; NULL for system items), `status` (`offen` \| `zurueckgestellt` \| `erledigt` \| `verworfen`), `priority`, `title`, `reason`, `evidence` (jsonb, never an e-mail address), `suggestion` (jsonb AI suggestion) + `suggested_at`, `dedupe_key` (unique — names the episode), `snoozed_until`, `decided_at`/`decision`/`decision_note`, `outcome` (jsonb, 14 days after the decision) + `outcome_checked_at`, `expires_at` |

**View `customer_overview` (0068)** — the one read model of a customer: `customers` +
`customer_facts` + the block state from `suppression_list` (`blocked` / `block_reason` for
bounce, complaint and erasure) + open Eingang tasks (`open_tasks_count`, `top_task_priority`),
with `display_name`, `is_shopify_customer`, `has_profile`, `has_postal_address` and coalesced
figures. Plain joins, no logic. The Kunden list (`src/lib/customer-list-store.ts`) and the
campaign audiences (`src/lib/audience-store.ts`) write their predicates once against it.

### The customer entity (migration 0008)

A **customer** is one person. Since the customer mirror (migration 0061) every
Shopify customer has a row (`source = 'shopify'`), keyed by
`shopify_customer_id` first and the e-mail as fallback; people first seen in Mo
(`source = 'chat'`) are keyed by the e-mail they gave. The localStorage session
id is a per-browser *thread* id, not a person; anonymous sessions are never
linked across visits.

**Linking rule:** a conversation gets a `customer_id` only when the visitor
identifies themselves in that session — an email captured via
`/api/capture-email` (`linkCustomerOnEmailCapture` in
`src/lib/customer-store.ts` find-or-creates the customer, attaches the
conversation, and bumps `last_seen_at`) or a sign-in with the shop account
(`bindShopifyIdentity`, see [`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md)). Both
also record the session in `customer_session_links`. Sessions without either
stay anonymous and unlinked. Multiple sessions under one person = the
returning-customer case. The marketing consent is the one consent on
`customers.email_consent_*` (migration 0064, shared with Shopify; history in
`consent_events`); `email_captures` stays the audit-grade evidence for consents
given on Mo's surfaces.

See [`CUSTOMERS.md`](./CUSTOMERS.md) for the full model (identity, mirror,
facts, profiles) and [`CONSENT_FLOW.md`](./CONSENT_FLOW.md) for the consent.

## Why conversations and marketing are separate

This separation is a GDPR design decision, not just tidiness:

1. **Different lawful bases.** Conversations/analytics run on *legitimate
   interest / service provision*; marketing email runs on *explicit consent*.
   Mixing them would let the weaker basis contaminate the stronger one.
2. **Email is quarantined.** An email address appears only in Cluster B
   tables (`customers`, `email_captures`, `suppression_list`, the campaign and
   correspondence tables) — plus the optional `feedback.email` described above.
   Conversations are pseudonymous (`session_id` only), so the bulk of Cluster A
   carries no directly-identifying field.
3. **No implicit join between clusters.** For anonymous traffic the only
   bridge is the pseudonymous `session_id`, which a user can sever by clearing
   browser storage. Since migration 0008 there is **one explicit,
   identity-anchored exception**: `conversations.customer_id`, set only when the
   user actively submits their email or signs in for that session. The FK is
   `ON DELETE SET NULL`, so a retention purge of a customer returns their
   conversations to plain pseudonymous rows (the complete erasure deletes them).
4. **Independent retention.** Each cluster expires on its own schedule (see
   [`DATA_RETENTION.md`](./DATA_RETENTION.md)) — e.g. purging a marketing
   capture on unsubscribe doesn't touch conversation analytics, and deleting an
   old conversation doesn't touch a still-valid marketing consent.

See [`DATA_RETENTION.md`](./DATA_RETENTION.md) for lawful basis and retention
windows in detail.

## Local database (development)

The runtime uses the Neon driver's **HTTP** mode, which a plain local Postgres does not speak.
For local development the repo ships a tiny protocol proxy so you can run the whole app —
migrations, admin, crons — against a Postgres on your machine:

```bash
# 1. a local Postgres with an empty database, e.g.
createdb mo            # or: docker run -e POSTGRES_PASSWORD=mo -p 5432:5432 postgres:16

# 2. the proxy (keeps running; speaks the Neon SQL-over-HTTP protocol on :4444)
npm run db:proxy

# 3. point the app at both (in .env.local)
DATABASE_URL=postgres://mo:mo@127.0.0.1:5432/mo
NEON_FETCH_ENDPOINT=http://127.0.0.1:4444/sql

# 4. schema + demo data
node --env-file=.env.local scripts/migrate.mjs   # `npm run db:migrate` reads .env only
npm run db:seed         # scripts/seed-dev.mjs — refuses non-local hosts; --reset truncates first
npm run dev
```

`NEON_FETCH_ENDPOINT` is read once in `src/lib/db.ts`; leave it unset everywhere except local
development. The seed script fills every table the admin reads with deterministic German demo data
anchored on 2026-09-08 (`--anchor=YYYY-MM-DD` moves it): conversations, KPIs and AI usage, customers
with the one consent — chat leads and Shopify-mirrored customers — plus their `customer_orders`,
`customer_facts` (computed by the real core) and `consent_events`, the campaigns (Lebenszyklus,
Einzelansprache, Black Friday, a finished Aktion) with recipients, drafts and sends, `inbox_items`
(from the real signal rules), `shopify_sync_runs` / `shopify_webhook_events` / `shopify_outbox`,
correspondence, letters, bundles, feedback, Q&A, reports and attribution. Without `--reset` it
refuses to write into tables that already hold rows; re-running it with `--reset` recreates the same
data. Not seeded: OAuth tokens, pending sign-ins, merge conflicts, erasure tombstones.
