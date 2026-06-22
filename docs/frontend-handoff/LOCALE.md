# Locale contract — English (`en`) alongside German (`de`)

> **Synced copy.** Like the rest of `docs/frontend-handoff/*`, this file is the
> theme repo's reference for the backend's locale behaviour. The backend doc is
> canonical — re-sync this folder into the theme whenever the contract changes.

The backend now serves **two languages**. German is the default and is unchanged
in every byte; English is opt-in, selected by the storefront path:

| Storefront path | Locale sent | Mo speaks | Emails / pages |
| --------------- | ----------- | --------- | -------------- |
| `/de…` (and everything legacy) | `de` (or omit) | German | German |
| `/en…` | `en` | English | English |

**Default is German.** A missing, empty, or unrecognised locale always resolves
to `de` — so omitting the field everywhere keeps today's exact behaviour.

---

## 1. How the widget sends the locale

The widget derives the locale from the storefront path (`/en` → `en`, otherwise
`de`) and passes it on every backend call. Three transports are accepted; the
backend resolves them in this **precedence order**, defaulting to German:

1. an explicit **`locale` field in the JSON body** (POST endpoints), then
2. the **`?locale=` query parameter** (GET endpoints / email links), then
3. the **`x-ms-locale` request header** (a stable signal the widget MAY set once
   for every call), then
4. **`de`**.

`normalizeLocale` is tolerant: `"en"`, `"EN"`, `"en-GB"`, `"en_US"` all → `en`;
anything else → `de`. It never throws.

> **CORS:** `x-ms-locale` is allow-listed in the preflight
> (`Access-Control-Allow-Headers: Content-Type, x-ms-chat-key, x-ms-session,
> x-ms-locale`). Sending it is safe on every endpoint — but note it is a *custom*
> header, so it turns an otherwise "simple" GET into a preflighted request; the
> backend already handles `OPTIONS` for these routes (with a 24 h `Max-Age`).

> **Simplest integration:** set `x-ms-locale: en` (or `de`) as a default header
> on every backend `fetch` from the `/en` (or `/de`) storefront, and you're done
> — no per-endpoint changes required. The body/query options exist for callers
> that prefer to be explicit (and for the email links the backend builds itself).

### Per-endpoint summary

| Endpoint | How to pass locale | Notes |
| --- | --- | --- |
| `POST /api/chat` | body `"locale": "en"` (or header) | Switches Mo's language + the model-facing tool instructions. |
| `POST /api/capture-email` | body `"locale": "en"` (or header) | Drives the summary + DOI email language **and the stored consent locale**. Must match the locale used for `GET /api/consent-copy` (the echoed `consentTextShown` is per-locale). |
| `GET /api/consent-copy` | `?locale=en` (or header) | Returns the English consent strings + `locale` + `enLegalReviewed`. |
| `POST /api/contact` | body `"locale": "en"` (or header) | Localises the user-facing response messages (the internal team email stays German). |
| `POST /api/feedback` | body `"locale": "en"` (or header) | Localises validation + error messages. |
| `POST /api/account/marketing-opt-in` | body `"locale": "en"` (or header) | Sign-in opt-in; DOI email + stored locale. |
| `GET /api/account/summary` | `?locale=en` (or header) | Localises the PDF download + its filename. |
| `GET /api/account/export` | `?locale=en` (or header) | Localises the download filename + error copy. |
| `POST /api/account/erase` | `?locale=en` (or header) | Localises error copy. |
| `GET`/`PATCH`/`DELETE /api/account/conversations/{id}` | `?locale=en` (or header) | Localises error copy. |
| `GET /api/confirm-marketing` | `&locale=` (the backend bakes it into the DOI link) | The widget never builds this link; the backend appends the capture's locale. |
| `GET /api/unsubscribe` | `&locale=` (baked into the email link) | Same — built by the backend. |
| `GET /api/r/{token}` | `&locale=` (baked into marketing links) | Friendly "offer expired" page language. |

> Endpoints that return **no user-facing prose** (`/api/products`, `/api/auth/*`,
> `/api/kpi`, `/api/tts`) take no locale. `/api/tts` boundary errors and a few
> purely technical strings (`"Invalid JSON body"`, `"Unexpected server error"`,
> rate-limit `"Too many requests"`) were already English in both locales and are
> intentionally left unchanged.

### `locale` on `POST /api/chat`

```jsonc
{
  "messages": [ /* … */ ],
  "conversationKey": "c3f1e8a2-…",
  "locale": "en"            // NEW — "de" (default) or "en"
}
```

On `en`, Mo converses in English (same persona, rules, tools, the corrected
**14-day** return policy, and the same `show_contact_form` behaviour — only the
language changes). Omit it (or send `"de"`) for the unchanged German Mo.

### `locale` on `POST /api/capture-email`

```jsonc
{
  "email": "kunde@example.com",
  "transactionalConsent": true,
  "marketingConsent": false,
  "consentTextShown": "<echo the served string verbatim>",
  "locale": "en"           // NEW — MUST match the GET /api/consent-copy locale
}
```

The locale is **stored with the consent record** and carried through to the
summary email, the DOI confirmation email, and (later) the confirm/unsubscribe
pages. The `consentTextShown` you echo must be the one served for the **same**
locale — see §2.

---

## 2. Consent copy is per-locale (and English is ⚠️ not yet legal-reviewed)

`GET /api/consent-copy?locale=en` returns the English checkbox labels, footer,
returning-customer hint, and the pre-composed `consentTextShown` — plus two new
fields on **both** locales:

```jsonc
{
  "version": "v3",
  "locale": "en",                 // NEW — the language these strings are in
  "transactionalLabel": "Yes, send me my consultation summary by email …",
  "marketingLabel": "Yes, I'd like to receive exclusive offers …",
  "consentFooter": "Processing by motion sports in accordance with the privacy policy; …",
  "consentTextShown": "Yes, … | Yes, … | Processing by motion sports …",
  "imprintUrl": "https://motionsports.de/pages/impressum",
  "privacyUrl": "https://motionsports.de/policies/privacy-policy",
  "lawyerApproved": true,          // German copy is lawyer-approved
  "enLegalReviewed": false,        // ⚠️ NEW — English copy is NOT yet reviewed
  "returningHint": { "enabled": true, "text": "Been advised by Mo before? …" }
}
```

> ### ⚠️ LEGAL FLAG — English consent / refund / legal copy is UNREVIEWED
>
> The German DOI / marketing / transactional / refund copy is lawyer-approved
> (`lawyerApproved: true`). The **English** equivalents are a faithful
> translation provided so `/en` is functional, but they have **not** had a
> human/legal review. The payload exposes **`enLegalReviewed: false`** so the
> theme/legal can gate on it. Get an English-market legal review (GDPR/UWG
> equivalents, the 14-day withdrawal wording, the unsubscribe/DOI text) before
> relying on the English consent flow in production. This does **not** block
> German, which is unchanged and approved.

Everything else about the consent flow (two separate unchecked boxes, DOI,
verbatim `consentTextShown` echo, the version stamp) is identical to
`CONSENT_FLOW.md` — only the language differs. The `tool` result of
`offer_email_summary` carries the consent copy for the **chat's** locale, so an
`/en` chat already hands the widget English consent strings to render.

---

## 3. Per-string coverage (what switches language)

Everything **user-facing** switches; the canonical strings live in unit-tested
`*-core.mjs` / `*-messages.mjs` modules (German byte-identical + English).

| Surface | Where the strings live | Coverage |
| --- | --- | --- |
| **Chat system prompt** (persona, rules, availability, B2B, checkout, email-offer, return policy, Zusatzwissen) | `system-prompt-core.mjs` | Full EN variant; German snapshot-pinned byte-identical. |
| **Persona addendums + profile block + archetype label** | `system-prompt-core.mjs` | Full EN. |
| **Product/browsing context + pivot notes + greeting trigger** | `system-prompt-core.mjs` | Full EN. |
| **Customer-memory block** | `system-prompt-core.mjs` | Full EN (dates → `en-GB`). |
| **Model-facing tool descriptions + field hints** | `tool-descriptions.mjs` | Full EN. |
| **Capture-form consent + DOI confirm/invalid + unsubscribe confirm/invalid + email subjects** | `consent-copy-core.mjs` | Full EN ⚠️ (unreviewed). |
| **DOI email body + unsubscribe footer (HTML/text)** | `consent-copy.ts` | Full EN ⚠️. |
| **Transactional summary email** (subject, greeting, "Your selection", "You might also like", "To checkout", sign-off, AI-summary prose) | `summary-email.ts` + `summary-email`'s AI system prompt | Full EN. Prices → `en-GB` EUR (`€1,234.00`). |
| **Signed-in summary PDF download** (headings, sections, sign-off, filename) | `summary-pdf.mjs` + `account/summary` route | Full EN. |
| **Branded email shell** (`<html lang>`, "Browse", Shop/About/Contact/Imprint menu) | `email-template.ts` | Full EN; legal company address stays. |
| **API error / user messages** (capture, contact, feedback, account, expired-offer page) | `api-messages.mjs` + the two `*-validation.mjs` | Full EN. |
| **Confirm-marketing / unsubscribe result pages** (`<html lang>` + copy) | `result-page.ts` + `consent-copy-core.mjs` | Full EN ⚠️. |

### Intentionally **not** localised (documented boundaries)

- **Product catalog data** (names, descriptions, specs) — the catalog is German;
  Mo discusses German product data in English prose (data, not UI copy).
- **Admin marketing _campaign bodies_** (`marketing-draft`, `bundle-email`,
  `marketing-email` prose) — composed by the admin (German today). The
  unsubscribe-footer **function** is locale-capable and the recipient's locale is
  stored (`email_captures.locale`, read via `getCaptureLocale`), but full English
  campaigns need admin-side localisation — **future work**, out of scope here.
- **Physical letters / the shared PDF brand footer** (`letter-pdf`, `pdf-core`) —
  admin/physical, German.
- **Admin dashboard** — internal, German.
- **Technical/developer strings already English in both locales** (see §1 note).

---

## 4. Backend changes at a glance (for reviewers)

- New `email_captures.locale` column (migration `0030`, backfilled `'de'`).
- `locale` resolution helper (`lib/locale.ts` / `lib/locale.mjs`), default `de`.
- New unit tests: German-byte-identical snapshot of the whole prompt + English-
  path assertions; German-unchanged + English-path coverage for consent copy,
  API messages, tool copy, and the locale primitive.
- German output verified byte-identical via an independent old-vs-new diff of the
  prompt (21 branch cases) and the rendered German emails (shell + DOI +
  unsubscribe).
