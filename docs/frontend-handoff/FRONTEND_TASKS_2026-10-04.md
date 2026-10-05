# Frontend tasks after the 04.10.2026 upload — prompt for the frontend agent

**Do not send yet.** Each task needs its backend counterpart deployed first (column „Send when“).
C ticks the row in `docs/ROLLOUT_TODO.md` (C.17–C.21) when a task is ready to send. Plans and
rankings: `docs/plans/2026-10-04/README.md`.

| Task file | What | KPI | Send when |
|---|---|---|---|
| [`tasks-2026-10-04/1-consent-benefits-variant.md`](./tasks-2026-10-04/1-consent-benefits-variant.md) | Consent popup renders served `benefits` (no widget text); `variant` + `placement` on the signed-in ask; copy cache per sid; no dismiss after an accept | opt-ins: accept rate and DOI per variant; compliance | OI3 B1 deployed (C.19) |
| [`tasks-2026-10-04/2-page-context.md`](./tasks-2026-10-04/2-page-context.md) | First typed/spoken message on a PDP (and after a product change) carries the page's product (`context.source:"page"`); `source` on CTA/nudge context; `samePage` on `product_cta_clicked` | product clicks, add-to-cart (holdout-measured) | A3 backend deployed (C.20) |
| [`tasks-2026-10-04/3-attribution-token-renewal.md`](./tasks-2026-10-04/3-attribution-token-renewal.md) | Renew the `_mo` token after a live consultation; blank the cart marker when the session ends or consent is withdrawn | attributed revenue | ATTR backend deployed (C.21) |

P0.3 Appendix A (remove the bullets) is **not** needed: task 1 replaces it.

**Preferred: send all three together** once C.19–C.21 are live, so the owner uploads the widget
once (one MANIFEST entry, one fingerprint check). Each task is still complete on its own.

---

## Prompt (copy from here)

Paste into the frontend agent that owns `ms_shopify_clone`. Builds on `main` @ `3e87341` (live since
2026-10-04). Do the attached task files **in the order given**; each is complete in the 07 §4.3
template (baseline, goal and KPI, contract references, backend state, rules, tasks with exact
payloads, legal constraints, deployment, acceptance checklist). Attach the files each task names,
in the versions on the backend's `main`. Where a task and the attached contract files disagree, the
contract files win.

Rules that do not change, for every task:
- Contract changes stay additive; the widget keeps working against an older backend.
- Consent copy is served only by the backend, rendered verbatim with `textContent`, never
  pre-selected, decline as easy as accept, `consentTextShown` echoed byte for byte; popup and card
  render nothing without `lawyerApproved === true`.
- KPI events carry ids and enums only — never PII, message text, product names, URLs, tokens or codes.
- The widget never sends a server-only event (AC §5 server table); the backend drops them anyway.
- Unknown tools render nothing.
- No new request header (CORS allows exactly `Content-Type, x-ms-chat-key, x-ms-session, x-ms-locale`).
- ES5, one file, no build. Add a MANIFEST entry; list every file to upload and every shared file
  to hand-edit.

Reply with: the PR link, the MANIFEST entry, the files to upload, the acceptance checklist of each
task ticked with evidence (DE + EN screenshots at 1280 and 390 of every changed surface), and the
new fingerprint string the backend can check with `npm run verify:widget`.
