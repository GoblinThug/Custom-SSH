/// <reference types="vite/client" />

import type { SshApi } from '../electron/preload'

declare global {
  interface Window {
    sshApi: SshApi
  }
}

export {}
