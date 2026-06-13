"use client";

// Manual light/dark toggle for the admin header. Persists the choice in a cookie
// (so the SERVER renders the right theme next load with no flash) and flips the
// `.dark` class on #admin-root live. When no cookie is set yet, the actual theme
// was resolved from the OS preference by the inline init script — so on mount we
// read the live DOM state rather than assuming a default.

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "./ui/button";
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, type Theme } from "./theme-config";

export function ThemeToggle({ initial }: { initial: Theme | null }) {
  // Before mount we don't know the OS-resolved value (when there's no cookie),
  // so start from the cookie value if present and reconcile on mount.
  const [theme, setTheme] = React.useState<Theme>(initial ?? "light");
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    const root = document.getElementById("admin-root");
    setTheme(root?.classList.contains("dark") ? "dark" : "light");
    setMounted(true);
  }, []);

  function apply(next: Theme) {
    const root = document.getElementById("admin-root");
    if (root) root.classList.toggle("dark", next === "dark");
    document.cookie = `${THEME_COOKIE}=${next}; path=/admin; max-age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
    setTheme(next);
  }

  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={() => apply(next)}
      aria-label={next === "dark" ? "Dunkles Design aktivieren" : "Helles Design aktivieren"}
      title={next === "dark" ? "Dunkles Design" : "Helles Design"}
    >
      {/* Render a stable icon until mounted to avoid a hydration mismatch when
          the theme came from the OS preference rather than the cookie. */}
      {!mounted ? (
        <Sun className="size-4" />
      ) : theme === "dark" ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </Button>
  );
}
