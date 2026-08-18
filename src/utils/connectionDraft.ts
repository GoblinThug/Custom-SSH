import type { MessageKey } from '../i18n/messages'
import {
  emptyDraft,
  type ConnectPayload,
  type ConnectionDraft,
  type ConnectionProtocol,
  type SavedConnection,
} from '../types'

export function toDraft(connection?: SavedConnection | null): ConnectionDraft {
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

export function validate(
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

export function connectionLabelOf(draft: ConnectionDraft) {
  if (!draft.host.trim()) return undefined
  return `${draft.username.trim() || 'user'}@${draft.host.trim()}:${draft.port || 22}`
}

export function payloadLabel(payload: ConnectPayload) {
  return `${payload.username || 'user'}@${payload.host}:${payload.port || 22}`
}

export function inferProtocolFromDraft(
  draft: ConnectionDraft,
  saved?: SavedConnection,
): ConnectionProtocol {
  const host = draft.host.trim().toLowerCase()
  if (host.startsWith('ftp://')) return 'ftp'
  if (host.startsWith('sftp://')) return 'sftp'
  if (host.startsWith('ssh://')) return 'ssh'

  if (draft.port === 21) return 'ftp'
  if (draft.port === 2022) return 'sftp'
  if (draft.port === 22) return 'ssh'

  if (saved?.protocol) return saved.protocol
  if (draft.authMethod === 'privateKey') return 'ssh'
  return 'ssh'
}
