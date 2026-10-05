# Consent surfaces — frontend contract (rendering rules)

> **What this file owns (canonical).** When and how the widget shows and renders the
> marketing-consent surfaces: the golden rules, the per-surface behaviour, verbatim rendering, the
> `consentTextShown` echo, the `placement` / `variant` echo, decline as easy as accept, and what to
> show for each answer. **No JSON shapes here** — copy payloads: [API_CONTRACT.md](./API_CONTRACT.md)
> §7.4; capture submit: API_CONTRACT §7.1; sign-in opt-in submit:
> [ACCOUNT_CONTRACT.md](./ACCOUNT_CONTRACT.md) §6.2; when a signed-in customer is asked
> (`optInActionable`, anti-nag, expired DOI): ACCOUNT_CONTRACT §6.1; KPI names and data:
> API_CONTRACT §5; locale: API_CONTRACT §12. Legal rationale and backend mechanics live in the
> backend repo's `docs/CONSENT_FLOW.md`; the widget does not need them. If this file and the
> backend code disagree, the code wins and this file gets fixed.

The widget renders consent text **served by the backend** and never hard-codes it: the served
`consentTextShown` is the Art. 7 audit record, and a hard-coded snapshot would silently drift from
what the backend stores. One copy version (`v5`) spans every surface; the widget does not read
`version`.

| Surface | Who sees it | E-mail field | Mechanic | Copy | Submit |
|---|---|---|---|---|---|
| **In-chat capture form** (§4) | anonymous and e-mail-only visitors; a signed-in customer only through the `422` fallback (ACCOUNT_CONTRACT §6.0) | **yes** (typed) | two checkboxes, both unchecked | `offer_email_summary` tool output or `GET /api/consent-copy` | `POST /api/capture-email` |
| **Marketing ask after sign-in** (§3): a popup in the signed-in session, an inline card right after a sign-in mid-conversation | a signed-in customer with `marketing.optInActionable === true` (ACCOUNT_CONTRACT §6.1) | **no** (the backend holds the verified address) | button-consent | `GET /api/consent-copy?surface=signin` | `POST /api/account/marketing-opt-in` |
| ~~Chat consent gate~~ (§2) | retired in the widget | — | — | (`surface=chat`) | (`POST /api/chat-marketing-opt-in`) |

**Every surface is the same double opt-in.** Accepting only sends a confirmation e-mail; marketing
is permitted **only after** the customer clicks that link. **Nothing is ever pre-selected** — a
Shopify account never implies consent, and neither does typing an e-mail.

**One consent, shared with the shop.** The marketing consent is the one the shop's own newsletter
uses (checkout checkbox, account). A confirmation click and an unsubscribe in Mo are passed on to
the shop; nothing for the widget to do. What to show after an accept, on every surface (the
`marketing` object of the answer):

| Answer | Show |
|---|---|
| `status: "pending"` and `doiEmailSent: true` | ask the customer to confirm through the link in the e-mail — not subscribed until then |
| `alreadyConfirmed: true` (`status: "confirmed"`, no mail sent) | „already subscribed“, nothing more to do — no inbox hint |
| anything else, including `status: "pending"` with `doiEmailSent: false` and `status: "none"` (a suppressed address) | a neutral thank-you — never „already subscribed“, never an inbox promise |

On the capture form the marketing line is shown only when the marketing box was ticked.

---

## 1. The golden rules (do not break these — Abmahnung-sensitive)

- **Nothing pre-selected, ever.** Checkboxes render UNCHECKED; on the button-consent surfaces no
  option is highlighted as pre-chosen (CJEU C-673/17 *Planet49*; a classic UWG Abmahnung
  trigger). Making the surface **prominent** is fine; pre-selection is not.
- **Render the served strings verbatim**, as text (`textContent`) — never translated, re-composed,
  truncated or passed through the widget's own string table.
- **Echo `consentTextShown` byte for byte**, taken from the copy object that was rendered; never
  compose it client-side. The headline, `benefits`, `returningHint`, button captions and links are
  not part of it.
- **Button-consent** (the sign-in surfaces; mechanic and wording lawyer-approved): the served
  `marketingLabel` + `consentFooter` are **fully visible** (no truncation, no "read more"). The
  explicit **„Ja, Angebote aktivieren“** tap is the affirmative act; **decline is equally
  reachable** and not visually buried. `marketingConsent: true` is sent **only on the accept tap**
  — never on dismiss, never automatically.
- **Benefit framing only in served copy:** the `headline` and, on `surface=signin`, the `benefits`
  bullets (headline wording lawyer-approved; bullet wording chosen by the owner, 2026-10-05) —
  never in widget-authored text. No dark patterns: no countdowns, no fake urgency, no concrete
  discount amount. Framing is static per locale (no placeholders, nothing about the visitor's
  behaviour). Neither is part of `consentTextShown`.
- **Show the imprint + privacy links** (`imprintUrl`, `privacyUrl`) next to the consent block.
- **Fail closed.** Render a surface only when its served copy loaded and is valid: its labels
  (`marketingLabel`; the capture form also `transactionalLabel`) and `consentTextShown` are
  present, and on the sign-in surfaces also `lawyerApproved === true` (API_CONTRACT §0 rule 10;
  checking `lawyerApproved` on the capture form is recommended, not required). Otherwise render
  nothing — there is no fallback text.
  `lawyerApproved` is `true` in the served copy (German lawyer-approved; English approved as its
  translation, `enLegalReviewed: true`).
- **One language end to end.** Fetch the copy in the storefront language (`?locale=en` on `/en`,
  API_CONTRACT §12) and submit with the same `locale`, so the echo matches the canonical text.
- **KPI data carries ids and enums only** — never consent text, e-mail addresses or names
  (API_CONTRACT §0, §5).

---

## 2. Chat consent gate — retired

Not shown by the widget since 2026-10-01; anonymous visitors get the sign-in popup instead
(ACCOUNT_CONTRACT §6). The backend still serves `GET /api/consent-copy?surface=chat`
(API_CONTRACT §7.4) and `POST /api/chat-marketing-opt-in` (API_CONTRACT §7.6) for compatibility —
do not build on them. The `consent_gate_*` events carry `surface: "signin"` only.

---

## 3. Marketing ask after sign-in — button-consent

**Who and when:** ACCOUNT_CONTRACT §6.1 — only when `/api/auth/me` answers `signedIn: true` and
`marketing.optInActionable === true`, i.e. after the one-time code was redeemed
(ACCOUNT_CONTRACT §2a). Two placements: a **popup** in the signed-in session (decided shortly after
a sent message, once per tab session) and the **inline card** right after a chat sign-in in the
middle of a conversation. The account removes only the "type your e-mail" step: the customer is
signed in, so the backend holds their verified address.

### 3.1 What to render from `GET /api/consent-copy?surface=signin`

- **Request:** `GET {BASE_URL}/api/consent-copy?surface=signin&locale=de|en` with only the
  `x-ms-session` header (no shared secret; origin allow-list). Add no other request header — the
  backend's CORS allow-list is fixed (API_CONTRACT §0). Payload: API_CONTRACT §7.4.
- **Render, in this order:** the `headline` (framing); the `benefits` list (framing, below);
  the `marketingLabel` (the consent text, fully visible); the `consentFooter`; the imprint and
  privacy links (`imprintUrl`, `privacyUrl`); then the accept „Ja, Angebote aktivieren“ and an
  equally reachable decline. Keep `consentTextShown` and `variant` for the submit (§3.2).
  `version`, `locale` and `enLegalReviewed` are not rendered.
- **`benefits` — all or nothing.** Render a list (popup and card, under the headline, each item
  with `textContent`) only when `benefits` is an array of 1–4 strings, each non-empty after trim
  and at most 200 characters. Otherwise render **no** list — never a subset, never bullets of the
  widget's own. `benefits` is optional: a missing or invalid value never hides the popup or the
  card.
- **`variant`** — take it from the copy object that was rendered; keep it only when it matches
  `^[a-z0-9_-]{1,32}$`, otherwise leave it out. Never render it.
- **Cache per session.** Key any in-memory copy by the session id and fetch again after the
  session id changes. While the backend runs a framing test (more than one variant active) the
  variant is assigned per session from `x-ms-session` and the answer is
  `Cache-Control: private, no-store`; by default only variant `a` is served and the answer is
  public for 60 s.

### 3.2 Submitting the accept

Shape, answers and error codes: ACCOUNT_CONTRACT §6.2. Rules for the widget:

- POST **only** on the accept tap, with `marketingConsent: true`.
- `consentTextShown`: the rendered copy's string, byte for byte. `locale`: the language the copy
  was fetched in.
- `placement`: `"popup"` from the popup, `"signin_return"` from the inline card after a chat
  sign-in. `"value_moment"` is reserved for an ask at a value moment — never send it
  unless a task introduces that ask.
- `variant`: the rendered copy's `variant` when it is valid (§3.1), else omit it.
- Send the same `placement` and `variant` in the `consent_gate_*` KPI data
  (`{ surface: "signin", placement, variant? }`, API_CONTRACT §5): `consent_gate_shown` once per
  tab session for the ask; `consent_gate_accepted` only after a `2xx`, and only for the session the
  ask was rendered for; `consent_gate_declined` on decline; `consent_gate_dismissed` on Esc /
  backdrop (popup). `shown` and `declined` feed the backend anti-nag (ACCOUNT_CONTRACT §6.1).
- **Decline / dismiss:** POST nothing. Remember a decline on the device (30 days) and a dismissal
  for the tab session.
- **Answers:** what to show for a `2xx` → the table at the top. `422 no_verified_email` → offer the
  capture form (§4; mind ACCOUNT_CONTRACT §6.0). `401` → the sign-in ended (ACCOUNT_CONTRACT §5.1).
  `429` → wait `Retry-After`, keep the decline usable. `503` / `500` / network → "not possible right
  now", allow a retry. An error is never an acceptance.

### 3.3 Confirmation + withdrawal

The DOI confirmation link (`GET /api/confirm-marketing`, API_CONTRACT §7.2) and the unsubscribe
link in every marketing e-mail (API_CONTRACT §7.3) are the **same** for all surfaces — nothing
widget-side to build. Consent is withdrawable any time through that link or in the shop; both
sides stay in step. An unconfirmed DOI expires (`MARKETING_DOI_EXPIRY_DAYS`, default 7); the ask
may then come back (ACCOUNT_CONTRACT §6.1).

---

## 4. In-chat capture form — two unchecked checkboxes

- **Who:** anonymous and e-mail-only visitors, through the `offer_email_summary` tool card
  (API_CONTRACT §2) or a widget entry point such as „Per E-Mail teilen“. Never a signed-in
  customer, except the `422 no_verified_email` fallback of §3.2 (ACCOUNT_CONTRACT §6.0).
- **Copy:** the tool output's `consentCopy`, or `GET /api/consent-copy` (no `surface`;
  API_CONTRACT §7.4).
- **Render:** the e-mail field; `returningHint.text` near it only when `returningHint.enabled ===
  true` (informational, not consent text); the **transactional** checkbox (`transactionalLabel`)
  and the **marketing** checkbox (`marketingLabel`), each a real label with a real checkbox, both
  **unchecked**, text never truncated; the `consentFooter`; the imprint and privacy links; a
  decline.
- **This surface is NOT button-consent:** the two ticks are the acts. The form exists to send the
  summary, so a submit needs the transactional tick; without it the backend answers
  `400 transactional_consent_required` — show the targeted hint at the first checkbox. The
  marketing tick is optional.
- **Submit** the capture `consentTextShown` (both labels + footer) byte for byte with every submit,
  whatever was ticked, and `transactionalConsent` / `marketingConsent` exactly as ticked.
- **After a `2xx`:** confirm the summary; add the marketing line from the table at the top only
  when the marketing box was ticked. Shape, errors and limits: API_CONTRACT §7.1.

---

## 5. Principles that never change

- Sign-in is **identity only**; it never opts anyone into marketing.
- Every marketing opt-in — a capture-form tick or a sign-in accept — is a **separate, explicit
  act** the customer chooses. On Mo's surfaces the double opt-in is the **only** path to marketing
  consent, and nothing is ever pre-selected.
- A typed e-mail is consent only for what was ticked.
- A consent the customer gave in the shop counts too — that is why an already-subscribed address
  is not asked again (ACCOUNT_CONTRACT §6.1) and is answered „already subscribed“.

---

## Appendix A — changes since 2026-10-01

Present-tense rules above are complete; this list only says what is new relative to a widget
built before the date.

| Date | Change | Section |
|---|---|---|
| 2026-10-01 | The chat consent gate is retired in the widget; anonymous visitors get the sign-in popup, signed-in customers the popup after sign-in. | §2, §3 |
| 2026-10-05 | Copy `v5`: `surface=signin` serves `benefits` and `variant`; per-session answer while a framing test runs. The widget renders the served bullets instead of its own. | §1, §3.1 |
| 2026-10-05 | The accept echoes `placement` and `variant`, also in the `consent_gate_*` data. | §3.2 |
| 2026-10-05 | A suppressed address is answered `status: "none"` (neutral thank-you) on every opt-in endpoint. | top table |
| 2026-10-05 | The English consent copy is approved as the translation of the German (`enLegalReviewed: true`). | §1 |
