# Customers — the email-keyed entity above sessions

Since migration `0008_customers.sql` the backend has a **customer** entity so
returning users are recognised and their history consolidated. This documents
the identity model, the linking rule, the cached summaries, and the open GDPR
question.

## Identity model

- The **only reliable cross-session identifier is the email address**, given
  actively and with consent via `/api/capture-email`.
- The localStorage session id is a **per-browser thread id, not a person**. It
  is never used to link anonymous sessions across visits, never fingerprinted,
  never enriched.
- A `customers` row exists **only because an email was captured**. Sessions
  without an email capture stay anonymous and unlinked — exactly as before.

## Linking rule

On every email capture (`/api/capture-email` →
`linkCustomerOnEmailCapture()` in [`src/lib/customer-store.ts`](../src/lib/customer-store.ts)):

1. **Find-or-create** the customer for the normalised email. An existing
   customer means a returning visit — `last_seen_at` is bumped,
   `first_seen_at` stays.
2. **Attach the current conversation** (`conversations.customer_id`). Multiple
   sessions under one email = the returning-customer case.
3. **Mirror the aggregated consent state** from `email_captures` (which stays
   the audit-grade source of truth — `consent_text_shown`, DOI lifecycle).
   DOI confirmation and unsubscribe re-sync the mirror.

Linking is best-effort: a failure never blocks the capture/summary/DOI flow.

## Cached summaries (on demand, from the admin dashboard)

| Field | Source | Refresh |
| --- | --- | --- |
| `purchase_summary` (+`_updated_at`) | Shopify order history by email (`fetchOrderHistoryByEmail`, read_orders; full history beyond 60 days needs `read_all_orders`) | "Käufe aktualisieren" button → `POST /api/admin/customers/purchases` |
| `profile_summary` (+`_updated_at`) | One Anthropic pass over all linked transcripts + purchase history (`generateCustomerProfile`) | "Kundenverständnis generieren" button → `POST /api/admin/customers/profile` |

The profile is **regenerated fresh each time**, never mechanically merged from
per-session profiles — contradictions between sessions resolve toward the
newer statement. Each run costs tokens; the dashboard shows the usage and an
approximate USD cost after every run.

## Retention / erasure

- `conversations.customer_id` and `email_captures.customer_id` are
  `ON DELETE SET NULL`: deleting a customer returns their conversations to
  plain pseudonymous rows.
- The retention job ([`src/lib/retention.ts`](../src/lib/retention.ts)) purges
  the customer row (email + cached profile/purchase summaries — all PII) with
  the same opted-out criteria and grace period as the capture purge.

## ⚠️ TODO — GDPR: profile building must be covered by the consent copy

> **For the lawyer to confirm before this feature is used in production.**
>
> Building a **durable customer profile from past chat interactions and
> Shopify purchase history** may extend beyond the purpose the user originally
> consented to (transactional summary / marketing email about the discussed
> products). To be confirmed:
>
> - [ ] The **privacy policy** explicitly covers "profile building from past
>       interactions and purchases" (purpose, lawful basis, storage duration,
>       right to object/erasure).
> - [ ] The **marketing consent checkbox text**
>       (`MARKETING_CHECKBOX_LABEL` in `src/lib/consent-copy.ts`) covers — or
>       is extended to cover — personalisation based on **past** conversations
>       and **purchase history**, not only the current chat.
> - [ ] Whether linking the Shopify **order history** (a separate data source)
>       into the chat-derived profile needs its own disclosure.
> - [ ] Whether the regenerated profile constitutes **profiling** under
>       Art. 22 / requires a DPIA entry.
>
> Until that sign-off, treat the Kunden tab's profile generation as an
> internal pilot. This item is also listed in the lawyer checklist in
> [`CONSENT_FLOW.md`](./CONSENT_FLOW.md).

## What deliberately did NOT change

- The live chat behaviour is untouched — the model does not (yet) see customer
  memory; that is a later session.
- `email_captures` remains the only consent record; `customers` mirrors state
  but never replaces the audit trail.
- Anonymous (no-email) sessions remain exactly as pseudonymous and unlinked as
  before.
