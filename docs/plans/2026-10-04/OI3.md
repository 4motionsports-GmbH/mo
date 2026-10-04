# Frontend task: serve the consent-popup benefits from the backend and add variant/placement to the signed-in ask (2026-10-04)

Paste this into the frontend agent that owns `ms_shopify_clone`. Attach these files, in the versions updated by the backend PR in "Backend counterpart" below:
- `docs/API_CONTRACT.md`. This is the canonical contract and the only place AC §5 and AC §7.4 live. `docs/frontend-handoff/API_CONTRACT.md` is only a pointer plus an "Additive changes" table. You may attach it too, for that table.
- `docs/frontend-handoff/CONSENT_FLOW.md`
- `docs/frontend-handoff/CUSTOMER_ACCOUNT.md`
- `docs/frontend-handoff/FRONTEND_PROMPT_2026-10.md`, for its "Rules that do not change"
- `docs/frontend-handoff/LOCALE.md`

If this prompt and the attached files disagree, the attached files win.

Some references below are marked "(background: `docs/frontend/0N` §…)". They point to the backend's code-verified description of your widget. Those chapters are **not attached**. Every fact this task needs from them is written out here. In your own repo, the code is the source of truth.

## Baseline
This task builds on widget `main` at `3e87341` (MANIFEST 2026-10-04 b), live since 2026-10-04. How it behaves today:

- **Consent popup.** `ms-chat-widget.js → presentConsentGate()` renders these items in order:
  1. the served `headline`;
  2. two **widget-authored** bullets from `GATE_COPY.benefits` in `.ms-chat-gate-benefits`: „Persönliche Empfehlungen, passend zu deiner Beratung“ and „Exklusive Angebote & Rabattaktionen zuerst erfahren“. `GATE_COPY` also has an English `Object.assign` overlay with EN bullets;
  3. the served `marketingLabel`, the served `consentFooter`, and the Impressum / Datenschutz links;
  4. the buttons „Ja, Angebote aktivieren“ / „Nein, danke“.

  The bullets break two rules. FP "Rules that do not change" says "the consent popup's text may not" live in the widget. CF §1 allows benefit framing only in served copy. (background: `docs/frontend/04` §10.2, §11, §18 item 17)
- **Inline card.** `presentSignInOptIn() → buildMarketingOptInCard()` shows the served headline, label and footer. It has no bullets.
- **KPI events.** Both surfaces send `consent_gate_shown/_accepted/_declined{/_dismissed} {surface:'signin'}`. No variant, no placement.
- **Copy cache.** `fetchSignInConsentCopy()` keeps the served copy in memory for 60 s (`signInConsentCache` plus an in-flight promise). The cache is keyed by time only, not by sid.
- **Late opt-in answer.** The opt-in POST has no stale guard. A 2xx that arrives after a sign-out or a sid rotation still sends `consent_gate_accepted`, because `track()` reads the current `sid`. (background: `docs/frontend/04` §8)
- **Dismiss during an accept.** The popup's `onDefer` handler (Esc / backdrop) stays bound for the whole life of the dialog. Closing the success view, or closing while the accept POST is in flight, therefore sends `consent_gate_dismissed`. The late POST handlers keep running on a detached card. A late 422 still closes the dialog and calls `openCaptureForm()`. (background: `docs/frontend/04` §10.2, §18 item 15)

## Goal and KPI
**What changes for the shopper:**
- The consent popup still shows benefit bullets. They now come from the backend, lawyer-approved, instead of from the widget.
- The inline card shows the same served bullets under its headline.
- If the backend serves no bullets, none are shown. The widget never falls back to its own text. On `/en` the backend serves no bullets until the English legal review, so the current EN overlay bullets disappear with this upload.

**What changes for measurement:** every signed-in ask carries a served `variant` id and a `placement`. The backend can then test headline and bullet variants with a backend deploy only, with no theme upload.

**KPIs:**
1. **Accept rate** of the signed-in ask, per variant and placement. Formula: sessions with `consent_gate_shown` **and** `consent_gate_accepted` ÷ sessions with `consent_gate_shown`. Accepts with no `shown` in the same session, variant and placement are reported separately as a diagnostic („akzeptiert ohne Anzeige“).
2. **DOI-confirmed opt-ins** per variant. The server event `email_capture_marketing_opted_in {trigger:'signin_optin', variant}` is joined by session to `email_capture_marketing_confirmed`.
   - „bereits angemeldet“ counts opt-ins the server answered with `alreadyConfirmed:true`.
   - The DOI-Quote counts only opt-ins that required a DOI mail.
3. **Compliance.** No consent-popup text is left in the widget. This protects the main signed-in opt-in surface, whose volume grows with the App Proxy.

**Dashboard:** KPI tab → „Einwilligung nach der Anmeldung (Marketing-Opt-in)“ → new block „Nach Variante und Platzierung“. For each variant × placement it shows: Sitzungen angezeigt → akzeptiert → Opt-ins (Server) → DOI bestätigt.

## Contract references
- **CF §1**, golden rules. Benefit framing is allowed only in served copy: `headline`, and from now on `benefits`. No countdowns, no urgency, no discount amounts.
- **CF §3.1**, `GET /api/consent-copy?surface=signin`: new optional fields `benefits` and `variant`.
- **CF §3.2** and **CA §6.1**, `POST /api/account/marketing-opt-in`: new optional body fields `placement` and `variant`.
- **AC §7.4** (in `docs/API_CONTRACT.md`): the consent-copy payload, and the `Cache-Control` rule while more than one variant runs.
- **AC §5**: `consent_gate_*` data is `{surface, placement?, variant?}`. The server-only table is unchanged.
- **FP "Rules that do not change".**
- Background for the backend, not attached: `docs/frontend/07` §5 rule 1 (additive only), rule 4 (no-op if the widget ships later) and rule 7 (the signin required keys stay `marketingLabel`, `consentTextShown` and `lawyerApproved === true`).

## Backend state
Deployed before this task is sent (Backend counterpart, B1):

**`GET /api/consent-copy?surface=signin&locale=de|en`** additionally returns `"variant"` and `"benefits": [...]`.
- **DE:** `benefits` is `[]` until the lawyer signs off on the bullets. After sign-off it holds the approved strings (planned: today's two bullets, verbatim). From then on `version` is `v5`. The widget ignores `version`.
- **EN:** `benefits` stays `[]` until the English legal review (`CONSENT_COPY_EN_LEGAL_REVIEWED`).
- All other keys are unchanged. `consentTextShown` is still label + footer.

**`POST /api/account/marketing-opt-in`** accepts optional `placement` and `variant`.
- Unknown or invalid values are ignored, never answered with a 400.
- Both values are copied into the server events `email_capture_submitted` and `email_capture_marketing_opted_in` `{trigger:'signin_optin', placement, variant}`.
- The server also adds `alreadyConfirmed` and `doiRequired` (booleans) to those server-only events. The widget sends neither.

**Switches:**
- `CONSENT_SIGNIN_VARIANTS=a` (default). Only variant `a` is served, nothing is bucketed by sid, and `Cache-Control` stays `public, max-age=60, stale-while-revalidate=300`.
  - It may move to e.g. `a,b` only after three things: this upload is verified on live, a second variant is lawyer-approved, and the lawyer has answered the open questions in "Legal constraints".
  - While more than one variant is active, the endpoint answers `Cache-Control: private, no-store`.
- `CONSENT_SIGNIN_EN_GATE=false` (default, today's behaviour). See "Legal constraints".

**No-op if the widget ships later.** The live `3e87341` widget ignores the extra keys and keeps rendering its own bullets. It sends no `placement` or `variant`, and the backend records nothing extra.

**If the widget ships first.** Both of these states are compliant:
- *Before B1 is deployed:* popup and card render without bullets. KPI events and the POST carry no `variant`; `placement` is sent and ignored.
- *After B1 but before the lawyer's sign-off:* popup and card render without bullets, because `benefits: []`. `variant:'a'` is echoed in the KPI events and the POST.

## Rules that do not change
- Consent text comes only from `GET {BASE_URL}/api/consent-copy`. Never hard-code it. This now includes the popup's benefit bullets.
- Render `marketingLabel` and `consentFooter` fully visible. Nothing is pre-selected. Decline is as easy to reach as accept.
- Echo `consentTextShown` verbatim in the POST. Never compose it client-side.
- The marketing POST fires only on the explicit accept tap (`marketingConsent: true`).
- Popup and card render nothing unless the served copy has `lawyerApproved === true`, `marketingLabel` and `consentTextShown`. Fail closed, silently.
- Render served strings with `textContent` only. Never apply `L()` to served copy.
- KPI events carry ids and enums only: no message text, names, e-mails, product names, URLs, tokens or codes.
- The widget never sends server-only events. These are the AC §5 server table:
  - `marketing_email_clicked`, `campaign_email_clicked`, `campaign_chat_started`
  - `bundle_offer_clicked`, `contact_form_submitted`
  - `account_signin_succeeded`, `account_signin_linked`, `account_signin_link_refused`
  - `account_export_requested`, `account_erased`, `order_status_lookup`
  - `email_capture_ask_shown`, `_submitted`, `_marketing_opted_in`, `_marketing_confirmed`
- Every backend call keeps today's headers. **Do not add a request header.** The backend's CORS allow-list is exactly `Content-Type, x-ms-chat-key, x-ms-session, x-ms-locale`. So `variant` and `placement` travel only in the JSON body and in KPI `data`. Do not change the `fetch` cache mode of the consent-copy GET either.
- The sign-in (login) popup is UI chrome. Its `ACCOUNT_COPY` bullets stay in the widget, and this task does not touch them.

## Tasks (in order)

### 1. Render the served `benefits` and delete `GATE_COPY.benefits` (required: compliance, do it first)

**Where**
- The popup: `ms-chat-widget.js → presentConsentGate()`. The inline card: `buildMarketingOptInCard()`, in its form render.
- Delete the `benefits` key from `GATE_COPY`, in the German object **and** in the EN `Object.assign` overlay. Before deleting, grep that nothing else reads it. The login popup uses `ACCOUNT_COPY`.
- The card's list gets the class `ms-chat-optin-benefits`. Write it as one complete string literal in the JS, e.g. `ul.className = 'ms-chat-optin-benefits'`, never concatenated. The backend fingerprint looks for exactly this string.
- CSS: add a `.ms-chat-optin-benefits` rule to `assets/ms-chat-widget.css`, matching `.ms-chat-gate-benefits`. Use theme tokens only.

**Trigger and timing:** unchanged.
- The popup is decided 0.7 s after a send (`maybeShowConsentGate()`).
- The card appears after a chat sign-in return (`handleAuthReturn()` → `presentSignInOptIn()`).

**Request:** unchanged. `GET {BASE_URL}/api/consent-copy?surface=signin&locale=<de|en>`, with only the header `x-ms-session: <sid>`.

**Response (200),** DE after the lawyer's sign-off:
```json
{
  "version": "v5",
  "locale": "de",
  "variant": "a",
  "headline": "Persönliche Angebote und exklusive Rabatt-Aktionen — direkt an deine hinterlegte E-Mail-Adresse.",
  "benefits": [
    "Persönliche Empfehlungen, passend zu deiner Beratung",
    "Exklusive Angebote & Rabattaktionen zuerst erfahren"
  ],
  "marketingLabel": "Ja, schickt mir an meine hinterlegte E-Mail-Adresse exklusive Angebote und Aktionen — nur für Abonnenten. Jederzeit abbestellbar.",
  "consentFooter": "Verarbeitung durch motion sports gemäß Datenschutzerklärung; Widerruf jederzeit möglich.",
  "consentTextShown": "Ja, schickt mir an meine hinterlegte E-Mail-Adresse exklusive Angebote und Aktionen — nur für Abonnenten. Jederzeit abbestellbar. | Verarbeitung durch motion sports gemäß Datenschutzerklärung; Widerruf jederzeit möglich.",
  "imprintUrl": "https://motionsports.de/pages/impressum",
  "privacyUrl": "https://motionsports.de/policies/privacy-policy",
  "lawyerApproved": true,
  "enLegalReviewed": true
}
```
Until the sign-off the response has `"version": "v4"` and `"benefits": []`. For `locale=en`, `benefits` is `[]` until the English legal review.

**Validation of `benefits`: all or nothing**
- Render a list only if all of these hold: `Array.isArray(copy.benefits)`; it has 1–4 items; every item is a string that is non-empty after trim and at most 200 characters.
- Otherwise render **no** list. That covers a missing key, `[]`, more than 4 items, or any bad item. Never render a subset, and never fall back to widget text.
- `benefits` is **not** a required key. A missing or invalid value never hides the popup or the card.

**Rendering**
- Popup, in order: headline → `<ul class="ms-chat-gate-benefits">` with one `<li>` per served string (`textContent`) → `marketingLabel` → `consentFooter` → links → accept / decline.
- Card, in order: headline (`.ms-chat-optin-headline`) → `<ul class="ms-chat-optin-benefits">` → label → footer → links → buttons.
- No truncation, no "read more".

**Response handling (GET)**

| status / payload | widget behaviour | KPI |
|---|---|---|
| 200, required keys valid, `lawyerApproved === true` | render, with or without the bullet list as validated above | `consent_gate_shown` (data as in Task 2) |
| 200, a required key missing, or `lawyerApproved !== true` | nothing: the popup is not shown and the card removes itself (unchanged) | none |
| 4xx / 5xx / 429 / network error / bad JSON | nothing, silently (unchanged) | none |

**UI strings:** no new chrome strings. `GATE_COPY.benefits` is removed in DE and in the EN overlay. **In the PR description, report the exact DE and EN strings of `GATE_COPY.benefits` as they were before deletion.** The backend can then serve them byte-identically once they are approved, and use them for the removal checks.

**Storage:** nothing new.

**KPI:** event names are unchanged. The data is defined in Task 2.

**Failure mode:** fail-closed for the required keys, as today. The bullets fail silently (no list).

**Edge cases**
- *Reload:* the card is not persisted, and the popup budget (`sessionStorage['ms-chat-gate-shown']`) keeps the popup quiet for the rest of the tab session. Both unchanged.
- *Signed in vs anonymous:* only signed-in customers see either surface. The anonymous login popup (`presentLoginGate()`) is unchanged.
- *Streaming:* the popup can still appear while the reply streams (unchanged).
- *Voice mode:* never shown (unchanged).
- */en:* render whatever is served, verbatim. Never translate it and never use `L()`. With today's backend this means no list on `/en`.
- *Older backend* (no `benefits`): no list.

### 2. Echo `variant` and `placement` in the KPI events and the opt-in POST (required)

**Where**
- `presentConsentGate()` uses `placement:'popup'`.
- `buildMarketingOptInCard()`, as called from `presentSignInOptIn()`, uses `placement:'signin_return'`.
- If the value-moment ask (backlog D6) is built in this same round, its call of `buildMarketingOptInCard()` uses `placement:'value_moment'`. Otherwise never send `'value_moment'`.
- Pass `placement` into `buildMarketingOptInCard(…)` as a parameter.

**Trigger and timing**
- Read `copy.variant` from **the same copy object that was rendered**. Capture it in the closure, and never re-read it from the cache later.
- Validate it against `/^[a-z0-9_-]{1,32}$/`. If it is absent or does not match, omit the key everywhere.
- At render time, also capture `renderSid = sid` in the same closure. It is used for the late-answer rule below.

**Request (accept tap only)**
```
POST {BASE_URL}/api/account/marketing-opt-in
x-ms-chat-key: <key>   x-ms-session: <sid>   x-ms-locale: <de|en>   Content-Type: application/json
{"marketingConsent":true,"consentTextShown":"<served surface=signin consentTextShown, verbatim>","locale":"de","placement":"popup","variant":"a"}
```
`placement` is always sent. `variant` is sent only when it is valid.

**Response:** unchanged, e.g. `{"ok":true,"marketing":{"status":"pending","doiEmailSent":true,"alreadyConfirmed":false}}`.

**Response handling (POST).** Behaviour is unchanged except the `sid` check on the 2xx KPI and the Task 4 rule for answers that arrive after the popup was closed.

| status | widget behaviour | KPI |
|---|---|---|
| 2xx | outcome via `marketingOutcome()` (`already` / `pending` / `other`); `ms-chat-mkt-decision = accepted`; `ms-chat-optin-done` | `consent_gate_accepted {surface, placement, variant?}`, sent only after the 2xx **and only if `sid === renderSid`**; otherwise none |
| 400 `marketing_consent_required` | server `error.message` (not reachable from the accept tap) | none |
| 401 | `accountUnauthorized()`; close / remove | none |
| 422 `no_verified_email` | popup: close → `openCaptureForm()`, except after a dismiss (Task 4); card: „Für dein Konto ist keine bestätigte E-Mail-Adresse hinterlegt.“ + „E-Mail-Adresse eingeben“ (unchanged) | none |
| 429 | „Zu viele Anfragen — bitte kurz warten.“; accept re-enabled after `Retry-After` (default 30 s) | none |
| 502 / 503 / network | popup „Gerade nicht möglich — bitte versuch es später erneut.“ / card „Anmeldung gerade nicht möglich — bitte später erneut versuchen.“ | none |
| other (400 `bad_request`, 403, 404, 500) | popup: server `error.message` or „Das hat leider nicht geklappt. Bitte versuch es erneut.“; card: server `error.message` or „Anmeldung fehlgeschlagen. Bitte versuch es erneut.“ (unchanged) | none |

The backend never answers 400 because of `placement` or `variant`.

**UI strings:** none.

**Storage:** none. `variant` and `renderSid` live only in memory with the copy object. They are never written to localStorage, sessionStorage, cookies or the URL.

**KPI payloads.** `sessionId` and the timestamp are added by `track()`.
- `consent_gate_shown` `{"surface":"signin","placement":"popup","variant":"a"}`. Sent once per tab session, shared with the card through `sessionStorage['ms-chat-optin-ask-shown']` (unchanged).
- `consent_gate_accepted` `{"surface":"signin","placement":"popup","variant":"a"}`. Sent only after the 2xx, and only under the sid the ask was rendered for.
- `consent_gate_declined` `{"surface":"signin","placement":"signin_return","variant":"a"}`. Sent on „Nein, danke“ in the popup or the card.
- `consent_gate_dismissed` `{"surface":"signin","placement":"popup","variant":"a"}`. Popup only (Esc / backdrop); see Task 4.

**Naming check.** The event names are unchanged. They contain neither `cart` / `checkout` nor `product…click` / `cta…click`. The dashboard's `CTA_PATTERNS` and `CART_PATTERNS` match **event names** only, so these events are never counted as clicks, before or after this change. None of them is a server-only name.

**Failure mode:** fail-silent. A missing or invalid variant means the key is omitted, never replaced by a placeholder.

**Edge cases**
- *Late 2xx after a sid change* (sign-out, a "Neuen Chat starten" rotation, or adopting another tab's sid): no `consent_gate_accepted` is sent. Otherwise the previous customer's act would land on the next session, which on a shared device may be another person. The server's `signin_optin` events remain the record of the opt-in. Device memory behaves as today.
- *Older backend:* no `variant`, so send `placement` only. The old route ignores unknown body keys; its `OptInPayload` reads only `marketingConsent`, `consentTextShown` and `locale`.
- */en:* same keys. Variant ids are strings that do not depend on the locale.

### 3. Key the signin consent-copy memory cache by sid (required)

**Where:** `fetchSignInConsentCopy()`, together with `signInConsentCache` and its in-flight promise.

**Trigger and timing**
- Store `{sid, at, copy}`. A cache hit requires `entry.sid === sid && Date.now() - entry.at < CONSENT_COPY_TTL_MS` (60 s).
- Do not reuse an in-flight promise that was started for another sid.
- This covers `rotateSession()`, `dropSessionHistory(adoptSid)` / `onSidChangedElsewhere()` (adopting another tab's sid) and any later rotation, without touching each call site.
- Once more than one variant is active, the backend assigns the variant per sid. A stale entry would then show and report the wrong variant.

**Request / Response:** unchanged.

**Response handling:** a failed fetch is still not cached, as today.

**UI strings:** none.

**Storage:** in memory only, never persisted (as today).

**KPI:** none.

**Failure mode:** fail-silent.

**Edge cases**
- Two tabs on the same sid get the same variant, because the backend's assignment is a stable hash of the sid.
- After a sign-out and a new sign-in (new sid) within 60 s, the next ask fetches the copy again.
- The capture-form cache (`consentCopyCache`) is out of scope. Leave it unchanged.

### 4. Stop `consent_gate_dismissed` and late side effects after an accept has started (optional, recommended: the per-variant accept rate depends on it)

**Where:** `presentConsentGate()`: the `onDefer` handler passed to `openGateDialog()`, plus `setBusy()`, `showSuccess()` and the POST result handlers.

**Trigger and timing**
- Set a local flag `acceptStarted = true` right before the opt-in POST.
- While the flag is set, Esc or a backdrop click closes the dialog and calls `markOptInDone()`. It sends **no** `consent_gate_dismissed`.
- On the success view, Esc or a backdrop click behaves like „Weiter zur Antwort“ and sends no KPI.
- If the POST answers after the dialog was already closed this way:
  - **2xx:** records `accepted` and sends `consent_gate_accepted`, subject to the Task 2 sid check (as today).
  - **422:** opens **nothing**. No `openCaptureForm()`, no KPI. The shopper closed the ask deliberately.
  - **401:** still runs `accountUnauthorized()`.
  - **429 / 5xx / other:** nothing visible, no KPI.

**Request / Response:** none.

**Response handling:** as above.

**UI strings:** none.

**Storage:** `ms-chat-optin-done` (sessionStorage, tab session), unchanged.

**KPI:** `consent_gate_dismissed` then means only "closed before any decision". This fixes the double count described under Baseline → "Dismiss during an accept".

**Failure mode:** n/a.

**Edge cases:** a dismiss during an in-flight POST followed by a 4xx/5xx sends no KPI at all. That is acceptable, because the shopper closed the dialog.

## Legal constraints
- **Lawyer approval.** The backend serves `benefits` only after the lawyer has approved them as served text, and every later variant only with its own approval. The widget never decides this. It renders only what is served with `lawyerApproved === true`.
- **Framing only.** `benefits` is benefit framing, like `headline`: no discount amounts, no countdowns, no urgency (CF §1). Whether „zuerst erfahren“ makes a claim that must be true is the lawyer's call. The widget renders the bullets verbatim, all or nothing.
- **Tone rule for variants.** Every variant's `headline` and `benefits` are static strings per locale. They contain no placeholders, are never filled in per visitor, and never refer to the visitor's behaviour or chat content. Something like „Angebote zu den Produkten, die du dir angesehen hast“ is not allowed. The widget never fills in served copy.
- **Audit string.** `consentTextShown` is still byte-for-byte the served string. It covers label + footer only, unless the backend changes that after legal advice. Then the served string changes and the widget still just echoes it.
- **Equal choice.** Nothing is pre-selected. „Nein, danke“ stays the same size, directly under accept. `marketingConsent: true` comes only from the accept click.
- **/en.** English copy is served with `enLegalReviewed: false`.
  - The backend serves **no** English bullets until the English legal review.
  - This task adds **no** widget check of `enLegalReviewed`.
  - The backend can also gate the whole `/en` surface by serving `lawyerApproved: false` for `locale=en` on `surface=signin`. That is the switch `CONSENT_SIGNIN_EN_GATE`, an owner + lawyer decision. Every widget since PR #73 already honours it (fail closed).
- **§ 25 TDDDG.** KPI telemetry is sent today without checking the shop's privacy consent. Whether that is acceptable is an open lawyer question.
  - (a) This task adds **no** new interaction-free event. `consent_gate_shown` keeps its timing; only id/enum fields are added to it.
  - (b) Assigning variants per sid is a **new analytics purpose** for the pseudonymous sid. AC §7.4 documents `x-ms-session` on this GET for rate-limit keying only. With the default (one variant), nothing is bucketed. Before a second variant is activated, the backend lists this purpose under the open § 25 TDDDG question and in the privacy-policy / Cluster A wording.
  - (c) If the lawyer requires gating, gate `consent_gate_shown`, `_accepted`, `_declined` and `_dismissed` **together** on `window.Shopify.customerPrivacy.analyticsProcessingAllowed()`, so the rates stay unbiased. Never gate `shown` alone. Opt-in counts then come from the server's `signin_optin` events. That would be a separate widget task, not part of this one.
- **Proof of which framing was shown (Art. 7).** While only variant `a` runs, the copy version implies the framing. Before a second variant runs, the lawyer decides whether the shown variant must be stored on the consent record. The backend handles this. The widget only echoes the served `variant` in the POST.
- **Pseudonymous only.** Variant assignment uses only the pseudonymous sid, on the server. `variant` and `placement` are ids/enums. No e-mail, name, headline or bullet text ever goes into KPI data.
- **Data that must not leave the browser:** nothing new. No new request headers.

## Deployment
- **Files to upload:** `assets/ms-chat-widget.js` and `assets/ms-chat-widget.css` (the new `.ms-chat-optin-benefits` rule).
- **Shared files to hand-edit in the live editor:** none.
- **MANIFEST:** an entry is required. If D6 is done in the same round, use one entry and one upload for both.
- **Fingerprint counts.** In the PR, report the merged commit hash and the counts of these strings in the new `assets/ms-chat-widget.js`, as committed. The backend uses them for its fingerprint (`npm run verify:widget`) and re-measures the minified variants itself.
  - `ms-chat-optin-benefits`: expected ≥ 1. Positive marker, a complete string literal.
  - `Rabattaktionen zuerst erfahren`: expected 0. Negative marker.
  - `Empfehlungen, passend zu deiner Beratung`: expected 0.
  - Each EN string of the former `GATE_COPY.benefits`, as reported: expected 0.
- **Switches to flip after the live check:** none for the compliance part. The backend's `CONSENT_SIGNIN_VARIANTS` goes beyond `a` only after three things: the fingerprint classifies this build, a second variant is lawyer-approved, and the lawyer has answered the questions in "Legal constraints".

## Acceptance checklist
- [ ] `GATE_COPY` has no `benefits` key, in the DE object or in the EN overlay. The new `assets/ms-chat-widget.js` contains `Rabattaktionen zuerst erfahren` 0 times, `Empfehlungen, passend zu deiner Beratung` 0 times, and each reported EN bullet string 0 times. It contains `ms-chat-optin-benefits` at least once.
- [ ] No widget-authored string sits between the served headline and the served `marketingLabel`, in either the popup or the card.
- [ ] Served `benefits` (2 items, mocked) render verbatim in `.ms-chat-gate-benefits` (popup) and `.ms-chat-optin-benefits` (card), in DE and EN. With the real backend default for `locale=en` (`benefits: []`), `/en` shows no list.
- [ ] With `benefits` absent, `[]`, 5 items, or containing `""` or a number: no list. Popup and card still render headline, label, footer, links and both buttons.
- [ ] Headers and bodies:
  - `GET /api/consent-copy?surface=signin&locale=…` carries only `x-ms-session`. No new header, no changed cache mode.
  - Every `POST /api/account/marketing-opt-in` carries `x-ms-chat-key`, `x-ms-session` and `x-ms-locale`.
  - The POST body has `marketingConsent:true`, the verbatim `consentTextShown`, `locale`, `placement`, and `variant` when served.
- [ ] KPI payloads:
  - `consent_gate_shown/_accepted/_declined/_dismissed` carry `surface:'signin'`, the right `placement` (`popup` from the popup, `signin_return` from the card after a chat sign-in) and the served `variant`.
  - Their `sessionId` equals the `x-ms-session` of the copy GET and of the POST.
  - The test session shows up on the admin KPI tab under „Einwilligung nach der Anmeldung“ → „Nach Variante und Platzierung“.
- [ ] Mock `variant:'b'`: `b` is echoed in all four events and in the POST. Mock `variant:'B!'` or `'x'.repeat(33)`: the key is omitted everywhere and nothing else changes.
- [ ] Older backend (mock without `benefits` / `variant`): popup and card without bullets, events and POST without `variant`. Everything else behaves exactly like `3e87341`.
- [ ] Negative cases unchanged:
  - `lawyerApproved:false` or a missing `marketingLabel`: nothing shown, no KPI.
  - 401 / 422 / 429 / 503 / network, and the "other" codes 400 `bad_request` / 403 / 404 / 500, on the POST behave as in the Task 2 table.
- [ ] Sid change (sign-out → new sign-in in this tab; a `storage` event adopting another tab's sid): the next ask fetches the copy again. A cached copy of a previous sid is never rendered.
- [ ] Late answer: accept, then rotate or adopt the sid before a mocked delayed 2xx. No `consent_gate_accepted` is sent under the new sid.
- [ ] (Task 4) Esc on the success view and Esc during an in-flight accept send no `consent_gate_dismissed`. Esc before any decision still sends it. Esc during an in-flight accept followed by a mocked 422: no capture form opens and no KPI is sent. A mocked late 401 still runs `accountUnauthorized()`.
- [ ] The login popup (`presentLoginGate()`) is unchanged, including its bullets.
- [ ] Harness: new checks are added and pass in DE and EN, at 1280 and 390. The cross-cutting invariants hold:
  - every call carries `x-ms-session`, and guarded calls also `x-ms-chat-key`;
  - `/en` calls carry `locale=en`;
  - no server-only KPI events;
  - no unmocked requests.
- [ ] No console errors, no new hard-coded legal text, no pre-selection, no server-only events.
- [ ] Screenshots in DE and EN, at desktop 1280 and mobile 390, of: the consent popup with served bullets, the popup without bullets, and the inline card with served bullets.

---

## Backend counterpart

Ship in this order. B1 is invisible to the live `3e87341` widget, for four reasons:
- extra consent-copy keys and extra POST fields are ignored (07 §5 rule 1);
- `benefits` is `[]`;
- only variant `a` exists;
- caching is unchanged.

B1 can go out today.

### B1: plumbing (ship now; a no-op until the widget ships)

**1. New pure core `src/lib/consent-variants.mjs`, with `consent-variants.test.mjs`.**

*Exports:*
- `SIGNIN_PLACEMENTS = ['popup','signin_return','value_moment']`. `normalizePlacement(v)` returns the enum value or `null`.
- `SIGNIN_VARIANT_ID_RE = /^[a-z0-9_-]{1,32}$/`.
- `SIGNIN_VARIANTS = { de: [...], en: [...] }`, frozen. Each entry is `{ id, headline, benefits, lawyerApproved }`.
  - Variant `a` takes its `headline` from `consentStrings(locale).signinHeadline` (`consent-copy-core.mjs`), so the approved string has one source.
  - DE `benefits: []` until the sign-off (B2).
  - EN `benefits` is `[]` for as long as `CONSENT_COPY_EN_LEGAL_REVIEWED` is false.
  - Variants never define `marketingLabel`, `consentFooter` or `consentTextShown`.
  - Variants are only **deactivated** (left out of `CONSENT_SIGNIN_VARIANTS`, or `lawyerApproved: false`). They are never removed from `SIGNIN_VARIANTS`, so old echoed ids stay known.
- `parseActiveVariantIds(raw)` reads `CONSENT_SIGNIN_VARIANTS`. Default `"a"`. It accepts a comma list, then trims, dedupes and checks each id against the regex.
- `activeSigninVariants(locale, raw)` returns the defined variants whose id is active **and** whose `lawyerApproved === true`. If that set is empty, it returns `[a]`.
- `pickSigninVariant(sid, locale, raw)`:
  - one active variant → that variant;
  - several → FNV-1a 32-bit of `` `${normalizedRaw}|${sid}` `` modulo n, so a new variant set re-buckets;
  - no sid → the first variant (the control).
- `isKnownSigninVariant(id, locale?)` checks against all **defined** ids, so an opt-in from a copy cached just before a switch still counts. Without `locale`, an id defined in any locale counts (for the dashboard).
- `fnv1a32(str)`.

*Tests:*
- the default serves only `a`;
- unknown and unapproved ids are never served;
- the same sid always gets the same variant;
- over 10,000 random UUIDs, the split is within ±3 % per arm;
- a missing sid gets the control;
- `benefits` items are non-empty, at most 200 characters each, at most 4 items;
- EN `benefits` is `[]` while `CONSENT_COPY_EN_LEGAL_REVIEWED` is false;
- every variant's keys are a subset of `{id, headline, benefits, lawyerApproved}`;
- no `headline` or benefit contains `{`, `%s` or `${` (tone rule: static, no placeholders);
- a pinned list of ids that were ever shipped is a subset of the defined ids (never removed);
- `normalizePlacement` cases.

**2. `src/lib/consent-copy.ts → signInMarketingConsentCopy(locale, sessionId?)`.**
- Pick `v = pickSigninVariant(sessionId, locale, process.env.CONSENT_SIGNIN_VARIANTS)`.
- Return `headline: v.headline`, `benefits: [...v.benefits]`, `variant: v.id`, and `lawyerApproved: CONSENT_COPY_LAWYER_APPROVED && v.lawyerApproved` (plus the optional EN gate, B5).
- `marketingLabel`, `consentFooter`, `consentTextShown` (`composeConsentTextShown([s.signinLabel, s.consentFooter])`) and `version` stay unchanged.
- In `SignInMarketingConsentCopy`, add the **optional** fields `benefits?: string[]` and `variant?: string`. `chatGateMarketingConsentCopy()` (`surface=chat`) is untouched.
- Export `signInVariantsActive(locale): boolean`, true when more than one variant is active.
- The attestation in the opt-in route calls `signInMarketingConsentCopy(locale)` without a sid. It still compares against the same label + footer string.

**3. `src/app/api/consent-copy/route.ts → GET`.**
- For `surface === 'signin'`, pass `req.headers.get('x-ms-session')` into `signInMarketingConsentCopy(locale, sid)`.
- `Cache-Control` is `private, no-store` when `surface === 'signin' && signInVariantsActive(locale)`. Otherwise keep today's `public, max-age=60, stale-while-revalidate=300`.
- Do not add `Vary`. `no-store` is enough, and `private` keeps Vercel's shared cache out.
- The rate-limit bucket (`products`, 60/60 s) is unchanged. One GET per ask is negligible.

**4. `src/app/api/account/marketing-opt-in/route.ts → POST`.**
- `OptInPayload` gains `placement?: unknown` and `variant?: unknown`.
- `placement = normalizePlacement(payload.placement)`.
- `variant = typeof payload.variant === 'string' && isKnownSigninVariant(payload.variant, locale) ? payload.variant : null`.
- Compute `alreadyConfirmed` once: `capture.subscribedElsewhere || (capture.marketingDoiStatus === 'confirmed' && !capture.doiEmailRequired)`. Use the same value in the response.
  - Reason: for an address subscribed elsewhere, `doiStatus` stays `'none'` or `'pending'` (`upsertEmailCapture()`, first branch) while the answer is `alreadyConfirmed: true`.
- Build one data object `{ trigger:'signin_optin', placement?, variant?, alreadyConfirmed, doiRequired: capture.doiEmailRequired }` and spread it into both `recordKpiEvent` calls:
  - `KPI_EMAIL_CAPTURE_SUBMITTED` keeps `marketingConsent: true`;
  - `KPI_EMAIL_CAPTURE_MARKETING_OPTED_IN` keeps `doiStatus`.
  - `placement` and `variant` are included only when non-null.
  - All values are server-only booleans and enums.
- While `signInVariantsActive(locale)`, add `variantMismatch: true` when the echoed variant ≠ `pickSigninVariant(sessionId, …).id`. This is the cache-bleed check.
- Never answer 400 because of these fields.
- Leave `upsertEmailCapture`, `recordMoOptIn({surface:'mo_signin'})` and the DOI path unchanged.

**5. `.env.example`.**
- `CONSENT_SIGNIN_VARIANTS=a`: a comma list of lawyer-approved signin variant ids to A/B test. Default `a` = control only.
  - Set more than one only after three things: the widget build that renders served `benefits` and echoes `variant` is confirmed live (`npm run verify:widget`); the lawyer has answered the § 25 TDDDG / framing-record questions (B4); a second variant is approved.
  - While more than one is active, `/api/consent-copy?surface=signin` answers `private, no-store`.
- `CONSENT_SIGNIN_EN_GATE=false` (see B5).

**6. Dashboard.**

`src/lib/kpi-store.ts → getConsentGateFunnel()` gets `byVariant: ConsentVariantRow[]` from two more queries, each spelled out in full (no nested fragments).

*Query (a): widget sessions.*
```sql
WITH gate AS (
  SELECT session_id,
         CASE WHEN data->>'variant' ~ '^[a-z0-9_-]{1,32}$' THEN data->>'variant'
              WHEN data ? 'variant' THEN '?' ELSE '' END AS variant,
         CASE WHEN data->>'placement' ~ '^[a-z_]{1,32}$' THEN data->>'placement'
              WHEN data ? 'placement' THEN '?' ELSE '' END AS placement,
         bool_or(event = ${KPI_CONSENT_GATE_SHOWN}) AS shown,
         bool_or(event = ${KPI_CONSENT_GATE_ACCEPTED}) AS accepted,
         bool_or(event = ${KPI_CONSENT_GATE_DECLINED}) AS declined,
         bool_or(event = ${KPI_CONSENT_GATE_DISMISSED}) AS dismissed
    FROM kpi_events
   WHERE event IN (${KPI_CONSENT_GATE_SHOWN}, ${KPI_CONSENT_GATE_ACCEPTED},
                   ${KPI_CONSENT_GATE_DECLINED}, ${KPI_CONSENT_GATE_DISMISSED})
     AND data->>'surface' = 'signin' AND session_id IS NOT NULL
     AND created_at >= ${range.from}::date AND created_at < (${range.to}::date + 1)
   GROUP BY 1, 2, 3)
SELECT variant, placement,
       count(*) FILTER (WHERE shown)::int AS shown,
       count(*) FILTER (WHERE shown AND accepted)::int AS accepted,
       count(*) FILTER (WHERE shown AND declined AND NOT accepted)::int AS declined,
       count(*) FILTER (WHERE shown AND dismissed AND NOT accepted AND NOT declined)::int AS dismissed,
       count(*) FILTER (WHERE accepted AND NOT shown)::int AS accepted_without_shown
  FROM gate GROUP BY 1, 2
```
- Every rate is computed on `shown AND …`.
- `accepted` is the final state, so the double counts from the old dismiss-after-accept behaviour drop out.
- `accepted_without_shown` collects three cases: a late 2xx under a new sid on older widgets; a card after the popup's 422 path; a `shown` event just before the start of the range. It is shown only as a diagnostic.

*Query (b): the server's opt-in cohort.* Sessions with `email_capture_marketing_opted_in` and `data->>'trigger' = 'signin_optin'` in range, grouped by `variant` / `placement` with the same regex bounding as query (a). Count:
- `optedIn`;
- `alreadyConfirmed`: `data->>'alreadyConfirmed' = 'true'`. Rows written before B1.4 fall back to `data->>'doiStatus' = 'confirmed'`;
- `doiRequired`: `COALESCE((data->>'doiRequired')::boolean, data->>'doiStatus' = 'pending')`;
- `doiConfirmed`: `doiRequired` **and** an `email_capture_marketing_confirmed` with the same `session_id`, at or after the opt-in, at any time. `/api/confirm-marketing` keys that event to `email_captures.session_id`;
- `variantMismatch`.

Once `/api/confirm-marketing` tags `email_capture_marketing_confirmed` with the opt-in trigger (today the event carries no data), switch `doiConfirmed` to that tag.

*Pure core in `src/lib/kpi-widget-events.mjs`, with tests:*
- `normalizeConsentVariantRows(rows)`:
  - variant: `''` → „ohne (älteres Widget)“; an id that `isKnownSigninVariant(id)` rejects (including `'?'`) → „unbekannt“;
  - placement: `''` → „ohne“; a value that `normalizePlacement()` rejects → „unbekannt“;
  - rows with the same normalized key are merged by summing.

  This way arbitrary strings posted to `/api/kpi` never become their own admin rows.
- `consentVariantRates(row)`, in the style of `loginGateRates()`:
  - `acceptRate = accepted / shown`;
  - `doiRate = doiConfirmed / doiRequired` (opt-ins answered `alreadyConfirmed` are left out of the denominator);
  - `comparable = shown >= MIN_VARIANT_SESSIONS` (100).
- Tests cover: garbage variants and placements are merged into „unbekannt“; `alreadyConfirmed` rows are excluded from the DOI denominator; division by zero.

*`src/app/admin/kpi/sections/ConsentGateSection.tsx`:* add a `SubHeading` „Nach Variante und Platzierung“ with an `InfoTip`, and a `DataTable` with these columns:
- Variante
- Platzierung (Popup / Nach Anmeldung im Chat / Wertmoment)
- Sitzungen angezeigt, akzeptiert, Akzeptanzrate
- abgelehnt, weggeklickt
- akzeptiert ohne Anzeige (diagnostic, explained in the `InfoTip`)
- Opt-ins (Server), bereits angemeldet, DOI nötig, DOI bestätigt, DOI-Quote

Display rules:
- Show „zu wenige Sitzungen für einen Vergleich“ when a row is not `comparable`.
- Render the block only when some row has a known variant.
- Use `num` / `ratio` and the design tokens. No caching (pure DB).

*Docs:* document the block in `docs/ADMIN_DASHBOARD.md` §5.7.

**7. Fingerprint markers** (`src/lib/widget-fingerprint.mjs → WIDGET_MARKERS`).
- Add `"ms-chat-optin-benefits"`, the positive marker: a new class-name string literal, 0 in every older build, and it survives minification.
- Add `"Rabattaktionen zuerst erfahren"`, the negative marker: ASCII only, ≥ 1 in `3e87341`, 0 in the new build. Avoid markers with `ö` or `&`, because the source may escape them.
- Do **not** use `"signin_return"`. `countWidgetMarkers()` counts plain substrings, and `account_signin_return` (sent by `handleAuthReturn()`) already contains it in every build since PR #73.
- Re-measure both new markers raw, ws and min on every commit in `MEASURED` (`widget-fingerprint.test.mjs`) and add the counts. Every existing classification must stay unchanged; the test enforces this.

**8. Docs, in the same PR.**
- CF §1: framing is allowed in `headline` **and** `benefits`. Variants are static per locale, contain no placeholders and never refer to behaviour.
- CF §3.1: the new fields, the JSON above, all-or-nothing rendering, the cache rule, and EN `benefits: []` until the English review.
- CF §3.2: optional `placement` / `variant`.
- Keep `docs/CONSENT_FLOW.md` and `docs/frontend-handoff/CONSENT_FLOW.md` in step.
- `docs/API_CONTRACT.md` (canonical) **only**:
  - §5: consent-gate data `{surface, placement?, variant?}`; the `signin_optin` server events with `placement?` / `variant?` / `variantMismatch?` / `alreadyConfirmed` / `doiRequired`.
  - §7.4: the signin payload with `benefits?` / `variant?`, and the `private, no-store` rule.
  - The `x-ms-session` header on this GET is now also used for variant assignment while more than one variant is active.
- `docs/frontend-handoff/API_CONTRACT.md`: add one row to its "Additive changes" table: optional `benefits` / `variant` on `surface=signin`; optional `placement` / `variant` on the opt-in POST and in `consent_gate_*` data; `private, no-store` while more than one variant is active.
- CA §6.1: one line.
- `docs/CONSENT_FLOW.md` → "Customer platform (2026-10) — open, not yet recorded as reviewed" gets three items:
  - "[ ] consent-popup benefit bullets as served `benefits` (variant a)";
  - "[ ] every later signin variant";
  - "[ ] must the shown framing variant be stored on the consent record (`email_captures`)?".
- `docs/frontend/07` §8: add per-sid variant assignment to the § 25 TDDDG open question.
- `docs/FEATURE_INVENTORY.md`: a new capability entry.
- In the PR, state that no migration is needed.

### B2: after the lawyer signs off on the bullets (backend deploy only)
- Put the approved DE strings into variant `a` `benefits`, byte-identical to the strings the frontend PR reported. Add byte-identity checks to `consent-variants.test.mjs`.
- EN keeps `benefits: []` until `CONSENT_COPY_EN_LEGAL_REVIEWED` is true. Then serve the reviewed translation and add the same byte-identity checks.
- **Version decision: bump `CONSENT_COPY_VERSION` to `v5`.**
  - This follows the house rule in `consent-copy-version.mjs` ("Bump … whenever the served consent copy (any surface) changes"). `v4` was itself bumped for a framing change.
  - Add a `v5` history entry: served benefit bullets on `surface=signin`, lawyer-approved <date>.
  - Update `consent-copy-version.test.mjs` (it pins `"v4"`) and the sign-off section of `docs/CONSENT_FLOW.md`.
  - The widget ignores `version`, so the bump is backend-only.
- If the lawyer wants the bullets inside the audit string, use the same `v5` bump:
  - compose `consentTextShown` per variant;
  - attest in the opt-in route against the canonical string of the echoed variant;
  - optionally add the `consent_variant` migration from B4.
- If the lawyer rejects bullets entirely, keep `[]`. That is reversible without an upload.
- Before the upload, the only backend lever over the bullets hard-coded in the live widget is `lawyerApproved:false` for `surface=signin`. That silences both popup and card (owner decision).

### B2a: when the frontend PR is merged (before the owner's upload)
- Measure the merged commit's `assets/ms-chat-widget.js` raw, ws and min, as for the other rows. Add the results to `MEASURED`, and add the commit to `EXPECTED` in all three variants (both markers are string literals, so the minified build is recognisable too).
- `WIDGET_BUILDS`: add a new first row, e.g. `key: "consent-benefits-2026-10"`, with the commit, a German `label`, `current: false`, `acceptable: true`, and a German `consequence`, e.g. „Vorteile im Einwilligungs-Popup kommen vom Server; Variante und Platzierung werden gesendet. Varianten-Tests dürfen nach Freigabe eingeschaltet werden.“
- `classifyWidgetBuild()`: add a rule **ahead of** the existing `pr73 && fixes` branch:
  ```js
  if (pr73 && fixes && n("ms-chat-optin-benefits") > 0) {
    return n("Rabattaktionen zuerst erfahren") === 0 ? build("consent-benefits-2026-10") : null; // half-applied → unknown
  }
  ```
  Without this rule, the new build would be labelled `main-2026-10-04` or `fixes-minified`, and B3/B4 would pass on the wrong build.
- Tests:
  - `3e87341` and `8d0a0c4` still classify as before;
  - the new commit classifies as the new key, raw, ws and min;
  - a half-applied set (`ms-chat-optin-benefits` > 0 and `Rabattaktionen…` > 0) returns `null`.

### B3: after the owner's upload and a green `npm run verify:widget` (the new key)
- `src/lib/widget-fingerprint.mjs`: move `current: true` to the new row, and set `main-2026-10-04` and `fixes-minified` to `current: false`. Update the test that asserts the current keys (today `["main-2026-10-04","fixes-minified"]`).
- `src/lib/kpi-releases.mjs → KPI_RELEASES`: add an entry dated the upload day:
  - `key: "consent-served-benefits"`;
  - `title: „Einwilligungs-Popup: Vorteile vom Server, Variante und Platzierung“`;
  - `detail: „Die Vorteile im Einwilligungs-Popup kommen vom Server (anwaltlich freigegeben); Popup und Karte senden Variante und Platzierung. Auf /en entfallen die Vorteile bis zur englischen Rechtsprüfung.“`.

  Optionally add `MEANINGFUL_FROM["consent-variant"]` (upload day, „Variante und Platzierung sendet erst das Widget vom …“) and call `releaseNotesFor("consent-variant", range)` from the new block. Update the tests.
- Update `docs/frontend/04` §10.1–§10.3, §10.9, §11 and §18 items 15 and 17 (fixed), plus `07` §7.

### B4: first A/B test (owner decision, later; depends on the lawyer)
- **Precondition: the lawyer answers two questions.**
  1. May the pseudonymous sid be used for variant assignment? (§ 25 TDDDG / privacy-policy wording.)
  2. Must the framing variant shown before consent be on the consent record?

  Until then, `CONSENT_SIGNIN_VARIANTS` stays `a`.
- **If (2) is yes:**
  - add migration `0076_capture_consent_variant.sql`: `email_captures.consent_variant text NULL`. It is run manually by the maintainer; say so in the PR;
  - give `upsertEmailCapture` an optional `consentVariant` input;
  - write the validated echoed `variant` from the opt-in route **before** a second variant is activated.

  This is needed because `kpi_events` are pseudonymous and are hard-deleted after `KPI_RETENTION_DAYS` (180 days), and `docs/CONSENT_FLOW.md` "Measurement" says telemetry is never stored on the consent record.
- **If (2) is no:** document in the header of `consent-copy-version.mjs` that framing-only variants served in parallel, outside `consentTextShown`, share one version. Each variant still needs its own approval.
- Add variant `b` to `SIGNIN_VARIANTS` with its own approval (`lawyerApproved: true`). It must follow the tone rule; the B1.1 tests enforce no placeholders.
- Set `CONSENT_SIGNIN_VARIANTS=a,b`.
- Confirm on live that `/api/consent-copy?surface=signin` answers `private, no-store` and that `variantMismatch` stays near 0.
- Read results only from rows marked comparable (≥ 100 sessions per arm). Volume grows with the App Proxy (P0.3).
- Retiring a variant means deactivating it. It is never removed from `SIGNIN_VARIANTS`.

### B5: optional EN gate (owner + lawyer, D4)
- `CONSENT_SIGNIN_EN_GATE` (default `false`, today's behaviour). When it is `true` and `CONSENT_COPY_EN_LEGAL_REVIEWED` is false, `signInMarketingConsentCopy('en')` serves `lawyerApproved:false`. Every live widget since PR #73 then shows neither popup nor card on `/en`, with no upload.
- The EN bullets are already handled by B1 (`benefits: []`). This switch is only about the remaining unreviewed EN headline, label and footer.
- Flipping it is not a no-op: EN signed-in opt-ins stop until the review.

### Checks
- `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm test`.
- Screenshots of the KPI section „Einwilligung nach der Anmeldung“ in light and dark, at 1440 and 1024.
- Backend-side verification without the widget:
  - `curl` `surface=signin` with two different `x-ms-session` values:
    - with the default: one variant, the cache is public, DE and EN `benefits: []`;
    - with `CONSENT_SIGNIN_VARIANTS=a,b` set locally (and a test variant `b`): both arms appear and the cache is `private, no-store`.
  - A POST with `placement` / `variant` records them on both `signin_optin` events, together with `alreadyConfirmed` and `doiRequired`.
  - With a test account that is already subscribed in Shopify, the events carry `alreadyConfirmed: true` and `doiRequired: false` while `doiStatus` is `none`/`pending`.
  - A POST with garbage values still returns 200, and the keys are left out.
  - A KPI event posted with `variant:"<script>"` or a 32-character unknown id appears as „unbekannt“ in the admin, not as its own row.

---

## Verifier notes
- **Findings 1 and 10 (fingerprint)** are correct and say the same thing. Both are applied: `signin_return` is dropped, `ms-chat-optin-benefits` is the positive marker and `Rabattaktionen zuerst erfahren` the negative one. Finding 10 suggests "add the `WIDGET_BUILDS` row with those two counts". Per finding 1 and `widget-fingerprint.mjs`, rows hold no counts. The counts go into `MEASURED`/`EXPECTED` in the test, and recognition comes from a new rule in `classifyWidgetBuild()` (B2a). The rule also requires `pr73 && fixes`, which makes it stricter than suggested. The `current` flags move only in B3, after the upload.
- **Findings 3 and 11 (`alreadyConfirmed` / DOI-Quote)** are correct: `upsertEmailCapture()` keeps `none`/`pending` for `subscribedElsewhere`. They are merged:
  - Both events carry `alreadyConfirmed`, the same boolean as the response. That already covers `doiStatus = confirmed` and `subscribedElsewhere`, so a separate `alreadySubscribed` flag is not needed.
  - Both events also carry `doiRequired`.
  - „bereits angemeldet“ reads `alreadyConfirmed`, and the DOI-Quote is `doiConfirmed ÷ doiRequired`.
- **Finding 7 (version)** is correct. The decision taken is to bump to `v5` when the bullets are first served (B2). How variants running in parallel are recorded is tied to the lawyer's answer under finding 15 (B4).
- **Finding 9** is correct. `docs/frontend/04` is deliberately not attached: it describes the behaviour before this change, and under the "files win" rule it would override this prompt. Instead, the needed facts are inlined, chapter references are marked as background, and "OI1" is replaced with a concrete condition.
- **Finding 16:** besides normalizing in the pure core, query (a) and query (b) also bound the strings with a regex in SQL. Arbitrary `data` text therefore never reaches the server render.
- **Finding 12:** the sid check is applied only to `consent_gate_accepted`. That is the only `consent_gate_*` event sent after an asynchronous answer. Decline and dismiss are synchronous with the click, and `onSidChangedElsewhere()` closes an open gate.
- **Findings 2, 4, 5, 6, 8, 13, 14, 15, 17 and 18** were checked against the cited evidence (`docs/frontend-handoff/API_CONTRACT.md`, `marketing-opt-in/route.ts`, `account-guard.ts`, `kpi-releases.mjs`, `consent-copy-version.mjs`, `docs/DATA_RETENTION.md`, `04` §8/§10.2/§10.3/§13, `05` §13.3, `07` §3.4/§4.1/§8, AC §7.4). All are correct and applied as proposed.