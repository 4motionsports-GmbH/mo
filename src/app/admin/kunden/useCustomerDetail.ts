"use client";

// Loads one customer's full detail on demand (GET /api/admin/customers/detail)
// and re-loads it after mutations. Stale responses are ignored when the
// selection changes mid-flight.

import * as React from "react";
import type { CustomerDetail } from "@/lib/customer-detail";
import { adminFetch, errorMessage } from "../lib/admin-fetch";

interface DetailState {
  id: number | null;
  data: CustomerDetail | null;
  loading: boolean;
  error: string | null;
}

export function useCustomerDetail(id: number | null) {
  const [state, setState] = React.useState<DetailState>({
    id: null,
    data: null,
    loading: false,
    error: null,
  });
  const [version, setVersion] = React.useState(0);

  React.useEffect(() => {
    if (id === null) {
      setState({ id: null, data: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    // Keep the previous data visible while the SAME customer reloads; switching
    // customers clears it so the skeleton shows.
    setState((s) => ({ id, data: s.id === id ? s.data : null, loading: true, error: null }));
    adminFetch<{ customer: CustomerDetail }>(`/api/admin/customers/detail?id=${id}`, {
      signal: controller.signal,
    })
      .then((json) => {
        if (controller.signal.aborted) return;
        setState({ id, data: json.customer, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setState({ id, data: null, loading: false, error: errorMessage(err) });
      });
    return () => controller.abort();
  }, [id, version]);

  const reload = React.useCallback(() => setVersion((v) => v + 1), []);

  return {
    customer: state.id === id ? state.data : null,
    loading: state.loading,
    error: state.id === id ? state.error : null,
    reload,
  };
}
