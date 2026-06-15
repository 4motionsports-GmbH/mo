# 10E-1 (BACKEND) — change report

Shop-native login detection, lost-conversation fix, history-list performance, and
PDF summary. **Diagnose-first**, then fix. Typecheck + build + full test suite all
green (262 tests).

---

## ROOT CAUSE 1 — already-signed-in detection (the main bug)

### Diagnosis

A customer who logs in via the **shop's own login** (the storefront account icon),
then opens the chat, still sees login buttons; their name never shows.

- The only detection wired was `GET /api/auth/me?session={sid}`, which resolves a
  session **only** through `customer_session_links` (written exclusively by the
  **chatbot's** OAuth callback / email capture) and then **requires a server-held
  Customer-Account access token** (`getValidAccessToken`). A shop-native login
  produces **neither** — it leaves a storefront **cookie** on `motionsports.de`,
  nothing on our side.
- The widget is in the theme; the backend is cross-origin on Vercel, so the
  backend **cannot read the storefront session cookie**. The CA-3 spike further
  flagged `logged_in_customer_id` / the Liquid `customer` object as **unreliable
  on new customer accounts**, and the theme deliberately **did not wire
  `prompt=none`** (it's a jarring full-page redirect — see
  `CUSTOMER_ACCOUNT_THEME_NOTES.md`).

**Conclusion:** there was *no* mechanism by which a shop-native session could reach
the backend. Detection only ever worked for the chatbot-OAuth path.

### Realistic mechanisms evaluated

| Mechanism | Verdict |
|---|---|
| Liquid `customer` / `logged_in_customer_id` injected into the widget, sent to us | ❌ unreliable on new customer accounts **and** forgeable (client-supplied) |
| `prompt=none` silent OAuth | ✅ authoritative, but a **full-page redirect** — theme rejected it for UX |
| **Shopify App Proxy** (Shopify signs `logged_in_customer_id` to our backend) | ✅ **only** channel that sees a *shop-native* session AND is cryptographically trustworthy → **recommended** |

The newly-granted **`read_customers`** Admin scope is the enabler: once we have a
Shopify-vouched **identity**, we read the name/email straight from the Admin API —
**no customer token needed** — so detection only has to establish *who*, regardless
of *how* they logged in.

### Fix (implemented, backend)

`GET /api/auth/storefront` (`src/app/api/auth/storefront/route.ts`):

1. Verify the **App Proxy HMAC signature** (`lib/shopify-app-proxy.mjs ::
   verifyAppProxySignature` — the App-Proxy algorithm: sorted `key=value` with no
   separator, HMAC-SHA256 hex, constant-time compare). **Fail-closed** on any
   mismatch; no Admin/DB work runs first.
2. Trust **only** Shopify's `logged_in_customer_id` (empty/non-numeric → not signed
   in). Never a client-supplied id.
3. Enrich name + email via the Admin API (`lib/shopify-orders ::
   fetchAdminCustomerById`, `read_customers`).
4. Find-or-create the customer + link the widget `session_id` (reusing the same
   `bindShopifyIdentity` merge as the OAuth callback).
5. Return `{ signedIn:true, name, tier:3, shopify_customer_id, identity:{name,tier},
   marketing:{…} }` — shape-compatible with `/api/auth/me`.

`/api/auth/me` also gains a best-effort **Admin-API name fallback** (same
`read_customers` source) when the Customer-Account identity read is empty — its
token gate is unchanged.

### ⚠️ Required STORE + THEME action (Lucas) — stated, not half-built

The backend half is complete and tested; the endpoint cannot fire until:

1. **App Proxy** is added to the app — Shopify admin → app → *App proxy*: **Subpath
   prefix** `apps`, **Subpath** `chat`, **Proxy URL**
   `https://chat.motionsports.de/api/auth/storefront`.
2. The **theme** calls the same-origin proxied path `/apps/chat/whoami?session={sid}`
   on first panel open (`frontend-handoff/CUSTOMER_ACCOUNT.md` §3a).
3. Backend env **`SHOPIFY_APP_PROXY_SECRET`** = the app's API secret key (falls back
   to `SHOPIFY_CLIENT_SECRET`).
4. **Re-verify on the live store** that App-Proxy `logged_in_customer_id` is
   populated for this store's customer-accounts mode (the spike's "unreliable"
   finding predates Shopify's fixes). It **fails closed** either way, and the
   chatbot "Anmelden" remains the fallback — never a security risk.

**Known limit (stated):** `/api/account/*` history still requires a live
Customer-Account token (its liveness/logout proof), which a *pure* shop-native
session lacks. Detection (the name) works without it; full **history** for that
session needs either a one-tap chatbot "Anmelden" or routing the account endpoints
through the App Proxy as a follow-up.

---

## ROOT CAUSE 2 — lost conversation (data-integrity)

### Diagnosis

A signed-in user clicked "Neue Beratung"; the new thread never appeared in the list
after switching/reloading. Two compounding defects:

1. **Orphaned — no customer link at creation (the killer).** The conversation row
   was written only in `persistTurn` (chat `onFinish`, *after* the stream) and that
   `INSERT` **never set `customer_id`**. The customer link was stamped only at
   sign-in / email-capture (`UPDATE conversations … WHERE session_id`), which had
   already run *before* the later "Neue Beratung" row existed. So the new row was
   created with `customer_id = NULL`, and the history list (`WHERE customer_id =
   <self>`) never returned it. The conversation **was persisted but invisible**.
2. **Flushed too late.** Persisting only in `onFinish` meant a thread whose answer
   never landed (reload / switch first) was never written at all.

### Fix (implemented)

- **Eager create, customer-linked at creation** — `lib/conversation-create.mjs ::
  ensureConversationStarted`, called from `/api/chat` **before** the stream
  (concurrently with retrieval, best-effort): upserts the row by
  `conversation_key`, stamps `customer_id` resolved from `customer_session_links`
  (`lib/customer-session-link :: resolveLinkedCustomerId`), and persists the first
  user message — so a started thread **lists immediately and survives reload**,
  exactly like ChatGPT/Claude.
- **Backstop** — `persistTurn` now also resolves + stamps `customer_id` (and the
  cached title), `COALESCE`-ing so it never NULLs an existing link or re-clobbers a
  thread that signed in mid-way.
- Anonymous sessions stay pseudonymous (`customer_id` NULL), unchanged.

Tests: `conversation-create.test.mjs` (a new signed-in conversation is created +
customer-linked + listed at creation; anonymous stays NULL; idempotent; COALESCE
never NULLs an existing link), `customer-session-link.test.mjs`
(`resolveLinkedCustomerId`).

---

## PERFORMANCE — slow list + slow open

### Diagnosis

`listCustomerConversations` is `WHERE customer_id = <self> ORDER BY last_activity_at
DESC, id DESC`, and derived each row's title via a **per-row `LATERAL`** sub-select
fetching the first user message from `messages` (the N+1).

- The pre-existing `conversations(customer_id)` index (0008) covered the **filter**
  but **not the ordering**, so a long history still paid a **sort**.
- Titles were **never** model-generated (good) — but the per-row first-message
  `LATERAL` was real per-render work.

### Fix (migration `0026_conversation_history_perf.sql`)

- **Composite partial index** `conversations(customer_id, last_activity_at DESC, id
  DESC) WHERE customer_id IS NOT NULL` — serves filter **and** order in one indexed
  walk (no sort node).
- **Cached title on the row** — new `conversations.title_auto`, written at creation
  (`deriveConversationTitle` of the first user message), backfilled for existing
  rows. The list reads `COALESCE(custom title, title_auto, 'Beratung')` straight off
  the row — the first-message `LATERAL` is gone.
- `messageCount` stays a single indexed `COUNT` per row over
  `messages_conversation_idx`. Open (`getCustomerConversationTranscript`) was
  already two indexed queries (PK + `conversation_id`) — left as is.

Target: a snappy list well under a second for a normal history, and fast open.

---

## PDF SUMMARY (was HTML, 10B-1 → 10E-1)

The signed-in "Zusammenfassung herunterladen" now returns a **PDF**
(`application/pdf`) instead of HTML, reusing the **same content/structure** as the
summary email (AI prose → *Deine Auswahl* → *Zur Kasse* → divider → *Vielleicht auch
interessant* → sign-off).

- `buildSummaryDocument` (`lib/summary-email.ts`) now also returns the structured
  pieces (`summary`, `chosen`, `cartUrl`, `alternatives`) — the email and the
  download are assembled by the **same** code, so they can't drift.
- `lib/summary-pdf.mjs :: buildSummaryPdf` renders them on the repo's
  **dependency-free** hand-written PDF stack (`lib/pdf-core.mjs`, extracted from the
  physical-letter PDF and shared with it — no headless browser / PDF dep on Vercel).
- `GET /api/account/summary` returns the PDF behind the **same** signed-in resolver
  (origin + secret + live token, fail-closed). Any model call is still recorded as
  the `summary_download` S6 cost metric, linked to the conversation.

Tests: `summary-pdf.test.mjs` (valid PDF, all sections present, graceful empty case,
pagination). `letter-pdf.test.mjs` still green after the `pdf-core` extraction.

---

## Docs / handoff

- `docs/CUSTOMER_ACCOUNT.md` — §2 App-Proxy detection + the required store action;
  §9 eager-create + the 0026 index/title caching; §11 PDF.
- `docs/frontend-handoff/CUSTOMER_ACCOUNT.md` — §3a App-Proxy detection (response
  shape + store action), §3b `prompt=none` demoted to alternative; §7.1/§7.6
  eager-create-and-list; §8 PDF (response + download snippet).
- `docs/API_CONTRACT.md` + `docs/frontend-handoff/API_CONTRACT.md` — route tables:
  added `/api/auth/storefront`, summary marked PDF.

**Next (per the task):** copy `docs/frontend-handoff/*` into the theme repo before
10E-2, and have the theme wire the App Proxy `/apps/chat/whoami` call + the App
Proxy config in Shopify admin.
