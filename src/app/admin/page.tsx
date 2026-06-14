// /admin — the back-office dashboard. Auth is enforced by the proxy; this page
// is only ever reached with a valid admin session.
//
// Structure: data for all three tabs is fetched + rendered on the SERVER (the
// CustomersTab / KundenTab / KpiTab bodies below) and handed to the client
// AdminShell, which owns the active-tab state, the theme toggle and the Toaster.
// The old server-side ?tab= switch is gone, but the initial tab is still seeded
// from ?tab= so deep links / refresh land on the right tab, and the shell keeps
// the query param in sync as you switch.
//
//   - MARKETING (default): marketing-eligible contacts (DOI confirmed, not
//     unsubscribed, not suppressed) with transcript, persona, products, the
//     "chatted but not purchased" flag and the draft/send workflow (CustomerCard).
//   - KUNDEN: grouped by CUSTOMER (email) — session timeline, purchase history,
//     persona(s) and the regenerated "current understanding" (CustomerProfileCard).
//   - KPIs: aggregate analytics + recommendation→purchase loop (KpiTab).

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE_NAME } from "@/lib/admin-auth";
import { isDbConfigured } from "@/lib/db";
import {
  listMarketingTargets,
  getLatestSendForEmail,
  type MarketingTarget,
} from "@/lib/marketing-store";
import {
  listBestandskundenAudience,
  type BestandskundeAudienceRow,
} from "@/lib/bestandskunden-store";
import { isBestandskundenSendsApproved } from "@/lib/bestandskunden.mjs";
import { listCustomersWithSessions } from "@/lib/customer-store";
import {
  listCustomerMessages,
  listUnmatchedInbound,
} from "@/lib/email-messages-store";
import { listBundleOffersWithSignalsForCustomer } from "@/lib/bundle-offers-store";
import { buildBundleRedirectUrl } from "@/lib/bundle-offers";
import { wasDiscountCodeRedeemed } from "@/lib/shopify-orders";
import { ARCHETYPE_META } from "@/lib/persona";
import type { PersonaArchetype } from "@/lib/types";
import { MarketingList } from "./MarketingList";
import { toStatusFilter, type StatusFilter } from "./marketing-filter";
import { CustomerProfileCard, type CustomerProps } from "./CustomerProfileCard";
import { UnmatchedInboundQueue } from "./UnmatchedInboundQueue";
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
  const initialTab: AdminTab =
    sp?.tab === "kpi"
      ? "kpi"
      : sp?.tab === "feedback"
        ? "feedback"
        : sp?.tab === "kunden"
          ? "kunden"
          : sp?.tab === "customers"
            ? "customers"
            : "overview";
  // ?status= deep-links straight into a pre-applied Marketing filter (set by the
  // Overview quick links), seeding MarketingList's own filter state.
  const initialMarketingStatus = toStatusFilter(
    typeof sp?.status === "string" ? sp.status : undefined
  );
  const dbReady = isDbConfigured();

  // The marketing targets back BOTH the Marketing tab and the Overview headline
  // KPIs / "not purchased" count — fetch the (Shopify-touching) list once here
  // and hand it to both so the numbers agree and the fan-out isn't doubled.
  const targets: MarketingTarget[] = dbReady ? await listMarketingTargets() : [];

  // The SEPARATE §7(3) Bestandskunden audience (completed-purchase basis, never
  // the DOI list). Cheap DB read (eligibility is precomputed) — shown apart on
  // the Marketing tab so the two lawful bases never visually blur together.
  const bestandskunden: BestandskundeAudienceRow[] = dbReady
    ? await listBestandskundenAudience()
    : [];

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
      marketing={
        <CustomersTab
          dbReady={dbReady}
          targets={targets}
          bestandskunden={bestandskunden}
          bestandskundenSendsApproved={isBestandskundenSendsApproved()}
          initialStatus={initialMarketingStatus}
        />
      }
      kunden={<KundenTab dbReady={dbReady} />}
      kpi={<KpiTab dbReady={dbReady} />}
      feedback={<FeedbackTab dbReady={dbReady} />}
    />
  );
}

function CustomersTab({
  dbReady,
  targets,
  bestandskunden,
  bestandskundenSendsApproved,
  initialStatus,
}: {
  dbReady: boolean;
  targets: MarketingTarget[];
  bestandskunden: BestandskundeAudienceRow[];
  bestandskundenSendsApproved: boolean;
  initialStatus: StatusFilter;
}) {
  const notPurchased = targets.filter((t) => t.purchase.status === "no_purchase").length;

  return (
    <>
      {!dbReady && (
        <Banner tone="warn">
          Keine Datenbank konfiguriert (DATABASE_URL) — es können keine Kontakte
          geladen werden.
        </Banner>
      )}

      {/* ── Basis 1: DOI-Einwilligung ──────────────────────────────────── */}
      <BasisHeading
        label="DOI-Einwilligung"
        sub="Double-Opt-In bestätigt (Art. 6 Abs. 1 a DSGVO). Werblicher Versand erlaubt."
      />

      {dbReady && targets.length === 0 && (
        <Banner tone="info">
          Noch keine marketing-berechtigten Kontakte. Sobald Nutzer die
          Marketing-Einwilligung per Double-Opt-In bestätigen, erscheinen sie hier.
        </Banner>
      )}

      {targets.length > 0 && (
        <>
          <p className="mb-4 text-sm text-muted-foreground">
            <strong className="text-foreground">{notPurchased}</strong>{" "}
            &bdquo;beraten, aber (noch) nicht gekauft&ldquo; — die wichtigste
            Marketing-Zielgruppe.
          </p>
          <MarketingList targets={targets} initialStatus={initialStatus} />
        </>
      )}

      {/* ── Basis 2: §7(3) Bestandskunden (SEPARATE basis, never merged) ── */}
      <div className="mt-8">
        <BasisHeading
          label="§ 7 Abs. 3 UWG Bestandskunden"
          sub="Eigene ähnliche Produkte an Kund:innen mit abgeschlossenem Kauf — OHNE Einwilligung, eigener Widerspruch."
        />

        <Banner tone={bestandskundenSendsApproved ? "info" : "warn"}>
          {bestandskundenSendsApproved ? (
            <>
              Versand <strong>freigeschaltet</strong>{" "}
              (BESTANDSKUNDE_SENDS_APPROVED). Nur eigene <em>ähnliche</em> Produkte,
              mit Widerspruchshinweis &amp; separater Sperrliste.
            </>
          ) : (
            <>
              Versand <strong>deaktiviert</strong> — wartet auf die anwaltliche
              Freigabe der &bdquo;ähnliche Produkte&ldquo;-Grenze und des
              Widerspruchstextes (eigenes Flag{" "}
              <code>BESTANDSKUNDE_SENDS_APPROVED</code>, getrennt von der
              DOI-Freigabe). Diese Liste ist nur informativ.
            </>
          )}
        </Banner>

        {dbReady && bestandskunden.length === 0 ? (
          <Banner tone="info">
            Noch keine Bestandskunden. Sobald ein Kunde einen Kauf abschließt (und
            die Käufe aktualisiert werden), erscheint er hier — getrennt von der
            DOI-Liste.
          </Banner>
        ) : (
          <p className="mb-2 text-sm text-muted-foreground">
            <strong className="text-foreground">{bestandskunden.length}</strong>{" "}
            Bestandskund:in(nen) mit abgeschlossenem Kauf, ohne Widerspruch.{" "}
            {bestandskunden.filter((b) => b.hasDoiConsent).length} davon haben{" "}
            <em>zusätzlich</em> eine DOI-Einwilligung (beide Basen bleiben getrennt).
          </p>
        )}
      </div>
    </>
  );
}

// Small labelled separator that names a marketing lawful basis, so the two
// audiences (DOI-consent vs §7(3) Bestandskunden) never blur together visually.
function BasisHeading({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="mb-3 border-b border-border pb-2">
      <h3 className="text-base font-semibold text-foreground">{label}</h3>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
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
  // the browser doesn't need the pseudonymous keys). For customers with a
  // welcome code, the redemption status is looked up live against Shopify
  // orders (read_orders, same check the marketing funnel uses) — concurrent,
  // and null ("unknown") when Shopify can't answer. The latest marketing send
  // (open draft preferred) backs the personalised-email workflow on the card.
  const cards: CustomerProps[] = await Promise.all(
    customers.map(async (c) => ({
      id: c.id,
      email: c.email,
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
      welcomeCode: c.welcomeCode,
      welcomeCodeExpiresAt: c.welcomeCodeExpiresAt,
      welcomeIssuedAt: c.welcomeIssuedAt,
      welcomeRedeemed: c.welcomeCode ? await wasDiscountCodeRedeemed(c.welcomeCode) : null,
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
    }))
  );

  // The ONE global view: received mail from an unknown address (customer_id
  // NULL), plus the slim customer list backing the "assign to customer" action.
  const unmatched = dbReady ? await listUnmatchedInbound() : [];
  const assignTargets = cards.map((c) => ({ id: c.id, email: c.email }));

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

      {/* The only non-per-customer surface: unmatched inbound triage (§5). */}
      <UnmatchedInboundQueue messages={unmatched} customers={assignTargets} />

      {cards.length > 0 && (
        <p className="mb-4 text-sm text-muted-foreground">
          {cards.length} Kunde(n) · <strong className="text-foreground">{returning}</strong>{" "}
          wiederkehrend (mehrere Sessions unter derselben E-Mail).
        </p>
      )}

      <div className="flex flex-col gap-4">
        {cards.map((c) => (
          <CustomerProfileCard key={c.id} customer={c} />
        ))}
      </div>
    </>
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
