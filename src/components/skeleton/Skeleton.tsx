import type { CSSProperties } from 'react'

type SkeletonProps = {
  className?: string
  style?: CSSProperties
  width?: string | number
  height?: string | number
}

export function Skeleton({
  className = '',
  style,
  width,
  height,
}: SkeletonProps) {
  return (
    <span
      className={`skeleton ${className}`.trim()}
      style={{
        width,
        height,
        ...style,
      }}
      aria-hidden
    />
  )
}
