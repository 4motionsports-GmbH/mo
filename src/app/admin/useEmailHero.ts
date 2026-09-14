"use client";

// useEmailHero — the state + the four actions of the per-draft KI-Hero
// (docs/EMAIL_DESIGNS.md, „Performance“): load the stored state, let the
// system SUGGEST an image prompt + headline from the draft's context, GENERATE
// the image (renders, vision check, gradient, mobile crop — up to three
// minutes), save the headline alone, or REMOVE the custom image (back to the
// design's default asset). Shared by the Kunden hero panel (HeroImagePanel)
// and the Kampagne desk's Hero block + sheet, so both talk to the same routes
// with the same toasts.

import * as React from "react";
import { toast } from "./ui";

export interface EmailHeroState {
  url: string | null;
  prompt: string | null;
  headline: string | null;
  defaultUrl: string;
  generationConfigured: boolean;
}

export interface EmailHeroReview {
  score: number;
  pass: boolean;
  reasons: string[];
  rerendered: boolean;
  references: number;
}

export type EmailHeroBusy = null | "suggest" | "generate" | "remove" | "headline";

export interface UseEmailHeroOptions {
  kind: "marketing" | "campaign";
  /** marketing: send id · campaign: contact id. */
  targetId: number;
  /** Called after the stored hero changed (generate / remove / headline). */
  onChange?: (next: { url: string | null; headline: string | null }) => void;
  /** Called after a successful generation with the quality review. */
  onGenerated?: (review: EmailHeroReview | null) => void;
  /** Skip the initial GET (the caller already knows the stored state). */
  lazy?: boolean;
  /** The stored hero as a lazy caller already knows it: the fallback for the
   * field an action does not touch, so „Entfernen“ keeps the headline and a
   * saved headline keeps the image on the caller's card. */
  initial?: { url: string | null; headline: string | null };
}

export function useEmailHero({ kind, targetId, onChange, onGenerated, lazy = false, initial }: UseEmailHeroOptions) {
  const [state, setState] = React.useState<EmailHeroState | null>(null);
  const [prompt, setPrompt] = React.useState("");
  const [headline, setHeadline] = React.useState("");
  const [busy, setBusy] = React.useState<EmailHeroBusy>(null);
  const onChangeRef = React.useRef(onChange);
  const onGeneratedRef = React.useRef(onGenerated);
  const initialRef = React.useRef(initial);
  React.useEffect(() => {
    onChangeRef.current = onChange;
    onGeneratedRef.current = onGenerated;
    initialRef.current = initial;
  });

  const load = React.useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(`/api/admin/email-hero?kind=${kind}&id=${targetId}`, {
        headers: { Accept: "application/json" },
        signal,
      });
      const data = (await res.json().catch(() => ({}))) as Partial<EmailHeroState>;
      if (signal?.aborted || !res.ok) return;
      setState({
        url: data.url ?? null,
        prompt: data.prompt ?? null,
        headline: data.headline ?? null,
        defaultUrl: data.defaultUrl ?? "",
        generationConfigured: Boolean(data.generationConfigured),
      });
      setPrompt(data.prompt ?? "");
      setHeadline(data.headline ?? "");
    } catch {
      /* stays in the loading-lite state; actions remain guarded */
    }
  }, [kind, targetId]);

  React.useEffect(() => {
    const controller = new AbortController();
    setState(null);
    setPrompt("");
    setHeadline("");
    if (!lazy) void load(controller.signal);
    return () => controller.abort();
  }, [load, lazy]);

  const suggest = React.useCallback(async (): Promise<{ prompt: string; headline: string | null } | null> => {
    if (busy !== null) return null;
    setBusy("suggest");
    try {
      const res = await fetch("/api/admin/email-hero/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id: targetId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        prompt?: string;
        headline?: string;
        error?: { message?: string };
      };
      if (!res.ok || !data.prompt) {
        toast({ variant: "error", title: "Prompt-Vorschlag fehlgeschlagen", description: data.error?.message });
        return null;
      }
      setPrompt(data.prompt);
      if (data.headline) setHeadline(data.headline);
      toast({
        variant: "success",
        title: "Hero vorgeschlagen",
        description: "Bild-Prompt & Schlagzeile aus Produkten und E-Mail-Inhalt — beides anpassbar.",
      });
      return { prompt: data.prompt, headline: data.headline ?? null };
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler", description: "Bitte erneut versuchen." });
      return null;
    } finally {
      setBusy(null);
    }
  }, [busy, kind, targetId]);

  const generate = React.useCallback(
    async (override?: { prompt?: string; headline?: string }): Promise<boolean> => {
      const usePrompt = (override?.prompt ?? prompt).trim();
      const useHeadline = (override?.headline ?? headline).trim();
      if (busy !== null || !usePrompt) return false;
      setBusy("generate");
      try {
        const res = await fetch("/api/admin/email-hero/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, id: targetId, prompt: usePrompt, headline: useHeadline || null }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          url?: string;
          review?: EmailHeroReview | null;
          error?: { message?: string };
        };
        if (!res.ok || !data.url) {
          toast({ variant: "error", title: "Bild-Generierung fehlgeschlagen", description: data.error?.message });
          return false;
        }
        const url = data.url;
        setState((prev) =>
          prev
            ? { ...prev, url, prompt: usePrompt, headline: useHeadline || null }
            : { url, prompt: usePrompt, headline: useHeadline || null, defaultUrl: "", generationConfigured: true }
        );
        onChangeRef.current?.({ url, headline: useHeadline || null });
        onGeneratedRef.current?.(data.review ?? null);
        const r = data.review;
        const check = r
          ? ` KI-Prüfung ${r.score}/10${r.rerendered ? " (einmal neu gerendert)" : ""}${
              r.references ? `, ${r.references} Referenzfoto${r.references === 1 ? "" : "s"}` : ""
            }${r.pass ? "" : ` — Hinweise: ${r.reasons.join(", ")}`}.`
          : "";
        toast({
          variant: "success",
          title: "Hero-Bild eingesetzt",
          description: `Vorschau & Versand verwenden ab sofort dieses Bild.${check}`,
        });
        return true;
      } catch {
        toast({ variant: "error", title: "Netzwerkfehler", description: "Bitte erneut versuchen." });
        return false;
      } finally {
        setBusy(null);
      }
    },
    [busy, kind, targetId, prompt, headline]
  );

  const saveHeadline = React.useCallback(async (): Promise<boolean> => {
    if (busy !== null) return false;
    setBusy("headline");
    const value = headline.trim() || null;
    try {
      const res = await fetch("/api/admin/email-hero/headline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id: targetId, headline: value }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: { message?: string } };
      if (!res.ok || !data.ok) {
        toast({
          variant: "error",
          title: "Schlagzeile konnte nicht gespeichert werden",
          description: data.error?.message,
        });
        return false;
      }
      setState((prev) => (prev ? { ...prev, headline: value } : prev));
      onChangeRef.current?.({ url: state?.url ?? initialRef.current?.url ?? null, headline: value });
      toast({
        variant: "success",
        title: "Schlagzeile gespeichert",
        description: value
          ? "Vorschau & Versand verwenden ab sofort diese Schlagzeile."
          : "Die E-Mail verwendet wieder die Standard-Schlagzeile des Designs.",
      });
      return true;
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler", description: "Bitte erneut versuchen." });
      return false;
    } finally {
      setBusy(null);
    }
  }, [busy, kind, targetId, headline, state?.url]);

  const remove = React.useCallback(async (): Promise<boolean> => {
    if (busy !== null) return false;
    setBusy("remove");
    try {
      const res = await fetch("/api/admin/email-hero/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id: targetId }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: { message?: string } };
      if (!res.ok || !data.ok) {
        toast({ variant: "error", title: "Entfernen fehlgeschlagen", description: data.error?.message });
        return false;
      }
      setState((prev) => (prev ? { ...prev, url: null } : prev));
      onChangeRef.current?.({ url: null, headline: state?.headline ?? initialRef.current?.headline ?? null });
      toast({
        variant: "success",
        title: "Hero-Bild entfernt",
        description: "Die E-Mail verwendet wieder das Standard-Hero-Bild.",
      });
      return true;
    } catch {
      toast({ variant: "error", title: "Netzwerkfehler", description: "Bitte erneut versuchen." });
      return false;
    } finally {
      setBusy(null);
    }
  }, [busy, kind, targetId, state?.headline]);

  return {
    state,
    prompt,
    setPrompt,
    headline,
    setHeadline,
    busy,
    load,
    suggest,
    generate,
    saveHeadline,
    remove,
  };
}

export type EmailHero = ReturnType<typeof useEmailHero>;
