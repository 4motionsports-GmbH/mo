# Consent flow — email capture, double opt-in, suppression

This document describes how the backend captures an email address, the two
**separate** consents it collects, the double-opt-in (DOI) flow for marketing,
the suppression logic, and the audit trail. It also lists exactly which copy a
lawyer must approve before launch.

> ⚠️ **All German-facing copy is PLACEHOLDER and requires lawyer sign-off.**
> It lives in [`src/lib/consent-copy.ts`](../src/lib/consent-copy.ts), marked
> with `CONSENT_COPY_LAWYER_APPROVED = false`. See the TODO list at the end.

## Legal background (why it's built this way)

Germany (UWG + GDPR) requires a **double opt-in** for marketing email to people
who are not existing customers. Two consents are collected, and they are **never
bundled**:

| | Consent | Lawful basis | Needs DOI? | When sent |
| --- | --- | --- | --- | --- |
| **(A) Transactional** | "Send me a copy of this conversation + my cart." | Art. 6(1)(b) — a service the user requests | No | Immediately on request |
| **(B) Marketing** | "You may contact me later with personalised offers based on this chat." | Art. 6(1)(a) — explicit consent | **Yes** | Only after the user clicks the confirmation link |

Rules baked into the code:

- The marketing checkbox is a **separate**, **unchecked-by-default** box with
  its own explicit text. Pre-ticked boxes are invalid, so the frontend MUST
  render it unchecked.
- **No marketing** is permitted to an address whose `marketing_doi_status` is
  not `'confirmed'`, or that is on the suppression list / unsubscribed.
- Every marketing email MUST contain a working unsubscribe link.
- The exact consent text shown to the user is stored verbatim
  (`consent_text_shown`) as **Art. 7 proof of consent**.

## The data (Cluster B — explicit consent)

Email lives **only** in the consent/marketing cluster (see
[`DATABASE.md`](./DATABASE.md)). Relevant columns of `email_captures`:

| Column | Meaning |
| --- | --- |
| `email` | Normalised (trimmed + lower-cased). Unique — one consent record per address. |
| `session_id` | Pseudonymous bridge to the conversation (Cluster A). Severable by the user. |
| `transactional_consent` | The user asked us to email the summary. |
| `marketing_consent` | The user ticked the marketing box (or has a prior confirmed consent). |
| `marketing_doi_status` | `none` → `pending` → `confirmed`. |
| `doi_token` | Random 256-bit token in the confirmation link. |
| `doi_sent_at` | When the token was issued; drives expiry. |
| `doi_confirmed_at` | When the user clicked confirm. |
| `consent_text_shown` | Verbatim copy the user saw (audit trail). |
| `unsubscribed_at` | Set on unsubscribe; the address also goes to `suppression_list`. |

`suppression_list (email, added_at, reason)` is the hard block-list checked
before any marketing send.

## End-to-end flow

```
Chat → assistant calls offer_email_summary (once, at a natural point)
     → widget renders the capture form (email + two separate checkboxes)
     → POST /api/capture-email { sessionId, email, transactionalConsent,
                                 marketingConsent, consentTextShown }
        ├─ validate email + transactionalConsent (required)
        ├─ upsert email_captures (store consent_text_shown)
        ├─ (A) transactional: send summary email NOW  ──────────────► user inbox
        │      • German summary of the conversation
        │      • prefilled-cart permalink (NO discount)
        └─ (B) marketing: if newly granted & not suppressed
               • marketing_doi_status = 'pending', issue doi_token
               • send DOI confirmation email ─────────────────────► user inbox
                                                                       │
   user clicks confirm link ───────────────────────────────────────────┘
     → GET /api/confirm-marketing?token=...
        ├─ token valid & not expired (MARKETING_DOI_EXPIRY_DAYS, default 7)
        ├─ marketing_doi_status = 'confirmed', set doi_confirmed_at
        └─ render "Danke, deine Anmeldung ist bestätigt."

Later, every marketing email carries:
     → GET /api/unsubscribe?token=<signed email>
        ├─ verify HMAC signature (email-keyed; no DB lookup needed)
        ├─ set unsubscribed_at, add to suppression_list, revoke DOI
        └─ render "Du wurdest abgemeldet."
```

## Suppression & "can I send?" logic

Two gates, both in [`email-capture-store.ts`](../src/lib/email-capture-store.ts):

- **`isSuppressed(email)`** — true if the address is on `suppression_list` OR
  has `unsubscribed_at` set. **Fail-closed**: if the database is unreachable it
  returns `true`, so a transient error can never let a send slip past an opt-out.
- **`canSendMarketing(email)`** — true only when DOI is `confirmed` AND the
  address is not suppressed/unsubscribed. The marketing dashboard MUST gate
  every send on this.

A suppressed/unsubscribed address is **never re-pended** for DOI by
`/api/capture-email`. A previously *confirmed* consent is preserved if the user
later submits the form without re-ticking marketing (only an explicit
unsubscribe revokes it).

## Audit trail (Art. 7)

For each capture we can show, on demand:

- the **exact text** the user saw (`consent_text_shown`),
- **what** they consented to (`transactional_consent`, `marketing_consent`),
- **when** marketing consent was confirmed (`doi_confirmed_at`) and that it went
  through a real double opt-in (`doi_sent_at` → click → `doi_confirmed_at`),
- **when/whether** they opted out (`unsubscribed_at` + `suppression_list`).

Retention purges PII for opted-out/suppressed captures after a grace period
while keeping the `suppression_list` row, so we keep honouring the opt-out (see
[`DATA_RETENTION.md`](./DATA_RETENTION.md)).

## Defensive email handling

All sends go through [`lib/email.ts`](../src/lib/email.ts), which **logs every
failure** (`reportError`) and returns a discriminated result — failures are
never silently lost. A summary-send failure surfaces as `502` to the widget; a
DOI-send failure is logged without dropping the (already stored) consent so the
user can re-request. When Resend isn't configured the helper returns a `skipped`
result and logs to stdout (local-dev), rather than faking success.

---

## ✅ TODO — copy the lawyer must approve before launch

All strings below are in [`src/lib/consent-copy.ts`](../src/lib/consent-copy.ts).
Flip `CONSENT_COPY_LAWYER_APPROVED` to `true` only once every item is signed off.

- [ ] **Transactional checkbox label** (`TRANSACTIONAL_CHECKBOX_LABEL`).
- [ ] **Marketing checkbox label** (`MARKETING_CHECKBOX_LABEL`) — confirm it is
      specific enough about purpose (personalised offers based on the chat) and
      mentions the free, anytime right to withdraw + unsubscribe link.
- [ ] **DOI confirmation email** subject + body (`DOI_EMAIL_SUBJECT`,
      `doiEmailBody`) — purpose statement + the confirm CTA.
- [ ] **DOI confirmation page** copy (`DOI_CONFIRMED_*`, `DOI_INVALID_*`).
- [ ] **Unsubscribe footer** (`unsubscribeFooter`) present in every marketing
      email, with the legal basis line.
- [ ] **Unsubscribe confirmation page** copy (`UNSUBSCRIBE_*`).
- [ ] **Summary email** subject + framing (`SUMMARY_EMAIL_SUBJECT`,
      `summary-email.ts`) — confirm it reads as a requested service, not
      marketing (no offers/discounts).
- [ ] Confirm the **frontend renders the marketing checkbox unchecked** and the
      two consents as visually separate, independently-tickable boxes.
- [ ] Confirm an **Imprint/Privacy link** is shown next to the capture form
      (frontend), as the consent text references data use for personalisation.
- [ ] **Profile building from past interactions and purchases** (the customer
      entity, see [`CUSTOMERS.md`](./CUSTOMERS.md)): confirm the privacy policy
      and the marketing consent text cover building a durable customer profile
      from **past chat sessions and Shopify purchase history** — the current
      copy may only cover the present conversation. Details and sub-items in
      `CUSTOMERS.md` → "TODO — GDPR".
- [ ] **Customer memory in the live chat** (`CUSTOMERS.md` → "Customer memory
      in the live chat"): once a returning customer re-identifies by email in
      the current session, prior interactions + purchase history shape the
      **live consultation**. Confirm this personalisation purpose is within
      the approved consent scope / privacy policy before enabling for real
      users — same launch gate as the rest of this checklist.
