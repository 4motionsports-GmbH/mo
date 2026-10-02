// What is wrong with the Shopify sync, in plain German (the Eingang card and
// its system item); an empty list = all good. Pure, tested
// (shopify-sync-health.test.mjs). Thresholds: no webhook for two days, no
// full sync — the nightly reconcile or the import itself — for 36 hours.

const DAY_MS = 86_400_000;

/**
 * @param {{ importDone: boolean, lastImportAt: string | null, lastReconcileAt: string | null,
 *           lastWebhookAt: string | null } | null} health
 * @param {number} deadOutbox outbox rows given up
 * @param {{ syncEnabled: boolean, now?: number }} opts
 * @returns {string[]}
 */
export function describeSyncProblems(health, deadOutbox, opts) {
  const now = opts.now ?? Date.now();
  const out = [];
  if (opts.syncEnabled && health) {
    if (!health.importDone) out.push("Der erste Import des Shopify-Kundenstamms steht noch aus.");
    if (health.lastWebhookAt && now - new Date(health.lastWebhookAt).getTime() > 2 * DAY_MS) {
      out.push("Seit über zwei Tagen kam kein Shopify-Webhook an.");
    }
    // The import is a full sync too: right after it no reconcile has run yet,
    // and that is no problem until the first night has passed.
    const lastFullSync = Math.max(
      health.lastReconcileAt ? new Date(health.lastReconcileAt).getTime() : 0,
      health.lastImportAt ? new Date(health.lastImportAt).getTime() : 0
    );
    if (health.importDone && now - lastFullSync > 1.5 * DAY_MS) {
      out.push("Der nächtliche Abgleich ist seit über 36 Stunden nicht durchgelaufen.");
    }
  }
  if (deadOutbox > 0) {
    out.push(deadOutbox === 1 ? "1 Übertragung an Shopify wurde aufgegeben." : `${deadOutbox} Übertragungen an Shopify wurden aufgegeben.`);
  }
  return out;
}
