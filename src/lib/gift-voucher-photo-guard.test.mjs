// A photo voucher is never delivered in the „Klassisch“ look: every caller that
// loads the photo for a delivered voucher (print files, mail PDF, download PDF)
// asks the one tested rule, gift-voucher-core.mjs isGiftVoucherPhotoUnavailable,
// and loadGiftVoucherPhoto never hands on an empty body. The callers are
// TypeScript, which tests cannot import — so these are source-level guardrails.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const squash = (s) => s.replace(/\s+/g, " ");

const CALLERS = [
  ["print files", "./gift-voucher-print.ts"],
  ["mail PDF", "./gift-voucher-mail.ts"],
  ["download PDF", "../app/api/gift-vouchers/download/route.ts"],
];

test("GUARDRAIL: the delivered-voucher callers use isGiftVoucherPhotoUnavailable, not a copy of the rule", () => {
  for (const [what, file] of CALLERS) {
    const src = read(file);
    assert.ok(src.includes("loadGiftVoucherPhoto("), `${what}: loads the photo`);
    assert.match(src, /if \(isGiftVoucherPhotoUnavailable\((voucher|v), photo\)\)/, `${what}: asks the shared rule`);
    // The old copy tested `!photo`, which let an empty Buffer through.
    assert.ok(!/photoPathname && !photo\)/.test(src), `${what}: no copy-pasted \`!photo\` guard`);
  }
});

test("GUARDRAIL: loadGiftVoucherPhoto hands on no empty body, and an empty photo given to a delivered render fails", () => {
  const src = squash(read("./gift-voucher-render.ts"));
  assert.ok(
    src.includes("return file && hasGiftVoucherPhotoBytes(file.bytes) ? file.bytes : null;"),
    "a 200 with an empty body is no photo"
  );
  assert.ok(src.includes("if (designOf(input.designKey).photo && input.photo != null && !photo) {"), "any given photo counts");
});
