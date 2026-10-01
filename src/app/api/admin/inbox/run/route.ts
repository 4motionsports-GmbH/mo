// POST /api/admin/inbox/run → InboxRunResult
//
// „Jetzt prüfen“ — run the Eingang rules now (the hourly cron does the same),
// without AI suggestions (those stay within the daily limit of the cron or
// are requested per item).

import { guardAdminPost, adminJson } from "@/lib/admin-api";
import { runInboxSignals } from "@/lib/inbox-signals";

export const maxDuration = 120;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  return adminJson(await runInboxSignals({ suggest: false }));
}
