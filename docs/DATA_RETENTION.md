# Data retention & lawful basis

> **Status:** sensible engineering defaults. Legal/DPO will refine the windows
> and copy. This document describes what the backend stores, *why* it is
> allowed to (lawful basis under GDPR Art. 6), and *how long* it is kept.

The data model is split into two clusters with **different lawful bases**. They
are kept structurally separate; for anonymous traffic the only bridge is the
pseudonymous `session_id`, which a user severs by clearing their browser
storage. Since migration `0008_customers.sql` there is **one explicit,
consent-anchored exception**: the nullable `conversations.customer_id` /
`email_captures.customer_id` foreign keys (`ON DELETE SET NULL`), set only when
the user actively submits their email — erasing a customer returns the linked
rows to plain pseudonymous data (see [`DATABASE.md`](./DATABASE.md)). Keep the
clusters separate otherwise — do not denormalise an email onto a conversation.

---

## Cluster A — Conversation & analytics

**Lawful basis: legitimate interest / performance of service (Art. 6(1)(f) /
6(1)(b)).** Running the chat, generating a conversation summary, and computing
product KPIs are core to providing the service the visitor asked for. This data
is **pseudonymous**: keyed by a client-generated `session_id`, never an email.

| Table           | What's stored                                                                 | Contains PII?            |
| --------------- | ----------------------------------------------------------------------------- | ------------------------ |
| `conversations` | `session_id`, timestamps, derived persona label, message count, referenced product ids, status | No (pseudonymous)        |
| `messages`      | role, message text, which tools fired                                          | Only if a user types it  |
| `kpi_events`    | event name, pseudonymous `session_id`, free-form jsonb `data`                  | No (telemetry)           |
| `ai_usage`      | AI call site, model id, input/output token counts, optional `conversation_id`  | No (token counts only)   |

**Note on free-text:** users *can* type personal data into a chat message. We
do not solicit it, and the retention window below bounds how long any such text
survives. Do not log message content to third parties.

### Retention windows (Cluster A)

| Data                          | Default window | Env var               | Action on expiry            |
| ----------------------------- | -------------- | --------------------- | --------------------------- |
| Conversations + messages      | **180 days**   | `RETENTION_DAYS`      | Hard delete (messages + chat `ai_usage` cascade) |
| KPI / telemetry events        | **180 days**   | `KPI_RETENTION_DAYS`  | Hard delete                 |
| AI usage — chat               | follows the conversation | `RETENTION_DAYS` | Cascade-deleted with the conversation (FK) |
| AI usage — dashboard/admin    | **180 days**   | `KPI_RETENTION_DAYS`  | Hard delete (by `created_at`) |
| Active → abandoned transition | **30 minutes** idle | `ABANDON_AFTER_MINUTES` | Status flip (not deletion) |

Windows are measured from `last_activity_at` (conversations) and `created_at`
(kpi_events, dashboard/admin `ai_usage`).

**AI usage rows follow their conversation.** Chat `ai_usage` rows carry a
`conversation_id` foreign key with `ON DELETE CASCADE`, so they are deleted
together with the conversation they measure — exactly the same window. Only the
dashboard/admin rows (email drafts, profiles, top-questions, embeddings — which
have no conversation) are purged independently, on the analytics window.

---

## Cluster B — Consent & marketing

**Lawful basis: explicit consent (Art. 6(1)(a)).** This is the **only** place an
email address is stored. A row exists here *only* because the user actively
submitted their email and made a consent choice. We record the **exact consent
copy shown** (`consent_text_shown`) as proof, and run marketing consent through
a **double opt-in** (`marketing_doi_status`).

| Table              | What's stored                                                                           | Lawful basis                |
| ------------------ | --------------------------------------------------------------------------------------- | --------------------------- |
| `email_captures`   | email, transactional/marketing consent flags, DOI status + token, consent copy, unsubscribe time | Explicit consent            |
| `suppression_list` | email, when, reason (unsubscribe / bounce / complaint / erasure)                        | Legitimate interest (honouring opt-outs) |
| `marketing_sends`  | drafted/approved/sent marketing message tied to a capture, discount code, order match   | Explicit consent            |

### Retention windows (Cluster B)

| Data                                   | Default window      | Env var                         | Action on expiry      |
| -------------------------------------- | ------------------- | ------------------------------- | --------------------- |
| `email_captures` after unsubscribe     | **30 days** grace   | `SUPPRESSED_CAPTURE_PURGE_DAYS` | Hard delete the capture |
| `email_captures` for suppressed emails | **30 days** grace   | `SUPPRESSED_CAPTURE_PURGE_DAYS` | Hard delete the capture |
| `suppression_list`                     | **Kept**            | —                               | Retained to keep honouring the opt-out |

**Why the suppression list is kept:** to *not* email someone who opted out, we
must remember that they opted out. The suppression record is the minimum data
needed for that and is justified by legitimate interest. The richer capture
(consent flags, tokens, copy) is purged after the grace period.

---

## Cluster B (cont.) — Bundle offers

**Lawful basis: explicit consent (Art. 6(1)(a)).** A **bundle offer**
(`bundle_offers`, migration `0013`, see [`BUNDLES.md`](./BUNDLES.md)) is a real
Shopify product generated *for* a person and sent through the consented
marketing channel, so it follows the **same lawful basis and rules as a
marketing send**. Its only personal link is the nullable `customer_id`
(`ON DELETE SET NULL`) — the row itself stores **no email**; it holds Shopify
product/variant ids, a component **price snapshot**, the offer price, the
materialized cart link and the lifecycle status.

| Table           | What's stored                                                                              | Lawful basis     |
| --------------- | ------------------------------------------------------------------------------------------ | ---------------- |
| `bundle_offers` | nullable `customer_id`, component snapshot (no PII), prices, Shopify ids, status/timestamps | Explicit consent |

### Retention windows (bundle offers)

| Data                          | Default window | Env var                    | Action on expiry / erasure                          |
| ----------------------------- | -------------- | -------------------------- | --------------------------------------------------- |
| Offer **availability**        | **7 days**     | `BUNDLE_OFFER_EXPIRY_DAYS` | `/api/cron/expire-bundles` archives the Shopify product + flips the row to `expired` (kept for audit/KPIs) |
| Offer **record → customer link** | follows the customer | `SUPPRESSED_CAPTURE_PURGE_DAYS` | erasing the customer **SET NULL**s `customer_id`; the de-identified offer row (Shopify ids + prices, no PII) is retained for order-history/KPI integrity |

**Why the record is kept after the customer is erased.** Like `marketing_sends`,
a bundle offer can correspond to a **real Shopify order**; deleting it would
orphan order history. The `ON DELETE SET NULL` link means a GDPR erasure removes
the *person* (the email + cached summaries on `customers`) while the offer row —
which carries no directly-identifying field — stays for accounting/KPIs. The
**archived-offer window** is therefore "kept de-identified"; the *active* window
is the 7-day availability above, enforced by the expiry cron (ARCHIVE, never
DELETE, so the Shopify side stays reversible too).

---

## How retention is enforced

A daily cron — `GET /api/cron/retention`, scheduled in `vercel.json`, protected
by `CRON_SECRET` — calls `runRetention()` (`src/lib/retention.ts`). Each run:

1. Marks stale `active` conversations `abandoned`.
2. Deletes conversations past `RETENTION_DAYS` (messages + chat `ai_usage` cascade).
3. Deletes `kpi_events` past `KPI_RETENTION_DAYS`, and the dashboard/admin
   `ai_usage` rows (those with no `conversation_id`) on the same window.
4. Purges PII for unsubscribed / suppressed `email_captures` past the grace
   window, keeping the `suppression_list` entry.
5. Purges the matching `customers` rows (email + cached profile / purchase
   summaries — all PII under the same consent) for the same opted-out
   addresses, after the capture purge; their `ON DELETE SET NULL` FKs return
   the linked conversations to plain pseudonymous rows (see
   [`CUSTOMERS.md`](./CUSTOMERS.md)).

### Running it manually

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://chat.motionsports.de/api/cron/retention
```

The endpoint returns a JSON summary with the counts affected, e.g.:

```json
{
  "ok": true,
  "options": { "retentionDays": 180, "kpiRetentionDays": 180, "abandonAfterMinutes": 30, "suppressedPurgeDays": 30 },
  "abandonedConversations": 4,
  "deletedConversations": 12,
  "deletedKpiEvents": 833,
  "deletedAiUsage": 27,
  "purgedSuppressedCaptures": 1,
  "purgedSuppressedCustomers": 1,
  "ranAt": "2026-06-03T03:30:00.000Z"
}
```

---

## Data-subject requests (forward note)

The consent flow has shipped (see [`CONSENT_FLOW.md`](./CONSENT_FLOW.md)); a
self-service erasure path is still **future work**. Until it lands, a
subject-access or erasure request is handled manually:

- **Erasure of an email:** add it to `suppression_list` (reason `erasure`) and
  delete its `email_captures` / `marketing_sends` rows. The next retention run
  also enforces this.
- **Erasure of a conversation:** delete the `conversations` row by `session_id`
  (messages cascade). This is only possible if the user can supply their
  `session_id`, since Cluster A holds no identifier that maps to a person.
