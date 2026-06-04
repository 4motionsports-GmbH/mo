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

### Generate draft — `POST /api/admin/marketing/draft { captureId }`

1. Re-check the contact is eligible (`loadEligibleCapture`).
2. **Idempotent**: if an open (un-sent) draft already exists, return it — we do
   **not** mint a second discount code.
3. Mint a **unique single-use 5 % discount code** via the Shopify Admin API
   (`write_discounts`) — see [`shopify-discounts.ts`](../src/lib/shopify-discounts.ts).
4. Build the **prefilled-cart permalink** with `?discount=CODE` for the discussed
   products ([`lib/cart.ts`](../src/lib/cart.ts)).
5. Write the **AI-drafted** personalised German email
   ([`marketing-draft.ts`](../src/lib/marketing-draft.ts)) — warm, personal, as if
   from **MOIA**, a personal consultant at motion sports; references the chat and
   recommends the discussed products. Stored as a `marketing_sends` row with
   `status = 'draft'`.

The **prose** deliberately excludes the cart and unsubscribe links — those are
appended deterministically at send time so an edit can never remove them.

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
3. **Discount + cart are deterministic.** Appended from the stored row, never
   from the editable prose.
4. **No double send.** The row is claimed atomically (`draft → approved`); a
   concurrent request gets nothing and aborts. Success flips to `sent` + `sent_at`;
   a delivery failure reverts to `draft` for retry.
5. **Logging / suppression.** Delivery goes through `lib/email` (Resend), which
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
- The discount + orders code was written against **current** Shopify docs
  (fetched 2026-06-04), cited inline:
  - `discountCodeBasicCreate` — single-use (`usageLimit: 1` +
    `appliesOncePerCustomer`), `customerGets.value.percentage = 0.05`, `endsAt`
    expiry.
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
"Top-Fragen" insight. Run both with `npm run db:migrate`.

`marketing_sends.status` lifecycle: `draft` → `approved` (transient in-flight
claim) → `sent`.

---

## 8. Operator checklist

1. Set `ADMIN_PASSWORD` + `ADMIN_SESSION_SECRET` (and the usual DB / Resend /
   Shopify / `UNSUBSCRIBE_SECRET` env).
2. `npm run db:migrate`.
3. Visit `/admin`, log in.
4. For a "beraten, nicht gekauft" contact: **Entwurf generieren** → edit →
   **Freigeben & senden**.
