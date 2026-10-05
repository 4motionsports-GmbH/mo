# Frontend docs — status notes as of 2026-10-04/05 (snapshot)

Archived 2026-10-05 from docs/frontend/README.md and chapters 01–07 — historical, not maintained.
Part 1 covers the README and chapters 01–03, Part 2 chapters 04–07.

# Part 1 — README and chapters 01–03
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


---

# Part 2 — chapters 04–07

Archived 2026-10-05 from docs/frontend/04-accounts-sign-in-and-consent.md, 05-engagement-and-kpi.md, 06-commerce-and-storefront-integration.md and 07-feature-and-kpi-playbook.md — historical, not maintained.

These are the dated status passages the four chapters carried while they described `main` at `8d0a0c4` and the live shop still ran PR #73 (uploads pending, live check pending, App Proxy and order-status switch not yet decided), plus the blocks that were replaced by pointers to their owners. Everything below is verbatim; section numbers are those of the chapters at the time. **Superseded by:** production status → `docs/ROLLOUT_TODO.md`; which build is live → `docs/frontend/07-feature-and-kpi-playbook.md` §6.4 and `src/lib/widget-fingerprint.mjs`; App Proxy behaviour → `docs/frontend/ACCOUNT_CONTRACT.md` §3a and `04` §5.4; consent A/B design → `docs/frontend/CONSENT_CONTRACT.md` §3.1, `docs/ADMIN_DASHBOARD.md` §5.7 and `docs/frontend/tasks/1-consent-benefits-variant.md`; dashboard reading → `docs/ADMIN_DASHBOARD.md` §5 and `05` §12; KPI ideas and the widget backlog → `07` §7.


---

## A. Chapter 04 — accounts, sign-in and consent

### A.1 Header basis line (old)

It describes `main` at `8d0a0c4`: PR #73 "customer platform" (`a0df103`, merged) plus five follow-up fixes. **PR #73 is live since 2026-10-04**; the `8d0a0c4` fixes are not uploaded yet (see §16).

### A.2 §1 row „Current live status“ (removed)

| Current live status | PR #73 is merged and was uploaded to the live theme on 2026-10-04, so sign-in in the live chat **works again** (the live widget now redeems `ms_code`), pending a real check on live by the backend. Between the backend change of 2026-10-03 and that upload, live sign-ins were never linked. See §16. |

### A.3 §1 row „Shop recognition“ (old wording)

| Shop recognition | Same-origin `GET /apps/chat/whoami?session=` runs **once per tab session** (sessionStorage) on first panel open. Its `linkCode` is redeemed the same way. The App Proxy is **not set up yet**, so today it is a silent no-op. Since PR #73 went live (2026-10-04) it may be set up; confirm first that live runs the PR #73 code (§16). |

### A.4 §5.4 „Current state“ (old; replaced by „Without and with the App Proxy“)

The App Proxy is **not configured** in Shopify, so the path returns Shopify's 404 HTML page. The widget treats that as "not signed in". Each tab session pays one storefront 404 page fetch on first open (a new tab pays again), and the anonymous sign-in affordances wait for it (§2.3).

**The proxy may now be set up**, because PR #73 has been live since 2026-10-04. First confirm that the live `assets/ms-chat-widget.js` really is the PR #73 version (it contains `redeemLinkCode`; see the drift check in §16). Historical note: the pre-PR #73 widget (`44a076b → detectViaStorefront(force)`) applied a whoami `signedIn: true` answer directly as identity (`applyAuth(data)`) and never redeemed `linkCode`. Under that widget a proxy would have produced a signed-in UI whose `/api/account/*` calls all return 401. A live-editor revert to that version would bring the problem back.

**Backend state (2026-10-05, P0.3, no widget change needed).** whoami answers `signedIn: true` + `linkCode` only when the session will really be signed in after the redeem; everything else is `{signedIn:false}` (CA §3a):

- the signature must be fresh (Shopify `timestamp` within ±300 s, no replay);
- **handover:** a sid signed in as **another** shop customer loses that sign-in and gets no code; the widget's `/api/auth/me` probe then reads `signedIn:false` and `endedSignInCleanup()` wipes and rotates (§2.5);
- `APP_PROXY_SIGNIN_ENABLED` (kill switch, default off) must be on;
- a proof: a live chat token of the customer, or — with `APP_PROXY_SIGNIN_MAX_AGE_HOURS` > 0 (D-AP1, decided 05.10.2026) — the shop login itself.

Both switches are off by default; the owner sets `APP_PROXY_SIGNIN_ENABLED=true` and `APP_PROXY_SIGNIN_MAX_AGE_HOURS=24` after configuring the proxy. Every recognised request records the server-only `account_shop_recognised` (§14). Whether Shopify sends `logged_in_customer_id` for this store's account type is answered by the manual check `whoami?session=livecheck-manual` (`07` §8).

### A.5 §10.9 „Running an A/B test on consent surfaces“ (old; before copy v5 served `benefits` / `variant` and per-session caching)

**What the server can vary without a widget release:**
- `surface=signin` copy: `headline`, `marketingLabel`, `consentFooter` (each variant must be `lawyerApproved: true`, otherwise popup and card render nothing).
- Capture copy: `transactionalLabel`, `marketingLabel`, `consentFooter`, `returningHint`.
- `marketing.optInActionable` on `/api/auth/me` (who is asked at all).
- When and how often `offer_email_summary` fires, and its `message` / `trigger`.

**What needs a widget release:** popup timing (+700 ms after send), the popup's benefit bullets (which should not be in the widget at all, §11), all button labels and error texts, the one-popup-per-tab budget, the 30-day device decline, the 24 h login snooze, the choice popup vs inline card.

**Assignment.** Bucket deterministically by `sid` (it is the KPI `sessionId` and the `x-ms-session` header on the consent-copy GET). Caveats:
- The consent-copy URL is the same for every session and is served `public, max-age=60, stale-while-revalidate=300` without `Vary` (§10.1). The browser may reuse a cached answer without a request, and the widget's 60 s memory cache is not keyed by sid. Per-session variants on that URL therefore need `Cache-Control: private, no-store` on the backend (or a variant parameter in the URL, which is a widget change). Whether Vercel's CDN also stores the `public` response is not verified here.
- The `offer_email_summary` tool output (`output.consentCopy`) is per turn and not HTTP-cached, but it is **not a reliable way to vary the capture card that same tool call shows**: that card has already requested `/api/consent-copy` by the time the tool output arrives (§10.1 "Seed timing"). The seed only affects later cards within 60 s. Varying capture copy per session therefore also needs the GET to be uncacheable.

**Measuring exposure.** KPI events carry no variant, and popup and inline card both send `consent_gate_* {surface:'signin'}`. Join exposure server-side by `sessionId` (the sid that fetched the copy), or at submit time by the echoed `consentTextShown`. The `headline` is **not** part of `consentTextShown`, so a headline-only variant needs the sessionId join. The widget ignores the served `version` field.

**Contamination.** The decline memory is device-wide for 30 days (any customer, any variant). One sid spans many tab sessions (`05-engagement-and-kpi.md` §3.2), so a sid can see the ask in several tabs. Popup budget and inline card interact (§10.4).

**Traffic today.** Signed-in traffic on live starts with the PR #73 upload of 2026-10-04 (§16). Before that date live had no linked sign-ins, so `surface=signin` exposure data exists only from 2026-10-04. Until the App Proxy is set up, it comes only from chat sign-ins (no whoami recognition), so expect low volumes at first.

### A.6 §16 „Operational status and dependencies“ (removed)

| Item | Status (2026-10-04) | Consequence |
|---|---|---|
| PR #73 (`a0df103`) | **Merged to `main`, live since 2026-10-04** (owner upload of `assets/ms-chat-widget.js`, `assets/ms-chat-widget.css`, `layout/theme.liquid`; uploaded together with `snippets/product-qa.liquid`, `sections/header.liquid` and `snippets/product-detail-accordions.liquid` from the 2026-10-01 round) | Chat sign-in works again on live (the widget redeems `ms_code`), **pending a real check on live by the backend** (one full sign-in with `account_signin_linked` in `kpi_events`). History, export, erase, the consent popup / inline card and the login gate now get real traffic. **KPI data for tier 3, the consent popup and the login-gate funnel is meaningful only from 2026-10-04.** Historical (2026-10-03 until the upload): the pre-PR #73 widget (`44a076b → handleAuthReturn`) never redeemed `ms_code`, so chat sign-ins were never linked, and it sent `account_signin_return {result:'ok'}` on every `ms_auth=ok` return before any redeem. Its "ok" counts for that window are inflated; use the server's `account_signin_linked` instead. That widget also stripped only `ms_auth` from the URL, and the old `layout/theme.liquid` had no early-param head script, so `ms_code` (and any `mo_c`) could reach Shopify analytics / web pixels and copied URLs. |
| `main` `8d0a0c4` (five follow-up fixes) | **Merged, not uploaded yet.** The owner will upload `assets/ms-chat-widget.js`, `snippets/ms-chat-widget.liquid` and three product templates (MANIFEST 2026-10-04 b) | In scope here: `startNewChat()` / `openConversation()` cancel a reply that is still streaming (§7.3, §18 item 1). Until the upload, live still has that bug. The other fixes (contact-form `sessionId`, `order_support` label, CTA hiding, CTA on three more templates) are in chapters 05 and 06. |
| Shopify App Proxy `/apps/chat/whoami` | **Not set up** (Shopify 404 page) | Shop-login recognition is a silent no-op. Setup steps: CA §3a (subpath `apps/chat` → `https://mo.motionsports.de/api/auth/storefront`, env `SHOPIFY_APP_PROXY_SECRET`). **It may now be set up**, because PR #73 is live. First confirm that the live widget is the PR #73 version (it contains `redeemLinkCode`). Historical note: the pre-PR #73 widget (`44a076b → detectViaStorefront(force)`) applied a whoami `signedIn: true` answer directly as identity (`applyAuth(data)`) without redeeming `linkCode`, so under that widget a proxy would have shown a signed-in UI with 401s on every `/api/account/*` call. A live-editor revert to that widget would bring the problem back. Backend side built 2026-10-05 (§5.4); the kill switch `APP_PROXY_SIGNIN_ENABLED=false` stops all codes if drift reappears. |
| `CHAT_ORDER_STATUS_ENABLED` (backend) | off | May now be turned on, because PR #73 (silent `get_order_status` rendering + history wipe on sign-out) is live. First verify on live that a `get_order_status` part renders nothing in the chat. |
| Deployment | Manual copy into the Shopify code editor | Live-editor drift has reverted widget work before (Aug 12 2026 sync overwrote PR #67 / #62, restored 2026-10-01). After any re-sync, verify that `presentLoginGate`, `redeemLinkCode` and the head script are present in the live files. |

### A.7 §19 bullets closed on 2026-10-05

- **Server-side expiry of a locally signed-out sid.** Sign-out leaves the old sid linked on the server. How long it stays resolvable is backend behaviour and is not in the handoff docs.
- **`/api/auth/link` 200 body.** The widget treats `signedIn: false` in a 200 body as refused. Whether the backend ever sends that is not documented (CA §2a lists only `200 {ok:true, signedIn:true}`).
- **Runtime verification.** Nothing in this chapter was tested in a browser. All behaviour is from reading `main` at `8d0a0c4`. Whether live really runs the PR #73 files uploaded on 2026-10-04 (and not an editor-reverted copy) still needs one real sign-in on live (§16).


---

## B. Chapter 05 — engagement and KPI

### B.1 Header source line (old)

> **Source of truth:** the theme repo `ms_shopify_clone`, `main` at `8d0a0c4`: PR #73 "customer platform" (`a0df103`, merged, **live since 2026-10-04**) plus five follow-up fixes that are **not uploaded to live yet** (contact-form `sessionId`, stream cancel on thread switch, `order_support` label, CTA hiding, CTA on three more product templates). Every claim below comes from reading that tree, mainly `assets/ms-chat-widget.js`. Backend behaviour is cross-referenced to the backend repo's `docs/frontend/API_CONTRACT.md` (cited as **AC §n**), `docs/ADMIN_DASHBOARD.md` (**AD §n**), `docs/ORDER_ATTRIBUTION.md`, `docs/CAMPAIGNS.md` (**CMP §n**) and `docs/frontend-handoff/*.md` (`CUSTOMER_ACCOUNT.md` = **CA §n**). It is not re-specified here.

### B.2 §1 row „Live status and data windows“ (old)

| Live status and data windows | PR #73 is live since 2026-10-04: sign-in works again, so tier-3, consent-popup (`consent_gate_*`) and login-gate funnels (`login_gate_*` → `account_signin_linked`) have real data **from 2026-10-04** only. The `8d0a0c4` fixes are not uploaded yet; once they are, `contact_form_submitted` becomes session-keyed (§4.10) and three more product templates show the CTA (§8.1). |

### B.3 §4.10 contact form (old wording)

- **Contact form** (`buildContactForm()` → `POST /api/contact`): no widget event. The server writes `contact_form_submitted` and keys it on the body's `sessionId` only (`src/app/api/contact/route.ts`). **Since `8d0a0c4`** the submit payload carries `sessionId: sid` (the current sid at submit time) next to the `x-ms-session` header, so the row is **session-keyed** and joins the chat session. Before that commit, and on live until the owner uploads it, the body had no `sessionId` and the row was stored with session `NULL`. Rows from before the upload cannot be joined.

### B.4 §12 „How the admin KPI tab reads these events“ (old; the „Engagement“ row predates „Geöffnet → geschrieben“)

> **Backend status (2026-10-04, after this chapter was written):** „Engagement“ is now „Geöffnet → geschrieben“ (sessions with `message_sent` ÷ sessions with `chat_opened`); the old denominator is shown as „Reichweite (Sitzungen)“. The Anmelde-Popup section has a per-session diagnosis that applies §12.1 (`classifySigninSession` in `src/lib/kpi-widget-events.mjs`). `/api/contact` takes the session from `x-ms-session` when the body has none. `POST /api/kpi` drops server-only event names. Release dates annotate the KPI tab (`src/lib/kpi-releases.mjs`). Live checks: `npm run verify:widget`, `npm run verify:live` (backend `docs/ROLLOUT_TODO.md` 1.11).

> **Backend status (2026-10-05):** „Seitenkontext auf Produktseiten“ (AD §5.1a, Beratung) reads the server-only `page_context_applied` / `page_context_answered` per session and joins the widget's `product_cta_clicked` (`samePage` not `true` = „andere Produkte“), `add_to_cart_clicked`, `product_cta_opened` / `nudge_clicked` (primed before the first question) and `mo_orders` in fixed 24 h / 7 day windows; a comparison is shown only with a pre-registered control group. „Einwilligung nach der Anmeldung“ counts sessions with their final state and splits by `variant` × `placement`; the „E-Mail-Capture-Funnel“ counts the capture form only (OI1, rows below).

The backend dashboard (AD §5) consumes widget events as follows. These observations come from reading `src/lib/kpi-store.ts`, `src/lib/kpi-widget-events.mjs` and `src/lib/kpi-event-patterns.mjs` in the backend repo. The click patterns (`CTA_PATTERNS`, `CART_PATTERNS`) are defined once in `kpi-event-patterns.mjs` and imported by `kpi-store.ts` (KPI tab), `src/lib/admin-conversations.ts` (Gespräche inspector) and `src/lib/analytics-report-store.ts` (Komplettanalyse).

| Dashboard figure | Reads | Fit with the widget today |
| --- | --- | --- |
| **Produkt-/CTA-Klicks** (AD §5.1) | `event ILIKE '%product%click%' OR '%cta%click%'` | Matches `product_cta_clicked` only. It does **not** match `product_cta_opened` (storefront CTA), `showroom_clicked` or `nudge_clicked`, which is correct. |
| **Add-to-Cart-Klicks** | `event ILIKE '%cart%' OR '%checkout%'` | Matches `add_to_cart_clicked` only. Any future event name containing "cart" or "checkout" (e.g. `cart_refreshed`, `storefront_add_to_cart`) **will be counted here**. It also marks the session as "carted" in the Gespräche inspector (`admin-conversations.ts → loadSessionSignals()`, `cartUsed`) and in the Komplettanalyse (`analytics-report-store.ts`), which use the same `CART_PATTERNS`. Name new events with this pattern in mind or adjust the pattern in `kpi-event-patterns.mjs`. |
| **Engagement** = chats ÷ `count(DISTINCT session_id)` in `kpi_events` | all session-keyed events | AD assumes "any telemetry implies the widget was opened". **That is false:** `launcher_attention_played` (and `nudge_shown`) fire without any open. The denominator is closer to "devices that loaded the widget with motion allowed" plus server sign-in events, so the ratio is a reach-based rate, not open → message. Use `chat_opened` sessions as the denominator for an open → message rate. The numerator is inflated too: a completed greeting-only turn (nudge click with context, §7.5) is persisted by `persistTurn()` in `/api/chat` `onFinish` and creates a `conversations` row (`message_count` 1) although the visitor sent nothing (§14.3). |
| **Anmelde-Popup** (AD §5.7a) | `login_gate_*`, `account_signin_started.source`, server `account_signin_succeeded/linked` per session | Matches the widget. The source split is only `login_gate` vs `other` (§13). |
| **Einwilligung nach der Anmeldung** (AD §5.7) | `consent_gate_*` with `data.surface` | Matches. It counts taps, not DOI. **2026-10-05:** per session with the final state (accepted > declined > dismissed); DOI per variant and placement in „Nach Variante und Platzierung“ once the widget sends `variant` / `placement`. |
| **E-Mail-Capture-Funnel** (AD §5.8) | server events + widget `email_capture_declined` | **2026-10-05:** capture form only (server `source`), declines deduped per session and `trigger`, DOI rate ÷ „DOI-Mail fällig“ (OI1). Declines from the header share card have no `trigger`. One stored offer can be declined again on every later page (the card is rebuilt from history, the decline is not stored), so declines can exceed asks: count distinct sessions or dedupe per `trigger`. For signed-in customers the card is hidden (`buildToolCard()`), so a server `ask_shown` may have had no visible card (§4.7). |
| **Kundenkonto & Self-Service** (AD §5.15) | server events | `contact_form_submitted` is session-keyed once `8d0a0c4` is live (body `sessionId`, §4.10). Earlier rows have session `NULL`, so a per-session contact join only works for rows after that upload. |
| **Mo-zugeordneter Umsatz** (AD §5.16) | `mo_orders` from webhooks, `_mo` attribute | Depends on §10 coverage, including the permalink question. |
| Raw event breakdown | top 20 events by count | `launcher_attention_played` and `chat_opened`/`chat_closed` will dominate. Rarer events (e.g. `summary_downloaded`) can fall off the top 20. |

### B.5 §13.4 „Ideas to raise each KPI“ (old; consolidated into `07` §7)

Effort: **S** = < ½ day widget change, no new endpoint. **M** = 1–3 days or needs a small backend addition. **L** = new UI flow and/or several backend changes.

#### Opt-in rate (marketing consent)

| Idea | What changes | Effort | Constraint |
| --- | --- | --- | --- |
| Send `askNumber` on `email_capture_declined` (allowed by AC §5) | The tool input does not carry `askNumber` today (`offer_email_summary` input is only `{message, trigger, productIds}`; the server computes `askNumber` in `/api/chat` `onFinish` and writes it only to `email_capture_ask_shown`). Either the backend adds `askNumber` to the tool input or output and the widget passes it through `buildCaptureCard` → `email_capture_declined`, or the widget counts prior `tool-offer_email_summary` parts in `messages`, which must match the server's `countEmailSummaryOffers()`. | M | Backend + widget change. |
| Variant id on consent events | Backend serves `variant` with the consent copy, and the widget adds it to `consent_gate_*` | M | Every variant must be `lawyerApproved`. **Backend built 2026-10-05** (OI3: `variant` + served `benefits`, `CONSENT_SIGNIN_VARIANTS`, dashboard block); widget part is frontend task 1. |
| Ask at a value moment instead of only after the first message | After the first `add_to_cart_clicked` or the second product card for signed-in customers, re-use `presentSignInOptIn()` (still once per tab session) | M | Same consent rules; must not stack with the popup. |
| Measure DOI completion per surface | **Done server-side 2026-10-05** (OI1: opt-ins and `_confirmed` carry `source`). Popup vs card: the backend accepts `placement` on the opt-in POST and the `consent_gate_*` data (OI3); the widget sends it with frontend task 1. | S | — |

#### Sign-in rate

| Idea | What changes | Effort | Constraint |
| --- | --- | --- | --- |
| Tag every sign-in entry | `initiateLogin('welcome_card' \| 'header' \| 'account_menu' \| 'link_failed')` (callers: `buildSignInCard()` button, header `signInBtn`, drawer `shopSignInBtn` "Mit Kundenkonto anmelden", `showLinkFailedNotice()`), and extend `SIGNIN_SOURCES` / `signinSource()` in `src/lib/kpi-widget-events.mjs` (today `login_gate` vs `other`) | S | Backend contract change (AC §5 currently defines only `login_gate`). |
| Contextual sign-in card when Mo needs the account (order questions → `get_order_status` `sign_in_required`) | A visible tool / card that calls `initiateLogin('order_status')` | M | Needs `CHAT_ORDER_STATUS_ENABLED` (still off; may be turned on now that PR #73 is live, once the backend has verified on live that `get_order_status` renders nothing). |
| Popup timing test (after the first **answered** reply or after the first product card instead of 0.7 s after send) | `maybeShowConsentGate()` scheduling | S–M | Keep "never in voice mode", once per tab session, real "Später". |
| Silent shop recognition | PR #73 is merged and live since 2026-10-04, so chat sign-in works again (pending a live check). Next: set up the Shopify App Proxy for `/apps/chat/whoami`, which turns shop-logged-in visitors into signed-in chat users with no click. Backend built 2026-10-05 (P0.3): code only when the session will be signed in, `account_shop_recognised` measures every recognition, AD §5.15 „Shop-Login-Erkennung“ shows it; every shop-logged-in visitor only with `APP_PROXY_SIGNIN_ENABLED=true` and `APP_PROXY_SIGNIN_MAX_AGE_HOURS=24` (D-AP1), otherwise only chat-token holders | Ops | Proxy setup is in Shopify admin, not theme code. First confirm that the live widget is the PR #73 version (it contains `redeemLinkCode`). Historical note: the pre-PR #73 widget (`44a076b`, `detectViaStorefront()`) applied a whoami `signedIn:true` answer directly as identity (`applyAuth(data)`) without redeeming a `linkCode`, so the proxy must never run under that widget (e.g. after a live-editor revert). |

#### Product CTR

| Idea | What changes | Effort | Constraint |
| --- | --- | --- | --- |
| Card impression events (`product_card_shown {productId, surface}`) | Builders in §13.1 | S | Ids only. |
| `surface` on `product_cta_clicked` | `productButton()` | S | The dashboard pattern still matches. |
| Larger hit area: thumbnail and name link to the product | `buildShowProduct()` | S | — |
| Track Markdown shop links (`text_link_clicked {kind:'product' \| 'page'}`) | Markdown link renderer | S | No URL text if it could hold query PII; send only the kind and the catalog id when resolvable. |
| Open product pages in the same tab on mobile (the current new tab loses the chat context visually) | `productButton()` target per device | S | Check the effect on `chat_opened` counts (re-open on the new page). |

#### Add-to-cart / checkout

| Idea | What changes | Effort | Constraint |
| --- | --- | --- | --- |
| "In den Warenkorb" next to/instead of the permalink: `POST /cart/add.js` same-origin, then `<cart-modal>` / `#CartBubble` update (the theme primitives already used in §11) | `buildAddToCart()` / `buildShowProduct()` | M | Must handle variants (`selectedVariantId`, AC §3) and sold-out. It keeps the shopper on site **and** keeps the `_mo` stamp on the live cart. |
| Listen to the theme's `product:added-to-cart` and send `storefront_add_to_cart {consulted:true}` only for consulted sessions | `init()` listener | S | Name it so the AD cart pattern counts it deliberately, or rename to avoid double counting. `detail.id` is probably a variant id (unverified). |
| Error telemetry for a failed `/api/products` fetch in the add-to-cart card (currently renders nothing) | `buildAddToCart()` `.catch` | S | — |

#### Attributed revenue

| Idea | What changes | Effort | Constraint |
| --- | --- | --- | --- |
| Carry `_mo` on the permalink: append `attributes[_mo]=<token>` to `cartUrl` on click when the token is cached and consent allows (or let `/api/products` accept a flag to embed it) | `buildAddToCart()` click handler (mint first if needed) | S (widget) / M (backend variant) | Same consent gate as the stamp. Verify first that permalinks drop live-cart attributes (§14). |
| Mark sessions as consulted on `compare_products` and `add_to_cart` render, not only `show_product` | call `moAttrOnProductCard()` in `buildCompare()` / `buildAddToCart()` | S | Consent-gated as today. |
| Re-stamp on the theme's `product:added-to-cart` | `init()` listener → `moAttrEnsure(true)` with the page-stamp guard reset | S | Consent-gated. |
| Attribution coverage flag (`attribution_state {consent: bool, stamped: bool}` once per tab session) | `initAttribution()` | S | Itself analytics. Gate it or get legal approval (§13.3). |

#### Campaign chats

| Idea | What changes | Effort | Constraint |
| --- | --- | --- | --- |
| `deeplink_opened {campaign: bool, fresh: bool, fullscreen: bool}` | `handleMoDeepLink()` | S | Never the token itself. |
| Campaign-aware greeting: when `mo=open` and a token is present, send a context greeting (`messages: []`) with a new `context.type:'campaign'` | `handleMoDeepLink()` + backend context type | M | Then every landing becomes a "campaign chat". Redefine the KPI honestly (greeting ≠ visitor message). |
| Keep the token until the first message even across a tab close (currently sessionStorage only) | storage choice | S | Privacy decision: the current design deliberately limits the token's lifetime. |

#### Engagement and retention

| Idea | What changes | Effort | Constraint |
| --- | --- | --- | --- |
| `chat_opened {source, returning}` | `openPanel()` callers | S | `returning` derived locally (history exists). |
| Mobile nudge on home/collection via scroll or dwell (today home never nudges on mobile) | `initNudgeTriggers()` | S | Keep once per tab session and the permanent ×. |
| Reword the behaviour-referencing streak copy | `nudgeCopy()` | S | Tone rule. |
| Returning anonymous visitor with a stored thread: launcher badge or nudge copy "Weiter mit deiner Beratung" | `nudgeCopy()` / launcher | S–M | Local only, with no behaviour reference beyond "your consultation". |
| Visit-level KPI: a once-per-tab-session `widget_loaded {pageType, device}` | `init()` | S | Interaction-free → legal check (§13.3). Also affects the AD "Engagement" denominator. |

### B.6 §14 question 8 (old)

8. **Live theme state:** this chapter documents `main` at `8d0a0c4`. PR #73 was uploaded on 2026-10-04 (widget JS/CSS and `layout/theme.liquid`); the `8d0a0c4` fixes (widget JS, `snippets/ms-chat-widget.liquid`, three product templates) are not uploaded yet. The live theme can also differ through live-editor drift. The "MO only" blocks, the CTA in `product.produktdesign-02.json` and the head stash script in `layout/theme.liquid` are all in files the live editor can change. Whether the PR #73 upload really runs on live still needs one real sign-in check by the backend.

---

## C. Chapter 06 — commerce and storefront integration

### C.1 Header state line (old)

Code locations are given as `file → function / selector / key`. Line numbers are left out on purpose because they drift. The repo state described is `main` at `8d0a0c4`: PR #73 (`a0df103`, merged, **live since 2026-10-04**) plus five follow-up fixes that are **not uploaded yet** (owner upload pending: `assets/ms-chat-widget.js`, `snippets/ms-chat-widget.liquid`, `templates/product.produkt-new.json`, `product.produktnew.json`, `product.produkte-im-set.json`). The live theme may differ (see §17).

### C.2 §1 status cells (old)

| 2 | Product-page CTA "Detaillierte Beratung zu diesem Produkt" | shop → widget | `<button class="ms-chat-product-cta" data-…>` + delegated click handler | `templates/product.json → custom_liquid_AErEyg` ("MO only"); `ms-chat-widget.js → bindProductCtas() / openWithProduct()` | repo: on every product template since `8d0a0c4`; live: `product.json` and `product.produktdesign-02.json` until the three new template files are uploaded (§3.7) |
| 8 | Shop login recognition | shop → backend → widget | Same-origin `GET /apps/chat/whoami?session=` through a Shopify App Proxy | `ms-chat-widget.js → detectViaStorefront()` | **App Proxy not set up** (silent no-op). May now be set up, since PR #73 is live (2026-10-04); confirm live runs the PR #73 widget first (§9.1) |
| 12 | Campaign / deep links into an open chat | shop URL → widget | `?mo=open`, `#mo-open`, `mo_new`, `mo_view`, `mo_c` | `layout/theme.liquid` head script; `ms-chat-widget.js → handleMoDeepLink()`, `captureCampaignToken()` | live (`mo_c` since the PR #73 upload of 2026-10-04) |

### C.3 §9 order-status paragraph (old)

Order status (`get_order_status`) works only for sessions signed in via „Anmelden“ (`link_kind = customer_account`). A shop-recognised session gets `sign_in_required`; the widget keeps „Mit Kundenkonto anmelden“ in the account menu for that case (`updateShopSignInBtn()`). Backend switch `CHAT_ORDER_STATUS_ENABLED` is still **off**. PR #73 (silent `get_order_status` rendering, history wipe on sign-out) is merged and live since 2026-10-04, so the switch may now be turned on once the backend has verified on live that a `get_order_status` part renders nothing. The same upload made chat sign-in work again on live (pending a real check).

### C.4 §9.1 „App Proxy status and setup“ (old; operator steps now in `docs/ROLLOUT_TODO.md` 5.4 / 5.4b)

- **Today**: not configured. `/apps/chat/whoami` returns Shopify's HTML 404 page. The widget rejects it (`!r.ok`, or a content type without `application/json`) and silently continues anonymously. Side effect: each tab session downloads that 404 page once on the first panel open in that tab (including tabs opened from Mo's product links), and the sign-in affordance appears only after that round trip.
- **Precondition met, confirm before enabling**: PR #73 is merged and was uploaded to the live theme on 2026-10-04, so the App Proxy **may now be set up**. First confirm that the live `assets/ms-chat-widget.js` is the PR #73 version (it contains `redeemLinkCode`), because the live editor has reverted widget files before. Historical note: the pre-PR #73 widget (`44a076b` → `detectViaStorefront(force)`) applied a whoami `signedIn:true` answer directly as identity (`applyAuth(data)`) without redeeming `linkCode`; with a proxy under that widget, visitors would have seen a signed-in UI whose `/api/account/*` calls return 401. Same rule in `01-storefront-theme.md` (App Proxy row) and `07`.
- **Setup** (`CUSTOMER_ACCOUNT.md §2`, `ROLLOUT_TODO.md 5.4`; after the confirmation above): add an App Proxy to the app (`shopify.app.toml` `[app_proxy]`: `url = "https://mo.motionsports.de/api/auth/storefront"`, `subpath = "chat"`, `prefix = "apps"`, then `shopify app deploy`). Set `SHOPIFY_APP_PROXY_SECRET` (falls back to `SHOPIFY_CLIENT_SECRET`). Since 2026-10-05 (P0.3) whoami answers `{"signedIn":false}` until the backend switches are on (`APP_PROXY_SIGNIN_ENABLED`, `APP_PROXY_SIGNIN_MAX_AGE_HOURS`; recommended `true` / `24`, D-AP1), so verify the setup with the manual check instead: open `https://www.motionsports.de/apps/chat/whoami?session=livecheck-manual` while logged in to the shop and look for its `account_shop_recognised` row (`npm run verify:live` section 8). A row means `logged_in_customer_id` is populated for this store's account mode; then set the switches.
- **No theme change needed**: the path default is `CFG.whoamiPath || '/apps/chat/whoami'`. The snippet does not set `whoamiPath`, so a different proxy path would need a snippet change.

### C.5 §16 intro and task table (old)

Findings (code facts; F9 and T8 were addressed in `8d0a0c4`, which is merged but not uploaded to live yet; the rest is unchanged):

Suggested frontend tasks (each needs a `MANIFEST.md` entry and a manual upload; owner decisions marked):

| Id | Task | Touches | KPI target |
|---|---|---|---|
| T1 | On „Zur Kasse“ click, if consent allows and a token is cached, append `cartAttributes` as `attributes[<key>]=<value>` plus `ref=mo` to the permalink (mirror of the backend `withCartAttribution()`); mint eagerly when the add-to-cart card renders | `buildAddToCart()`, `moAttrOnProductCard()` | attributed revenue |
| T2 | Treat compare / showroom / add-to-cart card renders as "consulted" | `buildCompare`, `buildShowroom`, `buildAddToCart` | attributed revenue |
| T3 | On a PDP, attach `PAGE_CTX` product context to the **first** user message of a fresh conversation | `sendMessage()` / `startStream()` | answer quality, product clicks |
| T4 | Read the selected variant (`?variant=` / variant picker change) into `pageContext`/context as `handle~variantId`; deep-link "Zum Produkt" with `?variant=` for variant refs. For variant-level KPIs the widget must send `selectedVariantId` (or the requested ref) explicitly, because the response `id` is always the handle | snippet, `PAGE_CTX`, `productButton()`, `track()` calls | add-to-cart, measurement |
| T5 | Listen to `product:added-to-cart`: re-stamp (consent-gated) and send a KPI event (name it with the §14 patterns in mind). `detail.id` is the numeric variant id (§12), so a catalog ref needs a variant → handle lookup | widget JS | attribution, measurement |
| T6 | `/en`: rewrite `shopifyUrl`/showroom to the `/en` path (or have the backend localise `shopifyUrl` via a param); translate the CTA label (`| t` key) | widget JS, `product.json` (editor-owned) | EN conversion |
| T7 | Track Markdown link clicks to product URLs as `product_cta_clicked` (with a `source`) | `appendInline()` | measurement |
| T8 | **Done in `8d0a0c4`** (upload pending): the "MO only" block is now on `product.produkt-new`, `product.produktnew` and `product.produkte-im-set` (§3.7). After the upload, verify the block in the live editor, because these templates are editor-owned | product templates (editor-owned) | CTA opens |
| T9 | A "Frage nicht dabei? Frag Mo" link at the end of the Q&A tab using the CTA contract | `product-qa.liquid` | CTA opens, Q&A loop |
| T10 | Use one id space in KPIs (send the handle in `product_cta_opened`, keep the numeric id as an extra field) | `openWithProduct()` | measurement |

### C.6 §17 question 9 (old)

9. **Live parity**: the live theme may differ from this repo (editor changes since the last snapshot). PR #73 was uploaded on 2026-10-04 (`assets/ms-chat-widget.js`, `assets/ms-chat-widget.css`, `layout/theme.liquid`, together with `snippets/product-qa.liquid`, `sections/header.liquid` and `snippets/product-detail-accordions.liquid` from the 2026-10-01 round); a real sign-in check on live by the backend is still pending. Everything marked `8d0a0c4` (CTA hiding, CTA on three more templates, contact-form `sessionId`, stream cancel on thread switch) is **not live yet** until the owner uploads `assets/ms-chat-widget.js`, `snippets/ms-chat-widget.liquid` and the three product templates.

---

## D. Chapter 07 — feature and KPI playbook

### D.1 Header basis line (old)

> **Basis:** chapters 01–06 of this folder (theme repo `ms_shopify_clone`, `main` at `8d0a0c4` = merged PR #73 `a0df103` + five fixes; live runs PR #73 since the owner's upload on 2026-10-04, `8d0a0c4` is not uploaded yet), the backend's `docs/frontend/API_CONTRACT.md` (**AC §n**) and `docs/frontend-handoff/*.md` (**CA** = `CUSTOMER_ACCOUNT.md`, **CF** = `CONSENT_FLOW.md`, **COS** = `CHAT_ORDER_STATUS.md`, **FP** = `FRONTEND_PROMPT_2026-10.md`), and the widget test logs of the PR #73 session. Code locations are `file → function / key`; line numbers are left out on purpose.

### D.2 §1 rows (old)

| **PR #73 is live (uploaded 2026-10-04); `8d0a0c4` is not.** | Sign-in, the consent popup, history, export, erase and `mo_c` should work on live again, but a real live check by the backend is still pending (§6.3, §6.4). Until the owner uploads `8d0a0c4`, live lacks its five fixes (stream abort on new chat, `sessionId` in the contact body, `order_support` label, hidden CTA where Mo does not mount, CTA on three more templates). Plan against the PR #73 build. | `04` §16, README §4 |
| **App Proxy not set up yet.** It may be set up now (P0.3): PR #73 is live; confirm the live build with §6.4 first. | No silent shop-login recognition until then. Historical: the pre-PR #73 widget (`44a076b`) took a whoami `signedIn:true` answer as identity in `detectViaStorefront()` without redeeming `linkCode`, so the proxy had to wait for PR #73; if drift ever brings that build back, the proxy becomes unsafe again (P0.3). Each widget build pays Shopify 404 page fetches for `/apps/chat/whoami` before sign-in affordances appear. PR #73: one fetch per tab session, on the first open (`sessionStorage['ms-chat-whoami-done']`, set before the call, `detectViaStorefront()`). Pre-PR #73 widget (`44a076b`): one fetch per page load on the first open (in-memory `storefrontDetectDone`), plus one per forced re-detect (`detectSignedIn(true)` on a later open, or when the tab becomes visible while the panel is open and the visitor is not signed in). | `04` §5.4 |

### D.3 §2.2 rows removed or rewritten (old)

| Fix `contact_form_submitted` having no session | **Done in the widget** (`8d0a0c4`, not uploaded yet) | `buildContactForm()` now sends `sessionId: sid` in the `POST /api/contact` body (`03` §20.1) | Nothing after the upload. Optional hardening: let `src/app/api/contact/route.ts` fall back to the `x-ms-session` header for tabs still on the PR #73 build. |
| Fix the dashboard "Engagement" ratio | **Backend-only** | Denominator choice in `src/lib/kpi-store.ts` (`05` §12) | Use sessions with `chat_opened` as the denominator. |
| Silent shop-login recognition | **Ops** | App Proxy config + `shopify app deploy` (`06` §9.1) | No theme change. **Actionable now:** PR #73 is live; confirm the live build with §6.4 first. PR #73 redeems the `linkCode` before it treats the visitor as signed in. Historical: the pre-PR #73 widget (`44a076b`) also called `/apps/chat/whoami`, but its `detectViaStorefront()` applied a `signedIn:true` answer directly as identity without redeeming `linkCode`, which is why this waited (see P0.3). **Backend built 2026-10-05:** whoami issues a code only when the session will really be signed in (fresh signature, handover, a proof); the owner sets `APP_PROXY_SIGNIN_ENABLED=true` and `APP_PROXY_SIGNIN_MAX_AGE_HOURS=24` (D-AP1) after configuring the proxy. |
| More PDPs with a CTA | **Ops** (upload) | `8d0a0c4` adds the "MO only" block to the three CTA-less templates, so all five product templates carry a CTA (`06` §3.7) | Upload the three template files (or add the block in the theme editor), then re-sync. |

### D.4 §5 rule 3, last paragraph (old)

`CHAT_ORDER_STATUS_ENABLED` is the model: off until the PR #73 widget is confirmed live (COS "No-op if you ship later"). PR #73 was uploaded on 2026-10-04, so the switch is now at step 4: flip it once the backend has verified on live that `get_order_status` renders nothing (§6.3 "Tools").

### D.5 §6.4 note and hand-written fingerprint table (old; superseded by the table regenerated from `src/lib/widget-fingerprint.mjs`)

> **Backend (2026-10-04):** `npm run verify:widget` in the backend repo does this check (fetch the storefront, find the asset, count markers, classify — `src/lib/widget-fingerprint.mjs`), plus the head script, the `/cart` style and the App Proxy answer. Shopify may serve ES5 theme JS **minified** (comments and whitespace gone, local function names possibly mangled), so the function-name markers in the table above can be absent on live; the backend uses string literals that survive minification instead — `/api/auth/link`, `ms_mo_c`, `ms-chat-whoami-done` (PR #73), `order_support`, `Bestellnummer + kurz` (8d0a0c4), `ms-chat-login-gate-snooze` (popup builds), `ms-chat-mkt-decision`, `ms-mo-attr`, `starter_shown` — tested on `3e87341`, `8d0a0c4`, `a0df103`, `44a076b`, `4dbc625`, `beff918`, `e4b12f1`, `f7dc50a` raw and after terser. `3e87341` differs from `8d0a0c4` only by two `endSpeaking()` calls (10 instead of 8): visible while names are unmangled, otherwise reported as „8d0a0c4 oder main 3e87341“.

`ms-chat-widget.js` has no version constant or version header (§1, §5 rule 2). Identify the live build by searching the **live** asset: view-source of any storefront page → the `ms-chat-widget.js` URL that `snippets/ms-chat-widget.liquid` emits via `asset_url` → search for these markers (marker counts checked against each commit's `assets/ms-chat-widget.js`):

| Markers in the live JS | Build | Consequence |
| --- | --- | --- |
| PR #73 markers below **plus** `order_support` (3 occurrences; 0 in `a0df103`) and `Bestellnummer + kurz` present; `sessionId: sid` occurs 3 times (2 in `a0df103`, the new one is in the `buildContactForm()` payload); `abortActiveStream()` called 3 times (1 in `a0df103`) | `main` `8d0a0c4` (MANIFEST 2026-10-04 b; **not uploaded yet**) | All five fixes are live once the snippet and templates are uploaded too: check that view-source of `/cart` contains `.ms-chat-product-advisor, .ms-chat-product-cta { display: none !important; }` (snippet) and that a `product.produkt-new` / `produktnew` / `produkte-im-set` PDP shows the CTA (templates). |
| `redeemLinkCode`, `captureCampaignToken` and `ms-chat-early-params` present, `order_support` absent | PR #73 (MANIFEST 2026-10-04, `a0df103`) — **expected live build** since the owner's upload on 2026-10-04 | Sign-in, `mo_c`, App Proxy redeem work. The App Proxy may be set up and `CHAT_ORDER_STATUS_ENABLED` flipped after the live checks (P0.1, P0.3). The `8d0a0c4` fixes are not in effect. |
| `presentLoginGate` present, `redeemLinkCode` absent | 2026-10-01 (`4dbc625` / `44a076b`) | Should no longer be live after the 2026-10-04 upload; if it shows up, the upload did not land or drift reverted it. Sign-in cannot complete since the one-time code (2026-10-03); `mo_c` ignored; whoami answer applied without redeem, so the App Proxy must be off while this build is live (P0.3). |
| `moStampCart` and `handleMoDeepLink` present, `presentLoginGate` absent | 2026-10-01 restore (`beff918`, before the popup work) | No first-message popup. |
| `moStampCart` and `starter_shown` present, `handleMoDeepLink` absent | 2026-08-12 attribution build on the drifted base (`e4b12f1`) | The drift case: starters back, no `?mo=open`, PR #67 consent gate missing. |
| `moStampCart` / `ms-mo-attr` absent | older than 2026-08-12 | No `_mo` cart stamp. If `starter_shown` is present too: the Aug 12 live snapshot (`f7dc50a`) or a pre-2026-07-27 build. |

### D.6 §7 P0 block (old)

> **Backend status (2026-10-04):** P0.4's optional hardening (`x-ms-session` fallback in `/api/contact`) and P0.6 (engagement denominator) are done in the backend; P0.1's live checks are scripted (`npm run verify:widget`, `npm run verify:live`) and order status can be checked with one test account before the switch (`CHAT_ORDER_STATUS_TEST_CUSTOMERS`).

| # | Item | KPI | Backend work | Frontend work | Effort | Legal / notes | Refs |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P0.1 | ~~**Merge and upload PR #73**~~ **Done 2026-10-04** (merged; owner uploaded `ms-chat-widget.js`, `.css`, `layout/theme.liquid`). **Remaining:** verify live, then flip `CHAT_ORDER_STATUS_ENABLED` | sign-ins, opt-ins (consent popup), campaign chats (`mo_c`), order-status answers | Live check: fingerprint (§6.4), sign-in round trip, „Im Chat angemeldet“ fills, campaign token (§6.3). Then, with a test account, confirm `get_order_status` renders nothing and Mo answers in text, and flip the switch | none (drift check after the upload, `01` §16) | Ops S | Confirm the live `layout/theme.liquid` has the head script; without it `ms_code`/`mo_c` reach Shopify analytics URLs | `04` §16, README §4 |
| P0.2 | **Test order through "Zur Kasse"** to see whether the permalink checkout keeps `_mo` | attributed revenue (decides A2) | Inspect `note_attributes` on the order; webhook tier | none | Ops S | — | `05` §14.1, `06` §17.1 |
| P0.3 | **Set up the App Proxy** `/apps/chat/whoami` — **backend built 2026-10-05** (Phase 1 + 2: fresh signature, handover, code only with a proof, stamp guard, `account_shop_recognised`, shop proof under D-AP1, anti-nag, dashboard block); **remaining:** owner setup in Shopify, then the switches | sign-ins (shop-logged-in visitors become tier 3 with no click), first-open latency | `shopify.app.toml [app_proxy]`, `SHOPIFY_APP_PROXY_SECRET`, verify `logged_in_customer_id` for this store's account type with the manual whoami check (§8); then `APP_PROXY_SIGNIN_ENABLED=true`, `APP_PROXY_SIGNIN_MAX_AGE_HOURS=24`. Kill switch: `APP_PROXY_SIGNIN_ENABLED=false` + redeploy | none (already in PR #73, live) | Ops S–M | **Actionable now** (PR #73 uploaded 2026-10-04). First confirm with §6.4 that the live JS really is the PR #73 build (`redeemLinkCode` present). Historical reason for the wait: the pre-PR #73 widget (`44a076b`) also called `/apps/chat/whoami`, but its `detectViaStorefront()` applied a `signedIn:true` answer as identity (`applyAuth(data)`) without redeeming `linkCode`. With the proxy on and that build live, visitors would see a signed-in name, a consent popup driven by `marketing.optInActionable`, and history/export/erase calls failing with 401 (backend `src/app/api/auth/storefront/route.ts`: until the code is redeemed the session has no history, export or signed-in chat context). Re-check after any re-sync that could bring that build back. D-AP1 decided by the owner 05.10.2026, lawyer confirmed (dossier §19, F-36). Classic vs new customer accounts: answered by the manual whoami check (§8) | `06` §9.1, `04` §5.4, §17 |
| P0.4 | ~~**`contact_form_submitted` session join**~~ **Done in the widget** (`8d0a0c4`: `buildContactForm()` sends `sessionId: sid` in the body); live after P0.7 | measurement (contact funnel, order-support) | Optional hardening: fall back to `x-ms-session` in `src/app/api/contact/route.ts` for tabs still on the PR #73 build | none | — | — | `03` §20.1 |
| P0.5 | ~~**Abort the stream on new chat / open conversation**~~ **Done** (`8d0a0c4`: `startNewChat()` and `openConversation()` call `abortActiveStream()` + `removeTyping()` first); live after P0.7 | data integrity of signed-in threads | none | none | — | Until the upload, order data could still land in the wrong local thread on live | `02` §21.1, `04` §18.1 |
| P0.6 | **Fix the dashboard "Engagement" denominator** | measurement | Use sessions with `chat_opened`; show reach separately. The numerator is inflated too: a greeting-only turn (nudge click with context, `messages: []`) creates a `conversations` row via `persistTurn()` although the visitor sent nothing (`05` §14.3), so count "visitor wrote" with `message_sent` sessions | none | S | — | `05` §12, §14.3 |
| P0.7 | **Upload `8d0a0c4`** and verify (owner will upload) | measurement (contact session join), order-support conversion, data integrity, CTA opens on three more templates | Then check the `8d0a0c4` fingerprint row (§6.4) and the contact-form check (§6.3) | Upload `assets/ms-chat-widget.js`, `snippets/ms-chat-widget.liquid`, `templates/product.produkt-new.json`, `product.produktnew.json`, `product.produkte-im-set.json` (MANIFEST 2026-10-04 b); drift check and re-sync (templates are editor-owned) | Ops S | — | README §4 |

### D.7 §7 rows moved to „Done“ or rewritten (old)

| C1 | ~~`order_support` labels from `CONTACT_FORM_ORDER_SUPPORT.md`~~ **Done** (`8d0a0c4`: `REASON_LABELS.order_support` „Kontakt zum motion sports Team“ + subline, placeholder „Bestellnummer + kurz dein Anliegen…“, EN overlay; organisation optional); live after P0.7 | order-support conversion | none | none | — | Prefer uploading `8d0a0c4` (P0.7) before flipping `CHAT_ORDER_STATUS_ENABLED`, so order-support escalations show the right label | `03` §8.5 |
| E3 | Per-customer marketing-decline memory (server records declines, reflected in `optInActionable`) | opt-ins on shared devices | Backend-only plus widget keeps working; CA §6.1 records no decline today | `04` §17 |
| D4 | `/en` conversion: localised `shopifyUrl`/showroom, CTA label key, voice `lang` from `LOCALE`, gate `/en` consent on `enLegalReviewed` | EN conversion, opt-ins (EN) | `shopifyUrl` per locale (needs a request param or a second field) | `productButton()`, `startVoice()`, consent renderers; `product.json` label (editor-owned) | M | English consent copy is not legally reviewed | `06` T6, `03` §17 |
| E6 | Widget version header (`x-ms-widget-version`) | safer rollouts | Widget S; backend logs it. Replaces the manual fingerprint check of §6.4 | §5 rule 2, §6.4 |

### D.8 §7 P2 status note (old)

> **Backend status (2026-10-05):** **OI3** (consent-popup framing) — backend built: `surface=signin` serves `benefits` (three bullets, owner decision D-AP4) and `variant`, `CONSENT_SIGNIN_VARIANTS` (default `a`) for a later framing test, `placement` / `variant` on the opt-in POST and in the `consent_gate_*` data, dashboard block „Nach Variante und Platzierung“; widget part = frontend task 1 (prerequisite for D6/D7 variants and placement `value_moment`). **OI1** (honest opt-in measurement) — backend built: opt-ins carry `source` / `outcome`, DOI confirmations `source`, consent section per session, capture funnel = form only, F2 (no „already subscribed“ for a suppressed address); judge D6/D7 on „Opt-ins (Server)“ and the DOI-Quote per variant (AD §5.7). D11: since OI1 PR 1 (2026-10-05) the server no longer creates new summary offers for a live signed-in session; only restored parts remain.

### D.9 §8 last row (old)

| Is the live theme identical to `main` after upload? PR #73 was uploaded on 2026-10-04 (not yet checked on live); `8d0a0c4` is pending | Every plan; the App Proxy (P0.3) and `CHAT_ORDER_STATUS_ENABLED` (P0.1) | Fingerprint (§6.4) and diff after each upload (§6.3) |
