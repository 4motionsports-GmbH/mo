// Vorlagen screen (server-rendered): the operator's e-mail templates
// (docs/EMAIL_TEMPLATES.md) with where each is in use, whether picture upload
// and the AI are configured. The client workspace (vorlagen/) loads a
// template's document on demand and writes through /api/admin/vorlagen.

import { listMailTemplateMeta } from "@/lib/mail-template-store";
import { listEmailDesignSelections } from "@/lib/email-design-store";
import { parseTemplateDesignKey } from "@/lib/mail-template-doc.mjs";
import { isTemplateImageUploadConfigured } from "@/lib/mail-template-image";
import { VorlagenWorkspace } from "./lazy";
import type { VorlageMeta } from "./vorlagen/VorlagenWorkspace";

export async function VorlagenTab({ dbReady, initialId }: { dbReady: boolean; initialId: number | null }) {
  const [templates, selections] = dbReady
    ? await Promise.all([listMailTemplateMeta({ includeArchived: true }), listEmailDesignSelections()])
    : [[], {}];
  const usedFor = (id: number) =>
    Object.entries(selections)
      .filter(([, key]) => parseTemplateDesignKey(key) === id)
      .map(([kind]) => kind);
  const items: VorlageMeta[] = templates.map((t) => ({ ...t, usedFor: usedFor(t.id) }));
  return (
    <VorlagenWorkspace
      dbReady={dbReady}
      templates={items}
      initialId={initialId && templates.some((t) => t.id === initialId) ? initialId : null}
      uploadConfigured={isTemplateImageUploadConfigured()}
      aiConfigured={Boolean(process.env.ANTHROPIC_API_KEY)}
    />
  );
}
