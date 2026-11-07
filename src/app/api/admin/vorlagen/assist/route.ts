// POST /api/admin/vorlagen/assist
//   { instruction, doc?, use: "bulk" | "personal" | "template", screenshot?: { base64, mediaType } }
//   → { doc, notes }
//
// „Mit KI gestalten“ in the template and Rundmail editor
// (lib/mail-template-assist.ts). Only PROPOSES: nothing is stored — the
// editor shows the document as an unsaved change. A screenshot (≤ 3 MB as
// base64) lets the AI rebuild an existing mail's layout. Metered in ai_usage
// (template_assist); audit-logged (template.assist).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { assistMailTemplate } from "@/lib/mail-template-assist";
import { reportError } from "@/lib/observability";

export const maxDuration = 120;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return adminJsonError("bad_request", "Ungültige Anfrage (kein JSON).", 400);
  }
  const use = body.use === "personal" || body.use === "bulk" ? body.use : "template";
  const raw = body.screenshot as { base64?: unknown; mediaType?: unknown } | null | undefined;
  const screenshot =
    raw && typeof raw.base64 === "string" && typeof raw.mediaType === "string"
      ? { base64: raw.base64.replace(/^data:[^,]*,/, ""), mediaType: raw.mediaType }
      : null;
  if (screenshot && screenshot.base64.length > 4_000_000) {
    return adminJsonError("too_large", "Das Bild ist zu groß (max. etwa 3 MB).", 413);
  }
  try {
    const res = await assistMailTemplate({
      instruction: typeof body.instruction === "string" ? body.instruction : "",
      doc: body.doc ?? null,
      use,
      screenshot,
    });
    if (!res.ok) return adminJsonError("assist_failed", res.message, 422);
    await recordAdminAccess({ action: "template.assist", detail: { use, screenshot: Boolean(screenshot) } }, req);
    return adminJson(res);
  } catch (err) {
    reportError(err, { route: "api/admin/vorlagen/assist" });
    return adminJsonError("internal_error", "Die KI-Gestaltung ist fehlgeschlagen.", 500);
  }
}
