// POST /api/admin/kpi/top-questions  { personaLabel, force? }
//
// On-demand "top questions per persona" summarisation for the KPI tab. This is
// the ONE place an Anthropic token cost is incurred from the dashboard, so it is
// only ever hit by an explicit button click — never on page load.
//
//   - force !== true  → return the cached summary if one exists, else generate.
//   - force === true  → always (re)generate and overwrite the cache.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import {
  getCachedTopQuestions,
  generateTopQuestions,
} from "@/lib/kpi-top-questions";
import { ARCHETYPE_META } from "@/lib/persona";
import { isDbConfigured } from "@/lib/db";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

// Valid persona keys: every archetype id plus the 'unknown' bucket.
const VALID_PERSONAS = new Set<string>([...Object.keys(ARCHETYPE_META), "unknown"]);

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let personaLabel: string;
  let force: boolean;
  try {
    const body = (await req.json()) as { personaLabel?: unknown; force?: unknown };
    personaLabel = typeof body.personaLabel === "string" ? body.personaLabel : "";
    force = body.force === true;
    if (!VALID_PERSONAS.has(personaLabel)) {
      return adminJsonError("bad_request", "Unknown personaLabel", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  try {
    if (!force) {
      const cached = await getCachedTopQuestions(personaLabel);
      if (cached) return adminJson({ summary: cached });
    }
    const summary = await generateTopQuestions(personaLabel);
    if (!summary) {
      return adminJsonError("unavailable", "Could not generate summary", 503);
    }
    return adminJson({ summary });
  } catch (err) {
    reportError(err, { route: "api/admin/kpi/top-questions" });
    return adminJsonError("internal_error", "Unexpected server error", 500);
  }
}
