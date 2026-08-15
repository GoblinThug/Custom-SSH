type Props = {
  value?: number
  indeterminate?: boolean
  label?: string
  className?: string
}

export function ProgressBar({
  value = 0,
  indeterminate = false,
  label,
  className,
}: Props) {
  const percent = Math.max(0, Math.min(100, Math.round(value)))
  const rootClass = [
    'progress',
    indeterminate ? 'is-indeterminate' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={rootClass}>
      {label ? <div className="progress__label">{label}</div> : null}
      <div
        className="progress__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : percent}
        aria-label={label}
      >
        <div
          className="progress__bar"
          style={indeterminate ? undefined : { width: `${Math.max(percent, percent > 0 ? 4 : 0)}%` }}
        />
      </div>
    </div>
  )
}
