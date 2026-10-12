// POST /api/admin/email-designs/preview — render the sample email of one
// email type inside one registered design and return raw text/html for the
// EmailPreviewButton iframe. Body: { designKey: string, kind: EmailThemeKind,
// sample?: "items" | "set" } — `sample` picks the item mail (default) or the
// set mail for marketing / campaign (a mail is one or the other).
//
// The sample renders through the REAL production composers with fake data
// (email-design-preview.ts), so the preview per design × type is exactly what
// a real send would look like. Nothing is stored or sent.

import { guardAdminPost, adminJsonError, adminEmailHtml } from "@/lib/admin-api";
import {
  designSupportsKind,
  isKnownEmailDesign,
  resolveEmailDesignForKind,
  type EmailDesignKind,
} from "@/lib/email-designs/registry";
import {
  parseEmailDesignPreviewSample,
  renderEmailDesignPreview,
  type EmailDesignPreviewSample,
} from "@/lib/email-design-preview";
import { parseEmailThemeKind } from "@/lib/email-theme.mjs";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let kind: EmailDesignKind;
  let designKey: string;
  let sample: EmailDesignPreviewSample;
  try {
    const body = (await req.json()) as { designKey?: unknown; kind?: unknown; sample?: unknown };
    sample = parseEmailDesignPreviewSample(body.sample);
    const parsedKind = parseEmailThemeKind(body.kind);
    if (!parsedKind) {
      return adminJsonError("bad_request", "Unbekannter E-Mail-Typ.", 400);
    }
    kind = parsedKind as EmailDesignKind;
    if (typeof body.designKey !== "string" || !isKnownEmailDesign(body.designKey)) {
      return adminJsonError("not_found", "Design nicht gefunden.", 404);
    }
    designKey = body.designKey;
    if (!designSupportsKind(designKey, kind)) {
      return adminJsonError(
        "bad_request",
        "Dieses Design unterstützt den gewählten E-Mail-Typ nicht.",
        400
      );
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const design = resolveEmailDesignForKind(designKey, kind);
    const html = await renderEmailDesignPreview(kind, design, sample);
    return adminEmailHtml(html);
  } catch (err) {
    reportError(err, { route: "api/admin/email-designs/preview" });
    return adminJsonError("internal_error", "Vorschau fehlgeschlagen.", 500);
  }
}
