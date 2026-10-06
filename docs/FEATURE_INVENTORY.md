# Feature inventory — every capability with its ID

The capability checklist of Mo: everything the admin dashboard, the chat and widget API, the scheduled jobs, the
scripts and the configuration can do. Every item has a stable ID (`KUN-12`, `KAM-07`, `PLT-03`, …) or a path.
Nothing is removed from this list without an explicit decision by the maintainer (`CLAUDE.md`): a capability that
was retired stays in its row, marked **❌ abgelöst / retired / removed <date> → replacement**.

How to read it:

- **Owners.** This file lists capabilities; it does not repeat the documents that describe them
  ([`README.md`](./README.md) is the map). Screen prose, URL contract and files:
  [`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §2–§3; KPI definitions §5; admin API routes §11. What the widget
  sends and receives: [`frontend/API_CONTRACT.md`](./frontend/API_CONTRACT.md),
  [`frontend/ACCOUNT_CONTRACT.md`](./frontend/ACCOUNT_CONTRACT.md),
  [`frontend/CONSENT_CONTRACT.md`](./frontend/CONSENT_CONTRACT.md). Default and purpose of every runtime
  variable: [`.env.example`](../.env.example). Tables and columns: [`DATABASE.md`](./DATABASE.md). Retention
  windows: [`DATA_RETENTION.md`](./DATA_RETENTION.md). What is switched on, uploaded or migrated in production:
  [`ROLLOUT_TODO.md`](./ROLLOUT_TODO.md) only — here a switch is described by its default in code.
- **Markers.** „2026-10“ / „Nachtrag 2026-10“ (German parts) and „2026-10 follow-up“ (English parts) mark changes
  folded into an existing row since the customer platform; a dated „Nachtrag 2026-10-0x“ marks the later ones.
- **Files.** The „File“ column names the file where an element lives today — relative to `src/app/admin/`
  (`lib/…` = `src/lib/…`); `kampagne/*`, `kpi/*` and similar name the folder a former single file was split into.
  Line numbers are not kept.
- **Decision labels.** „Plan D-n“ = the decision table of the customer-platform plan
  ([`archive/CUSTOMER_PLATFORM_PLAN.md`](./archive/CUSTOMER_PLATFORM_PLAN.md) §4); the clean-up decisions
  D-1…D-9 = [`archive/CLEANUP_AUDIT.md`](./archive/CLEANUP_AUDIT.md) Part 5; D-AP1…D-AP4 = the plans in
  [`archive/plans-2026-10-04/`](./archive/plans-2026-10-04/README.md).
- **History.** The 2026-09-08 baseline of this list (`main` @ `9c6b551`) — its `File:line` values, the audit
  findings of that pass, the baseline screen descriptions and the dated notes that used to open this file — is in
  [`archive/FEATURE_INVENTORY_AUDIT_2026-09.md`](./archive/FEATURE_INVENTORY_AUDIT_2026-09.md). The Phase-3
  verification log of the clean-up (2026-09-09 … 2026-10-03) is
  [`archive/FEATURE_INVENTORY_STATUS.md`](./archive/FEATURE_INVENTORY_STATUS.md); its after-screenshots are in
  [`screenshots/after/`](./screenshots/after/).

Language: the admin part quotes the German UI labels and is written in German (it mirrors the screens the team
uses); the other parts are in English like the rest of `docs/`.

## Changes since the baseline

| Date | What changed | Migration | Rows |
|---|---|---|---|
| 2026-09-08 | Baseline inventory of the clean-up (`main` @ `9c6b551`) | – | all parts |
| 2026-09-09 | Clean-up Phase 3 complete: every item verified, or removed / merged with approval (D-1…D-9) | – | log in `archive/FEATURE_INVENTORY_STATUS.md` |
| 2026-10-01 | Customer platform (`main` @ `943a313`): Eingang, the Shopify customer mirror with order ledger and nightly facts, the one consent, many campaigns, one erasure | 0061–0068 | `EIG-…`, `KUN-113…132`, `KAM-96…106`, `KPI-71…`, `EIN-07…11`, `GES-43`; parts 2–6 |
| 2026-10-01 | Follow-up (`6327b0f` … `b55f248`): „Zur Kampagne…“, „Ähnliche Kunden“, Analyse chapters, Mo's insight tags in Shopify; hand-added recipients stay in a dynamic campaign | 0069 | `KUN-133`, `KUN-134`, `ANA-15`, `EIN-12` |
| 2026-10-02 | „E-Mails im Eingang“: every incoming mail of a known person opens „E-Mail beantworten“ with an AI reply draft; the contact form lands in the Eingang | – | `EIG-14…18` |
| 2026-10-03 | „Unzufrieden“ dated by the refund itself; a typed e-mail never signs a session in (`link_kind`) | 0070, 0071 | `EIG-13`, §6.1 |
| 2026-10-03 | „Einplanen“ (approve now, the release job sends later) and „Prüfen & testen“ (sample mails, plan estimate) | 0072 | `KAM-107…113`, §2.8, §3 1.12, §5 |
| 2026-10-03 | One-time sign-in code: a session is linked only through a redeemed code | 0073 | §2.3, `KPI-47`, `KPI-75` |
| 2026-10-03 | Order status in the chat | – | `PLT-01`, `GES-26`, `KPI-81` |
| 2026-10-03 | Letters as a campaign channel | 0074 | `PLT-02`, `KAM-114…120`, `KUN-135`, `KPI-52` |
| 2026-10-04 | Live check after the widget upload: release notes in the KPI tab, sign-in diagnosis, contact-form split; `/api/kpi` stores no server-only names, „Chat gestartet“ once per send, test sends included | 0075 | `KPI-09`, `KPI-13`, `KPI-47`, `KPI-79…81`, §2.1, §4 (`verify:widget`, `verify:live`) |
| 2026-10-05 | Order attribution: window from the latest consultation; unresolved marked orders counted | 0076 | `PLT-04`, `KPI-33`, `KPI-82` |
| 2026-10-05 | Shop-login recognition (App Proxy) | – | `PLT-03`, `KPI-80`, `KPI-83`, `KPI-84` |
| 2026-10-05 | Served consent benefits and sign-in variants (copy `v5`); page context on product pages; opt-in source and outcome | – | `PLT-05…07`, `KPI-22…29`, `KPI-85…87` |
| 2026-10-05 | No e-mail-summary offer for signed-in customers | – | `PLT-08`, `KPI-79` |
| 2026-10-06 | Widget build `bc7fb5d` (the 2026-10-05 tasks) is the expected build of `verify:widget`; three KPI releases for its served consent bullets with variant/placement, page context on typed turns and attribution-token renewal/blanking; `verify:live --session` also lists a session's consent rows | – | `PLT-04…06`, `KPI-79`, `KPI-85`, `KPI-87`, §4 (`verify:widget`, `verify:live`) |

Contents
0. Chat and platform capabilities (IDs `PLT-…`)
1. Admin dashboard — every screen, control, helper text and persisted state
2. HTTP API routes — one line per route, guard and rate limit
3. Cron jobs and background work
4. Scripts
5. Environment variables
6. Database and tests

---

# 0. Chat and platform capabilities

Capabilities of the chat, the sign-in and the measurement that have no screen of their own (since 2026-10-03). One
row each: what it does, its switch with the default in code, where it shows up in this inventory, and the documents
that own the details.

| ID | Capability | Switch (default in code) | Rows here | Owner docs |
|---|---|---|---|---|
| PLT-01 | **Order status in the chat** (2026-10-03). A customer signed in via the Customer Account in this chat session asks Mo about their own orders; tool `get_order_status` reads the order ledger plus a short live Admin read of the session's Shopify customer; the model never sees order numbers, amounts, tracking, addresses or ids. While off, the tool is withheld and the prompt is unchanged. | `CHAT_ORDER_STATUS_ENABLED` (off); `CHAT_ORDER_STATUS_TEST_CUSTOMERS` (empty) enables it for listed test customers; `SHOPIFY_ACCOUNT_ORDERS_URL` | §2.1 `POST /api/chat`, `GES-26`, `KPI-81`, §5 | [`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §8 „Order status in the chat“; [`frontend/API_CONTRACT.md`](./frontend/API_CONTRACT.md) §2; [`frontend/ACCOUNT_CONTRACT.md`](./frontend/ACCOUNT_CONTRACT.md) §3a / §5; [`ANWALTSDOSSIER.md`](./ANWALTSDOSSIER.md) §16 (F-32). Code: `lib/order-status.ts`, `lib/order-status-core.mjs` |
| PLT-02 | **Letters as a campaign channel** (2026-10-03, migration 0074). A campaign can also write advertising letters (Pingen) to its audience: mode „Keine Briefe“ (default) / „An alle ohne E-Mail-Einwilligung“ / „An alle (auch mit Einwilligung)“, postage budget, only the shipping address of the latest completed order, AI draft, release per letter, every gate again per letter at send. | `PHYSICAL_MAIL_SENDS_APPROVED` (off — no letter, no address collection); `LETTER_MIN_INTERVAL_DAYS` (60), `CAMPAIGN_LETTER_ADDRESS_NIGHTLY` (200), `CAMPAIGN_LETTER_SHOP_URL` | `KAM-114…120`, `KUN-135`, `KPI-52`; §2.8 (`campaigns/letters`, `campaigns/letters/preview`, `customers/letter-address`); §3 1.9; §6 (`campaign_letters`) | [`CAMPAIGNS.md`](./CAMPAIGNS.md) §8; [`ANWALTSDOSSIER.md`](./ANWALTSDOSSIER.md) §18 (F-35). Code: `lib/campaign-letters.ts`, `lib/campaign-letter-core.mjs` |
| PLT-03 | **Shop-login recognition (App Proxy)** (2026-10-05). A customer signed in to the shop is recognised in the chat without „Anmelden“: whoami (`GET /api/auth/storefront`, alias `…/whoami`) issues a one-time code only for a fresh signature (±300 s) and only when the session will really be signed in (handover on a shared browser); one resolver (`lib/signed-in-session.ts`) behind `/api/auth/me`, `/api/account/*` and Mo's memory accepts a chat token or a fresh shop proof; order status stays Customer-Account-only; the consent popup has a per-customer anti-nag; every recognised request records the server-only `account_shop_recognised`. | `APP_PROXY_SIGNIN_ENABLED` (off: no code, no shop proof); `APP_PROXY_SIGNIN_MAX_AGE_HOURS` (0) | §2.3, §2.9, `KPI-80`, `KPI-83`, `KPI-84`, §4 `verify:live` section 8, §5 | [`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §2 „Already-signed-in detection“; [`frontend/ACCOUNT_CONTRACT.md`](./frontend/ACCOUNT_CONTRACT.md) §3a; [`ANWALTSDOSSIER.md`](./ANWALTSDOSSIER.md) §19 (F-36). Code: `lib/shopify-app-proxy.mjs`, `lib/signed-in-proof.mjs` |
| PLT-04 | **Attribution window from the latest consultation** (2026-10-05, migration 0076). A widget token's window counts from the device's latest product consultation (`messages.session_id` on tool-marker rows) instead of the minting; retention keeps such a token while the device keeps consulting (cap `KPI_RETENTION_DAYS` after minting). Independent of the switch: marked orders that cannot be attributed are counted as the server-only `mo_order_marker_unresolved`. Widget side (theme `bc7fb5d`, 2026-10-06; release `attribution-token-renewal`): one token renewal per page view after a finished live consultation, so a token the backend deleted is replaced; the `_mo` marker is blanked on sign-out, erase, a server-ended sign-in and withdrawn analytics consent. | `MO_ATTRIBUTION_SESSION_ANCHOR` (off: window from the minting); `MO_ATTRIBUTION_WINDOW_DAYS` (30) | §2.4, §2.11, `KPI-33`, `KPI-82`, §3 1.5, §4 `verify:live` section 7, §5, §6.1 (0076) | [`ORDER_ATTRIBUTION.md`](./ORDER_ATTRIBUTION.md); [`frontend/API_CONTRACT.md`](./frontend/API_CONTRACT.md) §10; [`ANWALTSDOSSIER.md`](./ANWALTSDOSSIER.md) §20 (F-37) |
| PLT-05 | **Served consent benefits and sign-in variants** (2026-10-05, copy version `v5`). `GET /api/consent-copy?surface=signin` serves `benefits` (three bullets, wording decided by the owner, D-AP4; EN as the approved translation, D-AP3) and `variant`; with more than one variant listed, the variant is assigned per session and the copy is sent `private, no-store`; the sign-in opt-in records `placement` / `variant` (telemetry only). Widget side (theme `bc7fb5d`, 2026-10-06; release `consent-benefits-served`): popup and card render the served bullets (no own bullets) and echo `variant` and `placement` (`popup` \| `signin_return`) in the `consent_gate_*` events and the opt-in POST. | `CONSENT_SIGNIN_VARIANTS` (`a`) | §2.1 `GET /api/consent-copy`, §2.2 `POST /api/account/marketing-opt-in`, `KPI-87`, §5 | [`CONSENT_FLOW.md`](./CONSENT_FLOW.md) „At-sign-in marketing opt-in“; [`frontend/API_CONTRACT.md`](./frontend/API_CONTRACT.md) §7.4; [`frontend/CONSENT_CONTRACT.md`](./frontend/CONSENT_CONTRACT.md) §3.1; [`ANWALTSDOSSIER.md`](./ANWALTSDOSSIER.md) §21 (F-38). Code: `lib/consent-variants.mjs` |
| PLT-06 | **Page context on typed product-page messages** (2026-10-05). `POST /api/chat` takes `context.source` (`page` \| `cta` \| `nudge`); a `page` context on a typed turn (the product, or exactly one category) gets a softer page note, with an optional control group on product pages; server-only `page_context_applied` / `page_context_answered`. Other sources: unchanged path. Widget side (theme `bc7fb5d`, 2026-10-06; release `page-context-typed`): the first typed or spoken message of a thread on a product or collection page, and the first after the page changed, carries `source: "page"`; CTA and nudge contexts carry `cta` / `nudge`, product clicks `samePage`. | `CHAT_PAGE_CONTEXT_ENABLED` (off: a `page` context is ignored); `CHAT_PAGE_CONTEXT_HOLDOUT_PCT` (0, max 50) | §2.1 `POST /api/chat` / `POST /api/kpi`, `KPI-85`, `KPI-86`, §4 `verify:live` section 9, §5 | [`frontend/API_CONTRACT.md`](./frontend/API_CONTRACT.md) §2 (`context`); [`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §5.1a; [`ANWALTSDOSSIER.md`](./ANWALTSDOSSIER.md) §21 (F-38). Code: `lib/page-context.mjs`, `lib/page-context.ts` |
| PLT-07 | **Opt-in source and outcome** (2026-10-05). The KPI events of the three opt-in routes carry `source` (`mo_capture_form` \| `mo_chat_gate` \| `mo_signin`) and `outcome` (`doi_required` \| `already_confirmed` \| `already_subscribed` \| `suppressed`), the DOI confirmation its `source`; a suppressed address is answered `status: "none"`, `alreadyConfirmed: false`, never „already subscribed“; the capture funnel counts the form only, the consent section counts sessions; release `optin-measurement`. | – (always on) | §2.1 capture / chat-gate / confirm rows, §2.2 opt-in row, `KPI-22…29`, `KPI-79` | [`frontend/API_CONTRACT.md`](./frontend/API_CONTRACT.md) §5 / §7; [`CONSENT_FLOW.md`](./CONSENT_FLOW.md) „Measurement“; [`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §5.7–§5.8. Code: `lib/capture-funnel.mjs` |
| PLT-08 | **No e-mail-summary offer for signed-in customers** (2026-10-05). For a session that resolves as signed in, `/api/chat` withholds `offer_email_summary` and never forces the end-of-chat ask; a failed sign-in lookup keeps the offer (fail-open); the signed-in customer gets the summary as a download (`GET /api/account/summary`). Release `signedin-offer-off`. | – | §2.1 `POST /api/chat`, §2.2, `KPI-79` | [`frontend/ACCOUNT_CONTRACT.md`](./frontend/ACCOUNT_CONTRACT.md) §6.0 / §8 |

---

# 1. Admin dashboard

Stand: Basis 2026-09-08, fortgeschrieben bis 2026-10-06 · Zweck: Vollständiges Inventar aller Bedienelemente, Anzeigen, Hilfetexte, persistierten Zustände und Datenflüsse des deutschsprachigen Admin-Dashboards, damit nach dem Redesign verifiziert werden kann, dass nichts verloren ging.

Konventionen:
- IDs sind pro Tab sequenziell und stabil (SHL = Shell/global, LOG = Login, UEB = Übersicht (abgelöst), EIG = Eingang (seit 2026-10), KUN = Kunden, KAM = Kampagne(n), KPI = KPIs, FEE = Feedback, GES = Gespräche, WIS = Wissen, ANA = Analyse, VER = Verbesserung, EIN = Einstellungen).
- "Calls": API-Route (`POST /api/admin/...`), Server Action, `server-render` (Daten kommen aus der Server-Komponente) oder `client-only` (nur lokaler State).
- Alle Pfade relativ zu `src/app/admin/` sofern nicht anders angegeben (`lib/…` = `src/lib/…`). Die Spalte „File“ nennt die Datei, in der das Element heute liegt — bei aufgeteilten Komponenten den Ordner (`kampagne/*`, `kpi/*`, …); ohne Zeilennummern. Die Werte vom 2026-09-08 stehen im Archiv ([`archive/FEATURE_INVENTORY_AUDIT_2026-09.md`](./archive/FEATURE_INVENTORY_AUDIT_2026-09.md) §B.5).
- "Hilfetext" = jeder erklärende Untertitel, Caption, Hinweis-Absatz, Placeholder mit Erklärcharakter, Tooltip/`title`, Leer-/Fehlerzustand mit Informationsgehalt.

---

## 0. Globale Shell (`page.tsx`, `AdminShell.tsx`, `layout.tsx`, `ThemeToggle.tsx`, `theme-config.ts`)

### Beschreibung
Bildschirm-Beschreibung: [`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §2.1 (ein Bildschirm pro Anfrage, Seitenleiste, Tastenkürzel) und §2.2 (URL-Vertrag). Die Beschreibung vom 2026-09-08 (Client-Tab-Wechsel mit `forceMount`, Datenladen des Kunden-Tabs, Adress-Autoerfassung per `after()` bei jedem Seitenaufruf) steht im Archiv ([`archive/FEATURE_INVENTORY_AUDIT_2026-09.md`](./archive/FEATURE_INVENTORY_AUDIT_2026-09.md) §B.1).

**Stand 2026-10-01 (Kundenplattform):** `page.tsx` rendert genau einen Bildschirm (`renderScreen`). Erster Bildschirm ist der **Eingang** (`/admin` = `?tab=eingang`, Taste `1`, Abschnitt 2a); die Übersicht ist abgelöst (Abschnitt 2). Der Tab „Kampagne“ heißt „Kampagnen“ (Key bleibt `kampagne`). Tab-Registry `src/lib/admin-tabs.mjs`: Aliase `overview`→`eingang`, `customers`/`marketing`→`kunden`, `kampagnen`→`kampagne`; unbekannte Werte → Eingang. Seitenleisten-Badges (`loadBadges`): Eingang = offene Hinweise mit Priorität ≥ 80 (`getInboxCounts`), Kampagnen = Entwürfe über alle aktiven Kampagnen (`getCampaignQueueTotals`), Wissen = offene Fragen; das frühere Kunden-Badge (nicht zugeordnete Mails, `countUnmatchedInbound`) entfällt — die Mails stehen als Karte im Eingang (EIG-12). Neue URL-Parameter: Eingang `?item=`, `?status=`; Kunden `?kq= ?kview= ?kmo= ?kconsent= ?kseg= ?kvalue= ?kpersona= ?kshop= ?kchurn= ?ksort= ?kpage=`; Kampagnen `?campaign=`, `?edit=`. **Nachtrag 2026-10:** `countUnmatchedInbound` ist zurück (`email-messages-store.ts`) und zählt jetzt im **Eingang**-Badge mit (Priorität ≥ 80 + nicht zugeordnete Mails); `getInboxCounts` schreibt nicht mehr (fällige Zurückstellungen zählen als offen). Neu `?edit=new&audience=<json>` (Kampagnen); alte Kunden-`?filter=`-Presets landen auf einer Ansicht (SHL-14).

### Controls & actions
| ID | Element | Type | What it does | Calls | File |
|---|---|---|---|---|---|
| SHL-01 | „Admin-Dashboard" | display (h1) | Seitentitel. **2026-09 (Redesign):** das h1 der oberen Leiste ist der Name des Bildschirms (`meta.label`); „Admin-Dashboard“ entfällt | client-only | AdminShell.tsx |
| SHL-02 | Tab-Untertitel (TAB_SUBTITLE) | display | Wechselnder Untertitel je aktivem Tab (10 Texte, siehe Hilfetexte). **2026-09 (Redesign):** als InfoTip „Was ist „<Name>“?“ neben dem Titel; Text = `description` in `lib/admin-tabs.mjs` | client-only | lib/admin-tabs.mjs (`description`), AdminShell.tsx |
| SHL-03 | Theme-Toggle (Sonne/Mond-Icon) | toggle (button) | Schaltet Light/Dark, setzt Cookie `ms_admin_theme` (path=/admin, 1 Jahr, SameSite=Lax), togglet `.dark` auf `#admin-root`; aria-label „Dunkles Design aktivieren"/„Helles Design aktivieren", title „Dunkles Design"/„Helles Design" | client-only (Cookie) | ThemeToggle.tsx |
| SHL-04 | „Abmelden" | button (form submit) | Server Action `logoutAction`: löscht Admin-Cookie (`ADMIN_COOKIE_NAME`), redirect `/admin/login` | Server Action `logoutAction` | AdminShell.tsx, page.tsx |
| SHL-05 | Tab-Leiste (10 Tabs: Übersicht, Kunden, Kampagne, KPIs, Feedback, Gespräche, Wissen, Analyse, Verbesserung, Einstellungen) | sub-tab (role=tablist) | Wechselt den sichtbaren Body; URL wird per `replaceState` auf `/admin` (Übersicht) bzw. `/admin?tab=<id>` gesetzt. Deferred Tabs (Übersicht/KPI wenn nicht initial gerendert) → `window.location.assign`. **2026-10:** Eingang statt Übersicht, Label „Kampagnen“, Badges Eingang/Kampagnen/Wissen (s. Stand oben). **Nachtrag 2026-10:** Eingang-Badge = offene Hinweise mit Priorität ≥ 80 (fällige Zurückstellungen zählen als offen, der Badge-Pfad schreibt nichts) **plus** nicht zugeordnete eingehende Mails (`countUnmatchedInbound`). **Nachtrag 2026-10:** ein Bildschirm pro Anfrage — jeder Wechsel ist eine Navigation per `next/link` (`forceMount` und die deferred-Ausnahme entfallen); gruppierte Seitenleiste Arbeit · Einblicke · System (ADMIN_DASHBOARD §2.1) | client-only / Navigation | AdminShell.tsx |
| SHL-06 | Tastenkürzel `1`–`9`, `0` | keyboard shortcut | Springt zum n-ten Bildschirm. Ignoriert, wenn Fokus in INPUT/TEXTAREA/SELECT/contentEditable oder Modifier gedrückt. Stand 2026-09-08: nur `^[1-9]$` (1=Übersicht … 9=Verbesserung, Einstellungen per Ziffer nicht erreichbar). **🔁 2026-10:** `0` = Einstellungen (die Shell prüft `^[0-9]$`); Reihenfolge 1 Eingang · 2 Kampagnen · 3 Kunden · 4 Wissen · 5 KPIs · 6 Gespräche · 7 Feedback · 8 Analyse · 9 Verbesserung · 0 Einstellungen | client-only | AdminShell.tsx, lib/admin-tabs.mjs (`shortcut`) |
| SHL-07 | Tastenkürzel `/` | keyboard shortcut | Wechselt zu Kunden und fokussiert die Suchbox `#ms-search` | client-only | AdminShell.tsx |
| SHL-08 | Container-Breite | layout | Kunden/Kampagne/Gespräche/Analyse/Verbesserung: `max-w-7xl`; sonst `max-w-5xl` | client-only | AdminShell.tsx |
| SHL-09 | Toaster (unten rechts, „Benachrichtigungen") | display (toast stack) | Zeigt `toast()`-Meldungen aller Tabs; Varianten default/success/warning/error/info; auto-dismiss 4 s (0 = pinned), Schließen-X pro Toast, `toast.update` für Live-Fortschritt | client-only | ui/toast.tsx, AdminShell.tsx |
| SHL-10 | Theme-Init-Script | script | Render-blockend: Cookie → `.dark`, sonst `prefers-color-scheme` | client-only | theme-config.ts, layout.tsx |
| SHL-11 | Kunden-Tab Banner „Keine Datenbank konfiguriert (DATABASE_URL) — es können keine Kunden geladen werden." | display (warn banner) | Zustand ohne DB | server-render | KundenTab.tsx, kunden/KundenWorkspace.tsx |
| SHL-12 | Kunden-Tab Banner „Noch keine Kunden. …" | display (info banner) | Leerzustand Kundenliste | server-render | KundenTab.tsx, kunden/KundenWorkspace.tsx |
| SHL-13 | URL-Param `?tab=` (inkl. Legacy `customers`) | URL param | Initialer Tab. **2026-10:** Default `eingang`; Aliase `overview`, `customers`, `marketing`, `kampagnen` (`parseAdminTab`) | server-render | page.tsx |
| SHL-14 | URL-Param `?filter=` / legacy `?status=` | URL param | Kunden-Filter-Preset (`no_purchase`, `marketing`, `draft`). **❌ abgelöst 2026-10:** die Kunden-Liste liest `?filter=`/`?status=` nicht mehr (alte Links öffnen die ungefilterte Liste) → Ansichten `?kview=` und die `k*`-Parameter (KUN-115…118); `?status=` ist jetzt der Eingang-Status (EIG-03). **Nachtrag 2026-10:** ohne `?kview=` landen die zwei alten Presets auf der nächsten Ansicht — `filter=marketing` → „Mit Einwilligung“, `filter=no_purchase` → „Mit Einwilligung“ + Lebenszyklus „Ohne Bestellung“ (`parseCustomerFilter`, getestet); `draft` und andere Werte werden ignoriert | server-render | KundenTab.tsx, lib/admin-customer-filter.mjs |
| SHL-15 | URL-Params `?kpiRange`, `?kpiFrom`, `?kpiTo` | URL param | KPI-Zeitraum | server-render | page.tsx |
| SHL-16 | URL-Params `grange,gfrom,gto,gtier,gerr,gcat,gqual,gq,gpage` | URL param | Gespräche-Filter/Seite | server-render | page.tsx |

### Helper/explanatory text (Shell) — 12
1. „Übersicht · Kennzahlen & Schnellzugriff auf einen Blick" — lib/admin-tabs.mjs (`description`)
2. „Kunden · Suche, filtere & öffne eine Person — Profil, Käufe, Marketing, Korrespondenz & Brief" — lib/admin-tabs.mjs (`description`)
3. „Kampagne · Personalisierte E-Mails an Shopify-Marketing-Abonnent:innen — prüfen, anpassen, senden" — lib/admin-tabs.mjs (`description`)
4. „KPIs · Pseudonyme Analytics (Cluster A) + Shopify-Käufe" — lib/admin-tabs.mjs (`description`)
5. „Feedback · Kund:innen-Rückmeldungen aus dem Widget — neueste zuerst" — lib/admin-tabs.mjs (`description`)
6. „Gespräche · Alle Beratungen einsehen & auswerten — Transkripte, Signale, KI-Analyse" — lib/admin-tabs.mjs (`description`)
7. „Wissen · Offene Kundenfragen aus Beratungen beantworten & als Q&A veröffentlichen — für Produktseite & Mo" — lib/admin-tabs.mjs (`description`)
8. „Analyse · Komplettanalysen je Zeitintervall — alle KI-Auswertungen verdichtet, gespeichert & als PDF" — lib/admin-tabs.mjs (`description`)
9. „Verbesserung · Mo analysiert die Komplettanalyse & schlägt Verbesserungen vor — für den Shop & für sich selbst" — lib/admin-tabs.mjs (`description`)
10. „Einstellungen · E-Mail-Designs auswählen & je E-Mail-Typ aktivieren — neue Designs entstehen mit Claude Code" — lib/admin-tabs.mjs (`description`)
11. „Keine Datenbank konfiguriert (DATABASE_URL) — es können keine Kunden geladen werden." — KundenTab.tsx
12. „Noch keine Kunden. Ein Kunde entsteht, sobald jemand im Chat seine E-Mail-Adresse (mit Einwilligung) hinterlässt — anonyme Sessions bleiben unverknüpft." — KundenTab.tsx

Stand 2026-10-01 (`admin-tabs.mjs` `description`): Nr. 1 → „Eingang · Wer braucht uns heute, warum und was ist der beste nächste Schritt — Kundensignale, offene Antworten und Systemhinweise.“; Nr. 3 → „Kampagnen · Kampagnen planen und personalisierte E-Mails an Kund:innen mit Einwilligung prüfen, anpassen, senden.“

### Persistenter Zustand (Shell)
- URL: `?tab=` (jeder Bildschirmwechsel ist eine Navigation, ADMIN_DASHBOARD §2.2), plus alle oben genannten Tab-spezifischen Params.
- Cookie `ms_admin_theme` (light|dark; path=/admin; max-age 1 Jahr) — ThemeToggle.tsx, theme-config.ts.
- Cookie Admin-Session (`ADMIN_COOKIE_NAME`, HTTP-only, aus `@/lib/admin-auth`) — page.tsx, login/page.tsx.
- Kein localStorage in der Shell.

---

## 1. Login (`login/page.tsx`)

### Beschreibung
Einzige unauthentifizierte Admin-Seite. Server Component mit Server Action `loginAction`: prüft `password` aus FormData via `isAdminPasswordValid`, erzeugt Session-Token via `createAdminSessionToken`, setzt Cookie `ADMIN_COOKIE_NAME` mit `sessionCookieOptions()`, redirect `/admin` (bzw. `?next=`). Bei Fehler redirect `/admin/login?error=invalid` bzw. `?error=config`. **2026-09 (D-7):** höchstens 10 Versuche je 10 Minuten und IP (Bucket `admin-login`, `checkRateLimitKeyed`), sonst `?error=ratelimited`; ohne KV oder bei einem Limiter-Fehler läuft der Login weiter (fail-open, Fehler wird gemeldet). `?next=` (nur Pfade unter `/admin`) führt nach dem Login zurück zum vorherigen Bildschirm. `isAdminAuthConfigured()` steuert eine Warnung, wenn ADMIN_PASSWORD/ADMIN_SESSION_SECRET fehlen.

### Controls & actions
| ID | Element | Type | What it does | Calls | File |
|---|---|---|---|---|---|
| LOG-01 | „motion sports — Admin" (**2026-09:** „motion sports“ mit Logo „M“) | display (CardTitle) | Titel | server-render | login/page.tsx |
| LOG-02 | „Marketing-Dashboard. Bitte anmelden." (**2026-09:** „Admin · Mo — bitte anmelden.“) | display (CardDescription) | Untertitel | server-render | login/page.tsx |
| LOG-03 | Warn-Box „ADMIN_PASSWORD / ADMIN_SESSION_SECRET sind nicht gesetzt — Login ist deaktiviert." | display (warning) | Nur wenn `!configured` | server-render | login/page.tsx |
| LOG-04 | Fehler-Box („Falsches Passwort." / „Server nicht konfiguriert (ADMIN_SESSION_SECRET fehlt)." / **2026-09 (D-7):** „Zu viele Anmeldeversuche — bitte in zehn Minuten erneut versuchen.“) | display (error) | Aus `?error=invalid\|config\|ratelimited` | server-render (URL) | login/page.tsx |
| LOG-05 | „Passwort" | input (type=password, required, autoFocus, autoComplete=current-password) | Passwortfeld | – | login/page.tsx |
| LOG-06 | „Anmelden" | button (submit) | Führt `loginAction` aus | Server Action `loginAction` | login/page.tsx |
| LOG-07 | URL-Param `?error=` | URL param | `invalid` / `config` → Fehlermeldung | server-render | login/page.tsx |
| LOG-08 | Anmeldeversuche begrenzt (**2026-09, D-7**) | behaviour | 10 Versuche je 10 Minuten und IP (Bucket `admin-login`); darüber `?error=ratelimited`; fail-open ohne KV / bei Limiter-Fehler (der Betreiber wird nie ausgesperrt) | Server Action `loginAction` → `checkRateLimitKeyed` | login/page.tsx, lib/rate-limit.ts |

### Helper/explanatory text (Login) — 4
1. „Marketing-Dashboard. Bitte anmelden." — login/page.tsx
2. „ADMIN_PASSWORD / ADMIN_SESSION_SECRET sind nicht gesetzt — Login ist deaktiviert." — login/page.tsx
3. „Falsches Passwort." — login/page.tsx
4. „Server nicht konfiguriert (ADMIN_SESSION_SECRET fehlt)." — login/page.tsx
5. **2026-09:** „Zu viele Anmeldeversuche — bitte in zehn Minuten erneut versuchen.“ — login/page.tsx (Nr. 1 lautet heute „Admin · Mo — bitte anmelden.“)

### Persistenter Zustand (Login)
- Cookie Admin-Session (gesetzt durch `loginAction`), URL `?error=`, `?next=`; Zähler je IP im Rate-Limit-Speicher (Upstash, Bucket `admin-login`).

---

## 2. Übersicht (`OverviewTab.tsx`, entfernt 2026-10-01)

> **❌ Abgelöst (2026-10-01, Plan D-9) → Eingang (Abschnitt 2a).** `src/app/admin/OverviewTab.tsx` und
> `src/lib/admin-overview.mjs` (+ Test) sind entfernt; `src/lib/admin-overview-store.ts` liefert nur noch die
> Zählwerte der Eingang-Systemleiste (`getEingangSystemSnapshot`; `getOverviewSnapshot` und die Feed-Helfer sind entfernt). Verbleib je Element:
>
> | Übersicht | Jetzt |
> |---|---|
> | UEB-01 DB-Banner | EIG-01 („… der Eingang kann nicht geladen werden.“) |
> | UEB-02/03 „Letzte 30 Tage“ / „Beratungen“ | EIG-02 Streifen „letzte 30 Tage“: „Gespräche“ |
> | UEB-04 „Marketing-Kontakte“ | Kunden-Kopfzeile „mit Einwilligung“ (KUN-113), KPI Kundenbasis (KPI-73) |
> | UEB-05 „Beraten, nicht gekauft“ | Kunden-Ansicht „Mit Mo gesprochen“ + Lebenszyklus „Ohne Bestellung“ (KUN-115/116); Eingang-Art „Kaufabsicht ohne Kauf“ (EIG-13) |
> | UEB-06 „E-Mails gesendet“ (Kampagne · Marketing) | EIG-02 Streifen „Kampagnen-Mails“ (nur Kampagnen-Sends; der Marketing-Split entfällt mit Plan D-8) |
> | UEB-07 „Ø Kosten / Beratung“ | nur noch KPIs (KPI-50) |
> | UEB-08…12 „Heute“-Karten / Schnellzugriff | EIG-02 Systemkarten (Entwürfe je Kampagne, Wissen, laufende Analysen, Shopify-Abgleich) + „Alle KPIs“; nicht zugeordnete Mails → EIG-12 |
> | UEB-13…15 „Zuletzt gesendet“ / „Zuletzt bestätigt (DOI)“ | je Person im Kunden-Tab „Aktivität“ (KUN-123); EIG-02 „neu angemeldet“ |

### Beschreibung
Abgelöst; die Beschreibung des Tabs vom 2026-09-08 steht im Archiv ([archive](./archive/FEATURE_INVENTORY_AUDIT_2026-09.md) §B.1). Die Zeilen UEB-01…15 bleiben als Nachweis.

### Controls & actions
| ID | Element | Type | What it does | Calls | File |
|---|---|---|---|---|---|
| UEB-01 | Banner „Keine Datenbank konfiguriert (DATABASE_URL) — die Übersicht kann nicht berechnet werden." | display (warn) | Zustand ohne DB | server-render | entfernt 2026-10-01 |
| UEB-02 | Section „Überblick" | display (Section) | Gruppe Kennzahlen, Untertitel | server-render | entfernt 2026-10-01 |
| UEB-03 | Stat „Chats gesamt" | display (stat card) | `core.totalChats` (30 T.) oder „—" | `getCoreMetrics` | entfernt 2026-10-01 |
| UEB-04 | Stat „Marketing-Kontakte" (hint „bestätigt (DOI), aktiv") | display | `marketing.eligible` | `summarizeMarketingTargets(targets)` | entfernt 2026-10-01 |
| UEB-05 | Stat „Beraten, nicht gekauft" (hint „wichtigste Zielgruppe") | display | `marketing.notPurchased` | dito | entfernt 2026-10-01 |
| UEB-06 | Stat „Gesendet (30 T.)" (hint „Marketing-E-Mails") | display | `activity.sentInWindow` oder „—" | `getMarketingActivity` | entfernt 2026-10-01 |
| UEB-07 | Stat „Ø Kosten / Beratung" (hint „N Beratungen" / „noch keine Daten") | display | `aiCost.avgCostPerConsultationEur` (EUR, 4 Dezimalen) oder „—" | `getAiCostMetrics` | entfernt 2026-10-01 |
| UEB-08 | Section „Schnellzugriff" | display (Section) | Gruppe Deep-Links | – | entfernt 2026-10-01 |
| UEB-09 | QuickLink „N beraten, nicht gekauft" | link (a href, full nav) | → `/admin?tab=kunden&filter=no_purchase` | Navigation | entfernt 2026-10-01 |
| UEB-10 | QuickLink „N Marketing-Kontakte" | link | → `/admin?tab=kunden&filter=marketing` | Navigation | entfernt 2026-10-01 |
| UEB-11 | QuickLink „Alle Kunden ansehen" | link | → `/admin?tab=kunden` | Navigation | entfernt 2026-10-01 |
| UEB-12 | QuickLink „KPIs ansehen" | link | → `/admin?tab=kpi` | Navigation | entfernt 2026-10-01 |
| UEB-13 | Section „Letzte Aktivität" | display (Section) | Gruppe Aktivitätslisten | – | entfernt 2026-10-01 |
| UEB-14 | ActivityCard „Zuletzt gesendet" (Mail-Icon) | display (list, max 5) | E-Mail, Betreff („(ohne Betreff)" Fallback), Datum je Send; leer: „Noch keine Marketing-E-Mails versendet." | `getMarketingActivity.recentSends` | entfernt 2026-10-01 |
| UEB-15 | ActivityCard „Zuletzt bestätigt (DOI)" (UserCheck-Icon) | display (list, max 5) | E-Mail, „Marketing-Einwilligung bestätigt", Datum; leer: „Noch keine bestätigten Kontakte." | `recentConfirmedContacts(targets,5)` | entfernt 2026-10-01 |

### Helper/explanatory text (Übersicht) — 15
1. „Keine Datenbank konfiguriert (DATABASE_URL) — die Übersicht kann nicht berechnet werden." — entfernt 2026-10-01
2. „Aggregierte Kennzahlen aus den bestehenden Datenquellen — schreibgeschützt, nur Lesen." — entfernt 2026-10-01
3. Hint „bestätigt (DOI), aktiv" — entfernt 2026-10-01
4. Hint „wichtigste Zielgruppe" — entfernt 2026-10-01
5. Hint „Marketing-E-Mails" — entfernt 2026-10-01
6. Hint „N Beratungen" / „noch keine Daten" — entfernt 2026-10-01
7. „Direkt in die anderen Tabs springen — die Kunden-Links öffnen die Liste bereits gefiltert." — entfernt 2026-10-01
8. „Öffnet die Kundenliste, gefiltert auf „bestätigt + nicht gekauft"." — entfernt 2026-10-01
9. „Alle bestätigten (DOI) Kontakte in der Kundenliste." — entfernt 2026-10-01
10. „Profile, Sessions, Käufe & Marketing — gruppiert nach Person." — entfernt 2026-10-01
11. „Analytics, Marketing-Funnel & KI-Kosten." — entfernt 2026-10-01
12. „Die jüngsten Versände und bestätigten Kontakte aus den bestehenden Daten." — entfernt 2026-10-01
13. Leer: „Noch keine Marketing-E-Mails versendet." — entfernt 2026-10-01
14. Leer: „Noch keine bestätigten Kontakte." — entfernt 2026-10-01
15. Sekundärzeile „Marketing-Einwilligung bestätigt" — entfernt 2026-10-01

### Persistenter Zustand (Übersicht)
- Keiner eigener (nur `?tab` fehlt = Übersicht). Deep-Links setzen `?tab=kunden&filter=…` bzw. `?tab=kpi`.

---

## 2a. Eingang (`EingangTab.tsx`, `eingang/EingangWorkspace.tsx`, `eingang/UnmatchedInbound.tsx`) — seit 2026-10-01

### Beschreibung
Erster Bildschirm (`/admin`, `?tab=eingang`, Taste `1`, Plan D-9). `EingangTab` (Server) öffnet zuerst fällige Zurückstellungen wieder (`reopenDueSnoozed`, Nachtrag 2026-10) und lädt dann parallel `listInboxItems({status, limit:300})`, `getInboxCounts()`, `listCampaigns()`, `getEingangSystemSnapshot({windowDays:30})`, `listUnmatchedInbound()`, `getSyncHealth()` + `getOutboxStats()` (→ `describeSyncProblems`). `EingangWorkspace` (Client, über `lazy.tsx`) zeigt oben die Systemleiste und die nicht zugeordneten Mails, darunter eine `SplitPane`: links die Hinweise gruppiert „Jetzt / Diese Woche / Später“, rechts der gewählte Hinweis mit Begründung, Kunden-Minikarte, KI-Vorschlag und Entscheidung. Die Hinweise entstehen aus den deterministischen Regeln in `src/lib/customer-signals.mjs` (rein, getestet) über den stündlichen Job `/api/cron/inbox` (`src/lib/inbox-signals.ts`); KI-Vorschläge `src/lib/inbox-suggest.ts` (writer tier). Hier wird nie etwas gesendet: „Entwurf übernehmen“ legt eine Einzelansprache für den Prüftisch an. Tabelle `inbox_items` (Migration 0067), Store `src/lib/inbox-store.ts`.

### Controls & actions
| ID | Element | Type | What it does | Calls | File |
|---|---|---|---|---|---|
| EIG-01 | Callout „Keine Datenbank konfiguriert (DATABASE_URL) — der Eingang kann nicht geladen werden." | display (warn) | Zustand ohne DB | server-render | EingangTab.tsx |
| EIG-02 | Systemleiste: „n Entwürfe zur Prüfung“ mit Link je aktiver Kampagne (`?tab=kampagne&campaign=<slug>`, sonst „Zu den Kampagnen“); „n offene Wissensfragen“ (→ Wissen) + „Analyse läuft · Verbesserungslauf läuft“; Streifen „letzte 30 Tage“: Gespräche · Kampagnen-Mails · neu angemeldet (Personen mit einer Anmeldung zur einen Einwilligung im Zeitraum, jede Oberfläche, ohne Import) + „Alle KPIs“; Callout „Shopify-Abgleich braucht Aufmerksamkeit“ + „Einstellungen“ | display + links | Ersetzt die Übersicht-Karten | server-render (`listCampaigns`, `getEingangSystemSnapshot`, `describeSyncProblems`) | eingang/EingangWorkspace.tsx (SystemStrip), lib/admin-overview-store.ts |
| EIG-03 | Status `SegmentedControl` „Offen n · Später n · Erledigt“ (Erledigt inkl. verworfen) + Select „Alle Arten“ (Art mit Anzahl) | filter | Status über `?status=zurueckgestellt\|erledigt` (router.push), Art client-seitig | server-render (`listInboxItems`) | eingang/EingangWorkspace.tsx |
| EIG-04 | „Jetzt prüfen“ → Toast „n neu · m erledigt sich von selbst.“ | button | Regeln sofort ausführen (ohne KI-Vorschläge) | POST /api/admin/inbox/run | eingang/EingangWorkspace.tsx |
| EIG-05 | Liste „Jetzt / Diese Woche / Später“ (`signalGroup`): Prioritätspunkt (≥ 80 / ≥ 55), Titel, ✨ bei Vorschlag, relative Zeit, „Kunde · Grund“; leer „Alles erledigt“ | list (buttons) | Auswahl → `?item=` (replaceState) | client-only | eingang/EingangWorkspace.tsx |
| EIG-06 | Detail: Titel, Kunde · Zeit · „bis <Datum>“, Badge „Priorität n“, Grund, Belege (Produkte, letzter Kauf, Gespräch, läuft ab, Frist) | display | – | – | eingang/EingangWorkspace.tsx (ItemDetail) |
| EIG-07 | Kunden-Minikarte: Name (→ `?tab=kunden&customer=<id>`), Einwilligung, „Interessent“, Persona, Bestellungen · Umsatz · zuletzt · Lebenszyklus · Gespräche mit Mo, Profilauszug; ohne Einwilligung „Keine Einwilligung für E-Mail-Werbung — nur ansehen oder Brief.“ | display | Kontext ohne Bildschirmwechsel | GET /api/admin/inbox/item?id= | eingang/EingangWorkspace.tsx, eingang/types.ts |
| EIG-08 | Block „Vorschlag“ (InfoTip) + „Vorschlag erzeugen“ / „Neu erzeugen“: Warum, Kanal (E-Mail (Einzelansprache) / Brief / Antwort / Kampagne / Intern prüfen / Nichts tun), Aktion, Betreff, Text, Rabatt + Begründung, Produkte | display + button | KI-Vorschlag (writer tier); wird gegen Einwilligung und Widerspruch nachgeprüft, Rabatt ≤ 15 % | POST /api/admin/inbox/suggest | eingang/EingangWorkspace.tsx, lib/inbox-suggest.ts |
| EIG-09 | Primäraktion (`Enter`): „Entwurf übernehmen“ (nur mit Einwilligung) → Einzelansprache-Entwurf mit dem Vorschlag als Notiz (+ dessen Rabatt), Hinweis erledigt, weiter im Prüftisch `?tab=kampagne&campaign=einzelansprache&contact=<id>`; sonst „Antworten“ / „Daten bereitstellen“ / „Kunde öffnen“. **Nachtrag 2026-10:** die Primäraktionen navigieren clientseitig (`router.push`, kein Neuladen); Übernehmen schreibt das Admin-Zugriffsprotokoll (`inbox.accept`) | button | Plan D-8; nichts wird gesendet | POST /api/admin/inbox/accept | eingang/EingangWorkspace.tsx, api/admin/inbox/accept |
| EIG-10 | „Erledigt“, „Später“ (In 3 / 7 / 30 Tagen), „Verwerfen“ (passt nicht · schon erledigt · falscher Zeitpunkt · anderes); abgeschlossene zeigen „Entscheidung: …“. **Nachtrag 2026-10:** in den Ansichten Später und Erledigt hat jeder Hinweis „Wieder öffnen“ (`wieder_offen`, Toast „Wieder offen“); `inbox/decide` antwortet 404 nur für einen unbekannten Hinweis, 500 wenn er existiert, die Entscheidung aber nicht gespeichert wurde | buttons + menus | Hinweis verlässt die Liste, nächster wird gewählt | POST /api/admin/inbox/decide `{id, decision, snoozeDays?, note?}` | eingang/EingangWorkspace.tsx |
| EIG-11 | Tastenkürzel `J`/`K`, `Enter`, `E` erledigt, `Z` später (3 Tage), `D` verwerfen, `Esc`. **Nachtrag 2026-10:** `J`/`K` und `Esc` (Auswahl aufheben) in jeder Ansicht; `Enter`/`E`/`Z`/`D` nur in Offen mit gewähltem Hinweis | keyboard shortcut | Nicht beim Tippen / bei offenem Dialog | client-only | eingang/EingangWorkspace.tsx |
| EIG-12 | „E-Mails nicht zugeordnet“ (Disclosure mit Zähler, InfoTip wie KUN-01): Absender, Betreff, Anhänge, Zeit, Snippet; „Kunde suchen (Name oder E-Mail)“ (≥ 2 Zeichen, erste 10 Treffer, erster vorausgewählt) + Select + „Zuordnen“ | list + search + button | Ersetzt KUN-01…04 (Kunden-Posteingang); der Vorschlag „(passende Adresse)“ entfällt, die Suche läuft über die ganze Kundenbasis | GET /api/admin/customers/list?kq=, POST /api/admin/correspondence/assign → `router.refresh()` | eingang/UnmatchedInbound.tsx |
| EIG-13 | Hinweis-Arten (`SIGNAL_KINDS`): aus Kennzahlen kaufabsicht, klick_ohne_kauf, zubehoer_fenster, wiederkauf_faellig, abwanderung, top_kunde, einwilligung_fehlt; aus Ereignissen angebot_laeuft_ab, unzufrieden, zustellproblem; aus Shopify datenauskunft (customers/data_request, Frist 30 Tage) und Abgleich-Alarme (shop/redact, viele Löschungen). Dedupe-Schlüssel je Episode (Bestellung / Mail / Gespräch), Deckel je Art (top_kunde 25, einwilligung_fehlt 50, abwanderung 60, wiederkauf_faellig 60), nicht mehr greifende schließen sich (`erledigt_von_selbst`), abgelaufene (`abgelaufen`), 14-Tage-Ergebnis (Bestellung / Umsatz) für KPI-72. **Nachtrag 2026-10:** die Abgleich-Alarme haben die Art `abgleich_konflikt` mit Label „Shopify-Abgleich prüfen“ (Gruppe Jetzt, ohne Kunde, ohne Einwilligungspflicht); fällige Zurückstellungen öffnen sich wieder, wenn der Eingang lädt und im stündlichen Job (`reopenDueSnoozed`) — nie auf dem Badge-Pfad; nach `INBOX_RETENTION_DAYS` bleibt von entschiedenen Hinweisen nur eine Markierung (Retention Schritt 8), damit keine Regel sie neu anlegt. **Nachtrag 2026-10-02:** `antwort_offen` ist keine Kennzahl-Regel mehr, sondern ein Ereignis (EIG-14). **Nachtrag 2026-10-03:** `unzufrieden` zählt eine Erstattung erst ab 10 % des Bestellwerts (`isNotableRefund`) und datiert sie nach der Erstattung selbst (`customer_orders.last_refund_at`, Migration 0070), nicht nach der letzten Änderung der Bestellung; eine stornierte Bestellung ist ein Fall (ihre spätere Erstattung erzeugt nichts Neues); der nächtliche Abgleich liest einmalig die Bestellungen der letzten 15 Tage nach und öffnet die in der Zwischenzeit selbst geschlossenen Hinweise wieder (`reopenSelfClosedRefundItems`) | behaviour | Regeln lesbar und getestet | Cron `/api/cron/inbox` (stündlich :20), `INBOX_AI_DAILY_LIMIT` | lib/customer-signals.mjs, lib/inbox-signals.ts, lib/shopify-webhook-customers.ts |
| EIG-14 | „E-Mail beantworten“ (`antwort_offen`, Priorität 90, Gruppe Jetzt): jede eingehende Mail einer bekannten Person öffnet sofort ihren Hinweis — Inbound-Webhook, „Zuordnen“, „Als Interessent anlegen“, Kontaktformular — und der stündliche Job holt verpasste nach (14 Tage, im selben Thread nicht beantwortet). Ein offener Hinweis je Person: weitere Mails hängen sich an („2 E-Mails: …“, `evidence.messageIds`), ein zurückgestellter öffnet sich wieder; Grund = Betreff + Anfang der neuesten Mail ohne Zitat. Eine Antwort (Eingang oder Kunden → Korrespondenz) schließt ihn (`erledigt`, Entscheidung `beantwortet`) | behaviour | Keine Mail bleibt unbemerkt | `/api/inbound/resend`, `correspondence/assign`, `correspondence/assign-prospect`, `/api/contact`, Cron `/api/cron/inbox`, `correspondence/send` | lib/inbox-mail.ts, lib/inbox-mail-core.mjs, lib/inbox-store.ts (`upsertMailItem`, `closeMailItems`, `listUnseenInboundMails`) |
| EIG-15 | Detail „E-Mail beantworten“ statt „Vorschlag“: Verlauf (neue Mails hervorgehoben, Zitate entfernt, ältere unter „Früherer Verlauf“, „Ganzer Verlauf“ → `?tab=kunden&customer=<id>&ctab=korrespondenz`), „KI-Zusammenfassung“ (InfoTip) mit Anliegen + Dringlichkeit, „Vor dem Senden:“ + offene Punkte, „Neuer Entwurf“ / „Entwurf schreiben“; Antwort an <Name>: Betreff, Text, Hinweis „Der Text enthält noch Platzhalter in eckigen Klammern.“, „Antwort senden“ (Bestätigung; `Enter`) → danach erledigt, nächster Hinweis | display + form + button | Service-Antwort mit KI-Entwurf ohne Bildschirmwechsel; keine Einwilligung nötig (keine Werbung) | GET /api/admin/inbox/item (`mail`), POST /api/admin/inbox/suggest, POST /api/admin/correspondence/send | eingang/MailReply.tsx, eingang/EingangWorkspace.tsx |
| EIG-16 | KI-Entwurf zur Mail (writer tier, Aufrufstelle `inbox_mail_reply`): automatisch beim ersten Öffnen ohne Entwurf; Zusammenfassung, Anliegen (Produktfrage, Bestellung & Lieferung, Reklamation & Rückgabe, Rechnung & Zahlung, Beratung, Sonstiges), Dringlichkeit, nächster Schritt, Antwort in der Sprache der Person mit du/Sie wie sie; keine Werbung, keine Rabatte, nichts erfinden — fehlende Angaben als `[Platzhalter]`; im Prompt: Name, letzte 12 Mails, letzte 3 Bestellungen (Datum, Status, Artikel — ohne Bestellnummer und Beträge), Profil nur ohne Widerspruch | behaviour | Schneller antworten, ohne dass die KI etwas zusagt | POST /api/admin/inbox/suggest | lib/inbox-mail.ts (`generateMailReplyDraft`), lib/inbox-mail-core.mjs (`buildMailReplyPrompt`, `sanitizeMailDraft`) |
| EIG-17 | „Als Interessent anlegen“ in „E-Mails nicht zugeordnet“: Kunde aus der Absenderadresse (ohne Name, ohne Einwilligung), Mail zugeordnet, Hinweis geöffnet; Toast „Als Interessent angelegt“ | button | Unbekannte Absender ohne Suche übernehmen | POST /api/admin/correspondence/assign-prospect (Zugriffsprotokoll `correspondence.assign_prospect`) | eingang/UnmatchedInbound.tsx |
| EIG-18 | Kontaktformular im Eingang: `/api/contact` speichert die Anfrage zusätzlich als empfangene Mail (Provider `kontaktformular`, Betreff „Kontaktanfrage: <Anliegen>“, Text mit Organisation, Telefon, Produkten), legt unbekannte Absender als Interessent an (ohne Einwilligung) und öffnet „E-Mail beantworten“ („Kontaktanfrage: „Leasing“ — …“); die Team-Mail an `CONTACT_TO_EMAIL` geht unverändert raus | behaviour | Anfragen landen beim Kunden, mit Entwurf | `/api/contact` | lib/inbox-mail.ts (`storeContactRequest`), lib/customer-store.ts (`findOrCreateProspect`) |

### Persistenter Zustand (Eingang)
- URL: `/admin` bzw. `?tab=eingang` (+ `?status=`, `?item=<id>` per replaceState). Hinweise, Entscheidungen, Vorschläge und Ergebnisse serverseitig in `inbox_items` (abgeschlossene: Inhalt nach `INBOX_RETENTION_DAYS` geleert, Marker bis zu zwei Jahre, damit eine Regel Entschiedenes nicht neu anlegt — Retention-Schritt 8).

---

## 3. Kunden (`KundenTab.tsx`, `kunden/*`)

### Beschreibung
**Stand 2026-10-01 (Kundenplattform):** Die Liste umfasst den ganzen Kundenstamm — jede Shopify-Kund:in (Spiegel, Migration 0061) und jede Person aus Mo — und ist **serverseitig**: `KundenTab` liest den Filter aus der URL (`parseCustomerFilter`, `src/lib/admin-customer-filter.mjs`, rein, getestet) und lädt eine Seite à 50 über die View `customer_overview` (0068) mit `listCustomers` + `getCustomerBaseSummary` (`src/lib/customer-list-store.ts`); jede Filteränderung ist ein `router.push`. Die Detailansicht hat sieben Reiter: Überblick · Aktivität · Käufe · Gespräche · Marketing · Korrespondenz · Brief (`kunden/tabs/*`, Daten über `GET customers/detail`, `src/lib/customer-detail.ts`). Der Posteingang (KUN-01…04) ist in den Eingang gewandert (EIG-12); die Sammel-Entwurf-Leiste (KUN-13, 16, 25…29) ist abgelöst — **Nachtrag 2026-10:** durch „Auswählen“ → „Zur Kampagne…“ (KUN-133). Neue Fähigkeiten: KUN-113…134.

Bildschirm-Beschreibung: [`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §3.3. Die Beschreibung vom 2026-09-08 (Client-Liste, `CustomerProfileCard` mit sechs Reitern, Sammel-Entwurf-Leiste) steht im Archiv ([archive](./archive/FEATURE_INVENTORY_AUDIT_2026-09.md) §B.1); die Zeilen KUN-01…107 nennen in der Dateispalte, wo das Element heute liegt.

### Controls & actions
| ID | Element | Type | What it does | Calls | File |
|---|---|---|---|---|---|
| **Nicht zugeordneter Posteingang (global, nur sichtbar wenn ≥1 Nachricht)** — ❌ abgelöst 2026-10: `UnmatchedInboundQueue.tsx` → `eingang/UnmatchedInbound.tsx` im Eingang (EIG-12) ||||||
| KUN-01 | Karte „Nicht zugeordneter Posteingang" + Zähler-Badge | display (warn card) | Eingegangene Mails ohne Kundenzuordnung (customer_id NULL) | server-render (`listUnmatchedInbound`) | eingang/UnmatchedInbound.tsx |
| KUN-02 | Absender-Badge, Betreff („(kein Betreff)"), 📎 Anzahl Anhänge, Datum/Zeit, Snippet (2 Zeilen) | display | Metadaten je unzugeordneter Nachricht | server-render | eingang/UnmatchedInbound.tsx |
| KUN-03 | Select „Kunde wählen…" (Option-Suffix „(passende Adresse)" bei E-Mail-Match, vorausgewählt) | select | Zielkunde für Zuordnung; Vorschlag = Kunde mit gleicher E-Mail | client-only | eingang/UnmatchedInbound.tsx |
| KUN-04 | „Zuordnen" / „Ordne zu…" | button | Setzt customer_id + re-threadet; Toast „Zugeordnet"; Warn-Toast „Kein Kunde gewählt" | POST /api/admin/correspondence/assign `{messageId, customerId}` → `router.refresh()` | eingang/UnmatchedInbound.tsx |
| **Toolbar (Suche + Filter)** — 2026-10: serverseitig, Zustand in der URL (`k*`), s. KUN-115…118 ||||||
| KUN-05 | „Suche (Name / E-Mail)" `#ms-search` (Placeholder „z. B. müller oder @gmail") | input (search) | Substring-Filter auf E-Mail + Name; Fokus per Tastenkürzel `/` | client-only (`filterCustomers`) | kunden/KundenWorkspace.tsx, lib/admin-customer-filter.mjs |
| KUN-06 | Filter „Tier" (Alle / Tier 3 · angemeldet / Tier 2 · E-Mail / Tier 1 · anonym) | select (filter) | Identitätsstufe. **❌ abgelöst 2026-10** → Filter „Shop“ (Shopify-Kunden / Interessenten) und „Mo“ (KUN-117); die Stufe bleibt in Gespräche | client-only | kunden/KundenWorkspace.tsx |
| KUN-07 | Filter „Marketing" (Alle / DOI bestätigt / DOI offen / Keine Einwilligung / Abgemeldet) | select (filter) | `marketingStatus`. **2026-10** → „Einwilligung“ über die eine Einwilligung (KUN-116) | client-only | kunden/KundenWorkspace.tsx |
| KUN-08 | Filter „Kauf" (Alle / Hat gekauft / Nicht gekauft) | select (filter) | `purchaseState` (unknown = noch nicht geladen fällt bei beiden raus). **❌ abgelöst 2026-10** → „Lebenszyklus“ inkl. „Ohne Bestellung“ (KUN-116) | client-only | kunden/KundenWorkspace.tsx, lib/admin-customer-filter.mjs |
| KUN-09 | Filter „Versand" (Alle / Offener Entwurf / Gesendet / Kein Entwurf) | select (filter) | `sendState` des letzten Marketing-Sends. **❌ abgelöst 2026-10** (Plan D-8) → offene 1:1-Entwürfe stehen im Prüftisch der Einzelansprache; je Person Marketing-Reiter „Kampagnen“ (KUN-126) | client-only | kunden/KundenWorkspace.tsx, lib/admin-customer-filter.mjs |
| KUN-10 | „Sortierung" (Zuletzt aktiv / Name A–Z / Älteste zuerst / Meiste Sessions) | select (sort) | Sortierung der Liste. **2026-10:** Zuletzt aktiv / Umsatz / Bestellungen / Letzter Kauf / Name A–Z / Neueste zuerst (`?ksort=`, serverseitig) | client-only | kunden/KundenWorkspace.tsx, lib/admin-customer-filter.mjs |
| KUN-11 | Zähler „N Kund(en)" / „N von M" | display | Trefferzahl. **2026-10:** „N Personen“ (Gesamtzahl der Treffer) bzw. „Lädt…“ | client-only | kunden/KundenWorkspace.tsx |
| KUN-12 | „✕ Filter zurücksetzen" | button (nur wenn Filter aktiv) | Setzt DEFAULT_FILTER. **2026-10:** setzt auf die gewählte Ansicht zurück | client-only | kunden/KundenWorkspace.tsx |
| KUN-13 | Checkbox „Alle bestätigten (N) für Sammel-Entwurf" (tri-state) | checkbox (bulk select) | Wählt alle sichtbaren DOI-bestätigten Kunden aus/ab. **❌ abgelöst 2026-10** (s. KUN-25…29) | client-only | kunden/KundenWorkspace.tsx |
| KUN-14 | Preset aus `?filter=no_purchase` / `marketing` / `draft` (legacy `?status=`) | URL param | Seed des Filters beim Laden. **❌ abgelöst 2026-10** → `?kview=` + `k*`-Parameter (KUN-115…118); alte `?filter=`-Links werden ignoriert. **Nachtrag 2026-10:** `marketing` und `no_purchase` landen auf der nächsten Ansicht (SHL-14) | server→client | KundenTab.tsx, lib/admin-customer-filter.mjs |
| **Kundenliste (links, sticky, scrollbar)** — 2026-10: eine Seite à 50 mit `Pagination` (KUN-118/119) ||||||
| KUN-15 | Kundenzeile (role=button, Enter/Space) | list item / button | Wählt Kunden für Detail | client-only | kunden/KundenWorkspace.tsx |
| KUN-16 | Checkbox je Zeile (nur DOI-bestätigt; aria „… für Sammel-Entwurf auswählen") | checkbox | Bulk-Auswahl ohne Detailwechsel (stopPropagation). **❌ abgelöst 2026-10** (s. KUN-25…29) | client-only | kunden/KundenWorkspace.tsx |
| KUN-17 | Name (oder E-Mail), E-Mail-Unterzeile, Badge „T1/T2/T3" | display | Identität. **2026-10:** Tier-Badge → Badges Shop/Interessent + Mo (KUN-119); „Tier 3“ nur noch im Detailkopf | server-render | kunden/KundenWorkspace.tsx |
| KUN-18 | Badges „Marketing" (success) / „DOI offen" / „Abgemeldet" | badge | Marketingstatus. **2026-10** → `ConsentBadge` der einen Einwilligung („Einwilligung“ / „Bestätigung offen“ / „Abgemeldet“ / gesperrt mit Grund) | – | kunden/KundenWorkspace.tsx |
| KUN-19 | Badge „✓ gekauft" | badge | purchaseState=purchased. **2026-10** → „n × · Umsatz“ in der Zeile + Lebenszyklus-Badge | – | kunden/KundenWorkspace.tsx |
| KUN-20 | Badge „★ nicht gekauft" (accent; nur bestätigt + no_purchase) | badge | Kern-Zielgruppe. **❌ abgelöst 2026-10** → Lebenszyklus „Ohne Bestellung“, Eingang-Art „Kaufabsicht ohne Kauf“ | – | kunden/KundenWorkspace.tsx |
| KUN-21 | Badges „Entwurf" (info) / „Gesendet" (success) | badge | sendState. **❌ abgelöst 2026-10** (s. KUN-09) | – | kunden/KundenWorkspace.tsx |
| KUN-22 | Relatives Datum („heute"/„gestern"/„vor N Tagen"/Datum) | display | lastSeenAt | – | kunden/KundenWorkspace.tsx |
| KUN-23 | Leerzustand „Keine Kunden für diese Suche/Filter." | display | – | – | kunden/KundenWorkspace.tsx |
| KUN-24 | Platzhalter „Wähle links einen Kunden, um Profil, Käufe, Marketing & mehr zu sehen." | display | Kein Kunde gewählt | – | kunden/KundenWorkspace.tsx |
| **Sammel-Entwurf-Leiste (sticky unten, nur bei Auswahl)** — ❌ abgelöst 2026-10 (Plan D-8). Ersatz für viele Personen: eine Kampagne mit Zielgruppe (KAM-96…98) und „Vorbereiten…“; für eine Person: Einzelansprache (KUN-125). **Nachtrag 2026-10:** die Mehrfachaktion ist gebaut — „Auswählen“ → „Zur Kampagne…“ (KUN-133, Einzelansprache vorausgewählt; Entwürfe danach im Prüftisch) ||||||
| KUN-25 | „N ausgewählt" | display | Anzahl | – | kunden/KundenWorkspace.tsx |
| KUN-26 | „Rabatt (%)" `#ms-bulk-depth` (0–50, clamp) | input (number) | Rabatt-Tiefe für alle Entwürfe | client-only | kunden/KundenWorkspace.tsx |
| KUN-27 | „Textmodus" (Ausführlich/Kompakt/Minimal) | toggle (segmented, shared `EmailTextModeToggle`) | Textmodus für alle Entwürfe (Default compact) | client-only | kunden/KundenWorkspace.tsx |
| KUN-28 | „✕ Auswahl aufheben" | button | Leert Auswahl | client-only | kunden/KundenWorkspace.tsx |
| KUN-29 | „✨ Entwürfe erstellen" / „Erstelle…" | button (bulk action) | Je Kunde Draft (regenerate:false), Pool 4, Live-Toast „Entwürfe werden erstellt… k / N", Abschluss-Toast success/warning/error; danach Auswahl leeren + refresh. **Nachtrag 2026-10:** Ersatz für KUN-13, 16, 25…29 ist KUN-133 („Auswählen“ → „Zur Kampagne…“) | POST /api/admin/customers/marketing-draft `{customerId, discountPercent, textMode, regenerate:false}` | kunden/KundenWorkspace.tsx |
| **Detail-Karte: Kopf** ||||||
| KUN-30 | Name/E-Mail, „Zuerst: … · Zuletzt: …" | display | Kopfzeile | server-render | kunden/CustomerDetail.tsx |
| KUN-31 | Badge „Tier N" (title „Identitätsstufe") | badge | **2026-10:** nur noch bei Tier 3; davor Shop-/Interessent- und Mo-Badge | – | kunden/CustomerDetail.tsx |
| KUN-32 | Badge „↻ N×" (title „Mehrere Sessions unter derselben E-Mail") | badge | Wiederkehrer | – | kunden/CustomerDetail.tsx |
| KUN-33 | Badge Marketingstatus („Kein Marketing" / „DOI ausstehend" / „Marketing bestätigt" / „Abgemeldet") | badge | **2026-10** → `ConsentBadge` lang („Angemeldet für E-Mail-Werbung“ / „Bestätigung ausstehend (Double-Opt-in)“ / „Von E-Mail-Werbung abgemeldet“ / „Keine Einwilligung für E-Mail-Werbung“ / Sperrgrund) | – | kunden/CustomerDetail.tsx |
| KUN-34 | Sub-Tabs „Profil", „Beratungen (N)", „Käufe", „Marketing", „Korrespondenz", „Brief" | sub-tab | Wechsel innerhalb der Karte (alle forceMount). **2026-10:** „Überblick · Aktivität · Käufe (n) · Gespräche (n) · Marketing · Korrespondenz (n) · Brief (n)“ — Profil liegt im Überblick, „Beratungen“ heißt „Gespräche“ | client-only | kunden/CustomerDetail.tsx |
| **Sub-Tab Profil** — 2026-10: im Reiter „Überblick“ (KUN-121), mit Profiltiefe und Einwilligungs-Regel (KUN-129) ||||||
| KUN-35 | Section „Aktuelles Kundenverständnis" · „Stand: <Datum>" | display | – | – | kunden/tabs/ProfilTab.tsx |
| KUN-36 | „✨ Kundenverständnis generieren" / „Neu generieren" / „Generiere…" | button | KI-Profil erzeugen; Toast success/„Hinweis" (warning) mit `json.warning` | POST /api/admin/customers/profile `{customerId}` → refresh | kunden/tabs/ProfilTab.tsx |
| KUN-37 | Profiltext (Markdown) / „Noch kein Profil generiert." | display | – | – | kunden/tabs/ProfilTab.tsx |
| KUN-38 | Kosten-Hinweis inkl. „Letzter Lauf: N Input- / M Output-Tokens (~$x)" | display | Token-/Kostentransparenz nach Lauf | – | kunden/tabs/ProfilTab.tsx |
| **Sub-Tab Beratungen** — 2026-10: Reiter „Gespräche“ ||||||
| KUN-39 | Section „Gesprächs-Timeline (N)" | display | – | – | kunden/tabs/BeratungenTab.tsx |
| KUN-40 | Leerzustand „Keine Konversation verknüpft — …" | display | – | – | kunden/tabs/BeratungenTab.tsx |
| KUN-41 | Timeline-Eintrag „Session N", Datum · Persona, Badge „N Nachrichten" | display | – | server-render | kunden/tabs/BeratungenTab.tsx |
| KUN-42 | „💬 Transkript (N)" | button → dialog | Öffnet Dialog „Session N · Datum · E-Mail" mit Verlauf (Kunde:/Berater:), leer „Kein lesbares Transkript." | client-only | kunden/tabs/BeratungenTab.tsx |
| **Sub-Tab Käufe** — 2026-10: für gespiegelte Kund:innen die Bestell-Kopie (KUN-124); KUN-43…48 bleiben als Rückfall vor dem Import ||||||
| KUN-43 | Section „Kaufhistorie (Shopify)" · „Stand: …" / „noch nicht geladen" | display | – | – | kunden/tabs/KaeufeTab.tsx |
| KUN-44 | „↻ Käufe aktualisieren" / „Lade…" | button | Shopify-Kaufhistorie neu laden; Toast „Käufe aktualisiert" | POST /api/admin/customers/purchases `{customerId}` → refresh | kunden/tabs/KaeufeTab.tsx |
| KUN-45 | Tabelle Artikel / Menge / Datum / Summe / Status (Bestellname als Unterzeile) | table | Bestellungen | – | kunden/tabs/KaeufeTab.tsx |
| KUN-46 | Status-Badge (Bezahlt / Teilw. bezahlt / Ausstehend / Autorisiert / Erstattet / Teilw. erstattet / Storniert / Abgelaufen / „—") | badge | financialStatus | – | kunden/tabs/KaeufeTab.tsx |
| KUN-47 | Leerzustände „Noch keine Kaufhistorie geladen." / „Keine Bestellungen unter dieser E-Mail gefunden." | display | – | – | kunden/tabs/KaeufeTab.tsx |
| KUN-48 | Hinweis „Liste ggf. gekürzt (nur die neuesten Bestellungen)." | display | truncated | – | kunden/tabs/KaeufeTab.tsx |
| **Sub-Tab Marketing (MarketingEmailSection)** — 2026-10 (Plan D-8): neue 1:1-Mails laufen über die Einzelansprache (KUN-125). KUN-50…70 bleiben nur für einen offenen Entwurf des bisherigen Wegs (KUN-49 zeigt den Sperrgrund der einen Einwilligung) („Persönliche E-Mail (bisheriger Weg) — offener Entwurf“, Disclosure, nur mit Einwilligung); einen neuen Entwurf startet man hier nicht mehr ||||||
| KUN-49 | Blockier-Hinweis bei Status ≠ confirmed (3 Varianten) | display | Kein Generieren möglich | – | kunden/tabs/MarketingTab.tsx |
| KUN-50 | Section „Personalisierte E-Mail (Mo) — aus dem GESAMTEN Kundenkontext" | display | – | – | kunden/tabs/MarketingTab.tsx |
| KUN-51 | Badge „✓ Gesendet am <Datum>" + „Betreff: … · Rabatt: N % · Code: <code>" | display | Letzte gesendete Mail | – | kunden/tabs/MarketingTab.tsx |
| KUN-52 | `<details>` „Gesendeten Text anzeigen" | disclosure | Markdown des gesendeten Texts | – | kunden/tabs/MarketingTab.tsx |
| KUN-53 | Bundle-Angebot-Block (aufklappbar, siehe KUN-71ff.) | section | – | – | kunden/tabs/MarketingTab.tsx |
| KUN-54 | „Besondere Hinweise für diese E-Mail (optional)" (Textarea, max 2000) | textarea | Team-Anweisung für nächste Generierung | client-only (mit Draft gespeichert) | kunden/tabs/MarketingTab.tsx |
| KUN-55 | „Persönlicher Rabatt (%)" (0–50) + Hinweis „0 = kein Rabatt, kein Code" / „0–50 %" | input (number) | Rabatt-Tiefe | client-only | kunden/tabs/MarketingTab.tsx |
| KUN-56 | „Textmodus" Toggle + Modus-Hinweis | toggle (shared) | Textmodus | client-only | kunden/tabs/MarketingTab.tsx |
| KUN-57 | Badge „Entwurf — noch nicht gesendet" | badge | Offener Draft | – | kunden/tabs/MarketingTab.tsx |
| KUN-58 | Warnbox „Rabatt, Textmodus oder Hinweise geändert — der aktuelle Text passt nicht mehr." + „↻ Neu generieren" | display + button | Regenerate-Lockout (Senden gesperrt bis neu generiert) | POST /api/admin/customers/marketing-draft `{…, regenerate:true}` | kunden/tabs/MarketingTab.tsx |
| KUN-59 | Hinweis Platzhalter „Vorschau mit Platzhalter-Code MO-XXXX …" / „Kein Rabatt gewählt — …" | display | – | – | kunden/tabs/MarketingTab.tsx |
| KUN-60 | „Betreff" | input | Editierbar | client-only bis Speichern | kunden/tabs/MarketingTab.tsx |
| KUN-61 | „E-Mail-Text (bearbeitbar)" (Textarea 10 Zeilen) | textarea | Editierbar | client-only bis Speichern | kunden/tabs/MarketingTab.tsx |
| KUN-62 | Hinweis „Beim Versand werden Warenkorb-Button & Abmeldelink automatisch angehängt …" | display | – | – | kunden/tabs/MarketingTab.tsx |
| KUN-63 | Hero-Bild-Panel (kind=marketing, targetId=sendId; siehe Shared HERO-01…) | panel | Personalisiertes Hero-Bild | GET/POST /api/admin/email-hero* | kunden/tabs/MarketingTab.tsx |
| KUN-64 | „💾 Entwurf speichern" / „Speichere…" | button | Speichert Betreff/Text | POST /api/admin/marketing/update `{sendId, subject, body}` | kunden/tabs/MarketingTab.tsx |
| KUN-65 | „👁 Vorschau" (EmailPreviewButton, Dialog „Vorschau — <email>") | button → dialog (iframe) | Gerenderte HTML-Vorschau, Desktop/Mobil-Toggle | POST /api/admin/marketing/email-preview `{sendId, subject, body}` | kunden/tabs/MarketingTab.tsx |
| KUN-66 | „📤 Freigeben & senden" / „Sende…" (disabled bei needsRegenerate, title „Bitte zuerst neu generieren") | button + confirm dialog (`confirm("E-Mail an … wirklich senden?")`) | Speichert dann sendet; Warn-Toast bei Lockout | POST /api/admin/marketing/update + POST /api/admin/marketing/send `{sendId}` | kunden/tabs/MarketingTab.tsx |
| KUN-67 | „🗑 Entwurf löschen" / „Lösche…" | button + confirm (`"Diesen Entwurf wirklich löschen? …"`) | Löscht Draft, zurück zu Generieren | POST /api/admin/marketing/delete `{sendId}` | kunden/tabs/MarketingTab.tsx |
| KUN-68 | Hinweis „Der Entwurf nutzt ALLES zu diesem Kunden: …" | display | Vor Generierung | – | kunden/tabs/MarketingTab.tsx |
| KUN-69 | „✨ Personalisierte E-Mail generieren" / „Neue personalisierte E-Mail generieren" / „Generiere Entwurf…" | button | Erzeugt Draft (regenerate = hasDraft) | POST /api/admin/customers/marketing-draft `{customerId, discountPercent, adminInstructions, textMode, regenerate}` | kunden/tabs/MarketingTab.tsx |
| KUN-70 | Hinweis „Du kannst unten jederzeit eine neue personalisierte E-Mail generieren." | display | Nach Versand | – | kunden/tabs/MarketingTab.tsx |
| **Bundle-Angebot (BundleOfferSection, innerhalb Marketing)** — 2026-10: nur noch im offenen Entwurf des bisherigen Wegs; Sets für die Einzelansprache entstehen im Prüftisch (KAM-82) ||||||
| KUN-71 | Kopf „🎁 Bundle-Angebot · N vorhanden" ▸/▾ | button (collapse) | Auf-/Zuklappen | client-only | kunden/BundleComposer.tsx |
| KUN-72 | „✨ Bundle vorschlagen" / „Schlage vor…" | button | KI-Vorschlag Komponenten + Titel; Toast „KI-Vorschlag erstellt" | POST /api/admin/bundles/suggest `{customerId}` | kunden/BundleComposer.tsx |
| KUN-73 | Komponentenliste (Bild, Titel, Preis · Begründung) + „✕" Entfernen (aria „… aus dem Bundle entfernen") | list + button | Zusammensetzung bearbeiten | client-only | kunden/BundleComposer.tsx |
| KUN-74 | „Komponentensumme: X €" | display | – | – | kunden/BundleComposer.tsx |
| KUN-75 | Produktsuche (CatalogProductPicker, Placeholder „Produkt suchen (Name)…", Variantenwahl, „Ausverkauft — nicht hinzufügbar") | input (search) + list | Produkt/Variante hinzufügen | POST /api/admin/catalog/search `{query}` | kunden/BundleComposer.tsx |
| KUN-76 | „Bundle-Preis (€)" (auto = Komponentensumme bis editiert) | input (number) | Preis | client-only | kunden/BundleComposer.tsx |
| KUN-77 | „Titel" (Default „Dein persönliches Set") | input | – | client-only | kunden/BundleComposer.tsx |
| KUN-78 | „Gültig (Tage)" (Default 7, min 1) | input (number) | Ablauf | client-only | kunden/BundleComposer.tsx |
| KUN-79 | Warnung „⚠ Preis über der Komponentensumme … KEINE „statt"-Zeile" | display | – | – | kunden/BundleComposer.tsx |
| KUN-80 | „Bundle erstellen" / „Erstelle…" (2–5 Produkte, Preis>0) | button | Erstellt Angebot, hängt an offenen Draft; Fehler-Toast mit „Ausverkauft: …" | POST /api/admin/bundles/create `{customerId, components[{productId,variantId?}], bundlePriceOverride, title, expiryDays, marketingSendId?}` | kunden/BundleComposer.tsx |
| KUN-81 | Liste „Bundles für <email> (N)": Titel, Status-Badge (Fehlgeschlagen/Abgelaufen/Wird erstellt…/Versendet/Aktiv), „↗ Klick erfasst", Preis „(statt …)", Komponenten, „Erstellt … · läuft ab …", Fehlertext | display | Bestehende Bundles | server-render | kunden/BundleComposer.tsx |
| KUN-82 | „🗑 Löschen" (nur pending/failed) | button + confirm (`"Dieses Bundle wirklich löschen? …"`) | Löscht unveröffentlichtes Bundle | POST /api/admin/bundles/delete `{id}` | kunden/BundleComposer.tsx |
| KUN-83 | „↗ Angebots-Link" (nur active) | link (target=_blank) | Getrackter `/api/r/<token>`-Link | – | kunden/BundleComposer.tsx |
| KUN-84 | „Entfernen" (nur active) | button + confirm („Set entfernen?" — Link ungültig, Set-Produkt in Shopify gelöscht) | Löscht das Shopify-Produkt, setzt expired | POST /api/admin/bundles/archive `{id}` | kunden/BundleComposer.tsx |
| **Sub-Tab Korrespondenz (KorrespondenzPanel)** ||||||
| KUN-85 | Zähler „Noch keine E-Mails mit diesem Kunden." / „N Nachricht(en) in M Thread(s)." | display | – | server-render | kunden/tabs/KorrespondenzTab.tsx |
| KUN-86 | „✉ Neue E-Mail" | button | Öffnet Composer (neuer Thread) | client-only | kunden/tabs/KorrespondenzTab.tsx |
| KUN-87 | Composer-Kopf „Neue E-Mail an <email>" / „Antwort an <email>" + „✕" Schließen | display + button | – | client-only | kunden/tabs/KorrespondenzTab.tsx |
| KUN-88 | „Betreff" (Placeholder „Betreff der E-Mail" / „Re: …", bei Antwort mit „Re: " vorbelegt) | input | – | client-only | kunden/tabs/KorrespondenzTab.tsx |
| KUN-89 | „Nachricht" (Textarea 6 Zeilen, max 20000) | textarea | – | client-only | kunden/tabs/KorrespondenzTab.tsx |
| KUN-90 | „📤 Senden" / „Sende…" | button + confirm (`"E-Mail an … senden?"`) | Versand über sendEmail-Chokepoint; Warn-Toast „Leerer Text" | POST /api/admin/correspondence/send `{customerId, subject?, body, inReplyToMessageId?}` → refresh | kunden/tabs/KorrespondenzTab.tsx |
| KUN-91 | „👁 Vorschau" (EmailPreviewButton) | button → dialog | Schlichte Text-Vorschau | POST /api/admin/correspondence/email-preview `{body}` | kunden/tabs/KorrespondenzTab.tsx |
| KUN-92 | „Abbrechen" | button | Schließt Composer | client-only | kunden/tabs/KorrespondenzTab.tsx |
| KUN-93 | Leerzustand „Sobald du eine E-Mail schreibst oder der Kunde antwortet, erscheint hier der Verlauf." | display | – | – | kunden/tabs/KorrespondenzTab.tsx |
| KUN-94 | Thread-Karte: Betreff („(kein Betreff)") + „↩ Antworten" | display + button | Antwort auf letzte Nachricht des Threads | client-only | kunden/tabs/KorrespondenzTab.tsx |
| KUN-95 | Nachrichtenzeile: Badge „Eingegangen"/„Gesendet", Snippet („(kein Vorschautext)"), 📎 N, Datum/Zeit, ▸/▾ | button (expand) | Lädt Body lazy beim Aufklappen | POST /api/admin/correspondence/message `{id}` | kunden/tabs/KorrespondenzTab.tsx |
| KUN-96 | Aufgeklappt: „Von … · An … · Marketing-Versand", „Lade Inhalt…", Body (Markdown) / „Kein Inhalt." / „Kein Textinhalt.", Anhang-Badges | display | – | – | kunden/tabs/KorrespondenzTab.tsx |
| **Sub-Tab Brief (PhysicalLetterPanel)** — 2026-10: + Widerspruch gegen Briefwerbung (KUN-128); 2026-10-03: nur noch Kaufadresse + „Adresse aus letzter Bestellung holen“ (KUN-135) ||||||
| KUN-97 | Kopf „📮 Brief (Postversand)" | display | – | – | kunden/tabs/BriefTab.tsx |
| KUN-98 | „✨ Brief-Entwurf generieren" / „Neu generieren" / „Generiere…" | button | KI-Briefentwurf, danach automatisch PDF-Vorschau | POST /api/admin/customers/letter-draft `{customerId, adminInstructions}` + POST /api/admin/customers/letter-preview | kunden/tabs/BriefTab.tsx |
| KUN-99 | „Hinweise für den Brief (optional)" (Textarea 2 Zeilen, max 2000) | textarea | Anweisungen | client-only | kunden/tabs/BriefTab.tsx |
| KUN-100 | „Betreff" (Placeholder „Briefbetreff") | input | – | client-only | kunden/tabs/BriefTab.tsx |
| KUN-101 | „Brieftext (bearbeitbar)" (Textarea 10 Zeilen, max 20000) | textarea | – | client-only | kunden/tabs/BriefTab.tsx |
| KUN-102 | „💾 Entwurf speichern" / „Speichere…" | button | Persistiert Briefentwurf | POST /api/admin/customers/letter-draft `{customerId, save:true, subject, body}` | kunden/tabs/BriefTab.tsx |
| KUN-103 | „👁 Vorschau aktualisieren" / „Aktualisiere…" | button | Rendert PDF neu (blob → iframe) | POST /api/admin/customers/letter-preview `{customerId, subject, body}` | kunden/tabs/BriefTab.tsx |
| KUN-104 | „📤 Brief senden" / „Übermittle…" (disabled mit title = Grund) | button + confirm (`"Brief an … über Pingen versenden?"`) | Speichert, dann Versand an Pingen; Toast „Brief übermittelt" | POST letter-draft save + POST /api/admin/physical/send `{customerId}` → refresh | kunden/tabs/BriefTab.tsx |
| KUN-105 | „PDF-Vorschau" iframe (520px, title „Brief-Vorschau") | display (iframe) | Druckvorschau | blob URL | kunden/tabs/BriefTab.tsx |
| KUN-106 | Grund-Text unter Buttons (physicalReason vom Server / „Zuerst einen Brief-Entwurf generieren.") | display | Warum Senden gesperrt | server-render (`physicalEligibilityForCustomer`) | kunden/tabs/BriefTab.tsx |
| KUN-107 | „Noch kein Brief versendet." / „Gesamt: N Brief(e) · Porto ~X €" + Liste (Status-Badge Angelegt/Übermittelt/In Warteschlange/Wird gedruckt/Gedruckt/Versendet/Fehler/Storniert/Unzustellbar, Datum, „Betreff", Ort, Kosten, Fehler) | display | Briefhistorie | server-render | kunden/tabs/BriefTab.tsx |
| KUN-108 | Filter „Herkunft" (Alle · Chat · Newsletter · Shopify-Konto) und „Persona" (alle Archetypen + „Ohne Persona"), zählen in „Zurücksetzen (n)" | select | Alle Kunden inkl. Kampagne-Kontakte eingrenzen. **2026-10:** „Herkunft“ ❌ abgelöst → „Shop“ (Shopify-Kunden / Interessenten) und „Mo“; „Persona“ bleibt (unter „Weitere Filter“, KUN-117) | client-only (`admin-customer-filter.mjs`) | kunden/KundenWorkspace.tsx |
| KUN-109 | Badges je Zeile/Kopf: Herkunft (Newsletter / Shopify-Konto; Chat ohne Badge), Persona (Kurzlabel, Tooltip) | display | **2026-10:** Herkunfts-Badge → `ShopBadge` („Shop“ / „Interessent“, Tooltip) + `MoBadge` („Mo n×“, KUN-119); Persona bleibt | server-render (`listCustomers`: `source`, `persona_label`) | kunden/badges.tsx |
| KUN-110 | Profil-Fakten über dem Text: Persona, Niveau, Budget-Signal, Ziele, Besitzt, Interessen, Nächste Schritte (nur Bekanntes) | description list | Strukturiertes Kundenprofil (Migration 0059). **2026-10:** im Reiter „Überblick“ | GET customers/detail (`profileData`) | kunden/tabs/ProfilTab.tsx |
| KUN-111 | „Löschen" im Kundenkopf → Dialog „Kunde vollständig löschen?" (Endgültig löschen) → Toast „Kunde vollständig gelöscht", Auswahl und `?customer=` weg | button + confirm | Komplette Löschung (DSGVO) — derselbe Pfad wie Widget-Button und Mail-Link. **2026-10:** bei Shopify-Kund:innen nennt der Dialog die Bestellkopien und dass Shopify gebeten wird, die Kundendaten ebenfalls zu löschen (Erasure-Tombstone; Outbox `consent_update` „abgemeldet“ über `SHOPIFY_CONSENT_WRITEBACK` + `data_erasure` über `SHOPIFY_ERASURE_SYNC`). **Nachtrag 2026-10:** der Dialogtext folgt `SHOPIFY_ERASURE_SYNC` (`customer.shopifyErasureSync`) — an: „Zusätzlich wird Shopify gebeten, die Kundendaten dort ebenfalls zu löschen …“; aus: „In Shopify wird sie von E-Mail-Werbung abgemeldet; die Löschung des Shop-Kundenkontos wird vorgemerkt und erst weitergegeben, wenn die Weitergabe von Löschungen eingeschaltet ist (SHOPIFY_ERASURE_SYNC).“ | POST /api/admin/customers/erase `{customerId, confirm:true}` | kunden/CustomerDetail.tsx, lib/customer-erasure.ts |
| KUN-112 | Marketing-Tab oben: „Werbe-Einwilligung" (Chat-Newsletter, Shopify-Newsletter (Kampagne)); „Abmelden" → Dialog; bei Sperre Callout „Abgemeldet seit …" + Grund, „Abmeldung aufheben" (nur Abmeldelink/manuell; Bounce/Spam/Löschung mit Begründung gesperrt) | section + buttons + confirm | Manuelle Abmeldung auf Wunsch, versehentliche Abmeldung zurücknehmen — ohne E-Mail. **2026-10:** die zwei Zeilen „Chat-Newsletter“ / „Shopify-Newsletter (Kampagne)“ ❌ → die eine Einwilligung „E-Mail-Werbung · Seit · Quelle“ + „Verlauf (n)“ (KUN-127); Abmelden / Aufheben gehen über `consent-flows.ts` auch an Shopify | POST /api/admin/customers/marketing-optout `{customerId, action, confirm:true}` | kunden/tabs/OptOutControl.tsx, lib/marketing-optout.ts |
| **Kundenplattform (ab 2026-10-01)** ||||||
| KUN-113 | Kopfzeile „N Kunden · N Interessenten · N mit Mo · N mit Einwilligung · N mit offenen Aufgaben“ (je Zahl ein Klick auf die passende Ansicht) + InfoTip „Der Kundenstamm umfasst …“ | display + buttons | Größe des Kundenstamms auf einen Blick | server-render (`getCustomerBaseSummary`) | kunden/KundenWorkspace.tsx |
| KUN-114 | Callout „Shopify-Kundenstamm noch nicht übernommen“ (Text je nach `SHOPIFY_CUSTOMER_SYNC_ENABLED`: Hinweis auf Einstellungen → Shopify-Abgleich) | display (info) | Bis zum ersten Import zeigt die Liste nur Mo-Personen | server-render (`getSyncHealth().importDone`) | kunden/KundenWorkspace.tsx |
| KUN-115 | Select „Ansicht“: Alle · Mit Mo gesprochen · Noch ohne Mo · Mit Einwilligung · Offene Aufgaben · Neu (30 Tage) · Top-Kunden (ab 1.500 €, nach Umsatz) · Abwanderungsgefahr · Interessenten · Aktiv, ohne Einwilligung | select (preset) | Setzt die übrigen Felder (`CUSTOMER_VIEWS`); `?kview=` | router.push → server-render | kunden/KundenWorkspace.tsx, lib/admin-customer-filter.mjs |
| KUN-116 | Selects „Einwilligung“ (Einwilligung / Bestätigung offen / Abgemeldet / Ohne Einwilligung / Gesperrt; `?kconsent=`) und „Lebenszyklus“ (Frisch gekauft … Ruhen lassen, Ohne Bestellung; `?kseg=`) | select (filter) | Über `customer_overview` | router.push → server-render | kunden/KundenWorkspace.tsx |
| KUN-117 | Popover „Weitere Filter (n)“: Mo (Mit Mo gesprochen / Noch ohne Mo, `?kmo=`), Wert (Kleinteile / Komponenten / Großgeräte, `?kvalue=`), Persona (+ „Ohne Persona“, `?kpersona=`), Shop (Shopify-Kunden / Interessenten, `?kshop=`), Abwanderung (niedrig / mittel / hoch, `?kchurn=`) | popover + selects | Zähler = Abweichungen von der Ansicht | router.push → server-render | kunden/KundenWorkspace.tsx |
| KUN-118 | Suche „Name oder E-Mail“ `#ms-search` (350 ms, `?kq=`), Sortierung (`?ksort=`), `Pagination` 50 je Seite (`?kpage=`); `?customer=` bleibt beim Filtern erhalten. **Nachtrag 2026-10:** eine Seite hinter dem Ende (alter Link, engerer Filter) zeigt Seite 1 statt „0 Personen“ (`KundenTab.tsx`) | search + select + pagination | Ganze Kundenbasis serverseitig (keine Liste im Browser) | `listCustomers(filter)` (`customer-list-store.ts`); JSON-Zwilling GET /api/admin/customers/list | kunden/KundenWorkspace.tsx, KundenTab.tsx |
| KUN-119 | Kundenzeile: Name/E-Mail, Punkt bei offenen Eingang-Aufgaben, letzte Aktivität, „n × · Umsatz“, Badges Shop/Interessent, Mo (n×, Tooltip), Einwilligung, Lebenszyklus, Abwanderung (mittel/hoch), Persona | list item | „mit Mo“ vs. „ohne Mo“ auf einen Blick | server-render | kunden/KundenWorkspace.tsx, kunden/badges.tsx |
| KUN-120 | Streifen unter dem Detailkopf ohne Einwilligung: „Keine Einwilligung für E-Mail-Werbung — nur ansehen: keine Kampagne, keine Einzelansprache, kein Set-Angebot per Mail.“ bzw. „Adresse gesperrt — …“ | display | Profil sichtbar, Werbeaktionen gesperrt (Server-Gates erzwingen es) | GET customers/detail (`consent.sendable`) | kunden/CustomerDetail.tsx |
| KUN-121 | Reiter „Überblick“: „Kennzahlen“ (Bestellungen, Umsatz, Ø Bestellwert, Erster/Letzter Kauf, Kaufrhythmus, Lebenszyklus, Wertstufe, Abwanderungsrisiko, Nächster Kauf erwartet, Kampagnen-Mails + Klicks 90 T., Kategorien; „Stand …“ / „Noch nicht berechnet …“), „Datenquellen“ (Shopify seit …, Mo n Gespräche, E-Mail n Nachrichten) + Shopify-Tags, darunter das Profil (KUN-35…38, KUN-110). **Nachtrag 2026-10:** InfoTip „Wertstufe: der teuerste einzelne Artikel, der je gekauft wurde.“ | display | `customer_facts` (0063) | GET customers/detail (`figures`) | kunden/tabs/UeberblickTab.tsx |
| KUN-122 | „Sprache für E-Mails“ `SegmentedControl` Automatisch / Deutsch / Englisch (InfoTip). **Nachtrag 2026-10:** schlägt das Speichern fehl, springt der Schalter auf den gespeicherten Wert zurück | segmented | Fest für alle Kampagnen und die Einzelansprache; offene Empfänger folgen sofort | POST /api/admin/customers/language `{customerId, language}` (`setCustomerLanguageOverride`, `customer-store.ts`) | kunden/tabs/UeberblickTab.tsx |
| KUN-123 | Reiter „Aktivität“: eine Zeitleiste (Bestellungen, Gespräche mit Mo, Kampagnen-Mails, Einwilligungs-Änderungen, ein-/ausgehende Mails), neueste zuerst; leer „Noch keine Aktivität“ | timeline | – | `buildCustomerTimeline` (`src/lib/customer-timeline.mjs`, rein, getestet) | kunden/tabs/AktivitaetTab.tsx |
| KUN-124 | Reiter „Käufe“ (gespiegelte Kund:innen): „Bestellungen“ (InfoTip; „n bezahlt · Umsatz · Ø“) als `DataTable` Artikel (Menge × Titel; Bestellnr. · Code · storniert) / Datum / Summe / Status; die neuesten 50 von n | table | Bestell-Kopie (0062) per Webhook + nächtlichem Abgleich | GET customers/detail (`orders`, `ordersTotal`) | kunden/tabs/KaeufeTab.tsx |
| KUN-125 | Marketing: Block „Einzelansprache“ (InfoTip) — Notiz „Hinweis für die KI“ (≤ 1500) + „Einzelansprache vorbereiten“ → Entwurf in der Kampagne „Einzelansprache“, Sprung in den Prüftisch; bei offener Teilnahme Status + „Im Prüftisch öffnen“. Ohne Einwilligung stattdessen der Grund (Callout) | textarea + button | Plan D-8: der 1:1-Mail-Weg ist eine Kampagne (gleiche Prüfungen, Sperren, MK-Codes) | POST /api/admin/campaigns/add-recipient `{customerId, adminNote, draft:true}` | kunden/tabs/MarketingTab.tsx |
| KUN-126 | Marketing: Liste „Kampagnen“ (Kampagne, Status Offen / Entwurf bereit / Wird gesendet / Gesendet / Übersprungen / Gesperrt / Nicht mehr in der Zielgruppe / Entwurf fehlgeschlagen, Datum, Betreff, „geklickt“, „danach abgemeldet“); leer „Noch in keiner Kampagne.“ **Nachtrag 2026-10:** „geklickt“ zählt jeden Klick (Button oder Set-Link), ebenso „angeklickt“ in der Aktivität und im Kampagnenverlauf des KI-Profils | list | Teilnahme je Kampagne | GET customers/detail (`campaigns`, `listCampaignParticipation`) | kunden/tabs/MarketingTab.tsx |
| KUN-127 | Werbe-Einwilligung: „E-Mail-Werbung“ (z. B. „Angemeldet (DOI)“), „Seit“, „Quelle“ (Mo · Chat / Mo · Zusammenfassungs-Formular / Mo · nach Anmeldung / Shopify / Team (Admin) / Übernahme) + Disclosure „Verlauf (n)“ aus `consent_events` | description list + disclosure | Die eine Einwilligung (0064) mit Nachweis | GET customers/detail (`consent`) | kunden/tabs/OptOutControl.tsx |
| KUN-128 | Brief: „Widerspruch gegen Briefwerbung eintragen“ → Dialog → Brief-Reiter zeigt nur noch „Widerspruch … seit … — keine Briefe.“ + „Aufheben“; Briefentwurf wird gelöscht, `letter-draft` antwortet 409 `objection` | button + confirm | Art. 21 DSGVO (`postal_objection_at`) | POST /api/admin/customers/objection `{customerId, kind:"postal", objected}`; jeder Brief trägt im Fuß den Widerspruchshinweis (`LETTER_OBJECTION_NOTICE`, Art. 21 Abs. 4) | kunden/tabs/BriefTab.tsx, lib/letter-pdf.mjs |
| KUN-129 | Profil: Badge „Vollprofil“ / „Kaufprofil“; ohne Erlaubnis statt des Buttons „Kein KI-Profil ohne Einwilligung“ (InfoTip `CUSTOMER_AI_PROFILE_SCOPE`); „Widerspruch gegen Profilbildung eintragen“ → Dialog → Profil gelöscht, Hinweis „Widerspruch gegen Profilbildung seit … — kein KI-Profil.“ + „Aufheben“. **Nachtrag 2026-10:** der Widerspruch entfernt auch Mos `mo-`-Tags in Shopify (EIN-12) | badge + button + confirm | Profiltiefe; Art. 21 (`profile_objection_at`); `customers/profile` antwortet 409 `profile_not_allowed` | POST /api/admin/customers/objection `{kind:"profile"}` | kunden/tabs/ProfilTab.tsx, UeberblickTab.tsx |
| KUN-130 | Detailkopf: Shop-/Interessent-Badge, Tier 3 (nur dann), Mo-Badge, Persona, „↻ n×“, Einwilligung lang, Löschen | badges | Ersetzt Tier/Herkunft/Marketingstatus im Kopf | GET customers/detail | kunden/CustomerDetail.tsx |
| KUN-131 | Überblick → Kennzahlen: „Wahrscheinlich als Nächstes“ (InfoTip) — ergänzende Produkte zu dem, was die Person besitzt, mit Preis | display | Aus den nächtlichen Fakten (`complement_handles`) + Katalog | GET customers/detail (`nextLikely`) | kunden/tabs/UeberblickTab.tsx, lib/customer-detail.ts |
| KUN-132 | Aktivität: Block „Frag Mo“ (InfoTip; **Nachtrag 2026-10:** jede beantwortete Frage schreibt das Admin-Zugriffsprotokoll `customer.ask`) — Frage zu dieser Person (≥ 3 Zeichen, ≤ 500) + „Fragen“ → Antwort aus der Akte mit Quellen „[n] Datum · Art · Titel“, Hinweis „Berücksichtigt: die neuesten n von m Einträgen.“ | input + button | Ein KI-Aufruf (writer tier); Profil nur ohne Art.-21-Widerspruch; nichts wird gespeichert außer der KI-Nutzung | POST /api/admin/customers/ask `{customerId, question}` | kunden/tabs/AktivitaetTab.tsx, lib/customer-ask.ts, lib/customer-ask-core.mjs |
| KUN-133 | **Nachtrag 2026-10:** „Auswählen“ über der Liste → Checkbox je Zeile + „Alle auf dieser Seite auswählen“ (tri-state), „n ausgewählt“, „Zur Kampagne…“ (Popover „n Personen hinzufügen“ + InfoTip: nur mit Einwilligung und ohne Sperre, die übrigen werden übersprungen; Entwürfe entstehen im Prüftisch, nichts wird gesendet) mit Select „Kampagne“ (alle nicht beendeten / archivierten, Einzelansprache zuerst und vorausgewählt), „Notiz für den KI-Texter (optional)“ (≤ 2000) und „Hinzufügen“; „Fertig“ verlässt den Modus; Toast „n hinzugefügt“ + „n waren schon dabei · n übersprungen (keine Einwilligung oder gesperrt)“ | checkboxes + popover + select + textarea | Ersatz der Sammel-Entwurf-Leiste (KUN-13, 16, 25…29; Plan §18): viele Personen in eine Kampagne, Einwilligung je Person geprüft | POST /api/admin/campaigns/add-recipients `{customerIds (≤ 200), campaignId?, adminNote?}` | kunden/KundenWorkspace.tsx, KundenTab.tsx |
| KUN-134 | **Nachtrag 2026-10:** Überblick → Disclosure „Ähnliche Kunden“ (nur mit Bestellungen; lädt beim Öffnen; InfoTip): bis zu 8 Personen mit gleicher Wertstufe und mindestens einer gemeinsamen gekauften Kategorie (meiste Gemeinsamkeiten zuerst, dann gleiches Segment, Persona, Umsatz), je Link auf die Person, gemeinsame Kategorien, Badge „ohne Einwilligung“; „n von m per E-Mail erreichbar.“ + „Als Zielgruppe verwenden“ → `?tab=kampagne&edit=new&audience=<json>` (Wertstufe + bis zu 6 Kategorien) | disclosure + links | Zielgruppe aus einem Vorbild, deterministisch, keine Tokens | GET /api/admin/customers/similar?id= (`listSimilarCustomers`) | kunden/tabs/UeberblickTab.tsx, lib/customer-list-store.ts |
| KUN-135 | **Nachtrag 2026-10-03 (Migration 0074):** Brief: für Werbebriefe zählt nur noch die Lieferadresse der letzten abgeschlossenen Bestellung (Quelle `purchase`) — jede andere gespeicherte Adresse (z. B. die Konto-Adresse, `consented_capture`) wird beim Senden abgelehnt (`not_purchase_address`), ebenso eine als unzustellbar gemeldete (`address_invalid`); vorher genügte jede vollständige Adresse. Ohne verwendbare Kaufadresse Button „Adresse aus letzter Bestellung holen“ → Toast „Adresse aus der letzten Bestellung übernommen“ bzw. „Keine abgeschlossene Bestellung“ / „Die letzte Bestellung hat keine vollständige Lieferadresse“ | button + behaviour | Brief nur an die Adresse aus dem Kauf (Dossier § 6.4, § 18) | POST /api/admin/customers/letter-address `{customerId}` (Zugriffsprotokoll `customer.letter_address`; 403 `flag_off` ohne `PHYSICAL_MAIL_SENDS_APPROVED`), POST /api/admin/physical/send (409 `not_purchase_address` / `address_invalid`) | kunden/tabs/BriefTab.tsx, lib/postal-address-fill.ts, lib/physical-address.mjs (`decidePhysicalEligibility`, getestet), lib/physical-mail.ts |

### Helper/explanatory text (Kunden) — 62
Unmatched-Queue / Workspace (heute `eingang/UnmatchedInbound.tsx`, `kunden/KundenWorkspace.tsx`):
1. „Antworten von Adressen, die zu keinem Kunden passen. Ordne jede einem Kunden zu — sie wandert…" — eingang/UnmatchedInbound.tsx (2026-10: wortgleich als InfoTip in `eingang/UnmatchedInbound.tsx`)
2. Placeholder „z. B. müller oder @gmail" — kunden/KundenWorkspace.tsx
3. „Keine Kunden für diese Suche/Filter." — kunden/KundenWorkspace.tsx
4. „Wähle links einen Kunden, um Profil, Käufe, Marketing & mehr zu sehen." — kunden/KundenWorkspace.tsx
5. „Alle bestätigten (N) für Sammel-Entwurf" — kunden/KundenWorkspace.tsx
6. „Erstellt je Kund:in einen Entwurf zur Prüfung — es wird nichts gesendet." — kunden/KundenWorkspace.tsx
7. Toast „N Entwurf/Entwürfe zur Prüfung erstellt — sichtbar im Marketing-Tab des Kunden." — kunden/KundenWorkspace.tsx
8. Toast „Alle N fehlgeschlagen — z. B. …" / „N von M erstellt, K fehlgeschlagen…" — kunden/KundenWorkspace.tsx
CustomerProfileCard (heute `kunden/CustomerDetail.tsx`, `kunden/tabs/*`, `kunden/BundleComposer.tsx`):
9. „Zuerst: … · Zuletzt: …" — kunden/CustomerDetail.tsx, kunden/tabs/*
10. title „Identitätsstufe"
11. title „Mehrere Sessions unter derselben E-Mail"
12. „Noch kein Profil generiert."
13. „Jede Generierung ist ein KI-Durchlauf (Anthropic Claude) über alle verknüpften Gespräche + Kaufhistorie und kostet Tokens." + „Letzter Lauf: …"
14. „Keine Konversation verknüpft — die E-Mail wurde erfasst, aber die zugehörige Session ist nicht (mehr) gespeichert." —
15. „noch nicht geladen" (Meta Käufe)
16. „Noch keine Kaufhistorie geladen."
17. „Keine Bestellungen unter dieser E-Mail gefunden."
18. „Liste ggf. gekürzt (nur die neuesten Bestellungen)."
19. „Kein lesbares Transkript."
20. „Keine Marketing-Einwilligung — es kann keine Marketing-E-Mail generiert werden." —
21. „Double-Opt-In noch nicht bestätigt — bis dahin keine Marketing-E-Mail." —
22. „Abgemeldet — es wird keine Marketing-E-Mail mehr generiert oder gesendet." —
23. Toast „Rabatt, Textmodus oder Hinweise geändert" / „Bitte zuerst neu generieren, damit Text und Eingaben übereinstimmen."
24. „Du kannst unten jederzeit eine neue personalisierte E-Mail generieren."
25. Placeholder „z. B. "Erwähne die neue Rudergeräte-Linie", "Bundle anbieten", "Sie hatte nach Lieferung nach Österreich gefragt""
26. „Wird der KI als Team-Anweisung mitgegeben (klar getrennt von den Kundendaten) und am Entwurf gespeichert (Audit-Trail)."
27. „0 = kein Rabatt, kein Code" / „0–50 %"
28. Textmodus-Hinweis (EMAIL_TEXT_MODE_HINTS: „Mehr Text: 3–5 kurze Absätze, die das Kundenwissen einweben." / „Kurze Begrüßung + 2–3 Sätze — die Produktbilder tragen die Botschaft." / „Nur Anrede + ein Satz — die E-Mail wirkt wie ein visuelles Lookbook.") —, src/lib/email-text-mode.mjs
29. „Rabatt, Textmodus oder Hinweise geändert — der aktuelle Text passt nicht mehr." —
30. „Vorschau mit Platzhalter-Code MO-XXXX. Den Platzhalter im Text bitte nicht ändern — er wird beim Versand durch den echten, einmaligen N%-Code (7 Tage gültig) ersetzt." —
31. „Kein Rabatt gewählt — der Text nennt keinen Code, der Warenkorb-Link enthält keinen Rabatt." —
32. „Beim Versand werden Warenkorb-Button & Abmeldelink automatisch angehängt [und der einmalige Rabattcode erzeugt]. Gesendet wird nur an bestätigte, nicht abgemeldete Adressen."
33. Vorschau-Dialogtext „So wird die E-Mail im Postfach gerendert (inkl. Produktbilder, Bundle und Footer). Der Rabatt zeigt den Platzhalter-Code MO-XXXX — …" / „Der getrackte Warenkorb-Link entsteht erst beim Senden." —
34. title „Bitte zuerst neu generieren"
35. „Der Entwurf nutzt ALLES zu diesem Kunden: alle verknüpften Gespräche, das aktuelle Kundenverständnis und die Kaufhistorie (bereits Gekauftes wird nicht erneut empfohlen). Ein KI-Durchlauf — kostet Tokens." —
36. „KI-Durchlauf über Profil, Gespräche & Käufe — kostet Tokens." —
37. Toast „N Produkte — du kannst frei anpassen." —
38. „Komponentensumme: …"
39. „Ausverkauft — nicht hinzufügbar" (disableReason) —
40. „⚠ Preis über der Komponentensumme (X) — es wird KEINE „statt"-Zeile angezeigt (das Bundle ist nicht günstiger als die Einzelprodukte)." —
41. Toast „Ein Bundle braucht 2–5 Produkte." / „Bitte einen Bundle-Preis größer als 0 € angeben."
42. Toast „An die E-Mail angehängt. Tipp: E-Mail neu generieren, damit der Text das Set erwähnt." / „Es wird an die nächste generierte E-Mail angehängt."
43. „Bundles für <email> (N)"
44. „Erstellt <Datum> · läuft ab <Datum>"
45. Confirm „Set entfernen?" / „Der Angebots-Link wird ungültig und das Set-Produkt in Shopify gelöscht." — kunden/BundleComposer.tsx
46. Confirm „Dieses Bundle wirklich löschen? Es kann nicht wiederhergestellt werden."
47. Confirm „Diesen Entwurf wirklich löschen? Er kann nicht wiederhergestellt werden."
48. Confirm „E-Mail an <email> wirklich senden?"
KorrespondenzPanel (heute `kunden/tabs/KorrespondenzTab.tsx`):
49. „Noch keine E-Mails mit diesem Kunden." / „N Nachricht(en) in M Thread(s)." — kunden/tabs/KorrespondenzTab.tsx
50. „Sobald du eine E-Mail schreibst oder der Kunde antwortet, erscheint hier der Verlauf."
51. „(kein Vorschautext)" / „(kein Betreff)"
52. „Von … · An … · Marketing-Versand"
53. „Lade Inhalt…" / „Kein Inhalt." / „Kein Textinhalt."
54. Placeholder „Deine Nachricht an den Kunden…"
55. „Wird über den zentralen Versandweg gesendet (Absender: motion sports). Antworten des Kunden landen wieder hier im Verlauf."
56. Vorschau-Dialogtext „So wird deine Nachricht beim Kunden gerendert — bewusst schlichtes Text-Layout ohne Marketing-Elemente." —
57. Toast „Bitte einen Nachrichtentext eingeben."
PhysicalLetterPanel (heute `kunden/tabs/BriefTab.tsx`):
58. „Eigener, für den Druck optimierter Text (kein Warenkorb-Button, kein Abmeldelink). Wird als PDF gerendert und über Pingen an die hinterlegte Postadresse versendet." — kunden/tabs/BriefTab.tsx
59. Placeholder „z. B. "Lieferung nach Österreich erwähnen", "auf die neue Rudergeräte-Linie hinweisen""
60. „Nach Textänderungen „Vorschau aktualisieren" klicken. Ohne hinterlegte Adresse zeigt die Vorschau einen Platzhalter im Adressfeld."
61. „Zuerst einen Brief-Entwurf generieren." / Server-Grund (`physicalReason`)
62. „Noch kein Brief versendet." / „Gesamt: N Brief(e) · Porto ~X €"

### Persistenter Zustand (Kunden)
- **2026-10:** Suche, Ansicht, Filter, Sortierung und Seite stehen in der URL (`?kq= ?kview= ?kmo= ?kconsent= ?kseg= ?kvalue= ?kpersona= ?kshop= ?kchurn= ?ksort= ?kpage=`, router.push), die Person in `?customer=` (replaceState); `?filter=` wird nicht mehr gelesen (**Nachtrag 2026-10:** außer `marketing` / `no_purchase` ohne `?kview=`, SHL-14). Die Auswahl von KUN-133 ist flüchtiger React-State. Serverseitig neu: `customers.language_override`, `profile_objection_at`, `postal_objection_at` (0061), Einwilligung + Verlauf (0064).
- Kein localStorage/Cookie. Der Detail-Reiter, mit dem eine Person öffnet, kann per `?ctab=` vorgegeben werden (z. B. `korrespondenz` aus dem Eingang); sonst ist der Reiter flüchtiger React-State.
- Serverseitig persistiert: adminInstructions am Draft, letterDraftSubject/Body am Kunden.

---

## 4. Kampagne (`KampagneTab.tsx`, `kampagne/*`) — seit 2026-10 „Kampagnen“ (`kampagnen/*`)

### Beschreibung
**Stand 2026-10-01: viele Kampagnen** (Migration 0066, docs/CAMPAIGNS.md §2). Statt EINER impliziten Kampagne über die Shopify-Newsletter-Abonnent:innen gibt es die Tabelle `campaigns` (Art Laufend · Aktion · Einzelansprache; Status Entwurf · Aktiv · Pausiert · Beendet · Archiviert, dazu die Zeit-Phasen Geplant · Läuft · Abgelaufen aus `campaignPhase`, `src/lib/campaign-def.mjs`); `campaign_contacts` sind jetzt die Empfänger je Kampagne (und Zyklus). Bestehende Kontakte wurden zur Kampagne „Bestandskunden – Lebenszyklus“ (`lebenszyklus`); die Systemkampagne „Einzelansprache“ (`einzelansprache`) trägt die 1:1-Mails aus Kunden und Eingang. Zielgruppen sind Filter über die ganze Kundenbasis (`customer_overview`, `src/lib/audience-spec.mjs` + `src/lib/audience-store.ts`); Einwilligung „subscribed“ und keine Sperre sind immer Pflicht. Ohne `?campaign=` zeigt `KampagneTab` die Übersicht (`kampagnen/CampaignsOverview.tsx`, Editor `kampagnen/CampaignEditor.tsx`, `?edit=<id|new>`), mit `?campaign=<slug|id>` den bisherigen Prüftisch für genau diese Kampagne (ein Legacy-Link nur mit `?contact=` öffnet die Kampagne des Empfängers). Der Shopify-Abonnenten-Sync ist abgelöst (KAM-06). Neue Fähigkeiten: KAM-96…106.

**Stand 2026-09-13: Review-Desk** (docs/archive/KAMPAGNE_REDESIGN.md, docs/ADMIN_DASHBOARD.md §3.2). `KampagneTab` (Server) lädt parallel `getCampaignCounts()`, `listDraftedQueue()` (inkl. Hero-Stand, letzter kanalübergreifender Sendung, Entwurfsalter), `listSkippedContacts()`, das Kampagnen-Design (`getCachedEmailDesignForKind`), `estimateCampaignCosts()` und `getCampaignDeliverySummary(30)`, löst empfohlene Produkte via `resolveProductSelections` → `recommendationView` (Name, Link, Bild, Preis, Verfügbarkeit), holt aktive Bundles per `listActiveBundlesForCampaignContacts` und reicht Flags (`isCampaignSendsApproved`, `isSingleOptInAllowed`, `isShopifyConfigured`, `emailDesignHasHero`, `isHeroGenerationConfigured`, `marketingMinSendIntervalDays`) sowie `?contact=`/`?view=`/`?filter=` durch. `KampagneWorkspace` (Client, `src/app/admin/kampagne/`) zeigt den Desk: Kopfzeile (`CampaignHeader`, `PreparePopover`), Rail (`QueueRail`), Mail-Spalte (`MailPane`, `useRenderedPreview`), Prüfspalte (`ReviewColumn`, `sections/*`), Ansichten Liste (`ListView`) und Gesendet (`SentHistory`), Verlauf (`ContactHistorySheet`); Zustand und Mutationen in `useCampaignActions` (id-basierte Auswahl, Busy-Map je Karte, Postausgang, Hintergrund-Jobs), Regeln in `src/lib/campaign-desk-core.mjs`, Prüfpunkte in `src/lib/campaign-review-checks.mjs`. Keine Aktion lädt die Seite neu (`router.refresh()` nach Batch-Jobs).

Die Zeilen **KAM-01…69** beschreiben die Elemente vor dem Desk (eine Datei `KampagneWorkspace.tsx`, Stand 2026-09-08). Jedes hat auf dem Desk einen Platz — die Zuordnung steht in [`archive/KAMPAGNE_REDESIGN.md`](./archive/KAMPAGNE_REDESIGN.md) §8 (kein Element entfernt); die Dateispalte nennt deshalb `kampagne/*`. Neue Fähigkeiten des Desks: KAM-70…91.

Die Beschreibung vor dem Desk (Stand 2026-09-08: eine Karte je Kontakt der Shopify-Newsletter-Abonnent:innen, Tasten `N/P/V/C/S/X`, mehrere Aktionen mit `window.location.reload()`) steht im Archiv ([archive](./archive/FEATURE_INVENTORY_AUDIT_2026-09.md) §B.1). Heute: Empfänger:innen sind Kund:innen mit Einwilligung je Kampagne; Desk-Tasten `N P V C S A X` (dazu `J/K`, `E`, `Esc`, `R`, `F`, `/`, `?` — §13); keine Aktion lädt die Seite neu (ADMIN_DASHBOARD §3.2).

### Controls & actions
| ID | Element | Type | What it does | Calls | File |
|---|---|---|---|---|---|
| KAM-01 | Banner „Keine Datenbank konfiguriert (DATABASE_URL) — das Kampagnen-Modul kann keine Kontakte laden." | display (warn) | – | server-render | KampagneTab.tsx |
| KAM-02 | Warnbox „Versand gesperrt: Die anwaltliche Freigabe … CAMPAIGN_SENDS_APPROVED=false …" | display (warn) | Senden deaktiviert | server flag | kampagne/* |
| KAM-03 | Infobox „Shopify ist nicht konfiguriert — Sync, Kaufhistorie und Rabattcodes sind deaktiviert." | display (info) | **2026-10:** InfoTip der Shopify-Pille: „… Rabattcodes und Set-Angebote sind deaktiviert.“ (kein Sync mehr) | server flag | kampagne/* |
| **Kopfzeile: Zähler + Aktionen** ||||||
| KAM-04 | HeaderStats „Offen", „Entwürfe", „Heute gesendet", „Übersprungen", „Unterdrückt", „Entwurf fehlgeschlagen" (warn, nur >0) | display (stat) | `getCampaignCounts` | server-render | kampagne/* |
| KAM-05 | „Opt-in: DOI n · Single-Opt-in n · Unbekannt n" | display | byOptInLevel | server-render | kampagne/* |
| KAM-06 | „↻ Sync" / „Sync läuft…" (disabled ohne Shopify) | button | Shopify-Abonnent:innen abgleichen; Toast mit total/neu/unterdrückt; reload. **❌ abgelöst 2026-10** → „Zielgruppe aktualisieren“ (KAM-100) über die Kundenbasis; Shopify-Seite: Spiegel + Webhooks + nächtlicher Abgleich (EIN-07). `/api/admin/campaign/sync` und `src/lib/campaign-sync.ts` entfernt | POST /api/admin/campaign/sync `{}` | kampagne/* |
| KAM-07 | Select „Rabatt-Tiefe für neue Entwürfe" (0 % Rabatt / 5 / 10 / 15 / 20 %) | select | Depth für Prepare/Draft/Unskip | client-only | kampagne/* |
| KAM-08 | Select „Textmodus für neue Entwürfe" (Ausführlich/Kompakt/Minimal; title „Wie viel Fließtext…") | select | Textmodus für Prepare/Draft | client-only | kampagne/* |
| KAM-09 | „Nächste 50 vorbereiten" / Fortschritt „k/50…" | button | 10 Chunks à 5 Drafts; Abschluss-Toast „N Entwürfe erstellt / k fehlgeschlagen, m unterdrückt"; reload | POST /api/admin/campaign/prepare `{count:5, discountPercent, textMode}` | kampagne/* |
| KAM-10 | „Warteschlange neu aufbauen" / „Setzt zurück…" | button → dialog | Öffnet Bestätigungsdialog | client-only | kampagne/* |
| KAM-11 | Dialog „Warteschlange neu aufbauen?" (Text + „Abbrechen" / „Entwürfe verwerfen") | dialog | Verwirft alle offenen Drafts; Toast „N Entwürfe verworfen"; reload | POST /api/admin/campaign/reset-queue `{}` | kampagne/* |
| **Sub-View + Filter** ||||||
| KAM-12 | „Warteschlange (n[/m])" | sub-tab (button) | Queue-Ansicht | client-only | kampagne/* |
| KAM-13 | „Gesendet (N)" | sub-tab (button) | Historie-Ansicht | client-only | kampagne/* |
| KAM-14 | Opt-in-Filter „Alle" / „Nur DOI" / „Nur Single/Unbekannt" | filter (buttons) | Filtert Arbeitsansicht, Index → 0 | client-only | kampagne/* |
| KAM-15 | Tasten-Hinweis „Tasten: N weiter · P zurück · V Vorschau · C kopieren · S senden · X überspringen" | display | – | – | kampagne/* |
| KAM-16 | Tastenkürzel N/P/C/S/X/V (nur Queue-View, nicht in Inputs, nicht bei offenem Dialog, kein Modifier) | keyboard shortcut | weiter/zurück/kopieren/senden/überspringen/Vorschau. **Nachtrag 2026-10-03:** + `A` „Einplanen“ (KAM-107); alle Desk-Tasten in §13 | client-only | kampagne/* |
| **Linke Rail (QueueRail)** ||||||
| KAM-17 | Suchfeld „Alle Kontakte durchsuchen…" (≥2 Zeichen, 250 ms Debounce) | input (search) | Globale Kontaktsuche über alle Status. **2026-10:** innerhalb der Empfänger der geöffneten Kampagne | POST /api/admin/campaign/contacts `{query, campaignId}` | kampagne/* |
| KAM-18 | „Sucht…" / „Keine Treffer." | display | – | – | kampagne/* |
| KAM-19 | Trefferzeile (Name, E-Mail) + Statusaktion: „Öffnen" (drafted) | button | Springt zur Karte, hebt Opt-in-Filter auf | client-only | kampagne/* |
| KAM-20 | Statusaktion „Entwurf erstellen" (pending/draft_failed) | button | Draft erzeugen + reload | POST /api/admin/campaign/draft `{contactId, discountPercent, textMode, regenerate:true}` | kampagne/* |
| KAM-21 | Statusaktion „Wiederherstellen" (skipped) | button | Unskip (+Draft falls pending) + reload | POST /api/admin/campaign/unskip `{contactId}` (+ /draft) | kampagne/* |
| KAM-22 | Status-Badges „Gesendet" / „Unterdrückt" / `<status>` | badge | – | – | kampagne/* |
| KAM-23 | „Warteschlange (N)" Liste: „i. Name" (+ ⚠ title „Kein nachweisbares Double-Opt-in"), aktiver Eintrag hervorgehoben, „Leer." | list (buttons) | Sprung zur Karte | client-only | kampagne/* |
| KAM-24 | „Übersprungen (N) ▸/▾" | button (collapse) | Zeigt übersprungene Kontakte | client-only | kampagne/* |
| KAM-25 | Übersprungen-Zeile + „Wiederherstellen"; leer „Keine übersprungenen Kontakte." | list + button | Unskip | POST /api/admin/campaign/unskip | kampagne/* |
| **Karte: Navigation** ||||||
| KAM-26 | Infobox „Keine Entwürfe in der Warteschlange. „Sync" holt …" | display (info) | Leerzustand. **2026-10:** „„Vorbereiten…“ erzeugt die Entwürfe der nächsten offenen Empfänger:innen, „Zielgruppe aktualisieren“ gleicht die Kundenbasis ab.“ bzw. für die Einzelansprache „Einzelne Kund:innen kommen über „Einzelansprache“ in Kunden oder über einen Vorschlag im Eingang hierher.“ | – | kampagne/* |
| KAM-27 | „Entwurf i von N" | display | Position | – | kampagne/* |
| KAM-28 | „← Zurück" / „Weiter →" | button | Index ±1 | client-only | kampagne/* |
| **Karte links: Kontakt-Kontext** ||||||
| KAM-29 | Name („(kein Name)") + E-Mail | display | – | server-render | kampagne/* |
| KAM-30 | LanguageToggle „DE"/„EN" (+ „✎" bei Override; title erklärt Ableitung) | toggle | Setzt Sprach-Override, dann Regenerate | POST /api/admin/campaign/language `{contactId, language}` + /draft | kampagne/* |
| KAM-31 | EmailTextModeToggle (Ausführlich/Kompakt/Minimal) | toggle (shared) | Wechselt Modus + Regenerate | POST /api/admin/campaign/draft `{…, textMode}` | kampagne/* |
| KAM-32 | OptInBadge „Double-Opt-in" (success) / „Single-Opt-in\|Unbekannt · Senden blockiert" (warning) | badge | – | – | kampagne/* |
| KAM-33 | SegmentBadge (Label aus `campaignSegmentByKey`, „· vor N T.", title = Grund) | badge | Lifecycle-Segment | – | kampagne/* |
| KAM-34 | AbGroupBadge „A/B: mit KI-Hero" / „A/B: ohne Hero" (title erklärt gerade/ungerade IDs) | badge | Hero-A/B-Hinweis | – | kampagne/* |
| KAM-35 | Badge „⚠ Empfehlungen unsicher" | badge | lowConfidence | – | kampagne/* |
| KAM-36 | „N Bestellungen · X € Umsatz" | display | – | – | kampagne/* |
| **Kaufhistorie (PurchaseHistorySection)** ||||||
| KAM-37 | „Kaufhistorie" + Checkbox „Alle" (tri-state, nur bei >1 wählbaren) | display + checkbox | Empfehlungsbasis alle/keine | client-only | kampagne/* |
| KAM-38 | Bestellungen (Name · Datum, Summe) mit Checkbox je katalog-gematchtem Artikel („n× Titel"), nicht-matchbare nur Text | list + checkbox | Auswahl der Basis | client-only | kampagne/* |
| KAM-39 | „Keine Bestelldetails verfügbar." | display | – | – | kampagne/* |
| KAM-40 | „Empfehlungsbasis: k von n Käufen ausgewählt." / „Ausgewählte Käufe sind die Basis für Empfehlungen und Text." | display | – | – | kampagne/* |
| KAM-41 | „Kaufauswahl wird nach „Neu generieren" verfügbar." | display | Legacy-Draft | – | kampagne/* |
| KAM-42 | „↻ Empfehlungen & Text neu erzeugen" / „Erzeugt neu…" (bei dirty) | button | Persistiert Auswahl, Recs + Text neu | POST /api/admin/campaign/draft `{…, refreshRecommendations:true, purchaseSelection}` | kampagne/* |
| KAM-43 | „Verwerfen" + Warnung „Mindestens einen Kauf auswählen." | button + display | Auswahl zurücksetzen | client-only | kampagne/* |
| **Empfehlungen (RecommendationsEditor)** ||||||
| KAM-44 | „Empfohlene Produkte · speichert…" | display | – | – | kampagne/* |
| KAM-45 | Liste Produktname (Link zu Shopify, target=_blank) + „✕" entfernen (disabled bei ≤1) / „Keine." | list + button | Entfernen → sofort persistiert + Bundle-Rebuild + Regenerate | POST /api/admin/campaign/recommendations `{contactId, productIds}` + /draft | kampagne/* |
| KAM-46 | CatalogProductPicker (Placeholder „Produkt suchen (tippen)…", max 6, ohne Thumbnails, Variantenwahl → `handle~variantId`) | input (search) | Produkt hinzufügen | POST /api/admin/catalog/search + /recommendations | kampagne/* |
| **Rabatt (DiscountControl)** ||||||
| KAM-47 | „Rabatt" Zahlenfeld (0–50) + „%" | input (number) | Depth | client-only | kampagne/* |
| KAM-48 | „Übernehmen" / „Speichert…" (disabled wenn unverändert) | button | Setzt Rabatt am Draft + Regenerate; Toast „Rabatt auf N % gesetzt"/„Rabatt entfernt" | POST /api/admin/campaign/discount `{contactId, discountPercent}` + /draft | kampagne/* |
| KAM-49 | Hinweistext „Aktuell N % — echter MK-Code wird beim Senden erzeugt (voraussichtlich gültig bis …). …" / „Kein Rabatt. …" | display | – | – | kampagne/* |
| **Set-Angebot (BundleSection)** ||||||
| KAM-50 | Angehängtes Set: Titel, Inhalt als Aufzählung mit Anzahl („2× A"), Preis „(statt …)", „· läuft ab …" | display | – | server-render | kampagne/sections/BundleSection.tsx |
| KAM-51 | „Set entfernen" | button | Beendet das Set (Shopify-Produkt gelöscht) + Regenerate | POST /api/admin/bundles/archive `{id}` + /draft | kampagne/sections/BundleSection.tsx |
| KAM-52 | „Keine Empfehlungen, aus denen ein Set gebaut werden könnte." / „Shopify nicht konfiguriert — keine Set-Angebote möglich." | display | – | – | kampagne/* |
| KAM-53 | Composer: Checkbox je Empfehlung (vorausgewählt), Input „Set-Preis € (optional)" | checkbox + input | Zusammensetzung/Preis | client-only | kampagne/* |
| KAM-54 | „Set aus Empfehlungen erstellen" / „Erstellt…" | button | Erstellt Bundle mit campaignContactId + Regenerate | POST /api/admin/bundles/create `{campaignContactId, components, bundlePriceOverride?}` + /draft | kampagne/* |
| **Karte rechts: Entwurf + Aktionen** ||||||
| KAM-55 | Betreff (aria „Betreff") | input | Autosave 600 ms debounced | POST /api/admin/campaign/update `{contactId, subject, body}` | kampagne/* |
| KAM-56 | E-Mail-Text (Textarea 16 Zeilen, mono; aria „E-Mail-Text") | textarea | Autosave wie oben | dito | kampagne/* |
| KAM-57 | Hero-Bild-Panel (kind=campaign, targetId=contactId; siehe HERO-*) | panel | – | /api/admin/email-hero* | kampagne/* |
| KAM-58 | Warnbox „Erneute Einwilligung erforderlich: … Senden ist blockiert; Kopieren ist möglich." | display (warn) | optInBlocked | – | kampagne/* |
| KAM-59 | „📤 Senden" / „Sendet…" (disabled bei sendBlocked) | button | Versand; erste Sendung des Tages → Bestätigungsdialog; Toast „Gesendet an …"; Karte entfernt, auto-advance | POST /api/admin/campaign/send `{contactId}` | kampagne/* |
| KAM-60 | Dialog „Erste E-Mail heute senden?" („Abbrechen" / „Nur diese E-Mail senden") — bestätigt nur diese eine E-Mail, nie die Warteschlange; Testkontakte fragen nicht | dialog | Einmal täglich (localStorage `ms-campaign-first-send`), nicht bei Testkontakten | POST /api/admin/campaign/send | kampagne/* |
| KAM-61 | „👁 Vorschau" / „Lädt…" (title „Gerenderte E-Mail-Vorschau (inkl. …)") | button → dialog | HTML-Vorschau der aktuellen (ggf. ungespeicherten) Karte | POST /api/admin/campaign/email-preview `{contactId, subject, body}` | kampagne/* |
| KAM-62 | „📋 Kopieren" | button | Betreff + Text (Markdown→Text) in Zwischenablage; Toast mit MO-XXXX-Warnung | `navigator.clipboard` (client-only) | kampagne/* |
| KAM-63 | „✓ Als erledigt markieren" (nur nach Kopieren) | button | Markiert als kopiert versendet; Karte entfernt. **2026-10:** verweigert (409 `not_eligible`) ohne Einwilligung oder bei gesperrter Adresse | POST /api/admin/campaign/mark-done `{contactId}` | kampagne/* |
| KAM-64 | „↻ Neu generieren" / „Generiert…" | button | Regenerate mit aktueller Depth | POST /api/admin/campaign/draft `{contactId, discountPercent, regenerate:true}` | kampagne/* |
| KAM-65 | „⏭ Überspringen" | button | Skip → Rail „Übersprungen"; auto-advance | POST /api/admin/campaign/skip `{contactId}` | kampagne/* |
| KAM-66 | E-Mail-Viewer-Dialog (95vw × 92vh, Titel/Beschreibung, EmailPreviewFrame mit Desktop/Mobil) | dialog (iframe) | Vorschau + gesendete Inhalte | blob URL | kampagne/* |
| **Gesendet-Ansicht (SentHistory)** ||||||
| KAM-67 | Infobox „Noch keine Kampagnen-E-Mails gesendet." | display | – | – | kampagne/* |
| KAM-68 | Tabelle Empfänger / Betreff / Via (Badge „Kopiert"/„E-Mail") / Code (mono) / Eingelöst (— ? ✓ ✗) / Gesendet / Inhalt | table | Historie mit Einlösestatus | server-render (`listCampaignSendHistory`, `wasDiscountCodeRedeemed`) | kampagne/* |
| KAM-69 | „👁 Ansehen" (nur hasContent) / „—" (title „Für diesen Versand wurde kein Inhalt gespeichert…") | button → dialog | Zeigt gespeicherten Versandinhalt | POST /api/admin/campaign/sent-email `{sendId}` | kampagne/* |

| **Review-Desk (ab 2026-09-13)** ||||||
| KAM-70 | Block „Prüfpunkte": Verdikt-Badge „Bereit — keine Hinweise" / „n Hinweise" / „Blockiert" + eine Zeile je Prüfung (Titel, InfoTip mit Detail, Fix-Button: Überspringen / Neu generieren / Basis anpassen / Produkt tauschen / Set neu erstellen / Hero erzeugen / Betreff kürzen) | display + buttons | Vorab berechnete Prüfung (kein DOI, Sperrfrist, Rabatt-Mismatch, Platzhalter ohne Rabatt, abgelehnter Versand; Hinweise: Empfehlungen unsicher, Produkt nicht verfügbar, Set läuft ab/abgelaufen, A-Gruppe ohne Hero, Entwurf > 14 T., Segment nicht sendbar, Betreff > 70 Zeichen; Info: manuell bearbeitet) | `src/lib/campaign-review-checks.mjs` (rein, getestet) | kampagne/ReviewColumn.tsx |
| KAM-71 | Filter-Chips „Alle · DOI · Single/Unbekannt · EN · Rabatt · Set · Hinweise · Blockiert" mit Zählern | filter (radiogroup) | Filtert die Warteschlange; `?filter=` | client-only | kampagne/QueueRail.tsx |
| KAM-72 | Warteschlangen-Zeile: Position, Name, Chips (EN, Segment, Rabatt, Set, Hero), „✎" bei manueller Änderung, Verdikt-Punkt (grün/gelb/rot) bzw. Spinner bei Arbeit | list (buttons) | Sprung zur Karte, scrollt aktive Zeile ins Bild | client-only | kampagne/QueueRail.tsx |
| KAM-73 | „Postausgang · n": Zeilen „sendet… / gesendet ✓ / fehlgeschlagen" mit „Erneut senden" und „Entfernen" | display + buttons | Senden verlässt die Warteschlange sofort; Ablehnung → Karte oben mit Grund als blockiertem Prüfpunkt | POST /api/admin/campaign/send (im Hintergrund) | kampagne/QueueRail.tsx, useCampaignActions.ts |
| KAM-74 | „Vorbereiten…" Popover: Anzahl 25/50/100 („n offen · m im Sendefenster"), Rabatt, Textmodus, Checkbox „KI-Hero für die A-Gruppe erzeugen" (nur wenn Design mit Hero + Generierung konfiguriert), Schätzung „n Entwürfe · ≈ € · ≈ Min." (aus `ai_usage`-Durchschnitten), „Vorbereiten starten"; Einstellungen in localStorage | popover | Hintergrund-Job in 5er-Schritten, Fortschritts-Pille mit „Abbrechen" in der Kopfzeile, Prüfung läuft weiter; Hero-Phase: suggest + generate je gerader Kontakt-ID | POST /api/admin/campaign/prepare (liefert `preparedContactIds`), POST /api/admin/email-hero/suggest + generate | kampagne/PreparePopover.tsx, CampaignHeader.tsx, useCampaignActions.ts |
| KAM-75 | Kopfzeile: „n gesendet · m zu prüfen" + Fortschrittsbalken (endet bei der Tagesmenge) + InfoTip (offen/Sendefenster/übersprungen/unterdrückt/Opt-in-Mix); Status-Pillen „Versand freigegeben/gesperrt", „Shopify/Shopify fehlt", „Sync vor …", „n fehlgeschlagen" — Originaltexte in InfoTips | display | Ersetzt Banner + Stat-Strip. **2026-10:** Pille „Sync vor …“ → „Zielgruppe vor …“ (Einzelansprache: „Einzeln aufgenommen“); Zähler je Kampagne | `deskProgress` (campaign-desk-core.mjs), `getCampaignCounts(campaignId)` | kampagne/CampaignHeader.tsx |
| KAM-76 | Ansichtswechsel „Prüfen [n/m] · Liste · Gesendet N" | segmented control | `?view=liste|gesendet` | client-only | kampagne/CampaignHeader.tsx |
| KAM-77 | ⋯-Menü der Kopfzeile: „Jetzt synchronisieren" (Grund bei deaktiviert), „Tastenkürzel ?", „Warteschlange neu aufbauen" (destruktiv, ConfirmDialog KAM-11) | menu | Batch-Aktionen. **2026-10:** „Jetzt synchronisieren“ → „Zielgruppe aktualisieren“ (KAM-100), neu „Kampagne bearbeiten“; „Neu aufbauen“ nur für diese Kampagne | POST /api/admin/campaigns/refresh, campaign/reset-queue `{campaignId}` | kampagne/CampaignHeader.tsx, ui/menu.tsx |
| KAM-78 | Mail-Spalte: Identitätszeile (Name, E-Mail, Sprache, Segment, Opt-in, Bestellungen/Umsatz, letzter Kauf), Betreff als Eingabefeld, gerenderte E-Mail als Standardansicht (Iframe, skaliert; nächste Karte vorgeladen, Cache), Editor in-place (`E`, ab 1600 px neben der Vorschau), Busy-Overlay „Text wird angepasst… / Hero-Bild wird erzeugt…" | display + input + textarea | Rendered-first; Autosave wie KAM-55/56 | POST /api/admin/campaign/email-preview (Cache je Kontakt+Inhalt) | kampagne/MailPane.tsx, useRenderedPreview.ts |
| KAM-79 | Aktionsleiste: `P` ←, „i / N", → `N`; Überspringen `X`, Neu generieren `R`, Bearbeiten `E`/Fertig `Esc`, „Als erledigt markieren" nach Kopieren, ⋯ (Vorschau `V`, Kopieren `C`, Verlauf, Fokus-Modus `F`, Tastenkürzel `?`), Senden `S` (Tooltip nennt Grund bei blockiert/beschäftigt); unter 2xl nur Icon + Taste | buttons + menu | Eine Primäraktion, eine Taste | s. KAM-59…65 | kampagne/MailPane.tsx |
| KAM-80 | Fokus-Modus (`F`/Esc): Rail und Prüfspalte ausgeblendet, Mail zentriert, Prüfpunkte als Einzeiler über der Mail | mode | Tastaturlauf durch saubere Entwürfe | client-only | kampagne/KampagneWorkspace.tsx, MailPane.tsx (ChecksStrip) |
| KAM-81 | Block „Angebot": Rabatt als Segmented 0/5/10/15/20 % + „…" (eigener Wert, Übernehmen); InfoTip mit Original-Hinweistext (MK-Code beim Senden, gültig bis …) | segmented + input | Persistiert sofort, Text wird im Hintergrund gebündelt neu generiert | POST /api/admin/campaign/discount + /draft (gebündelt) | kampagne/ReviewColumn.tsx |
| KAM-82 | „Set"-Zeile: angehängt → Titel · Preis (statt …) · bis …, Bestandteile-Tooltip (Aufzählung mit Anzahl), „Entfernen"; sonst „Set erstellen…" → Sheet mit Composer (KAM-53/54) | display + sheet | Set anhängen/entfernen, Regenerate gebündelt | POST /api/admin/bundles/create / archive + /draft | kampagne/ReviewColumn.tsx, sections/BundleSection.tsx |
| KAM-83 | Block „Empfehlungen · n": Zeilen mit Thumbnail, Name (Link), Preis, Badge „Ausverkauft"/„Nicht im Katalog", ✕ (deaktiviert bei ≤ 1); „+ Produkt" klappt den CatalogProductPicker (mit Thumbnails, Varianten) auf | list + picker | Sofort persistiert, Set angepasst, Regenerate gebündelt | POST /api/admin/campaign/recommendations + /draft | kampagne/ReviewColumn.tsx |
| KAM-84 | Block „Hero · <Design>" (nur wenn das Kampagnen-Design einen Hero hat): Thumbnail, Pille „KI-Hero / Standard-Bild / A-Gruppe ohne Hero", Schlagzeile, „Erzeugen" (Vorschlag + Rendern in einem Zug), „Anpassen…" (Sheet: Schlagzeile, Prompt, Prompt vorschlagen, Schlagzeile speichern, Bild generieren), „Entfernen" | display + buttons + sheet | Alle fünf Hero-Aktionen (HERO-*), Karte während Generierung als beschäftigt markiert, Prüfpunkt aktualisiert | GET /api/admin/email-hero, POST …/suggest, generate, headline, remove (`useEmailHero`) | kampagne/sections/HeroBlock.tsx, useEmailHero.ts |
| KAM-85 | Block „Kontakt": Opt-in, Segment (Grund im InfoTip), Letzte Mail (kanalübergreifend) + „Sperrfrist bis …", A/B-Gruppe, Umsatz; „Verlauf" → Sheet mit allen Kampagnen-Sendungen an die Adresse (Betreff, Datum, Zustellung, Code, eingelöst, Hero, „Ansehen") | description list + sheet | Neue Fakten: letzte Sendung + Sperrfrist | GET /api/admin/campaign/history?q=<email> | kampagne/ReviewColumn.tsx, ContactHistorySheet.tsx |
| KAM-86 | Ansicht „Liste": sortierbare Tabelle (Kontakt, Segment, Sprache, Rabatt, Set, Hero, Prüfung, Entwurf-Alter/✎, Öffnen) mit Mehrfachauswahl; Leiste „n von m ausgewählt": Überspringen, Neu generieren…, Rabatt-Select + „Rabatt setzen…" (ConfirmDialog mit Anzahl und Kostenschätzung), Auswahl aufheben; Fortschritt | table + bulk actions | Die 5 % mit Arbeit in einem Rutsch | POST skip / discount / draft je Kontakt (sequenziell) | kampagne/ListView.tsx |
| KAM-87 | Ansicht „Gesendet": Zustellungs-Chips „Alle · Zugestellt · Geklickt · Bounce · Beschwerde · Kopiert" (`?delivery=` an der History-Route) + 30-Tage-Streifen (Gesendet, Zugestellt %, Geklickt %, Bounces (hart), Beschwerden, Abmeldungen; rein DB) + Link „Kampagnen-Funnel … im KPI-Bereich" | filter + stats | Bounces/Beschwerden ohne KPI-Bereich sichtbar | GET /api/admin/campaign/history?delivery=…&campaignId=, `getCampaignDeliverySummary(30, campaignId)` (2026-10: je Kampagne) | kampagne/SentHistory.tsx |
| KAM-88 | Tastenkürzel-Sheet (`?`, ⋯-Menüs); neue Tasten `E`/`Esc`, `R`, `F`, `/` (Kontaktsuche, übersteuert die Shell-Kundensuche auf diesem Bereich), `J`/`K` als Aliase | sheet + keyboard | – | client-only (Capture-Phase, `defaultPrevented` in AdminShell) | kampagne/KampagneWorkspace.tsx, AdminShell.tsx |
| KAM-89 | Deep Links `?contact=<id>`, `?view=`, `?filter=` (history.replaceState; ungültige Werte fallen auf Standard) | url state | Position überlebt Reload, teilbar | `parseDeskView`, `parseQueueFilter` (campaign-desk-core.mjs) | KampagneTab.tsx, page.tsx, useCampaignActions.ts |
| KAM-90 | Gebündelter Hintergrund-Regenerate: mehrere Angebots-/Textänderungen innerhalb 1,5 s → EIN Draft-Aufruf; Busy-Zustand je Karte (Senden dieser Karte wartet, Navigation frei) | behaviour | Weniger KI-Aufrufe, keine Wartezeit | POST /api/admin/campaign/draft | useCampaignActions.ts |
| KAM-92 | ⋯ → „Testkontakte…": Sheet mit Formular (Testadresse, Vorname, Sprache, optional Kaufhistorie von Kunden-E-Mail; Entwurf sofort mit den Vorbereiten-Einstellungen) und Liste der Testkontakte (Status, Öffnen / Entwurf erstellen / Entfernen). Testkontakte bleiben nach jedem Versand in der Warteschlange (Status zurück auf drafted), Sync/Neu aufbauen/Cron/Retention lassen sie unberührt, keine Sperrfrist, keine Unterdrückungsprüfung (Info-Prüfpunkt); Sendungen mit `is_test`, Badge „Test" in Rail, Liste, Gesendet und Verlauf, nicht in KPIs (Migration 0057) | sheet + list | Live-Test aller Varianten an eigene Postfächer | GET/POST /api/admin/campaign/test-contacts (2026-10: `campaignId` Pflicht — Testkontakte gehören zu einer Kampagne und sehen deren Briefing und Angebot; senden auch vor dem Start und im Entwurf, nicht in beendeten oder archivierten Kampagnen), POST /api/admin/campaign/send (`test: true` → Karte bleibt) | kampagne/TestContactsSheet.tsx, useCampaignActions.ts, campaign-store.ts, campaign-email.ts |
| KAM-93 | Block „Kundenprofil": Persona-Badge, Klartext-Auszug des zentralen Profils, „Öffnen" → `/admin?tab=kunden&customer=<id>`; „Noch kein Profil …" sonst | display + link | Profil beim Prüfen sichtbar; steuert Text + Empfehlungen | server-render (`listDraftedQueue` → `profile`) | kampagne/ReviewColumn.tsx, campaign-store.ts |
| KAM-94 | Papierkorb-Symbol im Block „Kontakt" (nicht bei Testkontakten) → Dialog → Karte verschwindet (optimistisch, bei Fehler zurück) | icon button + confirm | Person vollständig löschen, Adresse gesperrt, kein Re-Import | POST /api/admin/customers/erase `{contactId, confirm:true}` | kampagne/ReviewColumn.tsx, useCampaignActions.ts |
| KAM-95 | Briefsymbol „Abmelden" im Block „Kontakt" (nicht bei Testkontakten) → Dialog → Karte verlässt die Warteschlange; Kontaktsuche: unterdrückter Treffer mit Badge „Unterdrückt" + „Reaktivieren" → Dialog → zurück als drafted (Entwurf bleibt) bzw. pending | icon button + search action + confirm | Manuelle Kontrolle über Abmeldungen, keine E-Mail | POST /api/admin/customers/marketing-optout `{contactId, action, confirm:true}` | kampagne/ReviewColumn.tsx, QueueRail.tsx, useCampaignActions.ts |
| KAM-91 | Nächtliches Vorbereiten: Cron `GET/POST /api/cron/prepare-campaign-drafts` (04:15 UTC), `CAMPAIGN_AUTO_PREPARE_COUNT` (0 = aus, Standard), `_DISCOUNT`, `_TEXT_MODE` | cron | Warteschlange morgens voll; sendet nie. **2026-10:** `CAMPAIGN_AUTO_PREPARE_COUNT` ist das Nacht-Budget über alle laufenden Kampagnen; jede nimmt ihr „Automatisch vorbereiten“ (Editor) nach Priorität (`planAutoPrepare`); setzt keine Kampagne eine Zahl, geht das Budget mit `_DISCOUNT`/`_TEXT_MODE` an „Lebenszyklus“ | `prepareNextDrafts({campaignId, count})` in 5er-Schritten, 240-s-Budget | src/app/api/cron/prepare-campaign-drafts/route.ts, vercel.json, .env.example |
| **Kampagnen (ab 2026-10-01, Migration 0066)** ||||||
| KAM-96 | Kampagnen-Übersicht (ohne `?campaign=`): `SegmentedControl` „Aktuell · Alle · Archiv“, Badge „Versand gesperrt“ + InfoTip (ohne `CAMPAIGN_SENDS_APPROVED`), „Neue Kampagne“; Leerzustand „Keine Kampagnen“; Callout „Diese Kampagne gibt es nicht (mehr) …“ bei unbekanntem `?campaign=` | page | Alle Kampagnen auf einen Blick | server-render (`listCampaigns({includeArchived:true})`) | KampagneTab.tsx, kampagnen/CampaignsOverview.tsx |
| KAM-97 | Kampagnen-Karte: Name (→ Prüftisch), Phasen-Badge (Entwurf · Geplant · Läuft · Abgelaufen · Pausiert · Beendet · Archiviert), Art · Zielgruppe dynamisch/fest · Rabatt, Zielgruppe in Klartext (`describeAudienceSpec`), Zeitraum, Zahlen Empfänger / Entwürfe / Gesendet / Klickrate (**Nachtrag 2026-10:** jeder Klick zählt — Button oder Set-Link), „Prüftisch öffnen (n)“, Status-Hauptaktion und ⋯ („Bearbeiten“, Pausieren / Fortsetzen / Beenden / Wieder aufnehmen / Archivieren); „Starten“/„Fortsetzen“ und „Beenden“ mit Bestätigung | card + buttons + menu + confirm | Starten übernimmt die Zielgruppe sofort (nur mit Einwilligung), sendet nichts | POST /api/admin/campaigns/status `{id, status}` (`canTransition`) | kampagnen/CampaignsOverview.tsx, lib/campaign-def.mjs |
| KAM-98 | Editor-Sheet „Neue Kampagne“ / „<Name> bearbeiten“ (`?edit=<id\|new>`): Grundlagen (Name, Art Laufend/Aktion, Start, Ende, Priorität), Briefing, Zielgruppe (Lebenszyklus, Wertstufe, Abwanderungsrisiko, Mit Mo gesprochen, Letzter Kauf vor, Bestellungen, Umsatz, Kategorie, Persona, Sprache, Einwilligung, Keine Werbe-Mail in den letzten, Hat geklickt in den letzten, Nicht in Kampagne; Zielgruppe dynamisch/fest; Erneut aufnehmen nach), Angebot (Rabatt, Gilt für, Codes gültig bis), Gestaltung (Design, Titelbild „Kein Titelbild“ / „Standard-Titelbild des Designs“ / „KI-Titelbild für einen Teil (A/B)“ / „KI-Titelbild für alle“, Textlänge, „Button führt zu“ Mo-Chat / Shop + Shop-Link, Mo-Hinweis anhängen), Automatik (Automatisch vorbereiten, Tagesziel). **Nachtrag 2026-10:** Chips nach den Grenzen des Codes („Ausbauen (1–3 Mon.)“, „Weiterentwickeln (3–12 Mon.)“; Wertstufe-InfoTip „Nach dem teuersten einzelnen Artikel: Kleinteile unter 150 €, Komponenten bis 1.499 €, Großgeräte ab 1.500 €.“); „Button führt zu“ Mo-Chat ohne Mo-Hinweis wird abgelehnt („Der Button zu Mo steht im Mo-Hinweis — …“); `?edit=new&audience=<json>` startet mit dieser Zielgruppe (KUN-134; serverseitig normalisiert, > 4000 Zeichen oder unlesbar → ignoriert) | sheet (form) | Serverseitig erneut geprüft (`validateCampaignInput`, `normalizeAudienceSpec`); geänderte Zielgruppe einer aktiven Kampagne wird sofort neu übernommen | POST /api/admin/campaigns (anlegen, Status Entwurf), POST /api/admin/campaigns/update | kampagnen/CampaignEditor.tsx, ui/toggle-chips.tsx |
| KAM-99 | Live-Zahl „Passende Kund:innen mit Einwilligung“ im Editor: Anzahl, „n mit Mo-Gespräch · DE n · EN n“, Beschreibung, einige Namen. **Nachtrag 2026-10:** Zahlen als Fenster-Aggregate über den ganzen Treffer (nur 8 Zeilen werden geladen); dazu „Ohne Einwilligung passen weitere N — davon M per Brief erreichbar.“ (InfoTip; Lieferadresse bekannt, kein Widerspruch) — die einzige Zählung ohne Einwilligung, nichts wird übernommen | display | Zielgruppe vor dem Speichern prüfen (reine DB) | POST /api/admin/campaigns/audience-preview `{audience}` (→ `preview.withoutConsent {total, letterReach}`) | kampagnen/CampaignEditor.tsx, lib/audience-store.ts |
| KAM-100 | KI-Hilfe im Editor: „Briefing vorschlagen“ (aus Name, Art, Notizen, Ende, Rabatt) und „Beschreiben“ + „Filter setzen“ (Satz → Zielgruppen-Filter mit Erklärung) | buttons | Nur Vorschläge (writer tier) — Zahl und Filter vor dem Speichern prüfen | POST /api/admin/campaigns/assist `{action:"brief"\|"audience"}` | kampagnen/CampaignEditor.tsx, lib/campaign-assist.ts |
| KAM-101 | Prüftisch je Kampagne (`?campaign=<slug\|id>`): Kampagnen-Umschalter in der Kopfzeile (Kampagnen mit Entwurfszahl, „Alle Kampagnen“), Phasen-Badge + InfoTip (Art, Zielgruppe, Start/Ende, „Solange die Kampagne nicht läuft, gehen keine Mails an Kund:innen …“ — **Nachtrag 2026-10:** je Phase: Geplant „Bis zum Start gehen keine Mails an Kund:innen — Vorbereiten und Testkontakte funktionieren schon.“, Entwurf / Pausiert „Die Kampagne läuft nicht: es gehen keine Mails hinaus, und Entwürfe lassen sich erst nach dem Start vorbereiten.“; Tagesfortschritt mit „Tagesziel n“, wenn die Kampagne eins setzt); Vorbereiten, Neu aufbauen, Suche, Gesendet und Testkontakte arbeiten nur auf dieser Kampagne | menu + badge | Ein Desk, viele Kampagnen | server-render (`resolveCampaign`, `getCampaignForContact`) | KampagneTab.tsx, kampagne/CampaignHeader.tsx |
| KAM-102 | „Zielgruppe aktualisieren“ (⋯-Menü und Leerzustand; nicht bei der Einzelansprache) → Toast „n passende Kunden · n neu · n ohne Einwilligung · n nicht mehr passend“ | button | Ersetzt „Jetzt synchronisieren“ (KAM-06); nächtlich derselbe Abgleich (`/api/cron/campaign-audiences`) | POST /api/admin/campaigns/refresh `{campaignId}` | kampagne/CampaignHeader.tsx, useCampaignActions.ts, lib/campaigns-store.ts |
| KAM-103 | „Vorbereiten…“-Startwerte aus dem Angebot der Kampagne (Rabatt, Geltung, Textlänge, KI-Hero bei Titelbild-Modus `ai_ab`/`ai_all`), je Kampagne gemerkt (localStorage `ms-campaign-prepare:<id>`); `ai_all` erzeugt den Hero für jede vorbereitete Karte. **Nachtrag 2026-10:** KI-Hero nur bei `ai_ab` („KI-Hero für die A-Gruppe erzeugen“) und `ai_all` („KI-Hero für jede Mail erzeugen“, Schätzung ein Hero je Entwurf, `prepareEstimate` `heroForAll`); Prüfpunkte und Listen-Spalte „Hero“ folgen dem Modus (`ai_all`: jede Karte ohne Hero „Ohne KI-Hero“ / „fehlt“; `default`/`none`: keine Hero-Hinweise, keine Spalte); der Sendefenster-Hinweis gilt nur für `laufend`; leer „Keine offenen Empfänger — erst „Zielgruppe aktualisieren“.“ | popover defaults | Kampagnen-Angebot ohne Nachtippen | POST /api/admin/campaign/prepare `{campaignId, …}` (409 `campaign_closed`, wenn die Kampagne nicht läuft) | kampagne/useCampaignActions.ts |
| KAM-104 | Einzelansprache (Systemkampagne, Art `einzel`, Slug `einzelansprache`): keine Zielgruppe, kein Zeitraum, immer aktiv (kein Statuswechsel, keine Karten-Aktionen); über ⋯ „Kampagne bearbeiten“ lassen sich Briefing, Angebot und Gestaltung ändern; Empfänger kommen aus Kunden (KUN-125) oder dem Eingang (EIG-09), die Notiz des Teams wird zum Briefing des Entwurfs („Notiz des Teams zu dieser Person“) | campaign | Plan D-8: der 1:1-Weg läuft durch dieselbe Prüfung, dieselben Gates und MK-Codes | POST /api/admin/campaigns/add-recipient, /api/admin/inbox/accept | lib/campaigns-store.ts, lib/campaign-draft.ts |
| KAM-105 | Kampagnen-Inhalt im Entwurf und Versand: Briefing + Aktion mit echtem Enddatum im Prompt, Design je Kampagne, Titelbild-Modus (`none` = ohne Hero), Button zum Mo-Chat oder zu einem Shop-Link (`/api/r/<token>` leitet bei `cta_kind = shop` dorthin), Codes einer Aktion enden gemeinsam am „Codes gültig bis“ | behaviour | Black-Friday-taugliche Aktionen | `campaignCtaOptions`, `campaignDiscountExpiry`, `getEmailDesignForKey` | lib/campaign-draft.ts, lib/campaign-email.ts, lib/campaign-def.mjs |
| KAM-106 | Sende-Gate je Mail (Senden, Postausgang): Kampagne läuft (`campaign_closed`) → `CAMPAIGN_SENDS_APPROVED` → Einwilligung „subscribed“ (`no_consent`) → Opt-in-Stufe (DOI, außer `CAMPAIGN_ALLOW_SINGLE_OPT_IN`) → Sperrliste → Mindestabstand; Empfängeradresse und Stufe kommen frisch aus `customers`. **Nachtrag 2026-10:** `campaign/send` antwortet `campaign_closed` mit 409 und `no_consent` mit 403 (vorher 400) | behaviour | Die eine Einwilligung entscheidet, nicht der Snapshot | `evaluateCampaignSendGates` (`campaign-gates.mjs`, getestet), `approveAndSendCampaign` | lib/campaign-email.ts |
| KAM-107 | „Einplanen“ (`A`, Button im Aktionsbalken, nur mit `CAMPAIGN_RELEASE_ENABLED`): Zeitauswahl (nächster Lauf · heute 18:00 · morgen 09:00 · morgen 18:00, Berlin); prüft alle Versand-Gates ohne Versand (`campaignSendPreflight`) plus Platzhalter-ohne-Rabatt und abgelaufenes Set; Karte verlässt die Warteschlange; nie für Testkontakte, kein Sammel-Einplanen | action | Geprüfte Mails zur besten Uhrzeit versenden, ohne am Pult zu warten | POST /api/admin/campaign/approve (Zugriffsprotokoll `campaign.approve`) | kampagne/useReleaseActions.ts, kampagne/ScheduledViews.tsx, lib/campaign-release.ts |
| KAM-108 | Ansicht „Eingeplant n“ (`?view=eingeplant`): Empfänger:in, Betreff, Versand ab, eingeplant am, „Zurücknehmen“ | list + button | Übersicht und Korrektur vor dem Versand | POST /api/admin/campaign/unapprove | kampagne/ScheduledViews.tsx |
| KAM-109 | Versand-Job alle 10 Min.: fällige eingeplante Mails einzeln über `approveAndSendCampaign` (alle Gates erneut), höchstens `CAMPAIGN_RELEASE_MAX_PER_RUN` je Lauf, `CAMPAIGN_RELEASE_SPACING_MS` Abstand; geändert (Fingerabdruck), Set abgelaufen oder Gate lehnt ab → zurück in die Warteschlange mit Grund (`release_error`, auf der Karte); hängende `sending`-Zeilen werden aufgelöst | cron | Versand ohne Doppelversand, ohne automatischen Wiederholversuch | /api/cron/release-campaign-mails | lib/campaign-release.ts, lib/campaign-release-core.mjs, lib/campaign-store.ts |
| KAM-110 | Editor-Abschnitt „Prüfen & testen“ (nicht bei der Einzelansprache): Schätzung aus Live-Zahl und erfassten Durchschnittskosten — Empfänger:innen, KI-Texte ≈ €, KI-Titelbilder ≈ € (A/B = Hälfte), Prüfzeit (÷ Tagesziel, sonst 100/Tag), Zeitraum (Resttage), Vorbereitung (Nächte); Callout, wenn Prüfung oder nächtliche Vorbereitung nicht in den Zeitraum passt oder das Ende vorbei ist | display + callout | Vor dem Start sehen, was die Kampagne kostet und ob sie zu schaffen ist | `campaignPlanEstimate` (`campaign-sample-core.mjs`, getestet), `estimateCampaignCosts` | kampagnen/CampaignCheckSection.tsx, KampagneTab.tsx |
| KAM-111 | „Muster erzeugen“: drei möglichst unterschiedliche Empfänger:innen der Zielgruppe (Sprache, Mo-Gespräch, Lebenszyklus, Bestellungen), Mail geschrieben wie im Prüftisch, aber mit den aktuellen (auch ungespeicherten) Einstellungen; nichts gespeichert außer dem KI-Aufruf; Einwilligung + Sperrliste geprüft, kein KI-Profil bei Widerspruch; Karte mit Betreff, Textanfang, „Einstellungen geändert“; „Ansehen“ (gerendert, Platzhalter-Code, Links ohne Funktion), „Neu schreiben“ | button + cards + dialog | Briefing und Angebot an echten Personen ausprobieren, bevor jemand eine Mail bekommt | POST /api/admin/campaigns/sample (`pick`, `generate`) | lib/campaign-sample.ts, `renderCampaignSample`, `pickSampleRecipients` |
| KAM-112 | „Testpostfach …“ an einem Muster: wird Testkontakt der gespeicherten Kampagne mit genau diesem Text (Kaufhistorie der Muster-Person) und geht über `approveAndSendCampaign` raus (echter Code, Tracking, Abmeldelink); gesperrt bei ungespeicherten Änderungen, Server lehnt ab, wenn das Muster unter anderen Einstellungen entstand (409 `stale_sample`); Adresse wird im Browser gemerkt | dialog + action | Die echte Mail im eigenen Postfach sehen | POST /api/admin/campaigns/sample (`send_test`), `sampleConfigFingerprint` | lib/campaign-sample.ts |
| KAM-113 | Platzhalter-Code ohne Rabatt wird nie verschickt: ein Entwurf ohne Rabatt, dessen Text noch „MO-XXXX“ enthält, wird beim Senden, Einplanen und im 1:1-Marketing-Versand abgelehnt (`discount_mismatch`); der Prüftisch zeigt es als „Platzhalter-Code ohne Rabatt“ | behaviour | Kein Angebot im Text, das es nicht gibt | `hasStrayPlaceholder` (`discount-swap.mjs`, getestet) | lib/campaign-email.ts (`campaignSendPreflight`), lib/marketing-email.ts, lib/campaign-review-checks.mjs |
| KAM-114 | **Nachtrag 2026-10-03 (Migration 0074):** Editor-Abschnitt „Brief“ (InfoTip „Werbebriefe per Post (Pingen) an Kund:innen mit abgeschlossener Bestellung, ohne Widerspruch gegen Briefwerbung — vor allem an alle, die keine E-Mail-Einwilligung haben. Adresse ist nur die Lieferadresse der letzten Bestellung. Jeder Brief wird im Prüftisch (Ansicht „Briefe“) geschrieben, geprüft und einzeln freigegeben; im Fuß stehen fest der Widerspruchshinweis und der Absender.“): Select „Briefe“ („Keine Briefe“ (Standard) / „An alle ohne E-Mail-Einwilligung“ / „An alle (auch mit Einwilligung)“), „Porto-Budget (€)“ (InfoTip; leer = ohne Grenze), Zeile „Per Brief: N Empfänger:innen (Adresse schon bekannt: M) · ≈ X € Porto bei Y € je Brief“; Callouts ohne `PHYSICAL_MAIL_SENDS_APPROVED` bzw. ohne Pingen; nicht bei der Einzelansprache | select + input + display | Kampagne erreicht auch Kund:innen ohne E-Mail-Einwilligung per Post | POST /api/admin/campaigns, campaigns/update (`letterMode`, `letterBudgetCents`), campaigns/audience-preview `{audience, letterMode}` (→ `preview.letters {total, withAddress}`) | kampagnen/CampaignEditor.tsx, lib/campaign-def.mjs, lib/audience-store.ts |
| KAM-115 | Brief-Empfänger:innen (`campaign_letters`): Zielgruppe der Kampagne ohne die reinen E-Mail-Filter („Einwilligung“, „Keine Werbe-Mail in den letzten“), dazu ≥ 1 Bestellung, kein Widerspruch gegen Briefwerbung, keine Sperre; „An alle ohne E-Mail-Einwilligung“ nur ohne Einwilligung „subscribed“; „Nicht in Kampagne“ schließt auch Brief-Empfänger:innen jener Kampagnen aus. Angelegt beim Zielgruppen-Abgleich (Starten, Speichern, „Zielgruppe aktualisieren“, nachts): fest = nur beim ersten Brief-Abgleich, dynamisch = Neue dazu, nicht mehr Passende `zielgruppe`; wer wieder passt, ist wieder offen; Widerspruch → `widerspruch`, neue Einwilligung (Modus ohne Einwilligung) → `einwilligung`; je Person ein Brief je Kampagne (Zyklus 0) | behaviour | Briefe nur an Bestandskund:innen, die sie bekommen dürfen | `refreshCampaignLetters`, `matchAudience({letterMode})`, `letterMembership` (`campaign-letter-core.mjs`, getestet) | lib/campaign-letters-store.ts, lib/audience-store.ts, lib/campaigns-store.ts |
| KAM-116 | Ansicht „Briefe n“ (`?view=briefe`; nur mit Brief-Modus oder solange Briefe existieren — nach „Keine Briefe“ mit Callout, die drei Sammel-Schritte gesperrt, 409 `letters_off`): Filter Offen / Freigegeben / Versendet / Alle; Statuszeile „Porto bisher … · ≈ … je Brief · Budget … (reicht noch für n Briefe) · n ohne Kaufadresse · n ausgeschlossen, n übersprungen“; Callouts (Briefversand nicht freigeschaltet, Pingen nicht konfiguriert, Kampagne läuft nicht, „Pingen-Testumgebung (PINGEN_STAGING) — es wird nichts gedruckt oder verschickt.“); Liste (Empfänger:in mit PLZ, Ort, Land oder „Adresse fehlt“, Status, „Blockiert“ / „n Hinweise“); leer „Noch keine Brief-Empfänger:innen“ | view (split pane) | Briefe einer Kampagne prüfen und versenden | POST /api/admin/campaigns/letters `{action:"list", campaignId}` | kampagne/LettersView.tsx, kampagne/CampaignHeader.tsx, lib/campaign-letters.ts (`letterDeskData`) |
| KAM-117 | „Adressen holen (n)“ (Schritt-Schleife, 50 je Schritt): Lieferadresse der letzten abgeschlossenen Bestellung (bezahlt / teilweise erstattet, nicht storniert) live aus Shopify, gespeichert als Kaufadresse (`purchase` + Bestell-ID); neuere Bestellung → neu geholt; je Person höchstens einmal täglich; nichts bei ausgeschaltetem `PHYSICAL_MAIL_SENDS_APPROVED`. Nachts im Cron `campaign-audiences` bis `CAMPAIGN_LETTER_ADDRESS_NIGHTLY` (200) Adressen; Hinweis „Lieferadresse auf einen anderen Namen (Geschenk?) — prüfen.“; unzustellbar (Pingen-Webhook) sperrt die Adresse bis zu einer neueren Bestellung | button + cron | Einzige zulässige Adressquelle für Werbebriefe (Dossier § 6.4) | POST /api/admin/campaigns/letters `{action:"fill_addresses"}` | lib/postal-address-fill.ts, lib/postal-address.mjs (`decideAddressRefresh`, getestet), lib/campaign-letters.ts, lib/physical-letters-store.ts |
| KAM-118 | „Entwürfe schreiben (n)“ (Bestätigung „Ein KI-Aufruf je Brief …“, 5 je Schritt) und „Neu schreiben“ / „Entwurf schreiben“ je Brief: deutscher Brief in Du-Form („Hallo <Vorname>,“), Bezug auf Käufe, höchstens die vorgegebenen Produktnamen, keine Preise, keine Links, kein Rabattcode, keine Prozente, kein Widerspruchshinweis (steht im Fuß), ≤ ~1.500 Zeichen, Unterschrift „Mo, dein persönlicher Berater bei motion sports“; nie Adresse, E-Mail, Bestellnummer oder Beträge im Prompt (die Kaufzeilen nennen wie bei Kampagnen-Mails nur Datum und Artikel; die Bestellbezeichnung ist seit 03.10.2026 auch bei Kampagnen-Mails entfernt); Profil nicht nach Widerspruch; ohne Schlüssel oder bei Fehler eine feste Vorlage | buttons | Brieftext je Person, den ein Mensch prüft | POST /api/admin/campaigns/letters `{action:"draft"\|"redraft"}`; KI-Kosten `campaign_letter` | lib/campaign-letter-draft.ts |
| KAM-119 | Brief-Detail: Name, E-Mail, Status, EN-Badge, Kaufadresse, Ausschlussgrund, Versandinfo (Datum, Pingen-Status, Seiten, Kosten), Rückgabegrund des Versands, Sperren und Hinweise (Geschenk, Ausland, liest Englisch, langer Betreff, mehrseitig); Betreff + Brieftext bearbeitbar („Speichern“); „Vorschau“ (gedrucktes A4-PDF); „Freigeben“ (nur gesperrt bei Widerspruch, neuer Einwilligung, unzustellbarer Adresse, fehlendem Text) / „Zurücknehmen“; „Überspringen“ / „Wieder aufnehmen“; kein Sammel-Freigeben | detail + buttons | Jeder Brief wird einzeln geprüft und freigegeben | POST /api/admin/campaigns/letters `{action:"save"\|"approve"\|"unapprove"\|"skip"\|"unskip", id}` (Zugriffsprotokoll `campaign.letter_approve`), POST /api/admin/campaigns/letters/preview | kampagne/LettersView.tsx, lib/campaign-letters-store.ts, `letterReviewChecks` |
| KAM-120 | „Freigegebene senden (n)“ (Bestätigung „≈ n × Porto = Summe Porto“, Budget- und Staging-Hinweis): 5 je Schritt, atomar beansprucht, jede Prüfung je Brief frisch — Briefversand freigeschaltet → Pingen → Kampagne läuft → kein Widerspruch → keine neue Einwilligung (Modus ohne Einwilligung) → vollständige Kaufadresse → nicht unzustellbar → Text → Abstand `LETTER_MIN_INTERVAL_DAYS` (60, jeder Brief inkl. 1:1) → Porto-Budget; Ablehnung → zurück in den Entwurf mit Grund (Widerspruch / Einwilligung → ausgeschlossen), Pingen-Fehler → Fehler; Versand über `submitLetter` (PDF mit Widerspruchshinweis, Idempotency-Key, Brief vor der Übergabe zugeordnet) | button + behaviour | Kein Brief ohne Freigabe, kein doppelter Druck | POST /api/admin/campaigns/letters `{action:"send_step"}` (Zugriffsprotokoll `campaign.letters_send`) | lib/campaign-letters.ts (`sendCampaignLetterStep`), `decideCampaignLetterSend` (`campaign-letter-core.mjs`, getestet), lib/physical-mail.ts |

### Helper/explanatory text (Kampagne) — 44 (Stand vor dem Desk; auf dem Desk als InfoTips/Tooltips erhalten)
1. „Keine Datenbank konfiguriert (DATABASE_URL) — das Kampagnen-Modul kann keine Kontakte laden." — KampagneTab.tsx
2. „Versand gesperrt: Die anwaltliche Freigabe für diesen Kanal steht aus (CAMPAIGN_SENDS_APPROVED=false). Entwürfe, Vorschau und Kopieren funktionieren; der Senden-Button bleibt deaktiviert und der Server lehnt jeden Versand ab." — kampagne/*
3. „Shopify ist nicht konfiguriert — Sync, Kaufhistorie und Rabattcodes sind deaktiviert." —
4. aria „Rabatt-Tiefe für neue Entwürfe"
5. aria „Textmodus für neue Entwürfe" / title „Wie viel Fließtext die KI über den Produktkacheln schreibt."
6. „Tasten: N weiter · P zurück · V Vorschau · C kopieren · S senden · X überspringen"
7. „Keine Entwürfe in der Warteschlange. „Sync" holt die Shopify-Abonnent:innen, „Nächste 50 vorbereiten" erzeugt die Entwürfe — oder über die Kontaktsuche links eine:n einzelne:n Kund:in aufnehmen." —  (2026-10 ersetzt, s. KAM-26)
8. „Entwurf i von N"
9. „Empfehlungen unsicher"
10. „N Bestellungen · X Umsatz"
11. „Produktbilder-Raster, Mo-Hinweis (Deep-Link), Rabattzeile und Abmelde-/Impressum-Footer werden beim Versand automatisch angehängt und sind hier nicht editierbar."
12. „Erneute Einwilligung erforderlich: Für diesen Kontakt liegt kein nachweisbares Double-Opt-in vor (…). Senden ist blockiert; Kopieren ist möglich."
13. title „Gerenderte E-Mail-Vorschau (inkl. Produktbilder, Mo-Hinweis, Rabattzeile und Footer)"
14. Dialog „Alle N offenen Entwürfe werden verworfen — auch manuelle Änderungen an Betreff/Text gehen verloren. Die Kontakte werden wieder „Offen" und mit „Nächste 50 vorbereiten" neu generiert (erneute API-Kosten). Gesendete, übersprungene und unterdrückte Kontakte sowie angehängte Set-Angebote bleiben unberührt." —
15. Dialog „Du startest den heutigen Kampagnen-Versand: Die E-Mail geht an <email>. Weitere Sendungen heute werden nicht mehr einzeln bestätigt."
16. Vorschau-Beschreibung „So wird die E-Mail im Postfach gerendert. Der Rabatt zeigt den Platzhalter-Code MO-XXXX — der echte MK-Code wird erst beim Senden erzeugt." —
17. Gesendet-Beschreibung „Kopier-Versand — gespeichert ist der kopierte Text (kein HTML verschickt)." / „Genau dieser Inhalt wurde verschickt." —
18. Toast „Achtung: Der Text enthält den Platzhalter-Code MO-XXXX — beim Kopier-Versand wird KEIN echter Code erzeugt." / „Betreff + Text kopiert. Danach „Als erledigt markieren" klicken." —
19. Toast „Kontakte sind wieder „Offen" — mit „Nächste 50 vorbereiten" neu generieren. Seite wird neu geladen…" —
20. Toast Sync „Abonnent:innen werden abgeglichen." / „N Abonnent:innen (k neu, m unterdrückt). Seite wird neu geladen…" — (2026-10 → „Zielgruppe wird aktualisiert…“ / „Zielgruppe aktualisiert“, KAM-102)
21. „Kaufhistorie" / Checkbox-Label „Alle"
22. „Keine Bestelldetails verfügbar."
23. „Empfehlungsbasis: k von n Käufen ausgewählt." / „Ausgewählte Käufe sind die Basis für Empfehlungen und Text."
24. „Kaufauswahl wird nach „Neu generieren" verfügbar."
25. „Mindestens einen Kauf auswählen."
26. „Set-Angebot" … „(statt …)" „· läuft ab …"
27. „Keine Empfehlungen, aus denen ein Set gebaut werden könnte." / „Shopify nicht konfiguriert — keine Set-Angebote möglich." —
28. Placeholder „Set-Preis € (optional)" / aria „Set-Preis (optional, sonst Summe der Einzelpreise)"
29. „Erstellt ein echtes (unlisted) Shopify-Set über den bestehenden Bundle-Mechanismus; der Text wird automatisch neu generiert und der Angebots-Block beim Versand angehängt."
30. Placeholder „Alle Kontakte durchsuchen…" / aria „Alle Kampagnen-Kontakte durchsuchen"
31. „Sucht…" / „Keine Treffer." / „Leer." / „Keine übersprungenen Kontakte."
32. title „Kein nachweisbares Double-Opt-in" (⚠ in Rail)
33. „Empfohlene Produkte · speichert…" / „Keine."
34. „Änderungen werden sofort gespeichert, ein angehängtes Set wird angepasst und der Text automatisch neu generiert."
35. disableReason „Speichert…" / „Ausverkauft"
36. „Aktuell N % — echter MK-Code wird beim Senden erzeugt (voraussichtlich gültig bis …). „Übernehmen" generiert den Text automatisch neu." —
37. „Kein Rabatt. Kann jederzeit gesetzt werden — „Übernehmen" generiert den Text automatisch neu; Code + Rabattzeile werden beim Versand angehängt." —
38. „Noch keine Kampagnen-E-Mails gesendet."
39. title „Für diesen Versand wurde kein Inhalt gespeichert (vor Einführung der Speicherung gesendet)."
40. LanguageToggle title „Sprache manuell festgelegt (Sync ändert sie nicht mehr)." / „Sprache aus dem Shopify-Profil abgeleitet — Klick legt sie manuell fest und generiert den Text neu." + „✎" title „Manuell festgelegt" —
41. AbGroupBadge title „A/B-Test für den KI-Hero: gerade Kontakt-IDs mit Hero senden, ungerade ohne — der KPI-Tab vergleicht beide Gruppen." —
42. SegmentBadge title = `def.reason` aus `src/lib/campaign-segments.mjs`
43. OptInBadge „· Senden blockiert"
44. Toast-Titel-Familie (Prozess-Feedback): „Entwurf wird generiert…", „Wiederhergestellt — Entwurf wird generiert…", „Sprache: … — Text wird neu generiert…", „Textmodus: … — Text wird neu generiert…", „Auswahl wird angewendet — Empfehlungen & Text werden neu erzeugt…", „Text wird neu generiert, damit er das Set erwähnt…" —

### Persistenter Zustand (Kampagne)
- URL: `?tab=kampagne&contact=<id>&view=liste|gesendet&filter=<chip>` (Desk-Position, Ansicht, Filter — history.replaceState).
- localStorage `ms-campaign-prepare` = zuletzt gewählte Vorbereiten-Einstellungen (Anzahl, Rabatt, Textmodus, KI-Hero). **2026-10:** je Kampagne `ms-campaign-prepare:<campaignId>`, Startwerte aus dem Angebot der Kampagne.
- **2026-10:** URL `?tab=kampagne` = Übersicht, `&edit=<id|new>` = Editor, `&campaign=<slug|id>` = Prüftisch dieser Kampagne (Alias `?tab=kampagnen`). Kampagnen-Definitionen in `campaigns`. **Nachtrag 2026-10:** `&edit=new&audience=<json>` = neue Kampagne mit vorgegebener Zielgruppe (KUN-134). **Nachtrag 2026-10-03:** `&view=briefe` = Ansicht „Briefe“ (KAM-116); Brief-Modus und Porto-Budget in `campaigns.letter_mode` / `letter_budget_cents`, Briefe in `campaign_letters` (Migration 0074).
- localStorage `ms-campaign-first-send` = heutiges Datum (YYYY-MM-DD) → unterdrückt den Bestätigungsdialog für weitere Sendungen am selben Tag (kampagne/*).
- Server-persistiert: Betreff/Text (Autosave), Sprach-Override, Textmodus, Rabatt, Empfehlungen, Kaufauswahl, Hero-Bild.

---

## 5. KPIs (`KpiTab.tsx`, `kpi/*`)

### Beschreibung
Bildschirm-Beschreibung: [`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §3.5 und §5 (KPI-Definitionen). Die Beschreibung vom 2026-09-08 steht im Archiv ([archive](./archive/FEATURE_INVENTORY_AUDIT_2026-09.md) §B.1).

### Controls & actions
| ID | Element | Type | What it does | Calls | File |
|---|---|---|---|---|---|
| KPI-01 | Banner „Keine Datenbank konfiguriert (DATABASE_URL) — es können keine KPIs berechnet werden." | display (warn) | – | server-render | kpi/* |
| **Zeitraum-Picker** ||||||
| KPI-02 | „Zeitraum:" Preset-Buttons „7 Tage" / „30 Tage" / „90 Tage" | button (filter) | `router.push('/admin?tab=kpi&kpiRange=<7d\|30d\|90d>')` | Navigation (URL) | kpi/KpiToolbar.tsx |
| KPI-03 | „Benutzerdefiniert" (aria-expanded) | button (toggle) | Zeigt Von/Bis | client-only | kpi/KpiToolbar.tsx |
| KPI-04 | Aktiver Zeitraum-Label (aria-live) | display | `range.label` vom Server | server-render | kpi/KpiToolbar.tsx |
| KPI-05 | „Von" / „Bis" (type=date, max heute, Von ≤ Bis) | input (date) | Benutzerdefiniert | client-only | kpi/KpiToolbar.tsx |
| KPI-06 | „Anwenden" (disabled bei ungültig) | button | `?kpiRange=custom&kpiFrom=…&kpiTo=…` | Navigation (URL) | kpi/KpiToolbar.tsx |
| KPI-07 | Hinweis „Der Zeitraum filtert alle Abschnitte bis zur Markierung „Gesamtwerte"…" | display | – | – | kpi/* |
| **1 Kern-Metriken** ||||||
| KPI-08 | Section „Kern-Metriken" · „Zeitraum: …" | display | – | `getCoreMetrics` | kpi/* |
| KPI-09 | Stats „Chats gesamt", „Ø Nachrichten / Chat", „Abgebrochen" (N · %, hint), „Engagement" (hint) — **seit 2026-10-04 „Geöffnet → geschrieben“**: Sitzungen mit `message_sent` ÷ Sitzungen mit `chat_opened` (hint „n von m Sitzungen mit geöffnetem Chat“) | display (stat) | – | – | kpi/* |
| KPI-10 | Card „Chats pro Tag · <range>" (Area-Chart, Tooltip „Chats") | chart | `core.chatsByDay` | – | kpi/*, kpi/charts.tsx |
| KPI-11 | Card „Status-Verteilung" (Donut) + Legende Aktiv/Abgebrochen/Konvertiert | chart + display | `core.status` | – | kpi/*, kpi/charts.tsx |
| KPI-12 | Caveat „Konvertiert" setzt der tägliche Conversion-Sweep… | display | – | – | kpi/* |
| KPI-13 | h4 „In-Chat-Klicks (Buttons im Chat)": Stats „Produkt-/CTA-Klicks" (hint „x pro Chat"), „Add-to-Cart-Klicks" (hint), „Sessions mit Telemetrie" (seit 2026-10-04 „Reichweite (Sitzungen)“) | display | – | – | kpi/* |
| KPI-14 | Caveat Klick-Signale/Event-Namen | display | – | – | kpi/* |
| KPI-15 | h4 „Event-Übersicht (Top 20)" Tabelle Event (code) / Anzahl. **Nachtrag 2026-10-03:** eingestellte Widget-Events (`starter_shown`, `starter_clicked`) tragen das Badge „eingestellt“ + InfoTip („Sendet das Widget seit dem 01.10.2026 nicht mehr … der Rückgang auf null ist gewollt.“) | table | `core.topEvents`; `kpi-widget-events.mjs` `DISCONTINUED_WIDGET_EVENTS` | – | kpi/sections/CoreSection.tsx (`EventName`) |
| KPI-16 | Leer „Noch keine Daten." | display | – | – | kpi/* |
| **1a Seitenkontext auf Produktseiten** — Nachtrag 2026-10-05 (A3, Gruppe Beratung nach den Kern-Metriken, Anker `seitenkontext`) ||||||
| KPI-85 | Abschnitt „Seitenkontext auf Produktseiten“ (InfoTip: was gesendet wird, Population, 24 h / 7 T., Ausschlüsse, `samePage`, Kontrollgruppe, vorab festgelegte Zielgröße, 95-%-Intervall): Stats „Sitzungen mit getippter Frage auf einer Produktseite“, „Produkt erkannt“ (hint „DE x/y · EN x/y“), „Kontrollgruppe“ (aus den Daten: „n %“ / „keine“ / „Seitenkontext aus“ / „gemischt“), „Kategorieseiten“ (hint „n erkannt“); Callout „Keine Kontrollgruppe in diesem Zeitraum — nur Abdeckung messbar.“; Warn-Callout „Eine Kontrollgruppe läuft, aber kein Experiment ist vorab festgelegt (PAGE_CONTEXT_EXPERIMENT) — kein Vergleich.“; Leer „Noch keine Daten im Zeitraum — getippte Fragen tragen den Seitenkontext erst mit dem Widget vom 06.10.2026.“ (Seitenkontext und `samePage` schickt das Widget ab `bc7fb5d`, 06.10.) | display | `getPageContextKpis` (`page_context_applied` / `_answered`, `summarisePageContextRows` in `page-context.mjs`, getestet; reiner DB-Abschnitt, nie gecacht) | – | kpi/sections/PageContextSection.tsx |
| KPI-86 | h4 „Mit Seitenkontext vs. Kontrollgruppe“ (InfoTip), nur mit vorab festgelegtem Experiment: Zeile „Andere Produkte geklickt (24 h): a vs. b“ mit StatusBadge „läuft (n / Ziel)“ bzw. „belastbar“ + „95 %-Intervall … — Unterschied gesichert / kein gesicherter Unterschied“; Tabelle Gruppe (Mit Seitenkontext / Kontrollgruppe) · Sitzungen · Ohne beendete Antwort · Andere Produkte geklickt · Produkt geklickt · Warenkorb · Bestellt (7 T.); Zeile „Ausgeschlossen: n anderer Zeitraum oder Anteil · n gemischt · n Produkt nicht erkannt · n Klick davor · n Zeitfenster offen“ | display (table) | `compareArms`, `experimentProgress`, `requiredSampleSize` (`page-context.mjs`, getestet); `PAGE_CONTEXT_EXPERIMENT = null` bis zur Kontrollgruppe | – | kpi/sections/PageContextSection.tsx |
| **2 Sprachen (DE/EN)** ||||||
| KPI-17 | Section „Sprachen (DE/EN)"; Cards „Chats nach Sprache", „E-Mail-Angaben nach Sprache" (BarList Deutsch/Englisch/Unbekannt (vor Erfassung) mit %) | display (bar list) | `getLocaleSplit` | – | kpi/* |
| KPI-18 | Caveat Migration 0041/0030; Leer „Noch keine Daten im Zeitraum." / „Noch keine Daten." | display | – | – | kpi/* |
| **3 Gesprächsqualität (KI-Analyse)** ||||||
| KPI-19 | Stats „Analysiert" (k / n, hint „% Abdeckung"), „Problem-Signale" (hint „unerfüllter Bedarf + abgesprungen"), „Gut gelöst" | display | `getConversationStats` | – | kpi/* |
| KPI-20 | Cards „Qualität" / „Themen (Kategorien)" (BarList, top 8; leer „Noch keine analysierten Beratungen.") | display (bar list) | – | – | kpi/* |
| KPI-21 | Caveat „Verteilungen umfassen nur Beratungen, die im Gespräche-Tab…"; Leer „Noch keine Beratungen im Zeitraum." | display | – | – | kpi/* |
| **4a Anmelde-Popup (anonyme Besucher:innen)** — Nachtrag 2026-10-03 (Widget vom 01.10.2026) ||||||
| KPI-75 | StageFunnelChart Angezeigt → „Anmelden“ → Bei Shopify → Im Chat, je **Sitzung**: Widget-Events `login_gate_shown` / `login_gate_signin_clicked`, in derselben Sitzung nach dem Klick die Server-Events `account_signin_succeeded` und `account_signin_linked`. **Nachtrag 2026-10-05:** „Im Chat“ zählt nur `account_signin_linked {kind:"customer_account"}` (eine Shop-Login-Verknüpfung ist keine Popup-Konversion) | chart | `getLoginGateFunnel` | – | kpi/sections/LoginGateSection.tsx |
| KPI-76 | Stats „Angezeigt“ (hint „Sitzungen“), „„Anmelden“ geklickt“ (hint „% der Anzeigen“), „Bei Shopify angemeldet“ (hint „% der Klicks“), „Im Chat angemeldet“ (hint „% der Anzeigen“), „„Später““ (hint „% · 24 h pausiert“), „Weggeklickt“ (hint „% der Anzeigen“) | display | `loginGateRates` (`kpi-widget-events.mjs`, getestet) | – | LoginGateSection.tsx |
| KPI-77 | h4 „Anmeldestarts nach Herkunft“ (InfoTip): Stats „Aus dem Popup“ (`account_signin_started` mit `source: login_gate`), „Begrüßung oder Kopfzeile“ (ohne `source`) | display | – | – | LoginGateSection.tsx |
| KPI-78 | Hinweis „n Sitzungen haben sich bei Shopify angemeldet, aber nicht im Chat — das Widget löst den Einmal-Code nicht ein (Frontend-Aufgabe 1).“ (seit 2026-10-04: „… — wo es hängt, zeigt die Diagnose.“); InfoTip mit Erklärung; Leer „Noch keine Daten.“ / „Noch keine Anmelde-Popup-Events im Zeitraum.“ | display | – | – | LoginGateSection.tsx |
| KPI-80 | h4 „Diagnose: wo Anmeldungen enden“ (InfoTip) — Tabelle Ergebnis (StatusBadge, grün = angemeldet) · Wahrscheinliche Ursache · Sitzungen, eine Zeile je Ergebnis mit Sitzungen: Im Chat angemeldet, Vom Shop erkannt, Angemeldet (zweiter Versuch), Code für andere Sitzung, Code abgelaufen oder benutzt, Widget hat nicht eingelöst, Altes Widget, Keine Rückkehr gemeldet, Rückkehr mit Fehler, Bei Shopify abgebrochen, Beim Warten geschlossen, Start nicht angekommen; darunter „Rückkehr laut Widget (account_signin_return)“ mit den `result`-Zählern (InfoTip); Hinweis bei mehr als 20.000 Sitzungen — Nachtrag 2026-10-04. **Nachtrag 2026-10-05:** + Zeilen „Bereits angemeldet, vom Shop bestätigt“ (`shop_renewed`) und „Shop-Code nicht eingelöst“ (`shop_not_redeemed`); „Vom Shop erkannt“ nur noch neue Anmeldungen (`renewed=false`); Sitzungen, die der Shop nur erkannt hat (ohne Code), bleiben draußen; neueste Sitzungen zuerst vor dem Limit; ohne `livecheck-%` | display (table) | `getSigninDiagnosis` (`classifySigninSession`, `SIGNIN_DIAGNOSIS` in `kpi-widget-events.mjs`, getestet; docs/frontend/05 §12.1) | – | kpi/sections/LoginGateSection.tsx |
| **4 Einwilligung nach der Anmeldung (Marketing-Opt-in)** — bis 2026-10-03 „Consent-Gate-Funnel“ ||||||
| KPI-84 | (2026-10-05) h4 „Nach Anmeldeweg“ (InfoTip) — Tabelle Weg · Angezeigt · Akzeptiert · Akzeptanzrate · Opt-in (Server), Zeilen „Über „Anmelden““, „Über Shop-Login erkannt“, „Ohne Anmelde-Event“ (nur > 0); je **Sitzung**, akzeptiert als Endstand; Opt-in (Server) = `email_capture_marketing_opted_in {trigger:"signin_optin"}`. Der Abschnitts-InfoTip nennt die Anti-Nag-Regel (Ablehnung in einer Sitzung oder 3 Sitzungen gesehen → 30 Tage nicht mehr gefragt) | display (table) | `getConsentGateFunnel` → `signinByWay` | – | kpi/sections/ConsentGateSection.tsx |
| KPI-87 | (2026-10-05) h4 „Nach Variante und Platzierung“ (InfoTip), nur sobald eine bekannte Variante ankommt (Widget ab `bc7fb5d`, 06.10.; Platzierungen vom Widget nur Popup und Nach Anmeldung im Chat): Tabelle Variante · Platzierung (Popup / Nach Anmeldung im Chat / Wertmoment) · Angezeigt · Akzeptiert · Akzeptanzrate („(zu wenige Sitzungen)“ unter 100) · Abgelehnt · Akzeptiert ohne Anzeige · Opt-ins (Server) · Bereits angemeldet · DOI-Quote (bestätigt/DOI nötig); je **Sitzung**; unbekannte Werte als „unbekannt“, fehlende als „ohne (älteres Widget)“ / „ohne“ | display (table) | `getConsentGateFunnel` → `byVariant` (`normalizeConsentVariantRows`, `consentVariantRates` in `kpi-widget-events.mjs`, getestet) | – | kpi/sections/ConsentGateSection.tsx |
| KPI-22 | StageFunnelChart Angezeigt → Akzeptiert — **seit 2026-10-03 nur `surface: signin`** (das Popup nach der Anmeldung; getrennt von den anderen Opt-in-Wegen). **Nachtrag 2026-10-05:** zählt **Sitzungen** mit ihrem letzten Stand (akzeptiert vor abgelehnt vor weggeklickt), nicht mehr Events | chart | `getConsentGateFunnel` | – | kpi/sections/ConsentGateSection.tsx |
| KPI-23 | Stats „Angezeigt", „Akzeptiert" (hint „% Akzeptanzrate"), „Abgelehnt", „Weggeklickt". **Nachtrag 2026-10-05:** Sitzungen mit letztem Stand (wie KPI-22) | display | – | – | kpi/* |
| KPI-24 | h4 „Chat-Gate (anonym) — eingestellt" (InfoTip: seit dem 01.10.2026 nicht mehr gezeigt) mit Stat „Chat-Gate (anonym)" (k / n; hint „% Akzeptanzrate · n abgelehnt · n weggeklickt") — nur solange ältere `surface: chat`-Events im Zeitraum liegen. Bis 2026-10-03: h4 „Nach Oberfläche" mit beiden Oberflächen | display | – | – | ConsentGateSection.tsx |
| KPI-25 | Caveat Widget-Events; Hinweis „n Anzeigen ohne surface-Angabe …"; Leer „Noch keine Daten." / „Noch keine Einwilligungs-Popup-Events im Zeitraum.". **Nachtrag 2026-10-05:** InfoTip nennt die Sitzungszählung („Gezählt werden Sitzungen mit ihrem letzten Stand … seit dem 05.10.2026, vorher Klicks“); Release-Hinweis „Ergebnis und Quelle der Opt-ins erst ab dem 05.10.2026 …“ bei früherem Zeitraumbeginn | display | – | – | ConsentGateSection.tsx |
| **5 E-Mail-Capture-Funnel** ||||||
| KPI-26 | StageFunnelChart Angeboten → Formular gesendet → Marketing-Haken → DOI bestätigt. **Nachtrag 2026-10-05:** nur das Capture-Formular (`source: mo_capture_form`; ältere Events über den Auslöser, ohne `signin_optin` / `chat_gate`); DOI bestätigt nur mit Quelle Formular | chart | `getEmailCaptureFunnel` | – | kpi/* |
| KPI-27 | Stats „Angeboten", „Formular gesendet" (hint „% der Angebote"), „Marketing-Haken", „DOI bestätigt" (hint „% der Opt-ins"). **Nachtrag 2026-10-05:** „Marketing-Haken“ hint „n DOI-Mail fällig · n bereits abonniert · n gesperrt“ (`outcome`); „DOI bestätigt“ hint „% der fälligen DOI-Mails“ (DOI-Quote = bestätigt ÷ DOI-Mail fällig); „Abgelehnt“ einmal je Sitzung und Auslöser | display | – | – | kpi/* |
| KPI-28 | h4 „Angebote nach Auslöser" BarList (Empfehlung angenommen / Vergleich geliefert / Bedenkpause / Kaufabsicht / Checkout-Absicht / Ohne Angabe / Ohne Trigger). **Nachtrag 2026-10-05:** Auslöser begrenzt (`normaliseTrigger`, `capture-funnel.mjs`): „Ohne Trigger“ heißt „Ohne Auslöser“, unbekannte Werte „Anderer Wert“ | display (bar list) | – | – | kpi/* |
| KPI-29 | Caveat „Ereigniszählung im Zeitraum…, „Abgelehnt" (Karte weggeklickt): N"; Leer „Noch keine Daten." / „Noch keine Capture-Events im Zeitraum.". **Nachtrag 2026-10-05:** InfoTip „Nur das Formular — das Popup nach der Anmeldung steht unter „Einwilligung nach der Anmeldung“ …“ und die DOI-Quote-Definition; Release-Hinweis bei früherem Zeitraumbeginn | display | – | – | kpi/* |
| **6 Umsatz über Mo-Rabattcodes** ||||||
| KPI-30 | Stats „Umsatz über Mo-Rabattcodes" (hint „N Bestellung(en) im Zeitraum", ⓘ-Tooltip), „Bestellungen mit Mo-Code" (hint), „Geprüfte Codes" (hint „N versendete Codes im Zeitraum") | display (stat + tooltip) | `getMoRevenue` | – | kpi/* |
| KPI-31 | Caveat (ausschließlich MS5-Codes, read_orders, currentTotalPrice…; + redemptionUnknown, sampled); Leer „Noch keine Daten."; Warn „Shopify ist nicht konfiguriert — der Umsatz kann nicht berechnet werden." | display | – | – | kpi/* |
| **7 Mo-zugeordneter Umsatz (Bestell-Webhook)** ||||||
| KPI-32 | Stats „Direkt", „Beraten & gekauft", „Beraten, anderes gekauft" (je hint „N Bestellung(en)" + ⓘ-Tooltip) | display (stat + tooltip) | `getMoAttributionKpis` | – | kpi/* |
| KPI-33 | Caveat (attributes[_mo], Zuordnungsfenster N Tage, Datenminimierung…; + unrealisedOrders); Leer „Noch keine Daten."; Info „Noch keine Bestellung über den Webhook erfasst. Voraussetzung: …" **Nachtrag 2026-10-05:** InfoTip nennt das Fenster des aktiven Modus (mit `MO_ATTRIBUTION_SESSION_ANCHOR`: Widget-Markierung ab der letzten Produktberatung auf dem Gerät, Mo-Links ab Erstellung), „Unmarkierte Bestellungen werden hier nicht erfasst (nicht in der Mo-Zuordnung gespeichert)“ statt „gar nicht gespeichert“, plus Absatz „Ohne Zuordnung“; das Info-Callout erscheint nur, solange weder `mo_orders` noch ein `mo_order_marker_unresolved` existiert (`ingestionSeen`) | display | – | – | kpi/*; kpi/sections/AttributionSection.tsx |
| KPI-82 | (2026-10-05) Hinweis „n markierte Bestellung(en) im Zeitraum ohne Zuordnung: a mit unbekannter oder gelöschter Markierung, b außerhalb des Zuordnungsfensters — keiner Beratung zugeordnet (nicht in der Mo-Zuordnung gespeichert), nur gezählt.“ — unresolved marked orders counted (server event `mo_order_marker_unresolved {reason, source?}`, `orders/create` only, session `NULL`); dazu `releaseNotesFor("attribution")` („Erst ab dem 05.10.2026 aussagekräftig“ für „Beraten & gekauft“ / „Beraten, anderes gekauft“) | display (note) | `getMoAttributionKpis` → `unresolvedOrders`, `countUnresolvedMarkers` (`order-attribution.mjs`, getestet) | – | kpi/sections/AttributionSection.tsx |
| **8 Kampagnen-Funnel (Shopify-Subscriber)** — 2026-10: alle Kampagnen (Empfänger = Kund:innen mit Einwilligung); neu KPI-71. **Nachtrag 2026-10:** Abschnittstitel jetzt „Kampagnen-Funnel“ ||||||
| KPI-34 | StageFunnelChart Gesendet → Geklickt → Eingelöst | chart | `getCampaignKpis` | – | kpi/* |
| KPI-35 | Stats „Gesendet" (hint „n per E-Mail · n kopiert"), „Geklickt" (hint), „Eingelöst (MK-Code)" (hint), „Sprache" (n DE · n EN, hint unbekannt), „Set geklickt" (hint), „Umsatz (MK-Codes)" (hint „x je Send · geprüfte Codes"), „Zugestellt / Bounces" (hint „n hart · n Beschwerde(n)" / „keine Zustellmeldungen (Resend-Webhook?)"), „Abgemeldet" (hint „% der Sends (30 Tage)"), „Bewertung" (x / 5, hint „N Klick-Bewertung(en) (anonym)") | display | – | – | kpi/* |
| KPI-36 | Tabelle „Hero-Vergleich: lohnt sich das KI-Bild?" (Variante / Gesendet / Klickrate / Set geklickt / Eingelöst / Umsatz / Umsatz / Send / Hero-Kosten / Kosten / Send / Abgemeldet; Zeilen Mit KI-Hero (individuell) / Standard-Hero / Ohne Hero (klassisch / kopiert) / Unbekannt (vor Migration 0054)) | table | `kpis.byHeroVariant` | – | kpi/* |
| KPI-37 | Tabelle „Nach Lebenszyklus-Segment" (gleiche Spalten ohne Kosten) | table | `kpis.bySegment` | – | kpi/* |
| KPI-38 | Caveat (Geklickt/Eingelöst-Definition, Resend-Webhook, Migration 0054, A/B-Hinweis…); Leer „Noch keine Daten." / „Noch keine Kampagnen-E-Mails im Zeitraum." | display | – | – | kpi/* |
| **9 Bundle-Angebote** ||||||
| KPI-39 | Stats „Erstellt" (hint „n aktiv · n abgelaufen · n fehlgeschlagen"), „Aktuell aktiv" (hint „unabhängig vom Zeitraum"), „Klicks auf Angebot" (hint „N Angebot(e) geklickt"), „Ø Rabatt-Tiefe" (hint „vs. Summe der Einzelpreise") | display | `getBundleKpis` | – | kpi/* |
| KPI-40 | Caveat bundle_offer_clicked / kein Kauf zugerechnet; Leer „Noch keine Daten." / „Noch keine Bundle-Angebote im Zeitraum." | display | – | – | kpi/* |
| **10 Wissen (Q&A-Queue)** ||||||
| KPI-41 | Stats „Lücken gefunden" (hint „im Zeitraum"), „Veröffentlicht" (hint), „Median bis Antwort", „Median bis Veröffentlichung" (Std./Tage) | display | `getQaKpis` | – | kpi/* |
| KPI-42 | Stats „Offen", „Beantwortet", „Veröffentlicht" (hint „gesamt"), „Scan-Backlog" (hint „geeignete, noch nicht gescannte Beratungen") | display | – | – | kpi/* |
| KPI-43 | Caveat „„Lücken gefunden" = …"; Leer „Noch keine Daten." / „Noch keine Q&A-Einträge." | display | – | – | kpi/* |
| **11 Feedback** ||||||
| KPI-44 | Stats „Eingegangen", „Mit Gesprächsbezug" (hint %), „Mit Kontakt-E-Mail" (hint „antwortbar") | display | `getFeedbackKpis` | – | kpi/* |
| KPI-45 | h4 „Nach Kundentyp" BarList | display (bar list) | – | – | kpi/* |
| KPI-46 | Caveat „Reines Volumen — …"; Leer „Noch keine Daten." / „Kein Feedback im Zeitraum." | display | – | – | kpi/* |
| **12 Kundenkonto & Self-Service** ||||||
| KPI-47 | Stats „Anmeldungen" (hint „n im Chat abgeschlossen · n stille Erkennungen · n Codes abgelehnt" — seit 2026-10-03: `account_signin_linked` / `account_signin_link_refused` aus `POST /api/auth/link`), „Zusammenfassung per E-Mail", „Zusammenfassung (Download)", „Kontaktformular" (seit 2026-10-04 hint „n Bestellung & Service · n mit Sitzung“), „Datenexporte" (hint „Art. 15/20"), „Löschungen" (hint „Art. 17"). **Nachtrag 2026-10-05:** der erste Stat heißt „Im Chat angemeldet“ und zählt **Sitzungen** (hint „n über „Anmelden“ · n über Shop-Login · n bereits angemeldet (bestätigt) · n Shopify-Anmeldungen (n still) · n Codes abgelehnt“; „über Shop-Login“ nur `renewed=false`); der Abschnitts-InfoTip ist entsprechend neu | display | `getAccountActivity` (`linkedSessions`) | – | kpi/*; kpi/sections/AccountSection.tsx |
| KPI-83 | (2026-10-05) h4 „Shop-Login-Erkennung (App Proxy)“ (InfoTip), nur wenn erkannt oder über den Shop angemeldet: Stats „Erkannt“ (hint „+n bereits angemeldet“), „Angemeldet“ (hint „% Codes eingelöst“), „Mit Chat-Token“ (hint „% der Erkannten“), „Ohne Code“ (hint „n Regel aus · n ohne Nachweis · n Personenwechsel · n Fehler“); Warn-Callout bei ≥ 20 Sitzungen mit Code und > 20 % nicht eingelöst („… `npm run verify:widget` ausführen; … APP_PROXY_SIGNIN_ENABLED=false setzen und neu deployen.“); ohne `livecheck-%` | display | `getAccountActivity` → `shopRecognition` (`account_shop_recognised`); `shopRecognitionRates`, `SHOP_REDEEM_ALARM` (`kpi-widget-events.mjs`, getestet) | – | kpi/sections/AccountSection.tsx |
| KPI-48 | Caveat Pseudonyme Zähler…; Leer „Noch keine Konto-Aktivität im Zeitraum. Sign-in-, Export- und Lösch-Ereignisse werden ab dem Deploy dieser Version erfasst." | display | – | – | kpi/* |
| **12a Bestellstatus im Chat** — Nachtrag 2026-10-04 ||||||
| KPI-81 | Abschnitt „Bestellstatus im Chat“ (Gruppe Beratung, InfoTip): Stats „Abfragen“, „Sitzungen“, „Beantwortet“ (hint „% der Abfragen“); BarLists „Ergebnis“ (Beantwortet, Keine Bestellungen, Bestellnummer nicht gefunden, Nicht angemeldet, Nicht verfügbar, Abgeschaltet, Bestellabgleich aus, Import unvollständig, Hauptbuch hinterher), „Thema“, „Quelle der Antwort“ (Nur Hauptbuch / Hauptbuch + Live); Leer „Noch keine Daten.“ / „Keine Bestellstatus-Abfragen im Zeitraum.“ | display | `getOrderStatusKpis` (`order_status_lookup`) | – | kpi/sections/OrderStatusSection.tsx |
| **Releases im Zeitraum** — Nachtrag 2026-10-04 ||||||
| KPI-79 | Callout „Änderungen im Zeitraum“ unter der Werkzeugleiste (Datum · Titel, Details im InfoTip) für jedes Release im gewählten Zeitraum (01.10. Widget-Update, 03.10. Einmal-Code, 04.10. Kundenplattform-Widget); Hinweise in Anmelde-Popup, Einwilligung, Kundenkonto und Kampagnen-Funnel („Chat gestartet“): „Erst ab dem 04.10.2026 aussagekräftig: …“ und (die ersten drei) der Anmelde-Ausfall 03.10.–04.10. **Nachtrag 2026-10-05:** + Releases `attribution-unresolved` und `attribution-window` (05.10.), Hinweis im Abschnitt „Mo-zugeordneter Umsatz“ (KPI-82); Detail des 04.10.: „Shop-Erkennung vorbereitet (aktiv erst mit App Proxy)“. **Nachtrag 2026-10-05 (2):** + Release `optin-measurement` „Opt-in-Messung nach Quelle und Ergebnis“ (05.10.); Hinweis in „Einwilligung nach der Anmeldung“ und „E-Mail-Capture-Funnel“ bei Zeitraumbeginn vor dem 05.10.2026 („Ergebnis und Quelle der Opt-ins erst ab dem 05.10.2026; ältere Events sind aus dem DOI-Status und dem Auslöser genähert …“, `OPTIN_MEASUREMENT_FROM`); „Seitenkontext auf Produktseiten“ ruft `releaseNotesFor("seitenkontext")` (noch ohne Eintrag). **Nachtrag 2026-10-05 (3):** + Releases `app-proxy-signin` „Shop-Anmeldung zählt im Chat (App Proxy)“ (PLT-03) und `signedin-offer-off` „Keine E-Mail-Zusammenfassung mehr für angemeldete Kund:innen“ (PLT-08). **Nachtrag 2026-10-06:** + Releases `consent-benefits-served` „Einwilligungs-Popup: Vorteile vom Server, Variante und Platzierung“ (PLT-05, KPI-87), `page-context-typed` „Seitenkontext bei getippten Fragen (Widget)“ (PLT-06, KPI-85) und `attribution-token-renewal` „Bestell-Zuordnung: Markierung wird nach einer Beratung erneuert“ (PLT-04, KPI-82) — die drei Änderungen des Widgets `bc7fb5d` (06.10.), ohne Abschnittshinweis. Der Callout listet jedes Release in `KPI_RELEASES` (derzeit elf) | display | `releasesInRange`, `releaseNotesFor` (`kpi-releases.mjs`, getestet) | – | KpiTab.tsx, kpi/sections/* |
| **13 KI-Kosten** ||||||
| KPI-49 | „ab <Datum> erfasst · enthält geschätzte Werte" | display | `getAiCostMetrics` | – | kpi/* |
| KPI-50 | Stats „Ø Kosten / Beratung" (hint „N Beratungen mit Token-Erfassung"), „Median / Beratung", „Gesamtausgaben" (hint „alle KI-Aufrufe im Zeitraum") | display | – | – | kpi/* |
| KPI-51 | h4 „Aufteilung": Stats „Chat (inkl. Embeddings & Sprachausgabe)" (hint „Beratungs-Chat + Produktsuche + TTS"), „Dashboard / Admin" (hint „E-Mail-Entwürfe, Profile, Analysen, Wissen") | display | – | – | kpi/* |
| KPI-52 | h4 „Nach Einsatzort" BarList (CALL_SITE_LABELS: Beratungs-Chat, Embeddings (Produktsuche), Sprachausgabe (TTS), Zusammenfassungs-E-Mail, Zusammenfassung (Download), Marketing-Entwürfe, Kampagnen-Entwürfe, Kundenprofile, Top-Fragen (Personas), Gesprächsanalyse, Insights-Rollup, Komplettanalyse, Wissen: Entwürfe, Wissen: Übersetzung, Bundle-Vorschläge). **Nachtrag 2026-10-03:** + „Kampagnen-Briefe“ (`campaign_letter`, KAM-118) | display (bar list, EUR) | – | – | kpi/* |
| KPI-53 | h4 „Prompt-Caching (Chat)": Stats „Cache-Trefferquote" (hint), „Ersparnis (netto)" (hint „Lese-Rabatt minus Schreib-Aufschlag"), „Cache-Tokens" („n gelesen", hint „n geschrieben") | display | – | – | kpi/* |
| KPI-54 | Caveat (MODEL_PRICES_JSON, USD_EUR_RATE 0,92, TTS Zeichen, Cache 0,1×/1,25×…); Leer „Noch keine KI-Verbrauchsdaten erfasst. Die Erfassung beginnt mit dem Deploy dieser Version — …" | display | – | – | kpi/* |
| **Trenner** ||||||
| KPI-55 | „GESAMTWERTE (VOM ZEITRAUM UNABHÄNGIG)" | display (divider label) | – | – | kpi/* |
| **14 Postversand (Brief)** ||||||
| KPI-56 | Stats „Versendete Briefe", „Portokosten gesamt", „Ø Kosten / Brief" | display | `getPhysicalLetterStats` | – | kpi/* |
| KPI-57 | Caveat PINGEN_LETTER_COST_CENTS 106; Leer „Noch keine Briefe versendet." | display | – | – | kpi/* |
| **15 Marketing-Funnel** ||||||
| KPI-58 | StageFunnelChart Gesendet → Geklickt → Eingelöst (nur mit Shopify) | chart | `getMarketingFunnel` | – | kpi/* |
| KPI-59 | Stats „Gesendet", „Geklickt" (hint „% Klickrate"), „Eingelöst (Code verwendet)" (hint „% der geprüften Codes") | display | – | – | kpi/* |
| KPI-60 | Caveat („Geklickt" = /api/r/<token>…; + Shopify-nicht-konfiguriert, redemptionUnknown, sampled 100); Leer „Noch keine Daten." / „Noch keine Marketing-E-Mails versendet." | display | – | – | kpi/* |
| **16 Persona-Insights** ||||||
| KPI-61 | Card „Verteilung (Chats je Persona)" (horizontale Balken mit Werten) | chart | `getPersonaInsights(5)` | – | kpi/*, kpi/charts.tsx |
| KPI-62 | Persona-Karte: Name + „N Chats"; h5 „Lieblingsprodukte (am häufigsten empfohlen)" FavoriteBars / Caveat „Keine Produktempfehlungen erfasst." | display | – | – | kpi/* |
| KPI-63 | „Top-Fragen dieser Gruppe" + „✨ Top-Fragen generieren" / „Neu generieren" / „Wird erstellt…" | button (KI-Lauf) | On-Demand-Zusammenfassung; Fehlertexte „Fehler beim Erstellen der Zusammenfassung." / „Netzwerkfehler — bitte erneut versuchen." | POST /api/admin/kpi/top-questions `{personaLabel, force}` | kpi/KpiTopQuestions.tsx |
| KPI-64 | Top-Fragen-Ergebnis (Markdown) + Meta „Stichprobe: N Nachrichten · zwischengespeichert/frisch generiert · <Zeit> · <Modell>"; Skeleton beim Laden | display | – | – | kpi/KpiTopQuestions.tsx |
| KPI-65 | Leer „Noch keine klassifizierten Konversationen." | display | – | – | kpi/* |
| **17 Empfehlung → Kauf** ||||||
| KPI-66 | Warn-Banner „Nur Kund:innen, die ihre E-Mail angegeben haben — … keine site-weite Conversion-Rate." | display (warn) | `getRecommendationLoop` | – | kpi/* |
| KPI-67 | Headline-Prozent + „der Käufer:innen mit E-Mail-Angabe kauften ein zuvor empfohlenes Produkt" | display | – | – | kpi/* |
| KPI-68 | StageFunnelChart Kontakte geprüft → mit Empfehlung → mit Kauf → Kauf = Empfehlung + gleichnamige Stats | chart + display | – | – | kpi/* |
| KPI-69 | Caveat „⚠️ Aussagekraft begrenzt…" (+ purchaseUnknown, sampled 100); Leer „Noch keine Daten."; Warn „Shopify ist nicht konfiguriert — die Kauf-Zuordnung kann nicht berechnet werden." | display | – | – | kpi/* |
| **Charts (KpiCharts.tsx, gemeinsam; heute `kpi/charts.tsx`)** ||||||
| KPI-70 | ChartFrame Skeleton bis Client-Mount; ChartTooltip (themed Popover, de-DE-Zahlen) | display (loading/tooltip) | – | – | kpi/charts.tsx |
| **Kundenplattform (ab 2026-10-01)** ||||||
| KPI-71 | Tabelle „Kampagnen im Vergleich“ (InfoTip „Derselbe Funnel je Kampagne (Lebenszyklus, Aktionen, Einzelansprache) — welche Kampagne bringt was?“; Spalten wie KPI-37, erste Spalte „Kampagne“) im Kampagnen-Funnel. **Nachtrag 2026-10:** Spalte „Chat gestartet“ — Sends, deren Mo-Link einen Chat geöffnet hat (`campaign_chat_started`, sitzungslos, einmal je Send; das Widget meldet den `mo_c`-Token als `campaignToken`) | table | `kpis.byCampaign` | `getCampaignKpis` (gecacht) | kpi/sections/CampaignSection.tsx |
| KPI-72 | Abschnitt „Eingang“ (Gruppe Marketing & Kampagne, zeitraumabhängig): Stats „Hinweise“ (im Zeitraum entstanden), „Gehandelt“ (Anteil), „KI-Vorschläge“; Tabelle je Art: Entstanden / Gehandelt / Verworfen / Von selbst / Bestellung danach (gehandelt) / Umsatz danach / Häufigster Verwerfgrund (**Nachtrag 2026-10:** „Bestellung danach (gehandelt)“ und „Umsatz danach“ zählen nur Team-Entscheidungen wie „Gehandelt“ — von selbst erledigte und abgelaufene nicht mehr, der Anteil kann nicht über 100 % steigen); Caveat „… Beschreibung, kein Wirkungsnachweis …“; leer „Im Zeitraum sind keine Hinweise entstanden.“ | display + table | Lernschleife des Eingangs (14-Tage-Ergebnis) | `getInboxKpis(range)` (reine DB, nicht gecacht) | kpi/sections/EingangSection.tsx, lib/inbox-store.ts |
| KPI-73 | Abschnitt „Kundenbasis“ (Gesamtwerte, Badge „Gesamt“): Stats „Kunden gesamt“ (n Shopify · n Interessenten), „Mit Mo gesprochen“ (Anteil · davon Shopify-Kunden), „Mit Einwilligung“ (Anteil · DOI-Anteil), „Abwanderung hoch“; BarLists Lebenszyklus, Einwilligung (Angemeldet / Bestätigung offen / Abgemeldet / Keine Einwilligung / Gesperrt), Wertstufe + Profile (Vollprofil / Kaufprofil / Ohne Profil) | display + bar lists | Form des ganzen Kundenstamms | `getCustomerBaseKpis()` (reine DB) | kpi/sections/KundenbasisSection.tsx, lib/customer-list-store.ts |
| KPI-74 | Abschnitt „Mo-Effekt“ (Gesamtwerte, Badge „Gesamt“, InfoTip „Das ist ein Zusammenhang, kein Beweis …“): Stats „Bestellungen je Kunde (Mo)“, „Ø Bestellwert (Mo)“, „Wiederkaufquote (Mo)“ (Hint „±x ggü. vergleichbar ohne Mo“), „Über Mo gewonnen“ (erstes Gespräch vor der ersten Bestellung; + Umsatz seitdem); Tabelle „Nach Wertstufe“ (Kund:innen Mo / ohne, Bestellungen je Kunde, Ø Bestellwert, Wiederkauf); BarList „Abonnent:innen nach Herkunft“ | display + table + bar list | Mo-Kund:innen gegen Kund:innen ohne Gespräch, auf dieselbe Wertstufen-Mischung umgewichtet | `getMoEffectKpis()` (reine DB) + `computeMoEffect` (`src/lib/mo-effect.mjs`, getestet) | kpi/sections/MoEffektSection.tsx, lib/customer-list-store.ts |

### Helper/explanatory text (KPIs) — 66 (Caveats vollständig zitiert, da inhaltlich zu erhalten)
1. „Der Zeitraum filtert alle Abschnitte bis zur Markierung „Gesamtwerte". Marketing-Funnel, Persona-Insights, Empfehlung→Kauf und Postversand sind Gesamtwerte (zeitraumunabhängig)." — kpi/*
2. Section-Subtitle „Zeitraum: <label>." — /206
3. Hint „status='abandoned' (Beratung ohne Abschluss)"
4. Hint „Chats mit Nachricht ÷ Sessions mit Telemetrie"
5. Caveat „„Konvertiert" setzt der tägliche Conversion-Sweep: der einmalige Mo-Rabattcode (MS5-…) der aus dieser Beratung entstandenen Marketing-E-Mail wurde in einer echten Bestellung eingelöst — dieselbe ehrliche Zuordnung wie beim Umsatz-Abschnitt. Käufe ohne Mo-Code sind nicht zurechenbar und erscheinen hier nicht; „Konvertiert" ist eine Untergrenze." —
6. Hint „x pro Chat" (2×)
7. Caveat „Klick-Signale werden anhand der Event-Namen aus der Widget-Telemetrie gemustert (Produkt/CTA: %product%click% / %cta%click%; Warenkorb: %cart% / %checkout%). Die vollständige Event-Übersicht zeigt die Rohdaten."
8. Subtitle „Das Einwilligungs-Gate im Chat und die Opt-in-Karte bei der Anmeldung: angezeigt → akzeptiert („Ja, Angebote aktivieren") — Zeitraum: …" —
9. Hint „% Akzeptanzrate" / „akzeptiert / angezeigt" / „% Akzeptanzrate · n abgelehnt · n weggeklickt"
10. Caveat „Alle vier Events sendet das Widget (consent_gate_shown / _accepted / _declined / _dismissed, mit surface: chat|signin) — gemessen wird die Oberfläche, nicht die bestätigte Anmeldung: ein „Akzeptiert" wird erst mit dem Klick auf den Double-Opt-in-Link zur wirksamen Marketing-Einwilligung (siehe E-Mail-Capture-Funnel in der Event-Übersicht). Events ohne surface zählen nur in den Gesamtwerten." —
11. Subtitle „Bestellungen, die einen einmaligen, von Mo verschickten Rabattcode eingelöst haben — Zeitraum: …" —
12. Tooltip „Summe der tatsächlich bezahlten Bestellsummen (Shopify currentTotalPrice, Status PAID/PARTIALLY_REFUNDED) aller Bestellungen, die einen einmaligen, von Mo verschickten Rabattcode (MS5-…) eingelöst haben. Warenkorb-Links ohne Code sind nicht zurechenbar und zählen nicht."
13. Hints „N Bestellung(en) im Zeitraum" / „eingelöste, bezahlte Bestellungen" / „N versendete Codes im Zeitraum"
14. Caveat „„Umsatz über Mo-Rabattcodes" zählt ausschließlich Bestellungen, die einen einmaligen, von Mo verschickten Rabattcode (MS5-…, aus der personalisierten Marketing-E-Mail) eingelöst haben — geprüft per Shopify (read_orders) über das Bestellfeld discount_code, gezählt wird der tatsächlich bezahlte Bestellwert (currentTotalPrice, nur Status PAID / PARTIALLY_REFUNDED). Käufe über Warenkorb-Links (In-Chat-Checkout, Zusammenfassungs-E-Mail, Bundles) zählen hier bewusst NICHT — sie werden seit der Attributions-Runde separat im Abschnitt „Mo-zugeordneter Umsatz (Bestell-Webhook)" gemessen. [Bei N Code(s) lieferte Shopify keine Antwort (nicht gezählt).] [Auf die N neuesten Codes begrenzt.]" —
15. Warn „Shopify ist nicht konfiguriert — der Umsatz kann nicht berechnet werden." —
16. Subtitle „Bestellungen mit Mo-Markierung (Warenkorb-Attribut oder Mo-Rabattcode), per Shopify-Webhook erfasst — Zeitraum: …" —
17. Info „Noch keine Bestellung über den Webhook erfasst. Voraussetzung: die Shopify-Webhooks orders/create + orders/paid sind auf /api/webhooks/shopify registriert (siehe docs/ORDER_ATTRIBUTION.md) — erfasst wird ab Registrierung, rückwirkend nicht." —
18. Tooltip „Direkt": „Bestellungen über einen von Mo gebauten Kauf-Weg: ein eingelöster Mo-Rabattcode (MS5-/MK-) oder ein von Mo verschickter Warenkorb-Link (Zusammenfassung, Marketing-E-Mail, Bundle). Nur bezahlte Bestellungen (PAID/PARTIALLY_REFUNDED)."
19. Tooltip „Beraten & gekauft": „Der Warenkorb trug die Session-Markierung des Widgets UND mindestens ein gekauftes Produkt wurde in dieser Beratung besprochen/ausgewählt — auch wenn es manuell über die Suche in den Warenkorb gelegt wurde." —
20. Tooltip „Beraten, anderes gekauft": „Session-Markierung vorhanden, aber kein gekauftes Produkt stammt aus der Beratung — Mo hat beraten, gekauft wurde etwas anderes." —
21. Caveat „Erfasst werden ausschließlich Bestellungen mit Mo-Markierung: dem opaken Warenkorb-Attribut attributes[_mo] (von Mo-Links oder dem Widget-Stempel gesetzt, Zuordnungsfenster N Tage) oder einem Mo-Rabattcode. Unmarkierte Bestellungen werden gar nicht gespeichert (Datenminimierung); die Zeilen sind pseudonym (keine Kundendaten). Geräteübergreifende Käufe (Beratung am Handy, Kauf am Laptop) bleiben ohne E-Mail/Code unsichtbar — physikalische Grenze, keine Messlücke. [N erfasste Bestellung(en) im Zeitraum sind (noch) nicht bezahlt und zählen nicht zum Umsatz.]" —  **Nachtrag 2026-10-05** (AttributionSection.tsx): Fenster je Modus („… bei der Widget-Markierung ab der letzten Produktberatung auf dem Gerät (Produktkarte, Vergleich, Warenkorb-Karte, Showroom), bei Mo-Links ab ihrer Erstellung.“ bzw. „… ab der Erstellung der Markierung.“); „Unmarkierte Bestellungen werden hier nicht erfasst (nicht in der Mo-Zuordnung gespeichert)“; neuer Absatz „„Ohne Zuordnung“: die Markierung ist unbekannt (nach einer Löschanfrage oder abgelaufen gelöscht), oder die letzte Beratung (Schalter aus: die Markierung) lag mehr als N Tage vor der Bestellung. Diese Bestellungen werden nur gezählt, keiner Beratung zugeordnet und nicht gespeichert.“
22. Subtitle „Geschätzte KI-Kosten (EUR) aus erfassten Token-Verbräuchen pro Modell — Zeitraum: …" —
23. Info „Noch keine KI-Verbrauchsdaten erfasst. Die Erfassung beginnt mit dem Deploy dieser Version — danach erscheinen hier die Kosten." —
24. „ab <Datum> erfasst · enthält geschätzte Werte"
25. Hints „N Beratungen mit Token-Erfassung" / „alle KI-Aufrufe im Zeitraum" / „Beratungs-Chat + Produktsuche + TTS" / „E-Mail-Entwürfe, Profile, Analysen, Wissen" / „gelesene Cache-Tokens ÷ Chat-Input-Tokens" / „Lese-Rabatt minus Schreib-Aufschlag" / „n geschrieben"
26. Caveat „Kosten werden aus den vom Anbieter gemeldeten Token-Zahlen je Modell berechnet (Preistabelle in USD pro Mio. Tokens, überschreibbar via MODEL_PRICES_JSON; EUR-Umrechnung via USD_EUR_RATE, Standard 0,92). „Ø Kosten / Beratung" zählt nur den Chat-Verbrauch je Konversation. Embeddings (Produktsuche) sind kostenseitig Rauschen, werden aber ehrlich mitgezählt. Für die Sprachausgabe (TTS) zählt die Spalte Input-Tokens Zeichen statt Tokens (Abrechnung je Zeichen). Cache-Lesen kostet 0,1×, Cache-Schreiben 1,25× des Input-Preises — die Ersparnis ist der Netto-Effekt gegenüber denselben Aufrufen ohne Caching[; einzelne Werte sind geschätzt, wenn der Anbieter keine Token-Zahl liefert]." —
27. Subtitle „Versendete Briefe (Pingen → Deutsche Post) und die angefallenen Portokosten."
28. Caveat „Kosten je Brief stammen aus dem von Pingen gemeldeten Preis; wo (noch) kein Preis vorliegt (z. B. Staging), wird ein konfigurierbarer Standard angesetzt (PINGEN_LETTER_COST_CENTS, Standard 106 = 1,06 €). Gezählt werden an Pingen übergebene Briefe (fehlgeschlagene Übermittlungen zählen nicht)."
29. Info „Noch keine Briefe versendet."
30. Subtitle „Versendete Marketing-E-Mails: gesendet → geklickt → eingelöst (persönlicher Code verwendet)."
31. Hints „% Klickrate" / „% der geprüften Codes"
32. Caveat „„Geklickt" zählt E-Mails, deren Warenkorb-Link (über die getrackte Weiterleitung /api/r/<token>) mindestens einmal angeklickt wurde — kein Tracking-Pixel, nur der bewusst geklickte Link. „Eingelöst" prüft per Shopify (read_orders), ob der einmalige persönliche Code der jeweiligen E-Mail in einer echten Bestellung verwendet wurde; die Einlösungsrate bezieht sich auf die geprüften Codes mit Shopify-Antwort (nicht auf alle Sends — die Prüfung ist auf die neuesten Codes begrenzt). [Shopify ist nicht konfiguriert — die Einlösung kann nicht berechnet werden.] [Bei N Code(s) lieferte Shopify keine Antwort (als „unbekannt" gewertet).] [Einlösungsprüfung auf die 100 neuesten Codes begrenzt.]" —
33. Info „Noch keine Marketing-E-Mails versendet."
34. Subtitle „Gruppiert nach abgeleitetem Persona-Archetyp."
35. „Lieblingsprodukte (am häufigsten empfohlen)" / Caveat „Keine Produktempfehlungen erfasst."
36. Info „Noch keine klassifizierten Konversationen."
37. „⚠️ On-Demand-KI-Analyse von bis zu 80 echten Nutzernachrichten — kostet Anthropic-Tokens (wenige Cent pro Lauf). Ergebnis wird zwischengespeichert." — kpi/KpiTopQuestions.tsx
38. „Stichprobe: N Nachrichten · zwischengespeichert/frisch generiert · <Zeit> · <Modell>" — kpi/KpiTopQuestions.tsx
39. Subtitle „ROI-Kennwert für die Teilmenge der Kund:innen, die ihre E-Mail angegeben haben — KEINE site-weite Conversion-Rate." —
40. Warn „Nur Kund:innen, die ihre E-Mail angegeben haben — also eine Minderheit aller Chat-Nutzer:innen. Diese Zahl ist keine site-weite Conversion-Rate." —
41. „der Käufer:innen mit E-Mail-Angabe kauften ein zuvor empfohlenes Produkt"
42. Caveat „⚠️ Aussagekraft begrenzt: erfasst nur Nutzer, die eine E-Mail angegeben und der Verarbeitung zugestimmt haben — also eine Minderheit aller Chatter und nicht alle Käufer. Produkt-Zuordnung erfolgt über normalisierte Shopify-Handles; umbenannte/archivierte Produkte können fehlen. [Bei N Kontakt(en) lieferte Shopify keine Antwort (als „unbekannt" gewertet).] [Stichprobe auf die 100 neuesten Kontakte begrenzt.]" —
43. Warn „Shopify ist nicht konfiguriert — die Kauf-Zuordnung kann nicht berechnet werden." —
44. Subtitle „Beratungen nach gewählter Chat-Sprache und E-Mail-Angaben nach Capture-Sprache — Zeitraum: …" —
45. Caveat „Die Chat-Sprache wird seit Migration 0041 pro Beratung gespeichert (letzter Turn zählt); ältere Beratungen erscheinen als „Unbekannt". Capture-Sprache seit Migration 0030."
46. Subtitle „Analyse-Abdeckung und Qualitäts-/Themenverteilung der analysierten Beratungen — Zeitraum: …" —
47. Hints „% Abdeckung" / „unerfüllter Bedarf + abgesprungen"
48. Caveat „Verteilungen umfassen nur Beratungen, die im Gespräche-Tab (einzeln oder per Bulk) analysiert wurden — die Abdeckung oben zeigt, wie repräsentativ das ist. Die Analyse läuft auf Abruf, nicht automatisch." —
49. Subtitle „Mo bietet die Chat-Zusammenfassung per E-Mail an: angeboten → Formular gesendet → Marketing-Haken gesetzt → Double-Opt-in bestätigt — Zeitraum: …" —
50. Hints „% der Angebote" / „% der Opt-ins"
51. Caveat „Ereigniszählung im Zeitraum (nicht pro Sitzung verkettet): ein DOI-Klick, der ein Opt-in vom Vortag bestätigt, zählt im Zeitraum des Klicks. „Abgelehnt" (Karte weggeklickt): N — vom Widget gemeldet. Wirksam wird die Marketing-Einwilligung erst mit dem DOI-Klick." —
52. Subtitle „Kampagnen-E-Mails (MK-Codes): gesendet → CTA geklickt → Code eingelöst — Zeitraum: …" —
53. Hints Kampagne: „n per E-Mail · n kopiert" / „noch keine getrackten Sends" / „% von n getrackten" / „% der geprüften Codes" / „n unbekannt (Kontakt gelöscht)" / „% der n Sends mit Set" / „kein Set-Angebot im Zeitraum" / „x je Send · geprüfte Codes" / „keine Zustellmeldungen (Resend-Webhook?)" / „n hart · n Beschwerde(n)" / „% der Sends (30 Tage)" / „N Klick-Bewertung(en) (anonym)"
54. Tabellen-Subtitle „Derselbe Funnel je Hero-Variante der versendeten Mail — mit den Hero-Kosten der jeweiligen Kontakte (Prompt, Renders, Prüfung)." —
55. Tabellen-Subtitle „Derselbe Funnel je Segment (Zeit seit dem letzten Kauf)."
56. Caveat „„Geklickt" zählt Sends, deren getrackter Promo-CTA (/api/r/<token>) mindestens einmal angeklickt wurde — Sends vor Migration 0041 und Kopier-Sends tragen keinen Link und können nicht als geklickt zählen (Basis: getrackte Sends). „Eingelöst" prüft per Shopify, ob der einmalige MK-Code der jeweiligen E-Mail verwendet wurde; die Rate bezieht sich auf die geprüften Codes mit Antwort. […] „Zugestellt / Bounces" kommt aus dem Resend-Webhook (harte Bounces und Beschwerden sperren die Adresse dauerhaft). „Set geklickt" und „Abgemeldet" gelten für Sends ab Migration 0054; die Abmeldung wird den Kampagnen-Mails der letzten 30 Tage an diese Adresse zugeordnet. Bewertungen sind absichtlich anonym und lassen sich keiner Variante zuordnen. Für einen fairen Hero-Vergleich brauchen beide Gruppen Sends — der Kampagnen-Workspace zeigt je Kontakt die A/B-Gruppe an (gerade Kontakt-ID: mit Hero, ungerade: ohne)." —
57. Subtitle „Persönliche Set-Angebote (unlisted Shopify-Produkte): erstellt, Lebenszyklus und Klicks auf den Angebots-Link — Zeitraum: …" —
58. Hints Bundle „n aktiv · n abgelaufen · n fehlgeschlagen" / „unabhängig vom Zeitraum" / „N Angebot(e) geklickt" / „vs. Summe der Einzelpreise"
59. Caveat „Klicks stammen vom getrackten Angebots-Link (bundle_offer_clicked). Ein Kauf eines Bundles wird bewusst nicht zugerechnet — es gibt kein zuverlässig gespeichertes Bestellsignal je Angebot (keine erfundene Zuordnung; siehe Umsatz-Abschnitt)." —
60. Subtitle „Wissenslücken aus Beratungen: gefunden → beantwortet → veröffentlicht — Durchsatz im Zeitraum: …" —
61. Hints „im Zeitraum" / „gesamt" / „geeignete, noch nicht gescannte Beratungen"
62. Caveat „„Lücken gefunden" = im Zeitraum erstellte Queue-Einträge (der Scan läuft auf Abruf im Wissen-Tab). Die Latenz misst vom Entwurf bis zur Operator-Antwort bzw. Veröffentlichung (Median über die im Zeitraum beantworteten/veröffentlichten Einträge). Ob Mo eine veröffentlichte Antwort tatsächlich verwendet hat, wird nicht gemessen."
63. Subtitle „Freitext-Feedback aus dem Widget — Volumen im Zeitraum: …" / Hint „antwortbar" / Caveat „Reines Volumen — die Inhalte stehen im Feedback-Tab. Der Kundentyp ist die Widget-Selbstauskunft (telemetriegradig, nicht verbindlich)." —
64. Subtitle „Shopify-Anmeldungen, DSGVO-Self-Service und Zusammenfassungen — Zeitraum: …" / Hints „n stille Erkennungen", „Art. 15/20", „Art. 17" —
65. Info „Noch keine Konto-Aktivität im Zeitraum. Sign-in-, Export- und Lösch-Ereignisse werden ab dem Deploy dieser Version erfasst."
66. Caveat „Pseudonyme Zähler (kpi_events bzw. KI-Verbrauchszeilen der Zusammenfassungen) — keine Personenbezüge. „Stille Erkennungen" sind automatische Wieder-Anmeldungen bereits eingeloggter Shopify-Kund:innen (prompt=none). Kontaktformular = akzeptierte Übermittlungen; vergleichbar mit den show_contact_form-Aufrufen im Gespräche-Tab." — . **Nachtrag 2026-10-05:** der InfoTip erklärt jetzt „Im Chat angemeldet“ (Sitzungen; „über „Anmelden““, „über Shop-Login“ nur neue Anmeldungen, „bereits angemeldet (bestätigt)“), „Shopify-Anmeldungen“ / „still“ (prompt=none) und „Codes abgelehnt“; neu der InfoTip von „Shop-Login-Erkennung (App Proxy)“ (KPI-83) und von „Nach Anmeldeweg“ (KPI-84); der Einwilligungs-InfoTip nennt die Anti-Nag-Regel — AccountSection.tsx, ConsentGateSection.tsx
(+ Leerzustände „Noch keine Daten." in fast jeder Sektion und die Divider-Beschriftung „Gesamtwerte (vom Zeitraum unabhängig)".)

### Persistenter Zustand (KPIs)
- URL: `?tab=kpi&kpiRange=7d|30d|90d|custom[&kpiFrom=YYYY-MM-DD&kpiTo=YYYY-MM-DD]` (kpi/KpiToolbar.tsx; page.tsx). Kein localStorage/Cookie.
- Serverseitig gecacht: Top-Fragen je Persona (`getCachedTopQuestionsMap`).

---

## 6. Feedback (`FeedbackTab.tsx`, `feedback/FeedbackList.tsx`)

### Beschreibung
Bildschirm-Beschreibung: [`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §3.7. Die Beschreibung vom 2026-09-08 steht im Archiv ([archive](./archive/FEATURE_INVENTORY_AUDIT_2026-09.md) §B.1).

### Controls & actions
| ID | Element | Type | What it does | Calls | File |
|---|---|---|---|---|---|
| FEE-01 | Banner „Keine Datenbank konfiguriert (DATABASE_URL) — es kann kein Feedback geladen werden." | display (warn) | – | server-render | FeedbackTab.tsx |
| FEE-02 | Banner „Noch kein Feedback. Sobald Nutzer:innen über das Widget eine Rückmeldung senden, erscheint sie hier — neueste zuerst." | display (info) | Leerzustand | server-render | FeedbackTab.tsx |
| FEE-03 | „Suche (Text, E-Mail, Seite)" `#fb-search` (Placeholder „Stichwort…") | input (search) | Substring auf message/email/page | client-only | feedback/FeedbackList.tsx |
| FEE-04 | „Tier" `#fb-tier` (Alle + datengetriebene Tier-Werte) | select (filter) | Filter nach tier | client-only | feedback/FeedbackList.tsx |
| FEE-05 | „Sortierung" `#fb-sort` (Neueste zuerst / Älteste zuerst) | select (sort) | created_at | client-only | feedback/FeedbackList.tsx |
| FEE-06 | „N Rückmeldung(en)" / „k von N Rückmeldung(en)" | display | Zähler | – | feedback/FeedbackList.tsx |
| FEE-07 | „Keine Rückmeldungen für diese Suche/Filter." | display | Leer nach Filter | – | feedback/FeedbackList.tsx |
| FEE-08 | Feedback-Karte: Datum/Zeit, Badge Tier, Badge E-Mail, Nachricht (pre-wrap), dl „Seite:" / „Session:" (mono) / „Thread:" (mono) | display (card) | – | server-render | feedback/FeedbackList.tsx |

### Helper/explanatory text (Feedback) — 4
1. „Keine Datenbank konfiguriert (DATABASE_URL) — es kann kein Feedback geladen werden." — FeedbackTab.tsx
2. „Noch kein Feedback. Sobald Nutzer:innen über das Widget eine Rückmeldung senden, erscheint sie hier — neueste zuerst." — FeedbackTab.tsx
3. Placeholder „Stichwort…" — feedback/FeedbackList.tsx
4. „Keine Rückmeldungen für diese Suche/Filter." — feedback/FeedbackList.tsx

### Persistenter Zustand (Feedback)
- Nur `?tab=feedback`. Suche/Filter/Sort flüchtig (React-State).

---

## 7. Gespräche (`GespraecheTab.tsx`, `gespraeche/*`)

### Beschreibung
Bildschirm-Beschreibung: [`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §3.6. Die Beschreibung vom 2026-09-08 steht im Archiv ([archive](./archive/FEATURE_INVENTORY_AUDIT_2026-09.md) §B.1).

### Controls & actions
| ID | Element | Type | What it does | Calls | File |
|---|---|---|---|---|---|
| GES-01 | Banner „Keine Datenbank konfiguriert (DATABASE_URL) — es können keine Gespräche geladen werden." | display (warn) | – | server-render | GespraecheTab.tsx |
| **Filterleiste** ||||||
| GES-02 | Suchfeld (type=search, Placeholder „Alle Gespräche durchsuchen — Wörter, Namen, IDs, E-Mail, Tags …", Enter = Suchen) | input (search) | Setzt `gq`, Seite 1; Zeitraum wird ignoriert | Navigation (URL `gq`) | gespraeche/ConversationFilters.tsx |
| GES-03 | „🔍 Suchen" | button | Übernimmt Suchentwurf | Navigation | gespraeche/ConversationFilters.tsx |
| GES-04 | „✕ Zurücksetzen" (nur bei aktiver Suche) | button | Löscht `gq` | Navigation | gespraeche/ConversationFilters.tsx |
| GES-05 | Hinweis „Suche nach „…" über alle Gespräche — der Zeitraum wird ignoriert." | display | – | – | gespraeche/ConversationFilters.tsx |
| GES-06 | „Zeitraum:" „7 Tage" / „30 Tage" / „90 Tage" | button (filter) | `grange` | Navigation | gespraeche/ConversationFilters.tsx |
| GES-07 | „Benutzerdefiniert" (aria-expanded) | button (toggle) | Zeigt Von/Bis | client-only | gespraeche/ConversationFilters.tsx |
| GES-08 | „Tier:" Select (Alle / Anonym / E-Mail / Angemeldet) | select (filter) | `gtier` | Navigation | gespraeche/ConversationFilters.tsx |
| GES-09 | „Kategorie:" Select (Alle + CATEGORY_LABELS aus conversation-analysis-core) | select (filter) | `gcat` | Navigation | gespraeche/ConversationFilters.tsx |
| GES-10 | „Qualität:" Select (Alle + QUALITY_LABELS) | select (filter) | `gqual` | Navigation | gespraeche/ConversationFilters.tsx |
| GES-11 | Checkbox „nur ohne Bot-Antwort" | checkbox (filter) | `gerr=1` | Navigation | gespraeche/ConversationFilters.tsx |
| GES-12 | Zeitraum-Label (aria-live) | display | `filter.label` | – | gespraeche/ConversationFilters.tsx |
| GES-13 | „Von" / „Bis" (date) + „Anwenden" | input + button | `grange=custom&gfrom&gto` | Navigation | gespraeche/ConversationFilters.tsx |
| **Stats-Panel (GespraecheStatsPanel)** ||||||
| GES-14 | „📊 Auswertung · <from> – <to>" | display | – | – | gespraeche/StatsPanel.tsx |
| GES-15 | „N Gespräch(e) · M analysiert" | display | `stats` | – | gespraeche/StatsPanel.tsx |
| GES-16 | „Alle auswerten (N)" / „Alle ausgewertet" (disabled bei 0) | button → dialog | Öffnet Bestätigung | client-only | gespraeche/StatsPanel.tsx |
| GES-17 | Dialog „Alle nicht analysierten Gespräche auswerten?" (Kosten-Schätzung; „Abbrechen" / „Auswerten" / „Läuft…") | dialog (confirm) | Bulk-Analyse; Live-Toast „Sammelanalyse läuft…" → Ergebnis „N analysiert, k fehlgeschlagen · Kosten · noch M offen (erneut ausführen)"; refresh | POST /api/admin/conversations/analyze-bulk `{from, to, confirm:true}` | gespraeche/StatsPanel.tsx |
| GES-18 | Verteilung „Kategorien" (klickbare Balken; aktiv hervorgehoben; title „Liste auf „X" filtern — zeigt ALLE passenden Gespräche" / „Filter entfernen") | chart (bar list, filter) | Setzt/entfernt `gcat` | Navigation | gespraeche/StatsPanel.tsx |
| GES-19 | Verteilung „Qualität" (klickbar) | chart (bar list, filter) | Setzt/entfernt `gqual` | Navigation | gespraeche/StatsPanel.tsx |
| GES-20 | Leer „— noch keine Daten" | display | – | – | gespraeche/StatsPanel.tsx |
| GES-21 | Hinweis „Klick auf einen Balken filtert die Gesprächsliste darunter auf ALLE passenden (analysierten) Gespräche…" | display | – | – | gespraeche/StatsPanel.tsx |
| **Liste (links)** ||||||
| GES-22 | „N Gespräch(e)/Treffer · Seite p/N" / „Keine Treffer" / „Keine Gespräche" | display | – | – | gespraeche/ConversationList.tsx |
| GES-23 | „‹" / „›" (aria „Vorherige Seite"/„Nächste Seite") | button (pagination) | `gpage` | Navigation | gespraeche/ConversationList.tsx |
| GES-24 | Leer „Keine Gespräche gefunden für „q"." / „Keine Gespräche für diesen Zeitraum/Filter." | display | – | – | gespraeche/ConversationList.tsx |
| GES-25 | Zeile (role=button): Datum/Zeit, TierBadge (TIER_LABELS), „N Nachricht(en)", Persona-Kurzlabel | list item | Wählt Gespräch | client-only | gespraeche/ConversationList.tsx |
| GES-26 | OutcomeChips: „⚠ keine Antwort" (destructive), „🛒 Cart genutzt" (success), „🛒 Cart angeboten" (outline), „✉ E-Mail" (info), „🔧 N Tool(s)" (title = Tool-Labels Profil/Suche/Produkt/Vergleich/Warenkorb/Showroom/Kontakt/E-Mail; **Nachtrag 2026-10-03:** + „Bestellung“ für `get_order_status`, `gespraeche/badges.tsx` `TOOL_LABELS`) | badge | Signale | – | gespraeche/ConversationList.tsx |
| GES-27 | CategoryBadge (accent) + Qualitäts-Badge (warning wenn negativ) + Kurz-Summary (2 Zeilen, title=voll) / „nicht analysiert" | badge + display | Analyse-Status | – | gespraeche/ConversationList.tsx |
| **Detail (rechts, ConversationDetail)** ||||||
| GES-28 | Platzhalter „Wähle links ein Gespräch, um Transkript und Analyse zu sehen." | display | – | – | gespraeche/ConversationDetail.tsx |
| GES-29 | Skeleton beim Laden; Fehler „Gespräch konnte nicht geladen werden." / „Netzwerkfehler — bitte erneut versuchen." / „Nicht gefunden." | display (loading/error) | Detail-Fetch | POST /api/admin/conversations/detail `{conversationId}` | gespraeche/ConversationDetail.tsx |
| GES-30 | Kopf: TierBadge, Persona-Badge, „<Datum> · N Nachricht(en) · <status>"; OutcomeChips (md) | display | – | – | gespraeche/ConversationDetail.tsx |
| GES-31 | „KI-Analyse" + „✨ Analysieren" / „Neu analysieren" / „Analysiere…" | button (KI-Lauf) | Einzelanalyse (Haiku, gecacht); Toast „Gespräch analysiert" / „Hinweis"; refresh | POST /api/admin/conversations/analyze `{conversationId, force}` | gespraeche/ConversationDetail.tsx |
| GES-32 | Analyse-Ergebnis: CategoryBadge, Summary, Tag-Badges, „Stand: … · <model> · ~<EUR> · letzter Lauf: n / m Tokens" | display | – | – | gespraeche/ConversationDetail.tsx |
| GES-33 | „Noch nicht analysiert. Ein Klick startet einen günstigen KI-Durchlauf (Haiku) und speichert das Ergebnis — erneutes Öffnen kostet nichts." | display | – | – | gespraeche/ConversationDetail.tsx |
| GES-34 | „✓ Transkript": Turns „Kunde"/„Berater" + Uhrzeit (Berater-Turns als Markdown) / „Kein lesbares Transkript." | display | – | – | gespraeche/ConversationDetail.tsx |
| **Insights-Report (GespraecheReportPanel, unten)** ||||||
| GES-35 | „✨ Aggregierter Insights-Report" + Meta „N Zusammenfassung(en) · zwischengespeichert/frisch generiert · <Zeit> · ~<EUR>" | display | `getCachedInsights` | – | gespraeche/ReportPanel.tsx |
| GES-36 | „Report anzeigen" / „Einklappen" (aria-expanded; nur wenn Report existiert; eingeklappt per Default) | button (collapse) | – | client-only | gespraeche/ReportPanel.tsx |
| GES-37 | „✨ Insights generieren" / „Neu generieren" / „Wird erstellt…" (disabled ohne analysierte) | button (KI-Lauf) | Rollup über gecachte Summaries; öffnet Report | POST /api/admin/conversations/insights `{from, to, force}` | gespraeche/ReportPanel.tsx |
| GES-38 | Hinweis „⚠️ KI-Pass über die bereits zwischengespeicherten Zusammenfassungen (nicht über Transkripte)… [Zuerst Gespräche analysieren.]" | display | – | – | gespraeche/ReportPanel.tsx |
| GES-39 | Fehlertext / Skeleton / Report (Markdown) | display | – | – | gespraeche/ReportPanel.tsx |
| GES-40 | „Belege": `<details>` je Abschnitt (Top-Themen & Fragen / Wo Beratungen stocken oder scheitern / Häufige unerfüllte Bedürfnisse / Vorschläge zur Verfeinerung) mit Badge „Beleg-Gespräche (N)" und Buttons „Gespräch #id öffnen — <Grund>" | disclosure + button (deep link) | Öffnet Gespräch im Detail-Panel (scrollIntoView) | POST …/detail | gespraeche/ReportPanel.tsx |
| GES-41 | Hinweis „Kuratierte Beispiele je Abschnitt. Vollständige Listen: Kategorie-/Qualitäts-Balken oben anklicken." | display | – | – | gespraeche/ReportPanel.tsx |
| GES-42 | „Neu generieren, um verlinkte Beleg-Gespräche zu erhalten." (alter Cache ohne Referenzen) / „Modell: <model>" | display | – | – | gespraeche/ReportPanel.tsx |
| GES-43 | „Kunde öffnen“ (seit 2026-10) im Gesprächskopf, nur bei identifizierten Gesprächen | link | Sprung zur Person `?tab=kunden&customer=<id>`; die Liste bleibt pseudonym (kein Name) | GET conversation detail (`customerId`) | gespraeche/ConversationDetail.tsx, lib/admin-conversations.ts |

### Helper/explanatory text (Gespräche) — 22
1. „Keine Datenbank konfiguriert (DATABASE_URL) — es können keine Gespräche geladen werden." — GespraecheTab.tsx
2. Placeholder „Alle Gespräche durchsuchen — Wörter, Namen, IDs, E-Mail, Tags …" — gespraeche/*
3. „Suche nach „q" über alle Gespräche — der Zeitraum wird ignoriert." —
4. Checkbox-Label „nur ohne Bot-Antwort"
5. „Keine Gespräche gefunden für „q"." / „Keine Gespräche für diesen Zeitraum/Filter."
6. Badge-Titles „Kunde schrieb, aber Mo antwortete nicht" / „Warenkorb-/Checkout-Link geklickt" / „Warenkorb-Button angeboten (add_to_cart)" / „E-Mail erfasst"
7. „nicht analysiert"
8. „Wähle links ein Gespräch, um Transkript und Analyse zu sehen."
9. „Gespräch konnte nicht geladen werden." / „Netzwerkfehler — bitte erneut versuchen." / „Nicht gefunden." —
10. „Stand: … · model · ~€ · letzter Lauf: n / m Tokens"
11. „Noch nicht analysiert. Ein Klick startet einen günstigen KI-Durchlauf (Haiku) und speichert das Ergebnis — erneutes Öffnen kostet nichts." —
12. „Kein lesbares Transkript."
13. „— noch keine Daten" — gespraeche/StatsPanel.tsx, gespraeche/ReportPanel.tsx
14. title „Filter entfernen" / „Liste auf „X" filtern — zeigt ALLE passenden Gespräche" —
15. „N Gespräch(e) · M analysiert"
16. „Klick auf einen Balken filtert die Gesprächsliste darunter auf ALLE passenden (analysierten) Gespräche — jedes mit seiner Kurz-Erklärung. Erneuter Klick hebt den Filter auf." —
17. Dialog „N Gespräch(e) im Zeitraum from – to werden mit dem günstigen Modell analysiert. Geschätzte Kosten: ca. X € (≈ Y € pro Gespräch). Pro Durchlauf wird eine Charge verarbeitet — sind danach noch welche offen, einfach erneut ausführen." —
18. Toast-Texte Sammelanalyse („N Gespräch(e) im Zeitraum", „N analysiert, k fehlgeschlagen · € · noch M offen (erneut ausführen)")
19. „Kuratierte Beispiele je Abschnitt. Vollständige Listen: Kategorie-/Qualitäts-Balken oben anklicken."
20. „N Zusammenfassung(en) · zwischengespeichert/frisch generiert · Zeit · ~€"
21. „⚠️ KI-Pass über die bereits zwischengespeicherten Zusammenfassungen (nicht über Transkripte) — günstig und skalierbar. Ergebnis wird je Zeitraum zwischengespeichert. Enthält Empfehlungen zur Verfeinerung auf Basis aller analysierten Gespräche. [Zuerst Gespräche analysieren.]" —
22. „Neu generieren, um verlinkte Beleg-Gespräche zu erhalten." / „Modell: …" / Fehler „Insights konnten nicht erstellt werden."

### Persistenter Zustand (Gespräche)
- URL: `?tab=gespraeche&grange=7d|30d|90d|custom[&gfrom&gto][&gtier=anonymous|email-only|signed-in][&gerr=1][&gcat=<key>][&gqual=<key>][&gq=<text>][&gpage=N]` (gespraeche/ReportPanel.tsx; page.tsx).
- Ausgewähltes Gespräch (selectedId) und Report auf/zu sind flüchtig. Kein localStorage.
- Serverseitig gecacht: Einzelanalysen (am Datensatz), Insights-Rollup je Zeitraum.

---

## 8. Wissen (`WissenTab.tsx`, `wissen/*`)

### Beschreibung
Bildschirm-Beschreibung: [`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §3.4. Die Beschreibung vom 2026-09-08 steht im Archiv ([archive](./archive/FEATURE_INVENTORY_AUDIT_2026-09.md) §B.1).

### Controls & actions
| ID | Element | Type | What it does | Calls | File |
|---|---|---|---|---|---|
| WIS-01 | „✨ Gespräche scannen (k von N)" / „Scanne …" / „Keine neuen Gespräche zu scannen" | button | Entwirft bis zu 10 neue Q&A-Einträge aus geeigneten, noch nicht gescannten Gesprächen; Toast mit scanned/created/noGap/duplicates/errors; danach reload | POST /api/admin/qa/scan `{limit:10}` → GET /api/admin/qa/list | wissen/* |
| WIS-02 | Reload-Icon (title „Neu laden", KEIN aria-label) | icon button | Lädt Einträge/Zähler neu | GET /api/admin/qa/list | wissen/* |
| WIS-03 | Statusfilter Offen / Beantwortet / Veröffentlicht / Verworfen / Alle (mit Zählern) | filter buttons | Filtert die Liste client-seitig | client-only | wissen/* |
| WIS-04 | Leerzustand „Keine Einträge in dieser Ansicht. Nutze „Gespräche scannen"…" | display | – | – | wissen/* |
| WIS-05 | Status-Badge (Offen/Beantwortet/Veröffentlicht/Verworfen), Badge „Produkt: <Titel>" oder „Allgemein", Meta „#id · Datum · aus Gespräch #n" | display | Kopf je Eintrag | server/GET | wissen/* |
| WIS-06 | Box „Wissenslücke: …" | display | KI-Zusammenfassung der Lücke | – | wissen/* |
| WIS-07 | Input „Frage (öffentlich sichtbar — anpassbar)" | input | Frage editieren | client → gespeichert via WIS-11 | wissen/* |
| WIS-08 | Input „Produkt-Handle (leer = allgemeine Frage)" (Placeholder „z. B. atx-multipresse-mpx-780") | input (free text) | Produktbezug setzen/entfernen | client → WIS-11 | wissen/* |
| WIS-09 | Textarea „Antwort" | textarea | Antwort verfassen; Markdown-Links `[Text](URL)` | client → WIS-11 | wissen/* |
| WIS-10 | „🔗 Produkt verlinken" → `CatalogProductPicker` (inkl. Variante, `?variant=`) + „Abbrechen" | button + picker | Fügt `[Titel](URL)` an Cursorposition der Antwort ein | POST /api/admin/catalog/search (Picker) | wissen/* |
| WIS-11 | „💾 Speichern" / „Speichere …" | button | Speichert Frage/Antwort/Produkt/EN (Status → answered) | POST /api/admin/qa/answer `{id, question, answer, productId, questionEn, answerEn}` | wissen/* |
| WIS-12 | „📤 Veröffentlichen" / „Änderung erneut veröffentlichen" / „Veröffentliche …" (disabled ohne Antwort) | button | Speichert, dann publiziert (Metafeld + Katalog-Refresh bzw. allgemeine Wissensbasis); Toast nennt EN-Übersetzung ja/nein | POST /api/admin/qa/answer → POST /api/admin/qa/publish `{id}` | wissen/* |
| WIS-13 | „↶ Zurückziehen" (nur published) | button | Entfernt aus Metafeld/Wissen; Status → answered | POST /api/admin/qa/unpublish `{id}` | wissen/* |
| WIS-14 | „🗑 Verwerfen" (nicht published) | button | Status → dismissed (kein Confirm) | POST /api/admin/qa/dismiss `{id}` | wissen/* |
| WIS-15 | „Wiederherstellen" (nur dismissed) | button | Zurück nach open/answered | POST /api/admin/qa/restore `{id}` | wissen/* |
| WIS-16 | Vorschau „Vorschau (so erscheint die Antwort im Q&A)" | display (HTML aus qa-links.mjs, nur bei Link im Text) | Gerenderte Links | client-only | wissen/* |
| WIS-17 | „Englische Version anzeigen/anpassen …" → Inputs Question/Answer (English) + Vorschau | disclosure + input + textarea | Optionaler EN-Override (leer = Auto-Übersetzung beim Publish) | client → WIS-11 | wissen/* |
| WIS-18 | Deaktivierte Felder bei Status dismissed | state | Nur Wiederherstellen möglich | – | wissen/* |

### Helper/explanatory text (Wissen) — 9
1. „Quelle: Gespräche mit „Offener Bedarf"/„Abgesprungen" oder Übergabe ans Kontaktformular. Veröffentlichen schreibt…" — wissen/*
2. „Keine Einträge in dieser Ansicht. Nutze „Gespräche scannen", um neue Wissenslücken…"
3. Label „Frage (öffentlich sichtbar — anpassbar)" —
4. Label „Produkt-Handle (leer = allgemeine Frage)" + Placeholder
5. Placeholder Antwort „Die Antwort des motion sports Teams — erscheint öffentlich im Q&A und in Mos Wissen." —
6. „Links als `[Angezeigter Text](https://…)` schreiben — sie erscheinen im Q&A als klickbarer Text statt als URL." —
7. „Englische Version (optional — leer lassen für automatische Übersetzung beim Veröffentlichen)" / Button-Text —
8. Toast-Texte Publish („In Shopify (custom.qa) gespeichert und Mos Katalog sofort aktualisiert" / „— Mos Katalog folgt mit dem nächsten Sync" / EN-Hinweis)
9. Toast-Texte Unpublish/Restore

### Persistenter Zustand (Wissen)
- URL: `?tab=wissen`. Filter/Edits flüchtig (Edits werden bei Reload durch Server-Objekt überschrieben; useEffect-Sync).

---

## 9. Analyse (`AnalyseTab.tsx`, `analytics/*`)

### Beschreibung
Bildschirm-Beschreibung: [`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §3.8. Die Beschreibung vom 2026-09-08 steht im Archiv ([archive](./archive/FEATURE_INVENTORY_AUDIT_2026-09.md) §B.1).

### Controls & actions
| ID | Element | Type | What it does | Calls | File |
|---|---|---|---|---|---|
| ANA-01 | Sidebar „+ Neue Komplettanalyse" (aktiv hervorgehoben) | button | Zurück zum Generator | client-only | analytics/AnalyseWorkspace.tsx |
| ANA-02 | Sidebar-Liste „Gespeichert (N)": Titel, Status-Pill (läuft/Fehler/fertig), Datum, Kosten | list buttons | Bericht auswählen → Detail laden | GET /api/admin/analytics/[id] | analytics/AnalyseWorkspace.tsx |
| ANA-03 | Zeitraum-Presets 7/30/90 Tage + „Benutzerdefiniert" (Von/Bis Date-Inputs) | buttons + date inputs | Analysezeitraum | client-only (→ Estimate) | analytics/GenerateReportPanel.tsx |
| ANA-04 | Checkbox „Einzelne Kundenprofile (identitätsbezogen)" | checkbox | includePerCustomer (Opus-Profile, teuer) | client-only (→ Estimate) | analytics/GenerateReportPanel.tsx |
| ANA-05 | Checkbox „Anhang: jedes Gespräch auflisten" (default an) | checkbox | includeAppendix | client-only | analytics/GenerateReportPanel.tsx |
| ANA-06 | Live-Schätzung: Label, „N Gespräch(e) · N noch zu analysieren · N Persona-Gruppe(n) [· N Kundenprofil(e)]", „Geschätzte KI-Kosten: ca. X" | display (debounced fetch) | Zero-Token-Kostenschätzung | POST /api/admin/analytics/estimate `{range, from, to, includePerCustomer}` | analytics/GenerateReportPanel.tsx |
| ANA-07 | „✨ Komplettanalyse generieren" / „Wird gestartet…" | button | Erstellt Bericht (status running), wählt ihn aus | POST /api/admin/analytics/create `{…, includeAppendix}` | analytics/GenerateReportPanel.tsx |
| ANA-08 | Fortschritts-Karte: Phasenliste mit ✓/Spinner/○ und Zählern (analysiert/noch/ Fehler; Personas k/N; Profile k/N), „KI-Kosten bisher", „Pause"/„Fortsetzen", Fehlerbox „Erstellung gestoppt" + „Erneut versuchen" | display + buttons | Steppt den Bericht bis done (Schleife), pausierbar | POST /api/admin/analytics/step `{id}` (Loop) | analytics/ReportProgressDriver.tsx |
| ANA-09 | Detail-Header: Titel, Status-Badge, Meta (Zeitraum, erstellt, fertig, KI-Kosten, „inkl. Kundenprofile") | display | – | GET detail | analytics/AnalyseWorkspace.tsx |
| ANA-10 | „⬇ PDF herunterladen" (nur complete) | link (GET) | PDF-Download | GET /api/admin/analytics/[id]/pdf | analytics/ReportActions.tsx |
| ANA-11 | „🗑 Löschen" → Dialog „Analyse löschen?" (Abbrechen / Löschen) | button + dialog | Bericht dauerhaft entfernen; zurück zum Generator | POST /api/admin/analytics/delete `{id}` | analytics/ReportActions.tsx |
| ANA-12 | Fehlerzustand „Erstellung fehlgeschlagen" + Fehlertext + „Bitte den Bericht löschen und neu erstellen." | display | – | – | analytics/AnalyseWorkspace.tsx |
| ANA-13 | Ladezustände „Bericht wird geladen…", Detail-Fehler „Erneut laden" | display/button | – | GET detail | analytics/AnalyseWorkspace.tsx |
| ANA-14 | ReportView: Hinweise (notes), Kennzahlen (6 Stats + Tier-Zeile + KI-Ausgaben), Verteilungen (Kategorien/Qualität), Aggregierte Insights (Markdown), Personas (Karten mit Lieblingsprodukten + Top-Fragen), Kundenwissen (aggregiert + einzelne Profile), Anhang (Gesprächsliste) | display | Vollständiger Bericht | – | analytics/ReportView.tsx |
| ANA-15 | **Nachtrag 2026-10:** Kapitel „Kundenbasis“ (InfoTip „Stand heute; neue Anmeldungen im gewählten Zeitraum.“: Kunden gesamt, Shopify-Kunden, Mit Mo gesprochen, Mit Einwilligung, Neu angemeldet (InfoTip „Im Zeitraum, über alle Wege (Shop und Mo).“), BarList Lebenszyklus) und „Kampagnen“ (InfoTip „Im Zeitraum gesendete Kampagnen-Mails und was daraus wurde.“: Tabelle Kampagne / Gesendet / Geklickt (Anteil) / Chat gestartet / Abgemeldet) nach den Kennzahlen — am Bildschirm und im PDF; ältere Berichte ohne die Kapitel bleiben unverändert | display | Deterministisch, reine DB, keine zusätzlichen Tokens; im Schritt „assemble“ gespeichert | `getReportCustomerBase`, `getReportCampaigns` (`analytics-report-store.ts`); PDF `buildAnalyticsReportPdf` (getestet) | analytics/ReportView.tsx, lib/analytics-report-pdf.mjs, lib/analytics-report-generate.ts |

### Helper/explanatory text (Analyse) — 11
1. CardDescription „Verdichtet ALLE KI-Analysen für ein Zeitintervall an einem Ort: … Bewusst gründlich (und damit teurer); …" — analytics/GenerateReportPanel.tsx
2. „Regeneriert pro aktivem Kunden das „aktuelle Verständnis" (Opus) — am teuersten und enthält Namen. Sonst bleibt der Bericht pseudonym." —
3. „Hängt jede Gesprächs-Zusammenfassung (Kategorie, Qualität) an — „alles an einem Ort", aber ein längeres PDF." —
4. „(bereits analysierte Gespräche werden kostenlos wiederverwendet)"
5. „Erscheint sofort links im Seitenpanel und läuft dort weiter."
6. „Du kannst diese Seite geöffnet lassen — der Bericht wird Schritt für Schritt erstellt … Pausieren ist jederzeit möglich…" — analytics/ReportProgressDriver.tsx
7. Sidebar leer: „Noch keine Analysen. Erstelle oben deine erste Komplettanalyse." — analytics/AnalyseWorkspace.tsx
8. Dialog „Dieser gespeicherte Bericht wird dauerhaft entfernt. Die zugrunde liegenden Gespräche und ihre einzelnen Analysen bleiben erhalten." — analytics/ReportActions.tsx
9. ReportView Section-Subtitles („Überblick über den Zeitraum", „Verdichtet aus den Gesprächs-Zusammenfassungen", „Gruppen, Lieblingsprodukte & Top-Fragen im Zeitraum", „Aggregierte Synthese & — falls gewählt — einzelne Profile", „Jede analysierte Beratung mit Kategorie & Qualität") — analytics/ReportView.tsx
10. Stat-Tooltip „Fehler-Proxy: Nutzer-Nachricht ohne jede Bot-Antwort." — analytics/ReportView.tsx
11. „— identitätsbezogen, nur intern" — analytics/ReportView.tsx

### Persistenter Zustand (Analyse)
- URL: `?tab=analyse` (Auswahl NICHT in der URL). Berichte + Fortschritt serverseitig persistiert (resumierbar).

---

## 10. Verbesserung (`VerbesserungTab.tsx`, `verbesserung/*`)

### Beschreibung
Bildschirm-Beschreibung: [`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §3.9. Die Beschreibung vom 2026-09-08 steht im Archiv ([archive](./archive/FEATURE_INVENTORY_AUDIT_2026-09.md) §B.1).

### Controls & actions
| ID | Element | Type | What it does | Calls | File |
|---|---|---|---|---|---|
| VER-01 | Sidebar „+ Neuer Verbesserungslauf" | button | Zum Neuer-Lauf-Panel | client-only | verbesserung/* |
| VER-02 | Sidebar-Liste „Läufe (N)": Titel, Badge läuft/Fehler/fertig, Datum, „N Vorschläge" | list buttons | Lauf auswählen → Detail | GET /api/admin/improve/[id] | verbesserung/* |
| VER-03 | Select „Grundlage (fertige Komplettanalyse)" | select | Bericht als Basis | client-only | verbesserung/* |
| VER-04 | „Lauf starten" | button | Erstellt Lauf (running) und wählt ihn | POST /api/admin/improve/run `{reportId}` | verbesserung/* |
| VER-05 | Warnbox „Noch keine fertige Komplettanalyse vorhanden — bitte zuerst im Tab „Analyse"…" | display | – | – | verbesserung/* |
| VER-06 | RunDriver: Spinner + Phasenlabel, „(Verbindung unterbrochen — es wird automatisch weiter versucht)", Fehler + „↻ Fortsetzen" | display + button | Steppt den Lauf; Retry bei Netzfehlern (60×5 s), `busy` → Polling | POST /api/admin/improve/step `{id}` (Loop) | verbesserung/* |
| VER-07 | Lauf-Header: Titel, Status-Badge, Meta (Zeitraum, erstellt, KI-Kosten, Prompt-Version) | display | – | – | verbesserung/* |
| VER-08 | „🗑 Löschen" (window.confirm „Diesen Verbesserungslauf samt Vorschlägen löschen?") | button + native confirm | Lauf löschen → Liste refresh, zurück zum Panel | POST /api/admin/improve/delete `{id}` | verbesserung/* |
| VER-09 | Wirkungs-Check-Karte: Delta-Tabelle (Kennzahl · vorher · jetzt · Δ pp, Basis-Zeile) + Markdown effectCheck | display | Ergebnis früherer Maßnahmen | – | verbesserung/* |
| VER-10 | Vorschlagsgruppen „Vorschläge für Mo selbst (N)" / „Vorschläge für den Online-Shop (N)" | display | Lanes | – | verbesserung/* |
| VER-11 | SuggestionCard: Prioritätszeile (Ampelpunkt + „Große/Mittlere/Kleine Wirkung · … Aufwand"), Status-Badge, Titel | display | – | – | verbesserung/SuggestionCard.tsx |
| VER-12 | Textarea „So würde Mo künftig beraten" (editierbar vor Übernahme, max MAX_DIRECTIVE_CHARS, Zeichenzähler) ODER „Was zu tun ist" (Markdown) | textarea/display | Direktivtext bzw. Vorschlag | client-only | verbesserung/SuggestionCard.tsx |
| VER-13 | „Warum? Details & Belege" (Kategorie, Begründung, ausführlicher Vorschlag, Evidenz-Liste, „Daran messen wir den Erfolg") | disclosure | Details ein-/ausblenden | client-only | verbesserung/SuggestionCard.tsx |
| VER-14 | „🪄 Übernehmen — gilt ab sofort" (Direktiv-Karten) | button | Legt Anweisung live an + Karte → Erledigt | POST /api/admin/improve/adopt `{suggestionId, content}` | verbesserung/SuggestionCard.tsx |
| VER-15 | „✓ Erledigt — ist umgesetzt" (Nicht-Direktiv-Karten) | button | Status implemented | POST /api/admin/improve/suggestion `{suggestionId, status}` | verbesserung/SuggestionCard.tsx |
| VER-16 | „✕ Verwerfen" → Inline „Warum nicht? (optional)" Input + „Endgültig verwerfen" / „Abbrechen" | button + input | Status dismissed mit Notiz | POST /api/admin/improve/suggestion `{…, status:"dismissed", note}` | verbesserung/SuggestionCard.tsx |
| VER-17 | „↺ Wieder öffnen" (dismissed) | button | Status open | POST /api/admin/improve/suggestion | verbesserung/SuggestionCard.tsx |
| VER-18 | Notiz-Anzeige „Notiz: …" | display | statusNote | – | verbesserung/SuggestionCard.tsx |
| VER-19 | ToolSection „Anweisungen an Mo" (Summary „N aktiv", einklappbar, default zu) | disclosure | – | client-only | verbesserung/* |
| VER-20 | DirectivesCard: Liste (Badge aktiv/inaktiv, „aus Vorschlag", „zuletzt geändert …", Text) | display | Live-Anweisungen | – | verbesserung/DirectivesCard.tsx |
| VER-21 | Icon „Verlauf anzeigen" (History, kein aria-label) → Versionsliste (Angelegt/Text geändert/Aktiviert/Deaktiviert + Zeit + Text) | icon button + list | Lazy-Load der Versionen | GET /api/admin/directives/versions?id= | verbesserung/DirectivesCard.tsx |
| VER-22 | Icon „Bearbeiten" (Pencil) → Textarea + „✓ Speichern" / „Abbrechen" | icon button + textarea | Text ändern (versioniert) | POST /api/admin/directives/save `{id, content}` | verbesserung/DirectivesCard.tsx |
| VER-23 | Icon „Deaktivieren/Aktivieren" (Power) | icon button | Toggle aktiv | POST /api/admin/directives/toggle `{id, active}` | verbesserung/DirectivesCard.tsx |
| VER-24 | „Neue Anweisung (k/N aktiv)" Textarea (maxLength) + Zähler + „+ Anweisung aktivieren" | textarea + button | Neue Direktive anlegen (aktiv) | POST /api/admin/directives/save `{content}` | verbesserung/DirectivesCard.tsx |
| VER-25 | ToolSection „Mos Selbstbild (System-Prompt)" (Summary „Version <hash>") → SelfSnapshotCard: Badge „Version <hash>", Button „System-Prompt anzeigen/ausblenden", `<pre>` Prompt | disclosure + display | Lesbarer Live-Prompt | server-render (`buildMoSelfSnapshot`) | verbesserung/*, verbesserung/SelfSnapshotCard.tsx |
| VER-26 | Leer-/Ladezustände: „Noch keine Läufe…", „Lauf wird geladen…", Detail-Fehler + „Erneut laden" | display | – | – | verbesserung/* |

### Helper/explanatory text (Verbesserung) — 14
1. NewRunPanel 3-Schritte-Liste („1 · Mo schlägt vor: …", „2 · Du entscheidest: …", „3 · Der nächste Lauf misst: …") — verbesserung/*
2. „2–3 Modell-Aufrufe (Sonnet) · typischerweise deutlich unter 0,50 €. Es wird nichts automatisch geändert …"
3. RunDriver „Zwei bis drei Modell-Aufrufe nacheinander — insgesamt kann das einige Minuten dauern. Kurze Verbindungsabbrüche…" —
4. Failed „Lauf fehlgeschlagen … Bitte den Lauf löschen und neu starten."
5. Wirkungs-Check „Kennzahlen sind Quoten je Gespräch im jeweiligen Analysezeitraum. Bewegungen zeigen Korrelation, keine bewiesene Ursache."
6. „Kein Wirkungs-Check in diesem Lauf — es gab noch keine angenommenen oder umgesetzten Maßnahmen aus früheren Läufen." —
7. „Keine neuen Vorschläge — alles bereits Vorgeschlagene ist noch offen oder umgesetzt…" —
8. „Nichts passiert automatisch: Ein Vorschlag wird erst wirksam, wenn du ihn übernimmst oder selbst umsetzt…"
9. DeltaTable „Basis: N Gespräche (voriger Lauf) vs. M Gespräche (dieser Lauf)."
10. SuggestionCard „Direkt anpassbar — genau dieser Text gilt nach dem Übernehmen · k/N Zeichen" — verbesserung/SuggestionCard.tsx
11. SuggestionCard Toast „Übernommen — Mo berät ab sofort so … kann dort jederzeit angepasst oder abgeschaltet werden." —
12. DirectivesCard Intro „Kurze Verhaltensregeln, die live in Mos System-Prompt eingefügt werden … Max. N aktive Anweisungen à M Zeichen — Mos Kern-Prompt bleibt unverändert im Code (Git)." — verbesserung/DirectivesCard.tsx
13. DirectivesCard leer „Noch keine Anweisungen. Lege unten die erste an — oder übernimm eine aus einem Verbesserungsvorschlag." + Toast „Sie fließt innerhalb weniger Minuten in Mos System-Prompt ein." —
14. SelfSnapshotCard „Der aktuell wirksame System-Prompt, kanonisch gerendert — genau der Stand, den der Verbesserungslauf analysiert. Enthält N veröffentlichte Q&A-Einträge und M aktive Anweisung(en). Der Kern-Prompt wird über Code-Änderungen (Git) angepasst; hier ist er nur lesbar." — verbesserung/SelfSnapshotCard.tsx

### Persistenter Zustand (Verbesserung)
- URL: `?tab=verbesserung` (Auswahl nicht in URL). Läufe/Vorschläge/Direktiven/Versionen serverseitig; Step-Claim (Migration 0045) schützt vor Doppelschritten.

---

## 11. Einstellungen (`EinstellungenTab.tsx`, `einstellungen/*`)

### Beschreibung
Bildschirm-Beschreibung: [`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §3.10. Die Beschreibung vom 2026-09-08 steht im Archiv ([archive](./archive/FEATURE_INVENTORY_AUDIT_2026-09.md) §B.1).

### Controls & actions
| ID | Element | Type | What it does | Calls | File |
|---|---|---|---|---|---|
| EIN-01 | Design-Karte: Name, Badge „Standard", Beschreibung, „Hinzugefügt am <Datum>", Badges „Aktiv: Zusammenfassung/Anmelde-Bestätigung (DOI)/Marketing (Kunden)/Kampagne (Shopify-Abonnenten)" bzw. „Nicht in Verwendung" | display | Registry-Metadaten + effektive Zuordnung | server-render | einstellungen/EmailSettingsWorkspace.tsx |
| EIN-02 | Vorschau-Buttons je Typ pro Design („👁 Zusammenfassung", „Anmelde-Bestätigung (DOI)", „Marketing (Kunden)", „Kampagne (Shopify-Abonnenten)") → Dialog mit `EmailPreviewFrame` (Desktop/Mobil) | button + dialog | Beispiel-E-Mail dieses Typs im Design | POST /api/admin/email-designs/preview `{designKey, kind}` | einstellungen/EmailSettingsWorkspace.tsx, EmailPreviewButton.tsx |
| EIN-03 | Select „Design für <Typ>" je E-Mail-Typ (Optionen = Designs, die den Typ unterstützen; „Klassisch (Standard)" = null) | select | Zuordnung sofort speichern; Toast „Design zugeordnet — <Typ> verwendet ab sofort „<Name>"" | POST /api/admin/email-designs/assign `{kind, designKey\|null}` | einstellungen/EmailSettingsWorkspace.tsx |
| EIN-04 | „👁 Vorschau" je Typ (aktuell aktives Design) | button + dialog | Vorschau des effektiven Designs | POST /api/admin/email-designs/preview `{designKey: effective, kind}` | einstellungen/EmailSettingsWorkspace.tsx |
| EIN-05 | Warnbox „Keine Datenbank konfiguriert (DATABASE_URL) — die Auswahl kann nicht gespeichert werden…" (+ Selects disabled) | display/state | – | – | einstellungen/EmailSettingsWorkspace.tsx |
| EIN-06 | Versand-Konfiguration: „E-Mail-Versand" Badge Konfiguriert/Nicht konfiguriert, „Absender-Adresse", „Antwort-/Eingangsadresse", „Logo-Override (EMAIL_LOGO_URL)" | display (dl) | Env-Werte read-only | server-render | einstellungen/EmailSettingsWorkspace.tsx |
| **Shopify-Abgleich (ab 2026-10-01)** ||||||
| EIN-07 | Karte „Shopify-Abgleich“ (InfoTip): Callout „Shopify ist nicht konfiguriert (SHOPIFY_*).“; Schalter-Badges „Kundenstamm abgleichen“ (`SHOPIFY_CUSTOMER_SYNC_ENABLED`), „Einwilligung an Shopify zurückschreiben“ (`SHOPIFY_CONSENT_WRITEBACK`), „Löschungen an Shopify weitergeben“ (`SHOPIFY_ERASURE_SYNC`), **Nachtrag 2026-10:** „Merkmale als Shopify-Tags“ (`SHOPIFY_WRITEBACK_ENABLED`, EIN-12) je „an/aus“ + InfoTip, „KI-Profile: alle / mit Einwilligung“ (`CUSTOMER_AI_PROFILE_SCOPE`); Kennzahlen „Kund:innen aus Shopify“, „Bestellungen (Kopie)“, „Erster Import“, „Nächtlicher Abgleich“, „Letzter Webhook“ (+ n in 24 h), „Warteschlange an Shopify“ (offen · erledigt 24 h) | card + display | Zustand der Verbindung Mo ⇄ Shopify | server-render (`getSyncHealth`, `getOutboxStats`, `shopifySyncFlags`); JSON-Zwilling GET /api/admin/shopify/status | einstellungen/ShopifySyncCard.tsx, EinstellungenTab.tsx |
| EIN-08 | „Kundenstamm übernehmen“ / „Vollständig neu importieren“ → Bestätigung (was übernommen wird — keine Adressen, keine Telefonnummern; keine E-Mail) → Fortschritt „Import Kunden: Wird übernommen · n Kunden · n Bestellungen“ mit Pause / Fortsetzen und „Import abbrechen“; deaktiviert ohne Shopify oder ohne `SHOPIFY_CUSTOMER_SYNC_ENABLED` („Erst SHOPIFY_CUSTOMER_SYNC_ENABLED einschalten.“) | button + confirm + step loop | Erster Vollimport (Bulk-Operationen, fortsetzbar; der 5-Minuten-Cron macht weiter, wenn die Seite zu ist); danach erste Kennzahlen | POST /api/admin/shopify/import `{action: start\|step\|cancel}` (`useStepLoop`) | einstellungen/ShopifySyncCard.tsx, lib/shopify-sync.ts |
| EIN-09 | Callout „n Übertragungen an Shopify aufgegeben“: Art, Zeit, letzter Fehler, „Erneut versuchen“ je Eintrag | callout + buttons | Tote Outbox-Einträge wieder einreihen | POST /api/admin/shopify/outbox `{id}` | einstellungen/ShopifySyncCard.tsx, lib/shopify-outbox.ts |
| EIN-10 | Block „Erstabgleich der Einwilligung“ (InfoTip; nur sichtbar, wenn etwas offen ist): „An Shopify zu übertragen: n Anmeldungen · n Abmeldungen“, „n Personen werden in Shopify angelegt“ (je „— wartet auf SHOPIFY_CONSENT_WRITEBACK“), „n Mo-Abonnent:innen ohne Shopify-Konto“ + „In Shopify anlegen…“ → Bestätigung → Toast „Vorgemerkt“; deaktiviert bis der Import fertig ist („Erst den Kundenstamm übernehmen.“) | display + button + confirm | Plan D-3: Mo-Abonnent:innen (DOI, ohne Shopify-Kund:in, nicht gesperrt) werden über die Outbox als Shopify-Kund:innen mit der Einwilligung angelegt; idempotent | POST /api/admin/shopify/align (409 `import_pending`); Zahlen `getConsentAlignmentReport` (auch in GET /api/admin/shopify/status `alignment`) | einstellungen/ShopifySyncCard.tsx, lib/consent-alignment.ts |
| EIN-11 | Disclosure „Letzte Läufe“: Start, Art (Import Kunden / Import Bestellungen / Nächtlicher Abgleich), Status (Shopify bereitet vor / Wird übernommen / Fertig / Fehlgeschlagen / Abgebrochen), n Kunden · n Bestellungen, Fehler | disclosure | Verlauf der Sync-Läufe | server-render (`listSyncRuns(8)`) | einstellungen/ShopifySyncCard.tsx |
| EIN-12 | **Nachtrag 2026-10:** „Merkmale als Shopify-Tags“ (Schalter-Badge + InfoTip „Lebenszyklus, Wertstufe, Mo-Kontakt und hohes Abwanderungsrisiko werden nachts als Tags (mo-…) an die Shopify-Kunden geschrieben — nutzbar in Shopify-Segmenten, Flow und Shopify Email. Eigene Tags des Shops bleiben unberührt.“); tote Einträge erscheinen in EIN-09 als „Merkmale an Shopify“. Ein Art.-21-Widerspruch gegen Profilbildung (KUN-129) entfernt alle `mo-`-Tags: beim Eintragen verwirft `removeInsightTags` offene Tag-Einträge und reiht das Entfernen aller gespiegelten `mo-`-Tags ein (auch bei ausgeschaltetem Schalter — der Eintrag wartet); solange der Widerspruch gilt, setzt der nächtliche Lauf keine Tags (`desiredMoTags` mit `profileObjection`); nach „Aufheben“ setzt der nächste Lauf sie wieder | flag + behaviour | Plan D-11: Mos Merkmale in Shopify nutzbar; Standard aus | Nächtlich `queueInsightWritebacks` (`shopify-insights.ts` über `shopify-insight-tags.mjs`, getestet) in `/api/cron/shopify-reconcile` → Outbox `writeback` → `tagsAdd` / `tagsRemove` (nur `mo-`-Tags), danach `customers.shopify_tags` gespiegelt | einstellungen/ShopifySyncCard.tsx, lib/shopify-insights.ts, lib/shopify-outbox.ts |

### Helper/explanatory text (Einstellungen) — 8
1. CardDescription Design-Bibliothek „Alle verfügbaren E-Mail-Designs. Jedes Design definiert das allgemeine Erscheinungsbild … Die Inhalte (KI-Texte, Produkte, Rechtstexte) bleiben immer unverändert." — einstellungen/EmailSettingsWorkspace.tsx
2. Infobox „Neue Designs werden mit Claude Code entwickelt (Anleitung: docs/EMAIL_DESIGNS.md) und erscheinen hier nach dem Deployment automatisch. Bestehende Designs bleiben dauerhaft erhalten … ein Redesign ist immer ein neues Design, kein Überschreiben."
3. CardDescription Zuordnung „Wähle für jeden E-Mail-Typ, welches Design er aktuell verwendet. Die KI erstellt und versendet die E-Mails wie gewohnt — im gewählten Design. Ein Wechsel wirkt sofort auf neue Sendungen und lässt sich jederzeit zurücknehmen." —
4. Typ-Hinweise `EMAIL_THEME_KIND_HINTS` (z. B. „Transaktionale Beratungs-Zusammenfassung mit Warenkorb-Link.", „Double-Opt-in-Bestätigung — der rechtlich geprüfte Text bleibt unverändert.", „Persönliche KI-E-Mails an Chat-Kunden (Rabatt, Warenkorb, Set-Angebot).", „Persönliche KI-E-Mails an Shopify-Marketing-Abonnent:innen (de/en).") —  (lib/email-theme.mjs)
5. Vorschau-Dialog-Beschreibungen („Beispiel-E-Mail dieses Typs im gewählten Design — Inhalte sind Beispieldaten, Links inaktiv.", „So sieht dieser E-Mail-Typ mit dem aktuell gewählten Design aus (Beispieldaten).") —
6. CardDescription Versand „Diese Werte kommen aus den Umgebungsvariablen des Deployments (Resend) und werden hier nur angezeigt."
7. „Hinweis: Der rechtlich geprüfte Text der Anmelde-Bestätigung (DOI) und der Abmelde-Hinweis in Marketing-E-Mails bleiben von Designs unberührt."
8. „Hinzugefügt am <Datum>"

### Persistenter Zustand (Einstellungen)
- URL: `?tab=einstellungen`. Zuordnungen in `email_design_selections` (DB). Keine Client-Persistenz.
- **2026-10:** Sync-Läufe `shopify_sync_runs`, Webhook-Dedupe `shopify_webhook_events`, Schreib-Warteschlange `shopify_outbox` (Migration 0065); die Schalter sind Env-Variablen (nur Anzeige).

---

## 12. Gemeinsame Komponenten & Primitives

Die aktuelle Liste der Primitives steht in [`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §2.5 (exportiert über
`ui/index.ts`), die geteilten E-Mail-Widgets in §2.3. Verbleib der Einträge vom 2026-09-08 (die Tabelle mit „Verwendet
von“ steht im Archiv, §B.2):

| Datei (2026-09-08) | Heute |
|---|---|
| `ui/cn.ts`, `ui/button.tsx`, `ui/input.tsx`, `ui/textarea.tsx`, `ui/label.tsx`, `ui/select.tsx`, `ui/checkbox.tsx`, `ui/badge.tsx`, `ui/card.tsx`, `ui/skeleton.tsx`, `ui/table.tsx`, `ui/tabs.tsx`, `ui/popover.tsx`, `ui/menu.tsx`, `ui/dialog.tsx` + `ui/portal.ts`, `ui/toast.tsx`, `ui/stat.tsx`, `ui/markdown.tsx`, `ui/product-picker.tsx`, `ui/toggle-chips.tsx` (seit 2026-10) | unverändert in `ui/`, exportiert über `ui/index.ts` (dazu die Primitives des Redesigns: `DataTable`, `SplitPane`, `Field`, `SegmentedControl`, `InfoTip`, `Callout`, `EmptyState`, `Sheet`, …) |
| `EmailPreviewFrame.tsx`, `EmailPreviewButton.tsx`, `EmailTextModeToggle.tsx`, `HeroImagePanel.tsx` | unverändert (geteilte E-Mail-Widgets; dazu `useEmailHero.ts`) |
| `ThemeToggle.tsx`, `theme-config.ts`, `theme.css` | unverändert (Cookie `ms_admin_theme`, Init-Script) |
| `customer-filter.ts` (Filter/Sortierung der Kundenliste im Browser) | **❌ abgelöst 2026-10-01** → `src/lib/admin-customer-filter.mjs` (`parseCustomerFilter`, getestet); die Liste filtert serverseitig (`listCustomers`) |
| `KpiCharts.tsx` (Recharts-Inseln) | → `kpi/charts.tsx` (`next/dynamic`) → `kpi/charts-recharts.tsx` + `kpi/chart-geometry.ts` |

## 13. Tab-übergreifende Flüsse (Deep Links)
- Übersicht → Kunden: `/admin?tab=kunden&filter=no_purchase`, `…&filter=marketing`, `/admin?tab=kunden`; Übersicht → KPIs `/admin?tab=kpi`. **❌ abgelöst 2026-10-01** mit der Übersicht (Verbleib der alten Links unten).
- Legacy: `?tab=customers` → kunden; `?status=` → filter-Preset. **2026-10:** Aliase `overview` → Eingang, `customers` / `marketing` → Kunden, `kampagnen` → Kampagnen (`parseAdminTab`); `?status=` ist der Eingang-Status.
- KPI-Zeitraum: `?tab=kpi&kpiRange=7d|30d|90d|custom&kpiFrom&kpiTo` (router.push, Server-Re-Render).
- Gespräche-Filter: `?tab=gespraeche&grange&gfrom&gto&gtier&gerr&gcat&gqual&gq&gpage` (router.push).
- Gespräche Insights-Report „Gespräch #n öffnen" → wählt Detail in-place (kein URL-Wechsel).
- Wissen-Einträge nennen „aus Gespräch #n" (Text, KEIN Link) — Kandidat für Deep Link.
- Kampagne → Kunden: kein Link (Kampagnen-Kontakte sind Shopify-Kontakte, keine Kunden-Entities). **2026-10 überholt:** Empfänger sind Kund:innen (`campaign_contacts.customer_id`); Link über den Block „Kundenprofil“ (KAM-93).
- Kampagne: `?tab=kampagne&contact=<id>&view=&filter=` (Desk-Position; KAM-89). **2026-10:** `?tab=kampagne` = Übersicht, `&edit=<id|new>` = Editor, `&campaign=<slug|id>` = Prüftisch der Kampagne (ein Link nur mit `?contact=` öffnet die Kampagne des Empfängers); Alias `?tab=kampagnen`.
- **2026-10:** Eingang `/admin[?status=zurueckgestellt|erledigt][&item=<id>]`; Eingang → Kunden `?tab=kunden&customer=<id>`; Eingang → Prüftisch `?tab=kampagne&campaign=einzelansprache&contact=<id>` (nach „Entwurf übernehmen“) bzw. `&campaign=<slug>` (Entwürfe je Kampagne); Kunden → Prüftisch der Einzelansprache; Kunden-Liste `?tab=kunden&kview=…&k*=…`; `?tab=overview` → Eingang. Die Übersicht-Links `?tab=kunden&filter=no_purchase|marketing` filtern nicht mehr. **Nachtrag 2026-10:** sie landen auf der Ansicht „Mit Einwilligung“ (`no_purchase` zusätzlich Lebenszyklus „Ohne Bestellung“); Kunden → „Ähnliche Kunden“ → „Als Zielgruppe verwenden“ öffnet `?tab=kampagne&edit=new&audience=<json>`; eine Seite hinter dem Ende zeigt Seite 1.
- Tastenkürzel (ADMIN_DASHBOARD §2.1): Shell `1`–`9`, `0` (1 Eingang · 2 Kampagnen · 3 Kunden · 4 Wissen · 5 KPIs · 6 Gespräche · 7 Feedback · 8 Analyse · 9 Verbesserung · 0 Einstellungen), `/` (Kunden-Suche — auf dem Kampagne-Desk die Kontaktsuche); Kampagne-Desk `N`/`P` (`J`/`K`) · `S` · `A` (Einplanen) · `X` · `E`/`Esc` · `R` · `V` · `C` · `F` · `/` · `?`; Eingang `J`/`K` · `Enter` · `E` · `Z` · `D` · `Esc` (EIG-11; `J`/`K` und `Esc` in jeder Ansicht); Wissen `j` `k` `Esc`.

## 14. Dokumentiert, aber nicht im Code gefunden (docs/ADMIN_DASHBOARD.md)

Befund vom 2026-09-08, erledigt (ADMIN_DASHBOARD.md wurde nach dem Redesign neu geschrieben) — Text im Archiv ([archive](./archive/FEATURE_INVENTORY_AUDIT_2026-09.md) §B.4).

## 15. Zeilenzahlen (src/app/admin)

Momentaufnahme vom 2026-09-08 — im Archiv ([archive](./archive/FEATURE_INVENTORY_AUDIT_2026-09.md) §B.4).

---

# 2. HTTP API routes

Every `route.ts` under `src/app/api/**` — **148 files**: 103 under `/api/admin`, 10 crons, 35 others. One row per
route: what it is for, its guard, rate-limit bucket and `maxDuration`. Request and response shapes are not repeated
here — the widget-facing routes (§2.1–§2.4) are specified in [`frontend/API_CONTRACT.md`](./frontend/API_CONTRACT.md)
and [`frontend/ACCOUNT_CONTRACT.md`](./frontend/ACCOUNT_CONTRACT.md), the admin routes (§2.8) in
[`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §11. The per-route audit table of 2026-09-08 (callers with `file:line`,
validation notes, the inconsistencies found then) is archived in
[`archive/FEATURE_INVENTORY_AUDIT_2026-09.md`](./archive/FEATURE_INVENTORY_AUDIT_2026-09.md) §C.

Guards (as implemented):

- **guardRequest** (`src/lib/security.ts`) — the Origin header, if present, must be in `ALLOWED_ORIGINS` (default
  `https://www.motionsports.de`, `https://motionsports.de`) → 403, AND `x-ms-chat-key` must equal
  `CHAT_SHARED_SECRET` (SHA-256 then `timingSafeEqual`) → 401. A request without Origin (curl, server-to-server)
  passes when the secret is right.
- **guardOriginOnly** (`src/lib/security.ts`) — Origin allowlist only, no secret; a request with no Origin passes.
- **requireSignedInCustomer** (`src/lib/account-guard.ts`) — guardRequest + `chat` bucket + the one signed-in
  resolver (`resolveLiveSignedInCustomer`, §2.9): a Customer Account link with a live (refreshable) token, or for
  an App Proxy link a fresh shop proof (PLT-03); else 401.
- **guardAdminPost** / **guardAdminGet** (`src/lib/admin-api.ts`) — in-handler, in addition to the Edge proxy
  (`src/proxy.ts`, `ms_admin_session` cookie): POST requires `Content-Type: application/json` (415) and the cookie
  (401); GET re-verifies the cookie. No admin route relies on the proxy alone.
- **requireCronAuth** (`src/lib/cron-auth.ts`) — `Authorization: Bearer <CRON_SECRET>`, constant-time; fails
  closed when unset.

Rate-limit buckets (`src/lib/rate-limit.ts`, Upstash sliding window, key `sid:<x-ms-session>` else
`ip:<x-forwarded-for>`): `chat` 20/60 s, `products` 60/60 s, `kpi` 120/60 s, `tts` 20/300 s, `tts-stream` 120/300 s,
`feedback` 5/300 s, `capture-recipient` 3/60 min (explicit key = recipient e-mail), `contact-ip` 8/60 min (explicit
key = client IP), `admin-login` 10/10 min (explicit key = client IP; the admin login, §2.9). Without
`KV_REST_API_URL` / `KV_REST_API_TOKEN` `getRedis()` throws, so a rate-limited route answers 500 — rate limiting
never silently switches off. The one exception is the admin login: it fails **open** when the limiter is
unavailable, so a limiter outage never locks the operator out.

Runtime: no route runs on the Edge; 14 routes export `runtime = "nodejs"` explicitly (`/api/auth/*`,
`/api/account/*` except `marketing-opt-in`, `admin/analytics/[id]/pdf`), the rest use the Node default. Three routes export `dynamic`
(`email-countdown/[token]`, `admin/campaign/history`, `admin/customers/detail`).

---

## 1. Chat / widget public routes (cross-origin calls from the Shopify theme widget)

Called by the external widget (not in this repo) unless noted. Contract: [`frontend/API_CONTRACT.md`](./frontend/API_CONTRACT.md).

| Path | Methods | Capability | Guard · bucket · maxDuration | Contract / owner |
|---|---|---|---|---|
| `POST /api/chat` | POST, OPTIONS | Mo's streamed answer: agentic tool loop (chat tier, `lib/ai-models.mjs`), retrieval, returning-customer memory from the order ledger, Q&A, live directives, prompt caching; optional `context` (incl. `source`, PLT-06), `customer`, `campaignToken` („Chat-Start“: one session-less `campaign_chat_started` per send, test sends with `test:true`, unique index 0075); tool `get_order_status` (PLT-01); no `offer_email_summary` for a signed-in session (PLT-08). Persistence and KPI writes are best-effort. | guardRequest · `chat` · 300 | API_CONTRACT §2; [`AI_MODELS.md`](./AI_MODELS.md), [`PROMPT_CACHING.md`](./PROMPT_CACHING.md) |
| `POST /api/contact` | POST, OPTIONS | Contact form (`show_contact_form` tool): mail to `CONTACT_TO_EMAIL` via Resend, stored in Mo first as a received mail with an Eingang item „E-Mail beantworten“ (EIG-18); KPI `contact_form_submitted` (session from the body, else `x-ms-session`; reason normalised). Without Resend env it logs and answers `{ok:true}` without sending. | guardRequest · `chat` + `contact-ip` · 10 | API_CONTRACT §4 |
| `GET /api/products` | GET, OPTIONS | Product-card hydration: ≤ 10 ids (variant-pinned refs `handle~variantId`), public projection, combined cart URL without sold-out items; `Cache-Control: public, max-age=60`. | guardOriginOnly · `products` · 10 | API_CONTRACT §3 |
| `POST /api/capture-email` | POST, OPTIONS | E-mail capture: consultation summary mail + optional marketing double opt-in; the act goes to the one consent (`recordMoOptIn`, `pending` until the DOI click); an address already subscribed and not suppressed gets no DOI mail (`alreadyConfirmed`); KPI with `source` / `outcome` (PLT-07). | guardRequest · `chat` + `capture-recipient` · 30 | API_CONTRACT §7.1; [`CONSENT_FLOW.md`](./CONSENT_FLOW.md) |
| `GET /api/consent-copy` | GET, OPTIONS | The legally load-bearing consent strings, one version stamp (`v5`): default (capture form), `?surface=signin` (+ `benefits`, `variant`, PLT-05), `?surface=chat` (+ `signIn` hint; the gate itself is retired in the widget), `?surface=erase` (follows `SHOPIFY_ERASURE_SYNC`). | guardOriginOnly · `products` · 10 | API_CONTRACT §7.4; [`frontend/CONSENT_CONTRACT.md`](./frontend/CONSENT_CONTRACT.md) |
| `POST /api/tts` | POST, OPTIONS | Text-to-speech (OpenAI), single-shot or streaming voice mode; usage recorded per conversation. | guardRequest · `tts` / `tts-stream` · 60 | API_CONTRACT §8; [`AI_MODELS.md`](./AI_MODELS.md) |
| `POST /api/kpi` | POST, OPTIONS | Widget telemetry into `kpi_events` through `recordKpiEvent`; a server-only name (`SERVER_ONLY_EVENTS`, `lib/kpi-widget-events.mjs`) is acknowledged 202 and never stored. Always 202, also without a database. | guardOriginOnly · `kpi` · 10 | API_CONTRACT §5 |
| `POST /api/feedback` | POST, OPTIONS | Free-text feedback → `feedback` (Feedback screen). | guardRequest · `feedback` · 10 | API_CONTRACT §9 |
| `POST /api/chat-marketing-opt-in` | POST, OPTIONS | Marketing-only DOI sign-up of the chat consent gate — not used by the widget since 2026-10-01, served for compatibility; one consent; `source: mo_chat_gate`. | guardRequest · `chat` + `capture-recipient` · 30 | API_CONTRACT §7.6; CONSENT_CONTRACT §2 |
| `GET /api/confirm-marketing?token=` | GET | DOI confirmation link (mail): the one consent becomes `subscribed` (`recordDoiConfirmed`; via the outbox a `consent_update`, or a `customer_create` for a Mo-only subscriber); KPI `email_capture_marketing_confirmed {source}`; HTML result page. | opaque DOI token (§2.11) · none · 30 | API_CONTRACT §7.2; [`CONSENT_FLOW.md`](./CONSENT_FLOW.md) |
| `GET /api/newsletter-rating` | GET | Anonymous 1–5 rating from image-first mails → `feedback` (`page: email:<kind>`); thank-you page. | none · `feedback` (per IP) · 10 | [`EMAIL_DESIGNS.md`](./EMAIL_DESIGNS.md) |

## 2. Customer account routes (`/api/account/*`, signed-in customers)

All: requireSignedInCustomer (`chat` bucket inside the guard), session from `?session=` or `x-ms-session`. Contract:
[`frontend/ACCOUNT_CONTRACT.md`](./frontend/ACCOUNT_CONTRACT.md) §6–§8; backend: [`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §9–§11.

| Path | Methods | Capability | maxDuration | Contract |
|---|---|---|---|---|
| `GET /api/account/conversations` | GET, OPTIONS | The customer's chats across devices (titles, timestamps, counts). | 15 | ACCOUNT_CONTRACT §7.1 |
| `GET/PATCH/DELETE /api/account/conversations/[id]` | GET, PATCH, DELETE, OPTIONS | Transcript, rename, delete one chat — scoped to the customer (a foreign id reads as missing). | 15 | §7.2–§7.4 |
| `POST /api/account/erase` | POST, OPTIONS | Complete erasure through `erasePerson` (erasure tombstone; the Shopify side queued in the outbox). | 20 | §7.5; [`CUSTOMERS.md`](./CUSTOMERS.md) „Retention / erasure“ |
| `GET /api/account/export` | GET, OPTIONS | The person's data as a JSON attachment, incl. consent history, order copy, computed figures, campaign participation and campaign letters. | 30 | §7.7 |
| `POST /api/account/marketing-opt-in` | POST, OPTIONS | Marketing DOI at sign-in for the verified address; one consent with the sign-in proof in `consent_events.note`; optional `placement` / `variant` (PLT-05); `source: mo_signin` (PLT-07). | 30 | §6.2; CONSENT_CONTRACT §3 |
| `GET /api/account/summary?conversationKey=` | GET, OPTIONS | The conversation summary as a PDF download (the signed-in replacement of the summary mail, PLT-08). | 30 | §8 |

## 3. Auth / Shopify Customer Account routes

Contract: [`frontend/ACCOUNT_CONTRACT.md`](./frontend/ACCOUNT_CONTRACT.md) §1–§5; backend: [`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §2–§4.

| Path | Methods | Capability | Guard · bucket · maxDuration | Contract |
|---|---|---|---|---|
| `GET /api/auth/me` | GET, OPTIONS | Identity re-hydration: signed-in state, name, tier, marketing state (`optInActionable` with the per-customer anti-nag) through the one resolver; internal errors answer `{signedIn:false}` 200, never 5xx. | guardRequest · `chat` · 15 | ACCOUNT_CONTRACT §4 |
| `POST /api/auth/link` | POST, OPTIONS | Redeems a one-time sign-in code (0073): links the session (and attaches its chats) only when it is the session the code was minted for; the code is burned on the first attempt; KPI `account_signin_linked` / `account_signin_link_refused`. | guardRequest · `chat` · 15 | ACCOUNT_CONTRACT §2a |
| `GET /api/auth/shopify/login` | GET | PKCE Customer Account OAuth start (allow-listed `return_url`, HMAC-signed `state`, pending row) → 302 to Shopify; `prompt=none` for silent detection. | none (top-level navigation) · none · 15 | ACCOUNT_CONTRACT §2, §3b |
| `GET /api/auth/shopify/callback` | GET | OAuth completion: state + pending record, PKCE exchange, ID-token check, tokens encrypted at rest, one-time code minted (no session link here) → 302 `?ms_auth=ok&ms_code=…`. | signed state · none · 30 | ACCOUNT_CONTRACT §2–§2a |
| `GET /api/auth/shopify/logout` | GET | 302 to Shopify's end-session endpoint (or straight to the return route). | none · none · 15 | ACCOUNT_CONTRACT §5 |
| `GET /api/auth/shopify/logout/return` | GET | Ends every signed-in link of the customer (Customer Account and App Proxy) and deletes the tokens → 302 `?ms_auth=logged_out`. | none · none · 15 | ACCOUNT_CONTRACT §5 |
| `GET /api/auth/storefront` | GET | App Proxy shop recognition (whoami, PLT-03): signature + fresh timestamp, `linkCode` only when the session will be signed in; a signed logged-out request ends the session's `app_proxy` link; records `account_shop_recognised`. Always 200. | Shopify App Proxy signature (`SHOPIFY_APP_PROXY_SECRET`, else `SHOPIFY_CLIENT_SECRET`) · `chat` · 15 | ACCOUNT_CONTRACT §3a |
| `GET /api/auth/storefront/whoami` | GET | Alias of `/api/auth/storefront` (re-exports its `GET`): where the theme's `/apps/chat/whoami` arrives when the App Proxy URL is `…/api/auth/storefront`. | as above · 15 | ACCOUNT_CONTRACT §3a |

## 4. Attribution

| Path | Methods | Capability | Guard · bucket · maxDuration | Contract / owner |
|---|---|---|---|---|
| `POST /api/attribution/token` | POST, OPTIONS | Mints or reuses the session's cart-stamp token (cart attribute `_mo`); the widget calls it only with analytics consent. Window and purge: PLT-04, §2.11. | guardRequest · `kpi` · 10 | API_CONTRACT §10; [`ORDER_ATTRIBUTION.md`](./ORDER_ATTRIBUTION.md) |

## 5. Cron routes (`/api/cron/*`, scheduled in `vercel.json`)

**Ten crons.** All accept GET and POST (one `handle()`), call `requireCronAuth` first (401 `{error:"Unauthorized"}`),
rate-limit nothing, read no body and answer an ad-hoc `{ok, …}` envelope (not the `{error:{code,message}}` one);
a thrown error is reported (`reportError`) and answered 503 `{ok:false, error}`. Seven check `isDbConfigured()`
and answer 503 without a database (all but refresh-customers, retention, sync-catalog). Schedule in Berlin
time, order of the night and each job's steps: §3.

| Path | Schedule (UTC) | Job | Switch / env | maxDuration |
|---|---|---|---|---|
| `/api/cron/shopify-reconcile` | 01:45 | `reconcileShopifyCustomers` (customers + orders changed since the last complete run → mirror + ledger, 170-s budget), then `recomputeCustomerFacts`, then `queueInsightWritebacks` (Mo's `mo-` tags) → `{ok, reconcile, facts, insightTags}` | `SHOPIFY_CUSTOMER_SYNC_ENABLED`; tags `SHOPIFY_WRITEBACK_ENABLED` | 300 |
| `/api/cron/refresh-customers` | 02:00 | `expirePendingConsents`, then the stale customers' Shopify data (`refreshCustomerData`), missing purchase addresses (`autoCaptureMissingAddresses`, 12 per run), then the profile upkeep (Vollprofile, Kaufprofile). `?only=profiles` skips the data part, `?batch=N` overrides the profile batch (`npm run profiles:backfill`) | `CUSTOMER_REFRESH_BATCH` (25), `CUSTOMER_REFRESH_STALE_HOURS` (24), `CUSTOMER_PROFILE_BATCH` (30), `CUSTOMER_PROFILE_LIGHT_BATCH` (0), `CUSTOMER_AI_PROFILE_SCOPE` | 300 |
| `/api/cron/campaign-audiences` | 02:30 | `refreshLiveAudiences` — ends campaigns past their end date, refreshes every active campaign from its audience (consent `subscribed` and no block always required; lost consent → `suppressed`), letter recipients of campaigns with a letter mode; then `nightlyLetterAddresses` → `{ok, …, letterAddresses}` | `CAMPAIGN_LETTER_ADDRESS_NIGHTLY` (200); letters `PHYSICAL_MAIL_SENDS_APPROVED` | 300 |
| `/api/cron/sync-catalog` | 03:00 | Catalog from Shopify → embeddings (`text-embedding-3-small`, carry-forward) → atomic blob pair; a Shopify failure answers 200 with `mode:"fallback-bundle"` (the bundled JSON); total embedding failure → 503, last good pair kept | `OPENAI_API_KEY`, `BLOB_READ_WRITE_TOKEN` | 300 |
| `/api/cron/retention` | 03:30 | `runRetention(retentionOptionsFromEnv())` then `runConversionSweep()` (marks redeemed MS5- codes / converted conversations) | retention windows (§3 1.5; `0` disables), `CONVERSION_SWEEP_MAX_CODES` (25) | 60 |
| `/api/cron/expire-bundles` | every 15 min | `expireBundleOffers()` — deletes the Shopify set products past `expires_at`, rows → `expired`, then the products ended offers still have | – | 60 |
| `/api/cron/release-campaign-mails` | every 10 min | „Einplanen“ (2026-10-03, 0072): `releaseDueCampaignMails` sends due approved campaign mails one at a time through `approveAndSendCampaign` (every gate again), at most `CAMPAIGN_RELEASE_MAX_PER_RUN` per run, `CAMPAIGN_RELEASE_SPACING_MS` apart; changed or refused mails return to the queue with the reason; recovers rows a timeout left in `sending`; 240-s budget (KAM-109) | `CAMPAIGN_RELEASE_ENABLED` (off: nothing is sent) | 300 |
| `/api/cron/prepare-campaign-drafts` | 04:15 | Nightly „Vorbereiten“: a draft budget across live campaigns, each taking its `auto_prepare_per_day` by priority (`planAutoPrepare`); with no per-campaign figure the whole budget goes to the `lebenszyklus` campaign with the `_DISCOUNT` / `_TEXT_MODE` / `_DISCOUNT_SCOPE` settings; 240-s budget; never sends | `CAMPAIGN_AUTO_PREPARE_COUNT` (0 = skipped) | 300 |
| `/api/cron/shopify-sync` | every 5 min | `processShopifyOutbox` (≤ 100 rows, 40 s: consent writes, `customer_create`, `data_erasure`, `writeback`; backoff, dead after 8 attempts), then further steps of a running import → `{ok, outbox, import}` | `SHOPIFY_CONSENT_WRITEBACK`, `SHOPIFY_ERASURE_SYNC`, `SHOPIFY_WRITEBACK_ENABLED`, `SHOPIFY_CUSTOMER_SYNC_ENABLED` (all off = no-op) | 120 |
| `/api/cron/inbox` | hourly at :20 | `runInboxSignals` — rules over the facts and recent events → `inbox_items`, closes / expires items, re-opens due snoozes, 14-day outcomes, then AI suggestions; never sends. Manual twin without AI: `POST /api/admin/inbox/run` | `INBOX_AI_DAILY_LIMIT` (0 = no AI suggestions) | 300 |
| `/api/cron/sync-campaign-audience` — **❌ retired 2026-10-01** | (was 02:30) | Pulled Shopify's newsletter subscribers into `campaign_contacts`. Replaced by the customer mirror (`shopify-reconcile`, webhooks, import) and the per-campaign audiences (`campaign-audiences`); route and libs removed ([`CAMPAIGNS.md`](./CAMPAIGNS.md) §1 „Retired“) | – | – |
## 6. Inbound / webhooks

Verification details: §2.10. All four use `NextResponse.json` ad-hoc envelopes, none rate-limit (signature is the gate), all read the raw body via `req.text()` before verifying.

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/inbound/resend` (`src/app/api/inbound/resend/route.ts`) | POST | Resend Inbound (`email.received`): verify Svix signature → `resend.emails.receiving.get(email_id)` (full body; degrades to webhook metadata on failure) → `normalizeInboundMessage` → `getCustomerByEmail(from)` → `insertReceivedMessage` (dedup on Message-ID). Non-`email.received` events are forwarded to `applyResendDeliveryEvent`. | Resend webhook | Svix signature, secret `inboundWebhookSecret()` (`RESEND_WEBHOOK_SECRET`) | none | `maxDuration = 30` | signature; `email_id` required (400) | `{ok:true, stored, duplicate, matched}`; `{ok:true, ignored}`; `{ok:true, ...deliveryOutcome}`; 400 invalid signature / missing id; 500 store/ingest failure (Resend retries); 503 unconfigured | **Overlaps with `/api/webhooks/resend`**: both apply delivery events (`applyResendDeliveryEvent`). The second-level `try` only wraps the ingest; a throw in `applyResendDeliveryEvent` is caught via `.catch` → still 200. |
| `POST /api/webhooks/resend` (`src/app/api/webhooks/resend/route.ts`) | POST | Resend delivery events (`email.bounced`/`complained`/`delivered`/`delivery_delayed`) → `applyResendDeliveryEvent` (suppression + campaign send stamping). | Resend webhook | Svix signature; tries `RESEND_EVENTS_WEBHOOK_SECRET` then `RESEND_WEBHOOK_SECRET` (first that verifies wins) | none | `maxDuration = 15` | signature only | `{ok:true, ...outcome}`; `{ok:true, ignored:type}`; **`{ok:true, applied:false}` 200 on apply failure** (deliberately acknowledges); 400; 503 | Configured externally in Resend. Overlaps with the inbound route by design (§2.13). |
| `POST /api/webhooks/pingen` (`src/app/api/webhooks/pingen/route.ts`) | POST | Pingen letter status webhook: verify standard-webhooks signature (multi-secret) → `interpretWebhookEvent` → `updatePhysicalLetterStatusByProviderId(providerLetterId, status, costCents)`. | Pingen webhook | standard-webhooks HMAC, `PINGEN_WEBHOOK_SECRET` (comma/space list) | none | `maxDuration = 30` | signature; shapeless event → `{ok:true, ignored:true}` | `{ok:true, updated, status}`; 400; 500 (Pingen retries); 503 | Configured in the Pingen dashboard. |
| `POST /api/webhooks/shopify` (`src/app/api/webhooks/shopify/route.ts`) | POST | Shopify webhooks: verify `X-Shopify-Hmac-SHA256` (**2026-10:** valid under `SHOPIFY_WEBHOOK_SECRET` OR `SHOPIFY_CLIENT_SECRET`) → by `X-Shopify-Topic` (`classifyShopifyTopic`): **2026-10 customer platform**, deduplicated by `X-Shopify-Webhook-Id` (`shopify_webhook_events`; a failed delivery is forgotten so Shopify's retry applies): `customers/create\|update` → mirror upsert + consent resolver, `customers_email_marketing_consent/update` → consent, `orders/create\|updated\|paid\|cancelled` → order ledger (`customer_orders`), `customers/delete` + `customers/redact` → `erasePerson` (trigger `shopify`, alert above `SHOPIFY_ERASURE_ALERT_PER_HOUR`), `customers/data_request` → Eingang item `datenauskunft`, `shop/redact` → alert + Eingang item only (no mass deletion), `bulk_operations/finish` → noted (`src/lib/shopify-webhook-customers.ts`); `orders/create`/`orders/paid` → `ingestShopifyOrder` (attribution, pseudonymous); `products/*`, `inventory_levels/*` → `planCatalogAction` → throttle-gate (`isThrottleGateActive` → `enqueuePendingRefresh` + ack) or `refreshProductInCatalog`/`refreshInventoryItemInCatalog`, then `drainPendingRefreshes`. | Shopify webhook | Shopify HMAC, `SHOPIFY_WEBHOOK_SECRET` or `SHOPIFY_CLIENT_SECRET` (app-made subscriptions) | none | `maxDuration = 60` | signature; topic routing | `{ok:true, topic, action, productId, reembedded, drain?}`; `{ok:true, deferred:true}`; `{ok:true, ignored}`; **401** on bad signature (Resend/Pingen use 400); 500; 503 + `Retry-After: 30` when throttled without Redis | Inconsistent bad-signature status (401 vs 400 in the other two webhooks). No `X-Shopify-Shop-Domain` check. **2026-10:** the customer-platform topics are deduplicated by `X-Shopify-Webhook-Id`; catalog topics are not. Registration: `npm run shopify:webhooks` (compliance topics in the app configuration). |

## 7. Email-link routes (top-level navigations / anonymous image fetches from mail clients)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET /api/unsubscribe?token=` (`src/app/api/unsubscribe/route.ts`) | GET | `verifyUnsubscribeToken(token)` → email → `unsubscribeByEmail(email, "unsubscribe")` (unsubscribed_at + suppression + DOI revoked) → `markCampaignUnsubscribed(email)` (attribute to last 30 days' campaign sends) → `syncCustomerConsent(email)` (**2026-10:** → `recordMoWithdrawal({reason:"unsubscribe"})` — the one consent, and via the outbox Shopify); renders HTML result page. | email link (every marketing / campaign / bundle mail: `lib/campaign-email.ts`, `lib/marketing-email.ts`, the design preview; `scripts/send-test-emails.mjs`) | HMAC token in URL (`b64url(email).b64url(HMAC)`, no expiry — see "Token-based links") | none | `maxDuration = 10` | token verify | HTML 200 / 400 / 503 (verified but not persisted) / 500 | GET with side effect (one-click unsubscribe is required by RFC 8058 anyway). No List-Unsubscribe POST variant. |
| `GET/POST /api/erase-data?token=` (`src/app/api/erase-data/route.ts`) | GET, POST | „Daten löschen" link in every marketing and Kampagne mail footer: GET only renders a confirmation page with a POST form (link scanners never delete); POST runs `erasePerson({ email })` and renders the result. | email link (`unsubscribeFooter(url, locale, erasureUrl)` in `campaign-email.ts`, `marketing-email.ts`, `email-design-preview.ts`) | HMAC token, purpose `erase` (`buildErasureToken` / `verifyErasureToken`) — not interchangeable with the unsubscribe token | none | `maxDuration = 30` | token verify | HTML 200 / 400 / 503 | Complete erasure incl. suppression (reason `erasure`). **2026-10:** page copy via `erasurePageCopy(locale, SHOPIFY_ERASURE_SYNC)`; the erasure reaches Shopify as for `/api/account/erase`. |
| `GET /api/r/[token]` (`src/app/api/r/[token]/route.ts`) | GET | Tracked redirect: tries `recordEmailClick(token)` (marketing send → prefilled cart w/ discount) → `recordCampaignClick(token)` (→ `campaignMoDeeplinkUrl()` + `?mo_c=token`) → `resolveBundleRedirect(token)` (active → cart permalink; else branded 410 "Angebot abgelaufen" page). Falls back to `${SHOP_DOMAIN}/cart`. | email link (marketing / campaign / bundle CTAs); the admin shows a set's link (Kunden → Set-Angebot, `kunden/BundleComposer.tsx`) | opaque random redirect token (DB lookup, see "Token-based links") | none | `maxDuration = 10` | none beyond lookups | 302; 410 HTML for expired bundle; **never 4xx/5xx to the customer** — unresolved → 302 to cart | Three sequential DB lookups per click. Any thrown error is swallowed → 302 to `/cart` (observability via `reportError`). Click = single GET, so link scanners inflate `clicked_at`. **2026-10:** a campaign send whose campaign button leads to the shop (`cta_kind = 'shop'`, 0066) redirects to that shop URL instead of the Mo deep link. |
| `GET /api/email-countdown/[token]?w=m` (`src/app/api/email-countdown/[token]/route.ts`) | GET | Live countdown PNG for offer emails: `verifyCountdownToken(token, countdownSecret())` → `renderCountdownImage({expiresAt, language, width})`. | mail-client image fetch (URL built in `lib/email-template.ts`) | HMAC-signed token carrying deadline + language only (no recipient) | none | `maxDuration = 10`, **`dynamic = "force-dynamic"`** | token verify; `?w=m` flag | `image/png` 200 `no-store`; `text/plain` 404 for bad token or render failure | Render failure (`catch`) also masquerades as 404. Public CPU cost per open, unthrottled — bounded only by the token's validity. |
| `GET /api/email-hero-image/[file]` (`src/app/api/email-hero-image/[file]/route.ts`) | GET | Streams a generated hero image from the private Vercel Blob store: `parseHeroBlobFile(file)` (rejects separators/traversal/non-image) → `get(heroBlobPathname(safeFile), {access:"private", token: BLOB_READ_WRITE_TOKEN})`. | mail-client image fetch (URL built in `lib/email-hero-blob.mjs`); admin preview iframes | none (public by necessity; filename carries a random suffix) | none | `maxDuration = 15` | `parseHeroBlobFile` whitelist | image stream 200 `public, max-age=31536000, immutable`; `text/plain` 404 | Not enumerable without knowing the random suffix, but no auth — any generated hero image is publicly fetchable if the URL leaks. |

## 8. Admin routes (`/api/admin/*`, German back-office dashboard)

The checklist of the 103 admin route files: one row per route with the capability IDs of part 1 that call it.
Purpose, request and refusal codes of every route: [`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §11 (the owner).
Common to all (checked against the code on 2026-10-05):

- Every handler calls an in-handler guard besides the Edge proxy: `guardAdminGet()` in 16 files,
  `guardAdminPost(req)` in 89 (`campaign/test-contacts` and `campaigns` export both GET and POST).
- No rate limiting under `/api/admin` (single-operator back office, cookie-gated).
- Envelope `adminJson(data)` / `adminJsonError(code, message, status)` → `{error:{code,message}}`
  (`src/lib/admin-api.ts`); domain refusal codes pass through verbatim (`not_eligible`, `too_soon`, …).
- Input validation is manual in the handlers (no zod in `src/app/api`).
- Admin access log: 39 route files call `recordAdminAccess` (`src/lib/admin-access-log.ts`) — column „Log“.
- `maxDuration`: most files export one; 14 run with the platform default (`campaign/history`, `conversations/detail`,
  `correspondence/assign`, `correspondence/assign-prospect`, `customers/detail`, `customers/language`, `customers/list`,
  `customers/objection`, `customers/similar`, `inbox/decide`, `inbox/item`, `shopify/align`, `shopify/outbox`,
  `shopify/status`). One exports `runtime = "nodejs"`: `analytics/[id]/pdf`.

| Route (`/api/admin/…`) | Guard | Capability | Log |
|---|---|---|---|
| **Eingang** ||||
| `GET inbox/item?id=` | Get | EIG-07, EIG-15 | – |
| `POST inbox/decide` | Post | EIG-10 | – |
| `POST inbox/suggest` | Post | EIG-08, EIG-15, EIG-16 | ✓ |
| `POST inbox/accept` | Post | EIG-09 | ✓ |
| `POST inbox/run` | Post | EIG-04 (manual twin of `/api/cron/inbox`, without AI) | – |
| `POST correspondence/assign-prospect` | Post | EIG-14, EIG-17 | ✓ |
| `GET customers/list?kq=&kview=&…` | Get | EIG-12 (search), KUN-118 (JSON twin of the Kunden list) | – |
| **Kampagnen — overview, editor, recipients** ||||
| `GET campaigns`, `POST campaigns` | Get + Post | KAM-96…98 (the GET has no UI caller — the screen renders server-side) | – |
| `POST campaigns/update` | Post | KAM-98 | – |
| `POST campaigns/status` | Post | KAM-97 | – |
| `POST campaigns/audience-preview` | Post | KAM-99, KAM-114 (`letterMode`) | – |
| `POST campaigns/assist` | Post | KAM-100 | – |
| `POST campaigns/sample` (2026-10-03) | Post | KAM-111, KAM-112 („Prüfen & testen“: `pick`, `generate`, `send_test`) | – |
| `POST campaigns/refresh` | Post | KAM-77, KAM-102 (manual twin of `/api/cron/campaign-audiences` for one campaign) | – |
| `POST campaigns/add-recipient` | Post | KUN-125, KAM-104 | ✓ |
| `POST campaigns/add-recipients` | Post | KUN-133 | ✓ |
| `POST campaigns/letters` (2026-10-03, 0074) | Post | KAM-116…120, PLT-02 | ✓ |
| `POST campaigns/letters/preview` (2026-10-03, 0074) | Post | KAM-119 | – |
| **Kampagnen — the desk of one campaign** ||||
| `POST campaign/prepare` | Post | KAM-09, KAM-74, KAM-103 | – |
| `POST campaign/draft` | Post | KAM-20, KAM-31, KAM-42, KAM-64, KAM-90 | – |
| `POST campaign/update` | Post | KAM-55 | – |
| `POST campaign/discount` | Post | KAM-48, KAM-81 | – |
| `POST campaign/recommendations` | Post | KAM-45, KAM-83 | – |
| `POST campaign/language` | Post | KAM-30 | – |
| `POST campaign/email-preview` | Post | KAM-61, KAM-78 | – |
| `POST campaign/send` | Post | KAM-59, KAM-60, KAM-73, KAM-92, KAM-106 | – |
| `POST campaign/approve` (2026-10-03, 0072) | Post | KAM-107 („Einplanen“; access log `campaign.approve`) | ✓ |
| `POST campaign/unapprove` (2026-10-03, 0072) | Post | KAM-108 („Zurücknehmen“; access log `campaign.approve.revoke`) | ✓ |
| `POST campaign/skip` | Post | KAM-65 | – |
| `POST campaign/unskip` | Post | KAM-21, KAM-25 | – |
| `POST campaign/mark-done` | Post | KAM-63 | – |
| `POST campaign/reset-queue` | Post | KAM-11 | – |
| `POST campaign/contacts` | Post | KAM-17 | – |
| `GET/POST campaign/test-contacts` | Get + Post | KAM-92 | – |
| `GET campaign/history` | Get | KAM-85, KAM-87 | – |
| `POST campaign/sent-email` | Post | KAM-69 | – |
| `POST campaign/sync` — **❌ retired 2026-10-01** → `campaigns/refresh` | – | KAM-06 | – |
| **Kunden** ||||
| `GET customers/detail?id=` | Get | KUN-110, KUN-120, KUN-121, KUN-124, KUN-126, KUN-127, KUN-130, KUN-131 | – |
| `GET customers/similar?id=` | Get | KUN-134 | ✓ |
| `POST customers/ask` | Post | KUN-132 | ✓ |
| `POST customers/profile` | Post | KUN-36, KUN-129 | ✓ |
| `POST customers/purchases` | Post | KUN-44 | – |
| `POST customers/language` | Post | KUN-122 | – |
| `POST customers/objection` | Post | KUN-128, KUN-129 | ✓ |
| `POST customers/marketing-optout` | Post | KUN-112, KAM-95 | ✓ |
| `POST customers/erase` | Post | KUN-111, KAM-94 | ✓ |
| `POST customers/marketing-draft` | Post | KUN-29, KUN-58, KUN-69 (open drafts of the former 1:1 path) | – |
| `POST marketing/update` | Post | KUN-64, KUN-66 | – |
| `POST marketing/email-preview` | Post | KUN-65 | – |
| `POST marketing/send` | Post | KUN-66 | – |
| `POST marketing/delete` | Post | KUN-67 | – |
| `POST marketing/draft` — **❌ removed 2026-09 (D-9)** → `customers/marketing-draft` | – | – (no caller since the Marketing tab was folded into Kunden) | – |
| `POST bundles/suggest` | Post | KUN-72 | – |
| `POST bundles/create` | Post | KUN-80, KAM-54, KAM-82 | – |
| `POST bundles/archive` | Post | KUN-84, KAM-51 | – |
| `POST bundles/delete` | Post | KUN-82 | – |
| `POST bundles/list` — **❌ removed 2026-09 (D-9)** | – | – (offers are rendered server-side) | – |
| `POST catalog/search` | Post | KUN-75, KAM-46, WIS-10 | – |
| `POST correspondence/send` | Post | KUN-90, EIG-14, EIG-15 | – |
| `POST correspondence/message` | Post | KUN-95 | ✓ |
| `POST correspondence/assign` | Post | EIG-12, EIG-14 (formerly KUN-04) | – |
| `POST correspondence/email-preview` | Post | KUN-91 | – |
| `POST customers/letter-draft` | Post | KUN-98, KUN-102 | – |
| `POST customers/letter-preview` | Post | KUN-98, KUN-103 | – |
| `POST customers/letter-address` (2026-10-03, 0074) | Post | KUN-135 (403 `flag_off` while `PHYSICAL_MAIL_SENDS_APPROVED` is off) | ✓ |
| `POST physical/send` | Post | KUN-104, KUN-135 | – |
| `GET email-hero`, `POST email-hero/suggest`, `…/generate`, `…/headline`, `…/remove` | Get / Post | KUN-63, KAM-57, KAM-74, KAM-84 | POSTs ✓ |
| **Wissen** ||||
| `GET qa/list?status=` | Get | WIS-01, WIS-02 | – |
| `POST qa/scan` | Post | WIS-01 | ✓ |
| `POST qa/answer` | Post | WIS-11, WIS-12 | ✓ |
| `POST qa/publish` | Post | WIS-12 | ✓ |
| `POST qa/unpublish` | Post | WIS-13 | ✓ |
| `POST qa/dismiss` | Post | WIS-14 | ✓ |
| `POST qa/restore` | Post | WIS-15 | ✓ |
| `POST qa/draft` — **❌ removed 2026-09 (D-9)** → `qa/scan` | – | – | – |
| **KPIs** ||||
| `POST kpi/top-questions` | Post | KPI-63 | – |
| **Gespräche** ||||
| `POST conversations/detail` | Post | GES-29 | ✓ |
| `POST conversations/analyze` | Post | GES-31 | ✓ |
| `POST conversations/analyze-bulk` | Post | GES-17 | ✓ |
| `POST conversations/insights` | Post | GES-37 | ✓ |
| **Analyse** ||||
| `GET analytics` | Get | ANA-02 (list) | – |
| `GET analytics/[id]` | Get | ANA-02 | – |
| `GET analytics/[id]/pdf` | Get | ANA-10 | – |
| `POST analytics/estimate` | Post | ANA-06 | – |
| `POST analytics/create` | Post | ANA-07 | ✓ |
| `POST analytics/step` | Post | ANA-08 | – |
| `POST analytics/delete` | Post | ANA-11 | ✓ |
| **Verbesserung** ||||
| `GET improve` | Get | VER-02 (list) | – |
| `GET improve/[id]` | Get | VER-02 | – |
| `POST improve/run` | Post | VER-04 | ✓ |
| `POST improve/step` | Post | VER-06 | – |
| `POST improve/suggestion` | Post | VER-15…17 | ✓ |
| `POST improve/adopt` | Post | VER-14 | ✓ |
| `POST improve/delete` | Post | VER-08 | ✓ |
| `POST directives/save` | Post | VER-22, VER-24 | ✓ |
| `POST directives/toggle` | Post | VER-23 | ✓ |
| `GET directives/versions?id=` | Get | VER-21 | – |
| `GET directives` — **❌ removed 2026-09 (D-9)** | – | – (the directives are rendered server-side) | – |
| **Einstellungen** ||||
| `POST email-designs/preview` | Post | EIN-02, EIN-04 | – |
| `POST email-designs/assign` | Post | EIN-03 | ✓ |
| `GET email-designs` — **❌ removed 2026-09 (D-9)** | – | – (the registry is rendered server-side) | – |
| `GET shopify/status` | Get | EIN-07, EIN-10 (no UI caller — the card renders server-side) | – |
| `POST shopify/import` | Post | EIN-08 | – |
| `POST shopify/outbox` | Post | EIN-09 | – |
| `POST shopify/align` | Post | EIN-10 | – |
## 9. Auth helpers (as implemented)

| Helper | File | Behaviour |
|---|---|---|
| `proxy` | `src/proxy.ts` | Edge proxy on `/admin/:path*` + `/api/admin/:path*`. `/admin/login` passes; otherwise verifies the `ms_admin_session` cookie (`verifyAdminSessionToken`, Web Crypto HMAC-SHA256, 12 h `exp`). Pages → 307 `/admin/login` (`NextResponse.redirect` default; the file's header comment says 302); APIs → 401 JSON envelope. |
| `isAdminPasswordValid` / `createAdminSessionToken` / `verifyAdminSessionToken` | `src/lib/admin-auth.ts` | SHA-256 digests compared constant-time; stateless signed cookie `base64url(JSON{exp}).base64url(HMAC)`; secret `ADMIN_SESSION_SECRET` → fallback `CHAT_SHARED_SECRET`; fails closed when unset. Login attempts are rate-limited (D-7): 10 per 10 min per IP, bucket `admin-login`, in the login server action (`src/app/admin/login/page.tsx`); fails **open** without KV or on a limiter error, so the operator is never locked out. |
| `guardAdminPost` / `guardAdminGet` / `adminJson` / `adminJsonError` | `src/lib/admin-api.ts` | In-handler defence in depth: POST requires `Content-Type: application/json` (415, CSRF defence) + cookie (401); GET re-verifies the cookie. **Every `/api/admin/*` route uses one of the two guards** (all 103 admin route files; no route relies on the proxy alone). |
| `guardRequest` / `guardOriginOnly` / `corsHeaders` / `preflightResponse` | `src/lib/security.ts` | Origin allowlist (`ALLOWED_ORIGINS`) + `x-ms-chat-key` shared secret (SHA-256 + `timingSafeEqual`); CORS headers incl. `x-ms-locale`, exposed `Retry-After`. |
| `requireSignedInCustomer` / `readSession` | `src/lib/account-guard.ts` | guardRequest + chat bucket + session→customer→valid Shopify Customer Account token. **2026-10-05:** via `resolveLiveSignedInCustomer` — a chat token or a fresh shop proof (App Proxy, D-AP1); returns `proof`; 401 „Nicht angemeldet“ (unlinked) / „Sitzung abgelaufen“ (proof ran out). |
| `resolveLiveSignedInCustomer` (2026-10-05) | `src/lib/signed-in-session.ts` | The one signed-in resolver behind `/api/auth/me`, `requireSignedInCustomer` and Mo's memory: `customer_account` → live token (refreshed); `app_proxy` → `shop` while the last redeem is within `appProxyShopProofHours()`, else token; `email` / `legacy` → unlinked. Pure rules `signedInProofFor` (`signed-in-proof.mjs`, tested). |
| `isConsentAskQuiet` (2026-10-05) | `src/lib/consent-ask-policy.mjs` (tested) → `signed-in-identity.ts` | Anti-nag: `optInActionable:false` when the customer declined the consent popup (surface `signin`) in any of their sessions in the last 30 days or saw it in ≥ 3 sessions; read failure → not actionable. Applies to chat sign-ins and shop-login recognition. |
| `requireCronAuth` | `src/lib/cron-auth.ts` | `Authorization: Bearer <CRON_SECRET>` constant-time; fails closed. |

## 10. Webhook verification

| Route | Mechanism | Notes |
|---|---|---|
| `POST /api/inbound/resend` | Svix / standard-webhooks via `resend.webhooks.verify` over the RAW body (`lib/email-webhook.mjs`), secret `RESEND_WEBHOOK_SECRET`; 503 when unset; 400 on failure. Timestamp tolerance + replay window are the SDK defaults (standard-webhooks: 5 min). | Also applies delivery events (`email.bounced/complained/delivered`) when they arrive here. Dedup on Message-ID for received mail. |
| `POST /api/webhooks/resend` | Same verifier; tries `RESEND_EVENTS_WEBHOOK_SECRET` then `RESEND_WEBHOOK_SECRET`. | Overlaps with the inbound route by design (one or two Resend webhooks). Apply failures are acknowledged with 200 `{applied:false}` (reported to Sentry) — a retry would not help. |
| `POST /api/webhooks/shopify` | `X-Shopify-Hmac-SHA256` over the raw body with `SHOPIFY_WEBHOOK_SECRET` (constant-time); 503 when unset. **2026-10:** a signature valid under `SHOPIFY_WEBHOOK_SECRET` OR `SHOPIFY_CLIENT_SECRET` is accepted (admin-made vs. app-made subscriptions); 503 only when neither is set. | Topics: orders/create, orders/paid (attribution), products/*, inventory_levels/* (catalog refresh with throttle gate). **2026-10:** + customers/create\|update\|delete, customers_email_marketing_consent/update, orders/updated\|cancelled (ledger), bulk_operations/finish and the compliance topics customers/data_request, customers/redact, shop/redact — deduplicated by `X-Shopify-Webhook-Id`. |
| `POST /api/webhooks/pingen` | standard-webhooks HMAC with one of the comma-separated `PINGEN_WEBHOOK_SECRET`s over the raw body; 503 when unset. | Letter status updates by provider id. |

## 11. Token-based links

| Link | Token | Generation | Verification | Expiry |
|---|---|---|---|---|
| `GET /api/unsubscribe?token=` | `b64url(email).b64url(HMAC-SHA256(email))` | `buildUnsubscribeToken` (`lib/email-capture-store.ts`), secret `UNSUBSCRIBE_SECRET` → fallback `CHAT_SHARED_SECRET` | `verifyUnsubscribeToken` with `timingSafeEqual` | none (unsubscribe must always work) |
| `GET/POST /api/erase-data?token=` | `b64url(email).b64url(HMAC-SHA256("erase:" + email))` | `buildErasureToken` / `buildErasureUrl` (`lib/email-capture-store.ts`), same secret as unsubscribe | `verifyErasureToken` with `timingSafeEqual` | none (deletion must always work) |
| `GET /api/confirm-marketing?token=` | random DOI token stored on the capture row | `upsertEmailCapture` / DOI send | `confirmMarketingByToken` (DB lookup) | `MARKETING_DOI_EXPIRY_DAYS` (7) |
| `GET /api/r/[token]` | 24 random bytes b64url stored per marketing send / campaign send / bundle offer | `generateRedirectToken` (`lib/marketing-store.ts`, Web Crypto) | DB lookup in three stores, in order | bundle: offer expiry → branded 410 page |
| `GET /api/email-countdown/[token]` | HMAC-signed `{expiresAt, language}` | `lib/email-countdown-token.mjs` (`countdownSecret()`) | signature check, no DB | the deadline itself (renders "abgelaufen") |
| `POST /api/attribution/token` (widget) → cart attribute `_mo` | random token stored in `mo_attribution_tokens` (pseudonymous) | `lib/mo-orders-store.ts` | matched on `orders/*` webhook | `MO_ATTRIBUTION_WINDOW_DAYS` + 7 d purge; with `MO_ATTRIBUTION_SESSION_ANCHOR` (PLT-04) window + 7 d after its own session's last product consultation, at most `KPI_RETENTION_DAYS` (180) after minting; after a purge or erasure the endpoint mints a new one ([`ORDER_ATTRIBUTION.md`](./ORDER_ATTRIBUTION.md), API_CONTRACT §10) |

## 12. Routes without any caller in this repository

Moved to the archive (a 2026-09-08 audit finding, not a capability):
[`archive/FEATURE_INVENTORY_AUDIT_2026-09.md`](./archive/FEATURE_INVENTORY_AUDIT_2026-09.md) §C. Resolved since: the
three removal candidates (`bundles/list`, `marketing/draft`, `qa/draft`) and the GETs `directives` and
`email-designs` were removed with D-9 (§2.8). Read twins without a UI caller by design: `GET campaigns`,
`GET shopify/status`. External callers: the widget (§2.1–§2.4), Vercel Cron (§2.5), the providers (§2.6), mail
clients (§2.7).

## 13. Duplicated or overlapping routes

Moved to the archive (2026-09-08 finding): same file, §C. Intended twins today: `POST /api/admin/campaigns/refresh`
↔ `/api/cron/campaign-audiences` (one campaign vs. all), `POST /api/admin/inbox/run` ↔ `/api/cron/inbox` (without AI
suggestions), `POST /api/admin/shopify/import` (`step`) ↔ `/api/cron/shopify-sync` (continues a started import);
`/api/inbound/resend` and `/api/webhooks/resend` both apply Resend delivery events (one or two webhooks configured in
Resend).

## 14. Chat API contract surface

The widget contract — every widget-visible request, response, stream part, tool and KPI event, with its change log
since 2026-10-01 — is [`frontend/API_CONTRACT.md`](./frontend/API_CONTRACT.md) (Appendix A),
[`frontend/ACCOUNT_CONTRACT.md`](./frontend/ACCOUNT_CONTRACT.md) and
[`frontend/CONSENT_CONTRACT.md`](./frontend/CONSENT_CONTRACT.md).

---

# 3. Cron jobs and background work

### 1.1 Schedule (`vercel.json`, region `fra1`)

Vercel Cron evaluates schedules in UTC. Berlin = CET (UTC+1) in winter, CEST (UTC+2) late March → late October.

**Ten crons** (`vercel.json`; `sync-campaign-audience` retired 2026-10-01, 1.3):

| # | Path | Cron (UTC) | Europe/Berlin (CEST / CET) | maxDuration | Route file |
|---|------|-----------|---------------------------|-------------|-----------|
| 1 | `/api/cron/shopify-reconcile` | `45 1 * * *` → 01:45 daily | 03:45 / 02:45 | 300 s | `src/app/api/cron/shopify-reconcile/route.ts` |
| 2 | `/api/cron/refresh-customers` | `0 2 * * *` → 02:00 daily | 04:00 / 03:00 | 300 s | `src/app/api/cron/refresh-customers/route.ts` |
| 3 | `/api/cron/campaign-audiences` (replaces sync-campaign-audience) | `30 2 * * *` → 02:30 daily | 04:30 / 03:30 | 300 s | `src/app/api/cron/campaign-audiences/route.ts` |
| 4 | `/api/cron/sync-catalog` | `0 3 * * *` → 03:00 daily | 05:00 / 04:00 | 300 s | `src/app/api/cron/sync-catalog/route.ts` |
| 5 | `/api/cron/retention` | `30 3 * * *` → 03:30 daily | 05:30 / 04:30 | 60 s | `src/app/api/cron/retention/route.ts` |
| 6 | `/api/cron/expire-bundles` | `*/15 * * * *` → every 15 min | — | 60 s | `src/app/api/cron/expire-bundles/route.ts` |
| 7 | `/api/cron/release-campaign-mails` (2026-10-03) | `*/10 * * * *` → every 10 min | — | 300 s | `src/app/api/cron/release-campaign-mails/route.ts` |
| 8 | `/api/cron/prepare-campaign-drafts` | `15 4 * * *` → 04:15 daily | 06:15 / 05:15 | 300 s | `src/app/api/cron/prepare-campaign-drafts/route.ts` |
| 9 | `/api/cron/shopify-sync` | `*/5 * * * *` → every 5 min | — | 120 s | `src/app/api/cron/shopify-sync/route.ts` |
| 10 | `/api/cron/inbox` | `20 * * * *` → hourly at :20 | — | 300 s | `src/app/api/cron/inbox/route.ts` |

Order of the night: reconcile + facts (01:45) → profiles (02:00) → campaign audiences (02:30) → catalog (03:00) → retention (03:30) → drafts (04:15), so every draft is written from fresh data.

Common to all ten:
- **Runtime**: no cron route exports `runtime`; they run on Node (they import `node:crypto` through
  `src/lib/cron-auth.ts`, so they cannot be Edge). Every route exports `maxDuration` (table above).
- **Auth**: `requireCronAuth(req)` → `isCronAuthorized`: requires `Authorization: Bearer <CRON_SECRET>`, compares
  SHA-256 digests with `timingSafeEqual`, **fails closed** (401 `{error:"Unauthorized"}`) when `CRON_SECRET` is unset.
  Vercel Cron sends the header itself when `CRON_SECRET` is set in the project. Manual trigger:
  `curl -H "Authorization: Bearer $CRON_SECRET" $URL`.
- **Methods**: each route exports `GET` and `POST`, both delegating to one `handle()`.
- **Database**: seven routes answer 503 `"No database configured"` without a database; `refresh-customers`,
  `retention` and `sync-catalog` do not check up front.
- **Failure envelope**: try/catch → `reportError(err, { route })` (Sentry via `src/lib/observability.ts`) and
  `{ ok:false, error }` with **HTTP 503**. Success is `{ ok:true, ...summary }`, most routes also log
  `[cron/<name>] done`. A 401/503 shows up as a failed run in the Vercel Cron log; there is no alerting beyond Sentry.

### 1.2 `/api/cron/refresh-customers` — `src/app/api/cron/refresh-customers/route.ts`

Purpose: keep each customer's cached Shopify order history (→ owned items) and lawful postal address fresh without the
admin pressing "Käufe aktualisieren".

> **2026-10:** first `expirePendingConsents` (`src/lib/consent-store.ts`): a pending double opt-in whose link expired
> (`MARKETING_DOI_EXPIRY_DAYS` + 1 day) falls back to „Keine Einwilligung“ with a `consent_events` entry, so the person
> may be asked again. For mirrored customers the order ledger replaces the per-e-mail cache (`loadPurchaseHistory`;
> the chat's returning-customer memory reads it too). After the data refresh the route runs the profile upkeep twice: Vollprofile (`CUSTOMER_PROFILE_BATCH`, deep tier, people with a
> chat or correspondence) and Kaufprofile (`CUSTOMER_PROFILE_LIGHT_BATCH`, default 0, writer tier, orders only), both
> within `CUSTOMER_AI_PROFILE_SCOPE` and never after an Art. 21 objection. The customer facts are computed by
> `/api/cron/shopify-reconcile` (1.8), not here.

Steps:
1. `requireCronAuth`.
2. Reads `CUSTOMER_REFRESH_BATCH` (default 25) and `CUSTOMER_REFRESH_STALE_HOURS` (default 24) through a local `intEnv`
   helper (note: this duplicates `parseIntEnv` from `src/lib/env-num.ts` with min=1 semantics).
3. `listCustomersForDataRefresh(batch, staleBefore)` (`src/lib/customer-store.ts`):
   `SELECT id, email, shopify_customer_id FROM customers WHERE purchase_summary_updated_at IS NULL OR < stale
   ORDER BY purchase_summary_updated_at ASC NULLS FIRST, id ASC LIMIT batch`. Returns `[]` on DB error (swallowed +
   reported).
4. **Sequentially** for each candidate: `refreshCustomerData(c)` (`src/lib/customer-refresh.ts`):
   - if `shopifyCustomerId` set and `getValidAccessToken(customer.id)` (customer-oauth-store) returns a live token →
     `refreshSignedInCustomerCache(customer.id)` (customer-account-cache; Customer Account API; also caches name +
     address) → source `customer_account`.
   - else fallback: `isShopifyConfigured()` guard → `fetchOrderHistoryByEmail(email)` (shopify-orders, Admin API) →
     `saveCustomerPurchaseSummary(id, history)` (customer-store).
   - if `isPhysicalMailSendsApproved()` (`pingen-flag.mjs`, env `PHYSICAL_MAIL_SENDS_APPROVED`) →
     `fetchLawfulAddressByEmail` and store **only** when `source === "purchase"` (`saveCustomerPostalAddress`).
   - always `markPostalAddressChecked(id)` (`customer-store.ts`, sets `postal_address_checked_at = now()`).
   - never throws; returns `{ok:false, reason}` on any failure.
5. **2026-09 (TECH-E3):** `autoCaptureMissingAddresses({ limit: 12 })` (`src/lib/address-capture.ts`) — exits unless
   Shopify is configured and `PHYSICAL_MAIL_SENDS_APPROVED` is on; up to 12 customers without a stored address and not
   checked in the last 7 days → `fetchLawfulAddressByEmail`, stored only when `source === "purchase"`. (Until the
   clean-up this ran as a background `after()` on every `/admin` render.)
6. The profile upkeep (2026-10 box above), then `{ ok:true, pendingExpired, considered, refreshed, failed, batch,
   staleHours, addressesChecked, addressesCaptured, profiles, lightProfiles }`.

Failure behaviour: one customer failing only increments `failed`; a thrown error outside the loop → 503. Since each
successful refresh bumps `purchase_summary_updated_at`, failed customers stay at the head of the stale queue and are
retried next night — but **a customer that permanently fails (e.g. e-mail with no Shopify account,
`upstream_unavailable`) is never stamped and will occupy one of the 25 slots every single night** (the address-capture
path has a throttle stamp, the purchase-summary path does not). With N permanently-failing customers ≥ batch size the
sweep stalls.

Idempotent: yes (pure cache refresh; re-running writes the same data). Side effects: Shopify Admin API reads
(rate-limited, hence sequential), `customers` UPDATEs, no e-mail, no Shopify writes.

### 1.3 `/api/cron/sync-campaign-audience` — `src/app/api/cron/sync-campaign-audience/route.ts`

> **❌ Retired 2026-10-01.** The route, `src/lib/campaign-sync.ts`, `src/lib/campaign-sync-core.mjs` (+ test), the
> subscriber query `src/lib/shopify-customers.ts` and the admin twin `/api/admin/campaign/sync` are removed. Replaced
> by the customer mirror (`/api/cron/shopify-reconcile`, webhooks, import — 1.8) and the per-campaign audiences
> (`/api/cron/campaign-audiences` — 1.9). Shopify-side unsubscribes now reach Mo through the consent webhook and the
> reconcile into the one consent, and the send gate reads that consent fresh. 

The description of the retired job is archived ([archive](./archive/FEATURE_INVENTORY_AUDIT_2026-09.md) §D.3); the retired newsletter sync is also recorded in
[`CAMPAIGNS.md`](./CAMPAIGNS.md) §1 („Retired“) and [`archive/CAMPAIGNS_HISTORY_2026-10.md`](./archive/CAMPAIGNS_HISTORY_2026-10.md).

### 1.4 `/api/cron/sync-catalog` — `src/app/api/cron/sync-catalog/route.ts`

Purpose: pull the live Shopify product catalog, regenerate OpenAI embeddings, write both as a consistent pair to Vercel
Blob under stable keys (`CATALOG_BLOB_KEY`, `EMBEDDINGS_BLOB_KEY` from `src/lib/catalog-store.ts`) so `/api/chat` picks
up the new data on the next warm invocation. Reliability rationale in docs/archive/CATALOG_SYNC_DIAGNOSIS.md.

Steps (`route.ts`):
1. `requireCronAuth`.
2. Source products: `fetchAllProducts()` (`src/lib/shopify.ts`, Admin API) → `mapShopifyProducts(raw)`
   (`src/lib/catalog-mapping.ts`). Any error, or 0 products after filtering → `mode = "fallback-bundle"` and
   `fallbackFromBundle()` dynamically imports `src/data/product-catalog.json`. **HTTP 200 in fallback
   mode** — the response carries `mode:"fallback-bundle"` and `shopifyError`, but a Shopify outage does not fail the cron.
3. If `OPENAI_API_KEY` unset: write only the catalog blob (if `BLOB_READ_WRITE_TOKEN` set), `invalidateCache()`,
   return 200 with `embeddingsSkipped`.
4. `embedAll(products)`: `buildEmbeddingDoc` + `embeddingDocHash` per product (`embedding-doc.mjs`,
   `EMBEDDING_DOC_VERSION`), `readEmbeddingsBlobDirect()` for carry-forward, `embedDocsResilient(...)`
   (`embed-resilience.mjs`) with model `text-embedding-3-small`, chunk 100, 250 ms inter-chunk delay, OpenAI SDK
   `maxRetries: 4`; `classifyOpenAiError` (`openai-error.mjs`) flags `quota` (billing) distinctly with a loud
   `console.error`.
5. TOTAL failure (`synced === 0 && carriedForward === 0`) → `reportError` + **503**, last-good blob pair is preserved.
6. Otherwise `writeCatalogPair(products, file)` (`src/lib/catalog-store.ts`): reconcile orphan vectors, write
   embeddings blob FIRST, then catalog blob, then `invalidateCache()`. Both `put()`s use `access:"private"`,
   `addRandomSuffix:false`. A throw here → outer catch → 503 with the other blob untouched.
7. `summaryResponse`: `{ ok:true, partial, mode, productCount, embeddingsCount, synced, carriedForward,
   skipped, docVersion, catalogBlobKey/Url, embeddingsBlobKey/Url, elapsedMs, ...log }`. `partial:true` when some
   products have no vector.

Failure behaviour: partial success → 200 with `partial:true`; total embedding failure → 503 and nothing written;
blob write throw → 503. Idempotent: yes (overwrites the same two blob keys; embedding is deterministic modulo model
nondeterminism; carry-forward by `docHash` avoids re-embedding unchanged items).

Note: `invalidateCache()` only clears the in-process cache of the cron's own lambda; other warm `/api/chat` instances
pick up the new blobs via their own TTL logic in `catalog-store.ts` (not part of this route).

### 1.5 `/api/cron/retention` — `src/app/api/cron/retention/route.ts`

Purpose: enforce docs/DATA_RETENTION.md windows + piggy-backed **conversion sweep**.

Steps (`route.ts`):
1. `requireCronAuth`.
2. `retentionOptionsFromEnv()` (`src/lib/retention.ts` over the tested `src/lib/retention-options.mjs`): every window is
   an env var with a default; `0` disables that step, an invalid or negative value falls back to the default. The
   windows, their defaults and what each one deletes are owned by [`DATA_RETENTION.md`](./DATA_RETENTION.md)
   (per-cluster „Retention windows“ tables); the variables are listed in part 5.
3. `runRetention(opts)`: throws if `getSql()` is null (→ 503). Then one statement per step, sequentially, each
   `WITH del AS (DELETE … RETURNING 1) SELECT count(*)` — no transaction, so a mid-run failure leaves earlier steps
   committed (every step is independently idempotent); a step whose window is 0 is skipped. Steps and their order:
   [`DATA_RETENTION.md`](./DATA_RETENTION.md) „How retention is enforced“ (the step numbers are the code's).
4. `runConversionSweep()` (`src/lib/conversion-sweep.ts`) — **never throws**, returns `{ran:false}` when no
   DB / no Shopify / `CONVERSION_SWEEP_MAX_CODES` (default 25, 0 disables) is 0. Selects the oldest ≤25 `marketing_sends`
   rows with `status='sent' AND discount_code IS NOT NULL AND shopify_order_matched=false AND (discount_expires_at IS
   NULL OR > now-7d)`; for each: `wasCodeSeenOnIngestedOrder(code)` (mo-orders-store, cheap DB check) else
   `wasDiscountCodeRedeemed(code)` (shopify-orders, Admin API); on `true` → `UPDATE marketing_sends SET
   shopify_order_matched=true` and flip the session's most-recent-as-of-send conversation to `status='converted'`. `null` (unknown) → counted, retried next run.
5. Response `{ ok:true, options, ...RetentionResult, conversionSweep }`.

Failure behaviour: `runRetention` throw → 503 (sweep not run). Sweep errors are swallowed (`reportError`) and yield
`{ran:false}`. **Budget risk:** maxDuration is only **60 s** for 19 statements + up to 25 Shopify calls; the sweep
alone can take a good chunk of that on a slow Shopify day. The per-row Shopify part is bounded by the cap; fine for
now but one of the two 60-s crons (with expire-bundles).

Idempotent: yes. Every DELETE is by cutoff; the abandon flip only touches `status='active'`; `converted` is sticky.

### 1.6 `/api/cron/expire-bundles` — `src/app/api/cron/expire-bundles/route.ts`

Purpose: delete the Shopify bundle products of `bundle_offers` rows that are `status='active'` and past `expires_at`;
flip the row to `expired` + `archived_at` + `shopify_deleted_at`; then delete the products ended offers still have.

Steps (`route.ts`):
1. `requireCronAuth`.
2. `isDbConfigured()` else **503** `"No database configured"` (like six other crons, see 1.1).
3. `expireBundleOffers()` (`src/lib/bundle-offers.ts`) → `runBundleExpirySweep(deps)`
   (`src/lib/bundle-offer-core.mjs`) with:
   - `fetchDueBundleOffers(nowIso)` (`src/lib/bundle-offers-store.ts`): `SELECT id, shopify_product_id FROM
     bundle_offers WHERE status='active' AND expires_at < now ORDER BY expires_at LIMIT 500` — throws on DB error.
   - per offer, sequential: `deleteBundleProduct(productId)` (shopify-bundles, `productDelete`, an already-deleted
     product counts as success; skipped when `shopifyProductId` is null) then `markOfferExpired(id)`
     (`UPDATE … WHERE id=$1 AND status='active'`) and `markShopifyProductDeleted(id)` (fail-soft).
   - clean-up pass: `fetchEndedOffersWithShopifyProduct()` (expired/failed rows with a product and no
     `shopify_deleted_at`, 25 per run, fail-soft) → `deleteBundleProduct` + `markShopifyProductDeleted`.
   - per-offer error → `failed++`, `reportError` + loud `console.error("… will retry next run")` (`bundle-offers.ts`).
4. Response `{ ok:true, expired, removed, failed, scanned, ranAt }`.

Failure behaviour: per-offer failures don't abort; the row stays `active` (or on the clean-up list) so it is retried
on the next run 15 minutes later. A DB read error of the due list propagates → 503. Idempotent: yes (a gone product
counts as deleted, the UPDATEs are guarded).

### 1.8 `/api/cron/shopify-reconcile` — `src/app/api/cron/shopify-reconcile/route.ts` (new 2026-10)

Purpose: catch every Shopify customer and order a webhook may have missed, then recompute the deterministic customer
facts the Kunden list, the audiences and the Eingang read.

1. `requireCronAuth`; `isDbConfigured()` else 503.
2. `reconcileShopifyCustomers({deadlineMs: +170 s})` (`src/lib/shopify-sync.ts`) — gated by
   `SHOPIFY_CUSTOMER_SYNC_ENABLED`: customers and orders updated since the last complete run → `upsertMirrorCustomers`
   (consent through the resolver, `consent-core.mjs`; erasure tombstones are skipped) and `upsertMirrorOrders`; a
   `shopify_sync_runs` row of kind `reconcile` is the floor of the next run.
3. `recomputeCustomerFacts({deadlineMs: +270 s})` (`src/lib/customer-facts.ts` over the pure `customer-facts-core.mjs`) —
   always (also chat-only people): `facts_dirty_at` customers first (set by webhooks / imports), then everyone computed
   more than 20 h ago; batches into `customer_facts`.
4. **2026-10 follow-up:** the facts deadline is now +260 s, then `queueInsightWritebacks({deadlineMs: +285 s})`
   (`src/lib/shopify-insights.ts`, plan D-11) — only while `SHOPIFY_WRITEBACK_ENABLED`: every mirrored customer with
   figures and no open `writeback` row, in pages of 1,000 by id, desired `mo-` tags (`desiredMoTags` in
   `shopify-insight-tags.mjs`, tested: `mo-segment-<segment>`, `mo-wert-<tier>`, `mo-kontakt`, `mo-abwanderung-hoch`;
   none at all while `profile_objection_at` is set — an Art. 21 objection to profiling)
   against the mirrored `shopify_tags` (`moTagDiff`, only `mo-` tags) → one `writeback` outbox row `{add, remove}` per
   changed person, at most 2,000 per night.
5. `{ok, reconcile, facts, insightTags: {checked, queued, skipped}}`; 503 on throw. Idempotent (upserts by Shopify id;
   facts are recomputed; tags converge).

### 1.9 `/api/cron/campaign-audiences` — `src/app/api/cron/campaign-audiences/route.ts` (new 2026-10)

`refreshLiveAudiences({deadlineMs: +260 s})` (`src/lib/campaigns-store.ts`): `endExpiredCampaigns` (status `beendet`
when `ends_at` passed), then `refreshCampaignAudience` for every active campaign except the Einzelansprache (`matchAudience` over
`customer_overview`; consent `subscribed` and no block always required). Dynamic campaigns admit new matches and mark
open recipients that no longer match `excluded`; fixed campaigns materialise once; recipients who lost consent or got
blocked become `suppressed`; a sent recipient of a `laufend` campaign re-enters after `reentry_days` as a new cycle.
Recipients refreshed here get `last_synced_at = now()` (the retention clock of `CAMPAIGN_CONTACT_RETENTION_DAYS`).
Nothing is drafted or sent. Fail-closed: when the audience query fails, nobody is excluded.
**2026-10-03 (migration 0074):** a campaign with a letter mode refreshes its `campaign_letters` in the same call
(`refreshCampaignLetters`, KAM-115). The refresh gets the budget minus 60 s; the rest goes to
`nightlyLetterAddresses` — the shipping address of the latest completed order for open letters of active campaigns
(not the Einzelansprache) with a letter mode, up to `CAMPAIGN_LETTER_ADDRESS_NIGHTLY` (default 200, max 2000, 0 = off)
per night, 50 per Shopify call; nothing while `PHYSICAL_MAIL_SENDS_APPROVED` is off. The response adds
`letterAddresses {filled, checked}`.

### 1.10 `/api/cron/shopify-sync` — `src/app/api/cron/shopify-sync/route.ts` (new 2026-10)

Every 5 minutes: `processShopifyOutbox({limit: 100, deadlineMs: +40 s})` — `consent_update` (Mo-side consent changes,
`SHOPIFY_CONSENT_WRITEBACK`), `customer_create` (Mo-only subscribers after DOI or the Erstabgleich, same flag),
`data_erasure` (consent off, then `customerRequestDataErasure`, `SHOPIFY_ERASURE_SYNC`; an erasure also queues its own `consent_update` to unsubscribed, so the write-back flag alone stops Shopify mailers), **2026-10 follow-up:** `writeback` (Mo's `mo-` tags, `tagsAdd` / `tagsRemove` with at most 20 `mo-` tags each, then mirrored into `customers.shopify_tags`; `SHOPIFY_WRITEBACK_ENABLED`); retries with backoff
(`planOutboxRetry`), `dead` after 8 attempts or a permanent user error (`isPermanentUserError`), shown in
Einstellungen (EIN-09). Then, while an import runs, `runCustomerImportStep` until the 100-s budget is spent or the
import waits / is done. With all flags off it is a no-op.

### 1.11 `/api/cron/inbox` — `src/app/api/cron/inbox/route.ts` (new 2026-10)

Hourly at :20: `runInboxSignals({deadlineMs: +240 s})` (`src/lib/inbox-signals.ts`): fact signals
(`signalsForCustomer` over `customer_facts`) and event signals (expiring clicked offers, cancellations / refunds, hard
bounces of recent buyers) → `capSignals` → `upsertInboxItems` (by dedupe key — snoozed or dismissed items are not
recreated), `closeStaleInboxItems` (`erledigt_von_selbst`), `expireInboxItems` (`abgelaufen`), **2026-10 follow-up:** `reopenDueSnoozed` (snoozes whose time is up become `offen`; the Eingang screen does the same before it lists, the sidebar badge only counts them), the 14-day outcomes of
decided items (orders and revenue after the decision), then `suggestForInboxItems` up to `INBOX_AI_DAILY_LIMIT` per
Berlin day (0 = off; needs `ANTHROPIC_API_KEY`). Never sends.

### 1.12 `/api/cron/release-campaign-mails` — `src/app/api/cron/release-campaign-mails/route.ts` (new 2026-10-03)

„Einplanen“ (migration 0072, KAM-107…109): every 10 minutes `releaseDueCampaignMails({deadlineMs: +240 s})`
(`src/lib/campaign-release.ts`, rules in the tested `campaign-release-core.mjs`) sends the campaign mails approved on
the desk whose release time has come — one at a time through `approveAndSendCampaign`, so every legal gate runs again
at send time; at most `CAMPAIGN_RELEASE_MAX_PER_RUN` (default 30, 1–200) per run, `CAMPAIGN_RELEASE_SPACING_MS`
(default 1500, 500–60000) apart. A mail that changed after the approval (fingerprint), whose set expired or that a gate
refuses goes back to the review queue with the reason (`release_error`); nothing is retried automatically. Rows a
timeout left in `sending` are recovered. Does nothing unless `CAMPAIGN_RELEASE_ENABLED` is on (default off). 503
without a database; `{ok, …result}`. Owner: [`CAMPAIGNS.md`](./CAMPAIGNS.md) §5 („Einplanen“); legal note
[`ANWALTSDOSSIER.md`](./ANWALTSDOSSIER.md) §17 (F-33).

### 1.7 Scheduled / background work that is NOT a Vercel cron

| Mechanism | Where | What it does | Bounds / risks |
|---|---|---|---|
| **Next `after()`** (post-response background work) — **❌ removed 2026-09 (TECH-E3)** | formerly `src/app/admin/page.tsx` on every `/admin` render | The address auto-capture runs only in the nightly `/api/cron/refresh-customers` (1.2, 12 customers per run, gated by `PHYSICAL_MAIL_SENDS_APPROVED`); `src/` has no `after()` call left. | – |
| **Client-driven stepping loop — Komplettanalyse** | `src/app/admin/analytics/ReportProgressDriver.tsx` (`useStepLoop`, `src/app/admin/lib/use-step-loop.ts`) → `POST /api/admin/analytics/step` (`src/app/api/admin/analytics/step/route.ts`, maxDuration 60) → `stepReport(id)` (`src/lib/analytics-report-generate.ts`). | One step after another until `done`; each response advances one phase chunk (analyze → insights → personas → customer_synthesis → customer_profiles → assemble). `useStepLoop`: network failures retried every 5 s up to 60 times in a row („reconnecting“), a non-2xx answer stops with the server's message and offers a manual resume, pause/resume, unmounting stops (the report stays resumable). | No server-side claim: two tabs stepping the same report concurrently would both do model work (the improvement loop fixed exactly this with migration 0045; the report stepper did not get the same fix). Report stays `running` server-side if the tab closes — resumable, nothing cleans up abandoned `running` reports except `ANALYTICS_REPORT_RETENTION_DAYS`. |
| **Client-driven stepping loop — Verbesserung (improvement run)** | `src/app/admin/verbesserung/RunView.tsx` (`RunDriver`, `useStepLoop`) → `POST /api/admin/improve/step` (`src/app/api/admin/improve/step/route.ts`, maxDuration **300**) → `stepImprovementRun(id)` (`src/lib/improvement-generate.ts`). | The same `useStepLoop`: network errors retried every 5 s up to 60 times (~5 min); server returns `busy:true` when another step holds the per-run claim (`claimRunStep`, `src/lib/improvement-store.ts`, migration 0045, `STEP_CLAIM_TTL_MINUTES = 6` at) and the client polls every 5 s. | Each step is ONE Sonnet call; the run is created by `POST /api/admin/improve/run`. An abandoned run stays `running`; the claim goes stale after 6 min so a later "Fortsetzen" click resumes it. |
| **Batch-until-empty admin actions (manual re-click, no loop)** | `POST /api/admin/conversations/analyze-bulk` (`route.ts` maxDuration 60, `BULK_ANALYZE_LIMIT` per call, response reports `remaining`; UI `gespraeche/StatsPanel.tsx` shows "noch N offen (erneut ausführen)"); `POST /api/admin/qa/scan` (`route.ts` maxDuration 300, `limit` ≤15 per call; UI `wissen/useQaQueue.ts`); `POST /api/admin/campaign/prepare` (`route.ts` maxDuration 300, ≤50 per request; header comment: "deliberately no cron"). | All explicitly human-triggered because they spend model tokens. | None are scheduled. The desk's „Vorbereiten…“ (`kampagne/useCampaignActions.ts`) is the one client-side chunk loop: `/prepare` in chunks of `PREPARE_CHUNK` (5) up to the chosen count (default `PREPARE_TOTAL` = 50) until `exhausted`, then the optional hero step — no page reload. |
| **Debounced autosave timers** | `kampagne/useCampaignActions.ts` (`saveTimers`), `analytics/GenerateReportPanel.tsx`, `ui/product-picker.tsx` — plain `setTimeout` debounces, not background jobs. | — | — |
| **Long-running single requests (not loops)** | `POST /api/admin/conversations/insights` (maxDuration 300, two Sonnet passes), `POST /api/admin/campaign/sync` (300; same `syncCampaignAudience` as cron 2 — **❌ retired 2026-10**), `POST /api/admin/email-hero/generate` (300), `/api/chat` (300). **2026-10:** `POST /api/admin/campaigns/status\|update\|refresh` (120; audience materialisation), `POST /api/admin/campaigns/add-recipient` and `POST /api/admin/inbox/accept` (120; one draft). | Manual only. | — |
| **Client-driven stepping loop — Shopify import (2026-10)** | `einstellungen/ShopifySyncCard.tsx` (`useStepLoop`, 4-s poll while Shopify prepares) → `POST /api/admin/shopify/import {action:"step"}` (90-s deadline) → `runCustomerImportStep` (`src/lib/shopify-sync.ts`). | Bulk operations for customers, then orders; JSONL read in 4 MB chunks from a stored byte offset (`shopify-bulk-core.mjs`), resumable. | The 5-minute cron `/api/cron/shopify-sync` continues a started import when the page is closed. |
| **Inline outbox flush (2026-10)** | `runOutboxInline(ids)` after a consent act (`consent-flows.ts`) or an erasure (`customer-erasure.ts`). | Tries the new Shopify writes at once; whatever fails stays for the 5-minute cron. | Gated by the outbox flags; never blocks the caller. |

**2026-10:** the Shopify write-back outbox (`shopify_outbox`, `src/lib/shopify-outbox.ts`, `outbox-core.mjs`: backoff, dead after 8 attempts, idempotency keys) is now the one queue — drained by `/api/cron/shopify-sync` and inline after consent acts / erasures.

There is **no** `after()`, `waitUntil`, `setInterval` or other scheduler in `src/` besides the Shopify outbox above. Inbound webhooks (`/api/webhooks/{shopify,resend,pingen}`, `/api/inbound/resend`) are
event-driven, not scheduled, and are out of scope for this section.

---

# 4. Scripts (`scripts/*.mjs`, 23 files)

Legend — **Prod impact**: what the script can do to shared/production state when run with production env.
"Local files only" = writes inside the repo checkout / cwd, nothing remote. (†) see the footnote below the table.

| Script | Purpose | Invocation | Required env (direct) | Prod impact | Docs that name it | package.json entry |
|---|---|---|---|---|---|---|
| `analyze-repurchase.mjs` | Repurchase-behaviour analysis over Shopify order history: repeat rate per value tier, inter-order intervals, accessory follow-up rate, decay by window. Stats live in `src/lib/repurchase-analysis.mjs`. Flags `--since`, `--max-orders`, `--page-size`, `--json <path>`, `--occasion-gap`. | `npm run analyze:repurchase [-- flags]` (`node --env-file=.env`) | `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_API_VERSION` (REQUIRED check) | **Read-only** (`orders` GraphQL queries; header). Optional local JSON of aggregates. Uses shop API cost budget (`shopify-throttle.mjs`). | CAMPAIGNS.md, REPURCHASE_ANALYSIS.md, README.md | `analyze:repurchase` |
| `backfill-customer-profiles.mjs` | First full build of the AI customer profiles: calls the deployed `/api/cron/refresh-customers?only=profiles` in a loop (time-bounded batches) until nothing is left or a round makes no progress; `--batch=N` (default 30, max 200), `--max=N`. | `npm run profiles:backfill [-- --batch=40 --max=500]` | `PUBLIC_BASE_URL`, `CRON_SECRET` | **Production:** each call runs the profile upkeep there (deep tier, ≈ $0.10 per profile; `customers` writes) | CUSTOMERS.md, README.md | `profiles:backfill` |
| `build-countdown-sprite.mjs` | Pre-renders countdown glyph PNGs (digits, DE/EN labels) with `sharp` into `src/lib/generated/countdown-sprite.mjs` so `/api/email-countdown` needs no system font. | `node scripts/build-countdown-sprite.mjs` (manual; commit output) | none (needs Liberation Sans installed locally) | Local files only | EMAIL_DESIGNS.md | **none** |
| `build-embeddings.mjs` | Embeds `src/data/product-catalog.json` with OpenAI `text-embedding-3-small` (chunks of 100) into `src/data/product-embeddings.json` (same `buildEmbeddingDoc` as the cron). | `npm run index` (plain `node`, no `--env-file` → export `OPENAI_API_KEY` yourself) | `OPENAI_API_KEY` | Local file write; **spends OpenAI credits** (~$0.001). | CATALOG_SYNC.md, README.md | `index` |
| `convert-catalog.mjs` | Converts the committed Shopify CSV export (`src/data/products_export_1.csv`) into `product-catalog.json` (filter: published, price>0, has image, active, not gift card). | `npm run convert-catalog` (`INPUT=`/`OUTPUT=` override) | optional `INPUT`, `OUTPUT` | Local files only | CATALOG_SYNC.md, README.md | `convert-catalog` |
| `dev-neon-proxy.mjs` | Local Neon-protocol proxy: speaks the Neon serverless SQL-over-HTTP protocol on `http://127.0.0.1:4444/sql` and forwards each query to a plain Postgres via `pg`, so the app runs against a local database (`NEON_FETCH_ENDPOINT`). Development only. | `npm run db:proxy` | `PORT` (4444), `PROXY_LOG` (optional query log); the app side sets `NEON_FETCH_ENDPOINT` + `DATABASE_URL` | Local only (never point it at a production database) | DATABASE.md, README.md | `db:proxy` |
| `diagnose-address.mjs` | For ONE e-mail: shows exactly what Shopify returns (defaultAddress + completed orders' shippingAddress) and what `lib/postal-address` would store. Note: carries a **local copy** of the completed-purchase status check because it cannot import the TS helper — drift risk vs `src/lib/shopify-orders.ts`. | `npm run diagnose:address -- someone@example.com` | `SHOPIFY_*` four vars | **Read-only** Shopify (customer + orders by e-mail → PII printed to the terminal); no DB. | README.md | `diagnose:address` |
| `gen-prompt-golden.mjs` | Regenerates `src/lib/system-prompt-core.de.golden.txt` from the shared fixtures after an intentional German prompt change (guards `system-prompt-core.test.mjs`). | `node scripts/gen-prompt-golden.mjs` | none | Local file only | none | **none** |
| `hero-gradient.mjs` | Applies the Performance-hero legibility gradient (`email-hero-gradient.mjs`) to any picture — for preparing `public/email-hero-default.jpg`. | `npm run hero:gradient -- <in> <out.png>` | none | Local files only | EMAIL_DESIGNS.md, README.md | `hero:gradient` |
| `hero-quality-compare.mjs` | Renders stored hero prompts in several variants (quality level, ±catalogue reference photos) through the production pipeline and writes a side-by-side HTML sheet to `./hero-compare*/` (git-ignored). `--dry-run` skips API calls. | `npm run hero:compare [-- --count N \| --prompts f \| --variants … \| --out dir \| --dry-run]` | `OPENAI_API_KEY`, `DATABASE_URL` unless `--prompts`; `ANTHROPIC_API_KEY` optional (QA check via `heroQaEnabled(process.env)`) | **DB read-only** (`SELECT … FROM campaign_contacts / marketing_sends`, includes `purchase_summary` PII in memory); **spends OpenAI image + Anthropic credits** (real cost is printed); writes local files only. | EMAIL_DESIGNS.md, README.md | `hero:compare` |
| `list-test-discounts.mjs` | Lists all Shopify discount codes minted by the app (prefix `MS5-`); `--delete` deletes them after an interactive confirmation (`discountCodeDelete`). | `node --env-file=.env.local scripts/list-test-discounts.mjs [--delete]` (header uses `.env.local`, every other script says `.env`) | `SHOPIFY_*` four vars | Default read-only; **`--delete` deletes live Shopify discount codes** (`write_discounts`). A customer holding an un-redeemed MS5- code from a real marketing send would lose it. | README.md | **none** |
| `migrate.mjs` | Forward-only SQL migration runner (part 6, „4.2 Migrations“). | `npm run db:migrate` / `DATABASE_URL=… node scripts/migrate.mjs` | one of `DATABASE_URL_UNPOOLED`, `POSTGRES_URL_NON_POOLING`, `DATABASE_URL`, `POSTGRES_URL` | **DDL on the target DB** + `INSERT INTO _migrations`. | ADMIN_DASHBOARD.md, CUSTOMER_ACCOUNT.md, DATABASE.md, ORDER_ATTRIBUTION.md, ROLLOUT_TODO.md, README.md | `db:migrate` |
| `preview-summary-email.mjs` | Renders the consultation-summary e-mail with 2 real catalog products to `preview-summary-email.{html,txt}` in the repo root (git-ignored). | `npx tsx scripts/preview-summary-email.mjs` — imports `../src/lib/summary-email.ts` (†) | none | Local files only | README.md | **none** |
| `probe-bundle.mjs` — **❌ removed 2026-09 (D-9)** | Throwaway verification probe of the bundle spike (created and archived one disposable Shopify bundle product). Results kept in `archive/BUNDLES_SPIKE.md`. | – | – | – | – | – |
| `reset-test-data.mjs` | `TRUNCATE … RESTART IDENTITY CASCADE` of every data table; prints host/db first; completeness guard cross-checks `DATA_TABLES` against `information_schema` and **aborts** if the live DB has an unlisted table. | `ALLOW_DB_RESET=true npm run db:reset` | `ALLOW_DB_RESET=true` gate, DB URL (same 4-way fallback as migrate) | **Destroys all data in the target DB.** `_migrations` preserved. **Currently unusable against a fully-migrated DB**: `DATA_TABLES` is "current through migration 0031" — every table added by 0032–0055 (analytics_reports, campaign_contacts, campaign_sends, qa_entries, mo_orders, mo_attribution_tokens, improvement_runs/…, email_templates, email_design_selections, email_hero_images, …) is unlisted, so the guard exits 1. Safe failure mode, but the script is dead until the list is updated. | DATABASE.md, ROLLOUT_TODO.md, README.md | `db:reset` |
| `send-test-emails.mjs` | Sends one `[TEST]` e-mail of every redesigned type (summary, DOI, marketing, campaign) to a recipient through the real `sendEmail()`. | `npx tsx --env-file=.env scripts/send-test-emails.mjs [recipient]` (†) | `RESEND_API_KEY`, `CONTACT_FROM_EMAIL` indirectly via `src/lib/email.ts` (`isEmailConfigured()` check) | **Sends real e-mail via Resend** (4 messages). Recipient defaults to a hard-coded personal address. No DB, no discount minting. | README.md | **none** |
| `setup-qa-metafield.mjs` | One-shot: creates the PRODUCT metafield definition `custom.qa` (json, storefront-visible) for the "Wissen" Q&A publish path. Idempotent (`TAKEN` → exit 0). | `node --env-file=.env scripts/setup-qa-metafield.mjs` | `SHOPIFY_*` four vars | **Shopify write** (`metafieldDefinitionCreate`, needs `write_products`) — one-time setup. | none | **none** |
| `verify-customer-account.mjs` | Verify-first gate for Customer Account sign-in: discovery doc vs expected values, empirical public-client token probe, `prompt=none` probe. | `npm run verify:customer-account` | `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID`, `PUBLIC_BASE_URL`; optional `SHOPIFY_STOREFRONT_DOMAIN`, `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET` | Read-only (throwaway auth code, no sign-in completed). Hard-codes the live shop's issuer/endpoints. | CUSTOMER_ACCOUNT.md | `verify:customer-account` |
| `check-live-widget.mjs` (2026-10-04) | Which widget build the live shop serves: storefront HTML → `ms-chat-widget.js` → string-literal marker counts, whitespace-insensitive (survive Shopify's minification) → build (`widget-fingerprint.mjs`, tested against the theme repo's commits raw and minified); head script, `/cart` CTA-hiding style, App Proxy `/apps/chat/whoami` JSON, alarm when the proxy answers a widget that cannot redeem. Exit 1 on any failed check. **2026-10-05:** markers `ms-chat-ctx-last`, `ms-chat-optin-benefits` and (negative) `Rabattaktionen zuerst erfahren`; build row `tasks-2026-10-05` (served consent bullets, page context, token renewal; a half-applied build is unknown). **2026-10-06:** that row is theme `bc7fb5d` and the expected build (`current`; counts measured raw, whitespace-only and minified); `main-2026-10-04` (3e87341) and `fixes-minified` stay acceptable, no longer current — the script prints „Erwartet: …“ for them. | `npm run verify:widget` | none (public GETs; `--origin`) | Read-only, no cookies. | ADMIN_DASHBOARD.md, ROLLOUT_TODO.md, frontend/01-storefront-theme.md, frontend/02-widget-architecture.md, frontend/03-chat-protocol-and-rendering.md, frontend/04-accounts-sign-in-and-consent.md, frontend/05-engagement-and-kpi.md, frontend/06-commerce-and-storefront-integration.md, frontend/07-feature-and-kpi-playbook.md, frontend/README.md, README.md | `verify:widget` |
| `verify-live-kpis.mjs` (2026-10-04) | Read-only live checks after a widget release: sign-in chain + per-session diagnosis + sessions stuck between succeeded and linked, popup funnel, consent events, widget-sent `account_erased`, campaign chat starts per send, contact form by reason/session, order-status outcomes; **2026-10-05:** section 7 order attribution (pre-checks P1–P6) and 7b (V0 marker rows with writer session, V3 unresolved marked orders by reason/source with all-sessionless and allowed-keys flags, V4 orders rescued by the new window, tokens older than 37 days by source); **2026-10-05:** section 8 „Shop-Login-Erkennung“ (recognitions by proof / token / already signed in / code / reason without code, redeem join with new vs renewed and refused, the latest `livecheck-manual` rows, consent popup sessions per customer in 30 days against the cap of 3); **2026-10-05 (OI1/OI3):** section 3 lists opt-ins by source / outcome / variant / placement (older rows approximated from trigger / doiStatus) and DOI confirmations by source; **2026-10-05 (A3):** section 9 „Seitenkontext auf Produktseiten“ (`page_context_applied` by kind / applied / resolved / locale / share; with `--session <sid prefix>` one session's `page_context_applied`, `page_context_answered` and `product_cta_clicked {samePage}` rows); **2026-10-06:** `--session <sid prefix>` also lists that session's consent rows in section 3 (`consent_gate_*`, `email_capture_submitted`, `email_capture_marketing_opted_in` with surface / variant / placement / source / outcome / `variantMismatch`); diagnosis and popup funnel as in KPI-75/KPI-80, `livecheck-%` excluded. | `npm run verify:live` (`--since YYYY-MM-DD`, default 2026-10-04; `--session <prefix>` for sections 3 and 9) | `DATABASE_URL` | SELECT only; session ids shortened, no PII. | ADMIN_DASHBOARD.md, ORDER_ATTRIBUTION.md, ROLLOUT_TODO.md, frontend/05-engagement-and-kpi.md, frontend/06-commerce-and-storefront-integration.md, frontend/07-feature-and-kpi-playbook.md, README.md | `verify:live` |
| `verify-pingen.mjs` | Verifies the Pingen integration without sending: env present, client-credentials token, `GET /organisations/{id}`, `GET /file-upload`. Prints whether `PHYSICAL_MAIL_SENDS_APPROVED` is on. | `npm run verify:pingen` | `PINGEN_CLIENT_ID`, `PINGEN_CLIENT_SECRET`, `PINGEN_ORGANISATION_ID`; reads `PINGEN_STAGING`, `PINGEN_WEBHOOK_SECRET` | Read-only | none | `verify:pingen` |
| `verify-shopify-auth.mjs` | Verifies the Admin API client-credentials grant and scope grants (`read_products`, `read_orders`, `write_discounts` via `currentAppInstallation.accessScopes`). Full error taxonomy in header. | `npm run verify:shopify` | `SHOPIFY_*` four vars | Read-only | CATALOG_SYNC.md, CUSTOMERS.md, README.md | `verify:shopify` |
| `register-shopify-webhooks.mjs` (new 2026-10) | Lists the webhook subscriptions Mo needs (catalog, orders, customers, consent, bulk import) against `<base>/api/webhooks/shopify`, checks the app's scopes (`read_inventory` for the stock webhook, `read_customers`, `write_customers`, `read_orders`, `read_all_orders`, …; a missing topic shows the scope it needs) lists the granted scopes, the count per topic (duplicates flagged) and same-topic subscriptions pointing elsewhere; with `--apply` creates the missing ones, with `--dedupe` deletes the extra copies of a topic at the endpoint (nothing else); reminds that the compliance topics are set in the app configuration. | `npm run shopify:webhooks [-- --apply] [-- --dedupe] [-- --url https://…]` | `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_API_VERSION`; `PUBLIC_BASE_URL` or `--url` | Dry run read-only; **`--apply` creates webhook subscriptions in the live store** (`webhookSubscriptionCreate`); **`--dedupe` deletes duplicate ones** (`webhookSubscriptionDelete`). | BUNDLES.md, CATALOG_SYNC.md, archive/CUSTOMER_PLATFORM_PLAN.md, ORDER_ATTRIBUTION.md, ROLLOUT_TODO.md, README.md | `shopify:webhooks` |
| `seed-dev.mjs` (2026-10 extended) | Deterministic German demo data for a LOCAL database; since 2026-10 also the customer platform: campaigns (Lebenszyklus, Einzelansprache, Black Friday, a finished Aktion), Shopify-mirrored customers with the one consent, `customer_orders`, `customer_facts` (real core), `consent_events`, `inbox_items` (real signal rules), `shopify_sync_runs`, `shopify_webhook_events`, `shopify_outbox`. | `npm run db:seed [-- --reset]` | DB URL (same fallback chain as migrate), optional `NEON_FETCH_ENDPOINT` | Refuses non-local hosts unless `--i-know-this-is-not-production`; `--reset` TRUNCATEs the seeded tables. | DATABASE.md, ROLLOUT_TODO.md, README.md | `db:seed` |

(†) These two import `../src/lib/*.ts` modules with extensionless imports; their headers say `npx tsx …` (`tsx` is not a dependency — `npx` fetches it). All other scripts import only `.mjs` cores and run under plain Node.

### 2.1 Scripts without a package.json entry

`build-countdown-sprite.mjs` (named in `EMAIL_DESIGNS.md`), `gen-prompt-golden.mjs` (named only in its header and in
`system-prompt-core.test.mjs`), `list-test-discounts.mjs`, `preview-summary-email.mjs` and `send-test-emails.mjs`
(the three manual helpers in README → Scripts), `setup-qa-metafield.mjs` (one-time Shopify setup for Wissen; named
only in its header). The 2026-09-08 orphan findings are archived ([archive](./archive/FEATURE_INVENTORY_AUDIT_2026-09.md) §D.6).

### 2.2 Scripts that touch production data (summary)

| Class | Scripts |
|---|---|
| DB DDL / destructive | `migrate.mjs` (DDL + `_migrations` insert), `reset-test-data.mjs` (TRUNCATE all; gated) |
| DB read (PII in memory) | `hero-quality-compare.mjs`, `verify-live-kpis.mjs` (ids and enums only, session ids shortened) |
| Shopify writes | `setup-qa-metafield.mjs` (metafield definition), `list-test-discounts.mjs --delete` (delete discount codes), `register-shopify-webhooks.mjs --apply` (webhook subscriptions, 2026-10) |
| Shopify reads incl. customer PII | `diagnose-address.mjs`, `analyze-repurchase.mjs` (ids only), `verify-shopify-auth.mjs`, `hero-quality-compare.mjs` (product images) |
| E-mail sends | `send-test-emails.mjs` (Resend, 4 mails to one recipient) |
| Public HTTP reads | `check-live-widget.mjs` (storefront HTML and the widget script; no secrets, no cookies) |
| Paid AI calls | `build-embeddings.mjs` (OpenAI), `hero-quality-compare.mjs` (OpenAI images + optional Anthropic), `backfill-customer-profiles.mjs` (through the production cron) |
| Local only | `build-countdown-sprite.mjs`, `convert-catalog.mjs`, `dev-neon-proxy.mjs`, `gen-prompt-golden.mjs`, `hero-gradient.mjs`, `preview-summary-email.mjs`, `seed-dev.mjs` (refuses a non-local database), `verify-pingen.mjs`, `verify-customer-account.mjs` |

---

# 5. Environment variables

[`.env.example`](../.env.example) is the source for every runtime variable — default, purpose and allowed values
(113 active keys). This table is the checklist of what the code reads, with the reader and the code default;
script-only (S), test-only and platform-injected (P) names are not in `.env.example`. The legal send gates
(`CAMPAIGN_SENDS_APPROVED`, `CAMPAIGN_ALLOW_SINGLE_OPT_IN`, `PHYSICAL_MAIL_SENDS_APPROVED`) default to `false` in code and
in `.env.example` (D-8); every retention window treats `0` as „disabled“ (`src/lib/retention-options.mjs`). Names were
collected from `process.env.X`, the indirect readers (`parseIntEnv("X", …)`, the cron-local `intEnv("X")`, `env("X")` in
`shopify.ts`, `envTrim("X")`, the `.mjs` helpers that take `env = process.env`, `w("X")` in `retention-options.mjs`) and
the scripts' `REQUIRED` arrays.

Additions since the baseline:
- **2026-10-01:** +11 names for the customer platform, all read through `src/lib/platform-flags.mjs` (`env = process.env`
parameter, tested) or `src/lib/retention-options.mjs`, all documented in `.env.example`; every switch that writes to
Shopify or widens what Mo does with personal data defaults to off / the conservative value (rows marked 2026-10).
- **2026-10 follow-up:** +1 — `SHOPIFY_WRITEBACK_ENABLED` (plan D-11), in `.env.example` with `false`.
- **2026-10-03 (order status in the chat):** +2 — `CHAT_ORDER_STATUS_ENABLED` (default `false`) and
`SHOPIFY_ACCOUNT_ORDERS_URL` (default the shop's account page), both in `.env.example`.
- **2026-10-03 („Einplanen“, 0072):** +3 — `CAMPAIGN_RELEASE_ENABLED` (default `false`), `CAMPAIGN_RELEASE_MAX_PER_RUN` (30),
`CAMPAIGN_RELEASE_SPACING_MS` (1500), all in `.env.example`.
- **2026-10-03 (letters as a campaign channel, 0074):** +3 — `LETTER_MIN_INTERVAL_DAYS` (60),
`CAMPAIGN_LETTER_ADDRESS_NIGHTLY` (200), `CAMPAIGN_LETTER_SHOP_URL` (empty → first allowed origin's host), all in
`.env.example`; the letter gate stays `PHYSICAL_MAIL_SENDS_APPROVED`.
- **2026-10-05 (order attribution, 0076):** +1 — `MO_ATTRIBUTION_SESSION_ANCHOR` (default `false`), in `.env.example`.
- **2026-10-05 (shop-login recognition, P0.3):** +2 — `APP_PROXY_SIGNIN_ENABLED` (default `false`) and
`APP_PROXY_SIGNIN_MAX_AGE_HOURS` (default `0`), both in `.env.example`.
- **2026-10-05 (consent framing, page context):** +3 — `CONSENT_SIGNIN_VARIANTS` (default `a`),
`CHAT_PAGE_CONTEXT_ENABLED` (default `false`) and `CHAT_PAGE_CONTEXT_HOLDOUT_PCT` (default `0`), all in `.env.example`.

Columns: **.env.ex** = present as an active key in `.env.example`, with the shipped value in brackets (`c` = only
mentioned in a comment); **Req** = R required for the feature to work at all (fail-closed / throws), O optional with a
code default, P platform-injected (Vercel/Neon/Upstash), S script/CLI-only.

| Variable | Used in | .env.ex | Default / fallback in code | Req | Notes |
|---|---|---|---|---|---|
| `ABANDON_AFTER_MINUTES` | `retention-options.mjs` (via `retentionOptionsFromEnv` in `retention.ts`) | yes (30) | 30 (min 0) | O | retention cron |
| `ADMIN_ACCESS_LOG_RETENTION_DAYS` | `retention-options.mjs` (via `retentionOptionsFromEnv` in `retention.ts`) | yes (730) | 730; 0 disables | O | |
| `ADMIN_PASSWORD` | `src/lib/admin-auth.ts` | yes (empty) | none → admin login disabled (fails closed) | R (admin) |  |
| `ADMIN_SESSION_SECRET` | `admin-auth.ts` | yes (empty) | falls back to `CHAT_SHARED_SECRET` | O | |
| `ALLOWED_ORIGINS` | `src/lib/security.ts` | yes | `https://www.motionsports.de,https://motionsports.de` (`security.ts`) | O | |
| `ALLOW_DB_RESET` | `scripts/reset-test-data.mjs` | no | must be literally `true` | S | safety gate |
| `ANALYTICS_REPORT_RETENTION_DAYS` | `retention-options.mjs` (via `retentionOptionsFromEnv` in `retention.ts`) | yes (365) | 365; 0 disables | O |  |
| `APP_PROXY_SIGNIN_ENABLED` (2026-10-05) | `platform-flags.mjs` `isAppProxySigninEnabled` → `api/auth/storefront/route.ts`, `signed-in-session.ts` | yes (false) | false | O (kill switch) | off: whoami issues no code and answers `{signedIn:false}`, still records `account_shop_recognised`; also zeroes the shop proof. Recommended `true` once the App Proxy is configured (D-AP1) |
| `APP_PROXY_SIGNIN_MAX_AGE_HOURS` (2026-10-05) | `platform-flags.mjs` `appProxySigninMaxAgeHours` / `appProxyShopProofHours` → storefront route, `signed-in-session.ts`, `api/auth/link` | yes (0) | 0 (invalid → 0, clamped 720) | O | > 0: an `app_proxy` link counts as signed in without a chat token for that many hours after its last redeem (every new tab renews); effective 0 while `APP_PROXY_SIGNIN_ENABLED` is off. Recommended 24 (D-AP1, 05.10.2026) |
| `ANTHROPIC_API_KEY` | 16 sites: `analytics-report-generate.ts`, `bundle-suggestion.ts`, `campaign-draft.ts`, `conversation-analysis.ts`, `conversation-insights.ts`, `customer-profile.ts`, `email-hero.ts`, `email-hero-qa.mjs`, `improvement-generate.ts`, `kpi-top-questions.ts`, `marketing-draft.ts`, `qa-draft.ts`, `qa-translate.ts`, `summary-email.ts`; `/api/chat` via `@ai-sdk/anthropic` implicitly | yes (empty) | none; most callers degrade to a fallback draft / `unconfigured` | R (chat) | |
| `BLOB_READ_WRITE_TOKEN` | `catalog-store.ts`, `catalog-mutate.ts`, `email-hero.ts`, `cron/sync-catalog/route.ts`, `api/email-hero-image/[file]/route.ts` | yes (empty) | unset → bundled JSON catalog; hero generation disabled | O (P on Vercel) | |
| `BUNDLE_CREATION_MODE` | `bundle-offers.ts` → `resolveBundleCreationMode` (`bundle-offer-core.mjs`) | yes (native_fixed_bundle) | `native_fixed_bundle`; unknown value → default | O | |
| `BUNDLE_EXPIRED_REDIRECT_URL` | `api/r/[token]/route.ts` | yes (empty) | `SHOP_DOMAIN` (storefront root) | O | |
| `BUNDLE_OFFER_EXPIRY_DAYS` | `bundle-offers.ts` | yes (7) | 7 | O | |
| `CAMPAIGN_AUTO_PREPARE_COUNT` / `CAMPAIGN_AUTO_PREPARE_DISCOUNT` / `CAMPAIGN_AUTO_PREPARE_TEXT_MODE` / `CAMPAIGN_AUTO_PREPARE_DISCOUNT_SCOPE` | `campaign-flags.mjs` `campaignAutoPrepareConfig` → `/api/cron/prepare-campaign-drafts` | yes (0 / 0 / compact / all) | 0 (cron skips) / 0 % / `compact` / `all` | O (costs API money) | nightly draft budget across live campaigns; the other three apply to the Lebenszyklus fallback (§2.5) |
| `CAMPAIGN_ALLOW_SINGLE_OPT_IN` | `campaign-flags.mjs` | yes (**false**) | false (fail-closed; only 1/true/yes/on) | O (legal gate) | legal gate; `.env.example` ships `false` like the code (D-8) |
| `CAMPAIGN_CONTACT_RETENTION_DAYS` | `retention-options.mjs` (via `retentionOptionsFromEnv` in `retention.ts`) | yes (365) | 365; 0 disables | O | 2026-10: campaign recipients by last audience refresh / creation (`last_synced_at` is refreshed by `campaign-audiences`). 2026-10-03: also `campaign_letters` by `updated_at` (counted with the recipients). |
| `CAMPAIGN_LETTER_ADDRESS_NIGHTLY` (2026-10-03) | `campaign-letter-core.mjs` `letterAddressNightly` → `campaign-letters.ts` (`nightlyLetterAddresses`, cron `campaign-audiences`) | yes (200) | 200; max 2000; 0 = off (only the desk's „Adressen holen“) | O | purchase addresses fetched per night for open campaign letters |
| `CAMPAIGN_LETTER_SHOP_URL` (2026-10-03) | `campaign-letter-draft.ts` `shopUrlForLetters` | yes (empty) | host of the first `ALLOWED_ORIGINS` entry, else `www.motionsports.de` | O | shop address the AI letter draft may name as plain text |
| `CAMPAIGN_MO_DEEPLINK_URL` | `campaign-flags.mjs` | yes | `https://motionsports.de/?mo=open&mo_new=1&mo_view=fullscreen&utm_source=campaign&utm_medium=email` | O | identical default in code and example |
| `CAMPAIGN_RELEASE_ENABLED` (2026-10-03) | `campaign-flags.mjs` `isCampaignReleaseEnabled` → `campaign-release.ts` (approve + release job), `KampagneTab.tsx`, `EinstellungenTab.tsx` | yes (false) | false (only 1/true/yes/on) | O | „Einplanen“ and `/api/cron/release-campaign-mails` (KAM-107…109); off: no approval, the job sends nothing |
| `CAMPAIGN_RELEASE_MAX_PER_RUN` / `CAMPAIGN_RELEASE_SPACING_MS` (2026-10-03) | `campaign-flags.mjs` `campaignReleaseConfig` → `campaign-release.ts` | yes (30 / 1500) | 30 (1–200) / 1500 ms (500–60000) | O | pace of the release job (Resend allows about 2 requests/s shared with every other mail) |
| `CAMPAIGN_SENDS_APPROVED` | `campaign-flags.mjs` | yes (**false**) | false (fail-closed) | O (legal gate) | master send gate for Kampagne; `.env.example` ships `false` (D-8) |
| `CHAT_ORDER_STATUS_ENABLED` (2026-10-03) | `platform-flags.mjs` `isChatOrderStatusEnabled` → `api/chat/route.ts` (`activeTools`, prompt flag, contact-form copy variant), `order-status.ts` (gate) | yes (false) | false (fail closed; only 1/true/yes/on) | O (widens what Mo does with personal data) | order status in the chat (`get_order_status`); off → tool withheld, prompt byte-identical. Turn on after lawyer F-32 and a silent-widget check (`ROLLOUT_TODO.md`) |
| `CHAT_ORDER_STATUS_TEST_CUSTOMERS` (2026-10-04) | `platform-flags.mjs` `chatOrderStatusTestCustomers` → `order-status.ts` `isOrderStatusTestSession` / `isOrderStatusEnabledFor` (chat route + access gate) | yes (empty) | empty = nobody | O | Shopify customer ids (digits or GID, ≤20) for whom the order status works while the switch is off — only a Customer-Account sign-in of this session; the live check before switching it on for everyone |
| `CHAT_PAGE_CONTEXT_ENABLED` (2026-10-05) | `platform-flags.mjs` `isChatPageContextEnabled` → `api/chat/route.ts` (`planPageContext`, `page-context.mjs`) | yes (false) | false (only 1/true/yes/on) | O | off: a `context.source:"page"` is ignored (today's typed-turn behaviour) but still recorded as `page_context_applied {applied:false, pct:100}`. Turn on only after `npm run verify:widget` shows the page-context build (`ms-chat-ctx-last`; row `tasks-2026-10-05`, theme `bc7fb5d`) and 2–3 days of observation. CTA and nudge context never affected |
| `CHAT_PAGE_CONTEXT_HOLDOUT_PCT` (2026-10-05) | `page-context.ts` `pageContextHoldoutPct` → `parseHoldoutPct` (`page-context.mjs`) → `api/chat/route.ts` | yes (0) | 0 (invalid / negative → 0, floored, max 50) | O | share of sessions (stable per session id) whose product-page context is deliberately ignored — the control group of „Seitenkontext auf Produktseiten“; set only with the switch on and `PAGE_CONTEXT_EXPERIMENT` pre-registered; back to 0 at the target size (max ~6 weeks); collection pages never held out |
| `CHAT_SHARED_SECRET` | `security.ts`; fallback for `admin-auth.ts`, `email-capture-store.ts`, `email-countdown-token.mjs`, `shopify-customer-account.ts` | yes (empty) | none → every `/api/chat`, `/api/contact`… request 401 | R | also the fallback signing key for 4 other secrets — rotating it invalidates admin sessions, unsubscribe links, countdown tokens and OAuth state unless the dedicated vars are set |
| `CONSENT_SIGNIN_VARIANTS` (2026-10-05) | `consent-variants.mjs` `parseActiveVariantIds` / `activeSigninVariants` / `pickSigninVariant` → `consent-copy.ts` (`signInMarketingConsentCopy`, `signInVariantsActive`) → `api/consent-copy`, `api/account/marketing-opt-in` | yes (a) | `a` (comma list; ids `^[a-z0-9_-]{1,32}$`; only defined and approved variants are served; empty set → `a`) | O | framing variants of the consent popup after a sign-in for an A/B test; more than one only after the widget with the served bullets is live and a second variant is approved; while > 1, `surface=signin` is `private, no-store` and assigned per `x-ms-session` |
| `CONTACT_FROM_EMAIL` | `email.ts`, `api/contact/route.ts` | yes (empty) | none → `isEmailConfigured()` false → all mail (summary/DOI/marketing/campaign/correspondence) disabled | R (e-mail) |  |
| `CONTACT_TO_EMAIL` | `api/contact/route.ts` | yes (empty) | none → contact form logs to stdout | O | |
| `CONVERSION_SWEEP_MAX_CODES` | `conversion-sweep.ts` | yes (25) | 25; 0 disables | O | retention cron sub-step |
| `CORRESPONDENCE_RETENTION_DAYS` | `retention-options.mjs` (via `retentionOptionsFromEnv` in `retention.ts`) | yes (365) | 365 | O | |
| `CRON_SECRET` | `cron-auth.ts` | yes (empty) | none → every cron returns 401 (fail closed) | R (crons) | ten crons (`vercel.json`, §3 1.1); the `.env.example` comment names nine — `/api/cron/release-campaign-mails` is missing there |
| `CUSTOMER_AI_PROFILE_SCOPE` (2026-10) | `platform-flags.mjs` `aiProfileScope` → `customer-profile.ts`, `customer-store.ts`, `customer-detail.ts` | yes (consented) | `consented`; only `all` widens | O (legal, Plan D-1) | `all`: profiles for people without consent are built but flagged, marketing actions stay blocked; an Art. 21 objection always wins (`mayBuildAiProfile`). The example notes the maintainer's decision `all` (lawyer to confirm) |
| `CUSTOMER_AUTH_PENDING_TTL_MINUTES` | `shopify-customer-account.ts` | yes (10) | 10 | O | |
| `CUSTOMER_INACTIVITY_RETENTION_DAYS` | `retention-options.mjs` (via `retentionOptionsFromEnv` in `retention.ts`) | yes (1095) | 1095; 0 disables | O | |
| `CUSTOMER_PROFILE_BATCH` | `cron/refresh-customers/route.ts` (`?batch=` overrides) | yes (30) | 30; 0 disables | O | Vollprofile per night (deep tier, ≈ $0.10 each) |
| `CUSTOMER_PROFILE_LIGHT_BATCH` (2026-10) | `platform-flags.mjs` `customerProfileLightBatch` (max 2000) → `cron/refresh-customers` | yes (0) | 0 = off | O | Kaufprofile per night (writer tier, ≈ $0.01 each) |
| `CUSTOMER_REFRESH_BATCH` | `cron/refresh-customers/route.ts` | yes (25) | 25 (min 1) | O | |
| `CUSTOMER_REFRESH_STALE_HOURS` | `cron/refresh-customers/route.ts` | yes (24) | 24 | O | |
| `DATABASE_URL` | `src/lib/db.ts`; `scripts/migrate.mjs`, `reset-test-data.mjs`, `hero-quality-compare.mjs` | yes (empty) | falls back to `POSTGRES_URL`; none → `getSql()` null, persistence disabled with one warning | R (everything but bare chat) (P) |  |
| `DATABASE_URL_UNPOOLED` | `scripts/migrate.mjs`, `reset-test-data.mjs` | yes (empty) | falls back to `POSTGRES_URL_NON_POOLING` → `DATABASE_URL` → `POSTGRES_URL` | S/P | scripts only; runtime never uses the unpooled URL |
| `EMAIL_AI_LABEL_ICON_URL` | `email-designs/performance.ts` | yes (empty) | `<base>/eu-ai-icon-email.png`; must be absolute http(s) | O | |
| `EMAIL_HERO_DEFAULT_URL` | `email-hero.ts` | yes (empty) | `<base>/email-hero-default.jpg` | O | |
| `EMAIL_HERO_IMAGE_MODEL` | `email-hero-variants.mjs` | yes (empty) | `gpt-image-2` | O | |
| `EMAIL_HERO_IMAGE_QUALITY` | `email-hero-variants.mjs` | yes (empty) | `high`; values low/medium/high | O | |
| `EMAIL_HERO_QA` | `email-hero-qa.mjs` | yes (empty) | on when `ANTHROPIC_API_KEY` set; `off` disables | O | |
| `EMAIL_HERO_REFERENCES` | `email-hero.ts` | yes (empty) | on; `off` disables | O | |
| `EMAIL_LOGO_URL` | `email-template.ts`, `src/app/admin/EinstellungenTab.tsx` | yes (empty) | theme logo → env → hard-coded Shopify CDN URL | O | shown in Einstellungen as the logo override |
| `EMAIL_MO_ICON_URL` | `email-template.ts` | yes (empty) | `<base>/moorb.gif` | O |  |
| `ERASURE_TOMBSTONE_RETENTION_DAYS` (2026-10) | `retention-options.mjs` | yes (30) | 30; 0 disables | O | retention step 9 — tombstones only after Shopify confirmed the redaction |
| `FEEDBACK_RETENTION_DAYS` | `retention-options.mjs` (via `retentionOptionsFromEnv` in `retention.ts`) | yes (365) | 365; 0 disables | O | |
| `INBOUND_EMAIL_ADDRESS` | `email-inbound.ts` | yes (empty) | none → outbound mail has no Reply-To | O | |
| `INBOX_AI_DAILY_LIMIT` (2026-10) | `platform-flags.mjs` `inboxAiDailyLimit` (max 500) → `inbox-signals.ts`, `inbox-suggest.ts` | yes (0) | 0 = off | O | AI suggestions per Berlin day by `/api/cron/inbox`; per-item requests count towards it |
| `INBOX_RETENTION_DAYS` (2026-10) | `retention-options.mjs` | yes (180) | 180; 0 disables | O | decided Eingang items: content cleared, marker kept up to two years (retention step 8) |
| `INPUT` / `OUTPUT` | `scripts/convert-catalog.mjs` | no | `src/data/products_export_1.csv` / `src/data/product-catalog.json` | S | |
| `KEEP_PROBE` | `scripts/probe-bundle.mjs` (removed) | no | unset (= archive after probe) | S | **❌ removed 2026-09** with `probe-bundle.mjs` (D-9) |
| `KPI_RETENTION_DAYS` | `retention-options.mjs` (via `retentionOptionsFromEnv` in `retention.ts`) | yes (180) | 180 | O | also governs ai_usage, insights, persona summaries, mo_orders |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | `src/lib/redis.ts`; `rate-limit.ts` via `getRedis()` | yes | none → `getRedis()` **throws** (`redis.ts`); `rate-limit.ts` uses the throwing variant | R (P) | `/api/chat`, `/api/products`, `/api/kpi`, `/api/tts`, `/api/feedback`, `/api/capture-email`, `/api/contact` all rate-limit → every one of them 500s without Redis; the admin login fails open (§2.9) |
| `LETTER_MIN_INTERVAL_DAYS` (2026-10-03) | `campaign-letter-core.mjs` `letterMinIntervalDays` → `campaign-letters.ts` (send gate + desk checks) | yes (60) | 60; 0 = no cadence check; invalid or > 3650 → 60 | O | days between two advertising letters to one person — counts every posted letter, 1:1 included |
| `MARKETING_DISCOUNT_EXPIRY_DAYS` | `shopify-discounts.ts` | yes (7) | 7 | O | |
| `MARKETING_DOI_EXPIRY_DAYS` | `email-capture-store.ts` | yes (7) | 7 | O | |
| `MARKETING_MIN_SEND_INTERVAL_DAYS` | `marketing-email.ts`, `campaign-email.ts` | yes (0) | 0 = disabled | O | |
| `MARKETING_ORDER_LOOKBACK_DAYS` | `shopify-orders.ts` | yes (180) | 180 | O | |
| `MODEL_PRICES_JSON` | `ai-pricing.mjs` | yes (empty) | built-in `DEFAULT_MODEL_PRICES` | O | |
| `MO_ATTRIBUTION_SESSION_ANCHOR` (2026-10-05) | `platform-flags.mjs` `isAttributionSessionAnchorEnabled` → `mo-orders-store.ts` (`ingestShopifyOrder` window anchor, `getMoAttributionKpis` `sessionAnchor`), `retention-options.mjs` (`attributionSessionAnchor`, `attributionTokenMaxDays`) → `retention.ts` step 5i | yes (false) | false (only 1/true/yes/on) | O (longer token life) | widget tokens: window from the device's latest product consultation, retention keeps the token while it consults (cap `KPI_RETENTION_DAYS`). Needs migration 0076 first. Owner decision 2026-10-05 (ANWALTSDOSSIER §20, F-37) |
| `MO_ATTRIBUTION_WINDOW_DAYS` | `mo-orders-store.ts`, `retention-options.mjs` | yes (30) | 30 (min 1) | O | **2026-10-05:** days from the anchor (minting, or with `MO_ATTRIBUTION_SESSION_ANCHOR` the latest product consultation for widget tokens) |
| `NEON_FETCH_ENDPOINT` | `src/lib/db.ts`; `scripts/migrate.mjs`, `seed-dev.mjs`, `verify-live-kpis.mjs` | yes (empty) | unset → Neon default endpoint | O (local dev only) | local development: points the Neon HTTP driver at `npm run db:proxy` ([`DATABASE.md`](./DATABASE.md) „Local database“) |
| `NEXT_PUBLIC_SENTRY_DSN` | `observability.ts` | yes (empty) | none → Sentry skipped, one-time warning | O (P) | |
| `NODE_ENV` | `admin-auth.ts` (cookie `secure`), `observability.ts` | no | — | P | |
| `OPENAI_API_KEY` | `retrieval.ts`, `catalog-mutate.ts`, `email-hero.ts`, `api/tts/route.ts`, `cron/sync-catalog/route.ts`; `scripts/build-embeddings.mjs`, `hero-quality-compare.mjs` | yes (empty) | none → keyword-only retrieval, no TTS, no embeddings sync, no hero images | R (retrieval quality) | embeddings (retrieval, catalog sync, Q&A answers), TTS, hero images |
| `PHYSICAL_LETTER_RETENTION_DAYS` | `retention-options.mjs` (via `retentionOptionsFromEnv` in `retention.ts`) | yes (365) | 365 | O | |
| `PHYSICAL_MAIL_SENDS_APPROVED` | `pingen-flag.mjs` (used by `physical-mail.ts`, `customer-refresh.ts`, `address-capture.ts`, `verify-pingen.mjs`) | yes (**false**) | false (fail-closed) | O (legal gate) | also gates postal-address *collection*. 2026-10-03: also the campaign letters (send gate 1, `postal-address-fill.ts`, `campaign-letters.ts` — no purchase address is fetched while off) |
| `PINGEN_CLIENT_ID` / `PINGEN_CLIENT_SECRET` / `PINGEN_ORGANISATION_ID` | `pingen.ts`; `scripts/verify-pingen.mjs` | yes | none → `isPingenConfigured()` false | R (letters) | |
| `PINGEN_LETTER_COST_CENTS` | `physical-letters-store.ts` | yes (106) | 106 | O | 2026-10-03: also `campaign-letters-store.ts` `letterCostCents` — postage estimate and spent budget of campaign letters where Pingen reported no price |
| `PINGEN_STAGING` | `pingen.ts`; `verify-pingen.mjs` | yes (true) | false = production | O | `.env.example` ships staging ON. 2026-10-03: `isPingenStaging()` → Callout „Pingen-Testumgebung“ in the view „Briefe“ |
| `PINGEN_WEBHOOK_SECRET` | `api/webhooks/pingen/route.ts`; `verify-pingen.mjs` | yes (empty) | none → webhook 503 (fail closed); comma-separated list | R (letter status) | |
| `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` | `db.ts`; `migrate.mjs`; `reset-test-data.mjs` | c (comment only) | legacy fallbacks | P | |
| `PORT` / `PROXY_LOG` | `scripts/dev-neon-proxy.mjs` | no | 4444 / unset | S | local proxy only |
| `PUBLIC_BASE_URL` | `base-url.ts`; `scripts/verify-customer-account.mjs` | yes (empty) | → `VERCEL_PROJECT_PRODUCTION_URL` → `VERCEL_URL` → request origin → `https://mo.motionsports.de` (`base-url.ts`; `chat.` until 2026-10-02) | R (correct links in e-mails / OAuth redirect) |  |
| `RESEND_API_KEY` | `email.ts`, `email-webhook.mjs` (placeholder), `api/contact/route.ts`, `api/inbound/resend/route.ts`, `api/admin/correspondence/message/route.ts` | yes (empty) | none → all e-mail disabled | R (e-mail) | |
| `RESEND_EVENTS_WEBHOOK_SECRET` | `api/webhooks/resend/route.ts` | yes (empty) | falls back to `RESEND_WEBHOOK_SECRET`; none → 503 | O | new in #186 |
| `RESEND_WEBHOOK_SECRET` | `email-inbound.ts`, `api/webhooks/resend/route.ts` | yes (empty) | none → `/api/inbound/resend` 503 | R (inbound mail) | |
| `RETENTION_DAYS` | `retention-options.mjs` (via `retentionOptionsFromEnv` in `retention.ts`) | yes (180) | 180 | O | |
| `RETURNING_HINT_ENABLED` | `consent-copy.ts` | yes (true) | true; `0/false/no/off` disables | O | |
| `SHOPIFY_ACCOUNT_ORDERS_URL` (2026-10-03) | `order-status-core.mjs` `accountOrdersUrl` → `order-status.ts` | yes (empty) | `https://www.motionsports.de/account`; https only, anything else → default | O | the generic „Meine Bestellungen“ link in Mo's order status answer (`ordersPageUrl`) |
| `SHOPIFY_API_VERSION` | `shopify.ts`; 5 scripts | yes (2026-04) | none → `isShopifyConfigured()` false; `env()` throws if called | R (Shopify) | |
| `SHOPIFY_APP_PROXY_SECRET` | `api/auth/storefront/route.ts` | yes (empty) | falls back to `SHOPIFY_CLIENT_SECRET` | O | signature secret of the App Proxy (shop-login recognition, PLT-03) |
| `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` | `shopify.ts`; `api/auth/storefront/route.ts`; 5 scripts | yes | none → Shopify disabled | R (Shopify) | 2026-10: the secret also verifies Shopify webhooks; the customer platform needs the scopes `read_customers`, `write_customers`, `read_orders`, `read_all_orders` (+ Protected Customer Data access) — checked by `npm run shopify:webhooks`. |
| `SHOPIFY_CONSENT_TEXT_VERSION` (2026-10) | `platform-flags.mjs` `shopifyConsentTextVersion` (≤ 40 chars) → `consent-store.ts` | yes (shopify-2026-10) | none (no version stamped) | O | stamped on consent acts that come from Shopify (`consent_events.text_version`) |
| `SHOPIFY_CONSENT_WRITEBACK` (2026-10) | `platform-flags.mjs` → `shopify-outbox.ts` (`consent_update`, `customer_create`), Einstellungen | yes (false) | false | O (writes to Shopify) | while off the outbox rows wait; turning it on flushes them |
| `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID` | `shopify-customer-account.ts`; `verify-customer-account.mjs` | yes (empty) | none → sign-in disabled | R (tier-3 sign-in) | |
| `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET` | `shopify-customer-account.ts`; `verify-customer-account.mjs` | yes (empty) | none = public PKCE client | O | |
| `SHOPIFY_CUSTOMER_ACCOUNT_STATE_SECRET` | `shopify-customer-account.ts` | yes (empty) | falls back to `CHAT_SHARED_SECRET` | O | |
| `SHOPIFY_CUSTOMER_SYNC_ENABLED` (2026-10) | `platform-flags.mjs` → `shopify-sync.ts` (import, reconcile), `/api/admin/shopify/import`, Kunden callout, Einstellungen | yes (false) | false | O | also gates the customer, consent and order-ledger webhooks (acknowledged without writing while off — `webhookNeedsCustomerSync` in `shopify-webhook.mjs`); deletions and compliance topics are always handled |
| `SHOPIFY_ERASURE_ALERT_PER_HOUR` (2026-10) | `platform-flags.mjs` `erasureAlertPerHour` → `shopify-webhook-customers.ts` | yes (20) | 20; 0 = no alert | O | more erasures from Shopify per hour → Sentry + Eingang item |
| `SHOPIFY_ERASURE_SYNC` (2026-10) | `platform-flags.mjs` → `shopify-outbox.ts` (`data_erasure`), `consent-copy.ts` (erase copy), Einstellungen | yes (false) | false | O (writes to Shopify) | an erasure in Mo asks Shopify to erase too |
| `SHOPIFY_STOREFRONT_DOMAIN` | `shopify-customer-account.ts`; `verify-customer-account.mjs` | yes (www.motionsports.de) | `www.motionsports.de` | O | |
| `SHOPIFY_STORE_DOMAIN` | `shopify.ts`; 5 scripts | yes (empty) | none | R (Shopify) | |
| `SHOPIFY_SYNC_LOG_RETENTION_DAYS` (2026-10) | `retention-options.mjs` | yes (90) | 90; 0 disables | O | retention step 7 (webhook dedupe rows, finished sync runs, done/dead outbox rows) |
| `SHOPIFY_WEBHOOK_SECRET` | `api/webhooks/shopify/route.ts` | yes (empty) | none → webhook 503 (fail closed) | R (stock + order webhooks) | a signature under `SHOPIFY_CLIENT_SECRET` is accepted too (app-made subscriptions, compliance topics); 503 only when neither is set |
| `SHOPIFY_WRITEBACK_ENABLED` (2026-10 follow-up) | `platform-flags.mjs` `isShopifyInsightsWritebackEnabled` → `shopify-insights.ts` (nightly queue), `shopify-outbox.ts` (`writeback`), `shopify-sync-flags.ts` (Einstellungen) | yes (false) | false | O (writes to Shopify) | Mo's `mo-…` customer tags (segment, value tier, Mo contact, high churn) via the outbox; the shop's own tags are never touched |
| `SUPPRESSED_CAPTURE_PURGE_DAYS` | `retention-options.mjs` (via `retentionOptionsFromEnv` in `retention.ts`) | yes (30) | 30 | O | |
| `TOKEN_ENC_KEY` | `token-crypto.ts` | yes (empty) | none → **throws** when a token must be stored (sign-in callback fails closed) | R (tier-3 sign-in) | |
| `TTS_INSTRUCTIONS` / `TTS_MODEL` / `TTS_SPEED` / `TTS_VOICE` | `api/tts/route.ts` | yes | German instruction / `gpt-4o-mini-tts` / 1.1 (clamped 0.25–4) / `coral` | O | |
| `TZ` | `admin-datetime.test.mjs`, `store-datetime.test.mjs` only | no | — | test-only | set by the tests themselves |
| `UNSUBSCRIBE_SECRET` | `email-capture-store.ts`, `email-countdown-token.mjs` | yes (empty) | falls back to `CHAT_SHARED_SECRET` | O | |
| `USD_EUR_RATE` | `ai-pricing.mjs` | yes (0.92) | 0.92 | O | |
| `VERCEL_ENV` / `VERCEL_URL` / `VERCEL_PROJECT_PRODUCTION_URL` | `observability.ts`, `base-url.ts` | no | — | P | |

### 3.a Used in code but missing from `.env.example`

Resolved: every runtime variable the code reads is in `.env.example`. The 2026-09-08 list is archived ([archive](./archive/FEATURE_INVENTORY_AUDIT_2026-09.md) §D.8).

### 3.b In `.env.example` but never read by code (stale)

Resolved: `SHOPIFY_CUSTOMER_ACCOUNT_API_VERSION` is gone; the Sentry build variables appear only in a comment that says
they are not read (no `withSentryConfig`); `CONSENT_COPY_LAWYER_APPROVED` is a code constant (`src/lib/consent-copy.ts`).
2026-09-08 findings archived ([archive](./archive/FEATURE_INVENTORY_AUDIT_2026-09.md) §D.8).

### 3.c README ↔ `.env.example` inconsistencies

README → Configuration names `.env.example` as the canonical list; the 2026-09-08 findings are archived ([archive](./archive/FEATURE_INVENTORY_AUDIT_2026-09.md) §D.8).
Resolved: the `CRON_SECRET` comment in `.env.example` names all ten crons, `/api/cron/release-campaign-mails` included.

---

# 6. Database and tests

## 6.1 Database

### 4.1 Client pattern
`src/lib/db.ts`: `getSql()` returns a memoised Neon HTTP query function (`neon(DATABASE_URL || POSTGRES_URL)`) or **null** when no connection string is set (one warning logged). `isDbConfigured()` mirrors that. Every store takes `sql: Sql | null = getSql()` as its last parameter, returns a null-safe fallback (`[]`, `null`, `false`) when `sql` is null, wraps its query in try/catch and funnels errors through `reportError` (fail-soft house style). Queries are Neon tagged templates — **never composed** (fragments are not composable), dynamic GROUP BY is spelled out three times (see `getCampaignKpis`). `sql.transaction([...])` is used in three places (account-history erase, email-capture unsubscribe, conversation-store). `NEON_FETCH_ENDPOINT` (new, dev only) redirects the driver to a local Neon-protocol proxy.

### 4.2 Migrations (`migrations/0001…0076`, applied by `scripts/migrate.mjs`, run manually by the maintainer)
Forward-only `.sql` files applied in filename order, statement by statement (`--` comments stripped, quotes respected); applied names are recorded in `_migrations`; re-running is a no-op. Prefers `DATABASE_URL_UNPOOLED`/`POSTGRES_URL_NON_POOLING`. **Rule: never edit an applied migration; new ones get the next number.**

| # | Summary |
|---|---|
| 0001 | initial schema (conversations, messages, kpi_events, email_captures, marketing_sends, suppression_list) |
| 0002 | email capture + double opt-in consent columns |
| 0003 | marketing_sends dashboard columns |
| 0004 | kpi_persona_question_summaries cache |
| 0005 | marketing_sends.discount_percent |
| 0006 | marketing_sends click tracking (redirect token, clicked_at) |
| 0007 | conversations.selected_product_ids |
| 0008 | customers entity |
| 0009 | welcome discount (feature later removed, columns kept) |
| 0010 | per-customer marketing draft + admin instructions |
| 0011 | consent_copy_version |
| 0012 | ai_usage (token usage per call) |
| 0013 | bundle_offers |
| 0014 | customer accounts (tier 3): customer_oauth_tokens, customer_auth_pending, customer_merge_conflicts |
| 0015 | customer account profile cache |
| 0016 | conversation titles |
| 0017 | bestandskunden suppression (dropped again in 0029) |
| 0018 | conversation threads per session |
| 0019 | customer_session_links |
| 0020 | feedback |
| 0021 | email_messages (unified mail log) |
| 0022 | physical_letters + postal address on customers |
| 0023 | customer letter draft |
| 0024 | physical letter content |
| 0025 | customer postal_checked throttle |
| 0026 | conversation history perf indexes |
| 0027 | conversations(created_at) index for KPI windows |
| 0028 | admin_access_log |
| 0029 | drop bestandskunden |
| 0030 | email_captures.locale |
| 0031 | conversation analysis columns |
| 0032 | analytics_reports |
| 0033 | insights references (conversation_insights) |
| 0034 | campaign_contacts, campaign_drafts, campaign_sends |
| 0035 | campaign bundle offers link |
| 0036 | qa_entries |
| 0037 | qa_entries translation |
| 0038 | campaign_sends body_text/body_html |
| 0039 | ai_usage cache token columns |
| 0040 | campaign_contacts.language_override |
| 0041 | KPI coverage: campaign redirect tokens/clicks, conversations.locale |
| 0042 | mo_orders, mo_attribution_tokens |
| 0043 | campaign_drafts.purchase_selected_ids |
| 0044 | improvement_runs, improvement_suggestions, mo_directives, mo_directive_versions |
| 0045 | improvement step claim |
| 0046 | product_highlights on drafts |
| 0047 | email text_mode |
| 0048 | email_templates (superseded) |
| 0049 | email_design_selections (code-based designs; drops 0048 tables) |
| 0050 | hero image columns |
| 0051 | hero headline |
| 0052 | campaign lifecycle segments |
| 0053 | hero mobile variant |
| 0054 | campaign_sends send-time snapshot (design, hero variant, clicks, unsubscribe) |
| 0055 | campaign_sends delivery outcome (delivered/bounced/complained) |
| 0056 | retention indexes (email_messages, physical_letters) |
| 0057 | campaign test contacts (`is_test`) |
| 0058 | campaign discount scope |
| 0059 | customer profiles everywhere (`source`, `profile_data`, `persona_label`, contact ↔ customer link) |
| 0060 | bundle `shopify_deleted_at` |
| 0061 | customer mirror: Shopify identity / state / tags / dates, first/last name, locale, country, `language_override`, `profile_depth`, `profile_objection_at`, `postal_objection_at`, `facts_dirty_at`; source `shopify` (2026-10) |
| 0062 | `customer_orders` — the local order ledger, line items as jsonb, no addresses / payment data (2026-10) |
| 0063 | `customer_facts` — deterministic figures per customer (orders, spend, intervals, lifecycle, value tier, churn, categories, next expected order, …) (2026-10) |
| 0064 | the one e-mail consent `customers.email_consent_state/level/at/source` + `consent_events` (2026-10) |
| 0065 | `shopify_webhook_events`, `shopify_sync_runs`, `shopify_outbox`, `erasure_tombstones` (2026-10) |
| 0066 | `campaigns`; `campaign_contacts` become per-campaign recipients (`campaign_id`, `customer_id`, `cycle`, `excluded`, `admin_note`, `conversation_id`); legacy rows → `lebenszyklus`, system campaign `einzelansprache`; `campaign_sends.campaign_id`/`customer_id` (2026-10) |
| 0067 | `inbox_items` — the Eingang (2026-10) |
| 0068 | view `customer_overview` (customers + facts + consent + block state) — base of the Kunden list and the audiences (2026-10) |
| 0069 | `campaign_contacts.added_manually` — a person added by hand stays in a dynamic campaign at the nightly refresh (2026-10) |
| 0070 | `customer_orders.last_refund_at` — date of the latest notable refund (2026-10) |
| 0071 | `customer_session_links.link_kind` + `authenticated_at` — how a session was linked; only a sign-in in that session counts (2026-10) |
| 0072 | `campaign_contacts` „Einplanen“ columns `approved_at`, `release_at`, `approved_fingerprint`, `release_error`, `claimed_at` (2026-10) |
| 0073 | `customer_link_grants` — one-time sign-in link codes; existing sign-in links set to `legacy` (2026-10) |
| 0074 | letters as a campaign channel: `campaigns.letter_mode` (`aus` \| `ohne_einwilligung` \| `alle`, default `aus`) + `letter_budget_cents`; table `campaign_letters` (one letter per person per campaign per cycle, review status, text, link to the posted `physical_letters` row); `physical_letters.campaign_id`; `customers.postal_address_order_id`, `postal_address_invalid_at` (2026-10-03) |
| 0075 | unique partial index: one `campaign_chat_started` KPI event per campaign send (duplicates removed first) — „Chat gestartet“ counts once, race-free (2026-10-04) |
| 0076 | `messages.session_id` — the session that wrote a product-tool marker row (NULL on text rows and older rows) + partial index `messages_session_marker_idx`; anchor of the attribution window (`MO_ATTRIBUTION_SESSION_ANCHOR`). Additive; `persistTurn` retries without the column until it ran (2026-10-05) |

### 4.3 Tables (42 tables + `_migrations` + the view `customer_overview`) → owning store

Columns and semantics per table: [`DATABASE.md`](./DATABASE.md) „Table index“.

| Table | Store file(s) |
|---|---|
| conversations, messages | conversation-store.ts, admin-conversations.ts, account-history.ts, kpi-store.ts, retention.ts (+ others read-only) |
| kpi_events | kpi-events.ts (`recordKpiEvent`, also behind `POST /api/kpi`), kpi-store.ts |
| email_captures, suppression_list | email-capture-store.ts, marketing-store.ts, retention.ts |
| marketing_sends | marketing-store.ts |
| customers, customer_session_links | customer-store.ts |
| customer_oauth_tokens, customer_auth_pending, customer_merge_conflicts | shopify-customer-account / customer-store |
| customer_link_grants | session-link-grants.ts (rules in customer-link-grant.mjs) |
| ai_usage | ai-usage-store.ts |
| bundle_offers | bundle-offers-store.ts |
| feedback | feedback-store.ts |
| email_messages | email-messages-store.ts |
| physical_letters | physical-letters-store.ts |
| admin_access_log | admin-access-log.ts |
| kpi_persona_question_summaries | kpi-top-questions.ts |
| conversation_insights, analytics_reports | admin-conversations.ts, analytics-report-store.ts |
| campaign_contacts, campaign_drafts, campaign_sends | campaign-store.ts (+ email-delivery-events.ts); 2026-10: recipients per campaign, materialised by campaigns-store.ts |
| campaigns (2026-10) | campaigns-store.ts |
| campaign_letters (2026-10-03, 0074) | campaign-letters-store.ts (rules in campaign-letter-core.mjs), retention.ts, customer-merge-store.ts |
| customer_orders (2026-10) | customer-orders-store.ts |
| customer_facts (2026-10) | customer-facts.ts |
| consent_events (2026-10) | consent-store.ts |
| shopify_webhook_events, shopify_sync_runs, erasure_tombstones (2026-10) | shopify-webhook-customers.ts, shopify-sync.ts, customer-erasure.ts |
| shopify_outbox (2026-10) | shopify-outbox.ts, consent-alignment.ts |
| inbox_items (2026-10) | inbox-store.ts, inbox-signals.ts |
| view customer_overview (2026-10) | customer-list-store.ts, audience-store.ts |
| qa_entries | qa-store.ts |
| mo_orders, mo_attribution_tokens | mo-orders-store.ts |
| improvement_runs, improvement_suggestions | improvement-store.ts |
| mo_directives, mo_directive_versions | directives-store.ts |
| email_design_selections | email-design-store.ts |
| _migrations | scripts/migrate.mjs |
No table created by a migration is unreferenced; the dropped ones (`bestandskunden_suppression_list`, `email_templates`, `email_template_assignments`) are gone from the schema.

## 6.2 Tests

135 `*.test.mjs` files, 1220 tests, all green (`npm test` = `node --test "src/**/*.test.mjs"`, 2026-10-05). Every
`.mjs` core in `src/lib` has a sibling test except `email-rating.mjs`, `kpi-event-patterns.mjs` and `openai-error.mjs`
(and the fixtures file `system-prompt-core.fixtures.mjs`). TypeScript modules are not unit-tested (tests cannot import
TS); their pure logic lives in the `.mjs` cores by convention. The test counts recorded per milestone since the
baseline are archived ([archive](./archive/FEATURE_INVENTORY_AUDIT_2026-09.md) §D.9).

## 6.3 Docs map

The map of the documentation is [`docs/README.md`](./README.md); the history in [`archive/README.md`](./archive/README.md).
The 2026-09-08 docs map is archived ([archive](./archive/FEATURE_INVENTORY_AUDIT_2026-09.md) §D.10).
