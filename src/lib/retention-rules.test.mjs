import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OUTBOX_FINISHED_STATUSES,
  OUTBOX_OPEN_STATUSES,
  IMPROVEMENT_RUN_FINISHED_STATUSES,
  IMPROVEMENT_SUGGESTION_OPEN_STATUSES,
} from "./retention-rules.mjs";
import { planOutboxRetry } from "./outbox-core.mjs";
import { SUGGESTION_STATUSES } from "./improvement-core.mjs";

test("outbox: finished and open statuses are disjoint", () => {
  for (const s of OUTBOX_FINISHED_STATUSES) assert.ok(!OUTBOX_OPEN_STATUSES.includes(s), s);
});

test("outbox: skipped rows are purged with done / dead", () => {
  assert.deepEqual([...OUTBOX_FINISHED_STATUSES].sort(), ["dead", "done", "skipped"]);
});

test("outbox: every status the worker plans is classified, a retry stays open", () => {
  const done = planOutboxRetry({ attempts: 1, ok: true });
  const retry = planOutboxRetry({ attempts: 1, ok: false });
  const dead = planOutboxRetry({ attempts: 1, ok: false, permanent: true });
  assert.ok(OUTBOX_FINISHED_STATUSES.includes(done.status));
  assert.ok(OUTBOX_FINISHED_STATUSES.includes(dead.status));
  assert.ok(OUTBOX_OPEN_STATUSES.includes(retry.status));
  // pending (enqueued) and running (claimed) are open as well.
  assert.ok(OUTBOX_OPEN_STATUSES.includes("pending"));
  assert.ok(OUTBOX_OPEN_STATUSES.includes("running"));
});

test("improvement: a running run is never purgeable", () => {
  assert.ok(!IMPROVEMENT_RUN_FINISHED_STATUSES.includes("running"));
  assert.deepEqual([...IMPROVEMENT_RUN_FINISHED_STATUSES].sort(), ["complete", "failed"]);
});

test("improvement: only undecided suggestions hold their run, and every status is known", () => {
  assert.deepEqual([...IMPROVEMENT_SUGGESTION_OPEN_STATUSES], ["open"]);
  for (const s of IMPROVEMENT_SUGGESTION_OPEN_STATUSES) assert.ok(SUGGESTION_STATUSES.includes(s), s);
  // A new status in improvement-core must be classified here deliberately.
  assert.deepEqual([...SUGGESTION_STATUSES].sort(), ["accepted", "dismissed", "implemented", "open"]);
});
