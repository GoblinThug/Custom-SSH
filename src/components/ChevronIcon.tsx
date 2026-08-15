type Props = {
  open?: boolean
  className?: string
}

/** Shared disclosure chevron: points right when closed, down when open. */
export function ChevronIcon({ open = false, className }: Props) {
  return (
    <svg
      className={['chevron-icon', open ? 'is-open' : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden
    >
      <path
        d="M3.5 2.25L6.5 5L3.5 7.75"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
