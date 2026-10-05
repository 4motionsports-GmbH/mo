# Marketing discount codes — expiry & how the email states it

How the unique, single-use `MS5-` marketing discount codes of the former Kunden
1:1 marketing path (`marketing_sends`, minted at APPROVE & SEND time by
`approveAndSend`, see `src/lib/shopify-discounts.ts`) handle expiry, and how the
deadline is communicated to the customer. That path only finishes drafts that
were already open (Kunden → „Marketing“ → „Persönliche E-Mail (bisheriger Weg)
— offener Entwurf“, [`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md)); new 1:1 mails
are the campaign „Einzelansprache“. The campaign path's `MK-` codes
(`campaign_sends`, per-campaign `discount_valid_until`) follow the same
projected-date swap and deterministic deadline line; they are documented in
[`CAMPAIGNS.md`](./CAMPAIGNS.md) §2.1, §4 and §5.

> Combinability ("non-stackable") and excluding already-reduced (sale) items
> are deliberately NOT handled in this backend. Shopify cannot express
> "exclude sale items" on a basic code discount without workarounds
> (collection scoping with product-level caveats), so those rules will live in
> a separate dedicated app instead.

## Expiry — 7 days, stated in the email

Codes expire **7 days after creation** (`endsAt` = mint time + 7 days on the
`DiscountCodeBasicInput`; override via `MARKETING_DISCOUNT_EXPIRY_DAYS`). The
Shopify-returned `endsAt` is stored in `marketing_sends.discount_expires_at`.

The deadline reaches the customer twice:

1. **In the AI prose** — the draft prompt is given the validity period and the
   concrete German-formatted date (Europe/Berlin, `TT.MM.JJJJ`) and instructed
   to state both naturally near the call-to-action, in Mo's voice. The date
   named at draft time is *projected*; the real code is minted only at
   APPROVE & SEND, so the send step swaps a stale projected date in the prose
   for the real expiry (same 1:1 mechanism as the `MO-XXXX` code placeholder).
2. **Deterministically** — the non-editable line under the cart button (or the
   code line, when there is no cart) always carries "gültig bis TT.MM.JJJJ"
   derived from the *minted* code's actual `endsAt`, so the deadline ships
   even if the prose was edited.

The transactional **summary email carries no discount code by design** (see
`src/lib/summary-email.ts`), so no deadline needs to be stated there.

## Welcome codes (`WELCOME-…`) — ⚠️ feature retired

No code mints welcome codes any more (the retirement is recorded in
[`CUSTOMERS.md`](./CUSTOMERS.md) „Welcome discount“; history:
[`archive/BACKEND_REFERENCE_HISTORY_2026-10.md`](./archive/BACKEND_REFERENCE_HISTORY_2026-10.md)).
The migration `0009` columns stay read-only on `customers`; the only reader is
the chat memory (`src/lib/customer-memory.ts`): when `welcome_issued_at` is set,
Mo is told to promise no welcome discount. No admin view shows them.
