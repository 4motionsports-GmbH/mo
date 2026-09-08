# Cleanup audit — UX and technical findings

Status: **draft for review** (Phase 1 of the project clean-up). Companion documents:
[`FEATURE_INVENTORY.md`](./FEATURE_INVENTORY.md) (the checklist we verify against at the end)
and the screenshots under [`screenshots/`](./screenshots/).

Baseline measured on `main` @ `9c6b551`: lint 0 errors / 1 warning, `tsc` clean,
813 unit tests green, `next build` 41 s, 108 routes.

Severity scale used below: **P1** must fix (bug, security, data or money at risk),
**P2** should fix (efficiency, correctness edge, maintainability that blocks the redesign),
**P3** nice to have.

---

## Part 1 — UX findings

### 1.0 Cross-cutting (affects every tab)

| ID | Finding | Proposed change |
| --- | --- | --- |
| UX-G1 | **Too much text.** Every section carries a subtitle sentence and most controls a helper paragraph (≈ 120 explanatory texts across the admin, many 2–4 lines). The operator reads the same explanations on every visit. | One `InfoTip` primitive (icon button, hover + focus + tap, keyboard reachable, portal-rendered). All explanatory copy moves behind it verbatim; labels get shortened. Caveats on KPIs keep their exact wording inside the tip. |
| UX-G2 | **Navigation is a flat row of 10 pills** ordered by history, not by work. At 1024 px the row overflows and is clipped (no wrap/scroll). Two tabs (Übersicht, KPIs) are "deferred" and behave differently (full navigation) from the other eight (instant switch). | Grouped sidebar navigation (Arbeit · Einblicke · System) with the same German labels, same `?tab=` keys, same `1–9` shortcuts and `/`-to-search. Collapses to an icon rail on tablet. Every tab becomes a normal navigation (see TECH-A1) so behaviour is uniform. Live counts (Kampagne queue, Posteingang, offene Wissen-Fragen) as badges. |
| UX-G3 | **Content width jumps** between tabs (`max-w-5xl` vs `max-w-7xl`), so the header and nav shift when switching. | One fluid content area inside the shell; prose-like pages (Einstellungen) use an inner max width. |
| UX-G4 | **Page header duplicates the tab name** and adds a long subtitle (`TAB_SUBTITLE`), e.g. "Kunden · Suche, filtere & öffne eine Person — Profil, Käufe, Marketing, Korrespondenz & Brief". | `PageHeader` primitive: title = tab name, optional one-line description behind an InfoTip, right-aligned primary actions of the screen. |
| UX-G5 | **Inconsistent empty / not-configured states.** Some tabs replace the whole workspace with a banner (Kunden with 0 customers, Feedback with 0 rows) so filters and actions disappear; others render inline boxes; nine copies of a `Banner` component exist. | `Callout` (info/warning/success/destructive) and `EmptyState` primitives; toolbars always stay visible. |
| UX-G6 | **Destructive confirmations are mixed:** native `window.confirm()` in 8 places (marketing send, draft delete, bundle archive/delete, correspondence send, letter send, run delete) versus the `Dialog` primitive elsewhere. | One `ConfirmDialog` / `useConfirm()`; confirm only irreversible or costly actions (sends, deletes, paid AI runs over a threshold); no confirm for reversible ones (skip, archive-with-undo). |
| UX-G7 | **No type scale / spacing scale.** Ad-hoc `text-[10px]`, `text-[11px]`, `text-[12px]`, `text-[13px]`, `text-[15px]`; icon sizes and margins vary per file. | Design tokens for type (2xs…2xl), spacing (4-px scale), radius; icons sized by the parent (`Button` already does `[&_svg]:size-4`). See Part 3. |
| UX-G8 | **Accessibility gaps:** icon-only buttons with `title` but no `aria-label` (DirectivesCard history/edit/toggle, Wissen reload, several ✕ buttons); `Tabs` without arrow-key navigation; `Dialog` without focus trap or focus return; tooltips implemented as `title` attributes (not reachable on touch, not announced). | Fix in the primitives: `IconButton` requires a label, `Tabs` gets roving focus, `Dialog` traps and returns focus, `InfoTip` is a real accessible disclosure. |
| UX-G9 | **Full page reloads after mutations** in Kampagne (`window.location.reload()` after prepare, sync, reset, unskip, draft) lose scroll position and re-render every tab body on the server (see TECH-A1). | Targeted state updates or `router.refresh()`; with per-tab rendering a refresh becomes cheap. |
| UX-G10 | **Dark mode** is token based and works, but chart label fills and the email/letter preview frames use hard-coded white. The previews are documents and should stay white; chart labels should use tokens. | Chart tokens (`--chart-1..5`), keep document previews white deliberately. |
| UX-G11 | **Keyboard shortcuts are invisible** (shell `1–9`, `/`; Kampagne `N P V C S X`). | A `?` shortcut sheet and `Kbd` hints in the relevant toolbars. |

### 1.1 Übersicht

| ID | Finding | Proposed change |
| --- | --- | --- |
| UX-U1 | The four "Schnellzugriff" links duplicate the navigation; the tab has no view of *what needs doing today*. | Replace with a **"Heute"** block: Kampagne (Offen/Entwürfe/Heute gesendet), Posteingang nicht zugeordnet, Wissen offen, laufende Analysen — each a deep link. Keep the five headline stats and the two activity lists. |
| UX-U2 | Loading the overview runs the whole marketing-target pipeline including a Shopify order lookup **per contact** only to display two numbers (eligible / "beraten, nicht gekauft"). | Compute both from the database (DOI status + cached purchase summary). **Decision needed** — see Part 5, D-1: the "nicht gekauft" number would then rely on the cached Shopify purchase history (refreshed daily by cron and on demand) instead of a live query on every overview load. |
| UX-U3 | Fixed 30-day window without saying so prominently. | Show the window in the section title ("Letzte 30 Tage") with an InfoTip; the date picker stays on KPIs. |

### 1.2 Kunden

| ID | Finding | Proposed change |
| --- | --- | --- |
| UX-K1 | The list and **every customer's full detail** (all sessions with full transcripts, bundles, correspondence metadata, letters, latest marketing send) are rendered on the server and shipped to the browser on each `/admin` load — for every customer. With a few hundred customers this is seconds of server time and megabytes of payload before the operator sees anything. | Slim list query (id, name, email, tier, flags, last seen); detail fetched on selection (like Gespräche). Search/filter/sort stay instant on the slim list. |
| UX-K2 | Tier badges `T1/T2/T3` are cryptic. | Badge with InfoTip ("Tier 2 · E-Mail bekannt (Double-Opt-in offen/bestätigt)" etc.). |
| UX-K3 | Detail card: sub-tab structure is good, but section headings are visually weak (`text-xs muted`), the Marketing sub-tab has five helper paragraphs and a collapsible bundle composer stacked above the draft settings. | Keep the six sub-tabs. Group draft *settings* (Hinweise, Rabatt, Textmodus) in one compact row, the editor below, actions in a sticky footer; bundle composer as a side panel ("Set-Angebot") with its own header; helper texts → InfoTip. |
| UX-K4 | Transcript viewer in "Beratungen" (plain text) differs from the Gespräche transcript (markdown, timestamps, tool chips). | One `TranscriptView` component used by both, plus "Im Gespräche-Tab öffnen". |
| UX-K5 | Bulk-draft bar is good; "Käufe aktualisieren" and "Kundenverständnis generieren" are clear. Native `confirm()` before sending. | ConfirmDialog with the recipient, subject and discount shown. |
| UX-K6 | Unmatched inbox appears only inside Kunden. | Keep it there (it is triage for customers) and add a sidebar badge count so it is noticed. |

### 1.3 Kampagne (heavy daily use — keep every behaviour)

| ID | Finding | Proposed change |
| --- | --- | --- |
| UX-C1 | Header strip mixes six counts, the opt-in summary and five controls (Sync, Rabatt-Select, Textmodus-Select, "Nächste 50 vorbereiten", "Warteschlange neu aufbauen") in one wrapping row; on a tablet it wraps to three lines. | Two rows: a stat strip (counts as `Stat` chips) and a toolbar; "Warteschlange neu aufbauen" moves to an overflow menu (it is rare and destructive). |
| UX-C2 | The reviewer edits prose in a **monospace 12 px textarea** and must open a dialog to see the rendered mail. | Card gets an inline segmented "Text · Vorschau" switch (rendered preview in place, debounced), the full-size dialog stays. Textarea uses the body font. |
| UX-C3 | Left column stacks contact, Kaufhistorie (checkboxes), Empfehlungen, Rabatt, Set-Angebot — each with helper text; card is very tall. | Collapsible groups with summaries in the header (e.g. "Rabatt · 10 %", "Set · 2 Produkte"), helper texts → InfoTip. Default open: Empfehlungen; the others collapsed unless non-default. |
| UX-C4 | "Nächste 50 vorbereiten" shows progress only in the button label, then reloads the page. | Inline progress bar with counts and a cancel; results applied without reload. |
| UX-C5 | "Gesendet" view is a plain table limited to the last 100 sends, no search, no date filter, no delivery state (bounces from migration 0055 are only in KPIs). With ~200 sends/day the view is useless after a day. | Paginated table with search (email/subject), date filter, delivery status column, "Ansehen" action; server-side pagination. |
| UX-C6 | The A/B hero badge ("gerade Kontakt-ID: mit Hero") relies on the operator remembering the rule. | Keep the badge, add InfoTip, and show the current A/B counts in the stat strip. |
| UX-C7 | File is 2 338 lines: state machine, 12 mutations, 10 sub-components, dialogs and badges in one client module. | Split into `kampagne/` (workspace, queue rail, review card, sections, sent history, badges, dialogs, `useCampaignActions`). No behaviour change in the send path. |

### 1.4 KPIs

| ID | Finding | Proposed change |
| --- | --- | --- |
| UX-P1 | 17 sections stacked on one page (6–8 screens tall), each with a caveat paragraph; nothing can be found without scrolling. | In-page section navigation (sticky): Beratung · Marketing & Kampagne · Umsatz · Kosten · Gesamtwerte; caveats verbatim behind InfoTips on section titles; hero A/B table and segment table stay as they are (decision). |
| UX-P2 | Every KPI page view runs 18 aggregations including up to ~330 Shopify API calls (revenue codes, campaign codes, recommendation loop, marketing funnel). Load time is seconds and the calls are repeated on every range change. | Cache the Shopify-dependent results per range for 10 minutes (server cache keyed by range) and show "Stand: hh:mm · Aktualisieren". Pure DB sections stay live. |
| UX-P3 | File is 1 758 lines. | One file per section under `kpi/`, shared `BarList`, `Th/Td` replaced by `ui/table`. |

### 1.5 Gespräche

| ID | Finding | Proposed change |
| --- | --- | --- |
| UX-S1 | Filter card is dense (two rows, six controls, inline label spans). | `FilterBar` primitive with labelled controls and active-filter chips; custom range in a popover. |
| UX-S2 | Three helper paragraphs (distribution hint, report caveat, analysis hint). | InfoTips. |
| UX-S3 | Structure (stats → list/detail → collapsed report) is good. | Keep. |

### 1.6 Wissen

| ID | Finding | Proposed change |
| --- | --- | --- |
| UX-W1 | Every entry renders as a full open form (gap, question, product handle, answer, link picker, preview, English override, buttons) — 20 entries ≈ 20 screens. | Compact list rows (status, question, product, age) that expand one entry at a time into the editor; keyboard `j/k` optional. |
| UX-W2 | Product is a free-text **handle** input. | `CatalogProductPicker` to set/clear the product; handle shown read-only. |
| UX-W3 | No search over entries. | Search box in the toolbar. |
| UX-W4 | Reload icon button without `aria-label`; four helper texts. | Fix label; InfoTips. |

### 1.7 Feedback

| ID | Finding | Proposed change |
| --- | --- | --- |
| UX-F1 | Works; the empty state removes the toolbar; cards could be denser. | EmptyState inside the list; keep cards (they carry free text). Newsletter ratings (`page = email:*`) get a distinct badge. |

### 1.8 Analyse

| ID | Finding | Proposed change |
| --- | --- | --- |
| UX-A1 | Generator has two checkboxes with two-line explanations and a long description. | InfoTips; keep the live estimate (good). |
| UX-A2 | Sidebar + report view are fine. | Keep; align list rows with the Verbesserung sidebar (shared `SidebarList`). |

### 1.9 Verbesserung

| ID | Finding | Proposed change |
| --- | --- | --- |
| UX-V1 | "Neuer Verbesserungslauf" card carries a three-step explanation. | Collapsible "So funktioniert es" (open on first visit only) or InfoTip. |
| UX-V2 | DirectivesCard: three icon-only buttons without labels; long intro paragraph. | IconButton with labels; InfoTip. |
| UX-V3 | Suggestion cards are already decision-oriented. | Keep. |

### 1.10 Einstellungen

| ID | Finding | Proposed change |
| --- | --- | --- |
| UX-E1 | Design-Bibliothek shows four preview buttons per design (12 buttons). | One "Vorschau" per design with a type selector inside the dialog. |
| UX-E2 | The tab only covers e-mail designs; operators have no place to see which integrations/flags are active. | Additive read-only **Systemstatus** card (DB, Shopify, Resend, Pingen, OpenAI/Anthropic keys present, `CAMPAIGN_SENDS_APPROVED`, `CAMPAIGN_ALLOW_SINGLE_OPT_IN`, `PHYSICAL_MAIL_SENDS_APPROVED`). Values only as configured/not configured, never secrets. |
| UX-E3 | Four helper texts. | InfoTips. |

### 1.11 Login

| ID | Finding | Proposed change |
| --- | --- | --- |
| UX-L1 | Fine. No rate limit on attempts (see TECH). | Small polish only (logo, spacing). |

---

## Part 2 — Technical findings

_(filled from the code audit — see below; ranked P1 → P3)_

Method: first-hand review of the admin tree, the campaign send path, the chat route, retention, auth, webhooks and
token links, plus mechanical scans (route callers, env usage, schema/index dump, bundle analysis). The module map
of `src/lib` (dead exports, duplicated helpers, dependency check) is being completed and its results are appended
in §2.6.

### 2.1 Correctness and data safety

| ID | Sev | File | Problem | Proposed fix |
| --- | --- | --- | --- | --- |
| TECH-C1 | **P1** | `src/lib/retention.ts:96-108,151-190` | Five retention windows (`RETENTION_DAYS`, `KPI_RETENTION_DAYS`, `SUPPRESSED_CAPTURE_PURGE_DAYS`, `CORRESPONDENCE_RETENTION_DAYS`, `PHYSICAL_LETTER_RETENTION_DAYS`) are parsed with a minimum of **0** and used directly as `daysAgo(n)` cutoffs. Setting any of them to `0` deletes **every row** of that table on the next nightly cron run. The other six windows treat `0` as "disabled" — the semantics are inconsistent and the dangerous half is undocumented. | One rule for all windows (`0` = disabled) plus a hard minimum of 1 day for hard-delete windows; options parsing moves into a tested `.mjs` core (`retention-options.mjs`); `.env.example` and DATA_RETENTION.md updated. |
| TECH-C2 | P2 | `src/lib/customer-store.ts:540,691` | `CUSTOMER_LIST_LIMIT = 100`: the Kunden tab silently shows only the 100 most recently seen customers; older ones are unreachable from the UI (no pagination, no hint). | Slim list query without the cap (server-side search/paging), detail loaded on demand (UX-K1). |
| TECH-C3 | P2 | `src/lib/campaign-store.ts:1537` + `KampagneWorkspace` "Gesendet" | `listCampaignSendHistory(limit = 100)`: the sent view truncates after ~half a day at the planned 200 sends/day, without saying so. | Server-side pagination + search + date filter (UX-C5). |
| TECH-C4 | P2 | `src/app/admin/login/page.tsx` | No rate limiting on password attempts against the single shared admin password (all other public POST routes are limited). | `checkRateLimit(req, "admin-login")` bucket (e.g. 10 / 10 min per IP) in the login action. |
| TECH-C5 | P3 | `src/lib/campaign-store.ts:1027-1075` | `stampCampaignDelivery` falls back from the provider e-mail id to "any send to this address in the last 7 days" — a bounce can stamp a different send to the same recipient. Rare (frequency cap) but possible. | Prefer the newest send, stamp at most one row in the fallback. |
| TECH-C6 | P3 | `src/lib/admin-conversations.ts:353-470` | The 50-line WHERE clause of the Gespräche list is duplicated verbatim in the page and count queries (Neon templates are not composable); a filter fix applied to one query only would silently desynchronise list and total. | One query with `count(*) OVER ()`, or a shared CTE; add a unit test on the filter-to-SQL parameters. |
| TECH-C7 | P3 | `src/app/api/kpi/route.ts` | The telemetry ingest writes with a raw `getSql()` in the route instead of a store function — the only route doing so. | Move the insert into `kpi-events.ts`. |

### 2.2 Efficiency

| ID | Sev | Where | Problem | Proposed fix |
| --- | --- | --- | --- | --- |
| TECH-E1 | **P1 (perf)** | `src/app/admin/page.tsx`, `AdminShell.tsx` | Every `/admin` request server-renders **eight** tab bodies (all but the inactive one of Übersicht/KPIs) and ships them force-mounted: Kunden (all customers with every session transcript + 4 queries per customer), Kampagne (queue, history incl. up to 30 Shopify redemption calls), Gespräche, Wissen, Analyse, Verbesserung (full rendered system prompt), Einstellungen. Every campaign mutation that reloads the page repeats all of it. | Render only the active tab (D-2). |
| TECH-E2 | P1 (perf) | `src/app/admin/page.tsx:187-268` | Per-customer awaits inside `Promise.all(customers.map(…))`: `getLatestSendForEmail`, `listBundleOffersWithSignalsForCustomer`, `listCustomerMessages`, `listCustomerLetters` → 4 × N queries (N ≤ 100) on every render; `batchLoadCustomerSessions` additionally loads **all messages of all conversations** of those customers. | Slim list; detail on demand; batch queries keyed by customer id. |
| TECH-E3 | P2 | `src/app/admin/page.tsx:183` | `after(() => autoCaptureMissingAddresses({ limit: 12 }))` runs on **every** `/admin` render because `KundenTab` is always rendered — viewing any tab triggers Shopify calls and DB writes. | Move into the daily `refresh-customers` cron (which already refreshes addresses) and an explicit action on the Kunden screen. |
| TECH-E4 | P2 | `src/lib/marketing-store.ts:listMarketingTargets` (used by Übersicht) | Up to 200 captures × (conversation load + latest send + **Shopify order lookup**) on every overview load, to display two numbers. | Database-only aggregate (D-1). |
| TECH-E5 | P2 | `src/app/admin/KpiTab.tsx` | 18 parallel aggregations per view including up to ~330 Shopify calls (`getMoRevenue` ≤ 100 codes, `getCampaignKpis` ≤ 100, `getRecommendationLoop` ≤ 100, `getMarketingFunnel` ≤ 100 minus overlap); no caching; repeated on every range change. | Per-range server cache (10 min) for the Shopify-dependent sections with a visible timestamp (D-4). |
| TECH-E6 | P2 | `src/app/admin/KampagneTab.tsx:112-125` | Up to 30 `wasDiscountCodeRedeemed` Shopify calls per render of the Kampagne tab, only for the "Eingelöst" column of the history table. | Load redemption status on demand in the paginated history (or reuse the KPI cache). |
| TECH-E7 | P2 | client bundle | `/admin` ships 1 188 KB (344 KB gzip) of JS on every tab; the 647 KB admin chunk contains Recharts, needed only on KPIs. | Per-screen rendering + `next/dynamic` for the charts; target ≤ 150 KB gzip for non-KPI screens. |
| TECH-E8 | P3 | `src/lib/admin-conversations.ts` | Free-text search is `ILIKE` over `messages.content` via `EXISTS` per term (sequential scan while searching). Fine at today's scale. | `pg_trgm` GIN index on `messages.content` when the table grows (future migration). |
| TECH-E9 | P3 | schema | No index on `email_messages(occurred_at)` and `physical_letters(created_at)`, both used by nightly retention deletes (small tables today). | Add in the next migration together with any other index work. |

### 2.3 Duplication and structure

| ID | Sev | Where | Problem | Proposed fix |
| --- | --- | --- | --- | --- |
| TECH-D1 | P2 | `KampagneWorkspace.tsx` 2 338, `KpiTab.tsx` 1 758, `CustomerProfileCard.tsx` 1 521, `campaign-store.ts` 1 607, `system-prompt-core.mjs` 1 231, `GespraecheWorkspace.tsx` 841, `VerbesserungWorkspace.tsx` 804 | Files far above the ~600-line guideline mixing several responsibilities. | Split by responsibility (Part 4.3); stores split by concern (`campaign-store` → contacts / drafts / sends / kpis). |
| TECH-D2 | P2 | `src/app/admin/**` | ~12 copies of the fetch→JSON→throw helper, ~14 local money/date/percent formatters, 9 `Banner` copies, 3 segmented toggles, 2 stepping-loop drivers, 2 transcript viewers. | Primitives + `adminFetch` + `admin-format.mjs` (Part 3.6). |
| TECH-D3 | P2 | `src/lib/campaign-email.ts` ↔ `src/lib/marketing-email.ts` | `approveAndSendCampaign` and `approveAndSend` are ~260-line near-twins (gates → unsubscribe token → claim → discount mint/swap → render in design → send → record), each with private copies of `firstImageUrl` and `catalogNameLookup`. | Extract the shared, pure steps (discount swap already is; `firstImageUrl`, `catalogNameLookup`, the design/hero render wrapper) into one module **with characterisation tests first**; the two orchestrators stay separate because their gates and records differ. Send behaviour unchanged. |
| TECH-D4 | P3 | `src/app/admin/page.tsx:62-80` | Nine-level nested ternary to resolve `?tab=`. | Tab registry (`tabs.ts`). |
| TECH-D5 | P3 | `src/app/api/contact/route.ts` | Sends via the Resend SDK directly instead of `lib/email` (the choke point every other mail uses). Intentional for lead mail, but the inconsistency should be a comment or a shared helper. | Route through `sendEmail` with `kind: "contact"` (no mirror row) or document why not. |

### 2.4 Security

| ID | Sev | Finding |
| --- | --- | --- |
| TECH-S1 | ✓ | Every `/api/admin/*` handler re-asserts the session cookie (`guardAdminPost`/`guardAdminGet`); POST routes require `application/json` as CSRF defence; the Edge proxy gates pages and APIs. No admin route relies on the proxy alone. |
| TECH-S2 | ✓ | Webhooks verify signatures over the raw body before parsing (Resend via the SDK's standard-webhooks verifier, Shopify HMAC, Pingen standard-webhooks with multi-secret) and fail closed (503) without a secret. |
| TECH-S3 | ✓ | Token links: unsubscribe = HMAC over the normalised e-mail with constant-time compare (no expiry, correct for opt-out); redirects = 24 random bytes per send; countdown = signed deadline; DOI token expires. Public asset routes validate paths and cache correctly. |
| TECH-S4 | ✓ | User-provided content: the admin Markdown renderer emits React nodes only with an href whitelist; Q&A HTML is escaped and only http(s) anchors are emitted; e-mail prose is escaped before rendering. |
| TECH-S5 | P2 | Admin login has no attempt limit (TECH-C4). |
| TECH-S6 | P3 | `.env.example` ships the three legal send gates ON (D-8); Sentry is documented as uploading source maps but is not wired (docs fix). |

### 2.5 Configuration and documentation drift

| ID | Sev | Finding | Fix |
| --- | --- | --- | --- |
| TECH-X1 | P2 | `ANALYTICS_REPORT_RETENTION_DAYS` (GDPR-relevant), `CONVERSION_SWEEP_MAX_CODES`, `EMAIL_LOGO_URL`, `EMAIL_MO_ICON_URL`, `SHOPIFY_APP_PROXY_SECRET`, `NEON_FETCH_ENDPOINT` are read by code but missing from `.env.example`. | Document them. |
| TECH-X2 | P3 | `SHOPIFY_CUSTOMER_ACCOUNT_API_VERSION` is documented but never read. | Remove. |
| TECH-X3 | P3 | `.env.example` `CRON_SECRET` comment lists four of five crons; README env table lists 21 of 79 variables and claims completeness; README architecture tree lists 4 routes / 12 libs (2026-Q1); `base-url.ts` falls back to `chat.motionsports.de` while `.env.example` shows `mo.motionsports.de` as example host. | Rewrite README (deploy checklist stays), fix comments. |
| TECH-X4 | P3 | Five scripts have neither an npm entry nor a doc reference; two need `tsx`, which is not a dependency; `probe-bundle.mjs` is a throwaway probe that creates live Shopify products. | Part 6.2 (decision D-9); add `tsx` as devDependency + npm scripts for the kept ones. |
| TECH-X5 | P3 | ADMIN_DASHBOARD.md claims server-side tab switching and omits the Einstellungen tab; 14 historical docs sit next to living ones. | Docs slice: rewrite ADMIN_DASHBOARD.md, archive historical docs with an index, add `CLAUDE.md`. |
| TECH-X6 | P3 | Lint warning: unused `firstImageUrl` in `summary-email.ts:143`. | Remove. |

### 2.6 Module map results (dead exports, unused dependencies, duplicated lib helpers)

MODULE_MAP_RESULTS_PLACEHOLDER

---

## Part 3 — Proposed design system

### 3.1 Principles
- Calm, professional back office: one accent colour (brand blue) for interactive emphasis, status colours only for status, neutral surfaces everywhere else.
- Controls first, prose second: short labels; every explanation lives behind an `InfoTip`.
- One spacing scale, one type scale, one radius scale, one elevation (border + hairline shadow). No ad-hoc pixel values in components.
- Dark mode is a token swap, never a component branch.

### 3.2 Colour tokens (`src/app/admin/theme.css`)
Keep the existing semantic tokens (`background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `success`, `warning`, `info`, `border`, `input`, `ring`, `brand-*`) and add:

| Token | Purpose | Light | Dark |
| --- | --- | --- | --- |
| `--surface-2` | inset surfaces: table heads, code, nested panels | `#f4f5f7` | `#1a1e22` |
| `--accent-soft` | selected rows, active nav item | `color-mix(accent 10%, card)` | same |
| `--sidebar` / `--sidebar-foreground` | navigation rail | `#ffffff` / `#111111` | `#101316` / `#f3f4f6` |
| `--chart-1…5` | chart series (accent, success, warning, info, muted) | tokens | tokens |

Status styling is centralised in `StatusBadge` and `Callout` (`bg-<status>/10 text-<status> border-<status>/30`), so no file composes status classes by hand.

### 3.3 Type scale (Montserrat, self-hosted — unchanged)
| Class | Size / line | Use |
| --- | --- | --- |
| `text-2xs` | 11 / 16 | fine print, table meta |
| `text-xs` | 12 / 16 | labels, badges, captions |
| `text-sm` | 13.5 / 20 | table and form body |
| `text-base` | 14.5 / 22 | prose |
| `text-lg` | 17 / 24 | section titles |
| `text-xl` | 20 / 28 | page title |
| `text-2xl` | 26 / 32 | KPI values |

Weights: 400 body, 500 labels, 600 titles and buttons. Numbers use `tabular-nums`.

### 3.4 Spacing, radius, controls
- 4-px scale: 4, 6, 8, 12, 16, 20, 24, 32, 40. Page gutter 24 (≥ lg) / 16. Card padding 16 (compact) / 20. Section gap 32.
- Radius: 6 (small controls, badges), 8 (inputs, buttons), 12 (cards), 16 (dialogs).
- Control heights: 36 default, 32 small, 28 icon-small. Focus ring: 2 px `ring` with offset on the page background.

### 3.5 Layout primitives
- **App shell**: sidebar 240 px (icon rail 64 px below 1180 px, drawer below 900 px) with grouped navigation and count badges; top bar with page title, InfoTip description, actions, theme toggle, logout.
- **PageHeader**, **Toolbar/FilterBar** (search + selects + active-filter chips + reset), **SplitPane** (list/detail with sticky list, stacks on tablet), **Section** (title + optional InfoTip + actions).

### 3.6 Component inventory (`src/app/admin/ui`)
Keep and refine: `cn`, `Button` (primary · secondary · outline · ghost · destructive · link; sm · md · lg · icon · icon-sm), `Input`, `Textarea`, `Label`, `Select`, `Checkbox`, `Badge`, `Card*`, `Skeleton`, `Table*`, `Tabs` (roving focus, `pill` and `underline` variants), `Dialog` (focus trap/return, sizes), `Toast`, `Stat` (InfoTip, optional delta), `Markdown`, `CatalogProductPicker`.

New: `InfoTip` (the one tooltip/popover primitive; hover, focus, click/tap; Esc/outside closes; viewport-aware placement; portal into `#admin-root`), `Tooltip` (same engine for icon buttons), `Callout`, `EmptyState`, `ConfirmDialog` + `useConfirm`, `PageHeader`, `FilterBar`, `SplitPane`, `SegmentedControl` (replaces LanguageToggle, EmailTextModeToggle and the preview-width switch), `IconButton` (label required), `DataTable` (sortable header, sticky head, loading/empty rows), `Pagination`, `DescriptionList`, `Kbd`, `Spinner`, `ProgressBar`, `Field` (label + control + InfoTip + error), `StatusBadge`, `Disclosure`, `Sheet` (tablet detail drawer), `TranscriptView`.

Client helpers: `adminFetch()` (one fetch → JSON → typed error helper replacing ~12 copies of `callApi`/`call`/`post`), `useAsyncAction()`, and `src/lib/admin-format.mjs` (`eur`, `num`, `pct`, `relativeTime` — unit-tested, replacing ~14 local formatters).

---

## Part 4 — Proposed target structure

### 4.1 Navigation (grouped sidebar; labels, `?tab=` keys and shortcuts unchanged)
| Group | Screen | Key | Notes |
| --- | --- | --- | --- |
| Arbeit | Übersicht | `overview` | "Heute" block + headline stats + activity |
| Arbeit | Kampagne | `kampagne` | Warteschlange · Gesendet · Übersprungen |
| Arbeit | Kunden | `kunden` | list + detail (six sub-tabs unchanged) + Posteingang badge |
| Arbeit | Wissen | `wissen` | compact queue with expand-in-place editor |
| Einblicke | KPIs | `kpi` | in-page section navigation |
| Einblicke | Gespräche | `gespraeche` | unchanged structure |
| Einblicke | Feedback | `feedback` | unchanged structure |
| Einblicke | Analyse | `analyse` | unchanged structure |
| Einblicke | Verbesserung | `verbesserung` | unchanged structure |
| System | Einstellungen | `einstellungen` | e-mail designs, Versand, Systemstatus |

Legacy keys (`?tab=customers`, `?status=`) keep redirecting.

### 4.2 Rendering model
Today `page.tsx` renders eight tab bodies on every request and force-mounts them client-side; two tabs are "deferred" and behave differently. Target: **render only the active tab on the server**; the sidebar uses `Link` navigations (prefetched on hover). Consequences: the first byte for `/admin` drops from "everything" to "one screen"; the RSC payload shrinks by an order of magnitude; the 647 KB admin chunk splits per screen (Recharts loads only on KPIs); in-progress edits are scoped to the screen you are on (leaving a screen is a deliberate act, and drafts are persisted server-side already — Kampagne autosaves, Kunden/Wissen/Brief have explicit save). This is a change in how tab switching feels (a fast navigation instead of an instant swap) — **decision D-3**.

### 4.3 Files to split (by responsibility)
| Today | Target |
| --- | --- |
| `KampagneWorkspace.tsx` (2 338) | `kampagne/{KampagneWorkspace, QueueHeader, QueueRail, ReviewCard, PurchaseHistorySection, RecommendationsEditor, DiscountControl, BundleSection, SentHistory, badges, dialogs}.tsx`, `kampagne/useCampaignActions.ts` |
| `KpiTab.tsx` (1 758) | `kpi/KpiTab.tsx` + `kpi/sections/*.tsx` (one per section) + `kpi/BarList.tsx` |
| `CustomerProfileCard.tsx` (1 521) | `kunden/CustomerDetail.tsx` + `kunden/tabs/{Profil,Beratungen,Kaeufe,Marketing,Korrespondenz,Brief}.tsx` + `kunden/BundleComposer.tsx`; slim list + on-demand detail route |
| `GespraecheWorkspace.tsx` (841), `VerbesserungWorkspace.tsx` (804) | split filters / list / detail; run driver shared with Analyse's progress driver (`useStepLoop`) |
| `page.tsx` tab switch (nested ternary) | `tabs.ts` registry: key → label → group → loader → component |

### 4.4 Screens merged, moved or reworked (no capability removed)
- Übersicht quick links → "Heute" tasks (deep links into the same screens).
- Kampagne "Gesendet" → paginated, searchable table with delivery state.
- Kunden list → slim list; detail on demand; transcript viewer shared with Gespräche.
- Wissen entries → list + expand-in-place editor; product via picker.
- Einstellungen → per-design preview with type selector; additive Systemstatus card.
- All nine `Banner` copies, ~12 fetch helpers, ~14 formatters, three segmented toggles → primitives.

---

## Part 5 — Decisions needed from you

| ID | Decision | My recommendation | Why it needs you |
| --- | --- | --- | --- |
| D-1 | Übersicht "Beraten, nicht gekauft" and "Marketing-Kontakte" from the database (cached purchase history) instead of a live Shopify order lookup per contact on every overview load. | Yes — the numbers become instant and consistent with the Kunden filter; freshness is the daily customer refresh cron plus manual "Käufe aktualisieren". | Changes the definition of a number the team looks at. |
| D-2 | Tab switching becomes a real (fast) navigation; only the active screen is rendered. | Yes — biggest single performance and payload win; enables per-screen code splitting. | Changes the feel of the daily workflow (no longer "everything mounted at once"). |
| D-3 | Grouped sidebar navigation instead of the pill row. | Yes — scales to 10+ screens, adds live counts, works on tablets. | Changes navigation the team uses daily. |
| D-4 | KPI Shopify-dependent sections cached for 10 minutes with a visible timestamp and "Aktualisieren". | Yes — turns a multi-second page into a sub-second one; freshness need is low for these numbers. | Numbers can be up to 10 minutes stale. |
| D-5 | Add a read-only Systemstatus card to Einstellungen. | Yes — additive, no secrets shown. | New UI surface. |
| D-6 | Local development against a plain Postgres via `NEON_FETCH_ENDPOINT` + `scripts/seed-dev.mjs` (dev-only, refuses non-local hosts). | Yes — used for this project's screenshots and verification; documented in DATABASE.md. | New dev tooling in the repo. |
| D-7 | Admin login rate limiting (Upstash bucket) — currently unlimited attempts against one shared password. | Yes. | Touches auth. |
| D-8 | `.env.example` ships the three legal send gates (`CAMPAIGN_SENDS_APPROVED`, `CAMPAIGN_ALLOW_SINGLE_OPT_IN`, `PHYSICAL_MAIL_SENDS_APPROVED`) as `true`; the code defaults are `false`. Flip the example values to `false` (production is set in Vercel, unaffected). | Yes — a fresh `.env.local` copy should not enable live sends. | Changes documented defaults. |
| D-9 | Remove the five dead admin routes and the throwaway probe script listed in Part 6.2. | Yes. | Removes capability (unused, but yours to confirm). |

---

## Part 6 — Proposed removals and merges (each with a one-line justification)

### 6.1 Code that is provably unreachable or duplicated (I will remove/merge without asking)
| Item | Justification |
| --- | --- |
| Nine local `Banner` components | identical markup; replaced by `Callout` |
| Per-file `callApi` / `call` / `post` / `reportError` / `fail` helpers (~12) | identical behaviour; replaced by `adminFetch` + `toastError` |
| Per-file `formatEuro` / `eur` / `money` / `fmtMoney` / `num` / `pct` / `fmtDate` / `fmtTs` (~14) | replaced by `admin-format.mjs` + `admin-datetime.mjs` presets |
| `LanguageToggle`, `EmailTextModeToggle`, preview width toggle | three implementations of one segmented control |
| Nested ternary `initialTab` resolution in `page.tsx` | replaced by a tab registry |
| `Th`/`Td` in KpiTab, hand-rolled tables in Kampagne/Verbesserung | replaced by `ui/table` |
| Two client stepping loops (`ReportProgressDriver`, `RunDriver`) | one `useStepLoop` hook with the more robust reconnect semantics of the Verbesserung driver |
| `.env.example`: `SHOPIFY_CUSTOMER_ACCOUNT_API_VERSION` | never read by code (the version comes from discovery) |
| `.env.example` / README: Sentry source-map upload vars | described as wired, but `next.config.ts` has no `withSentryConfig` and there is no instrumentation file — the docs describe something that does not exist; removed from the docs (not adding the plugin) |
| Unused exports and never-imported lib modules | listed in the module map (in progress); each removal is verified by grep + build |

### 6.2 Removals that need your confirmation (capability with no caller I can find)
| Item | Evidence | Recommendation |
| --- | --- | --- |
| `POST /api/admin/bundles/list` | no UI/script caller; one mention in BUNDLES.md | remove route + doc line |
| `POST /api/admin/marketing/draft` (per-capture draft) | no UI caller since the Marketing tab was folded into Kunden (drafts go through `customers/marketing-draft`) | remove |
| `POST /api/admin/qa/draft` (single-conversation Q&A draft) | no UI caller; Wissen uses `qa/scan` | remove, or add the "Frage entwerfen" button in the Gespräche detail that its header describes — your call |
| `GET /api/admin/directives`, `GET /api/admin/email-designs` | no callers; the data is server-rendered | remove |
| `scripts/probe-bundle.mjs` (868 lines, "THROWAWAY verification probe", creates live Shopify products) | referenced only by the historical bundle spike | delete (the spike doc keeps the results) |
| `scripts/list-test-discounts.mjs --delete`, `scripts/send-test-emails.mjs`, `scripts/preview-summary-email.mjs` | undocumented; two need `tsx`, which is not a dependency; one sends real mail with a hard-coded default recipient | keep but document + add npm scripts (`tsx` as devDependency) — or delete the two that need tsx if you never use them |

### 6.3 Merges (no capability lost)
- Übersicht quick links → "Heute" tasks; Kampagne header controls → stat strip + toolbar (rare/destructive actions in an overflow menu).
- `after(() => autoCaptureMissingAddresses())` on every `/admin` render → moved into the daily `refresh-customers` cron (which already refreshes addresses) plus an explicit "Adressen prüfen" action; viewing a dashboard tab no longer triggers Shopify calls and writes.
- `docs/frontend-handoff/API_CONTRACT.md` (1 664 lines) duplicates `docs/API_CONTRACT.md` (1 765) → the handoff copy becomes a pointer to the single source (file path kept).
- Historical docs → `docs/archive/` with an index (see the docs plan in Part 2).
