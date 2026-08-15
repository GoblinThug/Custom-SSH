import { folderColorValue } from '../folderColors'
import { useSettings } from '../i18n/SettingsContext'
import type { ConnectionDraft, ConnectionFolder } from '../types'
import { SelectDropdown } from './SelectDropdown'

type Props = {
  draft: ConnectionDraft
  folders: ConnectionFolder[]
  busy: boolean
  error?: string
  onChange: (draft: ConnectionDraft) => void
  onSave: () => void
  onConnect: () => void
  onDelete?: () => void
  onBrowseKey: () => void
  onClose: () => void
}

export function ConnectionForm({
  draft,
  folders,
  busy,
  error,
  onChange,
  onSave,
  onConnect,
  onDelete,
  onBrowseKey,
  onClose,
}: Props) {
  const { t } = useSettings()

  const update = <K extends keyof ConnectionDraft>(
    key: K,
    value: ConnectionDraft[K],
  ) => {
    onChange({ ...draft, [key]: value })
  }

  return (
    <section className="panel">
      <div className="panel__heading">
        <span className="panel__heading-title">
          {draft.id ? t('editConnection') : t('newConnectionHeading')}
        </span>
        <button
          type="button"
          className="btn-icon panel__close"
          onClick={onClose}
          title={t('close')}
          aria-label={t('close')}
        >
          <svg
            className="btn-icon__svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden
          >
            <path
              d="M6 6L18 18M18 6L6 18"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="form">
        <div className="field">
          <label htmlFor="name">{t('name')}</label>
          <input
            id="name"
            value={draft.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder={t('namePlaceholder')}
          />
        </div>

        <div className="field">
          <label htmlFor="folderId">{t('folder')}</label>
          <SelectDropdown
            id="folderId"
            value={draft.folderId ?? ''}
            onChange={(next) => update('folderId', next ? next : null)}
            options={[
              { value: '', label: t('noFolder') },
              ...folders.map((folder) => ({
                value: folder.id,
                label: folder.name,
                leading: (
                  <span
                    className="folder-dot"
                    style={{ background: folderColorValue(folder.color) }}
                  />
                ),
              })),
            ]}
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="host">{t('host')}</label>
            <input
              id="host"
              value={draft.host}
              onChange={(e) => update('host', e.target.value)}
              placeholder="192.168.1.10"
            />
          </div>
          <div className="field">
            <label htmlFor="port">{t('port')}</label>
            <input
              id="port"
              type="number"
              min={1}
              max={65535}
              value={draft.port}
              onChange={(e) => update('port', Number(e.target.value) || 22)}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="username">{t('username')}</label>
          <input
            id="username"
            value={draft.username}
            onChange={(e) => update('username', e.target.value)}
            placeholder="root"
          />
        </div>

        <div className="field">
          <label htmlFor="authMethod">{t('authentication')}</label>
          <SelectDropdown
            id="authMethod"
            value={draft.authMethod}
            onChange={(next) =>
              update('authMethod', next as ConnectionDraft['authMethod'])
            }
            options={[
              { value: 'password', label: t('authPassword') },
              { value: 'privateKey', label: t('authPrivateKey') },
            ]}
          />
        </div>

        {draft.authMethod === 'password' ? (
          <div className="field">
            <label htmlFor="password">{t('password')}</label>
            <input
              id="password"
              type="password"
              value={draft.password}
              onChange={(e) => update('password', e.target.value)}
              placeholder={draft.id ? t('passwordKeep') : '••••••••'}
              autoComplete="new-password"
            />
          </div>
        ) : (
          <>
            <div className="field-inline">
              <div className="field">
                <label htmlFor="privateKeyPath">{t('privateKey')}</label>
                <input
                  id="privateKeyPath"
                  value={draft.privateKeyPath}
                  onChange={(e) => update('privateKeyPath', e.target.value)}
                  placeholder="C:\Users\...\.ssh\id_rsa"
                />
              </div>
              <button className="btn btn-secondary" type="button" onClick={onBrowseKey}>
                {t('browse')}
              </button>
            </div>
            <div className="field">
              <label htmlFor="passphrase">{t('passphrase')}</label>
              <input
                id="passphrase"
                type="password"
                value={draft.passphrase}
                onChange={(e) => update('passphrase', e.target.value)}
                placeholder={draft.id ? t('passphraseKeep') : undefined}
                autoComplete="new-password"
              />
            </div>
          </>
        )}

        {error ? <div className="error-box">{error}</div> : null}

        <div className="form__actions">
          <div className="form__actions-row">
            <button
              className="btn btn-primary"
              onClick={onConnect}
              disabled={busy}
            >
              {busy ? t('connecting') : t('connect')}
            </button>
            <button className="btn btn-secondary" onClick={onSave} disabled={busy}>
              {t('save')}
            </button>
          </div>
          {draft.id && onDelete ? (
            <div className="form__actions-delete">
              <button className="btn btn-danger" onClick={onDelete} disabled={busy}>
                {t('delete')}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}
