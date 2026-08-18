import { useEffect, useState, type RefObject } from 'react'

const PING_INTERVAL_MS = 3000

const DISCONNECTED_RE =
  /connection (lost|closed|reset)|no response|session not found|not connected|ping timeout|econnreset|socket hang up|unable to exec|failed to open sftp/i

export type PingSessionRuntime = {
  pingFail: number
  wantConnected: boolean
  autoReconnect: boolean
}

type Options<T extends PingSessionRuntime = PingSessionRuntime> = {
  sessionId: string | null | undefined
  connected: boolean
  sessionsRef: RefObject<Map<string, T>>
}

/** Poll SSH latency for the active session; triggers disconnect after repeated failures. */
export function useConnectionPing<T extends PingSessionRuntime>({
  sessionId,
  connected,
  sessionsRef,
}: Options<T>): number | null {
  const [pingMs, setPingMs] = useState<number | null>(null)

  useEffect(() => {
    if (!sessionId || !connected) {
      setPingMs(null)
      return
    }

    const runtime = sessionsRef.current?.get(sessionId)
    if (!runtime) {
      setPingMs(null)
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const handlePingFailure = (current: PingSessionRuntime) => {
      if (cancelled) return
      setPingMs(null)
      current.pingFail += 1
      if (
        current.pingFail >= 2 &&
        current.wantConnected &&
        current.autoReconnect
      ) {
        current.pingFail = 0
        window.sshApi.disconnect(sessionId, 'drop')
      }
    }

    const tick = async () => {
      const current = sessionsRef.current?.get(sessionId)
      if (!current) return
      try {
        const ms = await window.sshApi.ping(sessionId)
        if (cancelled) return
        if (ms == null) {
          handlePingFailure(current)
          return
        }
        current.pingFail = 0
        setPingMs(ms)
      } catch (err) {
        if (cancelled) return
        setPingMs(null)
        const message = err instanceof Error ? err.message : String(err ?? '')
        if (!DISCONNECTED_RE.test(message)) return
        handlePingFailure(current)
      }
      if (!cancelled) {
        timer = setTimeout(() => {
          void tick()
        }, PING_INTERVAL_MS)
      }
    }

    void tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [sessionId, connected, sessionsRef])

  return pingMs
}
