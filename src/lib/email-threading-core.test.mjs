// Unit tests for the REPLY-side threading helpers (the in-admin email client,
// docs/EMAIL_SUBSYSTEM_SPIKE.md §5): grouping a conversation, angle-bracketing
// ids for the wire, building a reply's References chain, and the reply subject.
// Pure — no DB, no SDK, no live webhook.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  threadKey,
  ensureAngle,
  buildReplyReferences,
  replySubject,
} from "./email-inbound-core.mjs";

test("threadKey collapses bracketed (sent) and stripped (received) ids to one key", () => {
  // A sent row stores `<id>`; the reply we receive stores the same id stripped.
  assert.equal(threadKey("<abc@motionsports.de>"), threadKey("abc@motionsports.de"));
  assert.equal(threadKey("<ABC@Motionsports.DE>"), "abc@motionsports.de");
});

test("threadKey returns '' for an absent id", () => {
  assert.equal(threadKey(null), "");
  assert.equal(threadKey(""), "");
  assert.equal(threadKey(undefined), "");
});

test("ensureAngle brackets a bare id and leaves an already-bracketed one", () => {
  assert.equal(ensureAngle("abc@host"), "<abc@host>");
  assert.equal(ensureAngle("<abc@host>"), "<abc@host>");
  assert.equal(ensureAngle("  abc@host  "), "<abc@host>");
  assert.equal(ensureAngle(""), "");
  assert.equal(ensureAngle(null), "");
});

test("buildReplyReferences appends the parent Message-ID to its References chain", () => {
  assert.deepEqual(
    buildReplyReferences(["<root@host>", "<mid@host>"], "<parent@host>"),
    ["root@host", "mid@host", "parent@host"]
  );
});

test("buildReplyReferences works from a header string and a no-References parent", () => {
  assert.deepEqual(
    buildReplyReferences("<root@host> <mid@host>", "<parent@host>"),
    ["root@host", "mid@host", "parent@host"]
  );
  // First message in a thread: References empty, only the parent id.
  assert.deepEqual(buildReplyReferences([], "<parent@host>"), ["parent@host"]);
  assert.deepEqual(buildReplyReferences(null, null), []);
});

test("buildReplyReferences de-duplicates and preserves order", () => {
  assert.deepEqual(
    buildReplyReferences(["<a@h>", "<b@h>", "<a@h>"], "<b@h>"),
    ["a@h", "b@h"]
  );
});

test("replySubject prefixes Re: only when no reply marker is present", () => {
  assert.equal(replySubject("Lieferzeit?"), "Re: Lieferzeit?");
  assert.equal(replySubject("Re: Lieferzeit?"), "Re: Lieferzeit?");
  assert.equal(replySubject("AW: Lieferzeit?"), "AW: Lieferzeit?");
  assert.equal(replySubject("  Fwd: Angebot "), "Fwd: Angebot");
  assert.equal(replySubject(""), "Re:");
  assert.equal(replySubject(null), "Re:");
});
