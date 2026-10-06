# Frontend tasks of 2026-10-05

The three widget tasks of this round in one file — one PR, one upload. Do them in this order. The
widget contract they build on is in the three contract files sent with this file:
`API_CONTRACT.md`, `ACCOUNT_CONTRACT.md` and `CONSENT_CONTRACT.md`. Where a task and the contract
files disagree, the contract files win. The prompt (and the operator's cover note) is
[`README.md`](./README.md).

1. Task 1 — Serve the consent-popup benefits from the backend and add variant/placement to the signed-in ask (backend deployed 2026-10-05)
2. Task 2 — Page context on typed product-page messages (backend deployed 2026-10-05)
3. Task 3 — Renew the attribution token after a live consultation; blank the cart marker when the session ends (backend deployed 2026-10-05)

---

## Task 1 — Serve the consent-popup benefits from the backend and add variant/placement to the signed-in ask (backend deployed 2026-10-05)

For the frontend agent that owns `ms_shopify_clone`. Attachments: see the prompt. The contract is `API_CONTRACT.md`, `ACCOUNT_CONTRACT.md` and `CONSENT_CONTRACT.md`; where this task and a contract file disagree, the contract file wins.

References marked "(background: …)" point into the backend repo; its chapters `docs/frontend/01`–`07` are the backend's code-verified description of your widget. They are background in the backend repo, not attached — everything needed is written out here. In your own repo, the code is the source of truth.

### Baseline
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

### Goal and KPI
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

### Contract references
- **CONSENT_CONTRACT §1**, golden rules. Benefit framing is allowed only in served copy: `headline`, and on `surface=signin` `benefits`. No countdowns, no urgency, no discount amounts.
- **API_CONTRACT §7.4**, `GET /api/consent-copy?surface=signin`: the optional fields `benefits` and `variant`, and the `Cache-Control` rule while more than one variant runs. How to render them: **CONSENT_CONTRACT §3.1**.
- **ACCOUNT_CONTRACT §6.2**, `POST /api/account/marketing-opt-in`: the optional body fields `placement` and `variant`, the answers and the error codes. Submit rules: **CONSENT_CONTRACT §3.2**. When the ask is shown at all (`optInActionable`, backend anti-nag): **ACCOUNT_CONTRACT §6.1**.
- **API_CONTRACT §5** "Consent-gate events": `consent_gate_*` data is `{surface, placement?, variant?}`; "Sign-in opt-in extras" lists what the server adds to its own events. This task adds no event name.
- **API_CONTRACT §0**: rule 3 (additive only; no-op if the widget ships later), rules 8–11 (served consent copy; nothing pre-selected; fail closed — the signin required keys stay `marketingLabel`, `consentTextShown` and `lawyerApproved === true`; served framing vs widget chrome), rule 4 (no new request header), rules 13–14 (KPI data, server-only events).
- **API_CONTRACT §12**: the copy is fetched and submitted in the same locale.

### Backend state
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

### Rules that do not change
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

### Tasks (in order)

#### 1. Render the served `benefits` and delete `GATE_COPY.benefits` (required: compliance, do it first)

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

#### 2. Echo `variant` and `placement` in the KPI events and the opt-in POST (required)

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

#### 3. Key the signin consent-copy memory cache by sid (required)

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

#### 4. Stop `consent_gate_dismissed` and late side effects after an accept has started (optional, recommended: the per-variant accept rate depends on it)

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

### Legal constraints
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

### Deployment
- **Files to upload:** `assets/ms-chat-widget.js` and `assets/ms-chat-widget.css` (the new `.ms-chat-optin-benefits` rule).
- **Shared files to hand-edit in the live editor:** none.
- **MANIFEST:** one entry, shared with tasks 2 and 3 (one upload).
- **Fingerprint counts.** In the PR, report the merged commit hash and the counts of these strings in the new `assets/ms-chat-widget.js`, as committed. The backend uses them for its fingerprint (`npm run verify:widget`) and re-measures the minified variants itself. The markers the prompt lists under "keep" must stay present.
  - `ms-chat-optin-benefits`: expected ≥ 1. Positive marker, a complete string literal.
  - `Rabattaktionen zuerst erfahren`: expected 0. Negative marker.
  - `Empfehlungen, passend zu deiner Beratung`: expected 0.
  - Each EN string of the former `GATE_COPY.benefits`, as reported: expected 0.
- **Switches to flip after the live check:** none. The backend's `CONSENT_SIGNIN_VARIANTS` goes beyond `a` only after the fingerprint classifies this build and a second variant is approved.

### Acceptance checklist
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

---

## Task 2 — Page context on typed product-page messages (backend deployed 2026-10-05)

For the frontend agent that owns `ms_shopify_clone`. Attachments: see the prompt. The contract is `API_CONTRACT.md`, `ACCOUNT_CONTRACT.md` and `CONSENT_CONTRACT.md`; where this task and a contract file disagree, the contract file wins.

References marked "(background: …)" point into the backend repo; its chapters `docs/frontend/01`–`07` are the backend's code-verified description of your widget. They are background in the backend repo, not attached — everything needed is written out here. In your own repo, the code is the source of truth.

### Baseline
This task builds on widget `main` at `3e87341`. That is MANIFEST 2026-10-04 b (`8d0a0c4`) plus the `endSpeaking()` follow-up, live since the owner's upload on 2026-10-04.

How the widget behaves today:
- **Typed and spoken messages carry no `context`.** `onSend()` and `voiceSubmit()` call `sendMessage(text)` with no second argument.
- **Only two paths send `context`** (background: `docs/frontend/03` §2, §4.3; `docs/frontend/06` §2.4, F3):
  - the PDP CTA, through `openWithProduct()` → `sendMessage(primer, context)`;
  - the nudge click, through `showNudge()` → `sendContextGreeting(ctx)` with `messages: []`.
- **Result:** a shopper who opens Mo with the launcher on a PDP and types „Ist das leise?“ gives Mo no product.
- **Most PDP chats start by typing.** The CTA is only a small underlined text link above the price (background: `docs/frontend/01` §18).
- **The page facts already exist.** `PAGE_CTX` holds `type`, `productHandle`, `productName`, `collectionHandle` and `category` (background: `docs/frontend/03` §4.2).

### Goal and KPI
**What changes for the shopper:**
- On a product page, the first message a shopper types or speaks in a thread is sent together with that page's product.
- After the shopper moves to another product page, the next message is sent with the new product.
- Mo answers about that product from the first reply, instead of asking which product is meant.
- The backend puts the product's specs and stock into the model's pre-retrieved block (API_CONTRACT §2 "Optional `context`" → "Existing conversation"). The sold-out and checkout rules therefore apply from the first answer.
- Mo may still show the open product as a card. A `show_product` card is what mints and stamps the `_mo` attribution token (API_CONTRACT §10; background: `docs/frontend/05` §10.1, §10.3). Card tool calls are also what put a product into the conversation's discussed ids, and those ids decide the „Beraten & gekauft“ tier (background: `conversation-store.ts → persistTurn()` → `collectDiscussedProductIds()`; `mo-orders-store.ts` → `hasOverlap`; `docs/ORDER_ATTRIBUTION.md`).

**Population:** „Sitzungen mit getippter Frage auf einer Produktseite“. These are sessions whose first `source: "page"` turn of kind `product` falls in the range. That includes chats that started elsewhere and later moved to a PDP.

**KPIs.** The primary KPI and the target sample size per arm are pre-registered in the backend before the holdout starts (backend constant `PAGE_CONTEXT_EXPERIMENT`).
- **Primary:** share of sessions with a `product_cta_clicked` for a product other than the open PDP (`samePage` is not `true`), within 24 h of the first page-context turn.
- **Secondary (descriptive, no significance badge):**
  - share with `add_to_cart_clicked` within 24 h;
  - share whose first answer contains a card other than the page product's own `show_product` card (`otherCards > 0`);
  - share that opened the storefront CTA (`product_cta_opened`) after the first question. This should drop in the applied arm.
- **Guardrail:** share of sessions with an attributed order (`mo_orders` by session) within 7 days, overall and for the tier `assisted` („Beraten & gekauft“).
- **Diagnostics only:** "first answer contains any card" (`productCards > 0`) and attrition (page-context turns without a finished answer). `productCards` counts tool calls, not rendered cards (background: `docs/frontend/05` §13.2).

**How we read it (backend).** Admin → KPI → Beratung → „Seitenkontext auf Produktseiten“. It reads two server-only events (API_CONTRACT §5 server table):
- `page_context_applied {applied, kind, resolved, locale, pct}`, written when the request arrives (arm assignment);
- `page_context_answered {kind, productCards, otherCards}`, written when the turn finishes.

How the comparison works (full methodology: background `docs/ADMIN_DASHBOARD.md` §5.1a):
- **Arms.** When the switch is on, the backend runs a session-level holdout (`CHAT_PAGE_CONTEXT_HOLDOUT_PCT`, planned 20 %). It compares sessions with context (`applied: true`) against the holdout (`applied: false`).
- **Only one period is compared.** Only sessions whose rows all carry the pre-registered holdout share (`0 < pct < 100`) are compared, so different periods never get mixed. Sessions primed by a CTA or nudge click in the 24 h before the first question are excluded too.
- **`samePage`** on `product_cta_clicked` (task 3) separates clicks that only reopen the current PDP from clicks on alternatives and accessories.
- **`resolved: false`** shows handles the catalog does not know. This is the risk of translated handles on `/en` (background: `docs/frontend/06` §2.3).

### Contract references
- **API_CONTRACT §2 "Request body" → "Optional `context`":**
  - Shape: `{type, productId, productTitle?, recentlyViewed?, source?}`.
  - `source: "page" | "cta" | "nudge"` is optional. Absent or unknown values take today's CTA/nudge path ("no-op if the widget ships later").
  - "Typed turns (`source: "page"`)": the backend accepts only two shapes, `type: "product"` (any `recentlyViewed` is ignored) and `type: "browsing"` with exactly one `category` entry. Any other `source: "page"` context is dropped, and so is one without a user message.
- **API_CONTRACT §2 "Privacy":** send context with the first message and when it meaningfully changed. Never send it as a per-turn heartbeat.
- **API_CONTRACT §2 "Existing conversation (`messages` non-empty + valid `context`)":** the pivot path plus pre-retrieved grounding. This is the path the typed turn takes.
- **API_CONTRACT §2 "Fresh open":** nudge greeting, unchanged.
- **API_CONTRACT §5:**
  - "Product clicks (widget)": `product_cta_clicked` gains the optional `samePage: boolean`.
  - The server table lists `page_context_applied` and `page_context_answered` as **server-only**, so the widget never sends them.
  - `POST /api/kpi` acknowledges server-only names with 202 but does not store them.
- **Session id:**
  - The sid in `x-ms-session` / the KPI `sessionId` is the join key (API_CONTRACT §0 rule 6).
  - The holdout is assigned per sid.
  - What else the backend keys by the sid (API_CONTRACT §6) is unchanged by this task.
- **API_CONTRACT §12 (locale):** `x-ms-locale` and `locale` work as today. The server picks the DE or EN note.
- **API_CONTRACT §0:** rules 3 (additive), 13–14 (KPI data, server-only events), 16 (unknown tools), 19 (privacy posture), 22 (tone).

### Backend state
**Deployed on 2026-10-05** (backend `main`, „Seitenkontext auf Produktseiten“):
- `context.source` is accepted.
- With the switch on (below), a `source: "page"` context on a request with a user message gets a softer pivot note. In effect it says: „the user is writing from product page X; if the question is about a product and they name no other, they probably mean this one; for anything else ignore the note; never comment on the page“.
- `cta`, `nudge` and absent sources keep today's behaviour, including today's stronger CTA pivot note.
- For `source: "page"`, `type: "product"` ignores `recentlyViewed`. A `type: "browsing"` context is used only with exactly one category entry; every other trail is dropped.

**Switches** (API_CONTRACT §0 rule 3: new behaviour stays behind a switch, default off in code):
- `CHAT_PAGE_CONTEXT_ENABLED` (default off in code). While the switch is off, a `source: "page"` context is treated as if none had been sent: today's typed-turn behaviour. The server still records `page_context_applied {applied: false, pct: 100}`, which lets the backend verify the upload without changing anything for shoppers.
- After the live check and an observation window, the backend turns `CHAT_PAGE_CONTEXT_ENABLED` on. Later it sets a control-group share with `CHAT_PAGE_CONTEXT_HOLDOUT_PCT` (0–50, default 0).
- A held-out session is also treated as if no context had been sent.
- The response looks the same in every state. **The widget must not try to detect the switch or the holdout.**

**Server KPIs.** `/api/chat` writes `page_context_applied` when a valid `source: "page"` request with a user message arrives and `page_context_answered` when that turn finishes. Both are server-only.

**No-op if the widget ships later.**
- The `3e87341` widget never sends `source`, so nothing changes until this upload.
- If this widget ever hit an older backend, the backend would ignore `source` and apply today's CTA pivot note to typed PDP turns. That wording is stronger, but safe.

### Rules that do not change
API_CONTRACT §0 applies in full; for this task that means:
- **Page facts only, never user data.** The data class is the same as the CTA sends today: handle, title, page type.
- **No `recentlyViewed` trail on typed or spoken turns** (rule 19; API_CONTRACT §2 "Typed turns"). The server enforces this for `source: "page"`.
- **Context only on a send the user starts.** Never as a per-turn heartbeat (rule 19; API_CONTRACT §2 "Privacy").
- **KPI payloads carry ids, enums and booleans only:** the clicked product id, `pageType`, `samePage`. Never message text, product names, the browsing trail, raw URLs, tokens or emails (rule 13).
- **The widget never sends server-only events** (rule 14). The names are listed in API_CONTRACT §5; the server table includes `page_context_applied` and `page_context_answered`.
- **Tone rule:** copy references the page or category, never the visitor's behaviour (rule 22). This task adds no copy.
- **Consent:** consent copy comes only from the backend and is rendered verbatim, never pre-selected, with `consentTextShown` echoed byte for byte (rules 8–9). This task touches no consent surface.
- **Unknown tools render nothing** (rule 16).
- **Contract changes stay additive** (rule 3). Keep the `sendMessage(text, context?)` signature. Keep ES5, a single file and no build (rule 1).

### Tasks (in order)

#### 1. Attach page context to the first typed or spoken message on a PDP and after a product change (required)
- **Where (`ms-chat-widget.js`):**
  - New constant `CTX_LAST_KEY = 'ms-chat-ctx-last'`, next to `CAMPAIGN_TOKEN_KEY` (background: `docs/frontend/02` §4 row 39).
  - New helpers `pageCtxKey(ctx)` and `pageContextForSend()` in the "Send and SSE stream" section (background: `docs/frontend/02` §4 row 27).
  - Call `pageContextForSend()` in `onSend()` and `voiceSubmit()`, right before `sendMessage(text, ctx)`. The call must come after their existing `state.streaming || state.rateLocked` guards, and before `sendMessage()` pushes the optimistic user message.
  - **Write the key in `finalizeStream()`, not at `res.ok`.** Put it inside the existing branch that pushes the assistant message, which runs only when `asstParts` is non-empty and `sid === streamSid` (background: `docs/frontend/03` §6.3).
    - A cancelled turn (`startNewChat()`, `openConversation()`, `dropSessionHistory()`) never gets there, because its `cancelled` flag makes `finalizeStream()` a no-op (background: `docs/frontend/03` §13).
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
  - `conversationKey`, `campaignToken` and `customer` ride along exactly as today (background: `docs/frontend/03` §3.2).
  - Do not add `recentlyViewed`; the server would ignore it anyway.

  **Response:** the unchanged SSE stream (API_CONTRACT §2 "Response — SSE stream"), parsed and rendered as today.
- **Response handling:**

  | status | widget behaviour | KPI |
  | --- | --- | --- |
  | 200, stream finishes with content | As today. In addition, `finalizeStream()` writes `ssSet(CTX_LAST_KEY, streamSid + '\|' + pageCtxKey(chatBody.context))` whenever the body carried a context (typed, CTA or nudge) and `pageCtxKey()` is not null. This happens inside the branch that saves the assistant message (`asstParts` non-empty, `sid === streamSid`). | none new (`message_sent` stays `{}`) |
  | 200, SSE `error` chunk with **no** content | As today: the error line is appended and the user message stays without a reply (background: `docs/frontend/03` §11). The key is **not** written. The backend is stateless per request and never stored the pivot note, so the retry must carry the context again. | none |
  | 200, SSE `error` chunk after partial content | As today. The key is written, because the partial answer was grounded and is in the history. | none |
  | Turn cancelled (`startNewChat()`, `openConversation()`, sign-out, sid rotation) | As today: `finalizeStream()` is a no-op, so no key is written. | none |
  | 429 `rate_limited` | As today: rollback and `lockRateLimit()`. No key is written, so the next send carries the context again. | none |
  | 400 `payload_too_large` / `bad_request`, 401, 403, ≥ 500 | As today (background: `docs/frontend/03` §11). No key is written. | none |
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
  - **Product link opened in a new tab (`noopener`, fresh sessionStorage):** context once, on the first typed message there, even though the thread has history. This is acceptable under API_CONTRACT §2 "Privacy".
  - **Signed-in vs anonymous:** the same rule for both. Auth state, `conversationKey` and the not-yet-settled first send (background: `docs/frontend/03` §13) are unaffected.
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
  - **Variant:** do not add it (not part of this round).

#### 2. Mark CTA and nudge context with `source` (required)
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
  - the CTA as `p:<id it sent>` (on its own PDP this is the handle; background: `docs/frontend/03` §4.3);
  - the product nudge as `p:<handle>`;
  - a `browsing` nudge context returns `null` from `pageCtxKey()`, so nothing is written.
- **UI strings:** none.
- **Storage:** see task 1.
- **KPI:** unchanged. `product_cta_opened {productId}` and `nudge_clicked {pageType, contextual}` as today.
- **Failure mode:** unchanged.
- **Edge cases:**
  - `window.MS_CHAT.openWithProduct()` called from a non-PDP page still sends `source: "cta"`.
  - The CTA's numeric-id swap logic (background: `docs/frontend/03` §4.3) is unchanged.
  - The server never holds out `cta` or `nudge` context, and the switch does not affect it.

#### 3. `samePage` on `product_cta_clicked` (required; needed to read the effect)
- **Where:** the `ms-chat-widget.js → productButton()` click handler, and the fallback product-link handler in `buildAddToCart()` (the branch without `cartUrl`).
  - New helper: `function isSamePageProduct(id) { return PAGE_CTX.type === 'product' && !!PAGE_CTX.productHandle && String(id) === PAGE_CTX.productHandle; }`.
  - Compute it at click time.
- **Trigger and timing:** the existing „Zum Produkt“ click, unchanged. `track()` is called before the new tab opens, as today.
- **Request:** `POST {apiBase}/api/kpi`. As in every `track()` call, `timestamp` is the client clock as an ISO string (API_CONTRACT §5 "Request body"; background: `docs/frontend/05` §2.1):
  ```json
  { "event": "product_cta_clicked", "sessionId": "<sid>", "timestamp": "2026-10-06T09:12:33.120Z",
    "data": { "productId": "atx-treadmill-pro-fold", "samePage": true } }
  ```
  `samePage` is always a strict boolean: `false` off a PDP and for every other product.

  **Response:** never read (API_CONTRACT §5).
- **Response handling:** none (fire-and-forget, as today).
- **UI strings:** none.
- **Storage:** none.
- **KPI:** `product_cta_clicked` gains `data.samePage: boolean`.
  - The event name is unchanged. It still matches `%product%click%` (API_CONTRACT §5 "Widget events the backend reads by name"), so it keeps counting as a product click.
  - No new name is added. Nothing matches `%cart%` or `%checkout%`.
  - `productId` stays the catalog handle.
  - Data class: one boolean on an existing click event. No name, no trail, no URL.
- **Failure mode:** fail-silent (`track()`).
- **Edge cases:**
  - Variant refs come back from `/api/products` with the base handle as `id` (background: `docs/frontend/06` §2.3), so they compare correctly.
  - On `/en` with a translated handle the flag is `false`. Such chats are `resolved: false` anyway and excluded from the comparison.
  - Cards restored from history use the same click handler.

#### 4. Collection pages (optional, S)
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

#### 5. Correct the stale `PRIVACY POSTURE` comment above `PAGE_CTX` (required, no behaviour change; background: `docs/frontend/03` §4.4)
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

### Legal constraints
- **Data class:** only page facts are sent: the product handle, title and page type, plus the collection handle and title for task 4. That is the same data class the PDP CTA and the nudge already send (background: `docs/frontend/03` §4.3). No browsing trail goes out on typed or spoken turns, and the server drops any trail on `source: "page"`. Nothing leaves the browser that does not already leave it today in another user-started request.
- **When it is sent:** only with a request the user starts, and only on the first message of a thread and after a product change. That matches API_CONTRACT §2 "Privacy" ("not as a per-turn heartbeat") and §0 rule 19.
- **Device storage:** the only new storage is `sessionStorage['ms-chat-ctx-last']`. It is written only inside a send the user started, and it serves only the chat (it avoids re-sending the context), so it is strictly necessary under § 25 TDDDG.
- **KPI:**
  - No new widget event. `samePage` is a boolean on an existing click event, so this task adds no interaction-free event and no new § 25 TDDDG exposure (background: `docs/frontend/05` §13.3).
  - `samePage` together with `productId` does reveal that the click happened on that product's page. The product id already leaves the browser through `product_cta_opened` and `product_cta_clicked` (API_CONTRACT §5). Storing a boolean is more minimal than storing the page's product id server-side.
  - `page_context_applied` and `page_context_answered` are server-only and carry no product id.
- **Consent and served copy:** none. No served copy, no consent surface, no `lawyerApproved` or `enLegalReviewed` dependency, nothing pre-selected.
- **Holdout:** a server-side comparison on the pseudonymous sid. The widget is unaware of it. It adds a purpose for the sid (a controlled comparison with a deliberately degraded control arm). The page product also now travels with every typed PDP chat, not only after an explicit "about this product" click.
- **Lawyer to confirm:** the Datenschutzerklärung covers page facts sent with chat messages and quality comparisons with a control group on the session id (Art. 6(1)(f) GDPR). There is no new device storage beyond the chat-functional `ms-chat-ctx-last`. The sid itself is still an open § 25 TDDDG question (background: `docs/frontend/05` §13.3; `docs/ANWALTSDOSSIER.md` F-14, F-38 (c)). Get this confirmation before the holdout is switched on.
- **Tone rule:** the server's note forbids Mo to comment on which page the visitor is viewing.

### Deployment
- **Files to upload:** `assets/ms-chat-widget.js`. No CSS change.
- **Shared files to hand-edit in the live editor:** none. No change to `layout/theme.liquid`, the snippet or the templates.
- **MANIFEST:** one entry, shared with tasks 1 and 3 (one upload).
- **Switches** (backend only; the widget is not affected):
  - `CHAT_PAGE_CONTEXT_ENABLED=true` after the live check and an observation window of 2–3 days;
  - later a control group, `CHAT_PAGE_CONTEXT_HOLDOUT_PCT` (planned 20).
- **Live check:** the `ms-chat-ctx-last` marker in the served JS, found by the backend's `npm run verify:widget` (see the prompt's fingerprint list; background: `src/lib/widget-fingerprint.mjs`).

### Acceptance checklist
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
- [ ] **Backend live check** (run by the backend after the upload, not in the harness; report the test sid's first 8 characters in the PR): `npm run verify:live -- --since <upload day> --session <first 8 chars of the test sid>`, section „9 · Seitenkontext auf Produktseiten (A3)“, lists for that sid:
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

  The cross-cutting invariants hold:
  - every call carries `x-ms-session`, and guarded calls also `x-ms-chat-key`;
  - `/en` calls carry `locale=en`;
  - no server-only KPI events;
  - no unmocked requests.
- [ ] No console errors, no new hard-coded legal text, no pre-selection, no server-only events.
- [ ] Screenshots DE and EN (desktop 1280, mobile 390) of every new or changed surface. None is expected; attach one PDP chat answer per locale as evidence.

---

## Task 3 — Renew the attribution token after a live consultation; blank the cart marker when the session ends (backend deployed 2026-10-05)

For the frontend agent that owns `ms_shopify_clone`. Attachments: see the prompt. The contract is `API_CONTRACT.md` (§10, §0, §5), `ACCOUNT_CONTRACT.md` and `CONSENT_CONTRACT.md`; where this task and a contract file disagree, the contract file wins.

References marked "(background: …)" point into the backend repo; its chapters `docs/frontend/01`–`07` are the backend's code-verified description of your widget. They are background in the backend repo, not attached — everything needed is written out here. In your own repo, the code is the source of truth.

### Baseline
Builds on widget `main` at `3e87341` (live since 2026-10-04, MANIFEST 2026-10-04 b).
- The widget mints `POST /api/attribution/token` only when no token is cached for the current sid (`moAttrEnsure()`; background: `docs/frontend/06` §8.2, §8.4).
- It re-stamps the cached token on every page load (`initAttribution()`; background: `docs/frontend/05` §10.2), and the sid has no expiry (background: `docs/frontend/06` §8.7). A device whose token the backend deleted keeps stamping that dead token until the sid rotates.
- `moAttrReset()` drops the cache on rotation, but the `_mo` already on the Shopify cart stays (background: `docs/frontend/06` §8.5).

### Goal and KPI
- **Task 1:** a device whose token was deleted gets a fresh token on its next live product consultation. Deletion causes:
  - the backend's nightly retention: 37 days after minting (the 30-day attribution window + 7 days) while the backend switch `MO_ATTRIBUTION_SESSION_ANCHOR` is off (the code default); with the switch on, 37 days after the device's last product consultation, at most max(`KPI_RETENTION_DAYS` or 180, 37) days after minting (180 with the defaults);
  - an erasure, at once (API_CONTRACT §11.1).

  KPI (backend): „Mo-zugeordneter Umsatz (Bestell-Webhook)“, rows „Beraten & gekauft“ and „Beraten, anderes gekauft“. The note „… markierte Bestellungen im Zeitraum ohne Zuordnung: … mit unbekannter oder gelöschter Markierung …“ (`unknown_token`) on the KPI tab should fall.
- **Task 2:** privacy hygiene on shared browsers. The cart stops carrying a marker of a session that signed out, was erased, was ended by the server, or whose analytics consent was withdrawn. KPI: none (it removes possible misattribution; not measurable).

### Contract references
- **API_CONTRACT §10** `POST /api/attribution/token`: headers `x-ms-chat-key` + `x-ms-session`, no body; response `{ ok, token, cartAttributes }` with `Cache-Control: no-store`; error table 400/401/403/429/503/500. "Lifetime and renewal": the same token while it exists, a new one after the backend deleted it (retention, erasure); the widget MAY call again after a live product consultation. "Ending the marker": blank every key of the cached `cartAttributes` with `""` when the session ends or analytics consent is withdrawn (SHOULD).
- **API_CONTRACT §5:** this task adds no event; the server-only names (rule 14) stay unsent.
- **API_CONTRACT §0:** rule 7 (raw sid never in a cart attribute or URL; attribution only with analytics consent), rule 13 (KPI data), rule 14 (server-only events), rule 18 (fail silent).
- **ACCOUNT_CONTRACT §5.1:** when a sign-in ends (sign-out, erase, a sign-in the server reports ended), the widget drops the stored chat and continues on a fresh sid — task 2 blanks the marker before that.

### Backend state
- Deployed on 2026-10-05 (backend `main`): with the backend switch `MO_ATTRIBUTION_SESSION_ANCHOR` (default off in code) on, the 30-day attribution window counts from the device's latest product consultation instead of the token's minting, and widget tokens of devices that keep consulting are kept (up to the cap above). Marked orders the backend cannot attribute are counted (server-only `mo_order_marker_unresolved`).
- No contract change: the endpoint has always returned the same token while the session's token exists and minted a new one once it is gone (API_CONTRACT §10 "Lifetime and renewal").
- The switch is independent: this task helps with it on or off.
- No-op if the widget ships later: a renewal call returns the same token while it exists.
- Rate limit: shared `kpi` bucket (120 req / 60 s). One extra call per page view at most.

### Rules that do not change
API_CONTRACT §0 applies in full; for this task that means:
- No mint, renewal or stamp unless `window.Shopify.customerPrivacy.analyticsProcessingAllowed() === true` (`moAnalyticsAllowed()`), re-checked at stamp time (rule 7).
- The raw sid never goes into a cart attribute or URL. Only the server's `cartAttributes`, passed through unchanged as a flat object (rule 7).
- KPI events: ids and enums only; never the token (rule 13). Never send server-only events (rule 14; the names are listed in API_CONTRACT §5). This task adds no event.
- Fail silent: never block chat or shopping (rule 18).
- Unknown tools render nothing (unchanged, rule 16).

### Tasks (in order)

#### 1. Renew the token after a live product consultation (required)
- **Where:** `ms-chat-widget.js → finalizeStream()`. When a streamed assistant turn finishes without `streamErrored`, call a new `moAttrRenew()` next to `moAttrEnsure()`.
- **Trigger and timing:** all of these must hold:
  - the finished assistant message contains a part of type `tool-show_product`, `tool-compare_products`, `tool-add_to_cart` or `tool-suggest_showroom` (the backend's consultation tools);
  - `moAttrLoad()` returns a cached token for the current sid;
  - `moAnalyticsAllowed()` is true.

  At most once per page view (`moAttrRenewed`). Never from restored history (`renderRestoredAssistant()`), never from `initAttribution()`. Without a cached token, nothing changes: the `show_product` render mints as today.
- **Request:** `POST {apiBase}/api/attribution/token`, headers `x-ms-chat-key` + `x-ms-session`, no body, no `Content-Type` (as today's mint; background: `docs/frontend/06` §8.2). Single-flight via `moAttrInflight`. Capture `sid` before the fetch.
- **Response handling:**

  | status | widget behaviour | KPI |
  |---|---|---|
  | 200, `moAttrValid()`, token ≠ cached | if the sid is unchanged: write `moAttr` and `localStorage['ms-mo-attr'] = {sid, token, cartAttributes}`, then `moStampCart()` (consent re-checked) | none |
  | 200, same token | nothing | none |
  | 200 invalid, 400/401/403/429/5xx, network | keep the cached token; no retry this page view; do **not** set `moAttrFailed` (the „Zur Kasse“ path keeps stamping the cached token) | none |
  | any, sid changed meanwhile (`onSidChangedElsewhere()`, rotation) | drop the response (the sid-rotation race; background: `docs/frontend/05` §10.3) | none |

- **UI strings:** none.
- **Storage:** `ms-mo-attr` (existing key, overwritten); in-memory `moAttrRenewed` (page view).
- **KPI:** none. The backend reads the effect from `mo_order_marker_unresolved {reason:'unknown_token'}` (its V3 check, `npm run verify:live` section 7b). No new names; nothing collides with `%cart%` / `%checkout%`.
- **Failure mode:** fail silent.
- **Render-path race:** a `show_product` card stamps through `moAttrOnProductCard()` after its async `/api/products` hydration, so a render stamp issued with the old token just before the renewal answer arrives can land after the renewal's stamp of the new one. Read the token at stamp time (as `moStampCart()` does through `moAttrLoad()`) and skip the render-path stamp while a renewal is in flight.
- **Edge cases:**
  - stream aborted by a new chat or by opening a conversation (`abortActiveStream()`) → no renewal;
  - signed-in and anonymous behave the same;
  - voice mode the same;
  - `/en` the same;
  - a consent banner still loading (API missing) → no renewal on this page view;
  - several product turns on one page → one call.

#### 2. Blank the cart marker when the session ends or consent is withdrawn (recommended — API_CONTRACT §10 "Ending the marker" says SHOULD; the open legal question F-37 may make it required, background: `docs/ANWALTSDOSSIER.md` §20)
- **Where:**
  - In `signOut()`, `clearAfterErase()` and `endedSignInCleanup()`, before `dropSessionHistory()` / `rotateSession()` → `moAttrReset()` clears the cache.
  - In the `visitorConsentCollected` listener in `initAttribution()`, when `moAnalyticsAllowed()` is now false and a token is cached.
- **Not** on anonymous „Neuen Chat starten“ or `mo_new=1`: the same person keeps shopping, and the backend window bounds it.
- **Request:** `fetch('/cart/update.js', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ attributes: blanked }), keepalive:true })`. `blanked` has every key of the cached `cartAttributes` with value `""`. Same origin, fire-and-forget. Without a cached entry, skip: the widget does not hard-code the key.
- **Consent gate:** not gated. It removes a marker and sends nothing for analytics.
- **Response handling:** none (fail silent). Verify once on live that `/cart.js` no longer lists `_mo` after the call, i.e. that Shopify removes an attribute set to an empty string.
- **UI strings:** none.
- **Storage:** none new.
- **KPI:** none.
- **Edge cases:**
  - erase answered with 401 → still blank, then clean up;
  - another tab rotated first → its cache is gone, skip;
  - a cart already ordered (empty) → harmless.

### Legal constraints
- Task 1 calls the endpoint only with analytics consent and only after a live chat turn (an interaction), so it adds no interaction-free call (background: `docs/frontend/05` §13.3).
- Task 2 deletes a marker; nothing leaves the browser except the same-origin cart update.
- No served copy, no `lawyerApproved` / `enLegalReviewed` surface.
- Context (background): `docs/ANWALTSDOSSIER.md` §20, F-37.

### Deployment
Files to upload: `assets/ms-chat-widget.js`. Shared files to hand-edit: none. MANIFEST: one entry, shared with tasks 1 and 2 (one upload). Fingerprint: this task adds no marker (see the prompt). Switches to flip after the live check: none (independent of `MO_ATTRIBUTION_SESSION_ANCHOR`).

### Acceptance checklist
- [ ] Harness, mock token endpoint returns token A, then B. With A cached, a streamed `show_product` turn sends exactly one POST with `x-ms-chat-key` + `x-ms-session` and no body; the cache becomes B; one `/cart/update.js` with `{attributes:{_mo:B}}`.
- [ ] A second product turn on the same page view → no second POST. A compare-only or showroom-only turn with a cached token → one POST.
- [ ] Same token returned → no cache write, no extra stamp.
- [ ] A `show_product` card whose `/api/products` hydration resolves while the renewal POST is in flight (no stamp yet on this page view) → no `/cart/update.js` with A is issued after the stamp of B; the last stamp of the page view carries B.
- [ ] Page load with restored history containing product cards → no renewal POST.
- [ ] `analyticsProcessingAllowed() === false` or the API is missing → no POST, no stamp.
- [ ] 401/403/429/503 or network on renewal → cache unchanged; „Zur Kasse“ still stamps the cached token.
- [ ] Sid rotated while the POST is in flight → response ignored, cache of the new sid untouched.
- [ ] Task 2: sign-out, erase and server-ended sign-in → one `/cart/update.js` with `{attributes:{_mo:""}}` before the reset; anonymous „Neuen Chat starten“ → none; consent withdrawn via the banner → one blank call.
- [ ] Live (with the backend, after the upload): the backend deletes a test token by hand (`DELETE FROM mo_attribution_tokens WHERE token = '<test>'`). The next product turn writes a new token to `ms-mo-attr`, and `/cart.js` shows the new `_mo`.
- [ ] Harness: new checks added and passing in DE + EN, 1280 + 390.
- [ ] No console errors; no new hard-coded legal text; no pre-selection; no server-only events; no new KPI event.
- [ ] Screenshots: none (no visible surface changes); state so in the PR.
