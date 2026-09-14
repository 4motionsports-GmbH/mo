"use client";

// The „Hero“ block of the review column — shown only when the campaign
// design has a hero slot. State pill (KI-Hero / Standard-Bild / A-Gruppe ohne
// Hero), thumbnail, „Erzeugen“ (suggest + generate in one go), „Anpassen…“
// (a sheet with headline + prompt and the single actions) and „Entfernen“.
// All five actions of the Kunden hero panel are kept; the hook is shared.

import * as React from "react";
import { Image as ImageIcon, Sparkles, Trash2, Wand2 } from "lucide-react";
import { abGroupOf } from "@/lib/campaign-review-checks.mjs";
import { Button, InfoTip, Label, Sheet, StatusBadge, Textarea, Tooltip } from "../../ui";
import { useEmailHero } from "../../useEmailHero";
import type { CampaignQueueItemProps } from "../types";

export interface HeroBlockHandle {
  /** Suggest a prompt and render the image in one go (the Prüfpunkt fix). */
  generate: () => void;
}

export const HeroBlock = React.forwardRef<
  HeroBlockHandle,
  {
    item: CampaignQueueItemProps;
    designName: string | null;
    generationConfigured: boolean;
    locked: boolean;
    onChange: (hero: { url: string | null; headline: string | null }) => void;
    onBusy: (generating: boolean) => void;
  }
>(function HeroBlock({ item, designName, generationConfigured, locked, onChange, onBusy }, ref) {
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const hero = useEmailHero({
    kind: "campaign",
    targetId: item.contactId,
    lazy: true,
    initial: { url: item.heroUrl, headline: item.heroHeadline },
    onChange,
  });
  const { busy } = hero;
  const group = abGroupOf(item.contactId);
  const hasHero = Boolean(item.heroUrl);

  React.useEffect(() => {
    onBusy(busy === "generate");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);
  React.useEffect(() => setSheetOpen(false), [item.contactId]);
  // The sheet needs the stored prompt + headline.
  React.useEffect(() => {
    if (sheetOpen && hero.state === null) void hero.load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetOpen]);

  const generateNow = React.useCallback(async () => {
    if (!generationConfigured || busy !== null) return;
    const suggestion = await hero.suggest();
    if (!suggestion) return;
    await hero.generate({ prompt: suggestion.prompt, headline: suggestion.headline ?? "" });
  }, [generationConfigured, busy, hero]);

  React.useImperativeHandle(ref, () => ({ generate: () => void generateNow() }), [generateNow]);

  const anyBusy = locked || busy !== null;

  return (
    <>
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          Hero{designName ? ` · ${designName}` : ""}
        </span>
        <InfoTip>
          Das Hero-Bild des Designs „{designName ?? "Performance"}“ oben in der E-Mail. „Erzeugen“
          lässt die KI einen Bild-Prompt aus Produkten und E-Mail-Inhalt vorschlagen und rendert
          das Bild (mit KI-Prüfung, bis zu drei Minuten — die Prüfung anderer Entwürfe läuft
          weiter). Ohne eigenes Bild nutzt der Hero das Standard-Bild. A/B-Regel: gerade
          Kontakt-IDs (A) mit KI-Hero senden, ungerade (B) ohne.
        </InfoTip>
      </div>
      <div className="flex items-center gap-2 text-xs">
        {item.heroUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.heroUrl}
            alt="Generiertes Hero-Bild"
            className="h-10 w-20 shrink-0 rounded-md border border-border object-cover"
          />
        ) : (
          <span
            className="flex h-10 w-20 shrink-0 items-center justify-center rounded-md border border-dashed border-border bg-surface-2 text-muted-foreground"
            aria-hidden
          >
            <ImageIcon className="size-4" />
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <StatusBadge
            tone={hasHero ? "success" : group === "A" ? "warning" : "neutral"}
            className="w-fit"
          >
            {hasHero ? "KI-Hero" : group === "A" ? "A-Gruppe ohne Hero" : "Standard-Bild"}
          </StatusBadge>
          {item.heroHeadline && (
            <span className="truncate text-muted-foreground" title={undefined}>
              „{item.heroHeadline.replace(/\n/g, " / ")}“
            </span>
          )}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Tooltip
          content="Bild-Generierung nicht konfiguriert (OPENAI_API_KEY / BLOB_READ_WRITE_TOKEN)."
          disabled={generationConfigured}
        >
          <span className="inline-flex">
            <Button
              variant="outline"
              size="xs"
              disabled={anyBusy || !generationConfigured}
              loading={busy === "suggest" || busy === "generate"}
              onClick={() => void generateNow()}
            >
              <Wand2 /> {hasHero ? "Neu erzeugen" : "Erzeugen"}
            </Button>
          </span>
        </Tooltip>
        <Button variant="outline" size="xs" disabled={anyBusy} onClick={() => setSheetOpen(true)}>
          Anpassen…
        </Button>
        {hasHero && (
          <Button
            variant="ghost"
            size="xs"
            disabled={anyBusy}
            loading={busy === "remove"}
            onClick={() => void hero.remove()}
          >
            <Trash2 /> Entfernen
          </Button>
        )}
      </div>

      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Hero-Bild anpassen"
        description="Die KI schlägt einen Bild-Prompt und eine Schlagzeile aus Produkten & E-Mail-Inhalt vor — beides anpassbar. „Bild generieren“ rendert das Bild und setzt es in diese E-Mail ein."
        size="md"
      >
        <div className="flex flex-col gap-3 text-sm">
          {item.heroUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.heroUrl}
              alt="Generiertes Hero-Bild"
              className="h-32 w-auto rounded-md border border-border object-cover"
            />
          )}
          <div>
            <Label htmlFor={`hero-headline-${item.contactId}`} className="mb-1 flex items-center gap-1 text-muted-foreground">
              Schlagzeile im Hero (zwei kurze Zeilen)
              <InfoTip>Leer = Standard-Schlagzeile des Designs. Zeilenumbruch trennt die beiden Zeilen.</InfoTip>
            </Label>
            <Textarea
              id={`hero-headline-${item.contactId}`}
              value={hero.headline}
              onChange={(e) => hero.setHeadline(e.target.value)}
              rows={2}
              maxLength={60}
              placeholder={"Mehr Leistung.\nMehr Fokus."}
              className="text-xs"
              disabled={anyBusy}
            />
          </div>
          <div>
            <Label htmlFor={`hero-prompt-${item.contactId}`} className="mb-1 block text-muted-foreground">
              Bild-Prompt (englisch)
            </Label>
            <Textarea
              id={`hero-prompt-${item.contactId}`}
              value={hero.prompt}
              onChange={(e) => hero.setPrompt(e.target.value)}
              rows={6}
              placeholder="Beschreibt die Szene, die das Bildmodell rendert."
              className="text-xs"
              disabled={anyBusy}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={anyBusy}
              loading={busy === "suggest"}
              onClick={() => void hero.suggest()}
            >
              <Sparkles /> Prompt vorschlagen
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={anyBusy}
              loading={busy === "headline"}
              onClick={() => void hero.saveHeadline()}
            >
              Schlagzeile speichern
            </Button>
            <Button
              size="sm"
              disabled={anyBusy || !hero.prompt.trim() || !generationConfigured}
              loading={busy === "generate"}
              onClick={() => void hero.generate()}
            >
              <Wand2 /> {busy === "generate" ? "Generiere & prüfe Bild… (bis zu 3 Min.)" : "Bild generieren & einsetzen"}
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
});
