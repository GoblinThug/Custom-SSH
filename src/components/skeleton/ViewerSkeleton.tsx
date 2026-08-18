import { Skeleton } from './Skeleton'

export function ViewerSkeleton() {
  return (
    <div className="window-skeleton" aria-busy="true">
      <div className="window-skeleton__toolbar">
        <Skeleton className="skeleton--title" width="36%" />
        <div className="skeleton-block skeleton-block--row">
          <Skeleton className="skeleton--circle" width={32} height={32} />
          <Skeleton className="skeleton--circle" width={32} height={32} />
        </div>
      </div>
      <Skeleton
        className="skeleton"
        style={{ flex: 1, minHeight: 240, borderRadius: 'var(--radius-md)' }}
      />
    </div>
  )
}
