import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsProvider } from './i18n/SettingsContext'
import { ViewerSkeleton } from './components/skeleton/ViewerSkeleton'
import { TitleBar } from './components/TitleBar'
import './styles/fonts'
import './styles/chrome.css'
import './styles/viewer.css'

const ViewerApp = lazy(() =>
  import('./ViewerApp').then((mod) => ({ default: mod.ViewerApp })),
)

function ViewerShell() {
  return (
    <div className="viewer-app">
      <TitleBar />
      <ViewerSkeleton />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsProvider>
      <Suspense fallback={<ViewerShell />}>
        <ViewerApp />
      </Suspense>
    </SettingsProvider>
  </StrictMode>,
)
