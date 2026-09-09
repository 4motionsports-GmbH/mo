// /admin/login — the only unauthenticated admin page (allow-listed in the
// proxy). A server action validates ADMIN_PASSWORD, mints a signed HTTP-only
// session cookie, and redirects into the dashboard. No password ever reaches the
// client beyond the form POST; the check runs entirely server-side.
//
// Styling uses the admin design system (themed via ../theme.css, loaded by the
// admin layout). The auth flow itself is unchanged.

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  ADMIN_COOKIE_NAME,
  createAdminSessionToken,
  isAdminAuthConfigured,
  isAdminPasswordValid,
  sessionCookieOptions,
} from "@/lib/admin-auth";
import { safeAdminNext } from "@/lib/admin-login-redirect.mjs";
import { checkRateLimitKeyed } from "@/lib/rate-limit";
import { reportError } from "@/lib/observability";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "../ui/card";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Button } from "../ui/button";

export const dynamic = "force-dynamic";

/**
 * Attempt limit per client IP (decision D-7): 10 / 10 min. Fails OPEN when the
 * limiter itself is unavailable (no KV configured, Upstash down) — a broken
 * limiter must never lock the operator out; the failure is reported.
 */
async function loginRateLimited(): Promise<boolean> {
  try {
    const h = await headers();
    const ip =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
    const rl = await checkRateLimitKeyed("admin-login", `ip:${ip}`);
    return !rl.ok;
  } catch (err) {
    reportError(err, { route: "admin/login", phase: "rate-limit" });
    return false;
  }
}

async function loginAction(formData: FormData): Promise<void> {
  "use server";
  const password = formData.get("password");
  // Where to land after login — only ever a path inside /admin (sanitised), so
  // an expired session returns the operator to the screen they were on.
  const next = safeAdminNext(formData.get("next"));
  const nextQuery = next === "/admin" ? "" : `&next=${encodeURIComponent(next)}`;
  if (await loginRateLimited()) {
    redirect(`/admin/login?error=ratelimited${nextQuery}`);
  }
  if (!(await isAdminPasswordValid(password))) {
    redirect(`/admin/login?error=invalid${nextQuery}`);
  }
  const token = await createAdminSessionToken();
  if (!token) {
    // Password was right but we can't sign a cookie (no secret configured).
    redirect(`/admin/login?error=config${nextQuery}`);
  }
  const store = await cookies();
  store.set(ADMIN_COOKIE_NAME, token, sessionCookieOptions());
  redirect(next);
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next: rawNext } = await searchParams;
  const next = safeAdminNext(rawNext);
  const configured = isAdminAuthConfigured();

  const message =
    error === "invalid"
      ? "Falsches Passwort."
      : error === "ratelimited"
        ? "Zu viele Anmeldeversuche — bitte in zehn Minuten erneut versuchen."
        : error === "config"
          ? "Server nicht konfiguriert (ADMIN_SESSION_SECRET fehlt)."
          : null;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-[360px] max-w-[90vw] shadow-md">
        <CardHeader>
          <div className="mb-2 flex items-center gap-3">
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
              aria-hidden
            >
              M
            </span>
            <div>
              <CardTitle className="text-lg">motion sports</CardTitle>
              <CardDescription>Admin · Mo — bitte anmelden.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!configured && (
            <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              ADMIN_PASSWORD / ADMIN_SESSION_SECRET sind nicht gesetzt — Login ist
              deaktiviert.
            </p>
          )}

          {message && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {message}
            </p>
          )}

          <form action={loginAction} className="flex flex-col gap-4">
            {next !== "/admin" && <input type="hidden" name="next" value={next} />}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Passwort</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                autoFocus
              />
            </div>
            <Button type="submit" className="w-full">
              Anmelden
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
