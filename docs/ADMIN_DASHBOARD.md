# Admin dashboard (`/admin`)

The German back office of Mo: one shared admin login, ten screens in a grouped
sidebar, and a send path that concentrates every legal guarantee in one place.
The operator reviews and approves — the **system** sends (nobody copies text
into a personal mail client).

| Group | Screen | `?tab=` | Key | What it is | Detail |
| --- | --- | --- | --- | --- | --- |
| Arbeit | Übersicht | `overview` (bare `/admin`) | 1 | "Heute" tasks, last-30-days numbers, activity | §3.1 |
| Arbeit | Kampagne | `kampagne` | 2 | Review queue for personalised e-mails to Shopify marketing subscribers | §3.2, [`CAMPAIGNS.md`](./CAMPAIGNS.md) |
| Arbeit | Kunden | `kunden` | 3 | One row per person: profile, consultations, purchases, marketing draft, correspondence, letter; unmatched inbox | §3.3, [`CUSTOMERS.md`](./CUSTOMERS.md) |
| Arbeit | Wissen | `wissen` | 4 | Q&A knowledge queue (gaps → answers → published) | §3.4, [`QA_KNOWLEDGE.md`](./QA_KNOWLEDGE.md) |
| Einblicke | KPIs | `kpi` | 5 | Pseudonymous analytics + Shopify revenue per period | §3.5, §5 |
| Einblicke | Gespräche | `gespraeche` | 6 | Conversation inspector with cached AI analysis and insights | §3.6 |
| Einblicke | Feedback | `feedback` | 7 | Widget and newsletter feedback | §3.7 |
| Einblicke | Analyse | `analyse` | 8 | Stored "Komplettanalysen" per interval, PDF export | §3.8 |
| Einblicke | Verbesserung | `verbesserung` | 9 | Improvement runs, suggestions, live directives | §3.9, [`IMPROVEMENT_LOOP.md`](./IMPROVEMENT_LOOP.md) |
| System | Einstellungen | `einstellungen` | 0 | E-mail designs, send configuration, Systemstatus | §3.10, [`EMAIL_DESIGNS.md`](./EMAIL_DESIGNS.md) |

Legacy keys `?tab=customers` and `?tab=marketing` still resolve to Kunden; an
unknown key falls back to the Übersicht. The registry (keys, labels, groups,
shortcuts, descriptions, URL builder) is the pure, unit-tested
[`src/lib/admin-tabs.mjs`](../src/lib/admin-tabs.mjs); the icons live in
[`src/app/admin/tabs.tsx`](../src/app/admin/tabs.tsx).

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

**Rate limit (2026-09):** password attempts are limited to **10 per 10 minutes
per IP** (Upstash bucket `admin-login` in
[`src/lib/rate-limit.ts`](../src/lib/rate-limit.ts)); over the limit the login
page shows „Zu viele Anmeldeversuche“. Without KV configured the limiter **fails
open** (and reports via `reportError`), so an infrastructure outage can never
lock the operator out.

---

## 2. Architecture

### 2.1 Rendering model — one screen per request

`/admin` is `force-dynamic`. Per request
[`page.tsx`](../src/app/admin/page.tsx) resolves `?tab=`, loads **only that
screen's data** on the server and renders the screen inside
[`AdminShell`](../src/app/admin/AdminShell.tsx). Switching screens is a soft
navigation via `next/link` (prefetched on hover; the shell shows a pending
indicator on the link) — a screen never pays for another screen's queries, and
the RSC payload is one screen, not ten. Each screen consists of a thin server
file (`<Screen>Tab.tsx`: queries → props) and a client workspace in its own
folder (`kunden/`, `kampagne/`, `kpi/`, …) that owns the interaction state and
calls the guarded `/api/admin/*` routes.

The client workspaces are exported through `next/dynamic` in
[`lazy.tsx`](../src/app/admin/lazy.tsx), so each screen's JavaScript is its
own chunk (server rendering stays on — nothing flashes). Recharts is loaded only
on KPIs ([`kpi/charts.tsx`](../src/app/admin/kpi/charts.tsx)). Measured on the
Übersicht: ≈ 159 KB gzip of JavaScript in total, ≈ 126 KB of which is the
Next/React framework (before the redesign: 344 KB on every tab).

The navigation badges (Kampagne queue size, unmatched inbox, open Wissen
questions) are three cheap COUNT queries in `page.tsx`, all fail-soft.

The shell: grouped sidebar (Arbeit · Einblicke · System) with full labels from
1280 px, an icon rail with tooltips on tablet widths and a slide-in drawer
below 1024 px; a slim top bar with the screen title, its explanation behind an
`InfoTip`, the shortcut sheet (Tastenkürzel), the light/dark toggle (stored in
a cookie, applied on the server so there is no flash) and logout. Keyboard:
digits `1…9`/`0` jump to the n-th screen, `/` focuses the Kunden search — both
ignored while typing or with a modifier held.

### 2.2 URL contract and deep links

Everything an operator can point a colleague at is in the URL:

| Screen | Parameters | Meaning |
| --- | --- | --- |
| all | `?tab=<key>` | screen (§ table above); legacy `customers`/`marketing` → Kunden |
| Kunden | `?filter=<preset>` | list preset, e.g. `no_purchase` (used by the Übersicht cards) |
| Kunden | `?customer=<id>` | open this customer (kept in sync while browsing) |
| KPIs | `?kpiRange=7d\|30d\|90d\|custom`, `?kpiFrom=`, `?kpiTo=` | period (validated + clamped by [`kpi-range.mjs`](../src/lib/kpi-range.mjs)) |
| KPIs | `?kpiFresh=<unix seconds>` | freshness floor for the Shopify cache — set by „Aktualisieren“ (§5.0) |
| Gespräche | `?gid=<conversationId>` | selected conversation (opened by id, also off the current page) |
| Gespräche | `g*` filter params (`gq` search, `gcat`, `gqual`, `gpage`, tier, error flag, range) | list filter, parsed by [`admin-conversation-filter.mjs`](../src/lib/admin-conversation-filter.mjs) |
| Analyse | `?report=<id>` | selected Komplettanalyse |
| Verbesserung | `?run=<id>` | selected improvement run |

Other screens link into these: „Im Gespräche-Tab öffnen“ in a customer's
consultation (`?tab=gespraeche&gid=…`), „Gespräch #n“ in a Wissen entry, the
„Heute“ cards of the Übersicht.

### 2.3 Files

```
src/app/admin/
├── page.tsx              # ?tab= → loaders → one screen (force-dynamic)
├── AdminShell.tsx        # sidebar, top bar, shortcuts, theme, logout
├── tabs.tsx / lazy.tsx   # icons per screen / per-screen client chunks
├── theme.css, theme-config.ts, ThemeToggle.tsx
├── login/page.tsx        # login form + server action (rate-limited)
├── <Screen>Tab.tsx       # server file per screen: queries → props
├── kunden/               # KundenWorkspace, CustomerDetail, tabs/{Profil,Beratungen,Kaeufe,Marketing,Korrespondenz,Brief}, BundleComposer, UnmatchedInboundQueue
├── kampagne/             # KampagneWorkspace, CampaignHeader, QueueRail, ReviewCard, sections/*, SentHistory, EmailViewerDialog, useCampaignActions
├── kpi/                  # KpiToolbar, KpiSection, groups, charts (Recharts via next/dynamic), sections/* (17)
├── gespraeche/           # ConversationFilters, StatsPanel, ConversationList, ConversationDetail, ReportPanel
├── wissen/               # WissenWorkspace, QaEntryEditor, ProductField, useQaQueue
├── feedback/, analytics/, verbesserung/, einstellungen/
├── HeroImagePanel.tsx, EmailPreviewButton.tsx, EmailPreviewFrame.tsx   # shared e-mail widgets
├── lib/                  # admin-fetch, use-async-action, use-step-loop, use-media-query
└── ui/                   # the primitives (§2.5)
```

Shared, pure logic sits in `src/lib/*.mjs` with `node --test` suites next to it
(`admin-tabs`, `admin-format`, `admin-datetime`, `admin-conversation-filter`,
`kpi-range`, `ttl-cache`, `retention-options`, …).

### 2.4 Client helpers (`src/app/admin/lib`)

| Helper | Use |
| --- | --- |
| `adminFetch(path, { body })` | the one way to call `/api/admin/*`: JSON in/out, throws `AdminApiError` (status, code, German message), redirects to the login on 401 and back afterwards. `friendlyErrorMessage()` turns network errors into „Netzwerkfehler — bitte erneut versuchen.“ |
| `useAsyncAction(fn, { onSuccess, errorToast })` | pending state + error toast for a button; prevents double submits. |
| `useConfirm()` | promise-based `ConfirmDialog` (title, description, confirm label, destructive tone) — used for sends, deletes and paid bulk runs only. |
| `useStepLoop({ path, body, onStep, isDone, isBusy, retry })` | drives the step-wise generators (Komplettanalyse, Verbesserungslauf): one bounded POST per step, retries network errors (60 × 5 s, „Verbindung wird wiederhergestellt“), pauses, stops on `AdminApiError`, polls while the server is busy, stops on unmount. |
| `useMediaQuery(query, ssrDefault)` | responsive behaviour without layout flashes (sidebar labels, SplitPane stacking). |

### 2.5 Design system

Calm, professional back office: one accent colour for interactive emphasis,
status colours only for status, neutral surfaces everywhere else. Controls
first, prose second — **every explanation lives behind an `InfoTip`**, never in
a helper paragraph. Dark mode is a token swap, never a component branch.

**Tokens** ([`theme.css`](../src/app/admin/theme.css), Tailwind v4 CSS-first, the
`.dark` class swaps the values): `background`, `foreground`, `card`, `popover`,
`primary`, `secondary`, `muted`, `accent`, `accent-soft` (selected rows, active
nav), `surface-2` (table heads, nested panels), `destructive`, `success`,
`warning`, `info`, `border`, `input`, `ring`, `sidebar`, `chart-1…5`, the brand
colours, `radius-sm/md/lg/xl` and the type scale `text-2xs` (11 px) … `text-2xl`
(26 px) with fixed line heights. Montserrat is self-hosted
(`fonts/montserrat-latin.woff2`). Numbers use `tabular-nums`. No component may
hard-code a colour or a pixel font size.

**Primitives** ([`ui/index.ts`](../src/app/admin/ui/index.ts) — shadcn-style
copies without Radix): `Button`, `IconButton` (label required), `Input`,
`SearchInput`, `Textarea`, `Label`, `Field` (label + control + InfoTip + error),
`Select`, `Checkbox`, `SegmentedControl`, `Badge`, `StatusBadge`, `Card*`,
`Skeleton`, `Spinner`, `ProgressBar`, `Table*`, `DataTable` (sortable, sticky
head, loading/empty rows), `Pagination`, `Tabs` (roving focus), `Dialog` (focus
trap + return), `ConfirmDialog`/`useConfirm`, `Sheet`, `Disclosure`, `toast`,
`Section`/`Stat`/`Caveat`, `InfoTip`/`Tooltip` (one positioning engine, portal
into `#admin-root`, hover/focus/tap, Esc closes), `Callout`, `EmptyState`,
`PageHeader`, `FilterBar`/`FilterChip`, `SplitPane` (master/detail, stacks on
tablet), `DescriptionList`, `TranscriptView` (shared by Gespräche and Kunden),
`Kbd`, `BarList`, `SidebarList`, `Markdown`, `CatalogProductPicker`.

Rules of thumb: explanations → `InfoTip`; states → `Callout`/`EmptyState`/
`StatusBadge` (toolbars always stay visible, even on an empty list); lists →
`DataTable` + `Pagination`; master/detail → `SplitPane`; single-choice toggles
→ `SegmentedControl`; confirmations → `useConfirm()`; API calls → `adminFetch()`.
Icon-only buttons carry an `aria-label`; tooltips are real tooltips, not
`title` attributes. Laptop first; tablet (icon rail, stacked panes) verified with
Playwright screenshots in light and dark.

### 2.6 Dates and numbers

Numbers go through [`src/lib/admin-format.mjs`](../src/lib/admin-format.mjs)
(`num`, `eur`, `eurFromCents`, `pct`, `ratio`, `hours`, `plural`,
`relativeTime`, `truncate` — unit-tested, `de-DE`); no file keeps its own
`toLocaleString` helper. Dates are the subject of the following rule.

`/admin` is `force-dynamic`: the active screen is rendered on the **server** and
the client components are then **hydrated** in the operator's browser. A
timezone-naive `new Date(iso).toLocaleString("de-DE")` resolves the timezone
from the host, and the two hosts do not agree:

| | `2026-08-31T22:40:00Z` |
| --- | --- |
| server (Vercel/Node, `TZ=UTC`) | `31.8.2026, 22:40:00` |
| browser (operator, `Europe/Berlin`) | `1.9.2026, 00:40:00` |

React compares the two strings, finds them different and throws a hydration
mismatch — the minified **“React error #418”** in the browser console — then
discards the server HTML and re-renders the subtree on the client. Note the
**date alone flips too**: any instant after 22:00 UTC already belongs to the
next day in Berlin, so date-only columns are just as unsafe as ones printing a
clock time.

The fix is to **pin** the timezone instead of inheriting it, exactly as
`shopify-discounts.ts` already does for customer-facing expiry dates. The shop
is operated from Germany, so `Europe/Berlin` is both the deterministic and the
correct answer — output in the operator's browser is unchanged, the server
simply catches up.

**Rule: no admin component formats a Date itself.** Everything goes through
[`src/lib/admin-datetime.mjs`](../src/lib/admin-datetime.mjs):

```ts
import { ADMIN_DATE_TIME_PADDED, formatAdmin } from "@/lib/admin-datetime.mjs";

formatAdmin(row.sentAt, ADMIN_DATE_TIME_PADDED); // "01.09.2026, 00:40"
formatAdmin(null, ADMIN_DATE_TIME_PADDED);       // "—"
```

`formatAdmin(value, preset?, fallback?)` accepts an ISO string, a `Date` or
epoch milliseconds, and renders `—` (or a caller-supplied fallback) for absent
or unparseable values. One preset per shape in use — `ADMIN_DATE`,
`ADMIN_DATE_PADDED`, `ADMIN_DATE_MEDIUM`, `ADMIN_DAY_MONTH`,
`ADMIN_DATE_TIME_PADDED`, `ADMIN_DATE_TIME_MEDIUM`, `ADMIN_DATE_TIME_SHORT`,
`ADMIN_TIME`, `ADMIN_DATE_TIME_FULL` — so two panels showing the same kind of
timestamp cannot drift apart.

This is enforced, not just documented: an ESLint `no-restricted-syntax` rule
scoped to `src/app/admin/**` fails the build on `toLocaleDateString`,
`toLocaleTimeString`, or `toLocaleString` called on a `new Date(...)`.
`toLocaleString` on a **number** stays allowed — number and currency formatting
was verified byte-identical between Node and Chromium (`1.234,56 €`, same
U+00A0), so it is not a hydration hazard.

The pinned zone itself lives in
[`src/lib/store-datetime.mjs`](../src/lib/store-datetime.mjs) as
`STORE_TIME_ZONE`, which `admin-datetime.mjs` re-exports — the back-office, the
customer-facing discount expiry dates and the AI prompt builders all read the
same constant, so they cannot drift onto different zones. That module also
carries `formatStoreDate(value, locale, fallback)` for the **server-only** side
(the prompt builders in `marketing-draft.ts`, `campaign-draft.ts`,
`customer-profile.ts`, `bundle-suggestion.ts`). Those never hydrate, so they
could not cause #418 — but they fed the model the UTC calendar day, which for
an order placed between 00:00 and 02:00 Berlin time is the *previous* day, and
the model then repeated that wrong date to the customer. Worst case observed:
an order at 00:10 on 1 January 2026 was described as `31.12.2025` — wrong day
and wrong year.

---

## 3. Screens

### 3.1 Übersicht

Read-only landing screen. **„Heute“** — what needs attention, each card a deep
link: Kampagne (Offen / Entwürfe / heute gesendet), Posteingang nicht zugeordnet,
offene Wissen-Fragen, laufende Analysen. Below it the headline numbers of the
**last 30 days** (Beratungen, E-Mails gesendet, Marketing-Kontakte, „Beraten,
nicht gekauft“, Ø Kosten / Beratung) and two activity lists („Zuletzt gesendet“,
„Zuletzt bestätigt (DOI)“). Every
number is a database aggregate
([`admin-overview-store`](../src/lib/admin-overview-store.ts), decision D-1):
„nicht gekauft“ uses the cached Shopify purchase history (refreshed by the daily
`refresh-customers` cron and „Käufe aktualisieren“), so opening this screen
never calls Shopify. The window is fixed; the period picker lives on KPIs.

### 3.2 Kampagne

The review queue of the campaign module — personalised e-mails to the shop's
**Shopify marketing subscribers**, a separate audience with its own consent
basis, tables, send path and legal gates (`CAMPAIGN_SENDS_APPROVED` master flag,
per-contact opt-in-level gate, send-time suppression re-check, cross-channel
frequency cap, `MK-` discount codes). The module is documented in
[`CAMPAIGNS.md`](./CAMPAIGNS.md); the screen:

- **Stat strip + toolbar.** Counts as chips (queue, drafted, sent today, skipped,
  hero A/B split), then Sync, Rabatt, Textmodus, „Nächste 50 vorbereiten“ (inline
  progress bar with cancel; results applied without a page reload) and an
  overflow menu holding the rare, destructive „Warteschlange neu aufbauen“.
- **Warteschlange.** One contact at a time: the review card shows contact, an
  inline „Text · Vorschau“ switch (rendered preview in place, full-size dialog
  still available), the hero-image panel and collapsible groups with summaries
  in their headers (Kaufhistorie, Empfehlungen, Rabatt, Set-Angebot). Keyboard:
  `N`/`P` next/previous, `V` preview, `C` copy, `S` send (only when allowed),
  `X` skip.
- **Gesendet.** Paged, searchable history (e-mail/subject, date range) with the
  delivery state from the Resend webhook (delivered / bounced / complained),
  redemption looked up in Shopify **for the visible page only**, and a viewer for
  the retained content of a send.
- **Übersprungen** with „Wieder aufnehmen“.

State and the twelve mutations live in
[`kampagne/useCampaignActions.ts`](../src/app/admin/kampagne/useCampaignActions.ts);
the send itself is `POST /api/admin/campaign/send` → `approveAndSendCampaign`,
unchanged by the redesign and covered by its tests.

### 3.3 Kunden

Groups everything by **customer** (e-mail), not by session
([`CUSTOMERS.md`](./CUSTOMERS.md)). The left rail is a **slim list** of every
customer (name, e-mail, tier badge with InfoTip, flags, last seen) that is
searched, filtered and sorted client-side — no cap, no hidden rows. A person's
full detail is loaded **on demand** (`GET /api/admin/customers/detail?id=`) into
six sub-tabs:

| Sub-tab | Content | Routes |
| --- | --- | --- |
| Profil | identity, tiers, consent state, the cached „Kundenverständnis“ (regenerate on demand, cost shown) | `customers/profile` |
| Beratungen | the customer's conversations with the shared `TranscriptView` and „Im Gespräche-Tab öffnen“ | — |
| Käufe | cached Shopify purchase history, „Käufe aktualisieren“ | `customers/purchases` |
| Marketing | the personalised marketing e-mail: settings row (Hinweise, Rabatt, Textmodus), editor, preview, approve & send with a confirm that shows recipient, subject and discount; the **Set-Angebot** composer as a side panel | §4, `customers/marketing-draft`, `marketing/*`, `bundles/*`, `catalog/search`, `email-hero/*` |
| Korrespondenz | sent + received mail threads (lazy body), reply composer with preview | `correspondence/*` |
| Brief | physical letter: AI draft, preview, „Brief senden“ (gated by `PHYSICAL_MAIL_SENDS_APPROVED`) | `customers/letter-draft`, `customers/letter-preview`, `physical/send` |

Above the list: the **bulk-draft bar** (queue reviewable marketing drafts for
many DOI-confirmed customers at once — nothing is sent) and the **Posteingang**
(unmatched inbound mail; assign to a customer via `correspondence/assign`). The
sidebar badge shows the unmatched count. Address auto-capture for letters runs
in the daily `refresh-customers` cron, not on page views.

### 3.4 Wissen

The review queue that turns "Mo konnte nicht helfen" conversations into
published Q&A: an explicit "Gespräche scannen" click drafts
{ Wissenslücke, präzise Frage, Produkt? } from eligible conversations
(analysis quality `unmet_need`/`dropped_off` or a `show_contact_form`
hand-over); the operator answers and publishes. Product-linked pairs are
written to the Shopify `custom.qa` metafield (storefront PDP Q&A tab + Mo's
product context, with an immediate targeted catalog refresh); general pairs
enter Mo's system-prompt knowledge base. Full flow, files, Shopify
prerequisites (write_products scope, `custom.qa` metafield definition) and
cost notes: see docs/QA_KNOWLEDGE.md.

The screen is a compact queue: status tabs with counts (offen / beantwortet /
veröffentlicht / verworfen), a search box, one row per entry (status, question,
product, age) that **expands in place** into the editor (Frage, Produkt via
`CatalogProductPicker`, Antwort, English override, link to the source
conversation); `j`/`k` move, `Esc` collapses. „Gespräche scannen“ runs the gap
scan in batches of 10 with a progress line.

### 3.5 KPIs

A sticky toolbar (in-page group navigation Beratung · Marketing & Kampagne ·
Umsatz · Kosten · Gesamtwerte with scroll-spy, the period presets 7 / 30 / 90
days or „Zeitraum…“, and „Shopify-Daten: Stand hh:mm · Aktualisieren“) over
17 sections, each keeping its honesty caveat verbatim behind the (i) next to
its title. Definitions, caveats and the cache: **§5**.

### 3.6 Gespräche

A read-only inspector over ALL conversations (every tier, NOT grouped by
person) for understanding how users interact with Mo and refining it. Three
layers, the first two costing zero tokens. Code:
[`src/lib/admin-conversations.ts`](../src/lib/admin-conversations.ts),
[`src/lib/conversation-analysis.ts`](../src/lib/conversation-analysis.ts),
[`src/lib/conversation-insights.ts`](../src/lib/conversation-insights.ts),
[`src/app/admin/gespraeche/`](../src/app/admin/gespraeche/). The list and its
total come from **one** query (`count(*) OVER ()`), so filter and count can
never drift apart; the filter state is URL state (§2.2) and the selected
conversation is `?gid=`.

#### Part 1 — list + transcript (pure DB, ZERO tokens)

A paginated (25/page), newest-first list with, per row: created/updated
timestamps, readable message count, **tier** (anonymous / email-only / signed-in —
the label only, NEVER an identity), persona label, the cached analysis
category/quality if present, and outcome signals derived from existing data:

| Signal | Source | Notes |
| --- | --- | --- |
| tools fired | distinct `messages.tool_name` | reliable |
| checkout offered | `conversations.selected_product_ids` non-empty | `add_to_cart` fired |
| cart link used | `kpi_events` `%cart%`/`%checkout%` by session | session-grained |
| email captured | `email_captures` EXISTS by session | session-grained |
| "keine Antwort" (error proxy) | user turn present, zero assistant turns | see below |

Filter by **date range** (reuses the KPI range resolver), **tier**,
**"nur ohne Bot-Antwort"**, and — over the cached analysis columns — by
**Kategorie** and **Qualität** (`gcat`/`gqual`; only analysed conversations can
match). A **free-text search** (`gq`) finds a conversation by anything stored
for it: message contents (incl. tool payloads/names), conversation id/key,
session id, persona label, the cached analysis
(summary/category/quality/tags), or the linked customer's email / Shopify
customer id (match-only — identity values are never selected or displayed).
Terms are whitespace-split and AND-ed (each must match somewhere,
case-insensitive substring), and an active search deliberately **bypasses the
date window** — "find that chat" works across the whole history. The predicate
is fully parameterized SQL (`unnest` + `bool_and` over escaped `%term%`
patterns); the other filters (tier, category, …) still combine with it. The category/quality distribution bars in the insights panel are
clickable and apply the same filters, so "show me ALL dropped-off chats in this
window" is a deterministic one-click query, complete by construction (unlike the
model-curated section references). Analysed rows show their cached one-line
summary directly in the list as the per-chat explanation. Clicking a row opens
the readable **transcript**
(Kunde/Berater turns + timestamps, bot markdown rendered like the chat) — reusing
the same readable-turn filter as the session/account transcript views
(`tool_name IS NULL AND role IN ('user','assistant')`, applied in SQL).

No model call. Tier is derived from `customer_id`/`shopify_customer_id` joins as
booleans only — no email or identity value is ever selected (guardrail).

> **"An error occurred" is not in the DB.** Runtime errors go to Sentry/logs
> ([`lib/observability.ts`](../src/lib/observability.ts)), not to a
> conversation/session row. The inspector therefore surfaces the closest
> DB-derivable proxy — a conversation where the user wrote but Mo never replied —
> and labels it "keine Antwort". A precise signal would need a fail-silent
> `chat_error` `kpi_events` row in the chat path (out of scope here: read-only).

#### Part 2 — on-demand, CACHED per-conversation analysis (Haiku)

The **Analysieren** button runs ONE pass over the readable transcript and caches a
short summary + category + tags + quality signal **on the conversation row**
(migration 0031: `analysis_summary` … `analysis_updated_at`). Re-opening shows the
cache for FREE; re-analysing is the deliberate "Neu analysieren" button — never on
list load. Modelled on the per-customer "Kundenverständnis generieren" flow. A
confirmed **bulk action** analyses up to `BULK_ANALYZE_LIMIT` un-analysed
conversations per run, showing the estimated cost (N × cheap-model cost) before
confirming and the remaining count after.

#### Part 3 — aggregate insights rollup (the refinement engine)

The **Insights generieren** button summarises the already-CACHED per-conversation
summaries + categories (NOT raw transcripts — that is what makes it cheap and
scalable) into a Markdown report for the window: top themes, where consultations
stall, unmet needs, and concrete "consider refining X" suggestions. Cached by date
range (`conversation_insights`). A free SQL `GROUP BY` over the cached
categories/qualities renders the distribution alongside it.

**Verlinkte Gespräche (references).** Each rollup also carries per-section
conversation references: the model sees each summary prefixed with its real
conversation ID (`[#1234] …`). References are produced by a **dedicated second
model pass** (JSON-only output, same cheap model, same summaries + the finished
report as input) mapping the four report sections (`top_themen`, `stockend`,
`beduerfnisse`, `vorschlaege`) to the conversations that back them, each with a
one-sentence German reason — a separate pass because appending a refs block to
the report itself proved fragile (a long report truncates the block away). Any
` ```json:refs ` block the report pass still emits is stripped server-side
before saving (it never renders) and used as a fallback. Both payloads are
parsed defensively (`parseInsightsReferences` / `parseInsightsRefsPayload` in
[`lib/conversation-analysis-core.mjs`](../src/lib/conversation-analysis-core.mjs)):

- **Validation rule (anti-hallucination):** a reference survives only if its
  `conversationId` is in the set of IDs actually loaded for that rollup, its
  section is one of the four keys, the reason is trimmed/capped (~200 chars), and
  at most 8 references per section are kept — the refs are CURATED evidence for
  the report's findings; complete "all chats for X" listings are the
  category/quality list filters' job. Hallucinated or out-of-window IDs never
  reach the DB or UI. A malformed block costs the references, never the
  narrative (`references_json = []`).
- **Scope:** only ANALYZED conversations can be referenced — the rollup reads
  cached summaries, so un-analyzed conversations in the window are invisible to
  it. Run the bulk action until the window is fully analyzed for full coverage.

References are stored in `conversation_insights.references_json` (migration
0033, nullable) and rendered below the report as one collapsible per section
(„Beleg-Gespräche (n)"); clicking „Gespräch #1234 öffnen" opens that
conversation in the detail panel (fetch-by-ID, so it works even off the current
list page; a since-erased conversation shows the normal error message). Old
cached rollups without references render unchanged, with a hint to regenerate.

**Layout:** the tab is ordered around the master–detail grid: filters → compact
stats/distribution card (clickable filter bars directly above the list they
filter) → conversation list + detail → the report card last, COLLAPSED by
default (meta line + „Report anzeigen"), auto-expanded after a fresh
generation — so the long narrative never pushes the work area off screen.

> **Deliberate boundary (out of scope):** the system NEVER rewrites Mo's prompt or
> behaviour automatically. Mo gives legally + product-sensitive advice; refinement
> stays **human-in-the-loop** — the insights inform a human who decides any prompt
> change. Every report carries this note in its footer.

#### Model + cost + retention

Both AI passes use **Claude Haiku 4.5** (`claude-haiku-4-5`, $1/$5 per MTok in/out
— priced in [`lib/ai-pricing.mjs`](../src/lib/ai-pricing.mjs)), not the
consultation model. Usage is recorded in `ai_usage` (`conversation_analysis`
carries the conversation FK → cascade-deletes with it; `conversation_insights` is
dashboard-side, no FK). The approximate EUR cost is shown per analysis, per rollup
and per bulk run. The per-conversation analysis lives on the conversation row, so
it is dropped automatically when the conversation is deleted (retention) or erased
— same lifecycle as `title`/`title_auto`; its `ai_usage` rows cascade via the FK.
The rollup cache is derived, pseudonymous text (no session/email), regenerated on
demand like `kpi_persona_question_summaries`.

### 3.7 Feedback

Widget and newsletter feedback, newest first: a `FilterBar` (search over text
and page, tier filter, sort), one card per entry (they carry free text),
newsletter ratings (`page = email:<kind>`) with their own badge. Read-only; the
list keeps its toolbar on an empty result.

### 3.8 Analyse

Stored **Komplettanalysen** per interval: a `SidebarList` of reports on the
left, the generator or the selected report on the right. The generator shows a
live, zero-token estimate (`analytics/estimate`) for the chosen range and
options (per-customer section, appendix), creates the report
(`analytics/create`) and drives it step by step (`analytics/step`) via
`useStepLoop` with a progress bar; finished reports render their sections and
can be downloaded as PDF (`analytics/<id>/pdf`) or deleted (confirm). Deep link
`?report=<id>`.

### 3.9 Verbesserung

Mo reads a **completed Komplettanalyse** together with his own current
configuration (the rendered system prompt, tools, personas, knowledge and team
directives — hashed as a prompt version) and produces evidence-based
improvement suggestions in two lanes: the **online store** and **Mo himself**.
Suggestions carry an operator lifecycle (open → accepted → implemented /
dismissed); every new run first runs an honest **Wirkungs-Check** — did the
previously decided measures move the comparable KPI rates? — which is what
closes the loop. `mo`-lane suggestions of category `anweisung` ship a
ready-made directive text the operator can adopt with one click into the
**live, versioned team-directive layer** of the system prompt (bounded, cached
like the Q&A knowledge block, full append-only history; the core prompt stays
in git). The Gespräche boundary is unchanged: nothing is ever applied
automatically — the engine only proposes. Full design, tables (migration
0044), routes and honesty rules: see [`IMPROVEMENT_LOOP.md`](./IMPROVEMENT_LOOP.md).

Screen: „Neuer Verbesserungslauf“ (pick a completed Komplettanalyse →
`improve/run`, stepped via `improve/step`), the run list, the run view (baseline
vs. delta table, Wirkungs-Check, suggestion cards with „Übernehmen“ /
„Erledigt“ / „Verwerfen“ + note / „Wieder öffnen“), **Anweisungen an Mo**
(create, edit, toggle, version history — `directives/*`) and Mo's self-snapshot
(rendered prompt + version hash). Deep link `?run=<id>`.

### 3.10 Einstellungen

The e-mail design library (the registered code designs with **one** „Vorschau“
per design — the e-mail type is switched inside the dialog), the per-type design
assignment (`email-designs/assign`; `null`/`classic` clears), the read-only send
configuration (sender, inbound address, logo override) and the **Systemstatus**
card (decision D-5): DB, Shopify, Resend send + webhook, Pingen, Anthropic and
OpenAI keys, and the three legal gates — shown only as configured / not
configured, never a value. Details: [`EMAIL_DESIGNS.md`](./EMAIL_DESIGNS.md).

---

## 4. Marketing e-mails from the Kunden screen

Personalised marketing e-mails to **DOI-confirmed chat contacts** (`MS5-` codes)
are drafted, edited and approved in the Marketing sub-tab of a customer. All
actions are `/api/admin/*` POSTs (proxy- and `guardAdminPost`-gated).

### 4.1 Discount input — chosen BEFORE generating

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

### 4.2 The per-customer draft — full context + admin special instructions

`POST /api/admin/customers/marketing-draft { customerId, discountPercent,
adminInstructions?, regenerate?, textMode? }` is the only draft path (the former
per-capture draft route was removed in 2026-09 as unused).

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

### 4.3 What the send path guarantees

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

#### Why no send can reach a non-confirmed or suppressed address

- The Marketing sub-tab and the bulk-draft bar only ever offer drafting for
  **eligible** contacts.
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

## 5. KPI definitions

Every number is read **only** from the pseudonymous analytics cluster
(`conversations`, `messages`, `kpi_events`, `ai_usage`), except the revenue KPI,
the campaign funnel, the marketing funnel and the recommendation→purchase loop,
which additionally read Shopify orders. Each KPI carries its caveat verbatim in
the UI (behind the (i) of its section).

### 5.0 Period, toolbar and the Shopify cache — [`lib/kpi-range.mjs`](../src/lib/kpi-range.mjs), [`kpi/KpiToolbar.tsx`](../src/app/admin/kpi/KpiToolbar.tsx), [`lib/kpi-cache.ts`](../src/lib/kpi-cache.ts)

The toolbar offers the presets **7 / 30 / 90 days** and a **custom** from/to.
The chosen window lives in the URL (`?kpiRange=7d|30d|90d|custom` plus
`?kpiFrom=&kpiTo=`) so a refresh or a copied link keeps it;
[`resolveKpiRange()`](../src/lib/kpi-range.mjs) validates + clamps it (UTC,
reversed pairs swapped, future end → today, span ≤ 366 days, anything invalid →
default 30d) into a safe `[from, to]` that the **indexed** range queries consume
directly. The toolbar is a small client island that only rewrites the URL; the
KPI screen stays a server component and re-renders for the new window.

**Shopify cache (decision D-4).** The four Shopify-dependent blocks — revenue
(§5.5), campaign funnel (§5.9), marketing funnel (§5.4), recommendation loop
(§5.3) — are computed once per range and served from a **10-minute server
cache** (`kpi-cache.ts` over the pure, tested `ttl-cache.mjs`; in-flight
requests are de-duplicated). The toolbar shows „Shopify-Daten: Stand hh:mm“;
„Aktualisieren“ navigates with `?kpiFresh=<unix seconds>`, a **freshness floor**
(„not older than this“) rather than a cache wipe, so it works across serverless
instances. All pure-DB sections are live.

**The period filters every section outside the „Gesamtwerte“ group:**

| Filtered by the period | Period-independent (lifetime / cohort) |
| --- | --- |
| **Core metrics** (§5.1) — `conversations` / `kpi_events` on `created_at` | Persona-insights (§5.2) |
| **Consent-Gate-Funnel** (§5.7) — `kpi_events` on `created_at` | Recommendation → purchase loop (§5.3) |
| **E-Mail-Capture-Funnel** (§5.8) — `kpi_events` on `created_at` | Marketing funnel (§5.4), Postversand |
| **Umsatz über Mo-Rabatt­codes** (§5.5) — order `created_at` | |
| **Kampagnen-Funnel** (§5.9) — `campaign_sends` on `sent_at` | |
| **Bundle-Angebote** (§5.10) — `bundle_offers` / clicks on `created_at` | |
| **Wissen-KPIs** (§5.11) — `qa_entries` on `created_at`/`published_at` | |
| **Feedback** (§5.12) — `feedback` on `created_at` | |
| **Gesprächsqualität** (§5.13) — `conversations` on `created_at` | |
| **Sprachen DE/EN** (§5.14) — `conversations`/`email_captures` on `created_at` | |
| **Kundenkonto & Self-Service** (§5.15) — `kpi_events`/`ai_usage` on `created_at` | |
| **KI-Kosten** (§5.6) — `ai_usage` on `created_at` | |
| **Mo-zugeordneter Umsatz** (§5.16) — `mo_orders` on order date | |

The lifetime sections sit in the „Gesamtwerte“ group of the toolbar navigation,
each badged „Gesamt“, so an operator always knows which figures the period
applies to. The Übersicht is a fixed trailing-30-day snapshot and has no picker.

### 5.1 Core metrics — [`lib/kpi-store.ts`](../src/lib/kpi-store.ts)

All core metrics are scoped to the **selected window** (`created_at >= from AND
created_at < to+1`), served by the `conversations`/`kpi_events` `created_at`
indexes (migrations 0001 + 0027).

| KPI | Definition | Caveats |
| --- | --- | --- |
| **Chats gesamt** | `count(conversations)` in the window. One row exists per chat that sent ≥1 message. | Scoped to the picked period (default last 30d). |
| **Chats pro Tag** | New conversations grouped by `date(created_at)` across the window, gap-filled with 0. | — |
| **Ø Nachrichten / Chat** | `avg(conversations.message_count)`. | Counts user + assistant + tool-marker turns. |
| **Abgebrochen** | `count(status='abandoned')` and its share of all chats. | `status` is flipped to `abandoned` lazily by the retention cron after `ABANDON_AFTER_MINUTES` idle — not real-time. |
| **Konvertiert** (status split) | `status='converted'`, set by the daily **conversion sweep** ([`lib/conversion-sweep.ts`](../src/lib/conversion-sweep.ts), runs with the retention cron): the unique `MS5-` code of the marketing email drafted from this conversation was redeemed in a real order (`wasDiscountCodeRedeemed`), bookkept via `marketing_sends.shopify_order_matched`. Attributed to the session's most-recently-active thread as of the send. | A **lower bound**: purchases without a Mo code are unattributable (same honesty rule as §5.5) and never flip a conversation. Campaign (MK-) sends carry no session and can't convert a conversation. Bounded to `CONVERSION_SWEEP_MAX_CODES` (default 25) checks/run; unmatched codes retry while their discount is still redeemable. |
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
| **Eingelöst (converted)** | The send's **unique single-use** code was redeemed in a real order. Reuses `read_orders` via [`wasDiscountCodeRedeemed()`](../src/lib/shopify-orders.ts) (`orders(query: 'discount_code:"…"')`). Capped at the **100 newest** coded sends to bound Shopify calls; codes where Shopify can't answer are "unknown", never counted as "not redeemed". The **rate** divides by the checked codes with a definite answer (`codesChecked − redemptionUnknown`) — **never** by the uncapped `sent`, which would systematically under-report once more than the cap exist (uncoded sends can't convert at all). |

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
per-model token counts. Scoped to the **selected window** via the
`ai_usage.created_at` index (migration 0012); the Übersicht tab still reads it
all-time. Two additional breakdowns:

- **Nach Einsatzort** — EUR per `call_site` (all 15 sites, largest first), so the
  operator sees exactly which feature spends what instead of only the binary
  chat/admin split. TTS unit caveat is stated in the UI: for `call_site='tts'`
  the `input_tokens` column carries **characters**, not tokens.
- **Prompt-Caching (Chat)** — cache **hit rate** (`cache_read_tokens ÷ total chat
  input tokens`) and the **net EUR saving** vs. the same calls without caching
  (read discount 0.9× minus write premium 0.25×, pure + unit-tested in
  [`usdCacheSavingsForUsage()`](../src/lib/ai-pricing.mjs)). Can be negative for
  a write-heavy pattern — reported honestly. See
  [`PROMPT_CACHING.md`](./PROMPT_CACHING.md).

### 5.7 Consent-Gate-Funnel — [`getConsentGateFunnel()`](../src/lib/kpi-store.ts)

The v4 button-consent marketing surfaces (the in-chat **consent gate** and the
**at-sign-in opt-in card**) measured as **angezeigt → akzeptiert**, with the
decline/dismiss split and a per-surface breakdown (`chat` vs `signin`). Built
from the four **widget-emitted** `kpi_events` (`consent_gate_shown` /
`_accepted` / `_declined` / `_dismissed`, each carrying
`data.surface`) — see [`API_CONTRACT.md`](./API_CONTRACT.md) §5. Scoped to the
selected window (`kpi_events.created_at`).

> ⚠️ **Measures the UI, not the DOI.** An "Akzeptiert" is the gate tap; the
> consent only becomes an effective marketing subscription after the
> double-opt-in link is clicked (that outcome is the email-capture funnel in
> the event breakdown: `email_capture_marketing_opted_in` with
> `trigger: chat_gate|signin_optin` → `email_capture_marketing_confirmed`).
> Events without a `surface` payload count in the totals but in neither
> surface split. The retired `starter_shown` / `starter_clicked` widget events
> are no longer aggregated anywhere (raw breakdown only).

### 5.8 E-Mail-Capture-Funnel — [`getEmailCaptureFunnel()`](../src/lib/kpi-store.ts)

The five canonical capture events ([`lib/kpi-events.ts`](../src/lib/kpi-events.ts))
rendered as a dedicated funnel: **angeboten → Formular gesendet → Marketing-Haken →
DOI bestätigt**, plus the widget-reported declines and an **asks-by-trigger** split
(the `offer_email_summary` trigger enum). Windowed on `kpi_events.created_at`.

> ⚠️ Event counting, not per-session chaining: a DOI click confirming yesterday's
> opt-in counts in the window of the click. Stated in the UI caveat.

### 5.9 Kampagnen-Funnel — [`getCampaignKpis()`](../src/lib/campaign-store.ts)

The MK- channel (Shopify marketing subscribers, see
[`CAMPAIGNS.md`](./CAMPAIGNS.md)) as **gesendet → geklickt → eingelöst**, windowed
on `campaign_sends.sent_at`:

- **Geklickt** — campaign emails' main CTA (the Mo-promo deep link) routes through
  the tracked redirect since migration **0041** (`campaign_sends.redirect_token` /
  `clicked_at`, `campaign_email_clicked` kpi_event — §10). The click-rate base is
  the **tracked** sends only: copy-path sends and sends from before 0041 carry no
  link and can never count as clicked.
- **Eingelöst** — per-send `wasDiscountCodeRedeemed()` over the windowed MK-
  codes, capped at the 100 newest (`CAMPAIGN_KPI_MAX_CODES`); the rate divides by
  the checked codes with an answer, mirroring §5.4.
- **Sprache** — sends by the recipient contact's *effective* language
  (`language_override ?? language`); purged contacts land in "unbekannt".

### 5.10 Bundle-Angebote — [`getBundleKpis()`](../src/lib/bundle-offers-store.ts)

Offers **created** in the window by lifecycle status, the current live count
(`activeNow`, period-independent by nature), clicks on the tracked offer link
(`bundle_offer_clicked` events + distinct offers clicked) and the average
discount depth vs. the true component sum. **Purchases are deliberately NOT
attributed** — no order↔offer signal is stored (same honesty rule as §5.5).

### 5.11 Wissen-KPIs — [`getQaKpis()`](../src/lib/qa-store.ts)

Knowledge-loop throughput: lifetime queue state (open / answered / published /
dismissed — the Wissen tab's own numbers), **gaps found** and **published** inside
the window, the **median hours** from draft→answer and draft→publish (over entries
answered/published in the window), and the current **scan backlog**
(`countScanCandidates()` — eligible, not-yet-scanned conversations). Whether Mo
actually *used* a published answer is not measurable and not claimed.

### 5.12 Feedback — [`getFeedbackKpis()`](../src/lib/feedback-store.ts)

Windowed volume over the `feedback` table: total, with-conversation share,
with-email share ("answerable"), and the tier split (widget self-reported,
telemetry-grade). Counts only — never the message text or email value; content
stays in the Feedback tab.

### 5.13 Gesprächsqualität — [`getConversationStats()`](../src/lib/admin-conversations.ts)

The Gespräche inspector's cached analysis columns surfaced as KPIs for the
window: **analysis coverage** (analysed ÷ total — the representativeness of
everything below), the **quality distribution** (handled_well / unmet_need /
dropped_off / …) and the **top categories**. Reuses the exact same range-scoped
getter the Gespräche tab calls — one definition, two surfaces. Distributions
cover only operator-analysed conversations (analysis is on-demand).

### 5.14 Sprachen (DE/EN) — [`getLocaleSplit()`](../src/lib/kpi-store.ts)

Chats by `conversations.locale` (stamped by `persistTurn` since migration
**0041**, latest turn wins; older rows show as "Unbekannt") and captures by
`email_captures.locale` (migration 0030). The capture query is a pure locale
GROUP BY — no identity value is read.

### 5.15 Kundenkonto & Self-Service — [`getAccountActivity()`](../src/lib/kpi-store.ts)

Adoption + GDPR self-service volume, windowed: completed **sign-ins**
(`account_signin_succeeded`, with the `prompt=none` silent-detect share),
**data exports** (`account_export_requested`), **erasures** (`account_erased`),
**contact-form submissions** (`contact_form_submitted` — comparable against the
`show_contact_form` tool-fires in the Gespräche tab), and summary deliveries
(`summary_email` / `summary_download` rows in `ai_usage` — one row per generated
summary). All pseudonymous counters; export/erase events carry no session or
customer key at all.

### 5.16 Mo-zugeordneter Umsatz (Bestell-Webhook) — [`getMoAttributionKpis()`](../src/lib/mo-orders-store.ts)

The tiered order-attribution KPI (design: [`ORDER_ATTRIBUTION.md`](./ORDER_ATTRIBUTION.md)):
orders/create + orders/paid webhooks push every order carrying a **Mo marker**
(the opaque cart attribute `attributes[_mo]` from Mo-built cart links or the
widget's live-cart stamp, and/or an MS5-/MK- code) into `mo_orders`
(migration **0042**). The section is a plain DB aggregate — **no Shopify
calls, no caps, no sampling** — split into three honest tiers:

| Tier | Definition |
| --- | --- |
| **Direkt** | Mo code redeemed, or the order came through a Mo-built cart link (summary/marketing e-mail, bundle). |
| **Beraten & gekauft** | Widget cart stamp + ≥1 purchased line was discussed/selected in that session (catches manual search-bar purchases). |
| **Beraten, anderes gekauft** | Cart stamp present, no product overlap. |

Only realised money counts (PAID/PARTIALLY_REFUNDED — `kpi-revenue-core`
policy); unpaid ingested orders are disclosed separately. Unmarked orders are
never stored; ingestion starts at webhook registration (not retroactive), and
the section shows an explicit empty state until the first delivery. The
attribution window (`MO_ATTRIBUTION_WINDOW_DAYS`, default 30 days) and the
cross-device blind spot are stated in the UI caveat. §5.5's code-only revenue
KPI deliberately stays separate (exact definition preserved); orders can
appear in both when a coded order also carries the cart marker.

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

Later migrations that back the screens: `0031`/`0033` (conversation analysis +
insight references), `0041` (locale + campaign click tracking), `0042`
(`mo_orders`), `0044` (improvement loop), `0049` (e-mail design selections),
`0050`–`0055` (hero images, campaign segments, send snapshot, delivery state),
`0056` (indexes for the retention sweeps). The full schema map is in
[`DATABASE.md`](./DATABASE.md); migrations are forward-only and run manually by
the maintainer.

---

## 8. Operator checklist

1. Set `ADMIN_PASSWORD` + `ADMIN_SESSION_SECRET` (and the usual DB / Resend /
   Shopify / `UNSUBSCRIBE_SECRET` env — see [`.env.example`](../.env.example)).
2. `npm run db:migrate`.
3. Visit `/admin`, log in. Einstellungen → Systemstatus shows which
   integrations and gates are active.
4. For a „beraten, nicht gekauft“ customer: Kunden → the person → **Marketing**
   → pick a discount depth → **Entwurf generieren** → edit → **Freigeben &
   senden**.

---

## 9. End-to-end discount test (verify a real, working code)

Use this to confirm — on your own email — that a working, single-use Shopify code
is actually created and applied.

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

---

## 11. Admin API routes

All under `/api/admin/*`, gated by the Edge proxy **and** `guardAdminPost(req)` /
`guardAdminGet()` in the handler (§1); JSON envelope `{ error: { code, message } }`
on failure. Grouped by the screen that calls them.

| Screen | Route | Purpose |
| --- | --- | --- |
| Kampagne | `POST campaign/sync` | pull Shopify marketing subscribers into `campaign_contacts` (batched upsert) |
| | `POST campaign/prepare { count, discountPercent, textMode? }` | draft the next *n* pending contacts |
| | `POST campaign/draft { contactId, … }` | (re)generate one draft |
| | `POST campaign/update / discount / recommendations / language` | edit text, discount depth, recommended products, language pin of a draft |
| | `POST campaign/email-preview` | render the on-screen draft as text/html |
| | `POST campaign/send { contactId }` | approve & send through the system (`approveAndSendCampaign`) |
| | `POST campaign/skip / unskip / mark-done` | review decisions; `mark-done` closes the copy workflow |
| | `POST campaign/reset-queue` | rebuild the review queue (destructive, behind confirm) |
| | `POST campaign/contacts { query }` | global contact search |
| | `GET campaign/history?q=&from=&to=&page=&pageSize=` | paged „Gesendet“ view with delivery + redemption state |
| | `POST campaign/sent-email { sendId }` | retained content of one send |
| Kunden | `GET customers/detail?id=` | one customer's full detail (on open) |
| | `POST customers/profile / purchases` | regenerate „Kundenverständnis“ / refresh cached Shopify data |
| | `POST customers/marketing-draft` | per-customer marketing draft (§4.2) |
| | `POST marketing/update / email-preview / send / delete` | edit, preview, approve & send (`approveAndSend`), delete an unsent draft |
| | `POST bundles/suggest / create / archive / delete` | Set-Angebot composer |
| | `POST catalog/search { query }` | product search for the composer and pickers |
| | `POST correspondence/send / message / assign / email-preview` | reply, lazy body, assign unmatched inbound, preview |
| | `POST customers/letter-draft / letter-preview`, `POST physical/send` | physical letter |
| | `GET email-hero`, `POST email-hero/suggest / generate / headline / remove` | hero image of a marketing or campaign draft |
| Wissen | `GET qa/list?status=`, `POST qa/scan / answer / publish / unpublish / dismiss / restore` | the Q&A queue |
| KPIs | `POST kpi/top-questions { personaLabel, force? }` | on-demand Top-Fragen summary |
| Gespräche | `POST conversations/detail / analyze / analyze-bulk / insights` | transcript, cached analysis, confirmed bulk analysis, insights rollup |
| Analyse | `GET analytics`, `GET analytics/<id>`, `GET analytics/<id>/pdf`, `POST analytics/estimate / create / step / delete` | Komplettanalysen |
| Verbesserung | `GET improve`, `GET improve/<id>`, `POST improve/run / step / suggestion / adopt / delete` | improvement runs |
| | `POST directives/save / toggle`, `GET directives/versions?id=` | Mo's live directives |
| Einstellungen | `POST email-designs/preview / assign` | design preview and per-type assignment |

Removed in 2026-09 as unused: `GET directives`, `GET email-designs`,
`POST bundles/list`, `POST marketing/draft` (per-capture draft),
`POST qa/draft`.
