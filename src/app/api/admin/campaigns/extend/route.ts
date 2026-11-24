// POST /api/admin/campaigns/extend  { id, endsAt: ISO instant | null }
//   → { campaign, mode, expired, open, refresh, started }
//
// „Ende ändern“ / „Verlängern“ — a new end for a campaign of any kind but the
// Einzelansprache: a Rundmail's „Versand spätestens bis“ also after its
// release, and a campaign its date ended („Abgelaufen“, or „Beendet“ by the
// nightly job) running again. Rules: lib/campaign-end.mjs (tested); the
// change: extendCampaignEnd (campaigns-store.ts). A Rundmail that stopped at
// its end sends its next batch at once, like „Fortsetzen“ — only to
// recipients still waiting. Audited as `campaign.extend`.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { extendCampaignEnd } from "@/lib/campaigns-store";
import { isCampaignSendsApproved } from "@/lib/campaign-flags.mjs";
import { runMailingStep } from "@/lib/mailing-send";
import { reportError } from "@/lib/observability";

// A campaign that runs again takes its audience up (like „Wieder aufnehmen“);
// a Rundmail sends its first batch within 25 s.
export const maxDuration = 120;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let id: number;
  let endsAt: unknown;
  try {
    const body = (await req.json()) as { id?: unknown; endsAt?: unknown };
    id = Number(body.id);
    if (!("endsAt" in body)) return adminJsonError("bad_request", "Neues Ende fehlt.", 400);
    endsAt = body.endsAt;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }
  if (!Number.isInteger(id) || id <= 0) return adminJsonError("bad_request", "id required", 400);
  if (endsAt !== null && typeof endsAt !== "string") return adminJsonError("bad_request", "Ungültiger Zeitpunkt.", 400);
  try {
    const res = await extendCampaignEnd(id, endsAt);
    if (!res.ok) {
      if (res.reason === "not_found") return adminJsonError("not_found", "Kampagne nicht gefunden.", 404);
      if (res.reason === "refused") return adminJsonError("not_possible", res.message ?? "Nicht möglich.", 409);
      if (res.reason === "conflict") return adminJsonError("conflict", res.message ?? "Bitte neu laden.", 409);
      return adminJsonError("internal_error", "Das Ende konnte nicht geändert werden.", 500);
    }
    await recordAdminAccess(
      {
        action: "campaign.extend",
        detail: {
          campaignId: id,
          kind: res.campaign.kind,
          from: res.previousEndsAt,
          to: res.campaign.endsAt,
          mode: res.mode,
          ...(res.open != null ? { open: res.open } : {}),
        },
      },
      req
    );
    // A Rundmail that had stopped at its end goes on at once instead of within the minute.
    let started = false;
    if (res.campaign.kind === "rundmail" && res.expired && res.campaign.status === "aktiv" && (res.open ?? 0) > 0 && isCampaignSendsApproved()) {
      try {
        await runMailingStep({ campaignId: id, deadlineMs: Date.now() + 25_000 });
        started = true;
      } catch (err) {
        // the per-minute runner takes over
        reportError(err, { route: "api/admin/campaigns/extend", phase: "step" });
      }
    }
    return adminJson({
      campaign: res.campaign,
      mode: res.mode,
      expired: res.expired,
      open: res.open,
      refresh: res.refresh,
      started,
    });
  } catch (err) {
    reportError(err, { route: "api/admin/campaigns/extend" });
    return adminJsonError("internal_error", "Das Ende konnte nicht geändert werden.", 500);
  }
}
