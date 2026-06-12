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

## Welcome discount (once-ever, recorded here) — ⚠️ disabled by default

The customer row is the **source of truth for the one-time welcome code**
(migration `0009_welcome_discount.sql`: `welcome_code`, `welcome_code_gid`,
`welcome_code_expires_at`, `welcome_issued_at`). The automatic issuance is
**feature-flagged off by default** (`WELCOME_DISCOUNT_ENABLED=false`; codes
are issued manually via the dashboard instead — see
[`WELCOME_DISCOUNT.md`](./WELCOME_DISCOUNT.md)). When enabled it is issued
automatically on the customer's **first DOI confirmation** — never twice for
the same email, across all future sessions and signups; the atomic
`welcome_issued_at` claim guarantees it. Details, legal framing
(lawyer-confirm) and dashboard tracking in
[`WELCOME_DISCOUNT.md`](./WELCOME_DISCOUNT.md). GDPR erasure of the
customer row removes the welcome record with it (the suppression list keeps
honouring opt-outs as before).

## Customer memory in the live chat (in-session re-identification ONLY)

Since the customer-memory feature, Mo can use a returning customer's history
to tailor the **live consultation** — under a strict privacy gate
([`src/lib/customer-memory.ts`](../src/lib/customer-memory.ts)):

> **A returning customer opens a new chat as ANONYMOUS.** The localStorage
> session id is a browser thread id, not a person — on a shared/family/public
> device it can carry someone else's past capture. So no past history is ever
> surfaced at chat start, and the session id alone never unlocks memory.

Memory is injected into the system prompt only when **both** hold:

1. **In-session claim** — the widget attaches `customer.email` to `/api/chat`
   only after a successful `/api/capture-email` **in the current chat
   session**, keeping that state in memory only (`API_CONTRACT.md` §2).
2. **Server-side verification** — `resolveCustomerMemory()` checks the email's
   consent record was captured **from this very session id**
   (`wasEmailCapturedFromSession`, fail-closed). A forged request body naming
   someone else's address resolves nothing.

What gets injected (compact, never raw transcripts): the cached
`profile_summary` ("current understanding"), owned items + quantities from the
cached `purchase_summary`, the prior-consultation count, and first-seen date.
The prompt block instructs Mo to acknowledge the return lightly (once, warm,
never exhaustive), not to re-recommend owned products (suggest complements
instead), to let today's statements override the memory, and that **no
existing rule is weakened** — sold-out, checkout, B2B, and tool behaviour all
apply unchanged.

A **new email** (customer just created, no prior conversations, no cached
summaries) resolves to no memory — the chat behaves exactly as before. Another
customer's data is unreachable by construction: the lookup is keyed strictly
by the email the user just provided in this session.

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
> - [ ] **Customer memory in the live chat** (section above): prior chat
>       interactions + purchase history now shape the **live consultation**
>       for a re-identified returning customer. Confirm this personalisation
>       purpose is within the (lawyer-approved) consent scope / privacy policy
>       — it goes beyond the one-off transactional summary the user originally
>       requested. Until that sign-off, do NOT enable this for real users.
>
> Until that sign-off, treat the Kunden tab's profile generation AND the
> in-chat customer memory as an internal pilot — the same launch + legal
> constraints as the rest of the consent copy
> (`CONSENT_COPY_LAWYER_APPROVED` in `src/lib/consent-copy.ts` is still
> `false`). This item is also listed in the lawyer checklist in
> [`CONSENT_FLOW.md`](./CONSENT_FLOW.md).

## What deliberately did NOT change

- `email_captures` remains the only consent record; `customers` mirrors state
  but never replaces the audit trail.
- Anonymous (no-email) sessions remain exactly as pseudonymous and unlinked as
  before.
