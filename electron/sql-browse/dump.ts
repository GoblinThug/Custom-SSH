/** Escape a string for use as a SQL string literal. */
export function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/** Quote an identifier with double quotes. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'NULL'
    return String(value)
  }
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (value instanceof Uint8Array) {
    const hex = Array.from(value, (b) => b.toString(16).padStart(2, '0')).join(
      '',
    )
    return `X'${hex}'`
  }
  return quoteSqlString(String(value))
}

export type DumpSchemaRow = {
  type: string
  name: string
  sql: string | null
}

export type DumpTableData = {
  name: string
  columns: string[]
  rows: unknown[][]
}

/** Build a portable SQL dump from schema + table data. */
export function buildSqlDump(
  schema: DumpSchemaRow[],
  tables: DumpTableData[],
): string {
  const lines: string[] = [
    'BEGIN TRANSACTION;',
    'PRAGMA foreign_keys=OFF;',
  ]

  for (const item of schema) {
    if (!item.sql) continue
    lines.push(`${item.sql};`)
  }

  for (const table of tables) {
    const cols = table.columns.map(quoteIdent).join(', ')
    for (const row of table.rows) {
      const values = row.map(sqlLiteral).join(', ')
      lines.push(
        `INSERT INTO ${quoteIdent(table.name)} (${cols}) VALUES (${values});`,
      )
    }
  }

  lines.push('COMMIT;')
  return `${lines.join('\n')}\n`
}
