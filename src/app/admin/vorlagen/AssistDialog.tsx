"use client";

// „Mit KI gestalten“ — describe the mail (or the change), optionally attach a
// screenshot of a mail to rebuild; the AI returns a block document
// (POST /api/admin/vorlagen/assist, lib/mail-template-assist.ts). The result
// replaces the editor's document as an UNSAVED change — the parent keeps the
// previous version for „Rückgängig“.

import * as React from "react";
import { ImagePlus, Sparkles, X } from "lucide-react";
import {
  Button,
  Callout,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  IconButton,
  Textarea,
} from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import type { BlockUse, MailDoc } from "./BlockEditor";

const EXAMPLES: Record<BlockUse, string[]> = {
  bulk: [
    "Black-Week-Mail in Schwarz und Gelb: großes Banner oben, kurzer Text, Gutschein BLACKWEEK25 für 25 % auf alles, Countdown bis Sonntag 23:59, Raster mit Produkten, großer Button „Jetzt sparen“.",
    "Mach den Text kürzer und freundlicher und setz den Button direkt unter das Bild.",
  ],
  personal: [
    "Ruhiges, hochwertiges Design: Titelbild oben, darunter Mos Text, dann das Angebot, Mo-Hinweis am Ende. Akzentfarbe Dunkelblau.",
  ],
  template: [
    "Newsletter-Vorlage im Markenlook: Logo, Bild, Überschrift, Text, Button, Produkte in Zeilen.",
  ],
};

export function AssistDialog({
  open,
  onOpenChange,
  doc,
  use,
  onResult,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doc: MailDoc | null;
  use: BlockUse;
  onResult: (doc: MailDoc, notes: string) => void;
}) {
  const [instruction, setInstruction] = React.useState("");
  const [shot, setShot] = React.useState<{ base64: string; mediaType: string; name: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const json = await adminFetch<{ doc: MailDoc; notes: string }>("/api/admin/vorlagen/assist", {
        body: {
          instruction,
          doc,
          use,
          screenshot: shot ? { base64: shot.base64, mediaType: shot.mediaType } : null,
        },
      });
      onResult(json.doc, json.notes);
      onOpenChange(false);
      setInstruction("");
      setShot(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" aria-hidden /> Mit KI gestalten
          </DialogTitle>
          <DialogDescription>
            Beschreibe die Mail oder die Änderung. Die KI kennt alle Bausteine und Mo-Funktionen; Bilder, Produkte und Codes
            ergänzt du selbst. Das Ergebnis ist ungespeichert — „Rückgängig“ holt den alten Stand zurück.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {error && <Callout tone="destructive">{error}</Callout>}
          <Field label={doc ? "Was soll sich ändern?" : "Was für eine Mail?"}>
            <Textarea
              rows={5}
              value={instruction}
              maxLength={2000}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={EXAMPLES[use][0]}
              disabled={busy}
            />
          </Field>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES[use].map((ex) => (
              <button
                key={ex}
                type="button"
                className="max-w-full truncate rounded-full border border-border px-2.5 py-1 text-2xs text-muted-foreground hover:bg-surface-2"
                onClick={() => setInstruction(ex)}
                disabled={busy}
              >
                {ex.length > 70 ? `${ex.slice(0, 68)}…` : ex}
              </button>
            ))}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (file.size > 3_000_000) {
                setError("Der Screenshot ist größer als 3 MB.");
                return;
              }
              const reader = new FileReader();
              reader.onload = () => {
                const result = String(reader.result ?? "");
                setShot({ base64: result.replace(/^data:[^,]*,/, ""), mediaType: file.type || "image/png", name: file.name });
              };
              reader.readAsDataURL(file);
            }}
          />
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              <ImagePlus /> Screenshot als Vorbild
            </Button>
            {shot && (
              <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                <span className="truncate">{shot.name}</span>
                <IconButton label="Screenshot entfernen" size="icon-sm" onClick={() => setShot(null)} disabled={busy}>
                  <X />
                </IconButton>
              </span>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Abbrechen
          </Button>
          <Button onClick={() => void run()} loading={busy} disabled={instruction.trim().length < 5 && !shot}>
            <Sparkles /> Gestalten
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
