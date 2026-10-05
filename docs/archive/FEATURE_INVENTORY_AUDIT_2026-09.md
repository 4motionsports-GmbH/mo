# Feature inventory — the 2026-09 audit pass and the baseline columns

Archived 2026-10-05 from docs/FEATURE_INVENTORY.md — historical, not maintained.

What this holds: the parts of [`FEATURE_INVENTORY.md`](../FEATURE_INVENTORY.md) that described the state of 2026-09-08 (`main` @ `9c6b551`) or recorded findings of that audit pass rather than capabilities — the dated notes that opened the file, the baseline screen descriptions, every `File:line` value of part 1, the per-route audit tables of part 2, the baseline cron/script/env material of parts 3–5 and the 2026-09 findings (routes without a caller, duplicated routes, env findings, docs map). Text is copied verbatim as it stood on 2026-10-05 before this restructure (`b438a59`; headings demoted, relative links adjusted to this folder); file names and line numbers refer to the tree of their date. Superseded by: `FEATURE_INVENTORY.md` (capabilities), `ADMIN_DASHBOARD.md` §2–§3 and §11 (screens, admin routes), `frontend/API_CONTRACT.md` / `frontend/ACCOUNT_CONTRACT.md` (widget routes), `.env.example` (variables), `DATA_RETENTION.md` (windows), `docs/README.md` (docs map).

## A. The opening notes of the inventory (2026-09-09 … 2026-10-05)

#### Feature inventory — the capability checklist for the clean-up

Purpose: an exhaustive list of everything the admin dashboard, the API surface, the scheduled jobs, the scripts and the
configuration can do **today** (baseline `main` @ `9c6b551`, 2026-09-08). It is the checklist both of us use at the end of
the clean-up to verify that no capability was lost silently. Every item carries a stable ID (`KUN-12`, `KAM-07`, …) or a
path; Phase 3 marks each one as **verified** (by test / screenshot / manual run) or **intentionally removed / merged**
(with your approval), in `FEATURE_INVENTORY_STATUS.md`.

> **Status (2026-09-09):** Phase 3 is complete — every item is marked in
> [`FEATURE_INVENTORY_STATUS.md`](./FEATURE_INVENTORY_STATUS.md); the after-screenshots are in
> [`screenshots/after/`](../screenshots/after/). File names and line numbers in this inventory describe the
> baseline and no longer match the redesigned tree (see `ADMIN_DASHBOARD.md` §2.3 for the new one).
>
> **Update (2026-10-01, customer platform, migrations 0061–0068, `main` @ `943a313`):** the capabilities of the
> customer platform ([`CUSTOMER_PLATFORM_PLAN.md`](../CUSTOMER_PLATFORM_PLAN.md) — written before the build; where it
> and the code differ, this inventory follows the code) are added under new IDs (`EIG-…` Eingang, `KUN-113…`,
> `KAM-96…`, `KPI-71…`, `EIN-07…`, `GES-43`) and in the API, cron, script, environment and database parts. Capabilities that
> were replaced are kept and marked **❌ abgelöst / retired → replacement**; nothing was removed from this list.
> „Plan D-n“ refers to the decision table of `CUSTOMER_PLATFORM_PLAN.md` §1 (not the clean-up decisions D-1…D-9 of
> `FEATURE_INVENTORY_STATUS.md`).
>
> **Follow-up (2026-10-01, `main` @ `6327b0f`, no migration):** the fixes and additions committed after `943a313` /
> `eb1816d` are folded into the touched rows (marked **Nachtrag 2026-10** in the German parts, **2026-10 follow-up** in
> the English ones) and added under new IDs: `KUN-133` (Auswählen → „Zur Kampagne…“, the replacement of the retired
> bulk-draft bar), `KUN-134` („Ähnliche Kunden“), `ANA-15` (chapters Kundenbasis and Kampagnen), `EIN-12` (Merkmale als
> Shopify-Tags, plan D-11). The final fixes before the merge (`03b2d8d` … `b55f248`) add migration `0069`
> (`campaign_contacts.added_manually`: people added by hand stay in a dynamic campaign), remove the `mo-` tags on an
> Art. 21 objection to profiling, cap „Zur Kampagne…“ at 200, label the KPI tables' rate „Button-Klickrate“, and audit
> „Ähnliche Kunden“ (`customer.similar`) — 34 route files call `recordAdminAccess`; `npm test` 1027 green (118 files).
>
> **Addition (2026-10-03, no migration): order status in the chat.** A customer signed in via the Customer Account in
> the same chat session can ask Mo about their own orders (`get_order_status`, behind `CHAT_ORDER_STATUS_ENABLED`,
> default off) — rows: `POST /api/chat` (§2.1), `GES-26` (tool label „Bestellung“), env `CHAT_ORDER_STATUS_ENABLED`
> and `SHOPIFY_ACCOUNT_ORDERS_URL` (§5); new tested core `order-status-core.mjs`; legal review `ANWALTSDOSSIER.md`
> §16 (F-32). Hardened after review: only ledger rows of the session's Shopify customer (incl. not-yet-linked
> ones), a live-foreign order is never shown, „no orders“ / „not found“ only after a live confirmation
> (`confirmLedgerAnswer`), `unavailable` before the first order import, ≤3 lookups per request, a delivered parcel
> never overrides an unfinished order; the sign-in merge never re-stamps a row of another Shopify customer and
> the ledger upsert follows a reassigned order.
>
> **Addition (2026-10-05, migration 0076): order attribution — window from the latest consultation, unresolved
> marked orders counted** ([`ORDER_ATTRIBUTION.md`](../ORDER_ATTRIBUTION.md), ATTR-TOKEN-LIFETIME). With
> `MO_ATTRIBUTION_SESSION_ANCHOR` (default off) a widget token's window counts from the device's latest product
> consultation (`messages.session_id` on tool marker rows, 0076) and retention keeps the token while that device keeps
> consulting (cap `KPI_RETENTION_DAYS` after minting); marked orders that cannot be attributed are counted as the
> server-only event `mo_order_marker_unresolved` (KPI-82). Touched: KPI-33, KPI-79, the attribution token row (§2.11),
> the retention cron (§3), env `MO_ATTRIBUTION_SESSION_ANCHOR` (§5), migration 0076 (§6); `verify:live` section 7/7b.
> Legal review `ANWALTSDOSSIER.md` §20 (F-37).
>
> **Addition (2026-10-05, no migration): shop-login recognition (App Proxy, P0.3).** whoami issues a one-time code only
> when the session will really be signed in (signature fresh within ±300 s, handover on a shared browser, switches
> `APP_PROXY_SIGNIN_ENABLED` / `APP_PROXY_SIGNIN_MAX_AGE_HOURS`, both off by default; D-AP1 decided 05.10.2026, recommended
> `true` / `24`) and records the server-only `account_shop_recognised`. One resolver (`src/lib/signed-in-session.ts`)
> behind `/api/auth/me`, `/api/account/*` and Mo's memory accepts a chat token or a fresh shop proof; order status stays
> Customer-Account-only. Redeem never moves another customer's chats; logout ends App Proxy links too; the consent
> popup has a per-customer anti-nag; the sign-in opt-in records its proof in `consent_events.note`. Touched: KPI-47,
> KPI-75, KPI-79, KPI-80, new KPI-83 / KPI-84, the auth and account route rows (§2–§3), `requireSignedInCustomer` (§9),
> env (§5), `verify:live` section 8. Legal review `ANWALTSDOSSIER.md` §19 (F-36, answered).
>
> **Addition (2026-10-05, no migration, all switches off / default): consent-popup framing, page context, honest
> opt-in measurement.** (1) **OI3:** `GET /api/consent-copy?surface=signin` serves `benefits` (three bullets, wording
> decided by the owner 05.10.2026, D-AP4; EN as the approved translation, D-AP3) and `variant` (`a`); copy version
> `v5`; `CONSENT_SIGNIN_VARIANTS` (default `a`) for a later A/B test (per-session assignment, `private, no-store`
> while > 1 variant); the sign-in opt-in POST records optional `placement` / `variant` plus `alreadyConfirmed`,
> `doiRequired`, `variantMismatch?`; new tested core `consent-variants.mjs`; KPI-87 „Nach Variante und
> Platzierung“. (2) **A3:** `context.source` (`page` | `cta` | `nudge`) on `POST /api/chat`; a typed product-page turn
> gets a softer page note behind `CHAT_PAGE_CONTEXT_ENABLED` (default off) with an optional control group
> `CHAT_PAGE_CONTEXT_HOLDOUT_PCT` (default 0); server-only `page_context_applied` / `page_context_answered`; new
> tested core `page-context.mjs`; KPI-85 / KPI-86 „Seitenkontext auf Produktseiten“; `verify:live` section 9.
> (3) **OI1 PR 2:** opt-in events carry `source` / `outcome`, the DOI confirmation its `source`; a suppressed address
> is never answered „already subscribed“ (F2); the capture funnel counts the form only, the consent section counts
> sessions; new tested core `capture-funnel.mjs`; release `optin-measurement` (KPI-79). Touched: KPI-22…29, KPI-79,
> the chat, consent-copy, capture and opt-in route rows (§2), `verify:live` / `verify:widget` (§4: widget build row
> `tasks-2026-10-05`, markers `ms-chat-ctx-last`, `ms-chat-optin-benefits`, `Rabattaktionen zuerst erfahren`), env
> (§5). The live widget `3e87341` ignores every new field until the next upload. Legal note `ANWALTSDOSSIER.md` § 21.
>
> **Addition (2026-10-04, migration 0075): live check after the customer-platform widget upload.** KPI tab: release
> dates in the period („Änderungen im Zeitraum“, `kpi-releases.mjs`) and per-section notes (KPI-79), „Geöffnet →
> geschrieben“ replaces „Engagement“ (KPI-09/13), the sign-in diagnosis per session (KPI-80), „Bestellstatus im Chat“
> (KPI-81), contact-form split (KPI-47). Backend: `POST /api/kpi` stores no server-only event names, `/api/contact`
> falls back to `x-ms-session` and normalises the KPI reason, `campaign_chat_started` once per send (unique index
> 0075) and also for test sends (`test:true`), `CHAT_ORDER_STATUS_TEST_CUSTOMERS` (order status for test accounts
> while the switch is off). Scripts `verify:widget` (live widget build, `widget-fingerprint.mjs`) and `verify:live`
> (read-only live checks).
>
> **Addition (2026-10-03, migration `0074`): letters as a campaign channel.** A campaign can also write advertising
> letters (Pingen) to its audience — mode „Keine Briefe“ (default) / „An alle ohne E-Mail-Einwilligung“ / „An alle
> (auch mit Einwilligung)“, postage budget, purchase address only, AI draft, release per letter, every gate again per
> letter at send ([`CAMPAIGNS.md`](../CAMPAIGNS.md) §8). New IDs `KAM-114…120` (editor section „Brief“, letter
> recipients, view „Briefe“, addresses, drafts, letter detail, sending) and `KUN-135` (Kunden → Brief „Adresse aus
> letzter Bestellung holen“; the 1:1 letter now accepts only a purchase address); touched: `KPI-52` (call site
> „Kampagnen-Briefe“). API: +3 admin routes (`campaigns/letters`, `campaigns/letters/preview`,
> `customers/letter-address`; §2.8), `campaigns/audience-preview` takes `letterMode`, `physical/send` refuses
> `not_purchase_address` / `address_invalid`; cron `campaign-audiences` refreshes letter recipients and fetches purchase
> addresses (§3); env `LETTER_MIN_INTERVAL_DAYS`, `CAMPAIGN_LETTER_ADDRESS_NIGHTLY`, `CAMPAIGN_LETTER_SHOP_URL` (§5);
> migration and table `campaign_letters` (§6). New tested core `campaign-letter-core.mjs`; legal review
> `ANWALTSDOSSIER.md` §18 (F-35).

Language: the admin sections quote the German UI labels and are written in German (they mirror the screens the team
uses); the API, cron, script and environment sections are in English like the rest of `docs/`.

Contents
1. Admin dashboard — every tab, control, helper text and persisted state
2. HTTP API routes — purpose, caller, auth, rate limit, validation
3. Cron jobs and background work
4. Scripts
5. Environment variables
6. Database, tests and documentation map

---

## B. Part 1 — admin dashboard

### B.1 §0 Globale Shell — Beschreibung (2026-09-08)

`page.tsx` (Server Component, `force-dynamic`) liest `searchParams`, ermittelt den initialen Tab aus `?tab=` (Werte: `kpi|feedback|gespraeche|wissen|analyse|verbesserung|einstellungen|kampagne|kunden|customers`(legacy→kunden); Default `overview`), den Kunden-Filter-Preset aus `?filter=` (Fallback legacy `?status=`), den KPI-Zeitraum aus `?kpiRange/?kpiFrom/?kpiTo` (via `resolveKpiRange`) und den Gespräche-Filter aus den `g*`-Params (`grange,gfrom,gto,gtier,gerr,gcat,gqual,gq,gpage` via `parseAdminConversationFilter`). Jeder Tab-Body wird SERVER-seitig gerendert und als ReactNode an die Client-Komponente `AdminShell` übergeben. Ausnahme (PERF): `OverviewTab` und `KpiTab` (Shopify-lastig) werden NUR gerendert, wenn sie der initiale Tab sind; andernfalls erhält die Shell `null` und ein Klick auf diesen Tab löst eine echte Navigation (`window.location.assign`) zum Deep-Link aus. Alle anderen Bodies bleiben per `forceMount` gemountet (Edit-State bleibt beim Tab-Wechsel erhalten). Die Shell hält den aktiven Tab im State, synchronisiert `?tab=` per `history.replaceState`, zeigt Theme-Toggle + Abmelden, den Tab-Untertitel und mountet den einen `<Toaster/>`. `layout.tsx` lädt `theme.css` (Tailwind-Tokens, nur unter /admin), die selbstgehostete Montserrat und setzt die `.dark`-Klasse auf `#admin-root` aus dem Cookie `ms_admin_theme` (plus render-blockendes Inline-Script mit OS-Fallback).

Datenladen (in `page.tsx` für den Kunden-Tab, `KundenTab`-Funktion): `listCustomersWithSessions()`, pro Kunde `getLatestSendForEmail`, `listBundleOffersWithSignalsForCustomer`, `listCustomerMessages`, `listCustomerLetters`, `physicalEligibilityForCustomer`, `buildBundleRedirectUrl`; global `listUnmatchedInbound()`; Hintergrund `after(() => autoCaptureMissingAddresses({limit:12}))` (Adress-Autoerfassung aus Shopify nach Antwort). Übersicht: `listMarketingTargets()` nur wenn Overview gerendert wird.

### B.1 §0 Globale Shell — Zeile SHL-06 (2026-09-08)

| SHL-06 | Tastenkürzel `1`–`9`/`0`? (tatsächlich `1`-`9`, begrenzt auf TAB_ORDER.length=10 → `1`–`9`) | keyboard shortcut | Springt zum n-ten Tab (1=Übersicht … 9=Verbesserung; Einstellungen (10) ist per Ziffer NICHT erreichbar, da nur `^[1-9]$`). Ignoriert, wenn Fokus in INPUT/TEXTAREA/SELECT/contentEditable oder Modifier gedrückt | client-only | AdminShell.tsx, lib/admin-tabs.mjs (`shortcut`) |

### B.1 §2 Übersicht — Beschreibung (2026-09-08)

Read-only Landing-Tab (Server Component, async). Wird NUR gerendert, wenn `?tab` fehlt/`overview` ist (deferred sonst). Lädt parallel: `getCoreMetrics(resolveKpiRange({kpiRange:"30d"}))` (kpi-store), `getAiCostMetrics()` (ai-usage-store, all-time), `getMarketingActivity({windowDays:30, limit:5})` (marketing-store); erhält `targets` (= `listMarketingTargets()` aus page.tsx) und aggregiert per `summarizeMarketingTargets` / `recentConfirmedContacts` (`@/lib/admin-overview.mjs`). Feste 30-Tage-Sicht (kein Datepicker hier). Enthält Kennzahl-Karten, Schnellzugriffs-Deep-Links in andere Tabs (mit vorbelegtem Kunden-Filter) und zwei Aktivitätslisten. Nichts hier mutiert Daten.

### B.1 §3 Kunden — Beschreibung (2026-09-08)

Master-Detail-Workspace für alles Kundenbezogene (alter Kunden- + Marketing-Tab zusammengelegt). Daten kommen komplett SERVER-seitig aus `page.tsx → KundenTab` (siehe Abschnitt 0: `listCustomersWithSessions`, `getLatestSendForEmail`, `listBundleOffersWithSignalsForCustomer`, `listCustomerMessages`, `listCustomerLetters`, `physicalEligibilityForCustomer`, `listUnmatchedInbound`, Hintergrund-`autoCaptureMissingAddresses`). Links eine kompakte, durchsuchbare/filterbare Liste (Client-Filterung via `customer-filter.ts`, Preset aus `?filter=`), rechts die ausgewählte Person als `CustomerProfileCard` (gekeyt nach id → frischer Zustand pro Kunde) mit sechs Sub-Tabs (Profil · Beratungen · Käufe · Marketing · Korrespondenz · Brief; alle `forceMount`). Oberhalb der Liste die globale Triage „Nicht zugeordneter Posteingang". Unten eine Sticky-Leiste für den Sammel-Entwurf (nur DOI-bestätigte Kunden, Concurrency 4). Alle Mutationen laufen per `fetch` gegen `/api/admin/*`-Routen, gefolgt von `router.refresh()`.

### B.1 §3 Kunden — Persistenter Zustand (2026-09-08)

- URL: `?tab=kunden` (+ `?filter=` Preset nur als initialer Seed; Filteränderungen werden NICHT in die URL geschrieben).
- Kein localStorage/Cookie. Alle Filter/Auswahl/Sub-Tab-Zustände sind flüchtiger React-State (Sub-Tab-Zustand geht beim Kundenwechsel verloren, da `key={id}`).

### B.1 §4 Kampagne — Beschreibung vor dem Desk (2026-09-08)

_Beschreibung vor dem Desk:_
Review-Warteschlange für personalisierte E-Mails an Shopify-Marketing-Abonnent:innen (docs/CAMPAIGNS.md). `KampagneTab` (Server) lädt parallel `getCampaignCounts()`, `listDraftedQueue()`, `listCampaignSendHistory()`, `listSkippedContacts()` (campaign-store), löst empfohlene Produkte via `resolveProductSelections`, holt aktive Bundles per `listActiveBundlesForCampaignContacts`, prüft Rabattcode-Einlösung via `wasDiscountCodeRedeemed` (max. 30 Codes, nur wenn Shopify konfiguriert) und reicht Flags `isCampaignSendsApproved()`, `isSingleOptInAllowed()`, `isShopifyConfigured()` durch. `KampagneWorkspace` (Client) zeigt EINE Karte pro Kontakt (links Kontext: Sprache, Textmodus, Opt-in, Segment, A/B, Kaufhistorie mit Empfehlungsbasis, Empfehlungen, Rabatt, Set-Angebot; rechts editierbarer Betreff/Text mit debounced Autosave, Hero-Panel, Aktionen). Sub-Views „Warteschlange"/„Gesendet", Opt-in-Filter, linke Rail mit globaler Kontaktsuche, Warteschlangen-Liste und „Übersprungen". Tastenkürzel N/P/V/C/S/X. Mehrere Aktionen laden die Seite komplett neu (`window.location.reload()`).

### B.1 §5 KPIs — Beschreibung (2026-09-08)

Reiner Analytics-Tab, Server Component (nur gerendert, wenn `?tab=kpi`; sonst deferred → echte Navigation). ALLE Aggregation läuft server-seitig in `Promise.all` über: `getCoreMetrics(range)`, `getMoRevenue(range)`, `getMoAttributionKpis(range)`, `getAiCostMetrics(range)`, `getPersonaInsights(5)`, `getRecommendationLoop()`, `getMarketingFunnel()`, `getConsentGateFunnel(range)`, `getEmailCaptureFunnel(range)`, `getCampaignKpis(range)`, `getBundleKpis(range)`, `getQaKpis(range)`, `getFeedbackKpis(range)`, `getConversationStats(from,to)`, `getLocaleSplit(range)`, `getAccountActivity(range)`, `getCachedTopQuestionsMap()`, `getPhysicalLetterStats()`. Der Zeitraum kommt aus `?kpiRange=7d|30d|90d|custom` (+`kpiFrom`/`kpiTo`), validiert via `resolveKpiRange`. Drei Client-Inseln: `KpiDateRangePicker` (schreibt nur die URL, `router.push`), `KpiCharts` (Recharts, Skeleton bis Mount, Token-Farben) und `KpiTopQuestions` (einzige Mutation: On-Demand-KI-Lauf). 13 zeitraumabhängige Sektionen, dann Trenner „Gesamtwerte", dann 4 zeitraumunabhängige. Jede Sektion trägt eine „Caveat"-Ehrlichkeitsnotiz.

### B.1 §6 Feedback — Beschreibung (2026-09-08)

Read-only Liste der Widget-Rückmeldungen. `FeedbackTab` (Server) lädt `listFeedback()` (feedback-store) einmal und reicht die Zeilen an `FeedbackList` (Client), die ausschließlich lokal sucht/filtert/sortiert. Keine Mutation, keine API-Route.

### B.1 §7 Gespräche — Beschreibung (2026-09-08)

Konversations-Inspektor (Master-Detail). `GespraecheTab` (Server) liest aus `@/lib/admin-conversations`: `listAdminConversations(filter)` (paginiert, PAGE_SIZE), `getConversationStats(from,to)`, `getCachedInsights(from,to)`, `countUnanalyzedInRange(from,to)` und berechnet die Bulk-Kostenschätzung (`estimateAnalysisCostUsd` × `usdToEur`). NULL Modell-Aufrufe beim Rendern. Sämtliche Filter + Seite leben in der URL (`g*`-Params): Änderungen → `router.push('/admin?tab=gespraeche&grange=…')` → Server rendert neu. Oben Filterleiste (Volltextsuche über ALLE Chats, Zeitraum-Presets/custom, Tier, Kategorie, Qualität, „nur ohne Bot-Antwort"), dann Stats-Panel mit klickbaren Verteilungsbalken + Sammelanalyse, dann Liste (links) + Detail (rechts; lazy `POST /api/admin/conversations/detail`), unten der einklappbare aggregierte Insights-Report.

### B.1 §8 Wissen — Beschreibung (2026-09-08)

Q&A-Warteschlange zur Wissensanreicherung. Server (`WissenTab`) lädt einmal `listQaEntries(null)`, `getQaCounts()`, `countScanCandidates()` und übergibt an den Client-Workspace. Der Client hält Einträge/Zähler im State und lädt nach jeder Mutation per `GET /api/admin/qa/list` neu. Pro Eintrag: KI-Entwurf {Wissenslücke, Frage, Produkt?} → Operator editiert Frage/Produkt-Handle/Antwort (+ optionale englische Version) → Speichern (answered) → Veröffentlichen (Shopify-Metafeld `custom.qa` bei Produktbezug, sonst Mos allgemeine Wissensbasis) → Zurückziehen/Verwerfen/Wiederherstellen. „Gespräche scannen" ist der einzige Token-Spend (explizit).

### B.1 §9 Analyse — Beschreibung (2026-09-08)

Master–Detail für gespeicherte Komplettanalysen. Server (`AnalyseTab`) lädt die Berichtsliste (`listAnalyticsReports`, ohne `sections`). Client: Sidebar (Liste + „Neue Komplettanalyse"), Hauptbereich = Generator (Zeitraum-Presets/benutzerdefiniert, 2 Optionen, Live-Kostenschätzung, debounced 350 ms) ODER ausgewählter Bericht (Detail per `GET /api/admin/analytics/[id]`; laufend → `ReportProgressDriver` steppt `POST /step` bis done; fertig → `ReportView`; fehlgeschlagen → Fehlerbox). Aktionen: PDF (GET-Link), Löschen (Dialog).

### B.1 §10 Verbesserung — Beschreibung (2026-09-08)

Geschlossener Verbesserungs-Loop (docs/IMPROVEMENT_LOOP.md). Server lädt Läufe (`listImprovementRuns`), fertige Komplettanalysen (`listAnalyticsReports` → complete), Anweisungen (`listDirectives`) und Mos Selbstbild (`buildMoSelfSnapshot`: gerenderter System-Prompt + Hash). Client: Sidebar (Läufe + „Neuer Verbesserungslauf"), Hauptbereich = Neuer-Lauf-Panel ODER Lauf-Detail (`GET /api/admin/improve/[id]`; laufend → `RunDriver` steppt `POST /step` mit Reconnect-Logik; fertig → Wirkungs-Check (Delta-Tabelle + Markdown) + Vorschlagskarten in zwei Lanes (Mo / Shop)). Darunter zwei einklappbare Tool-Sections: „Anweisungen an Mo" (DirectivesCard) und „Mos Selbstbild" (SelfSnapshotCard).

### B.1 §11 Einstellungen — Beschreibung (2026-09-08)

E-Mail-Design-Verwaltung. Server lädt `listEmailDesignMeta()` (Code-Registry), `listEmailDesignSelections()` (DB, nur wenn dbReady), Versandkonfiguration aus Env (`isEmailConfigured`, `senderAddress`, `inboundEmailAddress`, `EMAIL_LOGO_URL`). Client: drei Karten — Design-Bibliothek (je Design: Name, Standard-Badge, Beschreibung, „Hinzugefügt am", Badges „Aktiv: <Typ>"/„Nicht in Verwendung", je unterstütztem Typ ein Vorschau-Button), Aktives Design je E-Mail-Typ (Select + Vorschau je Typ; Änderung sofort per API), Versand-Konfiguration (read-only Definitionsliste).

### B.2 §12 Gemeinsame Komponenten & Primitives (2026-09-08, mit Nachträgen)

##### 12. Gemeinsame Komponenten & Primitives

| Datei | Zweck | Verwendet von |
|---|---|---|
| `ui/cn.ts` | clsx-artiger Klassen-Kombinierer | alle |
| `ui/button.tsx` | Button (default/secondary/outline/ghost/destructive/accent/link; default/sm/lg/icon) | alle |
| `ui/input.tsx`, `ui/textarea.tsx`, `ui/label.tsx`, `ui/select.tsx` (nativ), `ui/checkbox.tsx` (tri-state) | Formularfelder | alle Workspaces |
| `ui/badge.tsx` | Status-Pills (default/secondary/outline/accent/success/warning/info/destructive) | alle |
| `ui/card.tsx` | Card/Header/Title/Description/Content/Footer | alle |
| `ui/skeleton.tsx` | Ladeplatzhalter | Gespräche, KPI-Charts, Insights |
| `ui/table.tsx` | Table-Primitives | CustomerProfileCard (Käufe) — sonst hand-gerollte Tabellen (Kampagne SentHistory, KpiTab Th/Td, Verbesserung DeltaTable) |
| `ui/tabs.tsx` | Tabs (controlled, forceMount) | AdminShell, CustomerProfileCard |
| `ui/popover.tsx` | Verankertes Bedienfeld (Floating-Engine aus info-tip.tsx, Fokus-Falle, Esc/Außenklick) | Kampagne (Vorbereiten…) |
| `ui/menu.tsx` | ⋯-Überlaufmenü (Roving Focus, Kürzel-Hinweise, destruktiver Ton) | Kampagne (Kopfzeile, Aktionsleiste) |
| `ui/dialog.tsx` + `ui/portal.ts` | Modal (Esc/Overlay, Portal in #admin-root; über einem Sheet reagiert nur das innerste Overlay auf Esc und Tab — `useOverlayLayer` in `ui/focus.ts`) | Kampagne (3), CustomerProfileCard (Transkript), EmailPreviewButton, GespraecheInsights (Bulk), ReportActions |
| `ui/toast.tsx` | Toaster + `toast()` (update/dismiss) | alle Mutationen |
| `ui/stat.tsx` | Section/Stat(+title-Tooltip)/Caveat | KpiTab, OverviewTab (2026-10 entfernt), ReportView |
| `ui/markdown.tsx` | Sanitized Markdown-Renderer (keine dangerouslySetInnerHTML) | Kunden (Profil, Sent), Gespräche, Insights, Analyse, Verbesserung, KpiTopQuestions, Korrespondenz |
| `ui/product-picker.tsx` | Katalogsuche + Variantenwahl (`useCatalogSearch`) | Kampagne (Empfehlungen), Kunden (Bundle-Composer), Wissen (Link) |
| `EmailPreviewFrame.tsx` | Iframe-Vorschau Desktop/Mobil (skaliert) | Kampagne, EmailPreviewButton |
| `EmailPreviewButton.tsx` | „Vorschau"-Button + Dialog (POST → blob → iframe) | Kunden (Marketing), Korrespondenz, Einstellungen |
| `EmailTextModeToggle.tsx` | Segment Ausführlich/Kompakt/Minimal | Kunden (Marketing, Bulk), Kampagne |
| `HeroImagePanel.tsx` | Hero-Bild-Panel (GET state, suggest/generate/headline/remove) | Kunden (Marketing-Entwurf), Kampagne |
| `ThemeToggle.tsx`, `theme-config.ts`, `theme.css` | Light/Dark (Cookie `ms_admin_theme`, Init-Script) | layout/AdminShell |
| `customer-filter.ts` | Pure Filter/Sort für Kundenliste | KundenWorkspace |
| `KpiCharts.tsx` | Recharts-Islands (Area/Donut/Bars/Funnel) | KpiTab |
| `ui/toggle-chips.tsx` (`ToggleChips`, seit 2026-10) | Mehrfachauswahl als Chips | Kampagnen-Editor (Zielgruppe) |

### B.3 §13 Tastenkürzel-Zeile (Stand vor 2026-10-05)

- Shell-Shortcuts `1–9` (Tab n), `/` (Kunden-Suche — auf dem Kampagne-Desk die Kontaktsuche); Kampagne `N/P (J/K) · S · X · E/Esc · R · V · C · F · / · ?`. **2026-10:** `1` = Eingang, `2` = Kampagnen, `3` = Kunden; Eingang `J/K · Enter · E · Z · D · Esc` (EIG-11; **Nachtrag 2026-10:** `J/K` und `Esc` in jeder Ansicht).

### B.4 §14 Dokumentiert, aber nicht im Code gefunden / §15 Zeilenzahlen (2026-09-08)

##### 14. Dokumentiert, aber nicht im Code gefunden (docs/ADMIN_DASHBOARD.md)
- Behauptung „Tabs are switched server-side via ?tab= — no client router" (Intro) — veraltet: Shell ist ein Client-Tab-Switch mit `history.replaceState`; nur Übersicht/KPIs navigieren serverseitig.
- Intro nennt neun Tabs ohne „Einstellungen" — der Tab existiert.
- (Weitere Abgleiche im Doku-Slice; ADMIN_DASHBOARD.md wird nach dem Redesign neu geschrieben.)

##### 15. Zeilenzahlen (src/app/admin)
Siehe `find src/app/admin -type f | xargs wc -l` (Stand Inventar): KampagneWorkspace 2338 (client), KpiTab 1758 (server), CustomerProfileCard 1521 (client), GespraecheWorkspace 841 (client), verbesserung/VerbesserungWorkspace 804 (client), WissenWorkspace 589 (client), KundenWorkspace 546 (client), GespraecheInsights 508 (client), KorrespondenzPanel 442 (client), HeroImagePanel 373 (client), ui/markdown 361, verbesserung/DirectivesCard 342 (client), EmailSettingsWorkspace 336 (client), PhysicalLetterPanel 326 (client), KpiCharts 324 (client), verbesserung/SuggestionCard 319 (client), page.tsx 318 (server), ui/product-picker 293 (client), analytics/ReportView 274 (server-renderable), analytics/GenerateReportPanel 272 (client), AdminShell 262 (client), OverviewTab 247 (server), analytics/ReportProgressDriver 241 (client), analytics/AnalyseWorkspace 236 (client), FeedbackList 188 (client), KampagneTab 180 (server), UnmatchedInboundQueue 167 (client), ui/dialog 161 (client), analytics/ReportSidebar 137 (client), KpiDateRangePicker 136 (client), customer-filter 130, ui/toast 128 (client), ui/tabs 125 (client), EmailPreviewFrame 117 (client), EmailPreviewButton 117 (client), login/page 103 (server), KpiTopQuestions 103 (client), analytics/ReportActions 99 (client), GespraecheTab 86 (server), ui/table 81, ui/stat 75, ui/card 63, ui/button 62, verbesserung/SelfSnapshotCard 58 (client), ThemeToggle 54 (client), ui/index 53, FeedbackTab 53 (server), EmailTextModeToggle 50 (client), VerbesserungTab 48 (server), layout 45 (server), ui/badge 44, ui/checkbox 43, WissenTab 39 (server), AnalyseTab 33 (server), ui/select 32, ui/cn 32, EinstellungenTab 31 (server), theme-config 25, ui/input 22, ui/textarea 21, ui/label 19, ui/skeleton 16, ui/portal 8.

### B.5 Baseline `File:line` column of part 1 (2026-09-08; KAM-01…69 before the desk)

The value each row carried in its „File:line“ column before the column was changed to today's file. Rows added since 2026-10 carried no line numbers and are unchanged.

| ID | File:line (baseline) |
|---|---|
| SHL-01 | AdminShell.tsx:220 |
| SHL-02 | AdminShell.tsx:60-78, 221 |
| SHL-03 | ThemeToggle.tsx:84-123 |
| SHL-04 | AdminShell.tsx:225-232, page.tsx:58-63 |
| SHL-05 | AdminShell.tsx:34-58, 82-84, 142-159, 236-244 |
| SHL-06 | AdminShell.tsx:166-187 |
| SHL-07 | AdminShell.tsx:189-196 |
| SHL-08 | AdminShell.tsx:206-213 |
| SHL-09 | ui/toast.tsx:92-128, AdminShell.tsx:259 |
| SHL-10 | theme-config.ts:64-70, layout.tsx:41 |
| SHL-11 | page.tsx:280-286 |
| SHL-12 | page.tsx:288-295 |
| SHL-13 | page.tsx:74-93 |
| SHL-14 | page.tsx:96-98, customer-filter.ts:136-148 |
| SHL-15 | page.tsx:103-107 |
| SHL-16 | page.tsx:110-120 |
| LOG-01 | login/page.tsx:66 |
| LOG-02 | login/page.tsx:67 |
| LOG-03 | login/page.tsx:70-75 |
| LOG-04 | login/page.tsx:55-60, 77-81 |
| LOG-05 | login/page.tsx:85-93 |
| LOG-06 | login/page.tsx:95-97 |
| LOG-07 | login/page.tsx:35,40,52 |
| UEB-01 | OverviewTab.tsx:56-63 |
| UEB-02 | OverviewTab.tsx:83-86 |
| UEB-03 | OverviewTab.tsx:88 |
| UEB-04 | OverviewTab.tsx:89-93 |
| UEB-05 | OverviewTab.tsx:94-98 |
| UEB-06 | OverviewTab.tsx:99-103 |
| UEB-07 | OverviewTab.tsx:104-108 |
| UEB-08 | OverviewTab.tsx:112-115 |
| UEB-09 | OverviewTab.tsx:117-121 |
| UEB-10 | OverviewTab.tsx:122-126 |
| UEB-11 | OverviewTab.tsx:127-131 |
| UEB-12 | OverviewTab.tsx:132-136 |
| UEB-13 | OverviewTab.tsx:140-143 |
| UEB-14 | OverviewTab.tsx:145-155 |
| UEB-15 | OverviewTab.tsx:156-166 |
| KUN-01 | UnmatchedInboundQueue.tsx:57-75 |
| KUN-02 | UnmatchedInboundQueue.tsx:130-144 |
| KUN-03 | UnmatchedInboundQueue.tsx:146-160 |
| KUN-04 | UnmatchedInboundQueue.tsx:95-126, 161-163 |
| KUN-05 | KundenWorkspace.tsx:239-253, customer-filter.ts:173-177 |
| KUN-06 | KundenWorkspace.tsx:255-265 |
| KUN-07 | KundenWorkspace.tsx:266-277 |
| KUN-08 | KundenWorkspace.tsx:278-287, customer-filter.ts:155-158 |
| KUN-09 | KundenWorkspace.tsx:288-298, customer-filter.ts:161-164 |
| KUN-10 | KundenWorkspace.tsx:299-309, customer-filter.ts:187-222 |
| KUN-11 | KundenWorkspace.tsx:313-317 |
| KUN-12 | KundenWorkspace.tsx:318-322 |
| KUN-13 | KundenWorkspace.tsx:323-332 |
| KUN-14 | customer-filter.ts:136-148, page.tsx:96-98 |
| KUN-15 | KundenWorkspace.tsx:451-546 |
| KUN-16 | KundenWorkspace.tsx:489-501 |
| KUN-17 | KundenWorkspace.tsx:502-511 |
| KUN-18 | KundenWorkspace.tsx:57-65, 513-517 |
| KUN-19 | KundenWorkspace.tsx:518-522 |
| KUN-20 | KundenWorkspace.tsx:523-527 |
| KUN-21 | KundenWorkspace.tsx:528-537 |
| KUN-22 | KundenWorkspace.tsx:67-76, 540-542 |
| KUN-23 | KundenWorkspace.tsx:339-343 |
| KUN-24 | KundenWorkspace.tsx:365-369 |
| KUN-25 | KundenWorkspace.tsx:381 |
| KUN-26 | KundenWorkspace.tsx:383-397 |
| KUN-27 | KundenWorkspace.tsx:400-405 |
| KUN-28 | KundenWorkspace.tsx:412-414 |
| KUN-29 | KundenWorkspace.tsx:141-230, 415-417 |
| KUN-30 | CustomerProfileCard.tsx:320-329 |
| KUN-31 | CustomerProfileCard.tsx:331-333 |
| KUN-32 | CustomerProfileCard.tsx:334-338 |
| KUN-33 | CustomerProfileCard.tsx:214-222, 339 |
| KUN-35 | CustomerProfileCard.tsx:358-360 |
| KUN-36 | CustomerProfileCard.tsx:281-309, 362-369 |
| KUN-37 | CustomerProfileCard.tsx:373-379 |
| KUN-38 | CustomerProfileCard.tsx:380-388 |
| KUN-39 | CustomerProfileCard.tsx:395 |
| KUN-40 | CustomerProfileCard.tsx:396-402 |
| KUN-41 | CustomerProfileCard.tsx:594-603 |
| KUN-42 | CustomerProfileCard.tsx:604-631 |
| KUN-43 | CustomerProfileCard.tsx:420-422 |
| KUN-44 | CustomerProfileCard.tsx:258-279, 424-431 |
| KUN-45 | CustomerProfileCard.tsx:538-573 |
| KUN-46 | CustomerProfileCard.tsx:504-519 |
| KUN-47 | CustomerProfileCard.tsx:522-535 |
| KUN-48 | CustomerProfileCard.tsx:574-578 |
| KUN-49 | CustomerProfileCard.tsx:636-640, 677-685 |
| KUN-50 | CustomerProfileCard.tsx:803 |
| KUN-51 | CustomerProfileCard.tsx:804-822 |
| KUN-52 | CustomerProfileCard.tsx:823-831 |
| KUN-53 | CustomerProfileCard.tsx:841-846 |
| KUN-54 | CustomerProfileCard.tsx:849-864 |
| KUN-55 | CustomerProfileCard.tsx:874-895 |
| KUN-56 | CustomerProfileCard.tsx:902-904 |
| KUN-57 | CustomerProfileCard.tsx:909 |
| KUN-58 | CustomerProfileCard.tsx:687-694, 911-917 |
| KUN-59 | CustomerProfileCard.tsx:919-923 |
| KUN-60 | CustomerProfileCard.tsx:926-933 |
| KUN-61 | CustomerProfileCard.tsx:935-944 |
| KUN-62 | CustomerProfileCard.tsx:946-950 |
| KUN-63 | CustomerProfileCard.tsx:952-959 |
| KUN-64 | CustomerProfileCard.tsx:740-752, 962-964 |
| KUN-65 | CustomerProfileCard.tsx:965-976 |
| KUN-66 | CustomerProfileCard.tsx:774-798, 977-983 |
| KUN-67 | CustomerProfileCard.tsx:754-772, 984-991 |
| KUN-68 | CustomerProfileCard.tsx:996-1000 |
| KUN-69 | CustomerProfileCard.tsx:711-738, 1001-1008 |
| KUN-70 | CustomerProfileCard.tsx:832-834 |
| KUN-71 | CustomerProfileCard.tsx:1307-1317 |
| KUN-72 | CustomerProfileCard.tsx:1135-1164, 1323-1325 |
| KUN-73 | CustomerProfileCard.tsx:1332-1369 |
| KUN-74 | CustomerProfileCard.tsx:1370-1372 |
| KUN-75 | CustomerProfileCard.tsx:1378-1397 |
| KUN-76 | CustomerProfileCard.tsx:1404-1416 |
| KUN-77 | CustomerProfileCard.tsx:1419-1420 |
| KUN-78 | CustomerProfileCard.tsx:1423-1434 |
| KUN-79 | CustomerProfileCard.tsx:1439-1444 |
| KUN-80 | CustomerProfileCard.tsx:1186-1268, 1446-1450 |
| KUN-81 | CustomerProfileCard.tsx:1077-1083, 1453-1481 |
| KUN-82 | CustomerProfileCard.tsx:1289-1303, 1482-1494 |
| KUN-83 | CustomerProfileCard.tsx:1497-1505 |
| KUN-85 | KorrespondenzPanel.tsx:135-139 |
| KUN-86 | KorrespondenzPanel.tsx:140-142 |
| KUN-87 | KorrespondenzPanel.tsx:379-387 |
| KUN-88 | KorrespondenzPanel.tsx:389-398, 438-442 |
| KUN-89 | KorrespondenzPanel.tsx:400-412 |
| KUN-90 | KorrespondenzPanel.tsx:345-375, 420-422 |
| KUN-91 | KorrespondenzPanel.tsx:423-429 |
| KUN-92 | KorrespondenzPanel.tsx:430-432 |
| KUN-93 | KorrespondenzPanel.tsx:157-163 |
| KUN-94 | KorrespondenzPanel.tsx:179-202 |
| KUN-95 | KorrespondenzPanel.tsx:204-275 |
| KUN-96 | KorrespondenzPanel.tsx:277-322 |
| KUN-97 | PhysicalLetterPanel.tsx:210-212 |
| KUN-98 | PhysicalLetterPanel.tsx:152-167, 213-215 |
| KUN-99 | PhysicalLetterPanel.tsx:224-236 |
| KUN-100 | PhysicalLetterPanel.tsx:240-249 |
| KUN-101 | PhysicalLetterPanel.tsx:250-261 |
| KUN-102 | PhysicalLetterPanel.tsx:169-180, 263-265 |
| KUN-103 | PhysicalLetterPanel.tsx:128-150, 266-272 |
| KUN-104 | PhysicalLetterPanel.tsx:182-202, 273-275 |
| KUN-105 | PhysicalLetterPanel.tsx:279-291 |
| KUN-106 | PhysicalLetterPanel.tsx:204-205, 296 |
| KUN-107 | PhysicalLetterPanel.tsx:46-73, 298-323 |
| KAM-01 | KampagneTab.tsx:35-42 |
| KAM-02 | KampagneWorkspace.tsx:1091-1098 |
| KAM-03 | KampagneWorkspace.tsx:1099-1104 |
| KAM-04 | KampagneWorkspace.tsx:1108-1115, 2213-2219 |
| KAM-05 | KampagneWorkspace.tsx:1116-1121, 2321-2330 |
| KAM-06 | KampagneWorkspace.tsx:938-969, 1123-1131 |
| KAM-07 | KampagneWorkspace.tsx:1133-1145 |
| KAM-08 | KampagneWorkspace.tsx:1146-1157 |
| KAM-09 | KampagneWorkspace.tsx:999-1039, 1158-1162 |
| KAM-10 | KampagneWorkspace.tsx:1164-1171 |
| KAM-11 | KampagneWorkspace.tsx:974-997, 1426-1447 |
| KAM-12 | KampagneWorkspace.tsx:1177-1184 |
| KAM-13 | KampagneWorkspace.tsx:1185-1191 |
| KAM-14 | KampagneWorkspace.tsx:1194-1211, 317-320 |
| KAM-15 | KampagneWorkspace.tsx:1212-1215 |
| KAM-16 | KampagneWorkspace.tsx:1042-1086 |
| KAM-17 | KampagneWorkspace.tsx:1828-1853, 1891-1897 |
| KAM-18 | KampagneWorkspace.tsx:1898-1903 |
| KAM-19 | KampagneWorkspace.tsx:1858-1865, 324-331 |
| KAM-20 | KampagneWorkspace.tsx:491-519, 1866-1872 |
| KAM-21 | KampagneWorkspace.tsx:453-486, 1873-1878 |
| KAM-22 | KampagneWorkspace.tsx:1879-1885 |
| KAM-23 | KampagneWorkspace.tsx:1922-1953 |
| KAM-24 | KampagneWorkspace.tsx:1956-1962 |
| KAM-25 | KampagneWorkspace.tsx:1963-1987 |
| KAM-26 | KampagneWorkspace.tsx:1233-1238 |
| KAM-27 | KampagneWorkspace.tsx:1243-1245 |
| KAM-28 | KampagneWorkspace.tsx:1247-1264 |
| KAM-29 | KampagneWorkspace.tsx:1272-1276 |
| KAM-30 | KampagneWorkspace.tsx:759-790, 1279-1284, 2224-2268 |
| KAM-31 | KampagneWorkspace.tsx:795-817, 1285-1289 |
| KAM-32 | KampagneWorkspace.tsx:2309-2319 |
| KAM-33 | KampagneWorkspace.tsx:2295-2307 |
| KAM-34 | KampagneWorkspace.tsx:2283-2293 |
| KAM-35 | KampagneWorkspace.tsx:1293-1298 |
| KAM-36 | KampagneWorkspace.tsx:1300-1303 |
| KAM-37 | KampagneWorkspace.tsx:1553-1569 |
| KAM-38 | KampagneWorkspace.tsx:1570-1613 |
| KAM-39 | KampagneWorkspace.tsx:1615 |
| KAM-40 | KampagneWorkspace.tsx:1617-1623 |
| KAM-41 | KampagneWorkspace.tsx:1624-1628 |
| KAM-42 | KampagneWorkspace.tsx:867-892, 1631-1638 |
| KAM-43 | KampagneWorkspace.tsx:1639-1649 |
| KAM-44 | KampagneWorkspace.tsx:2014-2016 |
| KAM-45 | KampagneWorkspace.tsx:821-862, 2017-2047 |
| KAM-46 | KampagneWorkspace.tsx:2049-2078 |
| KAM-47 | KampagneWorkspace.tsx:2108-2120 |
| KAM-48 | KampagneWorkspace.tsx:897-936, 2121-2128 |
| KAM-49 | KampagneWorkspace.tsx:2130-2140 |
| KAM-52 | KampagneWorkspace.tsx:1726-1737 |
| KAM-53 | KampagneWorkspace.tsx:1743-1770 |
| KAM-54 | KampagneWorkspace.tsx:659-708, 1771-1778 |
| KAM-55 | KampagneWorkspace.tsx:343-362, 1344-1348 |
| KAM-56 | KampagneWorkspace.tsx:1349-1355 |
| KAM-57 | KampagneWorkspace.tsx:1362-1367 |
| KAM-58 | KampagneWorkspace.tsx:1369-1376 |
| KAM-59 | KampagneWorkspace.tsx:378-418, 1380-1383 |
| KAM-60 | KampagneWorkspace.tsx:173-192, 1462-1479 |
| KAM-61 | KampagneWorkspace.tsx:523-532, 1384-1392 |
| KAM-62 | KampagneWorkspace.tsx:550-569, 1393-1396 |
| KAM-63 | KampagneWorkspace.tsx:571-588, 1397-1402 |
| KAM-64 | KampagneWorkspace.tsx:734-752, 1403-1410 |
| KAM-65 | KampagneWorkspace.tsx:420-447, 1412-1415 |
| KAM-66 | KampagneWorkspace.tsx:1450-1459 |
| KAM-67 | KampagneWorkspace.tsx:2154-2160 |
| KAM-68 | KampagneWorkspace.tsx:2162-2209 |
| KAM-69 | KampagneWorkspace.tsx:535-548, 2190-2203 |
| KPI-01 | KpiTab.tsx:97-104 |
| KPI-02 | KpiDateRangePicker.tsx:20-24, 69-83 |
| KPI-03 | KpiDateRangePicker.tsx:84-92 |
| KPI-04 | KpiDateRangePicker.tsx:93-95 |
| KPI-05 | KpiDateRangePicker.tsx:100-120 |
| KPI-06 | KpiDateRangePicker.tsx:121-130 |
| KPI-07 | KpiTab.tsx:159-164 |
| KPI-08 | KpiTab.tsx:196-206 |
| KPI-09 | KpiTab.tsx:207-220 |
| KPI-10 | KpiTab.tsx:223-232, KpiCharts.tsx:133-186 |
| KPI-11 | KpiTab.tsx:234-250, KpiCharts.tsx:192-231 |
| KPI-12 | KpiTab.tsx:252-259 |
| KPI-13 | KpiTab.tsx:261-276 |
| KPI-14 | KpiTab.tsx:277-282 |
| KPI-16 | KpiTab.tsx:200 |
| KPI-17 | KpiTab.tsx:960-1020 |
| KPI-18 | KpiTab.tsx:973, 994-998, 1007 |
| KPI-19 | KpiTab.tsx:1040-1065 |
| KPI-20 | KpiTab.tsx:1066-1097 |
| KPI-21 | KpiTab.tsx:1037, 1098-1103 |
| KPI-23 | KpiTab.tsx:358-367 |
| KPI-26 | KpiTab.tsx:1153-1158 |
| KPI-27 | KpiTab.tsx:1159-1172 |
| KPI-28 | KpiTab.tsx:1117-1125, 1175-1188 |
| KPI-29 | KpiTab.tsx:1148-1150, 1190-1196 |
| KPI-30 | KpiTab.tsx:433-450 |
| KPI-31 | KpiTab.tsx:425-430, 452-468 |
| KPI-32 | KpiTab.tsx:506-525 |
| KPI-33 | KpiTab.tsx:494-503, 527-540; kpi/sections/AttributionSection.tsx |
| KPI-34 | KpiTab.tsx:1228-1233 |
| KPI-35 | KpiTab.tsx:1234-1304 |
| KPI-36 | KpiTab.tsx:1307-1314, 1353-1364, 1371-1445 |
| KPI-37 | KpiTab.tsx:1315-1322, 1366-1368 |
| KPI-38 | KpiTab.tsx:1223-1225, 1323-1346 |
| KPI-39 | KpiTab.tsx:1463-1480 |
| KPI-40 | KpiTab.tsx:1458-1460, 1481-1487 |
| KPI-41 | KpiTab.tsx:1520-1533 |
| KPI-42 | KpiTab.tsx:1534-1543 |
| KPI-43 | KpiTab.tsx:1515-1517, 1544-1550 |
| KPI-44 | KpiTab.tsx:1573-1585 |
| KPI-45 | KpiTab.tsx:1586-1593 |
| KPI-46 | KpiTab.tsx:1568-1570, 1594-1597 |
| KPI-47 | KpiTab.tsx:1636-1651; kpi/sections/AccountSection.tsx |
| KPI-48 | KpiTab.tsx:1630-1633, 1652-1659 |
| KPI-49 | KpiTab.tsx:564-567 |
| KPI-50 | KpiTab.tsx:569-584 |
| KPI-51 | KpiTab.tsx:586-598 |
| KPI-52 | KpiTab.tsx:600-618, 663-679 |
| KPI-53 | KpiTab.tsx:620-639 |
| KPI-54 | KpiTab.tsx:558-561, 641-655 |
| KPI-55 | KpiTab.tsx:181-183 |
| KPI-56 | KpiTab.tsx:696-700 |
| KPI-57 | KpiTab.tsx:693, 701-707 |
| KPI-58 | KpiTab.tsx:741-745 |
| KPI-59 | KpiTab.tsx:746-762 |
| KPI-60 | KpiTab.tsx:735-737, 765-781 |
| KPI-61 | KpiTab.tsx:808-817, KpiCharts.tsx:237-275 |
| KPI-62 | KpiTab.tsx:819-836, 851-878 |
| KPI-63 | KpiTopQuestions.tsx:43-72 |
| KPI-64 | KpiTopQuestions.tsx:82-100 |
| KPI-65 | KpiTab.tsx:805 |
| KPI-66 | KpiTab.tsx:908-912 |
| KPI-67 | KpiTab.tsx:914-924 |
| KPI-68 | KpiTab.tsx:926-938 |
| KPI-69 | KpiTab.tsx:900-905, 940-949 |
| KPI-70 | KpiCharts.tsx:63-127 |
| FEE-01 | FeedbackTab.tsx:10-17 |
| FEE-02 | FeedbackTab.tsx:31-38 |
| FEE-03 | FeedbackList.tsx:87-101 |
| FEE-04 | FeedbackList.tsx:103-115 |
| FEE-05 | FeedbackList.tsx:117-125 |
| FEE-06 | FeedbackList.tsx:128-132 |
| FEE-07 | FeedbackList.tsx:134-137 |
| FEE-08 | FeedbackList.tsx:149-187 |
| GES-01 | GespraecheTab.tsx:26-33 |
| GES-02 | GespraecheWorkspace.tsx:330-347 |
| GES-03 | GespraecheWorkspace.tsx:348-350 |
| GES-04 | GespraecheWorkspace.tsx:351-363 |
| GES-05 | GespraecheWorkspace.tsx:364-370 |
| GES-06 | GespraecheWorkspace.tsx:283-287, 374-388 |
| GES-07 | GespraecheWorkspace.tsx:389-397 |
| GES-08 | GespraecheWorkspace.tsx:399-412 |
| GES-09 | GespraecheWorkspace.tsx:414-427 |
| GES-10 | GespraecheWorkspace.tsx:429-442 |
| GES-11 | GespraecheWorkspace.tsx:444-451 |
| GES-12 | GespraecheWorkspace.tsx:453-455 |
| GES-13 | GespraecheWorkspace.tsx:458-490 |
| GES-14 | GespraecheInsights.tsx:220-223 |
| GES-15 | GespraecheInsights.tsx:225-227 |
| GES-16 | GespraecheInsights.tsx:228-236 |
| GES-17 | GespraecheInsights.tsx:160-214, 271-292 |
| GES-18 | GespraecheInsights.tsx:59-131, 241-251 |
| GES-19 | GespraecheInsights.tsx:252-262 |
| GES-20 | GespraecheInsights.tsx:82 |
| GES-21 | GespraecheInsights.tsx:264-268 |
| GES-22 | GespraecheWorkspace.tsx:212-219 |
| GES-23 | GespraecheWorkspace.tsx:220-239 |
| GES-24 | GespraecheWorkspace.tsx:247-253 |
| GES-25 | GespraecheWorkspace.tsx:565-628 |
| GES-26 | GespraecheWorkspace.tsx:79-88, 498-542 |
| GES-27 | GespraecheWorkspace.tsx:544-563, 607-624 |
| GES-28 | GespraecheWorkspace.tsx:711-719 |
| GES-29 | GespraecheWorkspace.tsx:646-682, 728-748 |
| GES-30 | GespraecheWorkspace.tsx:756-769 |
| GES-31 | GespraecheWorkspace.tsx:684-709, 773-779 |
| GES-32 | GespraecheWorkspace.tsx:780-801 |
| GES-33 | GespraecheWorkspace.tsx:802-807 |
| GES-34 | GespraecheWorkspace.tsx:811-837 |
| GES-35 | GespraecheInsights.tsx:427-437 |
| GES-36 | GespraecheInsights.tsx:440-450 |
| GES-37 | GespraecheInsights.tsx:395-419, 451-463 |
| GES-38 | GespraecheInsights.tsx:466-472 |
| GES-39 | GespraecheInsights.tsx:474-486 |
| GES-40 | GespraecheInsights.tsx:300-364, GespraecheWorkspace.tsx:167-170 |
| GES-41 | GespraecheInsights.tsx:358-361 |
| GES-42 | GespraecheInsights.tsx:493-502 |
| WIS-01 | WissenWorkspace.tsx:113-136, 143-151 |
| WIS-02 | WissenWorkspace.tsx:152-154 |
| WIS-03 | WissenWorkspace.tsx:155-171 |
| WIS-04 | WissenWorkspace.tsx:185-189 |
| WIS-05 | WissenWorkspace.tsx:388-404 |
| WIS-06 | WissenWorkspace.tsx:406-408 |
| WIS-07 | WissenWorkspace.tsx:410-419 |
| WIS-08 | WissenWorkspace.tsx:421-431 |
| WIS-09 | WissenWorkspace.tsx:433-441 |
| WIS-10 | WissenWorkspace.tsx:442-452, 549-589 |
| WIS-11 | WissenWorkspace.tsx:239-263, 500-503 |
| WIS-12 | WissenWorkspace.tsx:265-296, 504-511 |
| WIS-13 | WissenWorkspace.tsx:298-314, 512-517 |
| WIS-14 | WissenWorkspace.tsx:335-344, 518-522 |
| WIS-15 | WissenWorkspace.tsx:316-333, 526-533 |
| WIS-16 | WissenWorkspace.tsx:537-546 |
| WIS-17 | WissenWorkspace.tsx:456-497 |
| WIS-18 | WissenWorkspace.tsx:417, 429, 439 |
| ANA-01 | ReportSidebar.tsx:66-80 |
| ANA-02 | ReportSidebar.tsx:82-133, AnalyseWorkspace.tsx:73-90 |
| ANA-03 | GenerateReportPanel.tsx:147-198 |
| ANA-04 | GenerateReportPanel.tsx:202-216 |
| ANA-05 | GenerateReportPanel.tsx:217-231 |
| ANA-06 | GenerateReportPanel.tsx:74-105, 235-263 |
| ANA-07 | GenerateReportPanel.tsx:107-132, 266-273 |
| ANA-08 | ReportProgressDriver.tsx:74-118, 135-236 |
| ANA-09 | AnalyseWorkspace.tsx:158-186 |
| ANA-10 | ReportActions.tsx:60-68 |
| ANA-11 | ReportActions.tsx:29-57, 69-96 |
| ANA-12 | AnalyseWorkspace.tsx:212-218 |
| ANA-13 | AnalyseWorkspace.tsx:118-140 |
| ANA-14 | ReportView.tsx:137-273 |
| VER-01 | VerbesserungWorkspace.tsx:262-274 |
| VER-02 | VerbesserungWorkspace.tsx:276-323, 110-133 |
| VER-03 | VerbesserungWorkspace.tsx:431-448 |
| VER-04 | VerbesserungWorkspace.tsx:350-378, 455-458 |
| VER-05 | VerbesserungWorkspace.tsx:424-428 |
| VER-06 | VerbesserungWorkspace.tsx:640-763 |
| VER-07 | VerbesserungWorkspace.tsx:487-501 |
| VER-08 | VerbesserungWorkspace.tsx:765-803 |
| VER-09 | VerbesserungWorkspace.tsx:513-537, 581-626 |
| VER-10 | VerbesserungWorkspace.tsx:548-559 |
| VER-11 | SuggestionCard.tsx:172-180 |
| VER-12 | SuggestionCard.tsx:184-216 |
| VER-13 | SuggestionCard.tsx:219-262 |
| VER-14 | SuggestionCard.tsx:123-166, 302-306 |
| VER-15 | SuggestionCard.tsx:309-313 |
| VER-16 | SuggestionCard.tsx:272-293, 315-318 |
| VER-17 | SuggestionCard.tsx:294-300 |
| VER-18 | SuggestionCard.tsx:264-268 |
| VER-19 | VerbesserungWorkspace.tsx:214-223 |
| VER-20 | DirectivesCard.tsx:236-253, 284 |
| VER-21 | DirectivesCard.tsx:214-227, 255-257, 287-313 |
| VER-22 | DirectivesCard.tsx:161-186, 258-267, 268-283 |
| VER-23 | DirectivesCard.tsx:188-212, 269-278 |
| VER-24 | DirectivesCard.tsx:68-99, 128-149 |
| VER-25 | VerbesserungWorkspace.tsx:224-227, SelfSnapshotCard.tsx:22-58 |
| VER-26 | VerbesserungWorkspace.tsx:153-176, 287-290 |
| EIN-01 | EmailSettingsWorkspace.tsx:159-192 |
| EIN-02 | EmailSettingsWorkspace.tsx:193-210, EmailPreviewButton.tsx |
| EIN-03 | EmailSettingsWorkspace.tsx:92-140, 267-281 |
| EIN-04 | EmailSettingsWorkspace.tsx:282-291 |
| EIN-05 | EmailSettingsWorkspace.tsx:243-248 |
| EIN-06 | EmailSettingsWorkspace.tsx:311-338 |

### B.6 Baseline references of the helper-text lists of part 1

| List / item | Reference (baseline) |
|---|---|
| 0. Globale Shell /  #1 | AdminShell.tsx:61 |
| 0. Globale Shell /  #2 | Profil, Käufe, Marketing, Korrespondenz & Brief" — AdminShell.tsx:63 |
| 0. Globale Shell /  #3 | prüfen, anpassen, senden" — AdminShell.tsx:65 |
| 0. Globale Shell /  #4 | AdminShell.tsx:66 |
| 0. Globale Shell /  #5 | neueste zuerst" — AdminShell.tsx:67 |
| 0. Globale Shell /  #6 | Transkripte, Signale, KI-Analyse" — AdminShell.tsx:69 |
| 0. Globale Shell /  #7 | für Produktseite & Mo" — AdminShell.tsx:71 |
| 0. Globale Shell /  #8 | alle KI-Auswertungen verdichtet, gespeichert & als PDF" — AdminShell.tsx:73 |
| 0. Globale Shell /  #9 | für den Shop & für sich selbst" — AdminShell.tsx:75 |
| 0. Globale Shell /  #10 | neue Designs entstehen mit Claude Code" — AdminShell.tsx:77 |
| 0. Globale Shell /  #11 | es können keine Kunden geladen werden." — page.tsx:283 |
| 0. Globale Shell /  #12 | anonyme Sessions bleiben unverknüpft." — page.tsx:291-292 |
| 1. Login /  #1 | login/page.tsx:67 |
| 1. Login /  #2 | Login ist deaktiviert." — login/page.tsx:72-73 |
| 1. Login /  #3 | login/page.tsx:57 |
| 1. Login /  #4 | login/page.tsx:59 |
| 2. Übersicht /  #1 | die Übersicht kann nicht berechnet werden." — OverviewTab.tsx:59-60 |
| 2. Übersicht /  #2 | schreibgeschützt, nur Lesen." — OverviewTab.tsx:85 |
| 2. Übersicht /  #3 | OverviewTab.tsx:92 |
| 2. Übersicht /  #4 | OverviewTab.tsx:97 |
| 2. Übersicht /  #5 | OverviewTab.tsx:102 |
| 2. Übersicht /  #6 | OverviewTab.tsx:107 |
| 2. Übersicht /  #7 | die Kunden-Links öffnen die Liste bereits gefiltert." — OverviewTab.tsx:114 |
| 2. Übersicht /  #8 | OverviewTab.tsx:120 |
| 2. Übersicht /  #9 | OverviewTab.tsx:125 |
| 2. Übersicht /  #10 | gruppiert nach Person." — OverviewTab.tsx:130 |
| 2. Übersicht /  #11 | OverviewTab.tsx:135 |
| 2. Übersicht /  #12 | OverviewTab.tsx:142 |
| 2. Übersicht /  #13 | OverviewTab.tsx:148 |
| 2. Übersicht /  #14 | OverviewTab.tsx:159 |
| 2. Übersicht /  #15 | OverviewTab.tsx:163 |
| 3. Kunden / Unmatched-Queue / Workspace #1 | sie wandert…" — UnmatchedInboundQueue.tsx:65-68 (2026-10: wortgleich als InfoTip in `eingang/UnmatchedInbound.tsx`) |
| 3. Kunden / Unmatched-Queue / Workspace #2 | KundenWorkspace.tsx:249 |
| 3. Kunden / Unmatched-Queue / Workspace #3 | KundenWorkspace.tsx:341 |
| 3. Kunden / Unmatched-Queue / Workspace #4 | KundenWorkspace.tsx:367 |
| 3. Kunden / Unmatched-Queue / Workspace #5 | KundenWorkspace.tsx:330 |
| 3. Kunden / Unmatched-Queue / Workspace #6 | es wird nichts gesendet." — KundenWorkspace.tsx:407-410 |
| 3. Kunden / Unmatched-Queue / Workspace #7 | sichtbar im Marketing-Tab des Kunden." — KundenWorkspace.tsx:211 |
| 3. Kunden / Unmatched-Queue / Workspace #8 | z. B. …" / „N von M erstellt, K fehlgeschlagen…" — KundenWorkspace.tsx:217, 223 |
| 3. Kunden / CustomerProfileCard #9 | CustomerProfileCard.tsx:327 |
| 3. Kunden / CustomerProfileCard #10 | :331 |
| 3. Kunden / CustomerProfileCard #11 | :335 |
| 3. Kunden / CustomerProfileCard #12 | :377 |
| 3. Kunden / CustomerProfileCard #13 | :380-388 |
| 3. Kunden / CustomerProfileCard #14 | die E-Mail wurde erfasst, aber die zugehörige Session ist nicht (mehr) gespeichert." — :399-400 |
| 3. Kunden / CustomerProfileCard #15 | :422 |
| 3. Kunden / CustomerProfileCard #16 | :525 |
| 3. Kunden / CustomerProfileCard #17 | :532 |
| 3. Kunden / CustomerProfileCard #18 | :576 |
| 3. Kunden / CustomerProfileCard #19 | :618 |
| 3. Kunden / CustomerProfileCard #20 | es kann keine Marketing-E-Mail generiert werden." — :637 |
| 3. Kunden / CustomerProfileCard #21 | bis dahin keine Marketing-E-Mail." — :638 |
| 3. Kunden / CustomerProfileCard #22 | es wird keine Marketing-E-Mail mehr generiert oder gesendet." — :639 |
| 3. Kunden / CustomerProfileCard #23 | :779-780 |
| 3. Kunden / CustomerProfileCard #24 | :833 |
| 3. Kunden / CustomerProfileCard #25 | :861-862 |
| 3. Kunden / CustomerProfileCard #26 | :866-867 |
| 3. Kunden / CustomerProfileCard #27 | :892-893 |
| 3. Kunden / CustomerProfileCard #28 | die Produktbilder tragen die Botschaft." / „Nur Anrede + ein Satz — die E-Mail wirkt wie ein visuelles Lookbook.") — :904, src/lib/email-text-mode.mjs:43-47 |
| 3. Kunden / CustomerProfileCard #29 | der aktuelle Text passt nicht mehr." — :913 |
| 3. Kunden / CustomerProfileCard #30 | er wird beim Versand durch den echten, einmaligen N%-Code (7 Tage gültig) ersetzt." — :921 |
| 3. Kunden / CustomerProfileCard #31 | der Text nennt keinen Code, der Warenkorb-Link enthält keinen Rabatt." — :922 |
| 3. Kunden / CustomerProfileCard #32 | :947-949 |
| 3. Kunden / CustomerProfileCard #33 | …" / „Der getrackte Warenkorb-Link entsteht erst beim Senden." — :970-973 |
| 3. Kunden / CustomerProfileCard #34 | :980 |
| 3. Kunden / CustomerProfileCard #35 | kostet Tokens." — :997-999 |
| 3. Kunden / CustomerProfileCard #36 | kostet Tokens." — :1327 |
| 3. Kunden / CustomerProfileCard #37 | du kannst frei anpassen." — :1157 |
| 3. Kunden / CustomerProfileCard #38 | :1371 |
| 3. Kunden / CustomerProfileCard #39 | nicht hinzufügbar" (disableReason) — :1390 |
| 3. Kunden / CustomerProfileCard #40 | es wird KEINE „statt"-Zeile angezeigt (das Bundle ist nicht günstiger als die Einzelprodukte)." — :1441-1442 |
| 3. Kunden / CustomerProfileCard #41 | :1188, 1192 |
| 3. Kunden / CustomerProfileCard #42 | :1259-1260 |
| 3. Kunden / CustomerProfileCard #43 | :1456 |
| 3. Kunden / CustomerProfileCard #44 | :1476-1477 |
| 3. Kunden / CustomerProfileCard #46 | :1290 |
| 3. Kunden / CustomerProfileCard #47 | :756 |
| 3. Kunden / CustomerProfileCard #48 | :784 |
| 3. Kunden / KorrespondenzPanel #49 | KorrespondenzPanel.tsx:137-138 |
| 3. Kunden / KorrespondenzPanel #50 | :160-161 |
| 3. Kunden / KorrespondenzPanel #51 | :264, 186 |
| 3. Kunden / KorrespondenzPanel #52 | :280-281 |
| 3. Kunden / KorrespondenzPanel #53 | :284, 298, 309 |
| 3. Kunden / KorrespondenzPanel #54 | :411 |
| 3. Kunden / KorrespondenzPanel #55 | :413-417 |
| 3. Kunden / KorrespondenzPanel #56 | bewusst schlichtes Text-Layout ohne Marketing-Elemente." — :427 |
| 3. Kunden / KorrespondenzPanel #57 | :347 |
| 3. Kunden / PhysicalLetterPanel #58 | PhysicalLetterPanel.tsx:218-221 |
| 3. Kunden / PhysicalLetterPanel #59 | :235 |
| 3. Kunden / PhysicalLetterPanel #60 | :287-290 |
| 3. Kunden / PhysicalLetterPanel #61 | :205, 296 |
| 3. Kunden / PhysicalLetterPanel #62 | :300, 68-71 |
| 4. Kampagne /  #1 | das Kampagnen-Modul kann keine Kontakte laden." — KampagneTab.tsx:38-39 |
| 4. Kampagne /  #2 | KampagneWorkspace.tsx:1093-1096 |
| 4. Kampagne /  #3 | Sync, Kaufhistorie und Rabattcodes sind deaktiviert." — :1101-1102 |
| 4. Kampagne /  #4 | :1137 |
| 4. Kampagne /  #5 | :1150-1152 |
| 4. Kampagne /  #6 | :1213-1214 |
| 4. Kampagne /  #7 | oder über die Kontaktsuche links eine:n einzelne:n Kund:in aufnehmen." — :1235-1237 (2026-10 ersetzt, s. KAM-26) |
| 4. Kampagne /  #8 | :1244 |
| 4. Kampagne /  #9 | :1296 |
| 4. Kampagne /  #10 | :1301-1302 |
| 4. Kampagne /  #11 | :1357-1359 |
| 4. Kampagne /  #12 | :1371-1374 |
| 4. Kampagne /  #13 | :1388 |
| 4. Kampagne /  #14 | auch manuelle Änderungen an Betreff/Text gehen verloren. Die Kontakte werden wieder „Offen" und mit „Nächste 50 vorbereiten" neu generiert (erneute API-Kosten). Gesendete, übersprungene und unterdrückte Kontakte sowie angehängte Set-Angebote bleiben unberührt." — :1431-1435 |
| 4. Kampagne /  #15 | :1467-1469 |
| 4. Kampagne /  #16 | der echte MK-Code wird erst beim Senden erzeugt." — :527-528 |
| 4. Kampagne /  #17 | gespeichert ist der kopierte Text (kein HTML verschickt)." / „Genau dieser Inhalt wurde verschickt." — :541-542 |
| 4. Kampagne /  #18 | beim Kopier-Versand wird KEIN echter Code erzeugt." / „Betreff + Text kopiert. Danach „Als erledigt markieren" klicken." — :563-564 |
| 4. Kampagne /  #19 | mit „Nächste 50 vorbereiten" neu generieren. Seite wird neu geladen…" — :986 |
| 4. Kampagne /  #20 | :943, 955 (2026-10 → „Zielgruppe wird aktualisiert…“ / „Zielgruppe aktualisiert“, KAM-102) |
| 4. Kampagne /  #21 | :1554, 1566 |
| 4. Kampagne /  #22 | :1615 |
| 4. Kampagne /  #23 | :1620-1621 |
| 4. Kampagne /  #24 | :1626 |
| 4. Kampagne /  #25 | :1648 |
| 4. Kampagne /  #26 | :1696-1710 |
| 4. Kampagne /  #27 | keine Set-Angebote möglich." — :1732-1733 |
| 4. Kampagne /  #28 | :1764, 1768 |
| 4. Kampagne /  #29 | :1781-1783 |
| 4. Kampagne /  #30 | :1894, 1896 |
| 4. Kampagne /  #31 | :1898, 1902, 1950, 1966 |
| 4. Kampagne /  #32 | :1941 |
| 4. Kampagne /  #33 | :2015, 2046 |
| 4. Kampagne /  #34 | :2081-2082 |
| 4. Kampagne /  #35 | :2067-2068 |
| 4. Kampagne /  #36 | echter MK-Code wird beim Senden erzeugt (voraussichtlich gültig bis …). „Übernehmen" generiert den Text automatisch neu." — :2133-2135 |
| 4. Kampagne /  #37 | „Übernehmen" generiert den Text automatisch neu; Code + Rabattzeile werden beim Versand angehängt." — :2138 |
| 4. Kampagne /  #38 | :2157 |
| 4. Kampagne /  #39 | :2199 |
| 4. Kampagne /  #40 | Klick legt sie manuell fest und generiert den Text neu." + „✎" title „Manuell festgelegt" — :2241-2243, 2262 |
| 4. Kampagne /  #41 | der KPI-Tab vergleicht beide Gruppen." — :2288 |
| 4. Kampagne /  #42 | :2302 |
| 4. Kampagne /  #43 | :2316 |
| 4. Kampagne /  #44 | Entwurf wird generiert…", „Sprache: … — Text wird neu generiert…", „Textmodus: … — Text wird neu generiert…", „Auswahl wird angewendet — Empfehlungen & Text werden neu erzeugt…", „Text wird neu generiert, damit er das Set erwähnt…" — :462, 496, 774, 801, 873, 692 |
| 5. KPIs /  #1 | KpiTab.tsx:159-164 |
| 5. KPIs /  #2 | :199/206 |
| 5. KPIs /  #3 | :213 |
| 5. KPIs /  #4 | :218 |
| 5. KPIs /  #5 | dieselbe ehrliche Zuordnung wie beim Umsatz-Abschnitt. Käufe ohne Mo-Code sind nicht zurechenbar und erscheinen hier nicht; „Konvertiert" ist eine Untergrenze." — :252-259 |
| 5. KPIs /  #6 | :268, 273 |
| 5. KPIs /  #7 | :277-282 |
| 5. KPIs /  #8 | Zeitraum: …" — :344 |
| 5. KPIs /  #9 | :363, 405-406 |
| 5. KPIs /  #10 | gemessen wird die Oberfläche, nicht die bestätigte Anmeldung: ein „Akzeptiert" wird erst mit dem Klick auf den Double-Opt-in-Link zur wirksamen Marketing-Einwilligung (siehe E-Mail-Capture-Funnel in der Event-Übersicht). Events ohne surface zählen nur in den Gesamtwerten." — :381-390 |
| 5. KPIs /  #11 | Zeitraum: …" — :423 |
| 5. KPIs /  #12 | :438 |
| 5. KPIs /  #13 | :437, 443, 448 |
| 5. KPIs /  #14 | geprüft per Shopify (read_orders) über das Bestellfeld discount_code, gezählt wird der tatsächlich bezahlte Bestellwert (currentTotalPrice, nur Status PAID / PARTIALLY_REFUNDED). Käufe über Warenkorb-Links (In-Chat-Checkout, Zusammenfassungs-E-Mail, Bundles) zählen hier bewusst NICHT — sie werden seit der Attributions-Runde separat im Abschnitt „Mo-zugeordneter Umsatz (Bestell-Webhook)" gemessen. [Bei N Code(s) lieferte Shopify keine Antwort (nicht gezählt).] [Auf die N neuesten Codes begrenzt.]" — :452-468 |
| 5. KPIs /  #15 | der Umsatz kann nicht berechnet werden." — :429 |
| 5. KPIs /  #16 | Zeitraum: …" — :492 |
| 5. KPIs /  #17 | erfasst wird ab Registrierung, rückwirkend nicht." — :497-503 |
| 5. KPIs /  #18 | :511 |
| 5. KPIs /  #19 | auch wenn es manuell über die Suche in den Warenkorb gelegt wurde." — :517 |
| 5. KPIs /  #20 | Mo hat beraten, gekauft wurde etwas anderes." — :523 |
| 5. KPIs /  #21 | physikalische Grenze, keine Messlücke. [N erfasste Bestellung(en) im Zeitraum sind (noch) nicht bezahlt und zählen nicht zum Umsatz.]" — :527-540 **Nachtrag 2026-10-05** (AttributionSection.tsx): Fenster je Modus („… bei der Widget-Markierung ab der letzten Produktberatung auf dem Gerät (Produktkarte, Vergleich, Warenkorb-Karte, Showroom), bei Mo-Links ab ihrer Erstellung.“ bzw. „… ab der Erstellung der Markierung.“); „Unmarkierte Bestellungen werden hier nicht erfasst (nicht in der Mo-Zuordnung gespeichert)“; neuer Absatz „„Ohne Zuordnung“: die Markierung ist unbekannt (nach einer Löschanfrage oder abgelaufen gelöscht), oder die letzte Beratung (Schalter aus: die Markierung) lag mehr als N Tage vor der Bestellung. Diese Bestellungen werden nur gezählt, keiner Beratung zugeordnet und nicht gespeichert.“ |
| 5. KPIs /  #22 | Zeitraum: …" — :555 |
| 5. KPIs /  #23 | danach erscheinen hier die Kosten." — :559-560 |
| 5. KPIs /  #24 | :565-566 |
| 5. KPIs /  #25 | :573, 582, 591, 596, 627, 632, 637 |
| 5. KPIs /  #26 | die Ersparnis ist der Netto-Effekt gegenüber denselben Aufrufen ohne Caching[; einzelne Werte sind geschätzt, wenn der Anbieter keine Token-Zahl liefert]." — :641-655 |
| 5. KPIs /  #27 | :690 |
| 5. KPIs /  #28 | :701-707 |
| 5. KPIs /  #29 | :693 |
| 5. KPIs /  #30 | :732 |
| 5. KPIs /  #31 | :751, 758 |
| 5. KPIs /  #32 | kein Tracking-Pixel, nur der bewusst geklickte Link. „Eingelöst" prüft per Shopify (read_orders), ob der einmalige persönliche Code der jeweiligen E-Mail in einer echten Bestellung verwendet wurde; die Einlösungsrate bezieht sich auf die geprüften Codes mit Shopify-Antwort (nicht auf alle Sends — die Prüfung ist auf die neuesten Codes begrenzt). [Shopify ist nicht konfiguriert — die Einlösung kann nicht berechnet werden.] [Bei N Code(s) lieferte Shopify keine Antwort (als „unbekannt" gewertet).] [Einlösungsprüfung auf die 100 neuesten Codes begrenzt.]" — :765-781 |
| 5. KPIs /  #33 | :737 |
| 5. KPIs /  #34 | :802 |
| 5. KPIs /  #35 | :830, 833 |
| 5. KPIs /  #36 | :805 |
| 5. KPIs /  #37 | kostet Anthropic-Tokens (wenige Cent pro Lauf). Ergebnis wird zwischengespeichert." — KpiTopQuestions.tsx:76-77 |
| 5. KPIs /  #38 | KpiTopQuestions.tsx:94-97 |
| 5. KPIs /  #39 | KEINE site-weite Conversion-Rate." — :897 |
| 5. KPIs /  #40 | also eine Minderheit aller Chat-Nutzer:innen. Diese Zahl ist keine site-weite Conversion-Rate." — :909-911 |
| 5. KPIs /  #41 | :921-922 |
| 5. KPIs /  #42 | also eine Minderheit aller Chatter und nicht alle Käufer. Produkt-Zuordnung erfolgt über normalisierte Shopify-Handles; umbenannte/archivierte Produkte können fehlen. [Bei N Kontakt(en) lieferte Shopify keine Antwort (als „unbekannt" gewertet).] [Stichprobe auf die 100 neuesten Kontakte begrenzt.]" — :940-949 |
| 5. KPIs /  #43 | die Kauf-Zuordnung kann nicht berechnet werden." — :903-904 |
| 5. KPIs /  #44 | Zeitraum: …" — :970 |
| 5. KPIs /  #45 | :994-998 |
| 5. KPIs /  #46 | Zeitraum: …" — :1034 |
| 5. KPIs /  #47 | :1044, 1054 |
| 5. KPIs /  #48 | die Abdeckung oben zeigt, wie repräsentativ das ist. Die Analyse läuft auf Abruf, nicht automatisch." — :1098-1103 |
| 5. KPIs /  #49 | Zeitraum: …" — :1145 |
| 5. KPIs /  #50 | :1164, 1170 |
| 5. KPIs /  #51 | vom Widget gemeldet. Wirksam wird die Marketing-Einwilligung erst mit dem DOI-Klick." — :1190-1196 |
| 5. KPIs /  #52 | Zeitraum: …" — :1220 |
| 5. KPIs /  #53 | :1238-1302 |
| 5. KPIs /  #54 | mit den Hero-Kosten der jeweiligen Kontakte (Prompt, Renders, Prüfung)." — :1309 |
| 5. KPIs /  #55 | :1317 |
| 5. KPIs /  #56 | Sends vor Migration 0041 und Kopier-Sends tragen keinen Link und können nicht als geklickt zählen (Basis: getrackte Sends). „Eingelöst" prüft per Shopify, ob der einmalige MK-Code der jeweiligen E-Mail verwendet wurde; die Rate bezieht sich auf die geprüften Codes mit Antwort. […] „Zugestellt / Bounces" kommt aus dem Resend-Webhook (harte Bounces und Beschwerden sperren die Adresse dauerhaft). „Set geklickt" und „Abgemeldet" gelten für Sends ab Migration 0054; die Abmeldung wird den Kampagnen-Mails der letzten 30 Tage an diese Adresse zugeordnet. Bewertungen sind absichtlich anonym und lassen sich keiner Variante zuordnen. Für einen fairen Hero-Vergleich brauchen beide Gruppen Sends — der Kampagnen-Workspace zeigt je Kontakt die A/B-Gruppe an (gerade Kontakt-ID: mit Hero, ungerade: ohne)." — :1323-1346 |
| 5. KPIs /  #57 | Zeitraum: …" — :1455 |
| 5. KPIs /  #58 | :1467-1478 |
| 5. KPIs /  #59 | es gibt kein zuverlässig gespeichertes Bestellsignal je Angebot (keine erfundene Zuordnung; siehe Umsatz-Abschnitt)." — :1481-1487 |
| 5. KPIs /  #60 | Durchsatz im Zeitraum: …" — :1512 |
| 5. KPIs /  #61 | :1524-1541 |
| 5. KPIs /  #62 | :1544-1550 |
| 5. KPIs /  #63 | Volumen im Zeitraum: …" / Hint „antwortbar" / Caveat „Reines Volumen — die Inhalte stehen im Feedback-Tab. Der Kundentyp ist die Widget-Selbstauskunft (telemetriegradig, nicht verbindlich)." — :1565, 1583, 1594-1597 |
| 5. KPIs /  #64 | Zeitraum: …" / Hints „n stille Erkennungen", „Art. 15/20", „Art. 17" — :1627, 1642, 1649-1650 |
| 5. KPIs /  #65 | :1631-1632 |
| 5. KPIs /  #66 | keine Personenbezüge. „Stille Erkennungen" sind automatische Wieder-Anmeldungen bereits eingeloggter Shopify-Kund:innen (prompt=none). Kontaktformular = akzeptierte Übermittlungen; vergleichbar mit den show_contact_form-Aufrufen im Gespräche-Tab." — :1652-1659. **Nachtrag 2026-10-05:** der InfoTip erklärt jetzt „Im Chat angemeldet“ (Sitzungen; „über „Anmelden““, „über Shop-Login“ nur neue Anmeldungen, „bereits angemeldet (bestätigt)“), „Shopify-Anmeldungen“ / „still“ (prompt=none) und „Codes abgelehnt“; neu der InfoTip von „Shop-Login-Erkennung (App Proxy)“ (KPI-83) und von „Nach Anmeldeweg“ (KPI-84); der Einwilligungs-InfoTip nennt die Anti-Nag-Regel — AccountSection.tsx, ConsentGateSection.tsx |
| 6. Feedback /  #1 | es kann kein Feedback geladen werden." — FeedbackTab.tsx:13-14 |
| 6. Feedback /  #2 | neueste zuerst." — FeedbackTab.tsx:34-35 |
| 6. Feedback /  #3 | FeedbackList.tsx:97 |
| 6. Feedback /  #4 | FeedbackList.tsx:136 |
| 7. Gespräche /  #1 | es können keine Gespräche geladen werden." — GespraecheTab.tsx:29-30 |
| 7. Gespräche /  #2 | Wörter, Namen, IDs, E-Mail, Tags …" — GespraecheWorkspace.tsx:336 |
| 7. Gespräche /  #3 | der Zeitraum wird ignoriert." — :366-368 |
| 7. Gespräche /  #4 | :450 |
| 7. Gespräche /  #5 | :250-251 |
| 7. Gespräche /  #6 | :512, 517, 522, 527 |
| 7. Gespräche /  #7 | :623 |
| 7. Gespräche /  #8 | :715 |
| 7. Gespräche /  #9 | bitte erneut versuchen." / „Nicht gefunden." — :667, 674, 744 |
| 7. Gespräche /  #10 | :793-800 |
| 7. Gespräche /  #11 | erneutes Öffnen kostet nichts." — :803-806 |
| 7. Gespräche /  #12 | :817 |
| 7. Gespräche /  #13 | GespraecheInsights.tsx:82 |
| 7. Gespräche /  #14 | zeigt ALLE passenden Gespräche" — :111-113 |
| 7. Gespräche /  #15 | :226 |
| 7. Gespräche /  #16 | jedes mit seiner Kurz-Erklärung. Erneuter Klick hebt den Filter auf." — :265-267 |
| 7. Gespräche /  #17 | sind danach noch welche offen, einfach erneut ausführen." — :276-280 |
| 7. Gespräche /  #18 | :165, 196-199 |
| 7. Gespräche /  #19 | :359-360 |
| 7. Gespräche /  #20 | :432-435 |
| 7. Gespräche /  #21 | günstig und skalierbar. Ergebnis wird je Zeitraum zwischengespeichert. Enthält Empfehlungen zur Verfeinerung auf Basis aller analysierten Gespräche. [Zuerst Gespräche analysieren.]" — :467-471 |
| 7. Gespräche /  #22 | :496, 501, 409 |
| 8. Wissen /  #1 | WissenWorkspace.tsx:176-182 |
| 8. Wissen /  #2 | :186-188 |
| 8. Wissen /  #3 | anpassbar)" — :412 |
| 8. Wissen /  #4 | :423, 428 |
| 8. Wissen /  #5 | erscheint öffentlich im Q&A und in Mos Wissen." — :438 |
| 8. Wissen /  #6 | sie erscheinen im Q&A als klickbarer Text statt als URL." — :445-448 |
| 8. Wissen /  #7 | leer lassen für automatische Übersetzung beim Veröffentlichen)" / Button-Text — :461-463, 489-492 |
| 8. Wissen /  #8 | :275-286 |
| 8. Wissen /  #9 | :302-306, 322-326 |
| 9. Analyse /  #1 | GenerateReportPanel.tsx:139-143 |
| 9. Analyse /  #2 | am teuersten und enthält Namen. Sonst bleibt der Bericht pseudonym." — :212-215 |
| 9. Analyse /  #3 | „alles an einem Ort", aber ein längeres PDF." — :227-230 |
| 9. Analyse /  #4 | :253-255 |
| 9. Analyse /  #5 | :270-272 |
| 9. Analyse /  #6 | der Bericht wird Schritt für Schritt erstellt … Pausieren ist jederzeit möglich…" — ReportProgressDriver.tsx:229-233 |
| 9. Analyse /  #7 | ReportSidebar.tsx:87-89 |
| 9. Analyse /  #8 | ReportActions.tsx:76-79 |
| 9. Analyse /  #9 | falls gewählt — einzelne Profile", „Jede analysierte Beratung mit Kategorie & Qualität") — ReportView.tsx:155, 217, 226, 240, 265 |
| 9. Analyse /  #10 | ReportView.tsx:166 |
| 9. Analyse /  #11 | ReportView.tsx:255 |
| 10. Verbesserung /  #1 | VerbesserungWorkspace.tsx:398-422 |
| 10. Verbesserung /  #2 | :451-454 |
| 10. Verbesserung /  #3 | insgesamt kann das einige Minuten dauern. Kurze Verbindungsabbrüche…" — :754-758 |
| 10. Verbesserung /  #4 | :505-511 |
| 10. Verbesserung /  #5 | :529-532 |
| 10. Verbesserung /  #6 | es gab noch keine angenommenen oder umgesetzten Maßnahmen aus früheren Läufen." — :522-526 |
| 10. Verbesserung /  #7 | alles bereits Vorgeschlagene ist noch offen oder umgesetzt…" — :541-545 |
| 10. Verbesserung /  #8 | :562-566 |
| 10. Verbesserung /  #9 | :619-622 |
| 10. Verbesserung /  #10 | genau dieser Text gilt nach dem Übernehmen · k/N Zeichen" — SuggestionCard.tsx:200-203 |
| 10. Verbesserung /  #11 | Mo berät ab sofort so … kann dort jederzeit angepasst oder abgeschaltet werden." — :152-157 |
| 10. Verbesserung /  #12 | Mos Kern-Prompt bleibt unverändert im Code (Git)." — DirectivesCard.tsx:106-113 |
| 10. Verbesserung /  #13 | oder übernimm eine aus einem Verbesserungsvorschlag." + Toast „Sie fließt innerhalb weniger Minuten in Mos System-Prompt ein." — :116-119, 92-96 |
| 10. Verbesserung /  #14 | genau der Stand, den der Verbesserungslauf analysiert. Enthält N veröffentlichte Q&A-Einträge und M aktive Anweisung(en). Der Kern-Prompt wird über Code-Änderungen (Git) angepasst; hier ist er nur lesbar." — SelfSnapshotCard.tsx:28-34 |
| 11. Einstellungen /  #1 | EmailSettingsWorkspace.tsx:149-155 |
| 11. Einstellungen /  #2 | :215-224 |
| 11. Einstellungen /  #3 | im gewählten Design. Ein Wechsel wirkt sofort auf neue Sendungen und lässt sich jederzeit zurücknehmen." — :234-239 |
| 11. Einstellungen /  #4 | der rechtlich geprüfte Text bleibt unverändert.", „Persönliche KI-E-Mails an Chat-Kunden (Rabatt, Warenkorb, Set-Angebot).", „Persönliche KI-E-Mails an Shopify-Marketing-Abonnent:innen (de/en).") — :260-262 (lib/email-theme.mjs) |
| 11. Einstellungen /  #5 | Inhalte sind Beispieldaten, Links inaktiv.", „So sieht dieser E-Mail-Typ mit dem aktuell gewählten Design aus (Beispieldaten).") — :203, 287 |
| 11. Einstellungen /  #6 | :305-308 |
| 11. Einstellungen /  #7 | :339-342 |
| 11. Einstellungen /  #8 | :176-178 |

### B.7 Lines of „Persistenter Zustand“ with baseline references

- (0. Globale Shell) Cookie `ms_admin_theme` (light|dark; path=/admin; max-age 1 Jahr) — ThemeToggle.tsx:99, theme-config.ts:48-52.
- (0. Globale Shell) Cookie Admin-Session (`ADMIN_COOKIE_NAME`, HTTP-only, aus `@/lib/admin-auth`) — page.tsx:61, login/page.tsx:43.
- (4. Kampagne) localStorage `ms-campaign-first-send` = heutiges Datum (YYYY-MM-DD) → unterdrückt den Bestätigungsdialog für weitere Sendungen am selben Tag (KampagneWorkspace.tsx:173-192).
- (5. KPIs) URL: `?tab=kpi&kpiRange=7d|30d|90d|custom[&kpiFrom=YYYY-MM-DD&kpiTo=YYYY-MM-DD]` (KpiDateRangePicker.tsx:55-61; page.tsx:103-107). Kein localStorage/Cookie.
- (7. Gespräche) URL: `?tab=gespraeche&grange=7d|30d|90d|custom[&gfrom&gto][&gtier=anonymous|email-only|signed-in][&gerr=1][&gcat=<key>][&gqual=<key>][&gq=<text>][&gpage=N]` (GespraecheWorkspace.tsx:173-190; page.tsx:110-120).

## C. Part 2 — HTTP API routes

### C.1 Part 2 intro — legend, rate limits, runtime (2026-09-08, with 2026-10 notes)

#### 2. HTTP API routes

Generated 2026-09-08 from a read-only pass over every `route.ts` under `src/app/api/**` (112 files), `src/proxy.ts`, `src/app/page.tsx`, `src/app/admin/**` pages. All file paths are relative to `/home/user/mo`. Line numbers are `file:line`.

Legend for the **Auth** column (mechanisms as implemented, see "Auth helpers" at the end):

- **guardRequest** = `src/lib/security.ts:82` — Origin header, if present, must be in `ALLOWED_ORIGINS` (default `https://www.motionsports.de`, `https://motionsports.de`) → 403, AND `x-ms-chat-key` must equal `CHAT_SHARED_SECRET` (SHA-256-then-timingSafeEqual) → 401. Missing Origin (curl / server-to-server) is allowed if the secret is right.
- **guardOriginOnly** = `src/lib/security.ts:116` — Origin allowlist only; no secret. A request with NO Origin header passes.
- **requireSignedInCustomer** = `src/lib/account-guard.ts:44` — guardRequest + `chat` rate bucket + `resolveSignedInCustomer(session)` (session from `?session=` or `x-ms-session`) must map to a customer with a `shopify_customer_id` + `getValidAccessToken(customerId)` must yield a live (refreshable) Shopify Customer Account token; else 401. **2026-10-05:** or, for an App Proxy link, a fresh shop proof (`resolveLiveSignedInCustomer`, §9).
- **proxy only** = the route relies solely on `src/proxy.ts` (matcher `/admin/:path*`, `/api/admin/:path*`) verifying the `ms_admin_session` HMAC cookie; there is NO in-handler check.
- **guardAdminPost** = `src/lib/admin-api.ts:27` — in-handler: `Content-Type` must include `application/json` (415) AND `ms_admin_session` cookie must verify (401).
- **guardAdminGet** = `src/lib/admin-api.ts:44` — in-handler cookie re-verification only.
- **requireCronAuth** = `src/lib/cron-auth.ts:41` — `Authorization: Bearer <CRON_SECRET>` (constant-time); fails closed when unset.

Rate-limit buckets (`src/lib/rate-limit.ts:21-62`, Upstash sliding window, key = `sid:<x-ms-session>` else `ip:<x-forwarded-for>`): `chat` 20/60s, `products` 60/60s, `kpi` 120/60s, `tts` 20/300s, `tts-stream` 120/300s, `feedback` 5/300s, `capture-recipient` 3/60m (explicit key = recipient email), `contact-ip` 8/60m (explicit key = client IP). If Upstash env is missing, `getRedis()` throws → 500 from the route (rate limiting never silently disables).

Runtime: no route sets `runtime = "edge"`; all run on Node. Routes that export `runtime = "nodejs"` explicitly are marked; others use the default (also Node). No route exports `dynamic`.

### C.2 §2.1–§2.4 widget, account, auth and attribution routes — the full rows (2026-09-08, with 2026-10 notes)

##### 1. Chat / widget public routes (cross-origin XHR from the Shopify theme widget)

Caller for all of these is the external vanilla-JS Shopify widget (contract: `docs/frontend/API_CONTRACT.md`, handoff: `docs/frontend-handoff/`). The widget source is NOT in this repo.

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/chat` (`src/app/api/chat/route.ts`) | POST, OPTIONS | Streams Mo's answer: `streamText` with `anthropic("claude-sonnet-5-5")` (chat tier, `between_tools` thinking — `lib/ai-models.mjs`), agentic loop ≤6 steps (+1 for the email-offer step), tools from `buildChatTools`, retrieval `retrieveForTurn`, memory `resolveChatMemory`, Q&A `getCachedGeneralQa`, directives `getCachedActiveDirectives`; eager `ensureConversationStarted` before the stream; `persistTurn` + `recordKpiEvent(KPI_EMAIL_CAPTURE_ASK_SHOWN)` + card guard in `onFinish`. Prompt-caching breakpoints via `providerOptions`. | widget | guardRequest | `chat` | `maxDuration = 300` (line 52) | manual: body must be JSON (400), `messages` must be array (400), ≤40 messages (400 `payload_too_large`), `conversationKey` string sliced to 200, `locale` via `resolveLocale`, `context`/`customer` loosely typed and validated downstream against the catalog / capture record | `toUIMessageStreamResponse` SSE with CORS + `Cache-Control: no-cache, no-transform` + `X-Accel-Buffering: no`; errors = `{error:{code,message}}` 400/429/500 | `payload_too_large` returned with HTTP **400** (line 244-251) while `/api/feedback` maps the same code to 413 — inconsistent. Session id only from `x-ms-session` header (line 204), never from body. Persistence and KPI writes are best-effort (errors swallowed via `reportError`). **2026-10 follow-up:** optional `campaignToken` (string, sliced to 128; the `mo_c` value of a campaign link) → `recordCampaignChatStarted` in the turn's `Promise.all`: trimmed, must match `/^[A-Za-z0-9_-]{16,64}$/`, one session-less `kpi_events` row `campaign_chat_started` `{sendId, campaignId}` per `campaign_sends` row (**2026-10-04:** test sends too, with `test:true` — the funnels count real sends only; a unique index, migration 0075, makes "once" hold under concurrency); anything else is ignored, never an error. The returning-customer memory reads owned items from the order ledger (`loadPurchaseHistory`). **2026-10-03 (order status):** new tool `get_order_status` (`{ orderRef? ≤40, topic }`, before `show_contact_form` for the cache marker) built by `buildChatTools(profile, locale, { sessionId, orderStatusEnabled })`; withheld via `activeTools` while `CHAT_ORDER_STATUS_ENABLED` is off (default; **2026-10-04:** `isOrderStatusEnabledFor(sessionId)` also enables it for a session signed in via the Customer Account as one of `CHAT_ORDER_STATUS_TEST_CUSTOMERS`), and `buildSystemPrompt({ orderStatus })` adds its routing/rules only when on — off = tools and prompt exactly as before. Execute → `createOrderStatusLookup(sessionId)` (`lib/order-status.ts`): `customer_account` link of this session (`resolveSignedInLink`) + live token (`getValidAccessToken`, resolved once per request) + maintained ledger (`SHOPIFY_CUSTOMER_SYNC_ENABLED`) → `findCustomerOrders` (`customer-orders-store.ts`; null on a DB error → `unavailable`, never „no orders“; 25 for matching, ≤5 shown) → live Admin read of ≤3 non-cancelled orders (4 s deadline, ownership check) → whitelisted model object (`order-status-core.mjs`, no order numbers/amounts/tracking/ids). KPI `order_status_lookup`. `sanitizeToolParts` replaces a replayed `get_order_status` output with `{ replayed: true }`. Mo's self-snapshot (Verbesserung, `mo-self-snapshot.ts`) renders prompt and tool copy with the same switch (`activeToolCopy`), so its version hash does not change while the switch is off. **2026-10-05 (A3):** `context.source` (`page` \| `cta` \| `nudge`, `page-context.mjs`); a `source:"page"` context (typed turn: product, or exactly one category; trail ignored) is used only with `CHAT_PAGE_CONTEXT_ENABLED` and outside the control group (`CHAT_PAGE_CONTEXT_HOLDOUT_PCT`, product pages only), with the softer `pagePivotNote` / `pageCategoryPivotNote`; resolved in every arm; records `page_context_applied` (at request time, not awaited) and `page_context_answered` (in `onFinish`). Absent / other sources: unchanged path. |
| `POST /api/contact` (`src/app/api/contact/route.ts`) | POST, OPTIONS | Renders the contact form (reason/name/email/org/phone/productIds/message) to text+HTML and emails it to `CONTACT_TO_EMAIL` via the **Resend SDK directly** (not `lib/email`), `replyTo` = submitter; records `KPI_CONTACT_FORM_SUBMITTED`. **2026-10-02:** also stores the request in Mo first (`storeContactRequest`: prospect without consent, received message with provider `kontaktformular`, Eingang item „E-Mail beantworten“; fail-soft, EIG-18). | widget (`show_contact_form` tool) | guardRequest | `chat` + `contact-ip` (8/60m, keyed `ip:<clientIp>`) | `maxDuration = 10` | manual `isValid` (line 25): reason/name/message strings non-empty, email regex; `productIds`, `organization`, `phone`, `sessionId` unchecked | `{ok:true}` 200; 400 `bad_request`; 502 `upstream_unavailable`; 500 | When `RESEND_API_KEY`/`CONTACT_TO_EMAIL`/`CONTACT_FROM_EMAIL` are unset it logs metadata and returns **`{ok:true}` without sending** (line 154-171). Second 502 message (line 206) is hard-coded German while the first (line 193) is localized via `apiMessage` — inconsistent. `productIds` not checked to be an array (line 54, 146: a non-array truthy value would throw → 500). `sessionId` read from the body only (no `x-ms-session` fallback, unlike `/api/feedback`, `/api/capture-email`). **2026-10-04:** the KPI event's session falls back to `x-ms-session`; its `reason` is a known reason or `other`; `productCount` counts an array only. |
| `GET /api/products` (`src/app/api/products/route.ts`) | GET, OPTIONS | Hydrates product cards: `?ids=a,b` / repeated `?id=` (≤10, deduped, order preserved) → `loadProductCatalog()` (`lib/catalog-store`), variant-pinned refs `handle~variantId` via `parseProductRef`/`projectVariant`, public projection `toPublic` (drops `shopifyCartUrl` when sold out), combined `cartUrl` via `buildPrefilledCartUrl(..., {excludeSoldOut:true})`. | widget (card hydration after `show_product` / `compare_products` / `add_to_cart` tool calls) | guardOriginOnly (no secret, by design — public storefront data) | `products` | `maxDuration = 10` | manual `parseIds`; 0 ids → 400; >10 → 400 `payload_too_large` | `{products: (PublicProduct\|null)[], cartUrl: string\|null}` 200, `Cache-Control: public, max-age=60, stale-while-revalidate=300` | Unknown ids → `null` entries (no 404). `payload_too_large` with HTTP 400 again. |
| `POST /api/capture-email` (`src/app/api/capture-email/route.ts`) | POST, OPTIONS | GDPR email capture + double opt-in entry: `validateCaptureRequest` → `upsertEmailCapture` (consent record + `consent_copy_version` via `resolveConsentCopyVersion`) → `linkCustomerOnEmailCapture` → KPI `EMAIL_CAPTURE_SUBMITTED`/`MARKETING_OPTED_IN` → `sendSummaryEmail` (transactional) → if `doiEmailRequired`: DOI mail via `sendEmail` inside `withEmailDesign(getCachedEmailDesignForKind("doi"))`, mirrored with `recordSentMessage`. | widget (capture card) | guardRequest | `chat` + `capture-recipient` (3/60m keyed `email:<lowercased>`) | `maxDuration = 30` | `validateCaptureRequest` (`lib/capture-validation.mjs`) for email + transactional consent; other fields manual (`trigger` sliced to 40) | `{ok:true, transactional:{summarySent}, marketing:{status, doiEmailSent, alreadyConfirmed}}` 200; 400 `bad_request`/`transactional_consent_required`; 503 `upstream_unavailable` (consent not stored); 502 (summary send failed) | The DOI-send block (lines 208-252) is duplicated verbatim in `/api/chat-marketing-opt-in` (188-229) and `/api/account/marketing-opt-in` (162-203). `summarySent` is reported **true when Resend is merely not configured** (`summarySkipped`, line 197/257). DOI send failure only lowers `doiEmailSent` + `reportError`. `sessionId` from body, falls back to `x-ms-session`. **2026-10 (one consent):** `isEmailAlreadySubscribed` (only when the marketing box is ticked) — an address already subscribed (Shopify or an earlier DOI) and not suppressed gets no DOI token/mail and the response says `status:"confirmed"`, `alreadyConfirmed:true` (`subscribedElsewhere`); after the upsert `recordMoOptIn` (`src/lib/consent-flows.ts`) reports the act to `customers.email_consent_*` + `consent_events` — `pending` until the DOI link is clicked, nothing goes to Shopify before that. **2026-10-05 (OI1):** KPI events carry `source: mo_capture_form` and `outcome`; the `trigger` echo is stored only when it is a tool enum value (`storedOfferTrigger`); a suppressed address is answered `status: none`, `alreadyConfirmed: false` (F2). |
| `GET /api/consent-copy` (`src/app/api/consent-copy/route.ts`) | GET, OPTIONS | Serves the legally load-bearing consent strings: `captureConsentCopy(locale)` (default), `signInMarketingConsentCopy` (`?surface=signin`), `chatGateMarketingConsentCopy` (`?surface=chat`). | widget | guardOriginOnly | `products` (shares quota with `/api/products`) | `maxDuration = 10` | `surface` compared to two literals; `locale` via `resolveLocale` | copy JSON 200, `Cache-Control: public, max-age=60, stale-while-revalidate=300` | Read-only; nothing odd. **2026-10:** `?surface=chat` additionally carries `signIn` (`chatGateSignInHint`: sign-in first — „Schon Kunde bei motion sports?“, „Mit Kundenkonto anmelden“, `loginPath` `/api/auth/shopify/login`, `alternativeLabel` for the typed-e-mail path; UI chrome, not part of `consentTextShown`); `?surface=erase` serves `erasurePageCopy(locale, SHOPIFY_ERASURE_SYNC)` (mentions the shop account when on). **2026-10-05 (OI3):** `?surface=signin` adds `benefits` (three served bullets, framing, not in `consentTextShown`) and `variant` (`consent-variants.mjs`; `x-ms-session` for the assignment), `version` `v5`; `Cache-Control: private, no-store` while `CONSENT_SIGNIN_VARIANTS` lists more than one approved variant. |
| `POST /api/tts` (`src/app/api/tts/route.ts`) | POST, OPTIONS | Text-to-speech via OpenAI `audio.speech.create` (`TTS_MODEL` default `gpt-4o-mini-tts`, voice `coral`, instructions/speed env-tunable), `prepareTtsText` strips Markdown and truncates at `MAX_TTS_CHARS`; fire-and-forget `recordAiUsage` (characters as `inputTokens`, `estimated:true`) attributed via `getConversationIdBySession`. | widget voice mode | guardRequest | `tts` (single-shot) or `tts-stream` when `body.stream` is `true`/`"true"`/`1` | `maxDuration = 60` | manual: JSON, `text` must be string, `stream`, `seq` (non-negative int else -1) | `audio/mpeg` stream, `Cache-Control: no-store`, exposed headers `X-MS-TTS-Truncated`, `X-MS-TTS-Chars`, `X-MS-TTS-Seq`; JSON envelope 400/429/502 (`upstream_unavailable` when no `OPENAI_API_KEY` or synthesis fails)/500 | The **bucket is chosen by a client-supplied flag** (line 119/128): any caller can send `stream:true` to get 120/5min instead of 20/5min while still sending full `MAX_TTS_CHARS` texts — the "chunks stay small" claim in the comment is not enforced server-side. Rate limit is checked only after JSON parsing (invalid JSON bypasses the limiter). |
| `POST /api/kpi` (`src/app/api/kpi/route.ts`) | POST, OPTIONS | Telemetry ingest: `INSERT INTO kpi_events (session_id, event, data)` via raw `getSql()` in the route. | widget `track()` | guardOriginOnly (no secret) | `kpi` | `maxDuration = 10` | manual: `event` non-empty string ≤120; `sessionId` ≤128; `data` must be a plain object (else `{}`); `timestamp` copied to `data.clientTimestamp` | **202** `{ok:true}` even when the DB is missing or the insert fails (swallowed, `reportError`) | Raw SQL in the route while `lib/kpi-events.ts:recordKpiEvent` exists for the same table (duplication). Event name not validated against any vocabulary; `data` size unbounded beyond body size. By design fail-silent. **2026-10-04:** a server-only name (`SERVER_ONLY_EVENTS`, `kpi-widget-events.mjs`: sign-in link/refusal/success, erasure, export, campaign chat start, contact form, order status, e-mail capture server stages, mail clicks) is acknowledged 202 but never stored. **2026-10-05:** `page_context_applied` / `page_context_answered` added to `SERVER_ONLY_EVENTS`. |
| `POST /api/feedback` (`src/app/api/feedback/route.ts`) | POST, OPTIONS | Stores a free-text comment via `insertFeedback` (table `feedback`, shown read-only in the admin Feedback tab). | widget feedback form | guardRequest | `feedback` | `maxDuration = 10` | `validateFeedbackRequest` (`lib/feedback-validation.mjs`); `sessionId` falls back to `x-ms-session` | `{ok:true}` 200; 400 / **413** (`payload_too_large`); 503 `upstream_unavailable` | Only route mapping `payload_too_large` to 413 (chat/products use 400). |
| `POST /api/chat-marketing-opt-in` (`src/app/api/chat-marketing-opt-in/route.ts`) | POST, OPTIONS | Marketing-only DOI signup from the in-chat consent gate: `isValidEmail` → requires `marketingConsent === true` → `upsertEmailCapture(transactional:false, marketing:true)` → `linkCustomerOnEmailCapture` → KPI ×2 → DOI email (same block as capture-email). | widget (chat consent gate, copy from `/api/consent-copy?surface=chat`) | guardRequest | `chat` + `capture-recipient` | `maxDuration = 30` | manual + `isValidEmail`; `marketingConsent` must be `true` | `{ok:true, marketing:{status, doiEmailSent, alreadyConfirmed}}`; 400 `invalid_email` / `marketing_consent_required`; 503 | Near-verbatim clone of `/api/capture-email` minus the summary. **2026-10 (one consent):** `isEmailAlreadySubscribed` first — an address already subscribed (Shopify or an earlier DOI) and not suppressed gets no DOI token/mail and the response says `status:"confirmed"`, `alreadyConfirmed:true` (`subscribedElsewhere`); after the upsert `recordMoOptIn` (`src/lib/consent-flows.ts`) reports the act to `customers.email_consent_*` + `consent_events` — `pending` until the DOI link is clicked, nothing goes to Shopify before that. **2026-10-05 (OI1):** KPI events carry `source: mo_chat_gate` and `outcome`; suppressed → `status: none`, `alreadyConfirmed: false` (F2). |
| `GET /api/confirm-marketing` (`src/app/api/confirm-marketing/route.ts`) | GET | DOI confirmation link: `confirmMarketingByToken(token)` flips `marketing_doi_status` to `confirmed`, `syncCustomerConsent(email)` (**2026-10:** → `recordDoiConfirmed` — the one consent becomes `subscribed`/`confirmed_opt_in`; via the outbox a `consent_update`, or a `customer_create` for a Mo-only subscriber), KPI `MARKETING_CONFIRMED` (once), renders an HTML result page (`renderResultPage`). | email link click (top-level navigation from the DOI mail sent by capture-email / chat-marketing-opt-in / account/marketing-opt-in) | opaque DOI token in `?token=` (see "Token-based links") | none | `maxDuration = 30` | token non-empty | HTML page: 200 confirmed, 400 invalid, 410 expired, 500 | No CORS (intended). No rate limit on token probing — relies on token entropy. **2026-10-05 (OI1):** `email_capture_marketing_confirmed` carries `{source}` — the session's latest DOI opt-in (`latestDoiOptInSource`), else the pending consent row's surface (`recordDoiConfirmed` now returns it), else `mo` (`confirmationSource`, `capture-funnel.mjs`). |
| `GET /api/newsletter-rating` (`src/app/api/newsletter-rating/route.ts`) | GET | Anonymous 1–5 smiley rating row in image-first emails: `parseEmailRating(r)`, `parseEmailThemeKind(k)` → `insertFeedback({page:"email:<kind>", rating, emailKind})`; HTML thank-you page. | email link click | none (anonymous by design — no recipient identity in the link) | `feedback` (keyed by IP; no session header on a nav) | `maxDuration = 10` | `r` ∈ 1..5, `k` parsed with fallback `"email"` | HTML 200 / 400 / 429 | Fail-soft: a DB error still renders 200 "Danke". GET with a side effect — mail-client link prefetchers / SafeLinks scanners can create phantom ratings; the only abuse cap is 5/5min per IP. Referenced only from `src/lib/email-theme.mjs` (link builder). |

##### 2. Customer account routes (`/api/account/*`, tier-3 signed-in customers)

All use `requireSignedInCustomer` (`src/lib/account-guard.ts`) which itself performs guardRequest + `chat` rate limit + signed-in resolution + live-token check (2026-10-05: or the fresh shop proof, D-AP1). Session id from `?session=` or `x-ms-session` (`readSession`). Caller: external widget (signed-in history panel; documented in `docs/CUSTOMER_ACCOUNT.md`, `docs/frontend/ACCOUNT_CONTRACT.md`).

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET /api/account/conversations` (`src/app/api/account/conversations/route.ts`) | GET, OPTIONS | `listCustomerConversations(customerId)` — titles, timestamps, counts across devices. | widget | requireSignedInCustomer | `chat` (inside guard) | `runtime="nodejs"`, `maxDuration = 15` | none needed | `{conversations:[...]}` 200 `no-store`; 401; 500 | — |
| `GET/PATCH/DELETE /api/account/conversations/[id]` (`src/app/api/account/conversations/[id]/route.ts`) | GET, PATCH, DELETE, OPTIONS | GET `getCustomerConversationTranscript`; PATCH rename via `sanitizeTitleInput` + `renameCustomerConversation`; DELETE hard-deletes via `deleteCustomerConversation`. All scoped to `customerId` (foreign id ≡ missing). | widget | requireSignedInCustomer (per method) | `chat` | `runtime="nodejs"`, `maxDuration = 15` | `parseId` (positive safe int, else 400); PATCH body JSON + `sanitizeTitleInput` | GET `{conversation}`; PATCH `{ok, conversationId, title}`; DELETE `{ok, conversationId, deleted:true}`; 404s | 404 responses use error code **`bad_request`** (lines 67, 105, 126) although `not_found` exists in `ErrorCode` — envelope inconsistency. |
| `POST /api/account/erase` (`src/app/api/account/erase/route.ts`) | POST, OPTIONS | Full GDPR erasure `eraseSignedInCustomer(customerId)` → `erasePerson` (the one complete erasure path: conversations, profile, Kampagne contact + sends, correspondence, letters, tokens, suppression), KPI `ACCOUNT_ERASED` (no session key). | widget | requireSignedInCustomer | `chat` | `runtime="nodejs"`, `maxDuration = 20` | no body read at all | `{ok:true, erased:true, deletedConversations}` 200; 503 `upstream_unavailable`; 500 | Destructive POST with no confirmation token/body; acceptable because the custom `x-ms-chat-key` header forces a CORS preflight (no cross-site form risk). **2026-10:** `erasePerson` also writes an `erasure_tombstones` row for the Shopify id and enqueues the Shopify side in `shopify_outbox`: a `consent_update` to unsubscribed (sent while `SHOPIFY_CONSENT_WRITEBACK` is on) and a `data_erasure` (`customerRequestDataErasure`, `SHOPIFY_ERASURE_SYNC`); mirrored orders, facts, consent history and Eingang items go with the customer row. |
| `GET /api/account/export` (`src/app/api/account/export/route.ts`) | GET, OPTIONS | `buildCustomerDataExport(customerId)` → pretty JSON attachment (`motionsports-meine-daten.json` / `-my-data.json`); KPI `ACCOUNT_EXPORT_REQUESTED`. | widget | requireSignedInCustomer | `chat` | `runtime="nodejs"`, `maxDuration = 30` | none | `application/json; charset=utf-8` attachment 200; 503; 500 | **2026-10:** the export also contains the consent history (`consent_events`), the order copy (`customer_orders`), the computed figures (`customer_facts`) and campaign participation per campaign (test rows excluded). **2026-10-03:** plus the campaign letters (`campaign.letters`, migration 0074 — also unsent drafts: campaign, status, subject, text, dates). |
| `POST /api/account/marketing-opt-in` (`src/app/api/account/marketing-opt-in/route.ts`) | POST, OPTIONS | At-sign-in marketing DOI: `getCustomerById` → verified email (refuses synthetic `shopify:` placeholder) → `upsertEmailCapture(transactional:false, marketing:true)` → `linkCustomerOnEmailCapture` → KPI ×2 → DOI email (duplicated block). | widget (sign-in opt-in card, copy from `/api/consent-copy?surface=signin`) | requireSignedInCustomer | `chat` | `maxDuration = 30` (no `runtime` export — the only `/api/account` route without it) | JSON body; `marketingConsent === true` required | `{ok, marketing:{status, doiEmailSent, alreadyConfirmed}}`; 400 `marketing_consent_required`; 404 `not_found`; 422 `no_verified_email`; 503 | Third copy of the DOI send block. Unlike the other two opt-in routes it does NOT apply the `capture-recipient` per-email cap (the signed-in guard makes that acceptable, but note the asymmetry). **2026-10 (one consent):** `isEmailAlreadySubscribed` first — an address already subscribed (Shopify or an earlier DOI) and not suppressed gets no DOI token/mail and the response says `status:"confirmed"`, `alreadyConfirmed:true` (`subscribedElsewhere`); after the upsert `recordMoOptIn` (`src/lib/consent-flows.ts`) reports the act to `customers.email_consent_*` + `consent_events` — `pending` until the DOI link is clicked, nothing goes to Shopify before that. **2026-10-05:** also on the shop proof (D-AP1); the `consent_events` row's `note` records the sign-in proof — „Anmeldenachweis: Kundenkonto-Anmeldung im Chat“ / „Anmeldenachweis: Shop-Login (App Proxy)“ (`signInProofNote`, `signed-in-proof.mjs`). **2026-10-05 (OI1 + OI3):** body takes optional `placement` / `variant` (validated, telemetry only, never a 400); both KPI events carry `source: mo_signin`, `outcome`, `alreadyConfirmed`, `doiRequired`, `placement?`, `variant?`, `variantMismatch?` (only while > 1 variant is active); suppressed → `status: none`, `alreadyConfirmed: false` (F2). |
| `GET /api/account/summary?conversationKey=` (`src/app/api/account/summary/route.ts`) | GET, OPTIONS | `loadCustomerConversationForSummary(customerId, key)` → `buildSummaryDocument` (may call the model; usage recorded as `summary_download`) → `buildSummaryPdf` → PDF attachment. | widget ("Zusammenfassung herunterladen") | requireSignedInCustomer | `chat` | `runtime="nodejs"`, `maxDuration = 30` | `conversationKey` non-empty | `application/pdf` attachment 200; 400; 404 (code `bad_request`); 500 | 404 again uses `bad_request` code. |

##### 3. Auth / Shopify Customer Account routes

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET /api/auth/me` (`src/app/api/auth/me/route.ts`) | GET, OPTIONS | Widget identity re-hydration: `resolveSignedInCustomer(session)` → `getValidAccessToken` → `fetchCustomerIdentity` (revoked token → `deleteCustomerTokens` + signed-out) → fallback name via `fetchAdminCustomerById` → `resolveMarketingOptInState`. **2026-10-05:** resolves through `resolveLiveSignedInCustomer` (`src/lib/signed-in-session.ts`): a chat token, or for an `app_proxy` link the fresh shop proof (`APP_PROXY_SIGNIN_MAX_AGE_HOURS`) — then the name comes from the cached account summary, else the Admin API; `optInActionable` includes the per-customer anti-nag. | widget (on load / after `?ms_auth=` redirect) | guardRequest | `chat` | `runtime="nodejs"`, `maxDuration = 15` | `?session=` or `x-ms-session` | always **200**: `{signedIn:false}` or `{signedIn:true, identity:{name,tier}, marketing}`, `Cache-Control: no-store` | Internal errors are converted to `{signedIn:false}` 200 (line 105-108) — never a 5xx; fail-closed by design but hides outages from the widget. |
| `POST /api/auth/link` (`src/app/api/auth/link/route.ts`) | POST, OPTIONS | Completes a sign-in (0073): `redeemSessionLinkGrant({ code, session })` — consumes the one-time code, links the session (+ attaches its chats) only when it is the session the code was minted for. | widget (after `?ms_auth=ok&ms_code=` or a whoami `linkCode`) | guardRequest | `chat` | `runtime="nodejs"`, `maxDuration = 15` | `code` 43 chars base64url; session from `x-ms-session` / `?session=` | 200 `{ok:true, signedIn:true}`; 400 `bad_request` (unknown / expired / used / other session); 503 `upstream_unavailable` (DB). **2026-10-03:** writes the KPI events `account_signin_linked {kind}` / `account_signin_link_refused {reason}` (session-keyed; KPI-47, KPI-75). **2026-10-05:** `{kind, renewed}` / `{reason, kind?}`; the chat stamp only takes conversations with no customer or the same one; a dead Customer Account link re-proven by the shop (grant `app_proxy`, renewed, no valid token, max age > 0) is downgraded to `app_proxy` | The code is burned on the first attempt, whatever the outcome. |
| `GET /api/auth/shopify/login` (`src/app/api/auth/shopify/login/route.ts`) | GET | Step 1 of PKCE Customer Account OAuth: `safeReturnUrl` (allowlist), `generateCodeVerifier`, `randomToken` nonce/state, `signState(state, authStateSecret())`, `createPendingAuth` (DB, TTL `pendingAuthTtlMinutes()`), `buildAuthorizationUrl` → 302 to Shopify; `prompt=none` for silent detection. | widget (top-level navigation) | none (open-redirect guard on `return_url` + HMAC-signed `state`) | **none** | `runtime="nodejs"`, `maxDuration = 15` | `session` non-empty (400 text), `return_url` allowlisted | 302; 503/400 **text/plain** bodies (not the JSON envelope); catch → 302 to `returnUrl` | No rate limit: each hit inserts a pending-auth row (DB-fill vector). Error bodies are plain text, unlike every other route. |
| `GET /api/auth/shopify/callback` (`src/app/api/auth/shopify/callback/route.ts`) | GET | Step 2: `verifyState` → `consumePendingAuth` (single-use) → `exchangeAuthorizationCode` (PKCE) → `verifyIdToken` (JWKS, iss/aud/nonce/exp) → `fetchCustomerIdentity` → `bindShopifyIdentity` → `saveCustomerTokens` (AES-256-GCM at rest, `lib/token-crypto.ts`) → `mintSessionLinkGrant` (one-time code for the login's session, 0073 — **no session link here**) → KPI `ACCOUNT_SIGNIN_SUCCEEDED` → `refreshSignedInCustomerCache` → 302 `?ms_auth=ok&ms_code=…`. | Shopify redirect (top-level) | signed `state` + pending record | none | `runtime="nodejs"`, `maxDuration = 30` | `state` HMAC, `code` presence, `error` passthrough (`login_required`) | 302 to storefront with `?ms_auth=ok\|error\|login_required` | `refreshSignedInCustomerCache` (line 139) is awaited inside the same try — a throw there redirects with `ms_auth=error` even though tokens were already saved, contradicting the "never block the redirect" comment (unless the lib swallows internally). Tokens never reach the browser. |
| `GET /api/auth/shopify/logout` (`src/app/api/auth/shopify/logout/route.ts`) | GET | `buildEndSessionUrl({post_logout_redirect_uri: /api/auth/shopify/logout/return?session&return_url})` → 302 to Shopify `end_session_endpoint`, or straight to the return route when not advertised. | widget (top-level navigation) | none (return_url allowlist) | none | `runtime="nodejs"`, `maxDuration = 15` | `return_url` allowlisted | 302 | — |
| `GET /api/auth/shopify/logout/return` (`src/app/api/auth/shopify/logout/return/route.ts`) | GET | Registered Logout URI: `resolveSignedInCustomer(session)` → `deleteCustomerTokens(customerId)` + `signOutSessionLinks` (every `customer_account` link of the customer and the session's link, 0073; **2026-10-05:** also every `app_proxy` link of the customer); 302 `?ms_auth=logged_out`. | Shopify redirect (or direct from logout route) | none | none | `runtime="nodejs"`, `maxDuration = 15` | `return_url` allowlisted | 302 | Anyone who knows an opaque widget session id can revoke that session's tokens (low impact: forces re-login). |
| `GET /api/auth/storefront` (`src/app/api/auth/storefront/route.ts`) | GET | Shop-native signed-in detection via Shopify **App Proxy**: `evaluateAppProxyAuth(searchParams, SHOPIFY_APP_PROXY_SECRET ?? SHOPIFY_CLIENT_SECRET)` (HMAC over query params; trusts `logged_in_customer_id`) → `fetchAdminCustomerById` → `bindShopifyIdentity` (customer row only) → `mintSessionLinkGrant` (`linkCode` in the response, 0073 — the session is linked only on redeem) → `resolveMarketingOptInState`; a signed logged-out request ends the session's `app_proxy` link. **2026-10-05 (P0.3):** the signature must be fresh (`appProxyFailureKind`: Shopify `timestamp` within ±300 s; `no_secret` / `mismatch` / `stale` reported, throttled 10 min per kind, never the URL; `unsigned` silent; any failure → `{signedIn:false}`, never ends or creates a link); then `decideShopRecognition` (`signed-in-proof.mjs`, tested): **handover** (session signed in as another shop customer → that session's signed-in link ends, no code), `APP_PROXY_SIGNIN_ENABLED` off → no code, no proof (no live chat token and `APP_PROXY_SIGNIN_MAX_AGE_HOURS` 0) → no code, mint failure → `{signedIn:false}`; `signedIn:true` always carries a `linkCode`. Every recognised request records `account_shop_recognised {proof, hasToken, alreadySignedIn, codeIssued, noCode?}` (server-only). | Shopify App Proxy (server-to-server; theme calls `/apps/chat/whoami?session=`) | Shopify App Proxy HMAC `signature` (see "Webhook verification" — app-proxy note) | `chat` keyed on a synthetic `x-ms-session` = widget session or `cid:<shopifyCustomerId>` | `runtime="nodejs"`, `maxDuration = 15` | signature + `logged_in_customer_id` | always 200: `{signedIn:false}` or `{signedIn:true, name, tier:3, shopify_customer_id, identity:{name,tier:3}, marketing, linkCode}` | No CORS headers (same-origin through the proxy). Depends on store-side App Proxy configuration per header comment ("REQUIRES A STORE / THEME ACTION") — may be dormant in production. |

##### 4. Attribution

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/attribution/token` (`src/app/api/attribution/token/route.ts`) | POST, OPTIONS | Mints or reuses the session's cart-stamp attribution token: `mintAttributionToken(sessionId, "widget")` (`lib/mo-orders-store`), returns the Shopify cart attribute to POST to `/cart/update.js`. | widget (once per session, after analytics consent — consent gate lives in the widget) | guardRequest | `kpi` | `maxDuration = 10` | `x-ms-session` header required (400), sliced to 128; `isDbConfigured()` else 503 | `{ok:true, token, cartAttributes:{[MO_CART_ATTRIBUTE]: token}}` 200 `no-store`; 400; 503; 500 | No body is read. Token format/verification in "Token-based links". |

### C.3 §2.5 cron routes — the full rows (2026-09-08, with 2026-10 notes)

##### 5. Cron routes (`/api/cron/*`, scheduled in `vercel.json`)

All six accept **GET and POST** (same `handle()`), all call `requireCronAuth(req)` first (`Authorization: Bearer <CRON_SECRET>`, constant-time, fails closed when `CRON_SECRET` unset), none rate-limit, none read a body, all use `NextResponse.json` with an ad-hoc `{ok, ...}` envelope (NOT the `{error:{code,message}}` envelope used elsewhere; the 401 is `{error:"Unauthorized"}`). Schedules (UTC): refresh-customers 02:00, sync-campaign-audience 02:30, sync-catalog 03:00, retention 03:30, expire-bundles 03:45.

**Since 2026-10-01: nine crons** (`vercel.json`, same conventions; the four new ones check `isDbConfigured()` first and answer 503 without a DB). Schedules (UTC): shopify-reconcile 01:45 · refresh-customers 02:00 · campaign-audiences 02:30 · sync-catalog 03:00 · retention 03:30 · expire-bundles every 15 min · prepare-campaign-drafts 04:15 · shopify-sync every 5 min · inbox hourly at :20. `sync-campaign-audience` is retired (replaced by shopify-reconcile + campaign-audiences).

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET/POST /api/cron/expire-bundles` (`src/app/api/cron/expire-bundles/route.ts`) | GET, POST | `expireBundleOffers()` (`lib/bundle-offers`): deletes Shopify bundle products past `expires_at`, flips rows to `expired`, then deletes products ended offers still have. | Vercel Cron (every 15 min); manual curl | requireCronAuth | none | `maxDuration = 60` | none | `{ok:true, ...result}` 200; `{ok:false,error}` 503 (no DB or thrown) | Returns 503 on thrown errors (other routes use 500) — cron routes uniformly use 503 for "visibly skipped". |
| `GET/POST /api/cron/prepare-campaign-drafts` (`src/app/api/cron/prepare-campaign-drafts/route.ts`) | GET, POST | Nightly „Vorbereiten“: `prepareNextDrafts(5, discount, textMode)` in chunks until `CAMPAIGN_AUTO_PREPARE_COUNT` drafts exist or the pending contacts run out (240 s budget); never sends | Vercel Cron 04:15 UTC (`vercel.json`) | `requireCronAuth` | none | `maxDuration = 300`; `CAMPAIGN_AUTO_PREPARE_COUNT` (0 = skipped, default), `_DISCOUNT`, `_TEXT_MODE` (`campaignAutoPrepareConfig`) | env only | `{ ok, requested, prepared, failed, suppressed, exhausted, textMode, discountPercent }` / `{ ok:true, skipped:"disabled" }`; **2026-10:** `{ ok, budget, legacy, perCampaign[] }` | Off by default — generation costs API money (docs/CAMPAIGNS.md §5). **2026-10:** the count is a nightly budget across live campaigns, each taking its `auto_prepare_per_day` by priority (`planAutoPrepare`); with no per-campaign figure the whole budget goes to the `lebenszyklus` campaign with the `_DISCOUNT`/`_TEXT_MODE` settings (legacy mode) |
| `GET/POST /api/cron/refresh-customers` (`src/app/api/cron/refresh-customers/route.ts`) | GET, POST | `listCustomersForDataRefresh(batch, staleBefore)` → sequential `refreshCustomerData(c)` (Shopify orders + address cache), then `runProfileUpkeep` (regenerates profiles of customers with new activity, 200-s budget, concurrency 3). Env `CUSTOMER_REFRESH_BATCH` (25), `CUSTOMER_REFRESH_STALE_HOURS` (24), `CUSTOMER_PROFILE_BATCH` (30, 0 = off). `?only=profiles` skips the data refresh, `?batch=N` overrides the profile batch (used by `npm run profiles:backfill`). | Vercel Cron (02:00 UTC) | requireCronAuth | none | `maxDuration = 300` | env ints via `intEnv` | `{ok:true, considered, refreshed, failed, batch, staleHours}`; 503 on throw | No `isDbConfigured` pre-check unlike expire-bundles. **2026-10:** first `expirePendingConsents` — a pending double opt-in older than `MARKETING_DOI_EXPIRY_DAYS` + 1 day falls back to `not_subscribed` with a history entry (`pendingExpired`, local only, nothing pushed to Shopify); then a second upkeep for **Kaufprofile** (purchase-only Shopify customers, writer tier, `CUSTOMER_PROFILE_LIGHT_BATCH`, default 0) → `lightProfiles` in the response; both respect `CUSTOMER_AI_PROFILE_SCOPE` and Art. 21 objections. Customer facts are NOT computed here (see shopify-reconcile). |
| `GET/POST /api/cron/retention` (`src/app/api/cron/retention/route.ts`) | GET, POST | `runRetention(retentionOptionsFromEnv())` (abandon stale conversations, delete expired conversations/messages/kpi_events, purge opted-out capture PII) then `runConversionSweep()` (marks redeemed MS5- codes / converted conversations). | Vercel Cron (03:30 UTC) | requireCronAuth | none | `maxDuration = 60` | env via `retentionOptionsFromEnv` | `{ok:true, options, ...result, conversionSweep}`; 503 on throw | Two unrelated jobs piggybacked on one cron (documented). |
| `GET/POST /api/cron/sync-campaign-audience` (`src/app/api/cron/sync-campaign-audience/route.ts`) — **❌ retired 2026-10** (route, `src/lib/campaign-sync.ts`, `campaign-sync-core.mjs` + test and the subscriber query `src/lib/shopify-customers.ts` removed) → `/api/cron/shopify-reconcile` (mirror) + `/api/cron/campaign-audiences` (recipients) | GET, POST | `syncCampaignAudience()` (`lib/campaign-sync`) — re-pulls the Shopify marketing audience, marks Shopify-side unsubscribes `suppressed`. | Vercel Cron (02:30 UTC) | requireCronAuth | none | `maxDuration = 300` | none | `result` JSON 200; `{ok:false,error}` 503 when not configured or thrown | Same lib is used by admin `POST /api/admin/campaign/sync` (see §7.3) — intended duplication (manual vs scheduled). |
| `GET/POST /api/cron/sync-catalog` (`src/app/api/cron/sync-catalog/route.ts`) | GET, POST | Full catalog refresh: `fetchAllProducts()` (Shopify Admin) → `mapShopifyProducts` (fallback to bundled `@/data/product-catalog.json` on Shopify failure) → `embedDocsResilient` with OpenAI `text-embedding-3-small` (carry-forward of previous vectors) → atomic `writeCatalogPair` to Vercel Blob. | Vercel Cron (03:00 UTC); README manual curl | requireCronAuth | none | `maxDuration = 300` | none | rich summary `{ok:true, partial, mode, productCount, embeddingsCount, synced, carriedForward, skipped, ...}` 200; 503 on total embedding failure (quota) or Blob write failure | Silent degradation: a Shopify failure returns **200** with `mode:"fallback-bundle"` (line 191-196) — the stale committed JSON overwrites the live catalog blob. OpenAI key missing → 200 with catalog-only write. |
| `GET/POST /api/cron/shopify-reconcile` (`src/app/api/cron/shopify-reconcile/route.ts`, new 2026-10) | GET, POST | `reconcileShopifyCustomers` (every Shopify customer + order changed since the last complete run → mirror + ledger; gated by `SHOPIFY_CUSTOMER_SYNC_ENABLED`, 170-s budget) then `recomputeCustomerFacts` (dirty customers first, then everyone older than 20 h; always, also chat-only people; until 270 s) | Vercel Cron 01:45 UTC | requireCronAuth | none | `maxDuration = 300` | none | `{ok, reconcile, facts}`; 503 without DB / on throw | Replaces the subscriber-only audience sync. |
| `GET/POST /api/cron/campaign-audiences` (`src/app/api/cron/campaign-audiences/route.ts`, new 2026-10) | GET, POST | `refreshLiveAudiences` — ends campaigns whose end date passed, then refreshes every active campaign from its audience: dynamic (`dynamisch`) ones admit new matches and mark open recipients who no longer match `excluded`, fixed (`fest`) ones materialise once; lost consent / blocked → `suppressed`; in a `laufend` campaign a sent recipient re-enters after `reentry_days` (new cycle). Nothing is drafted or sent. **2026-10-03 (0074):** campaigns with a letter mode also refresh their letter recipients; then `nightlyLetterAddresses` fetches up to `CAMPAIGN_LETTER_ADDRESS_NIGHTLY` purchase addresses for open letters (nothing while `PHYSICAL_MAIL_SENDS_APPROVED` is off) | Vercel Cron 02:30 UTC | requireCronAuth | none | `maxDuration = 300` (260-s budget; the refresh stops 60 s earlier) | none | `{ok, ...result, letterAddresses}`; 503 | Same function as „Zielgruppe aktualisieren“ (`POST /api/admin/campaigns/refresh`) per campaign. |
| `GET/POST /api/cron/shopify-sync` (`src/app/api/cron/shopify-sync/route.ts`, new 2026-10) | GET, POST | `processShopifyOutbox` (≤ 100 rows, 40 s: consent writes, `customer_create`, `data_erasure`; backoff, dead after `OUTBOX_MAX_ATTEMPTS` = 8) then, while an import runs, further `runCustomerImportStep`s within the budget | Vercel Cron every 5 min | requireCronAuth | none | `maxDuration = 120` (100-s budget) | none | `{ok, outbox, import}`; 503 | Each part gated by its flag (`SHOPIFY_CONSENT_WRITEBACK`, `SHOPIFY_ERASURE_SYNC`, `SHOPIFY_CUSTOMER_SYNC_ENABLED`); all off = no-op. |
| `GET/POST /api/cron/inbox` (`src/app/api/cron/inbox/route.ts`, new 2026-10) | GET, POST | `runInboxSignals` — rules over the facts and recent events → `inbox_items` (upsert by dedupe key, capped per kind), close items whose rule stopped firing, expire, fill the 14-day outcomes, then AI suggestions up to `INBOX_AI_DAILY_LIMIT` per (Berlin) day | Vercel Cron hourly at :20 | requireCronAuth | none | `maxDuration = 300` (240-s budget) | none | `{ok, candidates, created, closed, expired, outcomes, suggested}`; 503 | Never sends. Manual twin without AI: `POST /api/admin/inbox/run`. |

### C.4 §2.8 admin routes — the per-route audit table (2026-09-08, with notes up to 2026-10-03)

##### 8. Admin routes (`/api/admin/*`, German back-office dashboard)

Common facts for all 76 admin routes (verified by grep over every `src/app/api/admin/**/route.ts`):

> **2026-10-01:** 94 admin route files (+19 customer platform incl. `customers/ask`, +1 Erstabgleich `shopify/align`, −1 `campaign/sync`; 75 before); every one still calls `guardAdminGet()` (15 files) or `guardAdminPost(req)` (81 files; two files export both). New sections 8.3a campaigns, 8.16 inbox, 8.17 shopify; additions in 8.7. None of the new routes calls `recordAdminAccess` (27 files still do).
>
> **2026-10 follow-up (`6327b0f`):** 96 admin route files (+`campaigns/add-recipients`, +`customers/similar`); `guardAdminGet()` in 16 files, `guardAdminPost(req)` in 82 (two export both). `recordAdminAccess` now in **33** files — added to `campaigns/add-recipient`, `campaigns/add-recipients`, `customers/ask`, `customers/objection`, `inbox/accept`, `inbox/suggest`.
>
> **2026-10-03 (letters as a campaign channel, migration 0074):** **103** admin route files (100 before; +`campaigns/letters`, +`campaigns/letters/preview`, +`customers/letter-address`, all `guardAdminPost`); `recordAdminAccess` in **39** files (+`campaigns/letters`, +`customers/letter-address`). Rows in 8.3a and 8.7; 8.14 `physical/send` refuses a non-purchase or undeliverable address.

- **Every** admin route calls an in-handler guard in addition to the proxy: 8 GET routes use `guardAdminGet()`, the other 68 (all POST) use `guardAdminPost(req)` (415 unless `Content-Type: application/json`; 401 on a bad/missing `ms_admin_session` cookie). No admin route relies on the proxy alone.
- No rate limiting anywhere under `/api/admin` (single-operator back office, cookie-gated).
- Envelope: `adminJson(data)` / `adminJsonError(code, message, status)` → `{error:{code,message}}` (`src/lib/admin-api.ts`). Domain refusal codes are passed through verbatim (e.g. `not_eligible`, `too_soon`), so the admin code vocabulary is open-ended and mostly in German.
- Caller is always the admin UI (client components under `src/app/admin/`), listed per row with `file:line` of the `fetch`. Reads that need a body are POSTs "to ride the JSON/CSRF guard" (comment in `conversations/detail`).
- Input validation is manual everywhere (`Number()` + `Number.isInteger` + `typeof` checks). **No zod anywhere in the API layer.**
- Audit logging: 27 routes call `recordAdminAccess` (`src/lib/admin-access-log.ts`); noted per row where an AI/PII-reading route does NOT.
- Two routes have **no `maxDuration`** export: `conversations/detail`, `correspondence/assign`. One exports `runtime="nodejs"`: `analytics/[id]/pdf`.
- **No try/catch at all** (a thrown DB error surfaces as a framework 500, not the JSON envelope): `email-designs/route.ts` (GET), `email-hero/route.ts` (GET), `analytics/estimate`, and every `qa/*` route except `qa/scan` (which only guards its inner loop).

###### 8.1 analytics ("Komplettanalyse" reports)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET /api/admin/analytics` | GET | `listAnalyticsReports()` (no `sections` payload). | `analytics/AnalyseWorkspace.tsx:59` | proxy + guardAdminGet | none | `maxDuration = 15` | — | `{reports}`; `{reports:[]}` when no DB | — |
| `POST /api/admin/analytics/create` | POST | `resolveKpiRange` + `normalizeOptions` → `createAnalyticsReport` (row in `running` state; client drives via `/step`); `countUnanalyzedInRange` seeds progress. | `analytics/GenerateReportPanel.tsx:101` | proxy + guardAdminPost | none | `maxDuration = 30` | manual (`range`/`from`/`to` strings, booleans) | `{id, title, from, to}`; 400; 503 `unavailable`; 500 | `recordAdminAccess("analytics.report.create")`. |
| `POST /api/admin/analytics/delete` | POST | `deleteAnalyticsReport(id)`. | `analytics/ReportActions.tsx:37` | proxy + guardAdminPost | none | `maxDuration = 30` | `id` positive int | `{deleted:true}`; 404 `not_found`; 503 | audit-logged. |
| `POST /api/admin/analytics/estimate` | POST | Zero-token cost preview: `countConversationsInRange`, `countUnanalyzedInRange`, `getPersonaLabelsInRange`, `getActiveCustomerIdsInRange` → `estimateReportCostUsd` → EUR. | `analytics/GenerateReportPanel.tsx:78` | proxy + guardAdminPost | none | `maxDuration = 30` | manual | `{range:{from,to,label,preset}, conversations, unanalyzed, personaCount, customerCount, estimateEur}` | **No try/catch** around the DB work (lines 53-79) — a DB error yields a framework 500 instead of the envelope. |
| `POST /api/admin/analytics/step` | POST | `stepReport(id)` — one bounded chunk of the generation state machine (model calls). | `analytics/ReportProgressDriver.tsx:78` | proxy + guardAdminPost | none | `maxDuration = 60` | `id` | `{status, phase, progress, costEur, done, error}`; 404 | Not audit-logged (create is). |
| `GET /api/admin/analytics/[id]` | GET | `getAnalyticsReport(id)` full detail incl. `sections`. | `analytics/AnalyseWorkspace.tsx:71` | proxy + guardAdminGet | none | `maxDuration = 15` | path id positive int | `{report}`; 400; 404; 503 | — |
| `GET /api/admin/analytics/[id]/pdf` | GET | `buildAnalyticsReportPdf` (dependency-free `lib/pdf-core`) → PDF attachment; only `status === "complete"`. | `analytics/ReportActions.tsx:65` (plain `<a href>` download) | proxy + guardAdminGet | none | `runtime="nodejs"`, `maxDuration = 30` | path id | `application/pdf` attachment; 409 `not_ready`; 404; 503 | — |

###### 8.2 bundles (personalised bundle offers, Shopify product bundles)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/admin/bundles/archive` | POST | `archiveBundleOffer(id)` — deletes the Shopify product, row → `expired`. | `CustomerProfileCard.tsx:1273`, `KampagneWorkspace.tsx:714` | proxy + guardAdminPost | none | `maxDuration = 30` | `id` | `{ok, offer}`; `not_found` 404 / `not_active` 409 / `archive_failed` 502 | Not audit-logged. |
| `POST /api/admin/bundles/create` | POST | `createBundleOffer(customerId\|null, components[{productId, variantId?, quantity?}], {bundlePriceOverride, title, expiryDays, marketingSendId, campaignContactId})` — Shopify bundle creation + row + redirect token. | `CustomerProfileCard.tsx:1197`, `KampagneWorkspace.tsx:664,1659` | proxy + guardAdminPost | none | `maxDuration = 60` | manual: ids positive ints, `components` non-empty, `expiryDays` > 0; `bundlePriceOverride` passed through unvalidated (`number\|string`), `title` unbounded | `{ok, offer, redirectUrl}`; refusal envelope `{error:{code,message}, offenders?, offer?}` with `STATUS_BY_REASON` (`sold_out` 409, `no_variant` 422, `variant_not_found` 409, `create_failed` 502, `not_configured`/`no_db` 503, ...) | Refusal responses are built with `adminJson(...)` rather than `adminJsonError` to carry `offenders` — same envelope shape, different helper. |
| `POST /api/admin/bundles/delete` | POST | `deleteDraftBundleOffer(id)` — only `pending`/`failed` rows. | `CustomerProfileCard.tsx:1292` | proxy + guardAdminPost | none | `maxDuration = 30` | `id` | `{ok, offer}`; 404 / `not_deletable` 409 / `delete_failed` 502 | — |
| `POST /api/admin/bundles/list` | POST | `listBundleOffersForCustomer(customerId)`. | **none in `src/`** — only `docs/BUNDLES.md:198`; `src/app/admin/page.tsx` loads offers server-side via `listBundleOffersWithSignalsForCustomer` | proxy + guardAdminPost | none | `maxDuration = 15` | `customerId` | `{offers}` | **Dead-route candidate** (see §12). |
| `POST /api/admin/bundles/suggest` | POST | AI bundle proposal: `getCustomerById`, `loadCustomerSessions` (all transcripts), `loadProductCatalog` → `suggestBundle` (Anthropic, usage recorded as `bundle_suggestions`). | `CustomerProfileCard.tsx:1138` | proxy + guardAdminPost | none | `maxDuration = 60` | `customerId` | `{title, components, componentsSum}`; `no_candidates` 409 / `empty` 422 / `ai_unavailable` 503; 404 | Reads all customer transcripts + spends tokens but has **no `recordAdminAccess`** (unlike `customers/profile`). |

###### 8.3 campaign (Shopify-audience campaign review queue — since 2026-10 the review desk of ONE campaign; see 8.3a)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/admin/campaign/contacts` | POST | `searchCampaignContacts(query)` — substring search over all contacts. | `KampagneWorkspace.tsx:1840` | proxy + guardAdminPost | none | `maxDuration = 10` | `query` non-empty (unbounded length) | `{contacts:[{id,email,firstName,lastName,status,optInLevel,language,hasDraft}]}` | **2026-10:** optional `campaignId` — the desk searches only that campaign's recipients. |
| `POST /api/admin/campaign/discount` | POST | `updateCampaignDraftDiscount(contactId, percent, expiresAt)` + advisory `detectDiscountTextMismatch`. | `KampagneWorkspace.tsx:902` | proxy + guardAdminPost | none | `maxDuration = 10` | `contactId`; `parseDiscountPercent` (0..`DISCOUNT_PERCENT_MAX`) | `{ok, discountPercent, discountExpiresAt, proseMismatch, prosePercents}`; 404; `not_editable` 409 | — |
| `POST /api/admin/campaign/draft` | POST | Single-contact (re)generation: `prepareDraftForContact(contact, percent, {refreshRecommendations, purchaseSelection, textMode})` (AI); reuse rule `shouldReuseCampaignDraft`; `isSuppressed` re-check. | `KampagneWorkspace.tsx:463,497,613` | proxy + guardAdminPost | none | `maxDuration = 60` | manual incl. `purchaseSelection` array ≤100, `textMode` enum | `{draft, recommendations[], bundle\|null, reused?\|regenerated?}`; 404; `already_sent`/`not_eligible` 409 | Not audit-logged. |
| `POST /api/admin/campaign/email-preview` | POST | `renderCampaignEmailPreview(contactId, {subject, body})` → full branded HTML (read-only). | `KampagneWorkspace.tsx:529` | proxy + guardAdminPost | none | `maxDuration = 15` | `contactId`; subject/body optional strings | `text/html` 200 `no-store`; **every** non-ok reason → 404 | One of four email-preview routes (see §13). |
| `POST /api/admin/campaign/language` | POST | `setContactLanguageOverride(contactId, "de"\|"en"\|null)` (normalised to null when equal to derived). | `KampagneWorkspace.tsx:764` | proxy + guardAdminPost | none | `maxDuration = 10` | enum | `{ok, language, derivedLanguage, languageOverride}`; 404; `already_sent` 409 | — |
| `POST /api/admin/campaign/mark-done` | POST | Copy-workflow completion: `markContactSent` then `recordCampaignSend({sentVia:"copy", bodyHash, bodyText...})`. | `KampagneWorkspace.tsx:575` | proxy + guardAdminPost | none | `maxDuration = 10` | `contactId` | `{ok}`; 404; `not_markable` 409 | Deliberately bypasses `CAMPAIGN_SENDS_APPROVED`. Status is flipped **before** the audit row is written (line 55 vs 62): if `recordCampaignSend` throws, the contact is `sent` with no `campaign_sends` record and the client sees 500. **2026-10:** the person is gated like a send — no `subscribed` consent or a blocked address → 409 `not_eligible` (test contacts exempt). |
| `POST /api/admin/campaign/prepare` | POST | Batch pre-generation `prepareNextDrafts(count ≤50, percent, textMode)` (AI per contact). | `KampagneWorkspace.tsx:1008` | proxy + guardAdminPost | none | `maxDuration = 300` | `count` 1..50, percent, `textMode` enum | `prepareNextDrafts` result | Token-spending, not audit-logged. **2026-10:** `campaignId` required; `discountPercent` optional (default = the campaign's offer); 409 `campaign_closed` when the campaign does not accept work. |
| `POST /api/admin/campaign/recommendations` | POST | `resolveProductSelections` validation (unknown / vanished variant / sold-out → structured refusals) → `updateCampaignDraftRecommendations`; attached bundle rebuilt via `archiveBundleOffer` + `createBundleOffer`. | `KampagneWorkspace.tsx:826` | proxy + guardAdminPost | none | `maxDuration = 60` | `productIds` array 1..5 | `{ok, recommendations[], bundle\|null, bundleError}`; envelopes with `offenders` 400/409 | Archive-then-create is not atomic: an archive success followed by create failure leaves the contact without a bundle (surfaced only as `bundleError`, HTTP 200). |
| `POST /api/admin/campaign/reset-queue` | POST | `resetDraftedContacts()` — deletes all open drafts, contacts back to `pending`. | `KampagneWorkspace.tsx:979` | proxy + guardAdminPost | none | `maxDuration = 30` | body ignored (JSON content-type still required by the guard) | `{ok, reset}` | Destructive bulk action, **not audit-logged**. **2026-10:** `{campaignId}` required — rebuilds one campaign's queue. |
| `POST /api/admin/campaign/send` | POST | `approveAndSendCampaign(contactId)` (`lib/campaign-email`: master flag, opt-in gate, suppression, frequency cap, unsubscribe link, MK- code, immutable `campaign_sends`). | `KampagneWorkspace.tsx:386,406` | proxy + guardAdminPost | none | `maxDuration = 30` | `contactId` | `{ok, sentTo}`; `STATUS_BY_REASON`: `sends_not_approved`/`opt_in_blocked` 403, `too_soon` 429, `no_unsubscribe`/`email_not_configured` 503, `discount_failed`/`send_failed` 502, others 409/404 | Not audit-logged at the route (the lib writes `campaign_sends`). **2026-10:** `approveAndSendCampaign` first checks the campaign (`campaign_closed`), then the consent gate (`no_consent`) — both reasons are not in `STATUS_BY_REASON` and fall back to HTTP 400. |
| `POST /api/admin/campaign/sent-email` | POST | `getCampaignSendContent(sendId)` → retained HTML, or `textAsHtml` wrapper for copy-path records. | `KampagneWorkspace.tsx:543` | proxy + guardAdminPost | none | `maxDuration = 10` | `sendId` | `text/html` 200; 404 `not_found` / `no_content` | POST returning HTML for a pure read. |
| `POST /api/admin/campaign/skip` | POST | `markContactSkipped(contactId)`. | `KampagneWorkspace.tsx:424` | proxy + guardAdminPost | none | `maxDuration = 10` | `contactId` | `{ok}`; `not_skippable` 409 | — |
| `POST /api/admin/campaign/sync` — **❌ retired 2026-10** → `POST /api/admin/campaigns/refresh` | POST | `syncCampaignAudience()` — same lib as the cron. | `KampagneWorkspace.tsx:947` | proxy + guardAdminPost | none | `maxDuration = 300` | none | sync result; 503 with the lib's reason code | Manual twin of `GET/POST /api/cron/sync-campaign-audience`. |
| `POST /api/admin/campaign/unskip` | POST | `unskipContact(contactId)` → back to `drafted` or `pending`. | `KampagneWorkspace.tsx:458` | proxy + guardAdminPost | none | `maxDuration = 10` | `contactId` | `{ok, status}`; `not_skipped` 409 | — |
| `POST /api/admin/campaign/update` | POST | `updateCampaignDraftText(contactId, subject, body)` while `drafted`. | `KampagneWorkspace.tsx:348` | proxy + guardAdminPost | none | `maxDuration = 10` | non-empty subject/body — **no length caps** | `{ok}`; `not_editable` 409 | Sibling `marketing/update` caps subject 300 / body 20 000; this one does not. |
| `GET /api/admin/campaign/history?q=&from=&to=&delivery=&campaignId=&page=&pageSize=` | GET | `searchCampaignSendHistory` — the paged, searchable „Gesendet“ view; redemption looked up in Shopify for the page's codes only. **2026-10:** `campaignId` scopes it to one campaign. | `kampagne/SentHistory.tsx`, `kampagne/ContactHistorySheet.tsx` | proxy + guardAdminGet | none | `dynamic = "force-dynamic"` | params parsed (`parseDeliveryFilter`, `/^\d+$/`) | `{rows, total, page, pageSize, …}` with redemption | — |
| `GET/POST /api/admin/campaign/test-contacts` | GET, POST | Testkontakte (0057): GET list, POST `create` (+ immediate draft, optionally borrowing a customer's purchase history) / `delete`. **2026-10:** `campaignId` required (GET query, POST create) — test contacts belong to one campaign and see its briefing and offer. | `kampagne/TestContactsSheet.tsx` | proxy + guardAdminGet / guardAdminPost | none | `maxDuration = 60` | e-mail regex, `parseDiscountPercent`, `parseEmailTextMode`; 400 `campaignId required` | `{contacts}` / `{contact, drafted}` / `{ok}` | Test sends are real (MK- code, set, link) but excluded from KPIs. |

###### 8.3a campaigns (Kampagnen: definitions, audiences, Einzelansprache — new 2026-10)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET/POST /api/admin/campaigns` | GET, POST | GET `listCampaigns({includeArchived:true})`; POST `createCampaign` — a new campaign starts as `entwurf`, nothing is materialised or drafted. | POST: `kampagnen/CampaignEditor.tsx`; GET: no UI caller (the screen renders server-side) | proxy + guardAdminGet / guardAdminPost | none | `maxDuration = 30` | `validateCampaignInput(raw, {create:true})` (`campaign-def.mjs`) | `{campaigns}` / `{id}`; 400 `invalid` (first German error); 503 `no_database` | — |
| `POST /api/admin/campaigns/update` | POST | `updateCampaign(id, fields)`; an active campaign whose audience / audience mode changed is re-materialised at once. Kind is not changeable. | `kampagnen/CampaignEditor.tsx` | proxy + guardAdminPost | none | `maxDuration = 120` | `validateCampaignInput` (present fields only) | `{campaign}`; 400; 404 | — |
| `POST /api/admin/campaigns/status` | POST | `setCampaignStatus(id, status)` — Starten / Pausieren / Fortsetzen / Beenden / Archivieren; starting materialises the audience. | `kampagnen/CampaignsOverview.tsx` | proxy + guardAdminPost | none | `maxDuration = 120` | status ∈ `CAMPAIGN_STATUSES`; transition via `canTransition` (never for `einzel`) | `{campaign, refresh}`; 404; 409 `invalid_transition` | — |
| `POST /api/admin/campaigns/refresh` | POST | `refreshCampaignAudience(campaignId)` — „Zielgruppe aktualisieren“. | `kampagne/useCampaignActions.ts` | proxy + guardAdminPost | none | `maxDuration = 120` | `campaignId` positive int | `{ok, matched, added, refreshed, suppressed, excluded, note?}`; 503 `refresh_failed` | Replaces `campaign/sync`. |
| `POST /api/admin/campaigns/audience-preview` | POST | `normalizeAudienceSpec` → `previewAudience` (count WITH consent, with Mo, DE/EN split, sample names) + `describeAudienceSpec`. **2026-10 follow-up:** the counts are window aggregates (`count(*) OVER ()` with FILTERs) and only 8 rows are fetched (before: up to 100,000 members counted in JS); a second `matchAudience(…, {withoutConsent:true})` adds `preview.withoutConsent {total, letterReach}` — the same spec among people without the consent or blocked, and of those with a postal address and no postal objection. **2026-10-03 (0074):** optional `letterMode` (`ohne_einwilligung` \| `alle`) adds a third `matchAudience(…, {letterMode})` → `preview.letters {total, withAddress}` (letter recipients under the letter rules; `withAddress` counts purchase addresses only). | `kampagnen/CampaignEditor.tsx` | proxy + guardAdminPost | none | `maxDuration = 60` | spec normalised (unknown fields dropped); `letterMode` other values → ignored | `{spec, description, preview}` | Pure DB. The only match that skips the consent; nothing is materialised. |
| `POST /api/admin/campaigns/assist` | POST | AI help (writer tier, `src/lib/campaign-assist.ts`): `action:"audience"` (sentence → spec + explanation, catalogue categories as vocabulary) or `action:"brief"` (name, kind, notes, end, discount → Briefing). | `kampagnen/CampaignEditor.tsx` | proxy + guardAdminPost | none | `maxDuration = 60` | `action` enum | `{spec, explanation}` / `{brief}`; 422 `assist_failed` | Token-spending, not audit-logged. |
| `POST /api/admin/campaigns/add-recipient` | POST | `addRecipient` — one person into a campaign by hand (default: the Einzelansprache) with an operator note; `draft:true` writes the draft at once with the campaign's offer settings. | `kunden/tabs/MarketingTab.tsx` | proxy + guardAdminPost | none | `maxDuration = 120` | `customerId`; `adminNote` ≤ 1500; `campaignId?`, `conversationId?` | `{contactId, campaignId, created, drafted}`; 409 `no_consent` / `blocked` / `campaign_closed`; 404; 503 `db` | Requires the one consent and no block (the send gate checks again). Token-spending with `draft:true`. **2026-10 follow-up:** audit-logged (`campaign.add_recipient`). |
| `POST /api/admin/campaigns/add-recipients` (2026-10 follow-up) | POST | Kunden „Zur Kampagne…“ (KUN-133): `addRecipient` per id into one campaign (default the Einzelansprache) with one operator note; people without the consent or with a block are counted and skipped, never added. Nothing is drafted or sent. | `kunden/KundenWorkspace.tsx` | proxy + guardAdminPost | none | `maxDuration = 60` | `customerIds` array of positive ints, deduplicated, 1…200 (else 400 „Höchstens 200 Personen auf einmal.“); `campaignId?`; `adminNote` ≤ 2000 | `{campaignId, campaignSlug, added, alreadyIn, noConsent, blocked, notFound, failed}`; 404; 409 `campaign_closed` (beendet / archiviert); 500 | Sequential `addRecipient` calls (≤ 200 round-trips). Audit-logged with counts only (`campaign.add_recipients`). The UI toast ignores `failed`. |
| `POST /api/admin/campaigns/letters` (2026-10-03, 0074) | POST | The desk view „Briefe“ (KAM-116…120, `CAMPAIGNS.md` §8): `list` → `letterDeskData` (letters with the person read fresh, review checks, counts, postage, budget, flags); steps `fill_addresses` (`fillCampaignLetterAddresses`, 50), `draft` (`draftCampaignLetters`, 5 AI drafts), `send_step` (`sendCampaignLetterStep`, 5 released letters, every gate per letter); per letter `redraft`, `save`, `approve`, `unapprove`, `skip`, `unskip`. | `kampagne/LettersView.tsx` | proxy + guardAdminPost | none | `maxDuration = 300` | `action` enum; `campaignId` or `id` positive int; `save`: subject ≤ 200, body ≤ 8,000 (trimmed, non-empty) | step results `{…, remaining}`; 400; 404; 409 `letters_off` (steps, `redraft` and `approve` while the mode is „aus“; `list`, `save`, `skip` still answer), 409 `objection` (redraft / approve after a postal objection), 409 `conflict` (wrong status); 403 `flag_off` / 503 `shopify_not_configured` for `fill_addresses`; 503 `no_database` | Token-spending (`draft`, `redraft`) and posting (`send_step`). Audit-logged: each release (`campaign.letter_approve`, customer id) and each send step that sent or refused something (`campaign.letters_send`, counts only). |
| `POST /api/admin/campaigns/letters/preview` (2026-10-03, 0074) | POST | The letter as printed: the stored purchase address (or a placeholder recipient), the text (unsaved edits may be passed), `buildLetterPdf` with the objection notice and footer. Read-only. | `kampagne/LettersView.tsx` (`fetchPdf`) | proxy + guardAdminPost | none | `maxDuration = 30` | `id` positive int; `subject?`, `body?` strings | `application/pdf`; 404; 409 `no_text` | — |

###### 8.4 catalog

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/admin/catalog/search` | POST | `loadProductCatalog()` + `searchCatalogByName(catalog, query, MAX_SEARCH_RESULTS)` → picker shape incl. variants. | `admin/ui/product-picker.tsx:86` (bundle composer, campaign recommendations, Wissen "Produkt verlinken") | proxy + guardAdminPost | none | `maxDuration = 15` | `query` non-empty | `{products:[{productId, title, imageUrl, unitPrice, currency, inStock, url, priceMin, priceMax, variants[]}]}` | Read-only POST. |

###### 8.5 conversations (Gespräche inspector)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/admin/conversations/analyze-bulk` | POST | Loop over `loadUnanalyzedIds(from, to, BULK_ANALYZE_LIMIT)`: `generateConversationAnalysis` (Haiku) + `saveConversationAnalysis`; stops on `unconfigured`. | `GespraecheInsights.tsx:169` | proxy + guardAdminPost | none | `maxDuration = 60` | `from`/`to` `YYYY-MM-DD`, `from <= to`, `confirm === true` (400 `not_confirmed`) | `{processed, failed, remaining, unconfigured, approxCostUsd, costEur, model}`; 503 | audit-logged. |
| `POST /api/admin/conversations/analyze` | POST | Cached-or-generate single analysis (`shouldRegenerate`), `saveConversationAnalysis`. | `GespraecheWorkspace.tsx:688` | proxy + guardAdminPost | none | `maxDuration = 30` | `conversationId`, `force` | `{analysis, usage, cached, warning?}`; `analysis_<reason>` 503/409/502; 404 | audit-logged only when generating. |
| `POST /api/admin/conversations/detail` | POST | `getAdminConversationDetail(id)` — transcript + signals + cached analysis (pure read). | `GespraecheWorkspace.tsx:655` | proxy + guardAdminPost | none | **no `maxDuration`** (default) | `conversationId` | `{detail}`; 404; 503 | audit-logged (`conversation.view`). |
| `POST /api/admin/conversations/insights` | POST | `getCachedInsights(from,to)` or `generateConversationInsights` (two model passes over cached summaries). | `GespraecheInsights.tsx:399` | proxy + guardAdminPost | none | `maxDuration = 300` | dates, `force` | `{insights}` | audit-logged when generating. |

###### 8.6 correspondence (Korrespondenz panel / unmatched inbound queue)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/admin/correspondence/assign` | POST | `assignInboundToCustomer(messageId, customerId)` — attach an unmatched inbound mail to a customer, re-thread. | `UnmatchedInboundQueue.tsx:103` | proxy + guardAdminPost | none | **no `maxDuration`** | two positive ints | `{ok, customerId, customerEmail}`; 404; `conflict` 409 | Not audit-logged. **2026-10:** caller is `eingang/UnmatchedInbound.tsx` (Eingang), the target picked via `GET customers/list?kq=`. |
| `POST /api/admin/correspondence/email-preview` | POST | `renderCorrespondenceEmail(body)` → minimal HTML (no customer lookup). | `KorrespondenzPanel.tsx:424` | proxy + guardAdminPost | none | `maxDuration = 15` | body non-empty, sliced to 20 000 | `text/html` | Third email-preview route (§13). |
| `POST /api/admin/correspondence/message` | POST | `getMessageById(id)`; if no stored body and `providerEmailId`: lazy `resend.emails.receiving.get` + `saveFetchedBody`. | `KorrespondenzPanel.tsx:219` | proxy + guardAdminPost | none | `maxDuration = 30` | `id` | `{bodyText, bodyHtml, attachments}`; 404 | audit-logged (`correspondence.read`). Local `fetchFullMessage` helper (lines 90-105) **duplicates** `fetchFullInboundMessage` in `src/app/api/inbound/resend/route.ts:143-158` byte-for-byte in logic. |
| `POST /api/admin/correspondence/send` | POST | Compose/reply: `getMessageHeaders(parent)` for threading → `sendEmail({kind:"correspondence", messageId, replyTo, inReplyTo, references})` → `recordSentMessage`. | `KorrespondenzPanel.tsx:353` | proxy + guardAdminPost | none | `maxDuration = 30` | `customerId`, body non-empty (sliced 20 000), subject sliced 300, `inReplyToMessageId` int; parent must belong to the customer (400) | `{ok, sentTo, threaded}`; `email_not_configured` 503; `send_failed` 502; 404 | Sends arbitrary operator text; **no suppression check by design** (correspondence ≠ marketing). Not audit-logged. |

###### 8.7 customers (Kunden workspace)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/admin/customers/letter-draft` | POST | Dual-mode: `save:true` → `saveCustomerLetterDraft(customerId, subject, body≤20000)`; else AI `generateCustomerLetterDraft` over all sessions + selections + correspondence + purchases, then save. | `PhysicalLetterPanel.tsx:114` | proxy + guardAdminPost | none | `maxDuration = 60` | `customerId`; `adminInstructions` string ≤2000 | `{letterDraft:{subject, body}}`; 404; 500 | Overloaded endpoint (save vs. generate). Reads every transcript + correspondence with **no `recordAdminAccess`** (contrast `customers/profile`). **2026-10:** 409 `objection` when the person objected to advertising letters (`postal_objection_at`). |
| `POST /api/admin/customers/letter-preview` | POST | `physicalEligibilityForCustomer` address (or placeholder) → `buildLetterPdf` → inline PDF. | `PhysicalLetterPanel.tsx:131` | proxy + guardAdminPost | none | `maxDuration = 30` | `customerId`; optional subject/body | `application/pdf` inline; 404 | **2026-10-03 (0074):** the eligibility accepts only a purchase address, so any other stored address previews as the placeholder. |
| `POST /api/admin/customers/letter-address` (2026-10-03, 0074) | POST | Kunden → Brief „Adresse aus letzter Bestellung holen“ (KUN-135): `fillPostalAddressesFromOrders([customerId])` — the shipping address of the latest completed order (PAID / PARTIALLY_REFUNDED, not cancelled) read live from Shopify and stored as the purchase address. | `kunden/tabs/BriefTab.tsx` | proxy + guardAdminPost | none | `maxDuration = 30` | `customerId` positive int | `{ok, checked, filled, unchanged, noOrder, noAddress, failed}`; 400; 403 `flag_off` (`PHYSICAL_MAIL_SENDS_APPROVED` off); 503 `shopify_not_configured`; 500 | Audit-logged (`customer.letter_address`, with `filled`). |
| `POST /api/admin/customers/marketing-draft` | POST | Full-context per-customer marketing draft: `loadEligibleCaptureByEmail`, `saveCustomerAdminInstructions` (persisted before generation), sessions/selections/correspondence, `getActiveBundleForCustomer`, AI `generateCustomerMarketingDraft`, `createDraft`/`saveRegeneratedDraft`, `linkBundleOfferToSend`. | `CustomerProfileCard.tsx:714`, `KundenWorkspace.tsx:142` (bulk) | proxy + guardAdminPost | none | `maxDuration = 60` | `customerId`, `discountPercent`, `adminInstructions` ≤2000, `textMode` enum | `{send, reused?\|regenerated?}`; `not_eligible` 409; `draft_gone` 409; `draft_persist_failed` **500 whose message embeds the raw DB error text** (line 314-318) | Supersedes `/api/admin/marketing/draft` (header comment: "the full-context upgrade of /api/admin/marketing/draft"). Not audit-logged. **2026-10:** only reachable for an open draft of the former path (Marketing tab, Plan D-8); new 1:1 mails use `campaigns/add-recipient`. |
| `POST /api/admin/customers/profile` | POST | `regenerateCustomerProfile(customerId)` — the one profile path (also nightly upkeep + report): refreshes an empty purchase cache, `generateCustomerProfile` (deep tier, structured output) over sessions + purchases + account context + correspondence + Kampagne history → `saveCustomerProfile` (summary + `profile_data` + `persona_label`). | kunden/tabs/ProfilTab.tsx | proxy + guardAdminPost | none | `maxDuration = 60` | `customerId` | `{profileSummary, profileData, usage, cached, warning?}`; `profile_<reason>` 503 / 409 / 502, 404 for `profile_not_found` | audit-logged (`customer.profile.generate`). **2026-10:** 409 `profile_not_allowed` under `CUSTOMER_AI_PROFILE_SCOPE=consented` without consent or after an Art. 21 objection; the depth (Vollprofil deep tier / Kaufprofil writer tier) follows the data. |
| `POST /api/admin/customers/erase` | POST | Complete erasure of a person (`erasePerson`) by customer or Kampagne contact. | kunden/CustomerDetail.tsx, kampagne/useCampaignActions.ts | proxy + guardAdminPost | none | `maxDuration = 30` | `customerId` or `contactId` (positive int), `confirm: true` required | `{ok, customerDeleted, deletedConversations, deletedCampaignContacts, deletedHeroImages}`; 400; 503 `erase_failed` | audit-logged BEFORE the erasure (`customer.erase`, numeric id only). |
| `POST /api/admin/customers/marketing-optout` | POST | Manual opt-out (`optOutManually`: `unsubscribeByEmail(…, "manual")` + contact suppressed) or lift (`liftOptOut`: exact inverse — block row, chat DOI restored when it had been confirmed, campaign_sends attribution, contact back to drafted/pending). Sends no e-mail. | kunden/tabs/OptOutControl.tsx, kampagne/useCampaignActions.ts | proxy + guardAdminPost | none | `maxDuration = 15` | `customerId` or `contactId`, `action` optout \| lift, `confirm: true`; test contacts refused | `{ok, state, restoredContacts?, contactStatus?}`; 409 `not_blocked` / `not_allowed` (bounce, complaint, erasure); 503 | audit-logged (`customer.optout`, `customer.optout.lift`). **2026-10:** both directions go through `consent-flows.ts` (`recordMoWithdrawal` / `restoreConsentAfterLift`) to the one consent and via the outbox to Shopify. |
| `POST /api/admin/customers/purchases` | POST | `refreshCustomerData(customer)` (`lib/customer-refresh`, shared with the cron). | `CustomerProfileCard.tsx:261` | proxy + guardAdminPost | none | `maxDuration = 30` | `customerId` | `{purchaseSummary}`; `no_shopify` 503 / `upstream_unavailable` 502 / `store_failed` 500; 404 | **2026-10:** only the fallback before a person is mirrored; mirrored people read the order ledger. |
| `GET /api/admin/customers/list?kq=&kview=&…` (new 2026-10) | GET | `listCustomers(parseCustomerFilter(searchParams))` — the Kunden list as JSON, same URL parameters as the screen. | `eingang/UnmatchedInbound.tsx` (customer search) | proxy + guardAdminGet | none | default | `parseCustomerFilter` (unknown values dropped) | `{items, total, page, pageSize}` | — |
| `POST /api/admin/customers/language` (new 2026-10) | POST | Pins / clears `customers.language_override`; open recipient rows (`pending`/`drafted`/`draft_failed`) follow. | `kunden/tabs/UeberblickTab.tsx` | proxy + guardAdminPost | none | default | `customerId`; `language` `de`\|`en`\|null | `{ok}`; 404; 503 | Raw SQL in the route (no store function). **2026-10 follow-up:** the SQL moved to `setCustomerLanguageOverride` (`customer-store.ts`, `null` on a DB problem) → 404 unknown customer, 500 `internal_error` otherwise (also without a database — no more 503); the UI resets the control after a failed save. |
| `POST /api/admin/customers/objection` (new 2026-10) | POST | `setCustomerObjection(customerId, kind, objected)` — Art. 21: `profile` deletes the stored profile and stops it, `postal` stops advertising letters and deletes the letter draft. | `kunden/tabs/UeberblickTab.tsx`, `kunden/tabs/BriefTab.tsx` | proxy + guardAdminPost | none | default | `kind` `profile`\|`postal`, `objected` boolean | `{ok}`; 404 | Not audit-logged. **2026-10 follow-up:** audit-logged (`customer.objection` with kind and direction); a recorded `profile` objection also calls `removeInsightTags` (`shopify-insights.ts`): the person's pending / failed `writeback` rows are dropped and one `writeback` removing every `mo-` tag the mirror holds is queued — whatever `SHOPIFY_WRITEBACK_ENABLED` says (the row waits until it is on). Lifting does not re-add tags; the next nightly run does. |
| `POST /api/admin/customers/ask` (new 2026-10) | POST | „Frag Mo“: `askAboutCustomer(customerId, question)` — builds the person's record (`buildAskSources`, `customer-ask-core.mjs`), one writer-tier call, answer with cited sources; the AI profile only without an objection. | `kunden/tabs/AktivitaetTab.tsx` | proxy + guardAdminPost | none | `maxDuration = 60` | `customerId`; `question` string (`normalizeAskQuestion`) | `{answer, confident, citations, sourcesTotal, sourcesUsed}`; 400; 404; `upstream_unavailable` 503 (no key) / 502 (model failed) | Reads the whole record + spends tokens; not audit-logged. **2026-10 follow-up:** audit-logged after a successful answer (`customer.ask`). |
| `GET /api/admin/customers/similar?id=` (2026-10 follow-up) | GET | „Ähnliche Kunden“ (KUN-134): `listSimilarCustomers(id)` — same `value_tier`, overlapping `bought_categories`, ranked by shared categories, then same lifecycle segment, persona, revenue (≤ 8), each with `consented`; plus `audience {v:1, valueTier:[tier], categories:[≤ 6]}`. | `kunden/tabs/UeberblickTab.tsx` | proxy + guardAdminGet | none | default | `id` positive int | `{items, audience}` (`audience: null` without tier or categories); 400; 500 | Pure DB, deterministic. Audit-logged (`customer.similar`, the person's id + the number shown) — it returns other customers' names and e-mails. |

###### 8.8 directives (team directives injected into Mo's system prompt)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET /api/admin/directives` | GET | `listDirectives()` + limits. | **none in `src/`** — `VerbesserungTab.tsx:28` calls `listDirectives()` server-side; only `docs/IMPROVEMENT_LOOP.md:187` mentions the route | proxy + guardAdminGet | none | `maxDuration = 15` | — | `{directives, limits:{maxActive, maxChars}}` | **Dead-route candidate** (§12). |
| `POST /api/admin/directives/save` | POST | `createDirective({content, source:"operator"})` or `updateDirectiveContent(id, content)`; length + active-count caps enforced in the store. | `verbesserung/DirectivesCard.tsx:76,180` | proxy + guardAdminPost | none | `maxDuration = 15` | `id?` positive int, `content` non-empty | `{directive}`; 400 (`invalid_content`/`too_many_active` mapped to `bad_request`); 404; 503 | audit-logged. |
| `POST /api/admin/directives/toggle` | POST | `setDirectiveActive(id, active)`. | `verbesserung/DirectivesCard.tsx:211` | proxy + guardAdminPost | none | `maxDuration = 15` | `id`, `active` boolean | `{directive}`; 400; 404 | audit-logged. |
| `GET /api/admin/directives/versions?id=` | GET | `listDirectiveVersions(id)`. | `verbesserung/DirectivesCard.tsx:245` | proxy + guardAdminGet | none | `maxDuration = 15` | `id` query int | `{versions}` (`[]` without DB) | — |

###### 8.9 email-designs (Einstellungen: design per email type)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET /api/admin/email-designs` | GET | `listEmailDesignMeta()` (code registry) + `listEmailDesignSelections()`. | see §12 — only comments reference it (`EinstellungenTab.tsx:6`, `EmailSettingsWorkspace.tsx:17`) | proxy + guardAdminGet | none | `maxDuration = 15` | — | `{designs, selections}` | **No try/catch**. Dead-route candidate pending the grep in §12. |
| `POST /api/admin/email-designs/assign` | POST | `setEmailDesignSelection(kind, designKey\|null)`. | `EmailSettingsWorkspace.tsx:100` | proxy + guardAdminPost | none | `maxDuration = 15` | `kind` via `parseEmailThemeKind`, `designKey` string\|null | `{ok}`; 404 `unknown_design`; 400 `unsupported_kind`; 503 | audit-logged. |
| `POST /api/admin/email-designs/preview` | POST | `resolveEmailDesignForKind` + `renderEmailDesignPreview(kind, design)` with fake data → HTML. | `EmailSettingsWorkspace.tsx:201,278` | proxy + guardAdminPost | none | `maxDuration = 15` | `kind` enum; `designKey` must be `isKnownEmailDesign` (404) and `designSupportsKind` (400) | `text/html` | Fourth email-preview route (§13). |

###### 8.10 email-hero (AI hero image per draft)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET /api/admin/email-hero?kind=&id=` | GET | `getEmailHero(kind, id)` + `defaultHeroImageUrl()` + `isHeroGenerationConfigured()`. | `HeroImagePanel.tsx:59` | proxy + guardAdminGet | none | `maxDuration = 15` | `kind` via `parseEmailHeroKind`, `id` int | `{url, prompt, headline, defaultUrl, generationConfigured}` | **No try/catch**. |
| `POST /api/admin/email-hero/generate` | POST | `generateHeroImage(kind, id, prompt)` (image model + quality check + Vercel Blob upload) then optional `setEmailHeroHeadline`. | `HeroImagePanel.tsx:123` | proxy + guardAdminPost | none | `maxDuration = 300` (longest admin route) | `id` must be a JSON **number** (`typeof === "number"`, unlike every other route which accepts numeric strings via `Number()`); prompt via `normalizeHeroPrompt` ≤ `MAX_HERO_PROMPT_CHARS`; headline ≤ `MAX_HERO_HEADLINE_CHARS` | `{url, review}`; 400 with the generator's message; 503 | audit-logged. |
| `POST /api/admin/email-hero/headline` | POST | `setEmailHeroHeadline(kind, id, headline\|null)`. | `HeroImagePanel.tsx:172` | proxy + guardAdminPost | none | `maxDuration = 15` | as above | `{ok}`; 404 | audit-logged. |
| `POST /api/admin/email-hero/remove` | POST | `setEmailHero(kind, id, null, null)` (blob kept). | `HeroImagePanel.tsx:208` | proxy + guardAdminPost | none | `maxDuration = 15` | `kind`, numeric `id` | `{ok}`; 404 | audit-logged. |
| `POST /api/admin/email-hero/suggest` | POST | `suggestHeroPrompt(kind, id)` — one AI pass. | `HeroImagePanel.tsx:86` | proxy + guardAdminPost | none | `maxDuration = 30` | `kind`, numeric `id` | `{prompt, headline}`; 400 | audit-logged; the only email-hero route without an `isDbConfigured` pre-check. |

###### 8.11 improve (Verbesserung: improvement runs + suggestions)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET /api/admin/improve` | GET | `listImprovementRuns()`. | `verbesserung/VerbesserungWorkspace.tsx:100` | proxy + guardAdminGet | none | `maxDuration = 15` | — | `{runs}` | — |
| `GET /api/admin/improve/[id]` | GET | `getImprovementRun(id)`. | `verbesserung/VerbesserungWorkspace.tsx:112` | proxy + guardAdminGet | none | `maxDuration = 15` | path id | `{run}`; 400; 404; 503 | — |
| `POST /api/admin/improve/adopt` | POST | `getSuggestion` → `createDirective({content: override ?? directiveText, source:"suggestion", suggestionId})` → `updateSuggestionStatus(implemented, note)`. | `verbesserung/SuggestionCard.tsx:134` | proxy + guardAdminPost | none | `maxDuration = 15` | `suggestionId`; `content` string\|absent | `{directive, suggestion}`; 400; 404 | audit-logged. |
| `POST /api/admin/improve/delete` | POST | `deleteImprovementRun(id)` (suggestions cascade). | `verbesserung/VerbesserungWorkspace.tsx:781` | proxy + guardAdminPost | none | `maxDuration = 15` | `id` | `{ok}`; **500** when `!ok` (no 404 distinction for a missing run) | audit-logged. |
| `POST /api/admin/improve/run` | POST | `startImprovementRun(reportId)` (row only; stepped by `/step`). | `verbesserung/VerbesserungWorkspace.tsx:372` | proxy + guardAdminPost | none | `maxDuration = 30` | `reportId` | `{id}`; 404; 400 `not_complete` | audit-logged. |
| `POST /api/admin/improve/step` | POST | `stepImprovementRun(id)` — exactly one Sonnet call. | `verbesserung/VerbesserungWorkspace.tsx:681` | proxy + guardAdminPost | none | `maxDuration = 300` | `id` | `{status, phase, costEur, done, busy, error}`; 404 | — |
| `POST /api/admin/improve/suggestion` | POST | `updateSuggestionStatus(suggestionId, status ∈ SUGGESTION_STATUSES, note≤500)`. | `verbesserung/SuggestionCard.tsx:97` | proxy + guardAdminPost | none | `maxDuration = 15` | enum check | `{suggestion}`; 404 | audit-logged. |

###### 8.12 kpi

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/admin/kpi/top-questions` | POST | `getCachedTopQuestions(persona)` or `generateTopQuestions(persona)` (Anthropic). | `KpiTopQuestions.tsx:47` | proxy + guardAdminPost | none | `maxDuration = 30` | `personaLabel` ∈ `ARCHETYPE_META` keys + `unknown`; `force` | `{summary}`; 503 `unavailable`; 500 | Token-spending, not audit-logged. |

###### 8.13 marketing (per-capture marketing sends — older flow)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/admin/marketing/delete` | POST | `deleteDraftSend(sendId)` (only `status='draft'`). | `CustomerProfileCard.tsx:759` | proxy + guardAdminPost | none | `maxDuration = 10` | `sendId` | `{ok}`; `not_deletable` 409 | — |
| `POST /api/admin/marketing/draft` | POST | Per-capture AI draft: `loadEligibleCapture(captureId)`, `loadConversationForSummary(sessionId)`, `chooseCartProductIds`, `generateMarketingDraft`, `createDraft`/`saveRegeneratedDraft`. | **none in `src/app/admin`** — only a comment in `src/lib/campaign-draft-core.mjs:17` | proxy + guardAdminPost | none | `maxDuration = 30` | `captureId`, `discountPercent`, `regenerate` | `{send, reused?\|regenerated?}`; `not_eligible` 409; `draft_gone` 409; `draft_persist_failed` 500 (raw DB message) | **Dead-route candidate**, superseded by `customers/marketing-draft` (§12). |
| `POST /api/admin/marketing/email-preview` | POST | `renderMarketingEmailPreview(sendId, {subject, body})` → HTML. | `CustomerProfileCard.tsx:966`, `EmailPreviewButton.tsx:36` | proxy + guardAdminPost | none | `maxDuration = 15` | `sendId` | `text/html`; any non-ok → 404 | Second email-preview route (§13). |
| `POST /api/admin/marketing/send` | POST | `approveAndSend(sendId)` (`lib/marketing-email`: DOI + suppression, unsubscribe link, MS5- code mint, tracked link, status `sent`). | `CustomerProfileCard.tsx:789` | proxy + guardAdminPost | none | `maxDuration = 30` | `sendId` | `{ok, sentTo}`; `STATUS_BY_REASON` (`too_soon` 429, `discount_failed`/`send_failed` 502, `no_unsubscribe`/`email_not_configured` 503, ...) | — |
| `POST /api/admin/marketing/update` | POST | `updateDraftText(sendId, subject≤300, body≤20000)`. | `CustomerProfileCard.tsx:744,788` | proxy + guardAdminPost | none | `maxDuration = 10` | caps + non-empty body | `{send}`; `not_editable` 409 | — |

###### 8.14 physical (Pingen letters)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/admin/physical/send` | POST | `sendPhysicalLetter(customerId)` (`lib/physical-mail`: `PHYSICAL_MAIL_SENDS_APPROVED` flag, complete lawful address, letter draft, Pingen `uploadAndCreate` with Idempotency-Key). | `PhysicalLetterPanel.tsx:188` | proxy + guardAdminPost | none | `maxDuration = 30` | `customerId` | `{ok, letterId, providerLetterId, status}`; `flag_off` 403, `no_draft`/`no_address`/`incomplete_address` 409, `pingen_not_configured` 503, `submit_failed` 502, `store_failed` 500 | Sends a physical letter (PII to a third-party processor) with no `recordAdminAccess`. **2026-10-03 (0074):** only a purchase address counts — 409 `not_purchase_address` for any other source, 409 `address_invalid` after an undeliverable letter, 409 `objection`; the hand-over is `submitLetter`, shared with the campaign letters (KAM-120). |

###### 8.15 qa (Wissen: customer Q&A knowledge base)

All eight routes check `isDbConfigured()` right after the guard and — except `scan` — have **no try/catch** (DB/Shopify exceptions escape as framework 500s).

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/admin/qa/answer` | POST | Validates `productId` against `loadProductCatalog()` (title resolved server-side) → `saveQaAnswer({id, answer≤4000, question≤500, productId, productTitle, questionEn≤500, answerEn≤4000})`. | `WissenWorkspace.tsx:262` | proxy + guardAdminPost | none | `maxDuration = 15` | manual + caps | `{entry}`; 400 `unknown_product`; 404 | audit-logged. |
| `POST /api/admin/qa/dismiss` | POST | `dismissQaEntry(id)`. | `WissenWorkspace.tsx:360` | proxy + guardAdminPost | none | `maxDuration = 15` | `id` | `{ok}`; **500 with code `unavailable`** on `!ok` (elsewhere `unavailable` is the 503 code) | audit-logged. |
| `POST /api/admin/qa/draft` | POST | `draftQaForConversation(conversationId)` — one Sonnet 5.5 pass. | **none found in `src/`** (header says "e.g. straight from the Gespräche inspector", but `GespraecheWorkspace.tsx` does not call it) | proxy + guardAdminPost | none | `maxDuration = 60` | `conversationId` | `{outcome}`; 502 `draft_failed` | **Dead-route candidate** (§12). audit-logged. |
| `GET /api/admin/qa/list?status=` | GET | `listQaEntries(status)`, `getQaCounts()`, `countScanCandidates()`. | `WissenWorkspace.tsx:100` | proxy + guardAdminGet | none | `maxDuration = 15` | `status` ∈ `QA_STATUSES` else null (all) | `{entries, counts, scanCandidates}`; 503 | — |
| `POST /api/admin/qa/publish` | POST | `generateQaTranslation` (Haiku, failure non-blocking) → `saveQaTranslation` → product-linked: `publishQaToProduct` (Shopify `metafieldsSet` + catalog refresh); `markQaPublished`; `invalidateGeneralQaCache`. | `WissenWorkspace.tsx:295` | proxy + guardAdminPost | none | `maxDuration = 60` | `id` | `{entry, catalogRefreshed, translated, hasEnglish}`; 409 `not_answered`; 503 `shopify_unconfigured`; `publish_<reason>` 404/502 | audit-logged. Writes to Shopify. |
| `POST /api/admin/qa/restore` | POST | `restoreQaEntry(id)`. | `WissenWorkspace.tsx:339` | proxy + guardAdminPost | none | `maxDuration = 15` | `id` | `{entry}`; 409 `duplicate_question`; 404 | audit-logged. |
| `POST /api/admin/qa/scan` | POST | `listScanCandidates(limit 1..15, default 10)` → loop `draftQaForConversation`. | `WissenWorkspace.tsx:119` | proxy + guardAdminPost | none | `maxDuration = 300` | `limit` clamped | `{scanned, created, noGap, duplicates, errors}` | audit-logged; only qa route with (inner-loop) try/catch. |
| `POST /api/admin/qa/unpublish` | POST | product-linked: `unpublishQaFromProduct` (metafield removal + catalog refresh); `markQaUnpublished`; cache invalidation. | `WissenWorkspace.tsx:321` | proxy + guardAdminPost | none | `maxDuration = 60` | `id` | `{entry, removed, catalogRefreshed}`; 409 `not_published`; 503; `unpublish_<reason>` 502; 500 `unavailable` | audit-logged. |

###### 8.16 inbox (Eingang — new 2026-10)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET /api/admin/inbox/item?id=` | GET | `getInboxItem` + the customer mini-card (identity, `consentLabel`, `sendable`, letter possible, persona, profile depth + excerpt unless objected, `getCustomerFigures`); for `antwort_offen` also the conversation (`loadMailThread`: last 12 messages, quotes stripped, `isNew`) and `replyToMessageId`. | `eingang/EingangWorkspace.tsx` | proxy + guardAdminGet | none | default | `id` positive int | `{item, customer\|null, mail\|null}`; 400; 404 | Read-only. |
| `POST /api/admin/correspondence/assign-prospect` | POST | „Als Interessent anlegen“: `findOrCreateProspect` from the sender address (no name — the inbound log keeps the bare address; no consent), `assignInboundToCustomer`, `noteInboundMail`. | `eingang/UnmatchedInbound.tsx` | proxy + guardAdminPost | none | default | `messageId` positive int | `{ok, customerId, itemId}`; 400; 404; 409 | Audit-logged (`correspondence.assign_prospect`). New 2026-10-02. |
| `POST /api/admin/inbox/decide` | POST | `decideInboxItem(id, decision, {note, action, snoozeDays})` — `erledigt`, `verworfen` (with reason), `zurueckgestellt` (1…90 days, default 3), `wieder_offen`. | `eingang/EingangWorkspace.tsx` | proxy + guardAdminPost | none | default | decision enum | `{item}`; 400; 404 | `wieder_offen` has no UI button. **2026-10 follow-up:** „Wieder öffnen“ in the Später / Erledigt views; `decideInboxItem` returns `{ok:false, reason:"not_found"|"db"}` — 404 only for an unknown id, 500 `internal_error` for a database problem. |
| `POST /api/admin/inbox/suggest` | POST | `generateInboxSuggestion(id)` — one AI suggestion (writer tier), re-checked against consent and objections before it is stored. | `eingang/EingangWorkspace.tsx` | proxy + guardAdminPost | none | `maxDuration = 60` | `id` | `{suggestion}`; 422 `suggest_failed` | Token-spending. **2026-10 follow-up:** audit-logged (`inbox.suggest`). |
| `POST /api/admin/inbox/accept` | POST | „Entwurf übernehmen“: `addRecipient` into the Einzelansprache with the item + suggestion as operator note (≤ 1500), draft with the suggested discount (else the campaign's), item → `erledigt` (action `einzelansprache`). | `eingang/EingangWorkspace.tsx` | proxy + guardAdminPost | none | `maxDuration = 120` | `id` | `{contactId, campaignId, drafted}`; 409 `no_consent` / `blocked`; 404 | Nothing is sent. **2026-10 follow-up:** audit-logged (`inbox.accept`). |
| `POST /api/admin/inbox/run` | POST | `runInboxSignals({suggest:false})` — „Jetzt prüfen“. | `eingang/EingangWorkspace.tsx` | proxy + guardAdminPost | none | `maxDuration = 120` | body ignored | `{candidates, created, closed, expired, outcomes, suggested}` | Manual twin of `/api/cron/inbox` without AI suggestions. |

###### 8.17 shopify (Einstellungen → Shopify-Abgleich — new 2026-10)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET /api/admin/shopify/status` | GET | `getSyncHealth`, `listSyncRuns(8)`, `getOutboxStats`, `getConsentAlignmentReport` (`alignment`), `shopifySyncFlags()` (**2026-10 follow-up:** incl. `insightsWriteback`). | no UI caller (the card renders server-side) | proxy + guardAdminGet | none | default | — | `{health, runs, outbox, alignment, flags}` | Pure DB. |
| `POST /api/admin/shopify/import` | POST | `start` → `startCustomerImport` (idempotent: returns a running import), `step` → `runCustomerImportStep` (90-s deadline; on `done` a first facts batch), `cancel` → `cancelCustomerImport`. | `einstellungen/ShopifySyncCard.tsx` (`useStepLoop`) | proxy + guardAdminPost | none | `maxDuration = 120` | `action` enum | step result; 409 `disabled` / `not_configured` / `no_db`; 502 `import_failed` | Gated by `SHOPIFY_CUSTOMER_SYNC_ENABLED`; the 5-minute cron continues a started import. |
| `POST /api/admin/shopify/outbox` | POST | `retryOutboxRow(id)` — „Erneut versuchen“ for a dead write-back. | `einstellungen/ShopifySyncCard.tsx` | proxy + guardAdminPost | none | default | `id` | `{ok}`; 404 | The cron runs it. |
| `POST /api/admin/shopify/align` | POST | Erstabgleich (Plan D-3): `queueMoOnlySubscribers` — one `customer_create` per Mo-only subscriber (subscribed, no Shopify id, real address, not hard-blocked, no open create) (`src/lib/consent-alignment.ts`). | `einstellungen/ShopifySyncCard.tsx` (after a confirm) | proxy + guardAdminPost | none | default | body ignored | `{queued}`; 409 `import_pending` until the first import is done; 500 | Sends only while `SHOPIFY_CONSENT_WRITEBACK` is on. |

---

### C.5 §2.12 routes without a caller, §2.13 duplicated routes, §2.14 contract surface (2026-09-08, with 2026-10 notes)

##### 12. Routes without any caller in this repository

Expected (external callers): all `/api/chat|contact|products|capture-email|consent-copy|tts|kpi|feedback|chat-marketing-opt-in|auth/*|account/*|attribution/token` (widget), `/api/cron/*` (Vercel), `/api/inbound/resend`, `/api/webhooks/*` (providers), `/api/unsubscribe|confirm-marketing|r/[token]|email-countdown|email-hero-image|newsletter-rating` (mail clients).

**Candidates for removal (no UI, script or doc caller found — decision needed):**
| Route | Evidence | Note |
|---|---|---|
| `POST /api/admin/bundles/list` | no `fetch` in `src/app/admin`; one doc mention | The Kunden card receives bundles server-rendered; the list endpoint is unused by the UI. |
| `POST /api/admin/marketing/draft` | no UI caller; one doc mention | Per-capture draft (old Marketing tab); the UI drafts per customer via `/api/admin/customers/marketing-draft`. |
| `POST /api/admin/qa/draft` | no UI caller, no doc mention | The Wissen tab uses `/api/admin/qa/scan`; a single-conversation draft route without a button. |
| `GET /api/admin/campaigns` (2026-10) | no `fetch` in `src/app/admin` (the Kampagnen screen renders server-side; only the POST is used) | Read twin for tooling. |
| `GET /api/admin/shopify/status` (2026-10) | no `fetch` in `src/app/admin` (Einstellungen renders server-side) | Read twin for tooling. |

##### 13. Duplicated or overlapping routes
- Four HTML e-mail preview routes (`marketing/email-preview`, `campaign/email-preview`, `correspondence/email-preview`, `email-designs/preview`) render different composers; they share the `EmailPreviewButton` client and the same fetch→blob pattern. Keep the routes; share the response helper.
- `/api/inbound/resend` and `/api/webhooks/resend` both apply delivery events (documented overlap; one or two Resend webhooks).
- `/api/admin/customers/marketing-draft` (per customer) vs `/api/admin/marketing/draft` (per capture) — the latter is the legacy path (see §12).
- `/api/admin/marketing/update|send|delete|email-preview` are shared by the Kunden Marketing sub-tab (all sends are `marketing_sends` rows).
- `/api/admin/analytics/step` and `/api/admin/improve/step` implement the same "step a long job with a claim" pattern (two client drivers); a shared `useStepLoop` hook is a refactor target.
- 2026-10, manual twins of crons (intended): `POST /api/admin/campaigns/refresh` ↔ `/api/cron/campaign-audiences` (one campaign vs. all); `POST /api/admin/inbox/run` ↔ `/api/cron/inbox` (without AI suggestions); `POST /api/admin/shopify/import` (`step`) ↔ `/api/cron/shopify-sync` (continues a started import). The former twin `POST /api/admin/campaign/sync` ↔ `/api/cron/sync-campaign-audience` is retired.
- 2026-10: `/api/admin/customers/marketing-draft` + `/api/admin/marketing/*` remain only for open drafts of the former 1:1 path; new 1:1 mails go through the Einzelansprache campaign (`campaigns/add-recipient` → `campaign/*`, Plan D-8).

##### 14. Chat API contract surface (docs/frontend/API_CONTRACT.md)
The contract covers `/api/chat` (UI-message stream parts, tools, headers `x-ms-chat-key`, `x-ms-session`, `x-ms-locale`), `/api/contact`, `/api/products`, `/api/capture-email`, `/api/chat-marketing-opt-in`, `/api/consent-copy`, `/api/feedback`, `/api/tts`, `/api/kpi`, `/api/attribution/token`, `/api/auth/*` and `/api/account/*`. The route table above was derived from the code; a line-by-line contract re-verification is scheduled for the docs slice (no widget-visible change is planned in this project, so the contract stays as is). **2026-10 (additive):** the three opt-in routes answer `status:"confirmed"`, `alreadyConfirmed:true` for an address that is already subscribed (no second DOI mail); `GET /api/consent-copy?surface=chat` carries `signIn`; `?surface=erase` is new. **2026-10 follow-up (additive):** `POST /api/chat` accepts an optional `campaignToken` (the `mo_c` value of a campaign link; „Chat-Start“, `API_CONTRACT.md` §2); the „already subscribed“ answer is given only for an address that is not suppressed.

### C.6 Generation note of part 2 (2026-09-08)

Generated 2026-09-08 against HEAD `9c6b551` (branch state: `src/lib/db.ts` modified, `docs/screenshots/` untracked).
Read-only inventory; nothing in the repo was changed. Note: the git history available in this checkout starts at
`42e09bb` (2026-08-05, 50 commits) — every "last touched" date that reads 2026-08-05 means "at or before the start of
the available history", not "written that day".

## D. Parts 3–6 — crons, scripts, environment, database

### D.1 §3 1.1 cron schedule of the baseline (five crons, 2026-09-08)

| # | Path | Cron (UTC) | Europe/Berlin (CEST / CET) | maxDuration | Route file |
|---|------|-----------|---------------------------|-------------|-----------|
| 1 | `/api/cron/refresh-customers` | `0 2 * * *` → 02:00 daily | 04:00 / 03:00 | 300 s (`route.ts:23`) | `src/app/api/cron/refresh-customers/route.ts` |
| 2 | `/api/cron/sync-campaign-audience` | `30 2 * * *` → 02:30 daily | 04:30 / 03:30 | 300 s (`route.ts:17`) | `src/app/api/cron/sync-campaign-audience/route.ts` |
| 3 | `/api/cron/sync-catalog` | `0 3 * * *` → 03:00 daily | 05:00 / 04:00 | 300 s (`route.ts:46`) | `src/app/api/cron/sync-catalog/route.ts` |
| 4 | `/api/cron/retention` | `30 3 * * *` → 03:30 daily | 05:30 / 04:30 | 60 s (`route.ts:24`) | `src/app/api/cron/retention/route.ts` |
| 5 | `/api/cron/expire-bundles` | `45 3 * * *` → 03:45 daily | 05:45 / 04:45 | 60 s (`route.ts:19`) | `src/app/api/cron/expire-bundles/route.ts` |

### D.2 §3 1.1 „Common to all five“ (2026-09-08)

Common to all five:
- **Runtime**: none of the cron routes exports `runtime`; they default to Node (they import `node:crypto` via
  `src/lib/cron-auth.ts:13`, so they cannot be Edge). All 5 export `maxDuration` (300/300/300/60/60).
- **Auth**: `requireCronAuth(req)` (`src/lib/cron-auth.ts:41-47`) → `isCronAuthorized` (`:27-34`): requires
  `Authorization: Bearer <CRON_SECRET>`; compares SHA-256 digests with `timingSafeEqual` (`:15-21`); **fails closed**
  (returns 401) when `CRON_SECRET` is unset (`:29`). Vercel Cron sends this header automatically when `CRON_SECRET` is
  set in the project. Manual trigger documented in each route header: `curl -H "Authorization: Bearer $CRON_SECRET" $URL`.
- **Methods**: each route exports both `GET` and `POST` delegating to one `handle()` ("Vercel Cron uses GET by
  default — accept both").
- **Failure envelope**: every route wraps its body in try/catch → `reportError(err, { route })` (Sentry via
  `src/lib/observability.ts`) and returns `{ ok:false, error }` with **HTTP 503**. Success is `{ ok:true, ...summary }`
  plus a `console.log("[cron/<name>] done", summary)` line. A 401/503 shows up as a failed run in the Vercel Cron log;
  there is no alerting beyond Sentry.
- **Last change** to all five route files, `cron-auth.ts` and `vercel.json`: commit `42e09bb` (2026-08-05, start of
  visible history).

### D.3 §3 1.3 the retired `/api/cron/sync-campaign-audience` (as described until 2026-10-01)

Purpose: pull Shopify's SUBSCRIBED marketing contacts into `campaign_contacts` daily so shop-side unsubscribes are
caught and marked `suppressed` (docs/CAMPAIGNS.md "Task A"). Same function as the admin "Sync" button
(`src/app/api/admin/campaign/sync/route.ts:22`).

Steps (`route.ts:19-38` → `syncCampaignAudience()` in `src/lib/campaign-sync.ts:57-116`):
1. `requireCronAuth`.
2. `isDbConfigured()` else `{ok:false, reason:"not_configured"}` → route returns **503** (`route.ts:25-28`, "visibly
   skipped rather than silently succeeding").
3. `fetchSubscribedCustomers()` (`src/lib/shopify-customers.ts`; Admin GraphQL, filter `marketingState=SUBSCRIBED`);
   `null` when Shopify env is missing → 503 as above.
4. `mapCustomerToContact` per node (`campaign-sync-core.mjs`, drops non-SUBSCRIBED / no e-mail).
5. In parallel: `listSuppressedEmails(emails)` (suppression_list + unsubscribed captures) and
   `getContactStatusesByShopifyIds(ids)` (campaign-store).
6. For each mapped contact: `planContactStatus(current, {shopifyEligible:true, locallySuppressed})` then
   `upsertCampaignContact({...contact, status})` — **sequential per-row upsert** (a few thousand HTTP round trips to
   Neon; hence maxDuration 300). An upsert error is reported and **re-thrown** (`campaign-sync.ts:95-100`) → aborts
   the run → 503.
7. `suppressContactsMissingFromSync(syncedIds)` (`src/lib/campaign-store.ts:303-319`): one `UPDATE campaign_contacts
   SET status='suppressed' WHERE status <> 'suppressed' AND NOT (shopify_customer_id = ANY(ids))`.
8. Returns `{ ok:true, total, created, updated, suppressed, byOptInLevel }`.

Failure behaviour: partial run is safe (upserts idempotent), and — as the header stresses — nothing is ever sent
without a human clicking Send; the send path re-checks suppression per recipient. **Caveat:** if step 3 returned a
truncated page set (e.g. Shopify pagination stops early but does not throw), step 7 would mark every contact that was
not in the truncated set as `suppressed`. That is conservative (never sends to them) and **self-healing**:
`planContactStatus` (`src/lib/campaign-sync-core.mjs:131-136`) moves a `suppressed` row back to `pending` on the next
sync in which it re-appears as SUBSCRIBED and is not locally suppressed — but note the row then loses its workflow
status (`sent`/`drafted` → `pending`), so a transient truncation can re-queue already-mailed contacts.

Idempotent: yes (upsert on `shopify_customer_id`; suppress step is a set operation).

### D.4 §3 1.5 retention — windows table and statement list (2026-09-08, with 2026-10 notes)

2. `retentionOptionsFromEnv()` (`src/lib/retention.ts:106-133`) — all via `parseIntEnv(name, default, min=0)`
   (`src/lib/env-num.ts:12`):

   | Env | Default | Window applies to |
   |---|---|---|
   | `RETENTION_DAYS` | 180 | conversations (+ messages cascade) by `last_activity_at` |
   | `KPI_RETENTION_DAYS` | 180 | kpi_events, ai_usage (conversation_id IS NULL), conversation_insights, kpi_persona_question_summaries, mo_orders |
   | `ABANDON_AFTER_MINUTES` | 30 | active → abandoned flip |
   | `SUPPRESSED_CAPTURE_PURGE_DAYS` | 30 | email_captures + customers on suppression_list (**2026-10:** never a Shopify customer — opting out ends the advertising, not the customer record) |
   | `CORRESPONDENCE_RETENTION_DAYS` | 365 | email_messages by `occurred_at` |
   | `PHYSICAL_LETTER_RETENTION_DAYS` | 365 | physical_letters by `created_at` |
   | `FEEDBACK_RETENTION_DAYS` | 365 (0 disables) | feedback |
   | `CUSTOMER_INACTIVITY_RETENTION_DAYS` | 1095 (0 disables) | customers with `last_seen_at` old AND `marketing_status NOT IN ('confirmed','pending')` — **2026-10:** `email_consent_state NOT IN ('subscribed','pending')` AND `shopify_customer_id IS NULL` (Shopify customers follow Shopify's own deletion) |
   | `ADMIN_ACCESS_LOG_RETENTION_DAYS` | 730 (0 disables) | admin_access_log by `occurred_at` |
   | `CAMPAIGN_CONTACT_RETENTION_DAYS` | 365 (0 disables) | campaign_sends by `sent_at`; campaign_contacts by `COALESCE(last_synced_at, created_at)` |
   | `ANALYTICS_REPORT_RETENTION_DAYS` | 365 (0 disables) | analytics_reports by `created_at` |
   | `MO_ATTRIBUTION_WINDOW_DAYS` | 30 (min 1) | mo_attribution_tokens older than window + 7 d grace. **2026-10-05:** with `MO_ATTRIBUTION_SESSION_ANCHOR` a `widget` token stays while its own session wrote a product consultation inside that horizon, capped at `attributionTokenMaxDays` = max(`KPI_RETENTION_DAYS` or 180 when 0, window + 7); response adds `keptActiveAttributionTokens` |
   | `SHOPIFY_SYNC_LOG_RETENTION_DAYS` (2026-10) | 90 (0 disables) | shopify_webhook_events, finished shopify_sync_runs (the newest `done` run per kind stays), `done`/`dead` shopify_outbox rows |
   | `INBOX_RETENTION_DAYS` (2026-10) | 180 (0 disables) | inbox_items `erledigt`/`verworfen` by `COALESCE(decided_at, updated_at)`: content (reason, evidence, suggestion, note) cleared, a marker (kind, customer, decision, dedupe key) stays so a rule cannot re-create a decided item; markers deleted after 730 days (or with the customer) |
   | `ERASURE_TOMBSTONE_RETENTION_DAYS` (2026-10) | 30 (0 disables) | erasure_tombstones whose `shopify_confirmed_at` (customers/redact) is older; unconfirmed tombstones always stay |

3. `runRetention(opts)` (`retention.ts:147-428`): throws if `getSql()` is null (→ 503). Then **19 sequential SQL
   statements**, each `WITH del AS (DELETE … RETURNING 1) SELECT count(*)` — no transaction, so a mid-run failure leaves
   earlier steps committed (acceptable: every step is independently idempotent). Order: abandon flip (`:166`), delete
   conversations (`:178`), kpi_events (`:188`), ai_usage w/o conversation (`:199`), email_captures opted-out (`:211`),
   customers on suppression list w/o remaining capture (`:232`), email_messages (`:248`), physical_letters (`:261`),
   feedback (`:276`), inactive customers (`:294`), admin_access_log (`:308`), campaign_sends + campaign_contacts
   (`:327`/`:333`), analytics_reports (`:355`), conversation_insights (`:362`), kpi_persona_question_summaries (`:368`),
   mo_orders (`:382`), mo_attribution_tokens (`:391`), `purgeExpiredPendingAuth(sql)` (`customer-oauth-store`, `:404`).
   **2026-10:** + step 7 Shopify sync bookkeeping (one statement over three tables), step 8 decided Eingang items (content cleared,
   marker kept up to 730 days) and step 9 erasure tombstones confirmed by Shopify longer than `ERASURE_TOMBSTONE_RETENTION_DAYS` ago; open outbox rows
   are never purged. Response adds `deletedShopifySyncLog`, `deletedInboxItems`, `deletedErasureTombstones`.

### D.5 §3 1.7 the `after()` row (2026-09-08)

| **Next `after()`** (post-response background work) | `src/app/admin/page.tsx:183` — `after(() => autoCaptureMissingAddresses({ limit: 12 }))` inside `KundenTab`, executed on **every render of `/admin`** (page is `force-dynamic`, `:56`, and `KundenTab` is force-mounted for every tab — the `after` fires whichever tab you open). | `src/lib/address-capture.ts:43-76`: exits unless `isShopifyConfigured()` AND `isPhysicalMailSendsApproved()`; then `listCustomersMissingAddress(12, now-7d)` → per customer `fetchLawfulAddressByEmail` (Shopify Admin API), store only `source==="purchase"`, always `markPostalAddressChecked`. | Bounded to 12 Shopify calls per page load, throttled 7 days per customer. This is the **only** `after()` in the codebase. Because `PHYSICAL_MAIL_SENDS_APPROVED` is off by default the call is currently a no-op in most environments. |

### D.6 Part 4 scripts — the table, the orphan list and the production-impact classes (2026-09-08, with 2026-10 rows)

#### 4. Scripts (`scripts/*.mjs`, 18 files)

Legend — **Prod impact**: what the script can do to shared/production state when run with production env.
"Local files only" = writes inside the repo checkout / cwd, nothing remote. Node in this sandbox: see footnote on `tsx`.

| Script | Purpose | Invocation | Required env (direct) | Prod impact | Docs reference | package.json entry |
|---|---|---|---|---|---|---|
| `analyze-repurchase.mjs` (434 l) | Repurchase-behaviour analysis over Shopify order history: repeat rate per value tier, inter-order intervals, accessory follow-up rate, decay by window. Stats live in `src/lib/repurchase-analysis.mjs`. Flags `--since`, `--max-orders`, `--page-size`, `--json <path>`, `--occasion-gap`. | `npm run analyze:repurchase [-- flags]` (`node --env-file=.env`) | `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_API_VERSION` (REQUIRED check `:97`) | **Read-only** (`orders` GraphQL queries; header `:24`). Optional local JSON of aggregates (`:405`). Uses shop API cost budget (`shopify-throttle.mjs`). | docs/REPURCHASE_ANALYSIS.md, docs/CAMPAIGNS.md | `analyze:repurchase` |
| `build-countdown-sprite.mjs` (70 l) | Pre-renders countdown glyph PNGs (digits, DE/EN labels) with `sharp` into `src/lib/generated/countdown-sprite.mjs` so `/api/email-countdown` needs no system font. | `node scripts/build-countdown-sprite.mjs` (manual; commit output) | none (needs Liberation Sans installed locally) | Local files only (`:69`) | docs/EMAIL_DESIGNS.md | **none** |
| `build-embeddings.mjs` (67 l) | Embeds `src/data/product-catalog.json` with OpenAI `text-embedding-3-small` (chunks of 100) into `src/data/product-embeddings.json` (same `buildEmbeddingDoc` as the cron). | `npm run index` (plain `node`, no `--env-file` → export `OPENAI_API_KEY` yourself) | `OPENAI_API_KEY` (`:133`) | Local file write (`:60`); **spends OpenAI credits** (~$0.001). | docs/CATALOG_SYNC.md, docs/archive/REPO_AUDIT.md (`npm run index` itself appears in no doc) | `index` |
| `convert-catalog.mjs` (573 l) | Converts the committed Shopify CSV export (`src/data/products_export_1.csv`) into `product-catalog.json` (filter: published, price>0, has image, active, not gift card). | `npm run convert-catalog` (`INPUT=`/`OUTPUT=` override) | optional `INPUT`, `OUTPUT` (`:178-183`) | Local files only (`:563`) | docs/CATALOG_SYNC.md, docs/archive/REPO_AUDIT.md, docs/archive/PRODUCT_VARIANTS_PLAN.md, docs/archive/CHANGE_REPORT_ROUND9.md | `convert-catalog` |
| `diagnose-address.mjs` (196 l) | For ONE e-mail: shows exactly what Shopify returns (defaultAddress + completed orders' shippingAddress) and what `lib/postal-address` would store. Note `:218-225`: carries a **local copy** of the completed-purchase status check because it cannot import the TS helper — drift risk vs `src/lib/shopify-orders.ts`. | `npm run diagnose:address -- someone@example.com` | `SHOPIFY_*` four vars (`:44`) | **Read-only** Shopify (customer + orders by e-mail → PII printed to the terminal); no DB. | **NONE** (only `.env.example`? no — not referenced anywhere) | `diagnose:address` |
| `gen-prompt-golden.mjs` (24 l) | Regenerates `src/lib/system-prompt-core.de.golden.txt` from the shared fixtures after an intentional German prompt change (guards `system-prompt-core.test.mjs`). | `node scripts/gen-prompt-golden.mjs` | none | Local file only | **NONE** (only mentioned in its own header + the test) | **none** |
| `hero-gradient.mjs` (18 l) | Applies the Performance-hero legibility gradient (`email-hero-gradient.mjs`) to any picture — for preparing `public/email-hero-default.jpg`. | `npm run hero:gradient -- <in> <out.png>` | none | Local files only | docs/EMAIL_DESIGNS.md | `hero:gradient` |
| `hero-quality-compare.mjs` (298 l) | Renders stored hero prompts in several variants (quality level, ±catalogue reference photos) through the production pipeline and writes a side-by-side HTML sheet to `./hero-compare*/` (git-ignored). `--dry-run` skips API calls. | `npm run hero:compare [-- --count N \| --prompts f \| --variants … \| --out dir \| --dry-run]` | `OPENAI_API_KEY` (`:71`), `DATABASE_URL` unless `--prompts` (`:91`); `ANTHROPIC_API_KEY` optional (QA check via `heroQaEnabled(process.env)`) | **DB read-only** (`SELECT … FROM campaign_contacts / marketing_sends`, `:105-113`, includes `purchase_summary` PII in memory); **spends OpenAI image + Anthropic credits** (real cost is printed); writes local files only. | docs/EMAIL_DESIGNS.md (as `npm run hero:compare`) | `hero:compare` |
| `list-test-discounts.mjs` (373 l) | Lists all Shopify discount codes minted by the app (prefix `MS5-`); `--delete` deletes them after an interactive confirmation (`discountCodeDelete`, `:235`). | `node --env-file=.env.local scripts/list-test-discounts.mjs [--delete]` (header uses `.env.local`, every other script says `.env`) | `SHOPIFY_*` four vars (`:57`) | Default read-only; **`--delete` deletes live Shopify discount codes** (`write_discounts`). A customer holding an un-redeemed MS5- code from a real marketing send would lose it. | **NONE** | **none** |
| `migrate.mjs` (136 l) | Forward-only SQL migration runner (see §4.3). | `npm run db:migrate` / `DATABASE_URL=… node scripts/migrate.mjs` | one of `DATABASE_URL_UNPOOLED`, `POSTGRES_URL_NON_POOLING`, `DATABASE_URL`, `POSTGRES_URL` (`:24-31`) | **DDL on the target DB** + `INSERT INTO _migrations` (`:126`). | docs/DATABASE.md, docs/archive/COMPLETENESS_AUDIT.md; `npm run db:migrate` in DATABASE, ADMIN_DASHBOARD, CUSTOMER_ACCOUNT, ORDER_ATTRIBUTION, GDPR_REMEDIATION_HANDOFF | `db:migrate` |
| `preview-summary-email.mjs` (53 l) | Renders the consultation-summary e-mail with 2 real catalog products to `preview-summary-email.{html,txt}` in the repo root (git-ignored). | `npx tsx scripts/preview-summary-email.mjs` — imports `../src/lib/summary-email.ts` (†) | none | Local files only | **NONE** (only `.gitignore` comment) | **none** |
| `probe-bundle.mjs` (868 l) | "THROWAWAY verification probe for S9b" (header `:2-9`): introspects the live Admin schema, **creates one disposable bundle product** (`productBundleCreate`, `productVariantsBulkUpdate`, `publishablePublish`), checks the `/cart/<variant>:1` permalink, then **archives** it (`productUpdate` → ARCHIVED). `--keep` / `KEEP_PROBE=1` skips cleanup. | `node --env-file=.env scripts/probe-bundle.mjs [--keep]` — but imports `../src/lib/shopify.ts` (†) | `KEEP_PROBE` (`:74`) + the `SHOPIFY_*` vars indirectly via `src/lib/shopify.ts` | **Writes to the live Shopify store** (creates + publishes + archives a product). Header says "Safe to delete after S9b is closed" — S9b is closed (docs/BUNDLES.md exists) → candidate for deletion. | docs/archive/BUNDLES_SPIKE.md | **none** |
| `reset-test-data.mjs` (232 l) | `TRUNCATE … RESTART IDENTITY CASCADE` of every data table; prints host/db first; completeness guard cross-checks `DATA_TABLES` against `information_schema` and **aborts** if the live DB has an unlisted table (`:150-190`). | `ALLOW_DB_RESET=true npm run db:reset` | `ALLOW_DB_RESET=true` gate (`:4`), DB URL (same 4-way fallback as migrate) | **Destroys all data in the target DB.** `_migrations` preserved. **Currently unusable against a fully-migrated DB**: `DATA_TABLES` (`:109-133`) is "current through migration 0031" (`:29`) — every table added by 0032–0055 (analytics_reports, campaign_contacts, campaign_sends, qa_entries, mo_orders, mo_attribution_tokens, improvement_runs/…, email_templates, email_design_selections, email_hero_images, …) is unlisted, so the guard exits 1. Safe failure mode, but the script is dead until the list is updated. | **NONE** (`npm run db:reset` appears in no doc) | `db:reset` |
| `send-test-emails.mjs` (169 l) | Sends one `[TEST]` e-mail of every redesigned type (summary, DOI, marketing, campaign) to a recipient through the real `sendEmail()`. | `npx tsx --env-file=.env scripts/send-test-emails.mjs [recipient]` (†) | `RESEND_API_KEY`, `CONTACT_FROM_EMAIL` indirectly via `src/lib/email.ts` (`isEmailConfigured()` check `:29`) | **Sends real e-mail via Resend** (4 messages). Recipient defaults to a hard-coded personal address (`:28`). No DB, no discount minting. | **NONE** | **none** |
| `setup-qa-metafield.mjs` (151 l) | One-shot: creates the PRODUCT metafield definition `custom.qa` (json, storefront-visible) for the "Wissen" Q&A publish path. Idempotent (`TAKEN` → exit 0). | `node --env-file=.env scripts/setup-qa-metafield.mjs` | `SHOPIFY_*` four vars (`:21-28`) | **Shopify write** (`metafieldDefinitionCreate`, needs `write_products`) — one-time setup. | **NONE** (docs/QA_KNOWLEDGE.md does not name it — verify when consolidating) | **none** |
| `verify-customer-account.mjs` (203 l) | Verify-first gate for Customer Account sign-in: discovery doc vs expected values, empirical public-client token probe, `prompt=none` probe. | `npm run verify:customer-account` | `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID`, `PUBLIC_BASE_URL`; optional `SHOPIFY_STOREFRONT_DOMAIN`, `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET` | Read-only (throwaway auth code, no sign-in completed). Hard-codes the live shop's issuer/endpoints (`:27-34`). | docs/CUSTOMER_ACCOUNT.md (as `npm run verify:customer-account`) | `verify:customer-account` |
| `check-live-widget.mjs` (2026-10-04) | Which widget build the live shop serves: storefront HTML → `ms-chat-widget.js` → string-literal marker counts, whitespace-insensitive (survive Shopify's minification) → build (`widget-fingerprint.mjs`, tested against the theme repo's commits raw and minified); head script, `/cart` CTA-hiding style, App Proxy `/apps/chat/whoami` JSON, alarm when the proxy answers a widget that cannot redeem. Exit 1 on any failed check. **2026-10-05:** markers `ms-chat-ctx-last`, `ms-chat-optin-benefits` and (negative) `Rabattaktionen zuerst erfahren`; build row `tasks-2026-10-05` (the next upload: served consent bullets, page context, token renewal — acceptable, not yet current; a half-applied build is unknown). | `npm run verify:widget` | none (public GETs; `--origin`) | Read-only, no cookies. | docs/ROLLOUT_TODO.md, docs/frontend/07 §6.4 | `verify:widget` |
| `verify-live-kpis.mjs` (2026-10-04) | Read-only live checks after a widget release: sign-in chain + per-session diagnosis + sessions stuck between succeeded and linked, popup funnel, consent events, widget-sent `account_erased`, campaign chat starts per send, contact form by reason/session, order-status outcomes; **2026-10-05:** section 7 order attribution (pre-checks P1–P6) and 7b (V0 marker rows with writer session, V3 unresolved marked orders by reason/source with all-sessionless and allowed-keys flags, V4 orders rescued by the new window, tokens older than 37 days by source); **2026-10-05:** section 8 „Shop-Login-Erkennung“ (recognitions by proof / token / already signed in / code / reason without code, redeem join with new vs renewed and refused, the latest `livecheck-manual` rows, consent popup sessions per customer in 30 days against the cap of 3); **2026-10-05 (OI1/OI3):** section 3 lists opt-ins by source / outcome / variant / placement (older rows approximated from trigger / doiStatus) and DOI confirmations by source; **2026-10-05 (A3):** section 9 „Seitenkontext auf Produktseiten“ (`page_context_applied` by kind / applied / resolved / locale / share; with `--session <sid prefix>` one session's `page_context_applied`, `page_context_answered` and `product_cta_clicked {samePage}` rows); diagnosis and popup funnel as in KPI-75/KPI-80, `livecheck-%` excluded. | `npm run verify:live` (`--since YYYY-MM-DD`, default 2026-10-04; `--session <prefix>` for section 9) | `DATABASE_URL` | SELECT only; session ids shortened, no PII. | docs/ROLLOUT_TODO.md | `verify:live` |
| `verify-pingen.mjs` (159 l) | Verifies the Pingen integration without sending: env present, client-credentials token, `GET /organisations/{id}`, `GET /file-upload`. Prints whether `PHYSICAL_MAIL_SENDS_APPROVED` is on. | `npm run verify:pingen` | `PINGEN_CLIENT_ID`, `PINGEN_CLIENT_SECRET`, `PINGEN_ORGANISATION_ID`; reads `PINGEN_STAGING`, `PINGEN_WEBHOOK_SECRET` | Read-only (`:2-4`) | **NONE** (docs mention the check conceptually? `npm run verify:pingen` not found in docs) | `verify:pingen` |
| `verify-shopify-auth.mjs` (346 l) | Verifies the Admin API client-credentials grant and scope grants (`read_products`, `read_orders`, `write_discounts` via `currentAppInstallation.accessScopes`). Full error taxonomy in header. | `npm run verify:shopify` | `SHOPIFY_*` four vars (`:29-36`) | Read-only | docs/CATALOG_SYNC.md, README.md:178 | `verify:shopify` |
| `register-shopify-webhooks.mjs` (171 l, new 2026-10) | Lists the webhook subscriptions Mo needs (catalog, orders, customers, consent, bulk import) against `<base>/api/webhooks/shopify`, checks the app's scopes (`read_inventory` for the stock webhook, `read_customers`, `write_customers`, `read_orders`, `read_all_orders`, …; a missing topic shows the scope it needs) lists the granted scopes, the count per topic (duplicates flagged) and same-topic subscriptions pointing elsewhere; with `--apply` creates the missing ones, with `--dedupe` deletes the extra copies of a topic at the endpoint (nothing else); reminds that the compliance topics are set in the app configuration. | `npm run shopify:webhooks [-- --apply] [-- --dedupe] [-- --url https://…]` | `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_API_VERSION`; `PUBLIC_BASE_URL` or `--url` | Dry run read-only; **`--apply` creates webhook subscriptions in the live store** (`webhookSubscriptionCreate`); **`--dedupe` deletes duplicate ones** (`webhookSubscriptionDelete`). | docs/CATALOG_SYNC.md, `.env.example` | `shopify:webhooks` |
| `seed-dev.mjs` (2026-10 extended) | Deterministic German demo data for a LOCAL database; since 2026-10 also the customer platform: campaigns (Lebenszyklus, Einzelansprache, Black Friday, a finished Aktion), Shopify-mirrored customers with the one consent, `customer_orders`, `customer_facts` (real core), `consent_events`, `inbox_items` (real signal rules), `shopify_sync_runs`, `shopify_webhook_events`, `shopify_outbox`. | `npm run db:seed [-- --reset]` | DB URL (same fallback chain as migrate), optional `NEON_FETCH_ENDPOINT` | Refuses non-local hosts unless `--i-know-this-is-not-production`; `--reset` TRUNCATEs the seeded tables. | docs/DATABASE.md | `db:seed` |

(†) **`tsx` is not a dependency.** `preview-summary-email.mjs`, `send-test-emails.mjs` and `probe-bundle.mjs` import
`../src/lib/*.ts` modules whose own imports are extensionless TypeScript; the first two document `npx tsx …` (which
downloads tsx ad hoc), `probe-bundle.mjs` documents plain `node --env-file=.env` (`:11-12`) which cannot resolve
`src/lib/shopify.ts`'s extensionless imports even with Node's type stripping. Neither `package.json` nor `node_modules`
contains `tsx` (checked 2026-09-08). All other scripts import only `.mjs` cores and run under plain Node.

###### 2.1 Scripts with NO package.json entry AND NO docs/README reference (orphans)

| Script | Note |
|---|---|
| `scripts/gen-prompt-golden.mjs` | Only referenced by its own header and by `src/lib/system-prompt-core.test.mjs` (check the test's comment). Legit dev tool — needs a one-liner in a CONTRIBUTING/TESTING doc, or a `npm run golden:prompt` entry. |
| `scripts/list-test-discounts.mjs` | Destructive `--delete` mode against live Shopify; undocumented; uses `.env.local` unlike every sibling. |
| `scripts/preview-summary-email.mjs` | Only `.gitignore` mentions it. Needs `tsx`. |
| `scripts/send-test-emails.mjs` | Sends real mail; hard-coded default recipient; needs `tsx`; undocumented. |
| `scripts/setup-qa-metafield.mjs` | One-time Shopify setup for the Wissen feature; should be referenced from docs/QA_KNOWLEDGE.md. |

Scripts with a package.json entry but no doc reference at all: `db:reset` (`reset-test-data.mjs`),
`diagnose:address` (`diagnose-address.mjs`), `verify:pingen` (`verify-pingen.mjs`), `convert-catalog` and `index`
(the files are named in docs/CATALOG_SYNC.md but the npm aliases are not).
Scripts referenced in docs but with no package.json entry: `build-countdown-sprite.mjs` (docs/EMAIL_DESIGNS.md),
`probe-bundle.mjs` (docs/archive/BUNDLES_SPIKE.md — historical).

###### 2.2 Scripts that touch production data (summary)

| Class | Scripts |
|---|---|
| DB DDL / destructive | `migrate.mjs` (DDL + `_migrations` insert), `reset-test-data.mjs` (TRUNCATE all; gated) |
| DB read (PII in memory) | `hero-quality-compare.mjs` |
| Shopify writes | `probe-bundle.mjs` (create/publish/archive product), `setup-qa-metafield.mjs` (metafield definition), `list-test-discounts.mjs --delete` (delete discount codes), `register-shopify-webhooks.mjs --apply` (webhook subscriptions, 2026-10) |
| Shopify reads incl. customer PII | `diagnose-address.mjs`, `analyze-repurchase.mjs` (ids only), `verify-shopify-auth.mjs`, `hero-quality-compare.mjs` (product images) |
| E-mail sends | `send-test-emails.mjs` (Resend, 4 mails to one recipient) |
| Paid AI calls | `build-embeddings.mjs` (OpenAI), `hero-quality-compare.mjs` (OpenAI images + optional Anthropic) |
| Local only | `build-countdown-sprite.mjs`, `convert-catalog.mjs`, `gen-prompt-golden.mjs`, `hero-gradient.mjs`, `preview-summary-email.mjs`, `verify-pingen.mjs`, `verify-customer-account.mjs` |

### D.7 Part 5 environment variables — method notes and the table with the 2026-09 `.env.ex` / README columns

#### 5. Environment variables

Method: `rg -oI 'process\.env\.[A-Z0-9_]+' src scripts | sort | uniq -c` **plus** the indirect readers, which the plain
grep misses and which account for ~35 of the variables: `parseIntEnv("X", default, min)` (`src/lib/env-num.ts:12`),
the cron-local `intEnv("X")` (`refresh-customers/route.ts:25`), `env("X")` (`src/lib/shopify.ts:44`, throws when
missing), `envTrim("X")` (`src/lib/shopify-customer-account.ts:48`), and the `.mjs` helpers that take
`env = process.env` as a parameter and read `env.X` (`campaign-flags.mjs`, `pingen-flag.mjs`, `ai-pricing.mjs`,
`email-hero-qa.mjs`, `email-hero-variants.mjs`, `email-countdown-token.mjs`). Scripts also check `REQUIRED` arrays via
`process.env[k]`. Total distinct names read by code: **86** (79 in `src/`, 6 script-only, 1 test-only).

**2026-10-01:** +11 names for the customer platform, all read through `src/lib/platform-flags.mjs` (`env = process.env`
parameter, tested) or `src/lib/retention-options.mjs`, all documented in `.env.example`; every switch that writes to
Shopify or widens what Mo does with personal data defaults to off / the conservative value (rows marked 2026-10).
**2026-10 follow-up:** +1 — `SHOPIFY_WRITEBACK_ENABLED` (plan D-11), in `.env.example` with `false`.
**2026-10-03 (order status in the chat):** +2 — `CHAT_ORDER_STATUS_ENABLED` (default `false`) and
`SHOPIFY_ACCOUNT_ORDERS_URL` (default the shop's account page), both in `.env.example`.
**2026-10-03 (letters as a campaign channel, 0074):** +3 — `LETTER_MIN_INTERVAL_DAYS` (60),
`CAMPAIGN_LETTER_ADDRESS_NIGHTLY` (200), `CAMPAIGN_LETTER_SHOP_URL` (empty → first allowed origin's host), all in
`.env.example`; the letter gate stays `PHYSICAL_MAIL_SENDS_APPROVED`.
**2026-10-05 (order attribution, 0076):** +1 — `MO_ATTRIBUTION_SESSION_ANCHOR` (default `false`), in `.env.example`.
**2026-10-05 (shop-login recognition, P0.3):** +2 — `APP_PROXY_SIGNIN_ENABLED` (default `false`) and
`APP_PROXY_SIGNIN_MAX_AGE_HOURS` (default `0`), both in `.env.example`.
**2026-10-05 (consent framing, page context):** +3 — `CONSENT_SIGNIN_VARIANTS` (default `a`),
`CHAT_PAGE_CONTEXT_ENABLED` (default `false`) and `CHAT_PAGE_CONTEXT_HOLDOUT_PCT` (default `0`), all in `.env.example`.

Columns: **.env.ex** = present as an active key in `.env.example` (`c` = only mentioned in a comment); **README** =
listed in README.md's env table; **Req** = R required for the feature to work at all (fail-closed / throws),
O optional with a code default, P platform-injected (Vercel/Neon/Upstash), S script/CLI-only.

| Variable | Used in | .env.ex | README | Default / fallback in code | Req | Notes |
|---|---|---|---|---|---|---|
| `ABANDON_AFTER_MINUTES` | `src/lib/retention.ts:110` | yes (30) | no | 30 (min 0) | O | retention cron |
| `ADMIN_ACCESS_LOG_RETENTION_DAYS` | `retention.ts:123` | yes (730) | no | 730; 0 disables | O | |
| `ADMIN_PASSWORD` | `src/lib/admin-auth.ts:93,153` | yes | **no** | none → admin login disabled (fails closed) | R (admin) | README claims to list "every env var the production deploy needs" but omits it |
| `ADMIN_SESSION_SECRET` | `admin-auth.ts:28` | yes | **no** | falls back to `CHAT_SHARED_SECRET` | O | |
| `ALLOWED_ORIGINS` | `src/lib/security.ts:12` | yes | yes | `https://www.motionsports.de,https://motionsports.de` (`security.ts:4-7`) | O | |
| `ALLOW_DB_RESET` | `scripts/reset-test-data.mjs:49` | no | no | must be literally `true` | S | safety gate |
| `ANALYTICS_REPORT_RETENTION_DAYS` | `retention.ts:129` | **no** | no | 365; 0 disables | O | **undocumented** |
| `APP_PROXY_SIGNIN_ENABLED` (2026-10-05) | `platform-flags.mjs` `isAppProxySigninEnabled` → `api/auth/storefront/route.ts`, `signed-in-session.ts` | yes (false) | no | false | O (kill switch) | off: whoami issues no code and answers `{signedIn:false}`, still records `account_shop_recognised`; also zeroes the shop proof. Recommended `true` once the App Proxy is configured (D-AP1) |
| `APP_PROXY_SIGNIN_MAX_AGE_HOURS` (2026-10-05) | `platform-flags.mjs` `appProxySigninMaxAgeHours` / `appProxyShopProofHours` → storefront route, `signed-in-session.ts`, `api/auth/link` | yes (0) | no | 0 (invalid → 0, clamped 720) | O | > 0: an `app_proxy` link counts as signed in without a chat token for that many hours after its last redeem (every new tab renews); effective 0 while `APP_PROXY_SIGNIN_ENABLED` is off. Recommended 24 (D-AP1, 05.10.2026) |
| `ANTHROPIC_API_KEY` | 16 sites: `analytics-report-generate.ts:321,385`, `bundle-suggestion.ts:164`, `campaign-draft.ts:418`, `conversation-analysis.ts:78`, `conversation-insights.ts:84`, `customer-profile.ts:138`, `email-hero.ts:288`, `email-hero-qa.mjs:56`, `improvement-generate.ts:131`, `kpi-top-questions.ts:174`, `marketing-draft.ts:262,485,654`, `qa-draft.ts:67`, `qa-translate.ts:61`, `summary-email.ts:85`; `/api/chat` via `@ai-sdk/anthropic` implicitly | yes | yes | none; most callers degrade to a fallback draft / `unconfigured` | R (chat) | |
| `BLOB_READ_WRITE_TOKEN` | `catalog-store.ts:57,70,207,219`, `catalog-mutate.ts:261`, `email-hero.ts:104,559`, `cron/sync-catalog/route.ts:198`, `api/email-hero-image/[file]/route.ts:39` | yes | yes | unset → bundled JSON catalog; hero generation disabled | O (P on Vercel) | |
| `BUNDLE_CREATION_MODE` | `bundle-offers.ts:56` → `resolveBundleCreationMode` (`bundle-offer-core.mjs:38`) | yes | no | `native_fixed_bundle`; unknown value → default | O | |
| `BUNDLE_EXPIRED_REDIRECT_URL` | `api/r/[token]/route.ts:39` | yes | no | `SHOP_DOMAIN` (storefront root) | O | |
| `BUNDLE_OFFER_EXPIRY_DAYS` | `bundle-offers.ts:61` | yes (7) | no | 7 | O | |
| `CAMPAIGN_ALLOW_SINGLE_OPT_IN` | `campaign-flags.mjs:50` | yes (**true**) | no | false (fail-closed; only 1/true/yes/on) | O (legal gate) | `.env.example` ships it ON |
| `CAMPAIGN_CONTACT_RETENTION_DAYS` | `retention.ts:126` | yes (365) | no | 365; 0 disables | O | 2026-10: campaign recipients by last audience refresh / creation (`last_synced_at` is refreshed by `campaign-audiences`). 2026-10-03: also `campaign_letters` by `updated_at` (counted with the recipients). |
| `CAMPAIGN_LETTER_ADDRESS_NIGHTLY` (2026-10-03) | `campaign-letter-core.mjs` `letterAddressNightly` → `campaign-letters.ts` (`nightlyLetterAddresses`, cron `campaign-audiences`) | yes (200) | no | 200; max 2000; 0 = off (only the desk's „Adressen holen“) | O | purchase addresses fetched per night for open campaign letters |
| `CAMPAIGN_LETTER_SHOP_URL` (2026-10-03) | `campaign-letter-draft.ts` `shopUrlForLetters` | yes (empty) | no | host of the first `ALLOWED_ORIGINS` entry, else `www.motionsports.de` | O | shop address the AI letter draft may name as plain text |
| `CAMPAIGN_MO_DEEPLINK_URL` | `campaign-flags.mjs:63` | yes | no | `https://motionsports.de/?mo=open&mo_new=1&mo_view=fullscreen&utm_source=campaign&utm_medium=email` | O | identical default in code and example |
| `CAMPAIGN_SENDS_APPROVED` | `campaign-flags.mjs:40` | yes (**true**) | no | false (fail-closed) | O (legal gate) | master send gate for Kampagne |
| `CHAT_ORDER_STATUS_ENABLED` (2026-10-03) | `platform-flags.mjs` `isChatOrderStatusEnabled` → `api/chat/route.ts` (`activeTools`, prompt flag, contact-form copy variant), `order-status.ts` (gate) | yes (false) | no | false (fail closed; only 1/true/yes/on) | O (widens what Mo does with personal data) | order status in the chat (`get_order_status`); off → tool withheld, prompt byte-identical. Turn on after lawyer F-32 and a silent-widget check (`ROLLOUT_TODO.md`) |
| `CHAT_ORDER_STATUS_TEST_CUSTOMERS` (2026-10-04) | `platform-flags.mjs` `chatOrderStatusTestCustomers` → `order-status.ts` `isOrderStatusTestSession` / `isOrderStatusEnabledFor` (chat route + access gate) | no (empty) | no | empty = nobody | O | Shopify customer ids (digits or GID, ≤20) for whom the order status works while the switch is off — only a Customer-Account sign-in of this session; the live check before switching it on for everyone |
| `CHAT_PAGE_CONTEXT_ENABLED` (2026-10-05) | `platform-flags.mjs` `isChatPageContextEnabled` → `api/chat/route.ts` (`planPageContext`, `page-context.mjs`) | yes (false) | no | false (only 1/true/yes/on) | O | off: a `context.source:"page"` is ignored (today's typed-turn behaviour) but still recorded as `page_context_applied {applied:false, pct:100}`. Turn on only after `npm run verify:widget` shows the page-context build (`ms-chat-ctx-last`) and 2–3 days of observation. CTA and nudge context never affected |
| `CHAT_PAGE_CONTEXT_HOLDOUT_PCT` (2026-10-05) | `page-context.ts` `pageContextHoldoutPct` → `parseHoldoutPct` (`page-context.mjs`) → `api/chat/route.ts` | yes (0) | no | 0 (invalid / negative → 0, floored, max 50) | O | share of sessions (stable per session id) whose product-page context is deliberately ignored — the control group of „Seitenkontext auf Produktseiten“; set only with the switch on and `PAGE_CONTEXT_EXPERIMENT` pre-registered; back to 0 at the target size (max ~6 weeks); collection pages never held out |
| `CHAT_SHARED_SECRET` | `security.ts:74`; fallback for `admin-auth.ts:28`, `email-capture-store.ts:347`, `email-countdown-token.mjs:14`, `shopify-customer-account.ts:92` | yes | yes | none → every `/api/chat`, `/api/contact`… request 401 | R | also the fallback signing key for 4 other secrets — rotating it invalidates admin sessions, unsubscribe links, countdown tokens and OAuth state unless the dedicated vars are set |
| `CONSENT_SIGNIN_VARIANTS` (2026-10-05) | `consent-variants.mjs` `parseActiveVariantIds` / `activeSigninVariants` / `pickSigninVariant` → `consent-copy.ts` (`signInMarketingConsentCopy`, `signInVariantsActive`) → `api/consent-copy`, `api/account/marketing-opt-in` | yes (a) | no | `a` (comma list; ids `^[a-z0-9_-]{1,32}$`; only defined and approved variants are served; empty set → `a`) | O | framing variants of the consent popup after a sign-in for an A/B test; more than one only after the widget with the served bullets is live and a second variant is approved; while > 1, `surface=signin` is `private, no-store` and assigned per `x-ms-session` |
| `CONTACT_FROM_EMAIL` | `email.ts:59`, `api/contact/route.ts:152` | yes | yes | none → `isEmailConfigured()` false → all mail (summary/DOI/marketing/campaign/correspondence) disabled | R (e-mail) | README describes it only as the contact-form sender |
| `CONTACT_TO_EMAIL` | `api/contact/route.ts:151` | yes | yes | none → contact form logs to stdout | O | |
| `CONVERSION_SWEEP_MAX_CODES` | `conversion-sweep.ts:43` | **no** | no | 25; 0 disables | O | **undocumented** (retention cron sub-step) |
| `CORRESPONDENCE_RETENTION_DAYS` | `retention.ts:114` | yes (365) | no | 365 | O | |
| `CRON_SECRET` | `cron-auth.ts:28` | yes | yes | none → all 5 crons return 401 (fail closed) | R (crons) | `.env.example:316-319` names 4 crons, omits `sync-campaign-audience` **2026-10:** nine crons (shopify-reconcile, refresh-customers, campaign-audiences, sync-catalog, retention, expire-bundles, prepare-campaign-drafts, shopify-sync, inbox); `.env.example` lists all nine. |
| `CUSTOMER_AI_PROFILE_SCOPE` (2026-10) | `platform-flags.mjs` `aiProfileScope` → `customer-profile.ts`, `customer-store.ts`, `customer-detail.ts` | yes (`consented`) | no | `consented`; only `all` widens | O (legal, Plan D-1) | `all`: profiles for people without consent are built but flagged, marketing actions stay blocked; an Art. 21 objection always wins (`mayBuildAiProfile`). The example notes the maintainer's decision `all` (lawyer to confirm) |
| `CUSTOMER_AUTH_PENDING_TTL_MINUTES` | `shopify-customer-account.ts:99` | yes (10) | no | 10 | O | |
| `CUSTOMER_INACTIVITY_RETENTION_DAYS` | `retention.ts:121` | yes (1095) | no | 1095; 0 disables | O | |
| `CUSTOMER_PROFILE_LIGHT_BATCH` (2026-10) | `platform-flags.mjs` `customerProfileLightBatch` (max 2000) → `cron/refresh-customers` | yes (0) | no | 0 = off | O | Kaufprofile per night (writer tier, ≈ $0.01 each) |
| `CUSTOMER_REFRESH_BATCH` | `cron/refresh-customers/route.ts:35` | yes (25) | no | 25 (min 1) | O | |
| `CUSTOMER_REFRESH_STALE_HOURS` | `cron/refresh-customers/route.ts:36` | yes (24) | no | 24 | O | |
| `DATABASE_URL` | `src/lib/db.ts:32`; `scripts/migrate.mjs:28`, `reset-test-data.mjs:68`, `hero-quality-compare.mjs:91,100,104` | yes | **no** | falls back to `POSTGRES_URL`; none → `getSql()` null, persistence disabled with one warning | R (everything but bare chat) (P) | README omits the DB entirely |
| `DATABASE_URL_UNPOOLED` | `scripts/migrate.mjs:26`, `reset-test-data.mjs:66` | yes | no | falls back to `POSTGRES_URL_NON_POOLING` → `DATABASE_URL` → `POSTGRES_URL` | S/P | scripts only; runtime never uses the unpooled URL |
| `EMAIL_AI_LABEL_ICON_URL` | `email-designs/performance.ts:82` | yes | no | `<base>/eu-ai-icon-email.png`; must be absolute http(s) | O | |
| `EMAIL_HERO_DEFAULT_URL` | `email-hero.ts:99` | yes | no | `<base>/email-hero-default.jpg` | O | |
| `EMAIL_HERO_IMAGE_MODEL` | `email-hero-variants.mjs:75` | yes | no | `gpt-image-2` (`:55`) | O | |
| `EMAIL_HERO_IMAGE_QUALITY` | `email-hero-variants.mjs:76` | yes | no | `high` (`:58`); values low/medium/high | O | |
| `EMAIL_HERO_QA` | `email-hero-qa.mjs:56` | yes | no | on when `ANTHROPIC_API_KEY` set; `off` disables | O | |
| `EMAIL_HERO_REFERENCES` | `email-hero.ts:378` | yes | no | on; `off` disables | O | |
| `EMAIL_LOGO_URL` | `email-template.ts:100`, `src/app/admin/EinstellungenTab.tsx:27` | **no** | no | theme logo → env → hard-coded Shopify CDN URL | O | **undocumented**; surfaced in the admin Einstellungen tab as "logoOverride" |
| `EMAIL_MO_ICON_URL` | `email-template.ts:111` | **no** | no | `<base>/moorb.gif` | O | **undocumented** |
| `ERASURE_TOMBSTONE_RETENTION_DAYS` (2026-10) | `retention-options.mjs` | yes (30) | no | 30; 0 disables | O | retention step 9 — tombstones only after Shopify confirmed the redaction |
| `FEEDBACK_RETENTION_DAYS` | `retention.ts:117` | yes (365) | no | 365; 0 disables | O | |
| `INBOUND_EMAIL_ADDRESS` | `email-inbound.ts:18` | yes | no | none → outbound mail has no Reply-To | O | |
| `INBOX_AI_DAILY_LIMIT` (2026-10) | `platform-flags.mjs` `inboxAiDailyLimit` (max 500) → `inbox-signals.ts`, `inbox-suggest.ts` | yes (0) | no | 0 = off | O | AI suggestions per Berlin day by `/api/cron/inbox`; per-item requests count towards it |
| `INBOX_RETENTION_DAYS` (2026-10) | `retention-options.mjs` | yes (180) | no | 180; 0 disables | O | decided Eingang items: content cleared, marker kept up to two years (retention step 8) |
| `INPUT` / `OUTPUT` | `scripts/convert-catalog.mjs:30-34` | no | no | `src/data/products_export_1.csv` / `src/data/product-catalog.json` | S | |
| `KEEP_PROBE` | `scripts/probe-bundle.mjs:74` | no | no | unset (= archive after probe) | S | |
| `KPI_RETENTION_DAYS` | `retention.ts:109` | yes (180) | no | 180 | O | also governs ai_usage, insights, persona summaries, mo_orders |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | `src/lib/redis.ts:24-25,60`; `rate-limit.ts:75` via `getRedis()` | yes | yes | none → `getRedis()` **throws** (`redis.ts:26-35`); `rate-limit.ts:2,75` uses the throwing variant | R (P) | `/api/chat`, `/api/products`, `/api/kpi`, `/api/tts`, `/api/feedback`, `/api/capture-email`, `/api/contact` all rate-limit → every one of them 500s without Redis. README:58 "fill in ANTHROPIC_API_KEY, OPENAI_API_KEY, CHAT_SHARED_SECRET at minimum" is therefore wrong for local dev |
| `LETTER_MIN_INTERVAL_DAYS` (2026-10-03) | `campaign-letter-core.mjs` `letterMinIntervalDays` → `campaign-letters.ts` (send gate + desk checks) | yes (60) | no | 60; 0 = no cadence check; invalid or > 3650 → 60 | O | days between two advertising letters to one person — counts every posted letter, 1:1 included |
| `MARKETING_DISCOUNT_EXPIRY_DAYS` | `shopify-discounts.ts:125` | yes (7) | no | 7 | O | |
| `MARKETING_DOI_EXPIRY_DAYS` | `email-capture-store.ts:42` | yes (7) | no | 7 | O | |
| `MARKETING_MIN_SEND_INTERVAL_DAYS` | `marketing-email.ts:122`, `campaign-email.ts:125` | yes (0) | no | 0 = disabled | O | |
| `MARKETING_ORDER_LOOKBACK_DAYS` | `shopify-orders.ts:62` | yes (180) | no | 180 | O | |
| `MODEL_PRICES_JSON` | `ai-pricing.mjs:100` | yes | yes | built-in `DEFAULT_MODEL_PRICES` | O | |
| `MO_ATTRIBUTION_SESSION_ANCHOR` (2026-10-05) | `platform-flags.mjs` `isAttributionSessionAnchorEnabled` → `mo-orders-store.ts` (`ingestShopifyOrder` window anchor, `getMoAttributionKpis` `sessionAnchor`), `retention-options.mjs` (`attributionSessionAnchor`, `attributionTokenMaxDays`) → `retention.ts` step 5i | yes (false) | no | false (only 1/true/yes/on) | O (longer token life) | widget tokens: window from the device's latest product consultation, retention keeps the token while it consults (cap `KPI_RETENTION_DAYS`). Needs migration 0076 first. Owner decision 2026-10-05 (ANWALTSDOSSIER §20, F-37) |
| `MO_ATTRIBUTION_WINDOW_DAYS` | `mo-orders-store.ts:55`, `retention.ts:131` | yes (30) | yes | 30 (min 1) | O | **2026-10-05:** days from the anchor (minting, or with `MO_ATTRIBUTION_SESSION_ANCHOR` the latest product consultation for widget tokens) |
| `NEON_FETCH_ENDPOINT` | `src/lib/db.ts:24-25` | **no** | no | unset → Neon default endpoint | O (local dev only) | **Added by the current cleanup session** (uncommitted change in `db.ts`) as the local-dev hook pointing the Neon HTTP driver at a proxy in front of plain Postgres; not yet documented in `.env.example`/README (`db.ts:21-23` points to docs/DATABASE.md "Local database" — verify that section exists when documenting). Present in this sandbox's `.env.local`. |
| `NEXT_PUBLIC_SENTRY_DSN` | `observability.ts:77` | yes | yes | none → Sentry skipped, one-time warning | O (P) | |
| `NODE_ENV` | `admin-auth.ts:166` (cookie `secure`), `observability.ts:98` | no | no | — | P | |
| `OPENAI_API_KEY` | `retrieval.ts:122`, `catalog-mutate.ts:103`, `email-hero.ts:104`, `api/tts/route.ts:143`, `cron/sync-catalog/route.ts:199`; `scripts/build-embeddings.mjs:31`, `hero-quality-compare.mjs:71` | yes | yes | none → keyword-only retrieval, no TTS, no embeddings sync, no hero images | R (retrieval quality) | README:95 mentions only embeddings, not TTS/hero images |
| `PHYSICAL_LETTER_RETENTION_DAYS` | `retention.ts:115` | yes (365) | no | 365 | O | |
| `PHYSICAL_MAIL_SENDS_APPROVED` | `pingen-flag.mjs:25` (used by `physical-mail.ts`, `customer-refresh.ts:67`, `address-capture.ts:48`, `verify-pingen.mjs`) | yes (**true**) | no | false (fail-closed) | O (legal gate) | also gates postal-address *collection*. 2026-10-03: also the campaign letters (send gate 1, `postal-address-fill.ts`, `campaign-letters.ts` — no purchase address is fetched while off) |
| `PINGEN_CLIENT_ID` / `PINGEN_CLIENT_SECRET` / `PINGEN_ORGANISATION_ID` | `pingen.ts:45,51-52,68-69`; `scripts/verify-pingen.mjs` | yes | no | none → `isPingenConfigured()` false | R (letters) | |
| `PINGEN_LETTER_COST_CENTS` | `physical-letters-store.ts:76` | yes (106) | no | 106 | O | 2026-10-03: also `campaign-letters-store.ts` `letterCostCents` — postage estimate and spent budget of campaign letters where Pingen reported no price |
| `PINGEN_STAGING` | `pingen.ts:39`; `verify-pingen.mjs:26` | yes (**true**) | no | false = production | O | `.env.example` ships staging ON. 2026-10-03: `isPingenStaging()` → Callout „Pingen-Testumgebung“ in the view „Briefe“ |
| `PINGEN_WEBHOOK_SECRET` | `api/webhooks/pingen/route.ts:24`; `verify-pingen.mjs:55` | yes | no | none → webhook 503 (fail closed); comma-separated list | R (letter status) | |
| `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` | `db.ts:32`; `migrate.mjs:27,29`; `reset-test-data.mjs:67,69` | c (comment only) | no | legacy fallbacks | P | |
| `PUBLIC_BASE_URL` | `base-url.ts:14`; `scripts/verify-customer-account.mjs:43` | yes | **no** | → `VERCEL_PROJECT_PRODUCTION_URL` → `VERCEL_URL` → request origin → `https://mo.motionsports.de` (`base-url.ts:27`; `chat.` until 2026-10-02) | R (correct links in e-mails / OAuth redirect) | README omits it; the hard-coded final fallback `chat.motionsports.de` vs the hero comment's `mo.motionsports.de` (`.env.example:471`) hints at a domain change — check which is live |
| `RESEND_API_KEY` | `email.ts:54,68`, `email-webhook.mjs:23` (placeholder), `api/contact/route.ts:150`, `api/inbound/resend/route.ts:144`, `api/admin/correspondence/message/route.ts:91` | yes | yes | none → all e-mail disabled | R (e-mail) | |
| `RESEND_EVENTS_WEBHOOK_SECRET` | `api/webhooks/resend/route.ts:23` | yes | no | falls back to `RESEND_WEBHOOK_SECRET`; none → 503 | O | new in #186 |
| `RESEND_WEBHOOK_SECRET` | `email-inbound.ts:23`, `api/webhooks/resend/route.ts:23` | yes | no | none → `/api/inbound/resend` 503 | R (inbound mail) | |
| `RETENTION_DAYS` | `retention.ts:108` | yes (180) | no | 180 | O | |
| `RETURNING_HINT_ENABLED` | `consent-copy.ts:81` | yes (true) | no | true; `0/false/no/off` disables | O | |
| `SHOPIFY_ACCOUNT_ORDERS_URL` (2026-10-03) | `order-status-core.mjs` `accountOrdersUrl` → `order-status.ts` | yes (empty) | no | `https://www.motionsports.de/account`; https only, anything else → default | O | the generic „Meine Bestellungen“ link in Mo's order status answer (`ordersPageUrl`) |
| `SHOPIFY_API_VERSION` | `shopify.ts:57,75`; 5 scripts | yes (2026-04) | yes | none → `isShopifyConfigured()` false; `env()` throws if called | R (Shopify) | |
| `SHOPIFY_APP_PROXY_SECRET` | `api/auth/storefront/route.ts:54` | **no** | no | falls back to `SHOPIFY_CLIENT_SECRET` | O | **undocumented** |
| `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` | `shopify.ts:73-74,83-84`; `api/auth/storefront/route.ts:54`; 5 scripts | yes | yes | none → Shopify disabled | R (Shopify) | 2026-10: the secret also verifies Shopify webhooks; the customer platform needs the scopes `read_customers`, `write_customers`, `read_orders`, `read_all_orders` (+ Protected Customer Data access) — checked by `npm run shopify:webhooks`. |
| `SHOPIFY_CONSENT_TEXT_VERSION` (2026-10) | `platform-flags.mjs` `shopifyConsentTextVersion` (≤ 40 chars) → `consent-store.ts` | yes (`shopify-2026-10`) | no | none (no version stamped) | O | stamped on consent acts that come from Shopify (`consent_events.text_version`) |
| `SHOPIFY_CONSENT_WRITEBACK` (2026-10) | `platform-flags.mjs` → `shopify-outbox.ts` (`consent_update`, `customer_create`), Einstellungen | yes (false) | no | false | O (writes to Shopify) | while off the outbox rows wait; turning it on flushes them |
| `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID` | `shopify-customer-account.ts:54`; `verify-customer-account.mjs:41` | yes | **no** | none → sign-in disabled | R (tier-3 sign-in) | |
| `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET` | `shopify-customer-account.ts:59`; `verify-customer-account.mjs:42` | yes | no | none = public PKCE client | O | |
| `SHOPIFY_CUSTOMER_ACCOUNT_STATE_SECRET` | `shopify-customer-account.ts:91` | yes | no | falls back to `CHAT_SHARED_SECRET` | O | |
| `SHOPIFY_CUSTOMER_SYNC_ENABLED` (2026-10) | `platform-flags.mjs` → `shopify-sync.ts` (import, reconcile), `/api/admin/shopify/import`, Kunden callout, Einstellungen | yes (false) | no | false | O | also gates the customer, consent and order-ledger webhooks (acknowledged without writing while off — `webhookNeedsCustomerSync` in `shopify-webhook.mjs`); deletions and compliance topics are always handled |
| `SHOPIFY_ERASURE_ALERT_PER_HOUR` (2026-10) | `platform-flags.mjs` `erasureAlertPerHour` → `shopify-webhook-customers.ts` | yes (20) | no | 20; 0 = no alert | O | more erasures from Shopify per hour → Sentry + Eingang item |
| `SHOPIFY_ERASURE_SYNC` (2026-10) | `platform-flags.mjs` → `shopify-outbox.ts` (`data_erasure`), `consent-copy.ts` (erase copy), Einstellungen | yes (false) | no | false | O (writes to Shopify) | an erasure in Mo asks Shopify to erase too |
| `SHOPIFY_STOREFRONT_DOMAIN` | `shopify-customer-account.ts:64`; `verify-customer-account.mjs:44` | yes | no | `www.motionsports.de` | O | |
| `SHOPIFY_STORE_DOMAIN` | `shopify.ts:51,72`; 5 scripts | yes | yes | none | R (Shopify) | |
| `SHOPIFY_SYNC_LOG_RETENTION_DAYS` (2026-10) | `retention-options.mjs` | yes (90) | no | 90; 0 disables | O | retention step 7 (webhook dedupe rows, finished sync runs, done/dead outbox rows) |
| `SHOPIFY_WEBHOOK_SECRET` | `api/webhooks/shopify/route.ts:55` | yes | **no** | none → webhook 503 (fail closed) | R (stock + order webhooks) | README's `MO_ATTRIBUTION_WINDOW_DAYS` row says orders webhooks must be registered but never lists the secret **2026-10:** no longer the only key — a signature under `SHOPIFY_CLIENT_SECRET` is accepted too (app-made subscriptions, compliance topics); 503 only when neither is set. |
| `SHOPIFY_WRITEBACK_ENABLED` (2026-10 follow-up) | `platform-flags.mjs` `isShopifyInsightsWritebackEnabled` → `shopify-insights.ts` (nightly queue), `shopify-outbox.ts` (`writeback`), `shopify-sync-flags.ts` (Einstellungen) | yes (false) | no | false | O (writes to Shopify) | Mo's `mo-…` customer tags (segment, value tier, Mo contact, high churn) via the outbox; the shop's own tags are never touched |
| `SUPPRESSED_CAPTURE_PURGE_DAYS` | `retention.ts:111` | yes (30) | no | 30 | O | |
| `TOKEN_ENC_KEY` | `token-crypto.ts:28` | yes | **no** | none → **throws** when a token must be stored (sign-in callback fails closed) | R (tier-3 sign-in) | |
| `TTS_INSTRUCTIONS` / `TTS_MODEL` / `TTS_SPEED` / `TTS_VOICE` | `api/tts/route.ts:26-29,48` | yes | no | German instruction / `gpt-4o-mini-tts` / 1.1 (clamped 0.25–4) / `coral` | O | |
| `TZ` | `admin-datetime.test.mjs`, `store-datetime.test.mjs` only | no | no | — | test-only | set by the tests themselves |
| `UNSUBSCRIBE_SECRET` | `email-capture-store.ts:347`, `email-countdown-token.mjs:14` | yes | no | falls back to `CHAT_SHARED_SECRET` | O | |
| `USD_EUR_RATE` | `ai-pricing.mjs:105` | yes (0.92) | yes | 0.92 (`:15`) | O | |
| `VERCEL_ENV` / `VERCEL_URL` / `VERCEL_PROJECT_PRODUCTION_URL` | `observability.ts:98`, `base-url.ts:17` | no | no | — | P | |

### D.8 Part 5 findings 3.a–3.c (2026-09-08, with 2026-10 notes)

###### 3.a Used in code but missing from `.env.example`

| Variable | Where | Severity |
|---|---|---|
| `ANALYTICS_REPORT_RETENTION_DAYS` | `src/lib/retention.ts:129` | medium — a GDPR-relevant retention knob that operators cannot discover |
| `CONVERSION_SWEEP_MAX_CODES` | `src/lib/conversion-sweep.ts:43` | low |
| `EMAIL_LOGO_URL` | `src/lib/email-template.ts:100`, `src/app/admin/EinstellungenTab.tsx:27` | low (shown in admin UI as an override, so it *is* user-facing) |
| `EMAIL_MO_ICON_URL` | `src/lib/email-template.ts:111` | low |
| `SHOPIFY_APP_PROXY_SECRET` | `src/app/api/auth/storefront/route.ts:54` | medium — security-relevant override; only discoverable in code |
| `NEON_FETCH_ENDPOINT` | `src/lib/db.ts:24-25` | just added by the current cleanup session (local-dev only); document alongside the local-DB setup |
| Platform / script-only (no action): `NODE_ENV`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING` (legacy, comment-only in `.env.example:394,398`), `ALLOW_DB_RESET`, `KEEP_PROBE`, `INPUT`, `OUTPUT`, `TZ` | | |

###### 3.b In `.env.example` but never read by code (stale)

| Variable | `.env.example` line | Finding |
|---|---|---|
| `SHOPIFY_CUSTOMER_ACCOUNT_API_VERSION` | 292-294 | **No reference anywhere in `src/` or `scripts/`** (`rg` = 0 hits). The comment itself says the live version is read from discovery — the var is dead. Remove. |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` (commented) | 361-367 | Documented as "consumed by the Sentry Next.js plugin for source-map upload during `next build`", but `next.config.ts` does **not** wrap with `withSentryConfig` and there are no `sentry.*.config.ts` / `instrumentation.ts` files — `@sentry/nextjs` is only `import()`ed lazily in `observability.ts:90`. No plugin runs, so these vars do nothing today; either wire the plugin or drop the paragraph. |
| `CONSENT_COPY_LAWYER_APPROVED` (referenced in comments at 142, 198) | — | Not an env var: it is a code constant `export const CONSENT_COPY_LAWYER_APPROVED = true` (`src/lib/consent-copy.ts:61`). The comments read as if it were a third env flag. |

Every other active key in `.env.example` (75 of 76) is read by code, and all numeric/string defaults shown in
`.env.example` match the code defaults (checked: DOI 7, discount 7, lookback 180, min-interval 0, refresh 25/24,
bundle 7, USD 0.92, retention 180/180/30/30/365/365/365/1095/730/365, attribution 30, pending-TTL 10, TTS model/voice/speed,
storefront domain, deep-link URL, hero model `gpt-image-2` / quality `high`, bundle mode).

###### 3.c README ↔ `.env.example` inconsistencies

1. **Scope claim.** README:87 "Every env var the production deploy needs" — the README table has 21 names; `.env.example`
   has 76 active keys and code reads 79. Missing from README but required for live features: `ADMIN_PASSWORD`,
   `DATABASE_URL`, `PUBLIC_BASE_URL`, `TOKEN_ENC_KEY`, `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID`, `SHOPIFY_WEBHOOK_SECRET`,
   `RESEND_WEBHOOK_SECRET`, `PINGEN_*`, `CAMPAIGN_SENDS_APPROVED`, `PHYSICAL_MAIL_SENDS_APPROVED`, all retention knobs,
   TTS, e-mail hero, bundle vars.
2. **Local minimum.** README:58 says `ANTHROPIC_API_KEY, OPENAI_API_KEY, CHAT_SHARED_SECRET` "at minimum", but
   `rate-limit.ts:75` → `getRedis()` throws without `KV_REST_API_URL`/`KV_REST_API_TOKEN` (README:108 itself says
   "fails fast"). The two statements contradict each other; the minimum for `/api/chat` is 5 vars.
3. **Sentry build vars.** README:140 and `.env.example:361-367` describe source-map upload that is not wired (see 3.b).
4. **CRON_SECRET description.** `.env.example:316-319` lists four cron paths; `vercel.json` has five
   (`sync-campaign-audience` missing). README:133 is generic and fine. **2026-10:** `.env.example` now lists all nine
   crons of `vercel.json`; `sync-campaign-audience` is retired.
5. **OPENAI_API_KEY purpose.** README:95 "embeds user queries + (re-)index runs"; `.env.example:4-6` adds TTS; code also
   uses it for hero-image generation (`email-hero.ts:104`) and the QA-answer embeddings in `catalog-mutate.ts:103`.
6. **RESEND_API_KEY purpose.** README:115 frames it as contact-form only; it is the transport for every e-mail channel
   and the inbound fetch (`api/inbound/resend/route.ts:144`).
7. **Flags shipped ON.** `.env.example` sets `CAMPAIGN_SENDS_APPROVED=true`, `CAMPAIGN_ALLOW_SINGLE_OPT_IN=true`,
   `PHYSICAL_MAIL_SENDS_APPROVED=true`, `PINGEN_STAGING=true`, `RETURNING_HINT_ENABLED=true`. README says `cp .env.example
   .env.local` — a developer who then adds real Resend/Pingen keys has live sends enabled by default (Pingen on staging).
   Code defaults are all false. Consider shipping the example with the gates `false`.
8. **Base URL drift.** `base-url.ts:27` hard-codes `https://chat.motionsports.de` as the final fallback and README
   (166-199) deploys to `chat.motionsports.de`, while `.env.example:471` gives `https://mo.motionsports.de/...` as an
   example asset URL. One of the two hostnames is stale. **Resolved 2026-10-02:** production runs on
   `mo.motionsports.de` only; the fallback, README and docs name it.
9. **README architecture tree** (203-230) lists 4 API routes and 12 libs; the repo has 149 route files and ~300 lib
   files. It is a 2026-Q1 snapshot; treat as historical.

### D.9 Part 6 notes (2026-09-08): tables, tests

No table created by a migration is unreferenced (the two dropped ones — bestandskunden_suppression_list, email_templates/_assignments — are gone from the schema). 68 indexes exist; index coverage of the hot admin queries is reviewed in the technical audit.

##### 6.2 Tests
87 `*.test.mjs` files, 813 tests, all green (`node --test`, 3.6 s). **2026-10-01 (`eb1816d`):** 116 files, 1016 tests, all green — new cores with tests: `audience-spec`, `campaign-def`, `consent-core`, `customer-ask-core`, `customer-facts-core`, `customer-fk-plan`, `customer-signals`, `customer-timeline`, `mo-effect`, `outbox-core`, `platform-flags`, `shopify-bulk-core`, `shopify-customer-map`; removed with their code: `campaign-sync-core.test.mjs`, `admin-overview.test.mjs`. **2026-10 follow-up (`6327b0f`):** 117 files, 1024 tests, all green — new core `shopify-insight-tags` (+ test); new cases in `admin-customer-filter` (old `?filter=` presets), `campaign-def` (chat button needs the Mo block), `campaign-review-checks` (hero mode, send window), `platform-flags` (`SHOPIFY_WRITEBACK_ENABLED`), `analytics-report-pdf` (Kundenbasis / Kampagnen chapters), `customer-timeline` (amounts through `admin-format`). No migration. Every `.mjs` core has a sibling test except: `campaign-flags.mjs`, `email-rating.mjs`, `kpi-event-patterns.mjs`, `openai-error.mjs` (and the fixtures file `system-prompt-core.fixtures.mjs`). TypeScript modules are not unit-tested (tests cannot import TS); their pure logic lives in the `.mjs` cores by convention. **2026-10-05:** new cores with tests `consent-variants`, `capture-funnel`, `page-context`; extended `consent-copy-version`, `kpi-releases`, `kpi-widget-events`, `platform-flags`, `system-prompt-core`, `widget-fingerprint`.

### D.10 §6.3 Docs map (2026-09-08)

##### 6.3 Docs map
| File | Lines | Last change | Class | Note |
|---|---|---|---|---|
| ADMIN_DASHBOARD.md | 959 | 2026-08-31 | LIVING | describes tabs/flows; partly stale (claims server-side tab switch; omits Einstellungen) — rewrite after redesign |
| API_CONTRACT.md | 1765 | 2026-08-16 | LIVING | widget contract (single source of truth) |
| CAMPAIGNS.md | 503 | 2026-09-08 | LIVING | campaign module |
| EMAIL_DESIGNS.md | 444 | 2026-09-08 | LIVING | e-mail design architecture (German) |
| BUNDLES.md, DISCOUNTS.md, CUSTOMERS.md, CUSTOMER_ACCOUNT.md, CONSENT_FLOW.md, DATA_RETENTION.md, DATABASE.md, CATALOG_SYNC.md, ORDER_ATTRIBUTION.md, IMPROVEMENT_LOOP.md, QA_KNOWLEDGE.md, PROMPT_CACHING.md | — | Aug 2026 | LIVING | feature references; light updates needed |
| REPURCHASE_ANALYSIS.md | 117 | 2026-09-01 | LIVING (reference) | cited by campaign segment logic |
| ANWALTSDOSSIER.md | 326 | 2026-08-05 | LIVING (legal) | German dossier for counsel |
| frontend-handoff/* (7 files) | — | Aug 2026 | LIVING (contracts) | frontend-handoff/API_CONTRACT.md duplicates docs/frontend/API_CONTRACT.md (1664 vs 1765 lines) |
| archive/AUDIT_BACKEND.md, archive/COMPLETENESS_AUDIT.md, archive/REPO_AUDIT.md | — | 2026-08-05 | HISTORICAL | June 2026 audits |
| archive/BUNDLES_SPIKE.md, archive/CUSTOMER_ACCOUNT_SPIKE.md, archive/EMAIL_SUBSYSTEM_SPIKE.md | — | 2026-08-05 | HISTORICAL | feasibility spikes (code comments still cite "§4/§5" of the e-mail spike) |
| archive/CATALOG_SYNC_DIAGNOSIS.md | 289 | 2026-08-05 | HISTORICAL | June 2026 incident diagnosis |
| archive/CHANGE_REPORT_10E-1.md, archive/CHANGE_REPORT_I18N_EN.md, archive/CHANGE_REPORT_ROUND9.md | — | 2026-08-05 | HISTORICAL | change reports |
| archive/CUSTOMER_ACCOUNT_THEME_NOTES.md, archive/GDPR_REMEDIATION_HANDOFF.md | — | 2026-08-05 | HISTORICAL | handoff notes |
| archive/LEGAL_READINESS_REPORT.md | 429 | 2026-08-05 | HISTORICAL | marked superseded by ANWALTSDOSSIER |
| archive/PRODUCT_VARIANTS_PLAN.md | 239 | 2026-08-16 | HISTORICAL | plan marked "implemented" |
| CLEANUP_AUDIT.md, FEATURE_INVENTORY.md | — | 2026-09-08 | PROJECT | this clean-up |
| CUSTOMER_PLATFORM_PLAN.md | 1527 | 2026-10-01 | PROJECT | customer platform design (written before the build; deviations decided during the build) |
README.md (root): deploy checklist is living; the architecture tree lists 4 routes / 12 libs (2026-Q1 snapshot) — stale.
