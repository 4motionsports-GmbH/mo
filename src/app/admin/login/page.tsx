// /admin/login — the only unauthenticated admin page (allow-listed in the
// proxy). A server action validates ADMIN_PASSWORD, mints a signed HTTP-only
// session cookie, and redirects into the dashboard. No password ever reaches the
// client beyond the form POST; the check runs entirely server-side.
//
// Styling uses the admin design system (themed via ../theme.css, loaded by the
// admin layout). The auth flow itself is unchanged.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ADMIN_COOKIE_NAME,
  createAdminSessionToken,
  isAdminAuthConfigured,
  isAdminPasswordValid,
  sessionCookieOptions,
} from "@/lib/admin-auth";
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

async function loginAction(formData: FormData): Promise<void> {
  "use server";
  const password = formData.get("password");
  if (!(await isAdminPasswordValid(password))) {
    redirect("/admin/login?error=invalid");
  }
  const token = await createAdminSessionToken();
  if (!token) {
    // Password was right but we can't sign a cookie (no secret configured).
    redirect("/admin/login?error=config");
  }
  const store = await cookies();
  store.set(ADMIN_COOKIE_NAME, token, sessionCookieOptions());
  redirect("/admin");
}

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const configured = isAdminAuthConfigured();

  const message =
    error === "invalid"
      ? "Falsches Passwort."
      : error === "config"
        ? "Server nicht konfiguriert (ADMIN_SESSION_SECRET fehlt)."
        : null;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-[360px] max-w-[90vw] shadow-md">
        <CardHeader>
          <CardTitle className="text-lg">motion sports — Admin</CardTitle>
          <CardDescription>Marketing-Dashboard. Bitte anmelden.</CardDescription>
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
