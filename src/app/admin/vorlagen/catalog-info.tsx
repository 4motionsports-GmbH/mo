"use client";

// Name, picture and availability of the catalog products a document uses —
// asked once per ref for the whole block editor (the rows' summaries, the
// fields of „Produkte“ and „Produkt-Highlight“), filled right away when the
// operator picks a product. Availability as the mail shows it: a bare ref of
// a multi-variant product is the product in all its variants.

import * as React from "react";
import { adminFetch } from "../lib/admin-fetch";

export interface CatalogInfo {
  name: string;
  /** null = no longer in the catalog */
  available: boolean | null;
  imageUrl: string | null;
}

export interface CatalogInfoStore {
  info: Readonly<Record<string, CatalogInfo>>;
  /** What the picker already knows about a ref the operator just chose. */
  remember: (ref: string, entry: CatalogInfo) => void;
}

/** The availability route takes at most this many refs per request. */
const REFS_PER_REQUEST = 50;

const CatalogInfoContext = React.createContext<CatalogInfoStore>({ info: {}, remember: () => {} });

export const CatalogInfoProvider = CatalogInfoContext.Provider;

export function useCatalogInfo(): CatalogInfoStore {
  return React.useContext(CatalogInfoContext);
}

/** The store of the block editor: asks the live catalog for every ref it has no entry for yet. */
export function useCatalogInfoStore(refs: readonly string[]): CatalogInfoStore {
  const [info, setInfo] = React.useState<Record<string, CatalogInfo>>({});
  const asked = React.useRef(new Set<string>());
  const refsKey = refs.join("|");
  React.useEffect(() => {
    const missing = refsKey ? refsKey.split("|").filter((ref) => !asked.current.has(ref)) : [];
    if (missing.length === 0) return;
    for (const ref of missing) asked.current.add(ref);
    // Not cancelled when the refs change again: an answer only fills refs
    // that have no entry yet, so a late one is harmless — a dropped one would
    // never be asked again.
    for (let i = 0; i < missing.length; i += REFS_PER_REQUEST) {
      const chunk = missing.slice(i, i + REFS_PER_REQUEST);
      adminFetch<{ items: Array<{ id: string; name: string; available: boolean | null; imageUrl?: string | null }> }>(
        "/api/admin/catalog/availability",
        { body: { refs: chunk, allVariants: true } }
      )
        .then((json) => {
          setInfo((cur) => {
            const next = { ...cur };
            for (const it of json.items ?? []) {
              if (!next[it.id]) next[it.id] = { name: it.name, available: it.available, imageUrl: it.imageUrl ?? null };
            }
            return next;
          });
        })
        .catch(() => {
          // best effort: the fields show the catalog ids; asked again on the next change
          for (const ref of chunk) asked.current.delete(ref);
        });
    }
  }, [refsKey]);
  const remember = React.useCallback((ref: string, entry: CatalogInfo) => {
    asked.current.add(ref);
    setInfo((cur) => ({ ...cur, [ref]: entry }));
  }, []);
  return React.useMemo(() => ({ info, remember }), [info, remember]);
}
