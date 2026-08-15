import { clipboard, contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppSettings,
  AppTheme,
  ConnectPayload,
  ConnectionFolder,
  RemoteFsEntry,
  SavedConnection,
  Workspace,
} from './types'

type StatusPayload = {
  status: 'connecting' | 'connected' | 'disconnected' | 'error'
  message?: string
  reason?: 'user' | 'drop'
}

type TransferProgressPayload = {
  transferId: string
  percent: number
  transferred: number
  total: number
  currentPath?: string
  filesDone: number
  filesTotal: number
  filesCancelled: number
  files: Array<{
    key: string
    path: string
    status: 'pending' | 'active' | 'done' | 'cancelled'
  }>
}

type DataHandler = (sessionId: string, data: string, shellId: string) => void
type StatusHandler = (sessionId: string, payload: StatusPayload) => void
type ShellClosedHandler = (sessionId: string, shellId: string) => void

const dataHandlers = new Set<DataHandler>()
const statusHandlers = new Set<StatusHandler>()
const shellClosedHandlers = new Set<ShellClosedHandler>()

ipcRenderer.on(
  'ssh:data',
  (
    _event,
    message: {
      sessionId: string
      payload: string | { shellId: string; data: string }
    },
  ) => {
    const shellId =
      typeof message.payload === 'string'
        ? ''
        : message.payload.shellId
    const data =
      typeof message.payload === 'string'
        ? message.payload
        : message.payload.data
    for (const handler of dataHandlers) {
      handler(message.sessionId, data, shellId)
    }
  },
)

ipcRenderer.on(
  'ssh:shell-closed',
  (_event, message: { sessionId: string; payload: { shellId: string } }) => {
    for (const handler of shellClosedHandlers) {
      handler(message.sessionId, message.payload.shellId)
    }
  },
)

ipcRenderer.on(
  'ssh:status',
  (_event, message: { sessionId: string; payload: StatusPayload }) => {
    for (const handler of statusHandlers) {
      handler(message.sessionId, message.payload)
    }
  },
)

const api = {
  loadSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:load'),
  saveSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:save', patch),
  loadWorkspace: (): Promise<Workspace> => ipcRenderer.invoke('workspace:load'),
  saveFolder: (folder: ConnectionFolder): Promise<Workspace> =>
    ipcRenderer.invoke('folders:save', folder),
  deleteFolder: (id: string): Promise<Workspace> =>
    ipcRenderer.invoke('folders:delete', id),
  saveConnection: (connection: SavedConnection): Promise<Workspace> =>
    ipcRenderer.invoke('connections:save', connection),
  deleteConnection: (id: string): Promise<Workspace> =>
    ipcRenderer.invoke('connections:delete', id),
  touchConnection: (id: string): Promise<Workspace> =>
    ipcRenderer.invoke('connections:touch', id),
  getSecretsInfo: (): Promise<{
    backend: 'safeStorage' | 'fallback'
    encryptedAtRest: boolean
  }> => ipcRenderer.invoke('secrets:info'),
  importWorkspace: (payload: {
    source: 'winscp' | 'filezilla' | 'termius' | 'customssh'
    passphrase?: string
    filePath?: string
  }): Promise<
    | { cancelled: true }
    | {
        cancelled: false
        workspace: Workspace
        imported: number
        foldersAdded: number
        source: string
        filePath: string
      }
    | { cancelled: false; needsPassphrase: true; filePath: string }
    | { cancelled: false; error: string; filePath?: string }
  > => ipcRenderer.invoke('workspace:import', payload),
  exportWorkspace: (payload: {
    includePasswords: boolean
    passphrase?: string
  }): Promise<
    | { cancelled: true }
    | { cancelled: false; path: string }
    | { cancelled: false; error: string }
  > => ipcRenderer.invoke('workspace:export', payload),
  openPrivateKeyDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openPrivateKey'),
  connect: (
    sessionId: string,
    payload: ConnectPayload,
  ): Promise<{ ok: boolean; shellId: string }> =>
    ipcRenderer.invoke('ssh:connect', sessionId, payload),
  openShell: (
    sessionId: string,
    size?: { cols?: number; rows?: number },
  ): Promise<{ shellId: string }> =>
    ipcRenderer.invoke('ssh:openShell', sessionId, size),
  closeShell: (sessionId: string, shellId: string) => {
    ipcRenderer.send('ssh:closeShell', sessionId, shellId)
  },
  write: (sessionId: string, data: string, shellId?: string) => {
    ipcRenderer.send('ssh:write', sessionId, data, shellId)
  },
  applyTheme: (sessionId: string, theme: AppTheme, shellId?: string) => {
    ipcRenderer.send('ssh:applyTheme', sessionId, theme, shellId)
  },
  resize: (
    sessionId: string,
    cols: number,
    rows: number,
    shellId?: string,
  ) => {
    ipcRenderer.send('ssh:resize', sessionId, cols, rows, shellId)
  },
  disconnect: (sessionId: string, reason?: 'user' | 'drop') => {
    ipcRenderer.send('ssh:disconnect', sessionId, reason ?? 'user')
  },
  onShellClosed: (callback: ShellClosedHandler) => {
    shellClosedHandlers.add(callback)
    return () => {
      shellClosedHandlers.delete(callback)
    }
  },
  ping: (sessionId: string): Promise<number> =>
    ipcRenderer.invoke('ssh:ping', sessionId),
  fsCwd: (sessionId: string): Promise<string> =>
    ipcRenderer.invoke('fs:cwd', sessionId),
  fsList: (sessionId: string, remotePath: string): Promise<RemoteFsEntry[]> =>
    ipcRenderer.invoke('fs:list', sessionId, remotePath),
  fsRead: (
    sessionId: string,
    remotePath: string,
  ): Promise<{ content: string; size: number }> =>
    ipcRenderer.invoke('fs:read', sessionId, remotePath),
  fsWrite: (
    sessionId: string,
    remotePath: string,
    content: string,
  ): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('fs:write', sessionId, remotePath, content),
  fsDownload: (
    sessionId: string,
    remotePath: string,
  ): Promise<
    | { ok: false }
    | { ok: true; path: string; count: number; cancelled: number }
  > => ipcRenderer.invoke('fs:download', sessionId, remotePath),
  fsDownloadMany: (
    sessionId: string,
    remotePaths: string[],
  ): Promise<
    | { ok: false }
    | { ok: true; count: number; cancelled: number; dir: string }
  > => ipcRenderer.invoke('fs:downloadMany', sessionId, remotePaths),
  onFsDownloadProgress: (callback: (progress: TransferProgressPayload) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: TransferProgressPayload,
    ) => callback(progress)
    ipcRenderer.on('fs:download-progress', listener)
    return () => {
      ipcRenderer.removeListener('fs:download-progress', listener)
    }
  },
  /** Electron 32+ removed File.path — use this for drag-and-drop uploads. */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  fsUpload: (
    sessionId: string,
    remoteDir: string,
  ): Promise<
    | { ok: false }
    | { ok: true; count: number; cancelled: number; dir: string }
  > => ipcRenderer.invoke('fs:upload', sessionId, remoteDir),
  fsUploadPaths: (
    sessionId: string,
    localPaths: string[],
    remoteDir: string,
  ): Promise<
    | { ok: false }
    | { ok: true; count: number; cancelled: number; dir: string }
  > => ipcRenderer.invoke('fs:uploadPaths', sessionId, localPaths, remoteDir),
  cancelTransferFile: (
    transferId: string,
    fileKey: string,
  ): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('fs:cancelTransferFile', transferId, fileKey),
  fsMkdir: (
    sessionId: string,
    remotePath: string,
  ): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('fs:mkdir', sessionId, remotePath),
  fsRename: (
    sessionId: string,
    fromPath: string,
    toPath: string,
  ): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('fs:rename', sessionId, fromPath, toPath),
  fsRemove: (
    sessionId: string,
    remotePath: string,
  ): Promise<{ ok: boolean; count: number }> =>
    ipcRenderer.invoke('fs:remove', sessionId, remotePath),
  onFsUploadProgress: (callback: (progress: TransferProgressPayload) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: TransferProgressPayload,
    ) => callback(progress)
    ipcRenderer.on('fs:upload-progress', listener)
    return () => {
      ipcRenderer.removeListener('fs:upload-progress', listener)
    }
  },
  openEditorWindow: (
    sessionId: string,
    remotePath: string,
  ): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('editor:open', sessionId, remotePath),
  showFileActionsMenu: (payload: {
    items: Array<{ id: string; label: string }>
  }): Promise<string | null> => ipcRenderer.invoke('menu:fileActions', payload),
  onData: (callback: DataHandler) => {
    dataHandlers.add(callback)
    return () => {
      dataHandlers.delete(callback)
    }
  },
  onStatus: (callback: StatusHandler) => {
    statusHandlers.add(callback)
    return () => {
      statusHandlers.delete(callback)
    }
  },
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke('shell:openExternal', url),
  clipboardReadText: (): string => clipboard.readText(),
  clipboardWriteText: (text: string): void => {
    clipboard.writeText(text)
  },
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowFullscreenToggle: () =>
    ipcRenderer.invoke('window:fullscreenToggle') as Promise<boolean>,
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowForceClose: () => ipcRenderer.invoke('window:forceClose'),
  windowIsFullscreen: () =>
    ipcRenderer.invoke('window:isFullscreen') as Promise<boolean>,
  confirmDialog: (payload: {
    title: string
    message: string
    detail?: string
    confirmLabel: string
    cancelLabel: string
  }): Promise<boolean> => ipcRenderer.invoke('dialog:confirm', payload),
  onEditorCloseRequest: (callback: () => void) => {
    const listener = () => callback()
    ipcRenderer.on('editor:close-request', listener)
    return () => {
      ipcRenderer.removeListener('editor:close-request', listener)
    }
  },
  onWindowState: (
    callback: (state: { maximized: boolean; fullscreen: boolean }) => void,
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: { maximized: boolean; fullscreen: boolean },
    ) => callback(state)
    ipcRenderer.on('window:state', listener)
    return () => {
      ipcRenderer.removeListener('window:state', listener)
    }
  },
  onWindowFx: (callback: (payload: { type: string }) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { type: string },
    ) => callback(payload)
    ipcRenderer.on('window:fx', listener)
    return () => {
      ipcRenderer.removeListener('window:fx', listener)
    }
  },
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('update:getVersion'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: (): Promise<boolean> => ipcRenderer.invoke('update:download'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  openReleasesPage: (): Promise<void> => ipcRenderer.invoke('update:openReleases'),
  onUpdateStatus: (callback: (status: UpdateStatusPayload) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: UpdateStatusPayload,
    ) => callback(status)
    ipcRenderer.on('update:status', listener)
    return () => {
      ipcRenderer.removeListener('update:status', listener)
    }
  },
}

type UpdateStatusPayload =
  | { state: 'idle' }
  | { state: 'unsupported'; reason: 'dev' | 'portable' | 'macUnsigned' }
  | { state: 'checking' }
  | {
      state: 'available'
      version: string
      releaseNotes?: string
      manual?: boolean
    }
  | { state: 'not-available'; version: string }
  | { state: 'downloading'; percent: number; transferred: number; total: number }
  | { state: 'ready'; version: string }
  | {
      state: 'error'
      code:
        | 'macUnsigned'
        | 'network'
        | 'notFound'
        | 'checksum'
        | 'permission'
        | 'generic'
    }

contextBridge.exposeInMainWorld('sshApi', api)

export type SshApi = typeof api
