# Customer Account sign-in — history notes

Archived 2026-10-05 from docs/CUSTOMER_ACCOUNT.md — historical, not maintained.

Current state: [`docs/CUSTOMER_ACCOUNT.md`](../CUSTOMER_ACCOUNT.md) (backend internals) and the
widget contract [`docs/frontend/ACCOUNT_CONTRACT.md`](../frontend/ACCOUNT_CONTRACT.md) (shapes and
widget behaviour). Operator steps and live status: [`docs/ROLLOUT_TODO.md`](../ROLLOUT_TODO.md).
The passages below are kept as they stood before the 2026-10-05 docs restructure; several of them
were already stale then (marked „superseded“).

## Status header (CA-1 … CA-4)

> **Status:** CA-1 shipped — auth + identity model + token handling. **CA-2/CA-3
> shipped** — the signed-in customer's Customer Account data (name, addresses,
> full order history) is now pulled and fed into the internal profile **and** the
> live chat via the existing customer-memory mechanism, under the same consent
> gate and data-minimisation (see §8).
> **Signed-in conversation history** (list / fetch / rename / delete + full
> "delete my data") is documented in §9.
> **CA-4** (at-sign-in marketing opt-in) is in §10,
> which also pins the **tier-3 suppression contract** (the end-of-chat capture
> widget is suppressed for signed-in customers — since 2026-10-05 the backend
> withholds the offer for them too; the opt-in moves to sign-in) and
> the `marketing.optInActionable` state. The signed-in **conversation summary
> download** (the S5 summary email reused as a downloadable HTML document) is in
> §11.
> The authoritative feasibility report is
> `archive/CUSTOMER_ACCOUNT_SPIKE.md`; this document
> describes what was built.

## §2 — the session-binding flaw fixed by migration 0073 (03.10.2026)

**Why the extra step (migration `0073`, 03.10.2026).** The login's `session` is a
URL parameter, and so is whoami's (`/apps/chat/whoami?session=`). Until 0073 the
callback and the App Proxy linked that id as signed in: a stranger could send a
shopper who is logged in to the shop a link carrying the **stranger's** session id
— the silent sign-in (`prompt=none`) or the whoami call then bound the shopper's
account to the stranger's session, and with it `/api/account/*` (history, export,
erasure) and the signed-in chat context. Now both only mint a grant (…). Links
written by the old flow were set to `legacy` by 0073 (those customers sign in once more).

## §2 — why the App Proxy was added

The original CA-3 detection (`/api/auth/me` + a deferred `prompt=none`) therefore
only ever recognised the **chatbot-OAuth** path.

`prompt=none` „is authoritative but a full-page redirect (the theme deferred it, see
`archive/CUSTOMER_ACCOUNT_THEME_NOTES.md`); it remains available where the App Proxy isn't
configured.“

## §2 — the App Proxy store box (superseded by ROLLOUT_TODO.md 5.4)

Superseded: the owners are M (alone in the Shopify Dev Dashboard) and F, the theme step is done
(the widget calls whoami once per tab), and the current procedure with scope `write_app_proxy`,
the URL check and the switch-on is `docs/ROLLOUT_TODO.md` 5.4.

> **⚠️ REQUIRES A ONE-TIME STORE + THEME ACTION (Lucas) before it can fire:**
> 1. **Add an App Proxy** to the app — Shopify admin → the app → *App proxy*:
>    **Subpath prefix** `apps`, **Subpath** `chat`, **Proxy URL**
>    `https://mo.motionsports.de/api/auth/storefront` (Shopify appends the sub-path:
>    `/apps/chat/whoami` arrives at `/api/auth/storefront/whoami`, which answers the
>    same).
> 2. **Theme** calls the proxied same-origin path `/apps/chat/whoami?session={sid}`
>    on first panel open (see `frontend-handoff/CUSTOMER_ACCOUNT.md` §3a).
> 3. **Backend env** `SHOPIFY_APP_PROXY_SECRET` = the app's API secret key (falls
>    back to `SHOPIFY_CLIENT_SECRET`).
> 4. **Re-verify on the live store** that App-Proxy `logged_in_customer_id` is
>    populated for this store's customer-accounts mode (the spike's "unreliable"
>    finding predates Shopify's fixes). The endpoint fails closed regardless, and
>    the chatbot "Anmelden" remains the fallback — so this is never a security risk.
>    The check: open `/apps/chat/whoami?session=livecheck-manual` while logged in
>    to the shop and look for its `account_shop_recognised` row (`verify:live`
>    section 8; `livecheck-%` sessions never count in the KPIs). No row = Shopify
>    sends no `logged_in_customer_id` for this account type.

Also superseded: „with the switch off whoami only measures“ — with the kill switch off, a signed,
fresh request still ends links (handover; a shop logout ends the session's `app_proxy` link).

## §4 — the e-mail-capture resolver flaw (03.10.2026)

Since the customer mirror every shop customer has a `shopify_customer_id`, and the token is kept
per customer, so "the linked customer is a Shopify customer with a live token" no longer proved
that *this* session signed in — typing the e-mail of a signed-in customer in another browser
resolved as their session (fixed 03.10.2026, migration 0071). The old fallback via
`conversations.customer_id` is gone for the same reason.

## §7 — live sign-in test, step 1

„**Shopify admin (Lucas):** Headless channel → Customer Account API client (PUBLIC), register the
URLs …“ — the owner name is obsolete (owners: `docs/ROLLOUT_TODO.md`).

## §9 — the lost-thread defects fixed by migration 0026

A started conversation must persist and list **exactly like ChatGPT/Claude** —
every started thread is durable, even before the assistant answers. Two defects
broke that and are now fixed:

- **Orphaned by a missing customer link.** The conversation row was written only
  in `persistTurn` (the chat `onFinish`, *after* the stream) and that `INSERT`
  **never set `customer_id`** — the customer link was stamped only at sign-in /
  email-capture (`UPDATE conversations … WHERE session_id`), which had already run
  *before* a later "Neue Beratung" row existed. So a new signed-in thread was
  created with `customer_id = NULL` and never appeared in the list (which filters
  `WHERE customer_id = <self>`). **Lost.**
- **Flushed too late.** Persisting only in `onFinish` meant a thread whose answer
  never landed (reload / switch first) was never written at all.

Titles: „**No Anthropic call** runs per list render — it never did. As of migration **0026** the
derived label is also **cached on the row** (`conversations.title_auto`, written at creation), so
the list no longer runs a per-row `LATERAL` sub-select to fetch each conversation's first
message.“ List performance: „The pre-existing `conversations(customer_id)` index (migration 0008)
covered the filter but **not** the ordering, so a long history still paid a sort.“

## §9 — erasure, Shopify side (superseded: one outbox row)

Superseded — the erasure queues **two** outbox rows (`consent_update` behind
`SHOPIFY_CONSENT_WRITEBACK`, `data_erasure` behind `SHOPIFY_ERASURE_SYNC`); current text:
`docs/CONSENT_FLOW.md` „Erasure (one deletion with Shopify)“.

> **The Shopify side.** For a signed-in customer (always a Shopify id) the same
> call writes an **erasure tombstone** for the Shopify id — no import,
> reconciliation or webhook brings the person back — and queues one
> `data_erasure` outbox row: consent off in Shopify, then Shopify's own
> `customerRequestDataErasure`. It is sent only while `SHOPIFY_ERASURE_SYNC=true`
> (default `false`; the row waits until then).

> ℹ️ **Retired:** the second suppression list for the §7(3) existing-customer
> basis (`bestandskunden_suppression_list`) was dropped with that feature
> (migration `0029`, 2026-06-16). The `suppression_list` row with reason
> `erasure` is the only block an erasure leaves.

## §10 — superseded opt-in passages

- „The copy is served by `signInMarketingConsentCopy()` (`GET /api/consent-copy?surface=signin`,
  v3).“ — superseded: the copy version is `v5` (`src/lib/consent-copy-version.mjs`).
- **Reached from the chat gate.** „The anonymous chat consent gate now **leads with sign-in**
  (`signIn` in `GET /api/consent-copy?surface=chat`, `loginPath` `/api/auth/shopify/login`); after
  the round-trip this card asks for the consent in one tap — or, for a customer already
  subscribed, nothing is asked. The typed-e-mail opt-in stays the alternative for people without
  an account.“ — superseded: the widget retired the chat consent gate on 2026-10-01; the ask is a
  popup after the sign-in and an inline card after a mid-chat sign-in.
- **current-anonymous-session → signed-in:** „only the **current** session's conversation (the
  chat that led to sign-in, carried in the signed `state`/pending record) is attached — `WHERE
  session_id = THIS session`.“ — superseded by migration 0073: the attach runs on the redeem of
  the one-time code, for the session the grant names, and moves only conversations without a
  customer or of the same customer.
- `optInActionable`: „Such a customer is `pending`/`confirmed`/`unsubscribed` → **not
  actionable** (decided, never re-asked).“ — superseded: an expired `pending` DOI is reset to no
  consent by the nightly run, and the ask may come again.

> ℹ️ **§7(3) Bestandskunden — Retired 2026-06-16** (client decision; never live, schema dropped in
> migration `0029`). The `bestandskunde_eligible` audience and the
> `BESTANDSKUNDE_SENDS_APPROVED` flag no longer exist — see
> `CONSENT_FLOW.md` "§7 Abs. 3 UWG Bestandskunden — REMOVED". Marketing mail rests on the one
> consent only.

## §11 — format history

„Format: PDF (10E-1, replacing the 10B-1 HTML)“ — the summary download was first an HTML document
(10B-1), then a PDF (10E-1; `docs/archive/CHANGE_REPORT_10E-1.md`).
