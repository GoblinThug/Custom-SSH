function sqlBaseName(name: string): string {
  const trimmed = name.trim().replace(/\\/g, '/')
  return trimmed.split('/').filter(Boolean).pop() || trimmed
}

/** SQLite binary databases and SQL dump scripts. */
export function isSqlDbFile(name: string): boolean {
  const lower = sqlBaseName(name).toLowerCase()
  return /\.(sqlite3?|db3?|s3db|sdb|sql)$/i.test(lower)
}

export function isSqlDumpFile(name: string): boolean {
  return sqlBaseName(name).toLowerCase().endsWith('.sql')
}

export type SqlDbKind = 'binary' | 'sql'

export function sqlDbKindFromName(name: string): SqlDbKind | null {
  if (!isSqlDbFile(name)) return null
  return isSqlDumpFile(name) ? 'sql' : 'binary'
}
