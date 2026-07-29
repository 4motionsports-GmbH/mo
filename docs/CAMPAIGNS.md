# Kampagnen-Modul — personalized emails to Shopify marketing subscribers

The campaign module (R12) emails the shop's **existing Shopify customer base**:
customers who ticked the shop's marketing checkbox (in the Shopify
login/checkout flow, pre-Mo) **and** have order history. For each contact the
system generates a personalized email from their past purchases, recommends
2–3 suitable catalog products, optionally weaves in a unique single-use
discount code (the existing mechanism, `MK-` prefix), and always ends with a
promo block for the Mo chatbot including a deep link that auto-opens the
widget. A human reviews **every** email (~200/day) in the **Kampagne** tab of
`/admin` before anything is sent.

This channel is **distinct from the Mo marketing funnel** (`email_captures` +
our own double-opt-in): the audience, the consent basis, the tables, the send
path, and the legal gates are all separate. Zero behavior change to the
existing chat/capture/marketing/admin flows.

---

## 1. Audience definition

A **campaign contact** is a Shopify customer with
`emailMarketingConsent.marketingState = SUBSCRIBED`. Nobody else is ever
stored ([`campaign-sync-core.mjs`](../src/lib/campaign-sync-core.mjs) enforces
this per node — the GraphQL filter `email_marketing_state:SUBSCRIBED` is only
an optimization).

The sync ([`campaign-sync.ts`](../src/lib/campaign-sync.ts), triggered by the
tab's **Sync** button → `POST /api/admin/campaign/sync`, and daily by
`/api/cron/sync-campaign-audience`) pages through the `customers` query
(scope: `read_customers`; ⚠️ email/name are **protected customer data** — the
app may need Protected Customer Data access approved in the Partner
dashboard) and stores per customer: id, email, name, derived language,
opt-in level, consent timestamp, orders count, lifetime spend.

Rules:

- **Idempotent** — upsert on `shopify_customer_id`.
- **Local suppression wins** — every synced email is cross-checked (in bulk)
  against our suppression store (`suppression_list` + unsubscribed
  `email_captures`, the same store the unsubscribe flow writes). Suppressed
  addresses are stored as `status='suppressed'`: visible for audit, never
  queued, re-checked again at prepare **and** send time.
- **Shopify-side unsubscribes** — a contact that dropped out of the
  SUBSCRIBED set is marked `suppressed` on re-sync, never deleted
  mid-campaign (audit trail). A contact who re-subscribed on the Shopify side
  returns to `pending` — unless our local suppression list says otherwise
  (a local opt-out can never be undone by a sync).
- **Language derivation** ([`campaign-language.mjs`](../src/lib/campaign-language.mjs)):
  customer `locale` if present (`de*` → de, otherwise en); fallback
  `defaultAddress` country DE/AT/CH → de, else en; final fallback de.
- **Language override** (migration `0040`): the operator can pin DE/EN per
  contact in the review card (`POST /api/admin/campaign/language`) when the
  derivation is wrong for a person. The pin lives in its own column
  (`language_override`) so a re-sync never clobbers it; picking the language
  the profile already derives clears the pin (back to automatic). The
  EFFECTIVE language (override ?? derived, computed in `campaign-store.ts`)
  drives the AI draft, the deterministic send-time blocks (Mo promo, discount
  line, bundle offer labels, unsubscribe footer) and the expiry-date format
  (German `31.07.2026` vs English `31 July 2026`,
  `formatExpiryDateForLanguage`). Switching the language in the UI chains a
  regenerate so the prose matches.

## 2. Legal gating model (Germany: GDPR + §7 UWG)

This audience's consent comes from **Shopify's marketing checkbox, not from
our own double-opt-in flow**. German case law effectively requires a
*provable* double opt-in, and Shopify records the quality per customer as
`marketingOptInLevel` (`CONFIRMED_OPT_IN` | `SINGLE_OPT_IN` | `UNKNOWN`).
The gates (evaluated in one tested place,
[`campaign-gates.mjs`](../src/lib/campaign-gates.mjs), consumed by the single
send chokepoint [`campaign-email.ts`](../src/lib/campaign-email.ts)):

> ✅ **APPROVED by the lawyer (2026-07-21)** — both flags below are enabled in
> the documented defaults (`.env.example`). The code still fails closed (an
> absent env var means false), so the EFFECTIVE switch is the deployment env;
> either flag can be set false there at any time to re-lock the channel.

| Gate | Flag / source | Code default | Effect |
| --- | --- | --- | --- |
| Master send gate | `CAMPAIGN_SENDS_APPROVED` | **false** (approved 2026-07-21 → set true in deployment) | While false, **every** campaign send is refused server-side (403) — UI *and* direct API calls. Drafting, preview and Copy keep working. The tab shows a banner that the lawyer sign-off for this channel is pending. Separate from `CONSENT_COPY_LAWYER_APPROVED` and `PHYSICAL_MAIL_SENDS_APPROVED`. |
| Opt-in level | `CAMPAIGN_ALLOW_SINGLE_OPT_IN` | **false** (approved 2026-07-21 → set true in deployment) | `SINGLE_OPT_IN` / `UNKNOWN` contacts are visible in the queue but send-blocked ("Erneute Einwilligung erforderlich"; Copy allowed) while false. |
| Suppression | our opt-out store | — | Re-checked at sync, prepare AND send time; fail-closed (a DB error blocks the send). |
| Frequency cap | `MARKETING_MIN_SEND_INTERVAL_DAYS` | 0 (off) | Spans **both** channels in both directions: the newest send to the address across `marketing_sends` *and* `campaign_sends` must be older than the window (429 otherwise). |

**What the lawyer must approve** before `CAMPAIGN_SENDS_APPROVED` is flipped:
mailing this audience on the basis of Shopify's checkbox consent at all, and —
separately — whether `SINGLE_OPT_IN`/`UNKNOWN` contacts may be included
(`CAMPAIGN_ALLOW_SINGLE_OPT_IN`) or must first re-confirm.

**DOI refresh (FUTURE option, deliberately not built):** contacts without a
provable double opt-in could be sent a one-time re-confirmation request
through the existing DOI confirmation infrastructure
(`/api/confirm-marketing`, `email_captures.marketing_doi_status`), upgrading
them into the regular Mo-marketing funnel. Documented here as the designated
path; nothing in this round implements it.

Every campaign email carries, outside the editable prose (an edit can never
remove them): the signed unsubscribe link (writing to the same suppression
store), a `List-Unsubscribe` header, and the branded shell's
Impressum/privacy footer ([`email-template.ts`](../src/lib/email-template.ts)).
Copy ceiling: no fake urgency, no countdowns — same rule as the existing
marketing drafts, enforced in the prompt and in the deterministic promo copy.

## 3. Data model (migration `0034_campaign_contacts.sql`)

| Table | Purpose | Key columns |
| --- | --- | --- |
| `campaign_contacts` | The synced audience + review-queue lifecycle | `shopify_customer_id` (unique), normalized `email`, `first_name`/`last_name`, `language` (de/en), `opt_in_level`, `consent_updated_at`, `orders_count`, `total_spent_cents`, `last_synced_at`, `status` (`pending → drafted → sending → sent` \| `skipped` \| `suppressed` \| `draft_failed`), `sent_at`, `skipped_at` |
| `campaign_drafts` | ONE editable draft per contact (unique `contact_id`) | `subject`, `body` (with `MO-XXXX` placeholder), `discount_percent`, projected `discount_expires_at`, compact `purchase_summary` (jsonb), `recommended_product_ids`, `low_confidence` |
| `campaign_sends` | Immutable send record (audit + KPI) | `email`, `subject`, `body_hash` (SHA-256 of the shipped text), `body_text`/`body_html` (the shipped parts as delivered — migration `0038`; `body_html` NULL on the copy path, both NULL for pre-0038 rows), `sent_via` (`email`/`copy`), real `discount_code` (`MK-…`) + `discount_code_gid` + `discount_expires_at`, `redirect_token`/`clicked_at` (migration `0041` — the tracked Mo-promo CTA, see below; NULL for copy sends and pre-0041 rows), `sent_at` |

Deliberately **not** stored: full order history (read from Shopify at draft
time; only the compact `purchase_summary` snapshot needed for the review card
is kept). Since migration `0038` the shipped body IS retained next to its
`body_hash`, so the "Gesendet" view can open exactly what the recipient
received; rows purge on the same retention window (§6).

## 4. Draft generation

`POST /api/admin/campaign/prepare { count, discountPercent }` drafts the next
N `pending` contacts ([`campaign-prepare.ts`](../src/lib/campaign-prepare.ts)),
sequentially with modest concurrency; a per-contact failure marks that row
`draft_failed` and continues. The dashboard chunks the batch so it can show
progress. Generation costs API money — there is **no** auto-generation cron;
the admin clicks "Nächste 50 vorbereiten" explicitly.

Per contact ([`campaign-draft.ts`](../src/lib/campaign-draft.ts), same model +
fallback discipline as `marketing-draft.ts`):

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
4. Optional discount block — the **exact existing mechanism**: admin picks
   0–50 % (`discount-validation.mjs`), the draft weaves in the
   `MO-XXXX` placeholder + projected expiry
   (`formatGermanExpiryDate`/`discountExpiryDaysPublic`); the real `MK-` code
   is minted **only at send**. Changed depth or explicit regenerate overwrites
   the open draft (`shouldReuseCampaignDraft`) so text and eventual code never
   disagree.
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
   blocking a send. Archive-on-expiry stays with the existing cron; "Set
   entfernen" uses the existing archive route.
5. Mo promo block + deep link (`CAMPAIGN_MO_DEEPLINK_URL`, default
   `https://motionsports.de/?mo=open&mo_new=1&mo_view=fullscreen&utm_source=campaign&utm_medium=email`)
   — appended **deterministically** at send time, both languages
   (`moPromoBlockText`), never editable prose. Theme-side handling (Task F in
   the theme repo — a separate follow-up): `mo=open` auto-opens the widget
   after init and strips the params; the modifiers `mo_new=1` (start a FRESH
   consultation, no old thread resumed) and `mo_view=fullscreen` (open the
   panel full-screen) shape how it opens.
6. Footer: signed unsubscribe + Impressum/privacy via the existing
   composition (`unsubscribeFooter` + branded template).
7. The **Mo brand orb** (the chat widget's actual animated mark, exported
   from the frontend repo — `public/moorb.gif`, animated with a white
   background; `public/moorb2x.png` is the transparent static variant;
   override via `EMAIL_MO_ICON_URL`) makes Mo recognizable: on campaign
   emails it renders **beside the Mo promo text** as a chat-style media row
   (orb left, "Übrigens: … im Chat" right — mirroring the shop's
   product-page CTA), directly above the deep-link button. Marketing and
   summary emails (no chat-hint line) keep the centered orb between heading
   and prose (`moAvatar` in `email-template.ts`). Clients without GIF
   playback (Outlook desktop) show the first frame.

## 5. Review workflow (Kampagne tab)

One contact at a time, keyboard-driven (`N`/`P` next/previous, `V` preview,
`C` copy, `S` send, `X` skip; legend shown — shortcuts pause while a dialog
is open). The queue can be **filtered by opt-in
level** (Alle / Nur DOI / Nur Single-Opt-in+Unbekannt) and searched by
email/name — mutations are keyed by contact id, so filtering never
mis-targets a card. Left: name, email, language + opt-in badges, compact
purchase history, the manual controls below. Right: editable subject + body
(edits persist via `POST /api/admin/campaign/update`).

The workflow is generated-first but everything stays adjustable per card
WITHOUT regenerating (the deterministic send-time blocks make that safe):

- **Recommendations** are editable: remove per item, add via the shared
  catalog picker (`/api/admin/catalog/search`); each change persists
  immediately (`POST /api/admin/campaign/recommendations` — validates against
  the sync-fresh catalog, refuses sold-out products, clears `low_confidence`)
  and an attached bundle offer is **rebuilt to match** (snapshots are
  immutable, so "update" = archive + recreate through the unchanged bundle
  mechanism). The prose only changes on "↻ Neu generieren" — the UI says so.
- **Discount** can be set/changed/cleared AFTER generation
  (`POST /api/admin/campaign/discount`): the depth lives on the draft, the
  real MK- code + deadline ship deterministically outside the prose, and the
  route warns when the current prose clearly states a different percentage
  (which the send route would refuse — regenerate then).
- **Bundle** can be attached/removed after generation (see §4).

Actions:

- **Send** (`POST /api/admin/campaign/send`) — re-verifies every gate
  server-side, mints the `MK-` code (depth > 0), swaps placeholder + stale
  expiry via the shared [`discount-swap.mjs`](../src/lib/discount-swap.mjs)
  (extracted from the marketing send path — one logic, two channels), sends
  via Resend with unsubscribe link + `List-Unsubscribe` header, records the
  `campaign_sends` row, flips the contact to `sent`, auto-advances. Confirm
  dialog on the first send of the day only.
- **Copy** — subject + body to the clipboard. Copying alone **never** mutates
  state; the explicit "Als erledigt markieren" (`POST
  /api/admin/campaign/mark-done`) marks the contact `sent` with
  `sent_via='copy'`. No code is minted on this path (the UI warns that the
  placeholder is not a working code).
- **Vorschau** (`POST /api/admin/campaign/email-preview`) — renders the
  CURRENT card (the on-screen, possibly unsaved subject/body) through the
  exact send-path composition (`renderCampaignEmailPreview` reuses
  `renderCampaignEmail`: branded shell, bundle block, Mo promo, discount
  line, unsubscribe footer) and returns `text/html`, shown in an in-tab
  dialog iframe — the campaign sibling of the Kunden letter-preview route.
  READ-ONLY and gate-free: nothing is claimed, minted, sent or recorded; the
  discount line shows the `MO-XXXX` placeholder with the projected expiry.
- **Regenerate** (`POST /api/admin/campaign/draft`, with a per-card depth
  input) and **Skip** (`POST /api/admin/campaign/skip`).

The "Gesendet" sub-view lists sent campaign emails with redemption status
(existing `wasDiscountCodeRedeemed`, bounded fan-out). `MK-` codes also feed
the existing revenue KPI (`kpi-revenue-store.ts` unions `campaign_sends`
codes) — campaign revenue stays separable from `MS5-` marketing revenue by
prefix. Per row, **Ansehen** (`POST /api/admin/campaign/sent-email`) opens
the retained content (`0038`) in the same viewer dialog: system sends show
the exact delivered HTML, copy-path rows show the copied text; pre-0038
rows retained nothing and say so.

### Click tracking (migration 0041)

System sends route the email's main CTA — the Mo-promo deep link — through the
tracked redirect `GET /api/r/<token>`, exactly like the marketing channel's
cart link (no pixel; only the link the recipient chose to click). At send time
`approveAndSendCampaign` mints a `redirect_token`, embeds
`/api/r/<token>` as the CTA/promo URL and stores the token on the
`campaign_sends` row. The redirect resolves campaign tokens via
`recordCampaignClick` (`campaign-store.ts`): first click stamps `clicked_at`,
every click logs a `campaign_email_clicked` kpi_event, and the visitor is
302'd to `campaignMoDeeplinkUrl()` (computed at click time, so a config change
applies to already-sent emails). Copy-path sends and the review-time preview
stay untracked. This powers the **Kampagnen-Funnel** on the KPI tab
(`getCampaignKpis` — sent → clicked → redeemed, plus the language split); see
`ADMIN_DASHBOARD.md` §5.9.

## 6. Retention

`CAMPAIGN_CONTACT_RETENTION_DAYS` (default **365**, 0 disables), enforced by
the existing `/api/cron/retention` job: `campaign_sends` purge by `sent_at`,
`campaign_contacts` by `COALESCE(last_synced_at, created_at)` (an actively
re-synced contact keeps refreshing its timestamp and stays; one that dropped
out of the sync ages out; drafts cascade with their contact). The
`suppression_list` is never touched — opt-outs are honoured forever. See
[`DATA_RETENTION.md`](./DATA_RETENTION.md).

## 7. Endpoints & files

| Piece | Path |
| --- | --- |
| Sync (admin) | `POST /api/admin/campaign/sync` |
| Sync (cron, daily) | `GET/POST /api/cron/sync-campaign-audience` (`CRON_SECRET`) |
| Batch prepare | `POST /api/admin/campaign/prepare` |
| Single draft / regenerate | `POST /api/admin/campaign/draft` |
| Save edits | `POST /api/admin/campaign/update` |
| Curate recommendations (+ bundle rebuild) | `POST /api/admin/campaign/recommendations` |
| Set discount post-generation | `POST /api/admin/campaign/discount` |
| Rebuild queue (discard all open drafts → pending) | `POST /api/admin/campaign/reset-queue` |
| Skip / undo skip / mark-done / send | `POST /api/admin/campaign/{skip,unskip,mark-done,send}` |
| Global contact search (all statuses) | `POST /api/admin/campaign/contacts` |
| Pin/clear the contact's email language | `POST /api/admin/campaign/language` |
| Rendered draft preview (read-only, `text/html`) | `POST /api/admin/campaign/email-preview` |
| Retained sent content (read-only, `text/html`) | `POST /api/admin/campaign/sent-email` |
| UI | `src/app/admin/KampagneTab.tsx` + `KampagneWorkspace.tsx` |
| Libs | `campaign-{sync,store,prepare,draft,recommendations,email}.ts`, `campaign-{language,flags,gates,sync-core,draft-core}.mjs`, `discount-swap.mjs`, `shopify-customers.ts` |

All admin routes sit behind the existing proxy gate + `guardAdminPost`
(auth + JSON-content-type CSRF defense). Everything fails closed: missing
Shopify/DB config → "not configured" in the UI, never a crash, never an
ungated send.
