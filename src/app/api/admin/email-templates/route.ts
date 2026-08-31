// GET /api/admin/email-templates — the stored email design templates plus the
// per-email-type assignment map, for the admin "Einstellungen" tab.
//
// Auth: the proxy gates /api/admin/*; guardAdminGet re-asserts the session cookie.

import { guardAdminGet, adminJson } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import {
  listEmailTemplates,
  listEmailTemplateAssignments,
} from "@/lib/email-theme-store";
import { MAX_EMAIL_TEMPLATES } from "@/lib/email-theme.mjs";

export const maxDuration = 15;

export async function GET() {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;

  if (!isDbConfigured()) {
    return adminJson({
      templates: [],
      assignments: {},
      limits: { maxTemplates: MAX_EMAIL_TEMPLATES },
    });
  }
  const [templates, assignments] = await Promise.all([
    listEmailTemplates(),
    listEmailTemplateAssignments(),
  ]);
  return adminJson({
    templates,
    assignments,
    limits: { maxTemplates: MAX_EMAIL_TEMPLATES },
  });
}
