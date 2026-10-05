# Consent flow — frontend contract (capture form + marketing surfaces)

> **Synced copy.** Canonical source is the backend repo (`docs/CONSENT_FLOW.md`
> + `src/lib/consent-copy.ts`). Whenever the backend copy or contract changes,
> re-sync this folder. **If anything here disagrees with the code, the code
> wins.**

This is what the storefront widget needs to render the marketing-consent
surfaces. There are **three** of them, all on **consent copy v4**, all serving
their strings from the backend so the widget **never hard-codes** consent text
(the served `consentTextShown` IS the Art. 7 audit record — a hard-coded snapshot
would silently drift from what we store).

| Surface | Who sees it | Email field? | Mechanic | Submit endpoint |
|---|---|---|---|---|
| **In-chat capture form** | anyone in the chat | **yes** (user types it) | two checkboxes (unchanged) | `POST /api/capture-email` |
| ~~Chat consent gate~~ — **not shown by the widget since 2026-10-01** (replaced by the sign-in popup for anonymous visitors); the endpoints stay for compatibility | — | — | — | (`POST /api/chat-marketing-opt-in`, unused) |
| **At-sign-in marketing opt-in** — since 2026-10-01 a **popup after sign-in** (the main ask), plus the inline card after a mid-conversation sign-in | a **signed-in** customer with `marketing.optInActionable === true` | **no** (we hold the verified email) | button-consent (v4) | `POST /api/account/marketing-opt-in` |

**All three are the SAME double-opt-in.** Accepting only sends a confirmation
email; marketing is permitted **only after** the customer clicks that link.
**Nothing is ever pre-selected**, on any surface — a Shopify account NEVER
implies consent, and neither does typing an email.

**One consent, shared with the shop.** The marketing consent is the same one
the shop's own newsletter uses (checkout checkbox, account). So an address that
is **already subscribed** — in Shopify or through an earlier Mo DOI — gets **no
second confirmation email**: every opt-in endpoint then answers
`marketing.status: "confirmed"`, `alreadyConfirmed: true`,
`doiEmailSent: false`. Show "already subscribed", not "check your inbox". A
confirmation click and an unsubscribe in Mo are passed on to the shop; nothing
for the widget to do.

---

## 1. The golden rules (do not break these — Abmahnung-sensitive)

- **Nothing pre-selected, ever.** Checkboxes render UNCHECKED; on the
  button-consent surfaces no option is highlighted as pre-chosen. (CJEU
  C-673/17 *Planet49*; a classic UWG Abmahnung trigger.) Making the surface
  **prominent** is fine and encouraged; pre-selection is not.
- **Render the served strings verbatim** and **echo `consentTextShown` back
  unchanged**. Don't reformat, translate, or re-compose it.
- **Button-consent (v4, lawyer-approved):** the served `marketingLabel` +
  `consentFooter` must be **fully visible** (no truncation, no "read more"
  hiding the consent text). The explicit **"Ja, Angebote aktivieren"** tap is
  the affirmative act; **decline must be equally reachable** (no visual
  burying). `marketingConsent: true` is **only sent on the accept tap** —
  never on dismiss, never automatically.
- **Benefit framing is allowed in the `headline`** (personalised offers +
  exclusive discount promotions — this wording is lawyer-approved), but still
  **no dark patterns**: no countdowns, no fake urgency, no concrete discount
  amount. The `headline` is NOT part of `consentTextShown`.
- **Show the imprint + privacy links** (`imprintUrl`, `privacyUrl`) next to the
  consent block.
- **`lawyerApproved`** in the payload is **`true`** — the v4 copy and the
  button-consent mechanic are lawyer-approved and cleared for real users.
  (Semantics: `false` would mean the copy is not yet legally signed off —
  render **nothing** while it's `false`.)

---

## 2. Chat consent gate (v4) — sign-in first

> **Retired in the widget (2026-10-01).** Anonymous visitors now get the
> sign-in popup instead (`login_gate_*` events, `API_CONTRACT.md` §5). This
> section stays as the contract of `surface=chat` and
> `POST /api/chat-marketing-opt-in`, which the backend still serves; do not
> build on it.

Shown **once per session** to an **anonymous** user after their **first chat
message**. Since 2026-10 the gate **leads with sign-in**: the primary action is
"Mit Kundenkonto anmelden"; the typed-email marketing opt-in (Accept/Decline,
marketing-only — no transactional consent, no summary email) is the
alternative for people without a shop account.

### 2.1 Fetch the copy — `GET /api/consent-copy?surface=chat`

Same guard as the other consent-copy calls (origin allowlist + rate limit; no
shared secret — these are public strings already shown to users). A CORS
`OPTIONS` preflight is supported. Pass `?locale=en` on `/en`.

```jsonc
// 200 OK  (Cache-Control: public, max-age=60, stale-while-revalidate=300)
{
  // Sign-in-first block — UI chrome, NOT consent text, never part of consentTextShown.
  "signIn": {
    "preferred": true,                       // lead with the sign-in button
    "headline": "Schon Kunde bei motion sports?",
    "body": "Melde dich mit deinem Kundenkonto an — dann kennt Mo deine Bestellungen und berät dich persönlich.",
    "buttonLabel": "Mit Kundenkonto anmelden",
    "alternativeLabel": "Kein Konto? Angebote per E-Mail erhalten",  // reveals the typed-email consent block below
    "loginPath": "/api/auth/shopify/login"  // relative to the BACKEND base URL
  },
  "version": "v4",
  "headline": "Persönliche Angebote und exklusive Rabatt-Aktionen — abgestimmt auf deine Beratung.",  // framing only — NOT consent text
  "marketingLabel": "Ja, schickt mir persönliche Angebote und exklusive Rabatt-Aktionen an diese E-Mail-Adresse — nur für Abonnenten. Jederzeit abbestellbar.",  // the consent text — render FULLY VISIBLE
  "consentFooter": "Verarbeitung durch motion sports gemäß Datenschutzerklärung; Widerruf jederzeit möglich.",
  "consentTextShown": "Ja, schickt mir persönliche Angebote … | Verarbeitung durch motion sports …",  // echo this back VERBATIM
  "imprintUrl": "https://motionsports.de/pages/impressum",
  "privacyUrl": "https://motionsports.de/policies/privacy-policy",
  "lawyerApproved": true
}
```

Render, when `signIn.preferred` is `true`:

1. **First** the sign-in block: `signIn.headline`, `signIn.body` and a button
   `signIn.buttonLabel` that starts the Customer Account sign-in as a
   **top-level redirect** to `{BASE_URL}{signIn.loginPath}?session={session_id}&return_url={current storefront URL}`
   (exactly the login of [`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §2).
   After the return (`?ms_auth=ok`) call `/api/auth/me`: show the at-sign-in
   card (§3) only when `marketing.optInActionable === true` — a customer who
   is already subscribed (Shopify or Mo) is **not** asked again.
2. **Then**, behind `signIn.alternativeLabel`, the typed-email consent block:
   the `headline`, the email input, the fully-visible `marketingLabel` +
   `consentFooter`, the imprint/privacy links, and the two actions — the
   affirmative **"Ja, Angebote aktivieren"** button and an equally-reachable
   decline. Nothing pre-selected.

A widget that ignores `signIn` keeps the previous typed-email gate unchanged
(the field is additive). Never add the `signIn` strings to `consentTextShown`.

### 2.2 Submit the accept — `POST /api/chat-marketing-opt-in`

A widget XHR with the **same guards as `/api/capture-email`** (origin
allowlist + `x-ms-chat-key` + `x-ms-session`):

```
POST {BASE_URL}/api/chat-marketing-opt-in
Headers:
  x-ms-chat-key: {shared secret}
  Origin:        {storefront origin}
  x-ms-session:  {session_id}
  Content-Type:  application/json
Body:
{
  "sessionId": "b3c1…",                      // optional; falls back to x-ms-session
  "email": "<the typed email>",
  "marketingConsent": true,                  // ONLY on the actual accept tap — never hard-code
  "consentTextShown": "<the served surface=chat consentTextShown, echoed verbatim>",
  "locale": "de",
  "trigger": "chat_gate"
}
```

```jsonc
// 200 OK
{
  "ok": true,
  "marketing": {
    "status": "pending",        // "pending" → DOI email sent; "confirmed" → already subscribed
    "doiEmailSent": true,
    "alreadyConfirmed": false   // true when the address already held the consent (earlier Mo DOI
                                // or subscribed in the shop) — then doiEmailSent is false
  }
}
```

- `400 invalid_email` — the typed address didn't validate. Show an inline
  email-field hint.
- `400 marketing_consent_required` — `marketingConsent` wasn't `true`. (Should
  be unreachable if the POST only fires on the accept tap.)
- `429 rate_limited` — carries `Retry-After` (chat bucket, plus a
  per-recipient DOI cap of 3/hour).
- `503 upstream_unavailable` — consent couldn't be stored; let the user retry.

After a `pending` response, tell the user to **check their inbox and click the
confirmation link** — they are **not** subscribed until they do. After a
`confirmed` response (`alreadyConfirmed: true`) no email was sent — tell them
they are already subscribed.

**Returning-customer memory:** after a success response the widget MAY attach
the captured email as `customer.email` on this session's subsequent
`/api/chat` requests (same rules as after `/api/capture-email`: in-memory
only, this session only, never from `localStorage`) — the backend records the
capture against the session, so the memory verification passes.

**Decline/dismiss:** POST nothing to the opt-in endpoint. Emit the KPI event
(§5 of `API_CONTRACT.md`: `consent_gate_declined` / `consent_gate_dismissed`
with `{ surface: "chat" }`) and don't show the gate again this session.

### 2.3 KPI events

The gate emits `consent_gate_shown` / `_accepted` / `_declined` /
`_dismissed` via `POST /api/kpi`, payload `{ surface: "signin" | "chat" }` —
since 2026-10-01 only `signin` (§3). The `starter_shown` / `starter_clicked`
events are **retired**.

---

## 3. At-sign-in marketing opt-in — button-consent since v4

Since the widget of 2026-10-01 this is a **popup right after the sign-in** (the
signed-in welcome screen no longer shows the card) and still the inline card
after a mid-conversation sign-in. Show either **only** when
`/api/auth/me` answers `signedIn: true` **and** `marketing.optInActionable: true`
— after the sign-in was completed with the one-time code
([`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §2a). KPI events
`consent_gate_*` with `{ surface: "signin" }`.

The account removes **only** the "type your email" step: the customer is signed
in (tier 3), so we already hold their **verified** Shopify email and don't ask
for it again. Everything else is identical to the chat gate.

### 3.1 Fetch the copy — `GET /api/consent-copy?surface=signin`

Same payload shape as `surface=chat` — only the strings differ (v4 headline:
"Persönliche Angebote und exklusive Rabatt-Aktionen — direkt an deine
hinterlegte E-Mail-Adresse."; the label still references the stored address).

### 3.2 Submit the accept — `POST /api/account/marketing-opt-in`

Unchanged from v3 except the mechanic: the POST now fires on the
**"Ja, Angebote aktivieren"** tap instead of a checkbox tick. Same guards as
`/api/auth/me` (origin allowlist + shared secret + session; fail-closed
**401** for anonymous/logged-out sessions). Body:
`{ "marketingConsent": true, "consentTextShown": "<served surface=signin string, verbatim>" }`.
Same response shape and errors as before (`400 marketing_consent_required`,
`422 no_verified_email` → fall back to the typed-email surface,
`503 upstream_unavailable`).

Only show this surface once `/api/auth/me` reports `signedIn: true` **and**
`marketing.optInActionable === true`. Emit the same four KPI events with
`{ surface: "signin" }`. `marketing.status` reflects the **one** consent, so a
customer subscribed to the shop's newsletter reads `"confirmed"` and
`optInActionable: false` — don't ask them. Since 2026-10-05 `optInActionable`
is also `false` after a `consent_gate_declined` in any of the customer's
sessions in the last 30 days, or after the popup was shown in 3 of their
sessions within 30 days (backend anti-nag, per customer, on every device —
[`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §6.1); keep the widget's own
device memory as is. Should the POST arrive for an
already-subscribed address anyway, it sends no email and answers
`confirmed` / `alreadyConfirmed: true`.

### 3.3 Confirmation + withdrawal (unchanged)

The DOI confirmation link (`/api/confirm-marketing`) and the unsubscribe link in
every marketing email are the **same** for all surfaces — nothing widget-side to
build. Consent is withdrawable any time via that unsubscribe link (or in the
shop — both sides stay in step).

---

## 4. In-chat capture form — unchanged (still two checkboxes)

`GET /api/consent-copy` (no `surface`) returns the capture-form payload
(`transactionalLabel`, `marketingLabel`, `consentFooter`, `consentTextShown`,
`returningHint`, …). **This surface is NOT button-consent**: both checkboxes
render **unchecked**, its audit string covers both consents, and a submit
without the transactional tick is rejected `400 transactional_consent_required`.
With the marketing box ticked on an already-subscribed address the response is
`marketing.status: "confirmed"`, `alreadyConfirmed: true`, no DOI email (the
summary email is sent as usual). See [`API_CONTRACT.md`](./API_CONTRACT.md) §7
for the full capture contract.

---

## 5. What does NOT change

Sign-in is still **identity only**, and a typed email in the gate is still
**consent only for what was accepted**. Every marketing opt-in — gate accept,
sign-in accept, or capture-form tick — is a **separate, explicit act** the
customer chooses; on Mo's surfaces the double-opt-in remains the **only** path
to marketing consent, and nothing is ever pre-selected. (A consent the
customer gave in the shop itself counts too — that is why an
already-subscribed address is not asked again.)
