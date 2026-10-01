# Feature inventory — verification status (Phase 3)

Date: 2026-09-09 · Baseline: [`FEATURE_INVENTORY.md`](./FEATURE_INVENTORY.md) (`main` @ `9c6b551`, 398 admin
items SHL/LOG/UEB/KUN/KAM/KPI/FEE/GES/WIS/ANA/VER/EIN) · Verified against `main` @ `09e4284` (after the twelve
slices of the redesign, see [`CLEANUP_AUDIT.md`](./CLEANUP_AUDIT.md) §0).

**How each item was verified.** (1) Code check: every control, label, route call and state of the inventory row
was located in the redesigned source (`src/app/admin/**`); renamed labels are noted. (2) Playwright interaction
tests per screen against the production build with the seeded local database (login, navigation, shortcuts, filters,
dialogs, mutations against the guarded routes). (3) Screenshots of every screen in light and dark, plus tablet
width for the four wide screens: [`screenshots/before/`](./screenshots/before/) vs
[`screenshots/after/`](./screenshots/after/) (same file names, `index.json` in each folder).

Legend: ✅ kept — same capability, same or equivalent control · 🔁 kept, changed form — capability intact, the
control, placement or wording changed (what) · ➕ new · ❌ removed (with the decision reference). No item was
removed without a decision; the only removals are the five unused API routes and one throwaway script of
decision D-9.

| Screen | Items | ✅ | 🔁 | ➕ (new, not in the baseline) | ❌ |
| --- | --- | --- | --- | --- | --- |
| Shell | 16 | 9 | 7 | badges, shortcut sheet, `0` shortcut, `?tab=marketing` alias | 0 |
| Login | 7 | 5 | 2 | rate limit + message | 0 |
| Übersicht | 15 | 8 | 7 | „Heute“ cards | 0 |
| Kunden | 107 | 89 | 18 | on-demand detail, `?customer=`, tier InfoTips, inbox badge | 0 |
| Kampagne | 69 | 51 | 18 | inline progress, A/B counts, paged history with delivery state, Kbd hints | 0 |
| KPIs | 70 | 62 | 8 | group navigation, Shopify cache + „Aktualisieren“, `?kpiFresh=` | 0 |
| Feedback | 8 | 6 | 2 | newsletter badge | 0 |
| Gespräche | 42 | 35 | 7 | `?gid=`, active-filter chips | 0 |
| Wissen | 18 | 15 | 3 | search, expand-in-place, `j`/`k`, „Gespräch #n“ link | 0 |
| Analyse | 14 | 12 | 2 | `?report=` | 0 |
| Verbesserung | 26 | 25 | 1 | `?run=`, labelled icon buttons | 0 |
| Einstellungen | 6 | 5 | 1 | Systemstatus card (D-5) | 0 |

### Update 2026-10-01 — customer platform

Verified against `main` @ `943a313` (migrations 0061–0068, plan
[`CUSTOMER_PLATFORM_PLAN.md`](./CUSTOMER_PLATFORM_PLAN.md)). (1) Code check of every touched row and every new route
against `git diff d48ad77..HEAD`; (2) `npm test` 1016 green (116 files); (3) screenshots of the changed screens at 1440 and 1024 px
in light and dark: [`screenshots/customer-platform/`](./screenshots/customer-platform/). Touched rows below are
updated in place and marked **2026-10**; new items carry the new IDs of the inventory (`EIG-…`, `KUN-113…`,
`KAM-96…`, `KPI-71…`, `EIN-07…`, `GES-43`). In this update ❌ means **retired with a named replacement**; „Plan D-n“ is a
decision of the plan. One retirement has no replacement yet: the Kunden bulk-draft bar (plan §18 maps it to
„Zu Einzelansprache hinzufügen…“ on a selection, which is not built) — **open, needs a maintainer decision**.

| Screen | Touched | ✅ | 🔁 | ➕ (new) | ❌ (retired → replacement) |
| --- | --- | --- | --- | --- | --- |
| Shell | 5 | 0 | 4 | Eingang + Kampagnen badges, `?item=`/`?status=` (Eingang), `k*` (Kunden), `?campaign=`/`?edit=`, aliases `overview`, `kampagnen` | 1 — SHL-14 Kunden `?filter=` → `?kview=` |
| Übersicht → **Eingang** | 15 | 0 | 15 — moved to Eingang, Kunden, KPIs (Plan D-9) | EIG-01…13 | 0 (the screen itself is retired) |
| Kunden | 80 | 2 | 65 (incl. KUN-50…84: the per-customer mail and set composer only in an open draft of the former path, Plan D-8) | KUN-113…132 (server-side list, views, Überblick, Aktivität, ledger, one consent, Einzelansprache, objections, „Wahrscheinlich als Nächstes“, „Frag Mo“) | 13 — Tier/Kauf/Versand filters, `?filter=` presets, purchase/send badges, bulk-draft bar (open, see above) |
| Kampagne → **Kampagnen** | 11 (+ 5 post-baseline desk items) | 2 | 8 (+ KAM-75, 77, 87, 91, 92) | KAM-96…106 (overview, editor, live count, AI assist, desk per campaign, Einzelansprache, send gate) | 1 — „Sync“ → „Zielgruppe aktualisieren“ |
| KPIs | 5 | 0 | 5 | KPI-71 Kampagnen im Vergleich, KPI-72 Eingang, KPI-73 Kundenbasis, KPI-74 Mo-Effekt | 0 |
| Gespräche | 0 | — | — | GES-43 „Kunde öffnen“ on identified conversations | 0 |
| Einstellungen | 0 | — | — | EIN-07…11 Shopify-Abgleich (incl. Erstabgleich) | 0 |

---

## 0. Shell (SHL)

| ID | Status | Note |
| --- | --- | --- |
| SHL-01 | 🔁 | The top bar shows the **screen title** („Übersicht“, „Kunden“, …); the brand block „motion sports · Admin · Mo“ sits above the sidebar. **2026-10:** first screen „Eingang“ (brand link aria „motion sports Admin — Eingang“). |
| SHL-02 | 🔁 | The ten tab subtitles are the `description`s in `src/lib/admin-tabs.mjs` and appear verbatim in the InfoTip next to the title (UX-G4). **2026-10:** new texts for Eingang and Kampagnen (inventory §0). |
| SHL-03 | ✅ | Theme toggle, same cookie `ms_admin_theme`, same aria-labels; Tooltip instead of `title`. |
| SHL-04 | ✅ | „Abmelden“ server action unchanged. |
| SHL-05 | 🔁 | Flat pill row → grouped sidebar (Arbeit · Einblicke · System) with the same labels and `?tab=` keys; every screen is a real (soft) navigation (D-2/D-3); icon rail on tablet, drawer below; ➕ badges (Kampagne queue, Posteingang, offene Fragen). **2026-10:** Eingang replaces Übersicht, „Kampagne“ → „Kampagnen“ (key `kampagne`); badges Eingang (open items with priority ≥ 80), Kampagnen (drafts over active campaigns), Wissen — the Kunden Posteingang badge is gone (the mails are a card in the Eingang, not counted in a badge). |
| SHL-06 | ✅ | `1…9` unchanged; ➕ `0` reaches Einstellungen (the gap noted in the inventory is closed); ➕ shortcut sheet in the top bar (UX-G11). |
| SHL-07 | ✅ | `/` focuses `#ms-search` on Kunden. |
| SHL-08 | 🔁 | One fluid content area; screens flagged `wide` use the full width, prose screens an inner max width (UX-G3). |
| SHL-09 | ✅ | Toaster unchanged (`toast.update` still drives live progress). |
| SHL-10 | ✅ | Theme is applied on the server from the cookie (no flash); `prefers-color-scheme` fallback kept. |
| SHL-11 | 🔁 | `Callout` inside the Kunden screen. |
| SHL-12 | 🔁 | `EmptyState` inside the list; search and filters stay visible (UX-G5). |
| SHL-13 | 🔁 | `?tab=` incl. legacy `customers`; ➕ `marketing` alias. **2026-10:** default `eingang`; ➕ aliases `overview` → Eingang, `kampagnen` → Kampagnen. |
| SHL-14 | ❌ | `?filter=no_purchase\|marketing\|draft`, legacy `?status=`. **2026-10:** the server-side Kunden list no longer reads `?filter=`/`?status=` (old links open the unfiltered list) → views `?kview=` + `k*` params (KUN-115…118); `?status=` now belongs to the Eingang. |
| SHL-15 | ✅ | `?kpiRange`, `?kpiFrom`, `?kpiTo`; ➕ `?kpiFresh=`. |
| SHL-16 | ✅ | `grange, gfrom, gto, gtier, gerr, gcat, gqual, gq, gpage` parsed by the tested `admin-conversation-filter.mjs`; ➕ `gid`. |

## 1. Login (LOG)

| ID | Status | Note |
| --- | --- | --- |
| LOG-01 | 🔁 | Brand mark „M“ + title. |
| LOG-02 | ✅ | |
| LOG-03 | ✅ | `Callout` (warning). |
| LOG-04 | ✅ | „Falsches Passwort.“ / „Server nicht konfiguriert …“; ➕ „Zu viele Anmeldeversuche — bitte in zehn Minuten erneut versuchen.“ |
| LOG-05 | ✅ | Same input attributes. |
| LOG-06 | 🔁 | Same action; ➕ rate-limited 10 / 10 min per IP (TECH-C4), fails open without KV. |
| LOG-07 | ✅ | `?error=invalid|config`; ➕ `ratelimited`. |

## 2. Übersicht (UEB)

> **2026-10-01: screen retired (Plan D-9) → Eingang** (`?tab=overview` resolves to it). Every row below is 🔁 —
> the capability lives on in the Eingang (EIG-…), Kunden or KPIs; mapping in the inventory §2.

| ID | Status | Note |
| --- | --- | --- |
| UEB-01 | 🔁 | `Callout`. **2026-10** → EIG-01. |
| UEB-02 | 🔁 | Section „Überblick“ → „Letzte 30 Tage“ (window in the title, UX-U3). **2026-10** → Eingang strip „letzte 30 Tage“ (EIG-02). |
| UEB-03 | 🔁 | „Chats gesamt“ → „Beratungen“ (same `getCoreMetrics` number). **2026-10** → strip „Gespräche“ (EIG-02). |
| UEB-04 | 🔁 | „Marketing-Kontakte“ — now a database aggregate (D-1) with „Liste öffnen“. **2026-10** → Kunden header „mit Einwilligung“ (KUN-113, opens the view), KPI Kundenbasis (KPI-73). |
| UEB-05 | 🔁 | „Beraten, nicht gekauft“ — database aggregate over the cached purchase history (D-1) with „Liste öffnen“. **2026-10** → Kunden view „Mit Mo gesprochen“ + Lebenszyklus „Ohne Bestellung“; Eingang kind „Kaufabsicht ohne Kauf“. |
| UEB-06 | 🔁 | „Gesendet (30 T.)“ → „E-Mails gesendet“ with the Kampagne · Marketing split. **2026-10** → strip „Kampagnen-Mails“ (campaign sends only; the split ends with Plan D-8). |
| UEB-07 | 🔁 | „Ø Kosten / Beratung“. **2026-10** → KPIs only (KPI-50). |
| UEB-08…12 | 🔁 | „Schnellzugriff“ → the „Heute“ cards (Kampagne, Posteingang, Wissen, Analysen) plus the linked stats and „KPIs öffnen“ — same targets (`?tab=kunden&filter=no_purchase`, `…&filter=marketing`, `?tab=kunden`, `?tab=kpi`) built with `adminTabHref` (UX-U1). **2026-10** → Eingang system strip: drafts per active campaign (links `?campaign=`), open Wissen questions, running analyses / improvement runs, Shopify sync warning, „Alle KPIs“ (EIG-02); unmatched mails → EIG-12. |
| UEB-13 | 🔁 | „Letzte Aktivität“. **2026-10** → per person: Kunden „Aktivität“ (KUN-123). |
| UEB-14 | 🔁 | „Zuletzt gesendet“ now covers Kampagne **and** Marketing sends (channel badge); empty text „Noch keine E-Mails versendet.“ **2026-10** → strip count „Kampagnen-Mails“ + per person Aktivität / Marketing „Kampagnen“ (KUN-126); the global feed is gone. |
| UEB-15 | 🔁 | „Zuletzt bestätigt (DOI)“ — now actually populated (TECH-C8 fix). **2026-10** → strip „neu angemeldet“ + per person the consent history (KUN-127). |

## 2a. Eingang (EIG) — new 2026-10-01

| ID | Status | Note |
| --- | --- | --- |
| EIG-01…02 | ➕ | DB callout; system strip (drafts per campaign, Wissen, running analyses, 30-day strip, Shopify sync warning) — the former Übersicht. |
| EIG-03…05 | ➕ | Status `SegmentedControl` (`?status=`), kind select, „Jetzt prüfen“ (`inbox/run`), list grouped Jetzt / Diese Woche / Später. |
| EIG-06…08 | ➕ | Detail with evidence, customer mini-card (`inbox/item`), AI suggestion (`inbox/suggest`, re-checked against consent / objections). |
| EIG-09…11 | ➕ | „Entwurf übernehmen“ → Einzelansprache draft (`inbox/accept`), Erledigt / Später 3·7·30 / Verwerfen with reason (`inbox/decide`), keys `J K Enter E Z D Esc`. |
| EIG-12 | 🔁 | KUN-01…04 moved here: unmatched mails with a customer search over the whole base instead of the preselected „(passende Adresse)“. |
| EIG-13 | ➕ | Signal kinds and rules (`customer-signals.mjs`, tested), hourly job `/api/cron/inbox`. |

## 3. Kunden (KUN)

| ID | Status | Note |
| --- | --- | --- |
| KUN-01…04 | 🔁 | Posteingang card (collapsible, count badge), sender badge, „Kunde wählen…“ with „(passende Adresse)“, „Zuordnen“ → `correspondence/assign`; ➕ sidebar badge. **2026-10:** moved to the Eingang („E-Mails nicht zugeordnet“, `eingang/UnmatchedInbound.tsx`, EIG-12); customer search instead of the preselection; the sidebar badge is gone. |
| KUN-05 | ✅ | `#ms-search`, `/` shortcut. **2026-10:** server-side search (`?kq=`, 350 ms). |
| KUN-06…09 | ❌ · 🔁 | Tier / Marketing / Kauf / Versand selects in a `FilterBar` (same options). **2026-10:** Marketing 🔁 → „Einwilligung“ (one consent, KUN-116); Tier ❌ → „Shop“ + „Mo“ (KUN-117; tier stays in Gespräche); Kauf ❌ → „Lebenszyklus“ incl. „Ohne Bestellung“; Versand ❌ → Einzelansprache desk + Marketing „Kampagnen“ (Plan D-8). |
| KUN-10 | 🔁 | Sort options; „Meiste Sessions“ → „Meiste Beratungen“. **2026-10:** Zuletzt aktiv / Umsatz / Bestellungen / Letzter Kauf / Name A–Z / Neueste zuerst (`?ksort=`); „Älteste zuerst“ and „Meiste Beratungen“ gone. |
| KUN-11, 12 | 🔁 | Counter; „Zurücksetzen“ from the `FilterBar`. **2026-10:** „N Personen“ (total hits); reset returns to the chosen view. |
| KUN-13 | ❌ | Tri-state „Alle N bestätigten auswählen“ + InfoTip. **2026-10:** retired with the bulk-draft bar (see KUN-25…29). |
| KUN-14 | ❌ | `?filter=` presets seed the filter; ➕ `?customer=` opens a person. **2026-10:** `?filter=` no longer read → `?kview=` views (KUN-115); `?customer=` kept. |
| KUN-15, 16 | ✅ · ❌ | Row (`role=button`, Enter/Space), per-row checkbox. **2026-10:** row kept (button, KUN-119); checkbox ❌ (bulk-draft bar retired). |
| KUN-17 | 🔁 | Name / e-mail / tier badge — tier badge explains itself in an InfoTip (UX-K2). **2026-10:** tier badge → Shop/Interessent + Mo badges (KUN-119). |
| KUN-18…21 | 🔁 · ❌ | `StatusBadge`s Marketing / DOI offen / Abgemeldet / gekauft / nicht gekauft / Entwurf / Gesendet. **2026-10:** Marketing 🔁 → `ConsentBadge`; gekauft 🔁 → „n × · Umsatz“ + Lebenszyklus; nicht gekauft ❌ → „Ohne Bestellung“ / Eingang „Kaufabsicht ohne Kauf“; Entwurf / Gesendet ❌ → Marketing „Kampagnen“. |
| KUN-22 | ✅ | Relative date (`relativeDay`). |
| KUN-23 | 🔁 | `EmptyState` in the list. |
| KUN-24 | ✅ | |
| KUN-25…29 | ❌ | Bulk bar: count, `#ms-bulk-depth`, Textmodus (shared `SegmentedControl`), „Auswahl aufheben“, „Entwürfe erstellen“ with live toast and pool of 4. **2026-10:** retired with the 1:1 marketing path (Plan D-8). Plan §18 maps it to „Zu Einzelansprache hinzufügen…“ on a selection — **not built; open**. Today: many people → a campaign with an audience + „Vorbereiten…“ (KAM-96…103); one person → Einzelansprache (KUN-125). |
| KUN-30…33 | 🔁 | Header: name/e-mail, „Zuerst … · Zuletzt …“, tier badge, „N×“ returning badge, marketing status badge. **2026-10:** Shop/Interessent + Mo badges, tier only for tier 3, long `ConsentBadge`; no-consent strip below (KUN-120, KUN-130). |
| KUN-34 | 🔁 | Six sub-tabs (roving focus); counts on Beratungen / Korrespondenz / Brief. **2026-10:** seven — Überblick · Aktivität · Käufe · Gespräche · Marketing · Korrespondenz · Brief (counts on Käufe, Gespräche, Korrespondenz, Brief). |
| KUN-35…38 | 🔁 | Profil: „Kundenverständnis“, „Stand“, generate/regenerate, Markdown, token/cost line. **2026-10:** inside „Überblick“; badge Vollprofil / Kaufprofil; button hidden without permission (`CUSTOMER_AI_PROFILE_SCOPE`, Art. 21 objection — KUN-129). |
| KUN-39…41 | 🔁 | Beratungen timeline; empty state „Keine Beratung verknüpft“. **2026-10:** tab label „Gespräche“. |
| KUN-42 | ✅ | Transcript dialog now rendered by the shared `TranscriptView` (markdown, timestamps, tool chips); ➕ „Im Gespräche-Tab öffnen“ (UX-K4). |
| KUN-43…48 | 🔁 | Käufe: „Stand“, „Käufe aktualisieren“, table on `ui/table`, status badges, empty states, „gekürzt“ hint. **2026-10:** only before a person is mirrored; mirrored customers see the order ledger „Bestellungen“ (KUN-124). |
| KUN-49 | 🔁 | Three blocking `Callout` variants. **2026-10:** the block note follows the one consent (not subscribed / pending / unsubscribed / blocked). KUN-50…70 (the per-customer marketing mail) remain only for an **open draft of the former path** (Disclosure „Persönliche E-Mail (bisheriger Weg) — offener Entwurf“); new 1:1 mails go through the Einzelansprache (KUN-125, Plan D-8). |
| KUN-50 | 🔁 | Section title shortened; the explanation is the InfoTip. **2026-10:** only in an open draft of the former 1:1 path (see KUN-49 / KUN-71). |
| KUN-51, 52 | 🔁 | „Gesendet am …“ badge + „Gesendeten Text anzeigen“ `Disclosure`. **2026-10:** only in an open draft of the former 1:1 path (see KUN-49 / KUN-71). |
| KUN-53 | 🔁 | Set-Angebot composer is its own section with header and count (below the draft). **2026-10:** only in an open draft of the former 1:1 path (see KUN-49 / KUN-71). |
| KUN-54…56 | 🔁 | „Besondere Hinweise (optional)“ (2000), „Rabatt (%)“ (0–50, InfoTip), Textmodus — grouped in one settings row (UX-K3). **2026-10:** only in an open draft of the former 1:1 path (see KUN-49 / KUN-71). |
| KUN-57…59 | 🔁 | Draft badge, regenerate lockout warning + „Neu generieren“, placeholder hint. **2026-10:** only in an open draft of the former 1:1 path (see KUN-49 / KUN-71). |
| KUN-60…62 | 🔁 | „Betreff“, „E-Mail-Text“, „Automatisch ergänzt beim Versand“ hint. **2026-10:** only in an open draft of the former 1:1 path (see KUN-49 / KUN-71). |
| KUN-63 | 🔁 | `HeroImagePanel` (kind=marketing). **2026-10:** only in an open draft of the former 1:1 path (see KUN-49 / KUN-71). |
| KUN-64 | 🔁 | „Speichern“ → `marketing/update`. **2026-10:** only in an open draft of the former 1:1 path (see KUN-49 / KUN-71). |
| KUN-65 | 🔁 | „Vorschau“ (`EmailPreviewButton`, Desktop/Mobil). **2026-10:** only in an open draft of the former 1:1 path (see KUN-49 / KUN-71). |
| KUN-66 | 🔁 | „Freigeben & senden“ → `ConfirmDialog` showing recipient, subject and discount (UX-K5) instead of `window.confirm`; same update + send calls; lockout kept. **2026-10:** only in an open draft of the former 1:1 path (see KUN-49 / KUN-71). |
| KUN-67 | 🔁 | „Entwurf löschen“ → `useConfirm`. **2026-10:** only in an open draft of the former 1:1 path (see KUN-49 / KUN-71). |
| KUN-68 | 🔁 | „Der Entwurf nutzt ALLES …“ → InfoTip. **2026-10:** only in an open draft of the former 1:1 path (see KUN-49 / KUN-71). |
| KUN-69 | 🔁 | Generate / regenerate. **2026-10:** only in an open draft of the former 1:1 path (see KUN-49 / KUN-71). |
| KUN-70 | 🔁 | Helper sentence after a send removed; the generate button stays available (capability intact). **2026-10:** only in an open draft of the former 1:1 path (see KUN-49 / KUN-71). |
| KUN-71 | 🔁 | Composer header „Set-Angebot (Bundle) · N“. **2026-10:** KUN-71…84 only inside the open draft of the former path; sets for the Einzelansprache are built on the desk (KAM-82). |
| KUN-72…80 | 🔁 | „Set vorschlagen“, component list + remove, „Komponentensumme“, `CatalogProductPicker`, „Set-Preis“, „Titel“, „Gültig (Tage)“, price warning, „Set erstellen“ (2–5, sold-out error). **2026-10:** only in an open draft of the former 1:1 path (see KUN-49 / KUN-71). |
| KUN-81 | 🔁 | Bundle list with `StatusBadge`s, „Klick erfasst“, expiry. **2026-10:** only in an open draft of the former 1:1 path (see KUN-49 / KUN-71). |
| KUN-82, 84 | 🔁 | „Löschen“ / „Archivieren“ → `useConfirm`. **2026-10:** only in an open draft of the former 1:1 path (see KUN-49 / KUN-71). |
| KUN-83 | 🔁 | „Angebots-Link“. **2026-10:** only in an open draft of the former 1:1 path (see KUN-49 / KUN-71). |
| KUN-85…89 | ✅ | Korrespondenz: counter, „Neue E-Mail“, composer header, „Betreff“ (Re: prefill), „Nachricht“ (20000). |
| KUN-90 | 🔁 | „Senden“ → `useConfirm`; „Leerer Text“ warning kept. |
| KUN-91…96 | ✅ | Preview, cancel, empty state, thread cards + „Antworten“, lazy body (`Spinner` „Inhalt wird geladen“), expanded meta + attachments. |
| KUN-97…103 | ✅ | Brief: header, generate, „Hinweise für den Brief“, „Briefbetreff“, „Brieftext“, save, „Vorschau aktualisieren“ (PDF blob). |
| KUN-104 | 🔁 | „Brief senden“ → `useConfirm`; disabled reason shown as text. |
| KUN-105…107 | ✅ | PDF iframe „Brief-Vorschau“, reason text, letter history with status badges and „Porto“. |
| KUN-108…112 | 🔁 | Post-baseline items: „Herkunft“ filter ❌ → Shop + Mo; source badge → Shop/Mo badges; profile facts in Überblick; erasure dialog names the Shopify side; Werbe-Einwilligung → the one consent with source and history. |
| KUN-113…119 | ➕ | Server-side list over `customer_overview`: header counts, „noch nicht übernommen“ callout, views (`?kview=`), Einwilligung / Lebenszyklus, „Weitere Filter“ (Mo, Wert, Persona, Shop, Abwanderung), search / sort / 50-row pages in the URL, rows with Shop / Mo / consent / segment / churn badges. |
| KUN-120…124 | ➕ | No-consent strip; Überblick (Kennzahlen from `customer_facts`, Datenquellen, Shopify tags, „Sprache für E-Mails“); Aktivität timeline; Käufe from the ledger. |
| KUN-125…130 | ➕ | Marketing: Einzelansprache, campaign participation, consent history; Brief: Art. 21 objection (and the objection notice in every letter's footer); profile depth + objection; new header. |
| KUN-131, 132 | ➕ | Überblick „Wahrscheinlich als Nächstes“ (complements of what the person owns); Aktivität „Frag Mo“ (question about the person, answered from the record with cited sources, `customers/ask`). |

## 4. Kampagne (KAM) — heavy daily use, every behaviour kept

> **2026-10-01:** the screen is „Kampagnen“: an overview of many campaigns (0066) and the same review desk per
> campaign (`?campaign=`). Every desk behaviour below is kept, now scoped to one campaign.

| ID | Status | Note |
| --- | --- | --- |
| KAM-01…03 | ✅ | `Callout`s (DB, „Versand gesperrt“, „Shopify ist nicht konfiguriert“). **2026-10:** Shopify text without „Sync“ („… Rabattcodes und Set-Angebote sind deaktiviert.“). |
| KAM-04 | ✅ | Stat strip incl. „Unterdrückt“ and „Entwurf fehlgeschlagen“ (only > 0); ➕ A/B hero counts (UX-C6). |
| KAM-05 | ✅ | Opt-in summary + InfoTip. |
| KAM-06 | ❌ | „Sync“ — result applied to the state, no page reload (UX-G9). **2026-10:** retired with the Shopify subscriber sync (`campaign/sync`, `campaign-sync.ts`) → „Zielgruppe aktualisieren“ (KAM-102, `campaigns/refresh`); Shopify data arrive through the mirror (EIN-07). |
| KAM-07, 08 | ✅ | Rabatt / Textmodus selects in the toolbar; hint in an InfoTip. |
| KAM-09 | 🔁 | „Nächste 50 vorbereiten“ — same `campaign/prepare` chunks, inline progress bar with cancel, results applied without reload (UX-C4). |
| KAM-10, 11 | 🔁 | „Warteschlange neu aufbauen“ moved to the right edge of the toolbar (rare, destructive), `ConfirmDialog` „Entwürfe verwerfen“. |
| KAM-12, 13 | ✅ | „Warteschlange“ / „Gesendet“ tabs with counts. |
| KAM-14 | ✅ | Opt-in filter as `SegmentedControl` (Alle / Nur DOI / Nur Single/Unbekannt). |
| KAM-15, 16 | ✅ | Shortcut hint as `Kbd` row; `N P V C S X` unchanged. |
| KAM-17…22 | 🔁 | Global contact search (≥ 2 chars, debounced) with „Öffnen“ / „Entwurf erstellen“ / „Wiederherstellen“ and status badges. **2026-10:** searches the open campaign's recipients (`campaignId`). |
| KAM-23…25 | ✅ | Queue rail with ⚠ (Tooltip), „Übersprungen“ `Disclosure` + „Wiederherstellen“. |
| KAM-26 | 🔁 | `EmptyState`. **2026-10:** text names „Vorbereiten…“ and „Zielgruppe aktualisieren“ (Einzelansprache: where people come from). |
| KAM-27…29 | ✅ | „Entwurf i von N“, „Zurück“ / „Weiter“, name + e-mail. |
| KAM-30 | ✅ | DE/EN `SegmentedControl` (override marker kept) → `campaign/language` + regenerate. |
| KAM-31 | ✅ | Textmodus toggle → regenerate. |
| KAM-32…36 | ✅ | Opt-in, segment, A/B, „Empfehlungen unsicher“ badges (Tooltips instead of `title`), orders/revenue line. |
| KAM-37…43 | 🔁 | „Kaufhistorie“ is a collapsible group with a summary in its header (UX-C3); content, tri-state „Alle“, „Empfehlungen & Text neu erzeugen“, „Verwerfen“ unchanged. |
| KAM-44…46 | ✅ | „Empfohlene Produkte“ group (open by default): list, remove, picker (max 6, variants). |
| KAM-47…49 | 🔁 | „Rabatt“ collapsible group with summary; input, „Übernehmen“, MK-code hint unchanged. |
| KAM-50…54 | 🔁 | „Set-Angebot“ collapsible group; attached set, „Set entfernen“, composer, „Set aus Empfehlungen erstellen“ unchanged. |
| KAM-55, 56 | ✅ | Subject/body autosave (debounced `campaign/update`); body textarea in the body font with an inline „Text · Vorschau“ switch (UX-C2). |
| KAM-57 | ✅ | `HeroImagePanel` (kind=campaign). |
| KAM-58 | ✅ | „Erneute Einwilligung erforderlich“ `Callout`. |
| KAM-59, 60 | ✅ | „Senden“ (disabled when blocked), first-send-of-day dialog (`localStorage` `ms-campaign-first-send`), auto-advance. |
| KAM-61…65 | ✅ | „Vorschau“, „Kopieren“ (MO-XXXX warning), „Als erledigt markieren“, „Neu generieren“, „Überspringen“. **2026-10:** „Als erledigt markieren“ refuses a person without consent or with a blocked address (409). |
| KAM-66 | ✅ | `EmailViewerDialog` (95vw × 92vh, Desktop/Mobil). |
| KAM-67 | 🔁 | `EmptyState`. |
| KAM-68 | 🔁 | „Gesendet“ is paged and searchable (e-mail/subject, date range) with a „Zustellung“ column from the Resend webhook; redemption looked up for the visible page only (`GET campaign/history`; UX-C5, TECH-C3/E6). Columns Empfänger / Betreff / Via / Code / Eingelöst / Gesendet / Inhalt kept. **2026-10:** per campaign (`campaignId`). |
| KAM-69 | ✅ | „Ansehen“ → `campaign/sent-email`. |
| KAM-70…95 (desk, post-baseline) | 🔁 | **2026-10:** KAM-75 „Sync vor …“ → „Zielgruppe vor …“; KAM-77 menu „Zielgruppe aktualisieren“ + „Kampagne bearbeiten“; KAM-87 delivery strip per campaign; KAM-91 nightly prepare = budget across campaigns (`planAutoPrepare`); KAM-92 test contacts per campaign. |
| KAM-96…100 | ➕ | Kampagnen overview (Aktuell / Alle / Archiv, cards with phase, audience text, figures, status actions with confirms), editor sheet (`?edit=`), live audience count, AI „Briefing vorschlagen“ / „Filter setzen“. |
| KAM-101…103 | ➕ | Desk per campaign (`?campaign=`, switcher, phase), „Zielgruppe aktualisieren“, Vorbereiten defaults from the campaign's offer (per campaign in localStorage). |
| KAM-104…106 | ➕ | Einzelansprache system campaign; campaign brief / end date / design / hero mode / CTA in drafts and mails; send gate campaign live → master flag → consent → opt-in → suppression → cadence. |

## 5. KPIs (KPI) — every number and every caveat kept

| ID | Status | Note |
| --- | --- | --- |
| KPI-01 | 🔁 | `Callout`. |
| KPI-02…06 | 🔁 | Sticky `KpiToolbar`: presets as `SegmentedControl` (7 / 30 / 90 Tage), „Zeitraum…“ opens the Von/Bis inputs + „Anwenden“, same URL params; ➕ in-page group navigation, ➕ „Shopify-Daten: Stand hh:mm · Aktualisieren“ (D-4). |
| KPI-07 | 🔁 | Period hint → InfoTip on the toolbar. |
| KPI-08…16 | ✅ | Kern-Metriken: stats, „Chats pro Tag“ area chart, „Status-Verteilung“ donut, In-Chat-Klicks, „Event-Übersicht (Top 20)“, empty state. |
| KPI-17, 18 | ✅ | Sprachen (DE/EN). |
| KPI-19…21 | ✅ | Gesprächsqualität. |
| KPI-22…25 | ✅ | Consent-Gate-Funnel incl. „Nach Oberfläche“. |
| KPI-26…29 | ✅ | E-Mail-Capture-Funnel incl. „Angebote nach Auslöser“. |
| KPI-30, 31 | ✅ | Umsatz über Mo-Rabattcodes — served from the 10-minute cache with a freshness badge. |
| KPI-32, 33 | ✅ | Mo-zugeordneter Umsatz. |
| KPI-34…38 | 🔁 | Kampagnen-Funnel incl. „Hero-Vergleich“ and „Nach Lebenszyklus-Segment“ tables (on `ui/table`); cached. **2026-10:** covers every campaign (recipients = customers with consent); the section title still reads „(Shopify-Subscriber)“. |
| KPI-39…48 | ✅ | Bundle-Angebote, Wissen-KPIs, Feedback, Kundenkonto & Self-Service. |
| KPI-49…54 | ✅ | KI-Kosten incl. „Nach Einsatzort“ and „Prompt-Caching (Chat)“. |
| KPI-55 | 🔁 | Divider label → „Gesamtwerte“ group heading in the navigation plus a „Gesamt“ badge on each lifetime section. |
| KPI-56, 57 | ✅ | Postversand. |
| KPI-58…60 | ✅ | Marketing funnel; cached. |
| KPI-61…65 | ✅ | Personas incl. „Top-Fragen generieren“ (`adminFetch` + `useAsyncAction`). |
| KPI-66…69 | ✅ | Empfehlung → Kauf incl. the honesty banner; cached. |
| KPI-70 | ✅ | Chart skeleton until mount (height via context), themed tooltip; Recharts loads only on this screen. |
| KPI-71…74 | ➕ | **2026-10:** „Kampagnen im Vergleich“ table (cached with the funnel); section „Eingang“ (period, pure DB); sections „Kundenbasis“ and „Mo-Effekt“ (Gesamtwerte, pure DB; Mo-Effekt re-weights the no-Mo group to the same value-tier mix, `mo-effect.mjs`). Group descriptions in `kpi/groups.ts` updated. |

All 66 caveat texts of the inventory are behind the (i) of their section, verbatim (UX-P1).

## 6. Feedback (FEE)

| ID | Status | Note |
| --- | --- | --- |
| FEE-01 | 🔁 | `Callout`. |
| FEE-02 | 🔁 | `EmptyState` inside the list — the toolbar stays (UX-F1). |
| FEE-03 | ✅ | Search (placeholder „Text, E-Mail, Seite …“). |
| FEE-04…07 | ✅ | Tier filter, sort, counter, filtered-empty text. |
| FEE-08 | ✅ | Card with date, tier/e-mail badges, message, „Seite:“ / „Session:“ / „Thread:“; ➕ newsletter badge for `page = email:<kind>`. |

## 7. Gespräche (GES)

| ID | Status | Note |
| --- | --- | --- |
| GES-01 | 🔁 | `Callout`. |
| GES-02 | ✅ | Search field; applies on Enter (and blur). |
| GES-03 | 🔁 | Separate „Suchen“ button dropped — Enter/blur applies (search-field semantics). |
| GES-04 | ✅ | „Zurücksetzen“ + active-filter chips in the `FilterBar`. |
| GES-05 | ✅ | „… der Zeitraum wird ignoriert“ hint shown while a search is active. |
| GES-06 | ✅ | Range presets as `SegmentedControl`. |
| GES-07 | 🔁 | „Benutzerdefiniert“ toggle → „Zeitraum…“ option revealing Von/Bis. |
| GES-08…13 | ✅ | Tier, Kategorie, Qualität, „nur ohne Bot-Antwort“, range label, custom dates + „Anwenden“. |
| GES-14, 15 | ✅ | Stats panel header and counts. |
| GES-16, 17 | 🔁 | Bulk analysis via `useConfirm` (same cost estimate, same live toast and result). |
| GES-18, 19 | ✅ | Clickable distribution bars (aria-label „Liste auf „X“ filtern“ / „Filter „X“ entfernen“). |
| GES-20 | ✅ | „Noch keine analysierten Gespräche.“ |
| GES-21 | 🔁 | Hint → InfoTip. |
| GES-22…24 | ✅ | Counter with page, `Pagination` primitive (aria „Seitennavigation“), empty texts. |
| GES-25…27 | ✅ | Row, `TierBadge`, `OutcomeChips` (Tooltip instead of `title`), analysis badges + summary. |
| GES-28, 29 | ✅ | Placeholder; skeleton + „Gespräch konnte nicht geladen werden.“ / „Netzwerkfehler …“ / „Nicht gefunden.“ (`adminFetch`, aborted on switch). |
| GES-30…34 | ✅ | Header, „KI-Analyse“ + „Analysieren“ / „Neu analysieren“, result meta, transcript via the shared `TranscriptView`. |
| GES-35 | ✅ | Report meta line. |
| GES-36 | 🔁 | „Report anzeigen“ → `Disclosure` (collapsed by default, opens after a fresh generation). |
| GES-37…42 | ✅ | „Insights generieren“, hint, report, „Belege“ as nested `Disclosure`s with „Gespräch #n öffnen“ (now also sets `?gid=`), footer hints. |
| GES-43 | ➕ | **2026-10:** „Kunde öffnen“ in the detail of an identified conversation (`?tab=kunden&customer=`); the list stays pseudonymous. |

## 8. Wissen (WIS)

| ID | Status | Note |
| --- | --- | --- |
| WIS-01 | ✅ | „Gespräche scannen (k von N)“ in batches of 10 with progress. |
| WIS-02 | ✅ | Reload `IconButton` **with** aria-label „Neu laden“ (UX-W4 fixed). |
| WIS-03 | ✅ | Status tabs with counts. |
| WIS-04 | 🔁 | `EmptyState`. |
| WIS-05 | ✅ | Row header with status/product badges and meta; ➕ „aus Gespräch #n“ is a link (`?tab=gespraeche&gid=n`). |
| WIS-06, 07 | ✅ | „Wissenslücke“, „Frage“ (inside the expanded editor). |
| WIS-08 | 🔁 | Free-text handle → `CatalogProductPicker` (set/clear), handle shown read-only (UX-W2). |
| WIS-09, 10 | ✅ | „Antwort“, „Produkt verlinken“ (inserts `[Titel](URL)`). |
| WIS-11…15 | ✅ | Speichern / Veröffentlichen / Zurückziehen / Verwerfen / Wiederherstellen — same routes and payloads. |
| WIS-16, 17 | ✅ | Preview, English `Disclosure`. |
| WIS-18 | ✅ | Fields disabled when dismissed. |
| ➕ | | Search over entries (UX-W3), expand-in-place rows (UX-W1), `j`/`k`/`Esc`. |

## 9. Analyse (ANA)

| ID | Status | Note |
| --- | --- | --- |
| ANA-01, 02 | ✅ | Shared `SidebarList` („+ Neue Komplettanalyse“, report list with status pill, date, cost). |
| ANA-03 | 🔁 | Presets as `SegmentedControl`, „Zeitraum…“ reveals Von/Bis. |
| ANA-04, 05 | ✅ | Checkboxes; the two-line explanations are InfoTips (UX-A1). |
| ANA-06, 07 | ✅ | Live estimate, „Komplettanalyse generieren“. |
| ANA-08 | ✅ | Progress via `useStepLoop` (phases, `ProgressBar`, Pause / Fortsetzen, „Erstellung gestoppt“ + „Erneut versuchen“). |
| ANA-09, 10 | ✅ | Header, „PDF herunterladen“. |
| ANA-11 | 🔁 | „Löschen“ → `useConfirm`. |
| ANA-12…14 | ✅ | Failure state, loading/error states, full `ReportView`. |
| ➕ | | `?report=<id>`. |

## 10. Verbesserung (VER)

| ID | Status | Note |
| --- | --- | --- |
| VER-01…05 | ✅ | `SidebarList`, „Grundlage“ select, „Lauf starten“, warning without a completed analysis. |
| VER-06 | ✅ | Run driver via `useStepLoop` (reconnect message, „Fortsetzen“). |
| VER-07 | ✅ | |
| VER-08 | 🔁 | „Löschen“ → `useConfirm` (was `window.confirm`). |
| VER-09 | ✅ | Wirkungs-Check delta table on `ui/table`. |
| VER-10…18 | ✅ | Lanes, suggestion cards (priority line, editable directive, „Warum? Details & Belege“, Übernehmen / Erledigt / Verwerfen + note / Wieder öffnen, note display). |
| VER-19, 20 | ✅ | „Anweisungen an Mo“ `Disclosure` with live count, directive list. |
| VER-21…23 | ✅ | History / edit / toggle as `IconButton`s **with** labels (UX-V2 fixed). |
| VER-24 | ✅ | „Neue Anweisung“ `Field` with counter + „Anweisung aktivieren“. |
| VER-25, 26 | ✅ | Self-snapshot, empty/loading/error states. |
| ➕ | | `?run=<id>`. |

## 11. Einstellungen (EIN)

| ID | Status | Note |
| --- | --- | --- |
| EIN-01 | ✅ | Design cards with „Standard“, „Hinzugefügt am“, „Aktiv: …“ / „Nicht in Verwendung“. |
| EIN-02 | 🔁 | Four preview buttons per design → **one** „Vorschau“ per design; the e-mail type is a `SegmentedControl` inside the dialog (UX-E1). |
| EIN-03 | ✅ | „Design für <Typ>“ selects → `email-designs/assign`, toast. |
| EIN-04 | ✅ | „Vorschau“ per type (effective design). |
| EIN-05 | ✅ | `Callout` + disabled selects without DB. |
| EIN-06 | ✅ | Versand-Konfiguration (read-only). |
| ➕ | | Systemstatus card (D-5): DB, Shopify, Resend send/webhook, Pingen, Anthropic, OpenAI, three legal gates — configured / not configured only. |
| EIN-07…11 | ➕ | **2026-10:** „Shopify-Abgleich“ card — switches (sync, consent write-back, erasure sync, AI-profile scope), counts and last runs, first import / re-import with a step loop and cancel, dead write-backs with „Erneut versuchen“, „Erstabgleich der Einwilligung“ (Mo-only subscribers → Shopify customers after a confirm, only after the import). |

## 12. Shared components — where they went

| Inventory | Now |
| --- | --- |
| `ui/*` primitives | kept and extended (`ui/index.ts`); new: `IconButton`, `SearchInput`, `Field`, `SegmentedControl`, `StatusBadge`, `Spinner`, `ProgressBar`, `DataTable`, `Pagination`, `ConfirmDialog`/`useConfirm`, `Sheet`, `Disclosure`, `InfoTip`/`Tooltip`, `Callout`, `EmptyState`, `PageHeader`, `FilterBar`, `SplitPane`, `DescriptionList`, `TranscriptView`, `Kbd`, `BarList`, `SidebarList` |
| hand-rolled tables (Kampagne SentHistory, KpiTab `Th/Td`, Verbesserung DeltaTable) | `ui/table` / `DataTable` |
| `EmailTextModeToggle.tsx` | kept as the shared text-mode widget, now built on `SegmentedControl`; `LanguageToggle` and the preview-width switch use `SegmentedControl` directly |
| `KpiCharts.tsx` | `kpi/charts-recharts.tsx`, loaded via `next/dynamic` from `kpi/charts.tsx` |
| `customer-filter.ts` | `src/lib/admin-customer-filter.mjs` (pure, tested) |
| `CustomerProfileCard.tsx`, `KorrespondenzPanel.tsx`, `PhysicalLetterPanel.tsx` | `kunden/CustomerDetail.tsx` + `kunden/tabs/*` + `kunden/BundleComposer.tsx`; detail loaded via `GET customers/detail` |
| `GespraecheInsights.tsx` | `gespraeche/StatsPanel.tsx` + `gespraeche/ReportPanel.tsx` |
| `ReportSidebar.tsx`, `ReportProgressDriver.tsx`, `RunDriver` | `ui/sidebar-list.tsx`, `lib/use-step-loop.ts` (one loop with the Verbesserung driver's reconnect semantics) |
| per-file `callApi`/`post`/formatters/`Banner` copies | `lib/admin-fetch.ts`, `src/lib/admin-format.mjs`, `Callout` |
| `EmailPreviewFrame`, `EmailPreviewButton`, `HeroImagePanel`, `ThemeToggle`, `theme-config`, `theme.css` | kept |
| `OverviewTab.tsx`, `src/lib/admin-overview.mjs` (2026-10) | removed with the Übersicht → `EingangTab.tsx` + `eingang/*`; `admin-overview-store.ts` now only `getEingangSystemSnapshot` (counts) |
| `kunden/UnmatchedInboundQueue.tsx` (2026-10) | `eingang/UnmatchedInbound.tsx` |
| — (2026-10) | ➕ `ui/toggle-chips.tsx` (`ToggleChips`), `kampagnen/*`, `kunden/tabs/UeberblickTab.tsx`, `AktivitaetTab.tsx`, `einstellungen/ShopifySyncCard.tsx` |

## 13. Deep links

All baseline links work unchanged (`?tab=`, legacy `customers`/`status`, `?filter=`, KPI range, Gespräche `g*`).
New: `?customer=`, `?gid=`, `?report=`, `?run=`, `?kpiFresh=`, `?tab=marketing` alias. The inventory's two
candidates are implemented: Wissen „aus Gespräch #n“ is a link, and the Insights „Gespräch #n öffnen“ button also
updates `?gid=`. Kampagne → Kunden remains no link (campaign contacts are Shopify contacts, not customer entities).
**2026-10:** recipients are customers, the desk's „Kundenprofil“ block links to `?tab=kunden&customer=`. New links:
`?tab=eingang` (default; `?status=`, `?item=`), `?tab=kampagne&campaign=<slug>` / `&edit=<id|new>`, Kunden `?kview=` +
`k*`, aliases `overview` and `kampagnen`. The Übersicht links `?tab=kunden&filter=…` no longer filter (SHL-14).

## 14. Documented-but-not-found

Both discrepancies (server-side tab switching claim, missing Einstellungen) are resolved by the rewritten
[`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md).

---

## HTTP API, crons, scripts, environment, database (inventory parts 2–6)

- **Public / widget / account / auth / webhook / cron routes:** unchanged (the widget contract
  [`API_CONTRACT.md`](./API_CONTRACT.md) was not touched). `/api/kpi` writes through `recordKpiEvent()` (same
  behaviour, TECH-C7).
- **Admin routes:** ❌ removed with D-9 — `GET directives`, `GET email-designs`, `POST bundles/list`,
  `POST marketing/draft`, `POST qa/draft` (no caller). ➕ `GET customers/detail?id=` (on-demand customer detail),
  `GET campaign/history?q=&from=&to=&page=&pageSize=` (paged send history). Every other admin route keeps its
  path, method, payload and response.
- **Crons:** unchanged schedules. Address auto-capture runs only in `refresh-customers` (no longer on every
  `/admin` render, TECH-E3). The retention cron skips a sweep whose window is `0` (TECH-C1) — formerly `0` meant
  „delete everything“ for five windows.
- **Scripts:** ❌ `scripts/probe-bundle.mjs` (D-9). The three undocumented manual scripts are kept and documented in
  `README.md` → Scripts.
- **Environment:** `.env.example` complete (81 variables; ➕ `ANALYTICS_REPORT_RETENTION_DAYS`,
  `CONVERSION_SWEEP_MAX_CODES`, `SHOPIFY_APP_PROXY_SECRET`, `EMAIL_LOGO_URL`, `EMAIL_MO_ICON_URL`; ❌ the never-read
  `SHOPIFY_CUSTOMER_ACCOUNT_API_VERSION`); the three legal gates default to `false` in the example (D-8; code
  defaults unchanged).
- **Database:** one new migration, `0056_retention_indexes.sql` (two indexes, safe on a live database) — **to be run
  manually**. No other schema change.
- **Tests:** 813 → 867 green (`ttl-cache`, `retention-options`, `admin-tabs`, `admin-conversation-filter`,
  `admin-format`, `admin-customer-filter`, …).

**Customer platform (2026-10-01, inventory parts 2–6 updated in place):**

- **Public / widget / account routes** (additive, `API_CONTRACT.md` stays backward compatible): ✅ `/api/capture-email`,
  `/api/chat-marketing-opt-in`, `/api/account/marketing-opt-in` report to the one consent (`consent-flows.ts`) and
  answer `status:"confirmed"`, `alreadyConfirmed:true` for an already subscribed, not suppressed address (no second DOI
  mail); a pending DOI whose link expired falls back to „Keine Einwilligung“ in the nightly refresh; ➕
  `GET /api/consent-copy?surface=chat` carries `signIn` (sign-in first), ➕ `?surface=erase`; `/api/confirm-marketing`,
  `/api/unsubscribe`, `/api/erase-data`, `/api/account/erase`, `/api/account/export`, `/api/r/[token]` 🔁 (one consent,
  erasure reaches Shopify — a consent write to unsubscribed plus the erasure request —, export with orders / facts /
  consent history, shop CTA redirect).
- **Webhooks:** 🔁 `/api/webhooks/shopify` — customer, consent, order-ledger, bulk and GDPR compliance topics,
  deduplicated by `X-Shopify-Webhook-Id`; accepts `SHOPIFY_WEBHOOK_SECRET` or `SHOPIFY_CLIENT_SECRET`.
- **Admin routes:** ➕ 20 — `campaigns` (GET/POST), `campaigns/{update,status,refresh,audience-preview,assist,add-recipient}`,
  `customers/{list,language,objection,ask}`, `inbox/{item,decide,suggest,accept,run}`, `shopify/{status,import,outbox,align}`;
  🔁 `campaign/{contacts,history,prepare,reset-queue,test-contacts}` take a `campaignId`, `campaign/mark-done` is gated
  by consent, `customers/{profile,letter-draft}` answer 409 on an objection / outside the profile scope; ❌ retired:
  `POST /api/admin/campaign/sync` → `campaigns/refresh`. All 94 admin route files keep `guardAdminPost`/`guardAdminGet`.
- **Crons:** nine in `vercel.json`. ➕ `shopify-reconcile` (01:45), `campaign-audiences` (02:30), `shopify-sync`
  (every 5 min), `inbox` (hourly :20); 🔁 `refresh-customers` (+ Kaufprofile), `prepare-campaign-drafts` (budget across
  campaigns; expires stale pending DOIs first), `retention` (+ steps 7, 8 and 9 — sync log, decided Eingang items reduced to a marker,
  Shopify-confirmed erasure tombstones; Shopify customers exempt from the inactive / suppressed purges);
  ❌ `sync-campaign-audience` → `shopify-reconcile` + `campaign-audiences`.
- **Libraries retired:** `src/lib/campaign-sync.ts`, `src/lib/campaign-sync-core.mjs` (+ test), `src/lib/shopify-customers.ts`,
  `src/lib/admin-overview.mjs` (+ test), `getOverviewSnapshot` and its feeds (`admin-overview-store.ts`),
  `countUnmatchedInbound` (`email-messages-store.ts`), `getMarketingActivity` (`marketing-store.ts`); exports removed from `campaign-store.ts` (`upsertCampaignContact(s)`,
  `getContactStatusesByShopifyIds`, `suppressContactsMissingFromSync`, `hasActiveCampaignSubscription`,
  `getCampaignContactForCustomer`, `linkCampaignContactsToCustomers`, `listErasedEmails`, `testContactSyncId`) and from
  `customer-store.ts` (`listCustomerListRows`, `CustomerListRow`, `CustomerPurchaseState`) — replaced by
  `campaigns-store.ts`, `audience-store.ts`, `customer-list-store.ts`.
- **Scripts:** ➕ `scripts/register-shopify-webhooks.mjs` (`npm run shopify:webhooks`); 🔁 `scripts/seed-dev.mjs` seeds
  the customer platform.
- **Environment:** ➕ 11 variables, all in `.env.example` with defaults (switches off): `SHOPIFY_CUSTOMER_SYNC_ENABLED`,
  `SHOPIFY_CONSENT_WRITEBACK`, `SHOPIFY_ERASURE_SYNC`, `SHOPIFY_CONSENT_TEXT_VERSION`, `SHOPIFY_ERASURE_ALERT_PER_HOUR`,
  `CUSTOMER_PROFILE_LIGHT_BATCH`, `CUSTOMER_AI_PROFILE_SCOPE`, `INBOX_AI_DAILY_LIMIT`, `SHOPIFY_SYNC_LOG_RETENTION_DAYS`,
  `INBOX_RETENTION_DAYS`, `ERASURE_TOMBSTONE_RETENTION_DAYS`. Shopify scopes now include `read_customers`, `write_customers`, `read_all_orders`.
- **Database:** migrations `0061`–`0068` (customer mirror, order ledger, facts, the one consent + `consent_events`, sync
  tables + outbox + erasure tombstones, campaigns, inbox, view `customer_overview`) — **to be run manually** by the
  maintainer, in order, before the deploy that ships the code.
- **Tests:** 867 → 1016 green at `eb1816d` (116 files; new cores `audience-spec`, `campaign-def`, `consent-core`,
  `customer-ask-core`, `customer-facts-core`, `customer-fk-plan`, `customer-signals`, `customer-timeline`, `mo-effect`,
  `outbox-core`, `platform-flags`, `shopify-bulk-core`, `shopify-customer-map`).

## Screenshots

`docs/screenshots/before/` (baseline) and `docs/screenshots/after/` (2026-09-09), same names: `<screen>-light.png`,
`<screen>-dark.png` for all ten screens, `<screen>-light-tablet.png` for Übersicht, Kunden, Kampagne and KPIs,
plus `login-light.png`. `before-empty/` holds the baseline empty states. Both `index.json` files list viewport,
theme, render time and page height per shot.

2026-10-01: [`screenshots/customer-platform/`](./screenshots/customer-platform/) — `<screen>-<light|dark>-<1440|1024>.png`
for `eingang`, `kampagnen`, `kampagne-editor`, `kampagne-desk`, `kampagne-blackfriday`, `kunden`, `kunden-ohne-mo`,
`kunden-detail-{ueberblick,aktivitaet,kaeufe,marketing}`, `kpi`, `kpi-kundenbasis`, `einstellungen`, plus
`einzelansprache-desk-light-1440.png`.
