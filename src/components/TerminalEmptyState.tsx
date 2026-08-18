import { useSettings } from '../i18n/SettingsContext'

type Props = {
  connectionLabel?: string
}

export function TerminalEmptyState({ connectionLabel }: Props) {
  const { t } = useSettings()

  return (
    <div className="terminal-wrap">
      <div className="terminal-empty">
        <h2>{t('readyToConnect')}</h2>
        <p>
          {connectionLabel?.trim()
            ? connectionLabel
            : t('readyToConnectHint')}
        </p>
      </div>
    </div>
  )
}
