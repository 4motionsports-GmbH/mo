"use client";

// Post-generation discount control: set/clear the depth on the existing draft
// (the code + expiry ship deterministically at send time; "Übernehmen" also
// regenerates the prose so it weaves the offer in).

import * as React from "react";
import { DISCOUNT_PERCENT_MAX, clampDiscountPercent } from "@/lib/discount-validation.mjs";
import { ADMIN_DATE, formatAdmin } from "@/lib/admin-datetime.mjs";
import { Button, Input } from "../../ui";

export function DiscountControl({
  percent,
  expiresAt,
  busy,
  saving,
  onApply,
}: {
  percent: number;
  expiresAt: string | null;
  busy: boolean;
  saving: boolean;
  onApply: (depth: number) => void;
}) {
  const [value, setValue] = React.useState(percent);
  React.useEffect(() => setValue(percent), [percent]);
  return (
    <div className="text-sm">
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min={0}
          max={DISCOUNT_PERCENT_MAX}
          value={value}
          onChange={(e) => setValue(clampDiscountPercent(e.target.value))}
          className="h-8 w-20 text-xs"
          aria-label="Rabatt-Tiefe in Prozent"
          disabled={busy}
        />
        <span className="text-xs text-muted-foreground">%</span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onApply(value)}
          disabled={busy || value === percent}
          loading={saving}
        >
          Übernehmen
        </Button>
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground">
        {percent > 0 ? (
          <>
            Aktuell {percent} % — der echte <code>MK-</code>Code wird beim Senden erzeugt
            {expiresAt ? ` (voraussichtlich gültig bis ${formatAdmin(expiresAt, ADMIN_DATE)})` : ""}.
            „Übernehmen“ generiert den Text automatisch neu.
          </>
        ) : (
          "Kein Rabatt. „Übernehmen“ generiert den Text automatisch neu; Code und Rabattzeile werden beim Versand angehängt."
        )}
      </div>
    </div>
  );
}
