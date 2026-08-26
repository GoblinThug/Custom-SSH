import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  type MenuItemConstructorOptions,
} from 'electron'
import { loadWorkspace } from '../store'
import { loadSettings } from '../settings-store'
import { mainWindow, setIsQuitting } from '../app-context'
import { resolveAppIcon } from '../window-chrome'
import { checkForUpdatesUser } from '../updater'

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

export type TrayState = {
  sessions: TraySessionInfo[]
  connections: TrayConnectionInfo[]
}

/** @deprecated use TrayState */
export type TrayPopupState = TrayState

let tray: Tray | null = null
let trayState: TrayState = { sessions: [], connections: [] }

type TrayDeps = {
  createMainWindow: () => void
}

let deps: TrayDeps = { createMainWindow: () => {} }

const labels = {
  en: {
    openApp: 'Open Custom SSH',
    settings: 'Settings…',
    checkUpdates: 'Check for updates',
    activeSessions: 'Active sessions',
    disconnect: 'Disconnect',
    noSessions: 'No active sessions',
    quickConnect: 'Quick connect',
    noConnections: 'No saved connections',
    quit: 'Quit',
    connected: 'Custom SSH — connected',
    idle: 'Custom SSH',
  },
  ru: {
    openApp: 'Открыть Custom SSH',
    settings: 'Настройки…',
    checkUpdates: 'Проверить обновления',
    activeSessions: 'Активные сессии',
    disconnect: 'Отключить',
    noSessions: 'Нет активных сессий',
    quickConnect: 'Быстрое подключение',
    noConnections: 'Нет сохранённых подключений',
    quit: 'Выход',
    connected: 'Custom SSH — подключено',
    idle: 'Custom SSH',
  },
} as const

function t() {
  const locale = loadSettings().locale === 'en' ? 'en' : 'ru'
  return labels[locale]
}

export function initTrayManager(trayDeps: TrayDeps) {
  deps = trayDeps
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

function sendToMain(channel: string, ...args: unknown[]) {
  showMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

function quitApp() {
  setIsQuitting(true)
  destroyTray()
  for (const win of BrowserWindow.getAllWindows()) {
    const flagged = win as BrowserWindow & { __forceClose?: boolean }
    flagged.__forceClose = true
  }
  app.quit()
}

function buildContextMenu() {
  const text = t()
  const activeSessions = trayState.sessions.filter(
    (session) =>
      session.status === 'connected' ||
      session.status === 'connecting' ||
      session.status === 'reconnecting',
  )
  const connections =
    trayState.connections.length > 0
      ? trayState.connections
      : loadWorkspace().connections.map((item) => ({
          id: item.id,
          name: item.name,
          host: item.host,
          port: item.port,
          username: item.username,
          folderColor: null as string | null,
        }))

  const sessionItems: MenuItemConstructorOptions[] =
    activeSessions.length > 0
      ? activeSessions.map((session) => ({
          label: session.title?.trim() || session.label,
          submenu: [
            {
              label: text.disconnect,
              click: () => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send(
                    'tray:disconnect',
                    session.sessionId,
                  )
                }
              },
            },
          ],
        }))
      : [{ label: text.noSessions, enabled: false }]

  const connectItems: MenuItemConstructorOptions[] =
    connections.length > 0
      ? connections.slice(0, 20).map((item) => ({
          label: item.name || `${item.username}@${item.host}`,
          click: () => sendToMain('tray:quick-connect', item.id),
        }))
      : [{ label: text.noConnections, enabled: false }]

  return Menu.buildFromTemplate([
    {
      label: text.openApp,
      click: () => showMainWindow(),
    },
    {
      label: text.settings,
      click: () => sendToMain('tray:open-settings'),
    },
    { type: 'separator' },
    {
      label: text.checkUpdates,
      click: () => {
        showMainWindow()
        void checkForUpdatesUser()
        sendToMain('tray:open-settings')
      },
    },
    { type: 'separator' },
    {
      label: text.activeSessions,
      submenu: sessionItems,
    },
    {
      label: text.quickConnect,
      submenu: connectItems,
    },
    { type: 'separator' },
    {
      label: text.quit,
      click: () => quitApp(),
    },
  ])
}

function refreshTrayMenu() {
  if (!tray) return
  const online = trayState.sessions.some(
    (session) => session.status === 'connected',
  )
  const text = t()
  tray.setToolTip(online ? text.connected : text.idle)
  tray.setContextMenu(buildContextMenu())
}

export function setTrayState(next: TrayState) {
  trayState = {
    sessions: Array.isArray(next?.sessions) ? next.sessions : [],
    connections: Array.isArray(next?.connections) ? next.connections : [],
  }
  refreshTrayMenu()
}

export function setTrayPopupState(next: TrayState) {
  setTrayState(next)
}

/** Rebuild labels after locale/settings change. */
export function refreshTrayChrome() {
  refreshTrayMenu()
}

function resolveTrayIcon() {
  const source = resolveAppIcon()
  if (!source || source.isEmpty()) return nativeImage.createEmpty()
  if (process.platform !== 'darwin') return source
  return source.resize({ width: 22, height: 22, quality: 'best' })
}

export function ensureTray() {
  if (tray) return
  tray = new Tray(resolveTrayIcon())
  tray.setIgnoreDoubleClickEvents(true)
  refreshTrayMenu()

  // Left click opens the app on Windows. macOS/Linux use the context menu on click.
  if (process.platform === 'win32') {
    tray.on('click', () => {
      showMainWindow()
    })
  }
  tray.on('double-click', () => {
    showMainWindow()
  })
}

export function hideMainToTray() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  ensureTray()
  mainWindow.hide()
}

export function hasTray(): boolean {
  return tray !== null
}

export function destroyTray() {
  if (!tray) return
  tray.destroy()
  tray = null
}
