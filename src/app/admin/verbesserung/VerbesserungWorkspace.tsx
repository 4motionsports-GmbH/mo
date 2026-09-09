"use client";

// The Verbesserung screen's workspace (docs/IMPROVEMENT_LOOP.md): a
// master–detail island like Analyse. The rail lists stored improvement runs;
// the main area is either the "new run" panel, a running run (stepped to
// completion from here) or a finished run (Wirkungs-Check + suggestions).
// Below sit the two standing tools in Disclosures: Mo's live ANWEISUNGEN
// layer and Mo's SELBSTBILD (the rendered system prompt + version hash).

import * as React from "react";
import { Sparkles } from "lucide-react";
import { ADMIN_DATE_MEDIUM, formatAdmin } from "@/lib/admin-datetime.mjs";
import { num, plural } from "@/lib/admin-format.mjs";
import {
  Button,
  Callout,
  Card,
  CardContent,
  Disclosure,
  SidebarList,
  Skeleton,
  SplitPane,
  type SidebarListItem,
} from "../ui";
import { adminFetch, friendlyErrorMessage } from "../lib/admin-fetch";
import { DirectivesCard, type DirectiveItem, type DirectiveLimits } from "./DirectivesCard";
import { NewRunPanel } from "./NewRunPanel";
import { RunStatusBadge, RunView } from "./RunView";
import { SelfSnapshotCard, type SelfSnapshotInfo } from "./SelfSnapshotCard";
import type { SuggestionItem } from "./SuggestionCard";
import type { CompletedReportOption, RunDetail, RunListItem } from "./types";

export type { RunDetail, RunListItem, CompletedReportOption } from "./types";

function syncRunParam(id: number | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (id === null) url.searchParams.delete("run");
  else url.searchParams.set("run", String(id));
  window.history.replaceState(window.history.state, "", url.toString());
}

export function VerbesserungWorkspace({
  initialRuns,
  completedReports,
  initialDirectives,
  directiveLimits,
  selfSnapshot,
  initialRunId,
}: {
  initialRuns: RunListItem[];
  completedReports: CompletedReportOption[];
  initialDirectives: DirectiveItem[];
  directiveLimits: DirectiveLimits;
  selfSnapshot: SelfSnapshotInfo;
  initialRunId: number | null;
}) {
  const [runs, setRuns] = React.useState<RunListItem[]>(initialRuns);
  const [selectedId, setSelectedId] = React.useState<number | null>(initialRunId);
  const [loaded, setLoaded] = React.useState<{ id: number; detail: RunDetail | null; error: string | null } | null>(
    null
  );
  const [reloadKey, setReloadKey] = React.useState(0);
  const [activeDirectives, setActiveDirectives] = React.useState(
    initialDirectives.filter((d) => d.active).length
  );

  const refreshList = React.useCallback(async () => {
    try {
      const data = await adminFetch<{ runs?: RunListItem[] }>("/api/admin/improve");
      if (Array.isArray(data.runs)) setRuns(data.runs);
    } catch {
      /* keep the last good list */
    }
  }, []);

  React.useEffect(() => {
    if (selectedId == null) return;
    const controller = new AbortController();
    adminFetch<{ run?: RunDetail }>(`/api/admin/improve/${selectedId}`, { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return;
        setLoaded({
          id: selectedId,
          detail: data.run ?? null,
          error: data.run ? null : "Lauf konnte nicht geladen werden.",
        });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setLoaded({
          id: selectedId,
          detail: null,
          error: friendlyErrorMessage(err, "Lauf konnte nicht geladen werden."),
        });
      });
    return () => controller.abort();
  }, [selectedId, reloadKey]);

  const select = React.useCallback((id: number) => {
    setSelectedId(id);
    syncRunParam(id);
  }, []);
  const goNew = React.useCallback(() => {
    setSelectedId(null);
    syncRunParam(null);
  }, []);
  const reloadDetail = React.useCallback(() => setReloadKey((k) => k + 1), []);

  const onRunDone = React.useCallback(() => {
    void refreshList();
    reloadDetail();
  }, [refreshList, reloadDetail]);

  const onSuggestionChanged = React.useCallback((updated: SuggestionItem) => {
    setLoaded((l) =>
      l && l.detail
        ? {
            ...l,
            detail: {
              ...l.detail,
              suggestions: l.detail.suggestions.map((s) => (s.id === updated.id ? updated : s)),
            },
          }
        : l
    );
  }, []);

  const current = loaded && loaded.id === selectedId ? loaded : null;

  let main: React.ReactNode;
  if (selectedId === null) {
    main = (
      <NewRunPanel
        completedReports={completedReports}
        hasRuns={runs.length > 0}
        onCreated={(id) => {
          void refreshList();
          select(id);
        }}
      />
    );
  } else if (!current) {
    main = (
      <Card>
        <CardContent className="space-y-2 p-5" aria-busy="true" aria-label="Lauf wird geladen">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  } else if (!current.detail) {
    main = (
      <Callout
        tone="destructive"
        action={
          <Button size="xs" variant="outline" onClick={reloadDetail}>
            Erneut laden
          </Button>
        }
      >
        {current.error ?? "Lauf konnte nicht geladen werden."}
      </Callout>
    );
  } else {
    main = (
      <RunView
        key={current.detail.id}
        detail={current.detail}
        onDone={onRunDone}
        onDeleted={() => {
          void refreshList();
          goNew();
        }}
        onSuggestionChanged={onSuggestionChanged}
      />
    );
  }

  const items: SidebarListItem[] = runs.map((r) => ({
    id: r.id,
    title: r.reportTitle,
    icon: <Sparkles />,
    badge: <RunStatusBadge status={r.status} />,
    metaLeft: formatAdmin(r.createdAt, ADMIN_DATE_MEDIUM, r.createdAt),
    metaRight: r.status === "complete" ? plural(r.suggestionCount, "Vorschlag", "Vorschläge") : undefined,
  }));

  return (
    <SplitPane
      listWidth="md"
      listLabel="Verbesserungsläufe"
      stickyTopClassName="lg:top-[4.5rem] lg:max-h-[calc(100vh-5.5rem)]"
      list={
        <SidebarList
          label="Verbesserungsläufe"
          newLabel="Neuer Verbesserungslauf"
          onNew={goNew}
          newActive={selectedId === null}
          heading={`Läufe (${num(runs.length)})`}
          items={items}
          activeId={selectedId}
          onSelect={select}
          emptyText="Noch keine Läufe. Starte oben deinen ersten Verbesserungslauf über eine fertige Komplettanalyse."
        />
      }
      detail={
        <div className="flex flex-col gap-6">
          {main}
          {/* The two tool cards stay out of the way until needed — the everyday
              flow is run → decide on cards; directives/prompt are occasional. */}
          <div className="flex flex-col gap-2">
            <Disclosure title="Anweisungen an Mo" meta={`${num(activeDirectives)} aktiv`} keepMounted>
              <DirectivesCard
                initialDirectives={initialDirectives}
                limits={directiveLimits}
                onActiveCountChange={setActiveDirectives}
              />
            </Disclosure>
            <Disclosure title="Mos Selbstbild (System-Prompt)" meta={`Version ${selfSnapshot.shortHash}`}>
              <SelfSnapshotCard info={selfSnapshot} />
            </Disclosure>
          </div>
        </div>
      }
    />
  );
}
