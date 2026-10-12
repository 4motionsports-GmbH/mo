"use client";

// One preview dialog per design: a type selector inside the dialog swaps the
// rendered sample e-mail (POST /api/admin/email-designs/preview {designKey,
// kind, sample}) — instead of one button per type on every design card
// (UX-E1). Marketing and campaign mails are an item mail OR a set mail, so for
// those types a second switch („Angebot“) picks the sample. Same fetch → blob
// → object-URL pattern as EmailPreviewButton; the URL is revoked on swap/close.

import * as React from "react";
import { EMAIL_THEME_KIND_LABELS } from "@/lib/email-theme.mjs";
import {
  Callout,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  SegmentedControl,
  Skeleton,
} from "../ui";
import { EmailPreviewFrame } from "../EmailPreviewFrame";

export interface DesignPreviewTarget {
  designKey: string;
  designName: string;
  supportedKinds: string[];
  kind: string;
}

const kindLabel = (kind: string): string =>
  (EMAIL_THEME_KIND_LABELS as Record<string, string>)[kind] ?? kind;

/** The types whose mail is an item mail or a set mail (offer-mode.mjs). */
const OFFER_KINDS = new Set(["marketing", "campaign"]);
type Sample = "items" | "set";
const SAMPLE_OPTIONS: Array<{ value: Sample; label: string }> = [
  { value: "items", label: "Einzelprodukte" },
  { value: "set", label: "Set-Angebot" },
];

export function DesignPreviewDialog({
  target,
  onClose,
}: {
  target: DesignPreviewTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(v) => !v && onClose()}>
      {target && <PreviewBody key={target.designKey} target={target} />}
    </Dialog>
  );
}

function PreviewBody({ target }: { target: DesignPreviewTarget }) {
  const [kind, setKind] = React.useState(target.kind);
  const [sampleChoice, setSampleChoice] = React.useState<Sample>("items");
  const offerKind = OFFER_KINDS.has(kind);
  const sample: Sample = offerKind ? sampleChoice : "items";
  const view = `${kind}:${sample}`;
  const [state, setState] = React.useState<{ view: string; url: string | null; error: string | null } | null>(null);

  React.useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    const requested = `${kind}:${sample}`;
    fetch("/api/admin/email-designs/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ designKey: target.designKey, kind, sample }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          throw new Error(json?.error?.message ?? `Fehler (${res.status})`);
        }
        const blob = await res.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ view: requested, url: objectUrl, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          view: requested,
          url: null,
          error: err instanceof Error ? err.message : "Vorschau fehlgeschlagen.",
        });
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [target.designKey, kind, sample]);

  const current = state && state.view === view ? state : null;
  const options = target.supportedKinds.map((k) => ({ value: k, label: kindLabel(k) }));
  const frameTitle = `${target.designName} — ${kindLabel(kind)}${
    offerKind ? ` (${SAMPLE_OPTIONS.find((o) => o.value === sample)?.label})` : ""
  }`;

  return (
    <DialogContent className="flex flex-col" style={{ maxWidth: "95vw", height: "92vh" }}>
      <DialogHeader>
        <DialogTitle>Vorschau — {target.designName}</DialogTitle>
        <DialogDescription>
          Beispiel-E-Mail des gewählten Typs in diesem Design — Inhalte sind Beispieldaten, Links
          inaktiv.
        </DialogDescription>
      </DialogHeader>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <SegmentedControl label="E-Mail-Typ" value={kind} options={options} onChange={setKind} />
        {offerKind && (
          <SegmentedControl label="Angebot" value={sample} options={SAMPLE_OPTIONS} onChange={setSampleChoice} />
        )}
      </div>
      {current?.error ? (
        <Callout tone="destructive" compact className="mt-3">
          {current.error}
        </Callout>
      ) : current?.url ? (
        <EmailPreviewFrame title={frameTitle} src={current.url} />
      ) : (
        <Skeleton className="mt-3 min-h-0 flex-1 rounded-lg" aria-label="Vorschau wird geladen" />
      )}
    </DialogContent>
  );
}
