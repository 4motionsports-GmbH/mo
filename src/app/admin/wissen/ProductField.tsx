"use client";

// The entry's product reference: shown as title + read-only handle, set or
// changed through the shared CatalogProductPicker, cleared with one click
// (empty = a general question for Mo's knowledge base).

import * as React from "react";
import { Package, X } from "lucide-react";
import { Button, CatalogProductPicker, StatusBadge } from "../ui";

export interface ProductRef {
  handle: string;
  title: string | null;
}

export function ProductField({
  value,
  onChange,
  disabled,
  onError,
}: {
  value: ProductRef | null;
  onChange: (next: ProductRef | null) => void;
  disabled?: boolean;
  onError: (err: Error) => void;
}) {
  const [picking, setPicking] = React.useState(false);

  if (picking) {
    return (
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <CatalogProductPicker
            autoFocus
            showThumbnails={false}
            maxResults={6}
            selectLabel="wählen"
            placeholder="Produkt suchen (tippen)…"
            ariaLabel="Produkt für diese Frage suchen"
            onSelect={(hit) => {
              onChange({ handle: hit.productId, title: hit.title });
              setPicking(false);
            }}
            onError={onError}
          />
        </div>
        <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
          Abbrechen
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-8 flex-wrap items-center gap-2">
      {value ? (
        <>
          <StatusBadge tone="accent" dot={false} icon={<Package />} size="md">
            {value.title ?? value.handle}
          </StatusBadge>
          <code className="text-xs text-muted-foreground">{value.handle}</code>
        </>
      ) : (
        <span className="text-xs text-muted-foreground">Allgemeine Frage — kein Produkt</span>
      )}
      {!disabled && (
        <span className="flex items-center gap-1">
          <Button size="xs" variant="outline" onClick={() => setPicking(true)}>
            {value ? "Ändern" : "Produkt wählen"}
          </Button>
          {value && (
            <Button size="xs" variant="ghost" onClick={() => onChange(null)}>
              <X /> Entfernen
            </Button>
          )}
        </span>
      )}
    </div>
  );
}
