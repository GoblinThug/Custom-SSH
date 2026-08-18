import { FtpRemoteFs } from './ftp-backend'
import { SftpRemoteFs } from './sftp-backend'
import type { FsSession, RemoteFsBackend } from './types'

export type RemoteFsHost = {
  sessionId: string
  getFtp: () => Promise<import('basic-ftp').Client>
  withSftp: <T>(
    fn: (sftp: import('ssh2').SFTPWrapper) => Promise<T>,
  ) => Promise<T>
  getSftp: () => Promise<import('ssh2').SFTPWrapper>
  withTransferRetry: <T>(fn: () => Promise<T>) => Promise<T>
}

export function createRemoteFs(
  session: FsSession,
  host: RemoteFsHost,
): RemoteFsBackend {
  if (session.protocol === 'ftp') {
    return new FtpRemoteFs(session, { getFtp: () => host.getFtp() })
  }
  return new SftpRemoteFs(session, {
    sessionId: host.sessionId,
    withSftp: (fn) => host.withSftp(fn),
    getSftp: () => host.getSftp(),
    withTransferRetry: (fn) => host.withTransferRetry(fn),
  })
}

export { joinRemote, isTransferPartName, localPartPath, remotePartPath } from './shared'
export type { RemoteFsBackend, RemoteStat, TransferControl } from './types'
