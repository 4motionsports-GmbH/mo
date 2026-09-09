"use client";

// Sticky KPI toolbar: the in-page group navigation (scroll-spy), the period
// picker and the Shopify freshness control. The KPI screen stays a SERVER
// component — the toolbar only rewrites the URL (?tab=kpi&kpiRange=… /
// &kpiFresh=…) and lets the server re-render for the new window; nothing is
// fetched here (KPI-02…KPI-07, D-4).

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { ADMIN_TIME, formatAdmin } from "@/lib/admin-datetime.mjs";
import { Button, InfoTip, Input, SegmentedControl, cn } from "../ui";
import { KPI_GROUPS, kpiGroupAnchor, type KpiGroupKey } from "./groups";

type PresetKey = "7d" | "30d" | "90d" | "custom";

const PRESETS: ReadonlyArray<{ value: PresetKey; label: string }> = [
  { value: "7d", label: "7 Tage" },
  { value: "30d", label: "30 Tage" },
  { value: "90d", label: "90 Tage" },
  { value: "custom", label: "Zeitraum…" },
];

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Scroll offset: the sticky shell header + this toolbar + a little air. */
function scrollOffset(toolbar: HTMLElement | null): number {
  return (toolbar?.getBoundingClientRect().bottom ?? 96) + 12;
}

export function KpiToolbar({
  preset,
  from,
  to,
  label,
  shopifyFetchedAt,
  shopifyFromCache,
}: {
  preset: string;
  from: string;
  to: string;
  label: string;
  /** ISO time of the oldest cached Shopify-dependent result. */
  shopifyFetchedAt: string;
  shopifyFromCache: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [refreshing, setRefreshing] = React.useState(false);
  const [showCustom, setShowCustom] = React.useState(preset === "custom");
  const [customFrom, setCustomFrom] = React.useState(from);
  const [customTo, setCustomTo] = React.useState(to);
  const [active, setActive] = React.useState<KpiGroupKey>(KPI_GROUPS[0].key);
  const barRef = React.useRef<HTMLDivElement | null>(null);

  // Keep the custom inputs in sync when the server hands back a new resolved
  // range (e.g. after a preset click or a clamp).
  React.useEffect(() => {
    setCustomFrom(from);
    setCustomTo(to);
    setShowCustom(preset === "custom");
  }, [from, to, preset]);

  // The refresh spinner ends when the new render (with a newer Stand) arrives.
  React.useEffect(() => {
    setRefreshing(false);
  }, [shopifyFetchedAt]);

  const navigate = React.useCallback(
    (params: Record<string, string>) => {
      const sp = new URLSearchParams({ tab: "kpi", ...params });
      startTransition(() => router.push(`/admin?${sp.toString()}`, { scroll: false }));
    },
    [router]
  );

  const rangeParams = React.useCallback((): Record<string, string> => {
    if (preset === "custom") return { kpiRange: "custom", kpiFrom: from, kpiTo: to };
    return { kpiRange: preset };
  }, [preset, from, to]);

  // Scroll-spy: the active group is the last anchored heading above the bar.
  React.useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const limit = scrollOffset(barRef.current) + 8;
      let current: KpiGroupKey = KPI_GROUPS[0].key;
      for (const g of KPI_GROUPS) {
        const el = document.getElementById(kpiGroupAnchor(g.key));
        if (el && el.getBoundingClientRect().top <= limit) current = g.key;
      }
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom) current = KPI_GROUPS[KPI_GROUPS.length - 1].key;
      setActive((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(update);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, []);

  const jump = (key: KpiGroupKey) => {
    const el = document.getElementById(kpiGroupAnchor(key));
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - scrollOffset(barRef.current);
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    window.history.replaceState(null, "", `#${kpiGroupAnchor(key)}`);
    setActive(key);
  };

  const customValid = Boolean(customFrom && customTo && customFrom <= customTo);
  const busy = pending || refreshing;

  return (
    <div
      ref={barRef}
      className="sticky top-14 z-20 -mx-4 border-b border-border bg-background/90 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <nav aria-label="KPI-Bereiche" className="-mx-1 flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {KPI_GROUPS.map((g) => (
            <a
              key={g.key}
              href={`#${kpiGroupAnchor(g.key)}`}
              aria-current={active === g.key ? "location" : undefined}
              onClick={(e) => {
                e.preventDefault();
                jump(g.key);
              }}
              className={cn(
                "shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active === g.key
                  ? "bg-accent-soft text-accent"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground"
              )}
            >
              {g.label}
            </a>
          ))}
        </nav>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-1.5">
            <SegmentedControl
              label="Zeitraum"
              value={preset as PresetKey}
              options={PRESETS}
              disabled={busy}
              onChange={(value) => {
                if (value === "custom") {
                  setShowCustom(true);
                  return;
                }
                setShowCustom(false);
                navigate({ kpiRange: value });
              }}
            />
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {label}
            </span>
            <InfoTip label="Was der Zeitraum filtert">
              Der Zeitraum filtert alle Abschnitte bis zur Gruppe „Gesamtwerte“. Marketing-Funnel,
              Persona-Insights, Empfehlung → Kauf und Postversand sind Gesamtwerte
              (zeitraumunabhängig).
            </InfoTip>
          </div>

          <div className="flex items-center gap-1.5 border-l border-border pl-3">
            <span className="text-xs text-muted-foreground" title={shopifyFetchedAt}>
              Shopify-Daten: Stand {formatAdmin(shopifyFetchedAt, ADMIN_TIME)}
            </span>
            <Button
              variant="ghost"
              size="xs"
              loading={refreshing}
              disabled={busy}
              onClick={() => {
                setRefreshing(true);
                navigate({ ...rangeParams(), kpiFresh: String(Math.floor(Date.now() / 1000)) });
              }}
            >
              {!refreshing && <RefreshCw />}
              Aktualisieren
            </Button>
            <InfoTip label="Zwischenspeicher erklären">
              Umsatz über Mo-Rabattcodes, Kampagnen-Funnel, Marketing-Funnel und Empfehlung → Kauf
              fragen Shopify nach eingelösten Codes und Bestellungen. Diese Ergebnisse werden je
              Zeitraum zehn Minuten zwischengespeichert; „Aktualisieren“ berechnet sie sofort neu.
              {shopifyFromCache ? " Aktuell aus dem Zwischenspeicher." : " Aktuell frisch berechnet."}
            </InfoTip>
          </div>
        </div>
      </div>

      {showCustom && (
        <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-border/60 pt-2">
          <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
            Von
            <Input
              type="date"
              value={customFrom}
              max={customTo || todayYmd()}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-8 w-auto text-xs"
            />
          </label>
          <label className="flex flex-col gap-1 text-2xs text-muted-foreground">
            Bis
            <Input
              type="date"
              value={customTo}
              min={customFrom}
              max={todayYmd()}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-8 w-auto text-xs"
            />
          </label>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || !customValid}
            onClick={() => navigate({ kpiRange: "custom", kpiFrom: customFrom, kpiTo: customTo })}
          >
            Anwenden
          </Button>
        </div>
      )}
    </div>
  );
}
