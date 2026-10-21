"use client";

// The period of the Konfigurator KPIs (?kpiRange=7d|30d|90d, the KPI screen's
// parameter). A filter that changes the server render → router.push.

import { useRouter } from "next/navigation";
import { adminTabHref } from "@/lib/admin-tabs.mjs";
import { SegmentedControl } from "../ui";

type Preset = "7d" | "30d" | "90d";

const OPTIONS = [
  { value: "7d", label: "7 Tage" },
  { value: "30d", label: "30 Tage" },
  { value: "90d", label: "90 Tage" },
] as const;

export function KonfiguratorRange({ preset }: { preset: Preset }) {
  const router = useRouter();
  return (
    <SegmentedControl<Preset>
      label="Zeitraum"
      value={preset}
      options={OPTIONS}
      onChange={(next) =>
        router.push(adminTabHref("konfigurator", next === "30d" ? {} : { kpiRange: next }), { scroll: false })
      }
    />
  );
}
