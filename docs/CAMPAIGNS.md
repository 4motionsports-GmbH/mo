# Kampagnen-Modul — personalised marketing e-mails to the customer base

The campaign module (migration `0034`; many campaigns since `0066`) e-mails the shop's customer base
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

Since migration `0074` a campaign can also reach its audience **by letter** (Pingen) — above all
the customers without the e-mail consent. Each letter is drafted, reviewed and released one by one
on the desk's „Briefe“ view, behind `PHYSICAL_MAIL_SENDS_APPROVED` and its own gates (§8).

This document owns the campaign rules, the data model, the gates and the endpoints. The screens —
overview, editor, review desk with its views and keys — are described in
[`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §3.2; whether a flag is on in production is in
[`ROLLOUT_TODO.md`](./ROLLOUT_TODO.md).

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
  the contact search, or „Abmeldung aufheben“ in Kunden → Marketing). Both directions change the
  one consent (`lib/consent-flows.ts`); the consent and Shopify effects are in
  [`CONSENT_FLOW.md`](./CONSENT_FLOW.md) „The one consent (Shopify ⇄ Mo)“. On the campaign side an
  opt-out marks the person's open recipient rows `suppressed`; lifting — only `unsubscribe` /
  `manual` blocks, bounces, spam complaints and erasures stay — deletes the block-list row, brings
  back a previously confirmed chat DOI, clears the 30-day KPI attribution on campaign sends and
  returns the person's suppressed recipient rows to `drafted` (draft kept) or `pending`. Neither
  direction sends an e-mail; both are audit-logged (`customer.optout`, `customer.optout.lift`).
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

**Retired: the Shopify newsletter sync** (`campaign-sync.ts`, `/api/cron/sync-campaign-audience`,
`POST /api/admin/campaign/sync`) — removed; the customer mirror ([`CUSTOMERS.md`](./CUSTOMERS.md)),
the one consent and the audience refresh of §2.3 replace it. History:
[`archive/CAMPAIGNS_HISTORY_2026-10.md`](./archive/CAMPAIGNS_HISTORY_2026-10.md).

## 2. Campaigns (migration `0066`)

Definitions and the pure rules live in [`campaign-def.mjs`](../src/lib/campaign-def.mjs) (tested);
the I/O in [`campaigns-store.ts`](../src/lib/campaigns-store.ts). The queue per recipient (drafts,
sends) stays in [`campaign-store.ts`](../src/lib/campaign-store.ts).

### 2.1 Kinds, status and phase

| Kind (`kind`) | Label | Audience | Notes |
| --- | --- | --- | --- |
| `laufend` | Laufend | default `dynamisch` | Re-entry after `reentry_days` (default 180); the lifecycle send window applies (Lifecycle-Segmentierung below). Seeded by `0066`: „Bestandskunden – Lebenszyklus“ (`lebenszyklus`, `dynamisch`, priority 10, hero `ai_ab`, re-entry 180 days), which holds every recipient and send from before `0066`. |
| `aktion` | Aktion | default `fest` | Mails its whole audience (no lifecycle window). `discount_valid_until` makes every code of the Aktion end at the same moment. |
| `einzel` | Einzelansprache | none — recipients are added by hand | Exactly one (unique index), created by `0066` (`einzelansprache`, priority 100), always `aktiv`, no status changes; only offer, design and texts are editable. |

New campaigns are created as `laufend` or `aktion` (never `einzel`) with status `entwurf`; nothing is
materialised or drafted until they start. Status transitions (`canTransition`):

```
entwurf → aktiv | archiviert      aktiv → pausiert | beendet
pausiert → aktiv | beendet        beendet → archiviert | aktiv
```

The buttons say Starten / Fortsetzen / Wieder aufnehmen / Pausieren / Beenden / Archivieren;
every move to `aktiv` (Starten, Fortsetzen, Wieder aufnehmen) and Beenden are confirmed. Moving to
`aktiv` stamps `started_at` once and materialises the audience at once (§2.3); Beenden stamps
`ended_at` and leaves every row as it is (audit trail). The nightly audience job ends every `aktiv` campaign whose `ends_at` has passed
(`endExpiredCampaigns`).

**Phase** (`campaignPhase`) is what the UI shows: `geplant` (aktiv, start ahead), `laeuft`,
`abgelaufen` (aktiv, end passed, until the nightly job ends it), or the status itself. Mails go out
only in `laeuft` (`campaignAcceptsWork`; the Einzelansprache whenever it is `aktiv`). Vorbereiten
works for any `aktiv` campaign whose end has not passed — a `geplant` Aktion can be drafted ahead.

### 2.2 Neue Kampagne / Bearbeiten (the editor)

The Kampagnen overview (`?tab=kampagne`, alias `kampagnen`) lists one card per campaign with its
status actions; „Neue Kampagne“ and „Bearbeiten“ open the editor sheet (`?edit=new` /
`?edit=<id>`; [`CampaignEditor.tsx`](../src/app/admin/kampagnen/CampaignEditor.tsx); the screens:
[`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §3.2) with eight sections. Everything is validated
again on the server (`validateCampaignInput`):

| Section | Fields (column) |
| --- | --- |
| Grundlagen | Name 3–80 chars (`name`, a unique `slug` is derived), Art (`kind`), Start/Ende (`starts_at`/`ends_at`, end after start), Priorität 0–100 (`priority`) |
| Briefing | `brief`, max 4,000 chars — Anlass, Ziel, Ton, Muss rein, Bitte nicht. The drafter reads it for every mail of the campaign (§4). „Briefing vorschlagen“ drafts one from name, kind, end date, discount and notes. |
| Zielgruppe | The audience spec (`audience`, below), Fest/Dynamisch (`audience_mode`), „Erneut aufnehmen nach“ (`reentry_days`, `laufend` only, 14–3,650 days, empty = never), live count. Hidden for the Einzelansprache. |
| Angebot | Rabatt (`discount_percent`, 0–`DISCOUNT_PERCENT_MAX`), Gilt für (`discount_scope`: all / recommendations / set), Codes gültig bis (`discount_valid_until`) — the starting values for Vorbereiten; each draft can still change them |
| Gestaltung | Design (`design_key`; empty = the design selected for campaign mails in Einstellungen), Titelbild (`hero_mode`: `none` / `default` / `ai_ab` / `ai_all`), Textlänge (`text_mode`), Button führt zu (`cta_kind`: `mo_chat` / `shop`) + Shop-Link (`cta_url`, `https://` required for `shop`), Mo-Hinweis anhängen (`mo_promo`, default on — the chat button lives in the Mo hint, so `mo_chat` with `mo_promo = false` is refused: „Der Button zu Mo steht im Mo-Hinweis — Hinweis einschalten oder den Button auf den Shop zeigen lassen.“) |
| Brief | Letters as a channel (migration `0074`, §8): „Briefe“ (`letter_mode`: „Keine Briefe“ `aus` — the default —, „An alle ohne E-Mail-Einwilligung“ `ohne_einwilligung`, „An alle (auch mit Einwilligung)“ `alle`), „Porto-Budget (€)“ (`letter_budget_cents`, 0–100,000 €, empty = no cap) and the live line „Per Brief: N Empfänger:innen (Adresse schon bekannt: M) · ≈ X € Porto bei Y € je Brief“ (M counts purchase addresses only); Callouts while `PHYSICAL_MAIL_SENDS_APPROVED` is off or Pingen is not configured. Hidden for the Einzelansprache. |
| Automatik | Automatisch vorbereiten 0–500 drafts per night (`auto_prepare_per_day`, §5), Tagesziel (`daily_target`, 1–5,000 — no automation; shown as „Tagesziel n“ next to today's progress in the desk header) |
| Prüfen & testen | Nothing stored — the estimate and sample mails below. Hidden for the Einzelansprache. |

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
consent — a count, nothing is materialised; every recipient row still requires it. With a letter
mode (section „Brief“) the same call takes `letterMode` and adds a third match under the letter
rules of §8.2: `letters { total, withAddress }` — the campaign's letter recipients and how many of
them already have a purchase address.

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

**Prüfen & testen** ([`CampaignCheckSection.tsx`](../src/app/admin/kampagnen/CampaignCheckSection.tsx),
[`campaign-sample.ts`](../src/lib/campaign-sample.ts), pure rules in
[`campaign-sample-core.mjs`](../src/lib/campaign-sample-core.mjs), tested;
`POST /api/admin/campaigns/sample`) — the last look before a campaign goes live:

- **Estimate** (`campaignPlanEstimate`): KI-Texte = recipients × the average draft cost,
  KI-Titelbilder = (A/B: half, „für alle“: every) recipient × the average hero pipeline
  (`estimateCampaignCosts`, the same averages the Vorbereiten popover states; „unbekannt“
  until something was recorded), Prüfzeit = recipients ÷ Tagesziel (100 per day without
  one) against the days left between start (or today) and end, Vorbereitung = nights of the
  nightly run (its per-campaign count, capped by `CAMPAIGN_AUTO_PREPARE_COUNT`). A Callout
  warns when the review or the preparation does not fit the window, or the end has passed.
- **Sample mails** (`action: "pick"` then `"generate"`): the matcher's 60 newest matches,
  of which `pickSampleRecipients` takes the three that differ most (language and Mo chat
  weigh double, then Lebenszyklus and orders). Each draft is written exactly like
  `prepareDraftForContact` writes it — ledger purchase history, recommendations, AI profile
  unless the person objected (Art. 21), the campaign's briefing, discount, scope and text
  mode — but under the form's CURRENT values (validated like an update, laid over the saved
  campaign), so a briefing can be tried before saving. The person must have the consent and
  no block (fail-closed, `not_eligible`). Rendering (`renderCampaignSample`) uses the
  campaign's design with the placeholder code, the design's own title image (AI heroes and
  sets come only on the desk) and **inert** unsubscribe/erasure links. Nothing is stored —
  no recipient row, no draft, no code; the AI call is metered (`ai_usage`, `campaign_draft`).
- **Test send** (`action: "send_test"`): the sample becomes a Testkontakt (§5) of the SAVED
  campaign at the operator's address — it borrows the sample person's purchase history, its
  draft is exactly the sample's text and products — and goes through
  `approveAndSendCampaign` like any test send (real `MK-` code, tracking, unsubscribe;
  test sends ignore the consent, block list and cadence of the inbox, every other gate
  applies). Each sample carries `sampleConfigFingerprint` of the settings it was made with;
  the server refuses (409 `stale_sample`) when the saved campaign's fingerprint differs, and
  the UI blocks the button while the form has unsaved changes.

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
updates snapshots and consent. A campaign with a letter mode refreshes its letter recipients
in the same run, after the e-mail recipients (§8.2).

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
| `campaigns` (`0066`) | One row per campaign | `name`, `slug` (unique), `kind`, `status`, `brief`, `audience` (jsonb spec), `audience_mode` (`dynamisch` \| `fest`), `priority`, `starts_at`/`ends_at`, `daily_target`, `auto_prepare_per_day`, `reentry_days`, `discount_percent`, `discount_scope`, `discount_valid_until`, `design_key`, `hero_mode`, `text_mode`, `mo_promo`, `cta_kind`/`cta_url`, `letter_mode` + `letter_budget_cents` (`0074`, §8), `audience_refreshed_at`, `started_at`/`ended_at` |
| `campaign_contacts` (`0034`, recipients since `0066`) | One row per person per campaign per cycle + the review-queue lifecycle | `campaign_id` (FK campaigns, cascade), `customer_id` (FK customers, SET NULL, `0059`), `cycle` (default 1), normalized `email`, `first_name`/`last_name`, `language` + `language_override` (`0040`), `opt_in_level`, `consent_updated_at`, `orders_count`, `total_spent_cents`, `last_order_at` (`0052`), `last_synced_at`, `status` (`pending → drafted → sending → sent` \| `skipped` \| `suppressed` \| `excluded` \| `draft_failed`), `excluded_reason`, `admin_note`, `conversation_id` (FK conversations, SET NULL), `added_at`, `created_at`, `sent_at`, `skipped_at`; `is_test` + `test_source_email` (`0057`, Testkontakte — §5); `added_manually` (`0069`, hand-added — §2.4); `approved_at`, `release_at`, `approved_fingerprint`, `release_error`, `claimed_at` (`0072`, Einplanen — §5). Unique `(campaign_id, customer_id, cycle)` for real rows and `(campaign_id, email)` for test rows; `shopify_customer_id` is no longer unique and may be NULL. |
| `campaign_drafts` | ONE editable draft per recipient (unique `contact_id`, cascade) | `subject`, `body` (with `MO-XXXX` placeholder), `discount_percent`, projected `discount_expires_at`, `discount_scope` (`all` \| `recommendations` \| `set`, `0058`), compact `purchase_summary` (jsonb), `purchase_selected_ids` (`0043`, the recommendation basis), `recommended_product_ids`, `low_confidence`, `product_highlights` (`0046`), `text_mode` (`0047`), `segment` + `segment_days` (`0052`), the KI-Hero `hero_image_url` + `hero_image_prompt` (`0050`), `hero_headline` (`0051`), `hero_image_mobile_url` (`0053`) — [`EMAIL_DESIGNS.md`](./EMAIL_DESIGNS.md) |
| `campaign_sends` | Immutable send record (audit + KPI) | `contact_id` (SET NULL), `campaign_id` (FK campaigns, SET NULL, `0066`), `customer_id` (FK customers, SET NULL, `0066`), `email`, `subject`, `body_hash` (SHA-256 of the shipped text), `body_text`/`body_html` (the shipped parts as delivered — `0038`; `body_html` NULL on the copy path, both NULL for pre-0038 rows), `sent_via` (`email`/`copy`), real `discount_code` (`MK-…`) + `discount_code_gid` + `discount_expires_at`, `redirect_token`/`clicked_at` (`0041` — the tracked CTA, see below; NULL for copy sends and pre-0041 rows), `sent_at`; `segment` (`0052`); the snapshot of `0054` — `design_key`, `hero_variant`, `hero_image_url`, `hero_headline`, `text_mode`, `language`, `discount_percent`, `bundle_offer_id`, `bundle_clicked_at`, `unsubscribed_at` — plus `discount_scope` (`0058`); `is_test` (`0057`); the delivery columns of `0055` — `provider_email_id`, `delivered_at`, `bounced_at`, `bounce_type`, `complained_at` (both: sections below) |
| `campaign_letters` (`0074`) | One letter per person per campaign per cycle (the letter channel, §8.1) — separate from `campaign_contacts`, whose queries all assume the e-mail consent | `campaign_id` (FK campaigns, cascade), `customer_id` (FK customers, cascade), `cycle` (always 0), `status`, `excluded_reason`, `subject`/`body`, `edited`, `admin_note`, `drafted_at`/`approved_at`/`sent_at`, `page_count`, `physical_letter_id` (FK physical_letters, SET NULL), `error`, `added_at`/`updated_at`; unique `(campaign_id, customer_id, cycle)` |

A draft reads the purchases from the local order ledger `customer_orders` (`0062`,
[`CUSTOMERS.md`](./CUSTOMERS.md); fallbacks in §4) and keeps only the compact `purchase_summary`
snapshot the review card needs. The shipped body is retained next to its `body_hash` (`0038`), so
the "Gesendet" view can open exactly what the recipient received; rows purge on the retention
window (§6).

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

> **Legal status.** The lawyer approved the channel on 2026-07-21 for the Shopify-checkbox
> audience, including `SINGLE_OPT_IN`/`UNKNOWN` (record: [`ANWALTSDOSSIER.md`](./ANWALTSDOSSIER.md)
> Anhang A). Both flags default to `false` in code and in `.env.example`; an absent variable means
> false, and either flag can be set false at any time to re-lock the channel. Production state:
> [`ROLLOUT_TODO.md`](./ROLLOUT_TODO.md) 6.5 „Send gates“.

| # | Gate | Flag / source | Code default | Effect |
| --- | --- | --- | --- | --- |
| 0 | Campaign live | `campaigns.status` + schedule | — | Only a campaign in phase `laeuft` sends (the Einzelansprache while `aktiv`); otherwise `campaign_closed` (409). A Testkontakt may send before the start, never for an ended or archived campaign. |
| 1 | Master send gate | `CAMPAIGN_SENDS_APPROVED` | **false** | While false, **every** campaign send is refused server-side (403) — UI *and* direct API calls. Drafting, preview and Copy keep working. The desk shows a banner that the sign-off for this channel is pending. Separate from `CONSENT_COPY_LAWYER_APPROVED` and `PHYSICAL_MAIL_SENDS_APPROVED`. |
| 2 | Consent | `customers.email_consent_state`, read fresh | — | Must be `subscribed`; otherwise `no_consent` (403). A recipient whose customer row is gone is refused (`not_eligible`, 409). |
| 3 | Opt-in level | `CAMPAIGN_ALLOW_SINGLE_OPT_IN` + `customers.email_consent_level` | **false** | Without `confirmed_opt_in` the send is refused (403, "Erneute Einwilligung erforderlich") while the flag is false; such recipients stay visible in the queue (Copy allowed). |
| 4 | Suppression | `suppression_list` (`isSuppressed`) | — | Every reason blocks (unsubscribe, manual, bounce, complaint, erasure). Fail-closed: a DB error blocks the send. Also checked at refresh and prepare time. |
| 5 | Frequency cap | `MARKETING_MIN_SEND_INTERVAL_DAYS` | 0 (off) | Spans **every** campaign (Einzelansprache included) **and** the Mo funnel: the newest send to the address across `campaign_sends` *and* `marketing_sends` (`lastCrossChannelSendAt`) must be older than the window (429 otherwise). |

**After the gates, before the claim** (`campaignSendPreflight`): a draft without a discount whose
text still contains the placeholder code `MO-XXXX` is refused (`discount_mismatch` 409,
`discount-swap.hasStrayPlaceholder`, tested) — the code swap only runs when a code is minted, so
the customer would read an offer that does not exist. The same rule refuses it in the 1:1
marketing path, and the desk shows it as „Platzhalter-Code ohne Rabatt“ (blocked). Without a
signed unsubscribe link nothing is sent (`no_unsubscribe` 503). **After the atomic claim**
(`approveAndSendCampaign`, the claim is reverted on each refusal): prose naming a different
percentage than the set discount (`discount_mismatch`, `detectDiscountTextMismatch`), a discount
scope that cannot be honoured (`discount_scope_unresolved` 409, §4) and a code that cannot be
minted (`discount_failed` 502).

Testkontakte (§5) skip gates 2, 4 and 5 — they are the operator's own inboxes. The **copy path**
(`POST /api/admin/campaign/mark-done`) delivers nothing, so the master flag does not apply; it does
check the consent and the block list (409 `not_eligible`).

**What the lawyer approved** with `CAMPAIGN_SENDS_APPROVED`: mailing this audience on the basis of
Shopify's checkbox consent at all, and — separately — whether `SINGLE_OPT_IN`/`UNKNOWN` contacts may
be included (`CAMPAIGN_ALLOW_SINGLE_OPT_IN`) or must first re-confirm.

**Letters (§8) do not pass these gates — they have their own.** An advertising letter needs no
e-mail consent (mode `ohne_einwilligung` even requires its absence); it is checked per letter, at
send time and with the person read fresh, by `decideCampaignLetterSend`
([`campaign-letter-core.mjs`](../src/lib/campaign-letter-core.mjs), tested): the letter gate
`PHYSICAL_MAIL_SENDS_APPROVED` (code default **false**) → Pingen configured → campaign live → no
objection to postal advertising (Art. 21) → no e-mail consent given since (mode
`ohne_einwilligung`) → a complete address taken from the latest completed order, not marked
undeliverable → text present → `LETTER_MIN_INTERVAL_DAYS` since the person's last letter → the
campaign's postage budget (§8.6). Every letter is released one by one by a person; the legal
questions are in [`ANWALTSDOSSIER.md`](./ANWALTSDOSSIER.md) § 18 (F-35).

**DOI refresh (FUTURE option, deliberately not built):** people without a provable double opt-in
could be sent a one-time re-confirmation request through the existing DOI confirmation
infrastructure (`/api/confirm-marketing`, `email_captures.marketing_doi_status`), upgrading their
level to `confirmed_opt_in`. Documented here as the designated path; nothing implements it yet.

Every campaign email carries, outside the editable prose (an edit can never remove them): the
signed unsubscribe link (writing to the same consent and block list), a `List-Unsubscribe` header,
and the branded shell's Impressum/privacy footer
([`email-template.ts`](../src/lib/email-template.ts)). Copy ceiling: no fake urgency and no
countdown rhetoric in the prose — same rule as the marketing drafts, enforced in the prompt and in
the deterministic promo copy; the real end date of an Aktion may be named factually. (The
deterministic offer countdown of the design shows the real deadline only —
[`EMAIL_DESIGNS.md`](./EMAIL_DESIGNS.md) „Offer countdown, set card and coupon“.)

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
     both languages (`moPromoBlockText`). The widget handles the link (`handleMoDeepLink`):
     `mo=open` opens the panel, `mo_new=1` starts a fresh consultation, `mo_view=fullscreen` opens
     the large view, and the `mo*` parameters are stripped — as-built in
     [`frontend/05-engagement-and-kpi.md`](./frontend/05-engagement-and-kpi.md) §9.
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
campaign mails in Einstellungen (`getEmailDesignForKey`; unknown key → the selection; the designs
and the hero pipeline: [`EMAIL_DESIGNS.md`](./EMAIL_DESIGNS.md)).
`hero_mode`: `none` — no per-recipient KI-Hero rides along even if one was generated; `default` —
the design's standard hero; `ai_ab` — Vorbereiten generates the KI-Hero for the A group (even
recipient ids); `ai_all` — for every prepared card (§5).

## 5. Review workflow (Kampagnen screen)

Each campaign has its own **review desk** (Prüftisch) at `?tab=kampagne&campaign=<slug|id>`. The
screen — header strip, the views Prüfen · Liste · Eingeplant · Briefe · Gesendet, rail, mail and
review columns, Fokus-Modus and the keys (`N`/`P` next/previous, `S` send, `A` Einplanen while
`CAMPAIGN_RELEASE_ENABLED`, `X` skip, `E`/`Esc` edit, `R` regenerate, `V` preview, `C` copy, `F`
Fokus-Modus, `/` contact search, `?` the key list) — is described in
[`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §3.2 (design history:
[`archive/KAMPAGNE_REDESIGN.md`](./archive/KAMPAGNE_REDESIGN.md)). The rules: counts, queue, Liste,
Eingeplant, Gesendet, the contact search and the delivery strip are per campaign; a legacy link with
only `?contact=` opens the desk of that recipient's campaign. Position, view and filter live in the
URL (`?contact=`, `?view=pruefen|liste|eingeplant|briefe|gesendet`, `?filter=` — the chips of
`QUEUE_FILTERS` in `campaign-desk-core.mjs`). „Eingeplant“ shows while Einplanen is on or planned
mails exist; „Briefe“ while the campaign has a letter mode or letters exist (§8.5). Mutations are
keyed by contact id, so filtering never mis-targets a card.

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
subject over 70 characters), *info* (edited by hand, a Testkontakt, a Testkontakt address on the
block list, a KI-Hero present). Each check carries one fix action
(Überspringen, Neu generieren, Basis anpassen, Produkt tauschen, Set neu
erstellen, Hero erzeugen, Betreff kürzen). The rail dot, the „Hinweise“ /
„Blockiert“ chips and the Liste column show the same verdict.

**Sending never blocks the next card.** The desk takes a sent card out of the queue at once and
waits for the server in the Postausgang; a refusal brings the card back with the server's reason as
a blocked Prüfpunkt (screen: [`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §3.2). The atomic claim
in `claimContactForSend` prevents double sends. Offer and text changes (Rabatt, Sprache, Textmodus,
Empfehlungen, Set) persist at once and batch into one background regenerate; sending that card
waits until the prose is fresh.

**Vorbereiten…** drafts the next `pending` recipients of the campaign (25/50/100; the send window
counts for `laufend` campaigns only) with Rabatt and Textmodus for the NEW drafts, starting from the
campaign's offer settings; changes are remembered per campaign in the browser and also apply to
„Entwurf erstellen“ and „Wiederherstellen“. The optional **KI-Hero** step (pre-selected) runs
`suggest` + `generate` after the drafts — for every prepared card under `ai_all`, for the A group
under `ai_ab` (see „KPIs and the hero A/B test“ below); it is offered only for these two hero modes,
when the design has a hero and generation is configured. The estimate before any money is spent: drafts, heroes (one per draft
under `ai_all`, about half the drafts under `ai_ab`; `prepareEstimate` in
`campaign-desk-core.mjs`), ≈ € from the recorded `ai_usage` averages (`estimateCampaignCosts`),
≈ minutes. It runs as a background job while the review continues.

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
unsubscribe link, Resend delivery events — and, when the mail's button leads to Mo, the chat start:
opening the chat from a test mail and writing a message records `campaign_chat_started` with
`test: true`, so the whole link can be checked. Test sends are stamped
`campaign_sends.is_test` and left out of the Kampagnen-Funnel (including „Chat gestartet“), the
delivery strip, the campaign cards and the revenue KPI; the
„Gesendet“ view lists them with a „Test“ badge. „Vorbereiten“, the nightly cron, the audience
refresh and „Warteschlange neu aufbauen“ never touch test contacts; counts in the header exclude
them.

**Liste** offers bulk Überspringen (free, undoable), Neu generieren… and Rabatt setzen… (paid runs,
confirmed with count and cost estimate). **Gesendet** filters the history route by delivery state
(`?delivery=` `delivered` | `clicked` | `bounced` | `complained` | `copy` | `expiring` — „Läuft bald
ab“: the offer the send carried ends within 48 hours, `offerValidity` in `campaign-desk-core.mjs`),
scoped by `campaignId`, with a pure-DB 30-day strip (`getCampaignDeliverySummary`); redemption and
revenue stay on the KPI screen with its Shopify cache.

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
  is skipped for test contacts. Once Resend has accepted a mail the claim is
  never reverted (a retry would send it twice); bookkeeping errors after that
  are reported and the recipient is marked sent.
- **Einplanen** (`POST /api/admin/campaign/approve`, migration 0072, switch
  `CAMPAIGN_RELEASE_ENABLED`, default off) — approve THIS reviewed mail now, send
  it later (at most 30 days ahead, `MAX_RELEASE_AHEAD_DAYS`; refusals answer 409, a Testkontakt
  is refused with `test_contact` — it is sent directly): `campaignSendPreflight` runs every gate
  of §3 without sending, plus `releaseBlockers` (`campaign-release-core.mjs`: a `MO-XXXX`
  placeholder without discount, an expired set offer). The row
  keeps status `drafted` and gets `approved_at`, `release_at` and
  `approved_fingerprint` (draft version + language + the campaign's design, hero,
  CTA, Mo promo and code validity), so opt-out, consent loss and every other
  open-status rule still apply to it. The job `/api/cron/release-campaign-mails`
  (every 10 minutes, `CAMPAIGN_RELEASE_MAX_PER_RUN` default 30,
  `CAMPAIGN_RELEASE_SPACING_MS` default 1500) sends the due mails one at a time
  through `approveAndSendCampaign`; a changed fingerprint, an expired set or a
  refused gate takes the approval back with `release_error` (shown on the card in
  the queue) — nothing is retried automatically. The view „Eingeplant“ (`?view=eingeplant`,
  [`ScheduledViews.tsx`](../src/app/admin/kampagne/ScheduledViews.tsx)) lists the planned mails;
  „Zurücknehmen“ (`POST /api/admin/campaign/unapprove`) returns one to the queue.
  Planned mails do not count as „zu prüfen“, „Warteschlange neu aufbauen“ leaves
  them alone, and those of a paused campaign wait until it resumes (an ended
  campaign's are returned to the queue by the send preflight).
  The job first recovers rows a function timeout left in `sending` (`claimed_at`
  older than 15 minutes): with a `campaign_sends` row → `sent`, without → back to
  the queue with a reason.
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

The Mo deep link a campaign click lands on carries the send's redirect token as `mo_c`; the widget
sends it back as the optional, additive **`campaignToken`** on `POST /api/chat` (contract:
[`frontend/API_CONTRACT.md`](./frontend/API_CONTRACT.md) §2; widget as-built:
[`frontend/05-engagement-and-kpi.md`](./frontend/05-engagement-and-kpi.md) §9). The server records
it: it checks the shape (`/^[A-Za-z0-9_-]{16,64}$/`), looks the token up among the `campaign_sends`
and writes **one** `kpi_events` row `campaign_chat_started` per send (`recordCampaignChatStarted`
in `campaign-store.ts`; a unique index, migration 0075, keeps it at one) — with `session_id = NULL`
and `data: { sendId, campaignId }` (plus `test: true` for a test send), so the pseudonymous chat is
never tied to the person. The funnel and the Komplettanalyse count real sends only
(`is_test = false`). Anything else is ignored; it never blocks or fails the chat. It shows as
**„Chat gestartet“** in „Kampagnen im Vergleich“ and in the Komplettanalyse chapter „Kampagnen“.
Shop-CTA campaigns (`cta_kind = 'shop'`) redirect to the shop and carry no `mo_c`.

## 6. Retention

`CAMPAIGN_CONTACT_RETENTION_DAYS` (default **365**, 0 disables; step 5g of `/api/cron/retention`)
covers `campaign_sends` (by `sent_at`), the recipients and their drafts (by
`COALESCE(last_synced_at, created_at)` — an open recipient that still matches is refreshed by every
audience refresh and stays; Testkontakte are never purged) and the letter rows (`campaign_letters`,
by `updated_at`). `campaigns` rows and the `suppression_list` are kept. The windows, the posted
letters' own window and the lawful basis: [`DATA_RETENTION.md`](./DATA_RETENTION.md) „Cluster B
(cont.) — Campaigns“.

**Complete deletion** of a person — the „Löschen“ icon in the card's Kontakt block
(`POST /api/admin/customers/erase { contactId }`), the „Daten löschen“ link in the mail, the
customer's own widget button or a Shopify erasure webhook — runs the one erasure path
(`erasePerson`): every recipient row of the person in every campaign (drafts cascade), the sends
and the campaign letters go with the customer in one transaction; the address stays on the block
list with reason `erasure`, so no audience matches it again. Entry points, what is deleted and the
Shopify side: [`DATA_RETENTION.md`](./DATA_RETENTION.md) „Complete erasure“ and
[`CUSTOMERS.md`](./CUSTOMERS.md) „Retention / erasure“.

## 7. Endpoints & files

| Piece | Path |
| --- | --- |
| Campaign list / create (Entwurf) | `GET` + `POST /api/admin/campaigns` |
| Edit a campaign (re-materialises a changed audience of an active one) | `POST /api/admin/campaigns/update` |
| Status change (Starten, Pausieren, Fortsetzen, Beenden, Archivieren) | `POST /api/admin/campaigns/status` |
| Live audience count + German description (with `letterMode` also `letters { total, withAddress }`, §8.2) | `POST /api/admin/campaigns/audience-preview` |
| AI help: audience from a sentence / Briefing draft | `POST /api/admin/campaigns/assist` (`action: "audience" \| "brief"`) |
| Prüfen & testen: sample recipients, sample mail, test send | `POST /api/admin/campaigns/sample` (`action: "pick" \| "generate" \| "send_test"`) |
| Zielgruppe aktualisieren | `POST /api/admin/campaigns/refresh` |
| Add one person (Einzelansprache by default) | `POST /api/admin/campaigns/add-recipient` |
| Add a Kunden selection (≤ 200, consent-gated, nothing drafted) | `POST /api/admin/campaigns/add-recipients` (`{ customerIds, campaignId?, adminNote? }`) |
| „Ähnliche Kunden“ + their audience spec (→ `?edit=new&audience=`) | `GET /api/admin/customers/similar?id=` |
| Eingang suggestion → Einzelansprache | `POST /api/admin/inbox/accept` |
| Chat-Start from a campaign link (widget) | `POST /api/chat` with `campaignToken` (the `mo_c` value) |
| Nightly audience refresh (cron; also the letter recipients and up to `CAMPAIGN_LETTER_ADDRESS_NIGHTLY` purchase addresses, §8) | `GET/POST /api/cron/campaign-audiences` (`CRON_SECRET`, 02:30 UTC) |
| Batch prepare | `POST /api/admin/campaign/prepare` (`campaignId`; returns `preparedContactIds`) |
| Nightly prepare (cron, off by default) | `GET/POST /api/cron/prepare-campaign-drafts` (`CRON_SECRET`, `CAMPAIGN_AUTO_PREPARE_*`, per-campaign `auto_prepare_per_day`) |
| Single draft / regenerate / purchase-basis selection | `POST /api/admin/campaign/draft` |
| Save edits | `POST /api/admin/campaign/update` |
| Curate recommendations (+ bundle rebuild) | `POST /api/admin/campaign/recommendations` |
| Set discount post-generation | `POST /api/admin/campaign/discount` |
| Rebuild one campaign's queue (discard its open drafts → pending) | `POST /api/admin/campaign/reset-queue` (`campaignId`) |
| Skip / undo skip / mark-done / send | `POST /api/admin/campaign/{skip,unskip,mark-done,send}` |
| Einplanen / Zurücknehmen | `POST /api/admin/campaign/{approve,unapprove}` |
| Release job (cron, off by default) | `GET/POST /api/cron/release-campaign-mails` (`CRON_SECRET`, every 10 min, `CAMPAIGN_RELEASE_*`) |
| Contact search (all statuses, one campaign) | `POST /api/admin/campaign/contacts` (`query`, `campaignId`) |
| Testkontakte (list / create + draft / delete) | `GET ?campaignId=` + `POST /api/admin/campaign/test-contacts` |
| Pin/clear the person's email language | `POST /api/admin/campaign/language` |
| Delete the person completely | `POST /api/admin/customers/erase` (`{ contactId, confirm: true }`) |
| Rendered draft preview (read-only, `text/html`) | `POST /api/admin/campaign/email-preview` |
| Retained sent content (read-only, `text/html`) | `POST /api/admin/campaign/sent-email` |
| Send history (paged, filtered) | `GET /api/admin/campaign/history?campaignId=&q=&from=&to=&delivery=&page=&pageSize=` |
| Letters: the „Briefe“ view — list, purchase addresses, drafts, edit, release, send steps (§8) | `POST /api/admin/campaigns/letters` (`action`: `list`, `fill_addresses`, `draft`, `redraft`, `save`, `approve`, `unapprove`, `skip`, `unskip`, `send_step`) |
| Letter as printed (read-only, `application/pdf`) | `POST /api/admin/campaigns/letters/preview` (`{ id, subject?, body? }`) |
| Purchase address of one customer (Kunden → Brief) | `POST /api/admin/customers/letter-address` (`{ customerId }`) |
| UI | `src/app/admin/KampagneTab.tsx` (overview or desk); overview + editor in `src/app/admin/kampagnen/` (`CampaignsOverview`, `CampaignEditor`, `CampaignCheckSection`); desk in `src/app/admin/kampagne/` (`KampagneWorkspace`, `CampaignHeader`, `PreparePopover`, `QueueRail`, `MailPane`, `ReviewColumn`, `ListView`, `ScheduledViews` (Einplanen dialog + view „Eingeplant“), `SentHistory`, `EmailViewerDialog`, `ContactHistorySheet`, `TestContactsSheet`, `LettersView`, `badges`, `sections/` (`BundleSection`, `HeroBlock`, `PurchaseHistorySection`), `useCampaignActions`, `useReleaseActions`, `useRenderedPreview`); the hero state hook `src/app/admin/useEmailHero.ts` |
| Libs | `campaigns-store.ts`, `audience-store.ts`, `campaign-{store,prepare,draft,recommendations,email,recommendation-view,assist,sample,release}.ts`, `campaign-{def,language,flags,gates,segments,complement,draft-core,review-checks,desk-core,sample-core,release-core}.mjs`, `audience-spec.mjs`, `discount-swap.mjs`, `discount-scope.mjs`; letters: `campaign-letters{,-store}.ts`, `campaign-letter-draft.ts`, `postal-address-fill.ts`, `campaign-letter-core.mjs`, `postal-address.mjs`, `physical-mail.ts` (`submitLetter`) |

All admin routes sit behind the existing proxy gate + `guardAdminPost` / `guardAdminGet`
(auth + JSON-content-type CSRF defense). Everything fails closed: missing
Shopify/DB config → "not configured" in the UI, never a crash, never an
ungated send.

## 8. Briefe als Kanal (Migration `0074`)

A campaign can also reach its audience **by post** — above all the people the e-mail channel may
not reach because they have no e-mail consent. Letters are printed and posted by Pingen through
the same hand-over as the 1:1 letter of Kunden → Brief (`submitLetter`), behind the same letter
gate `PHYSICAL_MAIL_SENDS_APPROVED`. Each letter is drafted (AI), reviewed and **released one by
one by a person** on the campaign's desk (view „Briefe“); a send step posts only released letters
and checks every gate again. Nothing is posted automatically. The pure rules live in
[`campaign-letter-core.mjs`](../src/lib/campaign-letter-core.mjs) (tested); the I/O in
[`campaign-letters-store.ts`](../src/lib/campaign-letters-store.ts) (rows, refresh, claim),
[`campaign-letters.ts`](../src/lib/campaign-letters.ts) (address, draft and send steps, desk
data), [`campaign-letter-draft.ts`](../src/lib/campaign-letter-draft.ts) (AI draft) and
[`postal-address-fill.ts`](../src/lib/postal-address-fill.ts) (purchase addresses).

### 8.1 Modes and data model

| `campaigns.letter_mode` | Editor „Briefe“ | Who gets a letter |
| --- | --- | --- |
| `aus` (default) | Keine Briefe | nobody |
| `ohne_einwilligung` | An alle ohne E-Mail-Einwilligung | matches **without** the e-mail consent `subscribed` — they get the letter, the consented ones the e-mail; never both channels |
| `alle` | An alle (auch mit Einwilligung) | every match, people with the consent included (who then get both) |

`campaigns.letter_budget_cents` is the campaign's postage cap (editor „Porto-Budget (€)“; NULL =
no cap). The Einzelansprache has no letter section; an update ignores `letterMode` for it.

`campaign_letters` holds one row per person per campaign per `cycle` (unique
`(campaign_id, customer_id, cycle)`, both FKs cascade) — separate from `campaign_contacts`, whose
every query assumes the e-mail consent. `cycle` is always `0` for now: a `laufend` campaign writes
a person **one** letter, there is no re-entry for letters. Further columns: `subject`, `body`,
`edited`, `admin_note`, `drafted_at`, `approved_at`, `sent_at`, `page_count`,
`physical_letter_id` (FK `physical_letters`, SET NULL), `error` (why a send step returned the
letter), `added_at`, `updated_at`.

| `status` | Meaning |
| --- | --- |
| `pending` | no text yet |
| `drafted` | text written (AI or typed) — waiting for review |
| `approved` | released by a person, this one letter |
| `sending` | claimed by a send step |
| `sent` | posted; its progress (printed, posted, undeliverable) is the `physical_letters` row — joined, never copied |
| `skipped` | „Überspringen“ by the operator |
| `excluded` | left the audience — `excluded_reason` `widerspruch` (objection to postal advertising), `einwilligung` (mode `ohne_einwilligung`: an e-mail consent given since — the person gets the e-mail instead), `zielgruppe` (no longer matches a dynamic audience) |
| `failed` | Pingen refused the submission |

The migration also adds `physical_letters.campaign_id` (the campaign a posted letter belongs to,
NULL for 1:1 letters — postage per campaign), `customers.postal_address_order_id` (the Shopify
order whose shipping address is stored) and `customers.postal_address_invalid_at` (a letter to
this address came back undeliverable). Erasure, the FK plan and the person merge cover
`campaign_letters` (cascade with the customer; a merge first deletes the duplicate's letters that
collide with the survivor's per campaign and cycle, then repoints the rest). Retention: §6.

### 8.2 Who gets a letter

`matchAudience` ([`audience-store.ts`](../src/lib/audience-store.ts)) with `letterMode`; the rule
is `letterMembership` in the core:

- The campaign's audience spec applies — Lebenszyklus, Wertstufe, orders, products and
  categories, language, country, tags, clicks, „Nicht in Kampagne“ … — **except** the two
  e-mail-only filters: „Einwilligung“ (opt-in level, `optInLevels`) and „Keine Werbe-Mail in den
  letzten n Tagen“ (`excludeMailedWithinDays`).
- Plus: at least one order (`orders_count > 0` — the only address source is an order), no
  objection to postal advertising (`customers.postal_objection_at`), no hard block.
- `ohne_einwilligung` additionally requires that the person does **not** have the consent
  `subscribed`; `alle` writes to everyone matched.
- „Nicht in Kampagne“ (`excludeCampaignIds`) also excludes people who have a letter (not
  `excluded`) in those campaigns.

Letter rows are written by the audience refresh (§2.3: Starten / Fortsetzen, saving an active
campaign, „Zielgruppe aktualisieren“ in the ⋯ menu, the nightly `/api/cron/campaign-audiences`),
after the e-mail recipients (`refreshCampaignLetters`). A `fest` audience adds letters only on the
first letter refresh; a `dynamisch` one adds newcomers and excludes the open letters (`pending`,
`drafted`, `failed`) of people who no longer match (`zielgruppe`). An excluded letter whose person
matches again is reopened (`drafted` when it has a text, else `pending`). At every refresh —
and again at send time (§8.6) — an objection excludes an open letter (`widerspruch`), and with
`ohne_einwilligung` a consent given since excludes it (`einwilligung`). A failed match changes
nothing.

### 8.3 Addresses — only the latest completed order

The only address source for an advertising letter is the **shipping address of the person's
latest completed order** (dossier § 6.4): the newest order in the local ledger with financial
status `PAID` or `PARTIALLY_REFUNDED` that is not cancelled. The ledger stores no addresses, so
`fillPostalAddressesFromOrders` reads that one order's `shippingAddress` live from the Shopify
Admin API (`nodes(ids:)`, 50 orders per call) — only for people about to get a letter — and stores
it as `customers.postal_address` with source `purchase` and `postal_address_order_id`
(`savePurchaseAddress`). `decideAddressRefresh` ([`postal-address.mjs`](../src/lib/postal-address.mjs),
tested) decides per person: no completed order → checked, nothing stored; the stored purchase
address already comes from this order → kept; otherwise (none, another source, an older order —
moved?) → fetched. The desk's batch and the nightly run check each person at most once a day
(`postal_address_checked_at`); an order without a usable shipping address (pickup) → checked,
nothing stored. **Nothing is fetched
while `PHYSICAL_MAIL_SENDS_APPROVED` is off.**

- **Other sources are never used for a letter.** An address with another source —
  `consented_capture`, the saved Shopify account address — stays stored but is refused for every
  advertising letter (`not_purchase_address`) — the 1:1 letter of Kunden → Brief included; the
  Brief tab offers „Adresse aus letzter Bestellung holen“ (`POST /api/admin/customers/letter-address`,
  access log `customer.letter_address`).
- **Who fetches.** The desk's „Adressen holen“ (50 per step) and, nightly, the campaign-audiences
  cron after the refresh: up to `CAMPAIGN_LETTER_ADDRESS_NIGHTLY` (default 200, max 2,000, 0 = off)
  addresses for the open letters of active campaigns (not the Einzelansprache) with a letter mode.
- **Gift orders.** When the shipping name contains neither the customer's last name nor — without
  one — the first name, the desk shows „Lieferadresse auf einen anderen Namen (Geschenk?) —
  prüfen.“ A hint, not a block.
- **Undeliverable.** A Pingen `undeliverable` status (webhook) sets
  `customers.postal_address_invalid_at` — only while the stored address is still the one that
  letter went to (street line and postcode). From then on campaign and 1:1 letters to it are
  refused (`address_invalid`) until a purchase address from another, newer order replaces it,
  which clears the mark.

### 8.4 Drafts

One AI call per letter (`draftCampaignLetter`, writer tier, `ai_usage` call site
`campaign_letter`, „Kampagnen-Briefe“ in the KI-Kosten). The prompt's rules: German, Du-form,
„Hallo <Vorname>,“; tie in with the past purchases; recommend at most the given product names
(up to three), no prices; it is paper — **no** links or buttons, **no** discount code, **no**
percentages, **no** unsubscribe or objection text (that is fixed in the footer); no invented
urgency (an Aktion's real end date may be named); never say where the knowledge comes from; at
most about 1,500 characters (one page); signed „Herzliche Grüße“ / „Mo, dein persönlicher Berater
bei motion sports“. The letter may name the shop as plain text (`CAMPAIGN_LETTER_SHOP_URL`;
default the host of the first `ALLOWED_ORIGINS` entry, else `www.motionsports.de`).

The prompt gets: the first name; the campaign's name, kind, Briefing and end date; the letter's
operator note (`admin_note`); the AI profile (the same `profileSection` as a campaign mail — not
after an Art. 21 objection to profiling); the purchase summary from the ledger; the lifecycle
segment's intro rule; the product names. **Never** the address, the e-mail, order numbers or
amounts — the purchase lines are the same `purchaseBlock` as a campaign mail: date and items,
no order name or number (dossier § 7.1). Without `ANTHROPIC_API_KEY`, or when the call fails, a
fixed template letter is stored —
a person reviews every letter anyway. Nobody with a postal objection gets a draft. Phase 1 writes
German only: an English reader gets a German letter (desk hint „Liest Englisch — der Brief ist
deutsch.“).

### 8.5 The desk view „Briefe“

`?tab=kampagne&campaign=<slug>&view=briefe`
([`LettersView.tsx`](../src/app/admin/kampagne/LettersView.tsx)); the screen — filter, the three
step loops „Adressen holen“ / „Entwürfe schreiben“ / „Freigegebene senden“, status line, Callouts,
list and detail — is described in [`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §3.2 „Briefe“. The
rules:

- The view („Briefe n“, n = open letters: without text, drafted, released, failed) shows while the
  campaign has a letter mode, and after a switch back to „Keine Briefe“ as long as letters exist;
  then no drafts are written, released or sent any more — the batch steps,
  a single letter's „Neu schreiben“ and „Freigeben“ answer 409 `letters_off` (reading, editing and
  skipping stay possible).
- The view loads itself (`action: "list"`), so the desk render does not carry every letter text.
- „Entwürfe schreiben“ is confirmed (one AI call per letter); „Freigegebene senden“ is confirmed
  with the postage sum, the budget and the Pingen staging hint, and checks every gate again per
  letter (§8.6).
- Saving an edited letter marks it `edited` and takes back a release. „Freigeben“ is refused only
  for an objection, a consent given since, an undeliverable address or a missing text; address,
  cadence and budget are checked again at send.
- **No bulk release.** Every release (`campaign.letter_approve`) and every send step
  (`campaign.letters_send`) is written to the admin access log.

### 8.6 Sending — every gate per letter

„Freigegebene senden“ runs `sendCampaignLetterStep` in steps of 5 released letters. A step first
settles letters a dead step left in `sending` for 15 minutes (`recoverStuckLetters`): without a
physical letter they go back to `approved` (nothing was posted); with one they follow it —
submitted to Pingen → `sent`, failed or cancelled → `failed`; a physical letter that never
reached Pingen keeps its campaign letter in `sending` (a retry could print twice). Then it claims
the oldest releases atomically (`FOR UPDATE SKIP LOCKED`), reads each person fresh and runs
`decideCampaignLetterSend` — the first failing gate is the refusal:

| # | Gate | Refusal |
| --- | --- | --- |
| 1 | `PHYSICAL_MAIL_SENDS_APPROVED` | `flag_off` |
| 2 | Pingen configured | `pingen_not_configured` |
| 3 | Campaign running — status and window (`campaignAcceptsWork`) | `campaign_closed` |
| 4 | No objection to postal advertising | `objection` |
| 5 | Mode `ohne_einwilligung`: no e-mail consent now | `consent_now` |
| 6 | Complete postal address | `no_address` |
| 7 | Address source `purchase` | `not_purchase_address` |
| 8 | Address not undeliverable | `address_invalid` |
| 9 | Subject and text | `no_text` |
| 10 | Cadence `LETTER_MIN_INTERVAL_DAYS` (default 60, 0 = off) — counts **every** posted letter to the person, 1:1 letters included, except failed / cancelled ones | `too_soon` |
| 11 | Budget: spent + this letter ≤ `letter_budget_cents` — spent = postage of this campaign's posted letters (the price Pingen reported, else `PINGEN_LETTER_COST_CENTS`) | `budget` |

An objection excludes the letter (`widerspruch`), a consent given since too (`einwilligung`);
every other refusal sends it back to „Entwurf“ (`drafted`) with the reason shown on it; a Pingen
error marks it `failed`.

Posting is `submitLetter` ([`physical-mail.ts`](../src/lib/physical-mail.ts)), the one hand-over
to Pingen that Kunden → Brief uses too: render the PDF, create the `physical_letters` row (with
`campaign_id`), attach it to the campaign letter, then submit with the row's Idempotency-Key and
auto send, delivery options as before. Because the physical letter is attached **before** the
submission, a step that dies after Pingen accepted it is never posted twice — the recovery puts
back only letters without one. The PDF has the 1:1 layout; the footer of every page carries the
Art. 21 objection notice, the sender and the privacy link. The PDFs print „ “ – — … € correctly
(WinAnsi encoding, `pdf-core.mjs`).

### 8.7 Endpoints, environment, open decisions

| Route (all `guardAdminPost`) | Purpose |
| --- | --- |
| `POST /api/admin/campaigns/letters` | The „Briefe“ view: `list`, `fill_addresses` (50 per step), `draft` (5 per step), `redraft`, `save`, `approve`, `unapprove`, `skip`, `unskip`, `send_step` (5 per step); 409 `letters_off` for the batch steps, `redraft` and `approve` while the mode is „aus“ |
| `POST /api/admin/campaigns/letters/preview` | The letter as printed (PDF; a placeholder recipient while no purchase address is known) |
| `POST /api/admin/customers/letter-address` | Fetch one customer's purchase address (Kunden → Brief) |
| `POST /api/admin/campaigns/audience-preview` | Takes `letterMode` and then returns `letters { total, withAddress }` |

**Environment** (in `.env.example`): `LETTER_MIN_INTERVAL_DAYS` (60; 0 = no cadence check),
`CAMPAIGN_LETTER_ADDRESS_NIGHTLY` (200; max 2,000; 0 = only the desk's button),
`CAMPAIGN_LETTER_SHOP_URL` (shop address named on paper). Existing: `PHYSICAL_MAIL_SENDS_APPROVED`,
`PINGEN_*` (incl. `PINGEN_STAGING`), `PINGEN_LETTER_COST_CENTS`.

**Defaults the developer chose — open for the lawyer / maintainer** (dossier § 18, F-35): release
per letter (no bulk approve); letter mode default „aus“; cadence 60 days; `consented_capture`
addresses stay stored but unused; an objection does not delete the stored address (it blocks
every letter); German letters only; no discount code on paper (phase 1); `laufend` campaigns
write a person once (cycle 0).

Screenshots: `docs/screenshots/kampagne-briefe/` (the view, sent letters, the send dialog, the
editor section, at 1440 and 1024 px in light and dark, plus the printed PDF).

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

## Lifecycle-Segmentierung (lifecycle segments, migration `0052`)

Which products a campaign mail recommends — and whether it is written at all — depends on **how
long ago the last purchase was and how big it was**. Every boundary is measured, not guessed: the
figures come from `npm run analyze:repurchase` over the complete order history (28,541 orders,
18,355 customers — [`REPURCHASE_ANALYSIS.md`](./REPURCHASE_ANALYSIS.md)) and are recorded in
[`campaign-segments.mjs`](../src/lib/campaign-segments.mjs). Since migration `0063` every
customer's segment is in `customer_facts.lifecycle_segment` (computed nightly) — the audiences
(§2.2) and the Kunden list use the same keys.

### The three findings that shape the design

1. **Timing does NOT scale with purchase value.** The median repurchase interval is 88 / 81 / 68
   days across the three value tiers — a 20-day spread, pointing the *opposite* way to the original
   assumption. So there is **one time schedule for everyone**, not a matrix.
2. **Content does scale with value.** Buyers from 150 € buy accessories to what they own twice as
   often as those below (25.5 % vs 13.0 %), and the relevance holds a full year; below 150 € it
   halves by month three.
3. **The strongest window is 7–30 days** (38.6 % from 150 €) — the highest figure in the whole
   dataset.

### Segments

| Segment | Days since purchase | < 150 € | from 150 € |
| --- | --- | --- | --- |
| `frisch` | 0–7 | **do not send** | **do not send** |
| `ausbauen_frueh` | 7–30 | accessories | accessories |
| `ausbauen` | 30–90 | accessories | accessories |
| `weiterentwickeln` | 90–365 | similarity | accessories |
| `zurueckholen` | 365–730 | win-back | accessories |
| `ruhen` | > 730 | **do not send** | **do not send** |
| `unbekannt` | no purchase date | similarity | similarity |

The value tiers come from `repurchase-analysis.mjs` (boundaries 150 € / 1,500 €), so analysis and
production never drift apart. The segmentation **merges the upper two**: their measured behaviour is
the same (lift 4.6× in both), and Großgeräte alone is too thin for rules of its own (n = 19–54 per
window).

### Recommendation strategies

`pickCampaignRecommendations(history, selectedProductIds, strategy, profileVector)` in
`campaign-recommendations.ts`:

- **`complement`** — accessories from `Product.compatibleWith` („Ergänzende Produkte“, maintained
  in Shopify; [`campaign-complement.mjs`](../src/lib/campaign-complement.mjs)). Accessories of the
  **most recent** purchase lead the ranking, then how many owned products an item fits. Owned
  products are excluded.
- **`similarity`** — the classic embedding pick. It finds *substitutes*, not *additions* — who
  bought a rack gets another rack. Right only once the accessory relevance has dropped.
- **`winback`** — a broad, representative selection without reference to an old purchase.

**The customer profile steers** (migration `0059`): when the recipient has a profile, its goals,
interests and next steps become a search vector (`profileSteeringQuery` → `embedQuery`).
`similarity` then weighs 60 % purchase similarity + 40 % profile similarity
(`blendRecommendationScore`), `winback` ranks by the profile instead of representatively, and
recipients without a purchase signal get real picks from the profile instead of `low_confidence`
picks. `complement` stays unchanged (accessories of what is owned).

Every strategy **degrades instead of failing**: `complement` without maintained accessories falls
back to `similarity`, `similarity` without an embedding signal to representative picks.
`recommendations.strategy` says what *actually* produced the picks — the review card shows that, not
the wish.

### Effect on the text

The segment steers not only the products but **the job of the opening** (`segmentIntroRule` in
`campaign-draft.ts`): a fresh purchase → build on it; a year ago → a short reminder, then look
ahead; two years → say honestly that it has been a while. Same template, same voice, different
task.

### Queue

In **laufend** campaigns `listNextPendingContacts` skips recipients the data excludes (`frisch`,
`ruhen`) — by an SQL filter, **not** by a status change: a „fresh“ recipient is not lost, it becomes
sendable once it ages into the next window. Recipients without a known purchase date are never
excluded. An **Aktion** and the Einzelansprache mail their whole audience (no send window); to leave
out fresh or dormant customers there, use the Lebenszyklus filter of the audience.

`listDraftedQueue` sorts by measured value instead of arrival: the early window first, then by
lifetime revenue. A recipient from 150 € is roughly three times as likely to be a returning
accessory buyer.

### Measurability

`campaign_sends.segment` is stamped at send (both paths: e-mail and „kopiert“). Without the stamp
it could **never** be answered whether the accessory strategy actually beat similarity — and the
history cannot be rebuilt afterwards.

### What does NOT happen automatically

The boundaries live in the code (`campaign-segments.mjs`) and change only with a release. Automatic
re-tuning from repeated analysis runs would be a **feedback loop**: the analysis measures behaviour
*without* our segmented mails; once they run, an automatism would optimise against its own effect.
If the figures are to be updated, then on the pattern of the improvement loop: the evaluation
*proposes*, a person decides.

## KPIs and the hero A/B test (migration `0054`)

**What each send records.** Besides the segment (`0052`), the send stamps a snapshot of the mail on
`campaign_sends`: `design_key`, `hero_variant` (`ai` = individually generated KI-Hero, `default` =
hero design with the default image, `none` = no hero / copy path), `hero_image_url`,
`hero_headline`, `text_mode`, `language`, `discount_percent`, `discount_scope` (`0058`),
`bundle_offer_id`; since `0066` also `campaign_id` and `customer_id`. The draft is overwritten on
every regenerate — without the stamp, what was sent could not be reconstructed afterwards.

**Which outcomes are attributed.**
- **CTA click** — `clicked_at` (`0041`), the first click on `/api/r/<token>`.
- **Set click** — `bundle_clicked_at`: the first click on „Zur Kasse“ of the attached set (the
  redirect route stamps it via `bundle_offer_id`).
- **Redemption + revenue** — a Shopify lookup per MK- code (`fetchCodeRedemption`) with the order
  value, summed per variant, segment and campaign.
- **Unsubscribe** — `unsubscribed_at`: an unsubscribe is attributed to the campaign mails sent to
  that address in the last 30 days.
- **Hero cost** — `ai_usage.campaign_contact_id` links every hero generation (prompt, renders,
  check) to the recipient; the KPI screen sums the cost per hero variant.
- **Rating** — `feedback.rating` / `email_kind`: the click rating as a number (average per period).
  Anonymous on purpose, so it cannot be attributed to a variant.
- **Chat start** — `campaign_chat_started`, once per send (§5 „Chat-Start“).

**The campaign and hero comparison on the KPI screen** (`kpi/sections/CampaignSection.tsx`; KPI
definitions: [`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §5.9). „Kampagnen im Vergleich“: the same
funnel per campaign (Lebenszyklus, Aktionen, Einzelansprache), with „Chat gestartet“. „Hero-Vergleich:
lohnt sich das KI-Bild?“: per variant Gesendet, Button-Klickrate, Set geklickt, Eingelöst, Umsatz,
Umsatz / Send, Hero-Kosten, Kosten / Send, Abgemeldet — and „Nach Lebenszyklus-Segment“, the same
funnel per segment. So that both groups get sends, the desk shows each recipient's **A/B group**
(even contact id: send with a KI-Hero; odd: leave the hero empty — `abGroupOf`). The campaign's
title-image mode decides for whom „Vorbereiten…“ generates KI-Heroes (`ai_ab`: the A group,
`ai_all`: everyone); under `none` no KI-Hero rides along, and under `default` / `none` the desk shows
no hero hints and no hero column. The stamp records what was actually sent, not the recommendation.
Rule of thumb: click-rate differences of a few percentage points become reliable from about 100
sends per group; revenue per send needs more.

**What the funnel cannot do (on purpose / open).**
- No open rates — no tracking pixel (a privacy decision since `0041`). The click rate is relative to
  sent, not opened mails.
- Bounces and complaints come from the Resend webhook (below); without the webhook „Zugestellt /
  Bounces“ stays empty.
- Redemption is checked for the 100 newest codes per period (`CAMPAIGN_KPI_MAX_CODES`); beyond that
  the sample is capped (marked on the screen).

## Delivery: bounces and complaints (migration `0055`)

**What happens.** Resend reports by webhook what happened to a mail after the hand-over.
`POST /api/webhooks/resend` (and the inbound route `POST /api/inbound/resend`, when the events
arrive there) verifies the Svix signature over the raw body and applies the event
(`email-delivery-events.ts`; the parser `email-delivery-events.mjs` is tested):

| Event | Effect |
|---|---|
| `email.bounced`, type *Permanent* (hard) | address on `suppression_list` (reason `bounce`) — the campaign gate refuses every further send; `campaign_sends.bounced_at`, `bounce_type = 'hard'` |
| `email.bounced`, type *Transient/Undetermined* (soft) | stamp only: `bounced_at`, `bounce_type = 'soft'` (full mailbox, greylisting) |
| `email.complained` (spam button) | `suppression_list` (reason `complaint`), the one consent withdrawn (`recordMoWithdrawal`), `complained_at` |
| `email.delivered` | `delivered_at` |
| `email.delivery_delayed` | ignored (acked) |

The event is matched to the send by `provider_email_id` (Resend's message id, stored at send);
events without a known id hit the newest send to that address within the last 7 days. First stamp
per kind. The KPI screen shows „Zugestellt / Bounces“ with hard bounces and complaints.

**Setup in Resend** (Dashboard → Webhooks):
1. Endpoint `https://mo.motionsports.de/api/webhooks/resend`, events `email.bounced`,
   `email.complained`, `email.delivered`.
2. Set the signing secret in Vercel as `RESEND_EVENTS_WEBHOOK_SECRET`. Alternatively add the three
   events to the existing inbound webhook — then `RESEND_WEBHOOK_SECRET` suffices (the inbound route
   verifies with it; `/api/webhooks/resend` accepts either secret).
3. Test: in Resend „Send test event“ for `email.bounced` → answer `{ ok: true, kind: "bounced", … }`;
   without a valid signature the route answers 400, without a secret 503.
