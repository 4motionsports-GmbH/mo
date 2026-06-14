// Customer memory for the LIVE chat — gated on in-session re-identification.
//
// PRIVACY GATE (do not weaken):
// A returning customer opens a new chat as ANONYMOUS. The localStorage session
// id is a per-browser thread id, NOT a person — on a shared/family/public
// device it can carry someone else's past email capture. Therefore past
// history is never surfaced at chat start, and never keyed off the session id
// alone. Memory resolves only when BOTH hold:
//
//   1. The widget sends the email the user typed into the capture form IN THIS
//      chat session (`customer.email` on /api/chat). The widget keeps that
//      state in memory only — it must never auto-attach it from localStorage
//      on a fresh open.
//   2. The server cross-checks that this email's consent record was indeed
//      captured FROM THIS session id (`wasEmailCapturedFromSession`), so a
//      forged request body naming someone else's address resolves nothing
//      unless the capture flow actually ran from this very session.
//
// Both checks fail closed. The match is strictly by the email the user just
// provided — never by session id, IP, or any fingerprint.
//
// ⚠️ GDPR — same lawyer sign-off as the rest of the customer entity: using
// prior interactions + purchase history to shape the LIVE consultation must be
// covered by the approved consent/privacy copy before this runs for real
// users. See docs/CUSTOMERS.md → "TODO — GDPR" and the lawyer checklist in
// docs/CONSENT_FLOW.md (CONSENT_COPY_LAWYER_APPROVED).
//
// Data minimisation: only the compact cached summaries (CUST-A "current
// understanding", owned items from the cached purchase summary) and counts go
// into the prompt — never raw transcripts, order totals, or the email itself.

import { isValidEmail, normalizeEmail, wasEmailCapturedFromSession } from "./email-capture-store";
import {
  countPriorConversations,
  getCustomerByEmail,
  getCustomerById,
  resolveSignedInCustomer,
  type Customer,
} from "./customer-store";
import { getValidAccessToken } from "./customer-oauth-store";
import { CONSENT_COPY_LAWYER_APPROVED } from "./consent-copy";
import { canPersonaliseSignedIn } from "./customer-account-data.mjs";
import { reportError } from "./observability";

/** Compact memory injected into the system prompt for a re-identified customer. */
export interface CustomerMemoryContext {
  /** When we first saw this customer (ISO), for the "returning since" feel. */
  firstSeenAt: string | null;
  /** Linked consultations BEFORE this session. */
  priorConversationCount: number;
  /** Cached "current understanding" summary (generated on demand, CUST-A). */
  profileSummary: string | null;
  /** What they already own — "2× ATX Power Rack" — from the cached order history. */
  ownedItems: string[];
  /** ISO date of the most recent order in the cached history. */
  lastPurchaseAt: string | null;
  /**
   * True when a one-time welcome code was issued historically to this customer
   * (`welcome_issued_at` non-NULL). The automatic welcome discount has been
   * retired, so the memory block instructs Mo to promise NO welcome discount
   * to anyone; this field only shapes how questions about a previously issued
   * code are answered (see system-prompt.ts renderWelcomeMemoryRule).
   */
  welcomeAlreadyIssued: boolean;
  // --- Tier-3 (signed-in Shopify customer) extras (CA-2/CA-3) ----------------
  /** True when this memory belongs to a SIGNED-IN customer (authenticated). */
  signedIn?: boolean;
  /**
   * True when history-personalisation is actually allowed (consent gate passed).
   * For a signed-in customer that has NOT consented this is false: only the
   * authenticated greeting-by-name is shown, no history/profile/address.
   */
  personalised?: boolean;
  /** The signed-in customer's display name, for the tier-appropriate greeting. */
  displayName?: string | null;
  /**
   * DATA-MINIMISED address context (city + country only) from the Shopify
   * account — populated only when personalisation is allowed.
   */
  addressContext?: { city: string | null; countryCode: string | null } | null;
}

// Keep the prompt block bounded even for heavy buyers.
const MAX_OWNED_ITEMS = 15;

/**
 * Aggregate "owned items" from a cached purchase summary — titles + quantities
 * ONLY (no order numbers, no totals), capped. Shared by the email-keyed (tier-2)
 * and signed-in (tier-3) resolvers so both apply the same data minimisation.
 */
function aggregateOwnedItems(
  purchaseSummary: Customer["purchaseSummary"]
): { ownedItems: string[]; lastPurchaseAt: string | null } {
  const owned = new Map<string, number>();
  let lastPurchaseAt: string | null = null;
  for (const order of purchaseSummary?.orders ?? []) {
    if (order.createdAt && (!lastPurchaseAt || order.createdAt > lastPurchaseAt)) {
      lastPurchaseAt = order.createdAt;
    }
    for (const item of order.items) {
      const title = item.title?.trim();
      if (!title) continue;
      owned.set(title, (owned.get(title) ?? 0) + (item.quantity || 1));
    }
  }
  const ownedItems = [...owned.entries()]
    .slice(0, MAX_OWNED_ITEMS)
    .map(([title, qty]) => (qty > 1 ? `${qty}× ${title}` : title));
  return { ownedItems, lastPurchaseAt };
}

export interface ResolveMemoryInput {
  /** The email the user provided in THIS session (forwarded by the widget). */
  email: string;
  /** The current x-ms-session id — used ONLY to verify the in-session capture. */
  sessionId: string | null;
}

/**
 * Resolve the memory context for a re-identified returning customer, or null
 * when the gate doesn't open / there is nothing substantive to remember (a
 * NEW email therefore behaves exactly as before — no memory, no change).
 * Best-effort and fail-closed: any error resolves to null, never throws.
 */
export async function resolveCustomerMemory(
  input: ResolveMemoryInput
): Promise<CustomerMemoryContext | null> {
  const sessionId = input.sessionId?.trim() || null;
  if (!sessionId || !isValidEmail(input.email)) return null;
  const email = normalizeEmail(input.email);

  try {
    // The gate: this email must have completed the capture flow FROM THIS
    // session. The widget's claim alone is never enough.
    if (!(await wasEmailCapturedFromSession(email, sessionId))) return null;

    const customer = await getCustomerByEmail(email);
    if (!customer) return null;

    const priorConversationCount = await countPriorConversations(customer.id, sessionId);

    // Aggregate owned items from the cached purchase summary (titles +
    // quantities only — no order numbers, no totals).
    const { ownedItems, lastPurchaseAt } = aggregateOwnedItems(customer.purchaseSummary);

    const profileSummary = customer.profileSummary?.trim() || null;

    // A just-created customer (this capture was their first) has nothing to
    // remember — return null so the chat behaves exactly as today.
    if (!profileSummary && ownedItems.length === 0 && priorConversationCount === 0) {
      return null;
    }

    return {
      firstSeenAt: customer.firstSeenAt,
      priorConversationCount,
      profileSummary,
      ownedItems,
      lastPurchaseAt,
      welcomeAlreadyIssued: customer.welcomeIssuedAt != null,
    };
  } catch (err) {
    reportError(err, { route: "lib/customer-memory", phase: "resolveCustomerMemory" });
    return null;
  }
}

/**
 * Resolve memory for a SIGNED-IN (tier-3) customer. The authenticated session
 * IS the re-identification — no in-session email capture needed — but it must
 * still be live: we obtain a valid access token (refreshing if needed) before
 * surfacing anything, so a logged-out/expired session resolves to null (fail
 * closed), exactly like /api/auth/me.
 *
 * The greeting-by-name uses ONLY the authenticated session's own identity, so it
 * is shown to any live signed-in customer. Using their PURCHASE HISTORY /
 * PROFILE / ADDRESS to personalise is gated on the SAME personalisation consent
 * as tier 2 (CONSENT_COPY_LAWYER_APPROVED + marketing consent — see
 * canPersonaliseSignedIn). Non-consented → name only. Best-effort; never throws.
 */
export async function resolveSignedInMemory(
  sessionId: string | null
): Promise<CustomerMemoryContext | null> {
  const sid = sessionId?.trim() || null;
  if (!sid) return null;
  try {
    const resolved = await resolveSignedInCustomer(sid);
    if (!resolved) return null;

    // Prove the session is still live (authenticated re-identification).
    const token = await getValidAccessToken(resolved.customerId);
    if (!token) return null;

    const customer = await getCustomerById(resolved.customerId);
    if (!customer) return null;

    const displayName =
      customer.shopifyAccountSummary?.displayName?.trim() || resolved.name || null;

    const personalise = canPersonaliseSignedIn({
      lawyerApproved: CONSENT_COPY_LAWYER_APPROVED,
      marketingStatus: customer.marketingStatus,
    });

    if (!personalise) {
      // Authenticated greeting-by-name ONLY — no history personalisation leaks.
      // With nothing to even greet by, behave exactly as for an anonymous visit.
      if (!displayName) return null;
      return {
        firstSeenAt: null,
        priorConversationCount: 0,
        profileSummary: null,
        ownedItems: [],
        lastPurchaseAt: null,
        welcomeAlreadyIssued: customer.welcomeIssuedAt != null,
        signedIn: true,
        personalised: false,
        displayName,
        addressContext: null,
      };
    }

    // Consented: full personalisation from the cached Shopify data.
    const priorConversationCount = await countPriorConversations(customer.id, sid);
    const { ownedItems, lastPurchaseAt } = aggregateOwnedItems(customer.purchaseSummary);
    const profileSummary = customer.profileSummary?.trim() || null;

    return {
      firstSeenAt: customer.firstSeenAt,
      priorConversationCount,
      profileSummary,
      ownedItems,
      lastPurchaseAt,
      welcomeAlreadyIssued: customer.welcomeIssuedAt != null,
      signedIn: true,
      personalised: true,
      displayName,
      addressContext: customer.shopifyAccountSummary?.addressContext ?? null,
    };
  } catch (err) {
    reportError(err, { route: "lib/customer-memory", phase: "resolveSignedInMemory" });
    return null;
  }
}

/**
 * The single entry point the chat route uses to resolve customer memory.
 * SIGNED-IN (tier-3) identity takes precedence — it's the authenticated session
 * — and falls back to the email-keyed (tier-2) in-session re-identification.
 * Fail-closed: anonymous / unverified resolves to null.
 */
export async function resolveChatMemory(input: {
  sessionId: string | null;
  email: string | null;
}): Promise<CustomerMemoryContext | null> {
  const signedIn = await resolveSignedInMemory(input.sessionId);
  if (signedIn) return signedIn;
  if (input.email) {
    return resolveCustomerMemory({ email: input.email, sessionId: input.sessionId });
  }
  return null;
}
