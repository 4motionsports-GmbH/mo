/** The stored-report list item shown in the Analyse rail (no `sections`). */
export interface SidebarReport {
  id: number;
  title: string;
  from: string;
  to: string;
  status: "running" | "complete" | "failed";
  costEur: number;
  createdAt: string;
}
