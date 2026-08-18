import type { ConnectPayload, ConnectionProtocol, SessionStatus } from '../types'

export type TerminalTab = {
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

export type SessionRuntime = {
  payload: ConnectPayload
  protocol: ConnectionProtocol
  wantConnected: boolean
  autoReconnect: boolean
  suppressReconnect: boolean
  reconnectTimer?: ReturnType<typeof setTimeout>
  reconnectAttempt: number
  pingFail: number
  label: string
  connectionId?: string
  /** Guards against stale connect() promises updating the wrong tab. */
  connectToken: number
}

export function reorderTabs(
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
