"use client";

// Date-range picker for the KPI tab. A small client island: the KPI tab itself
// stays a SERVER component that owns all aggregation, so the picker doesn't fetch
// anything — it just rewrites the URL (?tab=kpi&kpiRange=…) and lets the server
// re-render the tab for the new window. Presets (7/30/90 days) one-click; a
// custom from/to is applied explicitly. The resolved, validated range comes back
// from the server (lib/kpi-range) and is reflected here as the active selection.
//
// We navigate to a freshly-built /admin?tab=kpi&… URL (no useSearchParams) so the
// component needs no Suspense boundary and the KPI tab stays selected after the
// soft navigation.

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardContent } from "./ui/card";

const PRESETS: Array<{ key: "7d" | "30d" | "90d"; label: string }> = [
  { key: "7d", label: "7 Tage" },
  { key: "30d", label: "30 Tage" },
  { key: "90d", label: "90 Tage" },
];

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export function KpiDateRangePicker({
  preset,
  from,
  to,
  label,
}: {
  preset: string;
  from: string;
  to: string;
  label: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [showCustom, setShowCustom] = React.useState(preset === "custom");
  const [customFrom, setCustomFrom] = React.useState(from);
  const [customTo, setCustomTo] = React.useState(to);

  // Keep the custom inputs in sync when the server hands back a new resolved
  // range (e.g. after a preset click or a clamp).
  React.useEffect(() => {
    setCustomFrom(from);
    setCustomTo(to);
    setShowCustom(preset === "custom");
  }, [from, to, preset]);

  const navigate = React.useCallback(
    (params: Record<string, string>) => {
      const sp = new URLSearchParams({ tab: "kpi", ...params });
      startTransition(() => router.push(`/admin?${sp.toString()}`, { scroll: false }));
    },
    [router]
  );

  const customValid = Boolean(customFrom && customTo && customFrom <= customTo);

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Zeitraum:</span>
          {PRESETS.map((p) => (
            <Button
              key={p.key}
              size="sm"
              variant={preset === p.key ? "default" : "outline"}
              disabled={pending}
              onClick={() => {
                setShowCustom(false);
                navigate({ kpiRange: p.key });
              }}
            >
              {p.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant={preset === "custom" ? "default" : "outline"}
            disabled={pending}
            onClick={() => setShowCustom((s) => !s)}
            aria-expanded={showCustom}
          >
            Benutzerdefiniert
          </Button>
          <span className="ml-1 text-xs text-muted-foreground" aria-live="polite">
            {label}
          </span>
        </div>

        {showCustom && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border/60 pt-2">
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              Von
              <Input
                type="date"
                value={customFrom}
                max={customTo || todayYmd()}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-8 w-auto"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              Bis
              <Input
                type="date"
                value={customTo}
                min={customFrom}
                max={todayYmd()}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-8 w-auto"
              />
            </label>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || !customValid}
              onClick={() =>
                navigate({ kpiRange: "custom", kpiFrom: customFrom, kpiTo: customTo })
              }
            >
              Anwenden
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
