# Admin marketing dashboard

The authenticated back office where a human reviews marketing-eligible contacts,
generates a personalised draft email, edits it, and approves it — after which the
**system** sends it (the operator never copies text into a personal mail client).

It is deliberately small: a single shared admin password, four tabs
(**Übersicht**, **Kunden**, **KPIs** and **Feedback**), and a send path that
concentrates every legal guarantee in one place. There is no standalone
Marketing tab — the marketing capability lives **inside the Kunden
workspace** (a marketing filter preset, a per-customer "Marketing"
sub-section, and a bulk-draft bar). Tabs are switched server-side via `?tab=`
— no client router.

The **Kunden** tab (`?tab=kunden`) groups by CUSTOMER (email), not by session:
session timeline with transcripts, cached Shopify purchase history, and the
on-demand "current understanding" profile (an Anthropic pass — token cost shown
per run). Returning customers (multiple sessions under one email) are badged.
See [`CUSTOMERS.md`](./CUSTOMERS.md) for the identity model and the open GDPR
TODO on profile building.

> ⚠️ All German-facing email copy is still PLACEHOLDER and requires lawyer
> sign-off (see [`CONSENT_FLOW.md`](./CONSENT_FLOW.md) and
> [`src/lib/consent-copy.ts`](../src/lib/consent-copy.ts)).

---

## 1. Authentication

Minimal but real, and **never client-side only** — the gate runs on the server
before any admin page or API route renders.

| Piece | File | Notes |
| --- | --- | --- |
| Password + session crypto | [`src/lib/admin-auth.ts`](../src/lib/admin-auth.ts) | Web Crypto (Edge-safe) HMAC. |
| Edge gate | [`src/proxy.ts`](../src/proxy.ts) | Next 16 "proxy" (former middleware). |
| Login page + action | [`src/app/admin/login/page.tsx`](../src/app/admin/login/page.tsx) | Server action sets the cookie. |
| Route-handler guard | [`src/lib/admin-api.ts`](../src/lib/admin-api.ts) | Re-asserts auth + CSRF in handlers. |

**Flow**

1. `/admin/login` posts the password to a **server action**. It is compared to
   `ADMIN_PASSWORD` in constant time (SHA-256 digests) — the password never
   leaves the server beyond the form POST.
2. On success the action mints a signed session token and sets it as an
   **HTTP-only**, `SameSite=Lax`, `Secure` (in production) cookie
   (`ms_admin_session`). The token is stateless:
   `base64url(JSON{exp}) "." base64url(HMAC-SHA256)`, signed with
   `ADMIN_SESSION_SECRET` (falls back to `CHAT_SHARED_SECRET`). TTL 12h.
3. **`src/proxy.ts`** matches `/admin/:path*` and `/api/admin/:path*`. For any
   request other than `/admin/login` it verifies the cookie:
   - valid → continue;
   - invalid on a page → **302** redirect to `/admin/login`;
   - invalid on an API route → **401** JSON.
4. Each `/api/admin/*` handler additionally calls `guardAdminPost()`
   (defense in depth: re-verifies the cookie **and** requires
   `Content-Type: application/json`, which a cross-site form can't send without a
   CORS preflight — a lightweight CSRF defense given the cookie is the only
   credential).
5. Logout is a server action that deletes the cookie.

If `ADMIN_PASSWORD` / signing secret are unset, auth **fails closed** (login is
disabled, every gate denies).

**Required env:** `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` (see
[`.env.example`](../.env.example)).

---

## 2. Kunden tab — marketing-eligible contacts (marketing filter preset)

Server-rendered at [`/admin`](../src/app/admin/page.tsx). The Kunden workspace's
**marketing filter preset** narrows the list via
[`listMarketingTargets()`](../src/lib/marketing-store.ts), which lists **only
marketing-eligible** contacts:

```
marketing_doi_status = 'confirmed'
AND unsubscribed_at IS NULL
AND email NOT IN suppression_list
```

For each contact it surfaces:

- **Transcript** — the linked conversation (Cluster A) joined READ-ONLY to the
  capture (Cluster B) via the pseudonymous `session_id` (the same optional bridge
  the summary email uses; email is never written into Cluster A).
- **Persona** label and the **cart product ids** — the user's *selected*
  products (`conversations.selected_product_ids`, latest `add_to_cart` call)
  when a clear choice was made, falling back to the *discussed* set
  (`conversations.recommended_product_ids`) otherwise; the same
  `chooseCartProductIds` rule the draft/send path uses, so the dashboard
  previews exactly what the email would carry.
- **"Chatted but not purchased" flag** — the key marketing-target signal.
  [`checkRecentPurchase()`](../src/lib/shopify-orders.ts) queries Shopify orders
  (`read_orders`) for an order from that email within
  `MARKETING_ORDER_LOOKBACK_DAYS` (default 180). It flags **only** on a
  successful empty result; any error / unconfigured Shopify is reported as
  `unknown` so "unknown" never masquerades as "not purchased".
- Any existing **draft / sent** row.

---

## 3. Marketing workflow

All actions are `/api/admin/*` POSTs (proxy- and `guardAdminPost`-gated). Drafts
can be generated from two places within the Kunden workspace, with the **same**
lifecycle and send path: per **capture/session** from the marketing filter
preset's contact list (below), and per **CUSTOMER** with full context from the
per-customer "Marketing" sub-section (§3a).

### Discount input — chosen BEFORE generating

Each card has a **discount input**: a numeric, whole-percent field with a
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

### Generate draft — `POST /api/admin/marketing/draft { captureId, discountPercent, regenerate? }`

1. Re-check the contact is eligible (`loadEligibleCapture`).
2. Validate `discountPercent` is a whole number in the range `0–50`.
3. **Idempotent**: if an open (un-sent) draft exists **and** its depth matches the
   request, return it untouched. If the depth changed (or `regenerate: true`), the
   open draft is **overwritten** so the prose and the eventual code never disagree.
4. Build the **prefilled-cart permalink** for the discussed products
   ([`lib/cart.ts`](../src/lib/cart.ts)) — **no** `?discount=` param at draft time.
5. Write the **AI-drafted** personalised German email
   ([`marketing-draft.ts`](../src/lib/marketing-draft.ts)) — warm, personal, as if
   from **Mo**, a personal consultant at motion sports; references the chat and
   recommends the discussed products. **When a discount is selected**, the prompt is
   given the percentage, that the code is **unique, personal and single-use**, the
   **expiry**, and that a one-click prefilled cart button follows — and the model is
   required to weave that into the body (near the call-to-action, in Mo's warm
   voice, using the placeholder `MO-XXXX`). **When "Kein Rabatt"** is selected, the
   body must mention **no** discount. Stored as a `marketing_sends` row with
   `status = 'draft'`.

The **prose** deliberately excludes the cart and unsubscribe links — those are
appended deterministically at send time so an edit can never remove them.

> If the admin changes the discount **after** generating, the UI flags a mismatch,
> **disables Send**, and requires **↻ Neu generieren** so the text and the final
> code can never disagree.

### Edit — `POST /api/admin/marketing/update { sendId, subject, body }`

Saves the admin's edits. Only mutates rows that are still drafts; a sent email is
immutable.

### Approve & send — `POST /api/admin/marketing/send { sendId }`

Delivers the (possibly edited) email through the system. See §4.

Sent items are clearly marked in the UI and become read-only.

---

## 3a. Per-customer draft (Kunden tab) — full context + admin special instructions

`POST /api/admin/customers/marketing-draft { customerId, discountPercent,
adminInstructions?, regenerate? }` — the full-context upgrade of the per-capture
draft, driven from the **Kunden** tab's "Personalisierte E-Mail (Mo)" section.

**What feeds the draft** ([`generateCustomerMarketingDraft`](../src/lib/marketing-draft.ts)):

1. **Every linked conversation** of the customer (chronological; oldest trimmed
   first under the prompt cap) — not just one session's transcript.
2. The cached **"current understanding" profile summary** (§2/Kunden tab), when
   generated.
3. The cached **Shopify purchase history**: owned items are listed as *bereits
   gekauft — NICHT erneut empfehlen*, so Mo builds on the purchase
   (complementary/next products) instead of re-recommending it. Owned items are
   **also excluded from the recommended/cart product set** — catalog product ids
   are Shopify handles, so purchase-history handles filter directly
   (`chooseCustomerProductIds` in [`lib/cart.ts`](../src/lib/cart.ts): newest
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

**Same rules as the per-capture draft:** eligibility is re-checked via the
customer's (unique-email) capture row; depth a whole number in `0–50` chosen before
generating; the preview uses the `MO-XXXX` placeholder and the projected expiry;
the real **`MS5-` single-use code (7-day expiry, stated in the prose)** is minted
only at **Approve & send**. The automatic one-time **welcome code**
(`WELCOME-`) feature was retired pre-launch; the Kunden tab keeps a read-only
**Willkommensrabatt** section showing the historical issued/redeemed data, but
no welcome code is ever issued here. Changing the depth **or** the instructions after generating
flags a mismatch, disables Send and requires a re-generate, so the prose, the
code depth and the audit snapshot always agree.

**Edit / approve & send are the SAME endpoints** as the per-capture draft flow
(`/api/admin/marketing/update`, `/api/admin/marketing/send`) on the same
`marketing_sends` row — every guarantee in §4 applies unchanged.

---

## 4. What the send path guarantees

All delivery runs through
[`approveAndSend()`](../src/lib/marketing-email.ts) — the **single** place a
marketing email is sent. The guarantees, in order:

1. **Eligibility, enforced twice.** `loadEligibleCapture` (SQL: confirmed, not
   unsubscribed, not suppressed) **and** an independent `canSendMarketing()`
   check (fail-closed). If either fails, **nothing is sent**.
2. **Unsubscribe always present.** A signed, email-keyed unsubscribe link is
   appended to every send. If one can't be built (no signing secret), the send is
   **refused** rather than shipped without an opt-out.
3. **The unique code is minted here, at send time.** If the row's
   `discount_percent > 0`, `createUniqueDiscountCode()` mints a **unique, single-use**
   Shopify code (`write_discounts`, `usageLimit: 1`, `appliesOncePerCustomer`, with
   expiry) at the chosen depth. The **placeholder** `MO-XXXX` in the body is then
   replaced 1:1 with the real code, and the prefilled-cart permalink is rebuilt with
   `?discount=REALCODE`. If minting **fails**, the send is **refused**
   (`discount_failed`) rather than ship an email that promises a dead code. When
   `discount_percent = 0`, no code is minted and the cart link carries no discount.
4. **Discount + cart are deterministic.** The cart button and (when present) the
   code note are appended from the minted values, never from the editable prose.
   The cart button does **not** link straight to Shopify: a unique
   `redirect_token` is minted and the button points at our own
   **`/api/r/<token>`** redirect, which logs the click and forwards to the real
   prefilled cart (the `?discount=CODE` stays intact). The real Shopify cart URL
   lives **server-side** on the row (`cart_url`); only the redirect reveals it.
   The **draft preview is unchanged** — only the actually-sent email gets the
   tracked link.
5. **No double send.** The row is claimed atomically (`draft → approved`); a
   concurrent request gets nothing and aborts. Success flips to `sent` + `sent_at`
   and persists the minted **code, gid, expiry, shipped cart URL and finalized body**
   on the row (record-keeping for analytics: which depths/codes were used). A
   delivery failure reverts to `draft` for retry.
6. **Logging / suppression.** Delivery goes through `lib/email` (Resend), which
   logs failures; unsubscribe writes the suppression list, which gate (1) reads.

### Why no send can reach a non-confirmed or suppressed address

- The dashboard only ever **lists** eligible contacts.
- `draft` and `send` both call `loadEligibleCapture`, whose SQL excludes any
  capture that is not `confirmed`, or is `unsubscribed`, or is in
  `suppression_list`.
- `approveAndSend` additionally calls `canSendMarketing` (independent query, same
  bar) and **fails closed** on any DB error.
- An unsubscribe both stamps `unsubscribed_at` and inserts into
  `suppression_list`, so a contact who opts out immediately fails both gates.

There is no code path that calls `sendEmail` with `kind: "marketing"` other than
`approveAndSend`, and `approveAndSend` cannot pass the gates for a non-confirmed
or suppressed address.

---

## 5. KPI tab

Server-rendered at [`/admin?tab=kpi`](../src/app/admin/KpiTab.tsx). Lightweight by
design — plain tables and CSS bars, no dashboard framework. Every number is read
**only** from the pseudonymous analytics cluster (`conversations`, `messages`,
`kpi_events`, `ai_usage`), except the revenue KPI and the recommendation→purchase
loop which additionally read Shopify orders. Each KPI carries its caveat inline in
the UI.

### 5.0 Date-range picker — [`lib/kpi-range.mjs`](../src/lib/kpi-range.mjs) + [`KpiDateRangePicker`](../src/app/admin/KpiDateRangePicker.tsx)

A period selector at the top of the KPI tab with presets **7 / 30 / 90 days** and a
**custom** from/to. The chosen window lives in the URL
(`?kpiRange=7d|30d|90d|custom` plus `?kpiFrom=&kpiTo=`) so a refresh or copied link
keeps it; [`resolveKpiRange()`](../src/lib/kpi-range.mjs) validates + clamps it
(UTC, reversed pairs swapped, future end → today, span ≤ 366 days, anything
invalid → default 30d) into a safe `[from, to]` that the **indexed** range queries
consume directly. The picker is a small client island that only rewrites the URL;
the KPI tab stays a server component and re-renders for the new window.

**The period filters the time-based KPIs only:**

| Filtered by the picker | Period-independent (lifetime / cohort) |
| --- | --- |
| **Core metrics** (§5.1) — `conversations` / `kpi_events` on `created_at` | Persona-insights (§5.2) |
| **Umsatz über Mo-Rabattcodes** (§5.5) — order `created_at` | Recommendation → purchase loop (§5.3) |
| **KI-Kosten** (§5.6) — `ai_usage` on `created_at` | Marketing funnel (§5.4), Postversand |

The split is stated in the UI (a note under the picker + a *"Gesamtwerte (vom
Zeitraum unabhängig)"* divider before the lifetime sections), so an operator always
knows which figures the period applies to. The Übersicht (overview) tab is a fixed
trailing-30d snapshot and has no picker.

### 5.1 Core metrics — [`lib/kpi-store.ts`](../src/lib/kpi-store.ts)

All core metrics are scoped to the **selected window** (`created_at >= from AND
created_at < to+1`), served by the `conversations`/`kpi_events` `created_at`
indexes (migrations 0001 + 0027).

| KPI | Definition | Caveats |
| --- | --- | --- |
| **Chats gesamt** | `count(conversations)` in the window. One row exists per chat that sent ≥1 message. | Scoped to the picked period (default last 30d). |
| **Chats pro Tag** | New conversations grouped by `date(created_at)` across the window, gap-filled with 0. | — |
| **Ø Nachrichten / Chat** | `avg(conversations.message_count)`. | Counts user + assistant + tool-marker turns. |
| **Abgebrochen** | `count(status='abandoned')` and its share of all chats. | `status` is flipped to `abandoned` lazily by the retention cron after `ABANDON_AFTER_MINUTES` idle — not real-time. "No resolution" ≈ not `converted`. |
| **Produkt-/CTA-Klicks**, **Add-to-Cart-Klicks** | `kpi_events` counts, **pattern-matched** by event name: CTA = `event ILIKE '%product%click%' OR '%cta%click%'`; cart = `event ILIKE '%cart%' OR '%checkout%'`. Each also shown as a rate per chat. | The literal event names are owned by the **frontend** widget's `track()`. We match by shape (survives a rename) and additionally surface the **full event breakdown** so the raw truth is always visible. If the widget emits different names, adjust the patterns. |
| **Engagement** | `chatsWithMessages ÷ sessionsWithTelemetry`, where `sessionsWithTelemetry = count(distinct session_id)` in `kpi_events`. | A proxy for "opened vs message-sent": a conversation row only exists once a message is sent, while any telemetry implies the widget was opened. Depends on the widget emitting telemetry on open. |

### 5.2 Persona-group insights — [`lib/kpi-persona.ts`](../src/lib/kpi-persona.ts)

Grouped by `COALESCE(persona_label, 'unknown')`.

- **Lieblingsprodukte (favorite products)** — pure aggregation:
  `unnest(recommended_product_ids)` counted per persona. Because
  `recommended_product_ids` is de-duped per conversation, a count is "in how many
  of this persona's chats was this product recommended". Reliable.
- **Top-Fragen (top questions)** — the **on-demand**, token-costing insight
  ([`lib/kpi-top-questions.ts`](../src/lib/kpi-top-questions.ts)). A button runs an
  Anthropic pass over a sample of up to **80 recent user messages** in that persona
  group and returns the common themes/questions in German. **Never runs on page
  load**: the result is cached in `kpi_persona_question_summaries` with a timestamp
  and re-used until the operator explicitly regenerates it. The token cost is
  stated in the UI. Degrades to a clear message when no `ANTHROPIC_API_KEY` is set.

### 5.3 Recommendation → purchase loop — [`lib/kpi-recommendation-loop.ts`](../src/lib/kpi-recommendation-loop.ts)

The headline ROI number. For each marketing-eligible contact (DOI-confirmed, not
unsubscribed, not suppressed, with a `session_id`) we bridge READ-ONLY to the
conversation, then ask Shopify (`read_orders`) what that email actually bought. If
a **recommended** product appears in a real order, that contact counts. The
surfaced rate is `withRecommendedPurchase ÷ withPurchase`.

> 🏷️ **Honest labeling.** Because this can only match a chat to a purchase when
> the customer gave a **consented email**, it covers a *minority subset*, not all
> chat users. The UI labels it accordingly — the section title reads *"Empfehlung
> → Kauf (nur Kund:innen mit E-Mail-Angabe)"* and a prominent caveat banner states
> it is **not** a site-wide conversion rate. Only the framing changed; the
> computation is unchanged.

> ⚠️ **Honest limitations** (also stated in the UI):
> - Covers **only** users who gave an email **and** confirmed consent — a minority
>   of chatters, and not all buyers.
> - Product matching is by **normalised handle**
>   ([`lib/kpi-match.mjs`](../src/lib/kpi-match.mjs), unit-tested): our catalog id
>   equals the storefront handle, but a live Shopify handle is normalised
>   (lowercased, `®`/special chars stripped), so we normalise both sides. Renamed
>   or archived products can be missed.
> - Capped at the **100 newest** eligible contacts to bound Shopify calls per page
>   load — a sample, not a census. Contacts where Shopify can't answer are counted
>   as "unknown", never as "no purchase".

### 5.4 Marketing funnel — [`getMarketingFunnel()`](../src/lib/marketing-store.ts)

A lightweight **sent → clicked → converted** funnel over the marketing emails the
dashboard actually sent (`marketing_sends.status = 'sent'`):

| Stage | Definition |
| --- | --- |
| **Gesendet (sent)** | `count(status = 'sent')`. |
| **Geklickt (clicked)** | `count(clicked_at IS NOT NULL)` + click rate. `clicked_at` is the **first** click on the tracked `/api/r/<token>` redirect (see §10). No pixel — only the link the user chose to click. |
| **Eingelöst (converted)** | The send's **unique single-use** code was redeemed in a real order. Reuses `read_orders` via [`wasDiscountCodeRedeemed()`](../src/lib/shopify-orders.ts) (`orders(query: 'discount_code:"…"')`). Capped at the **100 newest** coded sends to bound Shopify calls; codes where Shopify can't answer are "unknown", never counted as "not redeemed". |

This funnel is inherently scoped to consented marketing recipients (every send went
to a DOI-confirmed contact), so it is **not** a site-wide rate and isn't framed as
one.

### 5.5 Umsatz über Mo-Rabattcodes (revenue) — [`lib/kpi-revenue-store.ts`](../src/lib/kpi-revenue-store.ts)

> 🏷️ **Honest attribution — what we can actually measure.** "Revenue made with Mo"
> is defined as the **actually-paid totals of real Shopify orders that redeemed a
> UNIQUE single-use discount code minted by Mo's marketing flow** (`MS5-…` codes;
> `usageLimit:1`). This is the **only** signal that both ties an order back to Mo
> *and* exposes its value, so the KPI is labeled precisely — **"Umsatz über
> Mo-Rabattcodes"**, not a vague "revenue".

**Deliberately NOT counted** (no reliable attribution exists, so counting them would
be misleading):

- **Plain cart links** — the in-chat quick-checkout (`/api/products` `cartUrl`) and
  the transactional summary email link to a bare Shopify cart permalink
  (`/cart/<variant>:1`) with **no** discount, UTM or marker. The resulting order is
  indistinguishable from any storefront order, so it cannot be attributed.
- **Bundle offers** — we track the **click** (`bundle_offer_clicked` `kpi_event`),
  not the purchase.
- **Welcome code** — that automatic discount has been **retired**.

| Field | Definition |
| --- | --- |
| **Umsatz über Mo-Rabattcodes** | `Σ currentTotalPrice` of orders that redeemed a Mo `MS5-…` code **within the window**, counting only **realised** money (`displayFinancialStatus ∈ {PAID, PARTIALLY_REFUNDED}`). |
| **Bestellungen mit Mo-Code** | Count of those redeemed, paid orders. |
| **Geprüfte Codes** | Codes checked against Shopify (of the sent, coded emails in scope). |

**How:** candidate codes are the sent marketing emails carrying a code, minted
`sent_at ≤ window-end`, newest-first, **capped at the 100 newest**
([`REVENUE_MAX_CODES`](../src/lib/kpi-revenue-store.ts)) to bound the Shopify
fan-out — same discipline as the funnel/loop. Each is looked up via
[`fetchCodeRedemption()`](../src/lib/shopify-orders.ts) (`read_orders`,
`orders(query: 'discount_code:"…" created_at:>=… created_at:<=…')`), reading
`currentTotalPriceSet` + status + date. The money summation and the realised-status
policy are the pure, unit-tested
[`summarizeRedemptions()`](../src/lib/kpi-revenue-core.mjs). Codes where Shopify
can't answer are **"unknown"**, never counted as zero revenue; the cap and any
unknowns are disclosed in the UI caveat. When `MARKETING_ORDER_LOOKBACK_DAYS`-style
limits or Shopify being unconfigured apply, the KPI degrades to an honest empty
state.

### 5.6 KI-Kosten (AI cost) — [`lib/ai-usage-store.ts`](../src/lib/ai-usage-store.ts)

Cost-per-consultation + total spend (chat vs admin split), priced from the stored
per-model token counts. Now scoped to the **selected window** via the
`ai_usage.created_at` index (migration 0012); the Übersicht tab still reads it
all-time. Unchanged otherwise — see the inline caveat for the pricing/estimation
notes.

---

## 6. Shopify scopes & API versions

- **Scopes:** `write_discounts` (code creation) and `read_orders` (purchase
  check, the recommendation→purchase loop **and** the revenue KPI's
  `discount_code` → order-total lookup) — both now provisioned on the app.
- **API version:** requests target the configured `SHOPIFY_API_VERSION` (current
  stable, e.g. `2026-04`), not `latest`.
- The discount + orders code was re-verified against **current** Shopify docs for
  `SHOPIFY_API_VERSION = 2026-04` (re-confirmed 2026-06-05; `shopify.dev` blocks
  automated fetches with HTTP 403, so the mutation shape was corroborated via the
  public docs index), cited inline in
  [`shopify-discounts.ts`](../src/lib/shopify-discounts.ts):
  - `discountCodeBasicCreate(basicCodeDiscount: DiscountCodeBasicInput!)` —
    single-use (`usageLimit: 1` + `appliesOncePerCustomer`),
    `customerGets.value` as `DiscountPercentage { percentage }` (a 0..1 fraction;
    **now the admin-chosen depth**, no longer hardcoded), `endsAt` expiry.
  - `orders(query: 'email:"…" created_at:>=…')` — email is a tokenized field, so
    it's quoted for an exact match. Note: the order `email` is **protected
    customer data**; the app may also need Protected Customer Data access approved
    in the Partner Dashboard. We only read existence + minimal fields and never
    persist the order email.

---

## 7. Database

Migration [`0003_marketing_sends_dashboard.sql`](../migrations/0003_marketing_sends_dashboard.sql)
extends `marketing_sends` (subject, cart_url, discount_code_gid,
discount_expires_at, product_ids, persona_label, created_at/updated_at) and adds
a partial unique index enforcing **one open draft per capture**.

Migration [`0004_kpi_persona_question_summaries.sql`](../migrations/0004_kpi_persona_question_summaries.sql)
adds the `kpi_persona_question_summaries` cache (one row per persona, holding the
generated summary, sample size, model and timestamp) that backs the on-demand
"Top-Fragen" insight.

Migration [`0005_marketing_sends_discount_percent.sql`](../migrations/0005_marketing_sends_discount_percent.sql)
adds `marketing_sends.discount_percent` (the admin-selected depth; `0` = none,
default `0`), so analytics can later see which discount depths were offered.
Together with the existing `discount_code` (real minted code) and `sent_at`, the
row is a complete record of the offer.

Migration [`0006_marketing_sends_click_tracking.sql`](../migrations/0006_marketing_sends_click_tracking.sql)
adds `marketing_sends.redirect_token` (the unique, hard-to-guess token minted at
send time and embedded in the email's cart link as `/api/r/<token>`; partial
unique index) and `marketing_sends.clicked_at` (timestamp of the **first** click
on that link; repeat clicks leave it unchanged). These back the tracked-redirect
endpoint and the marketing funnel (see §10). Run all with `npm run db:migrate`.

`marketing_sends.status` lifecycle: `draft` → `approved` (transient in-flight
claim) → `sent`.

---

## 8. Operator checklist

1. Set `ADMIN_PASSWORD` + `ADMIN_SESSION_SECRET` (and the usual DB / Resend /
   Shopify / `UNSUBSCRIBE_SECRET` env).
2. `npm run db:migrate`.
3. Visit `/admin`, log in.
4. For a "beraten, nicht gekauft" contact: pick a discount depth → **Entwurf
   generieren** → edit → **Freigeben & senden**.

---

## 9. End-to-end discount test (verify a real, working code)

Use this to confirm — on your own email — that a working, single-use Shopify code
is actually created and applied.

**Prerequisites:** Shopify env configured (`SHOPIFY_STORE_DOMAIN`,
`SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_API_VERSION=2026-04`, scope
`write_discounts`), Resend configured, and your **own** test email already
**DOI-confirmed** (so it appears as an eligible contact — never send to a
non-confirmed or suppressed address).

1. **Choose a discount.** On your contact's card, select e.g. **10 %** (not "Kein
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

---

## 10. Tracked redirect — `GET /api/r/<token>`

The endpoint behind the cart button in every **sent** marketing email
([`src/app/api/r/[token]/route.ts`](../src/app/api/r/%5Btoken%5D/route.ts),
[`recordEmailClick()`](../src/lib/marketing-store.ts)). The email never links
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
