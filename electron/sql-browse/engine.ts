import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { Database, SqlJsStatic } from 'sql.js'
import {
  buildSqlDump,
  quoteIdent,
  type DumpSchemaRow,
  type DumpTableData,
} from './dump'
import type { SqlDbKind } from './files'

let sqlPromise: Promise<SqlJsStatic> | null = null

function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      const req = createRequire(__filename)
      const initSqlJs = req('sql.js') as (
        config?: { locateFile?: (file: string) => string },
      ) => Promise<SqlJsStatic>
      const wasmPath = path.join(
        path.dirname(req.resolve('sql.js')),
        'sql-wasm.wasm',
      )
      return initSqlJs({
        locateFile: () => wasmPath,
      })
    })()
  }
  return sqlPromise
}

export type SqlTableInfo = {
  name: string
  type: 'table' | 'view'
}

export type SqlColumnInfo = {
  name: string
  type: string
  notnull: boolean
  pk: boolean
}

export type SqlQueryResult = {
  columns: string[]
  rows: Array<Record<string, unknown>>
  total: number
  offset: number
  limit: number
  readonly: boolean
}

export class SqlBrowseEngine {
  private db: Database
  readonly kind: SqlDbKind
  dirty = false

  private constructor(db: Database, kind: SqlDbKind) {
    this.db = db
    this.kind = kind
  }

  static async open(localPath: string, kind: SqlDbKind): Promise<SqlBrowseEngine> {
    const SQL = await loadSqlJs()
    if (kind === 'sql') {
      const text = fs.readFileSync(localPath, 'utf8')
      const db = new SQL.Database()
      try {
        if (text.trim()) db.exec(text)
      } catch (err) {
        db.close()
        throw new Error(
          `SQL_DUMP_INVALID: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        )
      }
      return new SqlBrowseEngine(db, kind)
    }

    const buf = fs.readFileSync(localPath)
    try {
      const db = new SQL.Database(new Uint8Array(buf))
      // Touch to validate
      db.exec('SELECT 1')
      return new SqlBrowseEngine(db, kind)
    } catch (err) {
      throw new Error(
        `SQL_DB_CORRUPT: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    }
  }

  close() {
    try {
      this.db.close()
    } catch {
      // already closed
    }
  }

  listTables(): SqlTableInfo[] {
    const result = this.db.exec(
      `SELECT name, type FROM sqlite_master
       WHERE type IN ('table', 'view')
         AND name NOT LIKE 'sqlite_%'
       ORDER BY type ASC, name COLLATE NOCASE ASC`,
    )
    if (!result[0]) return []
    return result[0].values.map((row) => ({
      name: String(row[0]),
      type: row[1] === 'view' ? 'view' : 'table',
    }))
  }

  getColumns(table: string): SqlColumnInfo[] {
    this.assertIdent(table)
    const stmt = this.db.prepare(`PRAGMA table_info(${quoteIdent(table)})`)
    const cols: SqlColumnInfo[] = []
    while (stmt.step()) {
      const row = stmt.getAsObject() as {
        name: string
        type: string
        notnull: number
        pk: number
      }
      cols.push({
        name: row.name,
        type: row.type || '',
        notnull: Boolean(row.notnull),
        pk: Boolean(row.pk),
      })
    }
    stmt.free()
    return cols
  }

  private isView(table: string): boolean {
    const stmt = this.db.prepare(
      `SELECT type FROM sqlite_master WHERE name = ? AND type IN ('table','view')`,
    )
    stmt.bind([table])
    const type = stmt.step() ? String(stmt.get()[0]) : null
    stmt.free()
    return type === 'view'
  }

  queryRows(
    table: string,
    limit: number,
    offset: number,
    filters: Record<string, string> = {},
  ): SqlQueryResult {
    this.assertIdent(table)
    const safeLimit = Math.min(Math.max(1, Math.floor(limit) || 100), 500)
    const safeOffset = Math.max(0, Math.floor(offset) || 0)
    const readonly = this.isView(table)

    const whereParts: string[] = []
    const whereBinds: string[] = []
    for (const [column, raw] of Object.entries(filters)) {
      const value = raw.trim()
      if (!value) continue
      this.assertIdent(column)
      whereParts.push(
        `CAST(${quoteIdent(column)} AS TEXT) LIKE ? ESCAPE '\\'`,
      )
      whereBinds.push(`%${escapeLike(value)}%`)
    }
    const whereSql =
      whereParts.length > 0 ? ` WHERE ${whereParts.join(' AND ')}` : ''

    const countStmt = this.db.prepare(
      `SELECT COUNT(*) AS c FROM ${quoteIdent(table)}${whereSql}`,
    )
    if (whereBinds.length) countStmt.bind(whereBinds)
    countStmt.step()
    const total = Number(countStmt.get()[0] ?? 0)
    countStmt.free()

    const select = readonly
      ? `SELECT * FROM ${quoteIdent(table)}${whereSql} LIMIT ? OFFSET ?`
      : `SELECT rowid AS __rowid__, * FROM ${quoteIdent(table)}${whereSql} LIMIT ? OFFSET ?`

    const stmt = this.db.prepare(select)
    stmt.bind([...whereBinds, safeLimit, safeOffset])
    const rows: Array<Record<string, unknown>> = []
    let columns: string[] = []
    while (stmt.step()) {
      const obj = stmt.getAsObject() as Record<string, unknown>
      if (columns.length === 0) columns = Object.keys(obj)
      rows.push(normalizeRow(obj))
    }
    stmt.free()

    if (columns.length === 0) {
      const cols = this.getColumns(table)
      columns = readonly
        ? cols.map((c) => c.name)
        : ['__rowid__', ...cols.map((c) => c.name)]
    }

    return {
      columns,
      rows,
      total,
      offset: safeOffset,
      limit: safeLimit,
      readonly,
    }
  }

  updateCell(
    table: string,
    rowid: number,
    column: string,
    value: unknown,
  ): void {
    this.assertIdent(table)
    this.assertIdent(column)
    if (column === '__rowid__') throw new Error('SQL_READONLY_COLUMN')
    if (this.isView(table)) throw new Error('SQL_VIEW_READONLY')
    this.db.run(
      `UPDATE ${quoteIdent(table)} SET ${quoteIdent(column)} = ? WHERE rowid = ?`,
      [toBindValue(value), rowid],
    )
    this.dirty = true
  }

  insertRow(
    table: string,
    values: Record<string, unknown>,
  ): number {
    this.assertIdent(table)
    if (this.isView(table)) throw new Error('SQL_VIEW_READONLY')
    const cols = Object.keys(values).filter((c) => c !== '__rowid__')
    for (const col of cols) this.assertIdent(col)
    if (cols.length === 0) {
      this.db.run(`INSERT INTO ${quoteIdent(table)} DEFAULT VALUES`)
    } else {
      const placeholders = cols.map(() => '?').join(', ')
      const sql = `INSERT INTO ${quoteIdent(table)} (${cols
        .map(quoteIdent)
        .join(', ')}) VALUES (${placeholders})`
      this.db.run(
        sql,
        cols.map((c) => toBindValue(values[c])),
      )
    }
    this.dirty = true
    const idStmt = this.db.prepare('SELECT last_insert_rowid()')
    idStmt.step()
    const id = Number(idStmt.get()[0] ?? 0)
    idStmt.free()
    return id
  }

  deleteRows(table: string, rowids: number[]): number {
    this.assertIdent(table)
    if (this.isView(table)) throw new Error('SQL_VIEW_READONLY')
    if (rowids.length === 0) return 0
    const placeholders = rowids.map(() => '?').join(', ')
    this.db.run(
      `DELETE FROM ${quoteIdent(table)} WHERE rowid IN (${placeholders})`,
      rowids,
    )
    this.dirty = true
    return rowids.length
  }

  exportForSave(): Buffer {
    if (this.kind === 'sql') {
      return Buffer.from(this.exportSqlDump(), 'utf8')
    }
    const data = this.db.export()
    return Buffer.from(data)
  }

  exportSqlDump(): string {
    const schemaResult = this.db.exec(
      `SELECT type, name, sql FROM sqlite_master
       WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
       ORDER BY CASE type
         WHEN 'table' THEN 1
         WHEN 'index' THEN 2
         WHEN 'trigger' THEN 3
         WHEN 'view' THEN 4
         ELSE 5
       END, rowid`,
    )
    const schema: DumpSchemaRow[] = []
    if (schemaResult[0]) {
      for (const row of schemaResult[0].values) {
        schema.push({
          type: String(row[0]),
          name: String(row[1]),
          sql: row[2] == null ? null : String(row[2]),
        })
      }
    }

    const tables: DumpTableData[] = []
    for (const item of schema) {
      if (item.type !== 'table') continue
      const cols = this.getColumns(item.name)
      if (cols.length === 0) continue
      const colNames = cols.map((c) => c.name)
      const select = `SELECT ${colNames
        .map(quoteIdent)
        .join(', ')} FROM ${quoteIdent(item.name)}`
      const result = this.db.exec(select)
      const rows: unknown[][] = result[0]
        ? result[0].values.map((row) =>
            row.map((cell) => (cell === undefined ? null : cell)),
          )
        : []
      tables.push({ name: item.name, columns: colNames, rows })
    }

    return buildSqlDump(schema, tables)
  }

  private assertIdent(name: string) {
    if (!name || /[\0\x00]/.test(name)) throw new Error('SQL_BAD_IDENT')
  }
}

function toBindValue(value: unknown): string | number | null | Uint8Array {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof Uint8Array) return value
  return String(value)
}

function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function normalizeRow(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value instanceof Uint8Array) {
      out[key] = `<blob ${value.byteLength} bytes>`
    } else {
      out[key] = value
    }
  }
  return out
}
