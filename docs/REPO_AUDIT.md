# Repo Audit — Headless Backend Conversion

> **SUPERSEDED — historical document.** This audit describes the one-time
> conversion to a headless backend with "only two HTTP endpoints"; the backend
> has grown far beyond that (9 public + 6 admin + 2 cron routes). It is kept
> for historical context only — do not treat anything here as the current
> state. For current contracts see [`API_CONTRACT.md`](./API_CONTRACT.md) and
> the other docs in this folder.

This audit categorizes every file under `src/` (plus root-level support
files) for the conversion of this repo from a Next.js + React chat app
into a headless backend that exposes only two HTTP endpoints. The chat
UI will be rebuilt later as a vanilla-JS widget inside a Shopify theme.

## API routes and their import graphs

### `src/app/api/chat/route.ts`

Direct imports:

- `ai` — `streamText`, `stepCountIs`, `convertToModelMessages`, `UIMessage`
- `@ai-sdk/anthropic` — `anthropic`
- `@/lib/system-prompt` — `buildSystemPrompt`
- `@/lib/tools` — `buildChatTools`
- `@/lib/persona` — `deriveArchetype`
- `@/lib/retrieval` — `retrieveForTurn`
- `@/lib/types` — `EMPTY_PROFILE`, `CustomerProfile`, `UpdateCustomerProfileArgs`

Transitive imports (via the modules above):

- `@/lib/system-prompt` → `@/lib/types`, `@/lib/persona`
- `@/lib/tools` → `ai`, `zod`, `@/lib/retrieval`, `@/lib/types`
- `@/lib/persona` → `@/lib/types`
- `@/lib/retrieval` → `openai`, `@/lib/product-catalog`, `@/lib/types`,
  `@/data/product-embeddings.json`
- `@/lib/product-catalog` → `@/lib/types`, `@/data/product-catalog.json`

Full set of internal modules the chat route transitively needs:

- `src/lib/system-prompt.ts`
- `src/lib/tools.ts`
- `src/lib/persona.ts`
- `src/lib/retrieval.ts`
- `src/lib/product-catalog.ts`
- `src/lib/types.ts`
- `src/data/product-catalog.json`
- `src/data/product-embeddings.json`

### `src/app/api/contact/route.ts`

Direct imports:

- `next/server` — `NextResponse`

No internal lib imports. The route is self-contained; it validates a
payload and logs to the server console.

## File-by-file classification

### BACKEND — keep

| Path | Role |
| ---- | ---- |
| `src/app/api/chat/route.ts` | Chat endpoint — extract profile, retrieve, stream |
| `src/app/api/contact/route.ts` | Contact-form submission endpoint |
| `src/lib/system-prompt.ts` | Builds per-turn system prompt |
| `src/lib/tools.ts` | Chat tool definitions for the AI SDK |
| `src/lib/persona.ts` | `deriveArchetype`, addendums, profile rendering |
| `src/lib/retrieval.ts` | Cosine retrieval + keyword fallback over the catalog |
| `src/lib/product-catalog.ts` | Loads + types the catalog JSON |
| `src/lib/types.ts` | Profile, Archetype, Product, tool arg types |
| `src/data/product-catalog.json` | Product catalog (consumed by retrieval) |
| `src/data/product-embeddings.json` | Embeddings index (consumed by retrieval) |
| `scripts/convert-catalog.mjs` | Regenerates the catalog JSON from a Shopify CSV |
| `scripts/build-embeddings.mjs` | Generates `product-embeddings.json` |

### FRONTEND UI — remove

| Path | Role |
| ---- | ---- |
| `src/app/page.tsx` | Chat home page (will be replaced with a plain health string) |
| `src/app/layout.tsx` | Root layout — pulls Geist fonts + `FeedbackButton` (will be reduced to a minimal layout so the build still works) |
| `src/app/globals.css` | Tailwind / chat styling — no longer needed |
| `src/app/contact/page.tsx` | Contact form page (form will live in Shopify) |
| `src/components/chat/chat-container.tsx` | Chat shell + `useChat` wiring |
| `src/components/chat/chat-input.tsx` | Chat input box |
| `src/components/chat/conversation-sidebar.tsx` | Conversation history sidebar |
| `src/components/chat/message-bubble.tsx` | Per-message bubble |
| `src/components/chat/persona-debug-strip.tsx` | Debug strip (`?debug=1`) |
| `src/components/chat/typing-indicator.tsx` | Typing dots |
| `src/components/chat/welcome-screen.tsx` | Empty-state welcome |
| `src/components/contact/contact-form.tsx` | Contact-form UI |
| `src/components/feedback-button.tsx` | Floating feedback button mounted in `layout.tsx` |
| `src/components/tools/add-to-cart-button.tsx` | Tool UI |
| `src/components/tools/contact-form-card.tsx` | Tool UI |
| `src/components/tools/product-card.tsx` | Tool UI |
| `src/components/tools/product-compare.tsx` | Tool UI |
| `src/components/tools/showroom-suggestion.tsx` | Tool UI |
| `src/hooks/use-conversations.ts` | Client-side conversation storage hook |
| `src/lib/conversations.ts` | localStorage helpers — only used by the sidebar hook, not the API |

### SHARED — keep (used by backend)

All of `src/lib/*` that is in the BACKEND table above is shared between
the (current) UI and the API routes — after the UI is removed, those
modules become backend-only and stay.

Confirmed not imported by either API route:

- `src/lib/conversations.ts` — only imported by `src/hooks/use-conversations.ts`,
  which is only imported by `src/app/page.tsx` and the sidebar. Safe to remove.

### Root / config — keep

- `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`,
  `eslint.config.mjs`, `postcss.config.mjs`, `.gitignore`, `README.md`
- `public/` — static assets, harmless to keep for now.

## Shopify theme files in this repo

None. There are no `sections/`, `templates/`, `locales/`, or `*.liquid`
files mixed into the repo. The Shopify theme lives elsewhere and the
widget will be added there in a future session.
