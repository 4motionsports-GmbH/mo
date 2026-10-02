import { test } from "node:test";
import assert from "node:assert/strict";
import { describeSyncProblems } from "./shopify-sync-health.mjs";

const NOW = Date.parse("2026-10-02T20:00:00Z");
const h = (over = {}) => ({
  importDone: true,
  lastImportAt: "2026-10-02T13:38:00Z",
  lastReconcileAt: null,
  lastWebhookAt: "2026-10-02T19:59:00Z",
  ...over,
});
const run = (health, dead = 0, syncEnabled = true) => describeSyncProblems(health, dead, { syncEnabled, now: NOW });

test("right after the import, a missing reconcile is no problem", () => {
  assert.deepEqual(run(h()), []);
});

test("no full sync for 36 hours is reported", () => {
  assert.equal(run(h({ lastImportAt: "2026-09-30T20:00:00Z" })).length, 1);
  assert.equal(run(h({ lastImportAt: "2026-09-25T00:00:00Z", lastReconcileAt: "2026-09-30T07:00:00Z" })).length, 1);
  // A recent reconcile after an old import is fine.
  assert.deepEqual(run(h({ lastImportAt: "2026-09-01T00:00:00Z", lastReconcileAt: "2026-10-02T01:45:00Z" })), []);
});

test("import pending, quiet webhooks and dead outbox rows", () => {
  assert.deepEqual(run(h({ importDone: false, lastImportAt: null })), ["Der erste Import des Shopify-Kundenstamms steht noch aus."]);
  assert.deepEqual(run(h({ lastWebhookAt: "2026-09-29T00:00:00Z" })), ["Seit über zwei Tagen kam kein Shopify-Webhook an."]);
  assert.deepEqual(run(h(), 1), ["1 Übertragung an Shopify wurde aufgegeben."]);
  assert.deepEqual(run(h(), 3), ["3 Übertragungen an Shopify wurden aufgegeben."]);
});

test("with the sync off only dead outbox rows count", () => {
  assert.deepEqual(run(h({ importDone: false }), 0, false), []);
  assert.equal(run(null, 2, false).length, 1);
});
