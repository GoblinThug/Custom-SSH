import { createRoot } from 'react-dom/client'
import App from './App'
import { SettingsProvider } from './i18n/SettingsContext'
import { bindWindowFx } from './windowFx'
import './styles/global.css'

bindWindowFx()

createRoot(document.getElementById('root')!).render(
  <SettingsProvider>
    <App />
  </SettingsProvider>,
)
