import { Skeleton } from './Skeleton'

export function ConnectionFormSkeleton() {
  return (
    <div className="form-skeleton" aria-busy="true">
      {[0, 1, 2, 3, 4].map((field) => (
        <div key={field} className="form-skeleton__field">
          <Skeleton className="skeleton--line" width="32%" />
          <Skeleton className="skeleton--btn" width="100%" />
        </div>
      ))}
      <div className="skeleton-block skeleton-block--row" style={{ marginTop: 8 }}>
        <Skeleton className="skeleton--btn" width="48%" />
        <Skeleton className="skeleton--btn" width="48%" />
      </div>
    </div>
  )
}
