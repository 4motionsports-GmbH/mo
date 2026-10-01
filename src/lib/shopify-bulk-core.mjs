// Shopify bulk-operation results (JSONL) → mirror rows, chunk by chunk (pure).
//
// The initial import (lib/shopify-sync.ts) runs two bulk queries — customers,
// then orders with their line items — and reads each result file in byte
// ranges, so every step of the resumable import stays inside a serverless
// time budget. This module holds the parts that need no network:
//
//   * splitJsonlBytes — cut a byte range at its last newline (multi-byte
//     UTF-8 characters are never split), returning the complete lines and how
//     many bytes they used; the rest is read again by the next step.
//   * groupBulkLines  — sort parsed lines into customers, orders and the line
//     items of each order (`__parentId` = the order's GID).
//
// Bulk JSONL puts nested connection nodes on their own lines with
// `__parentId`, after their parent. A chunk may therefore hold line items
// whose order line was in an earlier chunk; the store appends them in the
// same transaction that advances the offset, so a retried step never
// duplicates items.

const NEWLINE = 0x0a;

/**
 * @param {Uint8Array} bytes  the range just read
 * @param {boolean} atEnd     true when the range reaches the end of the file
 * @returns {{ lines: string[], consumedBytes: number }}
 */
export function splitJsonlBytes(bytes, atEnd) {
  if (!bytes || bytes.length === 0) return { lines: [], consumedBytes: 0 };
  let cut = -1;
  for (let i = bytes.length - 1; i >= 0; i--) {
    if (bytes[i] === NEWLINE) {
      cut = i;
      break;
    }
  }
  const usable = atEnd ? bytes.length : cut + 1;
  if (usable <= 0) return { lines: [], consumedBytes: 0 };
  const text = new TextDecoder("utf-8").decode(bytes.subarray(0, usable));
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  return { lines, consumedBytes: usable };
}

/** The resource type of a GID ("gid://shopify/Order/1" → "Order"). */
export function gidType(gid) {
  if (typeof gid !== "string") return null;
  const m = gid.match(/^gid:\/\/shopify\/(\w+)\//);
  return m ? m[1] : null;
}

/**
 * @param {string[]} lines
 * @returns {{
 *   customers: any[],
 *   orders: any[],
 *   lineItemsByOrder: Map<string, any[]>,
 *   invalid: number,
 * }}
 */
export function groupBulkLines(lines) {
  const customers = [];
  const orders = [];
  /** @type {Map<string, any[]>} */
  const lineItemsByOrder = new Map();
  let invalid = 0;
  for (const line of lines ?? []) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      invalid++;
      continue;
    }
    if (!obj || typeof obj !== "object") {
      invalid++;
      continue;
    }
    const parent = typeof obj.__parentId === "string" ? obj.__parentId : null;
    if (parent && gidType(parent) === "Order") {
      const list = lineItemsByOrder.get(parent) ?? [];
      list.push(obj);
      lineItemsByOrder.set(parent, list);
      continue;
    }
    const type = gidType(obj.id);
    if (type === "Customer") customers.push(obj);
    else if (type === "Order") orders.push(obj);
    else invalid++;
  }
  return { customers, orders, lineItemsByOrder, invalid };
}

/** Bytes per import step: big enough to make progress, small enough for 300 s. */
export const BULK_CHUNK_BYTES = 4 * 1024 * 1024;

/** The two bulk queries of the import, in order. */
export const IMPORT_KINDS = /** @type {const} */ (["import_customers", "import_orders"]);

/** Next import kind after `kind`, or null when the import is complete. */
export function nextImportKind(kind) {
  const i = IMPORT_KINDS.indexOf(kind);
  return i >= 0 && i < IMPORT_KINDS.length - 1 ? IMPORT_KINDS[i + 1] : null;
}
