"use client";

// The mail column of the desk: the identity line (what the prose is checked
// against), the subject as an always-editable input, the RENDERED e-mail as
// the default view (exactly as it ships; the next card is prefetched), the
// in-place editor (`E`, side by side with the live render on wide screens),
// the in-flight overlay („Text wird angepasst…“) and the sticky action bar.

import * as React from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  History,
  Keyboard,
  Maximize2,
  PenLine,
  RefreshCw,
  Send,
  SkipForward,
} from "lucide-react";
import { ADMIN_DATE, formatAdmin } from "@/lib/admin-datetime.mjs";
import { eurFromCents, num, plural } from "@/lib/admin-format.mjs";
import { Button, Callout, Input, Kbd, Menu, Spinner, StatusBadge, Textarea, Tooltip, cn } from "../ui";
import { useMediaQuery } from "../lib/use-media-query";
import { OptInBadge, SegmentBadge } from "./badges";
import { contactName, type CampaignQueueItemProps, type CardBusy } from "./types";
import { useRenderedPreview } from "./useRenderedPreview";
import type { CampaignActions, ReviewCheck, ReviewVerdict } from "./useCampaignActions";

/** Base viewport of the render — the 600 px mail on its background. */
const RENDER_WIDTH = 640;
/** Inner padding of the measured container (p-2 on both sides). */
const PAD = 16;

const BUSY_LABEL: Record<CardBusy, string> = {
  send: "Wird gesendet…",
  skip: "Wird übersprungen…",
  regen: "Text wird angepasst…",
  markdone: "Wird markiert…",
  bundle: "Set wird gespeichert…",
  recs: "Empfehlungen werden gespeichert…",
  selection: "Empfehlungen werden neu erzeugt…",
  discount: "Rabatt wird gespeichert…",
  language: "Sprache wird gespeichert…",
  hero: "Hero-Bild wird erzeugt…",
};

/** The render in an iframe that fills the column: rendered at 640 px, scaled
 * down to fit narrower columns (never sideways scrolling), stretched to the
 * column on wide ones so the mail sits centred on its background. */
function RenderedMail({ url, title }: { url: string; title: string }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [box, setBox] = React.useState({ w: 0, h: 0 });
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth - PAD, h: el.clientHeight - PAD });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = box.w > 0 ? Math.min(1, box.w / RENDER_WIDTH) : 1;
  const viewportWidth = Math.max(RENDER_WIDTH, box.w);
  const clipWidth = Math.round(viewportWidth * scale);
  const clipHeight = Math.max(160, box.h);
  return (
    <div ref={containerRef} className="h-full min-h-0 w-full p-2">
      {box.w > 0 && (
        <div
          className="mx-auto overflow-hidden rounded-md border border-border bg-white"
          style={{ width: clipWidth, height: clipHeight }}
        >
          <iframe
            title={title}
            src={url}
            sandbox=""
            className="block border-0 bg-white"
            style={{
              width: viewportWidth,
              height: clipHeight / scale,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          />
        </div>
      )}
    </div>
  );
}

function IdentityLine({ item, optInBlocked }: { item: CampaignQueueItemProps; optInBlocked: boolean }) {
  const name = contactName(item);
  const lastOrder = item.purchaseSummary?.orders[0] ?? null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className="text-sm font-semibold">{name === item.email ? "(kein Name)" : name}</span>
      <span className="truncate text-muted-foreground">{item.email}</span>
      <StatusBadge tone={item.language === "en" ? "info" : "neutral"} dot={false}>
        {item.language.toUpperCase()}
        {item.languageOverride && (
          <PenLine className="size-3" aria-label="Sprache manuell festgelegt" />
        )}
      </StatusBadge>
      <SegmentBadge segment={item.segment} days={item.segmentDays} />
      <OptInBadge level={item.optInLevel} blocked={optInBlocked} />
      <span className="text-muted-foreground tabular-nums">
        {plural(item.ordersCount, "Bestellung", "Bestellungen")} · {eurFromCents(item.totalSpentCents)}
      </span>
      {lastOrder && lastOrder.items[0]?.title && (
        <span className="hidden min-w-0 truncate text-muted-foreground xl:inline">
          Letzter Kauf: {lastOrder.items[0].title}
          {lastOrder.createdAt ? ` · ${formatAdmin(lastOrder.createdAt, ADMIN_DATE)}` : ""}
        </span>
      )}
    </div>
  );
}

/** The one-line verdict strip of the Fokus-Modus. */
export function ChecksStrip({ checks, verdict }: { checks: ReviewCheck[]; verdict: ReviewVerdict }) {
  const visible = checks.filter((c) => c.level !== "info");
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <StatusBadge tone={verdict === "ready" ? "success" : verdict === "hints" ? "warning" : "destructive"}>
        {verdict === "ready" ? "Bereit" : verdict === "hints" ? "Hinweise" : "Blockiert"}
      </StatusBadge>
      {visible.length === 0 ? (
        <span className="text-muted-foreground">Keine Hinweise.</span>
      ) : (
        <span className="truncate text-muted-foreground">{visible.map((c) => c.title).join(" · ")}</span>
      )}
    </div>
  );
}

export function MailPane({
  item,
  position,
  total,
  actions,
  focusMode,
  subjectRef,
  onShortcuts,
  onHistory,
}: {
  item: CampaignQueueItemProps;
  position: number;
  total: number;
  actions: CampaignActions;
  focusMode: boolean;
  subjectRef: React.RefObject<HTMLInputElement | null>;
  onShortcuts: () => void;
  onHistory: () => void;
}) {
  const { editMode, currentBusy, sendBlocked, optInBlocked, copiedId, emailViewBusy, currentChecks, currentVerdict } =
    actions;
  const busy = currentBusy;
  const wide = useMediaQuery("(min-width: 1600px)", false);
  const showPreview = !editMode || wide;
  const preview = useRenderedPreview(item, showPreview);
  const bodyRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (editMode) bodyRef.current?.focus();
  }, [editMode, item.contactId]);

  const blockedReason = sendBlocked
    ? (currentChecks.find((c) => c.level === "blocked")?.title ?? "Blockiert")
    : busy
      ? BUSY_LABEL[busy]
      : "";

  return (
    <div className="flex min-h-0 flex-col rounded-lg border border-border bg-card lg:h-full">
      <div className="flex flex-col gap-2 border-b border-border px-3 pt-2.5 pb-2">
        <IdentityLine item={item} optInBlocked={optInBlocked} />
        {focusMode && <ChecksStrip checks={currentChecks} verdict={currentVerdict} />}
        <Input
          ref={subjectRef}
          value={item.subject}
          onChange={(e) => actions.editItem(item.contactId, { subject: e.target.value })}
          aria-label="Betreff"
          className="h-8 font-medium"
          placeholder="Betreff"
        />
        {item.sendError && (
          <Callout tone="destructive" compact title="Versand abgelehnt">
            {item.sendError}
          </Callout>
        )}
      </div>

      <div
        className={cn(
          "relative min-h-[360px] flex-1 lg:min-h-0",
          editMode && wide ? "grid grid-cols-2 divide-x divide-border" : "flex flex-col"
        )}
      >
        {editMode && (
          <div className="flex min-h-0 flex-1 flex-col p-2">
            <Textarea
              ref={bodyRef}
              value={item.body}
              onChange={(e) => actions.editItem(item.contactId, { body: e.target.value })}
              aria-label="E-Mail-Text"
              className="min-h-[320px] flex-1 resize-none text-sm leading-relaxed lg:min-h-0"
            />
          </div>
        )}
        {showPreview && (
          <div className="relative flex min-h-0 flex-1 flex-col bg-surface-2">
            {preview.error ? (
              <div className="p-3">
                <Callout
                  tone="destructive"
                  compact
                  action={
                    <Button variant="outline" size="xs" onClick={preview.retry}>
                      Erneut rendern
                    </Button>
                  }
                >
                  {preview.error}
                </Callout>
              </div>
            ) : preview.url ? (
              <>
                {preview.loading && (
                  <span className="absolute right-3 top-3 z-10">
                    <Spinner size="sm" label="Vorschau wird aktualisiert" />
                  </span>
                )}
                <RenderedMail url={preview.url} title={`Vorschau — ${item.email}`} />
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                <Spinner size="sm" className="mr-2" /> Vorschau wird gerendert…
              </div>
            )}
          </div>
        )}
        {busy && busy !== "send" && (
          <div
            className="absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-[1px]"
            role="status"
          >
            <span className="inline-flex items-center gap-2 rounded-md border border-border bg-popover px-3 py-1.5 text-xs font-medium shadow-md">
              <Spinner size="xs" /> {BUSY_LABEL[busy]}
            </span>
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={actions.prev} disabled={position <= 1} aria-label="Zurück (P)">
            <ChevronLeft /> <Kbd>P</Kbd>
          </Button>
          <span className="px-1 text-xs text-muted-foreground tabular-nums">
            {num(position)} / {num(total)}
          </span>
          <Button variant="outline" size="sm" onClick={actions.next} disabled={position >= total} aria-label="Weiter (N)">
            <Kbd>N</Kbd> <ChevronRight />
          </Button>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void actions.skip(item.contactId)} disabled={busy !== null}>
            <SkipForward /> Überspringen <Kbd>X</Kbd>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => actions.regenerate(item.contactId)}
            disabled={busy !== null && busy !== "regen"}
            loading={busy === "regen"}
          >
            <RefreshCw /> Neu generieren <Kbd>R</Kbd>
          </Button>
          <Button
            variant={editMode ? "secondary" : "outline"}
            size="sm"
            aria-pressed={editMode}
            onClick={() => actions.setEditMode(!editMode)}
          >
            <PenLine /> {editMode ? "Fertig" : "Bearbeiten"} <Kbd>{editMode ? "Esc" : "E"}</Kbd>
          </Button>
          {copiedId === item.contactId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void actions.markDone(item.contactId)}
              loading={busy === "markdone"}
              disabled={busy !== null}
            >
              <Check /> Als erledigt markieren
            </Button>
          )}
          <Menu
            label="Weitere Aktionen zum Entwurf"
            size="sm"
            items={[
              {
                key: "preview",
                label: "Vorschau (Desktop/Mobil)",
                icon: <Eye />,
                shortcut: "V",
                onSelect: () => actions.previewItem(item.contactId),
                disabled: emailViewBusy,
              },
              {
                key: "copy",
                label: "Kopieren",
                icon: <Copy />,
                shortcut: "C",
                onSelect: () => void actions.copy(item.contactId),
              },
              {
                key: "history",
                label: "Verlauf dieser Adresse",
                icon: <History />,
                onSelect: onHistory,
              },
              {
                key: "focus",
                label: focusMode ? "Fokus-Modus beenden" : "Fokus-Modus",
                icon: <Maximize2 />,
                shortcut: "F",
                onSelect: () => actions.setFocusMode(!focusMode),
                separatorBefore: true,
              },
              {
                key: "shortcuts",
                label: "Tastenkürzel",
                icon: <Keyboard />,
                shortcut: "?",
                onSelect: onShortcuts,
              },
            ]}
          />
          <Tooltip content={blockedReason} disabled={!sendBlocked && !busy}>
            <span className="inline-flex">
              <Button size="sm" onClick={() => actions.send(item.contactId)} disabled={sendBlocked || busy !== null}>
                <Send /> Senden{" "}
                <Kbd className="border-primary-foreground/30 bg-primary-foreground/15 text-primary-foreground">S</Kbd>
              </Button>
            </span>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
