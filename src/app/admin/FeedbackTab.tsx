// Feedback tab (server-rendered). A thin read: it fetches the customer-feedback
// rows once on the SERVER (listFeedback) and hands them to the client toolbar
// (feedback/FeedbackList) for search/filter/sort. No mutation, no new admin
// logic — presentation + a read query only.

import { listFeedback } from "@/lib/feedback-store";
import type { FeedbackItem } from "./feedback/FeedbackList";
import { FeedbackList } from "./lazy";
import { Callout } from "./ui";

export async function FeedbackTab({ dbReady }: { dbReady: boolean }) {
  if (!dbReady) {
    return (
      <Callout tone="warning" className="mb-4">
        Keine Datenbank konfiguriert (DATABASE_URL) — es kann kein Feedback geladen
        werden.
      </Callout>
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

  // The toolbar stays visible even without rows — the list shows its own
  // empty state (UX-F1).
  return <FeedbackList feedback={items} />;
}

