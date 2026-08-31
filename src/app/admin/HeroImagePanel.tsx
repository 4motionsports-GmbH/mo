"use client";

// Hero-image panel for the image-first email designs ('performance'): lets the
// operator generate a PERSONALISED hero image for ONE draft before sending.
//
// Flow: "Prompt vorschlagen" → the system drafts an image prompt from the
// draft's actual context (products, prose, persona) → the operator edits the
// text → "Bild generieren" renders it (gpt-image-1), uploads it and stores it
// on the draft row → the e-mail preview and the real send show it
// automatically. "Entfernen" falls back to the default hero asset.
//
// Self-contained: loads its state from GET /api/admin/email-hero on mount, so
// the big workspaces (CustomerProfileCard / KampagneWorkspace) only mount it
// with { kind, targetId }. Mounted only where a human reviews before sending
// (marketing + campaign) — summary/DOI send instantly and use the default.

import * as React from "react";
import { Image as ImageIcon, Loader2, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Badge, Button, Label, Textarea, toast } from "./ui";

interface HeroState {
  url: string | null;
  prompt: string | null;
  defaultUrl: string;
  generationConfigured: boolean;
}

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
  const [state, setState] = React.useState<HeroState | null>(null);
  const [prompt, setPrompt] = React.useState("");
  const [busy, setBusy] = React.useState<null | "suggest" | "generate" | "remove">(null);
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    setState(null);
    setPrompt("");
    setOpen(false);
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/email-hero?kind=${kind}&id=${targetId}`,
          { headers: { Accept: "application/json" } }
        );
        const data = (await res.json().catch(() => ({}))) as Partial<HeroState>;
        if (cancelled || !res.ok) return;
        setState({
          url: data.url ?? null,
          prompt: data.prompt ?? null,
          defaultUrl: data.defaultUrl ?? "",
          generationConfigured: Boolean(data.generationConfigured),
        });
        setPrompt(data.prompt ?? "");
      } catch {
        /* panel stays in loading-lite state; actions still guarded below */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind, targetId]);

  const suggest = React.useCallback(async () => {
    if (busy !== null) return;
    setBusy("suggest");
    try {
      const res = await fetch("/api/admin/email-hero/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id: targetId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        prompt?: string;
        error?: { message?: string };
      };
      if (!res.ok || !data.prompt) {
        toast({
          variant: "error",
          title: "Prompt-Vorschlag fehlgeschlagen",
          description: data.error?.message,
        });
        return;
      }
      setPrompt(data.prompt);
      setOpen(true);
      toast({
        variant: "success",
        title: "Prompt vorgeschlagen",
        description: "Aus Produkten & E-Mail-Inhalt erstellt — passe ihn gern an.",
      });
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler", description: "Bitte erneut versuchen." });
    } finally {
      setBusy(null);
    }
  }, [busy, kind, targetId]);

  const generate = React.useCallback(async () => {
    if (busy !== null || !prompt.trim()) return;
    setBusy("generate");
    try {
      const res = await fetch("/api/admin/email-hero/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id: targetId, prompt }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        error?: { message?: string };
      };
      if (!res.ok || !data.url) {
        toast({
          variant: "error",
          title: "Bild-Generierung fehlgeschlagen",
          description: data.error?.message,
        });
        return;
      }
      setState((prev) => (prev ? { ...prev, url: data.url ?? null, prompt } : prev));
      toast({
        variant: "success",
        title: "Hero-Bild eingesetzt",
        description: "Vorschau & Versand verwenden ab sofort dieses Bild.",
      });
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler", description: "Bitte erneut versuchen." });
    } finally {
      setBusy(null);
    }
  }, [busy, kind, targetId, prompt]);

  const remove = React.useCallback(async () => {
    if (busy !== null) return;
    setBusy("remove");
    try {
      const res = await fetch("/api/admin/email-hero/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id: targetId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: { message?: string };
      };
      if (!res.ok || !data.ok) {
        toast({
          variant: "error",
          title: "Entfernen fehlgeschlagen",
          description: data.error?.message,
        });
        return;
      }
      setState((prev) => (prev ? { ...prev, url: null } : prev));
      toast({
        variant: "success",
        title: "Hero-Bild entfernt",
        description: "Die E-Mail verwendet wieder das Standard-Hero-Bild.",
      });
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler", description: "Bitte erneut versuchen." });
    } finally {
      setBusy(null);
    }
  }, [busy, kind, targetId]);

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
            onClick={() => void suggest()}
            disabled={anyBusy}
            title="Die KI schlägt einen Bild-Prompt aus Produkten & E-Mail-Inhalt vor"
          >
            {busy === "suggest" ? (
              <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="me-1 h-3.5 w-3.5" />
            )}
            Prompt vorschlagen
          </Button>
          {state?.url && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void remove()}
              disabled={anyBusy}
            >
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

      {(open || prompt) && (
        <div className="mt-2">
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            placeholder="Bild-Prompt (englisch) — beschreibt die Szene, die das Bildmodell rendert."
            className="text-xs"
            disabled={anyBusy}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => void generate()}
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
              {busy === "generate" ? "Generiere Bild… (bis zu 1 Min.)" : "Bild generieren & einsetzen"}
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
