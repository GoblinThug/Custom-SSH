import { describe, expect, it } from 'vitest'
import {
  canMovePathsTo,
  displayName,
  entryMatchesFilter,
  isRemoteDescendant,
  joinRemote,
  normalizeRemotePath,
  parentChain,
  parentDir,
} from './paths'
import type { RemoteFsEntry } from '../../types'

describe('file-tree paths', () => {
  it('parentChain walks from root', () => {
    expect(parentChain('/')).toEqual(['/'])
    expect(parentChain('/var/log')).toEqual(['/', '/var', '/var/log'])
  })

  it('parentDir and joinRemote', () => {
    expect(parentDir('/var/log/syslog')).toBe('/var/log')
    expect(parentDir('/var')).toBe('/')
    expect(joinRemote('/', 'etc')).toBe('/etc')
    expect(joinRemote('/var/', 'log')).toBe('/var/log')
  })

  it('isRemoteDescendant', () => {
    expect(isRemoteDescendant('/var/log', '/var')).toBe(true)
    expect(isRemoteDescendant('/var', '/var')).toBe(true)
    expect(isRemoteDescendant('/opt', '/var')).toBe(false)
    expect(isRemoteDescendant('/', '/')).toBe(false)
  })

  it('canMovePathsTo rejects moves into self or current parent', () => {
    expect(canMovePathsTo(['/var/log'], '/var')).toBe(false)
    expect(canMovePathsTo(['/var/log'], '/opt')).toBe(true)
    expect(canMovePathsTo(['/var'], '/var/log')).toBe(false)
    expect(canMovePathsTo(['/'], '/opt')).toBe(false)
  })

  it('displayName and normalizeRemotePath', () => {
    expect(displayName('/')).toBe('root')
    expect(displayName('/var/log')).toBe('log')
    expect(normalizeRemotePath('var\\log\\')).toBe('/var/log')
    expect(normalizeRemotePath('')).toBe('/')
  })

  it('entryMatchesFilter matches nested names', () => {
    const file = (name: string, path: string, isDir = false): RemoteFsEntry => ({
      name,
      path,
      isDir,
    })
    const children = {
      '/var': [file('log', '/var/log', true)],
      '/var/log': [file('syslog', '/var/log/syslog')],
    }
    expect(entryMatchesFilter(file('var', '/var', true), 'sys', children)).toBe(
      true,
    )
    expect(entryMatchesFilter(file('opt', '/opt', true), 'sys', children)).toBe(
      false,
    )
  })
})
