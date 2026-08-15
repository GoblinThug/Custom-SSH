import type { BrowserWindow } from 'electron'

/** Soft opacity tween — cheap on Windows vs per-frame setBounds. */
export function fadeOpacity(
  win: BrowserWindow,
  from: number,
  to: number,
  durationMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    if (win.isDestroyed()) {
      resolve()
      return
    }
    if (durationMs <= 0) {
      win.setOpacity(to)
      resolve()
      return
    }

    const start = Date.now()
    win.setOpacity(from)

    const tick = () => {
      if (win.isDestroyed()) {
        resolve()
        return
      }
      const t = Math.min(1, (Date.now() - start) / durationMs)
      // smoothstep — soft in/out without looking mechanical
      const e = t * t * (3 - 2 * t)
      win.setOpacity(from + (to - from) * e)
      if (t < 1) {
        setTimeout(tick, 16)
      } else {
        win.setOpacity(to)
        resolve()
      }
    }
    tick()
  })
}
