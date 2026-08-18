import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsProvider } from './i18n/SettingsContext'
import { ViewerApp } from './ViewerApp'
import './styles/global.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <ViewerApp />
    </SettingsProvider>
  </StrictMode>,
)
