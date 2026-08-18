import { describe, expect, it } from 'vitest'
import { emptyDraft } from '../types'
import {
  connectionLabelOf,
  inferProtocolFromDraft,
  payloadLabel,
  toDraft,
  validate,
} from './connectionDraft'

describe('connectionDraft', () => {
  it('toDraft returns emptyDraft without a connection', () => {
    expect(toDraft()).toEqual(emptyDraft())
  })

  it('toDraft copies fields and clears secrets', () => {
    const draft = toDraft({
      id: 'c1',
      name: 'Prod',
      host: 'example.com',
      port: 22,
      username: 'root',
      authMethod: 'password',
      password: 'secret',
      folderId: 'f1',
      createdAt: '2020-01-01',
      updatedAt: '2020-01-01',
    })
    expect(draft.password).toBe('')
    expect(draft.passphrase).toBe('')
    expect(draft.host).toBe('example.com')
    expect(draft.folderId).toBe('f1')
  })

  it('validate catches missing required fields', () => {
    expect(validate(emptyDraft())).toBe('errName')
    expect(validate({ ...emptyDraft(), name: 'A' })).toBe('errHost')
    expect(validate({ ...emptyDraft(), name: 'A', host: 'h' })).toBe('errUsername')
    expect(
      validate({ ...emptyDraft(), name: 'A', host: 'h', username: 'u', port: 0 }),
    ).toBe('errPort')
    expect(
      validate({
        ...emptyDraft(),
        name: 'A',
        host: 'h',
        username: 'u',
        authMethod: 'password',
      }),
    ).toBe('errPassword')
    expect(
      validate({
        ...emptyDraft(),
        name: 'A',
        host: 'h',
        username: 'u',
        authMethod: 'privateKey',
      }),
    ).toBe('errPrivateKey')
  })

  it('validate accepts a saved password instead of draft password', () => {
    const draft = {
      ...emptyDraft(),
      name: 'A',
      host: 'h',
      username: 'u',
      authMethod: 'password' as const,
    }
    expect(
      validate(draft, {
        id: '1',
        name: 'A',
        host: 'h',
        port: 22,
        username: 'u',
        authMethod: 'password',
        password: 'saved',
        createdAt: '',
        updatedAt: '',
      }),
    ).toBeNull()
  })

  it('inferProtocolFromDraft uses URL, port, then saved protocol', () => {
    expect(
      inferProtocolFromDraft({ ...emptyDraft(), host: 'ftp://files.example' }),
    ).toBe('ftp')
    expect(inferProtocolFromDraft({ ...emptyDraft(), port: 21 })).toBe('ftp')
    expect(inferProtocolFromDraft({ ...emptyDraft(), port: 2022 })).toBe('sftp')
    expect(inferProtocolFromDraft({ ...emptyDraft(), port: 22 })).toBe('ssh')
    expect(
      inferProtocolFromDraft(
        { ...emptyDraft(), port: 2222 },
        {
          id: '1',
          name: 'A',
          host: 'h',
          port: 2222,
          username: 'u',
          authMethod: 'password',
          protocol: 'sftp',
          createdAt: '',
          updatedAt: '',
        },
      ),
    ).toBe('sftp')
  })

  it('builds labels', () => {
    expect(
      connectionLabelOf({ ...emptyDraft(), host: 'h', username: 'u', port: 2222 }),
    ).toBe('u@h:2222')
    expect(connectionLabelOf(emptyDraft())).toBeUndefined()
    expect(
      payloadLabel({
        host: 'h',
        port: 22,
        username: 'root',
        authMethod: 'password',
      }),
    ).toBe('root@h:22')
  })
})
