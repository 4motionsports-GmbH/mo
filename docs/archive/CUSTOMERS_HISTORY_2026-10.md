Archived 2026-10-05 from docs/CUSTOMERS.md — historical, not maintained

# Customers — history notes

Past-state passages taken out of [`docs/CUSTOMERS.md`](../CUSTOMERS.md) during the
2026-10-05 docs consolidation. Current state: `docs/CUSTOMERS.md` (entity, mirror, erasure,
design decisions), [`docs/CONSENT_FLOW.md`](../CONSENT_FLOW.md) „Lawyer sign-off status“ (open
and approved legal items) and [`docs/DATA_RETENTION.md`](../DATA_RETENTION.md) (windows, erasure
inventory). Nothing here describes the current system.

---

## 1. The GDPR sign-off box for profile building (as written after June 2026)

*Superseded by:* `docs/CUSTOMERS.md` „✅ GDPR: profile building — LAWYER-APPROVED“ (what the
code enforces) and `docs/CONSENT_FLOW.md` „Customer platform (2026-10)“ (open items).

> **Lawyer-approved (June 2026); `CONSENT_COPY_LAWYER_APPROVED = true`.**
> Personalisation is live. Building a **durable customer profile from past chat
> interactions and Shopify purchase history** was reviewed against the consent
> copy + privacy policy and signed off. Recorded here for the audit trail:
>
> - [x] The **privacy policy** explicitly covers "profile building from past
>       interactions and purchases" (purpose, lawful basis, storage duration,
>       right to object/erasure).
> - [x] The **marketing consent checkbox text**
>       (`MARKETING_CHECKBOX_LABEL` in `src/lib/consent-copy.ts`) covers
>       personalisation based on **past** conversations and **purchase history**,
>       not only the current chat.
> - [x] Linking the Shopify **order history** (a separate data source) into the
>       chat-derived profile is disclosed.
> - [x] Whether the regenerated profile constitutes **profiling** under
>       Art. 22 / requires a DPIA entry — assessed during the review.
> - [x] **Customer memory in the live chat** (section above): prior chat
>       interactions + purchase history shape the **live consultation** for a
>       re-identified returning customer. This personalisation purpose is within
>       the lawyer-approved consent scope / privacy policy.
> - [x] **Signed-in (tier-3) customers** (see
>       [`CUSTOMER_ACCOUNT.md`](../CUSTOMER_ACCOUNT.md) §8): for a signed-in
>       customer the **name, addresses and full order history** are pulled from
>       the Shopify **Customer Account API** and feed the profile + live chat via
>       this same mechanism. Re-identification is the authenticated session, but
>       the **personalisation consent requirement is unchanged**: history /
>       profile / address are gated on `canPersonaliseSignedIn`
>       (`CONSENT_COPY_LAWYER_APPROVED` **and** the one consent —
>       `marketing_status = 'confirmed'`, i.e. `email_consent_state =
>       'subscribed'`, given in Mo or in the shop),
>       so a non-consented signed-in user gets **only** the authenticated
>       greeting-by-name and no personalised data. This gate matches the
>       intended lawful basis.
>
> With the sign-off in place, the Kunden tab's profile generation AND the
> in-chat customer memory (tier 2 **and** tier 3) are live for real users
> (`CONSENT_COPY_LAWYER_APPROVED` in `src/lib/consent-copy.ts` is `true`). The
> runtime gate still fail-closes per user: no personalised chat data unless that
> user's one consent is `subscribed`. Cross-referenced in the lawyer checklist
> in [`CONSENT_FLOW.md`](../CONSENT_FLOW.md).
>
> **Open (2026-10, not yet recorded as reviewed):** AI profiles for customers
> **without** consent (`CUSTOMER_AI_PROFILE_SCOPE=all`, Art. 6(1)(f) with the
> right to object above), the mirror of all Shopify customers with their order
> ledger, and the bidirectional consent and erasure — listed in
> [`CONSENT_FLOW.md`](../CONSENT_FLOW.md) "Customer platform (2026-10)".

Corrections recorded on archiving (checked against the code at `bb8866a`):

- There is no constant `MARKETING_CHECKBOX_LABEL` in `src/`. The marketing label is the
  `marketingLabel` field of the copy sets in `src/lib/consent-copy-core.mjs` (served version `v5`,
  `src/lib/consent-copy-version.mjs`).
- "No personalised chat data unless that user's one consent is `subscribed`" holds for **tier 3**
  only (`canPersonaliseSignedIn`, `src/lib/customer-account-data.mjs`). Tier-2 memory
  (`resolveCustomerMemory`, `src/lib/customer-memory.ts`) is gated by the in-session capture check
  (`wasEmailCapturedFromSession`) alone; it does not check the marketing consent.

---

## 2. Welcome discount paragraph (as it stood before 2026-10-05)

*Superseded by:* `docs/CUSTOMERS.md` „Welcome discount (retired)“ and `docs/DISCOUNTS.md`
„Welcome codes“. See also `BACKEND_REFERENCE_HISTORY_2026-10.md` §2.

> The automatic welcome-discount feature was **retired pre-launch** (client
> decision: too exploitable via alias emails — codes are issued manually via the
> dashboard instead). The minting/issuance code and the `WELCOME_DISCOUNT_*` env
> flags are gone; the migration `0009_welcome_discount.sql` columns
> (`welcome_code`, `welcome_code_gid`, `welcome_code_expires_at`,
> `welcome_issued_at`) are **retained as READ-ONLY historical data** — never
> written again — and back the dashboard's historical view of codes that were
> issued while the feature was live.

Correction recorded on archiving: no admin view reads the `0009` columns; the only reader is the
chat memory (`welcome_issued_at`, `src/lib/customer-memory.ts`).

---

## 3. Erasure statements corrected on 2026-10-05

*Superseded by:* `docs/CUSTOMERS.md` „Retention / erasure“ and `docs/DATA_RETENTION.md`
„Complete erasure“ / step 9.

- *"one `data_erasure` outbox row: consent off, then `customerRequestDataErasure` — sent only while
  `SHOPIFY_ERASURE_SYNC=true`"* — the erasure queues **two** rows (`consent_update`, sent while
  `SHOPIFY_CONSENT_WRITEBACK`, and `data_erasure`, sent while `SHOPIFY_ERASURE_SYNC`;
  `enqueueShopifyErasure`, `src/lib/shopify-outbox.ts`).
- *"The erasure tombstones currently have no purge step."* — retention step 9 deletes tombstones
  `ERASURE_TOMBSTONE_RETENTION_DAYS` (default 30) after Shopify confirmed the redaction.
- *"Shopify's own deletion removes them via `customers/redact`"* and the presentation of
  `customers/redact` / `customers/data_request` as working paths — those compliance topics arrive
  only once the app configuration subscribes them (`docs/ROLLOUT_TODO.md` 5.2 / 5.4).

The retired newsletter-sync box that stood under „Kundenstamm“ is kept in
[`CAMPAIGNS_HISTORY_2026-10.md`](./CAMPAIGNS_HISTORY_2026-10.md) „The retired Shopify newsletter
sync“.
