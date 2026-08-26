import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../i18n/SettingsContext'
import { formatMessage } from '../utils/formatMessage'
import { ProgressBar } from './ProgressBar'

type UpdateStatus =
  | { state: 'idle' }
  | { state: 'unsupported'; reason: 'dev' | 'portable' | 'macUnsigned' }
  | { state: 'checking' }
  | {
      state: 'available'
      version: string
      releaseNotes?: string
      manual?: boolean
    }
  | { state: 'not-available'; version: string }
  | { state: 'downloading'; percent: number; transferred: number; total: number }
  | { state: 'ready'; version: string }
  | {
      state: 'error'
      code:
        | 'macUnsigned'
        | 'network'
        | 'notFound'
        | 'checksum'
        | 'permission'
        | 'generic'
    }

type ToastPhase = 'available' | 'downloading' | 'ready' | null

const LEGACY_SKIP_AVAILABLE_KEY = 'customssh.update.skipAvailable'
const LEGACY_SKIP_READY_KEY = 'customssh.update.skipReady'

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '')
}

function readLegacySkippedVersion(): string | null {
  try {
    const available = localStorage.getItem(LEGACY_SKIP_AVAILABLE_KEY)
    const ready = localStorage.getItem(LEGACY_SKIP_READY_KEY)
    const raw = available || ready
    return raw ? normalizeVersion(raw) : null
  } catch {
    return null
  }
}

function clearLegacySkippedVersion() {
  try {
    localStorage.removeItem(LEGACY_SKIP_AVAILABLE_KEY)
    localStorage.removeItem(LEGACY_SKIP_READY_KEY)
  } catch {
    // ignore
  }
}

function UpdateIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 4v10m0 0l-3.5-3.5M12 14l3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 16.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function UpdatePrompt() {
  const { t } = useSettings()
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })
  const [phase, setPhase] = useState<ToastPhase>(null)
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState(false)
  // Disk-backed via settings.json (localStorage alone was unreliable across relaunches).
  const skippedVersion = useRef<string | null>(null)
  const skipReady = useRef(false)
  const versionRef = useRef('')
  const leaveTimer = useRef<number | null>(null)

  useEffect(() => {
    void window.sshApi.loadSettings().then((settings) => {
      const fromSettings = settings.skippedUpdateVersion
        ? normalizeVersion(settings.skippedUpdateVersion)
        : null
      const fromLegacy = readLegacySkippedVersion()
      const skipped = fromSettings || fromLegacy
      skippedVersion.current = skipped
      skipReady.current = true

      if (!fromSettings && fromLegacy) {
        void window.sshApi.saveSettings({ skippedUpdateVersion: fromLegacy })
        clearLegacySkippedVersion()
      }
    })
  }, [])

  useEffect(() => {
    return () => {
      if (leaveTimer.current != null) window.clearTimeout(leaveTimer.current)
    }
  }, [])

  const dismissToast = (persistSkip: boolean) => {
    if (persistSkip && versionRef.current) {
      const normalized = normalizeVersion(versionRef.current)
      skippedVersion.current = normalized
      skipReady.current = true
      void window.sshApi.saveSettings({ skippedUpdateVersion: normalized })
      clearLegacySkippedVersion()
    }
    setLeaving(true)
    if (leaveTimer.current != null) window.clearTimeout(leaveTimer.current)
    leaveTimer.current = window.setTimeout(() => {
      setPhase(null)
      setLeaving(false)
      setBusy(false)
      leaveTimer.current = null
    }, 220)
  }

  useEffect(() => {
    return window.sshApi.onUpdateStatus((next) => {
      setStatus(next)

      if (next.state === 'available') {
        const version = normalizeVersion(next.version)
        versionRef.current = version
        if (skipReady.current && skippedVersion.current === version) {
          return
        }
        setLeaving(false)
        setPhase('available')
        return
      }

      if (next.state === 'downloading') {
        setLeaving(false)
        setPhase('downloading')
        return
      }

      if (next.state === 'ready') {
        const version = normalizeVersion(next.version)
        versionRef.current = version
        if (skipReady.current && skippedVersion.current === version) {
          return
        }
        setLeaving(false)
        setPhase('ready')
        return
      }

      if (
        next.state === 'not-available' ||
        next.state === 'unsupported' ||
        next.state === 'idle' ||
        next.state === 'error'
      ) {
        setPhase(null)
        setLeaving(false)
        setBusy(false)
      }
    })
  }, [])

  if (!phase) return null

  const version =
    status.state === 'available' ||
    status.state === 'ready' ||
    status.state === 'not-available'
      ? normalizeVersion(status.version)
      : versionRef.current

  const percent =
    status.state === 'downloading' ? Math.round(status.percent) : 0

  const manual =
    status.state === 'available' ? Boolean(status.manual) : false

  const onUpdate = async () => {
    setBusy(true)
    try {
      if (manual) {
        await window.sshApi.openReleasesPage()
        dismissToast(false)
        return
      }
      setPhase('downloading')
      await window.sshApi.downloadUpdate()
    } finally {
      setBusy(false)
    }
  }

  const title =
    phase === 'ready'
      ? t('updatePromptReadyTitle')
      : phase === 'downloading'
        ? t('updatePromptDownloadingTitle')
        : t('updatePromptTitle')

  const message =
    phase === 'ready'
      ? formatMessage(t('updatePromptReadyMessage'), { version })
      : phase === 'downloading'
        ? formatMessage(t('updateDownloading'), { percent })
        : manual
          ? t('updatePromptMessageMac')
          : formatMessage(t('updatePromptMessage'), { version })

  return (
    <div
      className={`update-toast${leaving ? ' is-leaving' : ''}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="update-toast__icon" aria-hidden>
        <UpdateIcon />
      </div>
      <div className="update-toast__body">
        <div className="update-toast__title">{title}</div>
        <p className="update-toast__message">{message}</p>
        {phase === 'downloading' ? (
          <ProgressBar
            className="update-toast__progress"
            value={percent}
            label={`${percent}%`}
          />
        ) : null}
        {version && phase !== 'downloading' ? (
          <div className="update-toast__version">v{version}</div>
        ) : null}
        <div className="update-toast__actions">
          {phase === 'available' ? (
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void onUpdate()}
              >
                {manual ? t('updateOpenReleases') : t('updatePromptYes')}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => dismissToast(true)}
              >
                {t('updateLater')}
              </button>
            </>
          ) : null}
          {phase === 'downloading' ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => dismissToast(false)}
            >
              {t('updateDownloadBackground')}
            </button>
          ) : null}
          {phase === 'ready' ? (
            <>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void window.sshApi.installUpdate()}
              >
                {t('updateInstall')}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => dismissToast(true)}
              >
                {t('updateLater')}
              </button>
            </>
          ) : null}
        </div>
      </div>
      <button
        type="button"
        className="update-toast__close"
        aria-label={t('close')}
        title={t('close')}
        onClick={() =>
          dismissToast(phase === 'available' || phase === 'ready')
        }
      >
        ×
      </button>
    </div>
  )
}
