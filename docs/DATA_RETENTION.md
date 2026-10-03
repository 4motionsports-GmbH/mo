# Data retention & lawful basis

> **Status:** sensible engineering defaults. Legal/DPO will refine the windows
> and copy. This document describes what the backend stores, *why* it is
> allowed to (lawful basis under GDPR Art. 6), and *how long* it is kept.

The data model is split into two clusters with **different lawful bases**. They
are kept structurally separate; for anonymous traffic the only bridge is the
pseudonymous `session_id`, which a user severs by clearing their browser
storage. Since migration `0008_customers.sql` there is **one explicit,
identity-anchored exception**: the nullable `conversations.customer_id` /
`email_captures.customer_id` foreign keys (`ON DELETE SET NULL`), set only when
the user actively submits their email or signs in with their shop account —
erasing a customer returns the linked rows to plain pseudonymous data (see
[`DATABASE.md`](./DATABASE.md)). Keep the clusters separate otherwise — do not
denormalise an email onto a conversation.

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
| Insights rollups (`conversation_insights`) | **180 days** by `generated_at` | `KPI_RETENTION_DAYS` | Hard delete (derived from Cluster A — leaves when its sources would; regenerable on demand) |
| Persona top-question cache (`kpi_persona_question_summaries`) | **180 days** by `generated_at` | `KPI_RETENTION_DAYS` | Hard delete (derived cache, regenerable on demand) |
| Komplettanalyse reports (`analytics_reports`) | **365 days** by `created_at` | `ANALYTICS_REPORT_RETENTION_DAYS` | Hard delete — reports generated with per-customer profiles carry customer display names and must not live forever. 0 disables. |
| Order-attribution rows (`mo_orders`) | **180 days** by `COALESCE(processed_at, created_at)` | `KPI_RETENTION_DAYS` | Hard delete (Cluster-A analytics like `kpi_events`; pseudonymous order facts only — see `docs/ORDER_ATTRIBUTION.md`) |
| Attribution tokens (`mo_attribution_tokens`) | **window + 7 days** by `created_at` | `MO_ATTRIBUTION_WINDOW_DAYS` (window, default 30) | Hard delete — a token past the attribution window can never attribute again |
| Active → abandoned transition | **30 minutes** idle | `ABANDON_AFTER_MINUTES` | Status flip (not deletion) |

Windows are measured from `last_activity_at` (conversations) and `created_at` /
`generated_at` (kpi_events, dashboard/admin `ai_usage`, derived caches).

**Conversion sweep (status maintenance, not deletion).** The same daily cron
run also executes the bounded conversion sweep
(`src/lib/conversion-sweep.ts`, `CONVERSION_SWEEP_MAX_CODES`, default 25,
0 disables): sent marketing emails whose unique `MS5-` code was redeemed in a
real Shopify order are marked (`marketing_sends.shopify_order_matched`) and
their source conversation flips to `status='converted'`. Pseudonymous status
maintenance — no new data category, no PII written into Cluster A.

**AI usage rows follow their conversation.** Chat `ai_usage` rows carry a
`conversation_id` foreign key with `ON DELETE CASCADE`, so they are deleted
together with the conversation they measure — exactly the same window. Only the
dashboard/admin rows (email drafts, profiles, top-questions, embeddings — which
have no conversation) are purged independently, on the analytics window.

---

## Cluster B — Consent & marketing

**Lawful basis: explicit consent (Art. 6(1)(a)).** E-mail addresses live only in
Cluster B. An `email_captures` row exists *only* because the user actively
submitted their email on a Mo surface and made a consent choice. We record the
**exact consent copy shown** (`consent_text_shown`) as proof, and run Mo's
marketing opt-in through a **double opt-in** (`marketing_doi_status`). Since
migration `0064` the marketing consent itself is **one consent per person**,
shared with Shopify in both directions: its state lives on
`customers.email_consent_*` (Kundenstamm, below) and every change is appended to
`consent_events`; `email_captures` stays the Art. 7 evidence for consents given
on Mo's surfaces (see [`CONSENT_FLOW.md`](./CONSENT_FLOW.md)).

| Table              | What's stored                                                                           | Lawful basis                |
| ------------------ | --------------------------------------------------------------------------------------- | --------------------------- |
| `email_captures`   | email, transactional/marketing consent flags, DOI status + token, consent copy, unsubscribe time | Explicit consent            |
| `consent_events`   | history of the one consent: customer id, when, source (Mo surface / Shopify / admin / import), state, level, origin reference (never an email), Shopify consent text version, note | Proof of consent (Art. 7(1)) |
| `suppression_list` | email, when, reason (unsubscribe / manual / bounce / complaint / erasure)               | Legitimate interest (honouring opt-outs) |
| `marketing_sends`  | drafted/approved/sent marketing message tied to a capture, discount code, order match   | Explicit consent            |

### Retention windows (Cluster B)

| Data                                   | Default window      | Env var                         | Action on expiry      |
| -------------------------------------- | ------------------- | ------------------------------- | --------------------- |
| `email_captures` after unsubscribe     | **30 days** grace   | `SUPPRESSED_CAPTURE_PURGE_DAYS` | Hard delete the capture |
| `email_captures` for suppressed emails | **30 days** grace   | `SUPPRESSED_CAPTURE_PURGE_DAYS` | Hard delete the capture |
| `consent_events`                       | follows the customer | —                              | Cascade-deleted with the customer row (erasure); no own window |
| `suppression_list`                     | **Kept**            | —                               | Retained to keep honouring the opt-out |

**Why the suppression list is kept:** to *not* email someone who opted out, we
must remember that they opted out. The suppression record is the minimum data
needed for that and is justified by legitimate interest. The richer capture
(consent flags, tokens, copy) is purged after the grace period.

---

## Cluster B (cont.) — Campaigns

**Lawful basis: the one marketing consent (Art. 6(1)(a)) — Shopify's checkbox
consent or our DOI, shared in both directions (migration `0064`).** The campaign
module ([`CAMPAIGNS.md`](./CAMPAIGNS.md), migrations `0034` / `0066`) defines
campaigns (`campaigns` — no personal data) and materialises each campaign's
audience from the Kundenstamm into recipient rows (`campaign_contacts`: name,
email, language, opt-in level, order figures — a snapshot per campaign and
cycle), keeps ONE editable draft per recipient (`campaign_drafts`, incl. a
compact purchase snapshot) and an immutable send record (`campaign_sends` —
email, subject, **body hash**, the shipped body, the `MK-` discount code). Only
people whose consent is `subscribed` and who are not blocked ever become
recipients; the send path re-checks both. ⚠️ Because the Shopify-side consent is
not always a provable double opt-in, the channel is send-gated
(`CAMPAIGN_SENDS_APPROVED`, `CAMPAIGN_ALLOW_SINGLE_OPT_IN` — see the legal model
in `CAMPAIGNS.md` §3).

The **customer profile** a draft reads lives on the customer row and goes with
it: a complete erasure removes it, an Art. 21 objection to profiling
(`customers.profile_objection_at`) clears it and stops it being rebuilt, and
retention step 5 / 5e remove it with a non-Shopify customer
([`CUSTOMERS.md`](./CUSTOMERS.md)). An erased address is on `suppression_list`
with reason `erasure` and is never matched by an audience again.

**Clicks and chats from a campaign mail** are counted without linking the
pseudonymous chat to the person: a click stamps the send (`clicked_at`) and
writes a `campaign_email_clicked` KPI event; a chat the widget opens from the
mail's Mo link (`campaignToken` on `POST /api/chat`) writes ONE
`campaign_chat_started` event per send. Both events have `session_id = NULL`
and carry only ids (`sendId`, `campaignId` / `firstClick`); they age out with
`KPI_RETENTION_DAYS` like every `kpi_events` row.

*(Retired: until the customer platform the audience was the shop's SUBSCRIBED
newsletter list, synced daily into `campaign_contacts` by
`/api/cron/sync-campaign-audience`. Replaced by the Kundenstamm mirror and the
nightly audience refresh `/api/cron/campaign-audiences`.)*

### Retention windows (campaign)

| Data                | Default window | Env var                           | Action on expiry |
| ------------------- | -------------- | --------------------------------- | ---------------- |
| `campaign_contacts` (+ drafts, cascade) | **365 days** by `COALESCE(last_synced_at, created_at)` | `CAMPAIGN_CONTACT_RETENTION_DAYS` | Hard delete (an open recipient that still matches its audience is refreshed every night and stays; a sent, skipped, suppressed or excluded one ages out). Testkontakte are never purged by this step. |
| `campaign_sends`    | **365 days** by `sent_at` | `CAMPAIGN_CONTACT_RETENTION_DAYS` | Hard delete      |
| `campaigns`         | kept           | —                                 | No personal data; archived by the operator |
| `suppression_list`  | **Kept**       | —                                 | Retained to keep honouring the opt-out (unchanged) |

---

## Cluster B (cont.) — Kundenstamm (Shopify customer mirror)

**Lawful basis: performance of a contract / legitimate interest (Art. 6(1)(b) /
6(1)(f)) — the shop's existing customer relationship, NOT marketing consent.**
Since migration `0061` every Shopify customer is a `customers` row
(`source = 'shopify'`): bulk import, `customers/*` and `orders/*` webhooks and a
nightly reconcile (`lib/shopify-sync.ts`, gate `SHOPIFY_CUSTOMER_SYNC_ENABLED`;
see [`CUSTOMERS.md`](./CUSTOMERS.md)). Mo stores what the Kunden screen, the
audiences and the Eingang need, minimised:

| Table | What's stored | Notes |
| --- | --- | --- |
| `customers` (mirror columns, `0061`) | Shopify id + gid, email, first/last name, locale, country, Shopify account state, tags, Shopify timestamps, language pin, Art. 21 objections (`profile_objection_at`, `postal_objection_at`), the one consent (`email_consent_*`, `0064`) | The AI profile (`profile_summary` / `profile_data`, `profile_depth` Vollprofil/Kaufprofil) is built per `CUSTOMER_AI_PROFILE_SCOPE` (`consented` default \| `all` — decided for this shop, lawyer to confirm); with `all`, profiles of people without consent are flagged and every advertising action stays blocked. An objection deletes the profile and stops it being rebuilt. |
| `customer_orders` (`0062`) | the order ledger: order ids, dates, statuses, money, discount codes, line items (title, variant, quantity, unit price, handle) | No addresses, payment data, notes or contact fields; guest orders without a customer are not stored |
| `customer_facts` (`0063`) | derived figures per customer (orders, spend, intervals, lifecycle segment, value tier, churn risk, categories, chat / mail / click counts) | Zero tokens, recomputed nightly |
| `inbox_items` (`0067`) | Eingang items: rule kind, customer id, title, reason, evidence (ids and numbers, never an email), AI suggestion, decision, 14-day outcome | Operator work queue |
| `shopify_webhook_events`, `shopify_sync_runs`, `shopify_outbox` (`0065`) | webhook dedupe (id, topic, outcome — no payload), import / reconcile runs, Mo's pending writes to Shopify (a customer create carries the email until it is done or dead; a `writeback` row carries only `mo-` tag names) | Operational bookkeeping |
| `erasure_tombstones` (`0065`) | the Shopify id of every person erased in Mo, when, when Shopify confirmed | Keeps an erased person from being re-created by an import or webhook |

**Mo's insights in Shopify (plan D-11, `SHOPIFY_WRITEBACK_ENABLED`, default
off).** When switched on, the nightly `/api/cron/shopify-reconcile` queues
derived figures for the Shopify customer as tags — `mo-segment-<segment>`,
`mo-wert-<value tier>`, `mo-kontakt` (talked to Mo), `mo-abwanderung-hoch` —
as `writeback` outbox rows, which `/api/cron/shopify-sync` sends (only `mo-`
tags are added or removed, the shop's own tags are never touched) and mirrors
into `customers.shopify_tags`. From then on these tags are also Shopify
data: they follow the Shopify customer record, so Shopify's own deletion (or the
erasure request Mo sends with `SHOPIFY_ERASURE_SYNC`) removes them; a Mo-side
erasure deletes the person's open outbox rows. The tags are computed for every
mirrored customer with figures — the marketing consent is not a condition. An
**Art. 21 objection to profiling** removes them: recording it
(`POST /api/admin/customers/objection`, `kind: profile`) drops the person's
pending / failed tag write-backs and queues one `writeback` that removes every
`mo-` tag the mirror holds (`removeInsightTags`; queued even while the switch
is off — it waits until it is on), and the nightly run adds none while the
objection stands. Lifting the objection lets the next nightly run add them
again. The basis and privacy-policy wording are an open legal item
([`CONSENT_FLOW.md`](./CONSENT_FLOW.md) „Customer platform (2026-10)“).

### Retention windows (Kundenstamm)

| Data | Default window | Env var | Action on expiry / erasure |
| --- | --- | --- | --- |
| `customers` with a Shopify id | lifetime of the Shopify record | — | **Exempt** from the customer purges of steps 5 (opted out) and 5e (dormant): the mirror follows Shopify. Removed by the complete erasure — from Mo, or from Shopify's `customers/redact` / `customers/delete` webhooks. The AI profile on the row has no window of its own; an Art. 21 objection clears it. |
| `customer_orders`, `customer_facts`, `consent_events` | follow the customer | — | Cascade-deleted with the customer row; the erasure also deletes ledger rows not (yet) linked to the row, by Shopify id. Shopify keeps its own orders for as long as the law requires; Mo keeps no copy. |
| `inbox_items` (decided: `erledigt` / `verworfen`) | **180 days** by `COALESCE(decided_at, updated_at)`, marker **2 years** | `INBOX_RETENTION_DAYS` | Content cleared, a marker (kind, customer, decision, dedupe key) stays until 2 years (step 8). Open items stay; items about a person cascade with the customer. |
| `shopify_webhook_events` | **90 days** by `received_at` | `SHOPIFY_SYNC_LOG_RETENTION_DAYS` | Hard delete (step 7) |
| `shopify_sync_runs` (done / failed / cancelled) | **90 days** by `started_at` | `SHOPIFY_SYNC_LOG_RETENTION_DAYS` | Hard delete (step 7); the newest `done` run per kind always stays (import marker, reconcile floor, the one-off `refund_backfill` marker). Running runs stay. |
| `shopify_outbox` (done / dead) | **90 days** by `created_at` | `SHOPIFY_SYNC_LOG_RETENTION_DAYS` | Hard delete (step 7); pending / failed rows are never purged. `customer_id` is `SET NULL` when the customer goes; the erasure deletes the person's open rows. |
| `erasure_tombstones` | **30 days** after Shopify confirmed the redaction (`shopify_confirmed_at`) | `ERASURE_TOMBSTONE_RETENTION_DAYS` | Hard delete (step 9). An unconfirmed tombstone always stays, so no import re-creates a person Shopify still holds. |

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
| Offer **availability**        | **7 days**     | `BUNDLE_OFFER_EXPIRY_DAYS` | `/api/cron/expire-bundles` (every 15 min) deletes the Shopify product + flips the row to `expired` (kept for audit/KPIs) |
| Offer **record → customer link** | follows the customer | `SUPPRESSED_CAPTURE_PURGE_DAYS` | erasing the customer **SET NULL**s `customer_id`; the de-identified offer row (Shopify ids + prices, no PII) is retained for order-history/KPI integrity |

**Why the record is kept after the customer is erased.** Like `marketing_sends`,
a bundle offer can correspond to a **real Shopify order**; deleting it would
orphan order history. The `ON DELETE SET NULL` link means a GDPR erasure removes
the *person* (the email + cached summaries on `customers`) while the offer row —
which carries no directly-identifying field — stays for accounting/KPIs. The
**archived-offer window** is therefore "kept de-identified"; the *active* window
is the 7-day availability above, enforced by the expiry cron, which deletes the
set's Shopify product (orders keep their own line items).

---

## Cluster B (cont.) — Korrespondenz (E-Mail)

**Lawful basis: performance of a contract / legitimate interest (Art. 6(1)(b) /
6(1)(f)) — NOT marketing consent.** `email_messages` (migration `0021`, see
[`archive/EMAIL_SUBSYSTEM_SPIKE.md`](./archive/EMAIL_SUBSYSTEM_SPIKE.md)) is the **unified mail
log**: every email we send (a mirror-write at each send site) and every reply we
receive (the Resend Inbound webhook `/api/inbound/resend`). Answering a customer
who wrote to us rests on contract / legitimate interest, **independent** of
`marketing_doi_status`. It is therefore its **own data category** and is **never
fused** into the consent gates (`canSendMarketing` / `loadEligibleCapture`).

Its only personal link is the nullable `customer_id` (`ON DELETE SET NULL`); a
reply from an **unknown** address is stored with `customer_id = NULL` (the
"unmatched inbound" triage queue). Attachments are stored as **metadata only**
(filename / type / size / provider ref) — never the blob.

**Since 2026-10-02 the shop's contact form is stored here too.** `/api/contact`
writes the request as a received message (`provider = 'kontaktformular'`; subject
„Kontaktanfrage: <Anliegen>“, body = the message plus organisation, phone and
products) and finds or creates the sender as a `customers` row — an
*Interessent* without any consent and without a Shopify id. The Eingang's „Als
Interessent anlegen“ does the same for an unmatched sender. Such a row follows
the dormant-customer purge (step 5e) like every customer without a Shopify id;
the mail follows `CORRESPONDENCE_RETENTION_DAYS`. Every incoming mail of a known
customer also opens an Eingang item „E-Mail beantworten“ (`inbox_items`, step 8);
its AI reply draft is stored in the item's `suggestion` and is cleared with it.

| Table | What's stored | Lawful basis |
| --- | --- | --- |
| `email_messages` | direction (sent/received), RFC-5322 identity + threading (message_id, in_reply_to, references, derived thread_id), from/to/subject/body, snippet, attachment **metadata**, provider refetch handle, nullable `customer_id` + `marketing_send_id` | Contract / legitimate interest |

### Retention windows (Korrespondenz)

| Data | Default window | Env var | Action on expiry / erasure |
| --- | --- | --- | --- |
| `email_messages` | **365 days** (by `occurred_at`) | `CORRESPONDENCE_RETENTION_DAYS` | Hard delete on its **own** schedule. |
| `email_messages` → customer link | follows the customer | — | Erasing the customer **SET NULL**s `customer_id`; the row itself is retained until its own window above. |

**Why it purges on its own schedule (not with the customer).** The `customer_id`
FK is `ON DELETE SET NULL`, so a GDPR erasure / customer purge **detaches** the
correspondence (removing the person link) but does **not** cascade-delete the
audit row — that would let a customer deletion silently drop correspondence
mid-window. Correspondence instead leaves on the `CORRESPONDENCE_RETENTION_DAYS`
window, longer than the 180-day analytics window because a reply thread stays
useful well beyond a single chat session. *(Window + the lawfulness of feeding
correspondence body into the KB passes are pending Legal/DPO sign-off — see the
spike §3.)*

---

## Cluster B (cont.) — Signed-in customers (tier 3)

**Lawful basis: performance of a contract / legitimate interest (Art. 6(1)(b) /
6(1)(f)).** When a visitor signs in with their Shopify account (the Customer
Account API flow, see [`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md)), we hold the
**OAuth tokens** needed to read *their own* Shopify data on their behalf, plus the
identity linkage on the `customers` row. **Shopify stays authoritative** for the
account data; the sign-in only caches a data-minimised account summary (name,
address context — `shopify_account_summary`, migration `0015`) and the order
history (`purchase_summary`) on the customer row, refreshed from Shopify, never
edited in Mo. Independently of any sign-in, the Kundenstamm mirror (above)
stores the minimised customer record and the order ledger. Signing
in establishes **identity, not marketing consent** — the consent is the one
consent on `customers.email_consent_*`, which Shopify's own marketing state feeds
through the mirror's webhooks and reconcile, never the sign-in itself.

| Table | What's stored | Notes |
| --- | --- | --- |
| `customers` (tier-3 columns) | `shopify_customer_id`, `shopify_customer_gid`, `shopify_linked_at`, `identity_tier` | identity linkage; the email column stays the single email home |
| `customer_oauth_tokens` | **encrypted** access + refresh tokens (AES-256-GCM, `TOKEN_ENC_KEY`), `id_token_sub`, scope, expiries | server-side only; **never** sent to the browser |
| `customer_auth_pending` | short-lived CSRF `state` + PKCE `code_verifier` + `nonce` + `return_url` | transient; ~10-min TTL |
| `customer_link_grants` | one-time sign-in link codes (0073): SHA-256 of the code, `session_id`, `customer_id`, kind, expiry, consumed time | transient; 10-min TTL, single use |
| `customer_merge_conflicts` | sign-in merge conflicts for admin review (no tokens) | consent-provenance audit trail |

### Retention windows (tier 3)

| Data | Default window | Env var | Action on expiry / erasure |
| --- | --- | --- | --- |
| `customer_oauth_tokens` | follows the customer | — | **Cascade-deleted** with the customer (`ON DELETE CASCADE`). A GDPR erasure / customer purge removes the tokens in the same step. Access tokens also rotate/expire continuously (refresh-token rotation). |
| `customer_auth_pending` | **~10 min** | `CUSTOMER_AUTH_PENDING_TTL_MINUTES` | Hard delete by the retention cron once past `expires_at`. |
| `customer_link_grants` | **10 min** (+1 day) | — | Hard delete by the retention cron one day past `expires_at` (counted with the pending-auth rows); cascade-deleted with the customer. |
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

### Complete erasure — one path for every way to delete

Every "delete everything about this person" runs through **one function**,
`erasePerson()` in [`lib/customer-erasure.ts`](../src/lib/customer-erasure.ts):

| Entry point | Who | Route |
| --- | --- | --- |
| Widget button "Meine Daten löschen" | signed-in customer (tier 3) | `POST /api/account/erase` (`eraseSignedInCustomer` delegates) |
| Mail footer "Daten löschen" | any recipient of a marketing or Kampagne mail | `GET /api/erase-data?token=…` shows a confirmation page, `POST` erases (link scanners never delete; the signed token is purpose-bound and differs from the unsubscribe token) |
| Admin "Löschen" | operator, Kunden detail or Kampagne card | `POST /api/admin/customers/erase` (confirmed, audit-logged with the numeric id only) |
| Shopify compliance webhooks `customers/redact`, `customers/delete` | Shopify (the customer deleted their shop account or asked the shop) | `POST /api/webhooks/shopify` (HMAC-verified) → the same erasure with trigger `shopify`; more than `SHOPIFY_ERASURE_ALERT_PER_HOUR` (default 20) per hour raises an alert and an Eingang item |

In **one transaction** it removes the customer row (profile, cached purchases,
address, drafts; OAuth tokens, session links, the order ledger
`customer_orders`, `customer_facts`, the consent history `consent_events` and
the person's Eingang items cascade), **every** conversation of the person on any
device (messages cascade), consent records, marketing drafts and sends, every
Kampagne recipient row of the person in every campaign (drafts cascade) and its
sends, correspondence, physical letters, feedback, KPI events and attribution
tokens of the person's sessions, pending sign-in and merge-conflict rows, usage
rows, the person's open Shopify outbox rows, ledger rows not yet linked to the
row (by Shopify id), and the person's section in stored Analyse reports.
**Kept de-identified:** `mo_orders` (session id + token removed, for revenue
KPIs), `bundle_offers` (person link removed), `qa_entries` (chat link removed),
completed `shopify_outbox` rows (Shopify id only). **Retained on purpose:**
`suppression_list` (reason `erasure` — the address is never mailed again and no
audience matches it), `erasure_tombstones` (the Shopify id, so no import,
reconcile or webhook re-creates the person; removed 30 days (default) after
Shopify confirmed the redaction — see Kundenstamm above) and
`admin_access_log` (numeric id only, own window). Hero images in Blob storage are
deleted after the commit.

**Orders.** Mo's copy of the person's orders (`customer_orders`) is deleted with
them — cascade with the customer row, plus an explicit delete by Shopify id.
Shopify keeps its own orders for as long as the law requires; nothing in Mo
holds them in its place.

**The Shopify side** (only when the erasure started in Mo, trigger `mo`, and the
person has a Shopify id): the outbox (`lib/shopify-outbox.ts`) gets a consent
write (`unsubscribed`, sent while `SHOPIFY_CONSENT_WRITEBACK` is on) and a
`data_erasure` row (sent while `SHOPIFY_ERASURE_SYNC` is on: consent off again,
then Shopify's `customerRequestDataErasure`). An erasure Shopify started
(`customers/redact`, `customers/delete`) runs here without asking Shopify again
and stamps the tombstone as confirmed. Shopify's `customers/data_request` creates
an Eingang item `datenauskunft` with a 30-day deadline; `shop/redact` only raises
an alert and an Eingang item — Mo never mass-deletes on it.

The per-table decisions are `ERASURE_PLAN` in
`lib/customer-erasure-core.mjs`; its test parses all migrations and **fails
when a table with personal data has no decision**, so a new table cannot
silently escape erasure.

This is the stronger sibling of the retention cron's steps 5 and 5e: the cron
removes *opted-out* or *dormant* customers without a Shopify id and uses
`ON DELETE SET NULL` to return their conversations to pseudonymous rows (it
never touches a Shopify customer, and step 5e keeps anyone whose one consent is
`subscribed` or `pending`); `erasePerson` **purges** everything.

---

## How retention is enforced

> **One rule for every window:** a value of `0` **disables** that step (nothing
> is deleted); an invalid or negative value falls back to the default. No
> window deletes everything — `RETENTION_DAYS=0` keeps every conversation
> (parsing: `src/lib/retention-options.mjs`, tested).

A daily cron — `GET /api/cron/retention`, scheduled in `vercel.json` (03:30 UTC),
protected by `CRON_SECRET` — calls `runRetention()` (`src/lib/retention.ts`). The
step numbers below are the ones in the code. Each run:

1. Marks stale `active` conversations `abandoned`.
2. Deletes conversations past `RETENTION_DAYS` (messages + chat `ai_usage` cascade).
3. Deletes `kpi_events` past `KPI_RETENTION_DAYS`, and (3b) the dashboard/admin
   `ai_usage` rows (those with no `conversation_id`) on the same window.
4. Purges PII for unsubscribed / suppressed `email_captures` past the grace
   window, keeping the `suppression_list` entry.
5. Purges the matching `customers` rows (email + cached profile / purchase
   summaries — all PII under the same consent) for the same opted-out
   addresses, after the capture purge; their `ON DELETE SET NULL` FKs return
   the linked conversations to plain pseudonymous rows (see
   [`CUSTOMERS.md`](./CUSTOMERS.md)), and their `customer_oauth_tokens` cascade
   away. **Shopify customers are exempt** (only rows without a
   `shopify_customer_id` are purged): opting out of advertising ends the
   advertising, not the customer relationship — only the complete erasure
   removes them.
5b. Deletes `email_messages` (Korrespondenz) past `CORRESPONDENCE_RETENTION_DAYS`
   (by `occurred_at`) — their **own** schedule, decoupled from the
   consent-capture grace; the `ON DELETE SET NULL` customer link means a
   customer erasure detaches (never cascade-deletes) these rows.
5c. Deletes `physical_letters` (Briefe) past `PHYSICAL_LETTER_RETENTION_DAYS`
   (default **365 days**, by `created_at`) — likewise their own schedule.
5d. Deletes `feedback` past `FEEDBACK_RETENTION_DAYS` (default **365 days**, by
   `created_at`) — free-text comments can carry user-supplied PII, so they
   don't live forever.
5e. **Storage limitation (Art. 5(1)(e)):** purges IDENTIFIED but **dormant**
   `customers` whose `last_seen_at` is older than
   `CUSTOMER_INACTIVITY_RETENTION_DAYS` (default **1095 days / 3 years**),
   **excluding** anyone whose one consent `email_consent_state` is `subscribed`
   or `pending` (a live basis to retain; an unconfirmed DOI falls back to
   `not_subscribed` one day after its link expired — `expirePendingConsents`,
   nightly in `/api/cron/refresh-customers`) and **every Shopify customer** (the
   mirror follows Shopify; Shopify's own deletion arrives as
   `customers/redact` / `customers/delete` and runs the complete erasure).
   Their `ON DELETE SET NULL` FKs return conversations/correspondence to
   pseudonymous rows and their OAuth tokens cascade away; the
   `suppression_list` (keyed by email) is untouched, so opt-outs are still
   honoured. *(The exact window is a policy choice — confirm with Legal.)*
5f. Deletes `admin_access_log` past `ADMIN_ACCESS_LOG_RETENTION_DAYS` (default
   **730 days**, by `occurred_at`) — the admin PII-access security record
   (migration `0028`).
5g. Deletes campaign data past `CAMPAIGN_CONTACT_RETENTION_DAYS` (default
   **365 days**): `campaign_sends` by `sent_at`, then `campaign_contacts` by
   `COALESCE(last_synced_at, created_at)` (drafts cascade with their recipient;
   Testkontakte are skipped). The `suppression_list` is untouched — see
   [`CAMPAIGNS.md`](./CAMPAIGNS.md).
5h. Deletes `analytics_reports` past `ANALYTICS_REPORT_RETENTION_DAYS`, and
   `conversation_insights` + `kpi_persona_question_summaries` on the
   `KPI_RETENTION_DAYS` window.
5i. Deletes `mo_orders` on the `KPI_RETENTION_DAYS` window (by
   `COALESCE(processed_at, created_at)`) and `mo_attribution_tokens` older than
   the attribution window + 7 days.
6. Purges expired `customer_auth_pending` rows (the short-lived sign-in
   CSRF/PKCE state) and, a day past expiry, the one-time sign-in link codes
   (`customer_link_grants`, 0073).
7. Deletes Shopify sync bookkeeping past `SHOPIFY_SYNC_LOG_RETENTION_DAYS`
   (default **90 days**): `shopify_webhook_events` by `received_at`, finished
   `shopify_sync_runs` (done / failed / cancelled) by `started_at` — the newest
   `done` run per kind always stays (it is the import marker and the reconcile
   floor) — and `done` / `dead` `shopify_outbox` rows by `created_at`. Pending
   and failed outbox rows are never purged.
8. Reduces decided Eingang items (`inbox_items` with status `erledigt` /
   `verworfen`) past `INBOX_RETENTION_DAYS` (default **180 days**, by
   `COALESCE(decided_at, updated_at)`) to a marker — reason, evidence, AI
   suggestion and note are cleared; kind, customer, decision and the dedupe key
   stay, so a rule cannot re-create an item the operator already decided while
   its episode lasts. Markers are deleted after two years (the longest rule
   episode) or with the customer. Open and snoozed items stay.
   `deletedInboxItems` in the summary counts both — items reduced to a marker
   and markers removed.
9. Deletes `erasure_tombstones` whose Shopify confirmation
   (`shopify_confirmed_at`) is older than `ERASURE_TOMBSTONE_RETENTION_DAYS`
   (default **30 days**); unconfirmed tombstones stay.

The same run also executes the conversion sweep (status maintenance, see
Cluster A). Every window is parsed by `src/lib/retention-options.mjs`; `0`
skips the step.

### Running it manually

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://mo.motionsports.de/api/cron/retention
```

The endpoint returns a JSON summary with the counts affected, e.g. (abridged —
every step reports its count, `options` echoes every window):

```json
{
  "ok": true,
  "options": { "retentionDays": 180, "kpiRetentionDays": 180, "abandonAfterMinutes": 30, "suppressedPurgeDays": 30, "correspondenceRetentionDays": 365, "shopifySyncLogRetentionDays": 90, "inboxRetentionDays": 180, "erasureTombstoneRetentionDays": 30 },
  "abandonedConversations": 4,
  "deletedConversations": 12,
  "deletedKpiEvents": 833,
  "deletedAiUsage": 27,
  "purgedSuppressedCaptures": 1,
  "purgedSuppressedCustomers": 1,
  "deletedEmailMessages": 5,
  "deletedPhysicalLetters": 2,
  "deletedInactiveCustomers": 0,
  "deletedCampaignContacts": 3,
  "deletedCampaignSends": 3,
  "purgedAuthPending": 3,
  "deletedShopifySyncLog": 41,
  "deletedInboxItems": 9,
  "deletedErasureTombstones": 0,
  "ranAt": "2026-06-03T03:30:00.000Z"
}
```

---

## Data-subject requests (forward note)

The consent flow has shipped (see [`CONSENT_FLOW.md`](./CONSENT_FLOW.md)).

**Self-service erasure exists for everyone we can reach by mail or sign-in**
(section above): the widget button (signed in), the "Daten löschen" link in
every marketing and Kampagne mail, and — for requests by phone or letter —
the operator's "Löschen" button in Kunden or Kampagne. A deletion the person
requests at the shop reaches Mo as Shopify's `customers/redact` /
`customers/delete` webhook. All of them run the same complete erasure.
`DELETE /api/account/conversations/{id}` still erases a single transcript for a
signed-in customer.

**Access requests** forwarded by Shopify (`customers/data_request`) become an
Eingang item `datenauskunft` with a 30-day deadline for the operator to answer.

The only manual case left:

- **Erasure of a conversation:** delete the `conversations` row by `session_id`
  (messages cascade). This is only possible if the user can supply their
  `session_id`, since Cluster A holds no identifier that maps to a person —
  unless they are a signed-in customer, who can delete it themselves by id.
