# Consent flow — email capture, double opt-in, suppression

This document describes how the backend captures an email address, the two
**separate** consents it collects, the double-opt-in (DOI) flow for marketing,
the suppression logic, and the audit trail. It also lists exactly which copy a
lawyer must approve before launch.

> ✅ **The DOI / marketing / personalisation / transactional copy is
> LAWYER-APPROVED** (June 2026). It lives in
> [`src/lib/consent-copy.ts`](../src/lib/consent-copy.ts), marked with
> `CONSENT_COPY_LAWYER_APPROVED = true`. Treat these strings as approved — any
> wording change needs a fresh review.
>
> ⚠️ **Still pending — the §7(3) "Bestandskunden" copy only.** That audience is
> a DISTINCT lawful basis gated by its own flag `BESTANDSKUNDE_SENDS_APPROVED`
> (still **false**); its strings and the "own similar products" boundary await
> their own sign-off. See the TODO list at the end.

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
  **consent copy version stamp** (`consent_copy_version`, currently `"v3"` —
  `CONSENT_COPY_VERSION` in `src/lib/consent-copy-version.mjs`), so v1/v2/v3
  records stay distinguishable in the audit trail. One linear version spans
  **every** consent surface (the in-chat capture form **and** the at-sign-in
  opt-in, see below); the verbatim text disambiguates which surface a record
  came from. **v3** adds the at-sign-in opt-in and is the copy now under lawyer
  review (it REPLACES v2 there); the capture-form labels are unchanged from v2
  but ship in the v3 set. The stamp is resolved
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

## At-sign-in marketing opt-in (presentation-maximised, lawful) — copy v3

A **signed-in** Shopify customer can opt into marketing **without re-typing their
email**. This is a *presentation* optimisation only — the lawful basis is
**unchanged** (it is still the consent path B above, still a real double-opt-in):

- **A Shopify account NEVER implies consent.** There is **no auto-enrol** and
  **no pre-tick** — the widget renders an **UNCHECKED**, benefit-framed box and
  the customer must actively tick it (clear affirmative act). The endpoint
  **requires** `marketingConsent: true` in the body and refuses otherwise
  (`400 marketing_consent_required`).
- **The only thing the account removes is the "type your email" step.** We
  already hold the customer's **verified** Shopify email (`customers.email` for
  the tier-3 row), so the opt-in is one tick instead of a form. A synthetic
  `shopify:<id>` placeholder (sign-in with no verified email) is refused
  (`422 no_verified_email`).
- **It runs the EXISTING DOI.** The tick sets `marketing_doi_status = 'pending'`,
  issues a token, and sends the **same** confirmation email; consent becomes
  `'confirmed'` only after the link is clicked. Withdrawable via the **same**
  unsubscribe.
- **Same consent audit.** The exact label + footer shown are stored verbatim as
  `consent_text_shown` with the same `consent_copy_version` stamp (v3). The copy
  is **served by the backend** (`GET /api/consent-copy?surface=signin` →
  `signInMarketingConsentCopy()`), so the widget renders it verbatim and echoes
  `consentTextShown` back unchanged — a lawyer copy change ships as a backend
  deploy.

```
signed-in widget (tier 3)                     backend
─────────────────────────                     ───────
GET /api/consent-copy?surface=signin  ───────► { headline, marketingLabel (UNCHECKED),
                                                 consentFooter, consentTextShown, version: v3, … }
user ticks the box  ─────────────────────────► POST /api/account/marketing-opt-in
                                                 (guard: origin + secret + LIVE access token)
                                                 ├─ require marketingConsent === true
                                                 ├─ email = customers.email (verified; refuse shopify:<id>)
                                                 ├─ upsertEmailCapture(marketing=true) → 'pending' + token
                                                 ├─ linkCustomerOnEmailCapture (attach session, sync mirror)
                                                 └─ send DOI email
user clicks confirm link ─────────────────────► GET /api/confirm-marketing  → 'confirmed'
```

**Where it is surfaced (CA-4 placement).** The at-sign-in opt-in card is shown
**only** to a signed-in customer who has **not yet recorded a marketing
decision** — the widget gates it on `marketing.optInActionable` from
`/api/auth/me` (`true` ⇔ `marketing_status === 'none'` **and** a real verified
email; `false` once `pending`/`confirmed`/`unsubscribed`, or for a synthetic
email). For tier-3 customers the **end-of-chat** email-summary + opt-in capture
widget is **suppressed** (the widget gates that off `identity.tier === 3`); the
opt-in lives here at sign-in instead. Tiers 1–2 keep the end-of-chat capture
unchanged. See [`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §10–§11.

The widget render contract is in
[`frontend-handoff/CONSENT_FLOW.md`](./frontend-handoff/CONSENT_FLOW.md) §2.

## §7 Abs. 3 UWG Bestandskunden — a SEPARATE lawful basis

Existing-customer email (§7 Abs. 3 UWG) lets us email a customer about our **own
similar products** **without** prior opt-in consent — a **different lawful basis**
from the DOI marketing above. **The two bases are NEVER merged.**

| | DOI-consented marketing | §7(3) Bestandskunden |
|---|---|---|
| **Lawful basis** | Art. 6(1)(a) — explicit consent | §7 Abs. 3 UWG — existing customer |
| **Granted by** | the **double-opt-in** (only path to `confirmed`) | a **completed purchase** in Shopify order history |
| **State** | `email_captures.marketing_doi_status` / `customers.marketing_status` | `customers.bestandskunde_eligible` (migration 0017) |
| **Opt-out** | `suppression_list` (`/api/unsubscribe`) | **separate** `bestandskunden_suppression_list` (`/api/unsubscribe/bestandskunde`) |
| **Send gate** | `canSendMarketing` + `CONSENT_COPY_LAWYER_APPROVED` | `canSendBestandskundenMail` + **own** flag `BESTANDSKUNDE_SENDS_APPROVED` |

Eligibility (`lib/bestandskunden.mjs :: isBestandskundeEligible`) is **NOT** an
account alone and **NOT** a cancelled/abandoned order: it requires at least one
order whose financial status is a **completed purchase** (`PAID` or
`PARTIALLY_REFUNDED`; everything else — pending/authorized/voided/refunded/
unknown — fails closed). It is cached on the customer row, recomputed every time
the purchase summary is refreshed (`saveCustomerPurchaseSummary`), so the
audience query is a cheap boolean filter, never a Shopify fan-out.

A §7(3) send (when the flag is on) MUST:

- **(a)** be limited to **own, similar/complementary** products to what was
  bought — the boundary the lawyer signs off before the flag flips;
- **(b)** carry the **opt-out notice** in every message
  (`bestandskundenOptOutNotice` — names the basis, anytime, free of charge,
  §7 Abs. 3 Nr. 4 UWG);
- **(c)** honour the **separate** Bestandskunden opt-out
  (`bestandskunden_suppression_list`), independently of the DOI unsubscribe — a
  customer objecting to one is **not** auto-removed from the other.

**Built but OFF.** The audience, eligibility, suppression, opt-out link and the
`canSendBestandskundenMail` gate are all built, but **real §7(3) sends are gated
behind `BESTANDSKUNDE_SENDS_APPROVED` (default false)** — distinct from
`CONSENT_COPY_LAWYER_APPROVED`. Nothing existing-customer goes out until a lawyer
blesses the "own similar products" boundary + the opt-out copy and the flag is
flipped. The admin dashboard's Marketing tab shows the two audiences under
**separate labelled headings** ("DOI-Einwilligung" vs "§7 Abs. 3 UWG
Bestandskunden") so the bases never blur; a Bestandskunde who *also* holds a DOI
consent is flagged as such without merging the lists.

## Match-up on sign-in (consent carry-forward + session scope)

Two match-up cases run on the Customer Account sign-in (see
[`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §4):

- **email-only → signed-in:** the merge (`decideMerge` → `bindShopifyIdentity`)
  **stamps** the existing tier-2 row matched by the verified email. That UPDATE
  touches **only identity columns** — never `marketing_status` /
  `transactional_consent` — so a **prior DOI consent under that email carries
  forward intact** (still `confirmed`): none invented, none silently revoked.
- **current-anonymous-session → signed-in:** only the **current** session's
  conversation (the chat that led to sign-in, from the signed `state`/pending
  record) is attached to the now-signed-in customer (`WHERE session_id = THIS
  session`). Other anonymous threads are **never** retroactively scooped.

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

## Lawyer sign-off status

All strings below are in [`src/lib/consent-copy.ts`](../src/lib/consent-copy.ts).
`CONSENT_COPY_LAWYER_APPROVED` governs the DOI marketing + personalisation path.

> ✅ **DONE — `CONSENT_COPY_LAWYER_APPROVED = true` (June 2026).** The v3 copy
> (`CONSENT_COPY_VERSION`) — DOI/marketing/personalisation/transactional plus the
> at-sign-in opt-in strings — was reviewed and approved by the lawyer and went
> live verbatim. The items below are checked off as a record of what was
> approved; any wording change requires a fresh review.
>
> ⚠️ **Two separate sign-offs.** The above is gated by
> `CONSENT_COPY_LAWYER_APPROVED`. **Real §7(3) Bestandskunden sends are a
> DISTINCT gate** — `BESTANDSKUNDE_SENDS_APPROVED` (env, default **false**) — and
> STILL need their own sign-off of the "own similar products" boundary + the
> opt-out copy. Those items remain unchecked below. Do not conflate them.

### v3 — at-sign-in marketing opt-in (NEW; replaces v2 in the review)

- [x] **Sign-in opt-in headline** (`SIGNIN_MARKETING_OPTIN_HEADLINE`, v3) —
      framing shown above the box; NOT part of `consentTextShown`.
- [x] **Sign-in opt-in checkbox label** (`SIGNIN_MARKETING_OPTIN_LABEL`, v3:
      "Ja, schickt mir an meine hinterlegte E-Mail-Adresse exklusive Angebote
      und Aktionen — nur für Abonnenten. Jederzeit abbestellbar."). Confirm the
      "hinterlegte E-Mail-Adresse" phrasing (we use the verified Shopify email,
      no field), the same scarcity ceiling as the capture box, that it renders
      **UNCHECKED** (no auto-enrol on sign-in), and that it runs the same DOI.

### §7 Abs. 3 UWG Bestandskunden (DISTINCT gate: `BESTANDSKUNDE_SENDS_APPROVED`)

- [ ] **The "own similar products" boundary** — the rule for which products a
      §7(3) email may advertise relative to what the customer bought. This is the
      central legal call; the flag stays OFF until it's blessed.
- [ ] **Bestandskunden opt-out notice** (`bestandskundenOptOutNotice`) — present
      in every §7(3) email: names the basis, the anytime + free objection
      (§7 Abs. 3 Nr. 4 UWG), and links the separate opt-out.
- [ ] **§7(3) opt-out confirmation page** copy
      (`BESTANDSKUNDE_OPT_OUT_CONFIRMED_*` / `_INVALID_*`).
- [ ] Confirm the **completed-purchase boundary** (`PAID` / `PARTIALLY_REFUNDED`
      only; account-alone / cancelled / abandoned excluded) matches the legal
      "Bestandskunde" definition.

### Capture-form copy (unchanged text, now v3 set)

- [x] **Transactional checkbox label** (`TRANSACTIONAL_CHECKBOX_LABEL`, v2:
      "Ja, schickt mir meine Beratungs-Zusammenfassung per E-Mail (inkl.
      Direkt-Link zur Kasse)."). Note the v2 decision: this box now starts
      **unchecked** like the marketing box, and a submit without it is
      rejected server-side (`transactional_consent_required`) — the v1
      question about an acceptable pre-check is moot.
- [x] **Marketing checkbox label** (`MARKETING_CHECKBOX_LABEL`, v2: "Ja, ich
      möchte exklusive Angebote und Aktionen erhalten — nur für Abonnenten.
      Jederzeit abbestellbar."). Confirm purpose specificity, that "Jederzeit
      abbestellbar" suffices alongside the shared footer's withdrawal line,
      and that the "nur für Abonnenten" exclusivity claim is acceptable
      (accurate scarcity — the agreed ceiling; no urgency, no concrete
      discount promise).
- [x] **Shared footer** (`CONSENT_SHARED_FOOTER`, v2: "Verarbeitung durch
      motion sports gemäß Datenschutzerklärung; Widerruf jederzeit möglich.")
      — confirm this one line plus the linked privacy policy meets the
      Art. 7 / transparency minimum for both consents.
- [x] **Returning-customer hint** (`RETURNING_CUSTOMER_HINT_TEXT`) — rendered
      near the email input, NOT part of the consent text. Review together
      with the customer-memory item below (CUST-B): it advertises
      recognition via email, so it must stay within whatever scope the
      customer-memory clearance allows.
- [x] **DOI confirmation email** subject + body (`DOI_EMAIL_SUBJECT`,
      `doiEmailBody`) — purpose statement + the confirm CTA.
- [x] **DOI confirmation page** copy (`DOI_CONFIRMED_*`, `DOI_INVALID_*`).
- [x] **Unsubscribe footer** (`unsubscribeFooter`) present in every marketing
      email, with the legal basis line.
- [x] **Unsubscribe confirmation page** copy (`UNSUBSCRIBE_*`).
- [x] **Summary email** subject + framing (`SUMMARY_EMAIL_SUBJECT`,
      `summary-email.ts`) — confirm it reads as a requested service, not
      marketing (no offers/discounts).
- [x] Confirm the **frontend renders BOTH checkboxes unchecked** (v2: the
      never-pre-tick rule now covers the transactional box too — prominence
      is fine, a pre-tick never is) and the two consents as visually
      separate, independently-tickable boxes.
- [x] Confirm an **Imprint/Privacy link** is shown next to the capture form
      (frontend), as the consent text references data use for personalisation.
      The link targets are served by the backend (`CAPTURE_FORM_IMPRINT_URL`,
      `CAPTURE_FORM_PRIVACY_URL` in `consent-copy.ts`) — verify the privacy
      URL actually resolves on the live shop (the standard Shopify policy
      path is assumed) before launch.
- [x] **Profile building from past interactions and purchases** (the customer
      entity, see [`CUSTOMERS.md`](./CUSTOMERS.md)): confirm the privacy policy
      and the marketing consent text cover building a durable customer profile
      from **past chat sessions and Shopify purchase history** — the current
      copy may only cover the present conversation. Details and sub-items in
      `CUSTOMERS.md` → "TODO — GDPR".
- [x] **Customer memory in the live chat** (`CUSTOMERS.md` → "Customer memory
      in the live chat"): once a returning customer re-identifies by email in
      the current session, prior interactions + purchase history shape the
      **live consultation**. Confirm this personalisation purpose is within
      the approved consent scope / privacy policy before enabling for real
      users — same launch gate as the rest of this checklist.
- [x] **Welcome discount framing** — ✅ **N/A: feature retired pre-launch.**
      The automatic welcome-discount issuance was removed entirely (client
      decision; codes are issued manually via the dashboard instead), so there
      is no welcome-gift framing to review. Mo's system prompt instructs it to
      promise no welcome/new-customer discount, and the marketing-consent copy
      never offers a reward for ticking the checkbox ("freely given",
      Art. 7(4) GDPR). If the feature is ever reintroduced, restore the
      gift-for-completing-the-DOI framing from git history under a fresh
      lawyer review.
