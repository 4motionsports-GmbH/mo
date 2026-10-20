// Shared guards for the /api/admin/* route handlers.
//
// Middleware already blocks unauthenticated requests to /api/admin/*, but the
// handlers re-assert auth here (defense in depth — a route must never depend on
// an upstream check alone) and enforce a lightweight CSRF defense:
//
//   - The session cookie is the only credential, so a cross-site form POST could
//     in principle ride it. We require Content-Type: application/json, which the
//     browser cannot send cross-origin without a CORS preflight the admin origin
//     would reject — so only same-origin fetch() calls get through.
//   - A route that takes a raw binary body (the Kampagnenbild upload) passes
//     `accept` with its exact media types instead (image/jpeg, image/png,
//     image/webp). None of them is CORS-safelisted either, so the same preflight
//     protection holds; text/plain, multipart/form-data and form-urlencoded —
//     the types a cross-site form or a no-preflight fetch can send — are refused
//     even if a caller lists one. The rule is admin-content-type.mjs (tested).

import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, verifyAdminSessionToken } from "./admin-auth";
import { isAcceptedAdminContentType } from "./admin-content-type.mjs";
import { neutralizeRecipientLinks } from "./email-preview-links.mjs";

function jsonError(code: string, message: string, status: number): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Guard a state-changing admin POST. Returns a Response to short-circuit with
 * (401 / 415), or null when the request is an authenticated, same-origin JSON
 * call and the handler may proceed. `accept` replaces the JSON rule with an
 * exact list of (non-safelisted) media types — for a raw binary body.
 */
export async function guardAdminPost(
  req: Request,
  opts: { accept?: readonly string[] } = {}
): Promise<Response | null> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!isAcceptedAdminContentType(contentType, opts.accept)) {
    return opts.accept
      ? jsonError(
          "unsupported_media_type",
          `Dateityp nicht unterstützt (erwartet: ${opts.accept.join(", ")}).`,
          415
        )
      : jsonError("unsupported_media_type", "Expected application/json", 415);
  }
  const token = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
  if (!(await verifyAdminSessionToken(token))) {
    return jsonError("unauthorized", "Admin authentication required", 401);
  }
  return null;
}

/**
 * Guard a non-mutating admin GET (e.g. a file download). The proxy already gates
 * /api/admin/*; this re-asserts the session cookie defensively (no CSRF / content-
 * type constraint — a GET carries no body). Returns a 401 Response or null.
 */
export async function guardAdminGet(): Promise<Response | null> {
  const token = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
  if (!(await verifyAdminSessionToken(token))) {
    return jsonError("unauthorized", "Admin authentication required", 401);
  }
  return null;
}

/** JSON success helper mirroring the error envelope shape. */
export function adminJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export { jsonError as adminJsonError };

/**
 * A rendered e-mail for an admin preview iframe. Links that would act on the
 * real recipient (unsubscribe, erase, DOI, tracked clicks) are made inert —
 * a click in the admin must never unsubscribe or delete a customer.
 */
export function adminEmailHtml(html: string): Response {
  return new Response(neutralizeRecipientLinks(html), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
