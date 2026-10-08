# Verbesserung — the closed improvement loop

The **Verbesserung** tab (`/admin?tab=verbesserung`) turns the business data
into a **closed loop**: a run reads the business snapshot of a period, measures
whether the changes the operator adopted actually moved their numbers, and the
strategist model proposes what to do next — decision-grade, each with the
metric the next run will measure it on. The operator decides; nothing changes
by itself. Since 2026-10-06 (v2); runs before that (v1) stay readable.

```
 Business snapshot of the period            Mo's self-snapshot          Komplettanalyse (optional)
 (KPI numbers vs. the previous period,      (prompt, tools, personas,   insights, personas, customer
  docs/BUSINESS_SNAPSHOT.md)                 knowledge, directives)      knowledge; its open recommendations
              \                                    |                                 /
               ▼                                   ▼                                ▼
        ┌──────────────────────────────────────────────────────────────────────────────┐
        │ IMPROVEMENT RUN (v2) — one unit of work per /step                            │
        │ 1 daten               snapshot (+ Shopify code lookup, bounded); import the  │
        │                       report's open recommendations                          │
        │ 2 messung             every adopted directive / implemented change on its    │
        │                       success metric: before/after windows, tests,           │
        │                       confounders (pure code, no model)                      │
        │ 3 wirkungscheck       Opus: keep / adjust / roll back / watch   (if needed)  │
        │ 4 vorschlaege_chat    Opus: chat & prompt, widget, Mo's tools                │
        │ 5 vorschlaege_betrieb Opus: operations, campaigns, development, legal        │
        │                       + the run's headline                                   │
        └──────────────────────────────────────────────────────────────────────────────┘
                          │
                          ▼
   suggestions: Neu → Geplant → Erledigt / Verworfen                      (HUMAN)
   chat & prompt suggestions with a directive: „Übernehmen“ = a LIVE,
   versioned team directive in Mo's system prompt                        (HUMAN)
                          │
                          ▼
   next run measures every adopted directive and done suggestion ──────► loop closed
```

| File | Role |
| --- | --- |
| [`improvement-core.mjs`](../src/lib/improvement-core.mjs) | Pure: run versions, the phase machine, the run period (`resolveRunPeriod`), owner lanes (+ the v1 mapping `ownerLaneOf`), statuses, priority (`priorityScore`, `priorityTier`), `backlogMatrix`, fingerprint/dedup, directive bounds, the report extract |
| [`improvement-effects.mjs`](../src/lib/improvement-effects.mjs) | Pure: what to measure (`buildChangeList`), windows (`changeWindow`), tests (`effectStats`), verdicts (`classifyMetricEffect`), `measureChange`, the release/switch classification (`RELEASE_EFFECTS`, `SWITCH_EFFECTS`), the period's movers (`snapshotMovers`) |
| [`improvement-decision.mjs`](../src/lib/improvement-decision.mjs) | Pure: the suggestion shape and its normalisers, storage mapping (`suggestionStorage`, `readSuggestionDetails`), the Komplettanalyse import, prompts, budgets and the cost estimate |
| [`improvement-schemas.mjs`](../src/lib/improvement-schemas.mjs) | Zod schemas of the three strategist passes (kept out of the client bundle) |
| [`improvement-types.ts`](../src/lib/improvement-types.ts) | The stored v2 shapes (types only) |
| [`improvement-store.ts`](../src/lib/improvement-store.ts), [`improvement-measure.ts`](../src/lib/improvement-measure.ts), [`improvement-generate.ts`](../src/lib/improvement-generate.ts) | Persistence, the measurement I/O (one snapshot per window), the stepper |
| [`improvement.fixtures.mjs`](../src/lib/improvement.fixtures.mjs) | Test fixtures: change history, window snapshots, sample strategist outputs |

## Human-in-the-loop boundary (unchanged, load-bearing)

The Gespräche insights rollup has always carried the note that Mo **never**
rewrites his own prompt or behaviour automatically
(`src/lib/conversation-insights.ts` `BOUNDARY_NOTE`). This feature keeps that
boundary exactly:

- The engine only ever **proposes**. No code path writes to `mo_directives`,
  the catalog, the knowledge base or anything behaviour-affecting from a model
  output. Importing a Komplettanalyse's recommendations creates suggestions,
  nothing else.
- The ONLY way a suggestion becomes behaviour is an explicit, authenticated
  admin action: **„Übernehmen — gilt ab sofort“** (a chat & prompt suggestion
  with a directive text; the operator may edit the text first) or the operator
  implementing a change and marking it **„Erledigt“**.
- The core system prompt stays **in git** (`src/lib/system-prompt-core.mjs`,
  byte-pinned by the golden test). A core-prompt change is described in the
  suggestion's action, with no directive.

## A run (v2)

**Period.** A run is built on the business snapshot
([`BUSINESS_SNAPSHOT.md`](./BUSINESS_SNAPSHOT.md)) of one period and the equally
long period before it — the same numbers as the KPI screen. The new-run panel
offers the period of a chosen Komplettanalyse or the last 7 / 30 / 90 **full**
days up to yesterday (`resolveRunPeriod`: a partial today would bias every
count down; a custom range is swapped when reversed, ends yesterday at the
latest and is capped at 366 days). The KPI links of a run open the KPI screen on
exactly that range.

**Komplettanalyse (optional).** Its conversation chapters (insights, personas
with top questions, aggregate customer knowledge — `renderReportExtract`,
scrubbed of personal data) feed the chat & prompt pass. A **decision report**
(sections v2) also brings its recommendations: „Maßnahmen der Komplettanalyse
übernehmen“ imports the ones not imported before (same report and position)
and not already in the backlog (fingerprint of a non-dismissed suggestion) as
suggestions of this run — owner lane from the report's owner and link, the
success metric = the first snapshot key the recommendation names (its free-text
target stays visible), horizon parsed from „in 2 Wochen“ and the like. The two
screens work together: the Komplettanalyse recommends, the Verbesserung
decides, tracks and measures.

**Phases** (`RUN_PHASES`, one unit of work per `POST /api/admin/improve/step`):

| Phase | Work | Model |
| --- | --- | --- |
| `daten` | `getBusinessSnapshot(period, { includeShopify: true })` (the Shopify code lookup bounded to 45 s), the switch history against the previous completed run, the report import | — |
| `messung` | the changes to measure and one window snapshot each (pure DB, no Shopify lookup — both windows count the ledger alone), time-boxed to 120 s per step (`MEASURE_STEP_BUDGET_MS`); the rest follows next step | — |
| `wirkungscheck` | the strategist reads the measurement and recommends keep / adjust / roll back / watch with a next step; **skipped** when no measurement has a verdict to assess | strategist |
| `vorschlaege_chat` | up to 6 suggestions for chat & prompt, widget & shop, development (Mo's tools) — reads Mo's self-snapshot | strategist |
| `vorschlaege_betrieb` | up to 6 suggestions for operations, campaigns & marketing, development, legal — and the run's headline + summary; sees the chat pass's titles | strategist |

The strategist passes run through `runStrategistObject`
([`strategist-call.ts`](../src/lib/strategist-call.ts)) — model, effort,
timeouts and the retry ladder in [`AI_MODELS.md`](./AI_MODELS.md). A pass that
times out, is cut off or returns no valid object stays in its phase and is
retried one rung lower (`high` → `medium` → `low`); after the third failure, or
without an Anthropic key, the run moves on with a note in „Lage“ — the
deterministic parts (snapshot, measurement, imports) always complete. Before
each call the attempt is stored as in flight (`state.inFlight`, saved without
ending the step); a step the platform killed mid-call is counted as a failed
attempt on the next step (note „… vom Server nach 300 s abgebrochen.“), so the
ladder moves on instead of repeating the same call. Every
pass records its tokens in `ai_usage` under the call site `improvement` and in
the run's `usage` (EUR priced on read).

**Retry safety (migration 0045).** Browsers abort in-flight requests on a local
network change while the serverless step keeps working, so the driver retries
dropped requests; the atomic per-run **step claim**
(`improvement_runs.step_claimed_at`) turns a retry that lands while a step is
live into a `busy` poll (stale claims expire after 6 minutes, above
`maxDuration`; a failing claim check falls through fail-open, a fresh in-flight
mark then answers `busy` as well). One Opus call per step, never two. The driver
also bridges platform error pages (a 504 when a step ran into `maxDuration`,
502/503 without the route's JSON) up to 3 times without progress
(`useStepLoop` `resumable`, [`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §2).

**Old runs.** A v1 run that is still `running` (started before 2026-10-06)
continues as a v2 run over its report's period on its next step (its existing
suggestions stay; a note says so). Finished v1 runs keep their original view
(rate table, Wirkungs-Check text, cards per lane); their suggestions are mapped
to owner lanes for the backlog.

## Measuring effects (the Wirkungs-Check)

Pure, deterministic and tested — the strategist only reads the result.

**What is measured** (`buildChangeList`, newest first, at most 8, nothing older
than 120 days):

- every **directive** since its live wording — the latest `created` / `updated`
  / `activated` event of `mo_directive_versions`; a deactivated one for the time
  it was live (window capped the day before the deactivation);
- every suggestion marked **Erledigt** (`status_changed_at`) that is not a
  directive (an adopted suggestion is measured through its directive, never
  twice). „Geplant“ is not live and not measured.

**On which metric** (`metricsForChange`): the suggestion's success metric (v2);
else a snapshot key or a metric label named in its expected effect (v1
free text, e.g. „Qualität „Abgesprungen“ sinkt“ → `quality.droppedOff`); else the
lane's default (`DEFAULT_LANE_METRICS`: chat & prompt → `quality.handledWell`,
Betrieb → `revenue.total`, Kampagnen → `campaigns.revenue`, Widget →
`chat.engagement`, Entwicklung → `journey.chatToOrder`, Recht →
`consent.newSubscribers`) — labelled „Standardkennzahl“. Up to two
**guardrails** per lane (`LANE_GUARDRAILS`, e.g. chat → `journey.chatToOrder`,
`quality.unmetNeed`; Kampagnen → `campaigns.unsubscribeRate`) flag side effects.

**Windows** (`changeWindow`): *after* = from the day after the change up to its
horizon (the success metric's `horizonDays`, default 14, 7–90), never including
today; *before* = the equally long period right before (the snapshot's own
previous period — the change day counts to *before*, conservative). An after
window of fewer than 7 days → **„Zu früh“**. Days are UTC calendar days, as in
the snapshot and on the KPI screen.

**Tests** (`effectStats`, on the sample sizes of **both** windows — the
snapshot's `base` / `previousBase`):

| Unit | Test |
| --- | --- |
| rate | two proportions (pooled z) |
| count | Poisson (equal windows) |
| per-chat ratio (`chat.clicksPerChat`, `chat.cartPerChat`) | Poisson rate test with chats as exposure |
| revenue amount (`revenue.total`, `campaigns.revenue`, `ledger.revenue`, `inbox.revenueAfterActed`) | the order count of the same orders (only when it moves the same way) |
| averages, scores, hours | none — direction only, confidence at most „niedrig“ |

A rate below 30 cases in either window, or fewer than 20 events in both windows
together, is a **small sample**: never „belastbar“.

**Verdicts** (`classifyMetricEffect`): **Deutlich besser / schlechter**
(|z| ≥ 1,96, adequate sample), **Eher besser / schlechter** (moved, but within
chance or without a test), **Unverändert** (< 1 Pp. for rates, < 5 % otherwise,
not significant), **Verändert** (a metric without a good direction),
**Nicht vergleichbar**, **Zu früh**, **Nicht messbar** (no value in a window,
or no event in either). Confidence starts at *hoch* (significant) / *mittel*
(tested) / *niedrig* (no test), drops to *niedrig* for a small sample and one
level each for confounders and for a window shorter than 14 days. Wording on
screen and in the prompts: a move „passt zu“ a change — never a cause.

**Measurement changes and confounders** (`measureChange`) inside the compared
span (*before.from*, *after.to*]:

- a **release** of [`kpi-releases.mjs`](../src/lib/kpi-releases.mjs) — every
  release is classified in `RELEASE_EFFECTS` (a test fails for an unclassified
  one) as a *measurement* change for some metric areas (counting, attribution,
  denominators: → **„Nicht vergleichbar“**, never an effect across it) and/or a
  *product* change (a confounder);
- a **switch** that flipped between the previous run and this one
  (`switchChanges` on the snapshots' switches; the exact day is unknown, so the
  whole span between the runs counts) — classified in `SWITCH_EFFECTS` the same
  way;
- **other changes** (directives, done suggestions) in the span — confounders.

The snapshot's section notes („erst ab dem … aussagekräftig“) say from when a
number means something; two windows under the same rule stay comparable, so a
note alone does not block a verdict — the release inside the span does.

**Target.** A v2 success metric with a target value reports „Ziel erreicht /
noch nicht erreicht“ on the after window.

**The period overview** (`snapshotMovers`): what got better and worse in the
run's period against the previous one — decision metrics only
(`MOVER_KEYS` = the report comparison keys plus a few outcomes), the same tests,
significant moves first, then by |z| (untested amounts by their relative size,
kept below significance); metrics with a measurement release inside the two
periods are listed apart. Computed on render from the stored snapshot.

## Suggestions (decision-grade)

Each v2 suggestion carries (`normalizeSuggestion`; schema in
`improvement-schemas.mjs`):

| Field | Meaning |
| --- | --- |
| `title`, `why`, `action` | the imperative, the reason with numbers, the first concrete steps |
| `lane` | who acts: `chat` (Chat & Prompt — a directive or a core-prompt change), `operator` (Betrieb), `campaign` (Kampagnen & Marketing), `frontend` (Widget & Shop — a task for the frontend agent), `developer` (Entwicklung), `legal` (Recht) — `OWNER_LANES` |
| `directive` | only chat & prompt: the ready-to-adopt directive text (≤ 600 chars, no legal promises, medical advice, discounts) |
| `evidence[]` | 1–4 items: a snapshot key and a text; the number is **frozen from the snapshot** (value, previous, both sample sizes) — never the model's; unknown keys are dropped |
| `expectedImpact` | quantified, with its assumption |
| `successMetric` | `{ key, target, direction, horizonDays }` — a snapshot key (validated; else taken from the reason; else none → the lane default is measured), the baseline frozen, a rate target written as 18 is read as 18 % |
| `impact`, `effort`, `confidence`, `risk`, `riskNote` | `hoch` / `mittel` / `niedrig` (effort shown as klein / mittel / groß) |
| `link` | the admin screen where it is acted on (`LINK_TARGETS` of the snapshot) |
| `refersTo` | `D<id>` / `S<id>` when it refines a directive or a backlog entry |
| `origin` | `engine`, or `report` with report id, position and title |

**Priority** = impact × confidence ÷ effort, damped by risk (`priorityScore`,
0.1–3) → **P1** (≥ 1.5), **P2** (≥ 0.75), **P3**. v1 rows count as confidence
„mittel“ and undamped.

**Dedup.** New suggestions are dropped when their title fingerprint matches a
non-dismissed suggestion of any run or one of this run (the prompt also lists
the whole backlog with its statuses). A dismissed idea may come back with new
evidence or from a new report.

**Statuses** (unchanged keys): `open` „Neu“ → `accepted` „Geplant“ →
`implemented` „Erledigt“ / `dismissed` „Verworfen“ (optional note, fed to the
next run). „Erledigt“ starts the measurement from that day; „Übernehmen“ creates
the directive and marks the suggestion Erledigt with a provenance note.

## Storage (no migration)

The v2 payloads live in the existing JSONB columns of migration 0044:

- `improvement_runs.baseline_json` = `{ version: 2, period, options: { reportId,
  importRecommendations }, snapshot }` — the business snapshot is the yardstick,
  as the v1 rates were (`upgradedFrom: 1` for an upgraded old run);
- `improvement_runs.delta_json` = `{ version: 2, measurement: { today, changes,
  measurements, switchHistory, previousRunId, done }, review, synthesis:
  { headline, summary }, imported, state: { attempts, efforts, model, notes } }`;
  `effect_check_md` = the review's summary;
- `improvement_suggestions`: the CHECK-ed `lane` column keeps `mo` (chat &
  prompt) / `shop` (everything else), `category` holds the owner lane,
  `rationale_md` / `proposal_md` / `directive_text` / `expected_effect` /
  `impact` / `effort` as before, and `evidence_json` = `{ version: 2, items,
  details: { lane, confidence, risk, riskNote, successMetric, link, refersTo,
  origin } }` (v1: a string array). Shapes: `improvement-types.ts`;
  `readSuggestionDetails` reads both.

`report_id … ON DELETE SET NULL` as before; a run without a report has
`report_title` „Geschäftsdaten <period>“.

## Mo's self-snapshot („Selbstbild“)

[`lib/mo-self-snapshot.ts`](../src/lib/mo-self-snapshot.ts) renders the FULL
German system prompt through the real `buildSystemPrompt` with a canonical
neutral context plus the **real** published Q&A knowledge and the **real** active
directives, and appends the model-facing tool copy and every persona addendum.
The chat & prompt pass reads it (capped at 32,000 characters) as „this is who
Mo is right now“; the admin sees the identical text in „Mos Selbstbild“. Its
SHA-256 is the **prompt version** (`improvement_runs.prompt_hash`, shown
truncated to 12 chars).

## Team directives — the live, versioned instruction layer

- Table `mo_directives` (migration 0044): short German instructions, each
  ≤ 600 chars, at most **20 active** — rendered into the system prompt by
  `renderTeamDirectives` (system-prompt-core) as
  „## Aktuelle Anweisungen vom motion sports Team“. Empty set → prompt
  **byte-identical** to before the feature.
- The chat loads them via `getCachedActiveDirectives()`
  ([`lib/directives-store.ts`](../src/lib/directives-store.ts)) — 5-min TTL
  cache, never throws.
- **Every** mutation (create / edit / activate / deactivate) appends to
  `mo_directive_versions` — the audit history shown per directive, and the
  event list the measurement reads (`listDirectivesWithEvents`).
- Each directive in „Anweisungen an Mo“ shows its **measured effect** from the
  newest completed v2 run (verdict, metric before → after, confidence, run), or
  „Noch nicht gemessen“.
- Admin mutations are audited via `recordAdminAccess`
  (`directive.create|update|toggle`, `improvement.suggestion.adopt`).

## HTTP surface

All under the admin proxy gate + `guardAdminPost`/`guardAdminGet`, JSON
envelopes like every other admin route:

| Route | Purpose |
| --- | --- |
| `GET /api/admin/improve` | run list (sidebar; with `version`) |
| `GET /api/admin/improve/[id]` | run detail incl. suggestions (v2: snapshot, measurement, review, synthesis) |
| `GET /api/admin/improve/backlog` | open and planned suggestions of every run (≤ 200) |
| `POST /api/admin/improve/run` | create a run: `{ reportId?, preset?: report \| 7d \| 14d \| 30d \| 90d \| custom, from?, to?, importRecommendations? }` (the old `{ reportId }` still works) |
| `POST /api/admin/improve/step` | advance one unit of work (`maxDuration 300`); returns `progress: { measured, toMeasure, attempt, effort, suggestions }` |
| `POST /api/admin/improve/delete` | delete run (+ suggestions, CASCADE) |
| `POST /api/admin/improve/suggestion` | set suggestion status (+ note) |
| `POST /api/admin/improve/adopt` | adopt a suggestion's directive text as a live directive (optional `content` = operator-edited text) |
| `POST /api/admin/directives/save` | create / edit (versioned) |
| `POST /api/admin/directives/toggle` | activate / deactivate (versioned, capped) |
| `GET /api/admin/directives/versions?id=` | one directive's append-only history |

## UI

[`VerbesserungTab.tsx`](../src/app/admin/VerbesserungTab.tsx) (server) seeds
[`verbesserung/VerbesserungWorkspace.tsx`](../src/app/admin/verbesserung/VerbesserungWorkspace.tsx)
with the runs, the completed reports (decision layer, recommendations still to
import), the open backlog, the directives with their measured effect, the
estimate of a new run (cost of the strategist passes, minutes, changes to
measure) and the self-snapshot. Master–detail like Analyse; deep link
`?run=<id>`. Screenshots: [`screenshots/2026-10-06-verbesserung/`](./screenshots/2026-10-06-verbesserung/).

- **Neuer Verbesserungslauf** ([`NewRunPanel.tsx`](../src/app/admin/verbesserung/NewRunPanel.tsx)):
  the four steps with what they will do, the Komplettanalyse (optional), the
  period, the import checkbox, model + estimate.
- **Running** ([`RunProgress.tsx`](../src/app/admin/verbesserung/RunProgress.tsx)):
  progress bar, phase checklist (strategist phases tagged „Opus 5.5“, a skipped
  Wirkungs-Check marked), measurement counter, attempt and thinking depth of a
  retried pass, elapsed time, cost so far, pause / resume, reconnect and busy
  states.
- **Lage** ([`RunOverview.tsx`](../src/app/admin/verbesserung/RunOverview.tsx)):
  the strategist's headline and summary (or a factual line), six headline
  tiles, „Besser geworden“ / „Schlechter geworden“ (● statistically clear,
  ○ tendency; each linked to its KPI section), „Offen nach Bereich“ (backlog by
  owner lane × P1–P3; a click filters the suggestions), the run's notes.
- **Wirkung umgesetzter Änderungen** ([`EffectsSection.tsx`](../src/app/admin/verbesserung/EffectsSection.tsx)):
  the review summary and one card per measured change — verdict, confidence,
  metric with its source, before → after with both sample sizes, the change and
  the test, windows, target, side effects, confounders (measurement changes in
  warning colour), the strategist's assessment with recommendation and next
  step, and the reasons behind the verdict.
- **Vorschläge** ([`SuggestionCard.tsx`](../src/app/admin/verbesserung/SuggestionCard.tsx)):
  „Dieser Lauf | Alle offenen“, a lane filter, cards sorted by status and
  priority — priority, lane, impact / effort / confidence / risk, origin,
  „bezieht sich auf“, the editable directive, why / what / expected impact /
  success metric (key, today, target, horizon), the evidence chips, risk, the
  admin link, and Übernehmen / Erledigt / Einplanen / Verwerfen / Wieder öffnen.
- **Kennzahlen & Messhinweise**: every snapshot section as a disclosure (metric
  table with the KPI link) and the data-quality notes (switch flips, snapshot
  caveats, switches).
- The standing tools: **Anweisungen an Mo** (with measured effect) and **Mos
  Selbstbild**.

## Cost & retention

A run is two or three strategist calls (≈ 0.70–0.90 € estimated, shown before
starting; the exact figure is priced from the stored usage and shown per run
and in the KI-Kosten KPI under call site `improvement`). Snapshot and
measurement cost no tokens. All improvement data is pseudonymous derived text
and aggregates (Cluster A — no identity values) and operator-managed (delete per
run, suggestions cascade). The retention cron deletes finished, fully decided
runs on the report window `ANALYTICS_REPORT_RETENTION_DAYS` — never a running
run, a run with an open suggestion, or the newest complete run
([`DATA_RETENTION.md`](./DATA_RETENTION.md)). `mo_directives` /
`mo_directive_versions` have no window.

## GDPR / legal

- Inputs are the PII-free business snapshot, the already-pseudonymous report
  chapters (passed through `scrubPii`) and Mo's own configuration; suggestion
  texts are scrubbed on normalisation.
- Directives are operator-reviewed instructions; the system prompt subordinates
  them to Mo's core rules and legal limits, and the strategist is told never to
  loosen consent, advertising or data-protection rules (lane `legal` instead).
