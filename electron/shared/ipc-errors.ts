export function isMissingRemote(err: unknown): boolean {
  const code =
    err && typeof err === 'object' && 'code' in err
      ? Number((err as { code?: unknown }).code)
      : NaN
  const message = err instanceof Error ? err.message : String(err ?? '')
  return code === 2 || /no such file/i.test(message)
}

export function isDisconnectedPingError(err: unknown): boolean {
  if (!err) return false
  const code =
    err && typeof err === 'object' && 'code' in err
      ? String((err as { code?: unknown }).code)
      : ''
  const message = err instanceof Error ? err.message : String(err)
  if (
    ['ECONNRESET', 'EPIPE', 'ENOTCONN', 'ECONNABORTED', 'ERR_SOCKET_CLOSED'].includes(
      code,
    )
  ) {
    return true
  }
  return /session not found|not connected|connection (lost|closed|reset)|ping timeout|no response|econnreset|socket hang up|unable to exec|failed to open sftp/i.test(
    message,
  )
}
