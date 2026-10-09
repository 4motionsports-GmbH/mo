# Customers — the central entity (one row per person)

Since migration `0008_customers.sql` the backend has a **customer** entity so
returning users are recognised and their history consolidated; since `0059`
every person who reached Mo has one; since `0061` (the customer mirror)
**every Shopify customer is a `customers` row too**, whether or not they ever
chatted. The customer is the central entity: consent, orders, facts, profile,
conversations, mails, letters and Eingang items all hang off it. This
documents the identity model, the Shopify mirror and its webhooks, the facts,
the profile tiers and objections, the in-chat memory, erasure with Shopify, and
the design decisions of the customer platform. The one marketing consent is in
[`CONSENT_FLOW.md`](./CONSENT_FLOW.md); the admin screens (Kunden, Eingang,
Kampagnen) in [`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md); column detail in
[`DATABASE.md`](./DATABASE.md); windows and the erasure inventory in
[`DATA_RETENTION.md`](./DATA_RETENTION.md).

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
  the Shopify mirror (below), by an e-mail capture (capture form, signed-in
  opt-in, the chat opt-in route — "Linking rule"), by a Customer Account
  sign-in, or as an Interessent without consent for someone who wrote to the
  shop (contact form, „Als Interessent anlegen“ in the Eingang —
  `findOrCreateProspect`).
- **How a session is linked** (`customer_session_links`): a typed e-mail writes
  `link_kind = 'email'` and never counts as signed in; a sign-in
  (`customer_account`, `app_proxy`) links a session only when that widget
  redeems a one-time code (`customer_link_grants`, migration `0073`), never a
  session id taken from a URL; logout ends every signed-in link of the
  customer. Details: [`DATABASE.md`](./DATABASE.md) „The customer entity“ and
  [`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §4 „The signed-in resolver“.
- `customers.source` records where the person first came from (migration
  `0061`):

  | `source` | Meaning |
  | --- | --- |
  | `shopify` | Already a shop customer when Mo first saw them (mirror, sign-in). The legacy values `shopify_account` (sign-in) and `kampagne` (old newsletter sync) were folded into it. |
  | `chat` | First seen in Mo (e-mail capture). A `chat` person who later buys keeps `chat` — the basis for "über Mo gewonnen". |

  The legacy values stay allowed by the CHECK constraint (the legacy-drop
  migration is not built).
- **What the admin shows** (derived, not stored):

  | Label | Rule |
  | --- | --- |
  | Shopify-Kunde | Has a `shopify_customer_id`. |
  | **Interessent** | A Mo contact **without** a Shopify account: left an e-mail with Mo or wrote to the shop, no Shopify id (Kunden filter "Interessenten"). |
  | Mit Mo gesprochen | Has at least one conversation (Shopify-Kunde or Interessent). |

  `customers.identity_tier` (1 anonymous / 2 e-mail / 3 signed-in) records the
  strongest identification seen and never goes down; whether a **session**
  counts as signed in is decided per session by its link
  ([`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §1).
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
| Bulk import (Shopify bulk operation, resumable step loop) | Einstellungen → Shopify-Abgleich („Kundenstamm übernehmen“); `/api/cron/shopify-sync` (every 5 min) continues a started import | `SHOPIFY_CUSTOMER_SYNC_ENABLED` (default `false`) |
| Webhooks (customer, consent and order topics — see "Shopify webhook topics" below) | live | `SHOPIFY_CUSTOMER_SYNC_ENABLED` for the mirror and ledger writes; erasure and compliance topics are never gated |
| Reconciliation `/api/cron/shopify-reconcile` | nightly 01:45 UTC: customers and orders changed since the last complete run, then the facts | `SHOPIFY_CUSTOMER_SYNC_ENABLED` (the facts run always) |

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
mirrored customer, minimised — ids, dates, statuses, money, discount codes,
line items (handle, variant, title, quantity, unit price) and the date of the
last notable refund (`last_refund_at`, `0070`). No addresses, payment data,
notes or contact fields. Rows live as long as the customer
(`ON DELETE CASCADE`). The pseudonymous attribution facts in `mo_orders`
([`ORDER_ATTRIBUTION.md`](./ORDER_ATTRIBUTION.md)) are separate.

Mo-only subscribers become Shopify customers through the outbox (D-3 below;
mechanics and the Erstabgleich: [`CONSENT_FLOW.md`](./CONSENT_FLOW.md) "The one
consent"). The former Shopify newsletter sync into `campaign_contacts` is
retired: [`CAMPAIGNS.md`](./CAMPAIGNS.md) §1, history in
[`archive/CAMPAIGNS_HISTORY_2026-10.md`](./archive/CAMPAIGNS_HISTORY_2026-10.md).

### Shopify webhook topics (`POST /api/webhooks/shopify`)

Shopify → backend only; the widget never calls this route
([`frontend/API_CONTRACT.md`](./frontend/API_CONTRACT.md) §11.3 points here). The
`X-Shopify-Hmac-SHA256` signature is verified over the **raw body before it is
parsed** (`verifyShopifyWebhook`, `src/lib/shopify-webhook.mjs`) against
`SHOPIFY_WEBHOOK_SECRET` (subscriptions made in the Shopify admin) or
`SHOPIFY_CLIENT_SECRET` (subscriptions made by the app, including the
compliance topics). No secret configured → `503`; bad or missing signature →
`401`, body never used. Registration (script, compliance topics, signing keys):
[`CATALOG_SYNC.md`](./CATALOG_SYNC.md) "Shopify-side registration (setup step)";
the catalog path (targeted refresh, backpressure): [`CATALOG_SYNC.md`](./CATALOG_SYNC.md)
"Real-time stock webhook".

| Topic (`X-Shopify-Topic`) | Effect |
| --- | --- |
| `products/*`, `inventory_levels/*` | Targeted single-product catalog refresh ([`CATALOG_SYNC.md`](./CATALOG_SYNC.md)). |
| `customers/create`, `customers/update` | Upsert the customer mirror; the embedded e-mail-marketing consent goes through the consent resolver. When two deliveries insert the same new person at once, the loser applies its consent (and a newer identity) to the winner's row (outcome `raced`, since 2026-10-08). |
| `customers_email_marketing_consent/update` | Consent resolver (Shopify-side subscribe / unsubscribe / sign-up pending). Since 2026-10-08 (C.29) a customer not mirrored yet is imported inline first — one Admin read of the mirror's fields (≤ 2 s, skipped while the throttle gate is up), else a minimal row from the payload (id, e-mail; the next `customers/*` delivery or the reconciliation fills in the rest) — and then gets the consent; erased people stay out (`ignored:erased`). When the minimal row hits an address erased in Mo and the Admin read had failed (timeout, throttle, error), it cannot tell a new account on that address from the erased one: the delivery answers 500 (`deferred:erased-unverified(<status>)`, forgotten like any failed delivery) and Shopify's redelivery reads again. Outcome `consent:<outcome>`, plus `:imported` or `:imported-payload(<why>)`; `ignored:unknown-customer` only when the address belongs to another row (the reconciliation imports it). |
| `orders/create`, `orders/updated`, `orders/paid`, `orders/cancelled` | Order ledger (`customer_orders`). `orders/create` and `orders/paid` also feed the pseudonymous order attribution (`mo_orders`, [`ORDER_ATTRIBUTION.md`](./ORDER_ATTRIBUTION.md)); a marked order that cannot be attributed is counted on `orders/create` as the session-less event `mo_order_marker_unresolved`. Other `orders/*` topics are acknowledged and ignored. |
| `customers/delete`, `customers/redact` | The one erasure in Mo (trigger `shopify`: Shopify is not asked again). More than `SHOPIFY_ERASURE_ALERT_PER_HOUR` (default 20, `0` off) in an hour raises an alert and an Eingang item. |
| `customers/data_request` | An Eingang item `datenauskunft` (deadline 30 days), see "Retention / erasure". |
| `shop/redact` | Alert + Eingang item only — never an automatic mass deletion (procedure below). |
| `bulk_operations/finish` | Acknowledged; the import's next step polls the bulk operation itself. |

The compliance topics (`customers/redact`, `customers/data_request`,
`shop/redact`) arrive only once the app configuration subscribes them — see
"Retention / erasure". While `SHOPIFY_CUSTOMER_SYNC_ENABLED` is off, the
customer, consent and order-ledger topics are acknowledged without writing
(`ignored:sync-off` / `ledger:sync-off`); the attribution of
`orders/create|paid` and the erasure and compliance topics are not gated. All
customer, consent, order, erasure, compliance and bulk topics are
de-duplicated by `X-Shopify-Webhook-Id` (a Shopify retry answers
`{ "ok": true, "duplicate": true }`). A processing failure answers `500` and
forgets the delivery id, so Shopify's retry is applied. The nightly
`/api/cron/shopify-reconcile` catches whatever a webhook missed.

## Linking rule (e-mail capture)

On every e-mail capture (`/api/capture-email`, `/api/chat-marketing-opt-in`,
`/api/account/marketing-opt-in` → `linkCustomerOnEmailCapture()` in
[`src/lib/customer-store.ts`](../src/lib/customer-store.ts)):

1. **Find-or-create** the customer for the normalised email. An existing
   customer — including a mirrored Shopify customer with that address — means a
   returning visit: `last_seen_at` is bumped, `first_seen_at` stays.
2. **Attach** the capture (`email_captures.customer_id`), the session's
   conversations (`conversations.customer_id`) and the session
   (`customer_session_links`, `link_kind = 'email'`). Conversations without an
   owner follow the capture; a correction of the session's earlier typed e-mail
   takes that address's conversations along (latest capture wins). A
   conversation of a person the session was **signed in** as stays theirs: the
   typed address of someone else ends the sign-in, nothing more (C.27; rule:
   `captureMovesConversationsFrom` in `customer-session-link.mjs`, tested;
   details: [`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §4).
3. **Mirror the transactional consent** (the summary request) from
   `email_captures`. The marketing consent is **not** copied from the capture:
   the opt-in is reported to the one consent (`src/lib/consent-flows.ts` —
   `pending` until the DOI click), and `email_captures` stays the Art. 7
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
| `profile_data` (jsonb) | Structured facts: `persona` (archetype), `level` (einsteiger / fortgeschritten / profi / unbekannt), `budget` (niedrig / mittel / hoch / unbekannt), `goals` (the current main goal first), `owned`, `interests`, `nextSteps` (the most urgent first) (≤ 8 short items each; normalised by `src/lib/customer-profile-core.mjs`). |
| `persona_label` | The persona, denormalised for list filters and badges. |
| `profile_depth` | `voll` or `kauf` — which tier wrote it (below). |
| `profile_checked_at` | When upkeep last looked at the customer (also set when there was nothing to profile). |

**Profile tiers** ("Profiltiefe", migration `0061`; the Kunden badge reads
„Vollprofil“ / „Kaufprofil“):

| Tier | Who | Inputs | Model | Nightly batch |
| --- | --- | --- | --- | --- |
| **Vollprofil** | People with a Mo chat or correspondence | Chat transcripts, purchases, correspondence, campaign history | deep tier ([`AI_MODELS.md`](./AI_MODELS.md)) | `CUSTOMER_PROFILE_BATCH` (default 30, `0` off) |
| **Kaufprofil** | Shopify customers with orders but no chat | Purchases + campaign reactions | writer tier (cheaper) | `CUSTOMER_PROFILE_LIGHT_BATCH` (default `0` = off) |
| (no AI profile) | Everyone else, and anyone the scope or an objection excludes | the facts above only | none | — |

Purchases come from the order ledger for mirrored people (`loadPurchaseHistory`
in `src/lib/customer-orders-store.ts`), else from the cached per-e-mail
`purchase_summary`.

**Who gets a profile** (`mayBuildAiProfile` in `src/lib/platform-flags.mjs`):
`CUSTOMER_AI_PROFILE_SCOPE` = `consented` (default — only people whose one
consent is `subscribed`) or `all` (everyone). The maintainer decided `all` for
this shop (D-1; lawyer to confirm, `CONSENT_FLOW.md` sign-off list; the code
default stays `consented`): profiles of people without consent are built but
**flagged** in Kunden ("Keine Einwilligung für E-Mail-Werbung — nur ansehen"),
and every marketing action on them stays blocked by the send gates.

**Objections (Art. 21 GDPR)** — recorded by the operator when the person tells
us (`POST /api/admin/customers/objection`, `setCustomerObjection`):

| Column | Effect | Where |
| --- | --- | --- |
| `profile_objection_at` | The stored profile is deleted at once and none is built or used again — it always wins over the scope. The `mo-` insight tags in Shopify are removed too (D-11). | Kunden → Überblick ("Widerspruch gegen Profilbildung") |
| `postal_objection_at` | No advertising letters; the letter draft is cleared. Campaign letters of the person are excluded at the next audience refresh and refused at send (`CAMPAIGNS.md` §8); the stored address is kept. | Kunden → Brief |

**One path writes it:** `regenerateCustomerProfile(customerId)` — used by the
nightly upkeep, the Kunden button („Kundenverständnis generieren“ / „Neu
generieren“, `POST /api/admin/customers/profile`) and the Analyse report. The
profile is regenerated fresh each time, never merged mechanically —
contradictions resolve toward the newer statement.

**Kept current automatically.** `/api/cron/refresh-customers` (daily 02:00 UTC)
first refreshes the per-e-mail Shopify data of people the mirror does not
cover, then runs `runProfileUpkeep` per tier: customers whose last activity
(chat, correspondence, campaign send, order) is newer than their profile — or
who have never been checked — are regenerated within the batch sizes above.
Customers with nothing to profile are only marked checked, so they cost
nothing. To fill many profiles at once run `npm run profiles:backfill` (loops
the deployed cron with `?only=profiles` until nothing is left).

**Who reads it** (`profileForPrompt` / `profileFactsBlock` in the core,
`customerProfileForPrompt` in TS):

| Component | Use |
| --- | --- |
| Live chat (`customer-memory.ts` → system prompt) | "Profil auf einen Blick" block + readable profile for a re-identified customer (gate: "Customer memory in the live chat"). |
| Kampagne drafts (`campaign-draft.ts`) | "Kundenverständnis" section: the text speaks to the person's goals and level instead of generic purchase lists. |
| Kampagne recommendations (`campaign-recommendations.ts`) | Similarity picks are ranked 60 % purchase + 40 % profile similarity; winback picks and contacts without a purchase signal are ranked by the profile alone (accessory picks unchanged). |
| Summary mail (`summary-email.ts`) | Returning customers' mailed summary builds on the profile. |
| Marketing / Kampagne hero images (`email-hero.ts`) | Profile as art-direction context. |
| Bundle suggestions, letter drafts, marketing drafts | `profileSummary` in the generator prompt. |
| Eingang suggestions (`inbox-suggest.ts`), e-mail reply drafts (`inbox-mail.ts`), „Frag Mo“ (`customer-ask.ts`) | Profile as context; left out while a profile objection stands. |
| Admin | Kunden → Überblick: the profile card first — persona, depth, freshness, one card per theme with the structured fields and the matching part of the text ([`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §3.3); persona filter/badges. |

`purchase_summary` (+`_updated_at`) stays the per-e-mail Shopify order-history
cache (`fetchOrderHistoryByEmail`, or the Customer Account API for signed-in
customers) for people the mirror does not cover; `refresh-customers` does not
refresh it for mirrored customers.

## Welcome discount (retired)

The automatic welcome discount was retired before launch (client decision: too
exploitable via alias e-mails); no code mints welcome codes and the
`WELCOME_DISCOUNT_*` flags are gone. The migration `0009` columns
(`welcome_code`, `welcome_code_gid`, `welcome_code_expires_at`,
`welcome_issued_at`) stay on `customers`, read-only and never written; the only
reader is the chat memory (`welcome_issued_at` set → Mo is told to promise no
welcome discount). No admin view shows them. They go with the customer row on
erasure. Discount codes today: [`DISCOUNTS.md`](./DISCOUNTS.md). Separately, a
Shopify-side tool (not Mo, not the theme) mails a 5 % welcome code to shop
newsletter sign-ups; finding it is task T1 of
[`frontend/tasks/OPTIN_REWARD_2026-10-08.md`](./frontend/tasks/OPTIN_REWARD_2026-10-08.md),
and a new reward on the chat's consent ask is under legal review
([`ANWALTSDOSSIER.md`](./ANWALTSDOSSIER.md) § 22).

## Customer memory in the live chat (in-session re-identification ONLY)

Mo can use a returning customer's history to tailor the **live consultation**
— under a strict privacy gate
([`src/lib/customer-memory.ts`](../src/lib/customer-memory.ts)):

> **A returning customer opens a new chat as ANONYMOUS.** The localStorage
> session id is a browser thread id, not a person — on a shared/family/public
> device it can carry someone else's past capture. So no past history is ever
> surfaced at chat start, and the session id alone never unlocks memory.

For an e-mail-identified (tier-2) customer, memory is injected into the system
prompt only when **both** hold:

1. **In-session claim** — the widget attaches `customer.email` to `/api/chat`
   only after a successful `/api/capture-email` (or `/api/chat-marketing-opt-in`)
   **in the current chat session**, keeping that state in memory only
   ([`frontend/API_CONTRACT.md`](./frontend/API_CONTRACT.md) §2).
2. **Server-side verification** — `resolveCustomerMemory()` checks that a
   capture of this e-mail was recorded **from this very session id**
   (`wasEmailCapturedFromSession`, fail-closed). A forged request body naming
   someone else's address resolves nothing. The check is the capture itself
   (a summary-only capture counts); there is no separate marketing-consent
   check on this path.

What gets injected (compact, never raw transcripts): the structured profile
facts ("Profil auf einen Blick"), the cached `profile_summary` ("current
understanding"), owned items + quantities (from `loadPurchaseHistory`: the
order ledger for mirrored people, else the cached `purchase_summary`), the
prior-consultation count, and first-seen date. The prompt block instructs Mo
to acknowledge the return lightly (once, warm, never exhaustive), not to
re-recommend owned products (suggest complements instead), to let today's
statements override the memory, and that **no existing rule is weakened** —
sold-out, checkout, B2B, and tool behaviour all apply unchanged.

A **new email** (customer just created, no prior conversations, no cached
summaries) resolves to no memory — the chat behaves exactly as before. Another
customer's data is unreachable by construction: the lookup is keyed strictly
by the email the user just provided in this session. Signed-in (tier-3)
customers are re-identified by their live authenticated session instead, and
their history, profile and address are used only when `canPersonaliseSignedIn`
holds (the one consent `subscribed`; otherwise the greeting by name only —
[`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §8).

## Retention / erasure

**One erasure path for every way to delete:** `erasePerson()` in
[`src/lib/customer-erasure.ts`](../src/lib/customer-erasure.ts) — the widget
button „Meine Daten löschen“ (`/api/account/erase`), the mail-footer link
„Daten löschen“ (`/api/erase-data`: GET shows a confirmation page, POST
erases), the admin „Löschen“ in Kunden and Kampagne
(`POST /api/admin/customers/erase`), and the Shopify webhooks
`customers/delete` / `customers/redact` (trigger `shopify`). It removes the
person in **one transaction**. The entry points in detail, the table-by-table
inventory (deleted, kept de-identified, retained on purpose) and every window
are in [`DATA_RETENTION.md`](./DATA_RETENTION.md) „Complete erasure“ and
„Kundenstamm“. The per-table plan is `ERASURE_PLAN` in
`src/lib/customer-erasure-core.mjs`; its test parses every migration and
**fails when a table with personal data has no erasure decision**.

For the customer entity this means: Mo's copy of the person's Shopify orders
(`customer_orders`) is deleted with them (cascade, plus an explicit delete by
Shopify id for rows not yet linked), while `mo_orders` keeps its pseudonymous
rows without session id and token. The address goes on the **suppression list
with reason `erasure`**: it is never mailed again, no import re-creates the
person from that e-mail (mirror rule 1), and only a newer consent act lifts the
block ([`CONSENT_FLOW.md`](./CONSENT_FLOW.md) "Erasure").

**Bidirectional with Shopify** (migration `0065`, decision D-5):

| Started in | Mo | Shopify |
| --- | --- | --- |
| Mo (widget, mail link, admin) | deletes at once; for a person with a Shopify id writes an **erasure tombstone** (no import, reconciliation or webhook re-creates the person) | two outbox rows: `consent_update` → `unsubscribed`, sent while `SHOPIFY_CONSENT_WRITEBACK=true`; `data_erasure` (consent off again, then `customerRequestDataErasure`), sent while `SHOPIFY_ERASURE_SYNC=true`. Both switches default to `false`; a row whose switch is off waits. Shopify keeps its own orders as long as the law requires. |
| Shopify (`customers/delete`, `customers/redact`) | the same deletion; the tombstone is stamped confirmed (`shopify_confirmed_at`) | already erasing — not asked again |
| Shopify `customers/data_request` | an Eingang item „Datenauskunft angefordert (Shopify)“ (`datenauskunft`, deadline 30 days); its action „Daten bereitstellen“ opens the person in Kunden | — |

A person without a Shopify id (an Interessent) is erased in Mo only. More than
`SHOPIFY_ERASURE_ALERT_PER_HOUR` (default 20) Shopify-started erasures in an
hour raise an error report and an Eingang item — the erasures are carried out
regardless. Confirmed tombstones are removed `ERASURE_TOMBSTONE_RETENTION_DAYS`
(default 30) after Shopify's confirmation; unconfirmed ones stay
([`DATA_RETENTION.md`](./DATA_RETENTION.md) step 9).

**Compliance topics.** `customers/redact`, `customers/data_request` and
`shop/redact` reach Mo only once the app configuration subscribes them; the
registration script cannot ([`CATALOG_SYNC.md`](./CATALOG_SYNC.md) "Compliance
topics"; status: [`ROLLOUT_TODO.md`](./ROLLOUT_TODO.md) 5.2 / 5.4).
`customers/delete` is registered by the script. **Manual rule while the
compliance topics are not configured:** delete a person in Shopify with
„Delete customer“ (Mo follows through `customers/delete`); after Shopify's
„Erase personal data“, also „Löschen“ the person in Mo → Kunden; for a data
request, also look the person up in Mo → Kunden.

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

**Data export.** A signed-in customer's `/api/account/export`
([`frontend/ACCOUNT_CONTRACT.md`](./frontend/ACCOUNT_CONTRACT.md) §7.7) contains
the profile, consent records and the consent history, conversations,
correspondence, letters, marketing sends, bundle offers, feedback, the order
ledger, the facts, campaign participation, sends and letters (also unsent
letter drafts, 0074), and the suppression status. Eingang items are not part of
it. There is no admin-side export: a Shopify data request is answered from
Kunden.

**Retention:** the job ([`src/lib/retention.ts`](../src/lib/retention.ts))
purges opted-out customer rows after the capture grace period (step 5) and
inactive customer rows whose one consent is neither `subscribed` nor `pending`
(step 5e) — but **never a Shopify customer** (a row with a
`shopify_customer_id`: the mirror follows Shopify, and only the complete
erasure removes it). Windows: [`DATA_RETENTION.md`](./DATA_RETENTION.md).

## ✅ GDPR: profile building — LAWYER-APPROVED

`CONSENT_COPY_LAWYER_APPROVED = true` (`src/lib/consent-copy.ts`; the German
copy was approved in June 2026): building a durable profile from past chats and
Shopify purchases, the in-chat customer memory (tier 2 and tier 3) and the
signed-in personalisation were reviewed against the consent copy and the
privacy policy. What the code enforces per person:

- **Profiles** — `mayBuildAiProfile` (scope + Art. 21 objection, "Who gets a
  profile" above).
- **Tier-2 memory** — the in-session capture check ("Customer memory in the
  live chat").
- **Tier 3** — history, profile and address only when `canPersonaliseSignedIn`
  (`src/lib/customer-account-data.mjs`) holds: `CONSENT_COPY_LAWYER_APPROVED`
  and the one consent `subscribed` (its compatibility mirror
  `marketing_status = 'confirmed'`); otherwise the greeting by name only
  ([`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §8 „The consent gate“).

The open lawyer items of the customer platform (AI profiles without consent,
the mirror with its order ledger, bidirectional consent and erasure, insight
tags) are in [`CONSENT_FLOW.md`](./CONSENT_FLOW.md) "Customer platform
(2026-10)". The approval checklist as recorded in June 2026:
[`archive/CUSTOMERS_HISTORY_2026-10.md`](./archive/CUSTOMERS_HISTORY_2026-10.md).

## What deliberately did NOT change

- `email_captures` remains the Art. 7 evidence for consents given on Mo's
  surfaces. The **state** of the marketing consent is the one consent on
  `customers` (+ `consent_events`), shared with Shopify in both directions.
- Anonymous (no-email) sessions remain pseudonymous and unlinked.
- Signing in establishes identity, never marketing consent.

## Design decisions (customer platform, 2026-10)

The decisions taken for the customer platform (built 2026-10-01; the plan with
the original questions and recommendations is archived:
[`archive/CUSTOMER_PLATFORM_PLAN.md`](./archive/CUSTOMER_PLATFORM_PLAN.md) §4,
decision record §0). Each row states the decision as built, checked against the
code on 2026-10-05; **Differs** marks where the build is not what the decision
text said. Every Shopify switch defaults to `false` in code; which ones are on
is recorded only in [`ROLLOUT_TODO.md`](./ROLLOUT_TODO.md). The lawyer's view:
[`ANWALTSDOSSIER.md`](./ANWALTSDOSSIER.md) §13 (F-22 … F-29) and
[`CONSENT_FLOW.md`](./CONSENT_FLOW.md) "Customer platform (2026-10)".

| # | Decision | As built |
| --- | --- | --- |
| D-1 | AI profiles for customers without marketing consent: „all, flagged“. | `CUSTOMER_AI_PROFILE_SCOPE` = `consented` (code default) or `all` (decided for this shop, lawyer to confirm). With `all`, people without consent get a profile, flagged in Kunden, every marketing action blocked; an Art. 21 objection deletes the profile and always wins (`mayBuildAiProfile`). See "The central customer profile". |
| D-2 | Shopify is the record for the consent **state**; Mo keeps the evidence of consents given on its surfaces. | One state on `customers.email_consent_*`, mirrored from Shopify and written to it through the outbox; `email_captures` stays the Art. 7 evidence. **Differs:** neither side is master — the newer act wins (`consent-core.mjs` rule 2), and a Shopify value that loses against a newer Mo state is answered by pushing Mo's state back. See [`CONSENT_FLOW.md`](./CONSENT_FLOW.md) "The one consent". |
| D-3 | Mo-only subscribers get a Shopify customer record. | A confirmed Mo DOI queues `customer_create` with the consent (sent while `SHOPIFY_CONSENT_WRITEBACK`); earlier Mo-only subscribers are queued by the Erstabgleich (Einstellungen → Shopify-Abgleich, after the first import, behind a confirm; `POST /api/admin/shopify/align`). |
| D-4 | One opt-in-level switch for every marketing e-mail. | `CAMPAIGN_ALLOW_SINGLE_OPT_IN` (default `false`) decides whether single-opt-in consents are mailable on the campaign path, the Einzelansprache included. **Differs:** the legacy 1:1 path (`approveAndSend`, only for drafts opened before the switch to the Einzelansprache) keeps its own gate, a confirmed Mo DOI on the capture. Shopify's own double-opt-in setting is a shop setting, not code. |
| D-5 | An erasure on either side erases on both. | Mo-started: tombstone + `consent_update` (`SHOPIFY_CONSENT_WRITEBACK`) + `data_erasure` (`SHOPIFY_ERASURE_SYNC`) — with only the write-back switch on, the erasure still switches the Shopify consent off. Shopify-started (`customers/delete`, `customers/redact`): the same deletion, Shopify not asked again. See "Retention / erasure". |
| D-6 | Mirror all Shopify customers, store all their orders (minimised), compute facts for everyone. | `SHOPIFY_CUSTOMER_SYNC_ENABLED` gates the import, the reconciliation and the customer / consent / order-ledger webhooks; the facts job runs regardless (it also covers chat-only people). See "Kundenstamm", "Facts for everyone". |
| D-7 | Advertising letters (opt-out model) for customers without e-mail consent, with an objection flag. | Per-customer channel (Kunden → Brief) and, since migration `0074`, a campaign channel (`campaigns.letter_mode`), both behind `PHYSICAL_MAIL_SENDS_APPROVED` (default `false`) and the per-customer `postal_objection_at`; every advertising letter carries the Art. 21 notice (`letter-pdf.mjs`); Eingang suggestions may propose a letter; the campaign editor shows the letter reach („per Brief erreichbar“). See [`CAMPAIGNS.md`](./CAMPAIGNS.md) §8. |
| D-8 | One send pipeline: the 1:1 marketing e-mail is the built-in campaign „Einzelansprache“. | Campaign kind `einzel` (slug `einzelansprache`, one row from migration `0066`), always active, no audience; recipients come from Kunden and the Eingang and are drafted, reviewed and sent like any campaign mail (`MK-` codes). **Differs:** `marketing_sends` and `approveAndSend` remain for drafts opened before the switch (legacy drop not built, below). |
| D-9 | Übersicht becomes the **Eingang**, the landing screen. | Screen 1 (`?tab=eingang`, the default screen of `/admin`, key `1`; the legacy `?tab=overview` resolves to it). **Differs:** unmatched incoming mails are a block at the top of the Eingang, not an item kind. See [`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §3.1. |
| D-10 | Serien-Mail (one approved master text, batch send) only after a decision. | Not built; every campaign mail is reviewed and approved one at a time. „Einplanen“ (migration `0072`, `CAMPAIGN_RELEASE_ENABLED`) only defers the send of an approved mail. |
| D-11 | Mo's insights back to Shopify, off by default. | `mo-…` customer tags (`mo-segment-…`, `mo-wert-…`, `mo-kontakt`, `mo-abwanderung-hoch`), queued nightly as `writeback` outbox rows, `SHOPIFY_WRITEBACK_ENABLED` (default `false`); an Art. 21 profile objection removes them. **Differs:** tags only, no metafields. See [`DATA_RETENTION.md`](./DATA_RETENTION.md) „Kundenstamm“. |
| D-12 | Names: Eingang, Kampagnen, Einzelansprache, Profiltiefe (Fakten / Kaufprofil / Vollprofil), Mo-Kontakt. | Eingang, Kampagnen (the screen key stays `kampagne`), Einzelansprache, Interessent, badges „Vollprofil“ / „Kaufprofil“. **Differs:** „Profiltiefe“ and „Fakten“ are not UI labels, and the UI says „Mit Mo gesprochen“ (Kunden filter, KPIs, campaign audience) — „Mo-Kontakt“ appears only in the tag `mo-kontakt` and its InfoTip. |

**Not built** (planned for the customer platform, not in the code):

- Serien-Mail (D-10).
- The legacy drop: `marketing_sends` → Einzelansprache, removal of `customers.marketing_status` and `purchase_summary`, the legacy `source` values.
- The Verbesserung lane „Marketing“ (offers, segments, triggers as proposals) — the lanes are `shop` and `mo`.
- One shared eligibility gate (`marketing-eligibility.mjs`): `campaign-gates.mjs` gates the campaign path, `approveAndSend` keeps its own gates and a marketing-only frequency cap.
- A window for dormant AI profiles (`CUSTOMER_PROFILE_DORMANT_DAYS`).
- An own 365-day window for `marketing_sends` (they follow their capture, [`DATA_RETENTION.md`](./DATA_RETENTION.md)).
- Eingang items in the customer's data export.
- The npm scripts `shopify:import` and `consent:align` — the import and the Erstabgleich are Einstellungen buttons, continued by `/api/cron/shopify-sync`.
