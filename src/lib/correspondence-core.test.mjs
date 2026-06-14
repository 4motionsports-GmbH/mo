import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatGermanDate,
  renderCorrespondenceMessage,
  renderCorrespondence,
  MAX_CORRESPONDENCE_IN_PROMPT,
  MAX_BODY_CHARS_PER_MESSAGE,
} from "./correspondence-core.mjs";

test("formatGermanDate zero-pads to DD.MM.YYYY", () => {
  assert.equal(formatGermanDate("2026-06-12T08:30:00.000Z"), "12.06.2026");
  assert.equal(formatGermanDate("2026-01-05T00:00:00.000Z"), "05.01.2026");
});

test("formatGermanDate returns '' for missing/invalid dates", () => {
  assert.equal(formatGermanDate(null), "");
  assert.equal(formatGermanDate(""), "");
  assert.equal(formatGermanDate("not-a-date"), "");
});

test("renderCorrespondenceMessage labels by direction and shows the date", () => {
  const received = renderCorrespondenceMessage({
    direction: "received",
    occurredAt: "2026-06-12T08:30:00.000Z",
    bodyText: "Wann kommt meine Lieferung?",
  });
  assert.equal(received, "Kunde schrieb (12.06.2026):\nWann kommt meine Lieferung?");

  const sent = renderCorrespondenceMessage({
    direction: "sent",
    occurredAt: "2026-06-13T09:00:00.000Z",
    bodyText: "Deine Lieferung ist unterwegs.",
  });
  assert.equal(sent, "motion sports schrieb (13.06.2026):\nDeine Lieferung ist unterwegs.");
});

test("renderCorrespondenceMessage clips a long body per-message", () => {
  const body = "x".repeat(MAX_BODY_CHARS_PER_MESSAGE + 500);
  const out = renderCorrespondenceMessage({
    direction: "received",
    occurredAt: "2026-06-12T08:30:00.000Z",
    bodyText: body,
  });
  assert.ok(out.includes("[… gekürzt]"));
  // Body kept = exactly the cap; the rest is dropped.
  assert.ok(out.includes("x".repeat(MAX_BODY_CHARS_PER_MESSAGE)));
  assert.ok(!out.includes("x".repeat(MAX_BODY_CHARS_PER_MESSAGE + 1)));
});

test("renderCorrespondenceMessage handles an empty body", () => {
  const out = renderCorrespondenceMessage({
    direction: "sent",
    occurredAt: "2026-06-12T08:30:00.000Z",
    bodyText: "",
  });
  assert.equal(out, "motion sports schrieb (12.06.2026):\n(kein Textinhalt)");
});

test("renderCorrespondence joins messages oldest-first", () => {
  const block = renderCorrespondence([
    { direction: "received", occurredAt: "2026-06-12T08:30:00.000Z", bodyText: "Frage" },
    { direction: "sent", occurredAt: "2026-06-13T09:00:00.000Z", bodyText: "Antwort" },
  ]);
  assert.equal(
    block,
    "Kunde schrieb (12.06.2026):\nFrage\n\nmotion sports schrieb (13.06.2026):\nAntwort"
  );
});

test("renderCorrespondence caps to the most recent N, preserving order", () => {
  const many = Array.from({ length: MAX_CORRESPONDENCE_IN_PROMPT + 5 }, (_, i) => ({
    direction: "received",
    occurredAt: "2026-06-12T08:30:00.000Z",
    bodyText: `msg-${i}`,
  }));
  const block = renderCorrespondence(many);
  const lines = block.split("\n\n");
  assert.equal(lines.length, MAX_CORRESPONDENCE_IN_PROMPT);
  // The OLDEST (msg-0 … msg-4) are dropped; the kept window starts at msg-5.
  assert.ok(block.includes("msg-5"));
  assert.ok(!block.includes("msg-0\n"));
  assert.ok(block.includes(`msg-${MAX_CORRESPONDENCE_IN_PROMPT + 4}`));
});

test("renderCorrespondence returns '' for no messages", () => {
  assert.equal(renderCorrespondence([]), "");
  assert.equal(renderCorrespondence(null), "");
});
