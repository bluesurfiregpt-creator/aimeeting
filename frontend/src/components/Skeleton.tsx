/**
 * Tiny skeleton primitives for list/page loading states. We deliberately
 * avoid a generic <Skeleton width=...> abstraction — concrete shapes
 * (SkeletonRow, SkeletonCard) read better and keep markup explicit.
 */

export function SkeletonRow() {
  return (
    <li className="flex items-center justify-between px-4 py-4">
      <div className="flex flex-1 flex-col gap-2">
        <div className="h-3 w-3/5 animate-pulse rounded bg-ink-700" />
        <div className="h-2 w-2/5 animate-pulse rounded bg-ink-800" />
      </div>
      <div className="ml-4 h-2 w-12 animate-pulse rounded bg-ink-800" />
    </li>
  );
}

export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
      <div className="h-3 w-2/5 animate-pulse rounded bg-ink-700" />
      <div className="mt-3 h-2 w-3/5 animate-pulse rounded bg-ink-800" />
      <div className="mt-2 flex gap-2">
        <div className="h-2 w-12 animate-pulse rounded bg-ink-800" />
        <div className="h-2 w-12 animate-pulse rounded bg-ink-800" />
      </div>
    </div>
  );
}

export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-ink-800 rounded-xl border border-ink-700 bg-ink-900">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </ul>
  );
}

export function SkeletonGrid({ items = 4 }: { items?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Array.from({ length: items }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

// v26.13.2-perf: 4-up grid 卡片 占位 — 给 首页 / /meetings/new AI picker 用,
// 跟 v26.12-Home AgentCard 形状 一致 (头像 + 名字 + chip + persona 3 行 + footer).
export function SkeletonAgentCard() {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900 p-4">
      <div className="flex items-start gap-3">
        <div className="h-12 w-12 shrink-0 animate-pulse rounded-full bg-ink-800" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-3/5 animate-pulse rounded bg-ink-700" />
          <div className="h-2 w-2/5 animate-pulse rounded bg-ink-800" />
        </div>
      </div>
      <div className="mt-3 flex gap-1.5">
        <div className="h-3 w-12 animate-pulse rounded-full bg-ink-800" />
        <div className="h-3 w-16 animate-pulse rounded-full bg-ink-800" />
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="h-2 w-full animate-pulse rounded bg-ink-800" />
        <div className="h-2 w-4/5 animate-pulse rounded bg-ink-800" />
        <div className="h-2 w-3/5 animate-pulse rounded bg-ink-800" />
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-ink-800 pt-2">
        <div className="h-2 w-16 animate-pulse rounded bg-ink-800" />
      </div>
    </div>
  );
}

export function SkeletonAgentGrid({ items = 8 }: { items?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: items }).map((_, i) => (
        <SkeletonAgentCard key={i} />
      ))}
    </div>
  );
}
