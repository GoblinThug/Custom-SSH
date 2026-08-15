import { useEffect, useState } from 'react'
import { useSettings } from '../i18n/SettingsContext'

type Props = {
  onClose?: () => void
}

export function TitleBar({ onClose }: Props) {
  const { t } = useSettings()
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    void window.sshApi.windowIsFullscreen().then(setFullscreen)
    return window.sshApi.onWindowState((state) => {
      setFullscreen(state.fullscreen)
    })
  }, [])

  return (
    <header className="titlebar">
      <div
        className="titlebar__drag"
        onDoubleClick={() => void window.sshApi.windowFullscreenToggle()}
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
