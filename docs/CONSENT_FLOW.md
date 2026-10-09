# Consent flow — the one marketing consent, double opt-in, suppression

The backend and legal mechanics of e-mail consent: the transactional and marketing consents Mo
collects, the **one** e-mail-marketing consent per person that Mo shares with Shopify in both
directions, the double opt-in (DOI) on Mo's surfaces, suppression, the audit trail, erasure, and the
legal items still open. How the widget renders the consent surfaces and the request/response shapes
are the widget contract's (see "Surfaces"). Which switches are on in production:
[`ROLLOUT_TODO.md`](./ROLLOUT_TODO.md). The finished sign-off checklists, the removed §7(3) feature
and the descriptions of retired surfaces:
[`archive/CONSENT_SIGNOFF_HISTORY.md`](./archive/CONSENT_SIGNOFF_HISTORY.md).

> **Copy status.** The German consent copy is lawyer-approved (`CONSENT_COPY_LAWYER_APPROVED = true`
> in [`src/lib/consent-copy.ts`](../src/lib/consent-copy.ts); the v3 set June 2026, the v4 additions
> July 2026). The English copy is approved as its faithful translation
> (`CONSENT_COPY_EN_LEGAL_REVIEWED = true` in `consent-copy-core.mjs`, D-AP3, 2026-10-05). Served copy
> version: **v5** (`CONSENT_COPY_VERSION`). Any wording change in either language is a new legal
> review — "Lawyer sign-off status".

## Legal background (why it's built this way)

Germany (UWG + GDPR) requires a **double opt-in** for marketing e-mail to people who are not existing
customers. The capture form collects two consents, and they are **never bundled**:

| | Consent | Lawful basis | Needs DOI? | When sent |
| --- | --- | --- | --- | --- |
| **(A) Transactional** | "Send me a copy of this conversation + my cart." | Art. 6(1)(b) — a service the user requests | No | Immediately on request |
| **(B) Marketing** | "You may contact me later with personalised offers based on this chat." | Art. 6(1)(a) — explicit consent | **Yes** (on Mo's surfaces) | Only after the user clicks the confirmation link |

(B) is the **one** e-mail-marketing consent of the person. It can also be given on Shopify's own
surfaces (checkout checkbox, account, newsletter form) and arrives in Mo with Shopify's opt-in level;
campaign mails require a provable double opt-in (`confirmed_opt_in`) unless
`CAMPAIGN_ALLOW_SINGLE_OPT_IN=true`.

Rules baked into the code:

- **Both capture checkboxes start unchecked** (copy v2, client-approved product decision, June 2026;
  v1 allowed a pre-checked transactional box). The form exists to send the summary, so the backend
  rejects a capture without transactional consent with `400 transactional_consent_required`
  (`src/lib/capture-validation.mjs`; shape:
  [`frontend/API_CONTRACT.md`](./frontend/API_CONTRACT.md) §7.1).
- **Marketing consent is a separate, never-pre-selected affirmative act** with its own text.
  Documented decision (`src/lib/consent-copy.ts`): pre-selected marketing consent is invalid under the
  GDPR's clear-affirmative-act requirement (CJEU C-673/17 *Planet49*) and a common Abmahnung trigger
  under the UWG — we reject pre-selection regardless of what other platforms do. The surface may be
  **prominent**; the opt-in is won through copy, never a pre-selection. On the capture form the act is
  a checkbox tick; on the marketing-only surfaces it is button-consent (next rule).
- **Button-consent** (mechanic lawyer-approved July 2026, since v4): the served label + footer are
  fully visible, and the explicit tap on „Ja, Angebote aktivieren“ is the affirmative act
  (Art. 4(11) / Art. 7 GDPR — equivalent to actively ticking a box); nothing is pre-selected and
  decline is equally reachable. The backend enforces the act: the marketing-only endpoints refuse
  anything but `marketingConsent: true` (`400 marketing_consent_required`), so an auto-submit can never
  enrol anyone. The button caption is UI chrome, not consent text — the audit string stays label +
  footer. Rendering rules: [`frontend/CONSENT_CONTRACT.md`](./frontend/CONSENT_CONTRACT.md) §1.
- **Copy ceiling** (UWG / dark-pattern exposure, agreed with the client, re-reviewed for v4): the
  labels promise accurate scarcity („exklusive Angebote …, nur für Abonnenten“); the benefit headlines
  (framing, not consent text) may sell personalised offers and exclusive discount promotions
  („persönliche Angebote und exklusive Rabatt-Aktionen“, lawyer-approved July 2026); since v5 the same
  framing may appear in the served `benefits` bullets of the sign-in ask — static per locale, no
  placeholders, nothing about the visitor's behaviour (`src/lib/consent-variants.mjs`). No countdowns,
  no invented urgency, no concrete discount amount.
- **A shared one-line footer** (`consentFooter` in `consent-copy-core.mjs`) sits beneath the consent
  text on every surface — the Art. 7 minimum (controller + policy + anytime withdrawal) — with the
  imprint and privacy links next to it (served as `imprintUrl` / `privacyUrl`).
- **No marketing** to an address on the suppression list, or whose one consent is not `subscribed`
  (campaign mails; legacy 1:1 path: Mo DOI `confirmed`) — "Suppression & 'can I send?' logic".
- **Every marketing e-mail carries a working unsubscribe link**; both send paths refuse to send when
  they cannot build one (no signing secret).
- **Verbatim Art. 7 proof.** The exact consent text shown is stored (`consent_text_shown`) with a
  server-resolved version stamp (`consent_copy_version`) — "The data".
- **The copy is served by the backend, never hard-coded in the widget.** Labels, footer, links, the
  copy `version` and the pre-composed `consentTextShown` come with every `offer_email_summary` tool
  output and from `GET /api/consent-copy`; the widget echoes `consentTextShown` back unchanged. So the
  stored audit text equals what was displayed, and a copy change ships as a backend deploy without a
  widget release. Payloads: [`frontend/API_CONTRACT.md`](./frontend/API_CONTRACT.md) §7.4.
- **Returning-customer hint** (`returningHint { enabled, text }`, served with the capture copy): a short
  hint near the e-mail input that Mo recognises returning customers by e-mail („Schon einmal von Mo
  beraten worden? …“). Informational — it describes the customer-memory feature and is **not** part of
  `consentTextShown`. Served so the wording can be tuned with a backend deploy;
  `RETURNING_HINT_ENABLED=false` (default `true`) tells the widget to hide it.

## The data (Cluster B — explicit consent)

Email lives **only** in the consent/marketing cluster (see [`DATABASE.md`](./DATABASE.md)). Four
stores, each with one job:

| Store | Job |
| --- | --- |
| `customers.email_consent_*` | **The state** of the one consent, per person (shared with Shopify). |
| `consent_events` | **The history**: one row per change, append-only, erased with the person. |
| `email_captures` | **Mo's Art. 7 evidence** for consents given on Mo's surfaces — verbatim text, version stamp, DOI timestamps. |
| `suppression_list` | Opt-outs and **hard blocks** (bounce, complaint, erasure) — checked before every send. |

Relevant columns of `email_captures` (one row per address):

| Column | Meaning |
| --- | --- |
| `email` | Normalised (trimmed + lower-cased). Unique — one consent record per address. |
| `session_id` | Pseudonymous bridge to the conversation (Cluster A). Severable by the user. |
| `transactional_consent` | The user asked us to e-mail the summary (OR-merged — never downgraded by a later opt-in). |
| `marketing_consent` | Marketing was ticked / accepted, or an earlier DOI of the address is still `pending` or `confirmed`. |
| `marketing_doi_status` | `none` → `pending` → `confirmed`; back to `none` on unsubscribe, bounce or complaint. |
| `doi_token` | Random 256-bit token in the confirmation link. |
| `doi_sent_at` | When the current token was last mailed (a re-send after the cooldown restarts it); the link expires `MARKETING_DOI_EXPIRY_DAYS` (default 7) later. A claim whose mail did not go out (failed or never ran) is given back: a re-sent link gets its previous send time back, a new token is moved to just before the cooldown — the next accept sends at once with the same token, and a mail the provider delivered despite a reported failure keeps a working link. A skipped send (no mail provider configured, local development) keeps the claim and records the pending act. Without a stamp a click shows the expired page. |
| `doi_confirmed_at` | When the user clicked confirm. |
| `consent_text_shown` | Verbatim copy the user saw (audit trail); a submit without an echo keeps the stored text. |
| `consent_copy_version` | Which canonical copy that text is (`'v1'`…`'v5'`; `NULL` = unattested echo). Migration `0011`. |
| `locale` | Storefront language of the latest capture (`de` / `en`) — the language of its summary and DOI mails; counted in the KPI language split. |
| `unsubscribed_at` | Set on unsubscribe (and on a bounce or complaint); the address also goes to `suppression_list`. Evidence only — the block list decides. |

**Version stamp.** One linear `CONSENT_COPY_VERSION` (`src/lib/consent-copy-version.mjs`, tested)
spans every consent surface; the verbatim text tells which surface a record came from. The route sets
the stamp only when the echoed `consentTextShown` is byte-identical to the canonical text it currently
serves for that surface and locale (`resolveConsentCopyVersion`), and `NULL` otherwise — an honest
"unattested" (e.g. a copy cached across a deploy boundary); the verbatim text stays
authoritative. The stamp always follows the text it describes (updated together or not at all). The
stored values:

| Stamp | Copy era |
| --- | --- |
| `v1` | Launch placeholder copy (long labels, a pre-checked transactional box allowed). Rows from before versioning are backfilled to `v1` (migration `0011`). |
| `v2` | Shorter labels + the shared footer; both boxes unchecked. |
| `v3` | Adds the at-sign-in opt-in (lawyer-approved June 2026); capture labels unchanged. |
| `v4` | Adds the chat consent gate, the personalised-offers headlines and button-consent on the marketing-only surfaces (lawyer-approved July 2026); capture labels unchanged. |
| `v5` | Adds the served `benefits` bullets and a framing `variant` id on the sign-in ask (2026-10-05); labels, footers and every `consentTextShown` unchanged (a framing-only bump). |

`suppression_list (email, added_at, reason)` is the block-list checked before any marketing send.
Reasons: `unsubscribe`, `manual` (opt-outs — a newer real subscribe lifts them) and `bounce`,
`complaint`, `erasure` (hard blocks — never downgraded to an opt-out).

## The one consent (Shopify ⇄ Mo)

One consent per person for Mo **and** Shopify (since migration `0064_email_consent.sql`, 2026-10).
Shopify's `emailMarketingConsent` and Mo's mirror on `customers` hold the same state; changes flow both
ways.

**State** (migration `0064`, on `customers`):

| Column | Values |
| --- | --- |
| `email_consent_state` | `subscribed` · `pending` (Mo DOI mail sent, link not clicked yet) · `unsubscribed` · `not_subscribed` |
| `email_consent_level` | `confirmed_opt_in` · `single_opt_in` · `unknown` (only for `subscribed`) |
| `email_consent_at` | When the deciding act happened (the resolver's clock) |
| `email_consent_source` | `mo_capture_form` · `mo_chat_gate` · `mo_signin` · `mo` · `shopify` · `admin` · `import` |
| `email_consent_synced_at` | Last time Shopify was confirmed to hold the same state |

`customers.marketing_status` (`none` / `pending` / `confirmed` / `unsubscribed`) stays as a derived
compatibility mirror (`subscribed` → `confirmed`, `not_subscribed` → `none`) for its remaining readers,
e.g. `/api/auth/me`. Admin labels (`consentLabel` in `src/lib/consent-core.mjs`): "Angemeldet (DOI)",
"Angemeldet (ohne DOI-Nachweis)", "Bestätigung ausstehend", "Abgemeldet", "Keine Einwilligung".

**One decision function.** Every change from either side goes through `resolveEmailConsent`
(`src/lib/consent-core.mjs`, pure, tested) and is written by `applyConsentActs`
(`src/lib/consent-store.ts`) in one transaction — state, history event, suppression rows, outbox rows.
Nothing else writes the consent, with one exception in the same file: the DOI expiry
(`expirePendingConsents`, table below) resets an expired `pending` directly, with its own history row.
The rules:

1. **Hard blocks win.** A spam complaint refuses any automatic re-subscribe. An erasure refuses every
   subscribe that is not a new act newer than the erasure (a person who deleted their data and later
   signs up again has given a new consent).
2. **The newer act wins.** On equal timestamps the more restrictive state wins. An undated act
   (Shopify reports none for never-subscribed customers) never overrides a dated state. One exception
   (2026-10-08): a dated Shopify `subscribed` or `unsubscribed` always overrides the DOI expiry's local
   `not_subscribed` (a Mo-sourced reset that never reached Shopify), even when the expiry is newer. The
   state keeps Shopify's date; when it is older than the expiry, the history entry is dated when Mo
   learned it, with Shopify's day in its note, so the history and the period counts stay in order.
3. **No silent downgrade:** a Mo `pending` never overrides `subscribed`.
4. **Echo is a no-op:** the same state coming back only stamps `email_consent_synced_at`. Exception
   (2026-10-08): a newer Mo `pending` over a Shopify-sourced `pending` is recorded (source and time move
   to the Mo surface), so the later DOI click is credited to Mo's opt-in.
5. **The level follows the act:** our DOI → `confirmed_opt_in`; a Shopify act carries Shopify's level.
6. **Side effects:** an unsubscribe adds a `suppression_list` row; a newer real subscribe lifts an
   `unsubscribe`/`manual` row (a `bounce` stays); every Mo-side change except `pending` is queued for
   Shopify; a Shopify value that loses against a newer Mo state is answered by pushing Mo's state back
   (**drift healing**) — only when Mo's state is `subscribed` or `unsubscribed`, never `pending` and
   never the DOI expiry's `not_subscribed` (that would overwrite a shop sign-up's own pending, C.29).
   Shopify `INVALID` (undeliverable) is not consent — it adds a `bounce` block.

**Mo surfaces → the one consent** (`src/lib/consent-flows.ts`):

| Act | One consent | Shopify (outbox) |
| --- | --- | --- |
| Opt-in on the capture form / the sign-in ask / the retired chat gate, DOI mail sent | `pending`, source `mo_capture_form` / `mo_signin` / `mo_chat_gate` — written only once the DOI mail went out (a failed send writes no act, so the ask stays open) | — (nothing before the click) |
| Opt-in while a valid Mo DOI mail for the address went out within `MARKETING_DOI_RESEND_COOLDOWN_MINUTES` (default 30), also a parallel request (since 2026-10-08) | unchanged; **no second DOI mail**; answer `pending`, `doiEmailSent: true`; the tap is kept in `email_captures` | — |
| Opt-in while the person's own shop sign-up still awaits the shop's confirmation mail (Shopify `pending`, at most `MARKETING_DOI_EXPIRY_DAYS` old — C.29, since 2026-10-08) | unchanged (a signed-in opt-in that read the shop's `PENDING` live records it, source `shopify`); **no Mo DOI mail**; answer `pending`, `doiEmailSent: true` | — |
| Opt-in on an address already `subscribed` (Shopify or earlier DOI) and not on the block list | unchanged; **no DOI mail**; answer `confirmed`, `alreadyConfirmed: true` (`subscribedElsewhere` in `email-capture-store.ts`); the tap is kept in `email_captures` | — |
| Opt-in on an address on the block list (also one the signed-in shop check finds unsubscribed or invalid in Shopify) | unchanged; no DOI mail, never re-pended; answer `status: "none"`, `alreadyConfirmed: false` | — |
| DOI link clicked (`/api/confirm-marketing`) — only while the capture is `pending` and the address not suppressed, and only once | `subscribed` / `confirmed_opt_in`, source = the surface of the latest pending act, `origin_ref` `email_capture:<id>` | `consent_update`, or `customer_create` with the consent for a Mo-only subscriber |
| DOI link never clicked — `MARKETING_DOI_EXPIRY_DAYS` + 1 day after the opt-in (nightly `/api/cron/refresh-customers`, `expirePendingConsents` in `consent-store.ts`) | `pending` → `not_subscribed` (source `mo`), history entry `origin_ref` `doi_expiry` „Bestätigungslink nicht geklickt — Anmeldung verfallen“; the surfaces may ask again | — (a Mo pending never reached Shopify; a Shopify-sourced pending stays as it is in Shopify — the expiry is local and is never pushed, not even when an older Shopify `PENDING` arrives later) |
| Unsubscribe link (`/api/unsubscribe`) | `unsubscribed` + block-list `unsubscribe` | `consent_update` |
| Admin opt-out (Kunden → Marketing, Kampagne card; `/api/admin/customers/marketing-optout`) | `unsubscribed`, source `admin` + block-list `manual` | `consent_update` |
| Admin „Abmeldung aufheben“ (a mistaken opt-out) | the previous `subscribed` state and level from `consent_events` (nothing without one) | `consent_update` (or `customer_create`) |
| Resend spam complaint | `unsubscribed` + block `complaint` | `consent_update` |
| Resend hard bounce | unchanged + block `bounce` | — |

A `consent_update` needs the person's Shopify id; a person without one gets a `customer_create` only
when they become `subscribed`.

**Shopify → Mo.** Shopify-side changes (checkout checkbox, account, Shopify Email footer, admin edits)
reach Mo through the webhooks `customers/create`, `customers/update` and
`customers_email_marketing_consent/update`, the bulk import and the nightly reconciliation
(`/api/cron/shopify-reconcile`, 01:45 UTC) — all through the same resolver, source `shopify`, stamped
with `SHOPIFY_CONSENT_TEXT_VERSION` (`consent_events.text_version`) as the best available evidence of
the wording live on the shop at the time. A Shopify unsubscribe therefore also puts the address on Mo's
block list.

A consent change for a customer Mo has not mirrored yet (at a shop sign-up the consent topic often
overtakes `customers/create`) first imports the person inline — one Admin read of the mirror's fields
(≤ 2 s, skipped while the throttle gate is up), else a minimal row from the payload — and then applies
the act; a person erased in Mo stays out (C.29, 2026-10-08; outcomes: [`CUSTOMERS.md`](./CUSTOMERS.md)
„Shopify webhook topics“). Two deliveries that insert the same new person at once both land on one row
(the loser's consent is applied to the winner's).

**Before a Mo DOI mail** (C.29, 2026-10-08) the backend checks the shop
(`lib/shopify-optin-precheck.ts`, rules in the tested `lib/optin-precheck.mjs`). On the signed-in opt-in:

- a Shopify-sourced `pending` of the last `MARKETING_DOI_EXPIRY_DAYS` days in Mo's copy → the shop's
  confirmation mail is out, no Mo DOI (no Shopify call);
- Mo's copy `not_subscribed` and the address not blocked → one live Admin read (≤ 1.5 s, gated by
  `SHOPIFY_CUSTOMER_SYNC_ENABLED`):
  - `SUBSCRIBED` → already subscribed, no DOI;
  - `PENDING` within the window (at most 5 min in the future) → no Mo DOI, answer pending;
  - `UNSUBSCRIBED` / `INVALID` → recorded (block list), no mail, neutral answer — the opt-in treats the
    address as suppressed even if that write failed;
  - an older or undated `PENDING`, `NOT_SUBSCRIBED` / `REDACTED`, or a failed / timed-out read → Mo's DOI
    as before.

What the shop says is recorded through the resolver (source `shopify`, `origin_ref` `optin_precheck`).
The typed-address surfaces (capture form, retired chat gate) check Mo's copy only, never Shopify.

**Mo → Shopify.** `shopify_outbox` (`src/lib/shopify-outbox.ts`): each row carries its target state,
is tried inline right after the change and by `/api/cron/shopify-sync` every 5 minutes, backs off on
failure and turns `dead` after the last attempt (shown in Einstellungen → Shopify-Abgleich). Kinds:
`consent_update` (`customerEmailMarketingConsentUpdate`; a newer one supersedes an open older one of the
same person), `customer_create` (`customerCreate` with e-mail, name and consent — the Mo-only subscriber
becomes a Shopify customer, one subscriber list), `data_erasure` (see "Erasure") and `writeback` (Mo's
`mo-…` customer tags, not consent — D-11 in [`CUSTOMERS.md`](./CUSTOMERS.md) "Design decisions
(customer platform, 2026-10)", `SHOPIFY_WRITEBACK_ENABLED`, see
[`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §3.10; an Art. 21 objection to profiling queues the
removal of every `mo-` tag). Consent rows (`consent_update`, `customer_create`) are sent only while
**`SHOPIFY_CONSENT_WRITEBACK=true`** (default `false` in code); while off they wait and are flushed when
it is turned on.

**Erstabgleich (initial alignment)** — `src/lib/consent-alignment.ts`, card Einstellungen →
Shopify-Abgleich:

1. Migration `0064` backfilled the state from the three old stores (`email_captures`, the Shopify
   subscriptions in `campaign_contacts`, `suppression_list`), with one `consent_events` row per person
   with a backfilled state (`origin_ref` `import`, note „Übernahme aus dem bisherigen Stand (Migration
   0064)“).
2. The first Shopify import runs every Shopify customer through the resolver. Where Mo holds the newer
   act, that already queues a `consent_update`.
3. **Mo-only subscribers** (`subscribed`, no Shopify id, real address, not blocked, no create queued)
   are counted in the card. On the operator's confirm („In Shopify anlegen…“,
   `POST /api/admin/shopify/align`) one `customer_create` per person is queued. This needs a finished
   import (otherwise `409 import_pending`).
4. The card also shows the queued consent writes (Anmeldungen / Abmeldungen) and open creates. The
   outbox sends all of them only while `SHOPIFY_CONSENT_WRITEBACK=true`.

## End-to-end flow

The capture form, from the ask to the unsubscribe. The other opt-in surfaces run the same upsert, DOI
and one-consent steps ("Surfaces").

```
Chat → the model calls offer_email_summary (value-triggered: after a well-received
       recommendation, a helpful comparison, or at buying/checkout intent — never as the
       opener). The tool is withheld server-side (activeTools) once the conversation had
       TWO asks, once the session's e-mail is known (customer.email), and for a live
       signed-in session (tier 3; a failed sign-in lookup keeps the offer).
       Checkout moment: when a turn called add_to_cart and the model did not offer the
       summary itself, the backend runs ONE extra step whose only active tool is
       offer_email_summary, with an operator note to call it (best effort — the chat model
       rejects a forced tool_choice; a text answer ends the turn and nothing is asked).
       It counts as one of the two asks and is skipped when the e-mail is known, the cap
       is reached, the session has an email_capture_declined event, or the session is
       signed in. (src/lib/email-offer-trigger.mjs + api/chat prepareStep)
     → widget renders the capture form (copy from the tool output's consentCopy, or
       GET /api/consent-copy for a form not triggered by the tool)
     → POST /api/capture-email (guards, body, answers: API_CONTRACT §7.1)
        ├─ validate email + transactionalConsent === true
        │    (else 400 bad_request / transactional_consent_required)
        ├─ upsert email_captures: consent_text_shown + version stamp, locale, and the
        │    marketing DOI decision (decideCaptureDoi, email-capture-core.mjs, tested;
        │    decided again in SQL on the locked row, so parallel requests agree):
        │      • Mo DOI already 'confirmed' → stays confirmed (only a withdrawal revokes it)
        │      • suppressed → never (re-)pended; answer status 'none'
        │      • already subscribed in the one consent (Shopify or earlier DOI) → no
        │        token; answer 'confirmed', alreadyConfirmed: true
        │      • the shop's own sign-up confirmation mail is out (C.29, Mo's copy) →
        │        no Mo token or mail, a pending Mo DOI kept as it is; answer
        │        'pending', doiEmailSent (outcome shopify_pending)
        │      • ticked, a Mo DOI 'pending' whose mail went out less than
        │        MARKETING_DOI_RESEND_COOLDOWN_MINUTES (default 30) ago → no mail
        │        (outcome doi_pending, doiCooldown); answer 'pending', doiEmailSent
        │      • ticked otherwise → CLAIM 'pending': the still-valid pending token
        │        (a re-send of the same link, doiResend; its expiry restarts) or a new
        │        one. Only the request whose conditional upsert returns the row sends;
        │        parallel ones get the cooldown answer
        │      • not ticked, an earlier DOI still 'pending' → kept as it is; the link
        │        already in the inbox works until it expires
        │    no database or a database error → 503, nothing sent
        ├─ link the session's conversation to the customer (find-or-create)
        ├─ (A) marketing, claimed → send the DOI confirmation e-mail FIRST ► user inbox
        │      • sent → one consent 'pending' (source mo_capture_form;        │
        │        local), recorded before the summary                          │
        │      • failed → claim given back (doi_sent_at → just before the     │
        │        cooldown, or the previous send time of a re-sent link);      │
        │        no consent act — the next accept sends at once               │
        │      • skipped (no mail provider, local development) → claim kept,  │
        │        act recorded                                                 │
        │      • first, so no claim is held across the slow summary: a        │
        │        parallel or retried accept is never told „mail is out“       │
        │        before it went                                               │
        └─ (B) transactional: send the summary e-mail ─────────────────► user inbox
               • a summary of the conversation in the shopper's language      │
                 (de/en)                                                      │
               • prefilled-cart permalink (NO discount; products: below)      │
               • a real delivery failure → 502; the consent stays stored      │
                 and a DOI mail that went out stays valid (a retry within     │
                 the cooldown is answered „confirmation mail is out“)         │
                                                                              │
   user clicks confirm link ──────────────────────────────────────────────────┘
     → GET /api/confirm-marketing?token=…&locale=…
        ├─ token found, row 'pending', link not expired (MARKETING_DOI_EXPIRY_DAYS,
        │    default 7, from the last mail), address not suppressed
        │    (else an error page: 400 invalid / withdrawn / blocked since — an old
        │    link never re-subscribes after an unsubscribe or a block —, 410 expired,
        │    503 no database; an already 'confirmed' token → the success page,
        │    nothing recorded)
        ├─ conditional UPDATE → 'confirmed', doi_confirmed_at — exactly one click wins;
        │    parallel or later clicks see the success page and record nothing
        ├─ winner only: one consent → 'subscribed' / confirmed_opt_in (origin
        │    email_capture:<id>) → shopify_outbox: consent_update, or customer_create
        │    (Mo-only); KPI email_capture_marketing_confirmed {source, placement?, variant?,
        │    captureId} in the session of the opt-in that mailed the link (by captureId)
        └─ render „Danke, deine Anmeldung ist bestätigt.“

   link never clicked:
     → nightly /api/cron/refresh-customers (expirePendingConsents), one day after the
       link expired: one consent 'pending' → 'not_subscribed' + consent_events row
       (origin_ref 'doi_expiry'); local only — nothing goes to Shopify; the person may be
       asked again

Later, every marketing e-mail carries:
     → GET /api/unsubscribe?token=<signed email>
        ├─ verify HMAC signature (email-keyed; no DB lookup needed)
        ├─ set unsubscribed_at, add to suppression_list, revoke the DOI
        ├─ one consent → 'unsubscribed' → shopify_outbox: consent_update
        └─ render „Du wurdest abgemeldet.“
```

### The summary cart — selected vs discussed

The backend tracks two product sets per conversation (`src/lib/recommended-products.mjs`), stored on
the conversation:

- **Selected** — products the user expressed intent to **buy**: the ids of the latest `add_to_cart`
  (direct-checkout) tool call. Updated by replacement, so switching to an alternative drops the
  rejected product.
- **Discussed** — every product any product tool referenced (`show_product`, `compare_products`,
  `add_to_cart`, `suggest_showroom`, `show_contact_form`, `offer_email_summary`), including
  compared-and-rejected alternatives.

The cart permalink uses the **selected** set when the user made a clear choice and falls back to the
**discussed** set only when there is no selection (`chooseCartProductIds`, `src/lib/cart.ts`).
Sold-out products are always excluded from the cart link. The summary mail lists the cart's products,
then the other discussed products under „Vielleicht auch interessant:“ (`summary-products.mjs`). The
capture request carries no product list.

## Surfaces

Every Mo opt-in surface runs the same machinery: `upsertEmailCapture` (the Art. 7 evidence and the DOI
decision above), `linkCustomerOnEmailCapture`, `recordMoOptIn` (the one consent turns `pending` only
once the DOI mail went out) and the same DOI mail, confirmation link and unsubscribe. They differ in where
the address comes from and what is consented to. When and how the widget shows each surface, and the
shapes, are the widget contract's:

| Surface | Submit | Consents | Address | `consent_text_shown` · source | Widget contract |
| --- | --- | --- | --- | --- | --- |
| In-chat capture form — copy: `offer_email_summary` output or `GET /api/consent-copy` | `POST /api/capture-email` | transactional (required) + marketing (optional), two checkboxes | typed | both labels + footer · `mo_capture_form` | [CONSENT_CONTRACT](./frontend/CONSENT_CONTRACT.md) §4 (rendering); [API_CONTRACT](./frontend/API_CONTRACT.md) §7.1, §7.4 (shapes) |
| Marketing ask after sign-in (popup, inline card) — copy: `?surface=signin` | `POST /api/account/marketing-opt-in` | marketing only, button-consent | the signed-in customer's verified `customers.email` | sign-in label + footer · `mo_signin` | CONSENT_CONTRACT §3 (rendering); [ACCOUNT_CONTRACT](./frontend/ACCOUNT_CONTRACT.md) §6.1 (when shown), §6.2 (submit shape); API_CONTRACT §7.4 (copy) |
| Chat consent gate — retired in the widget — copy: `?surface=chat` | `POST /api/chat-marketing-opt-in` | marketing only, button-consent | typed | gate label + footer · `mo_chat_gate` | API_CONTRACT §7.4, §7.6 |

On every surface the stamp is resolved against that surface's canonical text in the request's locale,
an address already holding the one consent gets no second DOI mail, an address gets at most one Mo DOI
mail within `MARKETING_DOI_RESEND_COOLDOWN_MINUTES` (at most one minute below the link's life,
`MARKETING_DOI_EXPIRY_DAYS`, `effectiveDoiResendCooldownMinutes` in `src/lib/doi-cooldown.mjs`; none while its
shop sign-up's own confirmation mail is out), and a suppressed address is never re-pended and is answered `status: "none"` (never
„already subscribed“, `isAlreadyConfirmedAnswer` in `src/lib/capture-funnel.mjs`).

### At-sign-in marketing opt-in

A signed-in Shopify customer opts in without re-typing the e-mail. This is a *presentation*
optimisation only — the lawful basis is unchanged (consent path B, a real double opt-in):

- **An account never implies consent.** Sign-in writes no consent and enrols no one; the endpoint
  requires `marketingConsent: true` (button-consent, above).
- **Who tapped, to which address.** The route needs a **live** sign-in — a chat sign-in with a live
  access token, or a fresh shop proof from the App Proxy (`requireSignedInCustomer`,
  `src/lib/account-guard.ts`) — and uses the verified `customers.email` of that customer, never a
  typed one (the `shopify:<id>` placeholder of an account without a verified address is refused,
  `422 no_verified_email`). The `consent_events` row of a new DOI notes which proof stood behind the
  tap: „Anmeldenachweis: Kundenkonto-Anmeldung im Chat“ or „Anmeldenachweis: Shop-Login (App Proxy)“
  (`signInProofNote`, Art. 7(1) evidence). Step-by-step internals:
  [`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §10.
- **Same DOI, same audit:** `upsertEmailCapture` with `transactionalConsent: false` (OR-merged, so an
  earlier transactional consent stays), `consent_text_shown` = sign-in label + footer with the stamp,
  `pending` + the same DOI mail; `subscribed` only after the click; withdrawable through the same
  unsubscribe.
- **Framing (v5).** `surface=signin` serves a `headline`, up to four `benefits` and a framing `variant`
  id from the variant registry `src/lib/consent-variants.mjs` (tested). Framing only — never part of
  `consentTextShown`, which is one string for every variant. `CONSENT_SIGNIN_VARIANTS` (default `a`)
  lists the active variants; only variants marked `lawyerApproved: true` in the registry are served
  (never none: variant `a` is the fallback), and the served `lawyerApproved` is
  `CONSENT_COPY_LAWYER_APPROVED && variant.lawyerApproved`. A variant is only ever deactivated, never
  removed (`SHIPPED_SIGNIN_VARIANT_IDS`, tested), so echoed ids stay known. While more than one is
  active, each session gets a stable variant (a hash of the active set and `x-ms-session`) and the copy
  is not cached (headers: API_CONTRACT §7.4). Variant `a`'s registry flag stands for
  its approved v4 headline and the owner's bullet decision (D-AP4) — the bullets themselves are an open
  legal item ("Lawyer sign-off status").
- **Telemetry, not evidence:** the POST's optional `placement` and `variant` (fields: ACCOUNT_CONTRACT
  §6.2; event data: API_CONTRACT §5) are written only to the pseudonymous KPI events — never to the
  consent record.
- **When it is asked:** `marketing.optInActionable` on `/api/auth/me` — no consent decision on record
  (a `pending` DOI counts as one until it expires; then the person may be asked again — "Mo surfaces →
  the one consent"), a real address, **not on the suppression list** (any reason — unsubscribe,
  manual, complaint, bounce, erasure; owner's decision 2026-10-06: an accept for a blocked address
  writes no consent act, so the ask would only come back), not quiet under the per-customer anti-nag,
  fail closed. The whole rule is `isMarketingOptInActionable` (`src/lib/consent-ask-policy.mjs`,
  tested). Widget view: ACCOUNT_CONTRACT §6.1; backend computation: `CUSTOMER_ACCOUNT.md` §10
  (`signed-in-identity.ts`).
- **No capture form for tier 3.** The widget does not render the capture form for a signed-in customer
  (ACCOUNT_CONTRACT §6.0), and the backend does not offer `offer_email_summary` (nor the forced
  checkout-moment ask) to a live signed-in session — fail-open on a lookup error, so the widget gate
  stays required.

### Chat consent gate — retired in the widget

Not shown by the widget since 2026-10-01 (anonymous visitors get the sign-in popup instead). `GET
/api/consent-copy?surface=chat` and `POST /api/chat-marketing-opt-in` are still served for
compatibility (API_CONTRACT §7.4, §7.6) and run the same DOI with source `mo_chat_gate`. The former
surface description: [`archive/CONSENT_SIGNOFF_HISTORY.md`](./archive/CONSENT_SIGNOFF_HISTORY.md) §3.

## Match-up on sign-in

The consent side of the match-up (the identity side — the merge rule and which conversations join
the customer — is [`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §4 and §10 "The match-up"):

- **Sign-in never writes the consent.** Binding the Shopify identity (`decideMerge` →
  `bindShopifyIdentity`, `src/lib/customer-store.ts`) stamps the tier-2 row matched by the verified
  e-mail and updates identity columns only — never the consent columns or `transactional_consent` —
  so a prior DOI under that e-mail carries forward intact: none invented, none silently revoked.
  Shopify's consent reaches the row only through the customer mirror (webhooks, import,
  reconciliation), via the resolver.
- **Two rows, one person.** When Shopify reports an e-mail change onto an address an Interessent
  already uses, or the import finds a Shopify customer and an e-mail-only row for the same person,
  `mergeCustomers` (`src/lib/customer-merge-store.ts`) moves everything to one row and replays the
  dropped row's consent through the resolver — the newer act wins.

## §7 Abs. 3 UWG Bestandskunden — REMOVED

Removed entirely on 2026-06-16 (client decision; never live; migration `0029` drops the schema). Only
the consent-based path (Art. 6(1)(a), the one consent) remains. History:
[`archive/CONSENT_SIGNOFF_HISTORY.md`](./archive/CONSENT_SIGNOFF_HISTORY.md) §4.

**Under review again (2026-10-08):** the client asked for a reintroduction to be prepared. Nothing is
built before the lawyer answers ([`ANWALTSDOSSIER.md`](./ANWALTSDOSSIER.md) § 22, F-47). A build would be
an exception to the rule that marketing mail needs the one consent (`CLAUDE.md`, „Marketing mail goes
through a campaign“), so it needs the maintainer's decision as well.

## Suppression & "can I send?" logic

- **`isSuppressed(email)`** ([`email-capture-store.ts`](../src/lib/email-capture-store.ts)) — true if
  the address is on `suppression_list`. Every withdrawal — Mo's or Shopify's — writes the list, and a
  newer real subscribe lifts an opt-out row, so the list alone is the truth
  (`email_captures.unsubscribed_at` stays as evidence only). **Fail-closed**: if the database is
  unreachable it returns `true`, so a transient error can never let a send slip past an opt-out.
- **Campaign mails** (every campaign and the Einzelansprache) go through `approveAndSendCampaign`
  ([`campaign-email.ts`](../src/lib/campaign-email.ts)): the campaign must be live, then
  `evaluateCampaignSendGates` ([`campaign-gates.mjs`](../src/lib/campaign-gates.mjs)) in this order:
  master flag `CAMPAIGN_SENDS_APPROVED` → one consent `subscribed` → opt-in level `confirmed_opt_in`
  (unless `CAMPAIGN_ALLOW_SINGLE_OPT_IN=true`) → not suppressed → frequency cap
  (`MARKETING_MIN_SEND_INTERVAL_DAYS`, across both channels). State and level are read fresh from
  `customers` at send time. The full gate table (incl. the Testkontakt exceptions):
  [`CAMPAIGNS.md`](./CAMPAIGNS.md).
- **The legacy 1:1 marketing path** (`approveAndSend`, [`marketing-email.ts`](../src/lib/marketing-email.ts);
  Kunden → Marketing shows it only for a still-open legacy draft) uses **`canSendMarketing(email)`** —
  Mo DOI `confirmed` in `email_captures` and not suppressed — so it can only mail people with a Mo DOI.

Mo's opt-in surfaces never re-pend a suppressed address, and a confirmed Mo DOI survives a later
submit without the marketing tick (only an explicit withdrawal revokes it) — the `decideCaptureDoi`
rules in "End-to-end flow".

## Audit trail (Art. 7)

For each capture we can show, on demand:

- the **exact text** the user saw (`consent_text_shown`) and which canonical copy it was
  (`consent_copy_version`),
- **what** they consented to (`transactional_consent`, `marketing_consent`),
- **when** marketing consent was confirmed (`doi_confirmed_at`) and that it went through a real double
  opt-in (`doi_sent_at` → click → `doi_confirmed_at`),
- **when/whether** they opted out (`unsubscribed_at` + `suppression_list`),
- for the one consent, **every change from either side** in `consent_events` (shown in Kunden →
  Marketing, „Verlauf“): when it happened, source (`mo`, `mo_*`, `shopify`, `admin`, `import`), state, level,
  what carried it (`origin_ref`: capture id, webhook id, …), for Shopify-side acts the shop's
  consent-text version (`text_version`), and a note (e.g. the sign-in proof of an opt-in after
  sign-in). Refused acts (blocked by a complaint or an erasure) are logged with a note.

Shopify does not store the text a customer saw on its surfaces; `SHOPIFY_CONSENT_TEXT_VERSION` is the
best available evidence for those acts.

Retention purges opted-out/suppressed captures after a grace period while keeping the
`suppression_list` row, so we keep honouring the opt-out (see
[`DATA_RETENTION.md`](./DATA_RETENTION.md) "Cluster B").

## Erasure (one deletion with Shopify)

An erasure ends the consent on both sides. `erasePerson` (`src/lib/customer-erasure.ts`, the one
erasure path) deletes every consent record (`email_captures`) and the consent history
(`consent_events`) with the person and keeps the address on `suppression_list` with reason `erasure`,
so it is never mailed or re-imported again. A later **new** subscribe act (newer than the erasure)
lifts that block (resolver rule 1); nothing older can. On the Shopify side an erasure started in Mo
first switches the person's consent off through the outbox (`consent_update` → `unsubscribed`, behind
`SHOPIFY_CONSENT_WRITEBACK`), independently of whether the erasure request itself is passed on.

Owners of the rest: the entry points, the erasure tombstone and the bidirectional table (who starts,
what each side does, which switch sends which outbox row) — [`CUSTOMERS.md`](./CUSTOMERS.md)
"Retention / erasure"; what is deleted, de-identified or retained per table —
[`DATA_RETENTION.md`](./DATA_RETENTION.md) "Complete erasure" (`ERASURE_PLAN` in
`src/lib/customer-erasure-core.mjs`, tested against the migrations).

The served erase copy (`erasurePageCopy`, on `/api/erase-data` and
`GET /api/consent-copy?surface=erase`) names the shop account in its `confirmBody` only while
`SHOPIFY_ERASURE_SYNC` is on; likewise the admin's „Kunde vollständig löschen?“ confirm names the
Shopify deletion only then (otherwise it says the shop-account deletion is queued).

## Measurement (pseudonymous, Cluster A)

The ask → submit → opt-in → DOI-confirm funnel and the consent-popup events are session-keyed
`kpi_events` — no e-mail address in any event (`src/lib/kpi-events.ts`; the widget's events by
contract). The surface (`source`), the
result (`outcome`), the offer `trigger`, the sign-in `placement` / `variant`, whether the widget showed a
reward hint (`reward: true`, widget of 2026-10-08) and the welcome-voucher test's server events
(`consent_ask_eligible`, `consent_copy_served`) live only there, never on the consent record (whether
they belong there: dossier F-38 d, e). Event names and data:
[`frontend/API_CONTRACT.md`](./frontend/API_CONTRACT.md) §5.

## Defensive email handling

All sends go through [`lib/email.ts`](../src/lib/email.ts) (`sendEmail`), which never throws, **reports
every failure** (`reportError`) and returns a discriminated result — failures are never silently lost.
On `/api/capture-email` the DOI mail goes out before the summary; a real summary-send failure answers
`502` (the consent is already stored and a DOI mail that went out stays valid). On all three opt-in routes a DOI-send failure is logged without dropping the
stored `pending` opt-in: the answer is `doiEmailSent: false`, the claim is given back (`doi_sent_at` →
just before the cooldown, or the previous send time of a re-sent link — the link keeps working), and no pending consent act is written, so the next
accept sends at once — also within the resend cooldown (a `skipped` send, below, keeps the claim and records the act). When Resend isn't configured (`RESEND_API_KEY` /
`CONTACT_FROM_EMAIL`) the helper returns a `skipped` result and logs a one-line notice without
recipient or subject (local development), rather than faking success.

---

## Lawyer sign-off status

Where the strings live: `src/lib/consent-copy-core.mjs` (every plain consent / DOI / unsubscribe
string, DE and EN, as keys of `consentStrings()`), `src/lib/consent-variants.mjs` (the sign-in framing
variants and their `benefits`) and `src/lib/consent-copy.ts` (assembles the served payloads; holds the
DOI mail body, the unsubscribe footer, the erase copy and the retired chat gate's `signIn` hint — UI
chrome, never part of `consentTextShown`). Approved: the German v3 set (June 2026) and the v4 additions
incl. the button-consent mechanic (July 2026) — `CONSENT_COPY_LAWYER_APPROVED = true`; English as the
translation (D-AP3, 2026-10-05) — `CONSENT_COPY_EN_LEGAL_REVIEWED = true`. Any wording change needs a
fresh review. The finished checklists (v2–v4, the capture form, the retired welcome discount — a new
reward is under review: dossier § 22, F-39–F-46) are in
[`archive/CONSENT_SIGNOFF_HISTORY.md`](./archive/CONSENT_SIGNOFF_HISTORY.md) §5.

### Customer platform (2026-10) — open, not yet recorded as reviewed

The open items, with the matching question of the lawyer-facing dossier
([`ANWALTSDOSSIER.md`](./ANWALTSDOSSIER.md)) in brackets; `D-n` are the decisions in
[`CUSTOMERS.md`](./CUSTOMERS.md) "Design decisions (customer platform, 2026-10)". The switches named
default to `false` in code; which are on in production: [`ROLLOUT_TODO.md`](./ROLLOUT_TODO.md).

- [ ] **One consent across Shopify and Mo:** the shop's checkout / account / newsletter wording covers
      the same purpose as Mo's marketing label (incl. personalisation from past chats and purchases),
      or references a privacy policy that does; `SHOPIFY_CONSENT_TEXT_VERSION` (a version, no text
      copy) as the evidence for Shopify-side acts, and their opt-in level for every marketing mail
      (`CAMPAIGN_ALLOW_SINGLE_OPT_IN`) (F-29, F-25).
- [ ] **Mo-only subscribers created in Shopify** after their DOI and in the Erstabgleich (D-3,
      `SHOPIFY_CONSENT_WRITEBACK`) (F-24).
- [ ] **Erase copy naming the shop account** (`erasurePageCopy` with `includesShop`, served on
      `/api/erase-data` and `surface=erase`) and the bidirectional erasure itself (D-5,
      `SHOPIFY_ERASURE_SYNC`) (F-26).
- [ ] **A new subscribe after an erasure lifts the erasure block** (resolver rule 1) (F-46 d).
- [ ] **AI profiles without consent** (`CUSTOMER_AI_PROFILE_SCOPE=all`, D-1): Art. 6(1)(f) basis,
      privacy policy, right to object ([`CUSTOMERS.md`](./CUSTOMERS.md)) (F-23).
- [ ] **The Kundenstamm** — every Shopify customer mirrored with order ledger and nightly facts (D-6,
      `SHOPIFY_CUSTOMER_SYNC_ENABLED`): basis, storage duration, privacy policy (F-22).
- [ ] **Mo's insights as Shopify customer tags** (D-11, `SHOPIFY_WRITEBACK_ENABLED`): lifecycle segment,
      value tier, „talked to Mo“ and high churn risk are written as `mo-…` tags to every mirrored
      Shopify customer with computed figures — independent of the marketing consent — and can drive
      Shopify segments, Flow and Shopify Email. An Art. 21 objection to profiling removes every `mo-`
      tag (queued when the objection is recorded; the nightly run adds none while it stands). Open: the
      basis and the privacy-policy wording for the tags (F-28).
- [ ] **Consent-popup benefit bullets as served `benefits`** (variant `a`, v5): wording decided by the
      owner on 2026-10-05 (D-AP4; the choice was delegated to the development): „Angebote, die zu
      deiner Beratung passen“, „Exklusive Rabatt-Aktionen nur für Abonnenten“, „Jederzeit mit einem
      Klick abbestellbar“ (EN as the approved translation, D-AP3). Framing, not part of
      `consentTextShown`; not yet recorded as reviewed by the lawyer (F-38 a).
- [ ] **Every later sign-in framing variant** (`b`, …) needs its own approval before
      `CONSENT_SIGNIN_VARIANTS` lists it — together with the § 25 TDDDG question of assigning variants
      per session id (F-38 b, F-14).
- [ ] **Must the shown framing variant be stored on the consent record** (`email_captures`)? Today it
      is only in the pseudonymous `kpi_events` (deleted after `KPI_RETENTION_DAYS`); answer before a
      second variant is activated (F-38 b).

### Newsletter reward (2026-10-08) — open

Planned, nothing served yet (switches off; task
[`frontend/tasks/OPTIN_REWARD_2026-10-08.md`](./frontend/tasks/OPTIN_REWARD_2026-10-08.md)). The questions
are in the dossier, § 22.

- [ ] **The shop's 5 % welcome code today:** sent by a tool outside Mo, possibly triggered by Mo's DOI
      write-back. Also Mo's line „kein automatisches Willkommensgeschenk“, which the prompt gives only to
      recognised customers (F-39 e).
- [ ] **Reward block as framing outside `consentTextShown`:** badge, one-line terms with a „Bedingungen“
      link, and `afterAccept`. Consent text, footer and DOI stay unchanged. The copy ceiling above („no
      concrete discount amount“) gets an exception for the served reward block only (F-39, F-40).
- [ ] **„bis zu 100 €“ tiers** vs a fixed amount (F-41).
- [ ] **Teaser on the anonymous sign-in surfaces** (login popup, welcome card) (F-42).
- [ ] **Value-moment ask** after a product recommendation (variant `c`) (F-43).
- [ ] **No computed reduced prices** in the chat (PAngV) (F-44).
- [ ] **Neutral DOI mail** (Mo's and Shopify's) and the confirmation page (F-45).
- [ ] **First sign-up only**, the post-erasure hash and alias normalisation (F-46 a–c).
- [ ] **DOI only once** (T2 and C.29, without a switch — live with the deploy of this round):
  - the pending answer within the resend cooldown, and for a shop sign-up still awaiting Shopify's mail;
  - the existing invalid-link page for a link clicked after an unsubscribe or block — an old link no
    longer re-subscribes (F-46 e, f).
- [ ] **Variants `b`/`c` and reward-shown evidence:** must reward, variant and placement be on the consent
      record? (F-38 d, e)
- [ ] **English reward texts:** not covered by D-AP3; no `en` reward until confirmed (F-12).
- [ ] **§ 7 Abs. 3 UWG reintroduction** (F-47; "§7 Abs. 3 UWG Bestandskunden" above).
