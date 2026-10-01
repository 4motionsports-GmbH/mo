# Consent flow — the one marketing consent, double opt-in, suppression

This document describes how the backend captures an email address, the
transactional and marketing consents it collects, the **one** e-mail-marketing
consent per person that Mo shares with Shopify in both directions, the
double-opt-in (DOI) flow on Mo's surfaces, the suppression logic, and the
audit trail. It also lists exactly which copy a lawyer must approve.

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
> It lives in [`src/lib/consent-copy.ts`](../src/lib/consent-copy.ts), marked
> with `CONSENT_COPY_LAWYER_APPROVED = true`. Treat these strings as approved —
> any wording change needs a fresh review.
>
> ℹ️ **The §7(3) UWG "Bestandskunden" (existing-customer) feature was REMOVED
> entirely on 2026-06-16 (client decision).** It was never live. Any §7(3)
> content remaining below this line is historical.

## Legal background (why it's built this way)

Germany (UWG + GDPR) requires a **double opt-in** for marketing email to people
who are not existing customers. The capture form collects two consents, and
they are **never bundled**:

| | Consent | Lawful basis | Needs DOI? | When sent |
| --- | --- | --- | --- | --- |
| **(A) Transactional** | "Send me a copy of this conversation + my cart." | Art. 6(1)(b) — a service the user requests | No | Immediately on request |
| **(B) Marketing** | "You may contact me later with personalised offers based on this chat." | Art. 6(1)(a) — explicit consent | **Yes** (on Mo's surfaces) | Only after the user clicks the confirmation link |

(B) is the **one** e-mail-marketing consent of the person. It can also be given
on Shopify's own surfaces (checkout checkbox, account, newsletter form) and
arrives in Mo with Shopify's opt-in level; campaign mails require a provable
double opt-in (`confirmed_opt_in`) unless `CAMPAIGN_ALLOW_SINGLE_OPT_IN=true`.

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
- The marketing consent is a **separate**, **never-pre-selected** affirmative
  act with its own explicit text. **Documented decision**
  (`src/lib/consent-copy.ts`): pre-ticked/pre-selected marketing consent is
  invalid under the GDPR's clear-affirmative-act requirement (CJEU C-673/17
  *Planet49*) and a common Abmahnung trigger under the German UWG — we
  deliberately reject pre-selection, regardless of what other platforms do.
  The surface may be **prominent**; the opt-in is won through copy, never a
  pre-selection. On the **email-capture form** this is still a checkbox; on
  the **v4 marketing surfaces** (chat consent gate + at-sign-in card) it is
  **button-consent** — see "Button-consent mechanic (v4)" below. **Copy
  ceiling (UWG / dark-pattern exposure, agreed with the client and
  re-reviewed for v4):** the labels promise accurate scarcity ("exklusive
  Angebote …, nur für Abonnenten"), and the v4 benefit **headlines**
  (framing, not consent text) may additionally sell **personalised offers and
  exclusive discount promotions** ("persönliche Angebote und exklusive
  Rabatt-Aktionen") — this upgraded wording is lawyer-approved (July 2026).
  Still no countdowns, no invented urgency, no concrete discount amount.
- A **shared one-line footer** (`CONSENT_SHARED_FOOTER`) is rendered beneath
  both checkboxes — the Art. 7 minimum (controller + policy + anytime
  withdrawal) — with the existing imprint/privacy link placement next to it.
- **No marketing** is permitted to an address that is on the suppression list,
  or whose one consent is not `subscribed` (campaign mails; legacy 1:1 path:
  Mo DOI `confirmed`) — see "Suppression & 'can I send?' logic".
- Every marketing email MUST contain a working unsubscribe link.
- The exact consent text shown to the user is stored verbatim
  (`consent_text_shown`) as **Art. 7 proof of consent**, together with a
  **consent copy version stamp** (`consent_copy_version`, currently `"v4"` —
  `CONSENT_COPY_VERSION` in `src/lib/consent-copy-version.mjs`), so
  v1/v2/v3/v4 records stay distinguishable in the audit trail. One linear
  version spans **every** consent surface (the in-chat capture form, the
  at-sign-in opt-in, **and** the chat consent gate, see below); the verbatim
  text disambiguates which surface a record came from. **v3** added the
  at-sign-in opt-in (lawyer-approved June 2026). **v4** adds the **chat
  consent gate** surface, the upgraded personalised-offers headlines, and the
  button-consent mechanic (lawyer-approved July 2026); the capture-form labels
  are unchanged but ship in the v4 set. The stamp is resolved
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
[`DATABASE.md`](./DATABASE.md)). Three stores, each with one job:

| Store | Job |
| --- | --- |
| `customers.email_consent_*` | **The state** of the one consent, per person (shared with Shopify). |
| `consent_events` | **The history** ("Einwilligungsverlauf"): one row per change, append-only, erased with the person. |
| `email_captures` | **Mo's Art. 7 evidence** for consents given on Mo's surfaces — verbatim text, version stamp, DOI timestamps. Unchanged. |
| `suppression_list` | Opt-outs and **hard blocks** (bounce, complaint, erasure) — checked before every send. |

Relevant columns of `email_captures`:

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
| `consent_copy_version` | Which canonical copy that text is (`'v1'`…`'v4'`; `NULL` = unattested echo). See migration `0011`. |
| `unsubscribed_at` | Set on unsubscribe; the address also goes to `suppression_list`. |

`suppression_list (email, added_at, reason)` is the block-list checked before
any marketing send. Reasons: `unsubscribe`, `manual` (opt-outs — a newer real
subscribe lifts them) and `bounce`, `complaint`, `erasure` (hard blocks).

## The one consent (Shopify ⇄ Mo)

One consent per person — "E-Mail-Werbung von motion sports" — for Mo **and**
Shopify. Shopify's `emailMarketingConsent` and Mo's mirror on `customers` hold
the same state; changes flow both ways.

**State** (migration `0064`, on `customers`):

| Column | Values |
| --- | --- |
| `email_consent_state` | `subscribed` · `pending` (Mo DOI mail sent, link not clicked yet) · `unsubscribed` · `not_subscribed` |
| `email_consent_level` | `confirmed_opt_in` · `single_opt_in` · `unknown` (only for `subscribed`) |
| `email_consent_at` | When the deciding act happened (the resolver's clock) |
| `email_consent_source` | `mo_capture_form` · `mo_chat_gate` · `mo_signin` · `mo` · `shopify` · `admin` · `import` |
| `email_consent_synced_at` | Last time Shopify was confirmed to hold the same state |

`customers.marketing_status` (`none` / `pending` / `confirmed` /
`unsubscribed`) stays as a derived compatibility mirror (`subscribed` →
`confirmed`, `not_subscribed` → `none`) for its remaining readers, e.g.
`/api/auth/me`. Admin labels (`consentLabel` in `src/lib/consent-core.mjs`):
"Angemeldet (DOI)", "Angemeldet (ohne DOI-Nachweis)", "Bestätigung
ausstehend", "Abgemeldet", "Keine Einwilligung".

**One decision function.** Every change from either side goes through
`resolveEmailConsent` (`src/lib/consent-core.mjs`, pure, tested) and is written
by `applyConsentActs` (`src/lib/consent-store.ts`) in one transaction — state,
history event, suppression rows, outbox rows. Nothing else writes the consent.
The rules:

1. **Hard blocks win.** A spam complaint refuses any automatic re-subscribe. An
   erasure refuses every subscribe that is not a new act newer than the
   erasure (a person who deleted their data and later signs up again has given
   a new consent).
2. **The newer act wins.** On equal timestamps the more restrictive state
   wins. An undated act (Shopify reports none for never-subscribed customers)
   never overrides a dated state.
3. **No silent downgrade:** a Mo `pending` never overrides `subscribed`.
4. **Echo is a no-op:** the same state coming back only stamps
   `email_consent_synced_at`.
5. **The level follows the act:** our DOI → `confirmed_opt_in`; a Shopify act
   carries Shopify's level.
6. **Side effects:** an unsubscribe adds a `suppression_list` row; a newer real
   subscribe lifts an `unsubscribe`/`manual` row (a `bounce` stays); every
   Mo-side change except `pending` is queued for Shopify; a Shopify value that
   loses against a newer Mo state is answered by pushing Mo's state back.
   Shopify `INVALID` (undeliverable) is not consent — it adds a `bounce` block.

**Mo surfaces → the one consent** (`src/lib/consent-flows.ts`):

| Act | One consent | Shopify (outbox) |
| --- | --- | --- |
| Opt-in on the capture form / chat gate / sign-in card (DOI mail sent) | `pending`, source `mo_capture_form` / `mo_chat_gate` / `mo_signin` | — (nothing before the click) |
| Opt-in on an address already `subscribed` (Shopify or earlier DOI) | unchanged; **no DOI mail**; response `confirmed`, `alreadyConfirmed: true`; the tap is kept in `email_captures` | — |
| DOI link clicked (`/api/confirm-marketing`) | `subscribed` / `confirmed_opt_in` | `consent_update`, or `customer_create` with the consent for a Mo-only subscriber |
| Unsubscribe link (`/api/unsubscribe`) | `unsubscribed` + block-list `unsubscribe` | `consent_update` |
| Admin opt-out (Kunden → Marketing, Kampagne card; `/api/admin/customers/marketing-optout`) | `unsubscribed`, source `admin` + block-list `manual` | `consent_update` |
| Admin "Abmeldung aufheben" (a mistaken opt-out) | the previous `subscribed` state and level from `consent_events` (nothing without one) | `consent_update` (or `customer_create`) |
| Resend spam complaint | `unsubscribed` + block `complaint` | `consent_update` |
| Resend hard bounce | unchanged + block `bounce` | — |

**Shopify → Mo.** Shopify-side changes (checkout checkbox, account, Shopify
Email footer, admin edits) reach Mo through the webhooks `customers/create`,
`customers/update` and `customers_email_marketing_consent/update`, the bulk
import and the nightly reconciliation (`/api/cron/shopify-reconcile`, 01:45) —
all through the same resolver, source `shopify`, stamped with
`SHOPIFY_CONSENT_TEXT_VERSION` (`consent_events.text_version`) as the best
available evidence of the wording live on the shop at the time. A Shopify
unsubscribe therefore also puts the address on Mo's block list.

**Mo → Shopify.** `shopify_outbox` (`src/lib/shopify-outbox.ts`): each row
carries its target state, is tried inline right after the change and by
`/api/cron/shopify-sync` every 5 minutes, backs off on failure and turns `dead`
after the last attempt (shown in Einstellungen → Shopify-Abgleich). Kinds:
`consent_update` (`customerEmailMarketingConsentUpdate`), `customer_create`
(`customerCreate` with e-mail, name and consent — the Mo-only subscriber
becomes a Shopify customer, one subscriber list) and `data_erasure` (see
"Erasure"). Consent rows are sent only while **`SHOPIFY_CONSENT_WRITEBACK=true`**
(default `false`); while off they wait and are flushed when it is turned on.

**Erstabgleich (initial alignment)** — `src/lib/consent-alignment.ts`, card
Einstellungen → Shopify-Abgleich:

1. Migration `0064` backfilled the state from the three old stores
   (`email_captures`, the Shopify subscriptions in `campaign_contacts`,
   `suppression_list`), one `consent_events` row each (`origin_ref` `import`,
   note "Übernahme aus dem bisherigen Stand").
2. The first Shopify import runs every Shopify customer through the resolver.
   Where Mo holds the newer act, that already queues a `consent_update`.
3. **Mo-only subscribers** (`subscribed`, no Shopify id, real address, not
   blocked, no create queued) are counted in the card. On the operator's
   confirm ("In Shopify anlegen…", `POST /api/admin/shopify/align`) one
   `customer_create` per person is queued. This needs a finished import
   (otherwise `409 import_pending`).
4. The card also shows the queued consent writes (Anmeldungen / Abmeldungen)
   and open creates. The outbox sends all of them only while
   `SHOPIFY_CONSENT_WRITEBACK=true`.

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
        └─ (B) marketing: if ticked & not suppressed
               • already subscribed (Shopify or earlier DOI)? → no token,
                 no mail; response confirmed / alreadyConfirmed: true
               • else marketing_doi_status = 'pending', issue doi_token,
                 one consent → 'pending' (local only)
               • send DOI confirmation email ─────────────────────► user inbox
                                                                       │
   user clicks confirm link ───────────────────────────────────────────┘
     → GET /api/confirm-marketing?token=...
        ├─ token valid & not expired (MARKETING_DOI_EXPIRY_DAYS, default 7)
        ├─ marketing_doi_status = 'confirmed', set doi_confirmed_at
        ├─ one consent → 'subscribed' / confirmed_opt_in
        │    → shopify_outbox: consent_update, or customer_create (Mo-only)
        └─ render "Danke, deine Anmeldung ist bestätigt."

Later, every marketing email carries:
     → GET /api/unsubscribe?token=<signed email>
        ├─ verify HMAC signature (email-keyed; no DB lookup needed)
        ├─ set unsubscribed_at, add to suppression_list, revoke DOI
        ├─ one consent → 'unsubscribed' → shopify_outbox: consent_update
        └─ render "Du wurdest abgemeldet."
```

## At-sign-in marketing opt-in (presentation-maximised, lawful) — copy v3, button-consent since v4

> ℹ️ **v4 update:** this surface now uses the **button-consent mechanic** (see
> the dedicated section below) instead of a checkbox, and its `headline` was
> upgraded to the approved personalised-offers framing. Where this section says
> "ticks the (unchecked) box", read "taps the explicit accept button" — the
> legal analysis is unchanged: nothing pre-selected, a clear affirmative act,
> `marketingConsent: true` only sent on that act, same DOI, same audit.

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
  arrive anyway, no DOI mail is sent and the answer is `confirmed`.
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
                                                 ├─ already subscribed? → no DOI, answer 'confirmed'
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
imports no consent). For tier-3 customers the **end-of-chat** email-summary +
opt-in capture widget is **suppressed** (the widget gates that off
`identity.tier === 3`); the opt-in lives here at sign-in instead. Tiers 1–2 keep
the end-of-chat capture unchanged. See
[`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §10–§11.

The widget render contract is in
[`frontend-handoff/CONSENT_FLOW.md`](./frontend-handoff/CONSENT_FLOW.md) §3.

## Chat consent gate (anonymous, marketing-only) — copy v4

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
  subscribed (Shopify or earlier DOI) gets no DOI mail (`confirmed`,
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
                                                 ├─ already subscribed? → no DOI, answer 'confirmed'
                                                 ├─ upsertEmailCapture(marketing=true, session_id) → 'pending' + token
                                                 ├─ linkCustomerOnEmailCapture (attach session)
                                                 ├─ one consent → 'pending' (source mo_chat_gate)
                                                 └─ send DOI email
user clicks confirm link ────────────────────► GET /api/confirm-marketing  → 'confirmed' → Shopify
```

## Button-consent mechanic (v4) — the marketing surfaces

**Lawyer-approved (July 2026).** The widget's two marketing surfaces — the
**chat consent gate** and the **at-sign-in opt-in card** — no longer render a
checkbox. Instead:

- the served `marketingLabel` + `consentFooter` are **fully visible** (no
  truncation, no "read more" hiding the consent text),
- the **explicit tap on "Ja, Angebote aktivieren"** is the affirmative act
  (Art. 4(11) / Art. 7 GDPR — a clear affirmative action, equivalent to
  actively ticking a box),
- **nothing is pre-selected**, and **decline is equally reachable** (no
  visual burying of the decline option),
- `marketingConsent: true` is **only ever sent on that tap** — the backends
  still refuse anything else (`400 marketing_consent_required`), so an
  auto-submit can never enrol anyone.

The button caption is UI chrome, **not** consent text: the Art. 7 audit string
(`consentTextShown`) remains label + footer, exactly what is displayed. The
**email-capture form is unchanged** — still two separate, never-pre-ticked
checkboxes, and its audit string still covers both consents.

## §7 Abs. 3 UWG Bestandskunden — REMOVED

The existing-customer (§7 Abs. 3 UWG) marketing feature was **removed entirely on
2026-06-16** (client decision; it was never live). The audience, eligibility
cache, separate opt-out list, email builder, send routes and `BESTANDSKUNDE_*`
flags are gone (migration `0029` drops the schema). Only the consent-based
marketing path (Art. 6(1)(a), the one consent) remains. The "completed purchase" check that the
physical-address acquisition still needs was retained, relocated into
`lib/shopify-orders.ts`.

## Match-up on sign-in (consent carry-forward + session scope)

Two match-up cases run on the Customer Account sign-in (see
[`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §4):

- **email-only → signed-in:** the merge (`decideMerge` → `bindShopifyIdentity`)
  **stamps** the existing tier-2 row matched by the verified email. That UPDATE
  touches **only identity columns** — never the consent columns /
  `transactional_consent` — so a **prior DOI consent under that email carries
  forward intact** (still `subscribed`): none invented, none silently revoked.
  Sign-in itself never imports Shopify's consent; the Shopify-side state
  reaches the row through the customer mirror (webhooks, import,
  reconciliation), via the resolver.
- **Two rows, one person:** when Shopify reports an e-mail change onto an
  address an Interessent already uses, or the import finds a Shopify customer
  and an e-mail-only row for the same person, `mergeCustomers`
  (`src/lib/customer-merge-store.ts`) moves everything to one row and replays
  the dropped row's consent through the resolver — the newer act wins.
- **current-anonymous-session → signed-in:** only the **current** session's
  conversation (the chat that led to sign-in, from the signed `state`/pending
  record) is attached to the now-signed-in customer (`WHERE session_id = THIS
  session`). Other anonymous threads are **never** retroactively scooped.

## Suppression & "can I send?" logic

- **`isSuppressed(email)`** ([`email-capture-store.ts`](../src/lib/email-capture-store.ts))
  — true if the address is on `suppression_list`. Since the one consent every
  withdrawal — Mo's or Shopify's — writes the list, and a newer real subscribe
  lifts an opt-out row, so the list alone is the truth
  (`email_captures.unsubscribed_at` stays as evidence only). **Fail-closed**: if
  the database is unreachable it returns `true`, so a transient error can never
  let a send slip past an opt-out.
- **Campaign mails** (every campaign and the Einzelansprache) pass
  the campaign check (live: `aktiv` and inside its schedule,
  [`campaign-email.ts`](../src/lib/campaign-email.ts)) and then
  `evaluateCampaignSendGates` ([`campaign-gates.mjs`](../src/lib/campaign-gates.mjs)),
  in this order: master flag `CAMPAIGN_SENDS_APPROVED` → one consent
  `subscribed` → opt-in level `confirmed_opt_in` (unless
  `CAMPAIGN_ALLOW_SINGLE_OPT_IN=true`) → not suppressed → frequency cap
  (`MARKETING_MIN_SEND_INTERVAL_DAYS`, across both channels). State and level
  are read fresh from `customers` at send time.
- **The legacy 1:1 marketing path** (`approveAndSend`,
  [`marketing-email.ts`](../src/lib/marketing-email.ts)) still uses
  **`canSendMarketing(email)`** — Mo DOI `confirmed` in `email_captures` AND not
  suppressed — so it can only mail people with a Mo DOI.

A suppressed/unsubscribed address is **never re-pended** for DOI by Mo's
opt-in surfaces. A previously *confirmed* consent is preserved if the user
later submits the form without re-ticking marketing (only an explicit
withdrawal revokes it).

## Audit trail (Art. 7)

For each capture we can show, on demand:

- the **exact text** the user saw (`consent_text_shown`),
- **what** they consented to (`transactional_consent`, `marketing_consent`),
- **when** marketing consent was confirmed (`doi_confirmed_at`) and that it went
  through a real double opt-in (`doi_sent_at` → click → `doi_confirmed_at`),
- **when/whether** they opted out (`unsubscribed_at` + `suppression_list`),
- for the one consent, **every change from either side** in `consent_events`:
  when it happened, source (`mo_*`, `shopify`, `admin`, `import`), state,
  level, what carried it (`origin_ref`: capture id, webhook id, …) and, for
  Shopify-side acts, the shop's consent-text version (`text_version`). Refused
  acts (blocked by a complaint or an erasure) are logged with a note.

Shopify does not store the text a customer saw on its surfaces;
`SHOPIFY_CONSENT_TEXT_VERSION` is the best available evidence for those acts.

Retention purges PII for opted-out/suppressed captures after a grace period
while keeping the `suppression_list` row, so we keep honouring the opt-out (see
[`DATA_RETENTION.md`](./DATA_RETENTION.md)).

## Erasure (one deletion with Shopify)

An erasure ends the consent on both sides. `erasePerson`
(`src/lib/customer-erasure.ts`) deletes the person in Mo — including every
consent record, `consent_events` and Mo's copy of the orders — and keeps the
address on `suppression_list` with reason `erasure`. For a person with a
Shopify id it writes an erasure tombstone (no import, reconciliation or webhook
re-creates them) and queues `data_erasure`: consent off in Shopify, then
`customerRequestDataErasure` — sent only while `SHOPIFY_ERASURE_SYNC=true`.
Shopify keeps its own orders as long as the law requires. Shopify's
`customers/redact` / `customers/delete` webhooks run the same deletion in Mo.
A later **new** subscribe act (newer than the erasure) lifts the erasure block
(resolver rule 1). Details: [`CUSTOMERS.md`](./CUSTOMERS.md) "Retention /
erasure".

## Measurement (pseudonymous, Cluster A)

The ask → submit → opt-in → DOI-confirm funnel is tracked through
session-keyed `kpi_events` (`email_capture_ask_shown` / `_submitted` /
`_marketing_opted_in` / `_marketing_confirmed`, plus the widget-emitted
`_declined`), each carrying the trigger moment of the ask. The v4 consent-gate
surfaces additionally emit the widget-side `consent_gate_shown` /
`_accepted` / `_declined` / `_dismissed` events (payload
`{ surface: "signin" | "chat" }`), shown as their own funnel on the KPI tab.
**No email address ever appears in an event** — see `src/lib/kpi-events.ts`
and [`API_CONTRACT.md`](./API_CONTRACT.md) §5. The optional `trigger` echoed
to `/api/capture-email` / `/api/chat-marketing-opt-in` is telemetry-only and
is never stored on the consent record.

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

> ✅ **DONE — `CONSENT_COPY_LAWYER_APPROVED = true`.** The v3 copy — DOI/
> marketing/personalisation/transactional plus the at-sign-in opt-in strings —
> was reviewed and approved June 2026 and went live verbatim. The **v4**
> additions (below) were approved July 2026. The items are checked off as a
> record of what was approved; any wording change requires a fresh review.

### Customer platform (2026-10) — open, not yet recorded as reviewed

Collected from `docs/CUSTOMER_PLATFORM_PLAN.md` §4 (D-1, D-3, D-5), §7.8 and
§8.4 for the lawyer addendum. The switches that write to Shopify default to
`false` until then.

- [ ] **One consent across Shopify and Mo:** the Shopify checkout / account /
      newsletter wording covers the same purpose as Mo's marketing label
      (incl. personalisation from past chats and purchases), or references a
      privacy policy that does; `SHOPIFY_CONSENT_TEXT_VERSION` as the evidence
      for Shopify-side acts.
- [ ] **Mo-only subscribers created in Shopify** after their DOI and in the
      Erstabgleich (D-3, `SHOPIFY_CONSENT_WRITEBACK`).
- [ ] **Erase copy naming the shop account** (`erasurePageCopy` with
      `includesShop`, served on `/api/erase-data` and `surface=erase`) and the
      bidirectional erasure itself (D-5, `SHOPIFY_ERASURE_SYNC`).
- [ ] **A new subscribe after an erasure lifts the erasure block** (resolver
      rule 1).
- [ ] **AI profiles without consent** (`CUSTOMER_AI_PROFILE_SCOPE=all`, D-1):
      Art. 6(1)(f) basis, privacy policy, right to object
      ([`CUSTOMERS.md`](./CUSTOMERS.md)).

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
