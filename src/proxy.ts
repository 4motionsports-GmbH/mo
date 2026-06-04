// Server-side gate for the admin dashboard. Runs on the Edge runtime before any
// /admin page or /api/admin/* route renders, so protection is NEVER client-side
// only: an unauthenticated request is stopped here.
//
//   - /admin/login is the single public exception (you must be able to reach the
//     form to log in). Its POST (the login server action) is also allowed.
//   - Any other /admin/* page without a valid session → 302 redirect to login.
//   - Any /api/admin/* route without a valid session → 401 JSON.
//
// Session verification is the stateless HMAC check in lib/admin-auth (Web Crypto,
// Edge-safe). Route handlers re-assert auth defensively via guardAdminPost().
//
// This is the Next.js 16 "proxy" file convention (the former "middleware").

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ADMIN_COOKIE_NAME, verifyAdminSessionToken } from "@/lib/admin-auth";

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // The login page (and its server-action POST to the same path) is the only
  // route reachable without a session.
  if (pathname === "/admin/login") {
    return NextResponse.next();
  }

  const token = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
  if (await verifyAdminSessionToken(token)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return new NextResponse(
      JSON.stringify({ error: { code: "unauthorized", message: "Admin authentication required" } }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/admin/login";
  loginUrl.search = "";
  return NextResponse.redirect(loginUrl);
}
