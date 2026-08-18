import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
  },
}))

import {
  encryptSecret,
  decryptSecret,
  isCustomSshBackup,
  isEncryptedSecret,
} from '../electron/crypto-secrets'
import { mergeImport } from '../electron/importers'
import { decryptWinScpPassword, importWinScpIni } from '../electron/importers/winscp'
import { importFileZillaXml } from '../electron/importers/filezilla'
import { archiveKindFromName, isArchiveName } from '../electron/archive'
import type { Workspace } from '../electron/types'

describe('crypto-secrets fallback', () => {
  const envUser = process.env.USERNAME
  afterEach(() => {
    if (envUser === undefined) delete process.env.USERNAME
    else process.env.USERNAME = envUser
  })

  it('roundtrips secrets without OS keychain', () => {
    const enc = encryptSecret('hunter2')
    expect(enc).toBeTruthy()
    expect(isEncryptedSecret(enc)).toBe(true)
    expect(decryptSecret(enc)).toBe('hunter2')
  })

  it('passes through plaintext and empty values', () => {
    expect(encryptSecret('')).toBe('')
    expect(decryptSecret('legacy-plain')).toBe('legacy-plain')
  })

  it('isCustomSshBackup', () => {
    expect(
      isCustomSshBackup({
        format: 'customssh-backup',
        version: 1,
        encrypted: false,
        workspace: {},
      }),
    ).toBe(true)
    expect(isCustomSshBackup({ format: 'other' })).toBe(false)
    expect(isCustomSshBackup(null)).toBe(false)
  })
})

describe('importers', () => {
  it('importWinScpIni reads sessions and folders', () => {
    const ini = `
[Sessions\\Work\\prod]
HostName=example.com
UserName=deploy
PortNumber=2222
    `.trim()
    const result = importWinScpIni(ini, () => 'id-1', '2024-01-01T00:00:00.000Z')
    expect(result.connections).toHaveLength(1)
    expect(result.connections[0]).toMatchObject({
      host: 'example.com',
      username: 'deploy',
      port: 2222,
      name: 'prod',
    })
    expect(result.folders.some((folder) => folder.name === 'Work')).toBe(true)
  })

  it('decryptWinScpPassword returns empty for junk', () => {
    expect(decryptWinScpPassword('', 'u', 'h')).toBe('')
    expect(decryptWinScpPassword('zz', 'u', 'h')).toBe('')
  })

  it('importFileZillaXml reads SFTP servers', () => {
    const xml = `
<FileZilla3>
  <Servers>
    <Server>
      <Host>sftp.example.com</Host>
      <Port>22</Port>
      <Protocol>1</Protocol>
      <Type>0</Type>
      <User>alice</User>
      <Pass encoding="base64">c2VjcmV0</Pass>
      <Name>Work/Prod</Name>
    </Server>
  </Servers>
</FileZilla3>
    `
    let n = 0
    const result = importFileZillaXml(xml, () => `id-${++n}`, '2024-01-01T00:00:00.000Z')
    expect(result.connections).toHaveLength(1)
    expect(result.connections[0]).toMatchObject({
      host: 'sftp.example.com',
      username: 'alice',
      name: 'Prod',
      protocol: 'sftp',
      password: 'secret',
    })
    expect(result.folders).toHaveLength(1)
  })

  it('mergeImport skips duplicates and remaps folders', () => {
    const now = '2024-01-01T00:00:00.000Z'
    const current: Workspace = {
      folders: [{ id: 'f1', name: 'Work', color: 'blue', createdAt: now, updatedAt: now }],
      connections: [
        {
          id: 'c1',
          name: 'Prod',
          host: 'example.com',
          port: 22,
          username: 'a',
          authMethod: 'password',
          createdAt: now,
          updatedAt: now,
        },
      ],
    }
    const merged = mergeImport(
      current,
      {
        folders: [{ id: 'in-f', name: 'Work', color: 'red', createdAt: now, updatedAt: now }],
        connections: [
          {
            id: 'in-c',
            name: 'Prod',
            host: 'example.com',
            port: 22,
            username: 'a',
            authMethod: 'password',
            folderId: 'in-f',
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'in-c2',
            name: 'Staging',
            host: 'stg.example.com',
            port: 22,
            username: 'a',
            authMethod: 'password',
            folderId: 'in-f',
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
      'winscp',
    )
    expect(merged.imported).toBe(1)
    expect(merged.foldersAdded).toBe(0)
    expect(merged.workspace.connections).toHaveLength(2)
    expect(merged.workspace.connections[1].folderId).toBe('f1')
  })
})

describe('archive names', () => {
  it('classifies archive kinds', () => {
    expect(isArchiveName('a.tar.gz')).toBe(true)
    expect(archiveKindFromName('a.tar.gz')).toBe('tgz')
    expect(archiveKindFromName('pack.zip')).toBe('zip')
    expect(archiveKindFromName('notes.txt')).toBeNull()
  })
})
