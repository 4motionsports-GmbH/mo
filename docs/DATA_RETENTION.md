# Data retention & lawful basis

> **Status:** sensible engineering defaults. Legal/DPO will refine the windows
> and copy. This document describes what the backend stores, *why* it is
> allowed to (lawful basis under GDPR Art. 6), and *how long* it is kept.

The data model is split into two clusters with **different lawful bases**. They
are kept structurally separate (no foreign key linking them); the only bridge
is the pseudonymous `session_id`, which a user severs by clearing their browser
storage. Keep them separate — do not denormalise an email onto a conversation.

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

**Note on free-text:** users *can* type personal data into a chat message. We
do not solicit it, and the retention window below bounds how long any such text
survives. Do not log message content to third parties.

### Retention windows (Cluster A)

| Data                          | Default window | Env var               | Action on expiry            |
| ----------------------------- | -------------- | --------------------- | --------------------------- |
| Conversations + messages      | **180 days**   | `RETENTION_DAYS`      | Hard delete (messages cascade) |
| KPI / telemetry events        | **180 days**   | `KPI_RETENTION_DAYS`  | Hard delete                 |
| Active → abandoned transition | **30 minutes** idle | `ABANDON_AFTER_MINUTES` | Status flip (not deletion) |

Windows are measured from `last_activity_at` (conversations) and `created_at`
(kpi_events).

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

## How retention is enforced

A daily cron — `GET /api/cron/retention`, scheduled in `vercel.json`, protected
by `CRON_SECRET` — calls `runRetention()` (`src/lib/retention.ts`). Each run:

1. Marks stale `active` conversations `abandoned`.
2. Deletes conversations past `RETENTION_DAYS` (messages cascade).
3. Deletes `kpi_events` past `KPI_RETENTION_DAYS`.
4. Purges PII for unsubscribed / suppressed `email_captures` past the grace
   window, keeping the `suppression_list` entry.

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
  "purgedSuppressedCaptures": 1,
  "ranAt": "2026-06-03T03:30:00.000Z"
}
```

---

## Data-subject requests (forward note)

The consent flow and a self-service erasure path are **future work**. Until they
land, a subject-access or erasure request is handled manually:

- **Erasure of an email:** add it to `suppression_list` (reason `erasure`) and
  delete its `email_captures` / `marketing_sends` rows. The next retention run
  also enforces this.
- **Erasure of a conversation:** delete the `conversations` row by `session_id`
  (messages cascade). This is only possible if the user can supply their
  `session_id`, since Cluster A holds no identifier that maps to a person.
