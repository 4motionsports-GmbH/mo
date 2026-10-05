# Next items after the 04.10.2026 widget upload — ranked plans

Item 8 of the 04.10. request: the next highest-impact items for opt-ins, sign-ins, product clicks,
add-to-cart and attributed revenue, from `docs/frontend/05` (gaps, KPI ideas) and `docs/frontend/07`
§7 (backlog). **Status: plans, nothing built.** Each plan was written against the code on `main` at
`b85ddbb` (04.10.), then checked by two verifiers (contract/code fidelity; legal, privacy and KPI
hygiene) and revised; each file ends with its „Verifier notes“. Where a plan and the code disagree
later, the code wins — re-read the cited functions before building.

## Ranking (3 judges, 1–10)

| # | Item | Score | Effort | Widget? | File |
|---|---|---|---|---|---|
| 1 | **P0.3** App Proxy: shop-logged-in visitors signed in with no click — safety first, then measurement | 8.7 | M–L | no (optional Appendix A, superseded by OI3) | [P0.3.md](./P0.3.md) |
| 2 | **OI1** Honest opt-in measurement through the DOI; no e-mail-summary ask for signed-in sessions | 7.7 | M (2 PRs) | no | [OI1.md](./OI1.md) |
| 3 | **ATTR-TOKEN-LIFETIME** Attribution window from the latest consultation; tokens kept while the device consults | 7.7 | M (+ migration) | companion task | [ATTR-TOKEN-LIFETIME.md](./ATTR-TOKEN-LIFETIME.md) |
| 4 | **OI3** Consent-popup benefits served by the backend; variant + placement on every signed-in ask | 7.0 | S + S | **yes** | [OI3.md](./OI3.md) |
| 5 | **A3** Page context on typed product-page messages, with a server-side holdout | 6.7 | M | **yes** | [A3.md](./A3.md) |

Not chosen this round (scores 4.3–6.7): C2/C3 card CTR, D1 in-chat add-to-cart, A2 `_mo` on the
permalink (needs the P0.2 test order first), B4–B6 click measurement, B2 sign-in entry points,
A1+D2 attribution hygiene, sign-in card at the order-status moment, D6 value-moment ask, A4 the
40-message wall.

## What the plans found that changes today's instructions

1. **Do not switch on the App Proxy yet** (P0.3 §0, verified in code on 04.10.). As the backend stands:
   - a shop-native login has no Customer-Account token, so `/api/auth/me` answers `signedIn:false`
     — the proxy does **not** sign those visitors in, but `storefront/route.ts` still mints a code
     and the redeem links the session and records „Vom Shop erkannt“ (false KPI, hidden link);
   - `customer-link-grant.mjs → redeemLinkGrant` re-stamps **every** conversation of the session to
     the redeeming customer with no ownership check — on a shared browser customer A's chats can
     move into customer B's history and export;
   - App Proxy signatures carry no freshness check (`evaluateAppProxyAuth`), so a signed URL can be
     replayed;
   - every tab session re-records `account_signin_linked {kind:'app_proxy'}` for an already
     signed-in customer.

   P0.3 Phase 1 (backend, behind a kill switch) fixes all four; only then the owner's App Proxy
   setup (ROLLOUT_TODO 5.4, on hold). Phase 2 (token-less shop proof, D-AP1) needs the lawyer (F-36).
2. **OI1 F1 — possible opt-in loss** (verified): `email-capture-store.ts → upsertEmailCapture`, a
   later capture submit **without** the marketing tick for an address whose DOI is still `pending`
   writes `marketing_doi_status='none'` and `doi_token=NULL`; the DOI link already in the inbox stops
   working. Small fix with a test (ROLLOUT_TODO C.16). Size check:
   `SELECT count(*) FROM customers c JOIN email_captures ec ON ec.email = c.email WHERE c.email_consent_state = 'pending' AND ec.marketing_doi_status = 'none';`
3. **OI1 F2 — false „already subscribed“**: a suppressed address whose capture row is still
   `confirmed` answers `alreadyConfirmed:true`. Check:
   `SELECT count(*) FROM email_captures ec JOIN suppression_list s ON s.email = ec.email WHERE ec.marketing_doi_status = 'confirmed';`
4. **The DOI click is its own event.** An opt-in event never turns into `confirmed`; the click
   writes `email_capture_marketing_confirmed`. `alreadyConfirmed` answers cannot be read from
   `doiStatus` (OI1 §1 row 10) — OI1 adds `outcome`.
5. **Consent popup bullets** are widget-authored (`GATE_COPY.benefits`) although consent text may
   only be served — OI3 task 1 (served `benefits`, empty until the lawyer signs them off) replaces
   P0.3 Appendix A.

## Decisions needed (M; L where marked)

| # | Question | Recommendation (plan) |
|---|---|---|
| D-AP1 (L: F-36, dossier §19) | Does a fresh `app_proxy` link count as signed in **without** a chat token (`/api/auth/me`, `/api/account/*` incl. the opt-in, chat memory)? | Yes, max age 24 h — after Phase 1 and the lawyer's answer (P0.3 §2). |
| D-AP3 | `/en` sign-in consent copy is not legally reviewed but served as approved | Serve `lawyerApproved:false` for `surface=signin&locale=en` until reviewed (P0.3 §2). |
| D-AP4 / OI3 (L) | The two consent-popup benefit bullets | Lawyer signs the wording off; the backend serves it (OI3). Until then the popup shows none. |
| OI3 B4 (L) | A second consent-copy variant for an A/B test | Only after the upload is verified and the variant is lawyer-approved. |
| ATTR (L: F-37, dossier §20) | Count the 30 days from the device's latest product consultation (`MO_ATTRIBUTION_SESSION_ANCHOR`) | Owner decision + lawyer note; switch ships off. Pre-checks P0–P6 first (ATTR §2). |
| A3 | Page context on typed PDP turns; 20 % holdout | Switch on after the upload's live check and 2–3 days of observation; pre-register the experiment. |

### Decided 05.10. (M)

- **D-AP1 yes** — a visitor logged in to the shop counts as signed in to the chat; the lawyer
  confirmed (F-36 answered). P0.3 Phase 2 is built together with Phase 1.
- **D-AP3** — the English sign-in consent text is a valid translation of the German one and is
  served as approved.
- **D-AP4 / OI3** — C chooses the benefit-bullet wording (attractive, honest, no urgency or
  discount amounts, served copy only).
- **ATTR** — C decides: the 30-day window counts from the device's latest product consultation
  (`MO_ATTRIBUTION_SESSION_ANCHOR=true` after the live checks).
- F1 and F2 size checks: both 0 (nobody affected; F1 fixed in #223, F2 stays a small follow-up).

## Order of work

1. **C (backend, no widget)**, revised 05.10. after the completeness check: EN consent approved
   (D-AP3, all three EN surfaces checked against the German text) → OI1 PR 1 (no summary ask when
   signed in) → P0.3 Phase 1 → P0.3 Phase 2 (incl. order-status wording for shop-recognised
   sessions, release entry for its deploy day) → OI1 PR 2 (F2 folded in) → OI3 B1 (bullets by C;
   reuse OI1's `outcome`) → A3 backend → ATTR (migration `0076`; earlier if P3 shows the purge
   cliff is close). `verify:live` sections: 7 = ATTR pre-checks (exists), then P0.3 = 8,
   A3 = 9, ATTR live checks = 10. OI3 B4's migration becomes `0077`, run before its deploy.
2. **FE:** the widget tasks in `docs/frontend-handoff/FRONTEND_TASKS_2026-10-04.md` once the backend
   counterparts are deployed (each task file says what must be live first).
3. **M + F:** App Proxy setup (ROLLOUT_TODO 5.4) after P0.3 Phase 1 is live; switches per the plans'
   rollout sections; lawyer questions F-36 / F-37 with dossier §19 / §20.
