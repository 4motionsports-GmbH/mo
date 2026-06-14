# Email subsystem — inbound mail, unified per-customer mail store, KB integration & physical mail — feasibility spike

**Status:** READ-ONLY SPIKE — no application code changed. Decision-ready report.
**Author context:** motionsports chat backend.
**Date:** 2026-06-14.
**Scope (Round 10D, items 7 / 8 / 10):** (a) RECEIVE inbound email per customer,
(b) a lightweight **in-admin email client** (send + read), (c) fold **all mail
(sent + received)** into each customer's knowledge base, (d) send **physical
mail** via an API (Pingen / DHL).

> **Scope finding (item 7).** TODAY we **only SEND**. There is no inbound
> channel, and email *content* is not in the knowledge base — the only email
> text we persist is `marketing_sends.drafted_text` for **sent marketing**
> emails (`migrations/0001_init.sql`, `src/lib/marketing-store.ts`).
> Transactional summary/DOI emails are rendered and sent but **not stored**
> (`src/lib/email.ts`, `src/lib/summary-email.ts`). So **item 7 ("all mail in
> the KB") REQUIRES item 8 (receive) first** — they are one subsystem. Item 10
> (physical mail) is a parallel **send-channel**. This spike treats 7+8 as a
> single build and 10 as an additive channel.

> **Doc-sourcing note (verification).** `resend.com`, `pingen.com`/`pingen.de`
> and `developer.dhl.com` all return **HTTP 403 to automated fetches** (confirmed
> during this spike — same block the codebase already documents for `shopify.dev`,
> `src/lib/shopify-discounts.ts:14`). Findings below were gathered on 2026-06-14
> from each vendor's **live published** docs, changelog and **public SDK
> READMEs/skills on GitHub** (which *are* fetchable) plus web search. Each claim
> carries a canonical URL for browser confirmation. Anything not re-confirmable
> against rendered docs is flagged **[VERIFY]** with a concrete check. The two
> claims that **must** be checked before building: (i) the exact Resend Node-SDK
> method names for inbound (`emails.receiving.get`, `webhooks.verify`) against the
> **pinned `resend@^6.12.4`** in `package.json`; (ii) Resend inbound **EU data
> residency** — see §1.

---

## Our surface (what this subsystem must fit inside)

- **Backend:** Next.js 16 on **Vercel**, Node runtime, **Neon** Postgres
  (`src/lib/db.ts`). Base URL `https://chat.motionsports.de`
  (`PUBLIC_BASE_URL` / `src/lib/base-url.ts`).
- **Email today — SEND ONLY, via Resend** (`resend@^6.12.4` already a dependency).
  `src/lib/email.ts` is the single choke-point: verified sender is
  `CONTACT_FROM_EMAIL` (e.g. `motion sports <kontakt@motionsports.de>`),
  `RESEND_API_KEY` gates real sending, every failure goes through
  `reportError`. Three senders ride on it: contact form (`/api/contact`),
  transactional summary + DOI (`src/lib/summary-email.ts`), and the marketing
  workflow (`src/lib/marketing-email.ts`).
- **Two GDPR clusters, never joined** (`migrations/0001_init.sql:1-14`):
  - **Cluster A — conversation/analytics** (legitimate interest), pseudonymous,
    keyed by `session_id`. `conversations` / `messages` / `kpi_events`.
  - **Cluster B — consent/marketing** (explicit consent), the **only** place an
    email address lives. `email_captures` (DOI audit), `customers` (person key =
    normalised email, `migrations/0008_customers.sql`), `marketing_sends`,
    `suppression_list`.
  - The optional bridge between them is the pseudonymous `session_id`, created
    only on an explicit `/api/capture-email`. A third lawful basis —
    **§7(3) UWG Bestandskunden** — lives in its own columns + opt-out list and
    is **never merged** with DOI consent (`migrations/0017_bestandskunden.sql`).
- **Knowledge-base pattern (the thing item 7 plugs into):** two on-demand
  Anthropic passes over *everything we know about one customer*:
  - `generateCustomerProfile` (`src/lib/customer-profile.ts`) — sessions +
    purchase history → one "current understanding" summary. **Email is
    deliberately NOT sent to the model** (data minimisation, `:18-21`).
  - `generateCustomerMarketingDraft` (`src/lib/marketing-draft.ts:392`) —
    sessions + cached `profileSummary` + owned items + admin instructions →
    personalised draft. Each conversation is rendered as a labelled
    `### Gespräch …` block (`draftSessionBlock`). **Email correspondence would
    become a sibling block to these** (§3).
- **Admin surface (Round 7):** authenticated dashboard (`src/app/admin/`), a
  **Kunden** tab with `CustomerProfileCard` / `CustomerCard`, a **Marketing**
  list (`MarketingList.tsx`) driving the draft→approve→send lifecycle. UI
  primitives in `src/app/admin/ui/` (dialog, table, tabs, textarea, badge…).

---

## 1. INBOUND EMAIL — how do we receive replies?

We need replies to our outbound mail to land in the backend as structured data,
mapped to a customer. Three architectures, all viable on Vercel + Neon:

| Option | How it delivers to us | Vercel/Neon fit | New vendors | Verdict |
|---|---|---|---|---|
| **A. Resend Inbound** | Resend's MX receives mail for a domain we point at it, then **POSTs a webhook** (`email.received`) to our route | **Native** — webhook → serverless route → Neon. Same vendor/SDK we already use to send | **0** (already integrated) | **RECOMMENDED** |
| **B. Cloudflare Email Routing → Email Worker → webhook** | Cloudflare MX, an `email()` Worker parses MIME and `fetch()`es our endpoint | Good — but the Worker is a 2nd runtime we maintain, and we parse MIME ourselves | +1 (Cloudflare) | Fallback |
| **C. IMAP polling of a mailbox** | We hold an IMAP mailbox and poll it on a cron | **Poor** — long-lived stateful IMAP connections fight serverless; needs a cursor, dedup, a hosted mailbox | +1 (mailbox host) | Rejected |

### Recommendation: **A — Resend Inbound**

Resend shipped **Inbound** (webhooks-based receiving) in **November 2025**
([changelog/blog](https://resend.com/blog/inbound-emails),
[announcement](https://alternativeto.net/news/2025/11/resend-adds-inbound-feature-for-webhooks-based-email-receiving-and-processing/)).
It is the obvious fit: **one vendor, one SDK, one verified domain**, and the
webhook model is serverless-native (no held connections, no polling cursor).

**How it works** (confirmed from Resend docs +
[`resend/resend-skills` webhooks reference](https://github.com/resend/resend-skills/blob/main/skills/resend/references/webhooks.md)):

1. Point **MX** for a receiving domain/subdomain at Resend and verify it in the
   Resend dashboard ([receiving intro](https://resend.com/docs/dashboard/receiving/introduction)).
2. On each inbound message Resend POSTs an **`email.received`** event to our
   webhook. **The payload is METADATA ONLY** — `type`, `created_at`,
   `data.email_id`, `data.from`, `data.to`, `data.subject`, and an attachment
   list. The body/headers/attachments are **fetched on demand**
   (`resend.emails.receiving.get(email_id)`; attachments via the Attachments
   API). This deliberately keeps large attachments out of the webhook body —
   ideal for Vercel's request-size limits.
3. **Verify the webhook** with the Svix headers `svix-id`, `svix-timestamp`,
   `svix-signature` via `resend.webhooks.verify()` over the **raw** request body
   (JSON-parsing first invalidates the signature). Add `RESEND_WEBHOOK_SECRET`.
   This mirrors our existing HMAC discipline for unsubscribe links
   (`src/lib/email-capture-store.ts`).

> **[VERIFY] before building (two items).**
> 1. Exact Node-SDK surface for inbound (`emails.receiving.get`,
>    `webhooks.verify`) against the pinned **`resend@^6.12.4`** — the feature is
>    newer than that minor; we may need to bump the SDK. Check
>    `node_modules/resend` types after `npm i`.
> 2. **EU data residency.** Resend offers region selection for sending; confirm
>    inbound storage/processing can be pinned to the **EU** region (mail content
>    is personal data under GDPR). If it cannot, prefer **Option B** (Cloudflare
>    EU) for inbound while keeping Resend for send. This is a **legal-blocking**
>    check, not a nice-to-have.

**Fallback (Option B)** stays cheap to adopt later: Cloudflare **Email Routing**
sends inbound to an **Email Worker** (`email()` handler) that `fetch()`es the
**same** internal webhook contract we build for Resend
([Cloudflare Email Workers API](https://developers.cloudflare.com/email-routing/email-workers/)).
If we design the ingest route around a small normalised "inbound message" shape
(from/to/subject/text/html/message-id/in-reply-to/references), the provider
behind it is swappable.

### Mapping a message to a customer + threading

- **Customer match:** normalise `data.from` (trim + lower-case, like
  `normalizeEmail` in `src/lib/email-capture-store.ts`) and look up
  `customers.email`. This reuses the exact bridge the per-customer draft already
  uses (`loadEligibleCaptureByEmail`). A reply from a **known** address attaches
  to that `customer_id`; a reply from an **unknown** address goes to an
  **"unmatched inbound" queue** (customer_id NULL) the admin can triage/assign.
- **Threading (best-effort, header-first):** key off RFC-5322 headers —
  `Message-ID` (store on every row), `In-Reply-To` and `References` (link a
  reply to the message it answers), falling back to a normalised `Subject`
  (strip `Re:`/`AW:`) when headers are absent. Compute a stable `thread_id`
  (the root message's `Message-ID`, or a hash) so the admin thread view and the
  KB both read one coherent conversation. **Set our own `Message-ID`/`Reply-To`
  on outbound** so we can correlate the replies we receive (§5).

---

## 2. STORAGE — a unified mail store both the KB and the admin client read

Add **one** table that is the union log of all mail, both directions, all
channels-that-are-email. It lives in **Cluster B** (it is identified by email /
linked to a customer) but is its own data category — **Korrespondenz**, distinct
from marketing-*consent* (§3 on lawful basis).

```sql
-- migrations/0020_email_messages.sql  (sketch — next free number is 0020)
CREATE TABLE IF NOT EXISTS email_messages (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- The person this mail belongs to. SET NULL on customer erasure so deleting a
  -- customer never orphan-cascades the audit row away unexpectedly — retention
  -- purges correspondence on its own schedule (see DATA_RETENTION). NULL also =
  -- the "unmatched inbound" queue (reply from an unknown address).
  customer_id         BIGINT REFERENCES customers (id) ON DELETE SET NULL,
  direction           TEXT NOT NULL CHECK (direction IN ('sent','received')),
  channel             TEXT NOT NULL DEFAULT 'email'
                        CHECK (channel IN ('email')),       -- physical = own table, §4
  -- RFC-5322 identity + threading.
  message_id          TEXT,            -- our/their Message-ID header (unique per msg)
  in_reply_to         TEXT,            -- In-Reply-To header
  references_ids      TEXT[] NOT NULL DEFAULT '{}',  -- References header chain
  thread_id           TEXT,            -- derived root id; groups the conversation
  -- Envelope + content.
  from_address        TEXT NOT NULL,
  to_address          TEXT NOT NULL,
  subject             TEXT,
  body_text           TEXT,
  body_html           TEXT,
  snippet             TEXT,            -- first ~200 chars, for list rendering
  -- Attachments: METADATA ONLY (filename, content_type, size, provider ref).
  -- Blobs are NOT stored here; fetch on demand from the provider, or, if we ever
  -- need durability, push to Vercel Blob (already a dependency) and store the URL.
  attachments         JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Provenance / refetch handles.
  provider            TEXT NOT NULL DEFAULT 'resend',
  provider_email_id   TEXT,            -- Resend data.email_id, to refetch body/attachments
  -- Link to the marketing workflow row when this 'sent' mail was a campaign send
  -- (see below). NULL for transactional/manual/inbound mail.
  marketing_send_id   BIGINT REFERENCES marketing_sends (id) ON DELETE SET NULL,
  occurred_at         TIMESTAMPTZ NOT NULL,  -- sent_at or received_at
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_messages_customer_idx ON email_messages (customer_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS email_messages_thread_idx   ON email_messages (thread_id);
CREATE UNIQUE INDEX IF NOT EXISTS email_messages_msgid_idx
  ON email_messages (message_id) WHERE message_id IS NOT NULL;  -- inbound dedup
```

### How `marketing_sends` relates — **LINK, don't migrate**

`marketing_sends` is a **workflow** table (draft → approved → sent, discount
minting, click-tracking, the one-open-draft index — `src/lib/marketing-store.ts`,
`migrations/0003`). It must stay exactly as-is; it is *not* a generic mail log
and shouldn't be reshaped into one. Instead:

- On a successful marketing send (`markSent`, `src/lib/marketing-email.ts:237`),
  **also INSERT a `direction='sent'` row** into `email_messages` with
  `marketing_send_id` set. The campaign engine keeps its lifecycle/analytics
  columns; the unified log gains the message so the thread view and the KB see
  marketing mail too.
- Do the same at the transactional send sites (`summary-email.ts`, DOI) — a
  thin write right after `sendEmail()` returns `ok`. **Mirror, don't move:** the
  log is append-only and additive; nothing existing changes behaviour.
- No backfill is required to ship; optionally seed historical sent marketing
  from `marketing_sends.status='sent'` rows (subject/`drafted_text`/`sent_at`)
  in the same migration.

---

## 3. KNOWLEDGE BASE — folding sent + received mail into the customer view

Both KB passes already accept "everything we know about one customer" as labelled
prompt blocks. Email correspondence becomes **one more block type**, built the
same way conversations are:

- **New loader** (e.g. `loadCustomerCorrespondence(customerId)`): the most recent
  N `email_messages` for the customer, both directions, oldest-first, each
  rendered readably — `Kunde schrieb (12.06.2026): …` / `motion sports schrieb:
  …` — exactly paralleling `readableTranscript`/`draftSessionBlock`
  (`src/lib/marketing-draft.ts:74`, `:308`). Bound it like the session blocks
  (`MAX_SESSIONS_IN_DRAFT_PROMPT`, per-block char clip) so a long thread can't
  blow the prompt.
- **`generateCustomerProfile`** (`customer-profile.ts`): add a
  `## Korrespondenz (E-Mail)` section beside `## Chat-Sessions` and
  `## Kaufhistorie`. The model's contradiction-resolution rule ("newer wins")
  already generalises across sources.
- **`generateCustomerMarketingDraft`** (`marketing-draft.ts`): add a
  `## Bisherige E-Mail-Korrespondenz` section so a new draft can reference an
  actual reply ("du hattest nach der Lieferzeit gefragt…"). It slots in next to
  `## Bisherige Gespräche` with the same "ground the draft in real signal" intent.

### Data-minimisation & lawful basis (where correspondence sits)

- **Received email is *correspondence content*, not marketing consent.** Handling
  a reply someone sent us rests on **contract / legitimate interest** (answering
  the customer), **independent** of `marketing_doi_status`. So correspondence
  must **not** be fused into the DOI cluster's eligibility logic, and likewise
  not into §7(3) Bestandskunden — same "never merge the bases" discipline as
  `migrations/0017`. `email_messages` is its own category; the consent gates
  (`canSendMarketing`, `loadEligibleCapture`) are untouched by it.
- **Minimisation tension to flag:** today the profile pass deliberately withholds
  the email *address* from the model (`customer-profile.ts:18`). Feeding
  correspondence *body* is richer and more sensitive than transcripts. Mitigations:
  (i) pass body **text only**, never raw headers/address lines; (ii) cap recency
  (e.g. last N messages / last 12 months); (iii) keep it behind the same
  explicit, admin-triggered regeneration (no automatic processing); (iv) honour
  erasure — `ON DELETE SET NULL` + a retention rule for `email_messages` (extend
  `docs/DATA_RETENTION.md` and `/api/cron/retention`).
- **Update the records of processing**: a new internal use ("customer
  correspondence used to build the advisory/marketing profile") — **legal
  follow-up**, same review gate as the Bestandskunden copy.

---

## 4. PHYSICAL MAIL — Pingen vs DHL/Deutsche Post

| Option | Onboarding | Auth | Submit-a-PDF flow | German coverage | Sandbox | Verdict |
|---|---|---|---|---|---|---|
| **Pingen** (pingen.com/.de, CH co.) | **Self-service** — create account + Developer App | **OAuth2 client_credentials** | one call: upload PDF + address attrs | Yes — auto via **Deutsche Post PREMIUMADRESS** | **Free staging**, mirrors prod | **RECOMMENDED** |
| **DHL / Deutsche Post** (E-POST Hybrid Mail, Print-Mailing) via `developer.dhl.com` | **Business contract / Frankierservice account** required; heavier | OAuth2 | REST, JSON, you handle PDF + mail formatting | Yes (native) | Limited / contract-gated | Alt — only if a direct DP contract already exists |

### Recommendation: **Pingen**

Lowest-friction, developer-first, and German letters are dispatched via Deutsche
Post automatically — so we get DP delivery without the DP business-contract
onboarding ([Pingen post-API](https://www.pingen.com/en/post-api/),
[help: integrate the API](https://help.pingen.com/en/api-and-integrations/integrate-and-use-pingen-api)).

**Concrete API shape** (from the official
[`pingencom/pingen2-sdk-php`](https://github.com/pingencom/pingen2-sdk-php) and
[Python SDK](https://pypi.org/project/pingen2sdk/), and `https://api.pingen.com/documentation`):

- **Hosts:** production **`api.pingen.com`**, staging **`api-staging.pingen.com`**;
  OAuth at **`identity.pingen.com`**. Auth = **client_credentials** grant
  (`clientId`/`clientSecret` → bearer token). Scoped by an **organisation UUID**.
- **Send a letter** is essentially one operation — `uploadAndCreate(...)`: upload
  the PDF and create the letter with attributes
  (`setFileOriginalName`, `setAddressPosition` (the address is read from the PDF
  at the given position), `setAutoSend(true/false)`, plus delivery product —
  economy/priority, colour, simplex/duplex). The underlying REST flow is
  *request a file-upload URL → PUT the PDF → POST the letter referencing it →
  optionally POST "send"*. Supports **`Idempotency-Key`** headers and
  configurable send limits.
- **Tracking:** per-letter status via API **and webhooks** for status changes —
  the same webhook-ingest pattern as §1.
- **Cost:** from **€0.86 / letter**, **no setup fee, no subscription** (pay per
  letter); **free staging** environment mirrors production for end-to-end tests
  ([post-API pricing](https://www.pingen.com/en/post-api/)).
- **SDKs:** PHP / Python / Go / .NET — **no JS/TS SDK**, so we call the REST API
  directly (fine; it's a thin OAuth + multipart flow). **[VERIFY]** exact
  endpoint paths + the address-DTO fields against `api.pingen.com/documentation`
  at build time (vendor site 403s automated fetch).

### Send flow (reuses the personalised-content pipeline)

```
personalised content (same source as marketing-draft.ts body)
  → render a letter PDF (HTML→PDF; address block placed where setAddressPosition expects it)
  → Pingen: OAuth token → uploadAndCreate(pdf, address attrs, autoSend)
  → store provider id + status in physical_letters (linked to customer + optional marketing_send_id)
  → Pingen webhook updates status (queued → printed → posted)
```

A small **`physical_letters`** table (parallel to `email_messages`, NOT folded
into it — a letter isn't email): `customer_id`, `marketing_send_id?`,
`provider='pingen'`, `provider_letter_id`, `status`, `recipient_*` address,
`cost_cents`, timestamps.

> **⚠ NEW DATA PROCESSOR + missing data.** Two flags for the records of
> processing:
> 1. **Pingen is a new processor** — recipient **postal address → Pingen (CH) →
>    Deutsche Post**. Needs an **AV-Vertrag (DPA)** and a third-country (CH)
>    transfer note. **Lucas/legal action.**
> 2. **We don't reliably have postal addresses.** Today only **tier-3 signed-in
>    Shopify** customers expose an address, and the profile pass minimises it to
>    **city/country only** (`customer-profile.ts:52-60`). Physical mail needs the
>    **full** address with a lawful basis to use it for outbound post — a
>    **product + legal follow-up** (consented capture, or restrict physical mail
>    to recipients whose address we already hold lawfully via a purchase).

---

## 5. IN-ADMIN CLIENT UX — lightweight, not a full mail app

Anchor it in the existing **Kunden** tab — the client is **per-customer**, never
a global inbox-with-folders. Inside the customer detail (next to
`CustomerProfileCard`), add a **"Korrespondenz"** panel:

- **Thread view:** chronological `email_messages` for that customer (sent +
  received interleaved), grouped by `thread_id`, using existing
  `src/app/admin/ui` primitives (card, badge for direction, `markdown.tsx` for
  body). Read = a cheap `email_messages` query, no provider round-trip; fetch a
  full body/attachment lazily via `provider_email_id` only when expanded.
- **Compose / reply:** a `textarea` + send button that calls the **existing
  `sendEmail()` choke-point** (`src/lib/email.ts`) — reply sets
  `In-Reply-To`/`References` from the message being answered and a `Reply-To` of
  our inbound address so the next reply threads back. **Reuse, don't fork:** the
  send path already centralises sender, logging and failure handling.
- **"Brief senden"** action → the Pingen flow (§4), shown as a `physical_letters`
  status chip in the same panel.
- **One global surface is unavoidable:** an **"Unmatched inbound"** queue (the
  `customer_id IS NULL` replies) so a reply from an unknown address isn't lost —
  a small list with "assign to customer". This is the *only* non-per-customer
  view, and it stays minimal.
- **Deliberately OUT of scope (keeps it lightweight):** full-text search,
  folders/labels, multi-mailbox, rich HTML composer, contact management. The
  thread view + compose/reply + the unmatched queue are enough to "send + read".

---

## RECOMMENDED architecture (summary)

```
                         ┌─────────────────────────────────────────────┐
  Inbound reply  ──MX──► │ Resend Inbound  → webhook 'email.received'   │
  (bot@<inbound dom>)    └───────────────┬─────────────────────────────┘
                                         ▼  (verify svix sig; fetch body by email_id)
  Outbound (Resend) ───────────────►  /api/inbound/resend  ──► map from→customers.email
   src/lib/email.ts  ──mirror write──►        │                 thread by Message-ID/References
                                              ▼
                                   ┌───────────────────────┐   reads
   marketing_sends (workflow) ──►  │   email_messages      │ ◄────────  Admin "Korrespondenz"
   (link, not migrate)            │  (unified mail log)    │            (per-customer thread,
                                   └───────────┬───────────┘             compose/reply, unmatched)
                                               ▼ readable blocks
                          generateCustomerProfile + generateCustomerMarketingDraft  (KB)

   Physical:  personalised content → PDF → Pingen (OAuth, uploadAndCreate) → physical_letters
              (webhook status)                                   ⚠ NEW processor (address→CH→DP)
```

**Why:** stays inside the stack we already run (Vercel + Neon + Resend), adds
**zero** new vendors for 7+8, treats the unified log as additive (nothing
existing changes behaviour), keeps the GDPR clusters and lawful bases separate,
and isolates the one genuinely new processor (Pingen) to the physical channel.

## Build sequence (receive → store → KB → admin UI → physical)

0. **Spike** — this doc.
1. **Receive + store** — Resend inbound webhook route (`/api/inbound/resend`,
   svix-verified), `email_messages` migration (0020), from→customer mapping,
   threading, the unmatched-inbound queue, and the **mirror-write** at the
   existing send sites (marketing + transactional).
2. **KB integration** — `loadCustomerCorrespondence` + a `## Korrespondenz`
   block in `generateCustomerProfile` and `generateCustomerMarketingDraft`;
   retention rule for `email_messages`.
3. **Admin client UI** — per-customer thread view + compose/reply on the existing
   `sendEmail()` path; the unmatched-inbound triage list.
4. **Physical mail** — Pingen REST client (OAuth + uploadAndCreate),
   `physical_letters` table, PDF render from the personalised content, status
   webhook; behind a feature flag (like `BESTANDSKUNDE_SENDS_APPROVED`) until
   legal signs off.

## Required follow-ups (before / during build)

**Ops / Lucas (infra & accounts):**
- **DNS / MX — choose a DEDICATED inbound (sub)domain.** Do **not** hijack MX on
  the corporate `motionsports.de` (real mailboxes likely live there) or on the
  `kontakt@` sender. Recommend a dedicated address, e.g.
  **`bot@chat.motionsports.de`** (or `reply.motionsports.de`), point its **MX at
  Resend**, verify the domain, and set it as **`Reply-To`** on outbound so
  replies route to inbound without disturbing existing mail.
- **Resend Inbound** enablement + webhook endpoint + signing secret
  (`RESEND_WEBHOOK_SECRET`); confirm **EU region/residency** (§1 [VERIFY] —
  legal-blocking).
- **Pingen** accounts (**staging + production**), Developer App → client id/secret
  + organisation UUID. New env: `PINGEN_CLIENT_ID`, `PINGEN_CLIENT_SECRET`,
  `PINGEN_ORGANISATION_ID`, `PINGEN_STAGING`, `PINGEN_WEBHOOK_SECRET`.

**Legal / lawyer:**
- **Records of processing / DPA updates:** (a) Resend as **inbound** processor
  (receiving correspondence) + EU-residency confirmation; (b) **Pingen as a new
  processor** with a **CH third-country transfer** (address → Pingen → Deutsche
  Post) — **AV-Vertrag** required.
- **Lawful basis + retention for received correspondence** — confirm
  contract/legitimate-interest handling, a retention period for `email_messages`,
  and that feeding correspondence *body* into the KB passes is documented and
  proportionate.
- **Postal-address acquisition** for physical mail (we only hold tier-3 addresses,
  minimised today) — consented capture, or restrict to addresses already held
  lawfully.

**Engineering [VERIFY] at build time:**
- Resend Node-SDK inbound method names vs pinned `resend@^6.12.4` (bump if needed).
- Pingen exact endpoint paths + address-DTO fields against
  `api.pingen.com/documentation` (vendor 403s automated fetch — confirm in a browser).

---

### Source index (open in a browser to re-confirm; vendor sites 403 automated fetch)

- Resend Inbound — receiving intro: `https://resend.com/docs/dashboard/receiving/introduction`
- Resend Inbound — announcement/blog: `https://resend.com/blog/inbound-emails` ·
  `https://alternativeto.net/news/2025/11/resend-adds-inbound-feature-for-webhooks-based-email-receiving-and-processing/`
- Resend webhook events + verification (fetchable): `https://github.com/resend/resend-skills/blob/main/skills/resend/references/webhooks.md`
- Cloudflare Email Workers (fallback inbound): `https://developers.cloudflare.com/email-routing/email-workers/`
- Pingen post-API + pricing: `https://www.pingen.com/en/post-api/` · help: `https://help.pingen.com/en/api-and-integrations/integrate-and-use-pingen-api`
- Pingen API reference: `https://api.pingen.com/documentation` · SDKs (fetchable): `https://github.com/pingencom/pingen2-sdk-php` · `https://pypi.org/project/pingen2sdk/`
- DHL / Deutsche Post (alt): `https://developer.dhl.com/api-reference/deutsche-post-hybrid-mail-shipments-e-post-post-parcel-germany` · `https://developer.dhl.com/post-and-dhl-germany`
</content>
</invoke>
