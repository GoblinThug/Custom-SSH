import fs from 'node:fs'
import path from 'node:path'
import type { SFTPWrapper } from 'ssh2'
import { TransferCancelledError } from '../transfer-errors'
import type { RemoteFsEntry } from '../types'
import {
  isDirectoryMode,
  isTransferPartName,
  joinRemote,
  localPartPath,
  mimeTypeForImagePath,
  remoteParentPath,
  remotePartPath,
  sortRemoteEntries,
  STREAM_HIGH_WATER_MARK,
} from './shared'
import type {
  FsSession,
  RemoteFsBackend,
  RemoteStat,
  SftpSessionAccess,
  TransferControl,
} from './types'

function statPath(
  sftp: SFTPWrapper,
  remotePath: string,
): Promise<RemoteStat> {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (err, stats) => {
      if (err || !stats) {
        reject(err ?? new Error('Failed to stat path'))
        return
      }
      resolve({ mode: stats.mode, size: stats.size })
    })
  })
}

async function mkdirp(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  const normalized =
    remotePath === '/'
      ? '/'
      : remotePath.replace(/\/+$/, '') || '/'
  if (normalized === '/') return

  const parts = normalized.split('/').filter(Boolean)
  let current = ''
  for (const part of parts) {
    current += `/${part}`
    try {
      const stats = await statPath(sftp, current)
      if (!isDirectoryMode(stats.mode)) {
        throw new Error(`Not a directory: ${current}`)
      }
    } catch {
      await new Promise<void>((resolve, reject) => {
        sftp.mkdir(current, (err) => {
          if (!err) {
            resolve()
            return
          }
          sftp.stat(current, (statErr, stats) => {
            if (
              !statErr &&
              stats &&
              isDirectoryMode(stats.mode)
            ) {
              resolve()
              return
            }
            reject(err)
          })
        })
      })
    }
  }
}

function sftpUnlink(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(remotePath, (err) => {
      if (!err) {
        resolve()
        return
      }
      const code =
        err && typeof err === 'object' && 'code' in err
          ? Number((err as { code?: number }).code)
          : NaN
      if (code === 2 || /no such file/i.test(err.message)) {
        resolve()
        return
      }
      reject(err)
    })
  })
}

function sftpWriteEmpty(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.writeFile(remotePath, Buffer.alloc(0), (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

function finalizeLocalPart(partPath: string, localPath: string) {
  if (!fs.existsSync(partPath)) {
    throw new Error('Missing partial download file')
  }
  if (fs.existsSync(localPath)) {
    fs.unlinkSync(localPath)
  }
  fs.renameSync(partPath, localPath)
}

async function finalizeRemotePart(
  sftp: SFTPWrapper,
  partRemote: string,
  remotePath: string,
): Promise<void> {
  await sftpUnlink(sftp, remotePath)
  await new Promise<void>((resolve, reject) => {
    sftp.rename(partRemote, remotePath, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

export class SftpRemoteFs implements RemoteFsBackend {
  constructor(
    private session: FsSession,
    private access: SftpSessionAccess,
  ) {}

  ping(started: number): Promise<number> {
    return this.access.withSftp((sftp) =>
      new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Ping timeout'))
        }, 8000)
        sftp.realpath('.', (err) => {
          clearTimeout(timeout)
          if (err) reject(err)
          else resolve(Math.max(1, Date.now() - started))
        })
      }),
    )
  }

  getCwd(): Promise<string> {
    return this.access.withSftp((sftp) =>
      new Promise((resolve, reject) => {
        sftp.realpath('.', (err, absPath) => {
          if (err) reject(err)
          else resolve(absPath || '/')
        })
      }),
    )
  }

  listDir(remotePath: string): Promise<RemoteFsEntry[]> {
    const target = remotePath || '/'
    return this.access.withSftp((sftp) =>
      new Promise((resolve, reject) => {
        sftp.readdir(target, (err, list) => {
          if (err) {
            reject(err)
            return
          }
          const entries = list
            .filter(
              (item) =>
                item.filename !== '.' &&
                item.filename !== '..' &&
                !isTransferPartName(item.filename),
            )
            .map((item) => {
              const isDir = isDirectoryMode(item.attrs.mode)
              return {
                name: item.filename,
                path: joinRemote(target, item.filename),
                isDir,
                size: isDir ? undefined : item.attrs.size,
              } satisfies RemoteFsEntry
            })
          resolve(sortRemoteEntries(entries))
        })
      }),
    )
  }

  stat(remotePath: string): Promise<RemoteStat> {
    return this.access.withSftp((sftp) => statPath(sftp, remotePath))
  }

  readFile(
    remotePath: string,
    maxBytes: number,
  ): Promise<{ content: string; size: number }> {
    return this.access.withSftp(async (sftp) => {
      const stats = await statPath(sftp, remotePath)
      if (isDirectoryMode(stats.mode)) {
        throw new Error('Path is a directory')
      }
      if (stats.size > maxBytes) {
        throw new Error(
          `File is too large to edit (${Math.ceil(stats.size / 1024 / 1024)} MB)`,
        )
      }
      return new Promise((resolve, reject) => {
        sftp.readFile(remotePath, (err, data) => {
          if (err) {
            reject(err)
            return
          }
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
          if (buf.includes(0)) {
            reject(new Error('Binary files cannot be edited'))
            return
          }
          resolve({ content: buf.toString('utf8'), size: buf.length })
        })
      })
    })
  }

  readBinaryFile(
    remotePath: string,
    maxBytes: number,
  ): Promise<{ base64: string; size: number; mimeType: string }> {
    const mimeType = mimeTypeForImagePath(remotePath)
    return this.access.withSftp(async (sftp) => {
      const stats = await statPath(sftp, remotePath)
      if (isDirectoryMode(stats.mode)) {
        throw new Error('Path is a directory')
      }
      if (stats.size > maxBytes) {
        throw new Error(
          `File is too large to preview (${Math.ceil(stats.size / 1024 / 1024)} MB)`,
        )
      }
      return new Promise((resolve, reject) => {
        sftp.readFile(remotePath, (err, data) => {
          if (err) {
            reject(err)
            return
          }
          const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
          resolve({
            base64: buf.toString('base64'),
            size: buf.length,
            mimeType,
          })
        })
      })
    })
  }

  writeFile(remotePath: string, content: string): Promise<void> {
    return this.access.withSftp(
      (sftp) =>
        new Promise((resolve, reject) => {
          sftp.writeFile(remotePath, Buffer.from(content, 'utf8'), (err) => {
            if (err) reject(err)
            else resolve()
          })
        }),
    )
  }

  async downloadFile(
    remotePath: string,
    localPath: string,
    onBytes?: (transferred: number, total: number) => void,
    control?: TransferControl,
  ): Promise<void> {
    const throwIfCancelled = () => {
      if (control?.isCancelled()) {
        throw new TransferCancelledError(control.key)
      }
    }

    await this.access.withTransferRetry(async () => {
      throwIfCancelled()
      const sftp = await this.access.getSftp()
      const remoteStats = await statPath(sftp, remotePath)
      const total = remoteStats.size
      const partPath = localPartPath(localPath)
      const parent = path.dirname(localPath)
      if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true })

      let offset = 0
      if (fs.existsSync(partPath)) {
        offset = fs.statSync(partPath).size
        if (total > 0 && offset > total) {
          fs.unlinkSync(partPath)
          offset = 0
        }
      }

      throwIfCancelled()

      if (total === 0) {
        fs.writeFileSync(partPath, Buffer.alloc(0))
        finalizeLocalPart(partPath, localPath)
        onBytes?.(1, 1)
        return
      }

      if (offset === total) {
        finalizeLocalPart(partPath, localPath)
        onBytes?.(total, total)
        return
      }

      await new Promise<void>((resolve, reject) => {
        let settled = false
        let transferred = offset
        const readStream = sftp.createReadStream(remotePath, {
          start: offset,
          end: total > 0 ? total - 1 : 0,
          highWaterMark: STREAM_HIGH_WATER_MARK,
        })
        const writeStream = fs.createWriteStream(partPath, {
          flags: offset > 0 ? 'a' : 'w',
          highWaterMark: STREAM_HIGH_WATER_MARK,
        })

        const fail = (err: unknown) => {
          if (settled) return
          settled = true
          control?.clearAbort()
          readStream.destroy()
          writeStream.destroy()
          reject(err instanceof Error ? err : new Error(String(err)))
        }

        control?.registerAbort(() => {
          fail(new TransferCancelledError(control.key))
        })

        readStream.on('data', (chunk: Buffer | string) => {
          if (control?.isCancelled()) {
            fail(new TransferCancelledError(control.key))
            return
          }
          const size = Buffer.isBuffer(chunk)
            ? chunk.length
            : Buffer.byteLength(chunk)
          transferred += size
          onBytes?.(transferred, total)
        })
        readStream.on('error', (err: Error) => fail(err))
        writeStream.on('error', (err: Error) => fail(err))
        writeStream.on('close', () => {
          if (settled) return
          settled = true
          control?.clearAbort()
          try {
            if (control?.isCancelled()) {
              reject(new TransferCancelledError(control.key))
              return
            }
            const size = fs.existsSync(partPath) ? fs.statSync(partPath).size : 0
            if (size !== total) {
              reject(
                new Error(
                  `Incomplete download (${size}/${total} bytes) — will resume`,
                ),
              )
              return
            }
            finalizeLocalPart(partPath, localPath)
            onBytes?.(total, total)
            resolve()
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)))
          }
        })
        readStream.pipe(writeStream)
      })
    })
  }

  async uploadFile(
    localPath: string,
    remotePath: string,
    onBytes?: (transferred: number, total: number) => void,
    control?: TransferControl,
  ): Promise<void> {
    const throwIfCancelled = () => {
      if (control?.isCancelled()) {
        throw new TransferCancelledError(control.key)
      }
    }

    await this.access.withTransferRetry(async () => {
      throwIfCancelled()
      const sftp = await this.access.getSftp()
      const total = fs.statSync(localPath).size
      const partRemote = remotePartPath(remotePath)
      const parent = remoteParentPath(remotePath)
      if (parent && parent !== '/') {
        await mkdirp(sftp, parent)
      }

      let offset = 0
      try {
        const partStats = await statPath(sftp, partRemote)
        offset = partStats.size
        if (total > 0 && offset > total) {
          await sftpUnlink(sftp, partRemote)
          offset = 0
        }
      } catch {
        offset = 0
      }

      throwIfCancelled()

      if (total === 0) {
        await sftpWriteEmpty(sftp, partRemote)
        await finalizeRemotePart(sftp, partRemote, remotePath)
        onBytes?.(1, 1)
        return
      }

      if (offset === total) {
        await finalizeRemotePart(sftp, partRemote, remotePath)
        onBytes?.(total, total)
        return
      }

      await new Promise<void>((resolve, reject) => {
        let settled = false
        let transferred = offset
        const readStream = fs.createReadStream(localPath, {
          start: offset,
          highWaterMark: STREAM_HIGH_WATER_MARK,
        })
        const writeStream = sftp.createWriteStream(
          partRemote,
          offset > 0
            ? {
                flags: 'r+',
                start: offset,
                autoClose: true,
                highWaterMark: STREAM_HIGH_WATER_MARK,
              }
            : {
                flags: 'w',
                autoClose: true,
                highWaterMark: STREAM_HIGH_WATER_MARK,
              },
        )

        const fail = (err: unknown) => {
          if (settled) return
          settled = true
          control?.clearAbort()
          readStream.destroy()
          writeStream.destroy()
          reject(err instanceof Error ? err : new Error(String(err)))
        }

        control?.registerAbort(() => {
          fail(new TransferCancelledError(control.key))
        })

        readStream.on('data', (chunk: Buffer | string) => {
          if (control?.isCancelled()) {
            fail(new TransferCancelledError(control.key))
            return
          }
          const size = Buffer.isBuffer(chunk)
            ? chunk.length
            : Buffer.byteLength(chunk)
          transferred += size
          onBytes?.(transferred, total)
        })
        readStream.on('error', (err: Error) => fail(err))
        writeStream.on('error', (err: Error) => fail(err))
        writeStream.on('close', () => {
          if (settled) return
          settled = true
          control?.clearAbort()
          void (async () => {
            try {
              if (control?.isCancelled()) {
                reject(new TransferCancelledError(control.key))
                return
              }
              const partStats = await statPath(sftp, partRemote)
              if (partStats.size !== total) {
                reject(
                  new Error(
                    `Incomplete upload (${partStats.size}/${total} bytes) — will resume`,
                  ),
                )
                return
              }
              await finalizeRemotePart(sftp, partRemote, remotePath)
              onBytes?.(total, total)
              resolve()
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)))
            }
          })()
        })
        readStream.pipe(writeStream)
      })
    })
  }

  async mkdir(remotePath: string): Promise<void> {
    const sftp = await this.access.getSftp()
    await mkdirp(sftp, remotePath)
  }

  async ensureDir(remotePath: string): Promise<void> {
    await this.mkdir(remotePath)
  }

  rename(fromPath: string, toPath: string): Promise<void> {
    return this.access.withSftp(
      (sftp) =>
        new Promise((resolve, reject) => {
          sftp.rename(fromPath, toPath, (err) => {
            if (err) reject(err)
            else resolve()
          })
        }),
    )
  }

  async remove(remotePath: string): Promise<number> {
    const sftp = await this.access.getSftp()
    return this.removeRecursive(sftp, remotePath)
  }

  private async removeRecursive(
    sftp: SFTPWrapper,
    remotePath: string,
  ): Promise<number> {
    const stats = await statPath(sftp, remotePath)
    if (!isDirectoryMode(stats.mode)) {
      await new Promise<void>((resolve, reject) => {
        sftp.unlink(remotePath, (err) => {
          if (err) reject(err)
          else resolve()
        })
      })
      return 1
    }

    const entries = await this.listDir(remotePath)
    let removed = 0
    for (const entry of entries) {
      removed += await this.removeRecursive(sftp, entry.path)
    }
    await new Promise<void>((resolve, reject) => {
      sftp.rmdir(remotePath, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
    return removed
  }
}
