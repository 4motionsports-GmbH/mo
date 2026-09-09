"use client";

// Mo's "Selbstbild": the exact system prompt the improvement engine criticised,
// rendered read-only with its version hash. The operator sees the SAME text the
// engine saw (lib/mo-self-snapshot.ts) — no paraphrase. The hash changes when
// the code prompt (git), the published knowledge or the directive layer changes.

import * as React from "react";
import { Fingerprint } from "lucide-react";
import { num, plural } from "@/lib/admin-format.mjs";
import { Disclosure, InfoTip, StatusBadge } from "../ui";

export interface SelfSnapshotInfo {
  shortHash: string;
  promptText: string;
  activeDirectiveCount: number;
  publishedQaCount: number;
}

export function SelfSnapshotCard({ info }: { info: SelfSnapshotInfo }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <StatusBadge tone="neutral" dot={false} icon={<Fingerprint />} size="md">
          Version {info.shortHash}
        </StatusBadge>
        <span>
          {num(info.publishedQaCount)} veröffentlichte Q&A-Einträge ·{" "}
          {plural(info.activeDirectiveCount, "aktive Anweisung", "aktive Anweisungen")}
        </span>
        <InfoTip>
          Der aktuell wirksame System-Prompt, kanonisch gerendert — genau der Stand, den der
          Verbesserungslauf analysiert. Enthält die veröffentlichten Q&A-Einträge und die aktiven
          Anweisungen. Der Kern-Prompt wird über Code-Änderungen (Git) angepasst; hier ist er nur
          lesbar.
        </InfoTip>
      </div>
      <Disclosure title={<span className="text-xs">System-Prompt anzeigen</span>} framed={false}>
        <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-surface-2 p-3 text-xs leading-relaxed text-foreground">
          {info.promptText}
        </pre>
      </Disclosure>
    </div>
  );
}
