import { createRoot } from 'react-dom/client'
import { TrayPopup } from './TrayPopup'
import { SettingsProvider } from './i18n/SettingsContext'
import './styles/fonts'
import './styles/chrome.css'
import './styles/tray.css'

document.documentElement.classList.add('tray-html')

createRoot(document.getElementById('root')!).render(
  <SettingsProvider>
    <TrayPopup />
  </SettingsProvider>,
)
