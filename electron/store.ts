import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
  secretsBackend,
} from './crypto-secrets'
import type {
  ConnectionFolder,
  SavedConnection,
  Workspace,
} from './types'

const FILE_NAME = 'connections.json'

type RawStore = {
  folders?: ConnectionFolder[]
  connections?: SavedConnection[]
}

function storePath() {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function sortFolders(folders: ConnectionFolder[]) {
  return [...folders].sort((a, b) => a.name.localeCompare(b.name))
}

function sortConnections(connections: SavedConnection[]) {
  return [...connections].sort((a, b) => a.name.localeCompare(b.name))
}

function decryptConnection(connection: SavedConnection): SavedConnection {
  return {
    ...connection,
    password: decryptSecret(connection.password),
    passphrase: decryptSecret(connection.passphrase),
  }
}

function encryptConnection(connection: SavedConnection): SavedConnection {
  return {
    ...connection,
    password: encryptSecret(connection.password),
    passphrase: encryptSecret(connection.passphrase),
  }
}

function needsMigration(connections: SavedConnection[]): boolean {
  return connections.some(
    (item) =>
      (item.password && !isEncryptedSecret(item.password)) ||
      (item.passphrase && !isEncryptedSecret(item.passphrase)),
  )
}

function readRaw(): RawStore {
  const file = storePath()
  const dir = path.dirname(file)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  if (!fs.existsSync(file)) {
    const empty: Workspace = { folders: [], connections: [] }
    fs.writeFileSync(file, JSON.stringify(empty, null, 2), 'utf8')
    return empty
  }

  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as
    | RawStore
    | SavedConnection[]
  // Migrate legacy array-only format.
  if (Array.isArray(parsed)) {
    return { folders: [], connections: parsed }
  }
  return {
    folders: parsed.folders ?? [],
    connections: parsed.connections ?? [],
  }
}

function writeWorkspace(workspace: Workspace): Workspace {
  const plainConnections = sortConnections(workspace.connections)
  const next: Workspace = {
    folders: sortFolders(workspace.folders),
    connections: plainConnections.map(encryptConnection),
  }
  fs.writeFileSync(storePath(), JSON.stringify(next, null, 2), 'utf8')
  return {
    folders: next.folders,
    connections: plainConnections,
  }
}

export function loadWorkspace(): Workspace {
  const raw = readRaw()
  const folders = sortFolders(raw.folders ?? [])
  const encryptedConnections = sortConnections(raw.connections ?? [])
  const connections = encryptedConnections.map(decryptConnection)

  // Encrypt any legacy plaintext secrets on first load.
  if (needsMigration(encryptedConnections)) {
    return writeWorkspace({ folders, connections })
  }

  return { folders, connections }
}

export function replaceWorkspace(workspace: Workspace): Workspace {
  return writeWorkspace({
    folders: workspace.folders ?? [],
    connections: workspace.connections ?? [],
  })
}

export function saveFolder(folder: ConnectionFolder): Workspace {
  const workspace = loadWorkspace()
  const index = workspace.folders.findIndex((item) => item.id === folder.id)
  if (index >= 0) {
    workspace.folders[index] = folder
  } else {
    workspace.folders.push(folder)
  }
  return writeWorkspace(workspace)
}

export function deleteFolder(id: string): Workspace {
  const workspace = loadWorkspace()
  return writeWorkspace({
    folders: workspace.folders.filter((item) => item.id !== id),
    connections: workspace.connections.map((item) =>
      item.folderId === id ? { ...item, folderId: null } : item,
    ),
  })
}

export function saveConnection(connection: SavedConnection): Workspace {
  const workspace = loadWorkspace()
  const index = workspace.connections.findIndex((item) => item.id === connection.id)
  if (index >= 0) {
    workspace.connections[index] = connection
  } else {
    workspace.connections.push(connection)
  }
  return writeWorkspace(workspace)
}

export function deleteConnection(id: string): Workspace {
  const workspace = loadWorkspace()
  return writeWorkspace({
    folders: workspace.folders,
    connections: workspace.connections.filter((item) => item.id !== id),
  })
}

export function touchConnection(id: string): Workspace {
  const workspace = loadWorkspace()
  const index = workspace.connections.findIndex((item) => item.id === id)
  if (index < 0) return workspace
  workspace.connections[index] = {
    ...workspace.connections[index],
    lastConnectedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  return writeWorkspace(workspace)
}

export function getSecretsInfo() {
  return {
    backend: secretsBackend(),
    encryptedAtRest: true,
  }
}
