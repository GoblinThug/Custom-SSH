import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater'
import { loadSettings } from './settings-store'

const RELEASES_URL = 'https://github.com/GoblinThug/Custom-SSH/releases/latest'

export type UpdateErrorCode =
  | 'macUnsigned'
  | 'network'
  | 'notFound'
  | 'checksum'
  | 'permission'
  | 'generic'

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'unsupported'; reason: 'dev' | 'portable' | 'macUnsigned' }
  | { state: 'checking' }
  | {
      state: 'available'
      version: string
      releaseNotes?: string
      /** macOS unsigned builds cannot use ShipIt — open Releases instead. */
      manual?: boolean
    }
  | { state: 'not-available'; version: string }
  | { state: 'downloading'; percent: number; transferred: number; total: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; code: UpdateErrorCode }

function isMacUnsignedUpdates(): boolean {
  // CI builds are not Developer ID signed; Squirrel.Mac rejects them.
  return process.platform === 'darwin'
}

function emit(status: UpdateStatus) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('update:status', status)
  }
}

function isPortableBuild(): boolean {
  // Portable target sets PORTABLE_EXECUTABLE_DIR / PORTABLE_EXECUTABLE_FILE.
  return Boolean(
    process.env.PORTABLE_EXECUTABLE_DIR || process.env.PORTABLE_EXECUTABLE_FILE,
  )
}

function classifyUpdateError(error: unknown): UpdateErrorCode {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const lower = message.toLowerCase()

  if (
    /code signature|подпис|shipit|ресурсы кода|code resources|mac_unsigned/i.test(
      message,
    )
  ) {
    return 'macUnsigned'
  }
  if (
    /enoent|404|cannot find|latest\.yml|latest-mac\.yml|no published versions|is not available/i.test(
      lower,
    )
  ) {
    return 'notFound'
  }
  if (/sha512|checksum|hash|blockmap|corrupt|damaged/i.test(lower)) {
    return 'checksum'
  }
  if (/eacces|eperm|ebusy|accessing a file|operation not permitted/i.test(lower)) {
    return 'permission'
  }
  if (
    /enotfound|econnrefused|econnreset|etimedout|enetunreach|offline|network|getaddrinfo|socket|tls|certificate|http.?error|status code|net::/i.test(
      lower,
    )
  ) {
    return 'network'
  }
  return 'generic'
}

function emitUpdateError(error: unknown, opts?: { quiet?: boolean }) {
  const code = classifyUpdateError(error)
  const raw = error instanceof Error ? error.message : String(error ?? '')
  console.error('[updater]', code, raw)

  // Background launch check: don't leave a sticky error for flaky network.
  if (opts?.quiet && (code === 'network' || code === 'notFound')) {
    emit({ state: 'idle' })
    return code
  }

  emit({ state: 'error', code })
  return code
}

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '')
}

function isSkippedUpdate(version: string): boolean {
  const skipped = loadSettings().skippedUpdateVersion
  if (!skipped) return false
  return normalizeVersion(skipped) === normalizeVersion(version)
}

export function initAutoUpdater() {
  /** 'user' = Settings "Check for updates"; 'auto' = quiet launch probe. */
  let checkSource: 'user' | 'auto' = 'auto'

  ipcMain.handle('update:getVersion', () => app.getVersion())

  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) {
      const status: UpdateStatus = { state: 'unsupported', reason: 'dev' }
      emit(status)
      return status
    }
    if (isPortableBuild()) {
      const status: UpdateStatus = { state: 'unsupported', reason: 'portable' }
      emit(status)
      return status
    }

    checkSource = 'user'
    emit({ state: 'checking' })
    try {
      // Status transitions are pushed via autoUpdater events.
      await autoUpdater.checkForUpdates()
      return null
    } catch (error) {
      const code = emitUpdateError(error, { quiet: false })
      return { state: 'error', code } satisfies UpdateStatus
    }
  })

  ipcMain.handle('update:download', async () => {
    // Unsigned Mac builds cannot install via ShipIt (code signature check).
    if (isMacUnsignedUpdates()) {
      await shell.openExternal(RELEASES_URL)
      return false
    }
    try {
      await autoUpdater.downloadUpdate()
      return true
    } catch (error) {
      emitUpdateError(error)
      return false
    }
  })

  ipcMain.handle('update:install', () => {
    if (isMacUnsignedUpdates()) {
      void shell.openExternal(RELEASES_URL)
      return
    }
    autoUpdater.quitAndInstall(false, true)
  })

  ipcMain.handle('update:openReleases', () => shell.openExternal(RELEASES_URL))

  if (!app.isPackaged || isPortableBuild()) {
    return
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = !isMacUnsignedUpdates()
  // Publish metadata comes from package.json build.publish → app-update.yml.
  autoUpdater.forceDevUpdateConfig = false
  autoUpdater.allowDowngrade = false
  // Unsigned Windows builds: disable signature verification when supported.
  const winUpdater = autoUpdater as typeof autoUpdater & {
    verifyUpdateCodeSignature?: boolean
  }
  if (typeof winUpdater.verifyUpdateCodeSignature === 'boolean') {
    winUpdater.verifyUpdateCodeSignature = false
  }

  autoUpdater.on('checking-for-update', () => {
    emit({ state: 'checking' })
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    // Quiet launch probe: respect "update later" for this version.
    if (checkSource === 'auto' && isSkippedUpdate(info.version)) {
      emit({ state: 'idle' })
      return
    }
    emit({
      state: 'available',
      version: info.version,
      releaseNotes:
        typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
      manual: isMacUnsignedUpdates(),
    })
  })

  autoUpdater.on('update-not-available', () => {
    emit({ state: 'not-available', version: app.getVersion() })
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    emit({
      state: 'downloading',
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total,
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    if (checkSource === 'auto' && isSkippedUpdate(info.version)) {
      emit({ state: 'idle' })
      return
    }
    emit({ state: 'ready', version: info.version })
  })

  autoUpdater.on('error', (error: Error) => {
    emitUpdateError(error, { quiet: checkSource === 'auto' })
    checkSource = 'auto'
  })

  // Quiet check shortly after launch.
  setTimeout(() => {
    checkSource = 'auto'
    void autoUpdater.checkForUpdates().catch((error) => {
      emitUpdateError(error, { quiet: true })
      checkSource = 'auto'
    })
  }, 4000)
}
