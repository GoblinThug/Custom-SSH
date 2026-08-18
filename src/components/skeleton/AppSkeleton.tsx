import { Skeleton } from './Skeleton'
import { TerminalSkeleton } from './TerminalSkeleton'

export function AppSkeleton() {
  return (
    <div className="app-skeleton" aria-busy="true">
      <div className="app-skeleton__sidebar">
        <Skeleton className="skeleton--btn" width="100%" />
        <Skeleton className="skeleton--line" width="72%" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="skeleton--line-lg" width={`${88 - i * 4}%`} />
        ))}
      </div>
      <div className="app-skeleton__main">
        <div className="app-skeleton__toolbar">
          <Skeleton className="skeleton--title" width="40%" />
          <Skeleton className="skeleton--line" width="28%" />
        </div>
        <div className="app-skeleton__content">
          <TerminalSkeleton />
        </div>
      </div>
    </div>
  )
}
