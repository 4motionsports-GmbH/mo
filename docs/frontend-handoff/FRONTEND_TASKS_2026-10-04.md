# Frontend tasks after the 04.10.2026 upload — prompt for the frontend agent

**Ready to send (2026-10-05):** all three backend counterparts are deployed (C.19–C.21 in
`docs/ROLLOUT_TODO.md`). Send the three tasks together in one prompt, so the owner uploads the
widget once. Plans and rankings: `docs/plans/2026-10-04/README.md`.

| Task file | What | KPI | Send when |
|---|---|---|---|
| [`tasks-2026-10-04/1-consent-benefits-variant.md`](./tasks-2026-10-04/1-consent-benefits-variant.md) | Consent popup renders served `benefits` (no widget text); `variant` + `placement` on the signed-in ask; copy cache per sid; no dismiss after an accept | opt-ins: accept rate and DOI per variant; compliance | ✔ deployed 05.10. (C.19) |
| [`tasks-2026-10-04/2-page-context.md`](./tasks-2026-10-04/2-page-context.md) | First typed/spoken message on a PDP (and after a product change) carries the page's product (`context.source:"page"`); `source` on CTA/nudge context; `samePage` on `product_cta_clicked` | product clicks, add-to-cart (holdout-measured) | ✔ deployed 05.10. (C.20) |
| [`tasks-2026-10-04/3-attribution-token-renewal.md`](./tasks-2026-10-04/3-attribution-token-renewal.md) | Renew the `_mo` token after a live consultation; blank the cart marker when the session ends or consent is withdrawn | attributed revenue | ✔ deployed 05.10. (C.21) |

P0.3 Appendix A (remove the bullets) is **not** needed: task 1 replaces it.

**Send all three together**, so the owner uploads the widget once (one MANIFEST entry, one
fingerprint check). Each task is still complete on its own. The backend already recognises the
combined build (`src/lib/widget-fingerprint.mjs`, row `tasks-2026-10-05`: `ms-chat-ctx-last` and
`ms-chat-optin-benefits` present, `Rabattaktionen zuerst erfahren` absent).

**Files to attach** (current `main` of the backend repo): the three task files, `docs/API_CONTRACT.md`,
`docs/frontend-handoff/API_CONTRACT.md`, `docs/frontend-handoff/CONSENT_FLOW.md`,
`docs/frontend-handoff/CUSTOMER_ACCOUNT.md`, `docs/frontend-handoff/FRONTEND_PROMPT_2026-10.md`,
`docs/frontend-handoff/LOCALE.md`, `docs/frontend-handoff/WIDGET_SPEC.md`, `docs/ORDER_ATTRIBUTION.md`.

---

## Prompt (copy from here)

You own the motion sports chat widget in `ms_shopify_clone`. Build on `main` @ `3e87341` (live since
2026-10-04). Do the three attached task files **in this order**: 1-consent-benefits-variant,
2-page-context, 3-attribution-token-renewal — in one PR, so the owner uploads the widget once.
Each task is complete in itself (baseline, goal and KPI, contract references, backend state, rules,
tasks with exact payloads, legal constraints, deployment, acceptance checklist). The backend for all
three is live since 2026-10-05; test against it as well as against mocks. Where a task and the
attached contract files disagree, the contract files win.

Fingerprint the backend checks after the upload (keep these exact string literals in the shipped
`assets/ms-chat-widget.js`): `ms-chat-optin-benefits` (task 1, class name), `ms-chat-ctx-last`
(task 2, storage key), and no `Rabattaktionen zuerst erfahren` (the old widget bullet, task 1).

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
