// POST /api/admin/settings/senders
//   { action: "save", senders: [{ id?, address, name, replies }] } → { ok, senders }
//   { action: "test", sender: { address, name, replies } | null, to } → { ok, from }
//
// Einstellungen → „Absender“: the extra From identities campaigns and
// Rundmails may send with (lib/sender-identities.mjs). Every address must lie
// on a domain verified in Resend — the domain of CONTACT_FROM_EMAIL or one in
// EMAIL_SENDER_DOMAINS. „Testmail“ sends one short mail from an identity so
// the operator sees at once whether Resend accepts it (an unverified domain
// answers with Resend's message). Audit-logged (settings.senders,
// settings.senders_test).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";
import { sendEmail, senderAddress } from "@/lib/email";
import { renderBrandedEmail, emailTextStyle } from "@/lib/email-template";
import { escapeHtml } from "@/lib/html-escape";
import { saveSenderIdentities, senderDomains, resolveCampaignSender } from "@/lib/sender-store";
import { normalizeSenderIdentity, validateSenderIdentitiesInput } from "@/lib/sender-identities.mjs";
import { isSendableAddress } from "@/lib/mailing-core.mjs";

export const maxDuration = 30;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return adminJsonError("bad_request", "Ungültige Anfrage (kein JSON).", 400);
  }

  try {
    if (body.action === "save") {
      if (!isDbConfigured()) {
        return adminJsonError("no_database", "Keine Datenbank konfiguriert — die Absender können nicht gespeichert werden.", 503);
      }
      const parsed = validateSenderIdentitiesInput(body.senders, {
        allowedDomains: senderDomains(),
        defaultAddress: senderAddress(),
      });
      if (!parsed.ok) return adminJsonError("bad_request", parsed.message, 400);
      const result = await saveSenderIdentities(parsed.senders);
      if (!result.ok) {
        if (result.reason === "missing_table") {
          return adminJsonError("migration_missing", "Migration 0078 fehlt — bitte zuerst ausführen.", 503);
        }
        return adminJsonError("internal_error", "Die Absender konnten nicht gespeichert werden.", 500);
      }
      await recordAdminAccess(
        { action: "settings.senders", detail: { senders: result.senders.map((s) => s.address) } },
        req
      );
      return adminJson({ ok: true, senders: result.senders });
    }

    if (body.action === "test") {
      const to = typeof body.to === "string" ? body.to.trim().toLowerCase() : "";
      if (!isSendableAddress(to)) return adminJsonError("bad_request", "Bitte eine gültige Empfänger-Adresse angeben.", 400);
      let identity = null;
      if (body.sender != null) {
        identity = normalizeSenderIdentity(body.sender, { allowedDomains: senderDomains() });
        if (!identity) {
          return adminJsonError(
            "bad_request",
            `Dieser Absender liegt nicht auf einer erlaubten Domain (${senderDomains().join(", ") || "—"}).`,
            400
          );
        }
      }
      const sender = resolveCampaignSender(identity);
      if (!sender.ok) return adminJsonError("bad_request", sender.message, 400);
      const html = renderBrandedEmail({
        subject: "Testmail: Absender",
        heading: "Absender-Test",
        bodyHtml: `
                    <p style="${emailTextStyle()}" align="left">Diese Testmail kommt von <strong>${escapeHtml(sender.from)}</strong>.</p>
                    <p style="${emailTextStyle()} Margin-top: 12px;" align="left">Kam sie im Posteingang an (nicht im Spam)? Dann darf Mo mit diesem Absender senden. ${
                      sender.replyTo
                        ? `Antworten gehen an <strong>${escapeHtml(sender.replyTo)}</strong>.`
                        : "Antworten gehen direkt an den Absender."
                    }</p>`,
      });
      const result = await sendEmail({
        to,
        subject: "Testmail: Absender",
        text: `Diese Testmail kommt von ${sender.from}.\nKam sie im Posteingang an (nicht im Spam)? Dann darf Mo mit diesem Absender senden.`,
        html,
        from: sender.from,
        replyTo: sender.replyTo,
        kind: "sender_test",
      });
      if (!result.ok) {
        if (result.skipped) return adminJsonError("not_configured", "E-Mail-Versand ist nicht eingerichtet (RESEND_API_KEY).", 503);
        const message =
          result.error && typeof result.error === "object" && "message" in result.error
            ? String((result.error as { message?: unknown }).message)
            : "Resend hat die Mail abgelehnt.";
        return adminJsonError("send_failed", `Resend lehnt ab: ${message}`, 502);
      }
      await recordAdminAccess({ action: "settings.senders_test", detail: { from: sender.address } }, req);
      return adminJson({ ok: true, from: sender.from });
    }

    return adminJsonError("bad_request", "Unbekannte Aktion.", 400);
  } catch (err) {
    reportError(err, { route: "api/admin/settings/senders" });
    return adminJsonError("internal_error", "Die Absender konnten nicht verarbeitet werden.", 500);
  }
}
