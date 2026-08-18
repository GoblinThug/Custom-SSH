import { describe, expect, it } from 'vitest'
import { reorderTabs, type TerminalTab } from './types'

function tab(key: string): TerminalTab {
  return {
    key,
    sessionId: 's',
    shellId: null,
    title: key,
    status: 'connected',
    label: 'u@h:22',
  }
}

describe('reorderTabs', () => {
  it('moves a tab before another', () => {
    const list = [tab('a'), tab('b'), tab('c')]
    expect(reorderTabs(list, 'c', 'a').map((item) => item.key)).toEqual([
      'c',
      'a',
      'b',
    ])
  })

  it('is a no-op for the same key or missing keys', () => {
    const list = [tab('a'), tab('b')]
    expect(reorderTabs(list, 'a', 'a')).toEqual(list)
    expect(reorderTabs(list, 'x', 'a')).toEqual(list)
  })
})
