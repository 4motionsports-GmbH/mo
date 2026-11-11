"use client";

// The links of the block „Navigation“ (menu): one row per link — its text
// and its address — up to MAIL_TEMPLATE_LIMITS.menuItems. The rows are this
// field's own state: the document keeps only links with a text or an
// address (normalizeMailBlock), so a new, still empty row lives here until
// something is typed into it, and a row emptied while typing does not vanish
// under the cursor. Every change goes into the document right away; a change
// of the links made elsewhere (undo, the AI) replaces the rows.

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { MAIL_TEMPLATE_LIMITS } from "@/lib/mail-template-doc.mjs";
import { Button, Field, IconButton, Input } from "../ui";
import { menuItemsOfRows, normalizedMenuItems, normalizedMenuRow } from "@/lib/block-editor-core.mjs";

export interface MenuLink {
  label: string;
  href: string;
}

interface Row extends MenuLink {
  key: string;
}

const rowsOf = (items: readonly MenuLink[], prefix: string, withEmpty = false): Row[] => {
  const rows = items.map((it, i) => ({ key: `${prefix}${i}`, label: it.label, href: it.href }));
  return withEmpty ? [...rows, { key: `${prefix}${rows.length}`, label: "", href: "" }] : rows;
};

export function MenuItemsField({
  items,
  onChange,
  disabled,
}: {
  items: readonly MenuLink[];
  onChange: (items: MenuLink[]) => void;
  disabled?: boolean;
}) {
  const itemsJson = JSON.stringify(items);
  // `json`: the links the document holds after this field's last change.
  const [state, setState] = React.useState<{ json: string; rows: Row[] }>(() => ({
    json: itemsJson,
    // a new menu starts with one empty row, ready for the first link
    rows: rowsOf(items, "i", items.length === 0 && !disabled),
  }));
  // The document's links changed elsewhere: show them.
  const rows = state.json === itemsJson ? state.rows : rowsOf(items, "d");
  const listRef = React.useRef<HTMLDivElement>(null);
  const counter = React.useRef(0);
  const focusKey = React.useRef<string | null>(null);

  React.useEffect(() => {
    const key = focusKey.current;
    if (!key) return;
    focusKey.current = null;
    listRef.current?.querySelector<HTMLInputElement>(`[data-row="${key}"] input`)?.focus();
  });

  const apply = (next: Row[]) => {
    const docItems = menuItemsOfRows(next);
    const json = JSON.stringify(normalizedMenuItems(docItems));
    setState({ json, rows: next });
    if (json !== itemsJson) onChange(docItems);
  };
  const edit = (key: string, patch: Partial<MenuLink>) => apply(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  // Leaving a field shows what the mail keeps (a trimmed text, a valid link or none).
  const settle = (key: string) => apply(rows.map((r) => (r.key === key ? { ...r, ...normalizedMenuRow(r) } : r)));
  const remove = (key: string) => apply(rows.filter((r) => r.key !== key));
  const add = () => {
    const key = `n${++counter.current}`;
    focusKey.current = key;
    apply([...rows, { key, label: "", href: "" }]);
  };

  const max = MAIL_TEMPLATE_LIMITS.menuItems;
  const linked = menuItemsOfRows(rows).length;
  return (
    <Field
      label={`Links (${linked}/${max})`}
      info="Jeder Link braucht einen Text und eine Adresse (https://…, mailto: oder tel:). Links in den Shop bekommen automatisch UTM-Parameter, jeder Klick wird gezählt."
    >
      <div ref={listRef} className="flex flex-col gap-1.5">
        {rows.length > 0 && (
          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_1.75rem] gap-1.5 px-0.5 text-2xs text-muted-foreground" aria-hidden>
            <span>Text</span>
            <span>Adresse</span>
          </div>
        )}
        {rows.map((r, i) => (
          <div key={r.key} data-row={r.key} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_1.75rem] items-center gap-1.5">
            <Input
              aria-label={`Text von Link ${i + 1}`}
              value={r.label}
              maxLength={40}
              placeholder="z. B. Kraft"
              onChange={(e) => edit(r.key, { label: e.target.value })}
              onBlur={() => settle(r.key)}
              disabled={disabled}
              className="h-8"
            />
            <Input
              aria-label={`Adresse von Link ${i + 1}`}
              value={r.href}
              placeholder="https://motionsports.de/…"
              onChange={(e) => edit(r.key, { href: e.target.value })}
              onBlur={() => settle(r.key)}
              disabled={disabled}
              className="h-8"
            />
            {!disabled && (
              <IconButton label={`Link ${i + 1} entfernen`} size="icon-sm" onClick={() => remove(r.key)}>
                <Trash2 />
              </IconButton>
            )}
          </div>
        ))}
        {!disabled && (
          <Button type="button" variant="outline" size="xs" className="self-start" onClick={add} disabled={rows.length >= max}>
            <Plus /> Link hinzufügen
          </Button>
        )}
      </div>
    </Field>
  );
}
