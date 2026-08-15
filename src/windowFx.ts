/** Applies lightweight CSS motion cues driven by the main process. */
export function bindWindowFx() {
  return window.sshApi.onWindowFx((payload) => {
    const root = document.documentElement
    root.classList.remove(
      'fx-enter',
      'fx-minimize',
      'fx-restore',
      'fx-fullscreen-enter',
      'fx-fullscreen-exit',
    )
    // Force reflow so repeated animations restart cleanly.
    void root.offsetWidth
    root.classList.add(`fx-${payload.type}`)
  })
}
