import { Skeleton } from './Skeleton'

export function DrawerPanelSkeleton() {
  return (
    <div className="drawer-skeleton" aria-busy="true">
      <div className="drawer-skeleton__header">
        <Skeleton className="skeleton--title" width="42%" />
        <Skeleton className="skeleton--circle" width={28} height={28} />
      </div>
      <div className="drawer-skeleton__body">
        {[0, 1, 2].map((section) => (
          <div key={section} className="drawer-skeleton__section">
            <Skeleton className="skeleton--line" width="34%" />
            <Skeleton className="skeleton--btn" width="100%" />
            <Skeleton className="skeleton--btn" width="100%" />
          </div>
        ))}
      </div>
    </div>
  )
}
