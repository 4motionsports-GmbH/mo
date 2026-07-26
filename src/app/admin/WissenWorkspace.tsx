"use client";

// Client workspace for the "Wissen" tab — the Q&A review queue.
//
// Flow per entry: the AI drafted { Wissenslücke, präzise Frage, Produkt? } →
// the operator (optionally edits the question / product handle,) writes the
// answer → "Speichern" (status answered) → "Veröffentlichen" pushes a
// product-linked pair to Shopify's custom.qa metafield (PDP Q&A tab + Mo) or
// activates a general pair for Mo's prompt knowledge base. "Verwerfen" drops
// a non-gap. The "Gespräche scannen" action drafts new entries from eligible,
// not-yet-scanned conversations (explicit click — the only token spend here).

import * as React from "react";
import { Sparkles, Send, Save, Trash2, RefreshCw, Undo2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Textarea,
  toast,
} from "./ui";
import { QA_STATUS_LABELS } from "@/lib/qa-core.mjs";
import type { QaCounts, QaEntry, QaStatus } from "@/lib/qa-store";

type StatusFilter = QaStatus | "all";

const FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "open", label: "Offen" },
  { value: "answered", label: "Beantwortet" },
  { value: "published", label: "Veröffentlicht" },
  { value: "dismissed", label: "Verworfen" },
  { value: "all", label: "Alle" },
];

const STATUS_VARIANT: Record<QaStatus, "warning" | "info" | "success" | "secondary"> = {
  open: "warning",
  answered: "info",
  published: "success",
  dismissed: "secondary",
};

function fail(e: unknown) {
  toast({
    variant: "error",
    title: "Fehler",
    description: e instanceof Error ? e.message : "Unbekannter Fehler",
  });
}

async function call(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = json as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? `Fehler (${res.status})`);
  }
  return json;
}

export function WissenWorkspace({
  initialEntries,
  initialCounts,
  initialScanCandidates,
}: {
  initialEntries: QaEntry[];
  initialCounts: QaCounts;
  initialScanCandidates: number;
}) {
  const [entries, setEntries] = React.useState<QaEntry[]>(initialEntries);
  const [counts, setCounts] = React.useState<QaCounts>(initialCounts);
  const [scanCandidates, setScanCandidates] = React.useState(initialScanCandidates);
  const [filter, setFilter] = React.useState<StatusFilter>("open");
  const [scanning, setScanning] = React.useState(false);

  const reload = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/qa/list`, { cache: "no-store" });
      const json = (await res.json()) as {
        entries: QaEntry[];
        counts: QaCounts;
        scanCandidates: number;
      };
      if (res.ok) {
        setEntries(json.entries);
        setCounts(json.counts);
        setScanCandidates(json.scanCandidates);
      }
    } catch {
      // keep the current view — a failed refresh is not destructive
    }
  }, []);

  const onScan = async () => {
    setScanning(true);
    try {
      const res = (await call("/api/admin/qa/scan", { limit: 10 })) as {
        scanned?: number;
        created?: number;
        noGap?: number;
        duplicates?: number;
        errors?: number;
      };
      toast({
        variant: "success",
        title: "Scan abgeschlossen",
        description: `${res.scanned ?? 0} Gespräche geprüft — ${res.created ?? 0} neue Fragen, ${res.noGap ?? 0} ohne Lücke, ${res.duplicates ?? 0} Duplikate${res.errors ? `, ${res.errors} Fehler` : ""}.`,
      });
      await reload();
    } catch (e) {
      fail(e);
    } finally {
      setScanning(false);
    }
  };

  const visible =
    filter === "all" ? entries : entries.filter((e) => e.status === filter);

  return (
    <div className="space-y-4">
      {/* Header row: scan action + status filters */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-3.5">
          <Button onClick={onScan} disabled={scanning || scanCandidates === 0}>
            <Sparkles className="mr-1.5 h-4 w-4" />
            {scanning
              ? "Scanne …"
              : scanCandidates > 0
                ? `Gespräche scannen (${Math.min(10, scanCandidates)} von ${scanCandidates})`
                : "Keine neuen Gespräche zu scannen"}
          </Button>
          <Button variant="ghost" onClick={() => void reload()} title="Neu laden">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <Button
                key={f.value}
                size="sm"
                variant={filter === f.value ? "default" : "outline"}
                onClick={() => setFilter(f.value)}
              >
                {f.label}
                {f.value !== "all" && (
                  <span className="ml-1.5 opacity-70">
                    {counts[f.value as QaStatus] ?? 0}
                  </span>
                )}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Quelle: Gespräche mit „Offener Bedarf“/„Abgesprungen“ oder Übergabe ans
        Kontaktformular. Veröffentlichen schreibt Produkt-Fragen in das
        Shopify-Metafeld <code>custom.qa</code> (Q&A-Tab der Produktseite + Mos
        Produktwissen); Fragen ohne Produkt landen in Mos allgemeiner
        Wissensbasis.
      </p>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-info/30 bg-info/10 px-3.5 py-3 text-sm text-info">
          Keine Einträge in dieser Ansicht. Nutze „Gespräche scannen“, um neue
          Wissenslücken aus den Beratungen zu ziehen.
        </div>
      ) : (
        visible.map((entry) => (
          <QaEntryCard key={entry.id} entry={entry} onChanged={reload} />
        ))
      )}
    </div>
  );
}

function QaEntryCard({
  entry,
  onChanged,
}: {
  entry: QaEntry;
  onChanged: () => Promise<void>;
}) {
  const [question, setQuestion] = React.useState(entry.question);
  const [answer, setAnswer] = React.useState(entry.answer ?? "");
  const [productId, setProductId] = React.useState(entry.productId ?? "");
  const [busy, setBusy] = React.useState<
    null | "save" | "publish" | "dismiss" | "unpublish"
  >(null);

  // Keep local edits in sync when a reload replaces the entry object.
  React.useEffect(() => {
    setQuestion(entry.question);
    setAnswer(entry.answer ?? "");
    setProductId(entry.productId ?? "");
  }, [entry.id, entry.question, entry.answer, entry.productId, entry.updatedAt]);

  const save = async (): Promise<boolean> => {
    try {
      await call("/api/admin/qa/answer", {
        id: entry.id,
        question,
        answer,
        productId: productId.trim() || null,
      });
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  };

  const onSave = async () => {
    setBusy("save");
    if (await save()) {
      toast({ variant: "success", title: "Gespeichert" });
      await onChanged();
    }
    setBusy(null);
  };

  const onPublish = async () => {
    if (!answer.trim()) {
      fail(new Error("Bitte zuerst eine Antwort eintragen."));
      return;
    }
    setBusy("publish");
    // Save first so exactly what is on screen gets published.
    if (await save()) {
      try {
        const res = (await call("/api/admin/qa/publish", { id: entry.id })) as {
          catalogRefreshed?: boolean;
        };
        toast({
          variant: "success",
          title: "Veröffentlicht",
          description: entry.productId
            ? `In Shopify (custom.qa) gespeichert${res.catalogRefreshed ? " und Mos Katalog sofort aktualisiert" : " — Mos Katalog folgt mit dem nächsten Sync"}.`
            : "In Mos allgemeine Wissensbasis übernommen.",
        });
        await onChanged();
      } catch (e) {
        fail(e);
      }
    }
    setBusy(null);
  };

  const onUnpublish = async () => {
    setBusy("unpublish");
    try {
      await call("/api/admin/qa/unpublish", { id: entry.id });
      toast({
        variant: "success",
        title: "Zurückgezogen",
        description: entry.productId
          ? "Aus dem Shopify-Metafeld entfernt und aus Mos Wissen gelöscht. Der Eintrag steht wieder auf „Beantwortet“."
          : "Aus Mos allgemeiner Wissensbasis entfernt. Der Eintrag steht wieder auf „Beantwortet“.",
      });
      await onChanged();
    } catch (e) {
      fail(e);
    }
    setBusy(null);
  };

  const onDismiss = async () => {
    setBusy("dismiss");
    try {
      await call("/api/admin/qa/dismiss", { id: entry.id });
      await onChanged();
    } catch (e) {
      fail(e);
    }
    setBusy(null);
  };

  const created = new Date(entry.createdAt).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATUS_VARIANT[entry.status]}>
            {(QA_STATUS_LABELS as Record<string, string>)[entry.status] ?? entry.status}
          </Badge>
          {entry.productId ? (
            <Badge variant="info">
              Produkt: {entry.productTitle ?? entry.productId}
            </Badge>
          ) : (
            <Badge variant="secondary">Allgemein</Badge>
          )}
          <span className="text-xs text-muted-foreground">
            #{entry.id} · {created}
            {entry.conversationId != null && (
              <> · aus Gespräch #{entry.conversationId}</>
            )}
          </span>
        </div>

        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">Wissenslücke:</span> {entry.gapSummary}
        </div>

        <div className="grid gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            Frage (öffentlich sichtbar — anpassbar)
          </label>
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={entry.status === "dismissed"}
          />
        </div>

        <div className="grid gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            Produkt-Handle (leer = allgemeine Frage)
          </label>
          <Input
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            placeholder="z. B. atx-multipresse-mpx-780"
            disabled={entry.status === "dismissed"}
          />
        </div>

        <div className="grid gap-2">
          <label className="text-xs font-medium text-muted-foreground">Antwort</label>
          <Textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={4}
            placeholder="Die Antwort des motion sports Teams — erscheint öffentlich im Q&A und in Mos Wissen."
            disabled={entry.status === "dismissed"}
          />
        </div>

        {entry.status !== "dismissed" && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={onSave} disabled={busy !== null} variant="outline">
              <Save className="mr-1.5 h-4 w-4" />
              {busy === "save" ? "Speichere …" : "Speichern"}
            </Button>
            <Button onClick={onPublish} disabled={busy !== null || !answer.trim()}>
              <Send className="mr-1.5 h-4 w-4" />
              {busy === "publish"
                ? "Veröffentliche …"
                : entry.status === "published"
                  ? "Änderung erneut veröffentlichen"
                  : "Veröffentlichen"}
            </Button>
            {entry.status === "published" ? (
              <Button onClick={onUnpublish} disabled={busy !== null} variant="ghost">
                <Undo2 className="mr-1.5 h-4 w-4" />
                {busy === "unpublish" ? "Ziehe zurück …" : "Zurückziehen"}
              </Button>
            ) : (
              <Button onClick={onDismiss} disabled={busy !== null} variant="ghost">
                <Trash2 className="mr-1.5 h-4 w-4" />
                Verwerfen
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
