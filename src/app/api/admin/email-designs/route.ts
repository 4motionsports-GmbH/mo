// GET /api/admin/email-designs — the registered code designs (registry
// metadata) plus the current per-email-type selection, for the admin
// "Einstellungen" tab.
//
// Auth: the proxy gates /api/admin/*; guardAdminGet re-asserts the session cookie.

import { guardAdminGet, adminJson } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { listEmailDesignMeta } from "@/lib/email-designs/registry";
import { listEmailDesignSelections } from "@/lib/email-design-store";

export const maxDuration = 15;

export async function GET() {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;

  const designs = listEmailDesignMeta();
  const selections = isDbConfigured() ? await listEmailDesignSelections() : {};
  return adminJson({ designs, selections });
}
