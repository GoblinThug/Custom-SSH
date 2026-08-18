import { Skeleton } from './Skeleton'

export function TerminalSkeleton() {
  return (
    <div className="terminal-skeleton" aria-busy="true" aria-label="Loading terminal">
      <Skeleton className="skeleton--line-lg" width="38%" />
      <div className="terminal-skeleton__lines">
        <Skeleton className="skeleton--line" width="72%" />
        <Skeleton className="skeleton--line" width="54%" />
        <Skeleton className="skeleton--line" width="61%" />
        <Skeleton className="skeleton--line" width="48%" />
        <Skeleton className="skeleton--line" width="66%" />
        <Skeleton className="skeleton--line" width="40%" />
      </div>
    </div>
  )
}
