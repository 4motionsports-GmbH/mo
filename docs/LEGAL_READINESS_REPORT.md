# DSGVO / GDPR Readiness Report — motion sports Chatbot Backend

**Prepared for:** external legal counsel (final DSGVO/GDPR sign-off)
**Subject system:** `motionsports-chatbot` backend (Next.js 16 API + Neon Postgres), the server behind the "Mo" AI fitness-consultation chatbot on motionsports.de
**Report date:** 2026-06-16
**Prepared by:** engineering (code-grounded, read-only audit — no code was changed to produce this report)
**Controller (to confirm):** motion sports — *exact legal entity, address, managing director, and DPO/Art. 27 representative to be filled in by the client.*

> **⚠️ Addendum (2026-06-16) — §7(3) UWG "Bestandskunden" feature REMOVED.** After
> this report was written, the client decided the existing-customer (§7 Abs. 3
> UWG) marketing feature is not needed, and it was **removed entirely from the
> codebase** (it was never live). Accordingly, all §7(3) content below is
> **superseded**: lawful-basis row **LB-05** no longer applies, open question
> **OQ-06** is **withdrawn**, and the §7(3) processor/data-flow mentions
> (eligibility cache, separate opt-out list, send routes, `BESTANDSKUNDE_*` flags)
> no longer exist. The DOI-consented marketing path (Art. 6(1)(a)) is unaffected.
> Everything else in this report stands.

---

## 0. How to read this report

This document is written so you can **go item by item and mark Approve / Deny / Needs-change**. Substantive judgement calls are collected in **§8 (Open Questions)** with stable IDs (`OQ-01 …`), each with a checkbox row. The body sections give you the facts each question rests on, cited to source (`file:line`).

### Important caveats — please read before relying on anything below

1. **This is not a legal opinion and does not declare conformity.** Its purpose is the opposite: to surface, honestly, where the system stands and where residual risk or a human/contractual decision remains. Engineering's assessments are flagged as such and are for you to confirm or reject.

2. **The codebase asserts that some legal sign-offs already happened. Treat those as claims to verify, not as settled facts.** Specifically:
   - `CONSENT_COPY_LAWYER_APPROVED = true` with an in-code note "lawyer-approved (June 2026)" (`src/lib/consent-copy.ts:49`); and
   - `PHYSICAL_MAIL_SENDS_APPROVED=true` with a comment "APPROVED by Legal (2026-06-14) → enabled" (`.env.example:133-138`).

   These are developer-authored markers in source control. This report **re-surfaces the underlying facts** so you can confirm *what* was approved, *under which privacy-policy wording*, and *what was not in scope*. If you did not in fact issue those approvals, that is itself a finding.

3. **"Cannot verify from code" means exactly that.** Data residency (which region a processor stores data in), whether a DPA/AVV (Auftragsverarbeitungsvertrag) has actually been signed, whether Anthropic/OpenAI no-training or zero-data-retention terms are in force, and the live value of deployment env vars are all **provisioned outside this repository**. Where a fact depends on them, it is flagged. These are the items most in need of your attention because the code looks correct but cannot prove the surrounding contract/config.

4. **The actual privacy policy and Impressum live on the Shopify storefront, not in this repo.** This report cannot verify their content. Several consent/transparency conclusions depend on that wording matching what the backend does.

### Overall engineering assessment (the honest version)

The **architecture is unusually disciplined for GDPR** — a deliberate two-cluster split (pseudonymous analytics vs. consented marketing), a real double-opt-in, fail-closed consent gates, verbatim consent-text audit with version stamping, AES-256-GCM token encryption, genuine data minimisation into the AI models, and an enforced retention cron. Most "safeguards" in the comments are **actually enforced in code**, not just documented intent.

That said, this report is here for the gaps, and there are real ones. The four that most need your judgement: **(a)** full postal addresses are **auto-collected from Shopify without a consent check** on every admin page load, while physical sending appears to have been switched on; **(b)** **no processor DPA is evidenced and no data-residency region is pinned in code** (Neon, which holds essentially all PII, is the highest-stakes unknown); **(c)** **Sentry has no PII scrubbing** and could incidentally receive chat text / email / addresses inside error messages; and **(d)** several **storage-limitation gaps** (consented customers and feedback rows have no maximum-retention / inactivity deletion).

---

# 1. Data Inventory

Every category of personal data the backend can hold, where it lives, and for how long. "Cluster A" = pseudonymous analytics; "Cluster B" = identified/consented data. The split is a deliberate design decision (`migrations/0001_init.sql:1-14`, `docs/DATABASE.md:134-157`).

### 1.1 Persistent store — Neon Postgres (primary PII home)

| # | Data category | Fields | Table / location | Retention (default) | PII? |
|---|---|---|---|---|---|
| D-01 | **Chat content** (free text) | user + assistant message text, tool-call markers | `messages` (Cluster A) | **180 d** from `last_activity_at`, then hard delete (`RETENTION_DAYS`) | Only if the user types it |
| D-02 | Conversation metadata | `session_id`, persona label, product ids discussed/selected, status, timestamps, cached title | `conversations` (Cluster A) | 180 d | Pseudonymous |
| D-03 | **Analytics / telemetry** | event name, `session_id`, free-form jsonb | `kpi_events` (Cluster A) | **180 d** (`KPI_RETENTION_DAYS`) | Pseudonymous (no email by contract — `src/lib/kpi-events.ts:1-5`) |
| D-04 | AI token usage | model id, input/output token counts | `ai_usage` (Cluster A) | Chat rows cascade with conversation (180 d); dashboard rows 180 d | No (counts only) |
| D-05 | **Email address** | normalised email | `email_captures.email`, `customers.email` (Cluster B) | See D-06 / D-12 | **Yes — direct identifier** |
| D-06 | **Consent record** | transactional + marketing flags, DOI status/token, `consent_text_shown` (verbatim), `consent_copy_version`, `doi_confirmed_at`, `unsubscribed_at` | `email_captures` (Cluster B) | Active consent: **kept** (Art. 7 proof). Unsubscribed/suppressed: PII purged after **30 d** grace (`SUPPRESSED_CAPTURE_PURGE_DAYS`) | Yes |
| D-07 | **Suppression list** | email, reason, timestamp | `suppression_list` (Cluster B) | **Kept indefinitely** (to keep honouring opt-out) | Yes (minimised) |
| D-08 | Marketing send history | drafted text, discount code, send status, click timestamp, persona snapshot | `marketing_sends` (Cluster B) | Cascades with the capture on purge; otherwise kept | Linked via capture |
| D-09 | **Derived customer profile** | AI "current understanding" free-text summary | `customers.profile_summary` (Cluster B) | Lives on `customers` row (see D-12) | Yes (derived/profiling) |
| D-10 | **Purchase history** (cached) | order dates, line-item titles + quantities, totals | `customers.purchase_summary` (jsonb) | Lives on `customers` row | Yes |
| D-11 | **Full postal address** | name, company, street, postcode, city, country + `postal_address_source` | `customers.postal_address` (jsonb) | Lives on `customers` row | **Yes — and see OQ-01** |
| D-12 | Customer entity | email, first/last seen, consent mirror, Shopify identity, identity tier | `customers` (Cluster B) | **No fixed TTL.** Purged only on unsubscribe+grace or self-service erase. See **OQ-09** (storage limitation) | Yes |
| D-13 | **OAuth tokens** (signed-in tier-3) | access + refresh tokens | `customer_oauth_tokens` | **Encrypted at rest (AES-256-GCM)**; cascade-deleted with customer; rotate/expire continuously | Yes (credential) |
| D-14 | Pending sign-in state | CSRF state, PKCE verifier, nonce, return URL, session id | `customer_auth_pending` | **~10 min** (`CUSTOMER_AUTH_PENDING_TTL_MINUTES`) | Transient |
| D-15 | Sign-in merge conflicts | Shopify id/email, conflicting local rows | `customer_merge_conflicts` | Kept until an admin reviews | Yes |
| D-16 | Shopify account snapshot | display name, first name, **city + country only**, address count | `customers.shopify_account_summary` (jsonb) | Lives on `customers` row | Yes (minimised — no street) |
| D-17 | **Email correspondence** (both directions) | from/to/subject, **full body text + HTML**, snippet, threading ids, attachment **metadata only** | `email_messages` (Cluster B) | **365 d** by `occurred_at` (`CORRESPONDENCE_RETENTION_DAYS`) | **Yes — largest free-text PII store; incl. unknown senders.** See OQ-08 |
| D-18 | **Physical letters** | recipient full address snapshot, subject + body, Pingen id, status, cost | `physical_letters` (Cluster B) | **365 d** by `created_at` (`PHYSICAL_LETTER_RETENTION_DAYS`) | Yes |
| D-19 | Bundle offers | nullable customer link, component price snapshot, Shopify ids, status | `bundle_offers` | Availability 7 d; record kept de-identified (customer link SET NULL on erasure) | Link only |
| D-20 | **Customer feedback** | free-text message, optional email, session/conversation/tier/page | `feedback` | **No retention window — NOT purged by the cron.** See **OQ-10** | Yes if user supplies email/PII in text |
| D-21 | Welcome-discount history | historical code + issue timestamp | `customers` (read-only legacy cols) | With the customer row; feature retired | Linked |

### 1.2 Transient / non-Neon stores

| # | Data category | Where | Retention | PII? |
|---|---|---|---|---|
| D-22 | **IP address** (+ session id) | Upstash Redis, as rate-limit keys (`sid:<session>` or `ip:<addr>`; two buckets key on email/IP) | Sliding-window TTL only (**60 s – 60 min**), `analytics:false` (`src/lib/rate-limit.ts:21-114`) | Yes (IP) — short-lived |
| D-23 | Product catalog + embeddings | Vercel Blob (`access: public`) | Overwritten by daily sync | **No PII** — product fields + vectors of product copy only (`src/lib/catalog-store.ts:113-131`, confirmed) |
| D-24 | **Contact-form submissions** | Relayed via Resend to internal inbox (`CONTACT_TO_EMAIL`); **not stored in this system's DB**; console-logged in local dev | Lives in the recipient mailbox — **outside this system's retention controls** | **Yes — name, email, phone, organisation, free-text** (`src/app/api/contact/route.ts:46-78`) |
| D-25 | Server error reports | Sentry (only if `SENTRY_DSN` set) | Sentry account retention | Potentially — see §6 / OQ-04 |
| D-26 | Application logs | Vercel stdout (`console.*`) | Vercel log retention | Diagnostic context; contact-form path logs full submission incl. email/phone when Resend unconfigured (`src/app/api/contact/route.ts:127-139`) |

**Inventory notes for the lawyer**
- **Email is genuinely quarantined.** It appears in `email_captures` / `customers` (and is echoed into `email_messages`, `feedback`, `marketing_sends`, contact mail). It is **never** written into Cluster A analytics, and **never** sent to the AI models (see §6).
- **Free-text is the soft spot.** Users *can* type personal data into chat (D-01) and into feedback (D-20). The system does not solicit it; retention bounds it (D-01) — except feedback (D-20), which currently has none.
- **The contact form (D-24) leaves this system entirely** and lands in a mailbox you control separately. Its retention and access are a manual/organisational matter, not enforced here.

---

# 2. Lawful Basis per Processing Purpose

Mapped to GDPR Art. 6 (and §7 UWG for marketing). The "Assessment" column is engineering's read for you to confirm or reject.

| # | Purpose | Data | Claimed basis | Article / § | Assessment for counsel |
|---|---|---|---|---|---|
| LB-01 | Run the live chat consultation | chat content, session metadata | Performance of service / legitimate interest | Art. 6(1)(b)/(f) | Sound. Core service the visitor requested. Confirm (b) vs (f) framing for a pre-contractual, non-logged-in visitor. |
| LB-02 | Product analytics / KPIs | pseudonymous `kpi_events`, persona summaries | Legitimate interest | Art. 6(1)(f) | Sound; pseudonymous. A balancing-test/LIA record should exist (not in repo). |
| LB-03 | Transactional summary email | email + summary | Consent to a requested service | Art. 6(1)(b) (the doc frames the "send me a copy" tick as the service) | The box is **required and unticked-by-default**; submit without it is rejected (`src/lib/capture-validation.mjs:46-53`). Confirm whether you treat this as 6(1)(b) service or 6(1)(a) consent — the copy is checkbox-style, which reads like consent. |
| LB-04 | Marketing email (newsletter/offers) | email, marketing consent, sends | **Explicit consent + DOI** | **Art. 6(1)(a)** + §7(2) UWG | Strong as built (see §3). Verify the consent text covers *personalised* offers based on profile + purchases, not just "a newsletter." |
| LB-05 | **§7(3) UWG Bestandskunden** (existing-customer mail re: own similar products, no opt-in) | email, completed-purchase eligibility | §7(3) UWG (+ Art. 6(1)(f)) | §7 Abs. 3 UWG | **Built but OFF** (`BESTANDSKUNDE_SENDS_APPROVED=false`). The **"own similar products" boundary is not defined/enforced in code** — it is explicitly deferred to you (OQ-06). |
| LB-06 | **Profiling / personalisation** (durable AI profile from past chats + purchases; live-chat memory) | transcripts, purchase history, profile summary | Consent | Art. 6(1)(a) (runtime-gated on `marketing_status='confirmed'`) | In-code claim: reviewed & approved June 2026 (`docs/CUSTOMERS.md:103-142`). Confirm (i) privacy-policy wording covers profile-building from **past** sessions + purchase history, (ii) Art. 22 / DPIA position (OQ-05). |
| LB-07 | **Correspondence** (reply handling, unified mail log) | full email bodies, both directions | Contract / legitimate interest | Art. 6(1)(b)/(f) | Deliberately **separate** from marketing consent and never fused into it (enforced — `src/lib/email-messages-store.ts`). Confirm LI for storing full bodies of **unknown** inbound senders 12 mo (OQ-08). |
| LB-08 | Signed-in identity (tier-3) + holding OAuth tokens | Shopify identity, encrypted tokens | Contract / legitimate interest | Art. 6(1)(b)/(f) | Sound. Sign-in establishes identity, never marketing consent (enforced — `migrations/0014:12-15`). |
| LB-09 | **Physical mail** (Pingen → Deutsche Post) | full postal address, letter content | Depends on send context (marketing consent or §7(3) or service) **AND** a lawful **address-acquisition** basis | Art. 6(1)(a)/(b)/(f) + §7 UWG | **The acquisition basis is the open question (OQ-01).** Sending is flag-gated; *address collection* is not (see §6). |
| LB-10 | Contact form → sales inbox | name, email, phone, org, message | Pre-contractual / legitimate interest | Art. 6(1)(b)/(f) | Sound. Confirm the form has its own consent/notice and that phone is necessary. |
| LB-11 | Rate-limiting / abuse prevention (IP) | IP, session id | Legitimate interest | Art. 6(1)(f) | Sound; short TTL. Confirm IP processing is disclosed. |
| LB-12 | Security error monitoring | error reports | Legitimate interest | Art. 6(1)(f) | Sound *if* PII leakage is controlled (OQ-04). |

**Cluster separation as a lawful-basis safeguard.** The code refuses to merge bases: marketing consent (DOI), §7(3) eligibility, and correspondence each have separate state, separate suppression lists, and separate gates, and the comments repeatedly warn "never merge the bases" (`migrations/0017_bestandskunden.sql:5-15`, `docs/DATA_RETENTION.md:120-131`). This is the strongest part of the design.

---

# 3. Consent Mechanics

The marketing-consent machinery, checked against CJEU C-673/17 *Planet49* (no pre-ticked boxes; clear affirmative act) and German UWG (DOI) expectations. **All strings are served by the backend and echoed back verbatim**, so the stored Art. 7 proof cannot drift from what was shown (`src/lib/consent-copy.ts:138-152`).

### 3.1 What is implemented (facts)

| # | Mechanic | Status | Evidence |
|---|---|---|---|
| C-01 | **Two separate, unbundled consents** (transactional vs marketing) | ✅ Enforced | `src/lib/consent-copy.ts:11-24`; separate checkboxes + DB columns |
| C-02 | **Both boxes start UNCHECKED** (v2+ decision; even the transactional box) | ✅ Enforced | Submit without transactional consent → `400 transactional_consent_required` (`src/lib/capture-validation.mjs:46-53`) |
| C-03 | **No pre-ticked marketing box** (Planet49) | ✅ Enforced by contract + documented decision | `src/lib/consent-copy.ts:74-94` (explicit Planet49 / UWG rationale) |
| C-04 | **Double opt-in** (pending → confirmation email → confirmed) | ✅ Enforced | `src/lib/email-capture-store.ts:166-305`; no marketing until `confirmed` |
| C-05 | **256-bit DOI token, 7-day expiry** | ✅ Enforced | `generateDoiToken` (32 random bytes); expiry by `doi_sent_at` (`:292-296`) |
| C-06 | **Verbatim consent text stored** (Art. 7 proof) | ✅ Enforced | `consent_text_shown` column; composed server-side |
| C-07 | **Consent-version stamp** (`v1`/`v2`/**`v3`**; NULL = unattested) | ✅ Enforced | Stamped only on byte-identical echo (`resolveConsentCopyVersion`); current `CONSENT_COPY_VERSION="v3"` |
| C-08 | **Withdrawal — one-click, signed, stateless unsubscribe** in every marketing mail | ✅ Enforced | HMAC email-keyed token; suppress + revoke DOI in one txn (`src/lib/email-capture-store.ts:324-388`); send **refused** if no unsubscribe link can be built (`src/lib/marketing-email.ts:106-114`) |
| C-09 | **Suppression fail-closed** | ✅ Enforced | `isSuppressed` returns `true` (suppressed) on any DB error (`:53-69`) |
| C-10 | **At-sign-in opt-in** (tier-3, no re-typing email) — still unchecked, still real DOI | ✅ Enforced | `marketingConsent:true` required else `400`; synthetic email refused `422` (`src/app/api/account/marketing-opt-in/route.ts:80-103`) |
| C-11 | **Freely-given / no coupling** — welcome-discount-for-ticking feature was **retired** | ✅ | `docs/CONSENT_FLOW.md:419-427`; system prompt forbids promising any welcome discount (`src/lib/system-prompt.ts:118-122`) |

### 3.2 The v3 copy (verbatim — for your sign-off)

These are the exact German strings the backend serves (`src/lib/consent-copy.ts`). The in-code marker says they were lawyer-approved in June 2026; **please confirm**, item by item.

| # | String (id) | Verbatim text | Confirm |
|---|---|---|---|
| C-12 | Transactional label (`TRANSACTIONAL_CHECKBOX_LABEL`) | "Ja, schickt mir meine Beratungs-Zusammenfassung per E-Mail (inkl. Direkt-Link zur Kasse)." | ☐ Approve ☐ Deny ☐ Change |
| C-13 | Marketing label (`MARKETING_CHECKBOX_LABEL`) | "Ja, ich möchte exklusive Angebote und Aktionen erhalten — nur für Abonnenten. Jederzeit abbestellbar." | ☐ Approve ☐ Deny ☐ Change |
| C-14 | Shared footer (`CONSENT_SHARED_FOOTER`) | "Verarbeitung durch motion sports gemäß Datenschutzerklärung; Widerruf jederzeit möglich." | ☐ Approve ☐ Deny ☐ Change |
| C-15 | **At-sign-in** marketing label (`SIGNIN_MARKETING_OPTIN_LABEL`, v3) | "Ja, schickt mir an meine hinterlegte E-Mail-Adresse exklusive Angebote und Aktionen — nur für Abonnenten. Jederzeit abbestellbar." | ☐ Approve ☐ Deny ☐ Change |
| C-16 | DOI email subject/body (`DOI_EMAIL_SUBJECT`, `doiEmailBody`) | "Bitte bestätige deine Anmeldung…" + purpose statement + confirm CTA | ☐ Approve ☐ Deny ☐ Change |
| C-17 | Unsubscribe footer (`unsubscribeFooter`) | "Du erhältst diese E-Mail, weil du der Kontaktaufnahme … zugestimmt hast … jederzeit kostenlos abmelden …" | ☐ Approve ☐ Deny ☐ Change |
| C-18 | Returning-customer hint (`RETURNING_CUSTOMER_HINT_TEXT`) — *informational, NOT part of consent text* | "Schon einmal von Mo beraten worden? Gib deine E-Mail an — Mo erkennt dich wieder…" | ☐ Approve ☐ Deny ☐ Change |

### 3.3 Engineering's honest read on consent (for you to weigh)

- **Planet49 compliance looks genuinely met**: unchecked boxes, separate consents, affirmative act, verbatim audit. This is better than most German shops.
- **Coupling / freely-given (Art. 7(4)):** the marketing consent buys nothing (no discount for ticking). The transactional summary is delivered regardless of the marketing tick. The only nuance: the **prompt encourages Mo to mention the marketing checkbox's future benefit in ≤1 sentence** at the moment it offers the summary (`src/lib/system-prompt.ts:289`). That is benefit-framing, not coupling, but please confirm the ceiling ("nur für Abonnenten" scarcity, no concrete discount promise) is acceptable.
- **"nur für Abonnenten" exclusivity claim** (C-13/C-15): a factual-scarcity claim. Confirm it is not a misleading UWG claim if non-subscribers in practice receive comparable offers.
- **Transactional box as "consent" vs "service" (LB-03):** it renders as a checkbox the user must tick, which functionally reads like consent (Art. 6(1)(a)) even though the docs frame it as the requested service (6(1)(b)). Low risk either way, but pick a lane for the privacy policy.
- **Privacy/Impressum links** are served from code (`CAPTURE_FORM_PRIVACY_URL = https://motionsports.de/policies/privacy-policy`, `CAPTURE_FORM_IMPRINT_URL = …/pages/impressum`). The code itself flags "verify the privacy URL actually resolves on the live shop before launch" (`src/lib/consent-copy.ts:159-164`). → **OQ-12.**

---

# 4. Data-Subject Rights — Are They Actually Implementable?

Assessed against what the code can *do today*, per subject type. Three subject tiers: **anonymous** (pseudonymous session only), **email-only** (tier-2, captured email), **signed-in** (tier-3, Shopify account).

| Right | Anonymous | Email-only (tier-2) | Signed-in (tier-3) | Verdict |
|---|---|---|---|---|
| **Access (Art. 15)** | Nothing maps to a person — nothing to disclose | **Manual only** (query by email) — no self-service | **Partial self-service**: list/read own conversations + download a PDF summary of one thread (`/api/account/conversations`, `/api/account/summary`). **Profile summary, purchase summary, consent record, correspondence, postal address are NOT exposed to the subject.** | ⚠ Incomplete — see OQ-11 |
| **Erasure (Art. 17)** | Only via `session_id` if the user can supply it (Cluster A holds no person key) | **Manual**: add email to `suppression_list`, delete `email_captures`/`marketing_sends`; retention enforces. Documented procedure (`docs/DATA_RETENTION.md:307-318`) | **Full self-service**: `POST /api/account/erase` — purges all transcripts, clears profile + cached summaries, revokes OAuth tokens, suppresses email on **both** marketing and §7(3) lists (`src/lib/account-history.ts:346-405`) | ✅ tier-3 strong; ⚠ tiers 1–2 manual |
| **Single-chat delete** | n/a | n/a | `DELETE /api/account/conversations/[id]` hard-deletes one transcript (messages + chat usage cascade). **Does NOT clear the derived profile** — by design (different basis). Already-derived profile text persists until regen or full erasure | ✅ but see erasure nuance below |
| **Rectification (Art. 16)** | n/a | n/a | Rename own conversations; profile self-corrects ("today overrides memory") | ⚠ No direct "edit my profile/address" surface |
| **Portability (Art. 20)** | n/a | None | PDF summary of one thread (human-readable, **not** a structured machine-readable export of all data) | ⚠ Partial — see OQ-11 |
| **Objection (Art. 21) — direct marketing** | n/a | **One-click unsubscribe** (DOI) + **separate** §7(3) opt-out, both honoured independently and durably (survive PII purge) | same | ✅ Strong |
| **Objection — LI analytics** | Pseudonymous; practically not exercisable, and low-risk | If re-identified, personalisation is consent-gated and withdrawable | same | ⚠ No analytics-objection mechanism (acceptable for pseudonymous, confirm) |
| **Withdraw consent (Art. 7(3))** | n/a | Unsubscribe revokes DOI + stops personalisation (gated on `marketing_status='confirmed'`) | same + erase | ✅ |

### The erasure nuance you should explicitly bless or reject (OQ-07)

There are **three different "delete" semantics**, and they are deliberately not the same:

1. **Single-chat delete** (tier-3) hard-deletes one transcript but **does not touch the durable AI profile**. The rationale: the profile is a separate aggregate under a different (consent) basis; a future regeneration simply won't see the deleted chat, but **profile text already derived persists** until the profile is regenerated or the customer is fully erased (`src/lib/account-history.ts:14-24, 291-317`).
2. **Full self-service erase** (tier-3) clears the profile + all cached summaries (they live on the `customers` row, which is deleted) and revokes tokens.
3. **Retention-driven purge** of opted-out customers returns their conversations to pseudonymous (FK `SET NULL`) rather than deleting them.

This is a defensible, thoughtful model — but the **"single delete leaves derived profile in place" behaviour is exactly the kind of partial-erasure design a regulator would ask about.** Please confirm it is acceptable, or require that single-chat delete also trigger a profile regeneration/clear.

---

# 5. Processors & International Transfers

Nine external processors. **Two facts dominate this section and apply to almost all of them:**

> **(A) No data-residency region is pinned anywhere in the code** for Anthropic, OpenAI, Resend, Shopify, Vercel, Neon, Upstash, or Sentry (only Pingen's prod-vs-staging host is in code). Residency is therefore decided by the account/project/DSN provisioned **outside this repo**. **Cannot verify from code.**
>
> **(B) No signed DPA/AVV is evidenced in the repository for any processor.** The only legal-sign-off assertion in code is the Pingen env-comment. There is **no DPA register**. → **OQ-02.**

| # | Processor | Role | Personal data that flows to it | Third country? | DPA/AVV status | Gating |
|---|---|---|---|---|---|---|
| P-01 | **Anthropic (Claude)** `@ai-sdk/anthropic` | LLM: chat (`claude-sonnet-4-6`), profiling (`claude-opus-4-8`), summaries, drafts, KPI | Chat transcripts (verbatim user text), persona/profile, **minimised** memory (city/country, owned-item titles, profile summary), letter recipient **name**. **Email + full street address withheld** | **Yes — US** (default `api.anthropic.com`; no EU/Bedrock/Vertex region in code) | Not evidenced. **No-training / Zero-Data-Retention terms not visible** → OQ-03 | None (works if key set) |
| P-02 | **OpenAI** `openai` | Query **embeddings** (`text-embedding-3-small`) + **TTS** (`gpt-4o-mini-tts`) | Embeddings: the user's search-query free-text. TTS: the assistant reply text. **No name/email/address** | **Yes — US** | Not evidenced; no-training terms not visible → OQ-03 | None (no-ops without key) |
| P-03 | **Resend** `resend` | **Outbound** all email (summary, DOI, marketing, §7(3), contact relay) + **inbound** reply ingestion | Outbound: recipient email + email contents (summary/marketing prose, discount codes, contact-form name/email/phone/org/message). **Inbound: full reply body text+HTML stored in Neon** | **Yes — US** (no EU region configured) | Not evidenced. **EU residency is an unverified, self-flagged "legal-blocking" item** (`docs/EMAIL_SUBSYSTEM_SPIKE.md:118-122`) → OQ-02/OQ-13 | Inbound fails closed without `RESEND_WEBHOOK_SECRET` (Svix-verified) |
| P-04 | **Shopify** (Admin API + Customer Account API) | Catalog, discounts, **order lookups by email**, customer profile/orders/address; tier-3 OAuth sign-in | Out: customer **email** as a search term. In: name, email, order history, addresses (full address read on a separate path for letters) | Shopify = US-HQ processor; region not in code | Not evidenced. **Protected Customer Data access approval needed per code comments** → OQ-14 | Degrades to null if unconfigured |
| P-05 | **Vercel** (host + Blob + Cron) | Compute, catalog Blob, scheduled jobs | Compute processes all of the above in memory. **Blob holds NO PII** (product catalog/embeddings only, confirmed). Crons process PII (refresh, retention) | US-HQ; function region not in code | Not evidenced (Vercel DPA typically via ToS) → OQ-02 | Crons gated by `CRON_SECRET` (fail-closed) |
| P-06 | **Neon Postgres** `@neondatabase/serverless` | **Primary datastore — holds essentially ALL persistent PII** | Email, profiles, purchase history, **full postal addresses**, **correspondence bodies**, encrypted OAuth tokens | **Region not pinned in code — highest-stakes residency unknown** | Not evidenced → OQ-02 | n/a (degrades to no-persistence if unset) |
| P-07 | **Upstash Redis** `@upstash/ratelimit` | Rate-limiting only | **IP address** and/or session id as keys; two buckets key on **email**/IP | Region not in code | Not evidenced → OQ-02 | Window-TTL only; `analytics:false` |
| P-08 | **Pingen** (REST; CH → Deutsche Post) | Print + post physical letters | **Full recipient name + postal address travel to CH inside the uploaded PDF bytes**; PDF also contains AI-drafted letter body. (The JSON request body carries no structured address — Pingen reads it from the PDF) | **YES — Switzerland (explicit third-country transfer)** | **AV-Vertrag required; in-code comment claims "APPROVED by Legal 2026-06-14"** — confirm (OQ-01). CH benefits from an EU adequacy decision; the repo handles it via AVV, not SCCs | `PHYSICAL_MAIL_SENDS_APPROVED` (code default **false**; `.env.example` shows **true**) |
| P-09 | **Sentry** `@sentry/nextjs` | Optional server error capture | Tags (route, archetype, message count) by design. **But no `beforeSend`/scrubbing**, so error *messages/stacks* could carry chat text, email, GraphQL `email:"…"`, or addresses | US unless an EU DSN is provisioned (not in code) | Not evidenced; only active if `SENTRY_DSN` set → OQ-04 | No-ops without DSN |

### Transfer summary
- **Confirmed third-country today:** **Pingen → Switzerland** (explicit, gated; CH has an EU adequacy decision — confirm you rely on adequacy rather than needing SCCs).
- **US transfers by default endpoint, no EU region in code:** Anthropic, OpenAI, Resend, Sentry — and **Shopify, Vercel, Neon, Upstash** as US-HQ processors whose effective region cannot be verified from the repo. For each US processor you will need either an EU-region configuration, **EU–US Data Privacy Framework** certification, or **SCCs** — none of which are evidenced in code.

---

# 6. Data Minimisation & Security

### 6.1 What reaches the AI models — and what is deliberately withheld

The system prompt is assembled in `src/lib/system-prompt.ts`; the memory gate is `src/lib/customer-memory.ts`. Confirmed by reading both:

**Sent to Anthropic:** the conversation messages (verbatim), catalog product data for retrieved items, persona/profile fields *inferred from the chat*, and — only for a re-identified/consented customer — a **minimised** memory block: cached profile summary, owned-item **titles + quantities** (no order numbers, no totals), prior-consultation count, first-seen date, display name, and **city + country only**.

**Deliberately withheld from every model prompt** (verified across all 7 Anthropic call sites): the **email address**, the **full street address** (only `name` reaches the letter draft; only city/country reaches profile/chat), **order totals and order numbers**, and **raw transcripts of prior sessions** (only the condensed profile summary).

**Sent to OpenAI:** only the user's search query (embeddings) and the assistant's reply text (TTS). No identifiers.

**Privacy gate on memory (strong):** tier-2 memory unlocks **only** when the user typed the email in *this* session **and** the server confirms that email's consent record was captured *from this very session id* (`wasEmailCapturedFromSession`, fail-closed) — never from a localStorage session id alone (defends shared/family devices). Tier-3 requires a live access token. Personalisation is additionally gated on `marketing_status='confirmed'` (`canPersonaliseSignedIn`).

→ **This is genuinely good data minimisation.** The main thing for you to confirm is the *lawful basis* for the personalisation itself (LB-06 / OQ-05), not the technical minimisation.

### 6.2 Security / Technical & Organisational Measures (TOMs)

| # | Measure | Status | Evidence |
|---|---|---|---|
| S-01 | **OAuth tokens encrypted at rest** (AES-256-GCM, authenticated) | ✅ | `src/lib/token-crypto.ts:1-89`; fails loudly if `TOKEN_ENC_KEY` unset/short |
| S-02 | Tokens **never sent to the browser**; refresh rotation atomic | ✅ | `src/lib/customer-oauth-store.ts` |
| S-03 | Widget endpoints: **origin allowlist + shared-secret header** | ✅ | `src/lib/security.ts:78-107` |
| S-04 | **Constant-time** secret comparisons (chat secret, cron secret, admin password) | ✅ | `security.ts:61-67`, `cron-auth.ts:15-21`, `admin-auth.ts:76-97` |
| S-05 | Cron routes gated by `CRON_SECRET`, fail-closed | ✅ | `src/lib/cron-auth.ts:27-34` |
| S-06 | Inbound webhooks (Resend, Pingen) **signature-verified over raw body, fail-closed** | ✅ | `inbound/resend/route.ts:30-57`, `pingen-webhook.mjs:55-90` |
| S-07 | Sign-in OAuth uses **PKCE (S256)** + signed state + nonce; pending state single-use, TTL-purged | ✅ | `src/lib/shopify-customer-account.ts` |
| S-08 | Account endpoints fail closed (origin+secret+live token; ownership-scoped, no enumeration leak) | ✅ | `src/lib/account-guard.ts` |
| S-09 | PII not deliberately logged to Sentry (context object is scrubbed by contract) | ⚠ Partial | `src/lib/observability.ts:42-86` — but **no `beforeSend`** (OQ-04) |
| S-10 | **Admin dashboard auth = single shared password** → signed 12h cookie | ⚠ Notable | `src/lib/admin-auth.ts` — see below |
| S-11 | Retention/erasure enforced daily by cron | ✅ | `src/lib/retention.ts`; `vercel.json` (03:30) |
| S-12 | Secrets via env only; nothing committed; `.env.example` uses empty placeholders | ✅ | `.env.example` |

**Admin access-control caveat (S-10).** The entire admin dashboard — which exposes the full customer PII trove (emails, AI profiles, purchase history, correspondence threads, postal addresses) — is protected by **one shared password** and a signed cookie. There is **no per-user identity, no 2FA, no IP restriction, and no audit log of which admin viewed which customer's data.** Defensible for a single-operator back office, but for a regulator this is a TOM worth strengthening (named admin accounts + access logging). → **OQ-15.**

### 6.3 Retention / erasure jobs (enforcement)

Daily cron `GET /api/cron/retention` (`vercel.json` 03:30, `CRON_SECRET`-protected) runs `runRetention()` (`src/lib/retention.ts`): abandons stale conversations (30 min); deletes conversations+messages+chat usage (180 d); deletes kpi_events + dashboard ai_usage (180 d); purges PII for opted-out captures + their customers (30 d grace, suppression row kept); purges correspondence (365 d) and physical letters (365 d); purges expired pending-auth (~10 min). **Gaps:** the **`feedback` table is not purged** (OQ-10), and **active consented customers have no inactivity/maximum-retention deletion** (OQ-09).

---

# 7. Records of Processing — Draft Verzeichnis von Verarbeitungstätigkeiten (Art. 30)

A controller-side draft the client can adopt and complete. **Bracketed items need the client/lawyer to fill in.**

**Controller:** [motion sports — legal entity, address] · **Managing director:** [name] · **DPO / Art. 27 rep:** [name or "not appointed — confirm Art. 37 threshold"]
**System:** "Mo" AI consultation chatbot backend (Vercel + Neon).

### VVT-1 — Chatbot consultation & analytics
- **Purpose:** provide AI fitness consultation; product/usage analytics.
- **Data subjects:** website visitors (anonymous/pseudonymous).
- **Categories:** session id, chat free-text, persona/profile inferences, product interactions, AI token counts, IP (rate-limit, transient).
- **Legal basis:** Art. 6(1)(b)/(f).
- **Recipients/processors:** Anthropic (US), OpenAI (US), Vercel (host), Neon (DB), Upstash (rate-limit). [confirm regions]
- **Third-country transfers:** US (Anthropic, OpenAI, + US-HQ infra) — [DPF/SCCs to confirm].
- **Retention:** 180 days (conversations, kpi_events).
- **TOMs:** origin+secret guard, rate-limiting, data minimisation into models, encryption in transit. [DB encryption-at-rest per Neon].

### VVT-2 — Email capture, transactional summary & marketing (DOI)
- **Purpose:** send requested conversation summary; consented marketing.
- **Data subjects:** visitors who submit their email.
- **Categories:** email, consent flags + verbatim consent text + version, DOI tokens, send history, discount codes.
- **Legal basis:** Art. 6(1)(b) (summary) / **Art. 6(1)(a) + §7(2) UWG** (marketing).
- **Recipients/processors:** Resend (email; US — [EU residency to confirm]), Shopify (discounts), Neon.
- **Third-country transfers:** US (Resend) — [to confirm].
- **Retention:** active consent kept (Art. 7 proof); opted-out PII purged after 30-day grace; suppression list kept indefinitely.
- **TOMs:** DOI, fail-closed suppression, signed unsubscribe, no pre-ticked boxes, verbatim audit.

### VVT-3 — Customer profile & personalisation (profiling)
- **Purpose:** durable "current understanding" profile + live-chat memory from past chats + Shopify purchases.
- **Data subjects:** identified/consented customers.
- **Categories:** profile summary (AI), purchase history (cached), prior-conversation links, minimised account snapshot (city/country).
- **Legal basis:** **Art. 6(1)(a)** (runtime-gated on confirmed marketing consent). [Art. 22 position + DPIA — OQ-05].
- **Recipients/processors:** Anthropic (US), Shopify, Neon.
- **Retention:** with the customer row [set a max — OQ-09]; cleared on erasure.

### VVT-4 — §7(3) UWG Bestandskunden marketing *(built, not active)*
- **Purpose:** existing-customer mail re: own similar products, without opt-in.
- **Legal basis:** §7 Abs. 3 UWG (+ Art. 6(1)(f)). **Currently OFF** pending boundary + copy sign-off (OQ-06).
- **Retention:** separate eligibility flag + separate opt-out list (kept).

### VVT-5 — Correspondence (unified mail log)
- **Purpose:** handle and thread customer email replies; feed customer knowledge base.
- **Categories:** **full email bodies (both directions)**, headers, threading ids, attachment metadata only; incl. unknown senders.
- **Legal basis:** Art. 6(1)(b)/(f).
- **Recipients/processors:** Resend (US — [EU residency]), Neon.
- **Retention:** 365 days. [confirm — OQ-08].

### VVT-6 — Signed-in identity (tier-3 Shopify Customer Accounts)
- **Purpose:** authenticated identity; act on customer's own Shopify data.
- **Categories:** Shopify customer id, **encrypted OAuth tokens**, name, minimised address snapshot.
- **Legal basis:** Art. 6(1)(b)/(f).
- **Recipients/processors:** Shopify (Customer Account API), Neon.
- **TOMs:** PKCE, AES-256-GCM token encryption, cascade-delete on erasure.

### VVT-7 — Physical mail (Pingen) *(gating disputed — see OQ-01)*
- **Purpose:** postal letters to customers.
- **Categories:** **full postal address + letter content**.
- **Legal basis:** [send context] **+ address-acquisition basis (OQ-01)**.
- **Recipients/processors:** **Pingen (Switzerland)** → Deutsche Post.
- **Third-country transfer:** **CH (adequacy decision; AVV required)**.
- **Retention:** 365 days.

### VVT-8 — Contact form
- **Purpose:** sales/B2B enquiries.
- **Categories:** name, email, phone, organisation, free-text message.
- **Legal basis:** Art. 6(1)(b)/(f).
- **Recipients/processors:** Resend (relay) → internal inbox. **Not stored in this system.**
- **Retention:** governed by the receiving mailbox [define org policy].

### VVT-9 — Feedback
- **Purpose:** product feedback.
- **Categories:** free-text, optional email + context.
- **Legal basis:** Art. 6(1)(f).
- **Retention:** **none enforced — OQ-10.**

### VVT-10 — Security monitoring (optional)
- **Purpose:** error capture.
- **Processor:** Sentry (US, if enabled). **PII-leak risk via error messages — OQ-04.**

---

# 8. Residual Risks & Open Questions for the Lawyer

Prioritised. **P1 = resolve before/at launch (legal-blocking or live exposure); P2 = resolve soon; P3 = housekeeping.** Mark each.

### P1 — Must resolve

**OQ-01 — Postal-address acquisition basis + auto-capture without consent (HEADLINE).**
The code itself says the address-acquisition lawful basis is *still open* (`src/lib/physical-address.mjs:5-9`, `src/lib/pingen-flag.mjs:11-12`). Yet **`autoCaptureMissingAddresses` runs on every admin dashboard page load**, fire-and-forget, and writes a customer's **full postal address** pulled from Shopify into `customers.postal_address` **with no consent check, no DOI check, and regardless of the send flag** (`src/lib/address-capture.ts:40-46`, `src/app/admin/page.tsx:142-144`). One branch even labels the source `'consented_capture'` while taking the Shopify *account default address* with **no consent record verified**. Meanwhile `.env.example` shows physical **sending** switched on ("APPROVED by Legal 2026-06-14"). So: *sending* is gated, but *collection/storage* of full addresses is already live and the basis is, by the code's own admission, unsettled.
*Questions:* (a) What is the lawful basis for **acquiring and storing** the full postal address (purchase-derived vs. consented)? (b) Is silent background collection on admin page load acceptable, or must it require an explicit trigger/consent? (c) Was the 2026-06-14 approval meant to cover *acquisition*, or only *sending*? (d) Does the privacy policy disclose this collection?
☐ Approve as-is ☐ Require consent gate on capture ☐ Restrict to `'purchase'` source only ☐ Other: ____

**OQ-02 — DPA/AVV register: which processor agreements are actually signed?**
No DPA is evidenced in code for **any** processor; there is no DPA register. Art. 28 requires a DPA with every processor: **Anthropic, OpenAI, Resend, Shopify, Vercel, Neon, Upstash, Sentry, Pingen.**
*Action:* confirm/obtain and file a signed DPA/AVV for each. List which exist.
☐ All signed (attach list) ☐ Missing: __________________

**OQ-03 — AI providers: no-training / zero-data-retention terms.**
Chat transcripts and (for profiling) purchase history + transcripts go to **Anthropic (US)**; query text + reply text go to **OpenAI (US)**. The code cannot show whether **no-model-training** and **zero/short data-retention** terms are in force, nor an EU region.
*Question:* Are Anthropic/OpenAI engaged under enterprise/API terms with no-training + ZDR, and is the US transfer covered (DPF certification / SCCs)?
☐ Confirmed (attach) ☐ Action needed: __________________

**OQ-04 — Sentry PII exposure.**
If `SENTRY_DSN` is set, errors go to Sentry (US by default). The context object is scrubbed by contract, but there is **no `beforeSend` scrubber**, so error *messages/stacks* can incidentally carry chat text, email, GraphQL `email:"…"`, or postal addresses (e.g. the chat-stream `onError` forwards provider errors; Resend/Shopify/Pingen errors may embed identifiers).
*Action:* decide whether Sentry is enabled in production; if so, require a `beforeSend`/server-side data-scrubbing config and an EU DSN, and a Sentry DPA.
☐ Sentry off in prod ☐ Require scrubber + EU DSN + DPA ☐ Accept residual risk (document)

**OQ-05 — Profiling / Art. 22 / DPIA.**
The system builds a durable AI profile from past chats + purchases and personalises future consultations. `docs/CUSTOMERS.md:118-121` claims the Art. 22 / DPIA question was "assessed during the review," but **no DPIA document exists in the repo.**
*Questions:* (a) Confirm this profiling produces **no solely-automated decision with legal/similarly-significant effect** (Art. 22) — it appears to only tailor recommendations, with a human able to buy or not. (b) Given large-scale + AI + profiling, is a **documented DPIA** (Art. 35) required? Please produce/confirm one.
☐ No DPIA required (document rationale) ☐ DPIA required — to be produced

**OQ-13 — Resend inbound EU data residency.**
The team's own spike flags this as a **"legal-blocking"** check: confirm Resend inbound storage/processing can be pinned to the EU (mail bodies are personal data) — else use an EU inbound route (`docs/EMAIL_SUBSYSTEM_SPIKE.md:118-122`). No region is set in code.
☐ EU residency confirmed ☐ Switch inbound to EU provider ☐ Accept US + DPF/SCC (document)

**OQ-06 — §7(3) "own similar products" boundary + copy (before flipping the flag).**
The §7(3) audience, eligibility (completed purchase only), separate opt-out and mandatory objection-notice *structure* are built and **gated OFF** (`BESTANDSKUNDE_SENDS_APPROVED=false`). But the **"own similar products" boundary is not defined or enforced in code** (placeholder body copy), and the German opt-out/objection copy is a lawyer-pending placeholder (`src/lib/consent-copy.ts:415-448`). There is also **no production §7(3) send route yet** — only an admin test-send.
*Action (only if §7(3) campaigns are in scope):* define the "similar products" boundary, approve the opt-out copy, then flip the flag. **Do not flip before.** Also confirm the completed-purchase definition (`PAID` / `PARTIALLY_REFUNDED` only).
☐ Keep OFF ☐ Approve boundary + copy (attach) then enable

### P2 — Resolve soon

**OQ-07 — Erasure semantics (partial-erasure model).** Confirm that **single-chat delete deliberately leaves already-derived profile text in place** until regeneration/full erasure is acceptable (§4). ☐ Accept ☐ Require profile clear on single delete

**OQ-08 — Correspondence retention + unknown senders.** Full inbound + outbound email **bodies** are stored **365 days**, including replies from **unknown** senders (`customer_id NULL`). This is the largest free-text PII store. Confirm 365 days under LI and that storing unknown-sender bodies is justified. The retention window is self-flagged "pending Legal sign-off" (`docs/DATA_RETENTION.md:155-157`). ☐ Approve 365 d ☐ Set: ____ days ☐ Restrict unknown-sender storage

**OQ-09 — Storage limitation for active customers (Art. 5(1)(e)).** A consented customer who never unsubscribes has **no maximum-retention / inactivity deletion** — email, AI profile, purchase summary, postal address persist indefinitely (`customers` row, D-12). Define a max-retention or inactivity window. ☐ Set inactivity window: ____ months ☐ Justify indefinite retention

**OQ-10 — Feedback retention.** `feedback` rows (free-text + optional email/PII) are **never purged** by the retention cron (D-20). Define a window. ☐ Set: ____ days ☐ Other

**OQ-11 — Art. 15/20 completeness.** Self-service access exists for tier-3 conversations only (PDF of one thread). **Profile, purchase summary, consent record, correspondence, and postal address are not exposed to the subject**, and there is no structured machine-readable export. Confirm the manual SAR process covers these, or require a complete export endpoint. ☐ Manual SAR covers it ☐ Build full/structured export

**OQ-14 — Shopify Protected Customer Data.** Code comments note PCD access approval + specific scopes may be required (`src/lib/shopify-orders.ts:10-13`). Confirm Shopify PCD approval is in place and the data-minimisation/retention commitments Shopify requires are met. ☐ Approved ☐ Action needed

**OQ-15 — Admin access control (TOM).** Single shared password, no named accounts, no 2FA, **no audit log of admin PII access** (§6.2). Decide whether to strengthen before processing real customer data at scale. ☐ Accept for single-operator ☐ Require named accounts + access log

### P3 — Housekeeping

**OQ-12 — Privacy/Impressum links resolve + match.** Confirm `https://motionsports.de/policies/privacy-policy` and `/pages/impressum` resolve on the live shop, and that the **privacy-policy text actually describes** profile-building from past sessions + purchases, the AI processors, third-country transfers, and the retention windows above. The code self-flags the URL as unverified (`src/lib/consent-copy.ts:159-164`). ☐ Confirmed ☐ Update policy text

**OQ-16 — Marketing send frequency cap.** The capture endpoint has a per-recipient cap, but the **marketing campaign send path has no per-recipient frequency cap** (only per-draft double-send protection). Low risk (admin-triggered per draft) — confirm acceptable. ☐ Accept ☐ Add cap

**OQ-17 — Bestandskunde test-send recipient.** The §7(3) **test-send recipient is validated only by email regex, not restricted to an internal domain** — an admin could direct a "test" to any address carrying a real customer's opt-out token. Low risk (admin-only, flag off). ☐ Accept ☐ Restrict to allow-list

**OQ-18 — Contact-form & log hygiene.** Contact-form data leaves the system to an internal inbox (define its retention/access), and in a mis-configured deploy the full submission (incl. email/phone) is written to stdout logs (`src/app/api/contact/route.ts:127-139`). ☐ Acceptable ☐ Tighten

---

# Executive Summary (one page)

**System.** The backend for "Mo," an AI fitness-consultation chatbot on motionsports.de (German fitness e-commerce). It runs the chat (Anthropic Claude), captures email with double-opt-in marketing consent, builds AI customer profiles, sends transactional/marketing/correspondence email (Resend) and optionally physical letters (Pingen/CH), and integrates Shopify for identity and orders. Data lives in Neon Postgres; rate-limiting in Upstash; hosting on Vercel.

**Overall posture — genuinely strong architecture, with specific gaps.** The GDPR design is unusually disciplined: a deliberate split between pseudonymous analytics (Art. 6(1)(f)) and consented marketing (Art. 6(1)(a)); a real, Planet49-compliant double-opt-in with unchecked boxes and verbatim, version-stamped consent audit; fail-closed suppression; AES-256-GCM token encryption; strong data minimisation into the AI models (email and full street address are never sent); and an enforced daily retention cron. Most safeguards in the comments are actually enforced in code, not just aspirational. **This report does not, however, declare conformity** — and the codebase's in-code "lawyer-approved (June 2026)" and "approved by Legal (2026-06-14)" markers should be treated as claims for you to confirm, including the scope of what they covered.

**Must-resolve before relying on the system (P1):**
1. **Postal-address auto-capture without consent (OQ-01).** Full addresses are collected from Shopify and stored on every admin page load with no consent/flag check, while the code itself calls the acquisition basis "open" and physical sending appears switched on. Resolve the acquisition basis and gate the collection.
2. **No DPA register and no pinned data residency (OQ-02).** No processor DPA/AVV is evidenced in code, and no EU region is pinned for any processor — **Neon (all persistent PII) and Resend inbound (full email bodies) are the highest-stakes unknowns.** Confirm signed DPAs and EU residency / DPF / SCCs.
3. **AI-provider terms + transfers (OQ-03).** Confirm Anthropic/OpenAI no-training + zero-data-retention terms and that the US transfer is covered.
4. **Sentry PII leakage (OQ-04).** If enabled, error messages can carry chat text/email/addresses; no scrubber is configured.
5. **Profiling / DPIA (OQ-05)** and **Resend inbound EU residency (OQ-13)** — both self-flagged by the team as pending.
6. **§7(3) Bestandskunden (OQ-06):** keep OFF until the "own similar products" boundary and opt-out copy are signed off.

**Resolve soon (P2):** erasure semantics for the derived profile (OQ-07); correspondence retention incl. unknown senders (OQ-08); **storage-limitation gaps** — active customers (OQ-09) and feedback (OQ-10) have no deletion window; completeness of access/portability (OQ-11); Shopify Protected Customer Data approval (OQ-14); and admin access-control hardening + audit logging (OQ-15).

**Bottom line for counsel.** The engineering is well ahead of typical market practice and the consent/DOI core looks defensible. The residual risk is concentrated not in the chat itself but in **(a) the address pipeline, (b) the contractual/residency layer around the processors, and (c) a few storage-limitation and monitoring details.** None of these is a redesign; each is a discrete decision, contract, or config you can approve or direct in the item-by-item list above.

*— End of report. Prepared read-only from the codebase at branch `claude/trusting-carson-dssxxs`, 2026-06-16. Citations are to source files at that commit; "cannot verify from code" items depend on contracts/settings outside the repository.*
