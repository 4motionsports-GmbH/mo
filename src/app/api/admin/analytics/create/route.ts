// POST /api/admin/analytics/create  { range, from, to, includePerCustomer, includeAppendix }
//
// Create a new "Komplettanalyse" report for an interval and return its id. The row
// is created in the 'running' state at phase 'analyze'; the client then drives it
// to completion by polling /api/admin/analytics/step (this endpoint does NO model
// work itself, so it returns instantly and the sidebar shows the new report at
// once). An EXPLICIT, operator-initiated action — never automatic.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { resolveKpiRange } from "@/lib/kpi-range";
import { createAnalyticsReport } from "@/lib/analytics-report-store";
import { countUnanalyzedInRange } from "@/lib/admin-conversations";
import { normalizeOptions } from "@/lib/analytics-report-core.mjs";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let range: string | undefined;
  let from: string | undefined;
  let to: string | undefined;
  let includePerCustomer = false;
  let includeAppendix = true;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    range = typeof body.range === "string" ? body.range : undefined;
    from = typeof body.from === "string" ? body.from : undefined;
    to = typeof body.to === "string" ? body.to : undefined;
    includePerCustomer = body.includePerCustomer === true;
    includeAppendix = body.includeAppendix !== false;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  try {
    const resolved = resolveKpiRange({ kpiRange: range, kpiFrom: from, kpiTo: to });
    const options = normalizeOptions({ includePerCustomer, includeAppendix });
    const title = `Komplettanalyse · ${resolved.label}`;

    await recordAdminAccess(
      {
        action: "analytics.report.create",
        detail: { from: resolved.from, to: resolved.to, includePerCustomer },
      },
      req
    );

    // Seed the "remaining to analyse" counter so the progress bar has a target on
    // the very first render.
    const analyzeRemaining = await countUnanalyzedInRange(resolved.from, resolved.to);

    const id = await createAnalyticsReport({
      title,
      from: resolved.from,
      to: resolved.to,
      preset: resolved.preset,
      options,
      progress: { analyzeRemaining },
    });

    if (!id) {
      return adminJsonError("internal_error", "Report konnte nicht angelegt werden.", 500);
    }
    return adminJson({ id, title, from: resolved.from, to: resolved.to });
  } catch (err) {
    reportError(err, { route: "api/admin/analytics/create" });
    return adminJsonError("internal_error", "Report-Erstellung fehlgeschlagen.", 500);
  }
}
