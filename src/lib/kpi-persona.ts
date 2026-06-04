// Persona-group KPI insights (Cluster A — analytics). The high-value part of the
// dashboard: what each persona archetype is actually being shown.
//
// FAVORITE PRODUCTS is a pure, reliable aggregation: across every conversation
// in a persona group, how often each product id appears in
// recommended_product_ids. (recommended_product_ids is de-duped per conversation
// by the upsert, so a count here is "in how many of this persona's chats was
// this product recommended".)
//
// The TOP QUESTIONS insight is the on-demand, token-costing summarisation and
// lives separately in kpi-top-questions.ts.

import { getSql, type Sql } from "./db";
import { getProductsByIds } from "./product-catalog";
import { ARCHETYPE_META } from "./persona";
import type { PersonaArchetype } from "./types";
import { reportError } from "./observability";

export interface PersonaFavoriteProduct {
  productId: string;
  /** Catalog name, or the raw id when the product is no longer in the catalog. */
  name: string;
  /** Number of this persona's conversations that recommended the product. */
  count: number;
}

export interface PersonaInsight {
  /** Raw label as stored (or 'unknown' for null), used as a stable key. */
  personaLabel: string;
  /** Human-readable German label. */
  personaDisplay: string;
  /** Conversations in this persona group. */
  chatCount: number;
  favoriteProducts: PersonaFavoriteProduct[];
}

function personaDisplayLabel(label: string): string {
  const meta = ARCHETYPE_META[label as PersonaArchetype];
  return meta ? meta.label : label;
}

/**
 * Per-persona chat counts and their top-`topN` most-recommended products.
 * Returns null when no DB is configured, [] when there are no conversations.
 */
export async function getPersonaInsights(
  topN = 5,
  sql: Sql | null = getSql()
): Promise<PersonaInsight[] | null> {
  if (!sql) return null;
  const limit = Number.isFinite(topN) && topN > 0 ? Math.floor(topN) : 5;

  try {
    const [chatRows, productRows] = await Promise.all([
      sql`
        SELECT COALESCE(persona_label, 'unknown') AS persona, count(*)::int AS n
          FROM conversations
         GROUP BY 1
      `,
      sql`
        SELECT COALESCE(c.persona_label, 'unknown') AS persona,
               pid,
               count(*)::int AS n
          FROM conversations c,
               unnest(c.recommended_product_ids) AS pid
         GROUP BY 1, 2
      `,
    ]);

    // Group product counts by persona, sorted desc, capped to `limit`.
    const byPersona = new Map<string, PersonaFavoriteProduct[]>();
    for (const r of productRows as Array<{ persona: string; pid: string; n: number }>) {
      const arr = byPersona.get(r.persona) ?? [];
      arr.push({ productId: String(r.pid), name: String(r.pid), count: Number(r.n) });
      byPersona.set(r.persona, arr);
    }

    // Resolve catalog names for every product id we need to display.
    const neededIds = new Set<string>();
    for (const arr of byPersona.values()) {
      arr.sort((a, b) => b.count - a.count || a.productId.localeCompare(b.productId));
      for (const p of arr.slice(0, limit)) neededIds.add(p.productId);
    }
    const nameById = new Map<string, string>();
    if (neededIds.size > 0) {
      const products = await getProductsByIds([...neededIds]);
      for (const p of products) nameById.set(p.id, p.name);
    }

    const insights: PersonaInsight[] = (
      chatRows as Array<{ persona: string; n: number }>
    ).map((r) => {
      const favorites = (byPersona.get(r.persona) ?? [])
        .slice(0, limit)
        .map((p) => ({ ...p, name: nameById.get(p.productId) ?? p.productId }));
      return {
        personaLabel: r.persona,
        personaDisplay: personaDisplayLabel(r.persona),
        chatCount: Number(r.n),
        favoriteProducts: favorites,
      };
    });

    insights.sort((a, b) => b.chatCount - a.chatCount);
    return insights;
  } catch (err) {
    reportError(err, { route: "lib/kpi-persona", phase: "getPersonaInsights" });
    return null;
  }
}
