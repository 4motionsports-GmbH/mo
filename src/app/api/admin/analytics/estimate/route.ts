// POST /api/admin/analytics/estimate  { range, from, to, includePerCustomer }
//
// Cheap, ZERO-token cost preview for the "Komplettanalyse" generator dialog: how
// many conversations still need analysing, how many persona groups and (when
// per-customer knowledge is on) how many active customers there are, and the
// estimated EUR cost of the full run. Pure DB counts + the JS price table — the
// operator sees "ca. €X" before confirming a deliberately expensive run.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { resolveKpiRange } from "@/lib/kpi-range";
import {
  getPersonaLabelsInRange,
  getActiveCustomerIdsInRange,
  countConversationsInRange,
} from "@/lib/analytics-report-store";
import { countUnanalyzedInRange } from "@/lib/admin-conversations";
import { normalizeOptions, estimateReportCostUsd } from "@/lib/analytics-report-core.mjs";
import { loadModelPrices, usdEurRate, usdToEur } from "@/lib/ai-pricing.mjs";

export const maxDuration = 30;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let range: string | undefined;
  let from: string | undefined;
  let to: string | undefined;
  let includePerCustomer = false;
  try {
    const body = (await req.json()) as {
      range?: unknown;
      from?: unknown;
      to?: unknown;
      includePerCustomer?: unknown;
    };
    range = typeof body.range === "string" ? body.range : undefined;
    from = typeof body.from === "string" ? body.from : undefined;
    to = typeof body.to === "string" ? body.to : undefined;
    includePerCustomer = body.includePerCustomer === true;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  const resolved = resolveKpiRange({ kpiRange: range, kpiFrom: from, kpiTo: to });
  const options = normalizeOptions({ includePerCustomer });

  const [conversations, unanalyzed, personas] = await Promise.all([
    countConversationsInRange(resolved.from, resolved.to),
    countUnanalyzedInRange(resolved.from, resolved.to),
    getPersonaLabelsInRange(resolved.from, resolved.to),
  ]);
  const customerIds = includePerCustomer
    ? await getActiveCustomerIdsInRange(resolved.from, resolved.to, options.maxProfiles)
    : [];

  const estUsd = estimateReportCostUsd(
    {
      conversationsToAnalyze: unanalyzed,
      personaCount: personas.length,
      customerCount: customerIds.length,
      includePerCustomer,
    },
    loadModelPrices()
  );

  return adminJson({
    range: { from: resolved.from, to: resolved.to, label: resolved.label, preset: resolved.preset },
    conversations,
    unanalyzed,
    personaCount: personas.length,
    customerCount: customerIds.length,
    estimateEur: usdToEur(estUsd, usdEurRate()),
  });
}
