import type { MessageKey } from '../i18n/messages'

type Translate = (key: MessageKey) => string

/** Strip Electron IPC / nested Error wrappers from a thrown value. */
export function unwrapErrorMessage(err: unknown): string {
  let raw = ''
  if (err instanceof Error) raw = err.message
  else if (typeof err === 'string') raw = err
  else if (err == null) raw = ''
  else raw = String(err)

  const ipc = raw.match(
    /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?([\s\S]*)$/i,
  )
  if (ipc?.[1]) raw = ipc[1].trim()

  raw = raw.replace(/^(?:Error:\s*)+/i, '').trim()
  return raw
}

function errorCode(err: unknown): string {
  if (typeof err === 'object' && err && 'code' in err) {
    const code = (err as { code?: unknown }).code
    if (typeof code === 'string' || typeof code === 'number') {
      return String(code)
    }
  }
  return ''
}

const CODE_KEYS: Record<string, MessageKey> = {
  ECONNREFUSED: 'errConnectRefused',
  ETIMEDOUT: 'errConnectTimeout',
  ECONNRESET: 'errConnectionReset',
  ENOTFOUND: 'errHostNotFound',
  EAI_AGAIN: 'errHostNotFound',
  EHOSTUNREACH: 'errHostUnreachable',
  ENETUNREACH: 'errHostUnreachable',
  ENETDOWN: 'errHostUnreachable',
  EACCES: 'errPermissionDenied',
  EPERM: 'errPermissionDenied',
  ENOENT: 'errNotFound',
  EISDIR: 'errIsDirectory',
  ENOTDIR: 'errNotDirectory',
  ENOSPC: 'errNoSpace',
  EEXIST: 'errAlreadyExists',
}

/** More specific patterns first. */
const MESSAGE_RULES: Array<{ re: RegExp; key: MessageKey }> = [
  {
    re: /all configured authentication methods failed/i,
    key: 'errAuthFailed',
  },
  {
    re: /permission denied \(publickey|password|keyboard-interactive|hostbased\)/i,
    key: 'errAuthFailed',
  },
  {
    re: /authentication (failure|failed)|auth failed|invalid credentials/i,
    key: 'errAuthFailed',
  },
  {
    re: /encrypted private key|bad passphrase|integrity check failed|cannot decrypt|wrong passphrase/i,
    key: 'errPrivateKeyPassphrase',
  },
  {
    re: /cannot parse private[\s_-]?key|invalid private[\s_-]?key|unsupported key|no key found|malformed.*key/i,
    key: 'errPrivateKeyInvalid',
  },
  {
    re: /private key path is required/i,
    key: 'errPrivateKey',
  },
  {
    re: /host key verification failed|unable to verify.*host key|hostname\/ip does not match/i,
    key: 'errHostKey',
  },
  {
    re: /handshake (failed|timeout)|protocol mismatch|no matching (key exchange|host key|cipher|mac)/i,
    key: 'errHandshakeFailed',
  },
  {
    re: /timed?\s*out|timeout|readyTimeout/i,
    key: 'errConnectTimeout',
  },
  {
    re: /econnrefused|connection refused/i,
    key: 'errConnectRefused',
  },
  {
    re: /enotfound|getaddrinfo|no such host|dns/i,
    key: 'errHostNotFound',
  },
  {
    re: /ehostunreach|enetunreach|network is unreachable|no route to host|host is unreachable/i,
    key: 'errHostUnreachable',
  },
  {
    re: /econnreset|connection reset|socket hang up|unexpected socket close/i,
    key: 'errConnectionReset',
  },
  {
    re: /connection lost|broken pipe|channel closed|premature (eof|close)/i,
    key: 'errSessionLost',
  },
  {
    re: /session not found|session did not recover/i,
    key: 'errSessionNotFound',
  },
  {
    re: /failed to open shell|unable to open shell/i,
    key: 'errShellFailed',
  },
  {
    re: /ping (timeout|failed)/i,
    key: 'errPingFailed',
  },
  {
    re: /binary files cannot be edited/i,
    key: 'errBinaryFile',
  },
  {
    re: /path is a directory|eisdir|is a directory/i,
    key: 'errIsDirectory',
  },
  {
    re: /not a directory|enotdir/i,
    key: 'errNotDirectory',
  },
  {
    re: /no such file|enoent|not found/i,
    key: 'errNotFound',
  },
  {
    re: /permission denied|eacces|operation not permitted/i,
    key: 'errPermissionDenied',
  },
  {
    re: /no space|enospc|disk quota/i,
    key: 'errNoSpace',
  },
  {
    re: /file (already )?exists|eexist/i,
    key: 'errAlreadyExists',
  },
  {
    re: /not a customssh backup/i,
    key: 'errImportInvalidBackup',
  },
  {
    re: /invalid customssh workspace/i,
    key: 'errImportInvalidWorkspace',
  },
  {
    re: /invalid termius/i,
    key: 'errImportInvalidTermius',
  },
  {
    re: /passphrase required for password export/i,
    key: 'errExportPassphrase',
  },
  {
    re: /passphrase required/i,
    key: 'errImportPassphrase',
  },
  {
    re: /invalid encrypted secret/i,
    key: 'errEncryptedSecret',
  },
  {
    re: /missing partial download/i,
    key: 'errTransferResumeFailed',
  },
  {
    re: /failed to (list|stat|open sftp|pwd)/i,
    key: 'errFileOpFailed',
  },
]

/**
 * Map SSH / FS / IPC errors to a short localized string.
 * Unknown messages fall back to `fallback` (or cleaned raw text if none).
 */
export function formatAppError(
  err: unknown,
  t: Translate,
  fallback?: MessageKey,
): string {
  const code = errorCode(err).toUpperCase()
  if (code && CODE_KEYS[code]) {
    return t(CODE_KEYS[code])
  }

  const message = unwrapErrorMessage(err)
  if (message) {
    for (const rule of MESSAGE_RULES) {
      if (rule.re.test(message)) return t(rule.key)
    }
  }

  if (fallback) return t(fallback)
  if (message) return message
  return t('errUnknown')
}
