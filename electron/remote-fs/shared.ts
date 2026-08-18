import type { RemoteFsEntry } from '../types'

/** Remote path join (POSIX-style). */
export function joinRemote(...parts: string[]): string {
  const cleaned = parts
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
  return cleaned.length === 0 ? '/' : cleaned
}

/** Incomplete transfer marker — never written as the final path. */
export const TRANSFER_PART_SUFFIX = '.customssh.part'

export function isTransferPartName(name: string): boolean {
  return name.endsWith(TRANSFER_PART_SUFFIX)
}

export function localPartPath(localPath: string): string {
  return `${localPath}${TRANSFER_PART_SUFFIX}`
}

export function remotePartPath(remotePath: string): string {
  return `${remotePath}${TRANSFER_PART_SUFFIX}`
}

export function mimeTypeForImagePath(remotePath: string): string {
  const lower = remotePath.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'application/octet-stream'
}

export function sortRemoteEntries(entries: RemoteFsEntry[]): RemoteFsEntry[] {
  return entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export function remoteParentPath(remotePath: string): string {
  if (!remotePath.includes('/')) return '/'
  return remotePath.slice(0, remotePath.lastIndexOf('/')) || '/'
}

export function isDirectoryMode(mode: number): boolean {
  return (mode & 0o170000) === 0o040000
}

/** Throttle progress IPC to avoid main↔renderer overhead. */
export const PROGRESS_EMIT_MS = 150

/** Larger read/write chunks for high-latency links. */
export const STREAM_HIGH_WATER_MARK = 256 * 1024

export function isTransientTransferError(err: unknown): boolean {
  if (!err) return false
  const code =
    typeof err === 'object' && err && 'code' in err
      ? String((err as { code?: string | number }).code)
      : ''
  const message = err instanceof Error ? err.message : String(err)
  if (
    [
      'ECONNRESET',
      'EPIPE',
      'ENOTCONN',
      'ECONNABORTED',
      'ERR_STREAM_DESTROYED',
      'ERR_SOCKET_CLOSED',
    ].includes(code)
  ) {
    return true
  }
  if (code === '4' || code === '7') return true
  return /session not found|not connected|connection (lost|closed|reset)|socket|ECONNRESET|EPIPE|ENOTCONN|EOF|Failed to open SFTP|No response|closed|incomplete (download|upload)|will resume/i.test(
    message,
  )
}
