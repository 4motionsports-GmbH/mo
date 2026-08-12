"use client";

// Mo's "Selbstbild": the exact system prompt the improvement engine criticised,
// rendered read-only with its version hash. The operator sees the SAME text the
// engine saw (lib/mo-self-snapshot.ts) — no paraphrase. The hash changes when
// the code prompt (git), the published knowledge or the directive layer changes.

import * as React from "react";
import { ChevronDown, ChevronRight, Fingerprint } from "lucide-react";
import { Badge, Card, CardContent } from "../ui";

export interface SelfSnapshotInfo {
  shortHash: string;
  promptText: string;
  activeDirectiveCount: number;
  publishedQaCount: number;
}

export function SelfSnapshotCard({ info }: { info: SelfSnapshotInfo }) {
  const [open, setOpen] = React.useState(false);

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Mos Selbstbild (System-Prompt)</h3>
            <p className="mt-1 text-[13px] text-muted-foreground">
              Der aktuell wirksame System-Prompt, kanonisch gerendert — genau der Stand, den der
              Verbesserungslauf analysiert. Enthält {info.publishedQaCount} veröffentlichte
              Q&A-Einträge und {info.activeDirectiveCount} aktive Anweisung(en). Der Kern-Prompt
              wird über Code-Änderungen (Git) angepasst; hier ist er nur lesbar.
            </p>
          </div>
          <Badge variant="secondary" className="gap-1">
            <Fingerprint className="size-3" />
            Version {info.shortHash}
          </Badge>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
        >
          {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          {open ? "System-Prompt ausblenden" : "System-Prompt anzeigen"}
        </button>

        {open && (
          <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-secondary/50 p-3 text-[12px] leading-relaxed text-foreground">
            {info.promptText}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
