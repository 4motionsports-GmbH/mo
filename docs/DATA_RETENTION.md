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

## Cluster B (cont.) — Signed-in customers (tier 3)

**Lawful basis: performance of a contract / legitimate interest (Art. 6(1)(b) /
6(1)(f)).** When a visitor signs in with their Shopify account (the Customer
Account API flow, see [`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md)), we hold the
**OAuth tokens** needed to read *their own* Shopify data on their behalf, plus the
identity linkage on the `customers` row. **Shopify stays authoritative** for the
name/email/addresses/orders themselves — we do not copy that PII into our DB in
CA-1; we re-fetch it live. Signing in establishes **identity, not marketing
consent** — Shopify's marketing state is never imported into `marketing_status`.

| Table | What's stored | Notes |
| --- | --- | --- |
| `customers` (tier-3 columns) | `shopify_customer_id`, `shopify_customer_gid`, `shopify_linked_at`, `identity_tier` | identity linkage; the email column stays the single email home |
| `customer_oauth_tokens` | **encrypted** access + refresh tokens (AES-256-GCM, `TOKEN_ENC_KEY`), `id_token_sub`, scope, expiries | server-side only; **never** sent to the browser |
| `customer_auth_pending` | short-lived CSRF `state` + PKCE `code_verifier` + `nonce` + `return_url` | transient; ~10-min TTL |
| `customer_merge_conflicts` | sign-in merge conflicts for admin review (no tokens) | consent-provenance audit trail |

### Retention windows (tier 3)

| Data | Default window | Env var | Action on expiry / erasure |
| --- | --- | --- | --- |
| `customer_oauth_tokens` | follows the customer | — | **Cascade-deleted** with the customer (`ON DELETE CASCADE`). A GDPR erasure / customer purge removes the tokens in the same step. Access tokens also rotate/expire continuously (refresh-token rotation). |
| `customer_auth_pending` | **~10 min** | `CUSTOMER_AUTH_PENDING_TTL_MINUTES` | Hard delete by the retention cron once past `expires_at`. |
| `customer_merge_conflicts` | kept until reviewed | — | Retained for consent auditability; cleared by an admin. |

**Why tokens have no separate window:** they exist only to act for a *currently
signed-in* customer and they live and die with that customer's row. Logging out
(`/api/auth/shopify/logout/return`) drops the token row immediately; otherwise
they cascade away when the customer is erased.

### Signed-in conversation history — single-chat delete vs. the durable profile

A signed-in (tier-3) customer can manage their own conversation history through
`/api/account/*` (see [`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §9). This
does **not** change the cluster split — it gives the *data subject* the controls
the split implies:

- **Deleting a single chat HARD-deletes that transcript** —
  `DELETE /api/account/conversations/{id}` removes the `conversations` row plus
  its `messages` + chat `ai_usage` (FK `ON DELETE CASCADE`), immediately and
  irreversibly, ahead of the 180-day Cluster A window. The optional
  `conversations.title` (migration `0016`, a custom label) lives on the row and
  is removed with it; it stores no new PII (a derived title is a slice of the
  customer's own first message, already bounded by the conversation window).
- **The durable "current understanding" profile is a SEPARATE aggregate under a
  different lawful basis.** `customers.profile_summary` (Cluster B) is *derived
  from* conversations but stored independently and regenerated on demand.
  Deleting a source conversation means a **future profile regeneration no longer
  sees it**, but **profile text already derived persists** until the profile is
  regenerated or the customer is erased. Single-chat delete deliberately does
  **not** reach into the profile — conflating the two lawful bases would be
  wrong; the erasure path below is what clears the profile.

| Data | Default window | Env var | Action on expiry / erasure |
| --- | --- | --- | --- |
| `conversations.title` (tier-3 custom label) | follows the conversation | `RETENTION_DAYS` | Removed with the conversation (single-chat delete or window expiry). |

### Self-service "delete my data" (tier-3) — `POST /api/account/erase`

A signed-in customer can erase **all** their data themselves — a GDPR erasure of
the *person*, **distinct** from the single-chat delete. In one transaction
(`lib/account-history.ts :: eraseSignedInCustomer`):

1. **Purges every linked conversation** (all transcripts + messages + chat
   `ai_usage` cascade) — not merely unlinked.
2. **Suppresses + purges the consent record** — adds the (real) email to
   `suppression_list` (reason `erasure`) so a future sign-in can't silently
   re-attach, and deletes its `email_captures` (`marketing_sends` cascade).
   Skipped for the synthetic `shopify:<id>` placeholder email.
3. **Deletes the `customers` row** — clearing the **profile + all cached
   summaries** (they live on the row) and **revoking the OAuth tokens**
   (`customer_oauth_tokens` `ON DELETE CASCADE`); `bundle_offers`
   `ON DELETE SET NULL` keeps the de-identified offer row for accounting.

This is the stronger sibling of the retention cron's step 5: the cron erases
*opted-out* customers and uses `ON DELETE SET NULL` to return their conversations
to pseudonymous rows; the self-service erase **purges** the customer's
conversations outright, because they are the customer's own transcripts and a
"delete my data" should remove them. Both paths revoke tokens and clear the
profile by deleting the `customers` row.

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
   [`CUSTOMERS.md`](./CUSTOMERS.md)), and their `customer_oauth_tokens` cascade
   away.
6. Purges expired `customer_auth_pending` rows (the short-lived sign-in
   CSRF/PKCE state).

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
  "purgedAuthPending": 3,
  "ranAt": "2026-06-03T03:30:00.000Z"
}
```

---

## Data-subject requests (forward note)

The consent flow has shipped (see [`CONSENT_FLOW.md`](./CONSENT_FLOW.md)).

**Signed-in (tier-3) customers now have a self-service path** (see the section
above): `DELETE /api/account/conversations/{id}` erases a single transcript, and
`POST /api/account/erase` erases the whole person (conversations purged + profile
cleared + tokens revoked + email suppressed). No manual step is needed for them.

For **anonymous / email-only** subjects, a subject-access or erasure request is
still handled manually:

- **Erasure of an email:** add it to `suppression_list` (reason `erasure`) and
  delete its `email_captures` / `marketing_sends` rows. The next retention run
  also enforces this. (This is exactly what the tier-3 erase path does
  automatically for the signed-in customer's email.)
- **Erasure of a conversation:** delete the `conversations` row by `session_id`
  (messages cascade). This is only possible if the user can supply their
  `session_id`, since Cluster A holds no identifier that maps to a person —
  unless they are a signed-in customer, who can delete it themselves by id.
