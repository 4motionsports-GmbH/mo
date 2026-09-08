"use client";

// useMediaQuery — subscribe to a CSS media query without a setState-in-effect
// dance. `serverDefault` is what the server (and the first client render) sees.

import * as React from "react";

export function useMediaQuery(query: string, serverDefault = false): boolean {
  const subscribe = React.useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    [query]
  );
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverDefault
  );
}
