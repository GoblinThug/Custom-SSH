import { useEffect, useRef, useState } from 'react'
import { useSettings } from '../i18n/SettingsContext'

export function useQuitPrompt() {
  const { closeAction } = useSettings()
  const closeActionRef = useRef(closeAction)
  closeActionRef.current = closeAction
  const [quitPromptOpen, setQuitPromptOpen] = useState(false)

  useEffect(() => {
    const root = document.documentElement
    const syncChrome = (state: { maximized: boolean; fullscreen: boolean }) => {
      root.classList.toggle(
        'is-maximized',
        state.maximized || state.fullscreen,
      )
    }
    void window.sshApi.windowIsFullscreen().then((fullscreen) => {
      syncChrome({ maximized: false, fullscreen })
    })
    return window.sshApi.onWindowState((state) => {
      syncChrome(state)
    })
  }, [])

  useEffect(() => {
    return window.sshApi.onWindowCloseRequest(() => {
      const action = closeActionRef.current
      if (action === 'tray') {
        void window.sshApi.windowHideToTray()
        return
      }
      if (action === 'quit') {
        void window.sshApi.windowQuitApp()
        return
      }
      setQuitPromptOpen(true)
    })
  }, [])

  useEffect(() => {
    if (!quitPromptOpen) return
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault()
        setQuitPromptOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [quitPromptOpen])

  const hideToTray = () => {
    setQuitPromptOpen(false)
    void window.sshApi.windowHideToTray()
  }

  const quitApp = () => {
    setQuitPromptOpen(false)
    void window.sshApi.windowQuitApp()
  }

  return { quitPromptOpen, setQuitPromptOpen, hideToTray, quitApp }
}
