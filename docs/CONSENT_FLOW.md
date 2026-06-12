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

- **BOTH checkboxes start UNCHECKED** — consent copy **v2** (client-approved
  product decision, June 2026). The transactional box was allowed to render
  pre-checked under v1; that is **no longer permitted**: the user must
  actively tick it to get the summary, and the backend **rejects** a capture
  without transactional consent with `400` and the documented error code
  **`transactional_consent_required`** (the form's only purpose is the
  summary, so a no-transactional submit is invalid — see
  `src/lib/capture-validation.mjs` and [`API_CONTRACT.md`](./API_CONTRACT.md)
  §7.1).
- The marketing checkbox is a **separate**, **unchecked-by-default** box with
  its own explicit text. **Documented decision** (`src/lib/consent-copy.ts`):
  pre-ticked marketing consent is invalid under the GDPR's
  clear-affirmative-act requirement (CJEU C-673/17 *Planet49*) and a common
  Abmahnung trigger under the German UWG — we deliberately reject pre-checking
  it, regardless of what other platforms do. The box may be **prominent**;
  the opt-in is won through copy, never a pre-tick. **Copy ceiling (UWG /
  dark-pattern exposure, agreed with the client):** the v2 label promises
  "exklusive Angebote …, nur für Abonnenten" and nothing more — accurate
  scarcity only; no countdowns, no invented urgency, no concrete discount
  promise.
- A **shared one-line footer** (`CONSENT_SHARED_FOOTER`) is rendered beneath
  both checkboxes — the Art. 7 minimum (controller + policy + anytime
  withdrawal) — with the existing imprint/privacy link placement next to it.
- **No marketing** is permitted to an address whose `marketing_doi_status` is
  not `'confirmed'`, or that is on the suppression list / unsubscribed.
- Every marketing email MUST contain a working unsubscribe link.
- The exact consent text shown to the user is stored verbatim
  (`consent_text_shown`) as **Art. 7 proof of consent**, together with a
  **consent copy version stamp** (`consent_copy_version`, currently `"v2"` —
  `CONSENT_COPY_VERSION` in `src/lib/consent-copy-version.mjs`), so v1 and v2
  records stay distinguishable in the audit trail. The stamp is resolved
  server-side: it is set only when the echoed text is byte-identical to the
  copy the backend currently serves, and `NULL` otherwise (honest
  "unattested" — e.g. a ≤60s-stale cached copy across a deploy boundary; the
  verbatim text remains authoritative). Pre-versioning rows are backfilled to
  `'v1'` (migration `0011_consent_copy_version.sql`).
- **The widget never hard-codes the consent copy.** The canonical strings
  (checkbox labels, shared footer, imprint/privacy links, the copy `version`,
  and the pre-composed `consentTextShown` audit string) are served by the
  backend — attached to every `offer_email_summary` tool result and available
  via `GET /api/consent-copy` for capture forms not triggered by the tool (see
  [`API_CONTRACT.md`](./API_CONTRACT.md) §2 + §7.4). The widget renders them
  verbatim and echoes `consentTextShown` back unchanged, so the stored audit
  text can never diverge from what was displayed, and a lawyer copy change
  ships as a backend deploy with no widget release.
- **Returning-customer hint** (served alongside the consent copy, same
  payload: `returningHint { enabled, text }`): a short, backend-served hint
  near the email input telling users they can be recognised via email
  ("Schon einmal von Mo beraten worden? …"). **Informational only — NOT part
  of `consentTextShown`** (it describes the customer-memory feature, it is
  not consent text). Serving it from the backend lets the wording be tuned
  without a theme release, e.g. after the lawyer clears customer-memory use
  (CUST-B, see [`CUSTOMERS.md`](./CUSTOMERS.md)); `enabled: false`
  (`RETURNING_HINT_ENABLED=false`) tells the widget to hide it.

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
| `consent_copy_version` | Which canonical copy that text is (`'v1'`/`'v2'`; `NULL` = unattested echo). See migration `0011`. |
| `unsubscribed_at` | Set on unsubscribe; the address also goes to `suppression_list`. |

`suppression_list (email, added_at, reason)` is the hard block-list checked
before any marketing send.

## End-to-end flow

```
Chat → assistant calls offer_email_summary (value-triggered: after a
       well-received recommendation, a helpful comparison, or at buying/
       checkout intent — never as the opener; at most TWO asks per
       conversation, enforced server-side by withholding the tool.
       At the checkout moment the ask is GUARANTEED deterministically:
       when a turn calls add_to_cart without the model offering the
       summary itself, the backend forces one extra step with toolChoice
       pinned to offer_email_summary — counted as one of the two asks,
       suppressed once the email is captured, the cap is reached, or the
       session has an email_capture_declined event. See
       src/lib/email-offer-trigger.mjs + api/chat prepareStep.)
     → widget renders the capture form (email + two separate checkboxes;
       copy taken verbatim from the tool result's consentCopy payload —
       or GET /api/consent-copy for a non-tool-triggered form)
     → POST /api/capture-email { sessionId, email, transactionalConsent,
                                 marketingConsent, consentTextShown }
        ├─ validate email + transactionalConsent (required — false/missing →
        │    400 `transactional_consent_required`; both boxes start unchecked)
        ├─ upsert email_captures (store consent_text_shown +
        │    consent_copy_version stamp)
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

## Measurement (pseudonymous, Cluster A)

The ask → submit → opt-in → DOI-confirm funnel is tracked through
session-keyed `kpi_events` (`email_capture_ask_shown` / `_submitted` /
`_marketing_opted_in` / `_marketing_confirmed`, plus the widget-emitted
`_declined`), each carrying the trigger moment of the ask. **No email address
ever appears in an event** — see `src/lib/kpi-events.ts` and
[`API_CONTRACT.md`](./API_CONTRACT.md) §5. The optional `trigger` echoed to
`/api/capture-email` is telemetry-only and is never stored on the consent
record.

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
The current copy is **v2** (`CONSENT_COPY_VERSION`) — review the v2 strings
as-is; they go to the lawyer verbatim.

- [ ] **Transactional checkbox label** (`TRANSACTIONAL_CHECKBOX_LABEL`, v2:
      "Ja, schickt mir meine Beratungs-Zusammenfassung per E-Mail (inkl.
      Direkt-Link zur Kasse)."). Note the v2 decision: this box now starts
      **unchecked** like the marketing box, and a submit without it is
      rejected server-side (`transactional_consent_required`) — the v1
      question about an acceptable pre-check is moot.
- [ ] **Marketing checkbox label** (`MARKETING_CHECKBOX_LABEL`, v2: "Ja, ich
      möchte exklusive Angebote und Aktionen erhalten — nur für Abonnenten.
      Jederzeit abbestellbar."). Confirm purpose specificity, that "Jederzeit
      abbestellbar" suffices alongside the shared footer's withdrawal line,
      and that the "nur für Abonnenten" exclusivity claim is acceptable
      (accurate scarcity — the agreed ceiling; no urgency, no concrete
      discount promise).
- [ ] **Shared footer** (`CONSENT_SHARED_FOOTER`, v2: "Verarbeitung durch
      motion sports gemäß Datenschutzerklärung; Widerruf jederzeit möglich.")
      — confirm this one line plus the linked privacy policy meets the
      Art. 7 / transparency minimum for both consents.
- [ ] **Returning-customer hint** (`RETURNING_CUSTOMER_HINT_TEXT`) — rendered
      near the email input, NOT part of the consent text. Review together
      with the customer-memory item below (CUST-B): it advertises
      recognition via email, so it must stay within whatever scope the
      customer-memory clearance allows.
- [ ] **DOI confirmation email** subject + body (`DOI_EMAIL_SUBJECT`,
      `doiEmailBody`) — purpose statement + the confirm CTA.
- [ ] **DOI confirmation page** copy (`DOI_CONFIRMED_*`, `DOI_INVALID_*`).
- [ ] **Unsubscribe footer** (`unsubscribeFooter`) present in every marketing
      email, with the legal basis line.
- [ ] **Unsubscribe confirmation page** copy (`UNSUBSCRIBE_*`).
- [ ] **Summary email** subject + framing (`SUMMARY_EMAIL_SUBJECT`,
      `summary-email.ts`) — confirm it reads as a requested service, not
      marketing (no offers/discounts).
- [ ] Confirm the **frontend renders BOTH checkboxes unchecked** (v2: the
      never-pre-tick rule now covers the transactional box too — prominence
      is fine, a pre-tick never is) and the two consents as visually
      separate, independently-tickable boxes.
- [ ] Confirm an **Imprint/Privacy link** is shown next to the capture form
      (frontend), as the consent text references data use for personalisation.
      The link targets are served by the backend (`CAPTURE_FORM_IMPRINT_URL`,
      `CAPTURE_FORM_PRIVACY_URL` in `consent-copy.ts`) — verify the privacy
      URL actually resolves on the live shop (the standard Shopify policy
      path is assumed) before launch.
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
- [ ] **Welcome discount framing** — ⚠️ **feature-flagged OFF by default**
      (`WELCOME_DISCOUNT_ENABLED`, see
      [`WELCOME_DISCOUNT.md`](./WELCOME_DISCOUNT.md)): the automatic issuance
      is disabled (client decision; manual codes via the dashboard instead)
      and the former in-chat mention was **removed** from the system prompt.
      Review is only needed **before re-enabling the flag**: the one-time
      welcome code is tied to **completing the DOI confirmation** (a
      freely-chosen "yes, I want this" / welcome gift for joining), **not**
      to ticking the marketing checkbox, so the consent stays "freely given"
      (Art. 7(4) GDPR). Confirm this framing and the welcome email /
      confirmation-page copy (`WELCOME_EMAIL_SUBJECT`, `welcomeEmailBody`,
      `DOI_CONFIRMED_WELCOME_BODY`).
