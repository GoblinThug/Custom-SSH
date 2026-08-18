import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsProvider } from './i18n/SettingsContext'
import { DrawerPanelSkeleton } from './components/skeleton/DrawerPanelSkeleton'
import { TitleBar } from './components/TitleBar'
import './styles/fonts'
import './styles/chrome.css'
import './styles/archive.css'

const ArchiveApp = lazy(() =>
  import('./ArchiveApp').then((mod) => ({ default: mod.ArchiveApp })),
)

function ArchiveShell() {
  return (
    <div className="archive-app">
      <TitleBar />
      <DrawerPanelSkeleton />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <Suspense fallback={<ArchiveShell />}>
        <ArchiveApp />
      </Suspense>
    </SettingsProvider>
  </StrictMode>,
)
