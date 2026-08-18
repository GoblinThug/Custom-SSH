import { describe, expect, it } from 'vitest'
import { formatMessage } from './formatMessage'

describe('formatMessage', () => {
  it('replaces placeholders', () => {
    expect(formatMessage('Hello {name}', { name: 'Ada' })).toBe('Hello Ada')
  })

  it('replaces the same key more than once', () => {
    expect(formatMessage('{n} and {n}', { n: 2 })).toBe('2 and 2')
  })

  it('stringifies numbers', () => {
    expect(formatMessage('{count} files', { count: 12 })).toBe('12 files')
  })

  it('leaves unknown placeholders intact', () => {
    expect(formatMessage('Hi {name}', { other: 'x' })).toBe('Hi {name}')
  })
})
