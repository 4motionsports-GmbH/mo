// "Wissen" tab (server-rendered shell): the knowledge-enhancement Q&A queue.
// Conversations where Mo lacked knowledge (unmet need / drop-off / contact-form
// hand-over) are scanned into precise Q&A drafts; the operator answers and
// publishes them — product-linked pairs to the Shopify `custom.qa` metafield
// (PDP Q&A tab + Mo's catalog context), general pairs to Mo's prompt knowledge
// base. Data is fetched once on the SERVER and handed to the client workspace,
// mirroring the other tabs.

import {
  listQaEntries,
  getQaCounts,
  countScanCandidates,
} from "@/lib/qa-store";
import { WissenWorkspace } from "./lazy";
import { Callout } from "./ui";

export async function WissenTab({ dbReady }: { dbReady: boolean }) {
  if (!dbReady) {
    return (
      <Callout tone="warning" className="mb-4">
        Keine Datenbank konfiguriert (DATABASE_URL) — die Wissens-Warteschlange
        kann nicht geladen werden.
      </Callout>
    );
  }

  const [entries, counts, scanCandidates] = await Promise.all([
    listQaEntries(null),
    getQaCounts(),
    countScanCandidates(),
  ]);

  return (
    <WissenWorkspace
      initialEntries={entries}
      initialCounts={counts}
      initialScanCandidates={scanCandidates}
    />
  );
}
