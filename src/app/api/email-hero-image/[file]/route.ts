// GET /api/email-hero-image/<file> — serves a generated email hero image.
//
// PUBLIC BY NECESSITY: mail clients fetch hero images anonymously out of the
// recipient's inbox, so this route carries no session or widget guard. It is
// safe because of what it CANNOT do:
//   - it only ever reads `email-heroes/<file>` (HERO_BLOB_PREFIX), and
//   - `parseHeroBlobFile` rejects separators, traversal and non-image names,
// so the private catalog/embedding blobs in the same store stay unreachable.
//
// The image itself is written privately (the store is private — see
// email-hero-blob.mjs) and streamed back here with a long immutable cache:
// filenames carry a random suffix, so a stored image never changes.

import { get } from "@vercel/blob";
import {
  heroBlobContentType,
  heroBlobPathname,
  parseHeroBlobFile,
} from "@/lib/email-hero-blob.mjs";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const safeFile = parseHeroBlobFile(file);
  if (!safeFile) return notFound();

  try {
    const res = await get(heroBlobPathname(safeFile), {
      access: "private",
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    if (!res || res.statusCode !== 200) return notFound();
    return new Response(res.stream as unknown as BodyInit, {
      status: 200,
      headers: {
        // generateHeroImage writes JPEG (PNG before the mobile variant
        // shipped); the stored blob's own type wins, the extension is the
        // fallback.
        "Content-Type": res.blob?.contentType || heroBlobContentType(safeFile),
        // Immutable: the filename carries a random suffix, so this byte stream
        // never changes — mail-client and CDN caches may keep it indefinitely.
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    reportError(err, { route: "api/email-hero-image" });
    return notFound();
  }
}
