import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import appIcon from '../build/icon.png'
import { ChevronIcon } from './components/ChevronIcon'
import { folderColorValue } from './folderColors'
import { useSettings } from './i18n/SettingsContext'

export type TraySessionInfo = {
  sessionId: string
  label: string
  title: string
  status: 'connecting' | 'connected' | 'reconnecting'
  connectionId?: string
}

export type TrayConnectionInfo = {
  id: string
  name: string
  host: string
  port: number
  username: string
  folderColor?: string | null
}

export type TrayPopupState = {
  sessions: TraySessionInfo[]
  connections: TrayConnectionInfo[]
}

const emptyState: TrayPopupState = { sessions: [], connections: [] }

export function TrayPopup() {
  const { t, theme } = useSettings()
  const [state, setState] = useState<TrayPopupState>(emptyState)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    void window.sshApi.trayGetState().then(setState)
    return window.sshApi.onTrayState(setState)
  }, [])

  useEffect(() => {
    const report = () => {
      const root = document.getElementById('root')
      if (!root) return
      const rect = root.getBoundingClientRect()
      void window.sshApi.traySetPopupHeight(Math.ceil(rect.height))
    }
    report()
    const frame = window.requestAnimationFrame(report)
    return () => window.cancelAnimationFrame(frame)
  }, [state, theme])

  const activeSessions = useMemo(
    () =>
      state.sessions.filter(
        (session) =>
          session.status === 'connected' ||
          session.status === 'connecting' ||
          session.status === 'reconnecting',
      ),
    [state.sessions],
  )
  const connected = activeSessions.some((session) => session.status === 'connected')
  const primary = activeSessions[0]

  const statusLabel = !primary
    ? t('trayStatusOffline')
    : primary.status === 'connecting'
      ? t('statusConnecting')
              : primary.status === 'reconnecting'
                ? t('statusConnecting')
                : t('trayStatusOnline')

  return (
    <div className="tray-popup" data-connected={connected ? '1' : '0'}>
      <header className="tray-popup__header">
        <div className="tray-popup__brand">
          <img
            className="tray-popup__logo"
            src={appIcon}
            alt=""
            width={28}
            height={28}
            draggable={false}
          />
          <div>
            <div className="tray-popup__title">{t('appName')}</div>
            <div className="tray-popup__status-row">
              <span
                className={`tray-popup__dot${connected ? ' is-on' : ''}${
                  primary?.status === 'connecting' ||
                  primary?.status === 'reconnecting'
                    ? ' is-busy'
                    : ''
                }`}
              />
              <span className="tray-popup__status">{statusLabel}</span>
            </div>
          </div>
        </div>
        <button
          type="button"
          className="tray-popup__close"
          title={t('close')}
          aria-label={t('close')}
          onClick={() => void window.sshApi.trayHidePopup()}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path
              d="M3 3l6 6M9 3L3 9"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      {activeSessions.length > 0 ? (
        <section className="tray-popup__section">
          <div className="tray-popup__section-label">{t('trayActiveSessions')}</div>
          <div className="tray-popup__list">
            {activeSessions.map((session) => (
              <div key={session.sessionId} className="tray-popup__session">
                <div className="tray-popup__session-text">
                  <div className="tray-popup__session-name">
                    {session.title || session.label}
                  </div>
                  <div className="tray-popup__session-meta">{session.label}</div>
                </div>
                <button
                  type="button"
                  className="tray-popup__ghost"
                  title={t('disconnect')}
                  aria-label={t('disconnect')}
                  onClick={() =>
                    void window.sshApi.trayDisconnect(session.sessionId)
                  }
                >
                  {t('disconnect')}
                </button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="tray-popup__section">
        <div className="tray-popup__section-label">{t('trayNavigation')}</div>
        <button
          type="button"
          className="tray-popup__nav"
          onClick={() => void window.sshApi.trayOpenApp()}
        >
          <span>{t('trayOpenApp')}</span>
          <span className="tray-popup__chevron" aria-hidden>
            <ChevronIcon />
          </span>
        </button>
      </section>

      <section className="tray-popup__section">
        <div className="tray-popup__section-label">{t('trayQuickConnect')}</div>
        {state.connections.length === 0 ? (
          <div className="tray-popup__empty">{t('trayNoConnections')}</div>
        ) : (
          <div className="tray-popup__list tray-popup__list--scroll">
            {state.connections.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`tray-popup__server${
                  item.folderColor ? ' has-folder-color' : ''
                }`}
                style={
                  item.folderColor
                    ? ({
                        '--folder-color': folderColorValue(item.folderColor),
                      } as CSSProperties)
                    : undefined
                }
                onClick={() => void window.sshApi.trayQuickConnect(item.id)}
              >
                <span className="tray-popup__play" aria-hidden>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                    <path
                      d="M21.4086 9.35258C23.5305 10.5065 23.5305 13.4935 21.4086 14.6474L8.59662 21.6145C6.53435 22.736 4 21.2763 4 18.9671L4 5.0329C4 2.72368 6.53435 1.26402 8.59661 2.38548L21.4086 9.35258Z"
                      fill="currentColor"
                    />
                  </svg>
                </span>
                <span className="tray-popup__server-text">
                  <span className="tray-popup__server-name">{item.name}</span>
                  <span className="tray-popup__server-meta">
                    {item.username}@{item.host}:{item.port}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <footer className="tray-popup__footer">
        <button
          type="button"
          className="tray-popup__quit"
          onClick={() => void window.sshApi.trayQuit()}
        >
          {t('quitPromptQuit')}
        </button>
      </footer>
    </div>
  )
}
