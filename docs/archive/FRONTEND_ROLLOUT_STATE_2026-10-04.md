# Frontend rollout state as documented on 2026-10-04 (snapshot)

Archived 2026-10-05 from docs/frontend/README.md (header, §4), 01-storefront-theme.md §16.4, 02-widget-architecture.md (§1.1, §20 item 4, §21, §22), 03-chat-protocol-and-rendering.md (§20, §21) — historical, not maintained.

These passages were written by the frontend agent on 2026-10-04 against theme `main` @ `8d0a0c4`,
**before** the owner's second upload of that day. They describe a state that ended the same day:
the five `8d0a0c4` fixes and the `3e87341` follow-up (two `endSpeaking()` calls) were uploaded on
2026-10-04, the live check was done on 04./05.10. (`docs/ROLLOUT_TODO.md` 1.11) and the order-status
switch was handled in ROLLOUT 6.6. Superseded by: `docs/ROLLOUT_TODO.md` (operator truth),
`npm run verify:widget` over `src/lib/widget-fingerprint.mjs` (build truth) and the behaviour
descriptions in `docs/frontend/01`–`03` (now written against `3e87341`). Use this file only to read
data or notes from 2026-10-04.

---

## From docs/frontend/README.md (header and §4 "Current status (2026-10-04)")

> **As of:** 2026-10-04. **Live runs PR #73** (uploaded by the owner on 2026-10-04; a real live check by the backend is still pending). **The five `8d0a0c4` fixes are not uploaded yet** (see Current status below).

> **Status update (2026-10-04, later the same day): everything on `main` is now live.** The owner also uploaded the five `8d0a0c4` fixes (`assets/ms-chat-widget.js` — including a follow-up that also stops queued voice audio on new chat / open conversation, commit `3e87341` —, `snippets/ms-chat-widget.liquid`, and the three product templates). Wherever a chapter says "`8d0a0c4` not uploaded yet" or "live until the upload", read it as **live since 2026-10-04**. Live = `main` at `3e87341`.

| Item | State | Consequence for backend work |
| --- | --- | --- |
| `main` = `8d0a0c4` (source of truth of these docs) | PR #73 (`a0df103`) merged, plus the docs, plus five widget/theme fixes in `8d0a0c4` (see the next-but-one row). | Describes what the **next** upload will make live. Until the owner uploads `8d0a0c4`, live runs the PR #73 widget, so the five fixes are not in effect on live. |
| **PR #73** = `a0df103` (one-time code redeem, `<head>` stash script, whoami once per tab session + `linkCode` redeem, consent rules, `surface=erase` copy, `mo_c` campaign token, silent `get_order_status`, exact tool matching, history wipe on sign-out) | **Merged to `main` and live.** On 2026-10-04 the owner uploaded `assets/ms-chat-widget.js`, `assets/ms-chat-widget.css`, `layout/theme.liquid` (PR #73) plus `snippets/product-qa.liquid`, `sections/header.liquid`, `snippets/product-detail-accordions.liquid` (2026-10-01 round). | **Sign-in works again on live**, pending a real live check by the backend: sign-in round trip (`07` §6.3), the dashboard stage „Im Chat angemeldet“ filling, and the live fingerprint (`07` §6.4) showing PR #73 markers. Until that check, treat history, export, erase, the consent popup and `mo_c` as expected-to-work, not proven. Between 2026-10-03 (backend required code redemption) and the upload, live sign-in was broken (`04` §16). |
| **`8d0a0c4` fixes** (not uploaded): (1) `startNewChat()` / `openConversation()` call `abortActiveStream()` + `removeTyping()` first; (2) `buildContactForm()` sends `sessionId: sid` in the `POST /api/contact` body; (3) `REASON_LABELS.order_support` label + order-number placeholder; (4) `snippets/ms-chat-widget.liquid`: empty `settings.ms_chat_shared_secret` → no render, and the not-render branch hides the PDP CTA; (5) "MO only" CTA block (`custom_liquid_AErEyg`) added to `product.produkt-new`, `product.produktnew`, `product.produkte-im-set` | **In `main`, not live.** Upload set (`MANIFEST.md` 2026-10-04 b): `assets/ms-chat-widget.js`, `snippets/ms-chat-widget.liquid`, `templates/product.produkt-new.json`, `templates/product.produktnew.json`, `templates/product.produkte-im-set.json`. The owner will upload them. | Until the upload, on live: `contact_form_submitted` stays session-less (a backend fallback to the `x-ms-session` header still helps), `order_support` shows „Persönliche Beratung“, a stream can still leak into a new thread, and the three templates have no CTA. Confirm the upload with the `8d0a0c4` row of the fingerprint table (`07` §6.4). The template files are editor-owned: re-sync after the upload (`01` §16). |
| Shopify App Proxy `/apps/chat/whoami` | **Not set up yet.** Returns Shopify's HTML 404 page; the widget falls back silently. | Shop-login recognition is inactive. Setup is Shopify app config, not a theme change (`06` §9.1). **May now be set up** (`07` §7 P0.3): the precondition "PR #73 live" is met. First confirm with the fingerprint table (`07` §6.4) that live really runs PR #73 code. Historical note: the pre-PR #73 widget (`44a076b` → `detectViaStorefront(force)`) applied a whoami `signedIn: true` answer directly as identity (`applyAuth(data)`) without redeeming `linkCode`; with the proxy on, such a build would show a signed-in name and the consent popup while `/api/account/*` fails with 401 (`01` §16.4). That is why the proxy waited for PR #73, and why an old build reappearing through drift would make it unsafe again. **Backend built 2026-10-05 (P0.3):** whoami issues a `linkCode` only when the session will really be signed in (fresh signature, handover on a shared browser, a proof); otherwise `{signedIn:false}`. Switches `APP_PROXY_SIGNIN_ENABLED` (kill switch) and `APP_PROXY_SIGNIN_MAX_AGE_HOURS` (shop login counts without a chat token, D-AP1 decided 05.10.) are off by default; the owner sets `true` / `24` after configuring the proxy. No widget change needed (`04` §5.4). |
| Backend switch `CHAT_ORDER_STATUS_ENABLED` | **Off.** | **May now be turned on**, after the backend verifies on live (test account) that `get_order_status` renders nothing and Mo answers in text (`07` §6.3 "Tools", §7 P0.1). The pre-PR #73 widget did not list `get_order_status` as a silent tool (`07` §5). |
| Campaign token `mo_c` | Read by the PR #73 widget, which is live. | The head script moves `mo_c` out of the URL before Shopify analytics reads it, and `campaign_chat_started` should now be recorded. Verify once on live (`07` §6.3 "Campaign"). |
| Order attribution `_mo` stamp | In `main` since 2026-08-12 (commit `e4b12f1`, applied on top of the Aug 12 sync `f7dc50a`, so the stamp itself was never reverted in the repo. That sync replaced the widget JS with a pre-PR #67 copy, losing PR #67 and #62 until 2026-10-01 (`beff918`). It also briefly removed the PDP Q&A tab (`snippets/product-qa.liquid`, the Q&A tab in `sections/tabs-cards.liquid`, the `qa_tab_label` / `qa_answered_by` locale keys), which the 2026-08-19 sync `cf9bc43` brought back). Whether it was ever uploaded to live is unknown. | Consent-gated. Whether the in-chat "Zur Kasse" permalink checkout keeps the stamp is **unverified** and needs a test order (`05` §10.3). |
| Live-editor drift | The 2026-08-12 snapshot commit `f7dc50a` replaced the widget JS with an older copy and silently reverted PR #67 and #62 (fixed 2026-10-01, `beff918`); it also dropped the PDP Q&A tab until the 2026-08-19 sync `cf9bc43`. | After every upload and every re-sync, diff the Mo footprint (`01` §16). Never assume a merged change is live. |
| Widget test harness (Playwright headless Chromium + contract mock) | Used for PR #73 (242 checks) and `44a076b`; **not committed** to either repo. No harness run is recorded for `8d0a0c4`. | See `07` §6. |

---

## From docs/frontend/01-storefront-theme.md §16.4 "Current deployment state (2026-10-04)"

| Item | State |
| --- | --- |
| `main` | `8d0a0c4` (source of truth for this chapter) |
| **PR #73** (`a0df103`: one-time sign-in code, `ms_code` redemption, head script, whoami `linkCode` redemption + once-per-tab-session flag, consent-popup rules, `surface=erase` copy, `mo_c` campaign token, silent `get_order_status`, history wipe on sign-out) | **Merged to `main` and live.** On 2026-10-04 the owner uploaded `assets/ms-chat-widget.js`, `assets/ms-chat-widget.css` and `layout/theme.liquid` (PR #73), together with `snippets/product-qa.liquid`, `sections/header.liquid` and `snippets/product-detail-accordions.liquid` (the 2026-10-01 round). |
| **`8d0a0c4`** (five fixes: abort a streaming reply on new chat / open conversation; `sessionId` in the `POST /api/contact` body; `order_support` contact label + placeholder; snippet gates on the shared secret and hides the CTA where the widget does not render; "MO only" CTA on three more product templates) | **On `main`, not uploaded yet.** Files the owner will upload: `assets/ms-chat-widget.js`, `snippets/ms-chat-widget.liquid`, `templates/product.produkt-new.json`, `templates/product.produktnew.json`, `templates/product.produkte-im-set.json`. Until then live behaves as PR #73 for these five points. |
| Sign-in | **Works again on live** with the PR #73 widget (redeems `ms_code` at `POST /api/auth/link`, `CUSTOMER_ACCOUNT.md §2a`). A real sign-in on live still has to be checked by the backend. |
| `CHAT_ORDER_STATUS_ENABLED` (backend) | **Still off.** It may now be turned on, after the backend verifies on live that a `get_order_status` tool part renders nothing (`CHAT_ORDER_STATUS.md`). |
| Shopify App Proxy for `/apps/chat/whoami` | **Not set up yet; may now be set up.** The path returns Shopify's HTML 404. The live (PR #73) widget treats non-OK or non-JSON as "no detection", asks once per tab session (sessionStorage `ms-chat-whoami-done`) on the first auth check after the panel opens (`resolveAuthOnOpen()` → `detectSignedIn()` → `detectViaStorefront()`), and changes nothing visibly. It is deliberately stricter than `CUSTOMER_ACCOUNT.md §3a`: it uses the whoami answer only to redeem `linkCode` (`redeemLinkCode(linkCode, 'shop')`) and ignores it unless the redeem succeeds. *Historical:* the pre-PR #73 widget (`44a076b → detectViaStorefront(force)`) trusted a whoami `signedIn:true` answer directly as identity (`applyAuth(data)`) without any code, which is why the proxy had to wait until PR #73 was live. |
| Campaign token `mo_c` | Read by the live widget since 2026-10-04 (head script + `captureCampaignToken()`). Before that, `mo_c` stayed in the URL and was ignored. |

---

## From docs/frontend/02-widget-architecture.md

### §1.1 "Rollout state: what is live, and what is not uploaded yet" (the part not kept in 02 §1.1)

PR #73 ("customer platform", `a0df103`) is merged to `main` and **live**: on 2026-10-04 the owner uploaded `assets/ms-chat-widget.js`, `assets/ms-chat-widget.css` and `layout/theme.liquid` from it (plus `snippets/product-qa.liquid`, `sections/header.liquid`, `snippets/product-detail-accordions.liquid` from the 2026-10-01 round). Rows tagged **[PR #73]** in later sections are therefore live; the tag only marks what changed in PR #73, which matters when reading data recorded **before 2026-10-04**.

**Not uploaded yet — `8d0a0c4` delta (live = PR #73 until the owner uploads `assets/ms-chat-widget.js`, `snippets/ms-chat-widget.liquid`, `templates/product.produkt-new.json`, `product.produktnew.json`, `product.produkte-im-set.json`).** Rows tagged **[8d0a0c4]** in later sections are not live yet.

| Topic | Live today (PR #73) | `main` (`8d0a0c4`) |
| --- | --- | --- |
| New chat / open conversation while a reply streams | the reply is not cancelled; signed in it lands in (and is saved with) the new or opened thread (§21 item 1) | `startNewChat()` and `openConversation()` call `abortActiveStream()` + `removeTyping()` first |
| Contact form KPI join | `POST /api/contact` body has no `sessionId`, so `contact_form_submitted` rows have `sessionId: null` | body carries `sessionId: sid` (header `x-ms-session` too) |
| `order_support` contact reason | falls back to „Persönliche Beratung“ + generic placeholder | own title / sub-line and placeholder „Bestellnummer + kurz dein Anliegen…“ (03 §8.5) |
| Empty shared secret | snippet still loads config + CSS + JS; the JS mount guard stops it | snippet loads nothing (§2.3) |
| Product CTA where the widget does not render (excluded template, empty secret) | dead button (§3.3) | hidden by a `<style>` from the snippet's else-branch (§2.3) |
| CTA on `product.produkt-new` / `produktnew` / `produkte-im-set` | none | "MO only" block (`custom_liquid_AErEyg`) |

**App Proxy:** the Shopify App Proxy for `/apps/chat/whoami` is still **not set up**, and it **may now be set up**, because the live PR #73 widget uses a whoami answer only to redeem its `linkCode`. Historical note: the pre-PR #73 widget (`44a076b`, `detectViaStorefront()`) trusted a whoami `signedIn:true` answer directly as identity without a code, so the proxy had to wait until PR #73 was live.

### §20 item 4 "Current rollout state (owner facts)"

4. **Current rollout state (owner facts).**
   - PR #73 ("customer platform": one-time code redeem; whoami changed to once per tab session + `credentials:'include'` + `linkCode` redeem; consent rules, `surface=erase` copy, `mo_c` campaign token, silent `get_order_status`, history wipe on sign-out) is **merged to `main` and live** since the owner's upload on 2026-10-04. Sign-in therefore works again on live (the backend has required the code redeem since 2026-10-03); a real live sign-in still has to be checked by the backend.
   - `main` is at `8d0a0c4`, whose five fixes are **not uploaded yet** (files: `assets/ms-chat-widget.js`, `snippets/ms-chat-widget.liquid`, `templates/product.produkt-new.json`, `product.produktnew.json`, `product.produkte-im-set.json`; §1.1).
   - The live widget calls whoami once per tab session and receives Shopify's HTML 404 page, because the Shopify **App Proxy** for `/apps/chat/whoami` is **not configured yet**. The widget silently falls back, so shop-login recognition is inactive.
   - **The App Proxy may now be set up.** The live widget only redeems the whoami `linkCode`. Historical: the pre-PR #73 widget (`44a076b`, `detectViaStorefront()`) applied a whoami `signedIn:true` answer directly as identity (`applyAuth(data)`) without a code, which is why the proxy had to wait (§1.1).
   - `CHAT_ORDER_STATUS_ENABLED` is still **off**. It may be turned on after the backend verifies on live that `get_order_status` renders nothing.

### §21 items fixed by `8d0a0c4` (full text as written before the upload)

Listed for triage. Items 1, 3 and 18 (and the `order_support` label, 03 §20 finding 2) are **fixed on `main` in `8d0a0c4` but not uploaded yet**, so they still apply to the live shop until the owner uploads. The others are open.

- (item 1) **[Fixed in `8d0a0c4`, not uploaded yet] New chat during a streaming reply (signed-in): the old reply leaks into the new thread.** Fix: `startNewChat()` and `openConversation()` now start with `if (abortActiveStream) { abortActiveStream(); abortActiveStream = null; }` + `endSpeaking()` + `removeTyping()`, so the old turn's `cancelled` flag makes its fetch, pump, events and `finalizeStream()` no-ops and any voice-mode audio queued for it stops (in `openConversation()` this runs once the transcript has loaded). *Live behaviour until the upload:* `startNewChat()` sets `state.streaming = false` but does not call `abortActiveStream`. For a signed-in user the sid does not rotate, so `finalizeStream()` passes the `sid === streamSid` check and pushes the old reply into the **new** `messages` array, then saves it. The orphan assistant message is sent as history on the next turn under the new `conversationKey`. For anonymous users the save is blocked (sid rotated), but if no visible part had arrived yet, `ensureCtx()` can still draw the late reply into the fresh welcome view. `openConversation()` has the same pattern on live: it resets `state.streaming` without aborting.
- (item 3) **[Fixed in `8d0a0c4`, not uploaded yet] `contact_form_submitted` is never session-keyed.** The backend keys it on the **body** field `sessionId` (`src/app/api/contact/route.ts`, API_CONTRACT §4). `buildContactForm()` now adds `sessionId: sid` to the JSON body (the `x-ms-session` header stays). On live until the upload the body has no `sessionId`, so those rows have `sessionId: null` and cannot be joined to sessions or chats.
- (item 18) **[Fixed in `8d0a0c4`, not uploaded yet] Product-page CTA can render dead** (§3.3). The CTA `custom_liquid` blocks are gated only on `ai_advisor_enabled`. The snippet now also gates on a non-blank `ms_chat_shared_secret`, and where it does not render the widget it emits a `<style>` hiding `.ms-chat-product-advisor` / `.ms-chat-product-cta` (§2.3). On live until the upload, an excluded product template or an empty secret still shows a dead button with an empty orb span. **Remaining edge (not fixed):** if `ms-chat-widget.js` fails to load, or a shopper clicks before the deferred script has booted, the button still does nothing.
- (item 19) **[Fixed in `8d0a0c4`, not uploaded yet] Three product templates had no CTA** (`product.produkt-new`, `product.produktnew`, `product.produkte-im-set`). `8d0a0c4` adds the "MO only" block there (§3.3). `product_cta_opened` volumes on live will rise after the upload for reasons unrelated to the widget code.

### §22 (last two bullets)

- **Live vs repo:** this chapter documents `main` at `8d0a0c4`. Live runs PR #73 (uploaded 2026-10-04) without the five `8d0a0c4` fixes until the owner uploads them; rows tagged [8d0a0c4] are not live (§1.1). Editor changes on live since the 2026-10-01 snapshot are not reflected.
- **Live sign-in and order status:** that a real sign-in completes on live with the uploaded PR #73 widget, and that a `get_order_status` part renders nothing there, has not been verified yet (backend task before `CHAT_ORDER_STATUS_ENABLED` goes on).

---

## From docs/frontend/03-chat-protocol-and-rendering.md

### §13 "Live until the `8d0a0c4` upload"

*Live until the `8d0a0c4` upload (PR #73 widget):* neither function calls `abortActiveStream()` (`rotateSession()` does not either). Signed in, the sid is unchanged, so the old turn's `finalizeStream()` passes the `sid === streamSid` check and pushes the late reply into the **new** (or opened) thread's `messages`, saves it and replays it under that thread's `conversationKey`. Anonymous, the late reply is not saved (sid rotated), but if no visible part had arrived yet `ensureCtx()` can still draw it into the fresh welcome view. Because input is re-enabled at once, the old turn's `finalizeStream()` can also re-enable input in the middle of a new turn. Same finding in 02 §21 item 1 and §20 finding 15.

### §20 findings fixed by `8d0a0c4`

Found while documenting. Findings 1, 2 and 15 are **fixed on `main` in `8d0a0c4` but not uploaded yet**, so they still hold on live until the owner uploads `assets/ms-chat-widget.js`. The others are open.

- (item 1) **[Fixed in `8d0a0c4`, not uploaded yet] `contact_form_submitted` is recorded without a session id.** The live widget sends `sessionId` only as the `x-ms-session` header. The backend `src/app/api/contact/route.ts` reads `payload.sessionId` from the **body** only, so the KPI row gets `sessionId: null`, and contact submissions cannot be joined to the conversation or tool fire. `8d0a0c4` adds `sessionId: sid` to the body (§8.5). Rows recorded before the upload stay session-less. A backend fallback to the `x-ms-session` header would also cover the live widget until the upload.
- (item 2) **[Fixed in `8d0a0c4`, not uploaded yet] `order_support` had no label row** in `REASON_LABELS`. On live it renders as "Persönliche Beratung" with the generic placeholder. `8d0a0c4` implements the `CONTACT_FORM_ORDER_SUPPORT.md` copy (title, sub-line, order-number placeholder, DE + EN; §8.5). Relevant once `CHAT_ORDER_STATUS_ENABLED` is on.
- (item 15) **[Fixed in `8d0a0c4`, not uploaded yet] New chat / open conversation during a streaming reply** (§13, same as 02 §21 item 1). On live, signed in: the late reply is appended to the new or opened thread and saved. Anonymous: not saved, but it can still render into the fresh view. `8d0a0c4` calls `abortActiveStream()` + `endSpeaking()` + `removeTyping()` first in `startNewChat()` and `openConversation()`.

### §21 open questions 4–6

4. **Live parity:** this describes `main` at `8d0a0c4`. Live runs the PR #73 widget (uploaded 2026-10-04) without the `8d0a0c4` fixes until the owner uploads them (items tagged [8d0a0c4]). Live-editor drift has reverted widget work before, so diff after each upload.
5. **`get_order_status`** is documented as silent and works in code. PR #73 (silent handling, chat sign-in via one-time code) is live since 2026-10-04, but the tool can only fire once the backend switch `CHAT_ORDER_STATUS_ENABLED` is on. It is still off; the backend should first verify on live that a `get_order_status` part renders nothing and that a real sign-in completes.
6. **Backend profile on resumed threads:** whether the backend restores the customer profile for a resumed thread whose replayed history has no `update_customer_profile` parts (finding 10) was not checked in the backend code.
