import path from 'node:path'
import {
  BrowserWindow,
  nativeImage,
  screen,
  Tray,
} from 'electron'
import { loadWorkspace } from '../store'
import { loadRendererPage } from '../load-renderer-page'
import { mainWindow } from '../app-context'
import { resolveAppIcon } from '../window-chrome'

export type TraySessionInfo = {
  sessionId: string
  label: string
  title: string
  status: 'connecting' | 'connected' | 'reconnecting'
  connectionId?: string
}

export type TrayConnectionInfo = {
  id: string
  name: string
  host: string
  port: number
  username: string
  folderColor?: string | null
}

export type TrayPopupState = {
  sessions: TraySessionInfo[]
  connections: TrayConnectionInfo[]
}

let tray: Tray | null = null
let trayPopup: BrowserWindow | null = null
let trayPopupShown = false
let ignoreTrayClickUntil = 0
let trayBlurHideTimer: ReturnType<typeof setTimeout> | null = null
let trayPopupState: TrayPopupState = { sessions: [], connections: [] }
let lastTrayAnchor: Electron.Rectangle | null = null

type PanelEdge = 'top' | 'bottom' | 'left' | 'right'

type TrayDeps = {
  createMainWindow: () => void
}

let deps: TrayDeps = { createMainWindow: () => {} }

export function initTrayManager(trayDeps: TrayDeps) {
  deps = trayDeps
}
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

function clearTrayBlurHideTimer() {
  if (!trayBlurHideTimer) return
  clearTimeout(trayBlurHideTimer)
  trayBlurHideTimer = null
}

export function hideTrayPopup() {
  clearTrayBlurHideTimer()
  trayPopupShown = false
  if (!trayPopup || trayPopup.isDestroyed()) return
  trayPopup.hide()
}

export function destroyTrayPopup() {
  clearTrayBlurHideTimer()
  trayPopupShown = false
  if (!trayPopup || trayPopup.isDestroyed()) {
    trayPopup = null
    return
  }
  trayPopup.destroy()
  trayPopup = null
}

export function destroyTray() {
  destroyTrayPopup()
  if (!tray) return
  tray.destroy()
  tray = null
}

export function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    deps.createMainWindow()
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

export function setTrayPopupState(next: TrayPopupState) {
  trayPopupState = next
  const online = next.sessions.some((session) => session.status === 'connected')
  tray?.setToolTip(online ? 'Custom SSH — connected' : 'Custom SSH')
  broadcastTrayState()
}

async function loadTrayPopupPage(win: BrowserWindow) {
  await loadRendererPage(win, 'tray')
}

export function positionTrayPopup(
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

export function ensureTray() {
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

export function hideMainToTray() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  ensureTray()
  destroyTrayPopup()
  mainWindow.hide()
}

export function hasTray(): boolean {
  return tray !== null
}

export function getTrayPopupState(): TrayPopupState {
  return trayPopupState
}
