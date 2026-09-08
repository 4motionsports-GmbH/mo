// Kunden screen (server-rendered): the merged customer + marketing workspace,
// grouped by PERSON (email), not by session. A customer exists only because an
// email was captured with consent; anonymous sessions never appear here.
// Renders the master–detail KundenWorkspace (compact searchable list +
// per-customer sub-tabbed detail incl. marketing).

import { after } from "next/server";
import { autoCaptureMissingAddresses } from "@/lib/address-capture";
import { getLatestSendForEmail } from "@/lib/marketing-store";
import { listCustomersWithSessions } from "@/lib/customer-store";
import { listCustomerMessages, listUnmatchedInbound } from "@/lib/email-messages-store";
import { listCustomerLetters } from "@/lib/physical-letters-store";
import { physicalEligibilityForCustomer } from "@/lib/physical-mail";
import { listBundleOffersWithSignalsForCustomer } from "@/lib/bundle-offers-store";
import { buildBundleRedirectUrl } from "@/lib/bundle-offers";
import { ARCHETYPE_META } from "@/lib/persona";
import type { PersonaArchetype } from "@/lib/types";
import type { CustomerProps } from "./CustomerProfileCard";
import { KundenWorkspace } from "./KundenWorkspace";
import { Callout } from "./ui";

export async function KundenTab({
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
                textMode: s.textMode,
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
      <Callout tone="warning" className="mb-4">
        Keine Datenbank konfiguriert (DATABASE_URL) — es können keine Kunden geladen werden.
      </Callout>
    );
  }

  if (cards.length === 0) {
    return (
      <Callout tone="info" className="mb-4">
        Noch keine Kunden. Ein Kunde entsteht, sobald jemand im Chat seine E-Mail-Adresse (mit
        Einwilligung) hinterlässt — anonyme Sessions bleiben unverknüpft.
      </Callout>
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
