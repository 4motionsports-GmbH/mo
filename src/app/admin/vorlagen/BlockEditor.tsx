"use client";

// The block editor of e-mail templates and Rundmails (docs/EMAIL_TEMPLATES.md):
// the blocks as a tree with their settings — a section („Abschnitt mit
// Spalten“) expands to its settings and its columns, each with its own
// blocks —, the „Farben & Schrift“ of the whole mail and „Baustein
// hinzufügen“. Controlled: the parent owns the document (mail-template-doc.mjs)
// and renders the live preview next to it. Every structural change is a tree
// operation (mail-template-tree.mjs) and every change goes through
// normalizeMailTemplateDoc, so the editor can never hold a document the
// server would refuse to render. Pure UI — saving, the AI and the preview
// belong to the parent screen; the editor's decisions (limits, summaries,
// issues per row, column widths) are the tested src/lib/block-editor-core.mjs.
//
// `onChange` gets a value or an UPDATER (like useState). The field changes —
// a block's, a column's, „Farben & Schrift“ — and „Entfernen“ (after its
// confirmation) are updaters: a picture upload that finishes seconds later
// applies to the document as it is then, so edits made meanwhile and a
// KI-Gestalter result that arrived meanwhile stay (patchBlockUpdate …).

import * as React from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Move, Plus, Trash2 } from "lucide-react";
import {
  MAIL_BLOCK_CATALOG,
  MAIL_TEMPLATE_LIMITS,
  docBlockCount,
  docProductRefs,
  normalizeMailTemplateDoc,
} from "@/lib/mail-template-doc.mjs";
import {
  SECTION_LAYOUTS,
  canMoveMailBlock,
  duplicateMailBlock,
  findMailBlock,
  insertMailBlock,
  moveMailBlock,
  setSectionColumns,
} from "@/lib/mail-template-tree.mjs";
import { pct, plural } from "@/lib/admin-format.mjs";
import { Button, Callout, Disclosure, IconButton, InfoTip, Menu, Tooltip, toast, useConfirm, type MenuItem } from "../ui";
import { cn } from "../ui/cn";
import { BlockSettings } from "./BlockSettings";
import { CatalogInfoProvider, useCatalogInfoStore } from "./catalog-info";
import { DocStyleFields } from "./DocStyleFields";
import { ColumnSettings, SectionSettings, sectionColumns, type SectionColumn } from "./SectionEditor";
import {
  addMenuGroups,
  addableBlockTypes,
  blockSummary,
  blocksMovedByLayout,
  columnStyledCount,
  columnWidthsWith,
  duplicateBlockedReason,
  groupIssues,
  insertBlockedReason,
  mergeIssues,
  moveBlockTo,
  moveTargets,
  newEditorBlock,
  patchBlockUpdate,
  patchColumnUpdate,
  patchStyleUpdate,
  removeBlockUpdate,
  sectionLayoutFits,
} from "@/lib/block-editor-core.mjs";

export type MailDoc = ReturnType<typeof normalizeMailTemplateDoc>;
/** What BlockEditor's onChange gets: the new document, or an updater of the document as it is when the change lands. */
export type MailDocChange = MailDoc | ((prev: MailDoc) => MailDoc);
type Block = MailDoc["blocks"][number];
export type BlockUse = "bulk" | "personal" | "template";
export interface DocIssue {
  blockId: string | null;
  message: string;
}

/** Where a new or moved block goes (insertMailBlock). */
interface Where {
  afterId?: string;
  sectionId?: string;
  columnIndex?: number;
}

/** What every row of the tree needs: the document, the open state and the actions. */
interface EditorApi {
  doc: MailDoc;
  use: BlockUse;
  disabled: boolean;
  uploadConfigured: boolean;
  openId: string | null;
  expanded: ReadonlySet<string>;
  /** the section the open block belongs to (or the open section itself) */
  activeSectionId: string | null;
  /** true once for the block that was just added or moved — its row scrolls into view */
  takeScroll: (id: string) => boolean;
  issues: ReturnType<typeof groupIssues>;
  productName: (ref: string) => string | undefined;
  toggleBlock: (id: string) => void;
  toggleSection: (id: string) => void;
  patch: (id: string, p: Record<string, unknown>) => void;
  move: (id: string, dir: -1 | 1) => void;
  duplicate: (id: string) => void;
  remove: (block: Block) => void;
  moveTo: (id: string, where: Where) => void;
  add: (type: string, where: Where) => void;
  setLayout: (sectionId: string, key: string) => void;
  setColumnWidth: (sectionId: string, columnIndex: number, raw: string) => void;
  patchColumn: (sectionId: string, columnIndex: number, p: Record<string, unknown>) => void;
}

const withId = (set: ReadonlySet<string>, id: string) => new Set(set).add(id);
const withoutId = (set: ReadonlySet<string>, id: string) => {
  const next = new Set(set);
  next.delete(id);
  return next;
};

/** „Baustein hinzufügen“ (top level: after the open block) or „+ Baustein“ (a column). */
function AddBlockMenu({ ed, where, column }: { ed: EditorApi; where: Where; column?: number }) {
  const inColumn = column !== undefined;
  const groups = addMenuGroups(addableBlockTypes(ed.doc, ed.use, { inColumn }));
  const items: MenuItem[] = groups.flatMap((g, gi) =>
    g.types.map((t, ti) => {
      const blocked = insertBlockedReason(ed.doc, t, where);
      return {
        key: t,
        label: (
          <span className="flex flex-col">
            <span>{MAIL_BLOCK_CATALOG[t as Block["type"]].label}</span>
            <span className="text-2xs text-muted-foreground">{g.label}</span>
          </span>
        ),
        onSelect: () => ed.add(t, where),
        disabled: blocked != null,
        disabledReason: blocked ?? undefined,
        separatorBefore: gi > 0 && ti === 0,
      };
    })
  );
  const label = inColumn ? `Baustein in Spalte ${column + 1} hinzufügen` : "Baustein hinzufügen";
  const trigger = (disabled: boolean) =>
    inColumn ? (
      <Button variant="ghost" size="xs" disabled={disabled} aria-label={label} className="text-muted-foreground">
        <Plus /> Baustein
      </Button>
    ) : (
      <Button variant="outline" size="sm" disabled={disabled}>
        <Plus /> Baustein hinzufügen
      </Button>
    );
  // Nothing fits here any more (a limit of MAIL_TEMPLATE_LIMITS): the reason instead of a menu of disabled entries.
  const full = items.length === 0 || items.every((it) => it.disabled);
  if (full) {
    const reason =
      items.find((it) => it.disabledReason)?.disabledReason ??
      (docBlockCount(ed.doc) >= MAIL_TEMPLATE_LIMITS.totalBlocks ? `Höchstens ${MAIL_TEMPLATE_LIMITS.totalBlocks} Bausteine pro Mail.` : label);
    return (
      <Tooltip content={reason}>
        <span className="inline-flex self-start">{trigger(true)}</span>
      </Tooltip>
    );
  }
  return (
    <span className="inline-flex self-start">
      <Menu label={label} align="start" className="max-h-[min(70vh,36rem)] overflow-y-auto" trigger={trigger(false)} items={items} />
    </span>
  );
}

/** One column of an expanded section: its settings, its blocks, „+ Baustein“. */
function ColumnBox({ section, column, index, count, ed }: { section: Block; column: SectionColumn; index: number; count: number; ed: EditorApi }) {
  const styled = columnStyledCount(column);
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface-2 p-2" role="group" aria-label={`Spalte ${index + 1}`}>
      <Disclosure
        framed={false}
        title={<span className="text-xs">{`Spalte ${index + 1} · ${pct(column.width, 0)}`}</span>}
        meta={styled > 0 ? `${styled} angepasst` : undefined}
        contentClassName="pt-1"
      >
        <ColumnSettings
          column={column}
          count={count}
          onPatch={(p) => ed.patchColumn(section.id, index, p)}
          onWidth={(raw) => ed.setColumnWidth(section.id, index, raw)}
          sectionBackground={((section as Record<string, unknown>).background as string | null) ?? ed.doc.style.cardBackground}
          disabled={ed.disabled}
        />
      </Disclosure>
      {column.blocks.length > 0 && (
        <ol className="flex flex-col gap-1.5" aria-label={`Bausteine in Spalte ${index + 1}`}>
          {column.blocks.map((child) => (
            <BlockRow key={child.id} block={child} ed={ed} />
          ))}
        </ol>
      )}
      {!ed.disabled && <AddBlockMenu ed={ed} where={{ sectionId: section.id, columnIndex: index }} column={index} />}
    </div>
  );
}

/** One row of the tree: header (label, summary, issues, actions) and, when open, its settings — a section's are its columns. */
function BlockRow({ block, ed }: { block: Block; ed: EditorApi }) {
  const meta = MAIL_BLOCK_CATALOG[block.type];
  const isSection = block.type === "section";
  const isFooter = block.type === "footer";
  const open = isSection ? ed.expanded.has(block.id) : ed.openId === block.id;
  // A collapsed section carries the issues of the blocks in its columns.
  const { errors, warnings } = mergeIssues(ed.issues.own.get(block.id), isSection && !open ? ed.issues.nested.get(block.id) : undefined);
  const active = isSection ? open && ed.activeSectionId === block.id : open;
  const rowRef = React.useRef<HTMLLIElement>(null);
  const { takeScroll } = ed;
  React.useEffect(() => {
    if (takeScroll(block.id)) rowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
  const editable = !isFooter && !ed.disabled;
  const targets = editable ? moveTargets(ed.doc, block.id) : [];
  return (
    <li
      ref={rowRef}
      className={cn("rounded-lg border bg-card", errors.length ? "border-destructive/60" : active ? "border-accent" : "border-border")}
    >
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left hover:bg-surface-2"
          aria-expanded={open}
          onClick={() => (isSection ? ed.toggleSection(block.id) : ed.toggleBlock(block.id))}
        >
          {open ? <ChevronDown className="size-4 shrink-0" aria-hidden /> : <ChevronRight className="size-4 shrink-0" aria-hidden />}
          <span className="shrink-0 text-sm font-medium">{meta?.label ?? block.type}</span>
          <span className="min-w-0 truncate text-xs text-muted-foreground">{blockSummary(block, { productName: ed.productName })}</span>
          {errors.length > 0 && <span className="ml-auto shrink-0 text-2xs font-medium text-destructive">{errors.length} Fehler</span>}
          {!errors.length && warnings.length > 0 && <span className="ml-auto shrink-0 text-2xs font-medium text-warning">Hinweis</span>}
        </button>
        {open && meta?.description && <InfoTip panelClassName="max-w-sm">{meta.description}</InfoTip>}
        {editable && (
          <>
            {targets.length > 0 && (
              <Menu
                label="Verschieben"
                trigger={
                  <IconButton label="Verschieben" size="icon-sm">
                    <Move />
                  </IconButton>
                }
                items={targets.map((t) => ({
                  key: t.key,
                  label: t.label,
                  onSelect: () => ed.moveTo(block.id, t.where),
                  disabled: t.blocked != null,
                  disabledReason: t.blocked ?? undefined,
                }))}
              />
            )}
            <IconButton label="Nach oben" size="icon-sm" onClick={() => ed.move(block.id, -1)} disabled={!canMoveMailBlock(ed.doc, block.id, -1)}>
              <ArrowUp />
            </IconButton>
            <IconButton label="Nach unten" size="icon-sm" onClick={() => ed.move(block.id, 1)} disabled={!canMoveMailBlock(ed.doc, block.id, 1)}>
              <ArrowDown />
            </IconButton>
            <IconButton label="Duplizieren" size="icon-sm" onClick={() => ed.duplicate(block.id)} disabled={duplicateBlockedReason(ed.doc, block.id) != null}>
              <Copy />
            </IconButton>
            <IconButton label="Entfernen" size="icon-sm" onClick={() => ed.remove(block)}>
              <Trash2 />
            </IconButton>
          </>
        )}
      </div>
      {(errors.length > 0 || warnings.length > 0) && (
        <ul className="flex flex-col gap-0.5 px-3 pb-1.5 text-2xs">
          {errors.map((x, k) => (
            <li key={`e${k}`} className="text-destructive">
              {x.message}
            </li>
          ))}
          {warnings.map((x, k) => (
            <li key={`w${k}`} className="text-muted-foreground">
              {x.message}
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
          {isSection ? (
            <>
              <SectionSettings
                section={block}
                onPatch={(p) => ed.patch(block.id, p)}
                onLayout={(key) => ed.setLayout(block.id, key)}
                uploadConfigured={ed.uploadConfigured}
                disabled={ed.disabled}
                style={ed.doc.style}
              />
              <div className="flex flex-col gap-2">
                {sectionColumns(block).map((col, ci, all) => (
                  <ColumnBox key={col.id} section={block} column={col} index={ci} count={all.length} ed={ed} />
                ))}
              </div>
            </>
          ) : (
            <BlockSettings
              block={block}
              onPatch={(p) => ed.patch(block.id, p)}
              uploadConfigured={ed.uploadConfigured}
              disabled={ed.disabled}
              style={ed.doc.style}
            />
          )}
        </div>
      )}
    </li>
  );
}

/**
 * The editor. `use` decides which blocks „Baustein hinzufügen“ offers
 * (a Rundmail never gets Mo blocks); `issues` (validateMailTemplateDoc)
 * marks the blocks with problems — the document's own ones stand on top.
 */
export function BlockEditor({
  doc,
  onChange,
  use,
  issues,
  uploadConfigured,
  disabled = false,
}: {
  doc: MailDoc;
  onChange: (change: MailDocChange) => void;
  use: BlockUse;
  issues?: { errors: DocIssue[]; warnings: DocIssue[] };
  uploadConfigured: boolean;
  disabled?: boolean;
}) {
  // One block open at a time; sections expand on their own (opening a block
  // in a column keeps its section expanded).
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(() => new Set());
  // The block to bring into view once its row is there (one-shot: a row that
  // mounts again later — its section expanded anew — stays where it is).
  const scrollTo = React.useRef<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const catalog = useCatalogInfoStore(docProductRefs(doc));

  /** A structural change computed from this render's document (a click — it is the latest). */
  const commit = (next: unknown) => onChange(normalizeMailTemplateDoc(next));
  /** Open a block that was just added (its section expanded) and bring it into view. */
  const reveal = (id: string, sectionId: string | null) => {
    if (sectionId) setExpanded((cur) => withId(cur, sectionId));
    setOpenId(id);
    scrollTo.current = id;
  };
  const openAt = openId ? findMailBlock(doc, openId) : null;
  const grouped = groupIssues(doc, issues);

  const ed: EditorApi = {
    doc,
    use,
    disabled,
    uploadConfigured,
    openId,
    expanded,
    activeSectionId: openAt ? (openAt.block.type === "section" ? openAt.block.id : openAt.sectionId) : null,
    takeScroll: (id) => {
      if (scrollTo.current !== id) return false;
      scrollTo.current = null;
      return true;
    },
    issues: grouped,
    productName: (ref) => catalog.info[ref]?.name,
    toggleBlock: (id) => setOpenId((cur) => (cur === id ? null : id)),
    toggleSection: (id) => {
      if (expanded.has(id)) {
        setExpanded(withoutId(expanded, id));
        if (openAt && (openAt.block.id === id || openAt.sectionId === id)) setOpenId(null);
      } else {
        setExpanded(withId(expanded, id));
        setOpenId(id);
      }
    },
    // Field changes may land late (a picture upload): applied to the latest document.
    patch: (id, p) => onChange(patchBlockUpdate(id, p)),
    move: (id, dir) => commit(moveMailBlock(doc, id, dir)),
    duplicate: (id) => {
      const { doc: next, newId } = duplicateMailBlock(doc, id);
      if (newId) commit(next);
    },
    remove: async (block) => {
      const inside = block.type === "section" ? sectionColumns(block).flatMap((c) => c.blocks.map((k) => k.id)) : [];
      if (inside.length > 0) {
        // Hand edits have no undo — a section full of blocks is not removed by a slip.
        const ok = await confirm({
          title: "Abschnitt entfernen?",
          description: `Der Abschnitt wird mit ${plural(inside.length, "Baustein", "Bausteinen")} darin entfernt.`,
          confirmLabel: "Entfernen",
          tone: "destructive",
        });
        if (!ok) return;
      }
      const gone = new Set([block.id, ...inside]);
      // the document may have changed while the dialog was open
      onChange(removeBlockUpdate(block.id));
      setOpenId((cur) => (cur && gone.has(cur) ? null : cur));
    },
    moveTo: (id, where) => {
      const { doc: next, newId } = moveBlockTo(doc, id, where);
      if (!newId) return;
      commit(next);
      if (where.sectionId) setExpanded((cur) => withId(cur, where.sectionId as string));
      if (openId === id) setOpenId(newId);
      scrollTo.current = newId;
    },
    add: (type, where) => {
      const block = newEditorBlock(type);
      if (!block) return;
      const { doc: next, newId } = insertMailBlock(doc, block, where);
      if (!newId) return;
      commit(next);
      if (type === "section") setExpanded((cur) => withId(cur, newId));
      reveal(newId, findMailBlock(next, newId)?.sectionId ?? null);
    },
    setLayout: (sectionId, key) => {
      const preset = SECTION_LAYOUTS.find((l) => l.key === key);
      const at = findMailBlock(doc, sectionId);
      if (!preset || !at || !sectionLayoutFits(at.block, preset.widths.length)) return;
      const moved = blocksMovedByLayout(at.block, preset.widths.length);
      commit(setSectionColumns(doc, sectionId, [...preset.widths]));
      if (moved > 0) {
        toast({
          variant: "info",
          title: `${plural(moved, "Baustein", "Bausteine")} verschoben`,
          description: `${moved === 1 ? "Er steht" : "Sie stehen"} jetzt in Spalte ${preset.widths.length}.`,
        });
      }
    },
    setColumnWidth: (sectionId, columnIndex, raw) => {
      const at = findMailBlock(doc, sectionId);
      if (!at) return;
      const widths = sectionColumns(at.block).map((c) => c.width);
      const next = columnWidthsWith(widths, columnIndex, raw);
      if (next.every((w, i) => w === widths[i])) return;
      commit(setSectionColumns(doc, sectionId, next));
    },
    patchColumn: (sectionId, columnIndex, p) => onChange(patchColumnUpdate(sectionId, columnIndex, p)),
  };

  const { docLevel } = grouped;
  return (
    <CatalogInfoProvider value={catalog}>
      <div className="flex flex-col gap-3">
        {(docLevel.errors.length > 0 || docLevel.warnings.length > 0) && (
          <div className="flex flex-col gap-1.5">
            {docLevel.errors.map((x, k) => (
              <Callout key={`e${k}`} tone="destructive" compact>
                {x.message}
              </Callout>
            ))}
            {docLevel.warnings.map((x, k) => (
              <Callout key={`w${k}`} tone="warning" compact>
                {x.message}
              </Callout>
            ))}
          </div>
        )}

        <DocStyleFields
          style={doc.style}
          onPatch={(p) => onChange(patchStyleUpdate(p))}
          uploadConfigured={uploadConfigured}
          disabled={disabled}
        />

        <ol className="flex flex-col gap-2" aria-label="Bausteine">
          {doc.blocks.map((b) => (
            <BlockRow key={b.id} block={b} ed={ed} />
          ))}
        </ol>

        {!disabled && <AddBlockMenu ed={ed} where={openId ? { afterId: openId } : {}} />}
      </div>
      {confirmDialog}
    </CatalogInfoProvider>
  );
}
