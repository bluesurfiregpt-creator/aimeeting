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
