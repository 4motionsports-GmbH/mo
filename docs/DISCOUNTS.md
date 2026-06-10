# Marketing discount codes — rules & real-world behavior

How the unique, single-use marketing discount codes (minted at APPROVE & SEND
time, see `src/lib/shopify-discounts.ts`) are configured, what each rule
actually does for the customer, and — importantly — where Shopify's discount
model limits what we can promise.

All shapes were verified against the **Admin GraphQL API version configured in
`SHOPIFY_API_VERSION` (2026-04)**. shopify.dev blocks automated fetching
(HTTP 403), so the schema was cross-checked via Shopify's help-center /
changelog pages and a current integration template targeting
`/admin/api/2026-04/graphql.json`; the doc citations sit next to the code in
`src/lib/shopify-discounts.ts`.

## 1. Non-stackable (combines with nothing)

Every code is created with

```
combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false }
```

Shopify has **no "combines with other discount codes" switch**. Instead, each
discount declares which discount *classes* (product / order / shipping) it may
combine with, and two discounts stack **only if each allows the other's
class** ([discount combinations](https://help.shopify.com/en/manual/discounts/discount-combinations)).
All-false therefore means: our code combines with **nothing** — not with
another discount code *and not with automatic discounts* either.

**What the customer sees:** if a cart already carries another discount (say a
10% code) and ours is added, Shopify does not stack them; it applies the
**better** discount and shows *"Some discount codes couldn't be used together.
We applied the best combination."* So a customer holding a 10% code never gets
10% + 5%; they get 10%.

The settings Shopify echoes back in the create-mutation response are verified
(must be all-false, otherwise the send is refused) and stored per send in
`marketing_sends.discount_combines_with`.

## 2. Full-price items only (no double discount on sale items)

**The requirement:** the code should apply only to products that are *not
already reduced*; in a mixed cart only the full-price lines get the 5%.

**What Shopify can express (and what it can't):**

- A "sale" price (compare-at price set) is **not a discount** in Shopify's
  model — it's simply the product's price. The combinability setting above
  therefore cannot exclude sale items; it only governs stacking with other
  *discounts*.
- A code discount has **no eligibility rule "exclude items on sale"** and no
  negative scoping ("everything except collection X"). `customerGets.items`
  can only positively target all items, specific products, or collections.
- The closest clean construct — and what is implemented: limit the code to an
  **automated collection with the condition "Compare-at price *is empty*"**
  (i.e. full-price products — a standard smart-collection condition,
  [docs](https://help.shopify.com/en/manual/products/collections/smart-collections/conditions)).
  A collection-scoped discount applies **per line item**, which gives exactly
  the mixed-cart behavior: sale lines get nothing, full-price lines get the 5%.

**Setup (required once):** in the Shopify admin create an automated collection
(e.g. "Nicht reduzierte Artikel") with the single condition *Compare-at price →
is empty*, and put its gid into `SHOPIFY_FULL_PRICE_COLLECTION_GID` (see
`.env.example`). The collection does not need to be published to the Online
Store sales channel for discount scoping. While the variable is **unset, codes
apply store-wide — including sale items** — and every code creation logs a
warning saying so.

**Honest limits to communicate to the client:**

1. **Product-level, not variant-level.** Collection membership is per product,
   and "Compare-at price is empty" matches when **any** variant lacks a
   compare-at price. A product with one reduced and one full-price variant
   counts as full-price — the code would then also discount its reduced
   variants. (Clean per-variant exclusion would require Shopify Functions,
   i.e. a custom app extension — out of scope here.)
2. **Compare-at price equal to the price** still counts as "set"; such
   products are treated as "on sale" and excluded although the customer sees
   no reduction.
3. **Asynchronous re-evaluation.** Automated collections update shortly after
   a price change, not in the same instant — a brief staleness window exists.
4. Products *with another discount applied* (case (b)) are already handled by
   rule 1: nothing combines with our code, so it never stacks on a line that
   another product discount is already reducing.

The scope Shopify echoes back (collection vs all) is verified against what we
requested (mismatch ⇒ send refused) and stored per send in
`marketing_sends.discount_applies_to`.

## 3. Expiry — 7 days, stated in the email

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
