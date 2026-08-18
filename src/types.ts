export type AuthMethod = 'password' | 'privateKey'

export type ConnectionProtocol = 'ssh' | 'sftp' | 'ftp'

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
  /** Protocol derived during connect or from external importers. */
  protocol?: ConnectionProtocol
  createdAt: string
  updatedAt: string
  lastConnectedAt?: string
}

export interface Workspace {
  folders: ConnectionFolder[]
  connections: SavedConnection[]
}

export interface ConnectionDraft {
  id?: string
  name: string
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  password: string
  privateKeyPath: string
  passphrase: string
  folderId: string | null
}

export type SessionStatus =
  | 'idle'
  | 'connecting'
  | 'reconnecting'
  | 'connected'
  | 'disconnected'
  | 'error'

export type ConnectPayload = {
  host: string
  port: number
  username: string
  authMethod: 'password' | 'privateKey'
  password?: string
  privateKeyPath?: string
  passphrase?: string
  cols?: number
  rows?: number
  theme?: 'dark' | 'light'
  /** Skip slow protocol probes when the workspace already knows the protocol. */
  protocolHint?: ConnectionProtocol
}

export const emptyDraft = (): ConnectionDraft => ({
  name: '',
  host: '',
  port: 22,
  username: '',
  authMethod: 'password',
  password: '',
  privateKeyPath: '',
  passphrase: '',
  folderId: null,
})

export interface RemoteFsEntry {
  name: string
  path: string
  isDir: boolean
  /** File size in bytes (files only). */
  size?: number
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

/** Fixed indent / tab stop width used by the editor and terminal. */
export const TAB_SIZE = 4

export type CloseAction = 'ask' | 'tray' | 'quit'

export interface AppSettings {
  locale: AppLocale
  theme: AppTheme
  hotkeys: HotkeysSettings
  /** Version the user dismissed with "update later"; auto prompt stays quiet until a newer one. */
  skippedUpdateVersion: string | null
  /** What the window close button does. */
  closeAction: CloseAction
}

export const defaultSettings = (): AppSettings => ({
  locale: 'ru',
  theme: 'dark',
  hotkeys: defaultHotkeys(),
  skippedUpdateVersion: null,
  closeAction: 'ask',
})
