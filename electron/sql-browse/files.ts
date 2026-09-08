function sqlBaseName(name: string): string {
  const trimmed = name.trim().replace(/\\/g, '/')
  return trimmed.split('/').filter(Boolean).pop() || trimmed
}

export type SqlDbKind = 'binary' | 'sql'

export function isSqlDbName(name: string): boolean {
  const lower = sqlBaseName(name).toLowerCase()
  return /\.(sqlite3?|db3?|s3db|sdb|sql)$/i.test(lower)
}

export function sqlKindFromName(name: string): SqlDbKind | null {
  if (!isSqlDbName(name)) return null
  return sqlBaseName(name).toLowerCase().endsWith('.sql') ? 'sql' : 'binary'
}
