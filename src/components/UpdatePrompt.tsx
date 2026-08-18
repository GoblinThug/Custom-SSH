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

type PromptPhase = 'available' | 'downloading' | 'ready' | null

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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
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
  const [phase, setPhase] = useState<PromptPhase>(null)
  const [busy, setBusy] = useState(false)
  // Disk-backed via settings.json (localStorage alone was unreliable across relaunches).
  const skippedVersion = useRef<string | null>(null)
  const skipReady = useRef(false)
  const versionRef = useRef('')

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
    return window.sshApi.onUpdateStatus((next) => {
      setStatus(next)

      if (next.state === 'available') {
        const version = normalizeVersion(next.version)
        versionRef.current = version
        if (skipReady.current && skippedVersion.current === version) {
          return
        }
        setPhase('available')
        return
      }

      if (next.state === 'downloading') {
        setPhase('downloading')
        return
      }

      if (next.state === 'ready') {
        const version = normalizeVersion(next.version)
        versionRef.current = version
        if (skipReady.current && skippedVersion.current === version) {
          return
        }
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

  const onLater = () => {
    if ((phase === 'available' || phase === 'ready') && version) {
      const normalized = normalizeVersion(version)
      skippedVersion.current = normalized
      skipReady.current = true
      void window.sshApi.saveSettings({ skippedUpdateVersion: normalized })
      clearLegacySkippedVersion()
    }
    setPhase(null)
  }

  const manual =
    status.state === 'available' ? Boolean(status.manual) : false

  const onUpdate = async () => {
    setBusy(true)
    try {
      if (manual) {
        await window.sshApi.openReleasesPage()
        setPhase(null)
        return
      }
      setPhase('downloading')
      await window.sshApi.downloadUpdate()
    } finally {
      setBusy(false)
    }
  }

  const onInstall = () => {
    void window.sshApi.installUpdate()
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
        ? t('updatePromptDownloadingTitle')
        : manual
          ? t('updatePromptMessageMac')
          : formatMessage(t('updatePromptMessage'), { version })

  return (
    <div className="update-modal-backdrop" role="presentation">
      <div
        className="update-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="update-prompt-title"
        aria-describedby="update-prompt-desc"
      >
        <div className="update-modal__icon" aria-hidden>
          <UpdateIcon />
        </div>
        <div className="update-modal__body">
          <h2 id="update-prompt-title" className="update-modal__title">
            {title}
          </h2>
          {phase !== 'downloading' ? (
            <p id="update-prompt-desc" className="update-modal__message">
              {message}
            </p>
          ) : null}
          {phase === 'downloading' ? (
            <ProgressBar
              className="update-modal__progress"
              value={percent}
              label={`${percent}%`}
            />
          ) : null}
          {version && phase !== 'downloading' ? (
            <p className="update-modal__version">v{version}</p>
          ) : null}
        </div>
        <div className="update-modal__actions">
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
                onClick={onLater}
              >
                {t('updateLater')}
              </button>
            </>
          ) : null}
          {phase === 'downloading' ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setPhase(null)}
            >
              {t('updateDownloadBackground')}
            </button>
          ) : null}
          {phase === 'ready' ? (
            <>
              <button
                type="button"
                className="btn btn-primary"
                onClick={onInstall}
              >
                {t('updateInstall')}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onLater}
              >
                {t('updateLater')}
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
