"use client";

// Master–detail workspace for the conversation inspector ("Gespräche").
//
// LEFT: a paginated, newest-first list of ALL conversations (every tier), each
// row carrying the derived tier + outcome signals + a "analysiert" marker. The
// list is server-rendered (this island only receives the page) and the filters /
// pagination live in the URL (g*) — changing one re-renders the server tab for
// the new window. ZERO tokens: nothing here calls a model on render.
//
// RIGHT: the selected conversation's readable transcript (Kunde/Berater turns,
// timestamps, markdown rendered like the chat) + outcomes + the on-demand,
// CACHED AI analysis ("Analysieren" — Haiku, cached on the row, free on re-open).
//
// TOP: the GespraecheInsights panel (distribution + bulk action + rollup).

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Mail,
  ShoppingCart,
  CheckCircle2,
  Wrench,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  Button,
  Card,
  CardContent,
  Select,
  Input,
  Badge,
  Markdown,
  Skeleton,
  Checkbox,
  toast,
} from "./ui";
import { ARCHETYPE_META } from "@/lib/persona";
import {
  TIER_LABELS,
  CATEGORY_LABELS,
  QUALITY_LABELS,
  QUALITY_IS_NEGATIVE,
} from "@/lib/conversation-analysis-core.mjs";
import type { PersonaArchetype } from "@/lib/types";
import type {
  AdminConversationListItem,
  AdminConversationDetail,
  ConversationStats,
  InsightsRollup,
  AdminTier,
} from "@/lib/admin-conversations";
import { GespraecheInsights } from "./GespraecheInsights";

interface FilterProps {
  preset: string;
  from: string;
  to: string;
  label: string;
  tier: AdminTier | null;
  hasError: boolean;
  page: number;
}

const TOOL_LABELS: Record<string, string> = {
  update_customer_profile: "Profil",
  search_products: "Suche",
  show_product: "Produkt",
  compare_products: "Vergleich",
  add_to_cart: "Warenkorb",
  suggest_showroom: "Showroom",
  show_contact_form: "Kontakt",
  offer_email_summary: "E-Mail",
};

function fmtDateTime(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}
function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}
function eur(n: number): string {
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 4 });
}
function personaLabel(label: string | null): string | null {
  if (!label) return null;
  const meta = ARCHETYPE_META[label as PersonaArchetype];
  return meta ? meta.shortLabel : label;
}
const TIER_VARIANT: Record<AdminTier, "secondary" | "info" | "success"> = {
  anonymous: "secondary",
  "email-only": "info",
  "signed-in": "success",
};

function TierBadge({ tier }: { tier: AdminTier }) {
  return (
    <Badge variant={TIER_VARIANT[tier]}>
      {(TIER_LABELS as Record<string, string>)[tier] ?? tier}
    </Badge>
  );
}

function reportError(e: unknown) {
  toast({
    variant: "error",
    title: "Fehler",
    description: e instanceof Error ? e.message : "Unbekannter Fehler",
  });
}

async function call(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = json as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? `Fehler (${res.status})`);
  }
  return json;
}

export function GespraecheWorkspace({
  items,
  total,
  pageSize,
  stats,
  unanalyzed,
  bulkEstimateEur,
  insights,
  filter,
}: {
  items: AdminConversationListItem[];
  total: number;
  pageSize: number;
  stats: ConversationStats;
  unanalyzed: number;
  bulkEstimateEur: number;
  insights: InsightsRollup | null;
  filter: FilterProps;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [selectedId, setSelectedId] = React.useState<number | null>(null);

  // URL navigation: build the next g* state and let the server re-render.
  const go = React.useCallback(
    (next: Partial<FilterProps>) => {
      const s = { ...filter, ...next };
      const sp = new URLSearchParams({ tab: "gespraeche", grange: s.preset });
      if (s.preset === "custom") {
        sp.set("gfrom", s.from);
        sp.set("gto", s.to);
      }
      if (s.tier) sp.set("gtier", s.tier);
      if (s.hasError) sp.set("gerr", "1");
      if (s.page > 1) sp.set("gpage", String(s.page));
      startTransition(() => router.push(`/admin?${sp.toString()}`, { scroll: false }));
    },
    [filter, router]
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      <ConversationFilters filter={filter} pending={pending} go={go} />

      <GespraecheInsights
        from={filter.from}
        to={filter.to}
        stats={stats}
        unanalyzed={unanalyzed}
        bulkEstimateEur={bulkEstimateEur}
        initialInsights={insights}
      />

      <div className="grid gap-4 lg:grid-cols-[24rem_1fr]">
        <div>
          <div className="mb-2 flex items-center justify-between text-[12px] text-muted-foreground">
            <span>
              {total === 0
                ? "Keine Gespräche"
                : `${total} Gespräch(e) · Seite ${filter.page}/${totalPages}`}
            </span>
            <span className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={pending || filter.page <= 1}
                onClick={() => go({ page: filter.page - 1 })}
                aria-label="Vorherige Seite"
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pending || filter.page >= totalPages}
                onClick={() => go({ page: filter.page + 1 })}
                aria-label="Nächste Seite"
              >
                <ChevronRight />
              </Button>
            </span>
          </div>

          <ul
            className={`max-h-[70vh] space-y-1.5 overflow-y-auto rounded-xl border border-border bg-card/40 p-1.5 ${
              pending ? "opacity-60 transition-opacity" : ""
            }`}
          >
            {items.length === 0 && (
              <li className="px-2 py-6 text-center text-sm text-muted-foreground">
                Keine Gespräche für diesen Zeitraum/Filter.
              </li>
            )}
            {items.map((it) => (
              <ConversationRow
                key={it.id}
                item={it}
                selected={it.id === selectedId}
                onSelect={() => setSelectedId(it.id)}
              />
            ))}
          </ul>
        </div>

        <ConversationDetail key={selectedId ?? "none"} conversationId={selectedId} />
      </div>
    </div>
  );
}

// ── Filters toolbar ───────────────────────────────────────────────────────────

const PRESETS: Array<{ key: string; label: string }> = [
  { key: "7d", label: "7 Tage" },
  { key: "30d", label: "30 Tage" },
  { key: "90d", label: "90 Tage" },
];

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function ConversationFilters({
  filter,
  pending,
  go,
}: {
  filter: FilterProps;
  pending: boolean;
  go: (next: Partial<FilterProps>) => void;
}) {
  const [showCustom, setShowCustom] = React.useState(filter.preset === "custom");
  const [cFrom, setCFrom] = React.useState(filter.from);
  const [cTo, setCTo] = React.useState(filter.to);
  React.useEffect(() => {
    setCFrom(filter.from);
    setCTo(filter.to);
    setShowCustom(filter.preset === "custom");
  }, [filter.from, filter.to, filter.preset]);
  const customValid = Boolean(cFrom && cTo && cFrom <= cTo);

  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Zeitraum:</span>
          {PRESETS.map((p) => (
            <Button
              key={p.key}
              size="sm"
              variant={filter.preset === p.key ? "default" : "outline"}
              disabled={pending}
              onClick={() => {
                setShowCustom(false);
                go({ preset: p.key, page: 1 });
              }}
            >
              {p.label}
            </Button>
          ))}
          <Button
            size="sm"
            variant={filter.preset === "custom" ? "default" : "outline"}
            disabled={pending}
            onClick={() => setShowCustom((s) => !s)}
            aria-expanded={showCustom}
          >
            Benutzerdefiniert
          </Button>

          <span className="ml-2 text-xs font-medium text-muted-foreground">Tier:</span>
          <Select
            value={filter.tier ?? ""}
            disabled={pending}
            className="h-8 w-auto"
            onChange={(e) =>
              go({ tier: (e.target.value || null) as AdminTier | null, page: 1 })
            }
          >
            <option value="">Alle</option>
            <option value="anonymous">Anonym</option>
            <option value="email-only">E-Mail</option>
            <option value="signed-in">Angemeldet</option>
          </Select>

          <label className="ml-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox
              checked={filter.hasError}
              disabled={pending}
              onChange={(e) => go({ hasError: e.target.checked, page: 1 })}
            />
            nur ohne Bot-Antwort
          </label>

          <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
            {filter.label}
          </span>
        </div>

        {showCustom && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border/60 pt-2">
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              Von
              <Input
                type="date"
                value={cFrom}
                max={cTo || todayYmd()}
                onChange={(e) => setCFrom(e.target.value)}
                className="h-8 w-auto"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
              Bis
              <Input
                type="date"
                value={cTo}
                min={cFrom}
                max={todayYmd()}
                onChange={(e) => setCTo(e.target.value)}
                className="h-8 w-auto"
              />
            </label>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || !customValid}
              onClick={() => go({ preset: "custom", from: cFrom, to: cTo, page: 1 })}
            >
              Anwenden
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── List row ──────────────────────────────────────────────────────────────────

function OutcomeChips({
  item,
  size = "sm",
}: {
  item: Pick<
    AdminConversationListItem,
    "checkoutOffered" | "cartUsed" | "emailCaptured" | "toolsFired" | "noReply"
  >;
  size?: "sm" | "md";
}) {
  const cls = size === "sm" ? "text-[10px]" : "text-[11px]";
  return (
    <span className="flex flex-wrap items-center gap-1">
      {item.noReply && (
        <Badge variant="destructive" className={cls} title="Kunde schrieb, aber Mo antwortete nicht">
          <AlertTriangle className="size-3" /> keine Antwort
        </Badge>
      )}
      {item.cartUsed && (
        <Badge variant="success" className={cls} title="Warenkorb-/Checkout-Link geklickt">
          <ShoppingCart className="size-3" /> Cart genutzt
        </Badge>
      )}
      {!item.cartUsed && item.checkoutOffered && (
        <Badge variant="outline" className={cls} title="Warenkorb-Button angeboten (add_to_cart)">
          <ShoppingCart className="size-3" /> Cart angeboten
        </Badge>
      )}
      {item.emailCaptured && (
        <Badge variant="info" className={cls} title="E-Mail erfasst">
          <Mail className="size-3" /> E-Mail
        </Badge>
      )}
      {item.toolsFired.length > 0 && (
        <Badge
          variant="secondary"
          className={cls}
          title={item.toolsFired.map((t) => TOOL_LABELS[t] ?? t).join(", ")}
        >
          <Wrench className="size-3" /> {item.toolsFired.length} Tool(s)
        </Badge>
      )}
    </span>
  );
}

function CategoryBadge({ category, quality }: { category: string | null; quality: string | null }) {
  const catLabel = category
    ? (CATEGORY_LABELS as Record<string, string>)[category] ?? category
    : null;
  const negative = quality ? (QUALITY_IS_NEGATIVE as Record<string, boolean>)[quality] : false;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {catLabel && (
        <Badge variant="accent" className="text-[10px]">
          {catLabel}
        </Badge>
      )}
      {quality && (
        <Badge variant={negative ? "warning" : "secondary"} className="text-[10px]">
          {(QUALITY_LABELS as Record<string, string>)[quality] ?? quality}
        </Badge>
      )}
    </span>
  );
}

function ConversationRow({
  item,
  selected,
  onSelect,
}: {
  item: AdminConversationListItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const persona = personaLabel(item.personaLabel);
  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        className={`cursor-pointer rounded-lg border px-3 py-2 transition-colors ${
          selected
            ? "border-accent bg-accent/10"
            : "border-transparent hover:border-border hover:bg-secondary/60"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-medium text-foreground">
            {fmtDateTime(item.createdAt)}
          </span>
          <TierBadge tier={item.tier} />
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span>{item.messageCount} Nachricht(en)</span>
          {persona && <span className="truncate">{persona}</span>}
        </div>
        <div className="mt-1.5">
          <OutcomeChips item={item} />
        </div>
        {item.analysis ? (
          <div className="mt-1.5">
            <CategoryBadge
              category={item.analysis.category}
              quality={item.analysis.quality}
            />
          </div>
        ) : (
          <div className="mt-1.5 text-[10px] italic text-muted-foreground">nicht analysiert</div>
        )}
      </div>
    </li>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────

interface AnalysisUsage {
  inputTokens: number;
  outputTokens: number;
  approxCostUsd: number;
}

function ConversationDetail({ conversationId }: { conversationId: number | null }) {
  const router = useRouter();
  const [detail, setDetail] = React.useState<AdminConversationDetail | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [lastUsage, setLastUsage] = React.useState<AnalysisUsage | null>(null);

  React.useEffect(() => {
    if (conversationId == null) {
      setDetail(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    setLastUsage(null);
    fetch("/api/admin/conversations/detail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId }),
    })
      .then(async (res) => {
        const j = (await res.json().catch(() => ({}))) as {
          detail?: AdminConversationDetail;
          error?: { message?: string };
        };
        if (!active) return;
        if (!res.ok || !j.detail) {
          setError(j.error?.message ?? "Gespräch konnte nicht geladen werden.");
          setDetail(null);
        } else {
          setDetail(j.detail);
        }
      })
      .catch(() => {
        if (active) setError("Netzwerkfehler — bitte erneut versuchen.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [conversationId]);

  async function analyze(force: boolean) {
    if (!detail) return;
    setAnalyzing(true);
    try {
      const json = (await call("/api/admin/conversations/analyze", {
        conversationId: detail.id,
        force,
      })) as {
        analysis?: AdminConversationDetail["analysis"];
        usage?: AnalysisUsage | null;
        warning?: string;
      };
      if (json.analysis) setDetail({ ...detail, analysis: json.analysis });
      if (json.usage) setLastUsage(json.usage);
      if (json.warning) {
        toast({ variant: "warning", title: "Hinweis", description: json.warning });
      } else {
        toast({ variant: "success", title: "Gespräch analysiert" });
      }
      router.refresh();
    } catch (e) {
      reportError(e);
    } finally {
      setAnalyzing(false);
    }
  }

  if (conversationId == null) {
    return (
      <Card className="flex min-h-[16rem] items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Wähle links ein Gespräch, um Transkript und Analyse zu sehen.
        </p>
      </Card>
    );
  }

  // Show the skeleton while loading AND on the very first render after a
  // selection — this component is remounted per conversation (key={selectedId}),
  // so its first paint happens BEFORE the fetch effect flips `loading` on. Without
  // the `!detail && !error` guard that first frame fell through to the error
  // branch below and flashed "Nicht gefunden." for a tick before the request even
  // started. After the fetch resolves exactly one of `detail`/`error` is set, so
  // this only ever covers the genuine pending window.
  if (loading || (!detail && !error)) {
    return (
      <Card>
        <CardContent className="space-y-2 p-4" aria-hidden>
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !detail) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-destructive">{error ?? "Nicht gefunden."}</p>
        </CardContent>
      </Card>
    );
  }

  const a = detail.analysis;

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <TierBadge tier={detail.tier} />
            {personaLabel(detail.personaLabel) && (
              <Badge variant="outline">{personaLabel(detail.personaLabel)}</Badge>
            )}
            <span className="text-[12px] text-muted-foreground">
              {fmtDateTime(detail.createdAt)} · {detail.messageCount} Nachricht(en) ·{" "}
              {detail.status}
            </span>
          </div>
        </div>

        <OutcomeChips item={detail.outcomes} size="md" />

        {/* Analysis (generate-once-and-cache) */}
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-[13px] text-foreground">KI-Analyse</strong>
            <Button size="sm" disabled={analyzing} onClick={() => analyze(a != null)}>
              <Sparkles />
              {analyzing ? "Analysiere…" : a ? "Neu analysieren" : "Analysieren"}
            </Button>
          </div>
          {a ? (
            <div className="mt-2 space-y-2">
              <CategoryBadge category={a.category} quality={a.quality} />
              <p className="text-[13px] text-foreground">{a.summary}</p>
              {a.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {a.tags.map((t) => (
                    <Badge key={t} variant="secondary" className="text-[10px]">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                Stand: {fmtDateTime(a.updatedAt)}
                {a.model ? ` · ${a.model}` : ""}
                {a.costEur > 0 ? ` · ~${eur(a.costEur)}` : ""}
                {lastUsage
                  ? ` · letzter Lauf: ${lastUsage.inputTokens.toLocaleString("de-DE")} / ${lastUsage.outputTokens.toLocaleString("de-DE")} Tokens`
                  : ""}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-[12px] text-muted-foreground">
              <em>Noch nicht analysiert.</em> Ein Klick startet einen günstigen KI-Durchlauf
              (Haiku) und speichert das Ergebnis — erneutes Öffnen kostet nichts.
            </p>
          )}
        </div>

        {/* Transcript */}
        <div>
          <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
            <CheckCircle2 className="size-3.5 text-muted-foreground" />
            Transkript
          </div>
          {detail.transcript.length === 0 ? (
            <p className="text-sm text-muted-foreground">Kein lesbares Transkript.</p>
          ) : (
            <ol className="space-y-2.5">
              {detail.transcript.map((t, i) => (
                <li key={i} className="text-[13px]">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <strong className={t.role === "user" ? "text-foreground" : "text-accent"}>
                      {t.role === "user" ? "Kunde" : "Berater"}
                    </strong>
                    <span>{fmtTime(t.createdAt)}</span>
                  </div>
                  {t.role === "assistant" ? (
                    <Markdown content={t.content} className="mt-0.5" />
                  ) : (
                    <p className="mt-0.5 whitespace-pre-wrap text-foreground">{t.content}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
