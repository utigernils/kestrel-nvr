import { useCallback, useEffect, useRef, useState } from 'react';

interface PollingResult<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Ruft `fetcher` sofort und danach alle `intervalMs` auf. Pausiert, solange der Tab im
 * Hintergrund ist, und verwirft Antworten, die nach dem Unmount eintreffen.
 */
export function usePolling<T>(fetcher: (signal: AbortSignal) => Promise<T>, intervalMs: number, deps: unknown[] = []): PollingResult<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const ctrl = new AbortController();
    let timer: number | undefined;
    let alive = true;
    const run = async () => {
      if (document.hidden) { timer = window.setTimeout(run, intervalMs); return; }
      try {
        const d = await fetcherRef.current(ctrl.signal);
        if (alive) { setData(d); setError(null); }
      } catch (e) {
        if (alive && !ctrl.signal.aborted) setError(e as Error);
      } finally {
        if (alive) { setLoading(false); timer = window.setTimeout(run, intervalMs); }
      }
    };
    run();
    return () => { alive = false; ctrl.abort(); window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, tick, ...deps]);

  const reload = useCallback(() => setTick(t => t + 1), []);
  return { data, error, loading, reload };
}
