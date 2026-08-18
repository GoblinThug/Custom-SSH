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
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { isConnectCancelled, SshManager } from './ssh-manager'
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
import {
  archiveKindFromName,
  extractArchiveFile,
  isArchiveName,
  listArchiveFile,
  type ArchiveKind,
  type ArchiveListEntry,
} from './archive'
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
const viewerWindows = new Map<string, BrowserWindow>()
const archiveWindows = new Map<string, BrowserWindow>()
const MAX_ARCHIVE_BYTES = 80 * 1024 * 1024

type ArchiveCache = {
  localPath: string
  kind: ArchiveKind
  entries: ArchiveListEntry[]
  size: number
  name: string
}

const archiveCache = new Map<string, ArchiveCache>()
const archiveInflight = new Map<string, Promise<ArchiveCache>>()
const ssh = new SshManager(() => mainWindow)
let animatingWindow = false
let expectRestoreFx = false
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
  destroyTrayPopup()
  mainWindow.hide()
}

function editorKey(sessionId: string, remotePath: string) {
  return `${sessionId}::${remotePath}`
}

function viewerKey(sessionId: string, remotePath: string) {
  return `${sessionId}::${remotePath}`
}

function archiveKey(sessionId: string, remotePath: string) {
  return `${sessionId}::${remotePath}`
}

function remoteParentDir(remotePath: string): string {
  const normalized = remotePath.replace(/\\/g, '/').replace(/\/+$/, '')
  const index = normalized.lastIndexOf('/')
  if (index <= 0) return '/'
  return normalized.slice(0, index) || '/'
}

function isMissingRemote(err: unknown): boolean {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? Number((err as { code?: unknown }).code)
      : NaN
  const message = err instanceof Error ? err.message : String(err ?? '')
  return code === 2 || /no such file/i.test(message)
}

function disposeArchiveCache(key: string) {
  const cached = archiveCache.get(key)
  archiveCache.delete(key)
  if (!cached) return
  try {
    fs.unlinkSync(cached.localPath)
  } catch {
    // already gone
  }
}

function safeTempName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') || 'archive'
}

async function openArchiveWindow(sessionId: string, remotePath: string) {
  const key = archiveKey(sessionId, remotePath)
  const existing = archiveWindows.get(key)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return
  }

  const win = new BrowserWindow(
    appWindowOptions({
      width: 900,
      height: 640,
      minWidth: 560,
      minHeight: 400,
    }),
  )

  archiveWindows.set(key, win)
  ;(win as BrowserWindow & { __forceClose?: boolean }).__forceClose = false
  bindWindowChrome(win)
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) void playShowAnimation(win)
  })
  win.on('close', (event) => {
    const archiveWin = win as BrowserWindow & { __forceClose?: boolean }
    if (isQuitting || archiveWin.__forceClose || win.isDestroyed()) return
    event.preventDefault()
    win.webContents.send('archive:close-request')
  })
  win.on('closed', () => {
    archiveWindows.delete(key)
    const pending = archiveInflight.get(key)
    if (pending) {
      void pending.finally(() => {
        if (!archiveWindows.has(key)) disposeArchiveCache(key)
      })
      return
    }
    disposeArchiveCache(key)
  })

  const query = { sessionId, path: remotePath }

  if (process.env.VITE_DEV_SERVER_URL) {
    const url = new URL('/archive.html', process.env.VITE_DEV_SERVER_URL)
    url.searchParams.set('sessionId', sessionId)
    url.searchParams.set('path', remotePath)
    await win.loadURL(url.toString())
  } else {
    await win.loadFile(path.join(__dirname, '../dist/archive.html'), { query })
  }
}

async function ensureArchiveCached(
  sessionId: string,
  remotePath: string,
): Promise<ArchiveCache> {
  const key = archiveKey(sessionId, remotePath)
  const hit = archiveCache.get(key)
  if (hit && fs.existsSync(hit.localPath)) return hit
  if (hit) archiveCache.delete(key)

  const pending = archiveInflight.get(key)
  if (pending) return pending

  const job = (async () => {
    const kind = archiveKindFromName(remotePath)
    if (!kind) throw new Error('ARCHIVE_UNSUPPORTED')
    const size = await ssh.remoteFileSize(sessionId, remotePath)
    if (size > MAX_ARCHIVE_BYTES) throw new Error('ARCHIVE_TOO_LARGE')

    const dir = path.join(os.tmpdir(), 'customssh-archives')
    fs.mkdirSync(dir, { recursive: true })
    const id = crypto.randomBytes(8).toString('hex')
    const localPath = path.join(
      dir,
      `${id}-${safeTempName(path.basename(remotePath))}`,
    )
    try {
      await ssh.downloadFile(sessionId, remotePath, localPath)
      const entries = await listArchiveFile(localPath, kind)
      const cached: ArchiveCache = {
        localPath,
        kind,
        entries,
        size,
        name: path.basename(remotePath) || 'archive',
      }
      archiveCache.set(key, cached)
      return cached
    } catch (err) {
      try {
        fs.unlinkSync(localPath)
      } catch {
        // ignore
      }
      throw err
    }
  })().finally(() => {
    archiveInflight.delete(key)
  })

  archiveInflight.set(key, job)
  return job
}

async function openViewerWindow(sessionId: string, remotePath: string) {
  const key = viewerKey(sessionId, remotePath)
  const existing = viewerWindows.get(key)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return
  }

  const win = new BrowserWindow(
    appWindowOptions({
      width: 960,
      height: 720,
      minWidth: 480,
      minHeight: 360,
    }),
  )

  viewerWindows.set(key, win)
  ;(win as BrowserWindow & { __forceClose?: boolean }).__forceClose = false
  bindWindowChrome(win)
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) void playShowAnimation(win)
  })
  win.on('close', (event) => {
    const viewerWin = win as BrowserWindow & { __forceClose?: boolean }
    if (isQuitting || viewerWin.__forceClose || win.isDestroyed()) return
    event.preventDefault()
    win.webContents.send('viewer:close-request')
  })
  win.on('closed', () => {
    viewerWindows.delete(key)
  })

  const query = { sessionId, path: remotePath }

  if (process.env.VITE_DEV_SERVER_URL) {
    const url = new URL('/viewer.html', process.env.VITE_DEV_SERVER_URL)
    url.searchParams.set('sessionId', sessionId)
    url.searchParams.set('path', remotePath)
    await win.loadURL(url.toString())
  } else {
    await win.loadFile(path.join(__dirname, '../dist/viewer.html'), { query })
  }
}

async function openEditorWindow(sessionId: string, remotePath: string) {
  const key = editorKey(sessionId, remotePath)
  const existing = editorWindows.get(key)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return
  }

  const win = new BrowserWindow(
    appWindowOptions({
      width: 1100,
      height: 740,
      minWidth: 720,
      minHeight: 480,
    }),
  )

  editorWindows.set(key, win)
  ;(win as BrowserWindow & { __forceClose?: boolean }).__forceClose = false
  bindWindowChrome(win)
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
  if (win.isDestroyed()) return
  const filled = win.isMaximized() || win.isFullScreen()
  win.webContents.send('window:state', {
    maximized: win.isMaximized(),
    fullscreen: filled,
  })
}

const WM_NCLBUTTONDOWN = 0x00A1
const WM_EXITSIZEMOVE = 0x0232
const HT_CAPTION = 2
const SNAP_EDGE_PX = 14

const lastNormalBounds = new WeakMap<BrowserWindow, Electron.Rectangle>()
const dragGrab = new WeakMap<BrowserWindow, { dx: number; dy: number }>()

function readWinParam(value: Buffer | number): number {
  if (typeof value === 'number') return value
  if (Buffer.isBuffer(value) && value.length >= 4) return value.readUInt32LE(0)
  return 0
}

function rememberNormalBounds(win: BrowserWindow) {
  if (
    win.isDestroyed() ||
    win.isMaximized() ||
    win.isMinimized() ||
    win.isFullScreen()
  ) {
    return
  }
  const bounds = win.getBounds()
  const work = screen.getDisplayMatching(bounds).workArea
  // Side-snapped windows fill the work area height — don't use that as restore size.
  if (
    Math.abs(bounds.height - work.height) <= 8 &&
    Math.abs(bounds.y - work.y) <= 4
  ) {
    return
  }
  lastNormalBounds.set(win, bounds)
}

function boundsForRestore(win: BrowserWindow): Electron.Rectangle {
  const stored = lastNormalBounds.get(win)
  if (stored && stored.width >= 320 && stored.height >= 240) return stored
  try {
    const normal = win.getNormalBounds()
    if (normal.width >= 320 && normal.height >= 240) return normal
  } catch {
    // getNormalBounds can throw on some frameless states.
  }
  const work = screen.getDisplayMatching(win.getBounds()).workArea
  return {
    x: work.x + Math.round(work.width * 0.1),
    y: work.y + Math.round(work.height * 0.1),
    width: Math.round(work.width * 0.7),
    height: Math.round(work.height * 0.7),
  }
}

function isFilledWindow(win: BrowserWindow) {
  if (win.isMaximized() || win.isFullScreen()) return true
  const bounds = win.getBounds()
  const work = screen.getDisplayMatching(bounds).workArea
  return (
    Math.abs(bounds.x - work.x) <= 4 &&
    Math.abs(bounds.y - work.y) <= 4 &&
    Math.abs(bounds.width - work.width) <= 8 &&
    Math.abs(bounds.height - work.height) <= 8
  )
}

function restoreWindowForDrag(
  win: BrowserWindow,
  cursorX: number,
  cursorY: number,
) {
  if (win.isDestroyed() || !isFilledWindow(win)) return false
  const maxBounds = win.getBounds()
  const normal = boundsForRestore(win)
  const ratio = Math.min(
    1,
    Math.max(0, (cursorX - maxBounds.x) / Math.max(maxBounds.width, 1)),
  )
  if (win.isFullScreen()) win.setFullScreen(false)
  if (win.isMaximized()) win.unmaximize()
  const work = screen.getDisplayNearestPoint({ x: cursorX, y: cursorY }).workArea
  const x = Math.round(cursorX - normal.width * ratio)
  const y = Math.max(work.y, cursorY - 20)
  win.setBounds({
    x: Math.min(Math.max(x, work.x - normal.width + 80), work.x + work.width - 80),
    y,
    width: normal.width,
    height: normal.height,
  })
  const placed = win.getBounds()
  dragGrab.set(win, { dx: cursorX - placed.x, dy: cursorY - placed.y })
  emitWindowState(win)
  return true
}

function dragWindowTo(win: BrowserWindow, cursorX: number, cursorY: number) {
  const grab = dragGrab.get(win)
  if (!grab || win.isDestroyed()) return
  win.setPosition(
    Math.round(cursorX - grab.dx),
    Math.round(cursorY - grab.dy),
  )
}

function endWindowDrag(win: BrowserWindow) {
  dragGrab.delete(win)
  snapWindowToEdges(win)
  rememberNormalBounds(win)
}

function snapWindowToEdges(win: BrowserWindow) {
  if (win.isDestroyed() || win.isMaximized() || win.isMinimized()) return
  const cursor = screen.getCursorScreenPoint()
  const work = screen.getDisplayNearestPoint(cursor).workArea
  if (cursor.y <= work.y + SNAP_EDGE_PX) {
    win.maximize()
    return
  }
  if (cursor.x <= work.x + SNAP_EDGE_PX) {
    win.setBounds({
      x: work.x,
      y: work.y,
      width: Math.floor(work.width / 2),
      height: work.height,
    })
    return
  }
  if (cursor.x >= work.x + work.width - SNAP_EDGE_PX) {
    const width = Math.floor(work.width / 2)
    win.setBounds({
      x: work.x + work.width - width,
      y: work.y,
      width,
      height: work.height,
    })
  }
}

/** Keep CSS rounding (needs a transparent HWND) and still snap like Windows. */
function attachWindowsSnap(win: BrowserWindow) {
  if (process.platform !== 'win32') return

  rememberNormalBounds(win)
  win.on('moved', () => rememberNormalBounds(win))
  win.on('resized', () => rememberNormalBounds(win))

  win.hookWindowMessage(WM_NCLBUTTONDOWN, (wParam) => {
    if (readWinParam(wParam) !== HT_CAPTION) return
    const cursor = screen.getCursorScreenPoint()
    restoreWindowForDrag(win, cursor.x, cursor.y)
  })

  win.hookWindowMessage(WM_EXITSIZEMOVE, () => {
    endWindowDrag(win)
  })

  win.on('will-move', (event) => {
    if (!isFilledWindow(win) || dragGrab.has(win)) return
    const cursor = screen.getCursorScreenPoint()
    event.preventDefault()
    restoreWindowForDrag(win, cursor.x, cursor.y)
  })
}

function bindWindowChrome(win: BrowserWindow) {
  const emit = () => emitWindowState(win)
  win.on('maximize', emit)
  win.on('unmaximize', emit)
  win.on('enter-full-screen', emit)
  win.on('leave-full-screen', emit)
  attachWindowsSnap(win)
}

function appWindowOptions(
  extra: Electron.BrowserWindowConstructorOptions,
): Electron.BrowserWindowConstructorOptions {
  const windows = process.platform === 'win32'
  return {
    frame: false,
    show: false,
    title: 'Custom SSH',
    icon: resolveAppIcon(),
    thickFrame: true,
    maximizable: true,
    minimizable: true,
    fullscreenable: true,
    transparent: true,
    hasShadow: true,
    backgroundColor: '#00000000',
    // Win11 OS rounding + CSS radius leaves a crescent; CSS alone shapes the HWND.
    roundedCorners: !windows,
    ...extra,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      ...extra.webPreferences,
    },
  }
}

let lastFillToggleAt = 0

function toggleWindowFill(win: BrowserWindow): boolean {
  const now = Date.now()
  if (now - lastFillToggleAt < 250) {
    return win.isMaximized() || win.isFullScreen()
  }
  lastFillToggleAt = now
  if (win.isFullScreen()) {
    win.setFullScreen(false)
    emitWindowState(win)
    return false
  }
  if (win.isMaximized()) {
    win.unmaximize()
    emitWindowState(win)
    return false
  }
  win.maximize()
  emitWindowState(win)
  return true
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
    if (!win.isDestroyed()) {
      expectRestoreFx = true
      win.minimize()
    }
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
  mainWindow = new BrowserWindow(
    appWindowOptions({
      width: 1280,
      height: 800,
      minWidth: 960,
      minHeight: 620,
    }),
  )

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

  bindWindowChrome(mainWindow)
  mainWindow.on('restore', () => {
    if (!mainWindow || !expectRestoreFx) return
    expectRestoreFx = false
    void playRestoreAnimation(mainWindow)
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('close', (event) => {
    if (isQuitting || mainWindow?.isDestroyed()) return
    event.preventDefault()
    mainWindow?.webContents.send('window:close-request')
  })
}

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
    return ssh.ping(sessionId)
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
    return win.isMaximized() || win.isFullScreen()
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
