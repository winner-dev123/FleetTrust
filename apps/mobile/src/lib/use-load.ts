import { useCallback, useEffect, useRef, useState } from "react";

export type Load<T> =
  | { status: "loading"; data: undefined; error: undefined }
  | { status: "ready"; data: T; error: undefined }
  | { status: "error"; data: undefined; error: unknown };

const LOADING = { status: "loading", data: undefined, error: undefined } as const;

/**
 * Runs `load` when `key` changes and keeps the latest result. Results from superseded runs are
 * dropped, so a slow earlier response can't overwrite a newer one. `reload()` keeps showing the
 * current data until the fresh result arrives (no flash of "Loading…" after an action).
 */
export function useLoad<T>(
  load: () => Promise<T>,
  key: string,
): Load<T> & { reload: () => void; setData: (data: T) => void } {
  const [state, setState] = useState<{ key: string | null; result: Load<T> }>({
    key: null,
    result: LOADING,
  });
  const [nonce, setNonce] = useState(0);
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  });

  useEffect(() => {
    let active = true;
    loader.current().then(
      (data) => {
        if (active) setState({ key, result: { status: "ready", data, error: undefined } });
      },
      (error: unknown) => {
        if (active) setState({ key, result: { status: "error", data: undefined, error } });
      },
    );
    return () => {
      active = false;
    };
  }, [key, nonce]);

  const reload = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);
  const setData = useCallback(
    (data: T) => {
      setState({ key, result: { status: "ready", data, error: undefined } });
    },
    [key],
  );

  const result = state.key === key ? state.result : LOADING;
  return { ...result, reload, setData };
}
