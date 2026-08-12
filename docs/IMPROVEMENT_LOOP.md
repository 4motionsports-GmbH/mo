# Verbesserung — the closed improvement loop

The **Verbesserung** tab (`/admin?tab=verbesserung`) turns the Komplettanalyse
from a report into a **closed loop**: Mo reads his own analysis, criticises the
shop AND himself, the operator decides, and the next run measures whether the
decided changes actually moved the numbers.

```
Komplettanalyse (Analyse tab)          Mo's self-snapshot
   sections: KPIs, insights,           rendered system prompt + tools +
   personas, customer knowledge        personas + Q&A + directives (hashed)
              \                          /
               ▼                        ▼
        ┌─────────────────────────────────────┐
        │  IMPROVEMENT RUN (2 model passes)   │
        │  1. Wirkungs-Check  — did the       │
        │     accepted/implemented measures   │◄── prior suggestions + KPI
        │     move the KPIs? (honest, no      │    delta vs. previous run
        │     causality claims)               │
        │  2. Vorschläge — evidence-based     │
        │     suggestions in two lanes        │
        └─────────────────────────────────────┘
                          │
                          ▼
        suggestions: open → accepted → implemented / dismissed   (HUMAN)
                          │
          lane 'mo' + category 'anweisung': one-click adopt as a
          LIVE, versioned team directive in Mo's system prompt   (HUMAN)
                          │
                          ▼
        next run's baseline delta + Wirkungs-Check  ──────────► loop closed
```

## Human-in-the-loop boundary (unchanged, load-bearing)

The Gespräche insights rollup has always carried the note that Mo **never**
rewrites his own prompt or behaviour automatically
(`src/lib/conversation-insights.ts` `BOUNDARY_NOTE`). This feature keeps that
boundary exactly:

- The engine only ever **proposes**. No code path writes to `mo_directives`,
  the catalog, the knowledge base or anything behaviour-affecting from a model
  output.
- The ONLY way a suggestion becomes behaviour is an explicit, authenticated
  admin action: **„Als Anweisung übernehmen"** (or the operator implementing a
  change themselves and marking the suggestion `implemented`).
- The core system prompt stays **in git** (`src/lib/system-prompt-core.mjs`,
  byte-pinned by the golden test). Suggestions of category `prompt_kern`
  describe a concrete wording change for a human to apply as a code change.

## The two lanes

| Lane | Categories | Meaning |
| --- | --- | --- |
| `shop` | `sortiment`, `produktdaten`, `preis_angebot`, `ux_storefront`, `marketing`, `prozess` | Improvements to the online store itself. |
| `mo` | `anweisung`, `prompt_kern`, `wissen`, `tools`, `persona`, `faehigkeit` | Improvements to Mo — prompt, knowledge, tool behaviour, personas, new capabilities. |

Every suggestion carries: `title`, `rationale_md` (WHY, with evidence),
`proposal_md` (WHAT exactly), `expected_effect` (which KPI should move — the
hook the next Wirkungs-Check grabs), `impact`/`effort` (`hoch|mittel|niedrig`),
`evidence` strings, and — only for `mo`/`anweisung` — a ready-to-adopt
`directive_text`. Vocabularies, bounds and the defensive JSON parser live in
[`lib/improvement-core.mjs`](../src/lib/improvement-core.mjs) (node:test-able,
like every other pure core).

## Mo's self-snapshot ("Selbstbild")

[`lib/mo-self-snapshot.ts`](../src/lib/mo-self-snapshot.ts) renders the FULL
German system prompt through the real `buildSystemPrompt` with a canonical
neutral context (empty profile, unknown archetype, no retrieved products) plus
the **real** published Q&A knowledge and the **real** active directives, and
appends the model-facing tool copy and every persona addendum.

- The engine receives this text as "this is who you are right now" — so Mo
  criticises his actual prompt, not a paraphrase.
- The admin sees the **identical** text in the „Mos Selbstbild" card.
- Its SHA-256 is the **prompt version** (`improvement_runs.prompt_hash`,
  displayed truncated to 12 chars). It changes when the code prompt (git), the
  published knowledge or the directive layer changes — so every suggestion is
  attributable to the exact self it criticised.

## Team directives — the live, versioned instruction layer

The user-editable "secured input field" for Mo's behaviour, without moving the
prompt out of git:

- Table `mo_directives` (migration 0044): short German instructions, each
  ≤ 600 chars, at most **20 active** — rendered into the system prompt by
  `renderTeamDirectives` (system-prompt-core) as
  „## Aktuelle Anweisungen vom motion sports Team", right after the Q&A
  knowledge block. Empty set → prompt **byte-identical** to before the feature
  (asserted in `system-prompt-core.test.mjs`; the golden is untouched).
- The chat loads them via `getCachedActiveDirectives()`
  ([`lib/directives-store.ts`](../src/lib/directives-store.ts)) — same 5-min
  TTL cache + never-throws contract as the published Q&A block, so a change is
  live in the chat within minutes and a DB failure never breaks a turn.
- **Every** mutation (create / edit / activate / deactivate) appends to
  `mo_directive_versions` — the full audit history ("all past states of the
  editable prompt layer") shown per directive in the admin. Deactivating never
  deletes.
- The English prompt injects the German directive texts unchanged under an
  English framing header (like un-translated Q&A pairs — Mo switches language
  himself). The prompt tells Mo that core rules win over directives on
  conflict.
- Admin mutations are audited via `recordAdminAccess`
  (`directive.create|update|toggle`).

## The run — data model + stepping

Tables (migration [`0044_improvement_loop.sql`](../migrations/0044_improvement_loop.sql)):

- `improvement_runs` — one row per engine pass over one completed report:
  denormalized report title/range (survives report deletion via
  `report_id … ON DELETE SET NULL`), `prompt_hash`, `baseline_json`,
  `delta_json`, `effect_check_md`, status/phase mini state-machine, per-model
  `usage` (EUR priced in JS on read, like the Komplettanalyse).
- `improvement_suggestions` — the structured output; lifecycle
  `open → accepted → implemented / dismissed` with `status_note` and
  timestamps. Fingerprint (qa-core-style normalisation) deduplicates new
  output against all prior non-dismissed suggestions in code before insert.

Generation is **client-stepped** exactly like the Komplettanalyse: `POST
/api/admin/improve/run { reportId }` creates the row instantly; the workspace
then calls `POST /api/admin/improve/step { id }` until `done` — ONE bounded
model call per request. The suggestion work is deliberately split **per lane**
(`wirkung` → `vorschlaege_shop` → `vorschlaege_mo`, ≤ 6 suggestions and ~2.5k
output tokens each; the shop pass also omits the big self-snapshot input): a
single monolithic pass proved to outlive the serverless function budget in
production (the function was killed mid-call, surfacing as a dropped
connection in the admin). The step route runs with `maxDuration = 300` for
headroom; a legacy `vorschlaege` phase value (pre-split runs) resumes as the
shop pass. Orchestrator:
[`lib/improvement-generate.ts`](../src/lib/improvement-generate.ts). All
passes use **Sonnet** (`claude-sonnet-4-6`) and record into `ai_usage` under
the new call site `improvement`.

The `wirkung` phase runs only when there is BOTH a previous completed run (a
baseline to diff against) and at least one prior accepted/implemented
suggestion; otherwise the run starts straight at `vorschlaege`.

## KPI baseline + honest measurement

`computeKpiBaseline(sections)` reduces a report to comparable **rates** (shares
of the window's conversations: email capture, cart clicks, checkout offers,
no-bot-answer, analysis coverage, quality distribution). Absolutes are
deliberately not compared — windows differ in traffic and length. The delta vs.
the previous run's baseline is rendered as a table in the UI and fed to the
Wirkungs-Check pass, whose prompt hard-requires: no causality claims (movement
"passt zur Maßnahme", nothing more), small samples called out, unmeasurable
measures labelled "nicht messbar" instead of invented.

## HTTP surface

All under the admin proxy gate + `guardAdminPost`/`guardAdminGet`, JSON
envelopes like every other admin route:

| Route | Purpose |
| --- | --- |
| `GET /api/admin/improve` | run list (sidebar) |
| `GET /api/admin/improve/[id]` | run detail incl. suggestions |
| `POST /api/admin/improve/run` | create run over a completed report |
| `POST /api/admin/improve/step` | advance one model call (`maxDuration 300`) |
| `POST /api/admin/improve/delete` | delete run (+ suggestions, CASCADE) |
| `POST /api/admin/improve/suggestion` | set suggestion status (+ note) |
| `POST /api/admin/improve/adopt` | adopt a suggestion's directive text as a live directive |
| `GET /api/admin/directives` | directive list + limits |
| `POST /api/admin/directives/save` | create / edit (versioned) |
| `POST /api/admin/directives/toggle` | activate / deactivate (versioned, capped) |
| `GET /api/admin/directives/versions?id=` | one directive's append-only history |

## UI

[`VerbesserungTab.tsx`](../src/app/admin/VerbesserungTab.tsx) (server) seeds
[`verbesserung/VerbesserungWorkspace.tsx`](../src/app/admin/verbesserung/VerbesserungWorkspace.tsx)
(client master–detail like the Analyse tab): run sidebar + new-run panel (pick
a completed Komplettanalyse), the run driver with live phase labels, the
Wirkungs-Check card (delta table + narrative), suggestion cards grouped
Mo/Shop with the status workflow and the adopt button
([`SuggestionCard.tsx`](../src/app/admin/verbesserung/SuggestionCard.tsx)),
and the two standing cards:
[`DirectivesCard.tsx`](../src/app/admin/verbesserung/DirectivesCard.tsx)
(editor + history) and
[`SelfSnapshotCard.tsx`](../src/app/admin/verbesserung/SelfSnapshotCard.tsx)
(prompt viewer + version hash).

## Cost & retention

A run is 1–2 Sonnet calls (typically well under €0.50; the exact figure is
priced from the stored usage and shown per run and in the KI-Kosten KPI under
call site `improvement`). All improvement data is pseudonymous derived text
(Cluster A discipline — no identity values), operator-managed (delete per run),
and not part of the automatic retention sweeps — same policy as the stored
Komplettanalysen.

## GDPR / legal

- Inputs are the already-pseudonymous report sections and Mo's own
  configuration — no emails, no identity values enter the engine or its tables.
- Directives are operator-reviewed instructions; the system prompt explicitly
  subordinates them to Mo's core rules and legal limits (no medical advice, no
  price negotiation, …), and the suggestion prompt forbids directive texts with
  legal promises, medical advice or discounts.
