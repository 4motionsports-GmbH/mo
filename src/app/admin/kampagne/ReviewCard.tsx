"use client";

// One draft under review: left the contact context (language, text mode,
// opt-in, segment, A/B group; collapsible Kaufhistorie / Empfehlungen /
// Rabatt / Set-Angebot), right the editable subject + text (autosaved) with an
// inline rendered preview, the hero panel and the actions.

import * as React from "react";
import { Check, Copy, Eye, RefreshCw, Send, SkipForward } from "lucide-react";
import { eurFromCents, num, plural } from "@/lib/admin-format.mjs";
import {
  Button,
  Callout,
  Card,
  CardContent,
  Disclosure,
  InfoTip,
  Input,
  SegmentedControl,
  Spinner,
  Textarea,
  Tooltip,
} from "../ui";
import { EmailPreviewFrame } from "../EmailPreviewFrame";
import { EmailTextModeToggle } from "../EmailTextModeToggle";
import { HeroImagePanel } from "../HeroImagePanel";
import { AbGroupBadge, LanguageToggle, LowConfidenceBadge, OptInBadge, SegmentBadge } from "./badges";
import { PurchaseHistorySection } from "./sections/PurchaseHistorySection";
import { RecommendationsEditor } from "./sections/RecommendationsEditor";
import { DiscountControl } from "./sections/DiscountControl";
import { BundleSection } from "./sections/BundleSection";
import { contactName, optInShort, type CampaignQueueItemProps } from "./types";
import type { CampaignActions } from "./useCampaignActions";

type EditorMode = "text" | "preview";

/** Debounced rendered preview of the current subject/body (inline mode). */
function useInlinePreview(active: boolean, contactId: number, subject: string, body: string) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/campaign/email-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactId, subject, body }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          throw new Error(json?.error?.message ?? `Fehler (${res.status})`);
        }
        const blob = await res.blob();
        if (controller.signal.aborted) return;
        const next = URL.createObjectURL(blob);
        setUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return next;
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Vorschau fehlgeschlagen");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 600);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [active, contactId, subject, body]);

  React.useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  return { url, loading, error };
}

export function ReviewCard({
  current,
  position,
  total,
  shopifyConfigured,
  actions,
}: {
  current: CampaignQueueItemProps;
  position: number;
  total: number;
  shopifyConfigured: boolean;
  actions: CampaignActions;
}) {
  const { busy, copiedId, optInBlocked, sendBlocked, emailViewBusy } = actions;
  const isBusy = busy !== null;
  const [mode, setMode] = React.useState<EditorMode>("text");
  const preview = useInlinePreview(mode === "preview", current.contactId, current.subject, current.body);
  const orders = current.purchaseSummary?.orders.length ?? 0;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span className="tabular-nums">
            Entwurf {num(position)} von {num(total)}
          </span>
          <span className="flex gap-2">
            <Button variant="outline" size="sm" onClick={actions.prev} disabled={position <= 1}>
              ← Zurück
            </Button>
            <Button variant="outline" size="sm" onClick={actions.next} disabled={position >= total}>
              Weiter →
            </Button>
          </span>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(280px,2fr)_3fr]">
          {/* Left: contact context */}
          <div className="flex flex-col gap-3 text-sm">
            <div>
              <div className="text-base font-semibold">{contactName(current) === current.email ? "(kein Name)" : contactName(current)}</div>
              <div className="text-muted-foreground">{current.email}</div>
              <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                {plural(current.ordersCount, "Bestellung", "Bestellungen")} · {eurFromCents(current.totalSpentCents)} Umsatz
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <LanguageToggle
                language={current.language}
                overridden={current.languageOverride !== null}
                disabled={isBusy}
                onSelect={actions.doSetLanguage}
              />
              <EmailTextModeToggle value={current.textMode} disabled={isBusy} onSelect={actions.doSetTextMode} />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <OptInBadge level={current.optInLevel} blocked={optInBlocked} />
              <SegmentBadge segment={current.segment} days={current.segmentDays} />
              <AbGroupBadge contactId={current.contactId} />
              {current.lowConfidence && <LowConfidenceBadge />}
            </div>

            <Disclosure
              title="Kaufhistorie"
              meta={orders ? plural(orders, "Bestellung", "Bestellungen") : "keine"}
              defaultOpen={current.purchaseSelectedIds !== null}
            >
              <PurchaseHistorySection
                summary={current.purchaseSummary}
                appliedSelection={current.purchaseSelectedIds}
                busy={isBusy}
                applying={busy === "selection"}
                onApply={actions.doApplyPurchaseSelection}
              />
            </Disclosure>

            <Disclosure
              title="Empfohlene Produkte"
              meta={plural(current.recommendations.length, "Produkt", "Produkte")}
              defaultOpen
              actions={
                <InfoTip>
                  Änderungen werden sofort gespeichert, ein angehängtes Set wird angepasst und der
                  Text automatisch neu generiert.
                </InfoTip>
              }
            >
              <RecommendationsEditor
                recommendations={current.recommendations}
                busy={isBusy}
                saving={busy === "recs"}
                onChange={actions.doUpdateRecommendations}
              />
            </Disclosure>

            <Disclosure
              title="Rabatt"
              meta={current.discountPercent > 0 ? `${current.discountPercent} %` : "kein Rabatt"}
              defaultOpen={current.discountPercent > 0}
            >
              <DiscountControl
                percent={current.discountPercent}
                expiresAt={current.discountExpiresAt}
                busy={isBusy}
                saving={busy === "discount"}
                onApply={actions.doSetDiscount}
              />
            </Disclosure>

            <Disclosure
              title="Set-Angebot"
              meta={current.bundle ? current.bundle.title : "kein Set"}
              defaultOpen={current.bundle !== null}
            >
              <BundleSection
                bundle={current.bundle}
                recommendations={current.recommendations}
                shopifyConfigured={shopifyConfigured}
                busy={isBusy}
                creating={busy === "bundle"}
                onCreate={actions.doCreateBundle}
                onArchive={actions.doArchiveBundle}
              />
            </Disclosure>
          </div>

          {/* Right: editable draft + actions */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SegmentedControl
                label="Ansicht"
                value={mode}
                onChange={setMode}
                options={[
                  { value: "text", label: "Text" },
                  { value: "preview", label: "Vorschau" },
                ]}
              />
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                Automatisch ergänzt beim Versand
                <InfoTip>
                  Produktbilder-Raster, Mo-Hinweis (Deep-Link), Rabattzeile und Abmelde-/Impressum-
                  Footer werden beim Versand automatisch angehängt und sind hier nicht editierbar.
                  Änderungen an Betreff und Text werden automatisch gespeichert.
                </InfoTip>
              </span>
            </div>

            {mode === "text" ? (
              <>
                <Input
                  value={current.subject}
                  onChange={(e) => actions.editCurrent({ subject: e.target.value })}
                  aria-label="Betreff"
                  className="font-medium"
                />
                <Textarea
                  value={current.body}
                  onChange={(e) => actions.editCurrent({ body: e.target.value })}
                  rows={16}
                  aria-label="E-Mail-Text"
                  className="text-sm leading-relaxed"
                />
              </>
            ) : (
              <div className="flex h-[560px] flex-col rounded-lg border border-border bg-surface-2 p-2">
                {preview.error ? (
                  <Callout tone="destructive" compact>
                    {preview.error}
                  </Callout>
                ) : preview.url ? (
                  <div className="relative flex min-h-0 flex-1 flex-col">
                    {preview.loading && (
                      <span className="absolute right-2 top-2 z-10">
                        <Spinner size="sm" label="Vorschau wird aktualisiert" />
                      </span>
                    )}
                    <EmailPreviewFrame title={`Vorschau — ${current.email}`} src={preview.url} />
                  </div>
                ) : (
                  <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                    <Spinner size="sm" className="mr-2" /> Vorschau wird gerendert…
                  </div>
                )}
              </div>
            )}

            <HeroImagePanel key={`hero-${current.contactId}`} kind="campaign" targetId={current.contactId} disabled={isBusy} />

            {optInBlocked && (
              <Callout tone="warning" compact title="Erneute Einwilligung erforderlich">
                Für diesen Kontakt liegt kein nachweisbares Double-Opt-in vor ({optInShort(current.optInLevel)}).
                Senden ist blockiert; Kopieren ist möglich.
              </Callout>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <Tooltip
                  content={
                    !sendBlocked
                      ? ""
                      : optInBlocked
                        ? "Kein nachweisbares Double-Opt-in — Senden blockiert."
                        : "Versand gesperrt (CAMPAIGN_SENDS_APPROVED=false)."
                  }
                  disabled={!sendBlocked}
                >
                  <span className="inline-flex">
                    <Button onClick={actions.doSend} loading={busy === "send"} disabled={sendBlocked || isBusy}>
                      <Send /> Senden
                    </Button>
                  </span>
                </Tooltip>
                <Button variant="outline" onClick={actions.doPreview} loading={emailViewBusy}>
                  <Eye /> Vorschau
                </Button>
                <Button variant="outline" onClick={actions.doCopy} disabled={isBusy}>
                  <Copy /> Kopieren
                </Button>
                {copiedId === current.contactId && (
                  <Button variant="outline" onClick={actions.doMarkDone} loading={busy === "markdone"} disabled={isBusy}>
                    <Check /> Als erledigt markieren
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => actions.doRegenerate(current.discountPercent)}
                  loading={busy === "regen"}
                  disabled={isBusy}
                >
                  <RefreshCw /> Neu generieren
                </Button>
              </div>
              <Button variant="outline" onClick={actions.doSkip} loading={busy === "skip"} disabled={isBusy}>
                <SkipForward /> Überspringen
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
