import { createRoot } from 'react-dom/client'
import { EditorApp } from './EditorApp'
import { SettingsProvider } from './i18n/SettingsContext'
import { bindWindowFx } from './windowFx'
import './styles/global.css'

bindWindowFx()

createRoot(document.getElementById('root')!).render(
  <SettingsProvider>
    <EditorApp />
  </SettingsProvider>,
)
