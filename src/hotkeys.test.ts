import { describe, expect, it } from 'vitest'
import {
  bindingsEqual,
  findHotkeyConflict,
  formatBinding,
  isDefaultBinding,
} from './hotkeys'
import { defaultHotkeys, type KeyBinding } from './types'

const ctrlC: KeyBinding = {
  code: 'KeyC',
  ctrl: true,
  shift: false,
  alt: false,
  meta: false,
}

describe('hotkeys', () => {
  it('bindingsEqual compares modifiers', () => {
    expect(bindingsEqual(ctrlC, { ...ctrlC })).toBe(true)
    expect(bindingsEqual(ctrlC, { ...ctrlC, shift: true })).toBe(false)
  })

  it('findHotkeyConflict detects reused bindings', () => {
    const hotkeys = defaultHotkeys()
    const conflict = findHotkeyConflict(hotkeys, 'interrupt', hotkeys.copy)
    expect(conflict).toBe('copy')
    expect(findHotkeyConflict(hotkeys, 'copy', hotkeys.copy)).toBeNull()
  })

  it('isDefaultBinding', () => {
    const hotkeys = defaultHotkeys()
    expect(isDefaultBinding('copy', hotkeys.copy)).toBe(true)
    expect(isDefaultBinding('copy', { ...hotkeys.copy, code: 'KeyX' })).toBe(false)
  })

  it('formatBinding shows Ctrl or ⌘', () => {
    const label = formatBinding(ctrlC)
    expect(label === 'Ctrl + C' || label === '⌘ + C').toBe(true)
  })
})
