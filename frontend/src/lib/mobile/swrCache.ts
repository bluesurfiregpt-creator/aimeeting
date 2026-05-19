/**
 * v27.0-mobile P8 · 极简 SWR-like cache.
 *
 * 起因: 公网到 prod 单 request 往返 1.5-3s 抖动严重. 切 BottomNav tab 时
 * 每次都 fresh fetch → 用户每次等 2-3s. 加全局 cache 让切回旧 tab 立刻显
 * stale 数据 + 后台 refresh, 切新 tab 也只首次等.
 *
 * 不引第三方 swr/react-query — 这点需求自己写 30 行够.
 *
 * 用法:
 *   const { data, error, isRefreshing } = useCachedFetch(
 *     "workbench",
 *     () => mApi.getWorkbench(),
 *   );
 *
 * 强制刷新 (调 API 后):
 *   invalidateCache("workbench")  // 下次切到时重新拉
 *   mutateCache("workbench", newData)  // 直接更新 cache (乐观更新)
 */

import { useCallback, useEffect, useRef, useState } from "react";

type CacheEntry<T> = {
  data: T;
  ts: number;  // 拉到时间戳
};

const cache = new Map<string, CacheEntry<unknown>>();
// 订阅者: key → callbacks. mutateCache / invalidateCache 时触发, 让所有
// useCachedFetch 实例立刻看到新 data, 不需要重新发 network request.
const subscribers = new Map<string, Set<() => void>>();

function notify(key: string): void {
  const set = subscribers.get(key);
  if (!set) return;
  for (const cb of set) {
    try {
      cb();
    } catch {
      // 单 sub 错误不应影响其他
    }
  }
}

/** 全局清缓存 (例: 登出时调) — 通知所有 sub 重新拉 */
export function clearAllCache(): void {
  const keys = Array.from(cache.keys());
  cache.clear();
  for (const k of keys) notify(k);
}

/** 标某 key 失效 — 下次 useCachedFetch 切到时重新拉 */
export function invalidateCache(key: string): void {
  cache.delete(key);
  notify(key);
}

/** 直接写 cache (乐观更新). 通知所有 sub 立即 setData. */
export function mutateCache<T>(key: string, data: T): void {
  cache.set(key, { data, ts: Date.now() });
  notify(key);
}

/** 读 cache 但不触发拉 — 给 mutate 时拼新 data 用 */
export function peekCache<T>(key: string): T | undefined {
  const entry = cache.get(key);
  return entry?.data as T | undefined;
}

/** 内部 — 让 useCachedFetch 订阅. 返回 unsubscribe. */
function subscribeKey(key: string, cb: () => void): () => void {
  let set = subscribers.get(key);
  if (!set) {
    set = new Set();
    subscribers.set(key, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) subscribers.delete(key);
  };
}

/**
 * SWR-like fetch hook.
 *
 * 行为:
 *   1. 挂载时若 cache 命中, 立刻 setData(cached) — 0ms 可见.
 *   2. 同时后台 fetch 拿最新数据.
 *   3. 拉到后写 cache + setData. UI 切换 stale → fresh.
 *
 * 注意: fetcher 用 useRef 锁定, 避免 inline 闭包导致每次 render 都重新拉.
 */
export function useCachedFetch<T>(
  key: string | null,  // null 时跳过 (例: 等 id 决定才 fetch)
  fetcher: () => Promise<T>,
): {
  data: T | null;
  error: string | null;
  isRefreshing: boolean;
  refetch: () => void;
} {
  const [data, setData] = useState<T | null>(() => {
    if (!key) return null;
    return (peekCache<T>(key) ?? null);
  });
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // fetcher 用 ref 防止每次 render 都 trigger
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  // refetch 触发 — bump 一个 ref-based counter 让 effect re-run
  const [refetchKey, setRefetchKey] = useState(0);
  const refetch = useCallback(() => {
    if (key) invalidateCache(key);
    setRefetchKey((k) => k + 1);
  }, [key]);

  useEffect(() => {
    if (!key) {
      setData(null);
      setError(null);
      setIsRefreshing(false);
      return;
    }
    let cancelled = false;
    // 1. cache hit 立刻显 (避免初始空白闪烁)
    const cached = peekCache<T>(key);
    if (cached !== undefined) {
      setData(cached);
      setError(null);
    }
    // 2. 订阅 cache 变更 — 其他地方 mutateCache 时本 hook 自动更新
    const unsub = subscribeKey(key, () => {
      const next = peekCache<T>(key);
      if (next !== undefined) {
        setData(next);
        setError(null);
      } else {
        // cache 被 invalidate — 进入 refresh 但不立刻清 data
        // (让用户看 stale 直到 fresh 来)
      }
    });
    // 3. 后台 fetch (即使 cache 命中也拉一次保新)
    setIsRefreshing(true);
    fetcherRef
      .current()
      .then((d) => {
        if (cancelled) return;
        // mutateCache 会触发 subscribeKey 里的 cb → setData
        // 这里不重复 setData. 但 setError(null) 还是要的.
        mutateCache(key, d);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setIsRefreshing(false);
      });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [key, refetchKey]);

  return { data, error, isRefreshing, refetch };
}
