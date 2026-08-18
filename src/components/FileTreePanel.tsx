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
import { isImageFile } from '../imageFiles'
import { isArchiveFile } from '../archiveFiles'
import { formatAppError } from '../utils/formatAppError'
import { formatMessage } from '../utils/formatMessage'
import { FileTreeNode } from './file-tree/FileTreeNode'
import { ImageHoverPreview, IMAGE_HOVER_DELAY_MS } from './file-tree/ImageHoverPreview'
import {
  FileTreePrompts,
  type ConfirmPrompt,
  type NamePrompt,
} from './file-tree/FileTreePrompts'
import {
  INTERNAL_MOVE_MIME,
  canMovePathsTo,
  displayName,
  isRemoteDescendant,
  joinRemote,
  normalizeRemotePath,
  parentChain,
  parentDir,
  scrollFolderToTop,
} from './file-tree/paths'

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
  /** External file drag is over the app window (beacon the panel). */
  const [appFileDrag, setAppFileDrag] = useState(false)
  /** Cursor is inside the tree list — switch from panel beacon to folder target. */
  const [overTree, setOverTree] = useState(false)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const appDragDepthRef = useRef(0)
  const internalDragPathsRef = useRef<string[] | null>(null)
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const [namePrompt, setNamePrompt] = useState<NamePrompt | null>(null)
  const [confirmPrompt, setConfirmPrompt] = useState<ConfirmPrompt | null>(null)
  const [filterQuery, setFilterQuery] = useState('')
  const [pathDraft, setPathDraft] = useState('/')
  const [pathEditing, setPathEditing] = useState(false)
  const lastSelectedRef = useRef<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const pathInputRef = useRef<HTMLInputElement>(null)
  const imageHoverTimerRef = useRef(0)
  const [imageHover, setImageHover] = useState<{
    entry: RemoteFsEntry
    rect: DOMRect
  } | null>(null)
  const scrollTargetRef = useRef<string | null>(null)
  const pathCommitRef = useRef(false)
  const uploadRunningRef = useRef(false)
  const uploadQueueRef = useRef<
    Array<{ remoteDir: string; localPaths?: string[] }>
  >([])

  const clearImageHover = useCallback(() => {
    window.clearTimeout(imageHoverTimerRef.current)
    setImageHover(null)
  }, [])

  const handleImageHoverStart = useCallback(
    (entry: RemoteFsEntry, rect: DOMRect) => {
      window.clearTimeout(imageHoverTimerRef.current)
      imageHoverTimerRef.current = window.setTimeout(() => {
        setImageHover({ entry, rect })
      }, IMAGE_HOVER_DELAY_MS)
    },
    [],
  )

  useEffect(() => {
    if (!open || !sessionId) clearImageHover()
  }, [clearImageHover, open, sessionId])

  useEffect(() => {
    if (!open || !sessionId) {
      appDragDepthRef.current = 0
      setAppFileDrag(false)
      setOverTree(false)
      setDropTarget(null)
      return
    }

    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files')

    const clearAppDrag = () => {
      appDragDepthRef.current = 0
      setAppFileDrag(false)
      setOverTree(false)
      setDropTarget(null)
    }

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      appDragDepthRef.current += 1
      setAppFileDrag(true)
    }

    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      // Keep the OS "copy" cursor while files are over the window.
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      setAppFileDrag(true)
    }

    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return
      appDragDepthRef.current = Math.max(0, appDragDepthRef.current - 1)
      if (appDragDepthRef.current === 0) {
        setAppFileDrag(false)
        setOverTree(false)
        setDropTarget(null)
      }
    }

    const onDrop = () => {
      clearAppDrag()
    }

    const onDragEnd = () => {
      clearAppDrag()
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragend', onDragEnd)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', onDragEnd)
      clearAppDrag()
    }
  }, [open, sessionId])

  useEffect(() => {
    setFilterQuery('')
    setLoadingPaths(new Set())
  }, [sessionId])

  const loadDir = useCallback(
    async (remotePath: string) => {
      const loadFor = sessionId
      if (!loadFor) return
      setLoadingPaths((prev) => new Set(prev).add(remotePath))
      try {
        const entries = await window.sshApi.fsList(loadFor, remotePath)
        if (sessionIdRef.current !== loadFor) return
        setChildrenMap((prev) => ({ ...prev, [remotePath]: entries }))
      } catch (err) {
        if (sessionIdRef.current !== loadFor) return
        setError(formatAppError(err, t, 'errFileOpFailed'))
      } finally {
        if (sessionIdRef.current !== loadFor) return
        setLoadingPaths((prev) => {
          const next = new Set(prev)
          next.delete(remotePath)
          return next
        })
      }
    },
    [sessionId, t],
  )

  const refresh = useCallback(async () => {
    const loadFor = sessionId
    if (!loadFor) return
    setBusy(true)
    setError(undefined)
    try {
      const remoteCwd = await window.sshApi.fsCwd(loadFor)
      if (sessionIdRef.current !== loadFor) return
      setCwd(remoteCwd)
      const chain = parentChain(remoteCwd)
      setExpanded(new Set(chain))
      setChildrenMap({})
      setSelectedPaths(new Set())
      lastSelectedRef.current = null
      await Promise.all(chain.map((path) => loadDir(path)))
    } catch (err) {
      if (sessionIdRef.current !== loadFor) return
      setError(formatAppError(err, t, 'errFileOpFailed'))
    } finally {
      if (sessionIdRef.current === loadFor) {
        setBusy(false)
      }
    }
  }, [sessionId, loadDir, t])

  useEffect(() => {
    if (open && sessionId) {
      void refresh()
    }
    if (!open) {
      setSelectedPaths(new Set())
      lastSelectedRef.current = null
      setConfirmPrompt(null)
      setNamePrompt(null)
    }
  }, [open, sessionId, refresh])

  useEffect(() => {
    if (typeof window.sshApi.onFsRemoteChanged !== 'function') return
    return window.sshApi.onFsRemoteChanged((payload) => {
      if (!sessionId || payload.sessionId !== sessionId) return
      void loadDir(payload.remoteDir)
    })
  }, [sessionId, loadDir])

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
      setError(formatAppError(err, t, 'editorLoadFailed'))
    }
  }

  const openViewer = async (remotePath: string) => {
    if (!sessionId) return
    setActionNote(undefined)
    try {
      await window.sshApi.openViewerWindow(sessionId, remotePath)
    } catch (err) {
      setError(formatAppError(err, t, 'viewerLoadFailed'))
    }
  }

  const openArchive = async (remotePath: string) => {
    if (!sessionId) return
    setActionNote(undefined)
    if (typeof window.sshApi.openArchiveWindow !== 'function') {
      setError(t('archiveLoadFailed'))
      return
    }
    try {
      await window.sshApi.openArchiveWindow(sessionId, remotePath)
    } catch (err) {
      setError(formatAppError(err, t, 'archiveLoadFailed'))
    }
  }

  const openFile = (entry: RemoteFsEntry) => {
    if (isImageFile(entry.name) || isImageFile(entry.path)) {
      void openViewer(entry.path)
      return
    }
    if (isArchiveFile(entry.name) || isArchiveFile(entry.path)) {
      void openArchive(entry.path)
      return
    }
    void openEditor(entry.path)
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
      setError(formatAppError(err, t, 'fileDownloadFailed'))
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
      setError(formatAppError(err, t, 'fileUploadFailed'))
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

  const deleteItems = (remotePaths: string[]) => {
    if (!sessionId || remotePaths.length === 0) return
    setConfirmPrompt({
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
      danger: true,
      action: { type: 'delete', paths: remotePaths },
    })
  }

  const runDeleteItems = async (remotePaths: string[]) => {
    if (!sessionId || remotePaths.length === 0) return
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
      setError(formatAppError(err, t, 'fileOpFailed'))
    } finally {
      setBusy(false)
    }
  }

  const moveItems = (remotePaths: string[], targetDir: string) => {
    if (!sessionId || remotePaths.length === 0) return
    const moves = remotePaths
      .filter((src) => src && src !== '/')
      .filter((src) => parentDir(src) !== targetDir)
      .filter((src) => src !== targetDir && !isRemoteDescendant(targetDir, src))
      .map((src) => ({
        from: src,
        to: joinRemote(targetDir, displayName(src)),
      }))
      .filter((item) => item.from !== item.to)

    if (moves.length === 0) {
      setActionNote(t('fileMoveSame'))
      return
    }

    setConfirmPrompt({
      title: t('fileMove'),
      message:
        moves.length === 1
          ? formatMessage(t('fileMoveConfirm'), {
              name: displayName(moves[0].from),
              dest: targetDir,
            })
          : formatMessage(t('fileMoveConfirmMany'), {
              count: moves.length,
              dest: targetDir,
            }),
      confirmLabel: t('fileMove'),
      action: { type: 'move', moves, targetDir },
    })
  }

  const runMoveItems = async (
    moves: Array<{ from: string; to: string }>,
    targetDir: string,
  ) => {
    if (!sessionId || moves.length === 0) return
    setBusy(true)
    setError(undefined)
    try {
      for (const item of moves) {
        await window.sshApi.fsRename(sessionId, item.from, item.to)
      }
      setActionNote(
        formatMessage(t('fileMoveOk'), {
          count: moves.length,
          dest: targetDir,
        }),
      )
      clearSelection()
      const parents = new Set<string>([targetDir])
      for (const item of moves) parents.add(parentDir(item.from))
      await Promise.all(Array.from(parents).map((dir) => refreshDir(dir)))
    } catch (err) {
      setError(formatAppError(err, t, 'fileOpFailed'))
      await refreshDir(targetDir)
    } finally {
      setBusy(false)
    }
  }

  const submitConfirmPrompt = async () => {
    const prompt = confirmPrompt
    setConfirmPrompt(null)
    if (!prompt) return
    if (prompt.action.type === 'delete') {
      await runDeleteItems(prompt.action.paths)
      return
    }
    await runMoveItems(prompt.action.moves, prompt.action.targetDir)
  }

  const isExternalFileDrag = (event: ReactDragEvent | DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files')

  const readInternalMovePaths = (event: ReactDragEvent): string[] | null => {
    if (internalDragPathsRef.current?.length) {
      return internalDragPathsRef.current
    }
    try {
      const raw = event.dataTransfer.getData(INTERNAL_MOVE_MIME)
      if (!raw) return null
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return null
      return parsed.filter((item): item is string => typeof item === 'string')
    } catch {
      return null
    }
  }

  const handleEntryDragStart = (
    entry: RemoteFsEntry,
    event: ReactDragEvent,
  ) => {
    if (entry.path === '/') {
      event.preventDefault()
      return
    }
    const paths =
      selectedPaths.has(entry.path) && selectedPaths.size > 0
        ? Array.from(selectedPaths)
        : [entry.path]
    internalDragPathsRef.current = paths
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(INTERNAL_MOVE_MIME, JSON.stringify(paths))
    event.dataTransfer.setData('text/plain', paths.join('\n'))
  }

  const handleEntryDragEnd = () => {
    internalDragPathsRef.current = null
    setDropTarget(null)
    setOverTree(false)
  }

  const handleTreeDragOver = (targetDir: string, event: ReactDragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setOverTree(true)
    if (isExternalFileDrag(event)) {
      event.dataTransfer.dropEffect = 'copy'
      setDropTarget(targetDir)
      return
    }
    const sources = internalDragPathsRef.current
    if (sources && canMovePathsTo(sources, targetDir)) {
      event.dataTransfer.dropEffect = 'move'
      setDropTarget(targetDir)
      return
    }
    event.dataTransfer.dropEffect = 'none'
    setDropTarget(null)
  }

  const handleTreeDrop = (targetDir: string, event: ReactDragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setAppFileDrag(false)
    setOverTree(false)
    setDropTarget(null)
    appDragDepthRef.current = 0

    if (isExternalFileDrag(event)) {
      const localPaths = pathsFromDrop(event)
      internalDragPathsRef.current = null
      if (localPaths.length === 0) {
        setError(t('fileUploadFailed'))
        return
      }
      void uploadTo(targetDir || cwd || '/', localPaths)
      return
    }

    const sources = readInternalMovePaths(event)
    internalDragPathsRef.current = null
    if (!sources?.length) return
    if (!canMovePathsTo(sources, targetDir)) {
      setError(t('fileMoveInvalid'))
      return
    }
    moveItems(sources, targetDir)
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
      setError(formatAppError(err, t, 'fileOpFailed'))
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
    event.stopPropagation()
    setOverTree(true)
    if (isExternalFileDrag(event)) {
      event.dataTransfer.dropEffect = 'copy'
      setDropTarget(null)
      return
    }
    const sources = internalDragPathsRef.current
    const target = cwd || '/'
    if (sources && canMovePathsTo(sources, target)) {
      event.dataTransfer.dropEffect = 'move'
      setDropTarget(target)
      return
    }
    event.dataTransfer.dropEffect = 'none'
    setDropTarget(null)
  }

  const handlePanelDragLeave = (event: ReactDragEvent) => {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return
    setOverTree(false)
    setDropTarget(null)
  }

  const finishDrop = (remoteDir: string, event: ReactDragEvent) => {
    setAppFileDrag(false)
    setOverTree(false)
    setDropTarget(null)
    appDragDepthRef.current = 0
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
    event.stopPropagation()
    const targetDir = dropTarget || cwd || '/'
    if (isExternalFileDrag(event)) {
      finishDrop(targetDir, event)
      return
    }
    const sources = readInternalMovePaths(event)
    internalDragPathsRef.current = null
    setAppFileDrag(false)
    setOverTree(false)
    setDropTarget(null)
    appDragDepthRef.current = 0
    if (!sources?.length) return
    if (!canMovePathsTo(sources, targetDir)) {
      setError(t('fileMoveInvalid'))
      return
    }
    void moveItems(sources, targetDir)
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
                ...(isImageFile(entry.name)
                  ? [{ id: 'viewImage', label: t('fileViewImage') }]
                  : isArchiveFile(entry.name) || isArchiveFile(entry.path)
                    ? [{ id: 'openArchive', label: t('fileOpenArchive') }]
                    : [{ id: 'edit', label: t('fileEdit') }]),
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
    if (action === 'viewImage' && targets[0] && !entry.isDir) {
      void openViewer(targets[0])
    } else if (action === 'openArchive' && targets[0] && !entry.isDir) {
      void openArchive(targets[0])
    } else if (action === 'edit' && targets[0] && !entry.isDir) {
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
        }${appFileDrag && !overTree ? ' is-dragover' : ''}`}
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
          className="file-tree-panel__body"
          onClick={() => clearSelection()}
          onScroll={clearImageHover}
          onDragEnter={(event) => {
            if (!sessionId) return
            event.preventDefault()
            setOverTree(true)
          }}
          onDragOver={handlePanelDragOver}
          onDragLeave={handlePanelDragLeave}
          onDrop={handlePanelDrop}
        >
          {!sessionId ? (
            <div className="file-tree__meta">{t('treeConnectHint')}</div>
          ) : null}
          {sessionId ? (
            <div className="file-tree__hint">
              {appFileDrag
                ? formatMessage(t('fileDropTarget'), {
                    path: dropTarget || cwd || '/',
                  })
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
              <FileTreeNode
                path="/"
                depth={0}
                cwd={cwd}
                sessionId={sessionId}
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
                onFileDoubleClick={openFile}
                onEntryDragStart={handleEntryDragStart}
                onEntryDragEnd={handleEntryDragEnd}
                onTreeDragOver={handleTreeDragOver}
                onTreeDrop={handleTreeDrop}
                onImageHoverStart={handleImageHoverStart}
                onImageHoverEnd={clearImageHover}
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

      <FileTreePrompts
        busy={busy}
        namePrompt={namePrompt}
        confirmPrompt={confirmPrompt}
        t={t}
        setNamePrompt={setNamePrompt}
        setConfirmPrompt={setConfirmPrompt}
        onSubmitName={submitNamePrompt}
        onSubmitConfirm={submitConfirmPrompt}
      />
      {imageHover && sessionId ? (
        <ImageHoverPreview
          sessionId={sessionId}
          entry={imageHover.entry}
          anchor={imageHover.rect}
        />
      ) : null}
    </>
  )
}

