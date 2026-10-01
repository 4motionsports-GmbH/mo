"use client";

// Kampagnen — the overview of every campaign (0066): one card per campaign
// with its phase, audience in plain German, the recipient and send figures
// and the lifecycle actions (Starten, Pausieren, Fortsetzen, Beenden,
// Archivieren). „Öffnen“ leads to the campaign's review desk
// (`?tab=kampagne&campaign=<slug>`), „Bearbeiten“ / „Neue Kampagne“ open the
// editor. Status changes that reach customers (Starten, Fortsetzen) or stop a
// campaign (Beenden) are confirmed. docs/CAMPAIGNS.md §2.

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarRange, Megaphone, Pencil, Plus } from "lucide-react";
import { ADMIN_DATE, formatAdmin } from "@/lib/admin-datetime.mjs";
import { num, ratio } from "@/lib/admin-format.mjs";
import { adminTabHref } from "@/lib/admin-tabs.mjs";
import {
  CAMPAIGN_KIND_LABELS,
  CAMPAIGN_PHASE_LABELS,
  canTransition,
  transitionLabel,
} from "@/lib/campaign-def.mjs";
import {
  Button,
  Callout,
  Card,
  CardContent,
  EmptyState,
  InfoTip,
  Menu,
  SegmentedControl,
  StatusBadge,
  buttonVariants,
  toast,
  useConfirm,
} from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import { CampaignEditor } from "./CampaignEditor";
import type { CampaignCardProps, CampaignsOverviewProps } from "./types";

type Scope = "aktuell" | "alle" | "archiv";

const PHASE_TONE: Record<string, "success" | "warning" | "neutral" | "destructive" | "info"> = {
  laeuft: "success",
  geplant: "info",
  abgelaufen: "destructive",
  pausiert: "warning",
  entwurf: "neutral",
  beendet: "neutral",
  archiviert: "neutral",
};

const NEXT_STATUSES = ["aktiv", "pausiert", "beendet", "archiviert"] as const;

function setEditParam(value: string | null) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set("edit", value);
  else url.searchParams.delete("edit");
  window.history.replaceState(window.history.state, "", url.toString());
}

export function CampaignsOverview({ campaigns, options, initialEdit, sendsApproved, notFound }: CampaignsOverviewProps) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [scope, setScope] = React.useState<Scope>("aktuell");
  const [editing, setEditing] = React.useState<number | "new" | null>(initialEdit);
  const [busy, setBusy] = React.useState<number | null>(null);

  const visible = campaigns.filter((c) =>
    scope === "archiv" ? c.status === "archiviert" : scope === "aktuell" ? c.status !== "archiviert" && c.status !== "beendet" : true
  );

  const openEditor = (id: number | "new" | null) => {
    setEditing(id);
    setEditParam(id === null ? null : String(id));
  };

  const changeStatus = async (c: CampaignCardProps, to: (typeof NEXT_STATUSES)[number]) => {
    if (to === "aktiv" || to === "beendet") {
      const ok = await confirm({
        title: to === "aktiv" ? `„${c.name}“ ${c.status === "entwurf" ? "starten" : "fortsetzen"}?` : `„${c.name}“ beenden?`,
        description:
          to === "aktiv"
            ? `Die Zielgruppe wird jetzt aus der Kundenbasis übernommen (nur Kund:innen mit Einwilligung). Es wird nichts automatisch gesendet — jede Mail geht weiterhin einzeln über den Prüftisch.${
                c.startsAt && new Date(c.startsAt) > new Date()
                  ? ` Versand ist erst ab ${formatAdmin(c.startsAt, ADMIN_DATE)} möglich.`
                  : ""
              }`
            : "Offene Entwürfe bleiben erhalten, können aber nicht mehr gesendet werden. Die Kampagne lässt sich wieder aufnehmen.",
        confirmLabel: transitionLabel(c.status, to),
        tone: to === "beendet" ? "destructive" : undefined,
      });
      if (!ok) return;
    }
    setBusy(c.id);
    try {
      const json = await adminFetch<{ refresh?: { added?: number; note?: string } | null }>("/api/admin/campaigns/status", {
        body: { id: c.id, status: to },
      });
      toast({
        variant: "success",
        title: `${c.name}: ${CAMPAIGN_PHASE_LABELS[to === "aktiv" ? "laeuft" : to] ?? to}`,
        description: json.refresh
          ? (json.refresh.note ?? `${num(json.refresh.added ?? 0)} Empfänger:innen übernommen.`)
          : undefined,
      });
      router.refresh();
    } catch (err) {
      toast({ variant: "error", title: "Statuswechsel fehlgeschlagen", description: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const editingCampaign = typeof editing === "number" ? campaigns.find((c) => c.id === editing) ?? null : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="Kampagnen anzeigen"
          value={scope}
          onChange={setScope}
          options={[
            { value: "aktuell", label: "Aktuell" },
            { value: "alle", label: "Alle" },
            { value: "archiv", label: "Archiv" },
          ]}
        />
        {!sendsApproved && (
          <span className="inline-flex items-center gap-0.5">
            <StatusBadge tone="destructive">Versand gesperrt</StatusBadge>
            <InfoTip>
              Die anwaltliche Freigabe für Kampagnen-Mails steht aus (CAMPAIGN_SENDS_APPROVED=false).
              Kampagnen anlegen, Zielgruppen prüfen, Entwürfe vorbereiten und Testkontakte funktionieren.
            </InfoTip>
          </span>
        )}
        <Button className="ml-auto" size="sm" onClick={() => openEditor("new")}>
          <Plus /> Neue Kampagne
        </Button>
      </div>

      {notFound && <Callout tone="warning">Diese Kampagne gibt es nicht (mehr) — hier sind alle Kampagnen.</Callout>}

      {visible.length === 0 ? (
        <Card>
          <CardContent className="py-10 pt-10">
            <EmptyState
              plain
              icon={<Megaphone />}
              title={scope === "archiv" ? "Keine archivierten Kampagnen" : "Keine Kampagnen"}
              description="Eine Kampagne bündelt Zielgruppe, Anlass, Angebot und Gestaltung — z. B. „Black Friday“."
              action={
                <Button size="sm" onClick={() => openEditor("new")}>
                  <Plus /> Neue Kampagne
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {visible.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              busy={busy === c.id}
              onEdit={() => openEditor(c.id)}
              onStatus={(to) => void changeStatus(c, to)}
            />
          ))}
        </div>
      )}

      <CampaignEditor
        open={editing !== null}
        campaign={editingCampaign}
        campaigns={campaigns}
        options={options}
        onClose={() => openEditor(null)}
        onSaved={(id) => {
          openEditor(null);
          router.refresh();
          if (editing === "new") {
            toast({ variant: "success", title: "Kampagne angelegt", description: "Prüfen und mit „Starten“ aktivieren." });
          } else {
            toast({ variant: "success", title: "Gespeichert" });
          }
          void id;
        }}
      />
      {confirmDialog}
    </div>
  );
}

function CampaignCard({
  campaign: c,
  busy,
  onEdit,
  onStatus,
}: {
  campaign: CampaignCardProps;
  busy: boolean;
  onEdit: () => void;
  onStatus: (to: (typeof NEXT_STATUSES)[number]) => void;
}) {
  const phaseLabel = CAMPAIGN_PHASE_LABELS[c.phase as keyof typeof CAMPAIGN_PHASE_LABELS] ?? c.phase;
  const transitions = NEXT_STATUSES.filter((to) => canTransition(c.status, to, c.kind));
  const primary = transitions.find((t) => t === "aktiv");
  const secondary = transitions.filter((t) => t !== primary);
  const clickRate = c.stats.sent > 0 ? c.stats.clicks / c.stats.sent : null;
  const href = adminTabHref("kampagne", { campaign: c.slug });

  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col gap-3 p-4 pt-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Link href={href} className="truncate text-base font-semibold hover:underline">
                {c.name}
              </Link>
              <StatusBadge tone={PHASE_TONE[c.phase] ?? "neutral"}>{phaseLabel}</StatusBadge>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {CAMPAIGN_KIND_LABELS[c.kind]}
              {c.kind !== "einzel" && <> · Zielgruppe {c.audienceMode === "dynamisch" ? "dynamisch" : "fest"}</>}
              {c.discountPercent > 0 && <> · {num(c.discountPercent)} % Rabatt</>}
            </p>
          </div>
          {c.kind !== "einzel" && (
            <Menu
              label={`Aktionen für ${c.name}`}
              size="sm"
              items={[
                { key: "edit", label: "Bearbeiten", icon: <Pencil />, onSelect: onEdit },
                ...secondary.map((to, i) => ({
                  key: to,
                  label: transitionLabel(c.status, to),
                  onSelect: () => onStatus(to),
                  separatorBefore: i === 0,
                  tone: to === "beendet" ? ("destructive" as const) : undefined,
                  disabled: busy,
                })),
              ]}
            />
          )}
        </div>

        <p className="line-clamp-3 text-sm text-muted-foreground">
          {c.kind === "einzel" ? "Einzelne Mails an ausgewählte Kund:innen — aus Kunden oder dem Eingang." : c.audienceText}
        </p>

        {(c.startsAt || c.endsAt) && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarRange className="size-3.5" aria-hidden />
            {c.startsAt ? formatAdmin(c.startsAt, ADMIN_DATE) : "sofort"} – {c.endsAt ? formatAdmin(c.endsAt, ADMIN_DATE) : "offen"}
          </p>
        )}

        <dl className="grid grid-cols-4 gap-2 rounded-md bg-surface-2 px-3 py-2 text-center">
          {[
            ["Empfänger", num(c.stats.recipients)],
            ["Entwürfe", num(c.stats.drafted)],
            ["Gesendet", num(c.stats.sent)],
            ["Klickrate", ratio(clickRate)],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="truncate text-2xs text-muted-foreground">{label}</dt>
              <dd className="text-sm font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          <Link href={href} className={buttonVariants({ size: "sm", variant: primary ? "outline" : "default" })}>
            Prüftisch öffnen{c.stats.drafted > 0 ? ` (${num(c.stats.drafted)})` : ""}
          </Link>
          {primary && (
            <Button size="sm" onClick={() => onStatus(primary)} loading={busy}>
              {transitionLabel(c.status, primary)}
            </Button>
          )}
          {c.kind !== "einzel" && !primary && (
            <Button size="sm" variant="ghost" onClick={onEdit}>
              <Pencil /> Bearbeiten
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
