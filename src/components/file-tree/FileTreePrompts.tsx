import type { Dispatch, SetStateAction } from 'react'
import type { MessageKey } from '../../i18n/messages'

export type NamePrompt = {
  mode: 'mkdir' | 'mkfile' | 'rename'
  parentPath: string
  fromPath?: string
  value: string
}

export type ConfirmPrompt = {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  action:
    | { type: 'delete'; paths: string[] }
    | {
        type: 'move'
        moves: Array<{ from: string; to: string }>
        targetDir: string
      }
}

type Props = {
  busy: boolean
  namePrompt: NamePrompt | null
  confirmPrompt: ConfirmPrompt | null
  t: (key: MessageKey) => string
  setNamePrompt: Dispatch<SetStateAction<NamePrompt | null>>
  setConfirmPrompt: Dispatch<SetStateAction<ConfirmPrompt | null>>
  onSubmitName: () => void
  onSubmitConfirm: () => void
}

export function FileTreePrompts({
  busy,
  namePrompt,
  confirmPrompt,
  t,
  setNamePrompt,
  setConfirmPrompt,
  onSubmitName,
  onSubmitConfirm,
}: Props) {
  return (
    <>
      {namePrompt ? (
        <div className="file-tree-prompt-backdrop" role="presentation">
          <div
            className="file-tree-prompt"
            role="dialog"
            aria-modal="true"
            aria-labelledby="file-tree-prompt-title"
          >
            <div className="field">
              <label htmlFor="file-tree-prompt-name" id="file-tree-prompt-title">
                {namePrompt.mode === 'mkdir'
                  ? t('fileFolderNamePrompt')
                  : namePrompt.mode === 'mkfile'
                    ? t('fileFileNamePrompt')
                    : t('fileNamePrompt')}
              </label>
              <input
                id="file-tree-prompt-name"
                autoFocus
                value={namePrompt.value}
                disabled={busy}
                onChange={(event) =>
                  setNamePrompt((prev) =>
                    prev ? { ...prev, value: event.target.value } : prev,
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void onSubmitName()
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setNamePrompt(null)
                  }
                }}
              />
            </div>
            <div className="file-tree-prompt__actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !namePrompt.value.trim()}
                onClick={() => void onSubmitName()}
              >
                {t('confirm')}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setNamePrompt(null)}
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmPrompt ? (
        <div
          className="file-tree-prompt-backdrop"
          role="presentation"
          onClick={() => {
            if (!busy) setConfirmPrompt(null)
          }}
        >
          <div
            className="file-tree-prompt"
            role="dialog"
            aria-modal="true"
            aria-labelledby="file-tree-confirm-title"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !busy) {
                event.preventDefault()
                setConfirmPrompt(null)
              }
              if (event.key === 'Enter' && !busy) {
                event.preventDefault()
                void onSubmitConfirm()
              }
            }}
          >
            <div className="field">
              <div id="file-tree-confirm-title" className="file-tree-prompt__title">
                {confirmPrompt.title}
              </div>
              <p className="file-tree-prompt__message">{confirmPrompt.message}</p>
            </div>
            <div className="file-tree-prompt__actions">
              <button
                type="button"
                className={`btn ${confirmPrompt.danger ? 'btn-danger' : 'btn-primary'}`}
                disabled={busy}
                autoFocus
                onClick={() => void onSubmitConfirm()}
              >
                {confirmPrompt.confirmLabel}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setConfirmPrompt(null)}
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
