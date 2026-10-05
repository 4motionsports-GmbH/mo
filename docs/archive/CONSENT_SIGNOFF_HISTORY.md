# Consent flow — sign-off history and retired surface descriptions

Archived 2026-10-05 from docs/CONSENT_FLOW.md — historical, not maintained.

Current state: [`docs/CONSENT_FLOW.md`](../CONSENT_FLOW.md) (backend and legal mechanics, the open legal
items) and the widget contract [`docs/frontend/CONSENT_CONTRACT.md`](../frontend/CONSENT_CONTRACT.md).
The lawyer-facing status and the chronology of approvals: [`docs/ANWALTSDOSSIER.md`](../ANWALTSDOSSIER.md)
§5, §12–§13, §21 and Anhang A. The passages below are quoted as they stood in `docs/CONSENT_FLOW.md` on
2026-10-05 (code `main` @ bb8866a), with relative links rebased to this folder; some of their wording
was already out of date then (see the notes per part).

## Name map — constants cited in the checklists below

The checklists name the copy constants of the June/July 2026 code. Since the English copy was added
they are keys of `consentStrings(locale)` in `src/lib/consent-copy-core.mjs`; none of the old names
exists any more.

| Old name (checklists) | Today |
| --- | --- |
| `SIGNIN_MARKETING_OPTIN_HEADLINE` | `signinHeadline` (since v5 also the headline of variant `a` in `consent-variants.mjs`) |
| `SIGNIN_MARKETING_OPTIN_LABEL` | `signinLabel` |
| `TRANSACTIONAL_CHECKBOX_LABEL` | `transactionalLabel` |
| `MARKETING_CHECKBOX_LABEL` | `marketingLabel` |
| `CONSENT_SHARED_FOOTER` | `consentFooter` |
| `RETURNING_CUSTOMER_HINT_TEXT` | `returningHint` |
| `DOI_EMAIL_SUBJECT` | `doiSubject` (`doiEmailSubject()` in `consent-copy.ts`) |
| `DOI_CONFIRMED_*`, `DOI_INVALID_*` | `doiConfirmedHeading` / `doiConfirmedBody`, `doiInvalidHeading` / `doiInvalidBody` |
| `UNSUBSCRIBE_*` | `unsubscribeConfirmedHeading` / `…Body`, `unsubscribeInvalidHeading` / `…Body` |
| `SUMMARY_EMAIL_SUBJECT` | `summarySubject` (`summaryEmailSubject()` in `consent-copy.ts`) |
| `CAPTURE_FORM_IMPRINT_URL`, `CAPTURE_FORM_PRIVACY_URL` | unchanged, in `consent-copy.ts` (served as `imprintUrl` / `privacyUrl`) |

## 1. Status banners at the top of the file

Superseded by: the copy-status box at the top of `docs/CONSENT_FLOW.md` and "The one consent (Shopify ⇄
Mo)". The `/api/cron/sync-campaign-audience` route named here no longer exists.

> ℹ️ **Since migration `0064_email_consent.sql` (2026-10) there is one
> marketing consent, not two.** Before, Mo's DOI (`email_captures` →
> `customers.marketing_status`) and the Shopify newsletter subscription
> (synced into `campaign_contacts` by the retired
> `/api/cron/sync-campaign-audience`) were separate records. Now
> `customers.email_consent_*` is the single state for both systems — see
> "The one consent (Shopify ⇄ Mo)" below.

> ✅ **The DOI / marketing / personalisation / transactional copy is
> LAWYER-APPROVED** (v3 set June 2026; the **v4** additions — the chat
> consent-gate strings, the upgraded personalised-offers benefit headlines,
> and the **button-consent mechanic** on the marketing surfaces — July 2026).
> It lives in [`src/lib/consent-copy.ts`](../../src/lib/consent-copy.ts), marked
> with `CONSENT_COPY_LAWYER_APPROVED = true`. Treat these strings as approved —
> any wording change needs a fresh review. **v5 (2026-10-05)** adds served
> benefit bullets to the consent popup after a sign-in (framing, not consent
> text; wording decided by the owner, see "Lawyer sign-off status").
>
> ℹ️ **The §7(3) UWG "Bestandskunden" (existing-customer) feature was REMOVED
> entirely on 2026-06-16 (client decision).** It was never live. Any §7(3)
> content remaining below this line is historical.

## 2. At-sign-in marketing opt-in — the section as it stood on 2026-10-05

Superseded by: `docs/CONSENT_FLOW.md` "Surfaces" → "At-sign-in marketing opt-in" (backend facts),
`docs/frontend/CONSENT_CONTRACT.md` §3 (rendering), `docs/frontend/ACCOUNT_CONTRACT.md` §6.1 (when the
ask is shown) and §6.2 (submit). Out of date already then: the bullets and the diagram describe the v3
checkbox ("UNCHECKED box … tick", `version: v3`); since v4 the surface is button-consent and the stamp
is `v5`. The guard also accepts a fresh shop proof since 2026-10-05 (D-AP1), and the main placement is a
popup right after the sign-in (widget of 2026-10-01). "The live widget `3e87341`" was the theme state of
2026-10-05.

### At-sign-in marketing opt-in (presentation-maximised, lawful) — copy v3, button-consent since v4

> ℹ️ **v4 update:** this surface now uses the **button-consent mechanic** (see
> the dedicated section below) instead of a checkbox, and its `headline` was
> upgraded to the approved personalised-offers framing. Where this section says
> "ticks the (unchecked) box", read "taps the explicit accept button" — the
> legal analysis is unchanged: nothing pre-selected, a clear affirmative act,
> `marketingConsent: true` only sent on that act, same DOI, same audit.

> ℹ️ **v5 update (2026-10-05, OI3):** `surface=signin` also serves
> **`benefits`** — up to four short bullets under the headline, framing like the
> headline and **never** part of `consentTextShown` — and a framing
> **`variant`** id (`src/lib/consent-variants.mjs`, tested). Served today:
> variant `a`, DE „Angebote, die zu deiner Beratung passen“, „Exklusive
> Rabatt-Aktionen nur für Abonnenten“, „Jederzeit mit einem Klick
> abbestellbar“ (EN: the approved translation). The widget renders them
> verbatim and all or nothing, and stops showing bullets of its own with the
> upload of frontend task 1 (until then the live widget `3e87341` keeps its
> own two bullets and ignores the new fields). `CONSENT_SIGNIN_VARIANTS`
> (default `a`) can activate further **approved** variants for an A/B test;
> while more than one is active, the variant is picked per session
> (`x-ms-session`) and the copy is served `private, no-store`. A variant is
> only ever deactivated, never removed, so echoed ids stay known. The opt-in
> POST takes optional `placement` (`popup` | `signin_return` |
> `value_moment`) and `variant` — telemetry only, written to the pseudonymous
> KPI events, never to the consent record and never a reason for a 400. The
> attestation of `consentTextShown` is unchanged (label + footer, one string
> for every variant). Render contract:
> [`frontend-handoff/CONSENT_FLOW.md`](../frontend/CONSENT_CONTRACT.md) §1, §3.1–§3.2.

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
  unsubscribe. A customer already subscribed (Shopify or earlier DOI) is
  normally never shown the card (`optInActionable: false`); should the POST
  arrive anyway, no DOI mail is sent and the answer is `confirmed` (unless the
  address is on the block list).
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
                                                 ├─ already subscribed, not suppressed? → no DOI, answer 'confirmed'
                                                 ├─ upsertEmailCapture(marketing=true) → 'pending' + token
                                                 ├─ linkCustomerOnEmailCapture (attach session)
                                                 ├─ one consent → 'pending' (source mo_signin)
                                                 └─ send DOI email
user clicks confirm link ─────────────────────► GET /api/confirm-marketing  → 'confirmed' → Shopify
```

**Where it is surfaced (CA-4 placement).** The at-sign-in opt-in card is shown
**only** to a signed-in customer who has **not yet recorded a marketing
decision** — the widget gates it on `marketing.optInActionable` from
`/api/auth/me` (`true` ⇔ `marketing_status === 'none'` **and** a real verified
email; `false` once `pending`/`confirmed`/`unsubscribed`, or for a synthetic
email). `marketing_status` mirrors the **one** consent
(`src/lib/signed-in-identity.ts`), so a customer subscribed in Shopify reads
`confirmed` and is not asked again — once the mirror holds that customer
(import, `customers/*` webhook or nightly reconciliation; sign-in itself still
imports no consent). **Anti-nag (2026-10-05):** `optInActionable` is also
`false` when the customer declined the consent popup (`consent_gate_declined`,
surface `signin`) in any of their sessions in the last 30 days, or saw it in 3
sessions within 30 days (`src/lib/consent-ask-policy.mjs`, tested) — for chat
sign-ins and shop-login recognition (App Proxy) alike. The opt-in's
`consent_events` row notes the sign-in proof behind it („Anmeldenachweis:
Kundenkonto-Anmeldung im Chat“ / „Anmeldenachweis: Shop-Login (App Proxy)“). For tier-3 customers the **end-of-chat** email-summary +
opt-in capture widget is **suppressed** (the widget gates that off
`identity.tier === 3`); the opt-in lives here at sign-in instead. Tiers 1–2 keep
the end-of-chat capture unchanged. See
[`CUSTOMER_ACCOUNT.md`](../CUSTOMER_ACCOUNT.md) §10–§11.

The widget render contract is in
[`frontend-handoff/CONSENT_FLOW.md`](../frontend/CONSENT_CONTRACT.md) §3.

## 3. Chat consent gate (v4) — the retired surface

Shown by the widget from July 2026 until 2026-10-01, then replaced by the sign-in popup for anonymous
visitors. The endpoints are still served for compatibility. Superseded by: `docs/CONSENT_FLOW.md`
"Surfaces" → "Chat consent gate — retired in the widget", `docs/frontend/API_CONTRACT.md` §7.4
(`surface=chat`) and §7.6 (`POST /api/chat-marketing-opt-in`). The stamp served on `surface=chat` is
`v5` today, not `v4` as written below.

### Chat consent gate (anonymous, marketing-only) — copy v4

The widget shows a **consent gate** once per session after the user's **first
chat message**, for **anonymous** sessions. Since the one consent the gate
**leads with sign-in**: the primary action is "Mit Kundenkonto anmelden" (the
person becomes the signed-in Shopify customer; Mo knows their orders, and the
at-sign-in card asks for the consent in one tap — or they are already
subscribed and are never asked). The typed-e-mail opt-in is the alternative
for people without an account. That alternative is the same consent path B —
marketing only, full DOI — with a typed email instead of a stored one:

- **Copy is backend-served**: `GET /api/consent-copy?surface=chat` →
  `chatGateMarketingConsentCopy()` (same guards + 60s cache as
  `surface=signin`). Payload mirrors the sign-in surface: `headline`
  (benefit framing — personalised offers + exclusive discount promotions —
  NOT part of `consentTextShown`), `marketingLabel`, `consentFooter`,
  `consentTextShown` (label + footer), `imprintUrl`, `privacyUrl`,
  `lawyerApproved: true` — plus `signIn` (`preferred`, `headline`, `body`,
  `buttonLabel`, `alternativeLabel`, `loginPath`; `chatGateSignInHint()`).
  `signIn` is UI chrome like the button caption: **never** part of
  `consentTextShown`. The widget renders nothing while `lawyerApproved` is
  `false`.
- **Accept posts to `POST /api/chat-marketing-opt-in`** (guards like
  `/api/capture-email`: origin allowlist + `x-ms-chat-key` + `x-ms-session`).
  Body: `{ sessionId, email, marketingConsent: true, consentTextShown
  (echoed verbatim), locale, trigger: "chat_gate" }`. **Deliberately not
  `/api/capture-email`**: that endpoint hard-requires the transactional tick
  and its audit string covers both consents — neither fits a marketing-only
  signup.
- **It runs the EXISTING DOI**: the accept sets `marketing_doi_status =
  'pending'`, issues a token, and sends the **same** confirmation email;
  consent becomes `'confirmed'` only after the link is clicked. A
  suppressed/unsubscribed address is never re-pended; an address already
  subscribed (Shopify or earlier DOI) and not suppressed gets no DOI mail (`confirmed`,
  `alreadyConfirmed: true`, `doiEmailSent: false`). Withdrawable via the
  **same** unsubscribe. Response `{ ok, marketing: { status, doiEmailSent,
  alreadyConfirmed } }`; errors `400 invalid_email |
  marketing_consent_required`, `429` (+`Retry-After`), `503
  upstream_unavailable`.
- **Same consent audit**: the exact label + footer shown are stored verbatim
  as `consent_text_shown` with the `consent_copy_version` stamp (v4).
- **Session recording**: the capture stores the `session_id` and runs
  `linkCustomerOnEmailCapture` exactly like `/api/capture-email`, so the
  returning-customer memory gate on `/api/chat`
  (`wasEmailCapturedFromSession`) passes for a gate-captured email too.

```
anonymous widget (after 1st message)          backend
────────────────────────────────              ───────
GET /api/consent-copy?surface=chat  ─────────► { signIn {…}, headline, marketingLabel, consentFooter,
                                                 consentTextShown, version: v4, lawyerApproved: true, … }
primary: "Mit Kundenkonto anmelden" ─────────► GET {BASE_URL}/api/auth/shopify/login?session=&return_url=
                                                 → back with ?ms_auth=ok → /api/auth/me
                                                 → optInActionable ? at-sign-in card : nothing to ask
alternative: typed email +
user taps "Ja, Angebote aktivieren" ─────────► POST /api/chat-marketing-opt-in
                                                 (guard: origin + secret + session)
                                                 ├─ require marketingConsent === true + valid email
                                                 ├─ already subscribed, not suppressed? → no DOI, answer 'confirmed'
                                                 ├─ upsertEmailCapture(marketing=true, session_id) → 'pending' + token
                                                 ├─ linkCustomerOnEmailCapture (attach session)
                                                 ├─ one consent → 'pending' (source mo_chat_gate)
                                                 └─ send DOI email
user clicks confirm link ────────────────────► GET /api/confirm-marketing  → 'confirmed' → Shopify
```

## 4. §7 Abs. 3 UWG Bestandskunden — REMOVED (2026-06-16)

Superseded by: nothing — the feature was never live. Only the consent-based marketing path remains.

The existing-customer (§7 Abs. 3 UWG) marketing feature was **removed entirely on
2026-06-16** (client decision; it was never live). The audience, eligibility
cache, separate opt-out list, email builder, send routes and `BESTANDSKUNDE_*`
flags are gone (migration `0029` drops the schema). Only the consent-based
marketing path (Art. 6(1)(a), the one consent) remains. The "completed purchase" check that the
physical-address acquisition still needs was retained, relocated into
`lib/shopify-orders.ts`.

## 5. Lawyer sign-off — the finished checklists

Superseded by: `docs/CONSENT_FLOW.md` "Lawyer sign-off status" (where the strings live, what is
approved, the open items) and `docs/ANWALTSDOSSIER.md` Anhang A. The items were checked off as a
record of what was approved (v3 June 2026, v4 July 2026); the constant names are those of the name map
above. The welcome discount was retired pre-launch (also recorded in `docs/CUSTOMERS.md` "Welcome
discount (historical, recorded here)"). The "TODO — GDPR" heading of `CUSTOMERS.md` cited below is
today `CUSTOMERS.md` "✅ GDPR: profile building — LAWYER-APPROVED".

> ✅ **DONE — `CONSENT_COPY_LAWYER_APPROVED = true`.** The v3 copy — DOI/
> marketing/personalisation/transactional plus the at-sign-in opt-in strings —
> was reviewed and approved June 2026 and went live verbatim. The **v4**
> additions (below) were approved July 2026. The items are checked off as a
> record of what was approved; any wording change requires a fresh review.

The chat gate's `signIn` strings (`chatGateSignInHint`) are UI chrome, not
consent text, and are not part of `consentTextShown`.

### v4 — chat consent gate + button-consent (NEW; approved July 2026)

- [x] **Button-consent mechanic** on the marketing surfaces (consent gate +
      at-sign-in card): served label + footer fully visible, explicit
      "Ja, Angebote aktivieren" tap as the affirmative act, nothing
      pre-selected, decline equally reachable, `marketingConsent: true` only
      sent on the tap. The email-capture form keeps its two checkboxes.
- [x] **Chat-gate headline** (`chatGateHeadline`, v4: "Persönliche Angebote
      und exklusive Rabatt-Aktionen — abgestimmt auf deine Beratung.") —
      upgraded benefit framing (personalised offers + exclusive discount
      promotions); NOT part of `consentTextShown`.
- [x] **Chat-gate consent label** (`chatGateLabel`, v4: "Ja, schickt mir
      persönliche Angebote und exklusive Rabatt-Aktionen an diese
      E-Mail-Adresse — nur für Abonnenten. Jederzeit abbestellbar.") —
      worded for an anonymous typed email; same DOI, same footer.
- [x] **Sign-in headline** (`signinHeadline`, v4: "Persönliche Angebote und
      exklusive Rabatt-Aktionen — direkt an deine hinterlegte
      E-Mail-Adresse.") — same upgraded framing; the sign-in label itself is
      unchanged from v3.

### v3 — at-sign-in marketing opt-in (NEW; replaces v2 in the review)

- [x] **Sign-in opt-in headline** (`SIGNIN_MARKETING_OPTIN_HEADLINE`, v3) —
      framing shown above the box; NOT part of `consentTextShown`.
- [x] **Sign-in opt-in checkbox label** (`SIGNIN_MARKETING_OPTIN_LABEL`, v3:
      "Ja, schickt mir an meine hinterlegte E-Mail-Adresse exklusive Angebote
      und Aktionen — nur für Abonnenten. Jederzeit abbestellbar."). Confirm the
      "hinterlegte E-Mail-Adresse" phrasing (we use the verified Shopify email,
      no field), the same scarcity ceiling as the capture box, that it renders
      **UNCHECKED** (no auto-enrol on sign-in), and that it runs the same DOI.

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
      entity, see [`CUSTOMERS.md`](../CUSTOMERS.md)): confirm the privacy policy
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
