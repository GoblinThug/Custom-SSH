import { indentWithTab } from '@codemirror/commands'
import { indentUnit } from '@codemirror/language'
import { search } from '@codemirror/search'
import { EditorState, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import { TitleBar } from './components/TitleBar'
import { languageExtensionForPath } from './editorLanguage'
import { createEditorSearchPanel } from './editorSearchPanel'
import { editorSearchPhrases } from './editorSearchPhrases'
import {
  syntaxColorExtension,
  wantsColorHighlight,
} from './editorSyntaxColors'
import { ProgressBar } from './components/ProgressBar'
import { EditorSkeleton } from './components/skeleton/EditorSkeleton'
import { useSettings } from './i18n/SettingsContext'
import { formatAppError } from './utils/formatAppError'
import { readWindowQuery } from './utils/windowQuery'
import { TAB_SIZE } from './types'

const EditorCodeMirror = lazy(() =>
  import('./components/EditorCodeMirror').then((mod) => ({
    default: mod.EditorCodeMirror,
  })),
)

type EditorTab = {
  id: string
  remotePath: string
  content: string
  original: string
  loading: boolean
  error?: string
}

function fileNameOf(remotePath: string) {
  return remotePath.split('/').filter(Boolean).pop() || remotePath
}

function createTab(remotePath: string): EditorTab {
  return {
    id: crypto.randomUUID(),
    remotePath,
    content: '',
    original: '',
    loading: true,
  }
}

function SavedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M8 12.5L10.8 15.2L16.2 9.2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function UnsavedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3.2" fill="currentColor" />
    </svg>
  )
}

export function EditorApp() {
  const { t, theme } = useSettings()
  const { sessionId, remotePath: initialPath } = useMemo(() => readWindowQuery(), [])
  const [langExt, setLangExt] = useState<Extension | null>(null)
  const [tabs, setTabs] = useState<EditorTab[]>(() =>
    initialPath ? [createTab(initialPath)] : [],
  )
  const [activeId, setActiveId] = useState(() => tabs[0]?.id ?? '')
  const [saving, setSaving] = useState(false)
  const [closePromptOpen, setClosePromptOpen] = useState(false)
  const [closeTarget, setCloseTarget] = useState<'window' | string>('window')
  const tabsRef = useRef(tabs)
  const activeIdRef = useRef(activeId)

  tabsRef.current = tabs
  activeIdRef.current = activeId

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0]
  const dirty = activeTab ? activeTab.content !== activeTab.original : false

  const loadTab = useCallback(
    async (tabId: string, remotePath: string) => {
      if (!sessionId || !remotePath) {
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === tabId
              ? { ...tab, loading: false, error: t('editorMissingParams') }
              : tab,
          ),
        )
        return
      }
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === tabId ? { ...tab, loading: true, error: undefined } : tab,
        ),
      )
      try {
        const file = await window.sshApi.fsRead(sessionId, remotePath)
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === tabId
              ? {
                  ...tab,
                  content: file.content,
                  original: file.content,
                  loading: false,
                }
              : tab,
          ),
        )
      } catch (err) {
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === tabId
              ? {
                  ...tab,
                  loading: false,
                  error: formatAppError(err, t, 'editorLoadFailed'),
                }
              : tab,
          ),
        )
      }
    },
    [sessionId, t],
  )

  const openTab = useCallback(
    (remotePath: string) => {
      const existing = tabsRef.current.find((tab) => tab.remotePath === remotePath)
      if (existing) {
        setActiveId(existing.id)
        return
      }
      const tab = createTab(remotePath)
      setTabs((prev) => [...prev, tab])
      setActiveId(tab.id)
      void loadTab(tab.id, remotePath)
    },
    [loadTab],
  )

  useEffect(() => {
    if (!initialPath || tabs.length === 0) return
    void loadTab(tabs[0].id, initialPath)
  }, [])

  useEffect(() => {
    return window.sshApi.onEditorOpenTab(({ remotePath }) => {
      openTab(remotePath)
    })
  }, [openTab])

  useEffect(() => {
    if (!activeTab) {
      document.title = 'Custom SSH'
      return
    }
    const name = fileNameOf(activeTab.remotePath)
    const tabDirty = activeTab.content !== activeTab.original
    document.title = tabDirty
      ? `• ${name} — Custom SSH`
      : `${name} — Custom SSH`
  }, [activeTab])

  useEffect(() => {
    if (!activeTab) {
      setLangExt(null)
      return
    }
    let cancelled = false
    void languageExtensionForPath(activeTab.remotePath).then((ext) => {
      if (!cancelled) setLangExt(ext)
    })
    return () => {
      cancelled = true
    }
  }, [activeTab?.remotePath])

  const extensions = useMemo(() => {
    if (!activeTab) return []
    const next = [
      EditorState.tabSize.of(TAB_SIZE),
      indentUnit.of(' '.repeat(TAB_SIZE)),
      keymap.of([indentWithTab]),
      search({ top: true, createPanel: createEditorSearchPanel(t) }),
      EditorState.phrases.of(editorSearchPhrases(t)),
    ]
    if (langExt) next.push(langExt)
    if (wantsColorHighlight(activeTab.remotePath)) {
      next.push(syntaxColorExtension(theme === 'light' ? 'light' : 'dark'))
    }
    return next
  }, [activeTab, langExt, t, theme])

  const saveTab = useCallback(
    async (tabId: string) => {
      const tab = tabsRef.current.find((item) => item.id === tabId)
      if (!tab || !sessionId || saving) return false
      setSaving(true)
      setTabs((prev) =>
        prev.map((item) =>
          item.id === tabId ? { ...item, error: undefined } : item,
        ),
      )
      try {
        await window.sshApi.fsWrite(sessionId, tab.remotePath, tab.content)
        setTabs((prev) =>
          prev.map((item) =>
            item.id === tabId ? { ...item, original: item.content } : item,
          ),
        )
        return true
      } catch (err) {
        setTabs((prev) =>
          prev.map((item) =>
            item.id === tabId
              ? {
                  ...item,
                  error: formatAppError(err, t, 'editorSaveFailed'),
                }
              : item,
          ),
        )
        return false
      } finally {
        setSaving(false)
      }
    },
    [saving, sessionId, t],
  )

  const forceClose = useCallback(async () => {
    setClosePromptOpen(false)
    await window.sshApi.windowForceClose()
  }, [])

  const removeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const next = prev.filter((tab) => tab.id !== tabId)
        if (next.length === 0) {
          void forceClose()
          return prev
        }
        if (activeIdRef.current === tabId) {
          const index = prev.findIndex((tab) => tab.id === tabId)
          const fallback = next[Math.max(0, index - 1)] ?? next[0]
          setActiveId(fallback.id)
        }
        return next
      })
    },
    [forceClose],
  )

  const requestCloseTab = useCallback(
    (tabId: string) => {
      const tab = tabsRef.current.find((item) => item.id === tabId)
      if (!tab) return
      if (tab.content !== tab.original) {
        setCloseTarget(tabId)
        setClosePromptOpen(true)
        return
      }
      removeTab(tabId)
    },
    [removeTab],
  )

  const requestCloseWindow = useCallback(() => {
    if (closePromptOpen) return
    const tab = tabsRef.current.find((item) => item.id === activeIdRef.current)
    if (tab && tab.content !== tab.original) {
      setCloseTarget('window')
      setClosePromptOpen(true)
      return
    }
    void forceClose()
  }, [closePromptOpen, forceClose])

  const saveAndClose = useCallback(async () => {
    const target = closeTarget
    const tabId = target === 'window' ? activeIdRef.current : target
    const ok = await saveTab(tabId)
    if (!ok) return
    if (target === 'window') {
      await forceClose()
      return
    }
    setClosePromptOpen(false)
    removeTab(target)
  }, [closeTarget, forceClose, removeTab, saveTab])

  const discardClose = useCallback(async () => {
    const target = closeTarget
    if (target === 'window') {
      await forceClose()
      return
    }
    setClosePromptOpen(false)
    removeTab(target)
  }, [closeTarget, forceClose, removeTab])

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyS') {
        ev.preventDefault()
        if (activeIdRef.current) void saveTab(activeIdRef.current)
      }
      if (ev.key === 'Escape' && closePromptOpen) {
        ev.preventDefault()
        setClosePromptOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closePromptOpen, saveTab])

  useEffect(() => {
    return window.sshApi.onEditorCloseRequest(() => {
      requestCloseWindow()
    })
  }, [requestCloseWindow])

  const promptTab =
    closeTarget === 'window'
      ? tabsRef.current.find((tab) => tab.id === activeIdRef.current)
      : tabsRef.current.find((tab) => tab.id === closeTarget)

  return (
    <div className="app editor-app">
      <TitleBar onClose={requestCloseWindow} />
      <div className="editor-shell">
        {tabs.length > 0 ? (
          <div className="editor-tabs terminal-tabs" role="tablist">
            {tabs.map((tab) => {
              const name = fileNameOf(tab.remotePath)
              const tabDirty = tab.content !== tab.original
              return (
                <div
                  key={tab.id}
                  className={`terminal-tab editor-tab${
                    tab.id === activeId ? ' is-active' : ''
                  }`}
                  role="presentation"
                >
                  <button
                    type="button"
                    className="terminal-tab__label"
                    role="tab"
                    aria-selected={tab.id === activeId}
                    title={tab.remotePath}
                    onClick={() => setActiveId(tab.id)}
                  >
                    {tabDirty ? '• ' : ''}
                    {name}
                  </button>
                  <button
                    type="button"
                    className="terminal-tab__close"
                    title={t('close')}
                    aria-label={t('close')}
                    onClick={() => requestCloseTab(tab.id)}
                  >
                    ×
                  </button>
                </div>
              )
            })}
          </div>
        ) : null}

        {activeTab ? (
          <>
            <div className="editor-toolbar">
              <div className="editor-toolbar__meta">
                <div className="editor-toolbar__name" title={activeTab.remotePath}>
                  {fileNameOf(activeTab.remotePath)}
                  <span
                    className={`editor-save-badge${dirty ? ' is-unsaved' : ' is-saved'}`}
                    title={
                      dirty ? t('editorStatusUnsaved') : t('editorStatusSaved')
                    }
                  >
                    {dirty ? <UnsavedIcon /> : <SavedIcon />}
                    <span>
                      {dirty ? t('editorStatusUnsaved') : t('editorStatusSaved')}
                    </span>
                  </span>
                </div>
                <div className="editor-toolbar__path" title={activeTab.remotePath}>
                  {activeTab.remotePath}
                </div>
              </div>
              <div className="editor-toolbar__actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void loadTab(activeTab.id, activeTab.remotePath)}
                  disabled={activeTab.loading || saving}
                >
                  {t('refresh')}
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void saveTab(activeTab.id)}
                  disabled={activeTab.loading || saving || !dirty}
                >
                  {saving ? t('editorSaving') : t('editorSave')}
                </button>
              </div>
            </div>

            {activeTab.error ? (
              <div className="error-box editor-error">{activeTab.error}</div>
            ) : null}

            <div className="editor-body" role="tabpanel">
              {activeTab.loading ? (
                <div className="editor-loading">
                  <ProgressBar indeterminate label={t('loading')} />
                </div>
              ) : activeTab.error && !activeTab.content ? null : (
                <Suspense fallback={<EditorSkeleton />}>
                  <EditorCodeMirror
                    tabId={activeTab.id}
                    value={activeTab.content}
                    theme={theme}
                    extensions={extensions}
                    onChange={(value) => {
                      setTabs((prev) =>
                        prev.map((tab) =>
                          tab.id === activeTab.id ? { ...tab, content: value } : tab,
                        ),
                      )
                    }}
                  />
                </Suspense>
              )}
            </div>
          </>
        ) : (
          <div className="editor-loading">
            <ProgressBar indeterminate label={t('loading')} />
          </div>
        )}
      </div>

      {closePromptOpen && promptTab ? (
        <div className="editor-modal-backdrop" role="presentation">
          <div
            className="editor-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="editor-unsaved-title"
            aria-describedby="editor-unsaved-desc"
          >
            <div className="editor-modal__icon" aria-hidden>
              <UnsavedIcon />
            </div>
            <div className="editor-modal__body">
              <h2 id="editor-unsaved-title" className="editor-modal__title">
                {t('editorUnsavedTitle')}
              </h2>
              <p id="editor-unsaved-desc" className="editor-modal__message">
                {t('editorUnsavedMessage')}
              </p>
              <p className="editor-modal__detail">{t('editorUnsavedDetail')}</p>
              <p className="editor-modal__file" title={promptTab.remotePath}>
                {fileNameOf(promptTab.remotePath)}
              </p>
            </div>
            <div className="editor-modal__actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving}
                onClick={() => void saveAndClose()}
              >
                {saving ? t('editorSaving') : t('editorSaveAndClose')}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={saving}
                onClick={() => void discardClose()}
              >
                {t('editorDiscard')}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={saving}
                onClick={() => setClosePromptOpen(false)}
              >
                {t('editorKeepEditing')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
