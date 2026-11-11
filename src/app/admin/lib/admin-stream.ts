// adminStream — a POST to an /api/admin/* route that answers with a STREAM of
// JSON lines (`application/x-ndjson`), e.g. the AI designer
// (/api/admin/vorlagen/assist): progress lines while the model works, then
// one final line. The sibling of adminFetch for long-running calls:
//
//   · a refused request (non-2xx) throws the same AdminApiError as adminFetch
//     — the route's German message, or one for a platform answer without the
//     JSON envelope (Vercel's 413 for a body over 4.5 MB, a 504 after
//     maxDuration); a 401 sends the operator to the login page and back;
//   · every complete line is parsed and handed to `onEvent` as it arrives
//     (lib/admin-stream-core.mjs: split lines and multi-byte characters stay
//     intact, blank and non-JSON lines are skipped);
//   · a connection that breaks mid-stream throws StreamBrokenError; an abort
//     through `signal` rethrows the abort as is.
//
// Resolves when the stream ends — whether it carried a final event is the
// caller's question (STREAM_BROKEN_MESSAGE when it did not).

import { AdminApiError, redirectToLogin } from "./admin-fetch";
import { STREAM_BROKEN_MESSAGE, createNdjsonDecoder, streamErrorFromResponse } from "@/lib/admin-stream-core.mjs";

export { STREAM_BROKEN_MESSAGE };

/** The connection broke after the answer had started. */
export class StreamBrokenError extends Error {
  constructor(message: string = STREAM_BROKEN_MESSAGE, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StreamBrokenError";
  }
}

export interface AdminStreamOptions {
  /** JSON-serialised request body … */
  body?: unknown;
  /** … or the body already serialised (e.g. after a size check). */
  json?: string;
  signal?: AbortSignal;
  /** Every parsed line, in order. */
  onEvent: (event: unknown) => void;
  /** What to do on 401 — redirect to /admin/login (default) or just throw. */
  onUnauthorized?: "redirect" | "throw";
}

export async function adminStream(path: string, options: AdminStreamOptions): Promise<void> {
  const { body, json, signal, onEvent, onUnauthorized = "redirect" } = options;
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      signal,
      credentials: "same-origin",
      headers: { Accept: "application/x-ndjson, application/json", "Content-Type": "application/json" },
      body: json ?? JSON.stringify(body ?? {}),
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new AdminApiError("Netzwerkfehler — bitte Verbindung prüfen.", 0, "network", err);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const { code, message } = streamErrorFromResponse(res.status, text);
    if (res.status === 401 && onUnauthorized === "redirect") redirectToLogin();
    throw new AdminApiError(message, res.status, code);
  }

  const decoder = createNdjsonDecoder();
  if (!res.body) {
    // No readable stream (old browser, test double): the whole body at once.
    const text = await res.text();
    for (const event of [...decoder.push(text), ...decoder.end()]) onEvent(event);
    return;
  }

  const reader = res.body.getReader();
  let finished = false;
  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (signal?.aborted) throw err;
        throw new StreamBrokenError(STREAM_BROKEN_MESSAGE, { cause: err });
      }
      if (chunk.done) break;
      let events: unknown[];
      try {
        events = decoder.push(chunk.value);
      } catch (err) {
        throw new StreamBrokenError(STREAM_BROKEN_MESSAGE, { cause: err });
      }
      for (const event of events) onEvent(event);
    }
    finished = true;
    for (const event of decoder.end()) onEvent(event);
  } finally {
    // Stop the download when the caller gave up (an error in onEvent, a
    // broken line) — the server sees the client leave.
    if (!finished) reader.cancel().catch(() => undefined);
  }
}
