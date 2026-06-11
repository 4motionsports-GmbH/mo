// /admin — the back-office dashboard (server-rendered). Protected by the proxy;
// this page is only ever reached with a valid admin session.
//
// Three tabs, switched by the `?tab=` query param (kept server-rendered — no
// client router needed):
//   - MARKETING (default): marketing-eligible contacts (DOI confirmed, not
//     unsubscribed, not suppressed), each with transcript, persona, discussed
//     products, the "chatted but not purchased" flag and the draft/send workflow
//     (see CustomerCard).
//   - KUNDEN: grouped by CUSTOMER (email), not by session — session timeline,
//     purchase history, persona(s) and the regenerated "current understanding"
//     summary (see CustomerProfileCard). Returning customers are marked.
//   - KPIs: aggregate analytics over conversations / messages / kpi_events plus
//     a recommendation→purchase loop (see KpiTab).

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE_NAME } from "@/lib/admin-auth";
import { isDbConfigured } from "@/lib/db";
import { listMarketingTargets } from "@/lib/marketing-store";
import { listCustomersWithSessions } from "@/lib/customer-store";
import { ARCHETYPE_META } from "@/lib/persona";
import type { PersonaArchetype } from "@/lib/types";
import { CustomerCard } from "./CustomerCard";
import { CustomerProfileCard, type CustomerProps } from "./CustomerProfileCard";
import { KpiTab } from "./KpiTab";

export const dynamic = "force-dynamic";

type Tab = "customers" | "kunden" | "kpi";

async function logoutAction(): Promise<void> {
  "use server";
  const store = await cookies();
  store.delete(ADMIN_COOKIE_NAME);
  redirect("/admin/login");
}

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const tab: Tab = sp?.tab === "kpi" ? "kpi" : sp?.tab === "kunden" ? "kunden" : "customers";
  const dbReady = isDbConfigured();

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
            <h1 style={{ fontSize: 22, margin: 0 }}>Admin-Dashboard</h1>
            <p style={{ fontSize: 13, color: "#666", margin: "4px 0 0" }}>
              {tab === "kpi"
                ? "KPIs · Pseudonyme Analytics (Cluster A) + Shopify-Käufe"
                : tab === "kunden"
                  ? "Kunden · Gruppiert nach Person (E-Mail) — Sessions, Käufe & Kundenverständnis"
                  : "Marketing · Nur bestätigte (DOI), nicht abgemeldete Kontakte"}
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

        <nav style={{ display: "flex", gap: 8, margin: "16px 0 20px" }}>
          <TabLink label="Marketing" href="/admin" active={tab === "customers"} />
          <TabLink label="Kunden" href="/admin?tab=kunden" active={tab === "kunden"} />
          <TabLink label="KPIs" href="/admin?tab=kpi" active={tab === "kpi"} />
        </nav>

        {tab === "kpi" ? (
          <KpiTab dbReady={dbReady} />
        ) : tab === "kunden" ? (
          <KundenTab dbReady={dbReady} />
        ) : (
          <CustomersTab dbReady={dbReady} />
        )}
      </div>
    </main>
  );
}

async function CustomersTab({ dbReady }: { dbReady: boolean }) {
  const targets = dbReady ? await listMarketingTargets() : [];
  const notPurchased = targets.filter((t) => t.purchase.status === "no_purchase").length;

  return (
    <>
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
          {targets.length} Kontakt(e) · <strong>{notPurchased}</strong> &bdquo;beraten,
          aber (noch) nicht gekauft&ldquo; — die wichtigste Marketing-Zielgruppe.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {targets.map((t) => (
          <CustomerCard key={t.captureId} target={t} />
        ))}
      </div>
    </>
  );
}

// The customer view: grouped by PERSON (email), not by session. A customer
// exists only because an email was captured with consent; anonymous sessions
// never appear here.
async function KundenTab({ dbReady }: { dbReady: boolean }) {
  const customers = dbReady ? await listCustomersWithSessions() : [];
  const returning = customers.filter((c) => c.sessions.length > 1).length;

  const personaDisplay = (label: string | null): string | null => {
    if (!label) return null;
    const meta = ARCHETYPE_META[label as PersonaArchetype];
    return meta ? meta.label : label;
  };

  // Strip to the serialisable shape the client card needs (no session ids —
  // the browser doesn't need the pseudonymous keys).
  const cards: CustomerProps[] = customers.map((c) => ({
    id: c.id,
    email: c.email,
    firstSeenAt: c.firstSeenAt,
    lastSeenAt: c.lastSeenAt,
    transactionalConsent: c.transactionalConsent,
    marketingStatus: c.marketingStatus,
    profileSummary: c.profileSummary,
    profileSummaryUpdatedAt: c.profileSummaryUpdatedAt,
    purchaseSummary: c.purchaseSummary,
    purchaseSummaryUpdatedAt: c.purchaseSummaryUpdatedAt,
    sessions: c.sessions.map((s) => ({
      conversationId: s.conversationId,
      createdAt: s.createdAt,
      personaDisplay: personaDisplay(s.personaLabel),
      messageCount: s.messageCount,
      transcript: s.transcript,
    })),
  }));

  return (
    <>
      {!dbReady && (
        <Banner tone="warn">
          Keine Datenbank konfiguriert (DATABASE_URL) — es können keine Kunden geladen werden.
        </Banner>
      )}

      {dbReady && cards.length === 0 && (
        <Banner tone="info">
          Noch keine Kunden. Ein Kunde entsteht, sobald jemand im Chat seine E-Mail-Adresse (mit
          Einwilligung) hinterlässt — anonyme Sessions bleiben unverknüpft.
        </Banner>
      )}

      {cards.length > 0 && (
        <p style={{ fontSize: 13, color: "#666", margin: "0 0 16px" }}>
          {cards.length} Kunde(n) · <strong>{returning}</strong> wiederkehrend (mehrere Sessions
          unter derselben E-Mail).
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {cards.map((c) => (
          <CustomerProfileCard key={c.id} customer={c} />
        ))}
      </div>
    </>
  );
}

function TabLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <a
      href={href}
      style={{
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        padding: "8px 14px",
        background: active ? "#111" : "#fff",
        color: active ? "#fff" : "#555",
        border: active ? "1px solid #111" : "1px solid #eee",
        borderRadius: 999,
        textDecoration: "none",
      }}
    >
      {label}
    </a>
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
