import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Client, type ClientChannel, type SFTPWrapper } from 'ssh2'
import type { BrowserWindow } from 'electron'
import type {
  AppTheme,
  ConnectPayload,
  RemoteFsEntry,
  TransferFileInfo,
  TransferProgress,
} from './types'

export class TransferCancelledError extends Error {
  readonly fileKey: string

  constructor(fileKey: string) {
    super('Transfer cancelled')
    this.name = 'TransferCancelledError'
    this.fileKey = fileKey
  }
}

function isTransferCancelledError(err: unknown): boolean {
  return (
    err instanceof TransferCancelledError ||
    (err instanceof Error && err.name === 'TransferCancelledError')
  )
}

type ActiveTransfer = {
  cancelled: Set<string>
  currentKey: string | null
  abortCurrent: (() => void) | null
  files: TransferFileInfo[]
}

type ShellState = {
  id: string
  stream: ClientChannel
  inputEnabled: boolean
  outputEnabled: boolean
  theme: AppTheme
}

type Session = {
  client: Client
  shells: Map<string, ShellState>
  sftp: SFTPWrapper | null
  cwd: string
  theme: AppTheme
  /** Prevents duplicate status events when socket/stream both close. */
  closed: boolean
  /** Set before intentional hangup so UI won't auto-reconnect. */
  disconnectReason: 'user' | 'drop'
}

const CWD_OSC_RE = /\x1b\]7337;cwd;([^\x07\x1b]*)(?:\x07|\x1b\\)/g

const LS_COLORS_COMMON = [
  'rs=0:di=01;34:ln=01;36:mh=00:so=01;35:do=01;35:ex=01;32',
  '*.tar=01;31:*.tgz=01;31:*.zip=01;31:*.gz=01;31:*.bz2=01;31:*.7z=01;31:*.rar=01;31',
  '*.jpg=01;35:*.jpeg=01;35:*.png=01;35:*.gif=01;35:*.webp=01;35:*.svg=01;35',
  '*.mp3=01;35:*.mp4=01;35:*.mkv=01;35:*.mov=01;35',
  '*.json=01;33:*.yml=01;33:*.yaml=01;33:*.toml=01;33:*.xml=01;33:*.ini=01;33:*.conf=01;33:*.properties=01;33',
  '*.md=01;33:*.txt=00;33:*.log=00;33',
  '*.js=01;33:*.ts=01;33:*.jsx=01;33:*.tsx=01;33:*.py=01;33:*.sh=01;32:*.bash=01;32',
  '*.jar=01;31:*.war=01;31:*.class=01;31',
  '*.sql=01;33:*.db=01;33:*.sqlite=01;33',
].join(':')

/** Dark terminal: classic backgrounds for special dirs are fine. */
const LS_COLORS_DARK = [
  LS_COLORS_COMMON,
  'pi=40;33:bd=40;33;01:cd=40;33;01:or=40;31;01:mi=00',
  'su=37;41:sg=30;43:ca=00:tw=30;42:ow=34;42:st=37;44',
].join(':')

/** Light terminal: avoid dark bg blocks — use bold fg only. */
const LS_COLORS_LIGHT = [
  LS_COLORS_COMMON,
  'pi=01;33:bd=01;33:cd=01;33:or=01;31:mi=00',
  'su=01;31:sg=01;33:ca=00:tw=01;32:ow=01;34:st=01;34',
].join(':')

function lsColorsForTheme(theme: AppTheme): string {
  return theme === 'light' ? LS_COLORS_LIGHT : LS_COLORS_DARK
}

function colorEnv(theme: AppTheme) {
  return {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    CLICOLOR: '1',
    CLICOLOR_FORCE: '1',
    FORCE_COLOR: '3',
    LANG: 'C.UTF-8',
    LC_CTYPE: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    LS_COLORS: lsColorsForTheme(theme),
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

function isPowerShellBanner(text: string): boolean {
  return /^PS\s|\bPS\s+[A-Za-z]:/m.test(text)
}

function hasPrompt(text: string): boolean {
  return (
    /[$#%] $/.test(text) ||
    /[❯›➜] $/.test(text) ||
    isPowerShellBanner(text)
  )
}

function joinRemote(...parts: string[]): string {
  const cleaned = parts
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
  return cleaned.length === 0 ? '/' : cleaned
}

/** Incomplete transfer marker — never written as the final path. */
const TRANSFER_PART_SUFFIX = '.customssh.part'

function isTransferPartName(name: string): boolean {
  return name.endsWith(TRANSFER_PART_SUFFIX)
}

function localPartPath(localPath: string): string {
  return `${localPath}${TRANSFER_PART_SUFFIX}`
}

function remotePartPath(remotePath: string): string {
  return `${remotePath}${TRANSFER_PART_SUFFIX}`
}

function isTransientTransferError(err: unknown): boolean {
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

function stripAndCaptureCwd(text: string, session: Session): string {
  return text.replace(CWD_OSC_RE, (_full, cwd: string) => {
    if (cwd) session.cwd = cwd
    return ''
  })
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Bash records a line into history before running it, so `set +o history` on
 *  the same line does not hide that line. Disable history in a prior command,
 *  run bootstrap while history is off, then drop only the short primer entry. */
const UNIX_HISTORY_OFF =
  'set +o history 2>/dev/null || true; setopt HIST_IGNORE_SPACE 2>/dev/null || true\n'

/** Clear screen, remove the history-off primer if it is the last entry, re-enable. */
const UNIX_HISTORY_SCRUB_ON =
  'printf "\\033c";' +
  '__cssh_h=$(history 1 2>/dev/null);' +
  'case ${__cssh_h-} in *set\\ +o\\ history*|*"setopt HIST_IGNORE_SPACE"*)' +
  ' history -d "$(awk \'{print $1}\' <<<"$__cssh_h")" 2>/dev/null || true;;' +
  'esac;' +
  'unset __cssh_h;' +
  'set -o history 2>/dev/null || true\n'

function colorBootstrap(isPowerShell: boolean, theme: AppTheme): string {
  if (isPowerShell) {
    return [
      ' $env:TERM="xterm-256color"',
      ' $env:COLORTERM="truecolor"',
      ' $env:FORCE_COLOR="3"',
      ' try { $PSStyle.OutputRendering = "Ansi" } catch {}',
      ' Clear-Host',
      '',
    ].join(';')
  }

  const colors = shellQuote(lsColorsForTheme(theme))
  // No history toggles here — history must already be off (see primeSession).
  return [
    'stty -echo 2>/dev/null',
    'export TERM=xterm-256color COLORTERM=truecolor CLICOLOR=1 CLICOLOR_FORCE=1 FORCE_COLOR=3',
    `export LS_COLORS=${colors}`,
    'UTF8_LOCALE=$(locale -a 2>/dev/null | grep -iE "utf-?8" | head -n1); UTF8_LOCALE=${UTF8_LOCALE:-C.UTF-8}',
    'export LANG="$UTF8_LOCALE" LC_CTYPE="$UTF8_LOCALE" LC_ALL="$UTF8_LOCALE"',
    'alias ls="ls --color=always" 2>/dev/null',
    'alias grep="grep --color=auto" 2>/dev/null',
    'alias egrep="egrep --color=auto" 2>/dev/null',
    'alias fgrep="fgrep --color=auto" 2>/dev/null',
    'alias diff="diff --color=auto" 2>/dev/null',
    // Emit current directory on every prompt for the file tree (hidden OSC).
    '__cssh_cwd(){ printf "\\033]7337;cwd;%s\\007" "$PWD"; }',
    'PROMPT_COMMAND="__cssh_cwd${PROMPT_COMMAND:+; $PROMPT_COMMAND}"',
    'stty echo 2>/dev/null',
  ].join(';')
}

export class SshManager {
  private sessions = new Map<string, Session>()
  private transfers = new Map<string, ActiveTransfer>()

  constructor(private getWindow: () => BrowserWindow | null) {}

  cancelTransferFile(transferId: string, fileKey: string): boolean {
    const batch = this.transfers.get(transferId)
    if (!batch) return false
    batch.cancelled.add(fileKey)
    const file = batch.files.find((item) => item.key === fileKey)
    if (file && (file.status === 'pending' || file.status === 'active')) {
      file.status = 'cancelled'
    }
    if (batch.currentKey === fileKey) {
      batch.abortCurrent?.()
    }
    return true
  }

  connect(
    sessionId: string,
    payload: ConnectPayload,
  ): Promise<{ shellId: string }> {
    // Replacing a session is intentional — do not treat as a network drop.
    this.disconnect(sessionId, 'user')

    return new Promise((resolve, reject) => {
      const theme: AppTheme = payload.theme === 'light' ? 'light' : 'dark'
      const client = new Client()
      const session: Session = {
        client,
        shells: new Map(),
        sftp: null,
        cwd: '/',
        theme,
        closed: false,
        disconnectReason: 'drop',
      }
      this.sessions.set(sessionId, session)

      client
        .on('ready', () => {
          void this.spawnShell(sessionId, {
            cols: payload.cols ?? 120,
            rows: payload.rows ?? 30,
            theme,
            primary: true,
          })
            .then((shellId) => {
              this.send(sessionId, 'ssh:status', { status: 'connected' })
              resolve({ shellId })
            })
            .catch((err: Error) => {
              this.finishSession(sessionId, {
                status: 'error',
                message: err.message,
              })
              reject(err)
            })
        })
        .on('error', (err) => {
          this.finishSession(sessionId, {
            status: 'error',
            message: err.message,
            reason: session.disconnectReason,
          })
          reject(err)
        })
        .on('close', () => {
          this.finishSession(sessionId, {
            status: 'disconnected',
            reason: session.disconnectReason,
          })
        })
        .on('end', () => {
          this.finishSession(sessionId, {
            status: 'disconnected',
            reason: session.disconnectReason,
          })
        })

      const config: Record<string, unknown> = {
        host: payload.host,
        port: payload.port,
        username: payload.username,
        readyTimeout: 20000,
        // Detect dead VPN/routes faster than default TCP timeouts.
        keepaliveInterval: 5000,
        keepaliveCountMax: 2,
      }

      if (payload.authMethod === 'password') {
        config.password = payload.password ?? ''
      } else {
        if (!payload.privateKeyPath) {
          reject(new Error('Private key path is required'))
          return
        }
        config.privateKey = fs.readFileSync(payload.privateKeyPath)
        if (payload.passphrase) {
          config.passphrase = payload.passphrase
        }
      }

      this.send(sessionId, 'ssh:status', { status: 'connecting' })
      client.connect(config as Parameters<Client['connect']>[0])
    })
  }

  openShell(
    sessionId: string,
    size?: { cols?: number; rows?: number },
  ): Promise<{ shellId: string }> {
    const session = this.sessions.get(sessionId)
    if (!session || session.closed) throw new Error('Session not found')
    return this.spawnShell(sessionId, {
      cols: size?.cols ?? 120,
      rows: size?.rows ?? 30,
      theme: session.theme,
      primary: false,
    }).then((shellId) => ({ shellId }))
  }

  closeShell(sessionId: string, shellId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const shell = session.shells.get(shellId)
    if (!shell) return
    try {
      shell.stream.close()
    } catch {
      // ignore — 'close' handler removes the shell / may disconnect
    }
  }

  write(sessionId: string, data: string, shellId?: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const shell = shellId
      ? session.shells.get(shellId)
      : session.shells.values().next().value
    if (!shell?.inputEnabled) return
    shell.stream.write(Buffer.from(data, 'utf8'))
  }

  /** Quietly refresh LS_COLORS when the UI theme changes mid-session. */
  applyTheme(sessionId: string, theme: AppTheme, shellId?: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const next = theme === 'light' ? 'light' : 'dark'
    session.theme = next
    const targets = shellId
      ? [session.shells.get(shellId)].filter(Boolean)
      : Array.from(session.shells.values())
    const colors = shellQuote(lsColorsForTheme(next))
    // Leading space + delete this line from history after it runs (bash).
    const cmd =
      ' stty -echo 2>/dev/null;' +
      ` export LS_COLORS=${colors};` +
      ' stty echo 2>/dev/null;' +
      ' history -d "$HISTCMD" 2>/dev/null || true\n'

    for (const shell of targets) {
      if (!shell?.inputEnabled) continue
      shell.theme = next
      shell.outputEnabled = false
      shell.stream.write(cmd)
      setTimeout(() => {
        shell.outputEnabled = true
      }, 180)
    }
  }

  resize(sessionId: string, cols: number, rows: number, shellId?: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const shell = shellId
      ? session.shells.get(shellId)
      : session.shells.values().next().value
    shell?.stream.setWindow(rows, cols, 0, 0)
  }

  disconnect(sessionId: string, reason: 'user' | 'drop' = 'user') {
    const session = this.sessions.get(sessionId)
    if (!session || session.closed) return
    session.disconnectReason = reason
    try {
      session.sftp?.end()
      for (const shell of session.shells.values()) {
        shell.stream.close()
      }
      session.shells.clear()
      session.client.end()
    } catch {
      // ignore cleanup errors
    }
    this.finishSession(sessionId, {
      status: 'disconnected',
      reason,
    })
  }

  private spawnShell(
    sessionId: string,
    options: {
      cols: number
      rows: number
      theme: AppTheme
      primary: boolean
    },
  ): Promise<string> {
    const session = this.sessions.get(sessionId)
    if (!session || session.closed) {
      return Promise.reject(new Error('Session not found'))
    }

    return new Promise((resolve, reject) => {
      session.client.shell(
        {
          term: 'xterm-256color',
          cols: options.cols,
          rows: options.rows,
        },
        {
          env: colorEnv(options.theme),
        },
        (err, stream) => {
          if (err || !stream) {
            reject(err ?? new Error('Failed to open shell'))
            return
          }

          const shellId = randomUUID()
          const shell: ShellState = {
            id: shellId,
            stream,
            inputEnabled: false,
            outputEnabled: false,
            theme: options.theme,
          }
          session.shells.set(shellId, shell)

          const forward = (data: Buffer) => {
            const cleaned = stripAndCaptureCwd(data.toString('utf8'), session)
            if (!shell.outputEnabled || !cleaned) return
            this.send(sessionId, 'ssh:data', {
              shellId,
              data: Buffer.from(cleaned, 'utf8').toString('base64'),
            })
          }

          stream.on('data', forward)
          stream.stderr.on('data', forward)
          stream.on('close', () => {
            session.shells.delete(shellId)
            this.send(sessionId, 'ssh:shell-closed', { shellId })
            if (session.shells.size === 0 && !session.closed) {
              this.disconnect(sessionId, session.disconnectReason)
            }
          })

          // Return shellId immediately so the UI can open a tab without waiting
          // for prompt priming (~1s+). I/O stays gated until prime finishes.
          resolve(shellId)

          this.primeSession(stream, options.theme)
            .then(async () => {
              if (options.primary) {
                try {
                  session.cwd = await this.execPwd(session)
                } catch {
                  // keep default
                }
              }
              setTimeout(() => {
                shell.outputEnabled = true
                shell.inputEnabled = true
                // Priming clears the screen while output is muted, so the final
                // prompt never reaches the UI — nudge the shell for a fresh one.
                try {
                  shell.stream.write('\n')
                } catch {
                  // ignore
                }
              }, 60)
            })
            .catch(() => {
              session.shells.delete(shellId)
              try {
                stream.close()
              } catch {
                // ignore
              }
            })
        },
      )
    })
  }

  /** Round-trip latency via a lightweight remote `true` exec. */
  async ping(sessionId: string): Promise<number> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')

    const started = Date.now()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Ping timeout'))
      }, 8000)

      session.client.exec('true', (err, stream) => {
        if (err || !stream) {
          clearTimeout(timeout)
          reject(err ?? new Error('Ping failed'))
          return
        }
        stream.on('data', () => {
          // drain
        })
        stream.stderr.on('data', () => {
          // drain
        })
        stream.on('close', () => {
          clearTimeout(timeout)
          resolve(Math.max(1, Date.now() - started))
        })
        stream.on('error', (streamErr: Error) => {
          clearTimeout(timeout)
          reject(streamErr)
        })
      })
    })
  }

  async getCwd(sessionId: string): Promise<string> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')
    if (session.cwd) return session.cwd
    session.cwd = await this.execPwd(session)
    return session.cwd
  }

  async listDir(sessionId: string, remotePath: string): Promise<RemoteFsEntry[]> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')
    const sftp = await this.getSftp(session)
    const target = remotePath || '/'

    return new Promise((resolve, reject) => {
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
            const isDir = (item.attrs.mode & 0o170000) === 0o040000
            return {
              name: item.filename,
              path: joinRemote(target, item.filename),
              isDir,
            } satisfies RemoteFsEntry
          })
          .sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
            return a.name.localeCompare(b.name)
          })
        resolve(entries)
      })
    })
  }

  async readFile(
    sessionId: string,
    remotePath: string,
    maxBytes = 5 * 1024 * 1024,
  ): Promise<{ content: string; size: number }> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')
    const sftp = await this.getSftp(session)

    return new Promise((resolve, reject) => {
      sftp.stat(remotePath, (statErr, stats) => {
        if (statErr) {
          reject(statErr)
          return
        }
        if ((stats.mode & 0o170000) === 0o040000) {
          reject(new Error('Path is a directory'))
          return
        }
        if (stats.size > maxBytes) {
          reject(
            new Error(
              `File is too large to edit (${Math.ceil(stats.size / 1024 / 1024)} MB)`,
            ),
          )
          return
        }

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

  async writeFile(
    sessionId: string,
    remotePath: string,
    content: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')
    const sftp = await this.getSftp(session)

    return new Promise((resolve, reject) => {
      sftp.writeFile(remotePath, Buffer.from(content, 'utf8'), (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  async downloadFile(
    sessionId: string,
    remotePath: string,
    localPath: string,
    onBytes?: (transferred: number, total: number) => void,
    control?: {
      key: string
      isCancelled: () => boolean
      registerAbort: (abort: () => void) => void
      clearAbort: () => void
    },
  ): Promise<void> {
    const throwIfCancelled = () => {
      if (control?.isCancelled()) {
        throw new TransferCancelledError(control.key)
      }
    }

    await this.withTransferRetry(sessionId, async () => {
      throwIfCancelled()
      const session = this.requireSession(sessionId)
      const sftp = await this.getSftp(session)
      const remoteStats = await this.statPath(sftp, remotePath)
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
        this.finalizeLocalPart(partPath, localPath)
        onBytes?.(1, 1)
        return
      }

      if (offset === total) {
        this.finalizeLocalPart(partPath, localPath)
        onBytes?.(total, total)
        return
      }

      await new Promise<void>((resolve, reject) => {
        let settled = false
        let transferred = offset
        const readStream = sftp.createReadStream(remotePath, {
          start: offset,
          end: total > 0 ? total - 1 : 0,
        })
        const writeStream = fs.createWriteStream(partPath, {
          flags: offset > 0 ? 'a' : 'w',
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
            this.finalizeLocalPart(partPath, localPath)
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

  async isDirectory(sessionId: string, remotePath: string): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')
    const sftp = await this.getSftp(session)
    const stats = await this.statPath(sftp, remotePath)
    return (stats.mode & 0o170000) === 0o040000
  }

  /** Download a remote file or folder recursively. */
  async downloadRemote(
    sessionId: string,
    remotePath: string,
    localPath: string,
    onProgress?: (progress: TransferProgress) => void,
    options?: { transferId?: string },
  ): Promise<{ saved: number; cancelled: number }> {
    const jobs = await this.collectDownloadJobs(sessionId, remotePath, localPath)
    return this.runDownloadJobs(sessionId, jobs, onProgress, options?.transferId)
  }

  /** Download multiple roots as one cancellable transfer. */
  async downloadRemoteMany(
    sessionId: string,
    items: Array<{ remotePath: string; localPath: string }>,
    onProgress?: (progress: TransferProgress) => void,
  ): Promise<{ saved: number; cancelled: number }> {
    const jobs: Array<{ remotePath: string; localPath: string; size: number }> =
      []
    for (const item of items) {
      jobs.push(
        ...(await this.collectDownloadJobs(
          sessionId,
          item.remotePath,
          item.localPath,
        )),
      )
    }
    return this.runDownloadJobs(sessionId, jobs, onProgress)
  }

  private async runDownloadJobs(
    sessionId: string,
    jobs: Array<{ remotePath: string; localPath: string; size: number }>,
    onProgress?: (progress: TransferProgress) => void,
    existingTransferId?: string,
  ): Promise<{ saved: number; cancelled: number }> {
    const transferId = existingTransferId ?? randomUUID()
    const files: TransferFileInfo[] = jobs.map((job, index) => ({
      key: `${index}:${job.remotePath}`,
      path: job.remotePath,
      status: 'pending' as const,
    }))
    const batch: ActiveTransfer = {
      cancelled: new Set(),
      currentKey: null,
      abortCurrent: null,
      files,
    }
    this.transfers.set(transferId, batch)

    const filesTotal = jobs.length
    const totalBytes = jobs.reduce((sum, job) => sum + Math.max(job.size, 1), 0)
    let transferredBytes = 0
    let filesDone = 0
    let filesCancelled = 0

    const emit = (currentPath?: string, fileTransferred = 0, fileTotal = 0) => {
      const currentContribution =
        fileTotal > 0 ? Math.min(fileTransferred, fileTotal) : 0
      const overall = Math.min(
        totalBytes,
        transferredBytes + currentContribution,
      )
      onProgress?.({
        transferId,
        percent:
          totalBytes > 0 ? Math.min(100, (overall / totalBytes) * 100) : 0,
        transferred: overall,
        total: totalBytes,
        currentPath,
        filesDone,
        filesTotal,
        filesCancelled,
        files: files.map((item) => ({ ...item })),
      })
    }

    try {
      emit()
      for (let index = 0; index < jobs.length; index += 1) {
        const job = jobs[index]
        const key = files[index].key
        if (batch.cancelled.has(key) || files[index].status === 'cancelled') {
          files[index].status = 'cancelled'
          filesCancelled += 1
          transferredBytes += Math.max(job.size, 1)
          emit()
          continue
        }

        const parent = path.dirname(job.localPath)
        if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true })
        files[index].status = 'active'
        batch.currentKey = key
        emit(job.remotePath, 0, job.size)

        try {
          await this.downloadFile(
            sessionId,
            job.remotePath,
            job.localPath,
            (fileTransferred, fileTotal) => {
              emit(job.remotePath, fileTransferred, fileTotal || job.size)
            },
            {
              key,
              isCancelled: () => batch.cancelled.has(key),
              registerAbort: (abort) => {
                batch.abortCurrent = abort
              },
              clearAbort: () => {
                if (batch.currentKey === key) batch.abortCurrent = null
              },
            },
          )
          files[index].status = 'done'
          filesDone += 1
        } catch (err) {
          if (isTransferCancelledError(err)) {
            files[index].status = 'cancelled'
            filesCancelled += 1
            this.cleanupLocalPart(job.localPath)
          } else {
            const message =
              err instanceof Error ? err.message : String(err ?? 'Transfer failed')
            files[index].status = 'error'
            files[index].error = message
            // Count toward completion so the dock does not hang on a sticky active file.
            filesCancelled += 1
            this.cleanupLocalPart(job.localPath)
          }
        } finally {
          batch.currentKey = null
          batch.abortCurrent = null
        }

        transferredBytes += Math.max(job.size, 1)
        emit(job.remotePath, job.size, job.size)
      }
      return { saved: filesDone, cancelled: filesCancelled }
    } finally {
      this.transfers.delete(transferId)
    }
  }

  private async collectDownloadJobs(
    sessionId: string,
    remotePath: string,
    localPath: string,
  ): Promise<Array<{ remotePath: string; localPath: string; size: number }>> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')
    const sftp = await this.getSftp(session)
    const stats = await this.statPath(sftp, remotePath)
    const isDir = (stats.mode & 0o170000) === 0o040000

    if (!isDir) {
      return [
        {
          remotePath,
          localPath,
          size: stats.size > 0 ? stats.size : 1,
        },
      ]
    }

    if (!fs.existsSync(localPath)) {
      fs.mkdirSync(localPath, { recursive: true })
    }

    const entries = await this.listDir(sessionId, remotePath)
    const jobs: Array<{ remotePath: string; localPath: string; size: number }> =
      []
    for (const entry of entries) {
      const nested = await this.collectDownloadJobs(
        sessionId,
        entry.path,
        path.join(localPath, entry.name),
      )
      jobs.push(...nested)
    }
    return jobs
  }

  async uploadFile(
    sessionId: string,
    localPath: string,
    remotePath: string,
    onBytes?: (transferred: number, total: number) => void,
    control?: {
      key: string
      isCancelled: () => boolean
      registerAbort: (abort: () => void) => void
      clearAbort: () => void
    },
  ): Promise<void> {
    const throwIfCancelled = () => {
      if (control?.isCancelled()) {
        throw new TransferCancelledError(control.key)
      }
    }

    await this.withTransferRetry(sessionId, async () => {
      throwIfCancelled()
      const session = this.requireSession(sessionId)
      const sftp = await this.getSftp(session)
      const total = fs.statSync(localPath).size
      const partRemote = remotePartPath(remotePath)
      const parent = remotePath.includes('/')
        ? remotePath.slice(0, remotePath.lastIndexOf('/')) || '/'
        : '/'
      if (parent && parent !== '/') {
        await this.mkdirp(sftp, parent)
      }

      let offset = 0
      try {
        const partStats = await this.statPath(sftp, partRemote)
        offset = partStats.size
        if (total > 0 && offset > total) {
          await this.sftpUnlink(sftp, partRemote)
          offset = 0
        }
      } catch {
        offset = 0
      }

      throwIfCancelled()

      if (total === 0) {
        await this.sftpWriteEmpty(sftp, partRemote)
        await this.finalizeRemotePart(sftp, partRemote, remotePath)
        onBytes?.(1, 1)
        return
      }

      if (offset === total) {
        await this.finalizeRemotePart(sftp, partRemote, remotePath)
        onBytes?.(total, total)
        return
      }

      await new Promise<void>((resolve, reject) => {
        let settled = false
        let transferred = offset
        const readStream = fs.createReadStream(localPath, {
          start: offset,
        })
        const writeStream = sftp.createWriteStream(
          partRemote,
          offset > 0
            ? { flags: 'r+', start: offset, autoClose: true }
            : { flags: 'w', autoClose: true },
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
              const partStats = await this.statPath(sftp, partRemote)
              if (partStats.size !== total) {
                reject(
                  new Error(
                    `Incomplete upload (${partStats.size}/${total} bytes) — will resume`,
                  ),
                )
                return
              }
              await this.finalizeRemotePart(sftp, partRemote, remotePath)
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

  async mkdir(
    sessionId: string,
    remotePath: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')
    const sftp = await this.getSftp(session)
    await this.mkdirp(sftp, remotePath)
  }

  async rename(
    sessionId: string,
    fromPath: string,
    toPath: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')
    const sftp = await this.getSftp(session)
    return new Promise((resolve, reject) => {
      sftp.rename(fromPath, toPath, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  async removeRemote(sessionId: string, remotePath: string): Promise<number> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')
    const sftp = await this.getSftp(session)
    return this.removeRecursive(sessionId, sftp, remotePath)
  }

  /** Upload local files/folders into remoteDir. */
  async uploadLocal(
    sessionId: string,
    localPaths: string[],
    remoteDir: string,
    onProgress?: (progress: TransferProgress) => void,
  ): Promise<{ saved: number; cancelled: number }> {
    const jobs: Array<{ localPath: string; remotePath: string; size: number }> =
      []
    for (const localPath of localPaths) {
      jobs.push(
        ...(await this.collectUploadJobs(sessionId, localPath, remoteDir)),
      )
    }

    const transferId = randomUUID()
    const files: TransferFileInfo[] = jobs.map((job, index) => ({
      key: `${index}:${job.remotePath}`,
      path: job.remotePath,
      status: 'pending' as const,
    }))
    const batch: ActiveTransfer = {
      cancelled: new Set(),
      currentKey: null,
      abortCurrent: null,
      files,
    }
    this.transfers.set(transferId, batch)

    const filesTotal = jobs.length
    const totalBytes = jobs.reduce((sum, job) => sum + Math.max(job.size, 1), 0)
    let transferredBytes = 0
    let filesDone = 0
    let filesCancelled = 0

    const emit = (currentPath?: string, fileTransferred = 0, fileTotal = 0) => {
      const currentContribution =
        fileTotal > 0 ? Math.min(fileTransferred, fileTotal) : 0
      const overall = Math.min(
        totalBytes,
        transferredBytes + currentContribution,
      )
      onProgress?.({
        transferId,
        percent:
          totalBytes > 0 ? Math.min(100, (overall / totalBytes) * 100) : 0,
        transferred: overall,
        total: totalBytes,
        currentPath,
        filesDone,
        filesTotal,
        filesCancelled,
        files: files.map((item) => ({ ...item })),
      })
    }

    try {
      emit()
      for (let index = 0; index < jobs.length; index += 1) {
        const job = jobs[index]
        const key = files[index].key
        if (batch.cancelled.has(key) || files[index].status === 'cancelled') {
          files[index].status = 'cancelled'
          filesCancelled += 1
          transferredBytes += Math.max(job.size, 1)
          emit()
          continue
        }

        files[index].status = 'active'
        batch.currentKey = key
        emit(job.remotePath, 0, job.size)

        try {
          await this.uploadFile(
            sessionId,
            job.localPath,
            job.remotePath,
            (fileTransferred, fileTotal) => {
              emit(job.remotePath, fileTransferred, fileTotal || job.size)
            },
            {
              key,
              isCancelled: () => batch.cancelled.has(key),
              registerAbort: (abort) => {
                batch.abortCurrent = abort
              },
              clearAbort: () => {
                if (batch.currentKey === key) batch.abortCurrent = null
              },
            },
          )
          files[index].status = 'done'
          filesDone += 1
        } catch (err) {
          if (isTransferCancelledError(err)) {
            files[index].status = 'cancelled'
            filesCancelled += 1
            await this.cleanupRemotePart(sessionId, job.remotePath)
          } else {
            const message =
              err instanceof Error ? err.message : String(err ?? 'Transfer failed')
            files[index].status = 'error'
            files[index].error = message
            // Count toward completion so the dock does not hang on a sticky active file.
            filesCancelled += 1
            await this.cleanupRemotePart(sessionId, job.remotePath)
          }
        } finally {
          batch.currentKey = null
          batch.abortCurrent = null
        }

        transferredBytes += Math.max(job.size, 1)
        emit(job.remotePath, job.size, job.size)
      }
      return { saved: filesDone, cancelled: filesCancelled }
    } finally {
      this.transfers.delete(transferId)
    }
  }

  private async collectUploadJobs(
    sessionId: string,
    localPath: string,
    remoteDir: string,
  ): Promise<Array<{ localPath: string; remotePath: string; size: number }>> {
    const baseName = path.basename(localPath)
    const remotePath = joinRemote(remoteDir, baseName)
    const stat = fs.statSync(localPath)

    if (!stat.isDirectory()) {
      return [
        {
          localPath,
          remotePath,
          size: stat.size > 0 ? stat.size : 1,
        },
      ]
    }

    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')
    const sftp = await this.getSftp(session)
    await this.mkdirp(sftp, remotePath)

    const jobs: Array<{ localPath: string; remotePath: string; size: number }> =
      []
    for (const name of fs.readdirSync(localPath)) {
      if (isTransferPartName(name)) continue
      jobs.push(
        ...(await this.collectUploadJobs(
          sessionId,
          path.join(localPath, name),
          remotePath,
        )),
      )
    }
    return jobs
  }

  private async mkdirp(sftp: SFTPWrapper, remotePath: string): Promise<void> {
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
        const stats = await this.statPath(sftp, current)
        if ((stats.mode & 0o170000) !== 0o040000) {
          throw new Error(`Not a directory: ${current}`)
        }
      } catch {
        await new Promise<void>((resolve, reject) => {
          sftp.mkdir(current, (err) => {
            if (!err) {
              resolve()
              return
            }
            // Ignore races where the directory appeared between stat and mkdir.
            sftp.stat(current, (statErr, stats) => {
              if (
                !statErr &&
                stats &&
                (stats.mode & 0o170000) === 0o040000
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

  private async removeRecursive(
    sessionId: string,
    sftp: SFTPWrapper,
    remotePath: string,
  ): Promise<number> {
    const stats = await this.statPath(sftp, remotePath)
    const isDir = (stats.mode & 0o170000) === 0o040000
    if (!isDir) {
      await new Promise<void>((resolve, reject) => {
        sftp.unlink(remotePath, (err) => {
          if (err) reject(err)
          else resolve()
        })
      })
      return 1
    }

    const entries = await this.listDir(sessionId, remotePath)
    let removed = 0
    for (const entry of entries) {
      removed += await this.removeRecursive(sessionId, sftp, entry.path)
    }
    await new Promise<void>((resolve, reject) => {
      sftp.rmdir(remotePath, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
    return removed
  }

  private statPath(
    sftp: SFTPWrapper,
    remotePath: string,
  ): Promise<{ mode: number; size: number }> {
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

  private requireSession(sessionId: string): Session {
    const session = this.sessions.get(sessionId)
    if (!session || session.closed) throw new Error('Session not found')
    return session
  }

  private async withTransferRetry<T>(
    sessionId: string,
    fn: () => Promise<T>,
    maxAttempts = 48,
  ): Promise<T> {
    let lastError: unknown
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        if (attempt > 0) {
          await this.waitForSessionReady(sessionId)
        }
        return await fn()
      } catch (err) {
        lastError = err
        if (isTransferCancelledError(err) || !isTransientTransferError(err)) {
          throw err
        }
        const session = this.sessions.get(sessionId)
        if (session) session.sftp = null
        await delay(Math.min(2500, 400 + attempt * 150))
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError ?? 'Transfer failed'))
  }

  private async waitForSessionReady(
    sessionId: string,
    timeoutMs = 180_000,
  ): Promise<Session> {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const session = this.sessions.get(sessionId)
      if (session && !session.closed) {
        try {
          await this.getSftp(session)
          return session
        } catch {
          // SFTP channel not ready yet after reconnect.
        }
      }
      await delay(400)
    }
    throw new Error('Session did not recover in time to resume transfer')
  }

  private finalizeLocalPart(partPath: string, localPath: string) {
    if (!fs.existsSync(partPath)) {
      throw new Error('Missing partial download file')
    }
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath)
    }
    fs.renameSync(partPath, localPath)
  }

  private cleanupLocalPart(localPath: string) {
    const partPath = localPartPath(localPath)
    try {
      if (fs.existsSync(partPath)) fs.unlinkSync(partPath)
    } catch {
      // best-effort
    }
  }

  private async cleanupRemotePart(sessionId: string, remotePath: string) {
    try {
      const session = this.sessions.get(sessionId)
      if (!session || session.closed) return
      const sftp = await this.getSftp(session)
      await this.sftpUnlink(sftp, remotePartPath(remotePath))
    } catch {
      // best-effort — session may be gone
    }
  }

  private async finalizeRemotePart(
    sftp: SFTPWrapper,
    partRemote: string,
    remotePath: string,
  ): Promise<void> {
    await this.sftpUnlink(sftp, remotePath)
    await new Promise<void>((resolve, reject) => {
      sftp.rename(partRemote, remotePath, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  private sftpUnlink(sftp: SFTPWrapper, remotePath: string): Promise<void> {
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
        // SSH_FX_NO_SUCH_FILE
        if (code === 2 || /no such file/i.test(err.message)) {
          resolve()
          return
        }
        reject(err)
      })
    })
  }

  private sftpWriteEmpty(sftp: SFTPWrapper, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      sftp.writeFile(remotePath, Buffer.alloc(0), (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  private getSftp(session: Session): Promise<SFTPWrapper> {
    if (session.sftp) return Promise.resolve(session.sftp)
    return new Promise((resolve, reject) => {
      session.client.sftp((err, sftp) => {
        if (err || !sftp) {
          reject(err ?? new Error('Failed to open SFTP'))
          return
        }
        session.sftp = sftp
        sftp.on('close', () => {
          session.sftp = null
        })
        resolve(sftp)
      })
    })
  }

  private execPwd(session: Session): Promise<string> {
    return new Promise((resolve, reject) => {
      session.client.exec('pwd -P', (err, stream) => {
        if (err || !stream) {
          reject(err ?? new Error('pwd failed'))
          return
        }
        let out = ''
        stream.on('data', (chunk: Buffer) => {
          out += chunk.toString('utf8')
        })
        stream.stderr.on('data', () => {
          // ignore
        })
        stream.on('close', () => {
          const cwd = out.trim() || '/'
          session.cwd = cwd
          resolve(cwd)
        })
      })
    })
  }

  private waitForPrompt(stream: ClientChannel, timeoutMs: number): Promise<string> {
    return new Promise((resolve) => {
      let buffer = Buffer.alloc(0)
      let settled = false
      let idleTimer: NodeJS.Timeout | null = null

      const done = (text: string) => {
        if (settled) return
        settled = true
        stream.removeListener('data', onData)
        if (idleTimer) clearTimeout(idleTimer)
        clearTimeout(timeout)
        resolve(text)
      }

      const onData = (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk])
        const text = buffer.toString('utf8')
        if (hasPrompt(text) || buffer.length > 8192) {
          done(text)
          return
        }
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => done(buffer.toString('utf8')), 120)
      }

      const timeout = setTimeout(() => done(buffer.toString('utf8')), timeoutMs)
      stream.on('data', onData)
    })
  }

  private async primeSession(
    stream: ClientChannel,
    theme: AppTheme,
  ): Promise<void> {
    const preview = await this.waitForPrompt(stream, 800)
    const isPS = isPowerShellBanner(preview)

    if (isPS) {
      stream.write(colorBootstrap(true, theme))
      await delay(280)
      stream.write(' Clear-Host\n')
    } else {
      // 1) Turn history off in its own line (may leave a tiny entry).
      // 2) Run bootstrap while history is off — not recorded.
      // 3) Clear screen, delete the history-off primer, turn history back on.
      stream.write(UNIX_HISTORY_OFF)
      await delay(100)
      stream.write(`${colorBootstrap(false, theme)}\n`)
      await delay(200)
      stream.write(UNIX_HISTORY_SCRUB_ON)
    }
    await this.waitForPrompt(stream, 900)
    await delay(80)
  }

  private finishSession(
    sessionId: string,
    payload: {
      status: 'disconnected' | 'error'
      message?: string
      reason?: 'user' | 'drop'
    },
  ) {
    const session = this.sessions.get(sessionId)
    if (session?.closed) return
    if (session) session.closed = true
    this.sessions.delete(sessionId)
    this.send(sessionId, 'ssh:status', {
      status: payload.status,
      message: payload.message,
      reason: payload.reason ?? session?.disconnectReason ?? 'drop',
    })
  }

  private send(sessionId: string, channel: string, payload: unknown) {
    const win = this.getWindow()
    win?.webContents.send(channel, { sessionId, payload })
  }
}
