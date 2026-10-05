# Frontend tasks of 2026-10-05 — cover note and prompt for the frontend agent

**Cover note for the operator (not part of the prompt).** Three widget tasks go to the frontend agent
in one prompt, so the owner uploads the widget once (one PR, one MANIFEST entry, one fingerprint
check). Their backend counterparts were deployed on 2026-10-05 (`docs/ROLLOUT_TODO.md` C.19–C.21).
Production status and the steps after the upload (open list item 2, then C.22, which also moves this
folder to `docs/archive/`) are tracked only in `docs/ROLLOUT_TODO.md`. The plans behind the tasks are
history only (`docs/archive/plans-2026-10-04/`); the as-built facts are in the contract files and in
`docs/frontend/01`–`07`.

| Task (in [`TASKS.md`](./TASKS.md)) | What changes in the widget | KPI | Backend |
|---|---|---|---|
| [Task 1](./TASKS.md#task-1--serve-the-consent-popup-benefits-from-the-backend-and-add-variantplacement-to-the-signed-in-ask-backend-deployed-2026-10-05) | Consent popup and inline card render the served `benefits` (no widget bullets; replaces Appendix A of the archived P0.3 plan); `variant` + `placement` on the signed-in ask; copy cache per sid; no dismiss after an accept | opt-ins: accept rate and DOI per variant; compliance | C.19 |
| [Task 2](./TASKS.md#task-2--page-context-on-typed-product-page-messages-backend-deployed-2026-10-05) | First typed/spoken message on a PDP (and after a product change) carries the page's product (`context.source: "page"`); `source` on CTA/nudge context; `samePage` on `product_cta_clicked` | product clicks, add-to-cart (holdout-measured) | C.20 |
| [Task 3](./TASKS.md#task-3--renew-the-attribution-token-after-a-live-consultation-blank-the-cart-marker-when-the-session-ends-backend-deployed-2026-10-05) | Renew the `_mo` token after a live consultation; blank the cart marker when the session ends or analytics consent is withdrawn | attributed revenue | C.21 |

**Attachments — exactly these four files** (current `main` of the backend repo), nothing else:

1. `docs/frontend/API_CONTRACT.md`
2. `docs/frontend/ACCOUNT_CONTRACT.md`
3. `docs/frontend/CONSENT_CONTRACT.md`
4. `docs/frontend/tasks/TASKS.md` (the three tasks)

Every other reference in the tasks (`docs/frontend/01`–`07`, backend docs, backend source files) is
marked as background, and what the agent needs from it is written out in the task.

**Fingerprint.** The prompt lists the markers; the rule that classifies the upload as row
`tasks-2026-10-05` is `src/lib/widget-fingerprint.mjs` (`npm run verify:widget`; a half-applied
build is reported as unknown). Task 3 has no marker: its effect shows in its live check (a test token
deleted by hand is replaced) and, over time, in the `unknown_token` count of `npm run verify:live`
section 7b (V3).

---

## Prompt (copy from here)

You own the motion sports chat widget in `ms_shopify_clone`. Build on `main` @ `3e87341` (live since
2026-10-04).

**Attached** (from the backend repo, `docs/frontend/`): the widget contract — `API_CONTRACT.md`,
`ACCOUNT_CONTRACT.md`, `CONSENT_CONTRACT.md` — and `TASKS.md` with the three tasks. Nothing else is
needed: a reference a task marks as "background" points into the backend repo, is not attached, and
what it holds is written out in the task.

**Do** the three tasks in `TASKS.md` **in this order** — Task 1 (consent-popup benefits and variant),
Task 2 (page context), Task 3 (attribution token renewal) — in **one PR**, so the owner uploads the widget once. Each task is complete
in itself: baseline, goal and KPI, contract references, backend state, rules, steps with exact payloads,
legal constraints, deployment, acceptance checklist. The backend for all three has been live since
2026-10-05; test against it as well as against mocks (including an older-backend mock).

**Precedence.** Where a task and the contract files disagree, the contract files win; name the
disagreement in the PR.

**Rules.** API_CONTRACT §0 applies to every task. The ones these tasks touch most:
- Consent copy comes only from the backend and is rendered verbatim with `textContent`, never
  pre-selected, decline as easy as accept, `consentTextShown` echoed byte for byte; the popup and the
  card render nothing without `lawyerApproved === true` (§0 rules 8–11).
- KPI events carry ids, enums and booleans only — never PII, message text, product names, URLs, tokens
  or codes (rule 13).
- Never send a server-only event (rule 14; the names are listed in API_CONTRACT §5); the backend drops
  them anyway.
- No new request header: the CORS allow-list is exactly `Content-Type, x-ms-chat-key, x-ms-session,
  x-ms-locale` (rule 4).
- ES5, one file, no build; contract changes stay additive, so the widget keeps working against an older
  backend; one MANIFEST entry listing every file to upload and every shared file to hand-edit
  (rules 1–3).

**Fingerprint.** After the upload the backend recognises the build only by string literals in the
served `assets/ms-chat-widget.js` (counted whitespace-insensitively; Shopify may minify the file, so
write each marker as one complete string literal):
- add: `ms-chat-optin-benefits` (task 1, class name) and `ms-chat-ctx-last` (task 2, storage key);
- remove: `Rabattaktionen zuerst erfahren` (the old widget bullet, task 1) — 0 occurrences;
- keep, unchanged: `/api/chat`, `/api/auth/link`, `ms_mo_c`, `order_support`, `Bestellnummer + kurz`.
  If one of them disappears or is reworded, the build is reported as unknown.

Task 3 adds no marker.

**Reply with:**
1. the PR link and the merged commit hash;
2. the MANIFEST entry;
3. the files to upload and the shared theme files to hand-edit (expected: `assets/ms-chat-widget.js` and
   `assets/ms-chat-widget.css`; no shared files);
4. each task's acceptance checklist, ticked, with evidence — DE and EN screenshots at 1280 and 390 px of
   every changed surface (task 3 changes none; say so);
5. the exact DE and EN strings of the removed `GATE_COPY.benefits` (task 1);
6. the marker counts in the committed `assets/ms-chat-widget.js`: `ms-chat-optin-benefits` and
   `ms-chat-ctx-last` (≥ 1 each); `Rabattaktionen zuerst erfahren`,
   `Empfehlungen, passend zu deiner Beratung` and each former EN bullet (0 each); `/api/chat`,
   `/api/auth/link`, `ms_mo_c`, `order_support`, `Bestellnummer + kurz` (≥ 1 each).
