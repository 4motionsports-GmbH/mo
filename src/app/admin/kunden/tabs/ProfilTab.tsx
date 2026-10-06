"use client";

// Profil — the „Aktuelles Kundenverständnis“ card at the top of Überblick: the
// structured fields as visual elements (persona, depth and freshness in the
// header; goals with the focus, level and budget meters, interests, owned
// products, next steps) and the readable text split into its labelled parts
// (lib/customer-profile-view.mjs). Kept current by the nightly upkeep; the
// button regenerates it now (costs tokens, so the last run's usage is
// disclosed). The Art. 21 objection to profiling is recorded and lifted here.

import * as React from "react";
import {
  CalendarClock,
  Check,
  Clock,
  FileText,
  Gauge,
  Heart,
  History,
  Layers,
  ListChecks,
  Lock,
  Mail,
  MessageCircleQuestion,
  PackageCheck,
  ShieldX,
  ShoppingBag,
  Sparkles,
  Target,
  UserRound,
  Wallet,
  ArrowRight,
} from "lucide-react";
import type { CustomerDetail } from "@/lib/customer-detail";
import type { CustomerProfileData } from "@/lib/customer-store";
import { ARCHETYPE_META } from "@/lib/persona";
import type { PersonaArchetype } from "@/lib/types";
import { ADMIN_DATE, formatAdmin } from "@/lib/admin-datetime.mjs";
import { num, relativeTime } from "@/lib/admin-format.mjs";
import { hasProfileSignal, normalizeProfileData } from "@/lib/customer-profile-core.mjs";
import {
  lastProfileActivityAt,
  nextStepKind,
  groupProfileSections,
  parseProfileSections,
  profileFreshness,
  PROFILE_SECTION_DEFS,
  type NextStepKind,
} from "@/lib/customer-profile-view.mjs";
import { Button, Callout, InfoTip, Markdown, StatusBadge, Tooltip, cn, toast, useConfirm } from "../../ui";
import { adminFetch } from "../../lib/admin-fetch";
import { useAsyncAction } from "../../lib/use-async-action";
import { useCustomerActions } from "../CustomerDetail";

interface ProfileUsage {
  inputTokens: number;
  outputTokens: number;
  approxCostUsd: number;
}

const PROFILE_INFO =
  "Das zentrale Kundenprofil aus allen Gesprächen, Käufen, der Korrespondenz und den Kampagnen-Mails. " +
  "Vollprofil: mit Gesprächen oder Korrespondenz. Kaufprofil: nur aus Käufen. Es wird nächtlich für " +
  "Personen mit neuen Daten aktualisiert und fließt in den Chat, alle E-Mails und die Produktempfehlungen " +
  "ein. Jede Generierung ist ein KI-Durchlauf und kostet Tokens.";

export function ProfilTab({ customer }: { customer: CustomerDetail }) {
  const { refresh } = useCustomerActions();
  const { confirm, confirmDialog } = useConfirm();
  // The stored profile comes from the detail (re-loaded by refresh()); a run in
  // this session is shown at once — also when it could not be stored — until an
  // objection deletes the profile.
  const [generated, setGenerated] = React.useState<{
    summary: string;
    data: CustomerProfileData | null;
    updatedAt: string;
  } | null>(null);
  const [lastUsage, setLastUsage] = React.useState<ProfileUsage | null>(null);
  const profile = generated?.summary ?? customer.profileSummary;
  const data = generated ? (generated.data ?? customer.profileData) : customer.profileData;
  const updatedAt = generated?.updatedAt ?? customer.profileSummaryUpdatedAt;

  const generate = useAsyncAction(
    () =>
      adminFetch<{
        profileSummary?: string;
        profileData?: CustomerProfileData;
        usage?: ProfileUsage;
        warning?: string;
      }>("/api/admin/customers/profile", { body: { customerId: customer.id } }),
    {
      errorToast: "Kundenverständnis fehlgeschlagen",
      onSuccess: (json) => {
        if (json.profileSummary) {
          setGenerated({
            summary: json.profileSummary,
            data: json.profileData ?? null,
            updatedAt: new Date().toISOString(),
          });
        }
        if (json.usage) setLastUsage(json.usage);
        if (json.warning) {
          toast({ variant: "warning", title: "Hinweis", description: json.warning });
        } else {
          toast({ variant: "success", title: "Kundenverständnis generiert", description: customer.email });
        }
        refresh();
      },
    }
  );

  const objection = useAsyncAction(
    (objected: boolean) =>
      adminFetch("/api/admin/customers/objection", { body: { customerId: customer.id, kind: "profile", objected } }),
    {
      errorToast: "Widerspruch nicht gespeichert",
      onSuccess: () => {
        setGenerated(null); // an objection deletes the stored profile
        toast({ variant: "success", title: "Gespeichert" });
        refresh();
      },
    }
  );

  async function toggleObjection() {
    const objected = !customer.profileObjectionAt;
    const ok = await confirm({
      title: objected ? "Widerspruch gegen Profilbildung eintragen?" : "Widerspruch aufheben?",
      description: objected
        ? "Das KI-Profil wird gelöscht und nicht mehr erstellt oder verwendet (Art. 21 DSGVO). Mails werden dann ohne Profil formuliert."
        : "Nur aufheben, wenn die Person ihren Widerspruch zurückgenommen hat.",
      confirmLabel: objected ? "Widerspruch eintragen" : "Aufheben",
      tone: objected ? "destructive" : "default",
    });
    if (ok) void objection.run(objected);
  }

  const objectionButton = (
    <Button
      variant="ghost"
      size="xs"
      onClick={() => void toggleObjection()}
      loading={objection.pending}
      className="text-muted-foreground"
    >
      Widerspruch gegen Profilbildung eintragen
    </Button>
  );

  // Art. 21 objection: no profile, only the state and „Aufheben“.
  if (customer.profileObjectionAt) {
    return (
      <ProfileFrame
        icon={<ShieldX />}
        iconTone="muted"
        meta={
          <span className="text-xs text-muted-foreground">
            Widerspruch gegen Profilbildung seit {formatAdmin(customer.profileObjectionAt, ADMIN_DATE)} — kein KI-Profil.
          </span>
        }
        action={
          <Button variant="outline" size="sm" onClick={() => void toggleObjection()} loading={objection.pending}>
            Aufheben
          </Button>
        }
      >
        {confirmDialog}
      </ProfileFrame>
    );
  }

  const generateButton = customer.profileAllowed ? (
    <Button
      size="sm"
      variant={profile ? "outline" : "default"}
      onClick={() => void generate.run()}
      loading={generate.pending}
    >
      <Sparkles /> {profile ? "Neu generieren" : "Kundenverständnis generieren"}
    </Button>
  ) : (
    <NotAllowedNote />
  );

  const usageLine = lastUsage && (
    <span className="text-2xs text-muted-foreground">
      Letzter Lauf: {num(lastUsage.inputTokens)} Input- / {num(lastUsage.outputTokens)} Output-Tokens (~$
      {lastUsage.approxCostUsd.toFixed(3)}).
    </span>
  );

  // No profile yet (or none allowed).
  if (!profile) {
    return (
      <ProfileFrame
        icon={<Sparkles />}
        iconTone="muted"
        meta={
          customer.profileAllowed ? (
            <span className="text-xs text-muted-foreground">
              Noch kein Profil — wird in der nächsten Nacht automatisch erstellt, sobald Gespräche, Käufe oder
              Korrespondenz vorliegen, oder jetzt per Klick.
            </span>
          ) : (
            <NotAllowedNote />
          )
        }
        action={customer.profileAllowed ? generateButton : undefined}
        footer={
          <>
            {usageLine}
            <span className="ml-auto">{objectionButton}</span>
          </>
        }
      >
        {confirmDialog}
      </ProfileFrame>
    );
  }

  return (
    <ProfileCard
      customer={customer}
      profile={profile}
      data={data}
      updatedAt={updatedAt}
      action={generateButton}
      footer={
        <>
          {usageLine}
          <span className="ml-auto">{objectionButton}</span>
        </>
      }
    >
      {confirmDialog}
    </ProfileCard>
  );
}

/** CUSTOMER_AI_PROFILE_SCOPE excludes this person (no consent). */
function NotAllowedNote() {
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <Lock className="size-3.5" aria-hidden />
      Kein KI-Profil ohne Einwilligung
      <InfoTip>
        CUSTOMER_AI_PROFILE_SCOPE=consented: Profile entstehen nur für Personen mit Einwilligung in
        E-Mail-Werbung. Mit „all“ entstehen sie für alle (vom Anwalt abgedeckt).
      </InfoTip>
    </span>
  );
}

// ─── Frame ──────────────────────────────────────────────────────────────────

/** The card shell every state shares: icon + title + InfoTip, a meta line, an
 *  action, an optional body and footer. It is a size container: the detail
 *  pane is much narrower than the viewport, so the two-column grid of theme
 *  cards follows the card's own width (`@2xl:`), not the screen's. */
function ProfileFrame({
  icon,
  iconTone = "accent",
  meta,
  action,
  body,
  footer,
  children,
}: {
  icon: React.ReactNode;
  iconTone?: "accent" | "muted";
  meta: React.ReactNode;
  action?: React.ReactNode;
  body?: React.ReactNode;
  footer?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const titleId = React.useId();
  return (
    <section aria-labelledby={titleId} className="@container overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-start gap-3 px-4 py-3.5">
        <span
          aria-hidden
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4",
            iconTone === "accent" ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted-foreground"
          )}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          {/* The action wraps under the title when the pane is narrow; the title never breaks. */}
          <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <h3 id={titleId} className="flex items-center gap-1.5 whitespace-nowrap text-sm font-semibold text-foreground">
              Aktuelles Kundenverständnis
              <InfoTip panelClassName="max-w-sm">{PROFILE_INFO}</InfoTip>
            </h3>
            {action && <div className="ml-auto flex items-center">{action}</div>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">{meta}</div>
        </div>
      </div>
      {body && <div className="flex flex-col gap-4 border-t border-border bg-surface-2 p-4">{body}</div>}
      {footer && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-1.5">{footer}</div>
      )}
      {children}
    </section>
  );
}

// ─── The profile ────────────────────────────────────────────────────────────

const LEVEL_SCALE: Array<[string, string]> = [
  ["einsteiger", "Einsteiger"],
  ["fortgeschritten", "Fortgeschritten"],
  ["profi", "Profi"],
];
const BUDGET_SCALE: Array<[string, string]> = [
  ["niedrig", "Niedrig"],
  ["mittel", "Mittel"],
  ["hoch", "Hoch"],
];

function ProfileCard({
  customer,
  profile,
  data: rawData,
  updatedAt,
  action,
  footer,
  children,
}: {
  customer: CustomerDetail;
  profile: string;
  data: CustomerProfileData | null;
  updatedAt: string | null;
  action: React.ReactNode;
  footer: React.ReactNode;
  children?: React.ReactNode;
}) {
  const data = React.useMemo(() => normalizeProfileData(rawData), [rawData]);
  const hasFacts = rawData != null && hasProfileSignal(rawData);
  const parsed = React.useMemo(() => parseProfileSections(profile), [profile]);
  const persona = data.persona !== "unknown" ? data.persona : (customer.personaLabel ?? "unknown");
  const lastActivityAt = React.useMemo(() => lastProfileActivityAt(customer.timeline), [customer.timeline]);

  const knownLevel = LEVEL_SCALE.some(([v]) => v === data.level);
  const knownBudget = BUDGET_SCALE.some(([v]) => v === data.budget);
  const { bodies, others } = React.useMemo(() => groupProfileSections(parsed.sections), [parsed]);

  // One card per theme: the structured fields as visual elements on top, the
  // matching part of the text below. A theme with neither is left out.
  const themes: Theme[] = [
    {
      key: "needs",
      icon: <Target />,
      info: data.goals.length > 1 ? "Das zuerst genannte Ziel ist der aktuelle Schwerpunkt." : undefined,
      visual: data.goals.length > 0 ? <GoalList goals={data.goals} /> : null,
      body: bodies.needs,
    },
    {
      key: "level",
      icon: <Gauge />,
      visual: knownLevel ? <ScaleMeter label="Trainingsniveau" value={data.level} scale={LEVEL_SCALE} /> : null,
      body: bodies.level,
    },
    {
      key: "preferences",
      icon: <Wallet />,
      visual:
        knownBudget || data.interests.length > 0 ? (
          <div className="flex flex-col gap-3">
            {knownBudget && <ScaleMeter label="Budget-Signal" value={data.budget} scale={BUDGET_SCALE} />}
            {data.interests.length > 0 && (
              <div>
                <div className="mb-1.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <Heart className="size-3" aria-hidden />
                  Interessiert an
                </div>
                <ChipList items={data.interests} tone="accent" />
              </div>
            )}
          </div>
        ) : null,
      body: bodies.preferences,
    },
    {
      key: "owned",
      icon: <PackageCheck />,
      visual: data.owned.length > 0 ? <ChipList items={data.owned} tone="neutral" icon={<Check />} /> : null,
      body: bodies.owned,
    },
    ...others.map(
      (o, i): Theme => ({ key: `other-${i}`, title: o.label, icon: <FileText />, visual: null, body: o.body })
    ),
  ].filter((t) => t.visual || t.body);
  const next: Theme | null =
    data.nextSteps.length > 0 || bodies.next
      ? {
          key: "next",
          icon: <ListChecks />,
          visual: data.nextSteps.length > 0 ? <StepList steps={data.nextSteps} /> : null,
          body: bodies.next,
        }
      : null;

  return (
    <ProfileFrame
      icon={<Sparkles />}
      meta={
        <>
          <PersonaPill persona={persona} />
          <DepthBadge depth={customer.profileDepth} />
          <Freshness updatedAt={updatedAt} lastActivityAt={lastActivityAt} />
        </>
      }
      action={action}
      footer={footer}
      body={
        <>
          {customer.profileDepth === "kauf" && (
            <Callout tone="neutral" compact icon={<ShoppingBag className="size-3.5" />}>
              <span className="font-semibold">Nur aus Käufen abgeleitet.</span> Ein Vollprofil entsteht nach dem
              ersten Gespräch mit Mo oder einer E-Mail.
            </Callout>
          )}
          {!hasFacts && (
            <Callout tone="neutral" compact>
              <span className="font-semibold">Älteres Profil ohne strukturierte Angaben.</span>{" "}
              {customer.profileAllowed
                ? "„Neu generieren“ ergänzt Ziele, Interessen und nächste Schritte."
                : "Ziele, Interessen und nächste Schritte fehlen."}
            </Callout>
          )}

          <div className="grid gap-3 @2xl:grid-cols-2">
            {parsed.intro && (
              <ThemeCard wide theme={{ key: "intro", title: "Zusammenfassung", icon: <FileText />, visual: null, body: parsed.intro }} />
            )}
            {themes.map((t, i) => (
              // An odd last half-width card spans the row so the grid has no hole.
              <ThemeCard key={t.key} theme={t} wide={themes.length % 2 === 1 && i === themes.length - 1} />
            ))}
            {next && <ThemeCard wide theme={next} />}
          </div>
        </>
      }
    >
      {children}
    </ProfileFrame>
  );
}

interface Theme {
  key: string;
  /** Defaults to the section label (customer-profile-view.mjs). */
  title?: string;
  icon: React.ReactNode;
  info?: string;
  visual: React.ReactNode | null;
  body: string | null;
}

const THEME_TITLE: Record<string, string> = Object.fromEntries(PROFILE_SECTION_DEFS.map((d) => [d.key, d.label]));

function ThemeCard({ theme, wide = false }: { theme: Theme; wide?: boolean }) {
  const title = theme.title ?? THEME_TITLE[theme.key] ?? theme.key;
  return (
    <article className={cn("flex min-w-0 flex-col rounded-lg border border-border bg-card p-3.5", wide && "@2xl:col-span-2")}>
      <header className="mb-3 flex items-center gap-2">
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent-soft text-accent [&_svg]:size-3.5"
        >
          {theme.icon}
        </span>
        <h4 className="text-xs font-semibold text-foreground">{title}</h4>
        {theme.info && <InfoTip>{theme.info}</InfoTip>}
      </header>
      {theme.visual}
      {theme.body && (
        <div className={cn(theme.visual != null && "mt-3 border-t border-border pt-3")}>
          <Markdown content={theme.body} tone={theme.visual != null ? "muted" : "default"} />
        </div>
      )}
    </article>
  );
}

// ─── Header pieces ──────────────────────────────────────────────────────────

function PersonaPill({ persona }: { persona: string }) {
  const meta = ARCHETYPE_META[persona as PersonaArchetype] ?? ARCHETYPE_META.unknown;
  if (meta.id === "unknown") {
    return (
      <Tooltip content="Aus den Daten lässt sich noch keine Persona ableiten.">
        <StatusBadge tone="neutral" dot={false} size="md" icon={<UserRound />} tabIndex={0} className="cursor-help">
          Persona noch unbestimmt
        </StatusBadge>
      </Tooltip>
    );
  }
  return (
    <Tooltip content="Persona laut Kundenprofil">
      <span
        tabIndex={0}
        className="inline-flex h-7 cursor-help items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-2.5 text-sm font-semibold text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <UserRound className="size-3.5" aria-hidden />
        {meta.label}
      </span>
    </Tooltip>
  );
}

const DEPTH_INFO: Record<"voll" | "kauf", string> = {
  voll: "Vollprofil: aus Gesprächen mit Mo oder Korrespondenz, dazu Käufe und Kampagnen.",
  kauf: "Kaufprofil: nur aus Käufen und Kampagnen-Reaktionen — ohne Gespräch oder Korrespondenz.",
};

function DepthBadge({ depth }: { depth: "voll" | "kauf" | null }) {
  if (!depth) return null;
  return (
    <Tooltip content={DEPTH_INFO[depth]}>
      <StatusBadge tone="neutral" dot={false} size="md" icon={<Layers />} tabIndex={0} className="cursor-help">
        {depth === "voll" ? "Vollprofil" : "Kaufprofil"}
      </StatusBadge>
    </Tooltip>
  );
}

function Freshness({ updatedAt, lastActivityAt }: { updatedAt: string | null; lastActivityAt: string | null }) {
  const f = profileFreshness({ updatedAt, lastActivityAt });
  if (f.state === "unknown") {
    return <span className="text-xs text-muted-foreground">Stand unbekannt</span>;
  }
  return (
    <>
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="size-3" aria-hidden />
        Stand {formatAdmin(updatedAt, ADMIN_DATE)} · {relativeTime(updatedAt)}
      </span>
      {f.state === "behind" && (
        <Tooltip
          content={`Seit diesem Stand gab es neue Aktivität (Gespräch, Mail, Kampagne oder Bestellung), zuletzt am ${formatAdmin(lastActivityAt, ADMIN_DATE)}. „Neu generieren“ bringt das Profil auf den neuesten Stand.`}
        >
          <StatusBadge tone="warning" icon={<History />} size="md" tabIndex={0} className="cursor-help">
            Neue Aktivität seitdem
          </StatusBadge>
        </Tooltip>
      )}
      {f.state === "old" && (
        <Tooltip content="Seit mehr als drei Monaten nicht neu erstellt.">
          <StatusBadge tone="warning" icon={<History />} size="md" tabIndex={0} className="cursor-help">
            Älter als 3 Monate
          </StatusBadge>
        </Tooltip>
      )}
    </>
  );
}

// ─── Key facts ──────────────────────────────────────────────────────────────

function GoalList({ goals }: { goals: string[] }) {
  const [focus, ...rest] = goals;
  return (
    <ul className="flex flex-col gap-1.5">
      <li className="flex items-start gap-2.5 rounded-md border border-accent/30 bg-accent-soft px-2.5 py-2">
        <Target className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0">
          <div className="text-2xs font-semibold uppercase tracking-wide text-accent">Schwerpunkt</div>
          <div className="text-sm font-medium text-foreground">{focus}</div>
        </div>
      </li>
      {rest.map((g, i) => (
        <li key={`${i}-${g}`} className="flex items-start gap-2.5 px-2.5 text-sm text-foreground">
          <span aria-hidden className="flex h-5 shrink-0 items-center">
            <span className="size-1.5 rounded-full bg-muted-foreground/60" />
          </span>
          <span className="min-w-0">{g}</span>
        </li>
      ))}
    </ul>
  );
}

function ScaleMeter({ label, value, scale }: { label: string; value: string; scale: Array<[string, string]> }) {
  const step = scale.findIndex(([v]) => v === value) + 1;
  const valueLabel = scale[step - 1]?.[1] ?? value;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-sm font-semibold text-foreground">{valueLabel}</span>
      </div>
      <div
        role="img"
        aria-label={`${label}: ${valueLabel} (Stufe ${step} von ${scale.length})`}
        className="mt-1.5 grid grid-cols-3 gap-1"
      >
        {scale.map(([v], i) => (
          <span key={v} className={cn("h-1.5 rounded-full", i < step ? "bg-accent" : "bg-border")} />
        ))}
      </div>
    </div>
  );
}

function ChipList({ items, tone, icon }: { items: string[]; tone: "accent" | "neutral"; icon?: React.ReactNode }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((item, i) => (
        <li
          key={`${i}-${item}`}
          className={cn(
            "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
            tone === "accent"
              ? "border-accent/25 bg-accent-soft text-foreground"
              : "border-border bg-surface-2 text-foreground"
          )}
        >
          {icon && (
            <span aria-hidden className="shrink-0 text-muted-foreground [&_svg]:size-3">
              {icon}
            </span>
          )}
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

const STEP_META: Record<NextStepKind, { Icon: React.ComponentType<{ className?: string }>; label: string | null }> = {
  offer: { Icon: ShoppingBag, label: "Angebot" },
  contact: { Icon: Mail, label: "Kontakt" },
  clarify: { Icon: MessageCircleQuestion, label: "Klären" },
  timing: { Icon: CalendarClock, label: "Zeitpunkt" },
  step: { Icon: ArrowRight, label: null },
};

function StepList({ steps }: { steps: string[] }) {
  return (
    <ol className="flex flex-col divide-y divide-border">
      {steps.map((s, i) => {
        const meta = STEP_META[nextStepKind(s)];
        return (
          <li key={`${i}-${s}`} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
            <span
              aria-hidden
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
            >
              <meta.Icon className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1 pt-1 text-sm text-foreground">{s}</span>
            {meta.label && (
              <span className="shrink-0 pt-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                {meta.label}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
