import { type ReactNode } from 'react'

type Props = {
  titleId: string
  descId: string
  title: string
  message: string
  icon: ReactNode
  actionsClassName?: string
  onBackdrop: () => void
  children: ReactNode
}

export function AppModal({
  titleId,
  descId,
  title,
  message,
  icon,
  actionsClassName,
  onBackdrop,
  children,
}: Props) {
  return (
    <div
      className="update-modal-backdrop"
      role="presentation"
      onClick={onBackdrop}
    >
      <div
        className="update-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onClick={(ev) => ev.stopPropagation()}
      >
        <div className="update-modal__icon" aria-hidden>
          {icon}
        </div>
        <div className="update-modal__body">
          <h2 id={titleId} className="update-modal__title">
            {title}
          </h2>
          <p id={descId} className="update-modal__message">
            {message}
          </p>
        </div>
        <div
          className={
            actionsClassName ?? 'update-modal__actions'
          }
        >
          {children}
        </div>
      </div>
    </div>
  )
}
