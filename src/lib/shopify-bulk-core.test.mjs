import { test } from "node:test";
import assert from "node:assert/strict";
import { splitJsonlBytes, groupBulkLines, gidType, nextImportKind } from "./shopify-bulk-core.mjs";

const enc = (s) => new TextEncoder().encode(s);

test("splitJsonlBytes keeps the incomplete tail for the next step", () => {
  const bytes = enc('{"a":1}\n{"b":2}\n{"c":');
  const r = splitJsonlBytes(bytes, false);
  assert.deepEqual(r.lines, ['{"a":1}', '{"b":2}']);
  assert.equal(r.consumedBytes, enc('{"a":1}\n{"b":2}\n').length);
});

test("splitJsonlBytes consumes everything at the end of the file", () => {
  const r = splitJsonlBytes(enc('{"a":1}\n{"b":2}'), true);
  assert.deepEqual(r.lines, ['{"a":1}', '{"b":2}']);
  assert.equal(r.consumedBytes, enc('{"a":1}\n{"b":2}').length);
});

test("splitJsonlBytes never cuts a multi-byte character", () => {
  const full = enc('{"n":"Müller"}\n{"n":"Größe"}\n');
  // Cut inside the "ö" of the second line.
  const cutAt = full.indexOf(0xc3, enc('{"n":"Müller"}\n').length);
  const r = splitJsonlBytes(full.subarray(0, cutAt + 1), false);
  assert.deepEqual(r.lines, ['{"n":"Müller"}']);
  assert.equal(JSON.parse(r.lines[0]).n, "Müller");
});

test("splitJsonlBytes without any newline consumes nothing mid-file", () => {
  assert.deepEqual(splitJsonlBytes(enc('{"partial":'), false), { lines: [], consumedBytes: 0 });
  assert.deepEqual(splitJsonlBytes(new Uint8Array(0), true), { lines: [], consumedBytes: 0 });
});

test("groupBulkLines sorts customers, orders and line items", () => {
  const g = groupBulkLines([
    JSON.stringify({ id: "gid://shopify/Customer/1", email: "a@b.de" }),
    JSON.stringify({ id: "gid://shopify/Order/10", name: "#10" }),
    JSON.stringify({ title: "Rack", quantity: 1, __parentId: "gid://shopify/Order/10" }),
    JSON.stringify({ title: "Matte", quantity: 2, __parentId: "gid://shopify/Order/10" }),
    JSON.stringify({ title: "Orphan", __parentId: "gid://shopify/Order/9" }),
    "not json",
    JSON.stringify({ id: "gid://shopify/Product/5" }),
  ]);
  assert.equal(g.customers.length, 1);
  assert.equal(g.orders.length, 1);
  assert.equal(g.lineItemsByOrder.get("gid://shopify/Order/10").length, 2);
  assert.equal(g.lineItemsByOrder.get("gid://shopify/Order/9").length, 1);
  assert.equal(g.invalid, 2);
});

test("gidType and the import order", () => {
  assert.equal(gidType("gid://shopify/LineItem/3"), "LineItem");
  assert.equal(gidType("nope"), null);
  assert.equal(nextImportKind("import_customers"), "import_orders");
  assert.equal(nextImportKind("import_orders"), null);
});
