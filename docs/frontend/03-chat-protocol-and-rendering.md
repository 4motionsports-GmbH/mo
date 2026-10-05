# 03 — Chat protocol, tools and rendering

> **Source of truth:** the theme repo `ms_shopify_clone`, branch `main` at `3e87341` (PR #73 "customer platform" `a0df103` + the fixes `8d0a0c4` + `3e87341`; README). Every claim comes from reading `assets/ms-chat-widget.js` (and the Liquid that feeds it). The contract is cited as **AC §n** (`API_CONTRACT.md`) and **ACCT §n** (`ACCOUNT_CONTRACT.md`): field lists, limits, status codes and server rules live there and are not re-specified here; this chapter describes what the widget does with them. Production state: README §4.
> Code locations are given as `file → function / key / selector`. Line numbers are left out on purpose.

This chapter covers one conversation turn from start to finish: what starts a turn, the exact `POST /api/chat` request, the page context and browsing trail, how the SSE stream is parsed and assembled, and how each tool is rendered (what data it fetches, which buttons it shows, which KPI events it fires, and its edge cases). It also covers Markdown rendering, streaming and typing states, errors, rate limits and rollback, local history persistence, "Neue Beratung" and `conversationKey` threads, the PDF summary download, voice input, hands-free voice mode with streaming TTS, and the feedback entry point. It closes with findings for backend decisions and open questions.

**Contents**

1. [Turn lifecycle at a glance](#1-turn-lifecycle-at-a-glance)
2. [What starts a turn (and what does not)](#2-what-starts-a-turn-and-what-does-not)
3. [The `POST /api/chat` request](#3-the-post-apichat-request)
4. [Page context and browsing trail](#4-page-context-and-browsing-trail)
5. [Parsing the SSE stream](#5-parsing-the-sse-stream)
6. [Assembly into parts and the tool registry](#6-assembly-into-parts-and-the-tool-registry)
7. [Product hydration (`GET /api/products`)](#7-product-hydration-get-apiproducts)
8. [Visible tools, one by one](#8-visible-tools-one-by-one)
9. [Markdown rendering](#9-markdown-rendering)
10. [Typing, streaming and input states](#10-typing-streaming-and-input-states)
11. [Errors, rate limit and rollback](#11-errors-rate-limit-and-rollback)
12. [Local history: persistence, cap and restore](#12-local-history-persistence-cap-and-restore)
13. [New chat, "Neue Beratung" and `conversationKey` threads](#13-new-chat-neue-beratung-and-conversationkey-threads)
14. [Signed-in summary download (PDF)](#14-signed-in-summary-download-pdf)
15. [Header "Per E-Mail teilen" entry point](#15-header-per-e-mail-teilen-entry-point)
16. [Feedback entry point (`POST /api/feedback`)](#16-feedback-entry-point-post-apifeedback)
17. [Voice: dictation, voice mode, TTS](#17-voice-dictation-voice-mode-tts)
18. [KPI events fired in this chapter's scope](#18-kpi-events-fired-in-this-chapters-scope)
19. [What leaves the browser per turn](#19-what-leaves-the-browser-per-turn)
20. [Findings for backend decisions (bugs, gaps, KPI levers)](#20-findings-for-backend-decisions-bugs-gaps-kpi-levers)
21. [Open questions / uncertainties](#21-open-questions--uncertainties)

---

## 1. Turn lifecycle at a glance

```
A) composer / voice / product CTA
  └─ sendMessage(text, context?)
       ├─ maybeMintConversationKey()     (signed-in + fresh thread only)
       ├─ push optimistic user message → render bubble → saveHistory() → track('message_sent')
       ├─ startStream()                  (shared path, below)
       └─ +700 ms: maybeShowConsentGate()  (first-message popup — see 04 §9)

B) nudge greeting   [messages: []]
  └─ sendContextGreeting(context)
       ├─ maybeMintConversationKey(true)
       └─ startStream({ userMsg: null })   (no user message, no message_sent, no popup)

startStream()  — shared by A and B
       ├─ state.streaming = true, input disabled, "generating" avatar row
       ├─ fetch POST {apiBase}/api/chat  (headers + body, §3)
       ├─ !res.ok → handleChatHttpError() → rollback (§11)
       └─ res.ok → reader loop → processLine() → handleEvent()
                ├─ text-* → feedCanonical({type:'text'}) → Markdown bubble (§9)
                ├─ tool-input-available → feedCanonical({type:'tool-<name>'}) → buildToolCard() (§8)
                ├─ tool-output-available → stored on the history part (never rendered)
                ├─ error → streamErrored = true
                └─ finish / [DONE] / socket close → finalizeStream()
                       → push assistant message → saveHistory() → re-enable input → voice reply (§17)
```

The optimistic user message, `saveHistory()` before the stream, `updateShareBtn()`, `track('message_sent')` and the +700 ms `maybeShowConsentGate()` belong to `sendMessage()` **only**. `sendContextGreeting()` calls just `clearNotice()`, `maybeMintConversationKey(true)`, `clearWelcome()` and `startStream({ userMsg: null })`, so the nudge greeting turn never triggers the first-message sign-in/consent popup (05 §7).

Key properties:

- The **full in-memory history** goes to the backend on every turn (`toWire(messages)`). The backend is stateless per request apart from persistence (AC §2).
- Rendering is **incremental and idempotent**. Text bubbles re-render from the accumulated string on each delta. Tool cards are keyed by `toolCallId` and never duplicated.
- The reply is **never conditional on the gate/popup**. The popup overlays the panel while the reply streams behind it.
- There is **no client-side timeout** and **no user-facing "stop generating" button**. The only cancellation is internal (`abortActiveStream`). `dropSessionHistory()` calls it on: sign-out, erase, session rotation in another tab (`onSidChangedElsewhere()`), and when the server says a previously signed-in session has ended (`endedSignInCleanup()`: a definitive not-signed-in answer from `/api/auth/me` in `probeAuth()`, or a 401 on any `/api/account/*` call via `accountUnauthorized()`, both only if the device was signed in). `startNewChat()` ("Neuen Chat starten", "Neue Beratung") and `openConversation()` (opening a past conversation) call it too (§13).

---

## 2. What starts a turn (and what does not)

There are exactly four code paths that call `/api/chat` (grep-complete: `sendMessage(` / `sendContextGreeting(` call sites).

| Trigger | Code path | Visible user bubble? | `context` sent? | Fires `message_sent`? | Notes |
| --- | --- | --- | --- | --- | --- |
| **Composer**: Enter (without Shift) or send button | `textarea keydown` / `sendBtn click` → `onSend()` → `sendMessage(text)` | Yes (the typed text) | **No** | Yes | Blocked while `state.streaming` or `state.rateLocked`. Empty/whitespace input is ignored. In voice mode, a typed send stops current playback but keeps voice mode on. |
| **Voice mode** final transcript | `recognition.onend` → `voiceSubmit(text)` → `sendMessage(text)` | Yes (transcript) | No | Yes | Only in hands-free voice mode (§17). Plain dictation only fills the textarea; the user still presses send. |
| **Product-page CTA** "Detaillierte Beratung zu diesem Produkt" | delegated click on `.ms-chat-product-cta` (`bindProductCtas()`) → `openWithProduct(id, title)` → `sendMessage(primer, context)` | Yes — a **primer** text, see below | **Yes**, `type:"product"` | Yes, plus `product_cta_opened` | If a reply is streaming or the rate lock is active, the panel just opens and nothing is sent. Works with or without existing history (appends a normal turn). Also callable as `window.MS_CHAT.openWithProduct(id, title)` (public API, same path, see below). |
| **Nudge bubble click** (fresh conversation only) | `showNudge()` click → `openPanel()` → `sendContextGreeting(ctx)` | **No** (`messages: []`) | Yes, `type:"product"` on product pages, else `type:"browsing"` (if a trail exists) | No (`nudge_clicked` instead) | **Popup? No**: `sendContextGreeting()` never schedules `maybeShowConsentGate()`. Only when `messages.length === 0`, not streaming, not rate-locked, and a context could be built. Otherwise the panel just opens. The backend streams a context-aware greeting as the first assistant message (AC §2 "Fresh open"). |

**Product CTA primer text** (`openWithProduct()`), German verbatim:

- With title: `Ich interessiere mich für „<title>". Kannst du mich zu diesem Produkt beraten?` (note: opening `„`, closing ASCII `"`).
- Without title: `Kannst du mich zu diesem Produkt beraten?`
- English (`/en`): `I'm interested in "<title>". Can you advise me on this product?`

**Public entry point:** `init()` exposes `window.MS_CHAT.openWithProduct = openWithProduct`. Any theme section, app embed or custom Liquid can start a product-primed turn (primer user message + `context`) without the `.ms-chat-product-cta` markup and without a widget release. No theme code calls it today (grep). Pass the **handle** as `id` to skip the numeric-id swap logic (§4.3): a handle never equals `PAGE_CTX.productId`, so it is sent unchanged. Note that `product_cta_opened` then carries whatever `id` was passed.

The CTA deliberately uses a primer *user* message instead of the `messages: []` greeting, so the consultation still works if the backend drops the `productId` (code comment in `openWithProduct()`).

**Things that do NOT start a turn** (no `/api/chat` call):

- **Campaign deep link** `?mo=open` / `#mo-open` (+ `mo_new=1`, `mo_view=fullscreen`): `handleMoDeepLink()` only opens the panel (optionally on a fresh thread / in modal view). No greeting, no send. The campaign token `mo_c` rides on the *next* chat request instead (§3.2).
- Sign-in return (`?ms_auth`/`ms_code`), opening the history drawer, opening a past conversation (`openConversation()` loads a transcript but sends nothing).
- Launcher click, header buttons, "Per E-Mail teilen", feedback card, tool-card buttons.
- Product hydration and TTS calls go to other endpoints (§7, §17).

> **Important for backend decisions:** a normally typed message carries **no page context at all**. Mo only knows the current product page if the visitor used the product CTA or clicked a nudge on that page. The trail and `PAGE_CTX` exist in the browser but are not attached to typed turns (§4.4, §20). The contract already defines page facts for typed turns (AC §2 "Optional `context`", `source: "page"`; the backend uses them only with `CHAT_PAGE_CONTEXT_ENABLED`, default off in code); the widget side is `tasks/2-page-context.md`.

---

## 3. The `POST /api/chat` request

Built in `startStream()`. URL: `{CFG.apiBase}/api/chat` (default `https://mo.motionsports.de`, setting `ai_advisor_backend_url`). Contract: AC §2 "Required request headers" and "Request body"; the tables below say what the widget sends and when.

### 3.1 Headers

| Header | Value | Source |
| --- | --- | --- |
| `Content-Type` | `application/json` | constant |
| `x-ms-chat-key` | theme setting `ms_chat_shared_secret` (`CFG.chatKey`) | `CHAT_KEY`. If empty, the widget never mounts. |
| `x-ms-session` | device session id (UUID, `localStorage['ms-chat-sid']`) | `sid` |
| `x-ms-locale` | `"de"` or `"en"` | `LOCALE` (Liquid `localization.language.iso_code`, forced to `en` on `/en…` paths) |
| `Origin` | set by the browser | the backend's origin allow-list (AC §1 "Security model") |

The request uses an `AbortController` signal when available (for internal cancellation only).

### 3.2 Body fields

| Field | When present | Value |
| --- | --- | --- |
| `messages` | **always** | `toWire(messages)`: the full in-memory history (see §3.3). `[]` for the context greeting. |
| `locale` | **always** | same as `x-ms-locale` |
| `context` | only for the product CTA and the nudge greeting (§2) | see §4.3 (no `source` field; AC §2 defines it, `tasks/2-page-context.md` adds it) |
| `conversationKey` | only if `auth.signedIn && activeConversationKey` | client-generated UUID of the active thread (§13). **Omitted** for anonymous and email-only visitors. **Also omitted for a signed-in visitor whose auth has not settled yet on this page load**, even when `activeConversationKey` (restored from `ms-chat-convkey:<sid>` by `loadConvKey()`) already exists. In practice this hits the product-page CTA, which sends right after `openPanel()` (§13 edge case, §20 finding 21). |
| `customer` | only after a successful `POST /api/capture-email` **in this page load** | `{ "email": "<captured address>" }`. Held in the in-memory variable `capturedEmail` only. It is reset on navigation and on session drop (`dropSessionHistory()`), nowhere else. Never stored. AC §2 "Optional `customer`". Attached whenever `capturedEmail` is set, **with no auth check**: if auth later settles as signed in during the same page view (e.g. `visibilitychange` re-detection after a shop login in another tab), the captured address still rides along. **It also survives `startNewChat()`**: the anonymous/email-only branch calls `rotateSession()`, which does not touch `capturedEmail`, so after "Neuen Chat starten" (header icon or the `payload_too_large` notice button) later turns send `customer.email` under the **new** sid. The backend only injects memory when the capture came from the same `x-ms-session` (AC §2), so memory silently stops working while the address keeps leaving the browser (§20 finding 19). |
| `campaignToken` | while `sessionStorage['ms_mo_c']` holds a valid token | the `mo_c` value from a campaign landing URL, re-validated against `/^[A-Za-z0-9_-]{16,64}$/` on read. It is deleted only when a chat response comes back `res.ok`, so a failed first send retries it on the next turn. It rides on the first chat request of the **tab session**, which can be the greeting, a CTA turn or a typed message, even pages later. AC §2 "Optional `campaignToken`". |

Example (signed-in visitor, product CTA, campaign landing):

```json
{
  "messages": [
    { "id": "u-3f1c…", "role": "user", "parts": [{ "type": "text", "text": "Ich interessiere mich für „ATX Rack\". Kannst du mich zu diesem Produkt beraten?" }] }
  ],
  "locale": "de",
  "context": { "type": "product", "productId": "atx-rack-pro", "productTitle": "ATX Rack",
               "recentlyViewed": [{ "type": "product", "id": "atx-rack-pro", "name": "ATX Rack" }] },
  "conversationKey": "9b2e…",
  "campaignToken": "Hk3f9QWm2xVbT0aLr7c1sYpNeD5uZ8gJ"
}
```

### 3.3 `toWire` history shape

`toWire(msgs)` maps each stored message to `{ id, role, parts }` with no further filtering. So the wire carries exactly what is stored locally (§12):

| Part | Shape on the wire |
| --- | --- |
| User text | `{ "type": "text", "text": "…" }` |
| Assistant text | `{ "type": "text", "text": "…" }`. Consecutive text is merged into one part until a tool part (visible **or** silent) intervenes (`accumulatePart()`). `text-start`/`text-end` do not split history parts, so adjacent text runs become **one** concatenated part with no separator, although they rendered as separate bubbles while streaming. After a reload (`renderRestoredAssistant()`) they show as one bubble and are replayed as one part. |
| Assistant tool (visible **and** silent) | `{ "type": "tool-<name>", "toolCallId": "…", "state": "output-available" \| "input-streaming", "input": {…}, "output": {…} }`. `state` is set to `output-available` as soon as the input arrived, even if no output chunk followed. `output` is whatever the stream delivered (e.g. `search_products` results, `get_order_status` data, `offer_email_summary` consent copy, `{ok:true}`). |
| Unknown tools | **not stored at all**, so never replayed |

- Message ids: `u-<uuid>` (user), `a-<uuid>` (assistant), and `u-`/`a-` + uuid for transcripts loaded from the account history.
- **History cap:** the widget does **not** cap what it sends. `loadHistory()` and `saveHistory()` keep the last 40 messages in storage, but the in-memory array grows freely during a page view. Over the per-request cap (AC §2: 40 messages) the backend answers `400 payload_too_large`, which the widget turns into a "start a new chat" notice (§11). The request fails once the in-memory array (including the new user message) exceeds 40. For a normal thread that is the **21st user message** (20 + 20 + 1 = 41), also when the thread started with a context greeting (1 + 20 + 20 + 1 = 42; the 20th send is exactly 40 and passes). Turns that store no assistant reply (an `error` chunk with no content, a cancelled reply) push the wall later. After a reload the stored 40 are restored, so the next send fails again.
- The backend sanitises broken tool parts before model conversion and replaces replayed `get_order_status` outputs with `{ replayed: true }` (AC §2 "Request body" → "Replay the history as it streamed"; backend `src/lib/chat-message-sanitize.mjs → sanitizeToolParts`, called from `src/app/api/chat/route.ts`). The filter drops only parts whose `state` is `input-streaming` or `input-available`, or whose `input` is not a plain object.
- **Output-less parts slip through that filter.** Because `accumulatePart()` labels a part `output-available` as soon as its input exists, a part that never got an output (after `tool-output-error`, a mid-tool `error` chunk, or a network drop after the input) is stored and replayed as `state: "output-available"` with no `output` key. The backend's incomplete-state check never matches such widget-made parts, so they reach `convertToModelMessages` without a result (`get_order_status` excepted, it is rebuilt with `{ replayed: true }`). Whether that breaks the provider call is **not verified** (§20 finding 14).

---

## 4. Page context and browsing trail

### 4.1 Server-rendered page facts (`CFG.pageContext`)

`snippets/ms-chat-widget.liquid` injects the server-rendered page facts as `window.MS_CHAT_CONFIG.pageContext`. Fields, Liquid sources, JS defaults and use: `02` §3.2 (owner). Where the widget does not render at all: `01` §5.1.

### 4.2 `PAGE_CTX` (normalised in the IIFE)

The widget normalises the page facts once into `PAGE_CTX` (`type`, `productId`, `productHandle`, `productName`, `collectionHandle`, `category`); derivation and every use: `02` §3.2. For the `context` it sends, `productHandle` is the catalog id (AC §3); the numeric `productId` is only a fallback id and the CTA comparison (§4.3), never a KPI field.

### 4.3 The `context` object sent to `/api/chat`

| Origin | Shape |
| --- | --- |
| Product CTA (`openWithProduct`) | `{ type:"product", productId: <handle if this is the CTA's own product page, else the data-attribute id>, productTitle: <data-attribute title>, recentlyViewed?: [...] }` |
| Nudge on a product page | `{ type:"product", productId: <handle or numeric id>, productTitle?: <title>, recentlyViewed?: [...] }` |
| Nudge elsewhere | `browsingContext(null)` → `{ type:"browsing", recentlyViewed: [...] }`, or **no greeting at all** when the trail is empty |

`productId` fallback: the CTA buttons carry `data-ms-chat-product-id="{{ product.id }}"` (numeric). The widget swaps in `PAGE_CTX.productHandle` when the CTA's id matches the page's product (or either id is missing). A numeric id would be dropped server-side as unknown, but the primer text still names the product.

The widget sends no `source` field. AC §2 defines `source` (`page` | `cta` | `nudge`; absent = treated like `cta` / `nudge`) and the typed-turn shape; `tasks/2-page-context.md` adds it to the widget.

`browsingContext(leadCategory)` also supports a leading category entry. It is only ever called with `null` in the current code; the "category starters" that used a lead category were removed.

### 4.4 Browsing trail (`localStorage['ms-chat-trail']`)

- **Recorded** once per page load in `init()` → `recordTrail()`, on product and collection pages only.
- **Entry:** `{ id, name, type: "product"|"collection", category, ts }`. For a product, `id` = handle (else the numeric id) and `name` = title. For a collection, `id` = collection handle and `name` = collection title.
- **Caps:** at most `TRAIL_MAX = 5` entries, most recent first, deduplicated by `type+id`. Entries older than `TRAIL_TTL_MS = 3 days` are dropped on read.
- **Wire form** (`recentlyViewedPayload()`): up to **3 products** `{type:"product", id, name}` and **2 categories** `{type:"category", id?, name}` (collections become `category`), most recent first. This matches the server cap (AC §2). On a product page the current product is usually the first entry.
- **When it leaves the browser:** only inside the `context` of a product-CTA turn or a nudge greeting. It is never sent on typed turns, in KPI events or in a background call.
- **Other local use:** `trailCategoryStreak()` (≥ 2 products of one category) picks the nudge copy "Du schaust dir ein paar Produkte aus „X“ an — soll ich beim Vergleich helfen?" (nudge details: 05 §7, 02 §11).
- **Privacy posture** (code comment `PRIVACY POSTURE (do not change)` above `PAGE_CTX`): copy built from this data references the page or category, never the user's behaviour ("TONE RULE").
- **Stale code comment:** the same comment still says the trail "is NEVER transmitted — no backend call carries it" and that context leaves the browser "only when the USER sends a chat message that carries it". Both are out of date. Since the `recentlyViewed` context (AC §2) was added, `recentlyViewedPayload()` (via `browsingContext()`, `openWithProduct()` and `showNudge()`) sends up to 3 products + 2 categories in `context` on product-CTA turns and on nudge greetings, and the nudge greeting has no user message at all. Treat the behaviour described in this section as the truth; `tasks/2-page-context.md` (item 5) corrects the comment.

---

## 5. Parsing the SSE stream

`startStream()` → `pump()` / `processLine()` / `handleEvent()`. The widget uses `fetch` + `res.body.getReader()` + `TextDecoder`, never `EventSource`. The stream format and chunk vocabulary are the contract's (AC §2 "Response — SSE stream", "Chunk vocabulary"); this section is how the widget handles them.

### 5.1 Line framing (`processLine`)

- The buffer is split on `\n`. A trailing `\r` is stripped and the last partial line is kept for the next read.
- `data:<payload>` → payload trimmed. Lines starting with `:` (SSE comments / keep-alives) are ignored. Any other non-empty line is tried as raw JSON.
- `[DONE]` → `finalizeStream()`.
- Non-JSON or partial JSON → silently ignored.
- A JSON **array** is accepted and each element is handled as an event.
- On socket close (`r.done`) a non-empty remaining buffer is processed, then `finalizeStream()`.

`finalizeStream()` is idempotent. Whichever of `finish`, `[DONE]` or socket close comes first wins.

### 5.2 Chunk types (`handleEvent`)

| Chunk `type` | Widget action |
| --- | --- |
| `start`, `start-step`, `finish-step` | ignored |
| `finish` | `finalizeStream()` |
| `text-start` | `ensureCtx()` (removes the generating row, creates the assistant row if needed) and closes the current text run, so the next delta opens a **new bubble** |
| `text-delta` | reads `ev.delta` (falls back to `ev.text`). Empty strings are ignored. → `feedCanonical({type:'text', text})`. In voice mode it is also fed to streaming TTS (§17). |
| `text-end` | re-renders the run in full (flushes Markdown withheld during streaming) and closes the run |
| `tool-input-start` | remembers `toolCallId → toolName`. No render. |
| `tool-input-delta` | ignored (cards render only on full input) |
| `tool-input-available` | `name = ev.toolName` or the remembered name. `input` defaults to `{}`. → `feedCanonical({type:'tool-'+name, toolCallId, input})` |
| `tool-output-available` | for `offer_email_summary` with `output.consentCopy` → `seedConsentCopy()` (60 s in-memory consent-copy cache). This does **not** feed the card of the same call, which was already built at `tool-input-available` (§8.6). For every known tool the output is stored on the history part (`accumulatePart`), never rendered. |
| `tool-output-error` | ignored (the tool part stays in history without an output) |
| `error` | `console.error` with `errorText`, sets `streamErrored = true`. The stream continues. The error line is shown at finalize (§11). |
| `data-*`, `reasoning*` | ignored |
| anything else | `console.debug` with the **type only** (never the body, which could hold order data) |

The widget does not check the `x-vercel-ai-ui-message-stream` header.

---

## 6. Assembly into parts and the tool registry

### 6.1 Tool lists (`ms-chat-widget.js` top-level constants)

| List | Tools | Behaviour |
| --- | --- | --- |
| `VISIBLE_TOOLS` | `show_product`, `compare_products`, `add_to_cart`, `suggest_showroom`, `show_contact_form`, `offer_email_summary` | rendered as cards (§8) and stored in history |
| `SILENT_TOOLS` | `update_customer_profile`, `search_products`, `get_order_status` | **stored in history (input + output) and replayed to the backend**, never rendered: no card, no placeholder, no row, and the generating indicator keeps running |
| Unknown (`resolveToolName()` → `null`) | anything else | **dropped entirely**: not rendered, not stored, not replayed. Matching is exact (`type === 'tool-' + name`), so `show_product_xyz` does not render as `show_product`. |

So a **new background tool** needs no widget release **only if the backend does not need it replayed** in later turns' history (it is dropped and never re-sent). If replay matters (as for `update_customer_profile`, whose profile the backend reconstructs from replayed history, AC §2 "Request body"), the name must be added to `SILENT_TOOLS` in a widget release. A **new visible tool** needs a widget release, and its history parts are not even replayed until the name is added to one of the two lists.

### 6.2 `feedCanonical(part)` → history + DOM

1. `accumulatePart(asstParts, part)` merges text into the last text part, or upserts the tool part by `toolCallId` (input and, later, output).
2. If `!isRenderablePart(part)` (silent or unknown tool, empty text), stop. This is history only.
3. Otherwise `ensureCtx()` creates the assistant row (avatar + content column) on first use, and `renderPartIntoCtx()` renders the part.

`renderPartIntoCtx` for tools:

- Waits until `input` exists (`part.input` or the legacy `part.args`).
- A tool card ends the current text run, so text after a card gets a new bubble below it.
- Cards are keyed by `toolCallId` (fallback `name + JSON(input)`). A re-emitted chunk with identical input is a no-op. Changed input re-renders **in place**.
- A placeholder `<div>` is appended **synchronously**, so card order matches stream order even though `buildToolCard()` is async (hydration). If the builder resolves `null` or throws, the placeholder stays empty ("render nothing").

### 6.3 Finalisation (`finalizeStream`)

- Final full Markdown render of the open text run.
- If nothing visible was rendered, the empty assistant row is removed.
- If `asstParts` is non-empty **and** the session id has not changed since the request (`sid === streamSid`), the assistant message `{id:'a-…', role:'assistant', parts}` is pushed and saved. A turn made only of silent tool parts is still stored (and counts toward the 40-message cap) but renders nothing.
- `state.streaming = false`, input re-enabled.
- If `streamErrored`: append the error line (§11).
- Voice mode: `voiceAfterReply()` (§17).

---

## 7. Product hydration (`GET /api/products`)

`hydrate(ids)` is used by `show_product`, `compare_products`, `suggest_showroom`, and the product-reference lines of the contact and capture cards. `add_to_cart` uses its own fetch (§8.3).

| Aspect | Behaviour |
| --- | --- |
| Request | `GET {apiBase}/api/products?ids=<comma-joined, URI-encoded>`, header `x-ms-session` only (no chat key, no locale — AC §3, §12.2). |
| Batching | ids trimmed and deduplicated. Ids not yet cached are fetched in **batches of 10** (the AC §3 id cap). |
| Cache | `productCache` (in memory, per page load). Only a **successful** response is cached. `null` entries mean "unknown id" and are cached. A failed request (429, 5xx, network) caches nothing, so a later card retries. |
| Result | array aligned to the requested ids; `null` for unknown or unfetched ids |
| Variant refs | ids of the form `handle~<variantId>` (AC §3 "Product variants") are passed through unchanged. The widget renders the flat fields the server returns for the chosen variant. |

**Product fields the widget actually reads** (the field definitions are AC §3):

| Field | Used by |
| --- | --- |
| `name` | every card |
| `price`, `salePrice` | `priceNode()`: when `salePrice != null && salePrice !== price`, it shows the sale price (`.ms-chat-price-sale`) plus the struck-through regular price (`.ms-chat-price-strike`), otherwise just the regular price. Format `de-DE` number + `" €"`, or `en-GB` EUR currency on `/en` (`euro()`). |
| `images[0]` | thumbnails (`loading="lazy"`) |
| `inStock === false` | show card: "Ausverkauft" badge. add_to_cart card: "Ausverkauft — nicht im Warenkorb". |
| `shopifyUrl` | "Zum Produkt" buttons (show/compare cards, add_to_cart fallback) |
| `id` | KPI payloads (catalog id / handle) |
| `specifications` | compare table rows |
| `deliveryTime` | compare table row "Lieferzeit" |
| top-level `cartUrl` | add_to_cart checkout button |

**Ignored today:** every other `PublicProduct` field (AC §3), notably `shortDescription`, `features`, `brand`, `category`, `series`, `tags`, `shopifyCartUrl`, `inventoryQuantity`, `anyVariantAvailable`, `sku`, `rating`, `ratingCount`, `qa`, `variants[]`, `selectedVariantId`, `priceMin`/`priceMax`, `currency` (EUR is assumed). The `show_product` input `reason` is also ignored (§8.1).

---

## 8. Visible tools, one by one

Each tool's input and output are the contract's (AC §2 "Tools the widget MUST render"; how a card looks is the widget's choice there). This section is how the widget renders them. Common card chrome: `.ms-chat-card` > `.ms-chat-card-body`, monochrome. All outbound links open in a **new tab** (`target="_blank" rel="noopener noreferrer"`), so the chat tab stays open.

### 8.1 `show_product` → compact product card (`buildShowProduct`)

| | |
| --- | --- |
| Input read | `productId` only. `reason` is **not rendered** (AC §2 leaves layout and `reason` to the widget; the compact card was a deliberate client direction). |
| Data | `hydrate([productId])` |
| Renders | one row: thumbnail (`images[0]`, if any) + name + price (sale/strike logic) + "Ausverkauft" badge when `inStock === false`. Below it, a primary pill button **"Zum Produkt"** + external icon → `shopifyUrl`. |
| Buttons / KPI | "Zum Produkt" → `track('product_cta_clicked', { productId: <catalog id> })`. The thumbnail and name are not links. |
| Side effect | `moAttrOnProductCard()`: the session counts as "consulted", and the order-attribution token is minted and the live cart stamped (consent-gated; see 05 §10 and 06 §8). This also runs when cards are re-rendered from restored history (at most one stamp per page load). |
| Edge cases | unknown id or failed fetch → nothing rendered. No `shopifyUrl` → the button links to `#` (opens the current page in a new tab). Sold-out products still get "Zum Produkt". There is no add-to-cart on this card. |

### 8.2 `compare_products` → comparison table (`buildCompare`)

| | |
| --- | --- |
| Input read | `productIds[]`, `comparisonContext?` |
| Data | `hydrate(productIds)` |
| Guard | fewer than **2** resolved products → nothing rendered |
| Renders | optional `comparisonContext` line above the table. A horizontally scrollable table (`.ms-chat-compare-scroll`): header row = image + name per product. Rows: **"Preis"** (sale/strike), then spec rows, **"Lieferzeit"** (`deliveryTime` or `—`), and a last row with a **"Zum Produkt"** button per product. |
| Spec rows | keys in first-seen order. With exactly 2 products: the union of all keys. With 3 or more: only keys present in ≥ 2 products. Missing values show `—`. No cap on the number of rows. |
| KPI | each "Zum Produkt" → `product_cta_clicked { productId }` |
| Not shown | stock state (no sold-out marker in the table), no checkout button |

### 8.3 `add_to_cart` → direct-checkout card (`buildAddToCart`)

| | |
| --- | --- |
| Input read | `productIds[]` when non-empty, else `[productId]`. Trimmed and deduplicated. `message?` |
| Data | **dedicated** `GET /api/products?ids=…` (one request, **not chunked**, so more than 10 ids → server 400 → nothing rendered). It reads `products[]` and the top-level `cartUrl`, and opportunistically warms `productCache`. |
| Guard | no resolvable product, or a failed fetch → nothing rendered |
| Renders | `message` header. One row per resolved product (thumb + name + price). Sold-out rows get "Ausverkauft — nicht im Warenkorb", because the server-built `cartUrl` excludes sold-out items. |
| With `cartUrl` | one blue checkout button **"Zur Kasse"** (cart icon, `.ms-chat-btn--checkout`) → `cartUrl` in a new tab, plus the caption "Direkt zur sicheren Kasse bei motionsports.de". |
| Click on "Zur Kasse" | (1) `moAttrEnsure(false)`: mint the token if needed and **always re-stamp** the live cart with the `_mo` attribute (consent-gated, fire-and-forget). (2) `track('add_to_cart_clicked', { productId: <first resolved id>, productIds: [<all resolved ids, sold-out included>] })`. (3) `pollCartAfterCheckout()`: re-reads `/cart.js` after 1.2 s, 2.5 s, 4.5 s and 7 s. |
| Without `cartUrl` (e.g. all sold out) | degrades to secondary "Zum Produkt" link(s) → `shopifyUrl`. With several products, each link is labelled with the product name. Each fires `product_cta_clicked`. |
| Not supported | quantity (always 1 per line), variant choice (only via variant-ref ids from the model), discount codes |

**Cart UI sync after the checkout click** (`refreshCartUI()`): the permalink fills the cart in the **new** tab. The chat tab re-fetches `/cart.js` (display only, never POSTs) on `visibilitychange` → visible, window `focus`, `pageshow`, and the bounded poll above. It updates `#CartBubble` and every `[data-fh-cart-bubble]`. When `item_count` changed, it also calls `<cart-modal>.reloadContent()` and re-renders `.section-main-cart` (the latter is effectively dead, because the widget is not rendered on `/cart`). Theme side: 06 §7 and 05 §11 (DOM hooks `#CartBubble` / `<cart-modal>`: 01 §8).

### 8.4 `suggest_showroom` → showroom card (`buildShowroom`)

| | |
| --- | --- |
| Input read | `productIds[]` |
| Data | `hydrate(productIds)`. Needs ≥ 1 resolved product, otherwise nothing is rendered. |
| Renders | pin icon + heading **"Showroom in Gröbenzell bei München"**. Text: `Möchtest du <names, comma-joined> vor dem Kauf testen? Besuche unseren Showroom!`. Primary button **"Showroom ansehen"** → `CFG.showroomUrl` (hard-coded in the snippet to `https://motionsports.de/pages/showroom-munchen-grobenzell`, not a theme setting). Caption "Terminvereinbarung erforderlich". |
| KPI | `showroom_clicked { productIds: [...] }` |

### 8.5 `show_contact_form` → inline contact form (`buildContactForm`)

| | |
| --- | --- |
| Input read | `reason` (default `general`), `message?`, `productIds?` |
| Heading / sub | from `REASON_LABELS[reason]` (DE/EN). The card text is `input.message` if present, else the reason's sub-line. |
| Reasons with labels | `studio_consultation` "Persönliche Studio-Beratung", `public_sector_quote` "Formelles Angebot anfordern", `physio_consultation` "Physio- / Reha-Beratung", `bulk_discount` "Mengenrabatt anfragen", `leasing` "Leasing-Anfrage", `maintenance` "Wartungsvertrag", `order_support` "Kontakt zum motion sports Team", `general` "Persönliche Beratung". Any other reason falls back to `general`. |
| **`order_support`** | Own row in `REASON_LABELS` (the reason's meaning: AC §2 `show_contact_form`). DE: title „Kontakt zum motion sports Team“, sub-line „Bestellstatus, Retoure/Rückgabe, Stornierung oder Reklamation — das Team kümmert sich.“ EN: "Contact the motion sports team" / "Order status, return, cancellation or complaint — the team will take care of it." Message placeholder for this reason only: „Bestellnummer + kurz dein Anliegen…“ / "Order number + briefly your request…". Organisation stays optional. |
| Product refs | if `productIds` is present: `hydrate()` → line "Im Bezug: <names>" (shown only if ≥ 1 resolves) |
| Fields | `Name *` (text), `E-Mail *` (email), `Organisation` (**required only** for `studio_consultation` and `public_sector_quote`, label then "Organisation / Studio *"), `Telefon` (tel), `Nachricht *` (textarea, placeholder "Beschreibe kurz dein Anliegen…" / "Briefly describe your request…"; for `order_support` see above). Caption: "Wir melden uns innerhalb von 1-2 Werktagen. Deine Daten werden nur für die Bearbeitung deiner Anfrage verwendet." |
| Client validation | name non-empty; email `^[^@\s]+@[^@\s]+\.[^@\s]+$`; organisation when required; message non-empty. Error lines via `L(de, en)`. |
| Request | `POST {apiBase}/api/contact`, headers `Content-Type`, `x-ms-chat-key`, `x-ms-session`, `x-ms-locale`. Body: `{ reason, name, email, organization, phone, message, sessionId, productIds? }` (empty optional fields are sent as `""`). `sessionId: sid` is in the body; the backend keys its `contact_form_submitted` KPI row on it, else on the `x-ms-session` header (AC §4). |
| Success | body replaced by a check icon, "Vielen Dank!" and "Wir haben deine Anfrage erhalten und melden uns innerhalb von 1-2 Werktagen." |
| Errors (codes: AC §4) | 429 → "Zu viele Anfragen — bitte kurz warten.", submit locked for `Retry-After` (default 30 s). 502 / `upstream_unavailable` → "Senden gerade nicht möglich — bitte später erneut versuchen.". Other errors → the server's `error.message` verbatim, else "Senden fehlgeschlagen. Bitte versuch es erneut.". Network → upstream message. Form values are kept for retry. |
| KPI | none client-side. The server records `contact_form_submitted` (AC §4/§5). |

### 8.6 `offer_email_summary` → email-capture form (`buildCaptureCard`)

The full consent rules (legal invariants, copy fetching, outcome copy) are in 04 §10. This section covers only what matters for the turn:

| | |
| --- | --- |
| Signed-in visitor | **suppressed only if `auth.signedIn` is already true when the card is built** (`buildToolCard` returns `null` in that case; the account already has the email). `var auth` starts with `signedIn: false` on every page load and is resolved only on the first panel open (`openPanel()` → `resolveAuthOnOpen()` → `detectSignedIn()` / `probeAuth()`, async). History restored at page load is rendered by `init()` → `renderAllMessages()` **before** auth settles, and nothing re-renders the messages after `applyAuth()` / `reflectAuthState()`. So a stored `offer_email_summary` part (for example one offered before the customer signed in) shows the typed-email capture form to a signed-in customer after every reload (and triggers a `GET /api/consent-copy`). A **live** offer no longer reaches a signed-in session: the backend does not offer the tool to a session it resolves as signed in (`src/app/api/chat/route.ts`; it keeps the offer only if that lookup fails), AC §2 `offer_email_summary`, ACCT §6.0. See 04 §10 and 04 §18 item 2. |
| Input read | `message` (intro), `productIds?` (line "Im Warenkorb: <names>", advisory only), `trigger` (echoed back in the submit body and in the decline KPI) |
| Consent copy | The card is built at `tool-input-available` (`buildToolCard()` → `buildCaptureCard()`) and immediately calls `loadConsent()` → `fetchConsentCopy()`. That returns the 60 s in-memory cache if it is fresh, else it calls `GET /api/consent-copy?locale=<de\|en>` (header `x-ms-session`). The `output.consentCopy` of this same tool call arrives later. `seedConsentCopy()` stores it in the cache, but it is **not** what this card shows (unless the cache was already fresh). It only serves cards built within the next 60 s (the header form, re-rendered cards). Submit stays disabled until valid served copy is rendered. A failed fetch shows an error with a retry button. No consent text is hard-coded in the widget. |
| Form | email + two **unchecked**, separate checkboxes (transactional required, marketing optional and visually prominent) + served footer + Impressum/Datenschutz links + decline link "Nein danke, vielleicht später" |
| Submit | `POST /api/capture-email` `{ sessionId, email, transactionalConsent:true, marketingConsent, consentTextShown (verbatim), locale, trigger? }` (AC §7.1). On success: `capturedEmail = email`, which unlocks `customer` on later chat turns of this page load (§3.2). |
| Decline | `track('email_capture_declined', { trigger })` (no `askNumber`), card collapses to "Alles klar! Du findest die Option jederzeit oben unter „Per E-Mail teilen“." |
| Server-side KPI | `email_capture_ask_shown` comes from `/api/chat`, `email_capture_submitted` from `/api/capture-email`. The widget does not send them. |

---

## 9. Markdown rendering

`renderMarkdownInto(node, text, streaming)` → `renderBlocks()` + `appendInline()`. Only assistant **text** goes through it. User bubbles and all card strings are set as plain `textContent`.

**Safety model:** the renderer only builds DOM via `createElement` / `createTextNode`, never `innerHTML` on model text. Allowed tags: `p br strong em code a h3–h6 ul ol li blockquote pre`.

| Syntax | Result |
| --- | --- |
| `**bold**` | `<strong>` |
| `*italic*` | `<em>` (underscores are **not** emphasis, so `snake_case` stays intact) |
| `` `code` `` | `<code class="ms-chat-md-code">` |
| `[label](url)` | `<a target="_blank" rel="noopener noreferrer">` if `safeHref(url)` allows `http:`, `https:` or `mailto:` (relative URLs resolve against the current page). Any other scheme → the whole construct is shown as literal text. URLs may not contain spaces or `)`. |
| `#`…`######` heading | `h3`…`h6` (`#` maps to `h3`, chat scale) |
| `-` / `*` / `+` list | `<ul class="ms-chat-md-list">` (flat, no nesting) |
| `1.` / `1)` list | `<ol>` (flat; numbering restarts at 1, the source number is ignored) |
| `>` quote | `<blockquote>` (recursive) |
| ```` ``` ```` fence | `<pre><code>` (language tag ignored) |
| blank line / single newline | new paragraph / `<br>` |
| unclosed marker | rendered as literal characters |
| tables, images, raw HTML, autolinks | **not supported**. They render as plain text (HTML is escaped). A bare URL is not linkified. |

**Streaming:** while `state.streaming`, `streamingSafeText()` holds back an incomplete trailing token (an open fence, an unclosed `**`/`*`/`` ` ``, `[…](` still typing, a bare block marker), so half-syntax never flashes. The full text is rendered on `text-end`, on finalize and for restored history.

**Caveat for prompts:** `inlineScanSafe()` does not only hold back the *trailing* token. At **any** `[` that does not immediately form a complete `[label](url)`, and at any `*` or `` ` `` with no closer later in the run, it withholds the **whole remainder** of the run until `text-end`/finalize. Prose like `Preis [Stand heute] liegt bei …` or `5 * 3` therefore freezes the bubble mid-answer while the rest streams invisibly. The same applies to `*` used as a list bullet: an odd count of `*` bullets so far withholds from the last one (bullets pair up as if they were emphasis markers). Prompts should avoid bare square brackets and lone asterisks in prose, and prefer `-` bullets.

**Caveat for prompts — lists must be tight:** `renderBlocks()` skips a blank line as a paragraph break, and every new run of `1.`/`1)` lines opens a new `<ol>`. A loose list (`1. A\n\n2. B\n\n3. C`, common in model output) therefore renders as three separate lists, each item shown as "1.". An indented continuation line (no list marker) also ends the list and becomes a paragraph. The same splitting applies to `-` lists (several `<ul>`s, visually extra spacing). Prompts should ask for numbered lists with no blank lines between items and one line per item.

**Contract:** AC §2 "Rendering assistant text" sets the minimum (paragraphs and line breaks, bold, links, flat `-` / `1.` lists) and leaves more to the widget. This widget renders the superset above, so backend prompts can rely on this table (and on the two caveats).

**Links in text are not tracked.** A Markdown link click fires no KPI event (unlike card buttons). See §20.

---

## 10. Typing, streaming and input states

| State | What the user sees | Code |
| --- | --- | --- |
| Pending (request sent, nothing visible yet) | a "generating" row: the brand avatar orb animates (`.ms-chat-row--gen`, `role="status"`, `aria-label` "Mo antwortet"). Frozen under `prefers-reduced-motion`. | `showTyping()` |
| Streaming | the generating row is replaced by the real assistant row when the first visible part (or `text-start`) arrives. Text grows per delta. Every delta and card **forces scroll to bottom**. | `ensureCtx()`, `scrollToBottom()` |
| Silent tool running | the generating row stays (silent parts do not create a row) | `isRenderablePart()` |
| Input while streaming | textarea, send and mic buttons are **disabled**, and any active dictation is stopped. The voice-mode toggle stays clickable. | `updateInputState()` |
| Rate-locked | same disabled state + warn notice (§11) | `lockRateLimit()` |
| Done | input re-enabled (the header "Per E-Mail teilen" button was already revealed by `sendMessage()` → `updateShareBtn()` on the first user message, for anonymous/email-only visitors). | `finalizeStream()` |

The send button is hidden while the textarea is empty (`autoGrow()` toggles `.ms-chat-send--hidden`). The textarea grows up to 120 px.

---

## 11. Errors, rate limit and rollback

Status codes, the error envelope and `Retry-After` are the contract's (AC §1 "Error envelope", AC §2 "Rate-limit response (429)" and "Auth / origin errors"); this table is what the widget does with them.

"Rollback" (`rollback()` inside `startStream`) removes the optimistic user message from `messages` and the DOM, removes the assistant scaffold, saves history, shows the welcome screen if the thread is empty, and **puts the typed text back into the composer**.

| Situation | Detection | Rollback? | User-facing result (DE verbatim) |
| --- | --- | --- | --- |
| HTTP 429 / `rate_limited` | `handleChatHttpError` | yes | input locked for `Retry-After` seconds (default **30**) + warn notice "Zu viele Anfragen — bitte kurz warten." The lock lifts automatically, and voice mode resumes listening. Not persisted across reloads. |
| HTTP 401 / `unauthorized` | 〃 | yes | "Chat ist gerade nicht verfügbar." (console: check the shared secret) |
| HTTP 403 / `forbidden` | 〃 | yes | "Chat ist gerade nicht verfügbar." (console: origin not allowlisted) |
| `payload_too_large` (> 40 messages) | 〃 | yes | info notice "Dieser Chat ist ziemlich lang geworden. Starte einen neuen Chat, um weiterzumachen." + button "Neuen Chat starten" → `startNewChat()` |
| ≥ 500 / `internal_error` / `upstream_unavailable` | 〃 | yes | "Es gab ein Problem. Bitte versuch es gleich nochmal." |
| Other 4xx (e.g. `bad_request`) | 〃 | yes | "Chat ist gerade nicht verfügbar." |
| Network failure / reader throws, **nothing rendered yet** | `.catch` | yes | "Es gab ein Problem. Bitte versuch es gleich nochmal." Voice mode loop restarts. |
| Network failure **after partial content** | `.catch` with `gotContent` | **no**. The partial answer is kept and saved. | same line appended after the partial answer |
| `error` chunk in the stream | `streamErrored` | **no** | same line appended at finalize, after whatever rendered. Note: if the error chunk came with **no** content, the user message stays in history with no assistant reply (unlike the HTTP paths). |
| Internal cancel (sign-out, erase, sid rotated in another tab, or the server says a previously signed-in session ended: `endedSignInCleanup()` after a definitive not-signed-in `/api/auth/me` answer or a 401 on any `/api/account/*` call; also new chat and opening a past conversation) | `abortActiveStream()` via `dropSessionHistory()`; directly in `startNewChat()` / `openConversation()` | n/a | the late reply is never drawn or saved (`cancelled`, `streamSid` checks). All of these paths also stop queued speech (`endSpeaking()`). |

**Voice mode after HTTP errors:** only the 429 path (via `lockRateLimit()`'s timer) and the network `.catch` call `restartVoiceLoop()`. On HTTP 400 (`payload_too_large`, `bad_request`), 401, 403 and 5xx the hands-free loop is **not re-armed**: voice mode stays on but stops listening until the user toggles it. `rollback()` also puts the spoken transcript into the composer.

**Product CTA after rollback:** `sendMessage()` passes `restoreText: text` to `startStream()` whatever the origin, so for a failed product-CTA turn (429, 401/403, other 4xx, 5xx, network with nothing rendered) the restored text is the primer ("Ich interessiere mich für „<title>". Kannst du mich zu diesem Produkt beraten?"). Re-sending it from the composer sends it as a typed turn without `context` (no `productId`, no trail).

Error lines are assistant-style rows in the message list. They are **not persisted**. A failed send also suppresses the first-message popup (`maybeShowConsentGate` checks that the user message is still in `messages`).

---

## 12. Local history: persistence, cap and restore

| Item | Detail |
| --- | --- |
| Key | `localStorage['ms-chat-history:<sid>']`, a JSON array of `{id, role, parts}`. In-memory fallback if `localStorage` is unavailable (then nothing survives a reload). |
| Cap | `loadHistory()` and `saveHistory()` keep the **last 40** messages. The in-memory array is uncapped (§3.3). |
| Writes | after the user message is pushed, after each completed assistant message, on rollback, on conversation open. Only while this tab's `sid` is still the device's `ms-chat-sid` (`sidIsCurrent()`), so a tab never writes under an orphaned id. |
| Content | user text, assistant text, **all known tool parts including outputs** (`search_products` results, `get_order_status` order data, consent copy). This is why sign-out and erase rotate the sid and delete the history (order data on shared devices, ACCT §5.1). |
| Quota errors | `lsSet()` swallows a `setItem` failure (it writes to a memory map that `lsGet()` never reads while `localStorage` works). A full storage therefore leaves the **previous** snapshot in place without notice. |
| Restore render | `renderAllMessages()` on init: user bubbles and `renderRestoredAssistant()` for assistant messages. A message with no renderable part (only silent/unknown tools) is skipped entirely. Unknown part types are ignored. Text renders in full Markdown. |
| Tool cards on restore | **re-built from scratch**: products are re-hydrated (new `GET /api/products` calls), `show_product` re-triggers the attribution stamp (once per load). **Form cards come back fresh and empty**: a submitted or declined `offer_email_summary` capture form and a submitted `show_contact_form` re-appear as new forms after every reload (all visitors, signed-in included: restore runs in `init()` before auth settles, so the `buildToolCard()` suppression does not apply, §8.6), and a decline there fires `email_capture_declined` again. |
| Cross-tab | another tab rotating `ms-chat-sid` (sign-out, erase, anonymous "new chat") → `onSidChangedElsewhere()` cancels the stream, drops to anonymous and adopts the new sid with that sid's stored history (02 §8). |

---

## 13. New chat, "Neue Beratung" and `conversationKey` threads

**Entry points:** the header refresh icon ("Neuen Chat starten"), the payload-too-large notice button, and the history drawer's **"Neue Beratung"** button (signed-in only, also fires `account_new_consultation` and adds an optimistic history row).

**Not an entry point: the deep link `mo_new=1`.** `handleMoDeepLink()` uses its own logic, because auth is not settled at init. With the local signed-in hint (`shouldProbeAuth()`) it keeps the sid, deletes the local history, sets `messages = []` and clears the `conversationKey` (`clearConvKey()`). A new key is minted only on the first turn, and only if auth has settled as signed-in by then (see the edge case below). Without the hint it calls `rotateSession()`. It does not touch the rate lock or the streaming flags. So a truly signed-in visitor without the hint gets a rotated sid, and a hinted but signed-out visitor keeps the sid (02 §7, 05 §9).

`startNewChat()`:

| Visitor | Effect |
| --- | --- |
| **Signed in** | sid **kept** (it is the identity link). Local history key deleted, `messages = []`. A **fresh `conversationKey = uuid()`** is created immediately and stored in `ms-chat-convkey:<sid>`. Past threads stay server-side. |
| **Anonymous / email-only** | `rotateSession()`: deletes history, mints a **new sid**, resets the attribution cache. `conversationKey` stays null (never sent). The old conversation is no longer reachable from this device. **`capturedEmail` is not cleared**: later turns still send `customer.email` (ignored by the backend because the sid no longer matches the capture) and feedback keeps `tier: "email"` + the address (§3.2, §16, §20 finding 19). |

**A reply still streaming is cancelled first.** `startNewChat()` begins with `if (abortActiveStream) { abortActiveStream(); abortActiveStream = null; }`, `endSpeaking()` and `removeTyping()`, then `clearNotice()`. `openConversation()` does the same once the transcript has loaded (before `track('conversation_opened')`). The old turn's `cancelled` flag turns its fetch callbacks, reader loop, events and `finalizeStream()` into no-ops, so the late reply is never drawn into, saved with or replayed in the new (or opened) thread. Both also call `endSpeaking()`, so streaming-TTS audio already queued for the old reply stops at once (like `dropSessionHistory()`).

For both visitor types the rate lock and streaming flags are then cleared and the welcome screen (or the opened transcript) is shown. The header refresh icon and the drawer's "Neue Beratung" stay clickable while streaming (`updateInputState()` disables only textarea, send and mic); with the abort that is now harmless.

Before 2026-10-04 neither function cancelled the stream, so a late reply could land in (and, signed in, be saved with) the new or opened thread (02 §21 item 1, §20 finding 15).

**Thread key rules** (`activeConversationKey`, `localStorage['ms-chat-convkey:<sid>']`):

- `maybeMintConversationKey(isFreshThread)` mints a key **only** when the visitor is signed in, has no key yet, and the thread is empty (first turn of a fresh thread, including the context greeting).
- **Sent** on `/api/chat` only when `auth.signedIn` and a key exists. Also sent as `conversationId` in feedback (§16) and used for the summary download (§14).
- **Opening a past conversation** (`openConversation(id)`): `GET /api/account/conversations/{id}` (account headers, ACCT §7.2). On success it first cancels a reply still streaming (see above). The transcript becomes text-only messages (`transcriptToMessages()`: **tool parts and cards are lost**), keeps the last 40, adopts the server's `conversationKey`, and saves locally. Further turns append to that thread.
- **Deleting the active conversation** in the drawer clears the local view and the key.
- **Edge case — auth not settled at first send:** if a visitor who is actually signed in sends before `auth.settled` (e.g. product CTA or deep link on a cold load), no key is minted (`auth.signedIn` is false at that moment). Later turns do not mint either, because the thread is no longer fresh. The thread then runs **without `conversationKey`** (server falls back to `session_id`, AC §2), and the summary download button stays hidden for it.
- **Edge case — existing keyed thread, auth not settled yet on this page load:** auth is re-resolved lazily on every page load (first panel open: `openPanel()` → `resolveAuthOnOpen()`, async), while `activeConversationKey` is restored synchronously by `loadConvKey()`. `startStream()` attaches the key only `if (auth.signedIn && activeConversationKey)`, so any send before the probe resolves omits `conversationKey` even though the thread on screen already has one. In practice this is the product-page CTA: `openWithProduct()` calls `openPanel()` and then `sendMessage()` synchronously, so the first CTA turn of a page view goes out keyless. The backend then files that turn under the legacy `session_id` thread instead of the keyed one (`src/app/api/chat/route.ts` → `conversationKey` null; `src/lib/conversation-store.ts` falls back to `sessionId`), which can create a stray or duplicate history entry. A fix would send the stored key whenever one exists, or delay CTA sends until `auth.settled` (§20 finding 21).

The history drawer UI (list, rename, delete, export, erase) is covered in 04 §7.

---

## 14. Signed-in summary download (PDF)

| | |
| --- | --- |
| Button | header pill "Zusammenfassung" (download icon), visible only when `auth.signedIn && activeConversationKey && messages.length > 0` (`updateDownloadBtn()`) |
| Request | `GET {apiBase}/api/account/summary?conversationKey=<key>` with account headers (`x-ms-chat-key`, `x-ms-session`, `x-ms-locale`); contract ACCT §8. No client timeout (the backend may make an AI call). Button disabled with a busy class meanwhile. |
| Success | response Blob saved as `motionsports-zusammenfassung.pdf` via a temporary `<a download>` |
| 401 | session no longer resolves → `accountUnauthorized()`: `applyAuth(null)`, close the drawer, and if the device was signed in `endedSignInCleanup()` → `dropSessionHistory()`: a running reply is aborted, local history and the `conversationKey` are deleted, the captured email is cleared and a new sid is minted (see 04 §8). The same applies to a 401 on every other `/api/account/*` call (conversation open/delete, export, opt-in). |
| 404 | info notice "Für diese Beratung gibt es noch keine Zusammenfassung." |
| Other | warn notice "Zusammenfassung konnte gerade nicht erstellt werden — bitte später erneut versuchen." |
| Stale guard | the answer is dropped if the sid changed or the visitor signed out meanwhile |
| KPI | `summary_download_started`, `summary_downloaded` |

---

## 15. Header "Per E-Mail teilen" entry point

- A text button in the header, visible once the thread has ≥ 1 message and the visitor is **not** signed in (`updateShareBtn()`).
- It calls `openCaptureForm()`, which drops the same capture card as §8.6 into the message list with the default intro "Ich schicke dir gerne die Zusammenfassung deiner Beratung samt Warenkorb per E-Mail." It sends **no `trigger`** (so the decline KPI has `data: {}`) and no product list.
- **Reuse rule** (`lastCaptureRow`): the last header-opened card is reused while it is still in the DOM, **also after a successful submit** (the button then only scrolls to the success message, no new form opens until the view is re-rendered). A declined card is not reused (the decline handler clears `lastCaptureRow`). Capture cards rendered by the `offer_email_summary` tool are never `lastCaptureRow`, so the header button can add a second form beside one. Header-opened cards are not stored in `messages` and vanish on reload.
- Also exposed as `window.MS_CHAT.openEmailSummary()`. No theme code calls it today. The public API does **not** check `auth.signedIn` (`openCaptureForm()` has no auth guard; only `buildToolCard()` suppresses `offer_email_summary` for signed-in visitors), so a caller can show the typed-email capture form to a signed-in customer, which breaks the no-double-ask rule (02 §21 item 10). (The other public entry point, `window.MS_CHAT.openWithProduct()`, is in §2.)

---

## 16. Feedback entry point (`POST /api/feedback`)

| | |
| --- | --- |
| Entry | quiet footer link "Feedback geben" next to the disclaimer "KI-Fitnessberater – Antworten können Fehler enthalten". Always available, all tiers. `openFeedbackCard()` reuses an open card. |
| Card | title "Dein Feedback", intro "Wie war deine Beratung? Erzähl uns kurz, was gut lief oder was wir verbessern können.", textarea (`maxlength` 4000, placeholder "Dein Feedback (optional anonym) …"), buttons "Abbrechen" / "Absenden" |
| Validation | non-empty ("Bitte schreib uns kurz, was du uns mitteilen möchtest."), ≤ 4000 chars |
| Body | `{ message, sessionId: sid, conversationId?: activeConversationKey (signed-in only), tier: "signed-in"\|"email"\|"anonymous", email?: capturedEmail, page: location.pathname }`. `email` is attached whenever `capturedEmail` is set (`identifiedEmail()` has no tier check), in practice for email-only visitors. The account email of a signed-in customer is never read or sent, but an address captured earlier in the same page view still is, even after auth settles as signed in (then with `tier: "signed-in"`). It also survives an anonymous "Neuen Chat starten" (§13). Contract (fields, server limits, statuses): AC §9. |
| Headers | `Content-Type`, `x-ms-chat-key`, `x-ms-session`, `x-ms-locale` |
| Results | 200 → "Danke!" / "Dein Feedback ist angekommen — das hilft uns sehr.". 413/`payload_too_large` → length error. 429 → "Danke! Du hast gerade schon Feedback gesendet — bitte kurz warten." with buttons locked for `Retry-After` (default 30 s). Other errors → "Senden gerade nicht möglich — bitte später erneut versuchen." The text is kept for retry. |
| KPI | none client-side. There is no rating or score field, only free text. |

---

## 17. Voice: dictation, voice mode, TTS

All voice UI exists only when the browser has `SpeechRecognition` / `webkitSpeechRecognition` (Chrome, Edge, Android; mostly absent on Firefox and many iOS browsers). Without it there is no mic and no voice-mode button.

### 17.1 Dictation (mic button)

- `startVoice()`: `lang = 'de-DE'` (**hard-coded, also on `/en`**), `interimResults = true`, `continuous = false` (stops after a pause). Transcript text is **appended** to whatever is already typed, live with interim results. The user still sends manually.
- Audio is processed by the **browser's** speech service (e.g. Google for Chrome), not by the Mo backend.
- Mic permission denied → warn notice "Mikrofonzugriff wurde blockiert. Bitte erlaube ihn in den Browser-Einstellungen."
- Disabled while streaming or rate-locked.

### 17.2 Hands-free voice mode (waveform button "Sprachmodus")

Loop: listen → final transcript → `voiceSubmit()` → normal `sendMessage()` → reply streams → spoken → re-listen (350 ms debounce).

- Enabling unlocks an `<audio>` element inside the click (a silent WAV, for iOS autoplay) and fires `voice_mode_on`.
- Silence (no final transcript) just re-arms the mic.
- **Turns off** on: toggle, panel close, tab hidden (`visibilitychange`), mic permission denied. Fires `voice_mode_off`.
- A speaking-indicator button stops playback and resumes listening.
- **Stall after HTTP errors:** on a 400/401/403/5xx chat response the loop is not re-armed (§11). Voice mode stays on but the mic stays off until toggled.
- **The first-message popup (sign-in / opt-in gate) is never shown in voice mode** (`gateBaseEligible()`).
- Only text parts are spoken. Tool cards are never read aloud (`plainTextFromParts()`, Markdown stripped by `stripMarkdownForSpeech()`).

### 17.3 TTS paths

| Path | When | Requests | Fallback |
| --- | --- | --- | --- |
| **Streaming TTS** (default in voice mode) | starts on the first `text-delta` of a reply | `POST /api/tts` `{ text, stream:true, seq }` per chunk (contract: AC §8 "Streaming voice mode"). Chunks come from `splitIntoTtsChunks()` (mirror of the backend splitter, AC §0 rule 24): cut at sentence ends (`.`, `!`, `?`, `…`, newline; German abbreviations, decimals and `google.com`-style dots excepted), coalesced to ≥ **40** chars, force-cut at **220** chars at a clause or space. Requests fire **in parallel** without a concurrency cap. Clips play strictly in `seq` order. | any non-2xx, network or play error → the rest (unplayed clips + pending text) goes to `speakReply()` (single-shot path). A 429 first sets `ttsBackoffUntil`, so the remainder is then spoken locally (Local only row), with no further `/api/tts` request. |
| **Single-shot** (`speakReply()`) | streaming path aborted, or backoff active at stream start | one `POST /api/tts { text }` with the whole remaining reply (the server truncates at its text cap, AC §8), **only when no 429 backoff is active**. `speakReply()` checks `Date.now() < ttsBackoffUntil` first. After a 429 (streaming or single-shot), or with backoff active at stream start, the remainder goes straight to `speechSynthesis` (Local only row). In practice only non-429 streaming failures (502, network, play error) reach a real single-shot POST. | non-2xx / error → browser `speechSynthesis` (`de-DE`, first German voice) |
| **Local only** | `Date.now() < ttsBackoffUntil` | none | `speechSynthesis` directly. If unavailable: notice "Sprachausgabe nicht verfügbar." once, loop continues input-only. |

- **Tool-only reply:** not spoken at all. `voiceAfterReply()` finds no text (`plainTextFromParts()` reads text parts only), makes **no** TTS request and just calls `restartVoiceLoop()`, which re-arms the mic after 350 ms.
- **429 on `/api/tts`** sets `ttsBackoffUntil = now + Retry-After` (default **300 s**). During that window the backend is skipped.
- Headers: `Content-Type`, `x-ms-chat-key`, `x-ms-session`, `x-ms-locale`. The locale header is the only language signal. The local fallback voice is always German.
- KPI: `voice_reply_played` normally once per spoken reply (on first clip play in `streamTtsPump()`, guarded by `s.tracked`; on single-shot play start in `playBlob()`; or on `speechSynthesis` start in `speakViaSynthesis()`). It can fire **twice** for one reply when streaming TTS falls back to the single-shot/local path after the first clip played, because the fallback's own play start fires it again (05 §4: treat the count as ≥ replies played). No transcript content in any event.
- Server cost: each chunk records a TTS usage row (backend `../AI_MODELS.md` "Voice (TTS)").

---

## 18. KPI events fired in this chapter's scope

All via `track(event, data)` → `POST {apiBase}/api/kpi` `{ event, sessionId, timestamp, data }` (fire-and-forget, `keepalive`). In this chapter's scope: `message_sent` (§2), `product_cta_opened` (§2; numeric id, or whatever id `window.MS_CHAT.openWithProduct()` was given), `nudge_clicked` (§2), `product_cta_clicked`, `add_to_cart_clicked`, `showroom_clicked`, `email_capture_declined` (§8), `summary_download_started` / `summary_downloaded` (§14), `account_new_consultation`, `conversation_opened` (§13), `voice_mode_on` / `voice_mode_off` / `voice_reply_played` (§17). Their `data`, triggers and caveats: `05` §4 (owner); location index: `02` §19; contract: AC §5.

**Not fired by the widget:** tool impressions, `email_capture_ask_shown` / `_submitted`, `contact_form_submitted`, `campaign_chat_started` (all server-side, AC §5 server table), feedback submitted, Markdown link clicks, compare-table views, stream errors and rate-limit hits.

---

## 19. What leaves the browser per turn

| Destination | Data |
| --- | --- |
| `POST /api/chat` | full local transcript (user text, assistant text, known tool inputs/outputs), `locale`, sid (header), optional `context` (handle, title, ≤ 3 products + 2 categories from the trail), optional `conversationKey`, optional `customer.email` (whenever a capture succeeded in this page load; survives an anonymous "new chat", §3.2), optional `campaignToken` |
| `GET /api/products` | product ids + sid header |
| `POST /api/capture-email` | the typed email, both consent booleans, `consentTextShown` verbatim, `locale`, `trigger` (tool cards only), `sessionId` in the body; headers chat key, sid, locale. The only place in this chapter where an email address the visitor typed is sent (§8.6). |
| `GET /api/consent-copy?locale=` | locale (query) + sid header |
| `POST /api/attribution/token` | sid + chat key (headers only, no body). One **successful** mint per sid (cached in `localStorage['ms-mo-attr']`, keyed to the sid; with the in-memory storage fallback it is re-minted every page load, the server is idempotent). `moAttrEnsure()` is triggered by a `show_product` render (live or restored), a "Zur Kasse" click, or `visitorConsentCollected` (`initAttribution()`) after a product card rendered in this page view without a token. `moAttrFailed` / `moAttrInflight` are per page view, so a failed mint (401/403/429/5xx/network, or a non-ok body) is retried on the next page view's trigger. Every attempt is consent-gated (`moAnalyticsAllowed()`). |
| `GET /api/account/conversations/{id}` | conversation id (path) + account headers (chat key, sid, locale). Signed-in only. |
| `POST /api/contact` | the form fields the visitor typed + `reason`, `productIds`, `sessionId` in the body (sid also in the header) |
| `POST /api/feedback` | the comment + sid, tier, page path, conversation key (signed-in), captured email (whenever set in this page load, any tier, §16) |
| `POST /api/tts` | reply text (chunks or whole), sid |
| `GET /api/account/summary` | conversation key, sid |
| `POST /api/kpi` | event names + small ids (see §18). Never message text. |
| Same-origin `/cart.js`, `/cart/update.js` | read cart; write the opaque `_mo` attribute (consent-gated) |
| Browser speech service | microphone audio during dictation / voice mode (browser vendor, not Mo) |

---

## 20. Findings for backend decisions (bugs, gaps, KPI levers)

Found while documenting. Findings 1, 2 and 15 were fixed on 2026-10-04 (`8d0a0c4`, `3e87341`) and keep their numbers so references stay stable. The others are open.

**Correctness / contract gaps**

1. **[Fixed 2026-10-04] `contact_form_submitted` session.** The widget sends `sessionId: sid` in the body (§8.5), and the backend keys the row on it, else on the `x-ms-session` header (`src/app/api/contact/route.ts`, AC §4), so contact submissions join the conversation and the tool fire. Rows from before the 2026-10-04 upload have `sessionId: null`.
2. **[Fixed 2026-10-04] `order_support` label row** in `REASON_LABELS`: own title, sub-line and order-number placeholder, DE + EN (§8.5). Before, the reason fell back to "Persönliche Beratung" with the generic placeholder.
3. **Hard 40-message wall.** The in-memory history is not trimmed before sending, so the 21st user message fails with a "start a new chat" notice. For anonymous visitors that rotates the sid and loses the thread (and the attribution token context). Options: the backend accepts and windows longer histories, or the widget sends a trimmed window (it would then need to keep `update_customer_profile` replays).
4. **`show_product.reason` is never shown**, and many product fields are ignored (`shortDescription`, `rating`, `qa`, `variants`, `priceMin/Max`). Backend copy in `reason` is invisible to shoppers. Multi-variant products show only the default/flat price, with no "ab" price range.
5. **`email_capture_declined` lacks `askNumber`** (contract allows it as optional).
6. **Form cards re-appear fresh after every reload** (§12): a contact form can be submitted twice, and a capture card re-asks after a decline.
7. **`error` chunk with no content keeps the user message** in history without a reply (HTTP error paths roll back instead). The next turn then sends two consecutive user messages.
8. **`add_to_cart` with more than 10 ids** renders nothing (no chunking on that path).
9. **Voice language:** recognition and the local TTS fallback are hard-coded `de-DE`, also on `/en`.
10. **Resumed threads lose tool parts** (`transcriptToMessages()` is text-only). Cards are gone, and `update_customer_profile` replays are not sent on later turns of a resumed thread. The backend does **not** restore that profile from a store: it rebuilds it on every turn from the replayed history (`extractProfile()` in `src/app/api/chat/route.ts`, AC §2 "Request body"), so a resumed thread starts with an empty profile. A signed-in customer's memory comes separately (`resolveChatIdentity()`, `src/lib/customer-memory.ts`: the name, and with personalisation consent the customer record's profile summary and purchase history).
11. **Signed-in but unsettled first send** → a thread without `conversationKey` and no PDF download for it (§13).
12. **`product_cta_opened` uses the numeric Shopify id**, while `product_cta_clicked`/`add_to_cart_clicked` use catalog ids/handles. Joining these needs a mapping.
13. **`add_to_cart_clicked.productIds` includes sold-out items** that are not in the checkout link.
14. **Output-less tool parts are replayed as `output-available`** (§3.3). After `tool-output-error`, a mid-tool stream error or a network drop after the input, the widget stores the part with `state: "output-available"` and no `output`. `sanitizeToolParts` (`src/lib/chat-message-sanitize.mjs`) drops only `input-streaming`/`input-available` parts, so these reach `convertToModelMessages` without a result. Impact on the provider call not verified. Fix on either side: the widget keeps `state: "input-available"` until an output arrives (`accumulatePart()`), or `sanitizeToolParts` also drops parts whose `output` is undefined.
15. **[Fixed 2026-10-04] New chat / open conversation during a streaming reply** (§13, same as 02 §21 item 1): `startNewChat()` and `openConversation()` call `abortActiveStream()` + `endSpeaking()` + `removeTyping()` first. Before, a signed-in user's late reply was appended to the new or opened thread and saved.
16. **Consent copy displayed on a tool card comes from `GET /api/consent-copy`, not from the tool output** (§8.6). If the backend ever served different copy in `offer_email_summary`'s `output.consentCopy` than from `/api/consent-copy`, the GET copy is what is displayed and echoed as `consentTextShown`. Keep both sources identical (or drop the tool-output copy).
17. **Hands-free voice mode stalls after HTTP 400/401/403/5xx** (§11): the mic is not re-armed and the transcript lands in the composer.
18. **Streaming Markdown hold-back** (§9): a bare `[` or an unmatched `*`/`` ` `` in prose freezes the visible bubble until the run ends. A prompt-side rule avoids it. A widget-side fix would limit the hold-back to a trailing token.
19. **`capturedEmail` survives "Neuen Chat starten"** (§3.2, §13). Only `dropSessionHistory()` clears it, so after an anonymous/email-only `startNewChat()` (header icon or the `payload_too_large` button) the address keeps leaving the browser as `customer.email` on `/api/chat` and as `email` + `tier: "email"` on `/api/feedback`, under a new sid. The backend ignores it for memory (capture/session mismatch), so returning-customer memory silently stops. Either clear `capturedEmail` in `startNewChat()` (cleaner privacy, matches the backend's session scope) or accept the leak. Related: neither call checks auth, so a captured address is still sent after auth settles as signed in in the same page view (§16).
20. **Loose numbered lists render every item as "1."** (§9). Prompt rule: tight lists, no blank lines between items.
21. **First CTA turn of a page view drops the thread's `conversationKey`** (§3.2, §13). Auth is resolved lazily on the first panel open, and `openWithProduct()` sends synchronously right after `openPanel()`, so `startStream()` sees `auth.signedIn === false` and omits the key even though `activeConversationKey` was restored. The backend files the turn under the legacy `session_id` thread, which can create a stray or duplicate history entry for a signed-in customer. Fix: send the stored key whenever one exists, or delay CTA sends until `auth.settled`.
22. **Restored `offer_email_summary` shows the capture form to signed-in customers** (§8.6, §12; same as 04 §18 item 2). `init()` renders history before auth settles and nothing re-renders after `applyAuth()`, so the `buildToolCard()` suppression only works for offers that arrive after auth has settled.

**KPI levers (frontend changes the backend could request)**

- **Send page context on typed turns** (at least the first message of a session, or when the page changed since the last context). Today a shopper on a product page who types "Ist das leise?" gives Mo no product. → `tasks/2-page-context.md`; the backend side is built (AC §2 `source: "page"`, `CHAT_PAGE_CONTEXT_ENABLED` default off in code).
- **Track Markdown link clicks** in assistant text (product links in prose are currently invisible to the KPI funnel).
- **Make card thumbnails and names clickable** (same `product_cta_clicked`). Today only the button is a link.
- **Add a checkout/add-to-cart action to `show_product` and `compare_products`.** Today a purchase click needs the model to call `add_to_cart`.
- **Use `rating`/`ratingCount`, `priceMin/Max` "ab", and a variant selector** from `variants[]` (AC §3) on product cards.
- **Order attribution for card checkouts:** the chat card's `cartUrl` comes from `/api/products` and is a bare permalink (AC §3, example `/cart/<variantId>:1,…`; AC §3 says nothing about `_mo`). Per OA only Mo-built email and bundle links (summary email, marketing email, bundle offers) carry `attributes[_mo]`, so the widget card relies on the live-cart stamp. The widget stamps the *current* cart via `/cart/update.js` before opening the permalink. Whether the stamp survives a cart-permalink checkout is not verified in this repo (see open questions). Appending `attributes[_mo]=<token>` to the permalink (as the email links do, OA) would make it explicit.
- **The first-message popup never shows in voice mode.** Voice users are never asked to sign in or opt in.
- **Add a "stop generating" button.** None exists today.

**Risks**

- Silent tool outputs (`search_products`, `get_order_status`) are stored in `localStorage` and re-sent on every turn. This means bandwidth and storage use, and order data on shared devices (mitigated by sid rotation on sign-out/erase). A storage-quota failure silently keeps an older snapshot.
- Streaming TTS fires all chunk requests in parallel, so long answers create bursts against the `tts-stream` rate-limit bucket (AC §1 "Rate limits").

---

## 21. Open questions / uncertainties

1. **Cart permalink + stamped attributes:** does Shopify's `/cart/<variant>:1` permalink (opened in a new tab) keep the cart attributes stamped by `/cart/update.js` in the chat tab, or does it build a fresh checkout without them? This decides whether "Zur Kasse" orders count as attributed. Not determinable from this repo. It needs a live test order.
2. **Does the permalink replace or merge** with the shopper's existing cart contents? The widget code assumes it "populates the cart in the new tab". The exact Shopify behaviour is not documented here.
3. **Variant-ref names:** for `handle~variantId` ids, whether the returned `name` includes the variant title (the widget shows only `name`) depends on the backend. Check `GET /api/products` output.
4. **Live parity:** this describes `main` at `3e87341`; which build the shop serves: README §4 (`npm run verify:widget`). Live-editor drift has reverted widget work before, so diff after each upload (`01` §16).
5. *(answered)* **`get_order_status`** is silent in the widget (§6.1): stored and replayed, never rendered. The backend offers it only while `CHAT_ORDER_STATUS_ENABLED` is on (default off in code; while off, only the test accounts in `CHAT_ORDER_STATUS_TEST_CUSTOMERS` get it), and it answers only a chat sign-in; a session recognised only through the shop gets `sign_in_required` (AC §2 "Tools the widget MUST NOT render", ACCT §3a).
6. *(answered)* **Backend profile on resumed threads:** not restored. The profile is rebuilt from the replayed history on every turn, so a resumed text-only thread starts empty; signed-in memory comes separately (finding 10).
