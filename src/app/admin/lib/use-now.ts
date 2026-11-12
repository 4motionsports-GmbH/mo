"use client";

// useNow — the current time for a countdown („in 3 Std.“), re-read every
// `intervalMs`. null during the server render and hydration, so a relative
// time is never part of the hydrated HTML (server and browser clocks differ;
// one that flips a unit in between would break hydration). Without a
// setState-in-effect dance: a ticking external store.

import * as React from "react";

export function useNow(intervalMs = 30_000): number | null {
  const step = Math.max(1000, intervalMs);
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const handle = setInterval(onChange, step);
      return () => clearInterval(handle);
    },
    [step]
  );
  // Stable between ticks (the snapshot must not change on every read).
  return React.useSyncExternalStore(
    subscribe,
    () => Math.floor(Date.now() / step) * step,
    () => null
  );
}
