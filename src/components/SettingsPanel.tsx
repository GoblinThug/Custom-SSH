import { useEffect, useState } from 'react'
import { APP_LOCALES } from '../i18n/locales'
import { useSettings } from '../i18n/SettingsContext'
import type { AppLocale, AppTheme, Workspace } from '../types'
import { SelectDropdown } from './SelectDropdown'

const GITHUB_URL = 'https://github.com/GoblinThug/CustomSSH'

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

type ImportSource = 'winscp' | 'filezilla' | 'termius' | 'customssh'

type PassphrasePrompt =
  | { mode: 'export'; includePasswords: true }
  | { mode: 'import'; source: 'customssh'; filePath: string }

type Props = {
  open: boolean
  onClose: () => void
  onWorkspaceChange?: (workspace: Workspace) => void
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

export function SettingsPanel({ open, onClose, onWorkspaceChange }: Props) {
  const { t, locale, theme, setLocale, setTheme } = useSettings()
  const [version, setVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    state: 'idle',
  })
  const [busy, setBusy] = useState(false)
  const [dataNote, setDataNote] = useState<string>()
  const [dataError, setDataError] = useState<string>()
  const [secretsLabel, setSecretsLabel] = useState('')
  const [passphrasePrompt, setPassphrasePrompt] =
    useState<PassphrasePrompt | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [importSource, setImportSource] = useState<ImportSource>('winscp')
  const [exportMode, setExportMode] = useState<'with' | 'without'>('without')

  useEffect(() => {
    void window.sshApi.getAppVersion().then(setVersion)
    return window.sshApi.onUpdateStatus(setUpdateStatus)
  }, [])

  useEffect(() => {
    if (!open) return
    void window.sshApi.getSecretsInfo().then((info) => {
      setSecretsLabel(
        info.backend === 'safeStorage'
          ? t('settingsSecretsOk')
          : t('settingsSecretsFallback'),
      )
    })
  }, [open, t])

  useEffect(() => {
    if (!open) {
      setPassphrasePrompt(null)
      setPassphrase('')
      setDataNote(undefined)
      setDataError(undefined)
    }
  }, [open])

  const statusText = (() => {
    switch (updateStatus.state) {
      case 'checking':
        return t('updateChecking')
      case 'available':
        return formatMessage(t('updateAvailable'), {
          version: updateStatus.version,
        })
      case 'not-available':
        return t('updateNotAvailable')
      case 'downloading':
        return formatMessage(t('updateDownloading'), {
          percent: Math.round(updateStatus.percent),
        })
      case 'ready':
        return formatMessage(t('updateReady'), {
          version: updateStatus.version,
        })
      case 'error':
        switch (updateStatus.code) {
          case 'macUnsigned':
            return t('updateErrorMacUnsigned')
          case 'network':
            return t('updateErrorNetwork')
          case 'notFound':
            return t('updateErrorNotFound')
          case 'checksum':
            return t('updateErrorChecksum')
          case 'permission':
            return t('updateErrorPermission')
          default:
            return t('updateErrorGeneric')
        }
      case 'unsupported':
        return updateStatus.reason === 'portable'
          ? t('updatePortable')
          : t('updateDevOnly')
      case 'idle':
      default:
        return ''
    }
  })()

  const checkUpdates = async () => {
    setBusy(true)
    try {
      const status = (await window.sshApi.checkForUpdates()) as UpdateStatus | null
      if (status) setUpdateStatus(status)
    } finally {
      setBusy(false)
    }
  }

  const downloadUpdate = async () => {
    setBusy(true)
    try {
      if (updateStatus.state === 'available' && updateStatus.manual) {
        await window.sshApi.openReleasesPage()
        return
      }
      await window.sshApi.downloadUpdate()
    } finally {
      setBusy(false)
    }
  }

  const runImport = async (
    source: ImportSource,
    options?: { passphrase?: string; filePath?: string },
  ) => {
    setBusy(true)
    setDataNote(undefined)
    setDataError(undefined)
    try {
      const result = await window.sshApi.importWorkspace({
        source,
        passphrase: options?.passphrase,
        filePath: options?.filePath,
      })
      if ('cancelled' in result && result.cancelled) return
      if ('needsPassphrase' in result && result.needsPassphrase) {
        setPassphrase('')
        setPassphrasePrompt({
          mode: 'import',
          source: 'customssh',
          filePath: result.filePath,
        })
        return
      }
      if ('error' in result && result.error) {
        setDataError(`${t('importFailed')}: ${result.error}`)
        return
      }
      if ('workspace' in result) {
        onWorkspaceChange?.(result.workspace)
        setDataNote(
          result.imported > 0
            ? formatMessage(t('importOk'), {
                count: result.imported,
                folders: result.foldersAdded,
              })
            : t('importNone'),
        )
      }
    } finally {
      setBusy(false)
    }
  }

  const runExport = async (includePasswords: boolean, exportPassphrase?: string) => {
    setBusy(true)
    setDataNote(undefined)
    setDataError(undefined)
    try {
      const result = await window.sshApi.exportWorkspace({
        includePasswords,
        passphrase: exportPassphrase,
      })
      if ('cancelled' in result && result.cancelled) return
      if ('error' in result && result.error) {
        setDataError(`${t('exportFailed')}: ${result.error}`)
        return
      }
      if ('path' in result && result.path) {
        setDataNote(formatMessage(t('exportOk'), { path: result.path }))
      }
    } finally {
      setBusy(false)
    }
  }

  const submitPassphrase = () => {
    const prompt = passphrasePrompt
    const value = passphrase
    setPassphrasePrompt(null)
    setPassphrase('')
    if (!prompt || !value.trim()) return
    if (prompt.mode === 'export') {
      void runExport(true, value)
      return
    }
    void runImport('customssh', {
      passphrase: value,
      filePath: prompt.filePath,
    })
  }

  return (
    <>
      <div
        className={`settings-backdrop${open ? ' is-open' : ''}`}
        onClick={onClose}
      />
      <aside
        className={`settings-panel${open ? ' is-open' : ''}`}
        aria-hidden={!open}
      >
        <div className="settings-panel__header">
          <div className="settings-panel__title">{t('settingsTitle')}</div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
          >
            {t('settingsDone')}
          </button>
        </div>

        <div className="settings-panel__body">
          <section className="settings-section">
            <label className="settings-section__label" htmlFor="settings-locale">
              {t('settingsLanguage')}
            </label>
            <SelectDropdown
              id="settings-locale"
              className="select-dropdown--settings"
              value={locale}
              onChange={(next) => setLocale(next as AppLocale)}
              options={APP_LOCALES.map((option) => ({
                value: option.id,
                label: option.label,
              }))}
            />
          </section>

          <section className="settings-section">
            <div className="settings-section__label">{t('settingsTheme')}</div>
            <div className="settings-options" role="radiogroup">
              {(
                [
                  { id: 'dark' as AppTheme, label: t('themeDark') },
                  { id: 'light' as AppTheme, label: t('themeLight') },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={theme === option.id}
                  className={`settings-option${theme === option.id ? ' is-active' : ''}`}
                  onClick={() => setTheme(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </section>

          <div className="settings-panel__bottom">
            <section className="settings-section">
              <div className="settings-section__label">{t('settingsData')}</div>
              <p className="settings-section__hint">{t('settingsDataHint')}</p>
              {secretsLabel ? (
                <p className="settings-section__meta">{secretsLabel}</p>
              ) : null}

              <label
                className="settings-section__sublabel"
                htmlFor="settings-import"
              >
                {t('importSource')}
              </label>
              <div className="settings-data-row">
                <SelectDropdown
                  id="settings-import"
                  className="select-dropdown--settings"
                  value={importSource}
                  disabled={busy}
                  onChange={(next) => setImportSource(next as ImportSource)}
                  options={[
                    { value: 'winscp', label: t('importWinScp') },
                    { value: 'filezilla', label: t('importFileZilla') },
                    { value: 'termius', label: t('importTermius') },
                    { value: 'customssh', label: t('importCustomSsh') },
                  ]}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => void runImport(importSource)}
                >
                  {t('importAction')}
                </button>
              </div>

              <label
                className="settings-section__sublabel"
                htmlFor="settings-export"
              >
                {t('exportMode')}
              </label>
              <div className="settings-data-row">
                <SelectDropdown
                  id="settings-export"
                  className="select-dropdown--settings"
                  value={exportMode}
                  disabled={busy}
                  onChange={(next) => setExportMode(next as 'with' | 'without')}
                  options={[
                    { value: 'without', label: t('exportWithoutPasswords') },
                    { value: 'with', label: t('exportWithPasswords') },
                  ]}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => {
                    if (exportMode === 'with') {
                      setPassphrase('')
                      setPassphrasePrompt({
                        mode: 'export',
                        includePasswords: true,
                      })
                      return
                    }
                    void runExport(false)
                  }}
                >
                  {t('exportAction')}
                </button>
              </div>

              {dataNote ? (
                <div className="settings-data-note">{dataNote}</div>
              ) : null}
              {dataError ? <div className="error-box">{dataError}</div> : null}
            </section>

            <section className="settings-section">
              <div className="settings-section__label">{t('settingsUpdates')}</div>
              <div className="settings-update">
                <div className="settings-update__status">{statusText}</div>
                <div className="settings-update__actions">
                  {updateStatus.state === 'available' ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => void downloadUpdate()}
                    >
                      {updateStatus.manual
                        ? t('updateOpenReleases')
                        : t('updateDownload')}
                    </button>
                  ) : null}
                  {updateStatus.state === 'ready' ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void window.sshApi.installUpdate()}
                    >
                      {t('updateInstall')}
                    </button>
                  ) : null}
                  {updateStatus.state !== 'available' &&
                  updateStatus.state !== 'ready' &&
                  updateStatus.state !== 'downloading' ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={busy || updateStatus.state === 'checking'}
                      onClick={() => void checkUpdates()}
                    >
                      {t('updateCheck')}
                    </button>
                  ) : null}
                </div>
              </div>
            </section>

            <section className="settings-section">
              <div className="settings-section__label">{t('settingsAbout')}</div>
              <p className="settings-version">
                CustomSSH{' '}
                <span className="settings-version__num">
                  {version ? `v${version}` : '…'}
                </span>
              </p>
              <button
                type="button"
                className="settings-link"
                onClick={() => void window.sshApi.openExternal(GITHUB_URL)}
                title={GITHUB_URL}
              >
                <svg
                  className="settings-link__icon"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden
                >
                  <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.009-.868-.014-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.523 2 12 2Z" />
                </svg>
                <span className="settings-link__text">{t('settingsGithub')}</span>
              </button>
            </section>
          </div>
        </div>
      </aside>

      {passphrasePrompt ? (
        <div className="update-modal-backdrop" role="presentation">
          <div
            className="update-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="passphrase-title"
          >
            <div className="update-modal__body">
              <h2 id="passphrase-title" className="update-modal__title">
                {passphrasePrompt.mode === 'export'
                  ? t('exportPassphrasePrompt')
                  : t('importPassphrasePrompt')}
              </h2>
              <p className="update-modal__message">
                {passphrasePrompt.mode === 'export'
                  ? t('exportPassphraseHint')
                  : t('importPassphraseHint')}
              </p>
              <div className="field" style={{ marginTop: 12 }}>
                <input
                  type="password"
                  autoFocus
                  value={passphrase}
                  onChange={(ev) => setPassphrase(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') {
                      ev.preventDefault()
                      submitPassphrase()
                    }
                    if (ev.key === 'Escape') {
                      ev.preventDefault()
                      setPassphrasePrompt(null)
                      setPassphrase('')
                    }
                  }}
                />
              </div>
            </div>
            <div className="update-modal__actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={!passphrase.trim()}
                onClick={submitPassphrase}
              >
                {t('passphraseContinue')}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setPassphrasePrompt(null)
                  setPassphrase('')
                }}
              >
                {t('passphraseCancel')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
