# ATTR-TOKEN-LIFETIME: count the attribution window from the device's latest product consultation, and keep widget tokens while that device keeps consulting

**Item:** ATTR-TOKEN-LIFETIME. **Effort:** M, about 2–3 days including the migration, tests, docs and the dossier note.

**What it needs:**
- One additive migration. The maintainer runs it **before** the deploy.
- One new env switch, `MO_ATTRIBUTION_SESSION_ANCHOR`. It is off by default in code.
- No widget change for the backend part.
- A companion frontend task (§11) repairs devices whose token was already deleted. That task needs a theme upload.

**KPIs it moves:**
- „Mo-zugeordneter Umsatz“, rows „Beraten & gekauft“ and „Beraten, anderes gekauft“ (orders and EUR per week).
- New: „Markierte Bestellungen ohne Zuordnung“ (server event `mo_order_marker_unresolved {reason, source?}`).
- Attribution coverage of returning devices that were consulted before (live checks V4 and V0, §6).

---

## 1. Current behaviour, checked against the code

| # | Fact | Where (file → function) |
|---|---|---|
| F1 | Retention deletes **every** token 37 days after it was minted, whatever the session is doing. | `src/lib/retention.ts → runRetention`, step 5i (l. 441–449): `DELETE FROM mo_attribution_tokens WHERE created_at < daysAgo(attributionWindowDays + 7)` |
| F2 | There is one token per (session, source), and it is reused. `created_at` is never refreshed. If the row is gone (purge, erasure), the next call mints a **new** token. | `src/lib/mo-orders-store.ts → mintAttributionToken` (l. 72–113); unique index `mo_attribution_tokens_session_source_idx` (`migrations/0042_order_attribution.sql`). AC §10 l. 1954 still says "repeat calls return the same token". |
| F3 | The widget mints only when no token is cached for the current sid. On every page load it stamps the cached token again. The sid has no expiry, and a signed-in sid is kept stable on purpose. A device whose token was purged therefore stamps a dead token until its sid rotates. | 05 §10.2 (`initAttribution()` "never mints"); 06 §8.2, §8.4 ("yes, if no cached token"), §8.7 ("Long-lived stamping") |
| F4 | The window is measured from the **first** mint. | `src/lib/order-attribution.mjs → isWithinAttributionWindow` (l. 285), called in `mo-orders-store.ts → ingestShopifyOrder` (l. 163–176) with `rows[0].created_at` |
| F5 | An unknown token and an out-of-window token look the same: `{action:"ignored", reason:"marker-expired-or-unknown"}`. The order is not linked to a session, not written to `mo_orders`, and not counted anywhere. | `ingestShopifyOrder` l. 183–187. The route only checks `attribution.ok` (`src/app/api/webhooks/shopify/route.ts` l. 134–137). |
| F6 | `orders/create` **and** `orders/paid` both call the ingest. Deliveries are de-duplicated per `X-Shopify-Webhook-Id`. The **script** registers both topics. Whether live really has exactly one subscription per topic is unverified. A hand-made copy in the Shopify Admin delivers every event twice, each copy with its own webhook id. `recordWebhookDelivery` fails open (it returns `true` without an id and on a DB error). | `route.ts` l. 134; `src/lib/shopify-webhook-customers.ts → recordWebhookDelivery`; `scripts/register-shopify-webhooks.mjs` (ORDERS_CREATE, ORDERS_PAID); `docs/CATALOG_SYNC.md` l. 300–311 |
| F7 | Every product tool call is stored as a marker row (`messages.tool_name`, `created_at` = `now()` at insert). Since 0018 a session can have several threads (`conversations.session_id` is no longer unique). | `src/lib/conversation-store.ts → persistTurn`; `0001` (`messages.created_at DEFAULT now()`, `messages_conversation_idx`); `0018` `conversations_session_idx` |
| F8 | A thread resumed on **another device** keeps its original `conversations.session_id`. The upsert never rewrites it, so device B's product turns land in a row keyed to device A's sid. Messages carry no session of their own. | `persistTurn` `ON CONFLICT (conversation_key) DO UPDATE` (no `session_id`); `src/lib/conversation-create.mjs → ensureConversationStarted` ("never rewrites session_id"); `src/app/api/account/conversations/route.ts` ("ACROSS all their devices"); `src/app/api/chat/route.ts` `body.conversationKey` |
| F9 | The backend cannot see analytics consent at chat time. The widget checks consent only when it mints or stamps. The `_mo` already on the Shopify cart is **not removed** on sign-out, rotation or withdrawal. | 06 §8.1, §8.5 |
| F10 | Erasure deletes all tokens of the person's sessions. | `src/lib/customer-erasure.ts → erasePerson` (`DELETE FROM mo_attribution_tokens WHERE session_id = ANY(...)`) |
| F11 | There is no env switch for the token step. Raising `MO_ATTRIBUTION_WINDOW_DAYS` would also widen the window for every source, which is dishonest. | `src/lib/retention-options.mjs` (`attributionWindowDays`, min 1) |
| F12 | "Not stored" holds only for `mo_orders`. With `SHOPIFY_CUSTOMER_SYNC_ENABLED` on, the order ledger stores every order (`customer_orders`) for `orders/create|updated|paid|cancelled`. The KPI tab's InfoTip still says unmarked orders are „gar nicht gespeichert“. | `route.ts` l. 131 → `handleOrderLedgerWebhook → upsertMirrorOrders`; ANWALTSDOSSIER l. 323; `src/app/admin/kpi/sections/AttributionSection.tsx` |

**What breaks.** Take a device that consulted with analytics consent and keeps its sid (every signed-in customer).
- After 37 days its token is gone, and every later order from that device carries an unknown `_mo`.
- Even before that, a new consultation on day 25 followed by an order on day 32 is rejected, because of F4.

**Corrections to the item text:**
- **The go-live date is not verified.** README §4 says it is unknown whether the 2026-08-12 stamp build (`e4b12f1`) was ever uploaded to live, and the clone's history starts on 2026-09-08. The cliff date is *oldest widget token + 37 days*; pre-check P3 answers it.
- **The sizing query in the item is too narrow.** It joins the old `show_product` row and the recent `last_activity_at` on the **same** conversation row. Because of F7, a returning customer usually has the new activity in a newer thread. The corrected query is P4.
- **The backend change moves the cliff; it does not remove it.** After the deploy a token is still purged 37 days after the device's **last** product consultation, and at the latest `KPI_RETENTION_DAYS` (180) after minting. A stable-sid device that pauses longer, then consults again, keeps stamping the purged token (F3). Tokens purged before the deploy cannot be recovered by the backend. Erased sessions produce `unknown_token` by design. The repair for both is the widget renewal in §11. The endpoint already mints a new token after a purge (F2), so the renewal needs no contract change.

---

## 2. Read-only pre-checks on live (before building)

P0 is a dry-run script. P1–P6 are SELECT-only (`psql`). P1, P2b and P3 also go into `scripts/verify-live-kpis.mjs` (§4.11).

P4–P6 run before the migration, so they group consultations by thread (`c.session_id`). That is exactly the legacy fallback the first retention runs will use (§3.2). They are upper bounds: they include another device's turns in resumed threads and devices that never gave consent.

```bash
# P0  Exactly one orders/create and one orders/paid subscription at /api/webhooks/shopify?
npm run shopify:webhooks          # dry run; "DUPLICATE — every event arrives twice" must not appear for orders/*
# Also check Shopify Admin → Settings → Notifications → Webhooks for hand-made orders/* copies
# (invisible to the script). Fix: delete hand-made copies; npm run shopify:webhooks -- --dedupe
```

```sql
-- P1  Are widget tokens minted at all? (0 rows for 'widget' → answer 07 §8 "Which cookie banner is live" first)
SELECT source, date_trunc('week', created_at)::date AS week, count(*)
  FROM mo_attribution_tokens GROUP BY 1, 2 ORDER BY 2, 1;

-- P2  Are the order webhooks ingesting?
SELECT attribution_source, attribution_tier, count(*), min(processed_at), max(processed_at)
  FROM mo_orders GROUP BY 1, 2 ORDER BY 1, 2;

-- P2b Which order topics actually arrive? (orders/create must be present: the new counter fires only there)
SELECT topic, count(*), max(received_at)
  FROM shopify_webhook_events WHERE topic LIKE 'orders/%' GROUP BY 1 ORDER BY 1;

-- P3  When does (or did) the cliff start? cliff = oldest widget token + 37 days
SELECT min(created_at) AS oldest_widget_token,
       min(created_at) + interval '37 days' AS first_purge_at
  FROM mo_attribution_tokens WHERE source = 'widget';

-- P4  Devices that are already dark: consulted more than 37 days ago, active in the last 30 days,
--     no widget token any more (upper bound: devices without consent never had one). Only §11 repairs these.
SELECT count(DISTINCT c.session_id)
  FROM conversations c
 WHERE c.last_activity_at >= now() - interval '30 days'
   AND EXISTS (SELECT 1 FROM conversations c2 JOIN messages m ON m.conversation_id = c2.id
                WHERE c2.session_id = c.session_id AND m.tool_name = 'show_product'
                  AND m.created_at < now() - interval '37 days')
   AND NOT EXISTS (SELECT 1 FROM mo_attribution_tokens t
                    WHERE t.session_id = c.session_id AND t.source = 'widget');

-- P5  Tokens the switch rescues at once: widget token older than 30 days, product consultation
--     in the last 30 days (orders from these devices are rejected TODAY although the token exists)
SELECT count(*)
  FROM mo_attribution_tokens t
 WHERE t.source = 'widget' AND t.created_at < now() - interval '30 days'
   AND EXISTS (SELECT 1 FROM conversations c JOIN messages m ON m.conversation_id = c.id
                WHERE c.session_id = t.session_id
                  AND m.tool_name IN ('show_product','compare_products','add_to_cart','suggest_showroom')
                  AND m.created_at >= now() - interval '30 days');

-- P6  Dry run of the keep rule (switch on, legacy fallback, 180-day cap): tokens tonight's
--     retention would delete today but keeps after the switch
SELECT count(*)
  FROM mo_attribution_tokens t
 WHERE t.created_at < now() - interval '37 days'
   AND t.created_at >= now() - interval '180 days'
   AND t.source = 'widget' AND t.session_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM conversations c JOIN messages m ON m.conversation_id = c.id
                WHERE c.session_id = t.session_id
                  AND c.last_activity_at >= now() - interval '37 days'
                  AND m.created_at >= now() - interval '37 days'
                  AND m.tool_name IN ('show_product','compare_products','add_to_cart','suggest_showroom'));
```

**How to decide:**
- **P0 shows duplicates or hand-made `orders/*` subscriptions:** de-duplicate first. Otherwise every unresolved order is counted twice (§3.7). Record the result in the PR.
- **P2b has no `orders/create`:** register it (`npm run shopify:webhooks -- --apply`) before relying on the counter. With only `orders/paid` the counter stays 0 without any error.
- **P1 has no `widget` rows:** the anchor has no effect yet. Ship the counter part and leave the switch off. The 07 §8 cookie-banner question becomes the blocker.
- **P3 is less than 37 days ago:** ship and, if the owner approves (§7), flip the switch before `first_purge_at`. Retention runs daily at 03:30 UTC (`vercel.json`). Tokens purged before the flip follow the old rule and need §11.

---

## 3. Design decisions

1. **Window anchor, behind a switch.** `MO_ATTRIBUTION_SESSION_ANCHOR` follows 07 §5 rule 3 and the `platform-flags.mjs` convention: conservative when absent.
   - **Switch off** (code default): the anchor is the mint, exactly as today.
   - **Switch on, session sources** (`SESSION_ANCHORED_SOURCES = ['widget']`): `anchor = max(token minted, the latest product consultation written by the token's own session at or before the order)`.
   - **Link sources** (`summary_email`, `marketing_email`, `bundle`) and any unknown source: `anchor = token minted`, as today. Defaulting to the mint is the conservative choice.
   - Backlog A2 (07 §7) appends the same widget `cartAttributes` to the permalink, so it adds no new token source and needs nothing here.
2. **What counts as a consultation, and whose.**
   - **Tools:** marker rows with `tool_name IN ('show_product','compare_products','add_to_cart','suggest_showroom')`. This is the product subset of `PRODUCT_CARD_TOOLS` (`src/lib/recommended-products.mjs`), without `show_contact_form` and `offer_email_summary`. A pure shipping or support chat does not extend the window.
   - **Whose:** only rows **written by the token's own session**. A new nullable column `messages.session_id` is written on product-tool marker rows by `persistTurn` (§4.1, §4.5). The anchor uses `m.session_id = t.session_id`. Device B's turns in a resumed thread therefore never extend device A's window (F8), and this does not become the cross-device customer-level anchor rejected in 3.10.
   - **Legacy rows** (`m.session_id IS NULL`, written before the migration) fall back to the thread's session (`c.session_id`). Without that fallback the deploy would rescue nothing (P5/P6). These rows leave the 37-day horizon by `<MIGRATION_DATE> + 37 days`; after that the fallback has no effect and is removed (§9.4). During those 37 days a legacy row of a cross-device resumed thread still counts for the thread's original session. This is stated in §7.
3. **The anchor never moves past the order.**
   - **SQL bound:** `m.created_at <= processed_at`, with no skew.
   - **Pure function:** clamps the same way. A consultation later than `orderAt` is ignored.
   - **Why no skew here:** chat rows are stamped by our own DB (`now()`), so there is no clock to tolerate. The existing −1 h skew in `isWithinAttributionWindow` stays only for the mint versus Shopify's `processed_at`.
   - **Consequences:**
     - A chat after the purchase can never pull an order into the window.
     - `orders/create` and a later `orders/paid` see the same set of rows. Every row with `created_at <= processed_at` is already written when `orders/create` arrives. So an order cannot be counted as unresolved on create and then attributed on paid.
4. **Fail closed on data, retry on infrastructure:**
   - A missing or invalid timestamp, a purged conversation or an unknown source falls back to the mint, or to `null`, which means "not within the window".
   - A failed anchor **query** is thrown into the existing `try/catch` of `ingestShopifyOrder`. That returns `db-error` → 500 → Shopify retries the idempotent delivery. This is the same rule as the token lookup right before it, and the module header documents it.
   - *Deviation from the item text*, which said "a failed query falls back to the mint": that would turn a short DB outage into a permanently unattributed order.
5. **Retention keep rule (switch on).** A token older than window + 7 days is kept only if **all** of these hold:
   - it is a session source with a session;
   - it was minted at most `attributionTokenMaxDays` ago (§3.6);
   - its own session wrote a product consultation inside the same window + 7 horizon (legacy fallback as in 3.2).

   Being honest about what this does:
   - **It moves the cliff, it does not remove it.** A token is purged 37 days after the device's last product consultation, or `KPI_RETENTION_DAYS` after minting, whichever comes first. A returning stable-sid device after a longer pause stamps a dead token until the widget renews it (§11).
   - **Tokens whose last consultation is 30–37 days old cannot attribute today.** They are kept as a 7-day grace only.
   - **Why not keep every token while any conversation of its session is retained:** that keeps tokens that cannot attribute (data minimisation) and still has a cliff at the cap. The renewal (§11) repairs every purge cause (rule, cap, erasure followed by a fresh sid) with no extra retention.
   - **Switch off:** today's DELETE, unchanged.
6. **Absolute cap.**
   - `attributionTokenMaxDays = max(KPI_RETENTION_DAYS, window + 7)`.
   - When `KPI_RETENTION_DAYS = 0` (KPI step disabled), it uses the default 180, so the cap is never disabled.
   - That matches the analytics window of `mo_orders` and `kpi_events`.
   - Documented rule: "at most 37 days after the device's last product consultation and never more than `KPI_RETENTION_DAYS` (default 180) after minting".
7. **Visibility without linking the order.** A marked order that cannot be attributed is not linked to a session and not written to `mo_orders`. It may still be in the order ledger (F12). It is counted as the server-only event `mo_order_marker_unresolved`:
   - **Session:** `NULL`.
   - **Data:** `{ reason: 'unknown_token' | 'outside_window', source? }`. `source` is sent only for `outside_window` and only from the known enum.
   - **Never sent:** an order id, a token, an amount or any PII.
   - **When:** only on `orders/create`, and only after the delivery succeeded (after `finishWebhookDelivery`). A Shopify retry of the same delivery or an `orders/paid` delivery does not count it again.
   - **Caveats:**
     - A duplicate subscription delivers each event with its own webhook id and counts it twice (P0).
     - The fail-open dedupe (F6) can let a redelivery through on a DB error.
     - Without an `orders/create` subscription the counter stays 0 (P2b).
     - Optional hardening (§4.9): de-duplicate on `X-Shopify-Event-Id`.
   - **Name check:** it avoids `%product%click%`, `%cta%click%`, `%cart%` and `%checkout%` (`src/lib/kpi-event-patterns.mjs`).
   - The counter and the reason split work with the switch on or off.
8. **Not retroactive.** Tier snapshots of orders that are already stored stay as they are. Orders that were already ignored are not re-ingested.
9. **Why both an anchor and a renewal.**
   - The backend anchor handles "the token still exists but was minted long ago". It works with every widget build, from the day the switch is flipped.
   - The widget renewal (§11) handles "the token was purged". Only the widget can replace a token cached in `localStorage`.
10. **Rejected alternatives:**
    - **A `last_used_at` column updated on every chat turn:** one write per turn.
    - **A larger `MO_ATTRIBUTION_WINDOW_DAYS`:** dishonest, and it widens every source.
    - **Anchor over every thread of the session** (`c.session_id`, the first draft): cross-device and identified through the thread (F8).
    - **A customer-level anchor across the devices of a signed-in customer:** it joins identified data into Cluster A and needs a legal decision.
    - **Keep while any conversation of the session is retained:** see 3.5.
    - **A consent-gated anchor driven by the widget's renewal:** a follow-up once §11 is live (§9.5).

---

## 4. Changes, file by file

### 4.1 `migrations/00NN_message_session_id.sql` (new; next free number, 0076 at the time of writing)

```sql
-- ATTR-TOKEN-LIFETIME: which session wrote a product-tool marker row. A thread resumed on
-- another device keeps conversations.session_id (persistTurn never rewrites it), so the
-- attribution anchor needs the writer. Nullable; no backfill (legacy rows stay NULL and use
-- the thread-level fallback for 37 days). Written only on tool marker rows.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS session_id TEXT;
CREATE INDEX IF NOT EXISTS messages_session_marker_idx
  ON messages (session_id, created_at)
  WHERE session_id IS NOT NULL AND tool_name IS NOT NULL;
```

- Forward-only, additive.
- The partial index starts empty (every existing row is NULL), so it builds instantly.
- **Order:** the maintainer runs it **before** the code deploy. Without the column, the tool-row INSERT fails. `persistTurn` swallows the error, so the chat still answers, but that turn's markers are lost.
- The PR says "migration 00NN needed, run before deploy".

### 4.2 Switch and cap: `src/lib/platform-flags.mjs`, `src/lib/retention-options.mjs`, `.env.example`

**`platform-flags.mjs`:** add `isAttributionSessionAnchorEnabled(env = process.env)`, which returns `parseFlag(env.MO_ATTRIBUTION_SESSION_ANCHOR)`. Its JSDoc says:
- the window counts from the device's latest product consultation;
- the keep rule of §3.5 applies;
- it is off by default and is turned on after the owner's decision (ANWALTSDOSSIER §20).

**`retention-options.mjs → parseRetentionOptions`** gets two additive fields:
- `attributionSessionAnchor: isAttributionSessionAnchorEnabled(env)`.
- `attributionTokenMaxDays: Math.max(kpi > 0 ? kpi : RETENTION_DEFAULTS.KPI_RETENTION_DAYS, attributionWindowDays + 7)`.
- Update the typedef and the header paragraph. The cron response already echoes `options`, so both appear in `/api/cron/retention`.

**Tests:**
- `platform-flags.test.mjs`: absent, `""`, `"0"` and `"false"` → false; `"true"` and `"1"` → true.
- `retention-options.test.mjs`: default cap 180; `KPI_RETENTION_DAYS=0` → 180; `KPI_RETENTION_DAYS=20` with window 30 → 37; switch parsing.

**`.env.example`:**
- New block after `MO_ATTRIBUTION_WINDOW_DAYS`:
  ```
  # ATTR-TOKEN-LIFETIME (docs/ORDER_ATTRIBUTION.md): when true, a widget token's window counts
  # from the device's latest product consultation, and retention keeps the token while that device
  # keeps consulting (max KPI_RETENTION_DAYS after minting). Off until the owner's decision
  # (ANWALTSDOSSIER §20, F-37).
  MO_ATTRIBUTION_SESSION_ANCHOR=false
  ```
- Rewrite the `MO_ATTRIBUTION_WINDOW_DAYS` comment (l. 581–584) to cover both modes.

### 4.3 `src/lib/order-attribution.mjs` (pure)

Add this below `isWithinAttributionWindow`. Do not change `isWithinAttributionWindow` or `classifyAttributionTier`.

```js
/** Token sources tied to a live widget session: with MO_ATTRIBUTION_SESSION_ANCHOR the window
 * counts from that session's latest product consultation. */
export const SESSION_ANCHORED_SOURCES = Object.freeze(["widget"]);
/** messages.tool_name values that count as a product consultation (subset of PRODUCT_CARD_TOOLS). */
export const CONSULTATION_ANCHOR_TOOLS = Object.freeze(["show_product", "compare_products", "add_to_cart", "suggest_showroom"]);
/** Why a Mo-marked order stays unattributed (event enum, AC §5). */
export const UNRESOLVED_MARKER_REASONS = Object.freeze(["unknown_token", "outside_window"]);
const KNOWN_TOKEN_SOURCES = new Set(["widget", "summary_email", "marketing_email", "bundle"]);

export function isSessionAnchoredSource(source) { return SESSION_ANCHORED_SOURCES.includes(String(source ?? "")); }

/**
 * The instant the attribution window is measured from. Session sources: the later of the token
 * mint and the last consultation at or before the order; a consultation after orderAt is ignored
 * (the anchor never moves past the order — no skew: chat rows are stamped by our own DB).
 * Link and unknown sources, or lastConsultedAt null (switch off): the mint.
 * Invalid mint → null (fail closed: isWithinAttributionWindow(…, null, …) === false).
 * @returns {Date | null}
 */
export function attributionAnchor({ source, tokenCreatedAt, lastConsultedAt, orderAt }) { … }

/** Map an ingest result to the event payload, or null. orders/create only; reason must be in the enum;
 * source only for outside_window and only from KNOWN_TOKEN_SOURCES. */
export function unresolvedMarkerEvent(topic, result) { … }

/** Tally kpi_events rows {reason, n} → { unknownToken, outsideWindow } (other reasons ignored). */
export function countUnresolvedMarkers(rows) { … }
```

### 4.4 `src/lib/order-attribution.test.mjs` (new tests)

- **Link sources ignore consultations.** `summary_email`, `marketing_email` and `bundle` keep the mint as the anchor even when a later consultation exists.
- **The widget anchors on the latest consultation:**
  - Mint on 2026-08-01, consultation on day 25, order on day 32 → within the window.
  - Same mint and consultation, order on day 56 → outside.
- **A consultation before the mint** → the anchor stays the mint.
- **The anchor never moves past the order:**
  - Consultation 1 min after `orderAt` → ignored (anchor = mint).
  - Consultation exactly at `orderAt` → counts.
- **Switch off** (`lastConsultedAt: null`) → the mint.
- **Fail closed:**
  - Invalid or null mint → `null`, and `isWithinAttributionWindow(order, null, 30) === false`.
  - Garbage `lastConsultedAt` or invalid `orderAt` → the mint.
- **Unknown sources** (`"foo"`) → the mint. This is the conservative default and differs on purpose from `classifyAttributionTier`.
- **`unresolvedMarkerEvent`:**
  - `orders/paid` → `null`.
  - `orders/create` + `unknown_token` → `{reason}` only.
  - `outside_window` + `widget` → `{reason, source:'widget'}`.
  - An unknown source is dropped.
  - `no-mo-marker`, `unclassifiable` and `db-error` → `null`.
- **`countUnresolvedMarkers`** ignores unknown reasons and empty input.
- **Pins:** the `CONSULTATION_ANCHOR_TOOLS` literal set, and `SESSION_ANCHORED_SOURCES` equal to `['widget']`.

### 4.5 `src/lib/conversation-store.ts → persistTurn`

Only the **tool marker** INSERT (the `assistantToolCalls.forEach` block) gains the column:

```ts
INSERT INTO messages (conversation_id, client_message_id, role, content, tool_name, session_id)
VALUES (${conversationId}, ${`${input.assistantMessageId}:${i}`}, 'assistant',
        ${truncate(body)}, ${inv.toolName}, ${sessionId})
ON CONFLICT DO NOTHING
```

- **Data minimisation:** user and assistant text rows do not need it. `ensureConversationStarted` writes only the first user text row, so it is unchanged.
- **Erasure and retention:** unchanged; messages cascade with their conversation.
- **Optional:** `scripts/seed-dev.mjs` fills `session_id` on seeded tool rows, so local data exercises both branches.

### 4.6 `src/lib/mo-orders-store.ts`

**`IngestOrderResult`** (additive change):
- `reason` gains `'unknown_token' | 'outside_window'`. These replace `'marker-expired-or-unknown'`, which has no consumer (grep: only l. 186; the route reads only `attribution.reason` on `!ok`).
- New field `tokenSource?: string`.

**New internal helper** (not exported). It throws to the caller's retry path:

```ts
async function lastConsultationAt(sessionId: string, orderAt: string, sql: Sql): Promise<string | Date | null> {
  const rows = (await sql`
    SELECT GREATEST(
      (SELECT max(m.created_at)
         FROM messages m
        WHERE m.session_id = ${sessionId}
          AND m.tool_name = ANY(${[...CONSULTATION_ANCHOR_TOOLS]}::text[])
          AND m.created_at <= ${orderAt}::timestamptz),
      (SELECT max(m.created_at)
         FROM conversations c
         JOIN messages m ON m.conversation_id = c.id
        WHERE c.session_id = ${sessionId}
          AND m.session_id IS NULL
          AND m.tool_name = ANY(${[...CONSULTATION_ANCHOR_TOOLS]}::text[])
          AND m.created_at <= ${orderAt}::timestamptz)
    ) AS last_consulted
  `) as Array<{ last_consulted: string | Date | null }>;
  return rows[0]?.last_consulted ?? null;
}
```

- The first branch uses `messages_session_marker_idx`. The legacy branch uses `conversations_session_idx` and `messages_conversation_idx`.
- `GREATEST` ignores NULL.
- One extra query per Mo-marked order with a session-source token, and only while the switch is on.

**`ingestShopifyOrder`**, in the token block (l. 160–187):
1. Look up the row.
   - No row: `unresolved = 'unknown_token'`.
   - Row found: read `sid`.
2. Compute `const orderAt = parsed.processedAt;`. Then, **only if** `isAttributionSessionAnchorEnabled()`, the source is session-anchored, `sid` is set and `orderAt && Number.isFinite(Date.parse(orderAt))`, call `lastConsultationAt(sid, orderAt, sql)`.
   - The local `const` narrows `string | null` for `tsc --noEmit`.
   - The guard keeps a malformed date from failing the `::timestamptz` cast on every Shopify retry.
3. Compute `anchor = attributionAnchor({ source, tokenCreatedAt: row.created_at, lastConsultedAt, orderAt })`. `lastConsultedAt` is `null` when step 2 did not run.
4. If `isWithinAttributionWindow(orderAt, anchor, attributionWindowDays())`, set `tokenSource` and `sessionId` as today. Otherwise set `unresolved = 'outside_window'` and remember `row.source`.
5. Early return:
   ```ts
   if (!hasMoCode && !tokenSource) {
     return {
       ok: true,
       action: "ignored",
       reason: unresolved ?? "outside_window",
       ...(unresolved === "outside_window" ? { tokenSource: rowSource } : {}),
     };
   }
   ```

Leave overlap, tier and insert unchanged.

**New exported function `noteUnresolvedMarker(topic: string, result: IngestOrderResult): Promise<void>`.** It calls `unresolvedMarkerEvent(topic, result)` and, if that returns a payload, `recordKpiEvent({ sessionId: null, event: KPI_MO_ORDER_MARKER_UNRESOLVED, data })`. `recordKpiEvent` already swallows and reports errors.

**`getMoAttributionKpis`:**
- Add one query, spelled out, with no fragments:
  ```ts
  SELECT COALESCE(data->>'reason', '') AS reason, count(*)::int AS n
    FROM kpi_events
   WHERE event = ${KPI_MO_ORDER_MARKER_UNRESOLVED}
     AND created_at >= ${range.from}::date AND created_at < (${range.to}::date + 1)
   GROUP BY 1
  ```
- Add `SELECT 1 FROM kpi_events WHERE event = ${KPI_MO_ORDER_MARKER_UNRESOLVED} LIMIT 1` (index `kpi_events(event)`).
- Return the additive fields:
  - `unresolvedOrders: { unknownToken: number; outsideWindow: number }`, via `countUnresolvedMarkers`;
  - `sessionAnchor: boolean`, from `isAttributionSessionAnchorEnabled()`, for the InfoTip text.
- Change `ingestionSeen` to `seenRows.length > 0 || unresolvedSeen.length > 0`. Otherwise a shop whose marked orders are all unresolved would see the misleading callout "webhook not registered?". P2b keeps this honest: the event exists only if `orders/create` arrives.
- Range semantics: the event's `created_at` is the arrival time of `orders/create`, which is about the order time. Document this.

### 4.7 `src/lib/retention.ts`, step 5i

**Two spelled-out queries.** The switch picks one; the arrays and the cap are passed as values, not fragments.

```ts
const attributionTokenCutoff = daysAgo(opts.attributionWindowDays + 7);
const attributionTokenCap = daysAgo(opts.attributionTokenMaxDays);
let deletedAttributionTokens: Array<{ n: number }>;
if (opts.attributionSessionAnchor) {
  deletedAttributionTokens = (await sql`
    WITH del AS (
      DELETE FROM mo_attribution_tokens t
       WHERE t.created_at < ${attributionTokenCutoff}
         AND NOT (
           t.created_at >= ${attributionTokenCap}
           AND t.session_id IS NOT NULL
           AND t.source = ANY(${[...SESSION_ANCHORED_SOURCES]}::text[])
           AND (
             EXISTS (
               SELECT 1 FROM messages m
                WHERE m.session_id = t.session_id
                  AND m.created_at >= ${attributionTokenCutoff}
                  AND m.tool_name = ANY(${[...CONSULTATION_ANCHOR_TOOLS]}::text[])
             )
             OR EXISTS (
               SELECT 1
                 FROM conversations c
                 JOIN messages m ON m.conversation_id = c.id
                WHERE c.session_id = t.session_id
                  AND c.last_activity_at >= ${attributionTokenCutoff}
                  AND m.session_id IS NULL
                  AND m.created_at >= ${attributionTokenCutoff}
                  AND m.tool_name = ANY(${[...CONSULTATION_ANCHOR_TOOLS]}::text[])
             )
           )
         )
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM del
  `) as Array<{ n: number }>;
} else {
  deletedAttributionTokens = (await sql`
    WITH del AS (
      DELETE FROM mo_attribution_tokens
       WHERE created_at < ${attributionTokenCutoff}
      RETURNING 1
    )
    SELECT count(*)::int AS n FROM del
  `) as Array<{ n: number }>;
}
const keptAttributionTokens = (await sql`
  SELECT count(*)::int AS n FROM mo_attribution_tokens WHERE created_at < ${attributionTokenCutoff}
`) as Array<{ n: number }>;
```

- **`RetentionResult`** gets `keptActiveAttributionTokens: number`. The cron JSON spreads the result, and `ranAt` is already there (l. 551).
- **`RetentionOptions`** (TS interface) gets `attributionSessionAnchor: boolean` and `attributionTokenMaxDays: number`, mirroring §4.2.
- **Step comment and `attributionWindowDays` doc** (l. 74–78): "Switch off: tokens leave window + 7 days after minting. Switch on: a session-source token leaves window + 7 days after its own session's last product consultation, and never later than `attributionTokenMaxDays` after minting. Link sources: by `created_at`."
- **Imports:** the two constants from `./order-attribution.mjs`.

### 4.8 Event constants

- `src/lib/kpi-events.ts`: `export const KPI_MO_ORDER_MARKER_UNRESOLVED = "mo_order_marker_unresolved";` with a JSDoc that states the shape: `{reason, source?}`, session `NULL`, `orders/create` only.
- `src/lib/kpi-widget-events.mjs → SERVER_ONLY_EVENTS`: add `"mo_order_marker_unresolved"`. `POST /api/kpi` then answers 202 to a forged copy but does not store it.
- `src/lib/kpi-widget-events.test.mjs`: add the name to the "server-only" positives.

### 4.9 `src/app/api/webhooks/shopify/route.ts`

After `await finishWebhookDelivery(webhookId, outcome.action);`, so only on a successful outcome and never on a 500 that Shopify will retry, add:

```ts
if (attribution) await noteUnresolvedMarker(t, attribution);
```

- `noteUnresolvedMarker` filters on `orders/create` itself.
- Update the header comment (order-attribution paragraph).
- **Optional hardening:** only if a logged live delivery shows the `X-Shopify-Event-Id` header, which is shared by all subscriptions of one event. Before emitting, call `recordWebhookDelivery(`mo-unresolved:${eventId}`, "mo_order_marker_unresolved")` and skip on `false`. This stores no order id, uses the existing table, and leaves on the sync-log window. Without the header, behaviour is as above.

### 4.10 Dashboard

**`src/app/admin/kpi/sections/AttributionSection.tsx`:**
- Add the prop `range` (KpiTab passes `range`, like Login/Consent/Account/Campaign).
- **`notes`** gets `...releaseNotesFor("attribution", range)` and, when `unknownToken + outsideWindow > 0`, this note:
  ```ts
  `${plural(total, "markierte Bestellung", "markierte Bestellungen")} im Zeitraum ohne Zuordnung: ${num(unknownToken)} mit unbekannter oder gelöschter Markierung, ${num(outsideWindow)} außerhalb des Zuordnungsfensters — keiner Beratung zugeordnet (nicht in der Mo-Zuordnung gespeichert), nur gezählt.`
  ```
  `plural` and `num` come from `admin-format.mjs`.
- **`Explain` text** (behind the InfoTip, the only place the explanation goes):
  - With `sessionAnchor`: „Zuordnungsfenster {N} Tage — bei der Widget-Markierung ab der letzten Produktberatung auf dem Gerät (Produktkarte, Vergleich, Warenkorb-Karte, Showroom), bei Mo-Links ab ihrer Erstellung“.
  - Without it: today's text.
  - Plus one sentence on „ohne Zuordnung“: the marker is unknown (deleted after a deletion request or expired), or the last consultation (switch off: the marker) was more than N days before the order.
  - Replace „Unmarkierte Bestellungen werden gar nicht gespeichert (Datenminimierung)“ with „Unmarkierte Bestellungen werden hier nicht erfasst (nicht in der Mo-Zuordnung gespeichert)“. The ledger stores them when the customer sync is on (F12).
- No new primitives and no colours: `KpiSection` notes already use the tokens.

**`src/app/admin/KpiTab.tsx`:** change the call to `<AttributionSection attribution={attribution} range={range} />`.

**`src/lib/kpi-releases.mjs`:**
- **`KPI_RELEASES`**, entry for the deploy day:
  ```js
  {
    date: "<DEPLOY_DATE>",
    key: "attribution-unresolved",
    title: "Bestell-Zuordnung: markierte Bestellungen ohne Zuordnung",
    detail: "Markierte Bestellungen, die keiner Beratung zugeordnet werden können (Markierung unbekannt oder gelöscht, Beratung außerhalb des Zuordnungsfensters), werden seitdem gezählt.",
  }
  ```
- **`KPI_RELEASES`**, entry for the day the switch is flipped:
  ```js
  {
    date: "<SWITCH_DATE>",
    key: "attribution-window",
    title: "Bestell-Zuordnung: Fenster ab der letzten Beratung",
    detail: "Widget-Markierungen zählen ab der letzten Produktberatung auf dem Gerät statt ab der ersten. Vorher wurden Bestellungen 30 Tage nach der ersten Beratung nicht mehr zugeordnet (Markierung nach 37 Tagen gelöscht). „Direkt“ unverändert.",
  }
  ```
- **`MEANINGFUL_FROM.attribution`**, for the switch day:
  ```js
  { date: "<SWITCH_DATE>", why: "„Beraten & gekauft“ und „Beraten, anderes gekauft“ zählen erst seitdem ab der letzten Produktberatung auf dem Gerät statt ab der ersten („Direkt“ unverändert)" }
  ```
- **JSDoc** of `releaseNotesFor`: add `"attribution"` to the section list (l. 77).
- **Dates:**
  - `<DEPLOY_DATE>` is the production deploy day (Europe/Berlin, YYYY-MM-DD).
  - `<SWITCH_DATE>` is the day `MO_ATTRIBUTION_SESSION_ANCHOR=true` is set in production. If the owner approves before merge, both are the same day and go in this PR. Otherwise the `attribution-window` entry and `MEANINGFUL_FROM.attribution` come in a one-line follow-up PR on the flip day.

**`src/lib/kpi-releases.test.mjs`:**
- Extend the date list in "releases are ordered and dated as documented".
- **"releasesInRange is inclusive on both ends"** asserts `releasesInRange({ from: "2026-10-05", to: "2026-10-30" })` is `[]`. That breaks for any new date in that range. Change it to expect the new key(s) dated inside the range, or end the range the day before `<DEPLOY_DATE>`.
- New test (with the switch entry): `releaseNotesFor("attribution", {from: <before SWITCH_DATE>, to: <after>})` gives exactly one note, matching `/^Erst ab dem/` and `/Direkt/`, and no sign-in outage note. A range starting on or after `<SWITCH_DATE>` gives `[]`.

### 4.11 `scripts/verify-live-kpis.mjs` (read-only)

Add a section „7 · Bestell-Zuordnung“. The script's `q()` always binds `since` as `$1` (l. 29–30), so:
- **P1, P3:** `sql.query(text)` with no params, because they have no `$1`.
- **P2b, V3a, V3b, V4:** `q(text)`, each filtering `>= ${SINCE}` (`received_at` / `created_at`). Run with `--since <DEPLOY_DATE>`; for V4 use `<SWITCH_DATE>`.
- **V2, V2b:** only when `--ran-at <ISO>` is given (from the cron response), as `sql.query(text, [ranAt])` with `$1`.
- Print no session ids. Update the header's section list.

### 4.12 Docs (same PR)

| Doc | Change |
|---|---|
| `docs/ORDER_ATTRIBUTION.md` | **Attribution window:** the switch; session sources anchor on the latest product consultation **written by the same session** (tool list, never after the order, legacy fallback for 37 days); link sources on the mint. **GDPR posture → Retention:** the rule with the cap. **New bullets:** the consent-independent extension and the cart attribute left on a shared browser (§7). **Correct "unmarked orders are never stored"** (l. 31, l. 84): never stored in `mo_orders`; the order ledger (`customer_orders`) stores every order while `SHOPIFY_CUSTOMER_SYNC_ENABLED` is on (ANWALTSDOSSIER §13.1 item 1). **New paragraph "Unattributed marked orders":** not linked to a session, counted as `mo_order_marker_unresolved`. **§Widget:** step 5, the renewal (§11), once it ships. **Files table:** `retention.ts`, `conversation-store.ts`, `kpi-releases.mjs`, the migration. |
| `docs/DATA_RETENTION.md` | **Table row `mo_attribution_tokens` (l. 62):** "switch off: window + 7 days by `created_at`; switch on (session sources): window + 7 days after the session's own last product consultation, never more than `KPI_RETENTION_DAYS` (default 180) after minting; link sources by `created_at`; deleted on erasure". **Step 5i text** (l. ~509). **New row** for `messages.session_id` (follows the conversation). |
| `docs/ANWALTSDOSSIER.md` | **§3.1:** new row **D-20** „Bestell-Zuordnung (`mo_attribution_tokens`, `mo_orders`)“ with content and periods: token as in DATA_RETENTION; `mo_orders` 180 T by order date. **New § 19 „Nachtrag <Datum> — Bestell-Zuordnung: Fenster ab der letzten Beratung“:** facts (anchor, keep rule and cap, switch default off, `messages.session_id` on marker rows, legacy fallback cross-device for 37 days, consent-independent extension, cart attribute left on a shared browser, session-less counter without order id), plus the **owner's decision on the broader window** with date. **Prüfbitte F-37:** (a) longer token life under Art. 6 (1) f and storage limitation; (b) whether the consent-independent extension is acceptable or needs frontend task 2 (§11) or the consent-gated anchor (§9.5) first; (c) the 37-day legacy fallback; (d) privacy-policy mention of the purchase-attribution purpose (with F-28 and the open ORDER_ATTRIBUTION item). **Update the „Stand“ line.** |
| `docs/ADMIN_DASHBOARD.md` §5.16 | Window anchor and switch, the „ohne Zuordnung“ note, the corrected „nicht erfasst“ sentence, the release notes, `ingestionSeen`. |
| `docs/API_CONTRACT.md` | **AC §5 server table:** new row `mo_order_marker_unresolved` (emitted by `POST /api/webhooks/shopify` on `orders/create` after a successful delivery; `{reason, source?}`; session `NULL`; never an order id, token or amount; caveat: a duplicate subscription counts twice). **The paragraph after the table** ("They feed …"): add „Mo-zugeordneter Umsatz“ (§5.16). **AC §10:** replace "repeat calls return the same token" (l. 1954) with "returns the same token while it exists; after a purge (retention) or erasure, a new one". Add one sentence on the window (switch on: from the session's latest product consultation). **AC §11.3** orders row: the event. |
| `docs/DATABASE.md` | l. 60 `messages` columns: `session_id` (writer of tool marker rows). |
| `docs/FEATURE_INVENTORY.md` | l. 1592 (expiry column), l. 1813 and l. 2096 (`MO_ATTRIBUTION_WINDOW_DAYS` rows) plus a new `MO_ATTRIBUTION_SESSION_ANCHOR` row; the migrations table (l. ~2250) gets 00NN. New capability line: "unresolved marked orders counted". Nothing removed. |
| `.env.example` | §4.2. |
| `docs/frontend/05` | **§5 table:** new server-only row. **§10 / §10.3:** with the switch, a cached token stays valid while the device consults; residual cliff (37 days after the last consultation, 180 after mint); tokens purged before `<SWITCH_DATE>` are not recoverable by the backend; the repair is the renewal task. |
| `docs/frontend/06` | **§8 intro:** "of the token's minting" → "of the token's minting, or with the backend switch of the device's latest product consultation". **§8.5** (cart attribute left behind; the cleanup task). **§8.7** "Long-lived stamping". |
| `docs/frontend/07` §7 | New P1 row: "Renew the attribution token after a live consultation; blank the cart marker on sign-out / erase / withdrawal" → §11 task. |
| `docs/frontend/README.md` | Glossary line "Window: … from the token mint". **§5 golden rule 8:** add `mo_order_marker_unresolved` to the server-only list. |

---

## 5. Tests and checks

1. **`npm test`:** the new tests from §4.2 and §4.4, plus the updated `kpi-releases.test.mjs` and `kpi-widget-events.test.mjs`. Then `npm run lint`, `npx tsc --noEmit` and `npm run build`.
2. **Local integration.** Setup per docs/DATABASE.md: local Postgres behind `NEON_FETCH_ENDPOINT`, `scripts/seed-dev.mjs`, migration 00NN applied, and in `.env.local` `SHOPIFY_WEBHOOK_SECRET=test` and `MO_ATTRIBUTION_SESSION_ANCHOR=true`.
   - **Seed eight test tokens** next to the seed data. Each is `widget`, with a conversation in its own session. Markers are `show_product` rows with `messages.session_id` set unless noted:

     | Token | Minted | Session | Marker |
     |---|---|---|---|
     | `tokA` | now − 40 d | `s1` | 2 days ago |
     | `tokB` | now − 40 d | `s2` | 33 days ago (ingest outside the window, but kept by retention) |
     | `tokC` | now − 45 d | `s3` | 40 days ago (retention deletes) |
     | `tokD` | now − 40 d | `s4` | in `s4`'s thread, 2 days ago, but written by another device (`messages.session_id = 's5'`) |
     | `tokE` | now − 40 d | `s6` | legacy, 2 days ago (`messages.session_id IS NULL`) in `s6`'s thread |
     | `tokF` | now − 200 d | `s7` | 2 days ago (cap) |
     | `tokG` | now − 40 d | `s8` | only one marker, 20 min **after** the order's `processed_at` (order at now − 1 h, marker at now − 40 min) |
     | `tokUnknown` | not in the table | — | — |

   - **Send each case** as an `orders/create` POST to `/api/webhooks/shopify`:
     - Headers: `X-Shopify-Topic: orders/create`, a fresh `X-Shopify-Webhook-Id`, and `X-Shopify-Hmac-SHA256: $(openssl dgst -sha256 -hmac test -binary body.json | base64)`.
     - Payload: `note_attributes:[{name:"_mo",value:"…"}]`, `processed_at` = now (G: now − 1 h), one line item.
   - **Expected ingest results:**

     | Case | Result |
     |---|---|
     | A | stored, tier `assisted` or `influenced` |
     | B | ignored + `{reason:"outside_window", source:"widget"}` |
     | C | (send after retention) ignored + `{reason:"unknown_token"}` |
     | D | ignored + `outside_window` (another device's marker does not count) |
     | E | stored (legacy fallback) |
     | G | ignored + `outside_window` (a post-order marker never moves the anchor) |
     | Unknown | ignored + `{reason:"unknown_token"}` |

   - **Re-sends:** B as `orders/paid` with a new webhook id adds no event. The unknown case re-sent with the same webhook id → `duplicate:true`, no event.
   - **Retention:** run the cron locally (`Authorization: Bearer $CRON_SECRET`). Compare `SELECT token FROM mo_attribution_tokens WHERE token IN (<the seven seeded test tokens>)` before and after:
     - deleted = {C, D, F};
     - kept = {A, B, E, G}.
     - The response shows `options.attributionSessionAnchor: true` and `attributionTokenMaxDays: 180`.
     - Do **not** assert an absolute `keptActiveAttributionTokens`: the seed adds 40 tokens of its own, many older than 37 days on sessions with tool rows (`seed-dev.mjs` l. 1200–1209).
   - **Switch off:** on a fresh seed with the same test rows and `MO_ATTRIBUTION_SESSION_ANCHOR` unset, all seven test tokens are deleted, and case A is ignored with `outside_window`. That is today's behaviour.
   - **`persistTurn`** (optional, needs `ANTHROPIC_API_KEY`): after a local chat turn that renders a product card, `SELECT session_id FROM messages WHERE tool_name IS NOT NULL ORDER BY id DESC LIMIT 1` returns the turn's `x-ms-session`. Text rows stay NULL.
3. **Screenshots:** KPI tab, group Umsatz, section „Mo-zugeordneter Umsatz“, with the note and the release notes visible and the InfoTip open, in both switch modes, at 1440 px and 1024 px, light and dark, for the PR description.

---

## 6. Rollout and live verification

**Before merge:**
- Run P0–P6 and write the results into the PR.
- PR text:
  - "Migration 00NN needed; the maintainer runs it **before** the deploy."
  - The switch ships **off** in code. State whether the owner approved turning it on (§7, ANWALTSDOSSIER §20) and on which day.
- Set `<DEPLOY_DATE>`. If the switch is turned on at the deploy, also set `<SWITCH_DATE>`.

**Deploy day (migration → deploy):**
- **V0**, after the first product turns on live:
  ```sql
  SELECT count(*) FILTER (WHERE session_id IS NULL) AS without_session, count(*) AS marker_rows
    FROM messages WHERE tool_name IS NOT NULL AND created_at >= '<deploy timestamp>';   -- without_session must be 0
  ```
- **V1**, forged event (stored session = `body.sessionId`; `/api/kpi` is origin-guarded only):
  ```bash
  curl -s -o /dev/null -w '%{http_code}\n' -X POST https://mo.motionsports.de/api/kpi \
    -H 'Origin: https://motionsports.de' -H 'Content-Type: application/json' \
    -d '{"event":"mo_order_marker_unresolved","sessionId":"v1-probe","data":{"reason":"unknown_token"}}'   # → 202
  ```
  ```sql
  SELECT count(*) FROM kpi_events WHERE event = 'mo_order_marker_unresolved' AND session_id = 'v1-probe';  -- must be 0
  ```
- The KPI tab shows the `attribution-unresolved` release in „Änderungen im Zeitraum“.
- Re-run P2b: `orders/create` deliveries are arriving.

**Switch day** (owner approval recorded):
- Set `MO_ATTRIBUTION_SESSION_ANCHOR=true` in Vercel Production and redeploy.
- Add the `attribution-window` release with `<SWITCH_DATE>` if it is not in the PR.
- The KPI tab shows the „Erst ab dem …“ note for ranges before `<SWITCH_DATE>`.

**First retention run after the switch (03:30 UTC):**
- The cron response or log shows `options.attributionSessionAnchor: true`, `deletedAttributionTokens`, `keptActiveAttributionTokens` (about P6, which drifts with the days in between) and `ranAt`.
- `$1` below = that `ranAt`.
- Every horizon gets a 5-minute margin, because `ranAt` is stamped at the end of the run (`retention.ts` l. 551) while the cutoffs are computed at its start.
- 37 = window + 7 and 180 = `options.attributionTokenMaxDays` from the same response.
- Run V2 and V2b before the next nightly run.

```sql
-- V2  no old token survived without a same-session consultation inside the horizon (must return 0)
SELECT count(*) FROM mo_attribution_tokens t
 WHERE t.created_at < $1::timestamptz - interval '37 days' - interval '5 minutes'
   AND NOT (
     t.source = 'widget' AND t.session_id IS NOT NULL
     AND t.created_at >= $1::timestamptz - interval '180 days' - interval '5 minutes'
     AND (EXISTS (SELECT 1 FROM messages m
                   WHERE m.session_id = t.session_id
                     AND m.created_at >= $1::timestamptz - interval '37 days' - interval '5 minutes'
                     AND m.tool_name IN ('show_product','compare_products','add_to_cart','suggest_showroom'))
          OR EXISTS (SELECT 1 FROM conversations c JOIN messages m ON m.conversation_id = c.id
                      WHERE c.session_id = t.session_id AND m.session_id IS NULL
                        AND m.created_at >= $1::timestamptz - interval '37 days' - interval '5 minutes'
                        AND m.tool_name IN ('show_product','compare_products','add_to_cart','suggest_showroom'))));

-- V2b the cap holds (must return 0)
SELECT count(*) FROM mo_attribution_tokens
 WHERE created_at < $1::timestamptz - interval '180 days' - interval '5 minutes';
```

**First week:**

```sql
-- V3a unresolved marked orders since the deploy, by reason and source; session always NULL
SELECT data->>'reason' AS reason, data->>'source' AS source, count(*) AS events,
       bool_and(session_id IS NULL) AS all_sessionless
  FROM kpi_events
 WHERE event = 'mo_order_marker_unresolved' AND created_at >= '<DEPLOY_DATE>'
 GROUP BY 1, 2;

-- V3b payload keys: only 'reason' and 'source'; a row with key NULL = an event with data '{}' (must not exist)
SELECT k AS key, count(DISTINCT e.id) AS events
  FROM kpi_events e
  LEFT JOIN LATERAL jsonb_object_keys(e.data) k ON true
 WHERE e.event = 'mo_order_marker_unresolved' AND e.created_at >= '<DEPLOY_DATE>'
 GROUP BY 1;

-- V4  orders the anchor saved (the old rule would have rejected them) = the effect metric
SELECT count(*) AS orders, sum(o.total_price) AS eur
  FROM mo_orders o JOIN mo_attribution_tokens t ON t.token = o.attribution_token
 WHERE o.attribution_source = 'widget'
   AND o.created_at >= '<SWITCH_DATE>'
   AND o.processed_at > t.created_at + interval '30 days';
```

V4 counts all financial statuses (the dashboard shows realised ones only). It needs the token row to still exist; erasure and later purges shrink it, so read it in weeks 1 and 4.

**After 4–6 weeks:**
- **The effect metric is V4** (orders and EUR the anchor saved).
- **Weekly „Beraten & gekauft“ and „Beraten, anderes gekauft“** for 4 weeks before and after `<SWITCH_DATE>` are **context only**. The 2026-10-04 widget release falls inside the "before" window: working sign-in, PDP CTA on all product templates, `mo_c` campaign token. It changes those tiers on its own, so the comparison cannot isolate this change.
- **`unknown_token`** does not fall toward 0 from the backend change alone. Devices whose token was purged keep stamping it until their sid rotates or the §11 renewal is live. The residual cliff (37 days after the last consultation, 180 after mint) and erased sessions keep producing it.
- **`outside_window`** stays low but not zero. That is the honest window working as intended.

**Deploy + 37 days:** the legacy fallback no longer finds rows inside the horizon. Remove it (§9.4).

---

## 7. Legal and privacy

- **Data.** No new data category. One new column: the pseudonymous session id that is already on the conversation, now also on product-tool marker rows (which device wrote which product turn). It is deleted with the conversation (`RETENTION_DAYS`) and on erasure (cascade). The KPI event carries only enums.
- **Per device, with one transition gap.** Only consultations written by the token's own session extend its window. This is the same pseudonymous Cluster A scope as today, with no customer-level join. **Exception:** for 37 days after the migration, legacy rows (`messages.session_id IS NULL`) count for the thread's original session. In a thread a signed-in customer resumed on another device, that includes the other device's turns.
- **Consent-independent extension (new effect).** The backend cannot see analytics consent at chat time (F9).
  - A product chat on the same device after analytics consent was withdrawn extends the window of the token minted under consent.
  - The `_mo` on the Shopify cart is not removed on withdrawal, sign-out or rotation (06 §8.5). On a shared browser, a later order can therefore be tied to that session, and through its conversations to a signed-in customer's record, for longer than the 30 days from mint possible today.
  - Mitigations: the switch is off by default; frontend task 2 (§11) blanks the marker; §9.5 offers a consent-gated anchor. The dossier asks F-37 (b).
- **Retention.** With the switch on, a widget token lives at most 37 days after its own session's last product consultation and never more than `KPI_RETENTION_DAYS` (default 180) after minting. It is still deleted on erasure (`erasePerson`). `DATA_RETENTION.md`, `ORDER_ATTRIBUTION.md` and the dossier (D-20) must say so (§4.12).
- **The window gets broader.** For widget tokens the 30 days count from the latest product consultation. This is an owner decision on how honest the tiers stay. Record it with date in ANWALTSDOSSIER §20 before the switch is flipped. Recommended: wait for the lawyer's answer to F-37, as was done for F-32 (`CHAT_ORDER_STATUS_ENABLED`).
- **The new event** carries only `reason` and optional `source`: no order id, token, amount, PII or text. It is server-only (AC §5, `SERVER_ONLY_EVENTS`).
- **Transparency.** The dashboard and ORDER_ATTRIBUTION no longer say unmarked orders are "not stored". They say "not in the Mo attribution", because the ledger stores them when the customer sync is on (F12).
- **Still open:** the lawyer item in `ORDER_ATTRIBUTION.md` (privacy-policy mention of the purchase-attribution purpose; Protected Customer Data for the order topics) and F-28. This item does not resolve them. F-37 (d) points to them.

---

## 8. Risks and how they are handled

| Risk | Handling |
|---|---|
| More pseudonymous token rows | Only with the switch on; only session sources with a same-session product consultation inside the horizon; capped at 180 days after mint (P6 sizes it). |
| Window inflation from non-product chats | The anchor and the keep rule count only product tool rows. |
| Another device's turns extend the window | Per-device `messages.session_id`; the legacy fallback is limited to 37 days and stated in §7 and the dossier. |
| A consultation after the purchase moves the anchor | `m.created_at <= processed_at` plus a clamp in the pure function; tests in §4.4 and case G. |
| Consent-independent extension and shared browsers | Switch default off; owner decision and F-37; frontend task 2; §9.5. |
| Malformed `processed_at` causes endless retries | Guard before the anchor query (§4.6 step 2); otherwise fail-closed through `isWithinAttributionWindow`. |
| Event counted twice | `orders/create` only, after a successful delivery, webhook-id dedupe. Duplicate subscriptions (P0) and the fail-open dedupe remain; optional event-id dedupe (§4.9); caveat in AC §5. |
| Counter silently 0 | P2b requires `orders/create` deliveries; `ingestionSeen` reads the event only as an addition. |
| Migration not run before the deploy | Tool-row inserts fail (swallowed: the chat answers, the turn's markers are lost). Order stated in the PR; V0. |
| Load at ingest | At most one indexed query per Mo-marked order with a session token, only with the switch on. |
| Residual cliff (37 days after the last consultation, 180-day cap) | Stated in §1, §6, the release note, 05 §10 and DATA_RETENTION; repaired by the §11 renewal. |
| Tokens already purged before the switch | Not recoverable by the backend; §11 repairs them on the next live consultation. |
| Legal or owner rejection | Switch off restores today's ingest and retention without a revert. The column stays (nullable); stop writing it in a follow-up if F-37 says so. |
| Snapshots already ingested | Unchanged (not retroactive). |

---

## 9. Out of scope (separate follow-ups)

1. **Link-source token reuse leaves a dead zone.** `summary_email` and `marketing_email` tokens are also one per session (`mintAttributionToken`; callers `summary-email.ts`, `marketing-email.ts`). A mail sent on day 31–37 reuses a token that is already outside the window, so a code-less order through that fresh link is lost.
   - Fix (backend, S): when `mintAttributionToken` reuses a link-source token, refresh `created_at = now()` (`UPDATE … RETURNING token`).
   - It is a separate item because it changes the anchor semantics of „Direkt“.
2. **The overlap check only sees the most recent thread.** `loadConversationForSummary` takes `LIMIT 1` by `last_activity_at`, so in a multi-thread session an older thread's products do not count toward „Beraten & gekauft“. Fix: union `recommended_product_ids` and `selected_product_ids` across the session's threads active after `anchor − window`.
3. **A2** (07 §7) reuses the widget token on the permalink. It adds no token source and needs nothing here.
4. **Remove the legacy fallback** (`m.session_id IS NULL` branch in §4.6 and §4.7, and in V2) after `<MIGRATION_DATE> + 37 days`.
5. **Consent-gated anchor.** Once the §11 renewal is live (it runs only with analytics consent, after a live chat turn), the anchor could move from chat rows to the renewal: a `refreshed_at` on the token, bumped when the mint endpoint reuses a widget token. That removes the consent-independent part of §7. Decide with F-37 (b).
6. **Customer-level anchor** (signed-in, across devices): needs a legal decision.

---

## 10. Acceptance checklist

- [ ] P0–P6 run on live and their results recorded in the PR. The cliff date is known (P3); `orders/*` has exactly one subscription per topic, and `orders/create` arrives (P0, P2b).
- [ ] Migration 00NN added (forward-only). The PR says the maintainer runs it before the deploy. `persistTurn` writes `messages.session_id` on tool marker rows only.
- [ ] `MO_ATTRIBUTION_SESSION_ANCHOR` is parsed in `platform-flags.mjs`, surfaced in `parseRetentionOptions` with `attributionTokenMaxDays`, tested, documented in `.env.example`, and off by default.
- [ ] `attributionAnchor`, `unresolvedMarkerEvent`, `countUnresolvedMarkers` and the constants are in `order-attribution.mjs`, with tests as in §4.4. `npm test` is green.
- [ ] `ingestShopifyOrder` uses the anchor only with the switch on and only for session sources. It counts only same-session rows (legacy fallback) with `created_at <= processed_at`. It returns `unknown_token` / `outside_window`. An anchor-query failure gives `db-error` (500, Shopify retries); invalid data falls back to the mint.
- [ ] Retention step 5i: switch off = today's query; switch on = the keep rule with the cap. `keptActiveAttributionTokens` is reported. Every query is spelled out, with no nested fragments.
- [ ] `mo_order_marker_unresolved` is emitted on `orders/create` only, after a successful delivery, with session `NULL` and only `{reason, source?}`. It is in `SERVER_ONLY_EVENTS`, the AC §5 table (with the duplicate-subscription caveat) and README rule 8.
- [ ] AttributionSection shows the „ohne Zuordnung“ note (`plural()`) and the release notes. The InfoTip explains the anchor for the active mode and no longer says unmarked orders are „gar nicht gespeichert“. `ingestionSeen` also counts unresolved events. Screenshots taken at 1440 and 1024 px, light and dark.
- [ ] `KPI_RELEASES` dated with the real deploy day (and switch day). `MEANINGFUL_FROM.attribution` is limited to the two widget tiers. The `releasesInRange` test is updated, and the JSDoc lists "attribution".
- [ ] `verify-live-kpis.mjs` section 7 binds parameters correctly (no unused `$1`).
- [ ] Docs from §4.12 updated, including the ANWALTSDOSSIER §20 Nachtrag (D-20, F-37, owner decision), AC §10 "same token while it exists; a new one after a purge", DATABASE.md and 07 §7.
- [ ] lint, tsc and build are clean.
- [ ] After deploy: V0 = 0 rows without session. V1 = 0 stored forgeries. P2b shows `orders/create`.
- [ ] After the switch: V2 = 0 and V2b = 0 against `ranAt`; V3a only `session_id IS NULL`; V3b only the keys `reason`/`source` and no `{}` rows; V4 recorded in weeks 1 and 4; weekly tiers read as context with the 2026-10-04 confounder named.
- [ ] The §11 frontend task handed over.

---

## 11. Companion frontend task (07 §4.3 template)

```markdown
# Frontend task — Renew the attribution token after a live consultation; blank the cart marker when the session ends (2026-10, after the backend PR for ATTR-TOKEN-LIFETIME)

Paste into the frontend agent that owns `ms_shopify_clone`. Attach: `docs/API_CONTRACT.md` (§10, §5 server-only table), `docs/ORDER_ATTRIBUTION.md` (§Widget), `docs/frontend-handoff/WIDGET_SPEC.md`.
Where this prompt and the attached files disagree, the files win.

## Baseline
Builds on widget `main` at `3e87341` (live since 2026-10-04, MANIFEST 2026-10-04 b).
- The widget mints `POST /api/attribution/token` only when no token is cached for the current sid (`moAttrEnsure()`; docs/frontend 06 §8.2, §8.4).
- It re-stamps the cached token on every page load (`initAttribution()`, 05 §10.2), and the sid has no expiry (06 §8.7). A device whose token the backend deleted keeps stamping that dead token until the sid rotates.
- `moAttrReset()` drops the cache on rotation, but the `_mo` already on the Shopify cart stays (06 §8.5).

## Goal and KPI
- **Task 1:** a device whose token was deleted gets a fresh token on its next live product consultation. Deletion causes: backend retention, 37 days after the device's last product consultation or at most 180 days after minting. KPI: „Mo-zugeordneter Umsatz“ rows „Beraten & gekauft“ and „Beraten, anderes gekauft“. The note „Markierte Bestellungen ohne Zuordnung“ (`unknown_token`) on the KPI tab should fall.
- **Task 2:** privacy hygiene on shared browsers. The cart stops carrying a marker of a session that signed out, was erased, was ended by the server, or whose analytics consent was withdrawn. KPI: none (it removes possible misattribution; not measurable).

## Contract references
- AC §10 `POST /api/attribution/token`: headers `x-ms-chat-key` + `x-ms-session`, no body; response `{ ok, token, cartAttributes }`; error table 400/401/403/429/503. After the backend PR: "returns the same token while it exists; after a purge or erasure, a new one".
- ORDER_ATTRIBUTION §Widget steps 1–4.
- AC §5 server-only table (no new event).

## Backend state
- No contract change.
- The endpoint already mints a new token when the (session, `widget`) row is gone (`mintAttributionToken`). Deployed since migration 0042.
- The backend switch `MO_ATTRIBUTION_SESSION_ANCHOR` is independent: this task helps with it on or off.
- No-op if the widget ships later: a renewal call returns the same token while it exists.
- Rate limit: shared `kpi` bucket. One extra call per page view at most.

## Rules that do not change
- No mint, renewal or stamp unless `window.Shopify.customerPrivacy.analyticsProcessingAllowed() === true` (`moAnalyticsAllowed()`), re-checked at stamp time.
- The raw sid never goes into a cart attribute or URL. Only the server's `cartAttributes`, passed through unchanged as a flat object.
- KPI events: ids and enums only; never the token. Never send server-only events (README rule 8). This task adds no event.
- Fail silent: never block chat or shopping.
- Unknown tools render nothing (unchanged).

## Tasks (in order)

### 1. Renew the token after a live product consultation (required)
- **Where:** `ms-chat-widget.js → finalizeStream()`. When a streamed assistant turn finishes without `streamErrored`, call a new `moAttrRenew()` next to `moAttrEnsure()`.
- **Trigger and timing:** all of these must hold:
  - the finished assistant message contains a part of type `tool-show_product`, `tool-compare_products`, `tool-add_to_cart` or `tool-suggest_showroom` (the backend's consultation tools);
  - `moAttrLoad()` returns a cached token for the current sid;
  - `moAnalyticsAllowed()` is true.

  At most once per page view (`moAttrRenewed`). Never from restored history (`renderRestoredAssistant()`), never from `initAttribution()`. Without a cached token, nothing changes: the `show_product` render mints as today.
- **Request:** `POST {apiBase}/api/attribution/token`, headers `x-ms-chat-key` + `x-ms-session`, no body, no `Content-Type` (as 06 §8.2). Single-flight via `moAttrInflight`. Capture `sid` before the fetch.
- **Response handling:**

  | status | widget behaviour | KPI |
  |---|---|---|
  | 200, `moAttrValid()`, token ≠ cached | if the sid is unchanged: write `moAttr` and `localStorage['ms-mo-attr'] = {sid, token, cartAttributes}`, then `moStampCart()` (consent re-checked) | none |
  | 200, same token | nothing | none |
  | 200 invalid, 400/401/403/429/5xx, network | keep the cached token; no retry this page view; do **not** set `moAttrFailed` (the „Zur Kasse“ path keeps stamping the cached token) | none |
  | any, sid changed meanwhile (`onSidChangedElsewhere()`, rotation) | drop the response (05 §10.3 race) | none |

- **UI strings:** none.
- **Storage:** `ms-mo-attr` (existing key, overwritten); in-memory `moAttrRenewed` (page view).
- **KPI:** none. The backend reads the effect from `mo_order_marker_unresolved {reason:'unknown_token'}` and its V4 check. No new names; nothing collides with `%cart%` / `%checkout%`.
- **Failure mode:** fail silent.
- **Edge cases:**
  - stream aborted by a new chat or by opening a conversation (`abortActiveStream()`) → no renewal;
  - signed-in and anonymous behave the same;
  - voice mode the same;
  - `/en` the same;
  - a consent banner still loading (API missing) → no renewal on this page view;
  - several product turns on one page → one call.

### 2. Blank the cart marker when the session ends or consent is withdrawn (recommended; the lawyer's answer to F-37 may make it required)
- **Where:**
  - In `signOut()`, `clearAfterErase()` and `endedSignInCleanup()`, before `dropSessionHistory()` / `rotateSession()` → `moAttrReset()` clears the cache.
  - In the `visitorConsentCollected` listener in `initAttribution()`, when `moAnalyticsAllowed()` is now false and a token is cached.
- **Not** on anonymous „Neuen Chat starten“ or `mo_new=1`: the same person keeps shopping, and the backend window bounds it.
- **Request:** `fetch('/cart/update.js', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ attributes: blanked }), keepalive:true })`. `blanked` has every key of the cached `cartAttributes` with value `""`. Same origin, fire-and-forget. Without a cached entry, skip: the widget does not hard-code the key.
- **Consent gate:** not gated. It removes a marker and sends nothing for analytics.
- **Response handling:** none (fail silent). Verify once on live that `/cart.js` no longer lists `_mo` after the call, i.e. that Shopify removes an attribute set to an empty string.
- **UI strings:** none.
- **Storage:** none new.
- **KPI:** none.
- **Edge cases:**
  - erase answered with 401 → still blank, then clean up;
  - another tab rotated first → its cache is gone, skip;
  - a cart already ordered (empty) → harmless.

## Legal constraints
- Task 1 calls the endpoint only with analytics consent and only after a live chat turn (an interaction), so it adds no interaction-free call (05 §13.3).
- Task 2 deletes a marker; nothing leaves the browser except the same-origin cart update.
- No served copy, no `lawyerApproved` / `enLegalReviewed` surface.
- Context: ANWALTSDOSSIER §20, F-37.

## Deployment
Files to upload: `assets/ms-chat-widget.js`. Shared files to hand-edit: none. MANIFEST entry required. Switches to flip after the live check: none (independent of `MO_ATTRIBUTION_SESSION_ANCHOR`).

## Acceptance checklist
- [ ] Harness, mock token endpoint returns token A, then B. With A cached, a streamed `show_product` turn sends exactly one POST with `x-ms-chat-key` + `x-ms-session` and no body; the cache becomes B; one `/cart/update.js` with `{attributes:{_mo:B}}`.
- [ ] A second product turn on the same page view → no second POST. A compare-only or showroom-only turn with a cached token → one POST.
- [ ] Same token returned → no cache write, no extra stamp.
- [ ] Page load with restored history containing product cards → no renewal POST.
- [ ] `analyticsProcessingAllowed() === false` or the API is missing → no POST, no stamp.
- [ ] 401/403/429/503 or network on renewal → cache unchanged; „Zur Kasse“ still stamps the cached token.
- [ ] Sid rotated while the POST is in flight → response ignored, cache of the new sid untouched.
- [ ] Task 2: sign-out, erase and server-ended sign-in → one `/cart/update.js` with `{attributes:{_mo:""}}` before the reset; anonymous „Neuen Chat starten“ → none; consent withdrawn via the banner → one blank call.
- [ ] Live: the backend deletes a test token by hand (`DELETE FROM mo_attribution_tokens WHERE token = '<test>'`). The next product turn writes a new token to `ms-mo-attr`, and `/cart.js` shows the new `_mo`.
- [ ] Harness: new checks added and passing in DE + EN, 1280 + 390.
- [ ] No console errors; no new hard-coded legal text; no pre-selection; no server-only events; no new KPI event.
- [ ] Screenshots: none (no visible surface changes); state so in the PR.
```

---

## Verifier notes

All 21 findings were checked against the cited evidence and are correct. All of them are applied; none is ignored. Four (#2, #8/#19, #15, #16) left a choice or needed a small refinement, as noted. Duplicates were merged: #7 and #18 (V3), #8 and #19 (V2).

- **#2 (cliff remains):** applied as option (b). The keep rule stays and the residual cliff is stated in §1, §3.5, §6, §8, the release note and the docs. The healing is a full 07 §4.3 frontend task (§11). AC §10 is corrected. Option (a), keeping every token while any conversation is retained, was not taken: it keeps tokens that cannot attribute and still has a cliff at the cap.
- **#8/#19 (V2 timing):** V2 is anchored on `ranAt` as #8 suggests, plus a 5-minute margin on every horizon. `ranAt` is stamped at the end of the run (`retention.ts` l. 551), while `daysAgo()` cutoffs are computed at its start. Without the margin a few false positives remain.
- **#15 (cross-device):** applied as option (a), with the additive migration `messages.session_id`. The column is written only on product-tool marker rows in `persistTurn`. `ensureConversationStarted` writes only the first user text row, so it needs no change (data minimisation). The consent-independent part of the finding is not solved by (a); it is stated in §7, asked as F-37 (b), and mitigated by frontend task 2 and §9.5.
- **#16 (absolute cap):** applied. When `KPI_RETENTION_DAYS = 0` the cap falls back to the default 180 instead of disappearing, so "0 disables" never means "keep tokens forever". The cap is `max(…, window + 7)`, so a short KPI window never deletes earlier than today's rule.
- **#3 (`chat_checkout`):** confirmed. `grep -rn chat_checkout src docs` returns nothing, and 07 §7 A2 reuses the widget `cartAttributes`. Removed everywhere.