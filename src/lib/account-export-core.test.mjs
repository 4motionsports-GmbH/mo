import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GIFT_VOUCHER_EXPORT_HIDDEN_COLUMNS, giftVoucherExportEntry } from "./account-export-core.mjs";

// A row as the export query reads it (Neon: BIGINT as a string, timestamptz as a Date).
const ROW = {
  id: "42",
  source: "shop",
  status: "issued",
  amount_cents: 5000,
  code_last4: "NPQR",
  buyer_email: "max@example.de",
  recipient_name: "Oma Erna",
  message: "Alles Gute",
  created_at: new Date("2026-11-20T10:00:00Z"),
  has_photo: false,
  print_status: "sent",
  print_address: { name: "Erna Muster", address_line_1: "Weg 1", postal_code: "80331", city: "München", country: "DE" },
};

test("giftVoucherExportEntry: the number people see comes first, the row follows unchanged", () => {
  const e = giftVoucherExportEntry(ROW);
  assert.equal(Object.keys(e)[0], "number");
  assert.equal(e.number, "G-2026-00042");
  assert.deepEqual({ ...e, number: undefined }, { number: undefined, ...ROW });
});

test("giftVoucherExportEntry: numeric id and ISO string work; the year is the Berlin year of creation", () => {
  assert.equal(giftVoucherExportEntry({ id: 7, created_at: "2026-03-01T08:00:00.000Z" }).number, "G-2026-00007");
  // 31 Dec 23:30 UTC is already 1 January in Berlin.
  assert.equal(giftVoucherExportEntry({ id: 8, created_at: "2026-12-31T23:30:00.000Z" }).number, "G-2027-00008");
});

test("giftVoucherExportEntry: without an id or a creation date the number is null, the row still exported", () => {
  assert.equal(giftVoucherExportEntry({ id: null, created_at: ROW.created_at }).number, null);
  const e = giftVoucherExportEntry({ id: "9", message: "Hallo" });
  assert.equal(e.number, null);
  assert.equal(e.message, "Hallo");
});

test("giftVoucherExportEntry: the code, its hash, the link token hash and the admin note never leave", () => {
  assert.deepEqual([...GIFT_VOUCHER_EXPORT_HIDDEN_COLUMNS].sort(), ["admin_note", "code_enc", "code_hash", "download_token_hash"]);
  const e = giftVoucherExportEntry({
    ...ROW,
    code_enc: "c2VjcmV0",
    code_hash: "a".repeat(64),
    download_token_hash: "b".repeat(64),
    admin_note: "intern",
  });
  for (const column of GIFT_VOUCHER_EXPORT_HIDDEN_COLUMNS) assert.ok(!(column in e), `${column} must not be exported`);
  assert.equal(e.code_last4, "NPQR", "the last four stay (shown on the voucher anyway)");
  assert.ok(Object.isFrozen(GIFT_VOUCHER_EXPORT_HIDDEN_COLUMNS));
});

// ── Guardrails (source-level: tests cannot import lib/account-export.ts) ──────
test("GUARDRAIL: the export reads the vouchers once 0083 exists, matched like the erasure, never a secret column", () => {
  const src = readFileSync(new URL("./account-export.ts", import.meta.url), "utf8").replace(/\s+/g, " ");
  const start = src.indexOf("const giftVouchers = (await giftVoucherTablesExist(sql))");
  assert.ok(start > 0, "the voucher section is gated on giftVoucherTablesExist (a database before 0083 still exports)");
  const end = src.indexOf(".map(giftVoucherExportEntry)", start);
  assert.ok(end > start, "every row goes through giftVoucherExportEntry");
  const query = src.slice(start, end);
  for (const column of GIFT_VOUCHER_EXPORT_HIDDEN_COLUMNS) assert.ok(!query.includes(column), `never selects ${column}`);
  assert.ok(!/\bv\.\*|SELECT \*/.test(query), "columns are listed, never *");
  for (const match of [
    "LEFT JOIN gift_voucher_print_jobs j ON j.voucher_id = v.id",
    "v.customer_id = ${customerId}",
    "(v.shopify_customer_id IS NOT NULL AND v.shopify_customer_id = ${customer.shopifyCustomerId}::text)",
    "lower(v.buyer_email) = lower(${email}::text)",
    "lower(v.recipient_email) = lower(${email}::text)",
    "LIMIT ${MAX_ROWS}",
  ]) {
    assert.ok(query.includes(match), `query has ${match}`);
  }
  assert.ok(/suppression: \{ marketing: suppMarketing \}, giftVouchers, \};/.test(src), "giftVouchers is part of the export");
});
