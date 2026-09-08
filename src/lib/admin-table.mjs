// Pure sorting + paging helpers behind the admin DataTable / Pagination
// primitives (no I/O — unit-tested with node:test). Kept out of the React
// components so the comparison rules (nulls last, German collation, numeric
// strings) are testable and identical wherever a list is sorted.

const collator = new Intl.Collator("de", { numeric: true, sensitivity: "base" });

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isEmpty(value) {
  return (
    value === null ||
    value === undefined ||
    value === "" ||
    (typeof value === "number" && Number.isNaN(value))
  );
}

/**
 * Compare two cell values for sorting. Empty values sort last in BOTH
 * directions; numbers and Dates compare numerically, booleans false < true,
 * everything else through a German, numeric-aware collator.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {number}
 */
export function compareValues(a, b) {
  const aEmpty = isEmpty(a);
  const bEmpty = isEmpty(b);
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return collator.compare(String(a), String(b));
}

/**
 * Stable sort of `rows` by `getValue(row)`. `dir` flips the order of present
 * values only — empty values stay at the end either way.
 * @template T
 * @param {T[]} rows
 * @param {(row: T) => unknown} getValue
 * @param {"asc" | "desc"} [dir]
 * @returns {T[]} a new array
 */
export function sortRows(rows, getValue, dir = "asc") {
  const sign = dir === "desc" ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index, value: getValue(row) }))
    .sort((x, y) => {
      const bothPresent = !isEmpty(x.value) && !isEmpty(y.value);
      const c = compareValues(x.value, y.value) * (bothPresent ? sign : 1);
      return c !== 0 ? c : x.index - y.index;
    })
    .map((entry) => entry.row);
}

/**
 * Number of pages for `total` items (at least 1 so a page indicator never
 * reads "Seite 1 von 0").
 * @param {number} total
 * @param {number} pageSize
 */
export function pageCount(total, pageSize) {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  return Math.max(1, Math.ceil(Math.max(0, total) / size));
}

/**
 * Clamp a 1-based page index into `[1, count]`.
 * @param {unknown} page
 * @param {number} count
 */
export function clampPage(page, count) {
  const n = Math.floor(Number(page));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, Math.max(1, count));
}

/**
 * Slice one 1-based page out of `rows`.
 * @template T
 * @param {T[]} rows
 * @param {number} page
 * @param {number} pageSize
 * @returns {T[]}
 */
export function paginate(rows, page, pageSize) {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const current = clampPage(page, pageCount(rows.length, size));
  const start = (current - 1) * size;
  return rows.slice(start, start + size);
}

/**
 * Page numbers to render in a pager, with "…" gaps — always `max` entries when
 * there are more pages than fit, always including the first and last page.
 *   pageWindow(10, 20) → [1, "…", 9, 10, 11, "…", 20]
 * @param {number} page current 1-based page
 * @param {number} count total pages
 * @param {number} [max] slots (odd numbers look balanced; minimum 5)
 * @returns {(number | "…")[]}
 */
export function pageWindow(page, count, max = 7) {
  const total = Math.max(1, Math.floor(count) || 1);
  const slots = Math.max(5, Math.floor(max) || 5);
  if (total <= slots) return Array.from({ length: total }, (_, i) => i + 1);

  const current = clampPage(page, total);
  const inner = slots - 2; // slots between the fixed first and last page
  let start = current - Math.floor(inner / 2);
  start = Math.max(2, Math.min(start, total - inner));
  const end = start + inner - 1;

  /** @type {(number | "…")[]} */
  const middle = Array.from({ length: inner }, (_, i) => start + i);
  if (start > 2) middle[0] = "…";
  if (end < total - 1) middle[middle.length - 1] = "…";
  return [1, ...middle, total];
}
