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
[`LOCALE.md`](./LOCALE.md), [`CONTACT_FORM_ORDER_SUPPORT.md`](./CONTACT_FORM_ORDER_SUPPORT.md))
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
