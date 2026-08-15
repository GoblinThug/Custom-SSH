import { useEffect, useState } from 'react'
import {
  bindingFromEvent,
  findHotkeyConflict,
  formatBinding,
  isDefaultBinding,
} from '../hotkeys'
import { useSettings } from '../i18n/SettingsContext'
import type { MessageKey } from '../i18n/messages'
import { HOTKEY_IDS, type HotkeyId } from '../types'

type Props = {
  open: boolean
  onClose: () => void
}

const HOTKEY_LABELS: Record<HotkeyId, MessageKey> = {
  copy: 'hotkeyCopy',
  paste: 'hotkeyPaste',
  selectLine: 'hotkeySelectLine',
  interrupt: 'hotkeyInterrupt',
  suspend: 'hotkeySuspend',
}

function formatMessage(
  template: string,
  values: Record<string, string | number>,
) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  )
}

export function HotkeysPanel({ open, onClose }: Props) {
  const { t, settings, setHotkey, resetHotkey } = useSettings()
  const [recordingId, setRecordingId] = useState<HotkeyId | null>(null)
  const [conflict, setConflict] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setRecordingId(null)
      setConflict(null)
    }
  }, [open])

  useEffect(() => {
    if (!recordingId) return

    const onKeyDown = (ev: KeyboardEvent) => {
      ev.preventDefault()
      ev.stopPropagation()

      if (ev.key === 'Escape') {
        setRecordingId(null)
        setConflict(null)
        return
      }

      const binding = bindingFromEvent(ev)
      if (!binding) return

      const clash = findHotkeyConflict(settings.hotkeys, recordingId, binding)
      if (clash) {
        setConflict(
          formatMessage(t('hotkeysConflict'), {
            action: t(HOTKEY_LABELS[clash]),
          }),
        )
        return
      }

      setHotkey(recordingId, binding)
      setRecordingId(null)
      setConflict(null)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [recordingId, setHotkey, settings.hotkeys, t])

  return (
    <>
      <div
        className={`settings-backdrop${open ? ' is-open' : ''}`}
        onClick={() => {
          if (recordingId) {
            setRecordingId(null)
            setConflict(null)
            return
          }
          onClose()
        }}
      />
      <aside
        className={`settings-panel hotkeys-panel${open ? ' is-open' : ''}`}
        aria-hidden={!open}
      >
        <div className="settings-panel__header">
          <div className="settings-panel__title">{t('hotkeysTitle')}</div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
          >
            {t('settingsDone')}
          </button>
        </div>

        <div className="settings-panel__body">
          <p className="hotkeys-hint">{t('hotkeysHint')}</p>
          {conflict ? <p className="hotkeys-conflict">{conflict}</p> : null}

          <div className="hotkeys-list">
            {HOTKEY_IDS.map((id) => {
              const binding = settings.hotkeys[id]
              const recording = recordingId === id
              const isDefault = isDefaultBinding(id, binding)

              return (
                <div key={id} className="hotkey-row">
                  <div className="hotkey-row__label">{t(HOTKEY_LABELS[id])}</div>
                  <div className="hotkey-row__actions">
                    <button
                      type="button"
                      className={`hotkey-bind${recording ? ' is-recording' : ''}`}
                      onClick={() => {
                        setConflict(null)
                        setRecordingId((current) =>
                          current === id ? null : id,
                        )
                      }}
                    >
                      {recording
                        ? t('hotkeysPress')
                        : formatBinding(binding)}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary hotkey-reset"
                      disabled={isDefault && !recording}
                      title={t('hotkeysReset')}
                      onClick={() => {
                        resetHotkey(id)
                        if (recordingId === id) {
                          setRecordingId(null)
                          setConflict(null)
                        }
                      }}
                    >
                      {t('hotkeysReset')}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </aside>
    </>
  )
}
