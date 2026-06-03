# Database

The backend persists conversations, telemetry, and (later) marketing consent in
Postgres. This document covers the client, how to run migrations, the schema,
and the deliberate separation between the conversation and marketing data.

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
the pooled one. To add a migration, drop a new file like
`migrations/0002_xxx.sql` — it must use plain DDL (`--` comments and `;`
statement separators; no dollar-quoted function bodies, which the lightweight
splitter doesn't parse).

## Schema overview

The schema is split into **two clusters** (see the separation rationale below).

### Cluster A — conversation / analytics (pseudonymous)

| Table           | Key columns                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `conversations` | `session_id` (unique), `created_at`/`updated_at`/`last_activity_at`, `persona_label`, `message_count`, `recommended_product_ids` (text[]), `status` (active/abandoned/converted) |
| `messages`      | `conversation_id` (FK, cascade), `client_message_id` (idempotency), `role`, `content`, `tool_name`  |
| `kpi_events`    | `session_id`, `event`, `data` (jsonb), `created_at`                                                  |

- **Write path:** `/api/chat` calls `persistTurn()` (`src/lib/conversation-store.ts`)
  in its `onFinish` handler — *after* the stream finishes, so it adds no token
  latency. It upserts the conversation by `session_id`, records the persona
  label, accumulates `recommended_product_ids` from product-referencing tool
  calls, and inserts the new user + assistant messages.
- **Idempotency:** message inserts dedupe on
  `(conversation_id, client_message_id, COALESCE(tool_name,''))`, so re-sent
  history never duplicates rows.
- **Telemetry:** `/api/kpi` inserts pseudonymous `kpi_events` (the widget's
  fail-silent `track()`), best-effort.

### Cluster B — consent / marketing (email lives ONLY here)

| Table              | Key columns                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| `email_captures`   | `email`, `transactional_consent`, `marketing_consent`, `marketing_doi_status`, `doi_token`, `doi_confirmed_at`, `consent_text_shown`, `unsubscribed_at` |
| `suppression_list` | `email` (PK), `added_at`, `reason`                                                                       |
| `marketing_sends`  | `email_capture_id` (FK, cascade), `drafted_text`, `discount_code`, `sent_at`, `status` (draft/approved/sent), `shopify_order_matched` |

> The consent flow, dashboards, and marketing sends are **future work**. This
> session only creates the tables so the consent system can be built on a
> stable schema.

## Why conversations and marketing are separate

This separation is a GDPR design decision, not just tidiness:

1. **Different lawful bases.** Conversations/analytics run on *legitimate
   interest / service provision*; marketing email runs on *explicit consent*.
   Mixing them would let the weaker basis contaminate the stronger one.
2. **Email is quarantined.** An email address appears in **exactly one place**
   (`email_captures`). Conversations are pseudonymous (`session_id` only), so
   the bulk of stored data carries no directly-identifying field.
3. **No foreign key between clusters.** They are intentionally not joined in
   the schema. The only bridge is the pseudonymous `session_id`, which a user
   can sever by clearing browser storage.
4. **Independent retention.** Each cluster expires on its own schedule (see
   [`DATA_RETENTION.md`](./DATA_RETENTION.md)) — e.g. purging a marketing
   capture on unsubscribe doesn't touch conversation analytics, and deleting an
   old conversation doesn't touch a still-valid marketing consent.

See [`DATA_RETENTION.md`](./DATA_RETENTION.md) for lawful basis and retention
windows in detail.
