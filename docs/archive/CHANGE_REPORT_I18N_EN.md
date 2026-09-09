# Change report — English (`en`) language support

Adds English alongside German across every **user-facing** surface, selected by
the storefront path (`/en` → English, `/de` / default → German). German output
is **byte-identical** to before (no regression); English is a new, opt-in
variant. Default locale is German everywhere.

## What changed

### Locale plumbing
- `lib/locale.mjs` / `lib/locale.ts` — `Locale` type, `DEFAULT_LOCALE = "de"`,
  `normalizeLocale` (tolerant, fail-soft to `de`), `isLocale`, `pick`, and
  `resolveLocale(req, bodyLocale?)` (precedence: explicit body → `?locale=` →
  `x-ms-locale` header → `de`).
- Accepted on `POST /api/chat`, `/api/capture-email`, `/api/contact`,
  `/api/feedback`, `/api/account/marketing-opt-in` (body `locale` or header) and
  the GET endpoints (`/api/consent-copy`, `/api/account/*`) via `?locale=` /
  header. The DOI / unsubscribe / redirect links the backend builds carry
  `&locale=` so the pages reached from emails render in the right language.
- New `email_captures.locale` column (migration `0030`, backfilled `'de'`); the
  capture stores the locale and carries it from capture → summary/DOI send.

### Chat (Mo)
- `system-prompt-core.mjs` — the whole prompt (persona, persona-detection,
  behaviour, **availability**, direct-checkout, B2B, showroom, email-offer
  state machine, **the corrected 14-day return info**, `show_contact_form`
  behaviour, Zusatzwissen, persona addendums, profile block, product/browsing
  context, customer-memory, pivot notes, greeting trigger) gets a full English
  variant. The persona/archetype/tool-trigger **logic is unchanged** — only the
  language switches. Moved the prompt-only persona helpers here from `persona.ts`.
- `tool-descriptions.mjs` — the model-facing tool descriptions + field hints in
  both languages; `buildChatTools(profile, locale)` threads it, and the
  `offer_email_summary` result serves consent copy in the chat's locale.
- `api/chat/route.ts` — resolves the locale and threads it into the prompt,
  tools, pivot notes, and the greeting trigger.

### Emails, DOI/confirmation, unsubscribe, consent
- `consent-copy-core.mjs` — bilingual consent / DOI / unsubscribe / subject
  strings; `consent-copy.ts` assembles the per-locale capture payload, DOI email,
  unsubscribe footer, and the confirm/unsubscribe page copy.
- `summary-email.ts` / `summary-pdf.mjs` — the transactional summary email **and**
  the signed-in PDF download switch language (subject, body, sections, sign-off,
  AI-summary prose; prices format `en-GB` on `en`).
- `email-template.ts` — the branded shell's `<html lang>`, "Browse" heading and
  Shop/About/Contact/Imprint menu localise (legal address unchanged).
- `result-page.ts` — confirm/unsubscribe pages render in the page locale.

### API messages
- `api-messages.mjs` + locale-aware `capture-validation.mjs` /
  `feedback-validation.mjs` — every German user-facing error/message has an
  English variant; the stable machine `code` is unchanged.

## ⚠️ Legal flag (must read)

The **German** consent / DOI / refund copy is lawyer-approved
(`CONSENT_COPY_LAWYER_APPROVED = true`). The **English** consent / legal / refund
copy is a faithful translation that is **NOT yet legally reviewed**
(`CONSENT_COPY_EN_LEGAL_REVIEWED = false`, surfaced in the served payload as
`enLegalReviewed`). Get an English-market legal review (GDPR/UWG equivalents,
the 14-day withdrawal wording, the DOI/unsubscribe text) before relying on the
English consent flow. This does not block German.

## Out of scope (documented boundaries)
- Product **catalog data** (German) — Mo discusses it in English prose.
- Admin **marketing campaign bodies** (`marketing-draft`/`bundle-email`/
  `marketing-email`) — admin-composed German. The unsubscribe-footer function is
  locale-capable and the recipient locale is stored (`getCaptureLocale`); full
  English campaigns need admin-side localisation — future work.
- **Physical letters** + the shared **PDF brand footer** — admin/physical, German.
- Admin **dashboard** — internal, German.
- Purely technical strings already English in both locales (`"Invalid JSON
  body"`, `"Unexpected server error"`, `"Too many requests"`, TTS boundary).

## Verification
- `npx tsc --noEmit` ✅, `npm run lint` ✅ (0 errors), `npm run build` ✅.
- `npm test` ✅ — **378** tests, incl. a German-byte-identical prompt golden
  snapshot and English-path assertions for the prompt, consent copy, API
  messages, tool copy, and the locale primitive.
- **German byte-identity proven** by independent old-vs-new diffs (the
  pre-refactor code from git `HEAD`):
  - the full system prompt across **21 branch cases** — identical;
  - the rendered German emails (branded shell + DOI email + unsubscribe footer)
    — identical;
  - the summary-email German literals — verbatim (only `en ? … : <de>` wrappers
    added).

See `docs/frontend-handoff/LOCALE.md` for the locale contract + per-string
coverage the theme/frontend consumes.
