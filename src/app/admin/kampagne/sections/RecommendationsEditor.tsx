"use client";

// Editable recommendation list: remove per item, add via the SHARED catalog
// picker (incl. the variant chooser: a pinned variant is stored as a
// "handle~variantId" ref). Every change persists immediately (the
// recommendations route also rebuilds an attached bundle and regenerates the
// prose).

import * as React from "react";
import { ExternalLink, X } from "lucide-react";
import { CatalogProductPicker, IconButton, Spinner, toast } from "../../ui";
import type { CampaignRecommendation } from "../types";

export function RecommendationsEditor({
  recommendations,
  busy,
  saving,
  onChange,
}: {
  recommendations: CampaignRecommendation[];
  busy: boolean;
  saving: boolean;
  onChange: (productIds: string[]) => void;
}) {
  const ids = recommendations.map((r) => r.id);

  return (
    <div className="text-sm">
      {saving && (
        <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Spinner size="xs" /> speichert…
        </div>
      )}
      {recommendations.length > 0 ? (
        <ul className="space-y-1 text-xs">
          {recommendations.map((r) => (
            <li key={r.id} className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1">
              {r.url ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-w-0 items-center gap-1 truncate underline-offset-2 hover:underline"
                >
                  <span className="truncate">{r.name}</span>
                  <ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                </a>
              ) : (
                <span className="truncate">{r.name}</span>
              )}
              <IconButton
                label={`${r.name} entfernen`}
                size="icon-sm"
                className="ml-auto shrink-0 text-muted-foreground hover:text-destructive"
                disabled={busy || recommendations.length <= 1}
                onClick={() => onChange(ids.filter((id) => id !== r.id))}
              >
                <X />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-xs text-muted-foreground">Keine.</div>
      )}
      <div className="mt-1.5">
        <CatalogProductPicker
          placeholder="Produkt hinzufügen (tippen)…"
          ariaLabel="Produkt für Empfehlung suchen"
          maxResults={6}
          showThumbnails={false}
          onSelect={(hit, variant) => {
            const ref = variant?.variantId ? `${hit.productId}~${variant.variantId}` : hit.productId;
            if (busy || ids.includes(ref)) return;
            onChange([...ids, ref]);
          }}
          isSelected={(hit, variant) =>
            ids.includes(variant?.variantId ? `${hit.productId}~${variant.variantId}` : hit.productId)
          }
          disableReason={(hit, variant) => {
            if (busy) return "Speichert…";
            if (variant ? !variant.available : !hit.inStock) return "Ausverkauft";
            return null;
          }}
          onError={(err) =>
            toast({ variant: "error", title: "Katalogsuche fehlgeschlagen", description: err.message })
          }
        />
      </div>
    </div>
  );
}
