# Mo as the AI marketing layer — the customer-centric restructuring (plan)

Status: **built, 2026-10-01** (phases 1–7, see §0 „As built“). This document stays the design
record: §1–§20 are the plan as agreed; where the build deviates, §0 says so and the code and the
reference docs (`ADMIN_DASHBOARD.md`, `CAMPAIGNS.md`, `CONSENT_FLOW.md`, `CUSTOMERS.md`,
`DATABASE.md`, `DATA_RETENTION.md`, `API_CONTRACT.md`) are authoritative. Decisions that need the
maintainer or the lawyer are marked **D-n** (§4).

The plan rests on a read of the code as of `d48ad77`. File references in §1–§20 point at that state.

## 0. As built (2026-10-01)

**Decisions.** D-1: the maintainer chose „all, flagged“ — AI profiles are built for every
customer when `CUSTOMER_AI_PROFILE_SCOPE=all` (code default stays `consented`); people without
consent are flagged and every marketing action on them is blocked; an Art. 21 objection deletes
the profile. D-2: Shopify holds the consent state. D-3: a confirmed Mo DOI creates the Shopify
customer; existing Mo-only subscribers are created after an operator confirm („Erstabgleich“,
Einstellungen → Shopify-Abgleich). D-4: one opt-in-level switch (`CAMPAIGN_ALLOW_SINGLE_OPT_IN`).
D-5: two-way erasure behind `SHOPIFY_ERASURE_SYNC`; with only `SHOPIFY_CONSENT_WRITEBACK` on, an
erasure still switches the Shopify consent off. D-6: mirror + order ledger + facts behind
`SHOPIFY_CUSTOMER_SYNC_ENABLED`. D-7: letters stay a per-customer channel (Kunden → Brief) with a
postal objection flag, the Art. 21 notice in every letter, letter suggestions in the Eingang and
the letter reach in the campaign editor. D-8: the Einzelansprache is a campaign. D-9: the Eingang
is screen 1. D-10: Serien-Mail not built (undecided). D-11: insight tags built, off by default
(`SHOPIFY_WRITEBACK_ENABLED`). D-12: names as listed. All Shopify switches default to `false`;
the lawyer items are in `ANWALTSDOSSIER.md` §13 (F-22 to F-29).

**Deviations from the plan.**

| Plan | As built |
| --- | --- |
| Migrations 0061–0069 as in §13 | `0061_customer_mirror`, `0062_customer_orders`, `0063_customer_facts`, `0064_email_consent`, `0065_shopify_sync`, `0066_campaigns`, `0067_inbox`, `0068_customer_overview`, plus `0069_campaign_manual_recipients` (hand-added recipients stay in a dynamic campaign). No `marketing_unify`, no `drop_legacy` (one release later). |
| New `campaign_recipients` table | `campaign_contacts` became the per-campaign recipients (campaign_id, customer_id, cycle, excluded, admin_note, conversation_id); legacy rows belong to „Bestandskunden – Lebenszyklus“. |
| Test inboxes (§10.8) | Test contacts per campaign (unchanged mechanics, scoped to the campaign). |
| Consent alignment script (§7.7) | Migration 0064 backfills; the first import runs everyone through the resolver; Mo-only subscribers are queued from the Shopify-Abgleich card after a confirm. |
| Facts in refresh-customers | `customer_facts` are recomputed by `/api/cron/shopify-reconcile` (01:45) and after the import. |
| Chat gate (§7.6) | Leads with sign-in (`signIn` in `/api/consent-copy?surface=chat`); the typed e-mail is the alternative. |
| Kampagnen tab key | Stays `kampagne` (label „Kampagnen“, alias `kampagnen`). |
| Accepting an Eingang suggestion | Creates an Einzelansprache recipient whose note is the drafter brief. |
| Inbox retention | Content cleared after 180 days (`INBOX_RETENTION_DAYS`), a marker stays two years so a decided item is not re-created. |
| `mo_c` capture (§12.5) | `POST /api/chat` `campaignToken` → one session-less KPI event per send („Chat gestartet“); the chat itself is never tied to the person. Widget side: frontend handoff. |
| Ähnliche Kunden via embeddings (§9.5) | Deterministic: same value tier, shared bought categories → „Als Zielgruppe verwenden“. |
| Kunden bulk draft | „Auswählen“ → „Zur Kampagne…“ (consent-gated, Einzelansprache first). |
| Webhook registration (Phase 0) | `npm run shopify:webhooks [-- --apply]`; the route accepts the store key or the app secret. |

**Phase 7 built:** KPI groups Kundenbasis, Eingang, Mo-Effekt and „Kampagnen im Vergleich“;
Komplettanalyse chapters „Kundenbasis“ and „Kampagnen“; Gespräche → „Kunde öffnen“; „Frag Mo“;
„Wahrscheinlich als Nächstes“; Ähnliche Kunden; `mo_c` capture (backend); letter reach; insight
tags (D-11).

**Not built:** the Verbesserung lane „Marketing“ (offers, segments, triggers as proposals) — it
needs a proposal type that is not a prompt directive; letters as a campaign channel (batch letters
with review and Pingen costs) — today letters are sent per customer; Serien-Mail (D-10); the
legacy drop (`marketing_sends` → Einzelansprache, removal of `customers.marketing_status` and
`purchase_summary`) — the old 1:1 path remains only for drafts that were open before the switch.

Contents

0. As built (2026-10-01)
1. Summary
2. Mission and principles
3. Where we are today (and why it does not fit the mission)
4. Decisions to take first
5. Target picture
6. Pillar A — the customer base (Kundenstamm): every Shopify customer is a Mo customer
7. Pillar B — one marketing consent
8. Pillar C — one deletion
9. Pillar D — Kunden, the central workspace
10. Pillar E — Kampagnen: many campaigns, one pipeline
11. Pillar F — Eingang, the operator inbox
12. Further restructuring the mission calls for
13. Data model: migrations
14. Code map: new, changed, retired
15. Delivery plan (phases, acceptance criteria, Black Friday path)
16. AI usage and cost
17. Risks and mitigations
18. Feature inventory impact
19. Docs to update
20. Open questions

---

## 1. Summary

**The shift.** Today the customer system grows out of the chat. A `customers` row exists only when
someone leaves an e-mail in the widget, signs in through the widget, or is a Shopify newsletter
subscriber. Consent lives in three places, deletion stops at Mo's own database, and the campaign
module is one hard-wired campaign that can mail each subscriber exactly once. From now on **the
Shopify customer base is the population**, Mo is the intelligence and action layer on top of it,
and the chat enriches people that already exist.

**Six pillars.**

| | Pillar | In one sentence |
| --- | --- | --- |
| A | **Kundenstamm** | Every Shopify customer is a `customers` row, kept in sync by a bulk import, webhooks and a nightly reconciliation, with a local order ledger and deterministic facts for everyone. |
| B | **Eine Einwilligung** | One e-mail-marketing consent per person, shared with Shopify in both directions; Mo keeps the Art. 7 evidence for its own surfaces; one eligibility gate for every send. |
| C | **Eine Löschung** | An erasure on either side ends in the same state on both sides: Mo erases and requests Shopify's data erasure; a Shopify deletion or redaction erases the person in Mo. |
| D | **Kunden** | The central workspace lists every customer, server-side and fast; "Mit Mo gesprochen" is one dimension among many; every person has a profile whose depth matches the data we hold. |
| E | **Kampagnen** | Any number of campaigns (Black Friday next), each with its own brief, audience, offer, design and schedule; the existing review desk works per campaign; the 1:1 marketing e-mail becomes the built-in "Einzelansprache". |
| F | **Eingang** | The operator's inbox: customers who need attention today, why, and a ready suggestion (e-mail draft, offer, letter, reply). |

**Delivery** in seven phases, each shippable alone and behind a flag (§15). The first visible result
(Phase 1) is a Kunden screen that lists all ~18,000+ Shopify customers. Black Friday (27.11.2026)
lies on the critical path of Phases 1–3. §15.3 gives a fallback if that path slips.

---

## 2. Mission and principles

> **Mo is the AI layer of the motion sports shop. It knows every customer, understands what they
> own, want and need, and helps the team reach the right person with the right message at the
> right time. The chat is how Mo learns most about a person, but no part of the system requires
> that someone has chatted.**

Principles every phase must respect:

| # | Principle | What it means in code |
| --- | --- | --- |
| P-1 | **The person is the unit.** | One `customers` row per person. The Shopify customer id is the primary external key, the e-mail the fallback, and chat sessions attach to persons. |
| P-2 | **Shopify is the record for identity, orders and consent state; Mo is the record for intelligence.** | Mo mirrors Shopify customers, orders and consent. Mo owns profiles, facts, signals, conversations, campaigns, and the evidence of consents given on Mo surfaces. |
| P-3 | **One consent, one deletion.** | Whichever side starts the change, both end in the same state. The change travels through a durable outbox, never fire-and-forget. |
| P-4 | **Facts before AI.** | Every customer gets deterministic facts at zero token cost. AI is spent where it adds value, with budgets and tiers. |
| P-5 | **Missing data is a state, not an error.** | Every view says which sources its picture rests on. There are no empty boxes. |
| P-6 | **A human approves every send; legal gates fail closed.** | Unchanged. A suggestion never sends anything. |
| P-7 | **The chat is a feature.** | Chat data enriches the profile, the inbox and drafts. Nothing in the customer system requires a chat. |
| P-8 | **House rules stay.** | Non-composable SQL, `getSql()` may be `null`, pure `.mjs` cores with tests, `guardAdmin*`, `admin-datetime`/`admin-format`, design tokens, one screen per request, German UI (see `CLAUDE.md`). |
| P-9 | **The widget contract stays backward compatible.** | `docs/API_CONTRACT.md` changes are additive only. |
| P-10 | **Forward-only, stoppable phases.** | Each phase ends in a consistent state. Legacy tables are dropped one release after the last reader is gone. |

---

## 3. Where we are today (and why it does not fit the mission)

| Area | Today | Consequence |
| --- | --- | --- |
| **Who is a customer** | A `customers` row exists only for chat captures (`linkCustomerOnEmailCapture`), widget sign-ins (`bindShopifyIdentity`) and Shopify newsletter subscribers (`linkCampaignContactsToCustomers`, migration 0059). | Buyers who never subscribed, chatted or signed in are invisible: most of the ~18,355 customers in the order history (`REPURCHASE_ANALYSIS.md`). |
| **Kunden list** | `listCustomerListRows` loads up to 5,000 rows (`CUSTOMER_LIST_MAX`) and filters them in the browser (`admin-customer-filter.mjs`). | Does not scale to the full base. `ADMIN_DASHBOARD.md` §3.3 says "no cap", which is wrong. |
| **Identity keys** | `customers.shopify_customer_id` is numeric and only set on sign-in. `campaign_contacts.shopify_customer_id` is a GID. The sync links by e-mail only. | Two id formats; people can be linked twice or not at all. |
| **Orders** | Read per e-mail from Shopify (`fetchOrderHistoryByEmail`: 20 orders × 25 lines) into `customers.purchase_summary`, refreshed for 25 customers a night. The orders webhook stores only Mo-marked orders (`mo_orders`). | No complete or current purchase picture. Activity analysis is impossible without Shopify fan-outs. |
| **Consent** | Three stores. `email_captures` holds Mo's DOI. `campaign_contacts.status`/`opt_in_level` mirrors Shopify, synced daily. `suppression_list` holds blocks. `customers.marketing_status` mirrors only Mo's DOI, so it stays `none` for every Shopify subscriber. **Nothing is ever written to Shopify.** | A Shopify unsubscribe is visible only after the nightly sync and never reaches the suppression list. A Mo unsubscribe never reaches Shopify, so Shopify Email could keep mailing. `optInActionable` (`signed-in-identity.ts`) asks a Shopify subscriber to opt in again. |
| **Send gates** | Two send paths with different gates (`approveAndSend` / `approveAndSendCampaign`). The frequency cap is one-directional: the marketing path ignores `campaign_sends`. The copy path (`campaign/mark-done`) runs no gate at all. | Inconsistent guarantees. |
| **Deletion** | `erasePerson` is complete inside Mo but makes no Shopify call. No `customers/*` or compliance webhook is handled (they would be acked and ignored). The re-import guard is keyed by e-mail only. The erase page says "Deine Bestellungen im Shop sind davon nicht betroffen". | A deletion in Shopify leaves the profile, chats and correspondence in Mo. A deletion in Mo leaves the Shopify account, and its consent, untouched. |
| **Campaigns** | No `campaigns` table. Campaign state is one `status` column per contact, and `sent` is terminal, so **each subscriber can receive at most one campaign e-mail ever**. One design kind (`email_design_selections.campaign`), one hero A/B split by contact-id parity, global counts/KPIs/history, and a prompt hard-wired to "persönliche Empfehlung" (`campaign-draft.ts`). | No Black Friday, no second campaign, no audience other than "Shopify subscribers". |
| **Two marketing channels** | Mo funnel (`marketing_sends`, `MS5-`, Kunden → Marketing) and Kampagne (`campaign_*`, `MK-`). Drafting, sending, gates and history are duplicated. Only the Mo funnel writes `email_messages`. | Two ways to do the same thing, with diverging rules. |
| **Attention** | No customer-level inbox. Profile `nextSteps` are never aggregated. `customer_merge_conflicts` is never shown. Übersicht → „Heute“ has four system cards. | The team has to search for work instead of being shown it. |
| **Profiles** | Deep tier (Opus 5.5), ≈ $0.10 per profile, 30 per night. | Fine for hundreds of customers; ≈ $1,800 for the full base. A tiered approach is needed (§9.6). |

Doc drift found on the way, fixed in the docs pass (§19): `CAMPAIGNS.md` says the flags ship enabled in
`.env.example` (they ship `false`), says there is "no auto-generation cron" (it exists, off by
default), and says the audience must "have order history" (the sync does not check this).

---

## 4. Decisions to take first

Each decision has a recommendation. The code is built so that the recommended answer is a flag
flip, and the conservative answer is the default.

| # | Question | Recommendation | Who | Default in code until decided |
| --- | --- | --- | --- | --- |
| **D-1** | May we build **AI profiles** for customers **without** marketing consent? Today profiling rests on consent (dossier R-06, F-20). | **Yes, after an explicit lawyer sign-off**: Art. 6(1)(f), described in the privacy policy, with a right to object (an objection clears the profile and stops upkeep). Deterministic facts are not part of this question; they belong to D-6. | Lawyer | `CUSTOMER_AI_PROFILE_SCOPE=consented` (AI profiles only for consented customers and Mo-Kontakte with consent) |
| **D-2** | Which side is the record for the consent **state**? | **Shopify** (`emailMarketingConsent`). Mo writes into it and mirrors it. Mo stays the record for its **evidence** (`email_captures.consent_text_shown`). Alternative rejected: Mo as master, because Shopify surfaces (checkout, account, Shopify Email footer) change consent without Mo. | Maintainer | — |
| **D-3** | Do Mo-only subscribers (chat DOI, no Shopify account) get a Shopify customer record? | **Yes.** After the DOI is confirmed, `customerCreate` with the consent. Then there is one subscriber list, usable by Shopify Email, Flow or any other tool. | Maintainer + lawyer | `SHOPIFY_CONSENT_WRITEBACK=false` |
| **D-4** | Single-opt-in consents: today they are only mailable through the campaign channel (approved 2026-07-21, F-06 still open). Under one consent, the same rule applies to every marketing e-mail, including 1:1. | One switch for everything: keep `CAMPAIGN_ALLOW_SINGLE_OPT_IN` as the one opt-in-level gate. Turn on Shopify's own **double opt-in setting** (Settings → Customer accounts / Marketing) so new Shopify subscriptions arrive as `CONFIRMED_OPT_IN`. An optional "Einwilligung bestätigen" campaign (§10.12) can lift existing SOI contacts. | Lawyer | flag `false` (unchanged) |
| **D-5** | Does an erasure in Mo also erase the Shopify customer, and the reverse? | **Yes**, as requested. A GDPR erasure request is addressed to the controller (motion sports) as a whole. Shopify keeps the order data it must retain by law, in redacted form. New copy on the erase page, in the widget and in the admin confirm. | Lawyer (copy) | `SHOPIFY_ERASURE_SYNC=false` |
| **D-6** | May we mirror **all** Shopify customers, store **all** their orders locally (minimised line data) and compute deterministic facts (purchase statistics, lifecycle segment, value tier) for everyone? `ORDER_ATTRIBUTION.md` promises "unmarked orders are never stored". | **Yes**: Art. 6(1)(b)/(f) customer administration of the shop's own customers, mentioned in the privacy policy, retention tied to the customer, deleted with the person. Without a local ledger, activity analysis, audiences and the inbox each need Shopify fan-outs. | Lawyer | — (Phase 1 is blocked on it) |
| **D-7** | Postal letters as the channel for customers **without** e-mail consent: advertising letters to existing customers under the opt-out model, with an objection flag. | **Yes**, behind `PHYSICAL_MAIL_SENDS_APPROVED` plus a per-customer `postal_objection_at`. This is the only lawful outbound marketing channel for the non-consented majority. | Lawyer | letters only to consented customers |
| **D-8** | One send pipeline: the 1:1 marketing e-mail becomes the built-in campaign "Einzelansprache"; `marketing_sends` becomes history; new sends use `MK-` codes only. | **Yes.** It removes a parallel system. No capability is lost (§18). | Maintainer | — |
| **D-9** | Übersicht → **Eingang** (new landing screen); the unmatched-mail "Posteingang" becomes one item kind there. | **Yes.** Same shortcut (`1`), same URL (`/admin`). | Maintainer | — |
| **D-10** | Big seasonal campaigns: keep per-mail review (≈ 200/day/operator), or add a **Serien-Mail** mode (one approved master text + deterministic per-recipient blocks, sample review, batch send)? | Keep per-mail review as the default. Build Serien-Mail only after a decision (§10.13): it changes the "a human reviews every e-mail" invariant. | Maintainer + lawyer | not built |
| **D-11** | Write Mo's insights back to Shopify (tags or metafields such as segment, persona, next action) for Shopify Flow/Email? | Later (Phase 7), off by default. | Maintainer | `SHOPIFY_WRITEBACK_ENABLED=false` |
| **D-12** | Names: **Eingang**, **Kampagnen** (plural), **Einzelansprache**, **Profiltiefe** (Fakten / Kaufprofil / Vollprofil), **Mo-Kontakt**. | As listed. | Maintainer | — |

A lawyer addendum to `ANWALTSDOSSIER.md` (§19) collects D-1, D-3, D-4, D-5, D-6, D-7, and the copy
changes from §7.8 and §8.4, as new processing purposes: the CRM mirror of all customers, the order
ledger, AI profiling of the whole base, bidirectional consent, bidirectional erasure, and postal
advertising.

---

## 5. Target picture

```
                       SHOPIFY  (record for identity · orders · consent state)
          bulk import ──┐   webhooks ──┐   reconcile (nightly) ──┐        ▲  outbox: consent · create ·
                        ▼              ▼                          ▼        │          erasure · write-back
        ┌──────────────────────── Sync layer  (src/lib/shopify-sync*) ─────┴─────────────────┐
        │  customer mirror · order ledger · consent resolver · erasure tombstones · dedupe   │
        └──────────────────────────────────────┬─────────────────────────────────────────────┘
                                               ▼
  Chat widget ── sessions ───────►  CUSTOMER CORE   customers · customer_orders · consent_events ·
  Mail in/out ── messages ───────►                  customer_facts · (view) customer_overview
  Campaign sends ── outcomes ────►                         │
                                                           ▼
                        INTELLIGENCE   facts core (deterministic, everyone) · AI profile (tiered) ·
                                       signals core (inbox rules) · suggestions (AI, budgeted)
                                                           ▼
                        WORKSPACES     Eingang (what to do) · Kunden (who) · Kampagnen (to many)
                                                           ▼
                        CHANNELS       E-Mail (consent-gated, ONE send path) · Brief (Pingen) ·
                                       Chat (personalised Mo for known, consented customers)
```

**Vocabulary** (German UI terms in bold):

| Term | Meaning |
| --- | --- |
| **Kundenstamm** | All persons Mo knows: every Shopify customer, plus chat contacts who left an e-mail but have no Shopify account yet (**Interessenten**). |
| **Mo-Kontakt** / „Mit Mo gesprochen“ | The person has at least one linked conversation. A dimension of the list, not a separate population. |
| **Einwilligung** | The one e-mail-marketing consent (§7). |
| **Fakten** | Deterministic per-customer figures from orders, conversations and sends (§6.4). |
| **Profiltiefe** | How much the profile rests on: **Fakten** (no AI), **Kaufprofil** (AI from purchases and marketing reactions), **Vollprofil** (AI including conversations and correspondence). |
| **Kampagne** / **Empfänger** | A defined campaign / a customer's place in it. |
| **Einzelansprache** | The always-present campaign for one-to-one e-mails out of Kunden or Eingang. |
| **Eingang** / **Aufgabe** / **Vorschlag** | The operator inbox / one item in it / the AI-proposed next step. |

---

## 6. Pillar A — the customer base (Kundenstamm)

### 6.1 Identity model

- **One row per person** in `customers` (unchanged table, extended columns §13).
- **Keys:** `shopify_customer_id` (numeric, unique; the GID is derived) is the primary external key.
  `email` stays unique. A Shopify customer without an e-mail uses the existing placeholder
  `shopify:<id>` (`hasRealEmail` already understands it).
- **`source`** keeps its meaning, "where the person first came from", but is reduced to two values:
  `shopify` (already a shop customer when Mo first saw them; the old `kampagne` and
  `shopify_account` values migrate here) and `chat` (first seen in Mo). A `chat` person who later
  buys keeps `chat`. That is the basis for the KPI "über Mo gewonnene Kunden" (§12.3).
- **Derived states** shown in the UI instead of the old tier badge:
  - **Shopify-Kunde** — has a Shopify customer id.
  - **Interessent** — chat-only, no Shopify record.
  - **Mo-Kontakt** — has conversations.

  `identity_tier` remains a session concept for the widget. Imported rows no longer get the
  misleading tier 1 (today's Kampagne rows do).
- **E-mail changes and merges.** `customers/update` with a new e-mail that belongs to another row
  (typically an Interessent who chatted with that address) merges the e-mail-only row into the
  Shopify row. `mergeCustomers(keepId, dropId)` runs one transaction that re-points every FK.
  A `CUSTOMER_FK_PLAN` in a pure core lists every table with a customer FK, and its test parses
  the migrations exactly like the `ERASURE_PLAN` test, so a new FK cannot escape a merge. The
  decision itself extends `decideMerge` (`customer-merge.mjs`). Conflicts it cannot resolve become
  an Eingang item (`abgleich_konflikt`); today `customer_merge_conflicts` is written but never shown.

### 6.2 Sync layer

**Initial import (once, re-runnable).** A Shopify **bulk operation** (`bulkOperationRunQuery`) over
customers with their orders and line items. The result is a JSONL file in which nested rows carry
`__parentId`.

- `shopify-bulk-core.mjs` (pure, fixture-tested) maps lines to customer, order and line-item rows.
- The import job is resumable. A `shopify_sync_runs` row stores the bulk-operation id, status, the
  result URL and a **byte offset**, so each step continues with an HTTP `Range` request from that
  offset.
- Each step processes about 5,000 lines and upserts in chunks of 500, comfortably inside the
  route's 300 s.
- Started from Einstellungen → „Shopify-Abgleich“ (§12.10) or `npm run shopify:import`, which loops
  the step endpoint like `profiles:backfill` does today. Completion is detected by polling the
  bulk operation, with `bulk_operations/finish` as an optional webhook.
- Volume: ≈ 20–40 k customers, 28.5 k orders, ≈ 85 k line items. A few tens of MB, a handful of steps.

**Live updates (webhooks)** on the existing `/api/webhooks/shopify` (HMAC over the raw body, unchanged):

| Topic | Effect |
| --- | --- |
| `customers/create`, `customers/update` | Upsert the mirror (name, e-mail, locale, country, state, tags), then run the consent resolver (§7.3) on the embedded `email_marketing_consent`. An e-mail change triggers the merge rule. Marks facts dirty. |
| `customers_email_marketing_consent/update` | Consent resolver only. |
| `customers/delete` | Erasure (§8.3). |
| `orders/create`, `orders/updated`, `orders/paid`, `orders/cancelled`, `refunds/create` | Upsert `customer_orders` (§6.3); Mo-marked orders additionally go to `mo_orders` exactly as today. Marks facts dirty. |
| `customers/redact`, `customers/data_request`, `shop/redact` (compliance topics, configured in the app's configuration, not via the API) | §8.3. |
| `bulk_operations/finish` | Advances the import job. |

Webhook rules:

- **Dedupe** on `X-Shopify-Webhook-Id` in `shopify_webhook_events`, kept 30 days.
- **Stale guard:** a payload whose `updated_at` is older than the stored `shopify_updated_at` is ignored.
- **Thin handlers:** upserts only. Heavy work (facts, profile, inbox) is deferred through `facts_dirty_at`.
- **Always answer 200** once the event is recorded. A processing error is recorded with the event
  and repaired by the reconciliation, so Shopify's retry storm never hits a half-applied state.

**Nightly reconciliation** (`/api/cron/shopify-reconcile`, replacing `sync-campaign-audience`):
`customers(query: "updated_at:>='<last − 1h>'")` and the same for `orders`. Catches every missed
webhook. Uses the existing throttle and backpressure helpers (`shopify-throttle.mjs`,
`shopify-backpressure.mjs`).

**Outbox** (`shopify_outbox`, worker `/api/cron/shopify-outbox` every 5 minutes, plus an inline
attempt right after enqueue). Kinds:

- `consent_update` — `customerEmailMarketingConsentUpdate`
- `customer_create` — `customerCreate` with e-mail and consent (D-3)
- `data_erasure` — `customerRequestDataErasure`
- `writeback` — D-11

Retries back off exponentially (pure `outbox-core.mjs`). After 8 failures a row turns `dead` and
becomes an Eingang system item plus a Systemstatus warning. Mutations are never auto-retried by the
GraphQL transport (`shopify.ts`); the outbox is the only retry layer, and every operation is
idempotent (same target state).

**Scopes and access:** add `write_customers` (consent update, create, data erasure request).
Protected customer data: name and e-mail fields are already required by the campaign sync. **No
addresses or phone numbers are mirrored**: letters keep using the existing lawful-address capture
(`address-capture.ts`).

> **Verify at implementation** against the current Admin API version (`SHOPIFY_API_VERSION`): the
> exact input shapes of `customerEmailMarketingConsentUpdate`, `customerCreate.emailMarketingConsent`
> and `customerRequestDataErasure`, the topic names above, the redaction timing of
> `customers/redact`, and whether writing `SUBSCRIBED` + `CONFIRMED_OPT_IN` while Shopify's own
> double-opt-in setting is on sends Shopify's confirmation e-mail (it must not — test on a
> development store). `shopify.dev` blocks automated fetches (`ADMIN_DASHBOARD.md` §6), so this is a
> manual check, as in earlier rounds.

### 6.3 The order ledger (`customer_orders`)

One row per Shopify order: ids, `customer_id` (cascade with the person), `processed_at`, financial
and fulfilment status, cancellation, currency, subtotal/total/refunded in cents, discount codes,
`source_name`, and **minimised line items**: handle/ref (matched with the existing
`matchOrderLineItems`), product/variant id, title, variant title, quantity, unit price.

**No** addresses, payment data, notes or customer contact fields. Kept as long as the customer
exists in Mo (D-6). `purchase_summary` stops being fetched per e-mail; a function
`loadPurchaseHistory(customerId)` serves the same shape from the ledger, so the readers (profile,
drafts, memory, letters) change one import. The Customer Account API cache for signed-in customers
(address context) stays.

### 6.4 Facts for everyone (`customer_facts`, `customer-facts-core.mjs`)

A pure function computes, per customer, from orders, conversations, sends and correspondence. Zero
tokens. Recomputed for dirty customers on every cron tick and for everyone nightly, because the
time-dependent fields move.

| Group | Fields |
| --- | --- |
| Purchases | `orders_count`, `total_spent_cents` (net of refunds), `first_order_at`, `last_order_at`, `aov_cents`, `median_interval_days`, `expected_next_order_at`, `refunds_count`, `discount_order_share` (price sensitivity) |
| Classification | `lifecycle_segment` (reuses `campaign-segments.mjs`: frisch … ruhen), `value_tier` (reuses `repurchase-analysis.mjs` `VALUE_TIERS`: klein / komponente / großgerät), `rfm_r`/`rfm_f`/`rfm_m` (1–5, fixed thresholds from the repurchase analysis, never quantiles over the base, so one person's score does not move when others buy), `churn_risk` (niedrig / mittel / hoch) |
| Ownership | `bought_handles` (GIN), `bought_categories`, `complement_handles` (catalog `compatibleWith` of owned products minus owned: the "next likely purchase" pool) |
| Mo | `conversations_count`, `last_chat_at`, `discussed_handles_90d`, `selected_handles_90d`, `last_chat_quality` (from the cached analysis) |
| Marketing | `emails_sent_count`, `last_marketing_at`, `last_click_at`, `clicks_90d`, `redemptions_count`, `last_redemption_at` |
| Service | `last_inbound_at`, `unanswered_inbound_count` |
| Inbox | `open_tasks_count`, `top_task_kind` |

A **view** `customer_overview` (plain DDL) joins `customers`, `customer_facts`, the consent columns and
the block state (bounce / complaint / erasure from `suppression_list`). It is the one base for the
Kunden list (§9.2) and for audiences (§10.4). Both stay spelled-out single queries, as the house
rule requires.

### 6.5 Retention for the mirror

- Rows with a Shopify id are **not** purged by the inactivity step (5e in `retention.ts`); the
  Shopify record governs their life. Chat-only Interessenten keep the current rule.
- **Dormant profiles:** AI profile text and data are cleared (the row stays) for customers with no
  activity and no consent for `CUSTOMER_PROFILE_DORMANT_DAYS` (default 1095, `0` disables, parsed by
  `retention-options.mjs`). A profile of someone who last bought five years ago serves no purpose.
- `customer_orders` follows the customer; `shopify_webhook_events` 30 days;
  `shopify_outbox` done rows 30 days, with the payload e-mail blanked once done.

### 6.6 What Pillar A retires

`campaign-sync.ts`, `shopify-customers.ts` (subscriber query), `/api/cron/sync-campaign-audience`,
`POST /api/admin/campaign/sync` (the desk's „Jetzt synchronisieren“ becomes a link to the
Shopify-Abgleich card), the per-e-mail purchase refresh in `refresh-customers` and
`CUSTOMER_REFRESH_BATCH`/`_STALE_HOURS`, and — after Pillar E — `campaign_contacts` itself.

---

## 7. Pillar B — one marketing consent

### 7.1 The concept

There is **one** consent: „E-Mail-Werbung von motion sports“, per person.

- **Shopify's `emailMarketingConsent` is the shared state** (D-2). Mo's surfaces write into it
  (through the outbox). Shopify's surfaces (checkout checkbox, account, newsletter form, Shopify
  Email footer, admin edits) write into it too.
- **Mo mirrors** the state on `customers` and logs every change in `consent_events`.
- **Mo keeps the Art. 7 evidence** for consents given on its surfaces in `email_captures`, unchanged:
  verbatim text, version stamp, DOI timestamps.

Blocks are **not** consent. Bounce, complaint and erasure stay in `suppression_list` as hard blocks:
consent says "may we", a block says "we must not / cannot".

### 7.2 State model (on `customers`)

| Column | Values |
| --- | --- |
| `email_consent_state` | `subscribed` · `pending` (Mo DOI mail sent, not yet clicked) · `unsubscribed` · `not_subscribed` |
| `email_consent_level` | `confirmed_opt_in` · `single_opt_in` · `unknown` |
| `email_consent_at` | Time of the deciding act (Shopify `consentUpdatedAt`, Mo `doi_confirmed_at`, unsubscribe time …) |
| `email_consent_source` | `mo_capture_form` · `mo_chat_gate` · `mo_signin` · `shopify` · `admin` · `import` |
| `email_consent_synced_at` | Last time Shopify was confirmed to hold the same state |

Shopify → Mo mapping:

| Shopify | Mo |
| --- | --- |
| `SUBSCRIBED` | `subscribed` |
| `PENDING` | `pending` |
| `UNSUBSCRIBED` | `unsubscribed` |
| `NOT_SUBSCRIBED` | `not_subscribed` |
| `INVALID` | `not_subscribed` + block `bounce` (the address is undeliverable) |
| `REDACTED` | erasure path (§8) |

UI labels: „Angemeldet (DOI)“, „Angemeldet (ohne DOI-Nachweis)“, „Bestätigung ausstehend“,
„Abgemeldet“, „Keine Einwilligung“, plus „Gesperrt: Bounce / Beschwerde / Gelöscht“.

`consent_events` (append-only): `customer_id`, `occurred_at`, `source`, `state`, `level`,
`origin_ref` (capture id / webhook id / admin-log id / outbox id), `note`. It is the
„Einwilligungsverlauf“ in Kunden → Marketing, and it is erased with the person.

### 7.3 The resolver (`consent-core.mjs`, pure, tested)

`resolveEmailConsent(current, incoming) → { next, changed, sideEffects }` with these rules:

1. **Hard blocks win.** An erasure or complaint block refuses any subscribe. The refusal is logged
   as an event with note „blockiert“. Exception: a *new* subscribe act **newer than** an erasure
   (a fresh DOI, or a Shopify subscribe with a later `consentUpdatedAt`) lifts the erasure block,
   because a person who deleted their data and later signs up again has given a new consent
   (lawyer to confirm, D-5).
2. **The newer act wins** (`email_consent_at`). On equal timestamps, the more restrictive state wins.
3. **No silent downgrade.** A Mo `pending` never overrides `subscribed`. Such a person is already
   subscribed, so no DOI mail is sent (§7.5).
4. **Echo is a no-op.** An incoming state equal to the current one only stamps `email_consent_synced_at`.
   Our own outbox writes coming back as webhooks therefore log nothing twice.
5. **The level follows the act**: a Mo DOI is `confirmed_opt_in`; a Shopify act carries Shopify's level.
6. **Side effects are declared, not performed**, and executed by the store:
   - An unsubscribe from either side inserts `suppression_list (reason unsubscribe | manual)`.
     This keeps the gates simple and survives the capture retention.
   - A newer genuine subscribe removes an `unsubscribe`/`manual` row, exactly the `liftOptOut` semantics.
   - A Mo-side change enqueues `consent_update` (or `customer_create`) in the outbox.

   The old rule "a local opt-out can never be undone by a sync" is replaced deliberately: both sides
   now hold the same consent, so a newer re-subscribe in Shopify is a real act. Admin edits in the
   Shopify backend count as acts of the shop; the event log records `source = shopify`.

### 7.4 Every flow, both directions

| Event | Mo | Shopify (via outbox) |
| --- | --- | --- |
| Capture form / chat gate / sign-in card with marketing | `email_captures` pending + DOI mail (unchanged); state `pending` — **unless already `subscribed`**: then no DOI mail, response `alreadyConfirmed: true` (field exists in the contract) | — |
| DOI confirmed (`/api/confirm-marketing`) | `subscribed` / `confirmed_opt_in` / `mo_*` | Shopify id known → `consent_update SUBSCRIBED CONFIRMED_OPT_IN consentUpdatedAt = doi_confirmed_at`; no id → `customer_create` with the consent (D-3), store the id |
| Unsubscribe link | suppression + capture `unsubscribed_at` + state `unsubscribed` | `consent_update UNSUBSCRIBED` |
| Admin „Abmelden“ | same, source `admin`, audit log unchanged | `consent_update UNSUBSCRIBED` |
| Admin „Abmeldung aufheben“ (mistake only, F-21) | restore the previous `subscribed` state from `consent_events` | `consent_update SUBSCRIBED` with the restored level |
| Resend complaint | block `complaint` + state `unsubscribed` (a spam click is a withdrawal) | `consent_update UNSUBSCRIBED` |
| Resend hard bounce | block `bounce` (deliverability, consent unchanged) | — |
| Shopify consent change (webhook or reconcile) | resolver → state, event, suppression add/remove | — |
| Erasure | §8 | `consent_update UNSUBSCRIBED` immediately, then `data_erasure` |

### 7.5 One eligibility gate (`marketing-eligibility.mjs`)

`evaluateEmailMarketing({ consentState, consentLevel, blocks, sendsApproved, allowSingleOptIn, lastMarketingSendAt, minIntervalDays, isTest })`
returns `{ ok, reason }`, with reasons in today's order: `not_approved`, `opt_in_level`, `suppressed`,
`too_soon`, plus `no_consent`.

It is the **only** rule, used by:

- the send path (one path after Pillar E),
- prepare / draft,
- the desk's Prüfpunkte (`campaign-review-checks.mjs` calls it instead of re-implementing it),
- the Kunden actions,
- Eingang suggestions,
- the audience counter (whose SQL mirrors the same conditions; a test keeps the reason list and the
  SQL comment in sync).

It fixes three things on the way:

- the frequency cap spans **all** marketing sends in both directions;
- the **copy path is gated** (consent + block + cap) and counts as a send;
- the fail-closed DB behaviour of `isSuppressed` is kept.

### 7.6 Widget surfaces (contract stays compatible)

- `/api/auth/me` → `marketing.status` keeps its values. `confirmed` now means `subscribed` from any
  source. `optInActionable` is `false` for a Shopify subscriber, which fixes the re-ask.
- The chat gate on an e-mail that is already subscribed → `alreadyConfirmed: true`, no DOI mail.
- `canPersonaliseSignedIn` collapses to `lawyerApproved && consentState === 'subscribed'`.
  `hasActiveCampaignSubscription` is retired.

### 7.7 Initial alignment („Erstabgleich“) — dry run first

1. A script (`npm run consent:align -- --dry-run`) computes the starting state for everyone through
   the resolver. Inputs: `email_captures`, `campaign_contacts`, `suppression_list`, and the
   Shopify import.
2. It reports four counts:
   - Mo-confirmed but not subscribed in Shopify → would be written;
   - unsubscribed in Mo but subscribed in Shopify → would be unsubscribed there;
   - Mo-only subscribers → would be created in Shopify;
   - conflicts.
3. The operator reviews the report in Einstellungen → Shopify-Abgleich and starts the real run with
   a confirm. Writes go through the outbox at the throttle's pace.

### 7.8 Copy and legal workstream (lawyer)

- **One wording** for the consent across Shopify (checkout checkbox, account registration, newsletter
  form; configured in the Shopify admin/theme) and Mo's surfaces (`consent-copy.ts`), so that one
  consent really means one purpose. Mo's text already includes personalisation from past chats and
  purchases. The Shopify checkbox text must say the same, or reference the privacy policy, which
  must describe it (F-05, F-20).
- Shopify does not store the text a customer saw. A config value `SHOPIFY_CONSENT_TEXT_VERSION` is
  stamped on every `consent_events` row with `source = shopify` as the best available evidence:
  "consent given on a Shopify surface while text version X was live".
- Privacy policy: bidirectional sync, the order ledger, profiling scope (D-1), postal advertising (D-7).

### 7.9 What Pillar B retires

`customers.marketing_status` (dropped one release after its last reader moves),
`syncCustomerConsent`, `canSendMarketing`/`loadEligibleCapture`/`loadEligibleCaptureByEmail` (folded
into the gate; `email_captures` stays as evidence), `campaign_contacts.opt_in_level`,
`hasActiveCampaignSubscription`, and the two „Chat-Newsletter / Shopify-Newsletter“ lines in
`OptOutControl.tsx`, which become one consent block with its history.

---

## 8. Pillar C — one deletion

### 8.1 Principle

An erasure request is addressed to motion sports as controller, not to "the chatbot" or "the shop".
It ends in the same state on both sides:

- **Mo erases immediately** (unchanged `erasePerson`, one transaction).
- **Shopify erases through its own process.** Shopify keeps order data required by law in redacted form.
- **Neither side can bring the person back** by a sync.

### 8.2 Triggers in Mo → Shopify

The widget button „Meine Daten löschen“, the mail link „Daten löschen“ and the admin „Löschen“ all run
`erasePerson`, then:

1. write an **erasure tombstone** `erasure_tombstones (shopify_customer_id, erased_at, shopify_confirmed_at)`;
2. enqueue `consent_update UNSUBSCRIBED`, which takes effect at once for every Shopify-side mailer;
3. enqueue `data_erasure` (`customerRequestDataErasure`).

A chat-only Interessent without a Shopify id is erased locally only, as today. The outbox payload
holds only the Shopify id, never the e-mail.

### 8.3 Triggers in Shopify → Mo

| Shopify event | Effect in Mo |
| --- | --- |
| `customers/redact` (compliance; the merchant or customer requested erasure in Shopify) | `erasePerson` matched **by Shopify id** (e-mail only as a cross-check, logged on mismatch); idempotent. The tombstone gets `shopify_confirmed_at` and is removed after 30 days. |
| `customers/delete` (the merchant deleted a customer without orders) | Same. |
| `customers/data_request` | Eingang item **„Datenauskunft angefordert“** with the export ready (`account-export.ts` extended by orders, consent events, facts, campaign participation and inbox items) and the deadline. |
| `shop/redact` | **Never** an automatic mass deletion. Eingang system item + Sentry alert + documented manual procedure, because a single-shop app receiving this means the app was uninstalled. |

**Re-import guard:** the bulk import, the reconciliation and the webhooks skip every Shopify id with a
tombstone. Today the guard is keyed by e-mail only (`listErasedEmails`); that stays as a second key,
via the `erasure` suppression row.

**Anomaly guard:** more than `SHOPIFY_ERASURE_ALERT_PER_HOUR` (default 20) erasures from webhooks in an
hour raises an alert. Processing continues, since erasure must not be delayed, but a bug that
mis-maps ids would be noticed within the hour.

### 8.4 Copy (lawyer, D-5)

- Erase page and widget: replace „Deine Bestellungen im Shop sind davon nicht betroffen“
  (`consent-copy.ts`) with wording along the lines of „Damit löschen wir alles … einschließlich deines
  Kundenkontos im Shop. Bestellungen bewahren wir nur auf, soweit wir gesetzlich dazu verpflichtet
  sind.“ Exact text to be approved.
- Admin confirm: „Löscht die Person vollständig in Mo und beantragt die Löschung des Kundenkontos in
  Shopify. Nicht umkehrbar.“

### 8.5 Erasure plan

Every new table (`customer_orders`, `customer_facts`, `consent_events`, `campaign_recipients`,
`inbox_items`, `shopify_outbox` payloads, `shopify_webhook_events` payload-free rows,
`erasure_tombstones` as a retained marker) gets its entry in `ERASURE_PLAN`. The existing test fails
otherwise.

---

## 9. Pillar D — Kunden, the central workspace

### 9.1 The job

„Wer ist diese Person, was wissen wir, was sollten wir tun?“ — for ≈ 20,000 people, most of whom never
chatted. The screen must be fast on the whole base, show every person at the depth their data
allows, and offer every marketing action from one place.

### 9.2 The list (server-side)

- `listCustomers(filter, sort, page)`: **one** spelled-out query over `customer_overview` with nullable
  parameters (`(${x}::text[] IS NULL OR col = ANY(${x}))`), sorted through `CASE` expressions on a
  whitelisted key, `count(*) OVER ()` for the total, 50 rows per page. The facet counts come from one
  aggregate query with `FILTER` clauses. Pure DB, no Shopify call.
- **URL state** (`docs/ADMIN_DASHBOARD.md` §2.2 extended): `?kq=` search, `?kview=` preset, `?kmo=`,
  `?kconsent=`, `?kseg=`, `?kvalue=`, `?kpersona=`, `?ksort=`, `?kpage=`, `?customer=`. The legacy
  `?filter=` presets map onto views. `admin-customer-filter.mjs` is rewritten as the parser/normaliser
  of these params (tested); it no longer filters arrays.
- **Ansichten (presets):**
  - Alle
  - Mit Mo gesprochen
  - Noch ohne Mo
  - Mit Einwilligung
  - Offene Aufgaben
  - Neu (30 Tage)
  - Top-Kunden
  - Abwanderungsgefahr
  - Interessenten (ohne Shopify-Konto)
  - Ohne Einwilligung, aber aktiv
- **Columns:**

  | Column | Content |
  | --- | --- |
  | Kunde | name + e-mail |
  | Mo | orb icon when chatted; Tooltip with count and date |
  | Einwilligung | badge |
  | Lebenszyklus | segment |
  | Umsatz | |
  | Bestellungen | |
  | Letzter Kauf | |
  | Letzte Aktivität | |
  | Persona | |
  | Aufgaben | count |

- **Selection and bulk actions:**
  - „Zu Kampagne hinzufügen…“ — over the selection **or over the whole filter result**
    („Alle 1.234 Treffer“), which passes the filter, not ids.
  - „Kaufprofile erzeugen…“ — paid; `useConfirm` with count and cost estimate.
  - The current bulk-draft bar becomes „Zu Einzelansprache hinzufügen…“ (§10.10).
- **Keyboard:** `/` focuses search (unchanged); `j`/`k` move through the list.

```
┌ Kunden ────────────────────────────────────────────────────────────────────────────────────┐
│ [Suche Name / E-Mail …]  Ansicht [Alle ▾]  Mo [Alle|Ja|Nein]  Einwilligung ▾  Zyklus ▾  Mehr ▾│
│ 18.412 Kunden · 2.104 mit Mo · 6.930 mit Einwilligung                    [Zu Kampagne …]     │
├────────────────────────────────────────────┬────────────────────────────────────────────────┤
│ Kunde            Mo  Einw.  Zyklus    Umsatz│ Anna Berger · anna@…           [Shopify ↗] ⋯   │
│ Anna Berger      ◉   DOI    Ausbauen 1.284 €│ ◉ Mit Mo gesprochen · Angemeldet (DOI) · Profi  │
│ Jonas Keller     –   –      Ruhen      89 € │ Kunde seit 03/2023 · 7 Bestellungen · 1.284 €   │
│ Lea Hoffmann     –   SOI    Weiterent. 412 €│ ┌ Nächster Schritt ──────────────────────────┐ │
│ …                                           │ │ Zubehör-Fenster: Rack vor 12 Tagen gekauft. │ │
│                                             │ │ [Entwurf öffnen]  [Später]  [Verwerfen]     │ │
│                                             │ └─────────────────────────────────────────────┘ │
│                                             │ Überblick · Aktivität · Käufe · Gespräche ·     │
│ ‹ 1 2 3 … 369 ›                             │ Marketing · Korrespondenz · Brief               │
└────────────────────────────────────────────┴────────────────────────────────────────────────┘
```

### 9.3 The detail

**Header:**

- name and e-mail, a link to the Shopify admin customer page;
- badges: Mo-Kontakt, Einwilligung, Lebenszyklus, Persona;
- one facts line: „Kunde seit 03/2023 · 7 Bestellungen · 1.284 € · letzter Kauf vor 34 Tagen“;
- actions: **E-Mail schreiben** (Einzelansprache), **Zu Kampagne…**, **Brief**, and ⋯ (Abmelden /
  Abmeldung aufheben, Profil neu erzeugen, Löschen).

Fixes the current name mismatch (the detail ignores the contact name the list shows).

**„Nächster Schritt“** card above the tabs: the top open Eingang item for this person, or „Vorschlag
erzeugen“ on demand (same generator, §11.4).

**Sub-tabs** (new order; all existing content keeps a place):

| Tab | Content |
| --- | --- |
| **Überblick** | Profile (AI summary + structured facts) with **Profiltiefe** and **Datenquellen** (§9.4); Kennzahlen (RFM, AOV, Intervall, nächster erwarteter Kauf, Rabatt-Affinität); Besitzt / Interessen / passendes Zubehör (`complement_handles` as product thumbnails); Mo summary or the no-chat state. |
| **Aktivität** | One timeline: orders, conversations, marketing sent / delivered / clicked / bounced, inbound mail, consent events, letters, feedback, Eingang decisions. Filter chips by type. |
| **Käufe** | All orders from the ledger (paged), items with product links, refunds, codes used. „Käufe aktualisieren“ becomes a webhook-fed status line with a manual re-sync of this one customer. |
| **Gespräche** | Today's „Beratungen“, renamed „Gespräche mit Mo“; same `TranscriptView`. |
| **Marketing** | Einwilligung (state, level, source, Verlauf), Sperren, campaign participation (campaign, status, sent, clicked, redeemed), the Einzelansprache card (the same review card as the desk), Sets. |
| **Korrespondenz** | Unchanged. |
| **Brief** | Unchanged, plus the objection flag (D-7). |

### 9.4 How missing data is handled (the majority case)

1. **Never an empty box.** Each section renders content or one line of state, e.g. „Noch keine
   Gespräche mit Mo — das Profil beruht auf 4 Bestellungen und 2 Kampagnen-Mails.“
2. **Datenquellen chips** on the profile: Bestellungen (n) · Gespräche (n) · E-Mails (n) ·
   Korrespondenz (n) · Kampagnen-Reaktionen (n). Missing sources are shown muted, with an InfoTip
   saying what each would add.
3. **Profiltiefe:**
   - **Fakten** — deterministic only; everyone.
   - **Kaufprofil** — AI from purchases and marketing reactions.
   - **Vollprofil** — AI including conversations and correspondence.

   The badge tells the operator how far to trust the picture. AI fields carry a confidence
   (`hoch | mittel | niedrig`, extension of `customer-profile-core.mjs`); low-confidence items are
   marked „unsicher“.
4. **Interessenten** (no Shopify record): „Noch kein Kunde im Shop“, with what the chat revealed
   (interests, products discussed).
5. **No consent:** e-mail actions are disabled with the reason („Keine Einwilligung für E-Mail-Werbung“).
   Brief (D-7) and replies to their own mails stay available.

### 9.5 AI in Kunden

| Feature | What | Phase |
| --- | --- | --- |
| Tiered profile | §9.6 | 4 |
| Nächster Schritt | Shared with Eingang (§11.4) | 6 |
| Expected next purchase | Deterministic: personal interval + `complement_handles`; shown as „Wahrscheinlich als Nächstes: …“ | 4 |
| Ähnliche Kunden | Profile embeddings (existing embedding infra) → „Als Zielgruppe verwenden“ | 7 |
| Frag Mo | Q&A over one customer's record („Welche Größe hat sie bestellt?“), answers cite timeline entries | 7 |

### 9.6 Profile tiers and cost

| Profiltiefe | Who | Model tier (`ai-models.mjs`) | ≈ cost | Trigger |
| --- | --- | --- | --- | --- |
| Fakten | everyone (D-6) | none | 0 | nightly + on change |
| Kaufprofil | customers with ≥ 1 order, within the D-1 scope | `writer` (Sonnet 5.5, effort low), compact input | ≈ $0.01–0.02 | new order / campaign reaction; backfill in batches |
| Vollprofil | Mo-Kontakte, customers with correspondence, the `großgerät` value tier, or on demand | `deep` (Opus 5.5), today's generator | ≈ $0.10 | new chat / mail / order (today's upkeep rule) |

No new model tier. `runProfileUpkeep` chooses the depth from the available sources and the value tier.
The light backfill is a separate, explicit budget (`CUSTOMER_PROFILE_LIGHT_BATCH`, default `0` = off;
recommended 500 per night). The full base at Kaufprofil depth costs ≈ $200–350 once.

---

## 10. Pillar E — Kampagnen: many campaigns, one pipeline

### 10.1 Concepts

| Kind (`kind`) | German | Audience | Example |
| --- | --- | --- | --- |
| `laufend` | Laufende Kampagne | **Dynamic**: re-evaluated nightly; new matches join, pending recipients who no longer match leave | Today's lifecycle campaign („Bestandskunden – Lebenszyklus“) |
| `aktion` | Aktion | **Fixed at start**, optional nightly additions until the end date | Black Friday, Frühjahrs-Sale, Produktlaunch |
| `einzel` | Einzelansprache | Hand-picked from Kunden / Eingang; exists exactly once, always active | One-to-one mails (replaces the Mo funnel's marketing drafts) |

Status lifecycle: `entwurf → geplant → aktiv ⇄ pausiert → beendet → archiviert`.

### 10.2 Data model

**`campaigns`**

| Column | Content |
| --- | --- |
| `name`, `slug` | |
| `kind`, `status` | §10.1 |
| `brief` | Kampagnenziel, Anlass, Tonalität, Pflichtinhalte, No-Gos: the campaign-level instructions to the drafter |
| `audience` (jsonb), `audience_mode` | §10.4 |
| `priority` | Conflicts, §10.7 |
| `starts_at`, `ends_at` | |
| `daily_target`, `auto_prepare_per_day` | |
| `reentry_days` | `laufend` only |
| `discount_percent`, `discount_scope` | Offer defaults |
| `discount_valid_until` | `aktion`: codes end with the campaign; else `MARKETING_DISCOUNT_EXPIRY_DAYS` |
| `bundle_policy` | |
| `design_key` | Replaces the single `email_design_selections.campaign`, which becomes the default for new campaigns |
| `hero_mode` | `none` · `default` · `ai_ab` · `ai_all` |
| `text_mode`, `language_policy` | |
| `mo_promo` | Boolean, default true |
| `cta_kind`, `cta_url` | `mo_chat` (today's deep link) or `shop` (cart/product link with a `_mo` attribution token, closing today's attribution gap); `utm_campaign = slug` |
| timestamps | |

**`campaign_recipients`** (replaces `campaign_contacts` as the queue)

| Column | Content |
| --- | --- |
| `campaign_id`, `customer_id` | |
| `test_inbox_id` | Exclusive with `customer_id` |
| `cycle` | Re-entry for `laufend` |
| `status` | `pending · drafted · sending · sent · skipped · excluded · draft_failed` |
| `excluded_reason` | |
| `segment` | Snapshot at materialisation |
| `ab_group` | Stored, no longer id parity |
| `added_at`, `sent_at`, `skipped_at` | |
| `conversation_id` | Optional, for Einzelansprache started from a chat; keeps the conversion sweep working |

Unique `(campaign_id, customer_id, cycle)`.

**`campaign_test_inboxes`**: the operator's addresses, global, with an optional `source_customer_id`
(today's borrowed purchase history).

Existing tables are re-keyed:

- `campaign_drafts.recipient_id` (unique; `contact_id` goes);
- `campaign_sends.campaign_id`, `recipient_id`, `customer_id`;
- `bundle_offers.campaign_recipient_id`;
- `ai_usage.campaign_recipient_id`.

The per-person language pin moves to `customers.language_override`: it is a property of the person,
not of a campaign.

**`sent` is terminal per campaign and cycle, not per person.** This removes today's "one campaign
mail per subscriber, ever".

### 10.3 State machine (pure `campaign-core.mjs`)

Today's transitions (`campaign-store.ts`: claim, revert, mark sent, skip/unskip, reset), keyed by
recipient instead of contact, plus:

- `excluded`: consent lost, block, or no longer matching a dynamic audience while still `pending`/`drafted`;
- re-entry: `sent` recipients of a `laufend` campaign whose `sent_at` is older than `reentry_days`
  get a new row with `cycle + 1`.

The atomic claim (`claimContactForSend`) is unchanged in spirit.

### 10.4 Audiences

**The spec** (jsonb, versioned; `audience-spec.mjs` validates, normalises and **describes** it in German):

```jsonc
{
  "v": 1,
  "optInLevels": ["confirmed_opt_in", "single_opt_in"],      // consent itself is implied for e-mail
  "lifecycle": ["ausbauen_frueh", "ausbauen", "weiterentwickeln"],
  "valueTier": ["komponente", "grossgeraet"],
  "lastOrderDays": { "min": 7, "max": 730 },
  "ordersCount": { "min": 1 },
  "totalSpentEur": { "min": 150 },
  "boughtAny": ["rudergeraet-x"],  "boughtNone": [],  "ownsComplementOf": [],
  "categories": ["kraft"],  "persona": [],  "moContact": "any",   // any | yes | no
  "language": ["de"],  "country": ["DE", "AT", "CH"],  "shopifyTags": [],
  "clickedWithinDays": null,
  "excludeMailedWithinDays": 14,  "excludeCampaigns": ["current-active"]
}
```

**Evaluation:** one store function `selectAudience(spec, { limit, offset })` over `customer_overview`.
It is the only place the predicates are written (nullable-parameter pattern, §9.2):

- the wizard preview uses it (total + 5 sample customers);
- materialisation pages through it and inserts recipients in chunks.

Consent and blocks are always part of it for the e-mail channel. The preview also reports **„n weitere
passen, sind aber nicht per E-Mail erreichbar (keine Einwilligung)“**, with „Per Brief erreichen…“
once D-7 is decided. That is what "campaigns for all customers" means in practice: audiences are
defined over everyone; each channel reaches whom it lawfully may.

```sql
-- shape only: the predicates are written once, parameters may be NULL
SELECT o.customer_id, count(*) OVER () AS total
  FROM customer_overview o
 WHERE o.email_consent_state = 'subscribed' AND NOT o.blocked
   AND (${levels}::text[]   IS NULL OR o.email_consent_level = ANY(${levels}))
   AND (${segments}::text[] IS NULL OR o.lifecycle_segment   = ANY(${segments}))
   AND (${minSpent}::bigint IS NULL OR o.total_spent_cents  >= ${minSpent})
   AND (${boughtAny}::text[] IS NULL OR o.bought_handles && ${boughtAny})
   AND (${moContact}::text  IS NULL OR (${moContact} = 'yes') = (o.conversations_count > 0))
 ORDER BY o.customer_id
 LIMIT ${limit} OFFSET ${offset}
```

**AI help:** „Zielgruppe beschreiben“ turns a sentence („Alle, die in den letzten zwei Jahren ein
Rudergerät gekauft, aber kein Zubehör dazu haben“) into a spec (`writer` tier, structured output,
validated by the core). The result is shown as editable chips with the live count. It never starts
anything by itself.

### 10.5 Content and offer per campaign

The drafter (`campaign-draft.ts`) loses its hard-wired "persönliche Empfehlung" frame. The prompt is
assembled from:

- campaign kind + **brief**;
- the recipient's profile, facts and purchases (unchanged inputs);
- **a summary of recent conversations when the person is a Mo-Kontakt** (today only the Mo-funnel
  drafter sees chats);
- the offer and the segment intro rule.

Subject fallback and the HTML heading come from the campaign. Everything deterministic stays
deterministic: code minting at send, scope resolution, set block, footer, unsubscribe and erase links.

### 10.6 Screens

**Kampagnen overview** (`?tab=kampagnen`, no campaign selected):

- a table of campaigns: Name · Art · Status · Zeitraum · Zielgruppe · Fortschritt (gesendet / gesamt)
  · Klickrate · Einlösungen · Umsatz;
- „Neue Kampagne“;
- the Einzelansprache pinned on top with its open drafts.

**Wizard** (full-width page, steps on the left, live summary on the right):

1. **Ziel** — name, Art, brief. „Brief vorschlagen“ drafts one from a one-line goal (`writer`).
2. **Zielgruppe** — filters or AI description, live count, sample, **overlap with other active
   campaigns**, the not-reachable count.
3. **Angebot** — Rabatt, Gilt für, Set-Politik, Gültig bis.
4. **Inhalt** — Design, Hero mode, Textmodus, Sprache, Mo-Hinweis, CTA.
5. **Ablauf** — Start/Ende, Tagesziel, Priorität, automatisch vorbereiten (n/Tag).
6. **Prüfen & testen** — three sample recipients drafted for real and sent to test inboxes; cost and
   time estimate (`estimateCampaignCosts`, per campaign).

„Kampagne starten“ (confirm) materialises the recipients.

**The desk** (`?tab=kampagnen&campaign=<id>[&contact=…&view=…&filter=…]`) is today's review desk,
unchanged in layout and shortcuts (`N P S X E R V C F / ?`):

- a campaign switcher and the campaign status sit in the header strip;
- counts, queue, Liste, Gesendet, Postausgang and KPIs are filtered by `campaign_id`;
- Vorbereiten defaults come from the campaign;
- the nightly prepare runs per active campaign within the global cap: `CAMPAIGN_AUTO_PREPARE_COUNT`
  becomes the daily maximum across campaigns, and the per-campaign number lives in the DB.

The legacy `?tab=kampagne` resolves to the overview, or straight to the only active campaign when
there is one.

### 10.7 Several campaigns at once

- **One contact policy:** at most one marketing e-mail per person per `MARKETING_MIN_SEND_INTERVAL_DAYS`
  across all campaigns, including Einzelansprache (F-13 asks the lawyer for a value; 14 days is the
  dossier's example).
- **Priority:** when a person is drafted in several active campaigns, the higher priority goes first.
  The others show the blocked Prüfpunkt „Sperrfrist: am … in Kampagne X angeschrieben“, or the hint
  „Auch in Kampagne Y vorgesehen“.
- **Overlap shown before start** (wizard step 2) with „Empfänger aktiver Kampagnen ausschließen“.
- **„Pausieren“** on the lifecycle campaign is one click during an Aktion. Its pending recipients wait;
  nothing is lost.

### 10.8 Test inboxes instead of test contacts

Today's Testkontakte are fake contacts in the queue. The new model:

- **„Testversand an…“** on any card sends that real recipient's draft — same code, set, links and
  tracking — to a chosen test inbox. The test is realistic without inventing a contact.
- Test sends keep `is_test` and stay out of KPIs (unchanged).
- The borrowed-history capability stays through `source_customer_id` for campaigns with no
  recipients yet.

### 10.9 Results per campaign

Funnel per campaign: gesendet → zugestellt → geklickt → eingelöst → Umsatz, split by segment and hero
variant. The KPI tab gets a campaign comparison table. Revenue is attributed by code → send →
campaign; the `MS5`/`MK` prefix split is no longer needed for that. Shop-CTA campaigns additionally
attribute through the `_mo` token (`ORDER_ATTRIBUTION.md`).

### 10.10 Einzelansprache — the 1:1 mail on the same pipeline (D-8)

- **Entry points:**
  - Kunden → „E-Mail schreiben“, with optional hints for Mo — today's `admin_instructions`, which stay
    on the customer as „Hinweise für Mo“;
  - Eingang → „Entwurf übernehmen“;
  - Kunden bulk „Zu Einzelansprache hinzufügen“.
- Each adds a recipient to the `einzel` campaign and drafts with the same generator (with chat
  context). The **same review card** renders inside Kunden → Marketing and on the desk. It is sent
  through the **same** send path.
- `marketing_sends` becomes history:
  - open drafts are migrated once into Einzelansprache recipients and drafts;
  - sent rows stay readable in Aktivität, Gesendet and KPIs;
  - they get the retention they lack today (F-10b): 365 days, like `campaign_sends`.
- New codes are `MK-`. The conversion sweep (`conversion-sweep.ts`, today `MS5-` only) learns `MK-`
  for recipients with a `conversation_id`.
- **Every** marketing send writes `email_messages`, so Korrespondenz and the timeline are complete.
  Today only the Mo funnel does.

### 10.11 Migrating today's campaign

1. Create campaign #1 „Bestandskunden – Lebenszyklus“ (`laufend`): audience = consent + sendable
   lifecycle window; offer and design from today's defaults; hero mode `ai_ab`.
2. Recipients from `campaign_contacts` (non-test):
   - `pending`, `drafted`, `sending`, `sent`, `skipped`, `draft_failed` → same;
   - `suppressed` → `excluded`.
3. Re-key drafts, sends, bundles and AI usage by join; move `language_override` to `customers`.
4. Test contacts → test inboxes (+ `source_customer_id`).
5. Switch the code to recipients. `campaign_contacts` stays readable for one release, then is dropped
   (§13, migration 0069).

Run it on a quiet morning with the desk idle. The migration is idempotent, with `IF NOT EXISTS` and
backfills guarded by `WHERE … IS NULL`.

### 10.12 Walkthrough: Black Friday (27.11.2026)

1. **Neue Kampagne** „Black Friday 2026“, Art `aktion`, 20.–30.11.
   - Brief: „Black Week: 20 % auf Kraft- und Cardio-Geräte, Zubehör 15 %; ehrlich, keine künstliche
     Verknappung; Bezug zum Besitz.“
2. **Zielgruppe:** all subscribed customers with a purchase in the last 3 years, excluding a mail in
   the last 10 days. The wizard shows n, the overlap with the lifecycle campaign (paused for the
   Black Week) and the not-reachable count.
3. **Angebot:** 20 %, „Gilt für: Empfehlungen“, codes valid until 30.11. 23:59 Berlin.
4. **Inhalt:** Black-Friday design and campaign hero; CTA `shop` (products, not the chat), Mo-Hinweis
   off or short.
5. **Ablauf:** start 17.11. (drafting ahead), Tagesziel 250, automatisch vorbereiten 300/Tag.
6. **Test** with three sample recipients → start.
7. The operator works through the desk as today, sending from 20.11. KPIs per campaign in real time.

If the volume exceeds what per-mail review can carry, that is D-10 (Serien-Mail), not a silent change.

Optional, same mechanism: an „Einwilligung bestätigen“ campaign (D-4) sends SOI subscribers a
re-confirmation through the existing DOI infrastructure, upgrading them to `confirmed_opt_in`. This
is the "DOI refresh" `CAMPAIGNS.md` already designates as the future path.

### 10.13 Option: Serien-Mail (only after D-10)

`content_mode = serie`:

- one master subject and body per language, written with Mo and approved by the operator;
- per recipient only deterministic blocks: greeting, recommended products from the existing picker,
  code, set;
- review = master approval + a forced sample (e.g. 20 rendered mails, all Prüfpunkte green);
- „Freigeben“ sends in throttled batches; every gate still runs per recipient at send time.

It needs the `approved` status `KAMPAGNE_REDESIGN.md` §13 already lists as "not built".

---

## 11. Pillar F — Eingang, the operator inbox

### 11.1 The job

The operator's start of the day: „Wer braucht uns heute, warum, und was ist der beste nächste
Schritt?“ One ranked list; each item decidable in under a minute; nothing sends without a click.

### 11.2 The item (`inbox_items`)

| Field | Content |
| --- | --- |
| `kind`, `customer_id` | `customer_id` is NULL for system items |
| `status` | `offen · zurückgestellt · erledigt · verworfen` |
| `priority` | Score |
| `dedupe_key` | Unique: kind + customer + window, so a nightly run never duplicates |
| `reason` | Deterministic German sentence |
| `evidence` | jsonb: order ids, conversation ids, send ids, numbers |
| `suggestion` | jsonb: action, channel, subject/body draft, discount proposal with reason, products — filled by AI or rules |
| `suggested_at`, `snoozed_until`, `decided_at`, `decision`, `decision_note` | |
| `outcome` | jsonb: message sent, order within 14 days, revenue — filled later |
| `expires_at`, timestamps | |

### 11.3 Item kinds (deterministic triggers, `customer-signals.mjs`, pure and tested)

| Kind | Label | Rule (initial thresholds, tuned by humans later) | Prio | Suggested action | Needs consent |
| --- | --- | --- | --- | --- | --- |
| `antwort_offen` | Antwort ausstehend | received mail, no sent reply in the thread after it, older than 24 h | hoch | reply with AI draft (Korrespondenz) | no (they wrote to us) |
| `nicht_zugeordnet` | E-Mail nicht zugeordnet | inbound mail with `customer_id IS NULL` (today's Posteingang) | hoch | assign; suggested match by sender/name | no |
| `datenauskunft` | Datenauskunft angefordert | `customers/data_request` | hoch | export + reply before the deadline | no |
| `kaufabsicht` | Kaufabsicht ohne Kauf | identified customer; chat in the last 7 days with a cart (`selected_handles`) or two chats about the same product; no order since | hoch | Einzelansprache with the discussed products, optional discount | yes |
| `unzufrieden` | Unzufriedenheit | refund/cancellation in 14 days, negative feedback, or chat analysis `unmet_need` for an identified customer | hoch | internal check (order, open question). Contact by mail only with consent, since a satisfaction/feedback mail counts as advertising under German case law (BGH, 10.07.2018, VI ZR 225/17; lawyer to confirm) | depends |
| `angebot_laeuft_ab` | Angebot läuft ab | sent code/set clicked, not redeemed, ends within 48 h (`offerValidity` already exists) | mittel | short reminder, no new discount | yes |
| `klick_ohne_kauf` | Geklickt, nicht gekauft | campaign click in the last 3 days, no order | mittel | follow-up with alternatives | yes |
| `zubehoer_fenster` | Zubehör-Fenster | order ≥ 150 € 7–30 days ago (the strongest measured window, 38.6 %, `REPURCHASE_ANALYSIS.md`), no mail since, not already queued in a campaign | mittel | complement mail, or add to the lifecycle campaign | yes |
| `wiederkauf_faellig` | Wiederkauf fällig | ≥ 3 orders, days since last > 1.25 × personal median interval and > 30 | mittel | reminder of the usual products | yes |
| `abwanderung` | Abwanderungsgefahr | value tier ≥ komponente or ≥ 3 orders; days since last > 2 × median interval, between 180 and 730 | mittel | win-back offer, or letter | yes / letter (D-7) |
| `top_kunde` | Top-Kunde | lifetime top 1 %, or an order ≥ 1,500 € in the last 14 days | niedrig | personal thank-you, no discount (letter or mail) | letter: D-7; mail: yes |
| `einwilligung_fehlt` | Aktiv, ohne Einwilligung | ≥ 2 orders in 12 months or a Mo-Kontakt; no consent; no objection | niedrig | nothing by mail; optional letter with a newsletter invitation (D-7) | — |
| `zustellproblem` | Zustellproblem | hard bounce for a customer with an order in 12 months | niedrig | check the address in Shopify | — |
| `abgleich_konflikt` | Abgleich-Konflikt | merge conflict, consent conflict or outbox dead letter | mittel | resolve | — |

**System items** (aggregate cards at the top, absorbing Übersicht „Heute“):

- Kampagnen mit Entwürfen zur Prüfung (per campaign)
- offene Wissen-Fragen
- laufende Analysen / Verbesserungsläufe
- Shopify-Abgleich gestört (last webhook too old, reconcile failed, outbox dead letters)

### 11.4 The pipeline

1. **Signals.** Nightly after facts (`/api/cron/inbox`), plus event-driven for the urgent kinds
   (inbound mail, refund webhook, chat end with a cart). The core returns candidate items; the store
   upserts by `dedupe_key` and expires items whose condition is gone.
2. **Ranking.** Priority = kind weight × value tier × recency. One function in the core; the tests
   pin the order.
3. **AI suggestion** for the top `INBOX_AI_DAILY_LIMIT` new customer items (default `0`: spending is
   the deployment's decision, as with `CAMPAIGN_AUTO_PREPARE_COUNT`; recommended 25). Plus on demand
   with „Vorschlag erzeugen“. `writer` tier, structured output:

   ```
   { warum (2 Sätze), aktion, kanal, betreff?, text?,
     rabatt { prozent, begruendung }?, produkte[] }
   ```

   Input: facts, profile, the item's evidence, the eligibility verdict (the model is told what is not
   allowed). No code is minted and no recipient is created until the operator accepts.
4. **Decision.**
   - „Entwurf übernehmen“ creates an Einzelansprache recipient with the suggested draft as the first
     version and opens the review card.
   - Other actions: „Zur Kampagne…“, „Brief“, „Antworten“, „Erledigt“, „Später“ (3 / 7 / 30 days),
     „Verwerfen“ (reason chips: passt nicht, schon erledigt, falscher Zeitpunkt, anderes).
5. **Outcome.** 14 days after a decision the nightly job fills `outcome`: message sent, opened link,
   order, revenue.

### 11.5 Screen

`SplitPane`:

- **Left:** the list grouped „Jetzt“ / „Diese Woche“ / „Später“, chips by kind with counts, and a
  compact strip of the 30-day numbers that used to be the Übersicht (link to KPIs).
- **Right:** the item — reason with evidence links, the customer mini-card (facts, profile excerpt,
  Datenquellen, Einwilligung), the suggestion with a rendered preview, and the action buttons.

Keyboard: `j`/`k` move, `Enter` opens the primary action, `E` erledigt, `Z` später, `D` verwerfen,
`Esc` back. These keys are scoped to the screen, like the Kampagne keys.

```
┌ Eingang ───────────────────────────────────────────────────────────────────────────────────┐
│ Kampagnen: 38 Entwürfe (Black Friday 31 · Lebenszyklus 7) · Wissen 4 · Abgleich ok          │
│ [Alle 23] [Antwort ausstehend 3] [Kaufabsicht 5] [Angebot läuft ab 4] [Zubehör 6] …        │
├──────────────────────────────────────┬─────────────────────────────────────────────────────┤
│ JETZT                                 │ Kaufabsicht ohne Kauf — Lea Hoffmann                │
│ ● Antwort ausstehend · M. Weber  26 h │ Hat am 28.09. zweimal mit Mo über das Rudergerät X  │
│ ● Kaufabsicht · Lea Hoffmann          │ gesprochen und es in den Warenkorb gelegt; seitdem  │
│ DIESE WOCHE                           │ keine Bestellung. Angemeldet (DOI). Kaufprofil.     │
│ ● Angebot läuft ab · J. Brandt  36 h  │ Vorschlag: persönliche Mail mit Rudergerät X +      │
│ ● Zubehör-Fenster · A. Berger         │ passender Matte, 5 % (Preis war im Chat ein Thema). │
│ …                                     │ [Entwurf übernehmen] [Später ▾] [Verwerfen ▾]       │
└──────────────────────────────────────┴─────────────────────────────────────────────────────┘
```

### 11.6 Learning loop

- Per kind: acceptance rate, dismissal reasons, and 14-day conversion of acted items versus comparable
  untouched items (descriptive, with an honesty caveat, like the KPI tab).
- Shown in KPIs → Eingang.
- Fed to Verbesserung as a third lane „Marketing“ that **proposes** threshold changes. A human
  decides, exactly the rule `CAMPAIGNS.md` sets for the segment boundaries.

### 11.7 Guardrails

- Items never send.
- Suggestions respect the eligibility gate.
- No items for erased or blocked persons.
- Items carry ids, not e-mails.
- Retention: decided items purge after `INBOX_RETENTION_DAYS` (default 180, `0` disables).
- Erasure deletes a person's items.

---

## 12. Further restructuring the mission calls for

### 12.1 Navigation

Positions and shortcuts are kept:

| Key | Today | New | `?tab=` |
| --- | --- | --- | --- |
| 1 | Übersicht | **Eingang** | `eingang` (bare `/admin`; `overview` resolves) |
| 2 | Kampagne | **Kampagnen** | `kampagnen` (`kampagne` resolves) |
| 3 | Kunden | Kunden | `kunden` |
| 4 | Wissen | Wissen | `wissen` |
| 5–9, 0 | KPIs · Gespräche · Feedback · Analyse · Verbesserung · Einstellungen | unchanged | |

Sidebar badges:

- Eingang: open high-priority items;
- Kampagnen: drafted across active campaigns;
- Kunden: none (the unmatched-mail count moves to Eingang);
- Wissen: unchanged.

`admin-tabs.mjs` and its test, `tabs.tsx`, `lazy.tsx` and `page.tsx` change as `CLAUDE.md` „Adding a
screen“ describes.

### 12.2 Übersicht → Eingang (D-9)

The „Heute“ cards become system items, the 30-day numbers become the strip, and the activity lists
become the Aktivität filter in the Eingang. Nothing is lost (§18).

### 12.3 KPIs regrouped around customers

New toolbar groups:

- **Kundenbasis** (new):
  - Kunden gesamt, mit Einwilligung (quote, level mix);
  - new consents by source (Shopify surfaces vs. Mo surfaces, which shows Mo's contribution to list
    growth);
  - Mo-Reichweite (% of customers who are Mo-Kontakte);
  - über Mo gewonnene Kunden (`source = chat` with an order);
  - lifecycle distribution.
- **Kampagnen** — per campaign + comparison.
- **Eingang** — §11.6.
- **Mo (Chat)** — today's chat sections, unchanged.
- **Umsatz**, **Kosten**, **Gesamtwerte**.

New section **„Mo-Effekt“**: order frequency, AOV and repurchase of Mo-Kontakte vs. comparable
customers without a chat, matched by value tier and lifecycle, with an explicit selection-bias caveat.

The Shopify-fan-out sections keep the `kpi-cache.ts` rule. The new ones are pure DB, since the ledger
is local, and so are never cached.

### 12.4 Gespräche

An identified conversation shows „Kunde öffnen“ (`?tab=kunden&customer=`). The list gets a „Kunde“
column (name for identified conversations, nothing for anonymous ones). The pseudonymous default stays.

### 12.5 The chat as a data source (widget, additive contract)

- **`mo_c` capture:** the widget sends the campaign token from the deep link at session start. This
  connects campaign click → chat → order (the open item in `CAMPAIGNS.md` „Chat-Start“).
- **Chat signals into facts** the moment an identified customer chats (discussed/selected products,
  analysis quality), so `kaufabsicht` fires the same day.
- **Signed-in shop customers** are known from day one: profile and facts exist before their first
  chat. Personalisation still requires consent + `CONSENT_COPY_LAWYER_APPROVED`.
- **Subscribers** never see the consent gate or the sign-in opt-in card again (§7.6).

### 12.6 Analyse and Verbesserung

- The Komplettanalyse gets chapters „Kundenbasis“ and „Kampagnen“ (results per campaign, segment
  and trigger).
- Verbesserung gets the third lane „Marketing“: offers, segments, triggers, send times. Proposals only.

### 12.7 Shopify write-back (D-11, Phase 7)

Customer metafields `mo.segment`, `mo.persona`, `mo.next_action` and/or tags `mo-…`, through the
outbox kind `writeback`. Shopify Flow, Shopify Email or another tool could then use Mo's intelligence.
Off by default.

### 12.8 Data model docs and the cluster model

`DATABASE.md` / `DATA_RETENTION.md` still say "the e-mail lives in exactly one place". That stopped
being true with `customers` and `campaign_contacts`. New model:

- **Cluster A** — pseudonymous chats and telemetry (unchanged).
- **Cluster K** — the Kundenstamm: customers mirror, orders, facts, profiles, inbox. Contract or
  legitimate interest; profiling per D-1.
- **Cluster B** — consent and marketing: consent events, captures, suppression, campaigns, sends.

`conversations.customer_id` stays the one consent-anchored bridge from A to K.

### 12.9 Clean-ups found on the way

- Imported rows' `identity_tier`.
- The detail-header name.
- The duplicate index `campaign_sends_email_sent_idx`.
- The one-directional frequency cap and the ungated copy path (§7.5).
- `campaign-segments.mjs` claims a DB check constraint that does not exist.
- `ADMIN_DASHBOARD.md` "no cap".
- The `CAMPAIGNS.md` drift (§3).

### 12.10 Einstellungen → „Shopify-Abgleich“

New card:

- import status and „Kundenstamm importieren“;
- last webhook per topic;
- reconciliation result;
- outbox (pending / failed / dead, with retry);
- tombstones awaiting Shopify confirmation;
- the Erstabgleich dry-run report and start (§7.7).

Systemstatus gains `write_customers` (checked via `currentAppInstallation.accessScopes`, extending
`verify-shopify-auth.mjs`) and the webhook secret.

### 12.11 Retention summary (new and changed)

| Data | Window | Env (0 disables) |
| --- | --- | --- |
| `customers` with a Shopify id | lifetime of the Shopify record | — |
| AI profile of dormant, non-consented customers | 1095 days without activity | `CUSTOMER_PROFILE_DORMANT_DAYS` |
| `customer_orders`, `customer_facts`, `consent_events` | with the customer | — |
| `campaign_recipients` of ended campaigns | 365 days after `ends_at` | `CAMPAIGN_CONTACT_RETENTION_DAYS` (reused) |
| `marketing_sends` (history) | 365 days by `sent_at`/`created_at` | `CAMPAIGN_CONTACT_RETENTION_DAYS` (reused) |
| `inbox_items` decided | 180 days | `INBOX_RETENTION_DAYS` |
| `shopify_webhook_events` | 30 days | `SHOPIFY_WEBHOOK_EVENT_RETENTION_DAYS` |
| `shopify_outbox` done | 30 days (e-mail blanked at completion) | `SHOPIFY_OUTBOX_RETENTION_DAYS` |
| `erasure_tombstones` | until Shopify confirms + 30 days | — |

All parsed by `retention-options.mjs` (tested), each step skipped at 0.

---

## 13. Data model: migrations

Forward-only, plain DDL (no dollar-quoting), run manually by the maintainer. Numbers continue after
`0060`. Every migration is idempotent (`IF NOT EXISTS`, backfills guarded by `IS NULL`).

| # | File | Content |
| --- | --- | --- |
| 0061 | `customer_mirror.sql` | `customers` + `first_name`, `last_name`, `locale`, `country_code`, `language_override`, `shopify_state`, `shopify_tags TEXT[]`, `shopify_created_at`, `shopify_updated_at`, `shopify_synced_at`, `facts_dirty_at`, `postal_objection_at`. `source` check extended by `shopify`; `kampagne`/`shopify_account` → `shopify`. Backfill Shopify ids (numeric + GID), names and language pins from linked `campaign_contacts`. |
| 0062 | `customer_orders.sql` | `customer_orders` (§6.3); indexes `(customer_id, processed_at DESC)`, `(shopify_customer_id)`, GIN `(discount_codes)`. |
| 0063 | `customer_facts.sql` | `customer_facts` (§6.4) with indexes on the filter columns, GIN on `bought_handles`; view `customer_overview`. |
| 0064 | `email_consent.sql` | `customers` consent columns (§7.2) + index `(email_consent_state, email_consent_level)`; `consent_events`. The backfill runs in the script (§7.7), so the rules live in one core. |
| 0065 | `shopify_sync.sql` | `shopify_webhook_events`, `shopify_outbox`, `shopify_sync_runs`, `erasure_tombstones`. |
| 0066 | `campaigns.sql` | `campaigns`, `campaign_recipients`, `campaign_test_inboxes`; `campaign_drafts.recipient_id` (unique) + `contact_id` nullable; `campaign_sends.campaign_id/recipient_id/customer_id/conversation_id`; `bundle_offers.campaign_recipient_id`; `ai_usage.campaign_recipient_id`. Backfill campaign #1 and its recipients (§10.11). |
| 0067 | `inbox.sql` | `inbox_items` + indexes `(status, priority DESC)`, `(customer_id)`, unique `(dedupe_key)`. |
| 0068 | `marketing_unify.sql` | Migrate open `marketing_sends` drafts into Einzelansprache; `email_messages.campaign_send_id`; drop the duplicate campaign index. |
| 0069 | `drop_legacy.sql` | **One release later:** drop `campaign_contacts` (after re-pointing remaining FKs), `campaign_drafts.contact_id`, `customers.marketing_status`, `customers.purchase_summary*`; `source` check without the legacy values. |

Sketch of the two central new tables:

```sql
CREATE TABLE IF NOT EXISTS campaigns (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name                 TEXT NOT NULL,
  slug                 TEXT NOT NULL UNIQUE,
  kind                 TEXT NOT NULL CHECK (kind IN ('laufend','aktion','einzel')),
  status               TEXT NOT NULL DEFAULT 'entwurf'
                         CHECK (status IN ('entwurf','geplant','aktiv','pausiert','beendet','archiviert')),
  brief                TEXT,
  audience             JSONB,
  audience_mode        TEXT NOT NULL DEFAULT 'fest' CHECK (audience_mode IN ('dynamisch','fest')),
  priority             INTEGER NOT NULL DEFAULT 0,
  starts_at            TIMESTAMPTZ,
  ends_at              TIMESTAMPTZ,
  daily_target         INTEGER,
  auto_prepare_per_day INTEGER NOT NULL DEFAULT 0,
  reentry_days         INTEGER,
  discount_percent     INTEGER NOT NULL DEFAULT 0,
  discount_scope       TEXT NOT NULL DEFAULT 'all' CHECK (discount_scope IN ('all','recommendations','set')),
  discount_valid_until TIMESTAMPTZ,
  design_key           TEXT,
  hero_mode            TEXT NOT NULL DEFAULT 'none' CHECK (hero_mode IN ('none','default','ai_ab','ai_all')),
  text_mode            TEXT CHECK (text_mode IN ('detailed','compact','minimal')),
  mo_promo             BOOLEAN NOT NULL DEFAULT true,
  cta_kind             TEXT NOT NULL DEFAULT 'mo_chat' CHECK (cta_kind IN ('mo_chat','shop')),
  cta_url              TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS campaigns_one_einzel ON campaigns (kind) WHERE kind = 'einzel';

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id     BIGINT NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  customer_id     BIGINT REFERENCES customers (id) ON DELETE CASCADE,
  test_inbox_id   BIGINT REFERENCES campaign_test_inboxes (id) ON DELETE CASCADE,
  cycle           INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','drafted','sending','sent','skipped','excluded','draft_failed')),
  excluded_reason TEXT,
  segment         TEXT,
  ab_group        TEXT CHECK (ab_group IN ('a','b')),
  conversation_id BIGINT REFERENCES conversations (id) ON DELETE SET NULL,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ,
  skipped_at      TIMESTAMPTZ,
  CHECK ((customer_id IS NULL) <> (test_inbox_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_recipients_unique
  ON campaign_recipients (campaign_id, customer_id, cycle) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS campaign_recipients_queue ON campaign_recipients (campaign_id, status, id);
CREATE INDEX IF NOT EXISTS campaign_recipients_customer ON campaign_recipients (customer_id);
```

(`campaign_test_inboxes` is created before `campaign_recipients` in the same file.)

---

## 14. Code map: new, changed, retired

**New pure cores** (`src/lib/*.mjs`, each with `*.test.mjs`):

| Core | Responsibility |
| --- | --- |
| `shopify-bulk-core.mjs` | JSONL lines → customer/order/line rows (`__parentId` handling) |
| `shopify-customer-map.mjs` | Webhook/GraphQL customer and order payloads → mirror rows; Shopify ↔ Mo consent mapping |
| `consent-core.mjs` | `resolveEmailConsent` (§7.3) |
| `marketing-eligibility.mjs` | The one gate (§7.5); replaces `campaign-gates.mjs` |
| `customer-facts-core.mjs` | Facts (§6.4), reusing `campaign-segments.mjs` and `repurchase-analysis.mjs` |
| `customer-fk-plan.mjs` | FK registry for merges (+ migration-parsing test) |
| `audience-spec.mjs` | Validate / normalise / describe audiences; spec → parameter tuple |
| `campaign-core.mjs` | Recipient state machine, materialisation diff, re-entry |
| `customer-signals.mjs` | Inbox kinds, thresholds, ranking |
| `outbox-core.mjs` | Backoff, dead-letter rule, idempotency keys |
| `admin-customer-filter.mjs` | Rewritten: URL params ↔ normalised server filter |

**New TypeScript (I/O):**

- `shopify-sync.ts` (import + reconcile)
- `shopify-webhook-customers.ts` (handlers)
- `shopify-outbox.ts`
- `customer-orders-store.ts`
- `customer-facts-store.ts`
- `consent-store.ts`
- `customer-list-store.ts`
- `campaigns-store.ts` (+ refactor of `campaign-store.ts` to recipients)
- `audience-store.ts`
- `inbox-store.ts`
- `inbox-suggest.ts`
- `customer-merge-store.ts`

All follow the store rules: `sql = getSql()` last, null-safe fallback, `try/catch` + `reportError`.

**Routes:**

- Extended: `/api/webhooks/shopify` (topics §6.2, compliance §8.3).
- New crons (in `vercel.json`): `/api/cron/shopify-reconcile`, `/api/cron/shopify-outbox` (every
  5 min), `/api/cron/inbox`. `refresh-customers` becomes facts + profile upkeep.
- New admin routes (all with `guardAdminPost`/`guardAdminGet`):
  - `/api/admin/shopify/{import,import-step,align}`
  - `/api/admin/customers/list`
  - `/api/admin/customers/next-step`
  - `/api/admin/campaigns/{create,update,start,pause,end,archive,audience-preview,audience-from-text,brief-suggest,test-send}`
  - `/api/admin/inbox/{list,decide,snooze,suggest}`
- Changed: the existing `/api/admin/campaign/*` take a `campaignId` and key by recipient.

**Retired** (after their phase):

- `campaign-sync.ts`, the `shopify-customers.ts` subscriber query
- `/api/cron/sync-campaign-audience`, `/api/admin/campaign/sync`, `/api/admin/campaign/test-contacts`
  (→ test inboxes)
- `marketing-draft.ts` + `marketing-email.ts` (`approveAndSend`)
- `/api/admin/customers/marketing-draft`, `/api/admin/marketing/*` (→ Einzelansprache)
- `syncCustomerConsent`, `hasActiveCampaignSubscription`, `canSendMarketing` as a separate gate
- `campaign-gates.mjs` (folded into eligibility)
- the per-e-mail purchase refresh

Each is removed in the phase that replaces it, with the `FEATURE_INVENTORY.md` mapping (§18).

---

## 15. Delivery plan

### 15.1 Phases

Sizes: S ≈ days, M ≈ 1 week, L ≈ 2 weeks, XL > 2 weeks of focused work. Every phase ends with
`npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm test`; UI phases add Playwright screenshots
(1440/1024 px, light/dark) in the PR.

**Phase 0 — Decisions and Shopify setup (S, mostly not code)**

- Lawyer addendum (D-1, D-3–D-7, copy §7.8/§8.4).
- Maintainer decisions D-2, D-8–D-12.
- Shopify app: `write_customers`, protected-data fields confirmed, compliance topics in the app
  configuration, webhook subscriptions (script `npm run shopify:webhooks`, idempotent via
  `webhookSubscriptionCreate`).
- Shopify DOI setting on (D-4).
- Verify the mutations on a development store (§6.2 box).
- *Done when:* decisions recorded in this file's §4, scopes visible in Systemstatus.

**Phase 1 — Kundenstamm (L)** — migrations 0061–0063, 0065 (sync tables)

- Bulk import, webhooks (customer + order topics), reconciliation, ledger, facts core + nightly facts.
- `customer_overview`.
- **Kunden list server-side over everyone** (new filters/views, URL state, pagination); the detail
  shows ledger orders.
- Read-only towards Shopify.
- Flag `SHOPIFY_CUSTOMER_SYNC_ENABLED`.
- *Done when:* the list shows the full base (count matches Shopify ± customers created during the
  import), a new Shopify order appears in Käufe within a minute, the nightly reconcile reports 0
  drift on a second run, and the list renders < 1 s for any filter on the full base.

**Phase 2 — Eine Einwilligung (L)** — migration 0064

- Consent columns + events, resolver, webhooks for consent, outbox (consent_update, customer_create),
  Erstabgleich (dry run → run).
- The one gate in both existing send paths (fixes the cap direction and the copy path).
- Widget surfaces (§7.6); erasure → Shopify unsubscribe already here (§8.2 step 2).
- Kunden: one consent block with history.
- Flags `SHOPIFY_CONSENT_WRITEBACK`.
- *Done when:* every row of §7.4 is covered by a test of the core plus one end-to-end check on the
  development store: unsubscribe in Mo shows `UNSUBSCRIBED` in Shopify within 5 minutes and the
  reverse within 1 minute (webhook); a Shopify subscriber is not asked to opt in by the widget.

**Phase 3 — Kampagnen (XL, split in 3a/3b)**

- **3a** (migration 0066): campaigns + recipients + migration of today's campaign; desk scoped by
  campaign; test inboxes; per-campaign design/hero/offer/brief in the drafter; the conflict rules.
- **3b**: Kampagnen overview + wizard + audience spec/preview/AI description + per-campaign KPIs.
- *Done when:* campaign #1 runs exactly as before on the desk (regression: send, skip, regenerate,
  sets, hero A/B, Gesendet), and a second campaign can be defined, started, reviewed and sent next to
  it with the cap enforced across both.

**Phase 4 — Eine Löschung (M)** (can run in parallel with Phase 3)

- Tombstones, `data_erasure` outbox, `customers/redact|delete|data_request`, `shop/redact` handling,
  anomaly guard, export extension, new copy (after lawyer).
- Flag `SHOPIFY_ERASURE_SYNC`.
- *Done when:* erasing in Mo leads to the Shopify erasure request, and a `customers/redact` test
  payload erases the person in Mo with the `ERASURE_PLAN` test green.

**Phase 5 — Kunden-Arbeitsplatz (L)**

- Detail redesign (§9.3), Aktivität timeline, Datenquellen/Profiltiefe, tiered profiles + light
  backfill, expected next purchase.
- Einzelansprache card in Marketing (needs 3a).
- Migration 0068 (marketing unification) and retirement of the Mo-funnel draft/send path.
- *Done when:* a customer without any chat has a complete, readable detail (Fakten + Kaufprofil,
  timeline, Käufe), and a 1:1 mail from Kunden goes through the campaign pipeline.

**Phase 6 — Eingang (L)** — migration 0067

- Signals core, items, AI suggestions, screen, navigation change (Übersicht → Eingang, Posteingang
  absorbed), outcomes.
- *Done when:* the nightly run produces deduplicated items for all kinds in §11.3 on seed data, every
  action works, and the outcome job fills results.

**Phase 7 — Insights and extras (M each, independent)**

- KPIs regroup + Mo-Effekt, Analyse/Verbesserung lanes, `mo_c` widget capture (frontend repo),
  Ähnliche Kunden, Frag Mo, Shopify write-back (D-11), Brief as campaign channel (D-7), Serien-Mail
  (D-10), migration 0069 (legacy drop).

### 15.2 Dependencies

```
P0 ─► P1 ─► P2 ─► P3a ─► P3b ─► (Black Friday)
             │      └──► P5 ─► P6 ─► P7
             └─► P4 (parallel to P3)
```

### 15.3 The Black Friday path

The campaign has to be live by 20.11.2026, with drafting from ≈ 17.11. That puts P1 + P2 + P3a + P3b
on the critical path, ≈ 6–7 weeks from now.

**Fallback if it slips:** P3a does not strictly need P1/P2. Every Shopify subscriber and every
DOI-confirmed chat contact already has a `customers` row (0059 + capture linking). So P3a can be built
on the existing data, with a local consent resolver over `email_captures` + `campaign_contacts`
(P2 without the Shopify write-back). Black Friday then runs as campaign #2 with a simpler audience
(subscribed + last order window + value), and the full audience filters follow with P1.

**Decide by 20.10.** whether to take the fallback.

---

## 16. AI usage and cost

| Use | Tier | Volume | ≈ cost | Switch |
| --- | --- | --- | --- | --- |
| Kaufprofil (backfill) | writer | ≈ 18 k once | $200–350 once | `CUSTOMER_PROFILE_LIGHT_BATCH` (0 = off) |
| Kaufprofil upkeep | writer | customers with new orders, ≈ 30–80/day | < $2/day | same |
| Vollprofil upkeep | deep | Mo-Kontakte/correspondence with new activity, today's rule | ≈ $3/day at 30 | `CUSTOMER_PROFILE_BATCH` (unchanged) |
| Inbox suggestions | writer | top N/day + on demand | ≈ $0.01–0.02 each | `INBOX_AI_DAILY_LIMIT` (0 = off) |
| Audience from text, brief suggestion | writer | on click | cents | — |
| Campaign drafts | writer | per recipient, as today | measured, shown in the wizard (`estimateCampaignCosts`) | per campaign `auto_prepare_per_day` + `CAMPAIGN_AUTO_PREPARE_COUNT` (global max) |
| Facts, signals, ranking, audiences | none | everyone | 0 | — |

Costs are estimates from `AI_MODELS.md` prices; every call records `ai_usage` with a new `call_site`
(`customer_profile_light`, `inbox_suggestion`, `audience_from_text`, `campaign_brief`), so the KPI cost
section shows real numbers from day one.

---

## 17. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Protected-customer-data approval or `write_customers` delayed | Phase 1 is read-only (needs only `read_customers`, already used). The write-back flags stay off until the scope is granted. |
| Webhooks lost or out of order | Dedupe + `updated_at` stale guard + nightly reconciliation + 200-after-record. |
| Consent echo loops between the two systems | Resolver rule 4 (equal state = no-op); outbox writes are idempotent target states. |
| Wrong person erased by a webhook | Match by Shopify id only, e-mail cross-check logged; anomaly alert per hour; `shop/redact` never auto-wipes. |
| Re-import of an erased person before Shopify redacts | Tombstones by Shopify id + `erasure` suppression by e-mail. |
| Mass consent change on the first alignment | Mandatory dry run with counts, operator confirm, throttled outbox. |
| Campaign migration during live operation | Idempotent migration, desk idle, regression checklist (P3 "done when"), `campaign_contacts` kept one release. |
| Kunden list slow on the full base | `customer_overview` over indexed facts columns; pagination; facets in one aggregate query; measured in the P1 acceptance criteria. |
| AI cost overrun | Every generator behind an explicit cap, defaulting to 0 where it runs unattended; `ai_usage` per call site. |
| Legal: profiling non-consented customers | D-1 default `consented` (AI profiles); the mirror, ledger and facts wait for D-6 (Phase 1 does not start without it). |
| Operator overwhelmed by inbox items | Dedupe windows, daily ranking, „Später“, per-kind thresholds tuned through the learning loop; start with the high-precision kinds (`antwort_offen`, `kaufabsicht`, `angebot_laeuft_ab`). |
| Merging two customer rows loses data | `CUSTOMER_FK_PLAN` test over all migrations; merge in one transaction; conflict → Eingang item instead of a guess. |

---

## 18. Feature inventory impact

No capability is removed (`CLAUDE.md`: removal needs an explicit decision). These capabilities **move**:

| Today (FEATURE_INVENTORY) | Moves to |
| --- | --- |
| Übersicht „Heute“ cards, 30-day numbers, activity feeds | Eingang system items, numbers strip, Aktivität (D-9) |
| Kunden „Posteingang“ (unmatched inbound) | Eingang kind `nicht_zugeordnet` |
| Kunden → Marketing draft/send (Mo funnel, `MS5-`) | Einzelansprache card, same place in Kunden (D-8) |
| Kunden bulk-draft bar | „Zu Einzelansprache hinzufügen…“ on the selection or filter |
| Kampagne „Jetzt synchronisieren“ | Shopify-Abgleich (Einstellungen), continuous via webhooks |
| Kampagne Testkontakte | Test inboxes + „Testversand an…“ (+ borrowed history) |
| Kampagne global desk | The same desk per campaign |
| Tier badge in Kunden | Shopify-Kunde / Interessent / Mo-Kontakt badges (tier stays in Gespräche) |
| „Chat-Newsletter“ + „Shopify-Newsletter (Kampagne)“ lines | One Einwilligung block with Verlauf |

New capabilities get ids in `FEATURE_INVENTORY.md` when they ship (KUN-…, KAM-…, EIN-…).

---

## 19. Docs to update (per phase, in the same PR as the code)

| Doc | Change |
| --- | --- |
| `CUSTOMERS.md` | Identity (Shopify id first), mirror, ledger, facts, Profiltiefe, merge rule |
| `CONSENT_FLOW.md` | One consent, resolver, both directions, Erstabgleich, Shopify text version |
| `CAMPAIGNS.md` | Multi-campaign model, audiences, wizard, Einzelansprache, conflicts; fix the drift from §3 |
| `KAMPAGNE_REDESIGN.md` | Note: the desk is per campaign |
| `ADMIN_DASHBOARD.md` | Eingang, Kampagnen overview/wizard, Kunden redesign, URL contract, routes (§11), KPI groups; fix "no cap" |
| `DATABASE.md`, `DATA_RETENTION.md` | Cluster K, new tables, retention table §12.11 |
| `ORDER_ATTRIBUTION.md` | Ledger vs. `mo_orders`; "unmarked orders never stored" replaced (D-6) |
| `CUSTOMER_ACCOUNT.md` | Merge on e-mail change, consent from Shopify, personalisation gate |
| `API_CONTRACT.md` | `alreadyConfirmed` semantics, `optInActionable`, `mo_c` (additive) |
| `ANWALTSDOSSIER.md` | Addendum: new purposes (§4), copy changes, retention |
| `FEATURE_INVENTORY.md` | §18 mapping, new ids |
| `.env.example` | Every new variable with default and purpose the moment code reads it |
| `CLAUDE.md` | „Where things are“: sync layer, Eingang, campaigns; the one eligibility gate as a hard rule |

---

## 20. Open questions

1. How many Shopify customers exist in total, including those without orders (subscribers without a
   purchase, account-only)? The import will tell; it only affects sizing.
2. Does the shop send newsletters through Shopify Email or another tool in parallel? If yes, the
   unified consent protects those sends too. The frequency cap, however, only sees Mo's sends.
3. Can customers delete their account themselves in the shop (new customer accounts)? If yes, which
   webhook arrives (`customers/delete` vs. `customers/redact`) — to be verified on the development
   store.
4. Who works the Eingang daily, and how many items per day are realistic? This sets the default caps
   and which kinds start enabled.
5. Should Black Friday codes be personal (unique `MK-` per recipient, as today) or may an Aktion use
   one shared code? Unique codes are recommended: attribution and abuse protection.
