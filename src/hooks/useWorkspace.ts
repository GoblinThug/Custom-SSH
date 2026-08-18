import { useCallback, useEffect, useRef, useState } from 'react'
import { newId } from '../utils/newId'
import { inferProtocolFromDraft, validate } from '../utils/connectionDraft'
import type { MessageKey } from '../i18n/messages'
import type {
  ConnectionDraft,
  ConnectionFolder,
  FolderColor,
  SavedConnection,
  Workspace,
} from '../types'

export function useWorkspace() {
  const [folders, setFolders] = useState<ConnectionFolder[]>([])
  const [connections, setConnections] = useState<SavedConnection[]>([])
  const connectionsRef = useRef<SavedConnection[]>([])

  useEffect(() => {
    connectionsRef.current = connections
  }, [connections])

  const apply = useCallback((workspace: Workspace) => {
    setFolders(workspace.folders)
    setConnections(workspace.connections)
  }, [])

  useEffect(() => {
    void window.sshApi.loadWorkspace().then(apply)
  }, [apply])

  const saveDraft = useCallback(
    async (
      draft: ConnectionDraft,
    ): Promise<{ error: MessageKey } | { connection: SavedConnection }> => {
      const saved = connections.find((item) => item.id === draft.id)
      const validationError = validate(draft, saved)
      if (validationError) return { error: validationError }

      const now = new Date().toISOString()
      const connection: SavedConnection = {
        id: draft.id ?? newId(),
        name: draft.name.trim(),
        host: draft.host.trim(),
        port: draft.port,
        username: draft.username.trim(),
        authMethod: draft.authMethod,
        protocol: inferProtocolFromDraft(draft, saved),
        password:
          draft.authMethod === 'password'
            ? draft.password || saved?.password
            : undefined,
        privateKeyPath:
          draft.authMethod === 'privateKey'
            ? draft.privateKeyPath.trim()
            : undefined,
        passphrase:
          draft.authMethod === 'privateKey'
            ? draft.passphrase || saved?.passphrase
            : undefined,
        folderId: draft.folderId,
        createdAt: saved?.createdAt ?? now,
        updatedAt: now,
        lastConnectedAt: saved?.lastConnectedAt,
      }

      const workspace = await window.sshApi.saveConnection(connection)
      apply(workspace)
      return { connection }
    },
    [apply, connections],
  )

  const deleteConnection = useCallback(
    async (id: string) => {
      const workspace = await window.sshApi.deleteConnection(id)
      apply(workspace)
    },
    [apply],
  )

  const createFolder = useCallback(
    async (name: string) => {
      const now = new Date().toISOString()
      const folder: ConnectionFolder = {
        id: newId(),
        name,
        color: 'blue',
        createdAt: now,
        updatedAt: now,
      }
      const workspace = await window.sshApi.saveFolder(folder)
      apply(workspace)
    },
    [apply],
  )

  const renameFolder = useCallback(
    async (folderId: string, name: string) => {
      const current = folders.find((item) => item.id === folderId)
      if (!current) return
      const workspace = await window.sshApi.saveFolder({
        ...current,
        name,
        updatedAt: new Date().toISOString(),
      })
      apply(workspace)
    },
    [apply, folders],
  )

  const changeFolderColor = useCallback(
    async (folderId: string, color: FolderColor) => {
      const current = folders.find((item) => item.id === folderId)
      if (!current) return
      const workspace = await window.sshApi.saveFolder({
        ...current,
        color,
        updatedAt: new Date().toISOString(),
      })
      apply(workspace)
    },
    [apply, folders],
  )

  const deleteFolder = useCallback(
    async (folderId: string) => {
      const workspace = await window.sshApi.deleteFolder(folderId)
      apply(workspace)
    },
    [apply],
  )

  const moveConnection = useCallback(
    async (connectionId: string, folderId: string | null) => {
      const current = connections.find((item) => item.id === connectionId)
      if (!current) return
      const workspace = await window.sshApi.saveConnection({
        ...current,
        folderId,
        updatedAt: new Date().toISOString(),
      })
      apply(workspace)
    },
    [apply, connections],
  )

  return {
    folders,
    connections,
    connectionsRef,
    apply,
    saveDraft,
    deleteConnection,
    createFolder,
    renameFolder,
    changeFolderColor,
    deleteFolder,
    moveConnection,
  }
}
