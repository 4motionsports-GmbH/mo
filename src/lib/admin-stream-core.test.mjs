import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NDJSON_MAX_LINE_CHARS,
  STREAM_BROKEN_MESSAGE,
  createNdjsonDecoder,
  streamErrorFromResponse,
  streamStatusMessage,
} from "./admin-stream-core.mjs";

const bytes = (s) => new TextEncoder().encode(s);

test("ndjson: one value per line, the unfinished rest waits for the next chunk", () => {
  const d = createNdjsonDecoder();
  assert.deepEqual(d.push(bytes('{"type":"progress","text":"a"}\n{"type":')), [{ type: "progress", text: "a" }]);
  assert.deepEqual(d.push(bytes('"result","doc":{}}')), []);
  assert.deepEqual(d.push(bytes("\n")), [{ type: "result", doc: {} }]);
  assert.deepEqual(d.end(), []);
});

test("ndjson: a multi-byte character split over two chunks stays intact", () => {
  const all = bytes('{"text":"Größe „schön“ — ✓"}\n');
  // split inside „ (3 bytes) and inside ✓ (3 bytes)
  const cut1 = all.indexOf(0xe2) + 1;
  const d = createNdjsonDecoder();
  const out = [...d.push(all.slice(0, cut1)), ...d.push(all.slice(cut1, all.length - 4)), ...d.push(all.slice(all.length - 4)), ...d.end()];
  assert.deepEqual(out, [{ text: "Größe „schön“ — ✓" }]);
  // byte by byte
  const e = createNdjsonDecoder();
  const each = [];
  for (const b of all) each.push(...e.push(new Uint8Array([b])));
  each.push(...e.end());
  assert.deepEqual(each, [{ text: "Größe „schön“ — ✓" }]);
});

test("ndjson: a last line without newline comes with end()", () => {
  const d = createNdjsonDecoder();
  assert.deepEqual(d.push(bytes('{"a":1}\n{"b":2}')), [{ a: 1 }]);
  assert.deepEqual(d.end(), [{ b: 2 }]);
  assert.deepEqual(d.end(), []);
});

test("ndjson: blank lines, CRLF and lines that are not JSON are skipped", () => {
  const d = createNdjsonDecoder();
  const out = d.push(bytes('\n\r\n{"a":1}\r\nnot json\n<html>\n  {"b":2}  \n'));
  assert.deepEqual(out, [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(d.end(), []);
});

test("ndjson: text input (a body read whole) works the same", () => {
  const d = createNdjsonDecoder();
  assert.deepEqual([...d.push('{"a":1}\n{"b"'), ...d.push(":2}\n"), ...d.end()], [{ a: 1 }, { b: 2 }]);
});

test("ndjson: a runaway line without newline fails instead of growing forever", () => {
  const d = createNdjsonDecoder();
  assert.throws(() => d.push("x".repeat(NDJSON_MAX_LINE_CHARS + 1)), /zu lang/);
});

test("refused request: the route's envelope wins, else a message for the status", () => {
  assert.deepEqual(streamErrorFromResponse(422, JSON.stringify({ error: { code: "too_large", message: "Zu viele Anhänge." } })), {
    code: "too_large",
    message: "Zu viele Anhänge.",
  });
  assert.deepEqual(streamErrorFromResponse(400, JSON.stringify({ error: "Kaputt." })), { code: null, message: "Kaputt." });
  assert.deepEqual(streamErrorFromResponse(400, JSON.stringify({ message: "Auch kaputt." })), { code: null, message: "Auch kaputt." });
  // an envelope with a code but no message keeps the code
  assert.deepEqual(streamErrorFromResponse(503, JSON.stringify({ error: { code: "not_configured" } })), {
    code: "not_configured",
    message: streamStatusMessage(503),
  });
  // a platform page (Vercel's 413, a 504 after maxDuration) has no envelope
  assert.equal(streamErrorFromResponse(413, "Request Entity Too Large").message, streamStatusMessage(413));
  assert.equal(streamErrorFromResponse(504, "<html>timeout</html>").message, streamStatusMessage(504));
  assert.equal(streamErrorFromResponse(500, "").message, streamStatusMessage(500));
  assert.equal(streamErrorFromResponse(400, "[1,2]").message, "Fehler (400)");
});

test("status messages are German and name the remedy", () => {
  assert.match(streamStatusMessage(401), /anmelden/);
  assert.match(streamStatusMessage(413), /Anhänge/);
  assert.match(streamStatusMessage(429), /warten/);
  assert.match(streamStatusMessage(504), /erneut/);
  assert.match(streamStatusMessage(502), /Serverfehler \(502\)/);
  assert.equal(streamStatusMessage(418), "Fehler (418)");
  assert.equal(STREAM_BROKEN_MESSAGE, "Verbindung abgebrochen — bitte erneut versuchen.");
});
