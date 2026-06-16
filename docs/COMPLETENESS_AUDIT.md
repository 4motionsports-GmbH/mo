# Completeness audit — every intended feature implemented + wired?

**Date:** 2026-06-16 · **Scope:** the seven major capability clusters of the
backend — identity tiers, consent/DOI, the marketing dashboard, bundles, the
email subsystem, voice/TTS/markdown/feedback, and the cron jobs.

**Method:** every intended capability was traced from its spec doc
(`API_CONTRACT`, `CONSENT_FLOW`, `CUSTOMER_ACCOUNT`, `BUNDLES`,
`ADMIN_DASHBOARD`, `DATA_RETENTION`, `EMAIL_SUBSYSTEM_SPIKE`, and the
`frontend-handoff/` contracts) to the implementing source, verifying **wiring**
— route registered, function has a live caller, cron in `vercel.json`, feature
flag actually read in the send path, UI tab fed by a real endpoint — not merely
that code exists. Read-only inventory; the remediation that followed is recorded
at the end.

This complements the 2026-06-12 `AUDIT_BACKEND.md` (a docs-vs-code *contract*
audit). This one asks the orthogonal question: **is anything half-built or
orphaned?**

---

## Bottom line

**The backend is feature-complete and end-to-end wired.** All seven clusters are
implemented. Cross-cutting sweeps confirm it: every one of the ~40 HTTP routes
maps to a cluster (no orphan endpoints); there are **no `TODO`/`FIXME`/
unimplemented code stubs** (the only `PLACEHOLDER` strings are intentional — the
`MO-XXXX` discount token, the synthetic `shopify:<id>` email, and the
lawyer-pending §7(3) copy); the identity-merge function, the eager-persistence
call, and the bundle-expiry sweep all have **proven live callers** (not
orphaned); and the migration runner (`scripts/migrate.mjs`) globs the full
`migrations/*.sql` chain against a `_migrations` ledger, so the newest tables
(`email_messages`, `physical_letters`, perf indexes) are actually created.

The residual items fall into three buckets, none of which is a half-built
feature:

1. **Intentional pre-launch gates (three fail-closed flags, all read in the send
   path):** §7(3) Bestandskunden sends (`BESTANDSKUNDE_SENDS_APPROVED`), physical
   mail (`PHYSICAL_MAIL_SENDS_APPROVED`), and DOI lawyer sign-off
   (`CONSENT_COPY_LAWYER_APPROVED`). The §7(3) legal copy is additionally marked
   *"PLACEHOLDER — lawyer review required"* (`src/lib/consent-copy.ts:415`).
2. **One genuine hardening gap (now closed — see Remediation):** the marketing
   discount mismatch lockout was UI-only; there was no server-side guard.
3. **Doc-drift (now patched — see Remediation):** several docs lagged the more
   complete, more consolidated code.

---

## Per-cluster findings

### 1 · Identity tiers + conversation history + PDF summary — IMPLEMENTED

- **Three tiers** (anon / email-DOI / signed-in) backed by
  `customers.identity_tier` with `GREATEST(...)` no-downgrade semantics
  (`customer-store.ts`, migration 0014).
- **Login both ways:** chatbot OAuth (PKCE: `auth/shopify/login` → `callback`)
  and shop-native App Proxy (`auth/storefront`, HMAC-verified) — **both call the
  same merge** `bindShopifyIdentity` (`callback/route.ts:110`,
  `storefront/route.ts:96`).
- **Merge rule:** `decideMerge` (`customer-merge.mjs:34`, unit-tested) prefers
  the Shopify identity, carries DOI consent forward, logs conflicts to
  `customer_merge_conflicts` — **proven called**, not orphaned.
- **History list/open/rename/delete:** real `GET`/`PATCH`/`DELETE` handlers
  (`account/conversations/[id]/route.ts`), ownership-scoped. **Eager
  persistence** fires *before* the stream (`chat/route.ts:296`, concurrent with
  retrieval).
- **PDF summary:** `account/summary` → shared `buildSummaryDocument` →
  dependency-free `buildSummaryPdf`, delivered as an `application/pdf`
  attachment.
- *Config dependency (doc-acknowledged, not a code gap):* shop-native login needs
  the Shopify App Proxy + theme + `SHOPIFY_APP_PROXY_SECRET` configured
  store-side; until then the chatbot "Anmelden" is the path, and a pure
  shop-native session (no Customer-Account token) needs a one-tap sign-in for
  full `/api/account/*` history.

### 2 · Consent / DOI / suppression / §7(3) Bestandskunden — IMPLEMENTED

- **DOI** full lifecycle (capture → pending → confirmation email → confirm
  endpoint → confirmed; 7-day expiry → HTTP 410).
- **Consent copy v3** is what the code serves: `CONSENT_COPY_VERSION = "v3"`
  (`consent-copy-version.mjs:30`), via both the `offer_email_summary` tool output
  and `GET /api/consent-copy`.
- **Version capture:** `resolveConsentCopyVersion` stamps the row only on a
  byte-identical echo, persisted with the verbatim text
  (`email-capture-store.ts:214`).
- **Suppression** fail-closed (`true` on no-DB/error), never re-pended,
  re-checked before every send.
- **Unsubscribe:** HMAC signed-token endpoint suppresses + revokes DOI in one
  transaction.
- **§7(3) Bestandskunden:** genuinely separate lawful basis — own **read** gate
  flag `BESTANDSKUNDE_SENDS_APPROVED` (consumed in `bestandskunden-store.ts:122`),
  domain-separated opt-out token + separate suppression list, separate
  eligibility (≥1 paid order). **Built, gated OFF by design** — only an admin
  test-send exists; no production broadcast route (intentional, pending lawyer
  sign-off + finalized copy).

### 3 · Marketing dashboard — IMPLEMENTED (one hardening gap, since closed)

- **Implemented:** eligibility (`WHERE marketing_doi_status='confirmed' AND
  unsubscribed_at IS NULL AND NOT EXISTS suppression_list`, enforced in list +
  draft + send); personalized draft with KB **including correspondence** injected
  as a prompt section (`marketing-draft.ts:467`); **atomic send** (conditional
  `WHERE status='draft'` claim + `WHERE status<>'sent'` flip, code minted inside
  the claim); **sent = read-only** (server-guarded update/delete); **bulk queue**
  (concurrency-pooled bulk-*draft*); **draft delete**; **cost-per-consultation**
  (per-conversation token→EUR mean/median, `ai-usage-store.ts`, rendered in KPI +
  Overview); **charts** (recharts Area/Pie/Bar/Funnel, all fed real data).
- **Mismatch lockout — was the one gap.** The documented behavior
  (`ADMIN_DASHBOARD.md` — *the UI flags a mismatch, disables Send, requires ↻ Neu
  generieren*) **is implemented** client-side, and the minted code/expiry are
  swapped 1:1 from the row so they structurally cannot drift. The gap was the
  absence of a *server-side* guard: `send/route.ts` accepts only `{sendId}` and
  never validated the prose against the depth, so a direct API caller or a
  hand-edited body stating a different number was not caught server-side.
  **Closed in this change** (see Remediation).
- *By design:* no one-click **bulk-send** (every send is individually
  human-reviewed); **Marketing is folded into the Kunden workspace** (filter
  preset + per-customer "Marketing" sub-section + bulk-draft bar) rather than a
  fifth top-level tab. The shipped `AdminShell` has four tabs (Übersicht / Kunden
  / KPIs / Feedback), all fed by real endpoints.

### 4 · Bundles — IMPLEMENTED

AI suggest (guards against hallucinated/owned/sold-out ids); compose/catalog
search; **native + fallback seam** (`pickBundleCreator` → `productBundleCreate`
poll vs `productCreate` draft) with **publication scopes asserted**
(`assertPublicationScopes`); tracked link minted + resolved at `/api/r/[token]`
(logs `bundle_offer_clicked`); **expiry cron** (`vercel.json` `45 3 * * *`,
idempotent `status='expired'` UPDATE) + **friendly HTTP-410 "Angebot abgelaufen"
page**; archive (→ Shopify `ARCHIVED`); strict pending/failed-only draft delete;
**PAngV compare-at** (true component-sum strike only when `price < sum`, written
to the Shopify variant + the email "statt" line).

### 5 · Email subsystem — IMPLEMENTED

- Inbound receive (signature-verified before parse, fail-closed without
  `RESEND_WEBHOOK_SECRET`); **dedup** (unique partial index on `message_id` +
  `ON CONFLICT DO NOTHING`); **threading** (`from` → `customers.email`; thread =
  References-root → In-Reply-To → own Message-ID).
- **Unified log + mirror-write:** all five **customer-directed** send paths
  mirror-write into `email_messages` (marketing, summary/DOI-doc, DOI-confirm ×2,
  Korrespondenz reply). The two non-writers (contact-form lead → our own inbox;
  §7(3) test-send → admin) are **non-customer mail, correctly excluded**.
- KB correspondence block loaded + injected into the profile, marketing-draft,
  **and** letter-draft prompts; in-admin Korrespondenz client (read/send/assign,
  all wired); unmatched-inbound queue (`customer_id IS NULL` query +
  assign-with-re-threading); **physical mail (Pingen)** flag-gated (read pre-send
  in UI *and* server), real OAuth2 REST client, lawful-address gating, status
  webhook wired.

### 6 · Voice / streaming TTS / markdown / feedback — IMPLEMENTED

TTS genuinely **streams** the upstream MP3 body (`new Response(upstream.body)`,
`tts/route.ts:213`, `X-Accel-Buffering: no`), OpenAI `gpt-4o-mini-tts`/`alloy`,
`prepareTtsText` normalization applied, guarded + rate-limited, documented
fallback to browser `speechSynthesis`. STT is browser-side **by design** (no
audio reaches the backend). The admin `markdown.tsx` renderer is safe and used in
four files (not orphaned). Feedback is end-to-end: route → validation → store →
migration 0020 → `FeedbackTab`/`FeedbackList` (a real rendered tab).

### 7 · Crons — IMPLEMENTED (scheduled + auth-guarded + alerted)

All four (`refresh-customers 0 2`, `sync-catalog 0 3`, `retention 30 3`,
`expire-bundles 45 3`) are in `vercel.json`, first-line `requireCronAuth`, and
route failures to `reportError` → Sentry (`@sentry/nextjs` is a real runtime
dependency, not a stub). **Retention purges `email_messages`**
(`retention.ts:181`, 365-day window by `occurred_at`) and `physical_letters` — no
orphaned-PII gap. *Config dependency:* alerting only pages when `SENTRY_DSN` is
set (otherwise stdout-only, by design).

---

## Pre-launch decision list

**Gates to flip (and their prerequisites):**

- `CONSENT_COPY_LAWYER_APPROVED` — DOI marketing copy sign-off.
- `BESTANDSKUNDE_SENDS_APPROVED` — needs the §7(3) copy
  (`src/lib/consent-copy.ts`, currently PLACEHOLDER) lawyer-approved and the
  "own similar products" boundary defined. No production §7(3) send route exists
  yet (only test-send) — build it *after* the gate is cleared if §7(3) campaigns
  are in scope.
- `PHYSICAL_MAIL_SENDS_APPROVED` — Pingen go-live.

**Deployment config to confirm:** `SENTRY_DSN` (else cron failures are
stdout-only); `SHOPIFY_APP_PROXY_SECRET` + the App Proxy/theme (else shop-native
login cannot fire).

---

## Status table (as found, 2026-06-16)

| # | Capability | Status | Gap | Fix size |
|---|---|---|---|---|
| 1.1 | Anonymous tier | IMPLEMENTED | — | — |
| 1.2 | Email-only DOI tier | IMPLEMENTED | — | — |
| 1.3 | Signed-in tier | IMPLEMENTED | — | — |
| 1.4 | Chatbot OAuth login | IMPLEMENTED | — | — |
| 1.5 | Shop-native (App Proxy) login | IMPLEMENTED | Needs `SHOPIFY_APP_PROXY_SECRET` + theme set up store-side | Config only |
| 1.6 | Merge rule | IMPLEMENTED | — | — |
| 1.7 | History list/open/rename/delete | IMPLEMENTED | — | — |
| 1.8 | Eager persistence | IMPLEMENTED | — | — |
| 1.9 | PDF summary | IMPLEMENTED | — | — |
| 2.1 | DOI flow | IMPLEMENTED | — | — |
| 2.2 | Consent copy v3 served | IMPLEMENTED | (doc examples said v2 — patched) | Doc 1-line |
| 2.3 | Consent-version capture | IMPLEMENTED | — | — |
| 2.4 | Suppression (fail-closed) | IMPLEMENTED | — | — |
| 2.5 | Unsubscribe (suppress + revoke) | IMPLEMENTED | — | — |
| 2.6 | §7(3) separate basis + gate flag | IMPLEMENTED | Built + gated OFF; legal copy PLACEHOLDER; no prod send route (by design) | Legal sign-off; new route only if §7(3) campaigns wanted |
| 3.1 | Eligibility | IMPLEMENTED | — | — |
| 3.2 | Draft w/ KB + correspondence | IMPLEMENTED | — | — |
| 3.3 | Discount input | IMPLEMENTED | — | — |
| 3.4 | Mismatch lockout | IMPLEMENTED* | Was UI-only; **server-side guard added in this change** | ~60 LOC + tests (done) |
| 3.5 | Atomic send (mint-at-send) | IMPLEMENTED | — | — |
| 3.6 | Sent = read-only | IMPLEMENTED | — | — |
| 3.7 | Bulk queue | IMPLEMENTED | Bulk-draft only; bulk-send omitted by design | — |
| 3.8 | Draft delete | IMPLEMENTED | — | — |
| 3.9 | Cost-per-consultation metrics | IMPLEMENTED | — | — |
| 3.10 | Charts | IMPLEMENTED | — | — |
| 3.11 | Tabs (Overview/Kunden/Marketing/KPI/Feedback) | IMPLEMENTED* | Marketing folded into Kunden, not a 5th tab (intentional; doc patched) | Doc, or ~20-40 LOC for a tab |
| 4.1 | AI suggest | IMPLEMENTED | — | — |
| 4.2 | Compose / search | IMPLEMENTED | — | — |
| 4.3 | Create (native+fallback, scopes) | IMPLEMENTED | — | — |
| 4.4 | Tracked link | IMPLEMENTED | — | — |
| 4.5 | Expiry cron + expired page | IMPLEMENTED | — | — |
| 4.6 | Archive | IMPLEMENTED | — | — |
| 4.7 | Draft delete | IMPLEMENTED | — | — |
| 4.8 | PAngV compare-at | IMPLEMENTED | — | — |
| 5.1 | Inbound receive | IMPLEMENTED | — | — |
| 5.2 | Dedup | IMPLEMENTED | — | — |
| 5.3 | Threading | IMPLEMENTED | — | — |
| 5.4 | Unified log + mirror-write | IMPLEMENTED | Contact-form + §7(3) test-send excluded (non-customer) by design | — |
| 5.5 | KB correspondence block | IMPLEMENTED | — | — |
| 5.6 | In-admin Korrespondenz client | IMPLEMENTED | — | — |
| 5.7 | Unmatched-inbound queue | IMPLEMENTED | — | — |
| 5.8 | Physical mail (Pingen), flag-gated | IMPLEMENTED | Gated OFF (`PHYSICAL_MAIL_SENDS_APPROVED`) + Pingen go-live config | Config / flag flip |
| 6.1 | Voice mode (backend role) | IMPLEMENTED | STT browser-side by design | — |
| 6.2 | Streaming TTS | IMPLEMENTED | — | — |
| 6.3 | Markdown rendering | IMPLEMENTED | — | — |
| 6.4 | Feedback feature | IMPLEMENTED | — | — |
| 7.1 | Catalog-sync cron | IMPLEMENTED | — | — |
| 7.2 | Retention cron (incl. `email_messages`) | IMPLEMENTED | — | — |
| 7.3 | Expire-bundles cron | IMPLEMENTED | — | — |
| 7.4 | Refresh-customers cron | IMPLEMENTED | — | — |
| — | Cron alerting actually pages | IMPLEMENTED | Stdout-only unless `SENTRY_DSN` set | Config only |

**As-found tally:** 47 capabilities → 45 IMPLEMENTED, 2 PARTIAL (3.4 server-side
hardening; 3.11 Marketing-as-tab). **0 MISSING, 0 ORPHANED.**

\* Items marked with an asterisk were remediated in the change that introduced
this document.

---

## Remediation in this change

- **3.4 — server-side discount mismatch guard.** Added
  `detectDiscountTextMismatch` (`src/lib/discount-validation.mjs`) and a new
  `discount_mismatch` gate inside `approveAndSend`
  (`src/lib/marketing-email.ts`), placed after the atomic claim and before code
  minting so a refusal reverts the claim and never burns a code; mapped to HTTP
  409 in `src/app/api/admin/marketing/send/route.ts`. The detector is
  conservative — digit-boundary safe and limited to the plausible discount range
  [1, 50] — so rhetorical figures ("100 % zufrieden") and code-only drafts never
  false-block a send. Covered by unit tests in `discount-validation.test.mjs`.
- **Doc-drift (c).** Patched the consent version (`v2` → `v3`) in the contract
  examples (`API_CONTRACT.md` and its synced `frontend-handoff/` copy), the
  `ADMIN_DASHBOARD` discount selector (now described as a 0–50 numeric input) and
  tab list (four tabs — Übersicht/Kunden/KPIs/Feedback — with Marketing folded
  into Kunden), and a missing `physical_letters` step in `DATA_RETENTION`'s
  enforcement list + sample response. The `src/lib/consent-copy.ts` JSDoc was
  corrected from "v2" to "v3". The other items the prior audit had flagged — the
  `/api/chat` SSE chunk protocol, the `§10` tracked-redirect section, and the
  `DATA_RETENTION` FK / "consent flow is future work" lines — were verified to be
  **already current** in the docs (corrected in an update after 2026-06-12), so
  no change was needed.
