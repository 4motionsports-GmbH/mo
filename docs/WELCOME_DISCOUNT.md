# Welcome discount — one-time code on first DOI confirmation

> ## ⚠️ FEATURE-FLAGGED **OFF** BY DEFAULT (`WELCOME_DISCOUNT_ENABLED`)
>
> **Client decision (June 2026):** the automatic issuance is too exploitable
> — one alias email = one fresh code — so the entire issuance path is gated
> behind `WELCOME_DISCOUNT_ENABLED` (default **false**, fail-closed; only
> `true`/`1`/`yes`/`on` enables it — `src/lib/welcome-discount-flag.mjs`).
> The client issues discount codes **manually via the dashboard** instead.
> With the flag off:
>
> - `issueWelcomeCodeOnDoiConfirmation` returns
>   `{ issued: false, reason: "disabled" }` before any claim/mint/send
>   (GATE 0) — the DOI confirmation itself is unaffected.
> - The DOI confirmation page never shows the welcome variant
>   (`DOI_CONFIRMED_WELCOME_BODY`) — it only renders when a welcome email
>   actually went out.
> - The former **in-chat mention** by Mo was **removed** from the system
>   prompt entirely (not just gated — see "Chat mention" below), so Mo never
>   promises a gift the backend won't issue; the customer-memory block
>   additionally instructs Mo not to promise any welcome/new-customer
>   discount while the flag is off.
> - The dashboard keeps showing **historical** issued/redeemed welcome-code
>   data, labelled **"(deaktiviert)"**.
>
> Everything below describes the behaviour **when the flag is enabled**.

An automatic, **once-ever** welcome discount code, issued when a customer
completes the marketing double-opt-in confirmation for the **first** time.
Implementation: [`src/lib/welcome-discount.ts`](../src/lib/welcome-discount.ts),
triggered from `GET /api/confirm-marketing`.

## ⚠️ Legal framing — lawyer-confirm

> **For the lawyer to confirm before launch** (also listed in the
> [`CONSENT_FLOW.md`](./CONSENT_FLOW.md) checklist):
>
> The welcome code is tied to **completing the double-opt-in confirmation** —
> a freely-chosen "yes, I want this" click, framed as a **welcome gift for
> joining** — and **NOT** to ticking the marketing checkbox. Consent must stay
> "freely given" (Art. 7(4) GDPR): the checkbox itself is never rewarded, and
> the consent copy / welcome email copy must never promise the discount as
> consideration for the checkbox. Confirm this framing and the copy in
> `src/lib/consent-copy.ts` (`WELCOME_EMAIL_SUBJECT`, `welcomeEmailBody`,
> `DOI_CONFIRMED_WELCOME_BODY` — all placeholders).
>
> A practical side effect of the DOI trigger: **unconfirmed or fake email
> addresses are never rewarded** — no code exists until the confirmation link
> in the mailbox is actually clicked.

## Issuance trigger

`GET /api/confirm-marketing?token=…` → token valid → `marketing_doi_status`
flips to `confirmed`. Only when this is a **fresh** confirmation (not an
`alreadyConfirmed` re-click) does the route call
`issueWelcomeCodeOnDoiConfirmation(email)`, which enforces, in order:

0. **Feature flag** — `WELCOME_DISCOUNT_ENABLED` must be explicitly enabled
   (default off, fail-closed); otherwise the function returns
   `reason: "disabled"` before anything else runs.
1. **Suppression / eligibility** — `isSuppressed` + `canSendMarketing`
   (both fail-closed). A suppressed or unsubscribed address never gets a code
   or an email.
2. **Opt-out gate** — the delivery email is commercial, so a working signed
   unsubscribe link is mandatory; without one we refuse *before* consuming the
   customer's eligibility.
3. **Once-ever claim** — see below.
4. **Mint** — the same Shopify path as marketing codes
   (`createUniqueDiscountCode`: `usageLimit: 1` + `appliesOncePerCustomer`),
   with the **`WELCOME-`** prefix (distinct from the marketing `MS5-` codes),
   worth `WELCOME_DISCOUNT_PERCENT` % (default **5 %**, clamped 1–50), valid
   `WELCOME_DISCOUNT_EXPIRY_DAYS` days (default **30**). A failed mint releases
   the claim so a transient Shopify error doesn't burn the one chance.
5. **Record, then deliver** — code/gid/expiry are persisted on the customer
   row *before* the email goes out, so a failed send never loses a live code
   (it stays visible on the dashboard; the failure is reported).

Everything is best-effort: a welcome failure never breaks the confirmation
page the user is looking at.

## Once-ever guarantee

The **customer entity is the source of truth** (migration
`0009_welcome_discount.sql` adds `welcome_code`, `welcome_code_gid`,
`welcome_code_expires_at`, `welcome_issued_at` to `customers`).

`claimWelcomeIssuance()` stamps `welcome_issued_at` via an atomic conditional
update:

```sql
UPDATE customers SET welcome_issued_at = now()
 WHERE email = $1 AND welcome_issued_at IS NULL
RETURNING id
```

Exactly one claimant ever gets a row back, so a second welcome code can never
be issued to the same (normalised) email:

- **repeated clicks of the same DOI token** don't even reach the issuance
  (`alreadyConfirmed`), and would be blocked by the claim anyway;
- **re-signups in future sessions** resolve to the same customer row (keyed by
  email) whose `welcome_issued_at` is already set;
- **concurrent confirmations** race on the conditional update — one wins.

The claim is released **only** after a failed mint, and that release is itself
guarded on `welcome_code IS NULL` — once a real code is recorded, the claim is
permanent. No DB (or a DB error) means no claim and therefore no code
(fail-closed).

## Delivery

The code ships in the **welcome email** — the first email after confirmation —
rendered through the unified branded template
(`src/lib/email-template.ts`), with the terms stated in the text: the percent,
**single-use**, and the **concrete expiry date** (German format, Europe/Berlin,
derived from the minted code's real `endsAt` via `formatGermanExpiryDate`).
The CTA is Shopify's discount share link (`/discount/<code>`), which applies
the code automatically; the unsubscribe footer is always present. The DOI
confirmation page mentions the welcome email only when it actually went out.

## Chat mention (REMOVED)

The former in-chat mention — Mo naming the welcome gift in one sentence at
the value-triggered email-summary offer (the CAP-4 cross-wire) — was
**removed from the system prompt entirely** together with the feature-flag
change: with issuance off by default, any mention would promise a gift that
never arrives. `welcomeChatMentionExample` was deleted from
`src/lib/consent-copy.ts`, and `emailOffer.welcomeDiscountPercent` was
removed from the prompt plumbing (`src/lib/system-prompt.ts`,
`src/app/api/chat/route.ts`). The customer-memory block retains a defensive
rule: while the flag is off, Mo must not promise any welcome/new-customer
discount (and refers questions about previously issued codes to the welcome
email / info@motionsports.de); when the flag is on, the old
don't-re-promise-to-returning-customers rule applies. If the client ever
wants the mention back, re-add it under the lawyer gate with the legal
framing preserved in the git history of this file (gift for completing the
signup, never consideration for the marketing checkbox, Art. 7(4) GDPR).

## Dashboard tracking

The admin **Kunden** tab shows per customer: whether a welcome code was
issued, the code, issue date, expiry, and whether it was **redeemed** — a live
Shopify check reusing `wasDiscountCodeRedeemed` (`read_orders`, the same query
the marketing funnel uses), with an honest "unknown" state when Shopify can't
answer. While `WELCOME_DISCOUNT_ENABLED` is off, the section is labelled
**"Willkommensrabatt (deaktiviert)"** — historical data stays visible; only
the empty-state text changes to point at manual code issuance.

## Env

| Variable | Default | Meaning |
| --- | --- | --- |
| `WELCOME_DISCOUNT_ENABLED` | `false` | **Master switch for the entire issuance path.** Fail-closed: only `true`/`1`/`yes`/`on` enables it. |
| `WELCOME_DISCOUNT_PERCENT` | `5` | Whole-number percent (clamped 1–50). |
| `WELCOME_DISCOUNT_EXPIRY_DAYS` | `30` | Days the code stays valid. |
