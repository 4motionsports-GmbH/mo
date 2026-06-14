// Feedback tab (server-rendered). A thin read: it fetches the customer-feedback
// rows once on the SERVER (listFeedback) and hands them to the client toolbar
// (FeedbackList) for search/filter/sort. No mutation, no new admin logic —
// presentation + a read query only.

import { listFeedback } from "@/lib/feedback-store";
import { FeedbackList, type FeedbackItem } from "./FeedbackList";

export async function FeedbackTab({ dbReady }: { dbReady: boolean }) {
  if (!dbReady) {
    return (
      <Banner tone="warn">
        Keine Datenbank konfiguriert (DATABASE_URL) — es kann kein Feedback geladen
        werden.
      </Banner>
    );
  }

  const rows = await listFeedback();
  const items: FeedbackItem[] = rows.map((r) => ({
    id: r.id,
    message: r.message,
    sessionId: r.sessionId,
    conversationId: r.conversationId,
    tier: r.tier,
    email: r.email,
    page: r.page,
    createdAt: r.createdAt,
  }));

  if (items.length === 0) {
    return (
      <Banner tone="info">
        Noch kein Feedback. Sobald Nutzer:innen über das Widget eine Rückmeldung
        senden, erscheint sie hier — neueste zuerst.
      </Banner>
    );
  }

  return <FeedbackList feedback={items} />;
}

// Page-level banner (empty / not-configured states), matching the other tabs'
// token-themed banner.
function Banner({ tone, children }: { tone: "warn" | "info"; children: React.ReactNode }) {
  const cls =
    tone === "warn"
      ? "border-warning/30 bg-warning/10 text-warning"
      : "border-info/30 bg-info/10 text-info";
  return (
    <div className={`mb-4 rounded-lg border px-3.5 py-3 text-sm ${cls}`}>{children}</div>
  );
}
