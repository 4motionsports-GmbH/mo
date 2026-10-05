# Customers — the central entity (one row per person)

Since migration `0008_customers.sql` the backend has a **customer** entity so
returning users are recognised and their history consolidated; since `0059`
every person who reached Mo has one; since `0061` (the customer mirror)
**every Shopify customer is a `customers` row too**, whether or not they ever
chatted. The customer is the central entity: consent, orders, facts, profile,
conversations, mails, letters and Eingang items all hang off it. This
documents the identity model, the Shopify mirror, the facts, the profile tiers
and objections, erasure, and the GDPR sign-off. The one marketing consent is in
[`CONSENT_FLOW.md`](./CONSENT_FLOW.md); the admin screens (Kunden, Eingang,
Kampagnen) in [`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md).

## Identity model

- **Keys.** `shopify_customer_id` (numeric, unique) is the primary external
  key; `email` (normalised, unique) the fallback and the key for people
  without a shop account. A Shopify customer without an e-mail keeps the
  `shopify:<id>` placeholder (never mailed).
- The localStorage session id is a **per-browser thread id, not a person**. It
  is never used to link anonymous sessions across visits, never fingerprinted,
  never enriched. Sessions without an e-mail or sign-in stay anonymous and
  unlinked.
- **One `customers` row per person, whatever the channel.** A row is created by
  the Shopify mirror (below), by an e-mail capture in the widget (capture form,
  chat consent gate), or by a Customer Account sign-in.
- `customers.source` records where the person first came from (migration
  `0061`):

  | `source` | Meaning |
  | --- | --- |
  | `shopify` | Already a shop customer when Mo first saw them (mirror, sign-in). The legacy values `shopify_account` (sign-in) and `kampagne` (old newsletter sync) were folded into it. |
  | `chat` | First seen in Mo (e-mail capture). A `chat` person who later buys keeps `chat` — the basis for "über Mo gewonnen". |

  The legacy values stay allowed by the CHECK constraint until the
  legacy-drop migration.
- **What the admin shows** (derived, not stored):

  | Label | Rule |
  | --- | --- |
  | Shopify-Kunde | Has a `shopify_customer_id`. |
  | **Interessent** | A Mo contact **without** a Shopify account: chatted with Mo and left an e-mail, no Shopify id (Kunden filter "Interessenten"). |
  | Mit Mo gesprochen | Has at least one conversation (Shopify-Kunde or Interessent). |

  `identity_tier` (1 anonymous / 2 e-mail / 3 signed-in) remains a **session**
  concept for the widget ([`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md)).
- **Two rows, one person.** When Shopify reports an e-mail change onto an
  address an Interessent already uses, or the import finds a Shopify customer
  and an e-mail-only row for the same person, `mergeCustomers`
  (`src/lib/customer-merge-store.ts`) moves every reference to the survivor in
  one transaction (`CUSTOMER_FK_PLAN` in `src/lib/customer-fk-plan.mjs`; its
  test fails when a migration adds a customer FK the plan does not cover) and
  replays the dropped row's consent through the consent resolver.
- `campaign_contacts` are **per-campaign recipients** since `0066` (one row per
  person per campaign and cycle, `customer_id` → the person) — a snapshot for
  the review desk, not an identity or consent record
  ([`CAMPAIGNS.md`](./CAMPAIGNS.md)).

## Kundenstamm — the Shopify customer mirror

`src/lib/shopify-sync.ts` and `src/lib/customer-mirror-store.ts` keep a copy of
the shop's customer base (name, e-mail, locale, country, account state, tags,
created date — no addresses, no phone numbers) and their orders:

| Path | When | Gate |
| --- | --- | --- |
| Bulk import (Shopify bulk operation, resumable step loop) | Einstellungen → Shopify-Abgleich ("Kundenstamm übernehmen"); `/api/cron/shopify-sync` (every 5 min) continues a started import | `SHOPIFY_CUSTOMER_SYNC_ENABLED` |
| Webhooks `customers/create`, `customers/update`, `customers_email_marketing_consent/update`, `orders/create`, `orders/updated`, `orders/paid`, `orders/cancelled` | live | `SHOPIFY_CUSTOMER_SYNC_ENABLED` — while off they are acknowledged without writing (`ignored:sync-off` / `ledger:sync-off`; the order attribution of `orders/create|paid` keeps working). `customers/delete` and the compliance topics are always handled |
| Reconciliation `/api/cron/shopify-reconcile` | nightly 01:45 UTC: customers and orders changed since the last run, then the facts | `SHOPIFY_CUSTOMER_SYNC_ENABLED` (the facts run always) |

Rules of the one write path (`upsertMirrorCustomers`):

1. **Erased people stay out:** Shopify ids with an erasure tombstone, and
   e-mails erased in Mo (unless the Shopify account was created after the
   erasure — a new relationship).
2. Match by Shopify id, then by e-mail (an Interessent who chatted with that
   address gets the Shopify id stamped on), else insert with source `shopify`.
3. A payload older than the stored `shopify_updated_at` changes nothing.
4. An e-mail change onto an Interessent's address merges the two rows.
5. The embedded e-mail-marketing consent goes through the consent resolver —
   never written directly ([`CONSENT_FLOW.md`](./CONSENT_FLOW.md) "The one
   consent").

**Order ledger** (`customer_orders`, migration `0062`): every Shopify order of a
mirrored customer, minimised — ids, dates, statuses, money, discount codes and
line items (handle, variant, title, quantity, unit price). No addresses,
payment data, notes or contact fields. Rows live as long as the customer
(`ON DELETE CASCADE`). The pseudonymous attribution facts in `mo_orders`
(`ORDER_ATTRIBUTION.md`) are separate.

**A Mo-only subscriber becomes a Shopify customer.** When an Interessent
confirms the DOI (or the operator confirms the Erstabgleich), the outbox
creates a Shopify customer with that consent — one subscriber list — while
`SHOPIFY_CONSENT_WRITEBACK=true` ([`CONSENT_FLOW.md`](./CONSENT_FLOW.md)).

> ⚠️ **Retired** (replaced by the mirror + campaign audiences over
> `customer_overview`): `src/lib/campaign-sync.ts`, `campaign-sync-core.mjs`,
> `/api/cron/sync-campaign-audience`, `POST /api/admin/campaign/sync`,
> `src/lib/shopify-customers.ts` (the newsletter-subscriber pull) and the
> audience link `linkCampaignContactsToCustomers`. Shopify newsletter
> subscribers are no longer synced into `campaign_contacts`; their consent is
> the one consent on `customers`.

### Shopify webhook topics (`POST /api/webhooks/shopify`)

Moved from the widget contract (`docs/frontend/API_CONTRACT.md` §11.3); the widget never calls this
route. The `X-Shopify-Hmac-SHA256` signature is verified over the **raw body before it is parsed**
(`verifyShopifyWebhook`, `src/lib/shopify-webhook.mjs`) against `SHOPIFY_WEBHOOK_SECRET`
(subscriptions made in the Shopify admin) or `SHOPIFY_CLIENT_SECRET` (subscriptions made by the app,
including the compliance topics). No secret configured → `503`; bad or missing signature → `401`, body
never used. Registration: [`CATALOG_SYNC.md`](./CATALOG_SYNC.md) "Real-time stock webhook".

| Topic (`X-Shopify-Topic`) | Effect |
| --- | --- |
| `products/*`, `inventory_levels/*` | Targeted single-product catalog refresh ([`CATALOG_SYNC.md`](./CATALOG_SYNC.md)). |
| `customers/create`, `customers/update` | Upsert the customer mirror; the embedded e-mail-marketing consent goes through the consent resolver. |
| `customers_email_marketing_consent/update` | Consent resolver only (Shopify-side subscribe / unsubscribe). Unknown customers are left to the reconciliation. |
| `orders/create`, `orders/updated`, `orders/paid`, `orders/cancelled` | Order ledger (`customer_orders`). `orders/create` and `orders/paid` also feed the pseudonymous order attribution (`mo_orders`, [`ORDER_ATTRIBUTION.md`](./ORDER_ATTRIBUTION.md)); a marked order that cannot be attributed is counted on `orders/create` as the session-less event `mo_order_marker_unresolved`. Other `orders/*` topics are acknowledged and ignored. |
| `customers/delete`, `customers/redact` | The one erasure in Mo (trigger `shopify`: Shopify is not asked again). More than `SHOPIFY_ERASURE_ALERT_PER_HOUR` (default 20) in an hour raises an alert and an Eingang item. |
| `customers/data_request` | An Eingang item `datenauskunft` (deadline 30 days) for the operator to answer with the data export. |
| `shop/redact` | Alert + Eingang item only — never an automatic mass deletion. |
| `bulk_operations/finish` | Acknowledged; the import's next step polls the bulk operation itself. |

While `SHOPIFY_CUSTOMER_SYNC_ENABLED` is off, the customer, consent and order-ledger topics are
acknowledged without writing (`ignored:sync-off` / `ledger:sync-off`); the attribution of
`orders/create|paid` and the erasure and compliance topics are not gated. All customer, consent, order
and compliance topics are de-duplicated by `X-Shopify-Webhook-Id` (a Shopify retry answers
`{ "ok": true, "duplicate": true }`). A processing failure answers `500` and forgets the delivery id,
so Shopify's retry is applied. The nightly `/api/cron/shopify-reconcile` catches whatever a webhook
missed.

## Linking rule (e-mail capture)

On every e-mail capture (`/api/capture-email`, `/api/chat-marketing-opt-in`,
`/api/account/marketing-opt-in` → `linkCustomerOnEmailCapture()` in
[`src/lib/customer-store.ts`](../src/lib/customer-store.ts)):

1. **Find-or-create** the customer for the normalised email. An existing
   customer — including a mirrored Shopify customer with that address — means a
   returning visit: `last_seen_at` is bumped, `first_seen_at` stays.
2. **Attach the current conversation** (`conversations.customer_id`) and the
   session (`customer_session_links`).
3. **Mirror the transactional consent** (the summary request) from
   `email_captures`. The marketing consent is **not** copied from the capture
   any more: the opt-in is reported to the one consent (`src/lib/consent-flows.ts`
   — `pending` until the DOI click), and `email_captures` stays the Art. 7
   evidence.

Linking is best-effort: a failure never blocks the capture/summary/DOI flow.

## Facts for everyone (`customer_facts`)

Deterministic figures per customer, zero tokens (`src/lib/customer-facts-core.mjs`,
pure and tested; migration `0063`): orders, spend, average order value, order
intervals and the next expected order, lifecycle segment, value tier, RFM
scores, churn risk, bought categories and complement candidates, Mo
conversations, marketing sends and clicks, unanswered mails. Recomputed by
`/api/cron/shopify-reconcile` (dirty customers first, then everyone older than
a day — the segment moves with the calendar) and after the bulk import. The
view `customer_overview` (migration `0068`) joins customers, facts, consent and
the block state; it is the one base for the Kunden list and the campaign
audiences.

## The central customer profile

Every customer can have one AI profile: the single place where everything we
know about the person is condensed. It has two parts, both written by one AI
pass (`generateCustomerProfile` in `src/lib/customer-profile.ts`):

| Column | Content |
| --- | --- |
| `profile_summary` (+`_updated_at`) | The readable "current understanding" (Markdown). |
| `profile_data` (jsonb) | Structured facts: `persona` (archetype), `level` (einsteiger / fortgeschritten / profi / unbekannt), `budget` (niedrig / mittel / hoch / unbekannt), `goals`, `owned`, `interests`, `nextSteps` (≤ 8 short items each; normalised by `src/lib/customer-profile-core.mjs`). |
| `persona_label` | The persona, denormalised for list filters and badges. |
| `profile_depth` | `voll` or `kauf` — which tier wrote it (below). |
| `profile_checked_at` | When upkeep last looked at the customer (also set when there was nothing to profile). |

**Profile tiers** ("Profiltiefe", migration `0061`):

| Tier | Who | Inputs | Model | Nightly batch |
| --- | --- | --- | --- | --- |
| **Vollprofil** | People with a Mo chat or correspondence | Chat transcripts, purchases, correspondence, campaign history | deep tier | `CUSTOMER_PROFILE_BATCH` (default 30, `0` off) |
| **Kaufprofil** | Shopify customers with orders but no chat | Purchases + campaign reactions | writer tier (cheaper) | `CUSTOMER_PROFILE_LIGHT_BATCH` (default `0` = off) |
| (no AI profile) | Everyone else, and anyone the scope or an objection excludes | the facts above only | none | — |

Purchases come from the order ledger for mirrored people (`loadPurchaseHistory`
in `src/lib/customer-orders-store.ts`), else from the cached per-e-mail
`purchase_summary`.

**Who gets a profile** (`mayBuildAiProfile` in `src/lib/platform-flags.mjs`):
`CUSTOMER_AI_PROFILE_SCOPE` = `consented` (default — only people whose one
consent is `subscribed`) or `all` (everyone). The maintainer decided `all` for
this shop (lawyer to confirm, `CONSENT_FLOW.md` sign-off list; the code
default stays `consented`): profiles of people without consent are built but
**flagged** in Kunden ("Keine Einwilligung für E-Mail-Werbung — nur ansehen"),
and every marketing action on them stays blocked by the send gates.

**Objections (Art. 21 GDPR)** — recorded by the operator when the person tells
us (`POST /api/admin/customers/objection`, `setCustomerObjection`):

| Column | Effect | Where |
| --- | --- | --- |
| `profile_objection_at` | The stored profile is deleted at once and none is built or used again — it always wins over the scope. | Kunden → Überblick ("Widerspruch gegen Profilbildung") |
| `postal_objection_at` | No advertising letters; the letter draft is cleared. Campaign letters of the person are excluded at the next audience refresh and refused at send (`CAMPAIGNS.md` §8); the stored address is kept. | Kunden → Brief |

**One path writes it:** `regenerateCustomerProfile(customerId)` — used by the
nightly upkeep, the "Neu generieren" button (`POST /api/admin/customers/profile`)
and the Analyse report. The profile is regenerated fresh each time, never
merged mechanically — contradictions resolve toward the newer statement.

**Kept current automatically.** `/api/cron/refresh-customers` (daily 02:00)
first refreshes the per-e-mail Shopify data of people the mirror does not
cover, then runs `runProfileUpkeep` per tier: customers whose last activity
(chat, correspondence, campaign send, order) is newer than their profile — or
who have never been checked — are regenerated within the batch sizes above.
Customers with nothing to profile are only marked checked, so they cost
nothing. For the first fill run `npm run profiles:backfill` (loops the
deployed cron with `?only=profiles` until nothing is left).

**Who reads it** (`profileForPrompt` / `profileFactsBlock` in the core,
`customerProfileForPrompt` in TS):

| Component | Use |
| --- | --- |
| Live chat (`customer-memory.ts` → system prompt) | "Profil auf einen Blick" block + readable profile for a re-identified, consented customer. |
| Kampagne drafts (`campaign-draft.ts`) | "Kundenverständnis" section: the text speaks to the person's goals and level instead of generic purchase lists. |
| Kampagne recommendations (`campaign-recommendations.ts`) | Similarity picks are ranked 60 % purchase + 40 % profile similarity; winback picks and contacts without a purchase signal are ranked by the profile alone (accessory picks unchanged). |
| Summary mail (`summary-email.ts`) | Returning customers' mailed summary builds on the profile. |
| Marketing / Kampagne hero images (`email-hero.ts`) | Profile as art-direction context. |
| Bundle suggestions, letter drafts, marketing drafts | `profileSummary` in the generator prompt. |
| Admin | Kunden → Überblick (facts + profile text, depth badge), persona filter/badges. |

`purchase_summary` (+`_updated_at`) stays the per-e-mail Shopify order-history
cache (`fetchOrderHistoryByEmail`, or the Customer Account API for signed-in
customers) for people the mirror does not cover; `refresh-customers` no longer
refreshes it for mirrored customers.

## Welcome discount (historical, recorded here) — ⚠️ feature retired

The automatic welcome-discount feature was **retired pre-launch** (client
decision: too exploitable via alias emails — codes are issued manually via the
dashboard instead). The minting/issuance code and the `WELCOME_DISCOUNT_*` env
flags are gone; the migration `0009_welcome_discount.sql` columns
(`welcome_code`, `welcome_code_gid`, `welcome_code_expires_at`,
`welcome_issued_at`) are **retained as READ-ONLY historical data** — never
written again — and back the dashboard's historical view of codes that were
issued while the feature was live. GDPR erasure of the customer row removes
this historical welcome record with it (the suppression list keeps honouring
opt-outs as before).

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
   only after a successful `/api/capture-email` (or chat-gate opt-in) **in the
   current chat session**, keeping that state in memory only
   (`API_CONTRACT.md` §2).
2. **Server-side verification** — `resolveCustomerMemory()` checks the email's
   consent record was captured **from this very session id**
   (`wasEmailCapturedFromSession`, fail-closed). A forged request body naming
   someone else's address resolves nothing.

What gets injected (compact, never raw transcripts): the structured profile
facts ("Profil auf einen Blick"), the cached `profile_summary` ("current
understanding"), owned items + quantities from the
cached `purchase_summary`, the prior-consultation count, and first-seen date.
The prompt block instructs Mo to acknowledge the return lightly (once, warm,
never exhaustive), not to re-recommend owned products (suggest complements
instead), to let today's statements override the memory, and that **no
existing rule is weakened** — sold-out, checkout, B2B, and tool behaviour all
apply unchanged.

A **new email** (customer just created, no prior conversations, no cached
summaries) resolves to no memory — the chat behaves exactly as before. Another
customer's data is unreachable by construction: the lookup is keyed strictly
by the email the user just provided in this session. Signed-in (tier-3)
customers are re-identified by their authenticated session instead
([`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §8).

## Retention / erasure

**One erasure path for every way to delete:** `erasePerson()` in
[`src/lib/customer-erasure.ts`](../src/lib/customer-erasure.ts). It is used by

- the **widget button** "Meine Daten löschen" (signed-in customer,
  `/api/account/erase` → `eraseSignedInCustomer`),
- the **mail-footer link** "Daten löschen" in every marketing and Kampagne mail
  (`/api/erase-data?token=…`: GET shows a confirmation page, POST erases — so
  link scanners never delete anything; the token is purpose-bound and cannot
  be swapped with an unsubscribe token),
- the admin **"Löschen"** button in Kunden (customer) and Kampagne (contact)
  (`POST /api/admin/customers/erase`, confirmed, audit-logged as
  `customer.erase` with the numeric id only),
- **Shopify**: the webhooks `customers/redact` and `customers/delete` (trigger
  `shopify` — Shopify is not asked again).

It resolves every address, Kampagne contact, conversation and session of the
person and removes them in **one transaction**: customer + profile, all chats
(all devices), consent records and the consent history (`consent_events`),
marketing + Kampagne drafts and sends, the Kampagne contacts, correspondence,
letters (posted letters and campaign letters, `campaign_letters`), feedback, KPI events, attribution tokens, sign-in state, usage rows,
Eingang items, the facts and the person's section in stored Analyse reports.
**Mo's copy of the person's Shopify orders (`customer_orders`) is deleted with
them** (cascade, plus an explicit delete by Shopify id for rows not yet linked);
only the pseudonymous attribution rows in `mo_orders` stay for the revenue
KPIs, with session id and token removed. Open Shopify outbox rows for the
person are dropped. The hero images in Blob storage are deleted afterwards.
The address is put on the **suppression list with reason `erasure`**, so it is
never mailed again and no import re-creates it from Shopify.

**Bidirectional with Shopify** (migration `0065`):

| Started in | Mo | Shopify |
| --- | --- | --- |
| Mo (widget, mail link, admin) | deletes at once; writes an **erasure tombstone** for the Shopify id (no import, reconciliation or webhook re-creates the person) | one `data_erasure` outbox row: consent off, then `customerRequestDataErasure` — sent only while `SHOPIFY_ERASURE_SYNC=true` (default `false`; the row waits). Shopify keeps its own orders as long as the law requires. |
| Shopify (`customers/redact`, `customers/delete`) | the same deletion; tombstone confirmed | already erasing — not asked again |
| Shopify `customers/data_request` | an Eingang item `datenauskunft` (deadline 30 days); answer with the data export | — |

A person without a Shopify id (an Interessent) is erased in Mo only. More than
`SHOPIFY_ERASURE_ALERT_PER_HOUR` (default 20) Shopify-started erasures in an
hour raise an error report and an Eingang item — processing continues. The
erasure tombstones currently have no purge step.

**`shop/redact`** (Shopify requests deletion of all shop data; it arrives
about 48 hours after the app is uninstalled) **never** triggers an automatic
mass deletion: Mo reports an error and opens an Eingang item "Shopify meldet
shop/redact" (priority 100) that points here. Manual procedure:

1. Check in the Shopify admin whether the app really was uninstalled.
2. Still (or again) installed, or the event is unexpected → nothing is
   deleted; investigate where the delivery came from and close the item.
3. The shop has really left → the maintainer and the shop owner decide on
   deleting the shop's data in Mo. There is deliberately no automatic or
   one-click path for this.

The table-by-table plan is `ERASURE_PLAN` in
`src/lib/customer-erasure-core.mjs`. Its test parses every migration and
**fails when a table with personal data has no erasure decision** — a new
table cannot silently escape deletion.

The customer's data export (`/api/account/export`) contains the profile,
consent records and the consent history, conversations, correspondence,
letters, marketing sends, bundle offers, feedback, the order ledger, the facts,
campaign participation, sends and letters (also unsent letter drafts, 0074), and the suppression
status.

**Retention:** the job ([`src/lib/retention.ts`](../src/lib/retention.ts))
purges opted-out customer rows after the capture grace period and inactive
customer rows whose one consent is neither `subscribed` nor `pending` — but
**never a Shopify customer** (a row with a `shopify_customer_id`: the mirror
follows Shopify, and Shopify's own deletion removes them via
`customers/redact`). See [`DATA_RETENTION.md`](./DATA_RETENTION.md).

## ✅ GDPR: profile building — LAWYER-APPROVED

> **Lawyer-approved (June 2026); `CONSENT_COPY_LAWYER_APPROVED = true`.**
> Personalisation is live. Building a **durable customer profile from past chat
> interactions and Shopify purchase history** was reviewed against the consent
> copy + privacy policy and signed off. Recorded here for the audit trail:
>
> - [x] The **privacy policy** explicitly covers "profile building from past
>       interactions and purchases" (purpose, lawful basis, storage duration,
>       right to object/erasure).
> - [x] The **marketing consent checkbox text**
>       (`MARKETING_CHECKBOX_LABEL` in `src/lib/consent-copy.ts`) covers
>       personalisation based on **past** conversations and **purchase history**,
>       not only the current chat.
> - [x] Linking the Shopify **order history** (a separate data source) into the
>       chat-derived profile is disclosed.
> - [x] Whether the regenerated profile constitutes **profiling** under
>       Art. 22 / requires a DPIA entry — assessed during the review.
> - [x] **Customer memory in the live chat** (section above): prior chat
>       interactions + purchase history shape the **live consultation** for a
>       re-identified returning customer. This personalisation purpose is within
>       the lawyer-approved consent scope / privacy policy.
> - [x] **Signed-in (tier-3) customers** (see
>       [`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §8): for a signed-in
>       customer the **name, addresses and full order history** are pulled from
>       the Shopify **Customer Account API** and feed the profile + live chat via
>       this same mechanism. Re-identification is the authenticated session, but
>       the **personalisation consent requirement is unchanged**: history /
>       profile / address are gated on `canPersonaliseSignedIn`
>       (`CONSENT_COPY_LAWYER_APPROVED` **and** the one consent —
>       `marketing_status = 'confirmed'`, i.e. `email_consent_state =
>       'subscribed'`, given in Mo or in the shop),
>       so a non-consented signed-in user gets **only** the authenticated
>       greeting-by-name and no personalised data. This gate matches the
>       intended lawful basis.
>
> With the sign-off in place, the Kunden tab's profile generation AND the
> in-chat customer memory (tier 2 **and** tier 3) are live for real users
> (`CONSENT_COPY_LAWYER_APPROVED` in `src/lib/consent-copy.ts` is `true`). The
> runtime gate still fail-closes per user: no personalised chat data unless that
> user's one consent is `subscribed`. Cross-referenced in the lawyer checklist
> in [`CONSENT_FLOW.md`](./CONSENT_FLOW.md).
>
> **Open (2026-10, not yet recorded as reviewed):** AI profiles for customers
> **without** consent (`CUSTOMER_AI_PROFILE_SCOPE=all`, Art. 6(1)(f) with the
> right to object above), the mirror of all Shopify customers with their order
> ledger, and the bidirectional consent and erasure — listed in
> [`CONSENT_FLOW.md`](./CONSENT_FLOW.md) "Customer platform (2026-10)".

## What deliberately did NOT change

- `email_captures` remains the Art. 7 evidence for consents given on Mo's
  surfaces. The **state** of the marketing consent is no longer split between
  Mo and Shopify: it is the one consent on `customers` (+ `consent_events`),
  shared with Shopify in both directions.
- Anonymous (no-email) sessions remain exactly as pseudonymous and unlinked as
  before.
- Signing in establishes identity, never marketing consent.
