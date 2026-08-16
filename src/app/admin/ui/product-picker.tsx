"use client";

// Catalog product picker — THE shared "select a product (and variant) from the
// live catalog" widget. Replaces the previously copy-pasted search boxes in the
// bundle composer (CustomerProfileCard), the campaign recommendations editor
// (KampagneWorkspace) and the Wissen "Produkt verlinken" helper
// (WissenWorkspace).
//
// Two parts:
//   - useCatalogSearch(query, opts) — the debounced (250 ms), sequence-guarded
//     name search against POST /api/admin/catalog/search. Transport is plain
//     fetch (admin auth is cookie-based); errors surface via opts.onError.
//   - <CatalogProductPicker> — search box + result list. Products with more
//     than one variant expand an inline variant chooser (mirroring the
//     storefront PDP), so a specific variant can be selected wherever products
//     can — the admin side of the product-ref rail
//     (docs/PRODUCT_VARIANTS_PLAN.md).
//
// onSelect receives (hit, variant|null): null means "the product" (default
// variant); a variant means the operator pinned that concrete variant.

import * as React from "react";
import { ChevronDown, Plus, Search } from "lucide-react";
import { cn } from "./cn";
import { Button } from "./button";
import { Input } from "./input";

export interface CatalogVariantHit {
  variantId: string | null;
  title: string;
  unitPrice: number | null;
  currency: string;
  available: boolean;
  sku?: string;
}

export interface CatalogSearchHit {
  productId: string;
  title: string;
  imageUrl: string | null;
  unitPrice: number;
  currency: string;
  inStock: boolean;
  url: string | null;
  priceMin?: number;
  priceMax?: number;
  variants?: CatalogVariantHit[];
}

const DEBOUNCE_MS = 250;
const MIN_QUERY_CHARS = 2;

export function fmtPickerMoney(amount: number | null | undefined, currency = "EUR"): string {
  if (typeof amount !== "number") return "—";
  return new Intl.NumberFormat("de-DE", { style: "currency", currency }).format(amount);
}

/** True when the hit has a genuine variant choice (more than one variant). */
export function hasVariantChoice(hit: CatalogSearchHit): boolean {
  return (hit.variants?.length ?? 0) > 1;
}

export function useCatalogSearch(
  query: string,
  opts?: { enabled?: boolean; onError?: (err: Error) => void }
): { results: CatalogSearchHit[]; searching: boolean } {
  const enabled = opts?.enabled !== false;
  const onErrorRef = React.useRef(opts?.onError);
  onErrorRef.current = opts?.onError;
  const [results, setResults] = React.useState<CatalogSearchHit[]>([]);
  const [searching, setSearching] = React.useState(false);
  const searchSeq = React.useRef(0);

  React.useEffect(() => {
    const q = query.trim();
    if (!enabled || q.length < MIN_QUERY_CHARS) {
      searchSeq.current++;
      setResults([]);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch("/api/admin/catalog/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          products?: CatalogSearchHit[];
          error?: { message?: string };
        };
        if (seq !== searchSeq.current) return;
        if (!res.ok) {
          throw new Error(json?.error?.message ?? `Fehler (${res.status})`);
        }
        setResults(json.products ?? []);
      } catch (err) {
        if (seq !== searchSeq.current) return;
        setResults([]);
        onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, enabled]);

  return { results, searching };
}

export interface CatalogProductPickerProps {
  /** Called when the operator picks a product (variant = null → default). */
  onSelect: (hit: CatalogSearchHit, variant: CatalogVariantHit | null) => void;
  /** Non-null return disables the row/variant and is shown as tooltip. */
  disableReason?: (hit: CatalogSearchHit, variant: CatalogVariantHit | null) => string | null;
  /** Marks a row/variant as already picked ("✓ drin"). */
  isSelected?: (hit: CatalogSearchHit, variant: CatalogVariantHit | null) => boolean;
  onError?: (err: Error) => void;
  placeholder?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  /** Cap on rendered results (server already caps at 20). */
  maxResults?: number;
  /** Thumbnails on result rows (composer style). Default true. */
  showThumbnails?: boolean;
  selectLabel?: string;
  className?: string;
}

export function CatalogProductPicker({
  onSelect,
  disableReason,
  isSelected,
  onError,
  placeholder = "Produkt suchen (tippen)…",
  ariaLabel = "Produkt im Katalog suchen",
  autoFocus = false,
  maxResults = 20,
  showThumbnails = true,
  selectLabel = "hinzufügen",
  className,
}: CatalogProductPickerProps) {
  const [query, setQuery] = React.useState("");
  const { results, searching } = useCatalogSearch(query, { onError });
  // productId whose variant chooser is expanded (one at a time).
  const [expanded, setExpanded] = React.useState<string | null>(null);

  React.useEffect(() => {
    // Collapse a stale chooser when the result set changes.
    setExpanded(null);
  }, [results]);

  const shown = results.slice(0, maxResults);

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="pl-9 pr-16"
          aria-label={ariaLabel}
          autoFocus={autoFocus}
        />
        {searching && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            Suche…
          </span>
        )}
      </div>

      {shown.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1">
          {shown.map((hit) => {
            const multi = hasVariantChoice(hit);
            const isExpanded = expanded === hit.productId;
            const productDisabled = disableReason?.(hit, null) ?? null;
            const productSelected = isSelected?.(hit, null) ?? false;
            const range =
              multi && hit.priceMin != null && hit.priceMax != null && hit.priceMax > hit.priceMin
                ? `ab ${fmtPickerMoney(hit.priceMin, hit.currency)}`
                : fmtPickerMoney(hit.unitPrice, hit.currency);
            return (
              <div
                key={hit.productId}
                className="rounded-md border border-border bg-card px-2 py-1 text-sm"
              >
                <div className="flex items-center gap-2">
                  {showThumbnails &&
                    (hit.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={hit.imageUrl}
                        alt={hit.title}
                        width={28}
                        height={28}
                        className="size-7 shrink-0 rounded object-cover"
                      />
                    ) : (
                      <div className="size-7 shrink-0 rounded bg-muted" />
                    ))}
                  <span className="min-w-0 flex-1">
                    {hit.title} <span className="text-muted-foreground">· {range}</span>
                    {!hit.inStock && <span className="text-destructive"> · ausverkauft</span>}
                  </span>
                  {multi ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setExpanded(isExpanded ? null : hit.productId)}
                      aria-expanded={isExpanded}
                      aria-label={`Variante von ${hit.title} wählen`}
                    >
                      Variante wählen{" "}
                      <ChevronDown className={cn("transition-transform", isExpanded && "rotate-180")} />
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onSelect(hit, null)}
                      disabled={productSelected || productDisabled != null}
                      title={productDisabled ?? undefined}
                    >
                      {productSelected ? (
                        "✓ drin"
                      ) : (
                        <>
                          <Plus /> {selectLabel}
                        </>
                      )}
                    </Button>
                  )}
                </div>

                {multi && isExpanded && (
                  <div className="mt-1 flex flex-col gap-0.5 border-t border-border pt-1">
                    {(hit.variants ?? []).map((v, i) => {
                      const vDisabled = disableReason?.(hit, v) ?? null;
                      const vSelected = isSelected?.(hit, v) ?? false;
                      return (
                        <div
                          key={v.variantId ?? `${hit.productId}-${i}`}
                          className="flex items-center gap-2 rounded px-1.5 py-0.5"
                        >
                          <span className="min-w-0 flex-1 text-sm">
                            {v.title || "Standard"}{" "}
                            <span className="text-muted-foreground">
                              · {fmtPickerMoney(v.unitPrice, v.currency)}
                            </span>
                            {!v.available && (
                              <span className="text-destructive"> · ausverkauft</span>
                            )}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onSelect(hit, v)}
                            disabled={vSelected || vDisabled != null}
                            title={vDisabled ?? undefined}
                          >
                            {vSelected ? (
                              "✓ drin"
                            ) : (
                              <>
                                <Plus /> {selectLabel}
                              </>
                            )}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {query.trim().length >= MIN_QUERY_CHARS && !searching && results.length === 0 && (
        <div className="mt-1.5 text-xs text-muted-foreground">
          Keine Treffer für „{query.trim()}“.
        </div>
      )}
    </div>
  );
}
