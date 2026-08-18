export * from '../electron/shared/domain'

import type { AuthMethod } from '../electron/shared/domain'

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

/** Fixed indent / tab stop width used by the editor and terminal. */
export const TAB_SIZE = 4
