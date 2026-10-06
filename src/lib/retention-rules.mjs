// Which rows a retention step may delete, by status — the pure half of the
// steps in lib/retention.ts that purge only FINISHED or DECIDED rows. The
// windows themselves are parsed by retention-options.mjs; this module only
// says which states are past the point where anyone still acts on the row.
//
// runRetention passes these lists into its statements (`status = ANY(…)`), so
// the tested lists are the ones the cron uses. A new status added elsewhere
// (outbox worker, improvement loop) fails the test until it is classified here.
//
// Pure, no I/O — node:test covers it (retention-rules.test.mjs).

/**
 * shopify_outbox (0065): finished rows, purged after
 * SHOPIFY_SYNC_LOG_RETENTION_DAYS (step 7) — `done`, `dead` (gave up; shown in
 * Einstellungen → Shopify-Abgleich and the Eingang until then) and `skipped`
 * (superseded by a newer consent write of the same person).
 */
export const OUTBOX_FINISHED_STATUSES = Object.freeze(["done", "dead", "skipped"]);

/** shopify_outbox rows the worker still claims — never purged. */
export const OUTBOX_OPEN_STATUSES = Object.freeze(["pending", "failed", "running"]);

/**
 * improvement_runs (0044) a retention pass may delete: finished ones only. A
 * `running` run is never deleted (the client steps it; a crashed one stays
 * until the operator deletes it).
 */
export const IMPROVEMENT_RUN_FINISHED_STATUSES = Object.freeze(["complete", "failed"]);

/**
 * improvement_suggestions still awaiting a decision („Neu“). A run with such a
 * suggestion is never deleted — its suggestions cascade with it.
 */
export const IMPROVEMENT_SUGGESTION_OPEN_STATUSES = Object.freeze(["open"]);
