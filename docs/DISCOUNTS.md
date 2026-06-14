# Marketing discount codes — expiry & how the email states it

How the unique, single-use marketing discount codes (minted at APPROVE & SEND
time, see `src/lib/shopify-discounts.ts`) handle expiry, and how the deadline
is communicated to the customer.

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

The automatic one-time **welcome discount** (minted on a customer's first DOI
confirmation, `WELCOME-` prefix) was **retired pre-launch** — client decision:
too exploitable via alias emails; codes are issued manually via the dashboard
instead. The issuance code and the `WELCOME_DISCOUNT_*` env flags have been
removed. Any `WELCOME-…` codes already minted in Shopify remain valid until
their own expiry, and the historical issued/redeemed data stays visible on the
admin **Kunden** tab (read-only).
