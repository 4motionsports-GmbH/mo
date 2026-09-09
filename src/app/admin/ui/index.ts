// Admin UI kit — shadcn-style copy-in primitives, themed via the design tokens
// in ../theme.css. No heavy runtime deps (no Radix); interactive primitives are
// minimal hand-rolled implementations.
//
// Rules of thumb (see docs/ADMIN_DASHBOARD.md → Design system):
//   · explanations go into <InfoTip>, never into helper paragraphs
//   · states go into <Callout> / <EmptyState> / <StatusBadge>
//   · lists go into <DataTable> (+ <Pagination>), master/detail into <SplitPane>
//   · single-choice toggles are a <SegmentedControl>
//   · confirmations use useConfirm(); API calls use adminFetch() from ../lib

export { cn } from "./cn";
export { Button, buttonVariants, type ButtonProps } from "./button";
export { IconButton, type IconButtonProps } from "./icon-button";
export { Input } from "./input";
export { SearchInput, type SearchInputProps } from "./search-input";
export { Textarea } from "./textarea";
export { Label } from "./label";
export { Field, type FieldProps } from "./field";
export { Select } from "./select";
export { Checkbox, type CheckboxProps } from "./checkbox";
export { SegmentedControl, type SegmentedControlProps, type SegmentedOption } from "./segmented-control";
export { Badge, type BadgeProps } from "./badge";
export { StatusBadge, type StatusBadgeProps, type StatusTone } from "./status-badge";
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./card";
export { Skeleton } from "./skeleton";
export { Spinner } from "./spinner";
export { ProgressBar, type ProgressBarProps } from "./progress-bar";
export {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "./table";
export {
  DataTable,
  type DataTableColumn,
  type DataTableProps,
  type SortDir,
  type SortState,
} from "./data-table";
export { Pagination, type PaginationProps } from "./pagination";
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";
export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
  type DialogSize,
} from "./dialog";
export { ConfirmDialog, useConfirm, type ConfirmOptions } from "./confirm-dialog";
export { Sheet, type SheetProps } from "./sheet";
export { Disclosure, type DisclosureProps } from "./disclosure";
export { toast, Toaster, type ToastOptions, type ToastVariant } from "./toast";
export { Section, Stat, Caveat, type StatDelta } from "./stat";
export { InfoTip, Tooltip, type InfoTipProps, type TooltipProps, type FloatingSide } from "./info-tip";
export { Callout, type CalloutProps, type CalloutTone } from "./callout";
export { EmptyState, type EmptyStateProps } from "./empty-state";
export { PageHeader, type PageHeaderProps } from "./page-header";
export { FilterBar, FilterChip, FilterGroup, type FilterBarProps } from "./filter-bar";
export { SplitPane, type SplitPaneProps } from "./split-pane";
export { DescriptionList, DescriptionItem } from "./description-list";
export { TranscriptView, type TranscriptTurn, type TranscriptViewProps } from "./transcript-view";
export { Kbd } from "./kbd";
export { Markdown } from "./markdown";
export {
  CatalogProductPicker,
  useCatalogSearch,
  fmtPickerMoney,
  hasVariantChoice,
  type CatalogSearchHit,
  type CatalogVariantHit,
  type CatalogProductPickerProps,
} from "./product-picker";
