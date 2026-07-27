# Prompt Caching (Anthropic)

How the backend uses Anthropic prompt caching to cut chat token cost, and how
the savings are accounted for in the KI-Kosten KPI.

## What prompt caching is

Anthropic bills a request's input in three buckets:

| Bucket | Price | Meaning |
| --- | --- | --- |
| Uncached input | 1× input price | Tokens processed fresh |
| Cache **write** | 1.25× input price | A prefix written to the provider-side cache (5-minute TTL) |
| Cache **read** | **0.1× input price** | A prefix served from the cache |

Caching is a **prefix match** over the exact rendered bytes, in the order
`tools → system → messages`. A `cache_control` breakpoint marks "cache the
prefix up to here"; any byte change before a breakpoint invalidates everything
after it. Break-even is a single reuse (1.25× + 0.1× ≪ 2×).

## Where we cache: the chat route (`/api/chat`)

The chat turn is an **agentic loop** (up to `MAX_STEPS_PER_TURN` = 6 steps +
the forced email-offer step). Every step is a full API request that re-sends
the tools, the system prompt and the whole conversation history. Before
caching, a 4-step turn billed that prefix 4× at full price; now step 1 writes
it and steps 2–4 read it at 0.1×.

Three breakpoints (Anthropic allows max 4 per request):

1. **Tools** (`src/lib/tools.ts`, marker on `show_contact_form` — the last
   *always-active* tool; `offer_email_summary` can be withheld via
   `activeTools`, so a marker there would disappear with it). The tool
   definitions are byte-stable per locale → this prefix also hits **across
   turns, sessions and users**.
2. **System prompt** (`src/app/api/chat/route.ts` — the system prompt travels
   as a leading `role: "system"` message because the AI SDK's `system` string
   option cannot carry `providerOptions`). The system prompt embeds per-turn
   retrieval (products, profile, memory), so this entry mostly hits **within a
   turn's steps**, not across turns.
3. **Last history message** (`route.ts`, set after the greeting/pivot
   mutations). Covers the conversation history + this turn's user message for
   steps 2..n.

The prompt **bytes are unchanged** — only `cache_control` markers are added —
so model behaviour and answer quality are identical.

### What deliberately is *not* cached

The back-office call sites (conversation analysis/insights, campaign +
marketing drafts, Q&A drafts/translation, top questions, bundle suggestions,
summary email, customer profile) have short instruction prompts dominated by
per-item dynamic data. They sit below Anthropic's minimum cacheable prefix
(1024 tokens on Sonnet 4.6, 4096 on Haiku 4.5) and/or share no reusable
prefix — a marker there would be a silent no-op or pay the 1.25× write premium
with no reads. Leave them uncached.

### Known cache-limiting behaviour (accepted)

- The system prompt changes every turn (pre-retrieved products block), which
  invalidates the messages tier across turns. Cross-turn caching of the
  conversation history would require moving the per-turn retrieval block out of
  the system prompt into the latest user turn — a prompt restructure with
  behavioural risk; not done. Within-turn step caching (the big win) is
  unaffected.
- When the email-offer ask cap is reached, `offer_email_summary` is filtered
  from `activeTools` — the tool list changes and the tools-tier entry misses
  once, then re-caches in the new shape.
- The forced email-offer step (`prepareStep` → `activeTools:
  ["offer_email_summary"]`) sends a different tool list for that one step —
  a full miss for that step only.

## Cost accounting (KI-Kosten KPI)

`ai@6` reports `usage.inputTokens` as the **total** input *including* cached
tokens, with the splits in `usage.inputTokenDetails.{cacheReadTokens,
cacheWriteTokens}`. Pricing the total at the full input rate would overstate
spend once caching is live, so:

- Migration **0039** adds `cache_read_tokens` / `cache_write_tokens` to
  `ai_usage` (subsets of `input_tokens`; old rows and non-caching call sites
  stay 0/0 and price exactly as before).
- `lib/ai-pricing.mjs` prices `uncached×1 + reads×0.1 + writes×1.25` of the
  model's input rate (`CACHE_READ_INPUT_MULTIPLIER` /
  `CACHE_WRITE_INPUT_MULTIPLIER`).
- The chat route records the splits via `persistTurn` → `recordAiUsage`.

## Verifying it works

After deploying, check a few chat `ai_usage` rows:

```sql
SELECT created_at, input_tokens, cache_read_tokens, cache_write_tokens
  FROM ai_usage WHERE call_site = 'chat' ORDER BY id DESC LIMIT 20;
```

Healthy signal: tool-using turns show `cache_read_tokens` at a large share of
`input_tokens`. If `cache_read_tokens` stays 0 across multi-step turns, a
silent invalidator crept into the prefix (e.g. a timestamp or random id
rendered into tools/system before the breakpoints) — diff two rendered
requests byte-by-byte.

## Operational notes

- No Anthropic account setting or opt-in is required — caching is a
  per-request feature triggered by the `cache_control` markers.
- Cache TTL is 5 minutes, refreshed on read. Chat steps (seconds apart) and
  consecutive turns comfortably fit; the 1-hour TTL would double the write
  premium for no benefit here.
- Caches are per-model: changing `CHAT_MODEL` starts cold (first requests pay
  the write premium again). The same applies after any deploy that changes
  prompt/tool bytes.
