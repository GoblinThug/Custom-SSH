import { Skeleton } from './Skeleton'

export function EditorSkeleton() {
  return (
    <div className="window-skeleton" aria-busy="true">
      <div className="window-skeleton__toolbar">
        <div className="skeleton-block" style={{ flex: 1 }}>
          <Skeleton className="skeleton--title" width="28%" />
          <Skeleton className="skeleton--line" width="52%" />
        </div>
        <Skeleton className="skeleton--btn" width={88} />
        <Skeleton className="skeleton--btn" width={88} />
      </div>
      <div className="window-skeleton__editor">
        {Array.from({ length: 14 }, (_, i) => (
          <Skeleton
            key={i}
            className="skeleton--line"
            width={`${70 - (i % 4) * 8}%`}
          />
        ))}
      </div>
    </div>
  )
}
