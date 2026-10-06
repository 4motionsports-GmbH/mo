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
run manually by the maintainer. The latest migration is
`0077_analytics_report_step_claim.sql`; the [table index](#table-index--every-table-and-where-it-is-documented)
below names the migration that created each table.

## Schema overview

The schema is split into **two clusters** (see the separation rationale below).

### Cluster A — conversation / analytics (pseudonymous)

| Table           | Key columns                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `conversations` | `conversation_key` (unique thread key, 0018 — defaults to the session id; several threads per `session_id`, [`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §9), `session_id` (indexed, not unique since 0018), `customer_id` (0008, FK customers, SET NULL — see the linking rule below), `created_at`/`updated_at`/`last_activity_at`, `persona_label`, `message_count`, `recommended_product_ids` (text[]), `selected_product_ids` (text[]), `status` (active/abandoned/converted — `converted` is set by the daily conversion sweep, `src/lib/conversion-sweep.ts`: the conversation's marketing email's unique `MS5-` code was redeemed in a real order), `title` (0016, custom label) / `title_auto` (0026, derived from the first user message), `analysis_*` (0031 — the per-conversation analysis: summary, category, tags, quality, model, tokens), `qa_scanned_at` (0036, [`QA_KNOWLEDGE.md`](./QA_KNOWLEDGE.md)), `locale` (migration 0041 — storefront chat language, stamped by `persistTurn`, latest turn wins; NULL for pre-0041 rows) |
| `messages`      | `conversation_id` (FK, cascade), `client_message_id` (idempotency), `role`, `content`, `tool_name`, `session_id` (0076 — the session that wrote a tool marker row; NULL on text rows and on rows before 0076; partial index `messages_session_marker_idx` for the attribution window anchor, [`ORDER_ATTRIBUTION.md`](./ORDER_ATTRIBUTION.md)) |
| `kpi_events`    | `session_id`, `event`, `data` (jsonb), `created_at`                                                  |
| `ai_usage`      | `conversation_id` (FK, cascade, nullable), `call_site`, `model`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens` (migration 0039 — prompt-cache splits, see docs/PROMPT_CACHING.md), `campaign_contact_id` (0054, no FK — usage of a Kampagne recipient's draft), `estimated`, `created_at` (migration 0012) |
| `feedback`      | `message` (the comment), optional context: `session_id`, `conversation_id`, `tier`, `email`, `page`; `rating` (1–5) + `email_kind` (0054 — the one-click e-mail rating, `GET /api/newsletter-rating`); `created_at` (migration 0020) |

- **Write path:** `/api/chat` calls `persistTurn()` (`src/lib/conversation-store.ts`)
  in its `onFinish` handler — *after* the stream finishes, so it adds no token
  latency. It upserts the conversation by `conversation_key` (the widget's
  optional `conversationKey`, else the `session_id`), records the persona
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
  fail-silent `track()`), best-effort — never a server-only event name
  (`SERVER_ONLY_EVENTS`, 2026-10-04). Migration **0075** removes duplicate
  `campaign_chat_started` rows (keeps the oldest per `sendId`) and adds the
  partial unique index `kpi_events_campaign_chat_started_send_uidx` on
  `(data->>'sendId') WHERE event = 'campaign_chat_started'` — one chat start per
  campaign send, also under concurrent first turns.
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
| `customers`        | `email` (unique — the person key; `shopify:<id>` placeholder for a Shopify customer without e-mail), `first_seen_at`/`last_seen_at`, `transactional_consent`, `profile_summary` + `profile_summary_updated_at` (regenerated "current understanding"), `profile_data` (jsonb structured profile), `persona_label`, `profile_checked_at` (nightly upkeep), `purchase_summary` (jsonb, the pre-ledger Shopify read, kept as fallback) + `purchase_summary_updated_at`, tier-3 identity (`shopify_customer_id` unique, `shopify_customer_gid`, `shopify_linked_at`, `identity_tier`) — see [`CUSTOMERS.md`](./CUSTOMERS.md). **Mirror (0061):** `first_name`, `last_name`, `locale`, `country_code`, `language_override` (de/en pin of the person), `shopify_state`, `shopify_tags`, `shopify_created_at`, `shopify_updated_at` (stale guard), `shopify_synced_at`, `facts_dirty_at`, `profile_depth` (`kauf` \| `voll`), `profile_objection_at` / `postal_objection_at` (Art. 21); `source` = `chat` \| `shopify` (legacy `shopify_account` / `kampagne` still allowed, backfilled to `shopify`). **One consent (0064):** `email_consent_state` (`subscribed` \| `pending` \| `unsubscribed` \| `not_subscribed`), `email_consent_level` (`confirmed_opt_in` \| `single_opt_in` \| `unknown`), `email_consent_at`, `email_consent_source`, `email_consent_synced_at`; `marketing_status` is kept as a derived compatibility mirror. **Letters:** `postal_address` (jsonb) + `postal_address_source` (`purchase` \| `consented_capture`) + `postal_address_updated_at` (0022), `postal_address_checked_at` (0025), `postal_address_order_id` (0074 — the Shopify order whose shipping address is stored; only a `purchase` address is used for a letter) and `postal_address_invalid_at` (0074 — a letter to the address came back undeliverable; cleared when an address from another order is stored), letter draft (0023) |
| `campaigns`        | One row per campaign (migration 0066, [`CAMPAIGNS.md`](./CAMPAIGNS.md) §2): `name`, `slug` (unique), `kind` (`laufend` \| `aktion` \| `einzel` — exactly one `einzel`), `status` (`entwurf` \| `aktiv` \| `pausiert` \| `beendet` \| `archiviert`), `brief`, `audience` (jsonb spec), `audience_mode` (`dynamisch` \| `fest`), `priority`, `starts_at`/`ends_at`, `daily_target`, `auto_prepare_per_day`, `reentry_days`, `discount_percent`/`discount_scope`/`discount_valid_until`, `design_key`, `hero_mode`, `text_mode`, `mo_promo`, `cta_kind`/`cta_url`, `letter_mode` (0074: `aus` \| `ohne_einwilligung` \| `alle`, default `aus` — letters as a channel, [`CAMPAIGNS.md`](./CAMPAIGNS.md) §8) + `letter_budget_cents` (postage cap, NULL = none), `audience_refreshed_at`, `started_at`/`ended_at`. Seeded: „Bestandskunden – Lebenszyklus“ (`lebenszyklus`) and „Einzelansprache“ |
| `campaign_contacts` | Campaign recipients (migration 0034; per campaign since 0066; „Einplanen“ columns `approved_at`, `release_at`, `approved_fingerprint`, `release_error`, `claimed_at` since 0072 — an approved mail stays `drafted`): one row per person per campaign per re-entry `cycle` — `campaign_id` (FK campaigns, cascade), `customer_id` (FK customers, SET NULL, 0059), `cycle`, `email`, name, `language` + `language_override`, `opt_in_level` (snapshot of the consent level), `orders_count`/`total_spent_cents`/`last_order_at` (snapshot of `customer_facts`), `last_synced_at` (last audience refresh), review `status` (pending/drafted/sending/sent/skipped/suppressed/excluded/draft_failed), `excluded_reason`, `admin_note`, `conversation_id` (FK conversations, SET NULL), `added_at`, `added_manually` (0069 — put in by hand; a dynamic audience refresh keeps the row), `is_test`/`test_source_email` (0057). Unique `(campaign_id, customer_id, cycle)` for real rows, `(campaign_id, email)` for test rows; `shopify_customer_id` is no longer unique (0066). Legacy rows (the former Shopify-subscriber sync, retired) belong to `lebenszyklus` |
| `campaign_drafts`  | One editable draft per recipient (`contact_id` unique, cascade): `subject`, `body` (MO-XXXX placeholder), `discount_percent`, projected `discount_expires_at`, `discount_scope` (all \| recommendations \| set, 0058), compact `purchase_summary` (jsonb), `recommended_product_ids`, `low_confidence` |
| `campaign_sends`   | Immutable campaign send record: `contact_id` (SET NULL), `campaign_id` (FK campaigns, SET NULL, 0066), `customer_id` (FK customers, SET NULL, 0066), `email`, `subject`, `body_hash` (SHA-256 of the shipped text), `sent_via` (email/copy), real `discount_code` (`MK-…`) + gid + expiry, `sent_at` (+ retained bodies, click, snapshot and delivery columns — [`CAMPAIGNS.md`](./CAMPAIGNS.md) §2.5) |
| `campaign_letters` | Letters as a campaign channel (migration 0074, [`CAMPAIGNS.md`](./CAMPAIGNS.md) §8) — one row per person per campaign per `cycle` (always 0 for now), separate from `campaign_contacts`: `campaign_id` (FK campaigns, cascade), `customer_id` (FK customers, cascade), `cycle`, `status` (`pending` \| `drafted` \| `approved` — released by a person, one by one \| `sending` \| `sent` \| `skipped` \| `excluded` \| `failed`), `excluded_reason` (`widerspruch` \| `einwilligung` \| `zielgruppe`), `subject`, `body`, `edited`, `admin_note`, `drafted_at`, `approved_at`, `sent_at`, `page_count`, `physical_letter_id` (FK physical_letters, SET NULL — the posted letter, whose status is read from there), `error` (why a send step returned it), `added_at`, `updated_at`. Unique `(campaign_id, customer_id, cycle)` |
| `physical_letters` | Every letter handed to Pingen (migration 0022; content 0024): `customer_id` (FK customers, SET NULL), `marketing_send_id`, `campaign_id` (0074 — FK campaigns, SET NULL; NULL for a 1:1 letter from Kunden → Brief), `provider` + `provider_letter_id`, normalised `status` (pending … posted, failed / cancelled / undeliverable — from the Pingen webhook), the recipient address snapshot, `subject` + `body`, `cost_cents` |

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
| `customer_orders` (0062) | The local order ledger, minimised (deleted with the person on erasure — Shopify keeps its own orders as long as the law requires): `shopify_order_id` (unique), `customer_id` (FK customers, **cascade**), `shopify_customer_id`, `order_name`, `processed_at`, `financial_status`, `fulfillment_status`, `cancelled_at`, `currency`, `subtotal_cents`, `total_cents`, `refunded_cents`, `last_refund_at` (0070: the newest notable refund, ≥ 10 % of the order value — dates the Eingang rule „Unzufriedenheit“; only moves forward; filled for older orders by a one-off 15-day look-back of the reconcile), `discount_codes` (text[]), `source_name`, `line_items` (jsonb: title, variant title, quantity, unit price, handle/ref, product/variant id), `shopify_updated_at`, `synced_at`. No addresses, payment data, notes or contact fields; guest orders without a customer are not stored. Revenue attribution stays in `mo_orders` (0042). |
| `customer_facts` (0063) | One row per customer (PK = FK customers, cascade), computed with zero tokens by `customer-facts-core.mjs` (`src/lib/customer-facts.ts`; dirty customers first, then everyone older than a day — run nightly by `/api/cron/shopify-reconcile` after the reconcile, and after the bulk import): orders count, spend, first/last order, AOV, median interval, `expected_next_order_at`, refunds, discount share, `lifecycle_segment`, `value_tier`, RFM, `churn_risk`, bought handles/categories, complement handles, conversation count + last chat, discussed/selected handles, marketing sends/clicks/redemptions, last inbound + unanswered mail count, `last_activity_at`, `computed_at` |
| `consent_events` (0064) | The consent history („Einwilligungsverlauf“): `customer_id` (FK customers, cascade), `occurred_at`, `recorded_at`, `source` (mo_capture_form \| mo_chat_gate \| mo_signin \| mo \| shopify \| admin \| import), `state`, `level`, `origin_ref` (never an e-mail address), `text_version` (Shopify-side acts: `SHOPIFY_CONSENT_TEXT_VERSION`), `note`. One row per change of `customers.email_consent_*`; the merge rules live in `consent-core.mjs`. |
| `shopify_webhook_events` (0065) | Webhook dedupe by `X-Shopify-Webhook-Id`: `webhook_id` (PK), `topic`, `received_at`, `processed_at`, `outcome`, `error` — no payload stored |
| `shopify_sync_runs` (0065) | The resumable bulk import and the nightly reconcile: `kind` (`import_customers` \| `import_orders` \| `reconcile` \| `refund_backfill` — the one-off marker of the 15-day refund-date look-back, kept by retention as the only done run of its kind), `status` (running/processing/done/failed/cancelled), `bulk_operation_id`, `result_url`, `byte_offset`, counts (`lines_processed`, `customers_upserted`, `orders_upserted`, `skipped`), `since` (reconcile floor), `started_at`/`updated_at`/`finished_at`, `error` |
| `shopify_outbox` (0065) | Every write Mo makes to Shopify customers, retried with backoff (`src/lib/shopify-outbox.ts`, cron `/api/cron/shopify-sync` every 5 min): `kind` (`consent_update` \| `customer_create` \| `data_erasure` \| `writeback` — Mo's `mo-…` customer tags, `SHOPIFY_WRITEBACK_ENABLED`), `customer_id` (FK customers, SET NULL), `shopify_customer_id`, `payload` (target state; a create's e-mail and name are blanked once the row is done or dead), `status` (pending/running/done/failed/dead/skipped — `running` is the processor's claim, re-picked after a 5-minute lease; `skipped` = superseded by a newer write), `attempts`, `next_attempt_at`, `last_error`, `created_at`, `done_at` |
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
also record the session in `customer_session_links`, with the proof behind it
(`link_kind`: `email` for a typed address, `customer_account` / `app_proxy` for a
sign-in in that session, `legacy` before migration 0071 and for sign-in links
written before 0073; only the sign-in kinds count as signed in). Since 0073 a
sign-in writes its link only when the widget redeems the one-time code
(`customer_link_grants`: `code_hash` (SHA-256, PK), `session_id`, `customer_id` FK
cascade, `link_kind`, `created_at`, `expires_at` (+10 min), `consumed_at`) with the
session the sign-in was started for; logout deletes the signed-in links. Sessions without either stay anonymous and unlinked. Multiple sessions under one person = the
returning-customer case. The marketing consent is the one consent on
`customers.email_consent_*` (migration 0064, shared with Shopify; history in
`consent_events`); `email_captures` stays the audit-grade evidence for consents
given on Mo's surfaces.

See [`CUSTOMERS.md`](./CUSTOMERS.md) for the full model (identity, mirror,
facts, profiles) and [`CONSENT_FLOW.md`](./CONSENT_FLOW.md) for the consent.

## Why conversations and marketing are separate

The schema follows the two-cluster split whose lawful bases and windows
[`DATA_RETENTION.md`](./DATA_RETENTION.md) owns. What it means for the tables:

1. **E-mail addresses live only in Cluster B tables** (`customers`,
   `email_captures`, `suppression_list`, the campaign, correspondence, sign-in
   and Shopify-outbox tables) — plus the optional `feedback.email`, which is
   contact context for that comment, not a consent record. Cluster A is keyed by
   the pseudonymous `session_id`.
2. **One explicit bridge.** `conversations.customer_id` (and
   `email_captures.customer_id`, both 0008, `ON DELETE SET NULL`) is set only
   when the visitor submits an e-mail or signs in in that session (linking rule
   above). A retention purge of a customer returns the conversations to plain
   pseudonymous rows; the complete erasure deletes them.
3. **Independent retention.** Each cluster expires on its own schedule
   ([`DATA_RETENTION.md`](./DATA_RETENTION.md)).

## Table index — every table and where it is documented

Every base table in the schema (migrations `0001`–`0077`; dropped tables
`bestandskunden_suppression_list`, `email_templates`, `email_template_assignments`
are gone since `0029` / `0049`). Columns of the tables marked *here* are in the
sections above; the others are owned by the linked doc. Retention and erasure of
every table: [`DATA_RETENTION.md`](./DATA_RETENTION.md).

| Table | Created | Columns + semantics |
| --- | --- | --- |
| `conversations`, `messages`, `kpi_events` | 0001 | here (Cluster A) |
| `email_captures`, `suppression_list`, `marketing_sends` | 0001 | here (Cluster B); consent: [`CONSENT_FLOW.md`](./CONSENT_FLOW.md) |
| `kpi_persona_question_summaries` | 0004 | `persona_label` (PK), `summary_md`, `sample_size`, `model`, `generated_at` — the KPI tab's „Top-Fragen“ cache per persona ([`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md)) |
| `customers` | 0008 | here + [`CUSTOMERS.md`](./CUSTOMERS.md) |
| `ai_usage` | 0012 | here; cache columns: [`PROMPT_CACHING.md`](./PROMPT_CACHING.md) |
| `bundle_offers` | 0013 | [`BUNDLES.md`](./BUNDLES.md) „Data model“ |
| `customer_oauth_tokens`, `customer_auth_pending`, `customer_merge_conflicts` | 0014 | [`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §5 |
| `customer_session_links` | 0019 (`link_kind`, `authenticated_at` 0071) | `session_id` (PK), `customer_id` (FK customers, cascade), `linked_at`, `last_seen_at`, `link_kind`, `authenticated_at` — here („The customer entity“) |
| `feedback` | 0020 | here (Cluster A) |
| `email_messages` | 0021 | `direction` (sent/received), `message_id` / `in_reply_to` / `references_ids` / derived `thread_id`, `from_address`, `to_address`, `subject`, `body_text`, `body_html`, `snippet`, `attachments` (metadata only), `provider` (`resend` \| `kontaktformular`), `provider_email_id`, `customer_id` + `marketing_send_id` (both SET NULL), `occurred_at` — the Korrespondenz log ([`DATA_RETENTION.md`](./DATA_RETENTION.md) „Korrespondenz“) |
| `physical_letters` | 0022 | here (Cluster B) |
| `admin_access_log` | 0028 | `action`, `target_customer_id` (no FK — survives the erasure), `detail` (ids and counts only), `ip`, `session_fp` (SHA-256 of the admin cookie, truncated), `occurred_at` — every admin access to customer data (`recordAdminAccess`) |
| `conversation_insights` | 0031 (`references_json` 0033) | `date_from`/`date_to`, `summary_md`, `analyzed_count`, `model`, token counts, `references_json`, `generated_at` — the Gespräche insights rollup ([`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md)) |
| `analytics_reports` | 0032 | `title`, `date_from`/`date_to`, `preset`, `status` (running/complete/failed), `phase`, `progress`, `options`, `sections` (jsonb; v2 since 2026-10-06 adds `version`, `snapshot`, `decision`, `comparison`), `usage`, `error`, timestamps, `step_claimed_at` (0077 — the step claim) — the stored Komplettanalyse ([`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §3.8) |
| `campaign_contacts`, `campaign_drafts`, `campaign_sends` | 0034 | here + [`CAMPAIGNS.md`](./CAMPAIGNS.md) §2.5 (owner) |
| `qa_entries` | 0036 (`question_en`/`answer_en` 0037) | [`QA_KNOWLEDGE.md`](./QA_KNOWLEDGE.md) |
| `mo_attribution_tokens`, `mo_orders` | 0042 | [`ORDER_ATTRIBUTION.md`](./ORDER_ATTRIBUTION.md) |
| `improvement_runs`, `improvement_suggestions`, `mo_directives`, `mo_directive_versions` | 0044 (`step_claimed_at` 0045) | [`IMPROVEMENT_LOOP.md`](./IMPROVEMENT_LOOP.md) |
| `email_design_selections` | 0049 | `email_kind` (PK: summary/doi/marketing/campaign), `design_key`, `updated_at` — [`EMAIL_DESIGNS.md`](./EMAIL_DESIGNS.md) |
| `customer_orders`, `customer_facts`, `consent_events`, `shopify_webhook_events`, `shopify_sync_runs`, `shopify_outbox`, `erasure_tombstones` | 0062–0065 | here (Kundenstamm) |
| `campaigns` | 0066 | here + [`CAMPAIGNS.md`](./CAMPAIGNS.md) §2 |
| `inbox_items` | 0067 | here (Kundenstamm) |
| view `customer_overview` | 0068 | here |
| `customer_link_grants` | 0073 | here („The customer entity“) |
| `campaign_letters` | 0074 | here + [`CAMPAIGNS.md`](./CAMPAIGNS.md) §8 |
| `_migrations` | runner | applied migration names (`scripts/migrate.mjs`) |

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
data. Not seeded: OAuth tokens, pending sign-ins, merge conflicts, erasure tombstones,
`campaign_letters`, `customer_link_grants` — all of them empty after `--reset` (the first four are
in its truncate list, the last two go with `TRUNCATE … CASCADE` over their `customers` FK).

`npm run db:reset` (`scripts/reset-test-data.mjs`, gated on `ALLOW_DB_RESET=true`; locally
together with `NEON_FETCH_ENDPOINT`) is the destructive `TRUNCATE … RESTART IDENTITY` of every
data table, on any migration level. It has no table list of its own: the data tables are the
ones `migrations/` creates and no later migration drops (read at run time, plan in the tested
`src/lib/db-reset-plan.mjs`). It keeps `_migrations`, `campaigns` (the built-in Einzelansprache
and Lebenszyklus exist only through migration `0066`) and `email_design_selections`
(configuration). It prints the target host and database first and **aborts before deleting
anything** when the database has no `_migrations`, when a live table is created by no migration
of the checkout (a foreign database, a table made by hand, a checkout older than the database)
or when a kept table has a foreign key to a wiped one; the TRUNCATE runs without `CASCADE`.
Afterwards every wiped table must count 0 and every kept table its old row count. To refill a
local database use `npm run db:seed -- --reset`.
