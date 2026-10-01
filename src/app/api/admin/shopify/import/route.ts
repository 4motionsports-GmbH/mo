// POST /api/admin/shopify/import  { action: "start" | "step" | "cancel" } → ImportStepResult
//
// The first full import of the Shopify customers and orders (bulk operations,
// lib/shopify-sync.ts), driven step by step from Einstellungen (useStepLoop);
// the 5-minute cron keeps going if the page is closed. Idempotent — a second
// start while one runs returns the running import.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { cancelCustomerImport, runCustomerImportStep, startCustomerImport } from "@/lib/shopify-sync";
import { recomputeCustomerFacts } from "@/lib/customer-facts";
import { reportError } from "@/lib/observability";

export const maxDuration = 120;

const REASONS: Record<string, string> = {
  disabled: "Der Abgleich ist ausgeschaltet (SHOPIFY_CUSTOMER_SYNC_ENABLED).",
  not_configured: "Shopify ist nicht konfiguriert.",
  no_db: "Keine Datenbank konfiguriert.",
};

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let action: string;
  try {
    action = String(((await req.json()) as { action?: unknown }).action ?? "");
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }
  try {
    if (action === "cancel") return adminJson({ cancelled: await cancelCustomerImport() });
    const res =
      action === "start"
        ? await startCustomerImport()
        : action === "step"
          ? await runCustomerImportStep({ deadlineMs: Date.now() + 90_000 })
          : null;
    if (!res) return adminJsonError("bad_request", "action must be start, step or cancel", 400);
    if (!res.ok && res.reason && REASONS[res.reason]) return adminJsonError(res.reason, REASONS[res.reason], 409);
    if (!res.ok) return adminJsonError("import_failed", res.message ?? "Der Import ist fehlgeschlagen.", 502);
    // Fresh customers have no figures yet — compute a first batch right away
    // so the Kunden list fills in without waiting for the night.
    if (res.done && action === "step") await recomputeCustomerFacts({ deadlineMs: Date.now() + 20_000, maxBatches: 10 });
    return adminJson(res);
  } catch (err) {
    reportError(err, { route: "api/admin/shopify/import" });
    return adminJsonError("internal_error", "Der Import ist fehlgeschlagen.", 500);
  }
}
