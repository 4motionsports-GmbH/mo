// Mo's insights → Shopify customer tags (plan D-11, SHOPIFY_WRITEBACK_ENABLED).
//
// After the nightly facts run, every mirrored Shopify customer's desired
// `mo-…` tags (lib/shopify-insight-tags.mjs) are compared with the `mo-` tags
// the mirror last saw; a difference becomes one `writeback` outbox row
// (add / remove), which the 5-minute outbox cron sends at Shopify's pace. The
// shop's own tags are never touched. Only runs while the switch is on, so no
// rows pile up while it is off. Never throws.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { isShopifyInsightsWritebackEnabled } from "./platform-flags.mjs";
import { desiredMoTags, moTagDiff } from "./shopify-insight-tags.mjs";

const PAGE = 1000;

export async function queueInsightWritebacks(
  opts: { maxRows?: number; deadlineMs?: number } = {},
  sql: Sql | null = getSql()
): Promise<{ checked: number; queued: number; skipped: boolean }> {
  const out = { checked: 0, queued: 0, skipped: false };
  if (!sql || !isShopifyInsightsWritebackEnabled()) return { ...out, skipped: true };
  const maxRows = Math.max(1, opts.maxRows ?? 2000);
  try {
    let afterId = 0;
    while (out.queued < maxRows) {
      if (opts.deadlineMs && Date.now() > opts.deadlineMs) break;
      const rows = (await sql`
        SELECT o.customer_id, o.shopify_customer_id, o.shopify_tags, o.lifecycle_segment, o.value_tier,
               o.conversations_count, o.churn_risk
          FROM customer_overview o
         WHERE o.shopify_customer_id IS NOT NULL
           AND o.facts_computed_at IS NOT NULL
           AND o.customer_id > ${afterId}
           AND NOT EXISTS (
                 SELECT 1 FROM shopify_outbox x
                  WHERE x.kind = 'writeback' AND x.customer_id = o.customer_id
                    AND x.status IN ('pending', 'failed', 'running')
               )
         ORDER BY o.customer_id
         LIMIT ${PAGE}
      `) as Array<Record<string, unknown>>;
      if (rows.length === 0) break;
      afterId = Number(rows[rows.length - 1].customer_id);
      const batch: Array<{ customer_id: number; shopify_customer_id: string; payload: { add: string[]; remove: string[] } }> = [];
      for (const r of rows) {
        out.checked++;
        const desired = desiredMoTags({
          lifecycleSegment: r.lifecycle_segment as string | null,
          valueTier: r.value_tier as string | null,
          conversationsCount: Number(r.conversations_count ?? 0),
          churnRisk: r.churn_risk as string | null,
        });
        const diff = moTagDiff(r.shopify_tags as string[] | null, desired);
        if (!diff.changed) continue;
        batch.push({
          customer_id: Number(r.customer_id),
          shopify_customer_id: String(r.shopify_customer_id),
          payload: { add: diff.add, remove: diff.remove },
        });
        if (out.queued + batch.length >= maxRows) break;
      }
      if (batch.length > 0) {
        const ins = (await sql`
          INSERT INTO shopify_outbox (kind, customer_id, shopify_customer_id, payload)
          SELECT 'writeback', x.customer_id, x.shopify_customer_id, x.payload
            FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb)
                 AS x(customer_id bigint, shopify_customer_id text, payload jsonb)
          RETURNING id
        `) as Array<{ id: number }>;
        out.queued += ins.length;
      }
      if (rows.length < PAGE) break;
    }
    return out;
  } catch (err) {
    reportError(err, { route: "lib/shopify-insights", phase: "queue" });
    return out;
  }
}
