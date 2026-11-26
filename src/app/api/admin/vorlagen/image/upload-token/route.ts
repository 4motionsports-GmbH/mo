// POST /api/admin/vorlagen/image/upload-token
//   { type: "blob.generate-client-token", payload: { pathname, … } } → { type, clientToken }
//
// The first half of a picture over 4 MB (lib/large-upload.mjs): the token for
// the browser's direct upload to the Blob store — @vercel/blob/client
// `upload()` asks for it with a same-origin JSON POST. Exactly one temporary
// pathname, picture types, at most 25 MB, 15 minutes
// (lib/template-image-large-upload.ts). Then POST …/image/from-upload.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isTemplateImageUploadConfigured } from "@/lib/mail-template-image";
import { largeUploadToken } from "@/lib/template-image-large-upload";

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  if (!isTemplateImageUploadConfigured()) {
    return adminJsonError("not_configured", "Bild-Upload nicht eingerichtet (BLOB_READ_WRITE_TOKEN fehlt).", 503);
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return adminJsonError("bad_request", "Ungültige Anfrage (kein JSON).", 400);
  }
  const res = await largeUploadToken(req, body);
  if (!res.ok) return adminJsonError(res.code, res.message, res.status);
  return adminJson(res.json);
}
