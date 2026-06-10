-- 0007_conversations_selected_products.sql — track the user's ACTIVE selection.
--
-- `recommended_product_ids` accumulates every product referenced by ANY
-- product tool call — it answers "what was DISCUSSED". That made the prefilled
-- cart links over-eager: when Mo compared three alternatives, all three landed
-- in the cart, including the rejected ones.
--
-- `selected_product_ids` holds only the products the user expressed intent to
-- BUY: the ids of the latest add_to_cart (direct-checkout) tool call, which the
-- model fires only on a clear buy signal. Unlike the discussed set it is
-- updated by REPLACEMENT (the latest buying decision wins — see
-- lib/conversation-store), so a "switch" to an alternative drops the rejected
-- product. Cart-link builders prefer this set and fall back to the discussed
-- set only when it is empty (see chooseCartProductIds in lib/cart).

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS selected_product_ids TEXT[] NOT NULL DEFAULT '{}';
