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
import { SqlBrowseEngine } from '../sql-browse/engine'
import { sqlKindFromName } from '../sql-browse/files'
import {
  disposeSqlBrowseSession,
  getSqlBrowseSession,
  setSqlBrowseSession,
  sqlBrowseKey,
  type SqlBrowseSession,
} from '../sql-browse/sessions'
import {
  appWindowOptions,
  bindWindowChrome,
  playShowAnimation,
} from '../window-chrome'

let editorWindow: BrowserWindow | null = null
let editorReady = false
let editorPendingTabs: Array<{ sessionId: string; remotePath: string }> = []
let viewerWindow: BrowserWindow | null = null
const archiveWindows = new Map<string, BrowserWindow>()
const sqlBrowseWindows = new Map<string, BrowserWindow>()
const MAX_ARCHIVE_BYTES = 80 * 1024 * 1024
const MAX_SQL_BYTES = 80 * 1024 * 1024
const sqlBrowseInflight = new Map<string, Promise<SqlBrowseSession>>()
const sqlBrowseLocalPaths = new Map<string, string>()

function flushEditorPendingTabs(win: BrowserWindow) {
  if (win.isDestroyed()) return
  const pending = editorPendingTabs
  editorPendingTabs = []
  for (const item of pending) {
    win.webContents.send('editor:open-tab', item)
  }
}

function sendEditorOpenTab(
  win: BrowserWindow,
  sessionId: string,
  remotePath: string,
) {
  const payload = { sessionId, remotePath }
  if (editorReady && !win.webContents.isLoadingMainFrame()) {
    win.webContents.send('editor:open-tab', payload)
    return
  }
  editorPendingTabs.push(payload)
}

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

function disposeSqlLocal(key: string) {
  disposeSqlBrowseSession(key)
  const localPath = sqlBrowseLocalPaths.get(key)
  sqlBrowseLocalPaths.delete(key)
  if (!localPath) return
  try {
    fs.unlinkSync(localPath)
  } catch {
    // already gone
  }
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

export async function openSqlBrowseWindow(
  sessionId: string,
  remotePath: string,
) {
  const key = sqlBrowseKey(sessionId, remotePath)
  const existing = sqlBrowseWindows.get(key)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return
  }

  const win = new BrowserWindow(
    appWindowOptions({
      width: 1100,
      height: 720,
      minWidth: 720,
      minHeight: 480,
    }),
  )

  sqlBrowseWindows.set(key, win)
  ;(win as BrowserWindow & { __forceClose?: boolean }).__forceClose = false
  bindWindowChrome(win)
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) void playShowAnimation(win)
  })
  win.on('close', (event) => {
    const sqlWin = win as BrowserWindow & { __forceClose?: boolean }
    if (isQuitting || sqlWin.__forceClose || win.isDestroyed()) return
    event.preventDefault()
    win.webContents.send('sql-browse:close-request')
  })
  win.on('closed', () => {
    sqlBrowseWindows.delete(key)
    const pending = sqlBrowseInflight.get(key)
    if (pending) {
      void pending.finally(() => {
        if (!sqlBrowseWindows.has(key)) disposeSqlLocal(key)
      })
      return
    }
    disposeSqlLocal(key)
  })

  await loadRendererPage(win, 'sql-browse', {
    sessionId,
    path: remotePath,
  })
}

export async function ensureSqlBrowseOpen(
  sessionId: string,
  remotePath: string,
): Promise<SqlBrowseSession> {
  const key = sqlBrowseKey(sessionId, remotePath)
  const hit = getSqlBrowseSession(key)
  if (hit && fs.existsSync(hit.localPath)) return hit
  if (hit) disposeSqlLocal(key)

  const pending = sqlBrowseInflight.get(key)
  if (pending) return pending

  const job = (async () => {
    const kind = sqlKindFromName(remotePath)
    if (!kind) throw new Error('SQL_UNSUPPORTED')
    const size = await ssh.remoteFileSize(sessionId, remotePath)
    if (size > MAX_SQL_BYTES) throw new Error('SQL_TOO_LARGE')

    const dir = path.join(os.tmpdir(), 'customssh-sql-browse')
    fs.mkdirSync(dir, { recursive: true })
    const id = crypto.randomBytes(8).toString('hex')
    const localPath = path.join(
      dir,
      `${id}-${safeTempName(path.basename(remotePath))}`,
    )
    try {
      await ssh.downloadFile(sessionId, remotePath, localPath)
      const engine = await SqlBrowseEngine.open(localPath, kind)
      const session: SqlBrowseSession = {
        key,
        sessionId,
        remotePath,
        localPath,
        kind,
        size,
        name: path.basename(remotePath) || 'database',
        engine,
      }
      sqlBrowseLocalPaths.set(key, localPath)
      setSqlBrowseSession(session)
      return session
    } catch (err) {
      try {
        fs.unlinkSync(localPath)
      } catch {
        // ignore
      }
      throw err
    }
  })().finally(() => {
    sqlBrowseInflight.delete(key)
  })

  sqlBrowseInflight.set(key, job)
  return job
}

export async function saveSqlBrowse(
  sessionId: string,
  remotePath: string,
): Promise<{ ok: true; dirty: false }> {
  const session = await ensureSqlBrowseOpen(sessionId, remotePath)
  const payload = session.engine.exportForSave()
  fs.writeFileSync(session.localPath, payload)
  await ssh.uploadFile(sessionId, session.localPath, remotePath)
  session.engine.dirty = false
  session.size = payload.byteLength
  return { ok: true as const, dirty: false as const }
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
  const existing = editorWindow
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    sendEditorOpenTab(existing, sessionId, remotePath)
    return
  }

  editorReady = false
  editorPendingTabs = []

  const win = new BrowserWindow(
    appWindowOptions({
      width: 1100,
      height: 740,
      minWidth: 720,
      minHeight: 480,
    }),
  )

  editorWindow = win
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
  win.webContents.on('did-finish-load', () => {
    if (editorWindow !== win || win.isDestroyed()) return
    editorReady = true
    flushEditorPendingTabs(win)
  })
  win.on('closed', () => {
    if (editorWindow === win) {
      editorWindow = null
      editorReady = false
      editorPendingTabs = []
    }
  })

  await loadRendererPage(win, 'editor', {
    sessionId,
    path: remotePath,
  })
}

/** Called by the editor renderer after it subscribed to open-tab events. */
export function notifyEditorReady(webContentsId: number) {
  const win = editorWindow
  if (!win || win.isDestroyed() || win.webContents.id !== webContentsId) return
  editorReady = true
  flushEditorPendingTabs(win)
}
