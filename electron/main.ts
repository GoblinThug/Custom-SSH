import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  nativeImage,
  screen,
  Menu,
  Tray,
} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { SshManager } from './ssh-manager'
import {
  buildExportPayload,
  mergeImport,
  parseImportFile,
  type ImportSource,
} from './importers'
import {
  deleteConnection,
  deleteFolder,
  getSecretsInfo,
  loadWorkspace,
  replaceWorkspace,
  saveConnection,
  saveFolder,
  touchConnection,
} from './store'
import { loadSettings, saveSettings } from './settings-store'
import { fadeOpacity } from './window-fx'
import { initAutoUpdater } from './updater'
import type {
  AppSettings,
  AppTheme,
  ConnectPayload,
  ConnectionFolder,
  SavedConnection,
} from './types'

let mainWindow: BrowserWindow | null = null
const editorWindows = new Map<string, BrowserWindow>()
const ssh = new SshManager(() => mainWindow)
/** Manual fullscreen — more reliable than setFullScreen on frameless Windows. */
let appFullscreen = false
let boundsBeforeFullscreen: Electron.Rectangle | null = null
let animatingWindow = false
let tray: Tray | null = null
let trayPopup: BrowserWindow | null = null
/** True while the tray mini-menu is considered open (more reliable than isVisible on Win). */
let trayPopupShown = false
/** Ignore tray clicks that arrive right after an outside blur-hide. */
let ignoreTrayClickUntil = 0
let trayBlurHideTimer: ReturnType<typeof setTimeout> | null = null
/** True while the app is exiting for real (tray Quit / Quit from modal). */
let isQuitting = false

type TraySessionInfo = {
  sessionId: string
  label: string
  title: string
  status: 'connecting' | 'connected' | 'reconnecting'
  connectionId?: string
}

type TrayConnectionInfo = {
  id: string
  name: string
  host: string
  port: number
  username: string
  folderColor?: string | null
}

type TrayPopupState = {
  sessions: TraySessionInfo[]
  connections: TrayConnectionInfo[]
}

let trayPopupState: TrayPopupState = { sessions: [], connections: [] }
/** Last known tray icon rect (click bounds or getBounds); reused when height changes. */
let lastTrayAnchor: Electron.Rectangle | null = null

type PanelEdge = 'top' | 'bottom' | 'left' | 'right'

function clampTrayCoord(value: number, min: number, max: number) {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

/** Detect dock/taskbar/menu-bar side from display workArea insets. */
function panelEdgeFromWorkArea(
  bounds: Electron.Rectangle,
  work: Electron.Rectangle,
): PanelEdge | null {
  const gaps: Array<[PanelEdge, number]> = [
    ['top', work.y - bounds.y],
    ['left', work.x - bounds.x],
    ['bottom', bounds.y + bounds.height - (work.y + work.height)],
    ['right', bounds.x + bounds.width - (work.x + work.width)],
  ]
  gaps.sort((a, b) => b[1] - a[1])
  return gaps[0][1] > 2 ? gaps[0][0] : null
}

/** When workArea has no inset (auto-hide / Linux), infer from tray/cursor location. */
function panelEdgeFromAnchor(
  bounds: Electron.Rectangle,
  anchorX: number,
  anchorY: number,
): PanelEdge {
  const relX = (anchorX - bounds.x) / Math.max(bounds.width, 1)
  const relY = (anchorY - bounds.y) / Math.max(bounds.height, 1)
  const dist: Array<[PanelEdge, number]> = [
    ['top', relY],
    ['bottom', 1 - relY],
    ['left', relX],
    ['right', 1 - relX],
  ]
  dist.sort((a, b) => a[1] - b[1])
  return dist[0][0]
}

function resolveTrayAnchor(
  preferred?: Electron.Rectangle | null,
): Electron.Rectangle {
  const cursor = screen.getCursorScreenPoint()
  const candidates = [preferred, lastTrayAnchor, tray?.getBounds() ?? null]
  for (const box of candidates) {
    if (box && box.width > 0 && box.height > 0) {
      lastTrayAnchor = box
      return box
    }
  }
  // Linux (and rare Win/mac glitches): getBounds is empty — fake a 1×1 at cursor.
  const fallback = { x: cursor.x, y: cursor.y, width: 1, height: 1 }
  lastTrayAnchor = fallback
  return fallback
}

function windowFromEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

function clearTrayBlurHideTimer() {
  if (!trayBlurHideTimer) return
  clearTimeout(trayBlurHideTimer)
  trayBlurHideTimer = null
}

function hideTrayPopup() {
  clearTrayBlurHideTimer()
  trayPopupShown = false
  if (!trayPopup || trayPopup.isDestroyed()) return
  trayPopup.hide()
}

function destroyTrayPopup() {
  clearTrayBlurHideTimer()
  trayPopupShown = false
  if (!trayPopup || trayPopup.isDestroyed()) {
    trayPopup = null
    return
  }
  trayPopup.destroy()
  trayPopup = null
}

function destroyTray() {
  destroyTrayPopup()
  if (!tray) return
  tray.destroy()
  tray = null
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function broadcastTrayState() {
  if (trayPopup && !trayPopup.isDestroyed()) {
    trayPopup.webContents.send('tray:state', trayPopupState)
  }
}

function setTrayPopupState(next: TrayPopupState) {
  trayPopupState = next
  const online = next.sessions.some((session) => session.status === 'connected')
  tray?.setToolTip(online ? 'Custom SSH — connected' : 'Custom SSH')
  broadcastTrayState()
}

async function loadTrayPopupPage(win: BrowserWindow) {
  if (process.env.VITE_DEV_SERVER_URL) {
    const url = new URL('/tray.html', process.env.VITE_DEV_SERVER_URL)
    await win.loadURL(url.toString())
  } else {
    await win.loadFile(path.join(__dirname, '../dist/tray.html'))
  }
}

function positionTrayPopup(
  win: BrowserWindow,
  height: number,
  preferredAnchor?: Electron.Rectangle | null,
) {
  // 300px card + horizontal padding for rounded shadow bleed.
  const width = 328
  const gap = 8
  const trayBox = resolveTrayAnchor(preferredAnchor)
  const anchorX = trayBox.x + trayBox.width / 2
  const anchorY = trayBox.y + trayBox.height / 2
  const display = screen.getDisplayNearestPoint({
    x: Math.round(anchorX),
    y: Math.round(anchorY),
  })
  const work = display.workArea
  const bounds = display.bounds

  // Prefer where the tray icon actually is. Largest workArea inset is wrong on
  // macOS (Dock often bigger than the menu bar while the icon sits at the top).
  let edge = panelEdgeFromAnchor(bounds, anchorX, anchorY)
  const workEdge = panelEdgeFromWorkArea(bounds, work)
  if (workEdge && workEdge === edge) {
    // Confirmed by reserved strip.
  } else if (
    workEdge &&
    // Only trust workArea when the icon sits clearly inside that strip.
    ((workEdge === 'top' && trayBox.y + trayBox.height <= work.y + 4) ||
      (workEdge === 'bottom' &&
        trayBox.y >= work.y + work.height - 4) ||
      (workEdge === 'left' && trayBox.x + trayBox.width <= work.x + 4) ||
      (workEdge === 'right' && trayBox.x >= work.x + work.width - 4))
  ) {
    edge = workEdge
  }

  // macOS status items live in the menu bar even when detection is noisy.
  if (process.platform === 'darwin') {
    const nearTop = anchorY < bounds.y + Math.max(48, work.y - bounds.y + 24)
    if (nearTop) edge = 'top'
  }

  // Minimum clearance under a visible macOS menu bar when workArea.y is 0.
  const topSafe =
    process.platform === 'darwin'
      ? Math.max(work.y, bounds.y + 28)
      : work.y

  let x: number
  let y: number
  switch (edge) {
    case 'top':
      x = Math.round(anchorX - width / 2)
      y = Math.round(Math.max(trayBox.y + trayBox.height, topSafe) + gap)
      break
    case 'bottom':
      x = Math.round(anchorX - width / 2)
      y = Math.round(trayBox.y - height - gap)
      break
    case 'left':
      x = Math.round(trayBox.x + trayBox.width + gap)
      y = Math.round(anchorY - height / 2)
      break
    case 'right':
      x = Math.round(trayBox.x - width - gap)
      y = Math.round(anchorY - height / 2)
      break
  }

  const minX = work.x + gap
  const maxX = work.x + work.width - width - gap
  const minY = (edge === 'top' ? topSafe : work.y) + gap
  const maxY = work.y + work.height - height - gap
  x = clampTrayCoord(x, minX, maxX)
  y = clampTrayCoord(y, minY, maxY)

  win.setBounds({ x, y, width, height })
}

async function ensureTrayPopup() {
  if (trayPopup && !trayPopup.isDestroyed()) return trayPopup

  const win = new BrowserWindow({
    width: 300,
    height: 360,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // Native OS shadow is rectangular on Windows and fights CSS radius.
    hasShadow: false,
    backgroundColor: '#00000000',
    roundedCorners: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  trayPopup = win
  win.setMenu(null)
  win.on('blur', () => {
    if (!trayPopupShown || !trayPopup || trayPopup.isDestroyed()) return
    // Delay hide so a tray-icon click can cancel it and keep the menu open.
    clearTrayBlurHideTimer()
    trayBlurHideTimer = setTimeout(() => {
      trayBlurHideTimer = null
      hideTrayPopup()
      ignoreTrayClickUntil = Date.now() + 400
    }, 180)
  })
  win.on('closed', () => {
    if (trayPopup === win) {
      trayPopup = null
      trayPopupShown = false
    }
  })

  await loadTrayPopupPage(win)
  return win
}

function refreshTrayConnectionsFromStore() {
  const workspace = loadWorkspace()
  const folderColorById = new Map(
    workspace.folders.map((folder) => [folder.id, folder.color] as const),
  )
  trayPopupState = {
    ...trayPopupState,
    connections: workspace.connections.map((item) => ({
      id: item.id,
      name: item.name,
      host: item.host,
      port: item.port,
      username: item.username,
      folderColor: item.folderId
        ? folderColorById.get(item.folderId) ?? null
        : null,
    })),
  }
}

/** Tray click only opens. If already open, another tray click does nothing. */
async function openTrayPopupFromTray(clickBounds?: Electron.Rectangle) {
  clearTrayBlurHideTimer()
  if (Date.now() < ignoreTrayClickUntil) return
  if (trayPopupShown) return

  refreshTrayConnectionsFromStore()
  const win = await ensureTrayPopup()
  broadcastTrayState()
  positionTrayPopup(win, win.getBounds().height, clickBounds)
  trayPopupShown = true
  win.show()
  win.focus()
}

function ensureTray() {
  if (tray) return
  const icon = resolveAppIcon()
  tray = new Tray(icon ?? nativeImage.createEmpty())
  tray.setToolTip('Custom SSH')
  tray.on('click', (_event, bounds) => {
    void openTrayPopupFromTray(bounds)
  })
  tray.on('right-click', (_event, bounds) => {
    void openTrayPopupFromTray(bounds)
  })
  tray.on('double-click', () => {
    showMainWindow()
    destroyTrayPopup()
  })
}

function hideMainToTray() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  ensureTray()
  if (appFullscreen) {
    appFullscreen = false
    boundsBeforeFullscreen = null
  }
  destroyTrayPopup()
  mainWindow.hide()
}

function editorKey(sessionId: string, remotePath: string) {
  return `${sessionId}::${remotePath}`
}

async function openEditorWindow(sessionId: string, remotePath: string) {
  const key = editorKey(sessionId, remotePath)
  const existing = editorWindows.get(key)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return
  }

  const win = new BrowserWindow({
    width: 1100,
    height: 740,
    minWidth: 720,
    minHeight: 480,
    frame: false,
    transparent: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    // Windows 11 OS rounding + CSS 14px radius leaves a translucent crescent
    // in the corners; let CSS alone shape the window on win32.
    roundedCorners: process.platform !== 'win32',
    show: false,
    title: 'Custom SSH',
    icon: resolveAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  editorWindows.set(key, win)
  ;(win as BrowserWindow & { __forceClose?: boolean }).__forceClose = false
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) void playShowAnimation(win)
  })
  win.on('close', (event) => {
    const editorWin = win as BrowserWindow & { __forceClose?: boolean }
    if (isQuitting || editorWin.__forceClose || win.isDestroyed()) return
    event.preventDefault()
    win.webContents.send('editor:close-request')
  })
  win.on('closed', () => {
    editorWindows.delete(key)
  })

  const query = {
    sessionId,
    path: remotePath,
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    const url = new URL('/editor.html', process.env.VITE_DEV_SERVER_URL)
    url.searchParams.set('sessionId', sessionId)
    url.searchParams.set('path', remotePath)
    await win.loadURL(url.toString())
  } else {
    await win.loadFile(path.join(__dirname, '../dist/editor.html'), { query })
  }
}

function emitWindowState(win: BrowserWindow) {
  win.webContents.send('window:state', {
    maximized: win.isMaximized(),
    fullscreen: appFullscreen || win.isFullScreen(),
  })
}

function playShowAnimation(win: BrowserWindow) {
  win.setOpacity(1)
  win.show()
  // GPU-friendly enter motion lives in the renderer (CSS), not HWND resizing.
  win.webContents.send('window:fx', { type: 'enter' })
}

async function playMinimizeAnimation(win: BrowserWindow) {
  if (animatingWindow || win.isMinimized()) return
  animatingWindow = true
  try {
    win.webContents.send('window:fx', { type: 'minimize' })
    await fadeOpacity(win, 1, 0, 160)
    if (!win.isDestroyed()) win.minimize()
  } finally {
    // Ready for a clean restore fade-in.
    if (!win.isDestroyed()) win.setOpacity(1)
    animatingWindow = false
  }
}

async function playRestoreAnimation(win: BrowserWindow) {
  if (animatingWindow) return
  animatingWindow = true
  try {
    win.setOpacity(0)
    win.webContents.send('window:fx', { type: 'restore' })
    await fadeOpacity(win, 0, 1, 180)
  } finally {
    animatingWindow = false
  }
}

async function toggleFullscreen(): Promise<boolean> {
  if (!mainWindow || animatingWindow) {
    return appFullscreen
  }

  animatingWindow = true
  try {
    if (appFullscreen) {
      const bounds = boundsBeforeFullscreen
      appFullscreen = false
      boundsBeforeFullscreen = null

      if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false)
      if (mainWindow.isMaximized()) mainWindow.unmaximize()

      await fadeOpacity(mainWindow, 1, 0.82, 70)
      if (bounds) mainWindow.setBounds(bounds, false)
      mainWindow.webContents.send('window:fx', { type: 'fullscreen-exit' })
      await fadeOpacity(mainWindow, 0.82, 1, 120)
      emitWindowState(mainWindow)
      return false
    }

    boundsBeforeFullscreen = mainWindow.isMaximized()
      ? mainWindow.getNormalBounds()
      : mainWindow.getBounds()

    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false)

    const display = screen.getDisplayMatching(boundsBeforeFullscreen)
    appFullscreen = true
    await fadeOpacity(mainWindow, 1, 0.82, 70)
    mainWindow.setBounds(display.bounds, false)
    mainWindow.webContents.send('window:fx', { type: 'fullscreen-enter' })
    await fadeOpacity(mainWindow, 0.82, 1, 120)
    emitWindowState(mainWindow)
    return true
  } finally {
    animatingWindow = false
  }
}

function resolveAppIcon() {
  const candidates = [
    path.join(process.resourcesPath, 'build', 'icon.ico'),
    path.join(process.resourcesPath, 'build', 'icon.png'),
    path.join(__dirname, '../build/icon.ico'),
    path.join(__dirname, '../build/icon.png'),
    path.join(__dirname, '../../build/icon.ico'),
    path.join(__dirname, '../../build/icon.png'),
  ]
  for (const iconPath of candidates) {
    if (!fs.existsSync(iconPath)) continue
    const image = nativeImage.createFromPath(iconPath)
    if (!image.isEmpty()) return image
  }
  return undefined
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 620,
    frame: false,
    transparent: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    // Windows 11 OS rounding + CSS 14px radius leaves a translucent crescent
    // in the corners; let CSS alone shape the window on win32.
    roundedCorners: process.platform !== 'win32',
    show: false,
    title: 'Custom SSH',
    icon: resolveAppIcon(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) void playShowAnimation(mainWindow)
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    const url = process.env.VITE_DEV_SERVER_URL
    const loadWithRetry = async (attempt = 0) => {
      try {
        await mainWindow?.loadURL(url)
      } catch {
        if (attempt < 20) {
          setTimeout(() => {
            void loadWithRetry(attempt + 1)
          }, 250)
        }
      }
    }
    void loadWithRetry()
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('maximize', () => {
    if (mainWindow) emitWindowState(mainWindow)
  })
  mainWindow.on('unmaximize', () => {
    if (mainWindow) emitWindowState(mainWindow)
  })
  mainWindow.on('enter-full-screen', () => {
    if (mainWindow) emitWindowState(mainWindow)
  })
  mainWindow.on('leave-full-screen', () => {
    if (mainWindow) emitWindowState(mainWindow)
  })
  mainWindow.on('restore', () => {
    if (mainWindow) void playRestoreAnimation(mainWindow)
  })
  // If user leaves our manual fullscreen by other means, drop the flag.
  mainWindow.on('resize', () => {
    if (
      !mainWindow ||
      !appFullscreen ||
      !boundsBeforeFullscreen ||
      animatingWindow
    ) {
      return
    }
    const current = mainWindow.getBounds()
    const display = screen.getDisplayMatching(boundsBeforeFullscreen)
    const full = display.bounds
    const stillFull =
      Math.abs(current.x - full.x) <= 2 &&
      Math.abs(current.y - full.y) <= 2 &&
      Math.abs(current.width - full.width) <= 4 &&
      Math.abs(current.height - full.height) <= 4
    if (!stillFull) {
      appFullscreen = false
      boundsBeforeFullscreen = null
      emitWindowState(mainWindow)
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    appFullscreen = false
    boundsBeforeFullscreen = null
  })

  mainWindow.on('close', (event) => {
    if (isQuitting || mainWindow?.isDestroyed()) return
    event.preventDefault()
    mainWindow?.webContents.send('window:close-request')
  })
}

function registerIpc() {
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
      const result = await ssh.connect(sessionId, payload)
      return { ok: true as const, shellId: result.shellId }
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
    return ssh.ping(sessionId)
  })

  ipcMain.handle('fs:cwd', async (_event, sessionId: string) => {
    return ssh.getCwd(sessionId)
  })

  ipcMain.handle(
    'fs:list',
    async (_event, sessionId: string, remotePath: string) => {
      return ssh.listDir(sessionId, remotePath)
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
    event.sender.send('fs:download-progress', progress)
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
    event.sender.send('fs:upload-progress', progress)
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
      await openEditorWindow(sessionId, remotePath)
      return { ok: true }
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

  ipcMain.handle('window:fullscreenToggle', async (event) => {
    const win = windowFromEvent(event)
    if (!win) return false
    if (win === mainWindow) return toggleFullscreen()
    if (win.isMaximized()) {
      win.unmaximize()
      return false
    }
    win.maximize()
    return true
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
    isQuitting = true
    destroyTray()
    for (const win of BrowserWindow.getAllWindows()) {
      const flagged = win as BrowserWindow & { __forceClose?: boolean }
      flagged.__forceClose = true
    }
    app.quit()
  })

  ipcMain.handle('tray:reportState', (_event, state: TrayPopupState) => {
    setTrayPopupState({
      sessions: Array.isArray(state?.sessions) ? state.sessions : [],
      connections: Array.isArray(state?.connections) ? state.connections : [],
    })
  })

  ipcMain.handle('tray:getState', () => trayPopupState)

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
    isQuitting = true
    destroyTray()
    for (const win of BrowserWindow.getAllWindows()) {
      const flagged = win as BrowserWindow & { __forceClose?: boolean }
      flagged.__forceClose = true
    }
    app.quit()
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
    if (win === mainWindow) {
      return appFullscreen || win.isFullScreen()
    }
    return win.isMaximized()
  })
}

app.setName('Custom SSH')

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: 'Custom SSH',
      applicationVersion: app.getVersion(),
      copyright: 'Goblin_Thug',
    })
  }

  registerIpc()
  createWindow()
  ensureTray()
  initAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showMainWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
  destroyTray()
})

app.on('window-all-closed', () => {
  if (tray) return
  if (process.platform !== 'darwin') app.quit()
})
