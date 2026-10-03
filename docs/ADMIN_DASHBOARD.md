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
folder (`eingang/`, `kunden/`, `kampagne/`, `kpi/`, …) that owns the
interaction state and calls the guarded `/api/admin/*` routes.

The client workspaces are exported through `next/dynamic` in
[`lazy.tsx`](../src/app/admin/lazy.tsx), so each screen's JavaScript is its
own chunk (server rendering stays on — nothing flashes). The Kampagnen screen
has two chunks: `CampaignsOverview` (overview + editor) and
`KampagneWorkspace` (the desk). Recharts is loaded only on KPIs
([`kpi/charts.tsx`](../src/app/admin/kpi/charts.tsx)). Measured on the former
Übersicht (2026-09 redesign): ≈ 159 KB gzip of JavaScript in total, ≈ 126 KB of
which is the Next/React framework (before the redesign: 344 KB on every tab).

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
| Kampagnen | `?view=liste\|eingeplant\|gesendet` | the Liste, Eingeplant („Einplanen“, shown when switched on or when mails are planned) or Gesendet view of the desk (absent = Prüfen) |
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
former Kunden `?filter=<preset>` (set by the Übersicht cards) is **retired**
with the client-side list; the views above replace it, and the two old
presets still land on the closest view (table above, `parseCustomerFilter`,
tested).

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
├── page.tsx              # ?tab= → loaders → one screen (force-dynamic)
├── AdminShell.tsx        # sidebar, top bar, shortcuts, theme, logout
├── tabs.tsx / lazy.tsx   # icons per screen / per-screen client chunks
├── theme.css, theme-config.ts, ThemeToggle.tsx
├── login/page.tsx        # login form + server action (rate-limited)
├── <Screen>Tab.tsx       # server file per screen: queries → props (EingangTab replaced OverviewTab)
├── eingang/              # EingangWorkspace (list + item detail + keys), UnmatchedInbound, types
├── kampagnen/            # CampaignsOverview (cards), CampaignEditor (sheet), types
├── kampagne/             # the desk of one campaign: KampagneWorkspace, CampaignHeader, PreparePopover, QueueRail, MailPane, ReviewColumn, sections/*, ListView, SentHistory, TestContactsSheet, ContactHistorySheet, EmailViewerDialog, useCampaignActions
├── kunden/               # KundenWorkspace, CustomerDetail, badges, useCustomerDetail, tabs/{Ueberblick (+Profil), Aktivitaet, Kaeufe, Beratungen („Gespräche“), Marketing (+OptOutControl), Korrespondenz, Brief}, BundleComposer
├── kpi/                  # KpiToolbar, KpiSection, groups, charts (Recharts via next/dynamic), sections/* (20)
├── gespraeche/           # ConversationFilters, StatsPanel, ConversationList, ConversationDetail, ReportPanel
├── wissen/               # WissenWorkspace, QaEntryEditor, ProductField, useQaQueue
├── einstellungen/        # EmailSettingsWorkspace, ShopifySyncCard, SystemStatusCard, DesignPreviewDialog
├── feedback/, analytics/, verbesserung/
├── HeroImagePanel.tsx, EmailPreviewButton.tsx, EmailPreviewFrame.tsx   # shared e-mail widgets
├── lib/                  # admin-fetch, use-async-action, use-step-loop, use-media-query
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
today, why, and the best next step.** It replaced the read-only **Übersicht**
(retired with `OverviewTab.tsx`; `?tab=overview` is an alias of the Eingang):
the Übersicht's „Heute“ cards became the system strip, its 30-day numbers a
compact strip, the Kunden „Posteingang“ moved here. Server file
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
| `nicht_zugeordnet` | E-Mail nicht zugeordnet (registered; unassigned mail is currently shown in its own block, not as items) | Jetzt | — |
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
  `getEingangSystemSnapshot` in [`admin-overview-store.ts`](../src/lib/admin-overview-store.ts),
  the module's only export since the Übersicht helpers were removed). When the Shopify sync needs
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
the one e-mail consent (`customers.email_consent_state = 'subscribed'`) and no
block; audiences match over the `customer_overview` view. Every mail passes the
same fail-closed gates at send time — campaign live → `CAMPAIGN_SENDS_APPROVED`
→ consent → opt-in level (DOI unless `CAMPAIGN_ALLOW_SINGLE_OPT_IN`) →
suppression → cross-channel cadence (`campaign-gates.mjs`) — and gets an `MK-`
code minted at send. The module (kinds, audience spec, crons, gates) is
documented in [`CAMPAIGNS.md`](./CAMPAIGNS.md), the desk's design decisions in
[`KAMPAGNE_REDESIGN.md`](./KAMPAGNE_REDESIGN.md). Server file
[`KampagneTab.tsx`](../src/app/admin/KampagneTab.tsx): without `?campaign=`
the **overview** (`?edit=` opens the **editor**), with it the **desk** of that
campaign.

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
- **Status and phase** ([`campaign-def.mjs`](../src/lib/campaign-def.mjs)):
  status `entwurf` → `aktiv` ⇄ `pausiert` → `beendet` → `archiviert` (an
  Entwurf can be archived directly, an ended campaign resumed with „Wieder
  aufnehmen“ — `canTransition`);
  the badge shows the *phase* — an active campaign is „Geplant“ before its
  start, „Abgelaufen“ after its end (the nightly job ends it), else „Läuft“.
  Starten / Fortsetzen / Wieder aufnehmen and Beenden are confirmed; starting
  materialises the audience at once (`campaigns/status`). Nothing is ever sent
  automatically. The Einzelansprache is always active and has no menu.

#### Editor — [`kampagnen/CampaignEditor.tsx`](../src/app/admin/kampagnen/CampaignEditor.tsx)

„Neue Kampagne“ / „Bearbeiten“ open one sheet (`?edit=<id|new>`; a new
campaign starts as Entwurf). The server validates again
(`validateCampaignInput`); the audience spec is normalised there. With
`?edit=new&audience=<json>` (Kunden → „Ähnliche Kunden“ → „Als Zielgruppe
verwenden“, §3.3) the new campaign's Zielgruppe starts from that spec.

| Section | Content |
| --- | --- |
| Grundlagen | Name (3–80), Art Aktion / Laufend (only when creating; seeds the defaults — Laufend: dynamisch, KI-Titelbild A/B, re-entry after 180 days), Start, Ende, Priorität 0–100 |
| Briefing | free text (≤ 4,000) the AI writer reads for every mail of the campaign; „Briefing vorschlagen“ (`campaigns/assist`, writer tier) |
| Zielgruppe | „Beschreiben“ + „Filter setzen“ (AI turns a sentence into the filters and explains them); builder with `ToggleChips` and ranges: Lebenszyklus, Wertstufe, Abwanderungsrisiko, Mit Mo gesprochen, Letzter Kauf vor (Tage), Bestellungen, Umsatz (€), Kategorie, Persona, Sprache, Einwilligung (opt-in level), keine Werbe-Mail in den letzten n Tagen, hat geklickt in den letzten n Tagen, nicht in Kampagne; Zielgruppe Fest / Dynamisch; „Erneut aufnehmen nach“ (Laufend). The chips state the code's bounds: Lebenszyklus „Ausbauen (1–3 Mon.)“, „Weiterentwickeln (3–12 Mon.)“; Wertstufe by the most expensive single item ever bought (Kleinteile < 150 €, Komponenten to 1,499 €, Großgeräte from 1,500 €). Beside it the live count **„Passende Kund:innen mit Einwilligung“** (`campaigns/audience-preview`, debounced): total, with Mo chat, DE / EN (window aggregates over the whole match — only 8 rows travel), the plain-German description, a few names, and — when there are any — „Ohne Einwilligung passen weitere N — davon M per Brief erreichbar“ (InfoTip: e-mail advertising needs the consent; people without it can be reached by an advertising letter when a postal address is known and they have not objected) |
| Angebot | Rabatt, Gilt für Alles / Empfehlungen / Set, „Codes gültig bis“ (Aktion) — starting values for Vorbereiten; codes are minted at send |
| Gestaltung | Design (blank = the Einstellungen choice), Titelbild (kein / Standard / KI A/B / KI für alle), Textlänge, „Button führt zu“ Mo-Chat / Shop (+ https link), „Mo-Hinweis anhängen“ — the chat button lives in the Mo hint, so Mo-Chat without the hint is refused („Der Button zu Mo steht im Mo-Hinweis — …“) |
| Automatik | „Automatisch vorbereiten“ n Entwürfe / Nacht (from the shared `CAMPAIGN_AUTO_PREPARE_COUNT` budget, higher priority first; cron `prepare-campaign-drafts`), Tagesziel (display only — shown in the desk header) |
| Prüfen & testen | ([`CampaignCheckSection.tsx`](../src/app/admin/kampagnen/CampaignCheckSection.tsx), not for the Einzelansprache) **Estimate** from the live count and the recorded cost averages (`estimateCampaignCosts`, `campaignPlanEstimate` in [`campaign-sample-core.mjs`](../src/lib/campaign-sample-core.mjs)): Empfänger:innen, KI-Texte ≈ €, KI-Titelbilder ≈ € (A/B = half, „für alle“ = everyone), Prüfzeit (recipients ÷ Tagesziel, 100 / Tag without one), Zeitraum (days left), Vorbereitung (nights of the nightly run, else „im Prüftisch“); a warning when the review or the nightly preparation does not fit the window. **„Muster erzeugen“** picks three recipients who differ most (language, Mo chat, Lebenszyklus, orders) and writes their mails with the form's current settings, saved or not — stored nowhere, only the AI call is counted. Each card: name + badges, subject, the start of the text, „ohne KI-Profil“ / „Empfehlungen unsicher“, „Einstellungen geändert“ once the form moved on; **Ansehen** (the rendered mail with the placeholder code and inert links; Escape closes only the preview), **Testpostfach …** (a Testkontakt of the saved campaign with exactly this text, sent through the normal send path — real code, tracking, unsubscribe; refused while the form has unsaved changes or the sample was made under other settings; the address is remembered in this browser), **Neu schreiben** |

Saving an active campaign with a changed audience re-matches it right away
(`campaigns/update`). For the Einzelansprache the editor hides Zielgruppe, the
schedule and „Prüfen & testen“.

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
  switch Prüfen · Liste · Eingeplant · Gesendet, status pills (Versand freigegeben/gesperrt,
  Shopify, „Zielgruppe vor …“ = the last audience refresh — „Einzeln
  aufgenommen“ for the Einzelansprache —, failed drafts; the original texts sit
  in InfoTips), „Vorbereiten…“ (a popover with Anzahl, Rabatt, Gilt für,
  Textmodus, optional KI-Hero and a cost/time estimate from the recorded
  `ai_usage` averages; it starts from the campaign's offer and hero settings,
  remembers changes per campaign, offers the KI-Hero only for the hero modes
  „KI-Titelbild für einen Teil (A/B)“ (`ai_ab`: „KI-Hero für die A-Gruppe
  erzeugen“, about one hero per two drafts in the estimate) and „KI-Titelbild
  für alle“ (`ai_all`: „KI-Hero für jede Mail erzeugen“, one hero per draft),
  runs as a background job with a
  progress pill and cancel, and is refused for a campaign that is not active
  or past its end; with nothing to prepare it says „Keine offenen Empfänger —
  erst „Zielgruppe aktualisieren“.“) and a ⋯ menu (Zielgruppe aktualisieren — `campaigns/refresh`,
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
  the hero hint follows the campaign's hero mode — `ai_ab`: an A-group card
  without a KI-Hero, `ai_all`: every card without one („Ohne KI-Hero“),
  `default` / `none`: no hero hints — and the send-window hint
  „Segment … — nicht im Sendefenster“ only applies to `laufend` campaigns),
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
- **Einplanen („approve now, send later“, migration 0072, off by default:
  `CAMPAIGN_RELEASE_ENABLED`).** `A` / „Einplanen…“ on a reviewed card opens the
  time choice (next run · today 18:00 · tomorrow 09:00 · tomorrow 18:00, Berlin);
  the server checks every send gate now without sending and stamps the row
  (`approved_at`, `release_at`, a fingerprint of the draft and the campaign's
  render fields). The card leaves the queue; the view **Eingeplant** lists the
  planned mails with „Zurücknehmen“. The job `/api/cron/release-campaign-mails`
  (every 10 minutes) sends the due ones one at a time
  (`CAMPAIGN_RELEASE_MAX_PER_RUN`, `CAMPAIGN_RELEASE_SPACING_MS`) through
  `approveAndSendCampaign`, so every gate runs again; a mail whose draft or
  campaign changed after planning, whose set expired, or that a gate now refuses
  returns to the queue with the reason on the card („Nach der Freigabe
  geändert …“) — never retried automatically. Every mail is still reviewed and
  approved by a person, one at a time; there is no bulk approve. Test contacts
  are sent directly. The job also recovers rows a timeout left in `sending`.
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
- **Fokus-Modus** (`F`) hides rail and review column, centres the mail and
  shows the Prüfpunkte as a one-line strip.
- **Testkontakte** (⋯ menu): the operator's own inboxes as recipients **of
  this campaign** (they see its briefing and offer) that stay in the queue
  after every send, exempt from the cadence cap and the suppression check,
  excluded from the KPIs; optionally with a real customer's purchase history
  (`CAMPAIGNS.md`, migration 0057). The queue props carry the suppression
  state of every address, so a real contact on the suppression list is a
  blocked Prüfpunkt before the send is attempted. The copy path (`C` →
  „Als erledigt markieren“) checks the person's consent and block like a send.

State and every mutation live in
[`kampagne/useCampaignActions.ts`](../src/app/admin/kampagne/useCampaignActions.ts)
(id-keyed selection, per-card busy map, Postausgang, background jobs; every
batch call carries the campaign id; the rules in
[`campaign-desk-core.mjs`](../src/lib/campaign-desk-core.mjs)); the send itself
is `POST /api/admin/campaign/send` → `approveAndSendCampaign`, covered by its
tests. Screenshots: `docs/screenshots/kampagne-desk/` (2026-09 desk) and
`docs/screenshots/customer-platform/` (`kampagnen`, `kampagne-editor`,
`kampagne-desk`, `kampagne-blackfriday`, `einzelansprache-desk`).

#### Einzelansprache

The built-in system campaign (kind `einzel`, slug `einzelansprache`, created
by migration 0066; always active, no audience, no schedule) for **single,
hand-picked mails** — it replaces the former per-customer marketing e-mail of
the Kunden screen (§4). A person enters it from **Kunden → Marketing →
„Einzelansprache vorbereiten“** (optional „Hinweis für die KI“) or from an
Eingang suggestion („Entwurf übernehmen“, §3.1); both call
`campaigns/add-recipient` / `inbox/accept`, which require the one consent and
no block (409 otherwise), store the operator note as the drafter's brief
(`campaign_contacts.admin_note`), write the draft and open the card on the
Einzelansprache desk (`?campaign=einzelansprache&contact=<id>`). From there it
is the same desk, the same Prüfpunkte and the same send path as every
campaign. Several people at once come from the Kunden list („Auswählen“ →
„Zur Kampagne…“, §3.3; `campaigns/add-recipients`): the Einzelansprache is
preselected, the optional note becomes every recipient's brief, and the
drafts are written on the desk with „Vorbereiten…“ — nothing is drafted or
sent by the add itself. The desk's „Zielgruppe aktualisieren“ is disabled; its
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

**Retired with the client-side list:** the slim list that loaded every person
into the browser (filters Tier, Marketing, Kauf, Versand, Herkunft), the
`?filter=` presets (the two old ones land on the closest view, §2.2), the
**bulk-draft bar** (marketing drafts for many DOI-confirmed customers —
replaced by „Auswählen“ → „Zur Kampagne…“ below, and by campaigns with
Vorbereiten, §3.2) and the **Posteingang** above the list (moved to the
Eingang, §3.1). The unused `searchCustomers` helper of `customer-list-store.ts`
has been removed as well (the Eingang's „Zuordnen“ search uses `customers/list`).

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
  oder gesperrt)“. It replaces the retired bulk-draft bar.

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
| Überblick | **Kennzahlen** from `customer_facts` (Bestellungen, Umsatz, Ø Bestellwert, erster / letzter Kauf, Kaufrhythmus, Lebenszyklus, Wertstufe, Abwanderungsrisiko, nächster Kauf erwartet, Kampagnen-Mails + Klicks 90 T., Kategorien, „Wahrscheinlich als Nächstes“ — complementary products to what the person owns, with price — „Noch nicht berechnet“ until the nightly run; the InfoTip defines Wertstufe as the most expensive single item ever bought); **Datenquellen** (Shopify seit …, Mo n Gespräche, E-Mail n Nachrichten, Shopify-Tags); **Sprache für E-Mails** Automatisch / Deutsch / Englisch — pins `customers.language_override` for every campaign and the Einzelansprache, open recipient rows follow at once (`setCustomerLanguageOverride` in `customer-store.ts`); when saving fails the control snaps back to the stored value; the **AI profile** („Aktuelles Kundenverständnis“: structured facts + text, badge Vollprofil / Kaufprofil, „Neu generieren“ with cost; „Kein KI-Profil ohne Einwilligung“ when `CUSTOMER_AI_PROFILE_SCOPE=consented` excludes the person); **„Widerspruch gegen Profilbildung eintragen“** (Art. 21, confirmed — deletes the stored profile and persona, none is built or used again, and queues the removal of Mo's `mo-` tags in Shopify, §3.10; „Aufheben“); **„Ähnliche Kunden“** (a Disclosure, only for a person with orders, loaded when opened: up to 8 people with the same value tier and at least one shared bought category — most shared categories first, then same lifecycle segment, persona, revenue; deterministic, no tokens — each a link to the person with the shared categories and „ohne Einwilligung“ where the consent is missing; „n von m per E-Mail erreichbar“ and **„Als Zielgruppe verwenden“** → a new campaign with the audience value tier + these categories, `?tab=kampagne&edit=new&audience=<json>`) | `customers/language`, `customers/profile`, `customers/objection`, `customers/similar` |
| Aktivität | one timeline, newest first: orders, Mo chats, campaign mails (with „angeklickt“ for any click), consent changes, mail in / out ([`customer-timeline.mjs`](../src/lib/customer-timeline.mjs); amounts through `admin-format.mjs`); **„Frag Mo“** — a question about this person (3–500 characters) answered from the record in one writer-tier call with cited sources („[n] Datum · Art · Titel“; the AI profile only without an Art. 21 objection) | `customers/ask` |
| Käufe | the order ledger (`customer_orders`, migration 0062: Artikel, Bestellnummer, Rabattcode, storniert, Datum, Summe, Status; „die neuesten n von m“) with paid count, revenue and Ø; for a person not (yet) mirrored the cached per-e-mail history with „Käufe aktualisieren“ | `customers/purchases` |
| Gespräche | the person's conversations with the shared `TranscriptView` and „Im Gespräche-Tab öffnen“ | — |
| Marketing | **Werbe-Einwilligung** — the one consent shared with Shopify: state, Seit, Quelle, „Verlauf (n)“ from `consent_events`; „Abmelden“ on request and „Abmeldung aufheben“ for a mistaken unsubscribe (no e-mail; the change reaches Shopify through the outbox); **Einzelansprache** (only with consent: „Hinweis für die KI“ + „Einzelansprache vorbereiten“, or the open one with „Im Prüftisch öffnen“, §3.2); **Kampagnen** — the person's participation (campaign, status, date, subject, geklickt — any click, the button or the set link —, danach abgemeldet). An open draft of the former personal marketing e-mail stays editable and sendable under „Persönliche E-Mail (bisheriger Weg)“ until it is sent or deleted (§4) | `customers/marketing-optout`, `campaigns/add-recipient`; former path: `customers/marketing-draft`, `marketing/*`, `bundles/*`, `catalog/search`, `email-hero/*` |
| Korrespondenz | sent + received mail threads (lazy body), reply composer with preview | `correspondence/*` |
| Brief | physical letter: AI draft, preview, „Brief senden“ (gated by `PHYSICAL_MAIL_SENDS_APPROVED`); **„Widerspruch gegen Briefwerbung eintragen“** (Art. 21, confirmed — deletes the letter draft; the tab then shows only the objection with „Aufheben“, and drafting and sending are refused) | `customers/letter-draft`, `customers/letter-preview`, `physical/send`, `customers/objection` |

Address auto-capture for letters runs in the daily `refresh-customers` cron,
not on page views. Screenshots: `docs/screenshots/customer-platform/`
(`kunden`, `kunden-ohne-mo`, `kunden-detail-ueberblick`,
`kunden-detail-aktivitaet`, `kunden-detail-kaeufe`, `kunden-detail-marketing`).

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
20 sections, each keeping its honesty caveat verbatim behind the (i) next to
its title. Definitions, caveats and the cache: **§5**. Added with the customer
platform: **Kundenbasis** (Gesamtwerte, §5.17 — the shape of the whole base),
**Eingang** (Marketing & Kampagne, §5.18 — what came up, what was done, what
happened in the 14 days after), **Mo-Effekt** (Gesamtwerte, §5.19 — Mo
customers vs. comparable customers without a chat) and, inside the
Kampagnen-Funnel (title „Kampagnen-Funnel“, no longer „(Shopify-Subscriber)“),
the table **„Kampagnen im Vergleich“** (the same funnel per campaign plus
„Chat gestartet“, §5.9).
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

The per-conversation analysis uses **Claude Haiku 4.5** (`claude-haiku-4-5`,
$1/$5 per MTok in/out); the insights rollup — one synthesis over up to hundreds of
summaries — uses **Claude Sonnet 5.5** (`claude-sonnet-5-5`, $2/$10, adaptive
thinking at `medium`). Both are priced in
[`lib/ai-pricing.mjs`](../src/lib/ai-pricing.mjs); tiers in
[`lib/ai-models.mjs`](../src/lib/ai-models.mjs) (see `docs/AI_MODELS.md`). Usage is recorded in `ai_usage` (`conversation_analysis`
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
webhook, Pingen, Anthropic and OpenAI keys, and the three legal gates — shown
only as configured / not configured, never a value. Details:
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

## 4. Marketing e-mails from the Kunden screen

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

- The Marketing sub-tab only ever offered drafting for **eligible** contacts
  (the bulk-draft bar is retired, §3.3).
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
which additionally read Shopify orders. The customer-platform sections
(Kundenbasis, Eingang, Mo-Effekt — §5.17–§5.19) aggregate the customer tables
(`customer_overview`, `inbox_items`) and show counts and sums only, never an
identity value. Each KPI carries its caveat verbatim in the UI (behind the (i)
of its section).

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
| **Umsatz über Mo-Rabatt­codes** (§5.5) — order `created_at` | Kundenbasis (§5.17) — current state of `customer_overview` |
| **Kampagnen-Funnel** (§5.9) — `campaign_sends` on `sent_at` | Mo-Effekt (§5.19) — current state of `customer_overview` |
| **Eingang** (§5.18) — `inbox_items` on `created_at` | |
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
applies to. The Eingang's 30-day strip (§3.1) is a fixed trailing snapshot and
has no picker.

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
`ai_usage.created_at` index (migration 0012). Two additional breakdowns:

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
  ([`API_CONTRACT.md`](./API_CONTRACT.md) §2), and
  `recordCampaignChatStarted` stores **one session-less** `kpi_events` row
  `campaign_chat_started` (`data: { sendId, campaignId }`) per real send — the
  pseudonymous chat is never tied to the person. Shop-CTA campaigns carry no
  `mo_c`. Until the widget sends the token the column stays at 0.

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

---

## 6. Shopify scopes & API versions

- **Scopes:** `write_discounts` (code creation) and `read_orders` (purchase
  check, the recommendation→purchase loop **and** the revenue KPI's
  `discount_code` → order-total lookup) — both provisioned on the app. The
  customer platform additionally needs `read_customers` (mirror: import,
  webhooks, reconcile), `write_customers` (consent write-back, Shopify
  customers for Mo-only subscribers, erasure requests), `read_all_orders` (to
  import orders older than 60 days) and Protected Customer Data access incl.
  the name/e-mail fields — see [`.env.example`](../.env.example) (reinstall the
  app after adding scopes).
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
`0056` (indexes for the retention sweeps), `0061`–`0068` (the customer
platform: Shopify customer mirror on `customers`, the order ledger
`customer_orders`, `customer_facts`, the one e-mail consent + `consent_events`,
the Shopify sync tables and outbox, `campaigns` with per-campaign recipients in
`campaign_contacts`, `inbox_items`, the `customer_overview` view) and `0069`
(hand-added campaign recipients keep their place in a dynamic audience). The full
schema map is in
[`DATABASE.md`](./DATABASE.md); migrations are forward-only and run manually by
the maintainer.

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

All under `/api/admin/*` — 100 route files —, gated by the Edge proxy **and**
`guardAdminPost(req)` / `guardAdminGet()` in the handler (§1); JSON envelope
`{ error: { code, message } }` on failure. Grouped by the screen that calls
them. Actions that read or act on one person's data write the admin access log
(`recordAdminAccess`, 35 route files) — among them `customers/ask`,
`customers/objection`, `campaigns/add-recipient(s)`, `inbox/accept`,
`inbox/suggest` and `correspondence/assign-prospect`.

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
| | `POST campaigns/audience-preview { audience }` | the editor's live count with consent (total, with Mo, DE / EN as window aggregates, 8 sample names, plain-German description) plus `withoutConsent { total, letterReach }` — the same spec without the consent (the only match that skips it; nothing is materialised) and how many of those a letter could reach (postal address, no objection) |
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
| Kunden, Kampagnen | `POST customers/marketing-optout { customerId \| contactId, action: optout \| lift, confirm: true }` | manual opt-out on request / lift a mistaken unsubscribe (no e-mail, audit-logged; reaches Shopify through the outbox) |
| | `POST customers/erase { customerId \| contactId, confirm: true }` | delete the person completely (`erasePerson`, audit-logged; queues the Shopify side) |
| Kunden | `GET customers/detail?id=` | one customer's full detail (on open) |
| | `GET customers/similar?id=` | „Ähnliche Kunden“: up to 8 people with the same value tier and shared bought categories (consent flag each) + the audience spec that describes them (`{ items, audience }`, pure DB, `listSimilarCustomers`; access log `customer.similar`) |
| | `POST customers/ask { customerId, question }` | „Frag Mo“: one answer from the person's record with cited sources (writer tier; access log `customer.ask`) |
| | `POST customers/profile / purchases` | regenerate the customer profile (409 `profile_not_allowed` outside `CUSTOMER_AI_PROFILE_SCOPE`) / refresh the cached Shopify purchase history |
| | `POST customers/language { customerId, language: de \| en \| null }` | pin / clear the e-mail language (`setCustomerLanguageOverride` in `customer-store.ts`: `customers.language_override`, open recipient rows follow); 404 unknown customer, 500 when it could not be saved (also without a database) |
| | `POST customers/objection { customerId, kind: profile \| postal, objected }` | record / lift an Art. 21 objection: `profile` deletes the AI profile and stops it and queues the removal of Mo's `mo-` tags in Shopify (`removeInsightTags`, §3.10), `postal` stops advertising letters (access log `customer.objection`) |
| | `POST customers/marketing-draft` | per-customer marketing draft of the former path (§4.2; no longer started from the UI) |
| | `POST marketing/update / email-preview / send / delete` | edit, preview, approve & send (`approveAndSend`), delete an open draft of the former path |
| | `POST bundles/suggest / create / archive / delete` | Set-Angebot composer |
| | `POST catalog/search { query }` | product search for the composer and pickers |
| | `POST correspondence/send / message / assign / email-preview` | reply (closes the person's open „E-Mail beantworten“ item → `closedItems`), lazy body, assign unmatched inbound (now from the Eingang; opens the item → `itemId`), preview |
| Eingang | `POST correspondence/assign-prospect { messageId }` | „Als Interessent anlegen“: a customer from the sender (no consent), the mail assigned, the item opened → `{ customerId, itemId }` (access log `correspondence.assign_prospect`) |
| | `POST customers/letter-draft / letter-preview`, `POST physical/send` | physical letter (`letter-draft` 409 after a postal objection) |
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

Removed with the customer platform: `POST campaign/sync` (Shopify newsletter
subscribers into `campaign_contacts`, „Jetzt synchronisieren“) — replaced by the
customer mirror and `campaigns/refresh` („Zielgruppe aktualisieren“).

Removed in 2026-09 as unused: `GET directives`, `GET email-designs`,
`POST bundles/list`, `POST marketing/draft` (per-capture draft),
`POST qa/draft`.
