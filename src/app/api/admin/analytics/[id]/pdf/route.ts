// GET /api/admin/analytics/<id>/pdf — download a completed "Komplettanalyse" as
// one PDF. Renders the stored `sections` payload with the repo's dependency-free
// hand-written PDF stack (lib/analytics-report-pdf → lib/pdf-core), so there is no
// headless browser / PDF dependency on Vercel. Only a COMPLETED report can be
// downloaded (a running/failed one has no finished sections).
//
// Auth: the proxy gates /api/admin/*; guardAdminGet re-asserts the session cookie.

import { guardAdminGet, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { getAnalyticsReport } from "@/lib/analytics-report-store";
import { buildAnalyticsReportPdf } from "@/lib/analytics-report-pdf.mjs";
import { germanDate } from "@/lib/kpi-range.mjs";
import { reportError } from "@/lib/observability";

export const runtime = "nodejs";
export const maxDuration = 30;

function downloadFilename(from: string, to: string): string {
  const slug = `${from}_${to}`.replace(/[^0-9_-]/g, "");
  return `motionsports-komplettanalyse-${slug || "bericht"}.pdf`;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;

  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  try {
    const { id: idParam } = await ctx.params;
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      return adminJsonError("bad_request", "Valid report id required", 400);
    }

    const report = await getAnalyticsReport(id);
    if (!report) {
      return adminJsonError("not_found", "Report nicht gefunden.", 404);
    }
    if (report.status !== "complete" || !report.sections) {
      return adminJsonError("not_ready", "Report ist noch nicht fertig.", 409);
    }

    const label =
      report.from === report.to
        ? germanDate(report.from)
        : `${germanDate(report.from)} – ${germanDate(report.to)}`;

    const pdf = buildAnalyticsReportPdf({
      title: report.title,
      label,
      from: report.from,
      to: report.to,
      generatedAt: report.completedAt ?? report.createdAt,
      costEur: report.costEur,
      sections: report.sections,
    });

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${downloadFilename(report.from, report.to)}"`,
        "Content-Length": String(pdf.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    reportError(err, { route: "api/admin/analytics/[id]/pdf" });
    return adminJsonError("internal_error", "PDF-Erstellung fehlgeschlagen.", 500);
  }
}
