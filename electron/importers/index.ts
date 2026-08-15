import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import {
  decryptWorkspaceExport,
  encryptWorkspaceExport,
  isCustomSshBackup,
  type PassphraseExportEnvelope,
  type PlainExportEnvelope,
} from '../crypto-secrets'
import type { SavedConnection, Workspace } from '../types'
import { importFileZillaXml } from './filezilla'
import { importTermiusJson } from './termius'
import type { ImportMergeResult, ImportResult, ImportSource } from './types'
import { importWinScpIni } from './winscp'

export type { ImportMergeResult, ImportSource } from './types'

function makeId() {
  return randomUUID()
}

function stripSecrets(connection: SavedConnection): SavedConnection {
  const next = { ...connection }
  delete next.password
  delete next.passphrase
  return next
}

export function parseImportFile(
  source: ImportSource,
  filePath: string,
  passphrase?: string,
): ImportResult {
  const text = fs.readFileSync(filePath, 'utf8')
  const now = new Date().toISOString()

  if (source === 'winscp') {
    return importWinScpIni(text, makeId, now)
  }
  if (source === 'filezilla') {
    return importFileZillaXml(text, makeId, now)
  }
  if (source === 'termius') {
    return importTermiusJson(text, makeId, now)
  }

  // customssh backup
  const raw = JSON.parse(text) as unknown
  if (!isCustomSshBackup(raw)) {
    throw new Error('Not a CustomSSH backup file')
  }
  let workspace: Workspace
  if (raw.encrypted) {
    if (!passphrase) throw new Error('Passphrase required')
    const json = decryptWorkspaceExport(raw as PassphraseExportEnvelope, passphrase)
    workspace = JSON.parse(json) as Workspace
  } else {
    workspace = (raw as PlainExportEnvelope).workspace as Workspace
  }
  if (!workspace || !Array.isArray(workspace.connections)) {
    throw new Error('Invalid CustomSSH workspace')
  }
  return {
    folders: Array.isArray(workspace.folders) ? workspace.folders : [],
    connections: workspace.connections,
  }
}

export function mergeImport(
  current: Workspace,
  incoming: ImportResult,
  source: ImportSource,
): ImportMergeResult {
  const folderIdMap = new Map<string, string>()
  const folders = [...current.folders]
  let foldersAdded = 0

  for (const folder of incoming.folders) {
    const existing = folders.find(
      (item) => item.name.toLowerCase() === folder.name.toLowerCase(),
    )
    if (existing) {
      folderIdMap.set(folder.id, existing.id)
      continue
    }
    const id = makeId()
    folderIdMap.set(folder.id, id)
    folders.push({ ...folder, id })
    foldersAdded += 1
  }

  const connections = [...current.connections]
  let imported = 0
  for (const connection of incoming.connections) {
    const folderId = connection.folderId
      ? folderIdMap.get(connection.folderId) ?? null
      : null
    const duplicate = connections.some(
      (item) =>
        item.host === connection.host &&
        item.port === connection.port &&
        item.username === connection.username &&
        item.name === connection.name,
    )
    if (duplicate) continue
    connections.push({
      ...connection,
      id: makeId(),
      folderId,
    })
    imported += 1
  }

  return {
    workspace: { folders, connections },
    imported,
    foldersAdded,
    source,
  }
}

export function buildExportPayload(
  workspace: Workspace,
  options: { includePasswords: boolean; passphrase?: string },
): PlainExportEnvelope | PassphraseExportEnvelope {
  const exportWorkspace: Workspace = {
    folders: workspace.folders,
    connections: options.includePasswords
      ? workspace.connections
      : workspace.connections.map(stripSecrets),
  }
  const json = JSON.stringify(exportWorkspace)

  if (options.includePasswords) {
    if (!options.passphrase || options.passphrase.length < 4) {
      throw new Error('Passphrase required for password export')
    }
    return encryptWorkspaceExport(json, options.passphrase)
  }

  return {
    format: 'customssh-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    encrypted: false,
    workspace: exportWorkspace,
  }
}
