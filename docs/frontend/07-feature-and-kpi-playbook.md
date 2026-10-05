# 07 — Feature and KPI playbook (for backend agents planning new work)

> **Audience:** backend coding agents of Mo (`4motionsports-gmbh/mo`) who plan features, KPI work or contract changes that touch the storefront.
> **Basis:** chapters 01–06 of this folder (theme repo `ms_shopify_clone`, `main` at `3e87341` = PR #73 `a0df103`, the fixes of `8d0a0c4`, and two `endSpeaking()` calls), the backend's widget contract `docs/frontend/API_CONTRACT.md`, `ACCOUNT_CONTRACT.md` and `CONSENT_CONTRACT.md` (cited by file name and §), the current tasks in `docs/frontend/tasks/`, and the widget test logs of the PR #73 session. Production status (uploads, App Proxy, backend switches) is tracked only in the backend's `docs/ROLLOUT_TODO.md`; which build the live shop serves: §6.4. **AD §n** = `docs/ADMIN_DASHBOARD.md`. Code locations are `file → function / key`; line numbers are left out on purpose.
> Effort scale (same as chapter 05): **S** = under half a day of widget work, no new endpoint. **M** = 1–3 days, or needs a small backend addition. **L** = new UI flow and/or several backend changes. **Ops** = a person in Shopify admin, the theme editor or a lawyer.

This chapter turns the facts of chapters 01–06 into decisions. It tells you whether an idea needs only a backend deploy, a widget release or a theme/admin change; how to extend the widget for each kind of feature and what that costs on the frontend; how to write a frontend task the frontend agent can implement; which rules keep contract changes safe while the live widget lags behind; how the widget is tested; and which opportunities are worth doing first.

**Contents**

1. [The constraints that shape every plan](#1-the-constraints-that-shape-every-plan)
2. [Decision guide: backend-only, widget change, or theme/admin change](#2-decision-guide-backend-only-widget-change-or-themeadmin-change)
3. [Extension patterns](#3-extension-patterns)
4. [How to write a frontend task](#4-how-to-write-a-frontend-task)
5. [Contract-change rules](#5-contract-change-rules)
6. [Testing: the widget harness and live checks](#6-testing-the-widget-harness-and-live-checks)
7. [Prioritised opportunity backlog](#7-prioritised-opportunity-backlog)
8. [Open questions that block or change priorities](#8-open-questions-that-block-or-change-priorities)

---

## 1. The constraints that shape every plan

| Constraint | Consequence for planning | Ref |
| --- | --- | --- |
| **Manual deploy.** The owner copies changed files from `main` into the Shopify code editor using `MANIFEST.md`. | Every widget change has an upload lag of unknown length. Backend changes must work with the **currently uploaded** widget until then. | `01` §16.2 |
| **Two editors.** Another person edits templates, sections, app blocks and settings in the live theme editor. | Anything in editor-owned files (the "MO only" CTA block in `templates/product*.json`, `layout/theme.liquid`, `sections/header.liquid`) can be changed or reverted without a repo commit. Prefer widget-JS solutions over template edits where both work. | `01` §2.2, §16.5 |
| **Drift has happened.** The 2026-08-12 snapshot commit silently reverted PR #67 and #62 (restored 2026-10-01). | Never assume a merged change is live. Plan a live verification step for anything you depend on. | `01` §16.3 |
| **No widget version signal.** The widget sends only `x-ms-chat-key`, `x-ms-session`, `x-ms-locale` (checked: no other `x-ms-*` header in `ms-chat-widget.js`). | The backend cannot tell which widget build is calling. Switches must be flipped by a person after a live check. | §5 |
| **The uploaded build is the baseline.** | Plan against the build the live shop serves (§6.4; `main` is `3e87341`) and check it after every upload (§6.3). What is uploaded and switched on: `docs/ROLLOUT_TODO.md`. | §6.3, §6.4 |
| **Shop recognition needs the App Proxy.** | Without it there is no silent shop-login recognition, and the widget pays one Shopify 404 page fetch for `/apps/chat/whoami` per tab session on the first open (`sessionStorage['ms-chat-whoami-done']`, set before the call, `detectViaStorefront()`) before the sign-in affordances appear. With it, the backend issues codes only behind `APP_PROXY_SIGNIN_ENABLED` (default off in code), and only a build that redeems `linkCode` is safe (drift risk, P0.3). Setup and state: `docs/ROLLOUT_TODO.md` 5.4. | `04` §5.4 |
| **Lazy auth.** The widget makes no auth call before the first panel open, with three exceptions, all in `ms-chat-widget.js → handleAuthReturn()`. (1) The sign-in return page load: `POST /api/auth/link`, then `GET /api/auth/me`. If the redeem fails and the device has a signed-in hint (`shouldProbeAuth()`), it also calls `probeAuth(true)`. (2) The single retry after a 503 on the next page load of the tab (`retryPendingLink()`, code kept ≤ 10 min in `sessionStorage['ms-chat-link-retry']`). (3) A `?ms_auth=logged_out` return sets `sessionStorage['ms-chat-whoami-done']` and calls `GET /api/auth/me` on load (`probeAuth(true)`) when `shouldProbeAuth()` is true. If the server confirms that a sign-in this device had has ended, it wipes the stored history and rotates the sid (`endedSignInCleanup()`). | Backend cannot personalise the launcher, nudge or welcome for a visitor who has not opened the panel. | `02` §2.6 |
| **Context only on CTA and nudge.** Typed turns carry no `context`. | Prompt changes that "use the current product" only work after a CTA or nudge click until the widget changes (backlog A3: backend built, widget = task 2). | `03` §2 |
| **KPI is not consent-gated; the sid is set for everyone.** | New interaction-free events increase legal exposure (§ 25 TDDDG). Decide with the lawyer, or gate on `analyticsProcessingAllowed()`. | `05` §13.3 |

---

## 2. Decision guide: backend-only, widget change, or theme/admin change

### 2.1 Decision flow

```mermaid
flowchart TD
  A[New idea] --> B{Does it change only what Mo says,<br/>which existing tool it calls,<br/>or data in fields the widget already renders?}
  B -- yes --> BE[Backend-only.<br/>Deploy any time.<br/>Check legal if it touches served copy.]
  B -- no --> C{Does it need new UI, a new card,<br/>a new KPI event or field, new request fields,<br/>new timing or storage in the browser?}
  C -- yes --> W[Widget change:<br/>ms-chat-widget.js/.css.<br/>Frontend task + PR + harness + manual upload.<br/>Backend first, behind a switch.]
  C -- no --> D{Does it need new Liquid data, markup on a template<br/>or section, a theme setting, or a URL parameter<br/>stripped before analytics?}
  D -- yes --> T[Theme change.<br/>Snippet/Mo files: frontend task.<br/>Editor-owned templates: owner + live editor.]
  D -- no --> E{Shopify app or admin config<br/>App Proxy, template assignment,<br/>metafield definitions, markets?}
  E -- yes --> O[Ops: owner in Shopify admin / app deploy.<br/>App Proxy: ROLLOUT_TODO 5.4,<br/>drift check 6.4, see P0.3.]
  E -- no --> L[Probably backend-only. Re-check against<br/>the hooks list in 06 section 12.]
```

### 2.2 Concrete examples

| Idea | Category | Why | What to do |
| --- | --- | --- | --- |
| Change Mo's tone, prompts, when it shows products or offers the email summary | **Backend-only** | Text and existing tool calls render as today (`03` §6, §8) | Deploy. Watch `message_sent` → `product_cta_clicked` rates. |
| Show a different product, price, image or stock state in cards | **Backend-only** | `name`, `price`, `salePrice`, `images[0]`, `inStock`, `shopifyUrl`, `specifications`, `deliveryTime`, `cartUrl` render (`03` §7) | Change `/api/products`. |
| Send English shoppers to `/en` product pages, or deep-link the chosen variant | **Backend-only** | "Zum Produkt" opens `shopifyUrl` as is; API_CONTRACT.md §3 allows `?variant=<id>` (`06` §5.2) | Localise/extend `shopifyUrl` server-side. The widget sends no locale to `/api/products`, so a locale-aware URL needs a request param, which is a widget change, or a separate field. |
| Show review stars, an "ab" price or the `show_product.reason` | **Widget change** | `rating`, `priceMin/Max`, `reason` are ignored (`03` §7, §8.1) | Frontend task (S each). |
| Put `_mo` onto the „Zur Kasse“ permalink | **Widget change** | `/api/products` is public, session-less and cached 60 s, so a per-session token cannot go into `cartUrl` safely (`06` §15.1) | Frontend task T1 (backlog A2). |
| Join `product_cta_opened` (numeric id) to catalog handles | **Backend-only** (or widget T10) | The catalog sync has both ids (`06` §2.3) | Map numeric → handle in the KPI query. |
| New marketing / consent wording, erase text, returning-customer hint | **Backend-only + legal** | Served copy renders verbatim (`04` §11) | Lawyer sign-off first; keep the validator's required keys (§5.7). |
| Ask again after an unconfirmed DOI expired | **Backend-only** (built) | `optInActionable` is the master switch (`04` §17) | Done: the nightly run resets an expired `pending` to no consent, so the ask may come back (ACCOUNT_CONTRACT.md §6.1). The widget's 30-day device decline still applies. |
| A new background tool (lookup, profile write) | **Backend-only** (exact name matching since PR #73; verify the live build with §6.4), plus a one-line widget change if its parts must be replayed | §3.1 | Name it carefully (§5.6). |
| A new card type (bundle, size finder, appointment) | **Widget change** | Unknown tools render nothing (`03` §6.1) | §3.2. |
| Attach page context to typed messages | **Widget change** | `sendMessage()` only sends `context` from CTA/nudge (`03` §2) | Backlog A3 (backend built, widget = task 2). |
| New KPI event or new field on an existing event | **Widget change** (+ dashboard) | Only `track()` call sites produce widget events (`05` §4) | §3.4. |
| New deep-link parameter (e.g. open with a topic) | **Widget change** (+ `layout/theme.liquid` if it is secret) | `handleMoDeepLink()` only knows `mo=open`, `#mo-open`, `mo_new=1`, `mo_view=fullscreen`; `mo_c` is handled by `captureCampaignToken()` and `ms_auth`/`ms_code` by `readAuthReturn()` (`05` §9.2) | §3.5. |
| More page facts (selected variant, price, availability) | **Theme change** (snippet) + widget | `pageContext` is built in Liquid (`01` §6.7) | §3.9. |
| Mo CTA on collection pages or in the „Hast du noch Fragen?“ block | **Theme change** (editor-owned sections: owner plus live editor) | CTA contract markup works anywhere (`06` §3.2) | §3.6; coordinate with the live editor, re-sync afterwards. |
| „Frag Mo“ link at the end of the product Q&A tab | **Theme change** in `snippets/product-qa.liquid` (Mo-owned) | CTA contract markup (`06` §3.2) | Normal frontend task and upload (`06` T9). |
| Translate the PDP CTA label | **Theme change** (editor-owned `templates/product.json`; the same block also sits in `product.produkt-new`, `product.produktnew`, `product.produkte-im-set`) | German literal in template JSON (`01` §6.2) | Owner + live editor, or a locale key. |
| Hide Mo on a template / kill switch | **Ops (theme editor)** | `ai_advisor_enabled`, `ai_advisor_excluded_templates` (`01` §12) | A person in Customize. The snippet hides the CTA on an excluded template (`06` §3.4). |
| Silent shop-login recognition | **Ops** (P0.3) | App Proxy config in the Shopify app (`06` §9.1) | No theme change. Backend: whoami issues a code only when the session will really be signed in (fresh signature, handover, a proof), behind the switches `APP_PROXY_SIGNIN_ENABLED` and `APP_PROXY_SIGNIN_MAX_AGE_HOURS` (default off in code; D-AP1). Steps and state: `docs/ROLLOUT_TODO.md` 5.4; drift risk `04` §5.4. |
| PDP Q&A content | **Backend-only** | `metafieldsSet` on `custom.qa` (`06` §4) | Keep ≤ 20 entries and the sanitiser. |

---

## 3. Extension patterns

Each pattern lists the exact steps on both sides, the frontend cost, the rollout order and the traps. "Upload" always means: PR merged, `MANIFEST.md` entry, owner copies the files, live check.

### 3.1 New background (silent) tool

**When:** the model needs data or must write something, and the result is expressed in Mo's text (like `search_products`, `get_order_status`).

| Side | Steps |
| --- | --- |
| Backend | Define the tool. Add it to API_CONTRACT.md §2 "Tools the widget MUST NOT render". Keep its **output small and non-sensitive**, or add it to `NON_REPLAYABLE_OUTPUT_TOOLS` in `src/lib/chat-message-sanitize.mjs` (today only `get_order_status`; `sanitizeToolParts()`, called from `src/app/api/chat/route.ts`, then replaces the replayed output with `{ replayed: true }`) if its replayed output must not be trusted, because the widget stores outputs in `localStorage['ms-chat-history:<sid>']` and sends them back on every turn (`03` §3.3, §12). Put it behind a switch. |
| Widget | **Nothing**, if the backend does not need the part replayed: with PR #73, unknown tools are neither rendered nor stored (`ms-chat-widget.js → resolveToolName()` returns `null`). **One array entry** (`SILENT_TOOLS`) if the backend needs the input/output replayed on later turns, because only listed tools are kept by `accumulatePart()`. |
| Frontend cost | None or XS. |
| Rollout | Backend first, switch off → confirm the live build has exact name matching (PR #73 and later; §6.4) → flip the switch. |

Traps:
- **Pre-PR #73 widget** (`44a076b`; it can come back through drift): `isToolPart()` is a **prefix** match over visible **and** silent names, so a name that starts with a visible tool's name (e.g. `show_product_details`) renders as that card, and a name that starts with a silent tool's name (e.g. `search_products_v2`) is stored and replayed as `tool-search_products` with the new tool's input/output (§5 rule 6). And `feedCanonical()` calls `ensureCtx()` before it checks the part, so an unknown tool creates an empty assistant row and removes the "Mo antwortet" indicator until text arrives. That is why `CHAT_ORDER_STATUS_ENABLED` waited for PR #73 (§5 rule 3).
- A turn made only of silent parts is still stored as an assistant message and counts toward the 40-message cap (`03` §6.3).
- Account history transcripts are text-only, so silent parts are not replayed on a resumed thread (`03` §20.10).

### 3.2 New visible tool card

**When:** a new visual element in the conversation (bundle card, size finder, appointment slot, sign-in card for order status).

| Side | Steps |
| --- | --- |
| Backend | Define the tool and its input schema; document it in API_CONTRACT.md §2 "Tools the widget MUST render" (input, render rules, buttons, KPI). If the card shows products, reuse product ids so the widget can hydrate them from `/api/products`. Keep the tool **switched off** until the widget is live, because older widgets render nothing (PR #73) or, in the pre-PR #73 widget, an empty assistant row with no "Mo antwortet" indicator while the turn streams (removed at finalize if no text follows; a name that prefix-matches a known tool renders or replays as that tool, see §3.1 / §5 rule 6). |
| Widget | (1) add the name to `VISIBLE_TOOLS`; (2) add a builder in the "Tool card builders" section that returns `Promise<Element|null>` and resolves `null` on any missing data (render-nothing guard, `02` §4 conventions); (3) add the `case` in `buildToolCard()`; (4) all chrome strings through `L(de, en)`; (5) `track()` calls for each button with ids/enums only; (6) CSS under `.ms-chat-` with theme tokens; (7) if it shows products, call `moAttrOnProductCard()` so the session counts as "consulted" (today only `show_product` does, `05` §10.3); (8) decide what happens on reload: cards are rebuilt from stored history, and form cards come back empty (`03` §12). |
| Frontend cost | **M** (S if it is a variant of an existing card). |
| Rollout | Backend behind switch → widget upload → live check (DE/EN, 1280/390) → switch on. |

Traps: links open in a new tab with `rel="noopener noreferrer"`; cards are keyed by `toolCallId` (changed input re-renders in place); voice mode never reads cards aloud; cards are not restored when a past signed-in thread is opened from the history drawer.

**Data-flow constraints of the render pipeline** (design the tool around them):

1. **A card sees only the tool `input`** (the model's arguments). `buildToolCard(name, input)` has no output parameter. `renderPartIntoCtx()` calls it as soon as `part.input` exists, i.e. on `tool-input-available`, **before** the backend's `execute()` result arrives, and again on reload from stored history (`renderRestoredAssistant()` also passes only the input). The `tool-output-available` case in `startStream()`'s event handler only calls `accumulatePart()` (store and replay, never render); the one exception is `seedConsentCopy()` for `offer_email_summary`. So any server-computed data the card shows must be in `input`, or fetched by the card itself (as the `/api/products` hydration does), or the task must change `renderPartIntoCtx()` / the event handler to re-render on output.
2. **`tool-output-error` does nothing visible.** The handler returns without touching the already-rendered card.
3. **There is no client → model tool-result channel** (no AI-SDK `addToolResult`, no tool-result POST in `ms-chat-widget.js`). Every visible tool must be server-executed. A user choice inside a card (size finder, quiz) can reach Mo only as a **new user turn** via `sendMessage(text, context?)`. That turn fires `message_sent`, can schedule the first-message popup (+700 ms, §3.8) and counts toward the 40-message cap.
4. **`sendMessage()` / `startStream()` have no busy guard.** Every current caller checks `state.streaming || state.rateLocked` itself: `onSend()`, `voiceSubmit()`, `openWithProduct()`, `sendContextGreeting()` and the nudge click handler in `showNudge()` (`startVoice()` is guarded the same way). A card rendered mid-stream is clickable while the turn is still streaming, so a card button that sends must run that check too (pattern: `openWithProduct()`).

### 3.3 New served copy or a new consent surface

**Copy change on an existing surface:** backend-only. Ship a backend deploy with lawyer-approved text. Keep the keys the widget validates (§5.7). `consentTextShown` must still be the exact audit string of what is shown.

**New consent surface** (e.g. an opt-in at a value moment, a WhatsApp consent):

| Side | Steps |
| --- | --- |
| Backend | New `GET /api/consent-copy?surface=<name>&locale=` with `lawyerApproved`, `consentTextShown`, labels, footer, `imprintUrl`, `privacyUrl` per locale (mark English with `enLegalReviewed`). A submit endpoint that requires the echoed `consentTextShown`, records consent, runs DOI where needed, and returns a `marketing` object the widget can classify (`04` §10.6: `already` / `pending` / `other`). Server-side KPI for submits. |
| Widget | Fetch with the 60 s cache pattern (`fetchConsentCopy()` / `fetchSignInConsentCopy()`); a validator that fails closed; render with `textContent` only; nothing pre-selected; decline as large as accept; label and footer fully visible; imprint/privacy links; `marketingConsent: true` only from the accept click; KPI `consent_gate_shown/_accepted/_declined/_dismissed` with a **new `surface` value**; frequency keys (once per tab session in sessionStorage, a decline TTL in localStorage); never in voice mode; must share the one-popup-per-tab-session budget (`ms-chat-gate-shown`) if it is a dialog. |
| Frontend cost | **M–L.** |
| Legal | Lawyer approval before `lawyerApproved: true`. Benefit framing only in served copy (`headline`, `benefits`); no countdowns, fake urgency or discount amounts (CONSENT_CONTRACT.md §1). The widget does **not** read `enLegalReviewed` (no reference in `ms-chat-widget.js`); the backend serves the English copy only once it is approved as the translation (`enLegalReviewed: true`, API_CONTRACT.md §12.3). |

### 3.4 New KPI event or a new field

| Side | Steps |
| --- | --- |
| Backend | `/api/kpi` stores any widget event name — only the server-only names are answered `202` and dropped (`SERVER_ONLY_EVENTS`, API_CONTRACT.md §5) — and does not validate the contents of `data`, so nothing is needed to **store** a new widget event. Limits (`src/app/api/kpi/route.ts`): `event` must be a non-empty string of at most 120 chars (`MAX_EVENT_CHARS`), else 400; `data` must be a JSON object (arrays and primitives are stored as `{}`); the client `timestamp` is kept as `data.clientTimestamp`; the stored session is `body.sessionId` (the widget sets it from `sid`, trimmed to 128 chars), not the `x-ms-session` header, so an event sent after a sid rotation is attributed to the new sid; the origin allowlist (`guardOriginOnly`) and a rate limit (`checkRateLimit('kpi')`) apply. Add the canonical name to API_CONTRACT.md §5. Update the dashboard (`src/lib/kpi-store.ts`, `src/lib/kpi-widget-events.mjs`, `src/lib/kpi-event-patterns.mjs`) and the AD doc. If it replaces an old event, mark the old one as discontinued (like `starter_*` in `DISCONTINUED_WIDGET_EVENTS`). |
| Widget | One `track(name, data)` call at the right place; `sessionId` and timestamp are added automatically. `track()` already uses `fetch(…, {keepalive:true})` synchronously, so call it before any navigation; delivery of a preflighted keepalive request during unload is not verified on all browsers (`05` §14.2). For "once" semantics, add a sessionStorage flag (per tab) or a localStorage flag (per device). |
| Frontend cost | **S.** Adding a field to an existing event is backward compatible. |

Rules (the contract: API_CONTRACT.md §0 rules 13–15):
- **Ids and enums only.** No text, emails, product names, tokens, codes or raw URLs (a URL can carry query PII).
- **Name it against the dashboard patterns**: `%cart%` / `%checkout%` count as add-to-cart clicks; `%product%click%` / `%cta%click%` as product clicks (`05` §12). A `cart_refreshed` event would inflate "Add-to-Cart-Klicks".
- **Never reuse a server-only name** (API_CONTRACT.md §5; `/api/kpi` would drop it).
- **Send an event before a sid rotation**, not after, if it describes the old session (pattern of `account_signout`).
- **Interaction-free events** (widget load, impressions without a click) need a legal decision first or a gate on `window.Shopify.customerPrivacy.analyticsProcessingAllowed()` (`05` §13.3).
- Pick the id space deliberately. Today `product_cta_opened` uses the numeric Shopify id and everything else the catalog handle (`05` §4.4).

### 3.5 New deep-link parameter

| Side | Steps |
| --- | --- |
| Backend | Build the URL (campaign mails go through `GET /api/r/<token>` → `CAMPAIGN_MO_DEEPLINK_URL` + `mo_c`, API_CONTRACT.md §11.2). Existing params can be combined freely on any storefront path (`01` §15). |
| Widget | Pick the reader by the parameter's kind. **An open/view modifier that only applies together with `mo=open`** goes into `handleMoDeepLink()` (runs **last** in `init()`, so the widget is fully built; it returns early unless `mo=open` or the `#mo-open` hash is present). **A parameter that must work on its own, or that is secret or per person**, needs its own reader at the **top** of `init()`, next to `captureCampaignToken()` / `readAuthReturn()`: read `earlyParam()` first and the URL as fallback, then strip it with `replaceState`. Validate with a strict regex. Choose storage scope deliberately (in memory, sessionStorage, never localStorage for per-person tokens). |
| Theme | **Only if the value is secret or per person:** add it to the list in the `layout/theme.liquid` head stash script (`['ms_auth','ms_code','mo_c']`) and read it via `earlyParam()`, so Shopify analytics never records it. `layout/theme.liquid` is a shared file: the task must give the exact hand-edit. |
| Frontend cost | **S** (+ a shared-file edit if secret). |

**Template for a landing value that must reach `/api/chat`** (the `mo_c` pattern): capture it in `init()` **before** `readAuthReturn()` (like `captureCampaignToken()`), validate it with a strict regex, keep it in sessionStorage, add it to `chatBody` in `startStream()`, and delete it only on `res.ok` (so a failed first send retries). It then rides on the first `POST /api/chat` of the tab session, whether that is a typed message, a CTA primer or a nudge greeting.

Traps:
- Modifiers are read only when `mo=open` / `#mo-open` is present. Without it, `handleMoDeepLink()` returns before its strip, so `mo_new` / `mo_view` stay in the URL untouched and are not applied.
- The head stash (`sessionStorage['ms-chat-early-params']`) is **one object per page load**: the head script writes it only when one of its params is present, and a later stash overwrites an earlier unconsumed one. `earlyParam()` consumes the whole stash on first read (deletes the key, keeps it in memory for that page) and honours it only while it is younger than `LINK_RETRY_MAX_MS` (10 min, the sign-in code TTL). Any new secret parameter inherits that TTL.
- Backend side: the deep link itself is `CAMPAIGN_MO_DEEPLINK_URL` (backend `docs/CAMPAIGNS.md`; default `…/?mo=open&mo_new=1&mo_view=fullscreen&utm_source=campaign&utm_medium=email` in `src/lib/campaign-flags.mjs`). Changing the `mo_new=1` default changes session semantics (a fresh thread, and a sid rotation for anonymous visitors, `05` §9).
- `mo=open` alone sends no chat turn (`POST /api/chat`) and does not prime a product. The open itself still makes requests: `openPanel()` fires `chat_opened` (`POST /api/kpi`) and runs the first-open auth detection (`resolveAuthOnOpen()` → `detectSignedIn()`: whoami once per tab session, and possibly `GET /api/auth/me`). With `mo_new=1`, a visitor with no signed-in hint gets a new sid (`rotateSession()`) before the open; a "campaign-aware greeting" means the deep link starts a turn, which changes what `campaign_chat_started` means (`05` §13.4). The head script runs on every page while `ai_advisor_enabled` is on, including pages where the widget does not mount (`02` §21.2).

### 3.6 New product-page or storefront placement

**Product-primed entry point (no JS change):** any element with the CTA contract works on any page because the click handler is delegated (`06` §3.2):

```html
<button type="button" class="ms-chat-product-cta"
        data-ms-chat-product-id="{{ product.id }}"
        data-ms-chat-product-title="{{ product.title | escape }}">…</button>
```

It opens the panel, fires `product_cta_opened {productId: <numeric>}`, and sends the primer message with `context.type: "product"`. Placement in templates/sections is mostly **live-editor owned**: the owner or the live editor adds it, and the repo must be re-synced afterwards.

**Generic entry point** ("Frag Mo" without a product, or with a topic): needs a new public API, e.g. `window.MS_CHAT.open({source, topic})`, because today only `openWithProduct()` and `openEmailSummary()` exist (`06` §3.2). **Widget S–M** plus the placement.

| Concern | Rule |
| --- | --- |
| Dead CTA | CTA blocks are gated only by `settings.ai_advisor_enabled`. `snippets/ms-chat-widget.liquid` outputs `<style>.ms-chat-product-advisor, .ms-chat-product-cta { display: none !important; }</style>` wherever it does not render the widget (excluded template, cart/checkout, empty `settings.ms_chat_shared_secret`), so any placement that uses `.ms-chat-product-cta` (or sits in a `.ms-chat-product-advisor` wrapper) is hidden there automatically. That style is only emitted while `ai_advisor_enabled` is on, so a new placement must still be gated on `ai_advisor_enabled` itself. **Still open:** if `ms-chat-widget.js` fails to load, or the visitor clicks before the deferred JS has booted, the button does nothing (fix: the widget adds a class on `<html>` at `init()` and the CTA is shown only under it — a widget change). |
| Measurement | `chat_opened` has no source. Ask for a `source` on the new entry point (backlog B1). |
| Language | Template literals are German on `/en`; use a locale key (`| t`) if the placement must be bilingual. |
| Coverage | All five product templates carry the CTA, and `product.produkte-im-set` has no Q&A tab: `01` §6.6 (owner); placement in each template: `06` §3.1. |

### 3.7 New account / self-service feature (signed-in)

| Side | Steps |
| --- | --- |
| Backend | A guarded endpoint under `/api/account/*` behind the signed-in resolver; **401 means "this session is not signed in any more"**, and the widget reacts with a full cleanup (`accountUnauthorized()` → `endedSignInCleanup()` → history wipe, new sid). Use other codes for business errors. Legal text (anything like the erase confirmation) comes from `GET /api/consent-copy?surface=<name>` with no fallback in the widget. Server-side KPI for the effect (like `account_export_requested`). If the feature needs the chat sign-in specifically (not whoami), answer with a clear status (like `sign_in_required`) and keep „Mit Kundenkonto anmelden“ reachable (ACCOUNT_CONTRACT.md §3a). |
| Widget | `accountHeaders()`; the stale-reply guard `accountReplyStale(reqSid)` on every response; 401 → `accountUnauthorized()`; UI in the history drawer (`buildHistoryDrawer()` footer) or a header pill; chrome via `ACCOUNT_COPY` with EN overlay; KPI pair `<thing>_started` / `<thing>_done`-style like `account_export_started` / `account_exported`. |
| Frontend cost | **M.** |

Traps: signed-in data is meaningful only from 2026-10-04 (no chat sign-in could complete between 2026-10-03 and that day's upload; AD §5.0 release notes); sign-out is local only (the old sid stays linked server-side, `04` §7.8); conversation transcripts are text-only.

### 3.8 New popup, nudge rule or proactive prompt

The backend cannot trigger a popup today: there is no SSE chunk or response field for it. Options:

1. **Change the rules in the widget** (timing, eligibility, copy) — a widget change in `maybeShowConsentGate()`, `gateBaseEligible()`, `initNudgeTriggers()`, `nudgeCopy()`. **S–M.**
2. **Let the model ask via a visible tool** (e.g. a sign-in card when order status needs it) — pattern §3.2.
3. **Server-driven decision** (a new field on `/api/auth/me` or in a tool output that the widget reads) — contract change + widget change. **M.**

Constraints that must survive any change (`04` §9–§10, `05` §6–§7):

| Rule | Today |
| --- | --- |
| At most one popup per tab session (login **or** consent). It is evaluated 0.7 s after **every** send (typed, `voiceSubmit()`, `openWithProduct()` CTA primer) until one is shown, so it is not limited to the first message. A later message can trigger it when the first send was rolled back or rate-locked, the visitor was in voice mode, auth was still unsettled after the poll, or the visitor signed in later in the tab session | `sessionStorage['ms-chat-gate-shown']` (`GATE_SS_KEY`), set only when a popup is shown; `sendMessage()` schedules `maybeShowConsentGate(0, userMsg)` on each call |
| Never stacked, never in voice mode, never after a failed send | `gateEl`, `voiceMode`, rollback check |
| Never while rate-locked; shown 0.7 s after the send; waits up to ~5 s for the auth tier | `maybeShowConsentGate()`: returns on `state.rateLocked`; scheduled by `sendMessage()` with `setTimeout(…, 700)`; polls 10 × 500 ms while `!auth.settled` |
| Consent popup suppressed while, or after, the inline opt-in card asked in this tab session | `consentGateEligible()`: false while the `.ms-chat-optin-card` in `lastOptInRow` is pending, and once `sessionStorage['ms-chat-optin-ask-shown']` is set |
| „Später“ snooze for the login popup | 24 h, device-wide |
| Consent decline memory | 30 days, device-wide (not per customer); the backend adds a per-customer anti-nag — a decline in any of the customer's sessions within 30 days, or 3 shown sessions, makes `optInActionable` false (ACCOUNT_CONTRACT.md §6.1) |
| Nudge | once per tab session (`ms-chat-nudge-shown`); not if the chat was opened this tab session (`ms-chat-opened`); permanent × (`ms-chat-nudge-dismissed`); hidden under `body.no-scroll`; never auto-hides; never asks for an email |
| Nudge triggers | `initNudgeTriggers()`, first one wins: dwell `NUDGE_DWELL_MS` = 24 s (product and collection pages only), scroll ≥ 85 % of the page (product pages only), exit intent (desktop only) |
| Tone rule | reference the page or category, never the visitor's behaviour |
| Only while the panel is open | `maybeShowConsentGate()` returns at once on `!state.open` and re-checks `consentGateEligible() && state.open` after the async copy fetch |
| Consent popup is fail-closed | shown only if `fetchSignInConsentCopy()` returns served `surface=signin` copy with `lawyerApproved === true`; otherwise nothing is shown |
| „Anmelden“ in the login popup during streaming | waits for the reply to finish (`WAIT_STEP_MS` 200 ms, `WAIT_MAX_MS` 20 s) and then calls `initiateLogin('login_gate')`, so the answer is saved to history before the redirect |
| Esc / backdrop | `login_gate_dismissed` / `consent_gate_dismissed`; quiet for this tab session only, no device snooze |

### 3.9 New page facts for Mo

`snippets/ms-chat-widget.liquid → pageContext` (theme change) + `ms-chat-widget.js → PAGE_CTX` + the place where it is sent (today only in CTA/nudge `context`, `03` §4). Page facts only, never user data. A Liquid `{% if customer %}` flag would be a client-side hint, not an identity. The App Proxy is the secure path (P0.3). Selected variant changes after load need a listener (`variant:change` from `main.mjs`) — widget work. **S–M.**

---

## 4. How to write a frontend task

### 4.1 What worked in `FRONTEND_PROMPT_2026-10.md`

The October prompt (archived: `docs/archive/frontend-handoff/FRONTEND_PROMPT_2026-10.md`) produced PR #73 in one pass. The current tasks in `docs/frontend/tasks/` follow the template of §4.3. Keep these properties:

1. **Self-contained and paste-ready.** It says "paste this into the frontend agent" and lists the contract files to attach. The frontend agent never needs the backend repo.
2. **Precedence is explicit:** "Where this prompt and those files disagree, the files win."
3. **States the baseline:** which widget version it builds on (2026-10-01) and what that version already does, so the agent does not redo or undo work.
4. **Answers the frontend's open questions** first ("Backend reply to your note"): KPI names confirmed, dashboard changes, which old endpoints are now unused and must not come back.
5. **Restates the legal rules verbatim** ("Rules that do not change").
6. **Numbered tasks in priority order**, the blocking one marked "required — do it first", each with the reason, exact request/response shapes by contract section, a response-code → behaviour mapping (200 / 400 / 503), the exact KPI semantics ("`ok` only after the 200"), storage scope ("sessionStorage, never localStorage, cookies or KPI payloads") and what is broken until it ships.
7. **An acceptance checklist of observable behaviour**: the address bar, a second redeem answering 400, a test sign-in visible in each stage of the admin dashboard, DE + EN screenshots of every new surface.

### 4.2 What to add next time (lessons from documenting the result)

- **Name the widget functions and storage keys** from these chapters (e.g. "`buildAddToCart()` click handler", "`sessionStorage['ms-chat-gate-shown']`"), so the change lands in the right place.
- **Say which files to upload and which shared files need a hand-edit** (MANIFEST entry), and whether a backend switch must wait for the upload.
- **State the failure mode** of every new call (fail-silent vs visible, fail-closed for identity and legal).
- **State the legal status** of every served string the task renders (`lawyerApproved`, `enLegalReviewed`).
- **Ask for the KPI naming check** against the dashboard patterns and the server-only list.
- **Ask for harness coverage** (§6) and list the mock behaviour the backend now has (new endpoint, new codes).
- **Include edge cases the chapters found**: reload behaviour of cards, signed-in vs anonymous branches, streaming in progress, multi-tab sid rotation.

### 4.3 Template

Copy this skeleton, fill every section, and delete nothing (write "none" where it does not apply).

```markdown
# Frontend task — <short name> (<date>)

Paste into the frontend agent that owns `ms_shopify_clone`. Attach: <the contract files the task needs: docs/frontend/API_CONTRACT.md, ACCOUNT_CONTRACT.md, CONSENT_CONTRACT.md>.
Where this prompt and the attached files disagree, the files win.

## Baseline
Builds on widget <commit / MANIFEST date>. Relevant current behaviour: <1–3 sentences, cite docs/frontend chapter §>.

## Goal and KPI
<What changes for the shopper. Which KPI it should move and how we will read it on the dashboard.>

## Contract references
<API_CONTRACT §n / ACCOUNT_CONTRACT §n / CONSENT_CONTRACT §n … for every endpoint, field and event used.>

## Backend state
<What is already deployed; switch names and their default in code (production state: docs/ROLLOUT_TODO.md); what stays off until this ships; "no-op if the widget ships later" statement.>

## Rules that do not change
<Point to API_CONTRACT §0 (and CONSENT_CONTRACT §1 for consent); restate only the rules this task touches.>

## Tasks (in order)
### 1. <name> (required / optional)
- Where: `ms-chat-widget.js → <function>` (and CSS / snippet / shared file with the exact hand-edit spot).
- Trigger and timing: <…>
- Request: <method, path, headers, exact JSON body>; Response: <shape>.
- Response handling: | status | widget behaviour | KPI |
- UI strings: DE „…“ / EN "…" (chrome only; served text comes from <endpoint>).
- Storage: <key, store, lifetime, cleared by>.
- KPI: <event name, exact data keys, when; confirm no dashboard-pattern collision; never the server-only names>.
- Failure mode: <fail-silent / fail-closed / visible notice>.
- Edge cases: <reload, signed-in vs anonymous, streaming in progress, other tab, voice mode, /en>.

## Legal constraints
<Served-copy rules, lawyerApproved / enLegalReviewed status, consent gating, data that must not leave the browser.>

## Deployment
Files to upload: <list>. Shared files to hand-edit in the live editor: <file + spot>. MANIFEST entry required.
Switches to flip after the live check: <name>.

## Acceptance checklist
- [ ] <observable behaviour, incl. network calls and their headers>
- [ ] <KPI events seen in the admin dashboard with the same session id>
- [ ] <negative cases: errors, consent denied, signed-out, older backend>
- [ ] Harness: new checks added and passing in DE + EN, 1280 + 390.
- [ ] No console errors; no new hard-coded legal text; no pre-selection; no server-only events.
- [ ] Screenshots DE + EN (desktop 1280, mobile 390) of every new or changed surface.
```

---

## 5. Contract-change rules

The widget-facing side of these rules is API_CONTRACT.md §0 (rules 3, 4, 10, 16, 24); this section adds what they mean for backend work.

1. **Additive only.** Never rename or remove an endpoint, field, enum value, error code or KPI name that the live widget uses. Add optional fields. The widget already tolerates additions:

   | Where | Tolerance in the widget |
   | --- | --- |
   | `/api/products` items | unknown fields ignored (`03` §7) |
   | SSE chunks | unknown chunk types ignored, `console.debug` with the type only; `data-*` and `reasoning*` ignored (`03` §5.2) |
   | Tool parts | unknown tools render nothing (PR #73; pre-PR #73 see §3.1) |
   | `/api/auth/me` | only `signedIn`, `identity.name`, `identity.tier`, `marketing` read (`04` §2.2) |
   | Consent copy | extra keys ignored; required keys see rule 7 |
   | `/api/kpi` | response never read |
   | `cartAttributes` | passed through unchanged; must stay a flat object |

2. **Design for the oldest live widget.** There is no widget version header (§1), the upload lag is unknown, and the live theme can regress through drift. Until a backend change has been verified on the live widget, the old widget must keep working. If you need to know the version, ask for a small frontend task that sends one — not as a new request header, because the CORS allow-list is exactly `Content-Type, x-ms-chat-key, x-ms-session, x-ms-locale` (API_CONTRACT.md §0 rule 4, `src/lib/security.ts`): a header needs the backend to extend the allow-list first, a body or query field does not. A recommendation, not an existing contract (backlog E6).

3. **Feature switches, default off.** Rollout order:
   1. Backend ships the change behind a switch, and the contract file in `docs/frontend/` (API_CONTRACT, ACCOUNT_CONTRACT or CONSENT_CONTRACT) is updated in the same PR.
   2. Frontend task (§4) → widget PR → harness green.
   3. Merge, MANIFEST entry, owner upload, drift check.
   4. Live verification (§6.3).
   5. Flip the switch. Watch the dashboard.
   6. Only then remove compatibility code.

   `CHAT_ORDER_STATUS_ENABLED` is the model: default off in code, to be switched on only after a widget that renders nothing for `get_order_status` (PR #73) was verified live (§6.3 "Tools"). Its production state: `docs/ROLLOUT_TODO.md` 6.6.

4. **"No-op if the widget ships later."** Every new request field is optional on the backend; every new response field is optional for the widget; an unknown/invalid value is ignored without an error (like `campaignToken`, API_CONTRACT.md §2). Write that sentence into the contract section.

5. **Error codes are mapped coarsely.** `/api/chat`: 429 → input locked for `Retry-After` (default 30 s); 401/403 → „Chat ist gerade nicht verfügbar.“; `payload_too_large` → „Neuen Chat starten“ notice; ≥ 500, `internal_error`, `upstream_unavailable` → „Es gab ein Problem…“; **any other 4xx → „Chat ist gerade nicht verfügbar.“** (`03` §11). A new 4xx code therefore looks like an outage to the shopper. **An SSE `error` chunk after a 200 is not rolled back** (`startStream()` sets `streamErrored`; `finalizeStream()`): partial content is kept with „Es gab ein Problem. Bitte versuch es gleich nochmal.“ appended, and with no content the user message stays in history without an assistant reply, so the next turn sends two consecutive user messages (`03` §20 item 7). The backend must accept that; prefer an HTTP error status before streaming starts when the turn should be retried cleanly. On `/api/account/*`, **401 triggers a full sign-out cleanup** — never use 401 for business errors. On `GET /api/auth/me`, `probeAuth()` treats any non-ok status other than 429/≥ 500 (401, 403, 404, …) and a 200 with `signedIn:false` as a definite "not signed in". On a device that was signed in (`wasSignedIn`), that triggers the same full cleanup (`endedSignInCleanup()`: history wipe, new sid). Use 429/5xx only for temporary failures there. On `/api/auth/link`, 4xx = refused (never retried), 503/5xx/429/network = one retry next page load (`04` §4.5).

6. **Tool naming.** A new tool name must not start with an existing visible tool name (`show_product`, `compare_products`, `add_to_cart`, `suggest_showroom`, `show_contact_form`, `offer_email_summary`) **or silent tool name** (`update_customer_profile`, `search_products`), because the pre-PR #73 widget (`44a076b`; drift can bring it back, so keep the rule) prefix-matches over both lists (`isToolPart()` / `resolveToolName()` over `ALL_TOOLS`). A prefix match on a visible name renders that card. A prefix match on a silent name is stored by `accumulatePart()` under the **resolved** old name (`tool-search_products`) with the new tool's input/output and replayed that way on later turns (a wrong tool_use for the model). Silent tool outputs are replayed from the browser: assume the browser stores them, and add untrusted ones to `NON_REPLAYABLE_OUTPUT_TOOLS` (`src/lib/chat-message-sanitize.mjs → sanitizeToolParts`).

7. **Served-copy shape is a contract.** The widget's validators require: capture form `transactionalLabel`, `marketingLabel`, `consentTextShown`; signin surface `marketingLabel`, `consentTextShown` and `lawyerApproved === true`; erase `confirmHeading`, `confirmBody`, `confirmButton` (`04` §10.1, §7.7). Removing a key **switches the surface off** (fail closed). Copy changes go live with the backend deploy, so legal sign-off comes first.

8. **Shared limits move together** (API_CONTRACT.md §0 rule 24). Today: 40 messages. The send path does not trim (`toWire()`), but storage keeps the last 40 (`loadHistory()` / `saveHistory()` `slice(-40)`) and so does `openConversation()` (`transcriptToMessages(conv).slice(-40)`). A reloaded or resumed 40-message thread therefore fails with `payload_too_large` on its next send (backlog A4 must cover resumed threads too). The other shared limits: 10 ids per `/api/products` request (the `add_to_cart` path does not chunk), 20 Q&A entries, trail 3 + 2, campaign token regex, 10-minute code TTL, the TTS sentence splitter mirrored in `splitIntoTtsChunks()`.

9. **Do not change session semantics.** The sid is the KPI join key, the rate-limit key and the identity link. Server-side changes to what a session means (expiry, linking, rotation) must be checked against `02` §7 and `05` §3.

10. **Security changes that cannot be additive** (like the one-time code of 2026-10-03) break the live widget until the upload. If at all possible, accept old and new behaviour for a transition window; if not, write down what is broken on live and give the owner the upload list on the same day. The 2026-10-03 change left live sign-in broken until PR #73 was uploaded on 2026-10-04.

---

## 6. Testing: the widget harness and live checks

### 6.1 The harness used for PR #73 and `44a076b`

Facts from the commit message of `44a076b` ("Verified in headless Chromium against the real theme main.mjs: widget suite 40/40, cart drawer suite 26/26") and from the PR #73 session's harness logs:

| Aspect | What it is |
| --- | --- |
| Runner | Playwright, headless Chromium, Node scripts. |
| Backend | A **contract-faithful, stateful mock** of `https://mo.motionsports.de` and the storefront origin `https://www.motionsports.de`, built only from the contract docs of that time (the former frontend-handoff files plus the API contract; today `docs/frontend/API_CONTRACT.md`, `ACCOUNT_CONTRACT.md`, `CONSENT_CONTRACT.md`). It keeps state per test context: one-time codes (10-minute TTL, single use, bound to the minting session, kind `customer_account` / shop), sign-in state, marketing state, conversations; serves the served-copy strings in DE and EN; streams SSE with the AI SDK v5 chunk vocabulary and the `x-vercel-ai-ui-message-stream: v1` header; answers CORS preflights; and can return Shopify's HTML 404 page, a network error, 4xx/5xx/429 on demand. |
| Page | A minimal storefront page that loads the **current** `assets/ms-chat-widget.js` / `.css` from the repo at run time (env overrides allow a negative control with an older file), optionally with the theme head script. The cart-drawer suite loads the **real** `assets/main.mjs`, `vendor.mjs`, `main.css` and header/cart-modal markup. |
| Matrix | DE and EN; desktop 1280 px and mobile 390 px. |
| Observed | Every request (path, method, headers, body), every KPI payload, `localStorage` / `sessionStorage`, the address bar, DOM state, console errors and page errors; screenshots. |
| PR #73 run | **242 checks, 0 failed** (~7.5 min). Groups: sign-in from popup / welcome / header (48 + 8), code misuse (6), consent popup and inline card after sign-in (69), capture form (23), erase incl. a 401 answer (30), campaign token (6), whoami incl. 404 page / `signedIn:false` / network error / 503 retry (20), `get_order_status` + unknown tool + logout wipe + sign-out mid-reply (10), cross-cutting invariants (7), screenshots (1), regressions for the 2026-10-03 verification findings (14). |
| Cross-cutting invariants checked | every backend call carries `x-ms-session`; guarded calls also `x-ms-chat-key`; every locale-bearing call on `/en` carries `locale=en`; no `starter_*` events; no anonymous e-mail gate (`surface=chat`, `/api/chat-marketing-opt-in`); **no server-only KPI events**; whoami answer never forwarded; order data never in console, KPI or other calls; no console or page errors; no unmocked requests. |

**Limits you must know:**
- The harness is **not committed** to either repo. It lives in a session scratchpad and can be lost. A future frontend task should ask for it to be committed, e.g. as a `tests/` folder in the theme repo. That is safe because deployment is a manual copy of the files MANIFEST lists, and MANIFEST would never list it.
- The mock is built **from the docs**, not from the backend code. If the backend deviates from its own contract, the harness will not notice. Keeping the contract files in `docs/frontend/` accurate is what keeps the tests meaningful.
- Not exercised: real Liquid rendering, Shopify cart permalinks and checkout, the real Customer Privacy API and cookie banner, the real App Proxy, real Shopify login, iOS Safari / real devices, `keepalive` delivery during navigation, storefront caching of metafields.

### 6.2 What a backend change should ask the harness to cover

- The new request/response shapes, including every documented status code and a network error.
- The "older backend" case: the widget with the new code against a mock without the new field or endpoint (must behave as today).
- KPI payloads: exact names and `data` keys, same `sessionId` as `x-ms-session`, nothing server-only.
- DE + EN, 1280 + 390, screenshots of new surfaces.

### 6.3 Manual live checks after an upload

`MANIFEST.md` carries a test checklist per session. The checks that matter for backend agents:

| Area | Check |
| --- | --- |
| Footprint | `npm run verify:widget` reports an acceptable build (§6.4) and finds the head script, the `/cart` CTA-hiding `<style>` from `snippets/ms-chat-widget.liquid` and the App Proxy answer; `layout/theme.liquid` has the render call; `#CartBubble` exists exactly once; the "MO only" block is enabled on all five product templates (`01` §16.3 step 4). |
| Sign-in | „Anmelden“ → Shopify → back: address bar has no `ms_auth` / `ms_code`; `POST /api/auth/link` before `/api/auth/me`; dashboard „Anmelde-Popup“ shows the test session in every stage (AD §5.7a). |
| Consent | The consent popup appears only for `optInActionable: true`; an already-subscribed address shows the „bereits angemeldet“ state. |
| Campaign | `/?mo=open&mo_c=<token>` opens the chat and sends **no chat request** (`POST /api/chat`) and no `campaignToken` until the first turn. `handleMoDeepLink()` itself makes no request, but the `openPanel()` it calls fires `chat_opened` (`POST /api/kpi`) and the first-open auth detection (whoami, possibly `GET /api/auth/me`). With `mo_new=1`, a visitor with no signed-in hint gets a new sid first (`rotateSession()`). The first `POST /api/chat` of that tab session (a typed message, CTA primer or nudge greeting) carries `campaignToken`; later turns do not (`startStream()` deletes `sessionStorage['ms_mo_c']` on `res.ok`). `campaign_chat_started` is server-emitted with session `NULL`, once per campaign send (API_CONTRACT.md §5), so look for it in the Kampagnen-Funnel, not under the test session. |
| Attribution | With analytics consent: a `show_product` card → `/cart.js` shows the `_mo` attribute. **One test order through "Zur Kasse"** to see whether `note_attributes` carries `_mo` (open question `05` §14.1). |
| Tools | With order status on for a test account (`CHAT_ORDER_STATUS_TEST_CUSTOMERS`): `get_order_status` renders nothing and Mo answers in text. This is the gate for switching `CHAT_ORDER_STATUS_ENABLED` on (§5 rule 3). |
| Contact form | The `POST /api/contact` body carries `sessionId` (same value as `x-ms-session`), the `contact_form_submitted` row has that session, and a `show_contact_form` with reason `order_support` shows „Kontakt zum motion sports Team“ and the placeholder „Bestellnummer + kurz dein Anliegen…“. |
| `/en` | Locale on calls; English served copy; German voice (known). |
| Theme | Add to cart from the PDP opens the drawer; the launcher hides while the drawer is open; the docked sidebar drops below the drawer. |

### 6.4 Which widget build is live?

`npm run verify:widget` (`scripts/check-live-widget.mjs` over `src/lib/widget-fingerprint.mjs`) does this check: it fetches the storefront, finds the asset, counts the markers and classifies the build, and also checks the head script, the `/cart` CTA-hiding style and the App Proxy answer. Shopify may serve ES5 theme JS **minified** (comments and whitespace gone, local function names possibly mangled), so the classifier counts string literals that survive minification — storage keys, endpoints, event names, UI text (`WIDGET_MARKERS`), counted whitespace-insensitively and checked against the theme commits raw and after terser. Only `8d0a0c4` → `3e87341` differ by code alone (two added `endSpeaking()` calls: 10 instead of 8), told apart only while names are unmangled.

`ms-chat-widget.js` has no version constant or version header (§1, §5 rule 2). To check by hand, search the **live** asset: view-source of any storefront page → the `ms-chat-widget.js` URL that `snippets/ms-chat-widget.liquid` emits via `asset_url` → count the markers below. The table restates `classifyWidgetBuild()` (`WIDGET_BUILDS`), newest rule first; the code is the source. "PR #73 markers" = `/api/auth/link` and `ms_mo_c`; "`8d0a0c4` markers" = `order_support` and `Bestellnummer + kurz`.

| Markers in the live JS | Build (`WIDGET_BUILDS` key) | Consequence |
| --- | --- | --- |
| PR #73 and `8d0a0c4` markers, `ms-chat-ctx-last` and `ms-chat-optin-benefits` present, `Rabattaktionen zuerst erfahren` absent | the build with the tasks of 2026-10-05 (`tasks-2026-10-05`) — the **expected next** upload | Served consent bullets, page context on typed product-page questions, token renewal. `CHAT_PAGE_CONTEXT_ENABLED` may be switched on after 2–3 days of observation. Only one of the two new markers, or the old bullet still present: unknown (half-applied). |
| PR #73 and `8d0a0c4` markers, `endSpeaking(` 10 or more | `main` `3e87341` (`main-2026-10-04`) — the build these chapters describe; `current` | One-time code, shop recognition, `mo_c`, contact form with session, `order_support` label, stream and audio stop on a new chat. Order status and the App Proxy may be switched on with it. |
| PR #73 and `8d0a0c4` markers, `endSpeaking(` absent (names mangled) | `8d0a0c4` or `3e87341`, minified (`fixes-minified`); `current` | As above; whether the audio stop of `3e87341` is in it cannot be told from the minified file — check in a browser. |
| PR #73 and `8d0a0c4` markers, `endSpeaking(` 1–9 | `8d0a0c4` (`fixes-8d0a0c4`) | As `main`, but the voice audio does not stop at once on „Neuer Chat“ — upload `3e87341`. |
| PR #73 markers, both `8d0a0c4` markers absent | PR #73 `a0df103` (`pr73`) | Sign-in, `mo_c` and App Proxy redeem work; no contact-form `sessionId` in the body (the backend falls back to `x-ms-session`), no `order_support` label, no stream cancel on a new chat — upload the `8d0a0c4` files. |
| `ms-chat-login-gate-snooze` present, no PR #73 marker | popup build 2026-10-01 (`4dbc625` / `44a076b`, `popup-2026-10-01`) | Must not be live: chat sign-in cannot complete (no one-time code), `mo_c` ignored, whoami answer applied without redeem — the App Proxy must stay off (`04` §5.4). |
| `ms-mo-attr` and `ms-chat-mkt-decision` present, no snooze key | 2026-10-01 restore (`beff918`, `restore-2026-10-01`) | No sign-in popup, no one-time code: chat sign-in impossible. |
| `ms-mo-attr` and `starter_shown` present, no `ms-chat-mkt-decision` | 2026-08-12 attribution build on the drifted base (`e4b12f1`, `drift-2026-08-12`) | The drift case: starters back, no `?mo=open`, PR #67 consent gate missing. |
| `ms-mo-attr` and `/api/attribution/token` absent | older than 2026-08-12 (`pre-2026-08-12`) | No `_mo` cart stamp. |
| `/api/chat` absent | not the widget (an error page) | — |
| any other mix (e.g. half the PR #73 or `8d0a0c4` strings) | unknown | A mixed or half-applied upload. |

`verify:widget` exits 0 only for one of the first five rows (`acceptable`: the order status and the App Proxy may be on with it) together with the head script and the `/cart` style, and never while the App Proxy answers a build that cannot redeem the code; an App Proxy that is not set up is not a failure.

Also check that the live `layout/theme.liquid` contains the `ms-chat-early-params` head script (PR #73; absent in `44a076b`), and compare the CSS too: JS and CSS must come from the same build (after the Aug 12 drift, live ran PR #67's CSS with old JS, `01` §16.3).

**Propagation:** Shopify's `asset_url` carries a version query that changes when the file is replaced (Shopify behaviour, not visible in the repo), so new page loads get the new file right after the upload. Tabs that are already open keep the old JS until they reload. Flip backend switches only after this live check, never at upload time. The durable fix is backlog E6 (a version signal).

---

## 7. Prioritised opportunity backlog

Consolidated from `05` §13.4, `03` §20, `04` §17–§18, `06` §16 and `02` §21; this is the one widget backlog. Priority reflects KPI impact per effort and whether an item blocks others. **Backend built** marks items whose backend part is deployed and that wait only for a widget task or an ops step; finished items are listed under "Done" at the end. Production status of every switch: `docs/ROLLOUT_TODO.md`. "KPI" uses the owner's goals: **opt-ins, sign-ins, product clicks, add-to-cart / checkout, attributed revenue, campaign chats**, plus measurement quality.

### P0 — unblock and verify (do first)

P0.1 and P0.3–P0.7 are closed (list „Done“ at the end of this section; production state: `docs/ROLLOUT_TODO.md`).

| # | Item | KPI | Backend work | Frontend work | Effort | Legal / notes | Refs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P0.2 | **Test order through "Zur Kasse"** to see whether the permalink checkout keeps `_mo` | attributed revenue (decides A2) | Inspect `note_attributes` on the order; webhook tier | none | Ops S | `docs/ROLLOUT_TODO.md` open list (P0.2) | `05` §14.1, `06` §17.1 |

### P1 — high impact, small effort

| # | Item | KPI | Backend work | Frontend work | Effort | Legal / notes | Refs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | Mark the session "consulted" on `compare_products`, `add_to_cart` and `suggest_showroom` renders, not only `show_product` | attributed revenue | none | call `moAttrOnProductCard()` in `buildCompare()`, `buildAddToCart()`, `buildShowroom()` | S | Consent-gated as today. `add_to_cart` already mints and stamps on the „Zur Kasse“ click (`buildAddToCart()` click handler → `moAttrEnsure(false)`: `POST /api/attribution/token` if no token, then `/cart/update.js` with keepalive), but asynchronously, so it races the permalink tab, and it does not set `moAttrConsulted`. Minting at render removes the race; `compare_products` and `suggest_showroom` have no mint at all | `06` T2 |
| A2 | Carry `_mo` on the „Zur Kasse“ permalink: mint eagerly when the add-to-cart card renders; on click append `attributes[<key>]=<value>` (from `cartAttributes`) and `ref=mo` | attributed revenue | Confirm the webhook reads permalink attributes (mirror of `withCartAttribution()`) | `buildAddToCart()` | S (widget) | Same consent gate as the stamp. Do after P0.2 confirms the gap | `06` T1, `05` §13.4 |
| A3 | Attach PDP page context to the **first** typed message of a fresh conversation (and when the page changed) — **backend built** (`context.source`, softer page note, `CHAT_PAGE_CONTEXT_ENABLED` default off in code, holdout `CHAT_PAGE_CONTEXT_HOLDOUT_PCT` default 0, `page_context_applied/_answered`, AD §5.1a, `verify:live` §9); **remaining:** frontend task 2 (`source:"page"`, `source` on CTA/nudge, `samePage`), upload, then the switch after 2–3 days (`docs/ROLLOUT_TODO.md` open list, „Page context on“) | product clicks, answer quality | done (API_CONTRACT.md §2 „Optional `context`“) | `sendMessage()` / `startStream()` (`pageContextForSend()`, `ms-chat-ctx-last`) | S | Page facts only; trail rules unchanged; holdout only after pre-registration (`PAGE_CONTEXT_EXPERIMENT`) | `03` §20, `06` T3, [`2-page-context.md`](tasks/2-page-context.md) |
| A4 | Remove the 40-message wall | messages per chat, checkout reach in long consultations | Either accept > 40 and window server-side, or define a windowing rule that keeps `update_customer_profile` replays | Or trim to a window in `toWire()` | M | Storage and `openConversation()` already keep the last 40, so a reloaded or resumed 40-message thread fails on its next send (§5 rule 8); cover that case too | `03` §3.3, §20.3 |
| A5 | Renew the attribution token after a live consultation; blank the cart marker on sign-out / erase / withdrawal | attributed revenue („Beraten & gekauft“, „Beraten, anderes gekauft“; the „ohne Zuordnung“ `unknown_token` count should fall), privacy hygiene | none — **backend built**: API_CONTRACT.md §10 returns a new token after a purge or erasure; `MO_ATTRIBUTION_SESSION_ANCHOR` is independent | Task 1: `finalizeStream()` → `moAttrRenew()` after a live turn with a product tool, once per page view, consent-gated. Task 2: `/cart/update.js` with the cached keys set to `""` in `signOut()`, `clearAfterErase()`, `endedSignInCleanup()` and on withdrawn consent | S | Task 1 only with analytics consent and after a live chat turn; task 2 removes a marker, not gated. The lawyer's answer to F-37 (b) may make task 2 required (ANWALTSDOSSIER §20) | [`3-attribution-token-renewal.md`](tasks/3-attribution-token-renewal.md), `05` §10.3, `06` §8.5, §8.7 |
| B1 | `source` on `chat_opened` (`launcher \| nudge \| product_cta \| deeplink \| auth_return \| email_summary_api`, the last one for the external `window.MS_CHAT.openEmailSummary()` = `openCaptureForm()`) and `returning: bool` | measurement → all funnels | Dashboard: open → message by source | `openPanel(source)` callers | S | Ids/enums only. The header share button (`shareBtn` → `openCaptureForm()`) and the feedback link (`feedbackLink` → `openFeedbackCard()`) sit inside the open panel, so `openPanel()` returns at `if (state.open) return;` and never fires `chat_opened` for them; they would need their own events | `05` §13.1 |
| B2 | Tag every sign-in start: `initiateLogin('welcome_card' \| 'header' \| 'account_menu' \| 'link_failed')` | sign-ins (find the best entry point) | Extend `signinSource()` in `src/lib/kpi-widget-events.mjs` (today: `login_gate` vs `other`), API_CONTRACT.md §5 | 4 call sites | S | — | `04` §17, `05` §13.4 |
| B3 | Card impressions `product_card_shown {productId, surface}` and `surface` on `product_cta_clicked` | product clicks (CTR denominators) | Dashboard CTR by surface; check pattern `%product%click%` | builders + `productButton()` | S | Interaction-free → legal check or consent gate | `05` §13.1 |
| B4 | Track Markdown links to product URLs as `product_cta_clicked {productId, source:'text_link'}` (same design as `06` §16 T7) | product clicks | none for counting: the name matches `%product%click%` in `CTA_PATTERNS` (`src/lib/kpi-event-patterns.mjs`), so it counts as a product click automatically; dashboard split by `source` optional | link handler in `appendInline()` | S | No raw URLs in KPI; ids only | `06` T7, F16 |
| B5 | `deeplink_opened {campaign, fresh, fullscreen}` | campaign chats (open step) | Dashboard campaign funnel | `handleMoDeepLink()` | S | Never the token | `05` §13.4 |
| B6 | One id space: send the handle in `product_cta_opened` (keep the numeric id as an extra field) — or map server-side | measurement | Map numeric → handle (catalog) if widget not changed | `openWithProduct()` | S | — | `06` T10 |
| B7 | `add_to_cart_clicked.productIds` lists only in-stock products (or adds `soldOutIds`): today `buildAddToCart()` sends `resolved.map(p => p.id)`, which includes `inStock === false` products that the server-built `cartUrl` excludes | measurement (product-level add-to-cart) | Dashboard reads the new field if added | `buildAddToCart()` click handler | S | — | `03` §20 item 13 |
| B8 | Optional `askNumber` on `email_capture_declined` (API_CONTRACT.md §5 allows it; the widget sends only `trigger`) | measurement (opt-in funnel) | Add `askNumber` to the `offer_email_summary` tool input or output. Today it is computed only in `src/app/api/chat/route.ts` `onFinish` and written only to the server event `email_capture_ask_shown`. Alternative: document a client-side count that matches `countEmailSummaryOffers()` | Pass it through `buildToolCard()` → `buildCaptureCard()` (today only `{ message, productIds, trigger }`) → `email_capture_declined` | M | Backend + widget change | `03` §20 item 5, `05` §13.4 |
| C2 | Thumbnail and name in the product card link to the product | product clicks | none | `buildShowProduct()` | S | — | `05` §13.4 |
| C3 | Render `rating`/`ratingCount`, „ab“ price from `priceMin`, and `show_product.reason` | product clicks | Make sure fields are filled | `buildShowProduct()`, `priceNode()` | S | `reason` was dropped by a client decision; confirm with owner | `03` §20.4 |

### P2 — larger or dependent

> **Backend built for P2:** **OI3** (consent-popup framing) — `surface=signin` serves `benefits` (three bullets, owner decision D-AP4) and `variant`, `CONSENT_SIGNIN_VARIANTS` (default `a`) for a later framing test, `placement` / `variant` on the opt-in POST and in the `consent_gate_*` data, dashboard block „Nach Variante und Platzierung“; widget part = frontend task 1 (prerequisite for D6/D7 variants and placement `value_moment`). **OI1** (honest opt-in measurement) — opt-ins carry `source` / `outcome`, DOI confirmations `source`, consent section per session, capture funnel = form only, no „already subscribed“ for a suppressed address; judge D6/D7 on „Opt-ins (Server)“ and the DOI-Quote per variant (AD §5.7). D11: the server creates no new summary offers for a live signed-in session; only restored parts remain.

| # | Item | KPI | Backend work | Frontend work | Effort | Legal / notes | Refs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D1 | In-chat „In den Warenkorb“ via same-origin `POST /cart/add.js`, then badge + `<cart-modal>` refresh (primitives in `refreshCartUI()`) next to or instead of the permalink | add-to-cart, attributed revenue (stamp stays on the live cart) | Expose `selectedVariantId` / variant ids reliably | `buildAddToCart()` / `buildShowProduct()`; sold-out handling | M | Name the KPI against `%cart%` deliberately | `05` §13.4 |
| D2 | Listen to the theme's `product:added-to-cart`: consent-gated re-stamp and a KPI for consulted sessions | attributed revenue, measurement | Dashboard; decide whether it counts as "Add-to-Cart-Klicks" | `init()` listener | S | `detail.id` is the numeric variant id (`06` §12), so a catalog ref needs a variant → handle lookup; name the KPI against the dashboard patterns (API_CONTRACT.md §0 rule 15) | `06` T5 |
| D3 | Variant awareness: selected PDP variant into `pageContext`/context as `handle~variantId`; „Zum Produkt“ with `?variant=` | add-to-cart, measurement | `shopifyUrl` with `?variant=` (backend-only part) | snippet + `PAGE_CTX` + `variant:change` listener | M | For variant-level KPIs send `selectedVariantId` (or the requested ref) explicitly: the `/api/products` `id` is always the base handle (`06` §2.3) | `06` T4 |
| D4 | `/en` conversion: localised `shopifyUrl`/showroom, CTA label key, voice `lang` from `LOCALE` | EN conversion | `shopifyUrl` per locale (needs a request param or a second field) | `productButton()`, `startVoice()`; `product.json` label (editor-owned) | M | No consent gate needed: the English consent copy is approved as the translation (`enLegalReviewed: true`, API_CONTRACT.md §12.3) | `06` T6, `03` §17 |
| D5 | ~~CTA on the three CTA-less product templates, dead-CTA guard~~ (**done**, `8d0a0c4`; remaining guard gap: JS fails to load or a click before the deferred JS booted). **Open:** a „Frag Mo“ entry in the PDP „Hast du noch Fragen?“ block and at the end of the Q&A tab; a Q&A tab on `product.produkte-im-set` | CTA opens → messages | none | Generic `MS_CHAT.open({source, topic})` API (S–M); markup in editor-owned templates/sections; `product-qa.liquid` (Mo-owned); for the boot gap, a class on `<html>` set in `init()` that the CTA needs to be visible | M + Ops | Coordinate with the live editor; re-sync after | `01` §6, `06` T8/T9 |
| D6 | Consent ask at a value moment (after the first `add_to_cart_clicked` or second product card) for signed-in customers | opt-ins | **Backend built:** `placement: "value_moment"` accepted and reported per variant × placement (AD §5.7); `optInActionable` gates it | `presentSignInOptIn()` trigger; one ask per tab session; the `placement` / `variant` echo of task 1 | M | Every variant `lawyerApproved`; anti-nag rules | `05` §13.4, `04` §17 |
| D7 | Popup timing test (after the first answered reply / first product card instead of 0.7 s after send); let a fresh sign-in reopen the consent-popup budget | sign-ins, opt-ins | **Backend built:** dashboard split by variant × placement (AD §5.7) | `maybeShowConsentGate()`, `gateBaseEligible()` | S–M | Keep „Später“, once per tab session, never in voice mode | `04` §17, `05` §13.4 |
| D8 | Mobile nudge on home (dwell/scroll); reword the behaviour-referencing streak copy; returning-visitor copy „Weiter mit deiner Beratung“ | chat opens | none | `initNudgeTriggers()`, `nudgeCopy()` | S | Tone rule | `05` §7.2–§7.3 |
| D9 | Error telemetry (chat 4xx/5xx/429, `payload_too_large`, hydration miss, TTS fallback) and attribution coverage flag | measurement, reliability | Dashboard | `handleChatHttpError()`, `hydrate()`, `initAttribution()` | S | Coverage flag is interaction-free → legal check | `05` §13.1 |
| D10 | Return tool parts in account transcripts so resumed threads keep product cards (and replays) | product clicks from history | Extend `GET /api/account/conversations/{id}` (ACCOUNT_CONTRACT.md §7.2) additively | `transcriptToMessages()` | M | — | `03` §20.10, `04` §17 |
| D11 | Fix reload artefacts: no capture card for signed-in on restore; do not re-show submitted/declined forms | opt-in data quality, no double submits | **Backend half done:** no new summary offers for a live signed-in session (`src/app/api/chat/route.ts`) | `renderAllMessages()` re-render after auth; mark submitted forms in stored parts | S–M | — | `04` §18.2, `03` §12 |
| D12 | Chunk `add_to_cart` ids > 10 | checkout reach | none | `buildAddToCart()` | S | — | `03` §8.3 |
| D13 | Roll back the user message on an SSE `error` chunk with no content (as the HTTP error paths do) | data integrity, no consecutive user turns | Until then accept consecutive user messages (§5 rule 5) | `startStream()` / `finalizeStream()` | S | — | `03` §20 item 7 |
| D14 | Stop replaying output-less tool parts: `accumulatePart()` stores a tool part as `state: 'output-available'` as soon as its input exists, even when no output ever arrives (`tool-output-error`, a stream drop after the input). `sanitizeToolParts()` drops only `INCOMPLETE_TOOL_STATES` (`input-streaming`, `input-available`) | data integrity of replays (affects every new tool, §3.1/§3.2) | Or: drop parts whose `output` is undefined in `src/lib/chat-message-sanitize.mjs → sanitizeToolParts()` (backend-only, works with every widget) | Keep `state: 'input-available'` until an output arrives (`accumulatePart()`) | S | — | `03` §20 item 14 |
| D15 | Clear `capturedEmail` in `startNewChat()`: today only `dropSessionHistory()` sets it to `null`, so after an anonymous „Neuen Chat starten“ (header icon or the `payload_too_large` button) `startStream()` keeps sending `customer: { email }` under the new sid (and `/api/feedback` keeps sending the address) | privacy, returning-customer memory | none (the backend already ignores the mismatched capture for memory) | `startNewChat()` | S | Privacy: the address leaves the browser under a session it was not captured in | `03` §20 item 19 |
| D16 | Re-arm hands-free voice mode after HTTP 400/401/403/5xx: `handleChatHttpError()` has no `restartVoiceLoop()` (only the network-catch path in `startStream()` and the 429 path via `lockRateLimit()` re-arm it) | voice-mode completion | none | `handleChatHttpError()` | S | — | `03` §20 item 17 |
| D17 | Skip stale card builds and mints after a sid rotation: capture `sid` before `hydrate()` / before the mint `fetch`, and skip `moAttrOnProductCard()` / the cache write when it changed | attribution data quality (no stamp for a session that did not consult) | none | `buildShowProduct()`, `moAttrEnsure()` | S | — | `06` §8.7 |

### P3 — later, or needs a product/legal decision

| # | Item | KPI | Notes | Refs |
| --- | --- | --- | --- | --- |
| E1 | Campaign-aware greeting: `mo=open` + token sends a `context.type:'campaign'` greeting | campaign chats | Redefines `campaign_chat_started` (greeting ≠ visitor message); new context type in API_CONTRACT.md §2 | `05` §13.4 |
| E2 | `widget_loaded {pageType, device}` once per tab session | measurement (reach) | Interaction-free: lawyer decision first (§ 25 TDDDG) | `05` §13.3 |
| E4 | Server-side sign-out (`/api/auth/shopify/logout`) instead of local-only | security hygiene | Top-level redirect; product decision | `04` §7.8 |
| E5 | Accessibility: `aria-live` for replies and notices, panel focus trap and Esc in modal mode, focus return to the launcher | quality, reach | Widget S–M | `02` §15 |
| E6 | Widget version signal | safer rollouts | Backend first if it is a header: a new request header fails every CORS preflight until `Access-Control-Allow-Headers` lists it (API_CONTRACT.md §0 rule 4, `src/lib/security.ts`); a body or query field needs no CORS change. Then widget S, backend logs it. Replaces the marker check of §6.4 | §5 rule 2, §6.4 |
| E7 | Clear the device trail and decision keys on erase | privacy | Product/legal decision | `02` §21.6 |
| E8 | Commit the test harness to the theme repo | quality | Never listed in MANIFEST uploads | §6.1 |
| E9 | Contextual sign-in card when Mo needs the account (order questions → `get_order_status` `sign_in_required`): a visible tool / card that calls `initiateLogin('order_status')` | sign-ins | Only where order status is on (`CHAT_ORDER_STATUS_ENABLED`, default off in code); a new `source` value in `signinSource()`; pattern §3.2. Widget M | `05` §13.4 |
| E10 | Open product pages in the same tab on mobile (the new tab loses the chat context visually) | product clicks | Check the effect on `chat_opened` counts (re-open on the new page). Widget S | `05` §13.4 |
| E11 | Keep the campaign token until the first message even across a tab close (today sessionStorage only) | campaign chats | Privacy decision: the current design deliberately limits the token's lifetime (API_CONTRACT.md §0 rule 21). Widget S | `05` §13.4 |

### Done

Kept for the ids other docs cite.

| # | Item | Closed by |
| --- | --- | --- |
| P0.1 | Merge and upload PR #73 and verify it live; then the order-status switch | Upload and live check on 2026-10-04 (`docs/ROLLOUT_TODO.md` 1.11); the switch is ROLLOUT 6.6 |
| P0.3 | Set up the App Proxy `/apps/chat/whoami` (silent shop-login recognition) | Backend: P0.3 Phase 1 + 2 — fresh signature, handover, code only with a proof, `account_shop_recognised`, shop proof under D-AP1, anti-nag, dashboard block AD §5.15 (contract ACCOUNT_CONTRACT.md §3a). Ops: `docs/ROLLOUT_TODO.md` 5.4 (steps and state). What stays: only a build that redeems `linkCode` is safe, so re-check §6.4 after every re-sync (drift risk `04` §5.4; drift alarm AD §5.15; kill switch `APP_PROXY_SIGNIN_ENABLED=false` + redeploy) |
| P0.4 | `contact_form_submitted` session join | Widget `8d0a0c4` (body `sessionId`) plus the backend fallback to `x-ms-session` (`src/app/api/contact/route.ts`, API_CONTRACT.md §4) |
| P0.5 | Abort the stream on new chat / open conversation | Widget `8d0a0c4`; `3e87341` also stops the queued audio (`04` §18 item 1) |
| P0.6 | Dashboard "Engagement" denominator | Backend: „Geöffnet → geschrieben“ = sessions with `message_sent` ÷ sessions with `chat_opened`, reach shown separately (AD §5.1, `src/lib/kpi-store.ts`) |
| P0.7 | Upload `8d0a0c4` and verify | Uploaded as `3e87341` on 2026-10-04 (`docs/ROLLOUT_TODO.md` 1.11) |
| C1 | `order_support` labels | Widget `8d0a0c4`: `REASON_LABELS.order_support` „Kontakt zum motion sports Team“ + subline, placeholder „Bestellnummer + kurz dein Anliegen…“, EN overlay, organisation optional |
| E3 | Per-customer marketing-decline memory | Backend-only, no widget change: the anti-nag in `optInActionable` (ACCOUNT_CONTRACT.md §6.1, `src/lib/consent-ask-policy.mjs`) |

---

## 8. Open questions that block or change priorities

| Question | Blocks / changes | How to answer |
| --- | --- | --- |
| Does the cart-permalink checkout keep the `_mo` attribute stamped via `/cart/update.js`? | A2 priority; how to read „Mo-zugeordneter Umsatz“ | One test order (P0.2) |
| Which products use which product template? | How many PDPs lack the Q&A tab (`product.produkte-im-set`) | Shopify admin / Admin API `template_suffix` |
| Which cookie banner is live, and is the Customer Privacy API loaded on every page? | Share of visitors that can ever be attributed | Inspect the live shop |
| Classic or new customer accounts? | P0.3 value (whether `logged_in_customer_id` is filled) | Answered by the manual whoami check of `docs/ROLLOUT_TODO.md` 5.4: open `/apps/chat/whoami?session=livecheck-manual` while logged in to the shop; an `account_shop_recognised` row for that session (`npm run verify:live` section 8) means the id arrives, no row means the lever is 0 (Shopify admin settings as a cross-check) |
| Is `track()` without consent acceptable under § 25 TDDDG? Also: may the pseudonymous sid assign the consent-popup framing variant (`CONSENT_SIGNIN_VARIANTS` > 1, per `x-ms-session`) and the page-context control group (`CHAT_PAGE_CONTEXT_HOLDOUT_PCT`)? | B3, D9, E2 and every interaction-free event; OI3 B4 (second variant), the A3 holdout | Lawyer (before either is switched on) |
| Are the widget-authored strings next to consent text (consent-popup benefit bullets, capture DOI caption) covered by the legal sign-off? | D6, D7 | Lawyer (`04` §19). Bullets: owner decision D-AP4 — served by the backend (`benefits`, copy v5); the widget drops its own with task 1. Still open: the lawyer's record of the bullets, every later variant, whether the shown variant must be stored on the consent record (CONSENT_FLOW „open“), and the capture DOI caption |
| Do preflighted `keepalive` KPI requests survive the sign-in navigation on all target browsers? | Reliability of `account_signin_started` | Compare `login_gate_signin_clicked` vs `account_signin_started{source}` vs `account_signin_succeeded` per session (`05` §14.2) |
| ~~Does a greeting-only turn (`messages: []`) create a conversation row?~~ **Resolved** (`05` §14.3): yes. It is persisted by `persistTurn()` in `/api/chat` `onFinish` and creates a `conversations` row (`message_count` 1). It counts in „Chats gesamt“ (AD §5.1) although the visitor sent nothing; „Geöffnet → geschrieben“ uses `message_sent`. | How nudge greetings count as chats | Done; use `message_sent` for "visitor wrote" |
| Is the live theme identical to `main` after an upload? | Every plan; the App Proxy (P0.3) and every switch that waits for a widget build | Re-check after each upload: fingerprint (§6.4) and the checks of §6.3 |
