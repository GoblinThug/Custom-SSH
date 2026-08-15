import type { HotkeyId, HotkeysSettings, KeyBinding } from './types'
import { HOTKEY_IDS, defaultHotkeys } from './types'

export function bindingsEqual(a: KeyBinding, b: KeyBinding): boolean {
  return (
    a.code === b.code &&
    !!a.ctrl === !!b.ctrl &&
    !!a.shift === !!b.shift &&
    !!a.alt === !!b.alt &&
    !!a.meta === !!b.meta
  )
}

export function matchBinding(ev: KeyboardEvent, binding: KeyBinding): boolean {
  if (ev.code !== binding.code) return false
  if (!!ev.shiftKey !== !!binding.shift) return false
  if (!!ev.altKey !== !!binding.alt) return false

  // Ctrl and Meta are interchangeable for app shortcuts (Win Ctrl / macOS Cmd)
  const wantMod = !!binding.ctrl || !!binding.meta
  const hasMod = !!ev.ctrlKey || !!ev.metaKey
  if (wantMod !== hasMod) return false
  if (binding.ctrl && binding.meta) {
    return !!ev.ctrlKey && !!ev.metaKey
  }
  return true
}

export function bindingFromEvent(ev: KeyboardEvent): KeyBinding | null {
  const { code } = ev
  if (
    code === 'ControlLeft' ||
    code === 'ControlRight' ||
    code === 'ShiftLeft' ||
    code === 'ShiftRight' ||
    code === 'AltLeft' ||
    code === 'AltRight' ||
    code === 'MetaLeft' ||
    code === 'MetaRight' ||
    code === 'CapsLock' ||
    code === 'Escape' ||
    code === 'Tab'
  ) {
    return null
  }

  return {
    code,
    ctrl: ev.ctrlKey,
    shift: ev.shiftKey,
    alt: ev.altKey,
    meta: ev.metaKey,
  }
}

function codeLabel(code: string): string {
  if (code.startsWith('Key') && code.length === 4) return code.slice(3)
  if (code.startsWith('Digit') && code.length === 6) return code.slice(5)
  if (code.startsWith('Numpad') && code.length > 6) return `Num${code.slice(6)}`
  const special: Record<string, string> = {
    Space: 'Space',
    Enter: 'Enter',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backquote: '`',
  }
  return special[code] ?? code
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent)
}

export function formatBinding(binding: KeyBinding): string {
  const parts: string[] = []
  const wantMod = !!binding.ctrl || !!binding.meta
  if (wantMod) {
    if (binding.ctrl && binding.meta) {
      parts.push('Ctrl', '⌘')
    } else {
      // Defaults store ctrl:true; show ⌘ on macOS and Ctrl on Windows/Linux.
      parts.push(isMacPlatform() ? '⌘' : 'Ctrl')
    }
  }
  if (binding.alt) parts.push(isMacPlatform() ? '⌥' : 'Alt')
  if (binding.shift) parts.push('Shift')
  parts.push(codeLabel(binding.code))
  return parts.join(' + ')
}

export function findHotkeyConflict(
  hotkeys: HotkeysSettings,
  id: HotkeyId,
  binding: KeyBinding,
): HotkeyId | null {
  for (const other of HOTKEY_IDS) {
    if (other === id) continue
    if (bindingsEqual(hotkeys[other], binding)) return other
  }
  return null
}

export function isDefaultBinding(id: HotkeyId, binding: KeyBinding): boolean {
  return bindingsEqual(defaultHotkeys()[id], binding)
}

export function letterFromCode(code: string): string | null {
  if (code.startsWith('Key') && code.length === 4) return code.slice(3)
  return null
}
