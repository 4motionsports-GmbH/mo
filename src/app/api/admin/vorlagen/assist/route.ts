// POST /api/admin/vorlagen/assist — the „KI-Gestalter“ of the template and
// Rundmail editor (lib/mail-template-assist.ts, docs/EMAIL_TEMPLATES.md §6).
//
// Body (JSON, ≤ 4.4 MB):
//   { instruction: string (≤ 6000; may be empty when attachments carry the brief),
//     doc: object | null              — the editor's current, possibly unsaved document,
//     use: "bulk" | "personal" | "template",
//     history: [{ role: "user" | "assistant", text }]   — ≤ 8 turns of this session,
//     attachments: [{ name, mediaType, data /* base64 */ }]  — ≤ 6: image/png|jpeg|webp|gif,
//                  application/pdf, text/html, text/plain, message/rfc822 (text kinds: base64 of UTF-8;
//                  HTML / TXT ≤ 500 KB, .eml ≤ 400 KB decoded — refused with 400 before decoding),
//     context?: { subject?, preheader?, language?: "de" | "en" },  — the Rundmail's subject, preview
//                  line and „Sprache“ ("en": texts, subject and preview line in English)
//     settings?: { model?, effort?, freedom?, proactive? } }  — the panel's choice for this
//                  conversation, merged over the team's settings (Einstellungen → „KI-Gestalter“,
//                  GET/POST /api/admin/settings/designer); invalid fields are dropped (never a 400);
//                  the house style always comes from the stored settings
//
// Errors before the stream starts (guard, bad JSON, invalid body, 413 too
// large, no ANTHROPIC_API_KEY) are the usual JSON envelope with their status.
// Otherwise 200 with application/x-ndjson — one JSON object per line:
//   {"type":"progress","stage":"start"|"attachments"|"search"|"collections"|"design"|"check"|"images"|"heartbeat","text":"…"}
//   … then exactly one of
//   {"type":"result","doc":{…},"notes":"…","subject":string|null,"preheader":string|null,"warnings":[…],"run":{…}}
//   {"type":"error","message":"…","run"?:{…}}
// `run` (DesignerRunInfo, mail-template-designer.mjs designerRunInfo):
//   { model, effort — of the run that produced the answer; label — „Gründlich · Claude Opus 5.5 ·
//     Denktiefe Hoch“; freedom; proactive; seconds — the whole request; costEur — every model call
//     of the request in EUR, null when not known (a step cut off by the time limit); fallbackFrom —
//     the chosen model when it was not open to the Anthropic account and Opus 5.5 ran instead, else
//     null }; on an error line only once a model ran.
// A heartbeat line (repeating the current status) every 15 s keeps proxies
// from closing the idle connection while the model thinks. The model is
// aborted at 285 s (a German timeout message, or the last checked draft) so
// the answer always arrives inside maxDuration — whatever model and effort
// the settings choose, and a second run on Opus 5.5 shares the same 285 s; a
// client that disconnects („Abbrechen“) aborts it too, and then no picture is
// stored. Only PROPOSES: nothing is stored except attachment pictures the
// accepted design uses. Metered in ai_usage (template_assist, per run with the
// model that ran), audit-logged (template.assist, with the panel's settings).

import { guardAdminPost, adminJsonError } from "@/lib/admin-api";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { assistMailTemplate, type TemplateAssistProgress } from "@/lib/mail-template-assist";
import { DESIGNER_LIMITS, parseAssistRequest } from "@/lib/mail-template-designer.mjs";
import { reportError } from "@/lib/observability";

export const maxDuration = 300;

/** The model is stopped this long after the request started (maxDuration minus the time to answer). */
const MODEL_DEADLINE_MS = 285_000;
const HEARTBEAT_MS = 15_000;

/** Read the body up to `cap` bytes; null when it is larger. */
async function readBodyCapped(req: Request, cap: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > cap) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function abortError(name: "TimeoutError" | "AbortError", message: string): Error {
  const err = new Error(message);
  err.name = name;
  return err;
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let text: string | null;
  try {
    text = await readBodyCapped(req, DESIGNER_LIMITS.bodyBytes);
  } catch {
    return adminJsonError("bad_request", "Die Anfrage konnte nicht gelesen werden.", 400);
  }
  if (text === null) {
    return adminJsonError("too_large", "Die Anfrage ist zu groß (höchstens etwa 4 MB) — bitte weniger oder kleinere Anhänge mitschicken.", 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return adminJsonError("bad_request", "Ungültige Anfrage (kein JSON).", 400);
  }
  const parsed = parseAssistRequest(body);
  if (!parsed.ok) return adminJsonError("invalid_body", parsed.message, 400);
  if (!process.env.ANTHROPIC_API_KEY) {
    return adminJsonError("not_configured", "Kein KI-Schlüssel konfiguriert (ANTHROPIC_API_KEY).", 503);
  }
  const request = parsed.value;
  await recordAdminAccess(
    {
      action: "template.assist",
      detail: {
        use: request.use,
        attachments: request.attachments.length,
        kinds: request.attachments.map((a) => a.kind),
        ...(Object.keys(request.settings).length > 0 ? { settings: request.settings } : {}),
      },
    },
    req
  );

  const deadlineAt = startedAt + MODEL_DEADLINE_MS;
  const controller = new AbortController();
  const deadline = setTimeout(
    () => controller.abort(abortError("TimeoutError", "Zeitlimit des KI-Gestalters erreicht.")),
    Math.max(0, deadlineAt - Date.now())
  );
  const onClientGone = () => controller.abort(abortError("AbortError", "Die Verbindung wurde getrennt."));
  req.signal?.addEventListener("abort", onClientGone, { once: true });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      let open = true;
      let status = "Der KI-Gestalter startet …";
      const write = (line: Record<string, unknown>) => {
        if (!open) return;
        try {
          ctrl.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        } catch {
          open = false;
        }
      };
      const heartbeat = setInterval(() => write({ type: "progress", stage: "heartbeat", text: status }), HEARTBEAT_MS);
      try {
        const result = await assistMailTemplate(request, {
          signal: controller.signal,
          deadlineAt,
          startedAt,
          onProgress: (p: TemplateAssistProgress) => {
            status = p.text;
            write({ type: "progress", stage: p.stage, text: p.text });
          },
        });
        if (result.ok) {
          write({
            type: "result",
            doc: result.doc,
            notes: result.notes,
            subject: result.subject,
            preheader: result.preheader,
            warnings: result.warnings,
            run: result.run,
          });
        } else {
          write({ type: "error", message: result.message, ...(result.run ? { run: result.run } : {}) });
        }
      } catch (err) {
        reportError(err, { route: "api/admin/vorlagen/assist", phase: "stream" });
        write({ type: "error", message: "Die KI-Gestaltung ist fehlgeschlagen — bitte erneut versuchen." });
      } finally {
        clearInterval(heartbeat);
        clearTimeout(deadline);
        req.signal?.removeEventListener("abort", onClientGone);
        if (open) {
          open = false;
          try {
            ctrl.close();
          } catch {
            /* already closed by the client */
          }
        }
      }
    },
    cancel() {
      onClientGone();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
