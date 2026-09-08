import { describe, expect, it } from 'vitest'
import {
  buildSqlDump,
  quoteIdent,
  quoteSqlString,
  sqlLiteral,
} from '../electron/sql-browse/dump'

describe('sql dump helpers', () => {
  it('quotes identifiers and strings', () => {
    expect(quoteIdent('users')).toBe('"users"')
    expect(quoteIdent('weird"name')).toBe('"weird""name"')
    expect(quoteSqlString("O'Brien")).toBe("'O''Brien'")
  })

  it('formats SQL literals', () => {
    expect(sqlLiteral(null)).toBe('NULL')
    expect(sqlLiteral(42)).toBe('42')
    expect(sqlLiteral('hi')).toBe("'hi'")
    expect(sqlLiteral(true)).toBe('1')
    expect(sqlLiteral(new Uint8Array([255, 0]))).toBe("X'ff00'")
  })

  it('builds a dump with schema and inserts', () => {
    const dump = buildSqlDump(
      [
        {
          type: 'table',
          name: 't',
          sql: 'CREATE TABLE t (id INTEGER, name TEXT)',
        },
      ],
      [
        {
          name: 't',
          columns: ['id', 'name'],
          rows: [
            [1, 'a'],
            [2, null],
          ],
        },
      ],
    )
    expect(dump).toContain('BEGIN TRANSACTION;')
    expect(dump).toContain('CREATE TABLE t (id INTEGER, name TEXT);')
    expect(dump).toContain('INSERT INTO "t" ("id", "name") VALUES (1, \'a\');')
    expect(dump).toContain('INSERT INTO "t" ("id", "name") VALUES (2, NULL);')
    expect(dump).toContain('COMMIT;')
  })
})
