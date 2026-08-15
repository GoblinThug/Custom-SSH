export type AuthMethod = 'password' | 'privateKey'

export type FolderColor =
  | 'blue'
  | 'green'
  | 'orange'
  | 'red'
  | 'purple'
  | 'teal'
  | 'pink'
  | 'gray'

export interface ConnectionFolder {
  id: string
  name: string
  color: FolderColor
  createdAt: string
  updatedAt: string
}

export interface SavedConnection {
  id: string
  name: string
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  password?: string
  privateKeyPath?: string
  passphrase?: string
  folderId?: string | null
  createdAt: string
  updatedAt: string
  lastConnectedAt?: string
}

export interface Workspace {
  folders: ConnectionFolder[]
  connections: SavedConnection[]
}

export interface ConnectPayload {
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  password?: string
  privateKeyPath?: string
  passphrase?: string
  cols?: number
  rows?: number
  theme?: AppTheme
}

export interface RemoteFsEntry {
  name: string
  path: string
  isDir: boolean
}

export const APP_LOCALE_IDS = ['ru', 'en'] as const
export type AppLocale = (typeof APP_LOCALE_IDS)[number]
export type AppTheme = 'dark' | 'light'

export const HOTKEY_IDS = [
  'copy',
  'paste',
  'selectLine',
  'interrupt',
  'suspend',
] as const
export type HotkeyId = (typeof HOTKEY_IDS)[number]

export type KeyBinding = {
  code: string
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
}

export type HotkeysSettings = Record<HotkeyId, KeyBinding>

export function defaultHotkeys(): HotkeysSettings {
  return {
    copy: { code: 'KeyC', ctrl: true, shift: false, alt: false, meta: false },
    paste: { code: 'KeyV', ctrl: true, shift: false, alt: false, meta: false },
    selectLine: {
      code: 'KeyA',
      ctrl: true,
      shift: false,
      alt: false,
      meta: false,
    },
    interrupt: {
      code: 'KeyQ',
      ctrl: true,
      shift: false,
      alt: false,
      meta: false,
    },
    suspend: {
      code: 'KeyZ',
      ctrl: true,
      shift: false,
      alt: false,
      meta: false,
    },
  }
}

export interface AppSettings {
  locale: AppLocale
  theme: AppTheme
  hotkeys: HotkeysSettings
  /** Version the user dismissed with "update later"; auto prompt stays quiet until a newer one. */
  skippedUpdateVersion: string | null
}

export type TransferFileStatus =
  | 'pending'
  | 'active'
  | 'done'
  | 'cancelled'
  | 'error'

export type TransferFileInfo = {
  key: string
  path: string
  status: TransferFileStatus
  error?: string
}

export type TransferProgress = {
  transferId: string
  percent: number
  transferred: number
  total: number
  currentPath?: string
  filesDone: number
  filesTotal: number
  filesCancelled: number
  files: TransferFileInfo[]
}
