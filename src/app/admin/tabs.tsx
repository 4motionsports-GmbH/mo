// React side of the screen registry: icons per screen. Keys, labels, groups,
// descriptions and URL rules live in src/lib/admin-tabs.mjs (pure, tested).

import {
  BookOpen,
  FileText,
  LayoutDashboard,
  MessagesSquare,
  MessageSquareText,
  Send,
  Settings,
  Sparkles,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { AdminTabKey } from "@/lib/admin-tabs.mjs";

export type AdminTab = AdminTabKey;

export const TAB_ICONS: Record<AdminTab, LucideIcon> = {
  overview: LayoutDashboard,
  kampagne: Send,
  kunden: Users,
  wissen: BookOpen,
  kpi: TrendingUp,
  gespraeche: MessagesSquare,
  feedback: MessageSquareText,
  analyse: FileText,
  verbesserung: Sparkles,
  einstellungen: Settings,
};
