import path from 'node:path'
import { BrowserWindow } from 'electron'
import { isQuitting, setMainWindow } from './app-context'
import {
  appWindowOptions,
  bindWindowChrome,
  consumeExpectRestoreFx,
  playRestoreAnimation,
  playShowAnimation,
} from './window-chrome'

export function createMainWindow() {
  const win = new BrowserWindow(
    appWindowOptions({
      width: 1280,
      height: 800,
      minWidth: 960,
      minHeight: 620,
    }),
  )

  setMainWindow(win)

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) void playShowAnimation(win)
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    const url = process.env.VITE_DEV_SERVER_URL
    const loadWithRetry = async (attempt = 0) => {
      try {
        await win.loadURL(url)
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
    void win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  bindWindowChrome(win)
  win.on('restore', () => {
    if (win.isDestroyed() || !consumeExpectRestoreFx()) return
    void playRestoreAnimation(win)
  })
  win.on('closed', () => {
    setMainWindow(null)
  })

  win.on('close', (event) => {
    if (isQuitting || win.isDestroyed()) return
    event.preventDefault()
    win.webContents.send('window:close-request')
  })

  return win
}
