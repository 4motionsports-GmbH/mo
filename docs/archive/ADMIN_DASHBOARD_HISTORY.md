# Admin dashboard — history (retired paths, migration narrative, old runbook)

Archived 2026-10-05 from docs/ADMIN_DASHBOARD.md — historical, not maintained

The current admin reference is [`docs/ADMIN_DASHBOARD.md`](../ADMIN_DASHBOARD.md). This file keeps
the past-state material that was removed from it on 2026-10-05, verbatim (section numbers are those
of the 2026-10-05 version of ADMIN_DASHBOARD.md). Editorial notes added on archiving are marked
**[2026-10-05]**; relative links are rewritten for `docs/archive/`.

Superseded by: ADMIN_DASHBOARD.md §3.1–§3.3 (screens), §4 (the still-open legacy drafts and the
send-path guarantees), §10 (tracked redirect, all token kinds); DATABASE.md and `migrations/` (schema
and migration list); CAMPAIGNS.md §5 „Testkontakte“ (how to test a real code today).

---

## A. Former §2.1 — bundle-size measurement of the 2026-09 redesign

Measured on the former
Übersicht (2026-09 redesign): ≈ 159 KB gzip of JavaScript in total, ≈ 126 KB of
which is the Next/React framework (before the redesign: 344 KB on every tab).

## B. Former §3.1 — the retired Übersicht

The Eingang (screen 1, bare `/admin`) replaced the read-only **Übersicht**
(retired with `OverviewTab.tsx`; `?tab=overview` is an alias of the Eingang):
the Übersicht's „Heute“ cards became the system strip, its 30-day numbers a
compact strip, the Kunden „Posteingang“ moved here.

## C. Former §3.3 — retired with the client-side Kunden list

**Retired with the client-side list:** the slim list that loaded every person
into the browser (filters Tier, Marketing, Kauf, Versand, Herkunft), the
`?filter=` presets (the two old ones land on the closest view, §2.2), the
**bulk-draft bar** (marketing drafts for many DOI-confirmed customers —
replaced by „Auswählen“ → „Zur Kampagne…“ below, and by campaigns with
Vorbereiten, §3.2) and the **Posteingang** above the list (moved to the
Eingang, §3.1). The unused `searchCustomers` helper of `customer-list-store.ts`
has been removed as well (the Eingang's „Zuordnen“ search uses `customers/list`).

## D. Former §3.5 — KPI sections added with the customer platform (addition history)

Added with the customer
platform: **Kundenbasis** (Gesamtwerte, §5.17 — the shape of the whole base),
**Eingang** (Marketing & Kampagne, §5.18 — what came up, what was done, what
happened in the 14 days after), **Mo-Effekt** (Gesamtwerte, §5.19 — Mo
customers vs. comparable customers without a chat) and, inside the
Kampagnen-Funnel (title „Kampagnen-Funnel“, no longer „(Shopify-Subscriber)“),
the table **„Kampagnen im Vergleich“** (the same funnel per campaign plus
„Chat gestartet“, §5.9). Added 2026-10-05: **Seitenkontext auf Produktseiten**
(Beratung, after the core metrics, §5.1a) and, in „Einwilligung nach der
Anmeldung“, the block **„Nach Variante und Platzierung“** (§5.7).

## E. Former §4 intro, §4.1 and §4.2 — per-customer marketing e-mail (`MS5-` path)

**[2026-10-05]** No new draft can be started on this path; an open draft is still shown and
sendable (ADMIN_DASHBOARD.md §4). The sentence in §4.2 about a read-only **Willkommensrabatt**
section in the Kunden tab was not accurate any more: no such section exists in
`src/app/admin` (the welcome-code history is recorded in CUSTOMERS.md „Welcome discount
(historical)“).

### 4. Marketing e-mails from the Kunden screen

> **Retired for new mails (customer platform).** A new personal mail to one
> person is an **Einzelansprache** (§3.2): Kunden → Marketing → „Einzelansprache
> vorbereiten“, reviewed and sent on the campaign desk through
> `approveAndSendCampaign` (`MK-` codes, the one consent). The Marketing
> sub-tab no longer starts a draft on the path below; an **open** draft that
> was started on it stays editable, previewable and sendable under
> „Persönliche E-Mail (bisheriger Weg)“ (with its Set-Angebot composer) until
> it is sent or deleted. The routes, the send path and every guarantee below
> remain in force for those drafts.

Personalised marketing e-mails to **DOI-confirmed chat contacts** (`MS5-` codes)
were drafted, edited and approved in the Marketing sub-tab of a customer. All
actions are `/api/admin/*` POSTs (proxy- and `guardAdminPost`-gated).

#### 4.1 Discount input — chosen BEFORE generating

The Marketing sub-tab has a **discount input**: a numeric, whole-percent field with a
**valid range of 0–50**, defaulting to **0 (no discount)**. **`0` ("Kein
Rabatt") is the default**, so offering a discount is always a deliberate act.
The admin picks the depth **before** generating, because the email body is
written **around** the offer. The chosen depth is persisted on the
`marketing_sends` row (`discount_percent`).

> **No real code is minted at draft time.** Minting a unique single-use Shopify
> code for every draft would burn codes on drafts that are edited away or
> discarded. The real code is minted only at **Approve & send** (see §4). The
> draft **preview** therefore shows a clearly-marked **placeholder** code
> `MO-XXXX` so the admin sees exactly how the offer will read; at send time the
> placeholder is swapped 1:1 for the real code.

#### 4.2 The per-customer draft — full context + admin special instructions

`POST /api/admin/customers/marketing-draft { customerId, discountPercent,
adminInstructions?, regenerate?, textMode? }` is the only draft path (the former
per-capture draft route was removed in 2026-09 as unused).

**What feeds the draft** ([`generateCustomerMarketingDraft`](../../src/lib/marketing-draft.ts)):

1. **Every linked conversation** of the customer (chronological; oldest trimmed
   first under the prompt cap) — not just one session's transcript.
2. The cached **"current understanding" profile summary** (§2/Kunden tab), when
   generated.
3. The cached **Shopify purchase history**: owned items are listed as *bereits
   gekauft — NICHT erneut empfehlen*, so Mo builds on the purchase
   (complementary/next products) instead of re-recommending it. Owned items are
   **also excluded from the recommended/cart product set** — catalog product ids
   are Shopify handles, so purchase-history handles filter directly
   (`chooseCustomerProductIds` in [`lib/cart.ts`](../../src/lib/cart.ts): newest
   conversation first, selected-over-discussed per conversation, capped).
4. **Admin special instructions** — a free-text field on the customer (e.g.
   "Erwähne die neue Rudergeräte-Linie", "Bundle anbieten"). Passed to the model
   in its **own clearly-labelled section**, separated from the customer data, as
   operator guidance to be woven in as Mo's own words (never quoted as an
   instruction).

**Audit trail:** the instructions are stored twice — the **current editable
value** on `customers.admin_instructions`, and the **snapshot** that went into a
specific draft on `marketing_sends.admin_instructions`, alongside
`marketing_sends.customer_id` (migration 0010).

**Rules:** eligibility is re-checked via the
customer's (unique-email) capture row; depth a whole number in `0–50` chosen before
generating; the preview uses the `MO-XXXX` placeholder and the projected expiry;
the real **`MS5-` single-use code (7-day expiry, stated in the prose)** is minted
only at **Approve & send**. The automatic one-time **welcome code**
(`WELCOME-`) feature was retired pre-launch; the Kunden tab keeps a read-only
**Willkommensrabatt** section showing the historical issued/redeemed data, but
no welcome code is ever issued here. Changing the depth **or** the instructions after generating
flags a mismatch, disables Send and requires a re-generate, so the prose, the
code depth and the audit snapshot always agree.

**Edit / approve & send** go through `/api/admin/marketing/update` and
`/api/admin/marketing/send` on the same `marketing_sends` row — every guarantee
in §4.3 applies; the preview (`/api/admin/marketing/email-preview`) renders the
on-screen text in the selected design, and `/api/admin/marketing/delete` removes
an unsent draft.

## F. Former §7 — database notes (migrations 0003–0006 and the list up to 0069)

**[2026-10-05]** The list stopped at 0069; migrations 0070–0076 (refund date, session link kind,
campaign release, session link grants, campaign letters, campaign chat start once, message session
id) were missing. The current schema map is DATABASE.md; the migration list is `migrations/`.

Migration [`0003_marketing_sends_dashboard.sql`](../../migrations/0003_marketing_sends_dashboard.sql)
extends `marketing_sends` (subject, cart_url, discount_code_gid,
discount_expires_at, product_ids, persona_label, created_at/updated_at) and adds
a partial unique index enforcing **one open draft per capture**.

Migration [`0004_kpi_persona_question_summaries.sql`](../../migrations/0004_kpi_persona_question_summaries.sql)
adds the `kpi_persona_question_summaries` cache (one row per persona, holding the
generated summary, sample size, model and timestamp) that backs the on-demand
"Top-Fragen" insight.

Migration [`0005_marketing_sends_discount_percent.sql`](../../migrations/0005_marketing_sends_discount_percent.sql)
adds `marketing_sends.discount_percent` (the admin-selected depth; `0` = none,
default `0`), so analytics can later see which discount depths were offered.
Together with the existing `discount_code` (real minted code) and `sent_at`, the
row is a complete record of the offer.

Migration [`0006_marketing_sends_click_tracking.sql`](../../migrations/0006_marketing_sends_click_tracking.sql)
adds `marketing_sends.redirect_token` (the unique, hard-to-guess token minted at
send time and embedded in the email's cart link as `/api/r/<token>`; partial
unique index) and `marketing_sends.clicked_at` (timestamp of the **first** click
on that link; repeat clicks leave it unchanged). These back the tracked-redirect
endpoint and the marketing funnel (see §10). Run all with `npm run db:migrate`.

`marketing_sends.status` lifecycle: `draft` → `approved` (transient in-flight
claim) → `sent`.

Later migrations that back the screens: `0031`/`0033` (conversation analysis +
insight references), `0041` (locale + campaign click tracking), `0042`
(`mo_orders`), `0044` (improvement loop), `0049` (e-mail design selections),
`0050`–`0055` (hero images, campaign segments, send snapshot, delivery state),
`0056` (indexes for the retention sweeps), `0061`–`0068` (the customer
platform: Shopify customer mirror on `customers`, the order ledger
`customer_orders`, `customer_facts`, the one e-mail consent + `consent_events`,
the Shopify sync tables and outbox, `campaigns` with per-campaign recipients in
`campaign_contacts`, `inbox_items`, the `customer_overview` view) and `0069`
(hand-added campaign recipients keep their place in a dynamic audience). The full
schema map is in
[`DATABASE.md`](../DATABASE.md); migrations are forward-only and run manually by
the maintainer.

## G. Former §9 — end-to-end discount test (`MS5-` path)

**[2026-10-05]** This runbook can no longer be run: step 1–2 start a new draft in Kunden →
Marketing, which the UI no longer offers (only an existing open draft is shown, with „Neu
generieren“). Test a real code today with a **Testkontakt** on a campaign desk (`MK-` code, real
send path — CAMPAIGNS.md §5 „Testkontakte“).

### 9. End-to-end discount test (verify a real, working code)

Use this to confirm — on your own email — that a working, single-use Shopify code
is actually created and applied.

> Since the customer platform, new personal mails go through the
> Einzelansprache (§3.2, `MK-` codes, campaign send path); test that path with
> a **Testkontakt** on a campaign desk (`CAMPAIGNS.md`). The steps below
> (`MS5-` codes, `approveAndSend`) apply to a still-open draft of the former
> Kunden → Marketing path (§4).

**Prerequisites:** Shopify env configured (`SHOPIFY_STORE_DOMAIN`,
`SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_API_VERSION=2026-04`, scope
`write_discounts`), Resend configured, and your **own** test email already
**DOI-confirmed** (so it appears as an eligible contact — never send to a
non-confirmed or suppressed address).

1. **Choose a discount.** In **Kunden → your customer → Marketing**, select e.g. **10 %** (not "Kein
   Rabatt").
2. **Generate.** Click **Entwurf generieren**. Read the body: it must clearly tell
   the customer they have a **personal, unique, single-use 10 % code**, name an
   **expiry**, and point to the **one-click cart button** — with a **placeholder**
   code `MO-XXXX`. (A note in the panel confirms the real code is minted on send;
   don't edit the placeholder.) If you change the discount now, the card forces a
   **↻ Neu generieren** before it lets you send.
3. **Approve & send to yourself.** Click **Freigeben & senden**. At this step the
   real unique code is minted and the placeholder is replaced everywhere.
4. **Receive the email.** Confirm the body shows a **real** code (e.g. `MS5-XXXXXXXX`,
   not `MO-XXXX`) and the **Warenkorb öffnen** button. The link is
   `https://<shop>/cart/<variant>:1,…?discount=<REALCODE>`.
5. **Apply it at checkout.** Open the cart button → the code is pre-applied; verify
   the **10 %** is deducted. Place a (test) order or just confirm the discount line.
   Then try the **same code a second time** → Shopify must **reject** it
   (`usageLimit: 1` → single-use). That proves uniqueness.
6. **Find the minted code for auditing.** It's stored on the **`marketing_sends`
   row**: column `discount_code` (the real code), with `discount_percent`,
   `discount_expires_at`, `discount_code_gid` and `sent_at`. The sent card also
   shows **"Rabatt: 10 % · Code: …"**. Query example:
   ```sql
   SELECT id, discount_percent, discount_code, discount_expires_at, sent_at
     FROM marketing_sends
    WHERE status = 'sent'
    ORDER BY sent_at DESC
    LIMIT 5;
   ```
7. **Delete the test code in Shopify.** Shopify admin → **Discounts** → search for
   the code (the `discount_code` value, e.g. `MS5-…`) → open it → **Delete** (or
   **Deactivate**). This removes the test discount so it can't be reused. (The code
   is also titled *"Persönlicher Rabatt (10%) — MS5-…"* in the admin list.)

> Each "Entwurf generieren" does **not** mint a code, so generating/discarding
> drafts while testing wastes nothing. Only **Freigeben & senden** mints one.

## H. Former §10 — tracked redirect, as written for the marketing token only

**[2026-10-05]** `/api/r/<token>` resolves three token kinds (marketing send, campaign send,
bundle offer); the current description is ADMIN_DASHBOARD.md §10.

### 10. Tracked redirect — `GET /api/r/<token>`

The endpoint behind the cart button in every **sent** marketing email
([`src/app/api/r/[token]/route.ts`](../../src/app/api/r/%5Btoken%5D/route.ts),
[`recordEmailClick()`](../../src/lib/marketing-store.ts)). The email never links
straight to Shopify: the button carries the send's unique `redirect_token`,
and this route resolves it, records the click, and **302-redirects** to the
real prefilled Shopify cart (`marketing_sends.cart_url`, with the
`?discount=CODE` param intact). The customer experiences a perfectly normal
click. Clicked as a top-level navigation from a mail client → no CORS or
shared-secret guard (like `/api/confirm-marketing` and `/api/unsubscribe`).

Per click:

- **`clicked_at` is stamped on the FIRST click only** (a `clicked_at IS NULL`
  guard makes repeat clicks a no-op) — this backs the funnel's "Geklickt"
  stage (§5.4).
- A **`marketing_email_clicked`** `kpi_events` row is inserted on **every**
  click, with `session_id = NULL` (it's an email click, not a widget event)
  and `data: { sendId, captureId, firstClick }` — so click volume stays
  visible beyond the first click. Note this event matches neither KPI-tab
  ILIKE pattern (§5.1), so it surfaces only in the raw event breakdown.

**Fallback behavior:** a customer clicking a real email must never hit a dead
page. An unresolvable token (unknown / expired / pruned), a row without a
stored cart URL, or any unexpected failure still **302-redirects to the
storefront cart** (`https://motionsports.de/cart`) instead of erroring; the
anomaly is logged server-side.

> GDPR note: this logs a click on a link the user **chose** to click — there
> is deliberately **no** open-tracking pixel.

## I. Former §11 — removed admin routes

Removed with the customer platform: `POST campaign/sync` (Shopify newsletter
subscribers into `campaign_contacts`, „Jetzt synchronisieren“) — replaced by the
customer mirror and `campaigns/refresh` („Zielgruppe aktualisieren“).

Removed in 2026-09 as unused: `GET directives`, `GET email-designs`,
`POST bundles/list`, `POST marketing/draft` (per-capture draft),
`POST qa/draft`.
