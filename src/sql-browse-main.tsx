import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsProvider } from './i18n/SettingsContext'
import { DrawerPanelSkeleton } from './components/skeleton/DrawerPanelSkeleton'
import { TitleBar } from './components/TitleBar'
import './styles/fonts'
import './styles/chrome.css'
import './styles/sql-browse.css'

const SqlBrowseApp = lazy(() =>
  import('./SqlBrowseApp').then((mod) => ({ default: mod.SqlBrowseApp })),
)

function SqlBrowseShell() {
  return (
    <div className="sql-browse-app">
      <TitleBar />
      <DrawerPanelSkeleton />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <Suspense fallback={<SqlBrowseShell />}>
        <SqlBrowseApp />
      </Suspense>
    </SettingsProvider>
  </StrictMode>,
)
