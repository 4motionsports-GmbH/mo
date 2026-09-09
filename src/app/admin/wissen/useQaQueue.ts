"use client";

// State of the Wissen queue: entries + counts + scan candidates, reloaded from
// GET /api/admin/qa/list after every mutation, and the one token-spending
// action ("Gespräche scannen", POST /api/admin/qa/scan).

import * as React from "react";
import type { QaCounts, QaEntry } from "@/lib/qa-store";
import { num } from "@/lib/admin-format.mjs";
import { toast } from "../ui";
import { adminFetch } from "../lib/admin-fetch";
import { useAsyncAction } from "../lib/use-async-action";

export interface QaQueueData {
  entries: QaEntry[];
  counts: QaCounts;
  scanCandidates: number;
}

export const SCAN_BATCH = 10;

interface ScanResult {
  scanned?: number;
  created?: number;
  noGap?: number;
  duplicates?: number;
  errors?: number;
}

export function useQaQueue(initial: QaQueueData) {
  const [data, setData] = React.useState<QaQueueData>(initial);

  const reload = React.useCallback(async () => {
    try {
      const json = await adminFetch<QaQueueData>("/api/admin/qa/list");
      setData(json);
    } catch {
      // keep the current view — a failed refresh is not destructive
    }
  }, []);

  const scan = useAsyncAction(
    () => adminFetch<ScanResult>("/api/admin/qa/scan", { body: { limit: SCAN_BATCH } }),
    {
      errorToast: "Scan fehlgeschlagen",
      onSuccess: (res) => {
        toast({
          variant: "success",
          title: "Scan abgeschlossen",
          description: `${num(res.scanned ?? 0)} Gespräche geprüft — ${num(res.created ?? 0)} neue Fragen, ${num(res.noGap ?? 0)} ohne Lücke, ${num(res.duplicates ?? 0)} Duplikate${res.errors ? `, ${num(res.errors)} Fehler` : ""}.`,
        });
        void reload();
      },
    }
  );

  return { ...data, reload, scan };
}
