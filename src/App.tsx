import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { TerminalEmptyState } from './components/TerminalEmptyState'
import { ProgressBar } from './components/ProgressBar'
import { TerminalTabBar } from './components/TerminalTabBar'
import { AppModal } from './components/AppModal'
import { ConnectionFormSkeleton } from './components/skeleton/ConnectionFormSkeleton'
import { DrawerPanelSkeleton } from './components/skeleton/DrawerPanelSkeleton'
import { FileTreeSkeleton } from './components/skeleton/FileTreeSkeleton'
import { TerminalSkeleton } from './components/skeleton/TerminalSkeleton'
import { useSettings } from './i18n/SettingsContext'
import { useLazyMount } from './hooks/useLazyMount'
import { formatMessage } from './utils/formatMessage'
import { emptyDraft, type ConnectionDraft } from './types'
import { connectionLabelOf, toDraft } from './utils/connectionDraft'
import { useConnectionPing } from './hooks/useConnectionPing'
import { useWorkspace } from './hooks/useWorkspace'
import { useSessions } from './hooks/useSessions'
import { useQuitPrompt } from './hooks/useQuitPrompt'

const TerminalView = lazy(() =>
  import('./components/TerminalView').then((mod) => ({
    default: mod.TerminalView,
  })),
)
const FileTreePanel = lazy(() =>
  import('./components/FileTreePanel').then((mod) => ({
    default: mod.FileTreePanel,
  })),
)
const SettingsPanel = lazy(() =>
  import('./components/SettingsPanel').then((mod) => ({
    default: mod.SettingsPanel,
  })),
)
const HotkeysPanel = lazy(() =>
  import('./components/HotkeysPanel').then((mod) => ({
    default: mod.HotkeysPanel,
  })),
)
const UpdatePrompt = lazy(() =>
  import('./components/UpdatePrompt').then((mod) => ({
    default: mod.UpdatePrompt,
  })),
)
const TransferDock = lazy(() =>
  import('./components/TransferDock').then((mod) => ({
    default: mod.TransferDock,
  })),
)
const ConnectionForm = lazy(() =>
  import('./components/ConnectionForm').then((mod) => ({
    default: mod.ConnectionForm,
  })),
)

export function preloadTerminalView() {
  void import('./components/TerminalView')
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

export default function App() {
  const { t, theme } = useSettings()
  const workspace = useWorkspace()
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
  const treePinnedRef = useRef(treePinned)

  const editMounted = useLazyMount(editOpen)
  const treeMounted = useLazyMount(treeOpen || treePinned)
  const settingsMounted = useLazyMount(settingsOpen)
  const hotkeysMounted = useLazyMount(hotkeysOpen)

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

  const sessions = useSessions({
    theme,
    t,
    connections: workspace.connections,
    connectionsRef: workspace.connectionsRef,
    applyWorkspace: workspace.apply,
    closeTreeIfUnpinned,
    treePinnedRef,
    setTreeOpen,
    setBusy,
    setError,
    setEditOpen,
    setSelectedId,
    setDraft,
  })

  const pingMs = useConnectionPing({
    sessionId: sessions.activeTab?.sessionId,
    connected: sessions.activeTab?.status === 'connected',
    sessionsRef: sessions.sessionsRef,
  })

  const { quitPromptOpen, setQuitPromptOpen, hideToTray, quitApp } =
    useQuitPrompt()

  const handleSelect = (connection: (typeof workspace.connections)[number]) => {
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
    const result = await workspace.saveDraft(draft)
    if ('error' in result) {
      setError(t(result.error))
      return
    }
    setSelectedId(result.connection.id)
    setDraft(toDraft(result.connection))
    setError(undefined)
  }

  const handleDelete = async () => {
    if (!draft.id) return
    sessions.disconnectSessionsForConnection(draft.id)
    await workspace.deleteConnection(draft.id)
    handleNew()
  }

  const handleBrowseKey = async () => {
    const path = await window.sshApi.openPrivateKeyDialog()
    if (path) {
      setDraft((prev) => ({ ...prev, privateKeyPath: path }))
    }
  }

  const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`

  const handleTreeNavigate = (remotePath: string) => {
    const tab = sessions.activeTab
    if (!tab?.sessionId || tab.status !== 'connected' || !tab.shellId) {
      return
    }
    window.sshApi.write(
      tab.sessionId,
      `cd ${shellQuote(remotePath)}\n`,
      tab.shellId,
    )
  }

  const handleDeleteFolder = async (folderId: string) => {
    await workspace.deleteFolder(folderId)
    if (draft.folderId === folderId) {
      setDraft((prev) => ({ ...prev, folderId: null }))
    }
  }

  const handleMoveConnection = async (
    connectionId: string,
    folderId: string | null,
  ) => {
    await workspace.moveConnection(connectionId, folderId)
    if (draft.id === connectionId) {
      setDraft((prev) => ({ ...prev, folderId }))
    }
  }

  useEffect(() => {
    if (sessions.tabs.length > 0) {
      preloadTerminalView()
    }
  }, [sessions.tabs.length])

  useEffect(() => {
    const traySessions = sessions.tabs
      .filter(
        (tab) =>
          tab.status === 'connected' ||
          tab.status === 'connecting' ||
          tab.status === 'reconnecting',
      )
      .map((tab) => ({
        sessionId: tab.sessionId,
        label: tab.label,
        title: tab.title,
        status: tab.status as 'connecting' | 'connected' | 'reconnecting',
        connectionId: tab.connectionId,
      }))
      .filter(
        (tab, index, list) =>
          list.findIndex((item) => item.sessionId === tab.sessionId) === index,
      )

    void window.sshApi.trayReportState({
      sessions: traySessions,
      connections: workspace.connections.map((item) => {
        const folder = workspace.folders.find((entry) => entry.id === item.folderId)
        return {
          id: item.id,
          name: item.name,
          host: item.host,
          port: item.port,
          username: item.username,
          folderColor: folder?.color ?? null,
        }
      }),
    })
  }, [sessions.tabs, workspace.connections, workspace.folders])

  const status =
    sessions.activeTab?.status ?? (sessions.tabs.length > 0 ? 'connected' : 'idle')
  const reconnectAttempt = sessions.activeTab?.reconnectAttempt ?? 0
  const toolbarLabel =
    (sessions.activeTab?.label && sessions.activeTab.label.trim()) ||
    connectionLabelOf(draft) ||
    undefined
  const toolbarTitle =
    (sessions.activeTab?.title && sessions.activeTab.title.trim()) ||
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

  const pingLevel =
    pingMs == null
      ? 'unknown'
      : pingMs < 80
        ? 'good'
        : pingMs < 180
          ? 'fair'
          : 'poor'

  const canAddShell =
    !!sessions.activeTab &&
    sessions.activeTab.status === 'connected' &&
    sessions.sessionsRef.current.get(sessions.activeTab.sessionId)?.protocol ===
      'ssh'

  const hasTerminalSessions = sessions.tabs.length > 0

  return (
    <div className="app">
      <TitleBar />
      <div className="app__main">
      <div className="layout">
        <Sidebar
          folders={workspace.folders}
          connections={workspace.connections}
          selectedId={selectedId}
          query={query}
          onQueryChange={setQuery}
          onSelect={handleSelect}
          onConnect={(connection) => {
            preloadTerminalView()
            void sessions.handleSidebarConnect(connection)
          }}
          onNew={handleNew}
          onCreateFolder={() => void workspace.createFolder(t('newFolderDefault'))}
          onRenameFolder={(id, name) => void workspace.renameFolder(id, name)}
          onChangeFolderColor={(id, color) =>
            void workspace.changeFolderColor(id, color)
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
                  onClick={sessions.handleDisconnect}
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
              {editMounted ? (
                <Suspense fallback={<ConnectionFormSkeleton />}>
                  <ConnectionForm
                    draft={draft}
                    folders={workspace.folders}
                    busy={busy}
                    error={error}
                    onChange={setDraft}
                    onSave={() => void handleSave()}
                    onConnect={() => {
                      preloadTerminalView()
                      void sessions.handleConnect(draft)
                    }}
                    onDelete={draft.id ? () => void handleDelete() : undefined}
                    onBrowseKey={() => void handleBrowseKey()}
                    onClose={() => setEditOpen(false)}
                  />
                </Suspense>
              ) : null}
            </div>
            <div className="terminal-stack">
              <TerminalTabBar
                tabs={sessions.tabs}
                activeTabKey={sessions.activeTabKey}
                openingShell={sessions.openingShell}
                canAddShell={canAddShell}
                t={t}
                onActivate={sessions.activateTab}
                onCloseTab={sessions.handleCloseTab}
                onOpenShell={() => void sessions.handleOpenShell()}
                onTabsChange={sessions.setTabs}
              />
              <div className="terminal-stack__views">
                {!hasTerminalSessions ? (
                  <TerminalEmptyState connectionLabel={connectionLabelOf(draft)} />
                ) : (
                  <Suspense fallback={<TerminalSkeleton />}>
                    {sessions.tabs.map((tab) => (
                      <TerminalView
                        key={tab.key}
                        sessionId={tab.sessionId}
                        shellId={tab.shellId}
                        status={tab.status}
                        active={tab.key === sessions.activeTabKey}
                        connectionLabel={tab.label}
                        reconnectAttempt={tab.reconnectAttempt ?? 0}
                      />
                    ))}
                  </Suspense>
                )}
              </div>
            </div>
          </div>

          {treeMounted ? (
            <Suspense
              fallback={treeOpen || treePinned ? <FileTreeSkeleton /> : null}
            >
              <FileTreePanel
                open={treeOpen}
                pinned={treePinned}
                sessionId={
                  sessions.activeTab?.status === 'connected'
                    ? sessions.activeTab.sessionId
                    : null
                }
                onClose={() => setTreeOpen(false)}
                onPinnedChange={handleTreePinnedChange}
                onNavigate={handleTreeNavigate}
              />
            </Suspense>
          ) : null}
          </div>
        </main>
      </div>
      <Suspense fallback={null}>
        <TransferDock />
      </Suspense>
      </div>

      {settingsMounted ? (
        <Suspense fallback={settingsOpen ? <DrawerPanelSkeleton /> : null}>
          <SettingsPanel
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            onWorkspaceChange={workspace.apply}
          />
        </Suspense>
      ) : null}

      {hotkeysMounted ? (
        <Suspense fallback={hotkeysOpen ? <DrawerPanelSkeleton /> : null}>
          <HotkeysPanel
            open={hotkeysOpen}
            onClose={() => setHotkeysOpen(false)}
          />
        </Suspense>
      ) : null}

      <Suspense fallback={null}>
        <UpdatePrompt />
      </Suspense>

      {sessions.sameReconnectPrompt ? (
        <AppModal
          titleId="reconnect-same-title"
          descId="reconnect-same-desc"
          title={t('reconnectSameTitle')}
          message={formatMessage(t('reconnectSameMessage'), {
            target: sessions.sameReconnectPrompt.target,
          })}
          onBackdrop={() => sessions.resolveSameReconnect(false)}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          }
        >
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => sessions.resolveSameReconnect(true)}
          >
            {t('reconnectSameConfirm')}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => sessions.resolveSameReconnect(false)}
          >
            {t('cancel')}
          </button>
        </AppModal>
      ) : null}

      {quitPromptOpen ? (
        <AppModal
          titleId="quit-prompt-title"
          descId="quit-prompt-desc"
          title={t('quitPromptTitle')}
          message={t('quitPromptMessage')}
          actionsClassName="update-modal__actions update-modal__actions--compact"
          onBackdrop={() => setQuitPromptOpen(false)}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path
                d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              <path
                d="M15 8l4 4-4 4M10 12h9"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          }
        >
          <button type="button" className="btn btn-primary" onClick={hideToTray}>
            {t('quitPromptTray')}
          </button>
          <button type="button" className="btn btn-danger" onClick={quitApp}>
            {t('quitPromptQuit')}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setQuitPromptOpen(false)}
          >
            {t('cancel')}
          </button>
        </AppModal>
      ) : null}
    </div>
  )
}
