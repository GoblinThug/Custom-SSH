import { app, BrowserWindow } from 'electron'
import { setIsQuitting } from './app-context'
import { registerIpcHandlers } from './ipc/register-ipc'
import { createMainWindow } from './main-window'
import {
  destroyTray,
  ensureTray,
  hasTray,
  initTrayManager,
  showMainWindow,
} from './tray/tray-manager'
import { initAutoUpdater } from './updater'

app.setName('Custom SSH')

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: 'Custom SSH',
      applicationVersion: app.getVersion(),
      copyright: 'Goblin_Thug',
    })
  }

  initTrayManager({ createMainWindow })
  registerIpcHandlers()
  createMainWindow()
  ensureTray()
  initAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    else showMainWindow()
  })
})

app.on('before-quit', () => {
  setIsQuitting(true)
  destroyTray()
})

app.on('window-all-closed', () => {
  if (hasTray()) return
  if (process.platform !== 'darwin') app.quit()
})
