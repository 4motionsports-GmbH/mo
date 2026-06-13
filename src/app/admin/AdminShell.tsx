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

export type AdminTab = "overview" | "customers" | "kunden" | "kpi";

const TAB_ORDER: AdminTab[] = ["overview", "customers", "kunden", "kpi"];

const TAB_LABEL: Record<AdminTab, string> = {
  overview: "Übersicht",
  customers: "Marketing",
  kunden: "Kunden",
  kpi: "KPIs",
};

const TAB_SUBTITLE: Record<AdminTab, string> = {
  overview: "Übersicht · Kennzahlen & Schnellzugriff auf einen Blick",
  customers: "Marketing · Nur bestätigte (DOI), nicht abgemeldete Kontakte",
  kunden:
    "Kunden · Gruppiert nach Person (E-Mail) — Sessions, Käufe & Kundenverständnis",
  kpi: "KPIs · Pseudonyme Analytics (Cluster A) + Shopify-Käufe",
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
  marketing,
  kunden,
  kpi,
}: {
  initialTab: AdminTab;
  themeInitial: Theme | null;
  logoutAction: () => void | Promise<void>;
  overview: React.ReactNode;
  marketing: React.ReactNode;
  kunden: React.ReactNode;
  kpi: React.ReactNode;
}) {
  const [tab, setTab] = React.useState<AdminTab>(initialTab);

  // Graceful URL sync: keep the query param current so a refresh or a copied
  // link lands on the same tab, without a full server navigation.
  function onTabChange(next: string) {
    const value = (TAB_ORDER as string[]).includes(next) ? (next as AdminTab) : "overview";
    setTab(value);
    if (typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", tabToQuery(value));
    }
  }

  const bodies: Record<AdminTab, React.ReactNode> = {
    overview,
    customers: marketing,
    kunden,
    kpi,
  };

  return (
    <div className="mx-auto max-w-5xl px-5 pb-16 pt-6">
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
