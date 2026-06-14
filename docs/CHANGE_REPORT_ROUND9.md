# Round 9 — Pre-launch cleanup & hardening — CHANGE REPORT (rollback map)

**Scope:** behavior-preserving cleanup. The ONLY intended behavior change is the
full removal of the (already-disabled) WELCOME_DISCOUNT feature. Everything else
is dead-code removal, naming reconciliation, and doc/drift fixes that leave
observable behavior byte-for-byte identical.

**Validation (whole branch):** `tsc --noEmit` clean · `npm test` 139 pass / 0 fail
· `eslint` 0 errors (2 pre-existing warnings in `scripts/convert-catalog.mjs`,
untouched) · `npm run build` clean. No existing test was edited (the only test
count delta is −4, the deleted WELCOME_DISCOUNT flag test file).

Commits (newest first): `c1cc35e` dead code · `5b6867b` MOIA note · `b03098e`
WELCOME_DISCOUNT removal.

---

## REMOVED — WELCOME_DISCOUNT feature (commit `b03098e`)

Behavior note: the feature was already feature-flagged OFF in production
(`WELCOME_DISCOUNT_ENABLED` unset/false), so no live code path changes. The
flag-OFF behavior is preserved exactly.

| # | What | File(s) | Why | Revert |
|---|------|---------|-----|--------|
| R1 | Issuance module deleted | `src/lib/welcome-discount.ts` | Whole feature retired; never ran with flag off | `git show b03098e^:src/lib/welcome-discount.ts` |
| R2 | Flag + its test deleted | `src/lib/welcome-discount-flag.mjs`, `src/lib/welcome-discount-flag.test.mjs` | The `WELCOME_DISCOUNT_ENABLED` flag is gone | restore both files from `b03098e^` |
| R3 | Once-ever claim helpers removed | `src/lib/customer-store.ts` (`claimWelcomeIssuance`, `revertWelcomeIssuance`, `recordWelcomeCode`) | Only callers were R1 | restore the block (was right before `saveCustomerAdminInstructions`) |
| R4 | DOI gift email + body removed | `src/lib/consent-copy.ts` (`WELCOME_EMAIL_SUBJECT`, `WelcomeEmailOptions`, `welcomeEmailBody`, `DOI_CONFIRMED_WELCOME_BODY`) | Only consumer was R1 | restore from `b03098e^` |
| R5 | confirm-marketing gift block removed | `src/app/api/confirm-marketing/route.ts` | Always renders plain `DOI_CONFIRMED_BODY` now (== flag-off behavior) | restore the `issueWelcomeCodeOnDoiConfirmation`/`welcomeDelivered` block |
| R6 | system-prompt flag branch collapsed | `src/lib/system-prompt.ts` (`renderWelcomeMemoryRule`, removed `isWelcomeDiscountEnabled` import) | Output is byte-identical to the prior flag-OFF text; Mo still never promises a welcome gift | re-add the `if (!isWelcomeDiscountEnabled())` wrapper + flag-ON branch |
| R7 | dashboard `(deaktiviert)` handling removed | `src/app/admin/page.tsx`, `src/app/admin/CustomerProfileCard.tsx` | The `welcomeDiscountEnabled` prop + badge are obsolete with the flag gone; section is now plain read-only historical | re-add the prop + badge from `b03098e^` |
| R8 | env vars removed | `.env.example` (`WELCOME_DISCOUNT_ENABLED`, `WELCOME_DISCOUNT_PERCENT`, `WELCOME_DISCOUNT_EXPIRY_DAYS`) | Feature gone | restore the block after `UNSUBSCRIBE_SECRET=` |
| R9 | feature doc deleted | `docs/WELCOME_DISCOUNT.md` | Feature gone | `git show b03098e^:docs/WELCOME_DISCOUNT.md` |

**Ops note:** remove `WELCOME_DISCOUNT_ENABLED`, `WELCOME_DISCOUNT_PERCENT`,
`WELCOME_DISCOUNT_EXPIRY_DAYS` from any deployment env (Vercel etc.). No secret
rotation needed.

### RETAINED on purpose (still WELCOME_DISCOUNT-related)

These are behavior-preserving keeps — removing them would change behavior or
destroy data. Per the protected list + "when in doubt, keep."

- **`customers` migration-0009 columns** (`welcome_code`, `welcome_code_gid`,
  `welcome_code_expires_at`, `welcome_issued_at`) — now **read-only historical**.
  Hold real data about codes issued while the feature was live; back the
  dashboard's historical view. Dropping them is destructive → not done.
- **Dashboard "Willkommensrabatt" historical section** (`CustomerProfileCard.tsx`)
  — still shows historical issued/redeemed data (`welcomeRedeemed` via the live
  `wasDiscountCodeRedeemed` Shopify check). This matches the approved flag-OFF
  behavior ("historical data stays visible").
- **`customer-memory.welcomeAlreadyIssued` + the prompt rule** — Mo's
  "never promise a welcome gift" instruction is LIVE shipped behavior; its output
  is unchanged (R6). Removing it could let Mo promise a non-existent discount.

---

## REMOVED — genuine dead code (commit `c1cc35e`)

Each verified unreferenced across `src/`, `scripts/`, and contract docs.

| # | Symbol / file | File | Why dead | Revert |
|---|---------------|------|----------|--------|
| D1 | `getSystemPrompt()` | `src/lib/system-prompt.ts` | Self-labeled "backwards-compat export"; zero callers | restore fn from `c1cc35e^` |
| D2 | `getCustomerByShopifyId()` | `src/lib/customer-store.ts` | No caller (tier-3 uses `resolveSignedInCustomer`/`bindShopifyIdentity`) | restore fn |
| D3 | `isTokenCryptoConfigured()` | `src/lib/token-crypto.ts` | Non-throwing config check, never called; encryption logic untouched | restore fn |
| D4 | `base64url` re-export (+ now-unused import) | `src/lib/shopify-customer-account.ts` | Re-export nothing imported; helper still lives in `customer-account-oauth.mjs` | restore the `export { base64url }` + import |
| D5 | `dropdown-menu.tsx` (whole file + barrel exports) | `src/app/admin/ui/` | Never imported anywhere | restore file + `index.ts` exports |
| D6 | `tooltip.tsx` (whole file + barrel exports) | `src/app/admin/ui/` | Never imported (the `Tooltip` in `KpiCharts` is recharts') | restore file + `index.ts` exports |
| D7 | 5 starter SVGs | `public/{file,globe,next,vercel,window}.svg` | Next.js/Vercel scaffolding, 0 references | `git checkout c1cc35e^ -- public/<name>.svg` |

---

## RENAMED / naming drift (commit `5b6867b`)

| # | What | File | Why | Revert |
|---|------|------|-----|--------|
| N1 | Trimmed stale `MOIA → MO` rename narration in a comment | `src/lib/shopify-discounts.ts` | Canonical is `MO-XXXX`; rename history lives in git. Comment-only, no code change | restore the comment lines |

No other `MOIA`/non-canonical assistant-name references exist (verified). `Mo`,
`MO-XXXX` (draft placeholder), and `MS5-` (minted marketing code) are consistent.

---

## DOC-FIXED (reconciled to the cleaned code)

All in commit `b03098e` unless noted. These remove references to the deleted
feature/flag/doc.

- `docs/CUSTOMERS.md` — welcome section rewritten to "feature retired; columns
  read-only historical."
- `docs/DISCOUNTS.md` — welcome-codes section → "feature retired."
- `docs/CONSENT_FLOW.md` — welcome-discount lawyer checklist item → "N/A, retired."
- `docs/ADMIN_DASHBOARD.md` — welcome-code paragraph → read-only historical view.
- `docs/AUDIT_BACKEND.md` — welcome-discount audit bullet → "feature retired."
- `docs/API_CONTRACT.md` and `docs/frontend-handoff/API_CONTRACT.md` — removed the
  `WELCOME_DISCOUNT_ENABLED` env-table row.
- `src/lib/consent-copy.ts` — two copy-ceiling comments de-referenced the welcome
  gift (kept the "no reward for ticking / freely-given Art. 7(4)" guidance).
- `src/lib/{admin-overview,bestandskunden}.mjs`, `src/app/api/admin/customers/marketing-draft/route.ts`
  — comments that referenced the deleted flag/file updated.

No `docs/backend-handoff/` directory exists, and no theme-facing API contract
changed (the only contract-doc edit is removing the dead env-var row), so
`frontend-handoff/` is in sync.

---

## RETAINED — deliberately NOT removed (low-risk-but-not-worth-it / protected)

A repo-wide dead-export audit surfaced ~70 further candidates. The overwhelming
majority are **"internal-only type exports"** (interfaces/types used only as the
param/return signature of a LIVE exported function, consumed by inference) and
**"export-keyword-unused" internal helpers/constants**. These were RETAINED:

- They are the modules' type vocabulary / internal helpers — not harmful dead
  code. Un-exporting ~70 symbols is high churn, near-zero behavioral value, and
  risks breaking inference-based consumers and contract docs.
- Many sit in **protected** areas or are unused **only because their feature is
  gated off pending sign-off** — removing them would break pending-activation or
  protected flows. Examples:
  - `src/lib/bestandskunden-store.ts` (`canSendBestandskundenMail`,
    `setBestandskundeEligibility`, `buildBestandskundeOptOutToken`,
    `isBestandskundeSuppressed`) — §7(3) flow, gated by `BESTANDSKUNDE_SENDS_APPROVED=false`.
  - `src/lib/consent-copy.ts` `bestandskundenOptOutNotice` — the protected §7(3)
    opt-out notice (pending activation).
  - `src/lib/consent-copy.ts` consent-copy constants (`MARKETING_CHECKBOX_LABEL`,
    `TRANSACTIONAL_CHECKBOX_LABEL`, `CONSENT_SHARED_FOOTER`, …) — the protected
    v3 consent copy.
  - `src/lib/shopify-bundles.ts` `assertPublicationScopes` — explicitly named in
    the protected bundle list.
  - `src/lib/security.ts` (`isSecretValid`, `GuardResult`), PKCE internals in
    `shopify-customer-account.ts` — protected security/auth.
- Test-coupled "dead" symbols (e.g. `eurCostForUsage`, `DEFAULT_MODEL_PRICES`,
  `MAX_TITLE_LENGTH`, `isValidDiscountPercent`) were retained because removing
  them would require editing a test — a stop-and-report signal per the brief.
- **`public/ms-logo.svg`** — brand asset, currently unreferenced in-repo but may
  be served by URL; kept (low downside to keep, real downside to delete a logo).
- 3 manual ops/dev scripts (`scripts/{list-test-discounts,preview-summary-email,probe-bundle}.mjs`)
  — not wired into npm scripts but are intentional manual tooling.

Recommended future micro-cleanup (separate PR, low priority): un-export the
internal-only types/helpers above. Not done here to keep this PR behavior-safe
and reviewable.

---

## FLAGGED-FOR-HUMAN (production-readiness — report only, NOT changed)

1. **⚠️ `CONSENT_COPY_LAWYER_APPROVED` doc/comment drift (legal).**
   `src/lib/consent-copy.ts:41` has `CONSENT_COPY_LAWYER_APPROVED = true`
   (deliberately enabled in commit `107dcdc` "Enable personalisation"). But its
   own comment (lines 36–39: "not-yet-legally-approved … DO NOT set to false
   until Legal approves") is self-contradictory, and several docs still describe
   it as **false**: `docs/CUSTOMER_ACCOUNT.md` ("It is currently `false`, so no
   personalised data leaks"), `docs/CUSTOMERS.md`, `docs/CONSENT_FLOW.md`,
   `docs/API_CONTRACT.md` + `docs/frontend-handoff/API_CONTRACT.md`
   (`lawyerApproved: false` example). Left **unchanged** because (a) the brief
   says CONSENT_COPY_LAWYER_APPROVED is a report-only item and (b) reconciling it
   asserts a legal state. **Action:** confirm `true` is the intended production
   value and the v3 copy is signed off, then update the comment + docs to match.

2. **`BESTANDSKUNDE_SENDS_APPROVED=false`** — correct per brief (§7(3) gate stays
   OFF pending its own sign-off). No action; confirm at launch.

3. **`BUNDLE_CREATION_MODE=native_fixed_bundle`** — a real production mode (not a
   dev/test value). OK.

4. **Secrets to rotate at handoff** (not rotated here — `.env.example` only):
   `CHAT_SHARED_SECRET`, `UNSUBSCRIBE_SECRET`, `TOKEN_ENC_KEY`, `ADMIN_PASSWORD`,
   `CRON_SECRET`, and all Shopify/Resend/Upstash/Sentry/Anthropic/OpenAI API
   keys should be fresh production values.

5. Pre-existing eslint warnings in `scripts/convert-catalog.mjs` (`tdRe`, `get`
   unused) — untouched; trivial to clean in a follow-up.

---

## SKIPPED (protected — would change observable behavior)

- Dropping the migration-0009 welcome columns / removing the historical dashboard
  display — would destroy data + change approved behavior. **Skipped (protected).**
- Editing `migrations/0009_welcome_discount.sql` (a comment links the deleted
  `WELCOME_DISCOUNT.md`) — applied migrations are immutable historical records;
  left as-is. **Skipped.**
- Touching any consent v3 copy, §7(3) flow, PKCE/auth, security guards, bundle
  seam, SSE/stream, or the dashboard guarantees. **Skipped (protected).**
