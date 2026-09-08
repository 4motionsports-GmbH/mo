// Feedback tab (server-rendered). A thin read: it fetches the customer-feedback
// rows once on the SERVER (listFeedback) and hands them to the client toolbar
// (FeedbackList) for search/filter/sort. No mutation, no new admin logic —
// presentation + a read query only.

import { listFeedback } from "@/lib/feedback-store";
import { FeedbackList, type FeedbackItem } from "./FeedbackList";
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

  if (items.length === 0) {
    return (
      <Callout tone="info" className="mb-4">
        Noch kein Feedback. Sobald Nutzer:innen über das Widget eine Rückmeldung
        senden, erscheint sie hier — neueste zuerst.
      </Callout>
    );
  }

  return <FeedbackList feedback={items} />;
}

