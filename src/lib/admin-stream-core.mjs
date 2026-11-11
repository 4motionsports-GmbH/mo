// The pure half of a STREAMED admin call (admin/lib/admin-stream.ts): the
// decoder for an `application/x-ndjson` answer and the German message of a
// refused request. Pure and tested (admin-stream-core.test.mjs).
//
// NDJSON = one JSON value per line. A line can arrive split over several
// network chunks, and a multi-byte character (ä, „, —) over two of them, so
// the decoder keeps the unfinished rest — bytes in the TextDecoder (stream
// mode), text up to the last "\n" here — until the next chunk completes it.
// Blank lines and lines that are not JSON are skipped (a proxy's keep-alive,
// a stray newline); the caller decides what a stream that ended without its
// final event means (STREAM_BROKEN_MESSAGE).

/** A stream that ended (or broke) before its final event. */
export const STREAM_BROKEN_MESSAGE = "Verbindung abgebrochen — bitte erneut versuchen.";

/** Longest unfinished line kept while waiting for its "\n" (a runaway answer fails instead of filling memory). */
export const NDJSON_MAX_LINE_CHARS = 16_000_000;

/**
 * A streaming NDJSON decoder. `push(chunk)` takes the next bytes (Uint8Array)
 * — or text, for a body that was read whole — and returns the values of the
 * lines it completed; `end()` returns the value of a last line without "\n".
 * Feed one decoder either bytes or text, not both.
 * @returns {{ push: (chunk: Uint8Array | string) => unknown[], end: () => unknown[] }}
 */
export function createNdjsonDecoder() {
  const decoder = new TextDecoder("utf-8");
  let rest = "";
  /** @param {string} text @param {boolean} final */
  const take = (text, final) => {
    rest += text;
    const lines = rest.split("\n");
    rest = final ? "" : (lines.pop() ?? "");
    if (rest.length > NDJSON_MAX_LINE_CHARS) {
      rest = "";
      throw new Error("NDJSON: Zeile zu lang.");
    }
    /** @type {unknown[]} */
    const out = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // not JSON — skipped
      }
    }
    return out;
  };
  return {
    push: (chunk) => take(typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true }), false),
    end: () => take(decoder.decode(), true),
  };
}

/**
 * The message for a status without the route's JSON envelope — a platform
 * answer: Vercel refuses a body over 4.5 MB with its own 413 before the route
 * runs, and answers 504 when a function hits its maxDuration.
 * @param {number} status
 */
export function streamStatusMessage(status) {
  if (status === 401) return "Sitzung abgelaufen — bitte neu anmelden.";
  if (status === 403) return "Keine Berechtigung.";
  if (status === 404) return "Nicht gefunden.";
  if (status === 413) return "Die Anfrage ist zu groß — bitte Anhänge entfernen oder verkleinern.";
  if (status === 429) return "Zu viele Anfragen — bitte kurz warten.";
  if (status === 504) return "Zeitüberschreitung — die Antwort hat zu lange gedauert. Bitte erneut versuchen.";
  if (status >= 500) return `Serverfehler (${status}) — bitte erneut versuchen.`;
  return `Fehler (${status})`;
}

/**
 * Code and German message of a refused streamed request: the admin routes'
 * envelope `{ error: { code, message } }` when the body carries one, else the
 * message for the status.
 * @param {number} status
 * @param {string} text  the response body (may be empty, HTML, anything)
 * @returns {{ code: string | null, message: string }}
 */
export function streamErrorFromResponse(status, text) {
  /** @type {any} */
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const env = json && typeof json === "object" && !Array.isArray(json) ? json : {};
  const err = env.error;
  const code = err && typeof err === "object" && typeof err.code === "string" ? err.code : null;
  if (err && typeof err === "object" && typeof err.message === "string" && err.message.trim()) {
    return { code, message: err.message.trim() };
  }
  if (typeof err === "string" && err.trim()) return { code: null, message: err.trim() };
  if (typeof env.message === "string" && env.message.trim()) return { code, message: env.message.trim() };
  return { code, message: streamStatusMessage(status) };
}
