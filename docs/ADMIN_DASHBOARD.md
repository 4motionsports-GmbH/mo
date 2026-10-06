# Admin dashboard (`/admin`)

The German back office of Mo: one shared admin login, ten screens in a grouped
sidebar, and a send path that concentrates every legal guarantee in one place.
The operator reviews and approves — the **system** sends (nobody copies text
into a personal mail client).

| Group | Screen | `?tab=` | Key | What it is | Detail |
| --- | --- | --- | --- | --- | --- |
| Arbeit | Eingang | `eingang` (bare `/admin`) | 1 | The operator inbox: ranked customer signals with AI suggestions, system strip, unassigned mail | §3.1 |
| Arbeit | Kampagnen | `kampagne` | 2 | All campaigns (overview, editor) and the review desk per campaign, incl. the Einzelansprache | §3.2, [`CAMPAIGNS.md`](./CAMPAIGNS.md) |
| Arbeit | Kunden | `kunden` | 3 | The whole customer base (Shopify mirror + Mo leads), server-side list; one person's figures, activity, orders, chats, consent, correspondence, letter | §3.3, [`CUSTOMERS.md`](./CUSTOMERS.md) |
| Arbeit | Wissen | `wissen` | 4 | Q&A knowledge queue (gaps → answers → published) | §3.4, [`QA_KNOWLEDGE.md`](./QA_KNOWLEDGE.md) |
| Einblicke | KPIs | `kpi` | 5 | Pseudonymous analytics + Shopify revenue per period | §3.5, §5 |
| Einblicke | Gespräche | `gespraeche` | 6 | Conversation inspector with cached AI analysis and insights | §3.6 |
| Einblicke | Feedback | `feedback` | 7 | Widget and newsletter feedback | §3.7 |
| Einblicke | Analyse | `analyse` | 8 | Stored "Komplettanalysen" per interval, PDF export | §3.8 |
| Einblicke | Verbesserung | `verbesserung` | 9 | Improvement runs, suggestions, live directives | §3.9, [`IMPROVEMENT_LOOP.md`](./IMPROVEMENT_LOOP.md) |
| System | Einstellungen | `einstellungen` | 0 | E-mail designs, Shopify-Abgleich, send configuration, Systemstatus | §3.10, [`EMAIL_DESIGNS.md`](./EMAIL_DESIGNS.md) |

Legacy keys still resolve: `?tab=overview` (the retired Übersicht, see §3.1) →
Eingang, `customers` / `marketing` → Kunden, `kampagnen` → Kampagnen (the
screen keeps the key `kampagne`; its label is „Kampagnen“). An unknown key
falls back to the Eingang. The registry (keys, labels, groups, shortcuts,
descriptions, aliases, URL builder) is the pure, unit-tested
[`src/lib/admin-tabs.mjs`](../src/lib/admin-tabs.mjs); the icons live in
[`src/app/admin/tabs.tsx`](../src/app/admin/tabs.tsx) (Eingang: `Inbox`).

> The consent copy (served version v5) is approved — German by the lawyer, English as its
> faithful translation (`CONSENT_COPY_LAWYER_APPROVED` in
> [`src/lib/consent-copy.ts`](../src/lib/consent-copy.ts), `CONSENT_COPY_EN_LEGAL_REVIEWED` in
> `consent-copy-core.mjs`). Any wording change is a new legal
> review — see [`CONSENT_FLOW.md`](./CONSENT_FLOW.md).

Past-state material (the retired Übersicht, the per-customer `MS5-` draft path, the old
migration narrative and discount runbook, removed routes) is in
[`archive/ADMIN_DASHBOARD_HISTORY.md`](./archive/ADMIN_DASHBOARD_HISTORY.md).

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
   - invalid on a page → **307** redirect to `/admin/login` (`NextResponse.redirect` default);
   - invalid on an API route → **401** JSON.
4. Each `/api/admin/*` handler additionally calls `guardAdminPost(req)` or
   `guardAdminGet()` (defense in depth). A POST re-verifies the cookie **and**
   requires `Content-Type: application/json` (415 otherwise), which a cross-site
   form can't send without a CORS preflight — a lightweight CSRF defense given the
   cookie is the only credential. A GET (detail reads, PDFs, status) re-verifies
   the cookie only.
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
folder (`eingang/`, `kunden/`, `kampagne/`, `kpi/`, …) that owns the
interaction state and calls the guarded `/api/admin/*` routes.

The client workspaces are exported through `next/dynamic` in
[`lazy.tsx`](../src/app/admin/lazy.tsx), so each screen's JavaScript is its
own chunk (server rendering stays on — nothing flashes). The Kampagnen screen
has two chunks: `CampaignsOverview` (overview + editor) and
`KampagneWorkspace` (the desk). Recharts is loaded only on KPIs:
[`kpi/charts.tsx`](../src/app/admin/kpi/charts.tsx) wraps every chart of
`kpi/charts-recharts.tsx` in `next/dynamic`.

The navigation badges are four cheap COUNT queries in `page.tsx`, all
fail-soft and read-only: Eingang = open items with priority ≥ 80
(`getInboxCounts().highPriority` — a snooze whose time has come already counts
as open; the badge path never writes) **plus** the inbound mails no customer
could be matched to (`countUnmatchedInbound`), Kampagnen = drafts waiting on
the desks of all active campaigns (test contacts excluded), Wissen = open
questions.

The shell: grouped sidebar (Arbeit · Einblicke · System) with full labels from
1280 px, an icon rail with tooltips on tablet widths and a slide-in drawer
below 1024 px; a slim top bar with the screen title, its explanation behind an
`InfoTip`, the shortcut sheet (Tastenkürzel), the light/dark toggle (stored in
a cookie, applied on the server so there is no flash) and logout. Keyboard:
digits `1…9`/`0` jump to the n-th screen, `/` focuses the Kunden search — both
ignored while typing or with a modifier held. Screen-specific keys: Eingang
`J K Enter E Z D Esc` (§3.1), Kampagnen desk `N P V C S A X …` (§3.2), Wissen
`j k Esc` (§3.4).

### 2.2 URL contract and deep links

Everything an operator can point a colleague at is in the URL:

| Screen | Parameters | Meaning |
| --- | --- | --- |
| all | `?tab=<key>` | screen (§ table above); aliases `overview` → Eingang, `customers`/`marketing` → Kunden, `kampagnen` → Kampagnen |
| Eingang | `?status=zurueckgestellt\|erledigt` | the Später or Erledigt list (absent = Offen; Erledigt also shows Verworfen); a server render |
| Eingang | `?item=<id>` | the selected item (kept in sync with `history.replaceState`) |
| Kunden | `?kq=` | search (name / e-mail) |
| Kunden | `?kview=<view>` | Ansicht (preset): `alle`, `mo`, `ohne_mo`, `einwilligung`, `aufgaben`, `neu`, `top`, `abwanderung`, `interessenten`, `aktiv_ohne_einwilligung` — seeds the other fields |
| Kunden | `?kconsent=`, `?kseg=` | Einwilligung (`subscribed`, `pending`, `unsubscribed`, `not_subscribed`, `blocked`), Lebenszyklus (`frisch` … `ruhen`, `keine_bestellung`) |
| Kunden | `?kmo=`, `?kvalue=`, `?kpersona=`, `?kshop=`, `?kchurn=` | „Weitere Filter“: Mo (`yes`/`no`), Wert (`klein`/`komponente`/`grossgeraet`), Persona (archetype or `unknown`), Shop (`shopify`/`lead`), Abwanderung (`niedrig`/`mittel`/`hoch`) |
| Kunden | `?ksort=`, `?kpage=` | sort (`activity`, `revenue`, `orders`, `last_order`, `name`, `created`), 1-based page (50 per page; a page past the end — an old link, a narrowed filter — renders page 1 instead of „0 Personen“) |
| Kunden | `?filter=marketing\|no_purchase` | legacy presets of the retired Übersicht cards, read only when there is no valid `?kview=`: `marketing` → view „Mit Einwilligung“, `no_purchase` → „Mit Einwilligung“ + Lebenszyklus „Ohne Bestellung“; any other value is ignored |
| Kunden | `?customer=<id>` | open this customer (kept in sync while browsing; works for a person outside the current page) |
| Kunden | `?ctab=<tab>` | with `?customer=`: the detail tab to open first (`ueberblick`, `aktivitaet`, `kaeufe`, `beratungen`, `marketing`, `korrespondenz`, `brief`; anything else → Überblick) — set by the Eingang's „Ganzer Verlauf“ |
| Kampagnen | `?campaign=<slug\|id>` | the review desk of that campaign (absent = the overview; an unknown ref shows the overview with a notice) |
| Kampagnen | `?edit=<id\|new>` | the editor sheet on the overview (kept in sync while it is open) |
| Kampagnen | `?edit=new&audience=<json>` | a new campaign whose Zielgruppe starts from this audience spec (set by Kunden → Überblick → „Ähnliche Kunden“ → „Als Zielgruppe verwenden“); normalised on the server (`normalizeAudienceSpec`), ignored when unparsable or longer than 4,000 characters |
| Kampagnen | `?contact=<id>` | the card on the desk (kept in sync while reviewing; a sent/skipped id falls back to the first card). Alone, without `?campaign=`, it opens the desk of the campaign the recipient belongs to (legacy desk links) |
| Kampagnen | `?view=liste\|eingeplant\|briefe\|gesendet` | the Liste, Eingeplant („Einplanen“, shown when switched on or when mails are planned), Briefe (the campaign's letters — shown with a letter mode, or while letters exist; migration 0074) or Gesendet view of the desk (absent = Prüfen) |
| Kampagnen | `?filter=<chip>` | desk queue filter chip: `doi`, `soi`, `en`, `discount`, `set`, `hints`, `blocked` (absent = Alle) |
| KPIs | `?kpiRange=7d\|30d\|90d\|custom`, `?kpiFrom=`, `?kpiTo=` | period (validated + clamped by [`kpi-range.mjs`](../src/lib/kpi-range.mjs)) |
| KPIs | `?kpiFresh=<unix seconds>` | freshness floor for the Shopify cache — set by „Aktualisieren“ (§5.0) |
| Gespräche | `?gid=<conversationId>` | selected conversation (opened by id, also off the current page) |
| Gespräche | `g*` filter params (`gq` search, `gcat`, `gqual`, `gpage`, tier, error flag, range) | list filter, parsed by [`admin-conversation-filter.mjs`](../src/lib/admin-conversation-filter.mjs) |
| Analyse | `?report=<id>` | selected Komplettanalyse |
| Verbesserung | `?run=<id>` | selected improvement run |

The Kunden parameters are parsed and written by the pure, tested
[`src/lib/admin-customer-filter.mjs`](../src/lib/admin-customer-filter.mjs)
(unknown values are dropped; only what differs from the chosen view is written
back). Every Kunden filter change is a `router.push` (the server renders the
next page); selection in Eingang, Kunden, Kampagnen editor and desk uses
`history.replaceState`. The Eingang's „Art“ filter is client-side only. The
two legacy Kunden presets `?filter=marketing|no_purchase` land on the closest
view (table above, `parseCustomerFilter`, tested).

Other screens link into these: „Im Gespräche-Tab öffnen“ in a customer's
consultation (`?tab=gespraeche&gid=…`), „Gespräch #n“ in a Wissen entry; the
Eingang system strip links each active campaign's desk
(`?tab=kampagne&campaign=<slug>`), an Eingang item its customer
(`?tab=kunden&customer=…`), and „Entwurf übernehmen“ / Kunden → Marketing →
Einzelansprache land on `?tab=kampagne&campaign=einzelansprache&contact=<id>`.
Kunden → Überblick → „Ähnliche Kunden“ links each person
(`?tab=kunden&customer=…`) and „Als Zielgruppe verwenden“ opens
`?tab=kampagne&edit=new&audience=<json>`.

### 2.3 Files

```
src/app/admin/
├── layout.tsx            # loads theme.css (design system) for /admin only
├── page.tsx              # ?tab= → loaders → one screen (force-dynamic)
├── AdminShell.tsx        # sidebar, top bar, shortcuts, theme, logout
├── tabs.tsx / lazy.tsx   # icons per screen / per-screen client chunks
├── theme.css, theme-config.ts, ThemeToggle.tsx, fonts/
├── login/page.tsx        # login form + server action (rate-limited)
├── <Screen>Tab.tsx       # server file per screen: queries → props
├── eingang/              # EingangWorkspace (list + item detail + keys), MailReply, UnmatchedInbound, types
├── kampagnen/            # CampaignsOverview (cards), CampaignEditor (sheet), CampaignCheckSection („Prüfen & testen“), types
├── kampagne/             # the desk of one campaign: KampagneWorkspace, CampaignHeader, PreparePopover, QueueRail, MailPane, ReviewColumn, sections/*, ListView, ScheduledViews („Einplanen“ dialog, view „Eingeplant“), SentHistory, LettersView, TestContactsSheet, ContactHistorySheet, EmailViewerDialog, badges, useCampaignActions, useReleaseActions, useRenderedPreview
├── kunden/               # KundenWorkspace, CustomerDetail, badges, useCustomerDetail, tabs/{Ueberblick (+Profil), Aktivitaet, Kaeufe, Beratungen („Gespräche“), Marketing (+OptOutControl), Korrespondenz, Brief}, BundleComposer
├── kpi/                  # KpiToolbar, KpiSection, groups, KpiTopQuestions, charts (next/dynamic) → charts-recharts + chart-geometry, sections/* (one file per section, §3.5)
├── gespraeche/           # GespraecheWorkspace, ConversationFilters, StatsPanel, ConversationList, ConversationDetail, ReportPanel, badges
├── wissen/               # WissenWorkspace, QaEntryEditor, ProductField, badges, useQaQueue
├── einstellungen/        # EmailSettingsWorkspace, ShopifySyncCard, SystemStatusCard, DesignPreviewDialog
├── feedback/, analytics/, verbesserung/
├── HeroImagePanel.tsx, useEmailHero.ts, EmailPreviewButton.tsx, EmailPreviewFrame.tsx, EmailTextModeToggle.tsx   # shared e-mail widgets
├── lib/                  # admin-fetch, use-async-action, use-step-loop, use-media-query, fetch-pdf
└── ui/                   # the primitives (§2.5)
```

Shared, pure logic sits in `src/lib/*.mjs` with `node --test` suites next to it
(`admin-tabs`, `admin-format`, `admin-datetime`, `admin-conversation-filter`,
`admin-customer-filter`, `customer-signals`, `customer-timeline`,
`campaign-def`, `audience-spec`, `kpi-range`, `ttl-cache`, `retention-options`,
…).

### 2.4 Client helpers (`src/app/admin/lib`)

| Helper | Use |
| --- | --- |
| `adminFetch(path, { body })` | the one way to call `/api/admin/*`: JSON in/out, throws `AdminApiError` (status, code, German message), redirects to the login on 401 and back afterwards. `friendlyErrorMessage()` turns network errors into „Netzwerkfehler — bitte erneut versuchen.“ |
| `useAsyncAction(fn, { onSuccess, errorToast })` | pending state + error toast for a button; prevents double submits. |
| `useConfirm()` | promise-based `ConfirmDialog` (title, description, confirm label, destructive tone) — used for sends, deletes and paid bulk runs only. |
| `useStepLoop({ path, body, onStep, isDone, isBusy, retry })` | drives the step-wise jobs (Komplettanalyse, Verbesserungslauf, Shopify import): one bounded POST per step, retries network errors (60 × 5 s, „Verbindung wird wiederhergestellt“), pauses, stops on `AdminApiError`, polls while the server is busy, stops on unmount. |
| `useMediaQuery(query, ssrDefault)` | responsive behaviour without layout flashes (sidebar labels, SplitPane stacking). |
| `fetchPdf(path, payload)` | POST for a binary answer (a letter PDF) with the admin JSON error envelope — `adminFetch()` is JSON-only. Kunden → Brief and Kampagnen → Briefe. |

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
`Select`, `Checkbox`, `SegmentedControl`, `ToggleChips` (multi-choice chips,
`aria-pressed` — audience builder), `Menu`, `Popover`, `Badge`, `StatusBadge`, `Card*`,
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
→ `SegmentedControl`, multi-choice → `ToggleChips`; confirmations →
`useConfirm()`; API calls → `adminFetch()`.
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

Screenshots of the customer-platform screens (Eingang, Kampagnen overview,
editor and desks incl. Einzelansprache, Kunden list and detail tabs, KPIs incl.
Kundenbasis, Einstellungen), light and dark at 1440 and 1024 px:
`docs/screenshots/customer-platform/` (`<screen>-<light|dark>-<1440|1024>.png`;
`einzelansprache-desk` exists in light 1440 only).

### 3.1 Eingang

The operator's start of the day and screen 1 (bare `/admin`): **who needs us
today, why, and the best next step.** (`?tab=overview`, the key of the retired
Übersicht, is an alias — history in
[`archive/ADMIN_DASHBOARD_HISTORY.md`](./archive/ADMIN_DASHBOARD_HISTORY.md) B.) Server file
[`EingangTab.tsx`](../src/app/admin/EingangTab.tsx), client
[`eingang/EingangWorkspace.tsx`](../src/app/admin/eingang/EingangWorkspace.tsx).
Nothing on this screen sends.

**Where the items come from.** The hourly job `/api/cron/inbox` (at :20,
[`inbox-signals.ts`](../src/lib/inbox-signals.ts)) runs the pure, tested rules
of [`customer-signals.mjs`](../src/lib/customer-signals.mjs) over the customer
facts and writes `inbox_items` (migration 0067,
[`inbox-store.ts`](../src/lib/inbox-store.ts)). A dedupe key names the episode
(the order, mail or chat), so a snoozed or dismissed item stays decided —
also after retention, which clears a decided item's content after
`INBOX_RETENTION_DAYS` but keeps a marker (kind, customer, decision, dedupe
key) for two years ([`DATA_RETENTION.md`](./DATA_RETENTION.md), step 8); an
item whose rule no longer fires closes itself (`erledigt_von_selbst`), an item
past `expires_at` expires; the low-priority kinds are capped per run
(`SIGNAL_CAPS`); 14 days after a decision the outcome (mail, orders, revenue)
is recorded for the KPI (§5.18). A snooze whose time has come reopens
(`reopenDueSnoozed`) when the Eingang screen loads and in the hourly job —
never on the read path of the sidebar badge, which simply counts it as open.
The Shopify webhooks add **system items** without a customer
(`abgleich_konflikt`: more than `SHOPIFY_ERASURE_ALERT_PER_HOUR` erasures in
an hour, `shop/redact`). Kinds that advertise are only raised for
people with consent. The same job writes AI suggestions (writer tier) for at
most `INBOX_AI_DAILY_LIMIT` items per day; a suggestion is re-checked against
consent and objections and never widens a gate. „Jetzt prüfen“ runs the rules
on demand without AI.

**E-Mails** ([`inbox-mail.ts`](../src/lib/inbox-mail.ts), rules in the tested
[`inbox-mail-core.mjs`](../src/lib/inbox-mail-core.mjs)). `antwort_offen` is
not a facts rule but an event: every incoming mail of a known customer opens
their item „E-Mail beantworten“ at once — the inbound webhook, „Zuordnen“ /
„Als Interessent anlegen“ below, and the shop's contact form (`/api/contact`
stores the request as a received message, provider `kontaktformular`, and
creates the sender as an Interessent without consent when unknown). One open
item per person: later mails join it (`evidence.messageIds`, count; the reason
shows the newest mail without its quoted history) and reopen a snoozed one.
The hourly job catches up mails the live hook missed (14 days, not answered in
the same thread). A reply — from the Eingang or Kunden → Korrespondenz — closes
the item (`erledigt`, decision `beantwortet`).

| Kind | Label | Group | Needs consent |
| --- | --- | --- | --- |
| `datenauskunft` | Datenauskunft angefordert (Shopify `customers/data_request`) | Jetzt | — |
| `abgleich_konflikt` | Shopify-Abgleich prüfen (system item of the Shopify sync: erasure-rate alert, `shop/redact`; no customer) | Jetzt | — |
| `antwort_offen` | E-Mail beantworten (every incoming mail of a known customer, see above) | Jetzt | — |
| `nicht_zugeordnet` | E-Mail nicht zugeordnet (registered in `customer-signals.mjs`, raised by no rule; unassigned mail is shown in its own block, not as items) | Jetzt | — |
| `kaufabsicht` | Kaufabsicht ohne Kauf | Jetzt | yes |
| `unzufrieden` | Unzufriedenheit (a cancellation, or a refund of at least 10 % of the order value, in the last 14 days — dated by the cancellation or the refund itself, `customer_orders.last_refund_at`, never by the order's last change; a cancelled order is one case, its later refund raises nothing new; „vollständig erstattet“ from Shopify's financial status) | Jetzt | — |
| `angebot_laeuft_ab` | Angebot läuft ab | Diese Woche | yes |
| `klick_ohne_kauf` | Geklickt, nicht gekauft | Diese Woche | yes |
| `zubehoer_fenster` | Zubehör-Fenster | Diese Woche | yes |
| `wiederkauf_faellig` | Wiederkauf fällig | Diese Woche | yes |
| `abwanderung` | Abwanderungsgefahr | Diese Woche | yes |
| `top_kunde` | Top-Kunde | Später | — |
| `zustellproblem` | Zustellproblem | Später | — |
| `einwilligung_fehlt` | Aktiv, ohne Einwilligung | Später | — |

**Layout.**

- **System strip** — „n Entwürfe zur Prüfung“ with a link per active campaign
  that has drafts (→ its desk), open Wissen questions plus running Analyse /
  Verbesserungslauf, and the fixed **last-30-days** strip from Berlin midnight
  (Gespräche = conversations started, Kampagnen-Mails = campaign sends without
  test sends, neu angemeldet = people with a sign-up to the one consent in
  `consent_events` on any surface, the 0064 backfill excluded; „Alle KPIs“;
  `getEingangSystemSnapshot` in [`admin-overview-store.ts`](../src/lib/admin-overview-store.ts)).
  When the Shopify sync needs
  attention (`describeSyncProblems` in `shopify-sync.ts`: first import still
  pending, no webhook for two days, no reconcile for 36 hours, write-backs
  given up) a warning Callout links to Einstellungen.
- **E-Mails nicht zugeordnet** (only when there are any) — inbound mail from an
  address that matches no customer: search a customer by name or e-mail
  (`customers/list?kq=`), pick, „Zuordnen“ (`correspondence/assign`) — the
  message moves into that customer's Korrespondenz — or „Als Interessent
  anlegen“ (`correspondence/assign-prospect`: a new customer from the sender's
  address, no consent). Both open the item „E-Mail beantworten“.
- **Toolbar** — Status Offen n · Später n · Erledigt (`?status=`), „Art“
  (kinds present, with counts), the key hint, „Jetzt prüfen“.
- **List** (left) — grouped **Jetzt / Diese Woche / Später** by kind; each row
  has a priority dot (≥ 80 red, ≥ 55 amber), title, a sparkle when a suggestion
  exists, age, customer and reason.
- **Item** (right) — title, customer, age, „bis“ expiry, priority; the reason
  and its evidence (products, last order, chat, offer end, deadline); the
  customer mini-card (`GET inbox/item`: name → Kunden, the one consent,
  Interessent, persona, orders/revenue/segment/Mo chats, profile excerpt — not
  after an Art. 21 objection; „Keine Einwilligung … nur ansehen oder Brief“ for
  kinds that need consent); **Vorschlag** („Vorschlag erzeugen“ / „Neu
  erzeugen“: Warum, Kanal + Aktion, Betreff, Skizze, Rabatt, Produkte); the
  decisions.
- **„E-Mail beantworten“** ([`eingang/MailReply.tsx`](../src/app/admin/eingang/MailReply.tsx))
  replaces the Vorschlag: the conversation (the item's mails highlighted,
  quoted history removed, earlier mails under „Früherer Verlauf“, „Ganzer
  Verlauf“ → Kunden → Korrespondenz via `?ctab=korrespondenz`); the
  **KI-Zusammenfassung** (Anliegen, Dringlichkeit, „Vor dem Senden:“ and the
  open points) and a reply draft, written automatically when the item is
  opened without one (writer tier, call site `inbox_mail_reply`; a service
  reply — no advertising, no discounts, nothing invented: missing facts become
  `[Platzhalter]`; the person's language and du/Sie; no order numbers or
  amounts in the prompt; the profile only without an Art. 21 objection);
  „Neuer Entwurf“; the editable Betreff and Text with a warning while a
  `[…]` placeholder is left; **„Antwort senden“** (with confirmation) →
  `correspondence/send` as a threaded reply to the newest mail, no consent
  needed (a service reply, not marketing). The item is then erledigt and the
  next one opens.

**Decisions** (Offen only): the primary action — **„Entwurf übernehmen“** when
the kind or the suggestion is an e-mail and the person has consent, otherwise
„Daten bereitstellen“ (`datenauskunft`) or „Kunde öffnen“ (for
`antwort_offen` the primary action is „Antwort senden“ in the item itself), which navigate client-side (`router.push`, no page reload) —,
„Erledigt“, „Später“ (in 3 / 7 / 30 Tagen) and „Verwerfen“
with a reason (passt nicht, schon erledigt, falscher Zeitpunkt, anderes).
„Entwurf übernehmen“ (`inbox/accept`) adds the person to the **Einzelansprache**
(§3.2) with the suggestion as the drafter's operator note (Anlass, Warum, Ziel,
Skizze, Produkte) and its discount (else the campaign's), writes the draft,
marks the item erledigt and opens the card on the Einzelansprache desk. The
Erledigt view shows Erledigt and Verworfen items with decision, reason and date;
in the Später and Erledigt views every item has **„Wieder öffnen“**
(`inbox/decide` `wieder_offen` → back to Offen, toast „Wieder offen“).
„Entwurf übernehmen“ and „Vorschlag erzeugen“ are written to the admin access
log (`inbox.accept`, `inbox.suggest`).

**Keys** (not while typing, not with a modifier, not while a dialog or menu is
open):

| Key | Action |
| --- | --- |
| `J` / `K` | next / previous item (all views) |
| `Enter` | the primary action („E-Mail beantworten“: „Antwort senden“, after the confirmation) |
| `E` | erledigt |
| `Z` | später (3 Tage) |
| `D` | verwerfen (reason „anderes“) |
| `Esc` | clear the selection (all views) |

`Enter`, `E`, `Z` and `D` act only in the Offen view with an item selected.

### 3.2 Kampagnen

**Many campaigns over the whole customer base** (migration 0066: `campaigns`;
`campaign_contacts` are the per-campaign recipients). A recipient always needs
the one e-mail consent and no block; every mail passes the fail-closed send
gates at send time and gets an `MK-` code minted at send. This section is the
**screen walk-through**; the module — kinds, status and phase, editor fields
and bounds, audience spec, gates, review rules, crons, letters — is owned by
[`CAMPAIGNS.md`](./CAMPAIGNS.md) (§2 campaigns and editor, §3 gates, §5 review
workflow, §8 letters); the desk's 2026-09 design rationale is archived in
[`archive/KAMPAGNE_REDESIGN.md`](./archive/KAMPAGNE_REDESIGN.md). Server file
[`KampagneTab.tsx`](../src/app/admin/KampagneTab.tsx): without `?campaign=`
the **overview** (`?edit=` opens the **editor**), with it the **desk** of that
campaign. Since migration 0074 a campaign can also write **letters** (Pingen)
— mainly to customers without the e-mail consent — each one reviewed and
released by hand in the desk's view „Briefe“ (below; module:
[`CAMPAIGNS.md`](./CAMPAIGNS.md) §8).

#### Overview — [`kampagnen/CampaignsOverview.tsx`](../src/app/admin/kampagnen/CampaignsOverview.tsx)

- **Toolbar:** Aktuell · Alle · Archiv (Aktuell hides beendet and archiviert),
  „Versand gesperrt“ (with InfoTip) while `CAMPAIGN_SENDS_APPROVED` is off,
  „Neue Kampagne“. An unknown `?campaign=` shows the overview with a notice.
- **One card per campaign:** name (→ desk), phase badge, kind (Laufend /
  Aktion / Einzelansprache), Zielgruppe fest/dynamisch, discount, the audience
  in plain German (`describeAudienceSpec`, [`audience-spec.mjs`](../src/lib/audience-spec.mjs)),
  start – end, figures (Empfänger, Entwürfe, Gesendet, Klickrate — sends with
  any click, the button or the set link, over real sends), „Prüftisch
  öffnen (n)“, the start action and a ⋯ menu (Bearbeiten, Pausieren, Beenden,
  Archivieren).
- **Status and phase** (rules: [`CAMPAIGNS.md`](./CAMPAIGNS.md) §2.1): the
  badge shows the *phase* („Geplant“ / „Läuft“ / „Abgelaufen“, else the
  status); the start action and the ⋯ menu offer the allowed transitions
  (Starten / Fortsetzen / Wieder aufnehmen, Pausieren, Beenden, Archivieren —
  `campaigns/status`; starting, resuming and ending are confirmed). Nothing is
  ever sent automatically. The Einzelansprache is always active and has no menu.

#### Editor — [`kampagnen/CampaignEditor.tsx`](../src/app/admin/kampagnen/CampaignEditor.tsx)

„Neue Kampagne“ / „Bearbeiten“ open one sheet (`?edit=<id|new>`; a new
campaign starts as Entwurf). The server validates again
(`validateCampaignInput`); the audience spec is normalised there. With
`?edit=new&audience=<json>` (Kunden → „Ähnliche Kunden“ → „Als Zielgruppe
verwenden“, §3.3) the new campaign's Zielgruppe starts from that spec.

The sheet's sections, top to bottom (every field, column, bound and default per kind:
[`CAMPAIGNS.md`](./CAMPAIGNS.md) §2.2):

- **Grundlagen** — Name, Art Aktion / Laufend (only when creating; it seeds the
  defaults), Start, Ende, Priorität.
- **Briefing** — free text the AI writer reads for every mail; „Briefing
  vorschlagen“ (`campaigns/assist`).
- **Zielgruppe** — „Beschreiben“ + „Filter setzen“ (the AI turns a sentence into
  the filters and explains them), the builder with `ToggleChips` and ranges
  (Lebenszyklus, Wertstufe, Abwanderungsrisiko, Mit Mo gesprochen, Letzter Kauf,
  Bestellungen, Umsatz, Kategorie, Persona, Sprache, Einwilligung, keine
  Werbe-Mail / hat geklickt in den letzten n Tagen, nicht in Kampagne; the chips
  state the code's bounds), Fest / Dynamisch and „Erneut aufnehmen nach“
  (Laufend). Beside it the live count **„Passende Kund:innen mit Einwilligung“**
  (`campaigns/audience-preview`, debounced): total, with Mo chat, DE / EN, the
  plain-German description, a few names and — when there are any — „Ohne
  Einwilligung passen weitere N — davon M per Brief erreichbar“ (InfoTip).
- **Angebot** — Rabatt, Gilt für, „Codes gültig bis“ (Aktion): starting values
  for Vorbereiten; codes are minted at send.
- **Gestaltung** — Design, Titelbild, Textlänge, „Button führt zu“ Mo-Chat /
  Shop, „Mo-Hinweis anhängen“ (Mo-Chat without the hint is refused: „Der Button
  zu Mo steht im Mo-Hinweis — …“).
- **Brief** (migration 0074) — „Briefe“ mode, „Porto-Budget (€)“ and the live
  line „Per Brief: N Empfänger:innen (Adresse schon bekannt: M) · ≈ X € Porto
  bei Y € je Brief“; Callouts while `PHYSICAL_MAIL_SENDS_APPROVED` is off or
  Pingen is not configured. Section InfoTip: „Werbebriefe per Post (Pingen) an
  Kund:innen mit abgeschlossener Bestellung, ohne Widerspruch gegen
  Briefwerbung — vor allem an alle, die keine E-Mail-Einwilligung haben. Adresse
  ist nur die Lieferadresse der letzten Bestellung. Jeder Brief wird im
  Prüftisch (Ansicht „Briefe“) geschrieben, geprüft und einzeln freigegeben; im
  Fuß stehen fest der Widerspruchshinweis und der Absender.“
- **Automatik** — „Automatisch vorbereiten“ n Entwürfe / Nacht and Tagesziel
  (display only — shown in the desk header).
- **Prüfen & testen**
  ([`CampaignCheckSection.tsx`](../src/app/admin/kampagnen/CampaignCheckSection.tsx);
  estimate, sample choice and test-send rules: CAMPAIGNS.md §2.2) — the
  **estimate** (Empfänger:innen, KI-Texte ≈ €, KI-Titelbilder ≈ €, Prüfzeit,
  Zeitraum, Vorbereitung — nights of the nightly run, else „im Prüftisch“)
  with a warning when the review or the nightly
  preparation does not fit the window; **„Muster erzeugen“** writes three
  sample mails with the form's current settings, saved or not (stored nowhere).
  Each sample card: name + badges, subject, the start of the text, „ohne
  KI-Profil“ / „Empfehlungen unsicher“, „Einstellungen geändert“ once the form
  moved on; **Ansehen** (the rendered mail with the placeholder code and inert
  links; Escape closes only the preview), **Testpostfach …** (a Testkontakt of
  the saved campaign with exactly this text through the normal send path;
  refused while the form has unsaved changes or the sample is stale; the
  address is remembered in this browser), **Neu schreiben**.

Saving an active campaign with a changed audience re-matches it right away
(`campaigns/update`). For the Einzelansprache the editor hides Zielgruppe, the
schedule, „Brief“ and „Prüfen & testen“.

#### Desk — one campaign (`?campaign=<slug|id>`)

The **review desk**, scoped to one campaign (queue, test contacts, search,
Gesendet and the Vorbereiten defaults are per campaign); built for one person
clearing 100–200 e-mails a day:

- **Header strip.** The campaign switcher (a menu of all non-archived
  campaigns with their draft counts and „Alle Kampagnen“), the phase badge and
  an InfoTip (kind, audience, start/end; „Geplant“: no mail reaches a customer
  before the start, Vorbereiten and Testkontakte already work; „Entwurf“ /
  „Pausiert“: nothing goes out and drafts can only be prepared once the
  campaign runs); today's progress („n gesendet · m zu prüfen“, plus „Tagesziel
  n“ when the campaign sets one, with a bar that ends at the day's queue), the view
  switch Prüfen · Liste · Eingeplant · Briefe · Gesendet (Briefe only with a letter
  mode or while letters exist), status pills (Versand freigegeben/gesperrt,
  Shopify, „Zielgruppe vor …“ = the last audience refresh — „Einzeln
  aufgenommen“ for the Einzelansprache —, failed drafts; the original texts sit
  in InfoTips), „Vorbereiten…“ (a popover with Anzahl, Rabatt, Gilt für,
  Textmodus, the optional KI-Hero and a cost/time estimate — options, hero modes
  and estimate: [`CAMPAIGNS.md`](./CAMPAIGNS.md) §5 „Vorbereiten…“; it starts
  from the campaign's offer and hero settings, remembers changes per campaign
  and runs as a background job with a progress pill and cancel) and a ⋯ menu (Zielgruppe aktualisieren — `campaigns/refresh`,
  not for the Einzelansprache —, Kampagne bearbeiten, Testkontakte…,
  Tastenkürzel, Warteschlange neu aufbauen behind the ConfirmDialog).
- **Prüfen — three columns.** The *rail* (contact search on `/` within this
  campaign's recipients — a suppressed hit shows „Unterdrückt“ and
  „Reaktivieren“ to lift a mistaken opt-out —, filter
  chips with counts, rows with segment/discount/set/language chips, an edit
  mark and a verdict dot, the Postausgang strip, Übersprungen with
  Wiederherstellen). The *mail column* (identity line, subject inline, the
  rendered e-mail as the default view — re-rendered on every change of the
  draft (Hero, Set, Empfehlungen, Rabatt, Sprache, Neu generieren; typing is
  debounced) and prefetched for the next card — the in-place editor on `E`, side by side with the render at ≥ 1600 px, and the
  action bar: `P`/`N`, Überspringen `X`, Neu generieren `R`, Bearbeiten `E`,
  ⋯ (Vorschau `V`, Kopieren `C` → „Als erledigt markieren“, Verlauf,
  Fokus-Modus `F`, Tastenkürzel `?`), Einplanen `A` (when `CAMPAIGN_RELEASE_ENABLED`, see
  below), Senden `S`). The *review column*:
  Prüfpunkte (the verdict — bereit / Hinweise / blockiert — with one fix per
  check, computed by [`campaign-review-checks.mjs`](../src/lib/campaign-review-checks.mjs);
  which check blocks and which only hints: [`CAMPAIGNS.md`](./CAMPAIGNS.md) §5
  „Prüfpunkte“),
  Empfehlungen (thumbnails, prices, availability, „+ Produkt“ with the catalog
  picker), Angebot (Rabatt 0/5/10/15/20/custom, „Gilt für“ Alles / Empfehlungen /
  Set — what Shopify applies the code to, coupon and prose follow; Set line with
  the composer in a sheet), Text (Sprache, Modus), Hero (only when the campaign design has a
  hero: Erzeugen, Anpassen… sheet, Entfernen), Kundenprofil (persona badge,
  plain-text excerpt of the central profile, „Öffnen“ → the customer in
  Kunden), Kaufhistorie (collapsed, with the recommendation basis; "Letzte 5
  von N Bestellungen" when the snapshot is cut), Kontakt (opt-in, segment,
  last mail + Sperrfrist, A/B group, Umsatz = the customer figures at the
  last audience refresh, Verlauf sheet, an „Abmelden“ icon (opt-out on request, no
  e-mail) and a trash icon that deletes the person completely after a
  confirm — neither shown for Testkontakte). Every rendered mail in the admin
  has inert recipient links (`adminEmailHtml`), so a click in a preview never
  unsubscribes anyone.
- **Einplanen („approve now, send later“, migration 0072, default off in code:
  `CAMPAIGN_RELEASE_ENABLED`).** `A` / „Einplanen…“ on a reviewed card opens the
  time choice (next run · today 18:00 · tomorrow 09:00 · tomorrow 18:00, Berlin;
  `campaign-release-core.mjs`); the server checks every send gate now without
  sending. The card leaves the queue; the view **Eingeplant** lists the planned
  mails with „Zurücknehmen“. The release job sends them later through
  `approveAndSendCampaign`; a mail that changed after planning or that a gate
  now refuses returns to the queue with the reason on the card („Nach der
  Freigabe geändert …“) — fingerprint, job, limits and recovery:
  [`CAMPAIGNS.md`](./CAMPAIGNS.md) §5 „Einplanen“. Every mail is still reviewed
  and approved by a person, one at a time; there is no bulk approve. Test
  contacts are sent directly.
- **Nothing blocks the next card.** `S` takes the card out of the queue at
  once and the server answers in the Postausgang; a refused send comes back to
  the top with the server's reason as a blocked Prüfpunkt and a retry. Offer
  and text changes (Rabatt, Sprache, Modus, Empfehlungen, Set) persist at once
  and batch into ONE background regenerate („Text wird angepasst…“); every
  card has its own busy state. Vorbereiten runs while the review continues.
- **Liste.** The queue as a sortable table with multi-select and bulk
  Überspringen (free, undoable), Neu generieren… and Rabatt setzen… (confirmed
  with count and cost estimate). The Hero column shows only for the KI hero
  modes (`ai_ab`: KI-Hero / „A ohne“ / B; `ai_all`: KI-Hero / „fehlt“).
- **Gesendet.** This campaign's sends: the pure-DB 30-day delivery strip (gesendet, zugestellt %,
  geklickt %, Bounces, Beschwerden, Abmeldungen; link to the Kampagnen-Funnel
  on the KPI screen), then the paged, searchable history (e-mail/subject,
  delivery-state chips, date range) with the delivery state from the Resend
  webhook, redemption looked up in Shopify **for the visible page only**, the
  **validity** of what the send carried (the earlier of code and set expiry,
  `offerValidity` in `campaign-desk-core.mjs`: a warning badge while it ends
  within 48 hours, „noch 6 Tage" beyond, „Abgelaufen" after; the chip
  **„Läuft bald ab"** filters to exactly those reminder candidates), and the
  viewer for the retained content of a send. The Verlauf sheet of a contact
  shows the same validity badge.
- **Briefe** (`?view=briefe`, migration 0074,
  [`kampagne/LettersView.tsx`](../src/app/admin/kampagne/LettersView.tsx)) — the
  campaign's letters, in the view switch as „Briefe n“ (n = open letters) while
  the campaign has a letter mode or letters exist: filter Offen / Freigegeben /
  Versendet / Alle, the three step loops **„Adressen holen (n)“**, **„Entwürfe
  schreiben (n)“** and **„Freigegebene senden (n)“** (both confirmed), the
  postage and budget line, and a `SplitPane` of the list (Empfänger:in with
  postcode, city and country or „Adresse fehlt“; status with „Blockiert“ / „n
  Hinweise“) and the detail (address, blocks and hints, editable Betreff and
  Brieftext, **„Vorschau“** as the
  printed A4 PDF, **„Freigeben“**, „Zurücknehmen“, „Neu schreiben“,
  „Überspringen“ / „Wieder aufnehmen“). Every letter is released on its own —
  there is no bulk release. The full view, its Callouts and the release and send
  rules: [`CAMPAIGNS.md`](./CAMPAIGNS.md) §8.5–§8.6.
- **Fokus-Modus** (`F`) hides rail and review column, centres the mail and
  shows the Prüfpunkte as a one-line strip.
- **Testkontakte** (⋯ menu, „Testkontakte…“): the operator's own inboxes as
  recipients **of this campaign**, which stay in the queue after every send
  and are excluded from the KPIs — rules (exemptions, borrowed purchase
  history, migration 0057): [`CAMPAIGNS.md`](./CAMPAIGNS.md) §5 „Testkontakte“.
  The queue props carry the suppression state of every address, so a real
  contact on the suppression list is a blocked Prüfpunkt before the send is
  attempted. The copy path (`C` → „Als erledigt markieren“) checks the
  person's consent and block like a send.

State and every mutation live in
[`kampagne/useCampaignActions.ts`](../src/app/admin/kampagne/useCampaignActions.ts)
(id-keyed selection, per-card busy map, Postausgang, background jobs; every
batch call carries the campaign id; the rules in
[`campaign-desk-core.mjs`](../src/lib/campaign-desk-core.mjs)); the send itself
is `POST /api/admin/campaign/send` → `approveAndSendCampaign`, covered by its
tests. Screenshots: `docs/screenshots/kampagne-desk/` (2026-09 desk),
`docs/screenshots/customer-platform/` (`kampagnen`, `kampagne-editor`,
`kampagne-desk`, `kampagne-blackfriday`, `einzelansprache-desk`) and
`docs/screenshots/kampagne-briefe/` (view „Briefe“, sent letters, send dialog,
editor section „Brief“, the printed PDF).

#### Einzelansprache

The built-in system campaign (kind `einzel`, slug `einzelansprache`; always
active, no audience, no schedule) for **single, hand-picked mails** — the way
to write one person a personal mail (the former per-customer path is §4). The
three ways in — **Kunden → Marketing → „Einzelansprache vorbereiten“**
(optional „Hinweis für die KI“), an Eingang suggestion („Entwurf übernehmen“,
§3.1) and the Kunden list („Auswählen“ → „Zur Kampagne…“, §3.3) — and their
rules are in [`CAMPAIGNS.md`](./CAMPAIGNS.md) §2.4. The first two write the
draft and open the card on the Einzelansprache desk
(`?campaign=einzelansprache&contact=<id>`); the list selection only adds the
people (drafts are written on the desk with „Vorbereiten…“). From there it is
the same desk, the same Prüfpunkte and the same send path as every campaign.
The desk's „Zielgruppe aktualisieren“ is disabled; its
empty state points to Kunden and the Eingang.

### 3.3 Kunden

**The whole customer base, server-side** ([`CUSTOMERS.md`](./CUSTOMERS.md)):
every Shopify customer (the mirror, migration 0061 — filled by the import in
Einstellungen → Shopify-Abgleich, webhooks and the nightly reconcile) and every
Mo lead, one person per `customers` row. Server file
[`KundenTab.tsx`](../src/app/admin/KundenTab.tsx), client
[`kunden/KundenWorkspace.tsx`](../src/app/admin/kunden/KundenWorkspace.tsx).
The list is ONE spelled-out query over the `customer_overview` view (migration
0068) in [`customer-list-store.ts`](../src/lib/customer-list-store.ts), 50 rows
per page; search, Ansicht, filters, sort and page live in the URL (§2.2) and
every change is a `router.push` that the server renders. A person's full detail
is loaded **on demand** (`GET /api/admin/customers/detail?id=`).

What the former client-side list had (and where it went) is in
[`archive/ADMIN_DASHBOARD_HISTORY.md`](./archive/ADMIN_DASHBOARD_HISTORY.md) C.

- **Summary line** — Kunden · Interessenten · mit Mo · mit Einwilligung · mit
  offenen Aufgaben, each a click on the matching view. Until the first Shopify
  import is done (or while `SHOPIFY_CUSTOMER_SYNC_ENABLED` is off) a Callout
  says that only Mo people and the former newsletter contacts are listed.
- **Filter row** (`FilterBar`) — search (name / e-mail, `/`), Ansicht,
  Einwilligung, Lebenszyklus, „Weitere Filter“ (Mo, Wert, Persona incl. „Ohne
  Persona“, Shop, Abwanderung; the button counts the active ones), Sortierung
  (Zuletzt aktiv, Umsatz, Bestellungen, Letzter Kauf, Name A–Z, Neueste
  zuerst) and the total. Reset keeps the view.
- **Row** — name and e-mail, a dot for open Eingang items, last activity,
  orders × revenue, and the badges Shop / Interessent, Mo (n×), the consent
  (Einwilligung / Bestätigung offen / Abgemeldet / Ohne Einwilligung /
  Gesperrt), Lebenszyklus, Abwanderung (mittel / hoch), Persona. A page past
  the end of the list renders page 1.
- **Auswählen → Zur Kampagne…** — „Auswählen“ (above the list) puts a checkbox
  on every row and one in the bar for the whole page; „n ausgewählt“, „Zur
  Kampagne…“ opens a popover (InfoTip: only people with the consent and
  without a block are added, the rest are skipped; drafts are written on the
  desk with „Vorbereiten…“, nothing is sent) with **Kampagne** (every campaign
  that is not beendet or archiviert, the Einzelansprache first and
  preselected), **„Notiz für den KI-Texter (optional)“** (≤ 2,000 characters)
  and „Hinzufügen“; „Fertig“ leaves the mode. `POST campaigns/add-recipients`
  (≤ 200 people per call) runs `addRecipient` per person; the toast reports „n
  hinzugefügt“, „n waren schon dabei“ and „n übersprungen (keine Einwilligung
  oder gesperrt)“.

| Ansicht | `kview` | Means |
| --- | --- | --- |
| Alle | `alle` | everyone in the base |
| Mit Mo gesprochen | `mo` | at least one chat with Mo |
| Noch ohne Mo | `ohne_mo` | never chatted |
| Mit Einwilligung | `einwilligung` | consent `subscribed`, not blocked |
| Offene Aufgaben | `aufgaben` | open Eingang items |
| Neu (30 Tage) | `neu` | in the base for ≤ 30 days (Shopify creation date, else the customer row's) |
| Top-Kunden | `top` | ≥ 1,500 € revenue, sorted by revenue |
| Abwanderungsgefahr | `abwanderung` | churn risk `hoch` |
| Interessenten | `interessenten` | no Shopify customer (Mo lead) |
| Aktiv, ohne Einwilligung | `aktiv_ohne_einwilligung` | ≥ 2 orders or a chat, no consent, not blocked — reachable by letter or chat only |

**Detail** ([`kunden/CustomerDetail.tsx`](../src/app/admin/kunden/CustomerDetail.tsx)).
The header shows name, e-mail, first/last seen and the badges Shop /
Interessent, signed-in tier, Mo, persona, returning (n×) and the one consent;
**„Löschen“** (after a destructive confirm) runs the complete erasure
(`customers/erase`, `erasePerson`) — the same deletion as the widget button and
the mail link; for a Shopify customer it also queues the Shopify side (a
consent write to „abgemeldet“ and the erasure request, sent while
`SHOPIFY_CONSENT_WRITEBACK` / `SHOPIFY_ERASURE_SYNC` are on). The confirm text
for a Shopify customer follows `SHOPIFY_ERASURE_SYNC`: on, it says Shopify is
asked to delete the data too; off, it says the person is unsubscribed from
e-mail advertising in Shopify and the deletion of the shop account is queued
until the hand-over of deletions is switched on. **No-consent strip:** without a
sendable consent a strip under the header says the person is view-only —
profile and data stay visible, every advertising action (campaign,
Einzelansprache, Set-Angebot per mail) is blocked; for a blocked address it
names the block. The server gates enforce the same. Seven sub-tabs (all stay
mounted, so an edit survives switching):

| Sub-tab | Content | Routes |
| --- | --- | --- |
| Überblick | first the **AI profile card** „Aktuelles Kundenverständnis“ ([`tabs/ProfilTab.tsx`](../src/app/admin/kunden/tabs/ProfilTab.tsx)) — header: the persona as a badge, Vollprofil / Kaufprofil (Tooltip), „Stand … · vor n Tagen“ and a warning badge when the profile is stale: „Neue Aktivität seitdem“ (an order, chat, mail or campaign mail after the Stand — from the timeline, consent changes do not count) or „Älter als 3 Monate“; „Neu generieren“ with cost, or „Kein KI-Profil ohne Einwilligung“ when `CUSTOMER_AI_PROFILE_SCOPE=consented` excludes the person. Body: one card per theme, the structured fields on top and the matching part of the profile text below — **Bedarf & Ziele** (goals, the first highlighted as „Schwerpunkt“), **Niveau & Kontext** (level meter), **Vorlieben & Budget-Signale** (budget meter, „Interessiert an“ chips), **Besitzt bereits** (chips), **Offene Punkte & nächste Schritte** (the next steps, each with an icon for its kind: Angebot / Kontakt / Klären / Zeitpunkt); the text is split by `parseProfileSections` ([`customer-profile-view.mjs`](../src/lib/customer-profile-view.mjs), tested: bold, heading, list or plain labels, German or English, labels mid-line; text before the first label is the „Zusammenfassung“ card, an unknown label gets its own card, a text without any known label — older free-text profiles — is shown whole as „Zusammenfassung“; nothing is dropped except a leading title that repeats the card's). States: „Nur aus Käufen abgeleitet“ (Kaufprofil), „Älteres Profil ohne strukturierte Angaben“ (no `profile_data`), a one-line card with „Kundenverständnis generieren“ when there is no profile, and the objection state „Widerspruch gegen Profilbildung seit …“ with **„Aufheben“**. The two-column grid follows the card's own width (a CSS container), so the detail pane at 1024 px gets one column. Footer: the last run's token usage and **„Widerspruch gegen Profilbildung eintragen“** (Art. 21, confirmed — deletes the stored profile and persona, none is built or used again, and queues the removal of Mo's `mo-` tags in Shopify, §3.10); then **Kennzahlen** from `customer_facts` (Bestellungen, Umsatz, Ø Bestellwert, erster / letzter Kauf, Kaufrhythmus, Lebenszyklus, Wertstufe, Abwanderungsrisiko, nächster Kauf erwartet, Kampagnen-Mails + Klicks 90 T., Kategorien, „Wahrscheinlich als Nächstes“ — complementary products to what the person owns, with price — „Noch nicht berechnet“ until the nightly run; the InfoTip defines Wertstufe as the most expensive single item ever bought); **Datenquellen** (Shopify seit …, Mo n Gespräche, E-Mail n Nachrichten, Shopify-Tags); **Sprache für E-Mails** Automatisch / Deutsch / Englisch — pins `customers.language_override` for every campaign and the Einzelansprache, open recipient rows follow at once (`setCustomerLanguageOverride` in `customer-store.ts`); when saving fails the control snaps back to the stored value; **„Ähnliche Kunden“** (a Disclosure, only for a person with orders, loaded when opened: up to 8 people with the same value tier and at least one shared bought category — most shared categories first, then same lifecycle segment, persona, revenue; deterministic, no tokens — each a link to the person with the shared categories and „ohne Einwilligung“ where the consent is missing; „n von m per E-Mail erreichbar“ and **„Als Zielgruppe verwenden“** → a new campaign with the audience value tier + these categories, `?tab=kampagne&edit=new&audience=<json>`) | `customers/language`, `customers/profile`, `customers/objection`, `customers/similar` |
| Aktivität | one timeline, newest first: orders, Mo chats, campaign mails (with „angeklickt“ for any click), consent changes, mail in / out ([`customer-timeline.mjs`](../src/lib/customer-timeline.mjs); amounts through `admin-format.mjs`); **„Frag Mo“** — a question about this person (3–500 characters) answered from the record in one writer-tier call with cited sources („[n] Datum · Art · Titel“; the AI profile only without an Art. 21 objection) | `customers/ask` |
| Käufe | the order ledger (`customer_orders`, migration 0062: Artikel, Bestellnummer, Rabattcode, storniert, Datum, Summe, Status; „die neuesten n von m“) with paid count, revenue and Ø; for a person not (yet) mirrored the cached per-e-mail history with „Käufe aktualisieren“ | `customers/purchases` |
| Gespräche | the person's conversations with the shared `TranscriptView` and „Im Gespräche-Tab öffnen“ | — |
| Marketing | **Werbe-Einwilligung** — the one consent shared with Shopify: state, Seit, Quelle, „Verlauf (n)“ from `consent_events`; „Abmelden“ on request and „Abmeldung aufheben“ for a mistaken unsubscribe (no e-mail; the change reaches Shopify through the outbox); **Einzelansprache** (only with consent: „Hinweis für die KI“ + „Einzelansprache vorbereiten“, or the open one with „Im Prüftisch öffnen“, §3.2); **Kampagnen** — the person's participation (campaign, status, date, subject, geklickt — any click, the button or the set link —, danach abgemeldet). An open draft of the former personal marketing e-mail stays editable and sendable in the Disclosure „Persönliche E-Mail (bisheriger Weg) — offener Entwurf“ (only while the consent is sendable) until it is sent or deleted (§4) | `customers/marketing-optout`, `campaigns/add-recipient`; former path: `customers/marketing-draft`, `marketing/*`, `bundles/*`, `catalog/search`, `email-hero/*` |
| Korrespondenz | sent + received mail threads (lazy body), reply composer with preview | `correspondence/*` |
| Brief | physical letter: AI draft, preview, „Brief senden“ (gated by `PHYSICAL_MAIL_SENDS_APPROVED`); **„Widerspruch gegen Briefwerbung eintragen“** (Art. 21, confirmed — deletes the letter draft; the tab then shows only the objection with „Aufheben“, and drafting and sending are refused). **Since migration 0074 only a purchase address counts** — the shipping address of the person's latest completed order (source `purchase`); any other stored address (e.g. the Shopify account address, `consented_capture`) is refused at send (`not_purchase_address`, 409), as is an address a letter came back from as undeliverable (`address_invalid`). Without a usable purchase address the tab shows **„Adresse aus letzter Bestellung holen“**: reads that order's shipping address from Shopify and stores it (toast „Adresse aus der letzten Bestellung übernommen“, or „Keine abgeschlossene Bestellung“ / „Die letzte Bestellung hat keine vollständige Lieferadresse“; refused while `PHYSICAL_MAIL_SENDS_APPROVED` is off) | `customers/letter-draft`, `customers/letter-preview`, `physical/send`, `customers/objection`, `customers/letter-address` |

Address auto-capture for letters runs in the daily `refresh-customers` cron,
not on page views; purchase addresses for campaign letters come from the
desk's „Adressen holen“ and the nightly `campaign-audiences` cron
(`CAMPAIGN_LETTER_ADDRESS_NIGHTLY`, [`CAMPAIGNS.md`](./CAMPAIGNS.md) §8.3). Screenshots: `docs/screenshots/customer-platform/`
(`kunden`, `kunden-ohne-mo`, `kunden-detail-ueberblick`,
`kunden-detail-aktivitaet`, `kunden-detail-kaeufe`, `kunden-detail-marketing`);
the profile card since 2026-10-06: `docs/screenshots/2026-10-06-kundenprofil/`.

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
days or „Zeitraum…“, and „Shopify-Daten: Stand hh:mm · Aktualisieren“), the
„Änderungen im Zeitraum“ Callout (§5.0) and the sections — one file each in
`kpi/sections/`, each keeping its honesty caveat verbatim behind the (i) next
to its title. Definitions, caveats and the cache: **§5**. Groups and sections
in screen order ([`KpiTab.tsx`](../src/app/admin/KpiTab.tsx),
[`kpi/groups.ts`](../src/app/admin/kpi/groups.ts)):

| Group | Sections (§) |
| --- | --- |
| Beratung | Kern-Metriken (§5.1) · Seitenkontext auf Produktseiten (§5.1a) · Sprachen (DE/EN) (§5.14) · Gesprächsqualität (KI-Analyse) (§5.13) · Wissen (Q&A-Queue) (§5.11) · Feedback (§5.12) · Kundenkonto & Self-Service (§5.15) · Bestellstatus im Chat (§5.15a) |
| Marketing & Kampagne | Anmelde-Popup (anonyme Besucher:innen) incl. „Diagnose: wo Anmeldungen enden“ (§5.7a) · Einwilligung nach der Anmeldung (Marketing-Opt-in) (§5.7) · E-Mail-Capture-Funnel (§5.8) · Kampagnen-Funnel incl. „Kampagnen im Vergleich“ (§5.9) · Eingang (§5.18) · Bundle-Angebote (§5.10) |
| Umsatz | Umsatz über Mo-Rabattcodes (§5.5) · Mo-zugeordneter Umsatz (Bestell-Webhook) (§5.16) |
| Kosten | KI-Kosten (§5.6) |
| Gesamtwerte („vom Zeitraum unabhängig“) | Kundenbasis (§5.17) · Mo-Effekt (§5.19) · Postversand (Brief) (§5.20) · Marketing-Funnel (§5.4) · Persona-Insights (§5.2) · Empfehlung → Kauf (nur Kund:innen mit E-Mail-Angabe) (§5.3) |

Screenshots: `docs/screenshots/customer-platform/` (`kpi`, `kpi-kundenbasis`).

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
conversation is `?gid=`. The detail of an identified conversation links
„Kunde öffnen“ (`?tab=kunden&customer=<id>`); only the customer id is read for
it — no name or address is selected or shown in Gespräche.

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

The per-conversation analysis runs on the `bulk` tier, the insights rollup — one
synthesis over up to hundreds of summaries — on the `analyst` tier
([`lib/ai-models.mjs`](../src/lib/ai-models.mjs); models, thinking and prices:
[`AI_MODELS.md`](./AI_MODELS.md), [`lib/ai-pricing.mjs`](../src/lib/ai-pricing.mjs)).
Usage is recorded in `ai_usage` (`conversation_analysis`
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

Two chapters come from the customer platform — deterministic, pure DB, no extra
tokens, assembled in the last step (`getReportCustomerBase`,
`getReportCampaigns` in [`analytics-report-store.ts`](../src/lib/analytics-report-store.ts))
and rendered on screen ([`ReportView.tsx`](../src/app/admin/analytics/ReportView.tsx))
and in the PDF ([`analytics-report-pdf.mjs`](../src/lib/analytics-report-pdf.mjs)), after the
Kennzahlen:

- **Kundenbasis** („Stand heute; neue Anmeldungen im gewählten Zeitraum.“) —
  Kunden gesamt, Shopify-Kunden, Mit Mo gesprochen, Mit Einwilligung (subscribed,
  not blocked) as of the report's assembly, „Neu angemeldet“ (people with a
  sign-up to the one consent in `consent_events` within the interval, any
  surface, the backfill excluded) and the Lebenszyklus mix.
- **Kampagnen** („Im Zeitraum gesendete Kampagnen-Mails und was daraus wurde.“)
  — per campaign the real sends in the interval: Gesendet, Geklickt (any click,
  with the rate), Chat gestartet (§5.9), Abgemeldet.

Reports generated before these chapters render unchanged.

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
configuration (sender, inbound address, logo override), the **Shopify-Abgleich**
card and the **Systemstatus** card (decision D-5): DB, Shopify, Resend send +
webhook, Pingen, Anthropic and OpenAI keys, the rate-limit store (Upstash KV), the
three legal gates and the group **Funktionen**: the feature switches as An /
Aus (Kunden-Abgleich mit Shopify, Einwilligung → Shopify, Löschung → Shopify,
Mo-Merkmale als Shopify-Tags, KI-Profile für alle Kund:innen, „Einplanen“,
nächtliche Kampagnen-Entwürfe and KI-Vorschläge im Eingang with their per-night /
per-day figure, Bestellstatus im Chat, the switches of 2026-10-05 — Seitenkontext im
Chat (`CHAT_PAGE_CONTEXT_ENABLED`, with the control-group share of
`CHAT_PAGE_CONTEXT_HOLDOUT_PCT` when > 0), Shop-Login-Erkennung (App Proxy)
(`APP_PROXY_SIGNIN_ENABLED`, with `APP_PROXY_SIGNIN_MAX_AGE_HOURS` or „nur mit
Chat-Token“), Bestell-Zuordnung ab letzter Beratung (`MO_ATTRIBUTION_SESSION_ANCHOR`)
and Einwilligungs-Popup: Varianten (`CONSENT_SIGNIN_VARIANTS`: „Nur Variante „a““ or
„A/B-Test: …“ with the served ids) — each explained in an `InfoTip`, and Pingen-Umgebung
Produktion vs. Testumgebung; [`SystemStatusCard.tsx`](../src/app/admin/einstellungen/SystemStatusCard.tsx),
read through `platform-flags.mjs`, `page-context.ts` and `consent-variants.mjs` in
`EinstellungenTab.tsx`) — shown as states plus those figures, never a key or other value
(screenshots `docs/screenshots/systemstatus/`). Details:
[`EMAIL_DESIGNS.md`](./EMAIL_DESIGNS.md).

**Shopify-Abgleich**
([`einstellungen/ShopifySyncCard.tsx`](../src/app/admin/einstellungen/ShopifySyncCard.tsx);
data from `getSyncHealth` / `listSyncRuns` in
[`shopify-sync.ts`](../src/lib/shopify-sync.ts), `getOutboxStats` in
[`shopify-outbox.ts`](../src/lib/shopify-outbox.ts),
`getConsentAlignmentReport` in [`consent-alignment.ts`](../src/lib/consent-alignment.ts)) —
the customer platform's link to Shopify:

- **Flags** as badges with InfoTips: Kundenstamm abgleichen
  (`SHOPIFY_CUSTOMER_SYNC_ENABLED`), Einwilligung an Shopify zurückschreiben
  (`SHOPIFY_CONSENT_WRITEBACK`), Löschungen an Shopify weitergeben
  (`SHOPIFY_ERASURE_SYNC`), Merkmale als Shopify-Tags
  (`SHOPIFY_WRITEBACK_ENABLED`, below), KI-Profile alle / mit Einwilligung
  (`CUSTOMER_AI_PROFILE_SCOPE`); a warning when Shopify is not configured.
- **Counts:** Kund:innen aus Shopify, Bestellungen (Kopie), Erster Import,
  Nächtlicher Abgleich, Letzter Webhook (+ count in 24 h), Warteschlange an
  Shopify (open · done in 24 h).
- **Import:** „Kundenstamm übernehmen“ / „Vollständig neu importieren“
  (confirmed; customers and orders via bulk operations, no addresses or phone
  numbers, no e-mail sent) runs step by step with `useStepLoop`
  (`shopify/import`, start · step · cancel; progress, Pause / Fortsetzen,
  „Import abbrechen“); the 5-minute cron continues when the page is closed;
  when the last step finishes a first batch of customer figures is computed.
  Disabled until `SHOPIFY_CUSTOMER_SYNC_ENABLED` is on.
- **Erstabgleich der Einwilligung** (shown while there is something to do):
  consent writes waiting for Shopify (Anmeldungen / Abmeldungen), customer
  creates waiting, and the number of Mo-Abonnent:innen without a Shopify
  account with **„In Shopify anlegen…“** (confirmed; needs a finished import;
  `shopify/align` queues one `customer_create` per person, sent by the outbox
  only while `SHOPIFY_CONSENT_WRITEBACK` is on).
- **Outbox:** write-backs that gave up (dead) with their kind („Einwilligung
  an Shopify“, „Kunde in Shopify anlegen“, „Löschung in Shopify beantragen“,
  „Merkmale an Shopify“), their error and **„Erneut versuchen“**
  (`shopify/outbox`).
- **Merkmale als Shopify-Tags** (plan D-11, `SHOPIFY_WRITEBACK_ENABLED`,
  default off): after the nightly facts run, `/api/cron/shopify-reconcile`
  compares each mirrored customer's desired `mo-` tags
  ([`shopify-insight-tags.mjs`](../src/lib/shopify-insight-tags.mjs), pure and
  tested: `mo-segment-<lifecycle segment>`, `mo-wert-<value tier>`,
  `mo-kontakt` after a Mo chat, `mo-abwanderung-hoch`) with the `mo-` tags the
  mirror holds and queues the difference as one `writeback` outbox row per
  person ([`shopify-insights.ts`](../src/lib/shopify-insights.ts), at most
  2,000 a night, none while one is still open). The outbox adds / removes only
  `mo-` tags (`tagsAdd` / `tagsRemove`) and mirrors the result into
  `customers.shopify_tags`; the shop's own tags are never touched. The tags can
  be used in Shopify segments, Flow and Shopify Email. An **Art. 21 objection
  to profiling** (Kunden → Überblick, `customers/objection` with `kind:
  profile`) removes them: `removeInsightTags` drops the person's pending /
  failed tag write-backs and queues one `writeback` removing every `mo-` tag
  the mirror holds (queued whatever the switch says — it waits until the
  switch is on), and `desiredMoTags` returns no tags while
  `profile_objection_at` is set, so the nightly run never adds them again.
  Lifting the objection lets the next nightly run add them back.
- **Letzte Läufe** (Disclosure): the last 8 runs (Import Kunden, Import
  Bestellungen, Nächtlicher Abgleich) with status and counts.

Screenshots: `docs/screenshots/customer-platform/einstellungen-*`.

---

## 4. Marketing e-mails from the Kunden screen (former `MS5-` path)

A new personal mail to one person is an **Einzelansprache** (§3.2): reviewed and
sent on the campaign desk through `approveAndSendCampaign` (`MK-` codes, the one
consent). The per-customer path below starts **no new draft** any more; it
remains only for a draft that was opened on it earlier and is still unsent. How
the path worked (discount input, what fed the draft, audit trail) is archived in
[`archive/ADMIN_DASHBOARD_HISTORY.md`](./archive/ADMIN_DASHBOARD_HISTORY.md) E.

**An open legacy draft** shows in Kunden → Marketing in the Disclosure
„Persönliche E-Mail (bisheriger Weg) — offener Entwurf“ while the person's
consent is sendable
([`kunden/tabs/MarketingTab.tsx`](../src/app/admin/kunden/tabs/MarketingTab.tsx)):
Rabatt (%) 0–50 (`DISCOUNT_PERCENT_MAX`; > 0 mints a single-use code valid 7
days at send), Textmodus, „Besondere Hinweise (optional)“, „Neu generieren“
(`customers/marketing-draft`), Betreff and E-Mail-Text, the hero image, the
Set-Angebot composer (`bundles/*`), „Speichern“ (`marketing/update`), the
preview (`marketing/email-preview`, placeholder code `MO-XXXX`), **„Freigeben &
senden“** (`marketing/send` → `approveAndSend`, §4.3) and „Entwurf löschen“
(`marketing/delete`). Changing Rabatt, Textmodus or the Hinweise after
generating disables „Freigeben & senden“ until „Neu generieren“ („Rabatt,
Textmodus oder Hinweise geändert — der aktuelle Text passt nicht mehr.“), so the
prose, the code depth and the stored snapshot agree. All actions are
`/api/admin/*` POSTs (§11).

### 4.1 Discount input — chosen BEFORE generating

Retired with the path (no new draft is started); history in
[`archive/ADMIN_DASHBOARD_HISTORY.md`](./archive/ADMIN_DASHBOARD_HISTORY.md) E.

### 4.2 The per-customer draft — full context + admin special instructions

Retired with the path; what fed the draft and its audit trail are in
[`archive/ADMIN_DASHBOARD_HISTORY.md`](./archive/ADMIN_DASHBOARD_HISTORY.md) E.

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
   prefilled cart (the `?discount=CODE` stays intact; the cart link also carries
   the order-attribution marker `attributes[_mo]`, §5.16). The real Shopify cart
   URL lives **server-side** on the row (`cart_url`); only the redirect reveals it.
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

- The Marketing sub-tab only ever offered drafting for **eligible** contacts,
  and shows an open draft only while the person's consent is sendable.
- `draft` and `send` both call `loadEligibleCapture` (the draft route by
  e-mail, `loadEligibleCaptureByEmail`), whose SQL excludes any
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

Most sections read the pseudonymous analytics cluster (`conversations`,
`messages`, `kpi_events`, `ai_usage`). The others name their table in their
subsection: `mo_orders` (§5.1a, §5.16), `marketing_sends` (§5.4, §5.5),
`campaign_sends` (§5.5, §5.9), `email_captures` (§5.3, §5.14), `bundle_offers`
(§5.10), `qa_entries` (§5.11), `feedback` (§5.12), `physical_letters` (§5.20)
and the customer tables `customer_overview` / `inbox_items` (§5.17–§5.19). Four
blocks additionally ask Shopify — revenue (§5.5), campaign funnel (§5.9),
marketing funnel (§5.4), recommendation loop (§5.3) — through the cache of §5.0.
Every section shows counts and sums only, never an identity value. Each KPI
carries its caveat verbatim in the UI (behind the (i) of its section). Which
section sits in which group of the screen: §3.5.

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
| **Seitenkontext auf Produktseiten** (§5.1a) — `kpi_events` on `created_at` (first page-context turn) | |
| **Anmelde-Popup** (§5.7a) — `kpi_events` on `created_at` | Recommendation → purchase loop (§5.3) |
| **Einwilligung nach der Anmeldung** (§5.7) — `kpi_events` on `created_at` | |
| **E-Mail-Capture-Funnel** (§5.8) — `kpi_events` on `created_at` | Marketing funnel (§5.4), Postversand (§5.20) |
| **Umsatz über Mo-Rabatt­codes** (§5.5) — order `created_at` | Kundenbasis (§5.17) — current state of `customer_overview` |
| **Kampagnen-Funnel** (§5.9) — `campaign_sends` on `sent_at` | Mo-Effekt (§5.19) — current state of `customer_overview` |
| **Eingang** (§5.18) — `inbox_items` on `created_at` | |
| **Bundle-Angebote** (§5.10) — `bundle_offers` / clicks on `created_at` | |
| **Wissen-KPIs** (§5.11) — `qa_entries` on `created_at`/`published_at` | |
| **Feedback** (§5.12) — `feedback` on `created_at` | |
| **Gesprächsqualität** (§5.13) — `conversations` on `created_at` | |
| **Sprachen DE/EN** (§5.14) — `conversations`/`email_captures` on `created_at` | |
| **Kundenkonto & Self-Service** (§5.15) — `kpi_events`/`ai_usage` on `created_at` | |
| **Bestellstatus im Chat** (§5.15a) — `kpi_events` on `created_at` | |
| **KI-Kosten** (§5.6) — `ai_usage` on `created_at` | |
| **Mo-zugeordneter Umsatz** (§5.16) — `mo_orders` on order date | |

The lifetime sections sit in the „Gesamtwerte“ group of the toolbar navigation
(group heading „vom Zeitraum unabhängig“), each badged „Gesamtwert“ (tooltip
„Gesamtwert — unabhängig vom gewählten Zeitraum.“), so an operator always knows
which figures the period applies to.

**Release dates in the period** ([`lib/kpi-releases.mjs`](../src/lib/kpi-releases.mjs),
tested). When the period contains a release that changes what a number means,
„Änderungen im Zeitraum“ lists it under the toolbar (date + title, the detail in
an InfoTip): 01.10.2026 widget update (sign-in popup, consent popup), 03.10.2026
one-time sign-in code (backend), 04.10.2026 customer-platform widget, and on
05.10.2026 the two Bestell-Zuordnung releases (marked orders without
attribution counted; window from the latest consultation — §5.16), „Keine
E-Mail-Zusammenfassung mehr für angemeldete Kund:innen“ (`signedin-offer-off`:
„Angeboten“ in §5.8 drops and its rate rises — no change in customer
behaviour), „Shop-Anmeldung zählt im Chat (App Proxy)“ (`app-proxy-signin`:
sign-ins, consent popups and Kundenkonto figures rise; §5.15 „Shop-Login-Erkennung“)
and „Opt-in-Messung nach Quelle und Ergebnis“ (§5.7, §5.8), and on 06.10.2026 the
three changes of the widget build `bc7fb5d` (the 2026-10-05 tasks): „Einwilligungs-Popup:
Vorteile vom Server, Variante und Platzierung“ (`consent-benefits-served`: „Nach Variante
und Platzierung“ in §5.7 has data only from then; no „Weggeklickt“ after an accept),
„Seitenkontext bei getippten Fragen (Widget)“ (`page-context-typed`: §5.1a; Mo uses the
context only with `CHAT_PAGE_CONTEXT_ENABLED`) and „Bestell-Zuordnung: Markierung wird
nach einer Beratung erneuert“ (`attribution-token-renewal`: fewer unknown markers in
§5.16), plus three backend changes of the same day: „DOI-Quote nur noch auf verschickte
DOI-Mails“ (`doi-mail-sent`: §5.7, §5.8), „Kein Einwilligungs-Popup für gesperrte Adressen“
(`consent-ask-suppressed`: §5.7) and „Bestell-Zuordnung: alle Gespräche im Fenster, Mail-Links
ab der letzten Mail“ (`attribution-threads-maillinks`: §5.16) — fourteen entries in all; the six
of 06.10. add no section note. The
affected sections add a note when the period starts earlier: Anmelde-Popup,
Einwilligung, Kundenkonto and „Chat gestartet“ of the Kampagnen-Funnel are
„erst ab dem 04.10.2026 aussagekräftig“, the two widget tiers of
„Mo-zugeordneter Umsatz“ „erst ab dem 05.10.2026“; the first three also note the sign-in
outage from 03.10. until the widget upload on 04.10. (no sign-in could complete
in the chat), so a drop on those days is not a trend. Einwilligung and
E-Mail-Capture-Funnel note, for a period starting before 05.10.2026, that
source and outcome of the opt-ins exist only from that day, older events are
approximated from DOI status and trigger, and figures before and after are not
directly comparable (sessions instead of clicks, the form only). A new release is one entry
in `KPI_RELEASES` (+ `MEANINGFUL_FROM` if a section's data starts with it). The Eingang's 30-day strip (§3.1) is a fixed trailing snapshot and
has no picker.

### 5.1 Core metrics — [`lib/kpi-store.ts`](../src/lib/kpi-store.ts)

All core metrics are scoped to the **selected window** (`created_at >= from AND
created_at < to+1`), served by the `conversations`/`kpi_events` `created_at`
indexes (migrations 0001 + 0027).

| KPI | Definition | Caveats |
| --- | --- | --- |
| **Chats gesamt** | `count(conversations)` in the window — one row per conversation thread, created when a visitor message arrives (`ensureConversationStarted`) or when a turn finishes (`persistTurn` in `/api/chat` `onFinish`). Includes greeting-only threads: the context greeting after a nudge click (`messages: []`, no visitor message) is persisted with `message_count` 1. | Scoped to the picked period (default last 30d). For "the visitor wrote" use **Geöffnet → geschrieben** (`message_sent`), not this count. |
| **Chats pro Tag** | New conversations grouped by `date(created_at)` across the window, gap-filled with 0. | — |
| **Ø Nachrichten / Chat** | `avg(conversations.message_count)`. | Counts user + assistant + tool-marker turns. |
| **Abgebrochen** | `count(status='abandoned')` and its share of all chats. | `status` is flipped to `abandoned` lazily by the retention cron after `ABANDON_AFTER_MINUTES` idle — not real-time. |
| **Konvertiert** (status split) | `status='converted'`, set by the daily **conversion sweep** ([`lib/conversion-sweep.ts`](../src/lib/conversion-sweep.ts), runs with the retention cron): the unique `MS5-` code of the marketing email drafted from this conversation was redeemed in a real order (`wasDiscountCodeRedeemed`), bookkept via `marketing_sends.shopify_order_matched`. Attributed to the session's most-recently-active thread as of the send. | A **lower bound**: purchases without a Mo code are unattributable (same honesty rule as §5.5) and never flip a conversation. Campaign (MK-) sends carry no session and can't convert a conversation. Bounded to `CONVERSION_SWEEP_MAX_CODES` (default 25) checks/run; unmatched codes retry while their discount is still redeemable. |
| **Produkt-/CTA-Klicks**, **Add-to-Cart-Klicks** | `kpi_events` counts, **pattern-matched** by event name: CTA = `event ILIKE '%product%click%' OR '%cta%click%'`; cart = `event ILIKE '%cart%' OR '%checkout%'`. Each also shown as a rate per chat. | The literal event names are owned by the **frontend** widget's `track()`. We match by shape (survives a rename) and additionally surface the **full event breakdown** so the raw truth is always visible. If the widget emits different names, adjust the patterns. |
| **Geöffnet → geschrieben** (engagement, since 2026-10-04) | Sessions with `message_sent` ÷ sessions with `chat_opened` in the window (both widget events, capped at 100 %). | Replaced `chats ÷ sessions with any telemetry`: the old denominator counted sessions that never opened the chat (nudge, popup and CTA impressions) and the old numerator counted greeting-only conversation rows (docs/frontend/05 §12, §14.3). Panel opens without a click (campaign deep link, sign-in return) also fire `chat_opened` (docs/frontend/02 §2.6). |
| **Reichweite (Sitzungen)** | `count(distinct session_id)` in `kpi_events` — sessions with any widget event, opened or not. | Was „Sessions mit Telemetrie“; the denominator of nothing any more, shown as reach. |

### 5.1a Seitenkontext auf Produktseiten — [`getPageContextKpis()`](../src/lib/kpi-store.ts), [`page-context.mjs`](../src/lib/page-context.mjs)

Section in the „Beratung“ group after the core metrics (anchor `seitenkontext`,
2026-10-05, A3). It measures questions **typed or spoken on a product page**
that carry the page's product (`context.source: "page"`, [`API_CONTRACT.md`](./frontend/API_CONTRACT.md) §2) —
whether Mo gets the product, and, while a control group runs, whether using it
changes what shoppers click. Pure DB (`kpi_events`, `mo_orders`), never cached.

**Events.** Two server-only events written by `/api/chat`:
`page_context_applied {applied, kind, resolved, locale, pct}` when a
`source: "page"` request arrives (the **arm**, intention-to-treat) and
`page_context_answered {kind, productCards, otherCards}` when that turn
finished (counts only, no product id). `applied:false` means the context was
deliberately ignored: switched off (`CHAT_PAGE_CONTEXT_ENABLED`, recorded as
`pct: 100`) or the session is in the control group
(`CHAT_PAGE_CONTEXT_HOLDOUT_PCT`, 0–50 %, stable per session id). Collection
pages (`kind: "collection"`) are never held out and only counted for coverage.

**Population.** „Sitzungen mit getippter Frage auf einer Produktseite“ =
sessions with a `page_context_applied {kind:"product"}` in the period; the
session's first such turn in the period (`first_at`) starts every window.
Chats that started elsewhere and later moved to a product page count too.

**Stats.** Sessions; „Produkt erkannt“ (share with `resolved`, hint DE/EN);
„Kontrollgruppe“ read **from the data** (`pct` of the rows, not from the env):
„n %“, „keine“, „Seitenkontext aus“ (100) or „gemischt“; „Kategorieseiten“
(sessions, hint how many were recognised). A Callout „Keine Kontrollgruppe in
diesem Zeitraum — nur Abdeckung messbar.“ when no session has `0 < pct < 100`;
a warning when a control group runs but no experiment is pre-registered.

**Comparison (only with a pre-registered experiment).** Arms: „Mit
Seitenkontext“ (every product turn of the session `applied`) vs.
„Kontrollgruppe“ (none applied); sessions with both are „gemischt“. Compared
are only sessions that are in an arm, carry **one constant share equal to the
experiment's** (`0 < pct < 100`), have a recognised product, were **not primed** (no
`product_cta_opened` / `nudge_clicked` in the 24 h before the first question)
and whose 24-hour window has closed. Everything else is listed as
„Ausgeschlossen“ with its reason (anderer Zeitraum oder Anteil · gemischt ·
Produkt nicht erkannt · Klick davor · Zeitfenster offen). The selected period
must start on or after the experiment's start (rows carry no date of their
own); an earlier start puts every session under „anderer Zeitraum oder
Anteil“.

| Figure (per arm, share of sessions) | Definition | Window |
| --- | --- | --- |
| **Andere Produkte geklickt** (primary) | a product click (`CTA_PATTERNS`) whose `samePage` is not `true` | 24 h from `first_at` |
| Produkt geklickt | any product click | 24 h |
| Warenkorb | an add-to-cart click (`CART_PATTERNS`) | 24 h |
| Ohne beendete Antwort | no `page_context_answered` (attrition) | 24 h |
| Bestellt (7 T.) | an attributed order of the session (`mo_orders.processed_at`), share of sessions whose 7-day window has closed (also „Beraten & gekauft“ in the getter) | 7 days |

The getter also returns first answer with any card / with another card and
the storefront CTA opened after the first question (descriptive). Only the
primary figure gets a verdict: `compareArms()` (difference with a Wald 95 %
interval) and `experimentProgress()` against the pre-registered target per
arm — „läuft (n / Ziel)“ until both arms reach it, then „belastbar“ with the
interval and „Unterschied gesichert“ / „kein gesicherter Unterschied“. Read it
once, at the target.

**Pre-registration.** `PAGE_CONTEXT_EXPERIMENT` in `page-context.mjs` is
`null` until the holdout starts; the commit that sets
`CHAT_PAGE_CONTEXT_HOLDOUT_PCT` > 0 also sets it (`from`, `pct`, primary
`clicked_other`, 24 h, `targetPerArm` from `requiredSampleSize()` on the
observed base rate). Without it no comparison is shown.

> ⚠️ Caveats (the InfoTip names the population, windows, exclusions, `samePage`,
> the target size and the 95 % interval): a session id spans visits (docs/frontend/05
> §3.2), so a session is not a visit; grounded answers are longer, so
> attrition can differ by arm — judged on assignment rows, attrition shown per
> arm; `productCards` counts card tool calls, not rendered cards; `/en`
> handles the catalog does not know show up as „nicht erkannt“; `samePage` and
> the page context come only from the widget build `bc7fb5d` (the 2026-10-05
> tasks, 2026-10-06; KPI release `page-context-typed`) and later — a period
> without such events shows the empty state („Noch keine Daten im Zeitraum —
> getippte Fragen tragen den Seitenkontext erst mit dem Widget vom 06.10.2026.“).
> Which build is live: `npm run verify:widget`. Live check: `npm run
> verify:live -- --session <prefix>` section 9.

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
  load**: the result is cached in `kpi_persona_question_summaries` (migration
  0004: summary, sample size, model) with a timestamp
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
dashboard actually sent on the former per-customer path (§4;
`marketing_sends.status = 'sent'`; campaign mails are §5.9):

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
> UNIQUE single-use discount code minted by Mo's outbound mail** — `MS5-…` codes
> of `marketing_sends` and `MK-…` codes of campaign sends (`campaign_sends`, test
> sends excluded); both `usageLimit:1`, the prefix keeps the channels separable.
> This is the **only** code signal that both ties an order back to Mo
> *and* exposes its value, so the KPI is labeled precisely — **"Umsatz über
> Mo-Rabattcodes"**, not a vague "revenue".

**Deliberately NOT counted here:**

- **Cart links and bundle offers** — orders through a Mo-built cart link
  (summary or marketing e-mail, bundle offer; `attributes[_mo]`) or a cart the
  widget stamped are counted by the **separate** §5.16 „Mo-zugeordneter Umsatz“;
  this KPI stays code-only by definition. The in-chat quick-checkout („Zur
  Kasse“, `/api/products` `cartUrl`) is a cart permalink without
  `attributes[_mo]`; whether the widget's live-cart stamp carries over to that
  checkout is unverified (docs/frontend/05 §10.3).
- **Welcome code** — that automatic discount has been **retired**.

| Field | Definition |
| --- | --- |
| **Umsatz über Mo-Rabattcodes** | `Σ currentTotalPrice` of orders that redeemed a Mo `MS5-…` or `MK-…` code **within the window**, counting only **realised** money (`displayFinancialStatus ∈ {PAID, PARTIALLY_REFUNDED}`). |
| **Bestellungen mit Mo-Code** | Count of those redeemed, paid orders. |
| **Geprüfte Codes** | Codes checked against Shopify (of the sent, coded emails in scope). |

**How:** candidate codes are the sent marketing and (non-test) campaign mails
carrying a code, `sent_at ≤ window-end`, newest-first across both channels,
**capped at the 100 newest**
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
`ai_usage.created_at` index (migration 0012). Two additional breakdowns:

- **Nach Einsatzort** — EUR per `call_site` (every value of `AiCallSite` in
  `ai-usage-store.ts`, largest first; `AiCostSection.tsx` has a German label for
  each — the map is typed `Record<AiCallSite, string>`, so a new site without one
  fails `tsc`; a key only old rows carry shows raw), so the
  operator sees exactly which feature spends what instead of only the binary
  chat/admin split. TTS unit caveat is stated in the UI: for `call_site='tts'`
  the `input_tokens` column carries **characters**, not tokens.
- **Prompt-Caching (Chat)** — cache **hit rate** (`cache_read_tokens ÷ total chat
  input tokens`) and the **net EUR saving** vs. the same calls without caching
  (read discount 0.9× minus write premium 0.25×, pure + unit-tested in
  [`usdCacheSavingsForUsage()`](../src/lib/ai-pricing.mjs)). Can be negative for
  a write-heavy pattern — reported honestly. See
  [`PROMPT_CACHING.md`](./PROMPT_CACHING.md).

### 5.7 Einwilligung nach der Anmeldung — [`getConsentGateFunnel()`](../src/lib/kpi-store.ts)

The consent popup the widget shows a **signed-in** customer who has not decided
yet (`surface: "signin"` — since the widget of 2026-10-01 the main marketing ask
for signed-in customers; the inline card after a mid-conversation sign-in sends
the same events) measured as **angezeigt → akzeptiert**, with the
decline/dismiss split. Kept apart from the other opt-in sources (e-mail capture,
the shop). The anonymous chat gate (`surface: "chat"`) is no longer shown by the
widget — the sign-in popup (§5.7a) replaced it; its older events appear in a
sub-block „Chat-Gate (anonym) — eingestellt“ while they fall in the period. Built
from the four **widget-emitted** `kpi_events` (`consent_gate_shown` /
`_accepted` / `_declined` / `_dismissed`, each carrying
`data.surface`) — see [`API_CONTRACT.md`](./frontend/API_CONTRACT.md) §5. Scoped to the
selected window (`kpi_events.created_at`).

**Sessions, not clicks (2026-10-05, OI1).** The `signin` funnel and its stats
count **sessions with their final state**: accepted beats declined beats
dismissed, so an accept followed by Esc on the success view (or during the
POST) counts once, as accepted; several tabs of one session count once (once
per variant and placement: a session shown both popup and card counts once
for each). Before
05.10.2026 the section counted events — the release note says so for a period
starting earlier. The retired `chat` block still counts events.

**Nach Anmeldeweg** (2026-10-05, P0.3): a table of the `signin` popup per
**session** by how the session signed in — „Über „Anmelden““ (an
`account_signin_linked {kind:"customer_account"}` of the session), „Über
Shop-Login erkannt“ (`kind:"app_proxy"`), „Ohne Anmelde-Event“ (only when > 0) —
with Angezeigt | Akzeptiert | Akzeptanzrate | Opt-in (Server)
(`email_capture_marketing_opted_in {trigger:"signin_optin"}` in the same session).
An accept followed by a dismiss counts once, as accepted. The link lookup is not
limited to the period, so a renewal of an older chat sign-in still reads „Über
„Anmelden““. Since the same day the backend stops offering the popup
(`optInActionable:false`) to a customer who declined it in any session or saw it
in 3 sessions within 30 days (anti-nag, `consent-ask-policy.mjs`) — expect
slightly fewer „Angezeigt“. Since 2026-10-06 it is also never offered for an
address on the suppression list (any reason; ACCOUNT_CONTRACT §6.1), so
sign-in opt-ins with outcome `suppressed` should stay near 0 (`npm run
verify:live` section 3).

**Nach Variante und Platzierung** (2026-10-05, OI3): a table per framing
variant (served `variant` of the sign-in copy) × placement (Popup / Nach
Anmeldung im Chat / Wertmoment), per **session** — Angezeigt · Akzeptiert ·
Akzeptanzrate (akzeptiert ÷ angezeigt; „(zu wenige Sitzungen)“ below 100 shown
sessions per row) · Abgelehnt · Akzeptiert ohne Anzeige (diagnostic only:
shown before the period, an older widget) · Opt-ins (Server)
(`email_capture_marketing_opted_in {trigger:"signin_optin"}` with the same
variant/placement) · Bereits angemeldet (`alreadyConfirmed`) · DOI-Quote
(`email_capture_marketing_confirmed` of the session at or after the opt-in ÷
opt-ins whose DOI mail went out — `doiRequired` and not `doiSent: false`, OI1
F3; rows before F3 have no `doiSent` and count when a mail was due;
already-subscribed answers and unsent DOI mails are not in the denominator). Values outside the known variants and placements are merged into
„unbekannt“, missing ones into „ohne (älteres Widget)“ / „ohne“ (bounded in
SQL and in the tested `normalizeConsentVariantRows`, `kpi-widget-events.mjs`),
so arbitrary strings posted to `/api/kpi` never get their own row. The block
appears only once a known variant arrives — i.e. from the widget build that
echoes the served bullets' `variant` and `placement`: `bc7fb5d` (2026-10-06,
KPI release `consent-benefits-served`) and later; older builds send neither
field, so the block has data from 2026-10-06. The widget sends `popup` or
`signin_return`, never `value_moment` (the placement is accepted but unused).
`variantMismatch` (echoed variant ≠ the session's assignment while more than
one variant runs) is counted for the live check.

**Already subscribed vs. suppressed (F2, 2026-10-05).** A suppressed address
is answered `status: "none"`, `alreadyConfirmed: false` by every opt-in route,
so „Bereits angemeldet“ never includes a blocked address.

> ⚠️ **Measures the UI, not the DOI.** An "Akzeptiert" is the gate tap; the
> consent only becomes an effective marketing subscription after the
> double-opt-in link is clicked. The DOI outcome of the sign-in opt-in is the
> „DOI-Quote“ of „Nach Variante und Platzierung“ and `npm run verify:live`
> section 3 (opt-ins by source / outcome / variant / placement, confirmations
> by source); since 2026-10-05 the E-Mail-Capture-Funnel (§5.8) no longer
> contains it.
> Events without a `surface` payload count in the totals but in neither
> surface split. The retired `starter_shown` / `starter_clicked` widget events
> are no longer aggregated anywhere; in the raw event breakdown (§5.1) they carry
> the badge „eingestellt“ (`kpi-widget-events.mjs` `DISCONTINUED_WIDGET_EVENTS`), so
> their drop to zero never reads as an outage.

### 5.7a Anmelde-Popup — [`getLoginGateFunnel()`](../src/lib/kpi-store.ts)

The widget's sign-in ask for **anonymous** visitors (since 2026-10-01). The
widget decides about 0.7 s after a send — while the reply is still streaming,
not after it — once per **tab** session (`sessionStorage` `ms-chat-gate-shown`,
shared with the consent popup of §5.7), never in voice mode; „Später“ snoozes it
for 24 h on the device (docs/frontend/04 §9.1–§9.2). So a `login_gate_shown`
can belong to a turn that later failed. Counted per **session**: **Angezeigt**
(`login_gate_shown`) → **„Anmelden“ geklickt** (`login_gate_signin_clicked`) →
**Bei Shopify angemeldet** (server `account_signin_succeeded` in the same
session after the click) → **Im Chat angemeldet** (server
`account_signin_linked {kind:"customer_account"}` — the chat redeemed the
one-time code, 0073; only this sign-in counts; since 2026-10-05 a shop-login
link of the same session, `kind:"app_proxy"`, no longer counts as a popup
conversion). Plus „Später“ (`login_gate_declined`) and „Weggeklickt“ (`login_gate_dismissed`) with their
share of the shown sessions, and **Anmeldestarts nach Herkunft** from the widget's
`account_signin_started` (`data.source: "login_gate"` = popup; absent = welcome
card or header button). A note appears when sessions signed in at Shopify but not
in the chat. Rates in the tested `kpi-widget-events.mjs` (`loginGateRates`).

**Diagnose: wo Anmeldungen enden** ([`getSigninDiagnosis()`](../src/lib/kpi-store.ts),
classification in the tested `classifySigninSession`, docs/frontend/05 §12.1).
Every session with a sign-in event in the period — whatever started it: popup,
welcome card, header, or the shop's App Proxy — is classified by the point where
its sign-in ended, from widget and server events of that session: Im Chat
angemeldet (code redeemed, return `ok`), Vom Shop erkannt (`account_signin_linked
{kind:"app_proxy", renewed:false}` without a sign-in round trip — a new sign-in of
the session), Bereits angemeldet, vom Shop bestätigt (`shop_renewed`: every
App Proxy link of the session was `renewed:true`, a new tab confirming an
existing sign-in), Angemeldet (zweiter Versuch),
Code für andere Sitzung (`session_mismatch`), Code abgelaufen oder benutzt
(`invalid`), Widget hat nicht eingelöst (return `link_failed` without a refusal —
also a 503 at the redeem, which is not recorded), Altes Widget (return `ok`
without a redeem), Keine Rückkehr gemeldet (Shopify sign-in, no return event),
Rückkehr mit Fehler, Bei Shopify abgebrochen, Beim Warten geschlossen, Start
nicht angekommen, Shop-Code nicht eingelöst (`shop_not_redeemed`: whoami issued a
code, `account_shop_recognised {codeIssued:true}`, but the session has no link —
an old widget without code redemption, a session change during the request, or a
redeem failure; checked last, so any chat sign-in outcome wins) — each with its
likely cause. Sessions the shop only **recognised** without a code stay out of
the diagnosis (they appear in §5.15 „Shop-Login-Erkennung“). Below the table the
widget's `account_signin_return` results. At most 20,000 sessions per period,
newest first (`ORDER BY max(created_at) DESC` before the limit; noted).
Manual-check sessions (`livecheck-%`) never count.

### 5.8 E-Mail-Capture-Funnel — [`getEmailCaptureFunnel()`](../src/lib/kpi-store.ts)

The five canonical capture events ([`lib/kpi-events.ts`](../src/lib/kpi-events.ts))
rendered as a dedicated funnel: **angeboten → Formular gesendet → Marketing-Haken →
DOI bestätigt**, plus the widget-reported declines and an **asks-by-trigger** split
(the `offer_email_summary` trigger enum). Windowed on `kpi_events.created_at`.

**Capture form only (2026-10-05, OI1).** Submits, opt-ins and confirmations
count only the in-chat capture form (`source: "mo_capture_form"`, [`API_CONTRACT.md`](./frontend/API_CONTRACT.md) §5); the
popup after a sign-in is §5.7, the retired chat gate is left out. Rows from
before 05.10.2026 (no `source`) are told apart by their server-set trigger
(`signin_optin` / `chat_gate` are excluded); a confirmation without `source`
counts unless its session has a sign-in or chat-gate opt-in.

| Figure | Definition |
| --- | --- |
| **Angeboten** | `email_capture_ask_shown` in the window (all asks; since 05.10.2026 Mo no longer offers the summary to signed-in customers — release `signedin-offer-off`, §5.0) |
| **Marketing-Haken** | opt-ins of the form; hint „n DOI-Mail verschickt · n nicht verschickt · n bereits abonniert · n gesperrt“ from `outcome` (`doi_required` split by `doiSent` / `already_confirmed` + `already_subscribed` / `suppressed`; older rows by `doiStatus` pending / confirmed, „gesperrt“ only from 05.10.). „nicht verschickt“ (only when > 0) = a DOI mail was due but its send failed, was skipped (no mail provider) or never ran (the summary send failed first). |
| **DOI bestätigt** | `email_capture_marketing_confirmed` with `source: "mo_capture_form"` (older rows by session, above). Its hint „n % der verschickten DOI-Mails“ is the DOI rate: DOI bestätigt ÷ „DOI-Mail verschickt“ (capped at 100 %). Already subscribed and suppressed addresses get no DOI mail and are not in the denominator, nor are unsent DOI mails (OI1 F3: the route writes the opt-in event after the send attempt with `doiSent`; `isDoiMailSent` in `capture-funnel.mjs`, tested). Opt-ins from before F3 carry no `doiSent` and count as sent, as before, so a period across the change stays comparable; it was „DOI-Mail fällig“ until then (KPI release `doi-mail-sent`, §5.0). |
| **Formular gesendet** | hint „% der Angebote“ (submits ÷ asks, capped at 100 %) |
| **Abgelehnt** | widget `email_capture_declined`, **once per session and trigger** (a stored offer can be declined again after every reload) |
| **Angebote nach Auslöser** | asks by trigger, bounded: the tool's five values and `unspecified`; an empty trigger reads „Ohne Auslöser“, anything else „Anderer Wert“ |

> ⚠️ Event counting, not per-session chaining: a DOI click confirming yesterday's
> opt-in counts in the window of the click. Stated in the UI caveat. A period
> starting before 05.10.2026 carries the release note that source and outcome
> are approximated before that day and the figures are not directly comparable.

### 5.9 Kampagnen-Funnel — [`getCampaignKpis()`](../src/lib/campaign-store.ts)

The MK- channel — every campaign mail to customers with the one consent, all
campaigns incl. the Einzelansprache (see [`CAMPAIGNS.md`](./CAMPAIGNS.md)) — as
**gesendet → geklickt → eingelöst**, windowed on `campaign_sends.sent_at`:

- **Geklickt** — campaign emails' main CTA (the Mo deep link, or the shop link
  of a campaign whose button leads to the shop) routes through
  the tracked redirect since migration **0041** (`campaign_sends.redirect_token` /
  `clicked_at`, `campaign_email_clicked` kpi_event — §10). The click-rate base is
  the **tracked** sends only: copy-path sends and sends from before 0041 carry no
  link and can never count as clicked.
- **Eingelöst** — per-send `wasDiscountCodeRedeemed()` over the windowed MK-
  codes, capped at the 100 newest (`CAMPAIGN_KPI_MAX_CODES`); the rate divides by
  the checked codes with an answer, mirroring §5.4.
- **Sprache** — sends by the recipient contact's *effective* language
  (`language_override ?? language`); purged contacts land in "unbekannt".
- **Kampagnen im Vergleich** (migration 0066) — the same funnel per campaign
  (`byCampaign`: Gesendet, Button-Klickrate, Set geklickt, **Chat gestartet**,
  Eingelöst, Umsatz, Umsatz / Send, Abgemeldet;
  sends without a campaign as „Ohne Kampagne“), next to the existing
  breakdowns per hero variant and per lifecycle segment.
- **Chat gestartet** („Chat-Start“) — sends whose Mo link opened a chat: the
  tracked redirect appends the send's token as `mo_c` to the Mo deep link, the
  widget passes it back as `campaignToken` on `POST /api/chat`
  ([`API_CONTRACT.md`](./frontend/API_CONTRACT.md) §2), and
  `recordCampaignChatStarted` stores **one session-less** `kpi_events` row
  `campaign_chat_started` (`data: { sendId, campaignId }`) per send (test sends
  carry `test: true` and are not counted) — the pseudonymous chat is never tied
  to the person. Shop-CTA campaigns carry no
  `mo_c`. The column counts only from the widget build that sends the token
  (KPI release of 04.10.2026; the section notes it for a period starting
  earlier). Rules: [`CAMPAIGNS.md`](./CAMPAIGNS.md) „Chat-Start“.

The tables of this funnel label their rate **Button-Klickrate**: it counts the
main button (`clicked_at`) and shows set clicks separately („Set geklickt“);
the „Klickrate“ of the campaign cards on the
Kampagnen overview, Kunden → Marketing („geklickt“), the Aktivität timeline and
the AI profile's campaign history count **any** click (button or set link).

### 5.10 Bundle-Angebote — [`getBundleKpis()`](../src/lib/bundle-offers-store.ts)

Offers **created** in the window by lifecycle status, the current live count
(`activeNow`, period-independent by nature), clicks on the tracked offer link
(`bundle_offer_clicked` events + distinct offers clicked) and the average
discount depth vs. the true component sum. **Purchases are deliberately NOT
attributed per offer** — no order↔offer link is stored; an order through a
bundle link carries the `_mo` marker and counts as „Direkt“ in §5.16 (within
the attribution window).

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

Adoption + GDPR self-service volume, windowed. The first stat is **Im Chat
angemeldet** (2026-10-05, P0.3) — **sessions**, not events, from
`account_signin_linked` (written by `POST /api/auth/link`): „über „Anmelden““
(any `kind:"customer_account"` redeem), „über Shop-Login“ (`kind:"app_proxy"`
with `renewed=false` only — a new sign-in) and, in the hint, „bereits angemeldet
(bestätigt)“ (sessions whose only link was a renewal). The hint also gives the
Shopify sign-ins (`account_signin_succeeded`, with the `prompt=none` „still“
share) and the refused codes (`account_signin_link_refused` with `reason`
`invalid` | `session_mismatch`). Then
**data exports** (`account_export_requested`), **erasures** (`account_erased`),
**contact-form submissions** (`contact_form_submitted` — comparable against the
`show_contact_form` tool-fires in the Gespräche tab; the hint splits out reason
`order_support` („Bestellung & Service“) and submissions with a session, which
the widget sends since 2026-10-04), and summary deliveries
(`summary_email` / `summary_download` rows in `ai_usage` — one row per generated
summary). All pseudonymous counters; export/erase events carry no session or
customer key at all.

**Shop-Login-Erkennung (App Proxy)** — shown once a session was recognised or
linked through the shop login. From the server-only `account_shop_recognised`
(whoami, [`API_CONTRACT.md`](./frontend/API_CONTRACT.md) §5) joined per session to the
link events: **Erkannt** (sessions not yet signed in; hint „+N bereits
angemeldet“), **Angemeldet** (new shop-login sign-ins; hint the share of issued
codes that were redeemed), **Mit Chat-Token** (recognised customers who signed in
through „Anmelden“ before; hint share of the recognised) and **Ohne Code** (hint
„X Regel aus · Y ohne Nachweis · Z Personenwechsel · W Fehler“ — `noCode`
`flag_off` / `no_proof` / `handover` / `failed`). **Drift alarm:** a warning
Callout when at least 20 sessions got a code and more than 20 % of them were not
redeemed (`shopRecognitionRates`, `SHOP_REDEEM_ALARM` in the tested
`kpi-widget-events.mjs`) — typically an old widget: run `npm run verify:widget`;
if it reports no acceptable build with code redemption, set
`APP_PROXY_SIGNIN_ENABLED=false` and redeploy. Redeem rate and alarm count all
codes, renewals included. Every query excludes `livecheck-%` sessions; the same
numbers are in `npm run verify:live` section 8 „Shop-Login-Erkennung“.

### 5.15a Bestellstatus im Chat — [`getOrderStatusKpis()`](../src/lib/kpi-store.ts)

The server's `order_status_lookup` events (one per `get_order_status` call,
[`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) „Order status in the chat“) in the period: **Abfragen**, **Sitzungen**,
**Beantwortet** (outcome `ok`, with its share), and three bar lists — **Ergebnis**
(ok, no_orders, not_found, sign_in_required, unavailable, disabled, ledger_off,
ledger_incomplete, ledger_behind, in German), **Thema** (status, shipping, return,
cancellation, refund) and **Quelle der Antwort** (ledger only vs ledger + the short
live read at Shopify). Empty until `CHAT_ORDER_STATUS_ENABLED=true` or a session
of a `CHAT_ORDER_STATUS_TEST_CUSTOMERS` account asks. No order number, amount or
address is ever in the event.

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
not recorded here (never stored in `mo_orders`; the order ledger stores them
while the customer sync is on) — the InfoTip says „Unmarkierte Bestellungen
werden hier nicht erfasst (nicht in der Mo-Zuordnung gespeichert)“.
Ingestion starts at webhook registration (not retroactive), and the section
shows an explicit empty state until the first marked order is seen —
`ingestionSeen` is true once a row exists in `mo_orders` **or** a
`mo_order_marker_unresolved` event exists, so a shop whose marked orders are
all unresolved does not see the „Noch keine Bestellung über den Webhook
erfasst“ callout.

**Window anchor.** The attribution window (`MO_ATTRIBUTION_WINDOW_DAYS`,
default 30 days) counts from the token's minting; with
`MO_ATTRIBUTION_SESSION_ANCHOR` on (default off in code; `sessionAnchor` in the
result, ANWALTSDOSSIER §20) widget stamps count from the latest product consultation on the device
(Produktkarte, Vergleich, Warenkorb-Karte, Showroom; written by the token's own
session, never after the order), Mo links still from their creation — a mail
link from the latest mail carrying its token, which each mail of the session
re-stamps (ORDER_ATTRIBUTION „Attribution window“). The InfoTip explains the
rule of the active mode, plus the cross-device blind spot. „Beraten & gekauft“
checks the purchase against every thread of the session that was active within
the window before the order, not only the latest one.

**„Ohne Zuordnung“.** Marked orders no consultation could claim are counted as
the server event `mo_order_marker_unresolved {reason, source?}` (orders/create
only, dated by its arrival ≈ order time; `unresolvedOrders: { unknownToken,
outsideWindow }`). When the range has any, a note says
„{n} markierte Bestellung(en) im Zeitraum ohne Zuordnung: {a} mit unbekannter
oder gelöschter Markierung, {b} außerhalb des Zuordnungsfensters — keiner
Beratung zugeordnet (nicht in der Mo-Zuordnung gespeichert), nur gezählt.“
They are not linked to a session and not in `mo_orders`.

**Release notes.** The releases `attribution-unresolved`, `attribution-window`
(both 05.10.2026) and `attribution-token-renewal` (06.10.2026: from the widget
build `bc7fb5d` a token the backend deleted is replaced after the next live
product consultation, and the marker is blanked when the session ends — so „mit
unbekannter oder gelöschter Markierung“ should drop; widget rules: API_CONTRACT
§10, as built: docs/frontend/06 §8) are listed under „Änderungen im Zeitraum“
(§5.0). The section itself takes `range` and shows
`releaseNotesFor("attribution", range)`: for a period starting before 05.10.2026
the note „Erst ab dem 05.10.2026 aussagekräftig“ — „Beraten & gekauft“ and „Beraten,
anderes gekauft“ count from the latest consultation since then („Direkt“
unchanged). The note and the `attribution-window` release are shown regardless of
the switch; the latest-consultation window they describe applies only with
`MO_ATTRIBUTION_SESSION_ANCHOR` on (window anchor above).

§5.5's code-only revenue KPI deliberately stays separate (exact definition
preserved); orders can appear in both when a coded order also carries the cart
marker.

### 5.17 Kundenbasis — [`getCustomerBaseKpis()`](../src/lib/customer-list-store.ts)

The shape of the whole customer base, **period-independent** (Gesamtwerte),
pure DB over the `customer_overview` view — no Shopify call:

| Figure | Definition |
| --- | --- |
| **Kunden gesamt** | all `customers` rows; split Shopify customers vs. Interessenten (no Shopify customer) |
| **Mit Mo gesprochen** | `conversations_count > 0`, share of the base, of which Shopify customers |
| **Mit Einwilligung** | `email_consent_state = 'subscribed'` and not blocked; share of the base and the DOI share (`confirmed_opt_in`) among them |
| **Abwanderung hoch** | `churn_risk = 'hoch'` (time since the last order against the person's own rhythm) |
| Lebenszyklus | count per `lifecycle_segment` (no orders → „Ohne Bestellung“) |
| Einwilligung | Angemeldet · Bestätigung offen · Abgemeldet · Keine Einwilligung · Gesperrt (blocked counts only there) |
| Wertstufe & Profile | count per value tier; Vollprofil · Kaufprofil · ohne Profil |

Lifecycle, value tier and churn come from the nightly `customer_facts`; before
the first Shopify import the section covers only Mo people and the former
newsletter contacts (stated in the caveat).

### 5.18 Eingang — [`getInboxKpis()`](../src/lib/inbox-store.ts)

The learning loop of the operator inbox (§3.1), windowed on
`inbox_items.created_at`, per kind:

| Column | Definition |
| --- | --- |
| **Entstanden** | items created in the window |
| **Gehandelt** | status `erledigt` by an operator decision (not expired, not `erledigt_von_selbst`) |
| **Verworfen** | status `verworfen`; „Häufigster Verwerfgrund“ = the most frequent reason |
| **Von selbst** | closed because the rule stopped firing or the item expired |
| **Bestellung danach (gehandelt)** | the „Gehandelt“ items (operator decisions only — self-closed and expired items are left out, so the share can no longer exceed 100 %) whose 14-day outcome has ≥ 1 order (count and share) |
| **Umsatz danach** | the outcome revenue of the same „Gehandelt“ items |

Plus the totals Hinweise, Gehandelt (share) and KI-Vorschläge (items with a
suggestion). The caveat states it verbatim: a **description, not proof of
effect** — people acted on differ from those not acted on; thresholds are
changed by a human, never by the system.

### 5.19 Mo-Effekt — [`getMoEffectKpis()`](../src/lib/customer-list-store.ts), [`mo-effect.mjs`](../src/lib/mo-effect.mjs)

Do customers who talked to Mo buy differently from **comparable** customers who
never did? Period-independent (Gesamtwerte), pure DB over `customer_overview`,
customers with at least one order only:

- **Bestellungen je Kunde, Ø Bestellwert, Wiederkaufquote (Mo)** — each with
  the lift against „ohne Mo (vergleichbar)“: the no-Mo figures are re-weighted
  to the Mo group's value-tier mix (direct standardisation in the pure, tested
  `computeMoEffect`), so a Großgeräte buyer is compared with a Großgeräte
  buyer. „Nach Wertstufe“ shows both groups per tier plus the comparable total.
- **Über Mo gewonnen** — customers whose first chat came before their first
  order (and their revenue).
- **Abonnent:innen nach Herkunft** — today's subscribers by where the consent
  was given (Shop — Checkout, Konto, Newsletter; Mo — Chat, Formular,
  Anmeldung; Admin; Übernahme / unbekannt).

> ⚠️ Correlation, not causation: people who chat may be more interested to
> begin with (selection effect) — stated in the caveat.

### 5.20 Postversand (Brief) — [`getPhysicalLetterStats()`](../src/lib/physical-letters-store.ts)

Period-independent (Gesamtwerte, badge „Gesamtwert“), pure DB over
`physical_letters` — every letter handed to Pingen, the 1:1 letters of Kunden →
Brief and the campaign letters alike: **Versendete Briefe** (rows with a Pingen
letter id whose status is not `failed`), **Portokosten gesamt** and **Ø Kosten /
Brief** (Pingen's reported price per letter, else `PINGEN_LETTER_COST_CENTS`,
default 106 = 1,06 €). Empty state „Noch keine Briefe versendet.“ The caveat
names the cost source and that failed submissions do not count. Per-campaign
postage and budget are in the desk view „Briefe“ (§3.2).

---

## 6. Shopify scopes & API versions

- **Scopes:** `write_discounts` (code creation) and `read_orders` (purchase
  check, the recommendation→purchase loop **and** the revenue KPI's
  `discount_code` → order-total lookup). The
  customer platform additionally needs `read_customers` (mirror: import,
  webhooks, reconcile), `write_customers` (consent write-back, Shopify
  customers for Mo-only subscribers, erasure requests), `read_all_orders` (to
  import orders older than 60 days) and Protected Customer Data access incl.
  the name/e-mail fields — the full scope list (incl. the catalog and Wissen
  scopes) is the `SHOPIFY_CLIENT_ID` note in [`.env.example`](../.env.example)
  (reinstall the app after adding scopes).
- **API version:** requests target the configured `SHOPIFY_API_VERSION` (current
  stable, e.g. `2026-04`), not `latest`.
- The discount + orders calls follow the Shopify docs for
  `SHOPIFY_API_VERSION = 2026-04` (`shopify.dev` blocks automated fetches with
  HTTP 403, so the mutation shape was corroborated via the public docs index),
  cited inline in [`shopify-discounts.ts`](../src/lib/shopify-discounts.ts):
  - `discountCodeBasicCreate(basicCodeDiscount: DiscountCodeBasicInput!)` —
    single-use (`usageLimit: 1` + `appliesOncePerCustomer`),
    `customerGets.value` as `DiscountPercentage { percentage }` (a 0..1 fraction;
    the depth chosen on the draft), `endsAt` expiry.
  - `orders(query: 'email:"…" created_at:>=…')` — email is a tokenized field, so
    it's quoted for an exact match. Note: the order `email` is **protected
    customer data**; the app may also need Protected Customer Data access approved
    in the Partner Dashboard. We only read existence + minimal fields and never
    persist the order email.

---

## 7. Database

The schema map is [`DATABASE.md`](./DATABASE.md); the migration list is
`migrations/` (forward-only, run manually by the maintainer with
`npm run db:migrate`, DATABASE.md „Running migrations“). Each screen and KPI
section above names the migrations behind it. The narrative of the early
dashboard migrations (0003–0006) and the former list up to 0069 are archived in
[`archive/ADMIN_DASHBOARD_HISTORY.md`](./archive/ADMIN_DASHBOARD_HISTORY.md) F.

---

## 8. Operator checklist

1. Set `ADMIN_PASSWORD` + `ADMIN_SESSION_SECRET` (and the usual DB / Resend /
   Shopify / `UNSUBSCRIBE_SECRET` env — see [`.env.example`](../.env.example)).
2. `npm run db:migrate`.
3. Visit `/admin`, log in. Einstellungen → Systemstatus shows which
   integrations and gates are active.
4. With `SHOPIFY_CUSTOMER_SYNC_ENABLED=true`: Einstellungen → Shopify-Abgleich →
   **Kundenstamm übernehmen** (first import; the crons keep it current).
5. Start of the day: the **Eingang** (screen 1) — decide the items; „Entwurf
   übernehmen“ lands on the Einzelansprache desk.
6. A single personal mail: Kunden → the person → **Marketing** →
   **Einzelansprache vorbereiten** → review on the desk → **Senden**. A
   campaign: Kampagnen → **Neue Kampagne** → Starten → Vorbereiten… → review →
   Senden.

---

## 9. End-to-end discount test (verify a real, working code)

To check a real code end to end, send a campaign mail to a **Testkontakt** on a
campaign desk: it goes through `approveAndSendCampaign` with a real `MK-` code,
tracked link and unsubscribe link ([`CAMPAIGNS.md`](./CAMPAIGNS.md) §5
„Testkontakte“; or „Testpostfach …“ in the editor's „Prüfen & testen“, §3.2).
The former `MS5-` runbook starts a new per-customer draft, which the UI no
longer offers; it is archived in
[`archive/ADMIN_DASHBOARD_HISTORY.md`](./archive/ADMIN_DASHBOARD_HISTORY.md) G.

---

## 10. Tracked redirect — `GET /api/r/<token>`

The endpoint behind the tracked link of every **sent** e-mail
([`src/app/api/r/[token]/route.ts`](../src/app/api/r/%5Btoken%5D/route.ts)). A
mail never links straight to its destination: the link carries a unique,
hard-to-guess token, and this route resolves it, records the click and
**302-redirects** — the customer experiences a normal click. Clicked as a
top-level navigation from a mail client → no CORS or shared-secret guard (like
`/api/confirm-marketing` and `/api/unsubscribe`). Three token kinds, tried in
this order:

| Kind | Resolved by | Records | Redirects to |
| --- | --- | --- | --- |
| Marketing send (`marketing_sends.redirect_token`, the former `MS5-` path, §4) | [`recordEmailClick()`](../src/lib/marketing-store.ts) | `clicked_at` on the first click only (§5.4 „Geklickt“); a `marketing_email_clicked` event on **every** click, `data: { sendId, captureId, firstClick }` | the stored prefilled cart (`cart_url`, `?discount=CODE` intact) |
| Campaign send (`campaign_sends.redirect_token`, migration 0041) | `recordCampaignClick()` in [`campaign-store.ts`](../src/lib/campaign-store.ts) | `clicked_at` on the first click only (§5.9 „Geklickt“); a `campaign_email_clicked` event on every click, `data: { sendId, firstClick }` | the campaign's shop link (`cta_kind = shop`), else `CAMPAIGN_MO_DEEPLINK_URL` with the token as `mo_c` (§5.9 „Chat gestartet“) — both read at click time |
| Bundle offer (set link) | `resolveBundleRedirect()` in [`bundle-offers-store.ts`](../src/lib/bundle-offers-store.ts) | a `bundle_offer_clicked` event, `data: { offerId, status, expired }`; the first set click of a campaign send stamps `campaign_sends.bundle_clicked_at` („Set geklickt“) | an active offer's cart permalink; an expired, archived, failed or pending offer gets a branded „Angebot abgelaufen“ page (410, link to `BUNDLE_EXPIRED_REDIRECT_URL` or the shop) |

All click events carry `session_id = NULL` (an e-mail click, not a widget
event) and match neither KPI-tab ILIKE pattern (§5.1), so they surface only in
the raw event breakdown. Rules per channel: [`CAMPAIGNS.md`](./CAMPAIGNS.md)
„Click tracking“, [`BUNDLES.md`](./BUNDLES.md).

**Fallback behavior:** a customer clicking a real email must never hit a dead
page. An unresolvable token (unknown / expired / pruned), a marketing row
without a stored cart URL, or any unexpected failure still **302-redirects to
the storefront cart** (`https://motionsports.de/cart`) instead of erroring; the
anomaly is logged server-side.

> GDPR note: this logs a click on a link the user **chose** to click — there
> is deliberately **no** open-tracking pixel.

---

## 11. Admin API routes

All under `/api/admin/*` — 103 route files —, gated by the Edge proxy **and**
`guardAdminPost(req)` / `guardAdminGet()` in the handler (§1); JSON envelope
`{ error: { code, message } }` on failure. Grouped by the screen that calls
them. Actions that read or act on one person's data write the admin access log
(`recordAdminAccess`, 39 route files) — among them `customers/ask`,
`customers/objection`, `campaigns/add-recipient(s)`, `campaigns/letters`,
`customers/letter-address`, `inbox/accept`, `inbox/suggest` and
`correspondence/assign-prospect`.

| Screen | Route | Purpose |
| --- | --- | --- |
| Eingang | `GET inbox/item?id=` | one item with the customer mini-card (identity, the one consent, sendable, figures, persona, profile excerpt); for `antwort_offen` also `mail: { messages, replyToMessageId }` (the last 12 messages oldest first, quoted history removed, the item's mails `isNew`) |
| | `POST inbox/decide { id, decision, note?, snoozeDays?, action? }` | `erledigt`, `verworfen` (reason in `note`), `zurueckgestellt` (3 / 7 / 30 days), `wieder_offen` („Wieder öffnen“); 404 `not_found` only when the item does not exist, 500 `internal_error` on a database problem |
| | `POST inbox/suggest { id }` | „Vorschlag erzeugen“ for one item (writer tier, `inbox-suggest.ts`; for `antwort_offen` the summary + reply draft of `inbox-mail.ts`; access log `inbox.suggest`) |
| | `POST inbox/accept { id }` | „Entwurf übernehmen“: Einzelansprache recipient with the suggestion as note + discount, draft written, item erledigt → `{ contactId, campaignId, drafted }` (access log `inbox.accept`) |
| | `POST inbox/run` | „Jetzt prüfen“: run the rules now, without AI suggestions |
| Eingang, Kunden | `GET customers/list?kq=&kview=&…` | the Kunden list as JSON (same URL parameters as the screen, §2.2) — used by the Eingang's „Zuordnen“ search |
| Kampagnen | `GET campaigns`, `POST campaigns { name, kind, … }` | all campaigns with stats / „Neue Kampagne“ (starts as Entwurf; `validateCampaignInput`) |
| | `POST campaigns/update { id, …fields }` | edit; an active campaign with a changed audience is re-matched at once |
| | `POST campaigns/status { id, status }` | Starten / Pausieren / Fortsetzen / Beenden / Archivieren (`canTransition`; starting materialises the audience) |
| | `POST campaigns/audience-preview { audience, letterMode? }` | the editor's live count with consent (total, with Mo, DE / EN as window aggregates, 8 sample names, plain-German description) plus `withoutConsent { total, letterReach }` — the same spec without the consent (the only match that skips it; nothing is materialised) and how many of those a letter could reach (postal address, no objection); with `letterMode` (`ohne_einwilligung` \| `alle`, 0074) also `letters { total, withAddress }` — the letter recipients under the letter rules and how many have a purchase address (the editor's „Per Brief: …“ line) |
| | `POST campaigns/assist { action: audience \| brief, … }` | AI help in the editor: „Filter setzen“ from a sentence, „Briefing vorschlagen“ (proposals only) |
| | `POST campaigns/sample { action: pick \| generate \| send_test, … }` | „Prüfen & testen“: `pick { audience }` → three varied recipients; `generate { campaignId?, config, customerId, language }` → a sample mail (subject, body, html; consent + block list checked, nothing stored); `send_test { campaignId, to, sample }` → Testkontakt + `approveAndSendCampaign` (409 `stale_sample` when the saved settings differ from the sample's) |
| | `POST campaigns/refresh { campaignId }` | „Zielgruppe aktualisieren“ on the desk |
| Kampagnen, Kunden | `POST campaigns/add-recipient { customerId, campaignId?, adminNote?, conversationId?, draft? }` | put one person into a campaign — without `campaignId` into the Einzelansprache; needs consent and no block; `draft: true` writes the draft (access log `campaign.add_recipient`) |
| Kunden | `POST campaigns/add-recipients { customerIds, campaignId?, adminNote? }` | „Zur Kampagne…“ for a selection (≤ 200 ids, else 400): `addRecipient` per person — without consent or with a block counted and skipped, never added; nothing drafted or sent → `{ campaignId, campaignSlug, added, alreadyIn, noConsent, blocked, notFound, failed }`; 404 / 409 `campaign_closed` for an ended or archived campaign (access log `campaign.add_recipients` with counts) |
| Kampagnen (desk) | `POST campaign/prepare { campaignId, count, discountPercent?, textMode?, discountScope? }` | draft the next *n* pending recipients of one campaign (offer defaults from the campaign; 409 `campaign_closed` when not active or past its end) |
| | `POST campaign/draft { contactId, … }` | (re)generate one draft |
| | `POST campaign/update / discount / recommendations / language` | edit text, discount depth, recommended products, language pin of a draft |
| | `POST campaign/email-preview` | render the on-screen draft as text/html |
| | `POST campaign/send { contactId }` | approve & send through the system (`approveAndSendCampaign`); a refusal answers with its reason as the code — e.g. `campaign_closed` 409, `sends_not_approved` / `no_consent` / `opt_in_blocked` 403, `too_soon` 429 |
| | `POST campaign/skip / unskip / mark-done` | review decisions; `mark-done` closes the copy workflow (consent + block checked) |
| | `POST campaign/approve { contactId, releaseAt? }` | „Einplanen“: approve this reviewed mail for the release job from `releaseAt` (empty = next run, ≤ 30 days ahead); runs every send gate now without sending (`campaignSendPreflight`) plus the set-expired / placeholder blockers; refusals 409 with the reason (`release_disabled`, `blocked`, `no_consent`, …); audit `campaign.approve` |
| | `POST campaign/unapprove { contactId }` | „Zurücknehmen“: the planned mail returns to the queue; audit `campaign.approve.revoke` |
| | `POST campaign/reset-queue { campaignId }` | rebuild one campaign's review queue (destructive, behind confirm) |
| | `POST campaign/contacts { query, campaignId? }` | contact search within a campaign's recipients |
| | `GET campaign/test-contacts?campaignId=`, `POST campaign/test-contacts { action: create \| delete, campaignId, … }` | Testkontakte of one campaign: list, create (+ draft right away), delete |
| | `GET campaign/history?campaignId=&q=&from=&to=&delivery=&page=&pageSize=` | paged „Gesendet“ view with delivery + redemption state and code/set expiry; `delivery` = delivered \| clicked \| bounced \| complained \| copy \| expiring (offer ends within 48 h) |
| | `POST campaign/sent-email { sendId }` | retained content of one send |
| | `POST campaigns/letters { action, campaignId \| id, … }` | the view „Briefe“ (0074, `CAMPAIGNS.md` §8): `list` (letters, counts, postage, budget, flags), the steps `fill_addresses` (50 purchase addresses), `draft` (5 AI drafts) and `send_step` (5 released letters, every gate again per letter), and per letter `redraft`, `save { subject, body }`, `approve`, `unapprove`, `skip`, `unskip`; 409 `letters_off` for the steps, `redraft` and `approve` while the campaign's mode is „Keine Briefe“, for `fill_addresses` 403 `flag_off` while `PHYSICAL_MAIL_SENDS_APPROVED` is off and 503 `shopify_not_configured`, 409 `objection` for a draft or release after a postal objection; access log `campaign.letter_approve` (each release) and `campaign.letters_send` (each send step) |
| | `POST campaigns/letters/preview { id, subject?, body? }` | the letter as printed (`application/pdf`, read-only; unsaved text may be passed; a placeholder recipient while no purchase address is known) |
| Kunden, Kampagnen | `POST customers/marketing-optout { customerId \| contactId, action: optout \| lift, confirm: true }` | manual opt-out on request / lift a mistaken unsubscribe (no e-mail, audit-logged; reaches Shopify through the outbox) |
| | `POST customers/erase { customerId \| contactId, confirm: true }` | delete the person completely (`erasePerson`, audit-logged; queues the Shopify side) |
| Kunden | `GET customers/detail?id=` | one customer's full detail (on open) |
| | `GET customers/similar?id=` | „Ähnliche Kunden“: up to 8 people with the same value tier and shared bought categories (consent flag each) + the audience spec that describes them (`{ items, audience }`, pure DB, `listSimilarCustomers`; access log `customer.similar`) |
| | `POST customers/ask { customerId, question }` | „Frag Mo“: one answer from the person's record with cited sources (writer tier; access log `customer.ask`) |
| | `POST customers/profile / purchases` | regenerate the customer profile (409 `profile_not_allowed` outside `CUSTOMER_AI_PROFILE_SCOPE`) / refresh the cached Shopify purchase history |
| | `POST customers/language { customerId, language: de \| en \| null }` | pin / clear the e-mail language (`setCustomerLanguageOverride` in `customer-store.ts`: `customers.language_override`, open recipient rows follow); 404 unknown customer, 500 when it could not be saved (also without a database) |
| | `POST customers/objection { customerId, kind: profile \| postal, objected }` | record / lift an Art. 21 objection: `profile` deletes the AI profile and stops it and queues the removal of Mo's `mo-` tags in Shopify (`removeInsightTags`, §3.10), `postal` stops advertising letters (access log `customer.objection`) |
| | `POST customers/marketing-draft` | per-customer marketing draft of the former path (§4; the UI calls it only to regenerate an open draft) |
| | `POST marketing/update / email-preview / send / delete` | edit, preview, approve & send (`approveAndSend`), delete an open draft of the former path |
| | `POST bundles/suggest / create / archive / delete` | Set-Angebot composer |
| | `POST catalog/search { query }` | product search for the composer and pickers |
| | `POST correspondence/send / message / assign / email-preview` | reply (closes the person's open „E-Mail beantworten“ item → `closedItems`), lazy body, assign unmatched inbound (now from the Eingang; opens the item → `itemId`), preview |
| Eingang | `POST correspondence/assign-prospect { messageId }` | „Als Interessent anlegen“: a customer from the sender (no consent), the mail assigned, the item opened → `{ customerId, itemId }` (access log `correspondence.assign_prospect`) |
| | `POST customers/letter-draft / letter-preview`, `POST physical/send` | physical letter (`letter-draft` 409 after a postal objection; since 0074 `physical/send` answers 409 `objection`, `not_purchase_address` or `address_invalid` too) |
| Kunden | `POST customers/letter-address { customerId }` | „Adresse aus letzter Bestellung holen“ (0074): the shipping address of the person's latest completed order, read from Shopify and stored as the purchase address → `{ checked, filled, unchanged, noOrder, noAddress, failed }`; 403 `flag_off` while `PHYSICAL_MAIL_SENDS_APPROVED` is off, 503 `shopify_not_configured`; access log `customer.letter_address` |
| | `GET email-hero`, `POST email-hero/suggest / generate / headline / remove` | hero image of a marketing or campaign draft |
| Wissen | `GET qa/list?status=`, `POST qa/scan / answer / publish / unpublish / dismiss / restore` | the Q&A queue |
| KPIs | `POST kpi/top-questions { personaLabel, force? }` | on-demand Top-Fragen summary |
| Gespräche | `POST conversations/detail / analyze / analyze-bulk / insights` | transcript, cached analysis, confirmed bulk analysis, insights rollup |
| Analyse | `GET analytics`, `GET analytics/<id>`, `GET analytics/<id>/pdf`, `POST analytics/estimate / create / step / delete` | Komplettanalysen |
| Verbesserung | `GET improve`, `GET improve/<id>`, `POST improve/run / step / suggestion / adopt / delete` | improvement runs |
| | `POST directives/save / toggle`, `GET directives/versions?id=` | Mo's live directives |
| Einstellungen | `POST email-designs/preview / assign` | design preview and per-type assignment |
| | `GET shopify/status` | Shopify-Abgleich: `{ health, runs, outbox, alignment, flags }` (pure DB) |
| | `POST shopify/import { action: start \| step \| cancel }` | the full customer + order import, stepped (`useStepLoop`); a finished import computes a first batch of figures |
| | `POST shopify/outbox { id }` | „Erneut versuchen“ for a dead write-back |
| | `POST shopify/align` | Erstabgleich: queue a Shopify customer (with the consent) for every Mo-only subscriber → `{ queued }` (409 `import_pending` before the first import) |

Routes removed in 2026-09 and with the customer platform are listed in
[`archive/ADMIN_DASHBOARD_HISTORY.md`](./archive/ADMIN_DASHBOARD_HISTORY.md) I.
