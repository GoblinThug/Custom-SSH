import type { BrowserWindow } from 'electron'
import { SshManager } from './ssh-manager'

/** Shared main-process mutable state (single source of truth). */
export let mainWindow: BrowserWindow | null = null

export let isQuitting = false

export const ssh = new SshManager(() => mainWindow)

export function setMainWindow(win: BrowserWindow | null) {
  mainWindow = win
}

export function setIsQuitting(value: boolean) {
  isQuitting = value
}
