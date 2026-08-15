import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { v4 as uuid } from 'uuid'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { ConnectionForm } from './components/ConnectionForm'
import { TerminalView } from './components/TerminalView'
import { FileTreePanel } from './components/FileTreePanel'
import { SettingsPanel } from './components/SettingsPanel'
import { HotkeysPanel } from './components/HotkeysPanel'
import { UpdatePrompt } from './components/UpdatePrompt'
import { TransferDock } from './components/TransferDock'
import { ProgressBar } from './components/ProgressBar'
import { useSettings } from './i18n/SettingsContext'
import type { MessageKey } from './i18n/messages'
import {
  emptyDraft,
  type ConnectPayload,
  type ConnectionDraft,
  type ConnectionFolder,
  type FolderColor,
  type SavedConnection,
  type SessionStatus,
  type Workspace,
} from './types'

type TerminalTab = {
  key: string
  sessionId: string
  shellId: string | null
  title: string
  status: SessionStatus
  /** Always `user@host:port` for the toolbar / tab tooltip. */
  label: string
  connectionId?: string
  reconnectAttempt?: number
  pending?: boolean
}

type SessionRuntime = {
  payload: ConnectPayload
  wantConnected: boolean
  autoReconnect: boolean
  suppressReconnect: boolean
  reconnectTimer?: ReturnType<typeof setTimeout>
  reconnectAttempt: number
  pingFail: number
  label: string
  connectionId?: string
}

const TREE_PIN_KEY = 'customssh.fileTreePinned'

function readTreePinned(): boolean {
  try {
    return localStorage.getItem(TREE_PIN_KEY) === '1'
  } catch {
    return false
  }
}

function writeTreePinned(pinned: boolean) {
  try {
    localStorage.setItem(TREE_PIN_KEY, pinned ? '1' : '0')
  } catch {
    // ignore quota / private mode
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

function toDraft(connection?: SavedConnection | null): ConnectionDraft {
  if (!connection) return emptyDraft()
  return {
    id: connection.id,
    name: connection.name,
    host: connection.host,
    port: connection.port,
    username: connection.username,
    authMethod: connection.authMethod,
    password: '',
    privateKeyPath: connection.privateKeyPath ?? '',
    passphrase: '',
    folderId: connection.folderId ?? null,
  }
}

function validate(
  draft: ConnectionDraft,
  saved?: SavedConnection,
): MessageKey | null {
  if (!draft.name.trim()) return 'errName'
  if (!draft.host.trim()) return 'errHost'
  if (!draft.username.trim()) return 'errUsername'
  if (!draft.port || draft.port < 1 || draft.port > 65535) {
    return 'errPort'
  }
  if (
    draft.authMethod === 'password' &&
    !draft.password &&
    !saved?.password
  ) {
    return 'errPassword'
  }
  if (draft.authMethod === 'privateKey' && !draft.privateKeyPath.trim()) {
    return 'errPrivateKey'
  }
  return null
}

function applyWorkspace(
  workspace: Workspace,
  setFolders: (folders: ConnectionFolder[]) => void,
  setConnections: (connections: SavedConnection[]) => void,
) {
  setFolders(workspace.folders)
  setConnections(workspace.connections)
}

function connectionLabelOf(draft: ConnectionDraft) {
  if (!draft.host.trim()) return undefined
  return `${draft.username.trim() || 'user'}@${draft.host.trim()}:${draft.port || 22}`
}

function payloadLabel(payload: ConnectPayload) {
  return `${payload.username || 'user'}@${payload.host}:${payload.port || 22}`
}

function reorderTabs(
  list: TerminalTab[],
  fromKey: string,
  toKey: string,
): TerminalTab[] {
  if (fromKey === toKey) return list
  const fromIndex = list.findIndex((tab) => tab.key === fromKey)
  const toIndex = list.findIndex((tab) => tab.key === toKey)
  if (fromIndex < 0 || toIndex < 0) return list
  const next = [...list]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next
}

export default function App() {
  const { t, theme } = useSettings()
  const [folders, setFolders] = useState<ConnectionFolder[]>([])
  const [connections, setConnections] = useState<SavedConnection[]>([])
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<ConnectionDraft>(emptyDraft())
  const [selectedId, setSelectedId] = useState<string>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [treeOpen, setTreeOpen] = useState(false)
  const [treePinned, setTreePinned] = useState(readTreePinned)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [hotkeysOpen, setHotkeysOpen] = useState(false)
  const [pingMs, setPingMs] = useState<number | null>(null)
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeTabKey, setActiveTabKey] = useState<string | null>(null)
  const [renamingTabKey, setRenamingTabKey] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [openingShell, setOpeningShell] = useState(false)
  const [draggingTabKey, setDraggingTabKey] = useState<string | null>(null)
  const [dragOverTabKey, setDragOverTabKey] = useState<string | null>(null)
  const [sameReconnectPrompt, setSameReconnectPrompt] = useState<{
    target: string
  } | null>(null)
  const sameReconnectResolverRef = useRef<((ok: boolean) => void) | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)

  const tabsRef = useRef<TerminalTab[]>([])
  const activeTabKeyRef = useRef<string | null>(null)
  const sessionsRef = useRef<Map<string, SessionRuntime>>(new Map())
  const themeRef = useRef(theme)
  const tRef = useRef(t)
  const openingShellRef = useRef(false)
  const connectionsRef = useRef<SavedConnection[]>([])
  const treePinnedRef = useRef(treePinned)
  /** Ignore shell-closed events while intentionally replacing a tab's connection. */
  const ignoreShellClosedRef = useRef(new Set<string>())

  useEffect(() => {
    themeRef.current = theme
  }, [theme])

  useEffect(() => {
    tRef.current = t
  }, [t])

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  useEffect(() => {
    connectionsRef.current = connections
  }, [connections])

  useEffect(() => {
    activeTabKeyRef.current = activeTabKey
  }, [activeTabKey])

  useEffect(() => {
    treePinnedRef.current = treePinned
    writeTreePinned(treePinned)
  }, [treePinned])

  const closeTreeIfUnpinned = useCallback(() => {
    if (!treePinnedRef.current) setTreeOpen(false)
  }, [])

  const handleTreePinnedChange = useCallback((pinned: boolean) => {
    setTreePinned(pinned)
    if (pinned) setTreeOpen(true)
  }, [])

  const syncDraftFromTab = useCallback((tab: TerminalTab | null | undefined) => {
    if (!tab?.connectionId) return
    const connection = connectionsRef.current.find(
      (item) => item.id === tab.connectionId,
    )
    if (!connection) return
    setSelectedId(connection.id)
    setDraft(toDraft(connection))
  }, [])

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.key === activeTabKey) ?? null,
    [tabs, activeTabKey],
  )

  const patchTabsForSession = useCallback(
    (sessionId: string, patch: Partial<TerminalTab>) => {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.sessionId === sessionId ? { ...tab, ...patch } : tab,
        ),
      )
    },
    [],
  )

  const removeTabsForSession = useCallback((sessionId: string) => {
    setTabs((prev) => {
      const next = prev.filter((tab) => tab.sessionId !== sessionId)
      if (
        activeTabKeyRef.current &&
        prev.some(
          (tab) =>
            tab.key === activeTabKeyRef.current && tab.sessionId === sessionId,
        )
      ) {
        setActiveTabKey(next[next.length - 1]?.key ?? null)
      }
      return next
    })
  }, [])

  const clearReconnectTimer = useCallback((sessionId: string) => {
    const runtime = sessionsRef.current.get(sessionId)
    if (!runtime?.reconnectTimer) return
    clearTimeout(runtime.reconnectTimer)
    runtime.reconnectTimer = undefined
  }, [])

  const stopSessionReconnect = useCallback(
    (sessionId: string) => {
      const runtime = sessionsRef.current.get(sessionId)
      if (!runtime) return
      clearReconnectTimer(sessionId)
      runtime.wantConnected = false
      runtime.autoReconnect = false
      runtime.suppressReconnect = false
      runtime.reconnectAttempt = 0
      runtime.pingFail = 0
      patchTabsForSession(sessionId, { reconnectAttempt: 0 })
    },
    [clearReconnectTimer, patchTabsForSession],
  )

  const scheduleReconnect = useCallback(
    (sessionId: string) => {
      const runtime = sessionsRef.current.get(sessionId)
      if (!runtime?.wantConnected || !runtime.autoReconnect) return
      if (runtime.reconnectTimer != null) return

      runtime.reconnectAttempt += 1
      const attempt = runtime.reconnectAttempt
      patchTabsForSession(sessionId, {
        status: 'reconnecting',
        reconnectAttempt: attempt,
        shellId: null,
        pending: false,
      })
      closeTreeIfUnpinned()
      setPingMs(null)

      const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt - 1, 5))
      runtime.reconnectTimer = setTimeout(() => {
        runtime.reconnectTimer = undefined
        if (!runtime.wantConnected || !runtime.autoReconnect) return

        runtime.suppressReconnect = true
        patchTabsForSession(sessionId, {
          status: 'reconnecting',
          reconnectAttempt: runtime.reconnectAttempt,
        })

        void window.sshApi
          .connect(sessionId, {
            ...runtime.payload,
            theme: themeRef.current,
          })
          .then((result) => {
            runtime.autoReconnect = true
            const shellId = result?.shellId ?? null
            setTabs((prev) => {
              const sessionTabs = prev.filter((tab) => tab.sessionId === sessionId)
              const keepKey = sessionTabs[0]?.key
              const title =
                sessionTabs[0]?.title ??
                formatMessage(tRef.current('terminalTab'), { n: 1 })
              const others = prev.filter((tab) => tab.sessionId !== sessionId)
              if (!keepKey || !shellId) return others
              return [
                ...others,
                {
                  key: keepKey,
                  sessionId,
                  shellId,
                  title,
                  status: 'connected',
                  label: runtime.label || payloadLabel(runtime.payload),
                  connectionId: runtime.connectionId,
                  reconnectAttempt: 0,
                  pending: false,
                },
              ]
            })
          })
          .catch(() => {
            if (!runtime.wantConnected || !runtime.autoReconnect) return
            scheduleReconnect(sessionId)
          })
          .finally(() => {
            runtime.suppressReconnect = false
          })
      }, delay)
    },
    [closeTreeIfUnpinned, patchTabsForSession],
  )

  useEffect(() => {
    void window.sshApi.loadWorkspace().then((workspace) => {
      applyWorkspace(workspace, setFolders, setConnections)
    })
  }, [])

  useEffect(() => {
    return window.sshApi.onStatus((incomingSessionId, payload) => {
      const runtime = sessionsRef.current.get(incomingSessionId)
      if (!runtime) return

      if (payload.status === 'connected') {
        clearReconnectTimer(incomingSessionId)
        runtime.reconnectAttempt = 0
        runtime.autoReconnect = true
        runtime.suppressReconnect = false
        runtime.pingFail = 0
        patchTabsForSession(incomingSessionId, {
          status: 'connected',
          reconnectAttempt: 0,
          pending: false,
        })
        setBusy(false)
        setError(undefined)
        setEditOpen(false)
        if (treePinnedRef.current) setTreeOpen(true)
        return
      }

      if (payload.status === 'connecting') {
        if (!runtime.suppressReconnect) {
          patchTabsForSession(incomingSessionId, { status: 'connecting' })
        }
        return
      }

      if (payload.status === 'disconnected' || payload.status === 'error') {
        if (runtime.suppressReconnect) return

        runtime.pingFail = 0
        const userHangup = payload.reason === 'user'
        const shouldReconnect =
          !userHangup && runtime.wantConnected && runtime.autoReconnect

        if (shouldReconnect) {
          scheduleReconnect(incomingSessionId)
          return
        }

        sessionsRef.current.delete(incomingSessionId)
        removeTabsForSession(incomingSessionId)
        setBusy(false)
        if (payload.status === 'error') {
          setError(payload.message ?? tRef.current('errConnectionFailed'))
        }
        if (activeTabKeyRef.current == null) {
          closeTreeIfUnpinned()
          setPingMs(null)
        }
      }
    })
  }, [
    clearReconnectTimer,
    closeTreeIfUnpinned,
    patchTabsForSession,
    removeTabsForSession,
    scheduleReconnect,
  ])

  useEffect(() => {
    return window.sshApi.onShellClosed((incomingSessionId, shellId) => {
      const ignoreKey = `${incomingSessionId}:${shellId}`
      if (ignoreShellClosedRef.current.delete(ignoreKey)) return

      const runtime = sessionsRef.current.get(incomingSessionId)
      if (runtime?.suppressReconnect) return

      setTabs((prev) => {
        const next = prev.filter(
          (tab) =>
            !(tab.sessionId === incomingSessionId && tab.shellId === shellId),
        )
        if (
          activeTabKeyRef.current &&
          prev.some(
            (tab) =>
              tab.key === activeTabKeyRef.current &&
              tab.sessionId === incomingSessionId &&
              tab.shellId === shellId,
          )
        ) {
          setActiveTabKey(next[next.length - 1]?.key ?? null)
        }
        return next
      })
    })
  }, [])

  useEffect(() => {
    for (const runtime of sessionsRef.current.values()) {
      runtime.payload = { ...runtime.payload, theme }
    }
  }, [theme])

  useEffect(() => {
    return () => {
      for (const sessionId of sessionsRef.current.keys()) {
        clearReconnectTimer(sessionId)
      }
    }
  }, [clearReconnectTimer])

  useEffect(() => {
    if (!renamingTabKey) return
    const input = renameInputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [renamingTabKey])

  useEffect(() => {
    const sessionId = activeTab?.sessionId
    const status = activeTab?.status
    if (!sessionId || status !== 'connected') {
      setPingMs(null)
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      const runtime = sessionsRef.current.get(sessionId)
      if (!runtime) return
      try {
        const ms = await window.sshApi.ping(sessionId)
        if (cancelled) return
        runtime.pingFail = 0
        setPingMs(ms)
      } catch {
        if (cancelled) return
        setPingMs(null)
        runtime.pingFail += 1
        if (
          runtime.pingFail >= 2 &&
          runtime.wantConnected &&
          runtime.autoReconnect
        ) {
          runtime.pingFail = 0
          window.sshApi.disconnect(sessionId, 'drop')
          return
        }
      }
      if (!cancelled) {
        timer = setTimeout(() => {
          void tick()
        }, 3000)
      }
    }

    void tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [activeTab?.sessionId, activeTab?.status])

  useEffect(() => {
    for (const tab of tabs) {
      if (tab.status === 'connected' && tab.sessionId) {
        window.sshApi.applyTheme(tab.sessionId, theme)
      }
    }
  }, [theme, tabs])

  const activateTab = (tabKey: string) => {
    setActiveTabKey(tabKey)
    const tab = tabsRef.current.find((item) => item.key === tabKey)
    syncDraftFromTab(tab)
  }

  const beginRenameTab = (tabKey: string, title: string) => {
    activateTab(tabKey)
    setRenamingTabKey(tabKey)
    setRenameDraft(title)
  }

  const commitRenameTab = () => {
    if (!renamingTabKey) return
    const next = renameDraft.trim()
    if (next) {
      setTabs((prev) =>
        prev.map((tab) =>
          tab.key === renamingTabKey ? { ...tab, title: next } : tab,
        ),
      )
    }
    setRenamingTabKey(null)
    setRenameDraft('')
  }

  const cancelRenameTab = () => {
    setRenamingTabKey(null)
    setRenameDraft('')
  }

  const handleSelect = (connection: SavedConnection) => {
    setSelectedId(connection.id)
    setDraft(toDraft(connection))
    setError(undefined)
    setEditOpen(true)
  }

  const handleNew = () => {
    setSelectedId(undefined)
    setDraft(emptyDraft())
    setError(undefined)
    setEditOpen(true)
  }

  const handleSave = async () => {
    const saved = connections.find((item) => item.id === draft.id)
    const validationError = validate(draft, saved)
    if (validationError) {
      setError(t(validationError))
      return
    }

    const now = new Date().toISOString()
    const connection: SavedConnection = {
      id: draft.id ?? uuid(),
      name: draft.name.trim(),
      host: draft.host.trim(),
      port: draft.port,
      username: draft.username.trim(),
      authMethod: draft.authMethod,
      password:
        draft.authMethod === 'password'
          ? draft.password || saved?.password
          : undefined,
      privateKeyPath:
        draft.authMethod === 'privateKey' ? draft.privateKeyPath.trim() : undefined,
      passphrase:
        draft.authMethod === 'privateKey'
          ? draft.passphrase || saved?.passphrase
          : undefined,
      folderId: draft.folderId,
      createdAt: saved?.createdAt ?? now,
      updatedAt: now,
      lastConnectedAt: saved?.lastConnectedAt,
    }

    const workspace = await window.sshApi.saveConnection(connection)
    applyWorkspace(workspace, setFolders, setConnections)
    setSelectedId(connection.id)
    setDraft(toDraft(connection))
    setError(undefined)
  }

  const handleDelete = async () => {
    if (!draft.id) return
    for (const [sessionId, runtime] of sessionsRef.current) {
      if (runtime.connectionId === draft.id) {
        stopSessionReconnect(sessionId)
        window.sshApi.disconnect(sessionId, 'user')
        sessionsRef.current.delete(sessionId)
        removeTabsForSession(sessionId)
      }
    }
    const workspace = await window.sshApi.deleteConnection(draft.id)
    applyWorkspace(workspace, setFolders, setConnections)
    handleNew()
  }

  const handleBrowseKey = async () => {
    const path = await window.sshApi.openPrivateKeyDialog()
    if (path) {
      setDraft((prev) => ({ ...prev, privateKeyPath: path }))
    }
  }

  const isSameActiveTarget = (
    tab: TerminalTab,
    payload: ConnectPayload,
    connectionId?: string,
  ) => {
    if (
      tab.status !== 'connected' &&
      tab.status !== 'connecting' &&
      tab.status !== 'reconnecting'
    ) {
      return false
    }
    if (connectionId && tab.connectionId && tab.connectionId === connectionId) {
      return true
    }
    const runtime = sessionsRef.current.get(tab.sessionId)
    if (runtime) {
      return (
        runtime.payload.host === payload.host &&
        runtime.payload.port === payload.port &&
        runtime.payload.username === payload.username
      )
    }
    return tab.label === payloadLabel(payload)
  }

  const handleConnect = async () => {
    const saved = connections.find((item) => item.id === draft.id)
    const validationError = validate(draft, saved)
    if (validationError) {
      setError(t(validationError))
      return
    }

    const payload: ConnectPayload = {
      host: draft.host.trim(),
      port: draft.port,
      username: draft.username.trim(),
      authMethod: draft.authMethod,
      password: draft.password || saved?.password,
      privateKeyPath: draft.privateKeyPath.trim() || undefined,
      passphrase: draft.passphrase || saved?.passphrase,
      cols: 120,
      rows: 30,
      theme,
    }
    const label = payloadLabel(payload)
    const title = draft.name.trim() || label

    const current = activeTab
    if (current && isSameActiveTarget(current, payload, draft.id)) {
      const proceed = await new Promise<boolean>((resolve) => {
        sameReconnectResolverRef.current = resolve
        setSameReconnectPrompt({ target: current.label || label })
      })
      if (!proceed) return
    }

    setBusy(true)
    setError(undefined)
    closeTreeIfUnpinned()
    setPingMs(null)

    const nextSessionId = uuid()
    // Reconnect only the active tab; keep every other tab as-is.
    const replaceSessionId = current?.sessionId
    const replaceShellId = current?.shellId
    const tabKey = current?.key ?? uuid()

    const siblingCount = replaceSessionId
      ? tabsRef.current.filter(
          (tab) =>
            tab.sessionId === replaceSessionId && tab.key !== tabKey,
        ).length
      : 0

    sessionsRef.current.set(nextSessionId, {
      payload,
      wantConnected: true,
      autoReconnect: false,
      suppressReconnect: false,
      reconnectAttempt: 0,
      pingFail: 0,
      label,
      connectionId: draft.id,
    })

    const nextTab: TerminalTab = {
      key: tabKey,
      sessionId: nextSessionId,
      shellId: null,
      title,
      status: 'connecting',
      label,
      connectionId: draft.id,
      pending: false,
    }

    // Move the active tab to the new session first so shell-closed events from
    // the old connection cannot remove it (or other tabs).
    setTabs((prev) => {
      if (!current) return [...prev, nextTab]
      return prev.map((tab) => (tab.key === tabKey ? nextTab : tab))
    })
    setActiveTabKey(tabKey)

    if (replaceSessionId) {
      if (replaceShellId) {
        ignoreShellClosedRef.current.add(
          `${replaceSessionId}:${replaceShellId}`,
        )
      }
      if (siblingCount === 0) {
        stopSessionReconnect(replaceSessionId)
        sessionsRef.current.delete(replaceSessionId)
        window.sshApi.disconnect(replaceSessionId, 'user')
      } else if (replaceShellId) {
        window.sshApi.closeShell(replaceSessionId, replaceShellId)
      }
    }

    try {
      const result = await window.sshApi.connect(nextSessionId, payload)
      const runtime = sessionsRef.current.get(nextSessionId)
      if (runtime) {
        runtime.autoReconnect = true
        runtime.wantConnected = true
      }
      setTabs((prev) =>
        prev.map((tab) =>
          tab.key === tabKey
            ? {
                ...tab,
                shellId: result?.shellId ?? null,
                status: 'connected',
                title,
                label,
                connectionId: draft.id,
                pending: false,
              }
            : tab,
        ),
      )

      if (draft.id) {
        const workspace = await window.sshApi.touchConnection(draft.id)
        applyWorkspace(workspace, setFolders, setConnections)
      }
    } catch (err) {
      const runtime = sessionsRef.current.get(nextSessionId)
      if (runtime) {
        runtime.wantConnected = false
        runtime.autoReconnect = false
      }
      sessionsRef.current.delete(nextSessionId)
      setTabs((prev) => prev.filter((tab) => tab.key !== tabKey))
      if (activeTabKeyRef.current === tabKey) {
        setActiveTabKey(
          tabsRef.current.filter((tab) => tab.key !== tabKey).at(-1)?.key ??
            null,
        )
      }
      const message =
        err instanceof Error ? err.message : t('errConnectFailed')
      setError(message)
      setBusy(false)
    }
  }

  const handleDisconnect = () => {
    const tab = activeTab
    if (!tab) return
    stopSessionReconnect(tab.sessionId)
    window.sshApi.disconnect(tab.sessionId, 'user')
    sessionsRef.current.delete(tab.sessionId)
    removeTabsForSession(tab.sessionId)
    closeTreeIfUnpinned()
    setPingMs(null)
    setBusy(false)
  }

  const handleOpenShell = async () => {
    const tab = activeTab
    if (!tab || tab.status !== 'connected' || !tab.sessionId) return
    if (openingShellRef.current) return

    openingShellRef.current = true
    setOpeningShell(true)

    const tabKey = uuid()
    const n = tabsRef.current.length + 1
    const title = formatMessage(t('terminalTab'), { n })

    const runtime = sessionsRef.current.get(tab.sessionId)
    const label =
      tab.label ||
      runtime?.label ||
      (runtime ? payloadLabel(runtime.payload) : tab.title)

    setTabs((prev) => [
      ...prev,
      {
        key: tabKey,
        sessionId: tab.sessionId,
        shellId: null,
        title,
        status: 'connected',
        label,
        connectionId: tab.connectionId,
        pending: true,
      },
    ])
    setActiveTabKey(tabKey)

    try {
      const { shellId } = await window.sshApi.openShell(tab.sessionId)
      setTabs((prev) =>
        prev.map((item) =>
          item.key === tabKey
            ? { ...item, shellId, pending: false }
            : item,
        ),
      )
    } catch (err) {
      setTabs((prev) => prev.filter((item) => item.key !== tabKey))
      setActiveTabKey(tab.key)
      setError(err instanceof Error ? err.message : t('errConnectionFailed'))
    } finally {
      openingShellRef.current = false
      setOpeningShell(false)
    }
  }

  const handleCloseTab = (tabKey: string) => {
    const tab = tabsRef.current.find((item) => item.key === tabKey)
    if (!tab) return

    const sessionTabs = tabsRef.current.filter(
      (item) => item.sessionId === tab.sessionId,
    )

    if (sessionTabs.length <= 1) {
      stopSessionReconnect(tab.sessionId)
      window.sshApi.disconnect(tab.sessionId, 'user')
      sessionsRef.current.delete(tab.sessionId)
      removeTabsForSession(tab.sessionId)
      setBusy(false)
      return
    }

    if (tab.shellId) {
      window.sshApi.closeShell(tab.sessionId, tab.shellId)
    } else {
      setTabs((prev) => prev.filter((item) => item.key !== tabKey))
      if (activeTabKeyRef.current === tabKey) {
        setActiveTabKey(
          tabsRef.current.filter((item) => item.key !== tabKey).at(-1)?.key ??
            null,
        )
      }
    }
  }

  const pingLevel =
    pingMs == null
      ? 'unknown'
      : pingMs < 80
        ? 'good'
        : pingMs < 180
          ? 'fair'
          : 'poor'

  const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

  const handleTreeNavigate = (remotePath: string) => {
    if (
      !activeTab?.sessionId ||
      activeTab.status !== 'connected' ||
      !activeTab.shellId
    ) {
      return
    }
    window.sshApi.write(
      activeTab.sessionId,
      `cd ${shellQuote(remotePath)}\n`,
      activeTab.shellId,
    )
  }

  const handleCreateFolder = async () => {
    const now = new Date().toISOString()
    const folder: ConnectionFolder = {
      id: uuid(),
      name: t('newFolderDefault'),
      color: 'blue',
      createdAt: now,
      updatedAt: now,
    }
    const workspace = await window.sshApi.saveFolder(folder)
    applyWorkspace(workspace, setFolders, setConnections)
  }

  const handleRenameFolder = async (folderId: string, name: string) => {
    const current = folders.find((item) => item.id === folderId)
    if (!current) return
    const workspace = await window.sshApi.saveFolder({
      ...current,
      name,
      updatedAt: new Date().toISOString(),
    })
    applyWorkspace(workspace, setFolders, setConnections)
  }

  const handleChangeFolderColor = async (
    folderId: string,
    color: FolderColor,
  ) => {
    const current = folders.find((item) => item.id === folderId)
    if (!current) return
    const workspace = await window.sshApi.saveFolder({
      ...current,
      color,
      updatedAt: new Date().toISOString(),
    })
    applyWorkspace(workspace, setFolders, setConnections)
  }

  const handleDeleteFolder = async (folderId: string) => {
    const workspace = await window.sshApi.deleteFolder(folderId)
    applyWorkspace(workspace, setFolders, setConnections)
    if (draft.folderId === folderId) {
      setDraft((prev) => ({ ...prev, folderId: null }))
    }
  }

  const handleMoveConnection = async (
    connectionId: string,
    folderId: string | null,
  ) => {
    const current = connections.find((item) => item.id === connectionId)
    if (!current) return
    const workspace = await window.sshApi.saveConnection({
      ...current,
      folderId,
      updatedAt: new Date().toISOString(),
    })
    applyWorkspace(workspace, setFolders, setConnections)
    if (draft.id === connectionId) {
      setDraft((prev) => ({ ...prev, folderId }))
    }
  }

  useEffect(() => {
    const root = document.documentElement
    const syncChrome = (state: { maximized: boolean; fullscreen: boolean }) => {
      root.classList.toggle(
        'is-maximized',
        state.maximized || state.fullscreen,
      )
    }
    void window.sshApi.windowIsFullscreen().then((fullscreen) => {
      syncChrome({ maximized: false, fullscreen })
    })
    return window.sshApi.onWindowState((state) => {
      syncChrome(state)
    })
  }, [])

  const status = activeTab?.status ?? (tabs.length > 0 ? 'connected' : 'idle')
  const reconnectAttempt = activeTab?.reconnectAttempt ?? 0
  const toolbarLabel =
    (activeTab?.label && activeTab.label.trim()) ||
    connectionLabelOf(draft) ||
    undefined
  const toolbarTitle =
    (activeTab?.title && activeTab.title.trim()) ||
    draft.name.trim() ||
    toolbarLabel ||
    t('untitledConnection')

  const statusLabel =
    status === 'idle'
      ? t('statusIdle')
      : status === 'connecting'
        ? t('statusConnecting')
        : status === 'reconnecting'
          ? formatMessage(t('statusReconnecting'), {
              attempt: Math.max(reconnectAttempt, 1),
            })
          : status === 'connected'
            ? t('statusConnected')
            : status === 'disconnected'
              ? t('statusDisconnected')
              : t('statusError')

  return (
    <div className="app">
      <TitleBar />
      <div className="app__main">
      <div className="layout">
        <Sidebar
          folders={folders}
          connections={connections}
          selectedId={selectedId}
          query={query}
          onQueryChange={setQuery}
          onSelect={handleSelect}
          onNew={handleNew}
          onCreateFolder={() => void handleCreateFolder()}
          onRenameFolder={(id, name) => void handleRenameFolder(id, name)}
          onChangeFolderColor={(id, color) =>
            void handleChangeFolderColor(id, color)
          }
          onDeleteFolder={(id) => void handleDeleteFolder(id)}
          onMoveConnection={(id, folderId) =>
            void handleMoveConnection(id, folderId)
          }
          onOpenSettings={() => {
            setHotkeysOpen(false)
            setSettingsOpen(true)
          }}
          onOpenHotkeys={() => {
            setSettingsOpen(false)
            setHotkeysOpen(true)
          }}
        />

        <main className="main">
          <div className="toolbar">
            <div className="toolbar__left">
              <div className="toolbar__title">{toolbarTitle}</div>
              <div className="toolbar__subtitle">
                {toolbarLabel ?? t('configureHost')}
              </div>
            </div>

            <div className="toolbar__actions">
              <div className="toolbar__status">
                <div
                  className={`status-pill${
                    status === 'connecting' || status === 'reconnecting'
                      ? ' is-connecting'
                      : status === 'connected'
                        ? ' is-connected'
                        : status === 'error'
                          ? ' is-error'
                          : ''
                  }`}
                >
                  <span className="status-pill__dot" />
                  {statusLabel}
                </div>
                {status === 'connecting' || status === 'reconnecting' ? (
                  <div className="toolbar__status-progress">
                    <ProgressBar indeterminate />
                  </div>
                ) : null}
              </div>

              {status === 'connected' ? (
                <div className={`ping-pill is-${pingLevel}`} title={t('ping')}>
                  <span className="ping-pill__dot" />
                  <span className="ping-pill__value">
                    {pingMs == null ? t('pingMeasuring') : `${pingMs} ms`}
                  </span>
                </div>
              ) : null}

              {status === 'connected' ? (
                <button
                  type="button"
                  className={`btn-icon${treeOpen ? ' is-active' : ''}`}
                  onClick={() => setTreeOpen((open) => !open)}
                  title={t('directoryTree')}
                  aria-label={t('directoryTree')}
                >
                  <svg
                    className="btn-icon__svg"
                    width="16"
                    height="16"
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
                </button>
              ) : null}

              {status === 'connected' ||
              status === 'connecting' ||
              status === 'reconnecting' ? (
                <button
                  type="button"
                  className="btn-icon"
                  onClick={handleDisconnect}
                  title={t('disconnect')}
                  aria-label={t('disconnect')}
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
                      d="M12 2V6"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M12.75 2.75C12.75 2.33579 12.4142 2 12 2C11.5858 2 11.25 2.33579 11.25 2.75V6.75C11.25 7.16421 11.5858 7.5 12 7.5C12.4142 7.5 12.75 7.16421 12.75 6.75V2.75Z"
                      fill="currentColor"
                    />
                    <path
                      d="M8.7919 5.14692C9.17345 4.98571 9.35208 4.54571 9.19087 4.16416C9.02966 3.7826 8.58966 3.60398 8.2081 3.76519C4.70832 5.24386 2.25 8.70905 2.25 12.7501C2.25 18.1349 6.61522 22.5001 12 22.5001C17.3848 22.5001 21.75 18.1349 21.75 12.7501C21.75 8.70905 19.2917 5.24386 15.7919 3.76519C15.4103 3.60398 14.9703 3.7826 14.8091 4.16416C14.6479 4.54571 14.8265 4.98571 15.2081 5.14692C18.1722 6.39927 20.25 9.33293 20.25 12.7501C20.25 17.3065 16.5563 21.0001 12 21.0001C7.44365 21.0001 3.75 17.3065 3.75 12.7501C3.75 9.33293 5.82779 6.39927 8.7919 5.14692Z"
                      fill="currentColor"
                    />
                  </svg>
                </button>
              ) : null}
            </div>
          </div>

          <div className="main__workspace">
          <div className={`content${editOpen ? '' : ' content--editor-hidden'}`}>
            <div
              className={`editor-pane${editOpen ? ' is-open' : ' is-closed'}`}
              aria-hidden={!editOpen}
            >
              <ConnectionForm
                draft={draft}
                folders={folders}
                busy={busy}
                error={error}
                onChange={setDraft}
                onSave={() => void handleSave()}
                onConnect={() => void handleConnect()}
                onDelete={draft.id ? () => void handleDelete() : undefined}
                onBrowseKey={() => void handleBrowseKey()}
                onClose={() => setEditOpen(false)}
              />
            </div>
            <div className="terminal-stack">
              {tabs.length > 0 ? (
                <div className="terminal-tabs" role="tablist">
                  {tabs.map((tab) => (
                    <div
                      key={tab.key}
                      className={`terminal-tab${
                        tab.key === activeTabKey ? ' is-active' : ''
                      }${renamingTabKey === tab.key ? ' is-renaming' : ''}${
                        tab.pending ? ' is-pending' : ''
                      }${draggingTabKey === tab.key ? ' is-dragging' : ''}${
                        dragOverTabKey === tab.key ? ' is-drag-over' : ''
                      }`}
                      role="tab"
                      aria-selected={tab.key === activeTabKey}
                      draggable={renamingTabKey !== tab.key}
                      onDragStart={(ev) => {
                        if (renamingTabKey === tab.key) {
                          ev.preventDefault()
                          return
                        }
                        ev.dataTransfer.effectAllowed = 'move'
                        ev.dataTransfer.setData('text/plain', tab.key)
                        setDraggingTabKey(tab.key)
                      }}
                      onDragEnd={() => {
                        setDraggingTabKey(null)
                        setDragOverTabKey(null)
                      }}
                      onDragOver={(ev) => {
                        if (!draggingTabKey || draggingTabKey === tab.key) return
                        ev.preventDefault()
                        ev.dataTransfer.dropEffect = 'move'
                        setDragOverTabKey(tab.key)
                      }}
                      onDragLeave={(ev) => {
                        if (
                          ev.currentTarget.contains(ev.relatedTarget as Node)
                        ) {
                          return
                        }
                        if (dragOverTabKey === tab.key) {
                          setDragOverTabKey(null)
                        }
                      }}
                      onDrop={(ev) => {
                        ev.preventDefault()
                        const fromKey =
                          ev.dataTransfer.getData('text/plain') || draggingTabKey
                        if (!fromKey) return
                        setTabs((prev) => reorderTabs(prev, fromKey, tab.key))
                        setDraggingTabKey(null)
                        setDragOverTabKey(null)
                      }}
                    >
                      {renamingTabKey === tab.key ? (
                        <input
                          ref={renameInputRef}
                          className="terminal-tab__rename"
                          value={renameDraft}
                          aria-label={t('terminalRenameTab')}
                          onChange={(ev) => setRenameDraft(ev.target.value)}
                          onClick={(ev) => ev.stopPropagation()}
                          onBlur={() => commitRenameTab()}
                          onKeyDown={(ev) => {
                            if (ev.key === 'Enter') {
                              ev.preventDefault()
                              commitRenameTab()
                            }
                            if (ev.key === 'Escape') {
                              ev.preventDefault()
                              cancelRenameTab()
                            }
                          }}
                        />
                      ) : (
                        <span
                          className="terminal-tab__label"
                          title={
                            tab.label
                              ? `${tab.title} — ${tab.label}`
                              : t('terminalRenameTab')
                          }
                          onClick={() => activateTab(tab.key)}
                          onDoubleClick={(ev) => {
                            ev.preventDefault()
                            beginRenameTab(tab.key, tab.title)
                          }}
                        >
                          {tab.title}
                          {tab.pending ? '…' : ''}
                        </span>
                      )}
                      <button
                        type="button"
                        className="terminal-tab__close"
                        title={t('terminalCloseTab')}
                        aria-label={t('terminalCloseTab')}
                        draggable={false}
                        onMouseDown={(ev) => ev.stopPropagation()}
                        onClick={(ev) => {
                          ev.stopPropagation()
                          if (renamingTabKey === tab.key) {
                            cancelRenameTab()
                          }
                          handleCloseTab(tab.key)
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="terminal-tab__add"
                    title={t('terminalNewTab')}
                    aria-label={t('terminalNewTab')}
                    disabled={
                      openingShell ||
                      !activeTab ||
                      activeTab.status !== 'connected'
                    }
                    onClick={() => void handleOpenShell()}
                  >
                    +
                  </button>
                </div>
              ) : null}
              <div className="terminal-stack__views">
                {tabs.length === 0 ? (
                  <TerminalView
                    sessionId={null}
                    shellId={null}
                    status="idle"
                    active
                    connectionLabel={connectionLabelOf(draft)}
                  />
                ) : (
                  tabs.map((tab) => (
                    <TerminalView
                      key={tab.key}
                      sessionId={tab.sessionId}
                      shellId={tab.shellId}
                      status={tab.status}
                      active={tab.key === activeTabKey}
                      connectionLabel={tab.label}
                      reconnectAttempt={tab.reconnectAttempt ?? 0}
                    />
                  ))
                )}
              </div>
            </div>
          </div>

          <FileTreePanel
            open={treeOpen}
            pinned={treePinned}
            sessionId={
              activeTab?.status === 'connected' ? activeTab.sessionId : null
            }
            onClose={() => setTreeOpen(false)}
            onPinnedChange={handleTreePinnedChange}
            onNavigate={handleTreeNavigate}
          />
          </div>
        </main>
      </div>
      <TransferDock />
      </div>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onWorkspaceChange={(workspace) => {
          applyWorkspace(workspace, setFolders, setConnections)
        }}
      />

      <HotkeysPanel
        open={hotkeysOpen}
        onClose={() => setHotkeysOpen(false)}
      />

      <UpdatePrompt />

      {sameReconnectPrompt ? (
        <div
          className="update-modal-backdrop"
          role="presentation"
          onClick={() => {
            sameReconnectResolverRef.current?.(false)
            sameReconnectResolverRef.current = null
            setSameReconnectPrompt(null)
          }}
        >
          <div
            className="update-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="reconnect-same-title"
            aria-describedby="reconnect-same-desc"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="update-modal__icon" aria-hidden>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="update-modal__body">
              <h2 id="reconnect-same-title" className="update-modal__title">
                {t('reconnectSameTitle')}
              </h2>
              <p id="reconnect-same-desc" className="update-modal__message">
                {formatMessage(t('reconnectSameMessage'), {
                  target: sameReconnectPrompt.target,
                })}
              </p>
              <p className="update-modal__version" title={sameReconnectPrompt.target}>
                {sameReconnectPrompt.target}
              </p>
            </div>
            <div className="update-modal__actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  sameReconnectResolverRef.current?.(true)
                  sameReconnectResolverRef.current = null
                  setSameReconnectPrompt(null)
                }}
              >
                {t('reconnectSameConfirm')}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  sameReconnectResolverRef.current?.(false)
                  sameReconnectResolverRef.current = null
                  setSameReconnectPrompt(null)
                }}
              >
                {t('cancel')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
