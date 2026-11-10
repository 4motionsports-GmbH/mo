// „Mit KI gestalten“ — the AI assistant of the template and Rundmail editor
// (writer tier, ai_usage call site `template_assist`). docs/EMAIL_TEMPLATES.md.
//
// The operator describes what they want („Black-Week-Mail, schwarz-gelb,
// großer Banner, 25 % mit dem Code BLACKWEEK25, Countdown bis Sonntag“), or
// asks for a change of the current document, optionally with a screenshot of
// a mail to rebuild. The model gets the block catalog — the „interface“ of
// every Mo capability (mail-template-doc.mjs blockCatalogForPrompt) — and
// returns a block document. That answer is NEVER trusted: it goes through
// normalizeMailTemplateDoc (vocabulary, limits, https-only links, exactly one
// footer) and the editor shows it as an unsaved change the operator reviews,
// can undo, and saves. The model cannot invent images, products or codes
// that ship: it keeps what the document has and leaves the rest empty with a
// note („Banner hochladen“, „Produkte wählen“) — the validation then blocks
// a send until the operator filled them.

import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { anthropicOptionsFor, maxOutputTokensFor, modelFor } from "./ai-models.mjs";
import { recordAiUsage } from "./ai-usage-store";
import { reportError } from "./observability";
import { MO_BLOCK_TYPES, blockCatalogForPrompt, normalizeMailTemplateDoc } from "./mail-template-doc.mjs";
import { TEMPLATE_ASSIST_SCHEMA, fromAssistFields } from "./ai-assist-schemas.mjs";
import { EMAIL_BUTTON_SHAPES, EMAIL_FONT_KEYS } from "./email-theme.mjs";

const MODEL = modelFor("writer");

/** The operator's message for a failed call — the error itself goes to reportError. */
function failureMessage(err: unknown): string {
  const e = err as { statusCode?: unknown; status?: unknown; finishReason?: unknown; name?: unknown } | null;
  const status = Number(e?.statusCode ?? e?.status);
  if (status === 429 || status === 529 || status === 503) {
    return "Die KI ist gerade ausgelastet — bitte in einer Minute erneut versuchen.";
  }
  if (e?.finishReason === "length") return "Die Mail wurde für die KI zu lang — bitte mit weniger Bausteinen oder kürzer beschreiben.";
  return "Die KI konnte die Mail gerade nicht gestalten — bitte erneut versuchen.";
}

export type TemplateAssistResult =
  | { ok: true; doc: ReturnType<typeof normalizeMailTemplateDoc>; notes: string }
  | { ok: false; message: string };

const SCREENSHOT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

/** Build or change a block document from the operator's instruction. Never throws. */
export async function assistMailTemplate(input: {
  instruction: string;
  doc: unknown | null;
  use: "bulk" | "personal" | "template";
  screenshot?: { base64: string; mediaType: string } | null;
  today?: Date;
}): Promise<TemplateAssistResult> {
  const instruction = input.instruction.trim().slice(0, 2000);
  if (instruction.length < 5 && !input.screenshot) {
    return { ok: false, message: "Bitte in ein paar Worten beschreiben, was die KI gestalten soll." };
  }
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, message: "Kein KI-Schlüssel konfiguriert (ANTHROPIC_API_KEY)." };
  const current = input.doc ? normalizeMailTemplateDoc(input.doc) : null;
  const today = (input.today ?? new Date()).toISOString().slice(0, 10);
  const useRule =
    input.use === "personal"
      ? "Die Vorlage ist für Mos PERSÖNLICHE Mails (Kampagne): Sie MUSS genau einen Baustein mo_content enthalten; mo_offer, mo_promo und hero sind erlaubt und sinnvoll. Mos Text, Produkte, Rabatt und Button kommen pro Person von Mo — keine festen Produkte/Gutscheine dafür einbauen."
      : input.use === "bulk"
        ? `Die Mail ist eine RUNDMAIL (gleicher Inhalt für alle): Die Bausteine ${MO_BLOCK_TYPES.join(", ")} sind NICHT erlaubt.`
        : "Die Vorlage kann später für Rundmails (ohne Mo-Bausteine) oder — mit mo_content — für Mos persönliche Mails verwendet werden.";
  const system = [
    "Du gestaltest E-Mails für motion sports, einen deutschen Online-Shop für Fitnessgeräte (Home-Gym, Kraft, Cardio).",
    "Du antwortest NUR mit einem Block-Dokument im vorgegebenen Schema. Die Mail wird daraus robust für alle Mailprogramme gebaut — du schreibst kein HTML (außer im Baustein html, und den nur, wenn ausdrücklich verlangt).",
    "",
    "Verfügbare Bausteine (die Schnittstelle zu allen Mo-Funktionen):",
    blockCatalogForPrompt(),
    "",
    "Regeln:",
    `- ${useRule}`,
    "- Der letzte Baustein ist immer footer (Abmelde-Link und Impressum — Pflicht).",
    "- Erfinde NIE Bild-Adressen, Produkt-Referenzen oder Rabattcodes. Behalte die vorhandenen Werte (src, refs, code, href) der aktuellen Mail. Neue Bilder: src leer lassen; neue Produkt-Bausteine: refs leer lassen; Codes nur, wenn die Anweisung sie nennt. Sag in notes, was die Person noch ergänzen muss.",
    "- Links nur https://… (Shop: https://motionsports.de/…). Farben als #rrggbb.",
    `- fontFamily: ${EMAIL_FONT_KEYS.join(", ")}; buttonShape: ${EMAIL_BUTTON_SHAPES.join(", ")}.`,
    "- Texte auf Deutsch in Du-Form (außer die Anweisung verlangt Englisch); kurz, klar, ein Hauptziel pro Mail, ein deutlicher Haupt-Button.",
    "- Zustellbarkeit: keine GROSSBUCHSTABEN-Sätze, höchstens ein Ausrufezeichen, keine Spam-Wörter („gratis“, „100 %“), genug Text neben Bildern, Alternativtexte für Bilder.",
    "- Keine erfundenen Fristen, Preise oder Prozente — nur, was die Anweisung nennt. Für den Vornamen {{vorname}} oder {{vorname|Ersatz}} verwenden.",
    `- Heute ist ${today}. Countdown-Enden als ISO-Zeitpunkt mit Zeitzone (z. B. 2026-11-30T23:59:00+01:00).`,
    "- Behalte die id unveränderter Bausteine (neue Bausteine: id leer). Jeder Baustein hat alle Felder: Felder, die er nicht braucht, sind leer (\"\" bzw. [] bei refs); Ja/Nein-Felder sind \"true\", \"false\" oder leer (= Standard); width und height als Zahl in Anführungszeichen (\"144\") oder width \"full\" / \"content\" beim Bild. Im style leer = Standard.",
    "- notes: 1–4 deutsche Sätze — was du gemacht hast und was noch fehlt.",
  ].join("\n");
  const prompt = [
    current ? `Aktuelle Mail (JSON):\n${JSON.stringify(current).slice(0, 60_000)}` : "Es gibt noch keine Mail — gestalte eine neue.",
    `Anweisung:\n${instruction || "Baue die Mail auf dem Bild möglichst genau nach."}`,
    input.screenshot ? "Das Bild zeigt eine Mail als Vorbild: übernimm Aufbau, Farben und Tonalität (Texte sinngemäß, keine Bilder-URLs)." : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  try {
    const screenshot =
      input.screenshot && (SCREENSHOT_TYPES as readonly string[]).includes(input.screenshot.mediaType)
        ? input.screenshot
        : null;
    const { object, usage } = await generateObject({
      model: anthropic(MODEL),
      providerOptions: anthropicOptionsFor("writer"),
      maxOutputTokens: maxOutputTokensFor("writer", 8000),
      schema: TEMPLATE_ASSIST_SCHEMA,
      system,
      ...(screenshot
        ? {
            messages: [
              {
                role: "user" as const,
                content: [
                  { type: "text" as const, text: prompt },
                  { type: "image" as const, image: screenshot.base64, mediaType: screenshot.mediaType },
                ],
              },
            ],
          }
        : { prompt }),
    });
    await recordAiUsage({
      callSite: "template_assist",
      model: MODEL,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });
    // Keep what the model may not invent: an image, product list or code it
    // dropped or changed on a kept block is restored from the current doc.
    const before = new Map((current?.blocks ?? []).map((b) => [b.id, b as Record<string, unknown>]));
    const blocks = object.blocks.map((raw) => {
      const b = fromAssistFields(raw as Record<string, unknown>);
      const prev = typeof b.id === "string" ? before.get(b.id) : undefined;
      if (prev && prev.type === b.type) {
        for (const k of ["src", "refs"]) if (prev[k] && (Array.isArray(prev[k]) ? (prev[k] as unknown[]).length : true)) b[k] = prev[k];
      }
      return b;
    });
    let doc = normalizeMailTemplateDoc({ style: fromAssistFields(object.style as Record<string, unknown>), blocks });
    if (input.use === "bulk") doc = { ...doc, blocks: doc.blocks.filter((b) => !MO_BLOCK_TYPES.includes(b.type)) };
    if (doc.blocks.length <= 1) return { ok: false, message: "Die KI hat keine verwendbare Mail geliefert — bitte genauer beschreiben." };
    return { ok: true, doc, notes: object.notes.trim().slice(0, 800) };
  } catch (err) {
    reportError(err, { route: "lib/mail-template-assist", phase: "assist" });
    return { ok: false, message: failureMessage(err) };
  }
}
