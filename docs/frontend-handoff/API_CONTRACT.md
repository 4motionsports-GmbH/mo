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
are unchanged and still reference it by section number.
