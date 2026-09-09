import type { AdminTier } from "@/lib/admin-conversations";

/** The flat filter state the workspace holds — mirrors the g* URL params. */
export interface ConversationFilterState {
  preset: string;
  from: string;
  to: string;
  label: string;
  tier: AdminTier | null;
  hasError: boolean;
  category: string | null;
  quality: string | null;
  /** Free-text search over ALL chats (date window bypassed while active). */
  q: string | null;
  page: number;
}
