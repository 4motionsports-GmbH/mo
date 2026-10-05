# Frontend task 1: serve the consent-popup benefits from the backend and add variant/placement to the signed-in ask (backend deployed 2026-10-05)

For the frontend agent that owns `ms_shopify_clone`. Attachments: see the prompt. The contract is `API_CONTRACT.md`, `ACCOUNT_CONTRACT.md` and `CONSENT_CONTRACT.md`; where this task and a contract file disagree, the contract file wins.

References marked "(background: …)" point into the backend repo; its chapters `docs/frontend/01`–`07` are the backend's code-verified description of your widget. They are background in the backend repo, not attached — everything needed is written out here. In your own repo, the code is the source of truth.

## Baseline
This task builds on widget `main` at `3e87341` (MANIFEST 2026-10-04 b), live since 2026-10-04. How it behaves today:

- **Consent popup.** `ms-chat-widget.js → presentConsentGate()` renders these items in order:
  1. the served `headline`;
  2. two **widget-authored** bullets from `GATE_COPY.benefits` in `.ms-chat-gate-benefits`: „Persönliche Empfehlungen, passend zu deiner Beratung“ and „Exklusive Angebote & Rabattaktionen zuerst erfahren“. `GATE_COPY` also has an English `Object.assign` overlay with EN bullets;
  3. the served `marketingLabel`, the served `consentFooter`, and the Impressum / Datenschutz links;
  4. the buttons „Ja, Angebote aktivieren“ / „Nein, danke“.

  The bullets break two rules: API_CONTRACT §0 rule 11 (the popup's and the card's headline and benefit bullets are served; the widget adds no consent-surface text of its own) and CONSENT_CONTRACT §1 (benefit framing only in served copy). (background: `docs/frontend/04` §10.2, §11, §18 item 17)
- **Inline card.** `presentSignInOptIn() → buildMarketingOptInCard()` shows the served headline, label and footer. It has no bullets.
- **KPI events.** Both surfaces send `consent_gate_shown/_accepted/_declined{/_dismissed} {surface:'signin'}`. No variant, no placement.
- **Copy cache.** `fetchSignInConsentCopy()` keeps the served copy in memory for 60 s (`signInConsentCache` plus an in-flight promise). The cache is keyed by time only, not by sid.
- **Late opt-in answer.** The opt-in POST has no stale guard. A 2xx that arrives after a sign-out or a sid rotation still sends `consent_gate_accepted`, because `track()` reads the current `sid`. (background: `docs/frontend/04` §8)
- **Dismiss during an accept.** The popup's `onDefer` handler (Esc / backdrop) stays bound for the whole life of the dialog. Closing the success view, or closing while the accept POST is in flight, therefore sends `consent_gate_dismissed`. The late POST handlers keep running on a detached card. A late 422 still closes the dialog and calls `openCaptureForm()`. (background: `docs/frontend/04` §10.2, §18 item 15)

## Goal and KPI
**What changes for the shopper:**
- The consent popup still shows benefit bullets. They now come from the backend (three bullets, wording decided by the owner on 2026-10-05) instead of from the widget.
- The inline card shows the same served bullets under its headline.
- If the backend serves no bullets, none are shown. The widget never falls back to its own text. On `/en` the backend serves the approved English translation of the bullets.

**What changes for measurement:** every signed-in ask carries a served `variant` id and a `placement`. The backend can then test headline and bullet variants with a backend deploy only, with no theme upload.

**KPIs:**
1. **Accept rate** of the signed-in ask, per variant and placement. Formula: sessions with `consent_gate_shown` **and** `consent_gate_accepted` ÷ sessions with `consent_gate_shown`. Accepts with no `shown` in the same session, variant and placement are reported separately as a diagnostic („Akzeptiert ohne Anzeige“).
2. **DOI-confirmed opt-ins** per variant. The server event `email_capture_marketing_opted_in {trigger:'signin_optin', variant}` is joined by session to `email_capture_marketing_confirmed`.
   - „Bereits angemeldet“ counts opt-ins the server answered with `alreadyConfirmed:true`.
   - The „DOI-Quote“ counts only opt-ins that required a DOI mail.
3. **Compliance.** No consent-popup text is left in the widget. This protects the main signed-in opt-in surface, whose volume grows with the App Proxy.

**Dashboard (backend):** KPI tab → „Einwilligung nach der Anmeldung (Marketing-Opt-in)“ → block „Nach Variante und Platzierung“. One row per variant × placement, with the columns „Angezeigt“, „Akzeptiert“, „Akzeptanzrate“, „Abgelehnt“, „Akzeptiert ohne Anzeige“, „Opt-ins (Server)“, „Bereits angemeldet“ and „DOI-Quote“; rates are compared from 100 sessions per row. A missing `variant` shows as „ohne (älteres Widget)“, a missing `placement` as „ohne“, an unknown value as „unbekannt“.

## Contract references
- **CONSENT_CONTRACT §1**, golden rules. Benefit framing is allowed only in served copy: `headline`, and on `surface=signin` `benefits`. No countdowns, no urgency, no discount amounts.
- **API_CONTRACT §7.4**, `GET /api/consent-copy?surface=signin`: the optional fields `benefits` and `variant`, and the `Cache-Control` rule while more than one variant runs. How to render them: **CONSENT_CONTRACT §3.1**.
- **ACCOUNT_CONTRACT §6.2**, `POST /api/account/marketing-opt-in`: the optional body fields `placement` and `variant`, the answers and the error codes. Submit rules: **CONSENT_CONTRACT §3.2**. When the ask is shown at all (`optInActionable`, backend anti-nag): **ACCOUNT_CONTRACT §6.1**.
- **API_CONTRACT §5** "Consent-gate events": `consent_gate_*` data is `{surface, placement?, variant?}`; "Sign-in opt-in extras" lists what the server adds to its own events. This task adds no event name.
- **API_CONTRACT §0**: rule 3 (additive only; no-op if the widget ships later), rules 8–11 (served consent copy; nothing pre-selected; fail closed — the signin required keys stay `marketingLabel`, `consentTextShown` and `lawyerApproved === true`; served framing vs widget chrome), rule 4 (no new request header), rules 13–14 (KPI data, server-only events).
- **API_CONTRACT §12**: the copy is fetched and submitted in the same locale.

## Backend state
**Deployed on 2026-10-05** (backend `main`):

**`GET /api/consent-copy?surface=signin&locale=de|en`** additionally returns `"variant": "a"` and `"benefits": [...]`, three strings, and `"version": "v5"` (the widget ignores `version`):
- **DE:** „Angebote, die zu deiner Beratung passen“, „Exklusive Rabatt-Aktionen nur für Abonnenten“, „Jederzeit mit einem Klick abbestellbar“.
- **EN:** "Offers that match your consultation", "Exclusive discount promotions for subscribers only", "Unsubscribe any time with one click" (the English consent copy is approved as the translation of the German; `enLegalReviewed: true`).
- All other keys are unchanged. `consentTextShown` is still label + footer; the bullets are framing, like the headline.

**`POST /api/account/marketing-opt-in`** accepts optional `placement` and `variant`.
- Unknown or invalid values are ignored, never answered with a 400.
- Both values are copied into the server events `email_capture_submitted` and `email_capture_marketing_opted_in` `{trigger:'signin_optin', source:'mo_signin', placement, variant}`.
- The server also adds `outcome`, `alreadyConfirmed`, `doiRequired` and, only while more than one variant is active, `variantMismatch` to those server-only events (API_CONTRACT §5 "Sign-in opt-in extras"). The widget sends none of them.

**Switches:**
- `CONSENT_SIGNIN_VARIANTS` (default in code `a`). With only `a`, nothing is bucketed by sid, and `Cache-Control` stays `public, max-age=60, stale-while-revalidate=300`.
  - It moves to e.g. `a,b` only after this upload is verified on live and a second variant is approved.
  - While more than one variant is active, the endpoint assigns the variant per `x-ms-session` and answers `Cache-Control: private, no-store`.

**No-op if the widget ships later.** The `3e87341` widget ignores the extra keys and renders its own two bullets. It sends no `placement` or `variant`, and the backend records nothing extra.

## Rules that do not change
API_CONTRACT §0 applies in full; for this task that means:
- Consent text comes only from `GET {BASE_URL}/api/consent-copy`. Never hard-code it. This now includes the popup's benefit bullets (rules 8, 11).
- Render `marketingLabel` and `consentFooter` fully visible. Nothing is pre-selected. Decline is as easy to reach as accept (rule 9).
- Echo `consentTextShown` verbatim in the POST. Never compose it client-side (rule 8).
- The marketing POST fires only on the explicit accept tap (`marketingConsent: true`) (rule 9).
- Popup and card render nothing unless the served copy has `lawyerApproved === true`, `marketingLabel` and `consentTextShown`. Fail closed, silently (rule 10).
- Render served strings with `textContent` only. Never apply `L()` to served copy (rule 8).
- KPI events carry ids and enums only: no message text, names, e-mails, product names, URLs, tokens or codes (rule 13).
- The widget never sends a server-only event (rule 14). The names are listed in API_CONTRACT §5: the "Server-emitted lifecycle events" table and the four server-side e-mail-capture funnel events.
- Every backend call keeps today's headers. **Do not add a request header** (rule 4). The backend's CORS allow-list is exactly `Content-Type, x-ms-chat-key, x-ms-session, x-ms-locale`. So `variant` and `placement` travel only in the JSON body and in KPI `data`. Do not change the `fetch` cache mode of the consent-copy GET either.
- The sign-in (login) popup is UI chrome (rule 11). Its `ACCOUNT_COPY` bullets stay in the widget, and this task does not touch them.

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

**Response (200),** DE (served since 2026-10-05):
```json
{
  "version": "v5",
  "locale": "de",
  "variant": "a",
  "headline": "Persönliche Angebote und exklusive Rabatt-Aktionen — direkt an deine hinterlegte E-Mail-Adresse.",
  "benefits": [
    "Angebote, die zu deiner Beratung passen",
    "Exklusive Rabatt-Aktionen nur für Abonnenten",
    "Jederzeit mit einem Klick abbestellbar"
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
For `locale=en` the response carries the three English bullets listed under "Backend state".

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
- */en:* render whatever is served, verbatim. Never translate it and never use `L()`. With the backend of 2026-10-05, `/en` shows the three English bullets.
- *Older backend* (no `benefits`): no list.

### 2. Echo `variant` and `placement` in the KPI events and the opt-in POST (required)

**Where**
- `presentConsentGate()` uses `placement:'popup'`.
- `buildMarketingOptInCard()`, as called from `presentSignInOptIn()`, uses `placement:'signin_return'`.
- `'value_moment'` is reserved for a later value-moment ask, which is not part of this round: never send it (CONSENT_CONTRACT §3.2).
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
| other (400 `bad_request`, 403, 404, 500) | popup: server `error.message` or „Das hat leider nicht geklappt. Bitte versuch es erneut.“; card: server `error.message` or „Anmeldung fehlgeschlagen. Bitte versuch es erneut.“ (unchanged; CONSENT_CONTRACT §3.2 groups `500` with `503` as "not possible right now", and ACCOUNT_CONTRACT §6.2 makes treating `404 not_found` like a sign-out optional — neither change is required by this task) | none |

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
- *Older backend:* no `variant`, so send `placement` only. An older backend ignores unknown body keys; it reads only `marketingConsent`, `consentTextShown` and `locale`.
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
- **Approval.** The backend serves `benefits` as approved served copy (owner decision 2026-10-05), and every later variant only with its own approval. The widget never decides this. It renders only what is served with `lawyerApproved === true`.
- **Framing only.** `benefits` is benefit framing, like `headline`: no discount amounts, no countdowns, no urgency (CONSENT_CONTRACT §1). The widget renders the bullets verbatim, all or nothing.
- **Tone rule for variants.** Every variant's `headline` and `benefits` are static strings per locale. They contain no placeholders, are never filled in per visitor, and never refer to the visitor's behaviour or chat content. Something like „Angebote zu den Produkten, die du dir angesehen hast“ is not allowed. The widget never fills in served copy.
- **Audit string.** `consentTextShown` is still byte-for-byte the served string. It covers label + footer only, unless the backend changes that after legal advice. Then the served string changes and the widget still just echoes it.
- **Equal choice.** Nothing is pre-selected. „Nein, danke“ stays the same size, directly under accept. `marketingConsent: true` comes only from the accept click.
- **/en.** English copy is approved as the translation of the German and served with `enLegalReviewed: true`, bullets included. This task adds **no** widget check of `enLegalReviewed`.
- **§ 25 TDDDG.** KPI telemetry is sent today without checking the shop's privacy consent. Whether that is acceptable is an open lawyer question.
  - (a) This task adds **no** new interaction-free event. `consent_gate_shown` keeps its timing; only id/enum fields are added to it.
  - (b) Assigning variants per sid is a **new analytics purpose** for the pseudonymous sid. API_CONTRACT §7.4 documents `x-ms-session` on this GET for rate-limit keying and, while more than one variant is active, for the variant assignment. With the default (one variant), nothing is bucketed. Before a second variant is activated, the backend lists this purpose under the open § 25 TDDDG question and in the privacy-policy wording (background: `docs/ANWALTSDOSSIER.md` F-38 (b)).
  - (c) If the lawyer requires gating, gate `consent_gate_shown`, `_accepted`, `_declined` and `_dismissed` **together** on `window.Shopify.customerPrivacy.analyticsProcessingAllowed()`, so the rates stay unbiased. Never gate `shown` alone. Opt-in counts then come from the server's `signin_optin` events. That would be a separate widget task, not part of this one.
  - Until then, do not gate these events: `consent_gate_shown` and `consent_gate_declined` with `surface: "signin"` also feed the backend anti-nag (ACCOUNT_CONTRACT §6.1), which would weaken if they were gated. API_CONTRACT §0 asks for analytics consent only for attribution (rule 7).
- **Proof of which framing was shown (Art. 7).** While only variant `a` runs, the copy version implies the framing. Before a second variant runs, the lawyer decides whether the shown variant must be stored on the consent record. The backend handles this. The widget only echoes the served `variant` in the POST.
- **Pseudonymous only.** Variant assignment uses only the pseudonymous sid, on the server. `variant` and `placement` are ids/enums. No e-mail, name, headline or bullet text ever goes into KPI data.
- **Data that must not leave the browser:** nothing new. No new request headers.

## Deployment
- **Files to upload:** `assets/ms-chat-widget.js` and `assets/ms-chat-widget.css` (the new `.ms-chat-optin-benefits` rule).
- **Shared files to hand-edit in the live editor:** none.
- **MANIFEST:** one entry, shared with tasks 2 and 3 (one upload).
- **Fingerprint counts.** In the PR, report the merged commit hash and the counts of these strings in the new `assets/ms-chat-widget.js`, as committed. The backend uses them for its fingerprint (`npm run verify:widget`) and re-measures the minified variants itself. The markers the prompt lists under "keep" must stay present.
  - `ms-chat-optin-benefits`: expected ≥ 1. Positive marker, a complete string literal.
  - `Rabattaktionen zuerst erfahren`: expected 0. Negative marker.
  - `Empfehlungen, passend zu deiner Beratung`: expected 0.
  - Each EN string of the former `GATE_COPY.benefits`, as reported: expected 0.
- **Switches to flip after the live check:** none. The backend's `CONSENT_SIGNIN_VARIANTS` goes beyond `a` only after the fingerprint classifies this build and a second variant is approved.

## Acceptance checklist
- [ ] `GATE_COPY` has no `benefits` key, in the DE object or in the EN overlay. The new `assets/ms-chat-widget.js` contains `Rabattaktionen zuerst erfahren` 0 times, `Empfehlungen, passend zu deiner Beratung` 0 times, and each reported EN bullet string 0 times. It contains `ms-chat-optin-benefits` at least once.
- [ ] No widget-authored string sits between the served headline and the served `marketingLabel`, in either the popup or the card.
- [ ] Served `benefits` (the three items the backend serves, and a mocked 2-item list) render verbatim in `.ms-chat-gate-benefits` (popup) and `.ms-chat-optin-benefits` (card), in DE and EN, against the real backend too.
- [ ] With `benefits` absent, `[]`, 5 items, or containing `""` or a number: no list. Popup and card still render headline, label, footer, links and both buttons.
- [ ] Headers and bodies:
  - `GET /api/consent-copy?surface=signin&locale=…` carries only `x-ms-session`. No new header, no changed cache mode.
  - Every `POST /api/account/marketing-opt-in` carries `x-ms-chat-key`, `x-ms-session` and `x-ms-locale`.
  - The POST body has `marketingConsent:true`, the verbatim `consentTextShown`, `locale`, `placement`, and `variant` when served.
- [ ] KPI payloads:
  - `consent_gate_shown/_accepted/_declined/_dismissed` carry `surface:'signin'`, the right `placement` (`popup` from the popup, `signin_return` from the card after a chat sign-in) and the served `variant`.
  - Their `sessionId` equals the `x-ms-session` of the copy GET and of the POST.
  - After the upload, the backend finds the test session on the admin KPI tab under „Einwilligung nach der Anmeldung (Marketing-Opt-in)“ → „Nach Variante und Platzierung“ (report the test sid's first 8 characters in the PR).
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

