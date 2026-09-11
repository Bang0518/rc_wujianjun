import { useEffect, useState, useCallback } from 'react';

/**
 * 定时轮询一个异步数据源。面板对实时性要求不高，轮询足矣，
 * 不引入 WebSocket / SSE（对 MVP 属过度设计）。
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  deps: unknown[] = [],
): { data: T | null; error: string | null; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableFetcher = useCallback(fetcher, deps);

  const load = useCallback(async () => {
    try {
      setData(await stableFetcher());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [stableFetcher]);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      if (active) await load();
    };
    void tick();
    const id = setInterval(() => void tick(), intervalMs);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [load, intervalMs]);

  return { data, error, refresh: () => void load() };
}
