import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../i18n/SettingsContext'

type Props = {
  onClose?: () => void
}

export function TitleBar({ onClose }: Props) {
  const { t } = useSettings()
  const [fullscreen, setFullscreen] = useState(false)
  const draggingRef = useRef(false)
  const pendingRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const syncFilled = (filled: boolean) => {
      setFullscreen(filled)
      document.documentElement.classList.toggle('is-maximized', filled)
    }
    void window.sshApi.windowIsFullscreen().then(syncFilled)
    return window.sshApi.onWindowState((state) => {
      syncFilled(state.maximized || state.fullscreen)
    })
  }, [])

  const endDrag = () => {
    pendingRef.current = null
    if (!draggingRef.current) return
    draggingRef.current = false
    document.documentElement.classList.remove('is-dragging-window')
    void window.sshApi.windowEndDrag()
  }

  return (
    <header className="titlebar">
      <div
        className="titlebar__drag"
        onDoubleClick={() => void window.sshApi.windowFullscreenToggle()}
        onPointerDown={(event) => {
          if (event.button !== 0 || !fullscreen) return
          event.currentTarget.setPointerCapture(event.pointerId)
          pendingRef.current = { x: event.screenX, y: event.screenY }
        }}
        onPointerMove={(event) => {
          const pending = pendingRef.current
          if (pending && !draggingRef.current) {
            const dist = Math.hypot(
              event.screenX - pending.x,
              event.screenY - pending.y,
            )
            if (dist < 6) return
            pendingRef.current = null
            draggingRef.current = true
            document.documentElement.classList.add('is-dragging-window')
            void window.sshApi
              .windowRestoreForDrag(event.screenX, event.screenY)
              .then(() => {
                window.sshApi.windowDragTo(event.screenX, event.screenY)
              })
            return
          }
          if (draggingRef.current) {
            window.sshApi.windowDragTo(event.screenX, event.screenY)
          }
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />

      <div className="titlebar__brand">{t('appName')}</div>

      <div className="traffic-lights" aria-label="Window controls">
        <button
          type="button"
          className="traffic-light traffic-light--minimize"
          title={t('windowMinimize')}
          aria-label={t('windowMinimize')}
          onClick={(e) => {
            e.stopPropagation()
            void window.sshApi.windowMinimize()
          }}
        >
          <span className="traffic-light__dot" />
        </button>
        <button
          type="button"
          className="traffic-light traffic-light--maximize"
          title={fullscreen ? t('windowExitFullscreen') : t('windowFullscreen')}
          aria-label={fullscreen ? t('windowExitFullscreen') : t('windowFullscreen')}
          onClick={(e) => {
            e.stopPropagation()
            void window.sshApi.windowFullscreenToggle()
          }}
        >
          <span className="traffic-light__dot" />
        </button>
        <button
          type="button"
          className="traffic-light traffic-light--close"
          title={t('windowClose')}
          aria-label={t('windowClose')}
          onClick={(e) => {
            e.stopPropagation()
            if (onClose) onClose()
            else void window.sshApi.windowClose()
          }}
        >
          <span className="traffic-light__dot" />
        </button>
      </div>
    </header>
  )
}
