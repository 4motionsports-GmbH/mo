# API contract — see `docs/API_CONTRACT.md`

The widget contract has **one** source of truth:
[`../API_CONTRACT.md`](../API_CONTRACT.md).

This file used to be a synced copy for frontend sessions. The copy had drifted
behind the canonical document by roughly a hundred lines, so it was replaced by
this pointer (2026-09). Everything the widget needs — endpoints, headers,
streamed parts, telemetry event names, consent and account flows — is in the
canonical file; the other documents in this folder
([`WIDGET_SPEC.md`](./WIDGET_SPEC.md), [`BEHAVIOR_REFERENCE.md`](./BEHAVIOR_REFERENCE.md),
[`CONSENT_FLOW.md`](./CONSENT_FLOW.md), [`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md),
[`LOCALE.md`](./LOCALE.md), [`CONTACT_FORM_ORDER_SUPPORT.md`](./CONTACT_FORM_ORDER_SUPPORT.md),
[`CHAT_ORDER_STATUS.md`](./CHAT_ORDER_STATUS.md))
reference it by section number.

## Additive changes (2026-10, the one consent with Shopify)

No existing field changed; a widget that ignores these keeps working.

| What | Where |
| --- | --- |
| `GET /api/consent-copy?surface=chat` carries a `signIn` object (the chat gate leads with "Mit Kundenkonto anmelden"; UI chrome, never part of `consentTextShown`). | `API_CONTRACT.md` §7.4, [`CONSENT_FLOW.md`](./CONSENT_FLOW.md) §2 |
| New `GET /api/consent-copy?surface=erase` — the copy for the "Meine Daten löschen" confirmation. | `API_CONTRACT.md` §7.4, [`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §7.5 |
| An address that already holds the marketing consent (Shopify or an earlier DOI) gets no DOI mail: the three opt-in endpoints answer `status: "confirmed"`, `alreadyConfirmed: true`, `doiEmailSent: false`. | `API_CONTRACT.md` §7, [`CONSENT_FLOW.md`](./CONSENT_FLOW.md) |
| `/api/auth/me` → `marketing.status` reflects the one consent: `"confirmed"` also for a Shopify newsletter subscriber, so the at-sign-in card is not offered again. | [`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §4 |
| `POST /api/account/erase` also reaches Shopify (response unchanged). | `API_CONTRACT.md` §11.1 |
| `POST /api/chat` accepts an optional `campaignToken` (string): the `mo_c` query value of the landing URL a campaign mail's Mo button leads to. Read it before the theme strips the `mo*` parameters and send it with the first turn of the session that link opened. The server validates `/^[A-Za-z0-9_-]{16,64}$/`, ignores anything else and never answers with an error; it counts „Chat gestartet“ once per campaign send, session-less. **Widget task:** not built yet — until it ships the KPI stays at 0. | `API_CONTRACT.md` §2 („Optional `campaignToken`“), §11.2 |
| The „already subscribed“ answer (`confirmed`, `alreadyConfirmed: true`) is given only for an address that is not on the suppression list; a `pending` opt-in whose DOI link was never clicked falls back to „no consent“ in the first nightly run one day after the link expired, so the opt-in card may be offered again (`optInActionable: true`). | `API_CONTRACT.md` §7, [`CONSENT_FLOW.md`](./CONSENT_FLOW.md) |
| New background tool `get_order_status` in the `/api/chat` stream (behind `CHAT_ORDER_STATUS_ENABLED`, default off): the signed-in customer's order status for Mo's text answer. **Render nothing** for it (and, generally, for any tool name the widget does not know); clear the stored chat history on logout. | `API_CONTRACT.md` §2 („Tools the widget MUST NOT render“), [`CHAT_ORDER_STATUS.md`](./CHAT_ORDER_STATUS.md) |
| **Widget of 2026-10-01** — the backend accepts its KPI events as sent (no allowlist, `data` stored as is): `login_gate_*`, `account_signin_started { source: "login_gate" }`, `account_signin_return`, `consent_gate_* { surface: "signin" }`. The KPI tab joins them **by session** to the server's `account_signin_succeeded` and `account_signin_linked`, so the KPI `sessionId`, `x-ms-session` and the login's `session` must be the same id. | `API_CONTRACT.md` §5 |
| New **server** events `account_signin_linked { kind }` and `account_signin_link_refused { reason }` (written by `POST /api/auth/link`) — the widget never sends them. `starter_*` retired. | `API_CONTRACT.md` §5 |
| `GET /api/consent-copy?surface=chat` and `POST /api/chat-marketing-opt-in` are no longer used by the widget (the sign-in popup replaced the anonymous e-mail gate). They stay served; don't build on them. | [`CONSENT_FLOW.md`](./CONSENT_FLOW.md) §2 |
| **Shop-login recognition (App Proxy, 2026-10-05):** whoami answers `signedIn: true` only together with a `linkCode` and only when the session will really count as signed in; everything else is `{ signedIn: false }` (shape unchanged). New **server** event `account_shop_recognised { proof, hasToken, alreadySignedIn, codeIssued, noCode? }`; `account_signin_linked` gains `renewed`, `account_signin_link_refused` an optional `kind`. The widget never sends any of them. | `API_CONTRACT.md` §5, [`CUSTOMER_ACCOUNT.md`](./CUSTOMER_ACCOUNT.md) §3a |
