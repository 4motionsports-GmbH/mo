// GET  /api/admin/vorlagen → { templates: MailTemplateMeta[] }   (archived included)
// POST /api/admin/vorlagen  { action, … }
//   get       { id }                                  → { template, usage }
//   create    { name, description?, starter? | doc? } → { template }
//   save      { id, name, description, doc, expectedVersion } → { template }  (409 stale)
//   duplicate { id }                                  → { template }
//   archive   { id, archived }                        → { template }
//   import    { file }   (the parsed JSON of an exported template) → { template }
//
// The screen „Vorlagen“ (docs/EMAIL_TEMPLATES.md): operator-built e-mail
// templates — block documents, normalised and validated by
// lib/mail-template-doc.mjs on every write. A template in use as a design
// (Einstellungen or a campaign) cannot lose „Mos persönlicher Text“ and
// cannot be archived while selected in Einstellungen. Audit-logged
// (template.*).

import { guardAdminGet, guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";
import {
  cleanTemplateDescription,
  cleanTemplateName,
  createMailTemplate,
  getMailTemplate,
  listMailTemplateMeta,
  setMailTemplateArchived,
  templateUsage,
  updateMailTemplate,
  type TemplateWriteResult,
} from "@/lib/mail-template-store";
import {
  MAIL_TEMPLATE_STARTERS,
  docSupportsPersonal,
  normalizeMailTemplateDoc,
  parseTemplateImport,
} from "@/lib/mail-template-doc.mjs";

export const maxDuration = 30;

function writeError(res: Extract<TemplateWriteResult, { ok: false }>): Response {
  switch (res.reason) {
    case "missing_table":
      return adminJsonError("migration_missing", "Migration 0081 fehlt — bitte zuerst ausführen.", 503);
    case "no_db":
      return adminJsonError("no_database", "Keine Datenbank konfiguriert.", 503);
    case "not_found":
      return adminJsonError("not_found", "Vorlage nicht gefunden.", 404);
    case "conflict":
      return adminJsonError("conflict", "Die Vorlage wurde inzwischen in einem anderen Fenster gespeichert — bitte neu laden.", 409);
    default:
      return adminJsonError("internal_error", "Die Vorlage konnte nicht gespeichert werden.", 500);
  }
}

export async function GET() {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;
  return adminJson({ templates: await listMailTemplateMeta({ includeArchived: true }) });
}

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
  const action = String(body.action ?? "");
  const id = Number(body.id);
  try {
    switch (action) {
      case "get": {
        const template = await getMailTemplate(id);
        if (!template) return adminJsonError("not_found", "Vorlage nicht gefunden.", 404);
        return adminJson({ template, usage: await templateUsage(id) });
      }

      case "create": {
        const name = cleanTemplateName(body.name);
        if (!name) return adminJsonError("bad_request", "Name mit 3–80 Zeichen angeben.", 400);
        const description = cleanTemplateDescription(body.description);
        if (description === undefined) return adminJsonError("bad_request", "Beschreibung zu lang (max. 300 Zeichen).", 400);
        const starter = MAIL_TEMPLATE_STARTERS.find((s) => s.key === body.starter);
        const doc = body.doc != null ? normalizeMailTemplateDoc(body.doc) : (starter ?? MAIL_TEMPLATE_STARTERS[1]).build();
        const res = await createMailTemplate({ name, description, doc });
        if (!res.ok) return writeError(res);
        await recordAdminAccess({ action: "template.create", detail: { id: res.template.id, starter: starter?.key ?? null } }, req);
        return adminJson({ template: res.template });
      }

      case "save": {
        const current = await getMailTemplate(id);
        if (!current) return adminJsonError("not_found", "Vorlage nicht gefunden.", 404);
        const name = cleanTemplateName(body.name);
        if (!name) return adminJsonError("bad_request", "Name mit 3–80 Zeichen angeben.", 400);
        const description = cleanTemplateDescription(body.description);
        if (description === undefined) return adminJsonError("bad_request", "Beschreibung zu lang (max. 300 Zeichen).", 400);
        if (JSON.stringify(body.doc ?? {}).length > 400_000) return adminJsonError("too_large", "Die Vorlage ist zu groß.", 413);
        const doc = normalizeMailTemplateDoc(body.doc);
        // A template that is the design of personal mails must keep Mo's text.
        if (docSupportsPersonal(current.doc) && !docSupportsPersonal(doc)) {
          const usage = await templateUsage(id);
          if (usage.kinds.length > 0 || usage.campaigns.length > 0) {
            return adminJsonError(
              "in_use",
              "Diese Vorlage ist als Design für persönliche Mails im Einsatz — der Baustein „Mos persönlicher Text“ muss bleiben.",
              409
            );
          }
        }
        const expected = Number.isInteger(body.expectedVersion) ? Number(body.expectedVersion) : null;
        const res = await updateMailTemplate(id, { name, description, doc }, expected);
        if (!res.ok) return writeError(res);
        await recordAdminAccess({ action: "template.save", detail: { id, version: res.template.version } }, req);
        return adminJson({ template: res.template });
      }

      case "duplicate": {
        const current = await getMailTemplate(id);
        if (!current) return adminJsonError("not_found", "Vorlage nicht gefunden.", 404);
        const name = `${current.name} (Kopie)`.slice(0, 80);
        const res = await createMailTemplate({ name, description: current.description, doc: current.doc });
        if (!res.ok) return writeError(res);
        await recordAdminAccess({ action: "template.duplicate", detail: { from: id, id: res.template.id } }, req);
        return adminJson({ template: res.template });
      }

      case "archive": {
        const archived = body.archived === true;
        if (archived) {
          const usage = await templateUsage(id);
          if (usage.kinds.length > 0) {
            return adminJsonError(
              "in_use",
              "Diese Vorlage ist in Einstellungen als Design ausgewählt — dort zuerst ein anderes Design wählen.",
              409
            );
          }
        }
        const res = await setMailTemplateArchived(id, archived);
        if (!res.ok) return writeError(res);
        await recordAdminAccess({ action: archived ? "template.archive" : "template.restore", detail: { id } }, req);
        return adminJson({ template: res.template });
      }

      case "import": {
        const parsed = parseTemplateImport(body.file);
        if (!parsed.ok) return adminJsonError("bad_request", parsed.message, 400);
        const res = await createMailTemplate({ name: parsed.name, description: parsed.description, doc: parsed.doc });
        if (!res.ok) return writeError(res);
        await recordAdminAccess({ action: "template.import", detail: { id: res.template.id } }, req);
        return adminJson({ template: res.template });
      }

      default:
        return adminJsonError("bad_request", "Unbekannte Aktion.", 400);
    }
  } catch (err) {
    reportError(err, { route: "api/admin/vorlagen", phase: action });
    return adminJsonError("internal_error", "Die Aktion ist fehlgeschlagen.", 500);
  }
}
