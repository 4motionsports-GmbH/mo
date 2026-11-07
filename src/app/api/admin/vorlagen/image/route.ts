// POST /api/admin/vorlagen/image   body: the picture's raw bytes
//   Content-Type image/jpeg | image/png | image/webp | image/gif
//   → { url, width, height, warnings }
//
// A picture for a template or Rundmail block (banner, photo, animated GIF):
// processed and stored by lib/mail-template-image.ts, delivered publicly by
// /api/email-hero-image/<file>. Writes nothing to the database — the editor
// puts the URL into the block, „Speichern“ stores it with the document.
// Transport: ONE raw binary body (Vercel caps a request at 4.5 MB). CSRF:
// guardAdminPost with an exact list of image types (none CORS-safelisted).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";
import {
  TEMPLATE_IMAGE_CONTENT_TYPES,
  TEMPLATE_IMAGE_MAX_BYTES,
  isTemplateImageUploadConfigured,
  storeTemplateImage,
} from "@/lib/mail-template-image";

export const maxDuration = 60;

async function readBodyCapped(req: Request, max: number): Promise<Buffer | null> {
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req, { accept: TEMPLATE_IMAGE_CONTENT_TYPES });
  if (blocked) return blocked;
  if (!isTemplateImageUploadConfigured()) {
    return adminJsonError("not_configured", "Bild-Upload nicht eingerichtet (BLOB_READ_WRITE_TOKEN fehlt).", 503);
  }
  try {
    const bytes = await readBodyCapped(req, TEMPLATE_IMAGE_MAX_BYTES);
    if (!bytes) return adminJsonError("too_large", "Das Bild ist größer als 4 MB — bitte verkleinern.", 413);
    if (bytes.length === 0) return adminJsonError("bad_request", "Kein Bild empfangen.", 400);
    const res = await storeTemplateImage(bytes);
    if (!res.ok) return adminJsonError(res.code, res.message, res.status);
    await recordAdminAccess({ action: "template.image_upload", detail: { width: res.width, height: res.height } }, req);
    return adminJson({ url: res.url, width: res.width, height: res.height, warnings: res.warnings });
  } catch (err) {
    reportError(err, { route: "api/admin/vorlagen/image" });
    return adminJsonError("internal_error", "Das Bild konnte nicht hochgeladen werden.", 500);
  }
}
