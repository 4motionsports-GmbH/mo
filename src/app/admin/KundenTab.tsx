// Kunden screen (server-rendered): the slim customer list (one row per person,
// searchable / filterable client-side) plus the global "unmatched inbound"
// triage. A customer's full detail is loaded on demand when it is opened
// (GET /api/admin/customers/detail) — the list never ships transcripts,
// summaries or correspondence for everyone.

import { listCustomerListRows } from "@/lib/customer-store";
import { listUnmatchedInbound } from "@/lib/email-messages-store";
import { KundenWorkspace } from "./kunden/KundenWorkspace";
import { Callout } from "./ui";

export async function KundenTab({
  dbReady,
  initialFilter,
  initialCustomerId,
}: {
  dbReady: boolean;
  initialFilter?: string;
  initialCustomerId?: number | null;
}) {
  if (!dbReady) {
    return (
      <Callout tone="warning">
        Keine Datenbank konfiguriert (DATABASE_URL) — es können keine Kunden geladen werden.
      </Callout>
    );
  }

  const [customers, unmatched] = await Promise.all([
    listCustomerListRows(),
    listUnmatchedInbound(),
  ]);

  return (
    <KundenWorkspace
      customers={customers}
      unmatched={unmatched}
      initialFilter={initialFilter}
      initialCustomerId={initialCustomerId ?? null}
    />
  );
}
