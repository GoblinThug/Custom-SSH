import CodeMirror from '@uiw/react-codemirror'
import { indentWithTab } from '@codemirror/commands'
import { indentUnit } from '@codemirror/language'
import { search } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { languageExtensionForPath } from './editorLanguage'
import { createEditorSearchPanel } from './editorSearchPanel'
import { editorSearchPhrases } from './editorSearchPhrases'
import {
  syntaxColorExtension,
  wantsColorHighlight,
} from './editorSyntaxColors'
import { ProgressBar } from './components/ProgressBar'
import { useSettings } from './i18n/SettingsContext'
import { formatAppError } from './utils/formatAppError'
import { TAB_SIZE } from './types'

function readQuery() {
  const params = new URLSearchParams(window.location.search)
  return {
    sessionId: params.get('sessionId') ?? '',
    remotePath: params.get('path') ?? '',
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
  const { sessionId, remotePath } = useMemo(() => readQuery(), [])
  const [content, setContent] = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [closePromptOpen, setClosePromptOpen] = useState(false)
  const dirtyRef = useRef(false)

  const dirty = content !== original
  dirtyRef.current = dirty

  const fileName = remotePath.split('/').filter(Boolean).pop() || remotePath
  const extensions = useMemo(() => {
    const next = [
      EditorState.tabSize.of(TAB_SIZE),
      indentUnit.of(' '.repeat(TAB_SIZE)),
      keymap.of([indentWithTab]),
      search({ top: true, createPanel: createEditorSearchPanel(t) }),
      EditorState.phrases.of(editorSearchPhrases(t)),
    ]
    const lang = languageExtensionForPath(remotePath)
    if (lang) next.push(lang)
    if (wantsColorHighlight(remotePath)) {
      next.push(syntaxColorExtension(theme === 'light' ? 'light' : 'dark'))
    }
    return next
  }, [remotePath, t, theme])

  const load = useCallback(async () => {
    if (!sessionId || !remotePath) {
      setError(t('editorMissingParams'))
      setLoading(false)
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      const file = await window.sshApi.fsRead(sessionId, remotePath)
      setContent(file.content)
      setOriginal(file.content)
      document.title = `${fileName} — Custom SSH`
    } catch (err) {
      setError(formatAppError(err, t, 'editorLoadFailed'))
    } finally {
      setLoading(false)
    }
  }, [fileName, remotePath, sessionId, t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    document.title = dirty
      ? `• ${fileName} — Custom SSH`
      : `${fileName} — Custom SSH`
  }, [dirty, fileName])

  const save = useCallback(async () => {
    if (!sessionId || !remotePath || saving) return false
    setSaving(true)
    setError(undefined)
    try {
      await window.sshApi.fsWrite(sessionId, remotePath, content)
      setOriginal(content)
      return true
    } catch (err) {
      setError(formatAppError(err, t, 'editorSaveFailed'))
      return false
    } finally {
      setSaving(false)
    }
  }, [content, remotePath, saving, sessionId, t])

  const forceClose = useCallback(async () => {
    setClosePromptOpen(false)
    await window.sshApi.windowForceClose()
  }, [])

  const requestClose = useCallback(() => {
    if (closePromptOpen) return
    if (dirtyRef.current) {
      setClosePromptOpen(true)
      return
    }
    void forceClose()
  }, [closePromptOpen, forceClose])

  const saveAndClose = useCallback(async () => {
    const ok = await save()
    if (ok) await forceClose()
  }, [forceClose, save])

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.code === 'KeyS') {
        ev.preventDefault()
        void save()
      }
      if (ev.key === 'Escape' && closePromptOpen) {
        ev.preventDefault()
        setClosePromptOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closePromptOpen, save])

  useEffect(() => {
    return window.sshApi.onEditorCloseRequest(() => {
      requestClose()
    })
  }, [requestClose])

  return (
    <div className="app editor-app">
      <TitleBar onClose={requestClose} />
      <div className="editor-shell">
        <div className="editor-toolbar">
          <div className="editor-toolbar__meta">
            <div className="editor-toolbar__name" title={remotePath}>
              {fileName}
              <span
                className={`editor-save-badge${dirty ? ' is-unsaved' : ' is-saved'}`}
                title={dirty ? t('editorStatusUnsaved') : t('editorStatusSaved')}
              >
                {dirty ? <UnsavedIcon /> : <SavedIcon />}
                <span>
                  {dirty ? t('editorStatusUnsaved') : t('editorStatusSaved')}
                </span>
              </span>
            </div>
            <div className="editor-toolbar__path" title={remotePath}>
              {remotePath}
            </div>
          </div>
          <div className="editor-toolbar__actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void load()}
              disabled={loading || saving}
            >
              {t('refresh')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void save()}
              disabled={loading || saving || !dirty}
            >
              {saving ? t('editorSaving') : t('editorSave')}
            </button>
          </div>
        </div>

        {error ? <div className="error-box editor-error">{error}</div> : null}

        <div className="editor-body">
          {loading ? (
            <div className="editor-loading">
              <ProgressBar indeterminate label={t('loading')} />
            </div>
          ) : error && !content ? null : (
            <CodeMirror
              value={content}
              height="100%"
              theme={theme === 'light' ? 'light' : oneDark}
              extensions={extensions}
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: true,
                autocompletion: true,
              }}
              onChange={(value) => {
                setContent(value)
              }}
              className="editor-codemirror"
            />
          )}
        </div>
      </div>

      {closePromptOpen ? (
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
              <p className="editor-modal__file" title={remotePath}>
                {fileName}
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
                onClick={() => void forceClose()}
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
