import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deskProgress,
  matchesQueueFilter,
  nextSelectionAfterRemoval,
  parseDeliveryFilter,
  parseDeskView,
  parseQueueFilter,
  prepareEstimate,
  queueFilterCounts,
  selectionAfterListChange,
  stepSelection,
  upsertOutbox,
  SECONDS_PER_DRAFT,
  SECONDS_PER_HERO,
} from "./campaign-desk-core.mjs";

test("views and filters parse defensively", () => {
  assert.equal(parseDeskView("liste"), "liste");
  assert.equal(parseDeskView("gesendet"), "gesendet");
  assert.equal(parseDeskView("nope"), "pruefen");
  assert.equal(parseDeskView(undefined), "pruefen");
  assert.equal(parseQueueFilter("doi"), "doi");
  assert.equal(parseQueueFilter("x"), "all");
  assert.equal(parseDeliveryFilter("bounced"), "bounced");
  assert.equal(parseDeliveryFilter(null), "all");
});

test("queue filters match on opt-in, language, offer and verdict", () => {
  const doi = { optInLevel: "CONFIRMED_OPT_IN", language: "de", discountPercent: 0, bundle: null };
  const soiEn = { optInLevel: "SINGLE_OPT_IN", language: "en", discountPercent: 10, bundle: { id: 1 } };
  assert.equal(matchesQueueFilter(doi, "all", "ready"), true);
  assert.equal(matchesQueueFilter(doi, "doi", "ready"), true);
  assert.equal(matchesQueueFilter(doi, "soi", "ready"), false);
  assert.equal(matchesQueueFilter(soiEn, "soi", "ready"), true);
  assert.equal(matchesQueueFilter(soiEn, "en", "ready"), true);
  assert.equal(matchesQueueFilter(doi, "en", "ready"), false);
  assert.equal(matchesQueueFilter(soiEn, "discount", "ready"), true);
  assert.equal(matchesQueueFilter(doi, "discount", "ready"), false);
  assert.equal(matchesQueueFilter(soiEn, "set", "ready"), true);
  assert.equal(matchesQueueFilter(doi, "hints", "ready"), false);
  assert.equal(matchesQueueFilter(doi, "hints", "hints"), true);
  assert.equal(matchesQueueFilter(doi, "hints", "blocked"), true);
  assert.equal(matchesQueueFilter(doi, "blocked", "hints"), false);
  assert.equal(matchesQueueFilter(doi, "blocked", "blocked"), true);
});

test("filter counts cover every chip", () => {
  const items = [
    { id: 1, optInLevel: "CONFIRMED_OPT_IN", language: "de", discountPercent: 10, bundle: null },
    { id: 2, optInLevel: "UNKNOWN", language: "en", discountPercent: 0, bundle: { id: 9 } },
    { id: 3, optInLevel: "CONFIRMED_OPT_IN", language: "de", discountPercent: 0, bundle: null },
  ];
  const verdicts = { 1: "ready", 2: "blocked", 3: "hints" };
  const counts = queueFilterCounts(items, (it) => verdicts[it.id]);
  assert.deepEqual(counts, {
    all: 3,
    doi: 2,
    soi: 1,
    en: 1,
    discount: 1,
    set: 1,
    hints: 2,
    blocked: 1,
  });
});

test("after a removal the card that took the position is selected, else the previous", () => {
  assert.equal(nextSelectionAfterRemoval([1, 2, 3], 2), 3);
  assert.equal(nextSelectionAfterRemoval([1, 2, 3], 3), 2);
  assert.equal(nextSelectionAfterRemoval([1, 2, 3], 1), 2);
  assert.equal(nextSelectionAfterRemoval([1], 1), null);
  assert.equal(nextSelectionAfterRemoval([1, 2], 9), 1);
});

test("a list change keeps the current card when still visible", () => {
  assert.equal(selectionAfterListChange([4, 5, 6], 5), 5);
  assert.equal(selectionAfterListChange([4, 5, 6], 7), 4);
  assert.equal(selectionAfterListChange([], 7), null);
  assert.equal(selectionAfterListChange([4], null), 4);
});

test("stepping stops at the ends and starts at the top", () => {
  assert.equal(stepSelection([1, 2, 3], 2, 1), 3);
  assert.equal(stepSelection([1, 2, 3], 3, 1), 3);
  assert.equal(stepSelection([1, 2, 3], 1, -1), 1);
  assert.equal(stepSelection([1, 2, 3], null, 1), 1);
  assert.equal(stepSelection([], null, 1), null);
});

test("the prepare estimate caps at the sendable contacts and prices heroes for the A group", () => {
  const e = prepareEstimate({
    count: 50,
    pendingSendable: 14,
    draftCostEur: 0.025,
    heroCostEur: 0.2,
    withHero: true,
  });
  assert.equal(e.drafts, 14);
  assert.equal(e.heroes, 7);
  assert.ok(Math.abs(e.costEur - (14 * 0.025 + 7 * 0.2)) < 1e-9);
  assert.equal(e.seconds, 14 * SECONDS_PER_DRAFT + 7 * SECONDS_PER_HERO);

  const noHero = prepareEstimate({ count: 25, pendingSendable: 100, draftCostEur: null, heroCostEur: null, withHero: false });
  assert.equal(noHero.drafts, 25);
  assert.equal(noHero.heroes, 0);
  assert.equal(noHero.costEur, null);
  assert.equal(noHero.seconds, 25 * SECONDS_PER_DRAFT);

  // Hero cost unknown but heroes wanted → the estimate cannot be given.
  const unknownHero = prepareEstimate({ count: 10, pendingSendable: 10, draftCostEur: 0.02, heroCostEur: null, withHero: true });
  assert.equal(unknownHero.costEur, null);
});

test("progress is sends against the day's queue", () => {
  assert.deepEqual(deskProgress(37, 18), { done: 37, total: 55, ratio: 37 / 55 });
  assert.deepEqual(deskProgress(0, 0), { done: 0, total: 0, ratio: 0 });
});

test("the outbox keeps one entry per contact, newest first, capped", () => {
  let box = [];
  box = upsertOutbox(box, { contactId: 1, status: "sending" }, 2);
  box = upsertOutbox(box, { contactId: 2, status: "sending" }, 2);
  box = upsertOutbox(box, { contactId: 1, status: "sent" }, 2);
  assert.deepEqual(box, [
    { contactId: 1, status: "sent" },
    { contactId: 2, status: "sending" },
  ]);
  box = upsertOutbox(box, { contactId: 3, status: "sending" }, 2);
  assert.deepEqual(
    box.map((e) => e.contactId),
    [3, 1]
  );
});
