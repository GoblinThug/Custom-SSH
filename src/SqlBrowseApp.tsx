import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { ProgressBar } from './components/ProgressBar'
import { useSettings } from './i18n/SettingsContext'
import { formatAppError } from './utils/formatAppError'
import { formatMessage } from './utils/formatMessage'
import { readWindowQuery } from './utils/windowQuery'

const PAGE_SIZE = 100

type TableInfo = { name: string; type: 'table' | 'view' }

type QueryState = {
  columns: string[]
  rows: Array<Record<string, unknown>>
  total: number
  offset: number
  limit: number
  readonly: boolean
}

type EditCell = {
  rowid: number
  column: string
  value: string
}

function cellDisplay(
  value: unknown,
  nullLabel: string,
): { text: string; isNull: boolean } {
  if (value === null || value === undefined) {
    return { text: nullLabel, isNull: true }
  }
  return { text: String(value), isNull: false }
}

function parseCellInput(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed.toUpperCase() === 'NULL') return null
  if (/^-?\d+$/.test(trimmed)) {
    const n = Number(trimmed)
    if (Number.isSafeInteger(n)) return n
  }
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    const n = Number(trimmed)
    if (Number.isFinite(n)) return n
  }
  return raw
}

export function SqlBrowseApp() {
  const { t } = useSettings()
  const { sessionId, remotePath } = useMemo(() => readWindowQuery(), [])
  const fileName = useMemo(
    () => remotePath.split('/').filter(Boolean).pop() || t('sqlBrowseTitle'),
    [remotePath, t],
  )

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [note, setNote] = useState<string | undefined>()
  const [tables, setTables] = useState<TableInfo[]>([])
  const [activeTable, setActiveTable] = useState<string | null>(null)
  const [query, setQuery] = useState<QueryState | null>(null)
  const [dirty, setDirty] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [edit, setEdit] = useState<EditCell | null>(null)
  const [closePromptOpen, setClosePromptOpen] = useState(false)
  const dirtyRef = useRef(false)
  const editInputRef = useRef<HTMLInputElement | null>(null)
  const selectAllRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  const loadMeta = useCallback(async () => {
    if (!sessionId || !remotePath) {
      setError(t('sqlBrowseLoadFailed'))
      setLoading(false)
      return
    }
    setLoading(true)
    setError(undefined)
    try {
      const meta = await window.sshApi.sqlBrowseMeta(sessionId, remotePath)
      setTables(meta.tables)
      setDirty(meta.dirty)
      document.title = meta.name || fileName
      setActiveTable((prev) => {
        if (prev && meta.tables.some((item) => item.name === prev)) return prev
        return meta.tables[0]?.name ?? null
      })
    } catch (err) {
      setError(formatAppError(err, t, 'sqlBrowseLoadFailed'))
    } finally {
      setLoading(false)
    }
  }, [fileName, remotePath, sessionId, t])

  const loadRows = useCallback(
    async (table: string, offset: number) => {
      if (!sessionId || !remotePath) return
      setBusy(true)
      setError(undefined)
      setEdit(null)
      setSelected(new Set())
      try {
        const result = await window.sshApi.sqlBrowseQuery(
          sessionId,
          remotePath,
          table,
          PAGE_SIZE,
          offset,
        )
        setQuery(result)
      } catch (err) {
        setError(formatAppError(err, t, 'sqlBrowseLoadFailed'))
      } finally {
        setBusy(false)
      }
    },
    [remotePath, sessionId, t],
  )

  useEffect(() => {
    void loadMeta()
  }, [loadMeta])

  useEffect(() => {
    if (!activeTable) {
      setQuery(null)
      return
    }
    void loadRows(activeTable, 0)
  }, [activeTable, loadRows])

  const forceClose = useCallback(async () => {
    setClosePromptOpen(false)
    await window.sshApi.windowForceClose()
  }, [])

  const saveDb = useCallback(async () => {
    if (!sessionId || !remotePath) return false
    setBusy(true)
    setNote(undefined)
    setError(undefined)
    try {
      await window.sshApi.sqlBrowseSave(sessionId, remotePath)
      setDirty(false)
      setNote(t('sqlBrowseSaved'))
      return true
    } catch (err) {
      setError(formatAppError(err, t, 'sqlBrowseSaveFailed'))
      return false
    } finally {
      setBusy(false)
    }
  }, [remotePath, sessionId, t])

  const requestClose = useCallback(() => {
    if (closePromptOpen) return
    if (dirtyRef.current) {
      setClosePromptOpen(true)
      return
    }
    void forceClose()
  }, [closePromptOpen, forceClose])

  useEffect(() => {
    return window.sshApi.onSqlBrowseCloseRequest(() => {
      requestClose()
    })
  }, [requestClose])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveDb()
      }
      if (event.key === 'Escape' && closePromptOpen) {
        event.preventDefault()
        setClosePromptOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closePromptOpen, saveDb])

  useEffect(() => {
    if (edit) editInputRef.current?.focus()
  }, [edit])

  const visibleColumns = useMemo(() => {
    if (!query) return []
    return query.columns.filter((col) => col !== '__rowid__')
  }, [query])

  const page = query ? Math.floor(query.offset / PAGE_SIZE) + 1 : 1
  const pages = query ? Math.max(1, Math.ceil(query.total / PAGE_SIZE)) : 1
  const activeMeta = tables.find((item) => item.name === activeTable)
  const readonly = Boolean(query?.readonly || activeMeta?.type === 'view')

  const allSelected = Boolean(
    query &&
      query.rows.length > 0 &&
      query.rows.every((row) => selected.has(Number(row.__rowid__))),
  )
  const someSelected = Boolean(
    query && query.rows.some((row) => selected.has(Number(row.__rowid__))),
  )

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someSelected && !allSelected
    }
  }, [allSelected, someSelected])

  const commitEdit = async () => {
    if (!edit || !sessionId || !remotePath || !activeTable || readonly) {
      setEdit(null)
      return
    }
    const nextValue = parseCellInput(edit.value)
    setBusy(true)
    setError(undefined)
    try {
      const result = await window.sshApi.sqlBrowseUpdate(
        sessionId,
        remotePath,
        activeTable,
        edit.rowid,
        edit.column,
        nextValue,
      )
      setDirty(result.dirty)
      setEdit(null)
      await loadRows(activeTable, query?.offset ?? 0)
    } catch (err) {
      setError(formatAppError(err, t, 'sqlBrowseMutateFailed'))
      setBusy(false)
    }
  }

  const addRow = async () => {
    if (!sessionId || !remotePath || !activeTable || readonly) return
    setBusy(true)
    setError(undefined)
    setNote(undefined)
    try {
      const values: Record<string, unknown> = {}
      for (const col of visibleColumns) values[col] = null
      const result = await window.sshApi.sqlBrowseInsert(
        sessionId,
        remotePath,
        activeTable,
        values,
      )
      setDirty(result.dirty)
      const lastPageOffset =
        Math.max(0, Math.ceil((query?.total ?? 0) / PAGE_SIZE) - 1) * PAGE_SIZE
      await loadRows(activeTable, lastPageOffset)
    } catch (err) {
      setError(formatAppError(err, t, 'sqlBrowseMutateFailed'))
      setBusy(false)
    }
  }

  const deleteSelected = async () => {
    if (
      !sessionId ||
      !remotePath ||
      !activeTable ||
      readonly ||
      selected.size === 0
    ) {
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const result = await window.sshApi.sqlBrowseDelete(
        sessionId,
        remotePath,
        activeTable,
        Array.from(selected),
      )
      setDirty(result.dirty)
      await loadRows(activeTable, query?.offset ?? 0)
    } catch (err) {
      setError(formatAppError(err, t, 'sqlBrowseMutateFailed'))
      setBusy(false)
    }
  }

  const tableGroups = useMemo(() => {
    const dataTables = tables.filter((item) => item.type === 'table')
    const views = tables.filter((item) => item.type === 'view')
    return { dataTables, views }
  }, [tables])

  return (
    <div className="app sql-browse-app">
      <TitleBar onClose={requestClose} />
      <div className="sql-browse-shell">
        <div className="sql-browse-toolbar">
          <div className="sql-browse-toolbar__title" title={remotePath}>
            {fileName}
          </div>
          <div className="sql-browse-toolbar__actions">
            {dirty ? (
              <span className="sql-browse-dirty">{t('sqlBrowseDirty')}</span>
            ) : null}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading || busy || !activeTable}
              onClick={() => {
                if (activeTable) void loadRows(activeTable, query?.offset ?? 0)
              }}
            >
              {t('sqlBrowseRefresh')}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading || busy || !activeTable || readonly}
              onClick={() => void addRow()}
            >
              {t('sqlBrowseAddRow')}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={
                loading || busy || !activeTable || readonly || selected.size === 0
              }
              onClick={() => void deleteSelected()}
            >
              {t('sqlBrowseDeleteRows')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={loading || busy || !dirty}
              onClick={() => void saveDb()}
            >
              {busy && dirty ? t('sqlBrowseSaving') : t('sqlBrowseSave')}
            </button>
          </div>
        </div>

        {error ? <div className="error-box sql-browse-error">{error}</div> : null}
        {note ? <div className="sql-browse-note">{note}</div> : null}

        <div className="sql-browse-body">
          <aside className="sql-browse-sidebar">
            {loading ? (
              <div className="sql-browse-loading">
                <ProgressBar indeterminate label={t('loading')} />
              </div>
            ) : tables.length === 0 ? (
              <div className="sql-browse-empty">{t('sqlBrowseNoTables')}</div>
            ) : (
              <>
                {tableGroups.dataTables.length > 0 ? (
                  <>
                    <div className="sql-browse-sidebar__label">
                      {t('sqlBrowseTables')}
                    </div>
                    {tableGroups.dataTables.map((item) => (
                      <button
                        key={item.name}
                        type="button"
                        className={`sql-browse-table-btn${
                          activeTable === item.name ? ' is-active' : ''
                        }`}
                        onClick={() => setActiveTable(item.name)}
                      >
                        {item.name}
                      </button>
                    ))}
                  </>
                ) : null}
                {tableGroups.views.length > 0 ? (
                  <>
                    <div className="sql-browse-sidebar__label">
                      {t('sqlBrowseViews')}
                    </div>
                    {tableGroups.views.map((item) => (
                      <button
                        key={item.name}
                        type="button"
                        className={`sql-browse-table-btn is-view${
                          activeTable === item.name ? ' is-active' : ''
                        }`}
                        onClick={() => setActiveTable(item.name)}
                      >
                        {item.name}
                      </button>
                    ))}
                  </>
                ) : null}
              </>
            )}
          </aside>

          <div className="sql-browse-main">
            {readonly && activeTable ? (
              <div className="sql-browse-pager">{t('sqlBrowseViewReadonly')}</div>
            ) : null}
            {query && activeTable ? (
              <div className="sql-browse-pager">
                <span>
                  {formatMessage(t('sqlBrowseRows'), { count: query.total })}
                </span>
                <span className="sql-browse-pager__spacer" />
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy || query.offset <= 0}
                  onClick={() =>
                    void loadRows(
                      activeTable,
                      Math.max(0, query.offset - PAGE_SIZE),
                    )
                  }
                >
                  {t('sqlBrowsePrevPage')}
                </button>
                <span>
                  {formatMessage(t('sqlBrowsePage'), { page, pages })}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy || query.offset + PAGE_SIZE >= query.total}
                  onClick={() =>
                    void loadRows(activeTable, query.offset + PAGE_SIZE)
                  }
                >
                  {t('sqlBrowseNextPage')}
                </button>
              </div>
            ) : null}

            <div className="sql-browse-grid-wrap">
              {loading || (busy && !query) ? (
                <div className="sql-browse-loading">
                  <ProgressBar indeterminate label={t('loading')} />
                </div>
              ) : !activeTable ? (
                <div className="sql-browse-empty">{t('sqlBrowseNoTables')}</div>
              ) : !query || query.rows.length === 0 ? (
                <div className="sql-browse-empty">{t('sqlBrowseEmpty')}</div>
              ) : (
                <table className="sql-browse-grid">
                  <thead>
                    <tr>
                      {!readonly ? (
                        <th className="row-check">
                          <input
                            ref={selectAllRef}
                            type="checkbox"
                            className="sql-browse-check"
                            checked={allSelected}
                            onChange={(event) => {
                              if (event.target.checked) {
                                setSelected(
                                  new Set(
                                    query.rows.map((row) =>
                                      Number(row.__rowid__),
                                    ),
                                  ),
                                )
                              } else {
                                setSelected(new Set())
                              }
                            }}
                            aria-label={t('sqlBrowseDeleteRows')}
                          />
                        </th>
                      ) : null}
                      {visibleColumns.map((col) => (
                        <th key={col}>{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {query.rows.map((row) => {
                      const rowid = Number(row.__rowid__)
                      const isSelected = selected.has(rowid)
                      return (
                        <tr
                          key={Number.isFinite(rowid) ? rowid : JSON.stringify(row)}
                          className={isSelected ? 'is-selected' : undefined}
                        >
                          {!readonly ? (
                            <td className="row-check">
                              <input
                                type="checkbox"
                                className="sql-browse-check"
                                checked={isSelected}
                                onChange={() => {
                                  setSelected((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(rowid)) next.delete(rowid)
                                    else next.add(rowid)
                                    return next
                                  })
                                }}
                                onClick={(event) => event.stopPropagation()}
                              />
                            </td>
                          ) : null}
                          {visibleColumns.map((col) => {
                            const editing =
                              edit &&
                              edit.rowid === rowid &&
                              edit.column === col
                            const display = cellDisplay(
                              row[col],
                              t('sqlBrowseNull'),
                            )
                            return (
                              <td key={col}>
                                {editing ? (
                                  <input
                                    ref={editInputRef}
                                    className="sql-browse-cell-input"
                                    value={edit.value}
                                    disabled={busy}
                                    onChange={(event) =>
                                      setEdit({
                                        ...edit,
                                        value: event.target.value,
                                      })
                                    }
                                    onBlur={() => void commitEdit()}
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') {
                                        event.preventDefault()
                                        void commitEdit()
                                      } else if (event.key === 'Escape') {
                                        event.preventDefault()
                                        setEdit(null)
                                      }
                                    }}
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    className={`sql-browse-cell${
                                      display.isNull ? ' is-null' : ''
                                    }`}
                                    title={display.text}
                                    disabled={readonly || busy}
                                    onDoubleClick={() => {
                                      if (readonly) return
                                      setEdit({
                                        rowid,
                                        column: col,
                                        value: display.isNull
                                          ? ''
                                          : String(row[col] ?? ''),
                                      })
                                    }}
                                  >
                                    {display.text}
                                  </button>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <div className="sql-browse-status">
          {activeTable
            ? `${activeTable}${readonly ? ` · ${t('sqlBrowseViewReadonly')}` : ''}`
            : t('sqlBrowseTitle')}
          {fileName ? ` · ${fileName}` : ''}
        </div>
      </div>

      {closePromptOpen ? (
        <div className="sql-browse-modal" role="presentation">
          <div
            className="sql-browse-modal__card"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="sql-unsaved-title"
          >
            <h2 id="sql-unsaved-title" className="sql-browse-modal__title">
              {t('sqlBrowseUnsavedTitle')}
            </h2>
            <p className="sql-browse-modal__message">
              {t('sqlBrowseUnsavedMessage')}
            </p>
            <p className="sql-browse-modal__detail">
              {t('sqlBrowseUnsavedDetail')}
            </p>
            <div className="sql-browse-modal__actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={async () => {
                  const ok = await saveDb()
                  if (ok) await forceClose()
                }}
              >
                {t('sqlBrowseSaveAndClose')}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => void forceClose()}
              >
                {t('sqlBrowseDiscard')}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setClosePromptOpen(false)}
              >
                {t('sqlBrowseKeepEditing')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
