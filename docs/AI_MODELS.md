# AI models — which model does what, and why

Single source of truth in code: [`src/lib/ai-models.mjs`](../src/lib/ai-models.mjs)
(tested). Every Anthropic call site takes its model id and provider options
(thinking, effort, refusal fallback) from a **tier** there; prices live in
[`src/lib/ai-pricing.mjs`](../src/lib/ai-pricing.mjs). Evaluated 2026-09.

## Anthropic tiers

| Tier | Model | Thinking / effort | Call sites |
|---|---|---|---|
| `chat` | `claude-sonnet-5-5` | `between_tools` (no up-front thinking), effort `high` | `/api/chat` |
| `writer` | `claude-sonnet-5-5` | adaptive, effort `low` | marketing + campaign drafts, bundle suggestion, hero prompt, summary e-mail, persona top-questions (KPI + report), Q&A answer drafts |
| `analyst` | `claude-sonnet-5-5` | adaptive, effort `medium` | Verbesserung (Wirkungs-Check + Vorschläge), insights rollup, report customer synthesis, hero image check (vision) |
| `deep` | `claude-opus-5-5` | adaptive (always on), effort `medium` | central customer profile — nightly upkeep, "Neu generieren", report (structured output: summary + persona, level, budget, goals, owned, interests, next steps) |
| `bulk` | `claude-haiku-4-5` | none | per-conversation analysis, Q&A translation |

Every tier on a 5.x model sends `fallbacks: "default"` (Anthropic server-side
refusal fallback): a false-positive safety decline is re-run on the fallback
model inside the same call instead of failing the request.

### Why

- **Sonnet 5.5 replaces Sonnet 4.6** everywhere: the stronger model at a lower
  price ($2 / $10 per MTok vs $3 / $15; cache reads $0.20). Its tokenizer counts
  up to ~1.35× the tokens of Sonnet 4.6 for the same text, so the net saving per
  call is roughly 0–33 % — with a better model.
- **Chat stays thinking-free** (`between_tools`): the storefront chat is
  latency-sensitive and streams; `between_tools` is Sonnet 5.5's lowest thinking
  setting and keeps time-to-first-token where it was. Effort `high` (the highest
  level `between_tools` accepts) buys more thorough tool use and answers for
  somewhat more output tokens.
- **Opus 5.5 replaces Opus 4.8** for the customer profile: better and cheaper
  ($4 / $20 vs $5 / $25). The profile is the input every other generator reads
  (chat, Kampagne, mails, recommendations — see [`CUSTOMERS.md`](./CUSTOMERS.md)),
  so it gets the strongest model; upkeep only regenerates customers with new
  activity (≈ $0.10 each, `CUSTOMER_PROFILE_BATCH` per night). It always thinks; the output caps carry thinking
  headroom (`maxOutputTokensFor`) so answers are not truncated.
- **Haiku 4.5 stays** for high-volume, per-item work — still the current Haiku
  and the cheapest model that does these tasks well. The one-off insights rollup
  moved up to Sonnet 5.5 (one synthesis over hundreds of summaries, low volume),
  and so did the Q&A drafts: they become published, customer-facing answers, so
  draft quality saves operator editing. A scan request is capped at 15
  conversations so the sequential Sonnet passes fit the route's 300 s.

### Things the 5.5 models change (handled in code)

- **No forced `tool_choice`.** The chat's email-offer step
  (`api/chat/route.ts → prepareStep`) no longer pins `toolChoice`; it narrows the
  step's tools to `offer_email_summary` and appends a mid-conversation system
  note telling the model to call it. If the model answers in text instead, the
  turn simply ends — no ask is recorded (KPI `email_capture_ask_shown` shows the
  real rate).
- **Thinking blocks are bound to the request prefix.** The chat never replays
  them across turns (`sendReasoning: false` on the UI stream — the widget
  contract is unchanged) and drops them for the email-offer step and the steps
  after it, whose tool list differs.
- **Thinking counts toward `max_tokens`** — see `maxOutputTokensFor`.
- **Structured output** (`generateObject`) uses native `output_config.format`,
  which needs `@ai-sdk/anthropic` ≥ 3.0.125 (older versions fell back to a forced
  `json` tool, which the 5.5 models reject).

## OpenAI (unchanged, re-evaluated)

| Use | Model | Verdict |
|---|---|---|
| Hero images | `gpt-image-2`, quality `high`, fallback `gpt-image-1.5` | Current best; keep. |
| Product search embeddings | `text-embedding-3-small` | No successor; `-large` is +2 MTEB points at 6.5× the price and 2× the vector file — not worth it. |
| Voice (TTS) | `gpt-4o-mini-tts`, voice via `TTS_VOICE` | Still OpenAI's current TTS model. `marin` / `cedar` are newer voices worth a listening test (env only). |

### Voice (TTS)

`POST /api/tts` (`src/app/api/tts/route.ts`; widget contract: `docs/frontend/API_CONTRACT.md` §8).
Moved here from the widget contract — nothing the widget sends changes these.

| Var | Default (code and `.env.example`) | Notes |
| --- | --- | --- |
| `TTS_MODEL` | `gpt-4o-mini-tts` | Cost-efficient, multilingual, steerable via `instructions`. Legacy `tts-1` / `tts-1-hd` also work; they get no `instructions` (gated on the model family in code). |
| `TTS_VOICE` | `coral` | Warm, upbeat; clean German pronunciation. Full voice list in `.env.example`. |
| `TTS_INSTRUCTIONS` | empty → „Sprich natürliches, klares Hochdeutsch in einem freundlichen, energiegeladenen und motivierenden Ton.“ | Tone steering, `gpt-4o*` models only. A tempo hint derived from `TTS_SPEED` is appended. |
| `TTS_SPEED` | `1.1` | Clamped 0.25–4.0. Legacy `tts-1*` models take it as the numeric `speed`; `gpt-4o*` models reject `speed`, so it becomes a sentence in `instructions` (≥ 1.2 „flott“, ≥ 1.05 „zügig“, ≤ 0.95 „ruhig“). `1.0` restores the neutral pace. |

**Cost attribution.** Every request — single-shot or one streamed sentence — records one `ai_usage`
row: `call_site = 'tts'`, the synthesized **characters** in `input_tokens` (TTS is billed per
character; the `ai-pricing.mjs` entry is USD per million characters), `output_tokens = 0`,
`estimated = true` to flag the unit, attributed to the conversation resolved from `x-ms-session`. It
counts as chat-serving spend in the dashboard split (`CHAT_SIDE_CALL_SITES`, `ai-usage-store.ts`) and
does not enter the token-based cost per consultation. A streamed answer aggregates to the same
characters as the single-shot call, spread over more rows.

## Changing a model

Edit the tier in `ai-models.mjs`, add the price to `ai-pricing.mjs` (the test
fails otherwise), re-check the output caps and route `maxDuration`s of the tier's
call sites, and update this file.
