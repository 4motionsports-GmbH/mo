"use client";

// App shell for /admin: grouped sidebar navigation (full at ≥ xl, icon rail at
// lg, drawer below), a slim top bar (screen title + InfoTip, help, theme,
// logout) and the content area. ONLY the active screen is rendered by the
// server (page.tsx) — switching screens is a real (soft) navigation via
// next/link, so each screen loads exactly its own data. The shell shows a
// pending indicator on the link being navigated to.
//
// Keyboard: bare digits 1…9/0 jump to the n-th screen, `/` focuses the Kunden
// search — both ignored while typing in a field or with a modifier held.

import * as React from "react";
import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, LogOut, Menu } from "lucide-react";
import {
  ADMIN_TABS,
  ADMIN_TAB_GROUPS,
  adminTabForShortcut,
  adminTabHref,
  adminTabMeta,
} from "@/lib/admin-tabs.mjs";
import { num } from "@/lib/admin-format.mjs";
import { cn } from "./ui/cn";
import { InfoTip, Tooltip } from "./ui/info-tip";
import { Kbd } from "./ui/kbd";
import { Sheet } from "./ui/sheet";
import { Toaster } from "./ui/toast";
import { Button } from "./ui/button";
import { IconButton } from "./ui/icon-button";
import { ThemeToggle } from "./ThemeToggle";
import { TAB_ICONS, type AdminTab } from "./tabs";
import { useMediaQuery } from "./lib/use-media-query";
import type { Theme } from "./theme-config";

export type { AdminTab } from "./tabs";

/** Optional count shown next to a screen in the navigation (queue sizes). */
export type AdminBadges = Partial<Record<AdminTab, number>>;

const SEARCH_INPUT_ID = "ms-search";

function focusSearchWhenMounted(attempts = 40) {
  const el = document.getElementById(SEARCH_INPUT_ID) as HTMLInputElement | null;
  if (el) {
    el.focus();
    return;
  }
  if (attempts > 0) requestAnimationFrame(() => focusSearchWhenMounted(attempts - 1));
}

// ─── Navigation item ─────────────────────────────────────────────────────────

function PendingSpinner() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-hidden />;
}

function NavItem({
  tab,
  active,
  badge,
  showLabel,
  onNavigate,
}: {
  tab: AdminTab;
  active: boolean;
  badge?: number;
  showLabel: boolean;
  onNavigate?: () => void;
}) {
  const meta = adminTabMeta(tab);
  const Icon = TAB_ICONS[tab];
  const count = badge && badge > 0 ? (badge > 99 ? "99+" : num(badge)) : null;
  const link = (
    <Link
      href={adminTabHref(tab)}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "group relative flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-accent-soft text-foreground"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        !showLabel && "justify-center px-0"
      )}
    >
      {active && (
        <span
          className="absolute -left-2 top-1.5 h-6 w-0.5 rounded-full bg-accent"
          aria-hidden
        />
      )}
      <Icon className={cn("size-4 shrink-0", active ? "text-accent" : "")} aria-hidden />
      {showLabel && <span className="flex-1 truncate">{meta.label}</span>}
      {showLabel && <PendingSpinner />}
      {count && showLabel && (
        <span
          className={cn(
            "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-2xs font-semibold tabular-nums",
            active ? "bg-accent text-accent-foreground" : "bg-surface-2 text-muted-foreground"
          )}
        >
          {count}
        </span>
      )}
      {count && !showLabel && (
        <span
          className="absolute right-1.5 top-1.5 size-2 rounded-full bg-accent ring-2 ring-sidebar"
          aria-label={`${count} offen`}
        />
      )}
    </Link>
  );
  if (showLabel) return link;
  return (
    <Tooltip
      content={
        <span className="inline-flex items-center gap-2">
          {meta.label}
          {count && <span className="opacity-80">· {count}</span>}
          <Kbd className="border-background/30 bg-background/10 text-background">{meta.shortcut}</Kbd>
        </span>
      }
      side="bottom"
      className="flex w-full"
    >
      {link}
    </Tooltip>
  );
}

function NavGroups({
  tab,
  badges,
  showLabels,
  onNavigate,
}: {
  tab: AdminTab;
  badges: AdminBadges;
  showLabels: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Bereiche" className="flex flex-col gap-4 px-2">
      {ADMIN_TAB_GROUPS.map((group) => (
        <div key={group} className="flex flex-col gap-0.5">
          {showLabels ? (
            <div className="px-2.5 pb-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground/80">
              {group}
            </div>
          ) : (
            <div className="mx-2.5 mb-1 border-t border-border first:hidden" aria-hidden />
          )}
          {ADMIN_TABS.filter((t) => t.group === group).map((t) => (
            <NavItem
              key={t.key}
              tab={t.key}
              active={t.key === tab}
              badge={badges[t.key]}
              showLabel={showLabels}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}

function Brand({ compact }: { compact: boolean }) {
  return (
    <Link
      href="/admin"
      className={cn(
        "flex h-14 items-center gap-2.5 border-b border-border px-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        compact && "justify-center px-0"
      )}
      aria-label="motion sports Admin — Übersicht"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
        M
      </span>
      {!compact && (
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-bold tracking-tight">motion sports</span>
          <span className="block text-2xs text-muted-foreground">Admin · Mo</span>
        </span>
      )}
    </Link>
  );
}

// ─── Shell ───────────────────────────────────────────────────────────────────

export function AdminShell({
  tab,
  themeInitial,
  logoutAction,
  badges = {},
  children,
}: {
  tab: AdminTab;
  themeInitial: Theme | null;
  logoutAction: () => void | Promise<void>;
  badges?: AdminBadges;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const meta = adminTabMeta(tab);
  const labelsVisible = useMediaQuery("(min-width: 1280px)", true);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  // Close the drawer once the navigation landed on the new screen.
  React.useEffect(() => {
    setDrawerOpen(false);
  }, [tab]);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) {
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        const next = adminTabForShortcut(e.key);
        if (next) {
          e.preventDefault();
          router.push(adminTabHref(next));
        }
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        if (tab !== "kunden") router.push(adminTabHref("kunden"));
        focusSearchWhenMounted();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router, tab]);

  return (
    <div className="flex min-h-screen">
      {/* Sidebar: full at ≥ xl, icon rail at lg, hidden below (drawer). The
          outer column stretches with the page so its background never ends
          mid-page; the inner part sticks to the viewport. */}
      <aside
        className={cn(
          "hidden shrink-0 border-r border-border bg-sidebar text-sidebar-foreground lg:block",
          labelsVisible ? "w-60" : "w-16"
        )}
      >
        <div className="sticky top-0 flex h-screen flex-col">
          <Brand compact={!labelsVisible} />
          <div className="flex-1 overflow-y-auto py-4">
            <NavGroups tab={tab} badges={badges} showLabels={labelsVisible} />
          </div>
        </div>
      </aside>

      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen} side="left" size="sm" title="Bereiche">
        <NavGroups tab={tab} badges={badges} showLabels onNavigate={() => setDrawerOpen(false)} />
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur sm:px-6">
          <IconButton
            label="Navigation öffnen"
            variant="outline"
            size="icon-sm"
            className="lg:hidden"
            onClick={() => setDrawerOpen(true)}
            tooltip={false}
          >
            <Menu />
          </IconButton>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h1 className="truncate text-lg font-semibold tracking-tight">{meta.label}</h1>
            <InfoTip label={`Was ist „${meta.label}“?`}>{meta.description}</InfoTip>
          </div>
          <div className="flex items-center gap-2">
            <InfoTip label="Tastenkürzel" size="md" panelClassName="max-w-sm">
              <div className="flex flex-col gap-1.5">
                <div className="font-semibold">Tastenkürzel</div>
                <div className="flex items-center gap-2">
                  <Kbd>1</Kbd>
                  <span>…</span>
                  <Kbd>9</Kbd>
                  <Kbd>0</Kbd>
                  <span>Bereich wechseln (Reihenfolge wie links)</span>
                </div>
                <div className="flex items-center gap-2">
                  <Kbd>/</Kbd>
                  <span>Kundensuche</span>
                </div>
                <div className="flex items-center gap-2">
                  <Kbd>Esc</Kbd>
                  <span>Dialog oder Hinweis schließen</span>
                </div>
                <div className="text-muted-foreground">
                  Weitere Kürzel stehen im jeweiligen Bereich (z.&nbsp;B. Kampagne).
                </div>
              </div>
            </InfoTip>
            <ThemeToggle initial={themeInitial} />
            <form action={logoutAction}>
              <Button type="submit" variant="outline" size="sm" className="h-9">
                <LogOut aria-hidden />
                <span className="hidden sm:inline">Abmelden</span>
              </Button>
            </form>
          </div>
        </header>

        <main
          className={cn(
            "mx-auto w-full flex-1 px-4 pb-16 pt-6 sm:px-6",
            meta.wide ? "max-w-7xl" : "max-w-5xl"
          )}
        >
          {children}
        </main>
      </div>

      <Toaster />
    </div>
  );
}
