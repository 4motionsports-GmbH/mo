import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTACT_FREQUENCY_COUNTED,
  CONTACT_FREQUENCY_HINT_DETAIL,
  CONTACT_FREQUENCY_LIMITS,
  DEFAULT_CONTACT_FREQUENCY,
  contactFrequencyConflict,
  contactFrequencyEnabled,
  contactFrequencyMessage,
  contactFrequencyQuestion,
  contactFrequencySummary,
  contactFrequencyTitle,
  contactFrequencyWarning,
  marketingMailsText,
  parseContactFrequency,
  readContactFrequencyConflict,
  recentMailsText,
  sendIntervalLabel,
  validateContactFrequencyInput,
} from "./contact-frequency.mjs";

test("defaults: 3 marketing mails in 30 days, bounds 0–50 and 0–365", () => {
  assert.deepEqual({ ...DEFAULT_CONTACT_FREQUENCY }, { maxMails: 3, windowDays: 30 });
  assert.equal(Object.isFrozen(DEFAULT_CONTACT_FREQUENCY), true);
  assert.deepEqual(
    { maxMails: { ...CONTACT_FREQUENCY_LIMITS.maxMails }, windowDays: { ...CONTACT_FREQUENCY_LIMITS.windowDays } },
    { maxMails: { min: 0, max: 50 }, windowDays: { min: 0, max: 365 } }
  );
});

test("parseContactFrequency: a stored object, its JSON text and digit strings", () => {
  assert.deepEqual(parseContactFrequency({ maxMails: 5, windowDays: 14 }), { maxMails: 5, windowDays: 14 });
  assert.deepEqual(parseContactFrequency('{"maxMails":2,"windowDays":7}'), { maxMails: 2, windowDays: 7 });
  assert.deepEqual(parseContactFrequency({ maxMails: " 4 ", windowDays: "60" }), { maxMails: 4, windowDays: 60 });
  // 0 is a valid value (off) and must not fall back to the default.
  assert.deepEqual(parseContactFrequency({ maxMails: 0, windowDays: 0 }), { maxMails: 0, windowDays: 0 });
  assert.deepEqual(parseContactFrequency({ maxMails: 50, windowDays: 365 }), { maxMails: 50, windowDays: 365 });
});

test("parseContactFrequency: missing, broken or out-of-bounds fields take their default", () => {
  for (const raw of [undefined, null, "", "nope", "[]", [], 42, true]) {
    assert.deepEqual(parseContactFrequency(raw), { maxMails: 3, windowDays: 30 }, JSON.stringify(raw));
  }
  assert.deepEqual(parseContactFrequency({ maxMails: 51, windowDays: 366 }), { maxMails: 3, windowDays: 30 });
  assert.deepEqual(parseContactFrequency({ maxMails: -1, windowDays: 2.5 }), { maxMails: 3, windowDays: 30 });
  assert.deepEqual(parseContactFrequency({ maxMails: "3a", windowDays: NaN }), { maxMails: 3, windowDays: 30 });
  // Per field: a broken window keeps a valid threshold.
  assert.deepEqual(parseContactFrequency({ maxMails: 6, windowDays: "x" }), { maxMails: 6, windowDays: 30 });
});

test("validateContactFrequencyInput: strict, both fields, German messages", () => {
  assert.deepEqual(validateContactFrequencyInput({ maxMails: 4, windowDays: 21 }), {
    ok: true,
    settings: { maxMails: 4, windowDays: 21 },
  });
  assert.deepEqual(validateContactFrequencyInput({ maxMails: "0", windowDays: "0" }), {
    ok: true,
    settings: { maxMails: 0, windowDays: 0 },
  });
  const noMails = validateContactFrequencyInput({ windowDays: 30 });
  assert.equal(noMails.ok, false);
  assert.match(noMails.ok ? "" : noMails.message, /Warnung ab.*0 bis 50/);
  const badDays = validateContactFrequencyInput({ maxMails: 3, windowDays: 400 });
  assert.equal(badDays.ok, false);
  assert.match(badDays.ok ? "" : badDays.message, /Zeitraum.*0 bis 365/);
  for (const raw of [null, "x", [], { maxMails: 1.5, windowDays: 30 }, { maxMails: 3, windowDays: -2 }]) {
    assert.equal(validateContactFrequencyInput(raw).ok, false, JSON.stringify(raw));
  }
});

test("contactFrequencyEnabled: 0 in either field switches the warning off", () => {
  assert.equal(contactFrequencyEnabled({ maxMails: 3, windowDays: 30 }), true);
  assert.equal(contactFrequencyEnabled({ maxMails: 0, windowDays: 30 }), false);
  assert.equal(contactFrequencyEnabled({ maxMails: 3, windowDays: 0 }), false);
  // No stored setting: the default is on.
  assert.equal(contactFrequencyEnabled(null), true);
});

test("contactFrequencyWarning: at/over the threshold only (before the 4th by default)", () => {
  const settings = { maxMails: 3, windowDays: 30 };
  assert.equal(contactFrequencyWarning({ count: 0, settings }), null);
  assert.equal(contactFrequencyWarning({ count: 2, settings }), null);
  assert.deepEqual(contactFrequencyWarning({ count: 3, settings }), { count: 3, maxMails: 3, windowDays: 30 });
  assert.deepEqual(contactFrequencyWarning({ count: 7, settings }), { count: 7, maxMails: 3, windowDays: 30 });
});

test("contactFrequencyWarning: off, unknown or broken counts never warn", () => {
  assert.equal(contactFrequencyWarning({ count: 10, settings: { maxMails: 0, windowDays: 30 } }), null);
  assert.equal(contactFrequencyWarning({ count: 10, settings: { maxMails: 3, windowDays: 0 } }), null);
  for (const count of [null, undefined, NaN, -1, "5"]) {
    assert.equal(contactFrequencyWarning({ count: /** @type {any} */ (count), settings: { maxMails: 1, windowDays: 30 } }), null);
  }
  // Without settings the default applies.
  assert.deepEqual(contactFrequencyWarning({ count: 3, settings: undefined }), { count: 3, maxMails: 3, windowDays: 30 });
});

test("German texts carry the numbers with singular/plural", () => {
  assert.equal(marketingMailsText(1), "1 Werbe-Mail");
  assert.equal(marketingMailsText(3), "3 Werbe-Mails");
  assert.equal(recentMailsText(3, 30), "3 Werbe-Mails in 30 Tagen");
  assert.equal(recentMailsText(1, 1), "1 Werbe-Mail in 1 Tag");
  const w = { count: 3, maxMails: 3, windowDays: 30 };
  assert.equal(contactFrequencyTitle(w), "Schon 3 Werbe-Mails in 30 Tagen");
  assert.equal(
    contactFrequencyQuestion(w),
    "Schon 3 Werbe-Mails in den letzten 30 Tagen an diese Adresse — trotzdem senden?"
  );
  assert.equal(
    contactFrequencyQuestion({ count: 1, maxMails: 1, windowDays: 1 }),
    "Schon 1 Werbe-Mail am letzten Tag an diese Adresse — trotzdem senden?"
  );
  const message = contactFrequencyMessage({ count: 4, maxMails: 3, windowDays: 30 });
  assert.match(message, /in den letzten 30 Tagen schon 4 Werbe-Mails/);
  assert.match(message, /Warnung ab 3/);
  assert.match(CONTACT_FREQUENCY_COUNTED, /Einzelansprache/);
  assert.match(CONTACT_FREQUENCY_COUNTED, /Testmails/);
  assert.ok(CONTACT_FREQUENCY_HINT_DETAIL.startsWith("Nur ein Hinweis"));
});

test("summaries: the warning setting and the hard cap read differently", () => {
  assert.equal(contactFrequencySummary({ maxMails: 3, windowDays: 30 }), "Warnung ab 3 Werbe-Mails in 30 Tagen");
  assert.equal(contactFrequencySummary({ maxMails: 0, windowDays: 30 }), "Aus");
  assert.equal(sendIntervalLabel(0), "aus");
  assert.equal(sendIntervalLabel(Number.NaN), "aus");
  assert.equal(sendIntervalLabel(1), "1 Tag");
  assert.equal(sendIntervalLabel(14), "14 Tage");
});

test("the 409 body round-trips through the client reader", () => {
  const w = { count: 4, maxMails: 3, windowDays: 30 };
  const body = contactFrequencyConflict(w);
  assert.equal(body.error.code, "contact_frequency");
  assert.equal(body.error.message, contactFrequencyMessage(w));
  assert.deepEqual(body.frequency, w);
  assert.deepEqual(readContactFrequencyConflict(JSON.parse(JSON.stringify(body))), w);
});

test("readContactFrequencyConflict: anything else is null", () => {
  for (const body of [
    null,
    "contact_frequency",
    {},
    { error: { code: "too_soon", message: "x" } },
    { error: { code: "contact_frequency" } },
    { error: { code: "contact_frequency" }, frequency: { count: "a", maxMails: 3, windowDays: 30 } },
    { error: { code: "contact_frequency" }, frequency: { count: 2, maxMails: -1, windowDays: 30 } },
  ]) {
    assert.equal(readContactFrequencyConflict(body), null, JSON.stringify(body));
  }
});
