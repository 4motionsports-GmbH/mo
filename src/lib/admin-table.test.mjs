import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampPage,
  compareValues,
  pageCount,
  pageWindow,
  paginate,
  sortRows,
} from "./admin-table.mjs";

test("compareValues orders numbers, dates, booleans and German strings", () => {
  assert.ok(compareValues(1, 2) < 0);
  assert.ok(compareValues(new Date("2026-01-02"), new Date("2026-01-01")) > 0);
  assert.ok(compareValues(false, true) < 0);
  assert.ok(compareValues("Äpfel", "Birnen") < 0);
  assert.equal(compareValues("a", "A"), 0);
  assert.ok(compareValues("Entwurf 2", "Entwurf 10") < 0, "numeric-aware");
});

test("compareValues puts empty values last", () => {
  assert.ok(compareValues(null, 1) > 0);
  assert.ok(compareValues(1, undefined) < 0);
  assert.ok(compareValues("", "a") > 0);
  assert.ok(compareValues(Number.NaN, 0) > 0);
  assert.equal(compareValues(null, undefined), 0);
});

test("sortRows is stable and keeps empties last in both directions", () => {
  const rows = [
    { id: "a", n: 3 },
    { id: "b", n: null },
    { id: "c", n: 1 },
    { id: "d", n: 3 },
    { id: "e", n: undefined },
  ];
  assert.deepEqual(
    sortRows(rows, (r) => r.n, "asc").map((r) => r.id),
    ["c", "a", "d", "b", "e"]
  );
  assert.deepEqual(
    sortRows(rows, (r) => r.n, "desc").map((r) => r.id),
    ["a", "d", "c", "b", "e"]
  );
  assert.notStrictEqual(sortRows(rows, (r) => r.n), rows, "returns a new array");
});

test("pageCount and clampPage never produce page 0", () => {
  assert.equal(pageCount(0, 25), 1);
  assert.equal(pageCount(25, 25), 1);
  assert.equal(pageCount(26, 25), 2);
  assert.equal(pageCount(10, 0), 10, "page size floors to 1");
  assert.equal(clampPage(0, 3), 1);
  assert.equal(clampPage(99, 3), 3);
  assert.equal(clampPage("2", 3), 2);
  assert.equal(clampPage("x", 3), 1);
});

test("paginate slices a 1-based page and clamps out-of-range pages", () => {
  const rows = Array.from({ length: 12 }, (_, i) => i + 1);
  assert.deepEqual(paginate(rows, 1, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(paginate(rows, 3, 5), [11, 12]);
  assert.deepEqual(paginate(rows, 9, 5), [11, 12], "clamped to last page");
  assert.deepEqual(paginate([], 1, 5), []);
});

test("pageWindow renders every page when they fit", () => {
  assert.deepEqual(pageWindow(1, 1), [1]);
  assert.deepEqual(pageWindow(3, 7), [1, 2, 3, 4, 5, 6, 7]);
});

test("pageWindow keeps first/last and places gaps around the current page", () => {
  assert.deepEqual(pageWindow(1, 20), [1, 2, 3, 4, 5, "…", 20]);
  assert.deepEqual(pageWindow(4, 20), [1, 2, 3, 4, 5, "…", 20]);
  assert.deepEqual(pageWindow(5, 20), [1, "…", 4, 5, 6, "…", 20]);
  assert.deepEqual(pageWindow(10, 20), [1, "…", 9, 10, 11, "…", 20]);
  assert.deepEqual(pageWindow(17, 20), [1, "…", 16, 17, 18, 19, 20]);
  assert.deepEqual(pageWindow(20, 20), [1, "…", 16, 17, 18, 19, 20]);
  assert.equal(pageWindow(50, 100, 9).length, 9);
  assert.deepEqual(pageWindow(3, 10, 5), [1, 2, 3, "…", 10]);
});
