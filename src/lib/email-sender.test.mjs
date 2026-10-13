import { test } from "node:test";
import assert from "node:assert/strict";
import { MO_SENDER_NAME, formatSender, mailboxAddress, quoteDisplayName, replyToFor } from "./email-sender.mjs";

test("the sender name is the brand in lower case", () => {
  assert.equal(MO_SENDER_NAME, "Mo von motion sports");
});

test("mailboxAddress: the bare address of every mailbox shape", () => {
  assert.equal(mailboxAddress("Mo von Motion Sports <hello@mo.motionsports.de>"), "hello@mo.motionsports.de");
  assert.equal(mailboxAddress('"Mo, motion sports" <mo@motionsports.de>'), "mo@motionsports.de");
  assert.equal(mailboxAddress("<mo@motionsports.de>"), "mo@motionsports.de");
  assert.equal(mailboxAddress("  mo@motionsports.de  "), "mo@motionsports.de");
  assert.equal(mailboxAddress("Mo@MotionSports.de"), "Mo@MotionSports.de");
  for (const junk of ["", "   ", "Mo von motion sports", "mo@", "@motionsports.de", "mo@localhost", undefined, null, 42]) {
    assert.equal(mailboxAddress(junk), "", String(junk));
  }
});

test("formatSender: the code's name replaces whatever name the env value carries", () => {
  assert.equal(formatSender("Mo von Motion Sports <hello@mo.motionsports.de>"), "Mo von motion sports <hello@mo.motionsports.de>");
  assert.equal(formatSender("mo@motionsports.de"), "Mo von motion sports <mo@motionsports.de>");
  assert.equal(formatSender("<mo@motionsports.de>"), "Mo von motion sports <mo@motionsports.de>");
});

test("formatSender: EMAIL_SENDER_NAME overrides the name; blank falls back", () => {
  assert.equal(formatSender("mo@motionsports.de", "motion sports"), "motion sports <mo@motionsports.de>");
  assert.equal(formatSender("mo@motionsports.de", "   "), "Mo von motion sports <mo@motionsports.de>");
  assert.equal(formatSender("mo@motionsports.de", undefined), "Mo von motion sports <mo@motionsports.de>");
});

test("formatSender: no address → not configured", () => {
  assert.equal(formatSender(undefined), undefined);
  assert.equal(formatSender(""), undefined);
  assert.equal(formatSender("Mo von motion sports"), undefined);
});

test("quoteDisplayName: plain words stay, specials are quoted and escaped", () => {
  assert.equal(quoteDisplayName("Mo von motion sports"), "Mo von motion sports");
  assert.equal(quoteDisplayName("  Mo   von motion sports "), "Mo von motion sports");
  assert.equal(quoteDisplayName("Mö Grüße"), "Mö Grüße");
  assert.equal(quoteDisplayName("Mo, motion sports"), '"Mo, motion sports"');
  assert.equal(quoteDisplayName('Mo "der Berater"'), '"Mo \\"der Berater\\""');
  assert.equal(quoteDisplayName("Mo <motion sports>"), '"Mo <motion sports>"');
});

test("replyToFor: the inbound address, none when it is the From address", () => {
  assert.equal(replyToFor("hello@reply.motionsports.de", "Mo von motion sports <hello@mo.motionsports.de>"), "hello@reply.motionsports.de");
  assert.equal(replyToFor("mo@motionsports.de", "Mo von motion sports <mo@motionsports.de>"), undefined);
  assert.equal(replyToFor("MO@motionsports.de", "Mo von motion sports <mo@MotionSports.de>"), undefined);
  assert.equal(replyToFor("Mo <hello@reply.motionsports.de>", undefined), "hello@reply.motionsports.de");
  assert.equal(replyToFor(undefined, "mo@motionsports.de"), undefined);
  assert.equal(replyToFor("  ", "mo@motionsports.de"), undefined);
});
