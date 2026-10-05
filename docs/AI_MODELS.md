# AI models — which model does what, and why

Single source of truth in code: [`src/lib/ai-models.mjs`](../src/lib/ai-models.mjs)
(tested). Every Anthropic call site takes its model id and provider options
(thinking, effort, refusal fallback) from a **tier** there; prices live in
[`src/lib/ai-pricing.mjs`](../src/lib/ai-pricing.mjs). Evaluated 2026-09. Other
docs name the tier and link here instead of repeating model ids.

## Anthropic tiers

| Tier | Model | Thinking / effort | Call sites |
|---|---|---|---|
| `chat` | `claude-sonnet-5-5` | `between_tools` (no up-front thinking), effort `high` | `/api/chat` |
| `writer` | `claude-sonnet-5-5` | adaptive, effort `low` | operator-reviewed and short generation: campaign drafts (`campaign-draft.ts`), campaign letter drafts (`campaign-letter-draft.ts`), campaign assist — audience and brief (`campaign-assist.ts`), marketing drafts and the Kunden → Brief letter draft of the 1:1 path (`marketing-draft.ts`), bundle suggestion, hero prompt (`email-hero.ts`), summary e-mail and summary download (`summary-email.ts`), persona top-questions (KPI + report), Q&A answer drafts (`qa-draft.ts`), „Frag Mo“ (`customer-ask.ts`), Eingang suggestions (`inbox-suggest.ts`), e-mail reply drafts in the Eingang (`inbox-mail.ts`), the **Kaufprofil** (`customer-profile.ts`) |
| `analyst` | `claude-sonnet-5-5` | adaptive, effort `medium` | Verbesserung (Wirkungs-Check + Vorschläge), insights rollup, report customer synthesis, hero image check (vision) |
| `deep` | `claude-opus-5-5` | adaptive (always on), effort `medium` | the **Vollprofil** of the central customer profile — nightly upkeep, the Kunden button, the Analyse report (structured output: summary + persona, level, budget, goals, owned, interests, next steps) |
| `bulk` | `claude-haiku-4-5` | none | per-conversation analysis, Q&A translation |

The profile depth decides the tier: people with a Mo chat or correspondence get
the Vollprofil (deep), Shopify customers with orders only the Kaufprofil
(writer). Nightly counts: `CUSTOMER_PROFILE_BATCH` (Vollprofil, default 30) and
`CUSTOMER_PROFILE_LIGHT_BATCH` (Kaufprofil, default `0` = off); `0` disables
either ([`CUSTOMERS.md`](./CUSTOMERS.md) "The central customer profile").

Every tier on a 5.x model sends `fallbacks: "default"` (Anthropic server-side
refusal fallback): a false-positive safety decline is re-run on the fallback
model inside the same call instead of failing the request.

### Prices

USD per million tokens, the defaults in `ai-pricing.mjs` (list prices checked
2026-09). The prompt-cache columns are the provider-wide multipliers on the
input price (`CACHE_READ_INPUT_MULTIPLIER` 0.1×, `CACHE_WRITE_INPUT_MULTIPLIER`
1.25× for the 5-minute TTL); only `/api/chat` sets cache breakpoints
([`PROMPT_CACHING.md`](./PROMPT_CACHING.md)).

| Model | Input | Output | Cache read | Cache write (5 min) |
|---|---|---|---|---|
| `claude-sonnet-5-5` (and its refusal fallback `claude-sonnet-5`) | $2 | $10 | $0.20 | $2.50 |
| `claude-opus-5-5` | $4 | $20 | $0.40 | $5.00 |
| `claude-haiku-4-5` | $1 | $5 | $0.10 | $1.25 |
| `text-embedding-3-small` | $0.02 | — | — | — |
| `gpt-image-2` (text input / image output tokens) | $5 | $30 | — | — |
| `gpt-image-1.5` (text input / image output tokens) | $5 | $32 | — | — |
| `gpt-4o-mini-tts` (per million **characters**) | $15.90 | — | — | — |

Older model ids stay in the table so historical `ai_usage` rows keep their
price; an unknown model is priced at 0. `MODEL_PRICES_JSON` overrides any entry
at runtime, `USD_EUR_RATE` (default 0.92) converts for the dashboard's
„KI-Kosten“ ([`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md) §5.6).

### Why

- **Sonnet 5.5 replaces Sonnet 4.6** everywhere: the stronger model at a lower
  price ($2 / $10 per MTok vs $3 / $15). Its tokenizer counts up to ~1.35× the
  tokens of Sonnet 4.6 for the same text, so the net saving per call is roughly
  0–33 % — with a better model.
- **Chat stays thinking-free** (`between_tools`): the storefront chat is
  latency-sensitive and streams; `between_tools` is Sonnet 5.5's lowest thinking
  setting and keeps time-to-first-token where it was. Effort `high` (the highest
  level `between_tools` accepts) buys more thorough tool use and answers for
  somewhat more output tokens.
- **Opus 5.5 replaces Opus 4.8** for the Vollprofil: better and cheaper
  ($4 / $20 vs $5 / $25). The profile is the input every other generator reads
  (chat, Kampagne, mails, recommendations — see [`CUSTOMERS.md`](./CUSTOMERS.md)),
  so the full profile gets the strongest model; upkeep only regenerates
  customers with new activity (estimate ≈ $0.10 each). It always thinks; the
  output caps carry thinking headroom (`maxOutputTokensFor`) so answers are not
  truncated. The Kaufprofil reads only purchases and campaign reactions — short
  input, one perspective — so it runs on the cheaper writer tier.
- **Haiku 4.5 stays** for high-volume, per-item work — still the current Haiku
  and the cheapest model that does these tasks well. The one-off insights rollup
  moved up to Sonnet 5.5 (one synthesis over hundreds of summaries, low volume),
  and so did the Q&A drafts: they become published, customer-facing answers, so
  draft quality saves operator editing. A scan request is capped at 15
  conversations (default 10) so the sequential Sonnet passes fit the route's
  300 s.

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

## OpenAI

| Use | Model | Override | Verdict |
|---|---|---|---|
| Hero images | `gpt-image-2` (native 1536×720, retried in 3:2), fallback `gpt-image-1.5`; quality `high` (`heroImageAttempts`, `email-hero-variants.mjs`) | `EMAIL_HERO_IMAGE_MODEL` (primary model), `EMAIL_HERO_IMAGE_QUALITY` (`low` \| `medium` \| `high`) | Current best; keep. Pipeline (reference photos, check, cost): [`EMAIL_DESIGNS.md`](./EMAIL_DESIGNS.md) „Hero images“. |
| Product search embeddings | `text-embedding-3-small` (catalog sync, the stock webhook's re-embed, the query at retrieval) | — | No successor; `-large` is +2 MTEB points at 6.5× the price and 2× the vector file — not worth it. |
| Voice (TTS) | `gpt-4o-mini-tts`, voice `coral` | `TTS_MODEL`, `TTS_VOICE` (below) | Still OpenAI's current TTS model. `marin` / `cedar` are newer voices worth a listening test (env only). |

### Voice (TTS)

`POST /api/tts` (`src/app/api/tts/route.ts`). The widget contract is
[`frontend/API_CONTRACT.md`](./frontend/API_CONTRACT.md) §8; model, voice, tone
and speed are server configuration — nothing the widget sends changes them.

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
