// Admin UI kit — shadcn-style copy-in primitives, themed via the design tokens
// in ../theme.css. No heavy runtime deps (no Radix); interactive primitives are
// minimal hand-rolled implementations.

export { cn } from "./cn";
export { Button, buttonVariants, type ButtonProps } from "./button";
export { Input } from "./input";
export { Textarea } from "./textarea";
export { Label } from "./label";
export { Select } from "./select";
export { Checkbox, type CheckboxProps } from "./checkbox";
export { Badge, type BadgeProps } from "./badge";
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./card";
export { Skeleton } from "./skeleton";
export {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "./table";
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
} from "./dialog";
export { toast, Toaster, type ToastOptions, type ToastVariant } from "./toast";
export { Section, Stat, Caveat } from "./stat";
