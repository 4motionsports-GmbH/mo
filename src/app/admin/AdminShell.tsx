"use client";

// Client app-shell for /admin. Owns the active-tab state (replacing the old
// server-side ?tab= switch), the theme toggle, the logout chrome and the single
// Toaster mount. Data is NOT fetched here: the three tab bodies are rendered on
// the SERVER (in page.tsx) and passed in as nodes; the shell only decides which
// one is visible and keeps the URL in sync for deep links / refresh.

import * as React from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { Toaster } from "./ui/toast";
import { ThemeToggle } from "./ThemeToggle";
import type { Theme } from "./theme-config";

export type AdminTab = "overview" | "kunden" | "kpi" | "feedback" | "gespraeche" | "analyse";

const TAB_ORDER: AdminTab[] = [
  "overview",
  "kunden",
  "kpi",
  "feedback",
  "gespraeche",
  "analyse",
];

const TAB_LABEL: Record<AdminTab, string> = {
  overview: "Übersicht",
  kunden: "Kunden",
  kpi: "KPIs",
  feedback: "Feedback",
  gespraeche: "Gespräche",
  analyse: "Analyse",
};

const TAB_SUBTITLE: Record<AdminTab, string> = {
  overview: "Übersicht · Kennzahlen & Schnellzugriff auf einen Blick",
  kunden:
    "Kunden · Suche, filtere & öffne eine Person — Profil, Käufe, Marketing, Korrespondenz & Brief",
  kpi: "KPIs · Pseudonyme Analytics (Cluster A) + Shopify-Käufe",
  feedback: "Feedback · Kund:innen-Rückmeldungen aus dem Widget — neueste zuerst",
  gespraeche:
    "Gespräche · Alle Beratungen einsehen & auswerten — Transkripte, Signale, KI-Analyse",
  analyse:
    "Analyse · Komplettanalysen je Zeitintervall — alle KI-Auswertungen verdichtet, gespeichert & als PDF",
};

// The Übersicht tab is the bare /admin (the default landing tab); every other
// tab carries its `?tab=` so a refresh / copied link lands on the same tab.
function tabToQuery(tab: AdminTab): string {
  return tab === "overview" ? "/admin" : `/admin?tab=${tab}`;
}

export function AdminShell({
  initialTab,
  themeInitial,
  logoutAction,
  overview,
  kunden,
  kpi,
  feedback,
  gespraeche,
  analyse,
}: {
  initialTab: AdminTab;
  themeInitial: Theme | null;
  logoutAction: () => void | Promise<void>;
  overview: React.ReactNode;
  kunden: React.ReactNode;
  kpi: React.ReactNode;
  feedback: React.ReactNode;
  gespraeche: React.ReactNode;
  analyse: React.ReactNode;
}) {
  const [tab, setTab] = React.useState<AdminTab>(initialTab);

  // Graceful URL sync: keep the query param current so a refresh or a copied
  // link lands on the same tab, without a full server navigation.
  const onTabChange = React.useCallback((next: string) => {
    const value = (TAB_ORDER as string[]).includes(next) ? (next as AdminTab) : "overview";
    setTab(value);
    if (typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", tabToQuery(value));
    }
  }, []);

  // Light, optional keyboard shortcuts (dialogs close on Esc via the Dialog
  // primitive itself). Deliberately bare keys, ignored while typing in a field or
  // with a modifier held so they never clobber browser/native shortcuts:
  //   1–4  switch to the n-th tab
  //   /    focus the Kunden search box (switching to that tab if needed)
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el?.isContentEditable
      ) {
        return;
      }

      if (e.key >= "1" && e.key <= String(TAB_ORDER.length)) {
        const next = TAB_ORDER[Number(e.key) - 1];
        if (next) {
          e.preventDefault();
          onTabChange(next);
        }
        return;
      }

      if (e.key === "/") {
        e.preventDefault();
        onTabChange("kunden");
        // Let the tab become visible before focusing its (now un-hidden) input.
        requestAnimationFrame(() => {
          document.getElementById("ms-search")?.focus();
        });
      }
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onTabChange]);

  const bodies: Record<AdminTab, React.ReactNode> = {
    overview,
    kunden,
    kpi,
    feedback,
    gespraeche,
    analyse,
  };

  // The Kunden + Gespräche + Analyse workspaces are master–detail layouts that
  // want the extra width; the other tabs stay comfortably centred at the narrower
  // measure.
  const containerWidth =
    tab === "kunden" || tab === "gespraeche" || tab === "analyse"
      ? "max-w-7xl"
      : "max-w-5xl";

  return (
    <div className={`mx-auto ${containerWidth} px-5 pb-16 pt-6`}>
      <Tabs value={tab} onValueChange={onTabChange}>
        <header className="mb-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Admin-Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">{TAB_SUBTITLE[tab]}</p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle initial={themeInitial} />
            <form action={logoutAction}>
              <button
                type="submit"
                className="inline-flex h-9 items-center justify-center rounded-md border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Abmelden
              </button>
            </form>
          </div>
        </header>

        <nav className="my-5">
          <TabsList>
            {TAB_ORDER.map((t) => (
              <TabsTrigger key={t} value={t}>
                {TAB_LABEL[t]}
              </TabsTrigger>
            ))}
          </TabsList>
        </nav>

        {/* All bodies stay mounted (forceMount) so switching tabs preserves any
            in-progress edits in the client cards. */}
        {TAB_ORDER.map((t) => (
          <TabsContent key={t} value={t} forceMount>
            {bodies[t]}
          </TabsContent>
        ))}
      </Tabs>

      <Toaster />
    </div>
  );
}
