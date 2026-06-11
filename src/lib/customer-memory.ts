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
import { countPriorConversations, getCustomerByEmail } from "./customer-store";
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
}

// Keep the prompt block bounded even for heavy buyers.
const MAX_OWNED_ITEMS = 15;

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
    const owned = new Map<string, number>();
    let lastPurchaseAt: string | null = null;
    for (const order of customer.purchaseSummary?.orders ?? []) {
      if (!lastPurchaseAt || order.createdAt > lastPurchaseAt) {
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
    };
  } catch (err) {
    reportError(err, { route: "lib/customer-memory", phase: "resolveCustomerMemory" });
    return null;
  }
}
