# Admin marketing dashboard

The authenticated back office where a human reviews marketing-eligible contacts,
generates a personalised draft email, edits it, and approves it — after which the
**system** sends it (the operator never copies text into a personal mail client).

It is deliberately small: a single shared admin password, two tabs
(**Customers / Marketing** and **KPIs**), and a send path that concentrates every
legal guarantee in one place. Tabs are switched server-side via `?tab=kpi` — no
client router.

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

## 2. Customers / Marketing tab

Server-rendered at [`/admin`](../src/app/admin/page.tsx). Data comes from
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
- **Persona** label and **discussed product ids** (from
  `conversations.recommended_product_ids`).
- **"Chatted but not purchased" flag** — the key marketing-target signal.
  [`checkRecentPurchase()`](../src/lib/shopify-orders.ts) queries Shopify orders
  (`read_orders`) for an order from that email within
  `MARKETING_ORDER_LOOKBACK_DAYS` (default 180). It flags **only** on a
  successful empty result; any error / unconfigured Shopify is reported as
  `unknown` so "unknown" never masquerades as "not purchased".
- Any existing **draft / sent** row.

---

## 3. Marketing workflow

All actions are `/api/admin/marketing/*` POSTs (proxy- and `guardAdminPost`-gated).

### Discount selector — chosen BEFORE generating

Each card has a **discount selector**: **Kein Rabatt (default)**, **5 %**, **10 %**,
**15 %**. **"Kein Rabatt" is the default**, so offering a discount is always a
deliberate act. The admin picks the depth **before** generating, because the email
body is written **around** the offer. The chosen depth is persisted on the
`marketing_sends` row (`discount_percent`).

> **No real code is minted at draft time.** Minting a unique single-use Shopify
> code for every draft would burn codes on drafts that are edited away or
> discarded. The real code is minted only at **Approve & send** (see §4). The
> draft **preview** therefore shows a clearly-marked **placeholder** code
> `MO-XXXX` so the admin sees exactly how the offer will read; at send time the
> placeholder is swapped 1:1 for the real code.

### Generate draft — `POST /api/admin/marketing/draft { captureId, discountPercent, regenerate? }`

1. Re-check the contact is eligible (`loadEligibleCapture`).
2. Validate `discountPercent` ∈ `{0, 5, 10, 15}`.
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
`kpi_events`), except the recommendation→purchase loop which additionally reads
Shopify orders. Each KPI carries its caveat inline in the UI.

### 5.1 Core metrics — [`lib/kpi-store.ts`](../src/lib/kpi-store.ts)

| KPI | Definition | Caveats |
| --- | --- | --- |
| **Chats gesamt** | `count(conversations)`. One row exists per chat that sent ≥1 message. | All-time (≈ last 180d given retention). |
| **Chats pro Tag** | New conversations grouped by `date(created_at)`, trailing 30 days, gap-filled with 0. | — |
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

---

## 6. Shopify scopes & API versions

- **Scopes:** `write_discounts` (code creation) and `read_orders` (purchase
  check) — both now provisioned on the app.
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
row is a complete record of the offer. Run all with `npm run db:migrate`.

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
