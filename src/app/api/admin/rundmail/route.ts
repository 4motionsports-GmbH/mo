// POST /api/admin/rundmail  { campaignId, action, … }
//
// The Rundmail workspace (Kampagnen → a campaign of kind „Rundmail“,
// docs/CAMPAIGNS.md §9). One route, explicit actions:
//
//   state                         → { mailing, stats, campaign }   (polling)
//   save    { subject, preheader, doc, language, rate, engagedFirst, expectedVersion }
//                                 → { mailing }        (409 when frozen / stale)
//   pacing  { rate, engagedFirst } → { mailing }        (no new test needed)
//   checks                        → { evaluation }     (every pre-release check)
//   test    { addresses, firstName, expectedVersion } → { sentTo, version }
//   release { startsAt?, expectedVersion } → { startsAt, evaluation }   (Senden / Planen)
//   unschedule                    → planned, nothing sent yet → back to Entwurf
//   pause | resume | cancel       → the running send
//   step                          → one runner step now (the page drives sending
//                                   while open; the cron every minute anyway)
//
// Every mutation is audit-logged (rundmail.*). Release, test and resume
// re-check CAMPAIGN_SENDS_APPROVED and every other gate on the server.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";
import { getCampaign } from "@/lib/campaigns-store";
import { isCampaignSendsApproved } from "@/lib/campaign-flags.mjs";
import {
  cancelMailing,
  getMailing,
  getMailingStats,
  saveMailingContent,
  saveMailingPacing,
  setMailingPaused,
  unfreezeMailing,
} from "@/lib/mailing-store";
import { evaluateMailing, releaseMailing, runMailingStep, sendMailingTest } from "@/lib/mailing-send";
import { normalizeMailTemplateDoc } from "@/lib/mail-template-doc.mjs";
import { docBlockLimitProblem } from "@/lib/mail-template-slots.mjs";
import { parseMailingRate } from "@/lib/mailing-core.mjs";

export const maxDuration = 120;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  if (!isDbConfigured()) return adminJsonError("no_database", "Keine Datenbank konfiguriert.", 503);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return adminJsonError("bad_request", "Ungültige Anfrage (kein JSON).", 400);
  }
  const campaignId = Number(body.campaignId);
  if (!Number.isInteger(campaignId) || campaignId <= 0) return adminJsonError("bad_request", "campaignId fehlt.", 400);
  const action = String(body.action ?? "");

  try {
    const campaign = await getCampaign(campaignId);
    if (!campaign || campaign.kind !== "rundmail") return adminJsonError("not_found", "Rundmail nicht gefunden.", 404);
    const audit = (a: string, detail: Record<string, unknown> = {}) =>
      recordAdminAccess({ action: `rundmail.${a}`, detail: { campaignId, ...detail } }, req);

    switch (action) {
      case "state": {
        const [mailing, stats] = await Promise.all([getMailing(campaignId), getMailingStats(campaignId)]);
        return adminJson({ mailing, stats, campaign: { status: campaign.status, startsAt: campaign.startsAt, endsAt: campaign.endsAt } });
      }

      case "save": {
        const subject = typeof body.subject === "string" ? body.subject.replace(/\s+/g, " ").trim().slice(0, 200) : "";
        const preheader = typeof body.preheader === "string" ? body.preheader.replace(/\s+/g, " ").trim().slice(0, 200) || null : null;
        const raw = JSON.stringify(body.doc ?? {});
        if (raw.length > 400_000) return adminJsonError("too_large", "Der Inhalt ist zu groß.", 413);
        // Counted on the body (sections' blocks included): the normaliser would cut silently.
        const tooMany = docBlockLimitProblem(body.doc);
        if (tooMany) return adminJsonError("too_large", tooMany, 400);
        const doc = normalizeMailTemplateDoc(body.doc);
        const expected = Number.isInteger(body.expectedVersion) ? Number(body.expectedVersion) : null;
        const res = await saveMailingContent(
          campaignId,
          {
            subject,
            preheader,
            doc,
            language: body.language === "en" ? "en" : "de",
            rate: parseMailingRate(body.rate),
            engagedFirst: body.engagedFirst !== false,
          },
          expected
        );
        if (!res.ok) {
          if (res.reason === "frozen") return adminJsonError("frozen", "Die Rundmail ist freigegeben — der Inhalt ist fest.", 409);
          if (res.reason === "conflict") {
            return adminJsonError("conflict", "Der Inhalt wurde in einem anderen Fenster geändert — bitte neu laden.", 409);
          }
          if (res.reason === "not_found") return adminJsonError("not_found", "Rundmail nicht gefunden.", 404);
          return adminJsonError("internal_error", "Der Inhalt konnte nicht gespeichert werden.", 500);
        }
        return adminJson({ mailing: res.mailing });
      }

      case "pacing": {
        const ok = await saveMailingPacing(campaignId, parseMailingRate(body.rate), body.engagedFirst !== false);
        if (!ok) return adminJsonError("frozen", "Die Rundmail ist freigegeben — das Tempo ist fest.", 409);
        return adminJson({ mailing: await getMailing(campaignId) });
      }

      case "checks": {
        const mailing = await getMailing(campaignId);
        if (!mailing) return adminJsonError("not_found", "Rundmail nicht gefunden.", 404);
        return adminJson({ evaluation: await evaluateMailing(campaign, mailing) });
      }

      case "test": {
        const res = await sendMailingTest(campaignId, {
          addresses: body.addresses,
          firstName: body.firstName,
          expectedVersion: body.expectedVersion,
        });
        if (!res.ok) return adminJsonError("test_failed", res.message, res.status);
        await audit("test", { addresses: res.sentTo.length, version: res.version });
        return adminJson(res);
      }

      case "release": {
        const res = await releaseMailing(campaignId, { startsAt: body.startsAt, expectedVersion: body.expectedVersion });
        if (!res.ok) {
          return Response.json(
            { error: { code: "release_refused", message: res.message }, evaluation: res.evaluation ?? null },
            { status: res.status }
          );
        }
        await audit("release", { startsAt: res.startsAt, audience: res.evaluation.audience?.total ?? null });
        // Start right away when due — the cron continues every minute.
        if (Date.parse(res.startsAt) <= Date.now() + 1000) {
          await runMailingStep({ campaignId, deadlineMs: Date.now() + 25_000 });
        }
        return adminJson({ startsAt: res.startsAt, evaluation: res.evaluation, stats: await getMailingStats(campaignId) });
      }

      case "unschedule": {
        const ok = await unfreezeMailing(campaignId);
        if (!ok) {
          return adminJsonError("not_possible", "Zurücknehmen geht nur, solange noch keine Mail versendet wurde.", 409);
        }
        await audit("unschedule");
        return adminJson({ ok: true });
      }

      case "pause": {
        const ok = await setMailingPaused(campaignId, true);
        if (!ok) return adminJsonError("not_possible", "Die Rundmail läuft gerade nicht.", 409);
        await audit("pause");
        return adminJson({ ok: true });
      }

      case "resume": {
        if (!isCampaignSendsApproved()) {
          return adminJsonError("sends_not_approved", "Versand gesperrt: CAMPAIGN_SENDS_APPROVED ist aus.", 403);
        }
        const ok = await setMailingPaused(campaignId, false);
        if (!ok) return adminJsonError("not_possible", "Die Rundmail ist nicht pausiert.", 409);
        await audit("resume");
        await runMailingStep({ campaignId, deadlineMs: Date.now() + 25_000 });
        return adminJson({ ok: true, stats: await getMailingStats(campaignId) });
      }

      case "cancel": {
        if (body.confirm !== true) return adminJsonError("bad_request", "Bitte bestätigen.", 400);
        const skipped = await cancelMailing(campaignId);
        if (skipped == null) return adminJsonError("internal_error", "Abbrechen fehlgeschlagen.", 500);
        await audit("cancel", { skipped });
        return adminJson({ ok: true, skipped });
      }

      case "step": {
        const result = await runMailingStep({ campaignId, deadlineMs: Date.now() + 25_000 });
        return adminJson({ result, stats: await getMailingStats(campaignId), mailing: await getMailing(campaignId) });
      }

      default:
        return adminJsonError("bad_request", "Unbekannte Aktion.", 400);
    }
  } catch (err) {
    reportError(err, { route: "api/admin/rundmail", phase: action });
    return adminJsonError("internal_error", "Die Aktion ist fehlgeschlagen.", 500);
  }
}
