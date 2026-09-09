// adminFetch — the ONE client-side fetch helper for /api/admin/* calls
// (replaces the per-file callApi / call / post copies). JSON in, JSON out;
// errors become an AdminApiError carrying status + code + the server's German
// message; a 401 (expired session) sends the operator to the login page and
// back to the screen they were on.

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly details: unknown;

  constructor(message: string, status: number, code: string | null = null, details?: unknown) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get unauthorized(): boolean {
    return this.status === 401;
  }
}

export interface AdminFetchOptions {
  /** Defaults to POST when a body is given, GET otherwise. */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** JSON-serialised request body. */
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** What to do on 401 — redirect to /admin/login (default) or just throw. */
  onUnauthorized?: "redirect" | "throw";
}

function defaultMessage(status: number): string {
  if (status === 401) return "Sitzung abgelaufen — bitte neu anmelden.";
  if (status === 403) return "Keine Berechtigung.";
  if (status === 404) return "Nicht gefunden.";
  if (status === 409) return "Konflikt — bitte die Seite neu laden.";
  if (status === 413) return "Anfrage zu groß.";
  if (status === 429) return "Zu viele Anfragen — bitte kurz warten.";
  if (status >= 500) return `Serverfehler (${status}).`;
  return `Fehler (${status})`;
}

interface ErrorEnvelope {
  error?: { code?: string; message?: string } | string;
  message?: string;
}

function readError(json: unknown, status: number): { code: string | null; message: string } {
  const env = (json ?? {}) as ErrorEnvelope;
  if (env.error && typeof env.error === "object") {
    return {
      code: typeof env.error.code === "string" ? env.error.code : null,
      message:
        typeof env.error.message === "string" && env.error.message
          ? env.error.message
          : defaultMessage(status),
    };
  }
  if (typeof env.error === "string" && env.error) return { code: null, message: env.error };
  if (typeof env.message === "string" && env.message) return { code: null, message: env.message };
  return { code: null, message: defaultMessage(status) };
}

/** Send the operator to the login page; the sanitised `next` brings them back. */
export function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/admin/login?next=${encodeURIComponent(next)}`);
}

export async function adminFetch<T = unknown>(
  path: string,
  options: AdminFetchOptions = {}
): Promise<T> {
  const { body, signal, headers = {}, onUnauthorized = "redirect" } = options;
  const method = options.method ?? (body === undefined ? "GET" : "POST");
  const init: RequestInit = {
    method,
    signal,
    credentials: "same-origin",
    headers: { Accept: "application/json", ...headers },
  };
  if (body !== undefined) {
    init.headers = { ...(init.headers as Record<string, string>), "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }

  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new AdminApiError("Netzwerkfehler — bitte Verbindung prüfen.", 0, "network", err);
  }

  const text = await res.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    const { code, message } = readError(json, res.status);
    if (res.status === 401 && onUnauthorized === "redirect") redirectToLogin();
    throw new AdminApiError(message, res.status, code, json);
  }
  return (json ?? {}) as T;
}

/** Human-readable message for any thrown value. */
export function errorMessage(err: unknown, fallback = "Unbekannter Fehler"): string {
  if (err instanceof Error) return err.message || fallback;
  if (typeof err === "string" && err) return err;
  return fallback;
}

/** True for a failed transport (offline, DNS, aborted) — not an API error. */
export function isNetworkError(err: unknown): boolean {
  return !(err instanceof AdminApiError) && err instanceof TypeError;
}

/**
 * errorMessage() with the transport failures translated for the operator:
 * "Netzwerkfehler — bitte erneut versuchen." instead of "Failed to fetch".
 */
export function friendlyErrorMessage(err: unknown, fallback = "Unbekannter Fehler"): string {
  if (isNetworkError(err)) return "Netzwerkfehler — bitte erneut versuchen.";
  return errorMessage(err, fallback);
}
