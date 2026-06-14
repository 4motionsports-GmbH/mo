# Consent flow — frontend contract (capture form + at-sign-in opt-in)

> **Synced copy.** Canonical source is the backend repo (`docs/CONSENT_FLOW.md`
> + `src/lib/consent-copy.ts`). Whenever the backend copy or contract changes,
> re-sync this folder. **If anything here disagrees with the code, the code
> wins.**

This is what the storefront widget needs to render the marketing-consent
surfaces. There are **two** of them, both on **consent copy v3**, both serving
their strings from the backend so the widget **never hard-codes** consent text
(the served `consentTextShown` IS the Art. 7 audit record — a hard-coded snapshot
would silently drift from what we store).

| Surface | Who sees it | Email field? | Submit endpoint |
|---|---|---|---|
| **In-chat capture form** | anyone in the chat | **yes** (user types it) | `POST /api/capture-email` |
| **At-sign-in marketing opt-in** | a **signed-in** customer | **no** (we hold the verified email) | `POST /api/account/marketing-opt-in` |

**Both are the SAME double-opt-in.** Ticking only sends a confirmation email;
marketing is permitted **only after** the customer clicks that link. **Neither
box is ever pre-ticked**, on either surface — a Shopify account NEVER implies
consent.

---

## 1. The golden rules (do not break these — Abmahnung-sensitive)

- **Render every checkbox UNCHECKED.** No pre-tick, ever — not the marketing box,
  not the transactional box. (CJEU C-673/17 *Planet49*; a classic UWG Abmahnung
  trigger.) Making a box **prominent** is fine and encouraged; pre-ticking is not.
- **Render the served strings verbatim** and **echo `consentTextShown` back
  unchanged**. Don't reformat, translate, or re-compose it.
- **No dark patterns.** No countdowns, no fake urgency, no "you'll miss out"
  framing, no concrete discount promise. The copy ceiling is accurate scarcity
  only (`exklusive Angebote … nur für Abonnenten`).
- **Show the imprint + privacy links** (`imprintUrl`, `privacyUrl`) next to the
  consent block.
- **`lawyerApproved: false`** in the payload means the copy is **not yet legally
  signed off** — don't launch the surface to real users until it's `true`.

---

## 2. At-sign-in marketing opt-in (v3) — the new surface

The account removes **only** the "type your email" step: the customer is signed
in (tier 3), so we already hold their **verified** Shopify email and don't ask
for it again. Everything else is identical to the capture form.

### 2.1 Fetch the copy — `GET /api/consent-copy?surface=signin`

Same guard as the default consent-copy call (origin allowlist + rate limit; no
shared secret — these are public strings already shown to users). A CORS
`OPTIONS` preflight is supported.

```jsonc
// 200 OK  (Cache-Control: public, max-age=60, stale-while-revalidate=300)
{
  "version": "v3",
  "headline": "Bleib auf dem Laufenden — als angemeldete:r Kund:in.",   // framing only — NOT consent text
  "marketingLabel": "Ja, schickt mir an meine hinterlegte E-Mail-Adresse exklusive Angebote …",  // the consent text; render UNCHECKED
  "consentFooter": "Verarbeitung durch motion sports gemäß Datenschutzerklärung; Widerruf jederzeit möglich.",
  "consentTextShown": "Ja, schickt mir an meine hinterlegte … | Verarbeitung durch motion sports …",  // echo this back VERBATIM
  "imprintUrl": "https://motionsports.de/pages/impressum",
  "privacyUrl": "https://motionsports.de/policies/privacy-policy",
  "lawyerApproved": true
}
```

Render: the `headline` above an **unchecked** checkbox labelled `marketingLabel`,
the `consentFooter` beneath it, and the imprint/privacy links nearby. **No email
input.** The `headline` is benefit framing and is **NOT** part of
`consentTextShown` — only the label + footer are.

### 2.2 Submit the tick — `POST /api/account/marketing-opt-in`

A widget XHR, so it carries the **same guards as `/api/auth/me` and
`/api/account/*`** (origin allowlist + shared secret + the session):

```
POST {BASE_URL}/api/account/marketing-opt-in
Headers:
  x-ms-chat-key: {shared secret}
  Origin:        {storefront origin}
  x-ms-session:  {session_id}            (or ?session= query param)
  Content-Type:  application/json
Body:
{
  "marketingConsent": true,                  // MUST be the user's actual tick — never hard-code true
  "consentTextShown": "<the served consentTextShown, echoed verbatim>"
}
```

```jsonc
// 200 OK
{
  "ok": true,
  "marketing": {
    "status": "pending",        // "pending" → DOI email sent; "confirmed" → was already confirmed
    "doiEmailSent": true,
    "alreadyConfirmed": false   // true when this address was already DOI-confirmed (re-opt-in)
  }
}
```

- Only send `marketingConsent: true` when the customer **actually ticked** the
  box. If you POST it without a real tick the backend still requires the explicit
  flag, but the **UI must not auto-submit** — the tick is the consent.
- **Fail-closed auth** (same as the rest of `/api/account/*`): an anonymous or
  email-only (not Shopify-signed-in) or logged-out session gets **401**
  `{ "error": { "code": "unauthorized" } }`. Only show this surface once
  `/api/auth/me` reports `signedIn: true`.
- `400 marketing_consent_required` — the box wasn't ticked (`marketingConsent`
  not `true`). Surface a gentle "please tick to confirm" hint.
- `422 no_verified_email` — the account has no verified email on file (rare).
  Fall back to the typed-email capture form.
- `503 upstream_unavailable` — consent couldn't be stored; let the user retry.

After a `pending` response, tell the user to **check their inbox and click the
confirmation link** — they are **not** subscribed until they do.

### 2.3 Confirmation + withdrawal (unchanged)

The DOI confirmation link (`/api/confirm-marketing`) and the unsubscribe link in
every marketing email are the **same** as the capture-form flow — nothing
widget-side to build. Consent is withdrawable any time via that unsubscribe link.

---

## 3. In-chat capture form (v3) — unchanged shape

`GET /api/consent-copy` (no `surface`) returns the capture-form payload
(`transactionalLabel`, `marketingLabel`, `consentFooter`, `consentTextShown`,
`returningHint`, …). **Both** checkboxes render **unchecked**; a submit without
the transactional tick is rejected `400 transactional_consent_required`. See
[`API_CONTRACT.md`](./API_CONTRACT.md) §7 for the full capture contract — this
file only adds the **at-sign-in** surface on top.

---

## 4. What does NOT change

Sign-in is still **identity only**. The at-sign-in opt-in is a **separate,
explicit act** the customer chooses — signing in alone never opts anyone in, and
there is no pre-tick anywhere. The double-opt-in remains the **only** path to
marketing consent.
