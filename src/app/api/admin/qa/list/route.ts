// GET /api/admin/qa/list?status=open|answered|published|dismissed
//
// The "Wissen" queue: entries (newest first, capped) + per-status counts +
// how many conversations still await a knowledge-gap scan. Read-only, zero
// tokens. Auth: guardAdminGet (the proxy already gates /api/admin/*).

import { guardAdminGet, adminJson, adminJsonError } from "@/lib/admin-api";
import {
  listQaEntries,
  getQaCounts,
  countScanCandidates,
  type QaStatus,
} from "@/lib/qa-store";
import { QA_STATUSES } from "@/lib/qa-core.mjs";
import { isDbConfigured } from "@/lib/db";

export const maxDuration = 15;

export async function GET(req: Request) {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;
  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  const url = new URL(req.url);
  const raw = url.searchParams.get("status");
  const status =
    raw && (QA_STATUSES as string[]).includes(raw) ? (raw as QaStatus) : null;

  const [entries, counts, scanCandidates] = await Promise.all([
    listQaEntries(status),
    getQaCounts(),
    countScanCandidates(),
  ]);
  return adminJson({ entries, counts, scanCandidates });
}
