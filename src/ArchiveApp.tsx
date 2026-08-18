import { useCallback, useEffect, useMemo, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { ProgressBar } from './components/ProgressBar'
import { useSettings } from './i18n/SettingsContext'
import { formatBytes } from './imageFiles'
import { formatAppError } from './utils/formatAppError'

type ArchiveEntry = {
  path: string
  name: string
  isDir: boolean
  size: number
}

function readQuery() {
  const params = new URLSearchParams(window.location.search)
  return {
    sessionId: params.get('sessionId') ?? '',
    remotePath: params.get('path') ?? '',
  }
}

function formatMessage(
  template: string,
  values: Record<string, string | number>,
) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  )
}

function parentOf(entryPath: string): string {
  const parts = entryPath.split('/').filter(Boolean)
  return parts.slice(0, -1).join('/')
}

function childrenInDir(entries: ArchiveEntry[], dir: string): ArchiveEntry[] {
  return entries.filter((entry) => parentOf(entry.path) === dir)
}

function FolderGlyph() {
  return (
    <svg
      className="archive-row__icon"
      width="14"
      height="14"
      viewBox="0 0 256 256"
      fill="currentColor"
      aria-hidden
    >
      <path d="M224,64H154.667l-27.7334-20.7998A16.10323,16.10323,0,0,0,117.333,40H72A16.01833,16.01833,0,0,0,56,56V72H40A16.01833,16.01833,0,0,0,24,88V200a16.01833,16.01833,0,0,0,16,16H192.88867A15.12831,15.12831,0,0,0,208,200.88867V184h16.88867A15.12831,15.12831,0,0,0,240,168.88867V80A16.01833,16.01833,0,0,0,224,64Zm0,104H208V112a16.01833,16.01833,0,0,0-16-16H122.667L94.93359,75.2002A16.10323,16.10323,0,0,0,85.333,72H72V56h45.333l27.7334,20.7998A16.10323,16.10323,0,0,0,154.667,80H224Z" />
    </svg>
  )
}

function FileGlyph() {
  return (
    <svg
      className="archive-row__icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M14 2v6h6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ArchiveApp() {
  const { t } = useSettings()
  const { sessionId, remotePath } = useMemo(() => readQuery(), [])
  const fileName = useMemo(
    () => remotePath.split('/').filter(Boolean).pop() || t('archiveRoot'),
    [remotePath, t],
  )

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [note, setNote] = useState<string | undefined>()
  const [entries, setEntries] = useState<ArchiveEntry[]>([])
  const [cwd, setCwd] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)

  const crumbs = useMemo(() => {
    const parts = cwd.split('/').filter(Boolean)
    const items = [{ path: '', name: fileName }]
    let acc = ''
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part
      items.push({ path: acc, name: part })
    }
    return items
  }, [cwd, fileName])

  const visible = useMemo(() => childrenInDir(entries, cwd), [entries, cwd])

  const load = useCallback(async () => {
    if (!sessionId || !remotePath) {
      setError(t('archiveLoadFailed'))
      setLoading(false)
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      const listed = await window.sshApi.archiveList(sessionId, remotePath)
      setEntries(listed.entries)
      document.title = listed.name || fileName
    } catch (err) {
      setError(formatAppError(err, t, 'archiveLoadFailed'))
    } finally {
      setLoading(false)
    }
  }, [fileName, remotePath, sessionId, t])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    return window.sshApi.onArchiveCloseRequest(() => {
      void window.sshApi.windowForceClose()
    })
  }, [])

  const goUp = useCallback(() => {
    setCwd((prev) => {
      if (!prev) return prev
      return parentOf(prev)
    })
    setSelected(new Set())
    setAnchor(null)
  }, [])

  const enterDir = useCallback((path: string) => {
    setCwd(path)
    setSelected(new Set())
    setAnchor(null)
  }, [])

  const openEntry = useCallback(
    async (entry: ArchiveEntry) => {
      if (entry.isDir) {
        enterDir(entry.path)
        return
      }
      if (!sessionId || !remotePath) return
      setNote(undefined)
      setBusy(true)
      try {
        await window.sshApi.archiveOpenEntry(sessionId, remotePath, entry.path)
      } catch (err) {
        setError(formatAppError(err, t, 'archiveOpenFailed'))
      } finally {
        setBusy(false)
      }
    },
    [enterDir, remotePath, sessionId, t],
  )

  const selectAt = (
    entry: ArchiveEntry,
    event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  ) => {
    const multi = event.ctrlKey || event.metaKey
    if (event.shiftKey && anchor) {
      const from = visible.findIndex((item) => item.path === anchor)
      const to = visible.findIndex((item) => item.path === entry.path)
      if (from >= 0 && to >= 0) {
        const start = Math.min(from, to)
        const end = Math.max(from, to)
        setSelected(new Set(visible.slice(start, end + 1).map((item) => item.path)))
        return
      }
    }
    if (multi) {
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(entry.path)) next.delete(entry.path)
        else next.add(entry.path)
        return next
      })
      setAnchor(entry.path)
      return
    }
    setSelected(new Set([entry.path]))
    setAnchor(entry.path)
  }

  const extract = async (paths: string[] | null) => {
    if (!sessionId || !remotePath) return
    setNote(undefined)
    setError(undefined)
    setBusy(true)
    try {
      const result = await window.sshApi.archiveExtract(
        sessionId,
        remotePath,
        paths,
      )
      if (result.ok) {
        setNote(
          formatMessage(t('archiveExtractOk'), { path: result.dest }),
        )
      }
    } catch (err) {
      setError(formatAppError(err, t, 'archiveExtractFailed'))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return
      }
      if (event.key === 'Backspace' || (event.altKey && event.key === 'ArrowUp')) {
        event.preventDefault()
        goUp()
      } else if (event.key === 'Enter' && selected.size === 1) {
        const path = Array.from(selected)[0]
        const entry = visible.find((item) => item.path === path)
        if (entry) void openEntry(entry)
      } else if (event.key === 'Escape') {
        setSelected(new Set())
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setSelected(new Set(visible.map((item) => item.path)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goUp, openEntry, selected, visible])

  return (
    <div className="app archive-app">
      <TitleBar onClose={() => void window.sshApi.windowForceClose()} />
      <div className="archive-shell">
        <div className="archive-toolbar">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={goUp}
            disabled={!cwd || loading}
          >
            {t('archiveUp')}
          </button>
          <div className="archive-crumbs" title={remotePath}>
            {crumbs.map((crumb, index) => (
              <span key={crumb.path || 'root'} className="archive-crumbs__item">
                {index > 0 ? (
                  <span className="archive-crumbs__sep">/</span>
                ) : null}
                <button
                  type="button"
                  className="archive-crumbs__btn"
                  disabled={crumb.path === cwd}
                  onClick={() => enterDir(crumb.path)}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </div>
          <div className="archive-toolbar__actions">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading || busy || entries.length === 0}
              onClick={() => void extract(cwd ? [cwd] : null)}
            >
              {t('archiveExtract')}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading || busy || selected.size === 0}
              onClick={() => void extract(Array.from(selected))}
            >
              {t('archiveExtractSelected')}
            </button>
          </div>
        </div>

        <div className="archive-body">
          {error ? <div className="error-box archive-error">{error}</div> : null}
          {note ? <div className="archive-note">{note}</div> : null}
          {loading ? (
            <div className="archive-loading">
              <ProgressBar indeterminate label={t('loading')} />
            </div>
          ) : (
            <>
              <div className="archive-head">
                <span className="archive-head__name">{t('archiveNameCol')}</span>
                <span className="archive-head__size">{t('archiveSizeCol')}</span>
              </div>
              <div className="archive-list">
                {visible.length === 0 ? (
                  <div className="archive-empty">{t('archiveEmpty')}</div>
                ) : (
                  visible.map((entry) => (
                    <button
                      key={entry.path}
                      type="button"
                      className={`archive-row${
                        selected.has(entry.path) ? ' is-selected' : ''
                      }`}
                      onClick={(event) => selectAt(entry, event)}
                      onDoubleClick={() => void openEntry(entry)}
                    >
                      <span className="archive-row__name">
                        {entry.isDir ? <FolderGlyph /> : <FileGlyph />}
                        {entry.name}
                      </span>
                      <span className="archive-row__size">
                        {entry.isDir ? '' : formatBytes(entry.size)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        <div className="archive-status">
          {formatMessage(t('archiveItems'), { count: visible.length })}
          {fileName ? ` · ${fileName}` : ''}
        </div>
      </div>
    </div>
  )
}
