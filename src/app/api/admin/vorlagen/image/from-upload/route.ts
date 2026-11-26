// POST /api/admin/vorlagen/image/from-upload   { pathname } → { url, width, height, warnings }
//
// The second half of a picture over 4 MB (lib/large-upload.mjs): the file the
// browser uploaded straight to the Blob store (…/image/upload-token) is
// processed like any upload — scaled, an animated GIF shrunk to 2 MB — and the
// temporary file deleted (lib/template-image-large-upload.ts). The answer is
// the one of POST /api/admin/vorlagen/image.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";
import { isTemplateImageUploadConfigured } from "@/lib/mail-template-image";
import { storeLargeTemplateImage } from "@/lib/template-image-large-upload";

// Shrinking a long animated GIF is planned to take at most 150 s (mail-template-gif.mjs); the rest is Blob I/O.
export const maxDuration = 300;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  if (!isTemplateImageUploadConfigured()) {
    return adminJsonError("not_configured", "Bild-Upload nicht eingerichtet (BLOB_READ_WRITE_TOKEN fehlt).", 503);
  }
  let pathname: unknown;
  try {
    pathname = ((await req.json()) as { pathname?: unknown } | null)?.pathname;
  } catch {
    return adminJsonError("bad_request", "Ungültige Anfrage (kein JSON).", 400);
  }
  try {
    const res = await storeLargeTemplateImage(pathname);
    if (!res.ok) return adminJsonError(res.code, res.message, res.status);
    await recordAdminAccess(
      { action: "template.image_upload", detail: { width: res.width, height: res.height, direct: true } },
      req
    );
    return adminJson({ url: res.url, width: res.width, height: res.height, warnings: res.warnings });
  } catch (err) {
    reportError(err, { route: "api/admin/vorlagen/image/from-upload" });
    return adminJsonError("internal_error", "Das Bild konnte nicht hochgeladen werden.", 500);
  }
}
