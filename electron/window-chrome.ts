import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, nativeImage, screen } from 'electron'
import { fadeOpacity } from './window-fx'
export function emitWindowState(win: BrowserWindow) {
  if (win.isDestroyed()) return
  syncFilledResizeLock(win)
  const filled = win.isMaximized() || win.isFullScreen()
  win.webContents.send('window:state', {
    maximized: win.isMaximized(),
    fullscreen: filled,
  })
}

const WM_NCLBUTTONDOWN = 0x00A1
const WM_EXITSIZEMOVE = 0x0232
const HT_CAPTION = 2
const HT_SIZE = 4
const HT_LEFT = 10
const HT_BOTTOMRIGHT = 17
const HT_BORDER = 18
const SNAP_EDGE_PX = 14

const lastNormalBounds = new WeakMap<BrowserWindow, Electron.Rectangle>()
const dragGrab = new WeakMap<BrowserWindow, { dx: number; dy: number }>()
const restoringForDrag = new WeakSet<BrowserWindow>()
const resizeLockBusy = new WeakSet<BrowserWindow>()

function isSizeHitTest(hit: number) {
  return (
    hit === HT_SIZE ||
    hit === HT_BORDER ||
    (hit >= HT_LEFT && hit <= HT_BOTTOMRIGHT)
  )
}

function shouldLockResize(win: BrowserWindow) {
  if (dragGrab.has(win) || restoringForDrag.has(win)) return false
  return isFilledWindow(win) || win.isMaximized() || win.isFullScreen()
}

function syncFilledResizeLock(win: BrowserWindow) {
  if (win.isDestroyed() || resizeLockBusy.has(win)) return
  const allowResize = !shouldLockResize(win)
  if (win.isResizable() === allowResize) return
  resizeLockBusy.add(win)
  try {
    win.setResizable(allowResize)
  } finally {
    resizeLockBusy.delete(win)
  }
}

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

export function restoreWindowForDrag(
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
  restoringForDrag.add(win)
  try {
    if (!win.isResizable()) win.setResizable(true)
    if (win.isFullScreen()) win.setFullScreen(false)
    if (win.isMaximized()) win.unmaximize()
    const work = screen.getDisplayNearestPoint({ x: cursorX, y: cursorY }).workArea
    const x = Math.round(cursorX - normal.width * ratio)
    const y = Math.max(work.y, cursorY - 20)
    win.setBounds({
      x: Math.min(
        Math.max(x, work.x - normal.width + 80),
        work.x + work.width - 80,
      ),
      y,
      width: normal.width,
      height: normal.height,
    })
  } finally {
    restoringForDrag.delete(win)
  }
  const placed = win.getBounds()
  dragGrab.set(win, { dx: cursorX - placed.x, dy: cursorY - placed.y })
  emitWindowState(win)
  return true
}

export function dragWindowTo(win: BrowserWindow, cursorX: number, cursorY: number) {
  const grab = dragGrab.get(win)
  if (!grab || win.isDestroyed()) return
  win.setPosition(
    Math.round(cursorX - grab.dx),
    Math.round(cursorY - grab.dy),
  )
}

export function endWindowDrag(win: BrowserWindow) {
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
    const hit = readWinParam(wParam)
    if (isSizeHitTest(hit) && isFilledWindow(win)) {
      return true
    }
    if (hit !== HT_CAPTION) return
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

export function bindWindowChrome(win: BrowserWindow) {
  const emit = () => emitWindowState(win)
  win.on('maximize', emit)
  win.on('unmaximize', emit)
  win.on('enter-full-screen', emit)
  win.on('leave-full-screen', emit)
  win.on('will-resize', (event) => {
    if (dragGrab.has(win) || restoringForDrag.has(win)) return
    if (isFilledWindow(win) || win.isMaximized() || win.isFullScreen()) {
      event.preventDefault()
    }
  })
  attachWindowsSnap(win)
  syncFilledResizeLock(win)
}

export function appWindowOptions(
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
let animatingWindow = false
let expectRestoreFx = false

export function toggleWindowFill(win: BrowserWindow): boolean {
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

export function playShowAnimation(win: BrowserWindow) {
  win.setOpacity(1)
  win.show()
  // GPU-friendly enter motion lives in the renderer (CSS), not HWND resizing.
  win.webContents.send('window:fx', { type: 'enter' })
}

export async function playMinimizeAnimation(win: BrowserWindow) {
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

export async function playRestoreAnimation(win: BrowserWindow) {
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

export function resolveAppIcon() {
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
export function consumeExpectRestoreFx(): boolean {
  if (!expectRestoreFx) return false
  expectRestoreFx = false
  return true
}

export function windowFromEvent(
  event: Electron.IpcMainInvokeEvent,
): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}
