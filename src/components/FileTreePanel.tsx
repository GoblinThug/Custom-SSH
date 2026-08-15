import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { useSettings } from '../i18n/SettingsContext'
import type { RemoteFsEntry } from '../types'
import { ChevronIcon } from './ChevronIcon'

function emitTransferQueue(queued: number) {
  window.dispatchEvent(
    new CustomEvent('customssh:transfer-queue', {
      detail: { queued },
    }),
  )
}

type Props = {
  open: boolean
  pinned: boolean
  sessionId: string | null
  onClose: () => void
  onPinnedChange: (pinned: boolean) => void
  onNavigate?: (remotePath: string) => void
}

function parentChain(cwd: string): string[] {
  if (!cwd || cwd === '/') return ['/']
  const parts = cwd.split('/').filter(Boolean)
  const paths = ['/']
  let acc = ''
  for (const part of parts) {
    acc += `/${part}`
    paths.push(acc)
  }
  return paths
}

function parentDir(filePath: string): string {
  const parts = filePath.split('/').filter(Boolean)
  if (parts.length <= 1) return '/'
  return `/${parts.slice(0, -1).join('/')}`
}

function displayName(path: string): string {
  if (path === '/') return 'root'
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] || 'root'
}

function normalizeRemotePath(input: string): string {
  const value = input.trim().replace(/\\/g, '/')
  if (!value || value === '/') return '/'
  const withSlash = value.startsWith('/') ? value : `/${value}`
  const parts = withSlash.split('/').filter(Boolean)
  return parts.length === 0 ? '/' : `/${parts.join('/')}`
}

function scrollFolderToTop(
  container: HTMLElement | null,
  remotePath: string,
) {
  if (!container) return
  const row = Array.from(
    container.querySelectorAll<HTMLElement>('[data-tree-path]'),
  ).find((el) => el.getAttribute('data-tree-path') === remotePath)
  if (!row) return
  const containerTop = container.getBoundingClientRect().top
  const rowTop = row.getBoundingClientRect().top
  container.scrollTop += rowTop - containerTop
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

function FolderIcon() {
  return (
    <svg
      className="file-tree__folder-icon"
      width="14"
      height="14"
      viewBox="0 0 256 256"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M224,64H154.667l-27.7334-20.7998A16.10323,16.10323,0,0,0,117.333,40H72A16.01833,16.01833,0,0,0,56,56V72H40A16.01833,16.01833,0,0,0,24,88V200a16.01833,16.01833,0,0,0,16,16H192.88867A15.12831,15.12831,0,0,0,208,200.88867V184h16.88867A15.12831,15.12831,0,0,0,240,168.88867V80A16.01833,16.01833,0,0,0,224,64Zm0,104H208V112a16.01833,16.01833,0,0,0-16-16H122.667L94.93359,75.2002A16.10323,16.10323,0,0,0,85.333,72H72V56h45.333l27.7334,20.7998A16.10323,16.10323,0,0,0,154.667,80H224Z"
        fill="currentColor"
      />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg
      className="file-tree__file-icon"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M14 22H10C6.22876 22 4.34315 22 3.17157 20.8284C2 19.6569 2 17.7712 2 14V10C2 6.22876 2 4.34315 3.17157 3.17157C4.34315 2 6.23869 2 10.0298 2C10.6358 2 11.1214 2 11.53 2.01666C11.5166 2.09659 11.5095 2.17813 11.5092 2.26057L11.5 5.09497C11.4999 6.19207 11.4998 7.16164 11.6049 7.94316C11.7188 8.79028 11.9803 9.63726 12.6716 10.3285C13.3628 11.0198 14.2098 11.2813 15.0569 11.3952C15.8385 11.5003 16.808 11.5002 17.9051 11.5001L18 11.5001H21.9574C22 12.0344 22 12.6901 22 13.5629V14C22 17.7712 22 19.6569 20.8284 20.8284C19.6569 22 17.7712 22 14 22ZM5.25 14.5C5.25 14.0858 5.58579 13.75 6 13.75H14C14.4142 13.75 14.75 14.0858 14.75 14.5C14.75 14.9142 14.4142 15.25 14 15.25H6C5.58579 15.25 5.25 14.9142 5.25 14.5ZM5.25 18C5.25 17.5858 5.58579 17.25 6 17.25H11.5C11.9142 17.25 12.25 17.5858 12.25 18C12.25 18.4142 11.9142 18.75 11.5 18.75H6C5.58579 18.75 5.25 18.4142 5.25 18Z"
        fill="currentColor"
      />
      <path
        d="M19.3517 7.61665L15.3929 4.05375C14.2651 3.03868 13.7012 2.53114 13.0092 2.26562L13 5.00011C13 7.35713 13 8.53564 13.7322 9.26787C14.4645 10.0001 15.643 10.0001 18 10.0001H21.5801C21.2175 9.29588 20.5684 8.71164 19.3517 7.61665Z"
        fill="currentColor"
      />
    </svg>
  )
}

function entryMatchesFilter(
  entry: RemoteFsEntry,
  query: string,
  childrenMap: Record<string, RemoteFsEntry[]>,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (entry.name.toLowerCase().includes(q)) return true
  if (!entry.isDir) return false
  const kids = childrenMap[entry.path]
  if (!kids) return false
  return kids.some((child) => entryMatchesFilter(child, q, childrenMap))
}

function TreeNode({
  path,
  depth,
  cwd,
  expanded,
  childrenMap,
  loadingPaths,
  selectedPaths,
  dropTarget,
  filterQuery,
  onToggle,
  onReveal,
  onGo,
  onEntryClick,
  onEntryContextMenu,
  onFileDoubleClick,
  onDropTarget,
  onDropFiles,
  goLabel,
  loadingLabel,
  emptyLabel,
}: {
  path: string
  depth: number
  cwd: string
  expanded: Set<string>
  childrenMap: Record<string, RemoteFsEntry[]>
  loadingPaths: Set<string>
  selectedPaths: Set<string>
  dropTarget: string | null
  filterQuery: string
  onToggle: (path: string) => void
  onReveal: (remotePath: string) => void
  onGo?: (remotePath: string) => void
  onEntryClick: (entry: RemoteFsEntry, event: ReactMouseEvent) => void
  onEntryContextMenu: (entry: RemoteFsEntry, event: ReactMouseEvent) => void
  onFileDoubleClick: (entry: RemoteFsEntry) => void
  onDropTarget: (remoteDir: string) => void
  onDropFiles: (remoteDir: string, event: ReactDragEvent) => void
  goLabel: string
  loadingLabel: string
  emptyLabel: string
}) {
  const onPath = parentChain(cwd).includes(path)
  const isExactCwd = cwd === path
  const kids = childrenMap[path]
  const visibleKids = kids?.filter((entry) =>
    entryMatchesFilter(entry, filterQuery, childrenMap),
  )
  const filtering = Boolean(filterQuery.trim())
  const isExpanded =
    expanded.has(path) || (filtering && (visibleKids?.length ?? 0) > 0)
  const loading = loadingPaths.has(path)
  const folderEntry: RemoteFsEntry = {
    name: displayName(path),
    path,
    isDir: true,
  }
  const folderSelected = path !== '/' && selectedPaths.has(path)
  const isDropTarget = dropTarget === path

  return (
    <div className="file-tree__node">
      <div
        className={`file-tree__row${isExactCwd ? ' is-cwd' : ''}${onPath ? ' is-on-path' : ''}${
          folderSelected ? ' is-selected' : ''
        }${isDropTarget ? ' is-drop-target' : ''}`}
        data-tree-path={path}
        style={{ paddingLeft: 10 + depth * 14 }}
        onDragOver={(event) => {
          event.preventDefault()
          event.stopPropagation()
          event.dataTransfer.dropEffect = 'copy'
          onDropTarget(path)
        }}
        onDrop={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onDropFiles(path, event)
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          onEntryContextMenu(folderEntry, event)
        }}
      >
        <button
          type="button"
          className="file-tree__main"
          onClick={(event) => {
            if (path !== '/' && (event.ctrlKey || event.metaKey || event.shiftKey)) {
              onEntryClick(folderEntry, event)
              return
            }
            onToggle(path)
          }}
          onDoubleClick={() => onReveal(path)}
          title={path}
        >
          <span className="file-tree__chevron">
            <ChevronIcon open={isExpanded} />
          </span>
          <FolderIcon />
          <span className="file-tree__label">{displayName(path)}</span>
        </button>
        {onGo ? (
          <button
            type="button"
            className="file-tree__go"
            title={`cd ${path}`}
            onClick={(event) => {
              event.stopPropagation()
              onGo(path)
            }}
          >
            {goLabel}
          </button>
        ) : null}
      </div>

      {isExpanded ? (
        <div className="file-tree__children">
          {loading && !kids ? (
            <div
              className="file-tree__meta"
              style={{ paddingLeft: 28 + depth * 14 }}
            >
              {loadingLabel}
            </div>
          ) : null}
          {visibleKids?.map((entry) =>
            entry.isDir ? (
              <TreeNode
                key={entry.path}
                path={entry.path}
                depth={depth + 1}
                cwd={cwd}
                expanded={expanded}
                childrenMap={childrenMap}
                loadingPaths={loadingPaths}
                selectedPaths={selectedPaths}
                dropTarget={dropTarget}
                filterQuery={filterQuery}
                onToggle={onToggle}
                onReveal={onReveal}
                onGo={onGo}
                onEntryClick={onEntryClick}
                onEntryContextMenu={onEntryContextMenu}
                onFileDoubleClick={onFileDoubleClick}
                onDropTarget={onDropTarget}
                onDropFiles={onDropFiles}
                goLabel={goLabel}
                loadingLabel={loadingLabel}
                emptyLabel={emptyLabel}
              />
            ) : (
              <button
                key={entry.path}
                type="button"
                className={`file-tree__row file-tree__row--file${
                  selectedPaths.has(entry.path) ? ' is-selected' : ''
                }`}
                style={{ paddingLeft: 24 + (depth + 1) * 14 }}
                title={entry.path}
                onClick={(event) => onEntryClick(entry, event)}
                onContextMenu={(event) => onEntryContextMenu(entry, event)}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  event.dataTransfer.dropEffect = 'copy'
                  onDropTarget(parentDir(entry.path))
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onDropFiles(parentDir(entry.path), event)
                }}
                onDoubleClick={(event) => {
                  event.preventDefault()
                  onFileDoubleClick(entry)
                }}
              >
                <span className="file-tree__chevron file-tree__chevron--spacer" />
                <FileIcon />
                <span className="file-tree__label">{entry.name}</span>
              </button>
            ),
          )}
          {kids && kids.length === 0 ? (
            <div
              className="file-tree__meta"
              style={{ paddingLeft: 28 + depth * 14 }}
            >
              {emptyLabel}
            </div>
          ) : null}
          {kids &&
          kids.length > 0 &&
          visibleKids &&
          visibleKids.length === 0 &&
          filterQuery.trim() ? (
            <div
              className="file-tree__meta"
              style={{ paddingLeft: 28 + depth * 14 }}
            >
              {emptyLabel}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function FileTreePanel({
  open,
  pinned,
  sessionId,
  onClose,
  onPinnedChange,
  onNavigate,
}: Props) {
  const { t } = useSettings()
  const [cwd, setCwd] = useState('/')
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['/']))
  const [childrenMap, setChildrenMap] = useState<Record<string, RemoteFsEntry[]>>(
    {},
  )
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [actionNote, setActionNote] = useState<string>()
  const [dragOver, setDragOver] = useState(false)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [namePrompt, setNamePrompt] = useState<{
    mode: 'mkdir' | 'mkfile' | 'rename'
    parentPath: string
    fromPath?: string
    value: string
  } | null>(null)
  const [filterQuery, setFilterQuery] = useState('')
  const [pathDraft, setPathDraft] = useState('/')
  const [pathEditing, setPathEditing] = useState(false)
  const lastSelectedRef = useRef<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const pathInputRef = useRef<HTMLInputElement>(null)
  const scrollTargetRef = useRef<string | null>(null)
  const pathCommitRef = useRef(false)
  const uploadRunningRef = useRef(false)
  const uploadQueueRef = useRef<
    Array<{ remoteDir: string; localPaths?: string[] }>
  >([])

  useEffect(() => {
    setFilterQuery('')
  }, [sessionId])

  const loadDir = useCallback(
    async (remotePath: string) => {
      if (!sessionId) return
      setLoadingPaths((prev) => new Set(prev).add(remotePath))
      try {
        const entries = await window.sshApi.fsList(sessionId, remotePath)
        setChildrenMap((prev) => ({ ...prev, [remotePath]: entries }))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to list directory')
      } finally {
        setLoadingPaths((prev) => {
          const next = new Set(prev)
          next.delete(remotePath)
          return next
        })
      }
    },
    [sessionId],
  )

  const refresh = useCallback(async () => {
    if (!sessionId) return
    setBusy(true)
    setError(undefined)
    try {
      const remoteCwd = await window.sshApi.fsCwd(sessionId)
      setCwd(remoteCwd)
      const chain = parentChain(remoteCwd)
      setExpanded(new Set(chain))
      setChildrenMap({})
      setSelectedPaths(new Set())
      lastSelectedRef.current = null
      await Promise.all(chain.map((path) => loadDir(path)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tree')
    } finally {
      setBusy(false)
    }
  }, [sessionId, loadDir])

  useEffect(() => {
    if (open && sessionId) {
      void refresh()
    }
    if (!open) {
      setSelectedPaths(new Set())
      lastSelectedRef.current = null
    }
  }, [open, sessionId, refresh])

  const onToggle = async (path: string) => {
    const willExpand = !expanded.has(path)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
    if (willExpand && !childrenMap[path]) {
      await loadDir(path)
    }
  }

  const cwdLabel = useMemo(() => cwd || '/', [cwd])
  const selectedList = useMemo(() => Array.from(selectedPaths), [selectedPaths])

  useEffect(() => {
    if (pathEditing || pathCommitRef.current) return
    setPathDraft(cwdLabel)
  }, [cwdLabel, pathEditing])

  useEffect(() => {
    if (!pathEditing) return
    const input = pathInputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [pathEditing])

  const beginPathEdit = () => {
    if (!sessionId) return
    setPathDraft(cwdLabel)
    setPathEditing(true)
  }

  const cancelPathEdit = () => {
    pathCommitRef.current = false
    setPathDraft(cwdLabel)
    setPathEditing(false)
  }

  const scheduleScrollToPath = useCallback((remotePath: string) => {
    scrollTargetRef.current = remotePath
    const run = () => {
      if (scrollTargetRef.current !== remotePath) return
      scrollFolderToTop(bodyRef.current, remotePath)
      scrollTargetRef.current = null
    }
    // Wait for tree rows to mount after expand/load.
    requestAnimationFrame(() => {
      requestAnimationFrame(run)
    })
    window.setTimeout(run, 80)
  }, [])

  const revealPath = useCallback(
    async (remotePath: string) => {
      const path = normalizeRemotePath(remotePath)
      setFilterQuery('')
      setCwd(path)
      setPathDraft(path)
      setError(undefined)
      const chain = parentChain(path)
      setExpanded(new Set(chain))
      setBusy(true)
      try {
        await Promise.all(chain.map((item) => loadDir(item)))
      } finally {
        setBusy(false)
      }
      scheduleScrollToPath(path)
      return path
    },
    [loadDir, scheduleScrollToPath],
  )

  const handleReveal = (remotePath: string) => {
    void revealPath(normalizeRemotePath(remotePath))
  }

  const handleGo = (remotePath: string) => {
    const path = normalizeRemotePath(remotePath)
    onNavigate?.(path)
    void revealPath(path)
  }

  const commitPathDraft = () => {
    const path = normalizeRemotePath(pathDraft)
    pathCommitRef.current = true
    setPathDraft(path)
    setPathEditing(false)
    if (path === normalizeRemotePath(cwd)) {
      scheduleScrollToPath(path)
      pathCommitRef.current = false
      return
    }
    // Breadcrumb edit only moves the tree highlight — terminal cwd stays put.
    void revealPath(path)
      .catch(() => undefined)
      .finally(() => {
        pathCommitRef.current = false
      })
  }

  const openEditor = async (remotePath: string) => {
    if (!sessionId) return
    setActionNote(undefined)
    try {
      await window.sshApi.openEditorWindow(sessionId, remotePath)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('editorLoadFailed'))
    }
  }

  const refreshDir = async (remotePath: string) => {
    await loadDir(remotePath)
    setExpanded((prev) => new Set(prev).add(remotePath))
  }

  const noteTransferResult = (
    mode: 'download' | 'upload',
    saved: number,
    cancelled: number,
    target?: string,
  ) => {
    if (saved <= 0 && cancelled > 0) {
      setActionNote(t('fileTransferCancelledOk'))
      return
    }
    if (saved > 0 && cancelled > 0) {
      setActionNote(
        formatMessage(t('fileTransferPartialOk'), {
          done: saved,
          cancelled,
        }),
      )
      return
    }
    if (saved <= 0) return
    if (mode === 'upload') {
      setActionNote(
        `${
          saved > 1
            ? formatMessage(t('fileUploadManyOk'), { count: saved })
            : t('fileUploadOk')
        }${target ? ` → ${target}` : ''}`,
      )
      return
    }
    setActionNote(
      saved > 1
        ? formatMessage(t('fileDownloadManyOk'), { count: saved })
        : t('fileDownloadOk'),
    )
  }

  const downloadItems = async (remotePaths: string[]) => {
    if (!sessionId || remotePaths.length === 0) return
    setActionNote(undefined)
    try {
      if (remotePaths.length === 1) {
        const result = await window.sshApi.fsDownload(sessionId, remotePaths[0])
        if (result.ok) {
          noteTransferResult('download', result.count, result.cancelled)
        }
        return
      }
      const result = await window.sshApi.fsDownloadMany(sessionId, remotePaths)
      if (result.ok) {
        noteTransferResult('download', result.count, result.cancelled)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fileDownloadFailed'))
    }
  }

  const runUploadJob = async (
    remoteDir: string,
    localPaths?: string[],
  ) => {
    if (!sessionId) return
    setError(undefined)
    try {
      const result = localPaths?.length
        ? await window.sshApi.fsUploadPaths(sessionId, localPaths, remoteDir)
        : await window.sshApi.fsUpload(sessionId, remoteDir)
      if (result.ok) {
        noteTransferResult(
          'upload',
          result.count,
          result.cancelled,
          remoteDir,
        )
        if (result.count > 0) {
          await refreshDir(remoteDir)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fileUploadFailed'))
    }
  }

  const uploadTo = async (remoteDir: string, localPaths?: string[]) => {
    if (!sessionId) return

    // While a transfer is running, queue more uploads instead of blocking drops.
    if (uploadRunningRef.current) {
      uploadQueueRef.current.push({ remoteDir, localPaths })
      emitTransferQueue(uploadQueueRef.current.length)
      setActionNote(
        formatMessage(t('fileUploadQueued'), {
          count: localPaths?.length ?? 1,
        }),
      )
      return
    }

    uploadRunningRef.current = true
    try {
      await runUploadJob(remoteDir, localPaths)
      while (uploadQueueRef.current.length > 0) {
        const next = uploadQueueRef.current.shift()
        emitTransferQueue(uploadQueueRef.current.length)
        if (!next) break
        await runUploadJob(next.remoteDir, next.localPaths)
      }
    } finally {
      uploadRunningRef.current = false
      uploadQueueRef.current = []
      emitTransferQueue(0)
    }
  }

  const deleteItems = async (remotePaths: string[]) => {
    if (!sessionId || remotePaths.length === 0) return
    const ok = await window.sshApi.confirmDialog({
      title: t('fileDelete'),
      message:
        remotePaths.length === 1
          ? formatMessage(t('fileDeleteConfirm'), {
              name: displayName(remotePaths[0]),
            })
          : formatMessage(t('fileDeleteConfirmMany'), {
              count: remotePaths.length,
            }),
      confirmLabel: t('fileDelete'),
      cancelLabel: t('cancel'),
    })
    if (!ok) return

    setBusy(true)
    setError(undefined)
    try {
      for (const remotePath of remotePaths) {
        await window.sshApi.fsRemove(sessionId, remotePath)
      }
      setActionNote(t('fileDeleteOk'))
      clearSelection()
      const parents = new Set(remotePaths.map((item) => parentDir(item)))
      await Promise.all(Array.from(parents).map((dir) => refreshDir(dir)))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fileOpFailed'))
    } finally {
      setBusy(false)
    }
  }

  const submitNamePrompt = async () => {
    if (!sessionId || !namePrompt) return
    const name = namePrompt.value.trim()
    if (!name || name.includes('/') || name.includes('\\')) {
      setError(t('fileOpFailed'))
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const remotePath =
        namePrompt.parentPath === '/'
          ? `/${name}`
          : `${namePrompt.parentPath}/${name}`
      if (namePrompt.mode === 'mkdir') {
        await window.sshApi.fsMkdir(sessionId, remotePath)
        await refreshDir(namePrompt.parentPath)
      } else if (namePrompt.mode === 'mkfile') {
        await window.sshApi.fsWrite(sessionId, remotePath, '')
        await refreshDir(namePrompt.parentPath)
      } else if (namePrompt.fromPath) {
        await window.sshApi.fsRename(sessionId, namePrompt.fromPath, remotePath)
        await refreshDir(namePrompt.parentPath)
        clearSelection()
      }
      setNamePrompt(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('fileOpFailed'))
    } finally {
      setBusy(false)
    }
  }

  const copyPaths = (remotePaths: string[]) => {
    window.sshApi.clipboardWriteText(remotePaths.join('\n'))
    setActionNote(
      remotePaths.length > 1 ? t('fileCopyPaths') : t('fileCopyPath'),
    )
  }

  const clearSelection = () => {
    setSelectedPaths(new Set())
    lastSelectedRef.current = null
  }

  const pathsFromDrop = (event: ReactDragEvent) => {
    const files = Array.from(event.dataTransfer.files)
    return files
      .map((file) => {
        try {
          const fromApi = window.sshApi.getPathForFile?.(file)
          if (fromApi) return fromApi
        } catch {
          // fall through
        }
        return (file as File & { path?: string }).path
      })
      .filter((item): item is string => Boolean(item))
  }

  const handlePanelDragOver = (event: ReactDragEvent) => {
    if (!sessionId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
    setDropTarget(cwd || '/')
  }

  const handlePanelDragLeave = (event: ReactDragEvent) => {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return
    setDragOver(false)
    setDropTarget(null)
  }

  const finishDrop = (remoteDir: string, event: ReactDragEvent) => {
    setDragOver(false)
    setDropTarget(null)
    if (!sessionId) return
    const localPaths = pathsFromDrop(event)
    if (localPaths.length === 0) {
      setError(t('fileUploadFailed'))
      return
    }
    void uploadTo(remoteDir || cwd || '/', localPaths)
  }

  const handlePanelDrop = (event: ReactDragEvent) => {
    event.preventDefault()
    finishDrop(dropTarget || cwd || '/', event)
  }

  const handleEntryClick = (entry: RemoteFsEntry, event: ReactMouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (entry.path === '/') return

    // Selection only with Ctrl/Cmd or Shift — plain LMB does not select.
    if (event.ctrlKey || event.metaKey) {
      setSelectedPaths((prev) => {
        const next = new Set(prev)
        if (next.has(entry.path)) next.delete(entry.path)
        else next.add(entry.path)
        lastSelectedRef.current = entry.path
        return next
      })
      return
    }

    if (event.shiftKey && lastSelectedRef.current) {
      const anchor = lastSelectedRef.current
      const dir = parentDir(entry.path)
      if (parentDir(anchor) === dir) {
        const siblings = childrenMap[dir]?.map((item) => item.path) ?? []
        const start = siblings.indexOf(anchor)
        const end = siblings.indexOf(entry.path)
        if (start >= 0 && end >= 0) {
          const [from, to] = start < end ? [start, end] : [end, start]
          setSelectedPaths((prev) => {
            const next = new Set(prev)
            for (let i = from; i <= to; i += 1) next.add(siblings[i])
            return next
          })
          return
        }
      }
    }

    if (event.shiftKey) {
      setSelectedPaths(new Set([entry.path]))
      lastSelectedRef.current = entry.path
    }
  }

  const showContextMenu = async (entry: RemoteFsEntry) => {
    // PCM never changes selection — act on current multi-selection only if the
    // clicked item is already selected; otherwise act on that item alone.
    const targets =
      selectedPaths.has(entry.path) && selectedPaths.size > 0
        ? Array.from(selectedPaths)
        : [entry.path]

    const multi = targets.length > 1
    const singleDir = !multi && entry.isDir
    const uploadTarget = entry.isDir ? entry.path : parentDir(entry.path)
    const items = multi
      ? [
          {
            id: 'download',
            label: formatMessage(t('fileDownloadSelected'), {
              count: targets.length,
            }),
          },
          { id: 'delete', label: t('fileDelete') },
          { id: 'copyPath', label: t('fileCopyPaths') },
          { id: 'clear', label: t('fileClearSelection') },
        ]
      : [
          ...(singleDir
            ? [
                { id: 'upload', label: t('fileUploadHere') },
                { id: 'mkfile', label: t('fileNewFile') },
                { id: 'mkdir', label: t('fileNewFolder') },
                { id: 'download', label: t('fileDownloadFolder') },
              ]
            : [
                { id: 'edit', label: t('fileEdit') },
                { id: 'download', label: t('fileDownload') },
              ]),
          ...(entry.path === '/'
            ? []
            : [
                { id: 'rename', label: t('fileRename') },
                { id: 'delete', label: t('fileDelete') },
              ]),
          { id: 'copyPath', label: t('fileCopyPath') },
        ]

    const action = await window.sshApi.showFileActionsMenu({ items })
    if (action === 'edit' && targets[0] && !entry.isDir) {
      void openEditor(targets[0])
    } else if (action === 'download') void downloadItems(targets)
    else if (action === 'upload') void uploadTo(uploadTarget)
    else if (action === 'mkdir') {
      setNamePrompt({
        mode: 'mkdir',
        parentPath: uploadTarget,
        value: '',
      })
    } else if (action === 'mkfile') {
      setNamePrompt({
        mode: 'mkfile',
        parentPath: uploadTarget,
        value: '',
      })
    } else if (action === 'rename' && targets[0]) {
      setNamePrompt({
        mode: 'rename',
        parentPath: parentDir(targets[0]),
        fromPath: targets[0],
        value: displayName(targets[0]),
      })
    } else if (action === 'delete') void deleteItems(targets)
    else if (action === 'copyPath') copyPaths(targets)
    else if (action === 'clear') clearSelection()
  }

  const handleEntryContextMenu = (
    entry: RemoteFsEntry,
    event: ReactMouseEvent,
  ) => {
    event.preventDefault()
    event.stopPropagation()
    void showContextMenu(entry)
  }

  return (
    <>
      {!pinned ? (
        <div
          className={`file-tree-backdrop${open ? ' is-open' : ''}`}
          onClick={onClose}
        />
      ) : null}
      <aside
        className={`file-tree-panel${open ? ' is-open' : ''}${
          pinned ? ' is-pinned' : ''
        }`}
        aria-hidden={!open}
      >
        <div className="file-tree-panel__header">
          <div className="file-tree-panel__header-row">
            <div className="file-tree-panel__heading">
              <div className="file-tree-panel__title">{t('treeTitle')}</div>
              {pathEditing && sessionId ? (
                <input
                  ref={pathInputRef}
                  type="text"
                  className="file-tree-panel__cwd file-tree-panel__cwd--edit"
                  value={pathDraft}
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  aria-label={t('treePath')}
                  onChange={(ev) => setPathDraft(ev.target.value)}
                  onMouseDown={(ev) => ev.stopPropagation()}
                  onClick={(ev) => ev.stopPropagation()}
                  onBlur={() => {
                    if (!pathCommitRef.current) {
                      cancelPathEdit()
                    }
                  }}
                  onKeyDown={(ev) => {
                    ev.stopPropagation()
                    if (ev.key === 'Enter') {
                      ev.preventDefault()
                      commitPathDraft()
                    }
                    if (ev.key === 'Escape') {
                      ev.preventDefault()
                      cancelPathEdit()
                    }
                  }}
                />
              ) : (
                <div
                  className="file-tree-panel__cwd"
                  title={
                    sessionId
                      ? `${cwdLabel}\n${t('treePathHint')}`
                      : cwdLabel
                  }
                  aria-label={t('treePath')}
                  onDoubleClick={(ev) => {
                    ev.preventDefault()
                    ev.stopPropagation()
                    beginPathEdit()
                  }}
                >
                  {cwdLabel}
                </div>
              )}
            </div>
            <button
              type="button"
              className={`btn-icon file-tree-panel__pin${
                pinned ? ' is-active' : ''
              }`}
              onClick={() => onPinnedChange(!pinned)}
              title={pinned ? t('treeUnpin') : t('treePin')}
              aria-label={pinned ? t('treeUnpin') : t('treePin')}
              aria-pressed={pinned}
            >
              <svg
                className="btn-icon__svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden
              >
                <path
                  d="M15.5 3.5L20.5 8.5L14.75 10.75L13.25 16.5L10.5 13.75L6.5 17.75L6.25 17.5L10.25 13.5L7.5 10.75L13.25 9.25L15.5 3.5Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  fill={pinned ? 'currentColor' : 'none'}
                />
                <path
                  d="M10.5 13.75L6 20"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
          {sessionId ? (
            <input
              type="search"
              className="file-tree-panel__search"
              value={filterQuery}
              onChange={(ev) => setFilterQuery(ev.target.value)}
              placeholder={t('treeSearch')}
              aria-label={t('treeSearch')}
            />
          ) : null}
        </div>

        <div
          ref={bodyRef}
          className={`file-tree-panel__body${dragOver ? ' is-dragover' : ''}`}
          onClick={() => clearSelection()}
          onDragOver={handlePanelDragOver}
          onDragLeave={handlePanelDragLeave}
          onDrop={handlePanelDrop}
        >
          {!sessionId ? (
            <div className="file-tree__meta">{t('treeConnectHint')}</div>
          ) : null}
          {sessionId ? (
            <div className="file-tree__hint">
              {dragOver && dropTarget
                ? formatMessage(t('fileDropTarget'), { path: dropTarget })
                : t('fileDropHint')}
            </div>
          ) : null}
          {error ? <div className="error-box">{error}</div> : null}
          {actionNote ? (
            <div className="file-tree__note">{actionNote}</div>
          ) : null}
          {sessionId ? (
            <div className="file-tree__hint">{t('fileSelectHint')}</div>
          ) : null}
          {sessionId ? (
            <div onClick={(event) => event.stopPropagation()}>
              <TreeNode
                path="/"
                depth={0}
                cwd={cwd}
                expanded={expanded}
                childrenMap={childrenMap}
                loadingPaths={loadingPaths}
                selectedPaths={selectedPaths}
                dropTarget={dropTarget}
                filterQuery={filterQuery}
                onToggle={(path) => void onToggle(path)}
                onReveal={handleReveal}
                onGo={onNavigate ? handleGo : undefined}
                onEntryClick={handleEntryClick}
                onEntryContextMenu={handleEntryContextMenu}
                onFileDoubleClick={(entry) => void openEditor(entry.path)}
                onDropTarget={setDropTarget}
                onDropFiles={finishDrop}
                goLabel={t('goTo')}
                loadingLabel={t('loading')}
                emptyLabel={
                  filterQuery.trim() ? t('treeSearchEmpty') : t('empty')
                }
              />
            </div>
          ) : null}
        </div>

        <div className="file-tree-panel__footer">
          {sessionId && selectedList.length > 0 ? (
            <div className="file-tree__selection">
              {formatMessage(t('fileSelectedCount'), {
                count: selectedList.length,
              })}
              <button
                type="button"
                className="file-tree__selection-clear"
                onClick={(event) => {
                  event.stopPropagation()
                  clearSelection()
                }}
              >
                {t('fileClearSelection')}
              </button>
            </div>
          ) : null}
          <div className="file-tree-panel__actions">
            {selectedList.length > 0 ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void downloadItems(selectedList)}
                disabled={!sessionId || busy}
                title={formatMessage(t('fileDownloadSelected'), {
                  count: selectedList.length,
                })}
              >
                {formatMessage(t('fileDownloadSelected'), {
                  count: selectedList.length,
                })}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void refresh()}
              disabled={!sessionId || busy}
              title={t('refresh')}
            >
              {t('refresh')}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              title={t('close')}
            >
              {t('close')}
            </button>
          </div>
        </div>
      </aside>

      {namePrompt ? (
        <div className="file-tree-prompt-backdrop" role="presentation">
          <div
            className="file-tree-prompt"
            role="dialog"
            aria-modal="true"
            aria-labelledby="file-tree-prompt-title"
          >
            <div className="field">
              <label htmlFor="file-tree-prompt-name" id="file-tree-prompt-title">
                {namePrompt.mode === 'mkdir'
                  ? t('fileFolderNamePrompt')
                  : namePrompt.mode === 'mkfile'
                    ? t('fileFileNamePrompt')
                    : t('fileNamePrompt')}
              </label>
              <input
                id="file-tree-prompt-name"
                autoFocus
                value={namePrompt.value}
                disabled={busy}
                onChange={(event) =>
                  setNamePrompt((prev) =>
                    prev ? { ...prev, value: event.target.value } : prev,
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void submitNamePrompt()
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setNamePrompt(null)
                  }
                }}
              />
            </div>
            <div className="file-tree-prompt__actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || !namePrompt.value.trim()}
                onClick={() => void submitNamePrompt()}
              >
                {t('confirm')}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setNamePrompt(null)}
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
