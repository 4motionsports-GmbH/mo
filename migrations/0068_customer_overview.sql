-- 0068_customer_overview.sql — the one read model of a customer.
--
-- customers (identity, consent, profile) + customer_facts (deterministic
-- figures) + the block state from suppression_list, as one view. It is the
-- single base for the Kunden list (lib/customer-list-store.ts) and for
-- campaign audiences (lib/audience-store.ts): both write their predicates
-- once, against these columns. Plain view, no logic beyond joins and
-- coalescing — the rules live in the pure cores.

CREATE OR REPLACE VIEW customer_overview AS
SELECT
  c.id                                         AS customer_id,
  c.email,
  NULLIF(btrim(concat_ws(' ', c.first_name, c.last_name)), '') AS full_name,
  COALESCE(
    NULLIF(btrim(concat_ws(' ', c.first_name, c.last_name)), ''),
    NULLIF(btrim(c.shopify_account_summary->>'displayName'), ''),
    NULLIF(btrim(c.shopify_account_summary->>'firstName'), '')
  )                                            AS display_name,
  c.source,
  c.shopify_customer_id,
  (c.shopify_customer_id IS NOT NULL)          AS is_shopify_customer,
  c.shopify_state,
  c.shopify_tags,
  c.locale,
  c.country_code,
  c.language_override,
  c.created_at,
  c.first_seen_at,
  c.last_seen_at,
  c.shopify_created_at,
  c.persona_label,
  c.profile_depth,
  (c.profile_summary IS NOT NULL)              AS has_profile,
  c.profile_objection_at,
  c.postal_objection_at,
  (c.postal_address IS NOT NULL)               AS has_postal_address,
  c.email_consent_state,
  c.email_consent_level,
  c.email_consent_at,
  c.email_consent_source,
  CASE WHEN s.reason IN ('bounce', 'complaint', 'erasure') THEN s.reason ELSE NULL END AS block_reason,
  (s.reason IN ('bounce', 'complaint', 'erasure')) IS TRUE AS blocked,
  COALESCE(f.orders_count, 0)                  AS orders_count,
  COALESCE(f.total_spent_cents, 0)             AS total_spent_cents,
  f.first_order_at,
  f.last_order_at,
  f.aov_cents,
  f.median_interval_days,
  f.expected_next_order_at,
  f.lifecycle_segment,
  f.value_tier,
  f.rfm_r,
  f.rfm_f,
  f.rfm_m,
  f.churn_risk,
  COALESCE(f.bought_handles, '{}')             AS bought_handles,
  COALESCE(f.bought_categories, '{}')          AS bought_categories,
  COALESCE(f.complement_handles, '{}')         AS complement_handles,
  COALESCE(f.conversations_count, 0)           AS conversations_count,
  f.last_chat_at,
  COALESCE(f.emails_sent_count, 0)             AS emails_sent_count,
  f.last_marketing_at,
  f.last_click_at,
  COALESCE(f.clicks_90d, 0)                    AS clicks_90d,
  COALESCE(f.redemptions_count, 0)             AS redemptions_count,
  f.last_inbound_at,
  COALESCE(f.unanswered_inbound_count, 0)      AS unanswered_inbound_count,
  GREATEST(f.last_activity_at, c.last_seen_at) AS last_activity_at,
  f.computed_at                                AS facts_computed_at,
  COALESCE(t.open_tasks, 0)                    AS open_tasks_count,
  t.top_priority                               AS top_task_priority
FROM customers c
LEFT JOIN customer_facts f ON f.customer_id = c.id
LEFT JOIN suppression_list s ON s.email = c.email
LEFT JOIN (
  SELECT customer_id, count(*)::int AS open_tasks, max(priority) AS top_priority
    FROM inbox_items
   WHERE status = 'offen' AND customer_id IS NOT NULL
   GROUP BY customer_id
) t ON t.customer_id = c.id;
