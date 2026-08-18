import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsProvider } from './i18n/SettingsContext'
import { Skeleton } from './components/skeleton/Skeleton'
import './styles/fonts'
import './styles/chrome.css'
import './styles/tray.css'

const TrayPopup = lazy(() =>
  import('./TrayPopup').then((mod) => ({ default: mod.TrayPopup })),
)

function TraySkeleton() {
  return (
    <div className="tray-popup" aria-busy="true">
      <div className="skeleton-block" style={{ padding: 12, gap: 8 }}>
        <Skeleton className="skeleton--line-lg" width="70%" />
        <Skeleton className="skeleton--line" width="90%" />
        <Skeleton className="skeleton--line" width="82%" />
        <Skeleton className="skeleton--line" width="76%" />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <SettingsProvider>
    <Suspense fallback={<TraySkeleton />}>
      <TrayPopup />
    </Suspense>
  </SettingsProvider>,
)
