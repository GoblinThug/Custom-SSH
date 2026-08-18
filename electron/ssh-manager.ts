import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { Client as FtpClient } from 'basic-ftp'
import { Client, type ClientChannel, type SFTPWrapper } from 'ssh2'
import type { BrowserWindow } from 'electron'
import type {
  AppTheme,
  ConnectionProtocol,
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

export class ConnectCancelledError extends Error {
  readonly cancelled = true

  constructor() {
    super('Connection cancelled')
    this.name = 'ConnectCancelledError'
  }
}

export function isConnectCancelled(err: unknown): boolean {
  return (
    err instanceof ConnectCancelledError ||
    (err instanceof Error && err.message === 'Connection cancelled')
  )
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
  aborts: Map<string, () => void>
  files: TransferFileInfo[]
}

/** Parallel SFTP file transfers per session. */
const TRANSFER_CONCURRENCY = 4
/** Parallel directory walks while building transfer job lists. */
const COLLECT_CONCURRENCY = 8
/** Throttle progress IPC to avoid main↔renderer overhead. */
const PROGRESS_EMIT_MS = 150
/** Larger read/write chunks for high-latency links. */
const STREAM_HIGH_WATER_MARK = 256 * 1024

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const worker = async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  )
  return results
}

function createThrottledProgressEmitter(
  onProgress: ((progress: TransferProgress) => void) | undefined,
  snapshot: () => TransferProgress,
) {
  let lastEmit = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = () => {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    lastEmit = Date.now()
    onProgress?.(snapshot())
  }

  const emit = (force = false) => {
    if (!onProgress) return
    const now = Date.now()
    if (force || now - lastEmit >= PROGRESS_EMIT_MS) {
      flush()
      return
    }
    if (timer) return
    timer = setTimeout(flush, PROGRESS_EMIT_MS - (now - lastEmit))
  }

  return { emit, flush }
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
  ftp: FtpClient | null
  ftpConfig:
    | {
        host: string
        port: number
        username: string
        password: string
      }
    | null
  cwd: string
  theme: AppTheme
  protocol: ConnectionProtocol
  /** Prevents duplicate status events when socket/stream both close. */
  closed: boolean
  /** Set before intentional hangup so UI won't auto-reconnect. */
  disconnectReason: 'user' | 'drop'
  /** Rejects an in-flight connect() when the session is cancelled. */
  connectAbort?: () => void
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

function mimeTypeForImagePath(remotePath: string): string {
  const lower = remotePath.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'application/octet-stream'
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

/** Drop leaked internal bootstrap lines if they reach the UI. */
function stripBootstrapNoise(text: string): string {
  if (!text) return text
  return text
    .replace(
      /[^\n\r]*stty -echo 2>\/dev\/null;\s*export LS_COLORS=[^\n\r]*[\n\r]?/g,
      '',
    )
    .replace(/[^\n\r]*history -d "\$HISTCMD"[^\n\r]*[\n\r]?/g, '')
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Bash records a line into history before running it, so `set +o history` on
 *  the same line does not hide that line. Disable history in a prior command,
 *  run bootstrap while history is off, then scrub disk + memory history. */
const UNIX_HISTORY_OFF =
  'export HISTCONTROL=ignoreboth 2>/dev/null;' +
  'set +o history 2>/dev/null || true;' +
  'setopt HIST_IGNORE_SPACE 2>/dev/null || true\n'

/**
 * Clear screen, strip CustomSSH bootstrap leftovers from HISTFILE (including
 * older one-line bootstraps already saved on the server), reload in-memory
 * history, re-enable recording.
 */
const UNIX_HISTORY_SCRUB_ON =
  'printf "\\033c";' +
  // Unique markers from our bootstrap / primers (old and new formats).
  '__cssh_re="(__cssh_cwd|__cssh_boot|set \\\\+o history|setopt HIST_IGNORE_SPACE|PROMPT_COMMAND=.*__cssh)";' +
  'if [ -n "${HISTFILE-}" ] && [ -f "$HISTFILE" ]; then' +
  ' __cssh_t="${HISTFILE}.cssh.$$";' +
  ' grep -vE "$__cssh_re" "$HISTFILE" > "$__cssh_t" 2>/dev/null' +
  ' && mv -f "$__cssh_t" "$HISTFILE" 2>/dev/null' +
  ' || rm -f "$__cssh_t" 2>/dev/null;' +
  'fi;' +
  // Zsh first (history -c is bash-only), then bash reload last so HISTSIZE=0
  // does not wipe a freshly restored bash list.
  'HISTSIZE=0 2>/dev/null;' +
  'HISTSIZE=${SAVEHIST:-1000} 2>/dev/null;' +
  'fc -R 2>/dev/null || true;' +
  'history -c 2>/dev/null || true;' +
  'history -r 2>/dev/null || true;' +
  'unset __cssh_re __cssh_t;' +
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
  // Leading space + history must already be off (see primeSession).
  // `__cssh_boot` marks the line so scrub can find leftovers if recording failed.
  return [
    ' : __cssh_boot',
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
    batch.aborts.get(fileKey)?.()
    return true
  }

  connect(
    sessionId: string,
    payload: ConnectPayload,
  ): Promise<{ shellId: string | null; protocol: ConnectionProtocol }> {
    // Replacing a session is intentional — do not treat as a network drop.
    this.disconnect(sessionId, 'user')

    return new Promise((resolve, reject) => {
      const theme: AppTheme = payload.theme === 'light' ? 'light' : 'dark'
      if (payload.port === 21) {
        const ftp = new FtpClient()
        ftp.ftp.verbose = false
        const client = new Client()
        const session: Session = {
          client,
          shells: new Map(),
          sftp: null,
          ftp,
          ftpConfig: {
            host: payload.host,
            port: payload.port,
            username: payload.username,
            password: payload.password ?? '',
          },
          cwd: '/',
          theme,
          protocol: 'ftp',
          closed: false,
          disconnectReason: 'drop',
        }
        this.sessions.set(sessionId, session)

        ;(async () => {
          try {
            if (payload.authMethod !== 'password') {
              throw new Error('FTP requires password authentication')
            }
            await ftp.access({
              host: payload.host,
              port: payload.port,
              user: payload.username,
              password: payload.password ?? '',
            })
            this.send(sessionId, 'ssh:status', { status: 'connected' })
            resolve({ shellId: null, protocol: 'ftp' })
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err))
            this.finishSession(sessionId, {
              status: 'error',
              message: error.message,
            })
            try {
              ftp.close()
            } catch {
              // ignore
            }
            reject(error)
          }
        })()
        return
      }

      let ptyProbeInProgress = false
      let settled = false
      const client = new Client()
      const session: Session = {
        client,
        shells: new Map(),
        sftp: null,
        ftp: null,
        ftpConfig: null,
        cwd: '/',
        theme,
        protocol: 'sftp',
        closed: false,
        disconnectReason: 'drop',
      }
      this.sessions.set(sessionId, session)

      const abortConnect = () => {
        if (settled) return
        settled = true
        if (timeoutId) clearTimeout(timeoutId)
        reject(new ConnectCancelledError())
      }
      session.connectAbort = abortConnect

      const clearAndMarkSettled = () => {
        settled = true
        if (timeoutId) clearTimeout(timeoutId)
        session.connectAbort = undefined
      }

      let timeoutId: NodeJS.Timeout | undefined

      ;(
        client as unknown as {
          on: (
            event: string,
            listener: (...args: unknown[]) => void,
          ) => Client
        }
      ).on(
        'keyboard-interactive',
        (...args: unknown[]) => {
          const prompts = (args[3] as Array<{ prompt: string; echo: boolean }>) ?? []
          const finish =
            (args[4] as ((responses: string[]) => void) | undefined) ??
            (() => undefined)
          if (payload.authMethod !== 'password') {
            finish([])
            return
          }
          const pass = payload.password ?? ''
          // Some SFTP providers authenticate via keyboard-interactive
          // while still asking for a single password prompt.
          finish(prompts.map(() => pass))
        },
      )

      client
        .on('ready', () => {
          if (settled) return
          if (timeoutId) clearTimeout(timeoutId)
          ;(async () => {
            try {
              const withTimeout = <T,>(
                p: Promise<T>,
                ms: number,
                timeoutMessage: string,
              ): Promise<T> =>
                new Promise((resolve, reject) => {
                  const t = setTimeout(() => {
                    reject(new Error(timeoutMessage))
                  }, ms)
                  p.then(
                    (value) => {
                      clearTimeout(t)
                      resolve(value)
                    },
                    (err) => {
                      clearTimeout(t)
                      reject(err)
                    },
                  )
                })

              const result = await this.finalizeConnection(
                sessionId,
                session,
                payload,
                theme,
                { get: () => ptyProbeInProgress, set: (v) => { ptyProbeInProgress = v } },
                withTimeout,
              )

              if (session.closed || settled) return

              session.protocol = result.protocol
              this.send(sessionId, 'ssh:status', { status: 'connected' })
              clearAndMarkSettled()
              resolve(result)
            } catch (err) {
              if (session.closed || settled) return
              const error = err instanceof Error ? err : new Error(String(err))
              clearAndMarkSettled()
              this.finishSession(sessionId, {
                status: 'error',
                message: error.message,
              })
              reject(error)
            }
          })()
        })
        .on('error', (err) => {
          if (settled) return
          // When PTY is denied, `ssh2` may emit an error even though the
          // underlying connection for SFTP might still be fine.
          if (
            ptyProbeInProgress &&
            /pseudo-terminal|ECONNRESET/i.test(err?.message ?? '')
          ) {
            return
          }
          clearAndMarkSettled()
          this.finishSession(sessionId, {
            status: 'error',
            message: err.message,
            reason: session.disconnectReason,
          })
          reject(err)
        })
        .on('close', () => {
          if (settled) return
          clearAndMarkSettled()
          const message = 'Connection closed by remote host'
          this.finishSession(sessionId, {
            status: 'error',
            message,
            reason: session.disconnectReason,
          })
          reject(new Error(message))
        })
        .on('end', () => {
          if (settled) return
          clearAndMarkSettled()
          const message = 'Connection closed by remote host'
          this.finishSession(sessionId, {
            status: 'error',
            message,
            reason: session.disconnectReason,
          })
          reject(new Error(message))
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
        config.tryKeyboard = true
        config.preferredAuthentications = ['password', 'keyboard-interactive']
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

      // Safety net: avoid "connecting forever" if ssh2 neither emits
      // `ready` nor `error` for some reason.
      timeoutId = setTimeout(() => {
        if (settled) return
        settled = true
        session.connectAbort = undefined
        this.finishSession(sessionId, {
          status: 'error',
          message: 'Connection timed out',
          reason: session.disconnectReason,
        })
        try {
          client.end()
        } catch {
          // ignore
        }
        reject(new Error('Connection timed out'))
      }, 45_000)
      client.connect(config as Parameters<Client['connect']>[0])
    })
  }

  /**
   * After SSH `ready`: open SFTP/shell channels and pick protocol.
   * Uses protocolHint to skip slow probes on repeat connects.
   */
  private async finalizeConnection(
    sessionId: string,
    session: Session,
    payload: ConnectPayload,
    theme: AppTheme,
    ptyProbe: { get: () => boolean; set: (value: boolean) => void },
    withTimeout: <T>(
      p: Promise<T>,
      ms: number,
      timeoutMessage: string,
    ) => Promise<T>,
  ): Promise<{ shellId: string | null; protocol: ConnectionProtocol }> {
    const hint = payload.protocolHint
    const shellSize = {
      cols: payload.cols ?? 120,
      rows: payload.rows ?? 30,
    }

    const openSftp = async (): Promise<boolean> => {
      try {
        await withTimeout(
          this.getSftp(session),
          8000,
          'Failed to open SFTP channel',
        )
        return true
      } catch {
        session.sftp = null
        return false
      }
    }

    const openPrimaryShell = async (): Promise<string> => {
      ptyProbe.set(true)
      try {
        return await withTimeout(
          this.spawnShell(sessionId, {
            ...shellSize,
            theme,
            primary: true,
          }),
          8000,
          'Failed to open shell',
        )
      } finally {
        ptyProbe.set(false)
      }
    }

    // Fast path: workspace already knows this host is SFTP-only.
    if (hint === 'sftp') {
      const sftpOk = await openSftp()
      if (!sftpOk) {
        throw new Error('Failed to open SFTP channel')
      }
      return { shellId: null, protocol: 'sftp' }
    }

    // Fast path: skip throwaway shell probe; open the real shell directly.
    if (hint === 'ssh') {
      try {
        const shellId = await openPrimaryShell()
        void openSftp()
        return { shellId, protocol: 'ssh' }
      } catch {
        const sftpOk = await openSftp()
        if (!sftpOk) {
          throw new Error('Neither SSH shell nor SFTP channel is available')
        }
        return { shellId: null, protocol: 'sftp' }
      }
    }

    // Unknown protocol: open SFTP first, then probe shell (sequential — some
    // SFTP-only hosts reset the socket when shell is opened in parallel).
    const sftpOk = await openSftp()
    const shellAllowed = await this.probeShell(sessionId, theme)

    if (shellAllowed) {
      try {
        const shellId = await openPrimaryShell()
        return { shellId, protocol: 'ssh' }
      } catch {
        if (!sftpOk) {
          throw new Error('Neither SSH shell nor SFTP channel is available')
        }
        return { shellId: null, protocol: 'sftp' }
      }
    }

    if (!sftpOk) {
      throw new Error('Neither SSH shell nor SFTP channel is available')
    }
    return { shellId: null, protocol: 'sftp' }
  }

  /**
   * Probe whether the remote allows opening an interactive shell.
   * We do not prime/execute anything here, so it won't create remote
   * history noise.
   */
  private probeShell(sessionId: string, theme: AppTheme): Promise<boolean> {
    const session = this.sessions.get(sessionId)
    if (!session || session.closed) return Promise.resolve(false)

    return new Promise((resolve) => {
      let done = false
      const finish = (value: boolean) => {
        if (done) return
        done = true
        resolve(value)
      }

      session.client.shell(
        { term: 'xterm-256color', cols: 40, rows: 5 },
        { env: colorEnv(theme) },
        (err, stream) => {
          if (err || !stream) {
            finish(false)
            return
          }
          try {
            stream.close()
          } catch {
            // ignore
          }
          finish(true)
        },
      )

      // Shell open can be slow on some shared hosts or when auth completes late.
      // If we timeout too early, we incorrectly classify the server as SFTP-only.
      setTimeout(() => finish(false), 6500)
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
    void this.applyThemeQuiet(sessionId, theme, shellId)
  }

  private async applyThemeQuiet(
    sessionId: string,
    theme: AppTheme,
    shellId?: string,
  ) {
    const session = this.sessions.get(sessionId)
    if (!session) return
    const next = theme === 'light' ? 'light' : 'dark'
    session.theme = next
    const targets = shellId
      ? [session.shells.get(shellId)].filter(Boolean)
      : Array.from(session.shells.values())
    const colors = shellQuote(lsColorsForTheme(next))

    for (const shell of targets) {
      if (!shell?.inputEnabled) continue
      if (shell.theme === next) continue

      shell.outputEnabled = false
      try {
        shell.stream.write(UNIX_HISTORY_OFF)
        await this.waitForPrompt(shell.stream, 350)
        shell.stream.write(
          ` : __cssh_boot; export LS_COLORS=${colors}; stty echo 2>/dev/null\n`,
        )
        await this.waitForPrompt(shell.stream, 350)
        shell.stream.write('printf "\\033c"\n')
        await delay(40)
        shell.theme = next
      } catch {
        // ignore — shell may have closed
      } finally {
        shell.outputEnabled = true
      }
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
    session.connectAbort?.()
    session.connectAbort = undefined
    try {
      session.sftp?.end()
      try {
        session.ftp?.close()
      } catch {
        // ignore
      }
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
            const cleaned = stripBootstrapNoise(
              stripAndCaptureCwd(data.toString('utf8'), session),
            )
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

  /** Round-trip latency via a lightweight remote check. */
  async ping(sessionId: string): Promise<number> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')

    const started = Date.now()

    if (session.protocol === 'ftp') {
      await this.getFtp(session)
      return Math.max(1, Date.now() - started)
    }

    if (session.protocol === 'sftp') {
      return this.sftpPing(session, started)
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Ping timeout'))
      }, 8000)

      session.client.exec('true', (err, stream) => {
        if (err || !stream) {
          clearTimeout(timeout)
          const message = err instanceof Error ? err.message : String(err ?? '')
          if (/unable to exec/i.test(message)) {
            void this.sftpPing(session, started).then(resolve, reject)
            return
          }
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
    if (session.protocol === 'ftp') {
      const ftp = await this.getFtp(session)
      session.cwd = await ftp.pwd().catch(() => '/')
      return session.cwd
    }
    if (session.protocol === 'sftp') {
      session.cwd = await this.sftpGetCwd(session)
      return session.cwd
    }

    session.cwd = await this.execPwd(session)
    return session.cwd
  }

  async listDir(sessionId: string, remotePath: string): Promise<RemoteFsEntry[]> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')

    if (session.protocol === 'ftp') {
      const ftp = await this.getFtp(session)
      const target = remotePath || '/'
      const list = await ftp.list(target)
      return list
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
        .sort((a, b) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
          return a.name.localeCompare(b.name)
        })
    }

    const target = remotePath || '/'
    return this.withSftp(session, (sftp) =>
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
              const isDir = (item.attrs.mode & 0o170000) === 0o040000
              return {
                name: item.filename,
                path: joinRemote(target, item.filename),
                isDir,
                size: isDir ? undefined : item.attrs.size,
              } satisfies RemoteFsEntry
            })
            .sort((a, b) => {
              if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
              return a.name.localeCompare(b.name)
            })
          resolve(entries)
        })
      }),
    )
  }

  async readFile(
    sessionId: string,
    remotePath: string,
    maxBytes = 5 * 1024 * 1024,
  ): Promise<{ content: string; size: number }> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')

    if (session.protocol === 'ftp') {
      const ftp = await this.getFtp(session)
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

  async remoteFileSize(sessionId: string, remotePath: string): Promise<number> {
    const stats = await this.statRemote(sessionId, remotePath)
    return stats.size
  }

  /** Read a remote file as base64 (images and other binary). */
  async readBinaryFile(
    sessionId: string,
    remotePath: string,
    maxBytes = 25 * 1024 * 1024,
  ): Promise<{ base64: string; size: number; mimeType: string }> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')

    const mimeType = mimeTypeForImagePath(remotePath)

    if (session.protocol === 'ftp') {
      const ftp = await this.getFtp(session)
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
              `File is too large to preview (${Math.ceil(stats.size / 1024 / 1024)} MB)`,
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
          resolve({
            base64: buf.toString('base64'),
            size: buf.length,
            mimeType,
          })
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

    if (session.protocol === 'ftp') {
      const ftp = await this.getFtp(session)
      // Ensure parent directories exist.
      const parent =
        remotePath.includes('/')
          ? remotePath.slice(0, remotePath.lastIndexOf('/')) || '/'
          : '/'
      if (parent && parent !== '/') {
        await ftp.ensureDir(parent)
      }
      const stream = Readable.from([content])
      await ftp.uploadFrom(stream, remotePath)
      return
    }

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

    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')

    if (session.protocol === 'ftp') {
      await new Promise<void>(async (resolve, reject) => {
        let cancelled = false
        let ftp: FtpClient | null = null

        const cleanup = () => {
          try {
            ftp?.trackProgress()
          } catch {
            // ignore
          }
        }

        try {
          ftp = await this.getFtp(session)

          const total = await ftp
            .size(remotePath)
            .catch(() => 0 /* dir or unknown size */)

          let transferred = 0
          ftp.trackProgress((info) => {
            if (control?.isCancelled()) {
              cancelled = true
              try {
                ftp?.close()
              } catch {
                // ignore
              }
              session.ftp = null
              return
            }
            // `info.bytes` is the bytes transferred in the current transfer.
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
            session.ftp = null
          })

          throwIfCancelled()
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
      return
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
    const stats = await this.statRemote(sessionId, remotePath)
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
    const nested = await mapPool(items, COLLECT_CONCURRENCY, (item) =>
      this.collectDownloadJobs(sessionId, item.remotePath, item.localPath),
    )
    const jobs = nested.flat()
    return this.runDownloadJobs(sessionId, jobs, onProgress)
  }

  private async runDownloadJobs(
    sessionId: string,
    jobs: Array<{ remotePath: string; localPath: string; size: number }>,
    onProgress?: (progress: TransferProgress) => void,
    existingTransferId?: string,
  ): Promise<{ saved: number; cancelled: number }> {
    return this.runTransferJobs(
      sessionId,
      jobs,
      onProgress,
      existingTransferId,
      async (job, key, batch, onBytes, control) => {
        const parent = path.dirname(job.localPath)
        if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true })
        await this.downloadFile(
          sessionId,
          job.remotePath,
          job.localPath,
          onBytes,
          control,
        )
      },
      (job) => {
        this.cleanupLocalPart(job.localPath)
      },
    )
  }

  private async runTransferJobs(
    sessionId: string,
    jobs: Array<{ remotePath: string; localPath: string; size: number }>,
    onProgress: ((progress: TransferProgress) => void) | undefined,
    existingTransferId: string | undefined,
    transferFile: (
      job: { remotePath: string; localPath: string; size: number },
      key: string,
      batch: ActiveTransfer,
      onBytes: (transferred: number, total: number) => void,
      control: {
        key: string
        isCancelled: () => boolean
        registerAbort: (abort: () => void) => void
        clearAbort: () => void
      },
    ) => Promise<void>,
    cleanupFailed: (job: {
      remotePath: string
      localPath: string
      size: number
    }) => void | Promise<void>,
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
      aborts: new Map(),
      files,
    }
    this.transfers.set(transferId, batch)

    const filesTotal = jobs.length
    const totalBytes = jobs.reduce((sum, job) => sum + Math.max(job.size, 1), 0)
    const fileProgress = new Map<string, number>()
    let lastActivePath: string | undefined

    const countFiles = () => ({
      done: files.filter((item) => item.status === 'done').length,
      cancelled: files.filter(
        (item) => item.status === 'cancelled' || item.status === 'error',
      ).length,
    })

    const completedBytes = () => {
      let sum = 0
      for (let i = 0; i < jobs.length; i += 1) {
        const status = files[i].status
        if (
          status === 'done' ||
          status === 'cancelled' ||
          status === 'error'
        ) {
          sum += Math.max(jobs[i].size, 1)
        }
      }
      return sum
    }

    const progress = createThrottledProgressEmitter(onProgress, () => {
      let activeBytes = 0
      for (const bytes of fileProgress.values()) {
        activeBytes += bytes
      }
      const overall = Math.min(totalBytes, completedBytes() + activeBytes)
      const { done, cancelled } = countFiles()
      return {
        transferId,
        percent:
          totalBytes > 0 ? Math.min(100, (overall / totalBytes) * 100) : 0,
        transferred: overall,
        total: totalBytes,
        currentPath: lastActivePath,
        filesDone: done,
        filesTotal,
        filesCancelled: cancelled,
        files: files.map((item) => ({ ...item })),
      }
    })

    const processJob = async (index: number): Promise<void> => {
      const job = jobs[index]
      const key = files[index].key

      if (batch.cancelled.has(key) || files[index].status === 'cancelled') {
        files[index].status = 'cancelled'
        progress.emit(true)
        return
      }

      files[index].status = 'active'
      batch.currentKey = key
      lastActivePath = job.remotePath
      fileProgress.set(key, 0)
      progress.emit(true)

      try {
        await transferFile(
          job,
          key,
          batch,
          (fileTransferred, fileTotal) => {
            fileProgress.set(
              key,
              Math.min(fileTransferred, fileTotal || job.size),
            )
            lastActivePath = job.remotePath
            progress.emit()
          },
          {
            key,
            isCancelled: () => batch.cancelled.has(key),
            registerAbort: (abort) => {
              batch.abortCurrent = abort
              batch.aborts.set(key, abort)
            },
            clearAbort: () => {
              batch.aborts.delete(key)
              if (batch.currentKey === key) {
                batch.currentKey = null
                batch.abortCurrent = null
              }
            },
          },
        )
        files[index].status = 'done'
      } catch (err) {
        if (isTransferCancelledError(err)) {
          files[index].status = 'cancelled'
          await cleanupFailed(job)
        } else {
          const message =
            err instanceof Error ? err.message : String(err ?? 'Transfer failed')
          files[index].status = 'error'
          files[index].error = message
          await cleanupFailed(job)
        }
      } finally {
        fileProgress.delete(key)
        progress.emit(true)
      }
    }

    try {
      progress.emit(true)
      await mapPool(
        jobs.map((_, index) => index),
        TRANSFER_CONCURRENCY,
        processJob,
      )
      progress.flush()
      const { done, cancelled } = countFiles()
      return { saved: done, cancelled }
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
    const stats = await this.statRemote(sessionId, remotePath)
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
    const nested = await mapPool(entries, COLLECT_CONCURRENCY, (entry) =>
      this.collectDownloadJobs(
        sessionId,
        entry.path,
        path.join(localPath, entry.name),
      ),
    )
    return nested.flat()
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

    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')
    if (session.protocol === 'ftp') {
      await new Promise<void>(async (resolve, reject) => {
        let cancelled = false
        let ftp: FtpClient | null = null

        const cleanup = () => {
          try {
            ftp?.trackProgress()
          } catch {
            // ignore
          }
        }

        try {
          throwIfCancelled()
          ftp = await this.getFtp(session)

          const total = fs.statSync(localPath).size
          const parent =
            remotePath.includes('/')
              ? remotePath.slice(0, remotePath.lastIndexOf('/')) || '/'
              : '/'

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
              session.ftp = null
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
            session.ftp = null
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
      return
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
    if (session.protocol === 'ftp') {
      const ftp = await this.getFtp(session)
      await ftp.ensureDir(remotePath)
    } else {
      const sftp = await this.getSftp(session)
      await this.mkdirp(sftp, remotePath)
    }
  }

  async rename(
    sessionId: string,
    fromPath: string,
    toPath: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('Session not found')

    if (session.protocol === 'ftp') {
      const ftp = await this.getFtp(session)
      await ftp.rename(fromPath, toPath)
      return
    }

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
    if (session.protocol === 'ftp') {
      const ftp = await this.getFtp(session)
      const stats = await this.statRemote(sessionId, remotePath)
      const isDir = (stats.mode & 0o170000) === 0o040000
      if (isDir) {
        await ftp.removeDir(remotePath)
        return 1
      }
      await ftp.remove(remotePath)
      return 1
    }

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
    const nested = await mapPool(localPaths, COLLECT_CONCURRENCY, (localPath) =>
      this.collectUploadJobs(sessionId, localPath, remoteDir),
    )
    const jobs = nested.flat()

    return this.runTransferJobs(
      sessionId,
      jobs,
      onProgress,
      undefined,
      async (job, _key, _batch, onBytes, control) => {
        await this.uploadFile(
          sessionId,
          job.localPath,
          job.remotePath,
          onBytes,
          control,
        )
      },
      (job) => this.cleanupRemotePart(sessionId, job.remotePath),
    )
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
    if (session.protocol === 'ftp') {
      const ftp = await this.getFtp(session)
      await ftp.ensureDir(remotePath)
    } else {
      const sftp = await this.getSftp(session)
      await this.mkdirp(sftp, remotePath)
    }

    const names = fs.readdirSync(localPath).filter(
      (name) => !isTransferPartName(name),
    )
    const nested = await mapPool(names, COLLECT_CONCURRENCY, (name) =>
      this.collectUploadJobs(
        sessionId,
        path.join(localPath, name),
        remotePath,
      ),
    )
    return nested.flat()
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

  private async statRemote(
    sessionId: string,
    remotePath: string,
  ): Promise<{ mode: number; size: number }> {
    const session = this.sessions.get(sessionId)
    if (!session || session.closed) throw new Error('Session not found')

    if (session.protocol !== 'ftp') {
      const sftp = await this.getSftp(session)
      return this.statPath(sftp, remotePath)
    }

    const ftp = await this.getFtp(session)
    if (!remotePath || remotePath === '/') {
      return { mode: 0o040000, size: 0 }
    }

    const name = remotePath.split('/').filter(Boolean).at(-1) ?? remotePath
    const parent =
      remotePath.includes('/')
        ? remotePath.slice(0, remotePath.lastIndexOf('/')) || '/'
        : '/'

    const list = await ftp.list(parent)
    const match = list.find((item) => item.name === name)
    if (!match) throw new Error('Failed to stat path')

    if (match.isDirectory) return { mode: 0o040000, size: 0 }
    return { mode: 0o100000, size: match.size ?? 0 }
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

  private isSftpStaleError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err ?? '')
    return /no response from server|sftp.*closed|failed to open sftp/i.test(
      message,
    )
  }

  private sftpPing(session: Session, started: number): Promise<number> {
    return this.withSftp(session, (sftp) =>
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

  private sftpGetCwd(session: Session): Promise<string> {
    return this.withSftp(session, (sftp) =>
      new Promise((resolve, reject) => {
        sftp.realpath('.', (err, absPath) => {
          if (err) reject(err)
          else resolve(absPath || '/')
        })
      }),
    )
  }

  private async withSftp<T>(
    session: Session,
    fn: (sftp: SFTPWrapper) => Promise<T>,
  ): Promise<T> {
    try {
      const sftp = await this.getSftp(session)
      return await fn(sftp)
    } catch (err) {
      if (!this.isSftpStaleError(err)) throw err
      session.sftp = null
      const sftp = await this.getSftp(session)
      return fn(sftp)
    }
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

  private async getFtp(session: Session): Promise<FtpClient> {
    if (session.ftp && !session.ftp.closed) return session.ftp
    if (!session.ftpConfig) {
      throw new Error('FTP config is missing for this session')
    }

    const ftp = new FtpClient()
    ftp.ftp.verbose = false
    await ftp.access({
      host: session.ftpConfig.host,
      port: session.ftpConfig.port,
      user: session.ftpConfig.username,
      password: session.ftpConfig.password,
    })

    session.ftp = ftp
    return ftp
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
    const preview = await this.waitForPrompt(stream, 600)
    const isPS = isPowerShellBanner(preview)

    if (isPS) {
      stream.write(colorBootstrap(true, theme))
      await delay(200)
      stream.write(' Clear-Host\n')
    } else {
      stream.write(UNIX_HISTORY_OFF)
      await this.waitForPrompt(stream, 300)
      stream.write(`${colorBootstrap(false, theme)}\n`)
      await this.waitForPrompt(stream, 400)
      stream.write(UNIX_HISTORY_SCRUB_ON)
    }
    await this.waitForPrompt(stream, 700)
    await delay(60)
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
