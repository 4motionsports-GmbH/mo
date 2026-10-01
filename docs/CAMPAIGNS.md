# Kampagnen-Modul — personalised marketing e-mails to the customer base

The campaign module (R12; many campaigns since migration `0066`) e-mails the shop's customer base
in **campaigns**: the running lifecycle campaign „Bestandskunden – Lebenszyklus“, time-boxed
**Aktionen** the team creates in the admin (Black Friday, a launch …), and the built-in
**Einzelansprache** for single, hand-picked mails. For each recipient the system generates a
personalised email from the customer profile, the past purchases and the campaign's **Briefing**,
recommends 2–3 suitable catalog products, optionally weaves in a unique single-use discount code
(`MK-` prefix) and/or a bundle offer, and ends with the campaign's call to action — the Mo chatbot
deep link that auto-opens the widget, or a shop link. A human reviews **every** email on the
campaign's review desk (Prüftisch) in the **Kampagnen** screen of `/admin` before anything is sent.

Audiences are defined over the **whole customer base** — every Shopify customer is mirrored into
`customers` (see [`CUSTOMERS.md`](./CUSTOMERS.md)) — and the e-mail channel reaches only people
with the **one marketing consent** that Shopify and Mo share
([`CONSENT_FLOW.md`](./CONSENT_FLOW.md)). The Einzelansprache supersedes the Mo funnel's
per-customer marketing draft (`marketing_sends`, `MS5-` codes): Kunden → Marketing shows that
„bisheriger Weg“ only for a still-open legacy draft. Both send paths check the same block list,
and the campaign gate's frequency cap counts the Mo funnel's sends too (§3).

---

## 1. Audience — who can be mailed

Every campaign matches its audience spec (§2.2) against the read model `customer_overview`
(migration `0068`: `customers` + `customer_facts` + the block state from `suppression_list`). The
query is written once, in [`audience-store.ts`](../src/lib/audience-store.ts) (`matchAudience`),
with every spec field as a nullable parameter. For the e-mail channel it **always** requires
`email_consent_state = 'subscribed'` and no hard block (`bounce` / `complaint` / `erasure`) — a spec
can narrow an audience, never widen it past consent. A failed query matches nobody (fail-closed).

Rules:

- **Recipients are snapshots.** A matched person becomes one `campaign_contacts` row per campaign
  (and per re-entry cycle, §2.3) with name, effective language, opt-in level (from
  `customers.email_consent_level`, stored upper-case: `CONFIRMED_OPT_IN` / `SINGLE_OPT_IN` /
  `UNKNOWN`), consent time and the order figures from `customer_facts`. Every audience refresh
  rewrites the snapshot of open rows that still match. The send path never trusts the snapshot:
  it re-reads the person (§3).
- **Every recipient is a customer.** Real recipients carry `customer_id`; only Testkontakte (§5)
  have none.
- **Losing consent or getting blocked suppresses, never deletes.** Open rows (`pending`, `drafted`,
  `draft_failed`) of a person whose consent is no longer `subscribed` or who got blocked are marked
  `suppressed` at the next refresh (`excluded_reason = 'keine_einwilligung'`) and again at prepare
  time (`gesperrt` / `keine_einwilligung` / `kein_kunde`). They stay visible for audit; a person who
  matches again with consent returns to `pending`.
- **Manual control** (`lib/marketing-optout.ts`, `POST /api/admin/customers/marketing-optout`):
  the operator can opt a person out on request (reason `manual` — the card's „Abmelden“ icon or
  Kunden → Marketing) and lift an opt-out that was a mistake („Reaktivieren“ on a suppressed hit in
  the contact search, or „Abmeldung aufheben“ in Kunden → Marketing). Both directions go to the one
  consent (`lib/consent-flows.ts`) and from there to Shopify (outbox, `SHOPIFY_CONSENT_WRITEBACK`):
  an opt-out unsubscribes the person in Shopify too and marks their open recipient rows
  `suppressed`; lifting deletes the block-list
  row, brings back a previously confirmed chat DOI, clears the 30-day KPI attribution on campaign
  sends, restores the earlier subscription (level from the consent history) and returns the
  person's suppressed recipient rows to `drafted` (draft kept) or `pending`. Only
  `unsubscribe` / `manual` blocks can be lifted — bounces, spam complaints and
  erasures stay. Neither direction sends an e-mail; both are audit-logged (`customer.optout`,
  `customer.optout.lift`).
- **Admin previews are inert** — every rendered mail the dashboard shows (draft preview, Gesendet
  viewer, marketing/correspondence/design previews) goes through `adminEmailHtml()`, which points
  the recipient-action links (`/api/unsubscribe`, `/api/erase-data`, `/api/confirm-marketing`,
  `/api/r/…`) at `#`. A click in the admin can never unsubscribe, delete or count a click for the
  real recipient.
- **Erased people stay out** — an erased address is on `suppression_list` with reason `erasure`
  (complete deletion, see [`CUSTOMERS.md`](./CUSTOMERS.md)), which `customer_overview` reports as
  `blocked`, and a known Shopify id gets an `erasure_tombstones` row, so neither the mirror import
  nor a webhook re-creates the person.
- **Language derivation** (`effectiveEmailLanguage` in
  [`campaign-language.mjs`](../src/lib/campaign-language.mjs); `audience-store.ts` spells the same
  rules in SQL): the person's pin first; then the Shopify `locale` (`de*` → de, otherwise en); then
  the country DE/AT/CH → de, else en; for a chat-only lead without either, the language of their
  last Mo chat (`en*` → en); final fallback de.
- **Language override** (migrations `0040`, `0061`): the operator can pin DE/EN in the review card
  (`POST /api/admin/campaign/language`) when the derivation is wrong for a person. The pin is the
  PERSON's (`customers.language_override`, also stored on the recipient row), so every later
  campaign and the Kunden screen use it and an audience refresh never clobbers it; picking the
  language the profile already derives clears the pin. The EFFECTIVE language (override ?? derived,
  computed in `campaign-store.ts`) drives the AI draft, the deterministic send-time blocks (Mo promo,
  discount line, bundle offer labels, unsubscribe footer) and the expiry-date format (German
  `31.07.2026` vs English `31 July 2026`, `formatExpiryDateForLanguage`). Switching the language in
  the UI chains a regenerate so the prose matches.

**Retired: the Shopify newsletter sync.** Until the customer platform, the audience was the shop's
SUBSCRIBED newsletter list, pulled into `campaign_contacts` by `src/lib/campaign-sync.ts` /
`campaign-sync-core.mjs` / `src/lib/shopify-customers.ts` — daily by
`/api/cron/sync-campaign-audience` and on demand by the desk's **Sync** button
(`POST /api/admin/campaign/sync`), which also linked contacts to `customers`
(`linkCampaignContactsToCustomers`, source `kampagne`). All of it is removed. Replaced by the
customer mirror (`lib/shopify-sync.ts`, bulk import + webhooks + nightly reconcile — see
[`CUSTOMERS.md`](./CUSTOMERS.md)), the one consent, and the audience refresh of §2.3 („Zielgruppe
aktualisieren“ on the desk, `/api/cron/campaign-audiences` at night).

## 2. Campaigns (migration `0066`)

Definitions and the pure rules live in [`campaign-def.mjs`](../src/lib/campaign-def.mjs) (tested);
the I/O in [`campaigns-store.ts`](../src/lib/campaigns-store.ts). The queue per recipient (drafts,
sends) stays in [`campaign-store.ts`](../src/lib/campaign-store.ts).

### 2.1 Kinds, status and phase

| Kind (`kind`) | Label | Audience | Notes |
| --- | --- | --- | --- |
| `laufend` | Laufend | default `dynamisch` | Re-entry after `reentry_days` (default 180); the lifecycle send window applies (Lifecycle-Segmentierung below). Migration `0066` turned the former single queue into „Bestandskunden – Lebenszyklus“ (`lebenszyklus`, `dynamisch`, priority 10, hero `ai_ab`, re-entry 180 days) — every existing recipient and send belongs to it. |
| `aktion` | Aktion | default `fest` | Mails its whole audience (no lifecycle window). `discount_valid_until` makes every code of the Aktion end at the same moment. |
| `einzel` | Einzelansprache | none — recipients are added by hand | Exactly one (unique index), created by `0066` (`einzelansprache`, priority 100), always `aktiv`, no status changes; only offer, design and texts are editable. |

New campaigns are created as `laufend` or `aktion` (never `einzel`) with status `entwurf`; nothing is
materialised or drafted until they start. Status transitions (`canTransition`):

```
entwurf → aktiv | archiviert      aktiv → pausiert | beendet
pausiert → aktiv | beendet        beendet → archiviert | aktiv
```

The buttons say Starten / Fortsetzen / Wieder aufnehmen / Pausieren / Beenden / Archivieren;
Starten, Fortsetzen and Beenden are confirmed. Moving to `aktiv` stamps `started_at` once and
materialises the audience at once (§2.3); Beenden stamps `ended_at` and leaves every row as it is
(audit trail). The nightly audience job ends every `aktiv` campaign whose `ends_at` has passed
(`endExpiredCampaigns`).

**Phase** (`campaignPhase`) is what the UI shows: `geplant` (aktiv, start ahead), `laeuft`,
`abgelaufen` (aktiv, end passed, until the nightly job ends it), or the status itself. Mails go out
only in `laeuft` (`campaignAcceptsWork`; the Einzelansprache whenever it is `aktiv`). Vorbereiten
works for any `aktiv` campaign whose end has not passed — a `geplant` Aktion can be drafted ahead.

### 2.2 Neue Kampagne / Bearbeiten (the editor)

The Kampagnen overview (`?tab=kampagne`, alias `kampagnen`) shows one card per campaign —
phase, audience in plain German, recipients and send figures — with the scopes Aktuell / Alle /
Archiv, „Öffnen“ (the campaign's desk, §5) and the status actions. „Neue Kampagne“ and „Bearbeiten“
open the editor sheet (`?edit=new` / `?edit=<id>`;
[`CampaignEditor.tsx`](../src/app/admin/kampagnen/CampaignEditor.tsx)) with six sections.
Everything is validated again on the server (`validateCampaignInput`):

| Section | Fields (column) |
| --- | --- |
| Grundlagen | Name 3–80 chars (`name`, a unique `slug` is derived), Art (`kind`), Start/Ende (`starts_at`/`ends_at`, end after start), Priorität 0–100 (`priority`) |
| Briefing | `brief`, max 4,000 chars — Anlass, Ziel, Ton, Muss rein, Bitte nicht. The drafter reads it for every mail of the campaign (§4). „Briefing vorschlagen“ drafts one from name, kind, end date, discount and notes. |
| Zielgruppe | The audience spec (`audience`, below), Fest/Dynamisch (`audience_mode`), „Erneut aufnehmen nach“ (`reentry_days`, `laufend` only, 14–3,650 days, empty = never), live count. Hidden for the Einzelansprache. |
| Angebot | Rabatt (`discount_percent`, 0–`DISCOUNT_PERCENT_MAX`), Gilt für (`discount_scope`: all / recommendations / set), Codes gültig bis (`discount_valid_until`) — the starting values for Vorbereiten; each draft can still change them |
| Gestaltung | Design (`design_key`; empty = the design selected for campaign mails in Einstellungen), Titelbild (`hero_mode`: `none` / `default` / `ai_ab` / `ai_all`), Textlänge (`text_mode`), Button führt zu (`cta_kind`: `mo_chat` / `shop`) + Shop-Link (`cta_url`, `https://` required for `shop`), Mo-Hinweis anhängen (`mo_promo`, default on — the chat button lives in the Mo hint, so `mo_chat` with `mo_promo = false` is refused: „Der Button zu Mo steht im Mo-Hinweis — Hinweis einschalten oder den Button auf den Shop zeigen lassen.“) |
| Automatik | Automatisch vorbereiten 0–500 drafts per night (`auto_prepare_per_day`, §5), Tagesziel (`daily_target`, 1–5,000 — no automation; shown as „Tagesziel n“ next to today's progress in the desk header) |

Defaults per kind (`campaignDefaults`): `laufend` → dynamisch, re-entry 180 days, hero `ai_ab`,
priority 10; `aktion` → fest, no re-entry, hero `default`, priority 50.

**The audience spec** ([`audience-spec.mjs`](../src/lib/audience-spec.mjs), tested) is versioned
jsonb; unknown fields and values are dropped, never guessed. Every field is optional:

| Field | Meaning |
| --- | --- |
| `optInLevels` | `confirmed_opt_in` / `single_opt_in` / `unknown` |
| `lifecycle` | segment keys (`frisch` … `ruhen`, see Lifecycle-Segmentierung) + `unbekannt` (no purchase date) |
| `valueTier` | `klein` / `komponente` / `grossgeraet` — by the most expensive single item the person ever bought (`anchorValueEur` / `valueTierKey` in `repurchase-analysis.mjs`): under 150 €, 150–1,499 €, from 1,500 € |
| `churn` | `niedrig` / `mittel` / `hoch` |
| `lastOrderDays`, `ordersCount`, `totalSpentEur` | `{ min?, max? }` |
| `boughtAny`, `boughtNone`, `categories` | catalog handles / categories |
| `persona` | archetype keys + `unknown` |
| `moContact` | `yes` / `no` (has talked to Mo) |
| `language`, `country`, `shopifyTags` | effective language, ISO country, Shopify customer tags |
| `clickedWithinDays` | clicked a marketing mail within N days |
| `excludeMailedWithinDays` | no marketing mail within N days |
| `excludeCampaignIds` | not (yet) a recipient of these campaigns |

`describeAudienceSpec` renders the spec in German („Alle Kunden mit Einwilligung für E-Mail-Werbung
· …“) on the card, in the editor and in the desk header. The editor exposes all fields except
`boughtAny`/`boughtNone`/`country`/`shopifyTags`; its chips and InfoTips state the code's bounds
(Lebenszyklus „Ausbauen (1–3 Mon.)“, „Weiterentwickeln (3–12 Mon.)“, Wertstufe as above), and so
does the AI prompt of „Filter setzen“. The live count
(`POST /api/admin/campaigns/audience-preview`, pure DB) always means „with consent“: matches, how
many talked to Mo and the DE/EN split — window aggregates over the whole match (`count(*) OVER ()`),
only 8 sample names are fetched. Below it the editor adds **„Ohne Einwilligung passen weitere N —
davon M per Brief erreichbar“** (InfoTip): a second `matchAudience` call with `withoutConsent: true`
counts the same spec among people WITHOUT the consent (or blocked) and how many of them have a
postal address and no objection to advertising letters. It is the only match that skips the
consent — a count, nothing is materialised; every recipient row still requires it.

**Preset audience from Kunden.** Kunden → Überblick → „Ähnliche Kunden“ (`GET
/api/admin/customers/similar`, `listSimilarCustomers`: the same value tier and at least one shared
bought category, deterministic) → **„Als Zielgruppe verwenden“** opens the editor at
`?tab=kampagne&edit=new&audience=<json>` with `{ valueTier: [<tier>], categories: [<up to six of the
person's categories>] }` as the starting Zielgruppe. The server normalises the spec
(`normalizeAudienceSpec`) and ignores anything unparsable or longer than 4,000 characters; the
campaign still reaches only people with the consent.

**AI help** ([`campaign-assist.ts`](../src/lib/campaign-assist.ts), writer tier, `ai_usage` call
site `campaign_assist`, `POST /api/admin/campaigns/assist`): „Filter setzen“ turns a sentence
(„Beschreiben“) into a spec, which is normalised and shown with the live count before anyone saves;
„Briefing vorschlagen“ drafts the Briefing. Both only propose.

A changed audience of an `aktiv` campaign is re-materialised on save
(`POST /api/admin/campaigns/update`).

### 2.3 Recipients and the audience refresh

`refreshCampaignAudience` materialises or refreshes one campaign's recipients from its spec — on
Starten / Fortsetzen, on save of a changed audience, via „Zielgruppe aktualisieren“ on the desk
(`POST /api/admin/campaigns/refresh`), and nightly for every `aktiv` campaign
(`/api/cron/campaign-audiences`, 02:30 UTC, after the reconcile and the facts run). Rules:

| Situation | Effect |
| --- | --- |
| matched, no row yet | new `pending` recipient — `dynamisch`: always; `fest`: only on the first materialisation |
| matched, latest row `sent` longer ago than `reentry_days` (`laufend` only) | a new row with `cycle + 1` (re-entry) |
| matched, open row (`pending`, `drafted`, `draft_failed`, `excluded`, `suppressed`) | snapshot refreshed (`last_synced_at = now()`); `suppressed` comes back as `pending`, `excluded` too where new rows are allowed |
| open row whose person lost the consent or got blocked (any mode) | `suppressed`, `excluded_reason = 'keine_einwilligung'` |
| `dynamisch`: `pending` / `draft_failed` row that no longer matches | `excluded`, `excluded_reason = 'zielgruppe'` (drafted rows stay — the operator decides) |

`sent` is terminal per campaign and cycle, not per person: a person can be in many campaigns, and a
`laufend` campaign takes them again after the re-entry period. Before the first facts run
(`customer_facts` empty) a refresh waits — every customer would look like „no purchase“. Archived
campaigns and the Einzelansprache are never refreshed. A `fest` campaign's nightly refresh only
updates snapshots and consent.

### 2.4 Einzelansprache

A recipient is added by hand (`addRecipient`, `POST /api/admin/campaigns/add-recipient`; without
`campaignId` it targets the Einzelansprache):

- **Kunden → Marketing → „Einzelansprache vorbereiten“** with an optional hint for the drafter;
  the draft is written at once and the desk opens on the card.
- **Eingang → „Entwurf übernehmen“** (`POST /api/admin/inbox/accept`): the item's title, reason and
  AI suggestion become the recipient's `admin_note` (the drafter brief), the suggested discount is
  used, the draft is written, the item is marked erledigt.
- **Kunden → „Auswählen“ → „Zur Kampagne…“** (`POST /api/admin/campaigns/add-recipients
  { customerIds, campaignId?, adminNote? }`): several people at once — at most 200 per call — into
  the Einzelansprache (preselected, also the default without `campaignId`) or any campaign that is
  not `beendet` / `archiviert` (else 409 `campaign_closed`), with one optional note (≤ 2,000 chars)
  for the drafter. Each person goes through `addRecipient`; people without the consent or with a
  block are counted and skipped, never added (`{ added, alreadyIn, noConsent, blocked, notFound,
  failed }`). Nothing is drafted or sent — the drafts are prepared on the desk („Vorbereiten…“).
  It replaces the retired bulk-draft bar of the Kunden screen.

Adding requires the one consent and no block (the send gate re-checks). An open row is reused (note
updated; an `excluded` / `suppressed` row returns to `pending`); after a `sent` / `skipped` row a new
cycle starts. `conversation_id` records a chat the mail was started from. Einzelansprache mails go
through the same desk, gates and send path as every campaign. Hand-added people stay in a **`dynamisch`**
campaign even when they do not match its spec: `addRecipient` marks the row `added_manually`
(migration 0069) and the refresh (§2.3) only excludes rows it added itself; consent and blocks are
still re-checked for every row. The Kunden selection takes at most 200 people per call. Every add is
written to the admin access log (`campaign.add_recipient`, `campaign.add_recipients`).

### 2.5 Data model

| Table | Purpose | Key columns |
| --- | --- | --- |
| `campaigns` (`0066`) | One row per campaign | `name`, `slug` (unique), `kind`, `status`, `brief`, `audience` (jsonb spec), `audience_mode` (`dynamisch` \| `fest`), `priority`, `starts_at`/`ends_at`, `daily_target`, `auto_prepare_per_day`, `reentry_days`, `discount_percent`, `discount_scope`, `discount_valid_until`, `design_key`, `hero_mode`, `text_mode`, `mo_promo`, `cta_kind`/`cta_url`, `audience_refreshed_at`, `started_at`/`ended_at` |
| `campaign_contacts` (`0034`, recipients since `0066`) | One row per person per campaign per cycle + the review-queue lifecycle | `campaign_id` (FK campaigns, cascade), `customer_id` (FK customers, SET NULL, `0059`), `cycle`, normalized `email`, `first_name`/`last_name`, `language` + `language_override` (`0040`), `opt_in_level`, `consent_updated_at`, `orders_count`, `total_spent_cents`, `last_order_at` (`0052`), `last_synced_at`, `status` (`pending → drafted → sending → sent` \| `skipped` \| `suppressed` \| `excluded` \| `draft_failed`), `excluded_reason`, `admin_note`, `conversation_id` (FK conversations, SET NULL), `added_at`, `sent_at`, `skipped_at`; `is_test` + `test_source_email` (`0057`, Testkontakte — §5). Unique `(campaign_id, customer_id, cycle)` for real rows and `(campaign_id, email)` for test rows; `shopify_customer_id` is no longer unique and may be NULL. |
| `campaign_drafts` | ONE editable draft per recipient (unique `contact_id`, cascade) | `subject`, `body` (with `MO-XXXX` placeholder), `discount_percent`, projected `discount_expires_at`, `discount_scope` (`all` \| `recommendations` \| `set`, `0058`), compact `purchase_summary` (jsonb), `recommended_product_ids`, `low_confidence` |
| `campaign_sends` | Immutable send record (audit + KPI) | `contact_id` (SET NULL), `campaign_id` (FK campaigns, SET NULL, `0066`), `customer_id` (FK customers, SET NULL, `0066`), `email`, `subject`, `body_hash` (SHA-256 of the shipped text), `body_text`/`body_html` (the shipped parts as delivered — `0038`; `body_html` NULL on the copy path, both NULL for pre-0038 rows), `sent_via` (`email`/`copy`), real `discount_code` (`MK-…`) + `discount_code_gid` + `discount_expires_at`, `redirect_token`/`clicked_at` (`0041` — the tracked CTA, see below; NULL for copy sends and pre-0041 rows), `sent_at`; snapshot and delivery columns of `0052`/`0054`/`0055` below |

Purchases are no longer read per draft from Shopify: the draft reads the local order ledger
`customer_orders` (`0062`, [`CUSTOMERS.md`](./CUSTOMERS.md); fallbacks in §4) and keeps only the
compact `purchase_summary` snapshot the review card needs. Since migration `0038` the shipped body IS
retained next to its `body_hash`, so the "Gesendet" view can open exactly what the recipient
received; rows purge on the retention window (§6).

## 3. Legal gating model (Germany: GDPR + §7 UWG)

The consent is the **one consent** on `customers.email_consent_state` / `email_consent_level`
(migration `0064`), shared with Shopify in both directions: Shopify's checkbox and account
settings, Mo's DOI, unsubscribe links and admin opt-outs all write it
([`CONSENT_FLOW.md`](./CONSENT_FLOW.md)). German case law effectively requires a *provable* double
opt-in; the level records it (`confirmed_opt_in` | `single_opt_in` | `unknown`; a confirmed Mo DOI
is `confirmed_opt_in`). The gates are evaluated in one tested place,
[`campaign-gates.mjs`](../src/lib/campaign-gates.mjs), consumed by the single send chokepoint
[`campaign-email.ts`](../src/lib/campaign-email.ts) (`approveAndSendCampaign`), in this order —
the first failing gate is the refusal:

> ✅ **APPROVED by the lawyer (2026-07-21)** for the Shopify-checkbox audience, including
> `SINGLE_OPT_IN`/`UNKNOWN`. `.env.example` ships both flags `false` so a fresh copy never sends;
> production enables them in the deployment env. The code fails closed (an absent env var means
> false), and either flag can be set false there at any time to re-lock the channel.

| # | Gate | Flag / source | Code default | Effect |
| --- | --- | --- | --- | --- |
| 0 | Campaign live | `campaigns.status` + schedule | — | Only a campaign in phase `laeuft` sends (the Einzelansprache while `aktiv`); otherwise `campaign_closed` (409). A Testkontakt may send before the start, never for an ended or archived campaign. |
| 1 | Master send gate | `CAMPAIGN_SENDS_APPROVED` | **false** | While false, **every** campaign send is refused server-side (403) — UI *and* direct API calls. Drafting, preview and Copy keep working. The desk shows a banner that the sign-off for this channel is pending. Separate from `CONSENT_COPY_LAWYER_APPROVED` and `PHYSICAL_MAIL_SENDS_APPROVED`. |
| 2 | Consent | `customers.email_consent_state`, read fresh | — | Must be `subscribed`; otherwise `no_consent` (403). A recipient whose customer row is gone is refused (`not_eligible`, 409). |
| 3 | Opt-in level | `CAMPAIGN_ALLOW_SINGLE_OPT_IN` + `customers.email_consent_level` | **false** | Without `confirmed_opt_in` the send is refused (403, "Erneute Einwilligung erforderlich") while the flag is false; such recipients stay visible in the queue (Copy allowed). |
| 4 | Suppression | `suppression_list` (`isSuppressed`) | — | Every reason blocks (unsubscribe, manual, bounce, complaint, erasure). Fail-closed: a DB error blocks the send. Also checked at refresh and prepare time. |
| 5 | Frequency cap | `MARKETING_MIN_SEND_INTERVAL_DAYS` | 0 (off) | Spans **every** campaign (Einzelansprache included) **and** the Mo funnel: the newest send to the address across `campaign_sends` *and* `marketing_sends` (`lastCrossChannelSendAt`) must be older than the window (429 otherwise). |

Testkontakte (§5) skip gates 2, 4 and 5 — they are the operator's own inboxes. The **copy path**
(`POST /api/admin/campaign/mark-done`) delivers nothing, so the master flag does not apply; it does
check the consent and the block list (409 `not_eligible`).

**What the lawyer approved** with `CAMPAIGN_SENDS_APPROVED`: mailing this audience on the basis of
Shopify's checkbox consent at all, and — separately — whether `SINGLE_OPT_IN`/`UNKNOWN` contacts may
be included (`CAMPAIGN_ALLOW_SINGLE_OPT_IN`) or must first re-confirm.

**DOI refresh (FUTURE option, deliberately not built):** people without a provable double opt-in
could be sent a one-time re-confirmation request through the existing DOI confirmation
infrastructure (`/api/confirm-marketing`, `email_captures.marketing_doi_status`), upgrading their
level to `confirmed_opt_in`. Documented here as the designated path; nothing implements it yet.

Every campaign email carries, outside the editable prose (an edit can never remove them): the
signed unsubscribe link (writing to the same consent and block list), a `List-Unsubscribe` header,
and the branded shell's Impressum/privacy footer
([`email-template.ts`](../src/lib/email-template.ts)). Copy ceiling: no fake urgency, no countdowns
— same rule as the existing marketing drafts, enforced in the prompt and in the deterministic promo
copy; the real end date of an Aktion may be named factually.

## 4. Draft generation

`POST /api/admin/campaign/prepare { campaignId, count, discountPercent?, textMode?, discountScope? }`
drafts the next N `pending` recipients of one campaign
([`campaign-prepare.ts`](../src/lib/campaign-prepare.ts)), with modest concurrency; a per-recipient
failure marks that row `draft_failed` and continues. Offer settings default to the campaign's own
(§2.2); the Vorbereiten popover may override them. A campaign that is not `aktiv` or whose end has
passed prepares nothing (409 `campaign_closed`). Before drafting, each recipient's block and consent
are re-checked (fail-closed → `suppressed`). The dashboard chunks the batch so it can show progress.
Generation costs API money: the admin starts it on the desk, and the nightly run (§5) is opt-in per
campaign.

Per recipient ([`campaign-draft.ts`](../src/lib/campaign-draft.ts), same model + fallback
discipline as `marketing-draft.ts`):

0. **The campaign and the customer profile are the brief.** The prompt opens with an „Anlass“
   section: for an Aktion or the Einzelansprache the campaign name and kind (and an Aktion's real
   end date), the campaign's **Briefing**, and the recipient's `admin_note` (Einzelansprache,
   Eingang). When the recipient's customer has a profile (goals, level, owned gear, interests, next
   steps — see [`CUSTOMERS.md`](./CUSTOMERS.md)), the prompt carries it as "Kundenverständnis" and
   the text speaks to *this* person's goals instead of a generic purchase recap; it also steers the
   product picks (below). A person with an Art. 21 objection to profiling
   (`customers.profile_objection_at`) is drafted without the profile. Test contacts use the profile
   of their `test_source_email` customer. Purchases come from the order ledger (`customer_orders`)
   once the person is mirrored, else the cached `customers.purchase_summary`, else a Shopify read.

1. Personal greeting by first name (graceful fallback).
2. A natural, warm reference to the purchase history — one category or one
   item, never an itemized dump.
3. 2–3 recommendations with product URLs, briefly reasoned
   ([`campaign-recommendations.ts`](../src/lib/campaign-recommendations.ts)),
   written as **markdown links** `[Produktname](URL)` — the HTML part renders
   every link as clickable text, never a raw pasted URL
   ([`email-prose.mjs`](../src/lib/email-prose.mjs): markdown links keep their
   label; bare URLs in older/edited drafts are linkified with the catalog
   product name, or a compact host/path label). The text part and the Copy
   workflow flatten links to `Label (URL)`:
   purchased handles → catalog products, then the **existing** in-memory
   embedding similarity (catalog embeddings + `retrieval.cosine` — no vector
   DB), excluding owned items, filtered through `filterAvailable`. No catalog
   match → representative fallback picks + `low_confidence` flag on the card.
   The similarity **basis** defaults to ALL catalog-matched purchases; the
   review card can narrow it to selected purchases (migration `0043`,
   `purchase_selected_ids` on the draft — see §5). Deselecting a purchase
   never makes it recommendable: owned products stay excluded from the
   candidates regardless of the basis.
   A **regenerate preserves the draft's stored product list** (auto-picked or
   manually curated) so the prose, the picture grid and the review card can
   never drift apart; recommendations are recomputed only for the first
   draft or an explicit basis change (`refreshRecommendations`).
4. Optional discount block — the **exact existing mechanism**: the campaign
   (or the admin) picks 0–50 % (`discount-validation.mjs`), the draft weaves in
   the `MO-XXXX` placeholder + projected expiry
   (`formatGermanExpiryDate`/`discountExpiryDaysPublic`; for a campaign with
   `discount_valid_until`, that date — `campaignDiscountExpiry`); the real `MK-`
   code is minted **only at send**, with the same end date. Changed depth or
   explicit regenerate overwrites the open draft (`shouldReuseCampaignDraft`)
   so text and eventual code never disagree.
   **Scope** (`discount_scope`, migration `0058`, `discount-scope.mjs`): the
   code applies to the whole order (`all`, the default), only to the products
   recommended in this mail (`recommendations`) or only to the attached set
   (`set`). The prompt states the scope (`discountHint`: "gilt NICHT für den
   Rest der Bestellung"), the coupon's benefit line and the text part use the
   same phrase (`discountScopePhrase`), and at send time the code is minted
   with `customerGets.items.products.productsToAdd` = the Shopify product gids
   of that scope (recommended handles resolved via
   `fetchProductGidsByHandles`, the set's `shopify_product_id`). A scope that
   cannot be honoured (no available recommendation, unresolvable handle, no
   active set) **refuses the send** (`discount_scope_unresolved`) — the desk
   shows the same rule as a blocked Prüfpunkt beforehand
   (`discount_scope_no_set` / `discount_scope_no_recommendations`). A changed
   scope regenerates the prose. Recommendation: with a set attached, scope the
   code to the recommendations so each offer has one clear price.
   **Bundle offers** (alternative or addition to a percentage code): the card's
   "Set-Angebot" section creates a real UNLISTED Shopify set from the card's
   recommendations via the **existing** bundle mechanism
   (`/api/admin/bundles/create` with `campaignContactId` — migration `0035`
   adds the nullable FK on `bundle_offers`, parallel to
   `customer_id`/`marketing_send_id`; see [`BUNDLES.md`](./BUNDLES.md) for
   scopes, pricing/PAngV and expiry). A regenerate weaves a natural mention
   into the prose (`bundleHint`); the deterministic offer block (components,
   price, genuine "statt", tracked `/api/r/<token>` CTA) is appended at send
   time (`buildBundleBlockForContact`, same active-only guard + renderer as
   the marketing path) and a resolution failure degrades to "no block", never
   blocking a send. Expiry stays with the existing cron (it deletes the set's
   Shopify product); "Set entfernen" uses the existing archive route, which
   deletes it too.
5. Call to action — appended **deterministically** at send time, never editable
   prose, per the campaign's `cta_kind` and `mo_promo`:
   - `mo_chat` (default): the Mo promo block + deep link (`CAMPAIGN_MO_DEEPLINK_URL`, default
     `https://motionsports.de/?mo=open&mo_new=1&mo_view=fullscreen&utm_source=campaign&utm_medium=email`),
     both languages (`moPromoBlockText`). Theme-side handling (Task F in the theme repo — a
     separate follow-up): `mo=open` auto-opens the widget after init and strips the params; the
     modifiers `mo_new=1` (start a FRESH consultation, no old thread resumed) and
     `mo_view=fullscreen` (open the panel full-screen) shape how it opens.
   - `shop`: the main button („Zum Angebot“ / „Shop the offer“) leads to the campaign's `cta_url`;
     the Mo hint, if kept (`mo_promo`), then links the untracked Mo deep link.
   - `mo_promo = false` drops the Mo hint block. With `mo_chat` that would leave the mail without a
     button, so `validateCampaignInput` refuses the combination (error on `moPromo`) — also when only
     one of the two fields is sent: an update reads the other from the stored campaign, a create
     without `ctaKind` counts as `mo_chat`.
6. Footer: signed unsubscribe + Impressum/privacy via the existing
   composition (`unsubscribeFooter` + branded template), plus a separate
   "Daten löschen" link (`buildErasureUrl` → `/api/erase-data`, confirmation
   page first) that runs the complete erasure.
7. The **Mo brand orb** (the chat widget's actual animated mark, exported
   from the frontend repo — `public/moorb.gif`, animated with a white
   background; `public/moorb2x.png` is the transparent static variant;
   override via `EMAIL_MO_ICON_URL`) makes Mo recognizable: on campaign
   emails it renders **beside the Mo promo text** as a chat-style media row
   (orb left, the two-sentence "Mo berät dich direkt im Shop-Chat …" hint
   right — plain, no sales-letter phrasing; `moPromoIntroText`, tested),
   directly above the deep-link button. Marketing and
   summary emails (no chat-hint line) keep the centered orb between heading
   and prose (`moAvatar` in `email-template.ts`). Clients without GIF
   playback (Outlook desktop) show the first frame.

**Design and hero per campaign.** A campaign's `design_key` wins over the design selected for
campaign mails in Einstellungen (`getEmailDesignForKey`; unknown key → the selection).
`hero_mode`: `none` — no per-recipient KI-Hero rides along even if one was generated; `default` —
the design's standard hero; `ai_ab` — Vorbereiten generates the KI-Hero for the A group (even
recipient ids); `ai_all` — for every prepared card (§5).

## 5. Review workflow (Kampagnen screen)

Each campaign has its own **review desk** (Prüftisch) at `?tab=kampagne&campaign=<slug|id>` (layout
and rationale in [`KAMPAGNE_REDESIGN.md`](./KAMPAGNE_REDESIGN.md); screen description in
[`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §3.2): a rail with the queue, the rendered e-mail in
the middle, the review column on the right. The header strip carries the campaign switcher (every
non-archived campaign with its open drafts, „Alle Kampagnen“ back to the overview), the phase, the
audience in German, today's progress („n gesendet · m zu prüfen“, plus „Tagesziel n“ when the
campaign sets `daily_target`) and the ⋯ menu (Zielgruppe aktualisieren, Kampagne bearbeiten,
Testkontakte…, Tastenkürzel, Warteschlange neu aufbauen). Counts, queue, Liste, Gesendet, the
contact search and the delivery strip are per campaign; a legacy link with only `?contact=` opens the desk of that recipient's
campaign. Keyboard-driven (`N`/`P` next/previous, `S` send, `X` skip, `E`/`Esc` edit,
`R` regenerate, `V` full-size preview, `C` copy, `F` Fokus-Modus, `/` contact search, `?` the key
list — shortcuts pause while a dialog is open). The queue can be **filtered by chips** (Alle / DOI /
Single/Unbekannt / EN / Rabatt / Set / Hinweise / Blockiert) and searched by email/name —
mutations are keyed by contact id, so filtering never mis-targets a card. Position, view and filter
live in the URL (`?contact=`, `?view=`, `?filter=`).

**Prüfpunkte.** Every card opens with a precomputed verdict from the pure
[`campaign-review-checks.mjs`](../src/lib/campaign-review-checks.mjs) (tested):
*blocked* when the send route would refuse (master flag off, no provable DOI
while `CAMPAIGN_ALLOW_SINGLE_OPT_IN` is off, address on the block list or without the one consent,
address inside the cross-channel frequency cap, prose naming a different percentage than the set
discount — the same `detectDiscountTextMismatch` the send path enforces — or the
`MO-XXXX` placeholder without a discount, or a refusal the server returned for
the last attempt), *hint* when worth a look (low-confidence recommendations, a
recommended product gone or sold out, an attached set expired or expiring
within two days, a missing KI-Hero while the campaign design has a hero —
following the campaign's hero mode: under `ai_ab` an A-group card without one,
under `ai_all` every card without one („Ohne KI-Hero“), under `default` /
`none` never —, draft older than 14 days, a segment outside the send window
(`laufend` campaigns only — an Aktion and the Einzelansprache have no window),
subject over 70 characters), *info* (edited by hand). Each check carries one fix action
(Überspringen, Neu generieren, Basis anpassen, Produkt tauschen, Set neu
erstellen, Hero erzeugen, Betreff kürzen). The rail dot, the „Hinweise“ /
„Blockiert“ chips and the Liste column show the same verdict.

**Nothing blocks the next card.** `S` takes the card out of the queue at once
and the request runs in the **Postausgang** (rail strip): ok → „gesendet ✓“
and the day counter ticks up; refused by any gate → the card returns to the
top of the queue with the server's reason as a blocked Prüfpunkt and a retry;
network failure → the same, with „erneut senden“. The server is unchanged —
the atomic claim in `claimContactForSend` already prevents double sends.
Offer and text changes (Rabatt, Sprache, Textmodus, Empfehlungen, Set) persist
at once and **batch into one regenerate** that runs in the background („Text
wird angepasst…“ on the card; sending that card waits until the prose is
fresh, the operator may move on). Every card has its own busy state;
„Vorbereiten…“ runs as a background job (progress pill in the header, cancel)
while the review continues.

**Vorbereiten…** is a popover: Anzahl (25/50/100, next to „n offen · m im
Sendefenster“ — the window applies to `laufend` campaigns only), Rabatt and Textmodus for the NEW
drafts (starting from the campaign's offer settings, remembered per browser; they also apply to
„Entwurf erstellen“ and „Wiederherstellen“), the optional **KI-Hero** (after the drafts,
`suggest` + `generate` for every prepared card under `ai_all` — „KI-Hero für jede Mail erzeugen“ —,
for the A group under `ai_ab` — „KI-Hero für die A-Gruppe erzeugen“, see „Hero-A/B-Test“ below;
offered only for these two hero modes, when the design has a hero and generation is configured, and
pre-selected) and an estimate — drafts, heroes (one per draft under `ai_all`, about half the drafts
under `ai_ab`; `prepareEstimate` in `campaign-desk-core.mjs`), ≈ € from the recorded `ai_usage`
averages (`estimateCampaignCosts`), ≈ minutes — before any money is spent. With nothing to prepare
it says „Keine offenen Empfänger — erst „Zielgruppe aktualisieren“.“ The desk's Liste shows its Hero
column only for `ai_ab` / `ai_all` („fehlt“ under `ai_all`, „A ohne“ / B under `ai_ab`).

**Nightly Vorbereiten** (`GET/POST /api/cron/prepare-campaign-drafts`, 04:15 UTC, after the
reconcile, the audience refresh and the catalog sync). `CAMPAIGN_AUTO_PREPARE_COUNT` is the nightly
**budget** across all campaigns; each campaign in phase `laeuft` takes its own
`auto_prepare_per_day` from it, highest priority first (`planAutoPrepare`), with its own offer
settings. When no campaign sets a figure, the whole budget goes to the `lebenszyklus` campaign with
`CAMPAIGN_AUTO_PREPARE_DISCOUNT` / `_TEXT_MODE` / `_DISCOUNT_SCOPE` (the behaviour before
campaigns). **Off by default** (`0`): generation costs API money, so the budget is the deployment's
explicit decision (`.env.example`). It never sends — every draft still needs a human on the desk.

**Testkontakte** (migration `0057`, ⋯ → „Testkontakte…“). The operator's own inboxes as recipients
of ONE campaign (since `0066` — they see its Briefing and offer), for testing every variation
before going live: created from the desk (`POST /api/admin/campaign/test-contacts`, unique per
campaign and address, drafted at once with the desk's Vorbereiten settings), with
`opt_in_level = CONFIRMED_OPT_IN` so the gate passes, exempt from the consent check, the
cross-channel frequency cap AND the suppression check (an old unsubscribe or bounce on the
operator's own address must not stop testing; the desk shows it as an info), and put back to
`drafted` with their draft intact after every send (a real recipient flips to `sent`) — the card
returns to the top of the queue. A test send works before the campaign starts (Entwurf, Geplant,
Pausiert), not after it ended. Optionally a test contact borrows a real customer's purchase history
and profile (`test_source_email` → `loadCampaignPersonalization`) so the generated mail is
realistic. Everything else about a test send is real: MK- code, set block, tracked link,
unsubscribe link, Resend delivery events. Test sends are stamped `campaign_sends.is_test` and left
out of the Kampagnen-Funnel, the delivery strip, the campaign cards and the revenue KPI; the
„Gesendet“ view lists them with a „Test“ badge. „Vorbereiten“, the nightly cron, the audience
refresh and „Warteschlange neu aufbauen“ never touch test contacts; counts in the header exclude
them.

**Liste** shows the queue as a sortable table with multi-select and bulk
Überspringen (free, undoable), Neu generieren… and Rabatt setzen… (paid runs,
confirmed with count and cost estimate). **Gesendet** adds delivery-state chips
(Zugestellt / Geklickt / Bounce / Beschwerde / Kopiert, `?delivery=` on the
history route, scoped by `campaignId`) and a pure-DB 30-day strip (`getCampaignDeliverySummary`);
redemption and revenue stay on the KPI screen with its Shopify cache.

The workflow is generated-first but everything stays adjustable per card
WITHOUT regenerating (the deterministic send-time blocks make that safe):

- **Recommendations** are editable: remove per item, add via the shared
  catalog picker (`/api/admin/catalog/search`); each change persists
  immediately (`POST /api/admin/campaign/recommendations` — validates against
  the sync-fresh catalog, refuses sold-out products, clears `low_confidence`)
  and an attached bundle offer is **rebuilt to match** (snapshots are
  immutable, so "update" = archive + recreate through the unchanged bundle
  mechanism). The UI then chains a regenerate; because a regenerate
  preserves the stored list (§4.3), the fresh prose talks about exactly the
  curated products.
- **Purchase basis** is selectable: every purchased item that maps to a
  current catalog product gets a checkbox in the card's Kaufhistorie (all
  selected = default). Changing the selection and clicking "Empfehlungen &
  Text neu erzeugen" recomputes the recommendations from the selected
  purchases, focuses the prose's purchase reference on them, rebuilds an
  attached bundle, and regenerates the text — one round-trip
  (`POST /api/admin/campaign/draft` with `refreshRecommendations` +
  `purchaseSelection`). The selection persists on the draft
  (`purchase_selected_ids`, migration `0043`), so later regenerates /
  discount changes / language switches keep the same basis.
  Unmatched items (removed/unpublished products, gift cards, manual line
  items) stay visible greyed out with an InfoTip ("Grau = nicht als Basis
  wählbar"). The snapshot keeps only the newest 5 orders (≤ 6 items each) and
  records `orderCount` / per-order `itemCount`; the card then says
  "Letzte 5 von N Bestellungen" (N = the larger of the recipient's
  `orders_count` and the orders read at draft time) and "+ N weitere Artikel",
  because the Kontakt block's Umsatz is the lifetime figure of the recipient snapshot
  (`customer_facts` at the last audience refresh) and will not equal the sum of the shown orders
  (`purchaseHistoryCoverage` in `campaign-desk-core.mjs`).
- **Discount** can be set/changed/cleared AFTER generation
  (`POST /api/admin/campaign/discount { contactId, discountPercent, discountScope? }`):
  depth and scope („Gilt für“: Alles / Empfehlungen / Set) live on the draft,
  the real MK- code + deadline ship deterministically outside the prose, and
  the route warns when the current prose clearly states a different
  percentage (which the send route would refuse — regenerate then). A scope
  change regenerates automatically, because the prose states the scope.
- **Bundle** can be attached/removed after generation (see §4).

Actions:

- **Send** (`POST /api/admin/campaign/send`) — re-verifies every gate
  server-side (§3), mints the `MK-` code (depth > 0), swaps placeholder + stale
  expiry via the shared [`discount-swap.mjs`](../src/lib/discount-swap.mjs)
  (extracted from the marketing send path — one logic, two channels), sends
  via Resend to the person's CURRENT address (a Shopify e-mail change may have merged people) with
  unsubscribe link + `List-Unsubscribe` header, records the `campaign_sends` row (with
  `campaign_id` and `customer_id`), writes the mail into the person's Korrespondenz
  (`email_messages`; not for test sends), flips the recipient to `sent`, auto-advances. Confirm
  dialog on the first send of the day only — it confirms that ONE e-mail
  (every send is a single card; the desk never sends the whole queue) and
  is skipped for test contacts.
- **Copy** — subject + body to the clipboard. Copying alone **never** mutates
  state; the explicit "Als erledigt markieren" (`POST
  /api/admin/campaign/mark-done`) marks the recipient `sent` with
  `sent_via='copy'` — refused (409) when the person has no consent or is blocked. No code is
  minted on this path (the UI warns that the placeholder is not a working code).
- **Vorschau** (`POST /api/admin/campaign/email-preview`) — renders the
  CURRENT card (the on-screen, possibly unsaved subject/body) through the
  exact send-path composition (`renderCampaignEmailPreview` reuses
  `renderCampaignEmail`: the campaign's design and hero mode, branded shell, bundle block, CTA,
  discount line, unsubscribe footer) and returns `text/html`, shown in an in-tab
  dialog iframe — the campaign sibling of the Kunden letter-preview route.
  READ-ONLY and gate-free: nothing is claimed, minted, sent or recorded; the
  discount line shows the `MO-XXXX` placeholder with the projected expiry.
- **Regenerate** (`POST /api/admin/campaign/draft`, `R`, with whatever offer
  changes are pending) and **Skip** (`POST /api/admin/campaign/skip`, `X`,
  optimistic — undo via „Übersprungen“).
- **Verlauf** — every campaign send to the card's address, across all campaigns (the history
  route narrowed by e-mail) in a sheet, with „Ansehen“ for retained content.

The "Gesendet" sub-view lists the campaign's sent emails with redemption status
(existing `wasDiscountCodeRedeemed`, bounded fan-out). `MK-` codes also feed
the existing revenue KPI (`kpi-revenue-store.ts` unions `campaign_sends`
codes) — campaign revenue stays separable from `MS5-` marketing revenue by
prefix. Per row, **Ansehen** (`POST /api/admin/campaign/sent-email`) opens
the retained content (`0038`) in the same viewer dialog: system sends show
the exact delivered HTML, copy-path rows show the copied text; pre-0038
rows retained nothing and say so.

### Click tracking (migration 0041)

System sends route the email's main CTA through the tracked redirect `GET /api/r/<token>`,
exactly like the marketing channel's cart link (no pixel; only the link the recipient chose to
click). At send time `approveAndSendCampaign` mints a `redirect_token`, embeds `/api/r/<token>` as
the CTA URL and stores the token on the `campaign_sends` row. The redirect resolves campaign tokens
via `recordCampaignClick` (`campaign-store.ts`): first click stamps `clicked_at`, every click logs a
`campaign_email_clicked` kpi_event, and the visitor is 302'd to the campaign's shop link
(`cta_kind = 'shop'`) or to `campaignMoDeeplinkUrl()` with the token as `mo_c`. Both targets are
read at click time, so a config or campaign change applies to already-sent emails. Copy-path sends
and the review-time preview stay untracked. This powers the **Kampagnen-Funnel** on the KPI tab
(`getCampaignKpis` — sent → clicked → redeemed, the language split and the table „Kampagnen im
Vergleich“, the same funnel per campaign); see `ADMIN_DASHBOARD.md` §5.9. The funnel's
„Button-Klickrate“ counts the button (`clicked_at`) and shows set clicks separately; the campaign cards (`listCampaigns`
„Klickrate“), Kunden → Marketing („geklickt“), the Aktivität timeline and the AI profile's campaign
history count **any** click — the button or the set link (`clicked_at` or `bundle_clicked_at`).

### Chat-Start (`mo_c` → `campaignToken`)

The Mo deep link a campaign click lands on carries the send's redirect token as `mo_c`. The widget
reads it from the landing URL and sends it back as the optional, additive **`campaignToken`** on
`POST /api/chat` (the first turn of the session the link opened; contract in
[`API_CONTRACT.md`](./API_CONTRACT.md) §2). The server checks the shape (`/^[A-Za-z0-9_-]{16,64}$/`),
looks the token up among real (non-test) `campaign_sends` and records **one** `kpi_events` row
`campaign_chat_started` per send (`recordCampaignChatStarted` in `campaign-store.ts`) — with
`session_id = NULL` and `data: { sendId, campaignId }`, so the pseudonymous chat is never tied to the
person. Anything else is ignored; it never blocks or fails the chat. It shows as **„Chat gestartet“**
in „Kampagnen im Vergleich“ and in the Komplettanalyse chapter „Kampagnen“. Shop-CTA campaigns
(`cta_kind = 'shop'`) redirect to the shop and carry no `mo_c`. The widget side (capture `mo_c` before
the theme strips the URL parameters, send it once) is a frontend task; until it ships the column
stays at 0.

## 6. Retention

`CAMPAIGN_CONTACT_RETENTION_DAYS` (default **365**, 0 disables), enforced by the existing
`/api/cron/retention` job: `campaign_sends` purge by `sent_at`, recipients (`campaign_contacts`,
test contacts excepted) by `COALESCE(last_synced_at, created_at)` — an open recipient that still
matches is refreshed by every audience refresh and stays; a sent, skipped or dropped one ages out;
drafts cascade with their recipient. `campaigns` rows are not purged. The `suppression_list` is
never touched — opt-outs are honoured forever. See [`DATA_RETENTION.md`](./DATA_RETENTION.md).

**Complete deletion** of a person — the "Löschen" icon in the card's Kontakt
block (`POST /api/admin/customers/erase { contactId }`), the "Daten löschen"
link in the mail, the customer's own widget button, or Shopify's `customers/redact` /
`customers/delete` webhook — runs the one erasure path (`erasePerson`): every recipient row of
the person in every campaign, drafts, sends, customer + profile, orders, chats and correspondence
go in one transaction; the address is suppressed with reason `erasure` and the Shopify id gets a
tombstone, so no audience, import or webhook brings the person back.

## 7. Endpoints & files

| Piece | Path |
| --- | --- |
| Campaign list / create (Entwurf) | `GET` + `POST /api/admin/campaigns` |
| Edit a campaign (re-materialises a changed audience of an active one) | `POST /api/admin/campaigns/update` |
| Status change (Starten, Pausieren, Fortsetzen, Beenden, Archivieren) | `POST /api/admin/campaigns/status` |
| Live audience count + German description | `POST /api/admin/campaigns/audience-preview` |
| AI help: audience from a sentence / Briefing draft | `POST /api/admin/campaigns/assist` (`action: "audience" \| "brief"`) |
| Zielgruppe aktualisieren | `POST /api/admin/campaigns/refresh` |
| Add one person (Einzelansprache by default) | `POST /api/admin/campaigns/add-recipient` |
| Add a Kunden selection (≤ 200, consent-gated, nothing drafted) | `POST /api/admin/campaigns/add-recipients` (`{ customerIds, campaignId?, adminNote? }`) |
| „Ähnliche Kunden“ + their audience spec (→ `?edit=new&audience=`) | `GET /api/admin/customers/similar?id=` |
| Eingang suggestion → Einzelansprache | `POST /api/admin/inbox/accept` |
| Chat-Start from a campaign link (widget) | `POST /api/chat` with `campaignToken` (the `mo_c` value) |
| Nightly audience refresh (cron) | `GET/POST /api/cron/campaign-audiences` (`CRON_SECRET`, 02:30 UTC) |
| Batch prepare | `POST /api/admin/campaign/prepare` (`campaignId`; returns `preparedContactIds`) |
| Nightly prepare (cron, off by default) | `GET/POST /api/cron/prepare-campaign-drafts` (`CRON_SECRET`, `CAMPAIGN_AUTO_PREPARE_*`, per-campaign `auto_prepare_per_day`) |
| Single draft / regenerate / purchase-basis selection | `POST /api/admin/campaign/draft` |
| Save edits | `POST /api/admin/campaign/update` |
| Curate recommendations (+ bundle rebuild) | `POST /api/admin/campaign/recommendations` |
| Set discount post-generation | `POST /api/admin/campaign/discount` |
| Rebuild one campaign's queue (discard its open drafts → pending) | `POST /api/admin/campaign/reset-queue` (`campaignId`) |
| Skip / undo skip / mark-done / send | `POST /api/admin/campaign/{skip,unskip,mark-done,send}` |
| Contact search (all statuses, one campaign) | `POST /api/admin/campaign/contacts` (`query`, `campaignId`) |
| Testkontakte (list / create + draft / delete) | `GET ?campaignId=` + `POST /api/admin/campaign/test-contacts` |
| Pin/clear the person's email language | `POST /api/admin/campaign/language` |
| Delete the person completely | `POST /api/admin/customers/erase` (`{ contactId, confirm: true }`) |
| Rendered draft preview (read-only, `text/html`) | `POST /api/admin/campaign/email-preview` |
| Retained sent content (read-only, `text/html`) | `POST /api/admin/campaign/sent-email` |
| Send history (paged, filtered) | `GET /api/admin/campaign/history?campaignId=&q=&from=&to=&delivery=&page=&pageSize=` |
| Retired | `POST /api/admin/campaign/sync`, `GET/POST /api/cron/sync-campaign-audience` (§1) |
| UI | `src/app/admin/KampagneTab.tsx` (overview or desk); overview + editor in `src/app/admin/kampagnen/` (`CampaignsOverview`, `CampaignEditor`); desk in `src/app/admin/kampagne/` (`KampagneWorkspace`, `CampaignHeader`, `PreparePopover`, `QueueRail`, `MailPane`, `ReviewColumn`, `ListView`, `SentHistory`, `ContactHistorySheet`, `TestContactsSheet`, `useCampaignActions`, `useRenderedPreview`) |
| Libs | `campaigns-store.ts`, `audience-store.ts`, `campaign-{store,prepare,draft,recommendations,email,recommendation-view,assist}.ts`, `campaign-{def,language,flags,gates,segments,draft-core,review-checks,desk-core}.mjs`, `audience-spec.mjs`, `discount-swap.mjs`, `discount-scope.mjs` |

All admin routes sit behind the existing proxy gate + `guardAdminPost` / `guardAdminGet`
(auth + JSON-content-type CSRF defense). Everything fails closed: missing
Shopify/DB config → "not configured" in the UI, never a crash, never an
ungated send.

## Product variants

The review card's recommendations editor uses the shared catalog picker with
a variant chooser. A pinned variant is stored as a ref (`handle~variantId`,
see `docs/archive/PRODUCT_VARIANTS_PLAN.md`) in the existing
`campaign_drafts.recommended_product_ids` TEXT[] — no migration. The
recommendations route validates per variant (`variant_not_found` 409 when it
vanished mid-review), the drafter sees "Produktname – Variante" + the
`?variant=` deep link, and the email grid renders the chosen variant's name,
price and link. Regenerates preserve refs; a ref whose variant disappeared
is DROPPED from the email and reported — never silently downgraded to the
default variant (PAngV).

---

## Lifecycle-Segmentierung (Migration `0052`)

Welche Produkte eine Kampagnen-Mail empfiehlt — und ob sie überhaupt
geschrieben wird — hängt davon ab, **wie lange der letzte Kauf zurückliegt und
wie groß er war**. Alle Grenzen sind gemessen, nicht geschätzt: sie stammen aus
`npm run analyze:repurchase` über die vollständige Bestellhistorie
(28.541 Bestellungen, 18.355 Kunden — siehe
[`REPURCHASE_ANALYSIS.md`](./REPURCHASE_ANALYSIS.md)). Seit Migration `0063` steht das Segment
jedes Kunden in `customer_facts.lifecycle_segment` (nächtlich berechnet) — dieselben Schlüssel
nutzen die Zielgruppen (§2.2) und die Kunden-Liste.

### Die drei Befunde, die das Design bestimmen

1. **Der Zeitpunkt skaliert NICHT mit dem Kaufwert.** Median-Abstand 88 / 81 /
   68 Tage über die drei Wertstufen — 20 Tage Spreizung, und in die
   *umgekehrte* Richtung als ursprünglich vermutet. Deshalb gibt es **eine
   Zeitschiene für alle**, keine Matrix.
2. **Der Inhalt skaliert sehr wohl.** Käufer ab 150 € kaufen Zubehör zum Besitz
   doppelt so oft wie darunter (25,5 % vs. 13,0 %), und die Relevanz hält ein
   volles Jahr; unter 150 € halbiert sie sich bis Monat drei.
3. **Das stärkste Fenster sind 7–30 Tage** (38,6 % ab 150 €) — der höchste Wert
   im gesamten Datensatz.

### Segmente

| Segment | Tage seit Kauf | < 150 € | ab 150 € |
| --- | --- | --- | --- |
| `frisch` | 0–7 | **nicht senden** | **nicht senden** |
| `ausbauen_frueh` | 7–30 | Zubehör | Zubehör |
| `ausbauen` | 30–90 | Zubehör | Zubehör |
| `weiterentwickeln` | 90–365 | Ähnlichkeit | Zubehör |
| `zurueckholen` | 365–730 | Win-back | Zubehör |
| `ruhen` | > 730 | **nicht senden** | **nicht senden** |
| `unbekannt` | kein Kaufdatum | Ähnlichkeit | Ähnlichkeit |

Die Wertstufen kommen aus `repurchase-analysis.mjs` (Grenzen 150 € / 1.500 €),
damit Analyse und Produktion nie auseinanderlaufen. Die Segmentierung **legt die
oberen beiden zusammen**: ihr gemessenes Verhalten ist gleich (Lift 4,6× in
beiden) und Großgeräte allein ist zu dünn für eigene Regeln (n = 19–54 je
Fenster).

### Empfehlungs-Strategien

`pickCampaignRecommendations(history, selection, strategy)`:

- **`complement`** — Zubehör aus `Product.compatibleWith` („Ergänzende
  Produkte", im Shop gepflegt: 87 % des Katalogs, Ø 6,9 Einträge). Zubehör des
  **jüngsten** Kaufs führt das Ranking an, danach zählt, zu wie vielen besessenen
  Produkten es passt. Bereits Besessenes ist ausgeschlossen.
- **`similarity`** — der klassische Embedding-Pick. Er findet *Ersatz*, nicht
  *Ergänzung* — wer ein Rack kaufte, bekommt ein weiteres Rack. Richtig erst,
  wenn die Zubehör-Relevanz abgefallen ist.
- **`winback`** — breite, repräsentative Auswahl ohne Bezug auf einen alten Kauf.

**Kundenprofil als Steuerung** (Migration `0059`): Hat der Kontakt ein Profil,
wird aus Zielen, Interessen und nächsten Schritten ein Suchvektor
(`profileSteeringQuery` → `embedQuery`). `similarity` gewichtet dann 60 %
Kaufähnlichkeit + 40 % Profilähnlichkeit (`blendRecommendationScore`),
`winback` rankt nach dem Profil statt repräsentativ, und Kontakte ohne
Kaufsignal bekommen echte Picks aus dem Profil statt `low_confidence`-Picks.
`complement` bleibt unverändert (Zubehör des Besessenen).

Jede Strategie **degradiert, statt zu scheitern**: `complement` ohne gepflegtes
Zubehör fällt auf `similarity` zurück, `similarity` ohne Embedding-Signal auf
repräsentative Picks. `recommendations.strategy` sagt, was die Picks
*tatsächlich* erzeugt hat — das zeigt die Review-Karte, nicht den Wunsch.

### Wirkung auf den Text

Das Segment steuert nicht nur die Produkte, sondern **den Job der Einleitung**
(`segmentIntroRule` in `campaign-draft.ts`): frischer Kauf → daran anknüpfen;
ein Jahr her → kurz erinnern und nach vorn schauen; zwei Jahre → ehrlich
benennen, dass man lange nichts gehört hat. Gleiche Vorlage, gleiche Stimme,
anderer Auftrag.

### Warteschlange

In **laufenden** Kampagnen überspringt `listNextPendingContacts` Empfänger:innen, die die Daten
ausschließen (`frisch`, `ruhen`) — per SQL-Filter, **nicht** durch Statuswechsel: ein „frischer"
Kontakt geht nicht verloren, er wird sendbar, sobald er ins nächste Fenster altert. Kontakte ohne
bekanntes Kaufdatum sind nie ausgeschlossen. Eine **Aktion** und die Einzelansprache schreiben ihre
ganze Zielgruppe an (kein Sendefenster); wer dort frische oder ruhende Kund:innen ausschließen
will, tut das über den Lebenszyklus-Filter der Zielgruppe.

`listDraftedQueue` sortiert nach gemessenem Wert statt nach Eingang: das
Frühfenster zuerst, dann nach Lebensumsatz. Ein Kontakt ab 150 € ist rund
dreimal so wahrscheinlich ein wiederkehrender Zubehör-Käufer.

### Messbarkeit

`campaign_sends.segment` wird beim Versand gestempelt (beide Pfade: E-Mail und
„kopiert"). Ohne diesen Stempel ließe sich **nie** beantworten, ob die
Zubehör-Strategie die Ähnlichkeit tatsächlich geschlagen hat — und
nachträglich ist die Historie weg.

### Was NICHT automatisch passiert

Die Grenzen stehen im Code (`campaign-segments.mjs`) und ändern sich nur durch
ein Release. Eine automatische Nachjustierung aus wiederholten Analyse-Läufen
wäre eine **Rückkopplung**: die Analyse misst Verhalten *ohne* unsere
segmentierten Mails; sobald sie laufen, optimierte eine Automatik gegen die
eigene Wirkung. Wenn die Zahlen nachgeführt werden sollen, dann nach dem Muster
des Verbesserungs-Loops: die Auswertung *schlägt vor*, ein Mensch entscheidet.

## KPIs und Hero-A/B-Test (Migration `0054`)

**Was je Send festgehalten wird.** Neben Segment (0052) stempelt der Versand
jetzt einen Schnappschuss der Mail auf `campaign_sends`: `design_key`,
`hero_variant` (`ai` = individuell generierter KI-Hero, `default` = Hero-Design
mit Standard-Bild, `none` = ohne Hero / Kopier-Pfad), `hero_image_url`,
`hero_headline`, `text_mode`, `language`, `discount_percent`,
`discount_scope` (0058), `bundle_offer_id`; seit 0066 auch `campaign_id` und `customer_id`. Der
Entwurf wird bei jedem Regenerieren überschrieben —
ohne den Stempel wäre nach dem Versand nicht mehr rekonstruierbar, was
verschickt wurde.

**Welche Ergebnisse zugeordnet werden.**
- **CTA-Klick** — `clicked_at` (seit 0041), erster Klick auf `/api/r/<token>`.
- **Set-Klick** — `bundle_clicked_at`: der erste Klick auf „Zur Kasse" des
  mitgeschickten Sets (Redirect-Route stempelt über `bundle_offer_id`).
- **Einlösung + Umsatz** — Shopify-Abfrage je MK-Code (`fetchCodeRedemption`),
  jetzt mit Bestellwert, je Variante, Segment und Kampagne summiert.
- **Abmeldung** — `unsubscribed_at`: eine Abmeldung wird den Kampagnen-Mails
  der letzten 30 Tage an diese Adresse zugeordnet.
- **Hero-Kosten** — `ai_usage.campaign_contact_id` verknüpft jede
  Hero-Generierung (Prompt, Renders, Prüfung) mit dem Kontakt; der KPI-Tab
  summiert die Kosten je Hero-Variante.
- **Bewertung** — `feedback.rating` / `email_kind`: die Klick-Bewertung als
  Zahl (Ø je Zeitraum). Absichtlich anonym, daher keiner Variante zuordenbar.
- **Chat-Start** — der Redirect hängt den Send-Token als `mo_c` an den
  Mo-Deeplink; das Widget schickt ihn als `campaignToken` mit der ersten
  Chat-Anfrage zurück (`POST /api/chat`, additiv). Der Server prüft das Format,
  sucht den echten (Nicht-Test-)Send und speichert je Send **einmal** ein
  sitzungsloses KPI-Event `campaign_chat_started` (`data: { sendId,
  campaignId }`) — der pseudonyme Chat wird nie mit der Person verknüpft.
  Sichtbar als „Chat gestartet“ in „Kampagnen im Vergleich“ und in der
  Komplettanalyse. Die Widget-Seite (`mo_c` lesen und mitschicken) ist eine
  Frontend-Aufgabe; bis sie live ist, bleibt die Spalte bei 0.

**Der Kampagnen- und Hero-Vergleich im KPI-Tab.** Tabelle „Kampagnen im Vergleich“: derselbe
Funnel je Kampagne (Lebenszyklus, Aktionen, Einzelansprache), zusätzlich mit „Chat gestartet“.
Tabelle „Hero-Vergleich: lohnt sich
das KI-Bild?": je Variante Gesendet, Klickrate, Set geklickt, Eingelöst, Umsatz,
Umsatz je Send, Hero-Kosten, Kosten je Send, Abgemeldet — dazu dieselbe
Tabelle je Lebenszyklus-Segment. Damit beide Gruppen Sends bekommen, zeigt der
Prüftisch je Kontakt die **A/B-Gruppe** (gerade Kontakt-ID: mit KI-Hero senden, ungerade:
Hero-Panel leer lassen). Der Titelbild-Modus der Kampagne legt fest, für wen „Vorbereiten…“
KI-Heros erzeugt (`ai_ab`: A-Gruppe, `ai_all`: alle); bei `none` reist kein KI-Hero mit, und bei
`default` / `none` zeigt der Prüftisch keine Hero-Hinweise und keine Hero-Spalte. Der
Stempel hält fest, was
tatsächlich verschickt wurde, nicht die Empfehlung. Faustregel: erst ab etwa
100 Sends je Gruppe sind Klickraten-Unterschiede von wenigen Prozentpunkten
belastbar; Umsatz je Send braucht noch mehr.

**Was der Funnel nicht kann (bewusst / offen).**
- Keine Öffnungsraten — kein Tracking-Pixel (Datenschutz-Entscheidung seit
  0041). Klickrate bezieht sich auf gesendete, nicht auf geöffnete Mails.
- Bounces und Beschwerden kommen über den Resend-Webhook (s. u.); ohne
  eingerichteten Webhook bleiben „Zugestellt / Bounces" leer.
- Einlösung wird für die 100 neuesten Codes je Zeitraum geprüft; darüber
  hinaus ist die Stichprobe gekappt (im Tab markiert).

## Zustellung: Bounces und Beschwerden (Migration `0055`)

**Was passiert.** Resend meldet per Webhook, was mit einer Mail nach der
Übergabe geschah. `POST /api/webhooks/resend` (und die Inbound-Route, falls die
Events dort ankommen) prüft die Svix-Signatur über den Roh-Body und wendet das
Event an (`email-delivery-events.ts`, Parser getestet):

| Event | Wirkung |
|---|---|
| `email.bounced`, Typ *Permanent* (hart) | Adresse auf `suppression_list` (Grund `bounce`) — das Kampagnen-Gate verweigert jeden weiteren Send; `campaign_sends.bounced_at`, `bounce_type = 'hard'` |
| `email.bounced`, Typ *Transient/Undetermined* (weich) | nur Stempel `bounced_at`, `bounce_type = 'soft'` (voller Posteingang, Greylisting) |
| `email.complained` (Spam-Taste) | `suppression_list` (Grund `complaint`) + `complained_at` |
| `email.delivered` | `delivered_at` |
| `email.delivery_delayed` | ignoriert (acked) |

Die Zuordnung zum Send läuft über `provider_email_id` (Resends Message-ID,
seit 0055 beim Versand gespeichert); Events ohne bekannte ID treffen den
neuesten Send an diese Adresse der letzten 7 Tage. Erster Stempel je Art.
Der KPI-Tab zeigt „Zugestellt / Bounces" mit harten Bounces und Beschwerden.

**Einrichtung in Resend** (Dashboard → Webhooks):
1. Endpoint `https://mo.motionsports.de/api/webhooks/resend`, Events
   `email.bounced`, `email.complained`, `email.delivered`.
2. Signing Secret in Vercel als `RESEND_EVENTS_WEBHOOK_SECRET` setzen.
   Alternativ die drei Events beim bestehenden Inbound-Webhook ergänzen — dann
   reicht `RESEND_WEBHOOK_SECRET`, beide Routen akzeptieren beide Secrets.
3. Test: in Resend „Send test event" für `email.bounced` → Antwort
   `{ ok: true, kind: "bounced", … }`; ohne gültige Signatur antwortet die
   Route mit 400, ohne Secret mit 503.
