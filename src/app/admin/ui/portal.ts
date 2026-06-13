// Returns the element that overlay primitives (Dialog, etc.) should portal into.
// MUST be inside #admin-root so portaled content inherits the `.dark` theme
// override and Montserrat scope — portaling to document.body would render it
// outside the admin theme scope and lose dark-mode token values.
export function getPortalContainer(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById("admin-root") ?? document.body;
}
