// /admin — the back-office dashboard. Auth is enforced by the proxy; this page
// is only ever reached with a valid admin session.
//
// Structure: data for each tab is fetched + rendered on the SERVER (the
// KundenTab / KpiTab / … bodies below) and handed to the client AdminShell, which
// owns the active-tab state, the theme toggle and the Toaster. The initial tab is
// seeded from ?tab= so deep links / refresh land on the right tab, and the shell
// keeps the query param in sync as you switch.
//
//   - ÜBERSICHT (default): aggregate KPIs + quick links (OverviewTab).
//   - KUNDEN: the merged customer + marketing workspace — a compact, searchable,
//     filterable customer list with a per-customer sub-tabbed detail (profile,
//     sessions, purchases, MARKETING e-mail, correspondence, letter) and a
//     bulk-draft action (KundenWorkspace + CustomerProfileCard). The old separate
//     "Marketing" tab is folded in here as a filter preset + per-customer section.
//   - KPIs: aggregate analytics + recommendation→purchase loop (KpiTab).

import { cookies } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { autoCaptureMissingAddresses } from "@/lib/address-capture";
import { ADMIN_COOKIE_NAME } from "@/lib/admin-auth";
import { isDbConfigured } from "@/lib/db";
import {
  listMarketingTargets,
  getLatestSendForEmail,
  type MarketingTarget,
} from "@/lib/marketing-store";
import { listCustomersWithSessions } from "@/lib/customer-store";
import {
  listCustomerMessages,
  listUnmatchedInbound,
} from "@/lib/email-messages-store";
import { listCustomerLetters } from "@/lib/physical-letters-store";
import { physicalEligibilityForCustomer } from "@/lib/physical-mail";
import { listBundleOffersWithSignalsForCustomer } from "@/lib/bundle-offers-store";
import { buildBundleRedirectUrl } from "@/lib/bundle-offers";
import { ARCHETYPE_META } from "@/lib/persona";
import { resolveKpiRange } from "@/lib/kpi-range";
import type { PersonaArchetype } from "@/lib/types";
import type { CustomerProps } from "./CustomerProfileCard";
import { KundenWorkspace } from "./KundenWorkspace";
import { KpiTab } from "./KpiTab";
import { FeedbackTab } from "./FeedbackTab";
import { OverviewTab } from "./OverviewTab";
import { AdminShell, type AdminTab } from "./AdminShell";
import { THEME_COOKIE, type Theme } from "./theme-config";

export const dynamic = "force-dynamic";

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
  // Übersicht is the default landing tab; the others stay reachable via ?tab=.
  // The old "customers" (Marketing) tab is merged into "kunden" — keep its links
  // working by folding it in.
  const initialTab: AdminTab =
    sp?.tab === "kpi"
      ? "kpi"
      : sp?.tab === "feedback"
        ? "feedback"
        : sp?.tab === "kunden" || sp?.tab === "customers"
          ? "kunden"
          : "overview";
  // Overview deep-links seed a Kunden filter preset via ?filter= (e.g.
  // "no_purchase", "marketing"); accept the legacy ?status= as a fallback.
  const initialFilter =
    (typeof sp?.filter === "string" ? sp.filter : undefined) ??
    (typeof sp?.status === "string" ? sp.status : undefined);
  // KPI date-range picker state lives in the URL so a refresh / copied link keeps
  // the window; resolveKpiRange validates + clamps it to a safe [from, to].
  const firstParam = (v: string | string[] | undefined): string | undefined =>
    Array.isArray(v) ? v[0] : v;
  const kpiRange = resolveKpiRange({
    kpiRange: firstParam(sp?.kpiRange),
    kpiFrom: firstParam(sp?.kpiFrom),
    kpiTo: firstParam(sp?.kpiTo),
  });
  const dbReady = isDbConfigured();

  // The marketing targets back BOTH the Marketing tab and the Overview headline
  // KPIs / "not purchased" count — fetch the (Shopify-touching) list once here
  // and hand it to both so the numbers agree and the fan-out isn't doubled.
  const targets: MarketingTarget[] = dbReady ? await listMarketingTargets() : [];

  const store = await cookies();
  const themeCookie = store.get(THEME_COOKIE)?.value;
  const themeInitial: Theme | null =
    themeCookie === "dark" ? "dark" : themeCookie === "light" ? "light" : null;

  return (
    <AdminShell
      initialTab={initialTab}
      themeInitial={themeInitial}
      logoutAction={logoutAction}
      overview={<OverviewTab dbReady={dbReady} targets={targets} />}
      kunden={
        <KundenTab
          dbReady={dbReady}
          initialFilter={initialFilter}
        />
      }
      kpi={<KpiTab dbReady={dbReady} range={kpiRange} />}
      feedback={<FeedbackTab dbReady={dbReady} />}
    />
  );
}

// The merged customer + marketing workspace: grouped by PERSON (email), not by
// session. A customer exists only because an email was captured with consent;
// anonymous sessions never appear here. Renders the master–detail KundenWorkspace
// (compact searchable list + per-customer sub-tabbed detail incl. marketing).
async function KundenTab({
  dbReady,
  initialFilter,
}: {
  dbReady: boolean;
  initialFilter?: string;
}) {
  // Auto-capture missing postal addresses from Shopify in the BACKGROUND (after
  // the response), so the operator never has to press "Käufe aktualisieren" per
  // customer. Bounded + throttled (lib/address-capture); captured addresses show
  // on the next load. Best-effort — never blocks or breaks the render.
  if (dbReady) {
    after(() => autoCaptureMissingAddresses({ limit: 12 }));
  }

  const customers = dbReady ? await listCustomersWithSessions() : [];

  const personaDisplay = (label: string | null): string | null => {
    if (!label) return null;
    const meta = ARCHETYPE_META[label as PersonaArchetype];
    return meta ? meta.label : label;
  };

  // Strip to the serialisable shape the client card needs (no session ids —
  // the browser doesn't need the pseudonymous keys). The latest marketing send
  // (open draft preferred) backs the personalised-email workflow on the card.
  const cards: CustomerProps[] = await Promise.all(
    customers.map(async (c) => {
    const physical = physicalEligibilityForCustomer(c);
    return {
      id: c.id,
      email: c.email,
      // Best display name for the list (Shopify account), else null → show email.
      name:
        c.shopifyAccountSummary?.displayName?.trim() ||
        c.shopifyAccountSummary?.firstName?.trim() ||
        null,
      identityTier: c.identityTier,
      firstSeenAt: c.firstSeenAt,
      lastSeenAt: c.lastSeenAt,
      transactionalConsent: c.transactionalConsent,
      marketingStatus: c.marketingStatus,
      adminInstructions: c.adminInstructions,
      marketingSend: await getLatestSendForEmail(c.email).then((s) =>
        s
          ? {
              id: s.id,
              status: s.status,
              subject: s.subject,
              draftedText: s.draftedText,
              discountPercent: s.discountPercent,
              discountCode: s.discountCode,
              discountExpiresAt: s.discountExpiresAt,
              adminInstructions: s.adminInstructions,
              sentAt: s.sentAt,
            }
          : null
      ),
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
      bundles: (await listBundleOffersWithSignalsForCustomer(c.id)).map((b) => ({
        id: b.id,
        title: b.title,
        status: b.status,
        components: b.components.map((x) => ({
          productId: x.productId,
          title: x.title,
          quantity: x.quantity,
        })),
        componentsSum: b.componentsSum,
        bundlePrice: b.bundlePrice,
        currency: b.currency,
        cartUrl: b.cartUrl,
        redirectUrl: buildBundleRedirectUrl(b.redirectToken),
        createdAt: b.createdAt,
        expiresAt: b.expiresAt,
        error: b.error,
        emailSentAt: b.emailSentAt,
        clicked: b.clicked,
      })),
      // Per-customer email correspondence (§5) — a cheap metadata query; bodies
      // are fetched lazily on expand. Shape matches CorrespondenceMessageProps.
      correspondence: await listCustomerMessages(c.id),
      // Physical mail (§4): the "Brief senden" eligibility (lawful address + flag
      // + Pingen config — never part-filled) and this customer's letters.
      physicalEligible: physical.eligible,
      physicalReason: physical.reason,
      physicalLetters: await listCustomerLetters(c.id),
      letterDraftSubject: c.letterDraftSubject,
      letterDraftBody: c.letterDraftBody,
    };
    })
  );

  // The ONE global view: received mail from an unknown address (customer_id
  // NULL), plus the slim customer list backing the "assign to customer" action.
  const unmatched = dbReady ? await listUnmatchedInbound() : [];
  const assignTargets = cards.map((c) => ({ id: c.id, email: c.email }));

  if (!dbReady) {
    return (
      <Banner tone="warn">
        Keine Datenbank konfiguriert (DATABASE_URL) — es können keine Kunden geladen werden.
      </Banner>
    );
  }

  if (cards.length === 0) {
    return (
      <Banner tone="info">
        Noch keine Kunden. Ein Kunde entsteht, sobald jemand im Chat seine E-Mail-Adresse (mit
        Einwilligung) hinterlässt — anonyme Sessions bleiben unverknüpft.
      </Banner>
    );
  }

  return (
    <KundenWorkspace
      customers={cards}
      unmatched={unmatched}
      assignTargets={assignTargets}
      initialFilter={initialFilter}
    />
  );
}

// Page-level banner (empty / not-configured states). Themed via tokens so it
// stays readable in both light and dark. The richer tab-body cards keep their
// own styling for now — full per-tab redesigns land in sessions B/C/D.
function Banner({ tone, children }: { tone: "warn" | "info"; children: React.ReactNode }) {
  const cls =
    tone === "warn"
      ? "border-warning/30 bg-warning/10 text-warning"
      : "border-info/30 bg-info/10 text-info";
  return (
    <div className={`mb-4 rounded-lg border px-3.5 py-3 text-sm ${cls}`}>{children}</div>
  );
}
