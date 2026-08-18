import type { Client, SFTPWrapper } from 'ssh2'
import type { Client as FtpClient } from 'basic-ftp'
import type { ConnectionProtocol, RemoteFsEntry } from '../types'

export type RemoteStat = { mode: number; size: number }

export type TransferControl = {
  key: string
  isCancelled: () => boolean
  registerAbort: (abort: () => void) => void
  clearAbort: () => void
}

/** Session fields used by remote filesystem backends. */
export type FsSession = {
  client: Client
  protocol: ConnectionProtocol
  closed: boolean
  cwd: string
  sftp: SFTPWrapper | null
  ftp: FtpClient | null
  ftpConfig: {
    host: string
    port: number
    username: string
    password: string
  } | null
}

export interface RemoteFsBackend {
  ping(started: number): Promise<number>
  getCwd(): Promise<string>
  listDir(remotePath: string): Promise<RemoteFsEntry[]>
  stat(remotePath: string): Promise<RemoteStat>
  readFile(
    remotePath: string,
    maxBytes: number,
  ): Promise<{ content: string; size: number }>
  readBinaryFile(
    remotePath: string,
    maxBytes: number,
  ): Promise<{ base64: string; size: number; mimeType: string }>
  writeFile(remotePath: string, content: string): Promise<void>
  downloadFile(
    remotePath: string,
    localPath: string,
    onBytes?: (transferred: number, total: number) => void,
    control?: TransferControl,
  ): Promise<void>
  uploadFile(
    localPath: string,
    remotePath: string,
    onBytes?: (transferred: number, total: number) => void,
    control?: TransferControl,
  ): Promise<void>
  mkdir(remotePath: string): Promise<void>
  ensureDir(remotePath: string): Promise<void>
  rename(fromPath: string, toPath: string): Promise<void>
  remove(remotePath: string): Promise<number>
}

export type FtpSessionAccess = {
  getFtp: () => Promise<FtpClient>
}

export type SftpSessionAccess = {
  sessionId: string
  withSftp: <T>(fn: (sftp: SFTPWrapper) => Promise<T>) => Promise<T>
  getSftp: () => Promise<SFTPWrapper>
  withTransferRetry: <T>(fn: () => Promise<T>) => Promise<T>
}
