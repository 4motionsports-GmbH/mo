# Feature inventory — the capability checklist for the clean-up

Purpose: an exhaustive list of everything the admin dashboard, the API surface, the scheduled jobs, the scripts and the
configuration can do **today** (baseline `main` @ `9c6b551`, 2026-09-08). It is the checklist both of us use at the end of
the clean-up to verify that no capability was lost silently. Every item carries a stable ID (`KUN-12`, `KAM-07`, …) or a
path; Phase 3 marks each one as **verified** (by test / screenshot / manual run) or **intentionally removed / merged**
(with your approval), in `FEATURE_INVENTORY_STATUS.md`.

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

# 1. Admin dashboard

Stand: 2026-09-08 · Zweck: Vollständiges Inventar aller Bedienelemente, Anzeigen, Hilfetexte, persistierten Zustände und Datenflüsse des deutschsprachigen Admin-Dashboards, damit nach dem Redesign verifiziert werden kann, dass nichts verloren ging.

Konventionen:
- IDs sind pro Tab sequenziell und stabil (SHL = Shell/global, LOG = Login, UEB = Übersicht, KUN = Kunden, KAM = Kampagne, KPI = KPIs, FEE = Feedback, GES = Gespräche, WIS = Wissen, ANA = Analyse, VER = Verbesserung, EIN = Einstellungen).
- "Calls": API-Route (`POST /api/admin/...`), Server Action, `server-render` (Daten kommen aus der Server-Komponente) oder `client-only` (nur lokaler State).
- Alle Pfade relativ zu `src/app/admin/` sofern nicht anders angegeben. Zeilennummern beziehen sich auf den Stand am Inventar-Datum.
- "Hilfetext" = jeder erklärende Untertitel, Caption, Hinweis-Absatz, Placeholder mit Erklärcharakter, Tooltip/`title`, Leer-/Fehlerzustand mit Informationsgehalt.

---

## 0. Globale Shell (`page.tsx`, `AdminShell.tsx`, `layout.tsx`, `ThemeToggle.tsx`, `theme-config.ts`)

### Beschreibung
`page.tsx` (Server Component, `force-dynamic`) liest `searchParams`, ermittelt den initialen Tab aus `?tab=` (Werte: `kpi|feedback|gespraeche|wissen|analyse|verbesserung|einstellungen|kampagne|kunden|customers`(legacy→kunden); Default `overview`), den Kunden-Filter-Preset aus `?filter=` (Fallback legacy `?status=`), den KPI-Zeitraum aus `?kpiRange/?kpiFrom/?kpiTo` (via `resolveKpiRange`) und den Gespräche-Filter aus den `g*`-Params (`grange,gfrom,gto,gtier,gerr,gcat,gqual,gq,gpage` via `parseAdminConversationFilter`). Jeder Tab-Body wird SERVER-seitig gerendert und als ReactNode an die Client-Komponente `AdminShell` übergeben. Ausnahme (PERF): `OverviewTab` und `KpiTab` (Shopify-lastig) werden NUR gerendert, wenn sie der initiale Tab sind; andernfalls erhält die Shell `null` und ein Klick auf diesen Tab löst eine echte Navigation (`window.location.assign`) zum Deep-Link aus. Alle anderen Bodies bleiben per `forceMount` gemountet (Edit-State bleibt beim Tab-Wechsel erhalten). Die Shell hält den aktiven Tab im State, synchronisiert `?tab=` per `history.replaceState`, zeigt Theme-Toggle + Abmelden, den Tab-Untertitel und mountet den einen `<Toaster/>`. `layout.tsx` lädt `theme.css` (Tailwind-Tokens, nur unter /admin), die selbstgehostete Montserrat und setzt die `.dark`-Klasse auf `#admin-root` aus dem Cookie `ms_admin_theme` (plus render-blockendes Inline-Script mit OS-Fallback).

Datenladen (in `page.tsx` für den Kunden-Tab, `KundenTab`-Funktion): `listCustomersWithSessions()`, pro Kunde `getLatestSendForEmail`, `listBundleOffersWithSignalsForCustomer`, `listCustomerMessages`, `listCustomerLetters`, `physicalEligibilityForCustomer`, `buildBundleRedirectUrl`; global `listUnmatchedInbound()`; Hintergrund `after(() => autoCaptureMissingAddresses({limit:12}))` (Adress-Autoerfassung aus Shopify nach Antwort). Übersicht: `listMarketingTargets()` nur wenn Overview gerendert wird.

### Controls & actions
| ID | Element | Type | What it does | Calls | File:line |
|---|---|---|---|---|---|
| SHL-01 | „Admin-Dashboard" | display (h1) | Seitentitel | client-only | AdminShell.tsx:220 |
| SHL-02 | Tab-Untertitel (TAB_SUBTITLE) | display | Wechselnder Untertitel je aktivem Tab (10 Texte, siehe Hilfetexte) | client-only | AdminShell.tsx:60-78, 221 |
| SHL-03 | Theme-Toggle (Sonne/Mond-Icon) | toggle (button) | Schaltet Light/Dark, setzt Cookie `ms_admin_theme` (path=/admin, 1 Jahr, SameSite=Lax), togglet `.dark` auf `#admin-root`; aria-label „Dunkles Design aktivieren"/„Helles Design aktivieren", title „Dunkles Design"/„Helles Design" | client-only (Cookie) | ThemeToggle.tsx:84-123 |
| SHL-04 | „Abmelden" | button (form submit) | Server Action `logoutAction`: löscht Admin-Cookie (`ADMIN_COOKIE_NAME`), redirect `/admin/login` | Server Action `logoutAction` | AdminShell.tsx:225-232, page.tsx:58-63 |
| SHL-05 | Tab-Leiste (10 Tabs: Übersicht, Kunden, Kampagne, KPIs, Feedback, Gespräche, Wissen, Analyse, Verbesserung, Einstellungen) | sub-tab (role=tablist) | Wechselt den sichtbaren Body; URL wird per `replaceState` auf `/admin` (Übersicht) bzw. `/admin?tab=<id>` gesetzt. Deferred Tabs (Übersicht/KPI wenn nicht initial gerendert) → `window.location.assign` | client-only / Navigation | AdminShell.tsx:34-58, 82-84, 142-159, 236-244 |
| SHL-06 | Tastenkürzel `1`–`9`/`0`? (tatsächlich `1`-`9`, begrenzt auf TAB_ORDER.length=10 → `1`–`9`) | keyboard shortcut | Springt zum n-ten Tab (1=Übersicht … 9=Verbesserung; Einstellungen (10) ist per Ziffer NICHT erreichbar, da nur `^[1-9]$`). Ignoriert, wenn Fokus in INPUT/TEXTAREA/SELECT/contentEditable oder Modifier gedrückt | client-only | AdminShell.tsx:166-187 |
| SHL-07 | Tastenkürzel `/` | keyboard shortcut | Wechselt zu Kunden und fokussiert die Suchbox `#ms-search` | client-only | AdminShell.tsx:189-196 |
| SHL-08 | Container-Breite | layout | Kunden/Kampagne/Gespräche/Analyse/Verbesserung: `max-w-7xl`; sonst `max-w-5xl` | client-only | AdminShell.tsx:206-213 |
| SHL-09 | Toaster (unten rechts, „Benachrichtigungen") | display (toast stack) | Zeigt `toast()`-Meldungen aller Tabs; Varianten default/success/warning/error/info; auto-dismiss 4 s (0 = pinned), Schließen-X pro Toast, `toast.update` für Live-Fortschritt | client-only | ui/toast.tsx:92-128, AdminShell.tsx:259 |
| SHL-10 | Theme-Init-Script | script | Render-blockend: Cookie → `.dark`, sonst `prefers-color-scheme` | client-only | theme-config.ts:64-70, layout.tsx:41 |
| SHL-11 | Kunden-Tab Banner „Keine Datenbank konfiguriert (DATABASE_URL) — es können keine Kunden geladen werden." | display (warn banner) | Zustand ohne DB | server-render | page.tsx:280-286 |
| SHL-12 | Kunden-Tab Banner „Noch keine Kunden. …" | display (info banner) | Leerzustand Kundenliste | server-render | page.tsx:288-295 |
| SHL-13 | URL-Param `?tab=` (inkl. Legacy `customers`) | URL param | Initialer Tab | server-render | page.tsx:74-93 |
| SHL-14 | URL-Param `?filter=` / legacy `?status=` | URL param | Kunden-Filter-Preset (`no_purchase`, `marketing`, `draft`) | server-render | page.tsx:96-98, customer-filter.ts:136-148 |
| SHL-15 | URL-Params `?kpiRange`, `?kpiFrom`, `?kpiTo` | URL param | KPI-Zeitraum | server-render | page.tsx:103-107 |
| SHL-16 | URL-Params `grange,gfrom,gto,gtier,gerr,gcat,gqual,gq,gpage` | URL param | Gespräche-Filter/Seite | server-render | page.tsx:110-120 |

### Helper/explanatory text (Shell) — 12
1. „Übersicht · Kennzahlen & Schnellzugriff auf einen Blick" — AdminShell.tsx:61
2. „Kunden · Suche, filtere & öffne eine Person — Profil, Käufe, Marketing, Korrespondenz & Brief" — AdminShell.tsx:63
3. „Kampagne · Personalisierte E-Mails an Shopify-Marketing-Abonnent:innen — prüfen, anpassen, senden" — AdminShell.tsx:65
4. „KPIs · Pseudonyme Analytics (Cluster A) + Shopify-Käufe" — AdminShell.tsx:66
5. „Feedback · Kund:innen-Rückmeldungen aus dem Widget — neueste zuerst" — AdminShell.tsx:67
6. „Gespräche · Alle Beratungen einsehen & auswerten — Transkripte, Signale, KI-Analyse" — AdminShell.tsx:69
7. „Wissen · Offene Kundenfragen aus Beratungen beantworten & als Q&A veröffentlichen — für Produktseite & Mo" — AdminShell.tsx:71
8. „Analyse · Komplettanalysen je Zeitintervall — alle KI-Auswertungen verdichtet, gespeichert & als PDF" — AdminShell.tsx:73
9. „Verbesserung · Mo analysiert die Komplettanalyse & schlägt Verbesserungen vor — für den Shop & für sich selbst" — AdminShell.tsx:75
10. „Einstellungen · E-Mail-Designs auswählen & je E-Mail-Typ aktivieren — neue Designs entstehen mit Claude Code" — AdminShell.tsx:77
11. „Keine Datenbank konfiguriert (DATABASE_URL) — es können keine Kunden geladen werden." — page.tsx:283
12. „Noch keine Kunden. Ein Kunde entsteht, sobald jemand im Chat seine E-Mail-Adresse (mit Einwilligung) hinterlässt — anonyme Sessions bleiben unverknüpft." — page.tsx:291-292

### Persistenter Zustand (Shell)
- URL: `?tab=` (replaceState bei Client-Wechsel; echte Navigation bei deferred Tabs), plus alle oben genannten Tab-spezifischen Params.
- Cookie `ms_admin_theme` (light|dark; path=/admin; max-age 1 Jahr) — ThemeToggle.tsx:99, theme-config.ts:48-52.
- Cookie Admin-Session (`ADMIN_COOKIE_NAME`, HTTP-only, aus `@/lib/admin-auth`) — page.tsx:61, login/page.tsx:43.
- Kein localStorage in der Shell.

---

## 1. Login (`login/page.tsx`)

### Beschreibung
Einzige unauthentifizierte Admin-Seite. Server Component mit Server Action `loginAction`: prüft `password` aus FormData via `isAdminPasswordValid`, erzeugt Session-Token via `createAdminSessionToken`, setzt Cookie `ADMIN_COOKIE_NAME` mit `sessionCookieOptions()`, redirect `/admin`. Bei Fehler redirect `/admin/login?error=invalid` bzw. `?error=config`. `isAdminAuthConfigured()` steuert eine Warnung, wenn ADMIN_PASSWORD/ADMIN_SESSION_SECRET fehlen.

### Controls & actions
| ID | Element | Type | What it does | Calls | File:line |
|---|---|---|---|---|---|
| LOG-01 | „motion sports — Admin" | display (CardTitle) | Titel | server-render | login/page.tsx:66 |
| LOG-02 | „Marketing-Dashboard. Bitte anmelden." | display (CardDescription) | Untertitel | server-render | login/page.tsx:67 |
| LOG-03 | Warn-Box „ADMIN_PASSWORD / ADMIN_SESSION_SECRET sind nicht gesetzt — Login ist deaktiviert." | display (warning) | Nur wenn `!configured` | server-render | login/page.tsx:70-75 |
| LOG-04 | Fehler-Box („Falsches Passwort." / „Server nicht konfiguriert (ADMIN_SESSION_SECRET fehlt).") | display (error) | Aus `?error=invalid|config` | server-render (URL) | login/page.tsx:55-60, 77-81 |
| LOG-05 | „Passwort" | input (type=password, required, autoFocus, autoComplete=current-password) | Passwortfeld | – | login/page.tsx:85-93 |
| LOG-06 | „Anmelden" | button (submit) | Führt `loginAction` aus | Server Action `loginAction` | login/page.tsx:95-97 |
| LOG-07 | URL-Param `?error=` | URL param | `invalid` / `config` → Fehlermeldung | server-render | login/page.tsx:35,40,52 |

### Helper/explanatory text (Login) — 4
1. „Marketing-Dashboard. Bitte anmelden." — login/page.tsx:67
2. „ADMIN_PASSWORD / ADMIN_SESSION_SECRET sind nicht gesetzt — Login ist deaktiviert." — login/page.tsx:72-73
3. „Falsches Passwort." — login/page.tsx:57
4. „Server nicht konfiguriert (ADMIN_SESSION_SECRET fehlt)." — login/page.tsx:59

### Persistenter Zustand (Login)
- Cookie Admin-Session (gesetzt durch `loginAction`), URL `?error=`.

---

## 2. Übersicht (`OverviewTab.tsx`)

### Beschreibung
Read-only Landing-Tab (Server Component, async). Wird NUR gerendert, wenn `?tab` fehlt/`overview` ist (deferred sonst). Lädt parallel: `getCoreMetrics(resolveKpiRange({kpiRange:"30d"}))` (kpi-store), `getAiCostMetrics()` (ai-usage-store, all-time), `getMarketingActivity({windowDays:30, limit:5})` (marketing-store); erhält `targets` (= `listMarketingTargets()` aus page.tsx) und aggregiert per `summarizeMarketingTargets` / `recentConfirmedContacts` (`@/lib/admin-overview.mjs`). Feste 30-Tage-Sicht (kein Datepicker hier). Enthält Kennzahl-Karten, Schnellzugriffs-Deep-Links in andere Tabs (mit vorbelegtem Kunden-Filter) und zwei Aktivitätslisten. Nichts hier mutiert Daten.

### Controls & actions
| ID | Element | Type | What it does | Calls | File:line |
|---|---|---|---|---|---|
| UEB-01 | Banner „Keine Datenbank konfiguriert (DATABASE_URL) — die Übersicht kann nicht berechnet werden." | display (warn) | Zustand ohne DB | server-render | OverviewTab.tsx:56-63 |
| UEB-02 | Section „Überblick" | display (Section) | Gruppe Kennzahlen, Untertitel | server-render | OverviewTab.tsx:83-86 |
| UEB-03 | Stat „Chats gesamt" | display (stat card) | `core.totalChats` (30 T.) oder „—" | `getCoreMetrics` | OverviewTab.tsx:88 |
| UEB-04 | Stat „Marketing-Kontakte" (hint „bestätigt (DOI), aktiv") | display | `marketing.eligible` | `summarizeMarketingTargets(targets)` | OverviewTab.tsx:89-93 |
| UEB-05 | Stat „Beraten, nicht gekauft" (hint „wichtigste Zielgruppe") | display | `marketing.notPurchased` | dito | OverviewTab.tsx:94-98 |
| UEB-06 | Stat „Gesendet (30 T.)" (hint „Marketing-E-Mails") | display | `activity.sentInWindow` oder „—" | `getMarketingActivity` | OverviewTab.tsx:99-103 |
| UEB-07 | Stat „Ø Kosten / Beratung" (hint „N Beratungen" / „noch keine Daten") | display | `aiCost.avgCostPerConsultationEur` (EUR, 4 Dezimalen) oder „—" | `getAiCostMetrics` | OverviewTab.tsx:104-108 |
| UEB-08 | Section „Schnellzugriff" | display (Section) | Gruppe Deep-Links | – | OverviewTab.tsx:112-115 |
| UEB-09 | QuickLink „N beraten, nicht gekauft" | link (a href, full nav) | → `/admin?tab=kunden&filter=no_purchase` | Navigation | OverviewTab.tsx:117-121 |
| UEB-10 | QuickLink „N Marketing-Kontakte" | link | → `/admin?tab=kunden&filter=marketing` | Navigation | OverviewTab.tsx:122-126 |
| UEB-11 | QuickLink „Alle Kunden ansehen" | link | → `/admin?tab=kunden` | Navigation | OverviewTab.tsx:127-131 |
| UEB-12 | QuickLink „KPIs ansehen" | link | → `/admin?tab=kpi` | Navigation | OverviewTab.tsx:132-136 |
| UEB-13 | Section „Letzte Aktivität" | display (Section) | Gruppe Aktivitätslisten | – | OverviewTab.tsx:140-143 |
| UEB-14 | ActivityCard „Zuletzt gesendet" (Mail-Icon) | display (list, max 5) | E-Mail, Betreff („(ohne Betreff)" Fallback), Datum je Send; leer: „Noch keine Marketing-E-Mails versendet." | `getMarketingActivity.recentSends` | OverviewTab.tsx:145-155 |
| UEB-15 | ActivityCard „Zuletzt bestätigt (DOI)" (UserCheck-Icon) | display (list, max 5) | E-Mail, „Marketing-Einwilligung bestätigt", Datum; leer: „Noch keine bestätigten Kontakte." | `recentConfirmedContacts(targets,5)` | OverviewTab.tsx:156-166 |

### Helper/explanatory text (Übersicht) — 15
1. „Keine Datenbank konfiguriert (DATABASE_URL) — die Übersicht kann nicht berechnet werden." — OverviewTab.tsx:59-60
2. „Aggregierte Kennzahlen aus den bestehenden Datenquellen — schreibgeschützt, nur Lesen." — OverviewTab.tsx:85
3. Hint „bestätigt (DOI), aktiv" — OverviewTab.tsx:92
4. Hint „wichtigste Zielgruppe" — OverviewTab.tsx:97
5. Hint „Marketing-E-Mails" — OverviewTab.tsx:102
6. Hint „N Beratungen" / „noch keine Daten" — OverviewTab.tsx:107
7. „Direkt in die anderen Tabs springen — die Kunden-Links öffnen die Liste bereits gefiltert." — OverviewTab.tsx:114
8. „Öffnet die Kundenliste, gefiltert auf „bestätigt + nicht gekauft"." — OverviewTab.tsx:120
9. „Alle bestätigten (DOI) Kontakte in der Kundenliste." — OverviewTab.tsx:125
10. „Profile, Sessions, Käufe & Marketing — gruppiert nach Person." — OverviewTab.tsx:130
11. „Analytics, Marketing-Funnel & KI-Kosten." — OverviewTab.tsx:135
12. „Die jüngsten Versände und bestätigten Kontakte aus den bestehenden Daten." — OverviewTab.tsx:142
13. Leer: „Noch keine Marketing-E-Mails versendet." — OverviewTab.tsx:148
14. Leer: „Noch keine bestätigten Kontakte." — OverviewTab.tsx:159
15. Sekundärzeile „Marketing-Einwilligung bestätigt" — OverviewTab.tsx:163

### Persistenter Zustand (Übersicht)
- Keiner eigener (nur `?tab` fehlt = Übersicht). Deep-Links setzen `?tab=kunden&filter=…` bzw. `?tab=kpi`.

---

## 3. Kunden (`KundenWorkspace.tsx`, `CustomerProfileCard.tsx`, `KorrespondenzPanel.tsx`, `PhysicalLetterPanel.tsx`, `UnmatchedInboundQueue.tsx`, `customer-filter.ts`)

### Beschreibung
Master-Detail-Workspace für alles Kundenbezogene (alter Kunden- + Marketing-Tab zusammengelegt). Daten kommen komplett SERVER-seitig aus `page.tsx → KundenTab` (siehe Abschnitt 0: `listCustomersWithSessions`, `getLatestSendForEmail`, `listBundleOffersWithSignalsForCustomer`, `listCustomerMessages`, `listCustomerLetters`, `physicalEligibilityForCustomer`, `listUnmatchedInbound`, Hintergrund-`autoCaptureMissingAddresses`). Links eine kompakte, durchsuchbare/filterbare Liste (Client-Filterung via `customer-filter.ts`, Preset aus `?filter=`), rechts die ausgewählte Person als `CustomerProfileCard` (gekeyt nach id → frischer Zustand pro Kunde) mit sechs Sub-Tabs (Profil · Beratungen · Käufe · Marketing · Korrespondenz · Brief; alle `forceMount`). Oberhalb der Liste die globale Triage „Nicht zugeordneter Posteingang". Unten eine Sticky-Leiste für den Sammel-Entwurf (nur DOI-bestätigte Kunden, Concurrency 4). Alle Mutationen laufen per `fetch` gegen `/api/admin/*`-Routen, gefolgt von `router.refresh()`.

### Controls & actions
| ID | Element | Type | What it does | Calls | File:line |
|---|---|---|---|---|---|
| **Nicht zugeordneter Posteingang (global, nur sichtbar wenn ≥1 Nachricht)** ||||||
| KUN-01 | Karte „Nicht zugeordneter Posteingang" + Zähler-Badge | display (warn card) | Eingegangene Mails ohne Kundenzuordnung (customer_id NULL) | server-render (`listUnmatchedInbound`) | UnmatchedInboundQueue.tsx:57-75 |
| KUN-02 | Absender-Badge, Betreff („(kein Betreff)"), 📎 Anzahl Anhänge, Datum/Zeit, Snippet (2 Zeilen) | display | Metadaten je unzugeordneter Nachricht | server-render | UnmatchedInboundQueue.tsx:130-144 |
| KUN-03 | Select „Kunde wählen…" (Option-Suffix „(passende Adresse)" bei E-Mail-Match, vorausgewählt) | select | Zielkunde für Zuordnung; Vorschlag = Kunde mit gleicher E-Mail | client-only | UnmatchedInboundQueue.tsx:146-160 |
| KUN-04 | „Zuordnen" / „Ordne zu…" | button | Setzt customer_id + re-threadet; Toast „Zugeordnet"; Warn-Toast „Kein Kunde gewählt" | POST /api/admin/correspondence/assign `{messageId, customerId}` → `router.refresh()` | UnmatchedInboundQueue.tsx:95-126, 161-163 |
| **Toolbar (Suche + Filter)** ||||||
| KUN-05 | „Suche (Name / E-Mail)" `#ms-search` (Placeholder „z. B. müller oder @gmail") | input (search) | Substring-Filter auf E-Mail + Name; Fokus per Tastenkürzel `/` | client-only (`filterCustomers`) | KundenWorkspace.tsx:239-253, customer-filter.ts:173-177 |
| KUN-06 | Filter „Tier" (Alle / Tier 3 · angemeldet / Tier 2 · E-Mail / Tier 1 · anonym) | select (filter) | Identitätsstufe | client-only | KundenWorkspace.tsx:255-265 |
| KUN-07 | Filter „Marketing" (Alle / DOI bestätigt / DOI offen / Keine Einwilligung / Abgemeldet) | select (filter) | `marketingStatus` | client-only | KundenWorkspace.tsx:266-277 |
| KUN-08 | Filter „Kauf" (Alle / Hat gekauft / Nicht gekauft) | select (filter) | `purchaseState` (unknown = noch nicht geladen fällt bei beiden raus) | client-only | KundenWorkspace.tsx:278-287, customer-filter.ts:155-158 |
| KUN-09 | Filter „Versand" (Alle / Offener Entwurf / Gesendet / Kein Entwurf) | select (filter) | `sendState` des letzten Marketing-Sends | client-only | KundenWorkspace.tsx:288-298, customer-filter.ts:161-164 |
| KUN-10 | „Sortierung" (Zuletzt aktiv / Name A–Z / Älteste zuerst / Meiste Sessions) | select (sort) | Sortierung der Liste | client-only | KundenWorkspace.tsx:299-309, customer-filter.ts:187-222 |
| KUN-11 | Zähler „N Kund(en)" / „N von M" | display | Trefferzahl | client-only | KundenWorkspace.tsx:313-317 |
| KUN-12 | „✕ Filter zurücksetzen" | button (nur wenn Filter aktiv) | Setzt DEFAULT_FILTER | client-only | KundenWorkspace.tsx:318-322 |
| KUN-13 | Checkbox „Alle bestätigten (N) für Sammel-Entwurf" (tri-state) | checkbox (bulk select) | Wählt alle sichtbaren DOI-bestätigten Kunden aus/ab | client-only | KundenWorkspace.tsx:323-332 |
| KUN-14 | Preset aus `?filter=no_purchase` / `marketing` / `draft` (legacy `?status=`) | URL param | Seed des Filters beim Laden | server→client | customer-filter.ts:136-148, page.tsx:96-98 |
| **Kundenliste (links, sticky, scrollbar)** ||||||
| KUN-15 | Kundenzeile (role=button, Enter/Space) | list item / button | Wählt Kunden für Detail | client-only | KundenWorkspace.tsx:451-546 |
| KUN-16 | Checkbox je Zeile (nur DOI-bestätigt; aria „… für Sammel-Entwurf auswählen") | checkbox | Bulk-Auswahl ohne Detailwechsel (stopPropagation) | client-only | KundenWorkspace.tsx:489-501 |
| KUN-17 | Name (oder E-Mail), E-Mail-Unterzeile, Badge „T1/T2/T3" | display | Identität | server-render | KundenWorkspace.tsx:502-511 |
| KUN-18 | Badges „Marketing" (success) / „DOI offen" / „Abgemeldet" | badge | Marketingstatus | – | KundenWorkspace.tsx:57-65, 513-517 |
| KUN-19 | Badge „✓ gekauft" | badge | purchaseState=purchased | – | KundenWorkspace.tsx:518-522 |
| KUN-20 | Badge „★ nicht gekauft" (accent; nur bestätigt + no_purchase) | badge | Kern-Zielgruppe | – | KundenWorkspace.tsx:523-527 |
| KUN-21 | Badges „Entwurf" (info) / „Gesendet" (success) | badge | sendState | – | KundenWorkspace.tsx:528-537 |
| KUN-22 | Relatives Datum („heute"/„gestern"/„vor N Tagen"/Datum) | display | lastSeenAt | – | KundenWorkspace.tsx:67-76, 540-542 |
| KUN-23 | Leerzustand „Keine Kunden für diese Suche/Filter." | display | – | – | KundenWorkspace.tsx:339-343 |
| KUN-24 | Platzhalter „Wähle links einen Kunden, um Profil, Käufe, Marketing & mehr zu sehen." | display | Kein Kunde gewählt | – | KundenWorkspace.tsx:365-369 |
| **Sammel-Entwurf-Leiste (sticky unten, nur bei Auswahl)** ||||||
| KUN-25 | „N ausgewählt" | display | Anzahl | – | KundenWorkspace.tsx:381 |
| KUN-26 | „Rabatt (%)" `#ms-bulk-depth` (0–50, clamp) | input (number) | Rabatt-Tiefe für alle Entwürfe | client-only | KundenWorkspace.tsx:383-397 |
| KUN-27 | „Textmodus" (Ausführlich/Kompakt/Minimal) | toggle (segmented, shared `EmailTextModeToggle`) | Textmodus für alle Entwürfe (Default compact) | client-only | KundenWorkspace.tsx:400-405 |
| KUN-28 | „✕ Auswahl aufheben" | button | Leert Auswahl | client-only | KundenWorkspace.tsx:412-414 |
| KUN-29 | „✨ Entwürfe erstellen" / „Erstelle…" | button (bulk action) | Je Kunde Draft (regenerate:false), Pool 4, Live-Toast „Entwürfe werden erstellt… k / N", Abschluss-Toast success/warning/error; danach Auswahl leeren + refresh | POST /api/admin/customers/marketing-draft `{customerId, discountPercent, textMode, regenerate:false}` | KundenWorkspace.tsx:141-230, 415-417 |
| **Detail-Karte: Kopf** ||||||
| KUN-30 | Name/E-Mail, „Zuerst: … · Zuletzt: …" | display | Kopfzeile | server-render | CustomerProfileCard.tsx:320-329 |
| KUN-31 | Badge „Tier N" (title „Identitätsstufe") | badge | – | – | CustomerProfileCard.tsx:331-333 |
| KUN-32 | Badge „↻ N×" (title „Mehrere Sessions unter derselben E-Mail") | badge | Wiederkehrer | – | CustomerProfileCard.tsx:334-338 |
| KUN-33 | Badge Marketingstatus („Kein Marketing" / „DOI ausstehend" / „Marketing bestätigt" / „Abgemeldet") | badge | – | – | CustomerProfileCard.tsx:214-222, 339 |
| KUN-34 | Sub-Tabs „Profil", „Beratungen (N)", „Käufe", „Marketing", „Korrespondenz", „Brief" | sub-tab | Wechsel innerhalb der Karte (alle forceMount) | client-only | CustomerProfileCard.tsx:343-353 |
| **Sub-Tab Profil** ||||||
| KUN-35 | Section „Aktuelles Kundenverständnis" · „Stand: <Datum>" | display | – | – | CustomerProfileCard.tsx:358-360 |
| KUN-36 | „✨ Kundenverständnis generieren" / „Neu generieren" / „Generiere…" | button | KI-Profil erzeugen; Toast success/„Hinweis" (warning) mit `json.warning` | POST /api/admin/customers/profile `{customerId}` → refresh | CustomerProfileCard.tsx:281-309, 362-369 |
| KUN-37 | Profiltext (Markdown) / „Noch kein Profil generiert." | display | – | – | CustomerProfileCard.tsx:373-379 |
| KUN-38 | Kosten-Hinweis inkl. „Letzter Lauf: N Input- / M Output-Tokens (~$x)" | display | Token-/Kostentransparenz nach Lauf | – | CustomerProfileCard.tsx:380-388 |
| **Sub-Tab Beratungen** ||||||
| KUN-39 | Section „Gesprächs-Timeline (N)" | display | – | – | CustomerProfileCard.tsx:395 |
| KUN-40 | Leerzustand „Keine Konversation verknüpft — …" | display | – | – | CustomerProfileCard.tsx:396-402 |
| KUN-41 | Timeline-Eintrag „Session N", Datum · Persona, Badge „N Nachrichten" | display | – | server-render | CustomerProfileCard.tsx:594-603 |
| KUN-42 | „💬 Transkript (N)" | button → dialog | Öffnet Dialog „Session N · Datum · E-Mail" mit Verlauf (Kunde:/Berater:), leer „Kein lesbares Transkript." | client-only | CustomerProfileCard.tsx:604-631 |
| **Sub-Tab Käufe** ||||||
| KUN-43 | Section „Kaufhistorie (Shopify)" · „Stand: …" / „noch nicht geladen" | display | – | – | CustomerProfileCard.tsx:420-422 |
| KUN-44 | „↻ Käufe aktualisieren" / „Lade…" | button | Shopify-Kaufhistorie neu laden; Toast „Käufe aktualisiert" | POST /api/admin/customers/purchases `{customerId}` → refresh | CustomerProfileCard.tsx:258-279, 424-431 |
| KUN-45 | Tabelle Artikel / Menge / Datum / Summe / Status (Bestellname als Unterzeile) | table | Bestellungen | – | CustomerProfileCard.tsx:538-573 |
| KUN-46 | Status-Badge (Bezahlt / Teilw. bezahlt / Ausstehend / Autorisiert / Erstattet / Teilw. erstattet / Storniert / Abgelaufen / „—") | badge | financialStatus | – | CustomerProfileCard.tsx:504-519 |
| KUN-47 | Leerzustände „Noch keine Kaufhistorie geladen." / „Keine Bestellungen unter dieser E-Mail gefunden." | display | – | – | CustomerProfileCard.tsx:522-535 |
| KUN-48 | Hinweis „Liste ggf. gekürzt (nur die neuesten Bestellungen)." | display | truncated | – | CustomerProfileCard.tsx:574-578 |
| **Sub-Tab Marketing (MarketingEmailSection)** ||||||
| KUN-49 | Blockier-Hinweis bei Status ≠ confirmed (3 Varianten) | display | Kein Generieren möglich | – | CustomerProfileCard.tsx:636-640, 677-685 |
| KUN-50 | Section „Personalisierte E-Mail (Mo) — aus dem GESAMTEN Kundenkontext" | display | – | – | CustomerProfileCard.tsx:803 |
| KUN-51 | Badge „✓ Gesendet am <Datum>" + „Betreff: … · Rabatt: N % · Code: <code>" | display | Letzte gesendete Mail | – | CustomerProfileCard.tsx:804-822 |
| KUN-52 | `<details>` „Gesendeten Text anzeigen" | disclosure | Markdown des gesendeten Texts | – | CustomerProfileCard.tsx:823-831 |
| KUN-53 | Bundle-Angebot-Block (aufklappbar, siehe KUN-71ff.) | section | – | – | CustomerProfileCard.tsx:841-846 |
| KUN-54 | „Besondere Hinweise für diese E-Mail (optional)" (Textarea, max 2000) | textarea | Team-Anweisung für nächste Generierung | client-only (mit Draft gespeichert) | CustomerProfileCard.tsx:849-864 |
| KUN-55 | „Persönlicher Rabatt (%)" (0–50) + Hinweis „0 = kein Rabatt, kein Code" / „0–50 %" | input (number) | Rabatt-Tiefe | client-only | CustomerProfileCard.tsx:874-895 |
| KUN-56 | „Textmodus" Toggle + Modus-Hinweis | toggle (shared) | Textmodus | client-only | CustomerProfileCard.tsx:902-904 |
| KUN-57 | Badge „Entwurf — noch nicht gesendet" | badge | Offener Draft | – | CustomerProfileCard.tsx:909 |
| KUN-58 | Warnbox „Rabatt, Textmodus oder Hinweise geändert — der aktuelle Text passt nicht mehr." + „↻ Neu generieren" | display + button | Regenerate-Lockout (Senden gesperrt bis neu generiert) | POST /api/admin/customers/marketing-draft `{…, regenerate:true}` | CustomerProfileCard.tsx:687-694, 911-917 |
| KUN-59 | Hinweis Platzhalter „Vorschau mit Platzhalter-Code MO-XXXX …" / „Kein Rabatt gewählt — …" | display | – | – | CustomerProfileCard.tsx:919-923 |
| KUN-60 | „Betreff" | input | Editierbar | client-only bis Speichern | CustomerProfileCard.tsx:926-933 |
| KUN-61 | „E-Mail-Text (bearbeitbar)" (Textarea 10 Zeilen) | textarea | Editierbar | client-only bis Speichern | CustomerProfileCard.tsx:935-944 |
| KUN-62 | Hinweis „Beim Versand werden Warenkorb-Button & Abmeldelink automatisch angehängt …" | display | – | – | CustomerProfileCard.tsx:946-950 |
| KUN-63 | Hero-Bild-Panel (kind=marketing, targetId=sendId; siehe Shared HERO-01…) | panel | Personalisiertes Hero-Bild | GET/POST /api/admin/email-hero* | CustomerProfileCard.tsx:952-959 |
| KUN-64 | „💾 Entwurf speichern" / „Speichere…" | button | Speichert Betreff/Text | POST /api/admin/marketing/update `{sendId, subject, body}` | CustomerProfileCard.tsx:740-752, 962-964 |
| KUN-65 | „👁 Vorschau" (EmailPreviewButton, Dialog „Vorschau — <email>") | button → dialog (iframe) | Gerenderte HTML-Vorschau, Desktop/Mobil-Toggle | POST /api/admin/marketing/email-preview `{sendId, subject, body}` | CustomerProfileCard.tsx:965-976 |
| KUN-66 | „📤 Freigeben & senden" / „Sende…" (disabled bei needsRegenerate, title „Bitte zuerst neu generieren") | button + confirm dialog (`confirm("E-Mail an … wirklich senden?")`) | Speichert dann sendet; Warn-Toast bei Lockout | POST /api/admin/marketing/update + POST /api/admin/marketing/send `{sendId}` | CustomerProfileCard.tsx:774-798, 977-983 |
| KUN-67 | „🗑 Entwurf löschen" / „Lösche…" | button + confirm (`"Diesen Entwurf wirklich löschen? …"`) | Löscht Draft, zurück zu Generieren | POST /api/admin/marketing/delete `{sendId}` | CustomerProfileCard.tsx:754-772, 984-991 |
| KUN-68 | Hinweis „Der Entwurf nutzt ALLES zu diesem Kunden: …" | display | Vor Generierung | – | CustomerProfileCard.tsx:996-1000 |
| KUN-69 | „✨ Personalisierte E-Mail generieren" / „Neue personalisierte E-Mail generieren" / „Generiere Entwurf…" | button | Erzeugt Draft (regenerate = hasDraft) | POST /api/admin/customers/marketing-draft `{customerId, discountPercent, adminInstructions, textMode, regenerate}` | CustomerProfileCard.tsx:711-738, 1001-1008 |
| KUN-70 | Hinweis „Du kannst unten jederzeit eine neue personalisierte E-Mail generieren." | display | Nach Versand | – | CustomerProfileCard.tsx:832-834 |
| **Bundle-Angebot (BundleOfferSection, innerhalb Marketing)** ||||||
| KUN-71 | Kopf „🎁 Bundle-Angebot · N vorhanden" ▸/▾ | button (collapse) | Auf-/Zuklappen | client-only | CustomerProfileCard.tsx:1307-1317 |
| KUN-72 | „✨ Bundle vorschlagen" / „Schlage vor…" | button | KI-Vorschlag Komponenten + Titel; Toast „KI-Vorschlag erstellt" | POST /api/admin/bundles/suggest `{customerId}` | CustomerProfileCard.tsx:1135-1164, 1323-1325 |
| KUN-73 | Komponentenliste (Bild, Titel, Preis · Begründung) + „✕" Entfernen (aria „… aus dem Bundle entfernen") | list + button | Zusammensetzung bearbeiten | client-only | CustomerProfileCard.tsx:1332-1369 |
| KUN-74 | „Komponentensumme: X €" | display | – | – | CustomerProfileCard.tsx:1370-1372 |
| KUN-75 | Produktsuche (CatalogProductPicker, Placeholder „Produkt suchen (Name)…", Variantenwahl, „Ausverkauft — nicht hinzufügbar") | input (search) + list | Produkt/Variante hinzufügen | POST /api/admin/catalog/search `{query}` | CustomerProfileCard.tsx:1378-1397 |
| KUN-76 | „Bundle-Preis (€)" (auto = Komponentensumme bis editiert) | input (number) | Preis | client-only | CustomerProfileCard.tsx:1404-1416 |
| KUN-77 | „Titel" (Default „Dein persönliches Set") | input | – | client-only | CustomerProfileCard.tsx:1419-1420 |
| KUN-78 | „Gültig (Tage)" (Default 7, min 1) | input (number) | Ablauf | client-only | CustomerProfileCard.tsx:1423-1434 |
| KUN-79 | Warnung „⚠ Preis über der Komponentensumme … KEINE „statt"-Zeile" | display | – | – | CustomerProfileCard.tsx:1439-1444 |
| KUN-80 | „Bundle erstellen" / „Erstelle…" (2–5 Produkte, Preis>0) | button | Erstellt Angebot, hängt an offenen Draft; Fehler-Toast mit „Ausverkauft: …" | POST /api/admin/bundles/create `{customerId, components[{productId,variantId?}], bundlePriceOverride, title, expiryDays, marketingSendId?}` | CustomerProfileCard.tsx:1186-1268, 1446-1450 |
| KUN-81 | Liste „Bundles für <email> (N)": Titel, Status-Badge (Fehlgeschlagen/Abgelaufen/Wird erstellt…/Versendet/Aktiv), „↗ Klick erfasst", Preis „(statt …)", Komponenten, „Erstellt … · läuft ab …", Fehlertext | display | Bestehende Bundles | server-render | CustomerProfileCard.tsx:1077-1083, 1453-1481 |
| KUN-82 | „🗑 Löschen" (nur pending/failed) | button + confirm (`"Dieses Bundle wirklich löschen? …"`) | Löscht unveröffentlichtes Bundle | POST /api/admin/bundles/delete `{id}` | CustomerProfileCard.tsx:1289-1303, 1482-1494 |
| KUN-83 | „↗ Angebots-Link" (nur active) | link (target=_blank) | Getrackter `/api/r/<token>`-Link | – | CustomerProfileCard.tsx:1497-1505 |
| KUN-84 | „Archivieren" (nur active) | button + confirm (`"Dieses Bundle wirklich archivieren? …"`) | Setzt expired | POST /api/admin/bundles/archive `{id}` | CustomerProfileCard.tsx:1270-1284, 1507-1509 |
| **Sub-Tab Korrespondenz (KorrespondenzPanel)** ||||||
| KUN-85 | Zähler „Noch keine E-Mails mit diesem Kunden." / „N Nachricht(en) in M Thread(s)." | display | – | server-render | KorrespondenzPanel.tsx:135-139 |
| KUN-86 | „✉ Neue E-Mail" | button | Öffnet Composer (neuer Thread) | client-only | KorrespondenzPanel.tsx:140-142 |
| KUN-87 | Composer-Kopf „Neue E-Mail an <email>" / „Antwort an <email>" + „✕" Schließen | display + button | – | client-only | KorrespondenzPanel.tsx:379-387 |
| KUN-88 | „Betreff" (Placeholder „Betreff der E-Mail" / „Re: …", bei Antwort mit „Re: " vorbelegt) | input | – | client-only | KorrespondenzPanel.tsx:389-398, 438-442 |
| KUN-89 | „Nachricht" (Textarea 6 Zeilen, max 20000) | textarea | – | client-only | KorrespondenzPanel.tsx:400-412 |
| KUN-90 | „📤 Senden" / „Sende…" | button + confirm (`"E-Mail an … senden?"`) | Versand über sendEmail-Chokepoint; Warn-Toast „Leerer Text" | POST /api/admin/correspondence/send `{customerId, subject?, body, inReplyToMessageId?}` → refresh | KorrespondenzPanel.tsx:345-375, 420-422 |
| KUN-91 | „👁 Vorschau" (EmailPreviewButton) | button → dialog | Schlichte Text-Vorschau | POST /api/admin/correspondence/email-preview `{body}` | KorrespondenzPanel.tsx:423-429 |
| KUN-92 | „Abbrechen" | button | Schließt Composer | client-only | KorrespondenzPanel.tsx:430-432 |
| KUN-93 | Leerzustand „Sobald du eine E-Mail schreibst oder der Kunde antwortet, erscheint hier der Verlauf." | display | – | – | KorrespondenzPanel.tsx:157-163 |
| KUN-94 | Thread-Karte: Betreff („(kein Betreff)") + „↩ Antworten" | display + button | Antwort auf letzte Nachricht des Threads | client-only | KorrespondenzPanel.tsx:179-202 |
| KUN-95 | Nachrichtenzeile: Badge „Eingegangen"/„Gesendet", Snippet („(kein Vorschautext)"), 📎 N, Datum/Zeit, ▸/▾ | button (expand) | Lädt Body lazy beim Aufklappen | POST /api/admin/correspondence/message `{id}` | KorrespondenzPanel.tsx:204-275 |
| KUN-96 | Aufgeklappt: „Von … · An … · Marketing-Versand", „Lade Inhalt…", Body (Markdown) / „Kein Inhalt." / „Kein Textinhalt.", Anhang-Badges | display | – | – | KorrespondenzPanel.tsx:277-322 |
| **Sub-Tab Brief (PhysicalLetterPanel)** ||||||
| KUN-97 | Kopf „📮 Brief (Postversand)" | display | – | – | PhysicalLetterPanel.tsx:210-212 |
| KUN-98 | „✨ Brief-Entwurf generieren" / „Neu generieren" / „Generiere…" | button | KI-Briefentwurf, danach automatisch PDF-Vorschau | POST /api/admin/customers/letter-draft `{customerId, adminInstructions}` + POST /api/admin/customers/letter-preview | PhysicalLetterPanel.tsx:152-167, 213-215 |
| KUN-99 | „Hinweise für den Brief (optional)" (Textarea 2 Zeilen, max 2000) | textarea | Anweisungen | client-only | PhysicalLetterPanel.tsx:224-236 |
| KUN-100 | „Betreff" (Placeholder „Briefbetreff") | input | – | client-only | PhysicalLetterPanel.tsx:240-249 |
| KUN-101 | „Brieftext (bearbeitbar)" (Textarea 10 Zeilen, max 20000) | textarea | – | client-only | PhysicalLetterPanel.tsx:250-261 |
| KUN-102 | „💾 Entwurf speichern" / „Speichere…" | button | Persistiert Briefentwurf | POST /api/admin/customers/letter-draft `{customerId, save:true, subject, body}` | PhysicalLetterPanel.tsx:169-180, 263-265 |
| KUN-103 | „👁 Vorschau aktualisieren" / „Aktualisiere…" | button | Rendert PDF neu (blob → iframe) | POST /api/admin/customers/letter-preview `{customerId, subject, body}` | PhysicalLetterPanel.tsx:128-150, 266-272 |
| KUN-104 | „📤 Brief senden" / „Übermittle…" (disabled mit title = Grund) | button + confirm (`"Brief an … über Pingen versenden?"`) | Speichert, dann Versand an Pingen; Toast „Brief übermittelt" | POST letter-draft save + POST /api/admin/physical/send `{customerId}` → refresh | PhysicalLetterPanel.tsx:182-202, 273-275 |
| KUN-105 | „PDF-Vorschau" iframe (520px, title „Brief-Vorschau") | display (iframe) | Druckvorschau | blob URL | PhysicalLetterPanel.tsx:279-291 |
| KUN-106 | Grund-Text unter Buttons (physicalReason vom Server / „Zuerst einen Brief-Entwurf generieren.") | display | Warum Senden gesperrt | server-render (`physicalEligibilityForCustomer`) | PhysicalLetterPanel.tsx:204-205, 296 |
| KUN-107 | „Noch kein Brief versendet." / „Gesamt: N Brief(e) · Porto ~X €" + Liste (Status-Badge Angelegt/Übermittelt/In Warteschlange/Wird gedruckt/Gedruckt/Versendet/Fehler/Storniert/Unzustellbar, Datum, „Betreff", Ort, Kosten, Fehler) | display | Briefhistorie | server-render | PhysicalLetterPanel.tsx:46-73, 298-323 |

### Helper/explanatory text (Kunden) — 62
Unmatched-Queue / Workspace:
1. „Antworten von Adressen, die zu keinem Kunden passen. Ordne jede einem Kunden zu — sie wandert…" — UnmatchedInboundQueue.tsx:65-68
2. Placeholder „z. B. müller oder @gmail" — KundenWorkspace.tsx:249
3. „Keine Kunden für diese Suche/Filter." — KundenWorkspace.tsx:341
4. „Wähle links einen Kunden, um Profil, Käufe, Marketing & mehr zu sehen." — KundenWorkspace.tsx:367
5. „Alle bestätigten (N) für Sammel-Entwurf" — KundenWorkspace.tsx:330
6. „Erstellt je Kund:in einen Entwurf zur Prüfung — es wird nichts gesendet." — KundenWorkspace.tsx:407-410
7. Toast „N Entwurf/Entwürfe zur Prüfung erstellt — sichtbar im Marketing-Tab des Kunden." — KundenWorkspace.tsx:211
8. Toast „Alle N fehlgeschlagen — z. B. …" / „N von M erstellt, K fehlgeschlagen…" — KundenWorkspace.tsx:217, 223
CustomerProfileCard:
9. „Zuerst: … · Zuletzt: …" — CustomerProfileCard.tsx:327
10. title „Identitätsstufe" — :331
11. title „Mehrere Sessions unter derselben E-Mail" — :335
12. „Noch kein Profil generiert." — :377
13. „Jede Generierung ist ein KI-Durchlauf (Anthropic Claude) über alle verknüpften Gespräche + Kaufhistorie und kostet Tokens." + „Letzter Lauf: …" — :380-388
14. „Keine Konversation verknüpft — die E-Mail wurde erfasst, aber die zugehörige Session ist nicht (mehr) gespeichert." — :399-400
15. „noch nicht geladen" (Meta Käufe) — :422
16. „Noch keine Kaufhistorie geladen." — :525
17. „Keine Bestellungen unter dieser E-Mail gefunden." — :532
18. „Liste ggf. gekürzt (nur die neuesten Bestellungen)." — :576
19. „Kein lesbares Transkript." — :618
20. „Keine Marketing-Einwilligung — es kann keine Marketing-E-Mail generiert werden." — :637
21. „Double-Opt-In noch nicht bestätigt — bis dahin keine Marketing-E-Mail." — :638
22. „Abgemeldet — es wird keine Marketing-E-Mail mehr generiert oder gesendet." — :639
23. Toast „Rabatt, Textmodus oder Hinweise geändert" / „Bitte zuerst neu generieren, damit Text und Eingaben übereinstimmen." — :779-780
24. „Du kannst unten jederzeit eine neue personalisierte E-Mail generieren." — :833
25. Placeholder „z. B. "Erwähne die neue Rudergeräte-Linie", "Bundle anbieten", "Sie hatte nach Lieferung nach Österreich gefragt"" — :861-862
26. „Wird der KI als Team-Anweisung mitgegeben (klar getrennt von den Kundendaten) und am Entwurf gespeichert (Audit-Trail)." — :866-867
27. „0 = kein Rabatt, kein Code" / „0–50 %" — :892-893
28. Textmodus-Hinweis (EMAIL_TEXT_MODE_HINTS: „Mehr Text: 3–5 kurze Absätze, die das Kundenwissen einweben." / „Kurze Begrüßung + 2–3 Sätze — die Produktbilder tragen die Botschaft." / „Nur Anrede + ein Satz — die E-Mail wirkt wie ein visuelles Lookbook.") — :904, src/lib/email-text-mode.mjs:43-47
29. „Rabatt, Textmodus oder Hinweise geändert — der aktuelle Text passt nicht mehr." — :913
30. „Vorschau mit Platzhalter-Code MO-XXXX. Den Platzhalter im Text bitte nicht ändern — er wird beim Versand durch den echten, einmaligen N%-Code (7 Tage gültig) ersetzt." — :921
31. „Kein Rabatt gewählt — der Text nennt keinen Code, der Warenkorb-Link enthält keinen Rabatt." — :922
32. „Beim Versand werden Warenkorb-Button & Abmeldelink automatisch angehängt [und der einmalige Rabattcode erzeugt]. Gesendet wird nur an bestätigte, nicht abgemeldete Adressen." — :947-949
33. Vorschau-Dialogtext „So wird die E-Mail im Postfach gerendert (inkl. Produktbilder, Bundle und Footer). Der Rabatt zeigt den Platzhalter-Code MO-XXXX — …" / „Der getrackte Warenkorb-Link entsteht erst beim Senden." — :970-973
34. title „Bitte zuerst neu generieren" — :980
35. „Der Entwurf nutzt ALLES zu diesem Kunden: alle verknüpften Gespräche, das aktuelle Kundenverständnis und die Kaufhistorie (bereits Gekauftes wird nicht erneut empfohlen). Ein KI-Durchlauf — kostet Tokens." — :997-999
36. „KI-Durchlauf über Profil, Gespräche & Käufe — kostet Tokens." — :1327
37. Toast „N Produkte — du kannst frei anpassen." — :1157
38. „Komponentensumme: …" — :1371
39. „Ausverkauft — nicht hinzufügbar" (disableReason) — :1390
40. „⚠ Preis über der Komponentensumme (X) — es wird KEINE „statt"-Zeile angezeigt (das Bundle ist nicht günstiger als die Einzelprodukte)." — :1441-1442
41. Toast „Ein Bundle braucht 2–5 Produkte." / „Bitte einen Bundle-Preis größer als 0 € angeben." — :1188, 1192
42. Toast „An die E-Mail angehängt. Tipp: E-Mail neu generieren, damit der Text das Set erwähnt." / „Es wird an die nächste generierte E-Mail angehängt." — :1259-1260
43. „Bundles für <email> (N)" — :1456
44. „Erstellt <Datum> · läuft ab <Datum>" — :1476-1477
45. Confirm „Dieses Bundle wirklich archivieren? Der Angebots-Link wird ungültig." — :1271
46. Confirm „Dieses Bundle wirklich löschen? Es kann nicht wiederhergestellt werden." — :1290
47. Confirm „Diesen Entwurf wirklich löschen? Er kann nicht wiederhergestellt werden." — :756
48. Confirm „E-Mail an <email> wirklich senden?" — :784
KorrespondenzPanel:
49. „Noch keine E-Mails mit diesem Kunden." / „N Nachricht(en) in M Thread(s)." — KorrespondenzPanel.tsx:137-138
50. „Sobald du eine E-Mail schreibst oder der Kunde antwortet, erscheint hier der Verlauf." — :160-161
51. „(kein Vorschautext)" / „(kein Betreff)" — :264, 186
52. „Von … · An … · Marketing-Versand" — :280-281
53. „Lade Inhalt…" / „Kein Inhalt." / „Kein Textinhalt." — :284, 298, 309
54. Placeholder „Deine Nachricht an den Kunden…" — :411
55. „Wird über den zentralen Versandweg gesendet (Absender: motion sports). Antworten des Kunden landen wieder hier im Verlauf." — :413-417
56. Vorschau-Dialogtext „So wird deine Nachricht beim Kunden gerendert — bewusst schlichtes Text-Layout ohne Marketing-Elemente." — :427
57. Toast „Bitte einen Nachrichtentext eingeben." — :347
PhysicalLetterPanel:
58. „Eigener, für den Druck optimierter Text (kein Warenkorb-Button, kein Abmeldelink). Wird als PDF gerendert und über Pingen an die hinterlegte Postadresse versendet." — PhysicalLetterPanel.tsx:218-221
59. Placeholder „z. B. "Lieferung nach Österreich erwähnen", "auf die neue Rudergeräte-Linie hinweisen"" — :235
60. „Nach Textänderungen „Vorschau aktualisieren" klicken. Ohne hinterlegte Adresse zeigt die Vorschau einen Platzhalter im Adressfeld." — :287-290
61. „Zuerst einen Brief-Entwurf generieren." / Server-Grund (`physicalReason`) — :205, 296
62. „Noch kein Brief versendet." / „Gesamt: N Brief(e) · Porto ~X €" — :300, 68-71

### Persistenter Zustand (Kunden)
- URL: `?tab=kunden` (+ `?filter=` Preset nur als initialer Seed; Filteränderungen werden NICHT in die URL geschrieben).
- Kein localStorage/Cookie. Alle Filter/Auswahl/Sub-Tab-Zustände sind flüchtiger React-State (Sub-Tab-Zustand geht beim Kundenwechsel verloren, da `key={id}`).
- Serverseitig persistiert: adminInstructions am Draft, letterDraftSubject/Body am Kunden.

---

## 4. Kampagne (`KampagneTab.tsx`, `KampagneWorkspace.tsx`)

### Beschreibung
Review-Warteschlange für personalisierte E-Mails an Shopify-Marketing-Abonnent:innen (docs/CAMPAIGNS.md). `KampagneTab` (Server) lädt parallel `getCampaignCounts()`, `listDraftedQueue()`, `listCampaignSendHistory()`, `listSkippedContacts()` (campaign-store), löst empfohlene Produkte via `resolveProductSelections`, holt aktive Bundles per `listActiveBundlesForCampaignContacts`, prüft Rabattcode-Einlösung via `wasDiscountCodeRedeemed` (max. 30 Codes, nur wenn Shopify konfiguriert) und reicht Flags `isCampaignSendsApproved()`, `isSingleOptInAllowed()`, `isShopifyConfigured()` durch. `KampagneWorkspace` (Client) zeigt EINE Karte pro Kontakt (links Kontext: Sprache, Textmodus, Opt-in, Segment, A/B, Kaufhistorie mit Empfehlungsbasis, Empfehlungen, Rabatt, Set-Angebot; rechts editierbarer Betreff/Text mit debounced Autosave, Hero-Panel, Aktionen). Sub-Views „Warteschlange"/„Gesendet", Opt-in-Filter, linke Rail mit globaler Kontaktsuche, Warteschlangen-Liste und „Übersprungen". Tastenkürzel N/P/V/C/S/X. Mehrere Aktionen laden die Seite komplett neu (`window.location.reload()`).

### Controls & actions
| ID | Element | Type | What it does | Calls | File:line |
|---|---|---|---|---|---|
| KAM-01 | Banner „Keine Datenbank konfiguriert (DATABASE_URL) — das Kampagnen-Modul kann keine Kontakte laden." | display (warn) | – | server-render | KampagneTab.tsx:35-42 |
| KAM-02 | Warnbox „Versand gesperrt: Die anwaltliche Freigabe … CAMPAIGN_SENDS_APPROVED=false …" | display (warn) | Senden deaktiviert | server flag | KampagneWorkspace.tsx:1091-1098 |
| KAM-03 | Infobox „Shopify ist nicht konfiguriert — Sync, Kaufhistorie und Rabattcodes sind deaktiviert." | display (info) | – | server flag | KampagneWorkspace.tsx:1099-1104 |
| **Kopfzeile: Zähler + Aktionen** ||||||
| KAM-04 | HeaderStats „Offen", „Entwürfe", „Heute gesendet", „Übersprungen", „Unterdrückt", „Entwurf fehlgeschlagen" (warn, nur >0) | display (stat) | `getCampaignCounts` | server-render | KampagneWorkspace.tsx:1108-1115, 2213-2219 |
| KAM-05 | „Opt-in: DOI n · Single-Opt-in n · Unbekannt n" | display | byOptInLevel | server-render | KampagneWorkspace.tsx:1116-1121, 2321-2330 |
| KAM-06 | „↻ Sync" / „Sync läuft…" (disabled ohne Shopify) | button | Shopify-Abonnent:innen abgleichen; Toast mit total/neu/unterdrückt; reload | POST /api/admin/campaign/sync `{}` | KampagneWorkspace.tsx:938-969, 1123-1131 |
| KAM-07 | Select „Rabatt-Tiefe für neue Entwürfe" (0 % Rabatt / 5 / 10 / 15 / 20 %) | select | Depth für Prepare/Draft/Unskip | client-only | KampagneWorkspace.tsx:1133-1145 |
| KAM-08 | Select „Textmodus für neue Entwürfe" (Ausführlich/Kompakt/Minimal; title „Wie viel Fließtext…") | select | Textmodus für Prepare/Draft | client-only | KampagneWorkspace.tsx:1146-1157 |
| KAM-09 | „Nächste 50 vorbereiten" / Fortschritt „k/50…" | button | 10 Chunks à 5 Drafts; Abschluss-Toast „N Entwürfe erstellt / k fehlgeschlagen, m unterdrückt"; reload | POST /api/admin/campaign/prepare `{count:5, discountPercent, textMode}` | KampagneWorkspace.tsx:999-1039, 1158-1162 |
| KAM-10 | „Warteschlange neu aufbauen" / „Setzt zurück…" | button → dialog | Öffnet Bestätigungsdialog | client-only | KampagneWorkspace.tsx:1164-1171 |
| KAM-11 | Dialog „Warteschlange neu aufbauen?" (Text + „Abbrechen" / „Entwürfe verwerfen") | dialog | Verwirft alle offenen Drafts; Toast „N Entwürfe verworfen"; reload | POST /api/admin/campaign/reset-queue `{}` | KampagneWorkspace.tsx:974-997, 1426-1447 |
| **Sub-View + Filter** ||||||
| KAM-12 | „Warteschlange (n[/m])" | sub-tab (button) | Queue-Ansicht | client-only | KampagneWorkspace.tsx:1177-1184 |
| KAM-13 | „Gesendet (N)" | sub-tab (button) | Historie-Ansicht | client-only | KampagneWorkspace.tsx:1185-1191 |
| KAM-14 | Opt-in-Filter „Alle" / „Nur DOI" / „Nur Single/Unbekannt" | filter (buttons) | Filtert Arbeitsansicht, Index → 0 | client-only | KampagneWorkspace.tsx:1194-1211, 317-320 |
| KAM-15 | Tasten-Hinweis „Tasten: N weiter · P zurück · V Vorschau · C kopieren · S senden · X überspringen" | display | – | – | KampagneWorkspace.tsx:1212-1215 |
| KAM-16 | Tastenkürzel N/P/C/S/X/V (nur Queue-View, nicht in Inputs, nicht bei offenem Dialog, kein Modifier) | keyboard shortcut | weiter/zurück/kopieren/senden/überspringen/Vorschau | client-only | KampagneWorkspace.tsx:1042-1086 |
| **Linke Rail (QueueRail)** ||||||
| KAM-17 | Suchfeld „Alle Kontakte durchsuchen…" (≥2 Zeichen, 250 ms Debounce) | input (search) | Globale Kontaktsuche über alle Status | POST /api/admin/campaign/contacts `{query}` | KampagneWorkspace.tsx:1828-1853, 1891-1897 |
| KAM-18 | „Sucht…" / „Keine Treffer." | display | – | – | KampagneWorkspace.tsx:1898-1903 |
| KAM-19 | Trefferzeile (Name, E-Mail) + Statusaktion: „Öffnen" (drafted) | button | Springt zur Karte, hebt Opt-in-Filter auf | client-only | KampagneWorkspace.tsx:1858-1865, 324-331 |
| KAM-20 | Statusaktion „Entwurf erstellen" (pending/draft_failed) | button | Draft erzeugen + reload | POST /api/admin/campaign/draft `{contactId, discountPercent, textMode, regenerate:true}` | KampagneWorkspace.tsx:491-519, 1866-1872 |
| KAM-21 | Statusaktion „Wiederherstellen" (skipped) | button | Unskip (+Draft falls pending) + reload | POST /api/admin/campaign/unskip `{contactId}` (+ /draft) | KampagneWorkspace.tsx:453-486, 1873-1878 |
| KAM-22 | Status-Badges „Gesendet" / „Unterdrückt" / `<status>` | badge | – | – | KampagneWorkspace.tsx:1879-1885 |
| KAM-23 | „Warteschlange (N)" Liste: „i. Name" (+ ⚠ title „Kein nachweisbares Double-Opt-in"), aktiver Eintrag hervorgehoben, „Leer." | list (buttons) | Sprung zur Karte | client-only | KampagneWorkspace.tsx:1922-1953 |
| KAM-24 | „Übersprungen (N) ▸/▾" | button (collapse) | Zeigt übersprungene Kontakte | client-only | KampagneWorkspace.tsx:1956-1962 |
| KAM-25 | Übersprungen-Zeile + „Wiederherstellen"; leer „Keine übersprungenen Kontakte." | list + button | Unskip | POST /api/admin/campaign/unskip | KampagneWorkspace.tsx:1963-1987 |
| **Karte: Navigation** ||||||
| KAM-26 | Infobox „Keine Entwürfe in der Warteschlange. „Sync" holt …" | display (info) | Leerzustand | – | KampagneWorkspace.tsx:1233-1238 |
| KAM-27 | „Entwurf i von N" | display | Position | – | KampagneWorkspace.tsx:1243-1245 |
| KAM-28 | „← Zurück" / „Weiter →" | button | Index ±1 | client-only | KampagneWorkspace.tsx:1247-1264 |
| **Karte links: Kontakt-Kontext** ||||||
| KAM-29 | Name („(kein Name)") + E-Mail | display | – | server-render | KampagneWorkspace.tsx:1272-1276 |
| KAM-30 | LanguageToggle „DE"/„EN" (+ „✎" bei Override; title erklärt Ableitung) | toggle | Setzt Sprach-Override, dann Regenerate | POST /api/admin/campaign/language `{contactId, language}` + /draft | KampagneWorkspace.tsx:759-790, 1279-1284, 2224-2268 |
| KAM-31 | EmailTextModeToggle (Ausführlich/Kompakt/Minimal) | toggle (shared) | Wechselt Modus + Regenerate | POST /api/admin/campaign/draft `{…, textMode}` | KampagneWorkspace.tsx:795-817, 1285-1289 |
| KAM-32 | OptInBadge „Double-Opt-in" (success) / „Single-Opt-in|Unbekannt · Senden blockiert" (warning) | badge | – | – | KampagneWorkspace.tsx:2309-2319 |
| KAM-33 | SegmentBadge (Label aus `campaignSegmentByKey`, „· vor N T.", title = Grund) | badge | Lifecycle-Segment | – | KampagneWorkspace.tsx:2295-2307 |
| KAM-34 | AbGroupBadge „A/B: mit KI-Hero" / „A/B: ohne Hero" (title erklärt gerade/ungerade IDs) | badge | Hero-A/B-Hinweis | – | KampagneWorkspace.tsx:2283-2293 |
| KAM-35 | Badge „⚠ Empfehlungen unsicher" | badge | lowConfidence | – | KampagneWorkspace.tsx:1293-1298 |
| KAM-36 | „N Bestellungen · X € Umsatz" | display | – | – | KampagneWorkspace.tsx:1300-1303 |
| **Kaufhistorie (PurchaseHistorySection)** ||||||
| KAM-37 | „Kaufhistorie" + Checkbox „Alle" (tri-state, nur bei >1 wählbaren) | display + checkbox | Empfehlungsbasis alle/keine | client-only | KampagneWorkspace.tsx:1553-1569 |
| KAM-38 | Bestellungen (Name · Datum, Summe) mit Checkbox je katalog-gematchtem Artikel („n× Titel"), nicht-matchbare nur Text | list + checkbox | Auswahl der Basis | client-only | KampagneWorkspace.tsx:1570-1613 |
| KAM-39 | „Keine Bestelldetails verfügbar." | display | – | – | KampagneWorkspace.tsx:1615 |
| KAM-40 | „Empfehlungsbasis: k von n Käufen ausgewählt." / „Ausgewählte Käufe sind die Basis für Empfehlungen und Text." | display | – | – | KampagneWorkspace.tsx:1617-1623 |
| KAM-41 | „Kaufauswahl wird nach „Neu generieren" verfügbar." | display | Legacy-Draft | – | KampagneWorkspace.tsx:1624-1628 |
| KAM-42 | „↻ Empfehlungen & Text neu erzeugen" / „Erzeugt neu…" (bei dirty) | button | Persistiert Auswahl, Recs + Text neu | POST /api/admin/campaign/draft `{…, refreshRecommendations:true, purchaseSelection}` | KampagneWorkspace.tsx:867-892, 1631-1638 |
| KAM-43 | „Verwerfen" + Warnung „Mindestens einen Kauf auswählen." | button + display | Auswahl zurücksetzen | client-only | KampagneWorkspace.tsx:1639-1649 |
| **Empfehlungen (RecommendationsEditor)** ||||||
| KAM-44 | „Empfohlene Produkte · speichert…" | display | – | – | KampagneWorkspace.tsx:2014-2016 |
| KAM-45 | Liste Produktname (Link zu Shopify, target=_blank) + „✕" entfernen (disabled bei ≤1) / „Keine." | list + button | Entfernen → sofort persistiert + Bundle-Rebuild + Regenerate | POST /api/admin/campaign/recommendations `{contactId, productIds}` + /draft | KampagneWorkspace.tsx:821-862, 2017-2047 |
| KAM-46 | CatalogProductPicker (Placeholder „Produkt suchen (tippen)…", max 6, ohne Thumbnails, Variantenwahl → `handle~variantId`) | input (search) | Produkt hinzufügen | POST /api/admin/catalog/search + /recommendations | KampagneWorkspace.tsx:2049-2078 |
| **Rabatt (DiscountControl)** ||||||
| KAM-47 | „Rabatt" Zahlenfeld (0–50) + „%" | input (number) | Depth | client-only | KampagneWorkspace.tsx:2108-2120 |
| KAM-48 | „Übernehmen" / „Speichert…" (disabled wenn unverändert) | button | Setzt Rabatt am Draft + Regenerate; Toast „Rabatt auf N % gesetzt"/„Rabatt entfernt" | POST /api/admin/campaign/discount `{contactId, discountPercent}` + /draft | KampagneWorkspace.tsx:897-936, 2121-2128 |
| KAM-49 | Hinweistext „Aktuell N % — echter MK-Code wird beim Senden erzeugt (voraussichtlich gültig bis …). …" / „Kein Rabatt. …" | display | – | – | KampagneWorkspace.tsx:2130-2140 |
| **Set-Angebot (BundleSection)** ||||||
| KAM-50 | Angehängtes Set: Titel, Komponenten „A + B", Preis „(statt …)", „· läuft ab …" | display | – | server-render | KampagneWorkspace.tsx:1689-1711 |
| KAM-51 | „Set entfernen (archivieren)" | button | Archiviert Bundle + Regenerate | POST /api/admin/bundles/archive `{id}` + /draft | KampagneWorkspace.tsx:710-732, 1712-1720 |
| KAM-52 | „Keine Empfehlungen, aus denen ein Set gebaut werden könnte." / „Shopify nicht konfiguriert — keine Set-Angebote möglich." | display | – | – | KampagneWorkspace.tsx:1726-1737 |
| KAM-53 | Composer: Checkbox je Empfehlung (vorausgewählt), Input „Set-Preis € (optional)" | checkbox + input | Zusammensetzung/Preis | client-only | KampagneWorkspace.tsx:1743-1770 |
| KAM-54 | „Set aus Empfehlungen erstellen" / „Erstellt…" | button | Erstellt Bundle mit campaignContactId + Regenerate | POST /api/admin/bundles/create `{campaignContactId, components, bundlePriceOverride?}` + /draft | KampagneWorkspace.tsx:659-708, 1771-1778 |
| **Karte rechts: Entwurf + Aktionen** ||||||
| KAM-55 | Betreff (aria „Betreff") | input | Autosave 600 ms debounced | POST /api/admin/campaign/update `{contactId, subject, body}` | KampagneWorkspace.tsx:343-362, 1344-1348 |
| KAM-56 | E-Mail-Text (Textarea 16 Zeilen, mono; aria „E-Mail-Text") | textarea | Autosave wie oben | dito | KampagneWorkspace.tsx:1349-1355 |
| KAM-57 | Hero-Bild-Panel (kind=campaign, targetId=contactId; siehe HERO-*) | panel | – | /api/admin/email-hero* | KampagneWorkspace.tsx:1362-1367 |
| KAM-58 | Warnbox „Erneute Einwilligung erforderlich: … Senden ist blockiert; Kopieren ist möglich." | display (warn) | optInBlocked | – | KampagneWorkspace.tsx:1369-1376 |
| KAM-59 | „📤 Senden" / „Sendet…" (disabled bei sendBlocked) | button | Versand; erste Sendung des Tages → Bestätigungsdialog; Toast „Gesendet an …"; Karte entfernt, auto-advance | POST /api/admin/campaign/send `{contactId}` | KampagneWorkspace.tsx:378-418, 1380-1383 |
| KAM-60 | Dialog „Ersten Versand heute bestätigen" („Abbrechen" / „Jetzt senden") | dialog | Einmal täglich (localStorage `ms-campaign-first-send`) | POST /api/admin/campaign/send | KampagneWorkspace.tsx:173-192, 1462-1479 |
| KAM-61 | „👁 Vorschau" / „Lädt…" (title „Gerenderte E-Mail-Vorschau (inkl. …)") | button → dialog | HTML-Vorschau der aktuellen (ggf. ungespeicherten) Karte | POST /api/admin/campaign/email-preview `{contactId, subject, body}` | KampagneWorkspace.tsx:523-532, 1384-1392 |
| KAM-62 | „📋 Kopieren" | button | Betreff + Text (Markdown→Text) in Zwischenablage; Toast mit MO-XXXX-Warnung | `navigator.clipboard` (client-only) | KampagneWorkspace.tsx:550-569, 1393-1396 |
| KAM-63 | „✓ Als erledigt markieren" (nur nach Kopieren) | button | Markiert als kopiert versendet; Karte entfernt | POST /api/admin/campaign/mark-done `{contactId}` | KampagneWorkspace.tsx:571-588, 1397-1402 |
| KAM-64 | „↻ Neu generieren" / „Generiert…" | button | Regenerate mit aktueller Depth | POST /api/admin/campaign/draft `{contactId, discountPercent, regenerate:true}` | KampagneWorkspace.tsx:734-752, 1403-1410 |
| KAM-65 | „⏭ Überspringen" | button | Skip → Rail „Übersprungen"; auto-advance | POST /api/admin/campaign/skip `{contactId}` | KampagneWorkspace.tsx:420-447, 1412-1415 |
| KAM-66 | E-Mail-Viewer-Dialog (95vw × 92vh, Titel/Beschreibung, EmailPreviewFrame mit Desktop/Mobil) | dialog (iframe) | Vorschau + gesendete Inhalte | blob URL | KampagneWorkspace.tsx:1450-1459 |
| **Gesendet-Ansicht (SentHistory)** ||||||
| KAM-67 | Infobox „Noch keine Kampagnen-E-Mails gesendet." | display | – | – | KampagneWorkspace.tsx:2154-2160 |
| KAM-68 | Tabelle Empfänger / Betreff / Via (Badge „Kopiert"/„E-Mail") / Code (mono) / Eingelöst (— ? ✓ ✗) / Gesendet / Inhalt | table | Historie mit Einlösestatus | server-render (`listCampaignSendHistory`, `wasDiscountCodeRedeemed`) | KampagneWorkspace.tsx:2162-2209 |
| KAM-69 | „👁 Ansehen" (nur hasContent) / „—" (title „Für diesen Versand wurde kein Inhalt gespeichert…") | button → dialog | Zeigt gespeicherten Versandinhalt | POST /api/admin/campaign/sent-email `{sendId}` | KampagneWorkspace.tsx:535-548, 2190-2203 |

### Helper/explanatory text (Kampagne) — 44
1. „Keine Datenbank konfiguriert (DATABASE_URL) — das Kampagnen-Modul kann keine Kontakte laden." — KampagneTab.tsx:38-39
2. „Versand gesperrt: Die anwaltliche Freigabe für diesen Kanal steht aus (CAMPAIGN_SENDS_APPROVED=false). Entwürfe, Vorschau und Kopieren funktionieren; der Senden-Button bleibt deaktiviert und der Server lehnt jeden Versand ab." — KampagneWorkspace.tsx:1093-1096
3. „Shopify ist nicht konfiguriert — Sync, Kaufhistorie und Rabattcodes sind deaktiviert." — :1101-1102
4. aria „Rabatt-Tiefe für neue Entwürfe" — :1137
5. aria „Textmodus für neue Entwürfe" / title „Wie viel Fließtext die KI über den Produktkacheln schreibt." — :1150-1152
6. „Tasten: N weiter · P zurück · V Vorschau · C kopieren · S senden · X überspringen" — :1213-1214
7. „Keine Entwürfe in der Warteschlange. „Sync" holt die Shopify-Abonnent:innen, „Nächste 50 vorbereiten" erzeugt die Entwürfe — oder über die Kontaktsuche links eine:n einzelne:n Kund:in aufnehmen." — :1235-1237
8. „Entwurf i von N" — :1244
9. „Empfehlungen unsicher" — :1296
10. „N Bestellungen · X Umsatz" — :1301-1302
11. „Produktbilder-Raster, Mo-Hinweis (Deep-Link), Rabattzeile und Abmelde-/Impressum-Footer werden beim Versand automatisch angehängt und sind hier nicht editierbar." — :1357-1359
12. „Erneute Einwilligung erforderlich: Für diesen Kontakt liegt kein nachweisbares Double-Opt-in vor (…). Senden ist blockiert; Kopieren ist möglich." — :1371-1374
13. title „Gerenderte E-Mail-Vorschau (inkl. Produktbilder, Mo-Hinweis, Rabattzeile und Footer)" — :1388
14. Dialog „Alle N offenen Entwürfe werden verworfen — auch manuelle Änderungen an Betreff/Text gehen verloren. Die Kontakte werden wieder „Offen" und mit „Nächste 50 vorbereiten" neu generiert (erneute API-Kosten). Gesendete, übersprungene und unterdrückte Kontakte sowie angehängte Set-Angebote bleiben unberührt." — :1431-1435
15. Dialog „Du startest den heutigen Kampagnen-Versand: Die E-Mail geht an <email>. Weitere Sendungen heute werden nicht mehr einzeln bestätigt." — :1467-1469
16. Vorschau-Beschreibung „So wird die E-Mail im Postfach gerendert. Der Rabatt zeigt den Platzhalter-Code MO-XXXX — der echte MK-Code wird erst beim Senden erzeugt." — :527-528
17. Gesendet-Beschreibung „Kopier-Versand — gespeichert ist der kopierte Text (kein HTML verschickt)." / „Genau dieser Inhalt wurde verschickt." — :541-542
18. Toast „Achtung: Der Text enthält den Platzhalter-Code MO-XXXX — beim Kopier-Versand wird KEIN echter Code erzeugt." / „Betreff + Text kopiert. Danach „Als erledigt markieren" klicken." — :563-564
19. Toast „Kontakte sind wieder „Offen" — mit „Nächste 50 vorbereiten" neu generieren. Seite wird neu geladen…" — :986
20. Toast Sync „Abonnent:innen werden abgeglichen." / „N Abonnent:innen (k neu, m unterdrückt). Seite wird neu geladen…" — :943, 955
21. „Kaufhistorie" / Checkbox-Label „Alle" — :1554, 1566
22. „Keine Bestelldetails verfügbar." — :1615
23. „Empfehlungsbasis: k von n Käufen ausgewählt." / „Ausgewählte Käufe sind die Basis für Empfehlungen und Text." — :1620-1621
24. „Kaufauswahl wird nach „Neu generieren" verfügbar." — :1626
25. „Mindestens einen Kauf auswählen." — :1648
26. „Set-Angebot" … „(statt …)" „· läuft ab …" — :1696-1710
27. „Keine Empfehlungen, aus denen ein Set gebaut werden könnte." / „Shopify nicht konfiguriert — keine Set-Angebote möglich." — :1732-1733
28. Placeholder „Set-Preis € (optional)" / aria „Set-Preis (optional, sonst Summe der Einzelpreise)" — :1764, 1768
29. „Erstellt ein echtes (unlisted) Shopify-Set über den bestehenden Bundle-Mechanismus; der Text wird automatisch neu generiert und der Angebots-Block beim Versand angehängt." — :1781-1783
30. Placeholder „Alle Kontakte durchsuchen…" / aria „Alle Kampagnen-Kontakte durchsuchen" — :1894, 1896
31. „Sucht…" / „Keine Treffer." / „Leer." / „Keine übersprungenen Kontakte." — :1898, 1902, 1950, 1966
32. title „Kein nachweisbares Double-Opt-in" (⚠ in Rail) — :1941
33. „Empfohlene Produkte · speichert…" / „Keine." — :2015, 2046
34. „Änderungen werden sofort gespeichert, ein angehängtes Set wird angepasst und der Text automatisch neu generiert." — :2081-2082
35. disableReason „Speichert…" / „Ausverkauft" — :2067-2068
36. „Aktuell N % — echter MK-Code wird beim Senden erzeugt (voraussichtlich gültig bis …). „Übernehmen" generiert den Text automatisch neu." — :2133-2135
37. „Kein Rabatt. Kann jederzeit gesetzt werden — „Übernehmen" generiert den Text automatisch neu; Code + Rabattzeile werden beim Versand angehängt." — :2138
38. „Noch keine Kampagnen-E-Mails gesendet." — :2157
39. title „Für diesen Versand wurde kein Inhalt gespeichert (vor Einführung der Speicherung gesendet)." — :2199
40. LanguageToggle title „Sprache manuell festgelegt (Sync ändert sie nicht mehr)." / „Sprache aus dem Shopify-Profil abgeleitet — Klick legt sie manuell fest und generiert den Text neu." + „✎" title „Manuell festgelegt" — :2241-2243, 2262
41. AbGroupBadge title „A/B-Test für den KI-Hero: gerade Kontakt-IDs mit Hero senden, ungerade ohne — der KPI-Tab vergleicht beide Gruppen." — :2288
42. SegmentBadge title = `def.reason` aus `src/lib/campaign-segments.mjs` — :2302
43. OptInBadge „· Senden blockiert" — :2316
44. Toast-Titel-Familie (Prozess-Feedback): „Entwurf wird generiert…", „Wiederhergestellt — Entwurf wird generiert…", „Sprache: … — Text wird neu generiert…", „Textmodus: … — Text wird neu generiert…", „Auswahl wird angewendet — Empfehlungen & Text werden neu erzeugt…", „Text wird neu generiert, damit er das Set erwähnt…" — :462, 496, 774, 801, 873, 692

### Persistenter Zustand (Kampagne)
- URL: `?tab=kampagne` (View/Filter/Index NICHT in URL).
- localStorage `ms-campaign-first-send` = heutiges Datum (YYYY-MM-DD) → unterdrückt den Bestätigungsdialog für weitere Sendungen am selben Tag (KampagneWorkspace.tsx:173-192).
- Server-persistiert: Betreff/Text (Autosave), Sprach-Override, Textmodus, Rabatt, Empfehlungen, Kaufauswahl, Hero-Bild.

---

## 5. KPIs (`KpiTab.tsx`, `KpiCharts.tsx`, `KpiDateRangePicker.tsx`, `KpiTopQuestions.tsx`)

### Beschreibung
Reiner Analytics-Tab, Server Component (nur gerendert, wenn `?tab=kpi`; sonst deferred → echte Navigation). ALLE Aggregation läuft server-seitig in `Promise.all` über: `getCoreMetrics(range)`, `getMoRevenue(range)`, `getMoAttributionKpis(range)`, `getAiCostMetrics(range)`, `getPersonaInsights(5)`, `getRecommendationLoop()`, `getMarketingFunnel()`, `getConsentGateFunnel(range)`, `getEmailCaptureFunnel(range)`, `getCampaignKpis(range)`, `getBundleKpis(range)`, `getQaKpis(range)`, `getFeedbackKpis(range)`, `getConversationStats(from,to)`, `getLocaleSplit(range)`, `getAccountActivity(range)`, `getCachedTopQuestionsMap()`, `getPhysicalLetterStats()`. Der Zeitraum kommt aus `?kpiRange=7d|30d|90d|custom` (+`kpiFrom`/`kpiTo`), validiert via `resolveKpiRange`. Drei Client-Inseln: `KpiDateRangePicker` (schreibt nur die URL, `router.push`), `KpiCharts` (Recharts, Skeleton bis Mount, Token-Farben) und `KpiTopQuestions` (einzige Mutation: On-Demand-KI-Lauf). 13 zeitraumabhängige Sektionen, dann Trenner „Gesamtwerte", dann 4 zeitraumunabhängige. Jede Sektion trägt eine „Caveat"-Ehrlichkeitsnotiz.

### Controls & actions
| ID | Element | Type | What it does | Calls | File:line |
|---|---|---|---|---|---|
| KPI-01 | Banner „Keine Datenbank konfiguriert (DATABASE_URL) — es können keine KPIs berechnet werden." | display (warn) | – | server-render | KpiTab.tsx:97-104 |
| **Zeitraum-Picker** ||||||
| KPI-02 | „Zeitraum:" Preset-Buttons „7 Tage" / „30 Tage" / „90 Tage" | button (filter) | `router.push('/admin?tab=kpi&kpiRange=<7d|30d|90d>')` | Navigation (URL) | KpiDateRangePicker.tsx:20-24, 69-83 |
| KPI-03 | „Benutzerdefiniert" (aria-expanded) | button (toggle) | Zeigt Von/Bis | client-only | KpiDateRangePicker.tsx:84-92 |
| KPI-04 | Aktiver Zeitraum-Label (aria-live) | display | `range.label` vom Server | server-render | KpiDateRangePicker.tsx:93-95 |
| KPI-05 | „Von" / „Bis" (type=date, max heute, Von ≤ Bis) | input (date) | Benutzerdefiniert | client-only | KpiDateRangePicker.tsx:100-120 |
| KPI-06 | „Anwenden" (disabled bei ungültig) | button | `?kpiRange=custom&kpiFrom=…&kpiTo=…` | Navigation (URL) | KpiDateRangePicker.tsx:121-130 |
| KPI-07 | Hinweis „Der Zeitraum filtert alle Abschnitte bis zur Markierung „Gesamtwerte"…" | display | – | – | KpiTab.tsx:159-164 |
| **1 Kern-Metriken** ||||||
| KPI-08 | Section „Kern-Metriken" · „Zeitraum: …" | display | – | `getCoreMetrics` | KpiTab.tsx:196-206 |
| KPI-09 | Stats „Chats gesamt", „Ø Nachrichten / Chat", „Abgebrochen" (N · %, hint), „Engagement" (hint) | display (stat) | – | – | KpiTab.tsx:207-220 |
| KPI-10 | Card „Chats pro Tag · <range>" (Area-Chart, Tooltip „Chats") | chart | `core.chatsByDay` | – | KpiTab.tsx:223-232, KpiCharts.tsx:133-186 |
| KPI-11 | Card „Status-Verteilung" (Donut) + Legende Aktiv/Abgebrochen/Konvertiert | chart + display | `core.status` | – | KpiTab.tsx:234-250, KpiCharts.tsx:192-231 |
| KPI-12 | Caveat „Konvertiert" setzt der tägliche Conversion-Sweep… | display | – | – | KpiTab.tsx:252-259 |
| KPI-13 | h4 „In-Chat-Klicks (Buttons im Chat)": Stats „Produkt-/CTA-Klicks" (hint „x pro Chat"), „Add-to-Cart-Klicks" (hint), „Sessions mit Telemetrie" | display | – | – | KpiTab.tsx:261-276 |
| KPI-14 | Caveat Klick-Signale/Event-Namen | display | – | – | KpiTab.tsx:277-282 |
| KPI-15 | h4 „Event-Übersicht (Top 20)" Tabelle Event (code) / Anzahl | table | `core.topEvents` | – | KpiTab.tsx:284-313 |
| KPI-16 | Leer „Noch keine Daten." | display | – | – | KpiTab.tsx:200 |
| **2 Sprachen (DE/EN)** ||||||
| KPI-17 | Section „Sprachen (DE/EN)"; Cards „Chats nach Sprache", „E-Mail-Angaben nach Sprache" (BarList Deutsch/Englisch/Unbekannt (vor Erfassung) mit %) | display (bar list) | `getLocaleSplit` | – | KpiTab.tsx:960-1020 |
| KPI-18 | Caveat Migration 0041/0030; Leer „Noch keine Daten im Zeitraum." / „Noch keine Daten." | display | – | – | KpiTab.tsx:973, 994-998, 1007 |
| **3 Gesprächsqualität (KI-Analyse)** ||||||
| KPI-19 | Stats „Analysiert" (k / n, hint „% Abdeckung"), „Problem-Signale" (hint „unerfüllter Bedarf + abgesprungen"), „Gut gelöst" | display | `getConversationStats` | – | KpiTab.tsx:1040-1065 |
| KPI-20 | Cards „Qualität" / „Themen (Kategorien)" (BarList, top 8; leer „Noch keine analysierten Beratungen.") | display (bar list) | – | – | KpiTab.tsx:1066-1097 |
| KPI-21 | Caveat „Verteilungen umfassen nur Beratungen, die im Gespräche-Tab…"; Leer „Noch keine Beratungen im Zeitraum." | display | – | – | KpiTab.tsx:1037, 1098-1103 |
| **4 Consent-Gate-Funnel (Marketing-Opt-in)** ||||||
| KPI-22 | StageFunnelChart Angezeigt → Akzeptiert | chart | `getConsentGateFunnel` | – | KpiTab.tsx:353-357, KpiCharts.tsx:295-324 |
| KPI-23 | Stats „Angezeigt", „Akzeptiert" (hint „% Akzeptanzrate"), „Abgelehnt", „Weggeklickt" | display | – | – | KpiTab.tsx:358-367 |
| KPI-24 | h4 „Nach Oberfläche": Stats „Chat-Gate (anonym)", „Bei Anmeldung (eingeloggt)" (k / n; hint „% Akzeptanzrate · n abgelehnt · n weggeklickt" bzw. „akzeptiert / angezeigt") | display | – | – | KpiTab.tsx:370-379, 397-410 |
| KPI-25 | Caveat Widget-Events; Leer „Noch keine Daten." / „Noch keine Consent-Gate-Events im Zeitraum." | display | – | – | KpiTab.tsx:347-349, 381-390 |
| **5 E-Mail-Capture-Funnel** ||||||
| KPI-26 | StageFunnelChart Angeboten → Formular gesendet → Marketing-Haken → DOI bestätigt | chart | `getEmailCaptureFunnel` | – | KpiTab.tsx:1153-1158 |
| KPI-27 | Stats „Angeboten", „Formular gesendet" (hint „% der Angebote"), „Marketing-Haken", „DOI bestätigt" (hint „% der Opt-ins") | display | – | – | KpiTab.tsx:1159-1172 |
| KPI-28 | h4 „Angebote nach Auslöser" BarList (Empfehlung angenommen / Vergleich geliefert / Bedenkpause / Kaufabsicht / Checkout-Absicht / Ohne Angabe / Ohne Trigger) | display (bar list) | – | – | KpiTab.tsx:1117-1125, 1175-1188 |
| KPI-29 | Caveat „Ereigniszählung im Zeitraum…, „Abgelehnt" (Karte weggeklickt): N"; Leer „Noch keine Daten." / „Noch keine Capture-Events im Zeitraum." | display | – | – | KpiTab.tsx:1148-1150, 1190-1196 |
| **6 Umsatz über Mo-Rabattcodes** ||||||
| KPI-30 | Stats „Umsatz über Mo-Rabattcodes" (hint „N Bestellung(en) im Zeitraum", ⓘ-Tooltip), „Bestellungen mit Mo-Code" (hint), „Geprüfte Codes" (hint „N versendete Codes im Zeitraum") | display (stat + tooltip) | `getMoRevenue` | – | KpiTab.tsx:433-450 |
| KPI-31 | Caveat (ausschließlich MS5-Codes, read_orders, currentTotalPrice…; + redemptionUnknown, sampled); Leer „Noch keine Daten."; Warn „Shopify ist nicht konfiguriert — der Umsatz kann nicht berechnet werden." | display | – | – | KpiTab.tsx:425-430, 452-468 |
| **7 Mo-zugeordneter Umsatz (Bestell-Webhook)** ||||||
| KPI-32 | Stats „Direkt", „Beraten & gekauft", „Beraten, anderes gekauft" (je hint „N Bestellung(en)" + ⓘ-Tooltip) | display (stat + tooltip) | `getMoAttributionKpis` | – | KpiTab.tsx:506-525 |
| KPI-33 | Caveat (attributes[_mo], Zuordnungsfenster N Tage, Datenminimierung…; + unrealisedOrders); Leer „Noch keine Daten."; Info „Noch keine Bestellung über den Webhook erfasst. Voraussetzung: …" | display | – | – | KpiTab.tsx:494-503, 527-540 |
| **8 Kampagnen-Funnel (Shopify-Subscriber)** ||||||
| KPI-34 | StageFunnelChart Gesendet → Geklickt → Eingelöst | chart | `getCampaignKpis` | – | KpiTab.tsx:1228-1233 |
| KPI-35 | Stats „Gesendet" (hint „n per E-Mail · n kopiert"), „Geklickt" (hint), „Eingelöst (MK-Code)" (hint), „Sprache" (n DE · n EN, hint unbekannt), „Set geklickt" (hint), „Umsatz (MK-Codes)" (hint „x je Send · geprüfte Codes"), „Zugestellt / Bounces" (hint „n hart · n Beschwerde(n)" / „keine Zustellmeldungen (Resend-Webhook?)"), „Abgemeldet" (hint „% der Sends (30 Tage)"), „Bewertung" (x / 5, hint „N Klick-Bewertung(en) (anonym)") | display | – | – | KpiTab.tsx:1234-1304 |
| KPI-36 | Tabelle „Hero-Vergleich: lohnt sich das KI-Bild?" (Variante / Gesendet / Klickrate / Set geklickt / Eingelöst / Umsatz / Umsatz / Send / Hero-Kosten / Kosten / Send / Abgemeldet; Zeilen Mit KI-Hero (individuell) / Standard-Hero / Ohne Hero (klassisch / kopiert) / Unbekannt (vor Migration 0054)) | table | `kpis.byHeroVariant` | – | KpiTab.tsx:1307-1314, 1353-1364, 1371-1445 |
| KPI-37 | Tabelle „Nach Lebenszyklus-Segment" (gleiche Spalten ohne Kosten) | table | `kpis.bySegment` | – | KpiTab.tsx:1315-1322, 1366-1368 |
| KPI-38 | Caveat (Geklickt/Eingelöst-Definition, Resend-Webhook, Migration 0054, A/B-Hinweis…); Leer „Noch keine Daten." / „Noch keine Kampagnen-E-Mails im Zeitraum." | display | – | – | KpiTab.tsx:1223-1225, 1323-1346 |
| **9 Bundle-Angebote** ||||||
| KPI-39 | Stats „Erstellt" (hint „n aktiv · n abgelaufen · n fehlgeschlagen"), „Aktuell aktiv" (hint „unabhängig vom Zeitraum"), „Klicks auf Angebot" (hint „N Angebot(e) geklickt"), „Ø Rabatt-Tiefe" (hint „vs. Summe der Einzelpreise") | display | `getBundleKpis` | – | KpiTab.tsx:1463-1480 |
| KPI-40 | Caveat bundle_offer_clicked / kein Kauf zugerechnet; Leer „Noch keine Daten." / „Noch keine Bundle-Angebote im Zeitraum." | display | – | – | KpiTab.tsx:1458-1460, 1481-1487 |
| **10 Wissen (Q&A-Queue)** ||||||
| KPI-41 | Stats „Lücken gefunden" (hint „im Zeitraum"), „Veröffentlicht" (hint), „Median bis Antwort", „Median bis Veröffentlichung" (Std./Tage) | display | `getQaKpis` | – | KpiTab.tsx:1520-1533 |
| KPI-42 | Stats „Offen", „Beantwortet", „Veröffentlicht" (hint „gesamt"), „Scan-Backlog" (hint „geeignete, noch nicht gescannte Beratungen") | display | – | – | KpiTab.tsx:1534-1543 |
| KPI-43 | Caveat „„Lücken gefunden" = …"; Leer „Noch keine Daten." / „Noch keine Q&A-Einträge." | display | – | – | KpiTab.tsx:1515-1517, 1544-1550 |
| **11 Feedback** ||||||
| KPI-44 | Stats „Eingegangen", „Mit Gesprächsbezug" (hint %), „Mit Kontakt-E-Mail" (hint „antwortbar") | display | `getFeedbackKpis` | – | KpiTab.tsx:1573-1585 |
| KPI-45 | h4 „Nach Kundentyp" BarList | display (bar list) | – | – | KpiTab.tsx:1586-1593 |
| KPI-46 | Caveat „Reines Volumen — …"; Leer „Noch keine Daten." / „Kein Feedback im Zeitraum." | display | – | – | KpiTab.tsx:1568-1570, 1594-1597 |
| **12 Kundenkonto & Self-Service** ||||||
| KPI-47 | Stats „Anmeldungen" (hint „n stille Erkennungen"), „Zusammenfassung per E-Mail", „Zusammenfassung (Download)", „Kontaktformular", „Datenexporte" (hint „Art. 15/20"), „Löschungen" (hint „Art. 17") | display | `getAccountActivity` | – | KpiTab.tsx:1636-1651 |
| KPI-48 | Caveat Pseudonyme Zähler…; Leer „Noch keine Konto-Aktivität im Zeitraum. Sign-in-, Export- und Lösch-Ereignisse werden ab dem Deploy dieser Version erfasst." | display | – | – | KpiTab.tsx:1630-1633, 1652-1659 |
| **13 KI-Kosten** ||||||
| KPI-49 | „ab <Datum> erfasst · enthält geschätzte Werte" | display | `getAiCostMetrics` | – | KpiTab.tsx:564-567 |
| KPI-50 | Stats „Ø Kosten / Beratung" (hint „N Beratungen mit Token-Erfassung"), „Median / Beratung", „Gesamtausgaben" (hint „alle KI-Aufrufe im Zeitraum") | display | – | – | KpiTab.tsx:569-584 |
| KPI-51 | h4 „Aufteilung": Stats „Chat (inkl. Embeddings & Sprachausgabe)" (hint „Beratungs-Chat + Produktsuche + TTS"), „Dashboard / Admin" (hint „E-Mail-Entwürfe, Profile, Analysen, Wissen") | display | – | – | KpiTab.tsx:586-598 |
| KPI-52 | h4 „Nach Einsatzort" BarList (CALL_SITE_LABELS: Beratungs-Chat, Embeddings (Produktsuche), Sprachausgabe (TTS), Zusammenfassungs-E-Mail, Zusammenfassung (Download), Marketing-Entwürfe, Kampagnen-Entwürfe, Kundenprofile, Top-Fragen (Personas), Gesprächsanalyse, Insights-Rollup, Komplettanalyse, Wissen: Entwürfe, Wissen: Übersetzung, Bundle-Vorschläge) | display (bar list, EUR) | – | – | KpiTab.tsx:600-618, 663-679 |
| KPI-53 | h4 „Prompt-Caching (Chat)": Stats „Cache-Trefferquote" (hint), „Ersparnis (netto)" (hint „Lese-Rabatt minus Schreib-Aufschlag"), „Cache-Tokens" („n gelesen", hint „n geschrieben") | display | – | – | KpiTab.tsx:620-639 |
| KPI-54 | Caveat (MODEL_PRICES_JSON, USD_EUR_RATE 0,92, TTS Zeichen, Cache 0,1×/1,25×…); Leer „Noch keine KI-Verbrauchsdaten erfasst. Die Erfassung beginnt mit dem Deploy dieser Version — …" | display | – | – | KpiTab.tsx:558-561, 641-655 |
| **Trenner** ||||||
| KPI-55 | „GESAMTWERTE (VOM ZEITRAUM UNABHÄNGIG)" | display (divider label) | – | – | KpiTab.tsx:181-183 |
| **14 Postversand (Brief)** ||||||
| KPI-56 | Stats „Versendete Briefe", „Portokosten gesamt", „Ø Kosten / Brief" | display | `getPhysicalLetterStats` | – | KpiTab.tsx:696-700 |
| KPI-57 | Caveat PINGEN_LETTER_COST_CENTS 106; Leer „Noch keine Briefe versendet." | display | – | – | KpiTab.tsx:693, 701-707 |
| **15 Marketing-Funnel** ||||||
| KPI-58 | StageFunnelChart Gesendet → Geklickt → Eingelöst (nur mit Shopify) | chart | `getMarketingFunnel` | – | KpiTab.tsx:741-745 |
| KPI-59 | Stats „Gesendet", „Geklickt" (hint „% Klickrate"), „Eingelöst (Code verwendet)" (hint „% der geprüften Codes") | display | – | – | KpiTab.tsx:746-762 |
| KPI-60 | Caveat („Geklickt" = /api/r/<token>…; + Shopify-nicht-konfiguriert, redemptionUnknown, sampled 100); Leer „Noch keine Daten." / „Noch keine Marketing-E-Mails versendet." | display | – | – | KpiTab.tsx:735-737, 765-781 |
| **16 Persona-Insights** ||||||
| KPI-61 | Card „Verteilung (Chats je Persona)" (horizontale Balken mit Werten) | chart | `getPersonaInsights(5)` | – | KpiTab.tsx:808-817, KpiCharts.tsx:237-275 |
| KPI-62 | Persona-Karte: Name + „N Chats"; h5 „Lieblingsprodukte (am häufigsten empfohlen)" FavoriteBars / Caveat „Keine Produktempfehlungen erfasst." | display | – | – | KpiTab.tsx:819-836, 851-878 |
| KPI-63 | „Top-Fragen dieser Gruppe" + „✨ Top-Fragen generieren" / „Neu generieren" / „Wird erstellt…" | button (KI-Lauf) | On-Demand-Zusammenfassung; Fehlertexte „Fehler beim Erstellen der Zusammenfassung." / „Netzwerkfehler — bitte erneut versuchen." | POST /api/admin/kpi/top-questions `{personaLabel, force}` | KpiTopQuestions.tsx:43-72 |
| KPI-64 | Top-Fragen-Ergebnis (Markdown) + Meta „Stichprobe: N Nachrichten · zwischengespeichert/frisch generiert · <Zeit> · <Modell>"; Skeleton beim Laden | display | – | – | KpiTopQuestions.tsx:82-100 |
| KPI-65 | Leer „Noch keine klassifizierten Konversationen." | display | – | – | KpiTab.tsx:805 |
| **17 Empfehlung → Kauf** ||||||
| KPI-66 | Warn-Banner „Nur Kund:innen, die ihre E-Mail angegeben haben — … keine site-weite Conversion-Rate." | display (warn) | `getRecommendationLoop` | – | KpiTab.tsx:908-912 |
| KPI-67 | Headline-Prozent + „der Käufer:innen mit E-Mail-Angabe kauften ein zuvor empfohlenes Produkt" | display | – | – | KpiTab.tsx:914-924 |
| KPI-68 | StageFunnelChart Kontakte geprüft → mit Empfehlung → mit Kauf → Kauf = Empfehlung + gleichnamige Stats | chart + display | – | – | KpiTab.tsx:926-938 |
| KPI-69 | Caveat „⚠️ Aussagekraft begrenzt…" (+ purchaseUnknown, sampled 100); Leer „Noch keine Daten."; Warn „Shopify ist nicht konfiguriert — die Kauf-Zuordnung kann nicht berechnet werden." | display | – | – | KpiTab.tsx:900-905, 940-949 |
| **Charts (KpiCharts.tsx, gemeinsam)** ||||||
| KPI-70 | ChartFrame Skeleton bis Client-Mount; ChartTooltip (themed Popover, de-DE-Zahlen) | display (loading/tooltip) | – | – | KpiCharts.tsx:63-127 |

### Helper/explanatory text (KPIs) — 66 (Caveats vollständig zitiert, da inhaltlich zu erhalten)
1. „Der Zeitraum filtert alle Abschnitte bis zur Markierung „Gesamtwerte". Marketing-Funnel, Persona-Insights, Empfehlung→Kauf und Postversand sind Gesamtwerte (zeitraumunabhängig)." — KpiTab.tsx:159-164
2. Section-Subtitle „Zeitraum: <label>." — :199/206
3. Hint „status='abandoned' (Beratung ohne Abschluss)" — :213
4. Hint „Chats mit Nachricht ÷ Sessions mit Telemetrie" — :218
5. Caveat „„Konvertiert" setzt der tägliche Conversion-Sweep: der einmalige Mo-Rabattcode (MS5-…) der aus dieser Beratung entstandenen Marketing-E-Mail wurde in einer echten Bestellung eingelöst — dieselbe ehrliche Zuordnung wie beim Umsatz-Abschnitt. Käufe ohne Mo-Code sind nicht zurechenbar und erscheinen hier nicht; „Konvertiert" ist eine Untergrenze." — :252-259
6. Hint „x pro Chat" (2×) — :268, 273
7. Caveat „Klick-Signale werden anhand der Event-Namen aus der Widget-Telemetrie gemustert (Produkt/CTA: %product%click% / %cta%click%; Warenkorb: %cart% / %checkout%). Die vollständige Event-Übersicht zeigt die Rohdaten." — :277-282
8. Subtitle „Das Einwilligungs-Gate im Chat und die Opt-in-Karte bei der Anmeldung: angezeigt → akzeptiert („Ja, Angebote aktivieren") — Zeitraum: …" — :344
9. Hint „% Akzeptanzrate" / „akzeptiert / angezeigt" / „% Akzeptanzrate · n abgelehnt · n weggeklickt" — :363, 405-406
10. Caveat „Alle vier Events sendet das Widget (consent_gate_shown / _accepted / _declined / _dismissed, mit surface: chat|signin) — gemessen wird die Oberfläche, nicht die bestätigte Anmeldung: ein „Akzeptiert" wird erst mit dem Klick auf den Double-Opt-in-Link zur wirksamen Marketing-Einwilligung (siehe E-Mail-Capture-Funnel in der Event-Übersicht). Events ohne surface zählen nur in den Gesamtwerten." — :381-390
11. Subtitle „Bestellungen, die einen einmaligen, von Mo verschickten Rabattcode eingelöst haben — Zeitraum: …" — :423
12. Tooltip „Summe der tatsächlich bezahlten Bestellsummen (Shopify currentTotalPrice, Status PAID/PARTIALLY_REFUNDED) aller Bestellungen, die einen einmaligen, von Mo verschickten Rabattcode (MS5-…) eingelöst haben. Warenkorb-Links ohne Code sind nicht zurechenbar und zählen nicht." — :438
13. Hints „N Bestellung(en) im Zeitraum" / „eingelöste, bezahlte Bestellungen" / „N versendete Codes im Zeitraum" — :437, 443, 448
14. Caveat „„Umsatz über Mo-Rabattcodes" zählt ausschließlich Bestellungen, die einen einmaligen, von Mo verschickten Rabattcode (MS5-…, aus der personalisierten Marketing-E-Mail) eingelöst haben — geprüft per Shopify (read_orders) über das Bestellfeld discount_code, gezählt wird der tatsächlich bezahlte Bestellwert (currentTotalPrice, nur Status PAID / PARTIALLY_REFUNDED). Käufe über Warenkorb-Links (In-Chat-Checkout, Zusammenfassungs-E-Mail, Bundles) zählen hier bewusst NICHT — sie werden seit der Attributions-Runde separat im Abschnitt „Mo-zugeordneter Umsatz (Bestell-Webhook)" gemessen. [Bei N Code(s) lieferte Shopify keine Antwort (nicht gezählt).] [Auf die N neuesten Codes begrenzt.]" — :452-468
15. Warn „Shopify ist nicht konfiguriert — der Umsatz kann nicht berechnet werden." — :429
16. Subtitle „Bestellungen mit Mo-Markierung (Warenkorb-Attribut oder Mo-Rabattcode), per Shopify-Webhook erfasst — Zeitraum: …" — :492
17. Info „Noch keine Bestellung über den Webhook erfasst. Voraussetzung: die Shopify-Webhooks orders/create + orders/paid sind auf /api/webhooks/shopify registriert (siehe docs/ORDER_ATTRIBUTION.md) — erfasst wird ab Registrierung, rückwirkend nicht." — :497-503
18. Tooltip „Direkt": „Bestellungen über einen von Mo gebauten Kauf-Weg: ein eingelöster Mo-Rabattcode (MS5-/MK-) oder ein von Mo verschickter Warenkorb-Link (Zusammenfassung, Marketing-E-Mail, Bundle). Nur bezahlte Bestellungen (PAID/PARTIALLY_REFUNDED)." — :511
19. Tooltip „Beraten & gekauft": „Der Warenkorb trug die Session-Markierung des Widgets UND mindestens ein gekauftes Produkt wurde in dieser Beratung besprochen/ausgewählt — auch wenn es manuell über die Suche in den Warenkorb gelegt wurde." — :517
20. Tooltip „Beraten, anderes gekauft": „Session-Markierung vorhanden, aber kein gekauftes Produkt stammt aus der Beratung — Mo hat beraten, gekauft wurde etwas anderes." — :523
21. Caveat „Erfasst werden ausschließlich Bestellungen mit Mo-Markierung: dem opaken Warenkorb-Attribut attributes[_mo] (von Mo-Links oder dem Widget-Stempel gesetzt, Zuordnungsfenster N Tage) oder einem Mo-Rabattcode. Unmarkierte Bestellungen werden gar nicht gespeichert (Datenminimierung); die Zeilen sind pseudonym (keine Kundendaten). Geräteübergreifende Käufe (Beratung am Handy, Kauf am Laptop) bleiben ohne E-Mail/Code unsichtbar — physikalische Grenze, keine Messlücke. [N erfasste Bestellung(en) im Zeitraum sind (noch) nicht bezahlt und zählen nicht zum Umsatz.]" — :527-540
22. Subtitle „Geschätzte KI-Kosten (EUR) aus erfassten Token-Verbräuchen pro Modell — Zeitraum: …" — :555
23. Info „Noch keine KI-Verbrauchsdaten erfasst. Die Erfassung beginnt mit dem Deploy dieser Version — danach erscheinen hier die Kosten." — :559-560
24. „ab <Datum> erfasst · enthält geschätzte Werte" — :565-566
25. Hints „N Beratungen mit Token-Erfassung" / „alle KI-Aufrufe im Zeitraum" / „Beratungs-Chat + Produktsuche + TTS" / „E-Mail-Entwürfe, Profile, Analysen, Wissen" / „gelesene Cache-Tokens ÷ Chat-Input-Tokens" / „Lese-Rabatt minus Schreib-Aufschlag" / „n geschrieben" — :573, 582, 591, 596, 627, 632, 637
26. Caveat „Kosten werden aus den vom Anbieter gemeldeten Token-Zahlen je Modell berechnet (Preistabelle in USD pro Mio. Tokens, überschreibbar via MODEL_PRICES_JSON; EUR-Umrechnung via USD_EUR_RATE, Standard 0,92). „Ø Kosten / Beratung" zählt nur den Chat-Verbrauch je Konversation. Embeddings (Produktsuche) sind kostenseitig Rauschen, werden aber ehrlich mitgezählt. Für die Sprachausgabe (TTS) zählt die Spalte Input-Tokens Zeichen statt Tokens (Abrechnung je Zeichen). Cache-Lesen kostet 0,1×, Cache-Schreiben 1,25× des Input-Preises — die Ersparnis ist der Netto-Effekt gegenüber denselben Aufrufen ohne Caching[; einzelne Werte sind geschätzt, wenn der Anbieter keine Token-Zahl liefert]." — :641-655
27. Subtitle „Versendete Briefe (Pingen → Deutsche Post) und die angefallenen Portokosten." — :690
28. Caveat „Kosten je Brief stammen aus dem von Pingen gemeldeten Preis; wo (noch) kein Preis vorliegt (z. B. Staging), wird ein konfigurierbarer Standard angesetzt (PINGEN_LETTER_COST_CENTS, Standard 106 = 1,06 €). Gezählt werden an Pingen übergebene Briefe (fehlgeschlagene Übermittlungen zählen nicht)." — :701-707
29. Info „Noch keine Briefe versendet." — :693
30. Subtitle „Versendete Marketing-E-Mails: gesendet → geklickt → eingelöst (persönlicher Code verwendet)." — :732
31. Hints „% Klickrate" / „% der geprüften Codes" — :751, 758
32. Caveat „„Geklickt" zählt E-Mails, deren Warenkorb-Link (über die getrackte Weiterleitung /api/r/<token>) mindestens einmal angeklickt wurde — kein Tracking-Pixel, nur der bewusst geklickte Link. „Eingelöst" prüft per Shopify (read_orders), ob der einmalige persönliche Code der jeweiligen E-Mail in einer echten Bestellung verwendet wurde; die Einlösungsrate bezieht sich auf die geprüften Codes mit Shopify-Antwort (nicht auf alle Sends — die Prüfung ist auf die neuesten Codes begrenzt). [Shopify ist nicht konfiguriert — die Einlösung kann nicht berechnet werden.] [Bei N Code(s) lieferte Shopify keine Antwort (als „unbekannt" gewertet).] [Einlösungsprüfung auf die 100 neuesten Codes begrenzt.]" — :765-781
33. Info „Noch keine Marketing-E-Mails versendet." — :737
34. Subtitle „Gruppiert nach abgeleitetem Persona-Archetyp." — :802
35. „Lieblingsprodukte (am häufigsten empfohlen)" / Caveat „Keine Produktempfehlungen erfasst." — :830, 833
36. Info „Noch keine klassifizierten Konversationen." — :805
37. „⚠️ On-Demand-KI-Analyse von bis zu 80 echten Nutzernachrichten — kostet Anthropic-Tokens (wenige Cent pro Lauf). Ergebnis wird zwischengespeichert." — KpiTopQuestions.tsx:76-77
38. „Stichprobe: N Nachrichten · zwischengespeichert/frisch generiert · <Zeit> · <Modell>" — KpiTopQuestions.tsx:94-97
39. Subtitle „ROI-Kennwert für die Teilmenge der Kund:innen, die ihre E-Mail angegeben haben — KEINE site-weite Conversion-Rate." — :897
40. Warn „Nur Kund:innen, die ihre E-Mail angegeben haben — also eine Minderheit aller Chat-Nutzer:innen. Diese Zahl ist keine site-weite Conversion-Rate." — :909-911
41. „der Käufer:innen mit E-Mail-Angabe kauften ein zuvor empfohlenes Produkt" — :921-922
42. Caveat „⚠️ Aussagekraft begrenzt: erfasst nur Nutzer, die eine E-Mail angegeben und der Verarbeitung zugestimmt haben — also eine Minderheit aller Chatter und nicht alle Käufer. Produkt-Zuordnung erfolgt über normalisierte Shopify-Handles; umbenannte/archivierte Produkte können fehlen. [Bei N Kontakt(en) lieferte Shopify keine Antwort (als „unbekannt" gewertet).] [Stichprobe auf die 100 neuesten Kontakte begrenzt.]" — :940-949
43. Warn „Shopify ist nicht konfiguriert — die Kauf-Zuordnung kann nicht berechnet werden." — :903-904
44. Subtitle „Beratungen nach gewählter Chat-Sprache und E-Mail-Angaben nach Capture-Sprache — Zeitraum: …" — :970
45. Caveat „Die Chat-Sprache wird seit Migration 0041 pro Beratung gespeichert (letzter Turn zählt); ältere Beratungen erscheinen als „Unbekannt". Capture-Sprache seit Migration 0030." — :994-998
46. Subtitle „Analyse-Abdeckung und Qualitäts-/Themenverteilung der analysierten Beratungen — Zeitraum: …" — :1034
47. Hints „% Abdeckung" / „unerfüllter Bedarf + abgesprungen" — :1044, 1054
48. Caveat „Verteilungen umfassen nur Beratungen, die im Gespräche-Tab (einzeln oder per Bulk) analysiert wurden — die Abdeckung oben zeigt, wie repräsentativ das ist. Die Analyse läuft auf Abruf, nicht automatisch." — :1098-1103
49. Subtitle „Mo bietet die Chat-Zusammenfassung per E-Mail an: angeboten → Formular gesendet → Marketing-Haken gesetzt → Double-Opt-in bestätigt — Zeitraum: …" — :1145
50. Hints „% der Angebote" / „% der Opt-ins" — :1164, 1170
51. Caveat „Ereigniszählung im Zeitraum (nicht pro Sitzung verkettet): ein DOI-Klick, der ein Opt-in vom Vortag bestätigt, zählt im Zeitraum des Klicks. „Abgelehnt" (Karte weggeklickt): N — vom Widget gemeldet. Wirksam wird die Marketing-Einwilligung erst mit dem DOI-Klick." — :1190-1196
52. Subtitle „Kampagnen-E-Mails (MK-Codes): gesendet → CTA geklickt → Code eingelöst — Zeitraum: …" — :1220
53. Hints Kampagne: „n per E-Mail · n kopiert" / „noch keine getrackten Sends" / „% von n getrackten" / „% der geprüften Codes" / „n unbekannt (Kontakt gelöscht)" / „% der n Sends mit Set" / „kein Set-Angebot im Zeitraum" / „x je Send · geprüfte Codes" / „keine Zustellmeldungen (Resend-Webhook?)" / „n hart · n Beschwerde(n)" / „% der Sends (30 Tage)" / „N Klick-Bewertung(en) (anonym)" — :1238-1302
54. Tabellen-Subtitle „Derselbe Funnel je Hero-Variante der versendeten Mail — mit den Hero-Kosten der jeweiligen Kontakte (Prompt, Renders, Prüfung)." — :1309
55. Tabellen-Subtitle „Derselbe Funnel je Segment (Zeit seit dem letzten Kauf)." — :1317
56. Caveat „„Geklickt" zählt Sends, deren getrackter Promo-CTA (/api/r/<token>) mindestens einmal angeklickt wurde — Sends vor Migration 0041 und Kopier-Sends tragen keinen Link und können nicht als geklickt zählen (Basis: getrackte Sends). „Eingelöst" prüft per Shopify, ob der einmalige MK-Code der jeweiligen E-Mail verwendet wurde; die Rate bezieht sich auf die geprüften Codes mit Antwort. […] „Zugestellt / Bounces" kommt aus dem Resend-Webhook (harte Bounces und Beschwerden sperren die Adresse dauerhaft). „Set geklickt" und „Abgemeldet" gelten für Sends ab Migration 0054; die Abmeldung wird den Kampagnen-Mails der letzten 30 Tage an diese Adresse zugeordnet. Bewertungen sind absichtlich anonym und lassen sich keiner Variante zuordnen. Für einen fairen Hero-Vergleich brauchen beide Gruppen Sends — der Kampagnen-Workspace zeigt je Kontakt die A/B-Gruppe an (gerade Kontakt-ID: mit Hero, ungerade: ohne)." — :1323-1346
57. Subtitle „Persönliche Set-Angebote (unlisted Shopify-Produkte): erstellt, Lebenszyklus und Klicks auf den Angebots-Link — Zeitraum: …" — :1455
58. Hints Bundle „n aktiv · n abgelaufen · n fehlgeschlagen" / „unabhängig vom Zeitraum" / „N Angebot(e) geklickt" / „vs. Summe der Einzelpreise" — :1467-1478
59. Caveat „Klicks stammen vom getrackten Angebots-Link (bundle_offer_clicked). Ein Kauf eines Bundles wird bewusst nicht zugerechnet — es gibt kein zuverlässig gespeichertes Bestellsignal je Angebot (keine erfundene Zuordnung; siehe Umsatz-Abschnitt)." — :1481-1487
60. Subtitle „Wissenslücken aus Beratungen: gefunden → beantwortet → veröffentlicht — Durchsatz im Zeitraum: …" — :1512
61. Hints „im Zeitraum" / „gesamt" / „geeignete, noch nicht gescannte Beratungen" — :1524-1541
62. Caveat „„Lücken gefunden" = im Zeitraum erstellte Queue-Einträge (der Scan läuft auf Abruf im Wissen-Tab). Die Latenz misst vom Entwurf bis zur Operator-Antwort bzw. Veröffentlichung (Median über die im Zeitraum beantworteten/veröffentlichten Einträge). Ob Mo eine veröffentlichte Antwort tatsächlich verwendet hat, wird nicht gemessen." — :1544-1550
63. Subtitle „Freitext-Feedback aus dem Widget — Volumen im Zeitraum: …" / Hint „antwortbar" / Caveat „Reines Volumen — die Inhalte stehen im Feedback-Tab. Der Kundentyp ist die Widget-Selbstauskunft (telemetriegradig, nicht verbindlich)." — :1565, 1583, 1594-1597
64. Subtitle „Shopify-Anmeldungen, DSGVO-Self-Service und Zusammenfassungen — Zeitraum: …" / Hints „n stille Erkennungen", „Art. 15/20", „Art. 17" — :1627, 1642, 1649-1650
65. Info „Noch keine Konto-Aktivität im Zeitraum. Sign-in-, Export- und Lösch-Ereignisse werden ab dem Deploy dieser Version erfasst." — :1631-1632
66. Caveat „Pseudonyme Zähler (kpi_events bzw. KI-Verbrauchszeilen der Zusammenfassungen) — keine Personenbezüge. „Stille Erkennungen" sind automatische Wieder-Anmeldungen bereits eingeloggter Shopify-Kund:innen (prompt=none). Kontaktformular = akzeptierte Übermittlungen; vergleichbar mit den show_contact_form-Aufrufen im Gespräche-Tab." — :1652-1659
(+ Leerzustände „Noch keine Daten." in fast jeder Sektion und die Divider-Beschriftung „Gesamtwerte (vom Zeitraum unabhängig)" :182.)

### Persistenter Zustand (KPIs)
- URL: `?tab=kpi&kpiRange=7d|30d|90d|custom[&kpiFrom=YYYY-MM-DD&kpiTo=YYYY-MM-DD]` (KpiDateRangePicker.tsx:55-61; page.tsx:103-107). Kein localStorage/Cookie.
- Serverseitig gecacht: Top-Fragen je Persona (`getCachedTopQuestionsMap`).

---

## 6. Feedback (`FeedbackTab.tsx`, `FeedbackList.tsx`)

### Beschreibung
Read-only Liste der Widget-Rückmeldungen. `FeedbackTab` (Server) lädt `listFeedback()` (feedback-store) einmal und reicht die Zeilen an `FeedbackList` (Client), die ausschließlich lokal sucht/filtert/sortiert. Keine Mutation, keine API-Route.

### Controls & actions
| ID | Element | Type | What it does | Calls | File:line |
|---|---|---|---|---|---|
| FEE-01 | Banner „Keine Datenbank konfiguriert (DATABASE_URL) — es kann kein Feedback geladen werden." | display (warn) | – | server-render | FeedbackTab.tsx:10-17 |
| FEE-02 | Banner „Noch kein Feedback. Sobald Nutzer:innen über das Widget eine Rückmeldung senden, erscheint sie hier — neueste zuerst." | display (info) | Leerzustand | server-render | FeedbackTab.tsx:31-38 |
| FEE-03 | „Suche (Text, E-Mail, Seite)" `#fb-search` (Placeholder „Stichwort…") | input (search) | Substring auf message/email/page | client-only | FeedbackList.tsx:87-101 |
| FEE-04 | „Tier" `#fb-tier` (Alle + datengetriebene Tier-Werte) | select (filter) | Filter nach tier | client-only | FeedbackList.tsx:103-115 |
| FEE-05 | „Sortierung" `#fb-sort` (Neueste zuerst / Älteste zuerst) | select (sort) | created_at | client-only | FeedbackList.tsx:117-125 |
| FEE-06 | „N Rückmeldung(en)" / „k von N Rückmeldung(en)" | display | Zähler | – | FeedbackList.tsx:128-132 |
| FEE-07 | „Keine Rückmeldungen für diese Suche/Filter." | display | Leer nach Filter | – | FeedbackList.tsx:134-137 |
| FEE-08 | Feedback-Karte: Datum/Zeit, Badge Tier, Badge E-Mail, Nachricht (pre-wrap), dl „Seite:" / „Session:" (mono) / „Thread:" (mono) | display (card) | – | server-render | FeedbackList.tsx:149-187 |

### Helper/explanatory text (Feedback) — 4
1. „Keine Datenbank konfiguriert (DATABASE_URL) — es kann kein Feedback geladen werden." — FeedbackTab.tsx:13-14
2. „Noch kein Feedback. Sobald Nutzer:innen über das Widget eine Rückmeldung senden, erscheint sie hier — neueste zuerst." — FeedbackTab.tsx:34-35
3. Placeholder „Stichwort…" — FeedbackList.tsx:97
4. „Keine Rückmeldungen für diese Suche/Filter." — FeedbackList.tsx:136

### Persistenter Zustand (Feedback)
- Nur `?tab=feedback`. Suche/Filter/Sort flüchtig (React-State).

---

## 7. Gespräche (`GespraecheTab.tsx`, `GespraecheWorkspace.tsx`, `GespraecheInsights.tsx`)

### Beschreibung
Konversations-Inspektor (Master-Detail). `GespraecheTab` (Server) liest aus `@/lib/admin-conversations`: `listAdminConversations(filter)` (paginiert, PAGE_SIZE), `getConversationStats(from,to)`, `getCachedInsights(from,to)`, `countUnanalyzedInRange(from,to)` und berechnet die Bulk-Kostenschätzung (`estimateAnalysisCostUsd` × `usdToEur`). NULL Modell-Aufrufe beim Rendern. Sämtliche Filter + Seite leben in der URL (`g*`-Params): Änderungen → `router.push('/admin?tab=gespraeche&grange=…')` → Server rendert neu. Oben Filterleiste (Volltextsuche über ALLE Chats, Zeitraum-Presets/custom, Tier, Kategorie, Qualität, „nur ohne Bot-Antwort"), dann Stats-Panel mit klickbaren Verteilungsbalken + Sammelanalyse, dann Liste (links) + Detail (rechts; lazy `POST /api/admin/conversations/detail`), unten der einklappbare aggregierte Insights-Report.

### Controls & actions
| ID | Element | Type | What it does | Calls | File:line |
|---|---|---|---|---|---|
| GES-01 | Banner „Keine Datenbank konfiguriert (DATABASE_URL) — es können keine Gespräche geladen werden." | display (warn) | – | server-render | GespraecheTab.tsx:26-33 |
| **Filterleiste** ||||||
| GES-02 | Suchfeld (type=search, Placeholder „Alle Gespräche durchsuchen — Wörter, Namen, IDs, E-Mail, Tags …", Enter = Suchen) | input (search) | Setzt `gq`, Seite 1; Zeitraum wird ignoriert | Navigation (URL `gq`) | GespraecheWorkspace.tsx:330-347 |
| GES-03 | „🔍 Suchen" | button | Übernimmt Suchentwurf | Navigation | GespraecheWorkspace.tsx:348-350 |
| GES-04 | „✕ Zurücksetzen" (nur bei aktiver Suche) | button | Löscht `gq` | Navigation | GespraecheWorkspace.tsx:351-363 |
| GES-05 | Hinweis „Suche nach „…" über alle Gespräche — der Zeitraum wird ignoriert." | display | – | – | GespraecheWorkspace.tsx:364-370 |
| GES-06 | „Zeitraum:" „7 Tage" / „30 Tage" / „90 Tage" | button (filter) | `grange` | Navigation | GespraecheWorkspace.tsx:283-287, 374-388 |
| GES-07 | „Benutzerdefiniert" (aria-expanded) | button (toggle) | Zeigt Von/Bis | client-only | GespraecheWorkspace.tsx:389-397 |
| GES-08 | „Tier:" Select (Alle / Anonym / E-Mail / Angemeldet) | select (filter) | `gtier` | Navigation | GespraecheWorkspace.tsx:399-412 |
| GES-09 | „Kategorie:" Select (Alle + CATEGORY_LABELS aus conversation-analysis-core) | select (filter) | `gcat` | Navigation | GespraecheWorkspace.tsx:414-427 |
| GES-10 | „Qualität:" Select (Alle + QUALITY_LABELS) | select (filter) | `gqual` | Navigation | GespraecheWorkspace.tsx:429-442 |
| GES-11 | Checkbox „nur ohne Bot-Antwort" | checkbox (filter) | `gerr=1` | Navigation | GespraecheWorkspace.tsx:444-451 |
| GES-12 | Zeitraum-Label (aria-live) | display | `filter.label` | – | GespraecheWorkspace.tsx:453-455 |
| GES-13 | „Von" / „Bis" (date) + „Anwenden" | input + button | `grange=custom&gfrom&gto` | Navigation | GespraecheWorkspace.tsx:458-490 |
| **Stats-Panel (GespraecheStatsPanel)** ||||||
| GES-14 | „📊 Auswertung · <from> – <to>" | display | – | – | GespraecheInsights.tsx:220-223 |
| GES-15 | „N Gespräch(e) · M analysiert" | display | `stats` | – | GespraecheInsights.tsx:225-227 |
| GES-16 | „Alle auswerten (N)" / „Alle ausgewertet" (disabled bei 0) | button → dialog | Öffnet Bestätigung | client-only | GespraecheInsights.tsx:228-236 |
| GES-17 | Dialog „Alle nicht analysierten Gespräche auswerten?" (Kosten-Schätzung; „Abbrechen" / „Auswerten" / „Läuft…") | dialog (confirm) | Bulk-Analyse; Live-Toast „Sammelanalyse läuft…" → Ergebnis „N analysiert, k fehlgeschlagen · Kosten · noch M offen (erneut ausführen)"; refresh | POST /api/admin/conversations/analyze-bulk `{from, to, confirm:true}` | GespraecheInsights.tsx:160-214, 271-292 |
| GES-18 | Verteilung „Kategorien" (klickbare Balken; aktiv hervorgehoben; title „Liste auf „X" filtern — zeigt ALLE passenden Gespräche" / „Filter entfernen") | chart (bar list, filter) | Setzt/entfernt `gcat` | Navigation | GespraecheInsights.tsx:59-131, 241-251 |
| GES-19 | Verteilung „Qualität" (klickbar) | chart (bar list, filter) | Setzt/entfernt `gqual` | Navigation | GespraecheInsights.tsx:252-262 |
| GES-20 | Leer „— noch keine Daten" | display | – | – | GespraecheInsights.tsx:82 |
| GES-21 | Hinweis „Klick auf einen Balken filtert die Gesprächsliste darunter auf ALLE passenden (analysierten) Gespräche…" | display | – | – | GespraecheInsights.tsx:264-268 |
| **Liste (links)** ||||||
| GES-22 | „N Gespräch(e)/Treffer · Seite p/N" / „Keine Treffer" / „Keine Gespräche" | display | – | – | GespraecheWorkspace.tsx:212-219 |
| GES-23 | „‹" / „›" (aria „Vorherige Seite"/„Nächste Seite") | button (pagination) | `gpage` | Navigation | GespraecheWorkspace.tsx:220-239 |
| GES-24 | Leer „Keine Gespräche gefunden für „q"." / „Keine Gespräche für diesen Zeitraum/Filter." | display | – | – | GespraecheWorkspace.tsx:247-253 |
| GES-25 | Zeile (role=button): Datum/Zeit, TierBadge (TIER_LABELS), „N Nachricht(en)", Persona-Kurzlabel | list item | Wählt Gespräch | client-only | GespraecheWorkspace.tsx:565-628 |
| GES-26 | OutcomeChips: „⚠ keine Antwort" (destructive), „🛒 Cart genutzt" (success), „🛒 Cart angeboten" (outline), „✉ E-Mail" (info), „🔧 N Tool(s)" (title = Tool-Labels Profil/Suche/Produkt/Vergleich/Warenkorb/Showroom/Kontakt/E-Mail) | badge | Signale | – | GespraecheWorkspace.tsx:79-88, 498-542 |
| GES-27 | CategoryBadge (accent) + Qualitäts-Badge (warning wenn negativ) + Kurz-Summary (2 Zeilen, title=voll) / „nicht analysiert" | badge + display | Analyse-Status | – | GespraecheWorkspace.tsx:544-563, 607-624 |
| **Detail (rechts, ConversationDetail)** ||||||
| GES-28 | Platzhalter „Wähle links ein Gespräch, um Transkript und Analyse zu sehen." | display | – | – | GespraecheWorkspace.tsx:711-719 |
| GES-29 | Skeleton beim Laden; Fehler „Gespräch konnte nicht geladen werden." / „Netzwerkfehler — bitte erneut versuchen." / „Nicht gefunden." | display (loading/error) | Detail-Fetch | POST /api/admin/conversations/detail `{conversationId}` | GespraecheWorkspace.tsx:646-682, 728-748 |
| GES-30 | Kopf: TierBadge, Persona-Badge, „<Datum> · N Nachricht(en) · <status>"; OutcomeChips (md) | display | – | – | GespraecheWorkspace.tsx:756-769 |
| GES-31 | „KI-Analyse" + „✨ Analysieren" / „Neu analysieren" / „Analysiere…" | button (KI-Lauf) | Einzelanalyse (Haiku, gecacht); Toast „Gespräch analysiert" / „Hinweis"; refresh | POST /api/admin/conversations/analyze `{conversationId, force}` | GespraecheWorkspace.tsx:684-709, 773-779 |
| GES-32 | Analyse-Ergebnis: CategoryBadge, Summary, Tag-Badges, „Stand: … · <model> · ~<EUR> · letzter Lauf: n / m Tokens" | display | – | – | GespraecheWorkspace.tsx:780-801 |
| GES-33 | „Noch nicht analysiert. Ein Klick startet einen günstigen KI-Durchlauf (Haiku) und speichert das Ergebnis — erneutes Öffnen kostet nichts." | display | – | – | GespraecheWorkspace.tsx:802-807 |
| GES-34 | „✓ Transkript": Turns „Kunde"/„Berater" + Uhrzeit (Berater-Turns als Markdown) / „Kein lesbares Transkript." | display | – | – | GespraecheWorkspace.tsx:811-837 |
| **Insights-Report (GespraecheReportPanel, unten)** ||||||
| GES-35 | „✨ Aggregierter Insights-Report" + Meta „N Zusammenfassung(en) · zwischengespeichert/frisch generiert · <Zeit> · ~<EUR>" | display | `getCachedInsights` | – | GespraecheInsights.tsx:427-437 |
| GES-36 | „Report anzeigen" / „Einklappen" (aria-expanded; nur wenn Report existiert; eingeklappt per Default) | button (collapse) | – | client-only | GespraecheInsights.tsx:440-450 |
| GES-37 | „✨ Insights generieren" / „Neu generieren" / „Wird erstellt…" (disabled ohne analysierte) | button (KI-Lauf) | Rollup über gecachte Summaries; öffnet Report | POST /api/admin/conversations/insights `{from, to, force}` | GespraecheInsights.tsx:395-419, 451-463 |
| GES-38 | Hinweis „⚠️ KI-Pass über die bereits zwischengespeicherten Zusammenfassungen (nicht über Transkripte)… [Zuerst Gespräche analysieren.]" | display | – | – | GespraecheInsights.tsx:466-472 |
| GES-39 | Fehlertext / Skeleton / Report (Markdown) | display | – | – | GespraecheInsights.tsx:474-486 |
| GES-40 | „Belege": `<details>` je Abschnitt (Top-Themen & Fragen / Wo Beratungen stocken oder scheitern / Häufige unerfüllte Bedürfnisse / Vorschläge zur Verfeinerung) mit Badge „Beleg-Gespräche (N)" und Buttons „Gespräch #id öffnen — <Grund>" | disclosure + button (deep link) | Öffnet Gespräch im Detail-Panel (scrollIntoView) | POST …/detail | GespraecheInsights.tsx:300-364, GespraecheWorkspace.tsx:167-170 |
| GES-41 | Hinweis „Kuratierte Beispiele je Abschnitt. Vollständige Listen: Kategorie-/Qualitäts-Balken oben anklicken." | display | – | – | GespraecheInsights.tsx:358-361 |
| GES-42 | „Neu generieren, um verlinkte Beleg-Gespräche zu erhalten." (alter Cache ohne Referenzen) / „Modell: <model>" | display | – | – | GespraecheInsights.tsx:493-502 |

### Helper/explanatory text (Gespräche) — 22
1. „Keine Datenbank konfiguriert (DATABASE_URL) — es können keine Gespräche geladen werden." — GespraecheTab.tsx:29-30
2. Placeholder „Alle Gespräche durchsuchen — Wörter, Namen, IDs, E-Mail, Tags …" — GespraecheWorkspace.tsx:336
3. „Suche nach „q" über alle Gespräche — der Zeitraum wird ignoriert." — :366-368
4. Checkbox-Label „nur ohne Bot-Antwort" — :450
5. „Keine Gespräche gefunden für „q"." / „Keine Gespräche für diesen Zeitraum/Filter." — :250-251
6. Badge-Titles „Kunde schrieb, aber Mo antwortete nicht" / „Warenkorb-/Checkout-Link geklickt" / „Warenkorb-Button angeboten (add_to_cart)" / „E-Mail erfasst" — :512, 517, 522, 527
7. „nicht analysiert" — :623
8. „Wähle links ein Gespräch, um Transkript und Analyse zu sehen." — :715
9. „Gespräch konnte nicht geladen werden." / „Netzwerkfehler — bitte erneut versuchen." / „Nicht gefunden." — :667, 674, 744
10. „Stand: … · model · ~€ · letzter Lauf: n / m Tokens" — :793-800
11. „Noch nicht analysiert. Ein Klick startet einen günstigen KI-Durchlauf (Haiku) und speichert das Ergebnis — erneutes Öffnen kostet nichts." — :803-806
12. „Kein lesbares Transkript." — :817
13. „— noch keine Daten" — GespraecheInsights.tsx:82
14. title „Filter entfernen" / „Liste auf „X" filtern — zeigt ALLE passenden Gespräche" — :111-113
15. „N Gespräch(e) · M analysiert" — :226
16. „Klick auf einen Balken filtert die Gesprächsliste darunter auf ALLE passenden (analysierten) Gespräche — jedes mit seiner Kurz-Erklärung. Erneuter Klick hebt den Filter auf." — :265-267
17. Dialog „N Gespräch(e) im Zeitraum from – to werden mit dem günstigen Modell analysiert. Geschätzte Kosten: ca. X € (≈ Y € pro Gespräch). Pro Durchlauf wird eine Charge verarbeitet — sind danach noch welche offen, einfach erneut ausführen." — :276-280
18. Toast-Texte Sammelanalyse („N Gespräch(e) im Zeitraum", „N analysiert, k fehlgeschlagen · € · noch M offen (erneut ausführen)") — :165, 196-199
19. „Kuratierte Beispiele je Abschnitt. Vollständige Listen: Kategorie-/Qualitäts-Balken oben anklicken." — :359-360
20. „N Zusammenfassung(en) · zwischengespeichert/frisch generiert · Zeit · ~€" — :432-435
21. „⚠️ KI-Pass über die bereits zwischengespeicherten Zusammenfassungen (nicht über Transkripte) — günstig und skalierbar. Ergebnis wird je Zeitraum zwischengespeichert. Enthält Empfehlungen zur Verfeinerung auf Basis aller analysierten Gespräche. [Zuerst Gespräche analysieren.]" — :467-471
22. „Neu generieren, um verlinkte Beleg-Gespräche zu erhalten." / „Modell: …" / Fehler „Insights konnten nicht erstellt werden." — :496, 501, 409

### Persistenter Zustand (Gespräche)
- URL: `?tab=gespraeche&grange=7d|30d|90d|custom[&gfrom&gto][&gtier=anonymous|email-only|signed-in][&gerr=1][&gcat=<key>][&gqual=<key>][&gq=<text>][&gpage=N]` (GespraecheWorkspace.tsx:173-190; page.tsx:110-120).
- Ausgewähltes Gespräch (selectedId) und Report auf/zu sind flüchtig. Kein localStorage.
- Serverseitig gecacht: Einzelanalysen (am Datensatz), Insights-Rollup je Zeitraum.

---

## 8. Wissen (`WissenTab.tsx`, `WissenWorkspace.tsx`)

### Beschreibung
Q&A-Warteschlange zur Wissensanreicherung. Server (`WissenTab`) lädt einmal `listQaEntries(null)`, `getQaCounts()`, `countScanCandidates()` und übergibt an den Client-Workspace. Der Client hält Einträge/Zähler im State und lädt nach jeder Mutation per `GET /api/admin/qa/list` neu. Pro Eintrag: KI-Entwurf {Wissenslücke, Frage, Produkt?} → Operator editiert Frage/Produkt-Handle/Antwort (+ optionale englische Version) → Speichern (answered) → Veröffentlichen (Shopify-Metafeld `custom.qa` bei Produktbezug, sonst Mos allgemeine Wissensbasis) → Zurückziehen/Verwerfen/Wiederherstellen. „Gespräche scannen" ist der einzige Token-Spend (explizit).

### Controls & actions
| ID | Element | Type | What it does | Calls | File:line |
|---|---|---|---|---|---|
| WIS-01 | „✨ Gespräche scannen (k von N)" / „Scanne …" / „Keine neuen Gespräche zu scannen" | button | Entwirft bis zu 10 neue Q&A-Einträge aus geeigneten, noch nicht gescannten Gesprächen; Toast mit scanned/created/noGap/duplicates/errors; danach reload | POST /api/admin/qa/scan `{limit:10}` → GET /api/admin/qa/list | WissenWorkspace.tsx:113-136, 143-151 |
| WIS-02 | Reload-Icon (title „Neu laden", KEIN aria-label) | icon button | Lädt Einträge/Zähler neu | GET /api/admin/qa/list | WissenWorkspace.tsx:152-154 |
| WIS-03 | Statusfilter Offen / Beantwortet / Veröffentlicht / Verworfen / Alle (mit Zählern) | filter buttons | Filtert die Liste client-seitig | client-only | WissenWorkspace.tsx:155-171 |
| WIS-04 | Leerzustand „Keine Einträge in dieser Ansicht. Nutze „Gespräche scannen"…" | display | – | – | WissenWorkspace.tsx:185-189 |
| WIS-05 | Status-Badge (Offen/Beantwortet/Veröffentlicht/Verworfen), Badge „Produkt: <Titel>" oder „Allgemein", Meta „#id · Datum · aus Gespräch #n" | display | Kopf je Eintrag | server/GET | WissenWorkspace.tsx:388-404 |
| WIS-06 | Box „Wissenslücke: …" | display | KI-Zusammenfassung der Lücke | – | WissenWorkspace.tsx:406-408 |
| WIS-07 | Input „Frage (öffentlich sichtbar — anpassbar)" | input | Frage editieren | client → gespeichert via WIS-11 | WissenWorkspace.tsx:410-419 |
| WIS-08 | Input „Produkt-Handle (leer = allgemeine Frage)" (Placeholder „z. B. atx-multipresse-mpx-780") | input (free text) | Produktbezug setzen/entfernen | client → WIS-11 | WissenWorkspace.tsx:421-431 |
| WIS-09 | Textarea „Antwort" | textarea | Antwort verfassen; Markdown-Links `[Text](URL)` | client → WIS-11 | WissenWorkspace.tsx:433-441 |
| WIS-10 | „🔗 Produkt verlinken" → `CatalogProductPicker` (inkl. Variante, `?variant=`) + „Abbrechen" | button + picker | Fügt `[Titel](URL)` an Cursorposition der Antwort ein | POST /api/admin/catalog/search (Picker) | WissenWorkspace.tsx:442-452, 549-589 |
| WIS-11 | „💾 Speichern" / „Speichere …" | button | Speichert Frage/Antwort/Produkt/EN (Status → answered) | POST /api/admin/qa/answer `{id, question, answer, productId, questionEn, answerEn}` | WissenWorkspace.tsx:239-263, 500-503 |
| WIS-12 | „📤 Veröffentlichen" / „Änderung erneut veröffentlichen" / „Veröffentliche …" (disabled ohne Antwort) | button | Speichert, dann publiziert (Metafeld + Katalog-Refresh bzw. allgemeine Wissensbasis); Toast nennt EN-Übersetzung ja/nein | POST /api/admin/qa/answer → POST /api/admin/qa/publish `{id}` | WissenWorkspace.tsx:265-296, 504-511 |
| WIS-13 | „↶ Zurückziehen" (nur published) | button | Entfernt aus Metafeld/Wissen; Status → answered | POST /api/admin/qa/unpublish `{id}` | WissenWorkspace.tsx:298-314, 512-517 |
| WIS-14 | „🗑 Verwerfen" (nicht published) | button | Status → dismissed (kein Confirm) | POST /api/admin/qa/dismiss `{id}` | WissenWorkspace.tsx:335-344, 518-522 |
| WIS-15 | „Wiederherstellen" (nur dismissed) | button | Zurück nach open/answered | POST /api/admin/qa/restore `{id}` | WissenWorkspace.tsx:316-333, 526-533 |
| WIS-16 | Vorschau „Vorschau (so erscheint die Antwort im Q&A)" | display (HTML aus qa-links.mjs, nur bei Link im Text) | Gerenderte Links | client-only | WissenWorkspace.tsx:537-546 |
| WIS-17 | „Englische Version anzeigen/anpassen …" → Inputs Question/Answer (English) + Vorschau | disclosure + input + textarea | Optionaler EN-Override (leer = Auto-Übersetzung beim Publish) | client → WIS-11 | WissenWorkspace.tsx:456-497 |
| WIS-18 | Deaktivierte Felder bei Status dismissed | state | Nur Wiederherstellen möglich | – | WissenWorkspace.tsx:417, 429, 439 |

### Helper/explanatory text (Wissen) — 9
1. „Quelle: Gespräche mit „Offener Bedarf"/„Abgesprungen" oder Übergabe ans Kontaktformular. Veröffentlichen schreibt…" — WissenWorkspace.tsx:176-182
2. „Keine Einträge in dieser Ansicht. Nutze „Gespräche scannen", um neue Wissenslücken…" — :186-188
3. Label „Frage (öffentlich sichtbar — anpassbar)" — :412
4. Label „Produkt-Handle (leer = allgemeine Frage)" + Placeholder — :423, 428
5. Placeholder Antwort „Die Antwort des motion sports Teams — erscheint öffentlich im Q&A und in Mos Wissen." — :438
6. „Links als `[Angezeigter Text](https://…)` schreiben — sie erscheinen im Q&A als klickbarer Text statt als URL." — :445-448
7. „Englische Version (optional — leer lassen für automatische Übersetzung beim Veröffentlichen)" / Button-Text — :461-463, 489-492
8. Toast-Texte Publish („In Shopify (custom.qa) gespeichert und Mos Katalog sofort aktualisiert" / „— Mos Katalog folgt mit dem nächsten Sync" / EN-Hinweis) — :275-286
9. Toast-Texte Unpublish/Restore — :302-306, 322-326

### Persistenter Zustand (Wissen)
- URL: `?tab=wissen`. Filter/Edits flüchtig (Edits werden bei Reload durch Server-Objekt überschrieben; useEffect-Sync).

---

## 9. Analyse (`AnalyseTab.tsx`, `analytics/AnalyseWorkspace.tsx`, `GenerateReportPanel.tsx`, `ReportProgressDriver.tsx`, `ReportSidebar.tsx`, `ReportActions.tsx`, `ReportView.tsx`)

### Beschreibung
Master–Detail für gespeicherte Komplettanalysen. Server (`AnalyseTab`) lädt die Berichtsliste (`listAnalyticsReports`, ohne `sections`). Client: Sidebar (Liste + „Neue Komplettanalyse"), Hauptbereich = Generator (Zeitraum-Presets/benutzerdefiniert, 2 Optionen, Live-Kostenschätzung, debounced 350 ms) ODER ausgewählter Bericht (Detail per `GET /api/admin/analytics/[id]`; laufend → `ReportProgressDriver` steppt `POST /step` bis done; fertig → `ReportView`; fehlgeschlagen → Fehlerbox). Aktionen: PDF (GET-Link), Löschen (Dialog).

### Controls & actions
| ID | Element | Type | What it does | Calls | File:line |
|---|---|---|---|---|---|
| ANA-01 | Sidebar „+ Neue Komplettanalyse" (aktiv hervorgehoben) | button | Zurück zum Generator | client-only | ReportSidebar.tsx:66-80 |
| ANA-02 | Sidebar-Liste „Gespeichert (N)": Titel, Status-Pill (läuft/Fehler/fertig), Datum, Kosten | list buttons | Bericht auswählen → Detail laden | GET /api/admin/analytics/[id] | ReportSidebar.tsx:82-133, AnalyseWorkspace.tsx:73-90 |
| ANA-03 | Zeitraum-Presets 7/30/90 Tage + „Benutzerdefiniert" (Von/Bis Date-Inputs) | buttons + date inputs | Analysezeitraum | client-only (→ Estimate) | GenerateReportPanel.tsx:147-198 |
| ANA-04 | Checkbox „Einzelne Kundenprofile (identitätsbezogen)" | checkbox | includePerCustomer (Opus-Profile, teuer) | client-only (→ Estimate) | GenerateReportPanel.tsx:202-216 |
| ANA-05 | Checkbox „Anhang: jedes Gespräch auflisten" (default an) | checkbox | includeAppendix | client-only | GenerateReportPanel.tsx:217-231 |
| ANA-06 | Live-Schätzung: Label, „N Gespräch(e) · N noch zu analysieren · N Persona-Gruppe(n) [· N Kundenprofil(e)]", „Geschätzte KI-Kosten: ca. X" | display (debounced fetch) | Zero-Token-Kostenschätzung | POST /api/admin/analytics/estimate `{range, from, to, includePerCustomer}` | GenerateReportPanel.tsx:74-105, 235-263 |
| ANA-07 | „✨ Komplettanalyse generieren" / „Wird gestartet…" | button | Erstellt Bericht (status running), wählt ihn aus | POST /api/admin/analytics/create `{…, includeAppendix}` | GenerateReportPanel.tsx:107-132, 266-273 |
| ANA-08 | Fortschritts-Karte: Phasenliste mit ✓/Spinner/○ und Zählern (analysiert/noch/ Fehler; Personas k/N; Profile k/N), „KI-Kosten bisher", „Pause"/„Fortsetzen", Fehlerbox „Erstellung gestoppt" + „Erneut versuchen" | display + buttons | Steppt den Bericht bis done (Schleife), pausierbar | POST /api/admin/analytics/step `{id}` (Loop) | ReportProgressDriver.tsx:74-118, 135-236 |
| ANA-09 | Detail-Header: Titel, Status-Badge, Meta (Zeitraum, erstellt, fertig, KI-Kosten, „inkl. Kundenprofile") | display | – | GET detail | AnalyseWorkspace.tsx:158-186 |
| ANA-10 | „⬇ PDF herunterladen" (nur complete) | link (GET) | PDF-Download | GET /api/admin/analytics/[id]/pdf | ReportActions.tsx:60-68 |
| ANA-11 | „🗑 Löschen" → Dialog „Analyse löschen?" (Abbrechen / Löschen) | button + dialog | Bericht dauerhaft entfernen; zurück zum Generator | POST /api/admin/analytics/delete `{id}` | ReportActions.tsx:29-57, 69-96 |
| ANA-12 | Fehlerzustand „Erstellung fehlgeschlagen" + Fehlertext + „Bitte den Bericht löschen und neu erstellen." | display | – | – | AnalyseWorkspace.tsx:212-218 |
| ANA-13 | Ladezustände „Bericht wird geladen…", Detail-Fehler „Erneut laden" | display/button | – | GET detail | AnalyseWorkspace.tsx:118-140 |
| ANA-14 | ReportView: Hinweise (notes), Kennzahlen (6 Stats + Tier-Zeile + KI-Ausgaben), Verteilungen (Kategorien/Qualität), Aggregierte Insights (Markdown), Personas (Karten mit Lieblingsprodukten + Top-Fragen), Kundenwissen (aggregiert + einzelne Profile), Anhang (Gesprächsliste) | display | Vollständiger Bericht | – | ReportView.tsx:137-273 |

### Helper/explanatory text (Analyse) — 11
1. CardDescription „Verdichtet ALLE KI-Analysen für ein Zeitintervall an einem Ort: … Bewusst gründlich (und damit teurer); …" — GenerateReportPanel.tsx:139-143
2. „Regeneriert pro aktivem Kunden das „aktuelle Verständnis" (Opus) — am teuersten und enthält Namen. Sonst bleibt der Bericht pseudonym." — :212-215
3. „Hängt jede Gesprächs-Zusammenfassung (Kategorie, Qualität) an — „alles an einem Ort", aber ein längeres PDF." — :227-230
4. „(bereits analysierte Gespräche werden kostenlos wiederverwendet)" — :253-255
5. „Erscheint sofort links im Seitenpanel und läuft dort weiter." — :270-272
6. „Du kannst diese Seite geöffnet lassen — der Bericht wird Schritt für Schritt erstellt … Pausieren ist jederzeit möglich…" — ReportProgressDriver.tsx:229-233
7. Sidebar leer: „Noch keine Analysen. Erstelle oben deine erste Komplettanalyse." — ReportSidebar.tsx:87-89
8. Dialog „Dieser gespeicherte Bericht wird dauerhaft entfernt. Die zugrunde liegenden Gespräche und ihre einzelnen Analysen bleiben erhalten." — ReportActions.tsx:76-79
9. ReportView Section-Subtitles („Überblick über den Zeitraum", „Verdichtet aus den Gesprächs-Zusammenfassungen", „Gruppen, Lieblingsprodukte & Top-Fragen im Zeitraum", „Aggregierte Synthese & — falls gewählt — einzelne Profile", „Jede analysierte Beratung mit Kategorie & Qualität") — ReportView.tsx:155, 217, 226, 240, 265
10. Stat-Tooltip „Fehler-Proxy: Nutzer-Nachricht ohne jede Bot-Antwort." — ReportView.tsx:166
11. „— identitätsbezogen, nur intern" — ReportView.tsx:255

### Persistenter Zustand (Analyse)
- URL: `?tab=analyse` (Auswahl NICHT in der URL). Berichte + Fortschritt serverseitig persistiert (resumierbar).

---

## 10. Verbesserung (`VerbesserungTab.tsx`, `verbesserung/VerbesserungWorkspace.tsx`, `SuggestionCard.tsx`, `DirectivesCard.tsx`, `SelfSnapshotCard.tsx`)

### Beschreibung
Geschlossener Verbesserungs-Loop (docs/IMPROVEMENT_LOOP.md). Server lädt Läufe (`listImprovementRuns`), fertige Komplettanalysen (`listAnalyticsReports` → complete), Anweisungen (`listDirectives`) und Mos Selbstbild (`buildMoSelfSnapshot`: gerenderter System-Prompt + Hash). Client: Sidebar (Läufe + „Neuer Verbesserungslauf"), Hauptbereich = Neuer-Lauf-Panel ODER Lauf-Detail (`GET /api/admin/improve/[id]`; laufend → `RunDriver` steppt `POST /step` mit Reconnect-Logik; fertig → Wirkungs-Check (Delta-Tabelle + Markdown) + Vorschlagskarten in zwei Lanes (Mo / Shop)). Darunter zwei einklappbare Tool-Sections: „Anweisungen an Mo" (DirectivesCard) und „Mos Selbstbild" (SelfSnapshotCard).

### Controls & actions
| ID | Element | Type | What it does | Calls | File:line |
|---|---|---|---|---|---|
| VER-01 | Sidebar „+ Neuer Verbesserungslauf" | button | Zum Neuer-Lauf-Panel | client-only | VerbesserungWorkspace.tsx:262-274 |
| VER-02 | Sidebar-Liste „Läufe (N)": Titel, Badge läuft/Fehler/fertig, Datum, „N Vorschläge" | list buttons | Lauf auswählen → Detail | GET /api/admin/improve/[id] | VerbesserungWorkspace.tsx:276-323, 110-133 |
| VER-03 | Select „Grundlage (fertige Komplettanalyse)" | select | Bericht als Basis | client-only | VerbesserungWorkspace.tsx:431-448 |
| VER-04 | „Lauf starten" | button | Erstellt Lauf (running) und wählt ihn | POST /api/admin/improve/run `{reportId}` | VerbesserungWorkspace.tsx:350-378, 455-458 |
| VER-05 | Warnbox „Noch keine fertige Komplettanalyse vorhanden — bitte zuerst im Tab „Analyse"…" | display | – | – | VerbesserungWorkspace.tsx:424-428 |
| VER-06 | RunDriver: Spinner + Phasenlabel, „(Verbindung unterbrochen — es wird automatisch weiter versucht)", Fehler + „↻ Fortsetzen" | display + button | Steppt den Lauf; Retry bei Netzfehlern (60×5 s), `busy` → Polling | POST /api/admin/improve/step `{id}` (Loop) | VerbesserungWorkspace.tsx:640-763 |
| VER-07 | Lauf-Header: Titel, Status-Badge, Meta (Zeitraum, erstellt, KI-Kosten, Prompt-Version) | display | – | – | VerbesserungWorkspace.tsx:487-501 |
| VER-08 | „🗑 Löschen" (window.confirm „Diesen Verbesserungslauf samt Vorschlägen löschen?") | button + native confirm | Lauf löschen → Liste refresh, zurück zum Panel | POST /api/admin/improve/delete `{id}` | VerbesserungWorkspace.tsx:765-803 |
| VER-09 | Wirkungs-Check-Karte: Delta-Tabelle (Kennzahl · vorher · jetzt · Δ pp, Basis-Zeile) + Markdown effectCheck | display | Ergebnis früherer Maßnahmen | – | VerbesserungWorkspace.tsx:513-537, 581-626 |
| VER-10 | Vorschlagsgruppen „Vorschläge für Mo selbst (N)" / „Vorschläge für den Online-Shop (N)" | display | Lanes | – | VerbesserungWorkspace.tsx:548-559 |
| VER-11 | SuggestionCard: Prioritätszeile (Ampelpunkt + „Große/Mittlere/Kleine Wirkung · … Aufwand"), Status-Badge, Titel | display | – | – | SuggestionCard.tsx:172-180 |
| VER-12 | Textarea „So würde Mo künftig beraten" (editierbar vor Übernahme, max MAX_DIRECTIVE_CHARS, Zeichenzähler) ODER „Was zu tun ist" (Markdown) | textarea/display | Direktivtext bzw. Vorschlag | client-only | SuggestionCard.tsx:184-216 |
| VER-13 | „Warum? Details & Belege" (Kategorie, Begründung, ausführlicher Vorschlag, Evidenz-Liste, „Daran messen wir den Erfolg") | disclosure | Details ein-/ausblenden | client-only | SuggestionCard.tsx:219-262 |
| VER-14 | „🪄 Übernehmen — gilt ab sofort" (Direktiv-Karten) | button | Legt Anweisung live an + Karte → Erledigt | POST /api/admin/improve/adopt `{suggestionId, content}` | SuggestionCard.tsx:123-166, 302-306 |
| VER-15 | „✓ Erledigt — ist umgesetzt" (Nicht-Direktiv-Karten) | button | Status implemented | POST /api/admin/improve/suggestion `{suggestionId, status}` | SuggestionCard.tsx:309-313 |
| VER-16 | „✕ Verwerfen" → Inline „Warum nicht? (optional)" Input + „Endgültig verwerfen" / „Abbrechen" | button + input | Status dismissed mit Notiz | POST /api/admin/improve/suggestion `{…, status:"dismissed", note}` | SuggestionCard.tsx:272-293, 315-318 |
| VER-17 | „↺ Wieder öffnen" (dismissed) | button | Status open | POST /api/admin/improve/suggestion | SuggestionCard.tsx:294-300 |
| VER-18 | Notiz-Anzeige „Notiz: …" | display | statusNote | – | SuggestionCard.tsx:264-268 |
| VER-19 | ToolSection „Anweisungen an Mo" (Summary „N aktiv", einklappbar, default zu) | disclosure | – | client-only | VerbesserungWorkspace.tsx:214-223 |
| VER-20 | DirectivesCard: Liste (Badge aktiv/inaktiv, „aus Vorschlag", „zuletzt geändert …", Text) | display | Live-Anweisungen | – | DirectivesCard.tsx:236-253, 284 |
| VER-21 | Icon „Verlauf anzeigen" (History, kein aria-label) → Versionsliste (Angelegt/Text geändert/Aktiviert/Deaktiviert + Zeit + Text) | icon button + list | Lazy-Load der Versionen | GET /api/admin/directives/versions?id= | DirectivesCard.tsx:214-227, 255-257, 287-313 |
| VER-22 | Icon „Bearbeiten" (Pencil) → Textarea + „✓ Speichern" / „Abbrechen" | icon button + textarea | Text ändern (versioniert) | POST /api/admin/directives/save `{id, content}` | DirectivesCard.tsx:161-186, 258-267, 268-283 |
| VER-23 | Icon „Deaktivieren/Aktivieren" (Power) | icon button | Toggle aktiv | POST /api/admin/directives/toggle `{id, active}` | DirectivesCard.tsx:188-212, 269-278 |
| VER-24 | „Neue Anweisung (k/N aktiv)" Textarea (maxLength) + Zähler + „+ Anweisung aktivieren" | textarea + button | Neue Direktive anlegen (aktiv) | POST /api/admin/directives/save `{content}` | DirectivesCard.tsx:68-99, 128-149 |
| VER-25 | ToolSection „Mos Selbstbild (System-Prompt)" (Summary „Version <hash>") → SelfSnapshotCard: Badge „Version <hash>", Button „System-Prompt anzeigen/ausblenden", `<pre>` Prompt | disclosure + display | Lesbarer Live-Prompt | server-render (`buildMoSelfSnapshot`) | VerbesserungWorkspace.tsx:224-227, SelfSnapshotCard.tsx:22-58 |
| VER-26 | Leer-/Ladezustände: „Noch keine Läufe…", „Lauf wird geladen…", Detail-Fehler + „Erneut laden" | display | – | – | VerbesserungWorkspace.tsx:153-176, 287-290 |

### Helper/explanatory text (Verbesserung) — 14
1. NewRunPanel 3-Schritte-Liste („1 · Mo schlägt vor: …", „2 · Du entscheidest: …", „3 · Der nächste Lauf misst: …") — VerbesserungWorkspace.tsx:398-422
2. „2–3 Modell-Aufrufe (Sonnet) · typischerweise deutlich unter 0,50 €. Es wird nichts automatisch geändert …" — :451-454
3. RunDriver „Zwei bis drei Modell-Aufrufe nacheinander — insgesamt kann das einige Minuten dauern. Kurze Verbindungsabbrüche…" — :754-758
4. Failed „Lauf fehlgeschlagen … Bitte den Lauf löschen und neu starten." — :505-511
5. Wirkungs-Check „Kennzahlen sind Quoten je Gespräch im jeweiligen Analysezeitraum. Bewegungen zeigen Korrelation, keine bewiesene Ursache." — :529-532
6. „Kein Wirkungs-Check in diesem Lauf — es gab noch keine angenommenen oder umgesetzten Maßnahmen aus früheren Läufen." — :522-526
7. „Keine neuen Vorschläge — alles bereits Vorgeschlagene ist noch offen oder umgesetzt…" — :541-545
8. „Nichts passiert automatisch: Ein Vorschlag wird erst wirksam, wenn du ihn übernimmst oder selbst umsetzt…" — :562-566
9. DeltaTable „Basis: N Gespräche (voriger Lauf) vs. M Gespräche (dieser Lauf)." — :619-622
10. SuggestionCard „Direkt anpassbar — genau dieser Text gilt nach dem Übernehmen · k/N Zeichen" — SuggestionCard.tsx:200-203
11. SuggestionCard Toast „Übernommen — Mo berät ab sofort so … kann dort jederzeit angepasst oder abgeschaltet werden." — :152-157
12. DirectivesCard Intro „Kurze Verhaltensregeln, die live in Mos System-Prompt eingefügt werden … Max. N aktive Anweisungen à M Zeichen — Mos Kern-Prompt bleibt unverändert im Code (Git)." — DirectivesCard.tsx:106-113
13. DirectivesCard leer „Noch keine Anweisungen. Lege unten die erste an — oder übernimm eine aus einem Verbesserungsvorschlag." + Toast „Sie fließt innerhalb weniger Minuten in Mos System-Prompt ein." — :116-119, 92-96
14. SelfSnapshotCard „Der aktuell wirksame System-Prompt, kanonisch gerendert — genau der Stand, den der Verbesserungslauf analysiert. Enthält N veröffentlichte Q&A-Einträge und M aktive Anweisung(en). Der Kern-Prompt wird über Code-Änderungen (Git) angepasst; hier ist er nur lesbar." — SelfSnapshotCard.tsx:28-34

### Persistenter Zustand (Verbesserung)
- URL: `?tab=verbesserung` (Auswahl nicht in URL). Läufe/Vorschläge/Direktiven/Versionen serverseitig; Step-Claim (Migration 0045) schützt vor Doppelschritten.

---

## 11. Einstellungen (`EinstellungenTab.tsx`, `EmailSettingsWorkspace.tsx`)

### Beschreibung
E-Mail-Design-Verwaltung. Server lädt `listEmailDesignMeta()` (Code-Registry), `listEmailDesignSelections()` (DB, nur wenn dbReady), Versandkonfiguration aus Env (`isEmailConfigured`, `senderAddress`, `inboundEmailAddress`, `EMAIL_LOGO_URL`). Client: drei Karten — Design-Bibliothek (je Design: Name, Standard-Badge, Beschreibung, „Hinzugefügt am", Badges „Aktiv: <Typ>"/„Nicht in Verwendung", je unterstütztem Typ ein Vorschau-Button), Aktives Design je E-Mail-Typ (Select + Vorschau je Typ; Änderung sofort per API), Versand-Konfiguration (read-only Definitionsliste).

### Controls & actions
| ID | Element | Type | What it does | Calls | File:line |
|---|---|---|---|---|---|
| EIN-01 | Design-Karte: Name, Badge „Standard", Beschreibung, „Hinzugefügt am <Datum>", Badges „Aktiv: Zusammenfassung/Anmelde-Bestätigung (DOI)/Marketing (Kunden)/Kampagne (Shopify-Abonnenten)" bzw. „Nicht in Verwendung" | display | Registry-Metadaten + effektive Zuordnung | server-render | EmailSettingsWorkspace.tsx:159-192 |
| EIN-02 | Vorschau-Buttons je Typ pro Design („👁 Zusammenfassung", „Anmelde-Bestätigung (DOI)", „Marketing (Kunden)", „Kampagne (Shopify-Abonnenten)") → Dialog mit `EmailPreviewFrame` (Desktop/Mobil) | button + dialog | Beispiel-E-Mail dieses Typs im Design | POST /api/admin/email-designs/preview `{designKey, kind}` | EmailSettingsWorkspace.tsx:193-210, EmailPreviewButton.tsx |
| EIN-03 | Select „Design für <Typ>" je E-Mail-Typ (Optionen = Designs, die den Typ unterstützen; „Klassisch (Standard)" = null) | select | Zuordnung sofort speichern; Toast „Design zugeordnet — <Typ> verwendet ab sofort „<Name>"" | POST /api/admin/email-designs/assign `{kind, designKey|null}` | EmailSettingsWorkspace.tsx:92-140, 267-281 |
| EIN-04 | „👁 Vorschau" je Typ (aktuell aktives Design) | button + dialog | Vorschau des effektiven Designs | POST /api/admin/email-designs/preview `{designKey: effective, kind}` | EmailSettingsWorkspace.tsx:282-291 |
| EIN-05 | Warnbox „Keine Datenbank konfiguriert (DATABASE_URL) — die Auswahl kann nicht gespeichert werden…" (+ Selects disabled) | display/state | – | – | EmailSettingsWorkspace.tsx:243-248 |
| EIN-06 | Versand-Konfiguration: „E-Mail-Versand" Badge Konfiguriert/Nicht konfiguriert, „Absender-Adresse", „Antwort-/Eingangsadresse", „Logo-Override (EMAIL_LOGO_URL)" | display (dl) | Env-Werte read-only | server-render | EmailSettingsWorkspace.tsx:311-338 |

### Helper/explanatory text (Einstellungen) — 8
1. CardDescription Design-Bibliothek „Alle verfügbaren E-Mail-Designs. Jedes Design definiert das allgemeine Erscheinungsbild … Die Inhalte (KI-Texte, Produkte, Rechtstexte) bleiben immer unverändert." — EmailSettingsWorkspace.tsx:149-155
2. Infobox „Neue Designs werden mit Claude Code entwickelt (Anleitung: docs/EMAIL_DESIGNS.md) und erscheinen hier nach dem Deployment automatisch. Bestehende Designs bleiben dauerhaft erhalten … ein Redesign ist immer ein neues Design, kein Überschreiben." — :215-224
3. CardDescription Zuordnung „Wähle für jeden E-Mail-Typ, welches Design er aktuell verwendet. Die KI erstellt und versendet die E-Mails wie gewohnt — im gewählten Design. Ein Wechsel wirkt sofort auf neue Sendungen und lässt sich jederzeit zurücknehmen." — :234-239
4. Typ-Hinweise `EMAIL_THEME_KIND_HINTS` (z. B. „Transaktionale Beratungs-Zusammenfassung mit Warenkorb-Link.", „Double-Opt-in-Bestätigung — der rechtlich geprüfte Text bleibt unverändert.", „Persönliche KI-E-Mails an Chat-Kunden (Rabatt, Warenkorb, Set-Angebot).", „Persönliche KI-E-Mails an Shopify-Marketing-Abonnent:innen (de/en).") — :260-262 (lib/email-theme.mjs)
5. Vorschau-Dialog-Beschreibungen („Beispiel-E-Mail dieses Typs im gewählten Design — Inhalte sind Beispieldaten, Links inaktiv.", „So sieht dieser E-Mail-Typ mit dem aktuell gewählten Design aus (Beispieldaten).") — :203, 287
6. CardDescription Versand „Diese Werte kommen aus den Umgebungsvariablen des Deployments (Resend) und werden hier nur angezeigt." — :305-308
7. „Hinweis: Der rechtlich geprüfte Text der Anmelde-Bestätigung (DOI) und der Abmelde-Hinweis in Marketing-E-Mails bleiben von Designs unberührt." — :339-342
8. „Hinzugefügt am <Datum>" — :176-178

### Persistenter Zustand (Einstellungen)
- URL: `?tab=einstellungen`. Zuordnungen in `email_design_selections` (DB). Keine Client-Persistenz.

---

## 12. Gemeinsame Komponenten & Primitives

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
| `ui/dialog.tsx` + `ui/portal.ts` | Modal (Esc/Overlay, Portal in #admin-root) | Kampagne (3), CustomerProfileCard (Transkript), EmailPreviewButton, GespraecheInsights (Bulk), ReportActions |
| `ui/toast.tsx` | Toaster + `toast()` (update/dismiss) | alle Mutationen |
| `ui/stat.tsx` | Section/Stat(+title-Tooltip)/Caveat | KpiTab, OverviewTab, ReportView |
| `ui/markdown.tsx` | Sanitized Markdown-Renderer (keine dangerouslySetInnerHTML) | Kunden (Profil, Sent), Gespräche, Insights, Analyse, Verbesserung, KpiTopQuestions, Korrespondenz |
| `ui/product-picker.tsx` | Katalogsuche + Variantenwahl (`useCatalogSearch`) | Kampagne (Empfehlungen), Kunden (Bundle-Composer), Wissen (Link) |
| `EmailPreviewFrame.tsx` | Iframe-Vorschau Desktop/Mobil (skaliert) | Kampagne, EmailPreviewButton |
| `EmailPreviewButton.tsx` | „Vorschau"-Button + Dialog (POST → blob → iframe) | Kunden (Marketing), Korrespondenz, Einstellungen |
| `EmailTextModeToggle.tsx` | Segment Ausführlich/Kompakt/Minimal | Kunden (Marketing, Bulk), Kampagne |
| `HeroImagePanel.tsx` | Hero-Bild-Panel (GET state, suggest/generate/headline/remove) | Kunden (Marketing-Entwurf), Kampagne |
| `ThemeToggle.tsx`, `theme-config.ts`, `theme.css` | Light/Dark (Cookie `ms_admin_theme`, Init-Script) | layout/AdminShell |
| `customer-filter.ts` | Pure Filter/Sort für Kundenliste | KundenWorkspace |
| `KpiCharts.tsx` | Recharts-Islands (Area/Donut/Bars/Funnel) | KpiTab |

## 13. Tab-übergreifende Flüsse (Deep Links)
- Übersicht → Kunden: `/admin?tab=kunden&filter=no_purchase`, `…&filter=marketing`, `/admin?tab=kunden`; Übersicht → KPIs `/admin?tab=kpi`.
- Legacy: `?tab=customers` → kunden; `?status=` → filter-Preset.
- KPI-Zeitraum: `?tab=kpi&kpiRange=7d|30d|90d|custom&kpiFrom&kpiTo` (router.push, Server-Re-Render).
- Gespräche-Filter: `?tab=gespraeche&grange&gfrom&gto&gtier&gerr&gcat&gqual&gq&gpage` (router.push).
- Gespräche Insights-Report „Gespräch #n öffnen" → wählt Detail in-place (kein URL-Wechsel).
- Wissen-Einträge nennen „aus Gespräch #n" (Text, KEIN Link) — Kandidat für Deep Link.
- Kampagne → Kunden: kein Link (Kampagnen-Kontakte sind Shopify-Kontakte, keine Kunden-Entities).
- Shell-Shortcuts `1–9` (Tab n), `/` (Kunden-Suche); Kampagne `N/P/V/C/S/X`.

## 14. Dokumentiert, aber nicht im Code gefunden (docs/ADMIN_DASHBOARD.md)
- Behauptung „Tabs are switched server-side via ?tab= — no client router" (Intro) — veraltet: Shell ist ein Client-Tab-Switch mit `history.replaceState`; nur Übersicht/KPIs navigieren serverseitig.
- Intro nennt neun Tabs ohne „Einstellungen" — der Tab existiert.
- (Weitere Abgleiche im Doku-Slice; ADMIN_DASHBOARD.md wird nach dem Redesign neu geschrieben.)

## 15. Zeilenzahlen (src/app/admin)
Siehe `find src/app/admin -type f | xargs wc -l` (Stand Inventar): KampagneWorkspace 2338 (client), KpiTab 1758 (server), CustomerProfileCard 1521 (client), GespraecheWorkspace 841 (client), verbesserung/VerbesserungWorkspace 804 (client), WissenWorkspace 589 (client), KundenWorkspace 546 (client), GespraecheInsights 508 (client), KorrespondenzPanel 442 (client), HeroImagePanel 373 (client), ui/markdown 361, verbesserung/DirectivesCard 342 (client), EmailSettingsWorkspace 336 (client), PhysicalLetterPanel 326 (client), KpiCharts 324 (client), verbesserung/SuggestionCard 319 (client), page.tsx 318 (server), ui/product-picker 293 (client), analytics/ReportView 274 (server-renderable), analytics/GenerateReportPanel 272 (client), AdminShell 262 (client), OverviewTab 247 (server), analytics/ReportProgressDriver 241 (client), analytics/AnalyseWorkspace 236 (client), FeedbackList 188 (client), KampagneTab 180 (server), UnmatchedInboundQueue 167 (client), ui/dialog 161 (client), analytics/ReportSidebar 137 (client), KpiDateRangePicker 136 (client), customer-filter 130, ui/toast 128 (client), ui/tabs 125 (client), EmailPreviewFrame 117 (client), EmailPreviewButton 117 (client), login/page 103 (server), KpiTopQuestions 103 (client), analytics/ReportActions 99 (client), GespraecheTab 86 (server), ui/table 81, ui/stat 75, ui/card 63, ui/button 62, verbesserung/SelfSnapshotCard 58 (client), ThemeToggle 54 (client), ui/index 53, FeedbackTab 53 (server), EmailTextModeToggle 50 (client), VerbesserungTab 48 (server), layout 45 (server), ui/badge 44, ui/checkbox 43, WissenTab 39 (server), AnalyseTab 33 (server), ui/select 32, ui/cn 32, EinstellungenTab 31 (server), theme-config 25, ui/input 22, ui/textarea 21, ui/label 19, ui/skeleton 16, ui/portal 8.

---

# 2. HTTP API routes

Generated 2026-09-08 from a read-only pass over every `route.ts` under `src/app/api/**` (112 files), `src/proxy.ts`, `src/app/page.tsx`, `src/app/admin/**` pages. All file paths are relative to `/home/user/mo`. Line numbers are `file:line`.

Legend for the **Auth** column (mechanisms as implemented, see "Auth helpers" at the end):

- **guardRequest** = `src/lib/security.ts:82` — Origin header, if present, must be in `ALLOWED_ORIGINS` (default `https://www.motionsports.de`, `https://motionsports.de`) → 403, AND `x-ms-chat-key` must equal `CHAT_SHARED_SECRET` (SHA-256-then-timingSafeEqual) → 401. Missing Origin (curl / server-to-server) is allowed if the secret is right.
- **guardOriginOnly** = `src/lib/security.ts:116` — Origin allowlist only; no secret. A request with NO Origin header passes.
- **requireSignedInCustomer** = `src/lib/account-guard.ts:44` — guardRequest + `chat` rate bucket + `resolveSignedInCustomer(session)` (session from `?session=` or `x-ms-session`) must map to a customer with a `shopify_customer_id` + `getValidAccessToken(customerId)` must yield a live (refreshable) Shopify Customer Account token; else 401.
- **proxy only** = the route relies solely on `src/proxy.ts` (matcher `/admin/:path*`, `/api/admin/:path*`) verifying the `ms_admin_session` HMAC cookie; there is NO in-handler check.
- **guardAdminPost** = `src/lib/admin-api.ts:27` — in-handler: `Content-Type` must include `application/json` (415) AND `ms_admin_session` cookie must verify (401).
- **guardAdminGet** = `src/lib/admin-api.ts:44` — in-handler cookie re-verification only.
- **requireCronAuth** = `src/lib/cron-auth.ts:41` — `Authorization: Bearer <CRON_SECRET>` (constant-time); fails closed when unset.

Rate-limit buckets (`src/lib/rate-limit.ts:21-62`, Upstash sliding window, key = `sid:<x-ms-session>` else `ip:<x-forwarded-for>`): `chat` 20/60s, `products` 60/60s, `kpi` 120/60s, `tts` 20/300s, `tts-stream` 120/300s, `feedback` 5/300s, `capture-recipient` 3/60m (explicit key = recipient email), `contact-ip` 8/60m (explicit key = client IP). If Upstash env is missing, `getRedis()` throws → 500 from the route (rate limiting never silently disables).

Runtime: no route sets `runtime = "edge"`; all run on Node. Routes that export `runtime = "nodejs"` explicitly are marked; others use the default (also Node). No route exports `dynamic`.

---

## 1. Chat / widget public routes (cross-origin XHR from the Shopify theme widget)

Caller for all of these is the external vanilla-JS Shopify widget (contract: `docs/API_CONTRACT.md`, handoff: `docs/frontend-handoff/`). The widget source is NOT in this repo.

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/chat` (`src/app/api/chat/route.ts`) | POST, OPTIONS | Streams Mo's answer: `streamText` with `anthropic("claude-sonnet-4-6")`, agentic loop ≤6 steps (+1 for forced email offer), tools from `buildChatTools`, retrieval `retrieveForTurn`, memory `resolveChatMemory`, Q&A `getCachedGeneralQa`, directives `getCachedActiveDirectives`; eager `ensureConversationStarted` before the stream; `persistTurn` + `recordKpiEvent(KPI_EMAIL_CAPTURE_ASK_SHOWN)` + card guard in `onFinish`. Prompt-caching breakpoints via `providerOptions`. | widget | guardRequest | `chat` | `maxDuration = 300` (line 52) | manual: body must be JSON (400), `messages` must be array (400), ≤40 messages (400 `payload_too_large`), `conversationKey` string sliced to 200, `locale` via `resolveLocale`, `context`/`customer` loosely typed and validated downstream against the catalog / capture record | `toUIMessageStreamResponse` SSE with CORS + `Cache-Control: no-cache, no-transform` + `X-Accel-Buffering: no`; errors = `{error:{code,message}}` 400/429/500 | `payload_too_large` returned with HTTP **400** (line 244-251) while `/api/feedback` maps the same code to 413 — inconsistent. Session id only from `x-ms-session` header (line 204), never from body. Persistence and KPI writes are best-effort (errors swallowed via `reportError`). |
| `POST /api/contact` (`src/app/api/contact/route.ts`) | POST, OPTIONS | Renders the contact form (reason/name/email/org/phone/productIds/message) to text+HTML and emails it to `CONTACT_TO_EMAIL` via the **Resend SDK directly** (not `lib/email`), `replyTo` = submitter; records `KPI_CONTACT_FORM_SUBMITTED`. | widget (`show_contact_form` tool) | guardRequest | `chat` + `contact-ip` (8/60m, keyed `ip:<clientIp>`) | `maxDuration = 10` | manual `isValid` (line 25): reason/name/message strings non-empty, email regex; `productIds`, `organization`, `phone`, `sessionId` unchecked | `{ok:true}` 200; 400 `bad_request`; 502 `upstream_unavailable`; 500 | When `RESEND_API_KEY`/`CONTACT_TO_EMAIL`/`CONTACT_FROM_EMAIL` are unset it logs metadata and returns **`{ok:true}` without sending** (line 154-171). Second 502 message (line 206) is hard-coded German while the first (line 193) is localized via `apiMessage` — inconsistent. `productIds` not checked to be an array (line 54, 146: a non-array truthy value would throw → 500). `sessionId` read from the body only (no `x-ms-session` fallback, unlike `/api/feedback`, `/api/capture-email`). |
| `GET /api/products` (`src/app/api/products/route.ts`) | GET, OPTIONS | Hydrates product cards: `?ids=a,b` / repeated `?id=` (≤10, deduped, order preserved) → `loadProductCatalog()` (`lib/catalog-store`), variant-pinned refs `handle~variantId` via `parseProductRef`/`projectVariant`, public projection `toPublic` (drops `shopifyCartUrl` when sold out), combined `cartUrl` via `buildPrefilledCartUrl(..., {excludeSoldOut:true})`. | widget (card hydration after `show_product` / `compare_products` / `add_to_cart` tool calls) | guardOriginOnly (no secret, by design — public storefront data) | `products` | `maxDuration = 10` | manual `parseIds`; 0 ids → 400; >10 → 400 `payload_too_large` | `{products: (PublicProduct\|null)[], cartUrl: string\|null}` 200, `Cache-Control: public, max-age=60, stale-while-revalidate=300` | Unknown ids → `null` entries (no 404). `payload_too_large` with HTTP 400 again. |
| `POST /api/capture-email` (`src/app/api/capture-email/route.ts`) | POST, OPTIONS | GDPR email capture + double opt-in entry: `validateCaptureRequest` → `upsertEmailCapture` (consent record + `consent_copy_version` via `resolveConsentCopyVersion`) → `linkCustomerOnEmailCapture` → KPI `EMAIL_CAPTURE_SUBMITTED`/`MARKETING_OPTED_IN` → `sendSummaryEmail` (transactional) → if `doiEmailRequired`: DOI mail via `sendEmail` inside `withEmailDesign(getCachedEmailDesignForKind("doi"))`, mirrored with `recordSentMessage`. | widget (capture card) | guardRequest | `chat` + `capture-recipient` (3/60m keyed `email:<lowercased>`) | `maxDuration = 30` | `validateCaptureRequest` (`lib/capture-validation.mjs`) for email + transactional consent; other fields manual (`trigger` sliced to 40) | `{ok:true, transactional:{summarySent}, marketing:{status, doiEmailSent, alreadyConfirmed}}` 200; 400 `bad_request`/`transactional_consent_required`; 503 `upstream_unavailable` (consent not stored); 502 (summary send failed) | The DOI-send block (lines 208-252) is duplicated verbatim in `/api/chat-marketing-opt-in` (188-229) and `/api/account/marketing-opt-in` (162-203). `summarySent` is reported **true when Resend is merely not configured** (`summarySkipped`, line 197/257). DOI send failure only lowers `doiEmailSent` + `reportError`. `sessionId` from body, falls back to `x-ms-session`. |
| `GET /api/consent-copy` (`src/app/api/consent-copy/route.ts`) | GET, OPTIONS | Serves the legally load-bearing consent strings: `captureConsentCopy(locale)` (default), `signInMarketingConsentCopy` (`?surface=signin`), `chatGateMarketingConsentCopy` (`?surface=chat`). | widget | guardOriginOnly | `products` (shares quota with `/api/products`) | `maxDuration = 10` | `surface` compared to two literals; `locale` via `resolveLocale` | copy JSON 200, `Cache-Control: public, max-age=60, stale-while-revalidate=300` | Read-only; nothing odd. |
| `POST /api/tts` (`src/app/api/tts/route.ts`) | POST, OPTIONS | Text-to-speech via OpenAI `audio.speech.create` (`TTS_MODEL` default `gpt-4o-mini-tts`, voice `coral`, instructions/speed env-tunable), `prepareTtsText` strips Markdown and truncates at `MAX_TTS_CHARS`; fire-and-forget `recordAiUsage` (characters as `inputTokens`, `estimated:true`) attributed via `getConversationIdBySession`. | widget voice mode | guardRequest | `tts` (single-shot) or `tts-stream` when `body.stream` is `true`/`"true"`/`1` | `maxDuration = 60` | manual: JSON, `text` must be string, `stream`, `seq` (non-negative int else -1) | `audio/mpeg` stream, `Cache-Control: no-store`, exposed headers `X-MS-TTS-Truncated`, `X-MS-TTS-Chars`, `X-MS-TTS-Seq`; JSON envelope 400/429/502 (`upstream_unavailable` when no `OPENAI_API_KEY` or synthesis fails)/500 | The **bucket is chosen by a client-supplied flag** (line 119/128): any caller can send `stream:true` to get 120/5min instead of 20/5min while still sending full `MAX_TTS_CHARS` texts — the "chunks stay small" claim in the comment is not enforced server-side. Rate limit is checked only after JSON parsing (invalid JSON bypasses the limiter). |
| `POST /api/kpi` (`src/app/api/kpi/route.ts`) | POST, OPTIONS | Telemetry ingest: `INSERT INTO kpi_events (session_id, event, data)` via raw `getSql()` in the route. | widget `track()` | guardOriginOnly (no secret) | `kpi` | `maxDuration = 10` | manual: `event` non-empty string ≤120; `sessionId` ≤128; `data` must be a plain object (else `{}`); `timestamp` copied to `data.clientTimestamp` | **202** `{ok:true}` even when the DB is missing or the insert fails (swallowed, `reportError`) | Raw SQL in the route while `lib/kpi-events.ts:recordKpiEvent` exists for the same table (duplication). Event name not validated against any vocabulary; `data` size unbounded beyond body size. By design fail-silent. |
| `POST /api/feedback` (`src/app/api/feedback/route.ts`) | POST, OPTIONS | Stores a free-text comment via `insertFeedback` (table `feedback`, shown read-only in the admin Feedback tab). | widget feedback form | guardRequest | `feedback` | `maxDuration = 10` | `validateFeedbackRequest` (`lib/feedback-validation.mjs`); `sessionId` falls back to `x-ms-session` | `{ok:true}` 200; 400 / **413** (`payload_too_large`); 503 `upstream_unavailable` | Only route mapping `payload_too_large` to 413 (chat/products use 400). |
| `POST /api/chat-marketing-opt-in` (`src/app/api/chat-marketing-opt-in/route.ts`) | POST, OPTIONS | Marketing-only DOI signup from the in-chat consent gate: `isValidEmail` → requires `marketingConsent === true` → `upsertEmailCapture(transactional:false, marketing:true)` → `linkCustomerOnEmailCapture` → KPI ×2 → DOI email (same block as capture-email). | widget (chat consent gate, copy from `/api/consent-copy?surface=chat`) | guardRequest | `chat` + `capture-recipient` | `maxDuration = 30` | manual + `isValidEmail`; `marketingConsent` must be `true` | `{ok:true, marketing:{status, doiEmailSent, alreadyConfirmed}}`; 400 `invalid_email` / `marketing_consent_required`; 503 | Near-verbatim clone of `/api/capture-email` minus the summary. |
| `GET /api/confirm-marketing` (`src/app/api/confirm-marketing/route.ts`) | GET | DOI confirmation link: `confirmMarketingByToken(token)` flips `marketing_doi_status` to `confirmed`, `syncCustomerConsent(email)`, KPI `MARKETING_CONFIRMED` (once), renders an HTML result page (`renderResultPage`). | email link click (top-level navigation from the DOI mail sent by capture-email / chat-marketing-opt-in / account/marketing-opt-in) | opaque DOI token in `?token=` (see "Token-based links") | none | `maxDuration = 30` | token non-empty | HTML page: 200 confirmed, 400 invalid, 410 expired, 500 | No CORS (intended). No rate limit on token probing — relies on token entropy. |
| `GET /api/newsletter-rating` (`src/app/api/newsletter-rating/route.ts`) | GET | Anonymous 1–5 smiley rating row in image-first emails: `parseEmailRating(r)`, `parseEmailThemeKind(k)` → `insertFeedback({page:"email:<kind>", rating, emailKind})`; HTML thank-you page. | email link click | none (anonymous by design — no recipient identity in the link) | `feedback` (keyed by IP; no session header on a nav) | `maxDuration = 10` | `r` ∈ 1..5, `k` parsed with fallback `"email"` | HTML 200 / 400 / 429 | Fail-soft: a DB error still renders 200 "Danke". GET with a side effect — mail-client link prefetchers / SafeLinks scanners can create phantom ratings; the only abuse cap is 5/5min per IP. Referenced only from `src/lib/email-theme.mjs` (link builder). |

## 2. Customer account routes (`/api/account/*`, tier-3 signed-in customers)

All use `requireSignedInCustomer` (`src/lib/account-guard.ts`) which itself performs guardRequest + `chat` rate limit + signed-in resolution + live-token check. Session id from `?session=` or `x-ms-session` (`readSession`). Caller: external widget (signed-in history panel; documented in `docs/CUSTOMER_ACCOUNT.md`, `docs/frontend-handoff/CUSTOMER_ACCOUNT.md`).

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET /api/account/conversations` (`src/app/api/account/conversations/route.ts`) | GET, OPTIONS | `listCustomerConversations(customerId)` — titles, timestamps, counts across devices. | widget | requireSignedInCustomer | `chat` (inside guard) | `runtime="nodejs"`, `maxDuration = 15` | none needed | `{conversations:[...]}` 200 `no-store`; 401; 500 | — |
| `GET/PATCH/DELETE /api/account/conversations/[id]` (`src/app/api/account/conversations/[id]/route.ts`) | GET, PATCH, DELETE, OPTIONS | GET `getCustomerConversationTranscript`; PATCH rename via `sanitizeTitleInput` + `renameCustomerConversation`; DELETE hard-deletes via `deleteCustomerConversation`. All scoped to `customerId` (foreign id ≡ missing). | widget | requireSignedInCustomer (per method) | `chat` | `runtime="nodejs"`, `maxDuration = 15` | `parseId` (positive safe int, else 400); PATCH body JSON + `sanitizeTitleInput` | GET `{conversation}`; PATCH `{ok, conversationId, title}`; DELETE `{ok, conversationId, deleted:true}`; 404s | 404 responses use error code **`bad_request`** (lines 67, 105, 126) although `not_found` exists in `ErrorCode` — envelope inconsistency. |
| `POST /api/account/erase` (`src/app/api/account/erase/route.ts`) | POST, OPTIONS | Full GDPR erasure `eraseSignedInCustomer(customerId)` (conversations, profile, tokens, suppression), KPI `ACCOUNT_ERASED` (no session key). | widget | requireSignedInCustomer | `chat` | `runtime="nodejs"`, `maxDuration = 20` | no body read at all | `{ok:true, erased:true, deletedConversations}` 200; 503 `upstream_unavailable`; 500 | Destructive POST with no confirmation token/body; acceptable because the custom `x-ms-chat-key` header forces a CORS preflight (no cross-site form risk). |
| `GET /api/account/export` (`src/app/api/account/export/route.ts`) | GET, OPTIONS | `buildCustomerDataExport(customerId)` → pretty JSON attachment (`motionsports-meine-daten.json` / `-my-data.json`); KPI `ACCOUNT_EXPORT_REQUESTED`. | widget | requireSignedInCustomer | `chat` | `runtime="nodejs"`, `maxDuration = 30` | none | `application/json; charset=utf-8` attachment 200; 503; 500 | — |
| `POST /api/account/marketing-opt-in` (`src/app/api/account/marketing-opt-in/route.ts`) | POST, OPTIONS | At-sign-in marketing DOI: `getCustomerById` → verified email (refuses synthetic `shopify:` placeholder) → `upsertEmailCapture(transactional:false, marketing:true)` → `linkCustomerOnEmailCapture` → KPI ×2 → DOI email (duplicated block). | widget (sign-in opt-in card, copy from `/api/consent-copy?surface=signin`) | requireSignedInCustomer | `chat` | `maxDuration = 30` (no `runtime` export — the only `/api/account` route without it) | JSON body; `marketingConsent === true` required | `{ok, marketing:{status, doiEmailSent, alreadyConfirmed}}`; 400 `marketing_consent_required`; 404 `not_found`; 422 `no_verified_email`; 503 | Third copy of the DOI send block. Unlike the other two opt-in routes it does NOT apply the `capture-recipient` per-email cap (the signed-in guard makes that acceptable, but note the asymmetry). |
| `GET /api/account/summary?conversationKey=` (`src/app/api/account/summary/route.ts`) | GET, OPTIONS | `loadCustomerConversationForSummary(customerId, key)` → `buildSummaryDocument` (may call the model; usage recorded as `summary_download`) → `buildSummaryPdf` → PDF attachment. | widget ("Zusammenfassung herunterladen") | requireSignedInCustomer | `chat` | `runtime="nodejs"`, `maxDuration = 30` | `conversationKey` non-empty | `application/pdf` attachment 200; 400; 404 (code `bad_request`); 500 | 404 again uses `bad_request` code. |

## 3. Auth / Shopify Customer Account routes

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET /api/auth/me` (`src/app/api/auth/me/route.ts`) | GET, OPTIONS | Widget identity re-hydration: `resolveSignedInCustomer(session)` → `getValidAccessToken` → `fetchCustomerIdentity` (revoked token → `deleteCustomerTokens` + signed-out) → fallback name via `fetchAdminCustomerById` → `resolveMarketingOptInState`. | widget (on load / after `?ms_auth=` redirect) | guardRequest | `chat` | `runtime="nodejs"`, `maxDuration = 15` | `?session=` or `x-ms-session` | always **200**: `{signedIn:false}` or `{signedIn:true, identity:{name,tier}, marketing}`, `Cache-Control: no-store` | Internal errors are converted to `{signedIn:false}` 200 (line 105-108) — never a 5xx; fail-closed by design but hides outages from the widget. |
| `GET /api/auth/shopify/login` (`src/app/api/auth/shopify/login/route.ts`) | GET | Step 1 of PKCE Customer Account OAuth: `safeReturnUrl` (allowlist), `generateCodeVerifier`, `randomToken` nonce/state, `signState(state, authStateSecret())`, `createPendingAuth` (DB, TTL `pendingAuthTtlMinutes()`), `buildAuthorizationUrl` → 302 to Shopify; `prompt=none` for silent detection. | widget (top-level navigation) | none (open-redirect guard on `return_url` + HMAC-signed `state`) | **none** | `runtime="nodejs"`, `maxDuration = 15` | `session` non-empty (400 text), `return_url` allowlisted | 302; 503/400 **text/plain** bodies (not the JSON envelope); catch → 302 to `returnUrl` | No rate limit: each hit inserts a pending-auth row (DB-fill vector). Error bodies are plain text, unlike every other route. |
| `GET /api/auth/shopify/callback` (`src/app/api/auth/shopify/callback/route.ts`) | GET | Step 2: `verifyState` → `consumePendingAuth` (single-use) → `exchangeAuthorizationCode` (PKCE) → `verifyIdToken` (JWKS, iss/aud/nonce/exp) → `fetchCustomerIdentity` → `bindShopifyIdentity` → `saveCustomerTokens` (AES-256-GCM at rest, `lib/token-crypto.ts`) → KPI `ACCOUNT_SIGNIN_SUCCEEDED` → `refreshSignedInCustomerCache` → 302 `?ms_auth=ok`. | Shopify redirect (top-level) | signed `state` + pending record | none | `runtime="nodejs"`, `maxDuration = 30` | `state` HMAC, `code` presence, `error` passthrough (`login_required`) | 302 to storefront with `?ms_auth=ok\|error\|login_required` | `refreshSignedInCustomerCache` (line 139) is awaited inside the same try — a throw there redirects with `ms_auth=error` even though tokens were already saved, contradicting the "never block the redirect" comment (unless the lib swallows internally). Tokens never reach the browser. |
| `GET /api/auth/shopify/logout` (`src/app/api/auth/shopify/logout/route.ts`) | GET | `buildEndSessionUrl({post_logout_redirect_uri: /api/auth/shopify/logout/return?session&return_url})` → 302 to Shopify `end_session_endpoint`, or straight to the return route when not advertised. | widget (top-level navigation) | none (return_url allowlist) | none | `runtime="nodejs"`, `maxDuration = 15` | `return_url` allowlisted | 302 | — |
| `GET /api/auth/shopify/logout/return` (`src/app/api/auth/shopify/logout/return/route.ts`) | GET | Registered Logout URI: `resolveSignedInCustomer(session)` → `deleteCustomerTokens(customerId)`; 302 `?ms_auth=logged_out`. | Shopify redirect (or direct from logout route) | none | none | `runtime="nodejs"`, `maxDuration = 15` | `return_url` allowlisted | 302 | Anyone who knows an opaque widget session id can revoke that session's tokens (low impact: forces re-login). |
| `GET /api/auth/storefront` (`src/app/api/auth/storefront/route.ts`) | GET | Shop-native signed-in detection via Shopify **App Proxy**: `evaluateAppProxyAuth(searchParams, SHOPIFY_APP_PROXY_SECRET ?? SHOPIFY_CLIENT_SECRET)` (HMAC over query params; trusts `logged_in_customer_id`) → `fetchAdminCustomerById` → `bindShopifyIdentity` (links widget session) → `resolveMarketingOptInState`. | Shopify App Proxy (server-to-server; theme calls `/apps/chat/whoami?session=`) | Shopify App Proxy HMAC `signature` (see "Webhook verification" — app-proxy note) | `chat` keyed on a synthetic `x-ms-session` = widget session or `cid:<shopifyCustomerId>` | `runtime="nodejs"`, `maxDuration = 15` | signature + `logged_in_customer_id` | always 200: `{signedIn:false}` or `{signedIn:true, name, tier:3, shopify_customer_id, identity:{name,tier:3}, marketing}` | No CORS headers (same-origin through the proxy). Depends on store-side App Proxy configuration per header comment ("REQUIRES A STORE / THEME ACTION") — may be dormant in production. |

## 4. Attribution

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/attribution/token` (`src/app/api/attribution/token/route.ts`) | POST, OPTIONS | Mints or reuses the session's cart-stamp attribution token: `mintAttributionToken(sessionId, "widget")` (`lib/mo-orders-store`), returns the Shopify cart attribute to POST to `/cart/update.js`. | widget (once per session, after analytics consent — consent gate lives in the widget) | guardRequest | `kpi` | `maxDuration = 10` | `x-ms-session` header required (400), sliced to 128; `isDbConfigured()` else 503 | `{ok:true, token, cartAttributes:{[MO_CART_ATTRIBUTE]: token}}` 200 `no-store`; 400; 503; 500 | No body is read. Token format/verification in "Token-based links". |

## 5. Cron routes (`/api/cron/*`, scheduled in `vercel.json`)

All five accept **GET and POST** (same `handle()`), all call `requireCronAuth(req)` first (`Authorization: Bearer <CRON_SECRET>`, constant-time, fails closed when `CRON_SECRET` unset), none rate-limit, none read a body, all use `NextResponse.json` with an ad-hoc `{ok, ...}` envelope (NOT the `{error:{code,message}}` envelope used elsewhere; the 401 is `{error:"Unauthorized"}`). Schedules (UTC): refresh-customers 02:00, sync-campaign-audience 02:30, sync-catalog 03:00, retention 03:30, expire-bundles 03:45.

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET/POST /api/cron/expire-bundles` (`src/app/api/cron/expire-bundles/route.ts`) | GET, POST | `expireBundleOffers()` (`lib/bundle-offers`): archives Shopify bundle products past `expires_at`, flips rows to `expired`. | Vercel Cron (03:45 UTC); manual curl | requireCronAuth | none | `maxDuration = 60` | none | `{ok:true, ...result}` 200; `{ok:false,error}` 503 (no DB or thrown) | Returns 503 on thrown errors (other routes use 500) — cron routes uniformly use 503 for "visibly skipped". |
| `GET/POST /api/cron/refresh-customers` (`src/app/api/cron/refresh-customers/route.ts`) | GET, POST | `listCustomersForDataRefresh(batch, staleBefore)` → sequential `refreshCustomerData(c)` (Shopify orders + address cache). Env `CUSTOMER_REFRESH_BATCH` (25), `CUSTOMER_REFRESH_STALE_HOURS` (24). | Vercel Cron (02:00 UTC) | requireCronAuth | none | `maxDuration = 300` | env ints via `intEnv` | `{ok:true, considered, refreshed, failed, batch, staleHours}`; 503 on throw | No `isDbConfigured` pre-check unlike expire-bundles. |
| `GET/POST /api/cron/retention` (`src/app/api/cron/retention/route.ts`) | GET, POST | `runRetention(retentionOptionsFromEnv())` (abandon stale conversations, delete expired conversations/messages/kpi_events, purge opted-out capture PII) then `runConversionSweep()` (marks redeemed MS5- codes / converted conversations). | Vercel Cron (03:30 UTC) | requireCronAuth | none | `maxDuration = 60` | env via `retentionOptionsFromEnv` | `{ok:true, options, ...result, conversionSweep}`; 503 on throw | Two unrelated jobs piggybacked on one cron (documented). |
| `GET/POST /api/cron/sync-campaign-audience` (`src/app/api/cron/sync-campaign-audience/route.ts`) | GET, POST | `syncCampaignAudience()` (`lib/campaign-sync`) — re-pulls the Shopify marketing audience, marks Shopify-side unsubscribes `suppressed`. | Vercel Cron (02:30 UTC) | requireCronAuth | none | `maxDuration = 300` | none | `result` JSON 200; `{ok:false,error}` 503 when not configured or thrown | Same lib is used by admin `POST /api/admin/campaign/sync` (see §7.3) — intended duplication (manual vs scheduled). |
| `GET/POST /api/cron/sync-catalog` (`src/app/api/cron/sync-catalog/route.ts`) | GET, POST | Full catalog refresh: `fetchAllProducts()` (Shopify Admin) → `mapShopifyProducts` (fallback to bundled `@/data/product-catalog.json` on Shopify failure) → `embedDocsResilient` with OpenAI `text-embedding-3-small` (carry-forward of previous vectors) → atomic `writeCatalogPair` to Vercel Blob. | Vercel Cron (03:00 UTC); README manual curl | requireCronAuth | none | `maxDuration = 300` | none | rich summary `{ok:true, partial, mode, productCount, embeddingsCount, synced, carriedForward, skipped, ...}` 200; 503 on total embedding failure (quota) or Blob write failure | Silent degradation: a Shopify failure returns **200** with `mode:"fallback-bundle"` (line 191-196) — the stale committed JSON overwrites the live catalog blob. OpenAI key missing → 200 with catalog-only write. |

## 6. Inbound / webhooks

Verification details are in the "Webhook verification" section. All four use `NextResponse.json` ad-hoc envelopes, none rate-limit (signature is the gate), all read the raw body via `req.text()` before verifying.

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/inbound/resend` (`src/app/api/inbound/resend/route.ts`) | POST | Resend Inbound (`email.received`): verify Svix signature → `resend.emails.receiving.get(email_id)` (full body; degrades to webhook metadata on failure) → `normalizeInboundMessage` → `getCustomerByEmail(from)` → `insertReceivedMessage` (dedup on Message-ID). Non-`email.received` events are forwarded to `applyResendDeliveryEvent`. | Resend webhook | Svix signature, secret `inboundWebhookSecret()` (`RESEND_WEBHOOK_SECRET`) | none | `maxDuration = 30` | signature; `email_id` required (400) | `{ok:true, stored, duplicate, matched}`; `{ok:true, ignored}`; `{ok:true, ...deliveryOutcome}`; 400 invalid signature / missing id; 500 store/ingest failure (Resend retries); 503 unconfigured | **Overlaps with `/api/webhooks/resend`**: both apply delivery events (`applyResendDeliveryEvent`). The second-level `try` only wraps the ingest; a throw in `applyResendDeliveryEvent` is caught via `.catch` → still 200. |
| `POST /api/webhooks/resend` (`src/app/api/webhooks/resend/route.ts`) | POST | Resend delivery events (`email.bounced`/`complained`/`delivered`/`delivery_delayed`) → `applyResendDeliveryEvent` (suppression + campaign send stamping). | Resend webhook | Svix signature; tries `RESEND_EVENTS_WEBHOOK_SECRET` then `RESEND_WEBHOOK_SECRET` (first that verifies wins) | none | `maxDuration = 15` | signature only | `{ok:true, ...outcome}`; `{ok:true, ignored:type}`; **`{ok:true, applied:false}` 200 on apply failure** (deliberately acknowledges); 400; 503 | Path is NOT referenced by any `src/` or `scripts/` code — only `docs/` (2 hits); it is configured externally in Resend. Overlap with inbound route (see §"Duplicated"). |
| `POST /api/webhooks/pingen` (`src/app/api/webhooks/pingen/route.ts`) | POST | Pingen letter status webhook: verify standard-webhooks signature (multi-secret) → `interpretWebhookEvent` → `updatePhysicalLetterStatusByProviderId(providerLetterId, status, costCents)`. | Pingen webhook | standard-webhooks HMAC, `PINGEN_WEBHOOK_SECRET` (comma/space list) | none | `maxDuration = 30` | signature; shapeless event → `{ok:true, ignored:true}` | `{ok:true, updated, status}`; 400; 500 (Pingen retries); 503 | Not referenced anywhere in `src/`/`scripts/`/`docs/` except the lib's own comment — configured in the Pingen dashboard. |
| `POST /api/webhooks/shopify` (`src/app/api/webhooks/shopify/route.ts`) | POST | Shopify webhooks: verify `X-Shopify-Hmac-SHA256` → by `X-Shopify-Topic`: `orders/create`/`orders/paid` → `ingestShopifyOrder` (attribution, pseudonymous); `products/*`, `inventory_levels/*` → `planCatalogAction` → throttle-gate (`isThrottleGateActive` → `enqueuePendingRefresh` + ack) or `refreshProductInCatalog`/`refreshInventoryItemInCatalog`, then `drainPendingRefreshes`. | Shopify webhook | Shopify HMAC, `SHOPIFY_WEBHOOK_SECRET` | none | `maxDuration = 60` | signature; topic routing | `{ok:true, topic, action, productId, reembedded, drain?}`; `{ok:true, deferred:true}`; `{ok:true, ignored}`; **401** on bad signature (Resend/Pingen use 400); 500; 503 + `Retry-After: 30` when throttled without Redis | Inconsistent bad-signature status (401 vs 400 in the other two webhooks). No `X-Shopify-Shop-Domain` / `X-Shopify-Webhook-Id` check (see gaps). |

## 7. Email-link routes (top-level navigations / anonymous image fetches from mail clients)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET /api/unsubscribe?token=` (`src/app/api/unsubscribe/route.ts`) | GET | `verifyUnsubscribeToken(token)` → email → `unsubscribeByEmail(email, "unsubscribe")` (unsubscribed_at + suppression + DOI revoked) → `markCampaignUnsubscribed(email)` (attribute to last 30 days' campaign sends) → `syncCustomerConsent(email)`; renders HTML result page. | email link (every marketing/campaign/bundle mail: `lib/email.ts:40`, `campaign-email.ts:199/534`, `marketing-email.ts:186/501`, `email-design-preview.ts:30`; `scripts/send-test-emails.mjs:59`) | HMAC token in URL (`b64url(email).b64url(HMAC)`, no expiry — see "Token-based links") | none | `maxDuration = 10` | token verify | HTML 200 / 400 / 503 (verified but not persisted) / 500 | GET with side effect (one-click unsubscribe is required by RFC 8058 anyway). No List-Unsubscribe POST variant. |
| `GET /api/r/[token]` (`src/app/api/r/[token]/route.ts`) | GET | Tracked redirect: tries `recordEmailClick(token)` (marketing send → prefilled cart w/ discount) → `recordCampaignClick(token)` (→ `campaignMoDeeplinkUrl()` + `?mo_c=token`) → `resolveBundleRedirect(token)` (active → cart permalink; else branded 410 "Angebot abgelaufen" page). Falls back to `${SHOP_DOMAIN}/cart`. | email link (marketing/campaign/bundle CTAs); admin `CustomerProfileCard.tsx:150` displays the URL | opaque random redirect token (DB lookup, see "Token-based links") | none | `maxDuration = 10` | none beyond lookups | 302; 410 HTML for expired bundle; **never 4xx/5xx to the customer** — unresolved → 302 to cart | Three sequential DB lookups per click. Any thrown error is swallowed → 302 to `/cart` (observability via `reportError`). Click = single GET, so link scanners inflate `clicked_at`. |
| `GET /api/email-countdown/[token]?w=m` (`src/app/api/email-countdown/[token]/route.ts`) | GET | Live countdown PNG for offer emails: `verifyCountdownToken(token, countdownSecret())` → `renderCountdownImage({expiresAt, language, width})`. | mail-client image fetch (URL built in `lib/email-template.ts:369`) | HMAC-signed token carrying deadline + language only (no recipient) | none | `maxDuration = 10`, **`dynamic = "force-dynamic"`** (only route exporting `dynamic`) | token verify; `?w=m` flag | `image/png` 200 `no-store`; `text/plain` 404 for bad token or render failure | Render failure (`catch`) also masquerades as 404 (line 52-55). Public CPU cost per open, unthrottled — bounded only by the token's validity. |
| `GET /api/email-hero-image/[file]` (`src/app/api/email-hero-image/[file]/route.ts`) | GET | Streams a generated hero image from the private Vercel Blob store: `parseHeroBlobFile(file)` (rejects separators/traversal/non-image) → `get(heroBlobPathname(safeFile), {access:"private", token: BLOB_READ_WRITE_TOKEN})`. | mail-client image fetch (URL built in `lib/email-hero-blob.mjs:100`); admin preview iframes | none (public by necessity; filename carries a random suffix) | none | `maxDuration = 15` | `parseHeroBlobFile` whitelist | image stream 200 `public, max-age=31536000, immutable`; `text/plain` 404 | Not enumerable without knowing the random suffix, but no auth — any generated hero image is publicly fetchable if the URL leaks. |

## 8. Admin routes (`/api/admin/*`, German back-office dashboard)

Common facts for all 76 admin routes (verified by grep over every `src/app/api/admin/**/route.ts`):

- **Every** admin route calls an in-handler guard in addition to the proxy: 8 GET routes use `guardAdminGet()`, the other 68 (all POST) use `guardAdminPost(req)` (415 unless `Content-Type: application/json`; 401 on a bad/missing `ms_admin_session` cookie). No admin route relies on the proxy alone.
- No rate limiting anywhere under `/api/admin` (single-operator back office, cookie-gated).
- Envelope: `adminJson(data)` / `adminJsonError(code, message, status)` → `{error:{code,message}}` (`src/lib/admin-api.ts`). Domain refusal codes are passed through verbatim (e.g. `not_eligible`, `too_soon`), so the admin code vocabulary is open-ended and mostly in German.
- Caller is always the admin UI (client components under `src/app/admin/`), listed per row with `file:line` of the `fetch`. Reads that need a body are POSTs "to ride the JSON/CSRF guard" (comment in `conversations/detail`).
- Input validation is manual everywhere (`Number()` + `Number.isInteger` + `typeof` checks). **No zod anywhere in the API layer.**
- Audit logging: 27 routes call `recordAdminAccess` (`src/lib/admin-access-log.ts`); noted per row where an AI/PII-reading route does NOT.
- Two routes have **no `maxDuration`** export: `conversations/detail`, `correspondence/assign`. One exports `runtime="nodejs"`: `analytics/[id]/pdf`.
- **No try/catch at all** (a thrown DB error surfaces as a framework 500, not the JSON envelope): `email-designs/route.ts` (GET), `email-hero/route.ts` (GET), `analytics/estimate`, and every `qa/*` route except `qa/scan` (which only guards its inner loop).

### 8.1 analytics ("Komplettanalyse" reports)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET /api/admin/analytics` | GET | `listAnalyticsReports()` (no `sections` payload). | `analytics/AnalyseWorkspace.tsx:59` | proxy + guardAdminGet | none | `maxDuration = 15` | — | `{reports}`; `{reports:[]}` when no DB | — |
| `POST /api/admin/analytics/create` | POST | `resolveKpiRange` + `normalizeOptions` → `createAnalyticsReport` (row in `running` state; client drives via `/step`); `countUnanalyzedInRange` seeds progress. | `analytics/GenerateReportPanel.tsx:101` | proxy + guardAdminPost | none | `maxDuration = 30` | manual (`range`/`from`/`to` strings, booleans) | `{id, title, from, to}`; 400; 503 `unavailable`; 500 | `recordAdminAccess("analytics.report.create")`. |
| `POST /api/admin/analytics/delete` | POST | `deleteAnalyticsReport(id)`. | `analytics/ReportActions.tsx:37` | proxy + guardAdminPost | none | `maxDuration = 30` | `id` positive int | `{deleted:true}`; 404 `not_found`; 503 | audit-logged. |
| `POST /api/admin/analytics/estimate` | POST | Zero-token cost preview: `countConversationsInRange`, `countUnanalyzedInRange`, `getPersonaLabelsInRange`, `getActiveCustomerIdsInRange` → `estimateReportCostUsd` → EUR. | `analytics/GenerateReportPanel.tsx:78` | proxy + guardAdminPost | none | `maxDuration = 30` | manual | `{range:{from,to,label,preset}, conversations, unanalyzed, personaCount, customerCount, estimateEur}` | **No try/catch** around the DB work (lines 53-79) — a DB error yields a framework 500 instead of the envelope. |
| `POST /api/admin/analytics/step` | POST | `stepReport(id)` — one bounded chunk of the generation state machine (model calls). | `analytics/ReportProgressDriver.tsx:78` | proxy + guardAdminPost | none | `maxDuration = 60` | `id` | `{status, phase, progress, costEur, done, error}`; 404 | Not audit-logged (create is). |
| `GET /api/admin/analytics/[id]` | GET | `getAnalyticsReport(id)` full detail incl. `sections`. | `analytics/AnalyseWorkspace.tsx:71` | proxy + guardAdminGet | none | `maxDuration = 15` | path id positive int | `{report}`; 400; 404; 503 | — |
| `GET /api/admin/analytics/[id]/pdf` | GET | `buildAnalyticsReportPdf` (dependency-free `lib/pdf-core`) → PDF attachment; only `status === "complete"`. | `analytics/ReportActions.tsx:65` (plain `<a href>` download) | proxy + guardAdminGet | none | `runtime="nodejs"`, `maxDuration = 30` | path id | `application/pdf` attachment; 409 `not_ready`; 404; 503 | — |

### 8.2 bundles (personalised bundle offers, Shopify product bundles)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/admin/bundles/archive` | POST | `archiveBundleOffer(id)` — archives the Shopify product, row → `expired`. | `CustomerProfileCard.tsx:1273`, `KampagneWorkspace.tsx:714` | proxy + guardAdminPost | none | `maxDuration = 30` | `id` | `{ok, offer}`; `not_found` 404 / `not_active` 409 / `archive_failed` 502 | Not audit-logged. |
| `POST /api/admin/bundles/create` | POST | `createBundleOffer(customerId\|null, components[{productId, variantId?, quantity?}], {bundlePriceOverride, title, expiryDays, marketingSendId, campaignContactId})` — Shopify bundle creation + row + redirect token. | `CustomerProfileCard.tsx:1197`, `KampagneWorkspace.tsx:664,1659` | proxy + guardAdminPost | none | `maxDuration = 60` | manual: ids positive ints, `components` non-empty, `expiryDays` > 0; `bundlePriceOverride` passed through unvalidated (`number\|string`), `title` unbounded | `{ok, offer, redirectUrl}`; refusal envelope `{error:{code,message}, offenders?, offer?}` with `STATUS_BY_REASON` (`sold_out` 409, `no_variant` 422, `variant_not_found` 409, `create_failed` 502, `not_configured`/`no_db` 503, ...) | Refusal responses are built with `adminJson(...)` rather than `adminJsonError` to carry `offenders` — same envelope shape, different helper. |
| `POST /api/admin/bundles/delete` | POST | `deleteDraftBundleOffer(id)` — only `pending`/`failed` rows. | `CustomerProfileCard.tsx:1292` | proxy + guardAdminPost | none | `maxDuration = 30` | `id` | `{ok, offer}`; 404 / `not_deletable` 409 / `delete_failed` 502 | — |
| `POST /api/admin/bundles/list` | POST | `listBundleOffersForCustomer(customerId)`. | **none in `src/`** — only `docs/BUNDLES.md:198`; `src/app/admin/page.tsx` loads offers server-side via `listBundleOffersWithSignalsForCustomer` | proxy + guardAdminPost | none | `maxDuration = 15` | `customerId` | `{offers}` | **Dead-route candidate** (see §12). |
| `POST /api/admin/bundles/suggest` | POST | AI bundle proposal: `getCustomerById`, `loadCustomerSessions` (all transcripts), `loadProductCatalog` → `suggestBundle` (Anthropic, usage recorded as `bundle_suggestions`). | `CustomerProfileCard.tsx:1138` | proxy + guardAdminPost | none | `maxDuration = 60` | `customerId` | `{title, components, componentsSum}`; `no_candidates` 409 / `empty` 422 / `ai_unavailable` 503; 404 | Reads all customer transcripts + spends tokens but has **no `recordAdminAccess`** (unlike `customers/profile`). |

### 8.3 campaign (Shopify-audience campaign review queue)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/admin/campaign/contacts` | POST | `searchCampaignContacts(query)` — substring search over all contacts. | `KampagneWorkspace.tsx:1840` | proxy + guardAdminPost | none | `maxDuration = 10` | `query` non-empty (unbounded length) | `{contacts:[{id,email,firstName,lastName,status,optInLevel,language,hasDraft}]}` | — |
| `POST /api/admin/campaign/discount` | POST | `updateCampaignDraftDiscount(contactId, percent, expiresAt)` + advisory `detectDiscountTextMismatch`. | `KampagneWorkspace.tsx:902` | proxy + guardAdminPost | none | `maxDuration = 10` | `contactId`; `parseDiscountPercent` (0..`DISCOUNT_PERCENT_MAX`) | `{ok, discountPercent, discountExpiresAt, proseMismatch, prosePercents}`; 404; `not_editable` 409 | — |
| `POST /api/admin/campaign/draft` | POST | Single-contact (re)generation: `prepareDraftForContact(contact, percent, {refreshRecommendations, purchaseSelection, textMode})` (AI); reuse rule `shouldReuseCampaignDraft`; `isSuppressed` re-check. | `KampagneWorkspace.tsx:463,497,613` | proxy + guardAdminPost | none | `maxDuration = 60` | manual incl. `purchaseSelection` array ≤100, `textMode` enum | `{draft, recommendations[], bundle\|null, reused?\|regenerated?}`; 404; `already_sent`/`not_eligible` 409 | Not audit-logged. |
| `POST /api/admin/campaign/email-preview` | POST | `renderCampaignEmailPreview(contactId, {subject, body})` → full branded HTML (read-only). | `KampagneWorkspace.tsx:529` | proxy + guardAdminPost | none | `maxDuration = 15` | `contactId`; subject/body optional strings | `text/html` 200 `no-store`; **every** non-ok reason → 404 | One of four email-preview routes (see §13). |
| `POST /api/admin/campaign/language` | POST | `setContactLanguageOverride(contactId, "de"\|"en"\|null)` (normalised to null when equal to derived). | `KampagneWorkspace.tsx:764` | proxy + guardAdminPost | none | `maxDuration = 10` | enum | `{ok, language, derivedLanguage, languageOverride}`; 404; `already_sent` 409 | — |
| `POST /api/admin/campaign/mark-done` | POST | Copy-workflow completion: `markContactSent` then `recordCampaignSend({sentVia:"copy", bodyHash, bodyText...})`. | `KampagneWorkspace.tsx:575` | proxy + guardAdminPost | none | `maxDuration = 10` | `contactId` | `{ok}`; 404; `not_markable` 409 | Deliberately bypasses `CAMPAIGN_SENDS_APPROVED`. Status is flipped **before** the audit row is written (line 55 vs 62): if `recordCampaignSend` throws, the contact is `sent` with no `campaign_sends` record and the client sees 500. |
| `POST /api/admin/campaign/prepare` | POST | Batch pre-generation `prepareNextDrafts(count ≤50, percent, textMode)` (AI per contact). | `KampagneWorkspace.tsx:1008` | proxy + guardAdminPost | none | `maxDuration = 300` | `count` 1..50, percent, `textMode` enum | `prepareNextDrafts` result | Token-spending, not audit-logged. |
| `POST /api/admin/campaign/recommendations` | POST | `resolveProductSelections` validation (unknown / vanished variant / sold-out → structured refusals) → `updateCampaignDraftRecommendations`; attached bundle rebuilt via `archiveBundleOffer` + `createBundleOffer`. | `KampagneWorkspace.tsx:826` | proxy + guardAdminPost | none | `maxDuration = 60` | `productIds` array 1..5 | `{ok, recommendations[], bundle\|null, bundleError}`; envelopes with `offenders` 400/409 | Archive-then-create is not atomic: an archive success followed by create failure leaves the contact without a bundle (surfaced only as `bundleError`, HTTP 200). |
| `POST /api/admin/campaign/reset-queue` | POST | `resetDraftedContacts()` — deletes all open drafts, contacts back to `pending`. | `KampagneWorkspace.tsx:979` | proxy + guardAdminPost | none | `maxDuration = 30` | body ignored (JSON content-type still required by the guard) | `{ok, reset}` | Destructive bulk action, **not audit-logged**. |
| `POST /api/admin/campaign/send` | POST | `approveAndSendCampaign(contactId)` (`lib/campaign-email`: master flag, opt-in gate, suppression, frequency cap, unsubscribe link, MK- code, immutable `campaign_sends`). | `KampagneWorkspace.tsx:386,406` | proxy + guardAdminPost | none | `maxDuration = 30` | `contactId` | `{ok, sentTo}`; `STATUS_BY_REASON`: `sends_not_approved`/`opt_in_blocked` 403, `too_soon` 429, `no_unsubscribe`/`email_not_configured` 503, `discount_failed`/`send_failed` 502, others 409/404 | Not audit-logged at the route (the lib writes `campaign_sends`). |
| `POST /api/admin/campaign/sent-email` | POST | `getCampaignSendContent(sendId)` → retained HTML, or `textAsHtml` wrapper for copy-path records. | `KampagneWorkspace.tsx:543` | proxy + guardAdminPost | none | `maxDuration = 10` | `sendId` | `text/html` 200; 404 `not_found` / `no_content` | POST returning HTML for a pure read. |
| `POST /api/admin/campaign/skip` | POST | `markContactSkipped(contactId)`. | `KampagneWorkspace.tsx:424` | proxy + guardAdminPost | none | `maxDuration = 10` | `contactId` | `{ok}`; `not_skippable` 409 | — |
| `POST /api/admin/campaign/sync` | POST | `syncCampaignAudience()` — same lib as the cron. | `KampagneWorkspace.tsx:947` | proxy + guardAdminPost | none | `maxDuration = 300` | none | sync result; 503 with the lib's reason code | Manual twin of `GET/POST /api/cron/sync-campaign-audience`. |
| `POST /api/admin/campaign/unskip` | POST | `unskipContact(contactId)` → back to `drafted` or `pending`. | `KampagneWorkspace.tsx:458` | proxy + guardAdminPost | none | `maxDuration = 10` | `contactId` | `{ok, status}`; `not_skipped` 409 | — |
| `POST /api/admin/campaign/update` | POST | `updateCampaignDraftText(contactId, subject, body)` while `drafted`. | `KampagneWorkspace.tsx:348` | proxy + guardAdminPost | none | `maxDuration = 10` | non-empty subject/body — **no length caps** | `{ok}`; `not_editable` 409 | Sibling `marketing/update` caps subject 300 / body 20 000; this one does not. |

### 8.4 catalog

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/admin/catalog/search` | POST | `loadProductCatalog()` + `searchCatalogByName(catalog, query, MAX_SEARCH_RESULTS)` → picker shape incl. variants. | `admin/ui/product-picker.tsx:86` (bundle composer, campaign recommendations, Wissen "Produkt verlinken") | proxy + guardAdminPost | none | `maxDuration = 15` | `query` non-empty | `{products:[{productId, title, imageUrl, unitPrice, currency, inStock, url, priceMin, priceMax, variants[]}]}` | Read-only POST. |

### 8.5 conversations (Gespräche inspector)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/admin/conversations/analyze-bulk` | POST | Loop over `loadUnanalyzedIds(from, to, BULK_ANALYZE_LIMIT)`: `generateConversationAnalysis` (Haiku) + `saveConversationAnalysis`; stops on `unconfigured`. | `GespraecheInsights.tsx:169` | proxy + guardAdminPost | none | `maxDuration = 60` | `from`/`to` `YYYY-MM-DD`, `from <= to`, `confirm === true` (400 `not_confirmed`) | `{processed, failed, remaining, unconfigured, approxCostUsd, costEur, model}`; 503 | audit-logged. |
| `POST /api/admin/conversations/analyze` | POST | Cached-or-generate single analysis (`shouldRegenerate`), `saveConversationAnalysis`. | `GespraecheWorkspace.tsx:688` | proxy + guardAdminPost | none | `maxDuration = 30` | `conversationId`, `force` | `{analysis, usage, cached, warning?}`; `analysis_<reason>` 503/409/502; 404 | audit-logged only when generating. |
| `POST /api/admin/conversations/detail` | POST | `getAdminConversationDetail(id)` — transcript + signals + cached analysis (pure read). | `GespraecheWorkspace.tsx:655` | proxy + guardAdminPost | none | **no `maxDuration`** (default) | `conversationId` | `{detail}`; 404; 503 | audit-logged (`conversation.view`). |
| `POST /api/admin/conversations/insights` | POST | `getCachedInsights(from,to)` or `generateConversationInsights` (two model passes over cached summaries). | `GespraecheInsights.tsx:399` | proxy + guardAdminPost | none | `maxDuration = 300` | dates, `force` | `{insights}` | audit-logged when generating. |

### 8.6 correspondence (Korrespondenz panel / unmatched inbound queue)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/admin/correspondence/assign` | POST | `assignInboundToCustomer(messageId, customerId)` — attach an unmatched inbound mail to a customer, re-thread. | `UnmatchedInboundQueue.tsx:103` | proxy + guardAdminPost | none | **no `maxDuration`** | two positive ints | `{ok, customerId, customerEmail}`; 404; `conflict` 409 | Not audit-logged. |
| `POST /api/admin/correspondence/email-preview` | POST | `renderCorrespondenceEmail(body)` → minimal HTML (no customer lookup). | `KorrespondenzPanel.tsx:424` | proxy + guardAdminPost | none | `maxDuration = 15` | body non-empty, sliced to 20 000 | `text/html` | Third email-preview route (§13). |
| `POST /api/admin/correspondence/message` | POST | `getMessageById(id)`; if no stored body and `providerEmailId`: lazy `resend.emails.receiving.get` + `saveFetchedBody`. | `KorrespondenzPanel.tsx:219` | proxy + guardAdminPost | none | `maxDuration = 30` | `id` | `{bodyText, bodyHtml, attachments}`; 404 | audit-logged (`correspondence.read`). Local `fetchFullMessage` helper (lines 90-105) **duplicates** `fetchFullInboundMessage` in `src/app/api/inbound/resend/route.ts:143-158` byte-for-byte in logic. |
| `POST /api/admin/correspondence/send` | POST | Compose/reply: `getMessageHeaders(parent)` for threading → `sendEmail({kind:"correspondence", messageId, replyTo, inReplyTo, references})` → `recordSentMessage`. | `KorrespondenzPanel.tsx:353` | proxy + guardAdminPost | none | `maxDuration = 30` | `customerId`, body non-empty (sliced 20 000), subject sliced 300, `inReplyToMessageId` int; parent must belong to the customer (400) | `{ok, sentTo, threaded}`; `email_not_configured` 503; `send_failed` 502; 404 | Sends arbitrary operator text; **no suppression check by design** (correspondence ≠ marketing). Not audit-logged. |

### 8.7 customers (Kunden workspace)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/admin/customers/letter-draft` | POST | Dual-mode: `save:true` → `saveCustomerLetterDraft(customerId, subject, body≤20000)`; else AI `generateCustomerLetterDraft` over all sessions + selections + correspondence + purchases, then save. | `PhysicalLetterPanel.tsx:114` | proxy + guardAdminPost | none | `maxDuration = 60` | `customerId`; `adminInstructions` string ≤2000 | `{letterDraft:{subject, body}}`; 404; 500 | Overloaded endpoint (save vs. generate). Reads every transcript + correspondence with **no `recordAdminAccess`** (contrast `customers/profile`). |
| `POST /api/admin/customers/letter-preview` | POST | `physicalEligibilityForCustomer` address (or placeholder) → `buildLetterPdf` → inline PDF. | `PhysicalLetterPanel.tsx:131` | proxy + guardAdminPost | none | `maxDuration = 30` | `customerId`; optional subject/body | `application/pdf` inline; 404 | — |
| `POST /api/admin/customers/marketing-draft` | POST | Full-context per-customer marketing draft: `loadEligibleCaptureByEmail`, `saveCustomerAdminInstructions` (persisted before generation), sessions/selections/correspondence, `getActiveBundleForCustomer`, AI `generateCustomerMarketingDraft`, `createDraft`/`saveRegeneratedDraft`, `linkBundleOfferToSend`. | `CustomerProfileCard.tsx:714`, `KundenWorkspace.tsx:142` (bulk) | proxy + guardAdminPost | none | `maxDuration = 60` | `customerId`, `discountPercent`, `adminInstructions` ≤2000, `textMode` enum | `{send, reused?\|regenerated?}`; `not_eligible` 409; `draft_gone` 409; `draft_persist_failed` **500 whose message embeds the raw DB error text** (line 314-318) | Supersedes `/api/admin/marketing/draft` (header comment: "the full-context upgrade of /api/admin/marketing/draft"). Not audit-logged. |
| `POST /api/admin/customers/profile` | POST | `generateCustomerProfile` (Anthropic) over sessions + purchases + account context + correspondence → `saveCustomerProfileSummary`. | `CustomerProfileCard.tsx:284` | proxy + guardAdminPost | none | `maxDuration = 60` | `customerId` | `{profileSummary, usage, cached, warning?}`; `profile_<reason>` 503/409/502; 404 | audit-logged (`customer.profile.generate`). |
| `POST /api/admin/customers/purchases` | POST | `refreshCustomerData(customer)` (`lib/customer-refresh`, shared with the cron). | `CustomerProfileCard.tsx:261` | proxy + guardAdminPost | none | `maxDuration = 30` | `customerId` | `{purchaseSummary}`; `no_shopify` 503 / `upstream_unavailable` 502 / `store_failed` 500; 404 | — |

### 8.8 directives (team directives injected into Mo's system prompt)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET /api/admin/directives` | GET | `listDirectives()` + limits. | **none in `src/`** — `VerbesserungTab.tsx:28` calls `listDirectives()` server-side; only `docs/IMPROVEMENT_LOOP.md:187` mentions the route | proxy + guardAdminGet | none | `maxDuration = 15` | — | `{directives, limits:{maxActive, maxChars}}` | **Dead-route candidate** (§12). |
| `POST /api/admin/directives/save` | POST | `createDirective({content, source:"operator"})` or `updateDirectiveContent(id, content)`; length + active-count caps enforced in the store. | `verbesserung/DirectivesCard.tsx:76,180` | proxy + guardAdminPost | none | `maxDuration = 15` | `id?` positive int, `content` non-empty | `{directive}`; 400 (`invalid_content`/`too_many_active` mapped to `bad_request`); 404; 503 | audit-logged. |
| `POST /api/admin/directives/toggle` | POST | `setDirectiveActive(id, active)`. | `verbesserung/DirectivesCard.tsx:211` | proxy + guardAdminPost | none | `maxDuration = 15` | `id`, `active` boolean | `{directive}`; 400; 404 | audit-logged. |
| `GET /api/admin/directives/versions?id=` | GET | `listDirectiveVersions(id)`. | `verbesserung/DirectivesCard.tsx:245` | proxy + guardAdminGet | none | `maxDuration = 15` | `id` query int | `{versions}` (`[]` without DB) | — |

### 8.9 email-designs (Einstellungen: design per email type)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET /api/admin/email-designs` | GET | `listEmailDesignMeta()` (code registry) + `listEmailDesignSelections()`. | see §12 — only comments reference it (`EinstellungenTab.tsx:6`, `EmailSettingsWorkspace.tsx:17`) | proxy + guardAdminGet | none | `maxDuration = 15` | — | `{designs, selections}` | **No try/catch**. Dead-route candidate pending the grep in §12. |
| `POST /api/admin/email-designs/assign` | POST | `setEmailDesignSelection(kind, designKey\|null)`. | `EmailSettingsWorkspace.tsx:100` | proxy + guardAdminPost | none | `maxDuration = 15` | `kind` via `parseEmailThemeKind`, `designKey` string\|null | `{ok}`; 404 `unknown_design`; 400 `unsupported_kind`; 503 | audit-logged. |
| `POST /api/admin/email-designs/preview` | POST | `resolveEmailDesignForKind` + `renderEmailDesignPreview(kind, design)` with fake data → HTML. | `EmailSettingsWorkspace.tsx:201,278` | proxy + guardAdminPost | none | `maxDuration = 15` | `kind` enum; `designKey` must be `isKnownEmailDesign` (404) and `designSupportsKind` (400) | `text/html` | Fourth email-preview route (§13). |

### 8.10 email-hero (AI hero image per draft)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET /api/admin/email-hero?kind=&id=` | GET | `getEmailHero(kind, id)` + `defaultHeroImageUrl()` + `isHeroGenerationConfigured()`. | `HeroImagePanel.tsx:59` | proxy + guardAdminGet | none | `maxDuration = 15` | `kind` via `parseEmailHeroKind`, `id` int | `{url, prompt, headline, defaultUrl, generationConfigured}` | **No try/catch**. |
| `POST /api/admin/email-hero/generate` | POST | `generateHeroImage(kind, id, prompt)` (image model + quality check + Vercel Blob upload) then optional `setEmailHeroHeadline`. | `HeroImagePanel.tsx:123` | proxy + guardAdminPost | none | `maxDuration = 300` (longest admin route) | `id` must be a JSON **number** (`typeof === "number"`, unlike every other route which accepts numeric strings via `Number()`); prompt via `normalizeHeroPrompt` ≤ `MAX_HERO_PROMPT_CHARS`; headline ≤ `MAX_HERO_HEADLINE_CHARS` | `{url, review}`; 400 with the generator's message; 503 | audit-logged. |
| `POST /api/admin/email-hero/headline` | POST | `setEmailHeroHeadline(kind, id, headline\|null)`. | `HeroImagePanel.tsx:172` | proxy + guardAdminPost | none | `maxDuration = 15` | as above | `{ok}`; 404 | audit-logged. |
| `POST /api/admin/email-hero/remove` | POST | `setEmailHero(kind, id, null, null)` (blob kept). | `HeroImagePanel.tsx:208` | proxy + guardAdminPost | none | `maxDuration = 15` | `kind`, numeric `id` | `{ok}`; 404 | audit-logged. |
| `POST /api/admin/email-hero/suggest` | POST | `suggestHeroPrompt(kind, id)` — one AI pass. | `HeroImagePanel.tsx:86` | proxy + guardAdminPost | none | `maxDuration = 30` | `kind`, numeric `id` | `{prompt, headline}`; 400 | audit-logged; the only email-hero route without an `isDbConfigured` pre-check. |

### 8.11 improve (Verbesserung: improvement runs + suggestions)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `GET /api/admin/improve` | GET | `listImprovementRuns()`. | `verbesserung/VerbesserungWorkspace.tsx:100` | proxy + guardAdminGet | none | `maxDuration = 15` | — | `{runs}` | — |
| `GET /api/admin/improve/[id]` | GET | `getImprovementRun(id)`. | `verbesserung/VerbesserungWorkspace.tsx:112` | proxy + guardAdminGet | none | `maxDuration = 15` | path id | `{run}`; 400; 404; 503 | — |
| `POST /api/admin/improve/adopt` | POST | `getSuggestion` → `createDirective({content: override ?? directiveText, source:"suggestion", suggestionId})` → `updateSuggestionStatus(implemented, note)`. | `verbesserung/SuggestionCard.tsx:134` | proxy + guardAdminPost | none | `maxDuration = 15` | `suggestionId`; `content` string\|absent | `{directive, suggestion}`; 400; 404 | audit-logged. |
| `POST /api/admin/improve/delete` | POST | `deleteImprovementRun(id)` (suggestions cascade). | `verbesserung/VerbesserungWorkspace.tsx:781` | proxy + guardAdminPost | none | `maxDuration = 15` | `id` | `{ok}`; **500** when `!ok` (no 404 distinction for a missing run) | audit-logged. |
| `POST /api/admin/improve/run` | POST | `startImprovementRun(reportId)` (row only; stepped by `/step`). | `verbesserung/VerbesserungWorkspace.tsx:372` | proxy + guardAdminPost | none | `maxDuration = 30` | `reportId` | `{id}`; 404; 400 `not_complete` | audit-logged. |
| `POST /api/admin/improve/step` | POST | `stepImprovementRun(id)` — exactly one Sonnet call. | `verbesserung/VerbesserungWorkspace.tsx:681` | proxy + guardAdminPost | none | `maxDuration = 300` | `id` | `{status, phase, costEur, done, busy, error}`; 404 | — |
| `POST /api/admin/improve/suggestion` | POST | `updateSuggestionStatus(suggestionId, status ∈ SUGGESTION_STATUSES, note≤500)`. | `verbesserung/SuggestionCard.tsx:97` | proxy + guardAdminPost | none | `maxDuration = 15` | enum check | `{suggestion}`; 404 | audit-logged. |

### 8.12 kpi

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/admin/kpi/top-questions` | POST | `getCachedTopQuestions(persona)` or `generateTopQuestions(persona)` (Anthropic). | `KpiTopQuestions.tsx:47` | proxy + guardAdminPost | none | `maxDuration = 30` | `personaLabel` ∈ `ARCHETYPE_META` keys + `unknown`; `force` | `{summary}`; 503 `unavailable`; 500 | Token-spending, not audit-logged. |

### 8.13 marketing (per-capture marketing sends — older flow)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/admin/marketing/delete` | POST | `deleteDraftSend(sendId)` (only `status='draft'`). | `CustomerProfileCard.tsx:759` | proxy + guardAdminPost | none | `maxDuration = 10` | `sendId` | `{ok}`; `not_deletable` 409 | — |
| `POST /api/admin/marketing/draft` | POST | Per-capture AI draft: `loadEligibleCapture(captureId)`, `loadConversationForSummary(sessionId)`, `chooseCartProductIds`, `generateMarketingDraft`, `createDraft`/`saveRegeneratedDraft`. | **none in `src/app/admin`** — only a comment in `src/lib/campaign-draft-core.mjs:17` | proxy + guardAdminPost | none | `maxDuration = 30` | `captureId`, `discountPercent`, `regenerate` | `{send, reused?\|regenerated?}`; `not_eligible` 409; `draft_gone` 409; `draft_persist_failed` 500 (raw DB message) | **Dead-route candidate**, superseded by `customers/marketing-draft` (§12). |
| `POST /api/admin/marketing/email-preview` | POST | `renderMarketingEmailPreview(sendId, {subject, body})` → HTML. | `CustomerProfileCard.tsx:966`, `EmailPreviewButton.tsx:36` | proxy + guardAdminPost | none | `maxDuration = 15` | `sendId` | `text/html`; any non-ok → 404 | Second email-preview route (§13). |
| `POST /api/admin/marketing/send` | POST | `approveAndSend(sendId)` (`lib/marketing-email`: DOI + suppression, unsubscribe link, MS5- code mint, tracked link, status `sent`). | `CustomerProfileCard.tsx:789` | proxy + guardAdminPost | none | `maxDuration = 30` | `sendId` | `{ok, sentTo}`; `STATUS_BY_REASON` (`too_soon` 429, `discount_failed`/`send_failed` 502, `no_unsubscribe`/`email_not_configured` 503, ...) | — |
| `POST /api/admin/marketing/update` | POST | `updateDraftText(sendId, subject≤300, body≤20000)`. | `CustomerProfileCard.tsx:744,788` | proxy + guardAdminPost | none | `maxDuration = 10` | caps + non-empty body | `{send}`; `not_editable` 409 | — |

### 8.14 physical (Pingen letters)

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/admin/physical/send` | POST | `sendPhysicalLetter(customerId)` (`lib/physical-mail`: `PHYSICAL_MAIL_SENDS_APPROVED` flag, complete lawful address, letter draft, Pingen `uploadAndCreate` with Idempotency-Key). | `PhysicalLetterPanel.tsx:188` | proxy + guardAdminPost | none | `maxDuration = 30` | `customerId` | `{ok, letterId, providerLetterId, status}`; `flag_off` 403, `no_draft`/`no_address`/`incomplete_address` 409, `pingen_not_configured` 503, `submit_failed` 502, `store_failed` 500 | Sends a physical letter (PII to a third-party processor) with no `recordAdminAccess`. |

### 8.15 qa (Wissen: customer Q&A knowledge base)

All eight routes check `isDbConfigured()` right after the guard and — except `scan` — have **no try/catch** (DB/Shopify exceptions escape as framework 500s).

| Path | Methods | Purpose | Caller | Auth | Rate limit | Runtime / config | Input validation | Response | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `POST /api/admin/qa/answer` | POST | Validates `productId` against `loadProductCatalog()` (title resolved server-side) → `saveQaAnswer({id, answer≤4000, question≤500, productId, productTitle, questionEn≤500, answerEn≤4000})`. | `WissenWorkspace.tsx:262` | proxy + guardAdminPost | none | `maxDuration = 15` | manual + caps | `{entry}`; 400 `unknown_product`; 404 | audit-logged. |
| `POST /api/admin/qa/dismiss` | POST | `dismissQaEntry(id)`. | `WissenWorkspace.tsx:360` | proxy + guardAdminPost | none | `maxDuration = 15` | `id` | `{ok}`; **500 with code `unavailable`** on `!ok` (elsewhere `unavailable` is the 503 code) | audit-logged. |
| `POST /api/admin/qa/draft` | POST | `draftQaForConversation(conversationId)` — one Haiku pass. | **none found in `src/`** (header says "e.g. straight from the Gespräche inspector", but `GespraecheWorkspace.tsx` does not call it) | proxy + guardAdminPost | none | `maxDuration = 60` | `conversationId` | `{outcome}`; 502 `draft_failed` | **Dead-route candidate** (§12). audit-logged. |
| `GET /api/admin/qa/list?status=` | GET | `listQaEntries(status)`, `getQaCounts()`, `countScanCandidates()`. | `WissenWorkspace.tsx:100` | proxy + guardAdminGet | none | `maxDuration = 15` | `status` ∈ `QA_STATUSES` else null (all) | `{entries, counts, scanCandidates}`; 503 | — |
| `POST /api/admin/qa/publish` | POST | `generateQaTranslation` (Haiku, failure non-blocking) → `saveQaTranslation` → product-linked: `publishQaToProduct` (Shopify `metafieldsSet` + catalog refresh); `markQaPublished`; `invalidateGeneralQaCache`. | `WissenWorkspace.tsx:295` | proxy + guardAdminPost | none | `maxDuration = 60` | `id` | `{entry, catalogRefreshed, translated, hasEnglish}`; 409 `not_answered`; 503 `shopify_unconfigured`; `publish_<reason>` 404/502 | audit-logged. Writes to Shopify. |
| `POST /api/admin/qa/restore` | POST | `restoreQaEntry(id)`. | `WissenWorkspace.tsx:339` | proxy + guardAdminPost | none | `maxDuration = 15` | `id` | `{entry}`; 409 `duplicate_question`; 404 | audit-logged. |
| `POST /api/admin/qa/scan` | POST | `listScanCandidates(limit 1..25, default 10)` → loop `draftQaForConversation`. | `WissenWorkspace.tsx:119` | proxy + guardAdminPost | none | `maxDuration = 300` | `limit` clamped | `{scanned, created, noGap, duplicates, errors}` | audit-logged; only qa route with (inner-loop) try/catch. |
| `POST /api/admin/qa/unpublish` | POST | product-linked: `unpublishQaFromProduct` (metafield removal + catalog refresh); `markQaUnpublished`; cache invalidation. | `WissenWorkspace.tsx:321` | proxy + guardAdminPost | none | `maxDuration = 60` | `id` | `{entry, removed, catalogRefreshed}`; 409 `not_published`; 503; `unpublish_<reason>` 502; 500 `unavailable` | audit-logged. |


---

## 9. Auth helpers (as implemented)

| Helper | File | Behaviour |
|---|---|---|
| `proxy` | `src/proxy.ts` | Edge proxy on `/admin/:path*` + `/api/admin/:path*`. `/admin/login` passes; otherwise verifies the `ms_admin_session` cookie (`verifyAdminSessionToken`, Web Crypto HMAC-SHA256, 12 h `exp`). Pages → 302 `/admin/login`; APIs → 401 JSON envelope. |
| `isAdminPasswordValid` / `createAdminSessionToken` / `verifyAdminSessionToken` | `src/lib/admin-auth.ts` | SHA-256 digests compared constant-time; stateless signed cookie `base64url(JSON{exp}).base64url(HMAC)`; secret `ADMIN_SESSION_SECRET` → fallback `CHAT_SHARED_SECRET`; fails closed when unset. **No rate limit on login attempts** (login server action in `src/app/admin/login/page.tsx`). |
| `guardAdminPost` / `guardAdminGet` / `adminJson` / `adminJsonError` | `src/lib/admin-api.ts` | In-handler defence in depth: POST requires `Content-Type: application/json` (415, CSRF defence) + cookie (401); GET re-verifies the cookie. **Every `/api/admin/*` route uses one of the two guards** (verified by grep over all 79 admin route files — no route relies on the proxy alone). |
| `guardRequest` / `guardOriginOnly` / `corsHeaders` / `preflightResponse` | `src/lib/security.ts` | Origin allowlist (`ALLOWED_ORIGINS`) + `x-ms-chat-key` shared secret (SHA-256 + `timingSafeEqual`); CORS headers incl. `x-ms-locale`, exposed `Retry-After`. |
| `requireSignedInCustomer` / `readSession` | `src/lib/account-guard.ts` | guardRequest + chat bucket + session→customer→valid Shopify Customer Account token. |
| `requireCronAuth` | `src/lib/cron-auth.ts` | `Authorization: Bearer <CRON_SECRET>` constant-time; fails closed. |

## 10. Webhook verification

| Route | Mechanism | Notes |
|---|---|---|
| `POST /api/inbound/resend` | Svix / standard-webhooks via `resend.webhooks.verify` over the RAW body (`lib/email-webhook.mjs`), secret `RESEND_WEBHOOK_SECRET`; 503 when unset; 400 on failure. Timestamp tolerance + replay window are the SDK defaults (standard-webhooks: 5 min). | Also applies delivery events (`email.bounced/complained/delivered`) when they arrive here. Dedup on Message-ID for received mail. |
| `POST /api/webhooks/resend` | Same verifier; tries `RESEND_EVENTS_WEBHOOK_SECRET` then `RESEND_WEBHOOK_SECRET`. | Overlaps with the inbound route by design (one or two Resend webhooks). Apply failures are acknowledged with 200 `{applied:false}` (reported to Sentry) — a retry would not help. |
| `POST /api/webhooks/shopify` | `X-Shopify-Hmac-SHA256` over the raw body with `SHOPIFY_WEBHOOK_SECRET` (constant-time); 503 when unset. | Topics: orders/create, orders/paid (attribution), products/*, inventory_levels/* (catalog refresh with throttle gate). |
| `POST /api/webhooks/pingen` | standard-webhooks HMAC with one of the comma-separated `PINGEN_WEBHOOK_SECRET`s over the raw body; 503 when unset. | Letter status updates by provider id. |

## 11. Token-based links

| Link | Token | Generation | Verification | Expiry |
|---|---|---|---|---|
| `GET /api/unsubscribe?token=` | `b64url(email).b64url(HMAC-SHA256(email))` | `buildUnsubscribeToken` (`lib/email-capture-store.ts:359`), secret `UNSUBSCRIBE_SECRET` → fallback `CHAT_SHARED_SECRET` | `verifyUnsubscribeToken` with `timingSafeEqual` | none (unsubscribe must always work) |
| `GET /api/confirm-marketing?token=` | random DOI token stored on the capture row | `upsertEmailCapture` / DOI send | `confirmMarketingByToken` (DB lookup) | `MARKETING_DOI_EXPIRY_DAYS` (7) |
| `GET /api/r/[token]` | 24 random bytes b64url stored per marketing send / campaign send / bundle offer | `generateRedirectToken` (`lib/marketing-store.ts:466`, Web Crypto) | DB lookup in three stores, in order | bundle: offer expiry → branded 410 page |
| `GET /api/email-countdown/[token]` | HMAC-signed `{expiresAt, language}` | `lib/email-countdown-token.mjs` (`countdownSecret()`) | signature check, no DB | the deadline itself (renders "abgelaufen") |
| `POST /api/attribution/token` (widget) → cart attribute `_mo` | random token stored in `mo_attribution_tokens` (pseudonymous) | `lib/mo-orders-store.ts` | matched on `orders/*` webhook | `MO_ATTRIBUTION_WINDOW_DAYS` + 7 d purge |

## 12. Routes without any caller in this repository

Expected (external callers): all `/api/chat|contact|products|capture-email|consent-copy|tts|kpi|feedback|chat-marketing-opt-in|auth/*|account/*|attribution/token` (widget), `/api/cron/*` (Vercel), `/api/inbound/resend`, `/api/webhooks/*` (providers), `/api/unsubscribe|confirm-marketing|r/[token]|email-countdown|email-hero-image|newsletter-rating` (mail clients).

**Candidates for removal (no UI, script or doc caller found — decision needed):**
| Route | Evidence | Note |
|---|---|---|
| `POST /api/admin/bundles/list` | no `fetch` in `src/app/admin`; one doc mention | The Kunden card receives bundles server-rendered; the list endpoint is unused by the UI. |
| `POST /api/admin/marketing/draft` | no UI caller; one doc mention | Per-capture draft (old Marketing tab); the UI drafts per customer via `/api/admin/customers/marketing-draft`. |
| `POST /api/admin/qa/draft` | no UI caller, no doc mention | The Wissen tab uses `/api/admin/qa/scan`; a single-conversation draft route without a button. |

## 13. Duplicated or overlapping routes
- Four HTML e-mail preview routes (`marketing/email-preview`, `campaign/email-preview`, `correspondence/email-preview`, `email-designs/preview`) render different composers; they share the `EmailPreviewButton` client and the same fetch→blob pattern. Keep the routes; share the response helper.
- `/api/inbound/resend` and `/api/webhooks/resend` both apply delivery events (documented overlap; one or two Resend webhooks).
- `/api/admin/customers/marketing-draft` (per customer) vs `/api/admin/marketing/draft` (per capture) — the latter is the legacy path (see §12).
- `/api/admin/marketing/update|send|delete|email-preview` are shared by the Kunden Marketing sub-tab (all sends are `marketing_sends` rows).
- `/api/admin/analytics/step` and `/api/admin/improve/step` implement the same "step a long job with a claim" pattern (two client drivers); a shared `useStepLoop` hook is a refactor target.

## 14. Chat API contract surface (docs/API_CONTRACT.md)
The contract covers `/api/chat` (UI-message stream parts, tools, headers `x-ms-chat-key`, `x-ms-session`, `x-ms-locale`), `/api/contact`, `/api/products`, `/api/capture-email`, `/api/chat-marketing-opt-in`, `/api/consent-copy`, `/api/feedback`, `/api/tts`, `/api/kpi`, `/api/attribution/token`, `/api/auth/*` and `/api/account/*`. The route table above was derived from the code; a line-by-line contract re-verification is scheduled for the docs slice (no widget-visible change is planned in this project, so the contract stays as is).

---

Generated 2026-09-08 against HEAD `9c6b551` (branch state: `src/lib/db.ts` modified, `docs/screenshots/` untracked).
Read-only inventory; nothing in the repo was changed. Note: the git history available in this checkout starts at
`42e09bb` (2026-08-05, 50 commits) — every "last touched" date that reads 2026-08-05 means "at or before the start of
the available history", not "written that day".

---

# 3. Cron jobs and background work

### 1.1 Schedule (vercel.json:1-24, region `fra1`)

Vercel Cron evaluates schedules in UTC. Berlin = CET (UTC+1) in winter, CEST (UTC+2) late March → late October.

| # | Path | Cron (UTC) | Europe/Berlin (CEST / CET) | maxDuration | Route file |
|---|------|-----------|---------------------------|-------------|-----------|
| 1 | `/api/cron/refresh-customers` | `0 2 * * *` → 02:00 daily | 04:00 / 03:00 | 300 s (`route.ts:23`) | `src/app/api/cron/refresh-customers/route.ts` |
| 2 | `/api/cron/sync-campaign-audience` | `30 2 * * *` → 02:30 daily | 04:30 / 03:30 | 300 s (`route.ts:17`) | `src/app/api/cron/sync-campaign-audience/route.ts` |
| 3 | `/api/cron/sync-catalog` | `0 3 * * *` → 03:00 daily | 05:00 / 04:00 | 300 s (`route.ts:46`) | `src/app/api/cron/sync-catalog/route.ts` |
| 4 | `/api/cron/retention` | `30 3 * * *` → 03:30 daily | 05:30 / 04:30 | 60 s (`route.ts:24`) | `src/app/api/cron/retention/route.ts` |
| 5 | `/api/cron/expire-bundles` | `45 3 * * *` → 03:45 daily | 05:45 / 04:45 | 60 s (`route.ts:19`) | `src/app/api/cron/expire-bundles/route.ts` |

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

### 1.2 `/api/cron/refresh-customers` — `src/app/api/cron/refresh-customers/route.ts`

Purpose: keep each customer's cached Shopify order history (→ owned items) and lawful postal address fresh without the
admin pressing "Käufe aktualisieren".

Steps (`route.ts:31-55`):
1. `requireCronAuth` (`:32`).
2. Reads `CUSTOMER_REFRESH_BATCH` (default 25) and `CUSTOMER_REFRESH_STALE_HOURS` (default 24) through a local `intEnv`
   helper (`:25-29`, note: this duplicates `parseIntEnv` from `src/lib/env-num.ts:12` with min=1 semantics).
3. `listCustomersForDataRefresh(batch, staleBefore)` (`src/lib/customer-store.ts:829-853`):
   `SELECT id, email, shopify_customer_id FROM customers WHERE purchase_summary_updated_at IS NULL OR < stale
   ORDER BY purchase_summary_updated_at ASC NULLS FIRST, id ASC LIMIT batch`. Returns `[]` on DB error (swallowed +
   reported).
4. **Sequentially** for each candidate: `refreshCustomerData(c)` (`src/lib/customer-refresh.ts:38-79`):
   - if `shopifyCustomerId` set and `getValidAccessToken(customer.id)` (customer-oauth-store) returns a live token →
     `refreshSignedInCustomerCache(customer.id)` (customer-account-cache; Customer Account API; also caches name +
     address) → source `customer_account`.
   - else fallback: `isShopifyConfigured()` guard → `fetchOrderHistoryByEmail(email)` (shopify-orders, Admin API) →
     `saveCustomerPurchaseSummary(id, history)` (customer-store).
   - if `isPhysicalMailSendsApproved()` (`pingen-flag.mjs`, env `PHYSICAL_MAIL_SENDS_APPROVED`) →
     `fetchLawfulAddressByEmail` and store **only** when `source === "purchase"` (`saveCustomerPostalAddress`).
   - always `markPostalAddressChecked(id)` (`customer-store.ts:857-867`, sets `postal_address_checked_at = now()`).
   - never throws; returns `{ok:false, reason}` on any failure (`:75-78`).
5. Returns `{ ok:true, considered, refreshed, failed, batch, staleHours }`.

Failure behaviour: one customer failing only increments `failed`; a thrown error outside the loop → 503. Since each
successful refresh bumps `purchase_summary_updated_at`, failed customers stay at the head of the stale queue and are
retried next night — but **a customer that permanently fails (e.g. e-mail with no Shopify account,
`upstream_unavailable`) is never stamped and will occupy one of the 25 slots every single night** (the address-capture
path has a throttle stamp, the purchase-summary path does not). With N permanently-failing customers ≥ batch size the
sweep stalls. Worth a look.

Idempotent: yes (pure cache refresh; re-running writes the same data). Side effects: Shopify Admin API reads
(rate-limited, hence sequential), `customers` UPDATEs, no e-mail, no Shopify writes.

### 1.3 `/api/cron/sync-campaign-audience` — `src/app/api/cron/sync-campaign-audience/route.ts`

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

### 1.4 `/api/cron/sync-catalog` — `src/app/api/cron/sync-catalog/route.ts`

Purpose: pull the live Shopify product catalog, regenerate OpenAI embeddings, write both as a consistent pair to Vercel
Blob under stable keys (`CATALOG_BLOB_KEY`, `EMBEDDINGS_BLOB_KEY` from `src/lib/catalog-store.ts`) so `/api/chat` picks
up the new data on the next warm invocation. Reliability rationale in docs/CATALOG_SYNC_DIAGNOSIS.md.

Steps (`route.ts:170-258`):
1. `requireCronAuth`.
2. Source products: `fetchAllProducts()` (`src/lib/shopify.ts`, Admin API) → `mapShopifyProducts(raw)`
   (`src/lib/catalog-mapping.ts`). Any error, or 0 products after filtering → `mode = "fallback-bundle"` and
   `fallbackFromBundle()` dynamically imports `src/data/product-catalog.json` (`:154-159`). **HTTP 200 in fallback
   mode** — the response carries `mode:"fallback-bundle"` and `shopifyError`, but a Shopify outage does not fail the cron.
3. If `OPENAI_API_KEY` unset: write only the catalog blob (if `BLOB_READ_WRITE_TOKEN` set), `invalidateCache()`,
   return 200 with `embeddingsSkipped` (`:204-212`).
4. `embedAll(products)` (`:66-152`): `buildEmbeddingDoc` + `embeddingDocHash` per product (`embedding-doc.mjs`,
   `EMBEDDING_DOC_VERSION`), `readEmbeddingsBlobDirect()` for carry-forward, `embedDocsResilient(...)`
   (`embed-resilience.mjs`) with model `text-embedding-3-small`, chunk 100, 250 ms inter-chunk delay, OpenAI SDK
   `maxRetries: 4`; `classifyOpenAiError` (`openai-error.mjs`) flags `quota` (billing) distinctly with a loud
   `console.error` (`:104-109`).
5. TOTAL failure (`synced === 0 && carriedForward === 0`) → `reportError` + **503**, last-good blob pair is preserved
   (`:221-235`).
6. Otherwise `writeCatalogPair(products, file)` (`src/lib/catalog-store.ts:180-195`): reconcile orphan vectors, write
   embeddings blob FIRST, then catalog blob, then `invalidateCache()`. Both `put()`s use `access:"private"`,
   `addRandomSuffix:false`. A throw here → outer catch → 503 with the other blob untouched.
7. `summaryResponse` (`:260-293`): `{ ok:true, partial, mode, productCount, embeddingsCount, synced, carriedForward,
   skipped, docVersion, catalogBlobKey/Url, embeddingsBlobKey/Url, elapsedMs, ...log }`. `partial:true` when some
   products have no vector.

Failure behaviour: partial success → 200 with `partial:true`; total embedding failure → 503 and nothing written;
blob write throw → 503. Idempotent: yes (overwrites the same two blob keys; embedding is deterministic modulo model
nondeterminism; carry-forward by `docHash` avoids re-embedding unchanged items).

Note: `invalidateCache()` only clears the in-process cache of the cron's own lambda; other warm `/api/chat` instances
pick up the new blobs via their own TTL logic in `catalog-store.ts` (not part of this route).

### 1.5 `/api/cron/retention` — `src/app/api/cron/retention/route.ts`

Purpose: enforce docs/DATA_RETENTION.md windows + piggy-backed **conversion sweep**.

Steps (`route.ts:26-46`):
1. `requireCronAuth`.
2. `retentionOptionsFromEnv()` (`src/lib/retention.ts:106-133`) — all via `parseIntEnv(name, default, min=0)`
   (`src/lib/env-num.ts:12`):

   | Env | Default | Window applies to |
   |---|---|---|
   | `RETENTION_DAYS` | 180 | conversations (+ messages cascade) by `last_activity_at` |
   | `KPI_RETENTION_DAYS` | 180 | kpi_events, ai_usage (conversation_id IS NULL), conversation_insights, kpi_persona_question_summaries, mo_orders |
   | `ABANDON_AFTER_MINUTES` | 30 | active → abandoned flip |
   | `SUPPRESSED_CAPTURE_PURGE_DAYS` | 30 | email_captures + customers on suppression_list |
   | `CORRESPONDENCE_RETENTION_DAYS` | 365 | email_messages by `occurred_at` |
   | `PHYSICAL_LETTER_RETENTION_DAYS` | 365 | physical_letters by `created_at` |
   | `FEEDBACK_RETENTION_DAYS` | 365 (0 disables) | feedback |
   | `CUSTOMER_INACTIVITY_RETENTION_DAYS` | 1095 (0 disables) | customers with `last_seen_at` old AND `marketing_status NOT IN ('confirmed','pending')` |
   | `ADMIN_ACCESS_LOG_RETENTION_DAYS` | 730 (0 disables) | admin_access_log by `occurred_at` |
   | `CAMPAIGN_CONTACT_RETENTION_DAYS` | 365 (0 disables) | campaign_sends by `sent_at`; campaign_contacts by `COALESCE(last_synced_at, created_at)` |
   | `ANALYTICS_REPORT_RETENTION_DAYS` | 365 (0 disables) | analytics_reports by `created_at` |
   | `MO_ATTRIBUTION_WINDOW_DAYS` | 30 (min 1) | mo_attribution_tokens older than window + 7 d grace |

3. `runRetention(opts)` (`retention.ts:147-428`): throws if `getSql()` is null (→ 503). Then **19 sequential SQL
   statements**, each `WITH del AS (DELETE … RETURNING 1) SELECT count(*)` — no transaction, so a mid-run failure leaves
   earlier steps committed (acceptable: every step is independently idempotent). Order: abandon flip (`:166`), delete
   conversations (`:178`), kpi_events (`:188`), ai_usage w/o conversation (`:199`), email_captures opted-out (`:211`),
   customers on suppression list w/o remaining capture (`:232`), email_messages (`:248`), physical_letters (`:261`),
   feedback (`:276`), inactive customers (`:294`), admin_access_log (`:308`), campaign_sends + campaign_contacts
   (`:327`/`:333`), analytics_reports (`:355`), conversation_insights (`:362`), kpi_persona_question_summaries (`:368`),
   mo_orders (`:382`), mo_attribution_tokens (`:391`), `purgeExpiredPendingAuth(sql)` (`customer-oauth-store`, `:404`).
4. `runConversionSweep()` (`src/lib/conversion-sweep.ts:77-156`) — **never throws**, returns `{ran:false}` when no
   DB / no Shopify / `CONVERSION_SWEEP_MAX_CODES` (default 25, 0 disables) is 0. Selects the oldest ≤25 `marketing_sends`
   rows with `status='sent' AND discount_code IS NOT NULL AND shopify_order_matched=false AND (discount_expires_at IS
   NULL OR > now-7d)` (`:87-96`); for each: `wasCodeSeenOnIngestedOrder(code)` (mo-orders-store, cheap DB check) else
   `wasDiscountCodeRedeemed(code)` (shopify-orders, Admin API); on `true` → `UPDATE marketing_sends SET
   shopify_order_matched=true` and flip the session's most-recent-as-of-send conversation to `status='converted'`
   (`:134-147`). `null` (unknown) → counted, retried next run.
5. Response `{ ok:true, options, ...RetentionResult, conversionSweep }`.

Failure behaviour: `runRetention` throw → 503 (sweep not run). Sweep errors are swallowed (`reportError`) and yield
`{ran:false}`. **Budget risk:** maxDuration is only **60 s** for 19 statements + up to 25 Shopify calls; the sweep
alone can take a good chunk of that on a slow Shopify day. The per-row Shopify part is bounded by the cap; fine for
now but the smallest headroom of the five crons.

Idempotent: yes. Every DELETE is by cutoff; the abandon flip only touches `status='active'`; `converted` is sticky.

### 1.6 `/api/cron/expire-bundles` — `src/app/api/cron/expire-bundles/route.ts`

Purpose: archive Shopify bundle products for `bundle_offers` rows that are `status='active'` and past `expires_at`;
flip the row to `expired` + `archived_at`.

Steps (`route.ts:21-39`):
1. `requireCronAuth`.
2. `isDbConfigured()` else **503** `"No database configured"` (`:24-30`) — the only cron that checks DB up front.
3. `expireBundleOffers()` (`src/lib/bundle-offers.ts:371-393`) → `runBundleExpirySweep(deps)`
   (`src/lib/bundle-offer-core.mjs:317-336`) with:
   - `fetchDueBundleOffers(nowIso)` (`src/lib/bundle-offers-store.ts:415-436`): `SELECT id, shopify_product_id FROM
     bundle_offers WHERE status='active' AND expires_at < now ORDER BY expires_at LIMIT 500` — throws on DB error.
   - per offer, sequential: `archiveBundleProduct(productId)` (shopify-bundles, `productUpdate status: ARCHIVED`;
     skipped when `shopifyProductId` is null) then `markOfferExpired(id)` (`bundle-offers-store.ts:202-219`,
     `UPDATE … WHERE id=$1 AND status='active'`).
   - per-offer error → `failed++`, `reportError` + loud `console.error("… will retry next run")` (`bundle-offers.ts:380-390`).
4. Response `{ ok:true, archived, failed, scanned, ranAt }`.

Failure behaviour: per-offer failures don't abort; the row stays `active` so it is retried next night. A DB read error
propagates → 503. Idempotent: yes (Shopify archive is idempotent, the UPDATE is guarded by `status='active'`).

### 1.7 Scheduled / background work that is NOT a Vercel cron

| Mechanism | Where | What it does | Bounds / risks |
|---|---|---|---|
| **Next `after()`** (post-response background work) | `src/app/admin/page.tsx:183` — `after(() => autoCaptureMissingAddresses({ limit: 12 }))` inside `KundenTab`, executed on **every render of `/admin`** (page is `force-dynamic`, `:56`, and `KundenTab` is force-mounted for every tab — the `after` fires whichever tab you open). | `src/lib/address-capture.ts:43-76`: exits unless `isShopifyConfigured()` AND `isPhysicalMailSendsApproved()`; then `listCustomersMissingAddress(12, now-7d)` → per customer `fetchLawfulAddressByEmail` (Shopify Admin API), store only `source==="purchase"`, always `markPostalAddressChecked`. | Bounded to 12 Shopify calls per page load, throttled 7 days per customer. This is the **only** `after()` in the codebase. Because `PHYSICAL_MAIL_SENDS_APPROVED` is off by default the call is currently a no-op in most environments. |
| **Client-driven stepping loop — Komplettanalyse** | `src/app/admin/analytics/ReportProgressDriver.tsx:72-113` → `POST /api/admin/analytics/step` (`src/app/api/admin/analytics/step/route.ts`, maxDuration 60) → `stepReport(id)` (`src/lib/analytics-report-generate.ts:121-…`). | Tight `while` loop with no delay: each response advances one phase chunk (analyze → insights → personas → customer_synthesis → customer_profiles → assemble). Stops on `done`, on non-2xx, or when the component unmounts (`pausedRef`). Pause/resume buttons. | No server-side claim: two tabs stepping the same report concurrently would both do model work (the improvement loop fixed exactly this with migration 0045; the report stepper did not get the same fix). Report stays `running` server-side if the tab closes — resumable, nothing cleans up abandoned `running` reports except `ANALYTICS_REPORT_RETENTION_DAYS`. |
| **Client-driven stepping loop — Verbesserung (improvement run)** | `src/app/admin/verbesserung/VerbesserungWorkspace.tsx:641-735` (`RunDriver`) → `POST /api/admin/improve/step` (`src/app/api/admin/improve/step/route.ts`, maxDuration **300**) → `stepImprovementRun(id)` (`src/lib/improvement-generate.ts:111-160`). | `for(;;)` loop; network errors retried every 5 s up to 60 times (~5 min) (`:668-669`); server returns `busy:true` when another step holds the per-run claim (`claimRunStep`, `src/lib/improvement-store.ts:320-340`, migration 0045, `STEP_CLAIM_TTL_MINUTES = 6` at `:311`) and the client polls every 5 s. | Each step is ONE Sonnet call; the run is created by `POST /api/admin/improve/run`. An abandoned run stays `running`; the claim goes stale after 6 min so a later "Fortsetzen" click resumes it. |
| **Batch-until-empty admin actions (manual re-click, no loop)** | `POST /api/admin/conversations/analyze-bulk` (`route.ts:29` maxDuration 60, `BULK_ANALYZE_LIMIT` per call, response reports `remaining`; UI `GespraecheInsights.tsx:169` shows "noch N offen (erneut ausführen)"); `POST /api/admin/qa/scan` (`route.ts:17` maxDuration 300, `limit` ≤25 per call; UI `WissenWorkspace.tsx:119`); `POST /api/admin/campaign/prepare` (`route.ts:28` maxDuration 300, ≤50 per request; header comment `:9-10`: "deliberately no cron"). | All explicitly human-triggered because they spend model tokens. | None are scheduled. `KampagneWorkspace.tsx:999-1038` (`doPrepare`) is the one client-side chunk loop: `for (done=0; done<PREPARE_TOTAL; done+=PREPARE_CHUNK)` calling `/prepare` until `exhausted`, then `window.location.reload()`. |
| **Debounced autosave timers** | `KampagneWorkspace.tsx:344-347` (`saveTimer`), `GenerateReportPanel.tsx:76`, `product-picker.tsx:84` — plain `setTimeout` debounces, not background jobs. | — | — |
| **Long-running single requests (not loops)** | `POST /api/admin/conversations/insights` (maxDuration 300, two Haiku passes), `POST /api/admin/campaign/sync` (300; same `syncCampaignAudience` as cron 2), `POST /api/admin/email-hero/generate` (300), `/api/chat` (300). | Manual only. | — |

There is **no** `waitUntil`, `setInterval`, queue, or webhook-driven scheduler anywhere in `src/` (grep on 2026-09-08:
only the one `after()` above). Inbound webhooks (`/api/webhooks/{shopify,resend,pingen}`, `/api/inbound/resend`) are
event-driven, not scheduled, and are out of scope for this section.

---

# 4. Scripts (`scripts/*.mjs`, 18 files)

Legend — **Prod impact**: what the script can do to shared/production state when run with production env.
"Local files only" = writes inside the repo checkout / cwd, nothing remote. Node in this sandbox: see footnote on `tsx`.

| Script | Purpose | Invocation | Required env (direct) | Prod impact | Docs reference | package.json entry |
|---|---|---|---|---|---|---|
| `analyze-repurchase.mjs` (434 l) | Repurchase-behaviour analysis over Shopify order history: repeat rate per value tier, inter-order intervals, accessory follow-up rate, decay by window. Stats live in `src/lib/repurchase-analysis.mjs`. Flags `--since`, `--max-orders`, `--page-size`, `--json <path>`, `--occasion-gap`. | `npm run analyze:repurchase [-- flags]` (`node --env-file=.env`) | `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_API_VERSION` (REQUIRED check `:97`) | **Read-only** (`orders` GraphQL queries; header `:24`). Optional local JSON of aggregates (`:405`). Uses shop API cost budget (`shopify-throttle.mjs`). | docs/REPURCHASE_ANALYSIS.md, docs/CAMPAIGNS.md | `analyze:repurchase` |
| `build-countdown-sprite.mjs` (70 l) | Pre-renders countdown glyph PNGs (digits, DE/EN labels) with `sharp` into `src/lib/generated/countdown-sprite.mjs` so `/api/email-countdown` needs no system font. | `node scripts/build-countdown-sprite.mjs` (manual; commit output) | none (needs Liberation Sans installed locally) | Local files only (`:69`) | docs/EMAIL_DESIGNS.md | **none** |
| `build-embeddings.mjs` (67 l) | Embeds `src/data/product-catalog.json` with OpenAI `text-embedding-3-small` (chunks of 100) into `src/data/product-embeddings.json` (same `buildEmbeddingDoc` as the cron). | `npm run index` (plain `node`, no `--env-file` → export `OPENAI_API_KEY` yourself) | `OPENAI_API_KEY` (`:133`) | Local file write (`:60`); **spends OpenAI credits** (~$0.001). | docs/CATALOG_SYNC.md, docs/REPO_AUDIT.md (`npm run index` itself appears in no doc) | `index` |
| `convert-catalog.mjs` (573 l) | Converts the committed Shopify CSV export (`src/data/products_export_1.csv`) into `product-catalog.json` (filter: published, price>0, has image, active, not gift card). | `npm run convert-catalog` (`INPUT=`/`OUTPUT=` override) | optional `INPUT`, `OUTPUT` (`:178-183`) | Local files only (`:563`) | docs/CATALOG_SYNC.md, docs/REPO_AUDIT.md, docs/PRODUCT_VARIANTS_PLAN.md, docs/CHANGE_REPORT_ROUND9.md | `convert-catalog` |
| `diagnose-address.mjs` (196 l) | For ONE e-mail: shows exactly what Shopify returns (defaultAddress + completed orders' shippingAddress) and what `lib/postal-address` would store. Note `:218-225`: carries a **local copy** of the completed-purchase status check because it cannot import the TS helper — drift risk vs `src/lib/shopify-orders.ts`. | `npm run diagnose:address -- someone@example.com` | `SHOPIFY_*` four vars (`:44`) | **Read-only** Shopify (customer + orders by e-mail → PII printed to the terminal); no DB. | **NONE** (only `.env.example`? no — not referenced anywhere) | `diagnose:address` |
| `gen-prompt-golden.mjs` (24 l) | Regenerates `src/lib/system-prompt-core.de.golden.txt` from the shared fixtures after an intentional German prompt change (guards `system-prompt-core.test.mjs`). | `node scripts/gen-prompt-golden.mjs` | none | Local file only | **NONE** (only mentioned in its own header + the test) | **none** |
| `hero-gradient.mjs` (18 l) | Applies the Performance-hero legibility gradient (`email-hero-gradient.mjs`) to any picture — for preparing `public/email-hero-default.jpg`. | `npm run hero:gradient -- <in> <out.png>` | none | Local files only | docs/EMAIL_DESIGNS.md | `hero:gradient` |
| `hero-quality-compare.mjs` (298 l) | Renders stored hero prompts in several variants (quality level, ±catalogue reference photos) through the production pipeline and writes a side-by-side HTML sheet to `./hero-compare*/` (git-ignored). `--dry-run` skips API calls. | `npm run hero:compare [-- --count N \| --prompts f \| --variants … \| --out dir \| --dry-run]` | `OPENAI_API_KEY` (`:71`), `DATABASE_URL` unless `--prompts` (`:91`); `ANTHROPIC_API_KEY` optional (QA check via `heroQaEnabled(process.env)`) | **DB read-only** (`SELECT … FROM campaign_contacts / marketing_sends`, `:105-113`, includes `purchase_summary` PII in memory); **spends OpenAI image + Anthropic credits** (real cost is printed); writes local files only. | docs/EMAIL_DESIGNS.md (as `npm run hero:compare`) | `hero:compare` |
| `list-test-discounts.mjs` (373 l) | Lists all Shopify discount codes minted by the app (prefix `MS5-`); `--delete` deletes them after an interactive confirmation (`discountCodeDelete`, `:235`). | `node --env-file=.env.local scripts/list-test-discounts.mjs [--delete]` (header uses `.env.local`, every other script says `.env`) | `SHOPIFY_*` four vars (`:57`) | Default read-only; **`--delete` deletes live Shopify discount codes** (`write_discounts`). A customer holding an un-redeemed MS5- code from a real marketing send would lose it. | **NONE** | **none** |
| `migrate.mjs` (136 l) | Forward-only SQL migration runner (see §4.3). | `npm run db:migrate` / `DATABASE_URL=… node scripts/migrate.mjs` | one of `DATABASE_URL_UNPOOLED`, `POSTGRES_URL_NON_POOLING`, `DATABASE_URL`, `POSTGRES_URL` (`:24-31`) | **DDL on the target DB** + `INSERT INTO _migrations` (`:126`). | docs/DATABASE.md, docs/COMPLETENESS_AUDIT.md; `npm run db:migrate` in DATABASE, ADMIN_DASHBOARD, CUSTOMER_ACCOUNT, ORDER_ATTRIBUTION, GDPR_REMEDIATION_HANDOFF | `db:migrate` |
| `preview-summary-email.mjs` (53 l) | Renders the consultation-summary e-mail with 2 real catalog products to `preview-summary-email.{html,txt}` in the repo root (git-ignored). | `npx tsx scripts/preview-summary-email.mjs` — imports `../src/lib/summary-email.ts` (†) | none | Local files only | **NONE** (only `.gitignore` comment) | **none** |
| `probe-bundle.mjs` (868 l) | "THROWAWAY verification probe for S9b" (header `:2-9`): introspects the live Admin schema, **creates one disposable bundle product** (`productBundleCreate`, `productVariantsBulkUpdate`, `publishablePublish`), checks the `/cart/<variant>:1` permalink, then **archives** it (`productUpdate` → ARCHIVED). `--keep` / `KEEP_PROBE=1` skips cleanup. | `node --env-file=.env scripts/probe-bundle.mjs [--keep]` — but imports `../src/lib/shopify.ts` (†) | `KEEP_PROBE` (`:74`) + the `SHOPIFY_*` vars indirectly via `src/lib/shopify.ts` | **Writes to the live Shopify store** (creates + publishes + archives a product). Header says "Safe to delete after S9b is closed" — S9b is closed (docs/BUNDLES.md exists) → candidate for deletion. | docs/BUNDLES_SPIKE.md | **none** |
| `reset-test-data.mjs` (232 l) | `TRUNCATE … RESTART IDENTITY CASCADE` of every data table; prints host/db first; completeness guard cross-checks `DATA_TABLES` against `information_schema` and **aborts** if the live DB has an unlisted table (`:150-190`). | `ALLOW_DB_RESET=true npm run db:reset` | `ALLOW_DB_RESET=true` gate (`:4`), DB URL (same 4-way fallback as migrate) | **Destroys all data in the target DB.** `_migrations` preserved. **Currently unusable against a fully-migrated DB**: `DATA_TABLES` (`:109-133`) is "current through migration 0031" (`:29`) — every table added by 0032–0055 (analytics_reports, campaign_contacts, campaign_sends, qa_entries, mo_orders, mo_attribution_tokens, improvement_runs/…, email_templates, email_design_selections, email_hero_images, …) is unlisted, so the guard exits 1. Safe failure mode, but the script is dead until the list is updated. | **NONE** (`npm run db:reset` appears in no doc) | `db:reset` |
| `send-test-emails.mjs` (169 l) | Sends one `[TEST]` e-mail of every redesigned type (summary, DOI, marketing, campaign) to a recipient through the real `sendEmail()`. | `npx tsx --env-file=.env scripts/send-test-emails.mjs [recipient]` (†) | `RESEND_API_KEY`, `CONTACT_FROM_EMAIL` indirectly via `src/lib/email.ts` (`isEmailConfigured()` check `:29`) | **Sends real e-mail via Resend** (4 messages). Recipient defaults to a hard-coded personal address (`:28`). No DB, no discount minting. | **NONE** | **none** |
| `setup-qa-metafield.mjs` (151 l) | One-shot: creates the PRODUCT metafield definition `custom.qa` (json, storefront-visible) for the "Wissen" Q&A publish path. Idempotent (`TAKEN` → exit 0). | `node --env-file=.env scripts/setup-qa-metafield.mjs` | `SHOPIFY_*` four vars (`:21-28`) | **Shopify write** (`metafieldDefinitionCreate`, needs `write_products`) — one-time setup. | **NONE** (docs/QA_KNOWLEDGE.md does not name it — verify when consolidating) | **none** |
| `verify-customer-account.mjs` (203 l) | Verify-first gate for Customer Account sign-in: discovery doc vs expected values, empirical public-client token probe, `prompt=none` probe. | `npm run verify:customer-account` | `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID`, `PUBLIC_BASE_URL`; optional `SHOPIFY_STOREFRONT_DOMAIN`, `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET` | Read-only (throwaway auth code, no sign-in completed). Hard-codes the live shop's issuer/endpoints (`:27-34`). | docs/CUSTOMER_ACCOUNT.md (as `npm run verify:customer-account`) | `verify:customer-account` |
| `verify-pingen.mjs` (159 l) | Verifies the Pingen integration without sending: env present, client-credentials token, `GET /organisations/{id}`, `GET /file-upload`. Prints whether `PHYSICAL_MAIL_SENDS_APPROVED` is on. | `npm run verify:pingen` | `PINGEN_CLIENT_ID`, `PINGEN_CLIENT_SECRET`, `PINGEN_ORGANISATION_ID`; reads `PINGEN_STAGING`, `PINGEN_WEBHOOK_SECRET` | Read-only (`:2-4`) | **NONE** (docs mention the check conceptually? `npm run verify:pingen` not found in docs) | `verify:pingen` |
| `verify-shopify-auth.mjs` (346 l) | Verifies the Admin API client-credentials grant and scope grants (`read_products`, `read_orders`, `write_discounts` via `currentAppInstallation.accessScopes`). Full error taxonomy in header. | `npm run verify:shopify` | `SHOPIFY_*` four vars (`:29-36`) | Read-only | docs/CATALOG_SYNC.md, README.md:178 | `verify:shopify` |

(†) **`tsx` is not a dependency.** `preview-summary-email.mjs`, `send-test-emails.mjs` and `probe-bundle.mjs` import
`../src/lib/*.ts` modules whose own imports are extensionless TypeScript; the first two document `npx tsx …` (which
downloads tsx ad hoc), `probe-bundle.mjs` documents plain `node --env-file=.env` (`:11-12`) which cannot resolve
`src/lib/shopify.ts`'s extensionless imports even with Node's type stripping. Neither `package.json` nor `node_modules`
contains `tsx` (checked 2026-09-08). All other scripts import only `.mjs` cores and run under plain Node.

### 2.1 Scripts with NO package.json entry AND NO docs/README reference (orphans)

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
`probe-bundle.mjs` (docs/BUNDLES_SPIKE.md — historical).

### 2.2 Scripts that touch production data (summary)

| Class | Scripts |
|---|---|
| DB DDL / destructive | `migrate.mjs` (DDL + `_migrations` insert), `reset-test-data.mjs` (TRUNCATE all; gated) |
| DB read (PII in memory) | `hero-quality-compare.mjs` |
| Shopify writes | `probe-bundle.mjs` (create/publish/archive product), `setup-qa-metafield.mjs` (metafield definition), `list-test-discounts.mjs --delete` (delete discount codes) |
| Shopify reads incl. customer PII | `diagnose-address.mjs`, `analyze-repurchase.mjs` (ids only), `verify-shopify-auth.mjs`, `hero-quality-compare.mjs` (product images) |
| E-mail sends | `send-test-emails.mjs` (Resend, 4 mails to one recipient) |
| Paid AI calls | `build-embeddings.mjs` (OpenAI), `hero-quality-compare.mjs` (OpenAI images + optional Anthropic) |
| Local only | `build-countdown-sprite.mjs`, `convert-catalog.mjs`, `gen-prompt-golden.mjs`, `hero-gradient.mjs`, `preview-summary-email.mjs`, `verify-pingen.mjs`, `verify-customer-account.mjs` |

---

# 5. Environment variables

Method: `rg -oI 'process\.env\.[A-Z0-9_]+' src scripts | sort | uniq -c` **plus** the indirect readers, which the plain
grep misses and which account for ~35 of the variables: `parseIntEnv("X", default, min)` (`src/lib/env-num.ts:12`),
the cron-local `intEnv("X")` (`refresh-customers/route.ts:25`), `env("X")` (`src/lib/shopify.ts:44`, throws when
missing), `envTrim("X")` (`src/lib/shopify-customer-account.ts:48`), and the `.mjs` helpers that take
`env = process.env` as a parameter and read `env.X` (`campaign-flags.mjs`, `pingen-flag.mjs`, `ai-pricing.mjs`,
`email-hero-qa.mjs`, `email-hero-variants.mjs`, `email-countdown-token.mjs`). Scripts also check `REQUIRED` arrays via
`process.env[k]`. Total distinct names read by code: **86** (79 in `src/`, 6 script-only, 1 test-only).

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
| `ANTHROPIC_API_KEY` | 16 sites: `analytics-report-generate.ts:321,385`, `bundle-suggestion.ts:164`, `campaign-draft.ts:418`, `conversation-analysis.ts:78`, `conversation-insights.ts:84`, `customer-profile.ts:138`, `email-hero.ts:288`, `email-hero-qa.mjs:56`, `improvement-generate.ts:131`, `kpi-top-questions.ts:174`, `marketing-draft.ts:262,485,654`, `qa-draft.ts:67`, `qa-translate.ts:61`, `summary-email.ts:85`; `/api/chat` via `@ai-sdk/anthropic` implicitly | yes | yes | none; most callers degrade to a fallback draft / `unconfigured` | R (chat) | |
| `BLOB_READ_WRITE_TOKEN` | `catalog-store.ts:57,70,207,219`, `catalog-mutate.ts:261`, `email-hero.ts:104,559`, `cron/sync-catalog/route.ts:198`, `api/email-hero-image/[file]/route.ts:39` | yes | yes | unset → bundled JSON catalog; hero generation disabled | O (P on Vercel) | |
| `BUNDLE_CREATION_MODE` | `bundle-offers.ts:56` → `resolveBundleCreationMode` (`bundle-offer-core.mjs:38`) | yes | no | `native_fixed_bundle`; unknown value → default | O | |
| `BUNDLE_EXPIRED_REDIRECT_URL` | `api/r/[token]/route.ts:39` | yes | no | `SHOP_DOMAIN` (storefront root) | O | |
| `BUNDLE_OFFER_EXPIRY_DAYS` | `bundle-offers.ts:61` | yes (7) | no | 7 | O | |
| `CAMPAIGN_ALLOW_SINGLE_OPT_IN` | `campaign-flags.mjs:50` | yes (**true**) | no | false (fail-closed; only 1/true/yes/on) | O (legal gate) | `.env.example` ships it ON |
| `CAMPAIGN_CONTACT_RETENTION_DAYS` | `retention.ts:126` | yes (365) | no | 365; 0 disables | O | |
| `CAMPAIGN_MO_DEEPLINK_URL` | `campaign-flags.mjs:63` | yes | no | `https://motionsports.de/?mo=open&mo_new=1&mo_view=fullscreen&utm_source=campaign&utm_medium=email` | O | identical default in code and example |
| `CAMPAIGN_SENDS_APPROVED` | `campaign-flags.mjs:40` | yes (**true**) | no | false (fail-closed) | O (legal gate) | master send gate for Kampagne |
| `CHAT_SHARED_SECRET` | `security.ts:74`; fallback for `admin-auth.ts:28`, `email-capture-store.ts:347`, `email-countdown-token.mjs:14`, `shopify-customer-account.ts:92` | yes | yes | none → every `/api/chat`, `/api/contact`… request 401 | R | also the fallback signing key for 4 other secrets — rotating it invalidates admin sessions, unsubscribe links, countdown tokens and OAuth state unless the dedicated vars are set |
| `CONTACT_FROM_EMAIL` | `email.ts:59`, `api/contact/route.ts:152` | yes | yes | none → `isEmailConfigured()` false → all mail (summary/DOI/marketing/campaign/correspondence) disabled | R (e-mail) | README describes it only as the contact-form sender |
| `CONTACT_TO_EMAIL` | `api/contact/route.ts:151` | yes | yes | none → contact form logs to stdout | O | |
| `CONVERSION_SWEEP_MAX_CODES` | `conversion-sweep.ts:43` | **no** | no | 25; 0 disables | O | **undocumented** (retention cron sub-step) |
| `CORRESPONDENCE_RETENTION_DAYS` | `retention.ts:114` | yes (365) | no | 365 | O | |
| `CRON_SECRET` | `cron-auth.ts:28` | yes | yes | none → all 5 crons return 401 (fail closed) | R (crons) | `.env.example:316-319` names 4 crons, omits `sync-campaign-audience` |
| `CUSTOMER_AUTH_PENDING_TTL_MINUTES` | `shopify-customer-account.ts:99` | yes (10) | no | 10 | O | |
| `CUSTOMER_INACTIVITY_RETENTION_DAYS` | `retention.ts:121` | yes (1095) | no | 1095; 0 disables | O | |
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
| `FEEDBACK_RETENTION_DAYS` | `retention.ts:117` | yes (365) | no | 365; 0 disables | O | |
| `INBOUND_EMAIL_ADDRESS` | `email-inbound.ts:18` | yes | no | none → outbound mail has no Reply-To | O | |
| `INPUT` / `OUTPUT` | `scripts/convert-catalog.mjs:30-34` | no | no | `src/data/products_export_1.csv` / `src/data/product-catalog.json` | S | |
| `KEEP_PROBE` | `scripts/probe-bundle.mjs:74` | no | no | unset (= archive after probe) | S | |
| `KPI_RETENTION_DAYS` | `retention.ts:109` | yes (180) | no | 180 | O | also governs ai_usage, insights, persona summaries, mo_orders |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | `src/lib/redis.ts:24-25,60`; `rate-limit.ts:75` via `getRedis()` | yes | yes | none → `getRedis()` **throws** (`redis.ts:26-35`); `rate-limit.ts:2,75` uses the throwing variant | R (P) | `/api/chat`, `/api/products`, `/api/kpi`, `/api/tts`, `/api/feedback`, `/api/capture-email`, `/api/contact` all rate-limit → every one of them 500s without Redis. README:58 "fill in ANTHROPIC_API_KEY, OPENAI_API_KEY, CHAT_SHARED_SECRET at minimum" is therefore wrong for local dev |
| `MARKETING_DISCOUNT_EXPIRY_DAYS` | `shopify-discounts.ts:125` | yes (7) | no | 7 | O | |
| `MARKETING_DOI_EXPIRY_DAYS` | `email-capture-store.ts:42` | yes (7) | no | 7 | O | |
| `MARKETING_MIN_SEND_INTERVAL_DAYS` | `marketing-email.ts:122`, `campaign-email.ts:125` | yes (0) | no | 0 = disabled | O | |
| `MARKETING_ORDER_LOOKBACK_DAYS` | `shopify-orders.ts:62` | yes (180) | no | 180 | O | |
| `MODEL_PRICES_JSON` | `ai-pricing.mjs:100` | yes | yes | built-in `DEFAULT_MODEL_PRICES` | O | |
| `MO_ATTRIBUTION_WINDOW_DAYS` | `mo-orders-store.ts:55`, `retention.ts:131` | yes (30) | yes | 30 (min 1) | O | |
| `NEON_FETCH_ENDPOINT` | `src/lib/db.ts:24-25` | **no** | no | unset → Neon default endpoint | O (local dev only) | **Added by the current cleanup session** (uncommitted change in `db.ts`) as the local-dev hook pointing the Neon HTTP driver at a proxy in front of plain Postgres; not yet documented in `.env.example`/README (`db.ts:21-23` points to docs/DATABASE.md "Local database" — verify that section exists when documenting). Present in this sandbox's `.env.local`. |
| `NEXT_PUBLIC_SENTRY_DSN` | `observability.ts:77` | yes | yes | none → Sentry skipped, one-time warning | O (P) | |
| `NODE_ENV` | `admin-auth.ts:166` (cookie `secure`), `observability.ts:98` | no | no | — | P | |
| `OPENAI_API_KEY` | `retrieval.ts:122`, `catalog-mutate.ts:103`, `email-hero.ts:104`, `api/tts/route.ts:143`, `cron/sync-catalog/route.ts:199`; `scripts/build-embeddings.mjs:31`, `hero-quality-compare.mjs:71` | yes | yes | none → keyword-only retrieval, no TTS, no embeddings sync, no hero images | R (retrieval quality) | README:95 mentions only embeddings, not TTS/hero images |
| `PHYSICAL_LETTER_RETENTION_DAYS` | `retention.ts:115` | yes (365) | no | 365 | O | |
| `PHYSICAL_MAIL_SENDS_APPROVED` | `pingen-flag.mjs:25` (used by `physical-mail.ts`, `customer-refresh.ts:67`, `address-capture.ts:48`, `verify-pingen.mjs`) | yes (**true**) | no | false (fail-closed) | O (legal gate) | also gates postal-address *collection* |
| `PINGEN_CLIENT_ID` / `PINGEN_CLIENT_SECRET` / `PINGEN_ORGANISATION_ID` | `pingen.ts:45,51-52,68-69`; `scripts/verify-pingen.mjs` | yes | no | none → `isPingenConfigured()` false | R (letters) | |
| `PINGEN_LETTER_COST_CENTS` | `physical-letters-store.ts:76` | yes (106) | no | 106 | O | |
| `PINGEN_STAGING` | `pingen.ts:39`; `verify-pingen.mjs:26` | yes (**true**) | no | false = production | O | `.env.example` ships staging ON |
| `PINGEN_WEBHOOK_SECRET` | `api/webhooks/pingen/route.ts:24`; `verify-pingen.mjs:55` | yes | no | none → webhook 503 (fail closed); comma-separated list | R (letter status) | |
| `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` | `db.ts:32`; `migrate.mjs:27,29`; `reset-test-data.mjs:67,69` | c (comment only) | no | legacy fallbacks | P | |
| `PUBLIC_BASE_URL` | `base-url.ts:14`; `scripts/verify-customer-account.mjs:43` | yes | **no** | → `VERCEL_PROJECT_PRODUCTION_URL` → `VERCEL_URL` → request origin → `https://chat.motionsports.de` (`base-url.ts:27`) | R (correct links in e-mails / OAuth redirect) | README omits it; the hard-coded final fallback `chat.motionsports.de` vs the hero comment's `mo.motionsports.de` (`.env.example:471`) hints at a domain change — check which is live |
| `RESEND_API_KEY` | `email.ts:54,68`, `email-webhook.mjs:23` (placeholder), `api/contact/route.ts:150`, `api/inbound/resend/route.ts:144`, `api/admin/correspondence/message/route.ts:91` | yes | yes | none → all e-mail disabled | R (e-mail) | |
| `RESEND_EVENTS_WEBHOOK_SECRET` | `api/webhooks/resend/route.ts:23` | yes | no | falls back to `RESEND_WEBHOOK_SECRET`; none → 503 | O | new in #186 |
| `RESEND_WEBHOOK_SECRET` | `email-inbound.ts:23`, `api/webhooks/resend/route.ts:23` | yes | no | none → `/api/inbound/resend` 503 | R (inbound mail) | |
| `RETENTION_DAYS` | `retention.ts:108` | yes (180) | no | 180 | O | |
| `RETURNING_HINT_ENABLED` | `consent-copy.ts:81` | yes (true) | no | true; `0/false/no/off` disables | O | |
| `SHOPIFY_API_VERSION` | `shopify.ts:57,75`; 5 scripts | yes (2026-04) | yes | none → `isShopifyConfigured()` false; `env()` throws if called | R (Shopify) | |
| `SHOPIFY_APP_PROXY_SECRET` | `api/auth/storefront/route.ts:54` | **no** | no | falls back to `SHOPIFY_CLIENT_SECRET` | O | **undocumented** |
| `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` | `shopify.ts:73-74,83-84`; `api/auth/storefront/route.ts:54`; 5 scripts | yes | yes | none → Shopify disabled | R (Shopify) | |
| `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID` | `shopify-customer-account.ts:54`; `verify-customer-account.mjs:41` | yes | **no** | none → sign-in disabled | R (tier-3 sign-in) | |
| `SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET` | `shopify-customer-account.ts:59`; `verify-customer-account.mjs:42` | yes | no | none = public PKCE client | O | |
| `SHOPIFY_CUSTOMER_ACCOUNT_STATE_SECRET` | `shopify-customer-account.ts:91` | yes | no | falls back to `CHAT_SHARED_SECRET` | O | |
| `SHOPIFY_STOREFRONT_DOMAIN` | `shopify-customer-account.ts:64`; `verify-customer-account.mjs:44` | yes | no | `www.motionsports.de` | O | |
| `SHOPIFY_STORE_DOMAIN` | `shopify.ts:51,72`; 5 scripts | yes | yes | none | R (Shopify) | |
| `SHOPIFY_WEBHOOK_SECRET` | `api/webhooks/shopify/route.ts:55` | yes | **no** | none → webhook 503 (fail closed) | R (stock + order webhooks) | README's `MO_ATTRIBUTION_WINDOW_DAYS` row says orders webhooks must be registered but never lists the secret |
| `SUPPRESSED_CAPTURE_PURGE_DAYS` | `retention.ts:111` | yes (30) | no | 30 | O | |
| `TOKEN_ENC_KEY` | `token-crypto.ts:28` | yes | **no** | none → **throws** when a token must be stored (sign-in callback fails closed) | R (tier-3 sign-in) | |
| `TTS_INSTRUCTIONS` / `TTS_MODEL` / `TTS_SPEED` / `TTS_VOICE` | `api/tts/route.ts:26-29,48` | yes | no | German instruction / `gpt-4o-mini-tts` / 1.1 (clamped 0.25–4) / `coral` | O | |
| `TZ` | `admin-datetime.test.mjs`, `store-datetime.test.mjs` only | no | no | — | test-only | set by the tests themselves |
| `UNSUBSCRIBE_SECRET` | `email-capture-store.ts:347`, `email-countdown-token.mjs:14` | yes | no | falls back to `CHAT_SHARED_SECRET` | O | |
| `USD_EUR_RATE` | `ai-pricing.mjs:105` | yes (0.92) | yes | 0.92 (`:15`) | O | |
| `VERCEL_ENV` / `VERCEL_URL` / `VERCEL_PROJECT_PRODUCTION_URL` | `observability.ts:98`, `base-url.ts:17` | no | no | — | P | |

### 3.a Used in code but missing from `.env.example`

| Variable | Where | Severity |
|---|---|---|
| `ANALYTICS_REPORT_RETENTION_DAYS` | `src/lib/retention.ts:129` | medium — a GDPR-relevant retention knob that operators cannot discover |
| `CONVERSION_SWEEP_MAX_CODES` | `src/lib/conversion-sweep.ts:43` | low |
| `EMAIL_LOGO_URL` | `src/lib/email-template.ts:100`, `src/app/admin/EinstellungenTab.tsx:27` | low (shown in admin UI as an override, so it *is* user-facing) |
| `EMAIL_MO_ICON_URL` | `src/lib/email-template.ts:111` | low |
| `SHOPIFY_APP_PROXY_SECRET` | `src/app/api/auth/storefront/route.ts:54` | medium — security-relevant override; only discoverable in code |
| `NEON_FETCH_ENDPOINT` | `src/lib/db.ts:24-25` | just added by the current cleanup session (local-dev only); document alongside the local-DB setup |
| Platform / script-only (no action): `NODE_ENV`, `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING` (legacy, comment-only in `.env.example:394,398`), `ALLOW_DB_RESET`, `KEEP_PROBE`, `INPUT`, `OUTPUT`, `TZ` | | |

### 3.b In `.env.example` but never read by code (stale)

| Variable | `.env.example` line | Finding |
|---|---|---|
| `SHOPIFY_CUSTOMER_ACCOUNT_API_VERSION` | 292-294 | **No reference anywhere in `src/` or `scripts/`** (`rg` = 0 hits). The comment itself says the live version is read from discovery — the var is dead. Remove. |
| `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` (commented) | 361-367 | Documented as "consumed by the Sentry Next.js plugin for source-map upload during `next build`", but `next.config.ts` does **not** wrap with `withSentryConfig` and there are no `sentry.*.config.ts` / `instrumentation.ts` files — `@sentry/nextjs` is only `import()`ed lazily in `observability.ts:90`. No plugin runs, so these vars do nothing today; either wire the plugin or drop the paragraph. |
| `CONSENT_COPY_LAWYER_APPROVED` (referenced in comments at 142, 198) | — | Not an env var: it is a code constant `export const CONSENT_COPY_LAWYER_APPROVED = true` (`src/lib/consent-copy.ts:61`). The comments read as if it were a third env flag. |

Every other active key in `.env.example` (75 of 76) is read by code, and all numeric/string defaults shown in
`.env.example` match the code defaults (checked: DOI 7, discount 7, lookback 180, min-interval 0, refresh 25/24,
bundle 7, USD 0.92, retention 180/180/30/30/365/365/365/1095/730/365, attribution 30, pending-TTL 10, TTS model/voice/speed,
storefront domain, deep-link URL, hero model `gpt-image-2` / quality `high`, bundle mode).

### 3.c README ↔ `.env.example` inconsistencies

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
   (`sync-campaign-audience` missing). README:133 is generic and fine.
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
   example asset URL. One of the two hostnames is stale.
9. **README architecture tree** (203-230) lists 4 API routes and 12 libs; the repo has 149 route files and ~300 lib
   files. It is a 2026-Q1 snapshot; treat as historical.



---

# 6. Database, tests and documentation map

## 6.1 Database

### 4.1 Client pattern
`src/lib/db.ts`: `getSql()` returns a memoised Neon HTTP query function (`neon(DATABASE_URL || POSTGRES_URL)`) or **null** when no connection string is set (one warning logged). `isDbConfigured()` mirrors that. Every store takes `sql: Sql | null = getSql()` as its last parameter, returns a null-safe fallback (`[]`, `null`, `false`) when `sql` is null, wraps its query in try/catch and funnels errors through `reportError` (fail-soft house style). Queries are Neon tagged templates — **never composed** (fragments are not composable), dynamic GROUP BY is spelled out three times (see `getCampaignKpis`). `sql.transaction([...])` is used in three places (account-history erase, email-capture unsubscribe, conversation-store). `NEON_FETCH_ENDPOINT` (new, dev only) redirects the driver to a local Neon-protocol proxy.

### 4.2 Migrations (`migrations/0001…0055`, applied by `scripts/migrate.mjs`)
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

### 4.3 Tables (32 in the migrated schema) → owning store
| Table | Store file(s) |
|---|---|
| conversations, messages | conversation-store.ts, admin-conversations.ts, account-history.ts, kpi-store.ts, retention.ts (+ others read-only) |
| kpi_events | kpi-events.ts, kpi-store.ts, api/kpi route (raw insert) |
| email_captures, suppression_list | email-capture-store.ts, marketing-store.ts, retention.ts |
| marketing_sends | marketing-store.ts |
| customers, customer_session_links | customer-store.ts |
| customer_oauth_tokens, customer_auth_pending, customer_merge_conflicts | shopify-customer-account / customer-store |
| ai_usage | ai-usage-store.ts |
| bundle_offers | bundle-offers-store.ts |
| feedback | feedback-store.ts |
| email_messages | email-messages-store.ts |
| physical_letters | physical-letters-store.ts |
| admin_access_log | admin-access-log.ts |
| kpi_persona_question_summaries | kpi-top-questions.ts |
| conversation_insights, analytics_reports | admin-conversations.ts, analytics-report-store.ts |
| campaign_contacts, campaign_drafts, campaign_sends | campaign-store.ts (+ email-delivery-events.ts) |
| qa_entries | qa-store.ts |
| mo_orders, mo_attribution_tokens | mo-orders-store.ts |
| improvement_runs, improvement_suggestions | improvement-store.ts |
| mo_directives, mo_directive_versions | directives-store.ts |
| email_design_selections | email-design-store.ts |
| _migrations | scripts/migrate.mjs |
No table created by a migration is unreferenced (the two dropped ones — bestandskunden_suppression_list, email_templates/_assignments — are gone from the schema). 68 indexes exist; index coverage of the hot admin queries is reviewed in the technical audit.

## 6.2 Tests
87 `*.test.mjs` files, 813 tests, all green (`node --test`, 3.6 s). Every `.mjs` core has a sibling test except: `campaign-flags.mjs`, `email-rating.mjs`, `kpi-event-patterns.mjs`, `openai-error.mjs` (and the fixtures file `system-prompt-core.fixtures.mjs`). TypeScript modules are not unit-tested (tests cannot import TS); their pure logic lives in the `.mjs` cores by convention.

## 6.3 Docs map
| File | Lines | Last change | Class | Note |
|---|---|---|---|---|
| ADMIN_DASHBOARD.md | 959 | 2026-08-31 | LIVING | describes tabs/flows; partly stale (claims server-side tab switch; omits Einstellungen) — rewrite after redesign |
| API_CONTRACT.md | 1765 | 2026-08-16 | LIVING | widget contract (single source of truth) |
| CAMPAIGNS.md | 503 | 2026-09-08 | LIVING | campaign module |
| EMAIL_DESIGNS.md | 444 | 2026-09-08 | LIVING | e-mail design architecture (German) |
| BUNDLES.md, DISCOUNTS.md, CUSTOMERS.md, CUSTOMER_ACCOUNT.md, CONSENT_FLOW.md, DATA_RETENTION.md, DATABASE.md, CATALOG_SYNC.md, ORDER_ATTRIBUTION.md, IMPROVEMENT_LOOP.md, QA_KNOWLEDGE.md, PROMPT_CACHING.md | — | Aug 2026 | LIVING | feature references; light updates needed |
| REPURCHASE_ANALYSIS.md | 117 | 2026-09-01 | LIVING (reference) | cited by campaign segment logic |
| ANWALTSDOSSIER.md | 326 | 2026-08-05 | LIVING (legal) | German dossier for counsel |
| frontend-handoff/* (7 files) | — | Aug 2026 | LIVING (contracts) | frontend-handoff/API_CONTRACT.md duplicates docs/API_CONTRACT.md (1664 vs 1765 lines) |
| AUDIT_BACKEND.md, COMPLETENESS_AUDIT.md, REPO_AUDIT.md | — | 2026-08-05 | HISTORICAL | June 2026 audits |
| BUNDLES_SPIKE.md, CUSTOMER_ACCOUNT_SPIKE.md, EMAIL_SUBSYSTEM_SPIKE.md | — | 2026-08-05 | HISTORICAL | feasibility spikes (code comments still cite "§4/§5" of the e-mail spike) |
| CATALOG_SYNC_DIAGNOSIS.md | 289 | 2026-08-05 | HISTORICAL | June 2026 incident diagnosis |
| CHANGE_REPORT_10E-1.md, CHANGE_REPORT_I18N_EN.md, CHANGE_REPORT_ROUND9.md | — | 2026-08-05 | HISTORICAL | change reports |
| CUSTOMER_ACCOUNT_THEME_NOTES.md, GDPR_REMEDIATION_HANDOFF.md | — | 2026-08-05 | HISTORICAL | handoff notes |
| LEGAL_READINESS_REPORT.md | 429 | 2026-08-05 | HISTORICAL | marked superseded by ANWALTSDOSSIER |
| PRODUCT_VARIANTS_PLAN.md | 239 | 2026-08-16 | HISTORICAL | plan marked "implemented" |
| CLEANUP_AUDIT.md, FEATURE_INVENTORY.md | — | 2026-09-08 | PROJECT | this clean-up |
README.md (root): deploy checklist is living; the architecture tree lists 4 routes / 12 libs (2026-Q1 snapshot) — stale.
