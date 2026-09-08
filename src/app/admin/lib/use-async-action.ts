"use client";

// useAsyncAction — pending/error state for a button-triggered async call, with
// a stale-result guard (a slower earlier call can't overwrite a newer one) and
// an unmount guard. Errors surface as a toast by default.

import * as React from "react";
import { toast } from "../ui/toast";
import { errorMessage } from "./admin-fetch";

export interface AsyncActionOptions<R> {
  onSuccess?: (result: R) => void;
  onError?: (err: unknown) => void;
  /** false disables the error toast; a string replaces its title. */
  errorToast?: boolean | string;
  successToast?: string | ((result: R) => string);
}

export interface AsyncAction<A extends unknown[], R> {
  run: (...args: A) => Promise<R | undefined>;
  pending: boolean;
  error: string | null;
  reset: () => void;
}

export function useAsyncAction<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  options: AsyncActionOptions<R> = {}
): AsyncAction<A, R> {
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const latest = React.useRef(0);
  const mounted = React.useRef(true);
  const fnRef = React.useRef(fn);
  const optionsRef = React.useRef(options);

  React.useEffect(() => {
    fnRef.current = fn;
    optionsRef.current = options;
  });

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = React.useCallback(async (...args: A): Promise<R | undefined> => {
    const id = ++latest.current;
    setPending(true);
    setError(null);
    try {
      const result = await fnRef.current(...args);
      if (mounted.current && id === latest.current) {
        setPending(false);
        const { onSuccess, successToast } = optionsRef.current;
        onSuccess?.(result);
        if (successToast) {
          toast({
            variant: "success",
            title: typeof successToast === "function" ? successToast(result) : successToast,
          });
        }
      }
      return result;
    } catch (err) {
      if (mounted.current && id === latest.current) {
        setPending(false);
        const message = errorMessage(err);
        setError(message);
        const { onError, errorToast = true } = optionsRef.current;
        if (errorToast) {
          toast({
            variant: "error",
            title: typeof errorToast === "string" ? errorToast : "Aktion fehlgeschlagen",
            description: message,
          });
        }
        onError?.(err);
      }
      return undefined;
    }
  }, []);

  const reset = React.useCallback(() => setError(null), []);
  return { run, pending, error, reset };
}
