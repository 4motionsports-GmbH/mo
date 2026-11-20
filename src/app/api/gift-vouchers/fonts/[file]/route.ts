// GET /api/gift-vouchers/fonts/<file> — the voucher's handwriting font (Caveat,
// SIL OFL, bundled in src/assets/fonts) for the live preview on the voucher
// page (spec §8.2). The shop loads no Google Fonts (GDPR: no visitor IP to a
// third party), so the page's @font-face points here.
//
// A strict allowlist (gift-voucher-storefront.mjs GIFT_VOUCHER_FONT_FILES): the
// requested name only selects one of the fixed paths below and never becomes
// part of a path itself. A file that is not there (yet) is a plain 404.
// Origin allowlist + the `products` rate limit, no secret; cached for a year
// (the files never change under their name).
//
// Bundling on Vercel: the fonts are read from disk at runtime, so this route
// needs `outputFileTracingIncludes` for src/assets/fonts in next.config (the
// renderer's routes need the same).

import { readFile } from "node:fs/promises";
import path from "node:path";
import { corsHeaders, guardOriginOnly, preflightResponse } from "@/lib/security";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";
import { isGiftVoucherFontFile } from "@/lib/gift-voucher-storefront.mjs";

export const maxDuration = 10;

const METHODS = "GET, OPTIONS";

// One literal path per allowed file (also lets the file tracer see them).
const FONT_PATHS = {
  "caveat-500.ttf": path.join(process.cwd(), "src/assets/fonts/caveat-500.ttf"),
  "caveat-700.ttf": path.join(process.cwd(), "src/assets/fonts/caveat-700.ttf"),
} as const;

// Per instance: a font is read from disk once.
const loaded = new Map<string, Buffer>();

async function loadFont(file: keyof typeof FONT_PATHS): Promise<Buffer | null> {
  const cached = loaded.get(file);
  if (cached) return cached;
  try {
    const bytes = await readFile(FONT_PATHS[file]);
    loaded.set(file, bytes);
    return bytes;
  } catch (err) {
    // Missing is expected until the files are deployed; anything else is ours.
    if ((err as { code?: unknown } | null)?.code !== "ENOENT") {
      reportError(err, { route: "api/gift-vouchers/fonts", phase: "read", file });
    }
    return null;
  }
}

export async function OPTIONS(req: Request) {
  return preflightResponse(req, METHODS);
}

export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  const guard = guardOriginOnly(req);
  if (!guard.ok) return guard.response;
  const cors = corsHeaders(guard.origin, METHODS);

  try {
    const rl = await checkRateLimit(req, "products");
    if (!rl.ok) return rateLimitResponse(rl.retryAfter, cors);

    const { file } = await ctx.params;
    const bytes = isGiftVoucherFontFile(file) ? await loadFont(file) : null;
    if (!bytes) return errorResponse("not_found", "Not found", 404, cors);

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "font/ttf",
        "Content-Length": String(bytes.length),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        ...cors,
      },
    });
  } catch (err) {
    reportError(err, { route: "api/gift-vouchers/fonts" });
    return errorResponse("internal_error", "Unexpected server error", 500, cors);
  }
}
