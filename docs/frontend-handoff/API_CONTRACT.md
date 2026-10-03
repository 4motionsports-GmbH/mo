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
