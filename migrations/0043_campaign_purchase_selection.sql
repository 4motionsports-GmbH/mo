-- 0043_campaign_purchase_selection.sql — operator-narrowed purchase basis for
-- campaign recommendations.
--
-- By default a draft's recommendations are derived from ALL catalog-matched
-- past purchases of the contact. In the review card the operator can narrow
-- that basis to selected purchased products; the selection is persisted on the
-- draft so every later regenerate (discount change, language switch, plain
-- "Neu generieren") keeps using the same basis. NULL = no narrowing (all
-- purchases — the default). Values are catalog product ids (= Shopify
-- handles), the same key space as recommended_product_ids.

ALTER TABLE campaign_drafts
  ADD COLUMN IF NOT EXISTS purchase_selected_ids TEXT[];
