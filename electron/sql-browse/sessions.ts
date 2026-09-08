import { SqlBrowseEngine } from './engine'
import type { SqlDbKind } from './files'

export type SqlBrowseSession = {
  key: string
  sessionId: string
  remotePath: string
  localPath: string
  kind: SqlDbKind
  size: number
  name: string
  engine: SqlBrowseEngine
}

const sessions = new Map<string, SqlBrowseSession>()

export function sqlBrowseKey(sessionId: string, remotePath: string): string {
  return `${sessionId}::${remotePath}`
}

export function getSqlBrowseSession(key: string): SqlBrowseSession | undefined {
  return sessions.get(key)
}

export function setSqlBrowseSession(session: SqlBrowseSession): void {
  const prev = sessions.get(session.key)
  if (prev && prev !== session) {
    try {
      prev.engine.close()
    } catch {
      // ignore
    }
  }
  sessions.set(session.key, session)
}

export function requireSqlBrowseSession(key: string): SqlBrowseSession {
  const session = sessions.get(key)
  if (!session) throw new Error('SQL_SESSION_MISSING')
  return session
}

export function disposeSqlBrowseSession(key: string): void {
  const session = sessions.get(key)
  if (!session) return
  sessions.delete(key)
  try {
    session.engine.close()
  } catch {
    // ignore
  }
}

export function isSqlBrowseDirty(key: string): boolean {
  return Boolean(sessions.get(key)?.engine.dirty)
}
