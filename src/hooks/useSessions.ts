import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import { newId } from '../utils/newId'
import { formatAppError } from '../utils/formatAppError'
import { formatMessage } from '../utils/formatMessage'
import {
  inferProtocolFromDraft,
  payloadLabel,
  toDraft,
  validate,
} from '../utils/connectionDraft'
import type { MessageKey } from '../i18n/messages'
import type { SessionRuntime, TerminalTab } from '../session/types'
import type {
  AppTheme,
  ConnectPayload,
  ConnectionDraft,
  SavedConnection,
  Workspace,
} from '../types'

type Translate = (key: MessageKey) => string

type Options = {
  theme: AppTheme
  t: Translate
  connections: SavedConnection[]
  connectionsRef: MutableRefObject<SavedConnection[]>
  applyWorkspace: (workspace: Workspace) => void
  closeTreeIfUnpinned: () => void
  treePinnedRef: MutableRefObject<boolean>
  setTreeOpen: Dispatch<SetStateAction<boolean>>
  setBusy: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | undefined>>
  setEditOpen: Dispatch<SetStateAction<boolean>>
  setSelectedId: Dispatch<SetStateAction<string | undefined>>
  setDraft: Dispatch<SetStateAction<ConnectionDraft>>
}

export function useSessions({
  theme,
  t,
  connections,
  connectionsRef,
  applyWorkspace,
  closeTreeIfUnpinned,
  treePinnedRef,
  setTreeOpen,
  setBusy,
  setError,
  setEditOpen,
  setSelectedId,
  setDraft,
}: Options) {
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeTabKey, setActiveTabKey] = useState<string | null>(null)
  const [openingShell, setOpeningShell] = useState(false)
  const [sameReconnectPrompt, setSameReconnectPrompt] = useState<{
    target: string
  } | null>(null)

  const tabsRef = useRef<TerminalTab[]>([])
  const activeTabKeyRef = useRef<string | null>(null)
  const sessionsRef = useRef<Map<string, SessionRuntime>>(new Map())
  const connectTokenRef = useRef(0)
  const themeRef = useRef(theme)
  const tRef = useRef(t)
  const openingShellRef = useRef(false)
  const ignoreShellClosedRef = useRef(new Set<string>())
  const sameReconnectResolverRef = useRef<((ok: boolean) => void) | null>(null)

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
    activeTabKeyRef.current = activeTabKey
  }, [activeTabKey])

  const syncDraftFromTab = useCallback(
    (tab: TerminalTab | null | undefined) => {
      if (!tab?.connectionId) return
      const connection = connectionsRef.current.find(
        (item) => item.id === tab.connectionId,
      )
      if (!connection) return
      setSelectedId(connection.id)
      setDraft(toDraft(connection))
    },
    [connectionsRef, setDraft, setSelectedId],
  )

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
            protocolHint: runtime.protocol,
            theme: themeRef.current,
          })
          .then((result) => {
            if (!result.ok) {
              if ('cancelled' in result && result.cancelled) return
              if (!runtime.wantConnected || !runtime.autoReconnect) return
              scheduleReconnect(sessionId)
              return
            }
            runtime.autoReconnect = true
            const shellId = result.shellId ?? null
            runtime.protocol = result.protocol ?? runtime.protocol
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
          setError(
            formatAppError(
              payload.message,
              tRef.current,
              'errConnectionFailed',
            ),
          )
        }
        if (activeTabKeyRef.current == null) {
          closeTreeIfUnpinned()
        }
      }
    })
  }, [
    clearReconnectTimer,
    closeTreeIfUnpinned,
    patchTabsForSession,
    removeTabsForSession,
    scheduleReconnect,
    setBusy,
    setEditOpen,
    setError,
    setTreeOpen,
    treePinnedRef,
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
    for (const tab of tabsRef.current) {
      if (tab.status === 'connected' && tab.sessionId) {
        window.sshApi.applyTheme(tab.sessionId, theme)
      }
    }
  }, [theme])

  const activateTab = (tabKey: string) => {
    setActiveTabKey(tabKey)
    const tab = tabsRef.current.find((item) => item.key === tabKey)
    syncDraftFromTab(tab)
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

  const handleConnect = async (
    sourceDraft: ConnectionDraft,
    opts?: { openNewTab?: boolean },
  ) => {
    const openNewTab = !!opts?.openNewTab
    const saved = connections.find((item) => item.id === sourceDraft.id)
    const validationError = validate(sourceDraft, saved)
    if (validationError) {
      setSelectedId(sourceDraft.id)
      setDraft(sourceDraft)
      setEditOpen(true)
      setError(t(validationError))
      return
    }

    const payload: ConnectPayload = {
      host: sourceDraft.host.trim(),
      port: sourceDraft.port,
      username: sourceDraft.username.trim(),
      authMethod: sourceDraft.authMethod,
      password: sourceDraft.password || saved?.password,
      privateKeyPath: sourceDraft.privateKeyPath.trim() || undefined,
      passphrase: sourceDraft.passphrase || saved?.passphrase,
      cols: 120,
      rows: 30,
      theme,
      protocolHint: saved?.protocol ?? inferProtocolFromDraft(sourceDraft, saved),
    }
    const label = payloadLabel(payload)
    const title = sourceDraft.name.trim() || label

    const current = activeTab
    if (current && isSameActiveTarget(current, payload, sourceDraft.id)) {
      const proceed = await new Promise<boolean>((resolve) => {
        sameReconnectResolverRef.current = resolve
        setSameReconnectPrompt({ target: current.label || label })
      })
      if (!proceed) return
    }

    setSelectedId(sourceDraft.id)
    setDraft(sourceDraft)
    setBusy(true)
    setError(undefined)
    closeTreeIfUnpinned()

    const nextSessionId = newId()
    const replaceSessionId = openNewTab ? undefined : current?.sessionId
    const replaceShellId = openNewTab ? undefined : current?.shellId
    const tabKey = openNewTab ? newId() : current?.key ?? newId()

    const siblingCount = replaceSessionId
      ? tabsRef.current.filter(
          (tab) =>
            tab.sessionId === replaceSessionId && tab.key !== tabKey,
        ).length
      : 0

    const connectToken = ++connectTokenRef.current
    sessionsRef.current.set(nextSessionId, {
      payload,
      protocol: 'sftp',
      wantConnected: true,
      autoReconnect: false,
      suppressReconnect: false,
      reconnectAttempt: 0,
      pingFail: 0,
      label,
      connectionId: sourceDraft.id,
      connectToken,
    })

    const nextTab: TerminalTab = {
      key: tabKey,
      sessionId: nextSessionId,
      shellId: null,
      title,
      status: 'connecting',
      label,
      connectionId: sourceDraft.id,
      pending: false,
    }

    setTabs((prev) => {
      if (!current || openNewTab) return [...prev, nextTab]
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
      if (!result.ok) {
        if ('cancelled' in result && result.cancelled) return
        if (!('error' in result)) return
        const message = formatAppError(
          { message: result.error },
          t,
          'errConnectFailed',
        )
        const runtime = sessionsRef.current.get(nextSessionId)
        const tabNow = tabsRef.current.find((item) => item.key === tabKey)
        if (
          !tabNow ||
          tabNow.sessionId !== nextSessionId ||
          (runtime && runtime.connectToken !== connectToken)
        ) {
          return
        }
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
        setError(message)
        setBusy(false)
        return
      }
      const runtime = sessionsRef.current.get(nextSessionId)
      const tabNow = tabsRef.current.find((item) => item.key === tabKey)
      if (
        !runtime ||
        runtime.connectToken !== connectToken ||
        !tabNow ||
        tabNow.sessionId !== nextSessionId
      ) {
        return
      }
      runtime.autoReconnect = true
      runtime.wantConnected = true
      runtime.protocol = result.protocol ?? runtime.protocol
      setTabs((prev) =>
        prev.map((tab) =>
          tab.key === tabKey && tab.sessionId === nextSessionId
            ? {
                ...tab,
                shellId: result.shellId ?? null,
                status: 'connected',
                title,
                label,
                connectionId: sourceDraft.id,
                pending: false,
              }
            : tab,
        ),
      )
      setBusy(false)

      if (sourceDraft.id) {
        const now = new Date().toISOString()
        const protocol = result.protocol ?? 'sftp'
        if (saved) {
          const workspace = await window.sshApi.saveConnection({
            ...saved,
            protocol,
            lastConnectedAt: now,
            updatedAt: now,
          })
          applyWorkspace(workspace)
        } else {
          const workspace = await window.sshApi.touchConnection(sourceDraft.id)
          applyWorkspace(workspace)
        }
      }
    } catch (err) {
      const message = formatAppError(err, t, 'errConnectFailed')
      if (/connection cancelled/i.test(message)) return
      const runtime = sessionsRef.current.get(nextSessionId)
      const tabNow = tabsRef.current.find((item) => item.key === tabKey)
      if (
        !tabNow ||
        tabNow.sessionId !== nextSessionId ||
        (runtime && runtime.connectToken !== connectToken)
      ) {
        return
      }
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
      setError(message)
      setBusy(false)
    }
  }

  const handleSidebarConnect = (connection: SavedConnection) => {
    void handleConnect(toDraft(connection), { openNewTab: true })
  }
  const handleSidebarConnectRef = useRef(handleSidebarConnect)
  handleSidebarConnectRef.current = handleSidebarConnect

  const handleDisconnect = () => {
    const tab = activeTab
    if (!tab) return
    stopSessionReconnect(tab.sessionId)
    window.sshApi.disconnect(tab.sessionId, 'user')
    sessionsRef.current.delete(tab.sessionId)
    removeTabsForSession(tab.sessionId)
    closeTreeIfUnpinned()
    setBusy(false)
  }

  const handleOpenShell = async () => {
    const tab = activeTab
    if (!tab || tab.status !== 'connected' || !tab.sessionId) return
    if (openingShellRef.current) return

    openingShellRef.current = true
    setOpeningShell(true)

    const tabKey = newId()
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
      const currentRuntime = sessionsRef.current.get(tab.sessionId)
      if (currentRuntime?.protocol !== 'ssh') return

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
      setError(formatAppError(err, t, 'errConnectionFailed'))
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

  const disconnectSessionsForConnection = (connectionId: string) => {
    for (const [sessionId, runtime] of sessionsRef.current) {
      if (runtime.connectionId === connectionId) {
        stopSessionReconnect(sessionId)
        window.sshApi.disconnect(sessionId, 'user')
        sessionsRef.current.delete(sessionId)
        removeTabsForSession(sessionId)
      }
    }
  }

  useEffect(() => {
    return window.sshApi.onTrayQuickConnect((connectionId) => {
      const connection = connectionsRef.current.find(
        (item) => item.id === connectionId,
      )
      if (!connection) return
      handleSidebarConnectRef.current(connection)
    })
  }, [connectionsRef])

  useEffect(() => {
    return window.sshApi.onTrayDisconnect((sessionId) => {
      stopSessionReconnect(sessionId)
      window.sshApi.disconnect(sessionId, 'user')
      sessionsRef.current.delete(sessionId)
      removeTabsForSession(sessionId)
      closeTreeIfUnpinned()
      setBusy(false)
    })
  }, [closeTreeIfUnpinned, removeTabsForSession, setBusy, stopSessionReconnect])

  const resolveSameReconnect = (ok: boolean) => {
    sameReconnectResolverRef.current?.(ok)
    sameReconnectResolverRef.current = null
    setSameReconnectPrompt(null)
  }

  return {
    tabs,
    setTabs,
    activeTab,
    activeTabKey,
    openingShell,
    sessionsRef,
    sameReconnectPrompt,
    activateTab,
    handleConnect,
    handleSidebarConnect,
    handleDisconnect,
    handleOpenShell,
    handleCloseTab,
    disconnectSessionsForConnection,
    stopSessionReconnect,
    removeTabsForSession,
    resolveSameReconnect,
  }
}
