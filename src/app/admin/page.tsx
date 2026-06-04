// /admin — the marketing dashboard (server-rendered). Protected by the proxy;
// this page is only ever reached with a valid admin session.
//
// CUSTOMERS / MARKETING tab: lists marketing-eligible contacts (DOI confirmed,
// not unsubscribed, not suppressed), each with their conversation transcript,
// persona, discussed products, and the "chatted but not purchased" flag. The
// per-contact draft / edit / approve-&-send workflow lives in CustomerCard.
//
// The KPI tab is intentionally NOT built yet (next session).

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE_NAME } from "@/lib/admin-auth";
import { isDbConfigured } from "@/lib/db";
import { listMarketingTargets } from "@/lib/marketing-store";
import { CustomerCard } from "./CustomerCard";

export const dynamic = "force-dynamic";

async function logoutAction(): Promise<void> {
  "use server";
  const store = await cookies();
  store.delete(ADMIN_COOKIE_NAME);
  redirect("/admin/login");
}

export default async function AdminDashboardPage() {
  const dbReady = isDbConfigured();
  const targets = dbReady ? await listMarketingTargets() : [];

  const notPurchased = targets.filter((t) => t.purchase.status === "no_purchase").length;

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        color: "#111",
        background: "#fafafa",
        minHeight: "100vh",
        padding: "24px 20px 64px",
      }}
    >
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <div>
            <h1 style={{ fontSize: 22, margin: 0 }}>Marketing-Dashboard</h1>
            <p style={{ fontSize: 13, color: "#666", margin: "4px 0 0" }}>
              Kunden &amp; Marketing · Nur bestätigte (DOI), nicht abgemeldete Kontakte
            </p>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              style={{
                fontSize: 13,
                padding: "8px 14px",
                border: "1px solid #ddd",
                background: "#fff",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              Abmelden
            </button>
          </form>
        </header>

        {/* Tabs — only the Customers/Marketing tab is live this session. */}
        <nav style={{ display: "flex", gap: 8, margin: "16px 0 20px" }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              padding: "8px 14px",
              background: "#111",
              color: "#fff",
              borderRadius: 999,
            }}
          >
            Kunden / Marketing
          </span>
          <span
            style={{
              fontSize: 13,
              padding: "8px 14px",
              background: "#fff",
              color: "#999",
              border: "1px solid #eee",
              borderRadius: 999,
            }}
            title="Nächste Session"
          >
            KPIs (bald)
          </span>
        </nav>

        {!dbReady && (
          <Banner tone="warn">
            Keine Datenbank konfiguriert (DATABASE_URL) — es können keine Kontakte
            geladen werden.
          </Banner>
        )}

        {dbReady && targets.length === 0 && (
          <Banner tone="info">
            Noch keine marketing-berechtigten Kontakte. Sobald Nutzer die
            Marketing-Einwilligung per Double-Opt-In bestätigen, erscheinen sie hier.
          </Banner>
        )}

        {targets.length > 0 && (
          <p style={{ fontSize: 13, color: "#666", margin: "0 0 16px" }}>
            {targets.length} Kontakt(e) · <strong>{notPurchased}</strong> „beraten,
            aber (noch) nicht gekauft" — die wichtigste Marketing-Zielgruppe.
          </p>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {targets.map((t) => (
            <CustomerCard key={t.captureId} target={t} />
          ))}
        </div>
      </div>
    </main>
  );
}

function Banner({ tone, children }: { tone: "warn" | "info"; children: React.ReactNode }) {
  const bg = tone === "warn" ? "#fef3c7" : "#eff6ff";
  const fg = tone === "warn" ? "#92400e" : "#1e40af";
  return (
    <div
      style={{
        background: bg,
        color: fg,
        fontSize: 13,
        padding: "12px 14px",
        borderRadius: 10,
        marginBottom: 16,
      }}
    >
      {children}
    </div>
  );
}
