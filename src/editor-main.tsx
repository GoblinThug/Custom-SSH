import { lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsProvider } from './i18n/SettingsContext'
import { bindWindowFx } from './windowFx'
import { EditorSkeleton } from './components/skeleton/EditorSkeleton'
import { TitleBar } from './components/TitleBar'
import './styles/fonts'
import './styles/chrome.css'
import './styles/editor.css'

const EditorApp = lazy(() =>
  import('./EditorApp').then((mod) => ({ default: mod.EditorApp })),
)

bindWindowFx()

function EditorShell() {
  return (
    <div className="editor-app">
      <TitleBar />
      <EditorSkeleton />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <SettingsProvider>
    <Suspense fallback={<EditorShell />}>
      <EditorApp />
    </Suspense>
  </SettingsProvider>,
)
