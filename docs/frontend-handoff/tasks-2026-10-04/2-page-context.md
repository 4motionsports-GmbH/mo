# Frontend task: page context on typed product-page messages (2026-10-04)

Paste this into the frontend agent that owns `ms_shopify_clone`. Attach these files:
- `docs/API_CONTRACT.md`: §2 "Request body" and "Optional `context`", §5
- `docs/frontend-handoff/WIDGET_SPEC.md`: §9b Telemetry, §9c "Privacy posture" and "Page context + browsing trail"
- `docs/frontend-handoff/BEHAVIOR_REFERENCE.md`
- `docs/frontend-handoff/LOCALE.md`: §1

Where this prompt and the attached files disagree, the files win.

## Baseline
This task builds on widget `main` at `3e87341`. That is MANIFEST 2026-10-04 b (`8d0a0c4`) plus the `endSpeaking()` follow-up. It has been live since the owner's upload on 2026-10-04 (see the README status note).

How the widget behaves today:
- **Typed and spoken messages carry no `context`.** `onSend()` and `voiceSubmit()` call `sendMessage(text)` with no second argument.
- **Only two paths send `context`** (docs/frontend 03 §2, §4.3; 06 §2.4, F3):
  - the PDP CTA, through `openWithProduct()` → `sendMessage(primer, context)`;
  - the nudge click, through `showNudge()` → `sendContextGreeting(ctx)` with `messages: []`.
- **Result:** a shopper who opens Mo with the launcher on a PDP and types „Ist das leise?“ gives Mo no product.
- **Most PDP chats start by typing.** The CTA is only a small underlined text link above the price (01 §18).
- **The page facts already exist.** `PAGE_CTX` holds `type`, `productHandle`, `productName`, `collectionHandle` and `category` (03 §4.2).

## Goal and KPI
**What changes for the shopper:**
- On a product page, the first message a shopper types or speaks in a thread is sent together with that page's product.
- After the shopper moves to another product page, the next message is sent with the new product.
- Mo answers about that product from the first reply, instead of asking which product is meant.
- The backend puts the product's specs and stock into the model's pre-retrieved block (AC §2, "Existing conversation"). The sold-out and checkout rules therefore apply from the first answer.
- Mo may still show the open product as a card. A `show_product` card is what mints and stamps the `_mo` attribution token (05 §10.1, §10.3). Card tool calls are also what put a product into the conversation's discussed ids, and those ids decide the „Beraten & gekauft“ tier (`conversation-store.ts → persistTurn()` → `collectDiscussedProductIds()`; `mo-orders-store.ts` → `hasOverlap`; `ORDER_ATTRIBUTION.md`).

**Population:** „Sitzungen mit getippter Frage auf einer Produktseite“. These are sessions whose first `source: "page"` turn of kind `product` falls in the range. That includes chats that started elsewhere and later moved to a PDP.

**KPIs.** The primary KPI and the target sample size per arm are pre-registered before the holdout starts (Backend counterpart §2 `PAGE_CONTEXT_EXPERIMENT`).
- **Primary:** share of sessions with a `product_cta_clicked` for a product other than the open PDP (`samePage` is not `true`), within 24 h of the first page-context turn.
- **Secondary (descriptive, no significance badge):**
  - share with `add_to_cart_clicked` within 24 h;
  - share whose first answer contains a card other than the page product's own `show_product` card (`otherCards > 0`);
  - share that opened the storefront CTA (`product_cta_opened`) after the first question. This should drop in the applied arm.
- **Guardrail:** share of sessions with an attributed order (`mo_orders` by session) within 7 days, overall and for the tier `assisted` („Beraten & gekauft“).
- **Diagnostics only:** "first answer contains any card" (`productCards > 0`) and attrition (page-context turns without a finished answer). `productCards` counts tool calls, not rendered cards (05 §13.2).

**How we read it.** Admin → KPI → Beratung → „Seitenkontext auf Produktseiten“. It reads two server-only events:
- `page_context_applied {applied, kind, resolved, locale, pct}`, written when the request arrives (arm assignment);
- `page_context_answered {kind, productCards, otherCards}`, written when the turn finishes.

How the comparison works:
- **Arms.** When the switch is on, the backend runs a session-level holdout (`CHAT_PAGE_CONTEXT_HOLDOUT_PCT`, planned 20 %). It compares sessions with context (`applied: true`) against the holdout (`applied: false`).
- **Only one period is compared.** Only sessions whose rows all carry the same holdout share (`0 < pct < 100`) are compared, so different periods never get mixed.
- **`samePage`** on `product_cta_clicked` (task 3) separates clicks that only reopen the current PDP from clicks on alternatives and accessories.
- **`resolved: false`** shows handles the catalog does not know. This is the risk of translated handles on `/en` (06 §2.3).

## Contract references
- **AC §2 "Request body" → "Optional `context`":**
  - Shape: `{type, productId, productTitle?, recentlyViewed?}`.
  - It gains the optional `source: "page" | "cta" | "nudge"`. Absent or unknown values are ignored ("No-op if the widget ships later").
  - For `source: "page"` the backend accepts only two shapes: `type: "product"` (any `recentlyViewed` is ignored) and `type: "browsing"` with exactly one `category` entry. Any other `source: "page"` context is dropped.
- **AC §2 Privacy paragraph:** send context with the first message and when it meaningfully changed. Never send it as a per-turn heartbeat.
- **AC §2 "Existing conversation (`messages` non-empty + valid `context`)":** the pivot path plus pre-retrieved grounding. This is the path the typed turn takes.
- **AC §2 "Fresh open":** nudge greeting, unchanged.
- **AC §5:**
  - `product_cta_clicked` gains the optional `samePage: boolean`.
  - `page_context_applied` and `page_context_answered` are **server-only**, so the widget never sends them.
  - `POST /api/kpi` acknowledges server-only names with 202 but does not store them.
- **Session id:**
  - The sid in `x-ms-session` / the KPI `sessionId` is the join key (05 §3.1, 07 §5 rule 9).
  - The holdout is assigned per sid.
  - AC §6 applies only as the rate-limit bucket, which is unchanged.
- **LOCALE §1:** `x-ms-locale` and `locale` work as today. The server picks the DE or EN note.

## Backend state
**Deployed on 2026-10-05** (backend `main`, „Seitenkontext auf Produktseiten“):
- `context.source` is accepted.
- A `source: "page"` context with a non-empty `messages` gets a softer pivot note. In effect it says: „the user is writing from product page X; if the question is about a product and they name no other, they probably mean this one; for anything else ignore the note; never comment on the page“.
- `cta`, `nudge` and absent sources keep today's behaviour, including today's stronger CTA pivot note.
- For `source: "page"`, `type: "product"` ignores `recentlyViewed`. A `type: "browsing"` context is used only with exactly one category entry; every other trail is dropped.

**Switches** (07 §5 rule 3: default off):
- `CHAT_PAGE_CONTEXT_ENABLED=false` (default). While the switch is off, a `source: "page"` context is treated as if none had been sent: today's typed-turn behaviour. The server still records `page_context_applied {applied: false, pct: 100}`, which lets the backend verify the upload without changing anything for shoppers.
- After the live check and an observation window, the backend sets `CHAT_PAGE_CONTEXT_ENABLED=true`. Later it sets `CHAT_PAGE_CONTEXT_HOLDOUT_PCT=20`.
- A held-out session is also treated as if no context had been sent.
- The response looks the same in every state. **The widget must not try to detect the switch or the holdout.**

**Server KPIs.** `/api/chat` writes `page_context_applied` when each `source: "page"` request arrives and `page_context_answered` when it finishes. Both are server-only.

**No-op if the widget ships later.**
- The live widget never sends `source`, so nothing changes until this upload.
- If this widget ever hit an older backend, the backend would ignore `source` and apply today's CTA pivot note to typed PDP turns. That wording is stronger, but safe.

## Rules that do not change
- **Page facts only, never user data.** The data class is the same as the CTA sends today: handle, title, page type.
- **No `recentlyViewed` trail on typed or spoken turns.** The trail rules are unchanged (07 §7 A3), and the server now enforces this for `source: "page"`.
- **Context only on a send the user starts.** Never as a per-turn heartbeat (AC §2 Privacy).
- **KPI payloads carry ids, enums and booleans only:** the clicked product id, `pageType`, `samePage`. Never message text, product names, the browsing trail, raw URLs, tokens or emails (05 §2.3, §13.3).
- **The widget never sends server-only events.** That means the AC §5 server table plus `page_context_applied` and `page_context_answered`.
- **Tone rule:** copy references the page or category, never the visitor's behaviour. This task adds no copy.
- **Consent:** consent copy comes only from the backend and is rendered verbatim, never pre-selected, with `consentTextShown` echoed byte for byte. This task touches no consent surface.
- **Unknown tools render nothing.**
- **Contract changes stay additive.** Keep the `sendMessage(text, context?)` signature. Keep ES5, a single file and no build (02 §16, §20).

## Tasks (in order)

### 1. Attach page context to the first typed or spoken message on a PDP and after a product change (required)
- **Where (`ms-chat-widget.js`):**
  - New constant `CTX_LAST_KEY = 'ms-chat-ctx-last'`, next to `CAMPAIGN_TOKEN_KEY` (02 §4 row 39).
  - New helpers `pageCtxKey(ctx)` and `pageContextForSend()` in the "Send and SSE stream" section (02 §4 row 27).
  - Call `pageContextForSend()` in `onSend()` and `voiceSubmit()`, right before `sendMessage(text, ctx)`. The call must come after their existing `state.streaming || state.rateLocked` guards, and before `sendMessage()` pushes the optimistic user message.
  - **Write the key in `finalizeStream()`, not at `res.ok`.** Put it inside the existing branch that pushes the assistant message, which runs only when `asstParts` is non-empty and `sid === streamSid` (03 §6.3).
    - A cancelled turn (`startNewChat()`, `openConversation()`, `dropSessionHistory()`) never gets there, because its `cancelled` flag makes `finalizeStream()` a no-op (03 §13).
    - `ms_mo_c` is still deleted at `res.ok` as today. Only the new key moves.
  - `ssDel(CTX_LAST_KEY)` in `openConversation()` once the transcript has loaded, next to the `abortActiveStream()` call from `8d0a0c4`.
  - Sketch (ES5):
    ```js
    function pageCtxKey(ctx) {
      if (!ctx) return null;
      if (ctx.type === 'product' && ctx.productId) return 'p:' + String(ctx.productId);
      if (ctx.type === 'browsing' && ctx.source === 'page' && ctx.recentlyViewed && ctx.recentlyViewed[0] && ctx.recentlyViewed[0].id) return 'c:' + String(ctx.recentlyViewed[0].id);
      return null;
    }
    function pageContextForSend() {
      try {
        if (!(PAGE_CTX.type === 'product' && PAGE_CTX.productHandle)) return undefined; // task 4 extends this
        var ctx = { type: 'product', productId: PAGE_CTX.productHandle, source: 'page' };
        if (PAGE_CTX.productName) ctx.productTitle = PAGE_CTX.productName;
        var hasUserMsg = messages.some(function (m) { return m && m.role === 'user'; });
        if (hasUserMsg && ssGet(CTX_LAST_KEY) === sid + '|' + pageCtxKey(ctx)) return undefined;
        return ctx;
      } catch (e) { return undefined; }
    }
    // finalizeStream(), inside the existing "asstParts non-empty && sid === streamSid" branch,
    // with the request body startStream() sent (whatever its local is called):
    //   var k = pageCtxKey(chatBody.context);
    //   if (k) ssSet(CTX_LAST_KEY, streamSid + '|' + k);
    ```
- **Trigger and timing:** only on a send the user starts (Enter or the send button; a final voice-mode transcript). Context is attached when `PAGE_CTX.type === 'product'`, `PAGE_CTX.productHandle` is set, and either of these holds:
  - (a) the thread has no user message yet (a fresh thread, or one with only a nudge greeting), or
  - (b) `sessionStorage['ms-chat-ctx-last'] !== sid + '|p:' + PAGE_CTX.productHandle`.

  Never on later turns on the same PDP. Never from cards, popups or background code.
- **Request:** `POST {apiBase}/api/chat`.
  - Headers are unchanged: `Content-Type`, `x-ms-chat-key`, `x-ms-session`, `x-ms-locale`.
  - Example body:
    ```json
    {
      "messages": [
        { "id": "u-3f1c…", "role": "user", "parts": [{ "type": "text", "text": "Ist das leise?" }] }
      ],
      "locale": "de",
      "context": { "type": "product", "productId": "atx-treadmill-pro-fold", "productTitle": "ATX Treadmill Pro Fold", "source": "page" }
    }
    ```
  - `conversationKey`, `campaignToken` and `customer` ride along exactly as today (03 §3.2).
  - Do not add `recentlyViewed`; the server would ignore it anyway.

  **Response:** the unchanged SSE stream (AC §2), parsed and rendered as today.
- **Response handling:**

  | status | widget behaviour | KPI |
  | --- | --- | --- |
  | 200, stream finishes with content | As today. In addition, `finalizeStream()` writes `ssSet(CTX_LAST_KEY, streamSid + '\|' + pageCtxKey(chatBody.context))` whenever the body carried a context (typed, CTA or nudge) and `pageCtxKey()` is not null. This happens inside the branch that saves the assistant message (`asstParts` non-empty, `sid === streamSid`). | none new (`message_sent` stays `{}`) |
  | 200, SSE `error` chunk with **no** content | As today: the error line is appended and the user message stays without a reply (03 §11, 07 §5 rule 5). The key is **not** written. The backend is stateless per request and never stored the pivot note, so the retry must carry the context again. | none |
  | 200, SSE `error` chunk after partial content | As today. The key is written, because the partial answer was grounded and is in the history. | none |
  | Turn cancelled (`startNewChat()`, `openConversation()`, sign-out, sid rotation) | As today: `finalizeStream()` is a no-op, so no key is written. | none |
  | 429 `rate_limited` | As today: rollback and `lockRateLimit()`. No key is written, so the next send carries the context again. | none |
  | 400 `payload_too_large` / `bad_request`, 401, 403, ≥ 500 | As today (03 §11). No key is written. | none |
  | Network error before any content | As today: rollback and voice loop restart. No key is written. | none |

- **UI strings:** none. No new chrome and no served text.
- **Storage:** `sessionStorage['ms-chat-ctx-last']`.
  - Value: `'<sid>|p:<handle>'` (task 1) or `'<sid>|c:<collectionHandle>'` (task 4).
  - Written by `finalizeStream()` through `ssSet`, only for a saved, non-cancelled turn of the request's sid.
  - Lifetime: the tab session. It survives a reload of the same tab.
  - Cleared by `openConversation()` on success (`ssDel`).
  - Any sid change invalidates it through the sid prefix: `rotateSession()`, `dropSessionHistory()`, `onSidChangedElsewhere()`.
  - With the `memSession` fallback it lasts one page load.
  - Never in localStorage, never in a KPI payload.
  - It is chat-functional storage, written only inside a send the user started.
- **KPI:** no new widget event; `message_sent` stays `{}`. The effect is measured by the server-only `page_context_applied` and `page_context_answered`, which the widget must never send.
- **Failure mode:** fail-silent. If building the context throws, send without it (`pageContextForSend()` returns `undefined`). A failed, empty or cancelled turn never writes the key.
- **Edge cases:**
  - **Reload of the same PDP mid-thread:** no context, because the key matches.
  - **Next PDP in the same tab:** context with the new handle. Going back to the first PDP sends it again (key mismatch).
  - **Product link opened in a new tab (`noopener`, fresh sessionStorage):** context once, on the first typed message there, even though the thread has history. This is acceptable under AC §2.
  - **Signed-in vs anonymous:** the same rule for both. Auth state, `conversationKey` and the not-yet-settled first send (03 §13) are unaffected.
    - Signed-in `startNewChat()` keeps the sid, but the fresh thread has no user message, so context is sent.
    - Anonymous `startNewChat()` rotates the sid, so context is sent.
    - `openConversation()` clears the key, so the next typed message on a PDP carries context once.
  - **Reply still streaming when „Neuer Chat“ or a past conversation is opened:** the cancelled turn writes no key, so the next typed message on the PDP carries context.
  - **Streaming in progress or rate-locked:** `onSend()` and `voiceSubmit()` return before the helper runs. Nothing changes.
  - **Another tab rotated the sid (`onSidChangedElsewhere()`):** the prefix no longer matches, so context is sent once more.
  - **Voice mode:** the first spoken turn on a PDP follows the same rule through `voiceSubmit()`. Gate and popup behaviour is unchanged.
  - **After a nudge greeting (`messages` holds only the assistant greeting):** the first typed message still carries `source: "page"`. This is intended, because the greeting turn grounded only the greeting.
  - **After a CTA primer:** the CTA turn wrote the key (if it finished with content) and the thread has a user message, so the next typed message on that PDP carries no context.
  - **`/en`:** send `PAGE_CTX.productHandle` unchanged. Do not translate it and do not fall back to the numeric id. Send `x-ms-locale: en` as today.
  - **Product not in Mo's catalog:** still sent. The server records `resolved: false` and adds no note.
  - **Variant:** do not add it (backlog D3 covers it).

### 2. Mark CTA and nudge context with `source` (required)
- **Where:** `ms-chat-widget.js → openWithProduct()` (the `context` object it builds) and the `showNudge()` click handler (the `ctx` passed to `sendContextGreeting()`).
- **Trigger and timing:** unchanged. These are the existing CTA click and nudge click paths.
- **Request:** add `"source": "cta"` or `"source": "nudge"` to the existing `context`, and nothing else:
  ```json
  { "messages": [ …primer… ], "locale": "de",
    "context": { "type": "product", "productId": "atx-rack-pro", "productTitle": "ATX Rack", "recentlyViewed": [ … ], "source": "cta" } }
  ```
  ```json
  { "messages": [], "locale": "de",
    "context": { "type": "product", "productId": "atx-rack-pro", "productTitle": "ATX Rack", "recentlyViewed": [ … ], "source": "nudge" } }
  ```
  The `browsing` nudge context gets `"source": "nudge"` too. CTA and nudge contexts keep their trail, as today.

  **Response:** unchanged.
- **Response handling:** as in task 1. A finished turn with content also writes `ms-chat-ctx-last` through `pageCtxKey()`:
  - the CTA as `p:<id it sent>` (on its own PDP this is the handle, 03 §4.3);
  - the product nudge as `p:<handle>`;
  - a `browsing` nudge context returns `null` from `pageCtxKey()`, so nothing is written.
- **UI strings:** none.
- **Storage:** see task 1.
- **KPI:** unchanged. `product_cta_opened {productId}` and `nudge_clicked {pageType, contextual}` as today.
- **Failure mode:** unchanged.
- **Edge cases:**
  - `window.MS_CHAT.openWithProduct()` called from a non-PDP page still sends `source: "cta"`.
  - The CTA's numeric-id swap logic (03 §4.3) is unchanged.
  - The server never holds out `cta` or `nudge` context, and the switch does not affect it.

### 3. `samePage` on `product_cta_clicked` (required; needed to read the effect)
- **Where:** the `ms-chat-widget.js → productButton()` click handler, and the fallback product-link handler in `buildAddToCart()` (the branch without `cartUrl`).
  - New helper: `function isSamePageProduct(id) { return PAGE_CTX.type === 'product' && !!PAGE_CTX.productHandle && String(id) === PAGE_CTX.productHandle; }`.
  - Compute it at click time.
  - If the Markdown text-link task (B4) ships in the same upload, its `product_cta_clicked` uses the same helper.
- **Trigger and timing:** the existing „Zum Produkt“ click, unchanged. `track()` is called before the new tab opens, as today.
- **Request:** `POST {apiBase}/api/kpi`. As in every `track()` call, `timestamp` is the client clock as an ISO string (05 §2.1):
  ```json
  { "event": "product_cta_clicked", "sessionId": "<sid>", "timestamp": "2026-10-06T09:12:33.120Z",
    "data": { "productId": "atx-treadmill-pro-fold", "samePage": true } }
  ```
  `samePage` is always a strict boolean: `false` off a PDP and for every other product.

  **Response:** never read (AC §5).
- **Response handling:** none (fire-and-forget, as today).
- **UI strings:** none.
- **Storage:** none.
- **KPI:** `product_cta_clicked` gains `data.samePage: boolean`.
  - The event name is unchanged. It still matches `%product%click%` in `CTA_PATTERNS` (`src/lib/kpi-event-patterns.mjs`), so it keeps counting as a product click.
  - No new name is added. Nothing matches `%cart%` or `%checkout%`.
  - `productId` stays the catalog handle.
  - Data class: one boolean on an existing click event. No name, no trail, no URL.
- **Failure mode:** fail-silent (`track()`).
- **Edge cases:**
  - Variant refs come back from `/api/products` with the base handle as `id` (06 §2.3), so they compare correctly.
  - On `/en` with a translated handle the flag is `false`. Such chats are `resolved: false` anyway and excluded from the comparison.
  - Cards restored from history use the same click handler.

### 4. Collection pages (optional, S)
- **Where:** extend `pageContextForSend()` with an `else if` branch for `PAGE_CTX.type === 'collection' && PAGE_CTX.collectionHandle && PAGE_CTX.category`.
- **Trigger and timing:** the same rule as task 1, with the key `'<sid>|c:<collectionHandle>'`.
- **Request:** `"context": {"type": "browsing", "recentlyViewed": [{"type": "category", "id": "<PAGE_CTX.collectionHandle>", "name": "<PAGE_CTX.category>"}], "source": "page"}`.
  - Exactly one category entry. No trail and no products. The server drops any other `source: "page"` browsing shape.
  - The server matches the category by name and uses a soft collection-page note.
  - Collection pages are never held out. The server only records coverage for them.

  **Response:** unchanged.
- **Response handling:** as in task 1.
- **UI strings:** none.
- **Storage:** as in task 1, with the suffix `c:<collectionHandle>`.
- **KPI:** none.
- **Failure mode:** fail-silent.
- **Edge cases:**
  - German collection titles on `/en` may not match the catalog; that shows up as `resolved: false`.
  - The home page, search, content and account pages never send context.

### 5. Correct the stale `PRIVACY POSTURE` comment above `PAGE_CTX` (required, no behaviour change; 03 §4.4)
- **Where:** the `PRIVACY POSTURE (do not change)` comment above `PAGE_CTX` in `ms-chat-widget.js`.
- **Trigger and timing:** none.
- **Request:** none. **Response:** none.
- **Response handling:** none.
- **UI strings:** none.
- **Storage:** none.
- **KPI:** none.
- **Failure mode:** none.
- **Edge cases:** none. Replacement text:
  ```
  // PRIVACY POSTURE (do not change): page facts and the browsing trail are gathered
  // client-side. Context leaves the browser ONLY inside a /api/chat request the user
  // starts: the product CTA (product + trail), a nudge click (greeting; product or
  // trail), and - page facts only, NO trail - the first typed or spoken message of a
  // thread on a product (or collection) page and the first after the page changed
  // (pageContextForSend()). Never in background calls. KPI events carry ids, enums
  // and booleans only (clicked product id, pageType, samePage); never product names,
  // the browsing trail, message text, URLs or tokens.
  // TONE RULE: copy references the page or category, never the visitor's behaviour.
  ```

## Legal constraints
- **Data class:** only page facts are sent: the product handle, title and page type, plus the collection handle and title for task 4. That is the same data class the PDP CTA and the nudge already send (03 §4.3). No browsing trail goes out on typed or spoken turns, and the server drops any trail on `source: "page"`. Nothing leaves the browser that does not already leave it today in another user-started request.
- **When it is sent:** only with a request the user starts, and only on the first message of a thread and after a product change. That matches AC §2 Privacy ("not as a per-turn heartbeat").
- **Device storage:** the only new storage is `sessionStorage['ms-chat-ctx-last']`. It is written only inside a send the user started, and it serves only the chat (it avoids re-sending the context), so it is strictly necessary under § 25 TDDDG.
- **KPI:**
  - No new widget event. `samePage` is a boolean on an existing click event, so this task adds no interaction-free event and no new § 25 TDDDG exposure (05 §13.3).
  - `samePage` together with `productId` does reveal that the click happened on that product's page. The product id already leaves the browser through `product_cta_opened` and `product_cta_clicked` (05 §2.3). Storing a boolean is more minimal than storing the page's product id server-side.
  - `page_context_applied` and `page_context_answered` are server-only and carry no product id.
- **Consent and served copy:** none. No served copy, no consent surface, no `lawyerApproved` or `enLegalReviewed` dependency, nothing pre-selected.
- **Holdout:** a server-side comparison on the pseudonymous sid. The widget is unaware of it. It adds a purpose for the sid (a controlled comparison with a deliberately degraded control arm). The page product also now travels with every typed PDP chat, not only after an explicit "about this product" click.
- **Lawyer to confirm:** the Datenschutzerklärung covers page facts sent with chat messages and quality comparisons with a control group on the session id (Art. 6(1)(f) GDPR). There is no new device storage beyond the chat-functional `ms-chat-ctx-last`. The sid itself is still the open question in 05 §13.3. Get this confirmation before the holdout is switched on.
- **Tone rule:** the server's note forbids Mo to comment on which page the visitor is viewing.

## Deployment
- **Files to upload:** `assets/ms-chat-widget.js`. No CSS change.
- **Shared files to hand-edit in the live editor:** none. No change to `layout/theme.liquid`, the snippet or the templates.
- **MANIFEST entry required.** It can share one entry with the C2/C3 card task and the B4 text-link task if those are ready at the same time. Do not wait for them.
- **Switches** (backend only; the widget is not affected):
  - `CHAT_PAGE_CONTEXT_ENABLED=true` after the live check and an observation window of 2–3 days;
  - later `CHAT_PAGE_CONTEXT_HOLDOUT_PCT=20`.
- **Live check:** the `ms-chat-ctx-last` marker in the served JS, found by the backend's `npm run verify:widget` (07 §6.4).

## Acceptance checklist
- [ ] **PDP, fresh thread, typed message:**
  - The `POST /api/chat` body has `context: {type: "product", productId: <PAGE_CTX.productHandle>, productTitle, source: "page"}` and no `recentlyViewed`.
  - The headers are `x-ms-chat-key`, `x-ms-session` and `x-ms-locale`.
  - After the reply has finished, `sessionStorage['ms-chat-ctx-last'] === sid + '|p:' + handle`.
- [ ] **Same PDP:** the second typed message carries no context. Neither does a reload of that PDP followed by typing.
- [ ] **Another PDP:** the first typed message carries context with the new handle. Going back to the first PDP sends it again.
- [ ] **Voice mode on a PDP:** the first spoken turn carries the same context.
- [ ] **CTA, then a typed message on the same PDP:** only the CTA turn carries context (`source: "cta"`, primer user message, trail as today).
- [ ] **Nudge on a PDP:** the greeting has `messages: []` and `source: "nudge"`. The first typed message after the greeting carries `source: "page"`.
- [ ] **New threads:** typing on a PDP carries context after each of these:
  - signed-in „Neue Beratung“ or `startNewChat()`;
  - anonymous „Neuen Chat starten“ (new sid);
  - `openConversation()`;
  - another tab rotating the sid.
- [ ] **Error and cancel paths:**
  - A 429 or 5xx on the first PDP send writes no key, and the next send carries the context again.
  - An SSE `error` chunk with no content writes no key, and the next send carries the context again.
  - An `error` chunk after partial content keeps the key.
  - A reply cancelled by „Neuer Chat“ or by opening a past conversation writes no key.
- [ ] **Other pages:** home, search, content, account and cart-adjacent pages send no context. Collection pages send it only if task 4 is implemented, and then exactly as `{type: "browsing", recentlyViewed: [one category], source: "page"}`.
- [ ] **`/en` PDP:** the handle is sent unchanged with `x-ms-locale: en`.
- [ ] **`samePage`:**
  - „Zum Produkt“ on the current PDP's product sends `product_cta_clicked {productId, samePage: true}`.
  - Another product sends `samePage: false`.
  - Off a PDP it is always `false`.
  - The add-to-cart fallback links behave the same.
  - `timestamp` is an ISO string as in every `track()` call.
- [ ] **Backend live check** (run by the backend after the upload, not in the harness): `npm run verify:live -- --session <first 8 chars of the test sid>`, section „7 · Seitenkontext“, lists for that sid:
  - `page_context_applied` with `applied`, `kind`, `resolved`, `locale`, `pct` (`pct: 100` while the switch is off);
  - `page_context_answered` with `productCards` and `otherCards`;
  - the widget's `product_cta_clicked` with `samePage`.
- [ ] **Negative cases:**
  - The widget never sends `page_context_applied`, `page_context_answered` or any other server-only name.
  - An older-backend mock that ignores `source` still streams and renders normally.
  - Anonymous and signed-in behave identically.
  - The rate lock and streaming guards are unchanged.
- [ ] **Harness:** new checks added and passing in DE and EN at 1280 and 390. Cover:
  - typed, voice, CTA and nudge turns;
  - reload and product change;
  - new chat, `openConversation()` and other-tab rotation;
  - 429/5xx retry, SSE error with and without content, and a cancelled turn;
  - the older-backend mock;
  - the `samePage` payloads.

  Cross-cutting invariants as in 07 §6.1.
- [ ] No console errors, no new hard-coded legal text, no pre-selection, no server-only events.
- [ ] Screenshots DE and EN (desktop 1280, mobile 390) of every new or changed surface. None is expected; attach one PDP chat answer per locale as evidence.

---

