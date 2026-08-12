// Mo's "Selbstbild" — the rendered, hashable snapshot of everything that
// currently defines Mo's behaviour (docs/IMPROVEMENT_LOOP.md):
//
//   1. the FULL German chat system prompt, rendered through the real
//      buildSystemPrompt with a canonical neutral context (empty profile,
//      unknown archetype, no retrieved products) plus the REAL published
//      Q&A knowledge and the REAL active team directives,
//   2. the model-facing tool copy (tool-descriptions.mjs),
//   3. every persona archetype with its prompt addendum.
//
// Two consumers, one artifact: the improvement engine feeds this text to the
// model as "this is who you are right now", and the admin "Verbesserung" tab
// shows the identical text to the operator — so human and engine criticise the
// SAME self-image, never a paraphrase.
//
// The SHA-256 of the snapshot is the prompt VERSION: it changes whenever the
// code prompt (git), the published knowledge or the directive layer changes,
// and it is stamped onto every improvement run (improvement_runs.prompt_hash)
// so a suggestion is always attributable to the exact self it criticised.

import { createHash } from "node:crypto";
import { EMPTY_PROFILE } from "./types";
import { buildSystemPrompt } from "./system-prompt";
import { toolCopy } from "./tool-descriptions.mjs";
import { getPersonaAddendum } from "./system-prompt-core.mjs";
import { ARCHETYPE_META } from "./persona";
import { listPublishedGeneralQa } from "./qa-store";
import { listActiveDirectives } from "./directives-store";

export interface MoSelfSnapshot {
  /** The full snapshot text (German) — engine input and admin view. */
  text: string;
  /** SHA-256 (hex) of `text` — the prompt version. */
  hash: string;
  /** First 12 hex chars of `hash` — the display form. */
  shortHash: string;
  /** The rendered system prompt alone (for the admin's prompt viewer). */
  promptText: string;
  activeDirectiveCount: number;
  publishedQaCount: number;
}

/**
 * Build the current self-snapshot. Deterministic for a given (code, knowledge,
 * directives) state — no timestamps, no randomness — so the hash is a stable
 * version identifier.
 */
export async function buildMoSelfSnapshot(): Promise<MoSelfSnapshot> {
  const [generalQa, directives] = await Promise.all([
    listPublishedGeneralQa(),
    listActiveDirectives(),
  ]);

  const promptText = buildSystemPrompt({
    profile: EMPTY_PROFILE,
    archetype: "unknown",
    retrievedProducts: [],
    emailOffer: { offersMade: 0, emailCaptured: false },
    generalQa,
    directives,
    locale: "de",
  });

  const tools = toolCopy("de") as Record<string, string>;
  const toolLines = Object.entries(tools)
    .map(([key, text]) => `### ${key}\n${text}`)
    .join("\n\n");

  const personaLines = (Object.keys(ARCHETYPE_META) as Array<keyof typeof ARCHETYPE_META>)
    .map((id) => {
      const meta = ARCHETYPE_META[id];
      const addendum = String(getPersonaAddendum(id, "de") ?? "").trim();
      return `### ${meta.label} (\`${id}\`)\n${addendum || "_(kein Addendum)_"}`;
    })
    .join("\n\n");

  const text = [
    `# Mos aktuelle Konfiguration`,
    `## System-Prompt (deutsch, kanonisch gerendert: leeres Profil, Archetyp unbekannt, keine vorretrieveten Produkte — Wissensbasis und Team-Anweisungen sind ECHT)`,
    promptText,
    `## Tool-Beschreibungen (modellseitig)`,
    toolLines,
    `## Persona-Archetypen`,
    personaLines,
  ].join("\n\n");

  const hash = createHash("sha256").update(text, "utf8").digest("hex");

  return {
    text,
    hash,
    shortHash: hash.slice(0, 12),
    promptText,
    activeDirectiveCount: directives.length,
    publishedQaCount: generalQa.length,
  };
}
