import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GIFT_VOUCHER_SETTINGS_KEY,
  DEFAULT_GIFT_VOUCHER_SETTINGS,
  GIFT_VOUCHER_SETTING_LABELS,
  parseGiftVoucherSettings,
  validateGiftVoucherSettingsInput,
} from "./gift-voucher-settings.mjs";

const ALL_ON = { salesEnabled: true, aiSuggestions: true, photoUploads: true, reviewPrintWithPhoto: true };

test("key and defaults: everything on, frozen", () => {
  assert.equal(GIFT_VOUCHER_SETTINGS_KEY, "gift_vouchers");
  assert.deepEqual(DEFAULT_GIFT_VOUCHER_SETTINGS, ALL_ON);
  assert.ok(Object.isFrozen(DEFAULT_GIFT_VOUCHER_SETTINGS));
  assert.deepEqual(Object.keys(GIFT_VOUCHER_SETTING_LABELS), Object.keys(ALL_ON));
});

test("parseGiftVoucherSettings: missing or broken values take their default, per field", () => {
  for (const v of [undefined, null, "x", 5, [], [true]]) assert.deepEqual(parseGiftVoucherSettings(v), ALL_ON, String(v));
  assert.deepEqual(parseGiftVoucherSettings({ salesEnabled: false, aiSuggestions: "no", photoUploads: 0 }), {
    ...ALL_ON,
    salesEnabled: false,
  });
  assert.deepEqual(
    parseGiftVoucherSettings({ salesEnabled: false, aiSuggestions: false, photoUploads: false, reviewPrintWithPhoto: false, extra: 1 }),
    { salesEnabled: false, aiSuggestions: false, photoUploads: false, reviewPrintWithPhoto: false }
  );
});

test("parseGiftVoucherSettings: never hands out the frozen default object", () => {
  const s = parseGiftVoucherSettings(null);
  s.salesEnabled = false;
  assert.equal(DEFAULT_GIFT_VOUCHER_SETTINGS.salesEnabled, true);
});

test("validateGiftVoucherSettingsInput: every switch must be a boolean (German messages)", () => {
  assert.deepEqual(validateGiftVoucherSettingsInput({ ...ALL_ON, photoUploads: false }), {
    ok: true,
    settings: { ...ALL_ON, photoUploads: false },
  });
  assert.deepEqual(validateGiftVoucherSettingsInput(null), { ok: false, message: "Ungültige Einstellungen." });
  assert.deepEqual(validateGiftVoucherSettingsInput([]), { ok: false, message: "Ungültige Einstellungen." });
  assert.deepEqual(validateGiftVoucherSettingsInput({ ...ALL_ON, salesEnabled: "true" }), {
    ok: false,
    message: "„Verkauf im Shop“ fehlt.",
  });
  const partial = { salesEnabled: true, aiSuggestions: true, photoUploads: true };
  assert.deepEqual(validateGiftVoucherSettingsInput(partial), { ok: false, message: "„Druck mit eigenem Foto prüfen“ fehlt." });
  const ok = validateGiftVoucherSettingsInput({ ...ALL_ON, junk: "x" });
  assert.ok(ok.ok);
  assert.deepEqual(Object.keys(ok.settings), Object.keys(ALL_ON), "unknown fields are dropped");
});
