import fs from 'node:fs'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { TransferCancelledError } from '../transfer-errors'
import {
  isDirectoryMode,
  isTransferPartName,
  joinRemote,
  mimeTypeForImagePath,
  remoteParentPath,
  sortRemoteEntries,
} from './shared'
import type {
  FtpSessionAccess,
  FsSession,
  RemoteFsBackend,
  RemoteStat,
  TransferControl,
} from './types'

export class FtpRemoteFs implements RemoteFsBackend {
  constructor(
    private session: FsSession,
    private access: FtpSessionAccess,
  ) {}

  async ping(started: number): Promise<number> {
    await this.access.getFtp()
    return Math.max(1, Date.now() - started)
  }

  async getCwd(): Promise<string> {
    if (this.session.cwd) return this.session.cwd
    const ftp = await this.access.getFtp()
    this.session.cwd = await ftp.pwd().catch(() => '/')
    return this.session.cwd
  }

  async listDir(remotePath: string): Promise<import('../types').RemoteFsEntry[]> {
    const ftp = await this.access.getFtp()
    const target = remotePath || '/'
    const list = await ftp.list(target)
    const entries = list
      .filter(
        (item) =>
          item.name !== '.' &&
          item.name !== '..' &&
          !isTransferPartName(item.name),
      )
      .map((item) => ({
        name: item.name,
        path: joinRemote(target, item.name),
        isDir: item.isDirectory,
        size: item.isDirectory ? undefined : item.size,
      }))
    return sortRemoteEntries(entries)
  }

  async stat(remotePath: string): Promise<RemoteStat> {
    const ftp = await this.access.getFtp()
    if (!remotePath || remotePath === '/') {
      return { mode: 0o040000, size: 0 }
    }

    const name = remotePath.split('/').filter(Boolean).at(-1) ?? remotePath
    const parent = remoteParentPath(remotePath) || '/'
    const list = await ftp.list(parent)
    const match = list.find((item) => item.name === name)
    if (!match) throw new Error('Failed to stat path')

    if (match.isDirectory) return { mode: 0o040000, size: 0 }
    return { mode: 0o100000, size: match.size ?? 0 }
  }

  async readFile(
    remotePath: string,
    maxBytes: number,
  ): Promise<{ content: string; size: number }> {
    const ftp = await this.access.getFtp()
    const bufParts: Buffer[] = []
    const writable = new Writable({
      write: (chunk, _enc, cb) => {
        bufParts.push(Buffer.from(chunk))
        cb()
      },
    })

    await ftp.downloadTo(writable, remotePath)
    const buf = Buffer.concat(bufParts)
    if (buf.length > maxBytes) {
      throw new Error(
        `File is too large to edit (${Math.ceil(buf.length / 1024 / 1024)} MB)`,
      )
    }
    if (buf.includes(0)) throw new Error('Binary files cannot be edited')
    return { content: buf.toString('utf8'), size: buf.length }
  }

  async readBinaryFile(
    remotePath: string,
    maxBytes: number,
  ): Promise<{ base64: string; size: number; mimeType: string }> {
    const ftp = await this.access.getFtp()
    const mimeType = mimeTypeForImagePath(remotePath)
    const bufParts: Buffer[] = []
    const writable = new Writable({
      write: (chunk, _enc, cb) => {
        bufParts.push(Buffer.from(chunk))
        cb()
      },
    })
    await ftp.downloadTo(writable, remotePath)
    const buf = Buffer.concat(bufParts)
    if (buf.length > maxBytes) {
      throw new Error(
        `File is too large to preview (${Math.ceil(buf.length / 1024 / 1024)} MB)`,
      )
    }
    return { base64: buf.toString('base64'), size: buf.length, mimeType }
  }

  async writeFile(remotePath: string, content: string): Promise<void> {
    const ftp = await this.access.getFtp()
    const parent = remoteParentPath(remotePath)
    if (parent && parent !== '/') {
      await ftp.ensureDir(parent)
    }
    const stream = Readable.from([content])
    await ftp.uploadFrom(stream, remotePath)
  }

  async downloadFile(
    remotePath: string,
    localPath: string,
    onBytes?: (transferred: number, total: number) => void,
    control?: TransferControl,
  ): Promise<void> {
    await new Promise<void>(async (resolve, reject) => {
      let cancelled = false
      let ftp: Awaited<ReturnType<FtpSessionAccess['getFtp']>> | null = null

      const cleanup = () => {
        try {
          ftp?.trackProgress()
        } catch {
          // ignore
        }
      }

      try {
        ftp = await this.access.getFtp()
        const total = await ftp.size(remotePath).catch(() => 0)

        let transferred = 0
        ftp.trackProgress((info) => {
          if (control?.isCancelled()) {
            cancelled = true
            try {
              ftp?.close()
            } catch {
              // ignore
            }
            this.session.ftp = null
            return
          }
          transferred = info.bytes
          onBytes?.(transferred, total || 0)
        })

        control?.registerAbort(() => {
          cancelled = true
          try {
            ftp?.close()
          } catch {
            // ignore
          }
          this.session.ftp = null
        })

        if (control?.isCancelled()) {
          throw new TransferCancelledError(control.key)
        }

        const parent = path.dirname(localPath)
        if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true })
        await ftp.downloadTo(localPath, remotePath)
        control?.clearAbort()
        cleanup()

        if (cancelled) {
          reject(new TransferCancelledError(control?.key ?? 'download'))
          return
        }
        onBytes?.(total || transferred, total || transferred)
        resolve()
      } catch (err) {
        try {
          control?.clearAbort()
        } catch {
          // ignore
        }
        cleanup()
        if (control?.isCancelled() || cancelled) {
          reject(new TransferCancelledError(control?.key ?? 'download'))
          return
        }
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  async uploadFile(
    localPath: string,
    remotePath: string,
    onBytes?: (transferred: number, total: number) => void,
    control?: TransferControl,
  ): Promise<void> {
    await new Promise<void>(async (resolve, reject) => {
      let cancelled = false
      let ftp: Awaited<ReturnType<FtpSessionAccess['getFtp']>> | null = null

      const cleanup = () => {
        try {
          ftp?.trackProgress()
        } catch {
          // ignore
        }
      }

      try {
        if (control?.isCancelled()) {
          throw new TransferCancelledError(control.key)
        }

        ftp = await this.access.getFtp()
        const total = fs.statSync(localPath).size
        const parent = remoteParentPath(remotePath)

        if (parent && parent !== '/') {
          await ftp.ensureDir(parent)
        }

        let transferred = 0
        ftp.trackProgress((info) => {
          if (control?.isCancelled()) {
            cancelled = true
            try {
              ftp?.close()
            } catch {
              // ignore
            }
            this.session.ftp = null
            return
          }
          if (info.type !== 'upload') return
          transferred = info.bytes
          onBytes?.(transferred, total || transferred)
        })

        control?.registerAbort(() => {
          cancelled = true
          try {
            ftp?.close()
          } catch {
            // ignore
          }
          this.session.ftp = null
        })

        await ftp.uploadFrom(localPath, remotePath)
        control?.clearAbort()
        cleanup()

        if (cancelled || control?.isCancelled()) {
          reject(new TransferCancelledError(control?.key ?? 'upload'))
          return
        }

        onBytes?.(total, total)
        resolve()
      } catch (err) {
        cleanup()
        if (cancelled || control?.isCancelled()) {
          reject(new TransferCancelledError(control?.key ?? 'upload'))
          return
        }
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  async mkdir(remotePath: string): Promise<void> {
    const ftp = await this.access.getFtp()
    await ftp.ensureDir(remotePath)
  }

  async ensureDir(remotePath: string): Promise<void> {
    await this.mkdir(remotePath)
  }

  async rename(fromPath: string, toPath: string): Promise<void> {
    const ftp = await this.access.getFtp()
    await ftp.rename(fromPath, toPath)
  }

  async remove(remotePath: string): Promise<number> {
    const ftp = await this.access.getFtp()
    const stats = await this.stat(remotePath)
    if (isDirectoryMode(stats.mode)) {
      await ftp.removeDir(remotePath)
      return 1
    }
    await ftp.remove(remotePath)
    return 1
  }
}
