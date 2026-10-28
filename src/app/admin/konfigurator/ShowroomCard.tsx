"use client";

// „Showroom“ (Konfigurator → „Sortiment“): which products are on display in the
// showroom — read from the live theme (the product section of the showroom
// page, showroom-core.mjs) plus a manual fallback list. Mo suggests the
// showroom only for these products, and not at all while nothing is known
// (docs/CONFIGURATOR.md §4b). „Jetzt aktualisieren“ reads the theme now (POST
// /api/admin/konfigurator/showroom/refresh — the catalog sync cron does it
// daily); the manual list is saved through POST /api/admin/konfigurator/showroom.
// Both answer with the card's fresh data; Mo's caches follow within 5 minutes.

import * as React from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Save, Store, X } from "lucide-react";
import { ADMIN_DATE_TIME_SHORT, formatAdmin } from "@/lib/admin-datetime.mjs";
import { num, plural, relativeTime } from "@/lib/admin-format.mjs";
import { SHOWROOM_LIMITS } from "@/lib/showroom-core.mjs";
import {
  Button,
  Callout,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CatalogProductPicker,
  DescriptionItem,
  DescriptionList,
  Disclosure,
  InfoTip,
  StatusBadge,
  toast,
} from "../ui";
import { adminFetch, friendlyErrorMessage } from "../lib/admin-fetch";
import { useAsyncAction } from "../lib/use-async-action";
import type { ShowroomCardData } from "./types";

const SOURCE_LABEL: Record<ShowroomCardData["source"], string> = {
  theme: "Theme",
  manual: "Eigene Liste",
  "theme+manual": "Theme + eigene Liste",
  none: "Keine",
};

const READ_THEMES_HELP =
  "Die ausgestellten Produkte stehen im Live-Theme (Seite „Showroom München-Gröbenzell“, Abschnitt mit den Produkten). Mo liest sie über die Shopify-Admin-API — dafür braucht die App die Berechtigung read_themes. Fehlt sie (z. B. nach einem App-Deploy aus einer alten Konfiguration): in der App-Konfiguration ergänzen, eine neue App-Version veröffentlichen und die Berechtigung im Shopify-Admin bestätigen. Bis dahin gilt die eigene Liste; eine zuletzt gelesene Liste bleibt erhalten.";

type Manual = ShowroomCardData["manual"];

export function ShowroomCard({ dbReady, initial }: { dbReady: boolean; initial: ShowroomCardData }) {
  const router = useRouter();
  // The routes answer with the card's fresh data — the state follows them, not
  // later server renders (an unsaved list survives a save of the settings above).
  const [data, setData] = React.useState(initial);
  const [manual, setManual] = React.useState<Manual>(initial.manual);

  const dirty = manual.map((m) => m.id).join(",") !== data.manual.map((m) => m.id).join(",");
  const themeOff = data.file === null;

  const refresh = useAsyncAction(
    () =>
      adminFetch<{ ok: boolean; result: { ok: boolean; count: number; error: string | null }; showroom: ShowroomCardData }>(
        "/api/admin/konfigurator/showroom/refresh",
        { body: {} }
      ),
    {
      errorToast: "Showroom nicht aktualisiert",
      onSuccess: (json) => {
        setData(json.showroom);
        setManual(json.showroom.manual);
        if (json.result.ok) {
          toast({
            variant: "success",
            title: "Showroom aktualisiert",
            description: `${plural(json.result.count, "Produkt", "Produkte")} aus dem Theme gelesen. Mo nutzt die Liste spätestens nach fünf Minuten.`,
          });
        } else {
          toast({
            variant: "error",
            title: "Theme nicht gelesen",
            description: json.result.error ?? "Unbekannter Fehler — die zuletzt gelesene Liste bleibt.",
          });
        }
        router.refresh();
      },
    }
  );

  const save = useAsyncAction(
    () =>
      adminFetch<{ ok: boolean; showroom: ShowroomCardData }>("/api/admin/konfigurator/showroom", {
        body: { handles: manual.map((m) => m.id) },
      }),
    {
      errorToast: "Showroom-Liste nicht gespeichert",
      onSuccess: (json) => {
        setData(json.showroom);
        setManual(json.showroom.manual);
        toast({ variant: "success", title: "Gespeichert", description: "Mo nutzt die Liste spätestens nach fünf Minuten." });
        router.refresh();
      },
    }
  );

  const busy = refresh.pending || save.pending;
  const canRefresh = dbReady && data.shopifyConfigured && !themeOff;
  const sections = data.sections.map((s) => s.heading || s.id).filter(Boolean);
  // The read_themes how-to only for a missing scope (showroomErrorMessage maps ACCESS_DENIED to it; a
  // file the theme query refuses keeps the code „(ACCESS_DENIED)“) — a renamed section, a throttle or a
  // network error says what to do in its own message.
  const scopeError = /read_themes|ACCESS_DENIED/.test(data.lastError ?? "");

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-2">
        <Store className="size-4 text-muted-foreground" aria-hidden />
        <CardTitle className="text-base">Showroom</CardTitle>
        {data.known ? (
          <StatusBadge tone="success">{plural(data.count, "Produkt", "Produkte")} ausgestellt</StatusBadge>
        ) : (
          <StatusBadge tone="warning">Unbekannt</StatusBadge>
        )}
        <InfoTip panelClassName="max-w-md">
          Welche Produkte im Showroom ausgestellt sind. Mo schlägt einen Showroom-Besuch nur vor, wenn ein empfohlenes
          Gerät oder passendes Zubehör dort steht, und nennt dann genau diese Produkte — ist nichts bekannt, schlägt Mo
          den Showroom nicht von sich aus vor. Quelle ist das Live-Theme (täglich mit dem Katalog-Abgleich gelesen) und
          zusätzlich die eigene Liste unten.
        </InfoTip>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!dbReady && (
          <Callout tone="warning" compact>
            Keine Datenbank konfiguriert — der Showroom ist unbekannt, Mo schlägt ihn nicht von sich aus vor.
          </Callout>
        )}
        {data.lastError && (
          <Callout tone="warning" compact title="Theme nicht gelesen">
            <span>
              {data.lastError}
              {data.fetchedAt && data.themeCount > 0 && (
                <> Es gilt weiter die Liste vom {formatAdmin(data.fetchedAt, ADMIN_DATE_TIME_SHORT)}.</>
              )}
              {scopeError && (
                <>
                  {" "}
                  <InfoTip label="Was tun" className="align-middle" panelClassName="max-w-md">
                    {READ_THEMES_HELP}
                  </InfoTip>
                </>
              )}
            </span>
          </Callout>
        )}
        {dbReady && !data.known && !data.lastError && (
          <Callout tone="info" compact>
            Noch keine ausgestellten Produkte bekannt — „Jetzt aktualisieren“ oder Produkte unten eintragen.
          </Callout>
        )}

        <DescriptionList columns={2}>
          <DescriptionItem label="Quelle" info="Theme: aus dem Live-Theme gelesen. Eigene Liste: hier eingetragen. Beide zusammen gelten gemeinsam.">
            {SOURCE_LABEL[data.source]}
            {data.known && (
              <span className="text-muted-foreground">
                {" "}
                · Theme {num(data.themeCount)} · Liste {num(data.manualCount)}
              </span>
            )}
          </DescriptionItem>
          <DescriptionItem
            label="Zuletzt gelesen"
            info="Der letzte erfolgreiche Abruf aus dem Theme. Schlägt ein Abruf fehl, bleibt diese Liste gültig."
          >
            {data.fetchedAt ? (
              <>
                {formatAdmin(data.fetchedAt, ADMIN_DATE_TIME_SHORT)}
                <span className="text-muted-foreground"> · {relativeTime(data.fetchedAt)}</span>
              </>
            ) : (
              "noch nie"
            )}
          </DescriptionItem>
          <DescriptionItem label="Letzter Versuch">
            {data.lastAttemptAt ? formatAdmin(data.lastAttemptAt, ADMIN_DATE_TIME_SHORT) : "noch keiner"}
          </DescriptionItem>
          <DescriptionItem
            label="Theme-Abschnitt"
            info={`Gelesen wird ${data.file ?? "keine Datei (SHOWROOM_THEME_FILE=off)"} des veröffentlichten Themes: der Produkt-Abschnitt, dessen Überschrift „Showroom“ enthält (oder der in SHOWROOM_SECTION_ID festgelegte; nach einer Umbenennung der Überschrift weiter der zuletzt gelesene Abschnitt).`}
          >
            {themeOff
              ? "ausgeschaltet"
              : sections.length
                ? sections.join(" · ")
                : "—"}
            {data.themeName && <span className="text-muted-foreground"> · Theme „{data.themeName}“</span>}
            {data.collections.length > 0 && (
              <span className="text-muted-foreground"> · Kollektion {data.collections.join(", ")}</span>
            )}
          </DescriptionItem>
        </DescriptionList>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void refresh.run()} loading={refresh.pending} disabled={!canRefresh || busy}>
            <RefreshCw /> Jetzt aktualisieren
          </Button>
          {!data.shopifyConfigured && !themeOff && (
            <span className="text-xs text-muted-foreground">Shopify ist nicht konfiguriert (SHOPIFY_*) — das Theme kann nicht gelesen werden.</span>
          )}
        </div>

        {data.unknownHandles.length > 0 && (
          <Callout tone="warning" compact>
            Nicht im Katalog gefunden: {data.unknownHandles.join(", ")} — umbenannt oder gelöscht? Mo nennt diese Produkte nicht.
          </Callout>
        )}

        {data.displayed.length > 0 && (
          <Disclosure title="Ausgestellte Produkte" meta={num(data.displayed.length)} framed={false}>
            <ul className="flex flex-col gap-1 text-sm">
              {data.displayed.map((p) => (
                <li key={p.id} className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate">{p.title ?? p.id}</span>
                  {p.theme && (
                    <StatusBadge tone="neutral" dot={false}>
                      Theme
                    </StatusBadge>
                  )}
                  {p.manual && (
                    <StatusBadge tone="accent" dot={false}>
                      Liste
                    </StatusBadge>
                  )}
                </li>
              ))}
            </ul>
          </Disclosure>
        )}

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <div className="flex items-center gap-1 text-sm font-medium">
            Eigene Liste
            <InfoTip panelClassName="max-w-md">
              Produkte, die zusätzlich als ausgestellt gelten — und allein, solange das Theme nicht gelesen werden kann
              (fehlende Berechtigung, Lesefehler). Höchstens {num(SHOWROOM_LIMITS.manualMax)} Produkte; Varianten zählen
              als ihr Produkt.
            </InfoTip>
          </div>
          <CatalogProductPicker
            showThumbnails={false}
            maxResults={6}
            selectLabel="hinzufügen"
            placeholder="Produkt suchen (tippen)…"
            ariaLabel="Produkt zur Showroom-Liste hinzufügen"
            isSelected={(hit) => manual.some((m) => m.id === hit.productId)}
            disableReason={() =>
              manual.length >= SHOWROOM_LIMITS.manualMax ? `Höchstens ${SHOWROOM_LIMITS.manualMax} Produkte` : null
            }
            onSelect={(hit) => {
              if (manual.some((m) => m.id === hit.productId)) return;
              setManual((list) => [...list, { id: hit.productId, title: hit.title }]);
            }}
            onError={(err) => toast({ variant: "error", title: "Suche fehlgeschlagen", description: friendlyErrorMessage(err) })}
          />
          {manual.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Eigene Showroom-Liste">
              {manual.map((m) => (
                <li key={m.id} className="max-w-full">
                  <span className="inline-flex h-7 max-w-full items-center gap-1 rounded-full border border-border bg-surface-2 pl-2.5 pr-1 text-xs">
                    <span className="min-w-0 max-w-[16rem] truncate">{m.title ?? m.id}</span>
                    <button
                      type="button"
                      className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                      onClick={() => setManual((list) => list.filter((x) => x.id !== m.id))}
                      disabled={busy}
                      aria-label={`${m.title ?? m.id} entfernen`}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={() => void save.run()} loading={save.pending} disabled={!dbReady || !dirty || busy}>
              <Save /> Liste speichern
            </Button>
            {dirty && <span className="text-xs text-muted-foreground">Ungespeicherte Änderungen</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
