import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  defaultHotkeys,
  defaultSettings,
  type AppLocale,
  type AppSettings,
  type AppTheme,
  type CloseAction,
  type HotkeyId,
  type KeyBinding,
} from '../types'
import { translate, type MessageKey } from './messages'

type SettingsContextValue = {
  settings: AppSettings
  locale: AppLocale
  theme: AppTheme
  closeAction: CloseAction
  t: (key: MessageKey) => string
  setLocale: (locale: AppLocale) => void
  setTheme: (theme: AppTheme) => void
  setCloseAction: (closeAction: CloseAction) => void
  setHotkey: (id: HotkeyId, binding: KeyBinding) => void
  resetHotkey: (id: HotkeyId) => void
  ready: boolean
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

function applyTheme(theme: AppTheme) {
  document.documentElement.dataset.theme = theme
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    void window.sshApi.loadSettings().then((loaded) => {
      setSettings(loaded)
      applyTheme(loaded.theme)
      setReady(true)
    })
  }, [])

  useEffect(() => {
    applyTheme(settings.theme)
  }, [settings.theme])

  const persist = useCallback(async (patch: Partial<AppSettings>) => {
    const next = await window.sshApi.saveSettings(patch)
    setSettings(next)
    return next
  }, [])

  const setLocale = useCallback(
    (locale: AppLocale) => {
      void persist({ locale })
    },
    [persist],
  )

  const setTheme = useCallback(
    (theme: AppTheme) => {
      applyTheme(theme)
      void persist({ theme })
    },
    [persist],
  )

  const setCloseAction = useCallback(
    (closeAction: CloseAction) => {
      void persist({ closeAction })
    },
    [persist],
  )

  const setHotkey = useCallback(
    (id: HotkeyId, binding: KeyBinding) => {
      void persist({
        hotkeys: {
          ...settings.hotkeys,
          [id]: binding,
        },
      })
    },
    [persist, settings.hotkeys],
  )

  const resetHotkey = useCallback(
    (id: HotkeyId) => {
      void persist({
        hotkeys: {
          ...settings.hotkeys,
          [id]: defaultHotkeys()[id],
        },
      })
    },
    [persist, settings.hotkeys],
  )

  const t = useCallback(
    (key: MessageKey) => translate(settings.locale, key),
    [settings.locale],
  )

  const value = useMemo(
    () => ({
      settings,
      locale: settings.locale,
      theme: settings.theme,
      closeAction: settings.closeAction,
      t,
      setLocale,
      setTheme,
      setCloseAction,
      setHotkey,
      resetHotkey,
      ready,
    }),
    [
      settings,
      t,
      setLocale,
      setTheme,
      setCloseAction,
      setHotkey,
      resetHotkey,
      ready,
    ],
  )

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  )
}

export function useSettings() {
  const ctx = useContext(SettingsContext)
  if (!ctx) {
    throw new Error('useSettings must be used within SettingsProvider')
  }
  return ctx
}
