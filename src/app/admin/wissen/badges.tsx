"use client";

// Status vocabulary of the Wissen queue.

import { Package } from "lucide-react";
import { QA_STATUS_LABELS } from "@/lib/qa-core.mjs";
import type { QaStatus } from "@/lib/qa-store";
import { StatusBadge, type StatusTone } from "../ui";

export const QA_STATUS_TONE: Record<QaStatus, StatusTone> = {
  open: "warning",
  answered: "info",
  published: "success",
  dismissed: "neutral",
};

export function QaStatusBadge({ status, size = "sm" }: { status: QaStatus; size?: "sm" | "md" }) {
  return (
    <StatusBadge tone={QA_STATUS_TONE[status]} size={size}>
      {(QA_STATUS_LABELS as Record<string, string>)[status] ?? status}
    </StatusBadge>
  );
}

export function QaProductBadge({
  productId,
  productTitle,
  size = "sm",
}: {
  productId: string | null;
  productTitle: string | null;
  size?: "sm" | "md";
}) {
  if (!productId) {
    return (
      <StatusBadge tone="neutral" dot={false} size={size}>
        Allgemein
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone="accent" dot={false} icon={<Package />} size={size} className="max-w-[18rem]">
      <span className="truncate">{productTitle ?? productId}</span>
    </StatusBadge>
  );
}
