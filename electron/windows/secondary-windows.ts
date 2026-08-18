import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import {
  archiveKindFromName,
  listArchiveFile,
  type ArchiveKind,
  type ArchiveListEntry,
} from '../archive'
import { isQuitting, ssh } from '../app-context'
import { loadRendererPage } from '../load-renderer-page'
import {
  appWindowOptions,
  bindWindowChrome,
  playShowAnimation,
} from '../window-chrome'

const editorWindows = new Map<string, BrowserWindow>()
let viewerWindow: BrowserWindow | null = null
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
function archiveKey(sessionId: string, remotePath: string) {
  return `${sessionId}::${remotePath}`
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

export async function openArchiveWindow(sessionId: string, remotePath: string) {
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

  await loadRendererPage(win, 'archive', {
    sessionId,
    path: remotePath,
  })
}

export async function ensureArchiveCached(
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

export async function openViewerWindow(sessionId: string, remotePath: string) {
  const existing = viewerWindow
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    existing.webContents.send('viewer:navigate', { sessionId, remotePath })
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

  viewerWindow = win
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
    if (viewerWindow === win) viewerWindow = null
  })

  await loadRendererPage(win, 'viewer', {
    sessionId,
    path: remotePath,
  })
}

export async function openEditorWindow(sessionId: string, remotePath: string) {
  const existing = editorWindows.get(sessionId)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    existing.webContents.send('editor:open-tab', { remotePath })
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

  editorWindows.set(sessionId, win)
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
    editorWindows.delete(sessionId)
  })

  await loadRendererPage(win, 'editor', {
    sessionId,
    path: remotePath,
  })
}
