import type { ConnectionFolder, SavedConnection, Workspace } from '../types'

export type ImportSource = 'winscp' | 'filezilla' | 'termius' | 'customssh'

export type ImportResult = {
  folders: ConnectionFolder[]
  connections: SavedConnection[]
}

export type ImportMergeResult = {
  workspace: Workspace
  imported: number
  foldersAdded: number
  source: ImportSource
}
