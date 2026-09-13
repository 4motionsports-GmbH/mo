# Kampagne — the review desk (redesign proposal)

Status: **proposal, 2026-09-13**. Nothing in here is implemented. It analyses the
Kampagne screen as it stands after the September redesign and proposes a new
layout for the daily job: one person reviewing and sending 100–200 personalised
e-mails a day. Every capability of the current screen (`FEATURE_INVENTORY.md`
§4, KAM-01…69) keeps a place; the send path, the gates and the audit record are
untouched. Phase one needs no migration and no new route.

Contents

1. The job
2. What exists today
3. Where the current screen fights the job
4. Principles
5. The desk (layout)
6. The parts in detail (rail, mail column, Prüfung, action bar, Postausgang, Vorbereiten)
7. Liste, Fokus, Gesendet
8. Feature mapping (KAM-ids → new place)
9. New capabilities
10. Phasing
11. Decisions to make
12. Success criteria

---

## 1. The job

Every draft is pre-generated; the operator judges, occasionally adjusts, and
decides: send or skip. At 200 a day the arithmetic sets the design:

| Assumption | Value | Consequence |
| --- | --- | --- |
| E-mails per working day | 200 | reviewed in about three hours, next to other work |
| Budget per e-mail | 54 s | reading, deciding, waiting for the server, moving on |
| Drafts that need no change | ≈ 70 % | must take about 15 s: look, confirm, one key |
| Drafts that need a small change | ≈ 25 % | swap a product, set a discount, fix a sentence: 60–90 s |
| Drafts that need real work | ≈ 5 % | regenerate, rebuild a set, or skip: up to 3 min |

The 15-second path is only possible when the rendered e-mail is visible the
moment a card opens, the products are recognisable as pictures, every risk is
precomputed and shown before reading starts, one key sends and advances, and
nothing blocks while the server works.

## 2. What exists today

Grouped by job (ids from `FEATURE_INVENTORY.md`):

- **Queue and batch work** — Sync (KAM-06, also nightly cron); „Nächste 50
  vorbereiten" with defaults for Rabatt and Textmodus, chunked progress, cancel
  (KAM-07…09); „Warteschlange neu aufbauen" behind a confirm (KAM-10, 11);
  counts Offen / Entwürfe / Heute gesendet / Übersprungen / Unterdrückt /
  Fehlgeschlagen, opt-in mix, hero A/B split (KAM-04, 05); opt-in filter
  (KAM-14); global contact search with Öffnen / Entwurf erstellen /
  Wiederherstellen, queue list, Übersprungen with restore (KAM-17…25).
- **One draft under review** — contact, DE/EN pin, Textmodus, opt-in, segment,
  A/B group, low-confidence badge, orders and spend (KAM-29…36); Kaufhistorie
  with the recommendation basis (KAM-37…43); Empfohlene Produkte editor with the
  catalog picker and variants, bundle rebuilt to match (KAM-44…46); Rabatt after
  generation, MK-code minted at send (KAM-47…49); Set-Angebot create/archive
  (KAM-50…54); subject and body with autosave, inline Text/Vorschau switch, hero
  panel (KAM-55…57); Senden with first-send confirm, Vorschau dialog, Kopieren →
  Als erledigt markieren, Neu generieren, Überspringen, keys `N P V C S X`
  (KAM-58…66).
- **Outcomes and guarantees** — Gesendet: paged, searchable history with
  delivery state, code, redemption, hero variant, retained content (KAM-67…69);
  the Kampagnen-Funnel on the KPI screen (`ADMIN_DASHBOARD.md` §5.9); the gates
  in `approveAndSendCampaign` (master flag, opt-in level, suppression, frequency
  cap); queue order by measured value (early window first, then spend).

## 3. Where the current screen fights the job

Evidence: `docs/screenshots/after/kampagne-light.png` (1440 px, seeded data) and
the code in `src/app/admin/kampagne/`.

1. **The work starts a third of the way down.** Two banners, the stat strip, the
   toolbar, the tab row and the shortcut legend push the review card to about
   450 px. On a 1440 × 900 laptop the action buttons sit below the fold; every
   card costs a scroll. (The banners come from the seed environment; the space
   they take is a design decision either way.)
2. **Batch jobs and per-draft defaults share one toolbar.** Sync, Vorbereiten
   and Neu aufbauen sit next to Rabatt and Textmodus that only apply to future
   drafts; the same two words appear on the card with another meaning. The only
   primary button on the screen is „Nächste 50 vorbereiten", but preparing is
   not the daily primary action — sending is.
3. **Filters and the legend hang off the tab row.** The legend disappears below
   `xl`; the only filter is the opt-in level, although segment, language,
   discount, set, hero and edits are what an operator batches by.
4. **The rail shows names and a warning triangle, nothing else.** You cannot
   triage from it, and it scrolls in its own 50 vh box inside a sticky column.
5. **The left column is four forms, not a verdict.** Kaufhistorie, Empfohlene
   Produkte, Rabatt and Set-Angebot are collapsibles with their own buttons and
   helper paragraphs; nothing on the card says „ready".
6. **The editor shows raw markdown by default.** In the screenshot nine of the
   fourteen visible lines are product URLs. The rendered view is a toggle; a
   second preview lives in a dialog and a third behind „Vorschau".
7. **The hero panel is on every card.** It mounts and fetches
   (`GET /api/admin/email-hero`) even when the campaign design has no hero,
   explains itself in a helper paragraph, and generating an image locks the
   card for up to three minutes. The A/B rule (even contact ids get a hero) is a
   note the operator has to remember.
8. **Six equal buttons in two rows, and everything blocks.** Senden is farthest
   from where reading starts; Überspringen is a neighbour of Neu generieren.
   Every send, skip, regenerate and offer change sets `busy` and disables the
   whole card until the server answers (`useCampaignActions.ts`); Vorbereiten
   disables the review as well; and `router.refresh()` after Sync, Vorbereiten
   or Wiederherstellen resets the index to card 1.

Smaller frictions: the defaults for new drafts reset on reload; there is no
`?contact=` deep link (unlike `?customer=` on Kunden); three nested border
levels (Card › Disclosure › bordered rows); opt-in mix, A/B split and
Unterdrückt are audit numbers on the work surface; helper paragraphs remain in
`BundleSection`, `DiscountControl`, `PurchaseHistorySection` and
`HeroImagePanel` against the InfoTip rule; every offer change chains its own AI
regenerate (change language and discount → two waits).

## 4. Principles

- **The e-mail is the only heavy thing.** The rendered mail, exactly as it
  ships, is the centre of the screen from the first paint; chrome stays in the
  small sizes of the design system.
- **Verdict before detail.** Every card opens with a precomputed answer: ready,
  hints, or blocked. The operator reads to confirm, not to discover.
- **One primary action, one key.** `S` sends and advances. Adjustments live in a
  side column; exits (skip) and escapes (edit, regenerate) are secondary and
  never neighbours of the primary.
- **Nothing blocks the next card.** Sending, preparing and regenerating run in
  the background with visible state.
- **Batch level and draft level never share a surface.** Sync, Vorbereiten, Neu
  aufbauen live in the header behind one button and a menu; Rabatt and
  Textmodus mean „this draft" on the card and „new drafts" only inside the
  Vorbereiten popover.
- **Same system, fewer layers.** Tokens, primitives, InfoTips and the German
  terminology stay. Banners become pills, nested cards become hairlines, helper
  paragraphs become InfoTips.

## 5. The desk

Three columns under one thin header. At 1440 px nothing scrolls except the mail
itself.

```
┌ Kampagne   37 heute gesendet · 18 zu prüfen ▓▓▓▓▓▓░░   Prüfen | Liste | Gesendet 612      ● Versand freigegeben ● Shopify  Sync vor 6 h  [Vorbereiten…] [⋯] ┐
├────────────────────┬───────────────────────────────────────────────────┬──────────────────────────────┤
│ [Kontakt suchen /] │ Lea Hoffmann  lea.hoffmann78+shop@gmail.com        │ PRÜFPUNKTE                   │
│ Alle 18 · DOI 12 · │ DE · Ausbauen — früh · vor 22 T. · DOI ✓ · 6 Best. │ ● Bereit — keine Hinweise    │
│ EN 3 · Rabatt 5 ·  │ Letzter Kauf: ATX® Power Rack PRX-510 · 17.08.     │ ● A-Gruppe · KI-Hero 8/10    │
│ Set 2 · Hinweise 4 │ [Lea, drei Ergänzungen für dein Training        ]  │──────────────────────────────│
│────────────────────│ ┌───────────────────────────────────────────────┐ │ EMPFEHLUNGEN · 3  [+ Produkt]│
│ WARTESCHLANGE      │ │ hero (KI-Bild)   Mehr Leistung. Mehr Fokus.   │ │ ▣ Octa-Dumbbells 2×24  289 €│
│ 1 Lea Hoffmann  ●  │ │ Hallo Lea, … Power Rack … Octa-Dumbbells …    │ │ ▣ Hantelbank klappbar  199 €│
│   früh 10% Set     │ │ FÜR DICH AUSGESUCHT                            │ │ ▣ Multi Bench MBX-520  349 €│
│ 2 Marie Richter ●  │ │ ▣ Octa-Dumbbells 2 × 24 kg           289,00 € │ │──────────────────────────────│
│ 3 Hannah Vogel  ●  │ │ ▣ Hantelbank klappbar                199,00 € │ │ ANGEBOT                      │
│   EN               │ │ ▣ Multi Bench MBX-520                349,00 € │ │ Rabatt  [0][5][10✓][15][20]…│
│ 4 Philipp Frank ●  │ │ BUNDLE DEAL Dein persönliches Set  [Zur Kasse]│ │ Set  Dein persönliches Set · │
│ 5 Jan Braun     ●  │ │ Dein persönlicher Code: MO-XXXX · Noch 6 Tage │ │      439 € statt 488 € [Entf]│
│ …                  │ │ ◉ Übrigens: Mo hilft im Chat  [Beratung starten]│──────────────────────────────│
│ POSTAUSGANG · 2    │ └───────────────────────────────────────────────┘ │ TEXT   Sprache [DE✓][EN]     │
│ Tim Müller  sendet…│                                                   │        Modus [Ausf][Komp✓][Min]│
│ Mia Meyer   ✓      ├───────────────────────────────────────────────────┤ HERO · Performance  KI-Hero  │
│ Übersprungen · 4 ▸ │ [P ←] 3 / 18 [→ N]   [Überspringen X] [Neu generieren R] [Bearbeiten E] [⋯] [Senden S] │ KAUFHISTORIE · 3 ▸  KONTAKT │
└────────────────────┴───────────────────────────────────────────────────┴──────────────────────────────┘
```

- **Header (one line):** title; „heute gesendet · zu prüfen" with a bar for the
  day's queue; view switch Prüfen · Liste · Gesendet; status pills (Versand
  freigegeben / gesperrt, Shopify, last sync) with the original texts in
  InfoTips; „Vorbereiten…" (popover, background job, progress pill with cancel);
  ⋯ menu (Jetzt synchronisieren, Warteschlange neu aufbauen with the existing
  ConfirmDialog).
- **Rail (236 px):** global search (`/`); filter chips with counts (Alle, DOI,
  EN, Rabatt, Set, Hinweise); rows with segment/discount/set/language chips, an
  edit mark and a status dot (green ready · amber hints · red blocked);
  Postausgang strip; Übersprungen collapsible with Wiederherstellen.
- **Mail column:** identity line (name, e-mail, language, segment with days,
  opt-in, orders and spend, anchor purchase); subject as an always-editable
  input; the rendered e-mail (the existing `campaign/email-preview`, prefetched
  for the next card) as the default view; `E` switches to the editor in place
  (side by side with the live preview at ≥ 1600 px), `Esc` returns; sticky
  action bar at the bottom.
- **Prüfung (296 px):** blocks separated by hairlines — Prüfpunkte,
  Empfehlungen, Angebot, Text, Hero (only when the campaign design has a hero),
  Kaufhistorie (collapsed), Kontakt.

## 6. The parts in detail

### 6.1 Rail rows

`7  Sophie Roth  EN  Ausbauen  10 %  Set  ✎  ●` — position (queue order by
measured value, as today), name (falls back to the e-mail), kind chips (only
when not default: language EN, segment, Rabatt, Set), `✎` when subject or text
was edited by hand, dot: green ready · amber hints · red blocked (kein DOI,
Sperrfrist, hard discount mismatch).

### 6.2 Mail column

Rendered first; subject inline; `E` edit; `V` keeps the full-size dialog with
Desktop/Mobil. The identity line carries what the prose is checked against.

### 6.3 Prüfung

| Block | Content | Today |
| --- | --- | --- |
| Prüfpunkte | verdict (ready / hints / blocked) + one line per check with a fix action | badges, opt-in callout, send-time refusals — made visible up front |
| Empfehlungen | three rows with thumbnail, name, price; remove per row; „+ Produkt" opens the catalog picker (variants) | KAM-44…46 unchanged behaviour |
| Angebot | Rabatt as segmented 0/5/10/15/20 + custom; Set line (attached: title, price, expiry, Entfernen; else „Set erstellen…" → sheet with the composer) | KAM-47…54 |
| Text | Sprache DE/EN, Modus — the two settings that regenerate, labelled as such | KAM-30, 31 |
| Hero | only when the design has a hero: state pill (KI-Hero + check score / Standard-Bild / missing for the A group), thumbnail, Erzeugen or Anpassen… (sheet with prompt + headline), Entfernen | KAM-57, all five actions kept |
| Kaufhistorie | collapsed with a one-line basis summary; inside the order list with basis checkboxes and „Empfehlungen & Text neu erzeugen" | KAM-37…43 |
| Kontakt | opt-in with source, segment with reason, last mail on either channel + frequency-cap state, A/B group, spend | KAM-32…36 + two new facts |

**Checks behind Prüfpunkte** — a pure `campaign-review-checks.mjs` with tests,
feeding the rail dot, the block and the „Hinweise" chip:

| Check | Level | Source | Fix |
| --- | --- | --- | --- |
| no provable DOI while `CAMPAIGN_ALLOW_SINGLE_OPT_IN` is off | blocked | optInLevel, flag | Überspringen; Kopieren stays possible |
| address written to within the frequency cap on either channel | blocked | last cross-channel send (new prop) | Überspringen or wait; date shown |
| prose states a different percentage than the set discount | blocked | `detectDiscountTextMismatch` (exists, pure) | Neu generieren |
| placeholder `MO-XXXX` in the text while Rabatt is 0 % | blocked | body, discountPercent | Neu generieren or set a Rabatt |
| recommendations are representative fallbacks | hint | lowConfidence | narrow the basis or swap products |
| a recommended product is gone or sold out | hint | catalog resolution (add availability to props) | swap the product |
| attached set expires within two days | hint | bundle.expiresAt | Set neu erstellen |
| A group without a KI-Hero (hero design active) | hint | hero state (new prop) | Hero erzeugen |
| draft older than 14 days | hint | draft.updatedAt | Neu generieren |
| segment not sendable (frisch / ruhen), drafted deliberately | hint | segment | Überspringen |
| subject longer than 70 characters | hint | subject | shorten |
| subject or text edited by hand | info | edit state | — |

### 6.4 Action bar and keys

`[P ←] 3 / 18 [→ N] ……… [Überspringen X] [Neu generieren R] [Bearbeiten E] [⋯] [Senden S]`

The ⋯ menu: Vorschau (Desktop/Mobil) `V`, Kopieren `C` (then „Als erledigt
markieren" appears in the bar, as today), Fokus-Modus `F`, Tastenkürzel `?`.

| Key | Action | Note |
| --- | --- | --- |
| `N` `P` | next / previous | kept (`J` `K` aliases optional, like Wissen) |
| `S` | send and advance | kept; disabled while blocked; first-send-of-day confirm kept |
| `X` | skip and advance | kept; undo via Übersprungen |
| `E` / `Esc` | edit subject and text / back | new |
| `R` | regenerate with the current settings | new key, existing action |
| `V` | full-size preview dialog | kept |
| `C` | copy subject and text | kept, with the MO-XXXX warning |
| `F` | Fokus-Modus | new |
| `/` | focus the contact search | consistent with Kunden |
| `?` | shortcut sheet | the shell's Tastenkürzel |

### 6.5 Postausgang — sending without waiting

The server stays exactly as it is (the atomic claim in `claimContactForSend`
already prevents double sends); only the client changes what it does while it
waits:

1. `S` — the draft leaves the queue, the next card is on screen, the rail shows
   „wird gesendet …".
2. ok — row turns „gesendet ✓" and fades, „Heute gesendet" ticks up, toast as
   today.
3. refused (any gate) — the draft returns to the top of the queue with a red
   Prüfpunkt carrying the server's reason.
4. network failure — the row offers „erneut versuchen"; the claim reverts as
   today.

The same in-flight model covers regenerates: an Angebot/Text change shows „Text
wird angepasst …" on the mail column, several changes within a few seconds
collapse into one regenerate, and the operator may move on. This keeps the
invariant that prose and offer never drift while removing the waits.

### 6.6 Vorbereiten as a background job

Popover: Anzahl (25/50/100, with „n offen · m im Sendefenster"), Rabatt,
Textmodus, „KI-Hero für die A-Gruppe erzeugen" (phase 2), an estimate from the
recorded `ai_usage` history („14 Entwürfe · ≈ 0,35 € · ≈ 6 Min."), then
„Vorbereiten starten". Defaults are remembered per browser. The run shows a
progress pill in the header with cancel; the review keeps working (client:
split „card busy" from „job running"). Server unchanged (chunked
`campaign/prepare`).

## 7. Liste, Fokus, Gesendet

- **Liste** — the queue as a sortable table (Kontakt, Segment, Sprache, Rabatt,
  Set, Hero, Hinweise, Entwurf age/edited, Öffnen) with multi-select and bulk
  Überspringen (free, undoable), Neu generieren… and Rabatt setzen… (paid runs:
  confirm with count and cost estimate, like the bulk analysis on Gespräche).
- **Fokus-Modus** — `F` hides rail and review column, centres the mail at
  600 px, keeps the action bar and shows the Prüfpunkte as a one-line strip
  above the mail. Any adjustment key or `F` returns.
- **Gesendet** — the paged, searchable table stays; adds delivery-state chips
  (Alle, Zugestellt, Geklickt, Bounce, Beschwerde, Kopiert) and a pure-DB 30-day
  strip (gesendet, zugestellt %, geklickt %, Bounces, Beschwerden,
  Abmeldungen) with a link to the Kampagnen-Funnel. Redemption and revenue stay
  on the KPI screen with its Shopify cache.

## 8. Feature mapping

| Today | Element | On the desk | Change |
| --- | --- | --- | --- |
| KAM-01 | no-database callout | unchanged | same |
| KAM-02, 03 | „Versand gesperrt", „Shopify nicht konfiguriert" banners | header pills with the original texts in InfoTips; affected controls disabled with tooltips | moved |
| KAM-04, 05 | stat strip, opt-in mix, A/B split | „heute gesendet · zu prüfen" in the header; other counts in the Liste header and the Vorbereiten popover | moved |
| KAM-06 | Sync | ⋯ menu „Jetzt synchronisieren" + „zuletzt vor n h"; cron unchanged | moved |
| KAM-07, 08 | Rabatt / Textmodus for new drafts | inside the Vorbereiten popover, remembered | moved |
| KAM-09 | „Nächste 50 vorbereiten", progress, cancel | „Vorbereiten…" popover → background job, header progress pill with cancel | moved |
| KAM-10, 11 | „Warteschlange neu aufbauen" + confirm | ⋯ menu, same ConfirmDialog | moved |
| KAM-12, 13 | Warteschlange / Gesendet tabs | view switch Prüfen · Liste · Gesendet | extended |
| KAM-14 | opt-in filter | filter chips in the rail (DOI kept, more added) | extended |
| KAM-15, 16 | key legend, `N P V C S X` | keys unchanged, shown on the buttons; legend in the shell's Tastenkürzel | extended |
| KAM-17…22 | global search with status actions | rail search, `/` focuses it | same |
| KAM-23…25 | queue list, ⚠, Übersprungen | rail rows with chips and dots; Übersprungen collapsible | extended |
| KAM-26 | empty state | EmptyState in the mail column with „Vorbereiten…" and „Jetzt synchronisieren" as buttons | same |
| KAM-27, 28 | „Entwurf i von N", Zurück / Weiter | left end of the action bar | moved |
| KAM-29, 36 | name, e-mail, orders, spend | identity line above the mail; Kontakt block | moved |
| KAM-30, 31 | DE/EN pin, Textmodus | „Text" block, regenerate batched | moved |
| KAM-32…35 | opt-in, segment, A/B, low-confidence badges | identity chips, Kontakt, Prüfpunkte | moved |
| KAM-37…43 | Kaufhistorie with basis selection | „Kaufhistorie" block, collapsed with a summary; controls unchanged | same |
| KAM-44…46 | recommendations editor | „Empfehlungen" block with thumbnails and prices | extended |
| KAM-47…49 | Rabatt input, Übernehmen, hint | „Angebot" line one: segmented depth + custom; hint as InfoTip | moved |
| KAM-50…54 | Set-Angebot display and composer | „Angebot" line two; composer in a sheet | moved |
| KAM-55, 56 | subject and body, autosave | subject always inline; body in Bearbeiten (`E`); autosave unchanged | extended |
| KAM-57 | hero panel | „Hero" block when the design has a hero; prompt/headline in a sheet; all actions kept | moved |
| KAM-58 | „Erneute Einwilligung erforderlich" | blocked Prüfpunkt with the same text; Senden disabled with tooltip | moved |
| KAM-59, 60 | Senden, first-send confirm | action bar primary, non-blocking; confirm kept | extended |
| KAM-61 | Vorschau dialog | `V` and ⋯ menu; the inline render is the default view | same |
| KAM-62, 63 | Kopieren, Als erledigt markieren | ⋯ menu; „Als erledigt markieren" in the bar after a copy | moved |
| KAM-64, 65 | Neu generieren, Überspringen | action bar with `R` and `X` | same |
| KAM-66 | e-mail viewer dialog | unchanged | same |
| KAM-67…69 | Gesendet table, Ansehen | unchanged + delivery chips + 30-day strip | extended |

## 9. New capabilities

| Capability | What it saves | Needs | Phase |
| --- | --- | --- | --- |
| Prüfpunkte (review checks) | the 15-second path: a green card needs no reading of the side column | pure module + tests; hero state, last send, product availability in the queue props | 1 |
| Postausgang (non-blocking send) | 2–5 s of locked screen per mail, ≈ 10 min a day | client only | 1 |
| Vorbereiten in the background | review while the next batch is drafted | client: split card-busy from job-running | 1 |
| rendered-first mail, subject inline, `E` edit | no toggle per card; prose judged as the recipient sees it | client; prefetch of the next preview | 1 |
| rail state + filter chips | triage from the list; batches of similar mails | client | 1 |
| header pills, ⋯ menu, Vorbereiten popover | ≈ 300 px of vertical space at 1440 px | client | 1 |
| deep link `?contact=`, `?view=`, `?filter=` | position survives refreshes, shareable | client (docs §2.2) | 1 |
| batched, background regenerate | one AI call for several changes | client; routes unchanged | 1 |
| Fokus-Modus | keyboard-only run through clean drafts | client | 1 |
| last mail + frequency-cap state per contact | no 429 at send time | one join in `listDraftedQueue` | 1 |
| Hero block only when it applies; hero batch for the A group | no three-minute waits on cards; A/B rule enforced by the system | design flag in props; a step route running suggest + generate per contact; cost cap — **decision** | 2 |
| Liste view with bulk skip / regenerate / discount | handling the 5 % that need work in one sitting | client + cost estimate from `ai_usage` | 2 |
| Gesendet delivery chips + 30-day strip | bounces and complaints visible without the KPI screen | filter param on `campaign/history`; pure-DB counts | 2 |
| nightly Vorbereiten with a cap | the queue is full when the day starts | cron + env var; the docs deliberately have no auto-generation today — **decision** | 2 |
| Freigeben + scheduled batch send | review any time, send at the best hour | migration (status `approved`), two routes; gates stay per send — **decision** | 3 |
| link chips in the editor | prose editable without URLs in the way | client, custom editor | 3 |

Not proposed: automatic sending, any change to the gates, removing the copy
path, a rich-text editor, moving the Kampagnen-Funnel off the KPI screen.

## 10. Phasing

**Phase 1 — shape and flow (no migration, no new route)**

1. `src/lib/campaign-review-checks.mjs` + tests.
2. Queue props: hero state, hero design active, last cross-channel send, product
   availability (`KampagneTab.tsx`, `campaign-store.ts`).
3. Header strip: pills, progress, view switch, Vorbereiten popover, ⋯ menu.
4. Rail: rows with chips and dots, filter chips, Postausgang, URL sync.
5. Mail column: rendered first, subject inline, Bearbeiten, action bar, keys
   `E R F`.
6. Review column: Prüfpunkte, Empfehlungen, Angebot, Text, Hero, Kaufhistorie,
   Kontakt (helper paragraphs → InfoTips).
7. Background send, background prepare, batched regenerate
   (`useCampaignActions.ts`: in-flight map instead of one `busy`).
8. `ADMIN_DASHBOARD.md` §3.2, `CAMPAIGNS.md` §5, `FEATURE_INVENTORY.md`,
   before/after screenshots at 1440 and 1024 px, light and dark.

**Phase 2 — throughput:** Liste view with bulk actions and cost estimate; hero
batch for the A group inside Vorbereiten (step loop, cost cap); Gesendet
delivery filter and strip; nightly Vorbereiten behind an env var, off by
default (documented in `.env.example`).

**Phase 3 — options:** Freigeben state and scheduled batch send (migration);
link chips; per-contact history drawer.

## 11. Decisions to make before building

| Decision | Recommendation |
| --- | --- |
| Regenerate policy | keep „every offer change regenerates the prose", but batch changes within a few seconds and run it in the background. The explicit-only alternative saves AI calls but lets prose and offer drift. |
| Nightly Vorbereiten | a cron drafting the next N pending contacts with a cost cap, off by default. Recommended at 200 a day; the current „no auto-generation" rule was written for a smaller volume. Cap and default depth are the maintainer's call. |
| Heroes for the A group | generate during Vorbereiten instead of on the card (≈ 0,20 € per image, ≈ 20 € a day at 200 mails with half in the A group). Recommended only while the A/B test runs; the comparison needs ≈ 100 sends per arm. |
| Batch or scheduled sending | direct sends during review spread the volume over the day, which deliverability prefers. Start without it; add „Freigeben" if sending time turns out to matter. |
| Daily target | the progress bar ends at the day's queue (no setting) rather than a fixed target. |
| Copy path | kept in full, moved into the ⋯ menu; a removal would be a separate decision per the inventory rule. |

## 12. Success criteria

- ≤ 15 s from opening an unflagged draft to `S`, measured on ten cards in a row.
- ≥ 60 % of sends without any edit or regenerate (send snapshot).
- ≤ 1,3 regenerate calls per sent e-mail (`ai_usage`).
- 0 scrolls per card at 1440 × 900 with the desk at rest.
- < 1 min from opening `/admin` in the morning to the first send.
- 100 % of refused sends visible in the session with their reason.
