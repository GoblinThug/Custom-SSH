import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
} from 'electron'
import { isConnectCancelled } from '../ssh-manager'
import {
  buildExportPayload,
  mergeImport,
  parseImportFile,
  type ImportSource,
} from '../importers'
import {
  deleteConnection,
  deleteFolder,
  getSecretsInfo,
  loadWorkspace,
  replaceWorkspace,
  saveConnection,
  saveFolder,
  touchConnection,
} from '../store'
import { loadSettings, saveSettings } from '../settings-store'
import {
  extractArchiveFile,
  isArchiveName,
} from '../archive'
import { mainWindow, setIsQuitting, ssh } from '../app-context'
import {
  isDisconnectedPingError,
  isMissingRemote,
} from '../shared/ipc-errors'
import {
  destroyTray,
  hideMainToTray,
  hideTrayPopup,
  setTrayPopupState,
  showMainWindow,
  destroyTrayPopup,
  getTrayPopupState,
  positionTrayPopup,
  type TrayPopupState,
} from '../tray/tray-manager'
import {
  ensureArchiveCached,
  openArchiveWindow,
  openEditorWindow,
  openViewerWindow,
} from '../windows/secondary-windows'
import {
  dragWindowTo,
  endWindowDrag,
  playMinimizeAnimation,
  restoreWindowForDrag,
  toggleWindowFill,
  windowFromEvent,
} from '../window-chrome'
import type {
  AppSettings,
  AppTheme,
  ConnectPayload,
  ConnectionFolder,
  SavedConnection,
} from '../types'

function enrichConnectPayload(payload: ConnectPayload): ConnectPayload {
  const host = payload.host.trim()
  const username = payload.username.trim()

  let next: ConnectPayload = { ...payload, host, username }

  if (next.authMethod === 'password' && !next.password) {
    const saved = loadWorkspace().connections.find(
      (item) =>
        item.host === host &&
        item.port === next.port &&
        item.username === username &&
        item.authMethod === 'password',
    )
    if (saved?.password) {
      next = { ...next, password: saved.password }
    }
  }

  if (next.authMethod === 'privateKey' && !next.passphrase) {
    const saved = loadWorkspace().connections.find(
      (item) =>
        item.host === host &&
        item.port === next.port &&
        item.username === username &&
        item.authMethod === 'privateKey',
    )
    if (saved?.passphrase) {
      next = { ...next, passphrase: saved.passphrase }
    }
  }

  return next
}

function forceQuitAllWindows() {
  setIsQuitting(true)
  destroyTray()
  for (const win of BrowserWindow.getAllWindows()) {
    const flagged = win as BrowserWindow & { __forceClose?: boolean }
    flagged.__forceClose = true
  }
  app.quit()
}

function remoteParentDir(remotePath: string): string {
  const normalized = remotePath.replace(/\\/g, '/').replace(/\/+$/, '')
  const index = normalized.lastIndexOf('/')
  if (index <= 0) return '/'
  return normalized.slice(0, index) || '/'
}

export function registerIpcHandlers() {
  ipcMain.handle('settings:load', () => loadSettings())

  ipcMain.handle('settings:save', (_event, patch: Partial<AppSettings>) => {
    return saveSettings(patch)
  })

  ipcMain.handle('workspace:load', () => loadWorkspace())

  ipcMain.handle('folders:save', (_event, folder: ConnectionFolder) => {
    return saveFolder(folder)
  })

  ipcMain.handle('folders:delete', (_event, id: string) => {
    return deleteFolder(id)
  })

  ipcMain.handle('connections:save', (_event, connection: SavedConnection) => {
    return saveConnection(connection)
  })

  ipcMain.handle('connections:delete', (_event, id: string) => {
    return deleteConnection(id)
  })

  ipcMain.handle('connections:touch', (_event, id: string) => {
    return touchConnection(id)
  })

  ipcMain.handle('secrets:info', () => getSecretsInfo())

  ipcMain.handle(
    'workspace:import',
    async (
      event,
      payload: {
        source: ImportSource
        passphrase?: string
        filePath?: string
      },
    ) => {
      const win = windowFromEvent(event)
      let filePath = payload.filePath?.trim() || ''

      if (!filePath) {
        const filters =
          payload.source === 'winscp'
            ? [{ name: 'WinSCP INI', extensions: ['ini', 'txt'] }]
            : payload.source === 'filezilla'
              ? [{ name: 'FileZilla XML', extensions: ['xml'] }]
              : payload.source === 'termius'
                ? [{ name: 'Termius JSON', extensions: ['json'] }]
                : [
                    {
                      name: 'CustomSSH backup',
                      extensions: ['json', 'customssh'],
                    },
                  ]

        const openOpts = {
          title: 'Import connections',
          properties: ['openFile' as const],
          filters: [...filters, { name: 'All files', extensions: ['*'] }],
        }
        const opened = win
          ? await dialog.showOpenDialog(win, openOpts)
          : await dialog.showOpenDialog(openOpts)
        if (opened.canceled || opened.filePaths.length === 0) {
          return { cancelled: true as const }
        }
        filePath = opened.filePaths[0]
      }

      try {
        const incoming = parseImportFile(
          payload.source,
          filePath,
          payload.passphrase,
        )
        const merged = mergeImport(loadWorkspace(), incoming, payload.source)
        const workspace = replaceWorkspace(merged.workspace)
        return {
          cancelled: false as const,
          workspace,
          imported: merged.imported,
          foldersAdded: merged.foldersAdded,
          source: merged.source,
          filePath,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (
          payload.source === 'customssh' &&
          /passphrase/i.test(message) &&
          !payload.passphrase
        ) {
          return {
            cancelled: false as const,
            needsPassphrase: true as const,
            filePath,
          }
        }
        return { cancelled: false as const, error: message, filePath }
      }
    },
  )

  ipcMain.handle(
    'workspace:export',
    async (
      event,
      payload: { includePasswords: boolean; passphrase?: string },
    ) => {
      const win = windowFromEvent(event)
      const saveOpts = {
        title: 'Export connections',
        defaultPath: payload.includePasswords
          ? 'customssh-backup.encrypted.json'
          : 'customssh-backup.json',
        filters: [
          { name: 'CustomSSH backup', extensions: ['json', 'customssh'] },
          { name: 'All files', extensions: ['*'] },
        ],
      }
      const saved = win
        ? await dialog.showSaveDialog(win, saveOpts)
        : await dialog.showSaveDialog(saveOpts)
      if (saved.canceled || !saved.filePath) {
        return { cancelled: true as const }
      }

      try {
        const envelope = buildExportPayload(loadWorkspace(), {
          includePasswords: payload.includePasswords,
          passphrase: payload.passphrase,
        })
        fs.writeFileSync(saved.filePath, JSON.stringify(envelope, null, 2), 'utf8')
        return { cancelled: false as const, path: saved.filePath }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { cancelled: false as const, error: message }
      }
    },
  )

  ipcMain.handle('dialog:openPrivateKey', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select private key',
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(
    'ssh:connect',
    async (_event, sessionId: string, payload: ConnectPayload) => {
      try {
        const result = await ssh.connect(sessionId, enrichConnectPayload(payload))
        return {
          ok: true as const,
          shellId: result.shellId,
          protocol: result.protocol,
        }
      } catch (err) {
        if (isConnectCancelled(err)) {
          return {
            ok: false as const,
            cancelled: true as const,
            shellId: null,
            protocol: 'sftp' as const,
          }
        }
        const message =
          err instanceof Error ? err.message : String(err ?? 'Connection failed')
        return {
          ok: false as const,
          error: message,
          shellId: null,
          protocol: 'sftp' as const,
        }
      }
    },
  )

  ipcMain.handle(
    'ssh:openShell',
    async (
      _event,
      sessionId: string,
      size?: { cols?: number; rows?: number },
    ) => {
      return ssh.openShell(sessionId, size)
    },
  )

  ipcMain.on(
    'ssh:closeShell',
    (_event, sessionId: string, shellId: string) => {
      ssh.closeShell(sessionId, shellId)
    },
  )

  ipcMain.on(
    'ssh:write',
    (_event, sessionId: string, data: string, shellId?: string) => {
      ssh.write(sessionId, data, shellId)
    },
  )

  ipcMain.on(
    'ssh:applyTheme',
    (_event, sessionId: string, theme: AppTheme, shellId?: string) => {
      ssh.applyTheme(sessionId, theme, shellId)
    },
  )

  ipcMain.on(
    'ssh:resize',
    (
      _event,
      sessionId: string,
      cols: number,
      rows: number,
      shellId?: string,
    ) => {
      ssh.resize(sessionId, cols, rows, shellId)
    },
  )

  ipcMain.on(
    'ssh:disconnect',
    (_event, sessionId: string, reason?: 'user' | 'drop') => {
      ssh.disconnect(sessionId, reason ?? 'user')
    },
  )

  ipcMain.handle('ssh:ping', async (_event, sessionId: string) => {
    try {
      return await ssh.ping(sessionId)
    } catch (err) {
      // Expected while a session is dropping — avoid Electron handler console spam.
      if (isDisconnectedPingError(err)) return null
      throw err
    }
  })

  ipcMain.handle('fs:cwd', async (_event, sessionId: string) => {
    return ssh.getCwd(sessionId)
  })

  ipcMain.handle(
    'fs:list',
    async (_event, sessionId: string, remotePath: string) => {
      try {
        return await ssh.listDir(sessionId, remotePath)
      } catch (err) {
        // Stale tree paths (deleted after extract, listing a file, etc.)
        // would otherwise spam Electron's "Error occurred in handler".
        if (isMissingRemote(err)) return []
        throw err
      }
    },
  )

  ipcMain.handle(
    'fs:read',
    async (_event, sessionId: string, remotePath: string) => {
      return ssh.readFile(sessionId, remotePath)
    },
  )

  ipcMain.handle(
    'fs:write',
    async (
      _event,
      sessionId: string,
      remotePath: string,
      content: string,
    ) => {
      await ssh.writeFile(sessionId, remotePath, content)
      return { ok: true }
    },
  )

  function uniqueLocalPath(targetDir: string, baseName: string): string {
    let localPath = path.join(targetDir, baseName)
    if (!fs.existsSync(localPath)) return localPath
    const ext = path.extname(baseName)
    const stem = path.basename(baseName, ext)
    let index = 1
    do {
      localPath = path.join(targetDir, `${stem} (${index})${ext}`)
      index += 1
    } while (fs.existsSync(localPath))
    return localPath
  }

  function sendIpc(
    contents: Electron.WebContents | null | undefined,
    channel: string,
    payload: unknown,
  ) {
    try {
      if (contents && !contents.isDestroyed()) {
        contents.send(channel, payload)
      }
    } catch {
      // Window closed during transfer.
    }
  }

  const emitFsDownloadProgress = (
    event: Electron.IpcMainInvokeEvent,
    progress: {
      transferId: string
      percent: number
      transferred: number
      total: number
      currentPath?: string
      filesDone: number
      filesTotal: number
      filesCancelled: number
      files: Array<{
        key: string
        path: string
        status: 'pending' | 'active' | 'done' | 'cancelled' | 'error'
        error?: string
      }>
    },
  ) => {
    sendIpc(event.sender, 'fs:download-progress', progress)
  }

  ipcMain.handle(
    'fs:download',
    async (event, sessionId: string, remotePath: string) => {
      const win = windowFromEvent(event)
      const baseName = path.basename(remotePath) || 'download'
      const isDir = await ssh.isDirectory(sessionId, remotePath)

      if (isDir) {
        const dialogOpts = {
          title: 'Save folder to',
          properties: ['openDirectory', 'createDirectory'] as Array<
            'openDirectory' | 'createDirectory'
          >,
        }
        const result = win
          ? await dialog.showOpenDialog(win, dialogOpts)
          : await dialog.showOpenDialog(dialogOpts)
        if (result.canceled || result.filePaths.length === 0) {
          return { ok: false as const }
        }
        const localPath = uniqueLocalPath(result.filePaths[0], baseName)
        const resultTransfer = await ssh.downloadRemote(
          sessionId,
          remotePath,
          localPath,
          (progress) => emitFsDownloadProgress(event, progress),
        )
        return {
          ok: true as const,
          path: localPath,
          count: resultTransfer.saved,
          cancelled: resultTransfer.cancelled,
        }
      }

      const dialogOpts = {
        title: 'Save file',
        defaultPath: baseName,
      }
      const result = win
        ? await dialog.showSaveDialog(win, dialogOpts)
        : await dialog.showSaveDialog(dialogOpts)
      if (result.canceled || !result.filePath) return { ok: false as const }
      const resultTransfer = await ssh.downloadRemote(
        sessionId,
        remotePath,
        result.filePath,
        (progress) => emitFsDownloadProgress(event, progress),
      )
      return {
        ok: true as const,
        path: result.filePath,
        count: resultTransfer.saved,
        cancelled: resultTransfer.cancelled,
      }
    },
  )

  ipcMain.handle(
    'fs:downloadMany',
    async (event, sessionId: string, remotePaths: string[]) => {
      const win = windowFromEvent(event)
      const paths = remotePaths.filter((item) => typeof item === 'string' && item)
      if (paths.length === 0) return { ok: false as const }

      const dialogOpts = {
        title: 'Save items to folder',
        properties: ['openDirectory', 'createDirectory'] as Array<
          'openDirectory' | 'createDirectory'
        >,
      }
      const result = win
        ? await dialog.showOpenDialog(win, dialogOpts)
        : await dialog.showOpenDialog(dialogOpts)
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false as const }
      }

      const targetDir = result.filePaths[0]
      const planned: Array<{ remotePath: string; localPath: string }> = []
      for (const remotePath of paths) {
        const baseName = path.basename(remotePath) || `item-${planned.length + 1}`
        planned.push({
          remotePath,
          localPath: uniqueLocalPath(targetDir, baseName),
        })
      }

      const resultTransfer = await ssh.downloadRemoteMany(
        sessionId,
        planned,
        (progress) => emitFsDownloadProgress(event, progress),
      )
      return {
        ok: true as const,
        count: resultTransfer.saved,
        cancelled: resultTransfer.cancelled,
        dir: targetDir,
      }
    },
  )

  const emitFsUploadProgress = (
    event: Electron.IpcMainInvokeEvent,
    progress: {
      transferId: string
      percent: number
      transferred: number
      total: number
      currentPath?: string
      filesDone: number
      filesTotal: number
      filesCancelled: number
      files: Array<{
        key: string
        path: string
        status: 'pending' | 'active' | 'done' | 'cancelled' | 'error'
        error?: string
      }>
    },
  ) => {
    sendIpc(event.sender, 'fs:upload-progress', progress)
    const mainContents = mainWindow?.webContents
    if (mainContents && mainContents !== event.sender) {
      sendIpc(mainContents, 'fs:upload-progress', progress)
    }
  }

  ipcMain.handle(
    'fs:cancelTransferFile',
    (_event, transferId: string, fileKey: string) => {
      if (typeof transferId !== 'string' || typeof fileKey !== 'string') {
        return { ok: false as const }
      }
      return { ok: ssh.cancelTransferFile(transferId, fileKey) }
    },
  )

  ipcMain.handle(
    'fs:upload',
    async (event, sessionId: string, remoteDir: string) => {
      const win = windowFromEvent(event)
      const dialogOpts = {
        title: 'Upload to server',
        properties: [
          'openFile',
          'openDirectory',
          'multiSelections',
        ] as Array<'openFile' | 'openDirectory' | 'multiSelections'>,
      }
      const result = win
        ? await dialog.showOpenDialog(win, dialogOpts)
        : await dialog.showOpenDialog(dialogOpts)
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false as const }
      }
      const targetDir = remoteDir && remoteDir !== '' ? remoteDir : '/'
      const resultTransfer = await ssh.uploadLocal(
        sessionId,
        result.filePaths,
        targetDir,
        (progress) => emitFsUploadProgress(event, progress),
      )
      return {
        ok: true as const,
        count: resultTransfer.saved,
        cancelled: resultTransfer.cancelled,
        dir: targetDir,
      }
    },
  )

  ipcMain.handle(
    'fs:uploadPaths',
    async (
      event,
      sessionId: string,
      localPaths: string[],
      remoteDir: string,
    ) => {
      const paths = localPaths.filter((item) => typeof item === 'string' && item)
      if (paths.length === 0) return { ok: false as const }
      const targetDir = remoteDir && remoteDir !== '' ? remoteDir : '/'
      const resultTransfer = await ssh.uploadLocal(
        sessionId,
        paths,
        targetDir,
        (progress) => emitFsUploadProgress(event, progress),
      )
      return {
        ok: true as const,
        count: resultTransfer.saved,
        cancelled: resultTransfer.cancelled,
        dir: targetDir,
      }
    },
  )

  ipcMain.handle(
    'fs:mkdir',
    async (_event, sessionId: string, remotePath: string) => {
      await ssh.mkdir(sessionId, remotePath)
      return { ok: true as const }
    },
  )

  ipcMain.handle(
    'fs:rename',
    async (
      _event,
      sessionId: string,
      fromPath: string,
      toPath: string,
    ) => {
      await ssh.rename(sessionId, fromPath, toPath)
      return { ok: true as const }
    },
  )

  ipcMain.handle(
    'fs:remove',
    async (_event, sessionId: string, remotePath: string) => {
      const count = await ssh.removeRemote(sessionId, remotePath)
      return { ok: true as const, count }
    },
  )

  ipcMain.handle(
    'editor:open',
    async (_event, sessionId: string, remotePath: string) => {
      if (isArchiveName(remotePath)) {
        await openArchiveWindow(sessionId, remotePath)
        return { ok: true }
      }
      await openEditorWindow(sessionId, remotePath)
      return { ok: true }
    },
  )

  ipcMain.handle(
    'viewer:open',
    async (_event, sessionId: string, remotePath: string) => {
      await openViewerWindow(sessionId, remotePath)
      return { ok: true }
    },
  )

  ipcMain.handle(
    'archive:open',
    async (_event, sessionId: string, remotePath: string) => {
      await openArchiveWindow(sessionId, remotePath)
      return { ok: true }
    },
  )

  ipcMain.handle(
    'archive:list',
    async (_event, sessionId: string, remotePath: string) => {
      const cached = await ensureArchiveCached(sessionId, remotePath)
      return {
        name: cached.name,
        size: cached.size,
        entries: cached.entries,
      }
    },
  )

  ipcMain.handle(
    'archive:extract',
    async (
      event,
      sessionId: string,
      remotePath: string,
      paths: string[] | null,
    ) => {
      const cached = await ensureArchiveCached(sessionId, remotePath)
      const destDir = remoteParentDir(remotePath)
      const tmpRoot = path.join(
        os.tmpdir(),
        'customssh-archive-extract',
        crypto.randomBytes(8).toString('hex'),
      )
      fs.mkdirSync(tmpRoot, { recursive: true })
      try {
        await extractArchiveFile(
          cached.localPath,
          cached.kind,
          paths,
          tmpRoot,
        )
        const locals = fs.existsSync(tmpRoot)
          ? fs.readdirSync(tmpRoot).map((name) => path.join(tmpRoot, name))
          : []
        if (locals.length === 0) {
          return {
            ok: true as const,
            cancelled: false as const,
            count: 0,
            dest: destDir,
          }
        }
        const resultTransfer = await ssh.uploadLocal(
          sessionId,
          locals,
          destDir,
          (progress) => emitFsUploadProgress(event, progress),
        )
        sendIpc(mainWindow?.webContents, 'fs:remote-changed', {
          sessionId,
          remoteDir: destDir,
        })
        return {
          ok: true as const,
          cancelled: false as const,
          count: resultTransfer.saved,
          dest: destDir,
        }
      } finally {
        try {
          fs.rmSync(tmpRoot, { recursive: true, force: true })
        } catch {
          // ignore
        }
      }
    },
  )

  ipcMain.handle(
    'archive:openEntry',
    async (
      _event,
      sessionId: string,
      remotePath: string,
      entryPath: string,
    ) => {
      const cached = await ensureArchiveCached(sessionId, remotePath)
      const entry = cached.entries.find((item) => item.path === entryPath)
      if (!entry || entry.isDir) {
        throw new Error('ARCHIVE_OPEN_FAILED')
      }
      const tmpRoot = path.join(
        os.tmpdir(),
        'customssh-archive-open',
        crypto.randomBytes(8).toString('hex'),
      )
      fs.mkdirSync(tmpRoot, { recursive: true })
      await extractArchiveFile(
        cached.localPath,
        cached.kind,
        [entryPath],
        tmpRoot,
      )
      const localFile = path.join(tmpRoot, ...entryPath.split('/').filter(Boolean))
      const opened = await shell.openPath(localFile)
      if (opened) throw new Error(opened)
      return { ok: true as const }
    },
  )

  ipcMain.handle(
    'fs:readBinary',
    async (_event, sessionId: string, remotePath: string) => {
      return ssh.readBinaryFile(sessionId, remotePath)
    },
  )

  ipcMain.handle(
    'menu:fileActions',
    async (
      event,
      payload: {
        items: Array<{ id: string; label: string }>
      },
    ) => {
      const win = windowFromEvent(event)
      if (!win) return null
      const items = payload.items.filter((item) => item.id && item.label)
      if (items.length === 0) return null

      return await new Promise<string | null>((resolve) => {
        let settled = false
        const done = (action: string | null) => {
          if (settled) return
          settled = true
          resolve(action)
        }

        const menu = Menu.buildFromTemplate(
          items.map((item) => ({
            label: item.label,
            click: () => done(item.id),
          })),
        )

        menu.popup({
          window: win,
          callback: () => done(null),
        })
      })
    },
  )

  ipcMain.handle('shell:openExternal', (_event, url: string) => {
    return shell.openExternal(url)
  })

  ipcMain.handle('window:minimize', async (event) => {
    const win = windowFromEvent(event)
    if (!win) return
    if (win === mainWindow) await playMinimizeAnimation(win)
    else win.minimize()
  })

  ipcMain.handle('window:fullscreenToggle', (event) => {
    const win = windowFromEvent(event)
    if (!win) return false
    return toggleWindowFill(win)
  })

  ipcMain.handle(
    'window:restoreForDrag',
    (event, cursorX: number, cursorY: number) => {
      const win = windowFromEvent(event)
      if (!win) return false
      return restoreWindowForDrag(win, cursorX, cursorY)
    },
  )

  ipcMain.on('window:dragTo', (event, cursorX: number, cursorY: number) => {
    const win = windowFromEvent(event)
    if (win) dragWindowTo(win, cursorX, cursorY)
  })

  ipcMain.handle('window:endDrag', (event) => {
    const win = windowFromEvent(event)
    if (win) endWindowDrag(win)
  })

  ipcMain.handle('window:close', (event) => {
    windowFromEvent(event)?.close()
  })

  ipcMain.handle('window:forceClose', (event) => {
    const win = windowFromEvent(event) as
      | (BrowserWindow & { __forceClose?: boolean })
      | null
    if (!win) return
    win.__forceClose = true
    win.close()
  })

  ipcMain.handle('window:hideToTray', () => {
    hideMainToTray()
  })

  ipcMain.handle('window:quitApp', () => {
    forceQuitAllWindows()
  })

  ipcMain.handle('tray:reportState', (_event, state: TrayPopupState) => {
    setTrayPopupState({
      sessions: Array.isArray(state?.sessions) ? state.sessions : [],
      connections: Array.isArray(state?.connections) ? state.connections : [],
    })
  })

  ipcMain.handle('tray:getState', () => getTrayPopupState())

  ipcMain.handle('tray:setPopupHeight', (event, height: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    const nextHeight = Math.max(248, Math.min(560, Math.round(height)))
    positionTrayPopup(win, nextHeight)
  })

  ipcMain.handle('tray:openApp', () => {
    destroyTrayPopup()
    showMainWindow()
  })

  ipcMain.handle('tray:hidePopup', () => {
    hideTrayPopup()
  })

  ipcMain.handle('tray:quickConnect', (_event, connectionId: string) => {
    destroyTrayPopup()
    showMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tray:quick-connect', connectionId)
    }
  })

  ipcMain.handle('tray:disconnect', (_event, sessionId: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tray:disconnect', sessionId)
    }
  })

  ipcMain.handle('tray:quit', () => {
    forceQuitAllWindows()
  })

  ipcMain.handle(
    'dialog:confirm',
    async (
      event,
      payload: {
        title: string
        message: string
        detail?: string
        confirmLabel: string
        cancelLabel: string
      },
    ) => {
      const win = windowFromEvent(event)
      const opts = {
        type: 'warning' as const,
        buttons: [payload.confirmLabel, payload.cancelLabel],
        defaultId: 1,
        cancelId: 1,
        title: payload.title,
        message: payload.message,
        detail: payload.detail,
        noLink: true,
      }
      const result = win
        ? await dialog.showMessageBox(win, opts)
        : await dialog.showMessageBox(opts)
      return result.response === 0
    },
  )

  ipcMain.handle('window:isFullscreen', (event) => {
    const win = windowFromEvent(event)
    if (!win) return false
    return win.isMaximized() || win.isFullScreen()
  })
}
