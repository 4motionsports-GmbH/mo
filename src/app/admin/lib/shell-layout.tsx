"use client";

// Layout requests from a screen to the admin shell. The shell caps its content
// at max-w-5xl / max-w-7xl (admin-tabs.mjs `wide`), which suits lists and
// forms; a work area next to a live e-mail preview (the template editor, a
// Rundmail's „Inhalt“) asks for the whole width while it is mounted, so the
// preview can show the mail at full size on a large screen.

import * as React from "react";

const FullWidthContext = React.createContext<(on: boolean) => void>(() => {});

export const ShellLayoutProvider = FullWidthContext.Provider;

/** Ask the shell for the full width while `active` (and this component is mounted). */
export function useFullWidthLayout(active = true): void {
  const setFullWidth = React.useContext(FullWidthContext);
  React.useEffect(() => {
    if (!active) return;
    setFullWidth(true);
    return () => setFullWidth(false);
  }, [active, setFullWidth]);
}
