// Pseudonymous KPI / telemetry ingestion (Cluster A — legitimate interest).
//
// This is the endpoint the widget's fail-silent track() calls. Like
// /api/products it exposes/accepts only pseudonymous data already implied by
// using the widget, so it does NOT require the chat shared secret — the
// origin allowlist + a generous rate limit are the guardrails.
//
// Telemetry must never be noisy: validation errors return 400, but a missing
// database or a write failure is swallowed and still acknowledged (202) so the
// widget's fire-and-forget track() never has to care.

import {
  corsHeaders,
  guardOriginOnly,
  preflightResponse,
} from "@/lib/security";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";
import { getSql } from "@/lib/db";

export const maxDuration = 10;

const ALLOWED_METHODS = "POST, OPTIONS";
const MAX_EVENT_CHARS = 120;
const MAX_SESSION_CHARS = 128;

interface KpiBody {
  event?: unknown;
  sessionId?: unknown;
  timestamp?: unknown;
  data?: unknown;
}

export async function OPTIONS(req: Request) {
  return preflightResponse(req, ALLOWED_METHODS);
}

export async function POST(req: Request) {
  const guard = guardOriginOnly(req);
  if (!guard.ok) return guard.response;
  const cors = corsHeaders(guard.origin, ALLOWED_METHODS);

  try {
    const rl = await checkRateLimit(req, "kpi");
    if (!rl.ok) return rateLimitResponse(rl.retryAfter, cors);

    let body: KpiBody;
    try {
      body = (await req.json()) as KpiBody;
    } catch {
      return errorResponse("bad_request", "Invalid JSON body", 400, cors);
    }

    // Light validation: event is the only hard requirement.
    const event = typeof body.event === "string" ? body.event.trim() : "";
    if (!event) {
      return errorResponse("bad_request", "event is required", 400, cors);
    }
    if (event.length > MAX_EVENT_CHARS) {
      return errorResponse("bad_request", "event too long", 400, cors);
    }

    const sessionId =
      typeof body.sessionId === "string"
        ? body.sessionId.trim().slice(0, MAX_SESSION_CHARS) || null
        : null;

    // Keep only a plain object as data; never accept arrays/primitives so the
    // jsonb column stays a consistent shape. Preserve the client timestamp
    // inside the payload (created_at is the server-authoritative time).
    const data: Record<string, unknown> =
      body.data && typeof body.data === "object" && !Array.isArray(body.data)
        ? { ...(body.data as Record<string, unknown>) }
        : {};
    if (typeof body.timestamp === "string" || typeof body.timestamp === "number") {
      data.clientTimestamp = body.timestamp;
    }

    // Best-effort persistence. Missing DB or write failure is non-fatal for
    // telemetry — acknowledge regardless so track() stays fire-and-forget.
    const sql = getSql();
    if (sql) {
      try {
        await sql`
          INSERT INTO kpi_events (session_id, event, data)
          VALUES (${sessionId}, ${event}, ${JSON.stringify(data)}::jsonb)
        `;
      } catch (err) {
        reportError(err, { route: "api/kpi", phase: "insert", event });
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 202,
      headers: { "Content-Type": "application/json", ...cors },
    });
  } catch (err) {
    reportError(err, { route: "api/kpi" });
    return errorResponse("internal_error", "Unexpected server error", 500, cors);
  }
}
