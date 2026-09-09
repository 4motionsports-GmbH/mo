// Sprachen (DE/EN) — chats by conversations.locale, captures by capture locale.

import type { LocaleCount, LocaleSplit } from "@/lib/kpi-store";
import { ratio } from "@/lib/admin-format.mjs";
import { BarList } from "../BarList";
import { ChartCard, Explain, KpiSection } from "../KpiSection";

const LOCALE_LABELS: Record<string, string> = {
  de: "Deutsch",
  en: "Englisch",
  unknown: "Unbekannt (vor Erfassung)",
};

const INFO = (
  <Explain>
    <p>Beratungen nach gewählter Chat-Sprache und E-Mail-Angaben nach Capture-Sprache.</p>
    <p>
      Die Chat-Sprache wird seit Migration 0041 pro Beratung gespeichert (letzter Turn zählt); ältere
      Beratungen erscheinen als „Unbekannt“. Capture-Sprache seit Migration 0030.
    </p>
  </Explain>
);

export function LocaleSection({ locales }: { locales: LocaleSplit | null }) {
  const empty = !locales
    ? "Noch keine Daten."
    : locales.chats.length === 0 && locales.captures.length === 0
      ? "Noch keine Daten im Zeitraum."
      : null;
  return (
    <KpiSection id="sprachen" title="Sprachen (DE/EN)" info={INFO} empty={empty}>
      {locales && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ChartCard title="Chats nach Sprache">
            <LocaleBars counts={locales.chats} />
          </ChartCard>
          <ChartCard title="E-Mail-Angaben nach Sprache">
            <LocaleBars counts={locales.captures} />
          </ChartCard>
        </div>
      )}
    </KpiSection>
  );
}

function LocaleBars({ counts }: { counts: LocaleCount[] }) {
  const total = counts.reduce((a, c) => a + c.count, 0);
  return (
    <BarList
      rows={counts.map((c) => ({
        key: c.locale,
        label: LOCALE_LABELS[c.locale] ?? c.locale,
        count: c.count,
        hint: total > 0 ? ratio(c.count / total) : undefined,
      }))}
    />
  );
}
