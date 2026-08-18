import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsProvider } from './i18n/SettingsContext'
import { bindWindowFx } from './windowFx'
import { AppSkeleton } from './components/skeleton/AppSkeleton'
import { TitleBar } from './components/TitleBar'
import './styles/fonts'
import './styles/chrome.css'
import './styles/app.css'

const App = lazy(() => import('./App'))

bindWindowFx()

function MainShell() {
  return (
    <div className="app">
      <TitleBar />
      <div className="app__main">
        <AppSkeleton />
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <SettingsProvider>
    <Suspense fallback={<MainShell />}>
      <App />
    </Suspense>
  </SettingsProvider>,
)
