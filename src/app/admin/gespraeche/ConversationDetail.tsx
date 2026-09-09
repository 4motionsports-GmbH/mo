"use client";

// The selected conversation: header (tier, persona, outcome signals), the
// cached KI-Analyse with its on-demand (re)run, and the transcript through the
// shared TranscriptView. Fetched on selection via POST
// /api/admin/conversations/detail; the analysis runs via
// /api/admin/conversations/analyze (same payloads as before).

import * as React from "react";
import { useRouter } from "next/navigation";
import { MessagesSquare, Sparkles } from "lucide-react";
import type { AdminConversationDetail } from "@/lib/admin-conversations";
import { ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import { eur, num, plural } from "@/lib/admin-format.mjs";
import {
  Button,
  Callout,
  Card,
  CardContent,
  EmptyState,
  InfoTip,
  Skeleton,
  StatusBadge,
  TranscriptView,
  toast,
} from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import { useAsyncAction } from "../lib/use-async-action";
import { AnalysisBadges, OutcomeChips, TierBadge, personaLabel } from "./badges";

interface AnalysisUsage {
  inputTokens: number;
  outputTokens: number;
  approxCostUsd: number;
}

interface AnalyzeResponse {
  analysis?: AdminConversationDetail["analysis"];
  usage?: AnalysisUsage | null;
  warning?: string;
}

interface Loaded {
  id: number;
  detail: AdminConversationDetail | null;
  error: string | null;
  usage: AnalysisUsage | null;
}

function friendly(err: unknown): string {
  const message = errorMessage(err, "Gespräch konnte nicht geladen werden.");
  return /failed to fetch|networkerror|load failed/i.test(message)
    ? "Netzwerkfehler — bitte erneut versuchen."
    : message;
}

export function ConversationDetail({ conversationId }: { conversationId: number | null }) {
  const router = useRouter();
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    if (conversationId == null) return;
    const controller = new AbortController();
    adminFetch<{ detail?: AdminConversationDetail }>("/api/admin/conversations/detail", {
      body: { conversationId },
      signal: controller.signal,
    })
      .then((json) => {
        if (controller.signal.aborted) return;
        setLoaded({
          id: conversationId,
          detail: json.detail ?? null,
          error: json.detail ? null : "Gespräch konnte nicht geladen werden.",
          usage: null,
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoaded({ id: conversationId, detail: null, error: friendly(err), usage: null });
      });
    return () => controller.abort();
  }, [conversationId, reloadKey]);

  // Loading is derived: the loaded record belongs to another id (or none yet).
  const current = loaded && loaded.id === conversationId ? loaded : null;
  const detail = current?.detail ?? null;

  const analyze = useAsyncAction(
    async (force: boolean) => {
      if (!detail) return null;
      return adminFetch<AnalyzeResponse>("/api/admin/conversations/analyze", {
        body: { conversationId: detail.id, force },
      });
    },
    {
      errorToast: "Fehler",
      onSuccess: (json) => {
        if (!json) return;
        setLoaded((prev) =>
          prev && prev.detail
            ? {
                ...prev,
                detail: json.analysis ? { ...prev.detail, analysis: json.analysis } : prev.detail,
                usage: json.usage ?? prev.usage,
              }
            : prev
        );
        if (json.warning) toast({ variant: "warning", title: "Hinweis", description: json.warning });
        else toast({ variant: "success", title: "Gespräch analysiert" });
        router.refresh();
      },
    }
  );

  if (conversationId == null) {
    return (
      <EmptyState
        icon={<MessagesSquare />}
        title="Kein Gespräch ausgewählt"
        description="Wähle links ein Gespräch, um Transkript und Analyse zu sehen."
        className="min-h-[16rem]"
      />
    );
  }

  if (!current) {
    return (
      <Card>
        <CardContent className="space-y-2 p-4" aria-hidden>
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!detail) {
    return (
      <Callout
        tone="destructive"
        action={
          <Button variant="outline" size="xs" onClick={() => setReloadKey((k) => k + 1)}>
            Erneut laden
          </Button>
        }
      >
        {current.error ?? "Nicht gefunden."}
      </Callout>
    );
  }

  const a = detail.analysis;
  const persona = personaLabel(detail.personaLabel);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <TierBadge tier={detail.tier} size="md" interactive />
          {persona && (
            <StatusBadge tone="neutral" dot={false} size="md">
              {persona}
            </StatusBadge>
          )}
          <span className="text-xs text-muted-foreground">
            {formatAdmin(detail.createdAt, ADMIN_DATE_TIME_SHORT, detail.createdAt || "—")} ·{" "}
            {plural(detail.messageCount, "Nachricht", "Nachrichten")} · {detail.status}
          </span>
          <span className="ml-auto text-2xs text-muted-foreground">#{detail.id}</span>
        </div>

        <OutcomeChips item={detail.outcomes} size="md" interactive />

        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="flex items-center gap-1.5 text-sm text-foreground">
              KI-Analyse
              <InfoTip>
                Ein Klick startet einen günstigen KI-Durchlauf (Haiku) und speichert das Ergebnis
                am Gespräch — erneutes Öffnen kostet nichts. „Neu analysieren“ überschreibt die
                gespeicherte Analyse (erneute Kosten).
              </InfoTip>
            </strong>
            <Button size="sm" loading={analyze.pending} onClick={() => void analyze.run(a != null)}>
              {!analyze.pending && <Sparkles />}
              {analyze.pending ? "Analysiere…" : a ? "Neu analysieren" : "Analysieren"}
            </Button>
          </div>
          {a ? (
            <div className="mt-2 flex flex-col gap-2">
              <AnalysisBadges category={a.category} quality={a.quality} size="md" />
              {a.summary && <p className="text-sm text-foreground">{a.summary}</p>}
              {a.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {a.tags.map((t) => (
                    <StatusBadge key={t} tone="neutral" dot={false}>
                      {t}
                    </StatusBadge>
                  ))}
                </div>
              )}
              <p className="text-2xs text-muted-foreground">
                Stand: {formatAdmin(a.updatedAt, ADMIN_DATE_TIME_SHORT)}
                {a.model ? ` · ${a.model}` : ""}
                {a.costEur > 0 ? ` · ~${eur(a.costEur, 4)}` : ""}
                {current.usage
                  ? ` · letzter Lauf: ${num(current.usage.inputTokens)} / ${num(current.usage.outputTokens)} Tokens`
                  : ""}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">Noch nicht analysiert.</p>
          )}
        </div>

        <div>
          <div className="mb-2 text-sm font-semibold text-foreground">Transkript</div>
          <TranscriptView turns={detail.transcript} showTimes />
        </div>
      </CardContent>
    </Card>
  );
}
