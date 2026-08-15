import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import {
  APP_LOCALE_IDS,
  HOTKEY_IDS,
  defaultHotkeys,
  type AppLocale,
  type AppSettings,
  type AppTheme,
  type HotkeyId,
  type HotkeysSettings,
  type KeyBinding,
} from './types'

const FILE_NAME = 'settings.json'

const DEFAULTS: AppSettings = {
  locale: 'ru',
  theme: 'dark',
  hotkeys: defaultHotkeys(),
  skippedUpdateVersion: null,
}

function settingsPath() {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function isLocale(value: unknown): value is AppLocale {
  return (
    typeof value === 'string' &&
    (APP_LOCALE_IDS as readonly string[]).includes(value)
  )
}

function isTheme(value: unknown): value is AppTheme {
  return value === 'dark' || value === 'light'
}

function normalizeBinding(
  raw: Partial<KeyBinding> | null | undefined,
  fallback: KeyBinding,
): KeyBinding {
  if (!raw || typeof raw !== 'object') return { ...fallback }
  const code = typeof raw.code === 'string' && raw.code ? raw.code : fallback.code
  return {
    code,
    ctrl: typeof raw.ctrl === 'boolean' ? raw.ctrl : fallback.ctrl,
    shift: typeof raw.shift === 'boolean' ? raw.shift : fallback.shift,
    alt: typeof raw.alt === 'boolean' ? raw.alt : fallback.alt,
    meta: typeof raw.meta === 'boolean' ? raw.meta : fallback.meta,
  }
}

function normalizeHotkeys(raw: unknown): HotkeysSettings {
  const defaults = defaultHotkeys()
  const source =
    raw && typeof raw === 'object' ? (raw as Partial<Record<HotkeyId, KeyBinding>>) : {}
  const next = { ...defaults }
  for (const id of HOTKEY_IDS) {
    next[id] = normalizeBinding(source[id], defaults[id])
  }
  return next
}

function normalizeVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/^v/i, '')
  return trimmed || null
}

function normalize(raw: Partial<AppSettings> | null | undefined): AppSettings {
  return {
    locale: isLocale(raw?.locale) ? raw.locale : DEFAULTS.locale,
    theme: isTheme(raw?.theme) ? raw.theme : DEFAULTS.theme,
    hotkeys: normalizeHotkeys(raw?.hotkeys),
    skippedUpdateVersion: normalizeVersion(raw?.skippedUpdateVersion),
  }
}

export function loadSettings(): AppSettings {
  const file = settingsPath()
  const dir = path.dirname(file)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  if (!fs.existsSync(file)) {
    const settings = normalize(DEFAULTS)
    fs.writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8')
    return settings
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<AppSettings>
    return normalize(parsed)
  } catch {
    return normalize(DEFAULTS)
  }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const current = loadSettings()
  const next = normalize({
    ...current,
    ...patch,
    hotkeys: patch.hotkeys
      ? { ...current.hotkeys, ...patch.hotkeys }
      : current.hotkeys,
  })
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8')
  return next
}
