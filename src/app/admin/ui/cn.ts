// Minimal class-name combiner (clsx-style) — no external runtime dependency.
// Accepts strings, conditional objects and nested arrays; ignores falsy values.
// Note: this does NOT de-duplicate conflicting Tailwind utilities (no
// tailwind-merge). The primitives keep their base classes conflict-free and put
// caller `className` last so consumers can extend rather than fight the base.

export type ClassValue =
  | string
  | number
  | null
  | false
  | undefined
  | ClassValue[]
  | Record<string, boolean | null | undefined>;

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  for (const input of inputs) {
    if (!input) continue;
    if (typeof input === "string" || typeof input === "number") {
      out.push(String(input));
    } else if (Array.isArray(input)) {
      const inner = cn(...input);
      if (inner) out.push(inner);
    } else if (typeof input === "object") {
      for (const [key, value] of Object.entries(input)) {
        if (value) out.push(key);
      }
    }
  }
  return out.join(" ");
}
