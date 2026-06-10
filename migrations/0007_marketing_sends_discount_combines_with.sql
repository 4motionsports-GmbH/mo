-- 0007_marketing_sends_discount_combines_with.sql — record the combinability
-- ("combines with") settings of each minted marketing discount code.
--
-- Marketing codes are now created NON-STACKABLE: in Shopify's discount
-- combinations model a discount declares which discount CLASSES it may combine
-- with (product / order / shipping); two discounts stack only when each allows
-- the other's class. We set all three to false, so our code can never be
-- combined with any other discount (code or automatic) — a customer holding
-- e.g. a 10% code cannot stack our 5% code on top; Shopify applies the better
-- one instead.
--
--   discount_combines_with — the combinesWith settings as ECHOED BY SHOPIFY in
--                            the create-mutation response (not what we sent),
--                            e.g. {"orderDiscounts":false,"productDiscounts":false,
--                            "shippingDiscounts":false}. Stored per send so the
--                            record shows exactly what rules each shipped code
--                            carried, even if defaults change later. NULL for
--                            rows sent before this feature or without a code.

ALTER TABLE marketing_sends
  ADD COLUMN IF NOT EXISTS discount_combines_with JSONB;
