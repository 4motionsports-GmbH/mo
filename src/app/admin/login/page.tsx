// /admin/login — the only unauthenticated admin page (allow-listed in
// middleware). A server action validates ADMIN_PASSWORD, mints a signed
// HTTP-only session cookie, and redirects into the dashboard. No password ever
// reaches the client beyond the form POST; the check runs entirely server-side.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  ADMIN_COOKIE_NAME,
  createAdminSessionToken,
  isAdminAuthConfigured,
  isAdminPasswordValid,
  sessionCookieOptions,
} from "@/lib/admin-auth";

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
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#fafafa",
        color: "#111",
      }}
    >
      <div
        style={{
          background: "#fff",
          width: 360,
          maxWidth: "90vw",
          padding: "32px 28px",
          borderRadius: 14,
          boxShadow: "0 1px 3px rgba(0,0,0,.08)",
        }}
      >
        <h1 style={{ fontSize: 18, margin: "0 0 4px" }}>motion sports — Admin</h1>
        <p style={{ fontSize: 13, color: "#666", margin: "0 0 20px" }}>
          Marketing-Dashboard. Bitte anmelden.
        </p>

        {!configured && (
          <p
            style={{
              fontSize: 13,
              color: "#92400e",
              background: "#fef3c7",
              padding: "8px 10px",
              borderRadius: 8,
              margin: "0 0 16px",
            }}
          >
            ADMIN_PASSWORD / ADMIN_SESSION_SECRET sind nicht gesetzt — Login ist
            deaktiviert.
          </p>
        )}

        {message && (
          <p
            style={{
              fontSize: 13,
              color: "#b91c1c",
              background: "#fee2e2",
              padding: "8px 10px",
              borderRadius: 8,
              margin: "0 0 16px",
            }}
          >
            {message}
          </p>
        )}

        <form action={loginAction}>
          <label
            htmlFor="password"
            style={{ display: "block", fontSize: 13, marginBottom: 6 }}
          >
            Passwort
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "10px 12px",
              fontSize: 14,
              border: "1px solid #ddd",
              borderRadius: 8,
              marginBottom: 16,
            }}
          />
          <button
            type="submit"
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: 14,
              fontWeight: 600,
              color: "#fff",
              background: "#111",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Anmelden
          </button>
        </form>
      </div>
    </main>
  );
}
