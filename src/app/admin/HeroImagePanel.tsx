"use client";

// Hero-image panel for the image-first email designs ('performance'): lets the
// operator generate a PERSONALISED hero image for ONE draft before sending.
//
// Flow: "Prompt vorschlagen" → the system drafts an image prompt from the
// draft's actual context (products, prose, persona) → the operator edits the
// text → "Bild generieren" renders it (gpt-image-2 in the hero's native
// 1536×720 format, with the products' catalogue photos as references and
// fallbacks), lets a vision model check the result (one re-render on a
// fail), composites the legibility gradient, stores a desktop file and a
// mobile crop on the draft row → the e-mail preview and the real send show
// it automatically. "Entfernen" falls back to the default hero asset.
//
// Self-contained: loads its state from GET /api/admin/email-hero on mount
// (useEmailHero), so the Kunden workspace only mounts it with { kind,
// targetId }. The Kampagne desk uses the same hook in its own Hero block.

import * as React from "react";
import { Image as ImageIcon, Loader2, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Badge, Button, Label, Textarea } from "./ui";
import { useEmailHero } from "./useEmailHero";

export function HeroImagePanel({
  kind,
  targetId,
  disabled,
}: {
  kind: "marketing" | "campaign";
  /** marketing: send id · campaign: contact id. */
  targetId: number;
  disabled?: boolean;
}) {
  const hero = useEmailHero({ kind, targetId });
  const { state, prompt, setPrompt, headline, setHeadline, busy } = hero;
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => setOpen(false), [kind, targetId]);

  const anyBusy = disabled || busy !== null;

  return (
    <div className="mt-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-4 w-4 text-muted-foreground" />
          <Label className="text-muted-foreground">Hero-Bild (Design „Performance“)</Label>
          {state?.url ? (
            <Badge variant="success">Individuell generiert</Badge>
          ) : (
            <Badge variant="outline">Standard-Bild</Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void hero.suggest().then((s) => s && setOpen(true))}
            disabled={anyBusy}
            title="Die KI schlägt einen Bild-Prompt aus Produkten & E-Mail-Inhalt vor"
          >
            {busy === "suggest" ? (
              <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="me-1 h-3.5 w-3.5" />
            )}
            Hero vorschlagen
          </Button>
          {state?.url && (
            <Button type="button" variant="ghost" size="sm" onClick={() => void hero.remove()} disabled={anyBusy}>
              {busy === "remove" ? (
                <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="me-1 h-3.5 w-3.5" />
              )}
              Entfernen
            </Button>
          )}
        </div>
      </div>

      {state?.url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={state.url}
          alt="Generiertes Hero-Bild"
          className="mt-2 h-28 w-auto rounded-md border border-border object-cover"
        />
      )}

      {(open || prompt || headline) && (
        <div className="mt-2 space-y-2">
          <div>
            <Label htmlFor={`hero-headline-${kind}-${targetId}`} className="mb-1 block text-muted-foreground">
              Schlagzeile im Hero (zwei kurze Zeilen)
            </Label>
            <div className="flex flex-wrap items-start gap-2">
              <Textarea
                id={`hero-headline-${kind}-${targetId}`}
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                rows={2}
                maxLength={60}
                placeholder={"Mehr Leistung.\nMehr Fokus."}
                className="min-w-[220px] flex-1 text-xs"
                disabled={anyBusy}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void hero.saveHeadline()}
                disabled={anyBusy}
                title="Speichert nur die Schlagzeile — ohne neues Bild zu generieren"
              >
                {busy === "headline" ? <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" /> : null}
                Speichern
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Leer = Standard-Schlagzeile des Designs. Zeilenumbruch trennt die beiden Zeilen.
            </p>
          </div>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            placeholder="Bild-Prompt (englisch) — beschreibt die Szene, die das Bildmodell rendert."
            className="text-xs"
            disabled={anyBusy}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => void hero.generate()}
              disabled={anyBusy || !prompt.trim() || state?.generationConfigured === false}
              title={
                state?.generationConfigured === false
                  ? "OPENAI_API_KEY / BLOB_READ_WRITE_TOKEN nicht konfiguriert"
                  : "Rendert das Bild und setzt es in diese E-Mail ein"
              }
            >
              {busy === "generate" ? (
                <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wand2 className="me-1 h-3.5 w-3.5" />
              )}
              {busy === "generate" ? "Generiere & prüfe Bild… (bis zu 3 Min.)" : "Bild generieren & einsetzen"}
            </Button>
            {state?.generationConfigured === false && (
              <span className="text-[11px] text-warning">
                Bild-Generierung nicht konfiguriert (OPENAI_API_KEY / BLOB_READ_WRITE_TOKEN).
              </span>
            )}
          </div>
        </div>
      )}

      <p className="mt-2 text-[11px] text-muted-foreground">
        Wirkt nur, wenn dieser E-Mail-Typ das Design „Performance“ verwendet (Einstellungen).
        Ohne eigenes Bild nutzt der Hero das Standard-Bild.
      </p>
    </div>
  );
}
