// Admin layout — the ONLY place the admin design system (Tailwind + tokens) is
// loaded. Importing ./theme.css here scopes it to /admin/* in the App Router, so
// the public widget (/) and the /api/* routes are never affected.
//
// Theme: the chosen light/dark theme is read from a cookie and applied as the
// `.dark` class on #admin-root ON THE SERVER, so the first paint already matches
// (no flash). When no cookie exists yet, the inline init script falls back to
// the OS preference before the subtree paints.

import "./theme.css";
import { cookies } from "next/headers";
import localFont from "next/font/local";
import { THEME_COOKIE, THEME_INIT_SCRIPT } from "./theme-config";

// Montserrat is self-hosted (vendored variable woff2, latin subset incl. äöüß)
// rather than fetched from Google Fonts: it removes the build-time network
// dependency and avoids leaking visitor IPs to Google at runtime — relevant for
// this GDPR-conscious app.
const montserrat = localFont({
  src: "./fonts/montserrat-latin.woff2",
  weight: "100 900",
  variable: "--font-montserrat",
  display: "swap",
});

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const theme = cookieStore.get(THEME_COOKIE)?.value;
  const isDark = theme === "dark";

  return (
    <div
      id="admin-root"
      className={`admin-root ${montserrat.variable}${isDark ? " dark" : ""}`}
    >
      {/* Render-blocking: applies cookie/OS theme before the subtree paints. */}
      <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      {children}
    </div>
  );
}
