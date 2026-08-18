import { Skeleton } from './Skeleton'

const INDENTS = [0, 16, 32, 16, 32, 48, 32, 16]

export function FileTreeSkeleton() {
  return (
    <div className="file-tree-skeleton" aria-busy="true">
      <div className="file-tree-skeleton__header">
        <Skeleton className="skeleton--title" width="55%" />
        <Skeleton className="skeleton--btn" width="100%" />
      </div>
      <div className="file-tree-skeleton__body">
        {INDENTS.map((indent, index) => (
          <div
            key={index}
            className="file-tree-skeleton__row"
            style={{ paddingLeft: 8 + indent }}
          >
            <Skeleton className="skeleton--circle" width={14} height={14} />
            <Skeleton
              className="skeleton--line"
              width={`${48 + (index % 3) * 12}%`}
            />
          </div>
        ))}
      </div>
      <div className="drawer-skeleton__body" style={{ paddingTop: 10 }}>
        <Skeleton className="skeleton--btn" width="100%" />
      </div>
    </div>
  )
}
